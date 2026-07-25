import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Turn employee-app / system time clock note lines into plain-language strings for managers.
 * Lines that are not recognized patterns are returned unchanged (staff free text).
 */
export function humanizeTimeClockNoteLines(rawNotes, { scheduledShift = null } = {}) {
  if (rawNotes == null || String(rawNotes).trim() === '') return [];
  return String(rawNotes)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => humanizeSingleNoteLine(line, { scheduledShift }));
}

function humanizeSingleNoteLine(line, { scheduledShift }) {
  const shiftLink = /^Employee app shift:\s*([0-9a-f-]{36})\s*$/i.exec(line);
  if (shiftLink) {
    const id = shiftLink[1];
    if (scheduledShift && String(scheduledShift.id).toLowerCase() === id.toLowerCase()) {
      const date = scheduledShift.shift_date || '';
      const pos = scheduledShift.position ? ` · ${scheduledShift.position}` : '';
      const start = scheduledShift.start_time || '';
      const end = scheduledShift.end_time || '';
      return `Employee app: punches linked to this scheduled shift (${date} ${start}–${end}${pos}).`;
    }
    return 'Employee app: punches were linked to a scheduled shift (same shift as on this timecard when applicable).';
  }

  const early = /^early_clock_out:\s*(\d+)\s*minutes?\s*$/i.exec(line);
  if (early) {
    return `System: early clock-out — about ${early[1]} minutes before the scheduled end (outside the grace window).`;
  }

  const late = /^late_clock_in:\s*(\d+)\s*minutes?\s*$/i.exec(line);
  if (late) {
    return `System: late clock-in — about ${late[1]} minutes after the scheduled start (outside the grace window).`;
  }

  const scheduledShort = /^Scheduled shift:\s*linked from employee app\s*$/i.exec(line);
  if (scheduledShort) {
    return 'Employee app: clock-in was linked to a scheduled shift.';
  }

  const scheduledLine = /^Scheduled shift:\s*(.+)$/i.exec(line);
  if (scheduledLine) {
    return `Employee app: linked to scheduled shift — ${scheduledLine[1].trim()}.`;
  }

  const latePlain = /^Late clock-in:\s*(.+)$/i.exec(line);
  if (latePlain) return `System: ${latePlain[0]}`;

  const earlyPlain = /^Early clock-out:\s*(.+)$/i.exec(line);
  if (earlyPlain) return `System: ${earlyPlain[0]}`;

  const genericKey = /^([a-z_]+):\s*(.+)$/i.exec(line);
  if (genericKey && genericKey[1].includes('_')) {
    const label = genericKey[1].replace(/_/g, ' ');
    return `System (${label}): ${genericKey[2]}`;
  }

  return line;
}

function pickLatLng(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const lat = Number(obj.latitude);
  const lng = Number(obj.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    latitude: lat,
    longitude: lng,
    accuracy: obj.accuracy != null && Number.isFinite(Number(obj.accuracy)) ? Number(obj.accuracy) : null,
    capturedAt: obj.capturedAt || null,
    geofence: obj.geofence && typeof obj.geofence === 'object' ? obj.geofence : null,
  };
}

/**
 * Parse scheduling_time_clocks.location (JSON string) for manager display.
 */
export function parseTimeClockLocationPayload(raw) {
  if (raw == null || raw === '') {
    return { clockIn: null, clockOut: null, rootGeofence: null, rootCapturedAt: null, rootUpdatedAt: null, rawError: null };
  }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') {
      return { clockIn: null, clockOut: null, rootGeofence: null, rootCapturedAt: null, rootUpdatedAt: null, rawError: null };
    }
    const clockIn = pickLatLng(parsed.clockIn) || pickLatLng(parsed.clock_in);
    const clockOut = pickLatLng(parsed.clockOut) || pickLatLng(parsed.clock_out);
    const rootGeofence =
      parsed.geofence && typeof parsed.geofence === 'object' ? parsed.geofence : null;
    return {
      clockIn,
      clockOut,
      rootGeofence,
      rootCapturedAt: parsed.capturedAt || null,
      rootUpdatedAt: parsed.updatedAt || null,
      legacy: parsed.legacyLocation ? String(parsed.legacyLocation) : null,
    };
  } catch (e) {
    return {
      clockIn: null,
      clockOut: null,
      rootGeofence: null,
      rootCapturedAt: null,
      rootUpdatedAt: null,
      rawError: typeof raw === 'string' ? raw : String(e),
    };
  }
}

export function formatLatLngPair(pt) {
  if (!pt) return '—';
  const acc =
    pt.accuracy != null && Number.isFinite(pt.accuracy)
      ? ` · GPS accuracy about ±${Math.round(pt.accuracy)} m`
      : '';
  return `${pt.latitude.toFixed(6)}, ${pt.longitude.toFixed(6)}${acc}`;
}

export function googleMapsLink(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;
}

export function summarizeGeofenceForPoint(geofence) {
  if (!geofence || typeof geofence !== 'object') return null;
  const ok = geofence.ok === true;
  const dist = geofence.distanceMeters;
  const radius = geofence.radiusMeters;
  if (ok && dist != null && radius != null) {
    return `Inside allowed area: about ${Math.round(dist)} m from job-site pin (radius ${Math.round(radius)} m).`;
  }
  if (!ok && dist != null) {
    return `Outside allowed area: about ${Math.round(dist)} m from job-site pin${radius != null ? ` (allowed radius ${Math.round(radius)} m)` : ''}.`;
  }
  if (geofence.enforced === false && geofence.warning) {
    return String(geofence.warning);
  }
  return null;
}

export function formatLocationCapturedAt(iso, tz) {
  if (!iso) return null;
  try {
    return dayjs(iso).tz(tz || 'America/Toronto').format('MMM D, YYYY h:mm A');
  } catch {
    return iso;
  }
}

const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';

/**
 * Reverse geocode for manager UI (OpenStreetMap Nominatim).
 * Returns a single-line address or null on failure. Keep usage light (sequential calls with delay).
 */
export async function reverseGeocodeForDisplay(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  try {
    const url = `${NOMINATIM_REVERSE}?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(
      lng
    )}&zoom=18&addressdetails=1`;
    const response = await fetch(url, {
      headers: {
        'Accept-Language': 'en',
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data?.display_name && typeof data.display_name === 'string') {
      const s = data.display_name.trim();
      return s.length > 200 ? `${s.slice(0, 199)}…` : s;
    }
    const address = data?.address;
    if (address && typeof address === 'object') {
      const parts = [];
      if (address.road) parts.push(address.road);
      if (address.city || address.town || address.village) parts.push(address.city || address.town || address.village);
      if (address.state) parts.push(address.state);
      if (address.postcode) parts.push(address.postcode);
      if (address.country) parts.push(address.country);
      const joined = parts.join(', ');
      return joined || null;
    }
    return null;
  } catch {
    return null;
  }
}
