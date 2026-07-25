/** Read-only CMS builder page JSON for external marketing sites (OTWK). */

export type PublicWebsiteBuilderPage = {
  slug: string;
  label: string;
  metaTitle: string | null;
  metaDescription: string | null;
  sections: unknown[];
  updatedAt: string;
};

export type PublicWebsiteBuilderPagesPayload = {
  ok: true;
  businessId: string;
  businessName: string;
  timezone: string;
  asOf: string;
  pages: PublicWebsiteBuilderPage[];
};

export type PublicWebsiteBuilderPagePayload = {
  ok: true;
  businessId: string;
  businessName: string;
  timezone: string;
  asOf: string;
  page: PublicWebsiteBuilderPage | null;
};

type WebsiteBuilderPageRow = {
  id: string;
  business_id: string;
  slug: string;
  label: string;
  content: Record<string, unknown> | null;
  is_active: boolean;
  updated_at: string;
};

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNullableString(value: unknown): string | null {
  const text = trimText(value);
  return text || null;
}

function readSections(raw: unknown): unknown[] {
  if (!raw || typeof raw !== "object") return [];
  const content = raw as Record<string, unknown>;
  return Array.isArray(content.sections) ? content.sections : [];
}

function mapBuilderPageRow(row: WebsiteBuilderPageRow): PublicWebsiteBuilderPage {
  const content = row.content && typeof row.content === "object" ? row.content : {};
  return {
    slug: trimText(row.slug),
    label: trimText(row.label),
    metaTitle: readNullableString(content.metaTitle),
    metaDescription: readNullableString(content.metaDescription),
    sections: readSections(content),
    updatedAt: trimText(row.updated_at) || new Date().toISOString(),
  };
}

export type LoadPublicWebsiteBuilderPagesOptions = {
  slug?: string;
  slugs?: string[];
  activeOnly?: boolean;
  limit?: number;
};

function normalizeSlugList(values: string[] | undefined): string[] {
  if (!values?.length) return [];
  return [...new Set(values.map((value) => trimText(value).toLowerCase()).filter(Boolean))];
}

export async function loadPublicWebsiteBuilderPages(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  options: LoadPublicWebsiteBuilderPagesOptions = {},
): Promise<PublicWebsiteBuilderPagesPayload> {
  const activeOnly = options.activeOnly !== false;
  const slug = trimText(options.slug).toLowerCase();
  const slugFilter = normalizeSlugList(options.slugs);
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const asOf = new Date().toISOString();

  const [{ data: business }, query] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, timezone")
      .eq("id", businessId)
      .maybeSingle(),
    (() => {
      let q = supabase
        .from("business_website_builder_pages")
        .select("*")
        .eq("business_id", businessId)
        .order("updated_at", { ascending: false })
        .limit(500);
      if (slug) q = q.eq("slug", slug);
      else if (slugFilter.length > 0) q = q.in("slug", slugFilter);
      return q;
    })(),
  ]);

  if (query.error) throw new Error(query.error.message);
  if (!business) throw new Error("Business not found");

  const pages: PublicWebsiteBuilderPage[] = [];
  for (const raw of (query.data ?? []) as WebsiteBuilderPageRow[]) {
    if (activeOnly && raw.is_active !== true) continue;
    pages.push(mapBuilderPageRow(raw));
    if (pages.length >= limit) break;
  }

  return {
    ok: true,
    businessId,
    businessName: trimText(business.name) || "Business",
    timezone: trimText(business.timezone) || "America/Toronto",
    asOf,
    pages,
  };
}

export async function loadPublicWebsiteBuilderPage(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  slug: string,
  options: Omit<LoadPublicWebsiteBuilderPagesOptions, "slug" | "slugs"> = {},
): Promise<PublicWebsiteBuilderPagePayload> {
  const payload = await loadPublicWebsiteBuilderPages(supabase, businessId, {
    ...options,
    slug,
    limit: 1,
  });

  return {
    ok: true,
    businessId: payload.businessId,
    businessName: payload.businessName,
    timezone: payload.timezone,
    asOf: payload.asOf,
    page: payload.pages[0] ?? null,
  };
}
