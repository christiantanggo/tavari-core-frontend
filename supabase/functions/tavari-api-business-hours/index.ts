// Public read-only business hours (Dashboard → Settings → Operating Hours & Holiday Hours).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

/** Tavari day key → JS weekday index (0 = Sunday … 6 = Saturday). */
const DAY_KEY_TO_WEEKDAY: Record<string, string> = {
  sunday: "0",
  monday: "1",
  tuesday: "2",
  wednesday: "3",
  thursday: "4",
  friday: "5",
  saturday: "6",
};

type DayHours = { open?: string; close?: string; closed?: boolean };
type OperatingHours = Record<string, DayHours>;
type HolidayRow = {
  id?: string;
  date?: string;
  name?: string;
  closed?: boolean;
  hours?: { open?: string; close?: string };
};

export type WeeklyHoursMap = Record<string, string>;
export type SpecialHoursEntry = { date: string; hoursText: string; label?: string };

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function resolveBusinessId(req: Request, body: Record<string, unknown>): string {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("businessId") ?? url.searchParams.get("business_id") ?? "";
  const fromBody = String(body.businessId ?? body.business_id ?? "");
  return (fromQuery || fromBody).trim();
}

/** "09:00" / "9:00" → "9:00am", "17:00" → "5:00pm" */
export function formatTime12h(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return trimmed;

  let hour = parseInt(match[1], 10);
  const minute = match[2];
  if (Number.isNaN(hour) || hour < 0 || hour > 23) return trimmed;

  const period = hour >= 12 ? "pm" : "am";
  if (hour === 0) hour = 12;
  else if (hour > 12) hour -= 12;

  return minute === "00" ? `${hour}${period}` : `${hour}:${minute}${period}`;
}

export function formatHoursRange(open: string, close: string): string {
  const openFmt = formatTime12h(open);
  const closeFmt = formatTime12h(close);
  if (!openFmt && !closeFmt) return "";
  if (!openFmt) return closeFmt;
  if (!closeFmt) return openFmt;
  return `${openFmt} - ${closeFmt}`;
}

export function dayHoursToDisplayText(day: DayHours | undefined): string {
  if (!day || day.closed === true) return "Closed";
  const open = typeof day.open === "string" ? day.open.trim() : "";
  const close = typeof day.close === "string" ? day.close.trim() : "";
  if (!open && !close) return "Closed";
  return formatHoursRange(open, close);
}

/** Weekly map keyed "0".."6" (Sun–Sat) with human-readable lines for each day. */
export function buildWeeklyHoursMap(operatingHours: unknown): WeeklyHoursMap {
  const raw = operatingHours && typeof operatingHours === "object" && !Array.isArray(operatingHours)
    ? operatingHours as OperatingHours
    : {};

  const weekly: WeeklyHoursMap = {};
  for (const dayKey of DAY_KEYS) {
    const idx = DAY_KEY_TO_WEEKDAY[dayKey];
    weekly[idx] = dayHoursToDisplayText(raw[dayKey]);
  }
  return weekly;
}

export function buildSpecialHours(holidayHours: unknown): SpecialHoursEntry[] {
  if (!Array.isArray(holidayHours)) return [];

  const out: SpecialHoursEntry[] = [];
  for (const row of holidayHours) {
    if (!row || typeof row !== "object") continue;
    const holiday = row as HolidayRow;
    const date = typeof holiday.date === "string" ? holiday.date.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const label = typeof holiday.name === "string" ? holiday.name.trim() : "";
    let hoursText = "Closed";
    if (holiday.closed !== true) {
      const open = typeof holiday.hours?.open === "string" ? holiday.hours.open.trim() : "";
      const close = typeof holiday.hours?.close === "string" ? holiday.hours.close.trim() : "";
      hoursText = open || close ? formatHoursRange(open, close) : "Closed";
    }

    out.push({
      date,
      hoursText,
      ...(label ? { label } : {}),
    });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** One-line summary when every weekday shares the same hours text. */
export function deriveHoursSummary(weekly: WeeklyHoursMap): string {
  const vals = ["0", "1", "2", "3", "4", "5", "6"].map((k) => weekly[k] ?? "");
  const first = vals[0] ?? "";
  if (!first) return "";
  if (vals.every((v) => v === first)) {
    const allClosed = first === "Closed";
    if (allClosed) return "Closed";
    const allOpenSame = vals.every((v) => v !== "Closed");
    if (allOpenSame) return `${first}, 7 days a week`;
    return first;
  }
  return "Hours vary by day — see weekly schedule";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const body = req.method === "POST"
      ? await req.json().catch(() => ({})) as Record<string, unknown>
      : {};
    const businessId = resolveBusinessId(req, body);

    if (!businessId || !UUID_RE.test(businessId)) {
      return jsonResponse({ ok: false, error: "Valid businessId is required." }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
      return jsonResponse({ ok: false, error: "Server configuration error." }, 500);
    }

    const supabase = createClient(url, key);

    const { data: moduleRow, error: moduleErr } = await supabase
      .from("business_module_usage")
      .select("enabled")
      .eq("business_id", businessId)
      .eq("module_key", "tavari_apis")
      .maybeSingle();

    if (moduleErr) {
      console.error("[tavari-api-business-hours] module check", moduleErr);
      return jsonResponse({ ok: false, error: "Could not verify API access." }, 500);
    }

    if (!moduleRow?.enabled) {
      return jsonResponse(
        { ok: false, error: "Tavari APIs is not enabled for this business." },
        403,
      );
    }

    const { data: business, error: bizErr } = await supabase
      .from("businesses")
      .select("id, timezone, operating_hours, holiday_hours")
      .eq("id", businessId)
      .maybeSingle();

    if (bizErr) {
      console.error("[tavari-api-business-hours] business lookup", bizErr);
      return jsonResponse({ ok: false, error: "Could not load business hours." }, 500);
    }

    if (!business) {
      return jsonResponse({ ok: false, error: "Business not found." }, 404);
    }

    const timezone = typeof business.timezone === "string" && business.timezone.trim()
      ? business.timezone.trim()
      : "America/Toronto";
    const weeklyHours = buildWeeklyHoursMap(business.operating_hours);
    const specialHours = buildSpecialHours(business.holiday_hours);
    const hoursSummary = deriveHoursSummary(weeklyHours);

    return jsonResponse({
      ok: true,
      businessId: business.id,
      timezone,
      weeklyHours,
      specialHours,
      hoursSummary,
    });
  } catch (e) {
    console.error("[tavari-api-business-hours]", e);
    return jsonResponse(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500,
    );
  }
});
