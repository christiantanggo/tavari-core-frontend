/** Default operating hours (matches Settings → Operating Hours). */
export const DEFAULT_OPERATING_HOURS = {
  monday: { open: '09:00', close: '17:00', closed: false },
  tuesday: { open: '09:00', close: '17:00', closed: false },
  wednesday: { open: '09:00', close: '17:00', closed: false },
  thursday: { open: '09:00', close: '17:00', closed: false },
  friday: { open: '09:00', close: '17:00', closed: false },
  saturday: { open: '10:00', close: '16:00', closed: false },
  sunday: { open: '12:00', close: '16:00', closed: true }
};

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const DAY_LABEL_TO_KEY = {
  Sunday: 'sunday',
  Monday: 'monday',
  Tuesday: 'tuesday',
  Wednesday: 'wednesday',
  Thursday: 'thursday',
  Friday: 'friday',
  Saturday: 'saturday'
};

const OPERATING_HOURS_BUFFER_MINUTES = 180; // 3 hours before open / after close
const SLOT_INTERVAL_MINUTES = 15;
const FALLBACK_START_MINUTES = 6 * 60;
const FALLBACK_END_MINUTES = 22 * 60;

/** Parse "09:00", "9:30 AM", "2:30 PM" → minutes from midnight. */
export function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const raw = String(timeStr).trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  const isPM = upper.includes('PM');
  const isAM = upper.includes('AM');
  const match = upper.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  if (isPM || isAM) {
    if (isPM && hours !== 12) hours += 12;
    if (isAM && hours === 12) hours = 0;
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Minutes from midnight → "09:00 AM" */
export function formatMinutesAsDisplay(minutes) {
  const h24 = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const displayHour = h24 % 12 || 12;
  return `${displayHour}:${String(mins).padStart(2, '0')} ${suffix}`;
}

/** Minutes from midnight → "09:00" (24h, for HTML time inputs / DB) */
export function formatMinutesAs24Hour(minutes) {
  const h24 = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  return `${String(h24).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function getDayKeyFromLabel(dayLabel) {
  if (!dayLabel) return 'monday';
  return DAY_LABEL_TO_KEY[dayLabel] || String(dayLabel).toLowerCase();
}

/** YYYY-MM-DD → lowercase day key */
export function getDayKeyFromDateString(dateStr) {
  if (!dateStr) return 'monday';
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return 'monday';
  return DAY_KEYS[d.getDay()] || 'monday';
}

function getDayOperatingBounds(operatingHours, dayKey) {
  const hours =
    operatingHours?.[dayKey] ||
    DEFAULT_OPERATING_HOURS[dayKey] ||
    DEFAULT_OPERATING_HOURS.monday;

  if (!hours || hours.closed) return null;

  const open = parseTimeToMinutes(hours.open);
  const close = parseTimeToMinutes(hours.close);
  if (open == null || close == null) return null;

  return { open, close };
}

function getWidestOpenDayBounds(operatingHours) {
  const source = operatingHours && typeof operatingHours === 'object'
    ? operatingHours
    : DEFAULT_OPERATING_HOURS;

  let minOpen = null;
  let maxClose = null;

  DAY_KEYS.forEach((key) => {
    const bounds = getDayOperatingBounds(source, key);
    if (!bounds) return;
    minOpen = minOpen == null ? bounds.open : Math.min(minOpen, bounds.open);
    maxClose = maxClose == null ? bounds.close : Math.max(maxClose, bounds.close);
  });

  if (minOpen == null || maxClose == null) return null;
  return { open: minOpen, close: maxClose };
}

/**
 * Operating window for time-slot dropdowns: open−3h through close+3h (same calendar day).
 */
export function getBufferedOperatingWindow(
  operatingHours,
  dayKey,
  bufferMinutes = OPERATING_HOURS_BUFFER_MINUTES
) {
  let bounds = getDayOperatingBounds(operatingHours, dayKey);
  if (!bounds) {
    bounds = getWidestOpenDayBounds(operatingHours);
  }
  if (!bounds) {
    return {
      startMinutes: FALLBACK_START_MINUTES,
      endMinutes: FALLBACK_END_MINUTES
    };
  }

  const startMinutes = Math.max(0, bounds.open - bufferMinutes);
  const endMinutes = Math.min(24 * 60 - SLOT_INTERVAL_MINUTES, bounds.close + bufferMinutes);

  return {
    startMinutes,
    endMinutes: Math.max(startMinutes, endMinutes)
  };
}

/**
 * @param {'display'|'24h'} format - value format for <option value="">
 * @param {string|null} includeValue - ensure current value appears even if outside window
 */
export function buildFifteenMinuteTimeOptions(
  operatingHours,
  dayKey,
  { format = 'display', includeValue = null } = {}
) {
  const { startMinutes, endMinutes } = getBufferedOperatingWindow(operatingHours, dayKey);
  const options = [];
  const seen = new Set();

  for (let m = startMinutes; m <= endMinutes; m += SLOT_INTERVAL_MINUTES) {
    const value = format === '24h' ? formatMinutesAs24Hour(m) : formatMinutesAsDisplay(m);
    if (seen.has(value)) continue;
    seen.add(value);
    options.push({
      value,
      label: format === 'display' ? value : formatMinutesAsDisplay(m)
    });
  }

  if (includeValue) {
    const raw = String(includeValue).trim();
    if (raw) {
      const minutes = parseTimeToMinutes(raw);
      const normalizedValue =
        format === '24h'
          ? (minutes != null ? formatMinutesAs24Hour(minutes) : raw.substring(0, 5))
          : (minutes != null ? formatMinutesAsDisplay(minutes) : raw);

      if (!seen.has(normalizedValue)) {
        const label =
          minutes != null
            ? formatMinutesAsDisplay(minutes)
            : raw;
        options.push({ value: normalizedValue, label });
        seen.add(normalizedValue);
      }
    }
  }

  options.sort((a, b) => {
    const ma = parseTimeToMinutes(a.value) ?? 0;
    const mb = parseTimeToMinutes(b.value) ?? 0;
    return ma - mb;
  });

  return options;
}
