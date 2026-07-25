// Posts year-end closing entry: net income to Retained Earnings. POST body: { business_id, fiscal_year_end_date }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callErpNext, fetchAccountNamesForCompany, resolveLedgerAccount, findJournalEntryByUserRemark } from '../_shared/erpnext.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(obj: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function extractNetProfitFromPlResult(rows: unknown[]): number | null {
  if (!Array.isArray(rows)) return null;
  const preferredLabels = [
    'net profit',
    'net loss',
    'net income',
    'profit for the year',
    'loss for the year',
    'current year earnings'
  ];

  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i] as Record<string, unknown>;
    const name = (row.account ?? row.name ?? row.title ?? '').toString().toLowerCase();
    if (preferredLabels.some((label) => name.includes(label))) {
      const bal = Number(row.balance ?? row.total ?? row.net_profit ?? row.amount ?? 0);
      if (Number.isFinite(bal)) return bal;
    }
  }
  return null;
}

function formatDateUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function computeFiscalYearStart(endDate: string, fiscalEndMonth?: number | null, fiscalEndDay?: number | null): string {
  const [year, month, day] = endDate.split('-').map(Number);
  const endMonth = fiscalEndMonth || month;
  const endDay = fiscalEndDay || day;
  const previousFiscalEnd = new Date(Date.UTC(year - 1, Math.max(0, endMonth - 1), endDay));
  previousFiscalEnd.setUTCDate(previousFiscalEnd.getUTCDate() + 1);
  return formatDateUtc(previousFiscalEnd);
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' });

    const body = (await req.json().catch(() => ({}))) as { business_id?: string; fiscal_year_end_date?: string };
    const businessId = body?.business_id;
    const endDate = body?.fiscal_year_end_date?.slice(0, 10);
    if (!businessId || !endDate) return json({ error: 'Missing business_id or fiscal_year_end_date' });

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
    if (!membership) return json({ error: 'Access denied to this business' });

    const { data: config, error: configErr } = await supabaseAdmin
      .from('accounting_business_config')
      .select('erpnext_api_url, erpnext_company_name, erpnext_company_abbr, erpnext_api_key, erpnext_secret, retained_earnings_account_erpnext, period_lock_type, period_locked_until, fiscal_year_end_month, fiscal_year_end_day')
      .eq('business_id', businessId)
      .maybeSingle();
    if (configErr || !config) return json({ error: 'Accounting config not found' });

    const retainedLogical = (config.retained_earnings_account_erpnext || '').trim();
    if (!retainedLogical) return json({ error: 'Set Retained Earnings account in Accounting → Settings' });

    const baseUrl = (config.erpnext_api_url || '').replace(/\/$/, '');
    const company = (config.erpnext_company_name || '').trim();
    const apiKey = (config.erpnext_api_key || '').trim();
    const apiSecret = (config.erpnext_secret || '').trim();
    if (!baseUrl || !apiKey) return json({ error: 'ERPNext URL and API Key required' });

    const fromDate = computeFiscalYearStart(
      endDate,
      Number(config.fiscal_year_end_month || 0) || null,
      Number(config.fiscal_year_end_day || 0) || null
    );

    const plRes = await callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/method/frappe.desk.query_report.run', {
      report_name: 'Profit and Loss Statement',
      filters: {
        company: company || undefined,
        filter_based_on: 'Date Range',
        period_start_date: fromDate,
        period_end_date: endDate,
        periodicity: 'Monthly',
        accumulated_values: 1
      }
    });
    if (!plRes.ok) return json({ error: plRes.error || 'Failed to fetch P&L' });

    const plData = plRes.data as Record<string, unknown> | undefined;
    const plMessage = plData?.message as Record<string, unknown> | undefined;
    const plRows = (plMessage?.result ?? plData) as unknown[];
    const netProfit = extractNetProfitFromPlResult(Array.isArray(plRows) ? plRows : []);
    if (netProfit === null) return json({ error: 'Could not determine net profit/loss from P&L. Check ERPNext P&L report.' });
    const amount = Math.round(Math.abs(netProfit) * 100) / 100;
    if (amount < 0.01) return json({ message: 'Net profit/loss is zero; no closing entry needed.' });

    const accRes = await fetchAccountNamesForCompany(baseUrl, apiKey, apiSecret, company);
    if (!accRes.ok || !accRes.accounts?.length) return json({ error: accRes.error || 'Could not load accounts' });

    const retainedAccount = resolveLedgerAccount(accRes.accounts, retainedLogical, ['Retained Earnings', 'Retained Earning']);
    if (!retainedAccount) return json({ error: `Retained Earnings account "${retainedLogical}" not found. Use exact ERPNext name.` });

    const profitLossAccount = resolveLedgerAccount(accRes.accounts, 'Profit and Loss', ['Profit and Loss', 'Current Year Earnings']);
    if (!profitLossAccount) return json({ error: 'Profit and Loss (or Current Year Earnings) account not found in Chart of Accounts.' });

    const accountsPayload =
      netProfit >= 0
        ? [
            { account: profitLossAccount, debit_in_account_currency: amount, credit_in_account_currency: 0 },
            { account: retainedAccount, debit_in_account_currency: 0, credit_in_account_currency: amount }
          ]
        : [
            { account: retainedAccount, debit_in_account_currency: amount, credit_in_account_currency: 0 },
            { account: profitLossAccount, debit_in_account_currency: 0, credit_in_account_currency: amount }
          ];

    const idempotencyRemark = `[TAVARI year-end:${businessId}:${endDate}] Close fiscal year ending ${endDate}`;
    const legacyRemark = `Year-end close for period ending ${endDate}`;
    const existingJournalEntryId =
      await findJournalEntryByUserRemark(baseUrl, apiKey, apiSecret, idempotencyRemark)
      || await findJournalEntryByUserRemark(baseUrl, apiKey, apiSecret, legacyRemark);
    if (existingJournalEntryId) {
      return json({
        success: true,
        erpnext_journal_entry_id: existingJournalEntryId,
        message: `Closing entry ${existingJournalEntryId} already exists for ${endDate}.`
      });
    }

    const jePayload = {
      doctype: 'Journal Entry',
      posting_date: endDate,
      company,
      voucher_type: 'Closing Entry',
      user_remark: idempotencyRemark,
      accounts: accountsPayload
    };

    const createResult = await callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/resource/Journal Entry', jePayload);
    if (!createResult.ok) return json({ error: createResult.error || 'ERPNext request failed' });

    const jeData = createResult.data as Record<string, unknown> | undefined;
    let jeName = (jeData?.data as Record<string, string>)?.name ?? (jeData as Record<string, string>)?.name;
    if (!jeName) {
      jeName = await findJournalEntryByUserRemark(baseUrl, apiKey, apiSecret, idempotencyRemark);
    }
    if (!jeName) return json({ error: 'Journal Entry created but no name returned' });

    const fetchRes = await callErpNext(baseUrl, apiKey, apiSecret, 'GET', `/api/resource/Journal Entry/${encodeURIComponent(jeName)}`);
    const docToSubmit = fetchRes.ok && (fetchRes.data as { data?: Record<string, unknown> })?.data
      ? (fetchRes.data as { data: Record<string, unknown> }).data
      : { doctype: 'Journal Entry', name: jeName };

    const submitResult = await callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/method/frappe.client.submit', { doc: docToSubmit });
    if (!submitResult.ok) return json({ error: `Journal Entry created but submit failed: ${submitResult.error || 'unknown'}` });

    return json({ success: true, erpnext_journal_entry_id: jeName, message: `Closing entry ${jeName} posted.` });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
