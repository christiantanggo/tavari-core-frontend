// Posts a draft deposit to ERPNext as a Journal Entry (bank deposit).
// If the deposit has linked batches (accounting_deposit_batches), posts each linked draft batch first (one sales JE per batch), then posts the deposit JE.
// POST body: { business_id, deposit_id }
// JE: Dr Bank (total_amount), Cr Undeposited Funds (total_amount).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callErpNext, fetchCompanyAbbreviation, fetchAccountNamesForCompany, resolveLedgerAccount, findJournalEntryByUserRemark, logicalAccountFromErpNextName, appendCompanySuffix } from '../_shared/erpnext.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(obj: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Invoke accounting-post-batch for a linked draft batch; returns { ok, error }. */
async function postBatchViaInvoke(
  supabaseUrl: string,
  authHeader: string,
  businessId: string,
  batchId: string
): Promise<{ ok: boolean; error?: string }> {
  const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/accounting-post-batch`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_id: businessId, batch_id: batchId })
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    if (data?.error) return { ok: false, error: data.error };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let claimedDepositForPosting: { businessId: string; depositId: string } | null = null;
  let erpnextSubmitted = false;
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' });

    const body = (await req.json().catch(() => ({}))) as { business_id?: string; deposit_id?: string };
    const businessId = body?.business_id;
    const depositId = body?.deposit_id;
    if (!businessId || !depositId) return json({ error: 'Missing business_id or deposit_id' });

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

    const { data: deposit, error: depositErr } = await supabaseAdmin
      .from('accounting_deposits')
      .select('*')
      .eq('id', depositId)
      .eq('business_id', businessId)
      .single();
    if (depositErr || !deposit) return json({ error: 'Deposit not found' });
    if (deposit.status !== 'draft') return json({ error: 'Deposit is already approved or posted' });

    const releasePostingLock = async () => {
      await supabaseAdmin
        .from('accounting_deposits')
        .update({ status: 'draft' })
        .eq('id', depositId)
        .eq('business_id', businessId)
        .eq('status', 'posting');
    };

    const { data: depositBatches } = await supabaseAdmin
      .from('accounting_deposit_batches')
      .select('batch_id')
      .eq('deposit_id', depositId);
    const linkedBatchIds = (depositBatches || []).map((r: { batch_id: string }) => r.batch_id);
    if (linkedBatchIds.length > 0) {
      const { data: batches } = await supabaseAdmin
        .from('accounting_sales_batches')
        .select('id, batch_date')
        .in('id', linkedBatchIds)
        .eq('business_id', businessId)
        .eq('status', 'draft')
        .order('batch_date', { ascending: true });
      const draftBatches = (batches || []) as { id: string; batch_date: string }[];
      for (const b of draftBatches) {
        const result = await postBatchViaInvoke(supabaseUrl, authHeader, businessId, b.id);
        if (!result.ok) return json({ error: `Could not post linked batch ${b.batch_date}: ${result.error || 'unknown'}` });
      }
    }

    const { data: config, error: configErr } = await supabaseAdmin
      .from('accounting_business_config')
      .select('erpnext_api_url, erpnext_company_name, erpnext_company_abbr, erpnext_api_key, erpnext_secret, period_lock_type, period_locked_until')
      .eq('business_id', businessId)
      .maybeSingle();
    if (configErr || !config) return json({ error: 'Accounting config not found. Set up ERPNext in Accounting → Settings.' });
    if (!config.erpnext_api_url?.trim() || !config.erpnext_api_key?.trim()) return json({ error: 'ERPNext URL and API Key are required in Accounting → Settings.' });

    const postingDate = (deposit.deposit_date as string)?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    if (config.period_locked_until) {
      const lockedUntil = new Date(config.period_locked_until).getTime();
      const postDate = new Date(postingDate).getTime();
      if (postDate <= lockedUntil) return json({ error: `Deposit date ${postingDate} is in a locked period. Unlock in Settings to approve.` });
    }

    const totalAmount = Math.abs(Number(deposit.total_amount)) || 0;
    if (totalAmount <= 0) return json({ error: 'Deposit total amount must be greater than zero' });

    const { data: linkedBankTxRows } = await supabaseAdmin
      .from('accounting_bank_transactions')
      .select('id')
      .eq('matched_deposit_id', depositId)
      .limit(1);

    const { data: matchLines, error: matchLinesError } = await supabaseAdmin
      .from('accounting_deposit_match_lines')
      .select('batch_id, matched_amount, line_type, metadata')
      .eq('deposit_id', depositId)
      .eq('business_id', businessId);
    if (matchLinesError) return json({ error: matchLinesError.message || 'Failed to load deposit match lines' });

    if ((linkedBankTxRows || []).length > 0 || (matchLines || []).length > 0) {
      const matchedTotal = round2((matchLines || []).reduce((sum: number, line: { matched_amount?: number }) => sum + Number(line.matched_amount ?? 0), 0));
      if (Math.abs(matchedTotal - totalAmount) > 0.009) {
        return json({ error: `Deposit match lines total ${matchedTotal.toFixed(2)} but the bank deposit is ${totalAmount.toFixed(2)}. Balance the match before approving.` });
      }

      const uniqueBatchIds = Array.from(new Set((matchLines || []).map((line: { batch_id?: string | null }) => line.batch_id).filter(Boolean))) as string[];
      if (uniqueBatchIds.length > 0) {
        const { data: existingDepositBatches } = await supabaseAdmin
          .from('accounting_deposit_batches')
          .select('batch_id')
          .eq('deposit_id', depositId);
        const existingBatchIds = new Set((existingDepositBatches || []).map((row: { batch_id: string }) => row.batch_id));
        const missingBatchIds = uniqueBatchIds.filter((id) => !existingBatchIds.has(id));
        if (missingBatchIds.length > 0) {
          const { error: insertDepositBatchError } = await supabaseAdmin
            .from('accounting_deposit_batches')
            .insert(missingBatchIds.map((batchId) => ({ deposit_id: depositId, batch_id: batchId })));
          if (insertDepositBatchError) return json({ error: insertDepositBatchError.message || 'Failed to link deposit batches from match lines' });
        }

        const { error: batchLinkError } = await supabaseAdmin
          .from('accounting_sales_batches')
          .update({ deposit_id: depositId })
          .in('id', uniqueBatchIds);
        if (batchLinkError) return json({ error: batchLinkError.message || 'Failed to attach matched batches to deposit' });
      }
    }

    const baseUrl = (config.erpnext_api_url as string || '').replace(/\/$/, '');
    const apiKey = ((config.erpnext_api_key as string) || '').trim();
    const apiSecret = ((config.erpnext_secret as string) ?? '').trim();
    let company = ((config.erpnext_company_name as string) || '').trim() || 'Company';
    let abbr = ((config.erpnext_company_abbr as string) || '').trim();
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

    // Strip any prior company suffix (e.g. leftover "- TOS") before attaching this company's abbr.
    const bankLogical = appendCompanySuffix(
      logicalAccountFromErpNextName((deposit.bank_account_erpnext as string)?.trim() || 'Cash'),
      abbr,
    );
    const undepositedLogical = appendCompanySuffix('Undeposited Funds', abbr);
    const counterpartAccountLogical = (matchLines || [])
      .map((line: { metadata?: Record<string, unknown> | null }) => String(line?.metadata?.counterpart_account_erpnext || '').trim())
      .find(Boolean);
    const hasBatchItemLines = (matchLines || []).some((line: { line_type?: string | null }) => line.line_type === 'batch_item');
    const isOtherDeposit = !hasBatchItemLines && Boolean(counterpartAccountLogical);

    const bankAccount = resolveLedgerAccount(accountList, bankLogical)
      ?? resolveLedgerAccount(accountList, appendCompanySuffix('Cash', abbr));
    const crAccountLogical = isOtherDeposit
      ? appendCompanySuffix(logicalAccountFromErpNextName(counterpartAccountLogical), abbr)
      : undepositedLogical;
    const crAccount = resolveLedgerAccount(accountList, crAccountLogical);

    if (!bankAccount) return json({ error: `Bank account not found for "${bankLogical}". Set deposit's bank account or add "Cash${suffix}" in ERPNext.` });
    if (!crAccount) {
      return json({
        error: isOtherDeposit
          ? `Counterpart account not found for "${crAccountLogical}". Choose a valid ERPNext account for this deposit.`
          : `Undeposited Funds account not found for "${undepositedLogical}". Add "Undeposited Funds" under Current Assets in ERPNext Chart of Accounts, then try again.`
      });
    }
    if (bankAccount === crAccount) {
      return json({
        error: `Deposit would debit and credit the same account (${bankAccount}). Sales deposits need a separate Undeposited Funds account; other deposits need a different counterpart account from the bank.`
      });
    }

    type JeRow = {
      account: string;
      debit: number;
      credit: number;
      debit_in_account_currency: number;
      credit_in_account_currency: number;
    };
    const accounts: JeRow[] = [
      {
        account: bankAccount,
        debit: totalAmount,
        credit: 0,
        debit_in_account_currency: totalAmount,
        credit_in_account_currency: 0,
      },
      {
        account: crAccount,
        debit: 0,
        credit: totalAmount,
        debit_in_account_currency: 0,
        credit_in_account_currency: totalAmount,
      },
    ];

    const jePayload = {
      doctype: 'Journal Entry',
      posting_date: postingDate,
      company,
      voucher_type: 'Bank Entry',
      cheque_no: `TAVARI-DEP-${depositId.slice(0, 8)}`,
      cheque_date: postingDate,
      user_remark: `[TAVARI deposit:${depositId}] Deposit ${postingDate}`.slice(0, 140),
      accounts
    };

    const { data: claimedDeposit, error: claimErr } = await supabaseAdmin
      .from('accounting_deposits')
      .update({ status: 'posting' })
      .eq('id', depositId)
      .eq('business_id', businessId)
      .eq('status', 'draft')
      .select('id')
      .maybeSingle();
    if (claimErr) return json({ error: claimErr.message || 'Failed to reserve deposit for posting' });
    if (!claimedDeposit?.id) return json({ error: 'Deposit is already being posted or has already been posted' }, 409);
    claimedDepositForPosting = { businessId, depositId };

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
      .from('accounting_deposits')
      .update({
        status: 'posted',
        approved_by: userId,
        approved_at: new Date().toISOString(),
        erpnext_journal_entry_id: jeName
      })
      .eq('id', depositId)
      .eq('business_id', businessId);
    if (updateErr) {
      const retryResult = await supabaseAdmin
        .from('accounting_deposits')
        .update({
          status: 'posted',
          approved_by: userId,
          approved_at: new Date().toISOString(),
          erpnext_journal_entry_id: jeName
        })
        .eq('id', depositId)
        .eq('business_id', businessId);
      updateErr = retryResult.error;
    }
    if (updateErr) {
      claimedDepositForPosting = null;
      return json({ error: `ERPNext posted successfully as ${jeName}, but Tavari could not finalize the deposit status. Refresh before retrying.` }, 500);
    }
    claimedDepositForPosting = null;

    return json({ success: true, erpnext_journal_entry_id: jeName });
  } catch (e) {
    console.error(e);
    if (claimedDepositForPosting && !erpnextSubmitted) {
      try {
        const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        await supabaseAdmin
          .from('accounting_deposits')
          .update({ status: 'draft' })
          .eq('id', claimedDepositForPosting.depositId)
          .eq('business_id', claimedDepositForPosting.businessId)
          .eq('status', 'posting');
      } catch (_) {}
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
