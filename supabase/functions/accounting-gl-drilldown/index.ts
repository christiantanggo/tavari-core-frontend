// Returns actual GL Entry rows (transaction-level) for one account and date range.
// If the account is a group (e.g. "Expenses - TOS"), resolves to all leaf accounts under it.
// POST body: { business_id, account_name, from_date, to_date }
// Response: { result: [...], columns: [...], period: { from_date, to_date } }

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

type AccountRow = { name?: string; parent_account?: string; is_group?: number };

/** Collect all leaf (is_group=0) account names under accountName; if accountName is a leaf, return [accountName]. */
function leafAccountsUnder(
  accountName: string,
  nameToAccount: Map<string, AccountRow>,
  parentToChildren: Map<string, AccountRow[]>
): string[] {
  const leaves: string[] = [];
  const stack = [accountName];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const name = stack.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const acc = nameToAccount.get(name);
    const isGroup = acc && (acc.is_group === 1 || (acc as { is_group?: boolean }).is_group === true);
    const children = parentToChildren.get(name);
    if (!children || children.length === 0) {
      if (!isGroup) leaves.push(name);
      continue;
    }
    for (const c of children) {
      const n = c?.name;
      if (n) stack.push(n);
    }
  }
  return leaves.length > 0 ? leaves : [accountName];
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' });

    const body = (await req.json().catch(() => ({}))) as {
      business_id?: string;
      account_name?: string;
      from_date?: string;
      to_date?: string;
    };
    const businessId = body?.business_id;
    const accountName = (body?.account_name ?? '').toString().trim();
    const fromDate = (body?.from_date ?? '').toString().slice(0, 10);
    const toDate = (body?.to_date ?? '').toString().slice(0, 10);

    if (!businessId) return json({ error: 'Missing business_id' });
    if (!accountName) return json({ error: 'Missing account_name' });
    if (!fromDate || !toDate) return json({ error: 'Missing from_date or to_date' });

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

    const accountResource = encodeURIComponent('Account');
    const companyFilter = encodeURIComponent(JSON.stringify([['company', '=', company]]));
    const accountFields = encodeURIComponent(JSON.stringify(['name', 'parent_account', 'is_group']));
    const allAccounts: AccountRow[] = [];
    let start = 0;
    const pageLen = 500;
    for (;;) {
      const accRes = await callErpNext(
        baseUrl,
        apiKey,
        apiSecret,
        'GET',
        `/api/resource/${accountResource}?filters=${companyFilter}&fields=${accountFields}&limit_start=${start}&limit_page_length=${pageLen}`
      );
      if (!accRes.ok) break;
      const payload = accRes.data as { data?: AccountRow[] };
      const list = Array.isArray(payload?.data) ? payload.data : [];
      for (const r of list) if (r?.name) allAccounts.push(r);
      if (list.length < pageLen) break;
      start += pageLen;
    }

    const nameToAccount = new Map<string, AccountRow>();
    const parentToChildren = new Map<string, AccountRow[]>();
    for (const a of allAccounts) {
      if (a.name) nameToAccount.set(a.name, a);
      const parent = (a.parent_account ?? '').toString().trim() || null;
      if (parent === null) continue;
      if (!parentToChildren.has(parent)) parentToChildren.set(parent, []);
      parentToChildren.get(parent)!.push(a);
    }

    const leafNames = leafAccountsUnder(accountName, nameToAccount, parentToChildren);
    const accountFilter = leafNames.length > 0
      ? ['account', 'in', leafNames]
      : ['account', '=', accountName];

    const filters = [
      accountFilter,
      ['posting_date', '>=', fromDate],
      ['posting_date', '<=', toDate],
      ...(company ? [['company', '=', company]] : [])
    ];
    const fields = [
      'posting_date',
      'account',
      'voucher_type',
      'voucher_no',
      'debit_in_account_currency',
      'credit_in_account_currency',
      'against',
      'party_type',
      'party',
      'remarks'
    ];
    const filtersEnc = encodeURIComponent(JSON.stringify(filters));
    const fieldsEnc = encodeURIComponent(JSON.stringify(fields));
    const glResource = encodeURIComponent('GL Entry');
    const glRes = await callErpNext(
      baseUrl,
      apiKey,
      apiSecret,
      'GET',
      `/api/resource/${glResource}?filters=${filtersEnc}&fields=${fieldsEnc}&limit_page_length=500&order_by=posting_date asc`
    );

    if (!glRes.ok) {
      return json({ error: glRes.error || 'Failed to load GL entries. Check ERPNext connection.' });
    }

    const glPayload = glRes.data as { data?: Record<string, unknown>[] };
    const rows = Array.isArray(glPayload?.data) ? glPayload.data : [];
    const columns = [
      { fieldname: 'posting_date', label: 'Date' },
      { fieldname: 'account', label: 'Account' },
      { fieldname: 'voucher_type', label: 'Type' },
      { fieldname: 'voucher_no', label: 'Reference' },
      { fieldname: 'debit_in_account_currency', label: 'Debit' },
      { fieldname: 'credit_in_account_currency', label: 'Credit' },
      { fieldname: 'against', label: 'Against' },
      { fieldname: 'party', label: 'Party' },
      { fieldname: 'remarks', label: 'Remarks' }
    ];

    return json({
      account_name: accountName,
      period: { from_date: fromDate, to_date: toDate },
      result: rows,
      columns
    });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
