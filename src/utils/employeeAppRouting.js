export const EMPLOYEE_APP_HOST = 'employee.tavarios.ca';
export const PUNCH_CLOCK_APP_HOST = 'punch-clock.tavarios.ca';
/** Same modern React punch clock; kept as the tablet bookmark host after retiring the ES5 kiosk. */
export const LEGACY_PUNCH_CLOCK_APP_HOST = 'legacy-punchclock.tavarios.ca';
/** Default business for punch-clock subdomains when the URL has no business id. */
export const DEFAULT_PUNCH_CLOCK_BUSINESS_ID = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';

const EMPLOYEE_APP_PATHS = {
  '/portal': '/',
  '/portal/login': '/login',
  '/portal/setup': '/setup',
  '/portal/profile-setup': '/profile-setup',
  '/portal/reset-password': '/reset-password',
  '/portal/pay-statements': '/pay-statements',
  '/portal/account': '/account',
  '/portal/expense-receipts': '/expense-receipts',
  '/portal/contract': '/contract',
  '/portal/certificates': '/certificates',
  '/portal/training': '/training',
  '/portal/policies': '/policies',
  '/portal/acknowledgements': '/acknowledgements',
  '/portal/incidents': '/incidents',
  '/portal/staff-updates': '/staff-updates',
  '/portal/profile': '/profile',
  '/portal/password-pin': '/password-pin',
  '/portal/schedule': '/schedule',
  '/portal/clock': '/clock',
  '/portal/availability': '/availability',
  '/portal/time-off': '/time-off',
  '/portal/shift-coverage': '/shift-coverage',
  '/portal/notifications': '/notifications',
};

export const isEmployeeAppHost = () => {
  if (typeof window === 'undefined') return false;
  return window.location.hostname.toLowerCase() === EMPLOYEE_APP_HOST;
};

export const isPunchClockAppHost = () => {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return host === PUNCH_CLOCK_APP_HOST || host === LEGACY_PUNCH_CLOCK_APP_HOST;
};

export const employeeAppPath = (portalPath) => {
  if (!isEmployeeAppHost()) return portalPath;
  return EMPLOYEE_APP_PATHS[portalPath] || portalPath.replace(/^\/portal/, '') || '/';
};

export const isEmployeePortalPath = (pathname = '') => {
  if (isEmployeeAppHost()) return true;
  return pathname === '/portal' || pathname.startsWith('/portal/');
};

