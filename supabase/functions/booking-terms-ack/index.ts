import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getRequestClientIp } from "../_shared/requestClientIp.ts";
import { insertBookingHistory } from "../_shared/bookingHistoryLog.ts";

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
    const action = String(body.action || "load").trim().toLowerCase();
    const businessId = String(body.businessId || body.business_id || "").trim();
    const token = String(body.token || body.termsToken || body.terms_ack_token || "").trim();

    if (!businessId || !token) {
      return jsonResponse({ error: "Missing businessId or token" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        id,
        business_id,
        booking_number,
        booking_date,
        booking_time,
        status,
        terms_package_id,
        terms_status,
        terms_signed_at,
        terms_signer_name,
        activity_id
      `)
      .eq("business_id", businessId)
      .eq("terms_ack_token", token)
      .maybeSingle();

    if (bookingError || !booking) {
      return jsonResponse({ error: "Terms link is invalid or expired." }, 404);
    }

    if (!booking.terms_package_id) {
      return jsonResponse({ error: "This booking does not require Terms & Conditions." }, 400);
    }

    const [{ data: pkg }, { data: steps }, { data: activity }, { data: business }] = await Promise.all([
      supabase
        .from("booking_terms_packages")
        .select("id, name, description, is_active")
        .eq("id", booking.terms_package_id)
        .eq("business_id", businessId)
        .maybeSingle(),
      supabase
        .from("booking_terms_steps")
        .select("id, step_order, title, body, require_acknowledge")
        .eq("package_id", booking.terms_package_id)
        .eq("business_id", businessId)
        .order("step_order", { ascending: true }),
      supabase
        .from("booking_activities")
        .select("activity_name")
        .eq("id", booking.activity_id)
        .maybeSingle(),
      supabase
        .from("businesses")
        .select("id, name")
        .eq("id", businessId)
        .maybeSingle(),
    ]);

    if (!pkg || pkg.is_active === false) {
      return jsonResponse({ error: "Terms package is unavailable." }, 400);
    }

    if (action === "load") {
      return jsonResponse({
        booking: {
          id: booking.id,
          booking_number: booking.booking_number,
          booking_date: booking.booking_date,
          booking_time: booking.booking_time,
          status: booking.status,
          terms_status: booking.terms_status,
          terms_signed_at: booking.terms_signed_at,
          terms_signer_name: booking.terms_signer_name,
          activity_name: activity?.activity_name || "Activity",
        },
        business: {
          id: businessId,
          name: business?.name || "Business",
        },
        package: {
          id: pkg.id,
          name: pkg.name,
          description: pkg.description,
        },
        steps: steps || [],
        alreadySigned: booking.terms_status === "signed",
      }, 200);
    }

    if (action === "submit") {
      if (booking.terms_status === "signed") {
        return jsonResponse({ ok: true, alreadySigned: true }, 200);
      }
      if (booking.status === "cancelled") {
        return jsonResponse({ error: "This booking was cancelled." }, 400);
      }

      const acknowledgments = Array.isArray(body.acknowledgments) ? body.acknowledgments : [];
      const signerName = String(body.signerName || body.signer_name || "").trim();
      const signatureData = body.signatureData && typeof body.signatureData === "object"
        ? body.signatureData as Record<string, unknown>
        : null;
      const signatureImageUrl = typeof signatureData?.imageUrl === "string"
        ? signatureData.imageUrl
        : (typeof body.signatureImageUrl === "string" ? body.signatureImageUrl : "");

      if (!signerName) {
        return jsonResponse({ error: "Please enter your full name." }, 400);
      }
      if (!signatureImageUrl || !String(signatureImageUrl).startsWith("data:image/")) {
        return jsonResponse({ error: "A drawn signature is required." }, 400);
      }

      const requiredSteps = (steps || []).filter((step) => step.require_acknowledge !== false);
      if (requiredSteps.length === 0) {
        return jsonResponse({ error: "This terms package has no steps to acknowledge." }, 400);
      }

      const ackStepIds = new Set(
        acknowledgments
          .map((row) => String((row as { stepId?: string; step_id?: string })?.stepId
            || (row as { step_id?: string })?.step_id
            || "").trim())
          .filter(Boolean),
      );

      for (const step of requiredSteps) {
        if (!ackStepIds.has(String(step.id))) {
          return jsonResponse({
            error: `Please acknowledge all terms steps before signing. Missing: ${step.title}`,
          }, 400);
        }
      }

      const now = new Date().toISOString();
      const clientIp = getRequestClientIp(req);

      const ackRows = requiredSteps.map((step) => ({
        booking_id: booking.id,
        business_id: businessId,
        package_id: pkg.id,
        step_id: step.id,
        step_order: step.step_order,
        step_title_snapshot: step.title,
        step_body_snapshot: step.body || "",
        acknowledged_at: now,
      }));

      await supabase
        .from("booking_terms_acknowledgments")
        .delete()
        .eq("booking_id", booking.id);

      const { error: ackError } = await supabase
        .from("booking_terms_acknowledgments")
        .insert(ackRows);
      if (ackError) {
        console.error("[booking-terms-ack] ack insert failed:", ackError);
        return jsonResponse({ error: "Failed to save acknowledgments." }, 500);
      }

      const { error: updateError } = await supabase
        .from("bookings")
        .update({
          terms_status: "signed",
          terms_signed_at: now,
          terms_signer_name: signerName,
          terms_signature_data: {
            imageUrl: signatureImageUrl,
            capturedAt: now,
            signerName,
          },
          terms_signed_ip: clientIp || null,
          updated_at: now,
        })
        .eq("id", booking.id)
        .eq("business_id", businessId);

      if (updateError) {
        console.error("[booking-terms-ack] booking update failed:", updateError);
        return jsonResponse({ error: "Failed to save signature." }, 500);
      }

      await insertBookingHistory(supabase, {
        businessId,
        bookingId: booking.id,
        actionType: "booking.terms_signed",
        summary: "Terms & Conditions signed",
        details: {
          actor_label: "Customer",
          signer_name: signerName,
          changes: [
            { field: "Terms status", from: "pending", to: "signed" },
            { field: "Signer", from: null, to: signerName },
          ],
        },
        changedIp: clientIp || null,
      });

      return jsonResponse({ ok: true, signedAt: now }, 200);
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("[booking-terms-ack]", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Server error" }, 500);
  }
});
