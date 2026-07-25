// Create a general ledger account in ERPNext for the business company.
// POST { business_id, account_name, root_type, account_type?, parent_account? }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createErpNextDoc, fetchAccountNamesForCompany } from '../_shared/erpnext.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(obj: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

type RootType = 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense';

const ROOT_DEFAULTS: Record<RootType, { report_type: string; account_type: string }> = {
  Asset: { report_type: 'Balance Sheet', account_type: '' },
  Liability: { report_type: 'Balance Sheet', account_type: '' },
  Equity: { report_type: 'Balance Sheet', account_type: 'Equity' },
  Income: { report_type: 'Profit and Loss', account_type: 'Income Account' },
  Expense: { report_type: 'Profit and Loss', account_type: 'Expense Account' },
};

function isGroupAccount(value: number | boolean | undefined) {
  return value === 1 || value === true;
}

function pickParent(
  accounts: Array<Record<string, unknown>>,
  rootType: RootType,
  preferredParent?: string,
) {
  if (preferredParent) {
    const exact = accounts.find((a) => String(a.name || '') === preferredParent && isGroupAccount(a.is_group as number | boolean | undefined));
    if (exact) return exact;
  }
  const groups = accounts.filter((a) =>
    isGroupAccount(a.is_group as number | boolean | undefined)
    && String(a.root_type || '') === rootType
  );
  const byName = (re: RegExp) => groups.find((a) => re.test(String(a.account_name || a.name || '')));
  if (rootType === 'Asset') {
    return byName(/current assets/i) || byName(/application of funds/i) || groups[0] || null;
  }
  if (rootType === 'Liability') {
    return byName(/current liabilities/i) || byName(/source of funds/i) || groups[0] || null;
  }
  if (rootType === 'Equity') {
    return byName(/equity/i) || byName(/source of funds/i) || groups[0] || null;
  }
  if (rootType === 'Income') {
    return byName(/income/i) || groups[0] || null;
  }
  return byName(/expense/i) || byName(/indirect expenses/i) || groups[0] || null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const body = (await req.json().catch(() => ({}))) as {
      business_id?: string;
      account_name?: string;
      root_type?: string;
      account_type?: string;
      parent_account?: string;
    };

    const businessId = body.business_id?.trim();
    const accountName = body.account_name?.trim();
    const rootType = (body.root_type || '').trim() as RootType;
    if (!businessId) return json({ error: 'Missing business_id' }, 400);
    if (!accountName) return json({ error: 'Enter an account name' }, 400);
    if (!['Asset', 'Liability', 'Equity', 'Income', 'Expense'].includes(rootType)) {
      return json({ error: 'Choose root type: Asset, Liability, Equity, Income, or Expense' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user } } = await supabaseUser.auth.getUser();
    const { data: membership } = await supabaseUser
      .from('business_users')
      .select('role')
      .eq('business_id', businessId)
      .eq('user_id', user?.id)
      .in('role', ['owner', 'manager', 'admin'])
      .maybeSingle();
    if (!membership) return json({ error: 'Access denied to this business' }, 403);

    const { data: config } = await supabaseAdmin
      .from('accounting_business_config')
      .select('erpnext_api_url, erpnext_company_name, erpnext_api_key, erpnext_secret')
      .eq('business_id', businessId)
      .maybeSingle();
    if (!config) return json({ error: 'Accounting config not found' }, 404);

    const baseUrl = (config.erpnext_api_url || '').replace(/\/$/, '');
    const company = (config.erpnext_company_name || '').trim();
    const apiKey = (config.erpnext_api_key || '').trim();
    const apiSecret = (config.erpnext_secret || '').trim();
    if (!baseUrl || !apiKey || !company) {
      return json({ error: 'ERPNext connection is not fully configured' }, 400);
    }

    const accountResult = await fetchAccountNamesForCompany(baseUrl, apiKey, apiSecret, company);
    if (!accountResult.ok) return json({ error: accountResult.error || 'Failed to fetch chart of accounts' }, 500);

    const existing = (accountResult.accounts || []).find((account) => {
      const full = String(account.name || '').trim().toLowerCase();
      const short = String(account.account_name || '').trim().toLowerCase();
      const requested = accountName.toLowerCase();
      return full === requested || short === requested || full.startsWith(`${requested} - `);
    });
    if (existing) return json({ error: `Account already exists: ${existing.name}` }, 409);

    const defaults = ROOT_DEFAULTS[rootType];
    const parent = pickParent(accountResult.accounts || [], rootType, body.parent_account?.trim());
    if (!parent?.name) {
      return json({ error: `Could not find a parent ${rootType} group account in ERPNext` }, 400);
    }

    const accountType = (body.account_type || '').trim() || defaults.account_type;
    const payload: Record<string, unknown> = {
      account_name: accountName,
      company,
      parent_account: parent.name,
      is_group: 0,
      root_type: rootType,
      report_type: defaults.report_type,
    };
    if (accountType) payload.account_type = accountType;

    const created = await createErpNextDoc(baseUrl, apiKey, apiSecret, 'Account', payload);
    if (!created.ok) return json({ error: created.error || 'Failed to create account in ERPNext' }, 500);

    return json({
      success: true,
      account: {
        name: created.name || created.data?.name || accountName,
        account_name: created.data?.account_name || accountName,
        parent_account: parent.name,
        root_type: rootType,
        report_type: defaults.report_type,
        account_type: accountType || null,
      },
    });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
