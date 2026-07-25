// Integration service for linking online bookings to loyalty program
import { supabase } from '../../supabaseClient';
import { calculateTotalLoyaltyPointsToEarn, sumCartItemBonusPoints } from '../../utils/loyaltyRewards';

class BookingLoyaltyIntegration {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  /**
   * @param {string} bookingId
   * @param {string} customerId
   * @param {number} bookingTotal pre-tax subtotal
   * @param {{ inventoryLines?: Array<{ inventory_item_id?: string, loyalty_points_earned?: number, quantity?: number }>, offerBonusPoints?: number }} [opts]
   */
  async awardPointsForBooking(bookingId, customerId, bookingTotal, opts = {}) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    if (!customerId) {
      console.warn('[BookingLoyaltyIntegration] No customer ID provided, skipping loyalty points');
      return { pointsAwarded: 0, newBalance: 0, newPoints: 0 };
    }

    const { data: settings, error: settingsError } = await supabase
      .from('pos_loyalty_settings')
      .select('*')
      .eq('business_id', this.businessId)
      .maybeSingle();

    if (settingsError && settingsError.code && settingsError.code !== 'PGRST116') {
      throw settingsError;
    }

    if (!settings || !settings.is_active) {
      console.log('[BookingLoyaltyIntegration] Loyalty program is not active');
      return { pointsAwarded: 0, newBalance: 0, newPoints: 0 };
    }

    const inventoryLines = Array.isArray(opts.inventoryLines) ? opts.inventoryLines : [];
    let cartLikeLines = inventoryLines;

    if (cartLikeLines.length === 0 && bookingId) {
      const { data: participants } = await supabase
        .from('booking_participants')
        .select('inventory_item_id')
        .eq('booking_id', bookingId);
      const { data: addons } = await supabase
        .from('booking_addons')
        .select('inventory_item_id, quantity')
        .eq('booking_id', bookingId);
      const invIds = [
        ...(participants || []).map((p) => p.inventory_item_id).filter(Boolean),
        ...(addons || []).map((a) => a.inventory_item_id).filter(Boolean),
      ];
      if (invIds.length > 0) {
        const { data: invRows } = await supabase
          .from('pos_inventory')
          .select('id, loyalty_points_earned')
          .eq('business_id', this.businessId)
          .in('id', [...new Set(invIds)]);
        const bonusById = new Map((invRows || []).map((r) => [r.id, r.loyalty_points_earned || 0]));
        cartLikeLines = [
          ...(participants || []).map((p) => ({
            inventory_item_id: p.inventory_item_id,
            loyalty_points_earned: bonusById.get(p.inventory_item_id) || 0,
            quantity: 1,
          })),
          ...(addons || []).map((a) => ({
            inventory_item_id: a.inventory_item_id,
            loyalty_points_earned: bonusById.get(a.inventory_item_id) || 0,
            quantity: a.quantity || 1,
          })),
        ];
      }
    }

    const itemBonus = sumCartItemBonusPoints(
      cartLikeLines.map((line) => ({
        loyalty_points_earned: line.loyalty_points_earned || 0,
        quantity: line.quantity || 1,
      })),
    );

    const { data: existingAccount, error: existingAccountError } = await supabase
      .from('pos_loyalty_accounts')
      .select('*')
      .eq('business_id', this.businessId)
      .eq('id', customerId)
      .maybeSingle();

    if (existingAccountError && existingAccountError.code && existingAccountError.code !== 'PGRST116') {
      throw existingAccountError;
    }

    if (!existingAccount) {
      console.warn('[BookingLoyaltyIntegration] Loyalty account not found for customer:', customerId);
      return { pointsAwarded: 0, newBalance: 0, newPoints: 0 };
    }

