// Returns list of ledger (leaf) accounts from ERPNext for manual journal entry and bank rec.
// POST body: { business_id }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fetchAccountNamesForCompany } from '../_shared/erpnext.ts';

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

    const body = (await req.json().catch(() => ({}))) as { business_id?: string; include_groups?: boolean };
    const businessId = body?.business_id;
    if (!businessId) return json({ error: 'Missing business_id' });

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
    if (!baseUrl || !apiKey) return json({ error: 'ERPNext URL and API Key required in Accounting → Settings' });

    const result = await fetchAccountNamesForCompany(baseUrl, apiKey, apiSecret, company);
    if (!result.ok) return json({ error: result.error || 'Failed to fetch accounts' });
    const includeGroups = body?.include_groups === true;
    const mapped = (result.accounts || [])
      .filter((a) => includeGroups || !a.is_group)
      .map((a) => ({
        name: a.name,
        account_name: a.account_name || null,
        parent_account: a.parent_account || null,
        is_group: !!a.is_group,
        root_type: a.root_type || null,
        report_type: a.report_type || null,
        account_type: a.account_type || null
      }));
    return json({ accounts: mapped });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
