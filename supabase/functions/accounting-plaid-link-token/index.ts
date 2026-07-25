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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    if (!isPlaidConfigured()) {
      return json({ error: 'Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET to Supabase secrets.' }, 503);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const body = (await req.json().catch(() => ({}))) as { business_id?: string };
    const businessId = body?.business_id;
    if (!businessId) return json({ error: 'Missing business_id' }, 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

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

    const plaidRes = await plaidRequest<{ link_token?: string; expiration?: string }>('/link/token/create', {
      user: { client_user_id: businessId },
      client_name: 'Tavari Accounting',
      products: ['transactions'],
      country_codes: ['CA', 'US'],
      language: 'en',
    });

    if (!plaidRes.ok) return json({ error: plaidRes.error }, 500);
    if (!plaidRes.data.link_token) return json({ error: 'Plaid did not return a link token' }, 500);

    return json({
      link_token: plaidRes.data.link_token,
      expiration: plaidRes.data.expiration || null,
    });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
