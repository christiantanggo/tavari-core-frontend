// Mobile customer booking API — catalog, activity detail, Helcim proxy.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  isSessionResponse,
  requireCustomerSession,
} from "../_shared/requireCustomerSession.ts";
import {
  collectPortalOptionInventoryItemIds,
  parsePortalActivityOptions,
  resolvePortalOptionListPrice,
  resolvePortalOptionUnitPrice,
} from "../_shared/bookingActivityOptions.ts";
import { buildPortalOptionInventoryPrices } from "../_shared/posInventoryBundles.ts";
import {
  resolveCheckoutPricing,
  resolveTicketInventoryItemIds,
} from "../_shared/bookingCheckoutPricing.ts";
import {
  activityRequiresStaffApproval,
  parseOnlinePaymentFromTicketSettings,
} from "../_shared/bookingPaymentSettings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-customer-session",
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

function parsePartySettings(
  ticketSettings: Record<string, unknown>,
  bookingType: Record<string, unknown> | null,
) {
  const sessionRules =
    bookingType?.session_rules && typeof bookingType.session_rules === "object"
      ? (bookingType.session_rules as Record<string, unknown>)
      : {};

  const ticketParty =
    ticketSettings.party_booking === true || ticketSettings.partyBooking === true;
  const categoryParty =
    sessionRules.party_booking === true || sessionRules.partyBooking === true;
  const isBirthdayType =
    String(bookingType?.type_key || "")
      .toLowerCase()
      .trim() === "birthday_party";

  const isPartyBooking = ticketParty || categoryParty || isBirthdayType;
  if (!isPartyBooking) {
    return { isPartyBooking: false, requireBirthdayChild: false };
  }

  const requireBirthdayChild =
    ticketSettings.require_birthday_child != null
      ? ticketSettings.require_birthday_child !== false
      : sessionRules.require_birthday_child !== false;

  return { isPartyBooking: true, requireBirthdayChild };
}

async function loadCatalog(supabase: ReturnType<typeof createClient>, businessId: string) {
  const [typesRes, activitiesRes] = await Promise.all([
    supabase
      .from("booking_types")
      .select("id, type_name, display_name, type_key, display_order")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .order("type_name", { ascending: true }),
    supabase
      .from("booking_activities")
      .select("id, activity_name, type_id, description, duration_minutes, display_order")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .eq("portal_visible", true)
      .order("display_order", { ascending: true })
      .order("activity_name", { ascending: true }),
  ]);

  if (typesRes.error) throw typesRes.error;
  if (activitiesRes.error) throw activitiesRes.error;

  return {
    types: typesRes.data || [],
    activities: activitiesRes.data || [],
  };
}

