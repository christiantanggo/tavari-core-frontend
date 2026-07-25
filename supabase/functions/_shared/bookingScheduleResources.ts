import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import dayjs from "https://esm.sh/dayjs@1.11.10";
import utc from "https://esm.sh/dayjs@1.11.10/plugin/utc";
import timezone from "https://esm.sh/dayjs@1.11.10/plugin/timezone";
import {
  listScheduleResourceRequirements,
  parseScheduleCategoryAssignment,
  resolveConcreteResourceAssignmentsForSchedule,
  serializeScheduleCategoryAssignment,
  type ConcreteAssignment,
} from "./bookingScheduleResourceRequirements.ts";

dayjs.extend(utc);
dayjs.extend(timezone);

type SupabaseClient = ReturnType<typeof createClient>;

type ActivityScheduleRow = {
  id?: string;
  activity_id?: string;
  day_of_week?: number;
  start_time?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  resource_assignments?: Record<string, unknown> | null;
};

const DEFAULT_BUSINESS_TIMEZONE = "America/Toronto";
const ACTIVE_STATUSES = ["pending", "confirmed", "checked_in"];

export function normalizeBookingScheduleTime(timeValue: unknown) {
  if (!timeValue) return "";
  const raw = String(timeValue).trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) return raw.substring(0, 5);
  const parsed = dayjs(`1970-01-01 ${raw}`, { strict: false });
  return parsed.isValid() ? parsed.format("HH:mm") : raw.substring(0, 5);
}

export function pickSchedulesForActivityOnDate(
  schedules: ActivityScheduleRow[],
  date: Date,
  businessTimezone: string,
) {
  if (!date || !Array.isArray(schedules) || schedules.length === 0) return [];

  const dayOfWeek = dayjs(date).tz(businessTimezone).day();
  const dateStr = dayjs(date).tz(businessTimezone).format("YYYY-MM-DD");
  const byDay = schedules.filter((schedule) => schedule.day_of_week === dayOfWeek);

  const dateSpecific: ActivityScheduleRow[] = [];
  const indefinite: ActivityScheduleRow[] = [];

  byDay.forEach((schedule) => {
    const hasRange = schedule.start_date || schedule.end_date;
    if (!hasRange) {
      indefinite.push(schedule);
      return;
    }

    const start = schedule.start_date ? dayjs(schedule.start_date).format("YYYY-MM-DD") : null;
    const end = schedule.end_date ? dayjs(schedule.end_date).format("YYYY-MM-DD") : null;

    if (start && end && dateStr >= start && dateStr <= end) {
      dateSpecific.push(schedule);
    } else if (start && !end && dateStr >= start) {
      dateSpecific.push(schedule);
    } else if (!start && end && dateStr <= end) {
      dateSpecific.push(schedule);
    }
  });

  const use = dateSpecific.length > 0 ? dateSpecific : indefinite;

  return use.slice().sort((a, b) => {
    const aTime = normalizeBookingScheduleTime(a.start_time);
    const bTime = normalizeBookingScheduleTime(b.start_time);
    return aTime.localeCompare(bTime);
  });
}

