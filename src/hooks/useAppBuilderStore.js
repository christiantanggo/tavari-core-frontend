// Step 69: Create useAppBuilderStore hook
// Hook for store listing operations
import { useState, useEffect } from 'react';
import AppBuilderStoreService from '../services/AppBuilder/AppBuilderStoreService';
import { useBusinessContext } from '../contexts/BusinessContext';

export const useAppBuilderStore = (platform) => {
  const { selectedBusinessId } = useBusinessContext();
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!selectedBusinessId || !platform) {
      setLoading(false);
      return;
    }

    AppBuilderStoreService.setBusinessId(selectedBusinessId);
    loadListing();
  }, [selectedBusinessId, platform]);

  const loadListing = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await AppBuilderStoreService.getListing(platform);
      setListing(data);
    } catch (err) {
      console.error('Error loading listing:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateListing = async (listingData) => {
    try {
      setError(null);
      const updated = await AppBuilderStoreService.updateListing(platform, listingData);
      setListing(updated);
      return updated;
    } catch (err) {
      console.error('Error updating listing:', err);
      setError(err.message);
      throw err;
    }
  };

  const validateListing = (listingData) => {
    try {
      return AppBuilderStoreService.validateListing(listingData, platform);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  return {
    listing,
    loading,
    error,
    updateListing,
    validateListing,
    refresh: loadListing
  };
};