async function loadActivity(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  activityId: string,
) {
  const { data: activity, error } = await supabase
    .from("booking_activities")
    .select("*")
    .eq("id", activityId)
    .eq("business_id", businessId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!activity) return null;
  if (activity.portal_visible === false) return null;

  const addonSettings = parseJsonField(activity.addon_settings);

  const [sectionsRes, schedulesRes, typeRes, businessRes, inventoryPrices] = await Promise.all([
    supabase
      .from("booking_activity_sections")
      .select("id, section_header, section_details, display_order")
      .eq("activity_id", activityId)
      .order("display_order"),
    supabase
      .from("booking_activity_schedules")
      .select(
        "id, day_of_week, start_time, start_date, end_date, spaces, resource_assignments, is_active",
      )
      .eq("activity_id", activityId)
      .eq("business_id", businessId)
      .eq("is_active", true),
    activity.type_id
      ? supabase
          .from("booking_types")
          .select("id, type_name, display_name, type_key, session_rules")
          .eq("id", activity.type_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("businesses")
      .select("timezone")
      .eq("id", businessId)
      .maybeSingle(),
    (async () => {
      const ids = collectPortalOptionInventoryItemIds(addonSettings);
      if (ids.length === 0) return {} as Record<string, number>;
      try {
        return await buildPortalOptionInventoryPrices(supabase, businessId, ids);
      } catch {
        return {} as Record<string, number>;
      }
    })(),
  ]);

  const { groups } = parsePortalActivityOptions(addonSettings);
  const portalOptionGroups = groups.map((group) => ({
    id: group.id,
    name: group.name,
    maxSelections: group.max_selections,
    options: group.options.map((opt) => ({
      id: opt.id,
      name: opt.name,
      included: opt.included,
      required: opt.required,
      maxQuantity: opt.max_quantity,
      unitPrice: resolvePortalOptionUnitPrice(group, opt, inventoryPrices),
      listUnitPrice: resolvePortalOptionListPrice(group, opt, inventoryPrices),
      inventoryItemId: opt.inventory_item_id,
      sortOrder: opt.sort_order ?? 0,
      inputType: opt.input_type === "checkbox" ? "checkbox" as const : "quantity" as const,
    })),
  }));

  const defaultOptionSelections: Record<string, number> = {};
  for (const group of groups) {
    if (group.max_selections === 1 && group.options.every((opt) => opt.included)) {
      continue;
    }
    const included = group.options.find((opt) => opt.included);
    if (included) defaultOptionSelections[included.id] = 1;
  }

  const ticketSettings = parseJsonField(activity.ticket_settings);
  const bookingType = typeRes.data as Record<string, unknown> | null;
  const partySettings = parsePartySettings(ticketSettings, bookingType);

  const ticketInventoryIds = resolveTicketInventoryItemIds(ticketSettings);
  let ticketInventoryRows: Array<{
    id: string;
    name?: string | null;
    price?: number | string | null;
    website_online_price?: number | string | null;
    age_restriction?: unknown;
  }> = [];
  if (ticketInventoryIds.length > 0) {
    const { data: inventoryData } = await supabase
      .from("pos_inventory")
      .select("id, name, price, website_online_price, age_restriction")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .in("id", ticketInventoryIds);
    ticketInventoryRows = inventoryData || [];
  }

  const checkoutPricing = resolveCheckoutPricing(
    ticketSettings,
    partySettings.isPartyBooking,
    ticketInventoryRows,
  );

  const onlinePayment = parseOnlinePaymentFromTicketSettings(ticketSettings);

  return {
    activity: {
      ...activity,
      ticket_settings: ticketSettings,
      addon_settings: addonSettings,
    },
    bookingType,
    partySettings,
    businessTimezone: String(businessRes.data?.timezone || "America/Toronto"),
    sections: sectionsRes.data || [],
    schedules: schedulesRes.data || [],
    portalOptionGroups,
    defaultOptionSelections,
    checkoutPricing,
    requiresStaffApproval: activityRequiresStaffApproval(ticketSettings),
    onlinePayment: {
      mode: onlinePayment.mode,
      autoApprove: onlinePayment.autoApprove,
      depositDueDaysAfterApproval: onlinePayment.depositDueDaysAfterApproval,
    },
  };
}

async function proxyFunction(
  functionName: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  return json(payload as Record<string, unknown>, res.status);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const body = req.method === "POST"
      ? ((await req.json().catch(() => ({}))) as Record<string, unknown>)
      : {};
    const action = String(body.action || url.searchParams.get("action") || "catalog").trim();
    const businessId = String(
      body.businessId || url.searchParams.get("businessId") || "",
    ).trim();

    if (!UUID_RE.test(businessId)) {
      return json({ error: "Invalid businessId" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "catalog") {
      const catalog = await loadCatalog(supabase, businessId);
      return json({ ok: true, businessId, ...catalog });
    }

    if (action === "activity") {
      const activityId = String(body.activityId || url.searchParams.get("activityId") || "").trim();
      if (!UUID_RE.test(activityId)) return json({ error: "Invalid activityId" }, 400);
      const detail = await loadActivity(supabase, businessId, activityId);
      if (!detail) return json({ error: "Activity not found" }, 404);
      return json({ ok: true, businessId, ...detail });
    }

    const session = await requireCustomerSession(req);
    if (isSessionResponse(session)) {
      return new Response(session.body, {
        status: session.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (session.businessId !== businessId) {
      return json({ error: "Session business mismatch" }, 403);
    }

    if (action === "helcimInit") {
      return proxyFunction("helcim-pay-init", {
        ...body,
        businessId,
        customerId: session.customerId,
      });
    }

    if (action === "helcimFinalize") {
      return proxyFunction("helcim-pay-finalize", {
        ...body,
        businessId,
        customerId: session.customerId,
      });
    }

    if (action === "submitRequest") {
      return proxyFunction("booking-submit-request", {
        ...body,
        businessId,
        customerId: session.customerId,
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("[tavari-api-customer-booking]", error);
    return json(
      { error: error instanceof Error ? error.message : "Server error" },
      500,
    );
  }
});
