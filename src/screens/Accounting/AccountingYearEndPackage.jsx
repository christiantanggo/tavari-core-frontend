import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { FiDownload, FiPackage } from 'react-icons/fi';
import { logAccountingEvent } from './accountingAudit';

function escapeCsvCell(value) {
  const str = value == null ? '' : String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function rowsToCsv(rows, columns) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const colDefs = Array.isArray(columns) && columns.length > 0
    ? columns
    : Object.keys(rows[0] || {}).map((key) => ({ fieldname: key, label: key }));
  const header = colDefs.map((col) => escapeCsvCell(col.label ?? col.fieldname ?? '')).join(',');
  const body = rows.map((row) =>
    colDefs.map((col, index) => escapeCsvCell(Array.isArray(row) ? row[index] : row?.[col.fieldname])).join(',')
  );
  return [header, ...body].join('\n');
}

function downloadFile(filename, content, contentType) {
  const blob = new Blob([content], { type: contentType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function fiscalDefaults(month = 4, day = 30) {
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  // Prefer the most recently completed fiscal year (or the one ending today).
  let endYear = today.getFullYear();
  const endThisCalendarYear = new Date(endYear, month - 1, day);
  if (today < endThisCalendarYear) endYear -= 1;
  const end = new Date(endYear, month - 1, day);
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 1);
  start.setDate(start.getDate() + 1);
  return {
    fromDate: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    toDate: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`,
  };
}

export default function AccountingYearEndPackage({ embedded = false }) {
  const { selectedBusinessId } = useBusinessContext();
  usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'AccountingYearEndPackage',
  });
  const [fromDate, setFromDate] = useState('2025-05-01');
  const [toDate, setToDate] = useState('2026-04-30');
  const [loading, setLoading] = useState(false);
  const [companyLabel, setCompanyLabel] = useState('');

  useEffect(() => {
    if (!selectedBusinessId) return;
    supabase
      .from('accounting_business_config')
      .select('erpnext_company_name, fiscal_year_end_month, fiscal_year_end_day')
      .eq('business_id', selectedBusinessId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setCompanyLabel(data.erpnext_company_name || '');
        const defaults = fiscalDefaults(data.fiscal_year_end_month ?? 4, data.fiscal_year_end_day ?? 30);
        setFromDate(defaults.fromDate);
        setToDate(defaults.toDate);
      });
  }, [selectedBusinessId]);

  const fetchReport = useCallback(async (reportType) => {
    const { data, error } = await supabase.functions.invoke('accounting-erpnext-report', {
      body: {
        business_id: selectedBusinessId,
        report_type: reportType,
        from_date: fromDate,
        to_date: toDate,
      },
    });
    if (error || data?.error) throw new Error(data?.error || error?.message || `Failed ${reportType}`);
    return data;
  }, [selectedBusinessId, fromDate, toDate]);

  const downloadPackage = async () => {
    if (!selectedBusinessId) return;
    setLoading(true);
    try {
      const [pl, bs, tb] = await Promise.all([
        fetchReport('pl'),
        fetchReport('balance_sheet'),
        fetchReport('trial_balance'),
      ]);
      const slug = (companyLabel || 'company').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'company';
      const prefix = `year-end-${slug}-${fromDate}-to-${toDate}`;

      const plCsv = rowsToCsv(pl?.result || pl?.pl?.result || [], pl?.columns || pl?.pl?.columns || []);
      const bsCsv = rowsToCsv(bs?.result || bs?.balance_sheet?.result || [], bs?.columns || bs?.balance_sheet?.columns || []);
      const tbCsv = rowsToCsv(tb?.result || tb?.trial_balance?.result || [], tb?.columns || tb?.trial_balance?.columns || []);

      downloadFile(`${prefix}-profit-and-loss.csv`, plCsv || 'No data\n', 'text/csv;charset=utf-8');
      downloadFile(`${prefix}-balance-sheet.csv`, bsCsv || 'No data\n', 'text/csv;charset=utf-8');
      downloadFile(`${prefix}-trial-balance.csv`, tbCsv || 'No data\n', 'text/csv;charset=utf-8');

      const readme = [
        'Tavari Accounting — Year-end package',
        `Company: ${companyLabel || selectedBusinessId}`,
        `Period: ${fromDate} to ${toDate}`,
        '',
        'Files:',
        `- ${prefix}-profit-and-loss.csv`,
        `- ${prefix}-balance-sheet.csv`,
        `- ${prefix}-trial-balance.csv`,
        '',
        'Import these into Future Tax (or your tax software) for T2 / year-end filing.',
        'CRA filing remains external — Tavari does not auto-submit to CRA.',
      ].join('\n');
      downloadFile(`${prefix}-README.txt`, readme, 'text/plain;charset=utf-8');

      toast.success('Year-end package downloaded (P&L, Balance Sheet, Trial Balance + README)');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'year_end_package_exported',
        entityType: 'accounting_report',
        entityId: `${fromDate}_${toDate}`,
        details: { from_date: fromDate, to_date: toDate },
      });
    } catch (e) {
      toast.error(e?.message || 'Failed to build year-end package');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: embedded ? 0 : 24 }}>
      <div style={{ ...cardStyle, maxWidth: 640 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
          <FiPackage size={22} color="#0f766e" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <h2 style={{ margin: '0 0 6px', fontSize: '1.1rem' }}>Year-end package</h2>
            <p style={{ margin: 0, color: TavariStyles?.colors?.gray600 || '#6b7280', fontSize: 13, lineHeight: 1.5 }}>
              Download P&amp;L, Balance Sheet, and Trial Balance CSVs for a custom fiscal range
              (Tanggo: 2025-05-01 → 2026-04-30). Use these exports in Future Tax. CRA stays external.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <label style={labelStyle}>
            From
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            To
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={inputStyle} />
          </label>
        </div>
        <button type="button" onClick={downloadPackage} disabled={loading || !selectedBusinessId} style={btnPrimary}>
          <FiDownload /> {loading ? 'Building…' : 'Download year-end package'}
        </button>
      </div>
    </div>
  );
}

const cardStyle = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 20,
  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
};
const labelStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 };
const inputStyle = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  fontSize: 14,
};
const btnPrimary = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 14px',
  borderRadius: 8,
  border: '1px solid #0f766e',
  background: '#0f766e',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 14,
};
