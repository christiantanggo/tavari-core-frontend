/** Active website promotions for external marketing sites (OTWK). */

export type WebsitePromotionAudience = "web" | "app" | "both";
export type WebsitePromotionKind = "campaign" | "pos_free_with_purchase";

export type PublicPosFreeWithPurchaseOffer = {
  quantity: number;
  freeItemId: string;
  freeItemName: string;
  triggerItemIds: string[];
  triggerItemNames: string[];
};

export type PublicWebsitePromotion = {
  id: string;
  slug: string;
  label: string;
  title: string;
  kind: WebsitePromotionKind;
  audience: WebsitePromotionAudience;
  priority: number;
  startsAt: string;
  endsAt: string;
  imageUrl: string | null;
  ctaUrl: string | null;
  ctaLabel: string | null;
  countdownPrefix: string;
  pageMetaTitle: string | null;
  pageMetaDescription: string | null;
  pageContent: Record<string, unknown>;
  heroEnabled: boolean;
  heroImageUrl: string | null;
  heroImageAlt: string;
  popupEnabled: boolean;
  popupTitle: string;
  popupBody: string;
  popupCtaLabel: string | null;
  popupCtaHref: string | null;
  homeButtonEnabled: boolean;
  homeSectionId: string | null;
  homeButtonLabel: string | null;
  homeButtonHref: string | null;
  floatingEnabled: boolean;
  floatingLabel: string | null;
  floatingHref: string | null;
  posOffer?: PublicPosFreeWithPurchaseOffer;
};

export type PublicWebsitePromotionsPayload = {
  ok: true;
  businessId: string;
  businessName: string;
  timezone: string;
  asOf: string;
  promotions: PublicWebsitePromotion[];
};

type WebsitePromotionRow = {
  id: string;
  business_id: string;
  slug: string;
  label: string;
  starts_at: string;
  ends_at: string;
  audience: string;
  priority: number;
  is_active: boolean;
  countdown_prefix: string;
  page_meta_title: string | null;
  page_meta_description: string | null;
  page_content: unknown;
  hero_enabled: boolean;
  hero_image_url: string | null;
  hero_image_alt: string;
  popup_enabled: boolean;
  popup_title: string;
  popup_body: string;
  popup_cta_label: string | null;
  popup_cta_href: string | null;
  home_button_enabled: boolean;
  home_section_id: string | null;
  home_button_label: string | null;
  home_button_href: string | null;
  floating_enabled: boolean;
  floating_label: string | null;
  floating_href: string | null;
};

type PosFwpRow = {
  id: string;
  business_id: string;
  quantity: number;
  free_item_id: string;
  trigger_item_ids: unknown;
  created_at?: string;
  updated_at?: string;
};

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((value) => String(value ?? "").trim()).filter(Boolean);
}

function normalizeAudience(value: unknown): WebsitePromotionAudience {
  const key = trimText(value).toLowerCase();
  if (key === "app" || key === "both") return key;
  return "web";
}

function audienceMatches(
  promotionAudience: WebsitePromotionAudience,
  filter: WebsitePromotionAudience | "all",
): boolean {
  if (filter === "all") return true;
  if (filter === "web") return promotionAudience === "web" || promotionAudience === "both";
  if (filter === "app") return promotionAudience === "app" || promotionAudience === "both";
  return promotionAudience === filter;
}

function pickPrimaryCta(row: WebsitePromotionRow): { url: string | null; label: string | null } {
  const candidates: Array<{ url: string | null; label: string | null }> = [
    { url: trimText(row.floating_href) || null, label: trimText(row.floating_label) || null },
    { url: trimText(row.home_button_href) || null, label: trimText(row.home_button_label) || null },
    { url: trimText(row.popup_cta_href) || null, label: trimText(row.popup_cta_label) || null },
  ];
  for (const candidate of candidates) {
    if (candidate.url) return candidate;
  }
  const slug = trimText(row.slug);
  return slug ? { url: `/${slug}`, label: trimText(row.label) || null } : { url: null, label: null };
}

function mapCampaignRow(row: WebsitePromotionRow): PublicWebsitePromotion {
  const label = trimText(row.label);
  const cta = pickPrimaryCta(row);
  const heroImageUrl = trimText(row.hero_image_url) || null;
  return {
    id: row.id,
    slug: trimText(row.slug),
    label,
    title: label,
    kind: "campaign",
    audience: normalizeAudience(row.audience),
    priority: Number.isFinite(row.priority) ? row.priority : 100,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    imageUrl: heroImageUrl,
    ctaUrl: cta.url,
    ctaLabel: cta.label,
    countdownPrefix: trimText(row.countdown_prefix) || "Sale Ends In",
    pageMetaTitle: trimText(row.page_meta_title) || null,
    pageMetaDescription: trimText(row.page_meta_description) || null,
    pageContent: parseJsonObject(row.page_content),
    heroEnabled: row.hero_enabled === true,
    heroImageUrl,
    heroImageAlt: trimText(row.hero_image_alt),
    popupEnabled: row.popup_enabled === true,
    popupTitle: trimText(row.popup_title),
    popupBody: trimText(row.popup_body),
    popupCtaLabel: trimText(row.popup_cta_label) || null,
    popupCtaHref: trimText(row.popup_cta_href) || null,
    homeButtonEnabled: row.home_button_enabled === true,
    homeSectionId: trimText(row.home_section_id) || null,
    homeButtonLabel: trimText(row.home_button_label) || null,
    homeButtonHref: trimText(row.home_button_href) || null,
    floatingEnabled: row.floating_enabled === true,
    floatingLabel: trimText(row.floating_label) || null,
    floatingHref: trimText(row.floating_href) || null,
  };
}

