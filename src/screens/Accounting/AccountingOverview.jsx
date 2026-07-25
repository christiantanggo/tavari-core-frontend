import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { TavariStyles } from '../../utils/TavariStyles';
import { FiAlertCircle, FiCheckCircle, FiClock, FiDollarSign, FiMail, FiTrendingUp } from 'react-icons/fi';

const cardStyle = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 20,
  boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
};

function StatCard({ label, value, hint, tone = 'default', onClick }) {
  const tones = {
    default: { color: '#111827' },
    warn: { color: '#b45309' },
    ok: { color: '#047857' }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...cardStyle,
        textAlign: 'left',
        cursor: onClick ? 'pointer' : 'default',
        width: '100%'
      }}
    >
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, ...tones[tone] }}>{value}</div>
      {hint ? <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 8 }}>{hint}</div> : null}
    </button>
  );
}

export default function AccountingOverview({ embedded = false }) {
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    draftBatches: 0,
    draftDeposits: 0,
    draftExpenses: 0,
    pendingBankTx: 0,
    openTavariInvoices: 0,
    tavariInvoicesUnposted: 0,
    plaidConnections: 0,
    erpConnected: false,
    periodLockedUntil: null,
    lastBatchDate: null,
    cronHint: ''
  });

  const go = (path) => () => navigate(path);

  const load = useCallback(async () => {
    if (!selectedBusinessId) return;
    setLoading(true);
    try {
      const [
        batchesRes,
        depositsRes,
        expensesRes,
        configRes,
        importsRes,
        lastBatchRes,
        tavariInvoicesRes,
        plaidItemsRes
      ] = await Promise.all([
        supabase.from('accounting_sales_batches').select('id', { count: 'exact', head: true }).eq('business_id', selectedBusinessId).eq('status', 'draft'),
        supabase.from('accounting_deposits').select('id', { count: 'exact', head: true }).eq('business_id', selectedBusinessId).eq('status', 'draft'),
        supabase.from('accounting_draft_expenses').select('id', { count: 'exact', head: true }).eq('business_id', selectedBusinessId).eq('status', 'draft'),
        supabase.from('accounting_business_config').select('erpnext_api_url, erpnext_api_key, period_locked_until, batch_run_time_local, business_timezone').eq('business_id', selectedBusinessId).maybeSingle(),
        supabase.from('accounting_bank_imports').select('id').eq('business_id', selectedBusinessId),
        supabase.from('accounting_sales_batches').select('batch_date').eq('business_id', selectedBusinessId).order('batch_date', { ascending: false }).limit(1),
        supabase.from('tavari_invoices').select('id, erpnext_sales_invoice_name').eq('business_id', selectedBusinessId).gt('balance_due', 0).in('status', ['sent', 'viewed', 'partially_paid', 'overdue']),
        supabase.from('accounting_plaid_items').select('id', { count: 'exact', head: true }).eq('business_id', selectedBusinessId)
      ]);

      let pendingBankTx = 0;
      const importIds = (importsRes.data || []).map((r) => r.id);
      if (importIds.length > 0) {
        const { count } = await supabase
          .from('accounting_bank_transactions')
          .select('id', { count: 'exact', head: true })
          .in('import_id', importIds)
          .eq('status', 'pending')
          .is('matched_draft_expense_id', null);
        pendingBankTx = count || 0;
      }

      const config = configRes.data;
      const connected = !!(config?.erpnext_api_url?.trim() && config?.erpnext_api_key?.trim());
      const runTime = config?.batch_run_time_local || '02:00';
      const tz = config?.business_timezone || 'America/Toronto';

      const tavariRows = tavariInvoicesRes.data || [];
      const openTavariInvoices = tavariRows.length;
      const tavariInvoicesUnposted = tavariRows.filter((row) => !row.erpnext_sales_invoice_name).length;

      setStats({
        draftBatches: batchesRes.count || 0,
        draftDeposits: depositsRes.count || 0,
        draftExpenses: expensesRes.count || 0,
        pendingBankTx,
        openTavariInvoices,
        tavariInvoicesUnposted,
        plaidConnections: plaidItemsRes.count || 0,
        erpConnected: connected,
        periodLockedUntil: config?.period_locked_until || null,
        lastBatchDate: lastBatchRes.data?.[0]?.batch_date || null,
        cronHint: connected
          ? `Schedule accounting-daily-batch daily after ${runTime} (${tz}). See Settings → Automated sales batches.`
          : 'Connect ERPNext in Settings before posting.'
      });
    } catch (e) {
      console.error('Accounting overview load failed:', e);
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>Loading overview…</div>;
  }

  const queueTotal = stats.draftBatches + stats.draftDeposits + stats.draftExpenses;
  const needsAttention = !stats.erpConnected || stats.draftExpenses > 0 || stats.draftDeposits > 0 || stats.pendingBankTx > 0 || stats.tavariInvoicesUnposted > 0;

  return (
    <div style={{ padding: embedded ? 0 : 24, paddingTop: embedded ? 0 : 80 }}>
      {!embedded && <h1 style={{ fontSize: '1.5rem', margin: '0 0 8px' }}>Accounting Overview</h1>}
      <p style={{ margin: '0 0 20px', color: TavariStyles?.colors?.gray600 || '#6b7280', fontSize: 14 }}>
        Snapshot of what needs review before your books are up to date.
      </p>

      {!stats.erpConnected && (
        <div style={{ ...cardStyle, marginBottom: 16, borderColor: '#fcd34d', background: '#fffbeb', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <FiAlertCircle size={20} color="#b45309" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong>ERPNext not connected.</strong> Reports and posting require API credentials in Settings.
            <button type="button" onClick={go('/dashboard/accounting/settings')} style={linkBtn}>Open Settings</button>
          </div>
        </div>
      )}

      {stats.periodLockedUntil && (
        <div style={{ ...cardStyle, marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
          <FiClock size={18} color="#6b7280" />
          <span>Period locked through <strong>{stats.periodLockedUntil}</strong>. Unlock in Settings to post earlier dates.</span>
        </div>
      )}

      <div style={{ ...cardStyle, marginBottom: 16, fontSize: 13, color: '#4b5563', lineHeight: 1.5 }}>
        Holding companies / no POS: use <strong>Bank Transactions</strong>, <strong>Expenses</strong>, and <strong>Journal Entry</strong>.
        Sales batches are optional — zero draft batches is normal when you are not using POS or Bookings.
        Cutover: <button type="button" onClick={go('/dashboard/accounting/setup/opening-balances')} style={linkBtn}>Opening Balances</button>
        {' · '}
        <button type="button" onClick={go('/dashboard/accounting/reports/year-end-package')} style={linkBtn}>Year-end Package</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <StatCard
          label="Queue items"
          value={queueTotal}
          hint={`${stats.draftBatches} batches · ${stats.draftDeposits} deposits · ${stats.draftExpenses} expenses`}
          tone={stats.draftExpenses > 0 || stats.draftDeposits > 0 ? 'warn' : (queueTotal > 0 ? 'default' : 'ok')}
          onClick={go('/dashboard/accounting/queue')}
        />
        <StatCard
          label="Uncategorized bank"
          value={stats.pendingBankTx}
          hint="Pending bank transactions"
          tone={stats.pendingBankTx > 0 ? 'warn' : 'ok'}
          onClick={go('/dashboard/accounting/bank-transactions/pending')}
        />
        <StatCard
          label="Open Tavari invoices"
          value={stats.openTavariInvoices}
          hint={stats.tavariInvoicesUnposted > 0 ? `${stats.tavariInvoicesUnposted} not yet in ERPNext` : 'All posted or none open'}
          tone={stats.tavariInvoicesUnposted > 0 ? 'warn' : 'ok'}
          onClick={go('/dashboard/accounting/reports/ar-workspace')}
        />
        <StatCard
          label="Plaid connections"
          value={stats.plaidConnections}
          hint={stats.plaidConnections > 0 ? 'Live bank feed linked' : 'CSV upload or connect Plaid'}
          tone={stats.plaidConnections > 0 ? 'ok' : 'default'}
          onClick={go('/dashboard/accounting/bank-transactions/upload')}
        />
        <StatCard
          label="Latest sales batch"
          value={stats.lastBatchDate || '—'}
          hint={stats.lastBatchDate ? 'Most recent batch date' : 'Run Create sales batches in Queue'}
          onClick={go('/dashboard/accounting/queue')}
        />
        <StatCard
          label="ERPNext"
          value={stats.erpConnected ? 'Connected' : 'Setup needed'}
          tone={stats.erpConnected ? 'ok' : 'warn'}
          onClick={go('/dashboard/accounting/settings')}
        />
      </div>

      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FiTrendingUp /> Quick actions
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <ActionChip icon={<FiDollarSign />} label="Review queue" onClick={go('/dashboard/accounting/queue')} />
          <ActionChip icon={<FiMail />} label="Inbox settings" onClick={go('/dashboard/accounting/settings')} />
          <ActionChip icon={<FiCheckCircle />} label="Bank upload" onClick={go('/dashboard/accounting/bank-transactions/upload')} />
          <ActionChip icon={<FiTrendingUp />} label="Chart of accounts" onClick={go('/dashboard/accounting/chart-of-accounts')} />
          <ActionChip icon={<FiCheckCircle />} label="Filing reconciliation" onClick={go('/dashboard/accounting/reports/filing-reconciliation')} />
          <ActionChip icon={<FiTrendingUp />} label="P&L report" onClick={go('/dashboard/accounting/reports')} />
        </div>
      </div>

      <div style={{ ...cardStyle, fontSize: 13, color: '#4b5563', lineHeight: 1.5 }}>
        <strong>Automated sales batches</strong>
        <p style={{ margin: '8px 0 0' }}>{stats.cronHint}</p>
        {needsAttention ? (
          <p style={{ margin: '12px 0 0', color: '#b45309' }}>You have items waiting for review or setup.</p>
        ) : (
          <p style={{ margin: '12px 0 0', color: '#047857' }}>No pending queue or bank items detected.</p>
        )}
      </div>
    </div>
  );
}

function ActionChip({ icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 14px',
        borderRadius: 999,
        border: '1px solid #d1d5db',
        background: '#f9fafb',
        cursor: 'pointer',
        fontSize: 13
      }}
    >
      {icon}
      {label}
    </button>
  );
}

const linkBtn = {
  marginLeft: 8,
  border: 'none',
  background: 'none',
  color: '#0d9488',
  cursor: 'pointer',
  textDecoration: 'underline',
  fontSize: 13
};
