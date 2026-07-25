/** Toddler Thursday: bi-weekly promo Thursdays, Thursday morning send, 50/50 cohort rotation. */

export type ToddlerThursdayCriteria = {
  promo_anchor_date?: string | null;
  toddler_min_age_years?: number | null;
  toddler_max_age_years?: number | null;
  send_day_of_week?: number | null;
  send_window?: {
    start_hour?: number | null;
    end_hour?: number | null;
    minute_offset?: number | null;
  } | null;
  offer_price_label?: string | null;
  promo_code?: string | null;
  min_toddler_count_for_offer?: number | null;
  booking_window_label?: string | null;
};

export type ToddlerThursdayScheduleGate = {
  ok: boolean;
  skipped_reason?: string;
  today_local?: string;
  promo_thursday_date?: string;
  send_local_date?: string;
  active_cohort?: "A" | "B";
  promo_cycle_index?: number;
  weeks_since_anchor?: number;
};

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const PROMO_DOW = 4; // Thursday

export function getLocalWeekday(date: Date, timeZone: string): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || "America/Toronto",
    weekday: "short",
  }).format(date);
  return WEEKDAY_MAP[wd] ?? 0;
}

export function getLocalHourMinute(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || "America/Toronto",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  return { hour: get("hour"), minute: get("minute") };
}

export function getDateStringInTimeZone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function shiftDateString(dateString: string, dayDelta: number): string {
  const [year, month, day] = String(dateString || "1970-01-01")
    .split("-")
    .map((value) => Number(value) || 0);
  const date = new Date(Date.UTC(year, Math.max(month - 1, 0), day || 1));
  date.setUTCDate(date.getUTCDate() + dayDelta);
  return date.toISOString().slice(0, 10);
}

function daysBetweenUtcDates(fromYmd: string, toYmd: string): number {
  const from = new Date(`${fromYmd}T12:00:00Z`).getTime();
  const to = new Date(`${toYmd}T12:00:00Z`).getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

/** Stable A/B from contact id (or email fallback). */
export function getContactCohort(contactId: string, email: string): "A" | "B" {
  const key = String(contactId || email || "");
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = Math.imul(31, hash) + key.charCodeAt(i) | 0;
  }
  return (Math.abs(hash) % 2) === 0 ? "A" : "B";
}

export function getActiveCohortForPromoCycle(promoCycleIndex: number): "A" | "B" {
  return promoCycleIndex % 2 === 0 ? "A" : "B";
}

