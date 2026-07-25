import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  callErpNext,
  createErpNextDoc,
  ensureCustomerInErpNext,
  ensureSupplierInErpNext,
  fetchCompanyAbbreviation,
  fetchErpNextDoc,
  fetchAccountNamesForCompany,
  resolveLedgerAccount,
  submitErpNextDoc,
} from '../_shared/erpnext.ts';
import { syncOpenInvoiceToErpNext } from '../_shared/invoiceErpNextSync.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(obj: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function asMoney(value: unknown) {
  const amount = Number(value);
  if (Number.isNaN(amount) || amount <= 0) return null;
  return Math.round(amount * 100) / 100;
}

function safeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function numericValue(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

async function getErpConfig(supabaseAdmin: ReturnType<typeof createClient>, businessId: string) {
  const { data: config, error } = await supabaseAdmin
    .from('accounting_business_config')
    .select('erpnext_api_url, erpnext_company_name, erpnext_company_abbr, erpnext_api_key, erpnext_secret, default_bank_account_erpnext, accounts_payable_account_erpnext, pos_revenue_account_erpnext, bookings_revenue_account_erpnext')
    .eq('business_id', businessId)
    .maybeSingle();
  if (error || !config) return { ok: false, error: 'Accounting config not found' };
  const baseUrl = safeText(config.erpnext_api_url).replace(/\/$/, '');
  const apiKey = safeText(config.erpnext_api_key);
  const apiSecret = safeText(config.erpnext_secret);
  let company = safeText(config.erpnext_company_name) || 'Company';
  let abbr = safeText(config.erpnext_company_abbr);
  if (!baseUrl || !apiKey) return { ok: false, error: 'ERPNext connection is incomplete in Accounting Settings' };
  if (!abbr) {
    const fetched = await fetchCompanyAbbreviation(baseUrl, apiKey, apiSecret, company === 'Company' ? undefined : company);
    if (!fetched.ok || !fetched.abbreviation) {
      return { ok: false, error: fetched.error || 'Could not determine ERPNext company abbreviation' };
    }
    abbr = fetched.abbreviation;
    company = fetched.companyName || company;
  }
  const accountsRes = await fetchAccountNamesForCompany(baseUrl, apiKey, apiSecret, company);
  if (!accountsRes.ok || !accountsRes.accounts?.length) {
    return { ok: false, error: accountsRes.error || 'Could not load ERPNext chart of accounts' };
  }
  return {
    ok: true,
    config,
    baseUrl,
    apiKey,
    apiSecret,
    company,
    abbr,
    accounts: accountsRes.accounts,
  };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const body = (await req.json().catch(() => ({}))) as {
      business_id?: string;
      action?: string;
      payload?: Record<string, unknown>;
    };
    const businessId = body?.business_id;
    const action = safeText(body?.action);
    const payload = body?.payload || {};
    if (!businessId || !action) return json({ error: 'Missing business_id or action' }, 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user } } = await supabaseUser.auth.getUser();
    const userId = user?.id;
    const { data: membership } = await supabaseUser
      .from('business_users')
      .select('user_id, role')
      .eq('business_id', businessId)
      .eq('user_id', userId)
      .in('role', ['owner', 'manager', 'admin'])
      .maybeSingle();
    if (!membership) return json({ error: 'Access denied to this business' }, 403);

    const erp = await getErpConfig(supabaseAdmin, businessId);
    if (!erp.ok) return json({ error: erp.error || 'ERPNext configuration failed' }, 400);

    const suffix = ` - ${erp.abbr}`;
    const defaultBankLogical = safeText(erp.config?.default_bank_account_erpnext) || 'Bank';
    const defaultApLogical = safeText(erp.config?.accounts_payable_account_erpnext) || 'Accounts Payable';
    const defaultRevenueLogical = safeText(erp.config?.pos_revenue_account_erpnext) || safeText(erp.config?.bookings_revenue_account_erpnext) || 'Sales';

    if (action === 'create_purchase_invoice') {
      const supplierInput = safeText(payload.supplier_name);
      const amount = asMoney(payload.amount);
      const expenseAccountInput = safeText(payload.expense_account);
      const postingDate = safeText(payload.posting_date) || new Date().toISOString().slice(0, 10);
      const dueDate = safeText(payload.due_date) || postingDate;
      const description = safeText(payload.description) || supplierInput || 'Vendor bill';
      const billNo = safeText(payload.bill_no);
      if (!supplierInput || !amount || !expenseAccountInput) {
        return json({ error: 'Supplier, amount, and expense account are required' }, 400);
      }
      const supplierRes = await ensureSupplierInErpNext(erp.baseUrl, erp.apiKey, erp.apiSecret, supplierInput);
      if (!supplierRes.ok || !supplierRes.partyName) return json({ error: supplierRes.error || 'Could not create ERPNext supplier' }, 400);
      const expenseAccount = resolveLedgerAccount(erp.accounts, expenseAccountInput);
      if (!expenseAccount) return json({ error: `Could not resolve expense account "${expenseAccountInput}" in ERPNext` }, 400);

      const createRes = await createErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, 'Purchase Invoice', {
        supplier: supplierRes.partyName,
        company: erp.company,
        posting_date: postingDate,
        due_date: dueDate,
        bill_no: billNo || undefined,
        update_stock: 0,
        remarks: safeText(payload.notes) || undefined,
        items: [{
          item_name: description.slice(0, 140),
          description,
          qty: 1,
          rate: amount,
          amount,
          expense_account: expenseAccount,
        }],
      });
      if (!createRes.ok || !createRes.name) return json({ error: createRes.error || 'Failed to create Purchase Invoice' }, 500);
      const docRes = await fetchErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, 'Purchase Invoice', createRes.name);
      if (!docRes.ok || !docRes.data) return json({ error: docRes.error || 'Created Purchase Invoice but could not load it for submit' }, 500);
      const submitRes = await submitErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, docRes.data);
      if (!submitRes.ok) return json({ error: submitRes.error || 'Failed to submit Purchase Invoice' }, 500);
      return json({ success: true, action, doctype: 'Purchase Invoice', name: createRes.name, party: supplierRes.partyName });
    }

    if (action === 'record_ap_payment') {
      const supplierInput = safeText(payload.supplier_name);
      const invoiceName = safeText(payload.purchase_invoice_name);
      const amount = asMoney(payload.amount);
      const postingDate = safeText(payload.posting_date) || new Date().toISOString().slice(0, 10);
      const bankAccountInput = safeText(payload.bank_account) || defaultBankLogical + suffix;
      const payableAccountInput = safeText(payload.payable_account) || defaultApLogical + suffix;
      if (!supplierInput || !amount || !bankAccountInput) {
        return json({ error: 'Supplier, amount, and bank account are required' }, 400);
      }
      const supplierRes = await ensureSupplierInErpNext(erp.baseUrl, erp.apiKey, erp.apiSecret, supplierInput);
      if (!supplierRes.ok || !supplierRes.partyName) return json({ error: supplierRes.error || 'Could not create ERPNext supplier' }, 400);
      const bankAccount = resolveLedgerAccount(erp.accounts, bankAccountInput, [`Bank${suffix}`, `Cash${suffix}`]);
      const payableAccount = resolveLedgerAccount(erp.accounts, payableAccountInput, [`Creditors${suffix}`]);
      if (!bankAccount) return json({ error: `Could not resolve bank account "${bankAccountInput}" in ERPNext` }, 400);
      if (!payableAccount) return json({ error: `Could not resolve payable account "${payableAccountInput}" in ERPNext` }, 400);

      let paymentAmount = amount;
      let references: Record<string, unknown>[] = [];
      if (invoiceName) {
        const invoiceRes = await fetchErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, 'Purchase Invoice', invoiceName);
        if (!invoiceRes.ok || !invoiceRes.data) {
          return json({ error: invoiceRes.error || `Could not load Purchase Invoice "${invoiceName}"` }, 400);
        }
        const outstandingAmount = Math.round(numericValue(invoiceRes.data.outstanding_amount) * 100) / 100;
        if (outstandingAmount <= 0) {
          return json({ error: `Purchase Invoice "${invoiceName}" has no outstanding balance to pay.` }, 400);
        }
        const overage = paymentAmount - outstandingAmount;
        if (overage > 1) {
          return json({ error: `Requested payment exceeds the current outstanding balance on "${invoiceName}". Refresh the workspace and try again.` }, 400);
        }
        paymentAmount = Math.round(Math.min(paymentAmount, outstandingAmount) * 100) / 100;
        references = [{
          reference_doctype: 'Purchase Invoice',
          reference_name: invoiceName,
          allocated_amount: paymentAmount,
          outstanding_amount: outstandingAmount,
          total_amount: Math.round(numericValue(invoiceRes.data.grand_total) * 100) / 100 || undefined,
          due_date: safeText(invoiceRes.data.due_date),
        }];
      }

      const createRes = await createErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, 'Payment Entry', {
        payment_type: 'Pay',
        company: erp.company,
        posting_date: postingDate,
        party_type: 'Supplier',
        party: supplierRes.partyName,
        paid_from: bankAccount,
        paid_to: payableAccount,
        paid_amount: paymentAmount,
        received_amount: paymentAmount,
        reference_no: invoiceName || `TAVARI-${Date.now()}`,
        reference_date: postingDate,
        references,
        remarks: safeText(payload.notes) || undefined,
      });
      if (!createRes.ok || !createRes.name) return json({ error: createRes.error || 'Failed to create Payment Entry' }, 500);
      const docRes = await fetchErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, 'Payment Entry', createRes.name);
      if (!docRes.ok || !docRes.data) return json({ error: docRes.error || 'Created Payment Entry but could not load it for submit' }, 500);
      const submitRes = await submitErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, docRes.data);
      if (!submitRes.ok) return json({ error: submitRes.error || 'Failed to submit Payment Entry' }, 500);
      return json({ success: true, action, doctype: 'Payment Entry', name: createRes.name, party: supplierRes.partyName, reference_name: invoiceName || null });
    }

    if (action === 'create_sales_invoice') {
      const customerInput = safeText(payload.customer_name);
      const amount = asMoney(payload.amount);
      const incomeAccountInput = safeText(payload.income_account) || defaultRevenueLogical + suffix;
      const postingDate = safeText(payload.posting_date) || new Date().toISOString().slice(0, 10);
      const dueDate = safeText(payload.due_date) || postingDate;
      const description = safeText(payload.description) || customerInput || 'Customer invoice';
      if (!customerInput || !amount || !incomeAccountInput) {
        return json({ error: 'Customer, amount, and income account are required' }, 400);
      }
      const customerRes = await ensureCustomerInErpNext(erp.baseUrl, erp.apiKey, erp.apiSecret, customerInput);
      if (!customerRes.ok || !customerRes.partyName) return json({ error: customerRes.error || 'Could not create ERPNext customer' }, 400);
      const incomeAccount = resolveLedgerAccount(erp.accounts, incomeAccountInput);
      if (!incomeAccount) return json({ error: `Could not resolve income account "${incomeAccountInput}" in ERPNext` }, 400);

      const createRes = await createErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, 'Sales Invoice', {
        customer: customerRes.partyName,
        company: erp.company,
        posting_date: postingDate,
        due_date: dueDate,
        update_stock: 0,
        remarks: safeText(payload.notes) || undefined,
        items: [{
          item_name: description.slice(0, 140),
          description,
          qty: 1,
          rate: amount,
          amount,
          income_account: incomeAccount,
        }],
      });
      if (!createRes.ok || !createRes.name) return json({ error: createRes.error || 'Failed to create Sales Invoice' }, 500);
      const docRes = await fetchErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, 'Sales Invoice', createRes.name);
      if (!docRes.ok || !docRes.data) return json({ error: docRes.error || 'Created Sales Invoice but could not load it for submit' }, 500);
      const submitRes = await submitErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, docRes.data);
      if (!submitRes.ok) return json({ error: submitRes.error || 'Failed to submit Sales Invoice' }, 500);
      return json({ success: true, action, doctype: 'Sales Invoice', name: createRes.name, party: customerRes.partyName });
    }

    if (action === 'record_ar_payment') {
      const customerInput = safeText(payload.customer_name);
      const invoiceName = safeText(payload.sales_invoice_name);
      const amount = asMoney(payload.amount);
      const postingDate = safeText(payload.posting_date) || new Date().toISOString().slice(0, 10);
      const bankAccountInput = safeText(payload.bank_account) || defaultBankLogical + suffix;
      const receivableAccountInput = safeText(payload.receivable_account) || `Debtors${suffix}`;
      if (!customerInput || !amount || !bankAccountInput) {
        return json({ error: 'Customer, amount, and bank account are required' }, 400);
      }
      const customerRes = await ensureCustomerInErpNext(erp.baseUrl, erp.apiKey, erp.apiSecret, customerInput);
      if (!customerRes.ok || !customerRes.partyName) return json({ error: customerRes.error || 'Could not create ERPNext customer' }, 400);
      const bankAccount = resolveLedgerAccount(erp.accounts, bankAccountInput, [`Bank${suffix}`, `Cash${suffix}`]);
      const receivableAccount = resolveLedgerAccount(erp.accounts, receivableAccountInput, [`Debtors${suffix}`]);
      if (!bankAccount) return json({ error: `Could not resolve bank account "${bankAccountInput}" in ERPNext` }, 400);
      if (!receivableAccount) return json({ error: `Could not resolve receivable account "${receivableAccountInput}" in ERPNext` }, 400);

      let paymentAmount = amount;
      let references: Record<string, unknown>[] = [];
      if (invoiceName) {
        const invoiceRes = await fetchErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, 'Sales Invoice', invoiceName);
        if (!invoiceRes.ok || !invoiceRes.data) {
          return json({ error: invoiceRes.error || `Could not load Sales Invoice "${invoiceName}"` }, 400);
        }
        const outstandingAmount = Math.round(numericValue(invoiceRes.data.outstanding_amount) * 100) / 100;
        if (outstandingAmount <= 0) {
          return json({ error: `Sales Invoice "${invoiceName}" has no outstanding balance to receive.` }, 400);
        }
        const overage = paymentAmount - outstandingAmount;
        if (overage > 1) {
          return json({ error: `Requested payment exceeds the current outstanding balance on "${invoiceName}". Refresh the workspace and try again.` }, 400);
        }
        paymentAmount = Math.round(Math.min(paymentAmount, outstandingAmount) * 100) / 100;
        references = [{
          reference_doctype: 'Sales Invoice',
          reference_name: invoiceName,
          allocated_amount: paymentAmount,
          outstanding_amount: outstandingAmount,
          total_amount: Math.round(numericValue(invoiceRes.data.grand_total) * 100) / 100 || undefined,
          due_date: safeText(invoiceRes.data.due_date),
        }];
      }

      const createRes = await createErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, 'Payment Entry', {
        payment_type: 'Receive',
        company: erp.company,
        posting_date: postingDate,
        party_type: 'Customer',
        party: customerRes.partyName,
        paid_from: receivableAccount,
        paid_to: bankAccount,
        paid_amount: paymentAmount,
        received_amount: paymentAmount,
        reference_no: invoiceName || `TAVARI-${Date.now()}`,
        reference_date: postingDate,
        references,
        remarks: safeText(payload.notes) || undefined,
      });
      if (!createRes.ok || !createRes.name) return json({ error: createRes.error || 'Failed to create Payment Entry' }, 500);
      const docRes = await fetchErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, 'Payment Entry', createRes.name);
      if (!docRes.ok || !docRes.data) return json({ error: docRes.error || 'Created Payment Entry but could not load it for submit' }, 500);
      const submitRes = await submitErpNextDoc(erp.baseUrl, erp.apiKey, erp.apiSecret, docRes.data);
      if (!submitRes.ok) return json({ error: submitRes.error || 'Failed to submit Payment Entry' }, 500);
      return json({ success: true, action, doctype: 'Payment Entry', name: createRes.name, party: customerRes.partyName, reference_name: invoiceName || null });
    }

    if (action === 'post_tavari_invoice') {
      const tavariInvoiceId = safeText(payload.tavari_invoice_id);
      if (!tavariInvoiceId) return json({ error: 'Missing tavari_invoice_id' }, 400);
      const result = await syncOpenInvoiceToErpNext(supabaseAdmin, tavariInvoiceId, businessId);
      if (!result.ok) return json({ error: result.error }, 400);
      return json({
        success: true,
        action,
        doctype: 'Sales Invoice',
        name: result.salesInvoiceName,
        skipped: result.skipped || false,
      });
    }

    if (action === 'open_document_url') {
      const doctype = safeText(payload.doctype);
      const name = safeText(payload.name);
      if (!doctype || !name) return json({ error: 'Missing doctype or name' }, 400);
      const docUrl = `${erp.baseUrl}/app/${doctype.toLowerCase().replace(/\s+/g, '-')}/${encodeURIComponent(name)}`;
      return json({ success: true, url: docUrl });
    }

    return json({ error: `Unsupported action "${action}"` }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
