import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, UserCheck, UserX } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { getEmployeePortalSelectedBusinessId } from '../../utils/employeeProfileSelection';
import { getFunctionsInvokeErrorMessage } from '../../helpers/functionsInvokeError';

const formatCurrency = (n) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(
    Number(n) || 0
  );

const formatCurrencyPrecise = (n) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(n) || 0);

const formatPercent = (n) => `${(Number(n) || 0).toFixed(1)}%`;

const formatTime12 = (isoOrTime) => {
  if (!isoOrTime) return '—';
  if (typeof isoOrTime === 'string' && isoOrTime.length <= 8 && isoOrTime.includes(':')) {
    const [h, m] = isoOrTime.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  }
  return new Date(isoOrTime).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
};

const toHHmm = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
};

const toHHmmFromShift = (t) => {
  if (!t) return '';
  const parts = String(t).split(':');
  return `${parts[0]?.padStart(2, '0') || '00'}:${parts[1]?.padStart(2, '0') || '00'}`;
};

const ABSENT_SHIFT_STATUSES = new Set(['sick', 'no_show', 'cancelled']);
const isAbsentShiftStatus = (status) => ABSENT_SHIFT_STATUSES.has(String(status || '').toLowerCase());

const addCalendarDays = (dateKey, days) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
};

const chartSyncDates = (anchorDate) => {
  const dates = [];
  for (let i = 4; i >= 0; i -= 1) {
    dates.push(addCalendarDays(anchorDate, -i));
  }
  return dates;
};

/** All calendar days from the 1st of the month through anchorDate (for MTD external sales sync). */
const monthSyncDates = (anchorDate) => {
  const [y, m, d] = anchorDate.split('-').map(Number);
  const dates = [];
  for (let day = 1; day <= d; day += 1) {
    const dt = new Date(Date.UTC(y, m - 1, day));
    dates.push(dt.toISOString().slice(0, 10));
  }
  return dates;
};

const mergeSyncDates = (anchorDate) => {
  const merged = new Set([...monthSyncDates(anchorDate), ...chartSyncDates(anchorDate)]);
  return [...merged].sort();
};

const todayKeyInTimeZone = (timeZone) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const SALES_COLORS = {
  posToday: TavariStyles.colors.primary,
  posOther: '#94a3b8',
  authorizeToday: '#6366f1',
  authorizeOther: '#a5b4fc',
  cloverToday: '#10b981',
  cloverOther: '#6ee7b7',
};

const formatChartDayLabel = (dateKey, timeZone) => {
  if (!dateKey) return '';
  const d = new Date(`${dateKey}T12:00:00`);
  const dayAbbr = d.toLocaleDateString('en-CA', { weekday: 'short', timeZone });
  const dayNum = dateKey.split('-')[2] || '';
  return `${dayAbbr}-${dayNum}`;
};

const formatSelectedDateLabel = (dateKey, timeZone) => {
  if (!dateKey) return '';
  const d = new Date(`${dateKey}T12:00:00`);
  return d.toLocaleDateString('en-CA', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone,
  });
};

