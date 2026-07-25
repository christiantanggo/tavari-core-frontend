 
// functions/mail-send/index.ts
// Deno (Supabase Edge Functions) + AWS SES v2

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  SESv2Client,
  SendEmailCommand
} from "npm:@aws-sdk/client-sesv2@3.654.0";
import {
  SESClient,
  SendRawEmailCommand
} from "npm:@aws-sdk/client-ses@3.654.0";
import {
  createSignedMailToken,
  getMailTokenSigningSecret,
} from "../_shared/mailTokenSecurity.ts";
import {
  resolveBusinessAddress,
  resolveBusinessName,
} from "../_shared/mailBusinessProfile.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
  AWS_REGION,
  SES_ACCESS_KEY_ID,
  SES_SECRET_ACCESS_KEY,
  SES_CONFIGURATION_SET
} = Deno.env.toObject();

const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
const TRACKING_BASE_URL = `${SUPABASE_URL!.replace(/\/$/, "")}/functions/v1`;

const ses = new SESv2Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: SES_ACCESS_KEY_ID!,
    secretAccessKey: SES_SECRET_ACCESS_KEY!
  }
});

// SES v1 client for Raw email (needed for attachments)
const sesV1 = new SESClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: SES_ACCESS_KEY_ID!,
    secretAccessKey: SES_SECRET_ACCESS_KEY!
  }
});

type Attachment = {
  filename: string;
  content: string; // base64 encoded
  contentType: string;
};

type SendPayload = {
  businessId: string;
  campaignId?: string | null;
  contactId?: string | null;
  rolloutId?: string | null;
  rolloutBatchId?: string | null;
  emailType?: "marketing" | "transactional";
  to: string;
  cc?: string; // Comma-separated CC recipients
  bcc?: string; // Comma-separated BCC recipients
  fromEmail: string;
  fromName?: string;
  subject: string;
  html: string;
  text?: string;
  configurationSet?: string;
  attachments?: Attachment[];
  mailboxId?: string | null;
  sourceReceivedEmailId?: string | null;
  threadId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  sourceModule?: string | null;
  sourceId?: string | null;
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeUuid(value: unknown): string | null {
  const text = String(value || "").trim();
  return UUID_REGEX.test(text) ? text : null;
}

function buildSesTags(payload: SendPayload) {
  const campaignId = normalizeUuid(payload.campaignId);
  const contactId = normalizeUuid(payload.contactId);
  const rolloutId = normalizeUuid(payload.rolloutId);
  const rolloutBatchId = normalizeUuid(payload.rolloutBatchId);

  return [
    { Name: "business_id", Value: String(payload.businessId || "") },
    ...(campaignId ? [{ Name: "campaign_id", Value: campaignId }] : []),
    ...(contactId ? [{ Name: "contact_id", Value: contactId }] : []),
    ...(rolloutId ? [{ Name: "rollout_id", Value: rolloutId }] : []),
    ...(rolloutBatchId ? [{ Name: "rollout_batch_id", Value: rolloutBatchId }] : []),
  ];
}

function shouldRetryWithoutConfigurationSet(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();
  return normalized.includes("configuration set") && normalized.includes("does not exist");
}

function toBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

const DEFAULT_PUBLIC_SITE_URL = "https://tavarios.ca";
const SIGNED_UNSUBSCRIBE_PLACEHOLDER = "__TAVARI_SIGNED_UNSUBSCRIBE_URL__";
const EMAIL_BODY_SNAPSHOT_RETENTION_DAYS = 90;

function normalizePublicSiteUrl(value: string | undefined | null) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";

  if (/^https?:\/\/(?:app\.)?tavari\.ca\/?$/i.test(trimmed)) {
    return DEFAULT_PUBLIC_SITE_URL;
  }

  return trimmed.replace(/\/$/, "");
}

function resolvePublicSiteUrl() {
  return (
    normalizePublicSiteUrl(Deno.env.get("PUBLIC_SITE_URL")) ||
    normalizePublicSiteUrl(Deno.env.get("SITE_URL")) ||
    normalizePublicSiteUrl(Deno.env.get("VITE_APP_URL")) ||
    DEFAULT_PUBLIC_SITE_URL
  );
}

function parseRecipientList(value: string | undefined | null) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function escapeForRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function buildSignedUnsubscribeUrl(input: {
  businessId: string;
  contactId: string | null;
  email: string;
}) {
  const token = await createSignedMailToken(
    {
      kind: "mail_consent_action",
      action: "unsubscribe",
      businessId: input.businessId,
      contactId: input.contactId,
      emailAddress: input.email,
    },
    getMailTokenSigningSecret(),
    60 * 60 * 24 * 365,
  );

  return `${resolvePublicSiteUrl()}/unsubscribe?token=${encodeURIComponent(token)}`;
}

