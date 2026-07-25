import { Temporal } from "npm:@js-temporal/polyfill@0.4.4";

export type LocalSendWindow = {
  start_hour: number;
  end_hour: number;
  minute_offset: number;
};

/**
 * Interprets `dateString` (YYYY-MM-DD) as a calendar date in `timeZone`, combines with
 * local `hour` / `minute`, and returns the corresponding UTC instant as ISO-8601 Z.
 */
export function localWallDateTimeToUtcIso(
  dateString: string,
  hour: number,
  minute: number,
  timeZone: string,
): string {
  const tz = String(timeZone || "America/Toronto").trim() || "America/Toronto";
  const plainDate = Temporal.PlainDate.from(String(dateString || "1970-01-01").slice(0, 10));
  const plainDateTime = plainDate.toPlainDateTime({
    hour,
    minute,
    second: 0,
    millisecond: 0,
    microsecond: 0,
    nanosecond: 0,
  });
  const zdt = plainDateTime.toZonedDateTime(tz, { disambiguation: "compatible" });
  return zdt.toInstant().toString();
}

/**
 * Spreads `totalRecipients` sends across whole local hours from `sendWindow.start_hour`
 * through `sendWindow.end_hour` (inclusive), mirroring prior automation behavior.
 */
export function buildStaggeredSendSlots(
  totalRecipients: number,
  sendDate: string,
  timeZone: string,
  sendWindow: LocalSendWindow,
) {
  const slotCount = sendWindow.end_hour - sendWindow.start_hour + 1;
  if (totalRecipients <= 0) return [];

  const tz = String(timeZone || "America/Toronto").trim() || "America/Toronto";

  return Array.from({ length: totalRecipients }, (_, index) => {
    const slotIndex = totalRecipients <= slotCount
      ? index
      : Math.floor((index * slotCount) / totalRecipients);
    const localHour = sendWindow.start_hour + Math.min(slotIndex, slotCount - 1);
    const localMinute = sendWindow.minute_offset;
    return {
      local_hour: localHour,
      local_minute: localMinute,
      local_time: `${sendDate} ${String(localHour).padStart(2, "0")}:${String(localMinute).padStart(2, "0")}`,
      scheduled_for: localWallDateTimeToUtcIso(sendDate, localHour, localMinute, tz),
      time_zone: tz,
    };
  });
}

/** Ensures queue rows are not scheduled in the past when the job runs late in the window. */
export function clampScheduledForNotBeforeNow(scheduledIso: string, now: Date): string {
  const scheduledMs = new Date(scheduledIso).getTime();
  return new Date(Math.max(scheduledMs, now.getTime())).toISOString();
}
