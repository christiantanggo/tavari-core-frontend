import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  cancelBookingPaymentRequest,
  recordManualBookingPayment,
  sendBookingPaymentCancelWarning,
  sendBookingPaymentFollowUp,
  sendBookingPaymentRequest,
  type PaymentRequestType,
} from "../_shared/bookingPaymentRequest.ts";
import { syncBookingPendingHelcimPayments } from "../_shared/bookingHelcimSync.ts";

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
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const businessId = String(body.businessId || body.business_id || "").trim();
    const bookingId = String(body.bookingId || body.booking_id || "").trim();
    const action = String(body.action || "send").trim().toLowerCase();

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

    if (action === "cancel") {
      const requestId = String(body.requestId || body.request_id || "").trim() || null;
      const result = await cancelBookingPaymentRequest(
        supabase,
        businessId,
        bookingId,
        user.id,
        requestId,
      );
      return jsonResponse({ ok: true, ...result }, 200);
    }

    if (action === "sync" || action === "sync_payments") {
      const result = await syncBookingPendingHelcimPayments(supabase, businessId, bookingId);
      return jsonResponse({ ok: true, ...result }, 200);
    }

    if (action === "record_manual" || action === "record_manual_payment") {
      const amountRaw = body.amount ?? body.amountPaid ?? body.amount_paid;
      const amount = amountRaw != null && amountRaw !== "" ? Number(amountRaw) : NaN;
      const transactionId = String(body.transactionId || body.transaction_id || "").trim() || null;
      const requestId = String(body.requestId || body.request_id || "").trim() || null;
      const result = await recordManualBookingPayment(supabase, businessId, bookingId, {
        amount,
        recordedBy: user.id,
        transactionId,
        paymentRequestId: requestId,
      });
      return jsonResponse({ ok: true, ...result }, 200);
    }

    if (action === "send_follow_up" || action === "send_followup") {
      const followUpType = String(body.followUpType || body.follow_up_type || "").trim().toLowerCase();
      if (!["overdue", "pending", "balance_after_party"].includes(followUpType)) {
        return jsonResponse({ error: "Invalid followUpType" }, 400);
      }

      const result = await sendBookingPaymentFollowUp(supabase, {
        businessId,
        bookingId,
        followUpType: followUpType as "overdue" | "pending" | "balance_after_party",
        sentBy: user.id,
      });

      return jsonResponse({
        ok: true,
        sent: result.sent,
        payUrl: result.payUrl,
        amountDue: result.amountDue,
      }, 200);
    }

    if (action === "send_cancel_warning" || action === "send_payment_cancel_warning") {
      const cancelDeadlineAt = String(
        body.cancelDeadlineAt || body.cancel_deadline_at || body.deadlineAt || "",
      ).trim();
      if (!cancelDeadlineAt) {
        return jsonResponse({ error: "cancelDeadlineAt is required" }, 400);
      }

      const result = await sendBookingPaymentCancelWarning(supabase, {
        businessId,
        bookingId,
        cancelDeadlineAt,
        sentBy: user.id,
      });

      return jsonResponse({
        ok: true,
        sent: result.sent,
        payUrl: result.payUrl,
        amountDue: result.amountDue,
        cancelDeadlineAt: result.cancelDeadlineAt,
      }, 200);
    }

    const requestType = String(body.requestType || body.request_type || "deposit").trim().toLowerCase() as PaymentRequestType;
    if (!["deposit", "full", "custom"].includes(requestType)) {
      return jsonResponse({ error: "Invalid requestType" }, 400);
    }

    const amountRaw = body.amount ?? body.customAmount ?? body.custom_amount;
    const amount = amountRaw != null && amountRaw !== "" ? Number(amountRaw) : undefined;
    const dueAt = String(body.dueAt || body.due_at || body.depositDueAt || "").trim() || null;
    const resend = body.resend === true || body.forceResend === true;

    const result = await sendBookingPaymentRequest(supabase, {
      businessId,
      bookingId,
      requestType,
      amount,
      dueAt,
      sentBy: user.id,
      resend,
    });

    if (result.skipped) {
      return jsonResponse({ sent: false, skipped: true, reason: result.reason }, 200);
    }

    return jsonResponse({
      ok: true,
      sent: result.sent,
      requestId: result.requestId,
      amount: result.amount,
      payUrl: result.payUrl,
    }, 200);
  } catch (err) {
    console.error("[booking-manage-payment-request]", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Server error" },
      500,
    );
  }
});
