const DEFAULT_TIMEZONE = 'America/Toronto';

export const DEFAULT_GRADUAL_THROTTLE = {
  windowStartHour: 7,
  windowEndHour: 19,
  initialRatePerMinute: 10,
  dailyIncrement: 5,
  maxRatePerMinute: 100,
};

export function getTodayInTimeZone(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
}

export function dayIndexFromStart(startDate, todayDate) {
  if (!startDate || !todayDate) return 0;
  const start = new Date(`${startDate}T12:00:00Z`);
  const today = new Date(`${todayDate}T12:00:00Z`);
  const diff = Math.floor((today.getTime() - start.getTime()) / 86400000);
  return Math.max(0, Number.isFinite(diff) ? diff : 0);
}

export function mergeThrottleFromSettings(mailSettings, campaign, timeZone = DEFAULT_TIMEZONE) {
  const tz =
    campaign?.send_throttle_timezone ||
    mailSettings?.daily_digest_timezone ||
    timeZone ||
    DEFAULT_TIMEZONE;
  return {
    send_throttle_enabled: campaign?.send_throttle_enabled,
    send_throttle_started_on: campaign?.send_throttle_started_on,
    send_throttle_timezone: tz,
    send_throttle_window_start_hour:
      mailSettings?.campaign_throttle_window_start_hour ?? DEFAULT_GRADUAL_THROTTLE.windowStartHour,
    send_throttle_window_end_hour:
      mailSettings?.campaign_throttle_window_end_hour ?? DEFAULT_GRADUAL_THROTTLE.windowEndHour,
    send_throttle_initial_rate_per_minute:
      mailSettings?.campaign_throttle_initial_rate_per_minute ?? DEFAULT_GRADUAL_THROTTLE.initialRatePerMinute,
    send_throttle_daily_increment:
      mailSettings?.campaign_throttle_daily_increment ?? DEFAULT_GRADUAL_THROTTLE.dailyIncrement,
    send_throttle_max_rate_per_minute:
      mailSettings?.campaign_throttle_max_rate_per_minute ?? DEFAULT_GRADUAL_THROTTLE.maxRatePerMinute,
  };
}

export function getLocalHourInTimeZone(now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  try {
    const hourPart = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || DEFAULT_TIMEZONE,
      hour: 'numeric',
      hour12: false,
    })
      .formatToParts(now)
      .find((part) => part.type === 'hour');
    return Number(hourPart?.value ?? 0);
  } catch {
    return now.getHours();
  }
}

export function isWithinGradualSendWindow(profile, now = new Date()) {
  const tz = profile?.send_throttle_timezone || DEFAULT_TIMEZONE;
  const startHour = Number(profile?.send_throttle_window_start_hour ?? DEFAULT_GRADUAL_THROTTLE.windowStartHour);
  const endHour = Number(profile?.send_throttle_window_end_hour ?? DEFAULT_GRADUAL_THROTTLE.windowEndHour);
  const hour = getLocalHourInTimeZone(now, tz);
  return hour >= startHour && hour < endHour;
}

/** When outside the send window, schedule for today's or tomorrow's window open (local). */
export function getGradualQueueScheduledFor(profile, now = new Date()) {
  if (isWithinGradualSendWindow(profile, now)) {
    return now.toISOString();
  }

  const tz = profile?.send_throttle_timezone || DEFAULT_TIMEZONE;
  const startHour = Number(profile?.send_throttle_window_start_hour ?? DEFAULT_GRADUAL_THROTTLE.windowStartHour);
  const hour = getLocalHourInTimeZone(now, tz);
  const localDate = getTodayInTimeZone(tz);
  const targetLocalDate =
    hour >= Number(profile?.send_throttle_window_end_hour ?? DEFAULT_GRADUAL_THROTTLE.windowEndHour)
      ? addDaysToYmd(localDate, 1)
      : localDate;

  const utcGuess = new Date(`${targetLocalDate}T${String(startHour).padStart(2, '0')}:00:00`);
  const offsetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'shortOffset',
  });
  const offsetPart = offsetFormatter.formatToParts(utcGuess).find((p) => p.type === 'timeZoneName')?.value || '';
  const match = offsetPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);
  if (!match) {
    return utcGuess.toISOString();
  }
  const sign = match[1] === '-' ? -1 : 1;
  const offsetMinutes = sign * (Number(match[2]) * 60 + Number(match[3] || 0));
  return new Date(Date.UTC(
    Number(targetLocalDate.slice(0, 4)),
    Number(targetLocalDate.slice(5, 7)) - 1,
    Number(targetLocalDate.slice(8, 10)),
    startHour,
    0,
    0,
  ) - offsetMinutes * 60 * 1000).toISOString();
}

function addDaysToYmd(ymd, days) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function resolveRatePerMinute(campaign, now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const initial = Number(campaign?.send_throttle_initial_rate_per_minute ?? DEFAULT_GRADUAL_THROTTLE.initialRatePerMinute);
  const increment = Number(campaign?.send_throttle_daily_increment ?? DEFAULT_GRADUAL_THROTTLE.dailyIncrement);
  const maxRate = Number(campaign?.send_throttle_max_rate_per_minute ?? DEFAULT_GRADUAL_THROTTLE.maxRatePerMinute);
  const tz = campaign?.send_throttle_timezone || timeZone || DEFAULT_TIMEZONE;
  const startedOn = campaign?.send_throttle_started_on
    ? String(campaign.send_throttle_started_on).slice(0, 10)
    : getTodayInTimeZone(tz);
  const today = getTodayInTimeZone(tz);
  const dayIndex = dayIndexFromStart(startedOn, today);
  return Math.min(Math.max(1, initial) + dayIndex * Math.max(0, increment), Math.max(1, maxRate));
}

export function estimateGradualSendDays(recipientCount, timeZone = DEFAULT_TIMEZONE) {
  const minutesPerDay =
    (DEFAULT_GRADUAL_THROTTLE.windowEndHour - DEFAULT_GRADUAL_THROTTLE.windowStartHour) * 60;
  let remaining = recipientCount;
  let day = 0;
  let totalMinutesUsed = 0;

  while (remaining > 0 && day < 30) {
    const rate = Math.min(
      DEFAULT_GRADUAL_THROTTLE.initialRatePerMinute + day * DEFAULT_GRADUAL_THROTTLE.dailyIncrement,
      DEFAULT_GRADUAL_THROTTLE.maxRatePerMinute,
    );
    const dayCapacity = rate * minutesPerDay;
    const sent = Math.min(remaining, dayCapacity);
    remaining -= sent;
    totalMinutesUsed += Math.ceil(sent / rate);
    day += 1;
  }

  return { days: day, totalMinutesUsed, timeZone };
}
