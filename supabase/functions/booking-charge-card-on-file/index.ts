import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getHelcimCredentialsForBusiness } from "../_shared/helcimBusinessCredentials.ts";
import { getRequestClientIp } from "../_shared/requestClientIp.ts";
import {
  bookingCardOnFileInvoicePrefix,
  chargeHelcimCardOnFile,
  recordBookingHelcimCardOnFilePayment,
  resolveHelcimDefaultCardForCustomer,
  sumCompletedBookingPayments,
} from "../_shared/helcimCardOnFile.ts";

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

const roundMoney = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const businessId = String(body.businessId || body.business_id || "").trim();
    const bookingId = String(body.bookingId || body.booking_id || "").trim();
    const action = String(body.action || "charge").trim().toLowerCase();

    if (!businessId || !bookingId) {
      return jsonResponse({ error: "Missing businessId or bookingId" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user?.id) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const { data: membership } = await supabase
      .from("business_users")
      .select("role")
      .eq("business_id", businessId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, business_id, customer_id, order_total, payment_status, status, booking_number, created_ip")
      .eq("id", bookingId)
      .eq("business_id", businessId)
      .single();

    if (bookingError || !booking) {
      return jsonResponse({ error: "Booking not found" }, 404);
    }

    if (booking.status === "cancelled") {
      return jsonResponse({ error: "Cannot charge a cancelled booking" }, 400);
    }

    if (!booking.customer_id) {
      return jsonResponse({ error: "This booking has no linked customer account" }, 400);
    }

    let customerCode: string | null = null;
    let defaultCard: Awaited<ReturnType<typeof resolveHelcimDefaultCardForCustomer>>["defaultCard"] = null;
    try {
      const resolved = await resolveHelcimDefaultCardForCustomer(
        supabase,
        businessId,
        booking.customer_id,
      );
      customerCode = resolved.customerCode;
      defaultCard = resolved.defaultCard;
    } catch (lookupError) {
      const lookupMessage = lookupError instanceof Error ? lookupError.message : "Could not look up saved card";
      if (action === "lookup") {
        return jsonResponse({
          ok: true,
          customerCode: null,
          defaultCard: null,
          warning: lookupMessage,
        }, 200);
      }
      throw lookupError;
    }

    if (action === "lookup") {
      return jsonResponse({
        ok: true,
        customerCode,
        defaultCard: defaultCard
          ? {
            customerCode: defaultCard.customerCode,
            cardType: defaultCard.cardType,
            cardHolderName: defaultCard.cardHolderName,
            cardExpiry: defaultCard.cardExpiry,
            lastFour: defaultCard.lastFour,
            maskedCard: defaultCard.maskedCard,
            hasToken: !!defaultCard.cardToken,
          }
          : null,
      }, 200);
    }

    if (!customerCode || !defaultCard?.cardToken) {
      return jsonResponse({
        error: "No saved payment method found for this customer. The customer must pay online first so their card is stored in Helcim.",
      }, 400);
    }

    const orderTotal = roundMoney(Number(booking.order_total) || 0);
    const totalPaid = await sumCompletedBookingPayments(supabase, bookingId);
    const balanceDue = roundMoney(Math.max(0, orderTotal - totalPaid));

    if (balanceDue <= 0) {
      return jsonResponse({ error: "This booking has no remaining balance" }, 400);
    }

    const amountRaw = body.amount;
    const chargeAmount = amountRaw != null && amountRaw !== ""
      ? roundMoney(Number(amountRaw))
      : balanceDue;

    if (!Number.isFinite(chargeAmount) || chargeAmount <= 0) {
      return jsonResponse({ error: "Enter a valid charge amount" }, 400);
    }

    if (chargeAmount > balanceDue + 0.005) {
      return jsonResponse({
        error: `Amount cannot exceed the remaining balance ($${balanceDue.toFixed(2)})`,
      }, 400);
    }

    const helcimCreds = await getHelcimCredentialsForBusiness(supabase, businessId);
    const helcimApiToken = helcimCreds?.apiToken ?? null;
    if (!helcimApiToken) {
      return jsonResponse({ error: "Helcim is not configured for this business" }, 400);
    }

    const ipAddress = String(booking.created_ip || "").trim()
      || getRequestClientIp(req)
      || "127.0.0.1";

    const idempotencyKey = crypto.randomUUID();
    const invoiceNumber = `${bookingCardOnFileInvoicePrefix(bookingId)}${Date.now().toString().slice(-6)}`;

    const purchase = await chargeHelcimCardOnFile({
      helcimApiToken,
      customerCode,
      cardToken: defaultCard.cardToken,
      cardId: defaultCard.cardId,
      amount: chargeAmount,
      currency: "CAD",
      ipAddress,
      invoiceNumber,
      invoiceDescription: booking.booking_number
        ? `Booking ${booking.booking_number}`
        : "Booking payment",
      idempotencyKey,
    });

    let recorded;
    try {
      recorded = await recordBookingHelcimCardOnFilePayment(supabase, businessId, bookingId, {
        chargeAmount,
        orderTotal,
        existingTotalPaid: totalPaid,
        transactionId: purchase.transactionId,
        idempotencyFallback: idempotencyKey,
      });
    } catch (recordError) {
      console.error("[booking-charge-card-on-file] record payment failed:", recordError);
      return jsonResponse({
        error: "Payment was processed in Helcim but could not be recorded. Contact support with the transaction ID.",
        transactionId: purchase.transactionId,
      }, 500);
    }

    const { data: publicUser } = await supabase
      .from("users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (publicUser?.id) {
      await supabase
        .from("bookings")
        .update({ updated_by: publicUser.id, updated_at: new Date().toISOString() })
        .eq("id", bookingId)
        .eq("business_id", businessId);
    }

    return jsonResponse({
      ok: true,
      paymentId: recorded.paymentId,
      amount: chargeAmount,
      transactionId: purchase.transactionId,
      approvalCode: purchase.approvalCode,
      paymentStatus: recorded.paymentStatus,
      balanceRemaining: recorded.remainingBalance,
      alreadyRecorded: recorded.alreadyRecorded === true,
      cardLastFour: defaultCard.lastFour,
    }, 200);
  } catch (err) {
    console.error("[booking-charge-card-on-file]", err);
    const helcimRaw = err && typeof err === "object" && "helcimRaw" in err
      ? (err as { helcimRaw?: Record<string, unknown> }).helcimRaw
      : undefined;
    if (helcimRaw) {
      console.error("[booking-charge-card-on-file] helcim response:", helcimRaw);
    }
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Server error" },
      500,
    );
  }
});
