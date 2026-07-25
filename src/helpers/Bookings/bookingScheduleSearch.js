import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import {
  getBookingAdultDisplayName,
  getParticipantDisplayName,
} from './participantIdentity';

dayjs.extend(customParseFormat);

const DATE_FORMATS = [
  'YYYY-MM-DD',
  'YYYY/MM/DD',
  'MM/DD/YYYY',
  'M/D/YYYY',
  'MM-DD-YYYY',
  'M-D-YYYY',
  'MM/DD/YY',
  'M/D/YY',
  'MM/DD',
  'M/D',
  'MMM D',
  'MMMM D',
  'MMM D, YYYY',
  'MMMM D, YYYY',
  'MMM D YYYY',
  'MMMM D YYYY',
  'D MMM',
  'D MMMM',
  'D MMM YYYY',
  'D MMMM YYYY',
];

export function normalizeSearchDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Parse a schedule search string into YYYY-MM-DD when it looks like a date.
 * Month/day-only values use `referenceYear` (defaults to current year).
 */
export function parseScheduleSearchDate(query, referenceYear = dayjs().year()) {
  const raw = String(query || '').trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const iso = raw.slice(0, 10);
    return dayjs(iso, 'YYYY-MM-DD', true).isValid() ? iso : null;
  }

  for (const fmt of DATE_FORMATS) {
    const parsed = dayjs(raw, fmt, true);
    if (!parsed.isValid()) continue;
    const withYear = fmt.includes('Y') ? parsed : parsed.year(referenceYear);
    if (!withYear.isValid()) continue;
    return withYear.format('YYYY-MM-DD');
  }

  return null;
}

function collectBookingSearchNames(booking) {
  const names = [];
  const customerName = String(booking?.customer_name || '').trim();
  if (customerName) names.push(customerName);

  const adultName = getBookingAdultDisplayName(booking);
  if (adultName) names.push(adultName);

  (booking?.booking_participants || []).forEach((participant, index) => {
    const name = getParticipantDisplayName(participant, index);
    if (name) names.push(name);
  });

  return names;
}

/** True when booking matches schedule search (name, email, phone, date, booking #, activity). */
export function bookingMatchesScheduleSearch(booking, query) {
  const raw = String(query || '').trim();
  if (!raw) return true;

  const q = raw.toLowerCase();
  const queryDigits = normalizeSearchDigits(raw);

  const email = String(booking?.customer_email || '').toLowerCase();
  if (email.includes(q)) return true;

  const bookingNumber = String(booking?.booking_number || '').toLowerCase();
  if (bookingNumber.includes(q)) return true;

  const activity = String(booking?.booking_activities?.activity_name || '').toLowerCase();
  if (activity.includes(q)) return true;

  const phone = String(booking?.customer_phone || '');
  if (phone.toLowerCase().includes(q)) return true;
  const phoneDigits = normalizeSearchDigits(phone);
  if (queryDigits.length >= 3 && phoneDigits.includes(queryDigits)) return true;

  const dateStr = String(booking?.booking_date || '').slice(0, 10);
  if (dateStr) {
    const normalizedQueryDate = q.replace(/\//g, '-');
    if (dateStr.includes(normalizedQueryDate) || dateStr.slice(5).includes(normalizedQueryDate)) {
      return true;
    }
    const parsedDate = parseScheduleSearchDate(raw);
    if (parsedDate) {
      if (dateStr === parsedDate) return true;
      // Month/day search without year: match any year on that calendar day.
      if (!/\d{4}/.test(raw) && dateStr.slice(5) === parsedDate.slice(5)) return true;
    }
  }

  return collectBookingSearchNames(booking).some((name) =>
    String(name).toLowerCase().includes(q),
  );
}
