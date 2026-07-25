/**
 * Multi-day event schedules: one booking_activity_schedules row per day
 * (start_date === end_date), grouped by schedule_name with Multi-day: prefix.
 * Customer books the series start date; following days block rooms and show on the calendar.
 */

export const MULTI_DAY_SCHEDULE_PREFIX = 'Multi-day: ';

export function isMultiDayScheduleName(scheduleName) {
  return String(scheduleName || '').trim().startsWith(MULTI_DAY_SCHEDULE_PREFIX);
}

export function stripMultiDaySchedulePrefix(scheduleName) {
  const raw = String(scheduleName || '').trim();
  if (!isMultiDayScheduleName(raw)) return raw;
  return raw.slice(MULTI_DAY_SCHEDULE_PREFIX.length).trim();
}

export function buildMultiDayScheduleName(displayName) {
  const label = String(displayName || '').trim() || 'Event';
  return `${MULTI_DAY_SCHEDULE_PREFIX}${label}`;
}

function scheduleDateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
  }
  const raw = String(value);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/** True when every row is a dated one-off and named as a multi-day series. */
export function isMultiDayEventSchedule(schedules = []) {
  if (!Array.isArray(schedules) || schedules.length === 0) return false;
  return schedules.every((schedule) => {
    const start = scheduleDateOnly(schedule.start_date);
    const end = scheduleDateOnly(schedule.end_date);
    return Boolean(start && end && start === end && isMultiDayScheduleName(schedule.schedule_name));
  });
}

export function isMultiDayScheduleRow(schedule) {
  if (!schedule) return false;
  const start = scheduleDateOnly(schedule.start_date);
  const end = scheduleDateOnly(schedule.end_date);
  return Boolean(start && end && start === end && isMultiDayScheduleName(schedule.schedule_name));
}

/**
 * Split sorted YYYY-MM-DD keys into week runs.
 * A gap of more than 2 days (e.g. Fri → next Mon = 3) starts a new week.
 */
export function splitDateKeysIntoWeekRuns(dateKeys = []) {
  const sorted = [...new Set((dateKeys || []).filter(Boolean))].sort();
  if (!sorted.length) return [];
  const runs = [];
  let current = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = current[current.length - 1];
    const next = sorted[i];
    const diffDays = (
      new Date(`${next}T12:00:00`).getTime() - new Date(`${prev}T12:00:00`).getTime()
    ) / 86400000;
    if (diffDays > 2) {
      runs.push(current);
      current = [next];
    } else {
      current.push(next);
    }
  }
  if (current.length) runs.push(current);
  return runs;
}

export function parseMultiDaySeasonLabel(scheduleName) {
  const raw = stripMultiDaySchedulePrefix(scheduleName);
  const match = String(raw || '').trim().match(/^(.*?)\s+·\s+(\d{4}-\d{2}-\d{2})$/);
  if (match) {
    return { seasonLabel: match[1].trim(), anchorDate: match[2], isWeekNamed: true };
  }
  return { seasonLabel: String(raw || '').trim(), anchorDate: null, isWeekNamed: false };
}

export function buildMultiDayWeekScheduleName(seasonLabel, anchorDateIso) {
  const season = String(seasonLabel || '').trim() || 'Event';
  const anchor = String(anchorDateIso || '').trim();
  if (!anchor) return buildMultiDayScheduleName(season);
  return buildMultiDayScheduleName(`${season} · ${anchor}`);
}

/**
 * Group multi-day schedule rows into bookable week series.
 * Same season name with many weeks → one portal card per week (start date only).
 */
