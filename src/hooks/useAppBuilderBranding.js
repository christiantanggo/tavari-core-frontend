// Step 62: Create useAppBuilderBranding hook
// Hook for branding operations
import { useState, useEffect } from 'react';
import AppBuilderBrandingService from '../services/AppBuilder/AppBuilderBrandingService';
import { useBusinessContext } from '../contexts/BusinessContext';

export const useAppBuilderBranding = () => {
  const { selectedBusinessId } = useBusinessContext();
  const [branding, setBranding] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!selectedBusinessId) {
      setLoading(false);
      return;
    }

    AppBuilderBrandingService.setBusinessId(selectedBusinessId);
    loadBranding();
  }, [selectedBusinessId]);

  const loadBranding = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await AppBuilderBrandingService.getBranding();
      setBranding(data);
    } catch (err) {
      console.error('Error loading branding:', err);
      setError(err.message);
      // Set empty branding if not found
      setBranding({});
    } finally {
      setLoading(false);
    }
  };

  const updateBranding = async (brandingData) => {
    try {
      setError(null);
      const updated = await AppBuilderBrandingService.updateBranding(brandingData);
      setBranding(updated);
      return updated;
    } catch (err) {
      console.error('Error updating branding:', err);
      setError(err.message);
      throw err;
    }
  };

  const uploadAsset = async (file, assetType) => {
    try {
      setError(null);
      // Handle favicon specially since it's uploadFavicon not uploadFavicon
      const methodName = assetType === 'favicon' 
        ? 'uploadFavicon' 
        : `upload${assetType.charAt(0).toUpperCase() + assetType.slice(1)}`;
      const result = await AppBuilderBrandingService[methodName](file);
      
      // Reload branding to get updated URLs
      await loadBranding();
      
      return result;
    } catch (err) {
      console.error(`Error uploading ${assetType}:`, err);
      setError(err.message);
      throw err;
    }
  };

  const generateManifest = async () => {
    try {
      setError(null);
      const manifest = await AppBuilderBrandingService.generatePWAManifest();
      await loadBranding(); // Reload to get updated PWA settings
      return manifest;
    } catch (err) {
      console.error('Error generating manifest:', err);
      setError(err.message);
      throw err;
    }
  };

  return {
    branding,
    loading,
    error,
    updateBranding,
    uploadAsset,
    generateManifest,
    refresh: loadBranding
  };
};

