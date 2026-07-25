import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  sendBookingParticipantsSummaryEmail,
  type BookerSummary,
  type ParticipantSummaryRow,
} from "../_shared/bookingParticipantsSummaryEmail.ts";
import {
  normalizeBookingEmail,
  resolveBookingMailRecipients,
} from "../_shared/bookingRecipientEmail.ts";

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

function normalizeBooker(raw: unknown): BookerSummary {
  const booker = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    name: String(booker.name || "").trim() || "—",
    email: typeof booker.email === "string" ? booker.email.trim() : null,
    phone: typeof booker.phone === "string" ? booker.phone.trim() : null,
    birthdayChild: typeof booker.birthdayChild === "string"
      ? booker.birthdayChild.trim()
      : typeof booker.birthday_child === "string"
      ? booker.birthday_child.trim()
      : null,
  };
}

function normalizeParticipants(raw: unknown): ParticipantSummaryRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const participant = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
    return {
      name: String(participant.name || "").trim() || "—",
      role: typeof participant.role === "string" ? participant.role.trim() : null,
      email: typeof participant.email === "string" ? participant.email.trim() : null,
      phone: typeof participant.phone === "string" ? participant.phone.trim() : null,
      attending: participant.attending !== false,
    };
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
    const sendToCustomer = body.sendToCustomer !== false && body.send_to_customer !== false;

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

    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select("id, customer_email, secondary_customer_email, customer_id")
      .eq("id", bookingId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (bookingErr || !booking) {
      return jsonResponse({ error: "Booking not found" }, 404);
    }

    let recipients = await resolveBookingMailRecipients(supabase, booking, businessId);

    if (!sendToCustomer) {
      const overrideEmail = normalizeBookingEmail(body.recipientEmail || body.recipient_email);
      if (!overrideEmail) {
        return jsonResponse({ error: "A valid recipient email is required" }, 400);
      }
      recipients = { to: overrideEmail };
    }

    if (!recipients) {
      return jsonResponse({ error: "No customer email on this booking" }, 400);
    }

    const booker = normalizeBooker(body.booker);
    const participants = normalizeParticipants(body.participants);

    const result = await sendBookingParticipantsSummaryEmail(supabase, supabaseUrl, serviceRoleKey, {
      businessId,
      bookingId,
      recipients,
      booker,
      participants,
    });

    if (!result.ok) {
      return jsonResponse({ error: result.error }, result.status);
    }

    return jsonResponse({
      sent: true,
      to: result.to,
      cc: result.cc,
    }, 200);
  } catch (error) {
    console.error("send-booking-participants-summary error:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Internal error" }, 500);
  }
});
