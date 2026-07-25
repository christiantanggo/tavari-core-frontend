import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  resolveBusinessAddress,
  resolveBusinessName,
} from "../_shared/mailBusinessProfile.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const DEFAULT_PUBLIC_SITE_URL = "https://tavarios.ca";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-waiver-review-queue-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CheckInPayload = {
  action?: string;
  businessId?: string;
  checkInId?: string;
  waiverId?: string;
  waiverParticipantId?: string | null;
  subjectType?: "primary_signer" | "minor" | "additional_adult";
  displayName?: string;
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

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
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

function personalize(content: string, values: Record<string, unknown>) {
  const firstName = String(values.first_name || "");
  const lastName = String(values.last_name || "");
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const checkedInName = String(values.checked_in_name || "");
  const reviewLink = String(values.review_link || "");
  const eventDate = String(values.event_date || "");

  let output = String(content || "");
  output = replaceMergeTokens(output, ["{{First Name}}", "{{FirstName}}", "{FirstName}"], firstName);
  output = replaceMergeTokens(output, ["{{Last Name}}", "{{LastName}}", "{LastName}"], lastName);
  output = replaceMergeTokens(output, ["{{Full Name}}", "{{FullName}}", "{FullName}"], fullName);
  output = replaceMergeTokens(output, ["{{CheckedInName}}", "{{Checked-In Name}}", "{{Checked In Name}}"], checkedInName);
  /* Triple-brace first so we do not leave stray `{` from nested patterns */
  output = replaceMergeTokens(output, ["{{{ReviewLink}}}", "{{{Review Link}}}"], reviewLink);
  output = replaceMergeTokens(output, ["{{ReviewLink}}", "{{Review Link}}"], reviewLink);
  output = replaceMergeTokens(output, ["{{EventDate}}", "{{Event Date}}"], eventDate);

  const businessNameToken =
    String(values.business_name || values.from_name || "").trim() || "Tavari";
  const businessAddressToken =
    String(values.business_address || "").trim() || "Business address required";
  output = replaceMergeTokens(
    output,
    [
      "{{{BusinessName}}}",
      "{{BusinessName}}",
      "{BusinessName}",
      "{{Business Name}}",
    ],
    businessNameToken,
  );
  output = replaceMergeTokens(
    output,
    [
      "{{{BusinessAddress}}}",
      "{{BusinessAddress}}",
      "{BusinessAddress}",
      "{{Business Address}}",
    ],
    businessAddressToken,
  );
  output = replaceMergeTokens(
    output,
    ["{{{FromName}}}", "{{FromName}}", "{FromName}"],
    businessNameToken,
  );

  return output;
}

function htmlToText(html: string) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

async function authorizeRequest(req: Request, businessId: string) {
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return null;
  if (!authHeader || !SUPABASE_ANON_KEY) return jsonResponse({ error: "Unauthorized" }, 401);

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await supabaseUser.auth.getUser();
  if (userError || !userData.user?.id) return jsonResponse({ error: "Unauthorized" }, 401);

  const userId = userData.user.id;
  const [{ data: businessUser }, { data: role }, { data: employee }] = await Promise.all([
    supabaseUser
      .from("business_users")
      .select("business_id")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
    supabaseUser
      .from("user_roles")
      .select("business_id")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
    supabaseUser
      .from("tavari_employees")
      .select("business_id")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle(),
  ]);

  if (!businessUser && !role && !employee) {
    return jsonResponse({ error: "Access denied to this business" }, 403);
  }

  return null;
}

function buildDeliveryKey(input: {
  checkedInAt: string;
  waiverId: string;
  waiverParticipantId: string | null;
  subjectType: string;
}) {
  const day = String(input.checkedInAt || new Date().toISOString()).slice(0, 10);
  return [
    "waiver-check-in-review",
    day,
    input.waiverId,
    input.subjectType,
    input.waiverParticipantId || "primary",
  ].join(":");
}

