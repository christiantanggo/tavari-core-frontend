import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  addDaysToDateString,
  getDateInTimeZone,
  getZonedParts,
  zonedDateTimeToUtc,
} from "../_shared/reminderSchedule.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_PUBLIC_SITE_URL = "https://tavarios.ca";
const DEFAULT_FROM_EMAIL = "noreply@tavarios.ca";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-task-manager-checklist-alert-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: corsHeaders });

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function resolvePublicSiteUrl() {
  const raw = (Deno.env.get("PUBLIC_SITE_URL") || Deno.env.get("VITE_PUBLIC_SITE_URL") || "").trim();
  if (raw) return raw.replace(/\/$/, "");
  return DEFAULT_PUBLIC_SITE_URL;
}

function parseTimeToMinutes(value: string) {
  const [hour = 0, minute = 0] = String(value || "0:0").split(":").map(Number);
  return hour * 60 + minute;
}

function normalizeTime(value: string) {
  const parts = String(value || "00:00").split(":");
  const hour = String(parts[0] || "0").padStart(2, "0");
  const minute = String(parts[1] || "0").padStart(2, "0");
  const second = String(parts[2] || "0").padStart(2, "0");
  return `${hour}:${minute}:${second}`;
}

function computeWindowEndInstant(
  now: Date,
  windowStart: string,
  windowEnd: string,
  timeZone: string,
) {
  const dateStr = getDateInTimeZone(now, timeZone);
  const parts = getZonedParts(now, timeZone);
  const nowMinutes = parts.hour * 60 + parts.minute;
  const startMinutes = parseTimeToMinutes(windowStart);
  const endMinutes = parseTimeToMinutes(windowEnd);

  let endDateStr = dateStr;
  if (startMinutes > endMinutes && nowMinutes >= startMinutes) {
    endDateStr = addDaysToDateString(dateStr, 1);
  }

  return zonedDateTimeToUtc(endDateStr, normalizeTime(windowEnd), timeZone);
}

function formatTimeLabel(value: string) {
  const [hourRaw = 0, minuteRaw = 0] = String(value || "0:0").split(":").map(Number);
  const hour = hourRaw % 12 || 12;
  const suffix = hourRaw >= 12 ? "PM" : "AM";
  return `${hour}:${String(minuteRaw).padStart(2, "0")} ${suffix}`;
}

async function authorize(req: Request, admin: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return true;

  const requestSecret = (req.headers.get("x-task-manager-checklist-alert-cron-secret") || "").trim();
  if (!requestSecret) return false;

  const { data } = await admin
    .from("system_runtime_secrets")
    .select("secret_value")
    .eq("key_name", "task_manager_checklist_alert_cron_secret")
    .maybeSingle();

  return Boolean(data?.secret_value && data.secret_value === requestSecret);
}

function buildEmailContent(input: {
  businessName: string;
  checklistName: string;
  windowStart: string;
  windowEnd: string;
  minutesBeforeClose: number;
  incompleteCount: number;
  totalCount: number;
  incompleteTitles: string[];
  dashboardUrl: string;
}) {
  const incompleteList = input.incompleteTitles.length
    ? input.incompleteTitles.map((title) => `<li>${escapeHtml(title)}</li>`).join("")
    : "<li>One or more checklist items are still open</li>";

  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.10);">
            <tr>
              <td style="background:#b45309;padding:28px 32px;color:#ffffff;">
                <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;opacity:0.9;">Tavari Task Manager</div>
                <h1 style="margin:10px 0 0;font-size:26px;line-height:1.2;font-weight:800;">Checklist not complete</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 8px;">
                <p style="margin:0 0 12px;color:#374151;font-size:16px;line-height:1.6;">
                  <strong>${escapeHtml(input.checklistName)}</strong> still has
                  <strong>${input.incompleteCount}</strong> of <strong>${input.totalCount}</strong> items incomplete.
                </p>
                <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.6;">
                  The checklist window closes at ${escapeHtml(formatTimeLabel(input.windowEnd))}
                  (${input.minutesBeforeClose} minutes from now). Window:
                  ${escapeHtml(formatTimeLabel(input.windowStart))} – ${escapeHtml(formatTimeLabel(input.windowEnd))}.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0;">
                <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.7;">
                  ${incompleteList}
                </ul>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px;">
                <a href="${escapeHtml(input.dashboardUrl)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 22px;border-radius:999px;">
                  Open Task Manager
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;color:#9ca3af;font-size:12px;">${escapeHtml(input.businessName)} · Tavari Task Manager</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    "Tavari Task Manager — checklist not complete",
    "",
    `${input.checklistName}: ${input.incompleteCount} of ${input.totalCount} items still incomplete.`,
    `Window closes at ${formatTimeLabel(input.windowEnd)} (${input.minutesBeforeClose} minutes from alert time).`,
    "",
    "Incomplete items:",
    ...input.incompleteTitles.map((title) => `- ${title}`),
    "",
    `Open Task Manager: ${input.dashboardUrl}`,
  ].join("\n");

  return {
    subject: `[Task Manager] ${input.checklistName} not complete — window closing soon`,
    html,
    text,
  };
}

async function sendEmail(input: {
  businessId: string;
  fromEmail: string;
  fromName: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  logId: string;
}) {
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      businessId: input.businessId,
      campaignId: `task-checklist-alert-${input.logId}`,
      emailType: "transactional",
      to: input.to,
      fromEmail: input.fromEmail,
      fromName: input.fromName,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  const payload = await response.json().catch(() => null);
  return {
    to: input.to,
    ok: response.ok && payload?.ok === true,
    messageId: payload?.messageId || null,
    error: response.ok ? payload?.error || null : payload?.error || `mail-send HTTP ${response.status}`,
  };
}