function buildPosOfferPromotion(
  row: PosFwpRow,
  inventoryById: Map<string, { name: string }>,
  asOfIso: string,
): PublicWebsitePromotion {
  const freeItem = inventoryById.get(row.free_item_id);
  const triggerIds = parseStringArray(row.trigger_item_ids);
  const triggerNames = triggerIds
    .map((id) => inventoryById.get(id)?.name?.trim())
    .filter(Boolean) as string[];
  const freeName = freeItem?.name?.trim() || "Free item";
  const triggerLabel = triggerNames.length > 0 ? triggerNames.join(", ") : "eligible purchase";
  const title = `${row.quantity}× ${freeName} free with ${triggerLabel}`;

  return {
    id: row.id,
    slug: `pos-offer-${row.id}`,
    label: title,
    title,
    kind: "pos_free_with_purchase",
    audience: "both",
    priority: 1000,
    startsAt: asOfIso,
    endsAt: new Date(Date.parse(asOfIso) + 3650 * 24 * 60 * 60 * 1000).toISOString(),
    imageUrl: null,
    ctaUrl: null,
    ctaLabel: null,
    countdownPrefix: "Offer",
    pageMetaTitle: null,
    pageMetaDescription: null,
    pageContent: {},
    heroEnabled: false,
    heroImageUrl: null,
    heroImageAlt: "",
    popupEnabled: false,
    popupTitle: "",
    popupBody: "",
    popupCtaLabel: null,
    popupCtaHref: null,
    homeButtonEnabled: false,
    homeSectionId: null,
    homeButtonLabel: null,
    homeButtonHref: null,
    floatingEnabled: false,
    floatingLabel: null,
    floatingHref: null,
    posOffer: {
      quantity: row.quantity,
      freeItemId: row.free_item_id,
      freeItemName: freeName,
      triggerItemIds: triggerIds,
      triggerItemNames: triggerNames,
    },
  };
}

export type LoadPublicWebsitePromotionsOptions = {
  audience?: WebsitePromotionAudience | "all";
  slug?: string;
  includePosOffers?: boolean;
  activeOnly?: boolean;
  asOf?: Date;
  limit?: number;
};

export async function loadPublicWebsitePromotions(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  options: LoadPublicWebsitePromotionsOptions = {},
): Promise<PublicWebsitePromotionsPayload> {
  const audienceFilter = options.audience ?? "web";
  const activeOnly = options.activeOnly !== false;
  const asOf = options.asOf ?? new Date();
  const asOfIso = asOf.toISOString();
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const slugFilter = trimText(options.slug).toLowerCase();
  const includePosOffers = options.includePosOffers !== false;

  const [{ data: business }, { data: campaignRows, error: campaignErr }] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, timezone")
      .eq("id", businessId)
      .maybeSingle(),
    supabase
      .from("business_website_promotions")
      .select("*")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .order("priority", { ascending: true })
      .order("ends_at", { ascending: true })
      .limit(100),
  ]);

  if (campaignErr) throw new Error(campaignErr.message);
  if (!business) throw new Error("Business not found");

  const promotions: PublicWebsitePromotion[] = [];
  for (const raw of (campaignRows ?? []) as WebsitePromotionRow[]) {
    if (slugFilter && trimText(raw.slug).toLowerCase() !== slugFilter) continue;
    if (activeOnly) {
      const starts = Date.parse(String(raw.starts_at));
      const ends = Date.parse(String(raw.ends_at));
      const now = asOf.getTime();
      if (!Number.isFinite(starts) || !Number.isFinite(ends) || now < starts || now > ends) {
        continue;
      }
    }
    const mapped = mapCampaignRow(raw);
    if (!audienceMatches(mapped.audience, audienceFilter)) continue;
    promotions.push(mapped);
    if (promotions.length >= limit) break;
  }

  if (includePosOffers && promotions.length < limit && !slugFilter) {
    const { data: posRows } = await supabase
      .from("pos_free_with_purchase_promotions")
      .select("id, business_id, quantity, free_item_id, trigger_item_ids, created_at, updated_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(20);

    const inventoryIds = new Set<string>();
    for (const row of (posRows ?? []) as PosFwpRow[]) {
      inventoryIds.add(row.free_item_id);
      for (const id of parseStringArray(row.trigger_item_ids)) inventoryIds.add(id);
    }

    let inventoryById = new Map<string, { name: string }>();
    if (inventoryIds.size > 0) {
      const { data: inventoryRows } = await supabase
        .from("pos_inventory")
        .select("id, name")
        .eq("business_id", businessId)
        .in("id", Array.from(inventoryIds));
      inventoryById = new Map(
        ((inventoryRows ?? []) as Array<{ id: string; name?: string }>).map((row) => [
          row.id,
          { name: String(row.name || "").trim() },
        ]),
      );
    }

    for (const row of (posRows ?? []) as PosFwpRow[]) {
      if (promotions.length >= limit) break;
      if (!audienceMatches("both", audienceFilter)) continue;
      promotions.push(buildPosOfferPromotion(row, inventoryById, asOfIso));
    }
  }

  promotions.sort((a, b) => a.priority - b.priority || Date.parse(a.endsAt) - Date.parse(b.endsAt));

  return {
    ok: true,
    businessId,
    businessName: trimText(business.name) || "Business",
    timezone: trimText(business.timezone) || "America/Toronto",
    asOf: asOfIso,
    promotions: promotions.slice(0, limit),
  };
}
