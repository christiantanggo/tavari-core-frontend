import {
  buildResourcePaddingLookup,
  doResourceBookingsConflict,
} from './bookingResourcePadding';
import {
  SCHEDULE_RESOURCE_MODES,
  listScheduleResourceRequirements,
  listValidPoolCombinations,
  parseScheduleCategoryAssignment,
} from './bookingScheduleResourceRequirements';
import { doBookingTimeRangesOverlap } from '../../utils/bookingTimeRange';

export const ACTIVE_BOOKING_STATUSES_FOR_RESOURCE = ['pending', 'confirmed', 'checked_in'];

export { buildResourcePaddingLookup, formatResourcePaddingSummary, resolveResourcePadding } from './bookingResourcePadding';
export {
  SCHEDULE_RESOURCE_MODES,
  FACILITY_LOCK_CATEGORY_ID,
  parseScheduleCategoryAssignment,
  serializeScheduleCategoryAssignment,
  normalizeScheduleResourceAssignmentsMap,
  listScheduleResourceRequirements,
  listValidPoolCombinations,
  scheduleHasPoolRequirement,
  scheduleHasFacilityLock,
  buildFacilityLockResourceAssignments,
} from './bookingScheduleResourceRequirements';

/** How many concurrent bookings may use this resource; blank / unset = 1 (exclusive). */
export function parseResourceQuantity(value, fallback = 1) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

export function resolveResourceQuantity(resource) {
  return parseResourceQuantity(resource?.quantity, 1);
}

export function buildResourceQuantityLookup(categories = []) {
  const lookup = new Map();

  (categories || []).forEach((category) => {
    (category?.resources || []).forEach((resource) => {
      if (!resource?.id) return;
      lookup.set(resource.id, resolveResourceQuantity(resource));
    });
  });

  return lookup;
}

export function formatResourceQuantitySummary(quantity) {
  const qty = parseResourceQuantity(quantity, 1);
  return qty <= 1 ? 'Exclusive use' : `Up to ${qty} concurrent bookings`;
}

function resolveResourceCapacity(resourceId, resourceQuantityById) {
  if (resourceQuantityById instanceof Map && resourceQuantityById.has(resourceId)) {
    return resourceQuantityById.get(resourceId);
  }
  return 1;
}

/**
 * Count active bookings that would block the target time on each resource.
 * Excludes excludeBookingId (e.g. the booking being edited).
 */
export function getResourceConflictCounts({
  bookings = [],
  targetBooking,
  categoryId,
  excludeBookingId = null,
  resourcePaddingById = new Map(),
} = {}) {
  const conflictCounts = new Map();

  if (!targetBooking || !categoryId) return conflictCounts;

  const paddingLookup = resourcePaddingById instanceof Map
    ? resourcePaddingById
    : buildResourcePaddingLookup([]);

  (bookings || []).forEach((otherBooking) => {
    if (!otherBooking?.id || otherBooking.id === excludeBookingId) return;
    if (!ACTIVE_BOOKING_STATUSES_FOR_RESOURCE.includes(otherBooking.status)) return;

    (otherBooking.booking_resource_assignments || []).forEach((assignment) => {
      if (assignment.category_id !== categoryId || !assignment.resource_id) return;

      const resourceId = assignment.resource_id;
      const otherPadding = paddingLookup.get(resourceId) || { beforeMinutes: 0, afterMinutes: 0 };
      const targetPadding = paddingLookup.get(resourceId) || { beforeMinutes: 0, afterMinutes: 0 };

      if (!doResourceBookingsConflict(targetBooking, targetPadding, otherBooking, otherPadding)) {
        return;
      }

      const existing = conflictCounts.get(resourceId) || { count: 0, sampleBooking: otherBooking };
      existing.count += 1;
      conflictCounts.set(resourceId, existing);
    });
  });

  return conflictCounts;
}

