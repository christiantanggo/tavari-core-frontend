// Runs monthly depreciation for fixed assets and posts one Journal Entry to ERPNext.
// POST body: { business_id, period_date } — period_date = first day of month (YYYY-MM-01).
// For each active asset with service_date <= end of period and no existing entry for that month,
// computes straight-line amount, builds JE lines (Dr Depreciation Expense, Cr Accumulated Depreciation),
// posts one JE per period, then records accounting_depreciation_entries.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callErpNext, fetchCompanyAbbreviation, fetchAccountNamesForCompany, resolveLedgerAccount } from '../_shared/erpnext.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(obj: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' });

    const body = (await req.json().catch(() => ({}))) as { business_id?: string; period_date?: string };
    const businessId = body?.business_id;
    const periodDateRaw = body?.period_date?.trim()?.slice(0, 10);
    if (!businessId || !periodDateRaw) return json({ error: 'Missing business_id or period_date (YYYY-MM-01)' });
    const periodDate = periodDateRaw;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodDate)) return json({ error: 'period_date must be YYYY-MM-DD (e.g. first day of month)' });

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
      .select('user_id')
      .eq('business_id', businessId)
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    if (!membership) return json({ error: 'Access denied to this business' });

    const { data: config, error: configErr } = await supabaseAdmin
      .from('accounting_business_config')
      .select('erpnext_api_url, erpnext_company_name, erpnext_company_abbr, erpnext_api_key, erpnext_secret, period_lock_type, period_locked_until, depreciation_expense_account_erpnext, accumulated_depreciation_account_erpnext')
      .eq('business_id', businessId)
      .maybeSingle();
    if (configErr || !config) return json({ error: 'Accounting config not found. Set up ERPNext in Accounting → Settings.' });
    if (!config.erpnext_api_url?.trim() || !config.erpnext_api_key?.trim()) return json({ error: 'ERPNext URL and API Key are required in Accounting → Settings.' });

    if (config.period_locked_until) {
      const lockedUntil = new Date(config.period_locked_until).getTime();
      const postDate = new Date(periodDate).getTime();
      if (postDate <= lockedUntil) return json({ error: `Period ${periodDate} is in a locked period. Unlock in Settings to run depreciation.` });
    }

    const [py, pm] = periodDate.split('-').map(Number);
    const periodLastDay = new Date(py, pm, 0);
    const periodEndStr = periodLastDay.toISOString().slice(0, 10);

    const { data: assets, error: assetsErr } = await supabaseAdmin
      .from('accounting_fixed_assets')
      .select('id, name, cost, salvage_value, service_date, useful_life_months, gl_depreciation_expense_account_erpnext, gl_accumulated_depreciation_account_erpnext')
      .eq('business_id', businessId)
      .eq('status', 'active')
      .lte('service_date', periodEndStr);
    if (assetsErr) return json({ error: assetsErr.message || 'Failed to load assets' });

    const { data: existingEntries } = await supabaseAdmin
      .from('accounting_depreciation_entries')
      .select('asset_id')
      .eq('business_id', businessId)
      .eq('period_date', periodDate);
    const alreadyPosted = new Set((existingEntries || []).map((e: { asset_id: string }) => e.asset_id));

    type AssetRow = {
      id: string;
      name: string;
      cost: number;
      salvage_value: number;
      service_date: string;
      useful_life_months: number;
      gl_depreciation_expense_account_erpnext: string | null;
      gl_accumulated_depreciation_account_erpnext: string | null;
    };

    const toProcess: { asset: AssetRow; amount: number }[] = [];
    for (const a of assets || []) {
      if (alreadyPosted.has(a.id)) continue;
      const cost = Number(a.cost) || 0;
      const salvage = Number(a.salvage_value) || 0;
      const months = Math.max(1, Number(a.useful_life_months) || 12);
      const amount = round2((cost - salvage) / months);
      if (amount <= 0) continue;
      toProcess.push({ asset: a as AssetRow, amount });
    }

    if (toProcess.length === 0) {
      return json({ success: true, message: 'No depreciation to post for this period.', posted: 0 });
    }

    const baseUrl = (config.erpnext_api_url as string || '').replace(/\/$/, '');
    const apiKey = ((config.erpnext_api_key as string) || '').trim();
    const apiSecret = ((config.erpnext_secret as string) ?? '').trim();
    let company = ((config.erpnext_company_name as string) || '').trim() || 'Company';
    let abbr = ((config.erpnext_company_abbr as string) || '').trim();
    if (!abbr) {
      const fetched = await fetchCompanyAbbreviation(baseUrl, apiKey, apiSecret, company === 'Company' ? undefined : company);
      if (!fetched.ok || !fetched.abbreviation) return json({ error: fetched.error || 'Could not get company abbreviation from ERPNext.' });
      abbr = fetched.abbreviation;
      if (fetched.companyName) company = fetched.companyName;
    }
    const suffix = ` - ${abbr}`;

    const defaultExpense = (config.depreciation_expense_account_erpnext as string)?.trim() || 'Depreciation';
    const defaultAccum = (config.accumulated_depreciation_account_erpnext as string)?.trim() || 'Accumulated Depreciation';

    const accountsRes = await fetchAccountNamesForCompany(baseUrl, apiKey, apiSecret, company);
    if (!accountsRes.ok || !accountsRes.accounts?.length) return json({ error: accountsRes.error || 'Could not load Chart of Accounts from ERPNext.' });
    const accountList = accountsRes.accounts;

    type JeRow = { account: string; debit_in_account_currency: number; credit_in_account_currency: number };
    const accounts: JeRow[] = [];

    for (const { asset, amount } of toProcess) {
      const expenseLogical = (asset.gl_depreciation_expense_account_erpnext?.trim() || defaultExpense) + suffix;
      const accumLogical = (asset.gl_accumulated_depreciation_account_erpnext?.trim() || defaultAccum) + suffix;
      const expenseAccount = resolveLedgerAccount(accountList, expenseLogical);
      const accumAccount = resolveLedgerAccount(accountList, accumLogical);
      if (!expenseAccount) return json({ error: `Depreciation expense account not found for asset "${asset.name}". Set on the asset or set default in Accounting → Settings (e.g. "Depreciation").` });
      if (!accumAccount) return json({ error: `Accumulated depreciation account not found for asset "${asset.name}". Set on the asset or set default in Accounting → Settings.` });
      accounts.push({ account: expenseAccount, debit_in_account_currency: amount, credit_in_account_currency: 0 });
      accounts.push({ account: accumAccount, debit_in_account_currency: 0, credit_in_account_currency: amount });
    }

    const jePayload = {
      doctype: 'Journal Entry',
      posting_date: periodDate,
      company,
      voucher_type: 'Depreciation Entry',
      accounts
    };

    const createResult = await callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/resource/Journal Entry', jePayload);
    if (!createResult.ok) return json({ error: createResult.error || 'ERPNext request failed' });

    const jeData = createResult.data as Record<string, unknown> | undefined;
    const jeName = (jeData?.data as Record<string, string>)?.name ?? (jeData as Record<string, string>)?.name;
    if (!jeName) return json({ error: 'Journal Entry created but no name returned' });

    const fetchRes = await callErpNext(baseUrl, apiKey, apiSecret, 'GET', `/api/resource/Journal Entry/${encodeURIComponent(jeName)}`);
    const docToSubmit = fetchRes.ok && (fetchRes.data as { data?: Record<string, unknown> })?.data
      ? (fetchRes.data as { data: Record<string, unknown> }).data
      : { doctype: 'Journal Entry', name: jeName };

    const submitResult = await callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/method/frappe.client.submit', { doc: docToSubmit });
    if (!submitResult.ok) return json({ error: `Journal Entry created but submit failed: ${submitResult.error || 'unknown'}` });

    for (const { asset, amount } of toProcess) {
      await supabaseAdmin.from('accounting_depreciation_entries').insert({
        business_id: businessId,
        asset_id: asset.id,
        period_date: periodDate,
        amount,
        erpnext_journal_entry_id: jeName
      });
    }

    return json({
      success: true,
      erpnext_journal_entry_id: jeName,
      posted: toProcess.length,
      period_date: periodDate
    });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
