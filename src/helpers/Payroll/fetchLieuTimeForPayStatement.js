/**
 * Load combined lieu transaction log for pay statement PDFs / emails.
 * Returns the 10 most recent entries when lieu time is enabled for the employee.
 */

export async function fetchEmployeeLieuTransactions(supabase, userId, businessId) {
  if (!supabase || !userId || !businessId) return [];

  const [{ data: manualTransactions, error: transactionError }, { data: payrollEntries, error: payrollError }] =
    await Promise.all([
      supabase
        .from('hrpayroll_lieu_time_transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('business_id', businessId),
      supabase
        .from('hrpayroll_entries')
        .select(`
          id,
          user_id,
          created_at,
          lieu_earned,
          lieu_hours,
          lieu_balance_after,
          payroll_run_id,
          hrpayroll_runs!inner(
            id,
            business_id,
            pay_period_start,
            pay_period_end,
            pay_date
          )
        `)
        .eq('user_id', userId)
        .eq('hrpayroll_runs.business_id', businessId),
    ]);

  if (transactionError) throw transactionError;
  if (payrollError) throw payrollError;

  const payrollTransactions = [];

  (payrollEntries || []).forEach((entry) => {
    const payDate = entry?.hrpayroll_runs?.pay_date || entry.created_at;
    const payPeriodStart = entry?.hrpayroll_runs?.pay_period_start;
    const payPeriodEnd = entry?.hrpayroll_runs?.pay_period_end;
    const periodLabel =
      payPeriodStart && payPeriodEnd ? `${payPeriodStart} to ${payPeriodEnd}` : 'Payroll Run';

    if (entry.lieu_earned && entry.lieu_earned > 0) {
      payrollTransactions.push({
        id: `payroll-${entry.id}-earned`,
        transaction_type: 'earned',
        hours_amount: Number(entry.lieu_earned),
        transaction_date: payDate,
        created_at: entry.created_at,
        source: 'payroll',
        description: `Lieu time earned during payroll period ${periodLabel}`,
      });
    }

    if (entry.lieu_hours && entry.lieu_hours > 0) {
      payrollTransactions.push({
        id: `payroll-${entry.id}-used`,
        transaction_type: 'used',
        hours_amount: -Math.abs(Number(entry.lieu_hours)),
        transaction_date: payDate,
        created_at: entry.created_at,
        source: 'payroll',
        description: `Lieu time used during payroll period ${periodLabel}`,
      });
    }
  });

  const combined = [
    ...(manualTransactions || []).map((tx) => ({ ...tx, source: tx.source || 'manual' })),
    ...payrollTransactions,
  ];

  combined.sort((a, b) => {
    const dateA = new Date(a.transaction_date || a.created_at).getTime();
    const dateB = new Date(b.transaction_date || b.created_at).getTime();
    if (dateA === dateB) {
      return (
        new Date(b.created_at || b.transaction_date).getTime() -
        new Date(a.created_at || a.transaction_date).getTime()
      );
    }
    return dateB - dateA;
  });

  return combined;
}

export async function fetchLieuTimeForPayStatement(supabase, userId, businessId, limit = 10) {
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('lieu_time_enabled')
    .eq('id', userId)
    .maybeSingle();

  if (userError) throw userError;
  if (!userData?.lieu_time_enabled) {
    return { enabled: false, entries: [] };
  }

  const all = await fetchEmployeeLieuTransactions(supabase, userId, businessId);
  return { enabled: true, entries: all.slice(0, limit) };
}
