import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-scheduling-attendance-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: corsHeaders });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const isAuthorized = await authorize(req, supabase);
    if (!isAuthorized) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const businessId = String(body.businessId || "");
    const startDate = String(body.startDate || getDateInTimeZone(addMinutes(new Date(), -1440)));
    const endDate = String(body.endDate || getDateInTimeZone(new Date()));
    const graceMinutes = Number(body.graceMinutes ?? 15);
    const breakThresholdMinutes = Number(body.breakThresholdMinutes ?? 360);

    const businessIds = businessId
      ? [businessId]
      : await getBusinessesToScan(supabase, startDate, endDate);

    const scanResults = [];
    for (const currentBusinessId of businessIds) {
      scanResults.push(await scanBusiness({
        supabase,
        businessId: currentBusinessId,
        startDate,
        endDate,
        graceMinutes,
        breakThresholdMinutes,
      }));
    }

    return json({
      ok: true,
      startDate,
      endDate,
      businessCount: businessIds.length,
      scannedShiftCount: scanResults.reduce((sum, result) => sum + result.scannedShiftCount, 0),
      triggered: scanResults.flatMap((result) => result.triggered),
      skippedDuplicates: scanResults.flatMap((result) => result.skippedDuplicates),
    });
  } catch (error) {
    console.error("[scheduling-scan-attendance-alerts] error", error);
    return json({ error: getErrorMessage(error), details: serializeError(error) }, 500);
  }
});

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || "Unknown error");
  }
  return "Unknown error";
}

function serializeError(error: unknown) {
  try {
    return JSON.parse(JSON.stringify(error));
  } catch {
    return String(error);
  }
}

async function authorize(req: Request, supabase: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return true;

  const requestSecret = req.headers.get("x-scheduling-attendance-secret") || "";
  if (!requestSecret) return false;

  const { data, error } = await supabase
    .from("system_runtime_secrets")
    .select("secret_value")
    .eq("key_name", "scheduling_attendance_scan_secret")
    .maybeSingle();

  if (error) {
    console.error("[scheduling-scan-attendance-alerts] secret lookup failed", error);
    return false;
  }

  return Boolean(data?.secret_value && data.secret_value === requestSecret);
}

async function getBusinessesToScan(
  supabase: ReturnType<typeof createClient>,
  startDate: string,
  endDate: string,
) {
  const { data, error } = await supabase
    .from("scheduling_shifts")
    .select("business_id")
    .gte("shift_date", startDate)
    .lte("shift_date", endDate)
    .in("status", ["scheduled", "confirmed"]);

  if (error) throw error;

  return Array.from(new Set((data || []).map((row) => row.business_id).filter(Boolean)));
}

