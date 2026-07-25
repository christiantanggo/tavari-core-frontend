// Employee portal: Tavari Scheduling module must be enabled for time clock / self-serve scheduling UX.
import { isEmployeeAppHost } from './employeeAppRouting';

export const SCHEDULING_PORTAL_NAV_NAMES = ['Schedule', 'Clock', 'Availability', 'Time Off', 'Shift Coverage'];

const SCHEDULING_PATH_SEGMENTS = ['schedule', 'clock', 'availability', 'time-off', 'shift-coverage'];

/**
 * @param {*} supabase Supabase client
 * @param {string} [businessId]
 * @returns {Promise<boolean>}
 */
export async function fetchSchedulingModuleEnabled(supabase, businessId) {
  if (!businessId) return false;
  try {
    const { data, error } = await supabase
      .from('business_module_usage')
      .select('enabled')
      .eq('business_id', businessId)
      .eq('module_key', 'scheduling')
      .maybeSingle();
    if (error) {
      console.warn('[employeePortalSchedulingModule] could not read scheduling flag', error);
      return false;
    }
    return data?.enabled === true;
  } catch (e) {
    console.warn('[employeePortalSchedulingModule] unexpected error', e);
    return false;
  }
}

/**
 * Matches employee-app host paths (/schedule) and main-site paths (/portal/schedule).
 * @param {string} [pathname]
 */
export function isSchedulingEmployeePortalRoute(pathname) {
  if (!pathname) return false;
  const norm = pathname.replace(/\/$/, '') || '/';
  if (isEmployeeAppHost()) {
    return SCHEDULING_PATH_SEGMENTS.some(
      (seg) => norm === `/${seg}` || norm.startsWith(`/${seg}/`)
    );
  }
  return SCHEDULING_PATH_SEGMENTS.some(
    (seg) => norm === `/portal/${seg}` || norm.startsWith(`/portal/${seg}/`)
  );
}
