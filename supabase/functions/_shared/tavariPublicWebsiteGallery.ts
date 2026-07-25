/** Public facility gallery images for external marketing sites (OTWK). */

export type PublicWebsiteGalleryImage = {
  id: string;
  slug: string;
  imageUrl: string;
  alt: string;
  caption: string | null;
  tags: string[];
  sortOrder: number;
};

export type PublicWebsiteGalleryPayload = {
  ok: true;
  businessId: string;
  businessName: string;
  timezone: string;
  asOf: string;
  images: PublicWebsiteGalleryImage[];
};

type WebsiteGalleryImageRow = {
  id: string;
  business_id: string;
  slug: string;
  image_url: string;
  alt: string;
  caption: string | null;
  tags: string[] | null;
  storage_path: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((value) => trimText(value)).filter(Boolean);
}

function mapGalleryImageRow(row: WebsiteGalleryImageRow): PublicWebsiteGalleryImage | null {
  const imageUrl = trimText(row.image_url);
  if (!imageUrl) return null;

  return {
    id: row.id,
    slug: trimText(row.slug),
    imageUrl,
    alt: trimText(row.alt),
    caption: trimText(row.caption) || null,
    tags: parseStringArray(row.tags),
    sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : 0,
  };
}

export type LoadPublicWebsiteGalleryOptions = {
  activeOnly?: boolean;
  tag?: string;
  limit?: number;
};

export async function loadPublicWebsiteGallery(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  options: LoadPublicWebsiteGalleryOptions = {},
): Promise<PublicWebsiteGalleryPayload> {
  const activeOnly = options.activeOnly !== false;
  const tagFilter = trimText(options.tag).toLowerCase();
  const limit = Math.min(200, Math.max(1, options.limit ?? 100));
  const asOf = new Date().toISOString();

  const [{ data: business }, query] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, timezone")
      .eq("id", businessId)
      .maybeSingle(),
    supabase
      .from("business_website_gallery_images")
      .select("*")
      .eq("business_id", businessId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(500),
  ]);

  if (query.error) throw new Error(query.error.message);
  if (!business) throw new Error("Business not found");

  const images: PublicWebsiteGalleryImage[] = [];
  for (const raw of (query.data ?? []) as WebsiteGalleryImageRow[]) {
    if (activeOnly && raw.is_active !== true) continue;
    const mapped = mapGalleryImageRow(raw);
    if (!mapped) continue;
    if (tagFilter && !mapped.tags.some((tag) => tag.toLowerCase() === tagFilter)) continue;
    images.push(mapped);
    if (images.length >= limit) break;
  }

  return {
    ok: true,
    businessId,
    businessName: trimText(business.name) || "Business",
    timezone: trimText(business.timezone) || "America/Toronto",
    asOf,
    images,
  };
}
