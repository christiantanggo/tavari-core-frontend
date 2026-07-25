// services/music-v2/PricingEngine.js
// Pricing calculation engine for Music V2 system

import { supabase } from '../../supabaseClient';

class PricingEngine {
  constructor() {
    this.pricingCache = null;
    this.cacheTime = null;
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get pricing for a plan + ad frequency combination
   * @param {string} planKey - 'standard', 'plus', or 'premium'
   * @param {string} adFrequency - 'zero_ads', 'one_per_8', etc.
   * @returns {Promise<{mode: string, value: number, planId: string}>}
   */
  async getPricing(planKey, adFrequency) {
    try {
      // Get plan
      const { data: plan, error: planError } = await supabase
        .from('music_v2_plans')
        .select('id')
        .eq('plan_key', planKey)
        .eq('is_active', true)
        .single();

      if (planError || !plan) {
        throw new Error(`Plan not found: ${planKey}`);
      }

      // Get pricing from matrix
      const { data: pricing, error: pricingError } = await supabase
        .from('music_v2_pricing_matrix')
        .select('pricing_mode, pricing_value')
        .eq('plan_id', plan.id)
        .eq('ad_frequency', adFrequency)
        .single();

      if (pricingError || !pricing) {
        throw new Error(`Pricing not found for ${planKey} + ${adFrequency}`);
      }

      return {
        mode: pricing.pricing_mode, // 'fixed_cost' or 'revenue_share'
        value: parseFloat(pricing.pricing_value),
        planId: plan.id
      };
    } catch (error) {
      console.error('Error getting pricing:', error);
      throw error;
    }
  }

  /**
   * Get all pricing options for a plan (for UI display)
   * @param {string} planKey - 'standard', 'plus', or 'premium'
   * @returns {Promise<Array>}
   */
  async getPricingOptions(planKey) {
    try {
      const { data: plan, error: planError } = await supabase
        .from('music_v2_plans')
        .select('id, name')
        .eq('plan_key', planKey)
        .eq('is_active', true)
        .single();

      if (planError || !plan) {
        throw new Error(`Plan not found: ${planKey}`);
      }

      const { data: pricingOptions, error: pricingError } = await supabase
        .from('music_v2_pricing_matrix')
        .select('ad_frequency, pricing_mode, pricing_value')
        .eq('plan_id', plan.id)
        .order('ad_frequency');

      if (pricingError) {
        throw pricingError;
      }

      return pricingOptions.map(option => ({
        adFrequency: option.ad_frequency,
        mode: option.pricing_mode,
        value: parseFloat(option.pricing_value),
        displayText: this.formatPricingDisplay(option.pricing_mode, option.pricing_value)
      }));
    } catch (error) {
      console.error('Error getting pricing options:', error);
      throw error;
    }
  }

  /**
   * Format pricing for display
   * @param {string} mode - 'fixed_cost' or 'revenue_share'
   * @param {number} value - Dollar amount or percentage
   * @returns {string}
   */
  formatPricingDisplay(mode, value) {
    if (mode === 'fixed_cost') {
      if (value === 0) {
        return 'Free';
      }
      return `$${value.toFixed(2)}/month`;
    } else {
      return `${value}% revenue share`;
    }
  }

  /**
   * Calculate effective ad frequency bracket from actual ratio
   * @param {number} songsPlayed - Total songs played
   * @param {number} adsPlayed - Total ads played
   * @returns {string} - Ad frequency bracket
   */
  calculateEffectiveFrequency(songsPlayed, adsPlayed) {
    if (adsPlayed === 0) {
      return 'zero_ads';
    }

    const ratio = songsPlayed / adsPlayed;

    // Map ratio to bracket
    if (ratio >= 7.1) return 'one_per_8';
    if (ratio >= 6.1) return 'one_per_7';
    if (ratio >= 5.1) return 'one_per_6';
    if (ratio >= 4.1) return 'one_per_5';
    if (ratio >= 3.1) return 'one_per_4';
    return 'one_per_3';
  }

  /**
   * Calculate revenue share or subscription cost for a location
   * @param {string} locationId - Location ID
   * @param {Date} startDate - Start of billing period
   * @param {Date} endDate - End of billing period
   * @returns {Promise<{subscriptionCost: number, revenueShare: number, netPayout: number}>}
   */
  async calculateLocationBilling(locationId, startDate, endDate) {
    try {
      // Get location config
      const { data: location, error: locationError } = await supabase
        .from('music_v2_locations')
        .select('plan_id, default_ad_frequency')
        .eq('id', locationId)
        .single();

      if (locationError || !location) {
        throw new Error('Location not found');
      }

      // Get playback logs for period
      const { data: logs, error: logsError } = await supabase
        .from('music_v2_playback_logs')
        .select('log_type, duration_played')
        .eq('location_id', locationId)
        .gte('start_time', startDate.toISOString())
        .lte('start_time', endDate.toISOString())
        .eq('synced_to_server', true);

      if (logsError) {
        throw logsError;
      }

      const songsPlayed = logs.filter(l => l.log_type === 'song').length;
      const adsPlayed = logs.filter(l => l.log_type === 'ad').length;

      // Calculate effective frequency
      const effectiveFrequency = this.calculateEffectiveFrequency(songsPlayed, adsPlayed);

      // Get plan
      const { data: plan, error: planError } = await supabase
        .from('music_v2_plans')
        .select('plan_key')
        .eq('id', location.plan_id)
        .single();

      if (planError) {
        throw planError;
      }

      // Get pricing for effective frequency
      const pricing = await this.getPricing(plan.plan_key, effectiveFrequency);

      // Calculate ad revenue (sum from ad_impressions)
      const { data: adImpressions, error: adError } = await supabase
        .from('music_v2_ad_impressions')
        .select('revenue_amount')
        .eq('location_id', locationId)
        .gte('played_at', startDate.toISOString())
        .lte('played_at', endDate.toISOString());

      if (adError) {
        throw adError;
      }

      const totalAdRevenue = adImpressions.reduce((sum, imp) => sum + parseFloat(imp.revenue_amount || 0), 0);

      let subscriptionCost = 0;
      let revenueShare = 0;
      let netPayout = 0;

      if (pricing.mode === 'fixed_cost') {
        subscriptionCost = pricing.value;
        netPayout = -subscriptionCost; // Negative = they pay
      } else {
        revenueShare = totalAdRevenue * (pricing.value / 100);
        netPayout = revenueShare; // Positive = they earn
      }

      return {
        subscriptionCost,
        revenueShare,
        totalAdRevenue,
        netPayout,
        effectiveFrequency,
        songsPlayed,
        adsPlayed
      };
    } catch (error) {
      console.error('Error calculating location billing:', error);
      throw error;
    }
  }
}

export const pricingEngine = new PricingEngine();
export default pricingEngine;


