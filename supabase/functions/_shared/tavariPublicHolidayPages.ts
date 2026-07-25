/** Public holiday landing pages + special-hour linkage for external marketing sites (OTWK). */

export const SPECIAL_HOUR_EVENT_OPTIONS = [
  { key: "family-day", label: "Family Day" },
  { key: "good-friday", label: "Good Friday" },
  { key: "easter-monday", label: "Easter Monday" },
  { key: "victoria-day", label: "Victoria Day" },
  { key: "canada-day", label: "Canada Day" },
  { key: "civic-holiday", label: "Civic Holiday" },
  { key: "labour-day", label: "Labour Day" },
  { key: "thanksgiving-weekend", label: "Thanksgiving" },
  { key: "halloween", label: "Halloween" },
  { key: "christmas-eve", label: "Christmas Eve" },
  { key: "christmas-day", label: "Christmas Day" },
  { key: "boxing-day", label: "Boxing Day" },
  { key: "christmas-break", label: "Christmas Break" },
  { key: "new-years-eve", label: "New Year's Eve" },
  { key: "new-years-day", label: "New Year's Day" },
  { key: "pa-day", label: "PA Day" },
  { key: "other", label: "Other" },
] as const;

export type SpecialHourEventKey = (typeof SPECIAL_HOUR_EVENT_OPTIONS)[number]["key"];

export type PublicHolidayRelatedLink = {
  label: string;
  href: string;
};

export type PublicLinkedSpecialHour = {
  date: string;
  hoursText: string;
  label: string | null;
  eventKey: string | null;
};

export type PublicWebsiteHolidayPage = {
  id: string;
  slug: string;
  routePath: string;
  name: string;
  eventKeys: string[];
  eventKeywords: string[];
  seoTitle: string;
  seoDescription: string;
  h1: string;
  intro: string;
  searchQuestion: string;
  whenText: string;
  planningTip: string;
  primaryCtaLabel: string;
  relatedLinks: PublicHolidayRelatedLink[];
  sortOrder: number;
  linkedSpecialHours: PublicLinkedSpecialHour[];
};

export type PublicWebsiteHolidayPagesPayload = {
  ok: true;
  businessId: string;
  businessName: string;
  timezone: string;
  asOf: string;
  calendarDate: string;
  eventOptions: Array<{ key: string; label: string }>;
  pages: PublicWebsiteHolidayPage[];
};

type HolidayRow = {
  id?: string;
  date?: string;
  name?: string;
  holiday_key?: string;
  holidayKey?: string;
  closed?: boolean;
  hours?: { open?: string; close?: string };
};

