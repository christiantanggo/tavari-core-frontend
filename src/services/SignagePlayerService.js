import { supabase } from '../supabaseClient';
import { normalizeScreenKeyInput } from '../utils/signageScreenKey';

const STORAGE_KEY = 'tavari_signage_screen_key';
/** Last successful playlist/manifest — survives reload, reboot, and nightly kiosk restarts. */
const MANIFEST_CACHE_KEY = 'tavari_signage_player_manifest';

export function getStoredScreenKey() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function storeScreenKey(screenKey) {
  try {
    const key = normalizeScreenKeyInput(screenKey);
    if (!key) return;
    localStorage.setItem(STORAGE_KEY, key);
    syncScreenKeyToUrl(key);
  } catch {
    /* ignore */
  }
}

export function clearStoredScreenKey() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(MANIFEST_CACHE_KEY);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('screen_key');
      url.searchParams.delete('screenKey');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    /* ignore */
  }
}

/** Keep screen_key in the URL so pairing survives storage quirks (same idea as waiver ?business=). */
export function syncScreenKeyToUrl(screenKey) {
  if (typeof window === 'undefined') return;
  try {
    const key = normalizeScreenKeyInput(screenKey);
    if (!key) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('screen_key') === key) return;
    url.searchParams.set('screen_key', key);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* ignore */
  }
}

export function getCachedPlayerManifest(screenKey) {
  try {
    const key = normalizeScreenKeyInput(screenKey);
    if (!key) return null;
    const raw = localStorage.getItem(MANIFEST_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (normalizeScreenKeyInput(parsed?.screenKey) !== key) return null;
    if (!parsed?.playerState) return null;
    return parsed.playerState;
  } catch {
    return null;
  }
}

export function storePlayerManifest(screenKey, playerState) {
  try {
    const key = normalizeScreenKeyInput(screenKey);
    if (!key || !playerState) return;
    localStorage.setItem(
      MANIFEST_CACHE_KEY,
      JSON.stringify({
        screenKey: key,
        savedAt: Date.now(),
        playerState
      })
    );
  } catch (e) {
    console.warn('[SignagePlayerService] manifest cache write failed', e);
  }
}

export function clearPlayerManifest() {
  try {
    localStorage.removeItem(MANIFEST_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export function buildPlayerUrl(screenKey) {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  const key = encodeURIComponent(normalizeScreenKeyInput(screenKey));
  return `${base}/signage/player?screen_key=${key}`;
}

/**
 * Fetch player state from edge function (schedule, signed URLs, heartbeat).
 * @param {string} screenKey
 */
export async function fetchPlayerState(screenKey) {
  const key = normalizeScreenKeyInput(screenKey);
  if (!key) {
    throw new Error('Screen key is required');
  }

  const { data, error } = await supabase.functions.invoke('signage-player-state', {
    body: { screen_key: key }
  });

  if (error) {
    throw new Error(error.message || 'Failed to load player state');
  }
  if (!data?.ok) {
    throw new Error(data?.error || 'Player state unavailable');
  }
  return data;
}

/** Collect all playlist items from a player state payload (flat list for prefetch). */
export function flattenManifestItems(state) {
  if (!state) return [];
  const out = [...(state.playlist || [])];
  for (const zone of state.zones || []) {
    out.push(...(zone.items || []));
  }
  return out;
}
