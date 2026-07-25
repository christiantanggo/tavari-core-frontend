// Step 67: Create useAppBuilderAnalytics hook
// Hook for analytics operations
import { useState, useEffect } from 'react';
import AppBuilderAnalyticsService from '../services/AppBuilder/AppBuilderAnalyticsService';
import { useBusinessContext } from '../contexts/BusinessContext';

export const useAppBuilderAnalytics = (dateRange = '30d') => {
  const { selectedBusinessId } = useBusinessContext();
  const [analytics, setAnalytics] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!selectedBusinessId) {
      setLoading(false);
      return;
    }

    AppBuilderAnalyticsService.setBusinessId(selectedBusinessId);
    loadAnalytics();
  }, [selectedBusinessId, dateRange]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);

      const [analyticsData, statsData] = await Promise.all([
        AppBuilderAnalyticsService.getAnalytics({
          limit: 100
        }),
        AppBuilderAnalyticsService.getAppStats(dateRange)
      ]);

      setAnalytics(analyticsData || []);
      setStats(statsData);
    } catch (err) {
      console.error('Error loading analytics:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const trackEvent = async (eventType, eventData = {}) => {
    try {
      await AppBuilderAnalyticsService.trackEvent(eventType, eventData);
      // Optionally reload analytics after tracking
    } catch (err) {
      console.error('Error tracking event:', err);
      // Don't throw - tracking failures shouldn't break the app
    }
  };

  const refresh = async () => {
    await loadAnalytics();
  };

  return {
    analytics,
    stats,
    loading,
    error,
    refresh,
    trackEvent
  };
};




