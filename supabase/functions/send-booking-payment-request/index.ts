import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { sendBookingPaymentRequest } from "../_shared/bookingPaymentRequest.ts";



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

    const bookingId = String(body.bookingId || body.booking_id || "").trim();

    const depositAmount = body.depositAmount ?? body.deposit_amount;

    const depositDueAt = String(body.depositDueAt || body.deposit_due_at || "").trim() || null;

    const sentBy = String(body.sentBy || body.sent_by || "").trim() || null;

    const requestType = String(body.requestType || body.request_type || "deposit").trim().toLowerCase();

    const resend = body.resend === true || body.forceResend === true;



    if (!businessId || !bookingId) {

      return jsonResponse({ error: "Missing businessId or bookingId" }, 400);

    }



    const supabase = createClient(

      Deno.env.get("SUPABASE_URL")!,

      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,

    );



    const amount = depositAmount != null && depositAmount !== "" ? Number(depositAmount) : undefined;



    const result = await sendBookingPaymentRequest(supabase, {

      businessId,

      bookingId,

      requestType: requestType === "full" || requestType === "custom" ? requestType : "deposit",

      amount,

      dueAt: depositDueAt,

      sentBy,

      resend,

    });



    if (result.skipped) {

      return jsonResponse({ sent: false, skipped: true, reason: result.reason }, 200);

    }



    return jsonResponse({ sent: true, payUrl: result.payUrl, requestId: result.requestId, amount: result.amount }, 200);

  } catch (err) {

    console.error("[send-booking-payment-request]", err);

    return jsonResponse({ error: err instanceof Error ? err.message : "Server error" }, 500);

  }

});

