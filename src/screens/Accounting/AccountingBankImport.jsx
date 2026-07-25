import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { formatAccountingDateLabel, getCurrentBusinessDate, resolveAccountingTimezone } from '../../utils/businessDateFormat';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { FiArrowLeft, FiUpload, FiChevronDown, FiChevronRight, FiPlus, FiTrash2, FiChevronUp, FiLink, FiCheck, FiLoader, FiSearch } from 'react-icons/fi';
import AccountingDraftExpenseForm from './AccountingDraftExpenseForm';
import AccountingDepositMatchModal from './AccountingDepositMatchModal';
import { ensureBaselineExpenseCategories } from './accountingDefaults';
import { useErpNextAccounts } from '../../hooks/useErpNextAccounts';
import { logAccountingEvent } from './accountingAudit';
import AccountingPlaidConnect from './AccountingPlaidConnect';
import { getDraftBankMatchAmount } from '../../utils/accountingDraftAmounts';
import { logicalAccountFromErpNextName } from '../../utils/erpnextGlAccount';

/** YYYY-MM from a date string or Date. */
function toYearMonth(value) {
  if (!value) return '';
  const s = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  return '';
}

/** Store as first-of-month DATE. */
function yearMonthToStatementDate(ym) {
  const key = toYearMonth(ym);
  return key ? `${key}-01` : null;
}

