/** Holiday / special hours helpers (Dashboard → Settings → Holiday Hours). */

export function formatTime12h(value) {
  const trimmed = String(value || '').trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return trimmed;

  let hour = parseInt(match[1], 10);
  const minute = match[2];
  if (Number.isNaN(hour) || hour < 0 || hour > 23) return trimmed;

  const period = hour >= 12 ? 'pm' : 'am';
  if (hour === 0) hour = 12;
  else if (hour > 12) hour -= 12;

  return minute === '00' ? `${hour}${period}` : `${hour}:${minute}${period}`;
}

export function formatHoursRange(open, close) {
  const openFmt = formatTime12h(open);
  const closeFmt = formatTime12h(close);
  if (!openFmt && !closeFmt) return '';
  if (!openFmt) return closeFmt;
  if (!closeFmt) return openFmt;
  return `${openFmt} - ${closeFmt}`;
}

/**
 * @returns {null | {
 *   date: string,
 *   label: string,
 *   hoursText: string,
 *   closed: boolean,
 *   closingTimeDisplay: string | null,
 * }}
 */
export function getSpecialHoursForDate(holidayHours, dateStr) {
  const date = normalizeHolidayDateKey(dateStr);
  if (!date || !Array.isArray(holidayHours)) return null;

  const row = holidayHours.find(
    (entry) => entry && typeof entry === 'object' && normalizeHolidayDateKey(entry.date) === date,
  );
  if (!row) return null;

  const label = String(row.name || '').trim();
  const closed = row.closed === true;

  if (closed) {
    return {
      date,
      label,
      hoursText: 'Closed',
      closed: true,
      closingTimeDisplay: null,
    };
  }

  const open = typeof row.hours?.open === 'string' ? row.hours.open.trim() : '';
  const close = typeof row.hours?.close === 'string' ? row.hours.close.trim() : '';
  const hoursText = open || close ? formatHoursRange(open, close) : 'Closed';

  return {
    date,
    label,
    hoursText,
    closed: hoursText === 'Closed',
    closingTimeDisplay: close ? formatTime12h(close) : null,
  };
}

export function buildSpecialHoursReminderMessage(entry, { dateLabel } = {}) {
  if (!entry) return '';

  const dayLabel = entry.label || dateLabel || entry.date;

  if (entry.closed) {
    return `${dayLabel} is a special day when we are closed. If you have questions about how this affects your booking, please contact us before you arrive.`;
  }

  const closingNote = entry.closingTimeDisplay
    ? `Unlimited play and similar time-based perks end when we close that day (${entry.closingTimeDisplay}).`
    : 'Unlimited play and similar time-based perks end at our closing time for that day.';

  return `Our hours are different on ${dayLabel}: ${entry.hoursText}. ${closingNote}`;
}

/** @returns {string} YYYY-MM-DD or empty */
export function normalizeHolidayDateKey(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return '';
}

/** True when holiday_hours marks the date as closed all day. */
export function isBusinessClosedOnDate(holidayHours, dateStr) {
  const entry = getSpecialHoursForDate(holidayHours, dateStr);
  return Boolean(entry?.closed);
}

export function getClosedHolidayMessage(holidayHours, dateStr, { dateLabel } = {}) {
  const entry = getSpecialHoursForDate(holidayHours, dateStr);
  if (!entry?.closed) return null;
  const dayLabel = entry.label || dateLabel || entry.date;
  return dayLabel
    ? `We are closed on ${dayLabel}. Please choose another date.`
    : 'We are closed on that date. Please choose another date.';
}
