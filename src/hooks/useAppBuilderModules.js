// Step 63: Create useAppBuilderModules hook
// Hook for module management operations
import { useState, useEffect } from 'react';
import AppBuilderModuleService from '../services/AppBuilder/AppBuilderModuleService';
import { useBusinessContext } from '../contexts/BusinessContext';

export const useAppBuilderModules = () => {
  const { selectedBusinessId } = useBusinessContext();
  const [availableModules, setAvailableModules] = useState([]);
  const [enabledModules, setEnabledModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!selectedBusinessId) {
      setLoading(false);
      return;
    }

    AppBuilderModuleService.setBusinessId(selectedBusinessId);
    loadModules();
  }, [selectedBusinessId]);

  const loadModules = async () => {
    try {
      setLoading(true);
      setError(null);

      const [available, enabled] = await Promise.all([
        AppBuilderModuleService.getAvailableModules(),
        AppBuilderModuleService.getEnabledModules()
      ]);

      setAvailableModules(available || []);
      setEnabledModules(enabled || []);
    } catch (err) {
      console.error('Error loading modules:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleModule = async (moduleKey, enabled) => {
    try {
      setError(null);
      await AppBuilderModuleService.toggleModule(moduleKey, enabled);
      await loadModules(); // Reload to get updated state
    } catch (err) {
      console.error('Error toggling module:', err);
      setError(err.message);
      throw err;
    }
  };

  const checkAccess = async (moduleKey) => {
    try {
      return await AppBuilderModuleService.checkModuleAccess(moduleKey);
    } catch (err) {
      console.error('Error checking module access:', err);
      return false;
    }
  };

  return {
    availableModules,
    enabledModules,
    loading,
    error,
    toggleModule,
    checkAccess,
    refresh: loadModules
  };
};




