import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
  PUBLIC_SITE_URL,
  SITE_URL,
  VITE_APP_URL,
} = Deno.env.toObject();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_PUBLIC_SITE_URL = "https://tavarios.ca";

type RolloutAction = "start" | "approve_next_batch" | "stop";

type RolloutPayload = {
  action?: RolloutAction;
  businessId?: string;
  campaignId?: string;
  rolloutId?: string;
  reportEmail?: string;
  waitMinutes?: number;
  batchSizes?: number[];
  contactIds?: string[];
  stopReason?: string;
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
    normalizePublicSiteUrl(PUBLIC_SITE_URL) ||
    normalizePublicSiteUrl(SITE_URL) ||
    normalizePublicSiteUrl(VITE_APP_URL) ||
    DEFAULT_PUBLIC_SITE_URL
  );
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function sanitizeBatchSizes(values: number[] | undefined) {
  const fallback = [50, 150, 300, 600];
  const parsed = Array.isArray(values)
    ? values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0 && value <= 100000)
        .map((value) => Math.floor(value))
    : fallback;

  return parsed.length > 0 ? parsed : fallback;
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

  let output = String(htmlContent || "");
  output = replaceMergeTokens(output, ["{{First Name}}", "{{FirstName}}", "{FirstName}"], firstName);
  output = replaceMergeTokens(output, ["{{Last Name}}", "{{LastName}}", "{LastName}"], lastName);
  output = replaceMergeTokens(output, ["{{Full Name}}", "{{FullName}}", "{FullName}"], fullName);
  output = replaceMergeTokens(output, ["{{Email Address}}", "{{Email}}", "{Email}"], email);
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
  return output;
}

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !SUPABASE_ANON_KEY) {
    return { user: null, error: "Unauthorized" };
  }

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const {
    data: { user },
    error,
  } = await authClient.auth.getUser();

  if (error || !user?.id) {
    return { user: null, error: "Unauthorized" };
  }

  return { user, error: null };
}

async function ensureBusinessAccess(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  userId: string,
) {
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

async function invokeQueueProcessor(businessId: string, batchSize: number) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/mail-process-queue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      businessId,
      batchSize: Math.max(1, Math.min(Number(batchSize) || 50, 500)),
    }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error || `mail-process-queue failed with status ${response.status}`);
  }
  return body || {};
}