/** Resources at or above concurrent-use capacity for the target time window. */
export function getOccupiedResourceIds({
  bookings = [],
  targetBooking,
  categoryId,
  excludeBookingId = null,
  resourcePaddingById = new Map(),
  resourceQuantityById = new Map(),
} = {}) {
  const occupied = new Map();
  const conflictCounts = getResourceConflictCounts({
    bookings,
    targetBooking,
    categoryId,
    excludeBookingId,
    resourcePaddingById,
  });

  conflictCounts.forEach((entry, resourceId) => {
    const capacity = resolveResourceCapacity(resourceId, resourceQuantityById);
    if (entry.count >= capacity) {
      occupied.set(resourceId, entry.sampleBooking);
    }
  });

  return occupied;
}

export function buildResourceSelectOptions({
  resources = [],
  occupiedResourceIds = new Map(),
  resourceConflictCounts = new Map(),
  currentResourceId = '',
  currentResourceIds = null,
} = {}) {
  const currentSet = new Set(
    Array.isArray(currentResourceIds)
      ? currentResourceIds.filter(Boolean)
      : currentResourceId
        ? [currentResourceId]
        : [],
  );

  return (resources || []).map((resource) => {
    const capacity = resolveResourceQuantity(resource);
    const conflictEntry = resourceConflictCounts.get(resource.id);
    const usageCount = conflictEntry?.count || 0;
    const occupant = occupiedResourceIds.get(resource.id);
    const isCurrent = currentSet.has(resource.id);
    const atCapacity = !!occupant && !isCurrent;
    const available = !atCapacity;

    let label = resource.name;
    if (!available) {
      label = `${resource.name} (in use)`;
    } else if (capacity > 1 && usageCount > 0) {
      label = `${resource.name} (${usageCount} of ${capacity} in use)`;
    }

    return {
      ...resource,
      disabled: !available,
      label,
      usageCount,
      capacity,
      occupantBookingNumber: occupant?.booking_number || null,
    };
  });
}

export function validateResourceSelection({
  resourceId,
  categoryId,
  occupiedResourceIds = new Map(),
  currentResourceId = '',
} = {}) {
  if (!resourceId || !categoryId) {
    return { ok: false, message: 'Please choose a room or resource.' };
  }

  if (resourceId === currentResourceId) {
    return { ok: true };
  }

  const occupant = occupiedResourceIds.get(resourceId);
  if (occupant) {
    const suffix = occupant.booking_number ? ` (#${occupant.booking_number})` : '';
    return {
      ok: false,
      message: `That room is unavailable during this time (including turnover/cleanup padding)${suffix}. Choose another room or change the booking time.`,
    };
  }

  return { ok: true };
}

export function validateCombinedResourceAssignments({
  resourceIds = [],
  occupiedResourceIds = new Map(),
} = {}) {
  const required = [...new Set((resourceIds || []).filter(Boolean))];
  if (!required.length) return { ok: true };

  const blocked = required.filter((resourceId) => occupiedResourceIds.has(resourceId));

  if (blocked.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    message: blocked.length > 1
      ? 'One or more required rooms are unavailable during this time (including turnover padding). Choose another time.'
      : 'A required room is unavailable during this time (including turnover padding). Choose another time.',
  };
}

/** Fixed required IDs only (empty for pool mode). */
export function getRequiredResourceIdsFromSchedule(schedule, categoryId) {
  if (!schedule?.resource_assignments || !categoryId) return [];
  const parsed = parseScheduleCategoryAssignment(schedule.resource_assignments[categoryId]);
  return parsed.mode === SCHEDULE_RESOURCE_MODES.FIXED ? parsed.resourceIds : [];
}

function buildTargetBookingShell({
  excludeBookingId = null,
  bookingDate,
  bookingTime,
  durationMinutes,
} = {}) {
  return {
    id: excludeBookingId,
    booking_date: bookingDate,
    booking_time: bookingTime,
    duration_minutes: durationMinutes,
    extended_minutes: 0,
    booking_end_time: null,
    booking_activities: { duration_minutes: durationMinutes },
  };
}

/**
 * Whether schedule resources (fixed all-of OR pool any-N) are free for a slot.
 * Checks all activities on the day — shared rooms block across package types.
 * Single-room pool occupants (Classic) are treated as movable onto a free pool room
 * when a fixed package (Super/Ultimate) needs their current room.
 */
