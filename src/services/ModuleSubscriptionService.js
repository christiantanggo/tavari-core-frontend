// Module Subscription Service
// Checks business subscription status and feature access for modules

import { supabase } from '../supabaseClient';

class ModuleSubscriptionService {
  /**
   * Check if a business has access to a module
   * @param {string} businessId - Business UUID
   * @param {string} moduleKey - Module key (e.g., 'music', 'pos')
   * @returns {Promise<{hasAccess: boolean, tier: string|null, status: string|null, subscriptionType: string|null}>}
   */
  static async checkModuleAccess(businessId, moduleKey) {
    try {
      if (!businessId || !moduleKey) {
        return {
          hasAccess: false,
          tier: null,
          status: null,
          subscriptionType: null
        };
      }

      // Check for active subscription (module or package)
      const { data, error } = await supabase
        .rpc('get_business_subscription_status', {
          business_uuid: businessId,
          module_key_param: moduleKey
        });

      if (error) {
        console.error('Error checking module access:', error);
        // On error, allow access (fail open) - you can change this to fail closed
        return {
          hasAccess: true, // Fail open for now
          tier: null,
          status: null,
          subscriptionType: null,
          error: error.message
        };
      }

      if (!data || data.length === 0) {
        // No subscription found - check if module is enabled in business_module_usage
        // This is the primary check - if module is enabled, grant access
        try {
          const { data: moduleUsage } = await supabase
            .from('business_module_usage')
            .select('enabled')
            .eq('business_id', businessId)
            .eq('module_key', moduleKey)
            .eq('enabled', true)
            .maybeSingle();

          if (moduleUsage) {
            // Module is enabled - grant access
            return {
              hasAccess: true,
              tier: 'enabled',
              status: 'active',
              subscriptionType: 'module'
            };
          }
        } catch (err) {
          // Error checking business_module_usage - fail open (allow access)
          console.error('Error checking business_module_usage:', err);
        }

        // Check if module_tier_pricing table exists and has free tier
        try {
          const { data: tierPricing, error: tierError } = await supabase
            .from('module_tier_pricing')
            .select('tier_key')
            .eq('module_key', moduleKey)
            .eq('tier_key', 'free')
            .eq('is_available', true)
            .maybeSingle();

          if (tierPricing) {
            // Free tier available - grant access
            return {
              hasAccess: true,
              tier: 'free',
              status: 'free',
              subscriptionType: 'free'
            };
          }
        } catch (err) {
          // Table doesn't exist or other error - fail open
        }

        // No subscription found and module not enabled - fail open (allow access)
        // This ensures modules work even if subscription system isn't fully configured
        return {
          hasAccess: true,
          tier: 'enabled',
          status: 'active',
          subscriptionType: 'module'
        };
      }

      const subscription = data[0];
      const hasAccess = subscription.has_access === true;
      const status = subscription.status;

      return {
        hasAccess,
        tier: subscription.tier_key || null,
        status: subscription.status || null,
        subscriptionType: subscription.subscription_type || null
      };

    } catch (error) {
      console.error('Exception checking module access:', error);
      // Fail open - allow access on error
      return {
        hasAccess: true,
        tier: null,
        status: null,
        subscriptionType: null,
        error: error.message
      };
    }
  }

  /**
   * Check if a business has access to a specific feature
   * @param {string} businessId - Business UUID
   * @param {string} featureKey - Feature key (e.g., 'music.upload', 'music.ads.manage')
   * @returns {Promise<boolean>}
   */
  static async checkFeatureAccess(businessId, featureKey) {
    try {
      if (!businessId || !featureKey) {
        return false;
      }

      const { data, error } = await supabase
        .rpc('check_feature_access', {
          business_uuid: businessId,
          feature_key_param: featureKey
        });

      if (error) {
        console.error('Error checking feature access:', error);
        // Fail open for now
        return true;
      }

      return data === true;

    } catch (error) {
      console.error('Exception checking feature access:', error);
      // Fail open
      return true;
    }
  }

  /**
   * Get subscription details for a business and module
   * @param {string} businessId - Business UUID
   * @param {string} moduleKey - Module key
   * @returns {Promise<Object|null>}
   */
  static async getSubscriptionDetails(businessId, moduleKey) {
    try {
      const { data, error } = await supabase
        .from('business_subscriptions')
        .select(`
          *,
          module_tiers (tier_name, tier_key),
          subscription_packages (package_name, included_modules)
        `)
        .eq('business_id', businessId)
        .or(`and(subscription_type.eq.module,subscription_key.eq.${moduleKey}),and(subscription_type.eq.package,subscription_key.in.(${moduleKey}))`)
        .in('status', ['active', 'trial'])
        .single();

      if (error || !data) {
        return null;
      }

      return data;

    } catch (error) {
      console.error('Error getting subscription details:', error);
      return null;
    }
  }

  /**
   * Check if business is on trial
   * @param {string} businessId - Business UUID
   * @param {string} moduleKey - Module key
   * @returns {Promise<boolean>}
   */
  static async isOnTrial(businessId, moduleKey) {
    try {
      const subscription = await this.getSubscriptionDetails(businessId, moduleKey);
      if (!subscription) return false;

      if (subscription.status === 'trial') {
        // Check if trial hasn't expired
        if (subscription.trial_ends_at) {
          return new Date(subscription.trial_ends_at) > new Date();
        }
        return true;
      }

      return false;

    } catch (error) {
      console.error('Error checking trial status:', error);
      return false;
    }
  }

  /**
   * Get days remaining in trial
   * @param {string} businessId - Business UUID
   * @param {string} moduleKey - Module key
   * @returns {Promise<number|null>}
   */
  static async getTrialDaysRemaining(businessId, moduleKey) {
    try {
      const subscription = await this.getSubscriptionDetails(businessId, moduleKey);
      if (!subscription || subscription.status !== 'trial') {
        return null;
      }

      if (!subscription.trial_ends_at) {
        return null;
      }

      const trialEnd = new Date(subscription.trial_ends_at);
      const now = new Date();
      const diffTime = trialEnd - now;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      return diffDays > 0 ? diffDays : 0;

    } catch (error) {
      console.error('Error getting trial days remaining:', error);
      return null;
    }
  }
}

export default ModuleSubscriptionService;

