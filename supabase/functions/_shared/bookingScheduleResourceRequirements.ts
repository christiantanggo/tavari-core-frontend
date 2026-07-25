/**
 * Edge copy of schedule resource requirement parsing + concrete assignment resolution.
 * Keep in sync with src/helpers/Bookings/bookingScheduleResourceRequirements.js
 * and bookingResourceAvailability.js resolveConcreteResourceAssignmentsForSchedule.
 */
export type ScheduleResourceMode = "fixed" | "pool" | "facility_lock";

export type ParsedCategoryAssignment = {
  mode: ScheduleResourceMode;
  count: number;
  resourceIds: string[];
  pool: string[];
  allowedCombinations: string[][];
};

export type ConcreteAssignment = { categoryId: string; resourceId: string };

export const FACILITY_LOCK_CATEGORY_ID = "__facility__";

function normalizeResourceIdList(ids: unknown[] = []) {
  return [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
}

function normalizeCombinationKey(ids: unknown[] = []) {
  return normalizeResourceIdList(ids as string[]).slice().sort().join("|");
}

function parseAllowedCombinations(raw: unknown, pool: string[] = [], count = 1) {
  if (!Array.isArray(raw) || !raw.length) return [] as string[][];
  const poolSet = new Set(normalizeResourceIdList(pool));
  const seen = new Set<string>();
  const out: string[][] = [];
  raw.forEach((entry) => {
    const combo = normalizeResourceIdList(Array.isArray(entry) ? entry : []);
    if (combo.length !== count) return;
    if (combo.some((id) => !poolSet.has(id))) return;
    const key = normalizeCombinationKey(combo);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(combo.slice().sort());
  });
  return out;
}

/** All unordered combinations of size k from items. */
export function listCombinationsOfSize(items: string[] = [], size = 1) {
  const pool = normalizeResourceIdList(items);
  const k = Math.max(1, Math.min(pool.length || 1, Number.parseInt(String(size), 10) || 1));
  if (k === 1) return pool.map((id) => [id]);
  if (k >= pool.length) return pool.length ? [pool.slice()] : [];

  const out: string[][] = [];
  const walk = (start: number, chosen: string[]) => {
    if (chosen.length === k) {
      out.push(chosen.slice());
      return;
    }
    for (let i = start; i < pool.length; i += 1) {
      chosen.push(pool[i]);
      walk(i + 1, chosen);
      chosen.pop();
    }
  };
  walk(0, []);
  return out;
}

export function listValidPoolCombinations(requirement: ParsedCategoryAssignment & { categoryId?: string }) {
  if (!requirement || requirement.mode !== "pool") return [] as string[][];
  const pool = normalizeResourceIdList(requirement.pool);
  const count = Math.max(1, Math.min(pool.length || 1, Number.parseInt(String(requirement.count), 10) || 1));
  const allowed = parseAllowedCombinations(requirement.allowedCombinations, pool, count);
  if (allowed.length) return allowed;
  return listCombinationsOfSize(pool, count);
}

export function parseScheduleCategoryAssignment(value: unknown): ParsedCategoryAssignment {
  if (value == null) {
    return { mode: "fixed", count: 0, resourceIds: [], pool: [], allowedCombinations: [] };
  }

  if (Array.isArray(value)) {
    const resourceIds = normalizeResourceIdList(value);
    return { mode: "fixed", count: resourceIds.length, resourceIds, pool: resourceIds, allowedCombinations: [] };
  }

  if (typeof value === "string" || typeof value === "number") {
    const id = String(value).trim();
    const resourceIds = id ? [id] : [];
    return { mode: "fixed", count: resourceIds.length, resourceIds, pool: resourceIds, allowedCombinations: [] };
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.mode === "facility_lock") {
      return { mode: "facility_lock", count: 1, resourceIds: [], pool: [], allowedCombinations: [] };
    }

    const mode = obj.mode === "pool" ? "pool" : "fixed";
    if (mode === "pool") {
      const poolSource = Array.isArray(obj.pool)
        ? obj.pool
        : Array.isArray(obj.resourceIds)
          ? obj.resourceIds
          : [];
      const pool = normalizeResourceIdList(poolSource);
      const count = Math.max(1, Math.min(pool.length || 1, Number.parseInt(String(obj.count ?? 1), 10) || 1));
      const allowedCombinations = parseAllowedCombinations(
        obj.allowed_combinations || obj.allowedCombinations,
        pool,
        count,
      );
      return { mode: "pool", count, resourceIds: [], pool, allowedCombinations };
    }
    const fixedSource = Array.isArray(obj.resourceIds)
      ? obj.resourceIds
      : Array.isArray(obj.pool)
        ? obj.pool
        : [];
    const resourceIds = normalizeResourceIdList(fixedSource);
    return { mode: "fixed", count: resourceIds.length, resourceIds, pool: resourceIds, allowedCombinations: [] };
  }

  return { mode: "fixed", count: 0, resourceIds: [], pool: [], allowedCombinations: [] };
}

