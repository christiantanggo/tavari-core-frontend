import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceKey = import.meta.env.VITE_SUPABASE_SERVICE_KEY;


if (!supabaseUrl) throw new Error('supabaseUrl is required');
if (!supabaseAnonKey) throw new Error('supabaseKey is required');

const MAIN_AUTH_STORAGE_KEY = 'sb-tavari-main-auth';

/**
 * Clear a previous-day staff JWT before GoTrue boots so we don't POST a dead
 * refresh_token (400 Invalid Refresh Token) on every morning load after 3am.
 */
function clearStaleStaffAuthBeforeClientInit() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const isMusicKiosk =
      (window.__TAVARI_ELECTRON__ === true || window.electronAPI) &&
      (window.__TAVARI_KIOSK_MODE__ === true ||
        String(window.location?.hash || '').includes('/kiosk/music'));
    if (isMusicKiosk) return;

    const now = new Date();
    const isAfter3am = now.getHours() > 3 || (now.getHours() === 3 && now.getMinutes() > 0);
    if (!isAfter3am) return;

    const today = now.toISOString().split('T')[0];
    if (localStorage.getItem('lastForcedLogout') === today) return;

    const sessionStartTime = localStorage.getItem('sessionStartTime');
    if (!sessionStartTime) return;
    const sessionStartDate = new Date(parseInt(sessionStartTime, 10)).toISOString().split('T')[0];
    if (!sessionStartDate || sessionStartDate === today) return;

    localStorage.removeItem(MAIN_AUTH_STORAGE_KEY);
    localStorage.removeItem('tavari_persistent_session');
    localStorage.setItem('lastForcedLogout', today);
    localStorage.setItem('stayLoggedIn', 'false');
  } catch {
    /* ignore storage errors during boot */
  }
}

clearStaleStaffAuthBeforeClientInit();

// ✅ Singleton pattern: Ensure only one client instance is created
// This prevents the "Multiple GoTrueClient instances" warning
// Use window global to persist across hot module reloads in development
if (!window.__supabaseClient) {
  window.__supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: window.localStorage,
      storageKey: MAIN_AUTH_STORAGE_KEY,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'pkce'
    }
  });
}

export const supabase = window.__supabaseClient;

/** In-memory auth storage so this client never reads/writes dashboard session keys in localStorage. */
function createMemoryAuthStorage() {
  const store = Object.create(null);
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    },
  };
}

/**
 * Browser punch clock only: anon session isolated from the main app's persisted JWT.
 * Lazy-init so dashboard routes don't spawn a second GoTrueClient (console warning).
 */
function getPunchClockKioskClient() {
  if (!window.__supabasePunchClockKioskClient) {
    window.__supabasePunchClockKioskClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: createMemoryAuthStorage(),
        storageKey: 'sb-tavari-punch-clock-kiosk',
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    });
  }
  return window.__supabasePunchClockKioskClient;
}

export const supabasePunchClockKiosk = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getPunchClockKioskClient();
      const value = client[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    },
  },
);

function getAdminClient() {
  if (window.__supabaseAdminClient) return window.__supabaseAdminClient;

  if (supabaseServiceKey && typeof supabaseServiceKey === 'string' && supabaseServiceKey.length > 10) {
    window.__supabaseAdminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        storageKey: 'sb-tavari-service-role-auth',
      },
    });
  } else {
    window.__supabaseAdminClient = {
      auth: {
        admin: {
          listUsers: async () => {
            console.warn('⚠️ supabaseAdmin.listUsers called without service key');
            return { data: null, error: { message: 'Service key not configured' } };
          },
          updateUserById: async () => {
            console.warn('⚠️ supabaseAdmin.updateUserById called without service key');
            return { error: { message: 'Service key not configured' } };
          },
        },
      },
    };
  }
  return window.__supabaseAdminClient;
}

export const supabaseAdmin = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getAdminClient();
      const value = client[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    },
  },
);