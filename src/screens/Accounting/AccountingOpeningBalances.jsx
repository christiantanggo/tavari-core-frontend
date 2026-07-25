import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { FiArrowLeft, FiPlus, FiTrash2, FiUpload } from 'react-icons/fi';
import { logAccountingEvent } from './accountingAudit';

function parseTbCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const split = (line) => {
    const cols = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        cols.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    cols.push(cur.trim());
    return cols;
  };
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const accountIdx = header.findIndex((h) => /account|gl|name/.test(h));
  const debitIdx = header.findIndex((h) => /debit|dr/.test(h));
  const creditIdx = header.findIndex((h) => /credit|cr/.test(h));
  const hasHeader = accountIdx >= 0 || debitIdx >= 0 || creditIdx >= 0;
  const start = hasHeader ? 1 : 0;
  const aI = hasHeader && accountIdx >= 0 ? accountIdx : 0;
  const dI = hasHeader && debitIdx >= 0 ? debitIdx : 1;
  const cI = hasHeader && creditIdx >= 0 ? creditIdx : 2;
  const rows = [];
  for (let i = start; i < lines.length; i += 1) {
    const cols = split(lines[i]);
    const account = (cols[aI] || '').trim();
    if (!account || /^total/i.test(account)) continue;
    const debit = Math.abs(parseFloat(String(cols[dI] || '0').replace(/[$,]/g, '')) || 0);
    const credit = Math.abs(parseFloat(String(cols[cI] || '0').replace(/[$,]/g, '')) || 0);
    if (debit <= 0 && credit <= 0) continue;
    rows.push({ accountHint: account, account: '', debit: debit || '', credit: credit || '' });
  }
  return rows;
}

