import { dollarsToLoyaltyPoints } from './posLoyaltyMoney';

/** Sum per-unit bonus points × quantity across cart/sale lines. */
export function sumCartItemBonusPoints(items = []) {
  return (items || []).reduce((sum, item) => {
    const bonus = Math.max(0, Number.parseInt(String(item?.loyalty_points_earned ?? 0), 10) || 0);
    const qty = Math.max(0, Number.parseInt(String(item?.quantity ?? 1), 10) || 1);
    return sum + bonus * qty;
  }, 0);
}

/**
 * Total points to earn: global earn rate on subtotal + item bonuses + optional offer bonus.
 * @param {{ subtotal: number, earnRatePercentage: number, redemptionRate: number, cartItems?: object[], offerBonusPoints?: number }}
 */
export function calculateTotalLoyaltyPointsToEarn({
  subtotal = 0,
  earnRatePercentage = 0,
  redemptionRate = 10000,
  cartItems = [],
  offerBonusPoints = 0,
} = {}) {
  const taxableSubtotal = Math.max(0, Number(subtotal) || 0);
  const earnRatePercent = (Number(earnRatePercentage) || 0) / 100;
  const basePoints = dollarsToLoyaltyPoints(taxableSubtotal * earnRatePercent, redemptionRate);
  const itemBonus = sumCartItemBonusPoints(cartItems);
  const offerBonus = Math.max(0, Number.parseInt(String(offerBonusPoints || 0), 10) || 0);
  return Math.max(0, basePoints + itemBonus + offerBonus);
}

/** Inventory rows for customer Rewards tab catalog. */
export function mapFeaturedRewardItem(row) {
  if (!row?.id) return null;
  const bonus = Math.max(0, Number.parseInt(String(row.loyalty_points_earned ?? 0), 10) || 0);
  if (!row.show_on_rewards_tab || bonus <= 0) return null;
  return {
    id: row.id,
    name: String(row.name || 'Item').trim(),
    bonusPoints: bonus,
    blurb: row.loyalty_rewards_blurb ? String(row.loyalty_rewards_blurb).trim() : null,
    imageUrl: row.image_url ? String(row.image_url).trim() : null,
    price: Number(row.price) || 0,
  };
}

export function formatOfferRewardLabel(offer) {
  if (!offer) return '';
  const cfg = offer.reward_config || offer.rewardConfig || {};
  if (offer.reward_type === 'bonus_points' || offer.rewardType === 'bonus_points') {
    const pts = Number(cfg.bonus_points ?? cfg.bonusPoints ?? 0);
    return pts > 0 ? `+${pts.toLocaleString()} bonus pts` : 'Bonus points';
  }
  if (offer.reward_type === 'percent_discount' || offer.rewardType === 'percent_discount') {
    const pct = Number(cfg.percent_discount ?? cfg.percentDiscount ?? 0);
    return pct > 0 ? `${pct}% off` : 'Discount';
  }
  if (offer.reward_type === 'fixed_discount' || offer.rewardType === 'fixed_discount') {
    const amt = Number(cfg.fixed_discount ?? cfg.fixedDiscount ?? 0);
    return amt > 0 ? `$${amt.toFixed(2)} off` : 'Discount';
  }
  return 'Special offer';
}
