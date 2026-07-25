import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/** @typedef {{ start: number, end: number }} MinuteInterval */

export function mergeIntervals(intervals) {
  if (!intervals?.length) return [];
  const sorted = [...intervals].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  if (!sorted.length) return [];
  const out = [];
  let cur = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n.start <= cur.end) cur.end = Math.max(cur.end, n.end);
    else {
      out.push(cur);
      cur = { ...n };
    }
  }
  out.push(cur);
  return out;
}

export function intersectIntervals(a, b) {
  const out = [];
  for (const x of a) {
    for (const y of b) {
      const s = Math.max(x.start, y.start);
      const e = Math.min(x.end, y.end);
      if (e > s) out.push({ start: s, end: e });
    }
  }
  return mergeIntervals(out);
}

export function subtractIntervals(from, subtract) {
  if (!from?.length) return [];
  if (!subtract?.length) return mergeIntervals(from);
  let result = mergeIntervals(from);
  for (const sub of mergeIntervals(subtract)) {
    const next = [];
    for (const iv of result) {
      if (sub.end <= iv.start || sub.start >= iv.end) {
        next.push(iv);
        continue;
      }
      if (sub.start > iv.start) next.push({ start: iv.start, end: Math.min(iv.end, sub.start) });
      if (sub.end < iv.end) next.push({ start: Math.max(iv.start, sub.end), end: iv.end });
    }
    result = mergeIntervals(next);
  }
  return result;
}

export function totalMinutes(intervals) {
  return mergeIntervals(intervals).reduce((s, i) => s + (i.end - i.start), 0);
}

export function parseTimeToMinutes(val) {
  if (val == null || val === '') return null;
  const s = String(val).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  return h * 60 + min;
}

/**
 * Paid work within one calendar day (local): [startMin, endMin) with 0 <= start < end <= 1440.
 */
export function splitClockIntoDailyPaidPieces(clockInIso, clockOutIso, tz) {
  const ci = dayjs(clockInIso).tz(tz);
  const co = dayjs(clockOutIso).tz(tz);
  if (!ci.isValid() || !co.isValid() || !co.isAfter(ci)) return [];
  const pieces = [];
  let cur = ci;
  while (cur.isBefore(co)) {
    const dayStart = cur.startOf('day');
    const nextDay = dayStart.add(1, 'day');
    const segEnd = co.isBefore(nextDay) ? co : nextDay;
    const startMin = cur.diff(dayStart, 'minute');
    const endMin = segEnd.diff(dayStart, 'minute');
    if (endMin > startMin) {
      pieces.push({
        dateKey: dayStart.format('YYYY-MM-DD'),
        startMin,
        endMin
      });
    }
    cur = segEnd;
  }
  return pieces;
}

/** Daily window in minutes-of-day; supports overnight when startMin > endMin (wrap within same 24h calendar — rare). */
export function dailyWindowMaskMinutes(startMin, endMin) {
  if (startMin == null || endMin == null) return [];
  if (startMin === endMin) return [];
  if (startMin < endMin) return [{ start: startMin, end: endMin }];
  return [
    { start: startMin, end: 1440 },
    { start: 0, end: endMin }
  ];
}

export function expandedPublicMinutesForDate(dateKey, operatingHours, tz, bufferBefore, bufferAfter) {
  const dow = dayjs.tz(`${dateKey}T12:00:00`, tz).format('dddd').toLowerCase();
  const cfg = operatingHours?.[dow];
  if (!cfg || cfg.closed === true) return { inside: [], outsideAllDay: [{ start: 0, end: 1440 }] };

  const openM = parseTimeToMinutes(cfg.open);
  const closeM = parseTimeToMinutes(cfg.close);
  if (openM == null || closeM == null) return { inside: [], outsideAllDay: [{ start: 0, end: 1440 }] };

  let openAdj = openM - (bufferBefore || 0);
  let closeAdj = closeM + (bufferAfter || 0);
  openAdj = Math.max(0, openAdj);
  closeAdj = Math.min(1440, closeAdj);

  if (closeM >= openM) {
    const inside =
      closeAdj > openAdj ? [{ start: openAdj, end: closeAdj }] : [];
    const outside = [];
    if (openAdj > 0) outside.push({ start: 0, end: openAdj });
    if (closeAdj < 1440) outside.push({ start: closeAdj, end: 1440 });
    return { inside: mergeIntervals(inside), outside: mergeIntervals(outside) };
  }

  const insideOvernight = dailyWindowMaskMinutes(openAdj, closeAdj);
  const outside = subtractIntervals([{ start: 0, end: 1440 }], insideOvernight);
  return { inside: mergeIntervals(insideOvernight), outside: mergeIntervals(outside) };
}

