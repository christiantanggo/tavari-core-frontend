import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { FiArrowLeft, FiChevronDown, FiChevronUp, FiClock, FiPause, FiPlus, FiEdit2, FiTrash2, FiLink, FiMail, FiLoader, FiCheck, FiRotateCcw, FiUpload, FiExternalLink } from 'react-icons/fi';
import html2pdf from 'html2pdf.js';
import AccountingDraftExpenseForm from './AccountingDraftExpenseForm';
import { ensureBaselineExpenseCategories } from './accountingDefaults';
import { renderPdfFirstPageToImage } from '../../utils/invoicePdfText';
import { matchVendorByName } from '../../utils/accountingVendorMatch';
import { logAccountingEvent } from './accountingAudit';
import { replaceDraftExpenseLines, loadDraftExpenseLines } from '../../utils/accountingDraftExpenseLines';
import { getDraftBankMatchAmount, getEffectiveExpenseAmounts, needsCadSettlement, isForeignCurrencyDraft } from '../../utils/accountingDraftAmounts';
import { openExpenseInvoiceAttachment } from '../../utils/openExpenseInvoiceAttachment';
import { finalizeExpenseAmounts, isExpenseAmountsIncomplete, isCreditMemoExpense, reconcileDraftExpenseAmounts, resolveDraftDocumentType } from '../../utils/expenseAmounts';
import { normalizeEmailBodyForExtraction } from '../../utils/emailBodyNormalize';
import { formatAccountingDateLabel, getCurrentBusinessDate, getBusinessDateRangeStart, resolveAccountingTimezone } from '../../utils/businessDateFormat';
import BusinessCalendarPicker from '../../components/UI/BusinessCalendarPicker';
import { useErpNextAccounts } from '../../hooks/useErpNextAccounts';
import { logicalAccountFromErpNextName } from '../../utils/erpnextGlAccount';

const round2 = (n) => (n != null && !Number.isNaN(n) ? Math.round(Number(n) * 100) / 100 : null);

const EXPENSE_INVOICES_BUCKET = 'expense-invoices';

const INLINE_HST_OPTIONS = [
  { value: 'recoverable', label: 'Recoverable' },
  { value: 'included', label: 'Included' },
  { value: 'exempt', label: 'Exempt' }
];

const INLINE_CURRENCY_OPTIONS = ['CAD', 'USD', 'EUR', 'GBP', 'AUD'];

function sortByApprovalAndDate(rows, dateField) {
  return [...(rows || [])].sort((a, b) => {
    const approvedA = a?.approved_at ? new Date(a.approved_at).getTime() : 0;
    const approvedB = b?.approved_at ? new Date(b.approved_at).getTime() : 0;
    if (approvedA !== approvedB) return approvedB - approvedA;
    const dateA = a?.[dateField] ? new Date(a[dateField]).getTime() : 0;
    const dateB = b?.[dateField] ? new Date(b[dateField]).getTime() : 0;
    return dateB - dateA;
  });
}

const APPROVED_DEFAULT_LIMIT = 100;
const APPROVED_ALL_LIMIT = 10000;

const APPROVED_SORT_COLUMNS = [
  { id: 'vendor', label: 'Vendor', type: 'text' },
  { id: 'category', label: 'Category', type: 'text' },
  { id: 'paid_from', label: 'Paid from', type: 'text' },
  { id: 'date', label: 'Date', type: 'date' },
  { id: 'amount', label: 'Amount', type: 'number' },
  { id: 'hst', label: 'HST', type: 'number' },
  { id: 'invoice', label: 'Invoice #', type: 'text' },
  { id: 'source', label: 'Source', type: 'text' },
  { id: 'match', label: 'Match', type: 'text' },
  { id: 'status', label: 'Status', type: 'text' },
];

const DRAFT_EXPENSE_COLUMN_HEADERS = [
  'Vendor',
  'Category',
  'Paid from',
  'Date',
  'Amount',
  'HST',
  'Invoice #',
  'Source',
  'Match',
  'Status',
  'Actions',
];

function compareApprovedSortValues(a, b, dir) {
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

/** Signed amount for sort so credit memos / negatives order correctly. */
function signedApprovedAmount(draft, raw) {
  if (raw == null || Number.isNaN(Number(raw))) return null;
  const n = Number(raw);
  if (Math.abs(n) < 0.0005) return 0;
  if (isCreditMemoExpense(draft) || String(draft?.document_type || '').toLowerCase() === 'credit_memo') {
    return -Math.abs(n);
  }
  return n;
}

/** Convert HTML to plain text preserving structure (tables, line breaks) for invoice extraction. */
function htmlToStructuredText(html) {
  if (!html || !String(html).trim()) return '';
  let s = String(html)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(tr|p|div|li|h[1-6])/gi, '\n')
    .replace(/<\s*\/\s*(td|th)/gi, '\t')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\t+/g, '\t')
    .trim();
  return s.split(/\n/).map((line) => line.trim().replace(/\t+/g, '  ')).filter(Boolean).join('\n');
}

async function tryMatchDraftToBankTransaction(supabaseClient, businessId, draftId, payload) {
  const amount = getDraftBankMatchAmount(payload);
  const expenseDate = payload?.transaction_date || null;
  const vendorDisplay = (payload?.vendor_name_display || '').trim().toLowerCase();
  if (amount == null || amount === 0) return false;
  const { data: imports } = await supabaseClient
    .from('accounting_bank_imports')
    .select('id')
    .eq('business_id', businessId);
  const importIds = (imports || []).map((i) => i.id);
  if (importIds.length === 0) return false;
  const { data: transactions } = await supabaseClient
    .from('accounting_bank_transactions')
    .select('id, transaction_date, amount, debit_credit, payee, description')
    .in('import_id', importIds)
    .eq('status', 'pending')
    .is('matched_draft_expense_id', null);
  const candidates = (transactions || []).filter(
    (t) => t.debit_credit === 'debit' && Math.abs(round2(t.amount)) === amount
  );
  if (candidates.length === 0) return false;
  const exactDateMatch = candidates.filter((t) => t.transaction_date === expenseDate);
  if (exactDateMatch.length === 0) return false;
  const toLink = exactDateMatch.length === 1
    ? exactDateMatch[0]
    : vendorDisplay
      ? exactDateMatch.find((t) => {
          const payee = (t.payee || '').toLowerCase();
          const desc = (t.description || '').toLowerCase();
          return payee.includes(vendorDisplay) || vendorDisplay.includes(payee) || desc.includes(vendorDisplay);
        }) || exactDateMatch[0]
      : exactDateMatch[0];
  if (!toLink) return false;
  const { error: insertErr } = await supabaseClient
    .from('accounting_bank_transaction_draft_matches')
    .insert({ bank_transaction_id: toLink.id, draft_expense_id: draftId });
  if (insertErr) {
    console.error('Auto-link bank transaction failed:', getSupabaseErrorMessage(insertErr), insertErr);
    return false;
  }
  const { error } = await supabaseClient
    .from('accounting_bank_transactions')
    .update({ matched_draft_expense_id: draftId, status: 'matched' })
    .eq('id', toLink.id);
  if (error) {
    console.error('Auto-link bank transaction status update failed:', getSupabaseErrorMessage(error), error);
  }
  return !error;
}

