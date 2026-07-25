// Step 68: Create useAppBuilderAssets hook
// Hook for asset management operations
import { useState, useEffect } from 'react';
import AppBuilderAssetService from '../services/AppBuilder/AppBuilderAssetService';
import { useBusinessContext } from '../contexts/BusinessContext';

export const useAppBuilderAssets = () => {
  const { selectedBusinessId } = useBusinessContext();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!selectedBusinessId) {
      setLoading(false);
      return;
    }

    AppBuilderAssetService.setBusinessId(selectedBusinessId);
    loadAssets();
  }, [selectedBusinessId]);

  const loadAssets = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await AppBuilderAssetService.getAssets();
      setAssets(data || []);
    } catch (err) {
      console.error('Error loading assets:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const uploadAsset = async (file, assetType) => {
    try {
      setError(null);
      // Validate asset first
      AppBuilderAssetService.validateAsset(file, assetType);
      
      const newAsset = await AppBuilderAssetService.uploadAsset(file, assetType);
      await loadAssets(); // Reload to get updated list
      return newAsset;
    } catch (err) {
      console.error('Error uploading asset:', err);
      setError(err.message);
      throw err;
    }
  };

  const deleteAsset = async (assetId) => {
    try {
      setError(null);
      await AppBuilderAssetService.deleteAsset(assetId);
      await loadAssets(); // Reload to get updated list
    } catch (err) {
      console.error('Error deleting asset:', err);
      setError(err.message);
      throw err;
    }
  };

  const validateAsset = (file, assetType) => {
    try {
      return AppBuilderAssetService.validateAsset(file, assetType);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  return {
    assets,
    loading,
    error,
    uploadAsset,
    deleteAsset,
    validateAsset,
    refresh: loadAssets
  };
};




