import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  countThrottledCampaignSendsInLocalMinute,
  isHighPriorityQueueItem,
  isThrottledMarketingCampaignItem,
  isWithinSendWindow,
  mergeThrottleConfig,
  resolveThrottleRatePerMinute,
  resolveThrottleTimezone,
} from "../_shared/mailCampaignThrottle.ts";
import { resolveBusinessAddress } from "../_shared/mailBusinessProfile.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const DEFAULT_PUBLIC_SITE_URL = "https://tavarios.ca";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_RETRIES = 3;
const MAX_BATCH_SIZE = 100;
const QUEUE_CANDIDATE_POOL = 500;
const MARKETING_FREQUENCY_CAP_DAYS = 3;
const SIGNED_UNSUBSCRIBE_PLACEHOLDER = "__TAVARI_SIGNED_UNSUBSCRIBE_URL__";

type QueuePayload = {
  businessId?: string;
  batchSize?: number;
};

type QueueStatusSummary = {
  total: number;
  queued: number;
  processing: number;
  sent: number;
  failed: number;
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
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function htmlToText(html: string) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function getQueueContactKey(queueItem: Record<string, unknown>) {
  const contactId = String(queueItem.contact_id || "").trim();
  if (contactId) return `contact:${contactId}`;

  const email = String(queueItem.email_address || queueItem.contact?.email || "")
    .trim()
    .toLowerCase();
  return email ? `email:${email}` : "";
}

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

function escapeTokenForRegex(token: string) {
  return String(token || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceMergeTokens(content: string, tokens: string[], value: unknown) {
  return tokens.reduce(
    (output, token) =>
      output.replace(new RegExp(escapeTokenForRegex(token), "g"), String(value ?? "")),
    String(content || ""),
  );
}

function personalizeEmailContent(
  htmlContent: string,
  contact: Record<string, unknown>,
  extras: Record<string, unknown> = {},
) {
  const firstName = String(contact?.first_name || contact?.firstName || "");
  const lastName = String(contact?.last_name || contact?.lastName || "");
  const email = String(contact?.email || "");
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const loyaltyPoints =
    extras.loyalty_points ??
    extras.loyaltyPoints ??
    contact?.loyalty_points ??
    contact?.loyaltyPoints ??
    contact?.points_balance ??
    contact?.pointsBalance ??
    "";
  const minorFirstName = extras.minor_first_name ?? extras.minorFirstName ?? "";
  const minorLastName = extras.minor_last_name ?? extras.minorLastName ?? "";
  const eventDate = extras.event_date ?? extras.eventDate ?? "";
  const girlNameOfDay =
    extras.girl_display_name ?? extras.girl_name_of_day ?? extras.GirlNameOfDay ?? "";
  const boyNameOfDay =
    extras.boy_display_name ?? extras.boy_name_of_day ?? extras.BoyNameOfDay ?? "";
  const nameOfDayLocalDate = extras.local_date ?? extras.NameOfDayDate ?? "";

  let output = String(htmlContent || "");
  output = replaceMergeTokens(output, ["{{First Name}}", "{{FirstName}}", "{FirstName}"], firstName);
  output = replaceMergeTokens(output, ["{{Last Name}}", "{{LastName}}", "{LastName}"], lastName);
  output = replaceMergeTokens(output, ["{{Full Name}}", "{{FullName}}", "{FullName}"], fullName);
  output = replaceMergeTokens(output, ["{{Email Address}}", "{{Email}}", "{Email}"], email);
  output = replaceMergeTokens(output, ["{{LoyaltyPoints}}", "{{Loyalty Points}}"], loyaltyPoints);
  output = replaceMergeTokens(
    output,
    ["{{MinorFirstName}}", "{{Minor First Name}}"],
    minorFirstName,
  );
  output = replaceMergeTokens(
    output,
    ["{{MinorLastName}}", "{{Minor Last Name}}"],
    minorLastName,
  );
  output = replaceMergeTokens(output, ["{{EventDate}}", "{{Event Date}}"], eventDate);
  output = replaceMergeTokens(output, ["{{GirlNameOfDay}}", "{{Girl Name Of Day}}"], girlNameOfDay);
  output = replaceMergeTokens(output, ["{{BoyNameOfDay}}", "{{Boy Name Of Day}}"], boyNameOfDay);
  output = replaceMergeTokens(output, ["{{NameOfDayDate}}", "{{Local Date}}"], nameOfDayLocalDate);
  output = replaceMergeTokens(
    output,
    ["{{WinnerMinorFirstName}}", "{{Winner Minor First Name}}"],
    minorFirstName,
  );

  const explicitReview = String(extras.review_link ?? extras.reviewLink ?? "").trim();
  const bid = String(extras.business_id ?? extras.businessId ?? "").trim();
  const reviewLink =
    explicitReview ||
    (bid ? `${resolvePublicSiteUrl()}/reputation/review/${bid}` : "");
  const checkedInName = String(extras.checked_in_name ?? extras.checkedInName ?? "").trim();
  output = replaceMergeTokens(output, ["{{{ReviewLink}}}", "{{{Review Link}}}"], reviewLink);
  output = replaceMergeTokens(output, ["{{ReviewLink}}", "{{Review Link}}"], reviewLink);
  output = replaceMergeTokens(
    output,
    ["{{CheckedInName}}", "{{Checked-In Name}}", "{{Checked In Name}}"],
    checkedInName,
  );

  const toddlerCount = extras.toddler_count ?? extras.toddlerCount ?? "";
  const toddlerNames = extras.toddler_names ?? extras.toddlerNames ?? "";
  const promoThursdayDate = extras.promo_thursday_date ?? extras.promoThursdayDate ?? "";
  const offerPrice = extras.offer_price ?? extras.offerPrice ?? "$7";
  const promoCode = extras.promo_code ?? extras.promoCode ?? "DCT2026";
  const bookingWindow = extras.booking_window ?? extras.bookingWindow ?? "10:00 AM – 1:00 PM";
  const minToddlersForOffer = extras.min_toddler_count_for_offer ?? extras.minToddlersForOffer ?? "2";
  const offerDetails = extras.offer_details ?? extras.offerDetails ??
    extras.friends_welcome ?? extras.friendsWelcome ?? "";

  output = replaceMergeTokens(output, ["{{ToddlerCount}}", "{{Toddler Count}}"], toddlerCount);
  output = replaceMergeTokens(output, ["{{ToddlerNames}}", "{{Toddler Names}}"], toddlerNames);
  output = replaceMergeTokens(
    output,
    ["{{PromoThursdayDate}}", "{{Promo Thursday Date}}", "{{TomorrowDate}}"],
    promoThursdayDate,
  );
  output = replaceMergeTokens(output, ["{{OfferPrice}}", "{{Offer Price}}"], offerPrice);
  output = replaceMergeTokens(output, ["{{PromoCode}}", "{{Promo Code}}"], promoCode);
  output = replaceMergeTokens(output, ["{{BookingWindow}}", "{{Booking Window}}"], bookingWindow);
  output = replaceMergeTokens(
    output,
    ["{{MinToddlersForOffer}}", "{{Min Toddlers For Offer}}"],
    minToddlersForOffer,
  );
  output = replaceMergeTokens(output, ["{{OfferDetails}}", "{{Offer Details}}"], offerDetails);
  output = replaceMergeTokens(output, ["{{FriendsWelcome}}", "{{Friends Welcome}}"], offerDetails);

  return output;
}

function ensureComplianceTokens(
  htmlContent: string,
  settings: Record<string, unknown>,
  contact: Record<string, unknown>,
  businessId: string,
) {
  const unsubscribeUrl = SIGNED_UNSUBSCRIBE_PLACEHOLDER;
  const businessName = String(settings?.business_name || settings?.from_name || "Tavari");
  const businessAddress = String(settings?.business_address || "Business address required");

  let processedContent = String(htmlContent || "")
    .replace(/\{UnsubscribeLink\}/g, unsubscribeUrl)
    .replace(/\{UpdatePreferencesLink\}/g, unsubscribeUrl)
    .replace(/\{FromName\}/g, businessName)
    .replace(/\{BusinessName\}/g, businessName)
    .replace(/\{BusinessAddress\}/g, businessAddress)
    .replace(/Your Business Name/g, businessName)
    .replace(/Your Business Address - Required for CASL Compliance/g, businessAddress);

  if (!processedContent.toLowerCase().includes("unsubscribe")) {
    const complianceFooter = `
      <div style="margin-top: 40px; padding: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #666; text-align: center;">
        <p style="margin: 0 0 10px 0;">
          You are receiving this email because you subscribed to ${businessName} communications.
        </p>
        <p style="margin: 0 0 10px 0;">
          <a href="${unsubscribeUrl}" style="color: #0066cc; text-decoration: underline;">Unsubscribe</a>
          |
          <a href="${unsubscribeUrl}" style="color: #0066cc; text-decoration: underline;">Update Preferences</a>
        </p>
        <p style="margin: 0; font-size: 11px;">
          ${businessAddress}
        </p>
      </div>
    `;

    processedContent = processedContent.includes("</body>")
      ? processedContent.replace("</body>", `${complianceFooter}</body>`)
      : `${processedContent}${complianceFooter}`;
  }

  return processedContent;
}

function injectPreviewText(htmlContent: string, previewText: string) {
  const trimmedPreview = String(previewText || "").trim();
  if (!htmlContent || !trimmedPreview) return htmlContent;
  if (htmlContent.includes('data-tavari-preheader="true"')) return htmlContent;

  const preheaderHtml = `<div data-tavari-preheader="true" style="display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; max-height:0; max-width:0;">${trimmedPreview}</div>`;

  if (htmlContent.includes("<body")) {
    return htmlContent.replace(/<body([^>]*)>/i, `<body$1>${preheaderHtml}`);
  }

  return `${preheaderHtml}${htmlContent}`;
}

async function authorizeQueueProcessing(req: Request, businessId: string) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return null;
  }

  if (!businessId) {
    return jsonResponse({ error: "businessId is required" }, 400);
  }

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
  } = await supabaseUser.auth.getUser();

  if (!user?.id) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const [{ data: businessMembership }, { data: roleMembership }] = await Promise.all([
    supabaseUser
      .from("business_users")
      .select("business_id")
      .eq("business_id", businessId)
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle(),
    supabaseUser
      .from("user_roles")
      .select("business_id")
      .eq("business_id", businessId)
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle(),
  ]);

  if (!businessMembership && !roleMembership) {
    return jsonResponse({ error: "Access denied to this business" }, 403);
  }

  return null;
}

