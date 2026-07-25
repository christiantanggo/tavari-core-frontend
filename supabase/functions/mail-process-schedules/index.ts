import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  BIRTHDAY_AUTOMATION_SUPPRESSION_WEEKS,
  buildBirthdayDeliveryKey,
  filterBirthdayCandidatesForPriorSendSuppression,
  normalizeNamePart,
} from "../_shared/birthdayAutomationSuppression.ts";
import { buildStaggeredSendSlots as buildAutomationSendSlots, localWallDateTimeToUtcIso } from "../_shared/localSendTime.ts";
import {
  buildToddlerThursdayDeliveryKey,
  buildToddlerThursdayOfferDetails,
  formatPromoThursdayDisplay,
  formatToddlerNamesList,
  getContactCohort,
  resolveToddlerThursdaySchedule,
  type ToddlerThursdayCriteria,
} from "../_shared/toddlerThursday.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_PUBLIC_SITE_URL = "https://tavarios.ca";
const AUTOMATION_SEND_START_HOUR = 7;
const AUTOMATION_SEND_END_HOUR = 19;
const SUPABASE_PAGE_SIZE = 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-mail-schedule-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function getDatePartsInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: String(values.year || ""),
    month: String(values.month || "").padStart(2, "0"),
    day: String(values.day || "").padStart(2, "0"),
  };
}

