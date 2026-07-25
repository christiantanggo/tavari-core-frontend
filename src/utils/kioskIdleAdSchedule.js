/**
 * Waiver kiosk idle ads: schedule checks use wall-clock date/time in the business timezone.
 * digital_signage_ads.days_of_week: 0 = Sunday … 6 = Saturday (matches ScheduleManagementScreen).
 */

const WEEKDAY_LONG_TO_NUM = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6
};

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * @param {string|Date|null|undefined} raw
 * @returns {string|null} 'HH:MM' for <input type="time" />
 */
export function dbTimeToTimeInput(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw);
  const segment = s.includes('T') ? (s.split('T')[1] || '').slice(0, 8) : s.slice(0, 8);
  const [h, m] = segment.split(':');
  if (h == null || m == null) return null;
  return `${h.padStart(2, '0')}:${m.slice(0, 2).padStart(2, '0')}`;
}

/**
 * @param {string|null|undefined} timeInput 'HH:MM'
 * @returns {string|null} 'HH:MM:SS' for Postgres time
 */
export function timeInputToDbTime(timeInput) {
  if (!timeInput || !String(timeInput).trim()) return null;
  const [h, m] = String(timeInput).split(':');
  if (h == null || m == null) return null;
  return `${h.padStart(2, '0')}:${m.slice(0, 2).padStart(2, '0')}:00`;
}

export function parseTimeToMinutes(val) {
  if (val == null || val === '') return null;
  const s = String(val);
  const segment = s.includes('T') ? (s.split('T')[1] || '').slice(0, 8) : s.slice(0, 8);
  const [hh, mm] = segment.split(':');
  if (hh == null || mm == null || hh === '') return null;
  const h = parseInt(hh, 10);
  const m = parseInt(String(mm).slice(0, 2), 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function formatHm(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Current calendar date, day-of-week (0=Sun), and minutes since midnight in `timeZone`.
 * @param {Date} date
 * @param {string} timeZone IANA zone e.g. America/Toronto
 */
export function getZonedParts(date, timeZone) {
  const tz = timeZone && String(timeZone).trim() ? String(timeZone).trim() : 'America/Toronto';
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const parts = dtf.formatToParts(date);
    const m = {};
    for (const p of parts) {
      if (p.type !== 'literal') m[p.type] = p.value;
    }
    const dateStr = `${m.year}-${m.month}-${m.day}`;
    const dow = WEEKDAY_LONG_TO_NUM[m.weekday];
    const minutes = parseInt(m.hour, 10) * 60 + parseInt(m.minute, 10);
    return { dateStr, dow: dow === undefined ? 0 : dow, minutes, timeZone: tz };
  } catch {
    return getZonedParts(date, 'America/Toronto');
  }
}

/**
 * Whether this ad row should be shown on kiosk attract mode right now.
 * @param {object} adRow digital_signage_ads row (start_date, end_date, start_time, end_time, days_of_week)
 * @param {string} timeZone
 * @param {Date} [now]
 */
export function isKioskIdleAdScheduledNow(adRow, timeZone, now = new Date()) {
  if (!adRow) return false;
  const { dateStr, dow, minutes } = getZonedParts(now, timeZone);

  const sd = adRow.start_date ? String(adRow.start_date).slice(0, 10) : null;
  const ed = adRow.end_date ? String(adRow.end_date).slice(0, 10) : null;
  if (sd && dateStr < sd) return false;
  if (ed && dateStr > ed) return false;

  const days = Array.isArray(adRow.days_of_week) ? adRow.days_of_week : null;
  if (days && days.length > 0 && !days.includes(dow)) return false;

  const st = parseTimeToMinutes(adRow.start_time);
  const et = parseTimeToMinutes(adRow.end_time);
  if (st == null && et == null) return true;
  if (st == null || et == null) return true;

  if (et >= st) {
    return minutes >= st && minutes <= et;
  }
  return minutes >= st || minutes <= et;
}

/**
 * One-line summary for admin UI.
 * @param {object} ad
 * @param {string} [timezoneLabel] shown if provided
 */
export function formatKioskAdScheduleSummary(ad) {
  if (!ad) return '';
  const bits = [];
  if (ad.start_date) bits.push(`From ${String(ad.start_date).slice(0, 10)}`);
  if (ad.end_date) bits.push(`to ${String(ad.end_date).slice(0, 10)}`);
  const st = parseTimeToMinutes(ad.start_time);
  const et = parseTimeToMinutes(ad.end_time);
  if (st == null && et == null) {
    bits.push('All day');
  } else if (st != null && et != null) {
    bits.push(`${formatHm(st)}–${formatHm(et)}`);
  }
  const days = Array.isArray(ad.days_of_week) ? ad.days_of_week : null;
  if (days && days.length > 0) {
    bits.push(days.sort((a, b) => a - b).map((d) => DAY_ABBR[d] || d).join(', '));
  } else {
    bits.push('Every day');
  }
  return bits.join(' · ');
}