export function mergeScheduleResourceAssignments(schedules: ActivityScheduleRow[] = []) {
  const merged: Record<string, unknown> = {};

  schedules.forEach((schedule) => {
    const resourceAssignments = schedule?.resource_assignments;
    if (!resourceAssignments || typeof resourceAssignments !== "object") return;

    Object.entries(resourceAssignments).forEach(([categoryId, value]) => {
      const incoming = parseScheduleCategoryAssignment(value);
      const existingRaw = merged[categoryId];
      if (!existingRaw) {
        const serialized = serializeScheduleCategoryAssignment(incoming);
        if (serialized != null) merged[categoryId] = serialized;
        return;
      }

      const existing = parseScheduleCategoryAssignment(existingRaw);
      if (incoming.mode === "facility_lock" || existing.mode === "facility_lock") {
        merged[categoryId] = { mode: "facility_lock" };
        return;
      }
      if (incoming.mode === "pool" || existing.mode === "pool") {
        const pool = [...new Set([...(existing.pool || []), ...(incoming.pool || [])])];
        const count = Math.max(existing.count || 0, incoming.count || 0, 1);
        const nextCount = Math.min(count, pool.length || count);
        const existingCombos = existing.allowedCombinations || [];
        const incomingCombos = incoming.allowedCombinations || [];
        let allowed_combinations: string[][] | undefined;
        if (existingCombos.length || incomingCombos.length) {
          const keys = new Set(
            [...existingCombos, ...incomingCombos]
              .map((combo) => [...combo].map(String).sort().join("|"))
              .filter(Boolean),
          );
          // Keep combos that still fit the merged pool + count
          allowed_combinations = [...keys]
            .map((key) => key.split("|").filter(Boolean))
            .filter((combo) =>
              combo.length === nextCount && combo.every((id) => pool.includes(id)),
            );
        }
        merged[categoryId] = {
          mode: "pool",
          count: nextCount,
          pool,
          ...(allowed_combinations?.length ? { allowed_combinations } : {}),
        };
        return;
      }

      merged[categoryId] = [...new Set([
        ...(existing.resourceIds || []),
        ...(incoming.resourceIds || []),
      ])];
    });
  });

  return merged;
}

/** Fixed IDs only — pool must be resolved via resolveConcreteResourceAssignmentsForSchedule. */
export function flattenScheduleResourceAssignments(
  resourceAssignments: Record<string, unknown> | null | undefined,
) {
  if (!resourceAssignments || typeof resourceAssignments !== "object") return [];

  const out: ConcreteAssignment[] = [];
  Object.entries(resourceAssignments).forEach(([categoryId, value]) => {
    const parsed = parseScheduleCategoryAssignment(value);
    if (parsed.mode !== "fixed") return;
    parsed.resourceIds.forEach((resourceId) => {
      if (categoryId && resourceId) out.push({ categoryId, resourceId });
    });
  });

  return out;
}

export function findMatchingScheduleSlots(
  schedules: ActivityScheduleRow[],
  bookingDate: string,
  bookingTime: string,
  businessTimezone: string,
) {
  if (!bookingDate || !bookingTime) return [];

  const date = dayjs.tz(bookingDate, businessTimezone).toDate();
  const daySchedules = pickSchedulesForActivityOnDate(schedules, date, businessTimezone);
  const targetTime = normalizeBookingScheduleTime(bookingTime);

  return daySchedules.filter(
    (schedule) => normalizeBookingScheduleTime(schedule.start_time) === targetTime,
  );
}

export async function fetchActivitySchedules(
  supabase: SupabaseClient,
  businessId: string,
  activityId: string,
) {
  const { data, error } = await supabase
    .from("booking_activity_schedules")
    .select("id, activity_id, day_of_week, start_time, start_date, end_date, resource_assignments")
    .eq("business_id", businessId)
    .eq("activity_id", activityId)
    .eq("is_active", true);

  if (error) throw error;
  return (data || []) as ActivityScheduleRow[];
}

export async function getBusinessTimezone(
  supabase: SupabaseClient,
  businessId: string,
) {
  const { data } = await supabase
    .from("businesses")
    .select("timezone")
    .eq("id", businessId)
    .maybeSingle();

  const timezoneValue = typeof data?.timezone === "string" ? data.timezone.trim() : "";
  return timezoneValue || DEFAULT_BUSINESS_TIMEZONE;
}

