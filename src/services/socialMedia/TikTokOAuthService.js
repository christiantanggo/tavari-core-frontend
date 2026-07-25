// services/socialMedia/TikTokOAuthService.js
// TikTok OAuth service for production OAuth flow
import { supabase } from '../../supabaseClient';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export class TikTokOAuthService {
  /**
   * Generate TikTok OAuth authorization URL
   * @param {string} businessId - Business ID
   * @param {string} redirectUri - Callback redirect URI
   * @param {string} state - CSRF state token
   * @returns {string} OAuth authorization URL
   */
  static generateAuthUrl(businessId, redirectUri, state) {
    // Get TikTok client key from environment (public, safe to expose)
    const clientKey = import.meta.env.VITE_TIKTOK_CLIENT_KEY;
    
    if (!clientKey) {
      throw new Error('TikTok Client Key not configured. Please set VITE_TIKTOK_CLIENT_KEY in environment variables.');
    }

    // TikTok OAuth 2.0 authorization endpoint
    const authUrl = new URL('https://www.tiktok.com/v2/auth/authorize/');
    
    // Required scopes for TikTok API
    const scopes = [
      'user.info.basic',           // Basic user info
      'video.upload',              // Upload videos
      'video.publish',             // Publish videos
      'video.list',                // List videos
    ].join(',');

    const params = new URLSearchParams({
      client_key: clientKey,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      state: state,
    });

    return `${authUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code from callback
   * @param {string} redirectUri - Original redirect URI
   * @param {string} businessId - Business ID
   * @returns {Promise<Object>} Token data and account info
   */
  static async exchangeCodeForToken(code, redirectUri, businessId) {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !session || !session.access_token) {
        throw new Error('Not authenticated - please log in again');
      }

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/tiktok-oauth`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            code,
            redirectUri,
            businessId,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Token exchange failed: ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error('TikTok token exchange error:', error);
      throw error;
    }
  }

  /**
   * Generate a secure state token for CSRF protection
   * @returns {string} State token
   */
  static generateStateToken() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Store state token in session storage
   * @param {string} state - State token
   */
  static storeStateToken(state) {
    sessionStorage.setItem('tiktok_oauth_state', state);
  }

  /**
   * Verify state token from callback
   * @param {string} receivedState - State from callback
   * @returns {boolean} True if valid
   */
  static verifyStateToken(receivedState) {
    const storedState = sessionStorage.getItem('tiktok_oauth_state');
    if (!storedState || storedState !== receivedState) {
      return false;
    }
    // Clear state after verification
    sessionStorage.removeItem('tiktok_oauth_state');
    return true;
  }
}


