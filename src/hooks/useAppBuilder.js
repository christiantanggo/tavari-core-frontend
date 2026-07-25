// Step 61: Create useAppBuilder hook
// Main hook for AppBuilder functionality
import { useState, useEffect } from 'react';
import AppBuilderService from '../services/AppBuilder/AppBuilderService';
import { useBusinessContext } from '../contexts/BusinessContext';

export const useAppBuilder = () => {
  const { selectedBusinessId } = useBusinessContext();
  const [branding, setBranding] = useState(null);
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!selectedBusinessId) {
      setLoading(false);
      return;
    }

    AppBuilderService.setBusinessId(selectedBusinessId);
    loadData();
  }, [selectedBusinessId]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [brandingData, modulesData] = await Promise.all([
        AppBuilderService.getBranding().catch(() => null), // May not exist yet
        AppBuilderService.getEnabledModules()
      ]);

      setBranding(brandingData);
      setModules(modulesData || []);
    } catch (err) {
      console.error('Error loading app builder data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateBranding = async (brandingData) => {
    try {
      setError(null);
      const updated = await AppBuilderService.updateBranding(brandingData);
      setBranding(updated);
      return updated;
    } catch (err) {
      console.error('Error updating branding:', err);
      setError(err.message);
      throw err;
    }
  };

  const refresh = async () => {
    await loadData();
  };

  return {
    branding,
    modules,
    loading,
    error,
    refresh,
    updateBranding
  };
};




