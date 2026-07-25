import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { FiX, FiTrash2, FiExternalLink, FiDownload, FiPlus, FiLoader } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { extractTextFromPdfFile, renderPdfFirstPageToImage } from '../../utils/invoicePdfText';
import { finalizeExpenseAmounts, isCreditMemoExpense, isExemptHstTreatment, reconcileDraftExpenseAmounts, resolveDraftDocumentType } from '../../utils/expenseAmounts';
import BusinessCalendarPicker from '../../components/UI/BusinessCalendarPicker';
import { matchVendorByName } from '../../utils/accountingVendorMatch';
import { matchVendorRule, ruleToDraftDefaults } from '../../utils/accountingVendorRules';
import { isForeignCurrencyDraft } from '../../utils/accountingDraftAmounts';
import { openExpenseInvoiceAttachment } from '../../utils/openExpenseInvoiceAttachment';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { useErpNextAccounts } from '../../hooks/useErpNextAccounts';
import { logicalAccountFromErpNextName } from '../../utils/erpnextGlAccount';
import { CAPITAL_ASSET_GL_OPTIONS, DEFAULT_CAPITAL_ASSET_GL } from './accountingDefaults';

const EXPENSE_INVOICES_BUCKET = 'expense-invoices';

const NON_CAPITAL_ASSET_GL = /accumulated depreciation|^\s*cash\s*$|^\s*debtors\s*$|stock in hand|temporary opening|earnest money|employee advances|cwip/i;

function pickDefaultAssetGl(currentValue, expenseCategoryGl, assetGlOptions) {
  const options = assetGlOptions.length ? assetGlOptions : CAPITAL_ASSET_GL_OPTIONS;
  const current = (currentValue || '').trim();
  const categoryGl = (expenseCategoryGl || '').trim();
  if (current && current !== categoryGl && options.includes(current)) {
    return current;
  }
  if (options.includes(DEFAULT_CAPITAL_ASSET_GL)) {
    return DEFAULT_CAPITAL_ASSET_GL;
  }
  return options[0] || DEFAULT_CAPITAL_ASSET_GL;
}

const round2 = (n) => (n != null && !Number.isNaN(n) ? Math.round(Number(n) * 100) / 100 : n);

export function buildDefaultAssetName(vendorName, invoiceNumber) {
  const parts = [(vendorName || '').trim(), (invoiceNumber || '').trim()].filter(Boolean);
  return parts.join(' · ') || 'Fixed asset';
}

const HST_OPTIONS = [
  { value: 'recoverable', label: 'Recoverable' },
  { value: 'collected', label: 'Collected' },
  { value: 'included', label: 'Included' },
  { value: 'exempt', label: 'Exempt' }
];

export function getDefaultHst(vendor, category) {
  if (vendor?.default_hst_treatment) return vendor.default_hst_treatment;
  if (category?.default_hst_treatment) return category.default_hst_treatment;
  return 'recoverable';
}

