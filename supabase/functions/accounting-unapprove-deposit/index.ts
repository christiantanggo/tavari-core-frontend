// Cancels a posted deposit Journal Entry in ERPNext, sends the deposit back to draft,
// and unlinks any batches so those batches can be reversed independently afterward.
// POST body: { business_id, deposit_id }

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

    const body = (await req.json().catch(() => ({}))) as { business_id?: string; deposit_id?: string };
    const businessId = body?.business_id;
    const depositId = body?.deposit_id;
    if (!businessId || !depositId) return json({ error: 'Missing business_id or deposit_id' }, 400);

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

    const { data: deposit, error: depositErr } = await supabaseAdmin
      .from('accounting_deposits')
      .select('*')
      .eq('id', depositId)
      .eq('business_id', businessId)
      .single();
    if (depositErr || !deposit) return json({ error: 'Deposit not found' }, 404);
    if (!['posted', 'approved'].includes(deposit.status)) return json({ error: 'Deposit is not posted' }, 400);

    const jeName = String(deposit.erpnext_journal_entry_id || '').trim();
    if (!jeName) return json({ error: 'No ERPNext Journal Entry is linked to this deposit.' }, 400);

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

    const { data: depositBatchRows, error: depositBatchRowsErr } = await supabaseAdmin
      .from('accounting_deposit_batches')
      .select('batch_id')
      .eq('deposit_id', depositId);
    if (depositBatchRowsErr) return json({ error: depositBatchRowsErr.message || 'Failed to load linked batches' }, 400);

    const linkedBatchIds = (depositBatchRows || []).map((row: { batch_id: string }) => row.batch_id).filter(Boolean);

    const { error: updateErr } = await supabaseAdmin
      .from('accounting_deposits')
      .update({
        status: 'draft',
        approved_by: null,
        approved_at: null,
        erpnext_journal_entry_id: null
      })
      .eq('id', depositId)
      .eq('business_id', businessId);
    if (updateErr) return json({ error: updateErr.message || 'Failed to update deposit' }, 400);

    if (linkedBatchIds.length > 0) {
      const { error: clearBatchDepositErr } = await supabaseAdmin
        .from('accounting_sales_batches')
        .update({ deposit_id: null })
        .in('id', linkedBatchIds)
        .eq('business_id', businessId);
      if (clearBatchDepositErr) {
        return json({ error: clearBatchDepositErr.message || 'Deposit reversed but failed to unlink batches' }, 400);
      }

      const { error: deleteLinksErr } = await supabaseAdmin
        .from('accounting_deposit_batches')
        .delete()
        .eq('deposit_id', depositId);
      if (deleteLinksErr) {
        return json({ error: deleteLinksErr.message || 'Deposit reversed but failed to delete batch links' }, 400);
      }
    }

    const { error: clearMatchedBankTxErr } = await supabaseAdmin
      .from('accounting_bank_transactions')
      .update({
        matched_deposit_id: null,
        status: 'pending',
        erpnext_journal_entry_id: null
      })
      .eq('matched_deposit_id', depositId);
    if (clearMatchedBankTxErr) {
      return json({ error: clearMatchedBankTxErr.message || 'Deposit reversed but failed to clear linked bank transactions' }, 400);
    }

    const { error: deleteMatchLinesErr } = await supabaseAdmin
      .from('accounting_deposit_match_lines')
      .delete()
      .eq('deposit_id', depositId)
      .eq('business_id', businessId);
    if (deleteMatchLinesErr) {
      return json({ error: deleteMatchLinesErr.message || 'Deposit reversed but failed to clear deposit match lines' }, 400);
    }

    return json({ success: true, unlinked_batch_ids: linkedBatchIds });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