    // Idempotent: server-side finalization may have already awarded for this booking.
    if (bookingId) {
      const { data: existingTx } = await supabase
        .from('pos_loyalty_transactions')
        .select('id, points, balance_after, points_after')
        .eq('business_id', this.businessId)
        .eq('loyalty_account_id', existingAccount.id)
        .eq('transaction_id', bookingId)
        .eq('transaction_type', 'earn')
        .limit(1)
        .maybeSingle();
      if (existingTx?.id) {
        return {
          pointsAwarded: Number(existingTx.points) || 0,
          newBalance: existingTx.balance_after != null
            ? Number(existingTx.balance_after)
            : Number(existingAccount.balance || 0),
          newPoints: existingTx.points_after != null
            ? Number(existingTx.points_after)
            : Number(existingAccount.points || 0),
          alreadyAwarded: true,
        };
      }
    }

    const earnRatePercent = (settings.earn_rate_percentage || 0) / 100;
    const creditsToEarn = bookingTotal * earnRatePercent;
    const pointsToEarn = calculateTotalLoyaltyPointsToEarn({
      subtotal: bookingTotal,
      earnRatePercentage: settings.earn_rate_percentage,
      redemptionRate: settings.redemption_rate,
      cartItems: cartLikeLines.map((line) => ({
        loyalty_points_earned: line.loyalty_points_earned || 0,
        quantity: line.quantity || 1,
      })),
      offerBonusPoints: opts.offerBonusPoints || 0,
    });

    if (pointsToEarn === 0 && creditsToEarn === 0) {
      return { pointsAwarded: 0, newBalance: existingAccount.balance || 0, newPoints: existingAccount.points || 0 };
    }

    const currentBalance = parseFloat(existingAccount.balance || 0);
    const currentPoints = parseInt(existingAccount.points || 0);
    const newBalance = currentBalance + creditsToEarn;
    const newPoints = settings.loyalty_mode === 'dollars'
      ? Math.round(newBalance * (settings.redemption_rate || 1))
      : currentPoints + pointsToEarn;

    let expiryDate = null;
    if (settings.credits_expire && settings.expiry_months) {
      expiryDate = new Date();
      expiryDate.setMonth(expiryDate.getMonth() + settings.expiry_months);
    }

    const { error: updateError } = await supabase
      .from('pos_loyalty_accounts')
      .update({
        balance: newBalance,
        points: newPoints,
        total_earned: (parseFloat(existingAccount.total_earned || 0) + creditsToEarn),
        last_activity: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingAccount.id);

    if (updateError) {
      throw updateError;
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const bonusNote = itemBonus > 0 ? ` (includes ${itemBonus} item bonus pts)` : '';
    const { error: transactionError } = await supabase
      .from('pos_loyalty_transactions')
      .insert({
        business_id: this.businessId,
        loyalty_account_id: existingAccount.id,
        transaction_id: bookingId,
        transaction_type: 'earn',
        amount: creditsToEarn,
        points: pointsToEarn,
        balance_before: currentBalance,
        balance_after: newBalance,
        points_before: currentPoints,
        points_after: newPoints,
        description: `Points earned from online booking${bonusNote}`,
        earned_date: tomorrow.toISOString().split('T')[0],
        expires_at: expiryDate ? expiryDate.toISOString().split('T')[0] : null,
        processed_at: new Date().toISOString(),
      });

    if (transactionError) {
      console.error('[BookingLoyaltyIntegration] Error logging transaction:', transactionError);
    }

    return {
      pointsAwarded: pointsToEarn,
      creditsAwarded: creditsToEarn,
      itemBonusPoints: itemBonus,
      newBalance,
      newPoints,
    };
  }

  async checkLoyaltyStatus(customerId) {
    if (!this.businessId || !customerId) {
      return { hasLoyalty: false, currentBalance: 0, currentPoints: 0 };
    }

    const { data: account, error: accountError } = await supabase
      .from('pos_loyalty_accounts')
      .select('balance, points, is_active')
      .eq('business_id', this.businessId)
      .eq('id', customerId)
      .maybeSingle();

    if (accountError && accountError.code && accountError.code !== 'PGRST116') {
      throw accountError;
    }

    if (!account || !account.is_active) {
      return { hasLoyalty: false, currentBalance: 0, currentPoints: 0 };
    }

    return {
      hasLoyalty: true,
      currentBalance: parseFloat(account.balance || 0),
      currentPoints: parseInt(account.points || 0),
    };
  }
}

export default new BookingLoyaltyIntegration();