async function scanBusiness(input: {
  supabase: ReturnType<typeof createClient>;
  businessId: string;
  startDate: string;
  endDate: string;
  graceMinutes: number;
  breakThresholdMinutes: number;
}) {
  const {
    supabase,
    businessId,
    startDate,
    endDate,
    graceMinutes,
    breakThresholdMinutes,
  } = input;

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("timezone")
      .eq("id", businessId)
      .maybeSingle();
    if (businessError) throw businessError;

    const timeZone = String(business?.timezone || "America/Toronto");

    const { data: shifts, error: shiftError } = await supabase
      .from("scheduling_shifts")
      .select("id,business_id,employee_id,shift_date,start_time,end_time,position,status")
      .eq("business_id", businessId)
      .gte("shift_date", startDate)
      .lte("shift_date", endDate)
      .in("status", ["scheduled", "confirmed"]);
    if (shiftError) throw shiftError;

    const dayStart = zonedDateTimeToUtc(startDate, "00:00:00", timeZone);
    const dayAfterEnd = zonedDateTimeToUtc(addDaysToDateString(endDate, 1), "00:00:00", timeZone);

    const [{ data: clocks, error: clockError }, { data: breaks, error: breakError }] = await Promise.all([
      supabase
        .from("scheduling_time_clocks")
        .select("id,employee_id,clock_in_time,clock_out_time")
        .eq("business_id", businessId)
        .gte("clock_in_time", dayStart.toISOString())
        .lt("clock_in_time", dayAfterEnd.toISOString()),
      supabase
        .from("scheduling_break_tracking")
        .select("id,employee_id,break_start_at,break_end_at,break_type,duration_minutes,is_paid")
        .eq("business_id", businessId)
        .gte("break_start_at", dayStart.toISOString())
        .lt("break_start_at", dayAfterEnd.toISOString()),
    ]);
    if (clockError) throw clockError;
    if (breakError) throw breakError;

    const triggered = [];
    const skippedDuplicates = [];
    const now = new Date();

    for (const shift of shifts || []) {
      if (!shift.employee_id || !shift.start_time || !shift.end_time) continue;

      const start = zonedDateTimeToUtc(String(shift.shift_date), String(shift.start_time), timeZone);
      const end = zonedDateTimeToUtc(String(shift.shift_date), String(shift.end_time), timeZone);
      const normalizedEnd = end <= start ? addMinutes(end, 1440) : end;
      const matchingClocks = (clocks || []).filter((clock) => {
        const clockIn = new Date(clock.clock_in_time);
        return clock.employee_id === shift.employee_id &&
          clockIn >= addMinutes(start, -180) &&
          clockIn <= addMinutes(normalizedEnd, 180);
      });

      if (matchingClocks.length === 0 && now > addMinutes(start, graceMinutes)) {
        const context = {
          shiftId: shift.id,
          shiftDate: shift.shift_date,
          scheduledStart: start.toISOString(),
          scheduledEnd: normalizedEnd.toISOString(),
          graceMinutes,
        };
        const claim = await claimAlert(supabase, businessId, shift, "missed_clock_in", context);
        if (!claim.claimed) {
          skippedDuplicates.push({ eventKey: "missed_clock_in", shiftId: shift.id });
          continue;
        }
        triggered.push(await notifyAndRecord(supabase, claim.id, "missed_clock_in", businessId, shift, context));
        continue;
      }

      const shiftMinutes = (normalizedEnd.getTime() - start.getTime()) / 60000;
      if (shiftMinutes >= breakThresholdMinutes) {
        const hasUnpaidBreak = (breaks || []).some((item) => {
          const breakStart = new Date(item.break_start_at);
          return item.employee_id === shift.employee_id &&
            item.is_paid !== true &&
            item.break_type !== "paid" &&
            breakStart >= start &&
            breakStart <= normalizedEnd &&
            Number(item.duration_minutes || 0) > 0;
        });

        if (!hasUnpaidBreak && now > normalizedEnd) {
          const context = {
            shiftId: shift.id,
            shiftDate: shift.shift_date,
            scheduledStart: start.toISOString(),
            scheduledEnd: normalizedEnd.toISOString(),
            scheduledMinutes: shiftMinutes,
          };
          const claim = await claimAlert(supabase, businessId, shift, "missed_break", context);
          if (!claim.claimed) {
            skippedDuplicates.push({ eventKey: "missed_break", shiftId: shift.id });
            continue;
          }
          triggered.push(await notifyAndRecord(supabase, claim.id, "missed_break", businessId, shift, context));
        }
      }
    }

  return {
    businessId,
    scannedShiftCount: shifts?.length || 0,
    triggered,
    skippedDuplicates,
  };
}

async function claimAlert(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  shift: Record<string, unknown>,
  eventKey: string,
  context: Record<string, unknown>,
) {
  const { data, error } = await supabase
    .from("scheduling_attendance_alert_deliveries")
    .insert({
      business_id: businessId,
      shift_id: shift.id,
      employee_id: shift.employee_id,
      event_key: eventKey,
      status: "processing",
      context,
    })
    .select("id")
    .single();

  if (!error) return { claimed: true, id: data?.id };
  if (String(error.code) === "23505") return { claimed: false, id: null };
  throw error;
}

async function notifyAndRecord(
  supabase: ReturnType<typeof createClient>,
  deliveryId: string,
  eventKey: string,
  businessId: string,
  shift: Record<string, unknown>,
  context: Record<string, unknown>,
) {
  const result = await notify(eventKey, businessId, shift, context);
  await supabase
    .from("scheduling_attendance_alert_deliveries")
    .update({
      status: result.ok ? "sent" : "failed",
      sent_at: result.ok ? new Date().toISOString() : null,
      response: result,
      error_message: result.ok ? null : JSON.stringify(result.result || result.error || "Unknown send failure"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", deliveryId);

  return result;
}

function getDateInTimeZone(date: Date, timeZone = "America/Toronto") {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

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

function addDaysToDateString(dateValue: string, days: number) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

async function notify(eventKey: string, businessId: string, shift: Record<string, unknown>, context: Record<string, unknown>) {
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/scheduling-send-notification`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      businessId,
      eventKey,
      employeeId: shift.employee_id,
      context: {
        ...context,
        employeeId: shift.employee_id,
        position: shift.position,
      },
    }),
  });

  return {
    eventKey,
    shiftId: shift.id,
    ok: response.ok,
    result: await response.json().catch(() => null),
  };
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60000);
}