async function applySignedUnsubscribeLinks(
  payload: SendPayload,
  html: string,
  mailSettings: { businessName: string; businessAddress: string },
  primaryRecipient: { email: string; contactId: string | null } | null,
) {
  if ((payload.emailType || "marketing") === "transactional" || !primaryRecipient?.email) {
    return html;
  }

  const unsubscribeUrl = await buildSignedUnsubscribeUrl({
    businessId: payload.businessId,
    contactId: primaryRecipient.contactId,
    email: primaryRecipient.email,
  });

  let output = String(html || "")
    .replace(new RegExp(escapeForRegex(SIGNED_UNSUBSCRIBE_PLACEHOLDER), "g"), unsubscribeUrl)
    .replace(/\{UnsubscribeLink\}/g, unsubscribeUrl)
    .replace(/\{UpdatePreferencesLink\}/g, unsubscribeUrl)
    .replace(/https?:\/\/[^"'\s>]*\/unsubscribe\?token=[^"'\s>]+/gi, unsubscribeUrl)
    .replace(/\/unsubscribe\?token=[^"'\s>]+/gi, unsubscribeUrl);

  if (!/unsubscribe/i.test(output)) {
    const complianceFooter = `
      <div style="margin-top: 40px; padding: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #666; text-align: center;">
        <p style="margin: 0 0 10px 0;">
          You are receiving this email because you subscribed to ${mailSettings.businessName} communications.
        </p>
        <p style="margin: 0 0 10px 0;">
          <a href="${unsubscribeUrl}" style="color: #0066cc; text-decoration: underline;">Unsubscribe</a>
          |
          <a href="${unsubscribeUrl}" style="color: #0066cc; text-decoration: underline;">Update Preferences</a>
        </p>
        <p style="margin: 0; font-size: 11px;">
          ${mailSettings.businessAddress}
        </p>
      </div>
    `;

    output = output.includes("</body>")
      ? output.replace("</body>", `${complianceFooter}</body>`)
      : `${output}${complianceFooter}`;
  }

  return output;
}

async function buildListUnsubscribeHeaders(
  payload: SendPayload,
  primaryRecipient: { email: string; contactId: string | null } | null,
) {
  if ((payload.emailType || "marketing") === "transactional" || !primaryRecipient?.email) {
    return [];
  }

  const unsubscribeUrl = await buildSignedUnsubscribeUrl({
    businessId: payload.businessId,
    contactId: primaryRecipient.contactId,
    email: primaryRecipient.email,
  });

  return [
    { Name: "List-Unsubscribe", Value: `<${unsubscribeUrl}>` },
    { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
  ];
}

function sanitizeRawHeaderValue(value: string) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function appendTrackingPixel(html: string, pixelUrl: string) {
  const pixelTag = `<img src="${pixelUrl}" alt="" width="1" height="1" style="display:none!important;width:1px!important;height:1px!important;border:0!important;" />`;

  if (html.includes("</body>")) {
    return html.replace("</body>", `${pixelTag}</body>`);
  }

  return `${html}${pixelTag}`;
}

async function applyTrackingToHtml(payload: SendPayload, html: string) {
  const campaignId = normalizeUuid(payload.campaignId);
  const contactId = normalizeUuid(payload.contactId);
  const isTrackableCampaignEmail = !!campaignId && !!contactId;

  if (!isTrackableCampaignEmail) {
    return html;
  }

  const basePayload = {
    kind: "mail_tracking",
    businessId: payload.businessId,
    campaignId,
    contactId,
  };

  const openToken = await createSignedMailToken(
    {
      ...basePayload,
      eventType: "open",
      blockId: "email_open",
    },
    getMailTokenSigningSecret(),
    60 * 60 * 24 * 180,
  );

  let trackedHtml = appendTrackingPixel(
    html,
    `${TRACKING_BASE_URL}/mail-track-open?token=${encodeURIComponent(openToken)}`,
  );

  const anchorRegex = /<a\b([^>]*?)href=(["'])(.*?)\2([^>]*)>/gi;
  let result = "";
  let lastIndex = 0;
  let linkIndex = 0;

  for (const match of trackedHtml.matchAll(anchorRegex)) {
    const fullMatch = match[0];
    const beforeHref = match[1] || "";
    const quote = match[2] || '"';
    const href = match[3] || "";
    const afterHref = match[4] || "";
    const matchIndex = match.index ?? 0;
    const trimmedHref = href.trim();

    result += trackedHtml.slice(lastIndex, matchIndex);

    const shouldSkip =
      !trimmedHref ||
      /^mailto:/i.test(trimmedHref) ||
      /^tel:/i.test(trimmedHref) ||
      /^javascript:/i.test(trimmedHref) ||
      trimmedHref.startsWith("#") ||
      /unsubscribe/i.test(trimmedHref) ||
      /mail-track-(open|click)/i.test(trimmedHref);

    if (shouldSkip) {
      result += fullMatch;
      lastIndex = matchIndex + fullMatch.length;
      continue;
    }

    linkIndex += 1;

    const clickToken = await createSignedMailToken(
      {
        ...basePayload,
        eventType: "click",
        blockId: `link_${linkIndex}`,
        targetUrl: trimmedHref,
      },
      getMailTokenSigningSecret(),
      60 * 60 * 24 * 180,
    );

    const trackedHref = `${TRACKING_BASE_URL}/mail-track-click?token=${encodeURIComponent(clickToken)}`;
    result += `<a${beforeHref}href=${quote}${trackedHref}${quote}${afterHref}>`;
    lastIndex = matchIndex + fullMatch.length;
  }

  result += trackedHtml.slice(lastIndex);
  return result;
}

async function recordCampaignSend(
  payload: SendPayload,
  fields: {
    status: string;
    sent_at?: string;
    error_message?: string | null;
    message_id?: string | null;
  },
) {
  try {
    const record = {
      campaign_id: normalizeUuid(payload.campaignId),
      contact_id: normalizeUuid(payload.contactId),
      rollout_id: normalizeUuid(payload.rolloutId),
      rollout_batch_id: normalizeUuid(payload.rolloutBatchId),
      email_address: payload.to,
      status: fields.status,
      sent_at: fields.sent_at ?? new Date().toISOString(),
      error_message: fields.error_message ?? null,
      ses_message_id: fields.message_id ?? null,
    };

    if (record.campaign_id && record.contact_id) {
      const { data: existing, error: lookupError } = await supabase
        .from("mail_campaign_sends")
        .select("id")
        .eq("campaign_id", record.campaign_id)
        .eq("contact_id", record.contact_id)
        .maybeSingle();

      if (lookupError) {
        console.error("[mail-send] Failed to check existing send log:", lookupError);
        return;
      }

      if (existing?.id) {
        const { error: updateError } = await supabase
          .from("mail_campaign_sends")
          .update(record)
          .eq("id", existing.id);

        if (updateError) {
          console.error("[mail-send] Failed to update send log:", updateError);
        }
        return;
      }
    }

    const { error } = await supabase.from("mail_campaign_sends").insert(record);
    if (error) {
      console.error("[mail-send] Failed to insert send log:", error);
    }
  } catch (error) {
    console.error("[mail-send] Unexpected send-log failure:", error);
  }
}

function inferSourceModule(payload: SendPayload) {
  const explicitSource = String(payload.sourceModule || "").trim();
  if (explicitSource) return explicitSource;
  if (payload.mailboxId) return "inbox";

  const campaignId = String(payload.campaignId || "").toLowerCase();
  const subject = String(payload.subject || "").toLowerCase();
  if (campaignId.startsWith("waiver-otp-")) return "waivers";
  if (campaignId.startsWith("booking-")) return "bookings";
  if (subject.includes("receipt")) return "pos";
  if (subject.includes("pay statement") || subject.includes("paystub") || subject.includes("payroll")) return "hr";
  if (subject.includes("policy") || subject.includes("certificate")) return "hr";
  if (subject.includes("waiver")) return "waivers";
  if (subject.includes("booking") || subject.includes("confirmation")) return "bookings";
  if (payload.emailType === "marketing" || normalizeUuid(payload.campaignId)) return "mail";

  return payload.emailType === "transactional" ? "transactional" : "unknown";
}

function buildBodySnapshotExpiresAt(payload: SendPayload) {
  if (!payload.html && !payload.text) return null;
  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + EMAIL_BODY_SNAPSHOT_RETENTION_DAYS);
  return expiresAt.toISOString();
}

async function recordSystemEmailLog(
  payload: SendPayload,
  fields: {
    status: "sent" | "failed" | "blocked" | "suppressed" | "unsubscribed";
    sent_at?: string | null;
    error_message?: string | null;
    message_id?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    const sentAt = fields.sent_at ?? (fields.status === "sent" ? new Date().toISOString() : null);
    const { error } = await supabase.from("system_email_log").insert({
      business_id: payload.businessId,
      email_type: payload.emailType || "marketing",
      source_module: inferSourceModule(payload),
      source_id: payload.sourceId || payload.sourceReceivedEmailId || payload.threadId || payload.campaignId || null,
      campaign_id: normalizeUuid(payload.campaignId),
      contact_id: normalizeUuid(payload.contactId),
      mailbox_id: normalizeUuid(payload.mailboxId),
      recipient_email: parseRecipientList(payload.to)[0] || "",
      from_email: payload.fromEmail,
      from_name: payload.fromName || null,
      to_addresses: parseRecipientList(payload.to),
      cc_addresses: parseRecipientList(payload.cc),
      bcc_addresses: parseRecipientList(payload.bcc),
      subject: payload.subject || null,
      status: fields.status,
      ses_message_id: fields.message_id || null,
      error_message: fields.error_message || null,
      body_html: payload.html || null,
      body_text: payload.text || null,
      body_snapshot_expires_at: buildBodySnapshotExpiresAt(payload),
      metadata: {
        has_attachments: Array.isArray(payload.attachments) && payload.attachments.length > 0,
        attachment_count: Array.isArray(payload.attachments) ? payload.attachments.length : 0,
        body_snapshot_retention_days: EMAIL_BODY_SNAPSHOT_RETENTION_DAYS,
        rollout_id: normalizeUuid(payload.rolloutId),
        rollout_batch_id: normalizeUuid(payload.rolloutBatchId),
        thread_id: payload.threadId || null,
        in_reply_to: payload.inReplyTo || null,
        ...fields.metadata,
      },
      sent_at: sentAt,
    });

    if (error) {
      console.error("[mail-send] Failed to insert system email log:", error);
    }
  } catch (error) {
    console.error("[mail-send] Unexpected system email log failure:", error);
  }
}

type RecipientValidationResult = {
  email: string;
  contactId: string | null;
  allowed: boolean;
  reason?: string;
  blockedStatus?: "failed" | "unsubscribed" | "suppressed";
};

async function loadBusinessMailSettings(businessId: string, fallbackFromName?: string) {
  const [{ data: settings }, { data: business }] = await Promise.all([
    supabase
      .from("mail_settings")
      .select("from_name,business_address")
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase
      .from("businesses")
      .select("name, business_address")
      .eq("id", businessId)
      .maybeSingle(),
  ]);

  const businessName =
    resolveBusinessName(business, settings) ||
    String(fallbackFromName || "").trim() ||
    "Tavari";

  return {
    businessName,
    businessAddress: resolveBusinessAddress(settings, business),
  };
}

async function validateRecipientAddress(
  payload: SendPayload,
  recipientEmail: string,
  isTransactional: boolean,
): Promise<RecipientValidationResult> {
  const normalizedEmail = recipientEmail.trim().toLowerCase();

  if (!isTransactional) {
    const { data: contactRecord, error: contactLookupError } = await supabase
      .from("mail_contacts")
      .select("id,subscribed,consent_method,consent_timestamp")
      .eq("business_id", payload.businessId)
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (contactLookupError) {
      console.error("[mail-send] Contact lookup failed:", contactLookupError);
      return {
        email: normalizedEmail,
        contactId: null,
        allowed: false,
        reason: "Unable to verify contact subscription status",
        blockedStatus: "failed",
      };
    }

    if (!contactRecord) {
      return {
        email: normalizedEmail,
        contactId: null,
        allowed: false,
        reason: "Contact has no recorded marketing consent",
        blockedStatus: "failed",
      };
    }

    if (contactRecord.subscribed === false) {
      return {
        email: normalizedEmail,
        contactId: String(contactRecord.id || ""),
        allowed: false,
        reason: "Contact is unsubscribed",
        blockedStatus: "unsubscribed",
      };
    }

    if (!contactRecord.consent_method || !contactRecord.consent_timestamp) {
      return {
        email: normalizedEmail,
        contactId: String(contactRecord.id || ""),
        allowed: false,
        reason: "Contact has no recorded marketing consent",
        blockedStatus: "failed",
      };
    }

    const { data: unsubscribeRow, error: unsubscribeLookupError } = await supabase
      .from("mail_unsubscribes")
      .select("source")
      .eq("business_id", payload.businessId)
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (unsubscribeLookupError) {
      console.error("[mail-send] mail_unsubscribes lookup failed:", unsubscribeLookupError);
      return {
        email: normalizedEmail,
        contactId: String(contactRecord.id || ""),
        allowed: false,
        reason: "Unable to verify unsubscribe status",
        blockedStatus: "failed",
      };
    }

    if (unsubscribeRow) {
      const isReputationBlock =
        unsubscribeRow.source === "auto_bounce" ||
        unsubscribeRow.source === "auto_complaint";

      return {
        email: normalizedEmail,
        contactId: String(contactRecord.id || ""),
        allowed: false,
        reason: isReputationBlock
          ? "Email suppressed due to previous bounce or complaint"
          : "Contact is unsubscribed",
        blockedStatus: isReputationBlock ? "suppressed" : "unsubscribed",
      };
    }

    const { data: unsub } = await supabase.rpc("is_email_unsubscribed", {
      p_business_id: payload.businessId,
      p_email: normalizedEmail,
    });

    if (unsub === true) {
      return {
        email: normalizedEmail,
        contactId: String(contactRecord.id || ""),
        allowed: false,
        reason: "Contact is unsubscribed",
        blockedStatus: "unsubscribed",
      };
    }

    const { data: suppressed } = await supabase.rpc("is_email_suppressed", {
      p_business_id: payload.businessId,
      p_email: normalizedEmail,
    });

    if (suppressed === true) {
      return {
        email: normalizedEmail,
        contactId: String(contactRecord.id || ""),
        allowed: false,
        reason: "Email suppressed due to previous hard bounce or complaint",
        blockedStatus: "suppressed",
      };
    }

    return {
      email: normalizedEmail,
      contactId: String(contactRecord.id || ""),
      allowed: true,
    };
  }

  const { data: suppressed } = await supabase.rpc("is_email_suppressed", {
    p_business_id: payload.businessId,
    p_email: normalizedEmail,
  });

  if (suppressed === true) {
    return {
      email: normalizedEmail,
      contactId: null,
      allowed: false,
      reason: "Email suppressed due to previous hard bounce or complaint",
      blockedStatus: "suppressed",
    };
  }

  return {
    email: normalizedEmail,
    contactId: null,
    allowed: true,
  };
}

async function authorizeMarketingSend(req: Request, payload: SendPayload) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !SUPABASE_ANON_KEY) {
    return new Response("Unauthorized marketing send", {
      status: 401,
      headers: corsHeaders,
    });
  }

  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return null;
  }

  const supabaseUser = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userError,
  } = await supabaseUser.auth.getUser();

  if (userError || !user?.id) {
    console.error("[mail-send] Marketing auth failed:", userError);
    return new Response("Unauthorized marketing send", {
      status: 401,
      headers: corsHeaders,
    });
  }

  const [{ data: businessMembership }, { data: roleMembership }] = await Promise.all([
    supabaseUser
      .from("business_users")
      .select("business_id")
      .eq("business_id", payload.businessId)
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle(),
    supabaseUser
      .from("user_roles")
      .select("business_id")
      .eq("business_id", payload.businessId)
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle(),
  ]);

  if (!businessMembership && !roleMembership) {
    return new Response("Access denied to this business", {
      status: 403,
      headers: corsHeaders,
    });
  }

  return null;
}

type MailboxSenderContext = {
  mailboxId: string;
  businessId: string;
  fromEmail: string;
  fromName: string | null;
  userId: string | null;
};

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

async function getAuthenticatedMailboxUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !SUPABASE_ANON_KEY) {
    return { userId: null, response: jsonError("Unauthorized mailbox send", 401) };
  }

  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return { userId: "service_role", response: null };
  }

  const supabaseUser = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const {
    data: { user },
    error,
  } = await supabaseUser.auth.getUser();

  if (error || !user?.id) {
    console.error("[mail-send] Mailbox auth failed:", error);
    return { userId: null, response: jsonError("Unauthorized mailbox send", 401) };
  }

  return { userId: user.id, response: null };
}

