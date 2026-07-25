import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { FiRefreshCw, FiSave } from 'react-icons/fi';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { getFunctionsInvokeErrorMessage } from '../../helpers/functionsInvokeError';
import { getPublicUserId } from '../../utils/getPublicUserId';
import {
  applyManualCashToRow,
  buildAnnualSummary,
  buildMonthlySummary,
  buildYtdSummary,
  annualSummaryStart,
  clampLedgerStartDate,
  comparisonMonths,
  emptyLedgerShellRow,
  fetchEarliestTimeClockDate,
  fetchExternalSalesCoverageGaps,
  fetchLaborByDateRange,
  fetchLaborAndSubsidyForRange,
  loadLedgerSettings,
  loadSalesLedgerRows,
  mergeLaborIntoRows,
  reapplyLaborAndSubsidy,
  rebuildLedgerDaySnapshotsForRange,
  saveManualLaborEntry,
  sumMonthlyRowTotal,
  upsertLedgerDaySnapshots,
  ytdComparisonStart,
} from '../../utils/dailySalesLedgerClient';

const fmt = (n) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(n) || 0);

const fmtPct = (n) => (n == null ? '—' : `${Number(n).toFixed(1)}%`);

const fmtDate = (dateKey) => {
  const d = new Date(`${dateKey}T12:00:00`);
  return d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

const monthStart = (dateKey) => `${dateKey.slice(0, 7)}-01`;

const yearStart = (dateKey) => `${dateKey.slice(0, 4)}-01-01`;

const todayKey = () => new Date().toISOString().slice(0, 10);

function earliestStoredDate(syncStatus) {
  if (!syncStatus) return null;
  const candidates = [syncStatus.cloverStoredFrom, syncStatus.anetStoredFrom].filter(Boolean);
  if (candidates.length === 0) return null;
  return candidates.sort()[0];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const addCalendarDays = (dateKey, days) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
};

const dateKeysBetween = (startKey, endKey) => {
  const dates = [];
  let cursor = startKey;
  while (cursor <= endKey) {
    dates.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  return dates;
};

const DailySalesLedgerContent = () => {
  const { selectedBusinessId } = useBusinessContext();
  const { hasElevatedPrivileges, isManager, userRole } = usePermissions();
  const canEdit = hasElevatedPrivileges() || isManager() || ['manager', 'owner', 'admin'].includes(userRole);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [recalculatingLabor, setRecalculatingLabor] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState('');
  const [syncStatus, setSyncStatus] = useState(null);
  const [rows, setRows] = useState([]);
  const [monthlySummary, setMonthlySummary] = useState([]);
  const [annualSummary, setAnnualSummary] = useState([]);
  const [selectedAnnualYears, setSelectedAnnualYears] = useState(() => new Set());
  const [ytdSummary, setYtdSummary] = useState([]);
  const [summaryRows, setSummaryRows] = useState([]);
  const [endDate, setEndDate] = useState(() => todayKey());
  const [startDate, setStartDate] = useState(() => yearStart(todayKey()));
  const [backfillStart, setBackfillStart] = useState('2020-01-01');
  const [cashDrafts, setCashDrafts] = useState({});
  const [laborDrafts, setLaborDrafts] = useState({});
  const [savingDate, setSavingDate] = useState(null);
  const [savingLaborDate, setSavingLaborDate] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [coverageGaps, setCoverageGaps] = useState(null);
  const [earliestClockDate, setEarliestClockDate] = useState(null);

  const applySummaryFromRows = useCallback((summaryLedgerRows) => {
    const asOfDate = todayKey();
    setSummaryRows(summaryLedgerRows);
    setAnnualSummary(buildAnnualSummary(summaryLedgerRows, asOfDate));
    setMonthlySummary(buildMonthlySummary(summaryLedgerRows, asOfDate));
    setYtdSummary(buildYtdSummary(summaryLedgerRows, asOfDate));
  }, []);

  const applyLedgerRows = useCallback((ledgerRows, summaryLedgerRows = ledgerRows) => {
    const asOfDate = todayKey();
    setRows(ledgerRows);
    setSummaryRows(summaryLedgerRows);
    setAnnualSummary(buildAnnualSummary(summaryLedgerRows, asOfDate));
    setMonthlySummary(buildMonthlySummary(summaryLedgerRows, asOfDate));
    setYtdSummary(buildYtdSummary(summaryLedgerRows, asOfDate));
    const drafts = {};
    const laborDraftValues = {};
    for (const row of ledgerRows) {
      if (row.cashStatus === 'entered' && row.manualCash != null) {
        drafts[row.date] = String(row.manualCash);
      }
      if (row.manualLabor != null) {
        laborDraftValues[row.date] = String(row.manualLabor);
      }
    }
    setCashDrafts(drafts);
    setLaborDrafts(laborDraftValues);
  }, []);

  const loadLedger = useCallback(async ({ silent = false, rangeStart, rangeEnd } = {}) => {
    if (!selectedBusinessId) {
      setLoading(false);
      return;
    }
    try {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setLoadError(null);

      const viewEnd = rangeEnd || endDate || todayKey();
      const viewStart = rangeStart || startDate || yearStart(viewEnd);
      const asOfDate = todayKey();
      const compareStart = ytdComparisonStart(viewEnd);
      const storedFrom = earliestStoredDate(syncStatus);
      const annualStart = annualSummaryStart(asOfDate, storedFrom);
      const summaryStart = [viewStart, compareStart, annualStart].sort()[0];
      const summaryEnd = viewEnd >= asOfDate ? viewEnd : asOfDate;

      const { timeZone, salesDayEndTime } = await loadLedgerSettings(supabase, selectedBusinessId);

      const needsExtendedSummary = summaryStart < viewStart || summaryEnd > viewEnd;
      const laborFetchStart = clampLedgerStartDate(summaryStart);
      const { laborByDate, subsidyByDate, fetchFailed } = await fetchLaborByDateRange(
        supabase,
        selectedBusinessId,
        laborFetchStart,
        summaryEnd,
      );
      if (fetchFailed) {
        toast.error('Some payroll/subsidy data could not load. Try Recalc labor & subsidy.');
      }

      const [ledgerRows, loadedSummaryRows] = await Promise.all([
        loadSalesLedgerRows(
          supabase,
          selectedBusinessId,
          viewStart,
          viewEnd,
          timeZone,
          salesDayEndTime,
          laborByDate,
          { fillCalendarDays: true, preferSnapshots: true, subsidyByDate },
        ),
        needsExtendedSummary
          ? loadSalesLedgerRows(
              supabase,
              selectedBusinessId,
              summaryStart,
              summaryEnd,
              timeZone,
              salesDayEndTime,
              laborByDate,
              { fillCalendarDays: false, preferSnapshots: true, subsidyByDate },
            )
          : Promise.resolve(null),
      ]);
      const summaryLedgerRows = loadedSummaryRows || ledgerRows;

      applyLedgerRows(ledgerRows, summaryLedgerRows);
      setEndDate(viewEnd);
      setStartDate(viewStart);

      supabase.functions
        .invoke('daily-sales-ledger', {
          body: { action: 'sync_status', business_id: selectedBusinessId },
        })
        .then(({ data, error }) => {
          if (!error && data?.syncStatus) setSyncStatus(data.syncStatus);
        })
        .catch((e) => console.warn('[DailySalesLedger] sync_status failed', e));

      fetchEarliestTimeClockDate(supabase, selectedBusinessId)
        .then((firstClock) => setEarliestClockDate(firstClock))
        .catch((e) => console.warn('[DailySalesLedger] earliest clock query failed', e));

      fetchExternalSalesCoverageGaps(
        supabase,
        selectedBusinessId,
        viewStart,
        viewEnd,
        timeZone,
        salesDayEndTime,
      )
        .then((gaps) => {
          setCoverageGaps(gaps);
          if (gaps?.backfillStart) {
            setBackfillStart((prev) => (prev === '2020-01-01' ? gaps.backfillStart : prev));
          }
        })
        .catch((e) => console.warn('[DailySalesLedger] coverage check failed', e));
    } catch (e) {
      console.error('[DailySalesLedger]', e);
      const message = e.message || 'Could not load daily sales ledger';
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyLedgerRows, endDate, selectedBusinessId, startDate, syncStatus]);

  const recalculateLaborAndSubsidy = useCallback(async () => {
    if (!selectedBusinessId || rows.length === 0) {
      toast.error('Load the ledger first, then recalculate labor and subsidy.');
      return;
    }
    try {
      setRecalculatingLabor(true);
      const viewEnd = endDate || todayKey();
      const viewStart = startDate || yearStart(viewEnd);
      const asOfDate = todayKey();
      const compareStart = ytdComparisonStart(viewEnd);
      const storedFrom = earliestStoredDate(syncStatus);
      const annualStart = annualSummaryStart(asOfDate, storedFrom);
      const summaryStart = [viewStart, compareStart, annualStart].sort()[0];
      const summaryEnd = viewEnd >= asOfDate ? viewEnd : asOfDate;
      const laborFetchStart = clampLedgerStartDate(summaryStart);

      const { laborByDate, subsidyByDate, fetchFailed } = await fetchLaborAndSubsidyForRange(
        supabase,
        selectedBusinessId,
        laborFetchStart,
        summaryEnd,
      );
      if (fetchFailed) {
        toast.error('Some payroll/subsidy ranges failed to load. Subsidy totals may be incomplete.');
      }

      const nextRows = reapplyLaborAndSubsidy(rows, laborByDate, subsidyByDate);
      const nextSummary = reapplyLaborAndSubsidy(
        summaryRows.length > 0 ? summaryRows : rows,
        laborByDate,
        subsidyByDate,
      );

      setRows(nextRows);
      applySummaryFromRows(nextSummary);
      toast.success('Labor and subsidy recalculated from current employee settings.');
    } catch (e) {
      console.error('[DailySalesLedger] recalculate labor', e);
      toast.error(e.message || 'Could not recalculate labor and subsidy');
    } finally {
      setRecalculatingLabor(false);
    }
  }, [applySummaryFromRows, endDate, rows, selectedBusinessId, startDate, summaryRows, syncStatus]);

  useEffect(() => {
    if (annualSummary.length === 0) return;
    const available = annualSummary.map((row) => row.year);
    setSelectedAnnualYears((prev) => {
      if (prev.size === 0) {
        const asOfYear = parseInt(todayKey().slice(0, 4), 10);
        const defaults = available.filter((year) => year >= asOfYear - 3);
        return new Set(defaults.length > 0 ? defaults : available);
      }
      const next = new Set([...prev].filter((year) => available.includes(year)));
      return next.size > 0 ? next : new Set(available);
    });
  }, [annualSummary]);

  const toggleAnnualYear = (year) => {
    setSelectedAnnualYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  const selectAllAnnualYears = () => {
    setSelectedAnnualYears(new Set(annualSummary.map((row) => row.year)));
  };

  const clearAnnualYears = () => {
    setSelectedAnnualYears(new Set());
  };

  const visibleAnnualSummary = useMemo(
    () => annualSummary.filter((row) => selectedAnnualYears.has(row.year)),
    [annualSummary, selectedAnnualYears],
  );

  useEffect(() => {
    if (selectedBusinessId) loadLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinessId]);

  const handleApplyRange = () => loadLedger();

  const applyRangePreset = (nextStart, nextEnd = todayKey()) => {
    setStartDate(nextStart);
    setEndDate(nextEnd);
    loadLedger({ rangeStart: nextStart, rangeEnd: nextEnd });
  };

  useEffect(() => {
    if (!syncStatus) return;
    const storedFrom = earliestStoredDate(syncStatus);
    if (storedFrom) setBackfillStart((prev) => (prev === '2020-01-01' ? storedFrom : prev));
  }, [syncStatus]);

  const handlePresetMonth = () => {
    const end = todayKey();
    applyRangePreset(monthStart(end), end);
  };

  const handlePresetYtd = () => {
    const end = todayKey();
    applyRangePreset(yearStart(end), end);
  };

  const handlePresetAllStored = () => {
    const end = todayKey();
    const storedFrom = earliestStoredDate(syncStatus) || yearStart(end);
    applyRangePreset(storedFrom, end);
  };

  const runBackfill = async (rangeStart, rangeEnd) => {
    if (!selectedBusinessId || !rangeStart || !rangeEnd) return;
    const days = dateKeysBetween(rangeStart, rangeEnd);
    const confirmed = window.confirm(
      `Sync Clover and Authorize.net for ${days.length} day(s), from ${rangeStart} through ${rangeEnd}?\n\nEach day syncs separately to avoid timeouts. This may take several minutes.`
    );
    if (!confirmed) return;

    const invokeSync = async (functionName, syncDate) => {
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: { businessId: selectedBusinessId, syncDate },
      });
      if (error) {
        const msg = await getFunctionsInvokeErrorMessage(error, data);
        if (/not configured/i.test(msg)) return { skipped: true, data: null };
        throw new Error(msg);
      }
      if (data?.error) {
        if (/not configured/i.test(String(data.error))) return { skipped: true, data: null };
        throw new Error(data.error);
      }
      return { skipped: false, data };
    };

    try {
      setBackfilling(true);
      let cloverConfigured = syncStatus?.cloverConfigured;
      let anetConfigured = syncStatus?.anetConfigured;
      let cloverSkipped = false;
      let anetSkipped = false;
      const totals = {
        days: 0,
        cloverImported: 0,
        cloverUpdated: 0,
        cloverScanned: 0,
        anetImported: 0,
        anetUpdated: 0,
        anetScanned: 0,
        errors: [],
      };

      for (let i = 0; i < days.length; i += 1) {
        const syncDate = days[i];
        setBackfillProgress(`Syncing ${syncDate} (${i + 1}/${days.length})…`);

        const [cloverResult, anetResult] = await Promise.allSettled([
          invokeSync('clover-sync-sales', syncDate),
          invokeSync('authorize-net-sync-sales', syncDate),
        ]);

        if (cloverResult.status === 'rejected') {
          totals.errors.push(`${syncDate} Clover: ${cloverResult.reason?.message || cloverResult.reason}`);
        } else if (cloverResult.value.skipped) {
          cloverSkipped = true;
        } else {
          cloverConfigured = true;
          totals.cloverScanned += cloverResult.value.data?.scanned || 0;
          totals.cloverImported += cloverResult.value.data?.imported || 0;
          totals.cloverUpdated += cloverResult.value.data?.updated || 0;
        }

        if (anetResult.status === 'rejected') {
          totals.errors.push(`${syncDate} Authorize.net: ${anetResult.reason?.message || anetResult.reason}`);
        } else if (anetResult.value.skipped) {
          anetSkipped = true;
        } else {
          anetConfigured = true;
          totals.anetScanned += anetResult.value.data?.scanned || 0;
          totals.anetImported += anetResult.value.data?.imported || 0;
          totals.anetUpdated += anetResult.value.data?.updated || 0;
        }

        totals.days += 1;
        if (i < days.length - 1) await sleep(150);
      }

      const importedTotal = totals.cloverImported + totals.anetImported;
      const updatedTotal = totals.cloverUpdated + totals.anetUpdated;
      const scannedTotal = totals.cloverScanned + totals.anetScanned;

      if (cloverSkipped && anetSkipped) {
        toast.error('No Clover or Authorize.net credentials are configured for this business.');
      } else if (importedTotal === 0 && updatedTotal === 0 && scannedTotal === 0) {
        toast(
          `Backfill finished (${totals.days} day(s) checked) but no transactions were found in that range.`,
          { icon: '⚠️', duration: 8000 }
        );
      } else {
        toast.success(
          `Backfill complete: ${importedTotal} new, ${updatedTotal} updated across ${totals.days} day(s)`
        );
      }

      if (totals.errors.length > 0) {
        console.warn('[DailySalesLedger] backfill errors', totals.errors);
        toast.error(`${totals.errors.length} sync error(s) — check console for details`);
      }

      setBackfillProgress('Refreshing ledger from synced sales…');
      try {
        const { cachedDays } = await rebuildLedgerDaySnapshotsForRange(
          supabase,
          selectedBusinessId,
          rangeStart,
          rangeEnd,
        );
        if (cachedDays > 0) {
          toast.success(`Ledger cache updated for ${cachedDays} day(s)`);
        }
      } catch (rebuildErr) {
        console.warn('[DailySalesLedger] ledger snapshot rebuild failed', rebuildErr);
        toast.error('Sales synced but ledger refresh failed — reload or run backfill again');
      }

      await loadLedger({ silent: true });
    } catch (e) {
      toast.error(e.message || 'Backfill failed');
    } finally {
      setBackfilling(false);
      setBackfillProgress('');
    }
  };

  const handleBackfill = () => runBackfill(backfillStart, endDate || todayKey());

  const handleBackfillMissingMonths = () => {
    if (!coverageGaps?.backfillStart || !coverageGaps?.backfillEnd) return;
    setBackfillStart(coverageGaps.backfillStart);
    runBackfill(coverageGaps.backfillStart, coverageGaps.backfillEnd);
  };

  const saveCash = async (dateKey, rawValue) => {
    if (!selectedBusinessId || !canEdit) return;

    let cashCollected = null;
    const trimmed = String(rawValue ?? '').trim();
    if (trimmed !== '') {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        toast.error('Cash must be a number (0 and negatives allowed)');
        return;
      }
      cashCollected = parsed;
    }

    try {
      setSavingDate(dateKey);
      const { data, error } = await supabase.functions.invoke('daily-sales-ledger', {
        body: {
          action: 'save_manual_cash',
          business_id: selectedBusinessId,
          sales_date: dateKey,
          cash_collected: cashCollected,
        },
      });
      if (error) {
        const msg = await getFunctionsInvokeErrorMessage(error, data);
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);

      const baseRow =
        rows.find((row) => row.date === dateKey)
        || summaryRows.find((row) => row.date === dateKey)
        || emptyLedgerShellRow(dateKey);
      const updated = applyManualCashToRow(baseRow, cashCollected);
      const nextRows = mergeLaborIntoRows(
        rows.some((row) => row.date === dateKey)
          ? rows.map((row) => (row.date === dateKey ? updated : row))
          : [...rows, updated],
        {},
      );
      const nextSummary = mergeLaborIntoRows(
        summaryRows.some((row) => row.date === dateKey)
          ? summaryRows.map((row) => (row.date === dateKey ? updated : row))
          : [...summaryRows, updated],
        {},
      );
      await upsertLedgerDaySnapshots(supabase, selectedBusinessId, [updated]);
      setRows(nextRows);
      applySummaryFromRows(nextSummary);
      setCashDrafts((prev) => {
        const next = { ...prev };
        if (cashCollected == null) delete next[dateKey];
        else next[dateKey] = String(cashCollected);
        return next;
      });
      toast.success(cashCollected == null ? 'Cash entry cleared' : 'Cash saved');
    } catch (e) {
      toast.error(e.message || 'Could not save cash');
    } finally {
      setSavingDate(null);
    }
  };

  const saveLabor = async (dateKey, rawValue) => {
    if (!selectedBusinessId || !canEdit) return;

    let laborDollars = null;
    const trimmed = String(rawValue ?? '').trim();
    if (trimmed !== '') {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        toast.error('Labor must be a number (0 and negatives allowed)');
        return;
      }
      laborDollars = Math.round(parsed * 100) / 100;
    }

    try {
      setSavingLaborDate(dateKey);
      const { data: { session } } = await supabase.auth.getSession();
      const enteredBy = session?.user?.email
        ? await getPublicUserId(session.user.email)
        : null;

      await saveManualLaborEntry(supabase, selectedBusinessId, dateKey, laborDollars, enteredBy);

      const baseRow =
        rows.find((row) => row.date === dateKey)
        || summaryRows.find((row) => row.date === dateKey)
        || emptyLedgerShellRow(dateKey);
      const patched = { ...baseRow, manualLabor: laborDollars };
      const updated = mergeLaborIntoRows([patched], {})[0];
      const nextRows = mergeLaborIntoRows(
        rows.some((row) => row.date === dateKey)
          ? rows.map((row) => (row.date === dateKey ? updated : row))
          : [...rows, updated],
        {},
      );
      const nextSummary = mergeLaborIntoRows(
        summaryRows.some((row) => row.date === dateKey)
          ? summaryRows.map((row) => (row.date === dateKey ? updated : row))
          : [...summaryRows, updated],
        {},
      );
      await upsertLedgerDaySnapshots(supabase, selectedBusinessId, [updated]);
      setRows(nextRows);
      applySummaryFromRows(nextSummary);

      setLaborDrafts((prev) => {
        const next = { ...prev };
        if (laborDollars == null) delete next[dateKey];
        else next[dateKey] = String(laborDollars);
        return next;
      });

      toast.success(laborDollars == null ? 'Labor entry cleared' : 'Labor saved');
    } catch (e) {
      toast.error(e.message || 'Could not save labor');
    } finally {
      setSavingLaborDate(null);
    }
  };

  const showLaborGapWarning =
    earliestClockDate && startDate && startDate < earliestClockDate;

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => b.date.localeCompare(a.date)),
    [rows]
  );

  const viewEndKey = endDate || todayKey();
  const ytdAnchorKey = todayKey();

  const monthMatrix = useMemo(() => {
    const anchorYear = parseInt(ytdAnchorKey.slice(0, 4), 10);
    const years = ytdSummary.length > 0
      ? ytdSummary.map((row) => row.year)
      : [...new Set(monthlySummary.map((c) => c.year))].sort();
    const months = comparisonMonths(ytdAnchorKey);
    return { years, months, anchorYear };
  }, [monthlySummary, ytdAnchorKey, ytdSummary]);

  const getMonthCell = (year, month) =>
    monthlySummary.find((c) => c.year === year && c.month === month);

  if (!selectedBusinessId) {
    return (
      <div style={styles.page}>
        <div style={styles.panel}>
          <div style={styles.panelTitle}>No business selected</div>
          <p style={styles.panelHint}>Choose a business from the dashboard header, then open Daily Sales Ledger again.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div style={styles.loading}>Loading daily sales ledger…</div>;
  }

  if (loadError && rows.length === 0) {
    return (
      <div style={styles.page}>
        <div style={styles.panel}>
          <div style={styles.panelTitle}>Could not load ledger</div>
          <p style={styles.panelHint}>{loadError}</p>
          <button type="button" style={styles.primaryBtn} onClick={() => loadLedger()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Daily Sales Ledger</h1>
          <p style={styles.subtitle}>
            Automated Clover, Helcim (Tavari POS), and Authorize.net totals with additional cash entry.
            Enter additional cash not already counted in Clover, Helcim, or Authorize.net.
            Total = Clover + Helcim + Authorize.net + additional cash. Payroll fills from time clocks or manual entry.
            Wage subsidy uses punch clocks when available (exact daily). Before punch clocks, weekly
            hours come from schedule shifts, approved timesheets, or payroll pay statements — capped and
            spread across Sun–Sat so monthly/annual subsidy totals reconcile.
            After changing subsidy settings, click Recalc labor &amp; subsidy (or Refresh).
          </p>
        </div>
        <div style={styles.headerActions}>
          <button
            type="button"
            style={styles.secondaryBtn}
            onClick={recalculateLaborAndSubsidy}
            disabled={recalculatingLabor || loading || rows.length === 0}
            title="Re-fetch payroll and wage subsidy from time clocks using current employee subsidy settings. Does not change sales or cash."
          >
            <FiRefreshCw size={16} /> {recalculatingLabor ? 'Recalculating…' : 'Recalc labor & subsidy'}
          </button>
          <button type="button" style={styles.secondaryBtn} onClick={() => loadLedger({ silent: true })} disabled={refreshing}>
            <FiRefreshCw size={16} /> {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div style={styles.panel}>
        <div style={styles.panelTitle}>Date range</div>
        <p style={styles.panelHint}>
          Defaults to year-to-date. Use presets or pick dates, then Apply.
        </p>
        <div style={styles.presetRow}>
          <button type="button" style={styles.presetBtn} onClick={handlePresetMonth}>
            This month
          </button>
          <button type="button" style={styles.presetBtn} onClick={handlePresetYtd}>
            Year to date
          </button>
          <button
            type="button"
            style={styles.presetBtn}
            onClick={handlePresetAllStored}
            disabled={!earliestStoredDate(syncStatus)}
            title={
              earliestStoredDate(syncStatus)
                ? `From ${earliestStoredDate(syncStatus)} (earliest stored Clover/Authorize.net day)`
                : 'Load sync status first'
            }
          >
            All stored external sales
          </button>
        </div>
        <div style={styles.controlsRow}>
          <label style={styles.controlLabel}>
            From
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={styles.input} />
          </label>
          <label style={styles.controlLabel}>
            Through
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={styles.input} />
          </label>
          <button type="button" style={styles.primaryBtn} onClick={handleApplyRange}>
            Apply
          </button>
        </div>
      </div>

      <div style={styles.panel}>
        <div style={styles.panelTitle}>External sales sync status</div>
        {syncStatus ? (
          <div style={styles.syncStatusGrid}>
            <div style={styles.syncStatusCard}>
              <strong>Clover</strong>
              <div>{syncStatus.cloverConfigured ? 'Connected' : 'Not configured for this business'}</div>
              <div style={styles.syncStatusMeta}>
                Stored: {syncStatus.cloverStoredCount || 0} transaction(s)
                {syncStatus.cloverStoredFrom && (
                  <span>
                    {' '}
                    · {syncStatus.cloverStoredFrom} to {syncStatus.cloverStoredTo || '—'}
                  </span>
                )}
              </div>
            </div>
            <div style={styles.syncStatusCard}>
              <strong>Authorize.net</strong>
              <div>{syncStatus.anetConfigured ? 'Connected' : 'Not configured for this business'}</div>
              <div style={styles.syncStatusMeta}>
                Stored: {syncStatus.anetStoredCount || 0} transaction(s)
                {syncStatus.anetStoredFrom && (
                  <span>
                    {' '}
                    · {syncStatus.anetStoredFrom} to {syncStatus.anetStoredTo || '—'}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p style={styles.panelHint}>Loading sync status…</p>
        )}
        {!syncStatus?.cloverConfigured && !syncStatus?.anetConfigured && syncStatus && (
          <p style={styles.syncWarning}>
            Backfill cannot import anything until Clover and/or Authorize.net credentials are connected for the
            currently selected business.
          </p>
        )}
        {coverageGaps && (
          <p style={styles.syncWarning}>
            {coverageGaps.missingMonths?.length > 0 && (
              <>
                Clover and/or Authorize.net have no stored sales for:{' '}
                <strong>
                  {coverageGaps.missingMonths.map((m) => m.label).join(', ')}
                </strong>
                .{' '}
              </>
            )}
            {coverageGaps.partialMonths?.length > 0 && (
              <>
                Partial sync (some days missing):{' '}
                {coverageGaps.partialMonths.map((m) => (
                  <span key={m.label}>
                    <strong>{m.label}</strong>
                    {m.partialClover ? ` Clover ${m.cloverStoredDays}/${m.monthDays} days` : ''}
                    {m.partialClover && m.partialAnet ? ';' : ''}
                    {m.partialAnet ? ` Authorize.net ${m.anetStoredDays}/${m.monthDays} days` : ''}
                    .{' '}
                  </span>
                ))}
              </>
            )}
            Run backfill to import missing days from Clover and Authorize.net.
          </p>
        )}
        {showLaborGapWarning && (
          <p style={styles.syncWarning}>
            Time clock punches for this business start on <strong>{earliestClockDate}</strong>. Days before that
            have no automatic labor — enter labor manually in the daily table (same as your Excel Labor column).
          </p>
        )}
      </div>

      <div style={styles.panel}>
        <div style={styles.panelTitle}>Sync historical external sales</div>
        <p style={styles.panelHint}>
          Pull missing Clover and Authorize.net days into Tavari. Each day syncs via the same functions as the manager dashboard (one day per request). Tavari POS
          (Helcim) history is already in the database.
        </p>
        {coverageGaps && (
          <div style={styles.controlsRow}>
            <button
              type="button"
              style={styles.primaryBtn}
              onClick={handleBackfillMissingMonths}
              disabled={backfilling}
            >
              {backfilling
                ? backfillProgress || 'Syncing…'
                : `Backfill missing / partial months (${coverageGaps.backfillStart} → ${coverageGaps.backfillEnd})`}
            </button>
          </div>
        )}
        <div style={styles.controlsRow}>
          <label style={styles.controlLabel}>
            Backfill from
            <input type="date" value={backfillStart} onChange={(e) => setBackfillStart(e.target.value)} style={styles.input} />
          </label>
          <button type="button" style={styles.secondaryBtn} onClick={handleBackfill} disabled={backfilling}>
            {backfilling ? backfillProgress || 'Syncing…' : 'Run backfill'}
          </button>
        </div>
      </div>

      {annualSummary.length > 0 && (
        <div style={styles.panel}>
          <div style={styles.panelTitle}>Annual sales</div>
          <p style={styles.panelHint}>
            Full calendar year totals (Jan 1 – Dec 31). The current year runs through today ({todayKey()}).
          </p>
          <div style={styles.annualYearPicker}>
            <span style={styles.pickerLabel}>Show years</span>
            <div style={styles.yearChipRow}>
              {annualSummary.map((row) => (
                <label key={row.year} style={styles.yearChip}>
                  <input
                    type="checkbox"
                    checked={selectedAnnualYears.has(row.year)}
                    onChange={() => toggleAnnualYear(row.year)}
                  />
                  {row.year}
                </label>
              ))}
            </div>
            <div style={styles.pickerActions}>
              <button type="button" style={styles.pickerActionBtn} onClick={selectAllAnnualYears}>
                All
              </button>
              <button type="button" style={styles.pickerActionBtn} onClick={clearAnnualYears}>
                None
              </button>
            </div>
          </div>
          {visibleAnnualSummary.length > 0 ? (
            <div style={styles.ytdGrid}>
              {visibleAnnualSummary.map((row) => (
                <div key={row.year} style={styles.ytdCard}>
                  <div style={styles.ytdYear}>{row.year}{row.isPartialYear ? ' (in progress)' : ''}</div>
                  <div style={styles.ytdMetric}><span>Sales</span><strong>{fmt(row.salesAnnual)}</strong></div>
                  <div style={styles.ytdMetric}><span>Payroll</span><strong>{fmt(row.laborDollarsAnnual)}</strong></div>
                  {row.subsidyCreditAnnual > 0 && (
                    <div style={styles.ytdMetric}><span>Subsidy</span><strong>{fmt(row.subsidyCreditAnnual)}</strong></div>
                  )}
                  <div style={styles.ytdMetric}><span>After subsidy</span><strong>{fmt(row.laborAfterSubsidyAnnual)}</strong></div>
                  <div style={styles.ytdMetric}><span>Labor %</span><strong>{fmtPct(row.laborPercent)}</strong></div>
                  {row.subsidyCreditAnnual > 0 && (
                    <div style={styles.ytdMetric}><span>Net labor %</span><strong>{fmtPct(row.adjustedLaborPercent)}</strong></div>
                  )}
                  <div style={styles.ytdMetric}><span>Profit after wages</span><strong>{row.profitAfterWages != null ? fmt(row.profitAfterWages) : '—'}</strong></div>
                  <div style={styles.ytdFoot}>
                    {row.periodStart} – {row.periodEnd} · {row.completeDayCount} day(s) with sales
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={styles.panelHint}>Select at least one year above to show annual totals.</p>
          )}
        </div>
      )}

      {ytdSummary.length > 0 && (
        <div style={styles.panel}>
          <div style={styles.panelTitle}>
            Year-to-date comparison (Jan 1 through {ytdAnchorKey})
          </div>
          <p style={styles.panelHint}>
            Each year uses the same calendar period through today for apples-to-apples comparison (independent of the date range filter above).
          </p>
          <div style={styles.ytdGrid}>
            {ytdSummary.map((row) => (
              <div key={row.year} style={styles.ytdCard}>
                <div style={styles.ytdYear}>{row.year} YTD</div>
                <div style={styles.ytdMetric}><span>Sales</span><strong>{fmt(row.salesYtd)}</strong></div>
                <div style={styles.ytdMetric}><span>Payroll</span><strong>{fmt(row.laborDollarsYtd)}</strong></div>
                {row.subsidyCreditYtd > 0 && (
                  <div style={styles.ytdMetric}><span>Subsidy</span><strong>{fmt(row.subsidyCreditYtd)}</strong></div>
                )}
                <div style={styles.ytdMetric}><span>After subsidy</span><strong>{fmt(row.laborAfterSubsidyYtd)}</strong></div>
                <div style={styles.ytdMetric}><span>Labor %</span><strong>{fmtPct(row.laborPercent)}</strong></div>
                {row.subsidyCreditYtd > 0 && (
                  <div style={styles.ytdMetric}><span>Net labor %</span><strong>{fmtPct(row.adjustedLaborPercent)}</strong></div>
                )}
                <div style={styles.ytdMetric}><span>Profit after wages</span><strong>{row.profitAfterWagesYtd != null ? fmt(row.profitAfterWagesYtd) : '—'}</strong></div>
                <div style={styles.ytdFoot}>Through {row.ytdThrough} · {row.completeDayCount} day(s) with sales</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {monthlySummary.length > 0 && (
        <div style={styles.panel}>
          <div style={styles.panelTitle}>Monthly summary</div>
          <p style={styles.panelHint}>
            Jan–{new Date(`${ytdAnchorKey.slice(0, 7)}-01T12:00:00`).toLocaleDateString('en-CA', { month: 'short' })}{' '}
            through {ytdAnchorKey} for each year. The last month is partial when today falls mid-month.
            Row totals should match the YTD cards above.
          </p>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Year</th>
                  {monthMatrix.months.map((m) => (
                    <th key={m} style={styles.th}>{new Date(2024, m - 1, 1).toLocaleDateString('en-CA', { month: 'short' })}</th>
                  ))}
                  <th style={styles.th}>Total</th>
                </tr>
              </thead>
              <tbody>
                {monthMatrix.years.map((year) => {
                  const ytdRow = ytdSummary.find((row) => row.year === year);
                  const rowTotal = sumMonthlyRowTotal(monthlySummary, year);
                  return (
                  <tr key={year}>
                    <td style={styles.tdYear}>{year}</td>
                    {monthMatrix.months.map((month) => {
                      const cell = getMonthCell(year, month);
                      return (
                        <td key={`${year}-${month}`} style={styles.tdMonth}>
                          {cell ? (
                            <>
                              <div>{fmt(cell.sales)}</div>
                              <div style={styles.cellSub}>{fmtPct(cell.laborPercent)} labor</div>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                      );
                    })}
                    <td style={styles.tdYearTotal}>
                      <strong>{fmt(rowTotal)}</strong>
                      {ytdRow && rowTotal !== ytdRow.salesYtd && (
                        <div style={styles.cellSubWarn}>YTD card: {fmt(ytdRow.salesYtd)}</div>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={styles.panel}>
        <div style={styles.panelTitle}>Daily ledger</div>
        {rows.length > 0 && (
          <p style={styles.panelHint}>
            {rows.length} day(s) in range. Scroll the table below to browse days — column headers stay pinned at the
            top. Enter additional cash and labor; sales channels load from Clover, Helcim, and Authorize.net.
          </p>
        )}
        <div style={styles.dailyTableWrap}>
          <table style={styles.dailyLedgerTable}>
            <colgroup>
              <col style={{ width: 200 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 104 }} />
              <col style={{ width: 112 }} />
              <col style={{ width: 196 }} />
              <col style={{ width: 96 }} />
              <col style={{ width: 196 }} />
              <col style={{ width: 88 }} />
              <col style={{ width: 88 }} />
              <col style={{ width: 72 }} />
              <col style={{ width: 104 }} />
              <col style={{ width: 52 }} />
              <col style={{ width: 52 }} />
              <col style={{ width: 64 }} />
              <col style={{ width: 52 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ ...styles.th, ...styles.stickyTh }}>Date</th>
                <th style={{ ...styles.thRight, ...styles.stickyTh }}>Clover</th>
                <th style={{ ...styles.thRight, ...styles.stickyTh }}>Tavari (Helcim)</th>
                <th style={{ ...styles.thRight, ...styles.stickyTh }}>Authorize.net</th>
                <th style={{ ...styles.th, ...styles.stickyTh }}>Add. cash</th>
                <th style={{ ...styles.thRight, ...styles.stickyTh }}>Total</th>
                <th style={{ ...styles.th, ...styles.stickyTh }}>Payroll</th>
                <th style={{ ...styles.thRight, ...styles.stickyTh }}>Subsidy</th>
                <th style={{ ...styles.thRight, ...styles.stickyTh }}>After subsidy</th>
                <th style={{ ...styles.thRight, ...styles.stickyTh }}>Labor %</th>
                <th style={{ ...styles.thRight, ...styles.stickyTh }}>Profit a/w</th>
                <th style={{ ...styles.thCenter, ...styles.stickyTh }}>R-All</th>
                <th style={{ ...styles.thCenter, ...styles.stickyTh }}>R-Yr</th>
                <th style={{ ...styles.thCenter, ...styles.stickyTh }}>R-Profit</th>
                <th style={{ ...styles.thCenter, ...styles.stickyTh }}>R-Mo</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={15} style={styles.emptyCell}>No days in this range.</td>
                </tr>
              ) : (
                sortedRows.map((row) => {
                  const draft = Object.prototype.hasOwnProperty.call(cashDrafts, row.date)
                    ? cashDrafts[row.date]
                    : row.cashStatus === 'entered' && row.manualCash != null
                      ? String(row.manualCash)
                      : '';
                  const laborDraft = Object.prototype.hasOwnProperty.call(laborDrafts, row.date)
                    ? laborDrafts[row.date]
                    : row.manualLabor != null
                      ? String(row.manualLabor)
                      : '';
                  const cashNotEntered = row.cashStatus === 'not_entered';
                  const laborFromClocks = row.manualLabor == null && row.clockLabor > 0;
                  const laborNeedsManual =
                    row.manualLabor == null &&
                    row.clockLabor <= 0 &&
                    earliestClockDate &&
                    row.date < earliestClockDate;
                  return (
                    <tr key={row.date} style={cashNotEntered ? styles.rowIncomplete : undefined}>
                      <td style={styles.tdDate}>{fmtDate(row.date)}</td>
                      <td style={styles.tdNum}>{fmt(row.clover)}</td>
                      <td style={styles.tdNum}>{fmt(row.helcim)}</td>
                      <td style={styles.tdNum}>{fmt(row.authorizeNet)}</td>
                      <td style={styles.tdCash}>
                        {canEdit ? (
                          <div style={styles.cashEditWrap}>
                            <input
                              type="number"
                              step="0.01"
                              value={draft}
                              placeholder="—"
                              onChange={(e) => setCashDrafts((prev) => ({ ...prev, [row.date]: e.target.value }))}
                              style={{
                                ...styles.cashInput,
                                ...(cashNotEntered ? styles.cashInputMissing : {}),
                              }}
                            />
                            <button
                              type="button"
                              style={styles.saveCashBtn}
                              title="Save cash"
                              disabled={savingDate === row.date}
                              onClick={() => saveCash(row.date, draft)}
                            >
                              <FiSave size={14} />
                            </button>
                          </div>
                        ) : (
                          row.manualCash != null ? fmt(row.manualCash) : '—'
                        )}
                        {cashNotEntered && <div style={styles.cashFlag}>Cash not entered</div>}
                        {(row.helcimCashInSystem !== 0 || row.cloverCashInSystem !== 0) && (
                          <div style={styles.cashHint}>
                            Sys cash: Helcim {fmt(row.helcimCashInSystem)}, Clover {fmt(row.cloverCashInSystem)}
                          </div>
                        )}
                      </td>
                      <td style={styles.tdNum}>
                        {row.totalSales != null ? fmt(row.totalSales) : <span style={styles.incomplete}>—</span>}
                      </td>
                      <td style={styles.tdCash}>
                        {canEdit ? (
                          <div style={styles.cashEditWrap}>
                            <input
                              type="number"
                              step="0.01"
                              value={laborDraft}
                              placeholder="—"
                              onChange={(e) => setLaborDrafts((prev) => ({ ...prev, [row.date]: e.target.value }))}
                              style={{
                                ...styles.cashInput,
                                ...(laborNeedsManual ? styles.cashInputMissing : {}),
                                ...(laborFromClocks ? styles.laborInputClock : {}),
                              }}
                            />
                            <button
                              type="button"
                              style={styles.saveCashBtn}
                              title="Save labor"
                              disabled={savingLaborDate === row.date}
                              onClick={() => saveLabor(row.date, laborDraft)}
                            >
                              <FiSave size={14} />
                            </button>
                          </div>
                        ) : (
                          fmt(row.laborDollars)
                        )}
                        {row.laborSource === 'manual' && (
                          <div style={styles.cashHint}>From Excel import</div>
                        )}
                        {laborFromClocks && <div style={styles.cashHint}>From time clocks</div>}
                        {laborNeedsManual && <div style={styles.cashFlag}>Enter labor</div>}
                        {(row.manualLabor != null || row.clockLabor > 0) && (
                          <div style={styles.cashHint}>Applied: {fmt(row.laborDollars)}</div>
                        )}
                        {row.laborDollars <= 0 && laborNeedsManual && (
                          <div style={styles.cashHint}>No time clocks before {earliestClockDate}</div>
                        )}
                      </td>
                      <td style={styles.tdNum}>
                        {row.subsidyCredit > 0 ? fmt(row.subsidyCredit) : '—'}
                      </td>
                      <td style={styles.tdNum}>
                        {row.laborDollars > 0 || row.laborAfterSubsidy > 0 ? fmt(row.laborAfterSubsidy) : '—'}
                        {row.subsidyCredit > 0 && (
                          <div style={styles.cashHint}>Net cost to business</div>
                        )}
                      </td>
                      <td style={styles.tdNum}>
                        {fmtPct(row.laborPercent)}
                        {row.subsidyCredit > 0 && row.adjustedLaborPercent != null && (
                          <div style={styles.cashHint}>Net {fmtPct(row.adjustedLaborPercent)}</div>
                        )}
                      </td>
                      <td style={styles.tdNum}>{row.profitAfterWages != null ? fmt(row.profitAfterWages) : '—'}</td>
                      <td style={styles.tdCenter}>{row.rankOverall ?? '—'}</td>
                      <td style={styles.tdCenter}>{row.rankThisYear ?? '—'}</td>
                      <td style={styles.tdCenter}>{row.rankProfitOverall ?? '—'}</td>
                      <td style={styles.tdCenter}>{row.rankThisMonth ?? '—'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const DailySalesLedger = () => (
  <POSAuthWrapper
    requiredRoles={['manager', 'owner', 'admin']}
    requireBusiness={true}
    componentName="Daily Sales Ledger"
  >
    <DailySalesLedgerContent />
  </POSAuthWrapper>
);

const styles = {
  page: {
    padding: '24px 28px 48px',
    maxWidth: 1600,
    margin: '0 auto',
  },
  loading: {
    padding: 48,
    textAlign: 'center',
    color: '#6b7280',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 20,
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    color: '#111827',
  },
  subtitle: {
    margin: '8px 0 0',
    color: '#6b7280',
    maxWidth: 760,
    lineHeight: 1.5,
  },
  headerActions: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
  },
  panel: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  },
  panelTitle: {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 12,
    color: '#111827',
  },
  panelHint: {
    margin: '0 0 12px',
    color: '#6b7280',
    fontSize: 13,
  },
  syncStatusGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 12,
    marginBottom: 8,
  },
  syncStatusCard: {
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: 14,
    background: '#fafafa',
    fontSize: 13,
    color: '#374151',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  syncStatusMeta: {
    fontSize: 13,
    color: '#6b7280',
  },
  syncWarning: {
    margin: '8px 0 0',
    padding: '10px 12px',
    borderRadius: 8,
    background: '#fffbeb',
    border: '1px solid #fcd34d',
    color: '#92400e',
    fontSize: 13,
  },
  controlsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'flex-end',
  },
  presetRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  presetBtn: {
    padding: '7px 12px',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    background: '#f9fafb',
    fontSize: 13,
    cursor: 'pointer',
  },
  controlLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 13,
    color: '#374151',
  },
  input: {
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    fontSize: 14,
  },
  primaryBtn: {
    padding: '9px 16px',
    borderRadius: 8,
    border: 'none',
    background: TavariStyles.colors.primary,
    color: '#fff',
    fontWeight: 600,
    cursor: 'pointer',
  },
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '9px 16px',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    background: '#fff',
    cursor: 'pointer',
  },
  ytdGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 12,
  },
  annualYearPicker: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid #e5e7eb',
    background: '#f9fafb',
  },
  pickerLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: '#374151',
    marginRight: 4,
  },
  yearChipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    flex: 1,
  },
  yearChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    borderRadius: 999,
    border: '1px solid #d1d5db',
    background: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    userSelect: 'none',
  },
  pickerActions: {
    display: 'flex',
    gap: 8,
  },
  pickerActionBtn: {
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    background: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  ytdCard: {
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: 14,
    background: '#fafafa',
  },
  ytdYear: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 10,
  },
  ytdMetric: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    fontSize: 13,
    marginBottom: 6,
    color: '#374151',
  },
  ytdFoot: {
    marginTop: 8,
    fontSize: 11,
    color: '#9ca3af',
  },
  tableWrap: {
    overflowX: 'auto',
  },
  dailyTableWrap: {
    maxHeight: 'calc(100vh - 220px)',
    overflow: 'auto',
    border: '1px solid #eef2f7',
    borderRadius: 8,
    WebkitOverflowScrolling: 'touch',
  },
  dailyLedgerTable: {
    width: '100%',
    minWidth: 1396,
    tableLayout: 'fixed',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  stickyTh: {
    position: 'sticky',
    top: 0,
    zIndex: 2,
    background: '#fff',
    boxShadow: 'inset 0 -2px 0 #e5e7eb',
    verticalAlign: 'bottom',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    padding: '10px 8px',
    borderBottom: '2px solid #e5e7eb',
    whiteSpace: 'nowrap',
    color: '#374151',
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  thRight: {
    textAlign: 'right',
    padding: '10px 8px',
    borderBottom: '2px solid #e5e7eb',
    whiteSpace: 'nowrap',
    color: '#374151',
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  thCenter: {
    textAlign: 'center',
    padding: '10px 8px',
    borderBottom: '2px solid #e5e7eb',
    whiteSpace: 'nowrap',
    color: '#374151',
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  tdDate: {
    padding: '10px 8px',
    borderBottom: '1px solid #eef2f7',
    whiteSpace: 'nowrap',
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  tdYear: {
    padding: '10px 8px',
    borderBottom: '1px solid #eef2f7',
    fontWeight: 700,
  },
  tdMonth: {
    padding: '10px 8px',
    borderBottom: '1px solid #eef2f7',
    verticalAlign: 'top',
    minWidth: 88,
  },
  tdYearTotal: {
    padding: '10px 8px',
    borderBottom: '1px solid #eef2f7',
    verticalAlign: 'top',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    background: '#f8fafc',
  },
  tdNum: {
    padding: '10px 8px',
    borderBottom: '1px solid #eef2f7',
    textAlign: 'right',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  tdCash: {
    padding: '10px 8px',
    borderBottom: '1px solid #eef2f7',
    verticalAlign: 'top',
    overflow: 'hidden',
  },
  tdCenter: {
    padding: '10px 8px',
    borderBottom: '1px solid #eef2f7',
    textAlign: 'center',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  cellSub: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 2,
  },
  cellSubWarn: {
    fontSize: 11,
    color: '#b45309',
    marginTop: 2,
  },
  emptyCell: {
    padding: 24,
    textAlign: 'center',
    color: '#9ca3af',
  },
  rowIncomplete: {
    background: '#fffbeb',
  },
  cashEditWrap: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    minWidth: 0,
  },
  cashInput: {
    width: '100%',
    maxWidth: 96,
    minWidth: 0,
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid #d1d5db',
    fontSize: 13,
    boxSizing: 'border-box',
  },
  cashInputMissing: {
    borderColor: '#f59e0b',
    background: '#fffbeb',
  },
  laborInputClock: {
    background: '#f3f4f6',
    color: '#374151',
    cursor: 'default',
  },
  saveCashBtn: {
    border: '1px solid #d1d5db',
    background: '#fff',
    borderRadius: 6,
    padding: '6px 8px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  cashFlag: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: 600,
    color: '#b45309',
  },
  cashHint: {
    marginTop: 4,
    fontSize: 10,
    color: '#9ca3af',
  },
  incomplete: {
    color: '#b45309',
    fontWeight: 600,
  },
};

export default DailySalesLedger;
