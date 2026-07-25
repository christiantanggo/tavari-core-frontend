import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { FiCheck, FiChevronDown, FiChevronUp, FiExternalLink, FiLoader, FiRotateCcw, FiX } from 'react-icons/fi';
import { openExpenseInvoiceAttachment } from '../../utils/openExpenseInvoiceAttachment';
import { logAccountingEvent } from './accountingAudit';
import { getEffectiveExpenseAmounts } from '../../utils/accountingDraftAmounts';
import { sumExpenseRegisterTotals } from '../../utils/expenseAmounts';
import { formatAccountingDateLabel, resolveAccountingTimezone } from '../../utils/businessDateFormat';

const STATUS_FILTERS = [
  { id: 'posted', label: 'Posted', hint: 'Approved and synced to ERPNext' },
  { id: 'all', label: 'All', hint: 'Every expense record' },
  { id: 'draft', label: 'Pending', hint: 'Awaiting approval in the queue' },
];

const EMPTY_FILTERS = {
  dateFrom: '',
  dateTo: '',
  vendorId: '',
  categoryId: '',
  amountMin: '',
  amountMax: '',
  search: '',
};

const formatDate = (d, tz) => formatAccountingDateLabel(d, tz);
const formatMoney = (n) => {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const num = Number(n);
  const abs = Math.abs(num);
  if (num < 0) return `-$${abs.toFixed(2)}`;
  return `$${abs.toFixed(2)}`;
};

function effectiveExpenseDate(expense) {
  const raw = expense?.transaction_date || expense?.invoice_date;
  if (!raw) return null;
  const s = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function effectiveExpenseAmount(expense) {
  const { total } = getEffectiveExpenseAmounts(expense);
  if (total == null || Number.isNaN(Number(total))) return null;
  return Math.abs(Number(total));
}

/** Signed amount for sort: credits negative, bills positive — so they group at opposite ends. */
function signedAmountForSort(value, isCreditMemo) {
  if (value == null || Number.isNaN(Number(value))) return null;
  const abs = Math.abs(Number(value));
  if (abs < 0.001) return 0;
  return isCreditMemo ? -abs : abs;
}

function signedSubtotalForSort(expense) {
  const { subtotal } = getEffectiveExpenseAmounts(expense);
  return signedAmountForSort(subtotal, expense.document_type === 'credit_memo');
}

function signedTaxForSort(expense) {
  const { tax_amount } = getEffectiveExpenseAmounts(expense);
  return signedAmountForSort(tax_amount, expense.document_type === 'credit_memo');
}

function signedTotalForSort(expense) {
  const { total } = getEffectiveExpenseAmounts(expense);
  return signedAmountForSort(total, expense.document_type === 'credit_memo');
}

function formatExpenseMoney(value, isCreditMemo) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const abs = Math.abs(Number(value));
  if (isCreditMemo) return `-$${abs.toFixed(2)}`;
  return `$${abs.toFixed(2)}`;
}

function parseAmountInput(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed.replace(/,/g, ''));
  return Number.isNaN(n) || n < 0 ? null : n;
}

const tableStyles = {
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14, background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  th: { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #e5e7eb', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' },
  td: { padding: '10px 12px', borderBottom: '1px solid #eee', verticalAlign: 'middle' },
  filterBtn: (active) => ({
    padding: '8px 14px',
    borderRadius: 8,
    border: `1px solid ${active ? (TavariStyles?.colors?.primary || '#008080') : '#d1d5db'}`,
    background: active ? (TavariStyles?.colors?.primary || '#008080') : '#fff',
    color: active ? '#fff' : '#374151',
    cursor: 'pointer',
    fontWeight: 500,
    fontSize: 13,
  }),
  iconBtn: { border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px 8px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 },
  fieldLabel: { display: 'block', fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 4 },
  fieldInput: { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, boxSizing: 'border-box' },
};

function statusLabel(status) {
  if (status === 'posted') return { text: 'Posted', color: '#059669', bg: '#ecfdf5' };
  if (status === 'approved') return { text: 'Approved', color: '#2563eb', bg: '#eff6ff' };
  if (status === 'posting') return { text: 'Posting…', color: '#b45309', bg: '#fffbeb' };
  return { text: 'Pending', color: '#6b7280', bg: '#f3f4f6' };
}

function expenseTypeLabel(expense) {
  if (expense.document_type === 'credit_memo') return 'Credit memo';
  if (expense.source === 'email') return 'Email';
  if (expense.source === 'bank_csv') return 'Bank';
  return expense.source || 'Manual';
}

function compareSortValues(a, b, dir) {
  const mult = dir === 'asc' ? 1 : -1;
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) return 0;
    return a < b ? -mult : mult;
  }
  const sa = String(a).toLowerCase();
  const sb = String(b).toLowerCase();
  if (sa === sb) return 0;
  return sa < sb ? -mult : mult;
}

