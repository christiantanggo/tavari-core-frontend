// Supabase Edge Function: Initialize HelcimPay.js checkout session.
// Body includes checkout metadata so we can create a pending booking row before Helcim opens.
//
// HelcimPay modal styling (optional overrides):
//   Env: HELCIM_PAY_APPEARANCE (light|dark|system), HELCIM_PAY_BRAND_COLOR (hex no #, default 008080),
//        HELCIM_PAY_CORNER_RADIUS (pill|rectangular|rounded), HELCIM_PAY_CTA_BUTTON_TEXT (book|buy|checkout|…),
//        HELCIM_PAY_CONFIRMATION_SCREEN (true|false — default true for booking purchase)
//        HELCIM_PAY_VERIFY_CONFIRMATION_SCREEN (true|false — default false for save-card verify; optional new confirmation UI)
//   Body: customStyling: { appearance?, brandColor?, cornerRadius?, ctaButtonText? } merges over env/defaults

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getHelcimCredentialsForBusiness } from "../_shared/helcimBusinessCredentials.ts";
import {
  parseOnlinePaymentFromTicketSettings,
  calculateOnlineCheckoutAmounts,
  amountsMatchWithinCent,
} from "../_shared/bookingPaymentSettings.ts";
import { collectPortalOptionInventoryItemIds, validatePortalOptionRowsAgainstActivity } from "../_shared/bookingActivityOptions.ts";
import { buildPortalOptionInventoryPrices } from "../_shared/posInventoryBundles.ts";
import { getRequestClientIp } from "../_shared/requestClientIp.ts";
import { getActivePaymentRequest } from "../_shared/bookingPaymentRequest.ts";
import { assertBookingWithinBusinessHours } from "../_shared/businessHoursValidation.ts";
import { validateBookingSlotHold } from "../_shared/bookingSlotHolds.ts";
import { validatePortalHelcimCheckoutAmounts } from "../_shared/bookingPortalCheckoutPricing.ts";
import { assertUniqueBookingParticipantIdentities } from "../_shared/assertUniqueBookingParticipants.ts";
import { previewGiftCardForBookingCharge } from "../_shared/bookingGiftCards.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const DEFAULT_BRAND_COLOR_NO_HASH = "008080"; // Tavari primary teal