/**
 * Split intervals produced by buildPaidWorkIntervalsMinutes (minute offsets from clock-in date midnight; end may exceed 1440)
 * into per-calendar-day { dateKey, startMin, endMin } pieces.
 */
export function splitLinearPaidIntervalsToDailyPieces(linearIntervals, clockInDateKey, tz) {
  const pieces = [];
  for (const iv of mergeIntervals(linearIntervals)) {
    let cur = iv.start;
    while (cur < iv.end) {
      const dayOffset = Math.floor(cur / 1440);
      const dayStartMin = dayOffset * 1440;
      const dayEndMin = (dayOffset + 1) * 1440;
      const segEnd = Math.min(iv.end, dayEndMin);
      const dk = dayjs.tz(`${clockInDateKey}T00:00:00`, tz).add(dayOffset, 'day').format('YYYY-MM-DD');
      pieces.push({
        dateKey: dk,
        startMin: cur - dayStartMin,
        endMin: segEnd - dayStartMin
      });
      cur = segEnd;
    }
  }
  return pieces;
}

/** Qualify paid minute intervals for one calendar day piece against premium definition. */
export function qualifyPaidDayPiece(dayPiece, premiumDef, operatingHours, tz) {
  const { startMin, endMin, dateKey } = dayPiece;
  const paid = [{ start: startMin, end: endMin }];
  const mode = premiumDef.time_application_mode || 'none';

  if (!mode || mode === 'none') return mergeIntervals(paid);

  if (mode === 'daily_window') {
    const ws = parseTimeToMinutes(premiumDef.daily_window_start);
    const we = parseTimeToMinutes(premiumDef.daily_window_end);
    if (ws == null || we == null) return [];
    const mask = dailyWindowMaskMinutes(ws, we);
    return intersectIntervals(paid, mask);
  }

  const bef = premiumDef.public_hours_buffer_before_minutes ?? 60;
  const aft = premiumDef.public_hours_buffer_after_minutes ?? 60;
  const { inside, outside, outsideAllDay } = expandedPublicMinutesForDate(
    dateKey,
    operatingHours,
    tz,
    bef,
    aft
  );

  if (mode === 'public_hours_inside_buffer') {
    return intersectIntervals(paid, inside);
  }
  if (mode === 'public_hours_outside_buffer') {
    const outMask = outside?.length ? outside : outsideAllDay || [];
    return intersectIntervals(paid, outMask);
  }

  return mergeIntervals(paid);
}

/**
 * Greedy exclusive resolution: assign interval minutes to highest-rate premium first (same cluster).
 * @param {Record<string, MinuteInterval[]>} intervalsByName
 * @param {Record<string, number>} rateByName
 * @param {string[]} clusterMemberNames
 */
export function resolveExclusiveClusterGreedy(intervalsByName, rateByName, clusterMemberNames) {
  const sorted = [...clusterMemberNames].sort(
    (a, b) => (rateByName[b] || 0) - (rateByName[a] || 0)
  );
  let pool = mergeIntervals(
    sorted.flatMap((n) => intervalsByName[n] || []).filter(Boolean)
  );
  const result = {};
  for (const name of sorted) {
    const raw = mergeIntervals(intervalsByName[name] || []);
    const claimed = intersectIntervals(pool, raw);
    result[name] = claimed;
    pool = subtractIntervals(pool, claimed);
  }
  return result;
}