function formatStatementMonthLabel(value) {
  const ym = toYearMonth(value);
  if (!ym) return '';
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-CA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Default to previous calendar month in the business timezone (typical statement upload). */
function defaultStatementMonth(businessTimezone) {
  const today = getCurrentBusinessDate(businessTimezone);
  const [y, m] = String(today).slice(0, 10).split('-').map(Number);
  if (!y || !m) return '';
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  return `${prevY}-${String(prevM).padStart(2, '0')}`;
}

/** Most common transaction month in the CSV, if any. */
function inferStatementMonthFromTransactions(transactions) {
  const counts = new Map();
  for (const tx of transactions || []) {
    const ym = toYearMonth(tx.transaction_date);
    if (!ym) continue;
    counts.set(ym, (counts.get(ym) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [ym, count] of counts.entries()) {
    if (count > bestCount || (count === bestCount && ym > best)) {
      best = ym;
      bestCount = count;
    }
  }
  return best;
}

function compareImportsByStatementMonth(a, b) {
  const am = toYearMonth(a?.statement_month) || '';
  const bm = toYearMonth(b?.statement_month) || '';
  if (am !== bm) {
    if (!am) return 1;
    if (!bm) return -1;
    return bm.localeCompare(am);
  }
  const at = a?.imported_at ? new Date(a.imported_at).getTime() : 0;
  const bt = b?.imported_at ? new Date(b.imported_at).getTime() : 0;
  return bt - at;
}

// Parse CSV line handling quoted fields
function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (inQuotes) {
      cur += c;
    } else if (c === ',' || c === '\t') {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

// Detect column indices from header or first row (date, description, payee/sub description, amount, debit/credit)
function detectColumns(row) {
  const lower = row.map((c) => String(c).toLowerCase().trim());
  let dateIdx = lower.findIndex((c) => c === 'date' || c === 'transaction date' || c === 'trans date');
  let descIdx = lower.findIndex((c) => c === 'description' || c === 'memo' || c === 'details');
  let payeeIdx = lower.findIndex((c) =>
    c === 'payee' || c === 'sub description' || c === 'sub_description' || c === 'sub-description' ||
    c === 'company' || c === 'counterparty' || c === 'payee name' || c === 'vendor' || c === 'name'
  );
  let amountIdx = lower.findIndex((c) => c === 'amount' || c === 'debit' || c === 'credit');
  let debitCreditIdx = lower.findIndex((c) =>
    c === 'debit_credit' || c === 'debit/credit' || c === 'type' || c.startsWith('type ') || c.includes('type of')
  );
  if (dateIdx === -1) dateIdx = 0;
  if (descIdx === -1) descIdx = 1;
  if (amountIdx === -1) amountIdx = 2;
  if (debitCreditIdx === -1) debitCreditIdx = 3;
  return { dateIdx, descIdx, payeeIdx, amountIdx, debitCreditIdx };
}

function parseAmount(val) {
  if (val == null || val === '') return null;
  const s = String(val).replace(/,/g, '').replace(/[$]/g, '').trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function parseDate(val) {
  if (val == null || val === '') return null;
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function normalizeDebitCredit(val) {
  if (val == null || val === '') return null;
  const v = String(val).toLowerCase().trim();
  if (v === 'debit' || v === 'd' || v === 'withdrawal' || v === 'out') return 'debit';
  if (v === 'credit' || v === 'c' || v === 'deposit' || v === 'in') return 'credit';
  return null;
}

const round2 = (n) => (n != null && !Number.isNaN(n) ? Math.round(Number(n) * 100) / 100 : null);
const DATE_WINDOW_DAYS = 60;
function inDateWindow(txDate, expenseDate) {
  if (!txDate || !expenseDate) return false;
  const expenseDateMs = new Date(expenseDate).getTime();
  const d = new Date(txDate).getTime();
  const diff = Math.abs(d - expenseDateMs);
  return diff <= DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

function getSupabaseErrorMessage(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const msg = err.message ?? err.details ?? err.hint ?? err.code;
  if (msg) return String(msg);
  if (typeof err.toString === 'function' && err.toString() !== '[object Object]') return err.toString();
  const parts = [];
  let o = err;
  while (o && typeof o === 'object') {
    for (const key of Object.getOwnPropertyNames(o)) {
      try {
        const v = o[key];
        if (typeof v === 'string' && v.length > 0 && !parts.includes(v)) parts.push(v);
      } catch (_) { /* ignore */ }
    }
    o = Object.getPrototypeOf(o);
  }
  if (parts.length > 0) return parts.join(' ');
  try {
    const s = JSON.stringify(err);
    if (s && s !== '{}') return s;
  } catch (_) { /* ignore */ }
  return 'Unknown error';
}

/** Returns { ok, errorMessage } so callers can show the real error. */
async function linkDraftsToBankTransaction(supabaseClient, bankTransactionId, draftIds, { markPosted = false } = {}) {
  if (!draftIds?.length) return { ok: false, errorMessage: 'No drafts to link' };
  const rows = draftIds.map((draftId) => ({ bank_transaction_id: bankTransactionId, draft_expense_id: draftId }));
  const { error: insertErr } = await supabaseClient
    .from('accounting_bank_transaction_draft_matches')
    .insert(rows);
  if (insertErr) {
    const insertMsg = getSupabaseErrorMessage(insertErr) || 'Insert failed';
    const isDuplicate = /duplicate|unique|23505/i.test(insertMsg);
    if (isDuplicate) {
      // Row already exists; proceed to update bank tx
    } else {
      const noDetails = !insertMsg || insertMsg === 'Unknown error' || insertMsg === 'Insert failed';
      const friendlyMsg = noDetails
        ? 'Link failed. Run the database migration that creates the table accounting_bank_transaction_draft_matches (see Supabase migrations).'
        : insertMsg;
      return { ok: false, errorMessage: friendlyMsg };
    }
  }
  const firstDraftId = draftIds[0];
  const { error: updateErr } = await supabaseClient
    .from('accounting_bank_transactions')
    .update({
      matched_draft_expense_id: firstDraftId,
      status: markPosted ? 'posted' : 'matched',
    })
    .eq('id', bankTransactionId);
  if (updateErr) {
    const updateMsg = getSupabaseErrorMessage(updateErr) || 'Update failed';
    console.error('Link bank tx update failed:', updateMsg, updateErr);
    return { ok: false, errorMessage: updateMsg };
  }
  return { ok: true };
}

function expenseIsPosted(expense) {
  const s = String(expense?.status || '').toLowerCase();
  return s === 'posted' || s === 'approved';
}

function expenseMatchAmount(expense) {
  const amt = getDraftBankMatchAmount(expense);
  if (amt != null) return round2(amt);
  if (expense?.total_amount == null) return null;
  return Math.abs(round2(Number(expense.total_amount)));
}

/** Prefer draft matches, then posted — same amount + date window, not already linked. */
function getPossibleMatchForTx(tx, rows, expenses, alreadyLinkedExpenseIds) {
  if (!tx || tx.matched_draft_expense_id || tx.debit_credit !== 'debit' || !expenses?.length) return null;
  const linkedInImport = new Set((rows || []).map((t) => t.matched_draft_expense_id).filter(Boolean));
  const linked = new Set([...(alreadyLinkedExpenseIds || []), ...linkedInImport]);
  const amount = Math.abs(round2(Number(tx.amount)));
  const candidates = expenses.filter((d) => {
    if (linked.has(d.id)) return false;
    const expAmt = expenseMatchAmount(d);
    if (expAmt == null || Math.abs(expAmt - amount) > 0.009) return false;
    return inDateWindow(tx.transaction_date, d.transaction_date || d.invoice_date);
  });
  if (!candidates.length) return null;
  const draftsFirst = candidates.find((d) => !expenseIsPosted(d));
  return draftsFirst || candidates[0];
}

const AccountingBankImport = ({ embedded = false, viewMode = 'full', hideTitle = false }) => {
  const navigate = useNavigate();
  const { selectedBusinessId, selectedBusiness } = useBusinessContext();
  const { authLoading } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'AccountingBankImport'
  });
  const [imports, setImports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [transactionsByImport, setTransactionsByImport] = useState({});
  const [vendors, setVendors] = useState([]);
  const [categories, setCategories] = useState([]);
  const [createExpenseTx, setCreateExpenseTx] = useState(null);
  const [createDepositTx, setCreateDepositTx] = useState(null);
  const [createPaymentTx, setCreatePaymentTx] = useState(null);
  const [paymentFromAccount, setPaymentFromAccount] = useState('');
  const [paymentPosting, setPaymentPosting] = useState(false);
  const [txSortBy, setTxSortBy] = useState(null);
  const [txSortDir, setTxSortDir] = useState('asc');
  const [matchableExpenses, setMatchableExpenses] = useState([]);
  const [alreadyLinkedExpenseIds, setAlreadyLinkedExpenseIds] = useState(new Set());
  const [linkingTxId, setLinkingTxId] = useState(null);
  const [approvingBankTxId, setApprovingBankTxId] = useState(null);
  const [bankSubTab, setBankSubTab] = useState('pending');
  const [postedDraftIds, setPostedDraftIds] = useState(new Set());
  const [matchPicker, setMatchPicker] = useState(null); // { tx, importId }
  const [matchPickerSearch, setMatchPickerSearch] = useState('');
  const [bankAccountForUpload, setBankAccountForUpload] = useState('');
  const [statementMonthForUpload, setStatementMonthForUpload] = useState('');
  const [showCreateAccountModal, setShowCreateAccountModal] = useState(false);
  const [creatingSourceAccount, setCreatingSourceAccount] = useState(false);
  const [newSourceAccount, setNewSourceAccount] = useState({ account_name: '', account_kind: 'bank' });
  const { accounts: erpnextAccounts, accountOptions: erpnextAccountOptions, refreshAccounts } = useErpNextAccounts(selectedBusinessId);
  const likelySourceAccounts = erpnextAccountOptions
    .filter((account) => {
      const name = String(account?.name || '');
      const accountType = String(account?.account_type || '').toLowerCase();
      const rootType = String(account?.root_type || '').toLowerCase();
      const reportType = String(account?.report_type || '').toLowerCase();
      const nameLooksLikeSource = /bank|cash|checking|chequing|current|credit\s*card|card|visa|master\s*card|mastercard|amex|american\s+express|overdraft/i.test(name);

      if (accountType === 'bank' || accountType === 'cash') return true;
      if (accountType === 'credit card') return true;
      if ((rootType === 'asset' || rootType === 'liability') && reportType === 'balance sheet' && nameLooksLikeSource) return true;
      return false;
    })
    .map((account) => account.name);
  const selectableUploadAccounts = (
    likelySourceAccounts.length > 0
      ? Array.from(new Set([
          ...likelySourceAccounts,
          ...(bankAccountForUpload && erpnextAccounts.includes(bankAccountForUpload) ? [bankAccountForUpload] : [])
        ]))
      : erpnextAccounts
  ).sort((a, b) => a.localeCompare(b));
  const showingFilteredSourceAccounts = likelySourceAccounts.length > 0;

  useEffect(() => {
    if (!selectedBusinessId) return;
    (async () => {
      setLoading(true);
      try {
        const [importsRes, vendorsRes, categoriesRes, matchableRes, postedRes, configRes] = await Promise.all([
          supabase.from('accounting_bank_imports').select('*').eq('business_id', selectedBusinessId).order('imported_at', { ascending: false }),
          supabase.from('accounting_vendors').select('*').eq('business_id', selectedBusinessId).order('name'),
          supabase.from('accounting_expense_categories').select('id, name, default_hst_treatment, parent_id, gl_account_erpnext').eq('business_id', selectedBusinessId).order('sort_order').order('name'),
          supabase
            .from('accounting_draft_expenses')
            .select('id, total_amount, cad_settlement_total, invoice_currency, transaction_date, invoice_date, vendor_name_display, invoice_number, status, document_type')
            .eq('business_id', selectedBusinessId)
            .in('status', ['draft', 'on_hold', 'posted', 'approved'])
            .order('transaction_date', { ascending: false })
            .limit(3000),
          supabase.from('accounting_draft_expenses').select('id').eq('business_id', selectedBusinessId).in('status', ['posted', 'approved']),
          supabase.from('accounting_business_config').select('default_bank_account_erpnext').eq('business_id', selectedBusinessId).maybeSingle()
        ]);
        if (importsRes.error) {
          setLoading(false);
          toast.error('Failed to load imports');
          return;
        }
        setImports((importsRes.data || []).slice().sort(compareImportsByStatementMonth));
        setVendors(vendorsRes.data || []);
        const matchable = matchableRes.data || [];
        setMatchableExpenses(matchable);
        setPostedDraftIds(new Set((postedRes.data || []).map((d) => d.id)));
        const importIds = (importsRes.data || []).map((i) => i.id);
        if (importIds.length > 0) {
          const { data: linkedRows } = await supabase
            .from('accounting_bank_transactions')
            .select('matched_draft_expense_id')
            .in('import_id', importIds)
            .not('matched_draft_expense_id', 'is', null);
          setAlreadyLinkedExpenseIds(new Set((linkedRows || []).map((r) => r.matched_draft_expense_id).filter(Boolean)));
        } else {
          setAlreadyLinkedExpenseIds(new Set());
        }
        let cats = categoriesRes.data || [];
        const inserted = await ensureBaselineExpenseCategories(supabase, selectedBusinessId);
        if (inserted) {
          const { data: refetched } = await supabase.from('accounting_expense_categories').select('id, name, default_hst_treatment, parent_id, gl_account_erpnext').eq('business_id', selectedBusinessId).order('sort_order').order('name');
          cats = refetched || [];
        }
        setCategories(cats);
        if (configRes.data?.default_bank_account_erpnext) {
          setBankAccountForUpload((prev) => prev || configRes.data.default_bank_account_erpnext);
        }
        setStatementMonthForUpload((prev) => prev || defaultStatementMonth(resolveAccountingTimezone(null, selectedBusiness)));
      } catch (error) {
        console.error('Failed to ensure accounting expense categories:', error);
        toast.error(error?.message || 'Failed to load accounting bank import data');
      }
      setLoading(false);
    })();
  }, [selectedBusinessId]);

  useEffect(() => {
    if (bankSubTab === 'posted' && selectedBusinessId) {
      supabase
        .from('accounting_draft_expenses')
        .select('id')
        .eq('business_id', selectedBusinessId)
        .in('status', ['posted', 'approved'])
        .then(({ data }) => setPostedDraftIds(new Set((data || []).map((d) => d.id))));
    }
  }, [bankSubTab, selectedBusinessId]);

  useEffect(() => {
    if (viewMode === 'posted') setBankSubTab('posted');
    else if (viewMode === 'excluded') setBankSubTab('excluded');
    else if (viewMode === 'pending') setBankSubTab('pending');
  }, [viewMode]);

  const loadTransactions = async (importId) => {
    if (transactionsByImport[importId]) {
      setExpandedId((prev) => (prev === importId ? null : importId));
      return;
    }
    const { data, error } = await supabase
      .from('accounting_bank_transactions')
      .select('*')
      .eq('import_id', importId)
      .order('transaction_date', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) {
      toast.error('Failed to load transactions');
      return;
    }
    setTransactionsByImport((prev) => ({ ...prev, [importId]: data || [] }));
    setExpandedId(importId);
  };

  const handleTxSort = (column) => {
    setTxSortBy(column);
    setTxSortDir((prevDir) => (txSortBy === column ? (prevDir === 'asc' ? 'desc' : 'asc') : 'asc'));
  };

  const formatDate = (d) => formatAccountingDateLabel(d, resolveAccountingTimezone(null, selectedBusiness));
  const formatMoney = (n) => (n != null ? '$' + Number(n).toFixed(2) : '—');
  const effectiveView = viewMode === 'full' ? bankSubTab : viewMode;
  const showUploadSection = viewMode === 'full' || viewMode === 'upload';

  const getDisplayStatus = (tx) => {
    if (tx?.matched_draft_expense_id && postedDraftIds.has(tx.matched_draft_expense_id)) return 'posted';
    if (tx?.status === 'posted') return 'posted';
    if (tx?.matched_deposit_id && tx?.status !== 'excluded') return 'matched';
    if (tx?.status === 'matched') return 'matched';
    if (tx?.status === 'excluded') return 'excluded';
    return tx?.status || 'pending';
  };

  const shouldIncludeTransaction = (tx) => {
    const displayStatus = getDisplayStatus(tx);
    if (effectiveView === 'posted') return displayStatus === 'posted';
    if (effectiveView === 'excluded') return displayStatus === 'excluded';
    if (effectiveView === 'pending') return displayStatus !== 'posted' && displayStatus !== 'excluded';
    return true;
  };

  const getPageTitle = () => {
    if (viewMode === 'upload') return 'Bank Upload';
    if (viewMode === 'pending') return 'Pending Transactions';
    if (viewMode === 'posted') return 'Posted Transactions';
    if (viewMode === 'excluded') return 'Excluded Transactions';
    return 'Bank Import';
  };

  const getPageDescription = () => {
    if (viewMode === 'upload') return 'Upload a bank or credit card CSV, choose the real source account it came from, and then review the imported transactions underneath.';
    if (viewMode === 'pending') return 'Transactions that still need to be categorized, matched, approved, or excluded.';
    if (viewMode === 'posted') return 'Transactions already posted to ERPNext through the bank workflow.';
    if (viewMode === 'excluded') return 'Transactions intentionally removed from the posting workflow.';
    return 'Upload a CSV with columns: date, description, optional payee or sub description, amount, and optionally debit/credit. A header row is optional.';
  };

  const getSignedTransactionAmount = (tx) => {
    const rawAmount = Number(tx?.amount);
    const abs = Number.isFinite(rawAmount) ? Math.abs(rawAmount) : 0;
    const dc = String(tx?.debit_credit || '').toLowerCase();
    if (dc === 'debit' || dc === 'd') return -abs;
    if (dc === 'credit' || dc === 'c') return abs;
    // Fallback: signed amount column, or treat positive as credit
    if (Number.isFinite(rawAmount) && rawAmount !== 0) return rawAmount;
    return abs;
  };

  const isDebitTransaction = (tx) => {
    const dc = String(tx?.debit_credit || '').toLowerCase();
    if (dc === 'debit' || dc === 'd') return true;
    if (dc === 'credit' || dc === 'c') return false;
    return getSignedTransactionAmount(tx) < 0;
  };

  const getImportSourceAccount = (tx) => {
    const importId = tx?.import_id;
    return imports.find((item) => item.id === importId)?.bank_account_erpnext || bankAccountForUpload || '';
  };

  const looksLikeCardOrClearingAccount = (accountName) =>
    /credit\s*card|cash on hand|4516|clearing|owed to|visa|master\s*card|mastercard|amex/i.test(String(accountName || ''));

  const looksLikeCardPaymentDescription = (tx) =>
    /^(payment|paid|autopay|auto\s*pay|thank you|payment received)\b|\bpayment\b.*\b(bns|visa|master|amex|card)\b|\b(bns|bank)\b.*\bpayment\b/i.test(
      `${tx?.description || ''} ${tx?.payee || ''}`.trim()
    );

  const openAddTransactionModal = (tx) => {
    setCreateExpenseTx(null);
    setCreateDepositTx(null);
    setCreatePaymentTx(null);
    if (isDebitTransaction(tx)) {
      // Purchases/charges → expense. Only bank→card payments use the payment modal.
      const source = getImportSourceAccount(tx);
      if (!looksLikeCardOrClearingAccount(source) && looksLikeCardPaymentDescription(tx)) {
        const preferredCard =
          selectableUploadAccounts.find((a) => looksLikeCardOrClearingAccount(a)) || '';
        setPaymentFromAccount(preferredCard);
        setCreatePaymentTx({ ...tx, paymentDirection: 'bank_to_card' });
        return;
      }
      setCreateExpenseTx(tx);
      return;
    }
    // Credits: card payments only when description looks like a payment; otherwise sales deposit / refund flow.
    if (looksLikeCardPaymentDescription(tx)) {
      const preferredBank =
        bankAccountForUpload
        || selectableUploadAccounts.find((a) => /bank\s*-\s*operating|operating|chequing|checking/i.test(a) && !looksLikeCardOrClearingAccount(a))
        || selectableUploadAccounts.find((a) => /bank|operating|chequing|checking/i.test(a) && !looksLikeCardOrClearingAccount(a))
        || '';
      setPaymentFromAccount(preferredBank);
      setCreatePaymentTx({ ...tx, paymentDirection: 'card_payment' });
      return;
    }
    setCreateDepositTx(tx);
  };

  const handlePostCardPayment = async () => {
    if (!selectedBusinessId || !createPaymentTx) return;
    const tx = createPaymentTx;
    const amount = Math.abs(round2(Number(tx.amount)) || 0);
    if (!amount) {
      toast.error('Payment amount is missing');
      return;
    }
    const statementAccount = getImportSourceAccount(tx);
    const otherAccount = (paymentFromAccount || '').trim();
    if (!statementAccount || !otherAccount) {
      toast.error(
        tx.paymentDirection === 'card_payment'
          ? 'Choose which bank account paid this card.'
          : 'Choose which card/clearing account this bank payment went to.'
      );
      return;
    }
    if (statementAccount === otherAccount) {
      toast.error('The two accounts must be different.');
      return;
    }
    // Card statement credit (payment received): Dr card/clearing, Cr bank
    // Bank statement debit (paying the card): Dr card/clearing, Cr bank
    const debitAccount = tx.paymentDirection === 'card_payment' ? statementAccount : otherAccount;
    const creditAccount = tx.paymentDirection === 'card_payment' ? otherAccount : statementAccount;

    setPaymentPosting(true);
    try {
      const remark = `Card payment · ${tx.description || tx.payee || 'statement'} · ${tx.transaction_date || ''}`.slice(0, 140);
      const { data, error } = await supabase.functions.invoke('accounting-post-journal', {
        body: {
          business_id: selectedBusinessId,
          posting_date: tx.transaction_date,
          remark,
          accounts: [
            { account: debitAccount, debit: amount, credit: 0 },
            { account: creditAccount, debit: 0, credit: amount },
          ],
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const jeName = data?.erpnext_journal_entry_id || data?.name || null;
      await supabase
        .from('accounting_bank_transactions')
        .update({
          status: 'posted',
          erpnext_journal_entry_id: jeName,
        })
        .eq('id', tx.id);
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'bank_tx_card_payment_posted',
        entityType: 'accounting_bank_transaction',
        entityId: tx.id,
        details: {
          amount,
          debit_account: debitAccount,
          credit_account: creditAccount,
          erpnext_journal_entry_id: jeName,
        },
      });
      toast.success('Payment posted.');
      await refreshImportTransactions(tx.import_id);
      setCreatePaymentTx(null);
      setPaymentFromAccount('');
    } catch (e) {
      toast.error(e?.message || 'Failed to post payment');
    } finally {
      setPaymentPosting(false);
    }
  };

  const refreshImportTransactions = async (importId) => {
    if (!importId) return;
    const { data } = await supabase
      .from('accounting_bank_transactions')
      .select('*')
      .eq('import_id', importId)
      .order('transaction_date', { ascending: true })
      .order('created_at', { ascending: true });
    setTransactionsByImport((prev) => ({ ...prev, [importId]: data || [] }));
  };

  const updateTransactionStatus = async (tx, importId, nextStatus) => {
    const payload = nextStatus === 'pending'
      ? { status: 'pending' }
      : { status: nextStatus };
    const { error } = await supabase
      .from('accounting_bank_transactions')
      .update(payload)
      .eq('id', tx.id);
    if (error) {
      toast.error(error.message || 'Failed to update transaction');
      return;
    }
    await refreshImportTransactions(importId);
    toast.success(nextStatus === 'excluded' ? 'Transaction excluded' : 'Transaction restored');
  };

  const handleCreateSourceAccount = async () => {
    if (!selectedBusinessId) return;
    const accountName = (newSourceAccount.account_name || '').trim();
    if (!accountName) {
      toast.error('Enter the new account name first.');
      return;
    }
    setCreatingSourceAccount(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('Your session expired. Please log in again and retry.');

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/accounting-create-source-account`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          business_id: selectedBusinessId,
          account_name: accountName,
          account_kind: newSourceAccount.account_kind
        })
      });

      const rawText = await response.text();
      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = { error: rawText || `Request failed with status ${response.status}` };
      }

      if (!response.ok) {
        throw new Error(data?.error || data?.message || `Request failed with status ${response.status}`);
      }
      if (data?.error) throw new Error(data.error);

      await refreshAccounts();
      setBankAccountForUpload(data?.account?.name || accountName);
      setShowCreateAccountModal(false);
      setNewSourceAccount({ account_name: '', account_kind: 'bank' });
      toast.success(`Created source account ${data?.account?.name || accountName}`);
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'bank_source_account_created',
        entityType: 'erpnext_account',
        entityId: data?.account?.name || accountName,
        details: { account_kind: newSourceAccount.account_kind }
      });
    } catch (e) {
      toast.error(e?.message || 'Failed to create source account');
    } finally {
      setCreatingSourceAccount(false);
    }
  };

  const handleApproveBankTx = async (tx, importId) => {
    const draftId = tx.matched_draft_expense_id;
    if (!selectedBusinessId || !draftId) return;
    setApprovingBankTxId(tx.id);
    try {
      const linkedExpense = matchableExpenses.find((d) => d.id === draftId);
      const alreadyPosted = expenseIsPosted(linkedExpense) || postedDraftIds.has(draftId);
      if (alreadyPosted) {
        const { data: draftRow } = await supabase
          .from('accounting_draft_expenses')
          .select('erpnext_journal_entry_id, erpnext_purchase_invoice_id, status')
          .eq('id', draftId)
          .maybeSingle();
        await supabase
          .from('accounting_bank_transactions')
          .update({
            status: 'posted',
            erpnext_journal_entry_id: draftRow?.erpnext_journal_entry_id || null,
          })
          .eq('id', tx.id);
        await logAccountingEvent({
          businessId: selectedBusinessId,
          action: 'bank_tx_matched_posted_expense',
          entityType: 'accounting_bank_transaction',
          entityId: tx.id,
          details: { draft_id: draftId, erpnext_purchase_invoice_id: draftRow?.erpnext_purchase_invoice_id || null },
        });
        await refreshImportTransactions(importId);
        toast.success('Matched to posted expense; bank transaction marked posted.');
        setApprovingBankTxId(null);
        return;
      }

      const { data, error } = await supabase.functions.invoke('accounting-post-expense', {
        body: { business_id: selectedBusinessId, draft_id: draftId, bank_account_erpnext: imports.find((item) => item.id === importId)?.bank_account_erpnext || null }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const { data: draftRow } = await supabase
        .from('accounting_draft_expenses')
        .select('erpnext_journal_entry_id, erpnext_purchase_invoice_id, erpnext_payment_entry_id')
        .eq('id', draftId)
        .single();
      await supabase
        .from('accounting_bank_transactions')
        .update({
          status: 'posted',
          erpnext_journal_entry_id: draftRow?.erpnext_journal_entry_id || data?.erpnext_journal_entry_id || null
        })
        .eq('id', tx.id);
      setPostedDraftIds((prev) => new Set([...prev, draftId]));
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'bank_tx_approved',
        entityType: 'accounting_bank_transaction',
        entityId: tx.id,
        details: {
          draft_id: draftId,
          erpnext_purchase_invoice_id: draftRow?.erpnext_purchase_invoice_id || data?.erpnext_purchase_invoice_id || null,
          erpnext_journal_entry_id: draftRow?.erpnext_journal_entry_id || data?.erpnext_journal_entry_id || null
        }
      });
      await refreshImportTransactions(importId);
      toast.success('Expense posted to ERPNext; bank transaction marked posted.');
    } catch (e) {
      toast.error(e?.message || 'Failed to approve');
    }
    setApprovingBankTxId(null);
  };

  const handleLinkExpense = async (tx, importId, expense) => {
    if (!expense?.id || !tx?.id) return;
    setLinkingTxId(tx.id);
    const markPosted = expenseIsPosted(expense);
    const result = await linkDraftsToBankTransaction(supabase, tx.id, [expense.id], { markPosted });
    setLinkingTxId(null);
    if (result.ok) {
      // Only sync payment date onto drafts still awaiting approval — not already-posted books.
      if (!markPosted && tx.transaction_date) {
        await supabase.from('accounting_draft_expenses').update({ transaction_date: tx.transaction_date }).eq('id', expense.id);
      }
      setAlreadyLinkedExpenseIds((prev) => new Set([...prev, expense.id]));
      if (markPosted) setPostedDraftIds((prev) => new Set([...prev, expense.id]));
      toast.success(
        markPosted
          ? 'Linked to posted expense. Statement line marked posted.'
          : 'Linked draft to bank transaction. Payment date set to bank transaction date.'
      );
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: markPosted ? 'bank_tx_linked_posted_expense' : 'bank_tx_linked',
        entityType: 'accounting_bank_transaction',
        entityId: tx.id,
        details: { draft_id: expense.id, expense_status: expense.status },
      });
      await refreshImportTransactions(importId);
      setMatchPicker(null);
      setMatchPickerSearch('');
    } else {
      toast.error(result.errorMessage || 'Failed to link');
    }
  };

  const handleLinkPossibleMatch = async (tx, importId, draft) => {
    await handleLinkExpense(tx, importId, draft);
  };

  const matchPickerCandidates = useMemo(() => {
    if (!matchPicker?.tx) return [];
    const tx = matchPicker.tx;
    const amount = Math.abs(round2(Number(tx.amount)));
    const q = matchPickerSearch.trim().toLowerCase();
    const linked = alreadyLinkedExpenseIds;
    return (matchableExpenses || [])
      .filter((d) => !linked.has(d.id) && d.id !== tx.matched_draft_expense_id)
      .filter((d) => {
        if (!q) return true;
        const hay = [
          d.vendor_name_display,
          d.invoice_number,
          d.transaction_date,
          d.invoice_date,
          d.status,
          expenseMatchAmount(d) != null ? expenseMatchAmount(d).toFixed(2) : '',
        ].join(' ').toLowerCase();
        return hay.includes(q);
      })
      .map((d) => {
        const expAmt = expenseMatchAmount(d);
        const amountDiff = expAmt == null ? null : Math.abs(expAmt - amount);
        const dateOk = inDateWindow(tx.transaction_date, d.transaction_date || d.invoice_date);
        let score = 0;
        if (amountDiff != null && amountDiff <= 0.009) score += 100;
        else if (amountDiff != null && amountDiff <= 1) score += 40;
        if (dateOk) score += 30;
        if (!expenseIsPosted(d)) score += 10;
        return { expense: d, expAmt, amountDiff, dateOk, score };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const da = a.expense.transaction_date || '';
        const db = b.expense.transaction_date || '';
        return db.localeCompare(da);
      });
  }, [matchPicker, matchPickerSearch, matchableExpenses, alreadyLinkedExpenseIds]);

  const sortTransactions = (rows) => {
    if (!txSortBy || !rows.length) return rows;
    const dir = txSortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      let va = a[txSortBy];
      let vb = b[txSortBy];
      if (txSortBy === 'amount') {
        va = Number(va);
        vb = Number(vb);
        return dir * (va - vb);
      }
      va = (va ?? '').toString().toLowerCase();
      vb = (vb ?? '').toString().toLowerCase();
      return dir * va.localeCompare(vb);
    });
  };

  const handleDeleteImport = async (imp) => {
    if (!confirm(`Delete this import and all its transactions?\n\n"${imp.file_name}"\n\nExpenses already created from these transactions will remain in the queue.`)) return;
    const { error } = await supabase.from('accounting_bank_imports').delete().eq('id', imp.id);
    if (error) {
      toast.error(error.message || 'Failed to delete import');
      return;
    }
    toast.success('Import deleted');
    await logAccountingEvent({
      businessId: selectedBusinessId,
      action: 'bank_import_deleted',
      entityType: 'accounting_bank_import',
      entityId: imp.id,
      details: { file_name: imp.file_name }
    });
    setImports((prev) => prev.filter((i) => i.id !== imp.id));
    setTransactionsByImport((prev) => {
      const next = { ...prev };
      delete next[imp.id];
      return next;
    });
    if (expandedId === imp.id) setExpandedId(null);
  };

  const handleCreateExpenseFromTx = async (payload) => {
    if (!selectedBusinessId || !createExpenseTx) return;
    const { data: draft, error: draftError } = await supabase
      .from('accounting_draft_expenses')
      .insert({
        business_id: selectedBusinessId,
        source: 'bank_csv',
        vendor_id: payload.vendor_id || null,
        vendor_name_display: payload.vendor_name_display || null,
        transaction_date: payload.transaction_date || null,
        invoice_date: payload.invoice_date || null,
        subtotal: payload.subtotal ?? null,
        tax_amount: payload.tax_amount ?? null,
        total_amount: payload.total_amount,
        invoice_number: payload.invoice_number || null,
        expense_category_id: payload.expense_category_id || null,
        gl_account_erpnext: payload.gl_account_erpnext || null,
        credit_account_erpnext: payload.credit_account_erpnext
          || logicalAccountFromErpNextName(imports.find((item) => item.id === createExpenseTx.import_id)?.bank_account_erpnext || '')
          || null,
        hst_treatment: payload.hst_treatment,
        invoice_file_path: payload.invoice_file_path || null
      })
      .select('id, total_amount, cad_settlement_total, invoice_currency, transaction_date, invoice_date, vendor_name_display, invoice_number, status, document_type')
      .single();
    if (draftError) {
      toast.error(draftError.message || 'Failed to create expense');
      return;
    }
    setMatchableExpenses((prev) => [draft, ...prev.filter((d) => d.id !== draft.id)]);
    const { error: matchErr } = await supabase
      .from('accounting_bank_transaction_draft_matches')
      .insert({ bank_transaction_id: createExpenseTx.id, draft_expense_id: draft.id });
    if (matchErr) {
      toast.error('Expense created but link failed');
      setCreateExpenseTx(null);
      return;
    }
    const { error: linkError } = await supabase
      .from('accounting_bank_transactions')
      .update({ matched_draft_expense_id: draft.id, status: 'matched' })
      .eq('id', createExpenseTx.id);
    if (linkError) {
      toast.error('Expense created but link to transaction failed');
    } else {
      toast.success('Expense created and linked to bank transaction');
      setAlreadyLinkedExpenseIds((prev) => new Set([...prev, draft.id]));
    }
    setCreateExpenseTx(null);
    const importId = createExpenseTx.import_id;
    const { data: txList } = await supabase
      .from('accounting_bank_transactions')
      .select('*')
      .eq('import_id', importId)
      .order('transaction_date', { ascending: true })
      .order('created_at', { ascending: true });
    setTransactionsByImport((prev) => ({ ...prev, [importId]: txList || [] }));
  };

  const handleDepositMatchSaved = async () => {
    if (!createDepositTx?.import_id) {
      setCreateDepositTx(null);
      return;
    }
    await refreshImportTransactions(createDepositTx.import_id);
    setCreateDepositTx(null);
  };

  const handleOpenDepositWorkspace = async (tx) => {
    if (!selectedBusinessId || !tx) return;
    if (tx.matched_deposit_id) {
      setCreateDepositTx(tx);
      return;
    }
    if (getDisplayStatus(tx) !== 'posted') {
      setCreateDepositTx(tx);
      return;
    }

    let depositQuery = supabase
      .from('accounting_deposits')
      .select('id')
      .eq('business_id', selectedBusinessId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (tx.erpnext_journal_entry_id) {
      depositQuery = depositQuery.eq('erpnext_journal_entry_id', tx.erpnext_journal_entry_id);
    } else {
      depositQuery = depositQuery
        .eq('deposit_date', tx.transaction_date)
        .eq('total_amount', Math.abs(Number(tx.amount) || 0))
        .eq('status', 'posted');
    }

    const { data: depositRows, error: depositLookupError } = await depositQuery;
    if (depositLookupError) {
      toast.error(depositLookupError.message || 'Failed to locate the linked deposit');
      return;
    }
    const depositId = depositRows?.[0]?.id;
    if (!depositId) {
      toast.error('No linked deposit record was found for this posted bank credit.');
      return;
    }

    const { error: bankTxUpdateError } = await supabase
      .from('accounting_bank_transactions')
      .update({ matched_deposit_id: depositId })
      .eq('id', tx.id);
    if (bankTxUpdateError) {
      toast.error(bankTxUpdateError.message || 'Failed to attach the deposit to this bank transaction');
      return;
    }

    await refreshImportTransactions(tx.import_id);
    setCreateDepositTx({ ...tx, matched_deposit_id: depositId });
  };

  const handleUpdateImportStatementMonth = async (imp, nextYearMonth) => {
    if (!imp?.id) return;
    const ym = toYearMonth(nextYearMonth);
    const statementMonth = yearMonthToStatementDate(ym);
    const { error } = await supabase
      .from('accounting_bank_imports')
      .update({ statement_month: statementMonth })
      .eq('id', imp.id);
    if (error) {
      toast.error(error.message || 'Failed to update statement month');
      return;
    }
    setImports((prev) => prev
      .map((row) => (row.id === imp.id ? { ...row, statement_month: statementMonth } : row))
      .slice()
      .sort(compareImportsByStatementMonth));
    toast.success(ym ? `Statement month set to ${formatStatementMonthLabel(ym)}` : 'Statement month cleared');
  };

  const handleFile = async (e) => {
    const file = e.target?.files?.[0];
    if (!file || !selectedBusinessId) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) {
      toast.error('File is empty');
      return;
    }
    const rows = lines.map((l) => parseCSVLine(l));
    const first = rows[0];
    const isHeader = first.some((c) => /^(date|description|amount|debit|credit|memo|type|payee|sub description|sub-description|company)$/i.test(String(c).trim()));
    const dataRows = isHeader ? rows.slice(1) : rows;
    const cols = detectColumns(first);

    const transactions = [];
    for (const row of dataRows) {
      const dateStr = row[cols.dateIdx];
      const desc = row[cols.descIdx] ?? '';
      const payee = cols.payeeIdx >= 0 && row[cols.payeeIdx] != null ? String(row[cols.payeeIdx]).trim() : '';
      const amountRaw = row[cols.amountIdx];
      let debitCredit = normalizeDebitCredit(row[cols.debitCreditIdx]);
      let amount = parseAmount(amountRaw);
      if (amount == null && amountRaw != null && amountRaw !== '') {
        amount = parseAmount(amountRaw);
      }
      if (amount != null && debitCredit == null) {
        debitCredit = amount >= 0 ? 'credit' : 'debit';
        amount = Math.abs(amount);
      }
      const date = parseDate(dateStr);
      if (!date) continue;
      if (amount == null || amount === 0) continue;
      if (!debitCredit) debitCredit = 'debit';
      transactions.push({
        transaction_date: date,
        description: String(desc).slice(0, 500),
        payee: payee.slice(0, 500),
        amount: Math.round(amount * 100) / 100,
        debit_credit: debitCredit
      });
    }

    if (transactions.length === 0) {
      toast.error('No valid transactions found. CSV should have date, description, amount, and optional debit/credit columns.');
      return;
    }
    if (!bankAccountForUpload) {
      toast.error('Choose the source bank or credit card account for this import first.');
      return;
    }
    const inferredMonth = inferStatementMonthFromTransactions(transactions);
    const statementMonthKey = toYearMonth(statementMonthForUpload) || inferredMonth;
    if (!statementMonthKey) {
      toast.error('Choose the statement month this CSV covers (e.g. May 2026).');
      return;
    }
    if (inferredMonth && statementMonthKey !== inferredMonth) {
      const ok = window.confirm(
        `Most transactions in this file look like ${formatStatementMonthLabel(inferredMonth)}, but you selected ${formatStatementMonthLabel(statementMonthKey)}.\n\nContinue with ${formatStatementMonthLabel(statementMonthKey)}?`
      );
      if (!ok) return;
    }

    setUploading(true);
    const { data: importRow, error: insertImportError } = await supabase
      .from('accounting_bank_imports')
      .insert({
        business_id: selectedBusinessId,
        file_name: file.name,
        bank_account_erpnext: bankAccountForUpload,
        statement_month: yearMonthToStatementDate(statementMonthKey),
        status: 'processed'
      })
      .select('id')
      .single();

    if (insertImportError) {
      setUploading(false);
      toast.error(insertImportError.message || 'Failed to create import');
      return;
    }

    const toInsert = transactions.map((t) => ({
      import_id: importRow.id,
      transaction_date: t.transaction_date,
      description: t.description,
      payee: t.payee || null,
      amount: t.amount,
      debit_credit: t.debit_credit
    }));

    const { error: txError } = await supabase.from('accounting_bank_transactions').insert(toInsert);
    setUploading(false);
    if (txError) {
      toast.error(txError.message || 'Failed to save transactions');
      await supabase.from('accounting_bank_imports').update({ status: 'failed', error_message: txError.message }).eq('id', importRow.id);
    } else {
      toast.success(`Imported ${transactions.length} transactions for ${formatStatementMonthLabel(statementMonthKey)} (${file.name}). Open the import below or go to Pending Transactions.`);
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'bank_csv_imported',
        entityType: 'accounting_bank_import',
        entityId: importRow.id,
        details: {
          file_name: file.name,
          transaction_count: transactions.length,
          bank_account_erpnext: bankAccountForUpload,
          statement_month: statementMonthKey,
        }
      });
    }

    const { data: list } = await supabase
      .from('accounting_bank_imports')
      .select('*')
      .eq('business_id', selectedBusinessId)
      .order('imported_at', { ascending: false });
    setImports((list || []).slice().sort(compareImportsByStatementMonth));

    // Auto-open the import we just created so transactions are visible immediately.
    if (!txError && importRow?.id) {
      const { data: txRows } = await supabase
        .from('accounting_bank_transactions')
        .select('*')
        .eq('import_id', importRow.id)
        .order('transaction_date', { ascending: true })
        .order('created_at', { ascending: true });
      setTransactionsByImport((prev) => ({ ...prev, [importRow.id]: txRows || [] }));
      setExpandedId(importRow.id);
    }
    e.target.value = '';
  };

  if (authLoading || !selectedBusinessId) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: TavariStyles?.colors?.gray600 }}>Loading...</div>
    );
  }

  return (
    <div className="accounting-bank-import" style={{ padding: embedded ? 0 : 24, paddingTop: embedded ? 0 : 100, width: '100%', maxWidth: 'none', margin: 0 }}>
      {!embedded && (
        <button
          type="button"
          style={styles.backButton}
          onClick={() => navigate('/dashboard/accounting')}
        >
          <FiArrowLeft /> Back
        </button>
      )}
      {!hideTitle && <h1 style={{ fontSize: embedded ? '1.25rem' : '1.5rem', marginBottom: 8 }}>{getPageTitle()}</h1>}
      {viewMode === 'full' && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
          <button
            type="button"
            onClick={() => setBankSubTab('pending')}
            style={{
              padding: '8px 16px',
              border: '1px solid ' + (TavariStyles?.colors?.gray300 || '#d1d5db'),
              borderRadius: 8,
              background: bankSubTab === 'pending' ? (TavariStyles?.colors?.primary || '#008080') : 'white',
              color: bankSubTab === 'pending' ? 'white' : '#374151',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500
            }}
          >
            Pending
          </button>
          <button
            type="button"
            onClick={() => setBankSubTab('posted')}
            style={{
              padding: '8px 16px',
              border: '1px solid ' + (TavariStyles?.colors?.gray300 || '#d1d5db'),
              borderRadius: 8,
              background: bankSubTab === 'posted' ? (TavariStyles?.colors?.primary || '#008080') : 'white',
              color: bankSubTab === 'posted' ? 'white' : '#374151',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500
            }}
          >
            Posted
          </button>
          <button
            type="button"
            onClick={() => setBankSubTab('excluded')}
            style={{
              padding: '8px 16px',
              border: '1px solid ' + (TavariStyles?.colors?.gray300 || '#d1d5db'),
              borderRadius: 8,
              background: bankSubTab === 'excluded' ? (TavariStyles?.colors?.primary || '#008080') : 'white',
              color: bankSubTab === 'excluded' ? 'white' : '#374151',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500
            }}
          >
            Excluded
          </button>
        </div>
      )}
      <p style={{ color: TavariStyles?.colors?.gray600, marginBottom: 24 }}>
        {getPageDescription()}
      </p>

      {showUploadSection && (
      <>
      <AccountingPlaidConnect
        onSynced={async () => {
          const { data: list } = await supabase
            .from('accounting_bank_imports')
            .select('*')
            .eq('business_id', selectedBusinessId)
            .order('imported_at', { ascending: false });
          setImports((list || []).slice().sort(compareImportsByStatementMonth));
        }}
      />
      <div style={styles.card}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Source bank / credit card account for this CSV</label>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: TavariStyles?.colors?.gray600 || '#6b7280', maxWidth: 720 }}>
            Pick the real account this statement came from, like your checking account or credit card. Do not choose the final expense or revenue category here. Each transaction gets categorized separately after import.
          </p>
          {!showingFilteredSourceAccounts && erpnextAccounts.length > 0 && (
            <p style={{ margin: '0 0 8px', fontSize: 13, color: '#92400e' }}>
              No clearly named bank or credit card accounts were detected, so the full ERPNext account list is shown. Choose the actual source statement account.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
            <select
              value={bankAccountForUpload}
              onChange={(e) => setBankAccountForUpload(e.target.value)}
              style={{ ...styles.select, minWidth: 320, flex: '1 1 320px' }}
            >
              <option value="">— Select source account —</option>
              {selectableUploadAccounts.map((account) => (
                <option key={account} value={account}>{account}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowCreateAccountModal(true)}
              style={{ ...styles.primaryButton, padding: '8px 14px', whiteSpace: 'nowrap' }}
              title="Create a new bank, cash, or credit card source account"
            >
              <FiPlus /> New Account
            </button>
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Statement month</label>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: TavariStyles?.colors?.gray600 || '#6b7280', maxWidth: 720 }}>
            Which month this statement covers — used to track month-end matching (not the upload date or file name). Defaults to last month.
          </p>
          <input
            type="month"
            value={statementMonthForUpload}
            onChange={(e) => setStatementMonthForUpload(e.target.value)}
            style={{ ...styles.select, minWidth: 220, maxWidth: 280 }}
          />
        </div>
        <label style={styles.uploadLabel}>
          <input
            type="file"
            accept=".csv,.txt"
            onChange={handleFile}
            disabled={uploading || !bankAccountForUpload || !statementMonthForUpload}
            style={{ display: 'none' }}
          />
          <span style={{
            ...styles.primaryButton,
            opacity: (uploading || !bankAccountForUpload || !statementMonthForUpload) ? 0.6 : 1,
            pointerEvents: (uploading || !bankAccountForUpload || !statementMonthForUpload) ? 'none' : 'auto',
          }}
          >
            <FiUpload /> {uploading ? 'Uploading…' : 'Choose CSV file'}
          </span>
        </label>
      </div>
      </>
      )}

      <h2 style={{ fontSize: '1.125rem', marginTop: 32, marginBottom: 16 }}>Past imports</h2>
      {loading ? (
        <p style={{ color: TavariStyles?.colors?.gray600 }}>Loading...</p>
      ) : imports.length === 0 ? (
        <div style={styles.card}>
          <p style={{ margin: 0, color: TavariStyles?.colors?.gray600 }}>No imports yet. Upload a CSV above.</p>
        </div>
      ) : (
        <div style={styles.card}>
          {imports.map((imp) => (
            <div key={imp.id} style={styles.importRow}>
              <div style={styles.importRowInner}>
                <button
                  type="button"
                  style={styles.expandButton}
                  onClick={() => loadTransactions(imp.id)}
                >
                  {expandedId === imp.id ? <FiChevronDown /> : <FiChevronRight />}
                  <span style={{ fontWeight: 700, color: TavariStyles?.colors?.primary || '#008080', minWidth: 96 }}>
                    {formatStatementMonthLabel(imp.statement_month) || 'No month'}
                  </span>
                  <span>{imp.file_name}</span>
                  <span style={styles.meta}>
                    {new Date(imp.imported_at).toLocaleString()} · {imp.status} · {imp.bank_account_erpnext || 'No bank account'}
                  </span>
                </button>
                <input
                  type="month"
                  value={toYearMonth(imp.statement_month)}
                  onChange={(e) => handleUpdateImportStatementMonth(imp, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  title="Statement month"
                  aria-label="Statement month"
                  style={{
                    ...styles.select,
                    width: 150,
                    minWidth: 150,
                    padding: '6px 8px',
                    fontSize: 13,
                  }}
                />
                <button
                  type="button"
                  style={styles.deleteImportButton}
                  onClick={(e) => { e.stopPropagation(); handleDeleteImport(imp); }}
                  title="Delete this import"
                  aria-label="Delete import"
                >
                  <FiTrash2 />
                </button>
              </div>
              {expandedId === imp.id && transactionsByImport[imp.id] != null && (
                <div style={styles.txTableWrap}>
                  {sortTransactions((transactionsByImport[imp.id] || []).filter(shouldIncludeTransaction)).length === 0 ? (
                    <p style={{ margin: 0, color: TavariStyles?.colors?.gray600 || '#6b7280' }}>
                      No {effectiveView === 'posted' ? 'posted' : effectiveView === 'excluded' ? 'excluded' : effectiveView === 'pending' ? 'pending' : ''} transactions in this import.
                    </p>
                  ) : (
                  <table style={styles.txTable}>
                    <thead>
                      <tr>
                        <th style={styles.thSort} onClick={() => handleTxSort('transaction_date')} title="Sort by date">
                          <span style={styles.thSortContent}>Date {txSortBy === 'transaction_date' ? (txSortDir === 'asc' ? <FiChevronUp size={12} /> : <FiChevronDown size={12} />) : null}</span>
                        </th>
                        <th style={styles.thSort} onClick={() => handleTxSort('payee')} title="Sort A–Z / Z–A">
                          <span style={styles.thSortContent}>Payee {txSortBy === 'payee' ? (txSortDir === 'asc' ? <FiChevronUp size={12} /> : <FiChevronDown size={12} />) : null}</span>
                        </th>
                        <th style={styles.thSort} onClick={() => handleTxSort('description')} title="Sort A–Z / Z–A">
                          <span style={styles.thSortContent}>Description {txSortBy === 'description' ? (txSortDir === 'asc' ? <FiChevronUp size={12} /> : <FiChevronDown size={12} />) : null}</span>
                        </th>
                        <th style={styles.thSort} onClick={() => handleTxSort('amount')} title="Sort low to high / high to low">
                          <span style={styles.thSortContent}>Amount {txSortBy === 'amount' ? (txSortDir === 'asc' ? <FiChevronUp size={12} /> : <FiChevronDown size={12} />) : null}</span>
                        </th>
                        <th style={styles.thSort} onClick={() => handleTxSort('debit_credit')} title="Sort A–Z / Z–A">
                          <span style={styles.thSortContent}>Type {txSortBy === 'debit_credit' ? (txSortDir === 'asc' ? <FiChevronUp size={12} /> : <FiChevronDown size={12} />) : null}</span>
                        </th>
                        <th style={styles.thSort} onClick={() => handleTxSort('status')} title="Sort A–Z / Z–A">
                          <span style={styles.thSortContent}>Status {txSortBy === 'status' ? (txSortDir === 'asc' ? <FiChevronUp size={12} /> : <FiChevronDown size={12} />) : null}</span>
                        </th>
                        <th style={styles.th}>Actions</th>
                        <th style={styles.th}>Add</th>
                        <th style={styles.th}>Exclude</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortTransactions((transactionsByImport[imp.id] || []).filter(shouldIncludeTransaction)).map((tx) => (
                        <tr key={tx.id}>
                          <td style={styles.td}>{tx.transaction_date}</td>
                          <td style={styles.td}>{tx.payee || '—'}</td>
                          <td style={styles.td}>{tx.description || '—'}</td>
                          <td style={styles.td}>{tx.amount}</td>
                          <td style={styles.td}>{tx.debit_credit}</td>
                          <td style={styles.td}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span>
                                {getDisplayStatus(tx) === 'posted'
                                  ? 'Posted'
                                  : getDisplayStatus(tx) === 'matched'
                                    ? 'Matched'
                                    : getDisplayStatus(tx) === 'excluded'
                                      ? 'Excluded'
                                      : 'Pending'}
                              </span>
                              {tx.matched_deposit_id ? (
                                <span style={styles.mutedText}>Deposit linked</span>
                              ) : null}
                            </div>
                          </td>
                          <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                            {getDisplayStatus(tx) === 'excluded' ? (
                              <span style={styles.mutedText}>—</span>
                            ) : !isDebitTransaction(tx) && (tx.matched_deposit_id || getDisplayStatus(tx) === 'posted' || getDisplayStatus(tx) === 'matched') ? (
                              <button
                                type="button"
                                style={{ ...styles.smallButton, background: TavariStyles?.colors?.gray500 || '#6b7280' }}
                                onClick={() => handleOpenDepositWorkspace(tx)}
                                title={tx.matched_deposit_id ? 'Open the deposit matching workspace for this bank credit' : 'Reconnect this posted bank credit to its deposit and repair the revenue side if needed'}
                              >
                                {tx.matched_deposit_id ? 'Review match' : 'Repair'}
                              </button>
                            ) : tx.matched_draft_expense_id ? (
                              postedDraftIds.has(tx.matched_draft_expense_id) ? (
                                <span style={{ color: TavariStyles?.colors?.gray500, fontSize: 13 }}>Posted</span>
                              ) : (
                                <button
                                  type="button"
                                  style={{ ...styles.smallButton, background: TavariStyles?.colors?.success || '#059669', color: '#fff' }}
                                  onClick={() => handleApproveBankTx(tx, imp.id)}
                                  disabled={approvingBankTxId === tx.id}
                                  title="Post linked expense to ERPNext and mark this transaction posted"
                                >
                                  {approvingBankTxId === tx.id ? <FiLoader style={{ animation: 'spin 1s linear infinite', marginRight: 4, verticalAlign: 'middle' }} /> : <FiCheck />} Approve
                                </button>
                              )
                            ) : (() => {
                              const possibleMatch = getPossibleMatchForTx(
                                tx,
                                transactionsByImport[imp.id],
                                matchableExpenses,
                                alreadyLinkedExpenseIds
                              );
                              return (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                  {possibleMatch && (
                                    <button
                                      type="button"
                                      style={{
                                        ...styles.smallButton,
                                        background: expenseIsPosted(possibleMatch)
                                          ? (TavariStyles?.colors?.primary || '#008080')
                                          : (TavariStyles?.colors?.gray500 || '#6b7280'),
                                      }}
                                      onClick={() => handleLinkPossibleMatch(tx, imp.id, possibleMatch)}
                                      disabled={linkingTxId === tx.id}
                                      title={`Link to ${expenseIsPosted(possibleMatch) ? 'posted' : 'draft'}: ${possibleMatch.vendor_name_display || 'Expense'} ${formatDate(possibleMatch.transaction_date)} ${formatMoney(expenseMatchAmount(possibleMatch))}`}
                                    >
                                      {linkingTxId === tx.id ? 'Linking…' : (
                                        <>
                                          <FiLink /> Link{expenseIsPosted(possibleMatch) ? ' posted' : ''}
                                        </>
                                      )}
                                    </button>
                                  )}
                                  {isDebitTransaction(tx) && (
                                    <button
                                      type="button"
                                      style={styles.secondarySmallButton}
                                      onClick={() => {
                                        setMatchPickerSearch('');
                                        setMatchPicker({ tx, importId: imp.id });
                                      }}
                                      disabled={linkingTxId === tx.id}
                                      title="Match to a draft or already-posted expense"
                                    >
                                      <FiSearch /> Match…
                                    </button>
                                  )}
                                  {!possibleMatch && !isDebitTransaction(tx) ? <span style={styles.mutedText}>—</span> : null}
                                </span>
                              );
                            })()}
                          </td>
                          <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                            {getDisplayStatus(tx) !== 'pending' ? (
                              <span style={styles.mutedText}>—</span>
                            ) : (
                              <button
                                type="button"
                                style={styles.smallButton}
                                onClick={() => openAddTransactionModal(tx)}
                                title={isDebitTransaction(tx)
                                  ? 'Open the expense modal for this withdrawal'
                                  : 'Open the deposit modal for this credit'}
                              >
                                <FiPlus /> Add
                              </button>
                            )}
                          </td>
                          <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                            {getDisplayStatus(tx) === 'posted' ? (
                              <span style={styles.mutedText}>—</span>
                            ) : getDisplayStatus(tx) === 'excluded' ? (
                              <button
                                type="button"
                                style={styles.secondarySmallButton}
                                onClick={() => updateTransactionStatus(tx, imp.id, 'pending')}
                              >
                                Restore
                              </button>
                            ) : (
                              <button
                                type="button"
                                style={styles.secondarySmallButton}
                                onClick={() => updateTransactionStatus(tx, imp.id, 'excluded')}
                              >
                                Exclude
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {createExpenseTx && (
        <AccountingDraftExpenseForm
          businessId={selectedBusinessId}
          title="Review expense from transaction"
          vendors={vendors}
          categories={categories}
          onVendorCreated={(vendor) => {
            setVendors((prev) => [...prev, vendor].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''))));
          }}
          initialValues={{
            vendor_name_display: createExpenseTx.payee || createExpenseTx.description || '',
            transaction_date: createExpenseTx.transaction_date,
            invoice_date: '',
            total_amount: createExpenseTx.debit_credit === 'credit' ? -createExpenseTx.amount : createExpenseTx.amount,
            credit_account_erpnext: logicalAccountFromErpNextName(
              imports.find((item) => item.id === createExpenseTx.import_id)?.bank_account_erpnext || bankAccountForUpload || ''
            ),
          }}
          onSubmit={handleCreateExpenseFromTx}
          onCancel={() => setCreateExpenseTx(null)}
        />
      )}

      {createDepositTx && (
        <AccountingDepositMatchModal
          businessId={selectedBusinessId}
          transaction={createDepositTx}
          defaultBankAccount={imports.find((item) => item.id === createDepositTx.import_id)?.bank_account_erpnext || bankAccountForUpload || ''}
          onClose={() => setCreateDepositTx(null)}
          onSaved={handleDepositMatchSaved}
        />
      )}

      {createPaymentTx && (
        <div style={styles.modalOverlay} onClick={() => !paymentPosting && setCreatePaymentTx(null)}>
          <div style={{ ...styles.modalCard, maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px', fontSize: '1.125rem' }}>
              {createPaymentTx.paymentDirection === 'card_payment' ? 'Record card payment' : 'Record payment to card'}
            </h3>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6b7280' }}>
              Posts right here: reduces the card/clearing balance and credits the bank. No separate Journal Entry screen.
            </p>
            <div style={{ marginBottom: 12, padding: 10, background: '#f9fafb', borderRadius: 8, fontSize: 13 }}>
              <div><strong>{createPaymentTx.transaction_date}</strong></div>
              <div style={{ marginTop: 4 }}>{createPaymentTx.description || createPaymentTx.payee || '—'}</div>
              <div style={{ marginTop: 4, fontWeight: 600 }}>{formatMoney(Math.abs(Number(createPaymentTx.amount) || 0))}</div>
              <div style={{ marginTop: 4, color: '#6b7280' }}>
                Statement account: {getImportSourceAccount(createPaymentTx) || '—'}
              </div>
            </div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              {createPaymentTx.paymentDirection === 'card_payment'
                ? 'Paid from bank account'
                : 'Paid to card / clearing account'}
            </label>
            <select
              value={paymentFromAccount}
              onChange={(e) => setPaymentFromAccount(e.target.value)}
              style={{ ...styles.select, width: '100%', marginBottom: 12 }}
            >
              <option value="">— Select account —</option>
              {selectableUploadAccounts.map((account) => (
                <option key={account} value={account}>{account}</option>
              ))}
            </select>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
              {createPaymentTx.paymentDirection === 'card_payment' && (
                <button
                  type="button"
                  style={styles.secondarySmallButton}
                  disabled={paymentPosting}
                  onClick={() => {
                    const tx = createPaymentTx;
                    setCreatePaymentTx(null);
                    setCreateDepositTx(tx);
                  }}
                >
                  This is a sales deposit instead
                </button>
              )}
              <button
                type="button"
                style={styles.secondarySmallButton}
                disabled={paymentPosting}
                onClick={() => setCreatePaymentTx(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                style={styles.smallButton}
                disabled={paymentPosting || !paymentFromAccount}
                onClick={handlePostCardPayment}
              >
                {paymentPosting ? <FiLoader style={{ animation: 'spin 1s linear infinite' }} /> : <FiCheck />}
                {paymentPosting ? ' Posting…' : ' Post payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {matchPicker?.tx && (
        <div style={styles.modalOverlay} onClick={() => { setMatchPicker(null); setMatchPickerSearch(''); }}>
          <div style={{ ...styles.modalCard, maxWidth: 720, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px', fontSize: '1.125rem' }}>Match to expense</h3>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6b7280' }}>
              Link this statement line to a draft or already-posted expense. Posted matches mark the bank line posted without creating a second expense.
            </p>
            <div style={{ marginBottom: 12, padding: 10, background: '#f9fafb', borderRadius: 8, fontSize: 13 }}>
              <div><strong>{matchPicker.tx.transaction_date}</strong> · {matchPicker.tx.payee || matchPicker.tx.description || '—'}</div>
              <div style={{ marginTop: 4 }}>{formatMoney(Math.abs(Number(matchPicker.tx.amount) || 0))} {matchPicker.tx.debit_credit}</div>
            </div>
            <input
              type="search"
              value={matchPickerSearch}
              onChange={(e) => setMatchPickerSearch(e.target.value)}
              placeholder="Search vendor, invoice #, date, amount…"
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d5db', marginBottom: 12 }}
              autoFocus
            />
            <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
              {matchPickerCandidates.length === 0 ? (
                <p style={{ margin: 0, padding: 16, color: '#6b7280', fontSize: 13 }}>No matching expenses found.</p>
              ) : (
                matchPickerCandidates.slice(0, 80).map(({ expense: d, expAmt, amountDiff, dateOk, score }) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => handleLinkExpense(matchPicker.tx, matchPicker.importId, d)}
                    disabled={linkingTxId === matchPicker.tx.id}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 12px',
                      border: 'none',
                      borderBottom: '1px solid #f3f4f6',
                      background: score >= 100 ? '#f0fdfa' : '#fff',
                      cursor: linkingTxId === matchPicker.tx.id ? 'wait' : 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{d.vendor_name_display || '—'}</div>
                        <div style={{ fontSize: 13, color: '#6b7280' }}>
                          {d.transaction_date || d.invoice_date || 'No date'}
                          {d.invoice_number ? ` · #${d.invoice_number}` : ''}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{expAmt != null ? formatMoney(expAmt) : '—'}</div>
                        <div style={{ fontSize: 11, color: expenseIsPosted(d) ? '#059669' : '#b45309' }}>
                          {expenseIsPosted(d) ? 'Posted' : d.status === 'on_hold' ? 'On hold' : 'Draft'}
                          {amountDiff != null && amountDiff <= 0.009 ? ' · amount match' : ''}
                          {dateOk ? ' · date ok' : ''}
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button
                type="button"
                style={styles.secondarySmallButton}
                onClick={() => { setMatchPicker(null); setMatchPickerSearch(''); }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateAccountModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <h3 style={{ margin: '0 0 8px', fontSize: '1.125rem' }}>Create Source Account</h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: TavariStyles?.colors?.gray600 || '#6b7280' }}>
              Create the real source account this CSV came from, such as a checking account, petty cash account, or credit card.
            </p>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Account name</label>
            <input
              type="text"
              value={newSourceAccount.account_name}
              onChange={(e) => setNewSourceAccount((prev) => ({ ...prev, account_name: e.target.value }))}
              placeholder="Example: Operating Chequing"
              style={{ ...styles.select, marginBottom: 14 }}
            />
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Account type</label>
            <select
              value={newSourceAccount.account_kind}
              onChange={(e) => setNewSourceAccount((prev) => ({ ...prev, account_kind: e.target.value }))}
              style={styles.select}
            >
              <option value="bank">Bank account</option>
              <option value="cash">Cash account</option>
              <option value="credit_card">Credit card account</option>
            </select>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button
                type="button"
                onClick={() => {
                  if (creatingSourceAccount) return;
                  setShowCreateAccountModal(false);
                }}
                style={{ ...styles.smallButton, background: '#fff', color: TavariStyles?.colors?.gray700 || '#374151', border: '1px solid #d1d5db' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateSourceAccount}
                disabled={creatingSourceAccount}
                style={{ ...styles.primaryButton, padding: '8px 14px' }}
              >
                {creatingSourceAccount ? <FiLoader style={{ animation: 'spin 1s linear infinite' }} /> : <FiPlus />}
                {creatingSourceAccount ? 'Creating…' : 'Create Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .accounting-bank-import input:focus { outline: none; }
        .accounting-bank-import button[aria-label="Delete import"]:hover { color: #dc2626; background: #fef2f2; }
        .accounting-bank-import th[title]:hover { background: #f3f4f6; }
      `}</style>
    </div>
  );
};

const styles = {
  backButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
    padding: '8px 16px',
    background: TavariStyles?.colors?.white || '#fff',
    border: `1px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14
  },
  card: {
    padding: 24,
    border: `1px solid ${TavariStyles?.colors?.gray200 || '#e5e7eb'}`,
    borderRadius: 8,
    background: TavariStyles?.colors?.white || '#fff'
  },
  uploadLabel: { cursor: 'pointer' },
  primaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    background: TavariStyles?.colors?.primary || '#008080',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14
  },
  select: {
    width: '100%',
    maxWidth: '100%',
    padding: '8px 12px',
    border: `1px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
    borderRadius: 8,
    fontSize: 14,
    background: '#fff',
    boxSizing: 'border-box'
  },
  importRow: { borderBottom: `1px solid ${TavariStyles?.colors?.gray200 || '#e5e7eb'}` },
  importRowInner: {
    display: 'flex',
    alignItems: 'center',
    width: '100%'
  },
  expandButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    padding: '12px 16px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    textAlign: 'left'
  },
  meta: { marginLeft: 'auto', color: TavariStyles?.colors?.gray500, fontSize: 13 },
  deleteImportButton: {
    padding: '10px 12px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: TavariStyles?.colors?.gray500,
    borderRadius: 6
  },
  txTableWrap: { padding: '0 16px 16px', overflowX: 'auto', width: '100%' },
  txTable: { width: '100%', minWidth: 980, borderCollapse: 'collapse', fontSize: 13, tableLayout: 'auto' },
  th: { textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: TavariStyles?.colors?.gray700, whiteSpace: 'nowrap' },
  thSort: {
    textAlign: 'left',
    padding: '8px 12px',
    fontWeight: 600,
    color: TavariStyles?.colors?.gray700,
    cursor: 'pointer',
    userSelect: 'none'
  },
  thSortContent: { display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' },
  td: { padding: '8px 12px', borderTop: `1px solid ${TavariStyles?.colors?.gray200}` },
  smallButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: '4px 10px',
    fontSize: 13,
    background: TavariStyles?.colors?.primary || '#008080',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    minWidth: 118
  },
  secondarySmallButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: '4px 10px',
    fontSize: 13,
    background: '#fff',
    color: TavariStyles?.colors?.gray700 || '#374151',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    cursor: 'pointer',
    minWidth: 118
  },
  mutedText: {
    color: TavariStyles?.colors?.gray500 || '#6b7280',
    fontSize: 13
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(17, 24, 39, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    zIndex: 2000
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    background: '#fff',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 24px 48px rgba(0, 0, 0, 0.18)',
    boxSizing: 'border-box',
    overflow: 'hidden'
  }
};

export default AccountingBankImport;
