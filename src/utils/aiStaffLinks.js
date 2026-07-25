import catalogJson from '../constants/aiStaffLinksCatalog.json';
import { getCampRegistrationPortalPath } from '../constants/camperRegistrationForm';
import { EMPLOYEE_APP_HOST } from './employeeAppRouting';
import {
  getCustomerPortalBaseUrl,
} from './bookingPublicLinks';
import { getPartyGuestListPortalPath } from './partyGuestList';

const catalog = catalogJson.links || [];

/** Links that need live template lookup — omitted from bulk “all links” lists. */
export const ASYNC_STAFF_LINK_IDS = new Set(['waiver_signing', 'waiver_from_booking']);

function normalizeOrigin(origin) {
  if (!origin) return typeof window !== 'undefined' ? window.location.origin : '';
  return String(origin).replace(/\/$/, '');
}

const RESOLVERS = {
  customerPortalBase: (origin, businessId) => getCustomerPortalBaseUrl(origin, businessId),
  customerPortalAccount: (origin, businessId) =>
    businessId ? `${normalizeOrigin(origin)}/customer-portal/${businessId}/account` : '',
  campRegistrationPortal: (origin, businessId) =>
    businessId ? `${normalizeOrigin(origin)}${getCampRegistrationPortalPath(businessId)}` : '',
  partyGuestListPortal: (origin, businessId) =>
    businessId ? `${normalizeOrigin(origin)}${getPartyGuestListPortalPath(businessId)}` : '',
  waiverSigning: (origin, businessId) =>
    businessId ? `${normalizeOrigin(origin)}/waiver/${businessId}` : '',
  waiverFromBooking: (origin, businessId) =>
    businessId ? `${normalizeOrigin(origin)}/waiver-from-booking/${businessId}` : '',
  reputationReview: (origin, businessId) =>
    businessId ? `${normalizeOrigin(origin)}/reputation/review/${businessId}` : '',
  waiverKioskReact: (origin) => `${normalizeOrigin(origin)}/kiosk/waiver`,
  waiverKioskDashboard: (origin) => `${normalizeOrigin(origin)}/dashboard/waivers/kiosk`,
  waiverKioskDownload: (origin) => `${normalizeOrigin(origin)}/dashboard/waivers/kiosk/download`,
  waiverLegacyTablet: (origin, businessId) =>
    businessId ? `${normalizeOrigin(origin)}/waiver-browser-kiosk/?business=${businessId}` : '',
  musicKiosk: (origin) => `${normalizeOrigin(origin)}/kiosk/music`,
  signagePlayer: (origin) => `${normalizeOrigin(origin)}/signage/player`,
  timeClockKiosk: (origin, businessId) =>
    businessId ? `${normalizeOrigin(origin)}/time-clock-kiosk/${businessId}` : '',
  employeePortalProd: () => `https://${EMPLOYEE_APP_HOST}/login`,
  employeePortalSameOrigin: (origin) => `${normalizeOrigin(origin)}/portal/login`,
  taskManager: (origin) => `${normalizeOrigin(origin)}/dashboard/tasks`,
  partyGuestListsStaff: (origin) => `${normalizeOrigin(origin)}/dashboard/bookings/parties`,
};

/**
 * @param {string} linkId
 * @param {{ origin?: string; businessId?: string }} options
 */
export function resolveStaffLink(linkId, options = {}) {
  const entry = catalog.find((l) => l.id === linkId);
  if (!entry) return null;

  const origin = normalizeOrigin(options.origin);
  const businessId = options.businessId || '';

  if (entry.requiresBusinessId && !businessId) {
    return {
      ...entry,
      url: '',
      error: 'Select an active business to generate this link.',
    };
  }

  const resolver = RESOLVERS[entry.resolver];
  const url = resolver ? resolver(origin, businessId) : '';

  return {
    id: entry.id,
    label: entry.label,
    description: entry.description,
    audience: entry.audience,
    category: entry.category,
    url,
    error: url ? undefined : 'Could not build URL for this link.',
  };
}

/**
 * @param {{ origin?: string; businessId?: string; category?: string }} options
 */
export function resolveStaffLinksByCategory(options = {}) {
  const { category = 'all' } = options;
  const filtered =
    category === 'all'
      ? catalog
      : catalog.filter((l) => l.category === category);

  return filtered
    .filter((entry) => !ASYNC_STAFF_LINK_IDS.has(entry.id))
    .map((entry) => resolveStaffLink(entry.id, options))
    .filter((row) => row && row.url && !row.error);
}

export function getStaffLinkCatalog() {
  return catalog;
}

export async function copyTextToClipboard(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