const PortalManagerDashboard = ({ businessId, businessTimezone = 'America/Toronto' }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dailySales, setDailySales] = useState([]);
  const [todayMetrics, setTodayMetrics] = useState({
    sales: 0,
    laborDollars: 0,
    laborPercent: 0,
    subsidyCreditDollars: 0,
    adjustedLaborDollars: 0,
    adjustedLaborPercent: 0,
    subsidyBreakdown: [],
  });
  const [monthMetrics, setMonthMetrics] = useState({
    monthLabel: '',
    salesMTD: 0,
    salesLastYearMTD: 0,
    salesChangePercent: null,
    laborDollarsMTD: 0,
    laborPercentMTD: 0,
  });
  const [staff, setStaff] = useState([]);
  const [todayKey, setTodayKey] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => todayKeyInTimeZone(businessTimezone));
  const [editRow, setEditRow] = useState(null);
  const [editMode, setEditMode] = useState('full');
  const [editClockIn, setEditClockIn] = useState('');
  const [editClockOut, setEditClockOut] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [clockingShiftId, setClockingShiftId] = useState(null);
  const [salesDay, setSalesDay] = useState(null);
  const [salesDayDetail, setSalesDayDetail] = useState(null);
  const [salesDayLoading, setSalesDayLoading] = useState(false);

  const getNowHHmm = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: businessTimezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const hour = parts.find((p) => p.type === 'hour')?.value || '00';
    const minute = parts.find((p) => p.type === 'minute')?.value || '00';
    return `${hour}:${minute}`;
  };

  const syncExternalSales = useCallback(async (targetBusinessId, anchorDate) => {
    const syncDates = mergeSyncDates(anchorDate);

    const invokeSync = async (functionName, syncDate) => {
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: { businessId: targetBusinessId, syncDate },
      });
      if (error) {
        const msg = await getFunctionsInvokeErrorMessage(error, data);
        if (/not configured/i.test(msg)) return null;
        throw new Error(msg);
      }
      if (data?.error) {
        if (/not configured/i.test(String(data.error))) return null;
        throw new Error(data.error);
      }
      return data;
    };

    for (const syncDate of syncDates) {
      const results = await Promise.allSettled([
        invokeSync('authorize-net-sync-sales', syncDate),
        invokeSync('clover-sync-sales', syncDate),
      ]);

      const failures = results.filter((r) => r.status === 'rejected');
      if (failures.length === results.length) {
        const reason = failures[0]?.reason;
        throw reason instanceof Error ? reason : new Error('Could not sync external sales');
      }
    }
  }, []);

  const loadDashboard = useCallback(async ({ silent = false, syncExternal = false } = {}) => {
    const targetBusinessId = businessId || getEmployeePortalSelectedBusinessId();
    if (!targetBusinessId) return;

    try {
      if (silent) setRefreshing(true);
      else setLoading(true);

      if (syncExternal) {
        const anchorDate = selectedDate || todayKey || todayKeyInTimeZone(businessTimezone);
        await syncExternalSales(targetBusinessId, anchorDate);
      }

      const viewDate = selectedDate || todayKeyInTimeZone(businessTimezone);

      const { data, error } = await supabase.functions.invoke('employee-manager-dashboard-action', {
        body: { action: 'dashboard', business_id: targetBusinessId, date: viewDate },
      });

      if (error) {
        const msg = await getFunctionsInvokeErrorMessage(error, data);
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);

      setDailySales(data.dailySales || []);
      setTodayMetrics(data.todayMetrics || {
        sales: 0,
        laborDollars: 0,
        laborPercent: 0,
        subsidyCreditDollars: 0,
        adjustedLaborDollars: 0,
        adjustedLaborPercent: 0,
        subsidyBreakdown: [],
      });
      setMonthMetrics(data.monthMetrics || {
        monthLabel: '',
        salesMTD: 0,
        salesLastYearMTD: 0,
        salesChangePercent: null,
        laborDollarsMTD: 0,
        laborPercentMTD: 0,
      });
      setStaff(data.staff || []);
      setTodayKey(data.todayKey || '');
      setSelectedDate(data.selectedDateKey || viewDate);
    } catch (e) {
      console.error('[PortalManagerDashboard]', e);
      toast.error(e.message || 'Could not load manager dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [businessId, businessTimezone, syncExternalSales, selectedDate, todayKey]);

  useEffect(() => {
    setSelectedDate(todayKeyInTimeZone(businessTimezone));
  }, [businessTimezone]);

  useEffect(() => {
    loadDashboard();
    const onSelectionChange = () => loadDashboard({ silent: true });
    window.addEventListener('employee-profile-selection-changed', onSelectionChange);
    const refreshTimer = window.setInterval(() => loadDashboard({ silent: true }), 60000);
    return () => {
      window.removeEventListener('employee-profile-selection-changed', onSelectionChange);
      window.clearInterval(refreshTimer);
    };
  }, [loadDashboard]);

  const maxSales = Math.max(...dailySales.map((d) => d.netSales || 0), 1);

  const openEdit = (row) => {
    setEditRow(row);
    setEditMode('full');
    setEditClockIn(row.clockIn ? toHHmm(row.clockIn) : toHHmmFromShift(row.shiftStart));
    setEditClockOut(row.clockOut ? toHHmm(row.clockOut) : '');
    setEditNotes('');
  };

  const openClockOut = (row) => {
    setEditRow(row);
    setEditMode('clock_out');
    setEditClockIn(row.clockIn ? toHHmm(row.clockIn) : getNowHHmm());
    setEditClockOut(getNowHHmm());
    setEditNotes('');
  };

  const closeSalesDay = () => {
    setSalesDay(null);
    setSalesDayDetail(null);
    setSalesDayLoading(false);
  };

  const openSalesDay = async (day) => {
    if (!day?.date) return;
    setSalesDay(day);
    setSalesDayDetail(null);
    setSalesDayLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('employee-manager-dashboard-action', {
        body: {
          action: 'day_sales_detail',
          business_id: businessId || getEmployeePortalSelectedBusinessId(),
          date: day.date,
        },
      });
      if (error) {
        const msg = await getFunctionsInvokeErrorMessage(error, data);
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      setSalesDayDetail(data);
    } catch (e) {
      toast.error(e.message || 'Could not load tender breakdown');
      closeSalesDay();
    } finally {
      setSalesDayLoading(false);
    }
  };

  const closeEdit = () => {
    setEditRow(null);
    setEditMode('full');
    setEditClockIn('');
    setEditClockOut('');
    setEditNotes('');
  };

  const handleMarkSick = async (row) => {
    if (!row?.shiftId) return;
    const confirmed = window.confirm(`Mark ${row.employeeName} sick for today's shift?`);
    if (!confirmed) return;

    try {
      const { data, error } = await supabase.functions.invoke('employee-manager-dashboard-action', {
        body: {
          action: 'mark_sick',
          business_id: businessId || getEmployeePortalSelectedBusinessId(),
          shift_id: row.shiftId,
        },
      });
      if (error) {
        const msg = await getFunctionsInvokeErrorMessage(error, data);
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      toast.success('Marked sick');
      await loadDashboard({ silent: true });
    } catch (e) {
      toast.error(e.message || 'Could not mark sick');
    }
  };

  const handleQuickClockIn = async (row) => {
    if (!row?.shiftId) return;
    setClockingShiftId(row.shiftId);
    try {
      const { data, error } = await supabase.functions.invoke('employee-manager-dashboard-action', {
        body: {
          action: 'clock_in',
          business_id: businessId || getEmployeePortalSelectedBusinessId(),
          shift_id: row.shiftId,
        },
      });
      if (error) {
        const msg = await getFunctionsInvokeErrorMessage(error, data);
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      if (data?.alreadyClockedIn) {
        toast.success(`${row.employeeName} is already clocked in`);
      } else {
        toast.success(`${row.employeeName} clocked in`);
      }
      await loadDashboard({ silent: true });
    } catch (e) {
      toast.error(e.message || 'Could not clock in');
    } finally {
      setClockingShiftId(null);
    }
  };

  const handleSaveTimecard = async () => {
    if (!editRow) return;
    const trimmedOut = editClockOut.trim();
    if (editMode === 'clock_out' && !trimmedOut) {
      toast.error('Enter a clock out time');
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('employee-manager-dashboard-action', {
        body: {
          action: 'update_timecard',
          business_id: businessId || getEmployeePortalSelectedBusinessId(),
          shift_id: editRow.shiftId,
          time_clock_id: editRow.timeClockId || undefined,
          date: selectedDate || todayKey,
          clock_in: editClockIn,
          clock_out: trimmedOut ? trimmedOut : null,
          notes: editNotes,
        },
      });
      if (error) {
        const msg = await getFunctionsInvokeErrorMessage(error, data);
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      toast.success(editMode === 'clock_out' ? 'Clocked out' : 'Time card updated');
      closeEdit();
      await loadDashboard({ silent: true });
    } catch (e) {
      toast.error(e.message || 'Could not update time card');
    } finally {
      setSaving(false);
    }
  };

  const handleClearClockOut = async () => {
    if (!editRow?.timeClockId) return;
    const confirmed = window.confirm(
      `Delete the clock out time for ${editRow.employeeName}? This will make their punch open again.`
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('employee-manager-dashboard-action', {
        body: {
          action: 'clear_clock_out',
          business_id: businessId || getEmployeePortalSelectedBusinessId(),
          time_clock_id: editRow.timeClockId,
        },
      });
      if (error) {
        const msg = await getFunctionsInvokeErrorMessage(error, data);
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      toast.success('Clock out deleted');
      closeEdit();
      await loadDashboard({ silent: true });
    } catch (e) {
      toast.error(e.message || 'Could not delete clock out');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={styles.loading}>Loading manager dashboard...</div>;
  }

  const isViewingToday = selectedDate === todayKey;
  const maxDateKey = todayKey || todayKeyInTimeZone(businessTimezone);
  const canGoNextDay = selectedDate < maxDateKey;

  const shiftSelectedDate = (delta) => {
    const next = addCalendarDays(selectedDate, delta);
    if (delta > 0 && next > maxDateKey) return;
    setSelectedDate(next);
  };

  const operationsTitle = isViewingToday
    ? "Today's operations"
    : formatSelectedDateLabel(selectedDate, businessTimezone);

  return (
    <div style={styles.wrap}>
      <div style={styles.headerRow}>
        <div style={{ ...styles.headerRowSlot, ...styles.headerRowSlotStart }}>
          <h2 style={styles.headerTitle}>{operationsTitle}</h2>
        </div>
        <div style={{ ...styles.headerRowSlot, ...styles.headerRowSlotCenter, ...styles.datePickerWrap }}>
          <span style={styles.datePickerLabel}>Date</span>
          <button
            type="button"
            style={styles.dateNavBtn}
            onClick={() => shiftSelectedDate(-1)}
            aria-label="Previous day"
          >
            <ChevronLeft size={20} />
          </button>
          <input
            type="date"
            value={selectedDate}
            max={maxDateKey}
            onChange={(e) => {
              const v = e.target.value;
              if (v) setSelectedDate(v);
            }}
            style={styles.dateInput}
            aria-label="Select date"
          />
          <button
            type="button"
            style={{
              ...styles.dateNavBtn,
              ...(canGoNextDay ? {} : styles.dateNavBtnDisabled),
            }}
            onClick={() => shiftSelectedDate(1)}
            disabled={!canGoNextDay}
            aria-label="Next day"
          >
            <ChevronRight size={20} />
          </button>
        </div>
        <div style={{ ...styles.headerRowSlot, ...styles.headerRowSlotEnd }}>
          <button
            type="button"
            style={styles.refreshBtn}
            onClick={() => loadDashboard({ silent: true, syncExternal: true })}
            disabled={refreshing}
          >
            <RefreshCw size={16} /> {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div style={styles.chartCard}>
        <div style={styles.chartRow}>
          {dailySales.map((day) => {
            const posNet = Math.max(0, Number(day.posNetSales) || 0);
            const authorizeNet = Math.max(0, Number(day.authorizeNetSales) || 0);
            const cloverNet = Math.max(0, Number(day.cloverSales) || 0);
            const totalNet = Math.max(0, Number(day.netSales) || 0);
            const totalBarPct = totalNet > 0 ? Math.max(8, (totalNet / maxSales) * 100) : 0;
            const posShare = totalNet > 0 ? posNet / totalNet : 0;
            const authorizeShare = totalNet > 0 ? authorizeNet / totalNet : 0;
            const cloverShare = totalNet > 0 ? cloverNet / totalNet : 0;
            const isSelectedDay = day.date === selectedDate;
            const isCalendarToday = day.date === todayKey;
            const posColor = isSelectedDay ? SALES_COLORS.posToday : SALES_COLORS.posOther;
            const authorizeColor = isSelectedDay ? SALES_COLORS.authorizeToday : SALES_COLORS.authorizeOther;
            const cloverColor = isSelectedDay ? SALES_COLORS.cloverToday : SALES_COLORS.cloverOther;
            const chartDayLabel = formatChartDayLabel(day.date, businessTimezone);
            return (
              <button
                key={day.date}
                type="button"
                style={styles.chartColBtn}
                onClick={() => openSalesDay(day)}
                aria-label={`${chartDayLabel} sales ${formatCurrency(totalNet)} — view tender breakdown`}
              >
                <div style={styles.chartAmount}>{formatCurrency(totalNet)}</div>
                <div style={styles.chartBarTrack}>
                  <div style={{ ...styles.chartBarStack, height: `${totalBarPct}%` }}>
                    {cloverNet > 0 && (
                      <div
                        style={{
                          ...styles.chartBarSegment,
                          flex: cloverShare,
                          backgroundColor: cloverColor,
                        }}
                        title={`Clover POS: ${formatCurrency(cloverNet)}`}
                      />
                    )}
                    {authorizeNet > 0 && (
                      <div
                        style={{
                          ...styles.chartBarSegment,
                          flex: authorizeShare,
                          backgroundColor: authorizeColor,
                        }}
                        title={`Authorize.net / Bookeo: ${formatCurrency(authorizeNet)}`}
                      />
                    )}
                    {posNet > 0 && (
                      <div
                        style={{
                          ...styles.chartBarSegment,
                          flex: posShare,
                          backgroundColor: posColor,
                        }}
                        title={`Tavari POS: ${formatCurrency(posNet)}`}
                      />
                    )}
                    {totalNet <= 0 && (
                      <div style={{ ...styles.chartBarSegment, flex: 1, backgroundColor: TavariStyles.colors.gray200 }} />
                    )}
                  </div>
                </div>
                <div
                  style={{
                    ...styles.chartLabel,
                    ...(isSelectedDay ? styles.chartLabelToday : {}),
                    ...(isCalendarToday && !isSelectedDay ? styles.chartLabelCalendarToday : {}),
                  }}
                >
                  {chartDayLabel}
                </div>
              </button>
            );
          })}
        </div>
        <div style={styles.chartLegend}>
          <div style={styles.legendItem}>
            <span style={{ ...styles.legendSwatch, backgroundColor: SALES_COLORS.posToday }} />
            <span>Tavari POS (Helcim)</span>
          </div>
          <div style={styles.legendItem}>
            <span style={{ ...styles.legendSwatch, backgroundColor: SALES_COLORS.authorizeToday }} />
            <span>Authorize.net (Bookeo)</span>
          </div>
          <div style={styles.legendItem}>
            <span style={{ ...styles.legendSwatch, backgroundColor: SALES_COLORS.cloverToday }} />
            <span>Clover (in-store)</span>
          </div>
        </div>
      </div>

      <style>{`
        .portal-manager-metrics-grid {
          display: grid;
          gap: 12px;
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        @media (min-width: 640px) {
          .portal-manager-metrics-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
      `}</style>

      <div className="portal-manager-metrics-grid">
        <div style={styles.metricCard}>
          <div style={styles.metricLabel}>{isViewingToday ? "Today's sales" : 'Sales'}</div>
          <div style={styles.metricValue}>{formatCurrencyPrecise(todayMetrics.sales)}</div>
        </div>
        <div style={styles.metricCard}>
          <div style={styles.metricLabel}>Labor (clocked)</div>
          <div style={styles.metricValue}>{formatCurrencyPrecise(todayMetrics.laborDollars)}</div>
        </div>
        <div style={styles.metricCard}>
          <div style={styles.metricLabel}>Labor %</div>
          <div style={styles.metricValue}>{formatPercent(todayMetrics.laborPercent)}</div>
        </div>
        <div style={styles.metricCard}>
          <div style={styles.metricLabel}>Labor % (excl. subsidy)</div>
          <div style={styles.metricValue}>{formatPercent(todayMetrics.adjustedLaborPercent)}</div>
          {Number(todayMetrics.subsidyCreditDollars) > 0 && (
            <div style={styles.metricFooter}>
              {formatCurrencyPrecise(todayMetrics.subsidyCreditDollars)} subsidized today
            </div>
          )}
        </div>
        <div style={styles.metricCard}>
          <div style={styles.metricLabel}>
            {monthMetrics.monthLabel ? `${monthMetrics.monthLabel} sales (MTD)` : 'Monthly sales'}
          </div>
          <div style={styles.metricValue}>{formatCurrencyPrecise(monthMetrics.salesMTD)}</div>
          <div style={styles.metricFooter}>
            vs last year: {formatCurrencyPrecise(monthMetrics.salesLastYearMTD)}
            {monthMetrics.salesChangePercent != null && (
              <span>
                {' '}
                ({monthMetrics.salesChangePercent > 0 ? '+' : ''}
                {formatPercent(monthMetrics.salesChangePercent)})
              </span>
            )}
          </div>
        </div>
        <div style={styles.metricCard}>
          <div style={styles.metricLabel}>
            {monthMetrics.monthLabel ? `${monthMetrics.monthLabel} labor (MTD)` : 'Monthly labor'}
          </div>
          <div style={styles.metricValue}>{formatCurrencyPrecise(monthMetrics.laborDollarsMTD)}</div>
          <div style={styles.metricFooter}>{formatPercent(monthMetrics.laborPercentMTD)} of sales</div>
        </div>
      </div>

      {Array.isArray(todayMetrics.subsidyBreakdown) && todayMetrics.subsidyBreakdown.length > 0 && (
        <div style={styles.subsidyPanel}>
          <div style={styles.subsidyPanelTitle}>Subsidized employees (Sun–Sat week)</div>
          {todayMetrics.subsidyBreakdown.map((row) => {
            const weeklyLabel = `${row.weeklySubsidizedHours?.toFixed(1) || '0.0'} / ${row.weeklyCapHours} hrs used`;
            let status = '';
            if (row.todayWorkedHours > 0 && row.todaySubsidyCredit > 0) {
              status = `${formatCurrencyPrecise(row.todaySubsidyCredit)} subsidized today`;
            } else if (row.todayWorkedHours > 0 && row.capReached) {
              status = `Weekly ${row.weeklyCapHours}h cap reached — no subsidy left today`;
            } else if (row.todayWorkedHours > 0) {
              status = 'Worked today — no subsidy credit';
            } else {
              status = 'Not clocked on selected day';
            }
            return (
              <div key={row.employeeId} style={styles.subsidyRow}>
                <div style={styles.subsidyRowName}>
                  {row.employeeName}
                  {row.partner ? <span style={styles.subsidyPartner}> · {row.partner}</span> : null}
                </div>
                <div style={styles.subsidyRowMeta}>{weeklyLabel}</div>
                <div style={styles.subsidyRowStatus}>{status}</div>
              </div>
            );
          })}
        </div>
      )}

      <h3 style={styles.subTitle}>Scheduled &amp; clocked in</h3>
      {staff.length === 0 ? (
        <div style={styles.empty}>No scheduled shifts for today.</div>
      ) : (
        <div style={styles.staffList}>
          {staff.map((row) => (
            <div key={row.shiftId} style={styles.staffCard}>
              <div style={styles.staffMain}>
                <div style={styles.staffNameRow}>
                  {row.isClockedIn ? (
                    <UserCheck size={18} color="#059669" />
                  ) : (
                    <UserX size={18} color="#9ca3af" />
                  )}
                  <span style={styles.staffName}>{row.employeeName}</span>
                  {row.shiftStatus === 'sick' && <span style={styles.sickBadge}>Sick</span>}
                  {row.shiftStatus === 'no_show' && <span style={styles.noShowBadge}>No show</span>}
                  {row.shiftStatus === 'cancelled' && <span style={styles.noShowBadge}>Cancelled</span>}
                  {row.isClockedIn && <span style={styles.inBadge}>Clocked in</span>}
                </div>
                <div style={styles.staffMeta}>
                  {row.position || 'No position'} · Shift {formatTime12(row.shiftStart)} – {formatTime12(row.shiftEnd)}
                </div>
                {row.hasClock && (
                  <div style={styles.staffMeta}>
                    Punch {formatTime12(row.clockIn)}
                    {row.clockOut ? ` – ${formatTime12(row.clockOut)}` : ' – open'}
                  </div>
                )}
              </div>
              <div style={styles.staffActions}>
                {!isAbsentShiftStatus(row.shiftStatus) && !row.isClockedIn && (
                  <button
                    type="button"
                    style={styles.clockInBtn}
                    onClick={() => handleQuickClockIn(row)}
                    disabled={clockingShiftId === row.shiftId}
                  >
                    {clockingShiftId === row.shiftId ? 'Clocking in…' : 'Clock in'}
                  </button>
                )}
                {!isAbsentShiftStatus(row.shiftStatus) && row.isClockedIn && (
                  <button type="button" style={styles.clockOutBtn} onClick={() => openClockOut(row)}>
                    Clock out
                  </button>
                )}
                {!isAbsentShiftStatus(row.shiftStatus) && (
                  <button type="button" style={styles.sickBtn} onClick={() => handleMarkSick(row)}>
                    Mark sick
                  </button>
                )}
                <button type="button" style={styles.editBtn} onClick={() => openEdit(row)}>
                  Edit time card
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {salesDay && (
        <div style={styles.modalOverlay} role="dialog" aria-modal="true" onClick={closeSalesDay}>
          <div
            style={styles.salesModal}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={styles.modalTitle}>
              Sales — {salesDayDetail?.label || salesDay.label}
            </h3>
            {salesDayLoading ? (
              <div style={styles.salesModalLoading}>Loading tender breakdown…</div>
            ) : salesDayDetail ? (
              <>
                <div style={styles.salesModalTotal}>
                  <span>Net sales</span>
                  <strong>{formatCurrencyPrecise(salesDayDetail.netSales)}</strong>
                </div>

                <h4 style={styles.salesModalSectionTitle}>By processor</h4>
                {salesDayDetail.byProcessor?.length === 0 ? (
                  <p style={styles.salesModalEmpty}>No sales recorded for this day.</p>
                ) : (
                  salesDayDetail.byProcessor.map((processor) => (
                    <div key={processor.processor} style={styles.salesProcessorBlock}>
                      <div style={styles.salesProcessorHeader}>
                        <span>{processor.label}</span>
                        <strong>{formatCurrencyPrecise(processor.netTotal)}</strong>
                      </div>
                      {processor.tenders?.length > 0 && (
                        <div style={styles.tenderList}>
                          {processor.tenders.map((row) => (
                            <div key={`${processor.processor}-${row.key}`} style={styles.tenderRow}>
                              <span>{row.label}</span>
                              <span>{formatCurrencyPrecise(row.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}

                <h4 style={styles.salesModalSectionTitle}>Total by tender</h4>
                {salesDayDetail.byTender?.length === 0 ? (
                  <p style={styles.salesModalEmpty}>—</p>
                ) : (
                  <div style={styles.tenderList}>
                    {salesDayDetail.byTender.map((row) => (
                      <div key={row.key} style={styles.tenderRowTotal}>
                        <span>{row.label}</span>
                        <strong>{formatCurrencyPrecise(row.amount)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : null}
            <div style={styles.modalActions}>
              <button type="button" style={styles.cancelBtn} onClick={closeSalesDay}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {editRow && (
        <div style={styles.modalOverlay} role="dialog" aria-modal="true">
          <div style={styles.modal}>
            <h3 style={styles.modalTitle}>
              {editMode === 'clock_out'
                ? `Clock out — ${editRow.employeeName}`
                : `Edit time card — ${editRow.employeeName}`}
            </h3>
            <label style={styles.label}>Clock in</label>
            <input
              type="time"
              value={editClockIn}
              onChange={(e) => setEditClockIn(e.target.value)}
              style={styles.input}
              readOnly={editMode === 'clock_out'}
            />
            <label style={styles.label}>Clock out</label>
            <input
              type="time"
              value={editClockOut}
              onChange={(e) => setEditClockOut(e.target.value)}
              style={styles.input}
              placeholder="Optional"
            />
            {editMode !== 'clock_out' && (
              <p style={styles.fieldHint}>Leave clock out blank if the employee is still on shift.</p>
            )}
            <label style={styles.label}>Notes</label>
            <textarea
              rows={2}
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              style={styles.textarea}
              placeholder="Optional manager note"
            />
            <div style={styles.modalActions}>
              {editRow.clockOut && editRow.timeClockId && (
                <button
                  type="button"
                  style={styles.dangerBtn}
                  onClick={handleClearClockOut}
                  disabled={saving}
                >
                  Delete clock out
                </button>
              )}
              <button type="button" style={styles.cancelBtn} onClick={closeEdit} disabled={saving}>
                Cancel
              </button>
              <button type="button" style={styles.saveBtn} onClick={handleSaveTimecard} disabled={saving}>
                {saving ? 'Saving…' : editMode === 'clock_out' ? 'Clock out' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', gap: TavariStyles.spacing.lg },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    gap: '8px',
    width: '100%',
  },
  headerRowSlot: {
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
  },
  headerRowSlotStart: {},
  headerRowSlotCenter: {},
  headerRowSlotEnd: {},
  headerTitle: {
    margin: 0,
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: 800,
    color: TavariStyles.colors.gray900,
    lineHeight: 1.2,
  },
  datePickerWrap: { display: 'flex', alignItems: 'center', gap: '8px' },
  datePickerLabel: { fontSize: '13px', fontWeight: 600, color: TavariStyles.colors.gray600 },
  dateInput: {
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '10px',
    padding: '8px 10px',
    fontSize: '14px',
    fontFamily: 'inherit',
    maxWidth: '100%',
    boxSizing: 'border-box',
  },
  dateNavBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '10px',
    background: '#fff',
    color: TavariStyles.colors.gray800,
    cursor: 'pointer',
    flexShrink: 0,
  },
  dateNavBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  sectionTitle: { margin: 0, fontSize: TavariStyles.typography.fontSize.lg, fontWeight: 800, color: TavariStyles.colors.gray900 },
  refreshBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '999px',
    padding: '8px 12px',
    background: '#fff',
    cursor: 'pointer',
    fontWeight: 600,
  },
  chartCard: {
    background: '#fff',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: '18px',
    padding: TavariStyles.spacing.lg,
  },
  chartRow: { display: 'flex', gap: '10px', alignItems: 'flex-end', minHeight: '160px' },
  chartColBtn: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    border: 'none',
    background: 'transparent',
    padding: '4px 2px',
    cursor: 'pointer',
    borderRadius: '10px',
  },
  chartCol: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' },
  chartAmount: { fontSize: '13px', fontWeight: 800, color: TavariStyles.colors.gray900, textAlign: 'center' },
  chartBarTrack: {
    width: '100%',
    height: '100px',
    background: TavariStyles.colors.gray100,
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'flex-end',
    overflow: 'hidden',
  },
  chartBarStack: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column-reverse',
    minHeight: '6px',
    borderRadius: '10px 10px 0 0',
    overflow: 'hidden',
  },
  chartBarSegment: {
    width: '100%',
    minHeight: '4px',
  },
  chartBar: { width: '100%', borderRadius: '10px 10px 0 0', minHeight: '6px', transition: 'height 0.2s ease' },
  chartLabel: { fontSize: '13px', color: TavariStyles.colors.gray600, fontWeight: 600 },
  chartLabelToday: { color: TavariStyles.colors.primary, fontWeight: 800 },
  chartLabelCalendarToday: { textDecoration: 'underline', textDecorationColor: TavariStyles.colors.gray400 },
  chartLegend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: TavariStyles.spacing.md,
    marginTop: TavariStyles.spacing.sm,
    fontSize: '13px',
    color: TavariStyles.colors.gray600,
  },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: '6px' },
  legendSwatch: {
    width: '12px',
    height: '12px',
    borderRadius: '3px',
    display: 'inline-block',
    flexShrink: 0,
  },
  metricCard: {
    background: '#fff',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: '16px',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    boxSizing: 'border-box',
    minWidth: 0,
  },
  metricLabel: { fontSize: '13px', color: TavariStyles.colors.gray600, lineHeight: 1.3 },
  metricValue: {
    fontSize: '23px',
    fontWeight: 800,
    color: TavariStyles.colors.gray900,
    lineHeight: 1.2,
  },
  metricFooter: {
    fontSize: '11px',
    color: TavariStyles.colors.gray500,
    lineHeight: 1.35,
    marginTop: '2px',
  },
  subsidyPanel: {
    background: '#fff',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: '14px',
    padding: TavariStyles.spacing.md,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  subsidyPanelTitle: {
    fontSize: '13px',
    fontWeight: 700,
    color: TavariStyles.colors.gray800,
    marginBottom: '4px',
  },
  subsidyRow: {
    padding: '8px 0',
    borderTop: `1px solid ${TavariStyles.colors.gray100}`,
  },
  subsidyRowName: { fontSize: '14px', fontWeight: 700, color: TavariStyles.colors.gray900 },
  subsidyPartner: { fontWeight: 500, color: TavariStyles.colors.gray600 },
  subsidyRowMeta: { fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: '2px' },
  subsidyRowStatus: { fontSize: '13px', color: TavariStyles.colors.gray700, marginTop: '2px' },
  subTitle: { margin: 0, fontSize: TavariStyles.typography.fontSize.base, fontWeight: 800, color: TavariStyles.colors.gray900 },
  empty: {
    padding: TavariStyles.spacing.lg,
    textAlign: 'center',
    color: TavariStyles.colors.gray600,
    background: TavariStyles.colors.gray50,
    borderRadius: '14px',
  },
  staffList: { display: 'flex', flexDirection: 'column', gap: '10px' },
  staffCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: TavariStyles.spacing.md,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: '14px',
    background: '#fff',
  },
  staffMain: { minWidth: 0 },
  staffNameRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  staffName: { fontWeight: 800, color: TavariStyles.colors.gray900 },
  sickBadge: {
    fontSize: '11px',
    fontWeight: 800,
    padding: '2px 8px',
    borderRadius: '999px',
    background: '#fef3c7',
    color: '#92400e',
  },
  noShowBadge: {
    fontSize: '11px',
    fontWeight: 800,
    padding: '2px 8px',
    borderRadius: '999px',
    background: '#fee2e2',
    color: '#991b1b',
  },
  inBadge: {
    fontSize: '11px',
    fontWeight: 800,
    padding: '2px 8px',
    borderRadius: '999px',
    background: '#d1fae5',
    color: '#065f46',
  },
  staffMeta: { fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: '4px' },
  staffActions: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  sickBtn: {
    border: '1px solid #fecaca',
    background: '#fef2f2',
    color: '#b91c1c',
    borderRadius: '10px',
    padding: '8px 12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  editBtn: {
    border: `1px solid ${TavariStyles.colors.gray300}`,
    background: '#fff',
    color: TavariStyles.colors.gray800,
    borderRadius: '10px',
    padding: '8px 12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  clockInBtn: {
    border: '1px solid #a7f3d0',
    background: '#ecfdf5',
    color: '#047857',
    borderRadius: '10px',
    padding: '8px 12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  clockOutBtn: {
    border: '1px solid #bfdbfe',
    background: '#eff6ff',
    color: '#1d4ed8',
    borderRadius: '10px',
    padding: '8px 12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  loading: { padding: TavariStyles.spacing.xl, textAlign: 'center', color: TavariStyles.colors.gray600 },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15,23,42,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    zIndex: 2000,
  },
  modal: {
    width: '100%',
    maxWidth: '420px',
    minWidth: 0,
    background: '#fff',
    borderRadius: '16px',
    padding: TavariStyles.spacing.lg,
    boxShadow: TavariStyles.shadows?.lg || '0 20px 40px rgba(0,0,0,0.15)',
    boxSizing: 'border-box',
    overflow: 'hidden',
  },
  modalTitle: { margin: '0 0 12px', fontSize: '18px', fontWeight: 800 },
  label: { display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '4px', color: TavariStyles.colors.gray700 },
  fieldHint: {
    margin: '0 0 12px',
    fontSize: '13px',
    color: TavariStyles.colors.gray500,
    lineHeight: 1.4,
  },
  input: {
    display: 'block',
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '10px',
    padding: '10px',
    marginBottom: '12px',
    fontSize: '16px',
    fontFamily: 'inherit',
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '10px',
    padding: '10px',
    marginBottom: '12px',
    fontFamily: 'inherit',
  },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' },
  cancelBtn: {
    border: `1px solid ${TavariStyles.colors.gray300}`,
    background: '#fff',
    borderRadius: '10px',
    padding: '10px 14px',
    cursor: 'pointer',
  },
  dangerBtn: {
    border: '1px solid #fecaca',
    background: '#fef2f2',
    color: '#b91c1c',
    borderRadius: '10px',
    padding: '10px 14px',
    cursor: 'pointer',
    marginRight: 'auto',
  },
  saveBtn: {
    border: 'none',
    background: TavariStyles.colors.primary,
    color: '#fff',
    borderRadius: '10px',
    padding: '10px 14px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  salesModal: {
    width: '100%',
    maxWidth: '440px',
    minWidth: 0,
    background: '#fff',
    borderRadius: '16px',
    padding: TavariStyles.spacing.lg,
    boxShadow: TavariStyles.shadows?.lg || '0 20px 40px rgba(0,0,0,0.15)',
    boxSizing: 'border-box',
    maxHeight: '90vh',
    overflowY: 'auto',
  },
  salesModalLoading: {
    padding: TavariStyles.spacing.lg,
    textAlign: 'center',
    color: TavariStyles.colors.gray600,
  },
  salesModalTotal: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 14px',
    marginBottom: TavariStyles.spacing.md,
    background: TavariStyles.colors.gray50,
    borderRadius: '12px',
    fontSize: '15px',
    color: TavariStyles.colors.gray700,
  },
  salesModalSectionTitle: {
    margin: '0 0 8px',
    fontSize: '13px',
    fontWeight: 800,
    color: TavariStyles.colors.gray800,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  salesModalEmpty: {
    margin: '0 0 12px',
    fontSize: '13px',
    color: TavariStyles.colors.gray500,
  },
  salesProcessorBlock: {
    marginBottom: TavariStyles.spacing.md,
    padding: '10px 12px',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: '12px',
    background: '#fff',
  },
  salesProcessorHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontWeight: 700,
    fontSize: '14px',
    color: TavariStyles.colors.gray900,
    marginBottom: '6px',
  },
  tenderList: { display: 'flex', flexDirection: 'column', gap: '4px' },
  tenderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
    color: TavariStyles.colors.gray600,
    padding: '2px 0',
  },
  tenderRowTotal: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '15px',
    color: TavariStyles.colors.gray900,
    padding: '8px 12px',
    background: TavariStyles.colors.gray50,
    borderRadius: '10px',
    marginBottom: '4px',
  },
};

export default PortalManagerDashboard;
