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

type PlaidTransaction = {
  transaction_id?: string;
  date?: string;
  name?: string;
  merchant_name?: string;
  amount?: number;
  pending?: boolean;
};

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
      plaid_item_id?: string;
    };
    const businessId = body?.business_id;
    if (!businessId) return json({ error: 'Missing business_id' }, 400);

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

    let itemsQuery = supabaseAdmin
      .from('accounting_plaid_items')
      .select('id, item_id, access_token, sync_cursor, institution_name')
      .eq('business_id', businessId);
    if (body?.plaid_item_id) {
      itemsQuery = itemsQuery.eq('id', body.plaid_item_id);
    }
    const { data: items, error: itemsError } = await itemsQuery;
    if (itemsError) return json({ error: itemsError.message }, 500);
    if (!items?.length) return json({ error: 'No Plaid connections found for this business' }, 404);

    const { data: plaidAccounts } = await supabaseAdmin
      .from('accounting_plaid_accounts')
      .select('id, plaid_item_id, account_id, name, mask, bank_account_erpnext')
      .eq('business_id', businessId);

    const accountsByItem = new Map<string, typeof plaidAccounts>();
    for (const acct of plaidAccounts || []) {
      const list = accountsByItem.get(acct.plaid_item_id) || [];
      list.push(acct);
      accountsByItem.set(acct.plaid_item_id, list);
    }

    let totalAdded = 0;
    let totalSkipped = 0;

    for (const item of items) {
      const accessToken = safeText(item.access_token);
      if (!accessToken) continue;

      const syncRes = await plaidRequest<{
        added?: PlaidTransaction[];
        modified?: PlaidTransaction[];
        removed?: Array<{ transaction_id?: string }>;
        next_cursor?: string;
        has_more?: boolean;
      }>('/transactions/sync', {
        access_token: accessToken,
        cursor: item.sync_cursor || undefined,
      });

      if (!syncRes.ok) {
        return json({ error: `Plaid sync failed for ${item.institution_name || item.item_id}: ${syncRes.error}` }, 500);
      }

      const added = [...(syncRes.data.added || []), ...(syncRes.data.modified || [])];
      const itemAccounts = accountsByItem.get(item.id) || [];
      const defaultGl = itemAccounts.find((a) => a.bank_account_erpnext)?.bank_account_erpnext || null;

      if (added.length > 0) {
        const syncDate = new Date().toISOString().slice(0, 10);
        const fileLabel = `Plaid: ${item.institution_name || item.item_id} (${syncDate})`;

        const { data: importRow, error: importError } = await supabaseAdmin
          .from('accounting_bank_imports')
          .insert({
            business_id: businessId,
            file_name: fileLabel,
            bank_account_erpnext: defaultGl,
            import_source: 'plaid',
            status: 'processed',
          })
          .select('id')
          .single();

        if (importError || !importRow?.id) {
          return json({ error: importError?.message || 'Failed to create Plaid import batch' }, 500);
        }

        const toInsert: Array<Record<string, unknown>> = [];
        for (const tx of added) {
          if (tx.pending) {
            totalSkipped += 1;
            continue;
          }
          const txId = safeText(tx.transaction_id);
          if (!txId) continue;

          const { data: existing } = await supabaseAdmin
            .from('accounting_bank_transactions')
            .select('id')
            .eq('external_transaction_id', txId)
            .maybeSingle();
          if (existing?.id) {
            totalSkipped += 1;
            continue;
          }

          const amount = Math.abs(Number(tx.amount) || 0);
          if (amount <= 0) continue;
          const plaidAmount = Number(tx.amount) || 0;
          const debitCredit = plaidAmount > 0 ? 'debit' : 'credit';

          toInsert.push({
            import_id: importRow.id,
            transaction_date: safeText(tx.date) || syncDate,
            description: safeText(tx.merchant_name) || safeText(tx.name) || 'Plaid transaction',
            payee: safeText(tx.name) || null,
            amount: Math.round(amount * 100) / 100,
            debit_credit: debitCredit,
            external_transaction_id: txId,
            status: 'pending',
          });
        }

        if (toInsert.length > 0) {
          const { error: txError } = await supabaseAdmin.from('accounting_bank_transactions').insert(toInsert);
          if (txError) return json({ error: txError.message }, 500);
          totalAdded += toInsert.length;
        } else {
          await supabaseAdmin.from('accounting_bank_imports').delete().eq('id', importRow.id);
        }
      }

      await supabaseAdmin
        .from('accounting_plaid_items')
        .update({
          sync_cursor: syncRes.data.next_cursor || item.sync_cursor,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id);
    }

    return json({
      success: true,
      transactions_added: totalAdded,
      transactions_skipped: totalSkipped,
      items_synced: items.length,
    });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
