// Public camp session calendar for external websites (OTWK).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  CAMP_SESSIONS_ACTIVITY_COLS,
  CAMP_SESSIONS_INVENTORY_COLS,
  CAMP_SESSIONS_SCHEDULE_COLS,
  VALID_CAMP_KEYS,
  campProgramMatchesKey,
  collectInventoryIds,
  extractCampSessionDates,
  formatDateInTimeZone,
  mapCampSession,
  parseOccupancyMap,
  resolveHostPortalUrl,
  sortCampSessions,
  type CampActivityRow,
  type CampScheduleRow,
  type InventoryRow,
  type PublicCampSession,
  type WebsiteCampKey,
} from "../_shared/tavariPublicCampSessions.ts";
import { addDaysToDateString } from "../_shared/tavariPublicBookingAvailability.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const DEFAULT_RANGE_DAYS: Record<string, number> = {
  pa_day: 365,
  summer: 120,
  march_break: 90,
  winter_break: 90,
};

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
  const campKey = String(
    body.campKey ?? body.camp_key ?? url.searchParams.get("campKey") ??
      url.searchParams.get("camp_key") ?? "",
  ).trim().toLowerCase();
  const fromDate = String(
    body.fromDate ?? body.from_date ?? url.searchParams.get("fromDate") ??
      url.searchParams.get("from_date") ?? "",
  ).trim();
  const toDate = String(
    body.toDate ?? body.to_date ?? url.searchParams.get("toDate") ??
      url.searchParams.get("to_date") ?? "",
  ).trim();
  const includePastRaw = String(
    body.includePast ?? body.include_past ?? url.searchParams.get("includePast") ??
      url.searchParams.get("include_past") ?? "false",
  ).trim().toLowerCase();
  const includePast = includePastRaw === "true" || includePastRaw === "1";
  return { businessId, activityId, campKey, fromDate, toDate, includePast };
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
    const { businessId, activityId, campKey, fromDate, toDate, includePast } = resolveParams(req, body);

    if (!businessId || !UUID_RE.test(businessId)) {
      return json({ ok: false, error: "Valid businessId is required" }, 400);
    }
    if (activityId && !UUID_RE.test(activityId)) {
      return json({ ok: false, error: "Invalid activityId" }, 400);
    }
    if (campKey && !VALID_CAMP_KEYS.includes(campKey as WebsiteCampKey)) {
      return json({
        ok: false,
        error: `Invalid campKey. Use one of: ${VALID_CAMP_KEYS.join(", ")}`,
      }, 400);
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
      console.error("[tavari-api-camp-sessions] business", bizErr);
      return json({ ok: false, error: bizErr.message }, 500);
    }

    const timeZone = String(business?.timezone || "America/Toronto").trim() || "America/Toronto";
    const today = formatDateInTimeZone(new Date(), timeZone);
    const rangeKey = campKey || "summer";
    const defaultDays = DEFAULT_RANGE_DAYS[rangeKey] ?? 120;
    const rangeFrom = fromDate && DATE_RE.test(fromDate) ? fromDate : today;
    let rangeTo = toDate && DATE_RE.test(toDate)
      ? toDate
      : addDaysToDateString(rangeFrom, defaultDays);
    if (rangeTo < rangeFrom) rangeTo = addDaysToDateString(rangeFrom, defaultDays);

    let activityQuery = supabase
      .from("booking_activities")
      .select(CAMP_SESSIONS_ACTIVITY_COLS)
      .eq("business_id", businessId)
      .eq("website_show_camp_sessions", true)
      .eq("is_active", true);

    if (activityId) activityQuery = activityQuery.eq("id", activityId);

    const { data: activityRows, error: actErr } = await activityQuery.order("activity_name");
    if (actErr) {
      console.error("[tavari-api-camp-sessions] activities", actErr);
      return json({ ok: false, error: actErr.message }, 500);
    }

    let activities = (activityRows ?? []) as CampActivityRow[];
    if (campKey) {
      activities = activities.filter((activity) =>
        campProgramMatchesKey(activity.website_camp_program, campKey)
      );
    }

    const hostPortalUrl = resolveHostPortalUrl(businessId);
    if (activities.length === 0) {
      return json({
        ok: true,
        businessId,
        timezone: timeZone,
        campKey: campKey || null,
        fromDate: rangeFrom,
        toDate: rangeTo,
        hostPortalUrl,
        sessions: [] as PublicCampSession[],
      });
    }

    const activityIds = activities.map((activity) => activity.id);
    const inventoryIds = collectInventoryIds(activities);

    const [{ data: scheduleRows, error: schedErr }, inventoryResult] = await Promise.all([
      supabase
        .from("booking_activity_schedules")
        .select(CAMP_SESSIONS_SCHEDULE_COLS)
        .eq("business_id", businessId)
        .in("activity_id", activityIds)
        .eq("is_active", true),
      inventoryIds.length > 0
        ? supabase
          .from("pos_inventory")
          .select(CAMP_SESSIONS_INVENTORY_COLS)
          .eq("business_id", businessId)
          .in("id", inventoryIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (schedErr) {
      console.error("[tavari-api-camp-sessions] schedules", schedErr);
      return json({ ok: false, error: schedErr.message }, 500);
    }
    if (inventoryResult.error) {
      console.error("[tavari-api-camp-sessions] inventory", inventoryResult.error);
      return json({ ok: false, error: inventoryResult.error.message }, 500);
    }

    const inventoryById = new Map<string, InventoryRow>(
      ((inventoryResult.data ?? []) as InventoryRow[]).map((row) => [row.id, row]),
    );

    const schedulesByActivity = new Map<string, CampScheduleRow[]>();
    for (const row of (scheduleRows ?? []) as CampScheduleRow[]) {
      const list = schedulesByActivity.get(row.activity_id) ?? [];
      list.push(row);
      schedulesByActivity.set(row.activity_id, list);
    }

    const activityById = new Map(activities.map((activity) => [activity.id, activity]));
    const occupancyCache = new Map<string, Record<string, number>>();
    const sessions: PublicCampSession[] = [];

    for (const activity of activities) {
      const schedules = schedulesByActivity.get(activity.id) ?? [];
      const sessionDates = extractCampSessionDates(
        schedules,
        rangeFrom,
        rangeTo,
        includePast,
        today,
      );
      const inventoryId = collectInventoryIds([activity])[0] ?? null;
      const inventory = inventoryId ? inventoryById.get(inventoryId) ?? null : null;

      for (const { date, schedules: dateSchedules } of sessionDates) {
        const cacheKey = `${activity.id}|${date}`;
        let occupancy = occupancyCache.get(cacheKey);
        if (!occupancy) {
          const { data: occupancyRaw, error: occErr } = await supabase.rpc(
            "booking_get_portal_slot_occupancy",
            {
              p_business_id: businessId,
              p_activity_id: activity.id,
              p_booking_date: date,
              p_exclude_hold_token: null,
            },
          );
          if (occErr) {
            console.error("[tavari-api-camp-sessions] occupancy", occErr);
            return json({ ok: false, error: occErr.message }, 500);
          }
          occupancy = parseOccupancyMap(occupancyRaw);
          occupancyCache.set(cacheKey, occupancy);
        }

        const seenScheduleIds = new Set<string>();
        for (const schedule of dateSchedules) {
          if (seenScheduleIds.has(schedule.id)) continue;
          seenScheduleIds.add(schedule.id);
          const session = mapCampSession(
            activity,
            schedule,
            date,
            occupancy,
            inventory,
            hostPortalUrl,
            today,
          );
          if (session) sessions.push(session);
        }
      }
    }

    const sorted = sortCampSessions(sessions);

    return json({
      ok: true,
      businessId,
      timezone: timeZone,
      campKey: campKey || null,
      fromDate: rangeFrom,
      toDate: rangeTo,
      hostPortalUrl,
      sessions: sorted,
      activities: sorted.length > 0
        ? Array.from(new Set(sorted.map((session) => session.activityId))).map((id) => {
          const activity = activityById.get(id);
          return {
            activityId: id,
            activityName: activity?.activity_name ?? "",
            campProgram: activity?.website_camp_program ?? null,
          };
        })
        : [],
    });
  } catch (e) {
    console.error("[tavari-api-camp-sessions]", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Internal error" }, 500);
  }
});
