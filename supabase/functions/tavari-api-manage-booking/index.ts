// Public manage-booking API — OTP lookup, booking summary, self-service actions (OTWK + Tavari host portal).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createCustomerSessionToken,
  extractBearerToken,
  normalizePhone,
  verifyCustomerSessionToken,
} from "../_shared/customerAppSession.ts";
import { loadPublicBusinessLinks } from "../_shared/tavariPublicBusinessLinks.ts";
import {
  buildPublicManageBookingSummary,
  invokeManageBookingSelfService,
  mapManageBookingListItem,
  resolveManageBookingPortalUrls,
} from "../_shared/tavariPublicManageBooking.ts";
import { searchWaiversByPhone } from "../_shared/tavariPublicWaiverStatus.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-customer-session",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_INTRO =
  "Sign in with the phone number on your booking. We will email you a one-time code, then show your upcoming bookings so you can pay, reschedule, or cancel.";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function maskEmail(email: string) {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 1) return "***@***";
  return `${trimmed[0]}***@${trimmed.slice(at + 1)}`;
}

function resolveParams(req: Request, body: Record<string, unknown>) {
  const url = new URL(req.url);
  return {
    businessId: String(
      body.businessId ?? body.business_id ?? url.searchParams.get("businessId") ??
        url.searchParams.get("business_id") ?? "",
    ).trim(),
    action: String(body.action ?? url.searchParams.get("action") ?? "").trim(),
    phoneNumber: String(body.phoneNumber ?? body.phone ?? url.searchParams.get("phoneNumber") ?? "").trim(),
    email: String(body.email ?? url.searchParams.get("email") ?? "").trim(),
    otpCode: String(body.otpCode ?? body.otp ?? body.code ?? "").trim(),
    bookingId: String(body.bookingId ?? body.booking_id ?? url.searchParams.get("bookingId") ?? "").trim(),
    token: String(body.token ?? url.searchParams.get("token") ?? "").trim(),
    sessionId: String(body.sessionId ?? body.session_id ?? "").trim(),
    reason: String(body.reason ?? "").trim(),
  };
}

async function assertTavariApisEnabled(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
) {
  const { data: moduleRow, error: moduleErr } = await supabase
    .from("business_module_usage")
    .select("enabled")
    .eq("business_id", businessId)
    .eq("module_key", "tavari_apis")
    .maybeSingle();

  if (moduleErr) throw new Error("Could not verify API access");
  if (!moduleRow?.enabled) throw new Error("Tavari APIs is not enabled for this business");
}