function isActiveEmployee(user: Record<string, unknown> | null | undefined) {
  if (!user) return false;
  const status = String(user.employment_status || "").toLowerCase();
  if (status === "terminated" || status === "suspended") return false;
  if (user.is_active === false) return false;
  if (user.termination_date) return false;
  return Boolean(String(user.email || "").trim());
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (!(await authorize(req, admin))) {
      return json({ error: "Forbidden" }, 403);
    }

    const now = new Date();
    const siteUrl = resolvePublicSiteUrl();
    const summary = {
      scanned: 0,
      alerted: 0,
      skipped: 0,
      emailsSent: 0,
      errors: [] as string[],
    };

    const { data: settingsRows, error: settingsError } = await admin
      .from("task_manager_checklist_alert_settings")
      .select("business_id, enabled, minutes_before_close")
      .eq("enabled", true);

    if (settingsError) throw settingsError;

    for (const settings of settingsRows || []) {
      const businessId = String(settings.business_id);
      const minutesBeforeClose = Number(settings.minutes_before_close) || 60;

      const [{ data: business, error: businessError }, { data: mailSettings }] = await Promise.all([
        admin.from("businesses").select("id,name,timezone").eq("id", businessId).maybeSingle(),
        admin.from("mail_settings").select("from_email,from_name").eq("business_id", businessId).maybeSingle(),
      ]);
      if (businessError) throw businessError;
      if (!business) continue;

      const timeZone = String(business.timezone || "America/Toronto");
      const businessDate = getDateInTimeZone(now, timeZone);
      const fromEmail = String(mailSettings?.from_email || DEFAULT_FROM_EMAIL);
      const fromName = String(mailSettings?.from_name || business.name || "Tavari");

      const { data: categories, error: categoriesError } = await admin
        .from("task_manager_categories")
        .select(`
          id,
          name,
          kiosk_button_label,
          checklist_window_start,
          checklist_window_end,
          recipients:task_manager_checklist_alert_recipients(employee_id)
        `)
        .eq("business_id", businessId)
        .eq("kiosk_checklist_button", true)
        .not("checklist_window_start", "is", null)
        .not("checklist_window_end", "is", null);

      if (categoriesError) throw categoriesError;

      for (const category of categories || []) {
        summary.scanned += 1;
        const recipients = (category.recipients || []) as Array<{ employee_id: string }>;
        if (!recipients.length) {
          summary.skipped += 1;
          continue;
        }

        const windowEndAt = computeWindowEndInstant(
          now,
          String(category.checklist_window_start),
          String(category.checklist_window_end),
          timeZone,
        );
        const alertStartAt = new Date(windowEndAt.getTime() - minutesBeforeClose * 60_000);

        if (now < alertStartAt || now >= windowEndAt) {
          summary.skipped += 1;
          continue;
        }

        const { data: completion, error: completionError } = await admin.rpc(
          "task_manager_checklist_completion_status",
          {
            p_business_id: businessId,
            p_category_id: category.id,
          },
        );
        if (completionError) throw completionError;

        if (!completion || completion.is_complete === true || Number(completion.total || 0) === 0) {
          summary.skipped += 1;
          continue;
        }

        const { data: existingLog } = await admin
          .from("task_manager_checklist_alert_log")
          .select("id")
          .eq("business_id", businessId)
          .eq("category_id", category.id)
          .eq("business_date", businessDate)
          .maybeSingle();

        if (existingLog?.id) {
          summary.skipped += 1;
          continue;
        }

        const { data: logRow, error: logError } = await admin
          .from("task_manager_checklist_alert_log")
          .insert({
            business_id: businessId,
            category_id: category.id,
            business_date: businessDate,
            incomplete_count: Number(completion.incomplete_count || 0),
            total_count: Number(completion.total || 0),
          })
          .select("id")
          .single();

        if (logError) {
          if (logError.code === "23505") {
            summary.skipped += 1;
            continue;
          }
          throw logError;
        }

        const checklistName = String(category.kiosk_button_label || category.name || "Checklist");
        const incompleteTitles = Array.isArray(completion.incomplete_titles)
          ? completion.incomplete_titles.map((title: unknown) => String(title))
          : [];

        const emailContent = buildEmailContent({
          businessName: String(business.name || "Your business"),
          checklistName,
          windowStart: String(category.checklist_window_start),
          windowEnd: String(category.checklist_window_end),
          minutesBeforeClose,
          incompleteCount: Number(completion.incomplete_count || 0),
          totalCount: Number(completion.total || 0),
          incompleteTitles,
          dashboardUrl: `${siteUrl}/dashboard/tasks`,
        });

        const employeeIds = [...new Set(recipients.map((row) => String(row.employee_id)).filter(Boolean))];
        const { data: users, error: usersError } = await admin
          .from("users")
          .select("id,full_name,email,employment_status,termination_date,is_active")
          .in("id", employeeIds);
        if (usersError) throw usersError;

        const sentTo = new Set<string>();
        for (const user of users || []) {
          if (!isActiveEmployee(user)) continue;
          const email = String(user.email || "").trim().toLowerCase();
          if (!email || sentTo.has(email)) continue;
          sentTo.add(email);

          const result = await sendEmail({
            businessId,
            fromEmail,
            fromName,
            to: String(user.email),
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text,
            logId: String(logRow.id),
          });

          if (result.ok) summary.emailsSent += 1;
          else summary.errors.push(`${email}: ${result.error || "send failed"}`);
        }

        summary.alerted += 1;
      }
    }

    return json({ ok: true, ...summary });
  } catch (error) {
    console.error("task-manager-checklist-alert-dispatch", error);
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