export function areRequiredResourcesAvailableForSlot({
  schedule,
  categoryId = null,
  bookingDate,
  bookingTime,
  durationMinutes,
  dayBookings = [],
  excludeBookingId = null,
  heldResourceIds = [],
  resourcePaddingById = new Map(),
  resourceQuantityById = new Map(),
  rebalancePoolIds = null,
} = {}) {
  if (!bookingTime || !schedule?.resource_assignments) {
    return { ok: true, requirements: [], blockedResourceIds: [] };
  }

  const requirements = categoryId
    ? listScheduleResourceRequirements({
        [categoryId]: schedule.resource_assignments[categoryId],
      })
    : listScheduleResourceRequirements(schedule.resource_assignments);

  if (!requirements.length) {
    return { ok: true, requirements: [], blockedResourceIds: [] };
  }

  const targetBooking = buildTargetBookingShell({
    excludeBookingId,
    bookingDate,
    bookingTime,
    durationMinutes,
  });

  const heldSet = new Set((heldResourceIds || []).map(String).filter(Boolean));
  const blockedResourceIds = [];

  for (const requirement of requirements) {
    if (requirement.mode === SCHEDULE_RESOURCE_MODES.FACILITY_LOCK) {
      // Concrete resource lists on the same schedule cover occupancy; this marker is for sync/UI.
      continue;
    }

    let effectiveBookings = dayBookings;
    if (requirement.mode === SCHEDULE_RESOURCE_MODES.FIXED && requirement.resourceIds.length) {
      const poolForRebalance = [
        ...new Set([
          ...(Array.isArray(rebalancePoolIds) ? rebalancePoolIds : []),
          ...requirement.resourceIds,
          ...requirement.pool,
          ...((dayBookings || []).flatMap((booking) =>
            (booking.booking_resource_assignments || [])
              .filter((row) => row.category_id === requirement.categoryId && row.resource_id)
              .map((row) => String(row.resource_id)),
          )),
        ].map(String).filter(Boolean)),
      ];
      // Classic pool is red/yellow/teal — ensure teal exists even if unused today.
      if (requirement.categoryId === 'party-rooms') {
        ['red-room', 'yellow-room', 'teal-room'].forEach((id) => {
          if (!poolForRebalance.includes(id)) poolForRebalance.push(id);
        });
      }
      effectiveBookings = buildDayBookingsWithFlexibleRebalance({
        dayBookings,
        targetBooking,
        categoryId: requirement.categoryId,
        requiredFixedIds: requirement.resourceIds,
        rebalancePoolIds: poolForRebalance,
        excludeBookingId,
        resourcePaddingById,
      });
    }

    const occupied = getOccupiedResourceIds({
      bookings: effectiveBookings,
      targetBooking,
      categoryId: requirement.categoryId,
      excludeBookingId,
      resourcePaddingById,
      resourceQuantityById,
    });

    heldSet.forEach((resourceId) => {
      if (!occupied.has(resourceId)) occupied.set(resourceId, { booking_number: 'hold' });
    });

    if (requirement.mode === SCHEDULE_RESOURCE_MODES.POOL) {
      const free = requirement.pool.filter((resourceId) => !occupied.has(resourceId));
      const validCombos = listValidPoolCombinations(requirement).filter((combo) =>
        combo.every((resourceId) => free.includes(resourceId)),
      );
      if (!validCombos.length || free.length < requirement.count) {
        return {
          ok: false,
          requirements,
          blockedResourceIds: requirement.pool.filter((id) => occupied.has(id)),
          occupied,
          freePoolCount: free.length,
          requiredCount: requirement.count,
          validCombinationCount: validCombos.length,
        };
      }
    } else {
      const blocked = requirement.resourceIds.filter((resourceId) => occupied.has(resourceId));
      if (blocked.length) {
        blockedResourceIds.push(...blocked);
        return {
          ok: false,
          requirements,
          requiredIds: requirement.resourceIds,
          blockedResourceIds: blocked,
          occupied,
        };
      }
    }
  }

  return {
    ok: true,
    requirements,
    blockedResourceIds,
  };
}

/**
 * Virtually move 1-room pool occupants off rooms needed by a fixed package.
 */
