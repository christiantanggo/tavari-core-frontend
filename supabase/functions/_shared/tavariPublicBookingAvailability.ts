/** Shared schedule + occupancy → public website availability mapping. */

import { resolveHostPortalUrl, resolveActivityPortalUrl } from "./tavariPublicBookingCatalog.ts";

export type ScheduleRow = {
  id: string;
  activity_id: string;
  day_of_week: number;
  start_time: string;
  start_date: string | null;
  end_date: string | null;
  spaces: number | null;
  is_active: boolean | null;
};

export type ActivityAvailabilityRow = {
  id: string;
  activity_name: string;
  type_id: string | null;
  type_key: string;
};

export type PublicAvailabilitySlot = {
  time: string;
  totalCapacity: number;
  occupied: number;
  remaining: number;
  available: boolean;
};

export type PublicAvailabilityDate = {
  date: string;
  closed: boolean;
  blocked: boolean;
  reason: "no_schedule" | "fully_booked" | null;
  slots: PublicAvailabilitySlot[];
  dayRemainingCapacity: number;
  hasOpenSlot: boolean;
};

export type PublicNextOpenSlot = {
  date: string;
  time: string;
  remaining: number;
  portalUrl: string;
};

export type PublicActivityAvailability = {
  activityId: string;
  typeKey: string;
  name: string;
  portalUrl: string;
  dates: PublicAvailabilityDate[];
  nextOpenSlot: PublicNextOpenSlot | null;
};

export type PublicAvailabilitySummaries = {
  dropInPlay: {
    activityId: string | null;
    walkInMessage: string;
    todayRemainingCapacity: number | null;
    todayHasOpenSlots: boolean;
    nextOpenSlot: PublicNextOpenSlot | null;
  } | null;
  party: {
    weekendUrgencyMessage: string;
    nextSaturdayOpenCount: number;
    saturdaysChecked: number;
    isUrgent: boolean;
  } | null;
  camp: {
    activityId: string | null;
    spotsMessage: string;
    nextCampDate: string | null;
    nextCampRemainingSpots: number | null;
  } | null;
};

const WEEKDAY_SHORT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function normalizeScheduleTime(timeValue: unknown): string {
  if (!timeValue) return "";
  const raw = String(timeValue).trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) return raw.substring(0, 5);
  return raw.substring(0, 5).trim();
}

export function scheduleSlotTotalSpaces(schedule: ScheduleRow): number {
  const spaces = Number(schedule.spaces);
  return Number.isFinite(spaces) && spaces > 0 ? spaces : 1;
}

export function dedupeSchedulesByStartTime(schedules: ScheduleRow[]): ScheduleRow[] {
  const byTime = new Map<string, ScheduleRow>();
  for (const schedule of schedules) {
    const key = normalizeScheduleTime(schedule.start_time);
    if (!key) continue;
    const existing = byTime.get(key);
    if (!existing) {
      byTime.set(key, { ...schedule });
      continue;
    }
    byTime.set(key, {
      ...existing,
      spaces: Math.max(scheduleSlotTotalSpaces(existing), scheduleSlotTotalSpaces(schedule)),
    });
  }
  return Array.from(byTime.values()).sort((a, b) =>
    normalizeScheduleTime(a.start_time).localeCompare(normalizeScheduleTime(b.start_time))
  );
}

export function dayOfWeekInTimeZone(dateStr: string, timeZone: string): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(
    new Date(`${dateStr}T12:00:00`),
  );
  return WEEKDAY_SHORT[wd] ?? 0;
}

export function formatDateInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map((part) => Number(part));
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

export function enumerateDateStrings(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  let current = fromDate;
  while (current <= toDate) {
    out.push(current);
    if (current === toDate) break;
    current = addDaysToDateString(current, 1);
  }
  return out;
}

