/**
 * Lieu time balance from the transaction ledger.
 *
 * Manual rows and payroll earn/use rows are both deltas, but older manual rows
 * (migration, camp prep, etc.) are already reflected in the latest payroll
 * lieu_balance_after snapshot. Current balance = that snapshot + any manual rows
 * entered after that payroll was saved.
 */

/** Net lieu effect stored on a payroll entry (negative = hours used). */
export function computeLieuEntryNetDelta(entry) {
  const before = parseFloat(entry?.lieu_balance_before);
  const after = parseFloat(entry?.lieu_balance_after);
  if (!Number.isNaN(before) && !Number.isNaN(after)) {
    return after - before;
  }
  const used = parseFloat(entry?.lieu_hours) || 0;
  const earned = parseFloat(entry?.lieu_earned) || 0;
  return earned - used;
}

/** Sum net lieu deltas per user_id from payroll entry rows. */
export function aggregateLieuNetDeltaByUserId(entries = []) {
  return (entries || []).reduce((acc, entry) => {
    const userId = entry?.user_id;
    if (!userId) return acc;
    acc[userId] = (acc[userId] || 0) + computeLieuEntryNetDelta(entry);
    return acc;
  }, {});
}

/**
 * Balance after undoing payroll entry effects (finalized runs).
 * @param {number} currentBalance
 * @param {object[]} entries - rows for one user
 */
export function computeLieuBalanceAfterReversingEntries(currentBalance, entries = []) {
  const delta = (entries || []).reduce(
    (sum, entry) => sum + computeLieuEntryNetDelta(entry),
    0
  );
  if (Math.abs(delta) < 0.0001) return currentBalance;
  return Math.max(0, currentBalance - delta);
}

/**
 * Draft runs should restore the snapshot recorded before the run touched lieu.
 * Falls back to delta reversal when snapshots are missing.
 */
export function resolveLieuBalanceAfterDraftDelete(currentBalance, entries = []) {
  const rows = entries || [];
  if (rows.length === 1) {
    const before = parseFloat(rows[0]?.lieu_balance_before);
    if (!Number.isNaN(before)) return Math.max(0, before);
  }
  return computeLieuBalanceAfterReversingEntries(currentBalance, rows);
}

/**
 * Net lieu reserved in other unapproved draft runs (excludes excludeRunId).
 * Negative when other drafts have already "used" lieu on paper.
 */
export async function fetchPendingDraftLieuNetForUser(
  supabase,
  businessId,
  userId,
  excludeRunId
) {
  if (!supabase || !businessId || !userId) return 0;

  let query = supabase
    .from('hrpayroll_entries')
    .select(`
      lieu_hours,
      lieu_earned,
      lieu_balance_before,
      lieu_balance_after,
      payroll_run_id,
      hrpayroll_runs!inner(id, business_id, status)
    `)
    .eq('user_id', userId)
    .eq('hrpayroll_runs.business_id', businessId)
    .eq('hrpayroll_runs.status', 'draft');

  if (excludeRunId) {
    query = query.neq('payroll_run_id', excludeRunId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).reduce((sum, row) => sum + computeLieuEntryNetDelta(row), 0);
}

/**
 * Recompute users.lieu_time_balance from finalized payroll + manual transactions.
 * Source of truth for lieu — use after draft delete, finalize, or any payroll lieu change.
 */
export async function syncUsersLieuBalanceFromLedger(supabase, businessId, userIds = []) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!supabase || !businessId || ids.length === 0) return {};

  const ledgerMap = await fetchLieuBalanceMapForEmployees(supabase, businessId, ids);
  const nowIso = new Date().toISOString();
  const results = {};

  await Promise.all(
    ids.map(async (userId) => {
      const balance = resolveAvailableLieuBalance(ledgerMap[userId] ?? 0);
      results[userId] = balance;
      const { error } = await supabase
        .from('users')
        .update({ lieu_time_balance: balance, updated_at: nowIso })
        .eq('id', userId);
      if (error) throw error;
    })
  );

  return results;
}

export async function syncUserLieuBalanceFromLedger(supabase, businessId, userId) {
  const map = await syncUsersLieuBalanceFromLedger(supabase, businessId, [userId]);
  return map[userId] ?? 0;
}

/**
 * @deprecated Prefer syncUsersLieuBalanceFromLedger after finalize.
 */
