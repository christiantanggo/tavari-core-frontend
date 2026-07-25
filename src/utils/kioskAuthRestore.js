import { supabase } from '../supabaseClient';

let restorePromise = null;

/**
 * Music kiosk needs a Supabase session to read music_tracks (RLS).
 * Use refresh_token only (never stale access_token) and run once per page load.
 */
export async function ensureKioskSupabaseSession() {
  if (restorePromise) {
    return restorePromise;
  }

  restorePromise = (async () => {
    try {
      const {
        data: { session: existing },
      } = await supabase.auth.getSession();
      if (existing?.user) {
        return { ok: true, session: existing, reason: 'already_active' };
      }

      const refreshFromStorage = () => {
        try {
          const raw =
            localStorage.getItem('tavari_persistent_session') ||
            localStorage.getItem('tavari_session');
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          return parsed?.refresh_token || null;
        } catch {
          return null;
        }
      };

      let refreshToken = refreshFromStorage();

      if (!refreshToken && window.electronAPI?.loadSession) {
        const saved = await window.electronAPI.loadSession();
        refreshToken = saved?.refresh_token || null;
      }

      if (!refreshToken) {
        return { ok: false, reason: 'no_refresh_token' };
      }

      const { data, error } = await supabase.auth.refreshSession({
        refresh_token: refreshToken,
      });

      if (error || !data?.session) {
        return { ok: false, reason: 'refresh_failed', error };
      }

      const businessId =
        localStorage.getItem('tavariPinnedBusinessId') ||
        localStorage.getItem('selectedBusinessId') ||
        localStorage.getItem('currentBusinessId');

      if (window.electronAPI?.saveSession) {
        await window.electronAPI.saveSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
          user: data.session.user,
          business_id: businessId,
          pinned_business_id: businessId,
        });
      }

      return { ok: true, session: data.session, reason: 'refreshed' };
    } catch (error) {
      return { ok: false, reason: 'exception', error };
    }
  })();

  return restorePromise;
}
