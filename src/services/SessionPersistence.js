// services/SessionPersistence.js - FIXED: Prevents infinite refresh loop
import { supabase } from '../supabaseClient';
import { clearAuthDataForExplicitLogout } from '../utils/authCleanup';
import { isBrowserStaffSession, isUnattendedMusicKiosk } from '../utils/staffSessionContext';

/** Avoid duplicate console lines when refreshToken runs concurrently (e.g. SessionManager + timers). */
let staleSessionDailyLogoutLogPrinted = false;

class SessionPersistence {
  constructor() {
    this.refreshTimeout = null;
    // Supabase access tokens last about an hour; refresh once near the end instead of every few minutes.
    this.REFRESH_INTERVAL = 45 * 60 * 1000; // 45 minutes
    this.ERROR_RETRY_INTERVAL = 2 * 60 * 1000; // retry after 2 minutes on failure
    this.REFRESH_MIN_GAP = 5 * 60 * 1000; // Don't request a new refresh within 5 minutes
    this.EXPIRY_BUFFER = 15 * 60 * 1000; // Refresh when access token expires within 15 minutes
    this.SESSION_KEY = 'tavari_persistent_session';
    this.STAY_LOGGED_IN_KEY = 'stayLoggedIn';
    this.isRestoring = false; // Prevent multiple simultaneous restores
    this.refreshPromise = null;
    this.lastRefreshTime = 0;
  }

  async enablePersistence() {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error || !session) {
        return false;
      }

      const sessionData = {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        user: session.user,
        expires_at: session.expires_at,
        persisted_at: Date.now()
      };

      localStorage.setItem(this.SESSION_KEY, JSON.stringify(sessionData));
      localStorage.setItem(this.STAY_LOGGED_IN_KEY, 'true');
      
      // Set session start time if not already set (for 24-hour tracking)
      if (!localStorage.getItem('sessionStartTime')) {
        localStorage.setItem('sessionStartTime', Date.now().toString());
      }

      staleSessionDailyLogoutLogPrinted = false;

