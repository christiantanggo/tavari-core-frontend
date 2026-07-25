// Step 64: Create useAppBuilderBuilds hook
// Hook for build management operations
import { useState, useEffect, useCallback } from 'react';
import AppBuilderBuildService from '../services/AppBuilder/AppBuilderBuildService';
import { useBusinessContext } from '../contexts/BusinessContext';

export const useAppBuilderBuilds = () => {
  const { selectedBusinessId } = useBusinessContext();
  const [builds, setBuilds] = useState([]);
  const [currentBuild, setCurrentBuild] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!selectedBusinessId) {
      setLoading(false);
      return;
    }

    AppBuilderBuildService.setBusinessId(selectedBusinessId);
    loadBuilds();
  }, [selectedBusinessId]);

  const loadBuilds = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await AppBuilderBuildService.getBuildHistory();
      setBuilds(data || []);
      
      // Set current build (most recent queued or building)
      const activeBuild = data?.find(b => 
        b.build_status === 'queued' || b.build_status === 'building'
      );
      setCurrentBuild(activeBuild || null);
    } catch (err) {
      console.error('Error loading builds:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const createBuild = async (buildData) => {
    try {
      setError(null);
      const newBuild = await AppBuilderBuildService.createBuild(buildData);
      await loadBuilds(); // Reload to get updated list
      return newBuild;
    } catch (err) {
      console.error('Error creating build:', err);
      setError(err.message);
      throw err;
    }
  };

  const cancelBuild = async (buildId) => {
    try {
      setError(null);
      await AppBuilderBuildService.cancelBuild(buildId);
      await loadBuilds(); // Reload to get updated list
    } catch (err) {
      console.error('Error cancelling build:', err);
      setError(err.message);
      throw err;
    }
  };

  const subscribeToBuild = useCallback((buildId, callback) => {
    if (!buildId) return null;

    const unsubscribe = AppBuilderBuildService.subscribeToBuildStatus(
      buildId,
      (updatedBuild) => {
        setCurrentBuild(updatedBuild);
        setBuilds(prev => prev.map(b => 
          b.id === buildId ? updatedBuild : b
        ));
        if (callback) callback(updatedBuild);
      }
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    // Cleanup subscriptions on unmount
    return () => {
      AppBuilderBuildService.cleanup();
    };
  }, []);

  return {
    builds,
    currentBuild,
    loading,
    error,
    createBuild,
    cancelBuild,
    subscribeToBuild,
    refresh: loadBuilds
  };
};




