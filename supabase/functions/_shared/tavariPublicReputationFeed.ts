/** Public reputation feed for external marketing websites (OTWK). */

export type ReputationSubmissionRow = {
  id: string;
  rating: number | null;
  comment: string | null;
  created_at: string | null;
  flow_type: string | null;
  reputation_invite_tokens?: {
    contact_normalized?: string | null;
    metadata?: Record<string, unknown> | null;
  } | Array<{
    contact_normalized?: string | null;
    metadata?: Record<string, unknown> | null;
  }> | null;
};

export type GoogleReviewDraftRow = {
  id: string;
  reviewer_display_name: string | null;
  star_rating: number | null;
  review_comment: string | null;
  created_at: string | null;
};

export type PublicReviewSnippet = {
  id: string;
  rating: number;
  text: string;
  reviewerName: string;
  date: string | null;
  dateFormatted: string | null;
  source: "submission" | "google";
};

export type PublicReputationWidgetConfig = {
  layout: "grid";
  columns: number;
  showStars: boolean;
  showDates: boolean;
  ctaLabel: string;
  ctaUrl: string;
};

export type PublicReputationFeed = {
  ok: true;
  businessId: string;
  businessName: string;
  averageRating: number | null;
  averageRatingFormatted: string | null;
  reviewCount: number;
  snippetCount: number;
  googleReviewUrl: string | null;
  leaveReviewUrl: string;
  reviews: PublicReviewSnippet[];
  widget: PublicReputationWidgetConfig;
};

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parsePositiveInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function roundRating(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function formatRating(value: number | null): string | null {
  if (value == null) return null;
  return value % 1 === 0 ? String(value.toFixed(0)) : value.toFixed(1);
}

export function formatReviewDate(iso: string | null | undefined, timeZone = "America/Toronto"): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(date);
}

export function resolveLeaveReviewUrl(businessId: string, siteUrl?: string): string {
  const base = (siteUrl || Deno.env.get("PUBLIC_SITE_URL") || "https://www.tavarios.ca").replace(/\/$/, "");
  return `${base}/reputation/review/${businessId}`;
}

function tokenMeta(row: ReputationSubmissionRow): Record<string, unknown> {
  const raw = row.reputation_invite_tokens;
  const token = Array.isArray(raw) ? raw[0] : raw;
  return token?.metadata && typeof token.metadata === "object" ? token.metadata : {};
}