function pickFirstString(...vals: (string | undefined | null)[]): string {
  for (const v of vals) {
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/** Helcim expects 3 or 6 hex chars without # */
function normalizeBrandColorHex(input: string | undefined): string {
  const raw = pickFirstString(input);
  if (!raw) return DEFAULT_BRAND_COLOR_NO_HASH;
  const t = raw.replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(t) || /^[0-9a-f]{6}$/.test(t)) return t;
  return DEFAULT_BRAND_COLOR_NO_HASH;
}

function parseConfirmationScreen(): boolean {
  const v = Deno.env.get("HELCIM_PAY_CONFIRMATION_SCREEN")?.trim().toLowerCase();
  if (v === "false" || v === "0" || v === "no") return false;
  return true;
}

/** Card-on-file verify flow previously used toast (false); opt in with HELCIM_PAY_VERIFY_CONFIRMATION_SCREEN=true */
function parseConfirmationScreenVerify(): boolean {
  const v = Deno.env.get("HELCIM_PAY_VERIFY_CONFIRMATION_SCREEN")?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** Merges request body.customStyling over env and Tavari defaults; see Helcim customStyling docs. */
function buildCustomStyling(body: Record<string, unknown>): Record<string, string> {
  const ov = body.customStyling;
  const o = ov && typeof ov === "object" && !Array.isArray(ov) ? ov as Record<string, unknown> : {};

  const appearanceRaw = pickFirstString(
    o.appearance != null ? String(o.appearance) : "",
    Deno.env.get("HELCIM_PAY_APPEARANCE"),
    "light",
  );
  const appearance = ["dark", "light", "system"].includes(appearanceRaw) ? appearanceRaw : "light";

  const brandColor = normalizeBrandColorHex(
    pickFirstString(
      o.brandColor != null ? String(o.brandColor) : "",
      Deno.env.get("HELCIM_PAY_BRAND_COLOR"),
    ),
  );

  const radiusRaw = pickFirstString(
    o.cornerRadius != null ? String(o.cornerRadius) : "",
    Deno.env.get("HELCIM_PAY_CORNER_RADIUS"),
    "rounded",
  );
  const cornerRadius = ["pill", "rectangular", "rounded"].includes(radiusRaw) ? radiusRaw : "rounded";

  const ctaAllowed = new Set(["book", "buy", "checkout", "donate", "order", "pay", "subscribe"]);
  const ctaRaw = pickFirstString(
    o.ctaButtonText != null ? String(o.ctaButtonText) : "",
    Deno.env.get("HELCIM_PAY_CTA_BUTTON_TEXT"),
    "book",
  );
  const ctaButtonText = ctaAllowed.has(ctaRaw) ? ctaRaw : "book";

  return {
    appearance,
    brandColor,
    cornerRadius,
    ctaButtonText,
  };
}

function attachHelcimPayPresentation(
  payload: Record<string, unknown>,
  body: Record<string, unknown>,
  mode: "purchase" | "verify",
) {
  payload.customStyling = buildCustomStyling(body);
  payload.confirmationScreen = mode === "verify"
    ? parseConfirmationScreenVerify()
    : parseConfirmationScreen();
}

/** Helcim v2 errors may use message, error, errors[], detail, title, or raw non-JSON body. */
function summarizeHelcimInitFailure(
  status: number,
  data: Record<string, unknown>,
  rawText: string,
): string {
  const pick = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, 1200) : null;

  const msg =
    pick(data.message) ||
    pick(data.error) ||
    pick(data.detail) ||
    pick(data.title) ||
    (typeof data.errors === "string" ? pick(data.errors) : null) ||
    (Array.isArray(data.errors) ? JSON.stringify(data.errors).slice(0, 1200) : null) ||
    (data.errors && typeof data.errors === "object"
      ? JSON.stringify(data.errors).slice(0, 1200)
      : null);

  if (msg) return msg;

  const raw = rawText?.trim();
  if (raw && raw.length > 0) return raw.slice(0, 1200);

  return `Helcim rejected initialize (HTTP ${status}).`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    let body: Record<string, unknown> = {};
    try {
      const raw = await req.json();
      body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    } catch {
      // ignore parse error
    }

    const clientIp = getRequestClientIp(req);

    const amount = Number(body.amount);
    const currency = (body.currency && String(body.currency).toUpperCase()) || "CAD";
    const customerCode = body.customerCode ? String(body.customerCode).trim() : undefined;
    const setAsDefault = body.setAsDefaultPaymentMethod === true || body.setAsDefaultPaymentMethod === "1";
    const hideExistingPaymentDetails =
      body.hideExistingPaymentDetails === true || body.hideExistingPaymentDetails === "1";
    const mode = body.mode ? String(body.mode).trim() : "";
    const businessId = body.businessId ? String(body.businessId).trim() : "";
    const activityId = body.activityId ? String(body.activityId).trim() : "";
    const bookingDate = body.bookingDate ? String(body.bookingDate).trim() : "";
    const bookingTime = body.bookingTime ? String(body.bookingTime).trim() : "";
    const customerId = body.customerId ? String(body.customerId).trim() : null;
    const participantRows = Array.isArray(body.participantRows) ? body.participantRows : [];
    const addonRows = Array.isArray(body.addonRows) ? body.addonRows : [];
    const slotHoldToken = body.slotHoldToken || body.slot_hold_token
      ? String(body.slotHoldToken || body.slot_hold_token).trim()
      : "";
    const promoCode = body.promoCode ? String(body.promoCode).trim() : "";
    const clientPricingPromotionId = body.pricingPromotionId
      ? String(body.pricingPromotionId).trim()
      : "";
    const giftCardCode = body.giftCardCode || body.gift_card_code
      ? String(body.giftCardCode || body.gift_card_code).trim()
      : "";

    if (!Number.isFinite(amount) || amount < 0) {
      return new Response(
        JSON.stringify({ error: "Invalid amount. Send { amount: number, currency?: string }." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!businessId) {
      return new Response(
        JSON.stringify({ error: "Missing businessId." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Supabase service role is not configured." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const helcimCreds = await getHelcimCredentialsForBusiness(supabase, businessId);
    const HELCIM_API_TOKEN = helcimCreds?.apiToken;
    if (!HELCIM_API_TOKEN) {
      return new Response(
        JSON.stringify({
          error:
            "Helcim Pay is not configured for this business. Add your Helcim API token under POS → Settings → Payments.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const customerResult = customerId
      ? await supabase
          .from("pos_loyalty_accounts")
          .select("id, helcim_customer_code, customer_email")
          .eq("id", customerId)
          .eq("business_id", businessId)
          .maybeSingle()
      : { data: null, error: null };

    if (customerId && (customerResult.error || !customerResult.data)) {
      return new Response(
        JSON.stringify({ error: "Customer account does not belong to this business." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (mode === "store_customer_card") {
      const payload: Record<string, unknown> = {
        paymentType: "verify",
        amount: 0,
        currency,
        setAsDefaultPaymentMethod: setAsDefault ? "1" : "0",
        hideExistingPaymentDetails: hideExistingPaymentDetails ? "1" : "0",
      };

      const resolvedCustomerCode = customerCode || customerResult.data?.helcim_customer_code || undefined;
      if (resolvedCustomerCode) payload.customerCode = resolvedCustomerCode;

      // Verify flow: button label stays "Save" per Helcim; still apply colors/theme for on-brand modal.
      attachHelcimPayPresentation(payload, body, "verify");

      const initRes = await fetch("https://api.helcim.com/v2/helcim-pay/initialize", {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-token": HELCIM_API_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const rawVerify = await initRes.text();
      let data: Record<string, unknown> = {};
      try {
        data = rawVerify ? (JSON.parse(rawVerify) as Record<string, unknown>) : {};
      } catch {
        data = {};
      }
      if (!initRes.ok) {
        const errOut = summarizeHelcimInitFailure(initRes.status, data, rawVerify);
        console.error("[helcim-pay-init] verify flow Helcim error:", initRes.status, errOut);
        return new Response(
          JSON.stringify({ error: errOut }),
          {
            status: initRes.status >= 400 ? initRes.status : 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const checkoutToken = (data.checkoutToken ?? data.checkout_token) as string | undefined;
      const secretToken = (data.secretToken ?? data.secret_token) as string | undefined;
      if (!checkoutToken) {
        return new Response(
          JSON.stringify({ error: "No checkout token from Helcim" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ checkoutToken, secretToken: secretToken ?? null }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Self-serve kiosk: hosted Helcim Pay (QR on screen; customer pays on phone with card / Apple Pay / Google Pay).
    if (mode === "kiosk" || mode === "self_serve_kiosk") {
      if (!Number.isFinite(amount) || amount <= 0) {
        return new Response(
          JSON.stringify({ error: "Kiosk mode requires a positive amount." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const pendingId = crypto.randomUUID();
      const invoiceNumber = `KK-${pendingId}`;
      const kioskLabel = body.kioskLabel != null
        ? String(body.kioskLabel).trim().slice(0, 240)
        : "";
      const lineDescription = kioskLabel || "Kiosk payment";

      const { error: kioskInsertError } = await supabase
        .from("kiosk_helcim_pending")
        .insert({
          id: pendingId,
          invoice_number: invoiceNumber,
          business_id: businessId,
          amount: Number(amount.toFixed(2)),
          currency,
          label: kioskLabel || null,
          status: "pending",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (kioskInsertError) {
        console.error("[helcim-pay-init] kiosk insert:", kioskInsertError);
        return new Response(
          JSON.stringify({ error: "Could not create kiosk checkout session." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const amtKiosk = Number(amount.toFixed(2));
      const invoiceRequest = {
        currency,
        invoiceNumber,
        lineItems: [
          {
            description: lineDescription,
            quantity: 1,
            price: amtKiosk,
            total: amtKiosk,
          },
        ],
      };

      const payloadKiosk: Record<string, unknown> = {
        paymentType: "purchase",
        amount: amtKiosk,
        currency,
        invoiceRequest,
      };
      if (customerCode) payloadKiosk.customerCode = customerCode;

      attachHelcimPayPresentation(payloadKiosk, body, "purchase");

      const initKioskRes = await fetch("https://api.helcim.com/v2/helcim-pay/initialize", {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-token": HELCIM_API_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify(payloadKiosk),
      });

      const rawKiosk = await initKioskRes.text();
      let dataKiosk: Record<string, unknown> = {};
      try {
        dataKiosk = rawKiosk ? (JSON.parse(rawKiosk) as Record<string, unknown>) : {};
      } catch {
        dataKiosk = {};
      }
      if (!initKioskRes.ok) {
        const errOut = summarizeHelcimInitFailure(initKioskRes.status, dataKiosk, rawKiosk);
        console.error("[helcim-pay-init] kiosk Helcim error:", initKioskRes.status, errOut);
        await supabase
          .from("kiosk_helcim_pending")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", pendingId);
        return new Response(
          JSON.stringify({ error: errOut }),
          {
            status: initKioskRes.status >= 400 ? initKioskRes.status : 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const checkoutTokenKiosk = (dataKiosk.checkoutToken ?? dataKiosk.checkout_token) as string | undefined;
      const secretTokenKiosk = (dataKiosk.secretToken ?? dataKiosk.secret_token) as string | undefined;
      if (!checkoutTokenKiosk) {
        await supabase
          .from("kiosk_helcim_pending")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", pendingId);
        return new Response(
          JSON.stringify({ error: "No checkout token from Helcim" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { error: kioskTokenErr } = await supabase
        .from("kiosk_helcim_pending")
        .update({
          checkout_token: checkoutTokenKiosk,
          secret_token: secretTokenKiosk ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", pendingId);

      if (kioskTokenErr) {
        console.error("[helcim-pay-init] kiosk token update:", kioskTokenErr);
        return new Response(
          JSON.stringify({ error: "Could not save checkout session." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          checkoutToken: checkoutTokenKiosk,
          secretToken: secretTokenKiosk ?? null,
          pendingId,
          invoiceNumber,
          mode: "kiosk",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const existingBookingId = String(body.existingBookingId || body.existing_booking_id || "").trim();

    if (existingBookingId) {
      const { data: existingBooking, error: existingBookingError } = await supabase
        .from("bookings")
        .select("id, business_id, activity_id, customer_id, booking_date, booking_time, approved_at, payment_status, order_total, status")
        .eq("id", existingBookingId)
        .eq("business_id", businessId)
        .maybeSingle();

      if (existingBookingError || !existingBooking) {
        return new Response(
          JSON.stringify({ error: "Booking not found." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!existingBooking.approved_at) {
        return new Response(
          JSON.stringify({ error: "This booking is not approved yet." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (existingBooking.payment_status === "paid") {
        return new Response(
          JSON.stringify({ error: "This booking is already paid." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const orderTotalWithTaxExisting = Number(existingBooking.order_total || body.orderTotalWithTax || amount);
      const activeRequest = await getActivePaymentRequest(supabase, existingBookingId);

      let expectedAmount: number;
      let paymentType: string;

      if (activeRequest) {
        expectedAmount = Number(activeRequest.amount);
        const requestOrderTotal = Number(activeRequest.order_total || orderTotalWithTaxExisting);
        paymentType = expectedAmount < requestOrderTotal - 0.005 ? "deposit" : "full";
      } else {
        const { data: activityForPay } = await supabase
          .from("booking_activities")
          .select("ticket_settings")
          .eq("id", existingBooking.activity_id)
          .eq("business_id", businessId)
          .maybeSingle();

        let ticketSettingsPay: Record<string, unknown> = {};
        const rawPay = (activityForPay as { ticket_settings?: unknown } | null)?.ticket_settings;
        if (typeof rawPay === "string") {
          try {
            ticketSettingsPay = JSON.parse(rawPay) as Record<string, unknown>;
          } catch {
            ticketSettingsPay = {};
          }
        } else if (rawPay && typeof rawPay === "object") {
          ticketSettingsPay = rawPay as Record<string, unknown>;
        }

        const onlinePaymentExisting = parseOnlinePaymentFromTicketSettings(ticketSettingsPay);
        const expectedExisting = calculateOnlineCheckoutAmounts(orderTotalWithTaxExisting, onlinePaymentExisting);
        expectedAmount = expectedExisting.chargeNow;
        paymentType = expectedExisting.isDeposit ? "deposit" : "full";
      }

      if (!amountsMatchWithinCent(amount, expectedAmount)) {
        return new Response(
          JSON.stringify({ error: "Payment amount does not match the required amount." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: participantRowsExisting } = await supabase
        .from("booking_participants")
        .select("participant_id, inventory_item_id, party_role, waiver_id, waiver_status, camper_registration_document_id, camper_registration_status")
        .eq("booking_id", existingBookingId);

      const pendingId = crypto.randomUUID();
      const invoiceNumber = `BP-${pendingId}`;

      const { error: pendingExistingError } = await supabase.from("booking_pending_helcim").insert({
        id: pendingId,
        invoice_number: invoiceNumber,
        business_id: businessId,
        activity_id: existingBooking.activity_id,
        customer_id: existingBooking.customer_id,
        booking_id: existingBookingId,
        booking_date: existingBooking.booking_date,
        booking_time: existingBooking.booking_time,
        participant_rows: participantRowsExisting || [],
        addon_rows: [],
        amount: Number(amount.toFixed(2)),
        order_total: Number(orderTotalWithTaxExisting.toFixed(2)),
        payment_type: paymentType,
        currency,
        status: "pending",
        client_ip: clientIp,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (pendingExistingError) {
        return new Response(
          JSON.stringify({ error: "Could not create payment session." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const amtPurchase = Number(amount.toFixed(2));
      const resolvedExistingCustomerCode =
        customerCode || customerResult.data?.helcim_customer_code || undefined;
      const payloadExisting: Record<string, unknown> = {
        paymentType: "purchase",
        amount: amtPurchase,
        currency,
        invoiceRequest: {
          currency,
          invoiceNumber,
          lineItems: [{ description: "Booking deposit", quantity: 1, price: amtPurchase, total: amtPurchase }],
        },
        setAsDefaultPaymentMethod: "1",
      };
      if (resolvedExistingCustomerCode) payloadExisting.customerCode = resolvedExistingCustomerCode;
      attachHelcimPayPresentation(payloadExisting, body, "purchase");

      const initResExisting = await fetch("https://api.helcim.com/v2/helcim-pay/initialize", {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-token": HELCIM_API_TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify(payloadExisting),
      });

      const rawExisting = await initResExisting.text();
      let dataExisting: Record<string, unknown> = {};
      try {
        dataExisting = rawExisting ? (JSON.parse(rawExisting) as Record<string, unknown>) : {};
      } catch {
        dataExisting = {};
      }
      if (!initResExisting.ok) {
        await supabase.from("booking_pending_helcim").update({ status: "failed" }).eq("id", pendingId);
        return new Response(JSON.stringify({ error: summarizeHelcimInitFailure(initResExisting.status, dataExisting, rawExisting) }), {
          status: initResExisting.status >= 400 ? initResExisting.status : 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const checkoutTokenExisting = (dataExisting.checkoutToken ?? dataExisting.checkout_token) as string | undefined;
      if (!checkoutTokenExisting) {
        return new Response(JSON.stringify({ error: "No checkout token from Helcim" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      await supabase.from("booking_pending_helcim").update({
        checkout_token: checkoutTokenExisting,
        secret_token: (dataExisting.secretToken ?? dataExisting.secret_token) as string | null ?? null,
        updated_at: new Date().toISOString(),
      }).eq("id", pendingId);

      return new Response(
        JSON.stringify({ checkoutToken: checkoutTokenExisting, pendingId, invoiceNumber, existingBookingId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!activityId || !bookingDate || !bookingTime) {
      return new Response(
        JSON.stringify({ error: "Missing activityId, bookingDate, or bookingTime." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (participantRows.length === 0) {
      return new Response(
        JSON.stringify({ error: "At least one participant is required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const uniqueParticipants = assertUniqueBookingParticipantIdentities(participantRows);
    if (!uniqueParticipants.ok) {
      return new Response(
        JSON.stringify({ error: uniqueParticipants.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: activity, error: activityError } = await supabase
      .from("booking_activities")
      .select("id, business_id, is_active, portal_visible, ticket_settings, addon_settings, duration_minutes, type_id")
      .eq("id", activityId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (activityError || !activity || activity.is_active === false || activity.portal_visible === false) {
      return new Response(
        JSON.stringify({ error: "Booking activity not found or inactive." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const hoursCheck = await assertBookingWithinBusinessHours(
      supabase,
      businessId,
      bookingDate,
      bookingTime,
      Number((activity as { duration_minutes?: number }).duration_minutes) > 0
        ? Number((activity as { duration_minutes?: number }).duration_minutes)
        : 60,
    );
    if (!hoursCheck.ok) {
      return new Response(
        JSON.stringify({ error: hoursCheck.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const holdCheck = await validateBookingSlotHold(supabase, {
      holdToken: slotHoldToken,
      businessId,
      activityId,
      bookingDate,
      bookingTime,
    });
    if (!holdCheck.ok) {
      return new Response(
        JSON.stringify({ error: holdCheck.message }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rawTicketSettings = (activity as { ticket_settings?: unknown }).ticket_settings;
    let ticketSettings: Record<string, unknown> = {};
    if (typeof rawTicketSettings === "string") {
      try {
        ticketSettings = JSON.parse(rawTicketSettings) as Record<string, unknown>;
      } catch {
        ticketSettings = {};
      }
    } else if (rawTicketSettings && typeof rawTicketSettings === "object") {
      ticketSettings = rawTicketSettings as Record<string, unknown>;
    }

    const addonSettingsRaw = (activity as { addon_settings?: unknown }).addon_settings;
    const portalInventoryIds = collectPortalOptionInventoryItemIds(addonSettingsRaw);
    let inventoryPrices: Record<string, number> = {};
    if (portalInventoryIds.length > 0) {
      try {
        inventoryPrices = await buildPortalOptionInventoryPrices(
          supabase,
          businessId,
          portalInventoryIds,
        );
      } catch {
        return new Response(
          JSON.stringify({ error: "Could not validate activity option pricing." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }
    const addonValidation = validatePortalOptionRowsAgainstActivity(
      addonSettingsRaw,
      addonRows,
      inventoryPrices,
    );
    if (!addonValidation.ok) {
      return new Response(
        JSON.stringify({ error: addonValidation.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const enforceOnlineOnly = ticketSettings.enforce_online_only !== false;
    const isPartyBooking =
      ticketSettings.party_booking === true || ticketSettings.partyBooking === true;
    const requireBirthdayChild = ticketSettings.require_birthday_child !== false;
    const minTickets =
      ticketSettings.min_tickets != null && ticketSettings.min_tickets !== ""
        ? Number.parseInt(String(ticketSettings.min_tickets), 10)
        : null;
    const maxTickets =
      ticketSettings.max_tickets != null && ticketSettings.max_tickets !== ""
        ? Number.parseInt(String(ticketSettings.max_tickets), 10)
        : null;
    const participantCount = participantRows.length;

    if (isPartyBooking) {
      const hostRows = participantRows.filter(
        (row) => String((row as { party_role?: string }).party_role || "").trim() === "host_adult",
      );
      if (hostRows.length !== 1) {
        return new Response(
          JSON.stringify({ error: "Exactly one party host (adult) is required." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (requireBirthdayChild) {
        const childRows = participantRows.filter(
          (row) => String((row as { party_role?: string }).party_role || "").trim() === "birthday_child",
        );
        if (childRows.length !== 1) {
          return new Response(
            JSON.stringify({ error: "Exactly one birthday child is required for this party booking." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
    } else if (enforceOnlineOnly && maxTickets != null && !Number.isNaN(maxTickets) && participantCount > maxTickets) {
      return new Response(
        JSON.stringify({
          error: `Maximum ${maxTickets} ticket${maxTickets === 1 ? "" : "s"} allowed per booking.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!isPartyBooking && enforceOnlineOnly && minTickets != null && !Number.isNaN(minTickets) && participantCount < minTickets) {
      return new Response(
        JSON.stringify({
          error: `At least ${minTickets} ticket${minTickets === 1 ? "" : "s"} required per booking.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const orderTotalWithTax = body.orderTotalWithTax != null && body.orderTotalWithTax !== ""
      ? Number(body.orderTotalWithTax)
      : amount;
    if (!Number.isFinite(orderTotalWithTax) || orderTotalWithTax <= 0) {
      return new Response(
        JSON.stringify({ error: "Invalid order total." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const onlinePayment = parseOnlinePaymentFromTicketSettings(ticketSettings);

    let categoryKey: string | null = null;
    const activityTypeId = (activity as { type_id?: string | null }).type_id;
    if (activityTypeId) {
      const { data: typeRow } = await supabase
        .from("booking_types")
        .select("type_key")
        .eq("id", activityTypeId)
        .eq("business_id", businessId)
        .maybeSingle();
      categoryKey = typeof typeRow?.type_key === "string" ? typeRow.type_key : null;
    }

    const pricingValidation = await validatePortalHelcimCheckoutAmounts({
      supabase,
      businessId,
      ticketSettings,
      participantRows,
      addonRows,
      addonInventoryPrices: inventoryPrices,
      clientAmount: amount,
      clientOrderTotalWithTax: orderTotalWithTax,
      onlinePayment,
      activityId,
      categoryKey,
      bookingDate,
      bookingTime,
      promoCode,
      clientPricingPromotionId: clientPricingPromotionId || null,
      skipClientAmountCheck: Boolean(giftCardCode),
    });
    if (!pricingValidation.ok) {
      return new Response(
        JSON.stringify({ error: pricingValidation.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const validatedOrderTotal = pricingValidation.orderTotalWithTax;
    const validatedChargeNow = pricingValidation.chargeNow;
    const validatedTaxAmount = pricingValidation.taxAmount;
    const expectedCheckout = calculateOnlineCheckoutAmounts(validatedOrderTotal, onlinePayment);
    if (!amountsMatchWithinCent(validatedChargeNow, expectedCheckout.chargeNow)) {
      return new Response(
        JSON.stringify({ error: "Payment amount does not match this activity's online payment rules." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let giftCardId: string | null = null;
    let giftCardCodeStored: string | null = null;
    let giftCardAmount = 0;
    let helcimAmount = validatedChargeNow;

    if (giftCardCode) {
      try {
        const preview = await previewGiftCardForBookingCharge(
          supabase,
          businessId,
          giftCardCode,
          validatedChargeNow,
        );
        giftCardId = preview.giftCardId;
        giftCardCodeStored = preview.code;
        giftCardAmount = preview.appliedAmount;
        helcimAmount = preview.remainingDue;
      } catch (gcErr) {
        return new Response(
          JSON.stringify({
            error: gcErr instanceof Error ? gcErr.message : "Gift card could not be applied.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    if (!amountsMatchWithinCent(amount, helcimAmount)) {
      return new Response(
        JSON.stringify({
          error: giftCardCode
            ? `Payment amount mismatch after gift card. Expected card charge $${helcimAmount.toFixed(2)}, received $${amount.toFixed(2)}.`
            : `Payment amount mismatch. Expected ${helcimAmount.toFixed(2)}, received ${amount.toFixed(2)}.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const paymentType = expectedCheckout.isDeposit ? "deposit" : "full";
    const storedOrderTotal = expectedCheckout.isDeposit ? expectedCheckout.orderTotal : validatedOrderTotal;

    const pendingId = crypto.randomUUID();
    const invoiceNumber = `BP-${pendingId}`;

    const customerEmailSnapshot =
      (customerResult.data as { customer_email?: string } | null)?.customer_email?.trim() || null;

    const { error: pendingInsertError } = await supabase
      .from("booking_pending_helcim")
      .insert({
        id: pendingId,
        invoice_number: invoiceNumber,
        business_id: businessId,
        activity_id: activityId,
        customer_id: customerId,
        customer_email_snapshot: customerEmailSnapshot,
        booking_date: bookingDate,
        booking_time: bookingTime,
        participant_rows: participantRows,
        addon_rows: addonRows,
        amount: Number(helcimAmount.toFixed(2)),
        order_total: Number(storedOrderTotal.toFixed(2)),
        tax_amount: Number(validatedTaxAmount.toFixed(2)),
        payment_type: paymentType,
        currency,
        status: "pending",
        client_ip: clientIp,
        slot_hold_token: slotHoldToken || null,
        pricing_promotion_id: pricingValidation.pricingPromotionId || null,
        promo_code: promoCode || null,
        gift_card_id: giftCardId,
        gift_card_code: giftCardCodeStored,
        gift_card_amount: Number(giftCardAmount.toFixed(2)),
        terms_acknowledgment: body.termsAcknowledgment && typeof body.termsAcknowledgment === "object"
          ? body.termsAcknowledgment
          : body.terms_acknowledgment && typeof body.terms_acknowledgment === "object"
          ? body.terms_acknowledgment
          : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (pendingInsertError) {
      console.error("[helcim-pay-init] Failed to create pending booking:", pendingInsertError);
      return new Response(
        JSON.stringify({ error: "Could not create pending booking." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Gift card covers the full amount due now — skip Helcim.
    if (helcimAmount <= 0.01) {
      return new Response(
        JSON.stringify({
          giftCardOnly: true,
          pendingId,
          invoiceNumber,
          giftCardAmount: Number(giftCardAmount.toFixed(2)),
          helcimAmount: 0,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Top-level `invoiceNumber` is only for linking an invoice that already exists in Helcim.
    // Our BP-{uuid} must be created as a new invoice via `invoiceRequest` (totals must match `amount`).
    const amtPurchase = Number(helcimAmount.toFixed(2));
    const invoiceRequest = {
      currency,
      invoiceNumber,
      lineItems: [
        {
          description: giftCardAmount > 0
            ? "Booking payment (after gift card)"
            : "Booking payment",
          quantity: 1,
          price: amtPurchase,
          total: amtPurchase,
        },
      ],
    };

    const payload: Record<string, unknown> = {
      paymentType: "purchase",
      amount: amtPurchase,
      currency,
      invoiceRequest,
    };
    if (customerCode) payload.customerCode = customerCode;
    if (setAsDefault) payload.setAsDefaultPaymentMethod = "1";

    attachHelcimPayPresentation(payload, body, "purchase");

    const initRes = await fetch("https://api.helcim.com/v2/helcim-pay/initialize", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-token": HELCIM_API_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rawPurchase = await initRes.text();
    let data: Record<string, unknown> = {};
    try {
      data = rawPurchase ? (JSON.parse(rawPurchase) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }
    if (!initRes.ok) {
      const errOut = summarizeHelcimInitFailure(initRes.status, data, rawPurchase);
      console.error("[helcim-pay-init] purchase Helcim error:", initRes.status, errOut);
      await supabase
        .from("booking_pending_helcim")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", pendingId);
      return new Response(
        JSON.stringify({ error: errOut }),
        {
          status: initRes.status >= 400 ? initRes.status : 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const checkoutToken = (data.checkoutToken ?? data.checkout_token) as string | undefined;
    const secretToken = (data.secretToken ?? data.secret_token) as string | undefined;
    if (!checkoutToken) {
      await supabase
        .from("booking_pending_helcim")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", pendingId);
      return new Response(
        JSON.stringify({ error: "No checkout token from Helcim" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: pendingUpdateError } = await supabase
      .from("booking_pending_helcim")
      .update({
        checkout_token: checkoutToken,
        secret_token: secretToken ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pendingId);

    if (pendingUpdateError) {
      console.error("[helcim-pay-init] Failed to update pending booking token:", pendingUpdateError);
      return new Response(
        JSON.stringify({ error: "Could not save checkout session." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        checkoutToken,
        secretToken: secretToken ?? null,
        pendingId,
        invoiceNumber,
        giftCardAmount: Number(giftCardAmount.toFixed(2)),
        helcimAmount: amtPurchase,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[helcim-pay-init]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
