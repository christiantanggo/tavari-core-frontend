// Public customer auth for OTWK app — phone OTP (same RPCs as waiver / booking portal).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createCustomerSessionToken,
  normalizePhone,
} from "../_shared/customerAppSession.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-customer-session",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 1) return "***@***";
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  return `${local[0]}***@${domain}`;
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
  const subject = `Your sign-in code - ${businessName}`;
  const text = `Your sign-in code is: ${otpCode}\n\nThis code expires in 10 minutes.\n\nIf you did not request this, ignore this email.\n\n${businessName}`;
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
<p>Your sign-in code is:</p>
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
      campaignId: `waiver-otp-${phone}-${Date.now()}`,
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
    console.warn("[tavari-api-customer-auth] mail-send failed:", err.slice(0, 400));
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "sendOtp").trim();
    const businessId = String(body.businessId || body.business_id || "").trim();

    if (!UUID_RE.test(businessId)) {
      return jsonResponse({ error: "Invalid businessId" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "sendOtp") {
      const phone = normalizePhone(body.phoneNumber ?? body.phone);

      if (phone.length < 10) {
        return jsonResponse({ error: "Invalid phone number" }, 400);
      }

      const { data: customerRows, error: lookupError } = await supabase.rpc(
        "bookings_get_portal_customer_by_phone",
        { p_business_id: businessId, p_phone_number: phone },
      );

      if (lookupError) {
        return jsonResponse({ error: lookupError.message }, 400);
      }

      const customer = Array.isArray(customerRows) ? customerRows[0] : customerRows;
      const customerEmail = String(customer?.customer_email || "").trim();

      if (customer?.id && customerEmail) {
        const { data: otpCode, error: otpError } = await supabase.rpc("waivers_generate_otp", {
          p_business_id: businessId,
          p_phone_number: phone,
          p_email: customerEmail,
          p_customer_id: customer.id,
          p_ip_address: req.headers.get("x-forwarded-for") || "unknown",
          p_user_agent: req.headers.get("user-agent") || "otwk-app",
        });

        if (otpError) {
          return jsonResponse({ error: otpError.message }, 400);
        }

        if (otpCode) {
          await sendOtpEmail(supabase, businessId, customerEmail, String(otpCode), phone);
        }

        return jsonResponse({
          ok: true,
          otpSent: true,
          maskedEmail: maskEmail(customerEmail),
          customerId: customer.id,
          requiresAccountCreation: false,
        });
      }

      const nameParts = String(customer?.customer_name || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);

      return jsonResponse({
        ok: true,
        otpSent: false,
        maskedEmail: null,
        customerId: customer?.id || null,
        requiresAccountCreation: true,
        prefill: {
          firstName: nameParts[0] || "",
          lastName: nameParts.slice(1).join(" ") || "",
          email: customerEmail || "",
        },
      });
    }

    if (action === "verifyOtp") {
      const phone = normalizePhone(body.phoneNumber ?? body.phone);
      const otpCode = String(body.otpCode || body.otp || "").trim();

      if (phone.length < 10 || otpCode.length !== 6) {
        return jsonResponse({ error: "Invalid phone or OTP" }, 400);
      }

      const { data: verifyResult, error: verifyError } = await supabase.rpc("waivers_verify_otp", {
        p_phone_number: phone,
        p_otp_code: otpCode,
        p_business_id: businessId,
      });

      if (verifyError) {
        return jsonResponse({ error: verifyError.message }, 400);
      }

      const result = verifyResult as Record<string, unknown> | null;
      if (!result?.valid) {
        return jsonResponse({ error: String(result?.error || "Invalid OTP") }, 401);
      }

      const customerId = String(result.customerId ?? result.customer_id ?? "").trim();
      if (!UUID_RE.test(customerId)) {
        return jsonResponse({ error: "Customer account not found" }, 404);
      }

      const sessionToken = await createCustomerSessionToken({
        customerId,
        businessId,
        phone,
      });

      const { data: customer } = await supabase
        .from("pos_loyalty_accounts")
        .select("id, customer_name, customer_email, customer_phone")
        .eq("id", customerId)
        .eq("business_id", businessId)
        .maybeSingle();

      return jsonResponse({
        ok: true,
        sessionToken,
        customer: customer
          ? {
              id: customer.id,
              name: customer.customer_name,
              email: customer.customer_email,
              phone: customer.customer_phone,
            }
          : { id: customerId },
      });
    }

    if (action === "createAccount") {
      const phone = normalizePhone(body.phoneNumber ?? body.phone);
      const email = String(body.email || "").trim().toLowerCase();
      const firstName = String(body.firstName || "").trim();
      const lastName = String(body.lastName || "").trim();

      if (!firstName || !lastName || !email) {
        return jsonResponse({ error: "firstName, lastName, and email are required" }, 400);
      }

      const { data: rows, error } = await supabase.rpc("bookings_create_or_get_portal_customer", {
        p_business_id: businessId,
        p_phone_number: phone || null,
        p_email: email,
        p_first_name: firstName,
        p_last_name: lastName,
        p_city: null,
      });

      if (error) {
        return jsonResponse({ error: error.message }, 400);
      }

      const customer = Array.isArray(rows) ? rows[0] : rows;
      if (!customer?.id) {
        return jsonResponse({ error: "Unable to create account" }, 500);
      }

      const sessionToken = await createCustomerSessionToken({
        customerId: customer.id,
        businessId,
        phone,
      });

      return jsonResponse({
        ok: true,
        sessionToken,
        customer: {
          id: customer.id,
          name: customer.customer_name,
          email: customer.customer_email,
          phone: customer.customer_phone || phone,
        },
        customerId: customer.id,
        created: true,
      });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("[tavari-api-customer-auth]", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Server error" },
      500,
    );
  }
});
