function parseTimeToMinutes(value) {
  if (!value) return null;
  const raw = String(value).trim();

  // 12-hour times like "4:00 PM" / "6:00pm"
  const ampm = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (ampm) {
    let hour = Number.parseInt(ampm[1], 10);
    const minute = Number.parseInt(ampm[2], 10);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    const suffix = ampm[3].toUpperCase();
    if (suffix === 'AM') {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }
    return hour * 60 + minute;
  }

  // 24-hour times like "16:00" / "16:00:00"
  const match24 = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match24) return null;
  const h = Number.parseInt(match24[1], 10);
  const m = Number.parseInt(match24[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

export function getBookingTimeRangeMinutes(booking, { ignoreStoredEndTime = false } = {}) {
  const startMinutes = parseTimeToMinutes(booking?.booking_time);
  if (startMinutes == null) return null;

  const endLabel = ignoreStoredEndTime
    ? getBookingEndTime({ ...booking, booking_end_time: null })
    : getBookingEndTime(booking);
  let endMinutes = parseTimeToMinutes(endLabel);
  if (endMinutes == null) return null;
  if (endMinutes <= startMinutes) endMinutes += 1440;

  return { startMinutes, endMinutes };
}

export function doBookingTimeRangesOverlap(bookingA, bookingB, options = {}) {
  const rangeA = getBookingTimeRangeMinutes(bookingA, options);
  const rangeB = getBookingTimeRangeMinutes(bookingB, options);
  if (!rangeA || !rangeB) return false;
  return rangeA.startMinutes < rangeB.endMinutes && rangeB.startMinutes < rangeA.endMinutes;
}

function minutesToTime(totalMinutes) {
  const mins = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatTime12Hour(timeValue) {
  const startMinutes = parseTimeToMinutes(timeValue);
  if (startMinutes == null) return '';
  const h24 = Math.floor(startMinutes / 60);
  const m = startMinutes % 60;
  const h12 = h24 % 12 || 12;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function formatBookingTimeRangeLabel(booking) {
  const start = formatTime12Hour(booking?.booking_time);
  if (!start) return '';
  const end = formatTime12Hour(getBookingEndTime(booking));
  if (!end || end === start) return start;
  return `${start} - ${end}`;
}

export function getBookingDurationMinutes(booking) {
  const explicit = Number(booking?.duration_minutes);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const activityDuration = Number(booking?.booking_activities?.duration_minutes);
  if (Number.isFinite(activityDuration) && activityDuration > 0) return activityDuration;
  return 60;
}

export function getBookingEndTime(booking) {
  if (booking?.booking_end_time) return String(booking.booking_end_time).slice(0, 5);
  const startMinutes = parseTimeToMinutes(booking?.booking_time);
  if (startMinutes == null) return '';
  const duration = getBookingDurationMinutes(booking);
  const extended = Number(booking?.extended_minutes) || 0;
  return minutesToTime(startMinutes + duration + extended);
}

export function formatBookingResourceAssignments(assignments = [], resources = []) {
  const list = Array.isArray(assignments) ? assignments : [];
  return list.map((assignment) => {
    const category = resources.find((cat) => cat.categoryId === assignment.category_id);
    const resource = category?.resources?.find((res) => res.id === assignment.resource_id);
    return {
      ...assignment,
      categoryName: category?.name || category?.categoryName || assignment.category_id,
      resourceName: resource?.name || assignment.resource_id
    };
  });
}

import { getFixedResourceIdsFromCategoryValue, parseScheduleCategoryAssignment, SCHEDULE_RESOURCE_MODES } from '../helpers/Bookings/bookingScheduleResourceRequirements';

export function flattenScheduleResourceAssignments(resourceAssignments) {
  if (!resourceAssignments || typeof resourceAssignments !== 'object') return [];
  const out = [];
  Object.entries(resourceAssignments).forEach(([categoryId, value]) => {
    const parsed = parseScheduleCategoryAssignment(value);
    // Only expand fixed concrete IDs. Pool requirements must be auto-assigned first.
    const resourceIds =
      parsed.mode === SCHEDULE_RESOURCE_MODES.FIXED
        ? parsed.resourceIds
        : getFixedResourceIdsFromCategoryValue(value);
    resourceIds.forEach((resourceId) => {
      if (categoryId && resourceId) {
        out.push({ categoryId, resourceId, source: 'schedule' });
      }
    });
  });
  return out;
}