export function serializeScheduleCategoryAssignment(parsed: ParsedCategoryAssignment) {
  if (!parsed) return null;

  if (parsed.mode === "facility_lock") {
    return { mode: "facility_lock" as const };
  }

  if (parsed.count <= 0) return null;

  if (parsed.mode === "pool") {
    const pool = normalizeResourceIdList(parsed.pool);
    if (!pool.length) return null;
    const count = Math.max(1, Math.min(pool.length, Number.parseInt(String(parsed.count), 10) || 1));
    const allowedCombinations = parseAllowedCombinations(parsed.allowedCombinations, pool, count);
    const out: Record<string, unknown> = {
      mode: "pool" as const,
      count,
      pool,
    };
    if (allowedCombinations.length) {
      out.allowed_combinations = allowedCombinations;
    }
    return out;
  }
  const resourceIds = normalizeResourceIdList(parsed.resourceIds || parsed.pool);
  return resourceIds.length ? resourceIds : null;
}

export function listScheduleResourceRequirements(
  resourceAssignments: Record<string, unknown> | null | undefined,
) {
  if (!resourceAssignments || typeof resourceAssignments !== "object") return [];
  return Object.entries(resourceAssignments)
    .map(([categoryId, value]) => ({
      categoryId,
      ...parseScheduleCategoryAssignment(value),
    }))
    .filter((row) => {
      if (row.mode === "facility_lock") return true;
      return row.count > 0 && (row.pool.length > 0 || row.resourceIds.length > 0);
    });
}

function timeToMinutes(value: unknown) {
  if (!value) return null;
  const raw = String(value).trim();
  const ampm = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (ampm) {
    let hour = Number.parseInt(ampm[1], 10);
    const minute = Number.parseInt(ampm[2], 10);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    const suffix = ampm[3].toUpperCase();
    if (suffix === "AM") {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }
    return hour * 60 + minute;
  }
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
}

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
) {
  return aStart < bEnd && bStart < aEnd;
}

function bookingWindowMinutes(booking: {
  booking_time?: string | null;
  duration_minutes?: number | null;
  booking_activities?: { duration_minutes?: number | null } | null;
}) {
  const start = timeToMinutes(booking?.booking_time);
  if (start == null) return null;
  const duration = Math.max(
    15,
    Number(booking?.duration_minutes) ||
      Number(booking?.booking_activities?.duration_minutes) ||
      90,
  );
  return { start, end: start + duration };
}

export function getOccupiedResourceIdsForWindow({
  dayBookings = [],
  bookingDate,
  bookingTime,
  durationMinutes,
  categoryId,
  excludeBookingId = null,
  heldResourceIds = [],
}: {
  dayBookings?: Array<Record<string, unknown>>;
  bookingDate: string;
  bookingTime: string;
  durationMinutes?: number | null;
  categoryId: string;
  excludeBookingId?: string | null;
  heldResourceIds?: string[];
}) {
  const occupied = new Set<string>();
  const target = bookingWindowMinutes({
    booking_time: bookingTime,
    duration_minutes: durationMinutes,
  });
  if (!target) return occupied;

  (heldResourceIds || []).forEach((id) => {
    if (id) occupied.add(String(id));
  });

  (dayBookings || []).forEach((booking) => {
    if (!booking || booking.id === excludeBookingId) return;
    const status = String(booking.status || "");
    if (!["pending", "confirmed", "checked_in"].includes(status)) return;
    const other = bookingWindowMinutes({
      booking_time: booking.booking_time as string,
      duration_minutes: booking.duration_minutes as number,
      booking_activities: booking.booking_activities as { duration_minutes?: number },
    });
    if (!other) return;
    if (!rangesOverlap(target.start, target.end, other.start, other.end)) return;

    const assignments = Array.isArray(booking.booking_resource_assignments)
      ? booking.booking_resource_assignments
      : [];
    assignments.forEach((assignment: Record<string, unknown>) => {
      if (String(assignment.category_id || "") !== categoryId) return;
      const resourceId = String(assignment.resource_id || "").trim();
      if (resourceId) occupied.add(resourceId);
    });
  });

  return occupied;
}

