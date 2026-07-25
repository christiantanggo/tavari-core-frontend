// Cancels a posted sales batch Journal Entry in ERPNext and sends the batch back to draft.
// POST body: { business_id, batch_id }

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
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const body = (await req.json().catch(() => ({}))) as { business_id?: string; batch_id?: string };
    const businessId = body?.business_id;
    const batchId = body?.batch_id;
    if (!businessId || !batchId) return json({ error: 'Missing business_id or batch_id' }, 400);

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
      .maybeSingle();
    if (!membership) return json({ error: 'Access denied to this business' }, 403);

    const { data: batch, error: batchErr } = await supabaseAdmin
      .from('accounting_sales_batches')
      .select('*')
      .eq('id', batchId)
      .eq('business_id', businessId)
      .single();
    if (batchErr || !batch) return json({ error: 'Sales batch not found' }, 404);
    if (!['posted', 'approved'].includes(batch.status)) return json({ error: 'Sales batch is not posted' }, 400);

    if (batch.deposit_id) {
      const { data: deposit } = await supabaseAdmin
        .from('accounting_deposits')
        .select('id, status')
        .eq('id', batch.deposit_id)
        .eq('business_id', businessId)
        .maybeSingle();
      if (deposit?.id) {
        return json({ error: 'This batch is linked to a deposit. Un-approve or delete the deposit first.' }, 400);
      }
    }

    const jeName = String(batch.erpnext_journal_entry_id || '').trim();
    if (!jeName) return json({ error: 'No ERPNext Journal Entry is linked to this batch.' }, 400);

    const { data: config } = await supabaseAdmin
      .from('accounting_business_config')
      .select('erpnext_api_url, erpnext_api_key, erpnext_secret')
      .eq('business_id', businessId)
      .maybeSingle();
    if (!config?.erpnext_api_url?.trim() || !config?.erpnext_api_key?.trim()) {
      return json({ error: 'ERPNext API URL or Key missing in Accounting Settings.' }, 400);
    }

    const cancelResult = await callErpNext(
      String(config.erpnext_api_url).replace(/\/$/, ''),
      String(config.erpnext_api_key || '').trim(),
      String(config.erpnext_secret || '').trim(),
      'POST',
      '/api/method/frappe.client.cancel',
      { doctype: 'Journal Entry', name: jeName }
    );
    if (!cancelResult.ok) return json({ error: `ERPNext cancel failed: ${cancelResult.error || 'unknown'}` }, 400);

    const { error: updateErr } = await supabaseAdmin
      .from('accounting_sales_batches')
      .update({
        status: 'draft',
        approved_by: null,
        approved_at: null,
        erpnext_journal_entry_id: null
      })
      .eq('id', batchId)
      .eq('business_id', businessId);
    if (updateErr) return json({ error: updateErr.message || 'Failed to update sales batch' }, 400);

    return json({ success: true });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