export function buildDayBookingsWithFlexibleRebalance({
  dayBookings = [],
  targetBooking,
  categoryId,
  requiredFixedIds = [],
  rebalancePoolIds = [],
  excludeBookingId = null,
  resourcePaddingById = new Map(),
} = {}) {
  const needed = [...new Set((requiredFixedIds || []).map(String).filter(Boolean))];
  const pool = [...new Set((rebalancePoolIds || []).map(String).filter(Boolean))];
  if (!needed.length || !pool.length || !targetBooking || !categoryId) {
    return dayBookings;
  }

  const bookings = (dayBookings || []).map((booking) => ({
    ...booking,
    booking_resource_assignments: [...(booking.booking_resource_assignments || [])],
  }));

  for (const booking of bookings) {
    if (!booking?.id || booking.id === excludeBookingId) continue;
    if (!ACTIVE_BOOKING_STATUSES_FOR_RESOURCE.includes(booking.status)) continue;
    if (!doResourceBookingsConflict(
      targetBooking,
      { beforeMinutes: 0, afterMinutes: 0 },
      booking,
      { beforeMinutes: 0, afterMinutes: 0 },
    )) continue;

    const held = booking.booking_resource_assignments
      .filter((row) => row.category_id === categoryId && row.resource_id)
      .map((row) => String(row.resource_id));
    if (held.length !== 1) continue;
    if (!pool.includes(held[0]) || !needed.includes(held[0])) continue;

    const occupied = getOccupiedResourceIds({
      bookings,
      targetBooking,
      categoryId,
      excludeBookingId,
      resourcePaddingById,
    });

    const destination = pool.find((resourceId) => {
      if (needed.includes(resourceId) || resourceId === held[0]) return false;
      const occupant = occupied.get(resourceId);
      return !occupant || occupant.id === booking.id;
    });
    if (!destination) continue;

    booking.booking_resource_assignments = booking.booking_resource_assignments.map((row) => (
      row.category_id === categoryId && String(row.resource_id) === held[0]
        ? { ...row, resource_id: destination }
        : row
    ));
  }

  return bookings;
}

/**
 * Score free pool rooms so auto-assign preserves capacity for fixed multi-room packages.
 * Rooms demanded by more peer fixed schedules at this time score higher (less preferred).
 */
export function scorePoolResourcesForAutoAssign({
  pool = [],
  peerFixedDemandByResourceId = new Map(),
} = {}) {
  return [...pool]
    .map((resourceId) => ({
      resourceId,
      demand: Number(peerFixedDemandByResourceId.get(resourceId) || 0),
    }))
    .sort((a, b) => {
      if (a.demand !== b.demand) return a.demand - b.demand;
      return String(a.resourceId).localeCompare(String(b.resourceId));
    });
}

/** Build demand map from peer schedules that use fixed room lists. */
export function buildPeerFixedResourceDemand({ peerSchedules = [] } = {}) {
  const demand = new Map();
  (peerSchedules || []).forEach((schedule) => {
    listScheduleResourceRequirements(schedule?.resource_assignments).forEach((requirement) => {
      if (requirement.mode !== SCHEDULE_RESOURCE_MODES.FIXED) return;
      requirement.resourceIds.forEach((resourceId) => {
        demand.set(resourceId, (demand.get(resourceId) || 0) + 1);
      });
    });
  });
  return demand;
}

/**
 * Peer fixed schedules whose window overlaps this booking (not just same start time).
 * Classic @ 4:00 must see Super @ 4:30 demand for red+yellow.
 */
export function filterPeerSchedulesOverlappingWindow({
  peerSchedules = [],
  bookingTime,
  durationMinutes = 90,
  peerDurationMinutes = 90,
  fixedOnly = true,
} = {}) {
  const target = {
    booking_time: bookingTime,
    duration_minutes: durationMinutes,
  };
  if (!bookingTime) return [];

  return (peerSchedules || []).filter((schedule) => {
    if (fixedOnly) {
      const hasFixed = listScheduleResourceRequirements(schedule?.resource_assignments).some(
        (row) => row.mode === SCHEDULE_RESOURCE_MODES.FIXED && row.resourceIds.length > 0,
      );
      if (!hasFixed) return false;
    }
    if (!schedule?.start_time) return false;
    return doBookingTimeRangesOverlap(target, {
      booking_time: schedule.start_time,
      duration_minutes: peerDurationMinutes,
    });
  });
}