export function buildPeerFixedResourceDemand(peerSchedules: Array<{ resource_assignments?: Record<string, unknown> | null }> = []) {
  const demand = new Map<string, number>();
  peerSchedules.forEach((schedule) => {
    listScheduleResourceRequirements(schedule?.resource_assignments).forEach((requirement) => {
      if (requirement.mode !== "fixed") return;
      requirement.resourceIds.forEach((resourceId) => {
        demand.set(resourceId, (demand.get(resourceId) || 0) + 1);
      });
    });
  });
  return demand;
}

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
}: {
  schedule: { resource_assignments?: Record<string, unknown> | null };
  bookingDate: string;
  bookingTime: string;
  durationMinutes?: number | null;
  dayBookings?: Array<Record<string, unknown>>;
  excludeBookingId?: string | null;
  heldResourceIds?: string[];
  preferredResourceIds?: string[] | null;
  peerSchedules?: Array<{ resource_assignments?: Record<string, unknown> | null }>;
}) {
  const requirements = listScheduleResourceRequirements(schedule?.resource_assignments);
  if (!requirements.length) return { ok: true as const, assignments: [] as ConcreteAssignment[] };

  const preferred = [...new Set((preferredResourceIds || []).map(String).filter(Boolean))];
  const peerDemand = buildPeerFixedResourceDemand(peerSchedules);
  const assignments: ConcreteAssignment[] = [];
  const claimed = new Set<string>();

  for (const requirement of requirements) {
    if (requirement.mode === "facility_lock") {
      continue;
    }

    const occupied = getOccupiedResourceIdsForWindow({
      dayBookings,
      bookingDate,
      bookingTime,
      durationMinutes,
      categoryId: requirement.categoryId,
      excludeBookingId,
      heldResourceIds,
    });
    claimed.forEach((id) => occupied.add(id));

    if (requirement.mode === "fixed") {
      for (const resourceId of requirement.resourceIds) {
        if (occupied.has(resourceId) || claimed.has(resourceId)) {
          return {
            ok: false as const,
            assignments: [] as ConcreteAssignment[],
            message: "A required party room is no longer available for this time.",
          };
        }
        assignments.push({ categoryId: requirement.categoryId, resourceId });
        claimed.add(resourceId);
      }
      continue;
    }

    const free = requirement.pool.filter((id) => !occupied.has(id) && !claimed.has(id));
    const openCombos = listValidPoolCombinations(requirement).filter((combo) =>
      combo.every((resourceId) => free.includes(resourceId)),
    );

    if (!openCombos.length) {
      return {
        ok: false as const,
        assignments: [] as ConcreteAssignment[],
        message: requirement.allowedCombinations.length
          ? "No allowed room combination is available for this time (rooms must be adjacent)."
          : "Not enough party rooms are available for this time.",
      };
    }

    let bestCombo: string[] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const combo of openCombos) {
      const preferredHits = combo.filter((id) => preferred.includes(id)).length;
      const peerCost = combo.reduce((sum, id) => sum + (peerDemand.get(String(id)) || 0), 0);
      const score = peerCost * 100 - preferredHits * 10;
      if (score < bestScore) {
        bestScore = score;
        bestCombo = combo;
      }
    }

    const picked = bestCombo || openCombos[0];
    if (!picked?.length) {
      return {
        ok: false as const,
        assignments: [] as ConcreteAssignment[],
        message: "Could not auto-assign party rooms for this time.",
      };
    }

    picked.forEach((resourceId) => {
      assignments.push({ categoryId: requirement.categoryId, resourceId });
      claimed.add(resourceId);
    });
  }

  return { ok: true as const, assignments };
}