export function publicReviewerName(meta: Record<string, unknown>): string {
  const checkedIn = trimText(meta.checked_in_name || meta.checkedInName);
  if (checkedIn) {
    const parts = checkedIn.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0]} ${parts[parts.length - 1]![0]}.`;
    return parts[0] || "A happy parent";
  }

  const first = trimText(meta.first_name || meta.firstName);
  const last = trimText(meta.last_name || meta.lastName);
  if (first && last) return `${first} ${last[0]}.`;
  if (first) return first;
  return "A happy parent";
}

function snippetFromSubmission(row: ReputationSubmissionRow): PublicReviewSnippet | null {
  const text = trimText(row.comment);
  if (!text || text.length < 8) return null;
  const rating = typeof row.rating === "number" ? row.rating : parseInt(String(row.rating ?? ""), 10);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) return null;

  return {
    id: String(row.id),
    rating,
    text,
    reviewerName: publicReviewerName(tokenMeta(row)),
    date: row.created_at ? new Date(row.created_at).toISOString() : null,
    dateFormatted: formatReviewDate(row.created_at),
    source: "submission",
  };
}

function snippetFromGoogleDraft(row: GoogleReviewDraftRow): PublicReviewSnippet | null {
  const text = trimText(row.review_comment);
  if (!text || text.length < 8) return null;
  const rating = typeof row.star_rating === "number"
    ? row.star_rating
    : parseInt(String(row.star_rating ?? ""), 10);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) return null;

  const displayName = trimText(row.reviewer_display_name);
  const reviewerName = displayName
    ? (() => {
      const parts = displayName.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) return `${parts[0]} ${parts[parts.length - 1]![0]}.`;
      return parts[0] || "Google reviewer";
    })()
    : "Google reviewer";

  return {
    id: `google-${row.id}`,
    rating,
    text,
    reviewerName,
    date: row.created_at ? new Date(row.created_at).toISOString() : null,
    dateFormatted: formatReviewDate(row.created_at),
    source: "google",
  };
}

export async function loadPublicReputationFeed(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  options: {
    limit?: number;
    minRating?: number;
    siteUrl?: string;
    leaveReviewLabel?: string;
  } = {},
): Promise<PublicReputationFeed> {
  const { data: business, error: bizErr } = await supabase
    .from("businesses")
    .select("id, name, timezone")
    .eq("id", businessId)
    .maybeSingle();

  if (bizErr) throw new Error(bizErr.message);
  if (!business) throw new Error("Business not found");

  const { data: settings } = await supabase
    .from("reputation_settings")
    .select(
      "enabled, google_review_url, website_public_feed_enabled, website_public_feed_min_rating, website_public_feed_limit",
    )
    .eq("business_id", businessId)
    .maybeSingle();

  const feedEnabled = settings?.website_public_feed_enabled !== false;
  const minRating = parsePositiveInt(
    options.minRating ?? settings?.website_public_feed_min_rating,
    4,
    1,
    5,
  );
  const limit = parsePositiveInt(
    options.limit ?? settings?.website_public_feed_limit,
    9,
    1,
    24,
  );
  const timeZone = trimText(business.timezone) || "America/Toronto";
  const businessName = trimText(business.name) || "Business";
  const googleReviewUrl = trimText(settings?.google_review_url) || null;
  const leaveReviewUrl = resolveLeaveReviewUrl(businessId, options.siteUrl);
  const ctaLabel = trimText(options.leaveReviewLabel) || "Leave Us A Review";

  const { data: ratingRows, error: ratingErr } = await supabase
    .from("reputation_submissions")
    .select("rating")
    .eq("business_id", businessId)
    .not("rating", "is", null);

  if (ratingErr) throw new Error(ratingErr.message);

  const ratings = (ratingRows || [])
    .map((row) => (typeof row.rating === "number" ? row.rating : parseInt(String(row.rating), 10)))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);
  const reviewCount = ratings.length;
  const averageRating = reviewCount > 0
    ? roundRating(ratings.reduce((sum, n) => sum + n, 0) / reviewCount)
    : null;

  let reviews: PublicReviewSnippet[] = [];

  if (feedEnabled) {
    const { data: submissionRows, error: subErr } = await supabase
      .from("reputation_submissions")
      .select(`
        id, rating, comment, created_at, flow_type,
        reputation_invite_tokens ( contact_normalized, metadata )
      `)
      .eq("business_id", businessId)
      .gte("rating", minRating)
      .not("comment", "is", null)
      .order("created_at", { ascending: false })
      .limit(Math.max(limit, limit * 2));

    if (subErr) throw new Error(subErr.message);

    const submissionSnippets = (submissionRows || [])
      .map((row) => snippetFromSubmission(row as ReputationSubmissionRow))
      .filter(Boolean) as PublicReviewSnippet[];

    const { data: googleRows } = await supabase
      .from("reputation_google_review_drafts")
      .select("id, reviewer_display_name, star_rating, review_comment, created_at")
      .eq("business_id", businessId)
      .gte("star_rating", minRating)
      .not("review_comment", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    const googleSnippets = (googleRows || [])
      .map((row) => snippetFromGoogleDraft(row as GoogleReviewDraftRow))
      .filter(Boolean) as PublicReviewSnippet[];

    const seen = new Set<string>();
    reviews = [...submissionSnippets, ...googleSnippets]
      .sort((a, b) => {
        const aMs = a.date ? new Date(a.date).getTime() : 0;
        const bMs = b.date ? new Date(b.date).getTime() : 0;
        return bMs - aMs;
      })
      .filter((snippet) => {
        const key = snippet.text.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit)
      .map((snippet) => ({
        ...snippet,
        dateFormatted: formatReviewDate(snippet.date, timeZone),
      }));
  }

  const columns = limit >= 6 ? 3 : limit >= 2 ? 2 : 1;

  return {
    ok: true,
    businessId,
    businessName,
    averageRating,
    averageRatingFormatted: formatRating(averageRating),
    reviewCount,
    snippetCount: reviews.length,
    googleReviewUrl,
    leaveReviewUrl,
    reviews,
    widget: {
      layout: "grid",
      columns,
      showStars: true,
      showDates: true,
      ctaLabel,
      ctaUrl: leaveReviewUrl,
    },
  };
}