/**
 * Resolve concrete resource rows for a schedule (fixed copy or pool auto-assign).
 * Returns { ok, assignments: [{categoryId, resourceId}], message? }.
 */
export function resolveConcreteResourceAssignmentsForSchedule({
  schedule,
  bookingDate,
  bookingTime,
  durationMinutes,
  dayBookings = [],
  excludeBookingId = null,
  heldResourceIds = [],
  preferredResourceIds = null,
  peerSchedules = [],
  resourcePaddingById = new Map(),
  resourceQuantityById = new Map(),
} = {}) {
  const requirements = listScheduleResourceRequirements(schedule?.resource_assignments);
  if (!requirements.length) {
    return { ok: true, assignments: [] };
  }

  const availability = areRequiredResourcesAvailableForSlot({
    schedule,
    bookingDate,
    bookingTime,
    durationMinutes,
    dayBookings,
    excludeBookingId,
    heldResourceIds,
    resourcePaddingById,
    resourceQuantityById,
  });
  if (!availability.ok) {
    return {
      ok: false,
      assignments: [],
      message:
        'Required party room(s) are not available for this time. Choose another time or package.',
    };
  }

  const targetBooking = buildTargetBookingShell({
    excludeBookingId,
    bookingDate,
    bookingTime,
    durationMinutes,
  });
  const heldSet = new Set((heldResourceIds || []).map(String).filter(Boolean));
  const preferred = [...new Set((preferredResourceIds || []).map(String).filter(Boolean))];
  const peerDemand = buildPeerFixedResourceDemand({ peerSchedules });
  const assignments = [];
  const claimed = new Set();

  for (const requirement of requirements) {
    if (requirement.mode === SCHEDULE_RESOURCE_MODES.FACILITY_LOCK) {
      continue;
    }

    const occupied = getOccupiedResourceIds({
      bookings: dayBookings,
      targetBooking,
      categoryId: requirement.categoryId,
      excludeBookingId,
      resourcePaddingById,
      resourceQuantityById,
    });
    heldSet.forEach((resourceId) => {
      if (!occupied.has(resourceId) && !claimed.has(resourceId)) {
        occupied.set(resourceId, { booking_number: 'hold' });
      }
    });
    claimed.forEach((resourceId) => {
      if (!occupied.has(resourceId)) occupied.set(resourceId, { booking_number: 'assigned' });
    });

    if (requirement.mode === SCHEDULE_RESOURCE_MODES.FIXED) {
      for (const resourceId of requirement.resourceIds) {
        if (occupied.has(resourceId) || claimed.has(resourceId)) {
          return {
            ok: false,
            assignments: [],
            message: 'A required party room is no longer available for this time.',
          };
        }
        assignments.push({ categoryId: requirement.categoryId, resourceId });
        claimed.add(resourceId);
      }
      continue;
    }

    const free = requirement.pool.filter(
      (resourceId) => !occupied.has(resourceId) && !claimed.has(resourceId),
    );
    const openCombos = listValidPoolCombinations(requirement).filter((combo) =>
      combo.every((resourceId) => free.includes(resourceId)),
    );

    if (!openCombos.length) {
      return {
        ok: false,
        assignments: [],
        message: requirement.allowedCombinations.length
          ? 'No allowed room combination is available for this time (rooms must be adjacent).'
          : 'Not enough party rooms are available for this time.',
      };
    }

    let bestCombo = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const combo of openCombos) {
      const preferredHits = combo.filter((id) => preferred.includes(id)).length;
      const peerCost = combo.reduce((sum, id) => sum + (peerDemand.get(String(id)) || 0), 0);
      // Prefer preferred rooms, then lowest peer demand (leave high-demand rooms free).
      const score = peerCost * 100 - preferredHits * 10;
      if (score < bestScore) {
        bestScore = score;
        bestCombo = combo;
      }
    }

    const picked = bestCombo || openCombos[0];
    if (!picked?.length) {
      return {
        ok: false,
        assignments: [],
        message: 'Could not auto-assign party rooms for this time.',
      };
    }

    picked.forEach((resourceId) => {
      assignments.push({ categoryId: requirement.categoryId, resourceId });
      claimed.add(resourceId);
    });
  }

  return { ok: true, assignments };
}
