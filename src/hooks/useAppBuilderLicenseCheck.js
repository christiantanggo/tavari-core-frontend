// Step 70: Create useAppBuilderLicenseCheck hook
// Hook for checking module license/enablement
import { useState, useEffect } from 'react';
import AppBuilderModuleService from '../services/AppBuilder/AppBuilderModuleService';
import { useBusinessContext } from '../contexts/BusinessContext';

export const useAppBuilderLicenseCheck = (moduleKey) => {
  const { selectedBusinessId } = useBusinessContext();
  const [isEnabled, setIsEnabled] = useState(false);
  const [isTrial, setIsTrial] = useState(false);
  const [expiresAt, setExpiresAt] = useState(null);
  const [canAccess, setCanAccess] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedBusinessId || !moduleKey) {
      setLoading(false);
      return;
    }

    AppBuilderModuleService.setBusinessId(selectedBusinessId);
    checkLicense();
  }, [selectedBusinessId, moduleKey]);

  const checkLicense = async () => {
    try {
      setLoading(true);
      
      // Get enabled modules
      const enabledModules = await AppBuilderModuleService.getEnabledModules();
      const module = enabledModules.find(m => m.module_key === moduleKey);

      if (module) {
        setIsEnabled(module.enabled);
        setIsTrial(module.trial_enabled || false);
        setExpiresAt(module.trial_expires_at);
        
        // Check if user has access
        const hasAccess = await AppBuilderModuleService.checkModuleAccess(moduleKey);
        setCanAccess(hasAccess && module.enabled);
      } else {
        setIsEnabled(false);
        setCanAccess(false);
      }
    } catch (err) {
      console.error('Error checking license:', err);
      setIsEnabled(false);
      setCanAccess(false);
    } finally {
      setLoading(false);
    }
  };

  return {
    isEnabled,
    isTrial,
    expiresAt,
    canAccess,
    loading,
    refresh: checkLicense
  };
};




