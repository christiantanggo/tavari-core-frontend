/** Shared camp schedule + occupancy → public website session mapping. */

import {
  addDaysToDateString,
  formatDateInTimeZone,
  normalizeScheduleTime,
  parseOccupancyMap,
  pickSchedulesForActivityOnDate,
  scheduleSlotTotalSpaces,
  type ScheduleRow,
} from "./tavariPublicBookingAvailability.ts";
import { resolveActivityPortalUrl, resolveHostPortalUrl } from "./tavariPublicBookingCatalog.ts";
import {
  buildProductPriceFields,
  formatCadPrice,
  type InventoryRow,
} from "./tavariPublicProducts.ts";
import { primaryInventoryIdFromTicketSettings } from "./tavariPublicPartyPackages.ts";

export const VALID_CAMP_KEYS = ["pa_day", "summer", "march_break", "winter_break"] as const;
export type WebsiteCampKey = (typeof VALID_CAMP_KEYS)[number];

export type CampActivityRow = {
  id: string;
  activity_name: string;
  duration_minutes: number | null;
  ticket_settings: unknown;
  website_camp_program: string | null;
  website_camp_age_min: number | null;
  website_camp_age_max: number | null;
  website_camp_schedule_summary: string | null;
};

export type CampScheduleRow = ScheduleRow & {
  schedule_name: string | null;
};

export type PublicCampSession = {
  activityId: string;
  activityName: string;
  campProgram: string;
  sessionType: "single_day" | "week";
  scheduleId: string;
  scheduleName: string;
  date: string;
  endDate: string | null;
  startTime: string;
  startTimeFormatted: string;
  endTime: string;
  endTimeFormatted: string;
  durationMinutes: number;
  ageMin: number | null;
  ageMax: number | null;
  ageRange: string;
  scheduleSummary: string;
  price: number | null;
  priceFormatted: string | null;
  totalSpots: number;
  spotsRemaining: number;
  soldOut: boolean;
  registrationOpen: boolean;
  portalUrl: string;
};

export const CAMP_SESSIONS_ACTIVITY_COLS =
  "id, activity_name, duration_minutes, ticket_settings, website_camp_program, website_camp_age_min, website_camp_age_max, website_camp_schedule_summary";

export const CAMP_SESSIONS_SCHEDULE_COLS =
  "id, activity_id, day_of_week, start_time, start_date, end_date, spaces, is_active, schedule_name";

export const CAMP_SESSIONS_INVENTORY_COLS =
  "id, name, price, website_online_price, is_active, expose_to_website_api";

