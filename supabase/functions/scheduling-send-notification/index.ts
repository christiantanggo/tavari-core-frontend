import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const DEFAULT_PUBLIC_SITE_URL = "https://tavarios.ca";
const DEFAULT_EMPLOYEE_PORTAL_URL = "https://employee.tavarios.ca/login?returnUrl=/schedule";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const EVENT_META: Record<string, { title: string; audience: "employee" | "manager" }> = {
  schedule_posted: { title: "Schedule posted", audience: "employee" },
  schedule_changed: { title: "Schedule changed", audience: "employee" },
  shift_reminder: { title: "Upcoming shift reminder", audience: "employee" },
  shift_marked_sick: { title: "Employee marked sick", audience: "manager" },
  availability_submitted: { title: "Availability submitted", audience: "manager" },
  availability_approved: { title: "Availability approved", audience: "employee" },
  availability_denied: { title: "Availability denied", audience: "employee" },
  time_off_requested: { title: "Time off requested", audience: "manager" },
  time_off_approved: { title: "Time off approved", audience: "employee" },
  time_off_denied: { title: "Time off denied", audience: "employee" },
  shift_coverage_requested: { title: "Shift coverage requested", audience: "manager" },
  shift_coverage_approved: { title: "Shift coverage approved", audience: "employee" },
  shift_coverage_denied: { title: "Shift coverage denied", audience: "employee" },
  missed_clock_in: { title: "Missed clock-in", audience: "manager" },
  late_clock_in: { title: "Late clock-in", audience: "manager" },
  early_clock_out: { title: "Early clock-out", audience: "manager" },
  missed_break: { title: "Missed break", audience: "manager" },
};

const EVENT_COPY: Record<string, { eyebrow: string; headline: string; intro: string; accent: string }> = {
  schedule_posted: {
    eyebrow: "Schedule Update",
    headline: "A new schedule has been posted",
    intro: "Your schedule is ready to review. The full Sunday-to-Saturday schedule for this week is included below.",
    accent: "#2563eb",
  },
  schedule_changed: {
    eyebrow: "Schedule Change",
    headline: "A scheduled shift was updated",
    intro: "A change was made to the schedule. The full Sunday-to-Saturday schedule for this week is included below.",
    accent: "#7c3aed",
  },
  shift_reminder: {
    eyebrow: "Shift Reminder",
    headline: "You have an upcoming shift",
    intro:
      "This is a scheduled reminder about your next shift. Please review the date and time below. Contact your manager if you need to make a change.",
    accent: "#0d9488",
  },
  shift_marked_sick: {
    eyebrow: "Attendance Update",
    headline: "An employee was marked sick",
    intro: "An employee has been marked sick for an upcoming shift. You may need to adjust staffing coverage.",
    accent: "#dc2626",
  },
  availability_submitted: {
    eyebrow: "Availability",
    headline: "New availability was submitted",
    intro: "An employee submitted or updated their availability for scheduling review.",
    accent: "#0891b2",
  },
  availability_approved: {
    eyebrow: "Availability",
    headline: "Your availability was approved",
    intro: "Your availability request has been approved and can now be used for scheduling.",
    accent: "#16a34a",
  },
  availability_denied: {
    eyebrow: "Availability",
    headline: "Your availability was not approved",
    intro: "Your availability request was reviewed but not approved. Please contact your manager if you have questions.",
    accent: "#ea580c",
  },
  time_off_requested: {
    eyebrow: "Time Off",
    headline: "A time-off request needs review",
    intro: "An employee submitted a time-off request. Please review it when you can.",
    accent: "#0f766e",
  },
  time_off_approved: {
    eyebrow: "Time Off",
    headline: "Your time off was approved",
    intro: "Your time-off request has been approved.",
    accent: "#16a34a",
  },
  time_off_denied: {
    eyebrow: "Time Off",
    headline: "Your time off was not approved",
    intro: "Your time-off request was reviewed but not approved. Please contact your manager if you have questions.",
    accent: "#ea580c",
  },
  shift_coverage_requested: {
    eyebrow: "Shift Coverage",
    headline: "A shift coverage request needs review",
    intro: "An employee requested coverage or a shift swap. Please review the request in Scheduling.",
    accent: "#0f766e",
  },
  shift_coverage_approved: {
    eyebrow: "Shift Coverage",
    headline: "Your shift coverage request was approved",
    intro: "Your manager approved your shift coverage or swap request.",
    accent: "#16a34a",
  },
  shift_coverage_denied: {
    eyebrow: "Shift Coverage",
    headline: "Your shift coverage request was not approved",
    intro: "Your manager reviewed your shift coverage or swap request but did not approve it.",
    accent: "#ea580c",
  },
  missed_clock_in: {
    eyebrow: "Attendance Alert",
    headline: "A scheduled employee has not clocked in",
    intro: "A shift appears to have started without a matching clock-in. Contact details are below, and you can record the reason for the absence from this email.",
    accent: "#dc2626",
  },
  late_clock_in: {
    eyebrow: "Attendance Alert",
    headline: "An employee clocked in late",
    intro: "An employee clocked in after their scheduled start time.",
    accent: "#f59e0b",
  },
  early_clock_out: {
    eyebrow: "Attendance Alert",
    headline: "An employee clocked out early",
    intro: "An employee clocked out before their scheduled end time.",
    accent: "#f59e0b",
  },
  missed_break: {
    eyebrow: "Break Alert",
    headline: "A required break may have been missed",
    intro: "A long shift ended without a recorded unpaid break. Please review the time card.",
    accent: "#ea580c",
  },
};