export async function applyDraftPayrollLieuToUserBalances(supabase, payrollRunId) {
  if (!supabase || !payrollRunId) return;

  const { data: entries, error } = await supabase
    .from('hrpayroll_entries')
    .select('user_id, lieu_hours, lieu_earned, lieu_balance_before, lieu_balance_after')
    .eq('payroll_run_id', payrollRunId);

  if (error) throw error;
  if (!entries?.length) return;

  const netByUser = aggregateLieuNetDeltaByUserId(entries);
  const userIds = Object.keys(netByUser);
  if (!userIds.length) return;

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, lieu_time_balance')
    .in('id', userIds);

  if (usersError) throw usersError;

  const nowIso = new Date().toISOString();
  await Promise.all(
    (users || []).map(async (user) => {
      const delta = netByUser[user.id] || 0;
      if (Math.abs(delta) < 0.0001) return;

      const userEntries = entries.filter((entry) => entry.user_id === user.id);
      const expectedAfter = userEntries.reduce((best, entry) => {
        const after = parseFloat(entry.lieu_balance_after);
        if (Number.isNaN(after)) return best;
        return best == null ? after : after;
      }, null);

      const current = parseFloat(user.lieu_time_balance) || 0;
      if (
        expectedAfter != null
        && Math.abs(current - expectedAfter) < 0.01
        && Math.abs(delta) > 0.0001
      ) {
        return;
      }

      const newBalance = Math.max(0, current + delta);
      if (Math.abs(newBalance - current) < 0.0001) return;

      const { error: updateError } = await supabase
        .from('users')
        .update({ lieu_time_balance: newBalance, updated_at: nowIso })
        .eq('id', user.id);

      if (updateError) throw updateError;
    })
  );
}

/** Non-negative balance available for payroll auto-fill (never use lieu when this is 0). */
export function resolveAvailableLieuBalance(employeeOrBalance) {
  if (employeeOrBalance != null && typeof employeeOrBalance === 'object') {
    return resolveAvailableLieuBalance(employeeOrBalance.lieu_time_balance);
  }
  const raw = parseFloat(employeeOrBalance ?? 0);
  if (Number.isNaN(raw)) return 0;
  return Math.max(0, raw);
}

/**
 * Cap lieu used so balance never goes negative. Used hours cannot exceed balance + earned this period.
 */
export function clampLieuHoursForPeriod({
  employee,
  lieuEarned = 0,
  lieuUsed = 0,
  balanceBefore = null
}) {
  const before =
    balanceBefore != null
      ? resolveAvailableLieuBalance(balanceBefore)
      : resolveAvailableLieuBalance(employee);
  const earned = Math.max(0, parseFloat(lieuEarned) || 0);
  let used = Math.max(0, parseFloat(lieuUsed) || 0);
  const maxUsable = before + earned;
  used = Math.min(used, maxUsable);
  const after = Math.max(0, before + earned - used);
  return {
    lieuEarned: earned,
    lieuUsed: used,
    lieuBalanceBefore: before,
    lieuBalanceAfter: after
  };
}

/**
 * Balance payroll may consume for auto-fill.
 * Never exceed users.lieu_time_balance (HR source of truth); ledger can still be higher
 * when manual corrections zeroed the profile but an old payroll snapshot remains.
 */
export function resolvePayrollLieuBalance(employee, ledgerBalance) {
  const dbBalance = resolveAvailableLieuBalance(employee?.lieu_time_balance);
  if (ledgerBalance === undefined || ledgerBalance === null) return dbBalance;
  return Math.min(dbBalance, resolveAvailableLieuBalance(ledgerBalance));
}

export function buildCombinedLieuTransactionsFromRows(manualRows = [], payrollEntries = []) {
  const payrollTransactions = [];

  (payrollEntries || []).forEach((entry) => {
    const payDate = entry?.hrpayroll_runs?.pay_date || entry.created_at;
    const payPeriodStart = entry?.hrpayroll_runs?.pay_period_start;
    const payPeriodEnd = entry?.hrpayroll_runs?.pay_period_end;
    const periodLabel =
      payPeriodStart && payPeriodEnd ? `${payPeriodStart} to ${payPeriodEnd}` : 'Payroll Run';
    const balanceAfter = entry.lieu_balance_after ?? null;

    if (entry.lieu_earned && entry.lieu_earned > 0) {
      payrollTransactions.push({
        id: `payroll-${entry.id}-earned`,
        user_id: entry.user_id,
        transaction_type: 'earned',
        hours_amount: Number(entry.lieu_earned),
        transaction_date: payDate,
        created_at: entry.created_at,
        balance_after: balanceAfter,
        source: 'payroll',
        description: `Lieu time earned during payroll period ${periodLabel}`,
      });
    }

    if (entry.lieu_hours && entry.lieu_hours > 0) {
      payrollTransactions.push({
        id: `payroll-${entry.id}-used`,
        user_id: entry.user_id,
        transaction_type: 'used',
        hours_amount: -Math.abs(Number(entry.lieu_hours)),
        transaction_date: payDate,
        created_at: entry.created_at,
        balance_after: balanceAfter,
        source: 'payroll',
        description: `Lieu time used during payroll period ${periodLabel}`,
      });
    }
  });

  return [
    ...(manualRows || []).map((tx) => ({ ...tx, source: tx.source || 'manual' })),
    ...payrollTransactions,
  ];
}

