// Public waiver embed config + OTP signing for external websites (OTWK).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createWaiverEmbedPendingToken,
  createWaiverEmbedSubmitToken,
  normalizePhone,
  verifyWaiverEmbedPendingToken,
  verifyWaiverEmbedSubmitToken,
} from "../_shared/customerAppSession.ts";
import {
  loadPublicWaiverEmbedConfig,
  sendEmbedOtpEmail,
  submitPublicWaiverEmbed,
} from "../_shared/tavariPublicWaiverEmbed.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-waiver-embed-token",
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

function resolveParams(req: Request, body: Record<string, unknown>) {
  const url = new URL(req.url);
  return {
    businessId: String(
      body.businessId ?? body.business_id ?? url.searchParams.get("businessId") ??
        url.searchParams.get("business_id") ?? "",
    ).trim(),
    action: String(
      body.action ?? url.searchParams.get("action") ?? "config",
    ).trim(),
    templateKey: String(
      body.templateKey ?? body.template_key ?? url.searchParams.get("templateKey") ??
        url.searchParams.get("template_key") ?? "",
    ).trim(),
    websiteOrigin: String(
      body.websiteOrigin ?? body.website_origin ?? url.searchParams.get("websiteOrigin") ??
        url.searchParams.get("website_origin") ?? "",
    ).trim(),
    phoneNumber: String(
      body.phoneNumber ?? body.phone ?? url.searchParams.get("phoneNumber") ??
        url.searchParams.get("phone") ?? "",
    ).trim(),
    email: String(body.email ?? url.searchParams.get("email") ?? "").trim(),
    otpCode: String(body.otpCode ?? body.otp ?? body.code ?? "").trim(),
    pendingToken: String(
      body.pendingToken ?? body.pending_token ?? url.searchParams.get("pendingToken") ??
        url.searchParams.get("pending_token") ?? "",
    ).trim(),
    submitToken: String(
      body.submitToken ?? body.submit_token ??
        req.headers.get("X-Waiver-Embed-Token") ?? "",
    ).trim(),
    templateId: String(body.templateId ?? body.template_id ?? "").trim(),
    signatureBase64: String(body.signatureBase64 ?? body.signature ?? "").trim(),
  };
}

function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 1) return "***@***";
  return `${trimmed[0]}***@${trimmed.slice(at + 1)}`;
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
    const {
      businessId,
      action,
      templateKey,
      websiteOrigin,
      phoneNumber,
      email,
      otpCode,
      pendingToken,
      submitToken,
      templateId,
      signatureBase64,
    } = params;

    if (!businessId || !UUID_RE.test(businessId)) {
      return json({ ok: false, error: "Valid businessId is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: moduleRow, error: moduleErr } = await supabase
      .from("business_module_usage")
      .select("enabled")
      .eq("business_id", businessId)
      .eq("module_key", "tavari_apis")
      .maybeSingle();

    if (moduleErr) {
      console.error("[tavari-api-waiver-embed] module check", moduleErr);
      return json({ ok: false, error: "Could not verify API access" }, 500);
    }

    if (!moduleRow?.enabled) {
      return json({ ok: false, error: "Tavari APIs is not enabled for this business" }, 403);
    }

    const normalizedAction = action.toLowerCase();

    if (normalizedAction === "config" || normalizedAction === "getconfig") {
      const config = await loadPublicWaiverEmbedConfig(supabase, businessId, {
        templateKey: templateKey || undefined,
        supabaseUrl: Deno.env.get("SUPABASE_URL") || undefined,
        websiteOrigin: websiteOrigin || null,
      });
      return json(config as unknown as Record<string, unknown>);
    }

    if (normalizedAction === "sendotp") {
      const phone = normalizePhone(phoneNumber);
      const emailNorm = email.trim().toLowerCase();
      if (phone.length < 10) {
        return json({ ok: false, error: "Valid phone number is required" }, 400);
      }
      if (!emailNorm.includes("@")) {
        return json({ ok: false, error: "Valid email is required to send a verification code" }, 400);
      }

      const { data: otpCodeValue, error: otpError } = await supabase.rpc("waivers_generate_otp", {
        p_business_id: businessId,
        p_phone_number: phone,
        p_email: emailNorm,
        p_customer_id: null,
        p_ip_address: req.headers.get("x-forwarded-for") || "unknown",
        p_user_agent: "otwk-website-embed",
      });

      if (otpError) return json({ ok: false, error: otpError.message }, 400);
      if (!otpCodeValue) {
        return json({ ok: false, error: "Could not generate verification code" }, 500);
      }

      await sendEmbedOtpEmail(supabase, businessId, emailNorm, String(otpCodeValue), phone);
      const issuedPendingToken = await createWaiverEmbedPendingToken({
        businessId,
        phone,
        email: emailNorm,
      });

      return json({
        ok: true,
        otpSent: true,
        maskedEmail: maskEmail(emailNorm),
        phoneLastFour: phone.slice(-4),
        pendingToken: issuedPendingToken,
      });
    }

    if (normalizedAction === "verifyotp") {
      let phone = normalizePhone(phoneNumber);
      let emailNorm = email.trim().toLowerCase();
      let templateIdForToken = templateId;

      if (pendingToken) {
        const pending = await verifyWaiverEmbedPendingToken(pendingToken);
        if (pending?.businessId === businessId) {
          phone = pending.phone;
          emailNorm = pending.email;
        }
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

      if (!UUID_RE.test(templateIdForToken)) {
        const config = await loadPublicWaiverEmbedConfig(supabase, businessId, {
          templateKey: templateKey || undefined,
        });
        templateIdForToken = config.template.id;
      }

      const issuedSubmitToken = await createWaiverEmbedSubmitToken({
        businessId,
        phone,
        email: emailNorm,
        templateId: templateIdForToken,
      });

      return json({ ok: true, submitToken: issuedSubmitToken, templateId: templateIdForToken });
    }

    if (normalizedAction === "submit") {
      const token = submitToken ||
        String(body.submitToken ?? body.submit_token ?? req.headers.get("X-Waiver-Embed-Token") ?? "").trim();
      const session = token ? await verifyWaiverEmbedSubmitToken(token) : null;
      if (!session || session.businessId !== businessId) {
        return json({ ok: false, error: "Verification expired — confirm your phone again" }, 401);
      }

      const participants = Array.isArray(body.participants)
        ? body.participants as Array<Record<string, unknown>>
        : [];
      const consentStates = body.consentStates && typeof body.consentStates === "object"
        ? body.consentStates as Record<string, boolean>
        : {};
      const marketingOptIn = Boolean(body.marketingOptIn);

      const mappedParticipants = participants.map((p) => ({
        type: String(p.type || "primary"),
        firstName: String(p.firstName || p.first_name || ""),
        lastName: String(p.lastName || p.last_name || ""),
        dateOfBirth: p.dateOfBirth || p.date_of_birth || null,
        email: p.email ? String(p.email) : null,
        phone: p.phone ? String(p.phone) : null,
      }));

      const result = await submitPublicWaiverEmbed(supabase, {
        businessId,
        templateId: session.templateId,
        phone: session.phone,
        email: session.email,
        signatureBase64,
        participants: mappedParticipants,
        consentStates,
        marketingOptIn,
      });

      return json({ ok: true, ...result, message: "Waiver signed successfully" });
    }

    return json({ ok: false, error: "Unknown action. Use config, sendOtp, verifyOtp, or submit." }, 400);
  } catch (error) {
    console.error("[tavari-api-waiver-embed]", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Internal error",
    }, 500);
  }
});
