import { formatDateTimeForBusiness } from '../../utils/businessDateFormat';
import { getParticipantDisplayName } from './participantIdentity';

const CUSTOMER_SOURCES = new Set(['web', 'app', 'kiosk']);

export function getBookingBookerDisplayName(booking) {
  if (!booking) return '';

  const fn = String(booking.first_name ?? '').trim();
  const ln = String(booking.last_name ?? '').trim();
  if (fn || ln) return [fn, ln].filter(Boolean).join(' ');

  const customerName = String(booking.customer_name ?? '').trim();
  if (customerName) return customerName;

  const parts = booking.booking_participants || [];
  if (parts.length) {
    const name = getParticipantDisplayName(parts[0], 0);
    if (name) return name;
  }

  const email = String(booking.customer_email ?? '').trim();
  if (email) return email;

  const phone = String(booking.customer_phone ?? '').trim();
  return phone || '';
}

function resolveStaffUserLabel(userId, userNames) {
  if (!userId) return null;
  return userNames?.[userId] || 'Staff user';
}

function resolveCreatedByActor(booking, userNames) {
  if (booking?.created_by) {
    return resolveStaffUserLabel(booking.created_by, userNames);
  }

  if (CUSTOMER_SOURCES.has(booking?.source)) {
    const booker = getBookingBookerDisplayName(booking);
    return booker ? `Customer (${booker})` : 'Customer';
  }

  if (booking?.source === 'staff') {
    return 'Staff';
  }

  return 'Unknown';
}

function bookingWasUpdated(booking) {
  if (!booking?.updated_at || !booking?.created_at) return false;
  return new Date(booking.updated_at).getTime() > new Date(booking.created_at).getTime() + 1000;
}

export function buildBookingCreatedBySummary(booking, userNames, businessTimezone) {
  const actor = resolveCreatedByActor(booking, userNames);
  const ip = String(booking?.created_ip || '').trim() || null;
  const date = booking?.created_at
    ? formatDateTimeForBusiness(booking.created_at, businessTimezone)
    : null;

  return { actor, ip, date };
}

export function buildBookingLastChangedSummary(booking, userNames, businessTimezone) {
  if (!bookingWasUpdated(booking)) {
    return { actor: null, ip: null, date: null, unchanged: true };
  }

  const actor = booking?.updated_by
    ? resolveStaffUserLabel(booking.updated_by, userNames)
    : 'Unknown';

  const ip = String(booking?.updated_ip || '').trim() || null;
  const date = booking?.updated_at
    ? formatDateTimeForBusiness(booking.updated_at, businessTimezone)
    : null;

  return { actor, ip, date, unchanged: false };
}

export function formatProvenanceDetailLine({ actor, ip, date, unchanged = false }) {
  if (unchanged) return '—';

  const parts = [actor].filter(Boolean);
  if (ip) parts.push(ip);
  if (date) parts.push(date);
  return parts.length ? parts.join(' · ') : '—';
}
