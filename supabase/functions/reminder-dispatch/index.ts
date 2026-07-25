import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  type ReminderRow,
  addDaysToDateString,
  computeSendAt,
  firstPlannedDate,
  getDateInTimeZone,
  isSeriesEnded,
  nextPlannedDate,
  parseHolidayHours,
  resolveSendDate,
} from "../_shared/reminderSchedule.ts";
import { buildReminderEmailHtml } from "../_shared/reminderEmail.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const DEFAULT_PUBLIC_SITE_URL = "https://tavarios.ca";
/** How far ahead of now we still fire (cron runs at :05; schedule may be :15). */
const DISPATCH_FUTURE_MS = 15 * 60 * 1000;
/** Catch up pending occurrences up to this age if cron missed or reminder was saved after send time. */
const DISPATCH_CATCHUP_MS = 30 * 24 * 60 * 60 * 1000;
const FROM_EMAIL = "noreply@tavarios.ca";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-reminder-dispatch-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: corsHeaders });

function resolvePublicSiteUrl() {
  const raw = (Deno.env.get("PUBLIC_SITE_URL") || Deno.env.get("VITE_PUBLIC_SITE_URL") || "").trim();
  if (raw) return raw.replace(/\/$/, "");
  return DEFAULT_PUBLIC_SITE_URL;
}

function generateToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function authorizeCronOrService(req: Request, admin: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return true;

  const requestSecret = (req.headers.get("x-reminder-dispatch-cron-secret") || "").trim();
  if (!requestSecret) return false;

  const { data } = await admin
    .from("system_runtime_secrets")
    .select("secret_value")
    .eq("key_name", "reminder_dispatch_cron_secret")
    .maybeSingle();

  return Boolean(data?.secret_value && data.secret_value === requestSecret);
}