export function groupMultiDaySeries(schedules = []) {
  if (!isMultiDayEventSchedule(schedules) && !schedules.some(isMultiDayScheduleRow)) {
    return [];
  }

  const byName = new Map();
  (schedules || []).forEach((schedule) => {
    if (!isMultiDayScheduleRow(schedule)) return;
    const name = String(schedule.schedule_name || '').trim();
    const dateKey = scheduleDateOnly(schedule.start_date);
    if (!name || !dateKey) return;
    if (!byName.has(name)) {
      byName.set(name, {
        scheduleName: name,
        displayName: stripMultiDaySchedulePrefix(name),
        dates: new Map(),
      });
    }
    const series = byName.get(name);
    if (!series.dates.has(dateKey)) series.dates.set(dateKey, []);
    series.dates.get(dateKey).push(schedule);
  });

  const out = [];
  byName.forEach((series) => {
    const dateKeys = [...series.dates.keys()].sort();
    const runs = splitDateKeysIntoWeekRuns(dateKeys);
    runs.forEach((runKeys) => {
      const days = runKeys.map((dateKey) => ({
        dateKey,
        slots: (series.dates.get(dateKey) || []).slice().sort((a, b) =>
          String(a.start_time || '').localeCompare(String(b.start_time || '')),
        ),
      }));
      const anchorDateKey = runKeys[0] || null;
      const { seasonLabel } = parseMultiDaySeasonLabel(series.scheduleName);
      out.push({
        scheduleName: runs.length > 1
          ? buildMultiDayWeekScheduleName(seasonLabel || series.displayName, anchorDateKey)
          : series.scheduleName,
        displayName: seasonLabel || series.displayName,
        dateKeys: runKeys,
        anchorDateKey,
        followingDateKeys: runKeys.slice(1),
        days,
        dayCount: runKeys.length,
      });
    });
  });

  return out
    .filter((series) => series.anchorDateKey)
    .sort((a, b) => a.anchorDateKey.localeCompare(b.anchorDateKey));
}

/**
 * Day count for the multi-day week that contains (or starts on) dateIso.
 * Prefers an exact anchor match, then any series that includes the date.
 */
export function resolveMultiDaySeriesDayCountForDate(schedules = [], dateIso) {
  if (!dateIso) return null;
  const seriesList = groupMultiDaySeries(schedules);
  const byAnchor = seriesList.find((series) => series.anchorDateKey === dateIso);
  if (byAnchor?.dayCount) return byAnchor.dayCount;
  const byInclude = seriesList.find((series) => (series.dateKeys || []).includes(dateIso));
  return byInclude?.dayCount || null;
}

/**
 * Portal bookable entries: one card per series, bookable on the anchor date only.
 */
export function listMultiDaySeriesPortalEntries(
  schedules = [],
  {
    todayStr = null,
    latestAllowedDateStr = null,
    isDateClosed = null,
  } = {},
) {
  return groupMultiDaySeries(schedules)
    .map((series) => {
      const anchor = series.days.find((day) => day.dateKey === series.anchorDateKey);
      if (!anchor?.slots?.length) return null;
      if (todayStr && series.anchorDateKey < todayStr) return null;
      if (latestAllowedDateStr && series.anchorDateKey > latestAllowedDateStr) return null;
      if (typeof isDateClosed === 'function' && isDateClosed(series.anchorDateKey)) return null;
      return {
        ...series,
        anchorSlots: anchor.slots,
      };
    })
    .filter(Boolean);
}

/**
 * When multiDay is enabled on the activity but rows aren't Multi-day: named,
 * only expose dates matching the anchor weekday (e.g. Mondays) as bookable starts.
 */
export function listMultiDayAnchorPortalEntriesFromConfig(
  schedules = [],
  multiDayConfig = null,
  {
    todayStr = null,
    latestAllowedDateStr = null,
    isDateClosed = null,
  } = {},
) {
  if (!multiDayConfig?.enabled) return [];
  const anchorDow = Number.isFinite(Number(multiDayConfig.anchorDayOfWeek))
    ? Number(multiDayConfig.anchorDayOfWeek)
    : (Array.isArray(multiDayConfig.daysOfWeek) && multiDayConfig.daysOfWeek.length
      ? Number(multiDayConfig.daysOfWeek[0])
      : 1);

  const byDate = new Map();
  (schedules || []).forEach((schedule) => {
    const start = scheduleDateOnly(schedule.start_date);
    const end = scheduleDateOnly(schedule.end_date);
    if (!start || !end || start !== end) return;
    const dow = new Date(`${start}T12:00:00`).getDay();
    if (dow !== anchorDow) return;
    if (!byDate.has(start)) byDate.set(start, []);
    byDate.get(start).push(schedule);
  });

  return [...byDate.keys()]
    .sort()
    .filter((dateKey) => {
      if (todayStr && dateKey < todayStr) return false;
      if (latestAllowedDateStr && dateKey > latestAllowedDateStr) return false;
      if (typeof isDateClosed === 'function' && isDateClosed(dateKey)) return false;
      return true;
    })
    .map((dateKey) => {
      const slots = (byDate.get(dateKey) || []).slice().sort((a, b) =>
        String(a.start_time || '').localeCompare(String(b.start_time || '')),
      );
      const dayCount = Math.max(1, Number.parseInt(multiDayConfig.dayCount, 10) || 5);
      return {
        scheduleName: `week-start:${dateKey}`,
        displayName: null,
        dateKeys: [dateKey],
        anchorDateKey: dateKey,
        followingDateKeys: [],
        days: [{ dateKey, slots }],
        anchorSlots: slots,
        dayCount,
      };
    })
    .filter((row) => row.anchorSlots.length > 0);
}