export function pickSchedulesForActivityOnDate(
  schedules: ScheduleRow[],
  dateStr: string,
  timeZone: string,
): ScheduleRow[] {
  if (!schedules.length) return [];
  const dayOfWeek = dayOfWeekInTimeZone(dateStr, timeZone);
  const byDay = schedules.filter((schedule) => schedule.day_of_week === dayOfWeek);
  const dateSpecific: ScheduleRow[] = [];
  const indefinite: ScheduleRow[] = [];

  for (const schedule of byDay) {
    const hasRange = schedule.start_date || schedule.end_date;
    if (!hasRange) {
      indefinite.push(schedule);
      continue;
    }
    const start = schedule.start_date ? schedule.start_date.slice(0, 10) : null;
    const end = schedule.end_date ? schedule.end_date.slice(0, 10) : null;
    if (start && end && dateStr >= start && dateStr <= end) {
      dateSpecific.push(schedule);
    } else if (start && !end && dateStr >= start) {
      dateSpecific.push(schedule);
    } else if (!start && end && dateStr <= end) {
      dateSpecific.push(schedule);
    }
  }

  const use = dateSpecific.length > 0 ? dateSpecific : indefinite;
  return dedupeSchedulesByStartTime(use);
}

export function parseOccupancyMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(value);
    if (Number.isFinite(n)) out[normalizeScheduleTime(key)] = n;
  }
  return out;
}

export function buildDateAvailability(
  dateStr: string,
  schedules: ScheduleRow[],
  occupancy: Record<string, number>,
): PublicAvailabilityDate {
  const slots: PublicAvailabilitySlot[] = schedules.map((schedule) => {
    const time = normalizeScheduleTime(schedule.start_time);
    const totalCapacity = scheduleSlotTotalSpaces(schedule);
    const occupied = occupancy[time] ?? 0;
    const remaining = Math.max(0, totalCapacity - occupied);
    return {
      time,
      totalCapacity,
      occupied,
      remaining,
      available: remaining > 0,
    };
  });

  const dayRemainingCapacity = slots.reduce((sum, slot) => sum + slot.remaining, 0);
  const hasOpenSlot = slots.some((slot) => slot.available);

  if (schedules.length === 0) {
    return {
      date: dateStr,
      closed: true,
      blocked: true,
      reason: "no_schedule",
      slots: [],
      dayRemainingCapacity: 0,
      hasOpenSlot: false,
    };
  }

  if (!hasOpenSlot) {
    return {
      date: dateStr,
      closed: false,
      blocked: true,
      reason: "fully_booked",
      slots,
      dayRemainingCapacity: 0,
      hasOpenSlot: false,
    };
  }

  return {
    date: dateStr,
    closed: false,
    blocked: false,
    reason: null,
    slots,
    dayRemainingCapacity,
    hasOpenSlot: true,
  };
}

export function findNextOpenSlot(
  dates: PublicAvailabilityDate[],
  hostPortalUrl: string,
  activityId: string,
): PublicNextOpenSlot | null {
  for (const day of dates) {
    for (const slot of day.slots) {
      if (slot.available) {
        return {
          date: day.date,
          time: slot.time,
          remaining: slot.remaining,
          portalUrl: resolveActivityPortalUrl(hostPortalUrl, activityId),
        };
      }
    }
  }
  return null;
}