async function sendOtpEmail(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  email: string,
  otpCode: string,
  phone: string,
) {
  const { data: business } = await supabase.from("businesses").select("name").eq("id", businessId).maybeSingle();
  const businessName = String(business?.name || "Off The Wall Kids").trim() || "Off The Wall Kids";
  const subject = `Your booking management code - ${businessName}`;
  const text = `Your verification code is: ${otpCode}\n\nExpires in 10 minutes.\n\n${businessName}`;
  const html = `<p>Your verification code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${otpCode}</p><p style="font-size:12px;color:#666">Expires in 10 minutes.</p>`;

  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || ""}`,
    },
    body: JSON.stringify({
      businessId,
      campaignId: `manage-booking-otp-${phone}-${Date.now()}`,
      emailType: "transactional",
      to: email,
      fromEmail: "noreply@tavarios.ca",
      fromName: `${businessName} - Booking Management`,
      subject,
      html,
      text,
    }),
  });
}

async function resolveOtpEmail(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  phone: string,
  providedEmail?: string,
) {
  const trimmed = String(providedEmail || "").trim();
  if (trimmed) return { email: trimmed, customerId: null as string | null };

  const { data: customerRows } = await supabase.rpc("bookings_get_portal_customer_by_phone", {
    p_business_id: businessId,
    p_phone_number: phone,
  });
  const customer = Array.isArray(customerRows) ? customerRows[0] : customerRows;
  const customerEmail = String(customer?.customer_email || "").trim();
  if (customerEmail) {
    return { email: customerEmail, customerId: String(customer?.id || "") || null };
  }

  const waivers = await searchWaiversByPhone(supabase, businessId, phone);
  for (const w of waivers) {
    const email = String(w.email || "").trim();
    if (email) return { email, customerId: String(w.customer_id || "") || null };
  }

  return { email: null, customerId: null };
}

async function listManageableBookings(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  phone: string,
) {
  const { data, error } = await supabase.rpc("bookings_find_manageable_by_phone", {
    p_business_id: businessId,
    p_phone_number: phone,
  });
  if (error) throw error;
  return (data || []).map((row: Record<string, unknown>) => mapManageBookingListItem(row));
}

async function resolveSession(req: Request, body: Record<string, unknown>, businessId: string) {
  const sessionToken =
    extractBearerToken(req) ||
    String(req.headers.get("X-Customer-Session") || "").trim() ||
    String(body.sessionToken || body.session_token || "").trim();
  if (!sessionToken) return null;
  const session = await verifyCustomerSessionToken(sessionToken);
  if (!session || session.businessId !== businessId) return null;
  return session;
}

async function verifyBookingOwnedBySession(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  bookingId: string,
  customerId: string,
  phone: string,
) {
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id, customer_id, customer_phone")
    .eq("id", bookingId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error || !booking) return false;
  if (String(booking.customer_id || "") === customerId) return true;
  return normalizePhone(booking.customer_phone) === normalizePhone(phone);
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
    const params = resolveParams(req, body);
    const { businessId, action } = params;

    if (!businessId || !UUID_RE.test(businessId)) {
      return json({ ok: false, error: "Valid businessId is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    await assertTavariApisEnabled(supabase, businessId);

    const linksPayload = await loadPublicBusinessLinks(supabase, businessId, {
      siteUrl: Deno.env.get("PUBLIC_SITE_URL") || undefined,
    });
    const portalUrls = resolveManageBookingPortalUrls({
      businessId,
      siteUrl: Deno.env.get("PUBLIC_SITE_URL") || undefined,
      websiteBaseUrl: linksPayload.websiteBaseUrl,
      customerPortalUrl: linksPayload.links.customerPortalUrl,
      manageBookingUrlOverride: linksPayload.links.manageBookingUrl,
      partyManageUrlOverride: linksPayload.links.partyManageUrl,
    });

    if (action === "getPortalInfo") {
      return json({
        ok: true,
        businessId,
        businessName: linksPayload.businessName,
        intro: DEFAULT_INTRO,
        hostManageBookingUrl: portalUrls.hostManageBookingUrl,
        websiteManageUrl: portalUrls.websiteManageUrl,
        manageBookingUrl: portalUrls.manageBookingUrl,
        customerPortalUrl: portalUrls.customerPortalUrl,
      });
    }

    if (req.method === "GET") {
      return json({ ok: false, error: "GET supports action=getPortalInfo only" }, 405);
    }

    if (action === "sendOtp") {
      const phone = normalizePhone(params.phoneNumber);
      if (phone.length < 10) return json({ ok: false, error: "Invalid phone number" }, 400);

      const { email, customerId } = await resolveOtpEmail(supabase, businessId, phone, params.email);
      if (!email) {
        return json({
          ok: true,
          otpSent: false,
          requiresEmail: true,
          message: "Enter the email on your booking to receive a verification code.",
        });
      }

      const { data: otpCode, error: otpError } = await supabase.rpc("waivers_generate_otp", {
        p_business_id: businessId,
        p_phone_number: phone,
        p_email: email,
        p_customer_id: customerId && UUID_RE.test(customerId) ? customerId : null,
        p_ip_address: req.headers.get("x-forwarded-for") || "unknown",
        p_user_agent: req.headers.get("user-agent") || "manage-booking-api",
      });

      if (otpError) return json({ ok: false, error: otpError.message }, 400);
      if (!otpCode) return json({ ok: false, error: "Could not generate verification code" }, 500);

      await sendOtpEmail(supabase, businessId, email, String(otpCode), phone);
      return json({ ok: true, otpSent: true, maskedEmail: maskEmail(email), phoneLastFour: phone.slice(-4) });
    }

    if (action === "verifyOtp") {
      const phone = normalizePhone(params.phoneNumber);
      if (phone.length < 10 || params.otpCode.length < 4) {
        return json({ ok: false, error: "Phone and verification code are required" }, 400);
      }

      const { data: verifyResult, error: verifyError } = await supabase.rpc("waivers_verify_otp", {
        p_phone_number: phone,
        p_otp_code: params.otpCode,
        p_business_id: businessId,
      });
      if (verifyError) return json({ ok: false, error: verifyError.message }, 400);

      const result = verifyResult as Record<string, unknown> | null;
      if (!result?.valid) {
        return json({ ok: false, error: String(result?.error || "Invalid verification code") }, 401);
      }

      const customerId = String(result.customerId ?? result.customer_id ?? "").trim();
      if (!UUID_RE.test(customerId)) {
        return json({ ok: false, error: "Customer account not found for this phone" }, 404);
      }

      const sessionToken = await createCustomerSessionToken({ customerId, businessId, phone });
      const bookings = await listManageableBookings(supabase, businessId, phone);

      return json({
        ok: true,
        sessionToken,
        bookings,
        manageBookingUrl: portalUrls.manageBookingUrl,
        hostManageBookingUrl: portalUrls.hostManageBookingUrl,
      });
    }

    if (action === "listBookings") {
      const session = await resolveSession(req, body, businessId);
      if (!session) return json({ ok: false, error: "Valid session required" }, 401);
      const bookings = await listManageableBookings(supabase, businessId, session.phone);
      return json({ ok: true, bookings });
    }

    if (action === "selectBooking") {
      const session = await resolveSession(req, body, businessId);
      if (!session) return json({ ok: false, error: "Valid session required" }, 401);
      if (!UUID_RE.test(params.bookingId)) {
        return json({ ok: false, error: "Valid bookingId is required" }, 400);
      }

      const owned = await verifyBookingOwnedBySession(
        supabase,
        businessId,
        params.bookingId,
        session.customerId,
        session.phone,
      );
      if (!owned) return json({ ok: false, error: "Booking not found" }, 404);

      const summary = await buildPublicManageBookingSummary(supabase, businessId, params.bookingId, {
        customerPortalUrl: portalUrls.customerPortalUrl,
      });
      return json(summary);
    }

    const tokenActions = new Set(["getBooking", "lookup", "availability", "cancel", "reschedule"]);
    if (tokenActions.has(action)) {
      if (!params.token) return json({ ok: false, error: "Missing booking management token" }, 400);

      const selfServiceAction = action === "getBooking" ? "lookup" : action;
      const proxyBody: Record<string, unknown> = {
        action: selfServiceAction,
        token: params.token,
      };
      if (action === "cancel" && params.reason) proxyBody.reason = params.reason;
      if (action === "reschedule" && params.sessionId) proxyBody.sessionId = params.sessionId;

      const { status, data } = await invokeManageBookingSelfService(proxyBody);
      if (!responseOk(status) || data.error) {
        return json({ ok: false, error: String(data.error || "Request failed") }, status >= 400 ? status : 500);
      }

      if (selfServiceAction === "lookup") {
        const tokenRowBookingId = String((data.booking as { id?: string } | undefined)?.id || "");
        if (!tokenRowBookingId) return json({ ok: false, error: "Booking not found" }, 404);
        const summary = await buildPublicManageBookingSummary(
          supabase,
          businessId,
          tokenRowBookingId,
          {
            customerPortalUrl: portalUrls.customerPortalUrl,
            manageToken: params.token,
          },
        );
        return json(summary);
      }

      if (selfServiceAction === "availability") {
        return json({
          ok: true,
          canReschedule: data.canReschedule === true,
          sessions: Array.isArray(data.sessions) ? data.sessions : [],
        });
      }

      const bookingId = String((data.booking as { id?: string } | undefined)?.id || "");
      if (!bookingId) return json({ ok: true, ...data });
      const summary = await buildPublicManageBookingSummary(supabase, businessId, bookingId, {
        customerPortalUrl: portalUrls.customerPortalUrl,
        manageToken: params.token,
      });
      return json(summary);
    }

    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (error) {
    console.error("[tavari-api-manage-booking]", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Internal error",
    }, 500);
  }
});

function responseOk(status: number) {
  return status >= 200 && status < 300;
}
