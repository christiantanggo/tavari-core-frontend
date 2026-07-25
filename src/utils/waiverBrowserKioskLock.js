/**
 * On-site iPad/browser kiosks use /waiver/...?signingStation=browser_kiosk.
 * Persist a lock so customers cannot navigate to /, /login, /dashboard, etc. in the same tab.
 * Cleared when staff opens /kiosk/waiver (or in-dashboard signing kiosk entry).
 */
export const WAIVER_BROWSER_KIOSK_LOCK_KEY = 'tavari_waiver_browser_kiosk_lock';

export function waiverLockPathPrefix(lockedPathWithQuery) {
  const pathOnly = (lockedPathWithQuery || '').split('?')[0];
  const parts = pathOnly.split('/').filter(Boolean);
  if (parts[0] !== 'waiver' || !parts[1]) return null;
  return `/waiver/${parts[1]}`;
}

export function clearWaiverBrowserKioskLock() {
  try {
    sessionStorage.removeItem(WAIVER_BROWSER_KIOSK_LOCK_KEY);
  } catch (_) {
    /* ignore */
  }
}

const NATIVE_WAIVER_KIOSK_KEY = 'tavari_native_waiver_kiosk';

export function refreshWaiverBrowserKioskLock(pathname, search) {
  const sp = new URLSearchParams(search || '');
  let native = false;
  try {
    native = sessionStorage.getItem(NATIVE_WAIVER_KIOSK_KEY) === '1';
  } catch (_) {
    /* ignore */
  }
  const browserKioskQuery = sp.get('signingStation') === 'browser_kiosk';
  if (!pathname.startsWith('/waiver/') || (!browserKioskQuery && !native)) return;
  try {
    sessionStorage.setItem(WAIVER_BROWSER_KIOSK_LOCK_KEY, `${pathname}${search || ''}`);
  } catch (_) {
    /* ignore */
  }
}

/** @returns {string|null} full path+search to redirect to, or null */
export function getWaiverBrowserKioskRedirectPath(pathname) {
  let locked;
  try {
    locked = sessionStorage.getItem(WAIVER_BROWSER_KIOSK_LOCK_KEY);
  } catch (_) {
    return null;
  }
  if (!locked) return null;
  const prefix = waiverLockPathPrefix(locked);
  if (!prefix) {
    clearWaiverBrowserKioskLock();
    return null;
  }
  if (pathname.startsWith(prefix)) return null;
  return locked;
}
