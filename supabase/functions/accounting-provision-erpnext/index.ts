// Provisions a new ERPNext Company + API user for a Tavari business (in-app setup).
// POST body: { business_id }
// Requires: ERPNEXT_PROVISIONING_URL, ERPNEXT_PROVISIONING_SECRET, ERPNEXT_BASE_URL
// The provisioning service creates Company, User, API keys in ERPNext and returns them.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(obj: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// Must match BASELINE_EXPENSE_CATEGORIES in src/screens/Accounting/accountingDefaults.js (ERPNext Chart of Accounts).
const BASELINE_CATEGORIES = [
  { name: 'Cost of Goods Sold', gl_account_erpnext: 'Cost of Goods Sold', default_hst_treatment: 'recoverable', sort_order: 10 },
  { name: 'Stock Expenses', gl_account_erpnext: 'Stock Expenses', default_hst_treatment: 'recoverable', sort_order: 12 },
  { name: 'Expenses Included In Asset Valuation', gl_account_erpnext: 'Expenses Included In Asset Valuation', default_hst_treatment: 'recoverable', sort_order: 14 },
  { name: 'Expenses Included In Valuation', gl_account_erpnext: 'Expenses Included In Valuation', default_hst_treatment: 'recoverable', sort_order: 16 },
  { name: 'Stock Adjustment', gl_account_erpnext: 'Stock Adjustment', default_hst_treatment: 'recoverable', sort_order: 18 },
  { name: 'Administrative Expenses', gl_account_erpnext: 'Administrative Expenses', default_hst_treatment: 'recoverable', sort_order: 20 },
  { name: 'Commission on Sales', gl_account_erpnext: 'Commission on Sales', default_hst_treatment: 'recoverable', sort_order: 22 },
  { name: 'Depreciation', gl_account_erpnext: 'Depreciation', default_hst_treatment: 'recoverable', sort_order: 24 },
  { name: 'Entertainment Expenses', gl_account_erpnext: 'Entertainment Expenses', default_hst_treatment: 'recoverable', sort_order: 26 },
  { name: 'Exchange Gain/Loss', gl_account_erpnext: 'Exchange Gain/Loss', default_hst_treatment: 'recoverable', sort_order: 28 },
  { name: 'Freight and Forwarding Charges', gl_account_erpnext: 'Freight and Forwarding Charges', default_hst_treatment: 'recoverable', sort_order: 30 },
  { name: 'Gain/Loss on Asset Disposal', gl_account_erpnext: 'Gain/Loss on Asset Disposal', default_hst_treatment: 'recoverable', sort_order: 32 },
  { name: 'Impairment', gl_account_erpnext: 'Impairment', default_hst_treatment: 'recoverable', sort_order: 34 },
  { name: 'Legal Expenses', gl_account_erpnext: 'Legal Expenses', default_hst_treatment: 'recoverable', sort_order: 36 },
  { name: 'Marketing Expenses', gl_account_erpnext: 'Marketing Expenses', default_hst_treatment: 'recoverable', sort_order: 38 },
  { name: 'Miscellaneous Expenses', gl_account_erpnext: 'Miscellaneous Expenses', default_hst_treatment: 'recoverable', sort_order: 40 },
  { name: 'Office Maintenance Expenses', gl_account_erpnext: 'Office Maintenance Expenses', default_hst_treatment: 'recoverable', sort_order: 42 },
  { name: 'Office Rent', gl_account_erpnext: 'Office Rent', default_hst_treatment: 'recoverable', sort_order: 44 },
  { name: 'Postal Expenses', gl_account_erpnext: 'Postal Expenses', default_hst_treatment: 'recoverable', sort_order: 46 },
  { name: 'Print and Stationery', gl_account_erpnext: 'Print and Stationery', default_hst_treatment: 'recoverable', sort_order: 48 },
  { name: 'Round Off', gl_account_erpnext: 'Round Off', default_hst_treatment: 'recoverable', sort_order: 50 },
  { name: 'Salary', gl_account_erpnext: 'Salary', default_hst_treatment: 'exempt', sort_order: 52 },
  { name: 'Sales Expenses', gl_account_erpnext: 'Sales Expenses', default_hst_treatment: 'recoverable', sort_order: 54 },
  { name: 'Telephone Expenses', gl_account_erpnext: 'Telephone Expenses', default_hst_treatment: 'recoverable', sort_order: 56 },
  { name: 'Travel Expenses', gl_account_erpnext: 'Travel Expenses', default_hst_treatment: 'recoverable', sort_order: 58 },
  { name: 'Utility Expenses', gl_account_erpnext: 'Utility Expenses', default_hst_treatment: 'recoverable', sort_order: 60 },
  { name: 'Write Off', gl_account_erpnext: 'Write Off', default_hst_treatment: 'recoverable', sort_order: 62 },
  { name: 'Insurance', gl_account_erpnext: 'Miscellaneous Expenses', default_hst_treatment: 'recoverable', sort_order: 64 },
  { name: 'Office Supplies', gl_account_erpnext: 'Print and Stationery', default_hst_treatment: 'recoverable', sort_order: 66 },
  { name: 'Professional Fees', gl_account_erpnext: 'Legal Expenses', default_hst_treatment: 'recoverable', sort_order: 68 },
  { name: 'Rent', gl_account_erpnext: 'Office Rent', default_hst_treatment: 'recoverable', sort_order: 70 },
  { name: 'Wages and Salaries', gl_account_erpnext: 'Salary', default_hst_treatment: 'exempt', sort_order: 72 },
  { name: 'Other Operating Expenses', gl_account_erpnext: 'Miscellaneous Expenses', default_hst_treatment: 'recoverable', sort_order: 99 }
];

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' });

    const body = (await req.json().catch(() => ({}))) as { business_id?: string };
    const businessId = body?.business_id;
    if (!businessId) return json({ error: 'Missing business_id' });

    const provisioningUrl = Deno.env.get('ERPNEXT_PROVISIONING_URL')?.trim();
    const provisioningSecret = Deno.env.get('ERPNEXT_PROVISIONING_SECRET')?.trim();
    const erpnextBaseUrl = Deno.env.get('ERPNEXT_BASE_URL')?.trim();

    if (!provisioningUrl) {
      return json({ error: 'In-app provisioning not configured. Add ERPNext URL and API credentials manually in the form below.' });
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
      .select('role')
      .eq('business_id', businessId)
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    if (!membership) return json({ error: 'Access denied to this business' });
    if (!['owner', 'manager', 'admin'].includes(membership.role || '')) {
      return json({ error: 'Only owners, managers, or admins can connect accounting.' });
    }

    const { data: existing } = await supabaseAdmin
      .from('accounting_business_config')
      .select('id')
      .eq('business_id', businessId)
      .maybeSingle();
    if (existing) return json({ error: 'Accounting is already connected for this business.' });

    const { data: business, error: bizErr } = await supabaseAdmin
      .from('businesses')
      .select('id, name')
      .eq('id', businessId)
      .single();
    if (bizErr || !business) return json({ error: 'Business not found' });

    const businessName = (business.name || '').trim() || 'Tavari Business';

    const provisionRes = await fetch(provisioningUrl.replace(/\/$/, '') + '/provision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(provisioningSecret ? { 'X-Provisioning-Secret': provisioningSecret } : {})
      },
      body: JSON.stringify({ business_id: businessId, business_name: businessName })
    });

    const provisionText = await provisionRes.text();
    if (!provisionRes.ok) {
      const err = provisionText ? (JSON.parse(provisionText).error || provisionText) : provisionRes.statusText;
      return json({ error: err || 'Provisioning failed' }, 400);
    }

    let provisionData: { erpnext_api_url?: string; erpnext_company_name?: string; erpnext_api_key?: string; erpnext_secret?: string };
    try {
      provisionData = provisionText ? JSON.parse(provisionText) : {};
    } catch {
      return json({ error: 'Invalid provisioning response' }, 500);
    }

    const apiUrl = (provisionData.erpnext_api_url || erpnextBaseUrl || '').trim();
    const companyName = (provisionData.erpnext_company_name || businessName).trim();
    const apiKey = (provisionData.erpnext_api_key || '').trim();
    const apiSecret = (provisionData.erpnext_secret || '').trim();

    if (!apiUrl || !apiKey || !apiSecret) {
      return json({ error: 'Provisioning service did not return API URL and credentials.' }, 500);
    }

    const { error: insertErr } = await supabaseAdmin.from('accounting_business_config').insert({
      business_id: businessId,
      erpnext_api_url: apiUrl,
      erpnext_company_name: companyName,
      erpnext_api_key: apiKey,
      erpnext_secret: apiSecret,
      batch_day_end_time_local: '23:59',
      batch_run_time_local: '02:00',
      business_timezone: 'America/Toronto',
      period_lock_type: 'month',
      currency: 'CAD'
    });
    if (insertErr) return json({ error: insertErr.message || 'Failed to save config' }, 500);

    const { data: hasCats } = await supabaseAdmin
      .from('accounting_expense_categories')
      .select('id')
      .eq('business_id', businessId)
      .limit(1);
    if (!hasCats?.length) {
      await supabaseAdmin.from('accounting_expense_categories').insert(
        BASELINE_CATEGORIES.map((c) => ({ business_id: businessId, ...c, is_baseline: true }))
      );
    }

    return json({ success: true, message: 'Accounting connected successfully.' });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});
