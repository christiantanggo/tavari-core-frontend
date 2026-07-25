// Posts a draft expense to ERPNext as a Journal Entry and marks it approved/posted.
// POST body: { business_id, draft_id }
// Requires ERPNext configured in accounting_business_config.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callErpNext, fetchCompanyAbbreviation, fetchAccountNamesForCompany, resolveLedgerAccount, resolveExpenseLedgerAccount, stripCompanySuffix, appendCompanySuffix, ensureSupplierInErpNext, createErpNextDoc, fetchErpNextDoc, submitErpNextDoc } from '../_shared/erpnext.ts';
import { reconcileDraftExpenseAmountsForPosting } from '../_shared/invoiceTextFallback.ts';
import { todayInTimezone } from '../_shared/businessDayWindow.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(obj: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function numericValue(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function normalizeAccountKey(name: string, abbr: string) {
  return stripCompanySuffix(name || '', abbr).toLowerCase().trim();
}

/** Empty / AP / Creditors → leave as unpaid payable. */
function isAccountsPayableSelection(selected: string, configuredAp: string, abbr: string) {
  const key = normalizeAccountKey(selected, abbr);
  if (!key) return true;
  const apKey = normalizeAccountKey(configuredAp || 'Accounts Payable', abbr);
  if (key === apKey) return true;
  return key === 'accounts payable' || key === 'creditors';
}

function findAccountInfo(accounts: Array<{ name?: string; account_type?: string }>, accountName: string) {
  if (!accountName) return null;
  return accounts.find((a) => a.name === accountName) || null;
}