      this.startAutoRefresh();
      return true;
    } catch (error) {
      console.error('❌ Error enabling persistence:', error);
      return false;
    }
  }

  disablePersistence() {
    localStorage.removeItem(this.SESSION_KEY);
    localStorage.removeItem(this.STAY_LOGGED_IN_KEY);
    this.stopAutoRefresh();
  }

  isPersistenceEnabled() {
    return localStorage.getItem(this.STAY_LOGGED_IN_KEY) === 'true';
  }

  async restoreSession() {
    // Prevent multiple simultaneous restore attempts
    if (this.isRestoring) {
      return { restored: false, reason: 'already_restoring' };
    }

    const isMusicKiosk =
      (window.__TAVARI_ELECTRON__ === true || window.electronAPI) &&
      (window.__TAVARI_KIOSK_MODE__ === true ||
        window.location.hash.includes('/kiosk/music'));
    if (isMusicKiosk) {
      return { restored: false, reason: 'music_kiosk_no_auth_restore' };
    }

    try {
      this.isRestoring = true;

      const stayLoggedIn = localStorage.getItem(this.STAY_LOGGED_IN_KEY);
      
      if (stayLoggedIn !== 'true') {
        return { restored: false, reason: 'not_enabled' };
      }

      // Check if Supabase already has a valid session
      const { data: { session: existingSession } } = await supabase.auth.getSession();
      
      if (existingSession && existingSession.user) {
        this.startAutoRefresh();
        return { restored: true, reason: 'already_active', session: existingSession };
      }

      const storedData = localStorage.getItem(this.SESSION_KEY);
      
      if (!storedData) {
        return { restored: false, reason: 'no_data' };
      }

      const sessionData = JSON.parse(storedData);

      // Check if session is too old (older than 60 days)
      const ageInDays = (Date.now() - sessionData.persisted_at) / (1000 * 60 * 60 * 24);
      
      if (ageInDays > 60) {
        console.warn('⚠️ Stored session too old, clearing');
        this.disablePersistence();
        return { restored: false, reason: 'expired' };
      }


      // Only try refresh, don't try setSession first
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession({
        refresh_token: sessionData.refresh_token
      });

      if (refreshError || !refreshData.session) {
        if (this.isRefreshTokenPermanentlyInvalid(refreshError)) {
          this.disablePersistence();
        }
        return { restored: false, reason: 'refresh_failed', error: refreshError };
      }

      // Update stored session data with new tokens
      await this.enablePersistence();
      this.startAutoRefresh();

      return { restored: true, reason: 'refreshed', session: refreshData.session };

    } catch (error) {
      if (this.isRefreshTokenPermanentlyInvalid(error)) {
        this.disablePersistence();
      }
      return { restored: false, reason: 'exception', error };
    } finally {
      this.isRestoring = false;
    }
  }

  isRefreshTokenPermanentlyInvalid(error) {
    const message = (error?.message || '').toLowerCase();
    return (
      message.includes('invalid refresh token') ||
      message.includes('refresh token not found') ||
      message.includes('invalid_grant') ||
      message.includes('session_not_found')
    );
  }

  isAccessTokenExpiringSoon(session) {
    if (!session?.expires_at) return true;
    return Date.now() >= session.expires_at * 1000 - this.EXPIRY_BUFFER;
  }

  async ensureFreshToken() {
    if (!this.isPersistenceEnabled()) {
      return false;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      const restoreResult = await this.restoreSession();
      return restoreResult.restored;
    }

    if (!this.isAccessTokenExpiringSoon(session)) {
      return true;
    }

    // Always refresh when the access token is near expiry (ignore min-gap throttle).
    return this.refreshToken({ force: true });
  }

  startAutoRefresh() {
    this.stopAutoRefresh();

    const scheduleNext = (delay) => {
      this.refreshTimeout = setTimeout(async () => {
        const success = await this.ensureFreshToken();
        scheduleNext(success ? this.REFRESH_INTERVAL : this.ERROR_RETRY_INTERVAL);
      }, delay);
    };

    // Refresh immediately if the token is near expiry; otherwise keep the normal cadence.
    void this.ensureFreshToken().then((success) => {
      scheduleNext(success ? this.REFRESH_INTERVAL : this.ERROR_RETRY_INTERVAL);
    });
  }

  stopAutoRefresh() {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
  }

  async refreshToken(options = {}) {
    const force = options.force === true;
    if (!this.isPersistenceEnabled()) {
      return false;
    }

    const isAfter3am = (() => {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      return currentHour > 3 || (currentHour === 3 && currentMinute > 0);
    })();
    const today = new Date().toISOString().split('T')[0];
    const lastForcedLogout = localStorage.getItem('lastForcedLogout');
    const sessionStartTime = localStorage.getItem('sessionStartTime');
    const sessionStartDate = sessionStartTime
      ? new Date(parseInt(sessionStartTime, 10)).toISOString().split('T')[0]
      : null;
    const nowTimestamp = Date.now();

    // Daily 3am reset: browser staff sessions sign out; unattended kiosks are untouched.
    if (isAfter3am && lastForcedLogout !== today && sessionStartDate && sessionStartDate !== today) {
      if (isUnattendedMusicKiosk()) {
        return false;
      }

      if (!staleSessionDailyLogoutLogPrinted) {
        staleSessionDailyLogoutLogPrinted = true;
        console.log('🔒 After 3am — ending previous-day staff session');
      }

      localStorage.setItem('lastForcedLogout', today);
      this.stopAutoRefresh();
      clearAuthDataForExplicitLogout('daily_3am_logout');

      if (isBrowserStaffSession()) {
        try {
          await supabase.auth.signOut();
        } catch (signOutError) {
          console.warn('3am sign-out failed:', signOutError?.message || signOutError);
        }
      } else {
        this.disablePersistence();
      }
      return false;
    }
    if (
      !force &&
      this.lastRefreshTime &&
      nowTimestamp - this.lastRefreshTime < this.REFRESH_MIN_GAP
    ) {
      return true;
    }

    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        // No live session (e.g. after 3am logout / explicit sign-out) — skip quietly.
        const { data: existing } = await supabase.auth.getSession();
        if (!existing?.session?.refresh_token) {
          return false;
        }

        // Check if 24 hours have passed since session start
        const sessionStartTime = localStorage.getItem('sessionStartTime');
        if (sessionStartTime) {
          const sessionAge = Date.now() - parseInt(sessionStartTime, 10);
          const hoursSinceStart = sessionAge / (1000 * 60 * 60);

          if (hoursSinceStart >= 24) {
            console.log('🔄 24-hour period reached, extending session for another 24 hours');
            localStorage.setItem('sessionStartTime', Date.now().toString());
          }
        }

        const { data, error } = await supabase.auth.refreshSession();

        if (error || !data.session) {
          if (this.isRefreshTokenPermanentlyInvalid(error) || this.isMissingSessionError(error)) {
            this.disablePersistence();
            return false;
          }
          console.error('❌ Token refresh failed:', error?.message);
          // Network hiccups shouldn't clear session; allow quick retry
          return false;
        }

        // Update stored session data
        const sessionData = {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          user: data.session.user,
          expires_at: data.session.expires_at,
          persisted_at: Date.now()
        };

        localStorage.setItem(this.SESSION_KEY, JSON.stringify(sessionData));
        this.lastRefreshTime = Date.now();
        return true;

      } catch (error) {
        if (this.isRefreshTokenPermanentlyInvalid(error) || this.isMissingSessionError(error)) {
          this.disablePersistence();
          return false;
        }
        console.error('❌ Error during token refresh:', error);
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  isMissingSessionError(error) {
    const message = (error?.message || '').toLowerCase();
    return (
      message.includes('auth session missing') ||
      message.includes('session missing')
    );
  }

  forceCleanup() {
    this.disablePersistence();
    this.stopAutoRefresh();
    this.isRestoring = false;
  }
}

export const sessionPersistence = new SessionPersistence();

if (typeof window !== 'undefined') {
  window.sessionPersistence = sessionPersistence;
}

export default sessionPersistence;