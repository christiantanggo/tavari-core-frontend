// Filing readiness checks for CRA handoff: HST mapping, queue, bank, tax reconciliation, trial balance.
// POST body: { business_id, from_date, to_date }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  appendCompanySuffix,
  callErpNext,
  resolveErpNextFiscalYearName,
  sumGlEntryNetDebitsForAccount,
} from '../_shared/erpnext.ts';
import { deriveGst34Worksheet, normalizeHstSummary, sumPostedExpenseRecoverableItc, summarizeTrialBalanceReport } from '../_shared/gst34Worksheet.ts';
import { buildHstAdjustmentSchedule } from '../_shared/hstAdjustmentSchedule.ts';

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

type CheckStatus = 'pass' | 'warn' | 'fail';

function check(
  id: string,
  title: string,
  status: CheckStatus,
  message: string,
  detail: Record<string, unknown> = {}
) {
  return { id, title, status, message, ...detail };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function runHstGl(baseUrl: string, apiKey: string, apiSecret: string, company: string, fromDate: string, toDate: string) {
  return callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/method/frappe.desk.query_report.run', {
    report_name: 'General Ledger',
    filters: { company, from_date: fromDate, to_date: toDate },
  });
}

async function runTrialBalance(
  baseUrl: string,
  apiKey: string,
  apiSecret: string,
  company: string,
  fromDate: string,
  toDate: string,
  fiscalYear?: string,
) {
  const filters: Record<string, unknown> = {
    company,
    from_date: fromDate,
    to_date: toDate,
    periodicity: 'Monthly',
  };
  if (fiscalYear) filters.fiscal_year = fiscalYear;
  return callErpNext(baseUrl, apiKey, apiSecret, 'POST', '/api/method/frappe.desk.query_report.run', {
    report_name: 'Trial Balance',
    filters,
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const body = (await req.json().catch(() => ({}))) as {
      business_id?: string;
      from_date?: string;
      to_date?: string;
    };
    const businessId = body?.business_id;
    const fromDate = body?.from_date?.slice(0, 10);
    const toDate = body?.to_date?.slice(0, 10);
    if (!businessId || !fromDate || !toDate) {
      return json({ error: 'Missing business_id, from_date, or to_date' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const isServiceRole = authHeader === `Bearer ${serviceKey}`;

    if (!isServiceRole) {
      const supabaseUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await supabaseUser.auth.getUser();
      const { data: membership } = await supabaseUser
        .from('business_users')
        .select('user_id')
        .eq('business_id', businessId)
        .eq('user_id', user?.id)
        .in('role', ['owner', 'manager', 'admin'])
        .maybeSingle();
      if (!membership) return json({ error: 'Access denied' }, 403);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey);
    const { data: config, error: configErr } = await supabaseAdmin
      .from('accounting_business_config')
      .select('*')
      .eq('business_id', businessId)
      .maybeSingle();
    if (configErr || !config) return json({ error: 'Accounting config not found' }, 404);

    const baseUrl = (config.erpnext_api_url || '').replace(/\/$/, '');
    const apiKey = (config.erpnext_api_key || '').trim();
    const apiSecret = (config.erpnext_secret || '').trim();
    const company = (config.erpnext_company_name || '').trim();
    const companyAbbr = (config.erpnext_company_abbr || '').trim();
    const checks: Array<Record<string, unknown>> = [];

    const hstCollectedMapped = !!(config.hst_collected_account_erpnext || '').trim();
    const hstRecoverableMapped = !!(config.hst_recoverable_account_erpnext || '').trim();
    checks.push(check(
      'hst_accounts_mapped',
      'HST account mapping',
      hstCollectedMapped && hstRecoverableMapped ? 'pass' : 'fail',
      hstCollectedMapped && hstRecoverableMapped
        ? `Collected → ${config.hst_collected_account_erpnext}; Recoverable → ${config.hst_recoverable_account_erpnext}`
        : 'Set HST Collected and HST Recoverable accounts in Accounting → Settings before filing.',
      {
        hst_collected_account_erpnext: config.hst_collected_account_erpnext || null,
        hst_recoverable_account_erpnext: config.hst_recoverable_account_erpnext || null,
      }
    ));

    const { count: draftQueueCount } = await supabaseAdmin
      .from('accounting_draft_expenses')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('status', 'draft')
      .gte('transaction_date', fromDate)
      .lte('transaction_date', toDate);

    checks.push(check(
      'expense_queue_clear',
      'Expense queue (period)',
      (draftQueueCount || 0) === 0 ? 'pass' : 'warn',
      (draftQueueCount || 0) === 0
        ? 'No draft expenses dated in this period.'
        : `${draftQueueCount} draft expense(s) dated in this period still need review.`,
      { draft_count: draftQueueCount || 0 }
    ));

    const { count: draftBatchCount } = await supabaseAdmin
      .from('accounting_sales_batches')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('status', 'draft')
      .gte('batch_date', fromDate)
      .lte('batch_date', toDate);

    checks.push(check(
      'sales_batch_queue_clear',
      'Sales batches (period)',
      (draftBatchCount || 0) === 0 ? 'pass' : 'warn',
      (draftBatchCount || 0) === 0
        ? 'No draft sales batches in this period.'
        : `${draftBatchCount} draft sales batch(es) in this period still need posting.`,
      { draft_batch_count: draftBatchCount || 0 }
    ));

    const { data: imports } = await supabaseAdmin
      .from('accounting_bank_imports')
      .select('id')
      .eq('business_id', businessId);
    const importIds = (imports || []).map((r: { id: string }) => r.id);
    let pendingBankCount = 0;
    if (importIds.length > 0) {
      const { count } = await supabaseAdmin
        .from('accounting_bank_transactions')
        .select('id', { count: 'exact', head: true })
        .in('import_id', importIds)
        .eq('status', 'pending')
        .gte('transaction_date', fromDate)
        .lte('transaction_date', toDate);
      pendingBankCount = count || 0;
    }

    checks.push(check(
      'bank_transactions_clear',
      'Bank transactions (period)',
      pendingBankCount === 0 ? 'pass' : 'warn',
      pendingBankCount === 0
        ? 'No pending bank transactions dated in this period.'
        : `${pendingBankCount} pending bank transaction(s) in this period need categorization or posting.`,
      { pending_bank_count: pendingBankCount }
    ));

    const { data: postedBatches } = await supabaseAdmin
      .from('accounting_sales_batches')
      .select('total_tax_amount, total_sales_amount')
      .eq('business_id', businessId)
      .eq('status', 'posted')
      .gte('batch_date', fromDate)
      .lte('batch_date', toDate);
    const tavariBatchTax = round2((postedBatches || []).reduce((s, b) => s + Number(b.total_tax_amount || 0), 0));
    const tavariBatchSales = round2((postedBatches || []).reduce((s, b) => s + Number(b.total_sales_amount || 0), 0));

    const { data: postedExpenses } = await supabaseAdmin
      .from('accounting_draft_expenses')
      .select('tax_amount, subtotal, total_amount, hst_treatment, document_type')
      .eq('business_id', businessId)
      .eq('status', 'posted')
      .gte('transaction_date', fromDate)
      .lte('transaction_date', toDate);
    const tavariExpenseTax = sumPostedExpenseRecoverableItc(postedExpenses || []);

    let worksheet: Record<string, number> = {};
    let gst34Warnings: string[] = [];
    let hstSummary = normalizeHstSummary({});

    if (baseUrl && apiKey && company) {
      const hstRes = await runHstGl(baseUrl, apiKey, apiSecret, company, fromDate, toDate);
      if (hstRes.ok) {
        const hstData = hstRes.data as Record<string, unknown> | undefined;
        const hstMessage = hstData?.message as Record<string, unknown> | undefined;
        const glRows = (hstMessage?.result ?? hstData) as unknown[];
        const wsResult = deriveGst34Worksheet(Array.isArray(glRows) ? glRows : [], hstMessage?.columns as Array<{ fieldname?: string; label?: string }>, {
          revenueAccounts: [config.pos_revenue_account_erpnext, config.bookings_revenue_account_erpnext].filter(Boolean),
          hstCollectedAccounts: [config.hst_collected_account_erpnext].filter(Boolean),
          hstRecoverableAccounts: [config.hst_recoverable_account_erpnext].filter(Boolean),
        });
        worksheet = wsResult.worksheet;
        gst34Warnings = wsResult.warnings;
        hstSummary = normalizeHstSummary(worksheet);

        // GL report rows often omit account on detail lines; use GL Entry sums for tax boxes.
        if (companyAbbr) {
          const collectedLogical = (config.hst_collected_account_erpnext || '').trim();
          const recoverableLogical = (config.hst_recoverable_account_erpnext || '').trim();
          if (collectedLogical) {
            const collectedAccount = appendCompanySuffix(collectedLogical, companyAbbr);
            const collectedRes = await sumGlEntryNetDebitsForAccount(
              baseUrl, apiKey, apiSecret, company, collectedAccount, fromDate, toDate,
            );
            if (collectedRes.ok) {
              const netCredits = round2(Math.max(0, -collectedRes.netDebits));
              worksheet.hst_collected = netCredits;
              worksheet.box_103 = netCredits;
            }
          }
          if (recoverableLogical) {
            const recoverableAccount = appendCompanySuffix(recoverableLogical, companyAbbr);
            const recoverableRes = await sumGlEntryNetDebitsForAccount(
              baseUrl, apiKey, apiSecret, company, recoverableAccount, fromDate, toDate,
            );
            if (recoverableRes.ok) {
              const netDebits = round2(Math.max(0, recoverableRes.netDebits));
              worksheet.hst_recoverable = netDebits;
              worksheet.box_106 = netDebits;
            }
          }
          worksheet.box_109 = round2(worksheet.box_103 - worksheet.box_106);
          hstSummary = normalizeHstSummary(worksheet);
        }
      } else {
        checks.push(check('erpnext_gl', 'ERPNext GL', 'fail', hstRes.error || 'Could not load General Ledger', {}));
      }

      const collectedVariance = round2(Math.abs(hstSummary.hst_collected - tavariBatchTax));
      checks.push(check(
        'hst_collected_reconciled',
        'HST collected (batches vs GL)',
        collectedVariance <= 1 ? 'pass' : collectedVariance <= 10 ? 'warn' : 'fail',
        `Tavari posted batch tax: $${tavariBatchTax.toFixed(2)} · GL box 103: $${hstSummary.hst_collected.toFixed(2)} · Variance: $${collectedVariance.toFixed(2)}`,
        { tavari_batch_tax: tavariBatchTax, gl_box_103: hstSummary.hst_collected, variance: collectedVariance, tavari_batch_sales: tavariBatchSales }
      ));

      const itcVariance = round2(Math.abs(hstSummary.hst_paid_on_expenses - tavariExpenseTax));
      checks.push(check(
        'hst_recoverable_reconciled',
        'HST recoverable (expenses vs GL)',
        itcVariance <= 1 ? 'pass' : itcVariance <= 10 ? 'warn' : 'fail',
        `Tavari posted expense tax: $${tavariExpenseTax.toFixed(2)} · GL box 106: $${hstSummary.hst_paid_on_expenses.toFixed(2)} · Variance: $${itcVariance.toFixed(2)}`,
        { tavari_expense_tax: tavariExpenseTax, gl_box_106: hstSummary.hst_paid_on_expenses, variance: itcVariance }
      ));

      const fyRes = await resolveErpNextFiscalYearName(baseUrl, apiKey, apiSecret, toDate, company);
      if (!fyRes.ok) {
        checks.push(check(
          'trial_balance',
          'Trial balance',
          'warn',
          `Could not resolve ERPNext fiscal year for ${toDate}. ${fyRes.error || ''}`.trim(),
          { fiscal_year_error: fyRes.error || null },
        ));
      } else {
      const tbRes = await runTrialBalance(
        baseUrl, apiKey, apiSecret, company, fromDate, toDate, fyRes.name,
      );
      if (tbRes.ok) {
        const tbData = tbRes.data as Record<string, unknown> | undefined;
        const tbMessage = tbData?.message as Record<string, unknown> | undefined;
        const tbRows = (tbMessage?.result ?? tbData) as unknown[];
        const tbSummary = summarizeTrialBalanceReport(Array.isArray(tbRows) ? tbRows : []);
        if (!tbSummary.hasTotalRow) {
          checks.push(check(
            'trial_balance',
            'Trial balance',
            'warn',
            'Trial balance loaded but no Total row was found. Review ERPNext manually.',
            {},
          ));
        } else {
          checks.push(check(
            'trial_balance',
            'Trial balance (period activity)',
            tbSummary.periodDifference <= 0.05 ? 'pass' : 'fail',
            tbSummary.periodDifference <= 0.05
              ? `Period debits and credits balance (Δ $${tbSummary.periodDifference.toFixed(2)}).`
              : `Period trial balance out of balance by $${tbSummary.periodDifference.toFixed(2)}. Review ERPNext before filing.`,
            {
              period_debit: tbSummary.periodDebit,
              period_credit: tbSummary.periodCredit,
              period_difference: tbSummary.periodDifference,
              fiscal_year: fyRes.name,
            },
          ));
          if (tbSummary.closingDifference > 0.05) {
            checks.push(check(
              'trial_balance_opening',
              'Opening / closing balance sheet',
              'warn',
              `Closing debits and credits differ by $${tbSummary.closingDifference.toFixed(2)} (opening Δ $${tbSummary.openingDifference.toFixed(2)}). June activity is balanced; this is a pre-existing books issue — often an opening balance or retained earnings entry in ERPNext.`,
              {
                opening_difference: tbSummary.openingDifference,
                closing_difference: tbSummary.closingDifference,
                fiscal_year: fyRes.name,
              },
            ));
          }
        }
      } else {
        checks.push(check('trial_balance', 'Trial balance', 'warn', tbRes.error || 'Could not load trial balance', {}));
      }
      }
    } else {
      checks.push(check('erpnext_connection', 'ERPNext connection', 'fail', 'ERPNext is not fully configured.', {}));
    }

    const blockingFail = checks.some((c) => c.status === 'fail');
    const hasWarn = checks.some((c) => c.status === 'warn');
    const filingReady = !blockingFail && hstCollectedMapped && hstRecoverableMapped;

    const hstAdjustmentSchedule = await buildHstAdjustmentSchedule(supabaseAdmin, businessId, fromDate, toDate, {
      timezone: (config.business_timezone as string) || 'America/Toronto',
      dayEndTime: config.batch_day_end_time_local as string | null,
    });

    return json({
      period: { from_date: fromDate, to_date: toDate },
      filing_ready: filingReady,
      filing_status: blockingFail ? 'blocked' : hasWarn ? 'review' : 'ready',
      checks,
      worksheet,
      hst_summary: hstSummary,
      gst34_warnings: gst34Warnings,
      hst_adjustment_schedule: hstAdjustmentSchedule,
      tavari_totals: {
        posted_batch_tax: tavariBatchTax,
        posted_batch_sales: tavariBatchSales,
        posted_expense_tax: tavariExpenseTax,
      },
    });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
