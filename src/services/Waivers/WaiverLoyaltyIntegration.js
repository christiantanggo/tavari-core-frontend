// Step 72: Create WaiverLoyaltyIntegration.js
// Integration service for linking waivers to loyalty program
// Uses existing pos_loyalty_accounts, pos_loyalty_transactions, pos_loyalty_settings tables
import { supabase } from '../../supabaseClient';

class WaiverLoyaltyIntegration {
  constructor() {
    this.businessId = null;
  }

  setBusinessId(businessId) {
    this.businessId = businessId;
  }

  // Award points for signing waiver
  async awardPointsForWaiver(waiverId, customerId) {
    if (!this.businessId || !customerId) {
      throw new Error('Business ID and customer ID are required');
    }

    // Get loyalty settings for waiver points
    const { data: settings, error: settingsError } = await supabase
      .from('pos_loyalty_settings')
      .select('waiver_points_award')
      .eq('business_id', this.businessId)
      .maybeSingle();

    if (settingsError && settingsError.code && settingsError.code !== 'PGRST116') {
      throw settingsError;
    }

    const pointsToAward = settings?.waiver_points_award || 0;

    if (pointsToAward === 0) {
      return { pointsAwarded: 0 };
    }

    const { data: loyaltyAccount, error: existingAccountError } = await supabase
      .from('pos_loyalty_accounts')
      .select('*')
      .eq('id', customerId)
      .eq('business_id', this.businessId)
      .maybeSingle();

    if (existingAccountError && existingAccountError.code && existingAccountError.code !== 'PGRST116') {
      throw existingAccountError;
    }

    if (!loyaltyAccount) {
      return { pointsAwarded: 0, skipped: true, reason: 'Customer loyalty account not found' };
    }

    const currentBalance = parseFloat(loyaltyAccount.balance || 0);
    const currentPoints = parseFloat(loyaltyAccount.points || 0);
    const newPoints = currentPoints + pointsToAward;

    // Award points using the live loyalty schema.
    const { data: updatedAccount, error: updateError } = await supabase
      .from('pos_loyalty_accounts')
      .update({
        points: newPoints,
        total_earned: parseFloat(loyaltyAccount.total_earned || 0) + pointsToAward,
        last_activity: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', loyaltyAccount.id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    // Log transaction
    await supabase
      .from('pos_loyalty_transactions')
      .insert({
        business_id: this.businessId,
        loyalty_account_id: loyaltyAccount.id,
        transaction_id: waiverId,
        transaction_type: 'earn',
        amount: 0,
        points: pointsToAward,
        balance_before: currentBalance,
        balance_after: currentBalance,
        points_before: currentPoints,
        points_after: newPoints,
        description: 'Points awarded for signing waiver',
        processed_at: new Date().toISOString()
      });

    return { pointsAwarded: pointsToAward, newBalance: updatedAccount.balance, newPoints: updatedAccount.points };
  }

  // Check loyalty incentives for waivers
  async checkLoyaltyIncentives(customerId) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: account, error: accountError } = await supabase
      .from('pos_loyalty_accounts')
      .select('*')
      .eq('id', customerId)
      .eq('business_id', this.businessId)
      .maybeSingle();

    if (accountError && accountError.code && accountError.code !== 'PGRST116') {
      throw accountError;
    }

    if (!account) {
      return { hasIncentive: false };
    }

    // Check if customer qualifies for waiver-related incentives
    const { data: settings, error: incentiveSettingsError } = await supabase
      .from('pos_loyalty_settings')
      .select('waiver_points_award, waiver_discount_percent')
      .eq('business_id', this.businessId)
      .maybeSingle();

    if (incentiveSettingsError && incentiveSettingsError.code && incentiveSettingsError.code !== 'PGRST116') {
      throw incentiveSettingsError;
    }

    return {
      hasIncentive: (settings?.waiver_points_award || 0) > 0,
      pointsAward: settings?.waiver_points_award || 0,
      discountPercent: settings?.waiver_discount_percent || 0
    };
  }

  // Apply waiver discount (if configured)
  async applyWaiverDiscount(customerId, amount) {
    if (!this.businessId) {
      throw new Error('Business ID is required');
    }

    const { data: settings, error: discountSettingsError } = await supabase
      .from('pos_loyalty_settings')
      .select('waiver_discount_percent')
      .eq('business_id', this.businessId)
      .maybeSingle();

    if (discountSettingsError && discountSettingsError.code && discountSettingsError.code !== 'PGRST116') {
      throw discountSettingsError;
    }

    const discountPercent = settings?.waiver_discount_percent || 0;

    if (discountPercent === 0) {
      return { discount: 0, finalAmount: amount };
    }

    const discount = (amount * discountPercent) / 100;
    const finalAmount = amount - discount;

    return { discount, finalAmount, discountPercent };
  }
}

export default new WaiverLoyaltyIntegration();

