// utils/authCleanup.js
import { clearShiftBusinessId, persistShiftBusinessId, resolveShiftBusinessId } from './shiftBusinessId';

/**
 * Centralized authentication data cleanup utility
 */

/**
 * Keys intentionally NOT cleared here — unattended kiosks must survive daily restarts:
 * - tavari_signage_screen_key, tavari_signage_player_manifest (digital signage player)
 * - tavariPinnedBusinessId may remain for Electron kiosk restore paths
 * - IndexedDB tavari-signage-cache (media blobs)
 */
export const KIOSK_PERSISTENT_STORAGE_KEYS = [
  'tavari_signage_screen_key',
  'tavari_signage_player_manifest'
];

/** Session keys to keep during PIN lock / transient auth blips (not a real logout). */
const PIN_LOCK_SESSION_STORAGE_KEYS = ['unlockReturnPath'];

/**
 * Clear authentication data from storage.
 * @param {string} reason - The reason for clearing (for logging purposes)
 * @param {{ preserveDaySession?: boolean }} [options]
 *   preserveDaySession: keep stayLoggedIn, refresh tokens, business IDs (PIN lock / transient sign-out)
 */
export const clearAllAuthData = (reason = 'logout', options = {}) => {
  const preserveDaySession = options.preserveDaySession === true;

  try {
    if (!preserveDaySession) {
      localStorage.removeItem('currentBusinessId');
      localStorage.removeItem('selectedBusinessId');
      localStorage.removeItem('businessList');
      clearShiftBusinessId();
      localStorage.removeItem('stayLoggedIn');
      localStorage.removeItem('expiresAt');
      localStorage.removeItem('lastForcedLogout');
      localStorage.removeItem('sessionStartTime');
      localStorage.removeItem('lastAuthUserId');
      localStorage.removeItem('tavari_session');
      localStorage.removeItem('tavari_persistent_session');
      localStorage.removeItem('posLoginUser');
    }

    localStorage.removeItem('pinFailedAttempts');
    localStorage.removeItem('posActiveUser');
    localStorage.removeItem('posLastUnlockedBy');

    if (preserveDaySession) {
      const kept = {};
      PIN_LOCK_SESSION_STORAGE_KEYS.forEach((key) => {
        const value = sessionStorage.getItem(key);
        if (value != null) kept[key] = value;
      });
      sessionStorage.clear();
      Object.entries(kept).forEach(([key, value]) => sessionStorage.setItem(key, value));
    } else {
      sessionStorage.clear();
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('pos-active-user-changed'));
    }

    return true;
  } catch (error) {
    console.error('❌ Error clearing auth data:', error);
    return false;
  }
};

/** Full logout — ends the day session (email/password required next time). */
export const clearAuthDataForExplicitLogout = (reason = 'logout') =>
  clearAllAuthData(reason, { preserveDaySession: false });

/**
 * Clear only business context data (used when switching businesses)
 */
export const clearBusinessData = () => {
  console.log('🧹 Clearing business context data');
  
  try {
    localStorage.removeItem('currentBusinessId');
    localStorage.removeItem('selectedBusinessId');
    localStorage.removeItem('businessList');
    
    console.log('✅ Business data cleared');
    return true;
  } catch (error) {
    console.error('❌ Error clearing business data:', error);
    return false;
  }
};

/**
 * Check if current cached business ID is valid for the user
 * @param {Array<string>} validBusinessIds - Array of valid business IDs for the user
 * @returns {boolean} - Whether the cached business ID is valid
 */
export const validateCachedBusinessId = (validBusinessIds) => {
  const cachedId = localStorage.getItem('currentBusinessId');
  
  if (!cachedId) {
    return false;
  }
  
  return validBusinessIds.includes(cachedId);
};

/**
 * Safe business ID setter - ensures both storage keys are in sync
 * @param {string} businessId - The business ID to set
 */
export const setBusinessId = (businessId) => persistShiftBusinessId(businessId);

export const resolveStoredBusinessId = () => resolveShiftBusinessId();

export default {
  clearAllAuthData,
  clearAuthDataForExplicitLogout,
  clearBusinessData,
  validateCachedBusinessId,
  setBusinessId,
  resolveStoredBusinessId,
};