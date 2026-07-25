/** Always-on homepage hero carousel slides for external marketing sites (OTWK). */

export type PublicWebsiteHeroSlide = {
  id: string;
  slug: string;
  imageUrl: string;
  alt: string;
  title: string | null;
  caption: string | null;
  ctaText: string | null;
  ctaHref: string | null;
  sortOrder: number;
  showTextOverlay: boolean;
  imageFocusX: number;
  imageFocusY: number;
  validFrom: string | null;
  validUntil: string | null;
  showOnDays: number[] | null;
};

export type PublicWebsiteHeroSlidesPayload = {
  ok: true;
  businessId: string;
  businessName: string;
  timezone: string;
  asOf: string;
  calendarDate: string;
  slides: PublicWebsiteHeroSlide[];
};

type WebsiteHeroSlideRow = {
  id: string;
  business_id: string;
  slug: string;
  image_url: string;
  alt: string;
  title: string | null;
  caption: string | null;
  cta_text: string | null;
  cta_href: string | null;
  sort_order: number;
  show_text_overlay: boolean;
  image_focus_x: number;
  image_focus_y: number;
  valid_from: string | null;
  valid_until: string | null;
  show_on_days: number[] | null;
  is_active: boolean;
};

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseIntegerArray(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const values = raw
    .map((value) => Number.parseInt(String(value ?? ""), 10))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 6);
  return values.length > 0 ? values : null;
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

function dayOfWeekInTimeZone(instant: Date, timeZone: string): number {
  const tz = trimText(timeZone) || "America/Toronto";
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(instant);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[weekday] ?? instant.getUTCDay();
}

function normalizeDateKey(raw: unknown): string | null {
  const value = trimText(raw);
  if (!value) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function slideIsVisible(
  row: WebsiteHeroSlideRow,
  calendarDate: string,
  dayOfWeek: number,
  activeOnly: boolean,
): boolean {
  if (activeOnly && row.is_active !== true) return false;

  const validFrom = normalizeDateKey(row.valid_from);
  const validUntil = normalizeDateKey(row.valid_until);
  if (validFrom && calendarDate < validFrom) return false;
  if (validUntil && calendarDate > validUntil) return false;

  const days = parseIntegerArray(row.show_on_days);
  if (days && days.length > 0 && !days.includes(dayOfWeek)) return false;

  return true;
}

function mapHeroSlideRow(row: WebsiteHeroSlideRow): PublicWebsiteHeroSlide {
  return {
    id: row.id,
    slug: trimText(row.slug),
    imageUrl: trimText(row.image_url),
    alt: trimText(row.alt),
    title: trimText(row.title) || null,
    caption: trimText(row.caption) || null,
    ctaText: trimText(row.cta_text) || null,
    ctaHref: trimText(row.cta_href) || null,
    sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : 0,
    showTextOverlay: row.show_text_overlay !== false,
    imageFocusX: Number.isFinite(row.image_focus_x) ? row.image_focus_x : 50,
    imageFocusY: Number.isFinite(row.image_focus_y) ? row.image_focus_y : 50,
    validFrom: normalizeDateKey(row.valid_from),
    validUntil: normalizeDateKey(row.valid_until),
    showOnDays: parseIntegerArray(row.show_on_days),
  };
}

export type LoadPublicWebsiteHeroSlidesOptions = {
  activeOnly?: boolean;
  asOf?: Date;
  limit?: number;
};

export async function loadPublicWebsiteHeroSlides(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  options: LoadPublicWebsiteHeroSlidesOptions = {},
): Promise<PublicWebsiteHeroSlidesPayload> {
  const activeOnly = options.activeOnly !== false;
  const asOf = options.asOf ?? new Date();
  const asOfIso = asOf.toISOString();
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));

  const [{ data: business }, query] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, timezone")
      .eq("id", businessId)
      .maybeSingle(),
    supabase
      .from("business_website_hero_slides")
      .select("*")
      .eq("business_id", businessId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(100),
  ]);

  if (query.error) throw new Error(query.error.message);
  if (!business) throw new Error("Business not found");

  const timezone = trimText(business.timezone) || "America/Toronto";
  const calendarDate = calendarDateInTimeZone(asOf, timezone);
  const dayOfWeek = dayOfWeekInTimeZone(asOf, timezone);

  const slides: PublicWebsiteHeroSlide[] = [];
  for (const raw of (query.data ?? []) as WebsiteHeroSlideRow[]) {
    if (!slideIsVisible(raw, calendarDate, dayOfWeek, activeOnly)) continue;
    const mapped = mapHeroSlideRow(raw);
    if (!mapped.imageUrl) continue;
    slides.push(mapped);
    if (slides.length >= limit) break;
  }

  return {
    ok: true,
    businessId,
    businessName: trimText(business.name) || "Business",
    timezone,
    asOf: asOfIso,
    calendarDate,
    slides,
  };
}
