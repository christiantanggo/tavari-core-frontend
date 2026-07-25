// Cron: customer/staff reminders configured on booking_activity_tabs.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  addDaysToDateString,
  getDateInTimeZone,
  getZonedParts,
} from "../_shared/reminderSchedule.ts";
import {
  buildBookingManageUrl,
  getOrCreateBookingSelfServiceToken,
} from "../_shared/bookingSelfService.ts";
import {
  normalizeBookingEmail,
  resolveBookingMailRecipients,
  withBookingMailRecipients,
} from "../_shared/bookingRecipientEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-reminder-dispatch-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FROM_EMAIL = "noreply@tavarios.ca";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function renderTemplate(template: string, vars: Record<string, string>) {
  return String(template || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const value = vars[key];
    return value == null ? "" : String(value);
  });
}

function tabUsesCakeReceipts(tab: { content_blocks?: unknown }) {
  const blocks = Array.isArray(tab.content_blocks) ? tab.content_blocks : [];
  return blocks.some((block: { type?: string; upload_key?: string }) =>
    block?.type === "file_upload" && block?.upload_key === "cake_receipts"
  );
}

async function sendMail(payload: Record<string, unknown>) {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || ""}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.warn("[booking-activity-tab-reminder-dispatch] mail failed", await res.text());
  }
  return res.ok;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) {
    const secret = (req.headers.get("x-reminder-dispatch-cron-secret") || "").trim();
    const { data } = await supabase
      .from("system_runtime_secrets")
      .select("secret_value")
      .eq("key_name", "reminder_dispatch_cron_secret")
      .maybeSingle();
    if (!secret || !data?.secret_value || data.secret_value !== secret) {
      return json({ error: "Unauthorized" }, 401);
    }
  }

  const { data: tabs, error: tabsError } = await supabase
    .from("booking_activity_tabs")
    .select("id, business_id, activity_id, tab_key, label, content_blocks, reminders, is_active")
    .eq("is_active", true);

  if (tabsError) {
    return json({ error: tabsError.message }, 500);
  }

  const businessIds = [...new Set((tabs || []).map((t) => t.business_id).filter(Boolean))];
  const { data: businesses } = businessIds.length
    ? await supabase.from("businesses").select("id, name, timezone").in("id", businessIds)
    : { data: [] as Array<{ id: string; name?: string; timezone?: string }> };

  const bizById = new Map((businesses || []).map((b) => [b.id, b]));
  const now = new Date();
  let customerSent = 0;
  let staffSent = 0;
  let skipped = 0;

  for (const tab of tabs || []) {
    const reminders = tab.reminders && typeof tab.reminders === "object" ? tab.reminders : {};
    const customerReminders = Array.isArray((reminders as { customer?: unknown[] }).customer)
      ? (reminders as { customer: Array<Record<string, unknown>> }).customer
      : [];
    const staffReminders = Array.isArray((reminders as { staff?: unknown[] }).staff)
      ? (reminders as { staff: Array<Record<string, unknown>> }).staff
      : [];
    if (customerReminders.length === 0 && staffReminders.length === 0) continue;

    const business = bizById.get(tab.business_id);
    const timeZone = business?.timezone || "America/Toronto";
    const zoned = getZonedParts(now, timeZone);
    const today = getDateInTimeZone(now, timeZone);
    const currentHour = zoned.hour;
    const needsCake = tabUsesCakeReceipts(tab);

    const processReminder = async (
      kind: "customer" | "staff",
      reminder: Record<string, unknown>,
    ) => {
      if (reminder.enabled === false) return;
      const daysBefore = Number.parseInt(String(reminder.days_before ?? 3), 10);
      const sendHour = Number.parseInt(String(reminder.send_hour ?? 10), 10);
      if (!Number.isFinite(daysBefore) || !Number.isFinite(sendHour)) return;
      if (currentHour !== Math.max(0, Math.min(23, sendHour))) return;

      const targetDate = addDaysToDateString(today, Math.max(0, Math.min(365, daysBefore)));
      const reminderId = String(reminder.id || `${kind}-${daysBefore}-${sendHour}`);
      const reminderKey = `${kind}:${reminderId}:${targetDate}`;

      const { data: bookings } = await supabase
        .from("bookings")
        .select(`
          id,
          booking_number,
          booking_date,
          customer_email,
          customer_id,
          secondary_customer_email,
          status,
          booking_activities:activity_id ( activity_name )
        `)
        .eq("business_id", tab.business_id)
        .eq("activity_id", tab.activity_id)
        .eq("booking_date", targetDate)
        .neq("status", "cancelled");

      for (const booking of bookings || []) {
        if (needsCake) {
          const { count } = await supabase
            .from("booking_cake_receipts")
            .select("id", { count: "exact", head: true })
            .eq("booking_id", booking.id)
            .eq("business_id", tab.business_id);
          if ((count || 0) > 0) {
            skipped += 1;
            continue;
          }
        }

        const activityName = (booking.booking_activities as { activity_name?: string } | null)?.activity_name
          || "your booking";
        const vars = {
          activity_name: activityName,
          booking_date: String(booking.booking_date || targetDate),
          booking_number: String(booking.booking_number || booking.id),
          tab_label: String(tab.label || "Details"),
          business_name: String(business?.name || "Tavari"),
        };
        const subject = renderTemplate(String(reminder.subject || "Booking reminder"), vars);
        const bodyText = renderTemplate(String(reminder.body || ""), vars);

        if (kind === "customer") {
          const recipients = await resolveBookingMailRecipients(supabase, booking, tab.business_id);
          if (!recipients) {
            skipped += 1;
            continue;
          }

          const { error: logErr } = await supabase.from("booking_activity_tab_reminder_log").insert({
            business_id: tab.business_id,
            booking_id: booking.id,
            tab_id: tab.id,
            reminder_key: reminderKey,
          });
          if (logErr) {
            skipped += 1;
            continue;
          }

          let manageUrl = "";
          try {
            const token = await getOrCreateBookingSelfServiceToken(
              supabase,
              booking.id,
              tab.business_id,
            );
            manageUrl = buildBookingManageUrl(tab.business_id, token);
          } catch (e) {
            console.warn("[booking-activity-tab-reminder-dispatch] manage url failed", e);
          }
          const html = `<p>${bodyText.replace(/\n/g, "<br/>")}</p>${
            manageUrl ? `<p><a href="${manageUrl}">Manage your booking</a></p>` : ""
          }`;
          const ok = await sendMail(withBookingMailRecipients({
            businessId: tab.business_id,
            campaignId: `activity-tab-${tab.id}-${booking.id}-${reminderKey}`,
            emailType: "transactional",
            fromEmail: FROM_EMAIL,
            fromName: business?.name || "Tavari Bookings",
            subject,
            html,
            text: manageUrl ? `${bodyText}\n\nManage: ${manageUrl}` : bodyText,
          }, recipients));
          if (ok) customerSent += 1;
        } else {
          const emails = Array.isArray(reminder.emails)
            ? reminder.emails.map((e) => normalizeBookingEmail(e)).filter(Boolean) as string[]
            : [];
          if (emails.length === 0) {
            skipped += 1;
            continue;
          }

          const { error: logErr } = await supabase.from("booking_activity_tab_reminder_log").insert({
            business_id: tab.business_id,
            booking_id: booking.id,
            tab_id: tab.id,
            reminder_key: reminderKey,
          });
          if (logErr) {
            skipped += 1;
            continue;
          }

          for (const to of emails) {
            const ok = await sendMail({
              businessId: tab.business_id,
              campaignId: `activity-tab-staff-${tab.id}-${booking.id}-${reminderKey}`,
              emailType: "transactional",
              to,
              fromEmail: FROM_EMAIL,
              fromName: "Tavari Bookings",
              subject,
              html: `<p>${bodyText.replace(/\n/g, "<br/>")}</p>`,
              text: bodyText,
            });
            if (ok) staffSent += 1;
          }
        }
      }
    };

    for (const reminder of customerReminders) {
      await processReminder("customer", reminder);
    }
    for (const reminder of staffReminders) {
      await processReminder("staff", reminder);
    }
  }

  return json({ ok: true, customerSent, staffSent, skipped });
});
