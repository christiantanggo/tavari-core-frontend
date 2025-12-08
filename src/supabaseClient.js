import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceKey = import.meta.env.VITE_SUPABASE_SERVICE_KEY;


if (!supabaseUrl) throw new Error('supabaseUrl is required');
if (!supabaseAnonKey) throw new Error('supabaseKey is required');

// ✅ Singleton pattern: Ensure only one client instance is created
// This prevents the "Multiple GoTrueClient instances" warning
// Use window global to persist across hot module reloads in development
if (!window.__supabaseClient) {
  // ✅ CRITICAL: Configure session persistence for indefinite login
  window.__supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      // Use localStorage for persistent sessions across browser restarts
      storage: window.localStorage,
      
      // Disable built-in auto refresh; SessionPersistence manages refresh cadence
      autoRefreshToken: false,
      
      // Persist sessions across browser restarts
      persistSession: true,
      
      // Detect session from URL for OAuth flows
      detectSessionInUrl: true,
      
      // CRITICAL: Prevent automatic logout - sessions persist indefinitely
      // Only the inactivity timer (5 min) will trigger PIN lock, not session expiry
      flowType: 'pkce'
    }
  });
}

export const supabase = window.__supabaseClient;

// Admin client setup - also singleton pattern using window global
if (!window.__supabaseAdminClient) {
  if (supabaseServiceKey && typeof supabaseServiceKey === 'string' && supabaseServiceKey.length > 10) {
    window.__supabaseAdminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  } else {
    // Safe fallback that won't crash if called accidentally
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
}

export const supabaseAdmin = window.__supabaseAdminClient;