async function markQueueFailure(
  supabase: ReturnType<typeof createClient>,
  queueItem: Record<string, unknown>,
  errorMessage: string,
) {
  const retryCount = Number(queueItem.retry_count || 0) + 1;
  const isPermanentFailure = /unsubscribed|suppressed|marketing consent|automation disabled/i.test(errorMessage);

  if (!isPermanentFailure && retryCount <= MAX_RETRIES) {
    const delayMs = Math.min(1000 * 2 ** (retryCount - 1), 30000);
    const retryAt = new Date(Date.now() + delayMs).toISOString();

    await supabase
      .from("mail_sending_queue")
      .update({
        status: "queued",
        retry_count: retryCount,
        error_message: errorMessage,
        scheduled_for: retryAt,
      })
      .eq("id", String(queueItem.id));

    if (queueItem.automation_run_id) {
      await supabase
        .from("mail_automation_runs")
        .update({
          status: "retrying",
          last_error: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", String(queueItem.automation_run_id));
    }

    return;
  }

  await supabase
    .from("mail_sending_queue")
    .update({
      status: "failed",
      retry_count: retryCount,
      error_message: errorMessage,
      processed_at: new Date().toISOString(),
    })
    .eq("id", String(queueItem.id));

  if (queueItem.automation_run_id) {
    await supabase
      .from("mail_automation_runs")
      .update({
        status: "failed",
        last_error: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", String(queueItem.automation_run_id));
  }

  await supabase.from("mail_campaign_sends").insert({
    campaign_id: queueItem.campaign_id,
    contact_id: queueItem.contact_id,
    rollout_id: queueItem.rollout_id || null,
    rollout_batch_id: queueItem.rollout_batch_id || null,
    email_address: queueItem.email_address,
    status: "failed",
    error_message: errorMessage,
    retry_count: retryCount,
  });
}

async function updateAutomationRunStatus(
  supabase: ReturnType<typeof createClient>,
  queueItem: Record<string, unknown>,
  status: "sent" | "cancelled",
  lastError: string | null = null,
) {
  if (!queueItem.automation_run_id) {
    return;
  }

  const payload: Record<string, unknown> = {
    status,
    last_error: lastError,
    updated_at: new Date().toISOString(),
  };

  if (status === "sent") {
    payload.sent_at = new Date().toISOString();
  }

  await supabase
    .from("mail_automation_runs")
    .update(payload)
    .eq("id", String(queueItem.automation_run_id));
}

async function updateAutomationRunQueued(
  supabase: ReturnType<typeof createClient>,
  queueItem: Record<string, unknown>,
) {
  if (!queueItem.automation_run_id) {
    return;
  }

  await supabase
    .from("mail_automation_runs")
    .update({
      status: "queued",
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", String(queueItem.automation_run_id));
}

async function findLastMarketingSentAt(
  supabase: ReturnType<typeof createClient>,
  queueItem: Record<string, unknown>,
) {
  const contactId = String(queueItem.contact_id || "").trim();
  if (contactId) {
    const { data, error } = await supabase
      .from("mail_campaign_sends")
      .select("sent_at")
      .eq("contact_id", contactId)
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data?.sent_at ? String(data.sent_at) : null;
  }

  const email = String(queueItem.email_address || queueItem.contact?.email || "")
    .trim()
    .toLowerCase();
  if (!email) return null;

  const { data, error } = await supabase
    .from("mail_campaign_sends")
    .select("sent_at")
    .ilike("email_address", email)
    .eq("status", "sent")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.sent_at ? String(data.sent_at) : null;
}

async function delayQueueItemForMarketingFrequency(
  supabase: ReturnType<typeof createClient>,
  queueItem: Record<string, unknown>,
  nextAllowedAt: Date,
) {
  const nextAllowedIso = nextAllowedAt.toISOString();
  const message = `Delayed by marketing frequency cap until ${nextAllowedIso}`;

  await supabase
    .from("mail_sending_queue")
    .update({
      status: "queued",
      scheduled_for: nextAllowedIso,
      error_message: message,
      processed_at: null,
    })
    .eq("id", String(queueItem.id));

  await updateAutomationRunQueued(supabase, queueItem);
}

async function getQueueStatusSummary(
  supabase: ReturnType<typeof createClient>,
  campaignId: string,
): Promise<QueueStatusSummary> {
  const { data, error } = await supabase
    .from("mail_sending_queue")
    .select("status")
    .eq("campaign_id", campaignId);

  if (error) throw error;

  return (data || []).reduce<QueueStatusSummary>((summary, row) => {
    const status = String(row.status || "");
    summary.total += 1;
    if (status === "queued") summary.queued += 1;
    if (status === "processing") summary.processing += 1;
    if (status === "sent") summary.sent += 1;
    if (status === "failed") summary.failed += 1;
    return summary;
  }, {
    total: 0,
    queued: 0,
    processing: 0,
    sent: 0,
    failed: 0,
  });
}

async function selectQueueItemsForProcessing(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  batchSize: number,
  now: Date,
) {
  let query = supabase
    .from("mail_sending_queue")
    .select(`
        *,
        campaign:mail_campaigns!inner(
          id,
          name,
          subject_line,
          preheader_text,
          business_id,
          content_html,
          send_throttle_enabled,
          send_throttle_started_on,
          send_throttle_timezone,
          send_throttle_window_start_hour,
          send_throttle_window_end_hour,
          send_throttle_initial_rate_per_minute,
          send_throttle_daily_increment,
          send_throttle_max_rate_per_minute
        ),
        contact:mail_contacts(id, first_name, last_name, email),
        automation:mail_automations(id, is_enabled, status, automation_type),
        automation_run:mail_automation_runs(id, status, context)
      `)
    .eq("status", "queued")
    .lte("scheduled_for", now.toISOString())
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(QUEUE_CANDIDATE_POOL);

  if (businessId) {
    query = query.eq("business_id", businessId);
  }

  const { data: candidates, error } = await query;
  if (error) throw error;

  const businessIdsForThrottle = [
    ...new Set(
      (candidates || [])
        .map((row) => String(row.business_id || (row.campaign as Record<string, unknown>)?.business_id || ""))
        .filter(Boolean),
    ),
  ];
  const mailSettingsMap = new Map<string, Record<string, unknown>>();
  if (businessIdsForThrottle.length > 0) {
    const { data: settingsRows, error: settingsError } = await supabase
      .from("mail_settings")
      .select(
        "business_id, daily_digest_timezone, campaign_throttle_window_start_hour, campaign_throttle_window_end_hour, campaign_throttle_initial_rate_per_minute, campaign_throttle_daily_increment, campaign_throttle_max_rate_per_minute",
      )
      .in("business_id", businessIdsForThrottle);
    if (settingsError) throw settingsError;
    for (const row of settingsRows || []) {
      mailSettingsMap.set(String(row.business_id), row);
    }
  }

  const selected: Array<Record<string, unknown>> = [];
  const throttleMinuteCounts = new Map<string, number>();
  const throttleReservedThisRun = new Map<string, number>();

  for (const item of candidates || []) {
    if (selected.length >= batchSize) break;

    const automationContext =
      item.automation_run?.context && typeof item.automation_run.context === "object"
        ? (item.automation_run.context as Record<string, unknown>)
        : {};
    const campaign = (item.campaign || {}) as Record<string, unknown>;
    const itemBusinessId = String(item.business_id || campaign.business_id || "");
    const throttleConfig = mergeThrottleConfig(
      campaign,
      mailSettingsMap.get(itemBusinessId) || null,
    );

    if (isHighPriorityQueueItem(item, automationContext)) {
      selected.push(item);
      continue;
    }

    if (isThrottledMarketingCampaignItem(item, throttleConfig)) {
      const tz = resolveThrottleTimezone(throttleConfig);
      const startHour = Number(throttleConfig.send_throttle_window_start_hour ?? 7);
      const endHour = Number(throttleConfig.send_throttle_window_end_hour ?? 19);

      if (!isWithinSendWindow(now, tz, startHour, endHour)) {
        continue;
      }

      const campaignId = String(item.campaign_id || campaign.id || "");
      const rate = resolveThrottleRatePerMinute(throttleConfig, now);

      let sentThisMinute = throttleMinuteCounts.get(campaignId);
      if (sentThisMinute === undefined) {
        sentThisMinute = await countThrottledCampaignSendsInLocalMinute(
          supabase,
          campaignId,
          now,
          tz,
        );
        throttleMinuteCounts.set(campaignId, sentThisMinute);
      }

      const reserved = throttleReservedThisRun.get(campaignId) || 0;
      if (sentThisMinute + reserved >= rate) {
        continue;
      }

      selected.push(item);
      throttleReservedThisRun.set(campaignId, reserved + 1);
      continue;
    }

    // Mass campaigns with gradual throttle must never bypass the window check above.
    if (
      !item.automation_id &&
      !item.rollout_id &&
      throttleConfig?.send_throttle_enabled === true
    ) {
      continue;
    }

    selected.push(item);
  }

  return selected;
}

async function finalizeCampaignStatus(
  supabase: ReturnType<typeof createClient>,
  campaignId: string,
) {
  const summary = await getQueueStatusSummary(supabase, campaignId);
  const stillRunning = summary.queued > 0 || summary.processing > 0;

  if (stillRunning || summary.total === 0) {
    return {
      campaignId,
      status: "sending",
      summary,
    };
  }

  const finalStatus =
    summary.sent > 0 && summary.failed > 0
      ? "partial_failure"
      : summary.sent > 0
        ? "sent"
        : "failed";

  await supabase
    .from("mail_campaigns")
    .update({
      status: finalStatus,
      emails_sent: summary.sent,
      sent_at: finalStatus === "sent" || finalStatus === "partial_failure"
        ? new Date().toISOString()
        : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);

  return {
    campaignId,
    status: finalStatus,
    summary,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as QueuePayload;
    const businessId = String(body.businessId || "").trim();
    const batchSize = Math.min(Math.max(Number(body.batchSize) || 25, 1), MAX_BATCH_SIZE);

    const authError = await authorizeQueueProcessing(req, businessId);
    if (authError) {
      return authError;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const now = new Date();

    const queueItems = await selectQueueItemsForProcessing(
      supabase,
      businessId,
      batchSize,
      now,
    );

    if (!queueItems || queueItems.length === 0) {
      return jsonResponse({
        processed: 0,
        sent: 0,
        failed: 0,
        campaigns_affected: [],
        errors: [],
      });
    }

    const businessIds = [...new Set(queueItems.map((item) => String(item.business_id || item.campaign?.business_id || "")).filter(Boolean))];
    const settingsMap = new Map<string, Record<string, unknown>>();
    const businessNameMap = new Map<string, string>();
    const businessAddressMap = new Map<string, string>();

    if (businessIds.length > 0) {
      const [{ data: settingsRows }, { data: businessRows }] = await Promise.all([
        supabase
          .from("mail_settings")
          .select("business_id, from_name, from_email, business_address")
          .in("business_id", businessIds),
        supabase
          .from("businesses")
          .select("id, name, business_address")
          .in("id", businessIds),
      ]);

      for (const row of settingsRows || []) {
        settingsMap.set(String(row.business_id), row);
      }

      for (const row of businessRows || []) {
        businessNameMap.set(String(row.id), String(row.name || "").trim());
        businessAddressMap.set(String(row.id), String(row.business_address || "").trim());
      }
    }

    let sent = 0;
    let failed = 0;
    let delayed = 0;
    const errors: Array<Record<string, unknown>> = [];
    const campaignsAffected = new Set<string>();
    const frequencyCursorByContact = new Map<string, Date>();

    for (const item of queueItems) {
      const locked = await supabase
        .from("mail_sending_queue")
        .update({
          status: "processing",
          processed_at: new Date().toISOString(),
        })
        .eq("id", item.id)
        .eq("status", "queued")
        .select("id")
        .maybeSingle();

      if (!locked.data?.id) {
        continue;
      }

      try {
        const campaign = item.campaign || {};
        const rawContact = item.contact;
        const contact = (Array.isArray(rawContact) ? rawContact[0] : rawContact) || {};
        if (!contact.id) {
          await markQueueFailure(
            supabase,
            item,
            "Queued email failed: no mail_contacts row for contact_id (contact deleted, bad FK, or join mismatch). Sender no longer uses INNER JOIN so this surfaces as an error instead of being silently skipped.",
          );
          failed += 1;
          campaignsAffected.add(String(item.campaign_id));
          errors.push({
            queue_id: item.id,
            campaign_id: item.campaign_id,
            contact_email: item.email_address,
            error: "mail_contacts row missing for contact_id",
          });
          continue;
        }
        const automation = item.automation || null;
        const automationContext =
          item.automation_run?.context && typeof item.automation_run.context === "object"
            ? item.automation_run.context
            : {};
        const itemBusinessId = String(item.business_id || campaign.business_id || "");
        const rawSettings = settingsMap.get(itemBusinessId);
        const businessName = businessNameMap.get(itemBusinessId) || String(rawSettings?.from_name || "Tavari");
        const settings = rawSettings
          ? {
            ...rawSettings,
            business_name: businessName,
            business_address: resolveBusinessAddress(
              rawSettings,
              { business_address: businessAddressMap.get(itemBusinessId) },
            ),
          }
          : null;
        const isTransactionalQueueItem =
          String(automationContext.email_type || item.email_type || "").toLowerCase() === "transactional";
        const bypassMarketingFrequencyCap =
          isTransactionalQueueItem ||
          String(automationContext.source || "").trim() === "name_of_day" ||
          automationContext.bypass_marketing_frequency_cap === true ||
          String(automation?.automation_type || "").toLowerCase() === "birthday";

        if (!settings?.from_email) {
          throw new Error("Missing mail settings for queued campaign");
        }

        if (item.automation_id && automation && automation.is_enabled !== true) {
          await supabase
            .from("mail_sending_queue")
            .update({
              status: "failed",
              error_message: "Automation disabled before send",
              processed_at: new Date().toISOString(),
            })
            .eq("id", item.id);
          await updateAutomationRunStatus(supabase, item, "cancelled", "Automation disabled before send");
          failed += 1;
          campaignsAffected.add(String(item.campaign_id));
          errors.push({
            campaign_id: item.campaign_id,
            contact_email: item.email_address || item.contact?.email || null,
            error: "Automation disabled before send",
          });
          continue;
        }

        if (!bypassMarketingFrequencyCap) {
          const contactKey = getQueueContactKey(item);
          if (contactKey) {
            let nextAllowedAt = frequencyCursorByContact.get(contactKey) || null;

            if (!nextAllowedAt) {
              const lastSentAt = await findLastMarketingSentAt(supabase, item);
              if (lastSentAt) {
                const lastSentDate = new Date(lastSentAt);
                if (!Number.isNaN(lastSentDate.getTime())) {
                  nextAllowedAt = addDays(lastSentDate, MARKETING_FREQUENCY_CAP_DAYS);
                }
              }
            }

            if (nextAllowedAt && nextAllowedAt.getTime() > Date.now()) {
              await delayQueueItemForMarketingFrequency(supabase, item, nextAllowedAt);
              frequencyCursorByContact.set(
                contactKey,
                addDays(nextAllowedAt, MARKETING_FREQUENCY_CAP_DAYS),
              );
              delayed += 1;
              campaignsAffected.add(String(item.campaign_id));
              continue;
            }
          }
        }

        const baseHtml = String(item.personalized_content || campaign.content_html || "");
        const personalizationContext = {
          ...(automationContext && typeof automationContext === "object"
            ? automationContext
            : {}),
          business_id: String(
            (automationContext as Record<string, unknown>)?.business_id || itemBusinessId || "",
          ),
        };
        const personalizedHtml = personalizeEmailContent(baseHtml, contact, personalizationContext);
        const personalizedSubject = personalizeEmailContent(
          String(campaign.subject_line || ""),
          contact,
          personalizationContext,
        );
        const personalizedPreheader = personalizeEmailContent(
          String(campaign.preheader_text || ""),
          contact,
          personalizationContext,
        );
        const htmlWithPreview = injectPreviewText(personalizedHtml, personalizedPreheader);
        const compliantHtml = ensureComplianceTokens(htmlWithPreview, settings, contact, itemBusinessId);

        const mailRes = await fetch(`${SUPABASE_URL}/functions/v1/mail-send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            businessId: itemBusinessId,
            campaignId: item.campaign_id,
            contactId: item.contact_id,
            rolloutId: item.rollout_id || null,
            rolloutBatchId: item.rollout_batch_id || null,
            to: contact.email || item.email_address,
            fromEmail: settings.from_email,
            fromName: businessName || null,
            subject: personalizedSubject,
            html: compliantHtml,
            text: htmlToText(compliantHtml),
            configurationSet: item.configuration_set || campaign.configuration_set || undefined,
          }),
        });

        const mailJson = await mailRes.json().catch(() => null);

        if (!mailRes.ok || !mailJson?.ok) {
          throw new Error(mailJson?.error || `mail-send failed with status ${mailRes.status}`);
        }

        await supabase
          .from("mail_sending_queue")
          .update({
            status: "sent",
            processed_at: new Date().toISOString(),
            ses_message_id: mailJson.messageId || null,
            error_message: null,
          })
          .eq("id", item.id);

        await updateAutomationRunStatus(supabase, item, "sent");

        if (!bypassMarketingFrequencyCap) {
          const contactKey = getQueueContactKey(item);
          if (contactKey) {
            frequencyCursorByContact.set(
              contactKey,
              addDays(new Date(), MARKETING_FREQUENCY_CAP_DAYS),
            );
          }
        }

        sent += 1;
        campaignsAffected.add(String(item.campaign_id));
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        await markQueueFailure(supabase, item, errorMessage);
        failed += 1;
        campaignsAffected.add(String(item.campaign_id));
        errors.push({
          campaign_id: item.campaign_id,
          contact_email: item.email_address || item.contact?.email || null,
          error: errorMessage,
        });
      }
    }

    const campaignFinalization = [];
    for (const affectedCampaignId of campaignsAffected) {
      campaignFinalization.push(await finalizeCampaignStatus(supabase, affectedCampaignId));
    }

    return jsonResponse({
      processed: sent + failed + delayed,
      sent,
      failed,
      delayed,
      frequency_cap_days: MARKETING_FREQUENCY_CAP_DAYS,
      campaigns_affected: [...campaignsAffected],
      campaign_finalization: campaignFinalization,
      errors,
    });
  } catch (error) {
    return jsonResponse(
      { error: getErrorMessage(error) },
      500,
    );
  }
});
