import { getOccupiedResourceIds } from './bookingResourceAvailability';
import { getBookingEndTime } from '../../utils/bookingTimeRange';

function parseTimeToMinutes(value) {
  if (!value) return null;
  const [hh, mm] = String(value).slice(0, 5).split(':');
  const h = Number.parseInt(hh, 10);
  const m = Number.parseInt(mm, 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function minutesToTime(totalMinutes) {
  const mins = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Hypothetical booking row after adding minutes to the current end time. */
export function buildExtendedBookingSnapshot(booking, addedMinutes) {
  const added = Math.max(0, Number.parseInt(addedMinutes, 10) || 0);
  const currentEndMinutes = parseTimeToMinutes(getBookingEndTime(booking));
  const newEndMinutes = currentEndMinutes != null
    ? currentEndMinutes + added
    : null;

  return {
    ...booking,
    extended_minutes: (Number(booking?.extended_minutes) || 0) + added,
    booking_end_time: newEndMinutes != null ? `${minutesToTime(newEndMinutes)}:00` : booking?.booking_end_time,
  };
}

function resolveResourceName(resourceId, resources = []) {
  for (const category of resources || []) {
    const match = (category?.resources || []).find((resource) => resource.id === resourceId);
    if (match?.name) return match.name;
  }
  return resourceId;
}

/**
 * Check whether a booking can extend into addedMinutes without conflicting
 * with other bookings on the same assigned resources.
 */
export function assessBookingExtensionAvailability({
  booking,
  addedMinutes,
  dayBookings = [],
  resources = [],
  resourcePaddingById = new Map(),
  resourceQuantityById = new Map(),
} = {}) {
  const added = Number.parseInt(addedMinutes, 10);
  if (!Number.isFinite(added) || added <= 0) {
    return {
      ok: false,
      message: 'Enter how many minutes to add.',
      conflicts: [],
      extendedBooking: null,
      newEndTime: null,
      newEndTimeLabel: '',
    };
  }

  const extendedBooking = buildExtendedBookingSnapshot(booking, added);
  const newEndTime = getBookingEndTime(extendedBooking);
  const assignments = booking?.booking_resource_assignments || [];

  if (!assignments.length) {
    return {
      ok: true,
      conflicts: [],
      extendedBooking,
      newEndTime,
      newEndTimeLabel: newEndTime,
      warning: 'No room is assigned to this booking, so schedule conflicts were not checked.',
    };
  }

  const conflicts = [];
  const categories = [...new Set(assignments.map((row) => row.category_id).filter(Boolean))];

  categories.forEach((categoryId) => {
    const occupied = getOccupiedResourceIds({
      bookings: dayBookings,
      targetBooking: extendedBooking,
      categoryId,
      excludeBookingId: booking?.id || null,
      resourcePaddingById,
      resourceQuantityById,
    });

    assignments
      .filter((row) => row.category_id === categoryId && row.resource_id)
      .forEach((row) => {
        if (!occupied.has(row.resource_id)) return;
        const sample = occupied.get(row.resource_id);
        conflicts.push({
          resourceId: row.resource_id,
          resourceName: resolveResourceName(row.resource_id, resources),
          bookingNumber: sample?.booking_number || sample?.id,
          bookingTime: sample?.booking_time,
        });
      });
  });

  if (conflicts.length) {
    return {
      ok: false,
      message: 'This extension is blocked because another booking uses the room during the extended time.',
      conflicts,
      extendedBooking,
      newEndTime,
      newEndTimeLabel: newEndTime,
    };
  }

  return {
    ok: true,
    conflicts: [],
    extendedBooking,
    newEndTime,
    newEndTimeLabel: newEndTime,
  };
}
