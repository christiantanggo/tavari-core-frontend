import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import RecentWaiversService from '../services/Waivers/RecentWaiversService';

const REALTIME_DEBOUNCE_MS = 400;

/**
 * Recent waivers for admission counter — fast query + Supabase Realtime on waiver_signatures.
 */
export function useRecentWaivers(businessId, { hours = 8, limit = 100 } = {}) {
  const [recentWaivers, setRecentWaivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [liveConnected, setLiveConnected] = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  const loadRecent = useCallback(
    async (opts = {}) => {
      const silent = !!opts.silent;
      if (!businessId) {
        setRecentWaivers([]);
        setError(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      try {
        if (!silent) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }
        setError(null);
        RecentWaiversService.setBusinessId(businessId);
        const data = await RecentWaiversService.fetchRecentWaivers({ hours, limit });
        setRecentWaivers(data || []);
      } catch (err) {
        console.error('[useRecentWaivers] load failed:', err);
        setError(err?.message || 'Failed to load recent waivers');
        if (!silent) {
          setRecentWaivers([]);
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
        setRefreshing(false);
      }
    },
    [businessId, hours, limit]
  );

  const scheduleSilentReload = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void loadRecent({ silent: true });
    }, REALTIME_DEBOUNCE_MS);
  }, [loadRecent]);

  useEffect(() => {
    void loadRecent({});
  }, [loadRecent]);

  useEffect(() => {
    if (!businessId) {
      setLiveConnected(false);
      return undefined;
    }

    const channel = supabase
      .channel(`recent-waivers-${businessId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'waiver_signatures',
          filter: `business_id=eq.${businessId}`
        },
        () => scheduleSilentReload()
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'waiver_signatures',
          filter: `business_id=eq.${businessId}`
        },
        () => scheduleSilentReload()
      )
      .subscribe((status) => {
        setLiveConnected(status === 'SUBSCRIBED');
      });

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      void supabase.removeChannel(channel);
      setLiveConnected(false);
    };
  }, [businessId, scheduleSilentReload]);

  const refresh = useCallback(() => loadRecent({ silent: false }), [loadRecent]);

  return {
    recentWaivers,
    loading,
    refreshing,
    liveConnected,
    error,
    refresh
  };
}