export function formatToddlerNamesList(names: string[]): string {
  const cleaned = [...new Set(names.map((n) => String(n || "").trim()).filter(Boolean))];
  if (cleaned.length === 0) return "";
  if (cleaned.length === 1) return cleaned[0]!;
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(", ")}, and ${cleaned[cleaned.length - 1]}`;
}

export function formatPromoThursdayDisplay(ymd: string, timeZone: string): string {
  try {
    const dt = new Date(`${ymd}T12:00:00`);
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "America/Toronto",
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(dt);
  } catch {
    return ymd;
  }
}

export function buildToddlerThursdayOfferDetails(criteria: ToddlerThursdayCriteria): string {
  const minCount = Math.max(2, Number(criteria.min_toddler_count_for_offer ?? 2));
  const price = String(criteria.offer_price_label || "$7").trim() || "$7";
  const code = String(criteria.promo_code || "DCT2026").trim() || "DCT2026";
  const window = String(criteria.booking_window_label || "10:00 AM – 1:00 PM").trim();
  return (
    `Book the Toddler Thursday session online (${window}). Enter promo code ${code} at checkout. ` +
    `When ${minCount} or more toddlers are in your booking, each admission is ${price}.`
  );
}

function evaluatePromoThursdayWeek(
  anchor: string,
  promoThursdayDate: string,
): { ok: boolean; skipped_reason?: string; weeks_since_anchor?: number; promo_cycle_index?: number; active_cohort?: "A" | "B" } {
  const weeksSinceAnchor = Math.floor(daysBetweenUtcDates(anchor, promoThursdayDate) / 7);
  if (weeksSinceAnchor < 0) {
    return { ok: false, skipped_reason: "before_promo_anchor", weeks_since_anchor: weeksSinceAnchor };
  }
  if (weeksSinceAnchor % 2 !== 0) {
    return {
      ok: false,
      skipped_reason: "not_biweekly_promo_week",
      weeks_since_anchor: weeksSinceAnchor,
    };
  }
  const promoCycleIndex = Math.floor(weeksSinceAnchor / 2);
  return {
    ok: true,
    weeks_since_anchor: weeksSinceAnchor,
    promo_cycle_index: promoCycleIndex,
    active_cohort: getActiveCohortForPromoCycle(promoCycleIndex),
  };
}

export function resolveToddlerThursdaySchedule(
  now: Date,
  timeZone: string,
  criteria: ToddlerThursdayCriteria,
): ToddlerThursdayScheduleGate {
  const tz = String(timeZone || "America/Toronto").trim() || "America/Toronto";
  const todayLocal = getDateStringInTimeZone(now, timeZone);
  const todayDow = getLocalWeekday(now, tz);
  const sendDow = Number(criteria.send_day_of_week ?? PROMO_DOW);

  const anchor = String(criteria.promo_anchor_date || "").slice(0, 10);
  if (!anchor || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)) {
    return { ok: false, skipped_reason: "promo_anchor_date_missing", today_local: todayLocal };
  }

  if (todayDow !== sendDow) {
    return { ok: false, skipped_reason: "not_send_day", today_local: todayLocal };
  }

  if (todayDow !== PROMO_DOW) {
    return { ok: false, skipped_reason: "not_promo_thursday", today_local: todayLocal };
  }

  const promoThursdayDate = todayLocal;
  const promoWeek = evaluatePromoThursdayWeek(anchor, promoThursdayDate);
  if (!promoWeek.ok) {
    return {
      ok: false,
      skipped_reason: promoWeek.skipped_reason,
      today_local: todayLocal,
      promo_thursday_date: promoThursdayDate,
      weeks_since_anchor: promoWeek.weeks_since_anchor,
    };
  }

  const sendWindow = criteria.send_window && typeof criteria.send_window === "object"
    ? criteria.send_window
    : {};
  const startHour = Number(sendWindow.start_hour ?? 6);
  const endHour = Number(sendWindow.end_hour ?? 9);
  const minuteOffset = Number(sendWindow.minute_offset ?? 0);
  const { hour, minute } = getLocalHourMinute(now, tz);
  const nowMinutes = hour * 60 + minute;
  const windowStart = startHour * 60 + minuteOffset;
  const windowEnd = endHour * 60 + 59;

  if (nowMinutes < windowStart || nowMinutes > windowEnd) {
    return {
      ok: false,
      skipped_reason: "outside_send_window",
      today_local: todayLocal,
      promo_thursday_date: promoThursdayDate,
    };
  }

  return {
    ok: true,
    today_local: todayLocal,
    send_local_date: todayLocal,
    promo_thursday_date: promoThursdayDate,
    active_cohort: promoWeek.active_cohort,
    promo_cycle_index: promoWeek.promo_cycle_index,
    weeks_since_anchor: promoWeek.weeks_since_anchor,
  };
}

export function buildToddlerThursdayDeliveryKey(promoThursdayDate: string, contactId: string): string {
  return `toddler-thursday:${promoThursdayDate}:${contactId}`;
}

/** Preview: evaluate schedule for a send calendar date (skips live send-window clock). */
export function resolveToddlerThursdayPreviewSchedule(
  sendLocalDate: string,
  timeZone: string,
  criteria: ToddlerThursdayCriteria,
): ToddlerThursdayScheduleGate {
  const tz = String(timeZone || "America/Toronto").trim() || "America/Toronto";
  const sendDate = String(sendLocalDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sendDate)) {
    return { ok: false, skipped_reason: "invalid_send_date", today_local: sendDate };
  }

  const anchor = String(criteria.promo_anchor_date || "").slice(0, 10);
  if (!anchor || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)) {
    return { ok: false, skipped_reason: "promo_anchor_date_missing", today_local: sendDate };
  }

  const sendProbe = new Date(`${sendDate}T12:00:00`);
  const sendDow = getLocalWeekday(sendProbe, tz);
  const expectedSendDow = Number(criteria.send_day_of_week ?? PROMO_DOW);
  if (sendDow !== expectedSendDow) {
    return {
      ok: false,
      skipped_reason: "not_send_day",
      today_local: sendDate,
      send_local_date: sendDate,
    };
  }

  if (sendDow !== PROMO_DOW) {
    return {
      ok: false,
      skipped_reason: "not_promo_thursday",
      today_local: sendDate,
      send_local_date: sendDate,
    };
  }

  const promoThursdayDate = sendDate;
  const promoWeek = evaluatePromoThursdayWeek(anchor, promoThursdayDate);
  if (!promoWeek.ok) {
    return {
      ok: false,
      skipped_reason: promoWeek.skipped_reason,
      today_local: sendDate,
      send_local_date: sendDate,
      promo_thursday_date: promoThursdayDate,
      weeks_since_anchor: promoWeek.weeks_since_anchor,
    };
  }

  return {
    ok: true,
    today_local: sendDate,
    send_local_date: sendDate,
    promo_thursday_date: promoThursdayDate,
    active_cohort: promoWeek.active_cohort,
    promo_cycle_index: promoWeek.promo_cycle_index,
    weeks_since_anchor: promoWeek.weeks_since_anchor,
  };
}
