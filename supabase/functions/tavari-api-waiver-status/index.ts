// Public waiver validity check for external websites (OTWK) — no full waiver payload.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createWaiverStatusPendingToken,
  createWaiverStatusToken,
  extractBearerToken,
  normalizePhone,
  verifyCustomerSessionToken,
  verifyWaiverStatusPendingToken,
  verifyWaiverStatusToken,
  verifyWaiverViewerToken,
} from "../_shared/customerAppSession.ts";
import {
  maskEmail,
  resolvePublicWaiverStatusForPhone,
  searchWaiversByEmail,
  searchWaiversByPhone,
} from "../_shared/tavariPublicWaiverStatus.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-waiver-status-token, x-customer-session",
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

function statusResponse(
  status: Awaited<ReturnType<typeof resolvePublicWaiverStatusForPhone>>,
  extra: Record<string, unknown> = {},
) {
  return json({
    ok: true,
    valid: status.valid,
    found: status.found,
    expiresAt: status.expiresAt,
    lastSignedAt: status.lastSignedAt,
    expiringSoon: status.expiringSoon,
    needsResign: status.needsResign,
    message: status.message,
    ...extra,
  });
}

async function sendOtpEmail(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  email: string,
  otpCode: string,
  phone: string,
) {
  const { data: business } = await supabase
    .from("businesses")
    .select("name")
    .eq("id", businessId)
    .maybeSingle();

  const businessName = String(business?.name || "Off The Wall Kids").trim() || "Off The Wall Kids";
  const subject = `Your waiver check code - ${businessName}`;
  const text = `Your verification code is: ${otpCode}\n\nThis code expires in 10 minutes.\n\nIf you did not request this, ignore this email.\n\n${businessName}`;
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
<p>Your verification code is:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;padding:16px;background:#f5f5f5;border-radius:8px">${otpCode}</p>
<p style="font-size:12px;color:#666">Expires in 10 minutes.</p>
</body></html>`;

  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || ""}`,
    },
    body: JSON.stringify({
      businessId,
      campaignId: `waiver-status-otp-${phone}-${Date.now()}`,
      emailType: "transactional",
      to: email,
      fromEmail: "noreply@tavarios.ca",
      fromName: `${businessName} - Verification`,
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.warn("[tavari-api-waiver-status] mail-send failed:", err.slice(0, 400));
  }
}

async function resolveOtpDelivery(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  phoneInput: string,
  emailInput: string,
) {
  const phone = normalizePhone(phoneInput);
  const email = emailInput.trim().toLowerCase();

  if (phone.length >= 10) {
    const { data: customerRows, error: lookupError } = await supabase.rpc(
      "bookings_get_portal_customer_by_phone",
      { p_business_id: businessId, p_phone_number: phone },
    );
    if (lookupError) throw new Error(lookupError.message);

    const customer = Array.isArray(customerRows) ? customerRows[0] : customerRows;
    const customerEmail = String(customer?.customer_email || "").trim();
    if (customerEmail) {
      return {
        phone,
        email: customerEmail,
        customerId: String(customer?.id || "") || null,
      };
    }

    const waivers = await searchWaiversByPhone(supabase, businessId, phone);
    const waiverEmail = String(waivers[0]?.email || "").trim();
    if (waiverEmail) {
      return {
        phone,
        email: waiverEmail,
        customerId: String(waivers[0]?.customer_id || "") || null,
      };
    }

    return null;
  }

  if (email && email.includes("@")) {
    const { data: customers } = await supabase
      .from("pos_loyalty_accounts")
      .select("id, customer_phone, customer_email")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .ilike("customer_email", email)
      .limit(5);

    const customer = (customers || []).find((row) =>
      String(row.customer_email || "").trim().toLowerCase() === email
    );
    if (customer?.customer_email) {
      const customerPhone = normalizePhone(customer.customer_phone);
      if (customerPhone.length < 10) return null;
      return {
        phone: customerPhone,
        email: String(customer.customer_email).trim(),
        customerId: String(customer.id),
      };
    }

    const waivers = await searchWaiversByEmail(supabase, businessId, email);
    const latest = waivers[0];
    const waiverPhone = normalizePhone(latest?.phone_number);
    const waiverEmail = String(latest?.email || "").trim().toLowerCase();
    if (waiverPhone.length >= 10 && waiverEmail === email) {
      return {
        phone: waiverPhone,
        email: waiverEmail,
        customerId: String(latest?.customer_id || "") || null,
      };
    }
  }

  return null;
}

async function resolveAuthorizedPhone(
  req: Request,
  body: Record<string, unknown>,
  businessId: string,
): Promise<string | null> {
  const statusToken = String(
    body.statusToken ??
      body.status_token ??
      req.headers.get("X-Waiver-Status-Token") ??
      "",
  ).trim();

  if (statusToken) {
    const payload = await verifyWaiverStatusToken(statusToken);
    if (payload?.businessId === businessId) return payload.phone;
    const viewer = await verifyWaiverViewerToken(statusToken);
    if (viewer?.businessId === businessId) return viewer.phone;
  }

  const sessionToken =
    extractBearerToken(req) ||
    String(req.headers.get("X-Customer-Session") || "").trim() ||
    String(body.sessionToken || body.session_token || "").trim();

  if (sessionToken) {
    const session = await verifyCustomerSessionToken(sessionToken);
    if (session?.businessId === businessId) return session.phone;
  }

  return null;
}