async function getActiveRollout(
  supabase: ReturnType<typeof createClient>,
  campaignId: string,
) {
  const { data, error } = await supabase
    .from("mail_campaign_rollouts")
    .select("*")
    .eq("campaign_id", campaignId)
    .in("status", ["waiting_for_report", "awaiting_approval"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function getRequestedBatchSize(
  batchSizes: number[],
  batchNumber: number,
  previousRequestedSize: number | null,
) {
  if (batchNumber <= batchSizes.length) {
    return batchSizes[batchNumber - 1];
  }

  const base = previousRequestedSize || batchSizes[batchSizes.length - 1] || 600;
  return Math.max(base * 2, 1);
}

async function selectNextEligibleCandidates(
  supabase: ReturnType<typeof createClient>,
  rolloutId: string,
  requestedSize: number,
) {
  const { data: candidateRows, error: candidatesError } = await supabase
    .from("mail_campaign_rollout_candidates")
    .select("contact_id,email_address,sort_order")
    .eq("rollout_id", rolloutId)
    .order("sort_order", { ascending: true });

  if (candidatesError) throw candidatesError;

  const { data: existingRecipients, error: recipientsError } = await supabase
    .from("mail_campaign_rollout_recipients")
    .select("contact_id")
    .eq("rollout_id", rolloutId);

  if (recipientsError) throw recipientsError;

  const recipientIds = new Set((existingRecipients || []).map((row) => String(row.contact_id)));
  const remainingCandidates = (candidateRows || []).filter(
    (row) => !recipientIds.has(String(row.contact_id)),
  );

  if (remainingCandidates.length === 0) {
    return [];
  }

  const contactIds = remainingCandidates.map((row) => String(row.contact_id));
  const contactRows: Record<string, Record<string, unknown>> = {};

  for (let index = 0; index < contactIds.length; index += 1000) {
    const chunk = contactIds.slice(index, index + 1000);
    const { data, error } = await supabase
      .from("mail_contacts")
      .select("id,email,first_name,last_name,subscribed,consent_method,consent_timestamp")
      .in("id", chunk);

    if (error) throw error;

    for (const row of data || []) {
      contactRows[String(row.id)] = row;
    }
  }

  const selected = [];
  for (const candidate of remainingCandidates) {
    const contact = contactRows[String(candidate.contact_id)];
    if (!contact) continue;
    if (!contact.subscribed) continue;
    if (!contact.consent_method || !contact.consent_timestamp) continue;
    if (!contact.email) continue;

    selected.push(contact);
    if (selected.length >= requestedSize) {
      break;
    }
  }

  return selected;
}

async function createBatchAndQueueRecipients(
  supabase: ReturnType<typeof createClient>,
  rollout: Record<string, unknown>,
  campaign: Record<string, unknown>,
  approvingUserId: string | null,
) {
  const existingBatchNumber = Number(rollout.current_batch_number || 0);

  const { data: latestBatch, error: latestBatchError } = await supabase
    .from("mail_campaign_rollout_batches")
    .select("batch_number,requested_size")
    .eq("rollout_id", String(rollout.id))
    .order("batch_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestBatchError) throw latestBatchError;

  const nextBatchNumber = existingBatchNumber > 0 ? existingBatchNumber + 1 : 1;
  const batchSizes = sanitizeBatchSizes(
    Array.isArray(rollout.batch_sizes) ? rollout.batch_sizes.map((value) => Number(value)) : undefined,
  );
  const requestedSize = getRequestedBatchSize(
    batchSizes,
    nextBatchNumber,
    latestBatch?.requested_size ? Number(latestBatch.requested_size) : null,
  );

  const selectedContacts = await selectNextEligibleCandidates(
    supabase,
    String(rollout.id),
    requestedSize,
  );

  if (selectedContacts.length === 0) {
    await supabase
      .from("mail_campaign_rollouts")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", String(rollout.id));

    return {
      rolloutCompleted: true,
      batch: null,
      queueRun: null,
      selectedContacts: [],
    };
  }

  const nowIso = new Date().toISOString();
  const reportWaitMinutes = Number(rollout.report_wait_minutes || 60);
  const reportDueAt = new Date(Date.now() + reportWaitMinutes * 60 * 1000).toISOString();

  const { data: batch, error: batchError } = await supabase
    .from("mail_campaign_rollout_batches")
    .insert({
      rollout_id: rollout.id,
      campaign_id: rollout.campaign_id,
      business_id: rollout.business_id,
      batch_number: nextBatchNumber,
      requested_size: requestedSize,
      actual_size: selectedContacts.length,
      status: "awaiting_report",
      report_wait_minutes: reportWaitMinutes,
      scheduled_report_at: reportDueAt,
      report_email: rollout.report_email,
      approved_at: approvingUserId ? nowIso : null,
      approved_by_user_id: approvingUserId,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("*")
    .single();

  if (batchError) throw batchError;

  const recipientRows = selectedContacts.map((contact) => ({
    rollout_id: rollout.id,
    batch_id: batch.id,
    campaign_id: rollout.campaign_id,
    business_id: rollout.business_id,
    contact_id: contact.id,
    email_address: contact.email,
  }));

  const { error: recipientInsertError } = await supabase
    .from("mail_campaign_rollout_recipients")
    .insert(recipientRows);

  if (recipientInsertError) throw recipientInsertError;

  const queueRows = selectedContacts.map((contact) => ({
    campaign_id: rollout.campaign_id,
    contact_id: contact.id,
    email_address: contact.email,
    status: "queued",
    priority: 5,
    scheduled_for: nowIso,
    business_id: rollout.business_id,
    personalized_content: personalizeEmailContent(String(campaign.content_html || ""), contact, {
      business_id: rollout.business_id,
    }),
    rollout_id: rollout.id,
    rollout_batch_id: batch.id,
  }));

  const { error: queueInsertError } = await supabase
    .from("mail_sending_queue")
    .insert(queueRows);

  if (queueInsertError) throw queueInsertError;

  const totalSentRecipients =
    Number(rollout.total_sent_recipients || 0) + selectedContacts.length;

  const { error: rolloutUpdateError } = await supabase
    .from("mail_campaign_rollouts")
    .update({
      status: "waiting_for_report",
      current_batch_number: nextBatchNumber,
      total_sent_recipients: totalSentRecipients,
      updated_at: nowIso,
    })
    .eq("id", String(rollout.id));

  if (rolloutUpdateError) throw rolloutUpdateError;

  await supabase
    .from("mail_campaigns")
    .update({
      status: "sending",
      total_recipients: Number(rollout.total_candidate_recipients || selectedContacts.length),
      updated_at: nowIso,
    })
    .eq("id", String(rollout.campaign_id))
    .eq("business_id", String(rollout.business_id));

  const queueRun = await invokeQueueProcessor(String(rollout.business_id), selectedContacts.length);

  return {
    rolloutCompleted: false,
    batch,
    queueRun,
    selectedContacts,
  };
}

async function startRollout(
  supabase: ReturnType<typeof createClient>,
  payload: RolloutPayload,
  user: { id: string; email?: string | null },
) {
  const businessId = String(payload.businessId || "").trim();
  const campaignId = String(payload.campaignId || "").trim();
  const reportEmail = String(payload.reportEmail || user.email || "").trim().toLowerCase();
  const contactIds = uniqueStrings(Array.isArray(payload.contactIds) ? payload.contactIds : []);
  const waitMinutes = Math.min(Math.max(Number(payload.waitMinutes) || 60, 5), 1440);
  const batchSizes = sanitizeBatchSizes(payload.batchSizes);

  if (!businessId || !campaignId || !reportEmail || contactIds.length === 0) {
    return jsonResponse({ ok: false, error: "Missing required rollout fields" }, 400);
  }

  if (!isValidEmail(reportEmail)) {
    return jsonResponse({ ok: false, error: "Invalid report email" }, 400);
  }

  const hasAccess = await ensureBusinessAccess(supabase, businessId, user.id);
  if (!hasAccess) {
    return jsonResponse({ ok: false, error: "Access denied to this business" }, 403);
  }

  const activeRollout = await getActiveRollout(supabase, campaignId);
  if (activeRollout?.id) {
    return jsonResponse({ ok: false, error: "This campaign already has an active rollout" }, 409);
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("mail_campaigns")
    .select("id,business_id,name,subject_line,content_html")
    .eq("id", campaignId)
    .eq("business_id", businessId)
    .single();

  if (campaignError || !campaign) {
    return jsonResponse({ ok: false, error: "Campaign not found" }, 404);
  }

  const { data: previouslySentRows, error: sentRowsError } = await supabase
    .from("mail_campaign_sends")
    .select("contact_id")
    .eq("campaign_id", campaignId)
    .not("contact_id", "is", null);

  if (sentRowsError) throw sentRowsError;

  const alreadySentContactIds = new Set(
    (previouslySentRows || []).map((row) => String(row.contact_id)),
  );

  const filteredInputIds = contactIds.filter((contactId) => !alreadySentContactIds.has(contactId));
  if (filteredInputIds.length === 0) {
    return jsonResponse({ ok: false, error: "All selected contacts were already sent this campaign" }, 409);
  }

  const { data: contactRows, error: contactsError } = await supabase
    .from("mail_contacts")
    .select("id,email,subscribed,consent_method,consent_timestamp")
    .in("id", filteredInputIds)
    .eq("business_id", businessId);

  if (contactsError) throw contactsError;

  const contactMap = new Map(
    (contactRows || []).map((row) => [String(row.id), row]),
  );

  const orderedCandidates = filteredInputIds
    .map((contactId) => contactMap.get(contactId))
    .filter((row) => row?.email && row?.subscribed && row?.consent_method && row?.consent_timestamp);

  if (orderedCandidates.length === 0) {
    return jsonResponse({ ok: false, error: "No eligible contacts remain for this rollout" }, 409);
  }

  const nowIso = new Date().toISOString();
  const { data: rollout, error: rolloutError } = await supabase
    .from("mail_campaign_rollouts")
    .insert({
      campaign_id: campaignId,
      business_id: businessId,
      status: "waiting_for_report",
      report_email: reportEmail,
      report_wait_minutes: waitMinutes,
      batch_sizes: batchSizes,
      total_candidate_recipients: orderedCandidates.length,
      total_sent_recipients: 0,
      started_by_user_id: user.id,
      started_by_email: user.email || reportEmail,
      current_batch_number: 0,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("*")
    .single();

  if (rolloutError) throw rolloutError;

  const candidateRows = orderedCandidates.map((contact, index) => ({
    rollout_id: rollout.id,
    campaign_id: campaignId,
    business_id: businessId,
    contact_id: contact.id,
    email_address: contact.email,
    sort_order: index,
  }));

  const { error: candidateInsertError } = await supabase
    .from("mail_campaign_rollout_candidates")
    .insert(candidateRows);

  if (candidateInsertError) throw candidateInsertError;

  const batchResult = await createBatchAndQueueRecipients(
    supabase,
    rollout,
    campaign,
    user.id,
  );

  return jsonResponse({
    ok: true,
    rolloutId: rollout.id,
    rollout,
    batch: batchResult.batch,
    queueRun: batchResult.queueRun,
    approvalUrl: `${resolvePublicSiteUrl()}/dashboard/mail/sender/${campaignId}?rolloutId=${rollout.id}`,
  });
}

async function approveNextBatch(
  supabase: ReturnType<typeof createClient>,
  payload: RolloutPayload,
  user: { id: string; email?: string | null },
) {
  const rolloutId = String(payload.rolloutId || "").trim();
  const campaignId = String(payload.campaignId || "").trim();
  const businessId = String(payload.businessId || "").trim();

  if (!rolloutId || !campaignId || !businessId) {
    return jsonResponse({ ok: false, error: "Missing rollout approval fields" }, 400);
  }

  const hasAccess = await ensureBusinessAccess(supabase, businessId, user.id);
  if (!hasAccess) {
    return jsonResponse({ ok: false, error: "Access denied to this business" }, 403);
  }

  const { data: rollout, error: rolloutError } = await supabase
    .from("mail_campaign_rollouts")
    .select("*")
    .eq("id", rolloutId)
    .eq("campaign_id", campaignId)
    .eq("business_id", businessId)
    .single();

  if (rolloutError || !rollout) {
    return jsonResponse({ ok: false, error: "Rollout not found" }, 404);
  }

  if (rollout.status !== "awaiting_approval") {
    return jsonResponse({ ok: false, error: "Rollout is not waiting for approval" }, 409);
  }

  const { data: latestBatch, error: latestBatchError } = await supabase
    .from("mail_campaign_rollout_batches")
    .select("*")
    .eq("rollout_id", rolloutId)
    .order("batch_number", { ascending: false })
    .limit(1)
    .single();

  if (latestBatchError || !latestBatch) {
    return jsonResponse({ ok: false, error: "No rollout batch found to approve" }, 404);
  }

  await supabase
    .from("mail_campaign_rollout_batches")
    .update({
      status: "completed",
      approved_at: new Date().toISOString(),
      approved_by_user_id: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", latestBatch.id);

  const { data: campaign, error: campaignError } = await supabase
    .from("mail_campaigns")
    .select("id,business_id,name,subject_line,content_html")
    .eq("id", campaignId)
    .eq("business_id", businessId)
    .single();

  if (campaignError || !campaign) {
    return jsonResponse({ ok: false, error: "Campaign not found" }, 404);
  }

  const batchResult = await createBatchAndQueueRecipients(
    supabase,
    rollout,
    campaign,
    user.id,
  );

  if (batchResult.rolloutCompleted) {
    return jsonResponse({
      ok: true,
      completed: true,
      message: "All rollout recipients have been processed.",
    });
  }

  return jsonResponse({
    ok: true,
    completed: false,
    batch: batchResult.batch,
    queueRun: batchResult.queueRun,
  });
}

async function stopRollout(
  supabase: ReturnType<typeof createClient>,
  payload: RolloutPayload,
  user: { id: string; email?: string | null },
) {
  const rolloutId = String(payload.rolloutId || "").trim();
  const businessId = String(payload.businessId || "").trim();

  if (!rolloutId || !businessId) {
    return jsonResponse({ ok: false, error: "Missing rollout stop fields" }, 400);
  }

  const hasAccess = await ensureBusinessAccess(supabase, businessId, user.id);
  if (!hasAccess) {
    return jsonResponse({ ok: false, error: "Access denied to this business" }, 403);
  }

  const nowIso = new Date().toISOString();
  const stopReason = String(payload.stopReason || "Stopped by user").trim();

  const { error } = await supabase
    .from("mail_campaign_rollouts")
    .update({
      status: "stopped",
      stopped_at: nowIso,
      stop_reason: stopReason,
      updated_at: nowIso,
    })
    .eq("id", rolloutId)
    .eq("business_id", businessId)
    .in("status", ["waiting_for_report", "awaiting_approval"]);

  if (error) throw error;

  await supabase
    .from("mail_campaign_rollout_batches")
    .update({
      status: "stopped",
      updated_at: nowIso,
    })
    .eq("rollout_id", rolloutId)
    .in("status", ["awaiting_report", "awaiting_approval"]);

  return jsonResponse({ ok: true });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { user, error: authError } = await getAuthenticatedUser(req);
    if (authError || !user) {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }

    const payload = (await req.json().catch(() => ({}))) as RolloutPayload;
    const action = String(payload.action || "").trim() as RolloutAction;

    switch (action) {
      case "start":
        return await startRollout(supabase, payload, user);
      case "approve_next_batch":
        return await approveNextBatch(supabase, payload, user);
      case "stop":
        return await stopRollout(supabase, payload, user);
      default:
        return jsonResponse({ ok: false, error: "Unsupported rollout action" }, 400);
    }
  } catch (error) {
    return jsonResponse({ ok: false, error: getErrorMessage(error) }, 500);
  }
});
