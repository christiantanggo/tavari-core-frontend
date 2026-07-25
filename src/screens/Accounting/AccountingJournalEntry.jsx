import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { FiArrowLeft, FiPlus, FiTrash2 } from 'react-icons/fi';
import { logAccountingEvent } from './accountingAudit';
import { getCurrentBusinessDate } from '../../utils/businessDateFormat';

const AccountingJournalEntry = ({ embedded = false }) => {
  const navigate = useNavigate();
  const { selectedBusinessId, selectedBusiness } = useBusinessContext();
  const { authLoading } = usePOSAuth({ requiredRoles: ['owner', 'manager', 'admin'], requireBusiness: true, componentName: 'AccountingJournalEntry' });
  const [accounts, setAccounts] = useState([]);
  const [accountsLoadError, setAccountsLoadError] = useState('');
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postingDate, setPostingDate] = useState(() => getCurrentBusinessDate(selectedBusiness?.timezone));
  const [remark, setRemark] = useState('');
  const [rows, setRows] = useState([{ account: '', debit: '', credit: '' }]);

  useEffect(() => {
    if (!selectedBusinessId) return;
    setLoadingAccounts(true);
    setAccountsLoadError('');
    supabase.functions.invoke('accounting-list-accounts', { body: { business_id: selectedBusinessId } })
      .then(({ data, error }) => {
        if (Array.isArray(data?.accounts)) {
          setAccounts(data.accounts);
          if (data.accounts.length === 0) {
            setAccountsLoadError('No ERPNext ledger accounts were returned for this business. Check Accounting Settings and your ERPNext company setup.');
          }
        } else {
          setAccounts([]);
        }
        if (data?.error) {
          setAccountsLoadError(data.error);
          toast.error(data.error);
        }
        if (error) {
          setAccountsLoadError(error.message || 'Failed to load ERPNext accounts');
          toast.error(error.message);
        }
      })
      .finally(() => setLoadingAccounts(false));
  }, [selectedBusinessId]);

  const addRow = () => setRows((r) => [...r, { account: '', debit: '', credit: '' }]);
  const removeRow = (idx) => setRows((r) => r.filter((_, i) => i !== idx));
  const setRow = (idx, field, value) => setRows((r) => r.map((row, i) => i === idx ? { ...row, [field]: value } : row));

  const totalDebit = rows.reduce((s, r) => s + (parseFloat(r.debit) || 0), 0);
  const totalCredit = rows.reduce((s, r) => s + (parseFloat(r.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const handlePost = useCallback(async () => {
    if (!selectedBusinessId || !balanced || totalDebit === 0) {
      toast.error('Entries must balance (total debit = total credit) and be non-zero.');
      return;
    }
    const accountRows = rows
      .map((r) => ({ account: r.account.trim(), debit: parseFloat(r.debit) || 0, credit: parseFloat(r.credit) || 0 }))
      .filter((r) => r.account && (r.debit > 0 || r.credit > 0));
    if (accountRows.length === 0) {
      toast.error('Add at least one line with account and amount.');
      return;
    }
    setPosting(true);
    try {
      const { data, error } = await supabase.functions.invoke('accounting-post-journal', {
        body: {
          business_id: selectedBusinessId,
          posting_date: postingDate,
          remark: remark || 'Manual adjustment',
          accounts: accountRows
        }
      });
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      if (error) {
        toast.error(error?.message || 'Failed to post');
        return;
      }
      toast.success(`Posted ${data?.erpnext_journal_entry_id || 'journal entry'}`);
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'journal_entry_posted',
        entityType: 'erpnext_journal_entry',
        entityId: data?.erpnext_journal_entry_id || null,
        details: { posting_date: postingDate, remark: remark || 'Manual adjustment', line_count: accountRows.length }
      });
      setRemark('');
      setRows([{ account: '', debit: '', credit: '' }]);
    } catch (e) {
      toast.error(e?.message || 'Failed to post');
    } finally {
      setPosting(false);
    }
  }, [selectedBusinessId, postingDate, remark, rows, balanced, totalDebit]);

  if (authLoading || !selectedBusinessId) return <div style={{ padding: 48, textAlign: 'center' }}>Loading...</div>;

  return (
    <div style={{ padding: embedded ? 0 : 24, paddingTop: embedded ? 0 : 80 }}>
      {!embedded && (
        <button type="button" style={{ marginBottom: 16, cursor: 'pointer' }} onClick={() => navigate('/dashboard/accounting')}>
          <FiArrowLeft /> Back
        </button>
      )}
      <h1 style={{ fontSize: '1.25rem', marginBottom: 16 }}>Manual Journal Entry</h1>
      <p style={{ color: TavariStyles?.colors?.gray600, marginBottom: 16, fontSize: 14 }}>
        Post an adjusting or manual entry to ERPNext. Entries must balance (total debits = total credits).
      </p>
      {accountsLoadError && (
        <p style={{ color: TavariStyles?.colors?.red || '#dc2626', marginBottom: 16, fontSize: 14 }}>
          {accountsLoadError}
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Posting date
          <input type="date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} style={{ padding: 6, borderRadius: 6, border: '1px solid #d1d5db' }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 280 }}>
          Remark
          <input type="text" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="e.g. Year-end adjustment" style={{ flex: 1, padding: 6, borderRadius: 6, border: '1px solid #d1d5db' }} />
        </label>
      </div>

      <table style={{ width: '100%', maxWidth: 720, borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left', padding: 8 }}>Account</th>
            <th style={{ textAlign: 'right', padding: 8, width: 120 }}>Debit</th>
            <th style={{ textAlign: 'right', padding: 8, width: 120 }}>Credit</th>
            <th style={{ width: 48 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 8 }}>
                <select
                  value={row.account}
                  onChange={(e) => setRow(idx, 'account', e.target.value)}
                  style={{ width: '100%', padding: 6, borderRadius: 6, border: '1px solid #d1d5db' }}
                  disabled={loadingAccounts}
                >
                  <option value="">Select account</option>
                  {accounts.map((a) => (
                    <option key={a.name} value={a.name}>{a.name}</option>
                  ))}
                </select>
              </td>
              <td style={{ padding: 8, textAlign: 'right' }}>
                <input type="number" step="0.01" min="0" value={row.debit} onChange={(e) => setRow(idx, 'debit', e.target.value)} style={{ width: 100, padding: 6, textAlign: 'right' }} />
              </td>
              <td style={{ padding: 8, textAlign: 'right' }}>
                <input type="number" step="0.01" min="0" value={row.credit} onChange={(e) => setRow(idx, 'credit', e.target.value)} style={{ width: 100, padding: 6, textAlign: 'right' }} />
              </td>
              <td style={{ padding: 8 }}>
                {rows.length > 1 && (
                  <button type="button" onClick={() => removeRow(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }} title="Remove row"><FiTrash2 /></button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid #e5e7eb', fontWeight: 600 }}>
            <td style={{ padding: 8 }}>Total</td>
            <td style={{ padding: 8, textAlign: 'right' }}>{totalDebit.toFixed(2)}</td>
            <td style={{ padding: 8, textAlign: 'right' }}>{totalCredit.toFixed(2)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      {!balanced && (totalDebit > 0 || totalCredit > 0) && (
        <p style={{ color: TavariStyles?.colors?.red || '#dc2626', marginBottom: 8 }}>Debits and credits must be equal.</p>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={addRow} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', cursor: 'pointer', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff' }}>
          <FiPlus /> Add line
        </button>
        <button type="button" onClick={handlePost} disabled={posting || !balanced || totalDebit === 0} style={{ display: 'inline-flex', alignItems: 'center', padding: '8px 16px', cursor: posting ? 'wait' : 'pointer', background: TavariStyles?.colors?.primary || '#0ea5e9', color: '#fff', border: 'none', borderRadius: 8 }}>
          {posting ? 'Posting...' : 'Post to ERPNext'}
        </button>
      </div>
    </div>
  );
};

export default AccountingJournalEntry;
