// Public read-only booking catalog for external websites (OTWK Book now CTAs).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveTicketInventoryItemIds,
} from "../_shared/bookingCheckoutPricing.ts";
import {
  BOOKING_ACTIVITY_CATALOG_SELECT_COLS,
  BOOKING_TYPE_SELECT_COLS,
  mapActivityToPublicBookingActivity,
  mapTypeToPublicBookingType,
  resolveHostPortalUrl,
  type BookingActivityRow,
  type BookingTypeRow,
  type InventoryPriceRow,
  type PublicBookingActivity,
  type PublicBookingType,
} from "../_shared/tavariPublicBookingCatalog.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function resolveBusinessId(req: Request, body: Record<string, unknown>): string {
  const url = new URL(req.url);
  return String(
    body.businessId
      ?? body.business_id
      ?? url.searchParams.get("businessId")
      ?? url.searchParams.get("business_id")
      ?? "",
  ).trim();
}

function parseJsonField(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  return {};
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
    const businessId = resolveBusinessId(req, body);

    if (!businessId || !UUID_RE.test(businessId)) {
      return json({ ok: false, error: "Valid businessId is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const [{ data: types, error: typesErr }, { data: activities, error: actErr }, { data: business, error: bizErr }] =
      await Promise.all([
        supabase
          .from("booking_types")
          .select(BOOKING_TYPE_SELECT_COLS)
          .eq("business_id", businessId)
          .eq("is_active", true)
          .order("display_order", { ascending: true })
          .order("type_name", { ascending: true }),
        supabase
          .from("booking_activities")
          .select(BOOKING_ACTIVITY_CATALOG_SELECT_COLS)
          .eq("business_id", businessId)
          .eq("is_active", true)
          .eq("portal_visible", true)
          .order("display_order", { ascending: true })
          .order("activity_name", { ascending: true }),
        supabase
          .from("businesses")
          .select("name")
          .eq("id", businessId)
          .maybeSingle(),
      ]);

    if (typesErr) {
      console.error("[tavari-api-booking-catalog] types", typesErr);
      return json({ ok: false, error: typesErr.message }, 500);
    }
    if (actErr) {
      console.error("[tavari-api-booking-catalog] activities", actErr);
      return json({ ok: false, error: actErr.message }, 500);
    }
    if (bizErr) {
      console.error("[tavari-api-booking-catalog] business", bizErr);
      return json({ ok: false, error: bizErr.message }, 500);
    }

    const typeRows = (types ?? []) as BookingTypeRow[];
    const activityRows = (activities ?? []) as BookingActivityRow[];
    const typeById = new Map(typeRows.map((row) => [row.id, row]));

    const inventoryIds = new Set<string>();
    for (const activity of activityRows) {
      const ticketSettings = parseJsonField(activity.ticket_settings);
      for (const id of resolveTicketInventoryItemIds(ticketSettings)) {
        inventoryIds.add(id);
      }
    }

    let inventoryById = new Map<string, InventoryPriceRow>();
    if (inventoryIds.size > 0) {
      const { data: inventoryRows, error: invErr } = await supabase
        .from("pos_inventory")
        .select("id, name, price, website_online_price, age_restriction")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .in("id", Array.from(inventoryIds));

      if (invErr) {
        console.error("[tavari-api-booking-catalog] inventory", invErr);
        return json({ ok: false, error: invErr.message }, 500);
      }

      inventoryById = new Map(
        ((inventoryRows ?? []) as InventoryPriceRow[]).map((row) => [row.id, row]),
      );
    }

    const hostPortalUrl = resolveHostPortalUrl(businessId);
    const activityCountByType = new Map<string, number>();
    for (const activity of activityRows) {
      if (!activity.type_id) continue;
      activityCountByType.set(
        activity.type_id,
        (activityCountByType.get(activity.type_id) ?? 0) + 1,
      );
    }

    const publicTypes: PublicBookingType[] = typeRows
      .filter((type) => (activityCountByType.get(type.id) ?? 0) > 0)
      .map((type) =>
        mapTypeToPublicBookingType(type, {
          hostPortalUrl,
          activityCount: activityCountByType.get(type.id) ?? 0,
        })
      );

    const publicActivities: PublicBookingActivity[] = activityRows.map((activity, index) =>
      mapActivityToPublicBookingActivity(activity, {
        hostPortalUrl,
        typeById,
        inventoryById,
        sortOrder: index,
      })
    );

    return json({
      ok: true,
      businessId,
      businessName: String(business?.name ?? "").trim(),
      hostPortalUrl,
      types: publicTypes,
      activities: publicActivities,
    });
  } catch (e) {
    console.error("[tavari-api-booking-catalog]", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Internal error" }, 500);
  }
});
