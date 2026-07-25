// Public read-only booking availability for external websites (OTWK).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  BOOKING_AVAILABILITY_SCHEDULE_COLS,
  addDaysToDateString,
  buildDateAvailability,
  buildWebsiteSummaries,
  enumerateDateStrings,
  findNextOpenSlot,
  formatDateInTimeZone,
  parseOccupancyMap,
  pickSchedulesForActivityOnDate,
  resolveHostPortalUrl,
  type ActivityAvailabilityRow,
  type PublicActivityAvailability,
  type ScheduleRow,
} from "../_shared/tavariPublicBookingAvailability.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_RANGE_DAYS = 27;
const MAX_RANGE_DAYS = 60;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function resolveParams(req: Request, body: Record<string, unknown>) {
  const url = new URL(req.url);
  const businessId = String(
    body.businessId ?? body.business_id ?? url.searchParams.get("businessId") ??
      url.searchParams.get("business_id") ?? "",
  ).trim();
  const activityId = String(
    body.activityId ?? body.activity_id ?? url.searchParams.get("activityId") ??
      url.searchParams.get("activity_id") ?? "",
  ).trim();
  const typeKey = String(
    body.typeKey ?? body.type_key ?? url.searchParams.get("typeKey") ??
      url.searchParams.get("type_key") ?? "",
  ).trim().toLowerCase();
  const fromDate = String(
    body.fromDate ?? body.from_date ?? url.searchParams.get("fromDate") ??
      url.searchParams.get("from_date") ?? "",
  ).trim();
  const toDate = String(
    body.toDate ?? body.to_date ?? url.searchParams.get("toDate") ??
      url.searchParams.get("to_date") ?? "",
  ).trim();
  const summaryRaw = String(
    body.summary ?? url.searchParams.get("summary") ?? "true",
  ).trim().toLowerCase();
  const includeDetails = summaryRaw === "false" || summaryRaw === "0";
  return { businessId, activityId, typeKey, fromDate, toDate, includeDetails };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const body = req.method === "POST"
      ? await req.json().catch(() => ({})) as Record<string, unknown>
      : {};
    const { businessId, activityId, typeKey, fromDate, toDate, includeDetails } = resolveParams(req, body);

    if (!businessId || !UUID_RE.test(businessId)) {
      return json({ ok: false, error: "Valid businessId is required" }, 400);
    }
    if (activityId && !UUID_RE.test(activityId)) {
      return json({ ok: false, error: "Invalid activityId" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: business, error: bizErr } = await supabase
      .from("businesses")
      .select("timezone")
      .eq("id", businessId)
      .maybeSingle();
    if (bizErr) {
      console.error("[tavari-api-booking-availability] business", bizErr);
      return json({ ok: false, error: bizErr.message }, 500);
    }

    const timeZone = String(business?.timezone || "America/Toronto").trim() || "America/Toronto";
    const today = formatDateInTimeZone(new Date(), timeZone);
    const rangeFrom = fromDate && DATE_RE.test(fromDate) ? fromDate : today;
    let rangeTo = toDate && DATE_RE.test(toDate) ? toDate : addDaysToDateString(rangeFrom, DEFAULT_RANGE_DAYS);
    if (rangeTo < rangeFrom) rangeTo = addDaysToDateString(rangeFrom, DEFAULT_RANGE_DAYS);
    const maxTo = addDaysToDateString(rangeFrom, MAX_RANGE_DAYS);
    if (rangeTo > maxTo) rangeTo = maxTo;

    let activityQuery = supabase
      .from("booking_activities")
      .select("id, activity_name, type_id, booking_types!inner(type_key)")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .eq("portal_visible", true);

    if (activityId) activityQuery = activityQuery.eq("id", activityId);
    if (typeKey) activityQuery = activityQuery.eq("booking_types.type_key", typeKey);

    const { data: activityRows, error: actErr } = await activityQuery.order("activity_name");
    if (actErr) {
      console.error("[tavari-api-booking-availability] activities", actErr);
      return json({ ok: false, error: actErr.message }, 500);
    }

    const activities = (activityRows ?? []).map((row) => {
      const bt = row.booking_types as { type_key?: string } | { type_key?: string }[] | null;
      const typeKeyValue = Array.isArray(bt) ? bt[0]?.type_key : bt?.type_key;
      return {
        id: row.id as string,
        activity_name: row.activity_name as string,
        type_id: row.type_id as string | null,
        type_key: String(typeKeyValue ?? "").trim(),
      } satisfies ActivityAvailabilityRow;
    });

    if (activities.length === 0) {
      return json({
        ok: true,
        businessId,
        timezone: timeZone,
        fromDate: rangeFrom,
        toDate: rangeTo,
        summaries: { dropInPlay: null, party: null, camp: null },
        activities: [],
      });
    }

    const activityIds = activities.map((a) => a.id);
    const { data: scheduleRows, error: schedErr } = await supabase
      .from("booking_activity_schedules")
      .select(BOOKING_AVAILABILITY_SCHEDULE_COLS)
      .eq("business_id", businessId)
      .in("activity_id", activityIds)
      .eq("is_active", true);
    if (schedErr) {
      console.error("[tavari-api-booking-availability] schedules", schedErr);
      return json({ ok: false, error: schedErr.message }, 500);
    }

    const schedulesByActivity = new Map<string, ScheduleRow[]>();
    for (const row of (scheduleRows ?? []) as ScheduleRow[]) {
      const list = schedulesByActivity.get(row.activity_id) ?? [];
      list.push(row);
      schedulesByActivity.set(row.activity_id, list);
    }

    const dateStrings = enumerateDateStrings(rangeFrom, rangeTo);
    const hostPortalUrl = resolveHostPortalUrl(businessId);
    const publicActivities: PublicActivityAvailability[] = [];

    for (const activity of activities) {
      const schedules = schedulesByActivity.get(activity.id) ?? [];
      const dates = [];

      for (const dateStr of dateStrings) {
        const daySchedules = pickSchedulesForActivityOnDate(schedules, dateStr, timeZone);
        if (daySchedules.length === 0) {
          dates.push(buildDateAvailability(dateStr, [], {}));
          continue;
        }

        const { data: occupancyRaw, error: occErr } = await supabase.rpc(
          "booking_get_portal_slot_occupancy",
          {
            p_business_id: businessId,
            p_activity_id: activity.id,
            p_booking_date: dateStr,
            p_exclude_hold_token: null,
          },
        );
        if (occErr) {
          console.error("[tavari-api-booking-availability] occupancy", occErr);
          return json({ ok: false, error: occErr.message }, 500);
        }

        dates.push(
          buildDateAvailability(dateStr, daySchedules, parseOccupancyMap(occupancyRaw)),
        );
      }

      publicActivities.push({
        activityId: activity.id,
        typeKey: activity.type_key,
        name: activity.activity_name,
        portalUrl: `${hostPortalUrl.replace(/\/$/, "")}/${activity.id}`,
        dates,
        nextOpenSlot: findNextOpenSlot(dates, hostPortalUrl, activity.id),
      });
    }

    const summaries = buildWebsiteSummaries(publicActivities, rangeFrom, timeZone);

    return json({
      ok: true,
      businessId,
      timezone: timeZone,
      fromDate: rangeFrom,
      toDate: rangeTo,
      hostPortalUrl,
      summaries,
      activities: includeDetails
        ? publicActivities
        : publicActivities.map(({ activityId, typeKey, name, portalUrl, nextOpenSlot }) => ({
          activityId,
          typeKey,
          name,
          portalUrl,
          nextOpenSlot,
        })),
    });
  } catch (e) {
    console.error("[tavari-api-booking-availability]", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Internal error" }, 500);
  }
});
