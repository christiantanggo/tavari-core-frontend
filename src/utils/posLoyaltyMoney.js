/**
 * Loyalty "points" program vs "dollars" are configured in `pos_loyalty_settings.loyalty_mode`.
 * `pos_loyalty_accounts.store_credit` = deposit/refund / account **money** (Creds tab) — not loyalty points.
 * `pos_loyalty_accounts.points` = loyalty program points.
 * `pos_loyalty_accounts.balance` = legacy: loyalty dollar pool in "dollars" mode; in "points" mode, do not
 *   mix with store credit in the UI and prefer not to use for redemption (use `points` + `store_credit`).
 */

export function isPointsLoyaltyMode(loyaltySettings) {
  return (loyaltySettings?.loyalty_mode || 'points') === 'points' || !loyaltySettings;
}

/**
 * Dollar value represented by a points balance (matches historic UI: fromBalance = round(balance * rate/10) inverted).
 * @param {number} points
 * @param {number} [redemptionRate] default 10000
 * @returns {number}
 */
export function loyaltyPointsToDollars(points, redemptionRate) {
  const r = Number(redemptionRate) || 10000;
  const p = Number(points) || 0;
  return (p * 10) / r;
}

/**
 * @param {number} dollars
 * @param {number} [redemptionRate]
 * @returns {number} points equivalent (integer)
 */
export function dollarsToLoyaltyPoints(dollars, redemptionRate) {
  const r = Number(redemptionRate) || 10000;
  const d = Number(dollars) || 0;
  return Math.round((d * r) / 10);
}

/**
 * Combined spendable dollars in points program: `store_credit` (money) + $ value of `points` (ignore `balance` here).
 * @param {{ store_credit?: number, points?: number, balance?: number } | null} account
 * @param {object} loyaltySettings
 * @param {{ includeLegacyBalanceInPointsMode?: boolean }} [opts] — for rare backfill
 */
export function getSpendableDollarsInPointsMode(account, loyaltySettings, opts = {}) {
  if (!account) return 0;
  const rate = Number(loyaltySettings?.redemption_rate) || 10000;
  const sc = Number(account.store_credit) || 0;
  const fromPts = loyaltyPointsToDollars(account.points, rate);
  if (opts.includeLegacyBalanceInPointsMode) {
    return sc + fromPts + (Number(account.balance) || 0);
  }
  return sc + fromPts;
}

/**
 * Dollars program: `store_credit` (account) + `balance` (loyalty $ pool in legacy / dollars program).
 * @param {{ store_credit?: number, balance?: number } | null} account
 */
export function getSpendableDollarsInDollarsMode(account) {
  if (!account) return 0;
  return (Number(account.store_credit) || 0) + (Number(account.balance) || 0);
}

/**
 * How many dollars to take from `store_credit` first, then from the loyalty pool (`points` in points
 * program, or `balance` in dollars program). `totalDollars` should be a redemption that already
 * passed daily caps and sale max checks.
 * @param {number} totalDollars
 * @param {{ store_credit?: number, points?: number, balance?: number } | null} account
 * @param {object} loyaltySettings
 * @returns {{ fromStore: number, fromLoyaltyPool: number, newStore: number, newPoints: number, newBalance: number, pointsRedeemed: number }}
 */
export function splitLoyaltyRedemptionDollars(totalDollars, account, loyaltySettings) {
  if (!Number.isFinite(Number(totalDollars)) || (Number(totalDollars) || 0) <= 0 || !account) {
    const a = account || {};
    return {
      fromStore: 0,
      fromLoyaltyPool: 0,
      newStore: Number(a.store_credit) || 0,
      newPoints: Math.max(0, Number(a.points) || 0),
      newBalance: Number(a.balance) || 0,
      pointsRedeemed: 0
    };
  }
  const amount = Math.min(Number(totalDollars), 1e8);
  const rate = Number(loyaltySettings?.redemption_rate) || 10000;
  const sc0 = Math.max(0, Number(account.store_credit) || 0);
  let rem = amount;
  const fromStore = Math.min(rem, sc0);
  rem -= fromStore;
  const newStore = sc0 - fromStore;
  if (isPointsLoyaltyMode(loyaltySettings)) {
    const p0 = Math.max(0, Number(account.points) || 0);
    const maxFromPool = loyaltyPointsToDollars(p0, rate);
    const fromLoyaltyPool = Math.min(rem, maxFromPool);
    const pointsRedeemed = fromLoyaltyPool > 0 ? dollarsToLoyaltyPoints(fromLoyaltyPool, rate) : 0;
    const newPoints = Math.max(0, p0 - pointsRedeemed);
    return { fromStore, fromLoyaltyPool, newStore, newPoints, newBalance: Number(account.balance) || 0, pointsRedeemed };
  }
  const bal0 = Math.max(0, Math.abs(Number(account.balance) || 0));
  const fromLoyaltyPool = Math.min(rem, bal0);
  const newBalance = bal0 - fromLoyaltyPool;
  return {
    fromStore,
    fromLoyaltyPool,
    newStore,
    newPoints: Number(account.points) || 0,
    newBalance,
    pointsRedeemed: 0
  };
}
