import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getMailTokenSigningSecret,
  verifySignedMailToken,
} from "../_shared/mailTokenSecurity.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ConsentPayload = {
  businessId?: string;
  contactId?: string;
  emailAddress?: string;
  action?: string;
  consentSource?: string;
  consentMethod?: string | null;
  consentText?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  additionalData?: Record<string, unknown> | null;
  signedToken?: string | null;
  token?: string | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || "Unknown error");
  }
  return "Unknown error";
}

function decodeLegacyToken(token: string) {
  const decoded = atob(token);
  const [contactId, businessId] = decoded.split(":");
  if (!contactId || !businessId) {
    throw new Error("Invalid legacy token");
  }
  return { contactId, businessId };
}

async function getAuthorizedUserId(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return "service_role";
  if (!SUPABASE_ANON_KEY) return null;

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const {
    data: { user },
  } = await authClient.auth.getUser();

  return user?.id || null;
}

async function hasBusinessAccess(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  businessId: string,
) {
  if (!userId || !businessId) return false;
  if (userId === "service_role") return true;

  const [{ data: businessMembership }, { data: roleMembership }] = await Promise.all([
    supabase
      .from("business_users")
      .select("business_id")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("user_roles")
      .select("business_id")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
  ]);

  return Boolean(businessMembership || roleMembership);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const payload = (await req.json().catch(() => ({}))) as ConsentPayload;
    let businessId = String(payload.businessId || "").trim();
    let contactId = String(payload.contactId || "").trim();
    let emailAddress = String(payload.emailAddress || "").trim().toLowerCase();
    let action = String(payload.action || "").trim();
    const consentSource = String(payload.consentSource || "manual").trim();
    const consentMethod = payload.consentMethod ? String(payload.consentMethod).trim() : null;
    const consentText = payload.consentText ? String(payload.consentText) : null;
    const ipAddress =
      payload.ipAddress
        ? String(payload.ipAddress).trim()
        : (req.headers.get("x-forwarded-for") || "").split(",")[0]?.trim() || null;
    const userAgent = payload.userAgent ? String(payload.userAgent) : (req.headers.get("user-agent") || null);
    const additionalData = payload.additionalData ?? null;
    const suppliedToken = String(payload.signedToken || payload.token || "").trim();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const nowIso = new Date().toISOString();
    const authUserId = await getAuthorizedUserId(req);
    const isAuthenticatedInternalCaller =
      Boolean(authUserId) && Boolean(businessId) && await hasBusinessAccess(supabase, authUserId, businessId);

    if (!isAuthenticatedInternalCaller) {
      if (!suppliedToken) {
        return jsonResponse({ ok: false, error: "Public consent actions require a valid token" }, 401);
      }

      if (suppliedToken.includes(".")) {
        const verifiedToken = await verifySignedMailToken(suppliedToken, getMailTokenSigningSecret());
        if (verifiedToken.kind !== "mail_consent_action") {
          return jsonResponse({ ok: false, error: "Invalid consent token" }, 401);
        }

        businessId = String(verifiedToken.businessId || "").trim();
        contactId = String(verifiedToken.contactId || "").trim();
        emailAddress = String(verifiedToken.emailAddress || "").trim().toLowerCase();
        action = String(action || verifiedToken.action || "").trim();
      } else {
        const legacy = decodeLegacyToken(suppliedToken);
        businessId = businessId || legacy.businessId;
        contactId = contactId || legacy.contactId;

        if (!["unsubscribe", "unsubscribe_duplicate"].includes(action)) {
          return jsonResponse({ ok: false, error: "Legacy tokens only support unsubscribe actions" }, 401);
        }
      }
    }

    if (!businessId || !contactId || !action) {
      return jsonResponse({ ok: false, error: "Missing required consent fields" }, 400);
    }

    const { data: contactRecord, error: contactLookupError } = await supabase
      .from("mail_contacts")
      .select("id, email, business_id")
      .eq("id", contactId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (contactLookupError) {
      throw contactLookupError;
    }

    if (!contactRecord) {
      return jsonResponse({ ok: false, error: "Contact not found" }, 404);
    }

    emailAddress = String(contactRecord.email || emailAddress || "").trim().toLowerCase();

    if (!emailAddress) {
      return jsonResponse({ ok: false, error: "Missing contact email" }, 400);
    }

    const { error: logError } = await supabase
      .from("mail_consent_log")
      .insert({
        business_id: businessId,
        contact_id: contactId,
        email_address: emailAddress,
        action,
        consent_source: consentSource,
        consent_method: consentMethod,
        consent_text: consentText,
        ip_address: ipAddress,
        user_agent: userAgent,
        additional_data: {
          ...(additionalData || {}),
          token_type: suppliedToken
            ? (suppliedToken.includes(".") ? "signed" : "legacy")
            : "authenticated",
        },
      });

    if (logError) {
      throw logError;
    }

    if (action === "unsubscribe" || action === "auto_unsubscribe") {
      const { error: updateError } = await supabase
        .from("mail_contacts")
        .update({
          subscribed: false,
          unsubscribed_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", contactId)
        .eq("business_id", businessId);

      if (updateError) {
        throw updateError;
      }

      const { error: unsubscribeError } = await supabase
        .from("mail_unsubscribes")
        .upsert({
          business_id: businessId,
          email: emailAddress,
          contact_id: contactId,
          unsubscribed_at: nowIso,
          source: consentSource,
          ip_address: ipAddress,
          user_agent: userAgent,
        }, {
          onConflict: "business_id,email",
        });

      if (unsubscribeError) {
        throw unsubscribeError;
      }
    } else if (action === "resubscribe") {
      const { error: updateError } = await supabase
        .from("mail_contacts")
        .update({
          subscribed: true,
          unsubscribed_at: null,
          consent_source: consentSource || "preferences_center",
          consent_method: consentMethod || "express",
          consent_timestamp: nowIso,
          consent_ip_address: ipAddress,
          consent_user_agent: userAgent,
          consent_text: consentText,
          updated_at: nowIso,
        })
        .eq("id", contactId)
        .eq("business_id", businessId);

      if (updateError) {
        throw updateError;
      }

      const { error: deleteError } = await supabase
        .from("mail_unsubscribes")
        .delete()
        .eq("business_id", businessId)
        .eq("email", emailAddress);

      if (deleteError) {
        throw deleteError;
      }
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ ok: false, error: getErrorMessage(error) }, 500);
  }
});
