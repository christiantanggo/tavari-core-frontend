import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  addDaysToDateString,
  computeSendAt,
  getDateInTimeZone,
  parseHolidayHours,
  resolveSendDate,
} from "../_shared/reminderSchedule.ts";
import {
  buildReminderActionPageHtml,
  type ReminderActionPageVariant,
} from "../_shared/reminderActionPage.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

const htmlHeaders = { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" };

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: corsHeaders });

type ActionPageResult = {
  ok: boolean;
  title: string;
  message: string;
  variant?: ReminderActionPageVariant;
  reminderTitle?: string;
  detail?: string;
};

function resultPage(result: ActionPageResult) {
  const html = buildReminderActionPageHtml({
    title: result.title,
    message: result.message,
    variant: result.variant ?? (result.ok ? "success" : "error"),
    reminderTitle: result.reminderTitle,
    detail: result.detail,
  });
  return new Response(html, {
    status: result.ok ? 200 : 400,
    headers: htmlHeaders,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const token = (url.searchParams.get("token") || "").trim();
      const action = (url.searchParams.get("action") || "").trim();
      if (!token) {
        return resultPage({
          ok: false,
          title: "Missing link",
          message: "This reminder link is invalid.",
          variant: "error",
        });
      }
      const result = await applyAction(admin, { token, action, source: "email" });
      return resultPage(result);
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await req.json().catch(() => ({}));
    const portalAction = String(body.action || "").trim();

    if (portalAction === "complete" || portalAction === "snooze" || portalAction === "uncomplete") {
      const authHeader = req.headers.get("Authorization") || "";
      if (!authHeader) return json({ error: "Unauthorized" }, 401);

      const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data: authData } = await authClient.auth.getUser();
      if (!authData.user?.id) return json({ error: "Unauthorized" }, 401);

      const occurrenceId = String(body.occurrence_id || "").trim();
      if (!occurrenceId) return json({ error: "Missing occurrence_id" }, 400);

      const result = await applyPortalAction(admin, {
        occurrenceId,
        action: portalAction as "complete" | "snooze" | "uncomplete",
        userId: authData.user.id,
      });
      return json(result);
    }

    return json({ error: "Invalid action" }, 400);
  } catch (err) {
    console.error("[reminder-action]", err);
    if (req.method === "GET") {
      return resultPage({
        ok: false,
        title: "Something went wrong",
        message: err instanceof Error ? err.message : "Unexpected error",
        variant: "error",
      });
    }
    return json({ error: err instanceof Error ? err.message : "Unexpected error" }, 500);
  }
});