const DEFAULT_NOTIFICATION_SETTINGS: Record<string, { email: boolean; sms: boolean }> =
  Object.keys(EVENT_META).reduce((acc, key) => {
    acc[key] = { email: true, sms: false };
    return acc;
  }, {} as Record<string, { email: boolean; sms: boolean }>);

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: corsHeaders });

const uniq = <T,>(items: T[]) => Array.from(new Set(items.filter(Boolean)));

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const businessId = String(body.businessId || "");
    const eventKey = String(body.eventKey || "");
    const employeeIds = uniq([
      ...(Array.isArray(body.employeeIds) ? body.employeeIds : []),
      body.employeeId,
    ].map((value) => String(value || "").trim()).filter(Boolean));
    const context = body.context && typeof body.context === "object" ? body.context : {};

    if (!businessId || !eventKey || !EVENT_META[eventKey]) {
      return json({ error: "Missing or invalid businessId/eventKey" }, 400);
    }

    const authError = await authorize(req, businessId);
    if (authError) return authError;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [{ data: settingRow }, { data: business }, { data: mailSettings }] = await Promise.all([
      supabase
        .from("scheduling_notification_settings")
        .select("settings")
        .eq("business_id", businessId)
        .maybeSingle(),
      supabase
        .from("businesses")
        .select("id,name,timezone")
        .eq("id", businessId)
        .maybeSingle(),
      supabase
        .from("mail_settings")
        .select("from_email,from_name")
        .eq("business_id", businessId)
        .maybeSingle(),
    ]);

    const eventSettings = {
      ...(DEFAULT_NOTIFICATION_SETTINGS[eventKey] || { email: true, sms: false }),
      ...(settingRow?.settings?.[eventKey] || {}),
    };
    const emailEnabled = eventSettings.email === true || body.force === true;
    const smsEnabled = eventSettings.sms === true;

    const notificationContext = await buildNotificationContext(supabase, businessId, eventKey, employeeIds, context);
    const recipients = await resolveRecipients(supabase, businessId, eventKey, employeeIds);
    const emailRecipients = uniq(recipients.map((recipient) => recipient.email).filter(Boolean));

    const emailResults = [];
    if (emailEnabled) {
      for (const to of emailRecipients) {
        const result = await sendEmail({
          businessId,
          businessName: business?.name || "Tavari",
          fromEmail: mailSettings?.from_email || "noreply@tavarios.ca",
          fromName: mailSettings?.from_name || business?.name || "Tavari",
          to,
          eventKey,
          title: EVENT_META[eventKey].title,
          context: notificationContext,
          timeZone: business?.timezone || "America/Toronto",
        });
        emailResults.push(result);
      }
    }

    return json({
      ok: true,
      eventKey,
      emailEnabled,
      smsEnabled,
      recipients,
      emailResults,
      smsResults: smsEnabled
        ? [{ ok: false, skipped: true, reason: "Scheduling SMS delivery is not wired to an SMS provider yet." }]
        : [],
    });
  } catch (error) {
    console.error("[scheduling-send-notification] error", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

async function authorize(req: Request, businessId: string) {
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return null;
  if (!authHeader || !SUPABASE_ANON_KEY) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user?.id) return json({ error: "Unauthorized" }, 401);

  const { data } = await userClient
    .from("business_users")
    .select("id")
    .eq("business_id", businessId)
    .eq("user_id", user.id)
    .maybeSingle();

  return data ? null : json({ error: "Forbidden" }, 403);
}

async function resolveRecipients(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  eventKey: string,
  employeeIds: string[],
) {
  const meta = EVENT_META[eventKey];

  if (meta.audience === "employee") {
    if (employeeIds.length === 0) return [];
    const { data, error } = await supabase
      .from("users")
      .select("id,full_name,email,phone")
      .in("id", employeeIds);
    if (error) throw error;
    return (data || []).map((row) => ({
      id: row.id,
      name: row.full_name,
      email: row.email,
      phone: row.phone,
      audience: "employee",
    }));
  }

  const [{ data: businessUsers, error: buError }, { data: roleUsers, error: roleError }] = await Promise.all([
    supabase
      .from("business_users")
      .select("users!business_users_user_id_fkey(id,full_name,email,phone), role")
      .eq("business_id", businessId)
      .in("role", ["owner", "manager", "admin", "hr_admin"]),
    supabase
      .from("user_roles")
      .select("users!user_roles_user_id_fkey(id,full_name,email,phone), role")
      .eq("business_id", businessId)
      .eq("active", true)
      .in("role", ["owner", "manager", "admin", "hr_admin"]),
  ]);
  if (buError) throw buError;
  if (roleError) throw roleError;

  const byEmail = new Map<string, Record<string, unknown>>();
  [...(businessUsers || []), ...(roleUsers || [])].forEach((entry: any) => {
    const user = entry.users;
    if (user?.email) {
      byEmail.set(String(user.email).toLowerCase(), {
        id: user.id,
        name: user.full_name,
        email: user.email,
        phone: user.phone,
        audience: "manager",
      });
    }
  });
  return Array.from(byEmail.values());
}

async function buildNotificationContext(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  eventKey: string,
  employeeIds: string[],
  context: Record<string, unknown>,
) {
  if (eventKey === "schedule_posted" || eventKey === "schedule_changed") {
    return buildScheduleNotificationContext(supabase, businessId, employeeIds, context);
  }

  if (eventKey !== "missed_clock_in") return context;

  const employeeId = employeeIds[0] || String(context.employeeId || "");
  if (!employeeId) return context;

  const { data: employee } = await supabase
    .from("users")
    .select("id,full_name,phone,emergency_contact_name,emergency_contact_phone,emergency_contact_relationship")
    .eq("id", employeeId)
    .maybeSingle();

  const shiftId = String(context.shiftId || "");
  return {
    ...context,
    employeeId,
    employeeName: context.employeeName || employee?.full_name,
    employeePhone: context.employeePhone || employee?.phone,
    emergencyContactName: context.emergencyContactName || employee?.emergency_contact_name,
    emergencyContactPhone: context.emergencyContactPhone || employee?.emergency_contact_phone,
    emergencyContactRelationship: context.emergencyContactRelationship || employee?.emergency_contact_relationship,
    actionUrl: shiftId
      ? `${resolvePublicSiteUrl()}/dashboard/scheduling/absence/${encodeURIComponent(shiftId)}?business=${encodeURIComponent(businessId)}`
      : null,
  };
}

async function buildScheduleNotificationContext(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  employeeIds: string[],
  context: Record<string, unknown>,
) {
  const employeeId = employeeIds[0] || String(context.employeeId || "");
  const scheduleShifts = getScheduleShifts(context);
  const seedDate =
    context.weekStart ||
    context.shiftDate ||
    getNested(context, "shift.shift_date") ||
    scheduleShifts[0]?.shift_date;
  const weekRange = getSundayToSaturdayRange(seedDate);

  if (!employeeId || !weekRange) {
    return {
      ...context,
      shiftCount: scheduleShifts.length,
    };
  }

  const { data, error } = await supabase
    .from("scheduling_shifts")
    .select("id,employee_id,shift_date,start_time,end_time,position,status,is_published")
    .eq("business_id", businessId)
    .eq("employee_id", employeeId)
    .gte("shift_date", weekRange.weekStart)
    .lte("shift_date", weekRange.weekEnd)
    .order("shift_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    console.warn("[scheduling-send-notification] Failed to load full weekly schedule", error);
    return {
      ...context,
      weekStart: weekRange.weekStart,
      weekEnd: weekRange.weekEnd,
      shiftCount: scheduleShifts.length,
    };
  }

  const fullWeeklyShifts = (data || []).filter((shift: Record<string, unknown>) => shift.is_published !== false);
  return {
    ...context,
    weekStart: weekRange.weekStart,
    weekEnd: weekRange.weekEnd,
    shiftCount: fullWeeklyShifts.length,
    shifts: fullWeeklyShifts,
  };
}

async function sendEmail(input: {
  businessId: string;
  businessName: string;
  fromEmail: string;
  fromName: string;
  to: string;
  eventKey: string;
  title: string;
  context: Record<string, unknown>;
  timeZone: string;
}) {
  const copy = EVENT_COPY[input.eventKey] || {
    eyebrow: "Scheduling",
    headline: input.title,
    intro: "There is a new scheduling notification to review.",
    accent: "#111827",
  };
  const details = buildDetails(input.eventKey, input.context, input.timeZone);
  const action = buildAction(input.eventKey, input.context);
  const html = buildEmailHtml({
    businessName: input.businessName,
    title: input.title,
    copy,
    details,
    action,
  });
  const text = buildEmailText({
    businessName: input.businessName,
    headline: copy.headline,
    intro: copy.intro,
    details,
    action,
  });

  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      businessId: input.businessId,
      campaignId: `scheduling-${input.eventKey}-${Date.now()}`,
      emailType: "transactional",
      to: input.to,
      fromEmail: input.fromEmail,
      fromName: input.fromName,
      subject: `[Tavari Scheduling] ${input.title}`,
      html,
      text,
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

function buildEmailHtml(input: {
  businessName: string;
  title: string;
  copy: { eyebrow: string; headline: string; intro: string; accent: string };
  details: Array<{ label: string; value: string }>;
  action?: { label: string; url: string };
}) {
  const detailRows = input.details.length
    ? input.details.map((item) => `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;width:38%;">${escapeHtml(item.label)}</td>
          <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(item.value)}</td>
        </tr>
      `).join("")
    : `
        <tr>
          <td style="padding:12px 0;color:#6b7280;font-size:14px;">Open Tavari Scheduling to view the latest details.</td>
        </tr>
      `;
  const actionBlock = input.action
    ? `
            <tr>
              <td style="padding:18px 32px 0;">
                <a href="${escapeHtml(input.action.url)}" style="display:inline-block;background:${input.copy.accent};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 22px;border-radius:999px;">
                  ${escapeHtml(input.action.label)}
                </a>
              </td>
            </tr>
      `
    : "";

  return `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.10);">
            <tr>
              <td style="background:${input.copy.accent};padding:28px 32px;color:#ffffff;">
                <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;opacity:0.9;">${escapeHtml(input.copy.eyebrow)}</div>
                <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;font-weight:800;">${escapeHtml(input.copy.headline)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 32px 8px;">
                <p style="margin:0;color:#374151;font-size:16px;line-height:1.6;">${escapeHtml(input.copy.intro)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px 8px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  ${detailRows}
                </table>
              </td>
            </tr>
            ${actionBlock}
            <tr>
              <td style="padding:24px 32px 32px;">
                <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:16px;">
                  <div style="font-size:13px;color:#6b7280;line-height:1.5;">
                    This notification was sent by <strong style="color:#111827;">${escapeHtml(input.businessName)}</strong> through Tavari Scheduling.
                  </div>
                </div>
              </td>
            </tr>
          </table>
          <div style="max-width:620px;margin-top:14px;color:#9ca3af;font-size:12px;line-height:1.5;">
            Tavari Scheduling notification: ${escapeHtml(input.title)}
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildEmailText(input: {
  businessName: string;
  headline: string;
  intro: string;
  details: Array<{ label: string; value: string }>;
  action?: { label: string; url: string };
}) {
  const detailText = input.details.map((item) => `${item.label}: ${item.value}`).join("\n");
  return [
    input.headline,
    "",
    input.intro,
    "",
    detailText,
    "",
    input.action ? `${input.action.label}: ${input.action.url}` : "",
    input.action ? "" : "",
    `Sent by ${input.businessName} through Tavari Scheduling.`,
  ].filter(Boolean).join("\n");
}

function buildAction(eventKey: string, context: Record<string, unknown>) {
  if (eventKey === "schedule_posted" || eventKey === "schedule_changed" || eventKey === "shift_reminder") {
    return {
      label: "View My Schedule",
      url: String(context.portalUrl || resolveEmployeePortalUrl()),
    };
  }

  if (eventKey !== "missed_clock_in" || !context.actionUrl) return undefined;
  return {
    label: "Choose Absence Reason",
    url: String(context.actionUrl),
  };
}

function buildDetails(eventKey: string, context: Record<string, unknown>, timeZone: string) {
  const details: Array<{ label: string; value: string }> = [];
  const add = (label: string, value: unknown) => {
    const formatted = formatValue(value, timeZone);
    if (formatted) details.push({ label, value: formatted });
  };

  if (eventKey === "schedule_posted" || eventKey === "schedule_changed") {
    const scheduleShifts = getScheduleShifts(context);
    add("Week", formatRange(context.weekStart, context.weekEnd));
    add("Your full weekly schedule", context.shiftCount ?? scheduleShifts.length);

    if (context.changedShiftCount) {
      add("Shifts updated in this post", context.changedShiftCount);
    }

    if (scheduleShifts.length === 0) {
      add("Schedule", "No shifts scheduled this week");
    } else {
      scheduleShifts.forEach((shift, index) => {
        add(formatShiftLabel(shift, index, timeZone), formatShiftLine(shift));
      });
    }

    return details;
  }

  add("Employee", context.employeeName || context.employee_name);
  add("Employee phone", context.employeePhone);
  add("Emergency contact", context.emergencyContactName);
  add("Emergency phone", context.emergencyContactPhone);
  add("Relationship", context.emergencyContactRelationship);
  add("Position", context.position || getNested(context, "shift.position"));
  add("Date", context.shiftDate || getNested(context, "shift.shift_date") || context.weekStart);
  add("Start", context.scheduledStart || getNested(context, "shift.start_time"));
  add("End", context.scheduledEnd || getNested(context, "shift.end_time"));
  add("Action", context.action);

  if (eventKey === "late_clock_in") {
    add("Minutes late", context.minutesLate);
    add("Actual clock in", context.actualClockIn);
  }

  if (eventKey === "missed_clock_in") {
    add("Grace period", context.graceMinutes ? `${context.graceMinutes} minutes` : null);
  }

  if (eventKey === "missed_break") {
    add("Scheduled length", context.scheduledMinutes ? `${Math.round(Number(context.scheduledMinutes))} minutes` : null);
  }

  if (eventKey === "shift_reminder") {
    const hb = context.hoursBeforeReminder ?? context.hours_before;
    add(
      "Reminder window",
      hb != null && hb !== ""
        ? `${Number(hb)} hour${Number(hb) === 1 ? "" : "s"} before shift start`
        : null,
    );
  }

  if (eventKey.startsWith("time_off_")) {
    add("Request type", formatRequestType(context.requestType));
    add("Start date", context.startDate);
    add("End date", context.endDate);
    add("Time", formatRange(context.startTime, context.endTime, timeZone));
    add("Total hours", context.totalHours);
    add("Status", context.status);
    add("Denial reason", context.denialReason);
  }

  const availability = getNested(context, "availability") as Record<string, unknown> | null;
  if (availability) {
    add("Availability", availability.is_available === false ? "Unavailable" : "Available");
    add("Status", availability.status);
    add("Day", formatDayOfWeek(availability.day_of_week));
    add("Time", formatRange(availability.start_time, availability.end_time, timeZone));
    add("Effective", availability.effective_date);
    add("Expires", availability.expiry_date);
    add("Denial reason", context.denialReason || availability.denial_reason);
  }

  add("Notes", context.note || context.notes);

  return details.slice(0, 12);
}

function getScheduleShifts(context: Record<string, unknown>) {
  const shifts = context.shifts;
  if (!Array.isArray(shifts)) return [];
  return shifts
    .filter((shift): shift is Record<string, unknown> => Boolean(shift) && typeof shift === "object")
    .sort((a, b) => {
      const aDate = `${String(a.shift_date || "")}T${String(a.start_time || "00:00:00")}`;
      const bDate = `${String(b.shift_date || "")}T${String(b.start_time || "00:00:00")}`;
      return aDate.localeCompare(bDate);
    });
}

function getSundayToSaturdayRange(seedDate: unknown) {
  const dateString = normalizeDateString(seedDate);
  if (!dateString) return null;

  const start = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());

  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

  return {
    weekStart: toIsoDate(start),
    weekEnd: toIsoDate(end),
  };
}

function normalizeDateString(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || "";
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatShiftLabel(shift: Record<string, unknown>, index: number, timeZone: string) {
  return formatDateLabel(shift.shift_date, timeZone) || `Shift ${index + 1}`;
}

function formatShiftLine(shift: Record<string, unknown>) {
  const timeRange = formatTimeRange(shift.start_time, shift.end_time);
  const position = formatValue(shift.position);
  const status = formatScheduleStatus(shift.status);
  return [timeRange, position, status].filter(Boolean).join(" • ");
}

function formatScheduleStatus(value: unknown) {
  const status = String(value || "").trim().toLowerCase();
  if (!status || status === "scheduled" || status === "confirmed") return "";
  return status.replace(/_/g, " ");
}

/** Plain calendar dates YYYY-MM-DD → "May 28 2026" (business timezone, no ISO). */
function formatCalendarDate(value: string, timeZone: string): string {
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  const formatted = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(d);
  return formatted.replace(/,/g, "").trim();
}

function formatDateLabel(value: unknown, timeZone: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatValue(value, timeZone);
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return formatValue(value, timeZone);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(d);
  return `${weekday} · ${formatCalendarDate(value, timeZone)}`;
}

function getNested(source: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return null;
    return (current as Record<string, unknown>)[key] ?? null;
  }, source);
}

function formatRange(start: unknown, end: unknown, timeZone = "America/Toronto") {
  const formattedStart = formatValue(start, timeZone);
  const formattedEnd = formatValue(end, timeZone);
  if (formattedStart && formattedEnd) return `${formattedStart} - ${formattedEnd}`;
  return formattedStart || formattedEnd;
}

function formatTimeRange(start: unknown, end: unknown) {
  const formattedStart = formatLocalTime(start);
  const formattedEnd = formatLocalTime(end);
  if (formattedStart && formattedEnd) return `${formattedStart} - ${formattedEnd}`;
  return formattedStart || formattedEnd;
}

function formatDayOfWeek(value: unknown) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const index = Number(value);
  return Number.isInteger(index) && days[index] ? days[index] : value;
}

function formatRequestType(value: unknown) {
  const labels: Record<string, string> = {
    vacation: "Vacation",
    sick: "Sick",
    personal: "Personal",
    bereavement: "Bereavement",
    jury_duty: "Jury duty",
    other: "Other",
  };
  const key = String(value || "");
  return labels[key] || key.replace(/_/g, " ");
}

function formatValue(value: unknown, timeZone = "America/Toronto") {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";

  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      return new Intl.DateTimeFormat("en-CA", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone,
      }).format(new Date(value));
    }
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) {
      return formatLocalTime(value);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return formatCalendarDate(value, timeZone);
    }
    return value;
  }

  return "";
}

function formatLocalTime(value: unknown) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return formatValue(value);
  const [hourValue, minuteValue] = value.split(":").map(Number);
  if (Number.isNaN(hourValue) || Number.isNaN(minuteValue)) return value;
  const suffix = hourValue >= 12 ? "p.m." : "a.m.";
  const hour12 = hourValue % 12 || 12;
  return `${hour12}:${String(minuteValue).padStart(2, "0")} ${suffix}`;
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

function resolveEmployeePortalUrl() {
  const configured = normalizePublicSiteUrl(Deno.env.get("EMPLOYEE_PORTAL_URL"));
  if (configured) {
    return configured.includes("?") || /\/(?:login|portal\/login)(?:\/)?$/i.test(configured)
      ? configured
      : `${configured}/login?returnUrl=${encodeURIComponent("/schedule")}`;
  }

  const siteUrl = resolvePublicSiteUrl();
  if (siteUrl && siteUrl !== DEFAULT_PUBLIC_SITE_URL) {
    return `${siteUrl}/portal/login?returnUrl=${encodeURIComponent("/portal/schedule")}`;
  }

  return DEFAULT_EMPLOYEE_PORTAL_URL;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
