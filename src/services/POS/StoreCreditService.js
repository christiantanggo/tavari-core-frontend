import { supabase } from '../../supabaseClient';

/**
 * Account store credit is stored in `pos_loyalty_accounts.store_credit` (dollars), separate from
 * loyalty `points` and the legacy `balance` dollar pool. See `posLoyaltyMoney` for checkout math.
 * This service records *classified* store-credit movements for deposits, dispute credits, etc.
 */
export const STORE_CREDIT_CATEGORIES = [
  { id: 'deposit', label: 'Deposit / prepayment' },
  { id: 'dispute', label: 'Dispute resolution' },
  { id: 'refund', label: 'Refund to account' },
  { id: 'goodwill', label: 'Goodwill credit' },
  { id: 'promo', label: 'Promotion' },
  { id: 'adjustment', label: 'Manual adjustment' },
  { id: 'other', label: 'Other' }
];

const TX_STORE_CREDIT = 'store_credit';
const TX_STORE_CREDIT_REV = 'store_credit_reversal';

function buildDescription({ category, note, isReversal }) {
  const found = STORE_CREDIT_CATEGORIES.find((c) => c.id === category);
  const label = found ? found.label : category;
  const prefix = isReversal ? 'Store credit removed' : 'Store credit';
  if (note && String(note).trim()) {
    return `${prefix} — ${label}: ${String(note).trim()}`;
  }
  return `${prefix} — ${label}`;
}

/**
 * Add or remove dollar store credit on `store_credit`.
 *
 * @param {object} p
 * @param {string} p.businessId
 * @param {string} p.accountId - pos_loyalty_accounts.id
 * @param {number} p.amountDollars - positive; direction from isReversal
 * @param {string} p.category - one of STORE_CREDIT_CATEGORIES ids
 * @param {string} [p.note]
 * @param {boolean} [p.isReversal] - if true, subtracts from `store_credit`
 * @param {string|null} [p.processedByUserId] - current user
 * @returns {Promise<{ newStoreCredit: number, newBalance: number, row: object }>}
 */
export async function applyStoreCreditLine({
  businessId,
  accountId,
  amountDollars,
  category = 'other',
  note = '',
  isReversal = false,
  processedByUserId = null
}) {
  if (!businessId || !accountId) throw new Error('Business and account are required');
  const n = Number(amountDollars);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Enter a valid amount greater than zero');

  const { data: acc, error: accErr } = await supabase
    .from('pos_loyalty_accounts')
    .select('id, store_credit, business_id')
    .eq('id', accountId)
    .eq('business_id', businessId)
    .single();
  if (accErr) throw accErr;
  if (!acc) throw new Error('Account not found');

  const before = Number(acc.store_credit) || 0;
  const delta = isReversal ? -n : n;
  const after = before + delta;
  if (after < 0) {
    throw new Error('This would make store credit balance negative. Reduce the amount.');
  }

  const transactionType = isReversal ? TX_STORE_CREDIT_REV : TX_STORE_CREDIT;
  // Ledger row: dollar movement only; `balance_*` here tracks store-credit dollars (legacy column names).
  const baseLine = {
    business_id: businessId,
    loyalty_account_id: accountId,
    transaction_type: transactionType,
    amount: isReversal ? -n : n,
    points: null,
    balance_before: before,
    balance_after: after,
    points_before: 0,
    points_after: 0,
    description: buildDescription({ category, note, isReversal }),
    processed_by: processedByUserId,
    processed_at: new Date().toISOString()
  };
  const line = { ...baseLine, store_credit_category: category };

  // Only `store_credit` on the account row — never update `points` or `balance` (loyalty pool); credits are separate.
  const { error: upErr } = await supabase
    .from('pos_loyalty_accounts')
    .update({
      store_credit: after,
      last_activity: new Date().toISOString()
    })
    .eq('id', accountId)
    .eq('business_id', businessId);
  if (upErr) throw upErr;

  let r = await supabase
    .from('pos_loyalty_transactions')
    .insert(line)
    .select('id, created_at, transaction_type, amount, description, store_credit_category, balance_after')
    .single();
  if (r.error) {
    r = await supabase
      .from('pos_loyalty_transactions')
      .insert(baseLine)
      .select('id, created_at, transaction_type, amount, description, balance_after')
      .single();
  }
  if (r.error) {
    await supabase
      .from('pos_loyalty_accounts')
      .update({ store_credit: before, last_activity: new Date().toISOString() })
      .eq('id', accountId)
      .eq('business_id', businessId);
    if (String(r.error.message || '').toLowerCase().includes('check') && String(r.error.message || '').includes('transaction_type')) {
      throw new Error(
        'Database does not allow `store_credit` transaction type yet. Run migrations (pos_loyalty_store_credit) or adjust the transaction_type check.'
      );
    }
    throw r.error;
  }

  return { newStoreCredit: after, newBalance: after, row: r.data, transaction: line };
}

/**
 * Recent classified store-credit lines for a customer.
 */
export async function fetchStoreCreditHistory(accountId, businessId, { limit = 100 } = {}) {
  if (!accountId || !businessId) return [];
  const { data, error } = await supabase
    .from('pos_loyalty_transactions')
    .select('id, created_at, transaction_type, amount, description, store_credit_category, balance_after')
    .eq('loyalty_account_id', accountId)
    .eq('business_id', businessId)
    .in('transaction_type', [TX_STORE_CREDIT, TX_STORE_CREDIT_REV])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[StoreCreditService] history', error);
    return [];
  }
  return data || [];
}

export { TX_STORE_CREDIT, TX_STORE_CREDIT_REV };
