import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useFilingReadiness, currentQuarterRange } from '../../hooks/useFilingReadiness';
import { TavariStyles } from '../../utils/TavariStyles';
import {
  buildCraFilingPackageHtml,
  downloadCraFilingPackage,
  openCraFilingPackagePrint,
  gst34WorksheetRows
} from '../../utils/accountingFilingPackage';
import toast from 'react-hot-toast';
import { FiArrowLeft, FiDownload, FiPrinter, FiRefreshCw } from 'react-icons/fi';
import { logAccountingEvent } from './accountingAudit';

const STATUS_COLORS = {
  pass: { bg: '#ecfdf5', border: '#a7f3d0', fg: '#047857' },
  warn: { bg: '#fffbeb', border: '#fde68a', fg: '#b45309' },
  fail: { bg: '#fef2f2', border: '#fecaca', fg: '#b91c1c' }
};

const AccountingFilingReconciliation = ({ embedded = false }) => {
  const navigate = useNavigate();
  const { selectedBusinessId, selectedBusiness } = useBusinessContext();
  const { authLoading } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'AccountingFilingReconciliation'
  });

  const quarter = currentQuarterRange();
  const [fromDate, setFromDate] = useState(quarter.fromDate);
  const [toDate, setToDate] = useState(quarter.toDate);
  const [exporting, setExporting] = useState(false);
  const { loading, error, result, filingReady, filingStatus, checks, runChecks } = useFilingReadiness(selectedBusinessId);

  const refresh = useCallback(async () => {
    if (!selectedBusinessId) return;
    await runChecks(fromDate, toDate);
  }, [selectedBusinessId, fromDate, toDate, runChecks]);

  useEffect(() => {
    if (!selectedBusinessId || authLoading) return;
    refresh();
  }, [selectedBusinessId, authLoading, refresh]);

  const exportCraPackage = async (mode = 'download') => {
    if (!selectedBusinessId) return;
    setExporting(true);
    try {
      const filing = result || await runChecks(fromDate, toDate);
      if (!filing) {
        toast.error('Run filing checks first');
        return;
      }
      if (!filing.filing_ready && filing.filing_status === 'blocked') {
        const proceed = window.confirm(
          'Some filing checks failed (HST mapping or trial balance). Export anyway for review?'
        );
        if (!proceed) return;
      } else if (!filing.filing_ready) {
        const proceed = window.confirm(
          'Filing checks have warnings. Export CRA package anyway?'
        );
        if (!proceed) return;
      }

      const { data: craData, error: craErr } = await supabase.functions.invoke('accounting-erpnext-report', {
        body: {
          business_id: selectedBusinessId,
          report_type: 'cra_summary',
          from_date: fromDate,
          to_date: toDate
        }
      });
      if (craErr) throw craErr;
      if (craData?.error) throw new Error(craData.error);

      const { data: tbData, error: tbErr } = await supabase.functions.invoke('accounting-erpnext-report', {
        body: {
          business_id: selectedBusinessId,
          report_type: 'trial_balance',
          from_date: fromDate,
          to_date: toDate
        }
      });
      if (tbErr) throw tbErr;

      const html = buildCraFilingPackageHtml({
        businessName: selectedBusiness?.name,
        businessId: selectedBusinessId,
        fromDate,
        toDate,
        filingStatus: filing.filing_status,
        filingReady: filing.filing_ready,
        checks: filing.checks,
        worksheet: filing.worksheet,
        hstSummary: filing.hst_summary,
        hstAdjustmentSchedule: filing.hst_adjustment_schedule,
        pl: craData?.pl || {},
        balanceSheet: craData?.balance_sheet || {},
        trialBalance: tbData || {},
        gst34Warnings: filing.gst34_warnings
      });

      const filename = `cra-filing-package-${fromDate}-to-${toDate}.html`;
      if (mode === 'print') {
        if (!openCraFilingPackagePrint(html)) {
          downloadCraFilingPackage(html, filename);
          toast.success('Pop-up blocked — downloaded HTML instead');
        }
      } else {
        downloadCraFilingPackage(html, filename);
        toast.success('CRA filing package downloaded');
      }

      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'cra_filing_package_exported',
        entityType: 'accounting_filing',
        entityId: `${fromDate}_${toDate}`,
        details: { filing_ready: filing.filing_ready, filing_status: filing.filing_status, mode }
      });
    } catch (e) {
      toast.error(e?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  if (authLoading || !selectedBusinessId) {
    return <div style={{ padding: 48, textAlign: 'center' }}>Loading...</div>;
  }

  const worksheetRows = gst34WorksheetRows(result?.worksheet || {});
  const hstSchedule = result?.hst_adjustment_schedule;
  const statusBanner = filingReady
    ? { bg: '#ecfdf5', fg: '#047857', text: 'Ready — numbers reconcile for this period' }
    : filingStatus === 'blocked'
      ? { bg: '#fef2f2', fg: '#b91c1c', text: 'Blocked — fix failed checks before filing' }
      : { bg: '#fffbeb', fg: '#b45309', text: 'Review — warnings need attention before filing' };

  return (
    <div style={{ padding: embedded ? 0 : 24, paddingTop: embedded ? 0 : 80 }}>
      {!embedded && (
        <button type="button" style={{ marginBottom: 16, cursor: 'pointer' }} onClick={() => navigate('/dashboard/accounting')}>
          <FiArrowLeft /> Back
        </button>
      )}

      <h1 style={{ fontSize: '1.25rem', marginBottom: 8 }}>Filing Reconciliation</h1>
      <p style={{ color: TavariStyles?.colors?.gray600, marginBottom: 16, fontSize: 14, maxWidth: 720 }}>
        Verify HST mapping, queue clearance, and GL reconciliation before exporting your CRA filing package. Use this hub to confirm numbers match Tavari postings and ERPNext before handoff to your accountant or CRA web forms.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 20 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          From
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          To
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }} />
        </label>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', cursor: loading ? 'wait' : 'pointer', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8 }}
        >
          <FiRefreshCw /> {loading ? 'Checking…' : 'Run checks'}
        </button>
        <button
          type="button"
          onClick={() => exportCraPackage('download')}
          disabled={exporting || loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', cursor: exporting ? 'wait' : 'pointer', background: '#ecfeff', color: '#155e75', border: '1px solid #a5f3fc', borderRadius: 8 }}
        >
          <FiDownload /> {exporting ? 'Exporting…' : 'Export CRA package'}
        </button>
        <button
          type="button"
          onClick={() => exportCraPackage('print')}
          disabled={exporting || loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', cursor: exporting ? 'wait' : 'pointer', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8 }}
        >
          <FiPrinter /> Print / PDF
        </button>
      </div>

      {error && (
        <p style={{ color: TavariStyles?.colors?.red || '#dc2626', marginBottom: 16 }}>{error}</p>
      )}

      {result && (
        <>
          <div style={{ padding: 14, borderRadius: 8, marginBottom: 20, background: statusBanner.bg, color: statusBanner.fg, fontWeight: 600 }}>
            {statusBanner.text}
          </div>

          <div style={{ display: 'grid', gap: 12, marginBottom: 24 }}>
            {(checks || []).map((c) => {
              const tone = STATUS_COLORS[c.status] || STATUS_COLORS.warn;
              return (
                <div
                  key={c.id}
                  style={{
                    padding: 14,
                    borderRadius: 8,
                    border: `1px solid ${tone.border}`,
                    background: tone.bg
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                    <strong style={{ color: tone.fg }}>{c.title}</strong>
                    <span style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', color: tone.fg }}>{c.status}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 14, color: '#374151' }}>{c.message}</p>
                </div>
              );
            })}
          </div>

          {worksheetRows.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: '1rem', marginBottom: 10 }}>GST34 worksheet preview</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>Box</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>CRA line</th>
                    <th style={{ textAlign: 'right', padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {worksheetRows.map((row) => (
                    <tr key={row.box}>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6' }}>{row.box.replace('box_', '')}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6' }}>{row.label}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>${row.value.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(result.gst34_warnings || []).length > 0 && (
            <div style={{ padding: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, marginBottom: 16 }}>
              <strong style={{ display: 'block', marginBottom: 6 }}>GST34 notes</strong>
              <ul style={{ margin: 0, paddingLeft: 18, color: '#92400e', fontSize: 13 }}>
                {result.gst34_warnings.map((w, i) => <li key={`w-${i}`}>{w}</li>)}
              </ul>
            </div>
          )}

          {hstSchedule && (
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>HST collected adjustment schedule</h2>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: '#4b5563', maxWidth: 720 }}>
                Why Box 103 may differ from {((hstSchedule.standard_hst_rate || 0.13) * 100).toFixed(1)}% of sales.
                HST reduction = full HST minus tax actually collected.
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 16 }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>Category</th>
                    <th style={{ textAlign: 'right', padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>Count</th>
                    <th style={{ textAlign: 'right', padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>Subtotal</th>
                    <th style={{ textAlign: 'right', padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>Tax collected</th>
                    <th style={{ textAlign: 'right', padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>HST reduction</th>
                  </tr>
                </thead>
                <tbody>
                  {(hstSchedule.summary || []).map((row) => (
                    <tr key={row.id}>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6' }}>
                        <div>{row.label}</div>
                        <div style={{ fontSize: 13, color: '#6b7280' }}>{row.description}</div>
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>{row.transaction_count}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>${row.subtotal.toFixed(2)}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>${row.tax_collected.toFixed(2)}</td>
                      <td style={{ padding: '10px 12px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>${row.hst_reduction.toFixed(2)}</td>
                    </tr>
                  ))}
                  {hstSchedule.totals && (
                    <tr style={{ fontWeight: 600, background: '#f0fdfa' }}>
                      <td style={{ padding: '10px 12px' }}>Total</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>{hstSchedule.totals.transaction_count}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>${hstSchedule.totals.subtotal.toFixed(2)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>${hstSchedule.totals.tax_collected.toFixed(2)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>${hstSchedule.totals.hst_reduction.toFixed(2)}</td>
                    </tr>
                  )}
                </tbody>
              </table>

              {(hstSchedule.indian_status_transactions || []).length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Indian Status transactions</h3>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
                    <thead>
                      <tr style={{ background: '#f9fafb' }}>
                        <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }}>Date</th>
                        <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }}>Source</th>
                        <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }}>Cert #</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }}>Subtotal</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }}>Tax</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }}>HST reduction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hstSchedule.indian_status_transactions.map((row) => (
                        <tr key={`${row.source_type}-${row.source_id}`}>
                          <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6' }}>{row.transaction_date}</td>
                          <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6' }}>{row.source_type}</td>
                          <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6' }}>{row.certificate_number || '—'}</td>
                          <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>${row.subtotal.toFixed(2)}</td>
                          <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>${row.tax_collected.toFixed(2)}</td>
                          <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>${row.hst_reduction.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {(hstSchedule.zero_tax_transactions || []).length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>
                    Zero-tax transactions
                    {hstSchedule.zero_tax_total_count > hstSchedule.zero_tax_transactions.length
                      ? ` (showing ${hstSchedule.zero_tax_transactions.length} of ${hstSchedule.zero_tax_total_count})`
                      : ''}
                  </h3>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f9fafb' }}>
                        <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }}>Date</th>
                        <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }}>Source</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }}>Subtotal</th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }}>HST reduction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hstSchedule.zero_tax_transactions.slice(0, 25).map((row) => (
                        <tr key={`z-${row.source_type}-${row.source_id}`}>
                          <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6' }}>{row.transaction_date}</td>
                          <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6' }}>{row.source_type}</td>
                          <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>${row.subtotal.toFixed(2)}</td>
                          <td style={{ padding: '8px 10px', borderBottom: '1px solid #f3f4f6', textAlign: 'right' }}>${row.hst_reduction.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
        </>
      )}

      {!loading && !result && !error && (
        <p style={{ color: TavariStyles?.colors?.gray600 }}>Select a period and run checks.</p>
      )}
    </div>
  );
};

export default AccountingFilingReconciliation;