function getDateStringInTimeZone(date: Date, timeZone: string) {
  const parts = getDatePartsInTimeZone(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getAutomationSendWindow(criteria: Record<string, unknown>) {
  const rawWindow = criteria.send_window && typeof criteria.send_window === "object"
    ? criteria.send_window as Record<string, unknown>
    : {};
  const rawStartHour = Number(rawWindow.start_hour);
  const rawEndHour = Number(rawWindow.end_hour);
  const rawMinuteOffset = Number(rawWindow.minute_offset);
  const startHour = Math.min(23, Math.max(0, Number.isFinite(rawStartHour) ? rawStartHour : AUTOMATION_SEND_START_HOUR));
  const endHour = Math.min(23, Math.max(startHour, Number.isFinite(rawEndHour) ? rawEndHour : AUTOMATION_SEND_END_HOUR));
  const minuteOffset = Math.min(59, Math.max(0, Number.isFinite(rawMinuteOffset) ? rawMinuteOffset : 0));

  return {
    start_hour: startHour,
    end_hour: endHour,
    minute_offset: minuteOffset,
  };
}

function shiftDateString(dateString: string, dayDelta: number) {
  const [year, month, day] = String(dateString || "1970-01-01")
    .split("-")
    .map((value) => Number(value) || 0);
  const date = new Date(Date.UTC(year, Math.max(month - 1, 0), day || 1));
  date.setUTCDate(date.getUTCDate() + dayDelta);
  return date.toISOString().slice(0, 10);
}

function monthDayKey(dateString: string) {
  return String(dateString || "").slice(5, 10);
}

function calculateAgeOnDate(dateOfBirth: string, onDate: string) {
  const dob = new Date(`${String(dateOfBirth || "").slice(0, 10)}T00:00:00Z`);
  const target = new Date(`${String(onDate || "").slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(dob.getTime()) || Number.isNaN(target.getTime())) return null;

  let age = target.getUTCFullYear() - dob.getUTCFullYear();
  const monthDelta = target.getUTCMonth() - dob.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && target.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
}

function isTriggeringMinorEligibleByMaxChildAge(
  minorDateOfBirth: string,
  eventDate: string,
  maxChildAge: number | null,
) {
  if (maxChildAge == null || !Number.isFinite(maxChildAge)) return true;
  const age = calculateAgeOnDate(minorDateOfBirth, eventDate);
  return age != null && age <= maxChildAge;
}

function getLegacyMinorDateOfBirth(minor: Record<string, unknown>) {
  return String(
    minor.date_of_birth ||
      minor.dateOfBirth ||
      minor.dob ||
      minor.birthdate ||
      "",
  ).trim();
}

function getLegacyMinorFirstName(minor: Record<string, unknown>) {
  return String(minor.first_name || minor.firstName || minor.first || "").trim();
}

function getLegacyMinorLastName(minor: Record<string, unknown>) {
  return String(minor.last_name || minor.lastName || minor.last || "").trim();
}

function uniqueKey(row: { contact_id?: string | null; email_address?: string | null }) {
  return String(row.contact_id || row.email_address || "");
}

function countUnique(
  rows: Array<Record<string, unknown>>,
  predicate?: (row: Record<string, unknown>) => boolean,
) {
  const keys = new Set<string>();
  for (const row of rows) {
    if (predicate && !predicate(row)) continue;
    const key = uniqueKey({
      contact_id: row.contact_id ? String(row.contact_id) : null,
      email_address: row.email_address ? String(row.email_address) : null,
    });
    if (key) keys.add(key);
  }
  return keys.size;
}

function buildRolloutReportHtml(input: {
  campaignName: string;
  batchNumber: number;
  actualSize: number;
  deliverySuccessCount: number;
  bouncedCount: number;
  complaintCount: number;
  unsubscribeCount: number;
  openedCount: number;
  clickedCount: number;
  approvalUrl: string | null;
  nextBatchSize: number | null;
  rolloutCompleted: boolean;
}) {
  const {
    campaignName,
    batchNumber,
    actualSize,
    deliverySuccessCount,
    bouncedCount,
    complaintCount,
    unsubscribeCount,
    openedCount,
    clickedCount,
    approvalUrl,
    nextBatchSize,
    rolloutCompleted,
  } = input;

  const actionBlock = rolloutCompleted
    ? `
      <p style="margin: 20px 0 0;">All eligible recipients in this rollout have now been processed.</p>
    `
    : `
      <p style="margin: 24px 0 12px;">Approve the next batch when you are ready.</p>
      <p style="margin: 0 0 24px;">
        <a href="${approvalUrl}" style="display:inline-block;padding:12px 20px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">
          Review / Approve Next Batch${nextBatchSize ? ` (${nextBatchSize})` : ""}
        </a>
      </p>
      <p style="margin: 0;color:#6b7280;font-size:12px;">
        For safety, this link opens the dashboard and still requires an explicit in-app approval click.
      </p>
    `;

  return `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:24px;color:#111827;">
      <h1 style="margin:0 0 16px;font-size:24px;">Campaign rollout checkpoint</h1>
      <p style="margin:0 0 24px;">
        <strong>${campaignName}</strong><br />
        Batch ${batchNumber} of ${actualSize} recipients has finished its 60 minute review window.
      </p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tbody>
          <tr><td style="padding:10px;border:1px solid #e5e7eb;"><strong>Delivery success</strong></td><td style="padding:10px;border:1px solid #e5e7eb;">${deliverySuccessCount}</td></tr>
          <tr><td style="padding:10px;border:1px solid #e5e7eb;"><strong>Bounces</strong></td><td style="padding:10px;border:1px solid #e5e7eb;">${bouncedCount}</td></tr>
          <tr><td style="padding:10px;border:1px solid #e5e7eb;"><strong>Spam complaints</strong></td><td style="padding:10px;border:1px solid #e5e7eb;">${complaintCount}</td></tr>
          <tr><td style="padding:10px;border:1px solid #e5e7eb;"><strong>Unsubscribes</strong></td><td style="padding:10px;border:1px solid #e5e7eb;">${unsubscribeCount}</td></tr>
          <tr><td style="padding:10px;border:1px solid #e5e7eb;"><strong>Open tracking</strong></td><td style="padding:10px;border:1px solid #e5e7eb;">${openedCount}</td></tr>
          <tr><td style="padding:10px;border:1px solid #e5e7eb;"><strong>Click tracking</strong></td><td style="padding:10px;border:1px solid #e5e7eb;">${clickedCount}</td></tr>
        </tbody>
      </table>

      ${actionBlock}
    </div>
  `;
}

async function sendRolloutReportEmail(
  supabase: ReturnType<typeof createClient>,
  payload: {
    businessId: string;
    reportEmail: string;
    campaignName: string;
    batchNumber: number;
    html: string;
  },
) {
  const [{ data: settings }, { data: business }] = await Promise.all([
    supabase
      .from("mail_settings")
      .select("from_email,from_name")
      .eq("business_id", payload.businessId)
      .maybeSingle(),
    supabase
      .from("businesses")
      .select("name")
      .eq("id", payload.businessId)
      .maybeSingle(),
  ]);

  const fromEmail = String(settings?.from_email || "").trim();
  if (!fromEmail) {
    throw new Error("Missing from email for rollout report");
  }

  const fromName =
    String(business?.name || "").trim() ||
    String(settings?.from_name || "").trim() ||
    "Tavari Mail";

  const response = await fetch(`${SUPABASE_URL}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      businessId: payload.businessId,
      emailType: "transactional",
      to: payload.reportEmail,
      fromEmail,
      fromName,
      subject: `Rollout report: ${payload.campaignName} batch ${payload.batchNumber}`,
      html: payload.html,
    }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    throw new Error(body?.error || `mail-send failed with status ${response.status}`);
  }

  return body;
}

async function processRolloutReports(
  supabase: ReturnType<typeof createClient>,
  nowIso: string,
) {
  const { data: batches, error } = await supabase
    .from("mail_campaign_rollout_batches")
    .select(`
      *,
      rollout:mail_campaign_rollouts!inner(id,campaign_id,business_id,status,report_email,batch_sizes,total_candidate_recipients,total_sent_recipients,current_batch_number),
      campaign:mail_campaigns!inner(id,name)
    `)
    .eq("status", "awaiting_report")
    .lte("scheduled_report_at", nowIso)
    .order("scheduled_report_at", { ascending: true })
    .limit(20);

  if (error) throw error;

  const processed = [];
  const errors: Array<Record<string, unknown>> = [];

  for (const batch of batches || []) {
    try {
      const { data: recipients, error: recipientsError } = await supabase
        .from("mail_campaign_rollout_recipients")
        .select("contact_id,email_address")
        .eq("batch_id", batch.id);

      if (recipientsError) throw recipientsError;

      const recipientContactIds = (recipients || [])
        .map((row) => String(row.contact_id || ""))
        .filter(Boolean);
      const recipientEmails = (recipients || [])
        .map((row) => String(row.email_address || "").trim().toLowerCase())
        .filter(Boolean);

      const { data: sendRows, error: sendRowsError } = await supabase
        .from("mail_campaign_sends")
        .select("contact_id,email_address,status,error_message,delivered_at,opened_at,clicked_at")
        .eq("rollout_batch_id", batch.id);

      if (sendRowsError) throw sendRowsError;

      let analyticsQuery = supabase
        .from("mail_content_analytics")
        .select("contact_id,event_type,block_id");

      if (recipientContactIds.length > 0) {
        analyticsQuery = analyticsQuery.in("contact_id", recipientContactIds);
      } else {
        analyticsQuery = analyticsQuery.eq("contact_id", "00000000-0000-0000-0000-000000000000");
      }

      const { data: analyticsRows, error: analyticsError } = await analyticsQuery;
      if (analyticsError) throw analyticsError;

      let unsubscribeQuery = supabase
        .from("mail_unsubscribes")
        .select("email,source")
        .eq("business_id", batch.business_id);

      if (recipientEmails.length > 0) {
        unsubscribeQuery = unsubscribeQuery.in("email", recipientEmails);
      } else {
        unsubscribeQuery = unsubscribeQuery.eq("email", "__no_batch_email__");
      }

      const { data: unsubscribeRows, error: unsubscribeError } = await unsubscribeQuery;
      if (unsubscribeError) throw unsubscribeError;

      const sentCount = countUnique(sendRows || []);
      const deliverySuccessCount = countUnique(
        sendRows || [],
        (row) =>
          Boolean(row.delivered_at) ||
          ["sent", "opened", "clicked"].includes(String(row.status || "").toLowerCase()),
      );
      const failedCount = countUnique(
        sendRows || [],
        (row) =>
          ["failed", "bounced", "unsubscribed", "suppressed"].includes(
            String(row.status || "").toLowerCase(),
          ),
      );
      const bouncedCount = countUnique(
        sendRows || [],
        (row) => String(row.status || "").toLowerCase() === "bounced",
      );
      const complaintCount = new Set(
        (unsubscribeRows || [])
          .filter((row) => String(row.source || "") === "auto_complaint")
          .map((row) => String(row.email || "").trim().toLowerCase()),
      ).size;
      const unsubscribeCount = new Set(
        (unsubscribeRows || [])
          .filter((row) => !["auto_complaint", "auto_bounce"].includes(String(row.source || "")))
          .map((row) => String(row.email || "").trim().toLowerCase()),
      ).size;
      const openedCount = new Set(
        (analyticsRows || [])
          .filter((row) => row.event_type === "view" && row.block_id === "email_open")
          .map((row) => String(row.contact_id || "")),
      ).size;
      const clickedCount = new Set(
        (analyticsRows || [])
          .filter((row) => row.event_type === "click")
          .map((row) => String(row.contact_id || "")),
      ).size;

      const totalRecipientsProcessed = await supabase
        .from("mail_campaign_rollout_recipients")
        .select("id", { count: "exact", head: true })
        .eq("rollout_id", batch.rollout.id);

      if (totalRecipientsProcessed.error) throw totalRecipientsProcessed.error;

      const rolloutCompleted =
        Number(totalRecipientsProcessed.count || 0) >=
        Number(batch.rollout.total_candidate_recipients || 0);

      const batchSizes = Array.isArray(batch.rollout.batch_sizes)
        ? batch.rollout.batch_sizes.map((value: unknown) => Number(value))
        : [50, 150, 300, 600];
      const nextBatchNumber = Number(batch.batch_number || 0) + 1;
      const fallbackPrevious = Number(batch.requested_size || batch.actual_size || 600);
      const nextBatchSize =
        nextBatchNumber <= batchSizes.length
          ? batchSizes[nextBatchNumber - 1]
          : fallbackPrevious * 2;

      const approvalUrl = rolloutCompleted
        ? null
        : `${resolvePublicSiteUrl()}/dashboard/mail/sender/${batch.campaign.id}?rolloutId=${batch.rollout.id}`;

      const html = buildRolloutReportHtml({
        campaignName: String(batch.campaign.name || "Campaign"),
        batchNumber: Number(batch.batch_number || 0),
        actualSize: Number(batch.actual_size || 0),
        deliverySuccessCount,
        bouncedCount,
        complaintCount,
        unsubscribeCount,
        openedCount,
        clickedCount,
        approvalUrl,
        nextBatchSize,
        rolloutCompleted,
      });

      await sendRolloutReportEmail(supabase, {
        businessId: String(batch.business_id),
        reportEmail: String(batch.report_email || batch.rollout.report_email || ""),
        campaignName: String(batch.campaign.name || "Campaign"),
        batchNumber: Number(batch.batch_number || 0),
        html,
      });

      const batchStatus = rolloutCompleted ? "completed" : "awaiting_approval";
      const rolloutStatus = rolloutCompleted ? "completed" : "awaiting_approval";
      const now = new Date().toISOString();

      const { error: batchUpdateError } = await supabase
        .from("mail_campaign_rollout_batches")
        .update({
          status: batchStatus,
          report_sent_at: now,
          delivery_success_count: deliverySuccessCount,
          sent_count: sentCount,
          failed_count: failedCount,
          bounced_count: bouncedCount,
          complaint_count: complaintCount,
          unsubscribe_count: unsubscribeCount,
          opened_count: openedCount,
          clicked_count: clickedCount,
          report_error: null,
          updated_at: now,
        })
        .eq("id", batch.id);

      if (batchUpdateError) throw batchUpdateError;

      const { error: rolloutUpdateError } = await supabase
        .from("mail_campaign_rollouts")
        .update({
          status: rolloutStatus,
          last_report_sent_at: now,
          completed_at: rolloutCompleted ? now : null,
          updated_at: now,
        })
        .eq("id", batch.rollout.id);

      if (rolloutUpdateError) throw rolloutUpdateError;

      processed.push({
        rollout_id: batch.rollout.id,
        batch_id: batch.id,
        batch_number: batch.batch_number,
        status: batchStatus,
      });
    } catch (reportError) {
      const errorMessage = getErrorMessage(reportError);
      await supabase
        .from("mail_campaign_rollout_batches")
        .update({
          report_error: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", batch.id);

      errors.push({
        batch_id: batch.id,
        rollout_id: batch.rollout?.id || null,
        error: errorMessage,
      });
    }
  }

  return {
    processed,
    errors,
  };
}

async function authorizeScheduleProcessor(
  req: Request,
  supabase: ReturnType<typeof createClient>,
) {
  const authHeader = req.headers.get("Authorization");
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return null;
  }

  const suppliedSecret = String(req.headers.get("x-mail-schedule-secret") || "").trim();
  if (!suppliedSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const { data: secretRow, error } = await supabase
    .from("system_runtime_secrets")
    .select("secret_value")
    .eq("key_name", "mail_process_schedules_secret")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!secretRow?.secret_value || secretRow.secret_value !== suppliedSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  return null;
}

function buildNextRecurringSchedule(schedule: Record<string, unknown>) {
  const nextSendTimes = Array.isArray(schedule.next_send_times)
    ? schedule.next_send_times.map((value) => String(value))
    : [];

  if (nextSendTimes.length <= 1) {
    return null;
  }

  const remainingSendTimes = nextSendTimes.slice(1);
  const nextScheduledFor = remainingSendTimes[0];

  if (!nextScheduledFor) {
    return null;
  }

  return {
    id: `schedule_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    campaign_id: schedule.campaign_id,
    schedule_type: "recurring",
    scheduled_for: nextScheduledFor,
    timezone: schedule.timezone || "America/Toronto",
    recurring_settings: schedule.recurring_settings || null,
    next_send_times: remainingSendTimes,
    status: "scheduled",
    parent_schedule_id: schedule.id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function fetchModernMinorParticipantRows(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
) {
  const rows: Array<any> = [];

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("waiver_participants")
      .select(`
        id,
        first_name,
        last_name,
        date_of_birth,
        waiver:waiver_signatures!inner(id,business_id,email,signed_at)
      `)
      .eq("participant_type", "minor")
      .eq("waiver.business_id", businessId)
      .not("date_of_birth", "is", null)
      .order("id", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);

    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
  }

  return rows;
}

async function fetchLegacyWaiverRows(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
) {
  const rows: Array<any> = [];

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("legacy_waivers")
      .select("id,email,first_name,last_name,legacy_minors,signed_at")
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .not("legacy_minors", "is", null)
      .order("id", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);

    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
  }

  return rows;
}

/** All minor rows with DOB + parent email for a business (modern + legacy). Shared across birthday automations in one cron tick. */
function buildMinorBirthdayRowsFromWaiverRows(
  participantRows: Array<any>,
  legacyRows: Array<any>,
): Array<Record<string, unknown>> {
  const minorBirthdayRows: Array<Record<string, unknown>> = [];
  for (const row of participantRows || []) {
    const dob = String(row.date_of_birth || "");
    const email = String(row.waiver?.email || "").trim().toLowerCase();
    if (!dob || !email) continue;

    minorBirthdayRows.push({
      source: "modern_waiver_participants",
      waiver_id: String(row.waiver?.id || ""),
      email,
      minor_first_name: String(row.first_name || "").trim(),
      minor_last_name: String(row.last_name || "").trim(),
      minor_date_of_birth: dob,
      waiver_signed_at: String(row.waiver?.signed_at || ""),
    });
  }

  for (const row of legacyRows || []) {
    const email = String(row.email || "").trim().toLowerCase();
    const minors = Array.isArray(row.legacy_minors) ? row.legacy_minors : [];
    if (!email || minors.length === 0) continue;

    for (const minor of minors) {
      const minorRecord = minor && typeof minor === "object" ? minor as Record<string, unknown> : {};
      const dob = getLegacyMinorDateOfBirth(minorRecord);
      if (!dob) continue;

      minorBirthdayRows.push({
        source: "legacy_waivers.legacy_minors",
        waiver_id: String(row.id || ""),
        email,
        minor_first_name: getLegacyMinorFirstName(minorRecord),
        minor_last_name: getLegacyMinorLastName(minorRecord),
        minor_date_of_birth: dob,
        waiver_signed_at: String(row.signed_at || ""),
        legacy_signer_first_name: String(row.first_name || "").trim(),
        legacy_signer_last_name: String(row.last_name || "").trim(),
      });
    }
  }
  return minorBirthdayRows;
}

async function loadAllMinorBirthdayRowsForBusiness(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
): Promise<Array<Record<string, unknown>>> {
  const [participantRows, legacyRows] = await Promise.all([
    fetchModernMinorParticipantRows(supabase, businessId),
    fetchLegacyWaiverRows(supabase, businessId),
  ]);
  return buildMinorBirthdayRowsFromWaiverRows(participantRows, legacyRows);
}

async function fetchEligibleMailContactsByEmail(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  emails: string[],
) {
  const contacts: Array<Record<string, unknown>> = [];
  const emailSet = new Set(
    emails.map((email) => String(email || "").trim().toLowerCase()).filter(Boolean),
  );
  if (emailSet.size === 0) return contacts;

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("mail_contacts")
      .select("id, email, first_name, last_name, subscribed, consent_method, consent_timestamp")
      .eq("business_id", businessId)
      .eq("subscribed", true)
      .not("consent_method", "is", null)
      .not("consent_timestamp", "is", null)
      .order("id", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);

    if (error) throw error;
    contacts.push(...(data || []).filter((contact) => (
      emailSet.has(String(contact.email || "").trim().toLowerCase())
    )));
    if (!data || data.length < SUPABASE_PAGE_SIZE) break;
  }

  return contacts;
}

async function processBirthdayAutomation(
  supabase: ReturnType<typeof createClient>,
  automation: Record<string, unknown>,
  campaign: Record<string, unknown>,
  now: Date,
  nowIso: string,
  businessTimeZone: string,
  opts?: { preloadedMinorBirthdayRows?: Array<Record<string, unknown>> },
) {
  const businessId = String(automation.business_id || campaign.business_id || "");
  const campaignId = String(campaign.id || automation.campaign_id || "");
  const today = getDateStringInTimeZone(now, businessTimeZone);
  const triggerTiming = String(automation.trigger_timing || "event_day");
  const offsetDays = Math.max(Number(automation.days_offset) || 0, 0);
  const criteria = (automation.criteria && typeof automation.criteria === "object")
    ? (automation.criteria as Record<string, unknown>)
    : {};
  const sendWindow = getAutomationSendWindow(criteria);
  const targetSegment = String(criteria.target_segment || "").trim() || null;
  const applyMaxChildAgeRule = criteria.apply_max_child_age_rule === true;
  let maxChildAge: number | null = null;
  if (applyMaxChildAgeRule) {
    const { data: settingsRow, error: settingsError } = await supabase
      .from("mail_settings")
      .select("max_child_age_for_automations")
      .eq("business_id", businessId)
      .maybeSingle();

    if (settingsError) throw settingsError;
    maxChildAge = Number(settingsRow?.max_child_age_for_automations ?? 12);
  }
  const eventDate =
    triggerTiming === "before_event"
      ? shiftDateString(today, offsetDays)
      : triggerTiming === "after_event"
        ? shiftDateString(today, -offsetDays)
        : today;
  const eventMonthDay = monthDayKey(eventDate);
  // Note: we intentionally do NOT skip when "now" is already past the first
  // hourly slot. The old "send_window_already_started" return caused an entire
  // calendar day to queue zero sends if the first successful cron run happened
  // after 7:00 local. Per-recipient idempotency is handled below via
  // mail_automation_runs (trigger_date + contact + delivery_key) and
  // existingKeys. Slots in the past still drain because mail-process-queue only
  // requires scheduled_for <= now (UTC).

  const minorBirthdayRows = opts?.preloadedMinorBirthdayRows
    ? opts.preloadedMinorBirthdayRows
    : await loadAllMinorBirthdayRowsForBusiness(supabase, businessId);

  const birthdayRows = minorBirthdayRows.filter((row) => (
    Boolean(row.minor_date_of_birth && row.email && monthDayKey(String(row.minor_date_of_birth)) === eventMonthDay)
  ));

  if (birthdayRows.length === 0) {
    return {
      automation_id: automation.id,
      automation_type: automation.automation_type,
      trigger_date: today,
      event_date: eventDate,
      matched_candidates: 0,
      queued: 0,
      skipped_reason: "no_matching_birthdays",
    };
  }

  const parentEmails = [...new Set(
    birthdayRows
      .map((row) => String(row.email || "").trim().toLowerCase())
      .filter(Boolean),
  )];

  const contacts = await fetchEligibleMailContactsByEmail(supabase, businessId, parentEmails);

  const contactByEmail = new Map<string, Record<string, unknown>>();
  for (const contact of contacts) {
    const email = String(contact.email || "").trim().toLowerCase();
    if (email) {
      contactByEmail.set(email, contact);
    }
  }

  let allowedContactIds: Set<string> | null = null;
  if (targetSegment) {
    const contactIds = contacts.map((contact) => String(contact.id || "")).filter(Boolean);
    if (contactIds.length === 0) {
      return {
        automation_id: automation.id,
        automation_type: automation.automation_type,
        trigger_date: today,
        event_date: eventDate,
        matched_candidates: 0,
        queued: 0,
        skipped_reason: "segment_has_no_matching_contacts",
      };
    }

    const { data: memberships, error: membershipsError } = await supabase
      .from("mail_contact_segment_memberships")
      .select("contact_id")
      .eq("business_id", businessId)
      .eq("segment_id", targetSegment)
      .in("contact_id", contactIds);

    if (membershipsError) {
      throw membershipsError;
    }

    allowedContactIds = new Set(
      (memberships || []).map((row) => String(row.contact_id || "")).filter(Boolean),
    );
  }

  const loyaltyEmails = [...new Set(
    contacts
      .map((contact) => String(contact.email || "").trim().toLowerCase())
      .filter(Boolean),
  )];
  const loyaltyByEmail = new Map<string, number>();
  if (loyaltyEmails.length > 0) {
    const { data: loyaltyRows } = await supabase
      .from("pos_loyalty_accounts")
      .select("customer_email, points")
      .eq("business_id", businessId)
      .in("customer_email", loyaltyEmails);

    for (const row of loyaltyRows || []) {
      const email = String(row.customer_email || "").trim().toLowerCase();
      if (!email || loyaltyByEmail.has(email)) continue;
      loyaltyByEmail.set(email, Number(row.points) || 0);
    }
  }

  const dedupedCandidates = new Map<string, Record<string, unknown>>();
  for (const row of birthdayRows) {
    const email = String(row.email || "").trim().toLowerCase();
    const contact = contactByEmail.get(email);
    if (!contact?.id) continue;
    if (allowedContactIds && !allowedContactIds.has(String(contact.id))) continue;

    const minorFirstName = String(row.minor_first_name || "").trim();
    const minorLastName = String(row.minor_last_name || "").trim();
    const minorDateOfBirth = String(row.minor_date_of_birth || "").trim();
    if (
      applyMaxChildAgeRule &&
      !isTriggeringMinorEligibleByMaxChildAge(minorDateOfBirth, eventDate, maxChildAge)
    ) {
      continue;
    }

    const candidateKey = [
      String(contact.id),
      minorDateOfBirth,
      normalizeNamePart(minorFirstName),
      normalizeNamePart(minorLastName),
    ].join(":");

    const existing = dedupedCandidates.get(candidateKey);
    const currentSignedAt = String(row.waiver_signed_at || "");
    const existingSignedAt = String(existing?.waiver_signed_at || "");
    if (!existing || currentSignedAt > existingSignedAt) {
      dedupedCandidates.set(candidateKey, {
        contact_id: String(contact.id),
        email_address: email,
        first_name: String(contact.first_name || ""),
        last_name: String(contact.last_name || ""),
        loyalty_points: loyaltyByEmail.get(email) ?? 0,
        minor_first_name: minorFirstName,
        minor_last_name: minorLastName,
        minor_date_of_birth: minorDateOfBirth,
        event_date: eventDate,
        max_child_age_rule_applied: applyMaxChildAgeRule,
        max_child_age: maxChildAge,
        waiver_signed_at: currentSignedAt,
        source: String(row.source || ""),
        waiver_id: String(row.waiver_id || ""),
      });
    }
  }

  const candidates = [...dedupedCandidates.values()];
  if (candidates.length === 0) {
    return {
      automation_id: automation.id,
      automation_type: automation.automation_type,
      trigger_date: today,
      event_date: eventDate,
      matched_candidates: 0,
      queued: 0,
      skipped_reason: targetSegment ? "segment_filtered_all_candidates" : "no_matching_contacts",
    };
  }

  const eligibleCandidates = await filterBirthdayCandidatesForPriorSendSuppression(
    supabase,
    String(automation.id || ""),
    eventDate,
    candidates,
    now,
  );

  if (eligibleCandidates.length === 0) {
    return {
      automation_id: automation.id,
      automation_type: automation.automation_type,
      trigger_date: today,
      event_date: eventDate,
      matched_candidates: candidates.length,
      queued: 0,
      skipped_reason: "birthday_prior_send_suppression",
      suppression_weeks: BIRTHDAY_AUTOMATION_SUPPRESSION_WEEKS,
      suppression_scope: "automation_contact_delivery_key",
    };
  }

  const { data: existingRuns, error: existingRunsError } = await supabase
    .from("mail_automation_runs")
    .select("contact_id, delivery_key")
    .eq("automation_id", String(automation.id))
    .eq("trigger_date", today);

  if (existingRunsError) {
    throw existingRunsError;
  }

  const existingKeys = new Set(
    (existingRuns || []).map((row) => `${String(row.contact_id || "")}:${String(row.delivery_key || "")}`),
  );

  let queued = 0;
  let skipped_existing_same_day = 0;
  const sendSlots = buildAutomationSendSlots(eligibleCandidates.length, today, businessTimeZone, sendWindow);
  for (const candidate of eligibleCandidates) {
    const sendSlot = sendSlots[queued] || {
      scheduled_for: nowIso,
      local_time: `${today} ${String(sendWindow.start_hour).padStart(2, "0")}:${String(sendWindow.minute_offset).padStart(2, "0")}`,
      local_hour: sendWindow.start_hour,
      local_minute: sendWindow.minute_offset,
      time_zone: businessTimeZone,
    };
    const deliveryKey = buildBirthdayDeliveryKey({
      eventDate,
      minorDateOfBirth: String(candidate.minor_date_of_birth || ""),
      minorFirstName: String(candidate.minor_first_name || ""),
      minorLastName: String(candidate.minor_last_name || ""),
    });
    const uniquenessKey = `${String(candidate.contact_id)}:${deliveryKey}`;
    if (existingKeys.has(uniquenessKey)) {
      skipped_existing_same_day += 1;
      continue;
    }

    const runPayload = {
      business_id: businessId,
      automation_id: String(automation.id),
      campaign_id: campaignId,
      contact_id: String(candidate.contact_id),
      email_address: String(candidate.email_address),
      automation_type: String(automation.automation_type || "birthday"),
      delivery_key: deliveryKey,
      trigger_date: today,
      event_date: eventDate,
      context: {
        loyalty_points: Number(candidate.loyalty_points) || 0,
        minor_first_name: String(candidate.minor_first_name || ""),
        minor_last_name: String(candidate.minor_last_name || ""),
        minor_date_of_birth: String(candidate.minor_date_of_birth || ""),
        event_date: eventDate,
        max_child_age_rule_applied: candidate.max_child_age_rule_applied === true,
        max_child_age: candidate.max_child_age ?? null,
        scheduled_for: sendSlot.scheduled_for,
        scheduled_local_time: sendSlot.local_time,
        scheduled_local_hour: sendSlot.local_hour,
        scheduled_local_minute: sendSlot.local_minute,
        scheduled_time_zone: sendSlot.time_zone,
        send_window: sendWindow,
        birthday_prior_send_suppression_weeks: BIRTHDAY_AUTOMATION_SUPPRESSION_WEEKS,
        birthday_prior_send_suppression_scope: "automation_contact_delivery_key",
        bypass_marketing_frequency_cap: true,
      },
      status: "queued",
      queued_at: nowIso,
      updated_at: nowIso,
    };

    const { data: runRow, error: runError } = await supabase
      .from("mail_automation_runs")
      .insert(runPayload)
      .select("id")
      .single();

    if (runError) {
      if (String((runError as { code?: unknown })?.code || "") === "23505") {
        existingKeys.add(uniquenessKey);
        continue;
      }
      throw runError;
    }

    const personalizedContent = personalizeEmailContent(
      String(campaign.content_html || ""),
      {
        first_name: candidate.first_name,
        last_name: candidate.last_name,
        email: candidate.email_address,
      },
      {
        ...(runPayload.context as Record<string, unknown>),
        business_id: businessId,
      },
    );

    const queuePayload = {
      campaign_id: campaignId,
      contact_id: String(candidate.contact_id),
      email_address: String(candidate.email_address),
      status: "queued",
      priority: 4,
      scheduled_for: sendSlot.scheduled_for,
      business_id: businessId,
      personalized_content: personalizedContent,
      automation_id: String(automation.id),
      automation_run_id: String(runRow.id),
    };

    const { error: queueError } = await supabase
      .from("mail_sending_queue")
      .insert(queuePayload);

    if (queueError) {
      await supabase
        .from("mail_automation_runs")
        .update({
          status: "failed",
          last_error: getErrorMessage(queueError),
          updated_at: new Date().toISOString(),
        })
        .eq("id", String(runRow.id));
      throw queueError;
    }

    existingKeys.add(uniquenessKey);
    queued += 1;
  }

  if (queued > 0) {
    await supabase
      .from("mail_campaigns")
      .update({
        status: "sending",
        total_recipients: queued,
        updated_at: nowIso,
      })
      .eq("id", campaignId)
      .eq("business_id", businessId);
  }

  await supabase
    .from("mail_automations")
    .update({
      updated_at: nowIso,
    })
    .eq("id", String(automation.id));

  return {
    automation_id: automation.id,
    automation_type: automation.automation_type,
    trigger_date: today,
    event_date: eventDate,
    matched_candidates: candidates.length,
    queued,
    birthday_stats: {
      waiver_minors_loaded: minorBirthdayRows.length,
      cohort_month_day: eventMonthDay,
      birthday_rows_matched: birthdayRows.length,
      candidates_deduped: candidates.length,
      eligible_after_prior_send_suppression: eligibleCandidates.length,
      skipped_existing_same_day: skipped_existing_same_day,
      used_preloaded_waiver_pool: Boolean(opts?.preloadedMinorBirthdayRows),
    },
  };
}

type ToddlerEligibleRow = {
  contact_id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  toddler_count?: number | null;
  toddler_first_names?: string[] | null;
  has_expired_waiver?: boolean | null;
};

async function processToddlerThursdayAutomation(
  supabase: ReturnType<typeof createClient>,
  automation: Record<string, unknown>,
  campaign: Record<string, unknown>,
  now: Date,
  nowIso: string,
  businessTimeZone: string,
  preloadedRows: ToddlerEligibleRow[],
): Promise<Record<string, unknown>> {
  const businessId = String(automation.business_id || campaign.business_id || "");
  const campaignId = String(campaign.id || automation.campaign_id || "");
  const criteria = (automation.criteria && typeof automation.criteria === "object")
    ? automation.criteria as ToddlerThursdayCriteria
    : {};
  const schedule = resolveToddlerThursdaySchedule(now, businessTimeZone, criteria);

  if (!schedule.ok) {
    return {
      automation_id: automation.id,
      automation_type: automation.automation_type,
      trigger_date: schedule.today_local || getDateStringInTimeZone(now, businessTimeZone),
      queued: 0,
      skipped_reason: schedule.skipped_reason || "schedule_gate",
      toddler_thursday_schedule: schedule,
    };
  }

  const promoThursdayDate = String(schedule.promo_thursday_date || "");
  const sendLocalDate = String(schedule.send_local_date || getDateStringInTimeZone(now, businessTimeZone));
  const activeCohort = schedule.active_cohort || "A";
  const sendWindow = getAutomationSendWindow(criteria as Record<string, unknown>);
  const targetSegment = String((criteria as Record<string, unknown>).target_segment || "").trim() || null;
  const offerPrice = String(criteria.offer_price_label || "$7");
  const promoCode = String(criteria.promo_code || "DCT2026").trim() || "DCT2026";
  const minForOffer = Math.max(2, Number(criteria.min_toddler_count_for_offer ?? 2));
  const bookingWindow = String(criteria.booking_window_label || "10:00 AM – 1:00 PM").trim();
  const offerDetails = buildToddlerThursdayOfferDetails(criteria);
  const minAge = Math.max(1, Number(criteria.toddler_min_age_years ?? 1));
  const maxAge = Math.max(minAge, Number(criteria.toddler_max_age_years ?? 3));

  let allowedContactIds: Set<string> | null = null;
  if (targetSegment) {
    const contactIds = preloadedRows.map((row) => String(row.contact_id || "")).filter(Boolean);
    if (contactIds.length === 0) {
      return {
        automation_id: automation.id,
        automation_type: automation.automation_type,
        trigger_date: sendLocalDate,
        promo_thursday_date: promoThursdayDate,
        matched_candidates: 0,
        queued: 0,
        skipped_reason: "segment_has_no_matching_contacts",
      };
    }
    const { data: memberships, error: membershipsError } = await supabase
      .from("mail_contact_segment_memberships")
      .select("contact_id")
      .eq("business_id", businessId)
      .eq("segment_id", targetSegment)
      .in("contact_id", contactIds);
    if (membershipsError) throw membershipsError;
    allowedContactIds = new Set(
      (memberships || []).map((row) => String(row.contact_id || "")).filter(Boolean),
    );
  }

  const candidates = preloadedRows.filter((row) => {
    const contactId = String(row.contact_id || "");
    if (!contactId || !row.email) return false;
    if (allowedContactIds && !allowedContactIds.has(contactId)) return false;
    return getContactCohort(contactId, String(row.email)) === activeCohort;
  });

  if (candidates.length === 0) {
    return {
      automation_id: automation.id,
      automation_type: automation.automation_type,
      trigger_date: sendLocalDate,
      promo_thursday_date: promoThursdayDate,
      matched_candidates: 0,
      queued: 0,
      skipped_reason: "no_candidates_for_active_cohort",
      toddler_thursday_schedule: schedule,
      eligible_pool_size: preloadedRows.length,
    };
  }

  const { data: existingRuns, error: existingRunsError } = await supabase
    .from("mail_automation_runs")
    .select("contact_id, delivery_key")
    .eq("automation_id", String(automation.id))
    .eq("trigger_date", sendLocalDate);

  if (existingRunsError) throw existingRunsError;

  const existingKeys = new Set(
    (existingRuns || []).map((row) => `${String(row.contact_id || "")}:${String(row.delivery_key || "")}`),
  );

  const scheduledFor = localWallDateTimeToUtcIso(
    sendLocalDate,
    sendWindow.start_hour,
    sendWindow.minute_offset,
    businessTimeZone,
  );
  const promoThursdayDisplay = formatPromoThursdayDisplay(promoThursdayDate, businessTimeZone);

  let queued = 0;
  let skipped_existing_same_day = 0;

  for (const row of candidates) {
    const contactId = String(row.contact_id);
    const email = String(row.email || "").trim().toLowerCase();
    const toddlerNames = formatToddlerNamesList(
      Array.isArray(row.toddler_first_names) ? row.toddler_first_names.map(String) : [],
    );
    const deliveryKey = buildToddlerThursdayDeliveryKey(promoThursdayDate, contactId);
    const uniquenessKey = `${contactId}:${deliveryKey}`;
    if (existingKeys.has(uniquenessKey)) {
      skipped_existing_same_day += 1;
      continue;
    }

    const runPayload = {
      business_id: businessId,
      automation_id: String(automation.id),
      campaign_id: campaignId,
      contact_id: contactId,
      email_address: email,
      automation_type: String(automation.automation_type || "custom"),
      delivery_key: deliveryKey,
      trigger_date: sendLocalDate,
      event_date: promoThursdayDate,
      context: {
        toddler_count: Number(row.toddler_count || 0),
        toddler_names: toddlerNames,
        promo_thursday_date: promoThursdayDisplay,
        offer_price: offerPrice,
        promo_code: promoCode,
        booking_window: bookingWindow,
        min_toddler_count_for_offer: minForOffer,
        offer_details: offerDetails,
        has_expired_waiver: row.has_expired_waiver === true,
        scheduled_for: scheduledFor,
        scheduled_local_time:
          `${sendLocalDate} ${String(sendWindow.start_hour).padStart(2, "0")}:${String(sendWindow.minute_offset).padStart(2, "0")}`,
        scheduled_time_zone: businessTimeZone,
        send_window: sendWindow,
        active_cohort: activeCohort,
        promo_cycle_index: schedule.promo_cycle_index,
        toddler_min_age_years: minAge,
        toddler_max_age_years: maxAge,
      },
      status: "queued",
      queued_at: nowIso,
      updated_at: nowIso,
    };

    const { data: runRow, error: runError } = await supabase
      .from("mail_automation_runs")
      .insert(runPayload)
      .select("id")
      .single();

    if (runError) {
      if (String((runError as { code?: unknown })?.code || "") === "23505") {
        existingKeys.add(uniquenessKey);
        continue;
      }
      throw runError;
    }

    const personalizedContent = personalizeEmailContent(
      String(campaign.content_html || ""),
      {
        first_name: row.first_name,
        last_name: row.last_name,
        email,
      },
      {
        ...(runPayload.context as Record<string, unknown>),
        business_id: businessId,
      },
    );

    const { error: queueError } = await supabase
      .from("mail_sending_queue")
      .insert({
        campaign_id: campaignId,
        contact_id: contactId,
        email_address: email,
        status: "queued",
        priority: 4,
        scheduled_for: scheduledFor,
        business_id: businessId,
        personalized_content: personalizedContent,
        automation_id: String(automation.id),
        automation_run_id: String(runRow.id),
      });

    if (queueError) {
      await supabase
        .from("mail_automation_runs")
        .update({
          status: "failed",
          last_error: getErrorMessage(queueError),
          updated_at: new Date().toISOString(),
        })
        .eq("id", String(runRow.id));
      throw queueError;
    }

    existingKeys.add(uniquenessKey);
    queued += 1;
  }

  if (queued > 0) {
    await supabase
      .from("mail_campaigns")
      .update({
        status: "sending",
        total_recipients: queued,
        updated_at: nowIso,
      })
      .eq("id", campaignId)
      .eq("business_id", businessId);
  }

  await supabase
    .from("mail_automations")
    .update({ updated_at: nowIso })
    .eq("id", String(automation.id));

  return {
    automation_id: automation.id,
    automation_type: automation.automation_type,
    trigger_date: sendLocalDate,
    promo_thursday_date: promoThursdayDate,
    matched_candidates: candidates.length,
    eligible_pool_size: preloadedRows.length,
    queued,
    toddler_thursday_schedule: schedule,
    toddler_stats: {
      skipped_existing_same_day,
      active_cohort: activeCohort,
      toddler_age_band: `${minAge}-${maxAge}`,
    },
  };
}

async function processAutomations(
  supabase: ReturnType<typeof createClient>,
  nowIso: string,
) {
  const now = new Date(nowIso);
  const automationSelect = `
      *,
      campaign:mail_campaigns!inner(id,business_id,name,content_html,subject_line,status)
    `;

  // Birthday: batch limit + one waiver scan per business per tick (avoids N× full-table reads and edge timeouts).
  const BIRTHDAY_AUTOMATIONS_PER_TICK = 120;
  const [{ data: birthdayAutomations, error: birthdayError }, { data: otherAutomations, error: otherError }] =
    await Promise.all([
      supabase
        .from("mail_automations")
        .select(automationSelect)
        .eq("is_enabled", true)
        .neq("status", "archived")
        .eq("automation_type", "birthday")
        .order("updated_at", { ascending: true })
        .limit(BIRTHDAY_AUTOMATIONS_PER_TICK),
      supabase
        .from("mail_automations")
        .select(automationSelect)
        .eq("is_enabled", true)
        .neq("status", "archived")
        .neq("automation_type", "birthday")
        .order("updated_at", { ascending: true })
        .limit(50),
    ]);

  if (birthdayError) throw birthdayError;
  if (otherError) throw otherError;

  const birthdayList = birthdayAutomations || [];
  const otherList = otherAutomations || [];

  const businessIds = [...new Set(
    [...birthdayList, ...otherList].map((row) =>
      String(row.business_id || (row.campaign as Record<string, unknown> | undefined)?.business_id || "")
    ).filter(Boolean),
  )];
  const businessTimeZones = new Map<string, string>();
  if (businessIds.length > 0) {
    const { data: businesses } = await supabase
      .from("businesses")
      .select("id, timezone")
      .in("id", businessIds);

    for (const business of businesses || []) {
      businessTimeZones.set(
        String(business.id),
        String((business as Record<string, unknown>).timezone || "America/Toronto"),
      );
    }
  }

  const processed: Array<Record<string, unknown>> = [];
  const errors: Array<Record<string, unknown>> = [];

  const birthdayByBusiness = new Map<string, Record<string, unknown>[]>();
  for (const row of birthdayList) {
    const campaign = (row.campaign && typeof row.campaign === "object")
      ? row.campaign as Record<string, unknown>
      : {};
    const businessId = String(row.business_id || campaign.business_id || "");
    if (!businessId) continue;
    if (!birthdayByBusiness.has(businessId)) birthdayByBusiness.set(businessId, []);
    birthdayByBusiness.get(businessId)!.push(row as Record<string, unknown>);
  }

  for (const [businessId, bizBirthdayAutos] of birthdayByBusiness) {
    let waiverPool: Array<Record<string, unknown>>;
    try {
      waiverPool = await loadAllMinorBirthdayRowsForBusiness(supabase, businessId);
    } catch (loadErr) {
      for (const automation of bizBirthdayAutos) {
        errors.push({
          automation_id: automation.id,
          automation_type: automation.automation_type,
          error: getErrorMessage(loadErr),
        });
      }
      continue;
    }

    const businessTimeZone = businessTimeZones.get(businessId) || "America/Toronto";
    for (const automation of bizBirthdayAutos) {
      const campaign = (automation.campaign && typeof automation.campaign === "object")
        ? automation.campaign as Record<string, unknown>
        : {};
      try {
        if (!businessId || !campaign.id) {
          throw new Error("Automation is missing business or campaign data");
        }

        if (!campaign.content_html || !campaign.subject_line) {
          processed.push({
            automation_id: automation.id,
            automation_type: automation.automation_type,
            queued: 0,
            skipped_reason: "campaign_missing_content",
          });
          continue;
        }

        const automationCriteria =
          automation.criteria && typeof automation.criteria === "object"
            ? (automation.criteria as Record<string, unknown>)
            : {};
        if (String(automationCriteria.source || "") === "name_of_day") {
          processed.push({
            automation_id: automation.id,
            automation_type: automation.automation_type,
            queued: 0,
            skipped_reason: "name_of_day_handled_by_edge_function",
          });
          continue;
        }

        processed.push(
          await processBirthdayAutomation(
            supabase,
            automation,
            campaign,
            now,
            nowIso,
            businessTimeZone,
            { preloadedMinorBirthdayRows: waiverPool },
          ),
        );
      } catch (automationError) {
        errors.push({
          automation_id: automation.id,
          automation_type: automation.automation_type,
          error: getErrorMessage(automationError),
        });
      }
    }
  }

  for (const automation of otherList) {
    const campaign = (automation.campaign && typeof automation.campaign === "object")
      ? automation.campaign as Record<string, unknown>
      : {};
    const businessId = String(automation.business_id || campaign.business_id || "");
    const businessTimeZone = businessTimeZones.get(businessId) || "America/Toronto";

    try {
      if (!businessId || !campaign.id) {
        throw new Error("Automation is missing business or campaign data");
      }

      if (!campaign.content_html || !campaign.subject_line) {
        processed.push({
          automation_id: automation.id,
          automation_type: automation.automation_type,
          queued: 0,
          skipped_reason: "campaign_missing_content",
        });
        continue;
      }

      const automationCriteria =
        automation.criteria && typeof automation.criteria === "object"
          ? (automation.criteria as Record<string, unknown>)
          : {};
      if (String(automationCriteria.source || "") === "name_of_day") {
        processed.push({
          automation_id: automation.id,
          automation_type: automation.automation_type,
          queued: 0,
          skipped_reason: "name_of_day_handled_by_edge_function",
        });
        continue;
      }

      if (String(automationCriteria.source || "") === "toddler_thursday") {
        const minAge = Math.max(1, Number(automationCriteria.toddler_min_age_years ?? 1));
        const maxAge = Math.max(minAge, Number(automationCriteria.toddler_max_age_years ?? 3));
        const { data: eligibleRows, error: rpcError } = await supabase.rpc(
          "mail_toddler_thursday_eligible_guardians",
          {
            p_business_id: businessId,
            p_min_age_years: Math.floor(minAge),
            p_max_age_years: Math.floor(maxAge),
          },
        );
        if (rpcError) throw rpcError;
        processed.push(
          await processToddlerThursdayAutomation(
            supabase,
            automation as Record<string, unknown>,
            campaign,
            now,
            nowIso,
            businessTimeZone,
            (eligibleRows || []) as ToddlerEligibleRow[],
          ),
        );
        continue;
      }

      processed.push({
        automation_id: automation.id,
        automation_type: automation.automation_type,
        queued: 0,
        skipped_reason: "automation_type_not_implemented_yet",
      });
    } catch (automationError) {
      errors.push({
        automation_id: automation.id,
        automation_type: automation.automation_type,
        error: getErrorMessage(automationError),
      });
    }
  }

  return {
    processed,
    errors,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const authError = await authorizeScheduleProcessor(req, supabase);
    if (authError) return authError;
    const nowIso = new Date().toISOString();
    const automationResults = await processAutomations(supabase, nowIso);

    const { data: schedules, error: scheduleError } = await supabase
      .from("mail_campaign_schedules")
      .select(`
        *,
        campaign:mail_campaigns!inner(id, business_id, content_html, subject_line, status)
      `)
      .eq("status", "scheduled")
      .lte("scheduled_for", nowIso)
      .order("scheduled_for", { ascending: true })
      .limit(25);

    if (scheduleError) throw scheduleError;

    const processedSchedules: Array<Record<string, unknown>> = [];
    const campaignIdsQueued = new Set<string>();
    const errors: Array<Record<string, unknown>> = [];

    for (const schedule of schedules || []) {
      const { data: lockedSchedule } = await supabase
        .from("mail_campaign_schedules")
        .update({
          status: "processing",
          processed_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", schedule.id)
        .eq("status", "scheduled")
        .select("id")
        .maybeSingle();

      if (!lockedSchedule?.id) {
        continue;
      }

      try {
        const campaign = schedule.campaign || {};
        const businessId = String(campaign.business_id || "");

        if (!businessId) {
          throw new Error("Scheduled campaign is missing business_id");
        }

        const { data: contacts, error: contactsError } = await supabase
          .from("mail_contacts")
          .select("id, email, first_name, last_name, consent_method, consent_timestamp")
          .eq("business_id", businessId)
          .eq("subscribed", true)
          .not("consent_method", "is", null)
          .not("consent_timestamp", "is", null);

        if (contactsError) throw contactsError;

        const validContacts = (contacts || []).filter((contact) => contact.email);
        if (validContacts.length === 0) {
          throw new Error("No subscribed contacts found for scheduled campaign");
        }

        await supabase
          .from("mail_sending_queue")
          .delete()
          .eq("campaign_id", schedule.campaign_id)
          .in("status", ["queued", "processing"]);

        const queueItems = validContacts.map((contact) => ({
          campaign_id: schedule.campaign_id,
          contact_id: contact.id,
          email_address: contact.email,
          status: "queued",
          priority: 5,
          scheduled_for: nowIso,
          business_id: businessId,
          personalized_content: personalizeEmailContent(String(campaign.content_html || ""), contact, {
            business_id: businessId,
          }),
        }));

        for (let i = 0; i < queueItems.length; i += 1000) {
          const batch = queueItems.slice(i, i + 1000);
          const { error: insertError } = await supabase
            .from("mail_sending_queue")
            .insert(batch);

          if (insertError) throw insertError;
        }

        await supabase
          .from("mail_campaigns")
          .update({
            status: "sending",
            total_recipients: validContacts.length,
            scheduled_at: null,
            updated_at: nowIso,
          })
          .eq("id", schedule.campaign_id)
          .eq("business_id", businessId);

        if (schedule.schedule_type === "recurring") {
          const nextSchedule = buildNextRecurringSchedule(schedule);
          if (nextSchedule) {
            const { error: nextScheduleError } = await supabase
              .from("mail_campaign_schedules")
              .insert(nextSchedule);

            if (nextScheduleError) throw nextScheduleError;

            await supabase
              .from("mail_campaigns")
              .update({
                scheduled_at: nextSchedule.scheduled_for,
                updated_at: nowIso,
              })
              .eq("id", schedule.campaign_id)
              .eq("business_id", businessId);
          }
        }

        await supabase
          .from("mail_campaign_schedules")
          .update({
            status: "completed",
            updated_at: nowIso,
          })
          .eq("id", schedule.id);

        processedSchedules.push({
          schedule_id: schedule.id,
          campaign_id: schedule.campaign_id,
          queued: queueItems.length,
        });
        campaignIdsQueued.add(String(schedule.campaign_id));
      } catch (error) {
        const errorMessage = getErrorMessage(error);

        await supabase
          .from("mail_campaign_schedules")
          .update({
            status: "failed",
            error_message: errorMessage,
            processed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", schedule.id);

        errors.push({
          schedule_id: schedule.id,
          campaign_id: schedule.campaign_id,
          error: errorMessage,
        });
      }
    }

    const queueRes = await fetch(`${SUPABASE_URL}/functions/v1/mail-process-queue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ batchSize: 100 }),
    });

    const queueJson = await queueRes.json().catch(() => null);
    if (!queueRes.ok) {
      throw new Error(queueJson?.error || `mail-process-queue failed with status ${queueRes.status}`);
    }

    const rolloutReports = await processRolloutReports(supabase, nowIso);

    // Dual-trigger daily digest via background waitUntil so a missed 15-min digest
    // cron tick cannot lose the night. Digest no-ops until local send time / after sent.
    const digestKickPromise = fetch(`${SUPABASE_URL}/functions/v1/mail-daily-digest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({}),
    })
      .then(async (digestRes) => {
        if (!digestRes.ok) {
          console.warn("[mail-process-schedules] digest kick failed", digestRes.status);
        }
      })
      .catch((digestError) => {
        console.warn("[mail-process-schedules] digest kick error", getErrorMessage(digestError));
      });
    const edgeRuntime = (globalThis as {
      EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
    }).EdgeRuntime;
    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(digestKickPromise);
    } else {
      // Best-effort if waitUntil unavailable — do not block the schedules response.
      void digestKickPromise;
    }

    return jsonResponse({
      processed_automations: automationResults.processed.length,
      automations: automationResults.processed,
      processed_schedules: processedSchedules.length,
      schedules: processedSchedules,
      campaigns_queued: [...campaignIdsQueued],
      queue_run: queueJson,
      rollout_reports: rolloutReports.processed,
      digest_kick: "scheduled",
      automation_errors: automationResults.errors,
      errors,
      rollout_errors: rolloutReports.errors,
    });
  } catch (error) {
    return jsonResponse(
      { error: getErrorMessage(error) },
      500,
    );
  }
});
