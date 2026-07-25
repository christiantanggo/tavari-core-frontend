import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { FiArrowLeft, FiRefreshCw } from 'react-icons/fi';
import { logAccountingEvent } from './accountingAudit';
import { getCurrentBusinessDate } from '../../utils/businessDateFormat';

const AccountingBankReconciliation = ({ embedded = false }) => {
  const navigate = useNavigate();
  const { selectedBusinessId, selectedBusiness } = useBusinessContext();
  const { authLoading } = usePOSAuth({ requiredRoles: ['owner', 'manager', 'admin'], requireBusiness: true, componentName: 'AccountingBankReconciliation' });
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [asOfDate, setAsOfDate] = useState(() => getCurrentBusinessDate(selectedBusiness?.timezone));
  const [statementBalance, setStatementBalance] = useState('');
  const [glBalance, setGlBalance] = useState(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [bankTx, setBankTx] = useState([]);
  const [depositSummaryMap, setDepositSummaryMap] = useState({});
  const [importMap, setImportMap] = useState({});
  const [loadingTx, setLoadingTx] = useState(false);
  const [txSearch, setTxSearch] = useState('');
  const [txFilter, setTxFilter] = useState('all');
  const [txLimit, setTxLimit] = useState(100);

  useEffect(() => {
    if (!selectedBusinessId) return;
    supabase.functions.invoke('accounting-list-accounts', { body: { business_id: selectedBusinessId } })
      .then(({ data, error }) => {
        if (error || data?.error) {
          toast.error(error?.message || data?.error || 'Failed to load accounts');
          setAccounts([]);
          return;
        }
        if (data?.accounts) {
          const bankAccounts = data.accounts.filter((a) => /bank|cash|cheque/i.test(a.name));
          setAccounts(bankAccounts.length > 0 ? bankAccounts : data.accounts);
        }
      })
      .catch((e) => {
        toast.error(e?.message || 'Failed to load accounts');
        setAccounts([]);
      });
  }, [selectedBusinessId]);

  const fetchGlBalance = useCallback(async () => {
    if (!selectedBusinessId || !selectedAccount || !asOfDate) return;
    setLoadingBalance(true);
    setGlBalance(null);
    try {
      const { data, error } = await supabase.functions.invoke('accounting-get-account-balance', {
        body: { business_id: selectedBusinessId, account_name: selectedAccount, as_of_date: asOfDate }
      });
      if (error || data?.error) {
        toast.error(error?.message || data?.error || 'Failed to load balance');
      } else if (data?.balance !== undefined) {
        setGlBalance(data.balance);
      }
    } catch (e) {
      toast.error(e?.message || 'Failed to load balance');
    } finally {
      setLoadingBalance(false);
    }
  }, [selectedBusinessId, selectedAccount, asOfDate]);

  useEffect(() => {
    if (selectedAccount && asOfDate && selectedBusinessId) fetchGlBalance();
  }, [selectedAccount, asOfDate, selectedBusinessId, fetchGlBalance]);

  useEffect(() => {
    if (!selectedBusinessId || !asOfDate || !selectedAccount) return;
    setLoadingTx(true);
    (async () => {
      const { data: imports } = await supabase
        .from('accounting_bank_imports')
        .select('id, file_name, bank_account_erpnext')
        .eq('business_id', selectedBusinessId)
        .eq('bank_account_erpnext', selectedAccount);
      const importIds = (imports || []).map((i) => i.id);
      setImportMap(Object.fromEntries((imports || []).map((item) => [item.id, item])));
      if (importIds.length === 0) {
        setBankTx([]);
        setLoadingTx(false);
        return;
      }
      const { data: tx } = await supabase
        .from('accounting_bank_transactions')
        .select('id, import_id, transaction_date, description, payee, amount, debit_credit, reconciled_at, status, matched_draft_expense_id, matched_deposit_id, erpnext_journal_entry_id')
        .in('import_id', importIds)
        .lte('transaction_date', asOfDate)
        .order('transaction_date', { ascending: false })
        .limit(txLimit);
      setBankTx(tx || []);
      const depositIds = Array.from(new Set((tx || []).map((row) => row.matched_deposit_id).filter(Boolean)));
      if (depositIds.length > 0) {
        const [{ data: deposits }, { data: matchLines }] = await Promise.all([
          supabase
            .from('accounting_deposits')
            .select('id, deposit_date, status')
            .in('id', depositIds),
          supabase
            .from('accounting_deposit_match_lines')
            .select('deposit_id, line_type')
            .in('deposit_id', depositIds)
        ]);
        const lineStats = (matchLines || []).reduce((acc, line) => {
          const existing = acc[line.deposit_id] || { lineCount: 0, batchLineCount: 0 };
          existing.lineCount += 1;
          if (line.line_type === 'batch_item') existing.batchLineCount += 1;
          acc[line.deposit_id] = existing;
          return acc;
        }, {});
        setDepositSummaryMap(
          Object.fromEntries(
            (deposits || []).map((deposit) => [
              deposit.id,
              {
                ...deposit,
                lineCount: lineStats?.[deposit.id]?.lineCount || 0,
                batchLineCount: lineStats?.[deposit.id]?.batchLineCount || 0
              }
            ])
          )
        );
      } else {
        setDepositSummaryMap({});
      }
      setLoadingTx(false);
    })();
  }, [selectedBusinessId, asOfDate, selectedAccount, txLimit]);

  const setReconciled = async (txId, cleared) => {
    const { error } = await supabase
      .from('accounting_bank_transactions')
      .update({ reconciled_at: cleared ? asOfDate : null })
      .eq('id', txId);
    if (error) toast.error(error.message);
    else {
      setBankTx((prev) => prev.map((t) => (t.id === txId ? { ...t, reconciled_at: cleared ? asOfDate : null } : t)));
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: cleared ? 'bank_tx_reconciled' : 'bank_tx_unreconciled',
        entityType: 'accounting_bank_transaction',
        entityId: txId,
        details: { reconciled_at: cleared ? asOfDate : null, bank_account: selectedAccount }
      });
    }
  };

  const amountSigned = (row) => (row.debit_credit === 'debit' ? -Math.abs(Number(row.amount) || 0) : Math.abs(Number(row.amount) || 0));
  const filteredTx = bankTx.filter((row) => {
    const haystack = `${row.description || ''} ${row.payee || ''}`.toLowerCase();
    const searchMatch = !txSearch.trim() || haystack.includes(txSearch.trim().toLowerCase());
    const statusMatch =
      txFilter === 'all'
        ? true
        : txFilter === 'cleared'
          ? !!row.reconciled_at
          : txFilter === 'uncleared'
            ? !row.reconciled_at
            : row.status === txFilter;
    return searchMatch && statusMatch;
  });
  const stmtNum = parseFloat(statementBalance);
  const importedNet = filteredTx.reduce((sum, row) => sum + amountSigned(row), 0);
  const clearedNet = filteredTx.filter((row) => row.reconciled_at).reduce((sum, row) => sum + amountSigned(row), 0);
  const outstandingNet = importedNet - clearedNet;
  const diff = glBalance != null && !Number.isNaN(stmtNum) ? Math.round((stmtNum - glBalance) * 100) / 100 : null;
  const statementVsCleared = !Number.isNaN(stmtNum) ? Math.round((stmtNum - clearedNet) * 100) / 100 : null;

  if (authLoading || !selectedBusinessId) return <div style={{ padding: 48, textAlign: 'center' }}>Loading...</div>;

  return (
    <div style={{ padding: embedded ? 0 : 24, paddingTop: embedded ? 0 : 80 }}>
      {!embedded && (
        <button type="button" style={{ marginBottom: 16, cursor: 'pointer' }} onClick={() => navigate('/dashboard/accounting')}>
          <FiArrowLeft /> Back
        </button>
      )}
      <h1 style={{ fontSize: '1.25rem', marginBottom: 8 }}>Bank Reconciliation</h1>
      <p style={{ color: TavariStyles?.colors?.gray600, marginBottom: 16, fontSize: 14 }}>
        Compare your bank statement balance to the GL balance. Reconcile in ERPNext if needed.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', marginBottom: 24 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Bank account (GL)
          <select
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            style={{ minWidth: 220, padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }}
          >
            <option value="">Select account</option>
            {accounts.map((a) => (
              <option key={a.name} value={a.name}>{a.name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          As of date
          <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} style={{ padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }} />
        </label>
        <button type="button" onClick={fetchGlBalance} disabled={loadingBalance || !selectedAccount} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', cursor: 'pointer', background: TavariStyles?.colors?.primary || '#0ea5e9', color: '#fff', border: 'none', borderRadius: 8 }}>
          <FiRefreshCw style={{ opacity: loadingBalance ? 0.7 : 1 }} /> {loadingBalance ? 'Loading...' : 'Refresh GL'}
        </button>
      </div>

      <div style={{ maxWidth: 760, padding: 16, background: TavariStyles?.colors?.gray100 ?? '#f3f4f6', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr><td style={{ padding: '8px 0' }}>GL balance</td><td style={{ textAlign: 'right', padding: '8px 0' }}>{loadingBalance ? '...' : glBalance != null ? glBalance.toFixed(2) : '—'}</td></tr>
            <tr>
              <td style={{ padding: '8px 0' }}>Statement balance</td>
              <td style={{ textAlign: 'right', padding: '8px 0' }}>
                <input type="number" step="0.01" value={statementBalance} onChange={(e) => setStatementBalance(e.target.value)} placeholder="From bank" style={{ width: 100, padding: 6, textAlign: 'right' }} />
              </td>
            </tr>
            {diff != null && (
              <tr style={{ borderTop: '1px solid #e5e7eb', fontWeight: 600 }}>
                <td style={{ padding: '8px 0' }}>Statement vs GL</td>
                <td style={{ textAlign: 'right', padding: '8px 0' }}>{diff.toFixed(2)}</td>
              </tr>
            )}
            <tr><td style={{ padding: '8px 0' }}>Imported movement (filtered)</td><td style={{ textAlign: 'right', padding: '8px 0' }}>{importedNet.toFixed(2)}</td></tr>
            <tr><td style={{ padding: '8px 0' }}>Cleared movement</td><td style={{ textAlign: 'right', padding: '8px 0' }}>{clearedNet.toFixed(2)}</td></tr>
            <tr><td style={{ padding: '8px 0' }}>Uncleared movement</td><td style={{ textAlign: 'right', padding: '8px 0' }}>{outstandingNet.toFixed(2)}</td></tr>
            {statementVsCleared != null && (
              <tr style={{ borderTop: '1px solid #e5e7eb', fontWeight: 600 }}>
                <td style={{ padding: '8px 0' }}>Statement vs cleared</td>
                <td style={{ textAlign: 'right', padding: '8px 0' }}>{statementVsCleared.toFixed(2)}</td>
              </tr>
            )}
          </tbody>
        </table>
        {diff != null && diff !== 0 && (
          <p style={{ fontSize: 13, color: TavariStyles?.colors?.gray600, marginTop: 12 }}>
            Use the imported items below to explain the difference before you finish the final reconciliation in ERPNext.
          </p>
        )}
      </div>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Bank transactions (from imports)</h2>
        <p style={{ color: TavariStyles?.colors?.gray600, fontSize: 13, marginBottom: 12 }}>
          This list is scoped to <strong>{selectedAccount || 'the selected bank account'}</strong>. Mark items as cleared when they appear on your statement (as of {asOfDate}).
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
          <input
            type="text"
            value={txSearch}
            onChange={(e) => setTxSearch(e.target.value)}
            placeholder="Search description or payee"
            style={{ padding: 8, borderRadius: 6, border: '1px solid #d1d5db', minWidth: 220 }}
          />
          <select value={txFilter} onChange={(e) => setTxFilter(e.target.value)} style={{ padding: 8, borderRadius: 6, border: '1px solid #d1d5db' }}>
            <option value="all">All statuses</option>
            <option value="cleared">Cleared only</option>
            <option value="uncleared">Uncleared only</option>
            <option value="posted">Posted only</option>
            <option value="matched">Matched only</option>
            <option value="pending">Pending only</option>
          </select>
          <button type="button" onClick={() => setTxLimit((prev) => prev + 100)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>
            Load more
          </button>
        </div>
        {loadingTx ? (
          <p style={{ color: TavariStyles?.colors?.gray600 }}>Loading...</p>
        ) : !selectedAccount ? (
          <p style={{ color: TavariStyles?.colors?.gray600 }}>Choose a bank account to load imported transactions for reconciliation.</p>
        ) : bankTx.length === 0 ? (
          <p style={{ color: TavariStyles?.colors?.gray600 }}>No imported transactions for this bank account up to this date. Use Bank Import with the matching ERPNext bank account first.</p>
        ) : filteredTx.length === 0 ? (
          <p style={{ color: TavariStyles?.colors?.gray600 }}>No transactions match the current search/filter.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ textAlign: 'left', padding: 8 }}>Date</th>
                  <th style={{ textAlign: 'left', padding: 8 }}>Description</th>
                  <th style={{ textAlign: 'left', padding: 8 }}>Payee</th>
                  <th style={{ textAlign: 'right', padding: 8 }}>Amount</th>
                  <th style={{ textAlign: 'left', padding: 8 }}>ERP status</th>
                  <th style={{ textAlign: 'left', padding: 8 }}>Import file</th>
                  <th style={{ padding: 8 }}>Cleared</th>
                </tr>
              </thead>
              <tbody>
                {filteredTx.map((t) => (
                  <tr key={t.id} style={{ borderBottom: '1px solid #eee', background: t.reconciled_at ? 'rgba(34, 197, 94, 0.08)' : undefined }}>
                    <td style={{ padding: 8 }}>{t.transaction_date}</td>
                    <td style={{ padding: 8 }}>{t.description || '—'}</td>
                    <td style={{ padding: 8 }}>{t.payee || '—'}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>{t.debit_credit === 'debit' ? '-' : ''}{Math.abs(Number(t.amount)).toFixed(2)}</td>
                    <td style={{ padding: 8 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span>{t.status || 'pending'}</span>
                        {t.matched_deposit_id && depositSummaryMap?.[t.matched_deposit_id] ? (
                          <span style={{ fontSize: 11, color: '#6b7280' }}>
                            Deposit {depositSummaryMap[t.matched_deposit_id].deposit_date || '—'} · {depositSummaryMap[t.matched_deposit_id].status} · {depositSummaryMap[t.matched_deposit_id].lineCount || 0} match lines
                          </span>
                        ) : null}
                        {t.erpnext_journal_entry_id ? <span style={{ fontSize: 11, color: '#6b7280' }}>{t.erpnext_journal_entry_id}</span> : null}
                      </div>
                    </td>
                    <td style={{ padding: 8 }}>{importMap?.[t.import_id]?.file_name || '—'}</td>
                    <td style={{ padding: 8 }}>
                      <button
                        type="button"
                        onClick={() => setReconciled(t.id, !t.reconciled_at)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 6,
                          border: '1px solid #d1d5db',
                          cursor: 'pointer',
                          background: t.reconciled_at ? TavariStyles?.colors?.success || '#22c55e' : '#fff',
                          color: t.reconciled_at ? '#fff' : '#374151',
                          fontSize: 13
                        }}
                      >
                        {t.reconciled_at ? 'Cleared' : 'Mark cleared'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default AccountingBankReconciliation;
