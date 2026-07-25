// Posts a manual Journal Entry to ERPNext. POST body: { business_id, posting_date, remark, accounts: [{ account, debit, credit }] }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callErpNext, fetchAccountNamesForCompany } from '../_shared/erpnext.ts';

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

    const body = (await req.json().catch(() => ({}))) as {
      business_id?: string;
      posting_date?: string;
      remark?: string;
      voucher_type?: string;
      accounts?: { account: string; debit: number; credit: number }[];
    };
    const businessId = body?.business_id;
    const postingDate = body?.posting_date?.slice(0, 10);
    const remark = body?.remark?.trim() || 'Manual adjustment';
    const voucherType = ['Journal Entry', 'Opening Entry', 'Bank Entry', 'Cash Entry'].includes(String(body?.voucher_type || '').trim())
      ? String(body.voucher_type).trim()
      : 'Journal Entry';
    const accounts = body?.accounts;
    if (!businessId || !postingDate || !Array.isArray(accounts) || accounts.length === 0) {
      return json({ error: 'Missing business_id, posting_date, or accounts array' });
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
      .select('user_id, role')
      .eq('business_id', businessId)
      .eq('user_id', userId)
      .in('role', ['owner', 'manager', 'admin'])
      .maybeSingle();
    if (!membership) return json({ error: 'Access denied to this business' });

    const { data: config, error: configErr } = await supabaseAdmin
      .from('accounting_business_config')
      .select('erpnext_api_url, erpnext_company_name, erpnext_api_key, erpnext_secret, period_lock_type, period_locked_until')
      .eq('business_id', businessId)
      .maybeSingle();
    if (configErr || !config) return json({ error: 'Accounting config not found' });

    if (config.period_locked_until) {
      const lockedUntil = new Date(config.period_locked_until).getTime();
      const postDate = new Date(postingDate).getTime();
      if (postDate <= lockedUntil) return json({ error: 'Posting date is in a locked period. Adjust in Accounting → Settings.' });
    }

    const baseUrl = (config.erpnext_api_url || '').replace(/\/$/, '');
    const company = (config.erpnext_company_name || '').trim();
    const apiKey = (config.erpnext_api_key || '').trim();
    const apiSecret = (config.erpnext_secret || '').trim();
    if (!baseUrl || !apiKey) return json({ error: 'ERPNext URL and API Key required' });

    const accRes = await fetchAccountNamesForCompany(baseUrl, apiKey, apiSecret, company);
    if (!accRes.ok || !accRes.accounts?.length) return json({ error: accRes.error || 'Could not load Chart of Accounts' });
    const validNames = new Set(accRes.accounts.filter((a) => !a.is_group).map((a) => a.name));

    const jeRows: { account: string; debit_in_account_currency: number; credit_in_account_currency: number }[] = [];
    let totalDebit = 0;
    let totalCredit = 0;
    for (const row of accounts) {
      const account = (row.account || '').trim();
      const debit = Number(row.debit) || 0;
      const credit = Number(row.credit) || 0;
      if (!account || (debit <= 0 && credit <= 0)) continue;
      if (!validNames.has(account)) return json({ error: `Account "${account}" not found or is a group account. Use exact ERPNext account name.` });
      jeRows.push({
        account,
        debit_in_account_currency: Math.round(debit * 100) / 100,
        credit_in_account_currency: Math.round(credit * 100) / 100
      });
      totalDebit += debit;
      totalCredit += credit;
    }
    const diff = Math.abs(totalDebit - totalCredit);
    if (diff > 0.02) return json({ error: 'Debits and credits must balance.' });

    const accountsPayload = jeRows.map((r) => ({
      account: r.account,
      debit_in_account_currency: r.debit_in_account_currency,
      credit_in_account_currency: r.credit_in_account_currency
    }));

    const jePayload = {
      doctype: 'Journal Entry',
      posting_date: postingDate,
      company,
      voucher_type: voucherType,
      user_remark: remark,
      accounts: accountsPayload
    };

    const createResult = await callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/resource/Journal Entry', jePayload);
    if (!createResult.ok) return json({ error: createResult.error || 'ERPNext request failed' });

    const jeData = createResult.data as Record<string, unknown> | undefined;
    const jeName = (jeData?.data as Record<string, string>)?.name ?? (jeData as Record<string, string>)?.name;
    if (!jeName) return json({ error: 'Journal Entry created but no name returned' });

    const fetchRes = await callErpNext(baseUrl, apiKey, apiSecret, 'GET', `/api/resource/Journal Entry/${encodeURIComponent(jeName)}`);
    const docToSubmit = fetchRes.ok && (fetchRes.data as { data?: Record<string, unknown> })?.data
      ? (fetchRes.data as { data: Record<string, unknown> }).data
      : { doctype: 'Journal Entry', name: jeName };

    const submitResult = await callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/method/frappe.client.submit', { doc: docToSubmit });
    if (!submitResult.ok) return json({ error: `Journal Entry created but submit failed: ${submitResult.error || 'unknown'}` });

    return json({ success: true, erpnext_journal_entry_id: jeName });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
