// Syncs a Tavari vendor to ERPNext as a Supplier (create if not exists).
// POST body: { business_id, vendor_name }
// Called when user creates/updates a vendor in Accounting → Vendors.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ensureSupplierInErpNext } from '../_shared/erpnext.ts';

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

    const body = (await req.json().catch(() => ({}))) as { business_id?: string; vendor_name?: string };
    const businessId = body?.business_id;
    const vendorName = (body?.vendor_name ?? '').trim();
    if (!businessId) return json({ error: 'Missing business_id' });
    if (!vendorName) return json({ error: 'Missing vendor_name' });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user } } = await supabaseUser.auth.getUser();
    const { data: membership } = await supabaseUser
      .from('business_users')
      .select('user_id')
      .eq('business_id', businessId)
      .eq('user_id', user?.id)
      .limit(1)
      .maybeSingle();
    if (!membership) return json({ error: 'Access denied to this business' });

    const { data: config } = await supabaseAdmin
      .from('accounting_business_config')
      .select('erpnext_api_url, erpnext_api_key, erpnext_secret')
      .eq('business_id', businessId)
      .maybeSingle();

    if (!config?.erpnext_api_url?.trim() || !config?.erpnext_api_key?.trim()) {
      return json({ error: 'ERPNext not configured for this business. Set up Accounting → Settings first.' });
    }

    const baseUrl = (config.erpnext_api_url as string).replace(/\/$/, '');
    const apiKey = (config.erpnext_api_key as string).trim();
    const apiSecret = ((config.erpnext_secret as string) ?? '').trim();

    const result = await ensureSupplierInErpNext(baseUrl, apiKey, apiSecret, vendorName);
    if (!result.ok) return json({ error: result.error || 'Failed to sync supplier to ERPNext' });
    return json({ success: true, partyName: result.partyName });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