async function applyAction(
  admin: ReturnType<typeof createClient>,
  input: { token: string; action: string; source: string },
): Promise<ActionPageResult> {
  const { data: tokenRow, error } = await admin
    .from("tavari_reminder_action_tokens")
    .select("*")
    .eq("token", input.token)
    .maybeSingle();

  if (error || !tokenRow) {
    return {
      ok: false,
      variant: "error",
      title: "Invalid link",
      message: "This reminder link is not valid or has expired.",
    };
  }

  if (tokenRow.used_at) {
    return {
      ok: true,
      variant: "warning",
      title: "Already recorded",
      message: "This action was already processed. Thank you.",
    };
  }

  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return {
      ok: false,
      variant: "error",
      title: "Link expired",
      message: "This reminder link has expired.",
    };
  }

  const expectedAction = tokenRow.action;
  if (input.action && input.action !== expectedAction) {
    return {
      ok: false,
      variant: "error",
      title: "Invalid action",
      message: "The action in this link does not match.",
    };
  }

  const occurrenceId = tokenRow.occurrence_id as string;
  const { data: occurrence } = await admin
    .from("tavari_reminder_occurrences")
    .select("*, tavari_reminders(*)")
    .eq("id", occurrenceId)
    .maybeSingle();

  if (!occurrence) {
    return {
      ok: false,
      variant: "error",
      title: "Not found",
      message: "This reminder could not be found.",
    };
  }

  const reminder = occurrence.tavari_reminders;
  if (!reminder) {
    return {
      ok: false,
      variant: "error",
      title: "Not found",
      message: "Reminder configuration missing.",
    };
  }

  const reminderTitle = String(reminder.title || "");

  if (expectedAction === "complete") {
    await admin
      .from("tavari_reminder_occurrences")
      .update({ status: "completed", completed_at: new Date().toISOString(), next_repeat_at: null })
      .eq("id", occurrenceId);

    await admin
      .from("tavari_reminder_action_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("occurrence_id", occurrenceId);

    return {
      ok: true,
      variant: "success",
      title: "Marked complete",
      reminderTitle,
      message:
        "This reminder occurrence has been marked complete. You will not receive further reminders for this occurrence.",
    };
  }

  if (expectedAction === "snooze") {
    const snoozeMax = reminder.snooze_max;
    const snoozeCount = Number(occurrence.snooze_count || 0);
    if (snoozeMax != null && snoozeCount >= snoozeMax) {
      return {
        ok: false,
        variant: "warning",
        title: "Snooze limit reached",
        reminderTitle,
        message: "You have reached the maximum number of reminders for this occurrence.",
      };
    }

    const { data: business } = await admin
      .from("businesses")
      .select("timezone, holiday_hours")
      .eq("id", reminder.business_id)
      .maybeSingle();

    const timeZone = String(business?.timezone || "America/Toronto");
    const holidays = parseHolidayHours(business?.holiday_hours);
    const today = getDateInTimeZone(new Date(), timeZone);
    const tomorrow = addDaysToDateString(today, 1);
    const sendDate = resolveSendDate(tomorrow, {
      sendOnWeekends: reminder.send_on_weekends,
      holidays,
      timeZone,
    });
    const sendAt = computeSendAt(sendDate, reminder.schedule_time, timeZone).toISOString();

    await admin
      .from("tavari_reminder_occurrences")
      .update({
        status: "pending",
        send_at: sendAt,
        snooze_count: snoozeCount + 1,
        sent_at: null,
        next_repeat_at: null,
      })
      .eq("id", occurrenceId);

    await admin
      .from("tavari_reminder_deliveries")
      .delete()
      .eq("occurrence_id", occurrenceId);

    await admin
      .from("tavari_reminder_action_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("occurrence_id", occurrenceId);

    return {
      ok: true,
      variant: "success",
      title: "Reminder scheduled",
      reminderTitle,
      message: "We will send you another reminder at the scheduled time below.",
      detail: `${sendDate} at ${reminder.schedule_time}`,
    };
  }

  return {
    ok: false,
    variant: "error",
    title: "Unknown action",
    message: "This action is not supported.",
  };
}

async function applyPortalAction(
  admin: ReturnType<typeof createClient>,
  input: { occurrenceId: string; action: "complete" | "snooze" | "uncomplete"; userId: string },
) {
  const { data: occurrence } = await admin
    .from("tavari_reminder_occurrences")
    .select("*, tavari_reminders(*)")
    .eq("id", input.occurrenceId)
    .maybeSingle();

  if (!occurrence?.tavari_reminders) {
    return { ok: false, error: "Occurrence not found" };
  }

  const reminder = occurrence.tavari_reminders;

  const { data: recipient } = await admin
    .from("tavari_reminder_staff_recipients")
    .select("id")
    .eq("reminder_id", reminder.id)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (!recipient && !(await hasBusinessManagerAccess(admin, input.userId, reminder.business_id))) {
    return { ok: false, error: "You are not a recipient of this reminder" };
  }

  const hasManagerAccess = await hasBusinessManagerAccess(admin, input.userId, reminder.business_id);

  if (input.action === "complete") {
    await admin
      .from("tavari_reminder_occurrences")
      .update({ status: "completed", completed_at: new Date().toISOString(), next_repeat_at: null })
      .eq("id", input.occurrenceId);

    return { ok: true, message: "Marked complete" };
  }

  if (input.action === "uncomplete") {
    if (!hasManagerAccess) {
      return { ok: false, error: "You do not have permission to cancel completions" };
    }

    if (occurrence.status !== "completed") {
      return { ok: false, error: "Only completed reminders can be reopened" };
    }

    let nextRepeatAt: string | null = null;
    if (reminder.repeat_until_complete !== false) {
      const { data: business } = await admin
        .from("businesses")
        .select("timezone, holiday_hours")
        .eq("id", reminder.business_id)
        .maybeSingle();

      const timeZone = String(business?.timezone || "America/Toronto");
      const holidays = parseHolidayHours(business?.holiday_hours);
      const today = getDateInTimeZone(new Date(), timeZone);
      const tomorrow = addDaysToDateString(today, 1);
      const sendDate = resolveSendDate(tomorrow, {
        sendOnWeekends: reminder.send_on_weekends,
        holidays,
        timeZone,
      });
      nextRepeatAt = computeSendAt(sendDate, reminder.schedule_time, timeZone).toISOString();
    }

    await admin
      .from("tavari_reminder_occurrences")
      .update({
        status: "sent",
        completed_at: null,
        next_repeat_at: nextRepeatAt,
      })
      .eq("id", input.occurrenceId);

    return { ok: true, message: "Completion cancelled" };
  }

  const snoozeMax = reminder.snooze_max;
  const snoozeCount = Number(occurrence.snooze_count || 0);
  if (snoozeMax != null && snoozeCount >= snoozeMax) {
    return { ok: false, error: "Snooze limit reached for this occurrence" };
  }

  const { data: business } = await admin
    .from("businesses")
    .select("timezone, holiday_hours")
    .eq("id", reminder.business_id)
    .maybeSingle();

  const timeZone = String(business?.timezone || "America/Toronto");
  const holidays = parseHolidayHours(business?.holiday_hours);
  const today = getDateInTimeZone(new Date(), timeZone);
  const tomorrow = addDaysToDateString(today, 1);
  const sendDate = resolveSendDate(tomorrow, {
    sendOnWeekends: reminder.send_on_weekends,
    holidays,
    timeZone,
  });
  const sendAt = computeSendAt(sendDate, reminder.schedule_time, timeZone).toISOString();

  await admin
    .from("tavari_reminder_occurrences")
    .update({
      status: "pending",
      send_at: sendAt,
      snooze_count: snoozeCount + 1,
      sent_at: null,
      next_repeat_at: null,
    })
    .eq("id", input.occurrenceId);

  await admin
    .from("tavari_reminder_deliveries")
    .delete()
    .eq("occurrence_id", input.occurrenceId);

  return { ok: true, message: `Reminder rescheduled for ${sendDate}` };
}

async function hasBusinessManagerAccess(
  admin: ReturnType<typeof createClient>,
  userId: string,
  businessId: string,
) {
  const managerRoles = ["owner", "admin", "manager"];

  const { data: businessUser } = await admin
    .from("business_users")
    .select("role")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();

  if (businessUser?.role && managerRoles.includes(String(businessUser.role))) {
    return true;
  }

  const { data: userRole } = await admin
    .from("user_roles")
    .select("role")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();

  return Boolean(userRole?.role && managerRoles.includes(String(userRole.role)));
}
