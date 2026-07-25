import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SupabaseClient = ReturnType<typeof createClient>;

type HolidayRow = {
  date?: string;
  name?: string;
  closed?: boolean;
  hours?: { open?: string; close?: string };
};

export function normalizeHolidayDateKey(value: unknown): string {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return "";
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

export function getClosedHolidayMessage(
  holidayHours: unknown,
  bookingDate: string,
): string | null {
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

export async function assertBusinessOpenForBookingDate(
  supabase: SupabaseClient,
  businessId: string,
  bookingDate: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from("businesses")
    .select("holiday_hours")
    .eq("id", businessId)
    .maybeSingle();

  if (error) {
    console.error("[businessHolidayHours] load failed:", error);
    return { ok: false, message: "Could not verify business hours." };
  }

  const closedMessage = getClosedHolidayMessage(data?.holiday_hours, bookingDate);
  if (closedMessage) {
    return { ok: false, message: closedMessage };
  }

  return { ok: true };
}