function scoreMatch(hint, account) {
  const h = String(hint || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const full = String(account.name || '').toLowerCase();
  const short = String(account.account_name || '').toLowerCase();
  if (!h) return 0;
  if (short === h || full === h) return 100;
  if (short.includes(h) || h.includes(short)) return 80;
  if (full.includes(h)) return 60;
  const tokens = h.split(' ').filter(Boolean);
  const hits = tokens.filter((t) => short.includes(t) || full.includes(t)).length;
  return hits ? (hits / tokens.length) * 40 : 0;
}

export default function AccountingOpeningBalances({ embedded = false }) {
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const { authLoading } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'AccountingOpeningBalances',
  });
  const [accounts, setAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [posting, setPosting] = useState(false);
  const [asOfDate, setAsOfDate] = useState('2025-05-01');
  const [remark, setRemark] = useState('Opening balances (QBO cutover)');
  const [rows, setRows] = useState([{ accountHint: '', account: '', debit: '', credit: '' }]);

  const loadAccounts = useCallback(async () => {
    if (!selectedBusinessId) return;
    setLoadingAccounts(true);
    try {
      const { data, error } = await supabase.functions.invoke('accounting-list-accounts', {
        body: { business_id: selectedBusinessId },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Failed to load accounts');
      setAccounts(Array.isArray(data?.accounts) ? data.accounts.filter((a) => !a.is_group) : []);
    } catch (e) {
      toast.error(e?.message || 'Failed to load accounts');
      setAccounts([]);
    } finally {
      setLoadingAccounts(false);
    }
  }, [selectedBusinessId]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const autoMap = useCallback((nextRows, ledger) => {
    return nextRows.map((row) => {
      if (row.account) return row;
      let best = null;
      let bestScore = 0;
      for (const acct of ledger) {
        const score = scoreMatch(row.accountHint, acct);
        if (score > bestScore) {
          bestScore = score;
          best = acct;
        }
      }
      return bestScore >= 40 && best ? { ...row, account: best.name } : row;
    });
  }, []);

  useEffect(() => {
    if (accounts.length === 0) return;
    setRows((prev) => autoMap(prev, accounts));
  }, [accounts, autoMap]);

  const totalDebit = rows.reduce((s, r) => s + (parseFloat(r.debit) || 0), 0);
  const totalCredit = rows.reduce((s, r) => s + (parseFloat(r.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.02 && totalDebit > 0;
  const unmapped = useMemo(() => rows.filter((r) => (parseFloat(r.debit) || parseFloat(r.credit)) && !r.account).length, [rows]);

  const setRow = (idx, field, value) => setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));
  const addRow = () => setRows((prev) => [...prev, { accountHint: '', account: '', debit: '', credit: '' }]);
  const removeRow = (idx) => setRows((prev) => prev.filter((_, i) => i !== idx));

  const onCsv = async (file) => {
    if (!file) return;
    const text = await file.text();
    const parsed = parseTbCsv(text);
    if (parsed.length === 0) {
      toast.error('No trial balance rows found. Use CSV columns: account, debit, credit');
      return;
    }
    setRows(autoMap(parsed, accounts));
    toast.success(`Loaded ${parsed.length} rows from CSV`);
  };

  const handlePost = async () => {
    if (!selectedBusinessId || !balanced) {
      toast.error('Debits and credits must balance and be non-zero.');
      return;
    }
    if (unmapped > 0) {
      toast.error(`Map ${unmapped} account(s) to ERPNext ledger accounts first.`);
      return;
    }
    const accountRows = rows
      .map((r) => ({
        account: r.account.trim(),
        debit: parseFloat(r.debit) || 0,
        credit: parseFloat(r.credit) || 0,
      }))
      .filter((r) => r.account && (r.debit > 0 || r.credit > 0));
    setPosting(true);
    try {
      const { data, error } = await supabase.functions.invoke('accounting-post-journal', {
        body: {
          business_id: selectedBusinessId,
          posting_date: asOfDate,
          remark: remark || `Opening balances as of ${asOfDate}`,
          voucher_type: 'Opening Entry',
          accounts: accountRows,
        },
      });
      if (data?.error || error) throw new Error(data?.error || error?.message || 'Post failed');
      toast.success(`Opening entry posted: ${data.erpnext_journal_entry_id || 'OK'}`);
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'opening_balances_posted',
        entityType: 'journal_entry',
        entityId: data.erpnext_journal_entry_id || null,
        details: { as_of: asOfDate, line_count: accountRows.length, total: totalDebit },
      });
      setRows([{ accountHint: '', account: '', debit: '', credit: '' }]);
    } catch (e) {
      toast.error(e?.message || 'Failed to post opening balances');
    } finally {
      setPosting(false);
    }
  };

  if (authLoading || !selectedBusinessId) {
    return <div style={{ padding: 48, textAlign: 'center' }}>Loading...</div>;
  }

  return (
    <div style={{ padding: embedded ? 0 : 24, paddingTop: embedded ? 0 : 80 }}>
      {!embedded && (
        <button type="button" style={{ marginBottom: 16, cursor: 'pointer' }} onClick={() => navigate('/dashboard/accounting/setup/vendors')}>
          <FiArrowLeft /> Back to Setup
        </button>
      )}
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 8px' }}>Opening Balances</h1>
      <p style={{ color: TavariStyles?.colors?.gray600 || '#6b7280', fontSize: 14, marginBottom: 16, maxWidth: 720 }}>
        Import a trial balance CSV (account, debit, credit) as of the start of the fiscal year, map each line to an ERPNext
        account, then post one Opening Entry. For Tanggo Companies: use YE2025 closing balances as of <strong>2025-05-01</strong>.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          As-of / posting date
          <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, flex: 1, minWidth: 220 }}>
          Remark
          <input type="text" value={remark} onChange={(e) => setRemark(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ ...btnSecondary, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <FiUpload /> Upload TB CSV
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => onCsv(e.target.files?.[0])} />
        </label>
        <button type="button" onClick={loadAccounts} disabled={loadingAccounts} style={btnSecondary}>
          Refresh accounts
        </button>
      </div>

      <div style={{ overflowX: 'auto', marginBottom: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={thStyle}>CSV / hint</th>
              <th style={thStyle}>ERPNext account</th>
              <th style={thStyle}>Debit</th>
              <th style={thStyle}>Credit</th>
              <th style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={tdStyle}>
                  <input value={row.accountHint} onChange={(e) => setRow(idx, 'accountHint', e.target.value)} placeholder="From TB" style={inputStyle} />
                </td>
                <td style={tdStyle}>
                  <select value={row.account} onChange={(e) => setRow(idx, 'account', e.target.value)} style={{ ...inputStyle, minWidth: 240 }}>
                    <option value="">Select account…</option>
                    {accounts.map((a) => (
                      <option key={a.name} value={a.name}>{a.name}</option>
                    ))}
                  </select>
                </td>
                <td style={tdStyle}>
                  <input type="number" step="0.01" min="0" value={row.debit} onChange={(e) => setRow(idx, 'debit', e.target.value)} style={{ ...inputStyle, width: 110 }} />
                </td>
                <td style={tdStyle}>
                  <input type="number" step="0.01" min="0" value={row.credit} onChange={(e) => setRow(idx, 'credit', e.target.value)} style={{ ...inputStyle, width: 110 }} />
                </td>
                <td style={tdStyle}>
                  <button type="button" onClick={() => removeRow(idx)} style={{ ...btnSecondary, padding: '6px 8px' }} aria-label="Remove row">
                    <FiTrash2 />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <button type="button" onClick={addRow} style={btnSecondary}><FiPlus /> Add row</button>
        <span style={{ fontSize: 13, color: balanced ? '#047857' : '#b45309' }}>
          Debit ${totalDebit.toFixed(2)} · Credit ${totalCredit.toFixed(2)}
          {unmapped > 0 ? ` · ${unmapped} unmapped` : ''}
        </span>
        <button type="button" onClick={handlePost} disabled={posting || !balanced || unmapped > 0} style={btnPrimary}>
          {posting ? 'Posting…' : 'Post opening entry'}
        </button>
      </div>
    </div>
  );
}

const inputStyle = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  fontSize: 14,
};
const thStyle = { textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: '#374151' };
const tdStyle = { padding: '8px 10px', verticalAlign: 'middle' };
const btnSecondary = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  background: '#fff',
  cursor: 'pointer',
  fontSize: 13,
};
const btnPrimary = {
  ...btnSecondary,
  background: '#0f766e',
  borderColor: '#0f766e',
  color: '#fff',
  fontWeight: 600,
};