async function validateMailboxSender(
  req: Request,
  payload: SendPayload,
): Promise<{ context: MailboxSenderContext | null; response: Response | null }> {
  const mailboxId = normalizeUuid(payload.mailboxId);
  if (!mailboxId) {
    return { context: null, response: jsonError("Missing mailboxId for mailbox send", 400) };
  }

  const auth = await getAuthenticatedMailboxUser(req);
  if (auth.response) {
    return { context: null, response: auth.response };
  }

  const [{ data: mailbox, error: mailboxError }, { data: businessMembership }, { data: roleMembership }] = await Promise.all([
    supabase
      .from("mailboxes")
      .select("id,business_id,email_address,display_name,status,domain:mail_domains(id,domain,verified,ses_verification_status)")
      .eq("id", mailboxId)
      .eq("business_id", payload.businessId)
      .maybeSingle(),
    auth.userId === "service_role"
      ? Promise.resolve({ data: { business_id: payload.businessId } })
      : supabase
          .from("business_users")
          .select("business_id")
          .eq("business_id", payload.businessId)
          .eq("user_id", auth.userId)
          .limit(1)
          .maybeSingle(),
    auth.userId === "service_role"
      ? Promise.resolve({ data: { business_id: payload.businessId } })
      : supabase
          .from("user_roles")
          .select("business_id")
          .eq("business_id", payload.businessId)
          .eq("user_id", auth.userId)
          .limit(1)
          .maybeSingle(),
  ]);

  if (mailboxError) {
    console.error("[mail-send] Mailbox lookup failed:", mailboxError);
    return { context: null, response: jsonError("Unable to verify mailbox sender", 500) };
  }

  if (!businessMembership && !roleMembership) {
    return { context: null, response: jsonError("Access denied to this business", 403) };
  }

  if (!mailbox?.id || mailbox.status !== "active") {
    return { context: null, response: jsonError("Mailbox is not active or does not exist", 404) };
  }

  const mailboxEmail = String(mailbox.email_address || "").trim().toLowerCase();
  if (!mailboxEmail || mailboxEmail !== String(payload.fromEmail || "").trim().toLowerCase()) {
    return { context: null, response: jsonError("Mailbox sender does not match fromEmail", 403) };
  }

  const domain = Array.isArray(mailbox.domain) ? mailbox.domain[0] : mailbox.domain;
  const domainVerified =
    domain?.verified === true ||
    String(domain?.ses_verification_status || "").toLowerCase() === "success";

  if (!domainVerified) {
    return { context: null, response: jsonError("Mailbox domain is not verified for sending", 409) };
  }

  return {
    context: {
      mailboxId: String(mailbox.id),
      businessId: String(mailbox.business_id),
      fromEmail: mailboxEmail,
      fromName: String(mailbox.display_name || payload.fromName || "").trim() || null,
      userId: auth.userId === "service_role" ? null : auth.userId,
    },
    response: null,
  };
}

