import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SupabaseClient = ReturnType<typeof createClient>;

type HolidayRow = {
  date?: string;
  name?: string;
  closed?: boolean;
  hours?: { open?: string; close?: string };
};

type DayHours = { open?: string; close?: string; closed?: boolean };
type OperatingHours = Record<string, DayHours>;

export type EffectiveBusinessHours = {
  closed: boolean;
  openMinutes: number | null;
  closeMinutes: number | null;
  label: string | null;
  source: "invalid" | "holiday" | "regular";
  hoursText?: string;
};

export function normalizeHolidayDateKey(value: unknown): string {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return "";
}

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function normalizeBookingScheduleTime(timeValue: unknown): string {
  if (!timeValue) return "";
  const raw = String(timeValue).trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) return raw.substring(0, 5);

  const amPm = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (amPm) {
    let hour = parseInt(amPm[1], 10);
    const minute = amPm[2];
    const pm = amPm[3].toUpperCase() === "PM";
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
    return `${String(hour).padStart(2, "0")}:${minute}`;
  }

  return raw.substring(0, 5);
}

export function parseTimeToMinutes(timeStr: unknown): number | null {
  if (!timeStr) return null;
  const raw = String(timeStr).trim();
  const normalized = normalizeBookingScheduleTime(raw);
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatMinutesAsDisplay(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const displayHour = h24 % 12 || 12;
  return `${displayHour}:${String(mins).padStart(2, "0")} ${suffix}`;
}

function getDayKeyFromDateString(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "monday";
  return DAY_KEYS[d.getDay()] || "monday";
}

export function isBusinessClosedOnDate(holidayHours: unknown, bookingDate: string): boolean {
  const dateKey = normalizeHolidayDateKey(bookingDate);
  if (!dateKey || !Array.isArray(holidayHours)) return false;
  for (const row of holidayHours) {
    if (!row || typeof row !== "object") continue;
    const holiday = row as HolidayRow;
    if (normalizeHolidayDateKey(holiday.date) !== dateKey) continue;
    return holiday.closed === true;
  }
  return false;
}

export function getClosedHolidayMessage(holidayHours: unknown, bookingDate: string): string | null {
  const dateKey = normalizeHolidayDateKey(bookingDate);
  if (!dateKey || !Array.isArray(holidayHours)) return null;
  for (const row of holidayHours) {
    if (!row || typeof row !== "object") continue;
    const holiday = row as HolidayRow;
    if (normalizeHolidayDateKey(holiday.date) !== dateKey) continue;
    if (holiday.closed !== true) return null;
    const label = typeof holiday.name === "string" ? holiday.name.trim() : "";
    return label
      ? `We are closed on ${label}. Please choose another date.`
      : "We are closed on that date. Please choose another date.";
  }
  return null;
}

export function getEffectiveBusinessHoursForDate(
  operatingHours: unknown,
  holidayHours: unknown,
  dateStr: string,
): EffectiveBusinessHours {
  const date = normalizeHolidayDateKey(dateStr);
  if (!date) {
    return { closed: true, openMinutes: null, closeMinutes: null, label: null, source: "invalid" };
  }

  if (Array.isArray(holidayHours)) {
    for (const row of holidayHours) {
      if (!row || typeof row !== "object") continue;
      const holiday = row as HolidayRow;
      if (normalizeHolidayDateKey(holiday.date) !== date) continue;

      if (holiday.closed === true) {
        return {
          closed: true,
          openMinutes: null,
          closeMinutes: null,
          label: typeof holiday.name === "string" ? holiday.name.trim() : date,
          source: "holiday",
          hoursText: "Closed",
        };
      }

      const open = typeof holiday.hours?.open === "string" ? holiday.hours.open.trim() : "";
      const close = typeof holiday.hours?.close === "string" ? holiday.hours.close.trim() : "";
      const openMinutes = parseTimeToMinutes(open);
      const closeMinutes = parseTimeToMinutes(close);
      if (openMinutes != null && closeMinutes != null && closeMinutes > openMinutes) {
        return {
          closed: false,
          openMinutes,
          closeMinutes,
          label: typeof holiday.name === "string" ? holiday.name.trim() : date,
          source: "holiday",
          hoursText: `${formatMinutesAsDisplay(openMinutes)} - ${formatMinutesAsDisplay(closeMinutes)}`,
        };
      }
      return {
        closed: true,
        openMinutes: null,
        closeMinutes: null,
        label: typeof holiday.name === "string" ? holiday.name.trim() : date,
        source: "holiday",
        hoursText: "Closed",
      };
    }
  }

  const raw = operatingHours && typeof operatingHours === "object" && !Array.isArray(operatingHours)
    ? operatingHours as OperatingHours
    : {};
  const dayKey = getDayKeyFromDateString(date);
  const day = raw[dayKey];
  if (!day || day.closed === true) {
    return {
      closed: true,
      openMinutes: null,
      closeMinutes: null,
      label: dayKey,
      source: "regular",
      hoursText: "Closed",
    };
  }

  const openMinutes = parseTimeToMinutes(day.open);
  const closeMinutes = parseTimeToMinutes(day.close);
  if (openMinutes == null || closeMinutes == null || closeMinutes <= openMinutes) {
    return {
      closed: true,
      openMinutes: null,
      closeMinutes: null,
      label: dayKey,
      source: "regular",
      hoursText: "Closed",
    };
  }

  return {
    closed: false,
    openMinutes,
    closeMinutes,
    label: dayKey,
    source: "regular",
    hoursText: `${formatMinutesAsDisplay(openMinutes)} - ${formatMinutesAsDisplay(closeMinutes)}`,
  };
}

export function validateBookingWithinBusinessHours({
  bookingDate,
  bookingTime,
  durationMinutes = 60,
  operatingHours,
  holidayHours,
}: {
  bookingDate: string;
  bookingTime: string;
  durationMinutes?: number;
  operatingHours: unknown;
  holidayHours: unknown;
}): { ok: boolean; requiresOverride?: boolean; message?: string } {
  const dateStr = normalizeHolidayDateKey(bookingDate);
  const normalizedTime = normalizeBookingScheduleTime(bookingTime);
  // durationMinutes kept for call-site compatibility; open/close window is not enforced.
  void durationMinutes;

  if (!dateStr || !normalizedTime) {
    return { ok: false, message: "Booking date and time are required." };
  }

  const effective = getEffectiveBusinessHoursForDate(operatingHours, holidayHours, dateStr);
  if (effective.closed) {
    const label = effective.label || dateStr;
    return {
      ok: false,
      requiresOverride: true,
      message: effective.source === "holiday"
        ? `We are closed on ${label}.`
        : "We are closed on this day.",
    };
  }

  // Published schedules may start before / end after general operating hours
  // (e.g. day camp at 8:30 when the venue opens at 10:00). Only fully closed
  // days from the holiday system block bookings; booking settings gate the rest.
  const startMinutes = parseTimeToMinutes(normalizedTime);
  if (startMinutes == null) {
    return { ok: false, message: "Invalid booking time." };
  }

  return { ok: true };
}

export async function loadBusinessHoursContext(
  supabase: SupabaseClient,
  businessId: string,
): Promise<{ operatingHours: unknown; holidayHours: unknown } | null> {
  const { data, error } = await supabase
    .from("businesses")
    .select("operating_hours, holiday_hours")
    .eq("id", businessId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    operatingHours: data.operating_hours,
    holidayHours: data.holiday_hours,
  };
}

export async function assertBookingWithinBusinessHours(
  supabase: SupabaseClient,
  businessId: string,
  bookingDate: string,
  bookingTime: string,
  durationMinutes: number,
  { allowOverride = false }: { allowOverride?: boolean } = {},
): Promise<{ ok: true } | { ok: false; message: string }> {
  const hours = await loadBusinessHoursContext(supabase, businessId);
  if (!hours) {
    return { ok: false, message: "Could not verify business hours." };
  }

  const check = validateBookingWithinBusinessHours({
    bookingDate,
    bookingTime,
    durationMinutes,
    operatingHours: hours.operatingHours,
    holidayHours: hours.holidayHours,
  });

  if (check.ok) return { ok: true };
  if (allowOverride && check.requiresOverride) return { ok: true };
  return { ok: false, message: check.message || "Booking is outside business hours." };
}

/** @deprecated use assertBookingWithinBusinessHours */
export async function assertBusinessOpenForBookingDate(
  supabase: SupabaseClient,
  businessId: string,
  bookingDate: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const closedMessage = getClosedHolidayMessage(
    (await loadBusinessHoursContext(supabase, businessId))?.holidayHours,
    bookingDate,
  );
  if (closedMessage) return { ok: false, message: closedMessage };
  return { ok: true };
}
