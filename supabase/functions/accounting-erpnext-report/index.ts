// Fetches P&L, HST, Balance Sheet, GST34 worksheet, or CRA Summary from ERPNext for a business.
// Call with: POST body { business_id, report_type: 'pl' | 'hst' | 'cra_summary' | 'balance_sheet' | 'gst34' | 'gl_drilldown', from_date?, to_date?, account_name? (for gl_drilldown) }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callErpNext, appendCompanySuffix, sumGlEntryNetDebitsForAccount } from '../_shared/erpnext.ts';
import { deriveGst34Worksheet, normalizeHstSummary } from '../_shared/gst34Worksheet.ts';

function runPlReport(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  company: string,
  fromDate: string,
  toDate: string
) {
  return callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/method/frappe.desk.query_report.run', {
    report_name: 'Profit and Loss Statement',
    filters: {
      company: company || undefined,
      filter_based_on: 'Date Range',
      period_start_date: fromDate,
      period_end_date: toDate,
      periodicity: 'Monthly',
      accumulated_values: 0
    }
  });
}

function runHstReport(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  company: string,
  fromDate: string,
  toDate: string
) {
  return callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/method/frappe.desk.query_report.run', {
    report_name: 'General Ledger',
    filters: { company: company || undefined, from_date: fromDate, to_date: toDate }
  });
}

function runBalanceSheetReport(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  company: string,
  toDate: string,
  fiscalYearEndMonth?: number | null,
  fiscalYearEndDay?: number | null
) {
  const [year, month, day] = toDate.split('-').map(Number);
  const endMonth = fiscalYearEndMonth || month;
  const endDay = fiscalYearEndDay || day;
  const previousFiscalEnd = new Date(Date.UTC(year - 1, Math.max(0, endMonth - 1), endDay));
  previousFiscalEnd.setUTCDate(previousFiscalEnd.getUTCDate() + 1);
  const periodStartDate = previousFiscalEnd.toISOString().slice(0, 10);
  return callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/method/frappe.desk.query_report.run', {
    report_name: 'Balance Sheet',
    filters: {
      company: company || undefined,
      filter_based_on: 'Date Range',
      period_start_date: periodStartDate,
      period_end_date: toDate,
      periodicity: 'Yearly',
      accumulated_values: 1
    }
  });
}

function runGenericReport(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  reportName: string,
  filters: Record<string, unknown>
) {
  return callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/method/frappe.desk.query_report.run', {
    report_name: reportName,
    filters
  });
}