type SendResult = {
  ok: boolean;
  queued: number;
  sent: number;
  skipped?: string;
  skipped_reason?: string;
  errors?: Array<Record<string, unknown>>;
  skipped_items?: Array<Record<string, unknown>>;
};

/**
 * Load check-in, resolve recipient, run Mail "waiver_check_in_review" automations.
 * Used for immediate send and for queue processor.
 */
async function runWaiverCheckInReviewSend(
  supabase: SupabaseClient,
  businessId: string,
  checkInId: string,
  payload: Partial<CheckInPayload> = {},
): Promise<SendResult> {
  const { data: rep } = await supabase
    .from("reputation_settings")
    .select("waiver_check_in_review_email_enabled")
    .eq("business_id", businessId)
    .maybeSingle();
  if (rep?.waiver_check_in_review_email_enabled === false) {
    return { ok: true, queued: 0, sent: 0, skipped: "reputation_waiver_review_email_disabled" };
  }

  const { data: checkIn, error: checkInError } = await supabase
    .from("waiver_participant_check_ins")
    .select("id,business_id,waiver_id,waiver_participant_id,subject_type,display_name,checked_in_at")
    .eq("id", checkInId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (checkInError) throw checkInError;
  if (!checkIn) {
    return { ok: false, queued: 0, sent: 0, skipped_reason: "check_in_not_found" };
  }

  const waiverId = String(checkIn.waiver_id || payload.waiverId || "");
  const waiverParticipantId = checkIn.waiver_participant_id
    ? String(checkIn.waiver_participant_id)
    : payload.waiverParticipantId || null;
  const subjectType = String(checkIn.subject_type || payload.subjectType || "");
  const checkedInName = String(checkIn.display_name || payload.displayName || "your group");
  const checkedInAt = String(checkIn.checked_in_at || new Date().toISOString());

  const { data: repAdult } = await supabase
    .from("reputation_settings")
    .select("waiver_check_in_review_adults_only")
    .eq("business_id", businessId)
    .maybeSingle();
  if (repAdult?.waiver_check_in_review_adults_only !== false && subjectType === "minor") {
    return { ok: true, queued: 0, sent: 0, skipped: "adults_only_excludes_minors" };
  }

  const [{ data: waiver, error: waiverError }, { data: participant, error: participantError }] =
    await Promise.all([
      supabase
        .from("waiver_signatures")
        .select("id,business_id,first_name,last_name,email,phone_number,customer_id")
        .eq("id", waiverId)
        .eq("business_id", businessId)
        .maybeSingle(),
      waiverParticipantId
        ? supabase
            .from("waiver_participants")
            .select("id,first_name,last_name,email,phone_number")
            .eq("id", waiverParticipantId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

  if (waiverError) throw waiverError;
  if (participantError) throw participantError;
  if (!waiver) {
    return { ok: false, queued: 0, sent: 0, skipped_reason: "waiver_not_found" };
  }

  let recipientEmail = normalizeEmail(
    subjectType === "additional_adult" && participant?.email
      ? participant.email
      : waiver.email,
  );

  let loyaltyCustomer: Record<string, unknown> | null = null;
  if (!recipientEmail && waiver.customer_id) {
    const { data: customer, error: customerError } = await supabase
      .from("pos_loyalty_accounts")
      .select("customer_email,customer_name,points")
      .eq("id", waiver.customer_id)
      .eq("business_id", businessId)
      .maybeSingle();
    if (customerError) throw customerError;
    loyaltyCustomer = customer || null;
    recipientEmail = normalizeEmail(customer?.customer_email);
  }

  if (!recipientEmail) {
    return { ok: true, queued: 0, sent: 0, skipped_reason: "no_recipient_email" };
  }

  const recipientFirstName =
    String(waiver.first_name || "").trim() ||
    String(loyaltyCustomer?.customer_name || "").trim().split(/\s+/)[0] ||
    "";
  const recipientLastName = String(waiver.last_name || "").trim();

  const { data: existingContact, error: contactLookupError } = await supabase
    .from("mail_contacts")
    .select("id,email,first_name,last_name")
    .eq("business_id", businessId)
    .ilike("email", recipientEmail)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (contactLookupError) throw contactLookupError;

  let contact = existingContact;
  if (!contact?.id) {
    const { data: insertedContact, error: insertContactError } = await supabase
      .from("mail_contacts")
      .insert({
        business_id: businessId,
        email: recipientEmail,
        first_name: recipientFirstName || null,
        last_name: recipientLastName || null,
        phone: waiver.phone_number || participant?.phone_number || null,
        subscribed: false,
        source: "waiver_check_in_review",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id,email,first_name,last_name")
      .single();
    if (insertContactError) throw insertContactError;
    contact = insertedContact;
  }

  const { data: automations, error: automationsError } = await supabase
    .from("mail_automations")
    .select(`
        *,
        campaign:mail_campaigns!inner(id,business_id,name,subject_line,content_html,status)
      `)
    .eq("business_id", businessId)
    .eq("automation_type", "custom")
    .eq("is_enabled", true)
    .neq("status", "archived")
    .order("updated_at", { ascending: true })
    .limit(20);

  if (automationsError) throw automationsError;

  const reviewAutomations = (automations || []).filter((automation) => {
    const criteria =
      automation.criteria && typeof automation.criteria === "object"
        ? (automation.criteria as Record<string, unknown>)
        : {};
    return String(criteria.source || "") === "waiver_check_in_review";
  });

  if (reviewAutomations.length === 0) {
    return { ok: true, queued: 0, sent: 0, skipped_reason: "no_enabled_review_automation" };
  }

  const [{ data: settings }, { data: business }] = await Promise.all([
    supabase
      .from("mail_settings")
      .select("from_email,from_name,configuration_set,business_address")
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase
      .from("businesses")
      .select("name, business_address")
      .eq("id", businessId)
      .maybeSingle(),
  ]);

  const fromEmail = String(settings?.from_email || "noreply@tavarios.ca").trim();
  const businessName = resolveBusinessName(business, settings);
  const businessAddress = resolveBusinessAddress(settings, business);

  const { data: inviteRow, error: inviteError } = await supabase.rpc(
    "reputation_create_waiver_checkin_invite",
    {
      p_business_id: businessId,
      p_contact_email: recipientEmail,
      p_check_in_id: checkInId,
      p_metadata: {
        waiver_id: waiverId,
        waiver_participant_id: waiverParticipantId,
        subject_type: subjectType,
        checked_in_name: checkedInName,
        first_name: recipientFirstName || null,
        last_name: recipientLastName || null,
        phone: waiver.phone_number || participant?.phone_number || null,
      },
    },
  );

  if (inviteError || !inviteRow?.ok || !inviteRow?.secret) {
    const inviteReason = inviteRow?.error || inviteError?.message || "invite_create_failed";
    return {
      ok: false,
      queued: 0,
      sent: 0,
      skipped_reason: String(inviteReason),
    };
  }

  const reviewLink = `${resolvePublicSiteUrl()}/reputation/i/${String(inviteRow.secret)}`;
  const eventDate = checkedInAt.slice(0, 10);
  const deliveryKey = buildDeliveryKey({
    checkedInAt,
    waiverId,
    waiverParticipantId,
    subjectType,
  });
  const personalization = {
    first_name: contact.first_name || recipientFirstName,
    last_name: contact.last_name || recipientLastName,
    checked_in_name: checkedInName,
    review_link: reviewLink,
    event_date: eventDate,
    business_name: businessName,
    business_address: businessAddress,
  };

  let queued = 0;
  let sent = 0;
  const skipped: Array<Record<string, unknown>> = [];
  const errors: Array<Record<string, unknown>> = [];

  for (const automation of reviewAutomations) {
    const campaign = automation.campaign || {} as Record<string, unknown>;
    if (!campaign.id || !campaign.subject_line || !campaign.content_html) {
      skipped.push({ automation_id: automation.id, reason: "campaign_missing_content" });
      continue;
    }

    const runPayload = {
      business_id: businessId,
      automation_id: String(automation.id),
      campaign_id: String(campaign.id),
      contact_id: String(contact.id),
      email_address: recipientEmail,
      automation_type: String(automation.automation_type || "custom"),
      delivery_key: deliveryKey,
      trigger_date: eventDate,
      event_date: eventDate,
      context: {
        ...personalization,
        waiver_id: waiverId,
        waiver_participant_id: waiverParticipantId,
        waiver_check_in_id: checkInId,
        email_type: "transactional",
      },
      status: "queued",
      queued_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: runRow, error: runError } = await supabase
      .from("mail_automation_runs")
      .insert(runPayload)
      .select("id")
      .single();

    if (runError) {
      if (String((runError as { code?: unknown })?.code || "") === "23505") {
        skipped.push({ automation_id: automation.id, reason: "already_queued_for_check_in_day" });
        continue;
      }
      throw runError;
    }

    queued += 1;
    const subject = personalize(String(campaign.subject_line || ""), personalization);
    const html = personalize(String(campaign.content_html || ""), personalization);

    try {
      const mailRes = await fetch(`${SUPABASE_URL}/functions/v1/mail-send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          businessId,
          campaignId: String(campaign.id),
          contactId: String(contact.id),
          emailType: "transactional",
          to: recipientEmail,
          fromEmail,
          fromName: businessName,
          subject,
          html,
          text: htmlToText(html),
          configurationSet:
            (typeof settings?.configuration_set === "string" && settings.configuration_set.trim()
              ? settings.configuration_set.trim()
              : undefined),
        }),
      });

      const mailJson = await mailRes.json().catch(() => null);
      if (!mailRes.ok || !mailJson?.ok) {
        throw new Error((mailJson as { error?: string } | null)?.error || `mail-send failed with status ${mailRes.status}`);
      }

      await supabase
        .from("mail_automation_runs")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", String(runRow.id));

      sent += 1;
    } catch (sendError) {
      const errorMessage = getErrorMessage(sendError);
      await supabase
        .from("mail_automation_runs")
        .update({
          status: "failed",
          last_error: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", String(runRow.id));
      errors.push({ automation_id: automation.id, error: errorMessage });
    }
  }

  return {
    ok: errors.length === 0,
    queued,
    sent,
    skipped_items: skipped,
    errors: errors.length ? errors : undefined,
  };
}

async function processWaiverCheckInQueue(supabase: SupabaseClient) {
  const now = new Date().toISOString();
  const { data: due, error: dueErr } = await supabase
    .from("reputation_waiver_checkin_email_queue")
    .select("id, business_id, check_in_id, attempt_count")
    .eq("status", "pending")
    .lte("send_at", now)
    .order("send_at", { ascending: true })
    .limit(30);

  if (dueErr) throw dueErr;

  const out: Array<Record<string, unknown>> = [];
  for (const row of due || []) {
    const { data: lockRow } = await supabase
      .from("reputation_waiver_checkin_email_queue")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!lockRow) continue;

    try {
      const res = await runWaiverCheckInReviewSend(
        supabase,
        String(row.business_id),
        String(row.check_in_id),
      );
      const hardFail = res.ok === false || (res.errors && res.errors.length > 0);
      if (hardFail) {
        const msg = res.errors?.map((e) => String((e as { error?: string }).error || e)).join("; ") || "send_failed";
        const nextAttempt = (row.attempt_count || 0) + 1;
        await supabase
          .from("reputation_waiver_checkin_email_queue")
          .update({
            status: nextAttempt >= 5 ? "failed" : "pending",
            last_error: msg,
            attempt_count: nextAttempt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        out.push({ queue_id: row.id, result: res, will_retry: nextAttempt < 5 });
        continue;
      }
      await supabase
        .from("reputation_waiver_checkin_email_queue")
        .update({
          status: "sent",
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      out.push({ queue_id: row.id, result: res });
    } catch (e) {
      const msg = getErrorMessage(e);
      const nextAttempt = (row.attempt_count || 0) + 1;
      await supabase
        .from("reputation_waiver_checkin_email_queue")
        .update({
          status: nextAttempt >= 5 ? "failed" : "pending",
          last_error: msg,
          attempt_count: nextAttempt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      out.push({ queue_id: row.id, error: msg, will_retry: nextAttempt < 5 });
    }
  }
  return jsonResponse({ ok: true, queue_processed: out.length, items: out });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const raw = (await req.json().catch(() => ({}))) as CheckInPayload;

  try {
    if (String(raw.action || "") === "processQueue") {
      const headerSecret = (req.headers.get("x-waiver-review-queue-secret") || "").trim();
      const { data: secRow, error: secErr } = await supabase
        .from("system_runtime_secrets")
        .select("secret_value")
        .eq("key_name", "waiver_check_in_review_queue_secret")
        .maybeSingle();
      if (secErr) throw secErr;
      const expected = (secRow?.secret_value as string) || "";
      if (!headerSecret || !expected || headerSecret !== expected) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      return await processWaiverCheckInQueue(supabase);
    }

    const businessId = String(raw.businessId || "").trim();
    const checkInId = String(raw.checkInId || "").trim();
    if (!businessId || !checkInId) {
      return jsonResponse({ ok: false, error: "Missing businessId or checkInId" }, 400);
    }

    const authError = await authorizeRequest(req, businessId);
    if (authError) return authError;

    const { data: rep, error: repErr } = await supabase
      .from("reputation_settings")
      .select("waiver_check_in_review_email_enabled, waiver_check_in_review_delay_minutes, waiver_check_in_review_adults_only")
      .eq("business_id", businessId)
      .maybeSingle();
    if (repErr) throw repErr;

    if (rep?.waiver_check_in_review_email_enabled === false) {
      return jsonResponse({ ok: true, skipped: "reputation_waiver_review_email_disabled" });
    }

    const { data: checkIn, error: checkInError } = await supabase
      .from("waiver_participant_check_ins")
      .select("id, business_id, waiver_id, waiver_participant_id, subject_type, display_name, checked_in_at")
      .eq("id", checkInId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (checkInError) throw checkInError;
    if (!checkIn) {
      return jsonResponse({ ok: false, error: "Check-in not found" }, 404);
    }

    if (rep?.waiver_check_in_review_adults_only !== false && String(checkIn.subject_type) === "minor") {
      return jsonResponse({ ok: true, skipped: "adults_only_excludes_minors" });
    }

    const delayMin = Math.max(
      0,
      Math.min(10080, Number(rep?.waiver_check_in_review_delay_minutes ?? 0)),
    );

    if (delayMin > 0) {
      const sendAt = new Date(Date.now() + delayMin * 60_000).toISOString();
      const { data: ins, error: insErr } = await supabase
        .from("reputation_waiver_checkin_email_queue")
        .insert({
          business_id: businessId,
          check_in_id: checkInId,
          send_at: sendAt,
          status: "pending",
        })
        .select("id, send_at")
        .maybeSingle();
      if (insErr) {
        if (String((insErr as { code?: string })?.code) === "23505") {
          return jsonResponse({ ok: true, scheduled: true, duplicate: true, send_at: sendAt });
        }
        throw insErr;
      }
      return jsonResponse({ ok: true, scheduled: true, send_at: ins?.send_at, queue_id: ins?.id });
    }

    try {
      const result = await runWaiverCheckInReviewSend(supabase, businessId, checkInId, raw);
      return jsonResponse(result);
    } catch (sendErr) {
      /* Return 200 so dashboard invoke() does not throw; client uses body.ok / body.error (same as skipped paths). */
      console.error("[mail-waiver-check-in-automation] runWaiverCheckInReviewSend failed", sendErr);
      return jsonResponse(
        {
          ok: false,
          error: getErrorMessage(sendErr),
          queued: 0,
          sent: 0,
        },
        200,
      );
    }
  } catch (error) {
    console.error("[mail-waiver-check-in-automation] failed", error);
    return jsonResponse({ ok: false, error: getErrorMessage(error) }, 500);
  }
});
