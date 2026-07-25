// hooks/useModuleEnabled.js
// Simple hook to check if a specific module is enabled for the current business
import { useState, useEffect, useCallback } from 'react';
import { useBusinessContext } from '../contexts/BusinessContext';
import { supabase } from '../supabaseClient';
import AppBuilderModuleService from '../services/AppBuilder/AppBuilderModuleService';

/**
 * Hook to check if a module is enabled for the current business
 * @param {string} moduleKey - The module key to check (e.g., 'music', 'pos', 'hr', 'mail')
 * @returns {Object} - { isEnabled: boolean, loading: boolean, error: string|null }
 */
export const useModuleEnabled = (moduleKey) => {
  const { selectedBusinessId } = useBusinessContext();
  const [isEnabled, setIsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const checkModule = useCallback(async () => {
    if (!selectedBusinessId || !moduleKey) {
      setLoading(false);
      setIsEnabled(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      AppBuilderModuleService.setBusinessId(selectedBusinessId);
      const enabledModules = await AppBuilderModuleService.getEnabledModules();
      
      const module = enabledModules.find(m => m.module_key === moduleKey);
      setIsEnabled(module?.enabled === true);
    } catch (err) {
      console.error(`Error checking if module ${moduleKey} is enabled:`, err);
      setError(err.message);
      setIsEnabled(false);
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId, moduleKey]);

  useEffect(() => {
    checkModule();
  }, [checkModule]);

  // Listen for module activation events
  useEffect(() => {
    const handleModuleChange = (event) => {
      if (event.detail?.moduleKey === moduleKey && event.detail?.businessId === selectedBusinessId) {
        checkModule();
      }
    };

    window.addEventListener('module-activated', handleModuleChange);
    window.addEventListener('module-deactivated', handleModuleChange);

    return () => {
      window.removeEventListener('module-activated', handleModuleChange);
      window.removeEventListener('module-deactivated', handleModuleChange);
    };
  }, [moduleKey, selectedBusinessId, checkModule]);

  // Set up realtime subscription for this specific module
  useEffect(() => {
    if (!selectedBusinessId || !moduleKey) return;

    const channel = supabase
      .channel(`module_enabled_${selectedBusinessId}_${moduleKey}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'business_module_usage',
          filter: `business_id=eq.${selectedBusinessId}`
        },
        (payload) => {
          // Check if this change affects our module
          if (payload.new?.module_key === moduleKey || payload.old?.module_key === moduleKey) {
            checkModule();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedBusinessId, moduleKey, checkModule]);

  return { isEnabled, loading, error };
};

/**
 * Hook to check multiple modules at once
 * @param {string[]} moduleKeys - Array of module keys to check
 * @returns {Object} - { modules: { [moduleKey]: boolean }, loading: boolean, error: string|null }
 */
export const useModulesEnabled = (moduleKeys = []) => {
  const { selectedBusinessId } = useBusinessContext();
  const [modules, setModules] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const checkModules = useCallback(async () => {
    if (!selectedBusinessId || !moduleKeys || moduleKeys.length === 0) {
      setLoading(false);
      setModules({});
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      AppBuilderModuleService.setBusinessId(selectedBusinessId);
      const enabledModules = await AppBuilderModuleService.getEnabledModules();
      
      const moduleStatus = {};
      moduleKeys.forEach(key => {
        const module = enabledModules.find(m => m.module_key === key);
        moduleStatus[key] = module?.enabled === true;
      });
      
      setModules(moduleStatus);
    } catch (err) {
      console.error('Error checking modules:', err);
      setError(err.message);
      setModules({});
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId, moduleKeys.join(',')]);

  useEffect(() => {
    checkModules();
  }, [checkModules]);

  // Listen for module activation events
  useEffect(() => {
    const handleModuleChange = (event) => {
      if (event.detail?.businessId === selectedBusinessId) {
        checkModules();
      }
    };

    window.addEventListener('module-activated', handleModuleChange);
    window.addEventListener('module-deactivated', handleModuleChange);

    return () => {
      window.removeEventListener('module-activated', handleModuleChange);
      window.removeEventListener('module-deactivated', handleModuleChange);
    };
  }, [selectedBusinessId, checkModules]);

  // Set up realtime subscription for business_module_usage changes
  useEffect(() => {
    if (!selectedBusinessId || !moduleKeys || moduleKeys.length === 0) return;

    const channel = supabase
      .channel(`modules_enabled_${selectedBusinessId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'business_module_usage',
          filter: `business_id=eq.${selectedBusinessId}`
        },
        (payload) => {
          // Refresh if any of our modules changed
          const changedModuleKey = payload.new?.module_key || payload.old?.module_key;
          if (moduleKeys.includes(changedModuleKey)) {
            checkModules();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedBusinessId, moduleKeys.join(','), checkModules]);

  return { modules, loading, error };
};

