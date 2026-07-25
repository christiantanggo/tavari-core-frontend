// Cancels a posted expense in ERPNext and sends draft back to draft.
// POST body: { business_id, draft_id }
// Supports Purchase Invoice (+ optional Payment Entry) and legacy Journal Entry rows.

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

async function cancelErpDoc(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  doctype: string,
  name: string
) {
  return await callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/method/frappe.client.cancel', {
    doctype,
    name
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' });

    const body = (await req.json().catch(() => ({}))) as { business_id?: string; draft_id?: string };
    const businessId = body?.business_id;
    const draftId = body?.draft_id;
    if (!businessId || !draftId) return json({ error: 'Missing business_id or draft_id' });

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
    if (!membership) return json({ error: 'Access denied to this business' });

    const { data: draft, error: draftErr } = await supabaseAdmin
      .from('accounting_draft_expenses')
      .select('*')
      .eq('id', draftId)
      .eq('business_id', businessId)
      .single();
    if (draftErr || !draft) return json({ error: 'Draft expense not found' });
    if (draft.status !== 'posted' && draft.status !== 'approved') return json({ error: 'Draft is not approved or posted' });

    const paymentEntryName = (draft.erpnext_payment_entry_id || '').trim();
    const piName = (draft.erpnext_purchase_invoice_id || '').trim();
    const jeName = (draft.erpnext_journal_entry_id || '').trim();
    if (!paymentEntryName && !piName && !jeName) {
      return json({ error: 'No ERPNext document linked to this draft. Cannot un-approve.' });
    }

    const { data: config } = await supabaseAdmin
      .from('accounting_business_config')
      .select('erpnext_api_url, erpnext_api_key, erpnext_secret')
      .eq('business_id', businessId)
      .maybeSingle();
    if (!config?.erpnext_api_url?.trim() || !config?.erpnext_api_key?.trim()) {
      return json({ error: 'ERPNext API URL or Key missing. In Accounting → Settings, enter the ERPNext URL and API Key/Secret, then Save.' });
    }

    const baseUrl = (config.erpnext_api_url || '').replace(/\/$/, '');
    const apiKey = config.erpnext_api_key?.trim() || '';
    const apiSecret = (config.erpnext_secret || '').trim() || '';

    if (paymentEntryName) {
      const cancelPay = await cancelErpDoc(baseUrl, apiKey, apiSecret, 'Payment Entry', paymentEntryName);
      if (!cancelPay.ok) return json({ error: `ERPNext Payment Entry cancel failed: ${cancelPay.error || 'unknown'}` });
    }
    if (piName) {
      const cancelPi = await cancelErpDoc(baseUrl, apiKey, apiSecret, 'Purchase Invoice', piName);
      if (!cancelPi.ok) return json({ error: `ERPNext Purchase Invoice cancel failed: ${cancelPi.error || 'unknown'}` });
    } else if (jeName) {
      const cancelJe = await cancelErpDoc(baseUrl, apiKey, apiSecret, 'Journal Entry', jeName);
      if (!cancelJe.ok) return json({ error: `ERPNext cancel failed: ${cancelJe.error || 'unknown'}` });
    }

    const { error: updateErr } = await supabaseAdmin
      .from('accounting_draft_expenses')
      .update({
        status: 'draft',
        approved_by: null,
        approved_at: null,
        erpnext_journal_entry_id: null,
        erpnext_purchase_invoice_id: null,
        erpnext_payment_entry_id: null,
        fixed_asset_id: null
      })
      .eq('id', draftId)
      .eq('business_id', businessId);
    if (updateErr) return json({ error: updateErr.message || 'Failed to update draft' });

    const linkedAssetId = (draft.fixed_asset_id as string | null)?.trim() || null;
    if (linkedAssetId) {
      const { count, error: depCountErr } = await supabaseAdmin
        .from('accounting_depreciation_entries')
        .select('id', { count: 'exact', head: true })
        .eq('asset_id', linkedAssetId);
      if (depCountErr) {
        return json({ error: depCountErr.message || 'Expense un-approved but could not check linked asset depreciation.' });
      }
      if ((count || 0) > 0) {
        await supabaseAdmin
          .from('accounting_fixed_assets')
          .update({ status: 'disposed' })
          .eq('id', linkedAssetId)
          .eq('business_id', businessId);
      } else {
        await supabaseAdmin
          .from('accounting_fixed_assets')
          .delete()
          .eq('id', linkedAssetId)
          .eq('business_id', businessId);
      }
    }

    return json({ success: true });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
