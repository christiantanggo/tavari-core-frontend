// Hook for checking module subscription status
import { useState, useEffect } from 'react';
import { useBusinessContext } from '../contexts/BusinessContext';
import ModuleSubscriptionService from '../services/ModuleSubscriptionService';

/**
 * Hook to check module subscription status for current business
 * @param {string} moduleKey - Module key to check (e.g., 'music', 'pos')
 * @param {Object} options - Options
 * @param {boolean} options.autoCheck - Automatically check on mount (default: true)
 * @returns {Object} Subscription status and methods
 */
export const useModuleSubscription = (moduleKey, options = {}) => {
  const { autoCheck = true } = options;
  const { selectedBusinessId } = useBusinessContext();
  
  const [hasAccess, setHasAccess] = useState(true); // Default to true (fail open)
  const [tier, setTier] = useState(null);
  const [status, setStatus] = useState(null);
  const [subscriptionType, setSubscriptionType] = useState(null);
  const [loading, setLoading] = useState(autoCheck);
  const [error, setError] = useState(null);
  const [isTrial, setIsTrial] = useState(false);
  const [trialDaysRemaining, setTrialDaysRemaining] = useState(null);

  const checkAccess = async () => {
    if (!selectedBusinessId || !moduleKey) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const accessResult = await ModuleSubscriptionService.checkModuleAccess(
        selectedBusinessId,
        moduleKey
      );

      setHasAccess(accessResult.hasAccess);
      setTier(accessResult.tier);
      setStatus(accessResult.status);
      setSubscriptionType(accessResult.subscriptionType);

      // Check trial status
      if (accessResult.hasAccess && accessResult.status === 'trial') {
        setIsTrial(true);
        const daysRemaining = await ModuleSubscriptionService.getTrialDaysRemaining(
          selectedBusinessId,
          moduleKey
        );
        setTrialDaysRemaining(daysRemaining);
      } else {
        setIsTrial(false);
        setTrialDaysRemaining(null);
      }

    } catch (err) {
      console.error('Error checking module subscription:', err);
      setError(err.message);
      // Fail open - allow access on error
      setHasAccess(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoCheck && selectedBusinessId && moduleKey) {
      checkAccess();
    }
  }, [selectedBusinessId, moduleKey, autoCheck]);

  /**
   * Check if a specific feature is accessible
   * @param {string} featureKey - Feature key (e.g., 'music.upload')
   * @returns {Promise<boolean>}
   */
  const checkFeatureAccess = async (featureKey) => {
    if (!selectedBusinessId || !featureKey) {
      return false;
    }

    try {
      return await ModuleSubscriptionService.checkFeatureAccess(
        selectedBusinessId,
        featureKey
      );
    } catch (err) {
      console.error('Error checking feature access:', err);
      return true; // Fail open
    }
  };

  /**
   * Refresh subscription status
   */
  const refresh = () => {
    checkAccess();
  };

  return {
    // State
    hasAccess,
    tier,
    status,
    subscriptionType,
    loading,
    error,
    isTrial,
    trialDaysRemaining,
    
    // Methods
    checkAccess,
    checkFeatureAccess,
    refresh,
    
    // Computed
    isFree: tier === 'free',
    isStarter: tier === 'starter',
    isProfessional: tier === 'professional',
    isEnterprise: tier === 'enterprise',
    needsUpgrade: !hasAccess || (tier === 'free' && status !== 'trial'),
    canUpgrade: !hasAccess || tier !== 'enterprise'
  };
};

export default useModuleSubscription;



