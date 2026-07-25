import { primePosActiveUserFromTaskKiosk } from './taskManagerModuleLinks';

/** Session key shared with public/task-manager-kiosk/app.es5.js */
export const TASK_MANAGER_KIOSK_SESSION_KEY = 'tmk_session';

/** localStorage fallback when sessionStorage does not survive SPA ↔ kiosk navigation */
export const TASK_MANAGER_KIOSK_SESSION_BACKUP_KEY = 'tmk_session_backup';

/** Query param kiosk reads to skip PIN after module-link return */
export const TASK_KIOSK_RETURN_PARAM = 'returned';

/** Query param + session field for server-issued dashboard access token */
export const TASK_KIOSK_DASH_TOKEN_PARAM = 'tkDash';

/** @returns {string | null} */
function readTaskManagerKioskSessionJson() {
  try {
    return (
      sessionStorage.getItem(TASK_MANAGER_KIOSK_SESSION_KEY)
      || localStorage.getItem(TASK_MANAGER_KIOSK_SESSION_BACKUP_KEY)
    );
  } catch {
    return null;
  }
}

/** @param {object} session */
export function writeTaskManagerKioskSession(session) {
  if (!session) return;
  try {
    const json = JSON.stringify(session);
    sessionStorage.setItem(TASK_MANAGER_KIOSK_SESSION_KEY, json);
    localStorage.setItem(TASK_MANAGER_KIOSK_SESSION_BACKUP_KEY, json);
  } catch {
    /* ignore */
  }
}

/** @returns {{ businessId: string, kioskCode?: string, pin: string, employee: { employee_id: string, full_name?: string, first_name?: string, role?: string }, dashboardToken?: string, checklistCategoryId?: string, checklistTitle?: string } | null} */
export function readTaskManagerKioskSession() {
  try {
    const raw = readTaskManagerKioskSessionJson();
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved?.businessId || !saved?.employee?.employee_id || !saved?.pin) return null;
    // Re-sync so the next navigation leg finds it in sessionStorage
    writeTaskManagerKioskSession(saved);
    return saved;
  } catch {
    return null;
  }
}

/** @param {string} businessId */
export function readTaskManagerKioskEmployeeForBusiness(businessId) {
  const session = readTaskManagerKioskSession();
  if (!session || session.businessId !== businessId) return null;
  return {
    employeeId: session.employee.employee_id,
    employeeName: session.employee.full_name || session.employee.first_name || 'Staff',
    pin: session.pin
  };
}

/**
 * Persist dashboard token from URL into tmk_session (same tab as kiosk).
 * @param {string} token
 */
export function persistTaskKioskDashboardToken(token) {
  if (!token) return;
  try {
    const session = readTaskManagerKioskSession();
    if (!session) return;
    session.dashboardToken = token;
    writeTaskManagerKioskSession(session);
  } catch {
    /* ignore */
  }
}

/**
 * @param {string | URLSearchParams | undefined} search
 */
export function getTaskKioskDashboardToken(search) {
  const params = search instanceof URLSearchParams
    ? search
    : new URLSearchParams(typeof search === 'string' ? search : (typeof window !== 'undefined' ? window.location.search : ''));
  const fromUrl = params.get(TASK_KIOSK_DASH_TOKEN_PARAM);
  if (fromUrl) return fromUrl;
  return readTaskManagerKioskSession()?.dashboardToken || null;
}

/**
 * Task kiosk opened an in-app dashboard page (daily deposit, etc.) and expects PIN context to carry over.
 * @param {string | URLSearchParams | undefined} search
 */
export function getTaskKioskDashboardContext(search) {
  if (typeof window === 'undefined') return null;

  const params = search instanceof URLSearchParams
    ? search
    : new URLSearchParams(typeof search === 'string' ? search : window.location.search);

  const taskReturn = params.get('taskReturn');
  const taskId = params.get('task');
  const businessId = params.get('business');
  const dashboardToken = getTaskKioskDashboardToken(params);

  if (!taskReturn || !taskId || !businessId || !dashboardToken) return null;

  const tmk = readTaskManagerKioskSession();

  if (tmk && tmk.businessId === businessId) {
    let posUser = null;
    try {
      posUser = JSON.parse(localStorage.getItem('posActiveUser') || 'null');
    } catch {
      posUser = null;
    }

    if (!posUser || posUser.source !== 'task_kiosk' || posUser.business_id !== businessId) {
      primePosActiveUserFromTaskKiosk(tmk.employee, businessId);
    }

    localStorage.setItem('currentBusinessId', businessId);
    localStorage.setItem('selectedBusinessId', businessId);

    return {
      businessId,
      taskId,
      taskReturn,
      employeeId: tmk.employee.employee_id,
      employee: tmk.employee,
      pin: tmk.pin,
      dashboardToken
    };
  }

  // sessionStorage may not survive some kiosk shells; posActiveUser + tkDash in URL still valid
  try {
    const posUser = JSON.parse(localStorage.getItem('posActiveUser') || 'null');
    if (posUser?.source === 'task_kiosk' && posUser.business_id === businessId && posUser.id) {
      localStorage.setItem('currentBusinessId', businessId);
      localStorage.setItem('selectedBusinessId', businessId);

      return {
        businessId,
        taskId,
        taskReturn,
        employeeId: posUser.id,
        employee: {
          employee_id: posUser.id,
          full_name: posUser.full_name,
          first_name: posUser.first_name,
          role: posUser.role
        },
        pin: null,
        dashboardToken
      };
    }
  } catch {
    /* ignore */
  }

  return null;
}

/** @param {string | URLSearchParams | undefined} search */
export function isTaskKioskDashboardFlow(search) {
  return !!getTaskKioskDashboardContext(search);
}

/** Sync URL token + business into session storage and localStorage on dashboard load. */
export function primeTaskKioskDashboardFromUrl() {
  if (typeof window === 'undefined') return null;
  const ctx = getTaskKioskDashboardContext();
  if (!ctx) return null;

  const params = new URLSearchParams(window.location.search);
  const tokenFromUrl = params.get(TASK_KIOSK_DASH_TOKEN_PARAM);
  if (tokenFromUrl) {
    persistTaskKioskDashboardToken(tokenFromUrl);
  }
  return ctx;
}

/**
 * Navigate back to the task kiosk without losing PIN session.
 * @param {string} taskReturnPath
 */
export function buildTaskKioskReturnUrl(taskReturnPath) {
  const session = readTaskManagerKioskSession();
  if (session) {
    writeTaskManagerKioskSession(session);
  }
  const url = new URL(taskReturnPath, window.location.origin);
  url.searchParams.set(TASK_KIOSK_RETURN_PARAM, '1');
  return `${url.pathname}${url.search}${url.hash}`;
}
