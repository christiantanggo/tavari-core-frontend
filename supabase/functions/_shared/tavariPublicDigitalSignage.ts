/** Active digital signage ad creatives for in-venue displays and website reuse (OTWK). */

export type DigitalSignageAudience = "venue" | "web" | "both";

export type PublicDigitalSignageSchedule = {
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  daysOfWeek: number[] | null;
  contentPlayStartDate: string | null;
  contentPlayEndDate: string | null;
};

export type PublicDigitalSignageCreative = {
  id: string;
  title: string;
  audience: DigitalSignageAudience;
  imageUrl: string | null;
  clickUrl: string | null;
  contentType: string | null;
  schedule: PublicDigitalSignageSchedule;
};

/** Legacy alias kept for OTWK App home feed. */
export type PublicDigitalSignagePromo = {
  id: string;
  title: string;
  imageUrl: string | null;
  clickUrl: string | null;
};

export type PublicDigitalSignagePayload = {
  ok: true;
  businessId: string;
  businessName: string;
  timezone: string;
  asOf: string;
  calendarDate: string;
  audience: DigitalSignageAudience | "all";
  creatives: PublicDigitalSignageCreative[];
  promos: PublicDigitalSignagePromo[];
};

const STORAGE_BUCKET = "digital-signage-content";
const SIGNED_URL_TTL = 3600;

type SignageContentRow = {
  id?: string;
  content_name?: string | null;
  content_type?: string | null;
  file_url?: string | null;
  file_path?: string | null;
  play_start_date?: string | null;
  play_end_date?: string | null;
};

type SignageAdRow = {
  id: string;
  ad_name: string;
  click_url: string | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  days_of_week: number[] | null;
  status: string;
  is_active: boolean;
  audience: string | null;
  content: SignageContentRow | SignageContentRow[] | null;
};

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNullableString(value: unknown): string | null {
  const text = trimText(value);
  return text || null;
}

function normalizeAudience(value: unknown): DigitalSignageAudience {
  const key = trimText(value).toLowerCase();
  if (key === "web" || key === "both") return key;
  return "venue";
}

export function parseDigitalSignageAudience(raw: string | null | undefined): DigitalSignageAudience | "all" {
  const key = trimText(raw).toLowerCase();
  if (key === "web" || key === "both" || key === "venue" || key === "all") return key;
  return "venue";
}

export function audienceMatches(
  creativeAudience: DigitalSignageAudience,
  filter: DigitalSignageAudience | "all",
): boolean {
  if (filter === "all") return true;
  if (filter === "web") return creativeAudience === "web" || creativeAudience === "both";
  if (filter === "venue") return creativeAudience === "venue" || creativeAudience === "both";
  return creativeAudience === filter;
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

function normalizeDateKey(raw: unknown): string | null {
  const value = trimText(raw);
  if (!value) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function normalizeTimeKey(raw: unknown): string | null {
  const value = trimText(raw);
  if (!value) return null;
  const match = value.match(/^(\d{2}:\d{2})/);
  return match ? match[1] : null;
}

function parseIntegerArray(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const values = raw
    .map((value) => Number.parseInt(String(value ?? ""), 10))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 6);
  return values.length > 0 ? values : null;
}

function isWithinPlayDates(
  playStart: string | null | undefined,
  playEnd: string | null | undefined,
  today: string,
): boolean {
  const start = normalizeDateKey(playStart);
  const end = normalizeDateKey(playEnd);
  if (start && today < start) return false;
  if (end && today > end) return false;
  return true;
}

function isWithinAdDates(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  today: string,
): boolean {
  const start = normalizeDateKey(startDate);
  const end = normalizeDateKey(endDate);
  if (start && today < start) return false;
  if (end && today > end) return false;
  return true;
}

async function signedContentUrl(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  content: SignageContentRow,
): Promise<string | null> {
  const filePath = trimText(content.file_path);
  const fileUrl = trimText(content.file_url);

  if (filePath) {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(filePath, SIGNED_URL_TTL);
    if (!error && data?.signedUrl) return data.signedUrl;
  }

  if (fileUrl && /^https?:\/\//i.test(fileUrl)) {
    return fileUrl;
  }

  if (fileUrl) {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(fileUrl, SIGNED_URL_TTL);
    if (!error && data?.signedUrl) return data.signedUrl;
  }

  return null;
}

function mapLegacyPromo(creative: PublicDigitalSignageCreative): PublicDigitalSignagePromo {
  return {
    id: creative.id,
    title: creative.title,
    imageUrl: creative.imageUrl,
    clickUrl: creative.clickUrl,
  };
}

export type LoadPublicDigitalSignageOptions = {
  audience?: DigitalSignageAudience | "all";
  activeOnly?: boolean;
  limit?: number;
  asOf?: Date;
};

export async function loadPublicDigitalSignageCreatives(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  options: LoadPublicDigitalSignageOptions = {},
): Promise<PublicDigitalSignagePayload> {
  const audienceFilter = options.audience ?? "venue";
  const activeOnly = options.activeOnly !== false;
  const asOf = options.asOf ?? new Date();
  const asOfIso = asOf.toISOString();
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id, name, timezone")
    .eq("id", businessId)
    .maybeSingle();

  if (businessError) throw new Error(businessError.message);
  if (!business) throw new Error("Business not found");

  const timezone = trimText(business.timezone) || "America/Toronto";
  const calendarDate = calendarDateInTimeZone(asOf, timezone);

  const { data: ads, error } = await supabase
    .from("digital_signage_ads")
    .select(`
      id,
      ad_name,
      click_url,
      start_date,
      end_date,
      start_time,
      end_time,
      days_of_week,
      status,
      is_active,
      audience,
      content:digital_signage_content (
        id,
        content_name,
        content_type,
        file_url,
        file_path,
        play_start_date,
        play_end_date
      )
    `)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(error.message);

  const creatives: PublicDigitalSignageCreative[] = [];

  for (const raw of (ads ?? []) as SignageAdRow[]) {
    if (activeOnly && raw.is_active !== true) continue;
    if (activeOnly && !["active", "approved"].includes(trimText(raw.status))) continue;

    const audience = normalizeAudience(raw.audience);
    if (!audienceMatches(audience, audienceFilter)) continue;
    if (!isWithinAdDates(raw.start_date, raw.end_date, calendarDate)) continue;

    const content = Array.isArray(raw.content) ? raw.content[0] : raw.content;
    if (!content) continue;
    if (!isWithinPlayDates(content.play_start_date, content.play_end_date, calendarDate)) continue;

    const imageUrl = await signedContentUrl(supabase, content);
    const title = trimText(raw.ad_name) || trimText(content.content_name) || "Promotion";

    creatives.push({
      id: raw.id,
      title,
      audience,
      imageUrl,
      clickUrl: readNullableString(raw.click_url),
      contentType: readNullableString(content.content_type),
      schedule: {
        startDate: normalizeDateKey(raw.start_date),
        endDate: normalizeDateKey(raw.end_date),
        startTime: normalizeTimeKey(raw.start_time),
        endTime: normalizeTimeKey(raw.end_time),
        daysOfWeek: parseIntegerArray(raw.days_of_week),
        contentPlayStartDate: normalizeDateKey(content.play_start_date),
        contentPlayEndDate: normalizeDateKey(content.play_end_date),
      },
    });

    if (creatives.length >= limit) break;
  }

  return {
    ok: true,
    businessId,
    businessName: trimText(business.name) || "Business",
    timezone,
    asOf: asOfIso,
    calendarDate,
    audience: audienceFilter,
    creatives,
    promos: creatives.map(mapLegacyPromo),
  };
}
