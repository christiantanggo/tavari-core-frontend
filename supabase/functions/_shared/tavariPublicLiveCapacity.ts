/** Live walk-in capacity messaging for external websites (OTWK). */

import {
  BOOKING_AVAILABILITY_SCHEDULE_COLS,
  buildDateAvailability,
  formatDateInTimeZone,
  normalizeScheduleTime,
  parseOccupancyMap,
  pickSchedulesForActivityOnDate,
  resolveHostPortalUrl,
  scheduleSlotTotalSpaces,
  type ScheduleRow,
} from "./tavariPublicBookingAvailability.ts";
import { resolveActivityPortalUrl } from "./tavariPublicBookingCatalog.ts";

export type OccupancyBand = "closed" | "quiet" | "moderate" | "busy" | "full" | "unknown";

export type LiveCapacityPeakWindow = {
  time: string;
  occupied: number;
  totalCapacity: number;
  fillPercent: number;
  label: string;
};

export type LiveCapacitySnapshot = {
  ok: true;
  businessId: string;
  timezone: string;
  asOf: string;
  date: string;
  isOpenNow: boolean;
  openUntil: string | null;
  activityId: string | null;
  typeKey: string;
  occupancyBand: OccupancyBand;
  occupancyPercent: number | null;
  onSiteUnits: number;
  scheduledUnitsToday: number;
  maxCapacity: number | null;
  remainingCapacity: number | null;
  currentSlot: {
    time: string;
    occupied: number;
    totalCapacity: number;
    remaining: number;
    fillPercent: number;
  } | null;
  estimatedWait: string;
  walkInMessage: string;
  peakWindowsToday: LiveCapacityPeakWindow[];
  bookingCta: {
    label: string;
    portalUrl: string;
    recommended: boolean;
  };
};

type DayHours = { open?: string; close?: string; closed?: boolean };
type OperatingHours = Record<string, DayHours>;

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

function parseTimeToMinutes(value: string): number | null {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const read = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const weekday = read("weekday").toLowerCase();
  const hour = Number(read("hour"));
  const minute = Number(read("minute"));
  return {
    dayKey: DAY_KEYS.find((k) => k === weekday) ?? "sunday",
    minutes: hour * 60 + minute,
  };
}

function resolveTodayHours(
  operatingHours: OperatingHours | null | undefined,
  holidayHours: unknown,
  dateStr: string,
  timeZone: string,
): { closed: boolean; open?: string; close?: string } {
  if (Array.isArray(holidayHours)) {
    for (const row of holidayHours) {
      if (!row || typeof row !== "object") continue;
      const h = row as { date?: string; closed?: boolean; hours?: { open?: string; close?: string } };
      if (String(h.date || "").slice(0, 10) !== dateStr) continue;
      if (h.closed === true) return { closed: true };
      if (h.hours?.open && h.hours?.close) return { closed: false, open: h.hours.open, close: h.hours.close };
    }
  }

  const dayKey = DAY_KEYS[dayOfWeekIndex(dateStr, timeZone)];
  const day = operatingHours?.[dayKey];
  if (!day) return { closed: true };
  if (day.closed === true) return { closed: true };
  if (day.open && day.close) return { closed: false, open: day.open, close: day.close };
  return { closed: true };
}

function dayOfWeekIndex(dateStr: string, timeZone: string): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(
    new Date(`${dateStr}T12:00:00`),
  );
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? 0;
}

export function resolveOpenNow(
  operatingHours: OperatingHours | null | undefined,
  holidayHours: unknown,
  dateStr: string,
  timeZone: string,
  now = new Date(),
): { isOpenNow: boolean; openUntil: string | null } {
  const todayHours = resolveTodayHours(operatingHours, holidayHours, dateStr, timeZone);
  if (todayHours.closed || !todayHours.open || !todayHours.close) {
    return { isOpenNow: false, openUntil: null };
  }

  const openMin = parseTimeToMinutes(todayHours.open);
  const closeMin = parseTimeToMinutes(todayHours.close);
  const { minutes } = getZonedParts(now, timeZone);
  if (openMin == null || closeMin == null) return { isOpenNow: false, openUntil: null };

  const isOpenNow = closeMin > openMin
    ? minutes >= openMin && minutes < closeMin
    : minutes >= openMin || minutes < closeMin;

  return { isOpenNow, openUntil: todayHours.close };
}

