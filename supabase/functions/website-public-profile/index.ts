// Public read-only website profile for external marketing sites.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { loadPublicBusinessLinks } from "../_shared/tavariPublicBusinessLinks.ts";

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
  date?: string;
  name?: string;
  closed?: boolean;
  hours?: { open?: string; close?: string };
};

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

function trimField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatBusinessAddress(
  street: string,
  city: string,
  state: string,
  postalCode: string,
): string {
  const cityLine = [city, state].filter(Boolean).join(", ");
  const cityLineWithPostal = postalCode
    ? (cityLine ? `${cityLine} ${postalCode}` : postalCode)
    : cityLine;
  return [street, cityLineWithPostal].filter(Boolean).join(", ");
}

function formatTime12h(value: string): string {
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

function formatHoursRange(open: string, close: string): string {
  const openFmt = formatTime12h(open);
  const closeFmt = formatTime12h(close);
  if (!openFmt && !closeFmt) return "";
  if (!openFmt) return closeFmt;
  if (!closeFmt) return openFmt;
  return `${openFmt} - ${closeFmt}`;
}

function dayHoursToDisplayText(day: DayHours | undefined): string {
  if (!day || day.closed === true) return "Closed";
  const open = typeof day.open === "string" ? day.open.trim() : "";
  const close = typeof day.close === "string" ? day.close.trim() : "";
  if (!open && !close) return "Closed";
  return formatHoursRange(open, close);
}

function buildWeeklyHoursMap(operatingHours: unknown): Record<string, string> {
  const raw = operatingHours && typeof operatingHours === "object" && !Array.isArray(operatingHours)
    ? operatingHours as OperatingHours
    : {};

  const weekly: Record<string, string> = {};
  for (const dayKey of DAY_KEYS) {
    weekly[DAY_KEY_TO_WEEKDAY[dayKey]] = dayHoursToDisplayText(raw[dayKey]);
  }
  return weekly;
}

function buildSpecialHours(holidayHours: unknown): Array<{ date: string; hoursText: string; label?: string }> {
  if (!Array.isArray(holidayHours)) return [];

  const out: Array<{ date: string; hoursText: string; label?: string }> = [];
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

function deriveHoursSummary(weekly: Record<string, string>): string {
  const vals = ["0", "1", "2", "3", "4", "5", "6"].map((k) => weekly[k] ?? "");
  const first = vals[0] ?? "";
  if (!first) return "";
  if (vals.every((v) => v === first)) {
    if (first === "Closed") return "Closed";
    if (vals.every((v) => v !== "Closed")) return `${first}, 7 days a week`;
    return first;
  }
  return "Hours vary by day - see weekly schedule";
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
      console.error("[website-public-profile] module check", moduleErr);
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
      .select(
        "id, name, business_email, business_phone, business_address, business_city, business_state, business_postal, timezone, operating_hours, holiday_hours",
      )
      .eq("id", businessId)
      .maybeSingle();

    if (bizErr) {
      console.error("[website-public-profile] business lookup", bizErr);
      return jsonResponse({ ok: false, error: "Could not load business profile." }, 500);
    }

    if (!business) {
      return jsonResponse({ ok: false, error: "Business not found." }, 404);
    }

    const { data: branding, error: brandingErr } = await supabase
      .from("app_branding")
      .select("logo_url, favicon_url")
      .eq("business_id", businessId)
      .maybeSingle();

    if (brandingErr) {
      console.error("[website-public-profile] branding lookup", brandingErr);
      return jsonResponse({ ok: false, error: "Could not load business branding." }, 500);
    }

    const street = trimField(business.business_address);
    const city = trimField(business.business_city);
    const state = trimField(business.business_state);
    const postalCode = trimField(business.business_postal);
    const weeklyHours = buildWeeklyHoursMap(business.operating_hours);
    const specialHours = buildSpecialHours(business.holiday_hours);
    const timezone = trimField(business.timezone) || "America/Toronto";

    const linksPayload = await loadPublicBusinessLinks(supabase, businessId, {
      siteUrl: Deno.env.get("PUBLIC_SITE_URL") || undefined,
    });

    return jsonResponse({
      ok: true,
      businessId: business.id,
      name: trimField(business.name),
      email: trimField(business.business_email),
      phone: trimField(business.business_phone),
      address: formatBusinessAddress(street, city, state, postalCode),
      street,
      city,
      state,
      postalCode,
      logoUrl: trimField(branding?.logo_url),
      faviconUrl: trimField(branding?.favicon_url),
      timezone,
      hoursSummary: deriveHoursSummary(weeklyHours),
      weeklyHours,
      specialHours,
      links: {
        bookingUrl: linksPayload.links.bookingUrl,
        waiverUrl: linksPayload.links.waiverUrl,
        reviewUrl: linksPayload.links.reviewUrl,
        googleReviewUrl: linksPayload.links.googleReviewUrl,
        customerPortalUrl: linksPayload.links.customerPortalUrl,
        partyGuestListUrl: linksPayload.links.partyGuestListUrl,
        campRegistrationUrl: linksPayload.links.campRegistrationUrl,
        partyManageUrl: linksPayload.links.partyManageUrl,
        manageBookingUrl: linksPayload.links.manageBookingUrl,
      },
    });
  } catch (e) {
    console.error("[website-public-profile]", e);
    return jsonResponse(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500,
    );
  }
});