/**
 * Ledger-derived balances for payroll (matches Employee Lieu Time modal).
 * @returns {Promise<Record<string, number>>} userId -> available hours (>= 0)
 */
export async function fetchLieuBalanceMapForEmployees(supabase, businessId, userIds = []) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const map = {};
  if (!supabase || !businessId || ids.length === 0) return map;

  const [{ data: manualRows, error: manualErr }, { data: payrollEntries, error: payrollErr }] =
    await Promise.all([
      supabase
        .from('hrpayroll_lieu_time_transactions')
        .select('*')
        .eq('business_id', businessId)
        .in('user_id', ids),
      supabase
        .from('hrpayroll_entries')
        .select(`
          id,
          user_id,
          created_at,
          lieu_earned,
          lieu_hours,
          lieu_balance_after,
          hrpayroll_runs!inner(
            business_id,
            status,
            pay_date,
            pay_period_start,
            pay_period_end
          )
        `)
        .eq('hrpayroll_runs.business_id', businessId)
        .eq('hrpayroll_runs.status', 'finalized')
        .in('user_id', ids),
    ]);

  if (manualErr) throw manualErr;
  if (payrollErr) throw payrollErr;

  const manualByUser = {};
  for (const row of manualRows || []) {
    if (!manualByUser[row.user_id]) manualByUser[row.user_id] = [];
    manualByUser[row.user_id].push(row);
  }

  const payrollByUser = {};
  for (const row of payrollEntries || []) {
    if (!payrollByUser[row.user_id]) payrollByUser[row.user_id] = [];
    payrollByUser[row.user_id].push(row);
  }

  for (const userId of ids) {
    const combined = buildCombinedLieuTransactionsFromRows(
      manualByUser[userId] || [],
      payrollByUser[userId] || []
    );
    const ledgerBalance = deriveCurrentLieuBalance(combined);
    map[userId] = resolveAvailableLieuBalance(
      ledgerBalance != null ? ledgerBalance : 0
    );
  }

  return map;
}

export function sortLieuTransactionsChronologically(transactions) {
  return [...(transactions || [])].sort((a, b) => {
    const da = new Date(a.transaction_date || a.created_at || 0).getTime();
    const db = new Date(b.transaction_date || b.created_at || 0).getTime();
    if (da !== db) return da - db;
    return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
  });
}

/** Most recent payroll row that has a lieu_balance_after snapshot. */
export function getLatestPayrollCheckpoint(transactions) {
  let latest = null;
  for (const t of transactions || []) {
    if (t.source !== 'payroll') continue;
    const balance = parseFloat(t.balance_after);
    if (Number.isNaN(balance)) continue;
    const payDate = new Date(t.transaction_date || t.created_at || 0).getTime();
    const created = new Date(t.created_at || 0).getTime();
    if (
      !latest
      || payDate > latest.payDate
      || (payDate === latest.payDate && created > latest.created)
    ) {
      latest = { balance, payDate, created, createdAt: t.created_at };
    }
  }
  return latest;
}

/**
 * Current balance: latest payroll snapshot + manual adjustments saved after that payroll.
 * Backdated manual rows count when they were entered (created_at), not their transaction_date.
 */
export function deriveCurrentLieuBalance(transactions) {
  if (!transactions?.length) return null;
  const checkpoint = getLatestPayrollCheckpoint(transactions);
  if (!checkpoint) {
    let balance = 0;
    for (const t of transactions) {
      const amt = parseFloat(t.hours_amount);
      if (!Number.isNaN(amt)) balance += amt;
    }
    return balance;
  }
  const checkpointTime = new Date(checkpoint.createdAt || 0).getTime();
  let balance = checkpoint.balance;
  for (const t of transactions) {
    if (t.source === 'payroll') continue;
    const created = new Date(t.created_at || 0).getTime();
    if (created > checkpointTime) {
      const amt = parseFloat(t.hours_amount);
      if (!Number.isNaN(amt)) balance += amt;
    }
  }
  return balance;
}

/** Running balance after each row (for history / print). */
export function attachLieuRunningBalances(transactions) {
  if (!transactions?.length) return [];
  const runningById = new Map();
  let running = 0;
  for (const t of sortLieuTransactionsChronologically(transactions)) {
    if (t.source === 'payroll') {
      const snap = parseFloat(t.balance_after);
      if (!Number.isNaN(snap)) running = snap;
    } else {
      const amt = parseFloat(t.hours_amount);
      if (!Number.isNaN(amt)) running += amt;
    }
    if (t.id != null) runningById.set(t.id, running);
  }
  return transactions.map((t) => ({
    ...t,
    balance_after: runningById.has(t.id) ? runningById.get(t.id) : t.balance_after,
  }));
}
