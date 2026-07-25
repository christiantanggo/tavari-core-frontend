import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  collectPortalOptionInventoryItemIds,
  validatePortalOptionRowsAgainstActivity,
} from "../_shared/bookingActivityOptions.ts";
import {
  activityRequiresStaffApproval,
  parseOnlinePaymentFromTicketSettings,
} from "../_shared/bookingPaymentSettings.ts";
import { buildPortalOptionInventoryPrices } from "../_shared/posInventoryBundles.ts";
import { createPortalBooking } from "../_shared/createPortalBooking.ts";
import { getRequestClientIp } from "../_shared/requestClientIp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const businessId = String(body.businessId || body.business_id || "").trim();
    const activityId = String(body.activityId || body.activity_id || "").trim();
    const bookingDate = String(body.bookingDate || body.booking_date || "").trim();
    const bookingTime = String(body.bookingTime || body.booking_time || "").trim();
    const customerId = body.customerId || body.customer_id ? String(body.customerId || body.customer_id) : null;
    const orderTotalWithTax = Number(body.orderTotalWithTax ?? body.order_total_with_tax ?? 0);
    const taxAmount = Number(body.taxAmount ?? body.tax_amount ?? 0);
    const participantRows = Array.isArray(body.participantRows) ? body.participantRows : [];
    const addonRows = Array.isArray(body.addonRows) ? body.addonRows : [];
    const slotHoldToken = body.slotHoldToken || body.slot_hold_token
      ? String(body.slotHoldToken || body.slot_hold_token)
      : null;

    if (!businessId || !activityId || !bookingDate || !bookingTime) {
      return jsonResponse({ error: "Missing required booking fields." }, 400);
    }
    if (participantRows.length === 0) {
      return jsonResponse({ error: "At least one participant is required." }, 400);
    }
    if (!Number.isFinite(orderTotalWithTax) || orderTotalWithTax <= 0) {
      return jsonResponse({ error: "Invalid order total." }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: activity, error: activityError } = await supabase
      .from("booking_activities")
      .select("id, business_id, is_active, ticket_settings, addon_settings")
      .eq("id", activityId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (activityError || !activity || activity.is_active === false) {
      return jsonResponse({ error: "Booking activity not found or inactive." }, 400);
    }

    let ticketSettings: Record<string, unknown> = {};
    const rawTicketSettings = (activity as { ticket_settings?: unknown }).ticket_settings;
    if (typeof rawTicketSettings === "string") {
      try {
        ticketSettings = JSON.parse(rawTicketSettings) as Record<string, unknown>;
      } catch {
        ticketSettings = {};
      }
    } else if (rawTicketSettings && typeof rawTicketSettings === "object") {
      ticketSettings = rawTicketSettings as Record<string, unknown>;
    }

    if (!activityRequiresStaffApproval(ticketSettings)) {
      return jsonResponse(
        { error: "This activity does not accept booking requests. Complete payment at checkout instead." },
        400,
      );
    }

    const addonSettingsRaw = (activity as { addon_settings?: unknown }).addon_settings;
    const portalInventoryIds = collectPortalOptionInventoryItemIds(addonSettingsRaw);
    let inventoryPrices: Record<string, number> = {};
    if (portalInventoryIds.length > 0) {
      inventoryPrices = await buildPortalOptionInventoryPrices(supabase, businessId, portalInventoryIds);
    }
    const addonValidation = validatePortalOptionRowsAgainstActivity(
      addonSettingsRaw,
      addonRows,
      inventoryPrices,
    );
    if (!addonValidation.ok) {
      return jsonResponse({ error: addonValidation.message }, 400);
    }

    const result = await createPortalBooking(supabase, {
      businessId,
      activityId,
      customerId,
      bookingDate,
      bookingTime,
      participantRows: participantRows as Record<string, unknown>[],
      addonRows: addonRows as Record<string, unknown>[],
      orderTotal: orderTotalWithTax,
      taxAmount: Number.isFinite(taxAmount) ? taxAmount : 0,
      requiresApproval: true,
      status: "pending",
      clientIp: getRequestClientIp(req),
      slotHoldToken,
    });

    if (!result.ok) {
      return jsonResponse({ error: result.message }, result.status);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    try {
      await fetch(`${supabaseUrl}/functions/v1/send-booking-request-received`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          businessId,
          bookingId: result.bookingId,
          manageToken: result.manageToken,
        }),
      });
    } catch (mailErr) {
      console.warn("[booking-submit-request] request received email failed:", mailErr);
    }

    return jsonResponse(
      {
        bookingId: result.bookingId,
        manageToken: result.manageToken,
        bookingNumber: result.bookingNumber,
        termsAckToken: result.termsAckToken || null,
        requiresApproval: true,
        onlinePayment: parseOnlinePaymentFromTicketSettings(ticketSettings),
      },
      200,
    );
  } catch (err) {
    console.error("[booking-submit-request]", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Server error" }, 500);
  }
});
