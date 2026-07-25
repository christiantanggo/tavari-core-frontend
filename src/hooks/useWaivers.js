// Step 57: Create useWaivers hook
// Main hook for Waivers functionality
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import WaiversService from '../services/Waivers/WaiversService';
import { useBusinessContext } from '../contexts/BusinessContext';

const REALTIME_FALLBACK_POLL_MS = 60 * 1000;
const REALTIME_FALLBACK_START_DELAY_MS = 10 * 1000;

function getStoredBusinessId() {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem('selectedBusinessId') || localStorage.getItem('currentBusinessId');
}

/**
 * Business id for `waiver_signatures` / `legacy_waivers` queries.
 *
 * `usePOSAuth` uses context before localStorage (`getCurrentBusinessId`). After org/data
 * changes, React context can still hold a stale `business_id` while `localStorage`
 * (what the user last selected) matches the DB. Prefer persisted storage first.
 *
 * Order: localStorage (selectedBusinessId | currentBusinessId) → session from parent →
 * BusinessContext
 */
function resolveWaiverBusinessId(sessionBusinessId, contextBusinessId) {
  const stored = getStoredBusinessId();
  if (stored) return stored;
  if (sessionBusinessId) return sessionBusinessId;
  return contextBusinessId || null;
}

/**
 * @param {object} filters
 * @param {{ businessId?: string | null }} [options] — `usePOSAuth().selectedBusinessId` on dashboard routes
 */
export const useWaivers = (filters = {}, options = {}) => {
  const { selectedBusinessId: contextBusinessId } = useBusinessContext();
  const sessionBusinessId = options.businessId;
  const [waivers, setWaivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const loadWaivers = useCallback(async (opts = {}) => {
    const silent = !!opts.silent;
    const showSpinner = !!opts.showSpinner;
    const sessionRetry = typeof opts.sessionRetry === 'number' ? opts.sessionRetry : 0;

    const {
      data: { session }
    } = await supabase.auth.getSession();
    if (!session?.user) {
      // App/SessionPersistence often restores the JWT a few hundred ms after first paint. Do not
      // settle to an empty list with loading=false on that first null — keep loading and retry.
      if (sessionRetry < 25) {
        if (!silent) {
          setLoading(true);
          setError(null);
        }
        setTimeout(
          () => {
            void loadWaivers({ ...opts, sessionRetry: sessionRetry + 1 });
          },
          sessionRetry < 3 ? 50 : 200
        );
        return;
      }
      setWaivers([]);
      setError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const bid = resolveWaiverBusinessId(sessionBusinessId, contextBusinessId);
    if (!bid) {
      setWaivers([]);
      setError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      if (!silent) {
        setLoading(true);
      } else if (showSpinner) {
        setRefreshing(true);
      }
      setError(null);
      WaiversService.setBusinessId(bid);
      const data = await WaiversService.getWaivers(filtersRef.current);
      setWaivers(data || []);
    } catch (err) {
      console.error('Error loading waivers:', err);
      setError(err.message || 'Failed to load waivers');
      setWaivers([]);
    } finally {
      if (!silent) {
        setLoading(false);
      }
      if (showSpinner) {
        setRefreshing(false);
      }
    }
  }, [sessionBusinessId, contextBusinessId]);

  useEffect(() => {
    loadWaivers({});
  }, [loadWaivers, JSON.stringify(filters)]);

  useEffect(() => {
    const { data: { subscription } = {} } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setWaivers([]);
        setError(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (
        event === 'INITIAL_SESSION' ||
        event === 'SIGNED_IN' ||
        event === 'TOKEN_REFRESHED' ||
        event === 'USER_UPDATED'
      ) {
        loadWaivers({});
      }
    });
    return () => {
      if (subscription) subscription.unsubscribe();
    };
  }, [loadWaivers]);

  const createWaiver = useCallback(
    async (waiverData) => {
      try {
        setError(null);
        const newWaiver = await WaiversService.createWaiver(waiverData);
        await loadWaivers({});
        return newWaiver;
      } catch (err) {
        console.error('Error creating waiver:', err);
        setError(err.message);
        throw err;
      }
    },
    [loadWaivers]
  );

  const signWaiver = useCallback(
    async (waiverId, signatureData) => {
      try {
        setError(null);
        const signedWaiver = await WaiversService.signWaiver(waiverId, signatureData);
        await loadWaivers({});
        return signedWaiver;
      } catch (err) {
        console.error('Error signing waiver:', err);
        setError(err.message);
        throw err;
      }
    },
    [loadWaivers]
  );

  const matchWaiver = useCallback(
    async (firstName, lastName, phoneNumber, email, dateOfBirth) => {
      try {
        setError(null);
        return await WaiversService.matchWaiver(
          firstName,
          lastName,
          phoneNumber,
          email,
          dateOfBirth
        );
      } catch (err) {
        console.error('Error matching waiver:', err);
        setError(err.message);
        throw err;
      }
    },
    []
  );

  const refresh = useCallback(() => loadWaivers({ silent: true, showSpinner: true }), [loadWaivers]);

  useEffect(() => {
    let channel;
    let pollTimer;
    let pollFallbackStarter;
    let realtimeSubscribed = false;
    let cancelled = false;

    const onVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
      if (!cancelled) void loadWaivers({ silent: true });
    };

    const startSideChannels = async () => {
      const {
        data: { session }
      } = await supabase.auth.getSession();
      if (!session?.user || cancelled) return;
      const bid = resolveWaiverBusinessId(sessionBusinessId, contextBusinessId);
      if (!bid) return;

      const reloadSilent = () => {
        if (!cancelled) void loadWaivers({ silent: true });
      };
      const startFallbackPolling = () => {
        if (cancelled || pollTimer) return;
        pollTimer = window.setInterval(reloadSilent, REALTIME_FALLBACK_POLL_MS);
      };
      const stopFallbackPolling = () => {
        if (!pollTimer) return;
        window.clearInterval(pollTimer);
        pollTimer = null;
      };

      channel = supabase
        .channel(`waiver_signatures_list_${bid}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'waiver_signatures',
            filter: `business_id=eq.${bid}`
          },
          () => reloadSilent()
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            realtimeSubscribed = true;
            stopFallbackPolling();
            return;
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[useWaivers] Realtime channel status:', status);
            reloadSilent();
            startFallbackPolling();
          }
        });

      pollFallbackStarter = window.setTimeout(() => {
        if (!realtimeSubscribed) startFallbackPolling();
      }, REALTIME_FALLBACK_START_DELAY_MS);

      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisible);
      }
    };

    void startSideChannels();

    return () => {
      cancelled = true;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
      if (pollFallbackStarter) window.clearTimeout(pollFallbackStarter);
      if (pollTimer) window.clearInterval(pollTimer);
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [loadWaivers, sessionBusinessId, contextBusinessId]);

  return {
    waivers,
    loading,
    refreshing,
    error,
    createWaiver,
    signWaiver,
    matchWaiver,
    refresh
  };
};




