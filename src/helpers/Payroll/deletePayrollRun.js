// src/helpers/Payroll/deletePayrollRun.js
//
// Single source of truth for deleting an `hrpayroll_runs` row.
// After entries are removed, affected users are re-synced from the lieu ledger
// (finalized payroll + manual transactions) — never from stale entry snapshots.

import { supabase as defaultSupabase } from '../../supabaseClient';
import {
  aggregateLieuNetDeltaByUserId,
  syncUsersLieuBalanceFromLedger,
} from './lieuTimeLedger';

const noop = () => {};

const ENTRY_FIELDS_FOR_DELETE =
  'id, user_id, lieu_hours, lieu_earned, lieu_balance_before, lieu_balance_after';

/** Load entry rows needed when deleting a run. */
export async function fetchPayrollEntriesForDelete(supabase, payrollRunId) {
  if (!payrollRunId) return [];
  const { data, error } = await supabase
    .from('hrpayroll_entries')
    .select(ENTRY_FIELDS_FOR_DELETE)
    .eq('payroll_run_id', payrollRunId);
  if (error) throw error;
  return data || [];
}

/** @deprecated Use syncUsersLieuBalanceFromLedger after entries are deleted. */
export async function reverseLieuBalanceForPayrollEntries(supabase, options = {}) {
  const { entries = [], businessId } = options;
  const userIds = [...new Set(entries.map((e) => e?.user_id).filter(Boolean))];
  if (!businessId || !userIds.length) return {};
  return syncUsersLieuBalanceFromLedger(supabase, businessId, userIds);
}

export async function deletePayrollRunWithRefunds({
  supabase = defaultSupabase,
  run,
  payrollEntries = null,
  authUser = null,
  logSecurityEvent = noop,
  recordAction = noop,
}) {
  if (!run?.id) {
    throw new Error('deletePayrollRunWithRefunds: run.id is required.');
  }

  const businessId = run.business_id;
  const runId = run.id;
  const runStatus = run.status || 'draft';
  const periodStart = run.pay_period_start || run.period_start || null;
  const periodEnd = run.pay_period_end || run.period_end || null;

  let entries = payrollEntries;
  if (!Array.isArray(entries) || entries.length === 0) {
    entries = await fetchPayrollEntriesForDelete(supabase, runId);
  } else {
    const needsRefetch = entries.some(
      (entry) =>
        entry?.lieu_balance_before == null && entry?.lieu_balance_after == null
    );
    if (needsRefetch) {
      entries = await fetchPayrollEntriesForDelete(supabase, runId);
    }
  }

  const entryCount = entries.length;
  const affectedUserIds = [...new Set(entries.map((e) => e?.user_id).filter(Boolean))];

  try {
    try {
      await logSecurityEvent('payroll_run_delete_attempt', {
        business_id: businessId,
        payroll_run_id: runId,
        entries: entryCount,
        run_status: runStatus,
      }, 'high');
    } catch (logError) {
      console.warn('payroll_run_delete_attempt log failed:', logError);
    }

    const { error: entriesError } = await supabase
      .from('hrpayroll_entries')
      .delete()
      .eq('payroll_run_id', runId);
    if (entriesError) throw entriesError;

    try {
      const { error: lieuTransactionError } = await supabase
        .from('hrpayroll_lieu_time_transactions')
        .delete()
        .eq('payroll_run_id', runId);
      if (lieuTransactionError && lieuTransactionError.code !== '42P01') {
        throw lieuTransactionError;
      }
    } catch (lieuError) {
      if (lieuError?.code === '42P01') {
        console.warn('Lieu time transactions table not available; skipping cleanup.');
      } else {
        throw lieuError;
      }
    }

    const { error: runError } = await supabase
      .from('hrpayroll_runs')
      .delete()
      .eq('id', runId);
    if (runError) throw runError;

    let lieuAdjustments = {};
    if (businessId && affectedUserIds.length > 0) {
      lieuAdjustments = await syncUsersLieuBalanceFromLedger(
        supabase,
        businessId,
        affectedUserIds
      );

      try {
        await logSecurityEvent('lieu_time_reverted_from_payroll_delete', {
          business_id: businessId,
          payroll_run_id: runId,
          balances_restored: lieuAdjustments,
          run_status: runStatus,
        }, 'high');
      } catch (logError) {
        console.warn('lieu_time_reverted_from_payroll_delete log failed:', logError);
      }
    }

    try {
      await logSecurityEvent('payroll_run_deleted', {
        business_id: businessId,
        payroll_run_id: runId,
        deleted_by: authUser?.id,
        entries_deleted: entryCount,
        run_status: runStatus,
      }, 'critical');
    } catch (logError) {
      console.warn('payroll_run_deleted log failed:', logError);
    }

    try {
      await recordAction({
        action: 'delete_payroll_run',
        details: {
          payroll_run_id: runId,
          period_start: periodStart,
          period_end: periodEnd,
          entries_deleted: entryCount,
          run_status: runStatus,
        },
      });
    } catch (recordError) {
      console.warn('recordAction(delete_payroll_run) failed:', recordError);
    }

    return {
      ok: true,
      refunded: lieuAdjustments,
      entriesDeleted: entryCount,
      netByUser: aggregateLieuNetDeltaByUserId(entries),
    };
  } catch (error) {
    try {
      await logSecurityEvent('payroll_run_delete_error', {
        business_id: businessId,
        payroll_run_id: runId,
        error: error?.message,
      }, 'critical');
    } catch (logError) {
      console.warn('payroll_run_delete_error log failed:', logError);
    }

    try {
      await recordAction({
        action: 'delete_payroll_run_failed',
        details: {
          payroll_run_id: runId,
          error: error?.message,
        },
      });
    } catch (recordError) {
      console.warn('recordAction(delete_payroll_run_failed) failed:', recordError);
    }

    throw error;
  }
}