function bandFromPercent(percent: number | null, remaining: number | null, maxCapacity: number | null): OccupancyBand {
  if (percent == null) return "unknown";
  if (remaining != null && remaining <= 0) return "full";
  if (maxCapacity != null && remaining != null && maxCapacity > 0 && remaining <= Math.max(3, Math.floor(maxCapacity * 0.05))) {
    return "full";
  }
  if (percent >= 90) return "full";
  if (percent >= 70) return "busy";
  if (percent >= 40) return "moderate";
  return "quiet";
}

function estimateWait(band: OccupancyBand, isOpenNow: boolean): string {
  if (!isOpenNow || band === "closed") return "We are currently closed.";
  if (band === "quiet") return "Little to no wait at the counter right now.";
  if (band === "moderate") return "A short check-in wait is possible.";
  if (band === "busy") return "Allow about 10–15 minutes at the counter — booking online saves time.";
  if (band === "full") return "Walk-in capacity is very limited — book online for the best chance today.";
  return "Walk-ins welcome subject to capacity.";
}

function buildWalkInMessage(band: OccupancyBand, isOpenNow: boolean, remaining: number | null): string {
  if (!isOpenNow || band === "closed") {
    return "Walk-ins welcome during open hours — check today's hours before you visit.";
  }
  if (band === "full") {
    return "Walk-ins are welcome when we have capacity — we are near capacity now, so booking online is strongly recommended.";
  }
  if (band === "busy") {
    return "Walk-ins welcome — it is busy right now, so booking online is recommended to save time at the counter.";
  }
  if (band === "moderate") {
    return "Walk-ins welcome — moderate traffic right now. Booking online still saves time at check-in.";
  }
  return "Walk-ins welcome — plenty of capacity right now. Booking online saves a little time at the counter.";
}

function formatPeakLabel(time: string): string {
  const [hourRaw, minuteRaw] = time.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isFinite(hour)) return time;
  const period = hour >= 12 ? "pm" : "am";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return minute > 0 ? `${h12}:${String(minute).padStart(2, "0")}${period}` : `${h12}${period}`;
}

function pickCurrentSlot(
  slots: Array<{ time: string; occupied: number; totalCapacity: number; remaining: number }>,
  nowMinutes: number,
) {
  let current: typeof slots[number] | null = null;
  for (const slot of slots) {
    const start = parseTimeToMinutes(slot.time);
    if (start == null || start > nowMinutes) continue;
    if (!current || start >= parseTimeToMinutes(current.time)!) current = slot;
  }
  return current;
}

function buildPeakWindows(
  slots: Array<{ time: string; occupied: number; totalCapacity: number; remaining: number }>,
  nowMinutes: number,
): LiveCapacityPeakWindow[] {
  return slots
    .filter((slot) => {
      const start = parseTimeToMinutes(slot.time);
      return start != null && start >= nowMinutes && slot.totalCapacity > 0;
    })
    .map((slot) => {
      const fillPercent = Math.round((slot.occupied / slot.totalCapacity) * 100);
      return {
        time: slot.time,
        occupied: slot.occupied,
        totalCapacity: slot.totalCapacity,
        fillPercent,
        label: formatPeakLabel(slot.time),
      };
    })
    .sort((a, b) => b.fillPercent - a.fillPercent || a.time.localeCompare(b.time))
    .slice(0, 3);
}