/** Dashboard "Send test" — logged-in owner/admin/manager for the reminder's business. */
async function authorizeStaffTestSend(
  req: Request,
  admin: ReturnType<typeof createClient>,
  reminderId: string,
) {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return false;

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData } = await authClient.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) return false;

  const { data: reminder } = await admin
    .from("tavari_reminders")
    .select("business_id")
    .eq("id", reminderId)
    .maybeSingle();
  if (!reminder?.business_id) return false;

  const businessId = reminder.business_id as string;
  const managerRoles = ["owner", "admin", "manager"];

  const { data: bu } = await admin
    .from("business_users")
    .select("role")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();
  if (bu?.role && managerRoles.includes(String(bu.role))) return true;

  const { data: ur } = await admin
    .from("user_roles")
    .select("role")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  return Boolean(ur?.role && managerRoles.includes(String(ur.role)));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const body = await req.json().catch(() => ({}));
  const testReminderId = typeof body.test_reminder_id === "string" ? body.test_reminder_id.trim() : "";
  const testEmail = typeof body.test_email === "string" ? body.test_email.trim().toLowerCase() : "";

  try {
    if (testReminderId && testEmail) {
      const cronOk = await authorizeCronOrService(req, admin);
      const staffOk = cronOk ? true : await authorizeStaffTestSend(req, admin, testReminderId);
      if (!staffOk) return json({ error: "Unauthorized" }, 401);

      const result = await sendTestReminder(admin, testReminderId, testEmail);
      return json({ ok: true, test: result });
    }

    const processReminderId = typeof body.reminder_id === "string" ? body.reminder_id.trim() : "";
    if (processReminderId && body.action === "process") {
      const cronOk = await authorizeCronOrService(req, admin);
      const staffOk = cronOk ? true : await authorizeStaffTestSend(req, admin, processReminderId);
      if (!staffOk) return json({ error: "Unauthorized" }, 401);

      const { data: reminder, error: remErr } = await admin
        .from("tavari_reminders")
        .select("*")
        .eq("id", processReminderId)
        .maybeSingle();
      if (remErr || !reminder) return json({ error: "Reminder not found" }, 404);

      let created = 0;
      if (!reminder.paused) {
        if (await ensureNextOccurrence(admin, reminder as ReminderRow)) created = 1;
      }
      const sent =
        (await processDueOccurrences(admin, reminder as ReminderRow))
        + (await processRepeatOccurrences(admin, reminder as ReminderRow));
      return json({ ok: true, created, sent });
    }

    if (!(await authorizeCronOrService(req, admin))) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { data: reminders, error } = await admin.from("tavari_reminders").select("*");
    if (error) throw error;

    let created = 0;
    let sent = 0;
    const errors: string[] = [];

    for (const reminder of (reminders || []) as ReminderRow[]) {
      try {
        if (!reminder.paused) {
          const didCreate = await ensureNextOccurrence(admin, reminder);
          if (didCreate) created += 1;
        }
        const didSend = await processDueOccurrences(admin, reminder);
        sent += didSend;
        const didRepeat = await processRepeatOccurrences(admin, reminder);
        sent += didRepeat;
      } catch (err) {
        errors.push(`${reminder.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return json({ ok: true, created, sent, errors });
  } catch (err) {
    console.error("[reminder-dispatch]", err);
    return json({ error: err instanceof Error ? err.message : "Dispatch failed" }, 500);
  }
});

async function loadBusinessContext(admin: ReturnType<typeof createClient>, businessId: string) {
  const { data, error } = await admin
    .from("businesses")
    .select("id, name, timezone, holiday_hours")
    .eq("id", businessId)
    .maybeSingle();
  if (error || !data) throw new Error("Business not found");
  const timeZone = String(data.timezone || "America/Toronto");
  return {
    id: data.id as string,
    name: String(data.name || "Your business"),
    timeZone,
    holidays: parseHolidayHours(data.holiday_hours),
  };
}

async function ensureNextOccurrence(admin: ReturnType<typeof createClient>, reminder: ReminderRow) {
  const { data: pendingRows } = await admin
    .from("tavari_reminder_occurrences")
    .select("id")
    .eq("reminder_id", reminder.id)
    .eq("status", "pending")
    .limit(1);

  if ((pendingRows || []).length > 0) return false;

  if (reminder.schedule_type === "once") {
    const { count } = await admin
      .from("tavari_reminder_occurrences")
      .select("id", { count: "exact", head: true })
      .eq("reminder_id", reminder.id);
    if ((count || 0) > 0) return false;
  }

  const ctx = await loadBusinessContext(admin, reminder.business_id);
  const { data: lastRows } = await admin
    .from("tavari_reminder_occurrences")
    .select("planned_date")
    .eq("reminder_id", reminder.id)
    .order("planned_date", { ascending: false })
    .limit(1);

  const lastDate = lastRows?.[0]?.planned_date as string | undefined;
  const plannedRaw = lastDate
    ? nextPlannedDate(reminder, lastDate, ctx.timeZone)
    : firstPlannedDate(reminder, ctx.timeZone);

  if (!plannedRaw || isSeriesEnded(reminder, plannedRaw, ctx.timeZone)) return false;

  const sendDate = resolveSendDate(plannedRaw, {
    sendOnWeekends: reminder.send_on_weekends,
    holidays: ctx.holidays,
    timeZone: ctx.timeZone,
  });
  const sendAt = computeSendAt(sendDate, reminder.schedule_time, ctx.timeZone).toISOString();

  const { error } = await admin.from("tavari_reminder_occurrences").insert({
    reminder_id: reminder.id,
    business_id: reminder.business_id,
    planned_date: plannedRaw,
    send_at: sendAt,
    status: "pending",
  });

  if (error) throw error;
  return true;
}

async function computeNextRepeatAt(admin: ReturnType<typeof createClient>, reminder: ReminderRow) {
  const ctx = await loadBusinessContext(admin, reminder.business_id);
  const today = getDateInTimeZone(new Date(), ctx.timeZone);
  const tomorrow = addDaysToDateString(today, 1);
  const sendDate = resolveSendDate(tomorrow, {
    sendOnWeekends: reminder.send_on_weekends,
    holidays: ctx.holidays,
    timeZone: ctx.timeZone,
  });
  return computeSendAt(sendDate, reminder.schedule_time, ctx.timeZone).toISOString();
}

async function processDueOccurrences(admin: ReturnType<typeof createClient>, reminder: ReminderRow) {
  const now = Date.now();
  const windowStart = new Date(now - DISPATCH_CATCHUP_MS).toISOString();
  const windowEnd = new Date(now + DISPATCH_FUTURE_MS).toISOString();

  const { data: dueRows } = await admin
    .from("tavari_reminder_occurrences")
    .select("*")
    .eq("reminder_id", reminder.id)
    .eq("status", "pending")
    .gte("send_at", windowStart)
    .lte("send_at", windowEnd)
    .order("send_at", { ascending: true });

  let sentCount = 0;
  for (const occurrence of dueRows || []) {
    const alreadySent = await admin
      .from("tavari_reminder_deliveries")
      .select("id")
      .eq("occurrence_id", occurrence.id)
      .eq("status", "sent")
      .limit(1);
    if ((alreadySent.data || []).length > 0) continue;

    await deliverOccurrence(admin, reminder, occurrence);
    sentCount += 1;

    await admin
      .from("tavari_reminder_occurrences")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        next_repeat_at: reminder.repeat_until_complete === false ? null : await computeNextRepeatAt(admin, reminder),
      })
      .eq("id", occurrence.id);

    await admin
      .from("tavari_reminders")
      .update({ occurrences_sent: (reminder.occurrences_sent || 0) + 1 })
      .eq("id", reminder.id);

    reminder.occurrences_sent = (reminder.occurrences_sent || 0) + 1;

    if (!reminder.paused && reminder.schedule_type !== "once") {
      await ensureNextOccurrence(admin, reminder);
    }
  }

  return sentCount;
}

async function processRepeatOccurrences(admin: ReturnType<typeof createClient>, reminder: ReminderRow) {
  if (reminder.repeat_until_complete === false) return 0;

  const now = Date.now();
  const windowStart = new Date(now - DISPATCH_CATCHUP_MS).toISOString();
  const windowEnd = new Date(now + DISPATCH_FUTURE_MS).toISOString();

  const { data: dueRows } = await admin
    .from("tavari_reminder_occurrences")
    .select("*")
    .eq("reminder_id", reminder.id)
    .eq("status", "sent")
    .not("next_repeat_at", "is", null)
    .gte("next_repeat_at", windowStart)
    .lte("next_repeat_at", windowEnd)
    .order("next_repeat_at", { ascending: true });

  let sentCount = 0;
  for (const occurrence of dueRows || []) {
    const repeatCount = Number(occurrence.repeat_count || 0);
    if (reminder.repeat_max != null && repeatCount >= reminder.repeat_max) {
      await admin
        .from("tavari_reminder_occurrences")
        .update({ next_repeat_at: null })
        .eq("id", occurrence.id);
      continue;
    }

    await deliverOccurrence(admin, reminder, occurrence);
    sentCount += 1;

    await admin
      .from("tavari_reminder_occurrences")
      .update({
        repeat_count: repeatCount + 1,
        sent_at: new Date().toISOString(),
        next_repeat_at: await computeNextRepeatAt(admin, reminder),
      })
      .eq("id", occurrence.id);
  }

  return sentCount;
}

async function deliverOccurrence(
  admin: ReturnType<typeof createClient>,
  reminder: ReminderRow & { title: string; body: string; custom_links?: unknown; manual_emails?: string[] },
  occurrence: { id: string; business_id: string },
) {
  const ctx = await loadBusinessContext(admin, reminder.business_id);
  const siteUrl = resolvePublicSiteUrl();

  const { data: staffRows } = await admin
    .from("tavari_reminder_staff_recipients")
    .select("user_id, users:user_id(id, email, full_name)")
    .eq("reminder_id", reminder.id);

  const emailTargets: Array<{ userId?: string; email: string }> = [];

  for (const row of staffRows || []) {
    const user = Array.isArray(row.users) ? row.users[0] : row.users;
    const email = String((user as { email?: string })?.email || "").trim().toLowerCase();
    if (email) emailTargets.push({ userId: row.user_id as string, email });
  }

  for (const raw of reminder.manual_emails || []) {
    const email = String(raw || "").trim().toLowerCase();
    if (email && !emailTargets.some((t) => t.email === email)) {
      emailTargets.push({ email });
    }
  }

  const customLinks = Array.isArray(reminder.custom_links) ? reminder.custom_links : [];

  for (const target of emailTargets) {
    await sendEmailForRecipient(admin, {
      reminder,
      occurrence,
      businessName: ctx.name,
      businessId: ctx.id,
      to: target.email,
      userId: target.userId,
      siteUrl,
      customLinks,
    });
  }

  for (const row of staffRows || []) {
    await admin.from("tavari_reminder_deliveries").insert({
      occurrence_id: occurrence.id,
      reminder_id: reminder.id,
      business_id: reminder.business_id,
      channel: "portal",
      recipient_user_id: row.user_id,
      status: "sent",
    });
  }
}

async function sendEmailForRecipient(
  admin: ReturnType<typeof createClient>,
  input: {
    reminder: ReminderRow & { title: string; body: string };
    occurrence: { id: string; business_id: string };
    businessName: string;
    businessId: string;
    to: string;
    userId?: string;
    siteUrl: string;
    customLinks: unknown[];
  },
) {
  const completeToken = generateToken();
  const snoozeToken = generateToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: delivery, error: deliveryError } = await admin
    .from("tavari_reminder_deliveries")
    .insert({
      occurrence_id: input.occurrence.id,
      reminder_id: input.reminder.id,
      business_id: input.businessId,
      channel: "email",
      recipient_user_id: input.userId || null,
      recipient_email: input.to,
      status: "pending",
    })
    .select("id")
    .single();

  if (deliveryError) throw deliveryError;

  await admin.from("tavari_reminder_action_tokens").insert([
    {
      token: completeToken,
      occurrence_id: input.occurrence.id,
      delivery_id: delivery.id,
      recipient_user_id: input.userId || null,
      recipient_email: input.to,
      action: "complete",
      expires_at: expiresAt,
    },
    {
      token: snoozeToken,
      occurrence_id: input.occurrence.id,
      delivery_id: delivery.id,
      recipient_user_id: input.userId || null,
      recipient_email: input.to,
      action: "snooze",
      expires_at: expiresAt,
    },
  ]);

  const actionBase = `${input.siteUrl}/reminder/action`;
  const buttons = [
    { label: "Complete", url: `${actionBase}?token=${completeToken}&action=complete` },
    { label: "Remind Tomorrow", url: `${actionBase}?token=${snoozeToken}&action=snooze` },
    ...(Array.isArray(input.customLinks)
      ? input.customLinks
        .filter((link) => link && typeof link === "object" && "label" in link && "url" in link)
        .map((link) => ({
          label: String((link as { label: string }).label),
          url: String((link as { url: string }).url),
        }))
      : []),
  ];

  const html = buildReminderEmailHtml({
    businessName: input.businessName,
    title: input.reminder.title,
    body: input.reminder.body,
    buttons,
  });

  const text = [
    input.reminder.title,
    "",
    input.reminder.body,
    "",
    ...buttons.map((b) => `${b.label}: ${b.url}`),
    "",
    `Sent by ${input.businessName} through Tavari Reminder.`,
  ].join("\n");

  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      businessId: input.businessId,
      campaignId: `reminder-${input.reminder.id}-${input.occurrence.id}-${delivery.id}`,
      emailType: "transactional",
      to: input.to,
      fromEmail: FROM_EMAIL,
      fromName: `Reminder - ${input.businessName}`,
      subject: input.reminder.title,
      html,
      text,
    }),
  });

  const payload = await response.json().catch(() => null);
  const ok = response.ok && payload?.ok === true;

  await admin
    .from("tavari_reminder_deliveries")
    .update({
      status: ok ? "sent" : "failed",
      mail_message_id: payload?.messageId || null,
      error_message: ok ? null : String(payload?.error || `HTTP ${response.status}`),
    })
    .eq("id", delivery.id);

  if (!ok) throw new Error(String(payload?.error || "mail-send failed"));
}

async function sendTestReminder(
  admin: ReturnType<typeof createClient>,
  reminderId: string,
  testEmail: string,
) {
  const { data: reminder, error } = await admin
    .from("tavari_reminders")
    .select("*")
    .eq("id", reminderId)
    .maybeSingle();
  if (error || !reminder) throw new Error("Reminder not found");

  const ctx = await loadBusinessContext(admin, reminder.business_id);
  const today = getDateInTimeZone(new Date(), ctx.timeZone);
  const sendDate = resolveSendDate(today, {
    sendOnWeekends: reminder.send_on_weekends,
    holidays: ctx.holidays,
    timeZone: ctx.timeZone,
  });

  const { data: occurrence, error: occError } = await admin
    .from("tavari_reminder_occurrences")
    .insert({
      reminder_id: reminder.id,
      business_id: reminder.business_id,
      planned_date: sendDate,
      send_at: new Date().toISOString(),
      status: "pending",
    })
    .select("*")
    .single();
  if (occError) throw occError;

  const siteUrl = resolvePublicSiteUrl();
  const customLinks = Array.isArray(reminder.custom_links) ? reminder.custom_links : [];

  await sendEmailForRecipient(admin, {
    reminder: reminder as ReminderRow & { title: string; body: string },
    occurrence,
    businessName: ctx.name,
    businessId: ctx.id,
    to: testEmail,
    siteUrl,
    customLinks,
  });

  await admin.from("tavari_reminder_deliveries").insert({
    occurrence_id: occurrence.id,
    reminder_id: reminder.id,
    business_id: reminder.business_id,
    channel: "portal",
    recipient_user_id: null,
    status: "sent",
  });

  await admin
    .from("tavari_reminder_occurrences")
    .update({ status: "cancelled", sent_at: new Date().toISOString(), next_repeat_at: null })
    .eq("id", occurrence.id);

  return { occurrenceId: occurrence.id, to: testEmail };
}
