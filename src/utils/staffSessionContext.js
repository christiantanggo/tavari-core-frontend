/** Business id pinned for the current shift — survives PIN lock; cleared only on explicit logout. */
export const SHIFT_BUSINESS_ID_KEY = 'tavari_shift_business_id';

const EMPLOYEE_PORTAL_HOST = 'employee.tavarios.ca';

const KIOSK_PATH_PREFIXES = [
  '/kiosk/',
  '/customer-display',
  '/customer-portal/',
  '/time-clock-kiosk',
  '/signage/player',
  '/waiver-browser-kiosk',
];

/** Employee self-service portal (employee.tavarios.ca or /portal/*) — not staff dashboard/POS. */
export function isEmployeePortalSession() {
  if (typeof window === 'undefined') return false;
  if (window.location.hostname.toLowerCase() === EMPLOYEE_PORTAL_HOST) {
    return true;
  }
  const path = String(window.location?.pathname || '');
  return path === '/portal' || path.startsWith('/portal/');
}

/**
 * Staff browser tab (admission counter, dashboard) — not unattended kiosk surfaces or employee portal.
 */
export function isBrowserStaffSession() {
  if (typeof window === 'undefined') return true;
  if (isEmployeePortalSession()) return false;
  if (window.__TAVARI_KIOSK_MODE__ === true) return false;

  const path = String(window.location?.pathname || '');
  if (KIOSK_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return false;
  }

  // Electron music kiosk uses hash routes
  const hash = String(window.location?.hash || '');
  if (hash.includes('/kiosk/music') || hash.includes('/kiosk/vending') || hash.includes('/v/')) {
    return false;
  }

  return true;
}

export function isUnattendedMusicKiosk() {
  if (typeof window === 'undefined') return false;
  return (
    (window.__TAVARI_ELECTRON__ === true || window.electronAPI) &&
    window.__TAVARI_KIOSK_MODE__ === true &&
    (window.location.hash.includes('/kiosk/music') ||
      window.location.pathname.includes('/kiosk/music'))
  );
}