async function recordMailboxSent(
  payload: SendPayload,
  context: MailboxSenderContext,
  fields: {
    status: "sent" | "failed";
    message_id?: string | null;
    error_message?: string | null;
  },
) {
  try {
    const { error } = await supabase.from("mailbox_sent_emails").insert({
      business_id: context.businessId,
      mailbox_id: context.mailboxId,
      source_received_email_id: normalizeUuid(payload.sourceReceivedEmailId),
      from_email: context.fromEmail,
      from_name: context.fromName,
      to_addresses: parseRecipientList(payload.to),
      cc_addresses: parseRecipientList(payload.cc),
      bcc_addresses: parseRecipientList(payload.bcc),
      subject: payload.subject,
      body_text: payload.text || null,
      body_html: payload.html || null,
      thread_id: payload.threadId || payload.inReplyTo || null,
      in_reply_to: payload.inReplyTo || null,
      email_references: payload.references || null,
      ses_message_id: fields.message_id || null,
      status: fields.status,
      error_message: fields.error_message || null,
      sent_by_user_id: context.userId,
      sent_at: new Date().toISOString(),
    });

    if (error) {
      console.error("[mail-send] Failed to insert mailbox sent record:", error);
    }
  } catch (error) {
    console.error("[mail-send] Unexpected mailbox sent-log failure:", error);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let payload: SendPayload | null = null;
  let mailboxSenderContext: MailboxSenderContext | null = null;

  try {

    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    }

    payload = (await req.json()) as SendPayload;
    const isMarketingSend = (payload.emailType || "marketing") !== "transactional";
    const effectiveConfigurationSet = isMarketingSend
      ? payload.configurationSet || SES_CONFIGURATION_SET || undefined
      : undefined;

    // CRITICAL: Check for attachments IMMEDIATELY after parsing
    // This must happen before any other processing
    const hasAttachments = !!(payload.attachments && 
                               Array.isArray(payload.attachments) && 
                               payload.attachments.length > 0);

    console.log('[mail-send] Received payload:', {
      businessId: payload.businessId,
      emailType: payload.emailType || "marketing",
      fromEmail: payload.fromEmail,
      fromName: payload.fromName,
      to: payload.to,
      cc: payload.cc || 'NO CC FIELD',
      hasCc: !!payload.cc,
      ccValue: payload.cc,
      subject: payload.subject,
      hasFromName: !!payload.fromName,
      fromNameValue: payload.fromName,
      'ATTACHMENTS CHECK (IMMEDIATE)': {
        'payload.attachments exists': !!payload.attachments,
        'payload.attachments type': typeof payload.attachments,
        'is array': Array.isArray(payload.attachments),
        'length': Array.isArray(payload.attachments) ? payload.attachments.length : 'N/A',
        'hasAttachments': hasAttachments,
        'attachment details': hasAttachments ? payload.attachments.map(a => ({
          filename: a.filename,
          contentType: a.contentType,
          hasContent: !!a.content,
          contentLength: a.content?.length || 0
        })) : 'NO ATTACHMENTS'
      },
      allPayloadKeys: Object.keys(payload)
    });

    // Basic validation
    for (const k of ["businessId","to","fromEmail","subject","html"]) {
      // @ts-ignore
      if (!payload[k]) return new Response(`Missing ${k}`, { status: 400, headers: corsHeaders });
    }

    const isTransactional = payload.emailType === "transactional";

    if (!isTransactional) {
      const authError = await authorizeMarketingSend(req, payload);
      if (authError) return authError;
    }

    if (payload.mailboxId) {
      const mailboxValidation = await validateMailboxSender(req, payload);
      if (mailboxValidation.response) return mailboxValidation.response;
      mailboxSenderContext = mailboxValidation.context;
      if (mailboxSenderContext) {
        payload.fromEmail = mailboxSenderContext.fromEmail;
        payload.fromName = mailboxSenderContext.fromName || payload.fromName;
        payload.emailType = "transactional";
      }
    }

    const toAddresses = parseRecipientList(payload.to);
    const ccAddresses = parseRecipientList(payload.cc);
    const bccAddresses = parseRecipientList(payload.bcc);

    if (toAddresses.length === 0) {
      return new Response("Missing recipient email", { status: 400, headers: corsHeaders });
    }

    if (!isTransactional && toAddresses.length !== 1) {
      return new Response("Marketing sends must target exactly one primary recipient", {
        status: 400,
        headers: corsHeaders,
      });
    }

    if (!isTransactional && (ccAddresses.length > 0 || bccAddresses.length > 0)) {
      return new Response("Marketing sends cannot include CC or BCC recipients", {
        status: 400,
        headers: corsHeaders,
      });
    }

    const { data: billingGate, error: billingGateError } = await supabase.rpc(
      "check_mail_billing_send_allowed",
      {
        p_business_id: payload.businessId,
        p_email_type: payload.emailType || "marketing",
      },
    );

    if (billingGateError) {
      console.error("[mail-send] Billing gate failed:", billingGateError);
      return new Response("Unable to verify mail billing status", {
        status: 500,
        headers: corsHeaders,
      });
    }

    if (billingGate?.allowed === false) {
      return new Response(billingGate?.reason || "Mail billing is not active", {
        status: 402,
        headers: corsHeaders,
      });
    }

    const recipientValidationResults = await Promise.all(
      [...toAddresses, ...ccAddresses, ...bccAddresses].map((email) =>
        validateRecipientAddress(payload, email, isTransactional),
      ),
    );

    const blockedRecipient = recipientValidationResults.find((result) => !result.allowed);
    if (blockedRecipient) {
      await recordCampaignSend(payload, {
        status: blockedRecipient.blockedStatus || "failed",
        error_message: `${blockedRecipient.reason} (${blockedRecipient.email})`,
      });
      await recordSystemEmailLog(payload, {
        status: blockedRecipient.blockedStatus || "failed",
        error_message: `${blockedRecipient.reason} (${blockedRecipient.email})`,
      });

      return new Response(blockedRecipient.reason || "Recipient rejected", {
        status: 409,
        headers: corsHeaders,
      });
    }

    const primaryRecipientValidation = recipientValidationResults[0] || null;
    if (!payload.contactId && primaryRecipientValidation?.contactId) {
      payload.contactId = primaryRecipientValidation.contactId;
    }

    // Waiver OTP (legacy kiosk + app): set From display name and subject from DB so inbox matches
    // PublicWaiverFlow / Welcome (uses businesses.name). Service role bypasses anon REST gaps.
    const isWaiverOtp =
      typeof payload.campaignId === "string" &&
      payload.campaignId.startsWith("waiver-otp-");
    if (isWaiverOtp && payload.businessId) {
      const { data: biz, error: bizErr } = await supabase
        .from("businesses")
        .select("*")
        .eq("id", payload.businessId)
        .maybeSingle();
      if (!bizErr && biz) {
        const row = biz as Record<string, unknown>;
        const n = typeof row.name === "string" ? row.name.trim() : "";
        const bn =
          typeof row.business_name === "string" ? row.business_name.trim() : "";
        const pub = n || bn;
        if (pub) {
          const pubClean = pub
            .replace(/[\x00-\x1f\x7f"]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          // Match WaiverOTPService / legacy kiosk: full From display name ≤ 78 chars
          // (longer suffix than old " - Waivers" requires shorter business slice)
          const otpFromSuffix = " - Waiver Verification";
          const otpFromMax = 78;
          const maxBizForFrom = Math.max(1, otpFromMax - otpFromSuffix.length);
          const safeForSubject = pubClean.slice(0, 70);
          payload.fromName = `${pubClean.slice(0, maxBizForFrom)}${otpFromSuffix}`;
          payload.subject = `Your Waiver OTP Code - ${safeForSubject}`;
        }
      }
    }

    // 2) Format from address with display name if provided
    // AWS SES v2 FromEmailAddress should just be the email address
    // Display name needs to be added to email headers in the HTML
    console.log('[mail-send] Formatting from address:', {
      'payload.fromName exists': !!payload.fromName,
      'payload.fromName value': payload.fromName,
      'payload.fromEmail': payload.fromEmail
    });
    
    // For FromEmailAddress, use just the email (AWS SES v2 requirement)
    const fromEmailAddress = payload.fromEmail;
    
    // Add display name to email headers if provided
    let htmlWithHeaders = payload.html;
    if (payload.fromName) {
      // Add From header to HTML email content
      // Look for existing <head> tag or create one
      if (htmlWithHeaders.includes('<head>')) {
        htmlWithHeaders = htmlWithHeaders.replace(
          '<head>',
          `<head><meta name="From" content="${payload.fromName} <${payload.fromEmail}>">`
        );
      } else if (htmlWithHeaders.includes('<html>')) {
        htmlWithHeaders = htmlWithHeaders.replace(
          '<html>',
          `<html><head><meta name="From" content="${payload.fromName} <${payload.fromEmail}>"></head>`
        );
      } else {
        // No HTML structure, wrap it
        htmlWithHeaders = `<!DOCTYPE html><html><head><meta name="From" content="${payload.fromName} <${payload.fromEmail}>"></head><body>${htmlWithHeaders}</body></html>`;
      }
    }

    const mailSettings = await loadBusinessMailSettings(payload.businessId, payload.fromName);
    const listUnsubscribeHeaders = await buildListUnsubscribeHeaders(
      payload,
      primaryRecipientValidation
        ? {
            email: primaryRecipientValidation.email,
            contactId: primaryRecipientValidation.contactId,
          }
        : null,
    );
    htmlWithHeaders = await applySignedUnsubscribeLinks(
      payload,
      htmlWithHeaders,
      mailSettings,
      primaryRecipientValidation
        ? {
            email: primaryRecipientValidation.email,
            contactId: primaryRecipientValidation.contactId,
          }
        : null,
    );
    htmlWithHeaders = await applyTrackingToHtml(payload, htmlWithHeaders);

    console.log('[mail-send] Formatted email:', {
      fromEmailAddress,
      fromEmail: payload.fromEmail,
      fromName: payload.fromName,
      to: payload.to,
      'will use display name': !!payload.fromName,
      'html includes From header': htmlWithHeaders.includes('name="From"')
    });

    // 3) Use the hasAttachments variable we already checked above
    // The check happens immediately after parsing the payload
    // This ensures we detect attachments before any other processing
    
    // Send via SES v2
    // AWS SES v2 FromEmailAddress supports: "Display Name" <email@domain.com>
    // Try putting display name directly in FromEmailAddress (as per AWS docs)
    const finalFromAddress = payload.fromName
      ? `"${payload.fromName}" <${payload.fromEmail}>`
      : fromEmailAddress;

    if (hasAttachments) {
      console.log('[mail-send] Using Raw email format for attachments:', {
        attachmentCount: payload.attachments.length,
        attachments: payload.attachments.map(a => ({
          filename: a.filename,
          contentType: a.contentType,
          contentLength: a.content?.length || 0
        }))
      });
      
      // Generate boundary for multipart message
      const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      const altBoundary = `----=_Alt_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      
      // Build multipart MIME message
      let rawMessage = `From: ${finalFromAddress}\r\n`;
      rawMessage += `To: ${payload.to}\r\n`;
      for (const header of listUnsubscribeHeaders) {
        rawMessage += `${header.Name}: ${sanitizeRawHeaderValue(header.Value)}\r\n`;
      }
      
      console.log('[mail-send] ========== CC FIELD DEBUG (RAW EMAIL) ==========');
      console.log('[mail-send] Checking CC field:', {
        hasCc: 'cc' in payload,
        ccValue: payload.cc,
        ccType: typeof payload.cc,
        ccLength: payload.cc ? payload.cc.length : 0,
        ccTrimmed: payload.cc ? payload.cc.trim() : null,
        ccIsTruthy: !!payload.cc,
        ccTrimmedIsTruthy: payload.cc ? !!payload.cc.trim() : false
      });
      
      if (payload.cc && payload.cc.trim()) {
        rawMessage += `Cc: ${payload.cc}\r\n`;
        console.log('[mail-send] ✅ CC added to raw message:', payload.cc);
        console.log('[mail-send] ✅ Raw message now contains CC line');
      } else {
        console.log('[mail-send] ❌ CC NOT added to raw message - condition failed');
        console.log('[mail-send] ❌ Condition check:', {
          'payload.cc exists': !!payload.cc,
          'payload.cc.trim() exists': payload.cc ? !!payload.cc.trim() : false,
          'both true': !!(payload.cc && payload.cc.trim())
        });
      }
      rawMessage += `Subject: ${payload.subject}\r\n`;
      if (payload.inReplyTo) {
        rawMessage += `In-Reply-To: ${payload.inReplyTo}\r\n`;
      }
      if (payload.references) {
        rawMessage += `References: ${payload.references}\r\n`;
      }
      rawMessage += `MIME-Version: 1.0\r\n`;
      rawMessage += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n`;
      rawMessage += `\r\n`;
      
      // Add multipart/alternative container so email clients choose one body version
      rawMessage += `--${boundary}\r\n`;
      rawMessage += `Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n`;
      rawMessage += `\r\n`;

      // Add text/plain part
      rawMessage += `--${altBoundary}\r\n`;
      rawMessage += `Content-Type: text/plain; charset=UTF-8\r\n`;
      rawMessage += `Content-Transfer-Encoding: 7bit\r\n`;
      rawMessage += `\r\n`;
      rawMessage += payload.text || payload.html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
      rawMessage += `\r\n\r\n`;
      
      // Add text/html part
      rawMessage += `--${altBoundary}\r\n`;
      rawMessage += `Content-Type: text/html; charset=UTF-8\r\n`;
      rawMessage += `Content-Transfer-Encoding: 7bit\r\n`;
      rawMessage += `\r\n`;
      rawMessage += htmlWithHeaders;
      rawMessage += `\r\n\r\n`;
      rawMessage += `--${altBoundary}--\r\n\r\n`;
      
      // Add attachments
      for (const attachment of payload.attachments) {
        if (!attachment.content || !attachment.filename || !attachment.contentType) {
          console.error('[mail-send] Invalid attachment format:', {
            hasContent: !!attachment.content,
            hasFilename: !!attachment.filename,
            hasContentType: !!attachment.contentType,
            attachment: attachment
          });
          throw new Error(`Invalid attachment format: missing content, filename, or contentType`);
        }
        
        // Validate base64 content
        const base64Content = attachment.content.replace(/\s/g, ''); // Remove whitespace
        const isValidBase64 = /^[A-Za-z0-9+/]*={0,2}$/.test(base64Content);
        
        console.log('[mail-send] Adding attachment:', {
          filename: attachment.filename,
          contentType: attachment.contentType,
          contentLength: attachment.content.length,
          base64Length: base64Content.length,
          isValidBase64: isValidBase64,
          contentPreview: attachment.content.substring(0, 50) + '...',
          base64Preview: base64Content.substring(0, 50) + '...',
          base64End: '...' + base64Content.substring(base64Content.length - 50)
        });
        
        if (!isValidBase64) {
          console.error('[mail-send] WARNING: Base64 content appears invalid!');
        }
        
        rawMessage += `--${boundary}\r\n`;
        rawMessage += `Content-Type: ${attachment.contentType}; name="${attachment.filename}"\r\n`;
        rawMessage += `Content-Disposition: attachment; filename="${attachment.filename}"\r\n`;
        rawMessage += `Content-Transfer-Encoding: base64\r\n`;
        rawMessage += `\r\n`;
        
        // Base64 content must be chunked at 76 characters per line for proper MIME encoding (RFC 2045)
        // CRITICAL: Chunk properly to avoid corrupting base64 content
        // AWS SES can handle base64 content, but proper chunking ensures compatibility
        let chunkedBase64 = '';
        for (let i = 0; i < base64Content.length; i += 76) {
          if (i > 0) chunkedBase64 += '\r\n';
          chunkedBase64 += base64Content.substring(i, Math.min(i + 76, base64Content.length));
        }
        
        console.log('[mail-send] Base64 chunking:', {
          originalLength: base64Content.length,
          chunkedLength: chunkedBase64.length,
          expectedChunks: Math.ceil(base64Content.length / 76),
          first76Chars: base64Content.substring(0, 76),
          last76Chars: base64Content.substring(Math.max(0, base64Content.length - 76)),
          chunkedStartsWith: chunkedBase64.substring(0, 76),
          'base64 starts with PDF magic?': base64Content.startsWith('JVBERi0')
        });
        
        rawMessage += chunkedBase64;
        rawMessage += `\r\n`; // Line break after base64 content (required before next boundary)
      }
      
      // Close boundary
      rawMessage += `--${boundary}--\r\n`;
      
      // Log the raw message size and preview (for debugging)
      const rawMessageBytes = new TextEncoder().encode(rawMessage);
      
      // Find attachment section in raw message for debugging
      const attachmentSectionStart = rawMessage.indexOf('Content-Type: application/pdf');
      let attachmentSection = 'NOT FOUND';
      if (attachmentSectionStart > -1) {
        // Get more of the attachment section to see the full MIME structure
        attachmentSection = rawMessage.substring(attachmentSectionStart, Math.min(attachmentSectionStart + 1000, rawMessage.length));
      }
      
      // Also check if the base64 content is intact in the raw message
      const base64InRawMessage = attachmentSectionStart > -1 
        ? rawMessage.substring(attachmentSectionStart).match(/JVBERi0[^\r\n]*/)?.[0]?.substring(0, 100)
        : null;
      
      // Check if CC is in the raw message
      const hasCcInRawMessage = rawMessage.includes('Cc:');
      const ccLineInRawMessage = rawMessage.match(/Cc:.*\r\n/)?.[0];
      
      console.log('[mail-send] Raw message constructed:', {
        messageLength: rawMessage.length,
        messageBytesLength: rawMessageBytes.length,
        boundary: boundary,
        attachmentCount: payload.attachments.length,
        hasCcInRawMessage: hasCcInRawMessage,
        ccLineInRawMessage: ccLineInRawMessage,
        messagePreview: rawMessage.substring(0, 500) + '...',
        attachmentSectionStart: attachmentSectionStart,
        attachmentSectionPreview: attachmentSection.substring(0, 800) + '...',
        base64InRawMessage: base64InRawMessage,
        messageEnd: '...' + rawMessage.substring(rawMessage.length - 500)
      });
      
      // Send using Raw email (SES v1 client for attachments)
      // CRITICAL: RawMessage.Data must be a Uint8Array or Buffer
      const rawEmailCmd = new SendRawEmailCommand({
        RawMessage: {
          Data: rawMessageBytes
        },
        Destinations: [...toAddresses, ...ccAddresses, ...bccAddresses],
        ...(effectiveConfigurationSet ? { ConfigurationSetName: effectiveConfigurationSet } : {}),
        Tags: buildSesTags(payload)
      });
      
      console.log('[mail-send] Sending Raw email with attachments:', {
        hasRawMessage: !!rawEmailCmd.input.RawMessage,
        hasData: !!rawEmailCmd.input.RawMessage?.Data,
        dataLength: rawEmailCmd.input.RawMessage?.Data?.length || 0
      });
      
      let result;
      try {
        result = await sesV1.send(rawEmailCmd);
      } catch (error) {
        if (!effectiveConfigurationSet || !shouldRetryWithoutConfigurationSet(error)) {
          throw error;
        }

        console.warn("[mail-send] Configuration set missing for raw email. Retrying without configuration set.", {
          configurationSet: effectiveConfigurationSet,
        });

        result = await sesV1.send(new SendRawEmailCommand({
          RawMessage: {
            Data: rawMessageBytes
          },
          Destinations: [...toAddresses, ...ccAddresses, ...bccAddresses],
          Tags: buildSesTags(payload)
        }));
      }
      
      console.log('[mail-send] Raw email sent successfully:', {
        MessageId: (result as any).MessageId,
        attachmentCount: payload.attachments.length,
        attachments: payload.attachments.map(a => a.filename),
        result: result
      });
      
      // Record the send
      await recordCampaignSend(payload, {
        status: "sent",
        message_id: (result as any).MessageId ?? (result as any).$metadata?.requestId ?? null,
      });

      const messageId = (result as any).MessageId || (result as any).$metadata?.requestId || null;
      await recordSystemEmailLog(payload, {
        status: "sent",
        message_id: messageId,
        metadata: { used_raw_format: true },
      });
      if (mailboxSenderContext) {
        await recordMailboxSent(payload, mailboxSenderContext, {
          status: "sent",
          message_id: messageId,
        });
      }
      
      const responseData = {
        ok: true,
        messageId: messageId,
        fromEmail: payload.fromEmail,
        fromName: payload.fromName || null,
        fromAddress: finalFromAddress,
        hasDisplayName: !!payload.fromName,
        hasAttachments: true,
        attachmentCount: payload.attachments.length,
        usedRawFormat: true
      };
      
      console.log('[mail-send] Returning Raw email response:', JSON.stringify(responseData, null, 2));
      console.log('[mail-send] Raw email response data types:', {
        ok: typeof responseData.ok,
        messageId: typeof responseData.messageId,
        fromAddress: typeof responseData.fromAddress,
        fromEmail: typeof responseData.fromEmail,
        fromName: typeof responseData.fromName,
        hasAttachments: typeof responseData.hasAttachments,
        attachmentCount: typeof responseData.attachmentCount,
        usedRawFormat: typeof responseData.usedRawFormat
      });
      
      return new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" }
      });
    }

    // No attachments - use Simple format
    console.log('[mail-send] ========== CC FIELD DEBUG (SIMPLE EMAIL) ==========');
    console.log('[mail-send] Checking CC field for simple email:', {
      hasCc: 'cc' in payload,
      ccValue: payload.cc,
      ccType: typeof payload.cc,
      ccLength: payload.cc ? payload.cc.length : 0,
      ccTrimmed: payload.cc ? payload.cc.trim() : null,
      ccIsTruthy: !!payload.cc
    });

    console.log('[mail-send] Parsed addresses:', {
      toAddresses: toAddresses,
      ccAddresses: ccAddresses,
      ccAddressesCount: ccAddresses.length,
      bccAddresses: bccAddresses,
      bccAddressesCount: bccAddresses.length,
      willAddCcToDestination: ccAddresses.length > 0
    });
    
    const sendCmdInput: any = {
      Destination: { 
        ToAddresses: toAddresses,
        ...(ccAddresses.length > 0 ? { CcAddresses: ccAddresses } : {}),
        ...(bccAddresses.length > 0 ? { BccAddresses: bccAddresses } : {})
      },
      FromEmailAddress: finalFromAddress, // Include display name directly in FromEmailAddress
      Content: {
        Simple: {
          Subject: { Data: payload.subject },
          ...(listUnsubscribeHeaders.length > 0 ? { Headers: listUnsubscribeHeaders } : {}),
          Body: {
            Html: { Data: htmlWithHeaders },
            ...(payload.text ? { Text: { Data: payload.text } } : {})
          }
        }
      }
    };

    // Add configuration set if provided
    if (effectiveConfigurationSet) {
      sendCmdInput.ConfigurationSetName = effectiveConfigurationSet;
    }

    sendCmdInput.EmailTags = buildSesTags(payload);

    const sendCmd = new SendEmailCommand(sendCmdInput);
    
    console.log('[mail-send] SendEmailCommand input:', {
      FromEmailAddress: sendCmd.input.FromEmailAddress,
      'FromEmailAddress format': sendCmd.input.FromEmailAddress,
      'FromEmailAddress length': sendCmd.input.FromEmailAddress?.length,
      Destination: {
        ToAddresses: sendCmd.input.Destination?.ToAddresses,
        CcAddresses: sendCmd.input.Destination?.CcAddresses,
        hasCcAddresses: !!(sendCmd.input.Destination?.CcAddresses),
        ccAddressesCount: sendCmd.input.Destination?.CcAddresses?.length || 0
      }
    });

    let result;
    try {
      result = await ses.send(sendCmd);
    } catch (error) {
      if (!effectiveConfigurationSet || !shouldRetryWithoutConfigurationSet(error)) {
        throw error;
      }

      console.warn("[mail-send] Configuration set missing for simple email. Retrying without configuration set.", {
        configurationSet: effectiveConfigurationSet,
      });

      const retryInput = {
        ...sendCmdInput,
      };
      delete retryInput.ConfigurationSetName;
      result = await ses.send(new SendEmailCommand(retryInput));
    }

    console.log('[mail-send] SES send result:', {
      MessageId: (result as any).MessageId,
      $metadata: (result as any).$metadata,
      'Request sent with FromEmailAddress': sendCmd.input.FromEmailAddress,
      'FromEmailAddress in result': (result as any).FromEmailAddress
    });

    // 4) Record the send
    await recordCampaignSend(payload, {
      status: "sent",
      message_id: (result as any).MessageId ?? (result as any).$metadata?.requestId ?? null,
    });

    // Build response with all debug info
    const messageId = (result as any).MessageId || (result as any).$metadata?.requestId || null;
    await recordSystemEmailLog(payload, {
      status: "sent",
      message_id: messageId,
      metadata: { used_simple_format: true },
    });
    if (mailboxSenderContext) {
      await recordMailboxSent(payload, mailboxSenderContext, {
        status: "sent",
        message_id: messageId,
      });
    }
    
    // WARNING: If we reach here, we used Simple format (no attachments)
    // But check if attachments were actually present - this is a bug if true!
    const hadAttachments = !!(payload.attachments && Array.isArray(payload.attachments) && payload.attachments.length > 0);
    if (hadAttachments) {
      console.error('[mail-send] CRITICAL BUG: Attachments were present but Simple format was used!', {
        attachmentCount: payload.attachments.length,
        attachments: payload.attachments.map(a => a.filename),
        hasAttachmentsCheck: hasAttachments,
        'why did check fail?': {
          'payload.attachments exists': !!payload.attachments,
          'is array': Array.isArray(payload.attachments),
          'length': payload.attachments?.length || 0,
          hasAttachments
        }
      });
    }
    
    const responseData = {
      ok: true,
      messageId: messageId,
      fromEmail: payload.fromEmail,
      fromName: payload.fromName || null,
      fromAddress: finalFromAddress,
      hasDisplayName: !!payload.fromName,
      hasAttachments: false,
      attachmentCount: 0,
      usedSimpleFormat: true,
      hadAttachmentsInPayload: hadAttachments // Debug flag
    };
    
    console.log('[mail-send] Returning response:', JSON.stringify(responseData, null, 2));
    console.log('[mail-send] Response data types:', {
      ok: typeof responseData.ok,
      messageId: typeof responseData.messageId,
      fromAddress: typeof responseData.fromAddress,
      fromEmail: typeof responseData.fromEmail,
      fromName: typeof responseData.fromName,
      hasAttachments: typeof responseData.hasAttachments,
      attachmentCount: typeof responseData.attachmentCount,
      usedSimpleFormat: typeof (responseData as any).usedSimpleFormat,
      hadAttachmentsInPayload: typeof (responseData as any).hadAttachmentsInPayload
    });

    const responseBody = JSON.stringify(responseData);
    console.log('[mail-send] Response body length:', responseBody.length);
    console.log('[mail-send] Response body preview:', responseBody.substring(0, 200));

    return new Response(responseBody, {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" }
    });
  } catch (e) {
    if (payload) {
      await recordSystemEmailLog(payload, {
        status: "failed",
        error_message: String((e as Error)?.message ?? e),
      });
    }

    if (payload && mailboxSenderContext) {
      await recordMailboxSent(payload, mailboxSenderContext, {
        status: "failed",
        error_message: String((e as Error)?.message ?? e),
      });
    }

    // Log error in DB for visibility
    try {
      const body = await req.text().catch(() => "");
      await supabase.from("mail_error_logs").insert({
        business_id: null,
        campaign_id: null,
        contact_id: null,
        contact_email: null,
        error_type: "mail_send_error",
        error_message: String(e?.message ?? e),
        status: "failed",
        severity: "high",
        metadata: { requestBody: body }
      });
    } catch (_ignored) {}
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" }
    });
  }
});