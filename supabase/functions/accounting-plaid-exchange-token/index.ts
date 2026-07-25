import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isPlaidConfigured, plaidRequest } from '../_shared/plaid.ts';

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

function safeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    if (!isPlaidConfigured()) {
      return json({ error: 'Plaid is not configured' }, 503);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const body = (await req.json().catch(() => ({}))) as {
      business_id?: string;
      public_token?: string;
      institution?: { name?: string; institution_id?: string };
      accounts?: Array<{ id?: string; name?: string; mask?: string; type?: string; subtype?: string }>;
    };
    const businessId = body?.business_id;
    const publicToken = safeText(body?.public_token);
    if (!businessId || !publicToken) return json({ error: 'Missing business_id or public_token' }, 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user } } = await supabaseUser.auth.getUser();
    const { data: membership } = await supabaseUser
      .from('business_users')
      .select('user_id, role')
      .eq('business_id', businessId)
      .eq('user_id', user?.id)
      .in('role', ['owner', 'manager', 'admin'])
      .limit(1)
      .maybeSingle();
    if (!membership) return json({ error: 'Access denied to this business' }, 403);

    const exchangeRes = await plaidRequest<{ access_token?: string; item_id?: string }>('/item/public_token/exchange', {
      public_token: publicToken,
    });
    if (!exchangeRes.ok) return json({ error: exchangeRes.error }, 500);
    const accessToken = safeText(exchangeRes.data.access_token);
    const itemId = safeText(exchangeRes.data.item_id);
    if (!accessToken || !itemId) return json({ error: 'Plaid exchange did not return credentials' }, 500);

    const institutionName = safeText(body?.institution?.name) || null;
    const institutionId = safeText(body?.institution?.institution_id) || null;

    const { data: itemRow, error: itemError } = await supabaseAdmin
      .from('accounting_plaid_items')
      .upsert({
        business_id: businessId,
        item_id: itemId,
        access_token: accessToken,
        institution_name: institutionName,
        institution_id: institutionId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'business_id,item_id' })
      .select('id')
      .single();

    if (itemError || !itemRow?.id) {
      return json({ error: itemError?.message || 'Failed to save Plaid item' }, 500);
    }

    const accounts = Array.isArray(body?.accounts) ? body.accounts : [];
    for (const acct of accounts) {
      const accountId = safeText(acct.id);
      if (!accountId) continue;
      await supabaseAdmin.from('accounting_plaid_accounts').upsert({
        business_id: businessId,
        plaid_item_id: itemRow.id,
        account_id: accountId,
        name: safeText(acct.name) || null,
        mask: safeText(acct.mask) || null,
        account_type: safeText(acct.type) || null,
        account_subtype: safeText(acct.subtype) || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'plaid_item_id,account_id' });
    }

    return json({
      success: true,
      plaid_item_id: itemRow.id,
      institution_name: institutionName,
      accounts_linked: accounts.length,
    });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