function resolveParams(req: Request, body: Record<string, unknown>) {
  const url = new URL(req.url);
  return {
    businessId: String(
      body.businessId ?? body.business_id ?? url.searchParams.get("businessId") ??
        url.searchParams.get("business_id") ?? "",
    ).trim(),
    action: String(
      body.action ?? url.searchParams.get("action") ?? "status",
    ).trim().toLowerCase(),
    phoneNumber: String(
      body.phoneNumber ?? body.phone ?? url.searchParams.get("phoneNumber") ??
        url.searchParams.get("phone") ?? "",
    ).trim(),
    email: String(body.email ?? url.searchParams.get("email") ?? "").trim(),
    otpCode: String(body.otpCode ?? body.otp ?? body.code ?? "").trim(),
    pendingToken: String(body.pendingToken ?? body.pending_token ?? "").trim(),
    pendingToken: String(
      body.pendingToken ?? body.pending_token ?? url.searchParams.get("pendingToken") ??
        url.searchParams.get("pending_token") ?? "",
    ).trim(),
    statusToken: String(
      body.statusToken ?? body.status_token ?? url.searchParams.get("statusToken") ??
        url.searchParams.get("status_token") ?? "",
    ).trim(),
  };
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
    const { businessId, action, phoneNumber, email, otpCode, pendingToken, statusToken } = resolveParams(req, body);

    if (!businessId || !UUID_RE.test(businessId)) {
      return json({ ok: false, error: "Valid businessId is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    if (action === "sendotp") {
      const delivery = await resolveOtpDelivery(supabase, businessId, phoneNumber, email);
      if (!delivery) {
        return json({
          ok: true,
          otpSent: false,
          found: false,
          message: "No account or waiver found for that phone or email.",
        });
      }

      const { data: otpCodeValue, error: otpError } = await supabase.rpc("waivers_generate_otp", {
        p_business_id: businessId,
        p_phone_number: delivery.phone,
        p_email: delivery.email,
        p_customer_id: delivery.customerId && UUID_RE.test(delivery.customerId)
          ? delivery.customerId
          : null,
        p_ip_address: req.headers.get("x-forwarded-for") || "unknown",
        p_user_agent: req.headers.get("user-agent") || "otwk-website",
      });

      if (otpError) return json({ ok: false, error: otpError.message }, 400);
      if (!otpCodeValue) return json({ ok: false, error: "Could not generate verification code" }, 500);

      await sendOtpEmail(supabase, businessId, delivery.email, String(otpCodeValue), delivery.phone);
      const issuedPendingToken = await createWaiverStatusPendingToken({
        businessId,
        phone: delivery.phone,
      });

      return json({
        ok: true,
        otpSent: true,
        maskedEmail: maskEmail(delivery.email),
        phoneLastFour: delivery.phone.slice(-4),
        pendingToken: issuedPendingToken,
      });
    }

    if (action === "verifyotp") {
      let phone = normalizePhone(phoneNumber);
      if (phone.length < 10 && pendingToken) {
        const pending = await verifyWaiverStatusPendingToken(pendingToken);
        if (pending?.businessId === businessId) phone = pending.phone;
      }
      if (phone.length < 10 || otpCode.length < 4) {
        return json({ ok: false, error: "Phone and verification code are required" }, 400);
      }

      const { data: verifyResult, error: verifyError } = await supabase.rpc("waivers_verify_otp", {
        p_phone_number: phone,
        p_otp_code: otpCode,
        p_business_id: businessId,
      });

      if (verifyError) return json({ ok: false, error: verifyError.message }, 400);

      const result = verifyResult as Record<string, unknown> | null;
      if (!result?.valid) {
        return json({ ok: false, error: String(result?.error || "Invalid verification code") }, 401);
      }

      const status = await resolvePublicWaiverStatusForPhone(supabase, businessId, phone);
      const issuedStatusToken = await createWaiverStatusToken({ businessId, phone });

      return statusResponse(status, { statusToken: issuedStatusToken });
    }

    const authorizedPhone = await resolveAuthorizedPhone(req, { ...body, statusToken }, businessId);
    if (authorizedPhone) {
      const status = await resolvePublicWaiverStatusForPhone(supabase, businessId, authorizedPhone);
      return statusResponse(status);
    }

    return json({
      ok: false,
      error: "Verification required. Use sendOtp + verifyOtp, or pass a valid statusToken.",
    }, 401);
  } catch (error) {
    console.error("[tavari-api-waiver-status]", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Internal error",
    }, 500);
  }
});
