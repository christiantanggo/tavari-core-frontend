/**
 * Multi-day booking configuration and date expansion.
 * Week-long camp: one parent booking (payment + participants) + one row per attendance day.
 */

export function parseMultiDaySettings(ticketSettings, defaultDurationMinutes = 480) {
  const multiDay = ticketSettings?.multiDay;
  if (!multiDay?.enabled) return null;

  const daysOfWeek = Array.isArray(multiDay.daysOfWeek) && multiDay.daysOfWeek.length > 0
    ? [...new Set(multiDay.daysOfWeek.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6))]
    : [1, 2, 3, 4, 5];

  return {
    enabled: true,
    dayCount: Math.max(1, Number.parseInt(multiDay.dayCount, 10) || 5),
    daysOfWeek,
    anchorDayOfWeek: Number.isFinite(Number(multiDay.anchorDayOfWeek))
      ? Number(multiDay.anchorDayOfWeek)
      : daysOfWeek[0],
    dailyDurationMinutes: Math.max(
      1,
      Number.parseInt(multiDay.dailyDurationMinutes, 10) || defaultDurationMinutes || 480,
    ),
  };
}

/**
 * Expand anchor date into attendance dates (e.g. Mon–Fri week from a Monday anchor).
 */
export function computeMultiDayDates(anchorDateIso, config = {}) {
  if (!anchorDateIso) return [];

  const dayCount = Math.max(1, config.dayCount || 5);
  const allowed = new Set(
    (config.daysOfWeek && config.daysOfWeek.length > 0)
      ? config.daysOfWeek
      : [1, 2, 3, 4, 5],
  );

  const dates = [];
  const cursor = new Date(`${anchorDateIso}T12:00:00`);
  const maxIterations = dayCount * 14;

  for (let i = 0; i < maxIterations && dates.length < dayCount; i += 1) {
    if (allowed.has(cursor.getDay())) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

export function isMultiDayParentBooking(booking) {
  return booking?.multi_day_role === 'parent';
}

export function isMultiDayDayBooking(booking) {
  return booking?.multi_day_role === 'day' && !!booking?.parent_booking_id;
}

/** Booking id staff/customer should use for detail, payment, and edits. */
export function resolveMultiDayDetailBookingId(booking) {
  if (isMultiDayDayBooking(booking)) {
    return booking.parent_booking_id;
  }
  return booking?.id || null;
}

export function shouldHideFromScheduleSlot(booking) {
  return isMultiDayParentBooking(booking);
}

/** Money rounded to cents. */
export function roundMultiDayMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Scale factor for a short week vs the priced full week.
 * Full weeks (weekDayCount >= fullWeekDayCount) stay at 1.
 */
export function getMultiDayPriceScale(weekDayCount, fullWeekDayCount) {
  const week = Math.max(0, Number(weekDayCount) || 0);
  const full = Math.max(1, Number(fullWeekDayCount) || 0);
  if (week <= 0 || week >= full) return 1;
  return week / full;
}

/**
 * Build unit-price overrides that prorate inventory prices for a shorter multi-day week.
 * Inventory price is treated as the full-week price (ticket_settings.multiDay.dayCount).
 */
export function buildMultiDayProratedPriceOverrides(
  items = [],
  { weekDayCount, fullWeekDayCount, itemIds = null } = {},
) {
  const scale = getMultiDayPriceScale(weekDayCount, fullWeekDayCount);
  if (scale >= 1) return {};

  const allow = itemIds
    ? new Set([...itemIds].map((id) => String(id)))
    : null;
  const overrides = {};
  (items || []).forEach((item) => {
    const id = item?.id != null ? String(item.id) : '';
    if (!id) return;
    if (allow && !allow.has(id)) return;
    const base = Number.parseFloat(item?.price ?? 0) || 0;
    overrides[id] = roundMultiDayMoney(base * scale);
  });
  return overrides;
}

/**
 * Merge override maps; later maps win. Used so promotions can override prorated prices.
 */
export function mergeTicketPriceOverrides(...overrideMaps) {
  const out = {};
  (overrideMaps || []).forEach((map) => {
    if (!map || typeof map !== 'object') return;
    Object.entries(map).forEach(([itemId, price]) => {
      if (itemId == null || itemId === '') return;
      if (price == null || !Number.isFinite(Number(price))) return;
      out[String(itemId)] = Number(price);
    });
  });
  return out;
}

/** Day rows may not have participants copied; inherit from multi-day parent. */
export function resolveBookingParticipants(booking, parentBookingsById) {
  const own = booking?.booking_participants || [];
  if (own.length > 0 || !booking?.parent_booking_id || !parentBookingsById) return own;
  return parentBookingsById.get(booking.parent_booking_id)?.booking_participants || own;
}