const SORTABLE_COLUMNS = [
  { id: 'date', label: 'Date' },
  { id: 'vendor', label: 'Vendor' },
  { id: 'category', label: 'Category' },
  { id: 'invoice', label: 'Invoice #' },
  { id: 'subtotal', label: 'Subtotal' },
  { id: 'tax', label: 'Tax' },
  { id: 'total', label: 'Total' },
  { id: 'erpnext', label: 'ERPNext' },
  { id: 'type', label: 'Type' },
  { id: 'status', label: 'Status' },
];

export default function AccountingExpenses({ embedded = false }) {
  const navigate = useNavigate();
  const { selectedBusinessId, selectedBusiness } = useBusinessContext();
  const { authLoading } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'AccountingExpenses',
  });

  const [expenses, setExpenses] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('posted');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [openingId, setOpeningId] = useState(null);
  const [unapprovingId, setUnapprovingId] = useState(null);
  const [sortColumn, setSortColumn] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [accountingTimezone, setAccountingTimezone] = useState(() => resolveAccountingTimezone(null, selectedBusiness));

  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));

  const hasActiveFilters = useMemo(
    () => Object.entries(filters).some(([, v]) => String(v ?? '').trim() !== ''),
    [filters],
  );

  const loadExpenses = useCallback(async () => {
    if (!selectedBusinessId) return;
    setLoading(true);
    try {
      const { data: configRow } = await supabase
        .from('accounting_business_config')
        .select('business_timezone')
        .eq('business_id', selectedBusinessId)
        .maybeSingle();
      setAccountingTimezone(resolveAccountingTimezone(configRow, selectedBusiness));

      let query = supabase
        .from('accounting_draft_expenses')
        .select('*')
        .eq('business_id', selectedBusinessId)
        .order('transaction_date', { ascending: false, nullsFirst: false })
        .order('approved_at', { ascending: false, nullsFirst: true })
        .limit(1000);

      if (statusFilter === 'posted') {
        query = query.eq('status', 'posted');
      } else if (statusFilter === 'draft') {
        query = query.eq('status', 'draft');
      }

      const [expensesRes, vendorsRes, categoriesRes] = await Promise.all([
        query,
        supabase.from('accounting_vendors').select('id, name').eq('business_id', selectedBusinessId).order('name'),
        supabase.from('accounting_expense_categories').select('id, name').eq('business_id', selectedBusinessId).order('sort_order').order('name'),
      ]);

      if (expensesRes.error) throw expensesRes.error;
      setExpenses(expensesRes.data || []);
      setVendors(vendorsRes.data || []);
      setCategories(categoriesRes.data || []);
    } catch (e) {
      toast.error(e?.message || 'Failed to load expenses');
      setExpenses([]);
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId, statusFilter]);

  useEffect(() => {
    if (!authLoading && selectedBusinessId) loadExpenses();
  }, [authLoading, selectedBusinessId, loadExpenses]);

  const vendorMap = useMemo(() => Object.fromEntries(vendors.map((v) => [v.id, v.name])), [vendors]);
  const categoryMap = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.name])), [categories]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const minAmt = parseAmountInput(filters.amountMin);
    const maxAmt = parseAmountInput(filters.amountMax);
    const vendorNameFilter = filters.vendorId ? (vendorMap[filters.vendorId] || '').trim().toLowerCase() : '';

    return expenses.filter((e) => {
      const effDate = effectiveExpenseDate(e);
      if (filters.dateFrom && (!effDate || effDate < filters.dateFrom)) return false;
      if (filters.dateTo && (!effDate || effDate > filters.dateTo)) return false;

      if (filters.vendorId) {
        const display = (e.vendor_name_display || '').trim().toLowerCase();
        const matchesId = e.vendor_id === filters.vendorId;
        const matchesName = vendorNameFilter && display === vendorNameFilter;
        const matchesPartial = vendorNameFilter && display.includes(vendorNameFilter);
        if (!matchesId && !matchesName && !matchesPartial) return false;
      }

      if (filters.categoryId && e.expense_category_id !== filters.categoryId) return false;

      const amt = effectiveExpenseAmount(e);
      if (minAmt != null && (amt == null || amt < minAmt - 0.001)) return false;
      if (maxAmt != null && (amt == null || amt > maxAmt + 0.001)) return false;

      if (q) {
        const vendor = (e.vendor_name_display || vendorMap[e.vendor_id] || '').toLowerCase();
        const inv = (e.invoice_number || '').toLowerCase();
        const erp = (e.erpnext_purchase_invoice_id || '').toLowerCase();
        if (!vendor.includes(q) && !inv.includes(q) && !erp.includes(q)) return false;
      }

      return true;
    });
  }, [expenses, filters, vendorMap]);

  const vendorName = useCallback((e) => e.vendor_name_display || vendorMap[e.vendor_id] || '—', [vendorMap]);
  const categoryName = useCallback((e) => categoryMap[e.expense_category_id] || '—', [categoryMap]);

  const getSortValue = useCallback((expense, columnId) => {
    switch (columnId) {
      case 'date':
        return effectiveExpenseDate(expense);
      case 'vendor':
        return vendorName(expense);
      case 'category':
        return categoryName(expense);
      case 'invoice':
        return expense.invoice_number || null;
      case 'subtotal':
        return signedSubtotalForSort(expense);
      case 'tax':
        return signedTaxForSort(expense);
      case 'total':
        return signedTotalForSort(expense);
      case 'erpnext':
        return expense.erpnext_purchase_invoice_id || null;
      case 'type':
        return expenseTypeLabel(expense);
      case 'status':
        return expense.status || null;
      default:
        return null;
    }
  }, [vendorName, categoryName]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => compareSortValues(getSortValue(a, sortColumn), getSortValue(b, sortColumn), sortDir));
    return rows;
  }, [filtered, sortColumn, sortDir, getSortValue]);

  const handleSortColumn = (columnId) => {
    if (!SORTABLE_COLUMNS.some((c) => c.id === columnId)) return;
    if (sortColumn === columnId) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(columnId);
      setSortDir('asc');
    }
  };

  const totals = useMemo(() => sumExpenseRegisterTotals(filtered), [filtered]);

  const SortableTh = ({ columnId, label }) => {
    const active = sortColumn === columnId;
    return (
      <th style={{ ...tableStyles.th, padding: 0 }}>
        <button
          type="button"
          onClick={() => handleSortColumn(columnId)}
          title={active ? (sortDir === 'asc' ? 'Sorted low to high — tap to reverse' : 'Sorted high to low — tap to reverse') : `Sort by ${label}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            width: '100%',
            padding: '10px 12px',
            border: 'none',
            background: active ? '#f0fdfa' : 'transparent',
            color: active ? (TavariStyles?.colors?.primary || '#008080') : '#374151',
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
            textAlign: 'left',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
          {active && (sortDir === 'asc' ? <FiChevronUp size={14} aria-hidden /> : <FiChevronDown size={14} aria-hidden />)}
        </button>
      </th>
    );
  };

  const handleOpenInvoice = async (expense) => {
    setOpeningId(expense.id);
    try {
      await openExpenseInvoiceAttachment(supabase, expense);
    } catch (e) {
      toast.error(e?.message || 'Could not open invoice');
    }
    setOpeningId(null);
  };

  const handleUnapprove = async (expense) => {
    if (!confirm('Cancel approval and send this expense back to draft? ERPNext will create reversing entries.')) return;
    setUnapprovingId(expense.id);
    try {
      const { data, error } = await supabase.functions.invoke('accounting-unapprove-expense', {
        body: { business_id: selectedBusinessId, draft_id: expense.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Expense sent back to draft.');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'expense_unapproved',
        entityType: 'draft_expense',
        entityId: expense.id,
        details: { source: expense.source, transaction_date: expense.transaction_date },
      });
      await loadExpenses();
    } catch (e) {
      toast.error(e?.message || 'Failed to un-approve');
    }
    setUnapprovingId(null);
  };

  const clearFilters = () => setFilters(EMPTY_FILTERS);

  if (authLoading || !selectedBusinessId) {
    return <div style={{ padding: 24, color: '#6b7280' }}>Loading…</div>;
  }

  return (
    <div style={{ padding: embedded ? 0 : 24, paddingTop: embedded ? 0 : 80 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: '1.35rem', margin: '0 0 6px' }}>Expenses</h1>
          <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>
            Vendor bills and credit memos entered through Tavari. Posted items are synced to ERPNext.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/dashboard/accounting/queue?addExpense=1')}
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            border: 'none',
            background: TavariStyles?.colors?.primary || '#008080',
            color: '#fff',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          + Add expense
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        {STATUS_FILTERS.map((f) => (
          <button key={f.id} type="button" style={tableStyles.filterBtn(statusFilter === f.id)} onClick={() => setStatusFilter(f.id)} title={f.hint}>
            {f.label}
          </button>
        ))}
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6b7280' }}>
        {STATUS_FILTERS.find((f) => f.id === statusFilter)?.hint}
      </p>

      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          border: '1px solid #e5e7eb',
          padding: 16,
          marginBottom: 16,
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Search & filters</span>
          {hasActiveFilters && (
            <button type="button" onClick={clearFilters} style={{ ...tableStyles.iconBtn, color: '#6b7280', fontWeight: 500 }}>
              <FiX /> Clear filters
            </button>
          )}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 12,
            alignItems: 'end',
          }}
        >
          <label>
            <span style={tableStyles.fieldLabel}>From date</span>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilter('dateFrom', e.target.value)}
              style={tableStyles.fieldInput}
            />
          </label>
          <label>
            <span style={tableStyles.fieldLabel}>To date</span>
            <input
              type="date"
              value={filters.dateTo}
              min={filters.dateFrom || undefined}
              onChange={(e) => setFilter('dateTo', e.target.value)}
              style={tableStyles.fieldInput}
            />
          </label>
          <label>
            <span style={tableStyles.fieldLabel}>Vendor</span>
            <select value={filters.vendorId} onChange={(e) => setFilter('vendorId', e.target.value)} style={tableStyles.fieldInput}>
              <option value="">All vendors</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span style={tableStyles.fieldLabel}>Category</span>
            <select value={filters.categoryId} onChange={(e) => setFilter('categoryId', e.target.value)} style={tableStyles.fieldInput}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span style={tableStyles.fieldLabel}>Min amount ($)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={filters.amountMin}
              onChange={(e) => setFilter('amountMin', e.target.value)}
              style={tableStyles.fieldInput}
            />
          </label>
          <label>
            <span style={tableStyles.fieldLabel}>Max amount ($)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Any"
              value={filters.amountMax}
              onChange={(e) => setFilter('amountMax', e.target.value)}
              style={tableStyles.fieldInput}
            />
          </label>
          <label style={{ gridColumn: 'span 2' }}>
            <span style={tableStyles.fieldLabel}>Invoice # or ERPNext PI</span>
            <input
              type="search"
              placeholder="Search invoice number or ACC-PINV…"
              value={filters.search}
              onChange={(e) => setFilter('search', e.target.value)}
              style={tableStyles.fieldInput}
            />
          </label>
        </div>
      </div>

      {!loading && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, marginBottom: 16, fontSize: 14, color: '#374151' }}>
          <span>
            <strong>{totals.count}</strong> expense{totals.count === 1 ? '' : 's'}
            {hasActiveFilters && expenses.length !== filtered.length && (
              <span style={{ color: '#6b7280' }}> (of {expenses.length} loaded)</span>
            )}
          </span>
          {totals.count > 0 && (
            <>
              <span>Subtotal: <strong>{formatMoney(totals.subtotal)}</strong></span>
              <span>Tax: <strong>{formatMoney(totals.tax)}</strong></span>
              <span>Total: <strong>{formatMoney(totals.total)}</strong></span>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}><FiLoader style={{ animation: 'spin 1s linear infinite' }} /> Loading expenses…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#6b7280', background: '#fff', borderRadius: 8 }}>
          {statusFilter === 'draft' && !hasActiveFilters ? (
            <>
              <p>No pending expenses.</p>
              <button type="button" onClick={() => navigate('/dashboard/accounting/queue')} style={{ ...tableStyles.iconBtn, color: TavariStyles?.colors?.primary || '#008080' }}>
                Open approval queue
              </button>
            </>
          ) : (
            <p>No expenses match these filters.</p>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyles.table}>
            <thead>
              <tr>
                {SORTABLE_COLUMNS.map((col) => (
                  <SortableTh key={col.id} columnId={col.id} label={col.label} />
                ))}
                <th style={tableStyles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => {
                const st = statusLabel(e.status);
                const isCredit = e.document_type === 'credit_memo';
                const amounts = getEffectiveExpenseAmounts(e);
                const foreignCad = amounts.usedCadSettlement;
                return (
                  <tr key={e.id}>
                    <td style={tableStyles.td}>{formatDate(effectiveExpenseDate(e), accountingTimezone)}</td>
                    <td style={tableStyles.td}>{vendorName(e)}</td>
                    <td style={tableStyles.td} title={e.gl_account_erpnext ? `GL: ${e.gl_account_erpnext}` : undefined}>{categoryName(e)}</td>
                    <td style={tableStyles.td}>{e.invoice_number || '—'}</td>
                    <td style={tableStyles.td} title={foreignCad ? `Invoice ${Math.abs(Number(e.subtotal) || 0).toFixed(2)} ${amounts.invoiceCurrency}` : undefined}>
                      {formatExpenseMoney(amounts.subtotal, isCredit)}
                    </td>
                    <td style={tableStyles.td}>{e.hst_treatment === 'exempt' && !foreignCad ? '—' : formatExpenseMoney(amounts.tax_amount, isCredit)}</td>
                    <td style={{ ...tableStyles.td, fontWeight: 600, color: isCredit ? '#7c3aed' : undefined }} title={foreignCad ? `Invoice total ${Math.abs(Number(e.total_amount) || 0).toFixed(2)} ${amounts.invoiceCurrency}` : undefined}>
                      {formatExpenseMoney(amounts.total, isCredit)}
                    </td>
                    <td style={{ ...tableStyles.td, fontSize: 13, fontFamily: 'monospace' }}>{e.erpnext_purchase_invoice_id || '—'}</td>
                    <td style={tableStyles.td}>
                      {isCredit ? (
                        <span style={{ fontSize: 13, color: '#7c3aed', fontWeight: 600 }}>Credit memo</span>
                      ) : (
                        <span style={{ fontSize: 13, color: '#6b7280' }}>{e.source === 'email' ? 'Email' : e.source === 'bank_csv' ? 'Bank' : e.source || 'Manual'}</span>
                      )}
                    </td>
                    <td style={tableStyles.td}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: st.color, background: st.bg, padding: '4px 8px', borderRadius: 6 }}>{st.text}</span>
                    </td>
                    <td style={{ ...tableStyles.td, whiteSpace: 'nowrap' }}>
                      {(e.invoice_file_path || e.attachment_id) && (
                        <button type="button" style={tableStyles.iconBtn} onClick={() => handleOpenInvoice(e)} disabled={openingId === e.id} title="Open invoice PDF">
                          {openingId === e.id ? <FiLoader /> : <FiExternalLink />}
                        </button>
                      )}
                      {(e.status === 'posted' || e.status === 'approved') && (
                        <button type="button" style={{ ...tableStyles.iconBtn, color: '#6b7280' }} onClick={() => handleUnapprove(e)} disabled={unapprovingId === e.id} title="Un-approve and return to draft">
                          {unapprovingId === e.id ? <FiLoader /> : <FiRotateCcw />} Un-approve
                        </button>
                      )}
                      {e.status === 'draft' && (
                        <button type="button" style={{ ...tableStyles.iconBtn, color: TavariStyles?.colors?.primary || '#008080' }} onClick={() => navigate('/dashboard/accounting/queue')} title="Review in queue">
                          <FiCheck /> Review
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
