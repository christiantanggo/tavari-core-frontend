/**
 * Latest wage adjustment for pay statement header display.
 * Uses hrpayroll_wage_history.effective_date (most recent change).
 */

export function formatLastWageAdjustmentDisplay(adjustment, formatTaxAmount, timezone = 'America/Toronto') {
  if (!adjustment || adjustment.new_wage == null) {
    return 'N/A';
  }

  const previous = parseFloat(adjustment.previous_wage);
  const next = parseFloat(adjustment.new_wage);
  if (Number.isNaN(next)) return 'N/A';

  const delta = Number.isNaN(previous) ? null : next - previous;
  const dateRaw = adjustment.effective_date;
  const dateLabel = dateRaw
    ? new Date(`${String(dateRaw).slice(0, 10)}T12:00:00`).toLocaleDateString('en-CA', {
        timeZone: timezone,
      })
    : 'N/A';

  if (delta == null || Math.abs(delta) < 0.005) {
    return `N/A`;
  }

  const sign = delta >= 0 ? '+' : '-';
  const amountLabel = formatTaxAmount
    ? formatTaxAmount(Math.abs(delta))
    : Math.abs(delta).toFixed(2);

  return `${sign}$${amountLabel} on ${dateLabel}`;
}

/**
 * @returns {Promise<{ previous_wage: number, new_wage: number, effective_date: string } | null>}
 */
export async function fetchLastWageAdjustmentForPayStatement(supabase, userId, businessId) {
  if (!supabase || !userId || !businessId) return null;

  const { data, error } = await supabase
    .from('hrpayroll_wage_history')
    .select('previous_wage, new_wage, effective_date')
    .eq('user_id', userId)
    .eq('business_id', businessId)
    .order('effective_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[fetchLastWageAdjustmentForPayStatement]', error);
    return null;
  }

  return data || null;
}