type WebsiteHolidayPageRow = {
  id: string;
  business_id: string;
  slug: string;
  route_path: string;
  name: string;
  event_keys: string[] | null;
  event_keywords: string[] | null;
  seo_title: string;
  seo_description: string;
  h1: string;
  intro: string;
  search_question: string;
  when_text: string;
  planning_tip: string;
  primary_cta_label: string;
  related_links: unknown;
  sort_order: number;
  is_active: boolean;
};

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function calendarDateInTimeZone(instant: Date, timeZone: string): string {
  const tz = trimText(timeZone) || "America/Toronto";
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(instant);
  const y = parts.find((part) => part.type === "year")?.value ?? "1970";
  const m = parts.find((part) => part.type === "month")?.value ?? "01";
  const d = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

export function normalizeSpecialHourEventKey(key: string | undefined): string {
  const value = trimText(key);
  if (value === "easter-weekend") return "easter-monday";
  return value;
}

export function inferSpecialHourEventKeyFromLabel(label: string | undefined): string {
  const haystack = trimText(label).toLowerCase();
  if (!haystack) return "other";
  const option = SPECIAL_HOUR_EVENT_OPTIONS.find(
    (item) => item.key !== "other" && haystack.includes(item.label.toLowerCase()),
  );
  return option?.key ?? "other";
}

function formatHoursRange(open: string, close: string): string {
  const formatTime = (raw: string): string => {
    const match = raw.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return raw;
    let hour = parseInt(match[1], 10);
    const minute = match[2];
    const suffix = hour >= 12 ? "pm" : "am";
    if (hour === 0) hour = 12;
    else if (hour > 12) hour -= 12;
    return minute === "00" ? `${hour}${suffix}` : `${hour}:${minute}${suffix}`;
  };
  return `${formatTime(open)} - ${formatTime(close)}`;
}

export function buildLinkedSpecialHours(holidayHours: unknown): PublicLinkedSpecialHour[] {
  if (!Array.isArray(holidayHours)) return [];

  const out: PublicLinkedSpecialHour[] = [];
  for (const row of holidayHours) {
    if (!row || typeof row !== "object") continue;
    const holiday = row as HolidayRow;
    const date = trimText(holiday.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const label = trimText(holiday.name) || null;
    const explicitKey = normalizeSpecialHourEventKey(
      trimText(holiday.holiday_key) || trimText(holiday.holidayKey),
    );
    const eventKey = explicitKey && explicitKey !== "other"
      ? explicitKey
      : inferSpecialHourEventKeyFromLabel(label ?? undefined);

    let hoursText = "Closed";
    if (holiday.closed !== true) {
      const open = trimText(holiday.hours?.open);
      const close = trimText(holiday.hours?.close);
      hoursText = open || close ? formatHoursRange(open, close) : "Closed";
    }

    out.push({
      date,
      hoursText,
      label,
      eventKey: eventKey === "other" ? null : eventKey,
    });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function parseRelatedLinks(raw: unknown): PublicHolidayRelatedLink[] {
  if (!Array.isArray(raw)) return [];
  const out: PublicHolidayRelatedLink[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const label = trimText(item.label);
    const href = trimText(item.href);
    if (label && href) out.push({ label, href });
  }
  return out;
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((value) => trimText(value)).filter(Boolean);
}

function linkedSpecialHoursForPage(
  page: WebsiteHolidayPageRow,
  specials: PublicLinkedSpecialHour[],
  calendarDate: string,
  includePast: boolean,
): PublicLinkedSpecialHour[] {
  const eventKeys = parseStringArray(page.event_keys).map(normalizeSpecialHourEventKey);
  const keywords = parseStringArray(page.event_keywords).map((value) => value.toLowerCase());

  const matches = specials.filter((special) => {
    const eventKey = normalizeSpecialHourEventKey(special.eventKey ?? undefined);
    if (eventKey && eventKeys.includes(eventKey)) return true;
    const haystack = `${special.label ?? ""} ${special.date}`.toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword));
  });

  const upcoming = matches.filter((special) => special.date >= calendarDate);
  const selected = upcoming.length > 0
    ? upcoming
    : includePast
      ? matches.sort((a, b) => b.date.localeCompare(a.date))
      : [];

  return selected.slice(0, 8);
}

function mapHolidayPageRow(
  row: WebsiteHolidayPageRow,
  specials: PublicLinkedSpecialHour[],
  calendarDate: string,
  includePast: boolean,
): PublicWebsiteHolidayPage {
  return {
    id: row.id,
    slug: trimText(row.slug),
    routePath: trimText(row.route_path),
    name: trimText(row.name),
    eventKeys: parseStringArray(row.event_keys).map(normalizeSpecialHourEventKey),
    eventKeywords: parseStringArray(row.event_keywords),
    seoTitle: trimText(row.seo_title),
    seoDescription: trimText(row.seo_description),
    h1: trimText(row.h1),
    intro: trimText(row.intro),
    searchQuestion: trimText(row.search_question),
    whenText: trimText(row.when_text),
    planningTip: trimText(row.planning_tip),
    primaryCtaLabel: trimText(row.primary_cta_label),
    relatedLinks: parseRelatedLinks(row.related_links),
    sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : 0,
    linkedSpecialHours: linkedSpecialHoursForPage(row, specials, calendarDate, includePast),
  };
}

export type LoadPublicWebsiteHolidayPagesOptions = {
  slug?: string;
  activeOnly?: boolean;
  includePastSpecials?: boolean;
  asOf?: Date;
};

export async function loadPublicWebsiteHolidayPages(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  options: LoadPublicWebsiteHolidayPagesOptions = {},
): Promise<PublicWebsiteHolidayPagesPayload> {
  const activeOnly = options.activeOnly !== false;
  const includePast = options.includePastSpecials === true;
  const asOf = options.asOf ?? new Date();
  const asOfIso = asOf.toISOString();
  const slugFilter = trimText(options.slug).toLowerCase();

  const [{ data: business }, query] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, timezone, holiday_hours")
      .eq("id", businessId)
      .maybeSingle(),
    (() => {
      let q = supabase
        .from("business_website_holiday_pages")
        .select("*")
        .eq("business_id", businessId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(50);
      if (activeOnly) q = q.eq("is_active", true);
      if (slugFilter) q = q.eq("slug", slugFilter);
      return q;
    })(),
  ]);

  if (query.error) throw new Error(query.error.message);
  if (!business) throw new Error("Business not found");

  const timezone = trimText(business.timezone) || "America/Toronto";
  const calendarDate = calendarDateInTimeZone(asOf, timezone);
  const specials = buildLinkedSpecialHours(business.holiday_hours);

  const pages = ((query.data ?? []) as WebsiteHolidayPageRow[])
    .map((row) => mapHolidayPageRow(row, specials, calendarDate, includePast));

  return {
    ok: true,
    businessId,
    businessName: trimText(business.name) || "Business",
    timezone,
    asOf: asOfIso,
    calendarDate,
    eventOptions: SPECIAL_HOUR_EVENT_OPTIONS.map((option) => ({
      key: option.key,
      label: option.label,
    })),
    pages,
  };
}