async function fetchResourceList(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  resourceName: string,
  fields: string[],
  filters?: unknown[],
  orderBy = 'modified desc',
  limit = 25,
  offset = 0
) {
  const resource = encodeURIComponent(resourceName);
  const fieldsEnc = encodeURIComponent(JSON.stringify(fields));
  const filtersEnc = encodeURIComponent(JSON.stringify(filters || []));
  const orderByEnc = encodeURIComponent(orderBy);
  return callErpNext(
    baseUrl,
    apiKey,
    apiSecret,
    'GET',
    `/api/resource/${resource}?fields=${fieldsEnc}&filters=${filtersEnc}&order_by=${orderByEnc}&limit_page_length=${limit}&limit_start=${offset}`
  );
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const json = (obj: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Unauthorized' });
    }

    const body = (await req.json().catch(() => ({}))) as {
      business_id?: string;
      report_type?: string;
      from_date?: string;
      to_date?: string;
      account_name?: string;
      filter_party?: string;
      outstanding_only?: boolean;
      limit?: number;
      offset?: number;
    };
    const businessId = body?.business_id;
    const reportType = body?.report_type || 'pl';
    const filterParty = (body?.filter_party || '').trim();
    const outstandingOnly = body?.outstanding_only === true;
    const limit = Number.isFinite(Number(body?.limit)) ? Math.max(1, Math.min(100, Number(body?.limit))) : 25;
    const offset = Number.isFinite(Number(body?.offset)) ? Math.max(0, Number(body?.offset)) : 0;
    if (!businessId) {
      return json({ error: 'Missing business_id' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
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
      .limit(1)
      .maybeSingle();
    if (!membership) {
      return json({ error: 'Access denied to this business' });
    }

    const { data: config, error: configErr } = await supabaseAdmin
      .from('accounting_business_config')
      .select('erpnext_api_url, erpnext_company_name, erpnext_company_abbr, erpnext_api_key, erpnext_secret, pos_revenue_account_erpnext, bookings_revenue_account_erpnext, hst_collected_account_erpnext, hst_recoverable_account_erpnext, fiscal_year_end_month, fiscal_year_end_day')
      .eq('business_id', businessId)
      .maybeSingle();
    if (configErr || !config) {
      return json({ error: 'Accounting config not found' });
    }
    const baseUrl = (config.erpnext_api_url || '').replace(/\/$/, '');
    const company = config.erpnext_company_name || '';
    const apiKey = config.erpnext_api_key?.trim();
    const apiSecret = config.erpnext_secret?.trim() || '';
    if (!baseUrl) {
      return json({ error: 'ERPNext API URL is missing. In Accounting → Settings, enter the ERPNext URL and API Key/Secret, then Save.' });
    }
    if (!apiKey) {
      return json({
        error: 'Add API Key in ERPNext (User → API Access) and save it in Tavari Accounting Settings.'
      });
    }

    const toDate = body?.to_date || new Date().toISOString().slice(0, 10);
    const fromDate = body?.from_date || toDate.slice(0, 4) + '-01-01';

    if (reportType === 'cra_summary') {
      const [plRes, hstRes, bsRes] = await Promise.all([
        runPlReport(baseUrl, apiKey, apiSecret, company, fromDate, toDate),
        runHstReport(baseUrl, apiKey, apiSecret, company, fromDate, toDate),
        runBalanceSheetReport(
          baseUrl,
          apiKey,
          apiSecret,
          company,
          toDate,
          Number(config.fiscal_year_end_month || 0) || null,
          Number(config.fiscal_year_end_day || 0) || null
        )
      ]);
      const plData = plRes.data as Record<string, unknown> | undefined;
      const hstData = hstRes.data as Record<string, unknown> | undefined;
      const plMessage = plData?.message as Record<string, unknown> | undefined;
      const hstMessage = hstData?.message as Record<string, unknown> | undefined;
      if (!plRes.ok) return json({ error: plRes.error || 'P&L request failed' });
      if (!hstRes.ok) return json({ error: hstRes.error || 'HST/GL request failed' });
      const bsData = bsRes.ok ? (bsRes.data as Record<string, unknown> | undefined) : undefined;
      const bsMessage = bsData?.message as Record<string, unknown> | undefined;
      const hstRows = (hstMessage?.result ?? hstData) as unknown[];
      const hstWorksheet = deriveGst34Worksheet(
        Array.isArray(hstRows) ? hstRows : [],
        hstMessage?.columns as Array<{ fieldname?: string; label?: string }> | undefined,
        {
          revenueAccounts: [config.pos_revenue_account_erpnext, config.bookings_revenue_account_erpnext].filter(Boolean),
          hstCollectedAccounts: [config.hst_collected_account_erpnext].filter(Boolean),
          hstRecoverableAccounts: [config.hst_recoverable_account_erpnext].filter(Boolean)
        }
      );
      const warnings = [];
      if (!bsRes.ok) {
        warnings.push('Balance Sheet could not be loaded from ERPNext. CRA summary is incomplete until that report succeeds.');
      }
      warnings.push(...hstWorksheet.warnings);
      const worksheet = { ...hstWorksheet.worksheet };
      const companyAbbr = (config.erpnext_company_abbr || '').trim();
      if (companyAbbr) {
        const collectedLogical = (config.hst_collected_account_erpnext || '').trim();
        const recoverableLogical = (config.hst_recoverable_account_erpnext || '').trim();
        if (collectedLogical) {
          const collectedRes = await sumGlEntryNetDebitsForAccount(
            baseUrl, apiKey, apiSecret, company, appendCompanySuffix(collectedLogical, companyAbbr), fromDate, toDate,
          );
          if (collectedRes.ok) {
            worksheet.hst_collected = Math.round(Math.max(0, -collectedRes.netDebits) * 100) / 100;
            worksheet.box_103 = worksheet.hst_collected;
          }
        }
        if (recoverableLogical) {
          const recoverableRes = await sumGlEntryNetDebitsForAccount(
            baseUrl, apiKey, apiSecret, company, appendCompanySuffix(recoverableLogical, companyAbbr), fromDate, toDate,
          );
          if (recoverableRes.ok) {
            worksheet.hst_recoverable = Math.round(Math.max(0, recoverableRes.netDebits) * 100) / 100;
            worksheet.box_106 = worksheet.hst_recoverable;
          }
        }
        worksheet.box_109 = Math.round((worksheet.box_103 - worksheet.box_106) * 100) / 100;
      }
      return json({
        report_type: 'cra_summary',
        period: { from_date: fromDate, to_date: toDate },
        pl: { result: plMessage?.result ?? plData, columns: plMessage?.columns },
        hst: { result: hstRows, columns: hstMessage?.columns },
        hst_summary: normalizeHstSummary(worksheet),
        hst_worksheet: worksheet,
        balance_sheet: bsRes.ok ? { result: bsMessage?.result ?? bsData, columns: bsMessage?.columns } : undefined,
        warnings
      });
    }

    if (reportType === 'gl_drilldown') {
      const accountName = (body?.account_name ?? '').toString().trim();
      if (!accountName) return json({ error: 'Missing account_name for drill-down' });
      // Fetch actual GL Entry rows (transaction-level), not the report summary
      const filters = [
        ['account', '=', accountName],
        ['posting_date', '>=', fromDate],
        ['posting_date', '<=', toDate],
        ...(company ? [['company', '=', company]] : [])
      ];
      const fields = [
        'posting_date',
        'voucher_type',
        'voucher_no',
        'debit_in_account_currency',
        'credit_in_account_currency',
        'against',
        'party_type',
        'party',
        'remarks'
      ];
      const filtersEnc = encodeURIComponent(JSON.stringify(filters));
      const fieldsEnc = encodeURIComponent(JSON.stringify(fields));
      const glResource = encodeURIComponent('GL Entry');
      const glRes = await callErpNext(
        baseUrl,
        apiKey,
        apiSecret,
        'GET',
        `/api/resource/${glResource}?filters=${filtersEnc}&fields=${fieldsEnc}&limit_page_length=500&order_by=posting_date asc`
      );
      if (!glRes.ok) return json({ error: glRes.error || 'GL drill-down request failed' });
      const glPayload = glRes.data as { data?: Record<string, unknown>[] };
      const rows = Array.isArray(glPayload?.data) ? glPayload.data : [];
      const columns = [
        { fieldname: 'posting_date', label: 'Date' },
        { fieldname: 'voucher_type', label: 'Type' },
        { fieldname: 'voucher_no', label: 'Reference' },
        { fieldname: 'debit_in_account_currency', label: 'Debit' },
        { fieldname: 'credit_in_account_currency', label: 'Credit' },
        { fieldname: 'against', label: 'Against' },
        { fieldname: 'party', label: 'Party' },
        { fieldname: 'remarks', label: 'Remarks' }
      ];
      return json({
        report_type: 'gl_drilldown',
        account_name: accountName,
        period: { from_date: fromDate, to_date: toDate },
        result: rows,
        columns
      });
    }

    if (reportType === 'balance_sheet') {
      const bsRes = await runBalanceSheetReport(
        baseUrl,
        apiKey,
        apiSecret,
        company,
        toDate,
        Number(config.fiscal_year_end_month || 0) || null,
        Number(config.fiscal_year_end_day || 0) || null
      );
      if (!bsRes.ok) return json({ error: bsRes.error || 'Balance Sheet request failed' });
      const data = bsRes.data as Record<string, unknown> | undefined;
      const message = data?.message as Record<string, unknown> | undefined;
      return json({
        report_type: 'balance_sheet',
        period: { to_date: toDate },
        result: message?.result ?? data,
        columns: message?.columns
      });
    }

    if (reportType === 'ap_workspace') {
      const [agingRes, invoicesRes, paymentsRes] = await Promise.all([
        runGenericReport(baseUrl, apiKey, apiSecret, 'Accounts Payable', {
          company: company || undefined,
          report_date: toDate,
          ageing_based_on: 'Due Date',
          range1: 30,
          range2: 60,
          range3: 90,
          range4: 120
        }),
        fetchResourceList(
          baseUrl,
          apiKey,
          apiSecret,
          'Purchase Invoice',
          ['name', 'supplier', 'posting_date', 'due_date', 'bill_no', 'grand_total', 'outstanding_amount', 'status'],
          [
            ...(company ? [['company', '=', company]] : []),
            ...(filterParty ? [['supplier', 'like', `%${filterParty}%`]] : []),
            ...(outstandingOnly ? [['outstanding_amount', '>', 0]] : [])
          ],
          'posting_date desc',
          limit,
          offset
        ),
        fetchResourceList(
          baseUrl,
          apiKey,
          apiSecret,
          'Payment Entry',
          ['name', 'party_type', 'party', 'posting_date', 'paid_amount', 'received_amount', 'paid_from', 'paid_to', 'docstatus'],
          [
            ['payment_type', '=', 'Pay'],
            ...(company ? [['company', '=', company]] : []),
            ...(filterParty ? [['party', 'like', `%${filterParty}%`]] : [])
          ],
          'posting_date desc',
          limit,
          offset
        )
      ]);
      if (!agingRes.ok) return json({ error: agingRes.error || 'Accounts Payable request failed' });
      if (!invoicesRes.ok) return json({ error: invoicesRes.error || 'Purchase Invoice request failed' });
      if (!paymentsRes.ok) return json({ error: paymentsRes.error || 'Payment Entry request failed' });
      const agingData = agingRes.data as Record<string, unknown> | undefined;
      const agingMessage = agingData?.message as Record<string, unknown> | undefined;
      const invoicesData = invoicesRes.data as { data?: Record<string, unknown>[] } | undefined;
      const paymentsData = paymentsRes.data as { data?: Record<string, unknown>[] } | undefined;
      return json({
        report_type: 'ap_workspace',
        period: { to_date: toDate },
        aging: { result: agingMessage?.result ?? agingData, columns: agingMessage?.columns },
        purchase_invoices: invoicesData?.data || [],
        purchase_invoice_columns: [
          { fieldname: 'name', label: 'Invoice' },
          { fieldname: 'supplier', label: 'Supplier' },
          { fieldname: 'posting_date', label: 'Posting Date' },
          { fieldname: 'due_date', label: 'Due Date' },
          { fieldname: 'bill_no', label: 'Vendor Bill #' },
          { fieldname: 'grand_total', label: 'Grand Total' },
          { fieldname: 'outstanding_amount', label: 'Outstanding' },
          { fieldname: 'status', label: 'Status' }
        ],
        payments: paymentsData?.data || [],
        filters: { filter_party: filterParty || null, outstanding_only: outstandingOnly, limit, offset },
        pagination: {
          invoices_has_more: (invoicesData?.data || []).length === limit,
          payments_has_more: (paymentsData?.data || []).length === limit,
          limit,
          offset
        },
        payment_columns: [
          { fieldname: 'name', label: 'Payment Entry' },
          { fieldname: 'party_type', label: 'Party Type' },
          { fieldname: 'party', label: 'Party' },
          { fieldname: 'posting_date', label: 'Posting Date' },
          { fieldname: 'paid_amount', label: 'Paid Amount' },
          { fieldname: 'paid_from', label: 'Paid From' },
          { fieldname: 'paid_to', label: 'Paid To' },
          { fieldname: 'docstatus', label: 'Docstatus' }
        ]
      });
    }

    if (reportType === 'ar_workspace') {
      const [agingRes, invoicesRes, paymentsRes] = await Promise.all([
        runGenericReport(baseUrl, apiKey, apiSecret, 'Accounts Receivable', {
          company: company || undefined,
          report_date: toDate,
          ageing_based_on: 'Due Date',
          range1: 30,
          range2: 60,
          range3: 90,
          range4: 120
        }),
        fetchResourceList(
          baseUrl,
          apiKey,
          apiSecret,
          'Sales Invoice',
          ['name', 'customer', 'posting_date', 'due_date', 'grand_total', 'outstanding_amount', 'status'],
          [
            ...(company ? [['company', '=', company]] : []),
            ...(filterParty ? [['customer', 'like', `%${filterParty}%`]] : []),
            ...(outstandingOnly ? [['outstanding_amount', '>', 0]] : [])
          ],
          'posting_date desc',
          limit,
          offset
        ),
        fetchResourceList(
          baseUrl,
          apiKey,
          apiSecret,
          'Payment Entry',
          ['name', 'party_type', 'party', 'posting_date', 'paid_amount', 'received_amount', 'paid_from', 'paid_to', 'docstatus'],
          [
            ['payment_type', '=', 'Receive'],
            ...(company ? [['company', '=', company]] : []),
            ...(filterParty ? [['party', 'like', `%${filterParty}%`]] : [])
          ],
          'posting_date desc',
          limit,
          offset
        )
      ]);
      if (!agingRes.ok) return json({ error: agingRes.error || 'Accounts Receivable request failed' });
      if (!invoicesRes.ok) return json({ error: invoicesRes.error || 'Sales Invoice request failed' });
      if (!paymentsRes.ok) return json({ error: paymentsRes.error || 'Payment Entry request failed' });
      const agingData = agingRes.data as Record<string, unknown> | undefined;
      const agingMessage = agingData?.message as Record<string, unknown> | undefined;
      const invoicesData = invoicesRes.data as { data?: Record<string, unknown>[] } | undefined;
      const paymentsData = paymentsRes.data as { data?: Record<string, unknown>[] } | undefined;
      return json({
        report_type: 'ar_workspace',
        period: { to_date: toDate },
        aging: { result: agingMessage?.result ?? agingData, columns: agingMessage?.columns },
        sales_invoices: invoicesData?.data || [],
        sales_invoice_columns: [
          { fieldname: 'name', label: 'Invoice' },
          { fieldname: 'customer', label: 'Customer' },
          { fieldname: 'posting_date', label: 'Posting Date' },
          { fieldname: 'due_date', label: 'Due Date' },
          { fieldname: 'grand_total', label: 'Grand Total' },
          { fieldname: 'outstanding_amount', label: 'Outstanding' },
          { fieldname: 'status', label: 'Status' }
        ],
        payments: paymentsData?.data || [],
        filters: { filter_party: filterParty || null, outstanding_only: outstandingOnly, limit, offset },
        pagination: {
          invoices_has_more: (invoicesData?.data || []).length === limit,
          payments_has_more: (paymentsData?.data || []).length === limit,
          limit,
          offset
        },
        payment_columns: [
          { fieldname: 'name', label: 'Payment Entry' },
          { fieldname: 'party_type', label: 'Party Type' },
          { fieldname: 'party', label: 'Party' },
          { fieldname: 'posting_date', label: 'Posting Date' },
          { fieldname: 'received_amount', label: 'Received Amount' },
          { fieldname: 'paid_from', label: 'Paid From' },
          { fieldname: 'paid_to', label: 'Paid To' },
          { fieldname: 'docstatus', label: 'Docstatus' }
        ]
      });
    }

    if (reportType === 'general_ledger') {
      const glRes = await runGenericReport(baseUrl, apiKey, apiSecret, 'General Ledger', {
        company: company || undefined,
        from_date: fromDate,
        to_date: toDate
      });
      if (!glRes.ok) return json({ error: glRes.error || 'General Ledger request failed' });
      const data = glRes.data as Record<string, unknown> | undefined;
      const message = data?.message as Record<string, unknown> | undefined;
      return json({
        report_type: 'general_ledger',
        period: { from_date: fromDate, to_date: toDate },
        result: message?.result ?? data,
        columns: message?.columns
      });
    }

    if (reportType === 'trial_balance') {
      const tbRes = await runGenericReport(baseUrl, apiKey, apiSecret, 'Trial Balance', {
        company: company || undefined,
        from_date: fromDate,
        to_date: toDate,
        periodicity: 'Monthly'
      });
      if (!tbRes.ok) return json({ error: tbRes.error || 'Trial Balance request failed' });
      const data = tbRes.data as Record<string, unknown> | undefined;
      const message = data?.message as Record<string, unknown> | undefined;
      return json({
        report_type: 'trial_balance',
        period: { from_date: fromDate, to_date: toDate },
        result: message?.result ?? data,
        columns: message?.columns
      });
    }

    if (reportType === 'ap_aging' || reportType === 'ar_aging') {
      const reportName = reportType === 'ap_aging' ? 'Accounts Payable' : 'Accounts Receivable';
      const agingRes = await runGenericReport(baseUrl, apiKey, apiSecret, reportName, {
        company: company || undefined,
        report_date: toDate,
        ageing_based_on: 'Due Date',
        range1: 30,
        range2: 60,
        range3: 90,
        range4: 120
      });
      if (!agingRes.ok) return json({ error: agingRes.error || `${reportName} request failed` });
      const data = agingRes.data as Record<string, unknown> | undefined;
      const message = data?.message as Record<string, unknown> | undefined;
      return json({
        report_type: reportType,
        period: { to_date: toDate },
        result: message?.result ?? data,
        columns: message?.columns
      });
    }

    if (reportType === 'gst34') {
      const hstRes = await runHstReport(baseUrl, apiKey, apiSecret, company, fromDate, toDate);
      if (!hstRes.ok) return json({ error: hstRes.error || 'GL request failed for GST34' });
      const hstData = hstRes.data as Record<string, unknown> | undefined;
      const hstMessage = hstData?.message as Record<string, unknown> | undefined;
      const glRows = (hstMessage?.result ?? hstData) as unknown[];
      const worksheetResult = deriveGst34Worksheet(Array.isArray(glRows) ? glRows : [], hstMessage?.columns as Array<{ fieldname?: string; label?: string }> | undefined, {
        revenueAccounts: [config.pos_revenue_account_erpnext, config.bookings_revenue_account_erpnext].filter(Boolean),
        hstCollectedAccounts: [config.hst_collected_account_erpnext].filter(Boolean),
        hstRecoverableAccounts: [config.hst_recoverable_account_erpnext].filter(Boolean)
      });
      return json({
        report_type: 'gst34',
        period: { from_date: fromDate, to_date: toDate },
        worksheet: worksheetResult.worksheet,
        warnings: worksheetResult.warnings,
        gl_result: glRows,
        gl_columns: hstMessage?.columns
      });
    }

    const reportName = reportType === 'hst' ? 'General Ledger' : 'Profit and Loss Statement';
    const filters: Record<string, string | number | undefined> =
      reportType === 'hst'
        ? { company: company || undefined, from_date: fromDate, to_date: toDate }
        : {
            company: company || undefined,
            filter_based_on: 'Date Range',
            period_start_date: fromDate,
            period_end_date: toDate,
            periodicity: 'Monthly',
            accumulated_values: 0
          };
    const result = await callErpNext(
      baseUrl,
      apiKey,
      apiSecret,
      'POST',
      '/api/method/frappe.desk.query_report.run',
      { report_name: reportName, filters }
    );

    if (!result.ok) {
      return json({ error: result.error || 'ERPNext request failed' });
    }

    const data = result.data as Record<string, unknown> | undefined;
    const message = data?.message as Record<string, unknown> | undefined;
    const resultRows = message?.result ?? data;
    const warnings = reportType === 'hst' && !config.hst_collected_account_erpnext && !config.hst_recoverable_account_erpnext
      ? ['HST report is using General Ledger detail without explicit HST account mappings from Accounting Settings.']
      : [];
    const hstWorksheet = reportType === 'hst'
      ? deriveGst34Worksheet(Array.isArray(resultRows) ? resultRows : [], message?.columns as Array<{ fieldname?: string; label?: string }> | undefined, {
          revenueAccounts: [config.pos_revenue_account_erpnext, config.bookings_revenue_account_erpnext].filter(Boolean),
          hstCollectedAccounts: [config.hst_collected_account_erpnext].filter(Boolean),
          hstRecoverableAccounts: [config.hst_recoverable_account_erpnext].filter(Boolean)
        })
      : null;
    return json({
      report_type: reportType,
      period: reportType === 'hst' ? { from_date: fromDate, to_date: toDate } : undefined,
      result: resultRows,
      columns: message?.columns,
      summary: hstWorksheet ? normalizeHstSummary(hstWorksheet.worksheet) : undefined,
      worksheet: hstWorksheet?.worksheet,
      warnings: hstWorksheet ? [...warnings, ...hstWorksheet.warnings.filter((warning) => !warnings.includes(warning))] : warnings,
      raw: data
    });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) });
  }
});
