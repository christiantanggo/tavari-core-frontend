// Returns GL balance for a single account as of a date. For bank reconciliation.
// POST body: { business_id, account_name, as_of_date }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callErpNext } from '../_shared/erpnext.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(obj: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' });

    const body = (await req.json().catch(() => ({}))) as { business_id?: string; account_name?: string; as_of_date?: string };
    const businessId = body?.business_id;
    const accountName = (body?.account_name || '').trim();
    const asOfDate = body?.as_of_date?.slice(0, 10);
    if (!businessId || !accountName || !asOfDate) return json({ error: 'Missing business_id, account_name, or as_of_date' });

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
      .select('erpnext_api_url, erpnext_company_name, erpnext_api_key, erpnext_secret')
      .eq('business_id', businessId)
      .maybeSingle();
    if (configErr || !config) return json({ error: 'Accounting config not found' });

    const baseUrl = (config.erpnext_api_url || '').replace(/\/$/, '');
    const company = (config.erpnext_company_name || '').trim();
    const apiKey = (config.erpnext_api_key || '').trim();
    const apiSecret = (config.erpnext_secret || '').trim();
    if (!baseUrl || !apiKey) return json({ error: 'ERPNext URL and API Key required' });

    const res = await callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/method/frappe.desk.query_report.run', {
      report_name: 'General Ledger',
      filters: {
        company: company || undefined,
        from_date: asOfDate.slice(0, 4) + '-01-01',
        to_date: asOfDate,
        account: accountName
      }
    });
    if (!res.ok) return json({ error: res.error || 'Failed to fetch GL' });

    const data = res.data as Record<string, unknown> | undefined;
    const message = data?.message as Record<string, unknown> | undefined;
    const rows = (message?.result ?? data) as unknown[];
    if (!Array.isArray(rows)) return json({ balance: 0, as_of_date: asOfDate, account_name: accountName });

    let balance = 0;
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      const bal = Number(r.balance ?? r.balance_in_account_currency ?? 0) || 0;
      const debit = Number(r.debit ?? r.debit_in_account_currency ?? 0) || 0;
      const credit = Number(r.credit ?? r.credit_in_account_currency ?? 0) || 0;
      if (bal !== 0) balance = bal;
      else balance += debit - credit;
    }
    return json({ balance: Math.round(balance * 100) / 100, as_of_date: asOfDate, account_name: accountName });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