export default function AccountingDraftExpenseForm({
  businessId,
  initialValues = {},
  title = 'Expense',
  onSubmit,
  onCancel,
  vendors = [],
  categories = [],
  onReExtractFromEmail = null,
  reExtracting = false,
  onReExtractFromPdf = null,
  reExtractingFromPdf = false,
  onViewEmail = null,
  onDownloadEmailPdf = null,
  downloadingEmailPdf = false,
  onVendorCreated = null,
  businessTimezone = 'America/Toronto',
}) {
  const [form, setForm] = useState({
    vendor_id: initialValues.vendor_id || '',
    vendor_name_display: initialValues.vendor_name_display || '',
    transaction_date: initialValues.transaction_date || initialValues.invoice_date || '',
    invoice_date: initialValues.invoice_date || '',
    total_amount: initialValues.total_amount != null ? Number(initialValues.total_amount) : '',
    subtotal: initialValues.subtotal != null ? Number(initialValues.subtotal) : '',
    tax_amount: initialValues.tax_amount != null ? Number(initialValues.tax_amount) : '',
    invoice_number: initialValues.invoice_number || '',
    expense_category_id: initialValues.expense_category_id || '',
    hst_treatment: initialValues.hst_treatment || 'recoverable',
    invoice_file_path: initialValues.invoice_file_path || '',
    attachment_id: initialValues.attachment_id || null,
    invoice_currency: (initialValues.invoice_currency || 'CAD').toUpperCase(),
    cad_settlement_total: initialValues.cad_settlement_total != null ? Math.abs(Number(initialValues.cad_settlement_total)) : '',
    credit_account_erpnext: initialValues.credit_account_erpnext || '',
    is_fixed_asset: !!initialValues.is_fixed_asset,
    asset_name: initialValues.asset_name || '',
    asset_useful_life_years: initialValues.asset_useful_life_years != null ? String(initialValues.asset_useful_life_years) : '5',
    asset_salvage_value: initialValues.asset_salvage_value != null ? String(initialValues.asset_salvage_value) : '0',
    asset_gl_account_erpnext: initialValues.asset_gl_account_erpnext || ''
  });
  const [invoiceUploading, setInvoiceUploading] = useState(false);
  const [invoiceExtracting, setInvoiceExtracting] = useState(false);
  const [invoiceUploadError, setInvoiceUploadError] = useState(null);
  const [showAddVendor, setShowAddVendor] = useState(false);
  const [addingVendor, setAddingVendor] = useState(false);
  const [createdVendors, setCreatedVendors] = useState([]);
  const [newVendorForm, setNewVendorForm] = useState({
    name: '',
    default_expense_category_id: '',
    default_hst_treatment: 'recoverable'
  });
  const [vendorRules, setVendorRules] = useState([]);
  const [payableAccountLabel, setPayableAccountLabel] = useState('Accounts Payable (unpaid)');
  const [useSplitLines, setUseSplitLines] = useState((initialValues.line_items || []).length >= 2);
  const [splitLines, setSplitLines] = useState(() => (initialValues.line_items || []).length >= 2
    ? initialValues.line_items.map((line) => ({
      description: line.description || '',
      amount: line.amount ?? '',
      tax_amount: line.tax_amount ?? '',
      expense_category_id: line.expense_category_id || '',
      gl_account_erpnext: line.gl_account_erpnext || ''
    }))
    : [{ description: '', amount: '', tax_amount: '', expense_category_id: '', gl_account_erpnext: '' }]);

  const { accountOptions } = useErpNextAccounts(businessId);
  const assetGlOptions = useMemo(() => {
    const fromErp = accountOptions
      .filter((account) => account.root_type === 'Asset' && !NON_CAPITAL_ASSET_GL.test(account.name || ''))
      .map((account) => logicalAccountFromErpNextName(account.name))
      .filter(Boolean);
    return [...new Set([...fromErp, ...CAPITAL_ASSET_GL_OPTIONS, form.asset_gl_account_erpnext].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [accountOptions, form.asset_gl_account_erpnext]);

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
    const filtered = accountOptions.filter(looksLikeFunding);
    const list = (filtered.length > 0 ? filtered : accountOptions.filter((a) => {
      const root = String(a?.root_type || '').toLowerCase();
      return root === 'asset' || root === 'liability';
    })).map((account) => ({
      value: logicalAccountFromErpNextName(account.name),
      label: account.name,
    }));
    const current = (form.credit_account_erpnext || '').trim();
    if (current && !list.some((o) => o.value === current)) {
      list.push({ value: current, label: current });
    }
    return list.sort((a, b) => a.label.localeCompare(b.label));
  }, [accountOptions, form.credit_account_erpnext]);

  const availableVendors = useMemo(() => {
    const merged = [...vendors, ...createdVendors];
    const seen = new Set();
    return merged
      .filter((vendor) => {
        if (!vendor?.id || seen.has(vendor.id)) return false;
        seen.add(vendor.id);
        return true;
      })
      .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
  }, [vendors, createdVendors]);

  useEffect(() => {
    setForm({
      vendor_id: initialValues.vendor_id || '',
      vendor_name_display: initialValues.vendor_name_display || '',
      transaction_date: initialValues.transaction_date || initialValues.invoice_date || '',
      invoice_date: initialValues.invoice_date || '',
      total_amount: initialValues.total_amount != null ? Number(initialValues.total_amount) : '',
      subtotal: initialValues.subtotal != null ? Number(initialValues.subtotal) : '',
      tax_amount: initialValues.tax_amount != null ? Number(initialValues.tax_amount) : '',
      invoice_number: initialValues.invoice_number || '',
      expense_category_id: initialValues.expense_category_id || '',
      hst_treatment: initialValues.hst_treatment || 'recoverable',
      invoice_file_path: initialValues.invoice_file_path || '',
      attachment_id: initialValues.attachment_id || null,
      invoice_currency: (initialValues.invoice_currency || 'CAD').toUpperCase(),
      cad_settlement_total: initialValues.cad_settlement_total != null ? Math.abs(Number(initialValues.cad_settlement_total)) : '',
      credit_account_erpnext: initialValues.credit_account_erpnext || '',
      is_fixed_asset: !!initialValues.is_fixed_asset,
      asset_name: initialValues.asset_name || '',
      asset_useful_life_years: initialValues.asset_useful_life_years != null ? String(initialValues.asset_useful_life_years) : '5',
      asset_salvage_value: initialValues.asset_salvage_value != null ? String(initialValues.asset_salvage_value) : '0',
      asset_gl_account_erpnext: initialValues.asset_gl_account_erpnext || ''
    });
  }, [
    initialValues.vendor_id,
    initialValues.vendor_name_display,
    initialValues.transaction_date,
    initialValues.invoice_date,
    initialValues.total_amount,
    initialValues.subtotal,
    initialValues.tax_amount,
    initialValues.invoice_number,
    initialValues.expense_category_id,
    initialValues.hst_treatment,
    initialValues.invoice_file_path,
    initialValues.attachment_id,
    initialValues.invoice_currency,
    initialValues.cad_settlement_total,
    initialValues.credit_account_erpnext,
    initialValues.is_fixed_asset,
    initialValues.asset_name,
    initialValues.asset_useful_life_years,
    initialValues.asset_salvage_value,
    initialValues.asset_gl_account_erpnext
  ]);

  useEffect(() => {
    if (!businessId) return;
    supabase
      .from('accounting_business_config')
      .select('accounts_payable_account_erpnext')
      .eq('business_id', businessId)
      .maybeSingle()
      .then(({ data }) => {
        const ap = (data?.accounts_payable_account_erpnext || '').trim();
        setPayableAccountLabel(ap ? `${ap} (unpaid)` : 'Accounts Payable (unpaid)');
      });
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    supabase
      .from('accounting_vendor_rules')
      .select('*')
      .eq('business_id', businessId)
      .order('priority', { ascending: false })
      .then(({ data }) => setVendorRules(data || []));
  }, [businessId]);

  useEffect(() => {
    const items = initialValues.line_items || [];
    setUseSplitLines(items.length >= 2);
    if (items.length >= 2) {
      setSplitLines(items.map((line) => ({
        description: line.description || '',
        amount: line.amount ?? '',
        tax_amount: line.tax_amount ?? '',
        expense_category_id: line.expense_category_id || '',
        gl_account_erpnext: line.gl_account_erpnext || ''
      })));
    }
  }, [initialValues.line_items]);

  // When draft has vendor_name_display but no vendor_id (e.g. from email ingest), match to a vendor so dropdown and GL are set
  useEffect(() => {
    const displayName = (initialValues.vendor_name_display || '').trim();
    if (!displayName || initialValues.vendor_id || !availableVendors?.length) return;
    const matched = matchVendorByName(displayName, availableVendors);
    if (matched) {
      setForm((f) => ({
        ...f,
        vendor_id: matched.id,
        ...(matched.default_expense_category_id && !f.expense_category_id && { expense_category_id: matched.default_expense_category_id }),
        ...(!initialValues.hst_treatment && matched.default_hst_treatment && { hst_treatment: matched.default_hst_treatment })
      }));
    }
  }, [initialValues.vendor_id, initialValues.vendor_name_display, initialValues.hst_treatment, initialValues.expense_category_id, availableVendors]);

  const selectedVendor = availableVendors.find((v) => v.id === form.vendor_id);
  const selectedCategory = categories.find((c) => c.id === form.expense_category_id);

  useEffect(() => {
    if (!form.is_fixed_asset || assetGlOptions.length === 0) return;
    const nextGl = pickDefaultAssetGl(form.asset_gl_account_erpnext, selectedCategory?.gl_account_erpnext, assetGlOptions);
    if (nextGl && nextGl !== form.asset_gl_account_erpnext) {
      setForm((f) => ({ ...f, asset_gl_account_erpnext: nextGl }));
    }
  }, [form.is_fixed_asset, form.asset_gl_account_erpnext, selectedCategory?.gl_account_erpnext, assetGlOptions]);

  const totalNum = form.total_amount !== '' ? Number(form.total_amount) : null;
  const hasValidTotal = totalNum != null && !Number.isNaN(totalNum);
  const isExemptHst = isExemptHstTreatment(form.hst_treatment);

  const onTotalChange = (value) => {
    if (value === '') {
      setForm((f) => ({ ...f, total_amount: '', subtotal: '', ...(isExemptHst ? {} : { tax_amount: '' }) }));
      return;
    }
    const num = Number(value);
    if (Number.isNaN(num)) return;
    const total = round2(-Math.abs(num));
    setForm((f) => {
      const next = { ...f, total_amount: total };
      if (isExemptHst) {
        next.subtotal = total;
        next.tax_amount = '';
      } else if (f.tax_amount !== '' && !Number.isNaN(Number(f.tax_amount))) {
        next.subtotal = round2(total - Number(f.tax_amount));
      }
      return next;
    });
  };

  const onSubtotalChange = (value) => {
    if (value === '') {
      setForm((f) => ({ ...f, subtotal: '', ...(hasValidTotal && !isExemptHst ? { tax_amount: '' } : {}) }));
      return;
    }
    const num = Number(value);
    if (Number.isNaN(num)) return;
    const sub = hasValidTotal && totalNum < 0 ? round2(-Math.abs(num)) : round2(num);
    setForm((f) => ({
      ...f,
      subtotal: sub,
      ...(hasValidTotal && !isExemptHst ? { tax_amount: round2(totalNum - sub) } : {})
    }));
  };

  const onTaxAmountChange = (value) => {
    if (isExemptHst) return;
    if (value === '') {
      setForm((f) => ({ ...f, tax_amount: '', ...(hasValidTotal ? { subtotal: '' } : {}) }));
      return;
    }
    const num = Number(value);
    if (Number.isNaN(num)) return;
    const tax = hasValidTotal && totalNum < 0 ? round2(-Math.abs(num)) : round2(num);
    setForm((f) => ({
      ...f,
      tax_amount: tax,
      ...(hasValidTotal ? { subtotal: round2(totalNum - tax) } : {})
    }));
  };

  // Avoid toFixed(2) during typing so cursor doesn't jump to end. Show raw value.
  const displaySubtotal = form.subtotal === '' ? '' : String(Math.abs(Number(form.subtotal)));
  const displayTax = isExemptHst || form.tax_amount === '' ? '' : String(Math.abs(Number(form.tax_amount)));

  const applyHstTreatmentChange = (nextTreatment) => {
    setForm((f) => {
      const next = { ...f, hst_treatment: nextTreatment };
      if (isExemptHstTreatment(nextTreatment)) {
        next.tax_amount = '';
        const total = f.total_amount !== '' && !Number.isNaN(Number(f.total_amount)) ? Number(f.total_amount) : null;
        if (total != null) next.subtotal = total;
      }
      return next;
    });
  };

  const invoiceFileName = form.invoice_file_path ? form.invoice_file_path.split('/').pop() : null;

  const runExtraction = async (file, path) => {
    if (!businessId || !file) return;
    setInvoiceExtracting(true);
    setInvoiceUploadError(null);
    const categoriesForApi = categories.map((c) => ({ id: c.id, name: c.name }));
    let invoiceText = '';
    let imageBase64 = null;
    let mimeType = '';
    const isPdf = file.type === 'application/pdf';
    const isImage = /^image\/(jpeg|jpg|png|webp)$/i.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name || '');
    try {
      if (isPdf) {
        invoiceText = await extractTextFromPdfFile(file);
        if (!invoiceText?.trim()) {
          const arrayBuffer = await file.arrayBuffer();
          const dataUrl = await renderPdfFirstPageToImage(arrayBuffer);
          if (dataUrl?.startsWith('data:image')) {
            imageBase64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
            mimeType = 'image/png';
          } else {
            toast.error('Could not read text from PDF');
            setInvoiceExtracting(false);
            return;
          }
        }
      } else if (isImage) {
        imageBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result;
            const base64 = dataUrl?.includes(',') ? dataUrl.split(',')[1] : '';
            resolve(base64 || null);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        mimeType = file.type || 'image/jpeg';
      } else {
        setInvoiceExtracting(false);
        return;
      }
      const { data, error: fnError } = await supabase.functions.invoke('accounting-extract-invoice', {
        body: {
          business_id: businessId,
          ...(invoiceText ? { invoice_text: invoiceText } : {}),
          ...(imageBase64 ? { image_base64: imageBase64, mime_type: mimeType } : {}),
          categories: categoriesForApi
        }
      });
      if (fnError || data?.error) {
        toast.error(data?.error || fnError?.message || 'Extraction failed');
        setInvoiceUploadError(data?.error || fnError?.message);
        setInvoiceExtracting(false);
        return;
      }
      const finalized = finalizeExpenseAmounts({
        subtotal: data?.subtotal != null ? Number(data.subtotal) : null,
        tax_amount: data?.tax_amount != null ? Number(data.tax_amount) : null,
        total_amount: data?.total_amount != null ? Number(data.total_amount) : null,
      });
      const total = finalized.total_amount != null ? round2(Number(finalized.total_amount)) : null;
      const isExpense = total != null && total < 0;
      const subtotalVal = finalized.subtotal != null ? round2(Number(finalized.subtotal)) : null;
      const taxVal = finalized.tax_amount != null ? round2(Number(finalized.tax_amount)) : null;
      const extractedVendorName = data?.vendor_name != null && data.vendor_name !== '' ? String(data.vendor_name).trim() : '';
      const matchedVendor = extractedVendorName && availableVendors.length ? matchVendorByName(extractedVendorName, availableVendors) : null;
      const matchedRule = extractedVendorName ? matchVendorRule(extractedVendorName, vendorRules) : null;
      const ruleDefaults = ruleToDraftDefaults(matchedRule, availableVendors, categories);
      const vendorUpdates = extractedVendorName
        ? (matchedVendor
            ? { vendor_id: matchedVendor.id, vendor_name_display: extractedVendorName }
            : { vendor_name_display: extractedVendorName })
        : {};
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
      const suggestedCategoryId = normalizeCategoryId(data?.suggested_category_id);
      const categoryUpdate = matchedVendor?.default_expense_category_id
        ? { expense_category_id: matchedVendor.default_expense_category_id }
        : (ruleDefaults.expense_category_id
          ? { expense_category_id: ruleDefaults.expense_category_id }
          : (suggestedCategoryId ? { expense_category_id: suggestedCategoryId } : {}));
      const hstUpdate = matchedVendor?.default_hst_treatment && !initialValues.hst_treatment
        ? { hst_treatment: matchedVendor.default_hst_treatment }
        : (ruleDefaults.hst_treatment && !initialValues.hst_treatment ? { hst_treatment: ruleDefaults.hst_treatment } : {});
      let invoiceDateVal = null;
      const raw = data?.invoice_date;
      if (raw != null && raw !== '') {
        const s = typeof raw === 'number' ? String(raw) : String(raw).trim();
        if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) invoiceDateVal = s;
        else if (s) {
          const d = new Date(typeof raw === 'number' ? raw : s);
          if (!Number.isNaN(d.getTime())) {
            invoiceDateVal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          }
        }
      }
      setForm((f) => ({
        ...f,
        ...vendorUpdates,
        ...(invoiceDateVal ? { invoice_date: invoiceDateVal, transaction_date: invoiceDateVal } : {}),
        ...(total != null ? { total_amount: total } : {}),
        ...(subtotalVal != null ? { subtotal: isExpense ? -Math.abs(subtotalVal) : subtotalVal } : {}),
        ...(taxVal != null ? { tax_amount: isExpense ? -Math.abs(taxVal) : taxVal } : {}),
        ...(data?.invoice_number != null && data.invoice_number !== '' ? { invoice_number: String(data.invoice_number).trim() } : {}),
        ...(data?.invoice_currency ? { invoice_currency: String(data.invoice_currency).toUpperCase() } : {}),
        ...categoryUpdate,
        ...hstUpdate
      }));
      if (Array.isArray(data?.line_items) && data.line_items.length >= 2) {
        setUseSplitLines(true);
        setSplitLines(data.line_items.map((line) => ({
          description: line.description || '',
          amount: line.amount ?? '',
          tax_amount: line.tax_amount ?? '',
          expense_category_id: line.suggested_category_id || line.expense_category_id || '',
          gl_account_erpnext: ''
        })));
      }
      toast.success('Invoice data extracted');
    } catch (err) {
      toast.error(err?.message || 'Extraction failed');
      setInvoiceUploadError(err?.message || 'Extraction failed');
    }
    setInvoiceExtracting(false);
  };

  const onInvoiceFileChange = async (e) => {
    const file = e.target?.files?.[0];
    if (!file || !businessId) return;
    setInvoiceUploadError(null);
    setInvoiceUploading(true);
    const path = `${businessId}/${crypto.randomUUID()}/${file.name}`;
    const { error } = await supabase.storage.from(EXPENSE_INVOICES_BUCKET).upload(path, file, { upsert: false });
    setInvoiceUploading(false);
    if (error) {
      setInvoiceUploadError(error.message || 'Upload failed');
      return;
    }
    setForm((f) => ({ ...f, invoice_file_path: path, attachment_id: null }));
    e.target.value = '';
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    const isImage = /^image\/(jpeg|jpg|png|webp)$/i.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name || '');
    if (isPdf || isImage) runExtraction(file, path);
  };

  const removeInvoiceFile = () => {
    setForm((f) => ({ ...f, invoice_file_path: '', attachment_id: null }));
    setInvoiceUploadError(null);
  };

  const onVendorChange = (vendorId) => {
    if (vendorId === '__other__') {
      setForm((f) => ({ ...f, vendor_id: '' }));
      return;
    }
    const vendor = availableVendors.find((v) => v.id === vendorId);
    setForm((f) => ({
      ...f,
      vendor_id: vendorId,
      vendor_name_display: vendor?.name || f.vendor_name_display,
      ...(vendor?.default_expense_category_id && { expense_category_id: vendor.default_expense_category_id }),
      ...(!initialValues.hst_treatment && vendor?.default_hst_treatment && { hst_treatment: vendor.default_hst_treatment })
    }));
  };

  const openAddVendor = () => {
    setNewVendorForm({
      name: (form.vendor_name_display || '').trim(),
      default_expense_category_id: form.expense_category_id || '',
      default_hst_treatment: form.hst_treatment || 'recoverable'
    });
    setShowAddVendor(true);
  };

  const handleCreateVendor = async () => {
    if (!businessId) return;
    const name = (newVendorForm.name || '').trim();
    if (!name) {
      toast.error('Enter the vendor name first.');
      return;
    }

    const existing = availableVendors.find((vendor) => String(vendor?.name || '').trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      setForm((f) => ({
        ...f,
        vendor_id: existing.id,
        vendor_name_display: existing.name || name,
        ...(existing.default_expense_category_id && !f.expense_category_id ? { expense_category_id: existing.default_expense_category_id } : {}),
        ...(!initialValues.hst_treatment && existing.default_hst_treatment ? { hst_treatment: existing.default_hst_treatment } : {})
      }));
      setShowAddVendor(false);
      toast.success('Selected existing vendor.');
      return;
    }

    setAddingVendor(true);
    try {
      const payload = {
        business_id: businessId,
        name,
        default_expense_category_id: newVendorForm.default_expense_category_id || null,
        default_gl_account_erpnext: null,
        default_hst_treatment: newVendorForm.default_hst_treatment || 'recoverable',
        default_hst_rate: (newVendorForm.default_hst_treatment || 'recoverable') === 'exempt' ? null : 0.13
      };
      const { data: createdVendor, error } = await supabase
        .from('accounting_vendors')
        .insert(payload)
        .select('*')
        .single();
      if (error) throw error;

      if (createdVendor) {
        setCreatedVendors((prev) => [...prev, createdVendor]);
        if (typeof onVendorCreated === 'function') onVendorCreated(createdVendor);
        setForm((f) => ({
          ...f,
          vendor_id: createdVendor.id,
          vendor_name_display: createdVendor.name || name,
          ...(createdVendor.default_expense_category_id && !f.expense_category_id ? { expense_category_id: createdVendor.default_expense_category_id } : {}),
          ...(!initialValues.hst_treatment && createdVendor.default_hst_treatment ? { hst_treatment: createdVendor.default_hst_treatment } : {})
        }));
      }

      const { data: syncData, error: syncErr } = await supabase.functions.invoke('accounting-sync-supplier', {
        body: { business_id: businessId, vendor_name: name }
      });
      if (syncErr || syncData?.error) {
        toast.error(syncData?.error || syncErr?.message || 'Vendor saved but could not sync to ERPNext');
      } else {
        toast.success('Vendor added');
      }
      setShowAddVendor(false);
    } catch (err) {
      toast.error(err?.message || 'Failed to add vendor');
    } finally {
      setAddingVendor(false);
    }
  };

  // When modal opens with a vendor already set (e.g. editing), sync category from vendor if not already set
  useEffect(() => {
    if (!form.vendor_id || form.expense_category_id || availableVendors.length === 0) return;
    const vendor = availableVendors.find((v) => v.id === form.vendor_id);
    if (vendor?.default_expense_category_id) {
      setForm((f) => ({
        ...f,
        expense_category_id: vendor.default_expense_category_id,
        ...(!initialValues.hst_treatment && vendor.default_hst_treatment && { hst_treatment: vendor.default_hst_treatment })
      }));
    }
  }, [form.vendor_id, form.expense_category_id, initialValues.hst_treatment, availableVendors]);

  // When category is selected, auto-fill HST from category if no vendor
  useEffect(() => {
    if (form.expense_category_id && selectedCategory && !form.vendor_id && !initialValues.hst_treatment && selectedCategory.default_hst_treatment) {
      applyHstTreatmentChange(selectedCategory.default_hst_treatment);
    }
  }, [form.expense_category_id, form.vendor_id, selectedCategory?.default_hst_treatment]);

  const foreignInvoice = isForeignCurrencyDraft(form);
  const invoiceCurrencyLabel = (form.invoice_currency || 'CAD').toUpperCase();

  const handleSubmit = (e) => {
    e.preventDefault();
    const total = form.total_amount !== '' ? Number(form.total_amount) : null;
    if (total == null || Number.isNaN(total)) {
      return;
    }
    const amounts = reconcileDraftExpenseAmounts({
      subtotal: form.subtotal !== '' ? Number(form.subtotal) : null,
      tax_amount: isExemptHst ? 0 : (form.tax_amount !== '' ? Number(form.tax_amount) : null),
      total_amount: total,
      hst_treatment: form.hst_treatment,
    });
    const payload = {
      vendor_id: form.vendor_id || null,
      vendor_name_display: (form.vendor_name_display || '').trim() || (selectedVendor?.name || null),
      transaction_date: form.transaction_date || null,
      invoice_date: (form.invoice_date || '').trim() || null,
      total_amount: amounts.total_amount,
      subtotal: amounts.subtotal,
      tax_amount: amounts.tax_amount,
      invoice_number: (form.invoice_number || '').trim() || null,
      invoice_currency: invoiceCurrencyLabel,
      cad_settlement_total: form.cad_settlement_total !== '' ? Math.abs(Number(form.cad_settlement_total)) : null,
      expense_category_id: form.expense_category_id || null,
      gl_account_erpnext: selectedCategory?.gl_account_erpnext || selectedVendor?.default_gl_account_erpnext || null,
      credit_account_erpnext: (form.credit_account_erpnext || '').trim() || null,
      hst_treatment: form.hst_treatment,
      invoice_file_path: (form.invoice_file_path || '').trim() || null,
      attachment_id: form.attachment_id || null,
      is_fixed_asset: form.is_fixed_asset,
      asset_name: form.is_fixed_asset ? (form.asset_name || '').trim() || buildDefaultAssetName(form.vendor_name_display || selectedVendor?.name, form.invoice_number) : null,
      asset_useful_life_years: form.is_fixed_asset ? (parseFloat(form.asset_useful_life_years) || 5) : null,
      asset_salvage_value: form.is_fixed_asset ? (parseFloat(form.asset_salvage_value) || 0) : null,
      asset_gl_account_erpnext: form.is_fixed_asset
        ? (pickDefaultAssetGl(form.asset_gl_account_erpnext, selectedCategory?.gl_account_erpnext, assetGlOptions) || null)
        : null,
      document_type: resolveDraftDocumentType({ is_credit_memo: form.is_credit_memo }),
      credit_memo_against: form.is_credit_memo ? ((form.credit_memo_against || '').trim() || null) : null,
      line_items: form.is_fixed_asset ? [] : useSplitLines
        ? splitLines
            .map((line) => {
              const cat = categories.find((c) => c.id === line.expense_category_id);
              return {
                description: line.description?.trim() || null,
                amount: line.amount !== '' ? Number(line.amount) : 0,
                tax_amount: line.tax_amount !== '' ? Number(line.tax_amount) : 0,
                expense_category_id: line.expense_category_id || null,
                gl_account_erpnext: line.gl_account_erpnext?.trim() || cat?.gl_account_erpnext || null
              };
            })
            .filter((line) => line.amount !== 0)
        : []
    };
    onSubmit(payload);
  };

  const addSplitLine = () => setSplitLines((rows) => [...rows, { description: '', amount: '', tax_amount: '', expense_category_id: '', gl_account_erpnext: '' }]);
  const removeSplitLine = (idx) => setSplitLines((rows) => rows.filter((_, i) => i !== idx));
  const updateSplitLine = (idx, field, value) => setSplitLines((rows) => rows.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));

  return (
    <div className="accounting-draft-expense-modal" style={styles.overlay} onClick={onCancel}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>{title}</h3>
          <button type="button" style={styles.closeBtn} onClick={onCancel} aria-label="Close">
            <FiX size={20} />
          </button>
        </div>
        {(typeof onReExtractFromEmail === 'function' || typeof onReExtractFromPdf === 'function') && (
          <div style={{ padding: '0 24px 16px', borderBottom: '1px solid ' + (TavariStyles?.colors?.gray200 || '#e5e7eb') }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              {typeof onReExtractFromEmail === 'function' && (
                <button
                  type="button"
                  style={{ padding: '8px 14px', fontSize: 13, background: TavariStyles?.colors?.primary || '#008080', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
                  onClick={onReExtractFromEmail}
                  disabled={reExtracting}
                >
                  {reExtracting ? 'Extracting…' : 'Re-extract from email body'}
                </button>
              )}
              {typeof onReExtractFromPdf === 'function' && (
                <button
                  type="button"
                  style={{ padding: '8px 14px', fontSize: 13, background: TavariStyles?.colors?.primary || '#008080', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
                  onClick={onReExtractFromPdf}
                  disabled={reExtractingFromPdf}
                >
                  {reExtractingFromPdf ? 'Extracting…' : 'Re-extract from invoice PDF'}
                </button>
              )}
              {typeof onViewEmail === 'function' && (
                <button type="button" style={{ padding: '8px 14px', fontSize: 13, background: TavariStyles?.colors?.gray600 || '#4b5563', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={onViewEmail} title="View the email message (subject/body), not the receipt file">
                  <FiExternalLink size={14} /> View email message
                </button>
              )}
              {typeof onDownloadEmailPdf === 'function' && (
                <button type="button" style={{ padding: '8px 14px', fontSize: 13, background: TavariStyles?.colors?.gray600 || '#4b5563', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={onDownloadEmailPdf} disabled={downloadingEmailPdf}>
                  <FiDownload size={14} /> {downloadingEmailPdf ? 'Generating…' : 'Download as PDF'}
                </button>
              )}
            </div>
            <span style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 }}>Re-extract = fill vendor, date, amounts from PDF or email body. Use the <strong>View</strong> button next to the file name above to open the receipt/invoice; &quot;View email message&quot; shows the email text only.</span>
          </div>
        )}
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: TavariStyles?.colors?.gray600, margin: '0 0 8px 0', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Step 1 — Upload invoice</p>
            <div style={styles.field}>
              <label style={styles.label}>Invoice file (optional)</label>
              <div style={styles.fileUploadWrap}>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
                  style={styles.fileInput}
                  onChange={onInvoiceFileChange}
                  disabled={invoiceUploading || invoiceExtracting}
                />
                <span style={styles.fileUploadLabel}>
                  {invoiceUploading ? 'Uploading…' : invoiceExtracting ? 'Extracting…' : (invoiceFileName || 'Choose file…')}
                </span>
              </div>
              {invoiceFileName && !invoiceUploading && !invoiceExtracting && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: TavariStyles?.colors?.gray600 }} title={form.invoice_file_path}>
                    {invoiceFileName}
                  </span>
                  <button
                    type="button"
                    style={{ ...styles.removeFileBtn, background: 'transparent', color: TavariStyles?.colors?.primary || '#2563eb' }}
                    onClick={async () => {
                      try {
                        await openExpenseInvoiceAttachment(supabase, {
                          invoice_file_path: form.invoice_file_path,
                          attachment_id: form.attachment_id,
                          received_email_id: initialValues.received_email_id
                        });
                      } catch (e) {
                        toast.error(e?.message || 'Could not open file');
                      }
                    }}
                    title="View receipt / invoice (opens in new tab)"
                  >
                    <FiExternalLink size={14} /> View
                  </button>
                  <button type="button" style={styles.removeFileBtn} onClick={removeInvoiceFile} title="Remove file">
                    <FiTrash2 size={14} />
                  </button>
                </div>
              )}
              {invoiceUploadError && (
                <p style={{ fontSize: 13, color: TavariStyles?.colors?.danger || '#dc2626', marginTop: 4 }}>{invoiceUploadError}</p>
              )}
            </div>
          </div>
          <p style={{ fontSize: 13, fontWeight: 600, color: TavariStyles?.colors?.gray600, margin: '0 0 12px 0', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Verify or edit details</p>
          <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 8, background: '#f9fafb', border: '1px solid #e5e7eb' }}>
            <TavariCheckbox
              checked={!!form.is_credit_memo}
              onChange={(checked) => setForm((f) => ({
                ...f,
                is_credit_memo: checked,
                is_fixed_asset: checked ? false : f.is_fixed_asset,
              }))}
              label="Vendor return / credit memo"
            />
            <p style={{ margin: '8px 0 0 0', fontSize: 13, color: TavariStyles?.colors?.gray600 }}>
              Expense amounts are always entered as positive totals here — Tavari stores them as negative internally.
              Check this only for returns and vendor credits; they post as an ERPNext return and reduce expense.
            </p>
            {form.is_credit_memo && (
              <div style={{ marginTop: 12 }}>
                <label style={styles.label}>Original invoice # (optional)</label>
                <input
                  type="text"
                  style={styles.input}
                  value={form.credit_memo_against}
                  onChange={(e) => setForm((f) => ({ ...f, credit_memo_against: e.target.value }))}
                  placeholder="Invoice this return applies to"
                />
              </div>
            )}
          </div>
          {form.is_credit_memo && (
            <div style={{ marginBottom: 16, padding: '10px 12px', borderRadius: 8, background: '#eff6ff', border: '1px solid #bfdbfe', fontSize: 13, color: '#1e40af' }}>
              <strong>Credit memo</strong>
              {form.credit_memo_against
                ? ` — vendor credit against invoice ${form.credit_memo_against}. Posts as an ERPNext return.`
                : ' — vendor return. Posts as an ERPNext return and reduces expense.'}
            </div>
          )}
          {initialValues.is_duplicate && (
            <div style={{ marginBottom: 16, padding: '10px 12px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', fontSize: 13, color: '#92400e' }}>
              <strong>Possible duplicate</strong> — same vendor and invoice number as an existing expense. Delete this draft or confirm posting from the queue.
            </div>
          )}
          <div style={styles.field}>
            <label style={styles.label}>Vendor</label>
            <select
              style={styles.input}
              value={form.vendor_id || (form.vendor_name_display && !form.vendor_id ? '__other__' : '')}
              onChange={(e) => onVendorChange(e.target.value)}
            >
              <option value="">— Select vendor —</option>
              {availableVendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
              <option value="__other__">Other (type name below)</option>
            </select>
          </div>
          <div style={{ ...styles.field, marginTop: -8 }}>
            <button
              type="button"
              style={styles.linkButton}
              onClick={openAddVendor}
            >
              <FiPlus size={14} /> Add vendor without leaving this expense
            </button>
          </div>
          {showAddVendor && (
            <div style={styles.inlineCard}>
              <div style={styles.inlineCardHeader}>
                <div>
                  <h4 style={styles.inlineCardTitle}>New vendor</h4>
                  <p style={styles.inlineCardText}>Create the vendor here, then continue saving this expense.</p>
                </div>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Vendor name</label>
                <input
                  style={styles.input}
                  value={newVendorForm.name}
                  onChange={(e) => setNewVendorForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. ABC Supplies"
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Default category (optional)</label>
                <select
                  style={styles.input}
                  value={newVendorForm.default_expense_category_id}
                  onChange={(e) => setNewVendorForm((prev) => ({ ...prev, default_expense_category_id: e.target.value }))}
                >
                  <option value="">— None —</option>
                  {categories.map((c) => {
                    const parent = c.parent_id ? categories.find((p) => p.id === c.parent_id) : null;
                    const label = parent ? `${parent.name} › ${c.name}` : c.name;
                    return <option key={c.id} value={c.id}>{label}</option>;
                  })}
                </select>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Default HST treatment</label>
                <select
                  style={styles.input}
                  value={newVendorForm.default_hst_treatment}
                  onChange={(e) => setNewVendorForm((prev) => ({ ...prev, default_hst_treatment: e.target.value }))}
                >
                  {HST_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div style={styles.inlineActions}>
                <button
                  type="button"
                  style={styles.primaryButton}
                  onClick={handleCreateVendor}
                  disabled={addingVendor}
                >
                  {addingVendor ? <><FiLoader style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : 'Save vendor'}
                </button>
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={() => setShowAddVendor(false)}
                  disabled={addingVendor}
                >
                  Keep editing expense
                </button>
              </div>
            </div>
          )}
          <div style={styles.field}>
            <label style={styles.label}>Vendor name (if not in list above)</label>
            <input
              style={styles.input}
              value={form.vendor_name_display}
              onChange={(e) => setForm((f) => ({ ...f, vendor_name_display: e.target.value }))}
              placeholder="e.g. New vendor name from invoice"
            />
          </div>
          <div style={styles.row}>
            <div style={{ ...styles.field, flex: 1 }}>
              <label style={styles.label}>Payment / transaction date</label>
              <BusinessCalendarPicker
                value={form.transaction_date || ''}
                onChange={(dateKey) => setForm((f) => ({ ...f, transaction_date: dateKey || '' }))}
                businessTimezone={businessTimezone}
                ariaLabel="Payment / transaction date"
              />
            </div>
            <div style={{ ...styles.field, flex: 1 }}>
              <label style={styles.label}>Invoice date (optional)</label>
              <BusinessCalendarPicker
                value={form.invoice_date || ''}
                onChange={(dateKey) => setForm((f) => ({ ...f, invoice_date: dateKey || '' }))}
                businessTimezone={businessTimezone}
                ariaLabel="Invoice date"
                placeholder="Optional"
              />
            </div>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Invoice currency</label>
            <select
              style={styles.input}
              value={form.invoice_currency}
              onChange={(e) => setForm((f) => ({ ...f, invoice_currency: e.target.value.toUpperCase() }))}
            >
              <option value="CAD">CAD — Canadian dollar</option>
              <option value="USD">USD — US dollar</option>
              <option value="EUR">EUR — Euro</option>
              <option value="GBP">GBP — British pound</option>
              <option value="AUD">AUD — Australian dollar</option>
            </select>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>{foreignInvoice ? `Invoice total (${invoiceCurrencyLabel}) *` : 'Total amount *'}</label>
            <input
              type="number"
              step="0.01"
              style={styles.input}
              value={form.total_amount === '' ? '' : String(Math.abs(Number(form.total_amount) || 0))}
              onChange={(e) => onTotalChange(e.target.value)}
              placeholder="0.00"
              required
            />
            {foreignInvoice && (
              <p style={styles.helpText}>
                Amount shown on the supplier invoice in {invoiceCurrencyLabel}. Your books will post in CAD once you enter the charge below.
              </p>
            )}
          </div>
          {foreignInvoice && (
            <div style={styles.foreignBox}>
              <label style={styles.label}>CAD amount charged *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                style={styles.input}
                value={form.cad_settlement_total === '' ? '' : String(form.cad_settlement_total)}
                onChange={(e) => setForm((f) => ({ ...f, cad_settlement_total: e.target.value }))}
                placeholder="From bank or card statement"
              />
              <p style={styles.helpText}>
                Enter the actual Canadian dollar amount that hit your bank account or credit card. Used for posting and bank matching.
              </p>
            </div>
          )}
          <div style={styles.row}>
            <div style={{ ...styles.field, flex: 1 }}>
              <label style={styles.label}>Subtotal (optional)</label>
              <div style={styles.amountPrefixWrap}>
                <span style={styles.amountPrefix}>−</span>
                <input
                  type="number"
                  step="0.01"
                  style={{ ...styles.input, ...styles.amountInput }}
                  value={displaySubtotal}
                  onChange={(e) => onSubtotalChange(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div style={{ ...styles.field, flex: 1 }}>
              <label style={styles.label}>Tax amount (optional)</label>
              {isExemptHst ? (
                <p style={{ ...styles.helpText, margin: '8px 0 0', color: TavariStyles?.colors?.gray600 || '#6b7280' }}>Exempt — no tax on this transaction.</p>
              ) : (
                <div style={styles.amountPrefixWrap}>
                  <span style={styles.amountPrefix}>−</span>
                  <input
                    type="number"
                    step="0.01"
                    style={{ ...styles.input, ...styles.amountInput }}
                    value={displayTax}
                    onChange={(e) => onTaxAmountChange(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              )}
            </div>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Category</label>
            <select
              style={styles.input}
              value={form.expense_category_id}
              onChange={(e) => setForm((f) => ({ ...f, expense_category_id: e.target.value }))}
            >
              <option value="">— None —</option>
              {categories.map((c) => {
                const parent = c.parent_id ? categories.find((p) => p.id === c.parent_id) : null;
                const label = parent ? `${parent.name} › ${c.name}` : c.name;
                return <option key={c.id} value={c.id}>{label}</option>;
              })}
            </select>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Paid from / assign to</label>
            <select
              style={styles.input}
              value={form.credit_account_erpnext || ''}
              onChange={(e) => setForm((f) => ({ ...f, credit_account_erpnext: e.target.value }))}
            >
              <option value="">{payableAccountLabel}</option>
              {creditAccountOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <p style={styles.helpText}>
              Default leaves this as an unpaid bill on Accounts Payable. Choose cash on hand, a bank account, or a clearing account to post it there (same idea as QuickBooks cash-on-hand clearing).
            </p>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>HST treatment (override per transaction)</label>
            <select
              style={styles.input}
              value={form.hst_treatment}
              onChange={(e) => applyHstTreatmentChange(e.target.value)}
            >
              {HST_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Invoice #</label>
            <input
              style={styles.input}
              value={form.invoice_number}
              onChange={(e) => setForm((f) => ({ ...f, invoice_number: e.target.value }))}
              placeholder="Optional"
            />
          </div>
          <div style={{ ...styles.field, padding: 14, background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
            <TavariCheckbox
              checked={form.is_fixed_asset}
              onChange={(checked) => {
                setForm((f) => {
                  const vendorLabel = (f.vendor_name_display || selectedVendor?.name || '').trim();
                  const categoryGl = selectedCategory?.gl_account_erpnext || '';
                  const next = { ...f, is_fixed_asset: checked };
                  if (checked) {
                    if (!f.asset_name?.trim()) {
                      next.asset_name = buildDefaultAssetName(vendorLabel, f.invoice_number);
                    }
                    next.asset_gl_account_erpnext = pickDefaultAssetGl(f.asset_gl_account_erpnext, categoryGl, assetGlOptions);
                  }
                  return next;
                });
                if (checked) setUseSplitLines(false);
              }}
              style={{ alignItems: 'flex-start' }}
              label={(
                <span>
                  <strong>Capitalize as fixed asset</strong>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 400, color: TavariStyles?.colors?.gray600 || '#6b7280', marginTop: 4 }}>
                    Posts to a fixed-asset account in ERPNext and adds this item to the Assets tab for depreciation tracking.
                  </span>
                </span>
              )}
            />
            {form.is_fixed_asset && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                <div style={styles.field}>
                  <label style={styles.label}>Asset name *</label>
                  <input
                    style={styles.input}
                    value={form.asset_name}
                    onChange={(e) => setForm((f) => ({ ...f, asset_name: e.target.value }))}
                    placeholder="e.g. Commercial oven · INV-1042"
                    required={form.is_fixed_asset}
                  />
                </div>
                <div style={styles.row}>
                  <div style={{ ...styles.field, flex: 1 }}>
                    <label style={styles.label}>Useful life (years)</label>
                    <input
                      type="number"
                      min="0.5"
                      step="0.5"
                      style={styles.input}
                      value={form.asset_useful_life_years}
                      onChange={(e) => setForm((f) => ({ ...f, asset_useful_life_years: e.target.value }))}
                    />
                  </div>
                  <div style={{ ...styles.field, flex: 1 }}>
                    <label style={styles.label}>Salvage value</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      style={styles.input}
                      value={form.asset_salvage_value}
                      onChange={(e) => setForm((f) => ({ ...f, asset_salvage_value: e.target.value }))}
                    />
                  </div>
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Fixed asset GL account</label>
                  <select
                    style={styles.input}
                    value={form.asset_gl_account_erpnext || ''}
                    onChange={(e) => setForm((f) => ({ ...f, asset_gl_account_erpnext: e.target.value }))}
                    required={form.is_fixed_asset}
                  >
                    <option value="">Select asset account…</option>
                    {assetGlOptions.map((gl) => (
                      <option key={gl} value={gl}>{gl}</option>
                    ))}
                  </select>
                  <p style={styles.helpText}>Expense category GL is not used here. For a card reader or POS device, use <strong>Electronic Equipments</strong>. Capitalized cost uses subtotal (before recoverable HST).</p>
                </div>
              </div>
            )}
          </div>
          <div style={{ ...styles.field, padding: 12, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb', opacity: form.is_fixed_asset ? 0.55 : 1 }}>
            <TavariCheckbox
              checked={useSplitLines}
              disabled={form.is_fixed_asset}
              onChange={(checked) => setUseSplitLines(checked)}
              label="Split across multiple categories"
            />
            {form.is_fixed_asset && (
              <p style={{ ...styles.helpText, marginTop: 8, marginBottom: 0 }}>Turn off fixed asset to split this invoice across categories.</p>
            )}
            {useSplitLines && (
              <div style={{ marginTop: 12 }}>
                {splitLines.map((line, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.8fr 0.8fr 1.2fr auto', gap: 8, marginBottom: 8, alignItems: 'end' }}>
                    <input style={styles.input} placeholder="Description" value={line.description} onChange={(e) => updateSplitLine(idx, 'description', e.target.value)} />
                    <input type="number" step="0.01" style={styles.input} placeholder="Subtotal" value={line.amount} onChange={(e) => updateSplitLine(idx, 'amount', e.target.value)} />
                    <input type="number" step="0.01" style={styles.input} placeholder="Tax" value={line.tax_amount} onChange={(e) => updateSplitLine(idx, 'tax_amount', e.target.value)} />
                    <select style={styles.input} value={line.expense_category_id} onChange={(e) => updateSplitLine(idx, 'expense_category_id', e.target.value)}>
                      <option value="">Category</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button type="button" style={{ padding: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: '#b91c1c' }} onClick={() => removeSplitLine(idx)} aria-label="Remove line"><FiTrash2 /></button>
                  </div>
                ))}
                <button type="button" style={styles.secondaryButton} onClick={addSplitLine}><FiPlus /> Add line</button>
              </div>
            )}
          </div>
          <div style={styles.actions}>
            <button type="submit" style={styles.primaryButton}>Save</button>
            <button type="button" style={styles.secondaryButton} onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </div>
      <style>{`
        .accounting-draft-expense-modal input:focus,
        .accounting-draft-expense-modal select:focus {
          outline: none;
          border-color: ${TavariStyles?.colors?.primary || '#008080'};
          box-shadow: 0 0 0 2px ${(TavariStyles?.colors?.primary || '#008080')}20;
        }
        .accounting-draft-expense-modal button[type="submit"]:hover {
          filter: brightness(1.05);
        }
        .accounting-draft-expense-modal .actions button[type="button"]:hover {
          background: ${TavariStyles?.colors?.gray200 || '#e5e7eb'};
        }
      `}</style>
    </div>
  );
}

const spacing = TavariStyles?.spacing || {};
const radius = TavariStyles?.borderRadius || {};
const shadows = TavariStyles?.shadows || {};
const colors = TavariStyles?.colors || {};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: spacing.xl || 20
  },
  modal: {
    background: colors.white || '#fff',
    borderRadius: radius.xl || 16,
    maxWidth: 600,
    width: '100%',
    maxHeight: '90vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: shadows.modal || '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    border: `1px solid ${colors.gray200 || '#e5e7eb'}`
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '28px 40px 20px',
    borderBottom: `1px solid ${colors.gray200 || '#e5e7eb'}`,
    flexShrink: 0
  },
  title: {
    margin: 0,
    fontSize: TavariStyles?.typography?.fontSize?.['2xl'] || '1.25rem',
    fontWeight: TavariStyles?.typography?.fontWeight?.semibold || 600,
    color: colors.gray900 || '#111827'
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: spacing.sm || 8,
    color: colors.gray500 || '#6b7280',
    borderRadius: radius.lg || 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  form: {
    overflow: 'auto',
    flex: 1,
    padding: '28px 40px 32px'
  },
  field: { marginBottom: spacing.xl || 20, padding: 0 },
  row: { display: 'flex', gap: spacing.lg || 16, marginBottom: spacing.xl || 20 },
  label: {
    display: 'block',
    fontSize: TavariStyles?.typography?.fontSize?.sm || 13,
    fontWeight: TavariStyles?.typography?.fontWeight?.medium || 500,
    color: colors.gray700 || '#374151',
    marginBottom: spacing.xs || 4
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    border: `1px solid ${colors.gray300 || '#d1d5db'}`,
    borderRadius: radius.lg || 8,
    fontSize: TavariStyles?.typography?.fontSize?.base || 14,
    boxSizing: 'border-box'
  },
  amountPrefixWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    border: `1px solid ${colors.gray300 || '#d1d5db'}`,
    borderRadius: radius.lg || 8,
    overflow: 'hidden'
  },
  amountPrefix: {
    padding: '10px 12px',
    fontSize: TavariStyles?.typography?.fontSize?.base || 14,
    fontWeight: 500,
    color: colors.gray600 || '#4b5563',
    background: colors.gray50 || '#f9fafb',
    borderRight: `1px solid ${colors.gray300 || '#d1d5db'}`
  },
  amountInput: {
    border: 'none',
    borderRadius: 0,
    flex: 1,
    minWidth: 0
  },
  fileUploadWrap: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center'
  },
  fileInput: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    opacity: 0,
    cursor: 'pointer',
    fontSize: 14
  },
  fileUploadLabel: {
    padding: '10px 14px',
    border: `1px solid ${colors.gray300 || '#d1d5db'}`,
    borderRadius: radius.lg || 8,
    fontSize: TavariStyles?.typography?.fontSize?.base || 14,
    color: colors.gray600 || '#4b5563',
    pointerEvents: 'none'
  },
  removeFileBtn: {
    padding: spacing.xs || 4,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: colors.gray500 || '#6b7280',
    borderRadius: radius.sm || 4
  },
  actions: {
    display: 'flex',
    gap: spacing.lg || 12,
    padding: `${spacing.xl || 20}px 0 0`,
    marginTop: spacing.lg || 16,
    borderTop: `1px solid ${colors.gray200 || '#e5e7eb'}`
  },
  primaryButton: {
    padding: '10px 20px',
    background: colors.primary || '#008080',
    color: '#fff',
    border: 'none',
    borderRadius: radius.lg || 8,
    cursor: 'pointer',
    fontSize: TavariStyles?.typography?.fontSize?.base || 14,
    fontWeight: TavariStyles?.typography?.fontWeight?.medium || 500
  },
  secondaryButton: {
    padding: '10px 20px',
    background: colors.gray100 || '#f3f4f6',
    color: colors.gray700 || '#374151',
    border: `1px solid ${colors.gray300 || '#d1d5db'}`,
    borderRadius: radius.lg || 8,
    cursor: 'pointer',
    fontSize: TavariStyles?.typography?.fontSize?.base || 14,
    fontWeight: TavariStyles?.typography?.fontWeight?.medium || 500
  },
  linkButton: {
    padding: 0,
    background: 'transparent',
    border: 'none',
    color: colors.primary || '#008080',
    cursor: 'pointer',
    fontSize: TavariStyles?.typography?.fontSize?.sm || 13,
    fontWeight: TavariStyles?.typography?.fontWeight?.medium || 500,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6
  },
  inlineCard: {
    marginBottom: spacing.xl || 20,
    padding: spacing.lg || 16,
    background: colors.gray50 || '#f9fafb',
    border: `1px solid ${colors.gray200 || '#e5e7eb'}`,
    borderRadius: radius.xl || 16
  },
  inlineCardHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: spacing.md || 12
  },
  inlineCardTitle: {
    margin: '0 0 4px',
    fontSize: TavariStyles?.typography?.fontSize?.lg || 16,
    fontWeight: TavariStyles?.typography?.fontWeight?.semibold || 600,
    color: colors.gray900 || '#111827'
  },
  inlineCardText: {
    margin: 0,
    fontSize: TavariStyles?.typography?.fontSize?.sm || 13,
    color: colors.gray600 || '#4b5563'
  },
  inlineActions: {
    display: 'flex',
    gap: spacing.md || 12,
    flexWrap: 'wrap'
  },
  foreignBox: {
    marginBottom: spacing.xl || 20,
    padding: spacing.lg || 16,
    background: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: radius.xl || 16
  },
  helpText: {
    margin: '6px 0 0',
    fontSize: TavariStyles?.typography?.fontSize?.sm || 13,
    color: colors.gray600 || '#4b5563',
    lineHeight: 1.45
  }
};
