/**
 * Multi-day week camp pricing: inventory price = full week; shorter weeks prorate.
 */

export function roundMultiDayMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function getMultiDayPriceScale(weekDayCount: number, fullWeekDayCount: number): number {
  const week = Math.max(0, Number(weekDayCount) || 0);
  const full = Math.max(1, Number(fullWeekDayCount) || 0);
  if (week <= 0 || week >= full) return 1;
  return week / full;
}

export function parseMultiDaySettings(
  ticketSettings: Record<string, unknown> | null | undefined,
  defaultDurationMinutes = 480,
): {
  enabled: true;
  dayCount: number;
  daysOfWeek: number[];
  dailyDurationMinutes: number;
} | null {
  const multiDay = ticketSettings?.multiDay;
  if (!multiDay || typeof multiDay !== "object" || !(multiDay as { enabled?: boolean }).enabled) {
    return null;
  }
  const multi = multiDay as Record<string, unknown>;
  const daysOfWeek = Array.isArray(multi.daysOfWeek) && multi.daysOfWeek.length > 0
    ? [...new Set(multi.daysOfWeek.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6))]
    : [1, 2, 3, 4, 5];

  return {
    enabled: true,
    dayCount: Math.max(1, Number.parseInt(String(multi.dayCount ?? 5), 10) || 5),
    daysOfWeek,
    dailyDurationMinutes: Math.max(
      1,
      Number.parseInt(String(multi.dailyDurationMinutes ?? defaultDurationMinutes), 10) ||
        defaultDurationMinutes ||
        480,
    ),
  };
}

export function buildMultiDayProratedPriceOverrides(
  items: Array<{ id?: string; price?: number | string | null }>,
  {
    weekDayCount,
    fullWeekDayCount,
    itemIds = null,
  }: {
    weekDayCount?: number | null;
    fullWeekDayCount?: number | null;
    itemIds?: Iterable<string> | null;
  } = {},
): Record<string, number> {
  const scale = getMultiDayPriceScale(Number(weekDayCount) || 0, Number(fullWeekDayCount) || 0);
  if (scale >= 1) return {};

  const allow = itemIds ? new Set([...itemIds].map((id) => String(id))) : null;
  const overrides: Record<string, number> = {};
  for (const item of items || []) {
    const id = item?.id != null ? String(item.id) : "";
    if (!id) continue;
    if (allow && !allow.has(id)) continue;
    const base = Number.parseFloat(String(item?.price ?? 0)) || 0;
    overrides[id] = roundMultiDayMoney(base * scale);
  }
  return overrides;
}

export function mergeTicketPriceOverrides(
  ...overrideMaps: Array<Record<string, number> | null | undefined>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const map of overrideMaps) {
    if (!map || typeof map !== "object") continue;
    for (const [itemId, price] of Object.entries(map)) {
      if (!itemId) continue;
      if (price == null || !Number.isFinite(Number(price))) continue;
      out[String(itemId)] = Number(price);
    }
  }
  return out;
}

const MULTI_DAY_SCHEDULE_PREFIX = "Multi-day: ";

function scheduleDateOnly(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function isMultiDayScheduleRow(schedule: {
  schedule_name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}): boolean {
  const start = scheduleDateOnly(schedule.start_date);
  const end = scheduleDateOnly(schedule.end_date);
  const name = String(schedule.schedule_name || "").trim();
  return Boolean(start && end && start === end && name.startsWith(MULTI_DAY_SCHEDULE_PREFIX));
}

function splitDateKeysIntoWeekRuns(dateKeys: string[] = []): string[][] {
  const sorted = [...new Set((dateKeys || []).filter(Boolean))].sort();
  if (!sorted.length) return [];
  const runs: string[][] = [];
  let current = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = current[current.length - 1];
    const next = sorted[i];
    const diffDays =
      (new Date(`${next}T12:00:00`).getTime() - new Date(`${prev}T12:00:00`).getTime()) / 86400000;
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

/**
 * Resolve day count for the multi-day week containing bookingDate.
 */
export function resolveMultiDaySeriesDayCountForDate(
  schedules: Array<{
    schedule_name?: string | null;
    start_date?: string | null;
    end_date?: string | null;
  }> = [],
  dateIso: string | null | undefined,
): number | null {
  if (!dateIso) return null;

  const byName = new Map<string, Set<string>>();
  for (const schedule of schedules || []) {
    if (!isMultiDayScheduleRow(schedule)) continue;
    const name = String(schedule.schedule_name || "").trim();
    const dateKey = scheduleDateOnly(schedule.start_date);
    if (!name || !dateKey) continue;
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name)!.add(dateKey);
  }

  for (const dateKeys of byName.values()) {
    const runs = splitDateKeysIntoWeekRuns([...dateKeys]);
    for (const run of runs) {
      if (run[0] === dateIso || run.includes(dateIso)) {
        return run.length;
      }
    }
  }
  return null;
}