export function campProgramMatchesKey(program: string | null | undefined, campKey: string): boolean {
  const p = String(program ?? "").trim().toLowerCase();
  const key = String(campKey ?? "").trim().toLowerCase();
  if (!p || !key) return false;
  if (p === key) return true;
  if (key === "summer" && (p === "summer" || p.startsWith("summer_"))) return true;
  return false;
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null || value === "") return null;
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function formatTime12Hour(time24: string): string {
  const normalized = normalizeScheduleTime(time24);
  if (!normalized) return "";
  const [hStr, mStr] = normalized.split(":");
  let h = parseInt(hStr, 10);
  if (!Number.isFinite(h)) return normalized;
  const m = mStr ?? "00";
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m}${ampm}`;
}

export function computeEndTime24(startTime: string, durationMinutes: number): string {
  const normalized = normalizeScheduleTime(startTime);
  const [hStr, mStr] = normalized.split(":");
  let total = parseInt(hStr, 10) * 60 + parseInt(mStr ?? "0", 10) + durationMinutes;
  if (!Number.isFinite(total)) return normalized;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatAgeRange(min: number | null, max: number | null): string {
  if (min != null && max != null) return `${min}–${max}`;
  if (min != null) return `${min}+`;
  if (max != null) return `up to ${max}`;
  return "";
}

function resolveSessionEndDate(startDate: string, ticketSettings: unknown): string | null {
  if (!ticketSettings || typeof ticketSettings !== "object") return null;
  const multi = (ticketSettings as Record<string, unknown>).multiDay;
  if (!multi || typeof multi !== "object") return null;
  if ((multi as Record<string, unknown>).enabled !== true) return null;
  const dayCount = Number((multi as Record<string, unknown>).dayCount);
  if (!Number.isFinite(dayCount) || dayCount <= 1) return null;
  return addDaysToDateString(startDate, dayCount - 1);
}

function resolveSessionType(
  program: string | null,
  ticketSettings: unknown,
  startDate: string,
): "single_day" | "week" {
  const p = String(program ?? "").toLowerCase();
  if (p.includes("single") || p === "pa_day" || p === "march_break" || p === "winter_break") {
    return "single_day";
  }
  if (p.includes("week")) return "week";
  const endDate = resolveSessionEndDate(startDate, ticketSettings);
  if (endDate && endDate !== startDate) return "week";
  return "single_day";
}

function resolveScheduleSummary(
  activity: CampActivityRow,
  startTime: string,
  durationMinutes: number,
): string {
  const override = trimText(activity.website_camp_schedule_summary);
  if (override) return override;
  const endTime = computeEndTime24(startTime, durationMinutes);
  return `${formatTime12Hour(startTime)}–${formatTime12Hour(endTime)}`;
}

function resolveSessionPrice(inventory: InventoryRow | null | undefined): {
  price: number | null;
  priceFormatted: string | null;
} {
  if (!inventory) return { price: null, priceFormatted: null };
  const fields = buildProductPriceFields(inventory);
  const price = fields.onlinePrice ?? (fields.price > 0 ? fields.price : null);
  if (price == null || price <= 0) return { price: null, priceFormatted: null };
  return { price, priceFormatted: formatCadPrice(price) };
}

export function extractCampSessionDates(
  schedules: CampScheduleRow[],
  fromDate: string,
  toDate: string,
  includePast: boolean,
  today: string,
): Array<{ date: string; schedules: CampScheduleRow[] }> {
  const byDate = new Map<string, CampScheduleRow[]>();

  for (const schedule of schedules) {
    const start = schedule.start_date ? schedule.start_date.slice(0, 10) : null;
    if (!start) continue;
    if (start < fromDate || start > toDate) continue;
    if (!includePast && start < today) continue;

    const list = byDate.get(start) ?? [];
    list.push(schedule);
    byDate.set(start, list);
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dateSchedules]) => ({ date, schedules: dateSchedules }));
}

export function mapCampSession(
  activity: CampActivityRow,
  schedule: CampScheduleRow,
  date: string,
  occupancy: Record<string, number>,
  inventory: InventoryRow | null | undefined,
  hostPortalUrl: string,
  today: string,
): PublicCampSession | null {
  const daySchedules = pickSchedulesForActivityOnDate([schedule], date, "America/Toronto");
  if (daySchedules.length === 0) return null;

  const matched =
    daySchedules.find((row) => row.id === schedule.id) ??
    daySchedules.find((row) =>
      normalizeScheduleTime(row.start_time) === normalizeScheduleTime(schedule.start_time)
    ) ??
    daySchedules[0];

  const startTime = normalizeScheduleTime(matched.start_time);
  if (!startTime) return null;

  const durationMinutes = parseNumeric(activity.duration_minutes) ?? 480;
  const endTime = computeEndTime24(startTime, durationMinutes);
  const totalSpots = scheduleSlotTotalSpaces(matched);
  const occupied = occupancy[startTime] ?? 0;
  const spotsRemaining = Math.max(0, totalSpots - occupied);
  const ageMin = parseNumeric(activity.website_camp_age_min);
  const ageMax = parseNumeric(activity.website_camp_age_max);
  const { price, priceFormatted } = resolveSessionPrice(inventory);
  const program = trimText(activity.website_camp_program) || "camp";
  const sessionType = resolveSessionType(program, activity.ticket_settings, date);
  const endDate = sessionType === "week"
    ? resolveSessionEndDate(date, activity.ticket_settings)
    : null;

  return {
    activityId: activity.id,
    activityName: activity.activity_name,
    campProgram: program,
    sessionType,
    scheduleId: matched.id,
    scheduleName: trimText(schedule.schedule_name) || trimText(activity.activity_name),
    date,
    endDate,
    startTime,
    startTimeFormatted: formatTime12Hour(startTime),
    endTime,
    endTimeFormatted: formatTime12Hour(endTime),
    durationMinutes,
    ageMin,
    ageMax,
    ageRange: formatAgeRange(ageMin, ageMax),
    scheduleSummary: resolveScheduleSummary(activity, startTime, durationMinutes),
    price,
    priceFormatted,
    totalSpots,
    spotsRemaining,
    soldOut: spotsRemaining <= 0,
    registrationOpen: spotsRemaining > 0 && date >= today,
    portalUrl: resolveActivityPortalUrl(hostPortalUrl, activity.id),
  };
}

export function sortCampSessions(sessions: PublicCampSession[]): PublicCampSession[] {
  return [...sessions].sort((a, b) =>
    a.date.localeCompare(b.date) ||
    a.startTime.localeCompare(b.startTime) ||
    a.activityName.localeCompare(b.activityName)
  );
}

export function collectInventoryIds(activities: CampActivityRow[]): string[] {
  const ids = new Set<string>();
  for (const activity of activities) {
    const id = primaryInventoryIdFromTicketSettings(activity.ticket_settings);
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

export { resolveHostPortalUrl, formatDateInTimeZone, parseOccupancyMap };
