// Posts a draft sales batch to ERPNext as a Journal Entry (sales journal).
// POST body: { business_id, batch_id }
// JE: Dr Undeposited Funds (total_sales + total_tax), Cr POS Revenue, Cr Bookings Revenue, Cr HST Collected.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callErpNext, fetchCompanyAbbreviation, fetchAccountNamesForCompany, resolveLedgerAccount, findJournalEntryByUserRemark, appendCompanySuffix, logicalAccountFromErpNextName } from '../_shared/erpnext.ts';

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

  let claimedBatchForPosting: { businessId: string; batchId: string } | null = null;
  let erpnextSubmitted = false;
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' });

    const body = (await req.json().catch(() => ({}))) as { business_id?: string; batch_id?: string };
    const businessId = body?.business_id;
    const batchId = body?.batch_id;
    if (!businessId || !batchId) return json({ error: 'Missing business_id or batch_id' });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const isServiceRole = authHeader === `Bearer ${supabaseServiceKey}`;
    const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    let userId: string | null = null;
    if (!isServiceRole) {
      const { data: { user } } = await supabaseUser.auth.getUser();
      userId = user?.id ?? null;
      const { data: membership } = await supabaseUser
        .from('business_users')
        .select('user_id, role')
        .eq('business_id', businessId)
        .eq('user_id', userId)
        .in('role', ['owner', 'manager', 'admin'])
        .limit(1)
        .maybeSingle();
      if (!membership) return json({ error: 'Access denied to this business' });
    }

    const { data: batch, error: batchErr } = await supabaseAdmin
      .from('accounting_sales_batches')
      .select('*')
      .eq('id', batchId)
      .eq('business_id', businessId)
      .single();
    if (batchErr || !batch) return json({ error: 'Batch not found' });
    if (batch.status !== 'draft') return json({ error: 'Batch is already approved or posted' });

    const releasePostingLock = async () => {
      await supabaseAdmin
        .from('accounting_sales_batches')
        .update({ status: 'draft' })
        .eq('id', batchId)
        .eq('business_id', businessId)
        .eq('status', 'posting');
    };

    const { data: config, error: configErr } = await supabaseAdmin
      .from('accounting_business_config')
      .select('erpnext_api_url, erpnext_company_name, erpnext_company_abbr, erpnext_api_key, erpnext_secret, period_lock_type, period_locked_until, pos_revenue_account_erpnext, bookings_revenue_account_erpnext, hst_collected_account_erpnext')
      .eq('business_id', businessId)
      .maybeSingle();
    if (configErr || !config) return json({ error: 'Accounting config not found. Set up ERPNext in Accounting → Settings.' });
    if (!config.erpnext_api_url?.trim() || !config.erpnext_api_key?.trim()) return json({ error: 'ERPNext URL and API Key are required in Accounting → Settings.' });

    const postingDate = (batch.batch_date as string)?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    if (config.period_locked_until) {
      const lockedUntil = new Date(config.period_locked_until).getTime();
      const postDate = new Date(postingDate).getTime();
      if (postDate <= lockedUntil) return json({ error: `Batch date ${postingDate} is in a locked period. Unlock in Settings to approve.` });
    }

    const { data: items } = await supabaseAdmin
      .from('accounting_sales_batch_items')
      .select('source_type, amount, tax_amount')
      .eq('batch_id', batchId);
    const posSourceTypes = new Set(['pos', 'pos_payment', 'manual_sales']);
    const bookingSourceTypes = new Set(['booking', 'booking_payment']);
    const posTotal = (items || [])
      .filter((i: { source_type: string }) => posSourceTypes.has(i.source_type))
      .reduce((s: number, i: { amount?: number }) => s + Number(i.amount ?? 0), 0);
    const bookingTotal = (items || [])
      .filter((i: { source_type: string }) => bookingSourceTypes.has(i.source_type))
      .reduce((s: number, i: { amount?: number }) => s + Number(i.amount ?? 0), 0);
    const totalSales = Number(batch.total_sales_amount) || 0;
    const totalTax = Number(batch.total_tax_amount) || 0;
    const totalRefunds = Number(batch.total_refunds_amount) || 0;
    const totalRefundTax = Number(batch.total_refund_tax_amount) || 0;
    const refundRevenueAmount = round2(Math.max(0, totalRefunds - totalRefundTax));
    const debitTotal = round2(totalSales + totalTax - totalRefunds);

    const baseUrl = (config.erpnext_api_url || '').replace(/\/$/, '');
    const apiKey = (config.erpnext_api_key || '').trim();
    const apiSecret = ((config.erpnext_secret as string) ?? '').trim();
    let company = (config.erpnext_company_name || '').trim() || 'Company';
    let abbr = (config.erpnext_company_abbr || '').trim();
    if (!abbr) {
      const fetched = await fetchCompanyAbbreviation(baseUrl, apiKey, apiSecret, company === 'Company' ? undefined : company);
      if (!fetched.ok || !fetched.abbreviation) return json({ error: fetched.error || 'Could not get company abbreviation from ERPNext.' });
      abbr = fetched.abbreviation;
      if (fetched.companyName) company = fetched.companyName;
    }
    const suffix = ` - ${abbr}`;

    const accountsRes = await fetchAccountNamesForCompany(baseUrl, apiKey, apiSecret, company);
    if (!accountsRes.ok || !accountsRes.accounts?.length) return json({ error: accountsRes.error || 'Could not load Chart of Accounts from ERPNext.' });
    const accountList = accountsRes.accounts;

    const undepositedLogical = appendCompanySuffix('Undeposited Funds', abbr);
    const posRevenueLogical = appendCompanySuffix(
      logicalAccountFromErpNextName((config.pos_revenue_account_erpnext as string)?.trim() || 'Sales'),
      abbr,
    );
    const bookingsRevenueLogical = appendCompanySuffix(
      logicalAccountFromErpNextName((config.bookings_revenue_account_erpnext as string)?.trim() || 'Sales'),
      abbr,
    );
    const hstLogical = appendCompanySuffix(
      logicalAccountFromErpNextName((config.hst_collected_account_erpnext as string)?.trim() || 'HST'),
      abbr,
    );

    const drAccount = resolveLedgerAccount(accountList, undepositedLogical);
    const posAccount = resolveLedgerAccount(accountList, posRevenueLogical);
    const bookingsAccount = resolveLedgerAccount(accountList, bookingsRevenueLogical);
    const hstAccount = resolveLedgerAccount(accountList, hstLogical);

    if (!drAccount) {
      return json({
        error: `Undeposited Funds account not found for "${undepositedLogical}". Add "Undeposited Funds" under Current Assets in ERPNext Chart of Accounts.`
      });
    }
    if (debitTotal <= 0) {
      return json({
        error: `This sales batch for ${postingDate} has $0 net sales (sales ${totalSales.toFixed(2)}, tax ${totalTax.toFixed(2)}, refunds ${totalRefunds.toFixed(2)}). Delete empty draft batches or wait until the day’s sales are imported — you can’t post a $0 batch.`,
      });
    }
    if (posTotal > 0 && !posAccount) return json({ error: `Sales revenue account not found for "${posRevenueLogical}". Set in Accounting → Settings.` });
    if (bookingTotal > 0 && !bookingsAccount) return json({ error: `Bookings revenue account not found for "${bookingsRevenueLogical}". Set in Accounting → Settings.` });
    if (totalTax > 0 && !hstAccount) return json({ error: `HST Collected account not found for "${hstLogical}". Set in Accounting → Settings.` });

    const posShareOfRefund = totalSales > 0 ? round2((refundRevenueAmount * posTotal) / totalSales) : 0;
    const bookingShareOfRefund = round2(refundRevenueAmount - posShareOfRefund);
    const crPos = round2(Math.max(0, posTotal - posShareOfRefund));
    const crBookings = round2(Math.max(0, bookingTotal - bookingShareOfRefund));

    type JeRow = {
      account: string;
      debit: number;
      credit: number;
      debit_in_account_currency: number;
      credit_in_account_currency: number;
    };
    const accounts: JeRow[] = [];
    accounts.push({
      account: drAccount,
      debit: debitTotal,
      credit: 0,
      debit_in_account_currency: debitTotal,
      credit_in_account_currency: 0,
    });
    if (posTotal > 0 && posAccount && crPos > 0) {
      accounts.push({
        account: posAccount,
        debit: 0,
        credit: crPos,
        debit_in_account_currency: 0,
        credit_in_account_currency: crPos,
      });
    }
    if (bookingTotal > 0 && bookingsAccount && crBookings > 0) {
      accounts.push({
        account: bookingsAccount,
        debit: 0,
        credit: crBookings,
        debit_in_account_currency: 0,
        credit_in_account_currency: crBookings,
      });
    }
    if (totalTax > 0 && hstAccount) {
      const crHst = round2(Math.max(0, totalTax - totalRefundTax));
      if (crHst > 0) {
        accounts.push({
          account: hstAccount,
          debit: 0,
          credit: crHst,
          debit_in_account_currency: 0,
          credit_in_account_currency: crHst,
        });
      }
    }

    let creditSum = accounts.slice(1).reduce((s, r) => s + r.credit_in_account_currency, 0);
    const diff = round2(debitTotal - creditSum);
    if (Math.abs(diff) > 0.005 && accounts.length > 1) {
      accounts[1].credit = round2(accounts[1].credit + diff);
      accounts[1].credit_in_account_currency = round2(accounts[1].credit_in_account_currency + diff);
      creditSum = accounts.slice(1).reduce((s, r) => s + r.credit_in_account_currency, 0);
    }
    if (accounts.some((r) => r.debit <= 0 && r.credit <= 0)) {
      return json({ error: 'Sales batch journal has a zero amount line. Check sales/tax totals before posting.' });
    }

    const jePayload = {
      doctype: 'Journal Entry',
      posting_date: postingDate,
      company,
      voucher_type: 'Journal Entry',
      user_remark: `[TAVARI batch:${batchId}] Sales batch ${postingDate}`.slice(0, 140),
      accounts
    };

    const { data: claimedBatch, error: claimErr } = await supabaseAdmin
      .from('accounting_sales_batches')
      .update({ status: 'posting' })
      .eq('id', batchId)
      .eq('business_id', businessId)
      .eq('status', 'draft')
      .select('id')
      .maybeSingle();
    if (claimErr) return json({ error: claimErr.message || 'Failed to reserve batch for posting' });
    if (!claimedBatch?.id) return json({ error: 'Batch is already being posted or has already been posted' }, 409);
    claimedBatchForPosting = { businessId, batchId };

    const createResult = await callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/resource/Journal Entry', jePayload);
    if (!createResult.ok) {
      await releasePostingLock();
      return json({ error: createResult.error || 'ERPNext request failed' });
    }

    const jeData = createResult.data as Record<string, unknown> | undefined;
    let jeName = (jeData?.data as Record<string, string>)?.name ?? (jeData as Record<string, string>)?.name;
    if (!jeName) {
      jeName = await findJournalEntryByUserRemark(baseUrl, apiKey, apiSecret, String(jePayload.user_remark));
    }
    if (!jeName) {
      await releasePostingLock();
      return json({ error: 'Journal Entry was created but no ERPNext name was returned. Please try again.' });
    }

    const fetchRes = await callErpNext(baseUrl, apiKey, apiSecret, 'GET', `/api/resource/Journal Entry/${encodeURIComponent(jeName)}`);
    const docToSubmit = fetchRes.ok && (fetchRes.data as { data?: Record<string, unknown> })?.data
      ? (fetchRes.data as { data: Record<string, unknown> }).data
      : { doctype: 'Journal Entry', name: jeName };

    const submitResult = await callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/method/frappe.client.submit', { doc: docToSubmit });
    if (!submitResult.ok) {
      await releasePostingLock();
      return json({ error: `Journal Entry created but submit failed: ${submitResult.error || 'unknown'}` });
    }
    erpnextSubmitted = true;

    let { error: updateErr } = await supabaseAdmin
      .from('accounting_sales_batches')
      .update({
        status: 'posted',
        approved_by: userId,
        approved_at: new Date().toISOString(),
        erpnext_journal_entry_id: jeName
      })
      .eq('id', batchId)
      .eq('business_id', businessId);
    if (updateErr) {
      const retryResult = await supabaseAdmin
        .from('accounting_sales_batches')
        .update({
          status: 'posted',
          approved_by: userId,
          approved_at: new Date().toISOString(),
          erpnext_journal_entry_id: jeName
        })
        .eq('id', batchId)
        .eq('business_id', businessId);
      updateErr = retryResult.error;
    }
    if (updateErr) {
      claimedBatchForPosting = null;
      return json({ error: `ERPNext posted successfully as ${jeName}, but Tavari could not finalize the batch status. Refresh before retrying.` }, 500);
    }
    claimedBatchForPosting = null;

    return json({ success: true, erpnext_journal_entry_id: jeName });
  } catch (e) {
    console.error(e);
    if (claimedBatchForPosting && !erpnextSubmitted) {
      try {
        const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        await supabaseAdmin
          .from('accounting_sales_batches')
          .update({ status: 'draft' })
          .eq('id', claimedBatchForPosting.batchId)
          .eq('business_id', claimedBatchForPosting.businessId)
          .eq('status', 'posting');
      } catch (_) {}
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