function getSupabaseErrorMessage(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const msg = err.message ?? err.details ?? err.hint ?? err.code;
  if (msg) return String(msg);
  if (typeof err.toString === 'function' && err.toString() !== '[object Object]') return err.toString();
  // Own + prototype string values (Error.message is on prototype)
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
async function linkDraftsToBankTransaction(supabaseClient, bankTransactionId, draftIds) {
  if (!draftIds?.length) return { ok: false, errorMessage: 'No drafts to link' };
  const rows = draftIds.map((draftId) => ({ bank_transaction_id: bankTransactionId, draft_expense_id: draftId }));
  // Use insert; on duplicate we still run the update (idempotent). Avoids upsert returning empty error in some clients.
  const { error: insertErr } = await supabaseClient
    .from('accounting_bank_transaction_draft_matches')
    .insert(rows);
  if (insertErr) {
    const insertMsg = getSupabaseErrorMessage(insertErr) || 'Insert failed';
    const isDuplicate = /duplicate|unique|23505/i.test(insertMsg);
    if (isDuplicate) {
      // Row already exists; proceed to update bank tx so UI shows linked
    } else {
      // 404 or empty error often means the junction table doesn't exist yet (migration not run)
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
    .update({ matched_draft_expense_id: firstDraftId, status: 'matched' })
    .eq('id', bankTransactionId);
  if (updateErr) {
    const updateMsg = getSupabaseErrorMessage(updateErr) || 'Update failed';
    console.error('Link bank tx update failed:', updateMsg, updateErr);
    return { ok: false, errorMessage: updateMsg };
  }
  return { ok: true };
}

const DATE_WINDOW_DAYS = 60;
function inDateWindow(txDate, expenseDate) {
  if (!txDate || !expenseDate) return false;
  const expenseDateMs = new Date(expenseDate).getTime();
  const d = new Date(txDate).getTime();
  const diff = Math.abs(d - expenseDateMs);
  return diff <= DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

async function getSuggestedBankMatches(supabaseClient, businessId, draft) {
  const amount = getDraftBankMatchAmount(draft);
  const expenseDate = draft?.transaction_date || null;
  if (amount == null || amount === 0) return [];
  const { data: imports } = await supabaseClient
    .from('accounting_bank_imports')
    .select('id')
    .eq('business_id', businessId);
  const importIds = (imports || []).map((i) => i.id);
  if (importIds.length === 0) return [];
  const { data: transactions } = await supabaseClient
    .from('accounting_bank_transactions')
    .select('id, transaction_date, amount, payee, debit_credit')
    .in('import_id', importIds)
    .eq('status', 'pending')
    .is('matched_draft_expense_id', null);
  const candidates = (transactions || []).filter(
    (t) => Math.abs(round2(t.amount)) === amount && inDateWindow(t.transaction_date, expenseDate)
  );
  return candidates.sort((a, b) => new Date(a.transaction_date) - new Date(b.transaction_date));
}

const AccountingQueue = ({ embedded = false, focus = 'all', initialSubTab = 'pending', titleOverride = null }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedBusinessId, selectedBusiness } = useBusinessContext();
  const { authLoading } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'AccountingQueue'
  });
  const [batches, setBatches] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [onHoldDrafts, setOnHoldDrafts] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [holdingDraftId, setHoldingDraftId] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [editingDraft, setEditingDraft] = useState(null);
  const [editingDraftLines, setEditingDraftLines] = useState([]);
  const [reExtracting, setReExtracting] = useState(false);
  const [reExtractingFromPdf, setReExtractingFromPdf] = useState(false);
  const [linkedDraftIds, setLinkedDraftIds] = useState(new Set());
  const [suggestedMatchesByDraftId, setSuggestedMatchesByDraftId] = useState({});
  const [linkingDraftId, setLinkingDraftId] = useState(null);
  const [showMatchToPayment, setShowMatchToPayment] = useState(false);
  const [accountingTimezone, setAccountingTimezone] = useState(() => resolveAccountingTimezone(null, selectedBusiness));
  const [matchDateFrom, setMatchDateFrom] = useState(() => getBusinessDateRangeStart(30, resolveAccountingTimezone(null, selectedBusiness)));
  const [matchDateTo, setMatchDateTo] = useState(() => getCurrentBusinessDate(resolveAccountingTimezone(null, selectedBusiness)));
  const [matchDrafts, setMatchDrafts] = useState([]);
  const [matchBankTx, setMatchBankTx] = useState([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchSelectedDraftIds, setMatchSelectedDraftIds] = useState(new Set());
  const [matchSelectedBankTxId, setMatchSelectedBankTxId] = useState('');
  const [matchLinking, setMatchLinking] = useState(false);
  const [linkPrompt, setLinkPrompt] = useState(null);
  const [linkPromptLinking, setLinkPromptLinking] = useState(false);
  const [extractingAll, setExtractingAll] = useState(false);
  const [queueSubTab, setQueueSubTab] = useState(initialSubTab);
  const [approvedDrafts, setApprovedDrafts] = useState([]);
  const [approvedFetchLimit, setApprovedFetchLimit] = useState(APPROVED_DEFAULT_LIMIT);
  const [approvedSearch, setApprovedSearch] = useState('');
  const [approvedDateFrom, setApprovedDateFrom] = useState('');
  const [approvedDateTo, setApprovedDateTo] = useState('');
  const [approvedTotalCount, setApprovedTotalCount] = useState(null);
  const [approvedListLoading, setApprovedListLoading] = useState(false);
  const [approvedSortColumn, setApprovedSortColumn] = useState('date');
  const [approvedSortDir, setApprovedSortDir] = useState('desc');
  const approvedFetchLimitRef = useRef(APPROVED_DEFAULT_LIMIT);
  const approvedDateFromRef = useRef('');
  const approvedDateToRef = useRef('');
  approvedFetchLimitRef.current = approvedFetchLimit;
  approvedDateFromRef.current = approvedDateFrom;
  approvedDateToRef.current = approvedDateTo;
  const [postedBatches, setPostedBatches] = useState([]);
  const [postedDeposits, setPostedDeposits] = useState([]);
  const [approvingDraftId, setApprovingDraftId] = useState(null);
  const [unapprovingDraftId, setUnapprovingDraftId] = useState(null);
  const [unapprovingBatchId, setUnapprovingBatchId] = useState(null);
  const [unapprovingDepositId, setUnapprovingDepositId] = useState(null);
  const [approvingBatchId, setApprovingBatchId] = useState(null);
  const [approvingDepositId, setApprovingDepositId] = useState(null);
  const [creatingBatches, setCreatingBatches] = useState(false);
  const [selectedBatchIds, setSelectedBatchIds] = useState([]);
  const [groupingDeposit, setGroupingDeposit] = useState(false);
  const [deletingDepositId, setDeletingDepositId] = useState(null);
  const [periodLockConfig, setPeriodLockConfig] = useState({ period_lock_type: 'month', period_locked_until: null });
  const [replacePdfDraftId, setReplacePdfDraftId] = useState(null);
  const [replacePdfUploading, setReplacePdfUploading] = useState(false);
  const [savingInlineDraftId, setSavingInlineDraftId] = useState(null);
  const [openingInvoiceDraftId, setOpeningInvoiceDraftId] = useState(null);
  const [uploadingInvoices, setUploadingInvoices] = useState(false);
  const [invoiceDropActive, setInvoiceDropActive] = useState(false);
  const [payableAccountLabel, setPayableAccountLabel] = useState('Accounts Payable');
  const replacePdfInputRef = useRef(null);
  const bulkInvoiceInputRef = useRef(null);
  const { accountOptions: erpnextAccountOptions } = useErpNextAccounts(selectedBusinessId);

  const creditAccountOptions = useMemo(() => {
    const looksLikeFunding = (account) => {
      const name = String(account?.name || '');
      const accountType = String(account?.account_type || '').toLowerCase();
      const rootType = String(account?.root_type || '').toLowerCase();
      const reportType = String(account?.report_type || '').toLowerCase();
      const nameMatch = /bank|cash|checking|chequing|current|credit\s*card|card|visa|master\s*card|mastercard|amex|american\s+express|clearing|4516|owed to|on hand|overdraft/i.test(name);
      if (accountType === 'bank' || accountType === 'cash' || accountType === 'credit card') return true;
      if ((rootType === 'asset' || rootType === 'liability') && reportType === 'balance sheet' && nameMatch) return true;
      return false;
    };
    const filtered = erpnextAccountOptions.filter(looksLikeFunding);
    const source = filtered.length > 0
      ? filtered
      : erpnextAccountOptions.filter((a) => {
        const root = String(a?.root_type || '').toLowerCase();
        return root === 'asset' || root === 'liability';
      });
    return source
      .map((account) => ({
        value: logicalAccountFromErpNextName(account.name),
        label: account.name,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [erpnextAccountOptions]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('addExpense') === '1') {
      setQueueSubTab('pending');
      setShowAddExpense(true);
    }
  }, [location.search]);

  useEffect(() => {
    setQueueSubTab(initialSubTab);
  }, [initialSubTab]);

  const closeAddExpense = () => {
    setShowAddExpense(false);
    const params = new URLSearchParams(location.search);
    if (params.get('addExpense') === '1') {
      params.delete('addExpense');
      const nextSearch = params.toString();
      navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`, { replace: true });
    }
  };

  useEffect(() => {
    if (!editingDraft?.id) {
      setEditingDraftLines([]);
      return;
    }
    loadDraftExpenseLines(supabase, editingDraft.id)
      .then((rows) => setEditingDraftLines(rows.map((r) => ({
        description: r.description || '',
        amount: r.amount,
        tax_amount: r.tax_amount,
        expense_category_id: r.expense_category_id || '',
        gl_account_erpnext: r.gl_account_erpnext || ''
      }))))
      .catch(() => setEditingDraftLines([]));
  }, [editingDraft?.id]);

  const syncDraftDuplicates = async (businessId) => {
    if (!businessId) return;
    try {
      await supabase.functions.invoke('accounting-sync-draft-duplicates', { body: { business_id: businessId } });
    } catch {
      /* non-fatal */
    }
  };

  const fetchApprovedDraftsQuery = async (businessId, limit = APPROVED_DEFAULT_LIMIT, dateFilters = {}) => {
    const dateFrom = dateFilters.dateFrom ?? approvedDateFromRef.current;
    const dateTo = dateFilters.dateTo ?? approvedDateToRef.current;
    let query = supabase
      .from('accounting_draft_expenses')
      .select('*', { count: 'exact' })
      .eq('business_id', businessId)
      .in('status', ['posted', 'approved'])
      .order('approved_at', { ascending: false });
    if (dateFrom) query = query.gte('transaction_date', dateFrom);
    if (dateTo) query = query.lte('transaction_date', dateTo);
    if (limit != null) query = query.limit(limit);
    return query;
  };

  const applyApprovedDraftsResult = (res) => {
    if (res?.error) throw res.error;
    setApprovedDrafts(res.data || []);
    setApprovedTotalCount(typeof res.count === 'number' ? res.count : (res.data || []).length);
  };

  const loadApprovedDrafts = async (limit = approvedFetchLimitRef.current, dateFilters) => {
    if (!selectedBusinessId) return;
    setApprovedListLoading(true);
    try {
      const res = await fetchApprovedDraftsQuery(selectedBusinessId, limit, dateFilters);
      applyApprovedDraftsResult(res);
      setApprovedFetchLimit(limit);
    } catch (e) {
      toast.error(e?.message || 'Failed to load approved expenses');
    } finally {
      setApprovedListLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedBusinessId) return;
    const load = async () => {
      setLoading(true);
      try {
        const approvedLimit = approvedFetchLimitRef.current || APPROVED_DEFAULT_LIMIT;
        const [batchesRes, depositsRes, draftsRes, onHoldRes, approvedRes, postedBatchesRes, postedDepositsRes, vendorsRes, categoriesRes, configRes] = await Promise.all([
          supabase.from('accounting_sales_batches').select('*').eq('business_id', selectedBusinessId).eq('status', 'draft').order('batch_date', { ascending: false }).limit(50),
          supabase.from('accounting_deposits').select('*').eq('business_id', selectedBusinessId).eq('status', 'draft').order('deposit_date', { ascending: false }).limit(50),
          supabase.from('accounting_draft_expenses').select('*').eq('business_id', selectedBusinessId).eq('status', 'draft').limit(100),
          supabase.from('accounting_draft_expenses').select('*').eq('business_id', selectedBusinessId).eq('status', 'on_hold').order('updated_at', { ascending: false }).limit(200),
          fetchApprovedDraftsQuery(selectedBusinessId, approvedLimit),
          supabase.from('accounting_sales_batches').select('*').eq('business_id', selectedBusinessId).in('status', ['posted', 'approved']).limit(50),
          supabase.from('accounting_deposits').select('*').eq('business_id', selectedBusinessId).in('status', ['posted', 'approved']).limit(50),
          supabase.from('accounting_vendors').select('*').eq('business_id', selectedBusinessId).order('name'),
          supabase.from('accounting_expense_categories').select('id, name, default_hst_treatment, parent_id, gl_account_erpnext').eq('business_id', selectedBusinessId).order('sort_order').order('name'),
          supabase.from('accounting_business_config').select('period_lock_type, period_locked_until, business_timezone, accounts_payable_account_erpnext').eq('business_id', selectedBusinessId).maybeSingle()
        ]);
        const initialLoadError = [
          batchesRes.error,
          depositsRes.error,
          draftsRes.error,
          onHoldRes.error,
          approvedRes.error,
          postedBatchesRes.error,
          postedDepositsRes.error,
          vendorsRes.error,
          categoriesRes.error,
          configRes.error
        ].find(Boolean);
        if (initialLoadError) throw initialLoadError;
        setBatches(batchesRes.data || []);
        setDeposits(depositsRes.data || []);
        const draftList = draftsRes.data || [];
        setDrafts(draftList);
        setOnHoldDrafts(onHoldRes.data || []);
        await syncDraftDuplicates(selectedBusinessId);
        let dupDrafts = null;
        const { data: dupDraftsData } = await supabase
          .from('accounting_draft_expenses')
          .select('*')
          .eq('business_id', selectedBusinessId)
          .eq('status', 'draft')
          .limit(100);
        dupDrafts = dupDraftsData;
        if (dupDrafts) setDrafts(dupDrafts);
        applyApprovedDraftsResult(approvedRes);
        setPostedBatches(sortByApprovalAndDate(postedBatchesRes.data || [], 'batch_date'));
        setPostedDeposits(sortByApprovalAndDate(postedDepositsRes.data || [], 'deposit_date'));
        setVendors(vendorsRes.data || []);
        let cats = categoriesRes.data || [];
        const inserted = await ensureBaselineExpenseCategories(supabase, selectedBusinessId);
        if (inserted) {
          const { data: refetched } = await supabase.from('accounting_expense_categories').select('id, name, default_hst_treatment, parent_id, gl_account_erpnext').eq('business_id', selectedBusinessId).order('sort_order').order('name');
          cats = refetched || [];
        }
        setCategories(cats);
        if (configRes.data) {
          const tz = resolveAccountingTimezone(configRes.data, selectedBusiness);
          setAccountingTimezone(tz);
          setPeriodLockConfig({
            period_lock_type: configRes.data.period_lock_type || 'month',
            period_locked_until: configRes.data.period_locked_until ? configRes.data.period_locked_until.slice(0, 10) : null
          });
          const ap = (configRes.data.accounts_payable_account_erpnext || '').trim();
          setPayableAccountLabel(ap || 'Accounts Payable');
        } else {
          setAccountingTimezone(resolveAccountingTimezone(null, selectedBusiness));
          setPeriodLockConfig({ period_lock_type: 'month', period_locked_until: null });
          setPayableAccountLabel('Accounts Payable');
        }
        let linkedIds = new Set();
        const suggestions = {};
        const approvedList = approvedRes.data || [];
        const onHoldList = onHoldRes.data || [];
        const allDraftIds = [
          ...(dupDrafts || draftList).map((d) => d.id),
          ...onHoldList.map((d) => d.id),
          ...approvedList.map((d) => d.id),
        ];
        const draftListForMatch = [...(dupDrafts || draftList), ...onHoldList];
        if (allDraftIds.length > 0) {
          const draftIds = draftListForMatch.map((d) => d.id);
          const { data: imports } = await supabase.from('accounting_bank_imports').select('id').eq('business_id', selectedBusinessId);
          const importIds = (imports || []).map((i) => i.id);
          if (importIds.length > 0) {
            const [matchesRes, pendingRes] = await Promise.all([
              supabase.from('accounting_bank_transaction_draft_matches').select('draft_expense_id').in('draft_expense_id', allDraftIds),
              supabase.from('accounting_bank_transactions').select('id, transaction_date, amount, payee').in('import_id', importIds).eq('status', 'pending').is('matched_draft_expense_id', null)
            ]);
            if (matchesRes.error) throw matchesRes.error;
            if (pendingRes.error) throw pendingRes.error;
            linkedIds = new Set((matchesRes.data || []).map((r) => r.draft_expense_id));
            const pendingTx = pendingRes.data || [];
            draftListForMatch.forEach((d) => {
              if (linkedIds.has(d.id)) return;
              const amount = d.total_amount != null ? Math.abs(round2(Number(d.total_amount))) : null;
              const expenseDate = d.transaction_date || null;
              if (amount == null || amount === 0) return;
              const matches = pendingTx.filter(
                (t) => Math.abs(round2(t.amount)) === amount && inDateWindow(t.transaction_date, expenseDate)
              );
              if (matches.length > 0) {
                suggestions[d.id] = matches.sort((a, b) => new Date(a.transaction_date) - new Date(b.transaction_date));
              }
            });
            setSuggestedMatchesByDraftId(suggestions);
          }
          setLinkedDraftIds(linkedIds);
        } else {
          setLinkedDraftIds(new Set());
          setSuggestedMatchesByDraftId({});
        }
      } catch (e) {
        toast.error(getSupabaseErrorMessage(e) || 'Failed to load queue');
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [selectedBusinessId]);

  const refreshDrafts = async () => {
    if (!selectedBusinessId) return;
    const approvedLimit = approvedFetchLimitRef.current || APPROVED_DEFAULT_LIMIT;
    const [draftsRes, onHoldRes, approvedRes, draftBatchesRes, draftDepositsRes, postedBatchesRes, postedDepositsRes] = await Promise.all([
      supabase.from('accounting_draft_expenses').select('*').eq('business_id', selectedBusinessId).eq('status', 'draft').limit(100),
      supabase.from('accounting_draft_expenses').select('*').eq('business_id', selectedBusinessId).eq('status', 'on_hold').order('updated_at', { ascending: false }).limit(200),
      fetchApprovedDraftsQuery(selectedBusinessId, approvedLimit),
      supabase.from('accounting_sales_batches').select('*').eq('business_id', selectedBusinessId).eq('status', 'draft').order('batch_date', { ascending: false }).limit(50),
      supabase.from('accounting_deposits').select('*').eq('business_id', selectedBusinessId).eq('status', 'draft').order('deposit_date', { ascending: false }).limit(50),
      supabase.from('accounting_sales_batches').select('*').eq('business_id', selectedBusinessId).in('status', ['posted', 'approved']).limit(50),
      supabase.from('accounting_deposits').select('*').eq('business_id', selectedBusinessId).in('status', ['posted', 'approved']).limit(50)
    ]);
    const refreshError = [
      draftsRes.error,
      onHoldRes.error,
      approvedRes.error,
      draftBatchesRes.error,
      draftDepositsRes.error,
      postedBatchesRes.error,
      postedDepositsRes.error
    ].find(Boolean);
    if (refreshError) {
      console.error('Failed to refresh accounting queue:', refreshError);
      toast.error(refreshError.message || 'Failed to refresh accounting queue');
      return;
    }
    setDrafts(draftsRes.data || []);
    setOnHoldDrafts(onHoldRes.data || []);
    applyApprovedDraftsResult(approvedRes);
    setBatches(draftBatchesRes.data || []);
    setDeposits(draftDepositsRes.data || []);
    setPostedBatches(sortByApprovalAndDate(postedBatchesRes.data || [], 'batch_date'));
    setPostedDeposits(sortByApprovalAndDate(postedDepositsRes.data || [], 'deposit_date'));
  };

  const EXTRACTION_GRACE_MS = 90_000;

  const isEmailDraftExtracting = (d) => {
    if (d.source !== 'email' || d.extraction_completed_at != null) return false;
    if (!d.created_at) return true;
    return Date.now() - new Date(d.created_at).getTime() < EXTRACTION_GRACE_MS;
  };

  const normalizeCategoryId = (raw) => {
    if (raw == null || raw === '') return null;
    const s = String(raw).trim();
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidRe.test(s) && categories.some((c) => c.id === s)) return s;
    const idInParens = s.match(/\(\s*id\s*:\s*([0-9a-f-]{36})\s*\)/i);
    if (idInParens?.[1] && uuidRe.test(idInParens[1]) && categories.some((c) => c.id === idInParens[1])) {
      return idInParens[1];
    }
    const anyUuid = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    if (anyUuid?.[0] && categories.some((c) => c.id === anyUuid[0])) return anyUuid[0];
    const byName = categories.find((c) => c.name.trim().toLowerCase() === s.toLowerCase());
    return byName?.id ?? null;
  };

  const applyExtractedToDraft = (d, extractedData) => {
    const vendorName = extractedData?.vendor_name ?? d.vendor_name_display;
    const matchedVendor = matchVendorByName(vendorName, vendors);
    const effectiveVendor = matchedVendor ?? vendors.find((v) => v.id === d.vendor_id);
    const categoryId = effectiveVendor?.default_expense_category_id
      ?? normalizeCategoryId(extractedData?.suggested_category_id)
      ?? normalizeCategoryId(d.expense_category_id);
    const category = categories.find((c) => c.id === categoryId);
    const glAccount = category?.gl_account_erpnext ?? effectiveVendor?.default_gl_account_erpnext ?? d.gl_account_erpnext ?? null;
    const hstTreatment = effectiveVendor?.default_hst_treatment ?? category?.default_hst_treatment ?? d.hst_treatment ?? 'recoverable';

    // Prefer invoice-inferred rate (e.g. 0.13 for Ontario HST) over vendor default (e.g. 5% GST)
    const inferredRate = extractedData?.inferred_hst_rate != null && !Number.isNaN(Number(extractedData.inferred_hst_rate)) ? Number(extractedData.inferred_hst_rate) : (d.inferred_hst_rate != null && !Number.isNaN(Number(d.inferred_hst_rate)) ? Number(d.inferred_hst_rate) : null);
    const effectiveRate = inferredRate ?? (effectiveVendor?.default_hst_treatment !== 'exempt' ? (effectiveVendor?.default_hst_rate ?? null) : null);

    const totalAmountRaw = extractedData?.total_amount != null && !Number.isNaN(Number(extractedData.total_amount)) ? Number(extractedData.total_amount) : (d.total_amount ?? 0);
    const finalized = finalizeExpenseAmounts({
      subtotal: extractedData?.subtotal ?? d.subtotal ?? null,
      tax_amount: extractedData?.tax_amount ?? d.tax_amount ?? null,
      total_amount: totalAmountRaw || null,
    });
    const totalAmount = finalized.total_amount != null ? Number(finalized.total_amount) : totalAmountRaw;
    let subtotal = finalized.subtotal ?? extractedData?.subtotal ?? d.subtotal;
    let taxAmount = finalized.tax_amount ?? (extractedData?.tax_amount != null && !Number.isNaN(Number(extractedData.tax_amount)) ? Number(extractedData.tax_amount) : d.tax_amount);
    if (hstTreatment === 'exempt') {
      taxAmount = 0;
    }
    let hstCalculated = false;

    // Last resort: derive tax from vendor rate only when amounts still don't reconcile
    if (isExpenseAmountsIncomplete({ subtotal, tax_amount: taxAmount, total_amount: totalAmount }) && totalAmount !== 0 && effectiveRate > 0) {
      const absTotal = Math.abs(totalAmount);
      const rate = Number(effectiveRate);
      const subAbs = absTotal / (1 + rate);
      const taxAbs = absTotal - subAbs;
      subtotal = totalAmount < 0 ? -round2(subAbs) : round2(subAbs);
      taxAmount = totalAmount < 0 ? -round2(taxAbs) : round2(taxAbs);
      hstCalculated = true;
    }

    // Flag when tax exceeds 13% of subtotal (or total) so user must verify before approval
    const baseForRate = subtotal != null && subtotal !== 0 ? Math.abs(subtotal) : (totalAmount !== 0 ? Math.abs(totalAmount) : 0);
    const taxExceeds13Percent = baseForRate > 0 && taxAmount != null && Math.abs(taxAmount) > 0.13 * baseForRate;

    const extractionHasAmounts = (extractedData?.subtotal != null && !Number.isNaN(Number(extractedData.subtotal))) ||
      (extractedData?.tax_amount != null && !Number.isNaN(Number(extractedData.tax_amount))) ||
      (extractedData?.total_amount != null && !Number.isNaN(Number(extractedData.total_amount)));
    // Invoice number: same priority as backend — 1) Invoice Number, 2) Order Number, 3) Reference Number
    const toStr = (v) => (v != null && typeof v !== 'undefined' ? (typeof v === 'string' ? v.trim() : String(v)) : '');
    const extractedInvoiceNumber = toStr(extractedData?.invoice_number) || toStr(extractedData?.invoice_no) || toStr(extractedData?.order_number) || toStr(extractedData?.reference_number) || toStr(extractedData?.reference) || null;
    const extractedInvoiceDate = extractedData?.invoice_date ?? d.invoice_date;
    const fullPayload = {
      vendor_id: matchedVendor?.id ?? d.vendor_id ?? null,
      vendor_name_display: vendorName ?? d.vendor_name_display,
      invoice_date: extractedInvoiceDate,
      ...(extractedInvoiceDate ? { transaction_date: extractedInvoiceDate } : {}),
      subtotal: extractionHasAmounts ? subtotal : d.subtotal,
      tax_amount: extractionHasAmounts ? taxAmount : d.tax_amount,
      total_amount: extractionHasAmounts ? totalAmount : d.total_amount,
      invoice_number: (extractedInvoiceNumber && extractedInvoiceNumber !== '') ? extractedInvoiceNumber : (d.invoice_number ?? null),
      invoice_currency: extractedData?.invoice_currency ? String(extractedData.invoice_currency).toUpperCase() : (d.invoice_currency || 'CAD'),
      expense_category_id: categoryId || null,
      gl_account_erpnext: glAccount,
      hst_treatment: hstTreatment,
      hst_calculated: extractionHasAmounts ? hstCalculated : d.hst_calculated,
      tax_exceeds_13_percent: taxExceeds13Percent,
      inferred_hst_rate: extractedData?.inferred_hst_rate ?? d.inferred_hst_rate ?? null,
      extraction_completed_at: new Date().toISOString(),
      ...(extractedData?.document_type ? { document_type: extractedData.document_type } : {}),
      ...(extractedData?.credit_memo_against != null ? { credit_memo_against: extractedData.credit_memo_against } : {})
    };
    const safeDraftUpdateKeys = [
      'vendor_id', 'vendor_name_display', 'invoice_date', 'transaction_date', 'subtotal', 'tax_amount', 'total_amount',
      'invoice_number', 'invoice_currency', 'expense_category_id', 'gl_account_erpnext', 'hst_treatment', 'hst_calculated',
      'tax_exceeds_13_percent', 'inferred_hst_rate', 'extraction_completed_at', 'document_type', 'credit_memo_against'
    ];
    const payloadForDb = {};
    safeDraftUpdateKeys.forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(fullPayload, k)) payloadForDb[k] = fullPayload[k];
    });
    return payloadForDb;
  };

  const handleExtractAllInvoices = async (draftsOverride = null) => {
    console.log('[Queue Extract] ========== BUTTON CLICKED ==========');
    const pool = Array.isArray(draftsOverride) ? draftsOverride : (drafts || []);
    const toExtract = pool.filter((d) => d.invoice_file_path || d.received_email_id);
    console.log('[Queue Extract] Drafts with file or email:', toExtract.length);
    toExtract.forEach((d, idx) => console.log(`[Queue Extract] Draft ${idx + 1}:`, { id: d.id, invoice_file_path: !!d.invoice_file_path, received_email_id: d.received_email_id, vendor: d.vendor_name_display, amount: d.total_amount, source: d.source }));
    if (toExtract.length === 0) {
      console.log('[Queue Extract] Nothing to extract - need invoice_file_path or received_email_id');
      toast.error('No invoices with a PDF/image or email body to extract');
      return;
    }
    console.log('[Queue Extract] selectedBusinessId:', selectedBusinessId);
    setExtractingAll(true);
    let ok = 0;
    let failed = 0;
    let paused = 0;
    let quotaBlocked = false;
    const isRateLimitedResult = (result) => {
      const message = String(result?.data?.error || result?.error?.message || result?.error || '');
      return result?.data?.code === 'rate_limited' || /too many requests|rate.?limit/i.test(message);
    };
    const isQuotaResult = (result) =>
      /insufficient_quota|billing|quota/i.test(
        `${result?.data?.upstream_code || ''} ${result?.data?.upstream_type || ''} ${result?.data?.error || ''}`
      );
    try {
      for (let i = 0; i < toExtract.length; i++) {
        const d = toExtract[i];
        const path = d.invoice_file_path?.trim?.();
        const hasPath = !!path;
        const hasEmail = !!d.received_email_id;
        console.log(`[Queue Extract] ========== INVOICE ${i + 1}/${toExtract.length} ========== draft_id:`, d.id, 'hasPath:', hasPath, 'hasEmail:', hasEmail, 'path:', path ? path.slice(0, 80) + '...' : 'none');
        if (!selectedBusinessId) {
          console.error('[Queue Extract] No selectedBusinessId - cannot extract');
          failed++;
          continue;
        }
        let draftUpdated = false;
        let draftHasAmounts = false;
        let rateLimited = false;
        let emailBodyForExtract = '';
        if (d.received_email_id) {
          const { data: emailRowPrefetch } = await supabase
            .from('received_emails')
            .select('body_html, body_text')
            .eq('id', d.received_email_id)
            .maybeSingle();
          if (emailRowPrefetch) {
            emailBodyForExtract = normalizeEmailBodyForExtraction(emailRowPrefetch.body_text, emailRowPrefetch.body_html);
          }
        }

        if (hasPath) {
          toast.loading(`Method 1: PDF extract ${i + 1}/${toExtract.length}…`, { id: 'extract-all' });
          console.log('[Queue Extract] METHOD 1: accounting-reextract-from-pdf');
          const t1 = Date.now();
          const result1 = await supabase.functions.invoke('accounting-reextract-from-pdf', {
            body: { business_id: selectedBusinessId, invoice_file_path: path }
          });
          console.log('[Queue Extract] Method 1 took', Date.now() - t1, 'ms', 'error:', result1.error ? JSON.stringify(result1.error) : 'null', 'data:', result1.data ? JSON.stringify({ success: result1.data.success, try_browser_render: result1.data.try_browser_render, vendor: result1.data.vendor_name, total: result1.data.total_amount }) : 'null');

          if (isRateLimitedResult(result1)) {
            rateLimited = true;
            quotaBlocked = isQuotaResult(result1);
            console.warn('[Queue Extract] Method 1 rate limited; pausing this batch.');
          } else if (result1.error) {
            console.log('[Queue Extract] Method 1 invoke error (e.g. connection closed) - will try METHOD 2: browser render', result1.error);
          } else if (result1.data?.success === true) {
            const amountsOk = result1.data?.total_amount != null && !isExpenseAmountsIncomplete({
              subtotal: result1.data?.subtotal,
              tax_amount: result1.data?.tax_amount,
              total_amount: result1.data?.total_amount,
            });
            console.log('[Queue Extract] Method 1 SUCCESS - updating draft', { tax_amount: result1.data?.tax_amount, subtotal: result1.data?.subtotal, amountsOk });
            const updatePayload = applyExtractedToDraft(d, result1.data);
            const { error: ue } = await supabase.from('accounting_draft_expenses').update(updatePayload).eq('id', d.id);
            if (ue) {
              console.error('[Queue Extract] Method 1 update error:', ue);
              toast.error(`Re-extraction succeeded but saving draft failed: ${ue.message || ue.code || 'Unknown error'}. Run DB migrations if needed.`);
            } else {
              draftUpdated = amountsOk;
              if (amountsOk) draftHasAmounts = true;
              await refreshDrafts();
              if (!amountsOk) console.log('[Queue Extract] Method 1 amounts incomplete — will try fallback methods');
            }
          }

          const tryMethod2 = !rateLimited && !draftUpdated && hasPath && (result1.error || result1.data?.try_browser_render === true || result1.data?.success === true);
          if (tryMethod2) {
            console.log('[Queue Extract] Trying METHOD 2: browser render (Method 1 failed or asked for browser render)');
            toast.loading(`Method 2: Browser render ${i + 1}/${toExtract.length}…`, { id: 'extract-all' });
            const t2 = Date.now();
            try {
              const { data: signed } = await supabase.storage.from('expense-invoices').createSignedUrl(path, 3600);
              console.log('[Queue Extract] Signed URL:', signed?.signedUrl ? 'OK' : 'FAIL');
              if (!signed?.signedUrl) {
                console.error('[Queue Extract] Method 2: No signed URL');
              } else {
                const res = await fetch(signed.signedUrl);
                console.log('[Queue Extract] Fetch invoice file:', res.status, res.ok ? 'OK' : 'FAIL');
                if (!res.ok) {
                  console.error('[Queue Extract] Method 2: Fetch failed', res.status);
                } else {
                  const arrayBuffer = await res.arrayBuffer();
                  const fileSize = arrayBuffer.byteLength;
                  const lowerPath = String(path).toLowerCase();
                  const imageMime =
                    lowerPath.endsWith('.png') ? 'image/png'
                      : (lowerPath.endsWith('.webp') ? 'image/webp'
                        : (/\.jpe?g$/.test(lowerPath) ? 'image/jpeg' : null));
                  console.log('[Queue Extract] Invoice file size:', fileSize, 'imageMime:', imageMime || 'pdf');
                  if (fileSize < 20000 && !imageMime) {
                    console.warn('[Queue Extract] PDF is very small (' + fileSize + ' bytes) – may be a placeholder or error file, not the full invoice.');
                    toast.error('Invoice attachment is very small (' + (fileSize / 1024).toFixed(1) + ' KB). Re-upload the full PDF if extraction is wrong.');
                  }
                  toast.loading(`Method 2: Extracting from image ${i + 1}/${toExtract.length}…`, { id: 'extract-all' });
                  let mimeType = 'image/png';
                  let base64 = null;
                  if (imageMime) {
                    const bytes = new Uint8Array(arrayBuffer);
                    let binary = '';
                    const chunk = 0x8000;
                    for (let offset = 0; offset < bytes.length; offset += chunk) {
                      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
                    }
                    base64 = btoa(binary);
                    mimeType = imageMime;
                    console.log('[Queue Extract] Method 2: using uploaded image directly');
                  } else {
                    const dataUrl = await renderPdfFirstPageToImage(arrayBuffer);
                    console.log('[Queue Extract] renderPdfFirstPageToImage:', dataUrl ? (dataUrl.startsWith('data:image') ? 'OK' : 'unexpected') : 'FAIL');
                    if (dataUrl && dataUrl.startsWith('data:image')) {
                      base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
                      mimeType = 'image/png';
                    }
                  }
                  if (base64) {
                    const categoriesForApi = categories.map((c) => ({ id: c.id, name: c.name }));
                    const imgResult = await supabase.functions.invoke('accounting-extract-invoice', {
                      body: {
                        business_id: selectedBusinessId,
                        image_base64: base64,
                        mime_type: mimeType,
                        categories: categoriesForApi,
                        supplementary_text: emailBodyForExtract.slice(0, 24000) || undefined,
                      }
                    });
                    console.log('[Queue Extract] Method 2 accounting-extract-invoice took', Date.now() - t2, 'ms', 'error:', imgResult.error ? 'YES' : 'no', 'data:', imgResult.data ? JSON.stringify({ vendor: imgResult.data?.vendor_name, subtotal: imgResult.data?.subtotal, tax_amount: imgResult.data?.tax_amount, total: imgResult.data?.total_amount, tax_breakdown: imgResult.data?.tax_breakdown }) : 'null');
                    if (isRateLimitedResult(imgResult)) {
                      rateLimited = true;
                      quotaBlocked = isQuotaResult(imgResult);
                      console.warn('[Queue Extract] Method 2 rate limited; pausing this batch.');
                    } else if (!imgResult.data?.error && imgResult.data) {
                      const amountsOk = imgResult.data.total_amount != null && !isExpenseAmountsIncomplete({
                        subtotal: imgResult.data.subtotal,
                        tax_amount: imgResult.data.tax_amount,
                        total_amount: imgResult.data.total_amount,
                      });
                      if (!amountsOk) {
                        console.warn('[Queue Extract] Method 2 amounts incomplete — will try email body if available.');
                      }
                      const updatePayload = applyExtractedToDraft(d, imgResult.data);
                      const { error: ue2 } = await supabase.from('accounting_draft_expenses').update(updatePayload).eq('id', d.id);
                      if (ue2) {
                        console.error('[Queue Extract] Method 2 update error:', ue2);
                      } else {
                        console.log('[Queue Extract] Method 2 SUCCESS - draft updated' + (amountsOk ? '' : ' (amounts incomplete)'));
                        draftUpdated = amountsOk;
                        if (amountsOk) draftHasAmounts = true;
                        await refreshDrafts();
                        if (!amountsOk) {
                          toast('Extracted partial data; trying email body next if available.');
                        }
                      }
                    } else {
                      console.error('[Queue Extract] Method 2 extract failed:', imgResult.error || imgResult.data?.error);
                    }
                  } else {
                    console.error('[Queue Extract] Method 2: could not get image from invoice file');
                  }
                }
              }
            } catch (method2Err) {
              console.error('[Queue Extract] Method 2 caught:', method2Err);
            }
          } else if (!draftUpdated) {
            console.log('[Queue Extract] Method 1 returned without success or try_browser_render:', result1.data);
          }
        }

        if (hasEmail && !draftHasAmounts && !rateLimited) {
          console.log('[Queue Extract] METHOD 3: email body extract (no amounts yet – getting from email body)');
          toast.loading(`Method 3: Email body ${i + 1}/${toExtract.length}…`, { id: 'extract-all' });
          const t3 = Date.now();
          try {
            const { data: emailRow, error: emailErr } = await supabase
              .from('received_emails')
              .select('body_html, body_text')
              .eq('id', d.received_email_id)
              .single();
            console.log('[Queue Extract] Method 3 received_emails:', emailErr ? 'error ' + emailErr.message : 'OK', 'body_html len:', emailRow?.body_html?.length ?? 0, 'body_text len:', emailRow?.body_text?.length ?? 0);
            if (!emailErr && emailRow) {
              const invoiceText = normalizeEmailBodyForExtraction(emailRow.body_text, emailRow.body_html);
              console.log('[Queue Extract] Method 3 invoiceText length:', invoiceText?.length ?? 0);
              // Short iPhone forward wrappers (often ~89 chars) contain no invoice
              // data. Do not spend a second AI request after rendering the attached scan.
              const usefulEmailText = invoiceText && (!hasPath || invoiceText.length >= 160);
              if (usefulEmailText) {
                const categoriesForApi = categories.map((c) => ({ id: c.id, name: c.name }));
                const emailResult = await supabase.functions.invoke('accounting-extract-invoice', {
                  body: { business_id: selectedBusinessId, invoice_text: invoiceText, categories: categoriesForApi }
                });
                console.log('[Queue Extract] Method 3 accounting-extract-invoice took', Date.now() - t3, 'ms', 'error:', emailResult.error ? 'YES' : 'no', 'data:', emailResult.data ? JSON.stringify({ vendor: emailResult.data?.vendor_name, total: emailResult.data?.total_amount }) : 'null');
                if (isRateLimitedResult(emailResult)) {
                  rateLimited = true;
                  quotaBlocked = isQuotaResult(emailResult);
                  console.warn('[Queue Extract] Method 3 rate limited; pausing this batch.');
                } else if (!emailResult.error && !emailResult.data?.error && emailResult.data) {
                  const updatePayload = applyExtractedToDraft(d, emailResult.data);
                  const { error: ue3 } = await supabase.from('accounting_draft_expenses').update(updatePayload).eq('id', d.id);
                  if (ue3) {
                    console.error('[Queue Extract] Method 3 update error:', ue3);
                  } else {
                    console.log('[Queue Extract] Method 3 SUCCESS - draft updated');
                    draftUpdated = true;
                    draftHasAmounts = true;
                    await refreshDrafts();
                    if (d.invoice_file_path) {
                      const { error: regenErr } = await supabase.functions.invoke('accounting-regenerate-email-body-pdf', {
                        body: { received_email_id: d.received_email_id, storage_path: d.invoice_file_path }
                      });
                      console.log('[Queue Extract] Method 3 regenerate PDF:', regenErr ? 'error' : 'OK');
                    }
                  }
                } else {
                  console.error('[Queue Extract] Method 3 extract failed:', emailResult.error || emailResult.data?.error);
                }
              } else {
                console.log('[Queue Extract] Method 3: No useful invoice text in email body');
              }
            } else {
              console.log('[Queue Extract] Method 3: Could not load received_emails');
            }
          } catch (method3Err) {
            console.error('[Queue Extract] Method 3 caught:', method3Err);
          }
        }

        if (rateLimited) {
          paused = toExtract.length - i;
          break;
        }
        if (draftUpdated) ok++;
        else {
          console.log('[Queue Extract] All methods exhausted for draft', d.id, '- marking as failed');
          failed++;
        }
        // Pace multi-receipt batches so image scans do not burst the AI API.
        if (i < toExtract.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
      }

      console.log('[Queue Extract] ========== LOOP DONE ========== ok:', ok, 'failed:', failed);
      if (ok > 0) {
        toast.success(`Extracted ${ok} invoice(s)${failed > 0 ? ` (${failed} failed)` : ''}`, { id: 'extract-all' });
        await refreshDrafts();
      }
      if (failed > 0) {
        toast.error(`${failed} invoice(s) could not be extracted. Check console [Queue Extract] for details.`, { id: ok === 0 ? 'extract-all' : 'extract-all-failed' });
      }
      if (paused > 0) {
        toast.error(
          quotaBlocked
            ? `OpenAI invoice-extraction quota is exhausted. ${paused} invoice(s) were paused. Add API billing/credits or raise the OpenAI project limit, then retry.`
            : `AI extraction is temporarily busy. ${paused} invoice(s) were paused—try Extract again in about a minute.`,
          { id: 'extract-all' }
        );
      }
    } catch (e) {
      console.error('[Queue Extract] CAUGHT:', e);
      console.error('[Queue Extract] Stack:', e?.stack);
      toast.error('Extract failed', { id: 'extract-all' });
    } finally {
      console.log('[Queue Extract] ========== FINALLY - setting extractingAll=false ==========');
      setExtractingAll(false);
    }
  };

  useEffect(() => {
    const extracting = (drafts || []).filter(isEmailDraftExtracting);
    if (!extracting.length || !selectedBusinessId) return;
    const interval = setInterval(refreshDrafts, 2000);
    return () => clearInterval(interval);
  }, [selectedBusinessId, drafts]);

  const handleBulkInvoiceFiles = async (fileList) => {
    if (!selectedBusinessId || uploadingInvoices) return;
    const files = Array.from(fileList || []).filter((f) => {
      const type = String(f.type || '').toLowerCase();
      const name = String(f.name || '').toLowerCase();
      return type === 'application/pdf'
        || /^image\/(jpeg|jpg|png|webp)$/.test(type)
        || /\.(pdf|png|jpe?g|webp)$/.test(name);
    });
    if (files.length === 0) {
      toast.error('Choose PDF or image invoices (PDF, PNG, JPG, WEBP)');
      return;
    }
    setUploadingInvoices(true);
    let ok = 0;
    let failed = 0;
    const createdIds = [];
    try {
      for (const file of files) {
        try {
          const safeName = String(file.name || 'invoice.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
          const path = `${selectedBusinessId}/${crypto.randomUUID()}/${safeName}`;
          const lowerName = safeName.toLowerCase();
          const contentType = file.type
            || (lowerName.endsWith('.pdf') ? 'application/pdf'
              : (lowerName.endsWith('.png') ? 'image/png'
                : (lowerName.endsWith('.webp') ? 'image/webp'
                  : (/\.jpe?g$/.test(lowerName) ? 'image/jpeg' : 'application/octet-stream'))));
          const { error: upErr } = await supabase.storage
            .from(EXPENSE_INVOICES_BUCKET)
            .upload(path, file, { contentType, upsert: false });
          if (upErr) throw upErr;
          const { data: created, error: insErr } = await supabase.from('accounting_draft_expenses').insert({
            business_id: selectedBusinessId,
            source: 'manual',
            vendor_name_display: null,
            transaction_date: null,
            total_amount: 0,
            tax_amount: 0,
            subtotal: 0,
            hst_treatment: 'recoverable',
            status: 'draft',
            invoice_file_path: path,
            invoice_currency: 'CAD',
            document_type: 'invoice',
          }).select('*').single();
          if (insErr) throw insErr;
          if (created?.id) createdIds.push(created.id);
          ok += 1;
        } catch (err) {
          console.error('[Queue Upload] Failed for', file?.name, err);
          failed += 1;
        }
      }
      await refreshDrafts();
      if (ok > 0) {
        toast.success(`Uploaded ${ok} invoice${ok === 1 ? '' : 's'}${failed ? ` (${failed} failed)` : ''}. Extracting…`);
        if (createdIds.length > 0) {
          const { data: createdRows } = await supabase
            .from('accounting_draft_expenses')
            .select('*')
            .eq('business_id', selectedBusinessId)
            .in('id', createdIds);
          if (createdRows?.length) {
            await handleExtractAllInvoices(createdRows);
          }
        }
      } else {
        toast.error('Upload failed');
      }
    } finally {
      setUploadingInvoices(false);
    }
  };

  const handleAddExpense = async (payload) => {
    if (!selectedBusinessId) return;
    const amounts = reconcileDraftExpenseAmounts({
      subtotal: payload.subtotal,
      tax_amount: payload.tax_amount,
      total_amount: payload.total_amount,
      hst_treatment: payload.hst_treatment,
    });
    const { data: newDraft, error } = await supabase
      .from('accounting_draft_expenses')
      .insert({
        business_id: selectedBusinessId,
        source: 'manual',
        vendor_id: payload.vendor_id || null,
        vendor_name_display: payload.vendor_name_display || null,
        transaction_date: payload.transaction_date || null,
        invoice_date: payload.invoice_date || null,
        subtotal: amounts.subtotal ?? null,
        tax_amount: amounts.tax_amount ?? null,
        total_amount: amounts.total_amount,
        invoice_number: payload.invoice_number || null,
        expense_category_id: payload.expense_category_id || null,
        gl_account_erpnext: payload.gl_account_erpnext || null,
        credit_account_erpnext: payload.credit_account_erpnext || null,
        hst_treatment: payload.hst_treatment,
        invoice_file_path: payload.invoice_file_path || null,
        invoice_currency: (payload.invoice_currency || 'CAD').toUpperCase(),
        cad_settlement_total: payload.cad_settlement_total ?? null,
        is_fixed_asset: !!payload.is_fixed_asset,
        asset_name: payload.is_fixed_asset ? (payload.asset_name || null) : null,
        asset_useful_life_years: payload.is_fixed_asset ? (payload.asset_useful_life_years ?? 5) : null,
        asset_salvage_value: payload.is_fixed_asset ? (payload.asset_salvage_value ?? 0) : null,
        asset_gl_account_erpnext: payload.is_fixed_asset ? (payload.asset_gl_account_erpnext || null) : null,
        document_type: resolveDraftDocumentType({
          document_type: payload.document_type,
          is_credit_memo: payload.is_credit_memo,
        }),
        credit_memo_against: resolveDraftDocumentType({ document_type: payload.document_type, is_credit_memo: payload.is_credit_memo }) === 'credit_memo'
          ? (payload.credit_memo_against || null)
          : null,
      })
      .select('id')
      .single();
    if (error) {
      toast.error(error.message || 'Failed to add expense');
      return;
    }
    if (payload.line_items?.length) {
      try {
        await replaceDraftExpenseLines(supabase, selectedBusinessId, newDraft.id, payload.line_items);
      } catch (lineErr) {
        toast.error(lineErr?.message || 'Expense saved but split lines failed to save');
      }
    }
    setShowAddExpense(false);
    const suggested = await getSuggestedBankMatches(supabase, selectedBusinessId, {
      total_amount: payload.total_amount,
      cad_settlement_total: payload.cad_settlement_total,
      invoice_currency: payload.invoice_currency,
      transaction_date: payload.transaction_date
    });
    if (suggested.length > 0) {
      setLinkPrompt({ draftId: newDraft.id, bankTx: suggested[0] });
      await refreshDrafts();
      return;
    }
    toast.success('Expense added to queue');
    await refreshDrafts();
  };

  const handleLinkPromptConfirm = async () => {
    if (!linkPrompt || !selectedBusinessId) return;
    setLinkPromptLinking(true);
    const result = await linkDraftsToBankTransaction(supabase, linkPrompt.bankTx.id, [linkPrompt.draftId]);
    if (result.ok) {
      await supabase.from('accounting_draft_expenses').update({ transaction_date: linkPrompt.bankTx.transaction_date }).eq('id', linkPrompt.draftId);
      setLinkedDraftIds((prev) => new Set([...prev, linkPrompt.draftId]));
      setSuggestedMatchesByDraftId((prev) => {
        const next = { ...prev };
        delete next[linkPrompt.draftId];
        return next;
      });
      toast.success(`Expense linked to bank transaction. Payment date set to ${formatDate(linkPrompt.bankTx.transaction_date)}.`);
    } else {
      toast.error(result.errorMessage || 'Failed to link');
    }
    setLinkPromptLinking(false);
    setLinkPrompt(null);
    await refreshDrafts();
  };

  const handleLinkPromptSkip = async () => {
    setLinkPrompt(null);
    toast.success('Expense added to queue');
    await refreshDrafts();
  };

  const handleUpdateDraft = async (payload) => {
    if (!editingDraft) return;
    const amounts = reconcileDraftExpenseAmounts({
      subtotal: payload.subtotal,
      tax_amount: payload.tax_amount,
      total_amount: payload.total_amount,
      hst_treatment: payload.hst_treatment,
    });
    const { error } = await supabase
      .from('accounting_draft_expenses')
      .update({
        vendor_id: payload.vendor_id || null,
        vendor_name_display: payload.vendor_name_display || null,
        transaction_date: payload.transaction_date || null,
        subtotal: amounts.subtotal ?? null,
        tax_amount: amounts.tax_amount ?? null,
        total_amount: amounts.total_amount,
        invoice_number: payload.invoice_number || null,
        expense_category_id: payload.expense_category_id || null,
        gl_account_erpnext: payload.gl_account_erpnext || null,
        credit_account_erpnext: payload.credit_account_erpnext || null,
        hst_treatment: payload.hst_treatment,
        invoice_file_path: payload.invoice_file_path || null,
        // When a replacement file is uploaded, form clears attachment_id so Open uses the new file.
        ...(Object.prototype.hasOwnProperty.call(payload, 'attachment_id')
          ? { attachment_id: payload.attachment_id || null }
          : {}),
        invoice_currency: (payload.invoice_currency || 'CAD').toUpperCase(),
        cad_settlement_total: payload.cad_settlement_total ?? null,
        is_fixed_asset: !!payload.is_fixed_asset,
        asset_name: payload.is_fixed_asset ? (payload.asset_name || null) : null,
        asset_useful_life_years: payload.is_fixed_asset ? (payload.asset_useful_life_years ?? 5) : null,
        asset_salvage_value: payload.is_fixed_asset ? (payload.asset_salvage_value ?? 0) : null,
        asset_gl_account_erpnext: payload.is_fixed_asset ? (payload.asset_gl_account_erpnext || null) : null,
        document_type: resolveDraftDocumentType({
          document_type: payload.document_type,
          is_credit_memo: payload.is_credit_memo,
        }),
        credit_memo_against: resolveDraftDocumentType({ document_type: payload.document_type, is_credit_memo: payload.is_credit_memo }) === 'credit_memo'
          ? (payload.credit_memo_against || null)
          : null,
      })
      .eq('id', editingDraft.id);
    if (error) {
      toast.error(error.message || 'Failed to update');
      return;
    }
    try {
      await replaceDraftExpenseLines(supabase, selectedBusinessId, editingDraft.id, payload.line_items || []);
    } catch (lineErr) {
      toast.error(lineErr?.message || 'Draft updated but split lines failed to save');
    }
    const wasLinked = linkedDraftIds.has(editingDraft.id);
    const linked = !wasLinked && (await tryMatchDraftToBankTransaction(supabase, selectedBusinessId, editingDraft.id, payload));
    if (linked) setLinkedDraftIds((prev) => new Set([...prev, editingDraft.id]));
    else if (!wasLinked) {
      const suggested = await getSuggestedBankMatches(supabase, selectedBusinessId, {
      total_amount: payload.total_amount,
      cad_settlement_total: payload.cad_settlement_total,
      invoice_currency: payload.invoice_currency,
      transaction_date: payload.transaction_date
    });
      setSuggestedMatchesByDraftId((prev) => ({ ...prev, [editingDraft.id]: suggested }));
    }
    toast.success(linked ? 'Expense updated and linked to a bank transaction' : 'Expense updated');
    setEditingDraft(null);
    const { data } = await supabase.from('accounting_draft_expenses').select('*').eq('business_id', selectedBusinessId).eq('status', 'draft').limit(50);
    setDrafts(data || []);
  };

  const handleReExtractFromEmail = async () => {
    if (!editingDraft || editingDraft.source !== 'email' || !editingDraft.received_email_id || !selectedBusinessId) return;
    setReExtracting(true);
    try {
      const { data: emailRow, error: emailErr } = await supabase
        .from('received_emails')
        .select('body_html, body_text')
        .eq('id', editingDraft.received_email_id)
        .single();
      if (emailErr || !emailRow) {
        toast.error('Could not load email body');
        setReExtracting(false);
        return;
      }
      const invoiceText = normalizeEmailBodyForExtraction(emailRow.body_text, emailRow.body_html);
      if (!invoiceText) {
        toast.error('No email body to extract from');
        setReExtracting(false);
        return;
      }
      const categoriesForApi = categories.map((c) => ({ id: c.id, name: c.name }));
      const { data: extracted, error: extractErr } = await supabase.functions.invoke('accounting-extract-invoice', {
        body: { business_id: selectedBusinessId, invoice_text: invoiceText, categories: categoriesForApi }
      });
      if (extractErr) {
        toast.error(extractErr.message || 'Extraction failed');
        setReExtracting(false);
        return;
      }
      const updatePayload = applyExtractedToDraft(editingDraft, extracted);
      const reExtractTotal = updatePayload.total_amount != null && !Number.isNaN(Number(updatePayload.total_amount)) ? Number(updatePayload.total_amount) : 0;
      const { error: updateErr } = await supabase
        .from('accounting_draft_expenses')
        .update({
          ...updatePayload,
          total_amount: reExtractTotal
        })
        .eq('id', editingDraft.id);
      if (updateErr) {
        toast.error(updateErr.message || 'Failed to update draft');
        setReExtracting(false);
        return;
      }
      if (editingDraft.invoice_file_path) {
        const { error: regenErr } = await supabase.functions.invoke('accounting-regenerate-email-body-pdf', {
          body: { received_email_id: editingDraft.received_email_id, storage_path: editingDraft.invoice_file_path }
        });
        if (regenErr) toast.error('Draft updated but PDF could not be regenerated');
      }
      toast.success('Re-extracted from email body');
      const { data: updated } = await supabase.from('accounting_draft_expenses').select('*').eq('id', editingDraft.id).single();
      if (updated) setEditingDraft(updated);
      await refreshDrafts();
    } catch (e) {
      toast.error(e?.message || 'Re-extract failed');
    }
    setReExtracting(false);
  };

  const handleReExtractFromPdf = async () => {
    const path = editingDraft?.invoice_file_path?.trim?.();
    if (!path || !selectedBusinessId) {
      toast.error('No invoice file on this draft');
      return;
    }
    setReExtractingFromPdf(true);
    try {
      const { data: extracted, error } = await supabase.functions.invoke('accounting-reextract-from-pdf', {
        body: { business_id: selectedBusinessId, invoice_file_path: path }
      });
      if (error) {
        toast.error(error.message || error?.error || 'Re-extract failed');
        setReExtractingFromPdf(false);
        return;
      }
      if (extracted && extracted.success === false && extracted.error) {
        if (extracted.try_browser_render) {
          let toastId = toast.loading('Rendering PDF page…');
          try {
            const { data: signed } = await supabase.storage.from('expense-invoices').createSignedUrl(path, 3600);
            if (!signed?.signedUrl) {
              toast.dismiss(toastId);
              toast.error('Could not load PDF');
              setReExtractingFromPdf(false);
              return;
            }
            const res = await fetch(signed.signedUrl);
            if (!res.ok) {
              toast.dismiss(toastId);
              toast.error('Could not load PDF');
              setReExtractingFromPdf(false);
              return;
            }
            const arrayBuffer = await res.arrayBuffer();
            toast.loading('Extracting from image…', { id: toastId });
            const dataUrl = await renderPdfFirstPageToImage(arrayBuffer);
            if (!dataUrl || !dataUrl.startsWith('data:image')) {
              toast.dismiss(toastId);
              toast.error('Could not render PDF page as image');
              setReExtractingFromPdf(false);
              return;
            }
            const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
            const categoriesForApi = categories.map((c) => ({ id: c.id, name: c.name }));
            const { data: imgExtracted, error: imgErr } = await supabase.functions.invoke('accounting-extract-invoice', {
              body: { business_id: selectedBusinessId, image_base64: base64, mime_type: 'image/png', categories: categoriesForApi }
            });
            if (imgErr) {
              toast.dismiss(toastId);
              toast.error(imgErr?.message || imgErr?.error || 'Extraction from image failed');
              setReExtractingFromPdf(false);
              return;
            }
            if (imgExtracted?.error) {
              toast.dismiss(toastId);
              toast.error(imgExtracted.error);
              setReExtractingFromPdf(false);
              return;
            }
            if (!imgExtracted) {
              toast.dismiss(toastId);
              toast.error('Extraction from image failed');
              setReExtractingFromPdf(false);
              return;
            }
            toast.dismiss(toastId);
            const imgUpdatePayload = applyExtractedToDraft(editingDraft, imgExtracted);
            const { error: updateErr2 } = await supabase
              .from('accounting_draft_expenses')
              .update(imgUpdatePayload)
              .eq('id', editingDraft.id);
            if (updateErr2) {
              toast.error(updateErr2.message || 'Failed to update draft');
            } else {
              toast.success('Re-extracted from invoice (first page as image)');
              const { data: updated } = await supabase.from('accounting_draft_expenses').select('*').eq('id', editingDraft.id).single();
              if (updated) setEditingDraft(updated);
              await refreshDrafts();
            }
          } catch (e) {
            toast.dismiss(toastId);
            toast.error(e?.message || 'Browser render failed');
          }
          setReExtractingFromPdf(false);
          return;
        }
        toast.error(extracted.error);
        setReExtractingFromPdf(false);
        return;
      }
      const pdfUpdatePayload = applyExtractedToDraft(editingDraft, extracted);
      const { error: updateErr } = await supabase
        .from('accounting_draft_expenses')
        .update(pdfUpdatePayload)
        .eq('id', editingDraft.id);
      if (updateErr) {
        toast.error(updateErr.message || 'Failed to update draft');
        setReExtractingFromPdf(false);
        return;
      }
      toast.success('Re-extracted from invoice PDF');
      const { data: updated } = await supabase.from('accounting_draft_expenses').select('*').eq('id', editingDraft.id).single();
      if (updated) setEditingDraft(updated);
      await refreshDrafts();
    } catch (e) {
      toast.error(e?.message || 'Re-extract failed');
    }
    setReExtractingFromPdf(false);
  };

  const handleViewEmail = async () => {
    if (!editingDraft?.received_email_id) return;
    try {
      const { data: emailRow, error } = await supabase
        .from('received_emails')
        .select('body_html, body_text')
        .eq('id', editingDraft.received_email_id)
        .single();
      if (error || !emailRow) {
        toast.error('Could not load email');
        return;
      }
      const rawHtml = emailRow.body_html || `<pre style="white-space:pre-wrap;font-family:inherit;">${(emailRow.body_text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
      const styleBlock = `<style>body{margin:0;padding:12px;background:#fff}table{border-collapse:collapse}img{max-width:100%;height:auto}</style>`;
      const isFullDoc = /^\s*<!doctype/i.test(rawHtml) || /^\s*<html/i.test(rawHtml);
      const doc = isFullDoc ? rawHtml : `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styleBlock}</head><body>${rawHtml}</body></html>`;
      const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast.error(e?.message || 'Could not open email');
    }
  };

  const [downloadingEmailPdf, setDownloadingEmailPdf] = useState(false);
  const handleDownloadEmailPdf = async () => {
    if (!editingDraft?.received_email_id) return;
    setDownloadingEmailPdf(true);
    let iframe = null;
    try {
      const { data: emailRow, error } = await supabase
        .from('received_emails')
        .select('body_html, body_text')
        .eq('id', editingDraft.received_email_id)
        .single();
      if (error || !emailRow) {
        toast.error('Could not load email');
        setDownloadingEmailPdf(false);
        return;
      }
      const rawHtml = emailRow.body_html || `<pre style="white-space:pre-wrap;font-family:inherit;">${(emailRow.body_text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
      const styleBlock = `<style>body{margin:0;padding:12px;background:#fff}table{border-collapse:collapse}img{max-width:100%;height:auto}</style>`;
      const isFullDoc = /^\s*<!doctype/i.test(rawHtml) || /^\s*<html/i.test(rawHtml);
      const doc = isFullDoc ? rawHtml : `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styleBlock}</head><body>${rawHtml}</body></html>`;
      iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-same-origin');
      iframe.style.cssText = 'position:absolute;width:800px;height:2000px;left:-9999px;top:0;visibility:hidden;';
      document.body.appendChild(iframe);
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) throw new Error('Could not access iframe document');
      iframeDoc.open();
      iframeDoc.write(doc);
      iframeDoc.close();
      await new Promise((resolve, reject) => {
        iframe.onload = () => resolve();
        iframe.onerror = () => reject(new Error('Iframe load failed'));
        setTimeout(() => resolve(), 5000);
      });
      const body = iframeDoc.body;
      if (!body) throw new Error('No body in iframe');
      const imgs = body.querySelectorAll('img');
      if (imgs.length > 0) {
        await Promise.race([
          Promise.all(Array.from(imgs).map((img) => {
            if (img.complete) return Promise.resolve();
            return new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; });
          })),
          new Promise((r) => setTimeout(r, 4000))
        ]);
      }
      await new Promise((r) => setTimeout(r, 500));
      const opt = {
        margin: [10, 10, 10, 10],
        filename: 'email-invoice.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 1.5, useCORS: true, allowTaint: true, backgroundColor: '#ffffff', logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      await html2pdf().set(opt).from(body).save();
      toast.success('PDF downloaded');
    } catch (e) {
      toast.error(e?.message || 'Could not generate PDF');
    } finally {
      if (iframe && document.body.contains(iframe)) document.body.removeChild(iframe);
    }
    setDownloadingEmailPdf(false);
  };

  const loadMatchToPaymentData = async () => {
    if (!selectedBusinessId || !matchDateFrom || !matchDateTo) return;
    setMatchLoading(true);
    try {
      const [draftsRes, importsRes] = await Promise.all([
        supabase
          .from('accounting_draft_expenses')
          .select('*')
          .eq('business_id', selectedBusinessId)
          .eq('status', 'draft')
          .gte('transaction_date', matchDateFrom)
          .lte('transaction_date', matchDateTo)
          .order('transaction_date', { ascending: true }),
        supabase.from('accounting_bank_imports').select('id').eq('business_id', selectedBusinessId)
      ]);
      const importIds = (importsRes.data || []).map((i) => i.id);
      let bankTx = [];
      if (importIds.length > 0) {
        const txRes = await supabase
          .from('accounting_bank_transactions')
          .select('id, transaction_date, amount, debit_credit, payee')
          .in('import_id', importIds)
          .eq('status', 'pending')
          .is('matched_draft_expense_id', null)
          .gte('transaction_date', matchDateFrom)
          .lte('transaction_date', matchDateTo)
          .order('transaction_date', { ascending: true });
        bankTx = txRes.data || [];
      }
      setMatchDrafts(draftsRes.data || []);
      setMatchBankTx(bankTx);
      setMatchSelectedDraftIds(new Set());
      setMatchSelectedBankTxId('');
    } catch (e) {
      toast.error('Failed to load');
    } finally {
      setMatchLoading(false);
    }
  };

  useEffect(() => {
    if (showMatchToPayment && selectedBusinessId && matchDateFrom && matchDateTo) loadMatchToPaymentData();
  }, [showMatchToPayment, selectedBusinessId, matchDateFrom, matchDateTo]);

  const handleMatchToPaymentSubmit = async () => {
    const draftIds = Array.from(matchSelectedDraftIds);
    const bankTxId = matchSelectedBankTxId;
    if (!draftIds.length || !bankTxId) {
      toast.error('Select at least one invoice and one payment');
      return;
    }
    const tx = matchBankTx.find((t) => t.id === bankTxId);
    const selectedDrafts = matchDrafts.filter((d) => matchSelectedDraftIds.has(d.id));
    const sumDrafts = selectedDrafts.reduce((acc, d) => {
      const amt = getDraftBankMatchAmount(d);
      return acc + (amt != null ? -amt : Number(d.total_amount ?? 0));
    }, 0);
    const bankAmount = tx?.debit_credit === 'debit' ? -Math.abs(Number(tx?.amount ?? 0)) : Math.abs(Number(tx?.amount ?? 0));
    if (Math.abs(round2(sumDrafts) - round2(bankAmount)) > 0.01) {
      toast.error(`Selected invoices total ${formatMoney(sumDrafts)} must equal the payment amount ${formatMoney(bankAmount)}`);
      return;
    }
    setMatchLinking(true);
    const result = await linkDraftsToBankTransaction(supabase, bankTxId, draftIds);
    if (result.ok && tx?.transaction_date) {
      for (const id of draftIds) {
        await supabase.from('accounting_draft_expenses').update({ transaction_date: tx.transaction_date }).eq('id', id);
      }
    }
    setMatchLinking(false);
    if (!result.ok) {
      toast.error(result.errorMessage || 'Failed to link');
      return;
    }
    toast.success(`Linked ${draftIds.length} invoice(s) to payment. Payment date set to ${formatDate(tx.transaction_date)}.`);
    setShowMatchToPayment(false);
    setLinkedDraftIds((prev) => new Set([...prev, ...draftIds]));
    setSuggestedMatchesByDraftId((prev) => {
      const next = { ...prev };
      draftIds.forEach((id) => delete next[id]);
      return next;
    });
    const { data } = await supabase.from('accounting_draft_expenses').select('*').eq('business_id', selectedBusinessId).eq('status', 'draft').limit(50);
    setDrafts(data || []);
  };

  const handleLinkDraftToBank = async (draftId, tx) => {
    if (!tx?.id) return;
    setLinkingDraftId(draftId);
    const result = await linkDraftsToBankTransaction(supabase, tx.id, [draftId]);
    setLinkingDraftId(null);
    if (!result.ok) {
      toast.error(result.errorMessage || 'Failed to link');
      return;
    }
    await supabase.from('accounting_draft_expenses').update({ transaction_date: tx.transaction_date }).eq('id', draftId);
    setLinkedDraftIds((prev) => new Set([...prev, draftId]));
    setSuggestedMatchesByDraftId((prev) => {
      const next = { ...prev };
      delete next[draftId];
      return next;
    });
    toast.success(`Linked to bank transaction. Payment date set to ${formatDate(tx.transaction_date)}.`);
    await refreshDrafts();
  };

  const isDateInLockedPeriod = (dateStr) => {
    if (!dateStr || !periodLockConfig?.period_locked_until) return false;
    const t = new Date(dateStr).getTime();
    const lockedUntil = new Date(periodLockConfig.period_locked_until).getTime();
    return t <= lockedUntil;
  };

  const handleApprove = async (draft, { forceDuplicate = false } = {}) => {
    if (!selectedBusinessId) return;
    if (draft.is_duplicate && !forceDuplicate) {
      const ok = window.confirm(
        'This invoice looks like a duplicate of one you already have (same vendor and invoice number). Post anyway?'
      );
      if (!ok) return;
      return handleApprove(draft, { forceDuplicate: true });
    }
    setApprovingDraftId(draft.id);
    try {
      const { data, error } = await supabase.functions.invoke('accounting-post-expense', {
        body: { business_id: selectedBusinessId, draft_id: draft.id, force_duplicate: forceDuplicate }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(draft.is_fixed_asset ? 'Asset expense posted to ERPNext and added to Assets' : 'Expense approved and posted to ERPNext');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'expense_posted',
        entityType: 'draft_expense',
        entityId: draft.id,
        details: { source: draft.source, transaction_date: draft.transaction_date, total_amount: draft.total_amount }
      });
      await refreshDrafts();
    } catch (e) {
      toast.error(e?.message || 'Failed to approve');
    }
    setApprovingDraftId(null);
  };

  const handleApproveBatch = async (batch) => {
    if (!selectedBusinessId) return;
    setApprovingBatchId(batch.id);
    try {
      const { data, error } = await supabase.functions.invoke('accounting-post-batch', {
        body: { business_id: selectedBusinessId, batch_id: batch.id }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Sales batch posted to ERPNext');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'sales_batch_posted',
        entityType: 'sales_batch',
        entityId: batch.id,
        details: { batch_date: batch.batch_date, total_sales_amount: batch.total_sales_amount }
      });
      await refreshDrafts();
    } catch (e) {
      toast.error(e?.message || 'Failed to approve batch');
    }
    setApprovingBatchId(null);
  };

  const handleApproveDeposit = async (deposit) => {
    if (!selectedBusinessId) return;
    setApprovingDepositId(deposit.id);
    try {
      const { data, error } = await supabase.functions.invoke('accounting-post-deposit', {
        body: { business_id: selectedBusinessId, deposit_id: deposit.id }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Deposit posted to ERPNext');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'deposit_posted',
        entityType: 'deposit',
        entityId: deposit.id,
        details: { deposit_date: deposit.deposit_date, total_amount: deposit.total_amount, bank_account_erpnext: deposit.bank_account_erpnext || null }
      });
      await refreshDrafts();
    } catch (e) {
      toast.error(e?.message || 'Failed to approve deposit');
    }
    setApprovingDepositId(null);
  };

  const toggleBatchSelection = (batchId) => {
    setSelectedBatchIds((prev) =>
      prev.includes(batchId) ? prev.filter((id) => id !== batchId) : [...prev, batchId]
    );
  };

  const handleGroupIntoDeposit = async () => {
    if (!selectedBusinessId || selectedBatchIds.length === 0) return;
    const toGroup = batches.filter((b) => selectedBatchIds.includes(b.id));
    if (toGroup.length === 0) return;
    setGroupingDeposit(true);
    try {
      const depositDate = toGroup.reduce((max, b) => (b.batch_date > max ? b.batch_date : max), toGroup[0].batch_date);
      const totalAmount = toGroup.reduce(
        (sum, b) =>
          sum +
          (Number(b.total_sales_amount) || 0) +
          (Number(b.total_tax_amount) || 0) -
          (Number(b.total_refunds_amount) || 0),
        0
      );
      const { data: deposit, error: depositErr } = await supabase
        .from('accounting_deposits')
        .insert({
          business_id: selectedBusinessId,
          deposit_date: depositDate.slice(0, 10),
          total_amount: Math.round(totalAmount * 100) / 100,
          status: 'draft'
        })
        .select('id')
        .single();
      if (depositErr) throw depositErr;
      const { error: linkErr } = await supabase.from('accounting_deposit_batches').insert(
        toGroup.map((b) => ({ deposit_id: deposit.id, batch_id: b.id }))
      );
      if (linkErr) throw linkErr;
      await supabase
        .from('accounting_sales_batches')
        .update({ deposit_id: deposit.id })
        .in('id', selectedBatchIds);
      setSelectedBatchIds([]);
      toast.success(`Deposit created with ${toGroup.length} batch(es). Approve it below.`);
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'draft_deposit_created',
        entityType: 'deposit',
        entityId: deposit.id,
        details: { batch_ids: selectedBatchIds, total_amount: Math.round(totalAmount * 100) / 100 }
      });
      await refreshDrafts();
    } catch (e) {
      toast.error(e?.message || 'Failed to group into deposit');
    }
    setGroupingDeposit(false);
  };

  const handleCreateSalesBatches = async () => {
    if (!selectedBusinessId) return;
    const backfillDays = 90;
    console.log('[Accounting] Create sales batches: start', { business_id: selectedBusinessId, backfill_days: backfillDays });
    setCreatingBatches(true);
    try {
      const { data, error } = await supabase.functions.invoke('accounting-daily-batch', {
        body: { business_id: selectedBusinessId, backfill_days: backfillDays }
      });
      console.log('[Accounting] Create sales batches: response', { data, error: error?.message ?? error });
      if (error) {
        console.warn('[Accounting] Create sales batches: invoke error', error);
        toast.error(error?.message || 'Failed to create batches');
        return;
      }
      if (data?.error) {
        console.warn('[Accounting] Create sales batches: function error', data.error);
        toast.error(data.error);
        return;
      }
      const results = data?.results ?? [];
      const message = data?.message;
      const created = results.filter((r) => r.created).length;
      const skipped = results.filter((r) => r.created === false).length;
      const withError = results.filter((r) => r.error);
      if (message) console.log('[Accounting] Create sales batches: function message', message);
      if (withError.length > 0) console.warn('[Accounting] Create sales batches: some dates had errors', withError);
      console.log('[Accounting] Create sales batches: summary', { created, skipped, errors: withError.length, total: results.length });
      if (message) toast(message, { icon: '⚠️', duration: 6000 });
      else if (created > 0) toast.success(`Created ${created} sales batch(es). ${skipped} day(s) already had batches.`);
      else if (skipped > 0) toast.success('All days already have batches. Nothing new created.');
      else toast.success('Batch job completed.');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'sales_batches_generated',
        entityType: 'sales_batch_job',
        entityId: null,
        details: { created, skipped, errors: withError.length, total: results.length, backfill_days: backfillDays }
      });
      await refreshDrafts();
    } catch (e) {
      console.error('[Accounting] Create sales batches: exception', e);
      toast.error(e?.message || 'Failed to create batches');
    } finally {
      setCreatingBatches(false);
      console.log('[Accounting] Create sales batches: done');
    }
  };

  const handleUnapprove = async (draft) => {
    if (!confirm('Cancel approval and send this expense back to draft? ERPNext will create reversing entries.')) return;
    if (!selectedBusinessId) return;
    setUnapprovingDraftId(draft.id);
    try {
      const { data, error } = await supabase.functions.invoke('accounting-unapprove-expense', {
        body: { business_id: selectedBusinessId, draft_id: draft.id }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Approval cancelled. Expense sent back to draft.');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'expense_unapproved',
        entityType: 'draft_expense',
        entityId: draft.id,
        details: { source: draft.source, transaction_date: draft.transaction_date }
      });
      await refreshDrafts();
    } catch (e) {
      toast.error(e?.message || 'Failed to un-approve');
    }
    setUnapprovingDraftId(null);
  };

  const handleUnapproveBatch = async (batch) => {
    if (!confirm('Cancel this posted sales batch and send it back to draft? ERPNext will cancel the sales Journal Entry.')) return;
    if (!selectedBusinessId) return;
    setUnapprovingBatchId(batch.id);
    try {
      const { data, error } = await supabase.functions.invoke('accounting-unapprove-batch', {
        body: { business_id: selectedBusinessId, batch_id: batch.id }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Sales batch sent back to draft.');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'sales_batch_unapproved',
        entityType: 'sales_batch',
        entityId: batch.id,
        details: { batch_date: batch.batch_date }
      });
      await refreshDrafts();
    } catch (e) {
      toast.error(e?.message || 'Failed to un-approve batch');
    }
    setUnapprovingBatchId(null);
  };

  const handleUnapproveDeposit = async (deposit) => {
    if (!confirm('Cancel this posted deposit and send it back to draft? ERPNext will cancel the deposit Journal Entry.')) return;
    if (!selectedBusinessId) return;
    setUnapprovingDepositId(deposit.id);
    try {
      const { data, error } = await supabase.functions.invoke('accounting-unapprove-deposit', {
        body: { business_id: selectedBusinessId, deposit_id: deposit.id }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Deposit sent back to draft.');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'deposit_unapproved',
        entityType: 'deposit',
        entityId: deposit.id,
        details: { deposit_date: deposit.deposit_date }
      });
      await refreshDrafts();
    } catch (e) {
      toast.error(e?.message || 'Failed to un-approve deposit');
    }
    setUnapprovingDepositId(null);
  };

  const handleDeleteDraftDeposit = async (deposit) => {
    if (!confirm('Delete this draft deposit and unlink its batches?')) return;
    if (!selectedBusinessId) return;
    setDeletingDepositId(deposit.id);
    try {
      const { data: depositBatchRows, error: rowsError } = await supabase
        .from('accounting_deposit_batches')
        .select('batch_id')
        .eq('deposit_id', deposit.id);
      if (rowsError) throw rowsError;

      const batchIds = (depositBatchRows || []).map((row) => row.batch_id);
      if (batchIds.length > 0) {
        const { error: unlinkBatchErr } = await supabase
          .from('accounting_sales_batches')
          .update({ deposit_id: null })
          .in('id', batchIds);
        if (unlinkBatchErr) throw unlinkBatchErr;

        const { error: deleteLinkErr } = await supabase
          .from('accounting_deposit_batches')
          .delete()
          .eq('deposit_id', deposit.id);
        if (deleteLinkErr) throw deleteLinkErr;
      }

      const { error: deleteDepositErr } = await supabase
        .from('accounting_deposits')
        .delete()
        .eq('id', deposit.id)
        .eq('business_id', selectedBusinessId);
      if (deleteDepositErr) throw deleteDepositErr;

      toast.success('Draft deposit deleted and batches unlinked.');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'draft_deposit_deleted',
        entityType: 'deposit',
        entityId: deposit.id,
        details: { deleted_deposit_id: deposit.id, batch_ids: batchIds }
      });
      await refreshDrafts();
    } catch (e) {
      toast.error(e?.message || 'Failed to delete draft deposit');
    }
    setDeletingDepositId(null);
  };

  const handleDeleteDraft = async (draft) => {
    const msg = draft.source === 'bank_csv'
      ? 'Remove this expense and send the bank transaction back to Bank Import to be categorized again?'
      : 'Delete this draft expense?';
    if (!confirm(msg)) return;
    const draftId = draft.id;
    const { data: affectedTx } = await supabase
      .from('accounting_bank_transaction_draft_matches')
      .select('bank_transaction_id')
      .eq('draft_expense_id', draftId);
    const { error: delMatchErr } = await supabase
      .from('accounting_bank_transaction_draft_matches')
      .delete()
      .eq('draft_expense_id', draftId);
    if (delMatchErr) {
      toast.error(delMatchErr.message || 'Failed to unlink');
      return;
    }
    for (const row of affectedTx || []) {
      const { count } = await supabase
        .from('accounting_bank_transaction_draft_matches')
        .select('*', { count: 'exact', head: true })
        .eq('bank_transaction_id', row.bank_transaction_id);
      if (count === 0) {
        await supabase
          .from('accounting_bank_transactions')
          .update({ matched_draft_expense_id: null, status: 'pending' })
          .eq('id', row.bank_transaction_id);
      }
    }
    const { error: delErr } = await supabase.from('accounting_draft_expenses').delete().eq('id', draftId);
    if (delErr) {
      toast.error(delErr.message || 'Failed to delete draft');
      return;
    }
    setLinkedDraftIds((prev) => { const n = new Set(prev); n.delete(draftId); return n; });
    setSuggestedMatchesByDraftId((prev) => { const n = { ...prev }; delete n[draftId]; return n; });
    toast.success(draft.source === 'bank_csv' ? 'Expense removed. Transaction is back on Bank Import.' : 'Draft deleted.');
    setEditingDraft((prev) => (prev?.id === draftId ? null : prev));
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
    setOnHoldDrafts((prev) => prev.filter((d) => d.id !== draftId));
  };

  const handleReplaceInvoicePdfClick = (draft) => {
    setReplacePdfDraftId(draft.id);
    replacePdfInputRef.current?.click();
  };

  const handleReplaceInvoicePdfFile = async (e) => {
    const file = e.target?.files?.[0];
    const draftId = replacePdfDraftId;
    setReplacePdfDraftId(null);
    e.target.value = '';
    if (!file || !draftId || !selectedBusinessId) return;
    const type = String(file.type || '').toLowerCase();
    const name = String(file.name || '').toLowerCase();
    const allowed =
      type === 'application/pdf'
      || /^image\/(jpeg|jpg|png|webp)$/.test(type)
      || /\.(pdf|png|jpe?g|webp)$/.test(name);
    if (!allowed) {
      toast.error('Please select a PDF or image (JPG, PNG, WEBP).');
      return;
    }
    const contentType = file.type
      || (name.endsWith('.pdf') ? 'application/pdf'
        : (name.endsWith('.png') ? 'image/png'
          : (name.endsWith('.webp') ? 'image/webp' : 'image/jpeg')));
    setReplacePdfUploading(true);
    try {
      const path = `${selectedBusinessId}/${crypto.randomUUID()}/${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error: upErr } = await supabase.storage.from('expense-invoices').upload(path, file, { contentType, upsert: false });
      if (upErr) {
        toast.error(upErr.message || 'Upload failed');
        return;
      }
      // Clear attachment_id so Open/Extract use the replacement instead of the original email file.
      const { error: uErr } = await supabase
        .from('accounting_draft_expenses')
        .update({ invoice_file_path: path, attachment_id: null })
        .eq('id', draftId);
      if (uErr) {
        toast.error(uErr.message || 'Failed to update draft');
        return;
      }
      toast.success('Invoice file uploaded. Run Extract Invoices to re-extract from it.');
      await refreshDrafts();
      setEditingDraft((prev) => (prev?.id === draftId ? { ...prev, invoice_file_path: path, attachment_id: null } : prev));
      patchDraftInState(draftId, { invoice_file_path: path, attachment_id: null });
    } catch (err) {
      toast.error(err?.message || 'Replace invoice failed');
    } finally {
      setReplacePdfUploading(false);
    }
  };

  const patchDraftInState = (draftId, patch) => {
    setDrafts((prev) => prev.map((d) => (d.id === draftId ? { ...d, ...patch } : d)));
    setOnHoldDrafts((prev) => prev.map((d) => (d.id === draftId ? { ...d, ...patch } : d)));
    setEditingDraft((prev) => (prev?.id === draftId ? { ...prev, ...patch } : prev));
  };

  const handleParkDraft = async (draft) => {
    if (!draft?.id) return;
    setHoldingDraftId(draft.id);
    try {
      const { error } = await supabase
        .from('accounting_draft_expenses')
        .update({ status: 'on_hold' })
        .eq('id', draft.id)
        .eq('status', 'draft');
      if (error) throw error;
      const parked = { ...draft, status: 'on_hold' };
      setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
      setOnHoldDrafts((prev) => [parked, ...prev.filter((d) => d.id !== draft.id)]);
      setEditingDraft((prev) => (prev?.id === draft.id ? null : prev));
      toast.success('Moved to On Hold');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'expense_on_hold',
        entityType: 'draft_expense',
        entityId: draft.id,
        details: { vendor: draft.vendor_name_display, source: draft.source },
      });
    } catch (e) {
      toast.error(e?.message || 'Failed to put expense on hold');
    } finally {
      setHoldingDraftId(null);
    }
  };

  const handleRestoreDraft = async (draft) => {
    if (!draft?.id) return;
    setHoldingDraftId(draft.id);
    try {
      const { error } = await supabase
        .from('accounting_draft_expenses')
        .update({ status: 'draft' })
        .eq('id', draft.id)
        .eq('status', 'on_hold');
      if (error) throw error;
      const restored = { ...draft, status: 'draft' };
      setOnHoldDrafts((prev) => prev.filter((d) => d.id !== draft.id));
      setDrafts((prev) => [restored, ...prev.filter((d) => d.id !== draft.id)]);
      toast.success('Returned to Pending');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'expense_restored_from_hold',
        entityType: 'draft_expense',
        entityId: draft.id,
        details: { vendor: draft.vendor_name_display, source: draft.source },
      });
    } catch (e) {
      toast.error(e?.message || 'Failed to return expense to queue');
    } finally {
      setHoldingDraftId(null);
    }
  };

  const handleInlineDraftUpdate = async (draft, updates) => {
    if (!draft?.id || !selectedBusinessId) return;
    const draftId = draft.id;
    setSavingInlineDraftId(draftId);
    const payload = { ...updates };

    if (Object.prototype.hasOwnProperty.call(updates, 'vendor_id')) {
      if (updates.vendor_id) {
        const v = vendors.find((x) => x.id === updates.vendor_id);
        if (v) {
          payload.vendor_name_display = v.name;
          if (v.default_expense_category_id) {
            payload.expense_category_id = v.default_expense_category_id;
            const cat = categories.find((c) => c.id === v.default_expense_category_id);
            if (cat?.gl_account_erpnext) payload.gl_account_erpnext = cat.gl_account_erpnext;
          }
          if (v.default_hst_treatment) payload.hst_treatment = v.default_hst_treatment;
        }
      } else {
        payload.vendor_id = null;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'expense_category_id')) {
      const cat = categories.find((c) => c.id === updates.expense_category_id);
      payload.gl_account_erpnext = cat?.gl_account_erpnext || null;
      if (cat?.default_hst_treatment && !Object.prototype.hasOwnProperty.call(updates, 'hst_treatment')) {
        payload.hst_treatment = cat.default_hst_treatment;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, '_totalAbs')) {
      const n = Math.abs(Number(updates._totalAbs));
      payload.total_amount = n > 0 ? -round2(n) : 0;
      delete payload._totalAbs;
    }

    if (Object.prototype.hasOwnProperty.call(updates, '_taxAbs')) {
      const raw = updates._taxAbs;
      payload.tax_amount = raw === '' || raw == null || Number.isNaN(Number(raw)) ? 0 : -round2(Math.abs(Number(raw)));
      delete payload._taxAbs;
    }

    if (Object.prototype.hasOwnProperty.call(updates, '_cadSettlement')) {
      const raw = updates._cadSettlement;
      payload.cad_settlement_total = raw === '' || raw == null || Number.isNaN(Number(raw)) ? null : Math.abs(round2(Number(raw)));
      delete payload._cadSettlement;
    }

    const effectiveHst = payload.hst_treatment ?? draft.hst_treatment;
    if (String(effectiveHst || '').toLowerCase() === 'exempt') {
      payload.tax_amount = 0;
      payload.hst_calculated = false;
    }

    const amountFieldsTouched = ['total_amount', 'subtotal', 'tax_amount', 'hst_treatment', '_totalAbs', '_taxAbs']
      .some((key) => Object.prototype.hasOwnProperty.call(updates, key));
    if (amountFieldsTouched) {
      const merged = { ...draft, ...payload };
      const reconciled = reconcileDraftExpenseAmounts({
        subtotal: merged.subtotal,
        tax_amount: merged.tax_amount,
        total_amount: merged.total_amount,
        hst_treatment: effectiveHst,
      });
      payload.subtotal = reconciled.subtotal;
      payload.tax_amount = reconciled.tax_amount;
      payload.total_amount = reconciled.total_amount;
    }

    const { error } = await supabase.from('accounting_draft_expenses').update(payload).eq('id', draftId);
    if (error) {
      toast.error(error.message || 'Failed to save');
      setSavingInlineDraftId(null);
      return;
    }

    const merged = { ...draft, ...payload };
    patchDraftInState(draftId, payload);

    if (payload.total_amount != null || payload.cad_settlement_total != null || payload.transaction_date != null) {
      const suggested = await getSuggestedBankMatches(supabase, selectedBusinessId, merged);
      setSuggestedMatchesByDraftId((prev) => ({ ...prev, [draftId]: suggested }));
    }

    setSavingInlineDraftId(null);

    if (
      payload.invoice_number != null
      || payload.vendor_id != null
      || payload.vendor_name_display != null
    ) {
      try {
        await supabase.functions.invoke('accounting-sync-draft-duplicates', {
          body: { business_id: selectedBusinessId, draft_id: draftId }
        });
        const { data: refreshed } = await supabase
          .from('accounting_draft_expenses')
          .select('is_duplicate, duplicate_of_draft_id')
          .eq('id', draftId)
          .single();
        if (refreshed) patchDraftInState(draftId, refreshed);
      } catch {
        /* non-fatal */
      }
    }
  };

  const handleOpenAttachedInvoice = async (draft) => {
    setOpeningInvoiceDraftId(draft.id);
    try {
      await openExpenseInvoiceAttachment(supabase, draft);
    } catch (e) {
      toast.error(e?.message || 'Could not open file');
    } finally {
      setOpeningInvoiceDraftId(null);
    }
  };

  const sortedApprovedDrafts = useMemo(() => {
    const vendorName = (d) => {
      if (d.vendor_id) {
        const v = vendors.find((x) => x.id === d.vendor_id);
        return v?.name || d.vendor_name_display || '—';
      }
      return d.vendor_name_display || '—';
    };
    const categoryName = (d) => {
      if (d.expense_category_id) {
        const cat = categories.find((c) => c.id === d.expense_category_id);
        if (cat?.name) return cat.name;
      }
      if (d.gl_account_erpnext) return d.gl_account_erpnext;
      return '—';
    };
    const sortValue = (draft, columnId) => {
      const amounts = getEffectiveExpenseAmounts(draft);
      switch (columnId) {
        case 'vendor':
          return vendorName(draft);
        case 'category':
          return categoryName(draft);
        case 'paid_from':
          return draft.credit_account_erpnext || payableAccountLabel;
        case 'date': {
          const raw = draft.transaction_date || draft.invoice_date;
          if (!raw) return null;
          const s = String(raw).slice(0, 10);
          return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
        }
        case 'amount':
          return signedApprovedAmount(draft, amounts.total);
        case 'hst':
          if (amounts.usedCadSettlement || draft.hst_treatment === 'exempt') return null;
          return signedApprovedAmount(draft, amounts.tax_amount ?? draft.tax_amount);
        case 'invoice':
          return draft.invoice_number || null;
        case 'source':
          if (draft.source === 'bank_csv') return 'From bank';
          if (draft.source === 'email') return 'Email';
          return draft.source || null;
        case 'match':
          return linkedDraftIds.has(draft.id) ? 'Linked to bank' : null;
        case 'status':
          return 'Posted';
        default:
          return null;
      }
    };
    const q = approvedSearch.trim().toLowerCase();
    let rows = [...(approvedDrafts || [])];
    if (approvedDateFrom) {
      rows = rows.filter((d) => {
        const raw = String(d.transaction_date || d.invoice_date || '').slice(0, 10);
        return raw && raw >= approvedDateFrom;
      });
    }
    if (approvedDateTo) {
      rows = rows.filter((d) => {
        const raw = String(d.transaction_date || d.invoice_date || '').slice(0, 10);
        return raw && raw <= approvedDateTo;
      });
    }
    if (q) {
      rows = rows.filter((d) => {
        const amounts = getEffectiveExpenseAmounts(d);
        const hay = [
          vendorName(d),
          categoryName(d),
          d.invoice_number,
          d.source,
          d.erpnext_purchase_invoice_id,
          d.gl_account_erpnext,
          d.credit_account_erpnext,
          d.asset_name,
          d.transaction_date,
          amounts.total != null ? String(amounts.total) : '',
          amounts.total != null ? Math.abs(Number(amounts.total)).toFixed(2) : '',
        ].join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    rows.sort((a, b) => compareApprovedSortValues(
      sortValue(a, approvedSortColumn),
      sortValue(b, approvedSortColumn),
      approvedSortDir
    ));
    return rows;
  }, [approvedDrafts, approvedSearch, approvedDateFrom, approvedDateTo, approvedSortColumn, approvedSortDir, vendors, categories, linkedDraftIds, payableAccountLabel]);

  const approvedHasMore = typeof approvedTotalCount === 'number' && approvedTotalCount > approvedDrafts.length;
  const approvedHasActiveFilters = !!(approvedSearch.trim() || approvedDateFrom || approvedDateTo);

  if (authLoading || !selectedBusinessId) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: TavariStyles?.colors?.gray600 }}>
        Loading...
      </div>
    );
  }

  const formatDate = (d) => formatAccountingDateLabel(d, accountingTimezone);
  const formatMoney = (n) => (n != null ? '$' + Number(n).toFixed(2) : '—');

  const emailDrafts = drafts.filter((d) => d.source === 'email');
  const otherDrafts = drafts.filter((d) => d.source !== 'email');
  const emailDraftSummary = emailDrafts.reduce((acc, draft) => {
    const bucket = getEmailDraftStatusMeta(draft).bucket;
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, { extracting: 0, review: 0, ready: 0, other: 0 });

  const extractingSpinnerStyle = { animation: 'spin 1s linear infinite', marginRight: 8, verticalAlign: 'middle' };

  function vendorDisplayForDraft(d) {
    if (d.vendor_id) {
      const v = vendors.find((x) => x.id === d.vendor_id);
      return v?.name || d.vendor_name_display || '—';
    }
    return d.vendor_name_display || '—';
  }

  function categoryDisplayForDraft(d) {
    if (d.expense_category_id) {
      const cat = categories.find((c) => c.id === d.expense_category_id);
      if (cat?.name) return cat.name;
    }
    if (d.gl_account_erpnext) return d.gl_account_erpnext;
    return '—';
  }

  const handleApprovedSortColumn = (columnId) => {
    if (!APPROVED_SORT_COLUMNS.some((c) => c.id === columnId)) return;
    if (approvedSortColumn === columnId) {
      setApprovedSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setApprovedSortColumn(columnId);
      setApprovedSortDir('asc');
    }
  };

  const ApprovedSortableTh = ({ columnId, label }) => {
    const active = approvedSortColumn === columnId;
    return (
      <th style={{ ...queueStyles.expenseTh, padding: 0 }}>
        <button
          type="button"
          onClick={() => handleApprovedSortColumn(columnId)}
          title={active
            ? (approvedSortDir === 'asc' ? 'Sorted ascending — tap to reverse' : 'Sorted descending — tap to reverse')
            : `Sort by ${label}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            width: '100%',
            padding: '10px 12px',
            border: 'none',
            background: active ? '#f0fdfa' : 'transparent',
            color: active ? (TavariStyles?.colors?.primary || '#008080') : (TavariStyles?.colors?.gray700 || '#374151'),
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
            textAlign: 'left',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
          {active && (approvedSortDir === 'asc' ? <FiChevronUp size={14} aria-hidden /> : <FiChevronDown size={14} aria-hidden />)}
        </button>
      </th>
    );
  };

  function taxExceeds13(draft) {
    const base = draft.subtotal ?? draft.total_amount;
    return draft.tax_amount != null && base != null && base !== 0 && Math.abs(Number(draft.tax_amount)) > 0.13 * Math.abs(Number(base));
  }
  function taxNeedsVerify(draft) {
    return draft.hst_calculated || draft.tax_exceeds_13_percent || taxExceeds13(draft);
  }
  function getEmailDraftStatusMeta(draft) {
    if (draft.status === 'on_hold') {
      return {
        label: 'On hold',
        detail: 'Parked until CAD amount, docs, or other info is ready.',
        tone: '#b45309',
        background: '#fffbeb',
        border: '#fde68a',
        bucket: 'other',
      };
    }
    if (draft.source !== 'email') {
      return { label: 'Draft', detail: 'Manual review needed before posting.', tone: '#6b7280', background: '#f3f4f6', border: '#d1d5db', bucket: 'other' };
    }
    if (isEmailDraftExtracting(draft)) {
      return { label: 'Extracting', detail: 'Attachment or email body is still being read.', tone: '#6b7280', background: '#f3f4f6', border: '#d1d5db', bucket: 'extracting' };
    }
    if (draft.is_duplicate) {
      return { label: 'Duplicate', detail: 'Same vendor and invoice number as an existing expense. Delete or confirm before posting.', tone: '#b45309', background: '#fffbeb', border: '#fde68a', bucket: 'review' };
    }
    if (draft.document_type === 'credit_memo') {
      return { label: 'Credit memo', detail: draft.credit_memo_against
        ? `Vendor credit against invoice ${draft.credit_memo_against}. Posts as ERPNext return (reduces expense).`
        : 'Vendor credit memo. Posts as ERPNext return (reduces expense).', tone: '#1d4ed8', background: '#eff6ff', border: '#bfdbfe', bucket: 'review' };
    }
    const hasVendor = !!vendorDisplayForDraft(draft) && vendorDisplayForDraft(draft) !== '—';
    const hasAmounts = draft.total_amount != null && !Number.isNaN(Number(draft.total_amount)) && Number(draft.total_amount) !== 0;
    const hasInvoiceSource = !!draft.invoice_file_path || !!draft.received_email_id;
    if (!hasInvoiceSource) {
      return { label: 'Needs source', detail: 'Upload or re-link the invoice before extracting again.', tone: '#b45309', background: '#fffbeb', border: '#fde68a', bucket: 'review' };
    }
    if (!hasVendor || !hasAmounts) {
      return { label: 'Needs review', detail: 'Confirm vendor, date, and amounts before approval.', tone: '#b45309', background: '#fffbeb', border: '#fde68a', bucket: 'review' };
    }
    if (taxNeedsVerify(draft)) {
      return { label: 'Verify tax', detail: 'Review calculated tax before posting.', tone: '#b45309', background: '#fffbeb', border: '#fde68a', bucket: 'review' };
    }
    if (needsCadSettlement(draft)) {
      const currency = String(draft.invoice_currency || 'USD').toUpperCase();
      return { label: 'Enter CAD charge', detail: `Invoice is in ${currency}. Enter the CAD amount from your bank or card before posting.`, tone: '#b45309', background: '#fffbeb', border: '#fde68a', bucket: 'review' };
    }
    if (draft.is_fixed_asset && !(draft.asset_name || '').trim()) {
      return { label: 'Asset details', detail: 'Open edit and enter an asset name before posting.', tone: '#b45309', background: '#fffbeb', border: '#fde68a', bucket: 'review' };
    }
    if (draft.is_fixed_asset) {
      return { label: 'Fixed asset', detail: 'Will post to a fixed-asset account and appear on the Assets tab.', tone: '#047857', background: '#ecfdf5', border: '#a7f3d0', bucket: 'ready' };
    }
    return { label: 'Ready', detail: 'Looks complete and can be approved.', tone: '#059669', background: '#ecfdf5', border: '#a7f3d0', bucket: 'ready' };
  }

  const renderDraftRow = (d) => {
    const extracting = isEmailDraftExtracting(d);
    const showTaxVerify = taxNeedsVerify(d);
    const showTaxOver13 = d.tax_exceeds_13_percent || taxExceeds13(d);
    const statusMeta = getEmailDraftStatusMeta(d);
    const missingCategory = !extracting && !d.expense_category_id;
    const rowBusy = extracting || savingInlineDraftId === d.id;
    const foreign = isForeignCurrencyDraft(d);
    const invoiceCurrency = String(d.invoice_currency || 'CAD').toUpperCase();
    const hasInvoiceFile = !!(d.invoice_file_path || d.attachment_id);

    return (
    <tr key={d.id}>
      <td style={queueStyles.expenseTd}>
        {extracting ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', color: '#6b7280' }}>
            <FiLoader size={18} style={extractingSpinnerStyle} />
            Extracting…
          </span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 140 }}>
            <select
              value={d.vendor_id || ''}
              onChange={(e) => handleInlineDraftUpdate(d, { vendor_id: e.target.value || null })}
              style={queueStyles.inlineSelect}
              disabled={rowBusy}
              title="Vendor"
            >
              <option value="">Custom vendor</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            {!d.vendor_id && (
              <input
                key={`${d.id}-vendor-name-${d.vendor_name_display || ''}`}
                type="text"
                defaultValue={d.vendor_name_display || ''}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name !== (d.vendor_name_display || '').trim()) {
                    handleInlineDraftUpdate(d, { vendor_name_display: name || null });
                  }
                }}
                placeholder="Vendor name"
                style={queueStyles.inlineInput}
                disabled={rowBusy}
              />
            )}
          </div>
        )}
      </td>
      <td
        style={{
          ...queueStyles.expenseTd,
          ...(missingCategory ? { background: '#fef3c7' } : {})
        }}
      >
        {extracting ? '—' : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <select
              value={d.expense_category_id || ''}
              onChange={(e) => handleInlineDraftUpdate(d, { expense_category_id: e.target.value || null })}
              style={queueStyles.inlineSelect}
              disabled={rowBusy}
              title={d.gl_account_erpnext ? `GL: ${d.gl_account_erpnext}` : 'Category'}
            >
              <option value="">— Select —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {d.is_fixed_asset && (
              <span style={{ fontSize: 11, fontWeight: 600, color: '#047857' }} title={d.asset_name || 'Fixed asset purchase'}>
                Fixed asset{d.asset_name ? `: ${d.asset_name}` : ''}
              </span>
            )}
          </div>
        )}
      </td>
      <td style={queueStyles.expenseTd}>
        {extracting ? '—' : (
          <select
            value={d.credit_account_erpnext || ''}
            onChange={(e) => handleInlineDraftUpdate(d, { credit_account_erpnext: e.target.value || null })}
            style={{ ...queueStyles.inlineSelect, minWidth: 160, maxWidth: 220 }}
            disabled={rowBusy}
            title="Paid from / assign to (AP unpaid, or cash on hand / bank / clearing)"
          >
            <option value="">{payableAccountLabel}</option>
            {creditAccountOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
            {!!d.credit_account_erpnext && !creditAccountOptions.some((o) => o.value === d.credit_account_erpnext) && (
              <option value={d.credit_account_erpnext}>{d.credit_account_erpnext}</option>
            )}
          </select>
        )}
      </td>
      <td style={queueStyles.expenseTd}>
        {extracting ? '—' : (
          <BusinessCalendarPicker
            value={d.transaction_date || ''}
            onChange={(dateKey) => handleInlineDraftUpdate(d, { transaction_date: dateKey || null })}
            businessTimezone={accountingTimezone}
            compact
            disabled={rowBusy}
            ariaLabel="Payment / transaction date"
            placeholder="Date"
          />
        )}
      </td>
      <td style={queueStyles.expenseTd}>
        {extracting ? '—' : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 110 }}>
            <select
              value={invoiceCurrency}
              onChange={(e) => handleInlineDraftUpdate(d, { invoice_currency: e.target.value })}
              style={queueStyles.inlineSelect}
              disabled={rowBusy}
              title="Invoice currency"
            >
              {INLINE_CURRENCY_OPTIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input
              key={`${d.id}-total-${d.total_amount}`}
              type="number"
              step="0.01"
              min="0"
              defaultValue={d.total_amount != null ? Math.abs(Number(d.total_amount)) : ''}
              onBlur={(e) => {
                const n = e.target.value;
                if (n === '') return;
                const abs = Math.abs(Number(n));
                if (!Number.isNaN(abs) && abs !== Math.abs(Number(d.total_amount) || 0)) {
                  handleInlineDraftUpdate(d, { _totalAbs: abs });
                }
              }}
              style={queueStyles.inlineInput}
              disabled={rowBusy}
              title={foreign ? `Invoice total (${invoiceCurrency})` : 'Total amount'}
              placeholder="Total"
            />
            {foreign && (
              <input
                key={`${d.id}-cad-${d.cad_settlement_total ?? ''}`}
                type="number"
                step="0.01"
                min="0"
                defaultValue={d.cad_settlement_total ?? ''}
                onBlur={(e) => {
                  const raw = e.target.value;
                  const next = raw === '' ? null : Math.abs(Number(raw));
                  const prev = d.cad_settlement_total ?? null;
                  if (next !== prev && !(next == null && prev == null)) {
                    handleInlineDraftUpdate(d, { _cadSettlement: raw });
                  }
                }}
                style={{ ...queueStyles.inlineInput, borderColor: needsCadSettlement(d) ? '#f59e0b' : undefined }}
                disabled={rowBusy}
                title="CAD amount charged on card/bank"
                placeholder="CAD charged"
              />
            )}
          </div>
        )}
      </td>
      <td
        style={{
          ...queueStyles.expenseTd,
          ...(showTaxVerify ? { background: '#fef3c7' } : {})
        }}
        title={d.hst_calculated ? 'HST was calculated (verify)' : (showTaxOver13 ? 'Tax exceeds 13% – verify' : undefined)}
      >
        {extracting ? '—' : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 100 }}>
            <select
              value={d.hst_treatment || 'recoverable'}
              onChange={(e) => handleInlineDraftUpdate(d, { hst_treatment: e.target.value })}
              style={queueStyles.inlineSelect}
              disabled={rowBusy}
              title="HST treatment"
            >
              {INLINE_HST_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {d.hst_treatment === 'exempt' ? (
              <span style={{ fontSize: 13, color: '#6b7280' }}>No tax (exempt)</span>
            ) : (
              <input
                key={`${d.id}-tax-${d.tax_amount ?? ''}-${d.hst_treatment ?? ''}`}
                type="number"
                step="0.01"
                min="0"
                defaultValue={d.tax_amount != null && Math.abs(Number(d.tax_amount)) > 0 ? Math.abs(Number(d.tax_amount)) : ''}
                onBlur={(e) => {
                  const raw = e.target.value;
                  const abs = raw === '' ? 0 : Math.abs(Number(raw));
                  const prevAbs = d.tax_amount != null ? Math.abs(Number(d.tax_amount)) : 0;
                  if (!Number.isNaN(abs) && abs !== prevAbs) {
                    handleInlineDraftUpdate(d, { _taxAbs: raw });
                  }
                }}
                style={queueStyles.inlineInput}
                disabled={rowBusy}
                placeholder="Tax $"
                title="Tax amount"
              />
            )}
          </div>
        )}
      </td>
      <td style={queueStyles.expenseTd}>
        {extracting ? '—' : (
          <input
            key={`${d.id}-inv-${d.invoice_number || ''}`}
            type="text"
            defaultValue={d.invoice_number || ''}
            onBlur={(e) => {
              const val = e.target.value.trim();
              if (val !== (d.invoice_number || '').trim()) {
                handleInlineDraftUpdate(d, { invoice_number: val || null });
              }
            }}
            style={{ ...queueStyles.inlineInput, minWidth: 100, maxWidth: 160 }}
            disabled={rowBusy}
            placeholder="Invoice #"
          />
        )}
      </td>
      <td style={queueStyles.expenseTd}>
        <span style={{ fontSize: 13, color: '#6b7280' }}>{d.source === 'bank_csv' ? 'From bank' : d.source === 'email' ? 'Email' : d.invoice_file_path ? 'Upload' : (d.source || 'Manual')}</span>
      </td>
      <td style={queueStyles.expenseTd}>
        {linkedDraftIds.has(d.id) && (
          <span style={{ fontSize: 11, color: '#059669', fontWeight: 500 }} title="Linked to a bank transaction (see Bank Import)">Linked to bank</span>
        )}
        {!linkedDraftIds.has(d.id) && suggestedMatchesByDraftId[d.id]?.length > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#6b7280' }}>Possible match:</span>
            {suggestedMatchesByDraftId[d.id].map((tx) => (
              <button
                key={tx.id}
                type="button"
                style={{ fontSize: 11, padding: '4px 8px', background: TavariStyles?.colors?.primary || '#008080', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                onClick={() => handleLinkDraftToBank(d.id, tx)}
                disabled={linkingDraftId === d.id}
                title={`Link to bank tx ${formatDate(tx.transaction_date)} ${formatMoney(tx.amount)}`}
              >
                Link {formatDate(tx.transaction_date)} {formatMoney(tx.amount)}
              </button>
            ))}
          </span>
        )}
        {!linkedDraftIds.has(d.id) && (!suggestedMatchesByDraftId[d.id] || suggestedMatchesByDraftId[d.id].length === 0) && '—'}
      </td>
      <td style={queueStyles.expenseTd}>
        <div
          style={{
            display: 'inline-flex',
            flexDirection: 'column',
            gap: 2,
            padding: '8px 10px',
            borderRadius: 8,
            background: statusMeta.background,
            border: `1px solid ${statusMeta.border}`
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: statusMeta.tone }}>
            {statusMeta.label}
          </span>
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            {statusMeta.detail}
          </span>
          {!extracting && (
            <button
              type="button"
              style={{ marginTop: 6, padding: 0, border: 'none', background: 'none', fontSize: 11, color: '#2563eb', cursor: rowBusy ? 'not-allowed' : 'pointer', textAlign: 'left' }}
              disabled={rowBusy}
              onClick={() => handleInlineDraftUpdate(d, {
                document_type: isCreditMemoExpense(d) ? 'invoice' : 'credit_memo',
                ...(isCreditMemoExpense(d) ? { credit_memo_against: null } : {}),
              })}
            >
              {isCreditMemoExpense(d) ? 'Not a return' : 'Mark as vendor return'}
            </button>
          )}
        </div>
      </td>
      <td style={{ ...queueStyles.expenseTd, verticalAlign: 'middle' }}>
        <div style={queueStyles.actionsStack}>
          {(isDateInLockedPeriod(d.transaction_date) || savingInlineDraftId === d.id) && (
            <div style={queueStyles.actionsRow}>
              {isDateInLockedPeriod(d.transaction_date) && (
                <span style={{ fontSize: 11, color: '#b45309' }} title="Unlock in Settings to approve">Locked period</span>
              )}
              {savingInlineDraftId === d.id && (
                <FiLoader size={14} style={{ ...extractingSpinnerStyle, marginRight: 0 }} title="Saving…" />
              )}
            </div>
          )}
          <div style={queueStyles.actionsRow}>
            <button
              type="button"
              style={{ ...queueStyles.iconButton, color: TavariStyles?.colors?.success || '#059669' }}
              onClick={() => handleApprove(d)}
              disabled={approvingDraftId === d.id || isDateInLockedPeriod(d.transaction_date) || rowBusy}
              title={isDateInLockedPeriod(d.transaction_date) ? 'Unlock in Settings to approve' : 'Approve and post to ERPNext'}
            >
              {approvingDraftId === d.id ? <FiLoader style={extractingSpinnerStyle} /> : <FiCheck />} Approve
            </button>
            {d.status === 'on_hold' ? (
              <button
                type="button"
                style={{ ...queueStyles.iconButton, color: TavariStyles?.colors?.primary || '#008080' }}
                onClick={() => handleRestoreDraft(d)}
                disabled={holdingDraftId === d.id || rowBusy}
                title="Return this expense to the Pending queue"
              >
                {holdingDraftId === d.id ? <FiLoader style={extractingSpinnerStyle} /> : <FiRotateCcw />} Return
              </button>
            ) : (
              <button
                type="button"
                style={{ ...queueStyles.iconButton, color: '#b45309' }}
                onClick={() => handleParkDraft(d)}
                disabled={holdingDraftId === d.id || rowBusy}
                title="Park this expense (waiting on CAD amount, docs, or other info)"
              >
                {holdingDraftId === d.id ? <FiLoader style={extractingSpinnerStyle} /> : <FiPause />} On hold
              </button>
            )}
            <button
              type="button"
              style={queueStyles.iconButton}
              onClick={() => handleReplaceInvoicePdfClick(d)}
              disabled={replacePdfUploading}
              title="Upload the actual invoice (PDF or JPG/PNG). Then run Extract Invoices."
            >
              {replacePdfUploading && replacePdfDraftId === d.id ? <FiLoader style={extractingSpinnerStyle} /> : <FiUpload />} File
            </button>
          </div>
          <div style={queueStyles.actionsRow}>
            <button
              type="button"
              style={queueStyles.iconButton}
              onClick={() => setEditingDraft(d)}
              title="Full editor (split lines, re-extract, email)"
            >
              <FiEdit2 />
            </button>
            {hasInvoiceFile && (
              <button
                type="button"
                style={queueStyles.iconButton}
                onClick={() => handleOpenAttachedInvoice(d)}
                disabled={openingInvoiceDraftId === d.id}
                title="Open attached invoice"
              >
                {openingInvoiceDraftId === d.id ? <FiLoader style={extractingSpinnerStyle} /> : <FiExternalLink />}
              </button>
            )}
            <button
              type="button"
              style={{ ...queueStyles.iconButton, color: TavariStyles?.colors?.danger || '#dc2626' }}
              onClick={() => handleDeleteDraft(d)}
              title={d.source === 'bank_csv' ? 'Remove and send back to Bank Import' : 'Delete draft'}
            >
              <FiTrash2 />
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
  };

  const renderApprovedRow = (d) => {
    const amounts = getEffectiveExpenseAmounts(d);
    const displayTotal = amounts.total;
    return (
    <tr key={d.id}>
      <td style={queueStyles.expenseTd}>{vendorDisplayForDraft(d)}</td>
      <td style={queueStyles.expenseTd} title={d.gl_account_erpnext ? `GL: ${d.gl_account_erpnext}` : undefined}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>{categoryDisplayForDraft(d)}</span>
          {d.is_fixed_asset && (
            <span style={{ fontSize: 11, fontWeight: 600, color: '#047857' }}>{d.asset_name || 'Fixed asset'}</span>
          )}
        </div>
      </td>
      <td style={queueStyles.expenseTd} title={d.credit_account_erpnext || payableAccountLabel}>
        {d.credit_account_erpnext || payableAccountLabel}
      </td>
      <td style={queueStyles.expenseTd}>{formatDate(d.transaction_date)}</td>
      <td style={queueStyles.expenseTd}>{formatMoney(displayTotal)}</td>
      <td style={queueStyles.expenseTd}>{amounts.usedCadSettlement || d.hst_treatment === 'exempt' ? '—' : formatMoney(d.tax_amount)}</td>
      <td style={queueStyles.expenseTd}>{d.invoice_number || '—'}</td>
      <td style={queueStyles.expenseTd}>
        <span style={{ fontSize: 13, color: '#6b7280' }}>{d.source === 'bank_csv' ? 'From bank' : d.source === 'email' ? 'Email' : d.invoice_file_path ? 'Upload' : (d.source || 'Manual')}</span>
      </td>
      <td style={queueStyles.expenseTd}>
        {linkedDraftIds.has(d.id) && (
          <span style={{ fontSize: 11, color: '#059669', fontWeight: 500 }}>Linked to bank</span>
        )}
        {!linkedDraftIds.has(d.id) && '—'}
      </td>
      <td style={queueStyles.expenseTd}><FiCheck style={{ color: '#059669' }} /> Posted</td>
      <td style={{ ...queueStyles.expenseTd, whiteSpace: 'nowrap' }}>
        <button
          type="button"
          style={{ ...queueStyles.iconButton, color: TavariStyles?.colors?.gray600 || '#4b5563' }}
          onClick={() => handleUnapprove(d)}
          disabled={unapprovingDraftId === d.id}
          title="Cancel approval and send back to draft"
        >
          {unapprovingDraftId === d.id ? <FiLoader style={extractingSpinnerStyle} /> : <FiRotateCcw />} Un-approve
        </button>
        {(d.invoice_file_path || d.attachment_id) && (
          <button
            type="button"
            style={queueStyles.iconButton}
            onClick={() => handleOpenAttachedInvoice(d)}
            disabled={openingInvoiceDraftId === d.id}
            title="Open attached invoice"
          >
            {openingInvoiceDraftId === d.id ? <FiLoader style={extractingSpinnerStyle} /> : <FiExternalLink />}
          </button>
        )}
      </td>
    </tr>
    );
  };

  const renderPostedBatchRow = (batch) => (
    <li key={batch.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0', borderBottom: '1px solid #eee' }}>
      <span>{formatDate(batch.batch_date)}</span>
      <span>{formatMoney(batch.total_sales_amount)}</span>
      <span>{formatMoney(batch.total_tax_amount)} tax</span>
      {Number(batch.total_refunds_amount) > 0 && <span style={{ color: '#b45309' }}>{formatMoney(-batch.total_refunds_amount)} refunds</span>}
      <span><FiCheck style={{ color: '#059669' }} /> Posted</span>
      <button
        type="button"
        style={{ ...queueStyles.iconButton, color: TavariStyles?.colors?.gray600 || '#4b5563' }}
        onClick={() => handleUnapproveBatch(batch)}
        disabled={unapprovingBatchId === batch.id}
        title="Cancel this posted batch and send it back to draft"
      >
        {unapprovingBatchId === batch.id ? <FiLoader style={extractingSpinnerStyle} /> : <FiRotateCcw />} Un-approve
      </button>
    </li>
  );

  const renderPostedDepositRow = (deposit) => (
    <li key={deposit.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0', borderBottom: '1px solid #eee' }}>
      <span>{formatDate(deposit.deposit_date)}</span>
      <span>{formatMoney(deposit.total_amount)}</span>
      <span>{deposit.bank_account_erpnext || 'Bank'}</span>
      <span><FiCheck style={{ color: '#059669' }} /> Posted</span>
      <button
        type="button"
        style={{ ...queueStyles.iconButton, color: TavariStyles?.colors?.gray600 || '#4b5563' }}
        onClick={() => handleUnapproveDeposit(deposit)}
        disabled={unapprovingDepositId === deposit.id}
        title="Cancel this posted deposit and send it back to draft"
      >
        {unapprovingDepositId === deposit.id ? <FiLoader style={extractingSpinnerStyle} /> : <FiRotateCcw />} Un-approve
      </button>
    </li>
  );

  const depositsOnly = focus === 'deposits';
  const queueTitle = titleOverride || (depositsOnly ? 'Create Bank Deposit' : 'Approval Queue');

  return (
    <div style={{ padding: embedded ? 0 : 24, paddingTop: embedded ? 0 : 100, width: '100%', maxWidth: 'none', margin: 0, boxSizing: 'border-box' }}>
      <input
        ref={replacePdfInputRef}
        type="file"
        accept=".pdf,application/pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
        onChange={handleReplaceInvoicePdfFile}
        aria-hidden="true"
        tabIndex={-1}
      />
      <input
        ref={bulkInvoiceInputRef}
        type="file"
        accept=".pdf,application/pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        multiple
        style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
        onChange={(e) => {
          const files = e.target?.files;
          e.target.value = '';
          if (files?.length) handleBulkInvoiceFiles(files);
        }}
        aria-hidden="true"
        tabIndex={-1}
      />
      {!embedded && (
        <button type="button" style={{ marginBottom: 24, padding: '8px 16px', cursor: 'pointer' }} onClick={() => navigate('/dashboard/accounting')}>
          <FiArrowLeft /> Back to Accounting
        </button>
      )}
      {!embedded && <h1 style={{ fontSize: '1.5rem', marginBottom: 24 }}>{queueTitle}</h1>}
      {embedded && <h2 style={{ fontSize: '1.25rem', marginBottom: 16, marginTop: 0 }}>{queueTitle}</h2>}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => setQueueSubTab('pending')}
          style={{
            padding: '8px 16px',
            border: '1px solid ' + (TavariStyles?.colors?.gray300 || '#d1d5db'),
            borderRadius: 8,
            background: queueSubTab === 'pending' ? (TavariStyles?.colors?.primary || '#008080') : 'white',
            color: queueSubTab === 'pending' ? 'white' : '#374151',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 500
          }}
        >
          {depositsOnly ? 'Draft items' : `Pending (${drafts.length})`}
        </button>
        {!depositsOnly && (
          <button
            type="button"
            onClick={() => setQueueSubTab('on_hold')}
            style={{
              padding: '8px 16px',
              border: '1px solid ' + (TavariStyles?.colors?.gray300 || '#d1d5db'),
              borderRadius: 8,
              background: queueSubTab === 'on_hold' ? (TavariStyles?.colors?.primary || '#008080') : 'white',
              color: queueSubTab === 'on_hold' ? 'white' : '#374151',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500
            }}
          >
            On Hold ({onHoldDrafts.length})
          </button>
        )}
        <button
          type="button"
          onClick={() => setQueueSubTab('approved')}
          style={{
            padding: '8px 16px',
            border: '1px solid ' + (TavariStyles?.colors?.gray300 || '#d1d5db'),
            borderRadius: 8,
            background: queueSubTab === 'approved' ? (TavariStyles?.colors?.primary || '#008080') : 'white',
            color: queueSubTab === 'approved' ? 'white' : '#374151',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 500
          }}
        >
          {depositsOnly ? `Posted items (${postedBatches.length + postedDeposits.length})` : `Approved (${(typeof approvedTotalCount === 'number' ? approvedTotalCount : approvedDrafts.length) + postedBatches.length + postedDeposits.length})`}
        </button>
      </div>
      {loading ? (
        <p>Loading...</p>
      ) : queueSubTab === 'on_hold' && !depositsOnly ? (
        <section>
          <h2 style={{ fontSize: '1.125rem', marginBottom: 12 }}>On Hold</h2>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
            Parking lot for expenses waiting on CAD amounts, statements, or other info. Edit them here, then return to Pending or approve when ready.
          </p>
          {onHoldDrafts.length === 0 ? (
            <p style={{ color: '#6b7280' }}>Nothing on hold. Use <strong>On hold</strong> on a Pending expense to park it here.</p>
          ) : (
            <div style={{ width: '100%', overflowX: 'auto' }}>
              <table style={queueStyles.expenseTable}>
                <thead>
                  <tr>
                    {DRAFT_EXPENSE_COLUMN_HEADERS.map((label) => (
                      <th key={label} style={queueStyles.expenseTh}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {onHoldDrafts.map((d) => renderDraftRow(d))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : queueSubTab === 'approved' ? (
        <section>
          {!depositsOnly && (
            <>
              <h2 style={{ fontSize: '1.125rem', marginBottom: 12 }}>Approved expenses</h2>
              <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                Expenses posted to ERPNext. Use Un-approve to cancel and send back to draft (creates reversing entries in ERPNext).
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 12 }}>
                <input
                  type="search"
                  value={approvedSearch}
                  onChange={(e) => setApprovedSearch(e.target.value)}
                  placeholder="Search vendor, invoice #, category, amount…"
                  style={{
                    flex: '1 1 220px',
                    minWidth: 180,
                    maxWidth: 360,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid #d1d5db',
                    fontSize: 14,
                  }}
                />
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600, color: '#6b7280' }}>
                  From
                  <BusinessCalendarPicker
                    value={approvedDateFrom}
                    onChange={(next) => {
                      setApprovedDateFrom(next || '');
                      loadApprovedDrafts(approvedFetchLimitRef.current, { dateFrom: next || '', dateTo: approvedDateToRef.current });
                    }}
                    businessTimezone={accountingTimezone}
                    compact
                    placeholder="Start date"
                    ariaLabel="Approved expenses from date"
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600, color: '#6b7280' }}>
                  To
                  <BusinessCalendarPicker
                    value={approvedDateTo}
                    onChange={(next) => {
                      setApprovedDateTo(next || '');
                      loadApprovedDrafts(approvedFetchLimitRef.current, { dateFrom: approvedDateFromRef.current, dateTo: next || '' });
                    }}
                    businessTimezone={accountingTimezone}
                    compact
                    placeholder="End date"
                    ariaLabel="Approved expenses to date"
                  />
                </label>
                {(approvedDateFrom || approvedDateTo) && (
                  <button
                    type="button"
                    onClick={() => {
                      setApprovedDateFrom('');
                      setApprovedDateTo('');
                      loadApprovedDrafts(approvedFetchLimitRef.current, { dateFrom: '', dateTo: '' });
                    }}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid #d1d5db',
                      background: '#fff',
                      color: '#374151',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    Clear dates
                  </button>
                )}
                <span style={{ fontSize: 13, color: '#6b7280' }}>
                  {approvedListLoading ? 'Loading…' : (
                    <>
                      Showing <strong>{sortedApprovedDrafts.length}</strong>
                      {approvedHasActiveFilters ? <> match{sortedApprovedDrafts.length === 1 ? '' : 'es'}</> : null}
                      {' '}of <strong>{approvedDrafts.length}</strong> loaded
                      {typeof approvedTotalCount === 'number' ? <> (<strong>{approvedTotalCount}</strong> total{(approvedDateFrom || approvedDateTo) ? ' in range' : ''})</> : null}
                    </>
                  )}
                </span>
                {approvedHasMore ? (
                  <button
                    type="button"
                    onClick={() => loadApprovedDrafts(APPROVED_ALL_LIMIT)}
                    disabled={approvedListLoading}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: `1px solid ${TavariStyles?.colors?.primary || '#008080'}`,
                      background: '#fff',
                      color: TavariStyles?.colors?.primary || '#008080',
                      cursor: approvedListLoading ? 'wait' : 'pointer',
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {approvedListLoading ? 'Loading…' : `Show all (${approvedTotalCount})`}
                  </button>
                ) : approvedFetchLimit > APPROVED_DEFAULT_LIMIT ? (
                  <button
                    type="button"
                    onClick={() => loadApprovedDrafts(APPROVED_DEFAULT_LIMIT)}
                    disabled={approvedListLoading}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid #d1d5db',
                      background: '#fff',
                      color: '#374151',
                      cursor: approvedListLoading ? 'wait' : 'pointer',
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    Show latest 100
                  </button>
                ) : null}
              </div>
              {approvedSearch.trim() && approvedHasMore && (
                <p style={{ fontSize: 13, color: '#b45309', marginTop: 0, marginBottom: 12 }}>
                  Text search only covers the loaded rows. Date range is applied server-side; click Show all to search every row in that range.
                </p>
              )}
              {approvedDrafts.length === 0 ? (
                <p style={{ color: '#6b7280' }}>No approved expenses yet.</p>
              ) : sortedApprovedDrafts.length === 0 ? (
                <p style={{ color: '#6b7280' }}>No approved expenses match this search.</p>
              ) : (
                <div style={{ width: '100%', overflowX: 'auto' }}>
                  <table style={queueStyles.expenseTable}>
                    <thead>
                      <tr>
                        {APPROVED_SORT_COLUMNS.map((col) => (
                          <ApprovedSortableTh key={col.id} columnId={col.id} label={col.label} />
                        ))}
                        <th style={queueStyles.expenseTh}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedApprovedDrafts.map((d) => renderApprovedRow(d))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          <section style={{ marginTop: 32 }}>
            <h2 style={{ fontSize: '1.125rem', marginBottom: 12 }}>Posted sales batches</h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
              Sales batches posted to ERPNext. You can send them back to draft as long as they are not linked to a deposit.
            </p>
            {postedBatches.length === 0 ? (
              <p style={{ color: '#6b7280' }}>No posted sales batches yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {postedBatches.map((batch) => renderPostedBatchRow(batch))}
              </ul>
            )}
          </section>
          <section style={{ marginTop: 32 }}>
            <h2 style={{ fontSize: '1.125rem', marginBottom: 12 }}>Posted deposits</h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
              Deposits posted to ERPNext. Use Un-approve to cancel the bank entry and return the deposit to draft.
            </p>
            {postedDeposits.length === 0 ? (
              <p style={{ color: '#6b7280' }}>No posted deposits yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {postedDeposits.map((deposit) => renderPostedDepositRow(deposit))}
              </ul>
            )}
          </section>
        </section>
      ) : (
        <>
          <section style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
              <h2 style={{ fontSize: '1.125rem', margin: 0 }}>Sales batches (draft)</h2>
              <button
                type="button"
                style={{
                  ...queueStyles.primaryButton,
                  opacity: creatingBatches ? 0.7 : 1,
                  pointerEvents: creatingBatches ? 'none' : 'auto'
                }}
                onClick={handleCreateSalesBatches}
                disabled={creatingBatches}
                title="Create batches for the last 90 days from POS and booking sales (in business timezone)"
              >
                {creatingBatches ? (
                  <>
                    <FiLoader style={{ animation: 'spin 1s linear infinite', marginRight: 6 }} />
                    Creating…
                  </>
                ) : (
                  <>Create sales batches</>
                )}
              </button>
            </div>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
              Batches group sales by day. Run this to create or backfill batches from your POS and booking payments. Select batches and click Group into deposit to combine days into one deposit.
            </p>
            {selectedBatchIds.length > 0 && (
              <button
                type="button"
                style={{ marginBottom: 12, padding: '6px 12px', background: TavariStyles?.colors?.primary || '#008080', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
                onClick={handleGroupIntoDeposit}
                disabled={groupingDeposit}
                title="Create one deposit from selected batches"
              >
                {groupingDeposit ? <FiLoader style={{ animation: 'spin 1s linear infinite', marginRight: 6, verticalAlign: 'middle' }} /> : null}
                Group {selectedBatchIds.length} batch(es) into deposit
              </button>
            )}
            {batches.length === 0 ? <p style={{ color: '#6b7280' }}>No draft batches.</p> : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {batches.map((b) => (
                  <li key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0', borderBottom: '1px solid #eee' }}>
                    <input
                      type="checkbox"
                      checked={selectedBatchIds.includes(b.id)}
                      onChange={() => toggleBatchSelection(b.id)}
                      title="Select to group into one deposit"
                      disabled={!!b.deposit_id}
                    />
                    <span>{formatDate(b.batch_date)}</span>
                    <span>{formatMoney(b.total_sales_amount)}</span>
                    <span>{formatMoney(b.total_tax_amount)} tax</span>
                    {b.total_refunds_amount > 0 && <span style={{ color: '#b45309' }}>{formatMoney(-b.total_refunds_amount)} refunds</span>}
                    <span><FiClock /> Draft</span>
                    <button
                      type="button"
                      style={{ fontSize: 11, padding: '4px 8px', background: TavariStyles?.colors?.success || '#059669', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                      onClick={() => handleApproveBatch(b)}
                      disabled={approvingBatchId === b.id}
                      title="Post sales journal to ERPNext"
                    >
                      {approvingBatchId === b.id ? <FiLoader style={extractingSpinnerStyle} /> : <FiCheck />} Approve
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: '1.125rem', marginBottom: 12 }}>Deposits (draft)</h2>
            {deposits.length === 0 ? <p style={{ color: '#6b7280' }}>No draft deposits.</p> : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {deposits.map((d) => (
                  <li key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0', borderBottom: '1px solid #eee' }}>
                    <span>{formatDate(d.deposit_date)}</span>
                    <span>{formatMoney(d.total_amount)}</span>
                    <span>{d.bank_account_erpnext || 'Bank'}</span>
                    <span><FiClock /> Draft</span>
                    <button
                      type="button"
                      style={{ fontSize: 11, padding: '4px 8px', background: TavariStyles?.colors?.success || '#059669', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                      onClick={() => handleApproveDeposit(d)}
                      disabled={approvingDepositId === d.id}
                      title="Post deposit journal to ERPNext"
                    >
                      {approvingDepositId === d.id ? <FiLoader style={extractingSpinnerStyle} /> : <FiCheck />} Approve
                    </button>
                    <button
                      type="button"
                      style={{ ...queueStyles.iconButton, color: TavariStyles?.colors?.gray600 || '#4b5563' }}
                      onClick={() => handleDeleteDraftDeposit(d)}
                      disabled={deletingDepositId === d.id}
                      title="Delete draft deposit and unlink its batches"
                    >
                      {deletingDepositId === d.id ? <FiLoader style={extractingSpinnerStyle} /> : <FiTrash2 />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!depositsOnly && (
          <>
          <section style={{ marginBottom: 24 }}>
            <div
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setInvoiceDropActive(true); }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setInvoiceDropActive(true); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setInvoiceDropActive(false); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setInvoiceDropActive(false);
                if (e.dataTransfer?.files?.length) handleBulkInvoiceFiles(e.dataTransfer.files);
              }}
              style={{
                border: `2px dashed ${invoiceDropActive ? (TavariStyles?.colors?.primary || '#008080') : '#d1d5db'}`,
                background: invoiceDropActive ? '#f0fdfa' : '#f9fafb',
                borderRadius: 12,
                padding: '20px 16px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 6 }}>
                {uploadingInvoices ? 'Uploading invoices…' : 'Drop invoice PDFs or images here'}
              </div>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6b7280' }}>
                Amazon and other receipts — upload many at once. We create drafts and run extraction automatically.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                <button
                  type="button"
                  style={{
                    ...queueStyles.primaryButton,
                    opacity: uploadingInvoices || extractingAll ? 0.7 : 1,
                    pointerEvents: uploadingInvoices || extractingAll ? 'none' : 'auto',
                  }}
                  disabled={uploadingInvoices || extractingAll}
                  onClick={() => bulkInvoiceInputRef.current?.click()}
                >
                  {uploadingInvoices ? (
                    <>
                      <FiLoader style={{ animation: 'spin 1s linear infinite', marginRight: 6 }} />
                      Uploading…
                    </>
                  ) : (
                    <>
                      <FiUpload /> Upload invoices
                    </>
                  )}
                </button>
                {(drafts || []).some((d) => d.invoice_file_path || d.received_email_id) && (
                  <button
                    type="button"
                    style={{
                      ...queueStyles.primaryButton,
                      background: TavariStyles?.colors?.gray600 || '#4b5563',
                      opacity: extractingAll || uploadingInvoices ? 0.7 : 1,
                      pointerEvents: extractingAll || uploadingInvoices ? 'none' : 'auto',
                    }}
                    onClick={() => handleExtractAllInvoices()}
                    disabled={extractingAll || uploadingInvoices}
                    title="Extract vendor, amount, and date from invoice PDFs/images"
                  >
                    {extractingAll ? (
                      <>
                        <FiLoader style={{ animation: 'spin 1s linear infinite', marginRight: 6 }} />
                        Extracting…
                      </>
                    ) : (
                      'Extract Invoices'
                    )}
                  </button>
                )}
              </div>
            </div>
          </section>
          <section style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
              <h2 style={{ fontSize: '1.125rem', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <FiMail /> Emailed invoices
              </h2>
            </div>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
              Invoices sent to your accounting inbox (see Accounting → Settings) appear here as drafts.
            </p>
            {emailDrafts.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                <div style={{ padding: '10px 12px', borderRadius: 8, background: '#f3f4f6', border: '1px solid #d1d5db', minWidth: 150 }}>
                  <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.3 }}>Extracting</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#374151' }}>{emailDraftSummary.extracting}</div>
                </div>
                <div style={{ padding: '10px 12px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', minWidth: 150 }}>
                  <div style={{ fontSize: 11, color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.3 }}>Need review</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#b45309' }}>{emailDraftSummary.review}</div>
                </div>
                <div style={{ padding: '10px 12px', borderRadius: 8, background: '#ecfdf5', border: '1px solid #a7f3d0', minWidth: 150 }}>
                  <div style={{ fontSize: 11, color: '#065f46', textTransform: 'uppercase', letterSpacing: 0.3 }}>Ready</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#059669' }}>{emailDraftSummary.ready}</div>
                </div>
              </div>
            )}
            {emailDrafts.length === 0 ? (
              <p style={{ color: '#6b7280' }}>No emailed invoices yet. Forward invoices to your accounting inbox address; they will show here once processed.</p>
            ) : (
              <div style={{ width: '100%', overflowX: 'auto' }}>
                <table style={queueStyles.expenseTable}>
                  <thead>
                    <tr>
                      {DRAFT_EXPENSE_COLUMN_HEADERS.map((label) => (
                        <th key={label} style={queueStyles.expenseTh}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {emailDrafts.map((d) => renderDraftRow(d))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          </>
          )}

          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
              <h2 style={{ fontSize: '1.125rem', margin: 0 }}>Other expense drafts</h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  style={{ ...queueStyles.primaryButton, background: TavariStyles?.colors?.gray600 || '#4b5563' }}
                  onClick={() => setShowMatchToPayment(true)}
                >
                  <FiLink /> Match to payment
                </button>
                <button
                  type="button"
                  style={queueStyles.primaryButton}
                  onClick={() => setShowAddExpense(true)}
                >
                  <FiPlus /> Add expense
                </button>
              </div>
            </div>
            {otherDrafts.length === 0 ? <p style={{ color: '#6b7280' }}>No other draft expenses. Add one manually or create from Bank Import.</p> : (
              <div style={{ width: '100%', overflowX: 'auto' }}>
                <table style={queueStyles.expenseTable}>
                  <thead>
                    <tr>
                      {DRAFT_EXPENSE_COLUMN_HEADERS.map((label) => (
                        <th key={label} style={queueStyles.expenseTh}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {otherDrafts.map((d) => renderDraftRow(d))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

      {showAddExpense && (
        <AccountingDraftExpenseForm
          businessId={selectedBusinessId}
          title="Add expense"
          vendors={vendors}
          categories={categories}
          onVendorCreated={(vendor) => {
            setVendors((prev) => [...prev, vendor].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''))));
          }}
          onSubmit={handleAddExpense}
          onCancel={closeAddExpense}
          businessTimezone={accountingTimezone}
        />
      )}
      {editingDraft && (
        <AccountingDraftExpenseForm
          businessId={selectedBusinessId}
          title="Edit expense"
          vendors={vendors}
          categories={categories}
          onVendorCreated={(vendor) => {
            setVendors((prev) => [...prev, vendor].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''))));
          }}
          onReExtractFromEmail={editingDraft.source === 'email' && editingDraft.received_email_id ? handleReExtractFromEmail : undefined}
          reExtracting={reExtracting}
          onReExtractFromPdf={editingDraft.invoice_file_path ? handleReExtractFromPdf : undefined}
          reExtractingFromPdf={reExtractingFromPdf}
          onViewEmail={editingDraft.source === 'email' && editingDraft.received_email_id ? handleViewEmail : undefined}
          onDownloadEmailPdf={editingDraft.source === 'email' && editingDraft.received_email_id ? handleDownloadEmailPdf : undefined}
          downloadingEmailPdf={downloadingEmailPdf}
          initialValues={{
            vendor_id: editingDraft.vendor_id || '',
            vendor_name_display: editingDraft.vendor_name_display || '',
            transaction_date: editingDraft.transaction_date || '',
            invoice_date: editingDraft.invoice_date || '',
            total_amount: editingDraft.total_amount,
            subtotal: editingDraft.subtotal ?? '',
            tax_amount: editingDraft.tax_amount ?? '',
            invoice_number: editingDraft.invoice_number || '',
            expense_category_id: editingDraft.expense_category_id || '',
            gl_account_erpnext: editingDraft.gl_account_erpnext || '',
            credit_account_erpnext: editingDraft.credit_account_erpnext || '',
            hst_treatment: editingDraft.hst_treatment || 'recoverable',
            invoice_file_path: editingDraft.invoice_file_path || '',
            invoice_currency: editingDraft.invoice_currency || 'CAD',
            cad_settlement_total: editingDraft.cad_settlement_total ?? '',
            is_fixed_asset: !!editingDraft.is_fixed_asset,
            asset_name: editingDraft.asset_name || '',
            asset_useful_life_years: editingDraft.asset_useful_life_years ?? '5',
            asset_salvage_value: editingDraft.asset_salvage_value ?? '0',
            asset_gl_account_erpnext: editingDraft.asset_gl_account_erpnext || '',
            attachment_id: editingDraft.attachment_id || null,
            received_email_id: editingDraft.received_email_id || null,
            line_items: editingDraftLines
          }}
          onSubmit={handleUpdateDraft}
          onCancel={() => setEditingDraft(null)}
          businessTimezone={accountingTimezone}
        />
      )}
      {linkPrompt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001 }} onClick={() => !linkPromptLinking && handleLinkPromptSkip()}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 420, width: '100%', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1.125rem' }}>Link to bank transaction?</h3>
            <p style={{ margin: '0 0 20px 0', fontSize: 14, color: TavariStyles?.colors?.gray600 || '#4b5563' }}>
              We found a matching bank transaction: <strong>{formatDate(linkPrompt.bankTx.transaction_date)} {formatMoney(linkPrompt.bankTx.debit_credit === 'debit' ? -Math.abs(Number(linkPrompt.bankTx.amount)) : linkPrompt.bankTx.amount)}</strong>. Link this expense to it? The payment date will be set to the bank transaction date.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button type="button" style={{ padding: '8px 16px', background: TavariStyles?.colors?.gray100, border: `1px solid ${TavariStyles?.colors?.gray300}`, borderRadius: 8, cursor: 'pointer', fontSize: 14 }} onClick={handleLinkPromptSkip} disabled={linkPromptLinking}>Skip</button>
              <button type="button" style={{ padding: '8px 16px', background: TavariStyles?.colors?.primary || '#008080', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 }} onClick={handleLinkPromptConfirm} disabled={linkPromptLinking}>{linkPromptLinking ? 'Linking…' : 'Link'}</button>
            </div>
          </div>
        </div>
      )}
      {showMatchToPayment && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowMatchToPayment(false)}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 24, maxWidth: 700, width: '100%', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, marginBottom: 16 }}>Match invoices to payment</h3>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Select a date range, then choose invoices (drafts) whose total equals the pending payment amount exactly. Only pending payments are shown.</p>
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13 }}>From</span>
                <BusinessCalendarPicker
                  value={matchDateFrom}
                  onChange={setMatchDateFrom}
                  businessTimezone={accountingTimezone}
                  compact
                  ariaLabel="Match from date"
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13 }}>To</span>
                <BusinessCalendarPicker
                  value={matchDateTo}
                  onChange={setMatchDateTo}
                  businessTimezone={accountingTimezone}
                  compact
                  ariaLabel="Match to date"
                />
              </label>
            </div>
            {matchLoading ? (
              <p>Loading...</p>
            ) : (
              (() => {
                const selDrafts = matchDrafts.filter((d) => matchSelectedDraftIds.has(d.id));
                const sumSel = selDrafts.reduce((acc, d) => {
                  const amt = getDraftBankMatchAmount(d);
                  return acc + (amt != null ? -amt : Number(d.total_amount ?? 0));
                }, 0);
                const selTx = matchBankTx.find((t) => t.id === matchSelectedBankTxId);
                const txAmount = selTx?.debit_credit === 'debit' ? -Math.abs(Number(selTx?.amount ?? 0)) : Math.abs(Number(selTx?.amount ?? 0));
                const amountsMatch = selTx && selDrafts.length > 0 && Math.abs(round2(sumSel) - round2(txAmount)) <= 0.01;
                return (
                  <>
                    <p style={{ fontSize: 13, marginBottom: 12, color: amountsMatch ? '#059669' : '#6b7280' }}>
                      {matchSelectedDraftIds.size > 0 && matchSelectedBankTxId
                        ? `Selected total: ${formatMoney(sumSel)} | Payment: ${formatMoney(txAmount)} ${amountsMatch ? '✓ Match' : '— must match exactly'}`
                        : 'Select one or more invoices and one payment. Totals must match exactly.'}
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 16 }}>
                  <div>
                    <h4 style={{ marginBottom: 8, fontSize: 14 }}>Invoices (drafts) in range</h4>
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, maxHeight: 220, overflow: 'auto' }}>
                      {matchDrafts.length === 0 ? (
                        <p style={{ padding: 12, margin: 0, fontSize: 13, color: '#6b7280' }}>No drafts in this range</p>
                      ) : (
                        matchDrafts.map((d) => (
                          <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={matchSelectedDraftIds.has(d.id)}
                              onChange={(e) => setMatchSelectedDraftIds((prev) => { const n = new Set(prev); if (e.target.checked) n.add(d.id); else n.delete(d.id); return n; })}
                            />
                            <span style={{ fontSize: 13 }}>{formatDate(d.transaction_date)}</span>
                            <span style={{ fontSize: 13 }}>{d.vendor_name_display || '—'}</span>
                            <span style={{ fontSize: 13, fontWeight: 500 }}>{formatMoney(getEffectiveExpenseAmounts(d).total)}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <h4 style={{ marginBottom: 8, fontSize: 14 }}>Pending payments (bank transactions) in range</h4>
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, maxHeight: 220, overflow: 'auto' }}>
                      {matchBankTx.length === 0 ? (
                        <p style={{ padding: 12, margin: 0, fontSize: 13, color: '#6b7280' }}>No pending payments in this range</p>
                      ) : (
                        matchBankTx.map((tx) => (
                          <label key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name="matchBankTx"
                              checked={matchSelectedBankTxId === tx.id}
                              onChange={() => setMatchSelectedBankTxId(tx.id)}
                            />
                            <span style={{ fontSize: 13 }}>{formatDate(tx.transaction_date)}</span>
                            <span style={{ fontSize: 13 }}>{tx.payee || '—'}</span>
                            <span style={{ fontSize: 13, fontWeight: 500 }}>{formatMoney(tx.debit_credit === 'debit' ? -Math.abs(tx.amount) : tx.amount)}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" style={{ padding: '8px 16px' }} onClick={() => setShowMatchToPayment(false)}>Cancel</button>
                  <button
                    type="button"
                    style={queueStyles.primaryButton}
                    onClick={handleMatchToPaymentSubmit}
                    disabled={matchLinking || matchSelectedDraftIds.size === 0 || !matchSelectedBankTxId || !amountsMatch}
                  >
                    {matchLinking ? 'Linking...' : `Link ${matchSelectedDraftIds.size} invoice(s) to payment`}
                  </button>
                </div>
                  </>
                );
              })()
            )}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};

const queueStyles = {
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
  iconButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 6px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: TavariStyles?.colors?.gray600,
    fontSize: 13,
    whiteSpace: 'nowrap',
    lineHeight: 1.2
  },
  actionsStack: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
    minWidth: 0
  },
  actionsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 2
  },
  expenseTable: {
    width: '100%',
    minWidth: 1100,
    borderCollapse: 'collapse',
    fontSize: 13
  },
  inlineSelect: {
    width: '100%',
    minWidth: 110,
    maxWidth: 200,
    padding: '5px 6px',
    fontSize: 13,
    border: '1px solid #d1d5db',
    borderRadius: 6,
    background: '#fff',
    boxSizing: 'border-box'
  },
  inlineInput: {
    width: '100%',
    minWidth: 80,
    maxWidth: 160,
    padding: '5px 6px',
    fontSize: 13,
    border: '1px solid #d1d5db',
    borderRadius: 6,
    boxSizing: 'border-box'
  },
  expenseTh: {
    textAlign: 'left',
    padding: '10px 12px',
    fontWeight: 600,
    color: TavariStyles?.colors?.gray700 || '#374151',
    borderBottom: `2px solid ${TavariStyles?.colors?.gray200 || '#e5e7eb'}`
  },
  expenseTd: {
    padding: '10px 12px',
    borderTop: `1px solid ${TavariStyles?.colors?.gray200 || '#e5e7eb'}`
  }
};

export default AccountingQueue;