/** True when the portal should only offer series start dates (not every attendance day). */
export function shouldUseMultiDayPortalListing(schedules = [], ticketSettings = null) {
  if (ticketSettings?.multiDay?.enabled) return true;
  if (isMultiDayEventSchedule(schedules)) return true;
  if ((schedules || []).some(isMultiDayScheduleRow)) return true;
  return false;
}

/** Derive ticket_settings.multiDay from an ordered list of YYYY-MM-DD dates. */
export function buildMultiDayTicketSettingsFromDates(dateKeys = [], dailyDurationMinutes = 480) {
  const dates = [...new Set((dateKeys || []).filter(Boolean))].sort();
  if (!dates.length) return null;
  const daysOfWeek = [...new Set(dates.map((d) => new Date(`${d}T12:00:00`).getDay()))].sort();
  return {
    enabled: true,
    dayCount: dates.length,
    daysOfWeek: daysOfWeek.length ? daysOfWeek : [1, 2, 3, 4, 5],
    anchorDayOfWeek: new Date(`${dates[0]}T12:00:00`).getDay(),
    dailyDurationMinutes: Math.max(1, Number.parseInt(dailyDurationMinutes, 10) || 480),
  };
}

/** Next matching weekdays starting from startDate inclusive. */
export function listWeekdayRunFromStart(startDateIso, dayCount = 5, daysOfWeek = [1, 2, 3, 4, 5]) {
  if (!startDateIso) return [];
  const allowed = new Set(
    (Array.isArray(daysOfWeek) && daysOfWeek.length
      ? daysOfWeek
      : [1, 2, 3, 4, 5]
    ).map((d) => Number(d)).filter((d) => d >= 0 && d <= 6),
  );
  if (!allowed.size) return [];
  const targetCount = Math.max(1, Math.min(7, Number.parseInt(dayCount, 10) || allowed.size));
  const out = [];
  const cursor = new Date(`${startDateIso}T12:00:00`);
  const max = targetCount * 14;
  for (let i = 0; i < max && out.length < targetCount; i += 1) {
    if (allowed.has(cursor.getDay())) {
      out.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/** Dates in the calendar week of startDate that match daysOfWeek (does not spill into next week). */
export function listSelectedDaysInWeekOf(startDateIso, daysOfWeek = [1, 2, 3, 4, 5]) {
  if (!startDateIso) return [];
  const allowed = new Set(
    (Array.isArray(daysOfWeek) && daysOfWeek.length
      ? daysOfWeek
      : [1, 2, 3, 4, 5]
    ).map((d) => Number(d)).filter((d) => d >= 0 && d <= 6),
  );
  const start = new Date(`${startDateIso}T12:00:00`);
  const weekStart = new Date(start);
  // Align to Sunday of that week, then collect Mon–Sun window
  weekStart.setDate(start.getDate() - start.getDay());
  const out = [];
  for (let i = 0; i < 7; i += 1) {
    const cursor = new Date(weekStart);
    cursor.setDate(weekStart.getDate() + i);
    if (allowed.has(cursor.getDay())) {
      out.push(cursor.toISOString().slice(0, 10));
    }
  }
  return out;
}
