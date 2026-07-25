// hooks/useModuleCatalog.js
// Hook for module marketplace/catalog functionality with realtime updates
import { useState, useEffect, useCallback } from 'react';
import { useBusinessContext } from '../contexts/BusinessContext';
import { supabase } from '../supabaseClient';
import ModuleCatalogService from '../services/ModuleCatalogService';

/**
 * Hook to get all modules with activation status
 * @returns {Object} - { modules, activatedModules, nonActivatedModules, loading, error, refresh }
 */
export const useModuleCatalog = () => {
  const { selectedBusinessId } = useBusinessContext();
  const [modules, setModules] = useState([]);
  const [activatedModules, setActivatedModules] = useState([]);
  const [nonActivatedModules, setNonActivatedModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadModules = useCallback(async () => {
    if (!selectedBusinessId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      ModuleCatalogService.setBusinessId(selectedBusinessId);
      const allModules = await ModuleCatalogService.getAllModulesWithStatus();
      
      setModules(allModules);
      const enabled = allModules.filter(m => m.isEnabled === true);
      const nonEnabled = allModules.filter(m => !m.isEnabled);
      
      setActivatedModules(enabled);
      setNonActivatedModules(nonEnabled);
    } catch (err) {
      console.error('Error loading module catalog:', err);
      setError(err.message);
      setModules([]);
      setActivatedModules([]);
      setNonActivatedModules([]);
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId]);

  // Initial load
  useEffect(() => {
    loadModules();
  }, [loadModules]);

  // Set up realtime subscription for business_module_usage changes
  useEffect(() => {
    if (!selectedBusinessId) return;

    // Subscribe to changes in business_module_usage for this business
    const channel = supabase
      .channel(`business_module_usage_${selectedBusinessId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'business_module_usage',
          filter: `business_id=eq.${selectedBusinessId}`
        },
        (payload) => {
          // Refresh modules when any change occurs
          loadModules();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedBusinessId, loadModules]);

  // Listen for custom events (for immediate updates when modules are activated)
  useEffect(() => {
    const handleModuleActivated = (event) => {
      if (event.detail?.businessId === selectedBusinessId) {
        loadModules();
      }
    };

    window.addEventListener('module-activated', handleModuleActivated);
    window.addEventListener('module-deactivated', handleModuleActivated);

    return () => {
      window.removeEventListener('module-activated', handleModuleActivated);
      window.removeEventListener('module-deactivated', handleModuleActivated);
    };
  }, [selectedBusinessId, loadModules]);

  const refresh = useCallback(() => {
    loadModules();
  }, [loadModules]);

  return {
    modules,
    activatedModules,
    nonActivatedModules,
    loading,
    error,
    refresh
  };
};