export function buildWebsiteSummaries(
  activities: PublicActivityAvailability[],
  fromDate: string,
  timeZone: string,
): PublicAvailabilitySummaries {
  const dropIn = activities.find((a) => a.typeKey === "drop_in_play") ?? null;
  const campActivities = activities.filter((a) => a.typeKey === "day_camp");
  const partyActivities = activities.filter((a) => a.typeKey === "birthday_party");

  let dropInPlay: PublicAvailabilitySummaries["dropInPlay"] = null;
  if (dropIn) {
    const today = dropIn.dates.find((d) => d.date === fromDate) ?? dropIn.dates[0] ?? null;
    const todayRemainingCapacity = today?.dayRemainingCapacity ?? null;
    const todayHasOpenSlots = today?.hasOpenSlot === true;
    let walkInMessage = "Walk-ins welcome subject to capacity.";
    if (today && today.blocked && today.reason === "fully_booked") {
      walkInMessage =
        "Walk-ins are welcome when we have capacity — today is full, so booking online is recommended.";
    } else if (today && todayHasOpenSlots && (todayRemainingCapacity ?? 0) <= 5) {
      walkInMessage =
        "Walk-ins welcome subject to capacity — today is busy, so booking online is recommended.";
    }
    dropInPlay = {
      activityId: dropIn.activityId,
      walkInMessage,
      todayRemainingCapacity,
      todayHasOpenSlots,
      nextOpenSlot: dropIn.nextOpenSlot,
    };
  }

  let party: PublicAvailabilitySummaries["party"] = null;
  if (partyActivities.length > 0) {
    const saturdays: string[] = [];
    let cursor = fromDate;
    while (saturdays.length < 4 && cursor <= addDaysToDateString(fromDate, 60)) {
      if (dayOfWeekInTimeZone(cursor, timeZone) === 6) saturdays.push(cursor);
      cursor = addDaysToDateString(cursor, 1);
    }

    let openSaturdays = 0;
    for (const saturday of saturdays) {
      const anyOpen = partyActivities.some((activity) => {
        const day = activity.dates.find((d) => d.date === saturday);
        return day?.hasOpenSlot === true;
      });
      if (anyOpen) openSaturdays += 1;
    }

    const isUrgent = saturdays.length > 0 && openSaturdays <= Math.max(1, Math.floor(saturdays.length / 2));
    let weekendUrgencyMessage =
      "Weekend party slots are available — reserve your date online.";
    if (openSaturdays === 0 && saturdays.length > 0) {
      weekendUrgencyMessage =
        "Weekend party slots are filling fast — book online soon for your preferred Saturday.";
    } else if (isUrgent) {
      weekendUrgencyMessage =
        `Weekend party slots are filling fast — only ${openSaturdays} of the next ${saturdays.length} Saturdays still have room.`;
    }

    party = {
      weekendUrgencyMessage,
      nextSaturdayOpenCount: openSaturdays,
      saturdaysChecked: saturdays.length,
      isUrgent,
    };
  }

  let camp: PublicAvailabilitySummaries["camp"] = null;
  if (campActivities.length > 0) {
    let bestActivity: PublicActivityAvailability | null = null;
    let bestDate: PublicAvailabilityDate | null = null;

    for (const activity of campActivities) {
      for (const day of activity.dates) {
        if (!day.hasOpenSlot) continue;
        if (!bestDate || day.date < bestDate.date) {
          bestDate = day;
          bestActivity = activity;
        }
      }
    }

    if (bestActivity && bestDate) {
      const spots = bestDate.dayRemainingCapacity;
      camp = {
        activityId: bestActivity.activityId,
        spotsMessage: spots === 1
          ? "1 spot left on the next camp date — register soon."
          : `${spots} spots left on the next camp date — register soon.`,
        nextCampDate: bestDate.date,
        nextCampRemainingSpots: spots,
      };
    } else {
      camp = {
        activityId: campActivities[0]?.activityId ?? null,
        spotsMessage: "Camp dates are filling fast — register online when spots are posted.",
        nextCampDate: null,
        nextCampRemainingSpots: null,
      };
    }
  }

  return { dropInPlay, party, camp };
}

export const BOOKING_AVAILABILITY_SCHEDULE_COLS =
  "id, activity_id, day_of_week, start_time, start_date, end_date, spaces, is_active";

export const BOOKING_AVAILABILITY_ACTIVITY_COLS =
  "id, activity_name, type_id, booking_types!inner(type_key)";

export { resolveHostPortalUrl };