export async function loadLiveCapacitySnapshot(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  options: { typeKey?: string; activityId?: string } = {},
): Promise<LiveCapacitySnapshot> {
  const typeKey = (options.typeKey || "drop_in_play").trim().toLowerCase();

  const { data: business, error: bizErr } = await supabase
    .from("businesses")
    .select("timezone, operating_hours, holiday_hours")
    .eq("id", businessId)
    .maybeSingle();
  if (bizErr) throw bizErr;

  const timeZone = String(business?.timezone || "America/Toronto").trim() || "America/Toronto";
  const now = new Date();
  const today = formatDateInTimeZone(now, timeZone);
  const { isOpenNow, openUntil } = resolveOpenNow(
    business?.operating_hours as OperatingHours,
    business?.holiday_hours,
    today,
    timeZone,
    now,
  );

  const { data: snapshotRaw, error: snapErr } = await supabase.rpc("booking_get_live_capacity_snapshot", {
    p_business_id: businessId,
    p_booking_date: today,
    p_type_key: typeKey,
  });
  if (snapErr) throw snapErr;

  const snapshot = (snapshotRaw || {}) as Record<string, unknown>;
  const activityId = String(options.activityId || snapshot.activityId || "").trim() || null;
  const onSiteUnits = Number(snapshot.onSiteUnits || 0);
  const scheduledUnitsToday = Number(snapshot.scheduledUnitsToday || 0);
  const categoryMax = snapshot.categoryMaxCapacity != null ? Number(snapshot.categoryMaxCapacity) : null;
  const categoryRemaining = snapshot.categoryRemaining != null ? Number(snapshot.categoryRemaining) : null;

  let slots: Array<{ time: string; occupied: number; totalCapacity: number; remaining: number }> = [];
  let scheduleTotalCapacity = 0;

  if (activityId) {
    const { data: scheduleRows } = await supabase
      .from("booking_activity_schedules")
      .select(BOOKING_AVAILABILITY_SCHEDULE_COLS)
      .eq("business_id", businessId)
      .eq("activity_id", activityId)
      .eq("is_active", true);

    const daySchedules = pickSchedulesForActivityOnDate(
      (scheduleRows || []) as ScheduleRow[],
      today,
      timeZone,
    );

    const { data: occupancyRaw } = await supabase.rpc("booking_get_portal_slot_occupancy", {
      p_business_id: businessId,
      p_activity_id: activityId,
      p_booking_date: today,
      p_exclude_hold_token: null,
    });

    const dayAvailability = buildDateAvailability(
      today,
      daySchedules,
      parseOccupancyMap(occupancyRaw),
    );

    slots = dayAvailability.slots.map((slot) => ({
      time: slot.time,
      occupied: slot.occupied,
      totalCapacity: slot.totalCapacity,
      remaining: slot.remaining,
    }));
    scheduleTotalCapacity = daySchedules.reduce((sum, s) => sum + scheduleSlotTotalSpaces(s), 0);
  }

  const maxCapacity = categoryMax && categoryMax > 0
    ? categoryMax
    : scheduleTotalCapacity > 0
    ? scheduleTotalCapacity
    : null;

  const occupiedBasis = Math.max(onSiteUnits, scheduledUnitsToday);
  const remainingCapacity = categoryRemaining != null
    ? categoryRemaining
    : maxCapacity != null
    ? Math.max(0, maxCapacity - occupiedBasis)
    : null;

  const occupancyPercent = maxCapacity && maxCapacity > 0
    ? Math.min(100, Math.round((occupiedBasis / maxCapacity) * 100))
    : null;

  const { minutes: nowMinutes } = getZonedParts(now, timeZone);
  const currentSlotRaw = pickCurrentSlot(slots, nowMinutes);
  const currentSlot = currentSlotRaw
    ? {
      ...currentSlotRaw,
      fillPercent: currentSlotRaw.totalCapacity > 0
        ? Math.round((currentSlotRaw.occupied / currentSlotRaw.totalCapacity) * 100)
        : 0,
    }
    : null;

  const occupancyBand = !isOpenNow
    ? "closed"
    : bandFromPercent(occupancyPercent, remainingCapacity, maxCapacity);

  const hostPortalUrl = resolveHostPortalUrl(businessId);
  const portalUrl = activityId
    ? resolveActivityPortalUrl(hostPortalUrl, activityId)
    : hostPortalUrl;

  const recommended = occupancyBand === "busy" || occupancyBand === "full";

  return {
    ok: true,
    businessId,
    timezone: timeZone,
    asOf: now.toISOString(),
    date: today,
    isOpenNow,
    openUntil,
    activityId,
    typeKey,
    occupancyBand,
    occupancyPercent,
    onSiteUnits,
    scheduledUnitsToday,
    maxCapacity,
    remainingCapacity,
    currentSlot,
    estimatedWait: estimateWait(occupancyBand, isOpenNow),
    walkInMessage: buildWalkInMessage(occupancyBand, isOpenNow, remainingCapacity),
    peakWindowsToday: buildPeakWindows(slots, nowMinutes),
    bookingCta: {
      label: recommended ? "Book online — recommended right now" : "Book online",
      portalUrl,
      recommended,
    },
  };
}