export async function fetchDayBookingsWithResources(
  supabase: SupabaseClient,
  businessId: string,
  bookingDate: string,
  excludeBookingId: string | null = null,
) {
  let query = supabase
    .from("bookings")
    .select(`
      id,
      status,
      booking_time,
      duration_minutes,
      activity_id,
      booking_activities ( duration_minutes ),
      booking_resource_assignments ( category_id, resource_id )
    `)
    .eq("business_id", businessId)
    .eq("booking_date", bookingDate)
    .in("status", ACTIVE_STATUSES);

  if (excludeBookingId) {
    query = query.neq("id", excludeBookingId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function fetchPeerSchedulesForSlot(
  supabase: SupabaseClient,
  businessId: string,
  bookingDate: string,
  bookingTime: string,
  excludeActivityId: string | null = null,
  durationMinutes: number | null = 90,
) {
  const businessTimezone = await getBusinessTimezone(supabase, businessId);
  const { data, error } = await supabase
    .from("booking_activity_schedules")
    .select("id, activity_id, day_of_week, start_time, start_date, end_date, resource_assignments")
    .eq("business_id", businessId)
    .eq("is_active", true);

  if (error) throw error;

  const date = dayjs.tz(bookingDate, businessTimezone).toDate();
  const targetDuration = Number(durationMinutes) > 0 ? Number(durationMinutes) : 90;
  const targetStart = normalizeBookingScheduleTime(bookingTime);
  const targetStartMins = (() => {
    const m = targetStart.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  })();
  if (targetStartMins == null) return [];

  const targetEndMins = targetStartMins + targetDuration;

  return ((data || []) as ActivityScheduleRow[]).filter((schedule) => {
    if (excludeActivityId && schedule.activity_id === excludeActivityId) return false;
    const daySchedules = pickSchedulesForActivityOnDate([schedule], date, businessTimezone);
    if (!daySchedules.length) return false;

    const hasFixed = listScheduleResourceRequirements(
      (schedule.resource_assignments || {}) as Record<string, unknown>,
    ).some((row) => row.mode === "fixed" && row.resourceIds.length > 0);
    if (!hasFixed) return false;

    const peerTime = normalizeBookingScheduleTime(schedule.start_time);
    const peerMatch = peerTime.match(/^(\d{1,2}):(\d{2})$/);
    if (!peerMatch) return false;
    const peerStart = Number(peerMatch[1]) * 60 + Number(peerMatch[2]);
    const peerEnd = peerStart + 90; // party packages are 90 minutes
    return targetStartMins < peerEnd && peerStart < targetEndMins;
  });
}

export async function applyConcreteResourceAssignmentsToBooking(
  supabase: SupabaseClient,
  bookingId: string,
  businessId: string,
  assignments: ConcreteAssignment[],
  source: "schedule" | "manual" | "override" = "schedule",
) {
  if (!assignments.length) return;

  const now = new Date().toISOString();
  const rows = assignments.map(({ categoryId, resourceId }) => ({
    business_id: businessId,
    booking_id: bookingId,
    category_id: categoryId,
    resource_id: resourceId,
    source,
    created_at: now,
    updated_at: now,
  }));

  const { error } = await supabase.from("booking_resource_assignments").insert(rows);
  if (error) throw error;
}

/**
 * Move overlapping pool/flexible bookings off rooms needed by a fixed multi-room package
 * (e.g. Classic on red → teal so Super can take red+yellow).
 */
async function rebalancePoolOccupantsOffNeededRooms(
  supabase: SupabaseClient,
  {
    businessId,
    bookingDate,
    bookingTime,
    durationMinutes,
    neededResourceIds,
    dayBookings,
    excludeBookingId = null,
  }: {
    businessId: string;
    bookingDate: string;
    bookingTime: string;
    durationMinutes?: number | null;
    neededResourceIds: string[];
    dayBookings: Array<Record<string, unknown>>;
    excludeBookingId?: string | null;
  },
) {
  const needed = new Set((neededResourceIds || []).map(String).filter(Boolean));
  if (!needed.size) return;

  const businessTimezone = await getBusinessTimezone(supabase, businessId);
  const mutableBookings = [...(dayBookings || [])];

  for (const booking of [...mutableBookings]) {
    if (!booking?.id || booking.id === excludeBookingId) continue;
    const assignments = Array.isArray(booking.booking_resource_assignments)
      ? (booking.booking_resource_assignments as Array<Record<string, unknown>>)
      : [];
    const conflicting = assignments.filter((row) => needed.has(String(row.resource_id || "")));
    if (!conflicting.length) continue;

    const activityId = String(booking.activity_id || "");
    if (!activityId) continue;

    const schedules = await fetchActivitySchedules(supabase, businessId, activityId);
    const matches = findMatchingScheduleSlots(
      schedules,
      bookingDate,
      String(booking.booking_time || bookingTime),
      businessTimezone,
    );
    const merged = mergeScheduleResourceAssignments(matches);
    const requirements = listScheduleResourceRequirements(merged);
    const isFlexiblePool = requirements.some((row) => row.mode === "pool");
    if (!isFlexiblePool) continue;

    // Build a temporary day view where this booking no longer holds its rooms.
    const withoutThis = mutableBookings.map((row) => {
      if (row.id !== booking.id) return row;
      return { ...row, booking_resource_assignments: [] };
    });

    const reassigned = resolveConcreteResourceAssignmentsForSchedule({
      schedule: { resource_assignments: merged },
      bookingDate,
      bookingTime: normalizeBookingScheduleTime(booking.booking_time) || String(booking.booking_time || ""),
      durationMinutes:
        Number(booking.duration_minutes) ||
        Number((booking.booking_activities as { duration_minutes?: number } | null)?.duration_minutes) ||
        durationMinutes ||
        90,
      dayBookings: withoutThis,
      excludeBookingId: String(booking.id),
      // Prefer rooms not needed by the incoming fixed package.
      preferredResourceIds: requirements
        .flatMap((row) => row.pool)
        .filter((id) => !needed.has(id)),
    });

    if (!reassigned.ok || !reassigned.assignments.length) continue;
    if (reassigned.assignments.some((row) => needed.has(row.resourceId))) continue;

    await supabase
      .from("booking_resource_assignments")
      .delete()
      .eq("booking_id", booking.id)
      .eq("business_id", businessId);

    await applyConcreteResourceAssignmentsToBooking(
      supabase,
      String(booking.id),
      businessId,
      reassigned.assignments,
      "schedule",
    );

    // Update local snapshot for subsequent conflict checks in this loop.
    const idx = mutableBookings.findIndex((row) => row.id === booking.id);
    if (idx >= 0) {
      mutableBookings[idx] = {
        ...mutableBookings[idx],
        booking_resource_assignments: reassigned.assignments.map((row) => ({
          category_id: row.categoryId,
          resource_id: row.resourceId,
        })),
      };
    }
  }
}

export async function applyScheduleResourceAssignmentsToBooking(
  supabase: SupabaseClient,
  bookingId: string,
  businessId: string,
  resourceAssignments: Record<string, unknown> | null | undefined,
  source: "schedule" | "manual" | "override" = "schedule",
) {
  const flat = flattenScheduleResourceAssignments(resourceAssignments);
  if (flat.length === 0) return;
  await applyConcreteResourceAssignmentsToBooking(
    supabase,
    bookingId,
    businessId,
    flat,
    source,
  );
}

export async function syncBookingResourcesFromActivitySchedule(
  supabase: SupabaseClient,
  {
    businessId,
    activityId,
    bookingId,
    bookingDate,
    bookingTime,
    durationMinutes = null,
    replaceExisting = false,
    preferredResourceIds = null,
  }: {
    businessId: string;
    activityId: string;
    bookingId: string;
    bookingDate: string;
    bookingTime: string;
    durationMinutes?: number | null;
    replaceExisting?: boolean;
    preferredResourceIds?: string[] | null;
  },
) {
  const businessTimezone = await getBusinessTimezone(supabase, businessId);
  const schedules = await fetchActivitySchedules(supabase, businessId, activityId);
  const matches = findMatchingScheduleSlots(
    schedules,
    bookingDate,
    bookingTime,
    businessTimezone,
  );
  if (!matches.length) return { ok: true as const, assignments: [] as ConcreteAssignment[] };

  const merged = mergeScheduleResourceAssignments(matches);
  const requirements = listScheduleResourceRequirements(merged);
  if (!requirements.length) return { ok: true as const, assignments: [] as ConcreteAssignment[] };

  const [dayBookings, peerSchedules] = await Promise.all([
    fetchDayBookingsWithResources(supabase, businessId, bookingDate, bookingId),
    fetchPeerSchedulesForSlot(
      supabase,
      businessId,
      bookingDate,
      bookingTime,
      activityId,
      durationMinutes,
    ),
  ]);

  // If this package needs specific rooms, try moving flexible (pool) bookings off those rooms first.
  const neededFixedIds = requirements
    .filter((row) => row.mode === "fixed")
    .flatMap((row) => row.resourceIds);
  if (neededFixedIds.length) {
    await rebalancePoolOccupantsOffNeededRooms(supabase, {
      businessId,
      bookingDate,
      bookingTime,
      durationMinutes,
      neededResourceIds: neededFixedIds,
      dayBookings,
      excludeBookingId: bookingId,
    });
  }

  const refreshedDayBookings = neededFixedIds.length
    ? await fetchDayBookingsWithResources(supabase, businessId, bookingDate, bookingId)
    : dayBookings;

  const resolved = resolveConcreteResourceAssignmentsForSchedule({
    schedule: { resource_assignments: merged },
    bookingDate,
    bookingTime,
    durationMinutes,
    dayBookings: refreshedDayBookings,
    excludeBookingId: bookingId,
    preferredResourceIds,
    peerSchedules,
  });

  if (!resolved.ok) {
    throw new Error(resolved.message || "Required party rooms are unavailable for this time.");
  }

  if (replaceExisting) {
    await supabase
      .from("booking_resource_assignments")
      .delete()
      .eq("booking_id", bookingId)
      .eq("business_id", businessId);
  }

  await applyConcreteResourceAssignmentsToBooking(
    supabase,
    bookingId,
    businessId,
    resolved.assignments,
    "schedule",
  );

  return resolved;
}

export async function assertScheduleResourcesAvailableForSlot(
  supabase: SupabaseClient,
  {
    businessId,
    activityId,
    bookingDate,
    bookingTime,
    durationMinutes = null,
    excludeBookingId = null,
    heldResourceIds = [],
  }: {
    businessId: string;
    activityId: string;
    bookingDate: string;
    bookingTime: string;
    durationMinutes?: number | null;
    excludeBookingId?: string | null;
    heldResourceIds?: string[];
  },
) {
  const businessTimezone = await getBusinessTimezone(supabase, businessId);
  const schedules = await fetchActivitySchedules(supabase, businessId, activityId);
  const matches = findMatchingScheduleSlots(
    schedules,
    bookingDate,
    bookingTime,
    businessTimezone,
  );
  if (!matches.length) return { ok: true as const, assignments: [] as ConcreteAssignment[] };

  const merged = mergeScheduleResourceAssignments(matches);
  if (!listScheduleResourceRequirements(merged).length) {
    return { ok: true as const, assignments: [] as ConcreteAssignment[] };
  }

  const [dayBookings, peerSchedules] = await Promise.all([
    fetchDayBookingsWithResources(supabase, businessId, bookingDate, excludeBookingId),
    fetchPeerSchedulesForSlot(
      supabase,
      businessId,
      bookingDate,
      bookingTime,
      activityId,
      durationMinutes,
    ),
  ]);

  const requirements = listScheduleResourceRequirements(merged);
  const neededFixedIds = requirements
    .filter((row) => row.mode === "fixed")
    .flatMap((row) => row.resourceIds);

  let workingDayBookings = dayBookings;
  if (neededFixedIds.length) {
    await rebalancePoolOccupantsOffNeededRooms(supabase, {
      businessId,
      bookingDate,
      bookingTime,
      durationMinutes,
      neededResourceIds: neededFixedIds,
      dayBookings,
      excludeBookingId,
    });
    workingDayBookings = await fetchDayBookingsWithResources(
      supabase,
      businessId,
      bookingDate,
      excludeBookingId,
    );
  }

  return resolveConcreteResourceAssignmentsForSchedule({
    schedule: { resource_assignments: merged },
    bookingDate,
    bookingTime,
    durationMinutes,
    dayBookings: workingDayBookings,
    excludeBookingId,
    heldResourceIds,
    peerSchedules,
  });
}
