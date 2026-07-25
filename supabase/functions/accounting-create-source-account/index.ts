import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createErpNextDoc, fetchAccountNamesForCompany } from '../_shared/erpnext.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(obj: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

type SourceAccountKind = 'bank' | 'cash' | 'credit_card';

function isGroupAccount(value: number | boolean | undefined) {
  return value === 1 || value === true;
}

function pickParentAccount(accounts: Array<Record<string, unknown>>, kind: SourceAccountKind) {
  const groups = accounts.filter((account) => isGroupAccount(account.is_group as number | boolean | undefined));
  const match = (predicate: (account: Record<string, unknown>) => boolean) => groups.find(predicate);
  const byName = (regex: RegExp) => match((account) => regex.test(String(account.account_name || account.name || '')));
  const byBalanceSheet = (rootType: string) => match((account) =>
    String(account.root_type || '').toLowerCase() === rootType
    && String(account.report_type || '').toLowerCase() === 'balance sheet'
  );

  if (kind === 'bank') {
    return (
      byName(/bank accounts/i)
      || byName(/current assets/i)
      || byBalanceSheet('asset')
      || null
    );
  }

  if (kind === 'cash') {
    return (
      byName(/cash in hand/i)
      || byName(/current assets/i)
      || byBalanceSheet('asset')
      || null
    );
  }

  return (
    byName(/current liabilities/i)
    || byBalanceSheet('liability')
    || null
  );
}

function getKindDefaults(kind: SourceAccountKind) {
  if (kind === 'bank') {
    return { root_type: 'Asset', report_type: 'Balance Sheet', account_type: 'Bank' };
  }
  if (kind === 'cash') {
    return { root_type: 'Asset', report_type: 'Balance Sheet', account_type: 'Cash' };
  }
  return { root_type: 'Liability', report_type: 'Balance Sheet', account_type: 'Credit Card' };
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
      account_kind?: SourceAccountKind;
    };

    const businessId = body?.business_id?.trim();
    const accountName = body?.account_name?.trim();
    const accountKind = body?.account_kind;

    if (!businessId) return json({ error: 'Missing business_id' }, 400);
    if (!accountName) return json({ error: 'Enter an account name' }, 400);
    if (!['bank', 'cash', 'credit_card'].includes(accountKind || '')) return json({ error: 'Choose a valid source account type' }, 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: membership } = await supabaseUser
      .from('business_users')
      .select('role')
      .eq('business_id', businessId)
      .limit(1)
      .maybeSingle();

    if (!membership) return json({ error: 'Access denied to this business' }, 403);

    const { data: config, error: configErr } = await supabaseAdmin
      .from('accounting_business_config')
      .select('erpnext_api_url, erpnext_company_name, erpnext_api_key, erpnext_secret')
      .eq('business_id', businessId)
      .maybeSingle();

    if (configErr || !config) return json({ error: 'Accounting config not found' }, 404);

    const baseUrl = (config.erpnext_api_url || '').replace(/\/$/, '');
    const company = (config.erpnext_company_name || '').trim();
    const apiKey = (config.erpnext_api_key || '').trim();
    const apiSecret = (config.erpnext_secret || '').trim();

    if (!baseUrl || !apiKey || !company) {
      return json({ error: 'ERPNext connection is not fully configured in Accounting Settings' }, 400);
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

    const defaults = getKindDefaults(accountKind as SourceAccountKind);
    const parent = pickParentAccount(accountResult.accounts || [], accountKind as SourceAccountKind);
    if (!parent?.name) {
      return json({ error: 'Could not find a suitable parent account in ERPNext. Set up your chart of accounts first.' }, 400);
    }

    const created = await createErpNextDoc(baseUrl, apiKey, apiSecret, 'Account', {
      account_name: accountName,
      company,
      parent_account: parent.name,
      is_group: 0,
      root_type: defaults.root_type,
      report_type: defaults.report_type,
      account_type: defaults.account_type
    });

    if (!created.ok) return json({ error: created.error || 'Failed to create source account in ERPNext' }, 500);

    return json({
      success: true,
      account: {
        name: created.name || created.data?.name || accountName,
        account_name: created.data?.account_name || accountName,
        parent_account: parent.name,
        root_type: defaults.root_type,
        report_type: defaults.report_type,
        account_type: defaults.account_type
      }
    });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
