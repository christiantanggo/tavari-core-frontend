import { Temporal } from "npm:@js-temporal/polyfill@0.4.4";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type CampaignThrottleFields = {
  send_throttle_enabled?: boolean | null;
  send_throttle_started_on?: string | null;
  send_throttle_timezone?: string | null;
  send_throttle_window_start_hour?: number | null;
  send_throttle_window_end_hour?: number | null;
  send_throttle_initial_rate_per_minute?: number | null;
  send_throttle_daily_increment?: number | null;
  send_throttle_max_rate_per_minute?: number | null;
};

const DEFAULT_TIMEZONE = "America/Toronto";

export function resolveThrottleTimezone(campaign: CampaignThrottleFields | null | undefined) {
  const tz = String(campaign?.send_throttle_timezone || "").trim();
  return tz || DEFAULT_TIMEZONE;
}

export function getLocalDateString(now: Date, timeZone: string) {
  const tz = String(timeZone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  return Temporal.Instant.from(now.toISOString())
    .toZonedDateTimeISO(tz)
    .toPlainDate()
    .toString();
}

export function getLocalHour(now: Date, timeZone: string) {
  const tz = String(timeZone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  return Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(tz).hour;
}

export function isWithinSendWindow(
  now: Date,
  timeZone: string,
  startHour: number,
  endHour: number,
) {
  const hour = getLocalHour(now, timeZone);
  return hour >= startHour && hour < endHour;
}

export type MailSettingsThrottleFields = {
  campaign_throttle_window_start_hour?: number | null;
  campaign_throttle_window_end_hour?: number | null;
  campaign_throttle_initial_rate_per_minute?: number | null;
  campaign_throttle_daily_increment?: number | null;
  campaign_throttle_max_rate_per_minute?: number | null;
  daily_digest_timezone?: string | null;
};

/** Live rates/window from mail_settings; started_on/timezone stay on the campaign row. */
export function mergeThrottleConfig(
  campaign: CampaignThrottleFields | null | undefined,
  mailSettings: MailSettingsThrottleFields | null | undefined,
): CampaignThrottleFields {
  return {
    send_throttle_enabled: campaign?.send_throttle_enabled,
    send_throttle_started_on: campaign?.send_throttle_started_on,
    send_throttle_timezone:
      campaign?.send_throttle_timezone ||
      mailSettings?.daily_digest_timezone ||
      null,
    send_throttle_window_start_hour:
      mailSettings?.campaign_throttle_window_start_hour ??
      campaign?.send_throttle_window_start_hour ??
      7,
    send_throttle_window_end_hour:
      mailSettings?.campaign_throttle_window_end_hour ??
      campaign?.send_throttle_window_end_hour ??
      19,
    send_throttle_initial_rate_per_minute:
      mailSettings?.campaign_throttle_initial_rate_per_minute ??
      campaign?.send_throttle_initial_rate_per_minute ??
      10,
    send_throttle_daily_increment:
      mailSettings?.campaign_throttle_daily_increment ??
      campaign?.send_throttle_daily_increment ??
      5,
    send_throttle_max_rate_per_minute:
      mailSettings?.campaign_throttle_max_rate_per_minute ??
      campaign?.send_throttle_max_rate_per_minute ??
      100,
  };
}

export function resolveThrottleRatePerMinute(
  campaign: CampaignThrottleFields,
  now: Date,
) {
  const initial = Math.max(1, Number(campaign.send_throttle_initial_rate_per_minute ?? 10));
  const increment = Math.max(0, Number(campaign.send_throttle_daily_increment ?? 5));
  const maxRate = Math.max(initial, Number(campaign.send_throttle_max_rate_per_minute ?? 100));
  const tz = resolveThrottleTimezone(campaign);
  const startedOn = String(campaign.send_throttle_started_on || "").slice(0, 10);

  if (!startedOn) {
    return Math.min(initial, maxRate);
  }

  const today = getLocalDateString(now, tz);
  const start = Temporal.PlainDate.from(startedOn);
  const end = Temporal.PlainDate.from(today);
  const dayIndex = Math.max(0, start.until(end).days);
  return Math.min(initial + dayIndex * increment, maxRate);
}

export function getLocalMinuteBucketUtcRange(now: Date, timeZone: string) {
  const tz = String(timeZone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  const zdt = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(tz);
  const bucketStart = zdt.with({
    second: 0,
    millisecond: 0,
    microsecond: 0,
    nanosecond: 0,
  });
  const bucketEnd = bucketStart.add({ minutes: 1 });
  return {
    startIso: bucketStart.toInstant().toString(),
    endIso: bucketEnd.toInstant().toString(),
  };
}

export async function countThrottledCampaignSendsInLocalMinute(
  supabase: SupabaseClient,
  campaignId: string,
  now: Date,
  timeZone: string,
) {
  const { startIso, endIso } = getLocalMinuteBucketUtcRange(now, timeZone);
  const { count, error } = await supabase
    .from("mail_sending_queue")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .in("status", ["sent", "processing"])
    .gte("processed_at", startIso)
    .lt("processed_at", endIso);

  if (error) throw error;
  return Number(count || 0);
}

export function isThrottledMarketingCampaignItem(
  item: Record<string, unknown>,
  campaign: CampaignThrottleFields | null | undefined,
) {
  if (item.rollout_id) return false;
  if (item.automation_id) return false;
  return campaign?.send_throttle_enabled === true;
}

export function isHighPriorityQueueItem(
  item: Record<string, unknown>,
  automationContext: Record<string, unknown>,
) {
  if (item.rollout_id) return true;
  if (item.automation_id) return true;
  if (Number(item.priority) < 5) return true;
  if (String(automationContext?.email_type || item.email_type || "").toLowerCase() === "transactional") {
    return true;
  }
  return false;
}

export function describeThrottlePlan(campaign: CampaignThrottleFields, now: Date) {
  const tz = resolveThrottleTimezone(campaign);
  const rate = resolveThrottleRatePerMinute(campaign, now);
  const startHour = Number(campaign.send_throttle_window_start_hour ?? 7);
  const endHour = Number(campaign.send_throttle_window_end_hour ?? 19);
  const inWindow = isWithinSendWindow(now, tz, startHour, endHour);
  return {
    timezone: tz,
    ratePerMinute: rate,
    inWindow,
    windowLabel: `${startHour}:00–${endHour}:00`,
  };
}