function isBankOrCashAccountType(accountType: string | undefined | null) {
  const t = String(accountType || '').toLowerCase().trim();
  return t === 'bank' || t === 'cash';
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let claimedDraftForPosting: { businessId: string; draftId: string; priorStatus: string } | null = null;
  let erpnextSubmitted = false;
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' });

    const body = (await req.json().catch(() => ({}))) as { business_id?: string; draft_id?: string; bank_account_erpnext?: string; force_duplicate?: boolean };
    const businessId = body?.business_id;
    const draftId = body?.draft_id;
    if (!businessId || !draftId) return json({ error: 'Missing business_id or draft_id' });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const isServiceRole = authHeader === `Bearer ${supabaseServiceKey}`;
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    let userId: string | null = null;
    if (!isServiceRole) {
      const { data: { user } } = await supabaseUser.auth.getUser();
      userId = user?.id ?? null;
      const { data: membership } = await supabaseUser
        .from('business_users')
        .select('user_id, role')
        .eq('business_id', businessId)
        .eq('user_id', userId)
        .in('role', ['owner', 'manager', 'admin'])
        .limit(1)
        .maybeSingle();
      if (!membership) return json({ error: 'Access denied to this business' });
    }

    const { data: draft, error: draftErr } = await supabaseAdmin
      .from('accounting_draft_expenses')
      .select('*')
      .eq('id', draftId)
      .eq('business_id', businessId)
      .single();
    if (draftErr || !draft) return json({ error: 'Draft expense not found' });
    if (draft.status === 'posted' || draft.status === 'approved') {
      return json({ error: 'Draft is already approved or posted' });
    }
    // Allow 'posting' so retries can finish after Purchase Invoice succeeded but Payment Entry failed.
    const priorStatus = draft.status === 'on_hold' ? 'on_hold' : 'draft';

    if (draft.is_duplicate && !body.force_duplicate) {
      return json({
        error: 'This looks like a duplicate invoice. Delete it or confirm posting anyway.',
        code: 'duplicate',
        duplicate_of_draft_id: draft.duplicate_of_draft_id || null,
      }, 409);
    }

    const isCreditMemo = draft.document_type === 'credit_memo';
    const isFixedAsset = !!draft.is_fixed_asset;

    if (isFixedAsset && isCreditMemo) {
      return json({ error: 'Credit memos cannot be capitalized as fixed assets.' });
    }

    const releasePostingLock = async () => {
      await supabaseAdmin
        .from('accounting_draft_expenses')
        .update({ status: priorStatus })
        .eq('id', draftId)
        .eq('business_id', businessId)
        .eq('status', 'posting');
    };

    const fullSelect = 'id, erpnext_api_url, erpnext_company_name, erpnext_company_abbr, erpnext_api_key, erpnext_secret, period_lock_type, period_locked_until, business_timezone, hst_recoverable_account_erpnext, accounts_payable_account_erpnext, default_bank_account_erpnext, depreciation_expense_account_erpnext, accumulated_depreciation_account_erpnext';
    const minimalSelect = 'id, erpnext_api_url, erpnext_company_name, erpnext_api_key, erpnext_secret, period_lock_type, period_locked_until';
    let config: Record<string, unknown> | null = null;
    let configErr: { message?: string } | null = null;
    let usedMinimalSelect = false;

    const res = await supabaseAdmin
      .from('accounting_business_config')
      .select(fullSelect)
      .eq('business_id', businessId)
      .maybeSingle();
    config = res.data as Record<string, unknown> | null;
    configErr = res.error as { message?: string } | null;

    if (configErr && typeof configErr?.message === 'string' && configErr.message.includes('column') && configErr.message.includes('does not exist')) {
      const fallback = await supabaseAdmin
        .from('accounting_business_config')
        .select(minimalSelect)
        .eq('business_id', businessId)
        .maybeSingle();
      if (!fallback.error && fallback.data) {
        config = fallback.data as Record<string, unknown>;
        configErr = null;
        usedMinimalSelect = true;
        if (!config.erpnext_company_abbr) config.erpnext_company_abbr = '';
        if (!config.hst_recoverable_account_erpnext) config.hst_recoverable_account_erpnext = '';
        if (!config.accounts_payable_account_erpnext) config.accounts_payable_account_erpnext = '';
        if (!config.default_bank_account_erpnext) config.default_bank_account_erpnext = '';
      }
    }

    const hasUrl = !!config?.erpnext_api_url?.trim();
    const hasKey = !!config?.erpnext_api_key?.trim();
    console.log('[accounting-post-expense] config check', { businessId, configFound: !!config, configError: configErr?.message, usedMinimalSelect, hasUrl, hasKey });
    if (configErr) {
      const msg = String(configErr.message || '');
      let hint = '';
      if (msg.includes('PGRST116') || msg.includes('multiple') || msg.includes('duplicate')) {
        hint = ' There may be duplicate accounting config rows for this business—check in Supabase Table Editor.';
      } else if (msg.length > 0 && msg.length < 120) {
        hint = ` (${msg})`;
      }
      console.error('[accounting-post-expense] config load failed', configErr);
      return json({ error: `Could not load accounting config. Try again.${hint}` });
    }
    if (!config) return json({ error: 'No accounting config for this business. Go to Accounting → Settings and save your ERPNext URL and API Key.' });
    if (!hasUrl) return json({ error: 'ERPNext API URL is empty in the database for this business. In Accounting → Settings, enter the ERPNext URL, click Save, then try again. (Check you have the correct business selected in the app.)' });
    if (!hasKey) return json({ error: 'ERPNext API Key is empty in the database for this business. In Accounting → Settings, enter API Key and Secret, click Save, then try again. (Check you have the correct business selected.)' });

    const businessTimezone = String(config.business_timezone || 'America/Toronto').trim() || 'America/Toronto';
    // ERPNext: supplier invoice (bill) date cannot be after posting date.
    const rawPostingDate = String(draft.transaction_date || draft.invoice_date || todayInTimezone(businessTimezone)).slice(0, 10);
    const rawBillDate = String(draft.invoice_date || draft.transaction_date || rawPostingDate).slice(0, 10);
    const postingDate = rawBillDate > rawPostingDate ? rawBillDate : rawPostingDate;
    if (config.period_locked_until) {
      const lockedUntil = new Date(config.period_locked_until).getTime();
      const postDate = new Date(postingDate).getTime();
      if (postDate <= lockedUntil) {
        return json({ error: `Transaction date ${postingDate} is in a locked period. Unlock in Settings to approve.` });
      }
    }

    const baseUrl = (config.erpnext_api_url || '').replace(/\/$/, '');
    const apiKey = config.erpnext_api_key?.trim() || '';
    const apiSecret = (config.erpnext_secret || '').trim() || '';
    let company = (config.erpnext_company_name || '').trim() || 'Company';
    let abbr = (config.erpnext_company_abbr || '').trim();

    if (!abbr) {
      const fetched = await fetchCompanyAbbreviation(baseUrl, apiKey, apiSecret, company === 'Company' ? undefined : company);
      if (!fetched.ok || !fetched.abbreviation) {
        return json({
          error: fetched.error || 'Could not get company abbreviation from ERPNext. Set "Company abbreviation" in Accounting → Settings (e.g. TOS), or ensure your ERPNext Company has an abbreviation.'
        });
      }
      abbr = fetched.abbreviation;
      if (fetched.companyName) company = fetched.companyName;
      if (!usedMinimalSelect && config.id) {
        const updatePayload: Record<string, string> = { erpnext_company_abbr: abbr, updated_at: new Date().toISOString() };
        if (company !== (config.erpnext_company_name || '').trim()) updatePayload.erpnext_company_name = company;
        await supabaseAdmin
          .from('accounting_business_config')
          .update(updatePayload)
          .eq('id', config.id);
      }
    }

    const suffix = ` - ${abbr}`;

    const assetGlBase = stripCompanySuffix(
      draft.asset_gl_account_erpnext?.trim() || draft.gl_account_erpnext?.trim() || 'Fixed Assets',
      abbr,
    );
    const expenseGlBase = isFixedAsset
      ? assetGlBase
      : stripCompanySuffix(draft.gl_account_erpnext?.trim() || 'Miscellaneous Expenses', abbr);
    const expenseAccountLogical = appendCompanySuffix(expenseGlBase, abbr);
    const invoiceCurrency = String(draft.invoice_currency || 'CAD').trim().toUpperCase() || 'CAD';
    const cadSettlement = draft.cad_settlement_total != null && !Number.isNaN(Number(draft.cad_settlement_total))
      ? Math.abs(Number(draft.cad_settlement_total))
      : null;
    const useCadSettlement = invoiceCurrency !== 'CAD' && cadSettlement != null && cadSettlement > 0;
    const hstTreatment = String(draft.hst_treatment || 'recoverable').trim().toLowerCase();
    const reconciled = reconcileDraftExpenseAmountsForPosting({
      total_amount: useCadSettlement ? cadSettlement : draft.total_amount,
      tax_amount: useCadSettlement ? 0 : draft.tax_amount,
      subtotal: useCadSettlement ? cadSettlement : draft.subtotal,
      hst_treatment: useCadSettlement ? 'exempt' : hstTreatment,
    });
    const totalAbs = reconciled.totalAbs;
    const taxAbs = reconciled.taxAbs;
    const subtotalAbs = reconciled.subtotalAbs;
    if (totalAbs <= 0) {
      return json({ error: 'Expense total must be greater than zero before posting.' });
    }
    if (invoiceCurrency !== 'CAD' && !useCadSettlement) {
      return json({ error: `This invoice is in ${invoiceCurrency}. Enter the CAD amount charged on your card or bank statement before posting.` });
    }
    if (hstTreatment === 'collected') {
      return json({ error: 'HST treatment "Collected" is for sales, not purchase expenses. Use Recoverable, Included, or Exempt.' });
    }
    if (hstTreatment === 'exempt' && taxAbs > 0) {
      return json({ error: 'Exempt expenses cannot include tax. Set tax amount to 0.00 or choose a taxable HST treatment.' });
    }
    const hstRecoverable = ((hstTreatment === 'recoverable' || hstTreatment === 'included') && taxAbs > 0);
    const hstRecoverableLogical = appendCompanySuffix(
      stripCompanySuffix(config.hst_recoverable_account_erpnext?.trim() || 'HST Recoverable', abbr),
      abbr,
    );
    const requestedBankAccount = (body.bank_account_erpnext || '').trim();
    const configuredBankAccount = (config.default_bank_account_erpnext?.trim() || '').trim();
    const configuredApAccount = (config.accounts_payable_account_erpnext?.trim() || 'Accounts Payable').trim();
    const draftCreditAccount = String(draft.credit_account_erpnext || '').trim();
    // Priority: bank-approve override → draft "Paid from / assign to" → bank_csv default bank → AP (unpaid).
    const selectedFundingRaw = requestedBankAccount
      || draftCreditAccount
      || (draft.source === 'bank_csv' ? (configuredBankAccount || 'Bank') : '');
    const leaveOnAccountsPayable = isAccountsPayableSelection(selectedFundingRaw, configuredApAccount, abbr)
      && !requestedBankAccount
      && draft.source !== 'bank_csv';
    const useImmediateClearing = !leaveOnAccountsPayable;
    const creditAccountLogical = useImmediateClearing
      ? appendCompanySuffix(stripCompanySuffix(selectedFundingRaw || configuredBankAccount || 'Bank', abbr), abbr)
      : appendCompanySuffix(stripCompanySuffix(configuredApAccount, abbr), abbr);

    // Resolve to ledger accounts only (group accounts cannot be used in transactions). Use live Chart of Accounts from API.
    const accountsRes = await fetchAccountNamesForCompany(baseUrl, apiKey, apiSecret, company);
    if (!accountsRes.ok || !accountsRes.accounts?.length) {
      return json({
        error: accountsRes.error || 'Could not load Chart of Accounts from ERPNext. Ensure the company has accounts.'
      });
    }
    const accountList = accountsRes.accounts;

    const expenseAccount = isFixedAsset
      ? resolveLedgerAccount(accountList, expenseAccountLogical, [
        appendCompanySuffix('Fixed Assets', abbr),
        appendCompanySuffix('Capital Work in Progress', abbr),
        appendCompanySuffix('Property Plant and Equipment', abbr),
      ])
      : resolveExpenseLedgerAccount(accountList, expenseGlBase, suffix);
    // Your Chart may have "HST - TOS" not "HST Recoverable - TOS"; try both. Must be a ledger account.
    const hstRecoverableAccount = hstRecoverable
      ? resolveLedgerAccount(accountList, hstRecoverableLogical) ?? resolveLedgerAccount(accountList, 'HST' + suffix)
      : null;
    // "Accounts Payable - TOS" is often a group; use ledger "Creditors - TOS" if so.
    const creditAccount = useImmediateClearing
      ? resolveLedgerAccount(accountList, creditAccountLogical, ['Bank' + suffix, 'Cash' + suffix])
      : resolveLedgerAccount(accountList, creditAccountLogical, ['Creditors' + suffix]);

    if (!expenseAccount) {
      return json({
        error: isFixedAsset
          ? `No ledger fixed-asset account found for "${expenseAccountLogical}". Set a fixed-asset GL on the draft or use a category mapped to a leaf asset account in ERPNext.`
          : `No ledger expense account found for "${expenseAccountLogical}". Use a leaf account (not a group) in Chart of Accounts for company "${company}".`
      });
    }
    if (hstRecoverable && !hstRecoverableAccount) {
      return json({
        error: `HST Recoverable account not found in ERPNext. We looked for "${hstRecoverableLogical}" and "HST${suffix}". Your Chart of Accounts must have one of these (e.g. under Duties and Taxes or Tax Assets). Set "HST Recoverable account" in Accounting → Settings if your account has a different name.`
      });
    }
    if (!creditAccount) {
      return json({
        error: useImmediateClearing
          ? `No ledger account found for "${creditAccountLogical}". Pick a leaf cash / bank / clearing account on the expense, or set Default bank account in Accounting → Settings.`
          : `No ledger account found for payables. We need a ledger (not group) account: "${creditAccountLogical}" or "Creditors${suffix}". In Chart of Accounts, use a leaf account (e.g. Creditors - TOS), not the group "Accounts Payable - TOS".`
      });
    }

    const vendorDisplayName = (draft.vendor_name_display ?? '').trim() || 'Unknown Supplier';
    const supplierRes = await ensureSupplierInErpNext(baseUrl, apiKey, apiSecret, vendorDisplayName);
    if (!supplierRes.ok) {
      return json({ error: supplierRes.error || 'Could not ensure Supplier in ERPNext. Check API permissions.' });
    }
    const supplierPartyName = supplierRes.partyName ?? vendorDisplayName;

    const { data: draftLines } = await supabaseAdmin
      .from('accounting_draft_expense_lines')
      .select('description, amount, tax_amount, expense_category_id, gl_account_erpnext')
      .eq('draft_expense_id', draftId)
      .eq('business_id', businessId)
      .order('sort_order');

    type PiItem = { item_name: string; description: string; qty: number; rate: number; amount: number; expense_account: string };
    const piItems: PiItem[] = [];
    const lineRows = (draftLines || []) as Array<{ description?: string; amount?: number; tax_amount?: number; gl_account_erpnext?: string }>;
    // Foreign invoices with CAD settlement: post one exempt line at the bank amount, not USD micro-lines.
    let postingLineRows = useCadSettlement ? [] : lineRows;
    if (postingLineRows.length > 0) {
      const rawLineSum = postingLineRows.reduce(
        (sum, line) => sum + numericValue(line.amount),
        0,
      );
      const flipExpenseLineSign = !isCreditMemo && rawLineSum < 0;
      const hasCreditLines = postingLineRows.some((line) => {
        const raw = numericValue(line.amount);
        if (raw === 0) return false;
        return flipExpenseLineSign ? raw > 0 : raw < 0;
      });
      // ERPNext rejects negative item rates unless Selling Settings allows it — post net header subtotal instead.
      if (hasCreditLines) postingLineRows = [];
    }
    if (isFixedAsset && postingLineRows.length > 0) {
      return json({ error: 'Split-line expenses cannot be posted as a fixed asset. Edit the draft and turn off split lines or fixed asset.' });
    }
    if (isFixedAsset) {
      const assetName = String(draft.asset_name || vendorDisplayName || '').trim();
      if (!assetName) {
        return json({ error: 'Enter an asset name before posting as a fixed asset.' });
      }
    }
    let splitLinesPiSum = 0;
    if (postingLineRows.length > 0) {
      const rawLineSum = postingLineRows.reduce(
        (sum, line) => sum + numericValue(line.amount),
        0,
      );
      // Extraction may store charges as negative (sum < 0) or positive (sum > 0); credits use the opposite sign.
      const flipExpenseLineSign = !isCreditMemo && rawLineSum < 0;
      for (const line of postingLineRows) {
        const rawAmount = Number(line.amount ?? 0);
        if (!Number.isFinite(rawAmount) || rawAmount === 0) continue;
        const piAmount = round2(
          isCreditMemo ? rawAmount : (flipExpenseLineSign ? -rawAmount : rawAmount),
        );
        if (piAmount === 0) continue;
        splitLinesPiSum = round2(splitLinesPiSum + piAmount);
        const lineGlBase = stripCompanySuffix(
          line.gl_account_erpnext?.trim() || draft.gl_account_erpnext?.trim() || 'Miscellaneous Expenses',
          abbr,
        );
        const lineAccountLogical = appendCompanySuffix(lineGlBase, abbr);
        const lineAccount = resolveExpenseLedgerAccount(accountList, lineGlBase, suffix);
        if (!lineAccount) {
          return json({ error: `No ledger expense account found for split line "${lineAccountLogical}".` });
        }
        const desc = (line.description || vendorDisplayName).slice(0, 140);
        piItems.push({
          item_name: desc,
          description: desc,
          qty: 1,
          rate: piAmount,
          amount: piAmount,
          expense_account: lineAccount
        });
      }
    }
    if (piItems.length === 0) {
      const foreignNote = useCadSettlement && invoiceCurrency !== 'CAD'
        ? ` · Invoice ${Math.abs(Number(draft.total_amount) || 0).toFixed(2)} ${invoiceCurrency}`
        : '';
      const itemLabel = isFixedAsset
        ? String(draft.asset_name || vendorDisplayName).trim()
        : (draft.invoice_number || vendorDisplayName).slice(0, 140);
      piItems.push({
        item_name: itemLabel.slice(0, 140),
        description: `${isCreditMemo ? 'Credit memo' : isFixedAsset ? 'Fixed asset' : vendorDisplayName}${draft.invoice_number ? ` · ${draft.invoice_number}` : ''}${draft.credit_memo_against ? ` · vs ${draft.credit_memo_against}` : ''}${foreignNote}`.slice(0, 280),
        qty: isCreditMemo ? -1 : 1,
        rate: subtotalAbs,
        amount: isCreditMemo ? -subtotalAbs : subtotalAbs,
        expense_account: expenseAccount
      });
    }

    const piTaxes: Record<string, unknown>[] = [];
    // When split lines already sum to the invoice total, do not add header tax again (avoids double-counting eco fees / tax-included lines).
    const splitLinesAbs = Math.abs(splitLinesPiSum);
    const splitLinesMatchTotal = postingLineRows.length > 0 && Math.abs(splitLinesAbs - totalAbs) <= 0.05;
    const splitLinesMatchSubtotal = postingLineRows.length > 0 && Math.abs(splitLinesAbs - subtotalAbs) <= 0.05;
    const piTaxAbs = splitLinesMatchTotal ? 0 : (splitLinesMatchSubtotal ? taxAbs : taxAbs);
    if (hstRecoverable && hstRecoverableAccount && piTaxAbs > 0) {
      piTaxes.push({
        category: 'Total',
        add_deduct_tax: 'Add',
        charge_type: 'Actual',
        account_head: hstRecoverableAccount,
        description: 'HST',
        tax_amount: isCreditMemo ? -piTaxAbs : piTaxAbs
      });
    }

    // Keep the real supplier invoice date; posting date was already raised if needed.
    const billDate = rawBillDate || postingDate;
    // ERPNext: due date cannot be before posting date or supplier invoice (bill) date.
    const dueDate = billDate > postingDate ? billDate : postingDate;

    const piPayload: Record<string, unknown> = {
      supplier: supplierPartyName,
      company,
      posting_date: postingDate,
      set_posting_time: 1,
      bill_date: billDate,
      due_date: dueDate,
      bill_no: (draft.invoice_number || '').trim() || undefined,
      update_stock: 0,
      is_return: isCreditMemo ? 1 : 0,
      disable_rounded_total: 1,
      remarks: `[TAVARI ${isCreditMemo ? 'credit memo' : 'expense'}:${draftId}] ${supplierPartyName}`.slice(0, 140),
      items: piItems,
      ...(piTaxes.length > 0 ? { taxes: piTaxes } : {})
    };

    const { data: claimedDraft, error: claimErr } = await supabaseAdmin
      .from('accounting_draft_expenses')
      .update({ status: 'posting' })
      .eq('id', draftId)
      .eq('business_id', businessId)
      .in('status', ['draft', 'on_hold', 'posting'])
      .select('id')
      .maybeSingle();
    if (claimErr) return json({ error: claimErr.message || 'Failed to reserve draft for posting' });
    if (!claimedDraft?.id) return json({ error: 'Draft is already being posted or has already been posted' }, 409);
    claimedDraftForPosting = { businessId, draftId, priorStatus };

    let piName = String(draft.erpnext_purchase_invoice_id || '').trim();
    let reusedExistingPi = false;
    if (piName) {
      const existingPi = await fetchErpNextDoc(baseUrl, apiKey, apiSecret, 'Purchase Invoice', piName);
      if (existingPi.ok && existingPi.data) {
        const docstatus = Number(existingPi.data.docstatus ?? 0);
        if (docstatus === 1) {
          reusedExistingPi = true;
          erpnextSubmitted = true;
        } else if (docstatus === 0) {
          const submitExisting = await submitErpNextDoc(baseUrl, apiKey, apiSecret, existingPi.data);
          if (!submitExisting.ok) {
            await releasePostingLock();
            return json({ error: `Purchase Invoice ${piName} submit failed: ${submitExisting.error || 'unknown'}` });
          }
          reusedExistingPi = true;
          erpnextSubmitted = true;
        } else {
          piName = '';
        }
      } else {
        piName = '';
      }
    }

    if (!piName) {
      const createPiRes = await createErpNextDoc(baseUrl, apiKey, apiSecret, 'Purchase Invoice', piPayload);
      if (!createPiRes.ok || !createPiRes.name) {
        await releasePostingLock();
        const err = createPiRes.error || 'ERPNext Purchase Invoice request failed';
        if (typeof err === 'string' && (err.includes('LinkValidationError') || err.includes('Could not find'))) {
          return json({
            error: `ERPNext could not find one or more accounts. Check expense and HST accounts for company "${company}" (${abbr}).`
          });
        }
        return json({ error: err });
      }

      const piDocRes = await fetchErpNextDoc(baseUrl, apiKey, apiSecret, 'Purchase Invoice', createPiRes.name);
      if (!piDocRes.ok || !piDocRes.data) {
        await releasePostingLock();
        return json({ error: piDocRes.error || 'Created Purchase Invoice but could not load it for submit' });
      }
      const submitPiRes = await submitErpNextDoc(baseUrl, apiKey, apiSecret, piDocRes.data);
      if (!submitPiRes.ok) {
        await releasePostingLock();
        return json({ error: `Purchase Invoice created but submit failed: ${submitPiRes.error || 'unknown'}` });
      }
      piName = createPiRes.name;
      erpnextSubmitted = true;
    }

    let paymentEntryName: string | null = String(draft.erpnext_payment_entry_id || '').trim() || null;
    let clearingJournalEntryName: string | null = String(draft.erpnext_journal_entry_id || '').trim() || null;
    if (reusedExistingPi && paymentEntryName) {
      // Already fully cleared on a prior partial success path.
      claimedDraftForPosting = null;
      await supabaseAdmin
        .from('accounting_draft_expenses')
        .update({
          status: 'posted',
          approved_by: userId,
          approved_at: new Date().toISOString(),
          erpnext_purchase_invoice_id: piName,
          erpnext_payment_entry_id: paymentEntryName,
          erpnext_journal_entry_id: clearingJournalEntryName,
        })
        .eq('id', draftId)
        .eq('business_id', businessId);
      return json({
        success: true,
        erpnext_purchase_invoice_id: piName,
        erpnext_payment_entry_id: paymentEntryName,
        erpnext_journal_entry_id: clearingJournalEntryName,
        reused: true,
      });
    }

    // Persist PI id immediately so a failed Payment Entry does not orphan the draft
    // and a retry can finish clearing without creating a duplicate bill.
    await supabaseAdmin
      .from('accounting_draft_expenses')
      .update({ erpnext_purchase_invoice_id: piName })
      .eq('id', draftId)
      .eq('business_id', businessId);

    if (useImmediateClearing) {
      const payableAccount = resolveLedgerAccount(
        accountList,
        appendCompanySuffix(stripCompanySuffix(configuredApAccount, abbr), abbr),
        [appendCompanySuffix('Creditors', abbr)],
      );
      if (!payableAccount) {
        await releasePostingLock();
        return json({ error: 'Could not resolve payable account for payment/clearing entry.' });
      }
      const piAfterSubmit = await fetchErpNextDoc(baseUrl, apiKey, apiSecret, 'Purchase Invoice', piName);
      const outstandingAmount = piAfterSubmit.ok
        ? Math.round(numericValue(piAfterSubmit.data?.outstanding_amount) * 100) / 100
        : totalAbs;
      const paymentAmount = Math.abs(outstandingAmount) > 0 ? Math.abs(outstandingAmount) : totalAbs;
      const creditAccountInfo = findAccountInfo(accountList, creditAccount);
      const usePaymentEntry = isBankOrCashAccountType(creditAccountInfo?.account_type);

      if (Math.abs(outstandingAmount) < 0.005) {
        // Already paid/cleared in ERPNext (retry after prior PE success that didn't finalize Tavari).
      } else if (usePaymentEntry) {
        // ERPNext requires Reference No + Reference Date for Bank/Cash Payment Entries.
        const referenceNo = String(draft.invoice_number || piName || draftId).trim().slice(0, 140);
        const referenceDate = String(billDate || postingDate).slice(0, 10);
        const payCreateRes = await createErpNextDoc(baseUrl, apiKey, apiSecret, 'Payment Entry', {
          payment_type: isCreditMemo ? 'Receive' : 'Pay',
          company,
          posting_date: postingDate,
          set_posting_time: 1,
          party_type: 'Supplier',
          party: supplierPartyName,
          paid_from: isCreditMemo ? payableAccount : creditAccount,
          paid_to: isCreditMemo ? creditAccount : payableAccount,
          paid_amount: paymentAmount,
          received_amount: paymentAmount,
          reference_no: referenceNo,
          reference_date: referenceDate,
          references: [{
            reference_doctype: 'Purchase Invoice',
            reference_name: piName,
            allocated_amount: paymentAmount,
            outstanding_amount: paymentAmount
          }],
          remarks: `[TAVARI expense pay:${draftId}]`.slice(0, 140)
        });
        if (!payCreateRes.ok || !payCreateRes.name) {
          await releasePostingLock();
          return json({ error: payCreateRes.error || 'Purchase Invoice posted but bank Payment Entry failed. Retry approve to finish payment.' });
        }
        const payDocRes = await fetchErpNextDoc(baseUrl, apiKey, apiSecret, 'Payment Entry', payCreateRes.name);
        if (!payDocRes.ok || !payDocRes.data) {
          await releasePostingLock();
          return json({ error: payDocRes.error || 'Payment Entry created but could not load for submit' });
        }
        const paySubmitRes = await submitErpNextDoc(baseUrl, apiKey, apiSecret, payDocRes.data);
        if (!paySubmitRes.ok) {
          await releasePostingLock();
          return json({ error: `Payment Entry submit failed: ${paySubmitRes.error || 'unknown'}` });
        }
        paymentEntryName = payCreateRes.name;
      } else if (!isCreditMemo) {
        // Cash on hand / clearing / card liabilities are not Bank/Cash types — clear the bill via JE (QBO-style).
        const jeCreateRes = await createErpNextDoc(baseUrl, apiKey, apiSecret, 'Journal Entry', {
          doctype: 'Journal Entry',
          voucher_type: 'Journal Entry',
          company,
          posting_date: postingDate,
          user_remark: `[TAVARI expense clear:${draftId}] ${supplierPartyName}`.slice(0, 140),
          accounts: [
            {
              account: payableAccount,
              debit_in_account_currency: paymentAmount,
              credit_in_account_currency: 0,
              party_type: 'Supplier',
              party: supplierPartyName,
              reference_type: 'Purchase Invoice',
              reference_name: piName,
            },
            {
              account: creditAccount,
              debit_in_account_currency: 0,
              credit_in_account_currency: paymentAmount,
            },
          ],
        });
        if (!jeCreateRes.ok || !jeCreateRes.name) {
          await releasePostingLock();
          return json({
            error: jeCreateRes.error || `Purchase Invoice posted but clearing Journal Entry against "${creditAccount}" failed.`,
          });
        }
        const jeDocRes = await fetchErpNextDoc(baseUrl, apiKey, apiSecret, 'Journal Entry', jeCreateRes.name);
        if (!jeDocRes.ok || !jeDocRes.data) {
          await releasePostingLock();
          return json({ error: jeDocRes.error || 'Clearing Journal Entry created but could not load for submit' });
        }
        const jeSubmitRes = await submitErpNextDoc(baseUrl, apiKey, apiSecret, jeDocRes.data);
        if (!jeSubmitRes.ok) {
          await releasePostingLock();
          return json({ error: `Clearing Journal Entry submit failed: ${jeSubmitRes.error || 'unknown'}` });
        }
        clearingJournalEntryName = jeCreateRes.name;
      }
    }

    let { error: updateErr } = await supabaseAdmin
      .from('accounting_draft_expenses')
      .update({
        status: 'posted',
        approved_by: userId,
        approved_at: new Date().toISOString(),
        erpnext_purchase_invoice_id: piName,
        erpnext_payment_entry_id: paymentEntryName,
        erpnext_journal_entry_id: clearingJournalEntryName
      })
      .eq('id', draftId)
      .eq('business_id', businessId);
    if (updateErr) {
      const retryResult = await supabaseAdmin
        .from('accounting_draft_expenses')
        .update({
          status: 'posted',
          approved_by: userId,
          approved_at: new Date().toISOString(),
          erpnext_purchase_invoice_id: piName,
          erpnext_payment_entry_id: paymentEntryName,
          erpnext_journal_entry_id: clearingJournalEntryName
        })
        .eq('id', draftId)
        .eq('business_id', businessId);
      updateErr = retryResult.error;
    }
    if (updateErr) {
      claimedDraftForPosting = null;
      return json({ error: `ERPNext posted successfully as ${piName}, but Tavari could not finalize the draft status. Refresh before retrying.` }, 500);
    }

    let fixedAssetId: string | null = draft.fixed_asset_id || null;
    if (isFixedAsset) {
      const serviceDate = String(draft.invoice_date || draft.transaction_date || postingDate).slice(0, 10);
      const years = Number(draft.asset_useful_life_years) || 5;
      const usefulLifeMonths = Math.max(1, Math.round(years * 12));
      const assetCost = subtotalAbs;
      const assetName = String(draft.asset_name || vendorDisplayName).trim();
      const { data: assetRow, error: assetErr } = await supabaseAdmin
        .from('accounting_fixed_assets')
        .insert({
          business_id: businessId,
          name: assetName,
          description: draft.invoice_number ? `From invoice ${draft.invoice_number}` : null,
          cost: assetCost,
          salvage_value: Math.max(0, Number(draft.asset_salvage_value) || 0),
          service_date: serviceDate,
          useful_life_months: usefulLifeMonths,
          gl_asset_account_erpnext: assetGlBase,
          gl_depreciation_expense_account_erpnext: (config.depreciation_expense_account_erpnext as string)?.trim() || null,
          gl_accumulated_depreciation_account_erpnext: (config.accumulated_depreciation_account_erpnext as string)?.trim() || null,
          draft_expense_id: draftId,
          erpnext_purchase_invoice_id: piName,
          status: 'active'
        })
        .select('id')
        .single();
      if (assetErr || !assetRow?.id) {
        return json({
          error: `Purchase Invoice ${piName} posted, but Tavari could not create the fixed asset record: ${assetErr?.message || 'unknown error'}`
        }, 500);
      }
      fixedAssetId = assetRow.id;
      await supabaseAdmin
        .from('accounting_draft_expenses')
        .update({ fixed_asset_id: fixedAssetId })
        .eq('id', draftId)
        .eq('business_id', businessId);
    }

    claimedDraftForPosting = null;

    return json({
      success: true,
      erpnext_purchase_invoice_id: piName,
      erpnext_payment_entry_id: paymentEntryName,
      erpnext_journal_entry_id: clearingJournalEntryName,
      fixed_asset_id: fixedAssetId
    });
  } catch (e) {
    console.error(e);
    if (claimedDraftForPosting && !erpnextSubmitted) {
      try {
        const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        await supabaseAdmin
          .from('accounting_draft_expenses')
          .update({ status: claimedDraftForPosting.priorStatus || 'draft' })
          .eq('id', claimedDraftForPosting.draftId)
          .eq('business_id', claimedDraftForPosting.businessId)
          .eq('status', 'posting');
      } catch (_) {}
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
