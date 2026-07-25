import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_EMPLOYEE_PORTAL_URL = "https://employee.tavarios.ca/login?returnUrl=/schedule";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-shift-reminder-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: corsHeaders });

/** How close (ms) shift start must be to the “hours before” target to send (cron runs ~hourly). */
const MATCH_WINDOW_MS = 35 * 60 * 1000;

function zonedDateTimeToUtc(dateValue: string, timeValue: string, timeZone: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour = 0, minute = 0, second = 0] = timeValue.split(":").map(Number);
  const targetTime = Date.UTC(year, month - 1, day, hour, minute, second || 0);
  let candidate = new Date(targetTime);
  for (let i = 0; i < 3; i += 1) {
    const zonedParts = getZonedParts(candidate, timeZone);
    const zonedAsUtc = Date.UTC(
      zonedParts.year,
      zonedParts.month - 1,
      zonedParts.day,
      zonedParts.hour,
      zonedParts.minute,
      zonedParts.second,
    );
    candidate = new Date(candidate.getTime() + (targetTime - zonedAsUtc));
  }
  return candidate;
}

function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function getDateInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDaysToDateString(dateValue: string, days: number) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return d.toISOString().slice(0, 10);
}

function resolveEmployeePortalUrl() {
  const raw = (Deno.env.get("EMPLOYEE_PORTAL_URL") || "").trim();
  if (raw) {
    return raw.includes("?") || /\/(?:login|portal\/login)(?:\/)?$/i.test(raw)
      ? raw
      : `${raw}/login?returnUrl=${encodeURIComponent("/schedule")}`;
  }
  return DEFAULT_EMPLOYEE_PORTAL_URL;
}

async function authorizeRequest(
  req: Request,
  supabase: ReturnType<typeof createClient>,
) {
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return true;

  const requestSecret = (req.headers.get("x-shift-reminder-cron-secret") || "").trim();
  if (!requestSecret) return false;

  const { data, error } = await supabase
    .from("system_runtime_secrets")
    .select("secret_value")
    .eq("key_name", "scheduling_shift_reminder_cron_secret")
    .maybeSingle();

  if (error) {
    console.error("[scheduling-dispatch-shift-reminders] secret lookup", error);
    return false;
  }
  return Boolean(data?.secret_value && data.secret_value === requestSecret);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (!(await authorizeRequest(req, admin))) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {

    const { data: settingRows, error: settingsError } = await admin
      .from("scheduling_notification_settings")
      .select("business_id, settings");

    if (settingsError) throw settingsError;

    const portalUrl = resolveEmployeePortalUrl();
    let sent = 0;
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const row of settingRows || []) {
      const businessId = row.business_id as string;
      const settings = (row.settings || {}) as Record<string, { email?: boolean; sms?: boolean; hours_before?: number }>;
      const sr = settings.shift_reminder;
      if (!sr || sr.email !== true) continue;

      const hoursBefore = Math.min(168, Math.max(1, Number(sr.hours_before) || 24));
      const targetMs = hoursBefore * 3600000;

      const { data: business } = await admin
        .from("businesses")
        .select("id, timezone, name")
        .eq("id", businessId)
        .maybeSingle();

      const tz = business?.timezone || "America/Toronto";
      const now = new Date();
      const today = getDateInTimeZone(now, tz);
      const endDate = addDaysToDateString(today, 4);

      const { data: shifts, error: shiftErr } = await admin
        .from("scheduling_shifts")
        .select("id, employee_id, shift_date, start_time, end_time, position, status, is_published")
        .eq("business_id", businessId)
        .gte("shift_date", today)
        .lte("shift_date", endDate)
        .not("employee_id", "is", null);

      if (shiftErr) {
        errors.push(`${businessId}: ${shiftErr.message}`);
        continue;
      }

      const list = shifts || [];
      const empIds = [...new Set(list.map((s) => s.employee_id).filter(Boolean))] as string[];
      let nameById = new Map<string, string>();
      if (empIds.length > 0) {
        const { data: userRows } = await admin.from("users").select("id, full_name").in("id", empIds);
        nameById = new Map((userRows || []).map((u) => [u.id as string, String(u.full_name || "")]));
      }

      for (const shift of list) {
        const st = String(shift.status || "").toLowerCase();
        if (st === "cancelled") continue;
        if (shift.is_published === false) continue;
        const startTime = String(shift.start_time || "09:00:00");
        const shiftStart = zonedDateTimeToUtc(String(shift.shift_date), startTime, tz);
        const msUntil = shiftStart.getTime() - now.getTime();
        if (msUntil <= 0) continue;
        if (Math.abs(msUntil - targetMs) > MATCH_WINDOW_MS) continue;

        const { data: already } = await admin
          .from("scheduling_shift_reminder_sent")
          .select("id")
          .eq("shift_id", shift.id)
          .eq("hours_before", hoursBefore)
          .maybeSingle();

        if (already?.id) {
          skipped.push(String(shift.id));
          continue;
        }

        const employeeName = nameById.get(shift.employee_id as string) || undefined;

        const notificationRes = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/scheduling-send-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            businessId,
            eventKey: "shift_reminder",
            employeeId: shift.employee_id,
            context: {
              employeeName,
              shiftDate: shift.shift_date,
              scheduledStart: shift.start_time,
              scheduledEnd: shift.end_time,
              position: shift.position,
              hoursBeforeReminder: hoursBefore,
              portalUrl,
              shiftId: shift.id,
            },
            force: false,
          }),
        });

        const payload = await notificationRes.json().catch(() => ({}));
        if (!notificationRes.ok || payload?.ok !== true) {
          errors.push(
            `shift ${shift.id}: ${payload?.error || notificationRes.status}`,
          );
          continue;
        }

        const { error: insErr } = await admin.from("scheduling_shift_reminder_sent").insert({
          shift_id: shift.id,
          employee_id: shift.employee_id,
          hours_before: hoursBefore,
        });

        if (insErr) {
          errors.push(`log ${shift.id}: ${insErr.message}`);
          continue;
        }

        sent += 1;
      }
    }

    return json({
      ok: true,
      sent,
      skippedDuplicates: skipped.length,
      errors: errors.length ? errors : undefined,
    });
  } catch (error) {
    console.error("[scheduling-dispatch-shift-reminders]", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
