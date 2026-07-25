/** Public website concession menu for external marketing sites (OTWK). */

import {
  INVENTORY_WEBSITE_SELECT_COLS,
  mapInventoryToPublicProduct,
  type InventoryRow,
  type PublicProduct,
} from "./tavariPublicProducts.ts";

export type WebsiteMenuSource = "manual" | "api";

export type StoredMenuPrice =
  | { type: "single"; price: string }
  | { type: "range"; min: string; max: string }
  | { type: "sizes"; sizes: { label: string; price: string }[] }
  | { type: "options"; options: { label: string; price: string }[] };

export type StoredMenuItemManual = {
  id: string;
  kind: "manual";
  name: string;
  note?: string;
  imageSrc?: string;
  imageAlt?: string;
  price: StoredMenuPrice;
};

export type StoredMenuItemTavariVariant = {
  label: string;
  tavariProductId: string;
};

export type StoredMenuItemTavari = {
  id: string;
  kind: "tavari";
  tavariProductId: string;
  priceLayout?: "single" | "sizes" | "options";
  displayName?: string;
  variants?: StoredMenuItemTavariVariant[];
  note?: string;
};

export type StoredMenuItem = StoredMenuItemManual | StoredMenuItemTavari;

export type StoredMenuSection = {
  id: string;
  title: string;
  subtitle?: string;
  items: StoredMenuItem[];
};

export type PublicWebsiteMenuLinkedProduct = {
  id: string;
  name: string;
  description: string;
  priceFormatted: string;
  gatePriceFormatted: string;
  imageUrl: string;
  available: boolean;
};

export type PublicWebsiteMenuPrice =
  | { type: "single"; price: string }
  | { type: "range"; min: string; max: string }
  | {
    type: "sizes";
    sizes: Array<{ label: string; price: string; tavariProductId?: string }>;
  }
  | {
    type: "options";
    options: Array<{ label: string; price: string; tavariProductId?: string }>;
  };

export type PublicWebsiteMenuItem = {
  id: string;
  kind: "manual" | "tavari";
  name: string;
  note: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  price: PublicWebsiteMenuPrice;
  tavariProductId: string | null;
  priceLayout: "single" | "sizes" | "options" | null;
  product: PublicWebsiteMenuLinkedProduct | null;
  variants: Array<{
    label: string;
    tavariProductId: string;
    product: PublicWebsiteMenuLinkedProduct | null;
  }>;
};

export type PublicWebsiteMenuSection = {
  id: string;
  title: string;
  subtitle: string | null;
  sortOrder: number;
  items: PublicWebsiteMenuItem[];
};

export type PublicWebsiteMenuPayload = {
  ok: true;
  businessId: string;
  businessName: string;
  timezone: string;
  asOf: string;
  menuSource: WebsiteMenuSource;
  menuPdfUrl: string | null;
  sections: PublicWebsiteMenuSection[];
};

type WebsiteMenuRow = {
  business_id: string;
  menu_source: string;
  menu_sections: unknown;
  menu_pdf_url: string | null;
};

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMenuSource(value: unknown): WebsiteMenuSource {
  return trimText(value).toLowerCase() === "manual" ? "manual" : "api";
}

function mapLinkedProduct(product: PublicProduct | null | undefined): PublicWebsiteMenuLinkedProduct | null {
  if (!product) return null;
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    priceFormatted: product.priceFormatted,
    gatePriceFormatted: product.gatePriceFormatted,
    imageUrl: product.imageUrl,
    available: product.available,
  };
}

function productPriceText(product: PublicProduct): string {
  return trimText(product.gatePriceFormatted) || trimText(product.priceFormatted);
}

function coerceMenuPrice(raw: unknown): StoredMenuPrice | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = o.type;
  if (type === "single" && typeof o.price === "string") {
    return { type: "single", price: trimText(o.price) };
  }
  if (type === "range" && typeof o.min === "string" && typeof o.max === "string") {
    return { type: "range", min: trimText(o.min), max: trimText(o.max) };
  }
  if (type === "sizes" && Array.isArray(o.sizes)) {
    const sizes: { label: string; price: string }[] = [];
    for (const row of o.sizes) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const label = trimText(r.label);
      const price = trimText(r.price);
      if (label && price) sizes.push({ label, price });
    }
    if (sizes.length) return { type: "sizes", sizes };
  }
  if (type === "options" && Array.isArray(o.options)) {
    const options: { label: string; price: string }[] = [];
    for (const row of o.options) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const label = trimText(r.label);
      const price = trimText(r.price);
      if (label && price) options.push({ label, price });
    }
    if (options.length) return { type: "options", options };
  }
  return null;
}

function coerceStoredMenuItem(raw: unknown): StoredMenuItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = trimText(o.id) || `menu-item-${crypto.randomUUID().slice(0, 8)}`;
  const kind = o.kind === "tavari" ? "tavari" : o.kind === "manual" ? "manual" : null;

  if (kind === "tavari") {
    const tavariProductId = trimText(o.tavariProductId) || trimText(o.tavari_product_id);
    const priceLayoutRaw = trimText(o.priceLayout);
    const priceLayout =
      priceLayoutRaw === "sizes" || priceLayoutRaw === "options" ? priceLayoutRaw : "single";
    const displayName = trimText(o.displayName);
    const note = trimText(o.note);
    const variants: StoredMenuItemTavariVariant[] = [];
    if (Array.isArray(o.variants)) {
      for (const row of o.variants) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const label = trimText(r.label);
        const variantProductId = trimText(r.tavariProductId) || trimText(r.tavari_product_id);
        if (!label || !variantProductId) continue;
        variants.push({ label, tavariProductId: variantProductId });
      }
    }
    if (priceLayout === "single" && !tavariProductId) return null;
    if (priceLayout !== "single" && variants.length === 0 && !tavariProductId) return null;
    return {
      id,
      kind: "tavari",
      tavariProductId,
      priceLayout,
      ...(displayName ? { displayName } : {}),
      ...(variants.length ? { variants } : {}),
      ...(note ? { note } : {}),
    };
  }

  if (kind === "manual") {
    const name = trimText(o.name);
    const price = coerceMenuPrice(o.price);
    if (!name || !price) return null;
    const note = trimText(o.note);
    const imageSrc = trimText(o.imageSrc);
    const imageAlt = trimText(o.imageAlt);
    return {
      id,
      kind: "manual",
      name,
      price,
      ...(note ? { note } : {}),
      ...(imageSrc ? { imageSrc } : {}),
      ...(imageAlt ? { imageAlt } : {}),
    };
  }

  return null;
}

export function parseStoredMenuSections(raw: unknown): StoredMenuSection[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredMenuSection[] = [];
  for (const sectionRaw of raw) {
    if (!sectionRaw || typeof sectionRaw !== "object") continue;
    const s = sectionRaw as Record<string, unknown>;
    const id = trimText(s.id) || `menu-section-${out.length}`;
    const title = trimText(s.title);
    if (!title) continue;
    const subtitle = trimText(s.subtitle);
    const itemsRaw = Array.isArray(s.items) ? s.items : [];
    const items: StoredMenuItem[] = [];
    for (const itemRaw of itemsRaw) {
      const item = coerceStoredMenuItem(itemRaw);
      if (item) items.push(item);
    }
    out.push({
      id,
      title,
      ...(subtitle ? { subtitle } : {}),
      items,
    });
  }
  return out;
}

export function collectTavariProductIdsFromMenuSections(sections: StoredMenuSection[]): string[] {
  const ids = new Set<string>();
  for (const section of sections) {
    for (const item of section.items) {
      if (item.kind !== "tavari") continue;
      const primaryId = trimText(item.tavariProductId);
      if (primaryId) ids.add(primaryId);
      for (const variant of item.variants ?? []) {
        const variantId = trimText(variant.tavariProductId);
        if (variantId) ids.add(variantId);
      }
    }
  }
  return Array.from(ids);
}

function manualStoredToPublic(item: StoredMenuItemManual): PublicWebsiteMenuItem | null {
  if (!item.name.trim()) return null;
  return {
    id: item.id,
    kind: "manual",
    name: item.name.trim(),
    note: item.note?.trim() || null,
    imageUrl: item.imageSrc?.trim() || null,
    imageAlt: item.imageAlt?.trim() || item.name.trim(),
    price: item.price,
    tavariProductId: null,
    priceLayout: null,
    product: null,
    variants: [],
  };
}

function tavariProductToPublicItem(
  item: StoredMenuItemTavari,
  product: PublicProduct,
  noteOverride?: string,
): PublicWebsiteMenuItem | null {
  if (!product.available || !product.name.trim()) return null;
  const priceText = productPriceText(product);
  if (!priceText) return null;
  const note = trimText(noteOverride) || trimText(product.description) || null;
  const name = trimText(item.displayName) || product.name.trim();
  return {
    id: item.id,
    kind: "tavari",
    name,
    note,
    imageUrl: trimText(product.imageUrl) || null,
    imageAlt: name,
    price: { type: "single", price: priceText },
    tavariProductId: product.id,
    priceLayout: "single",
    product: mapLinkedProduct(product),
    variants: [],
  };
}

function resolveTavariVariantRows(
  item: StoredMenuItemTavari,
  productsById: Map<string, PublicProduct>,
): Array<{ label: string; price: string; tavariProductId: string; product: PublicWebsiteMenuLinkedProduct | null }> {
  const rows: Array<{ label: string; price: string; tavariProductId: string; product: PublicWebsiteMenuLinkedProduct | null }> = [];
  for (const variant of item.variants ?? []) {
    const label = trimText(variant.label);
    const productId = trimText(variant.tavariProductId);
    if (!label || !productId) continue;
    const product = productsById.get(productId);
    if (!product?.available) continue;
    const price = productPriceText(product);
    if (!price) continue;
    rows.push({
      label,
      price,
      tavariProductId: productId,
      product: mapLinkedProduct(product),
    });
  }
  return rows;
}

function tavariStoredToPublic(
  item: StoredMenuItemTavari,
  productsById: Map<string, PublicProduct>,
): PublicWebsiteMenuItem | null {
  const layout = item.priceLayout ?? "single";
  const note = item.note?.trim() || null;

  if (layout === "sizes" || layout === "options") {
    const rows = resolveTavariVariantRows(item, productsById);
    if (rows.length === 0) return null;

    const primary = item.tavariProductId.trim() ? productsById.get(item.tavariProductId.trim()) : undefined;
    const imageProduct =
      primary?.available && trimText(primary.imageUrl)
        ? primary
        : (item.variants ?? [])
          .map((v) => productsById.get(trimText(v.tavariProductId)))
          .find((p) => p?.available && trimText(p.imageUrl));

    const name =
      trimText(item.displayName) ||
      trimText(primary?.name) ||
      trimText(item.variants?.[0]?.label) ||
      "";
    if (!name) return null;

    const price: PublicWebsiteMenuPrice = layout === "sizes"
      ? {
        type: "sizes",
        sizes: rows.map((row) => ({
          label: row.label,
          price: row.price,
          tavariProductId: row.tavariProductId,
        })),
      }
      : {
        type: "options",
        options: rows.map((row) => ({
          label: row.label,
          price: row.price,
          tavariProductId: row.tavariProductId,
        })),
      };

    return {
      id: item.id,
      kind: "tavari",
      name,
      note,
      imageUrl: trimText(imageProduct?.imageUrl) || null,
      imageAlt: name,
      price,
      tavariProductId: trimText(item.tavariProductId) || rows[0]?.tavariProductId || null,
      priceLayout: layout,
      product: mapLinkedProduct(primary ?? imageProduct),
      variants: rows.map((row) => ({
        label: row.label,
        tavariProductId: row.tavariProductId,
        product: row.product,
      })),
    };
  }

  const product = productsById.get(trimText(item.tavariProductId));
  if (!product) return null;
  const mapped = tavariProductToPublicItem(item, product, item.note);
  if (!mapped) return null;
  if (trimText(item.displayName)) mapped.name = trimText(item.displayName);
  return mapped;
}

async function loadProductsByIds(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  ids: string[],
): Promise<Map<string, PublicProduct>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("pos_inventory")
    .select(INVENTORY_WEBSITE_SELECT_COLS)
    .eq("business_id", businessId)
    .in("id", ids);
  if (error) throw new Error(error.message);

  const out = new Map<string, PublicProduct>();
  for (const row of (data ?? []) as InventoryRow[]) {
    const mapped = mapInventoryToPublicProduct(row, { includeWhenUnavailable: true });
    if (mapped) out.set(mapped.id, mapped);
  }
  return out;
}

function resolveStoredSectionsToPublic(
  stored: StoredMenuSection[],
  productsById: Map<string, PublicProduct> | undefined,
  useApi: boolean,
): PublicWebsiteMenuSection[] {
  const out: PublicWebsiteMenuSection[] = [];
  stored.forEach((section, sectionIndex) => {
    const items: PublicWebsiteMenuItem[] = [];
    for (const item of section.items) {
      if (useApi && item.kind === "tavari") {
        const mapped = tavariStoredToPublic(item, productsById ?? new Map());
        if (mapped) items.push(mapped);
      } else if (item.kind === "manual") {
        const mapped = manualStoredToPublic(item);
        if (mapped) items.push(mapped);
      }
    }
    if (items.length === 0) return;
    out.push({
      id: section.id,
      title: section.title,
      subtitle: section.subtitle?.trim() || null,
      sortOrder: sectionIndex,
      items,
    });
  });
  return out;
}

export async function loadPublicWebsiteMenu(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  options: { asOf?: Date } = {},
): Promise<PublicWebsiteMenuPayload> {
  const asOf = options.asOf ?? new Date();
  const asOfIso = asOf.toISOString();

  const [{ data: business }, { data: menuRow, error: menuErr }] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, timezone")
      .eq("id", businessId)
      .maybeSingle(),
    supabase
      .from("business_website_menu")
      .select("business_id, menu_source, menu_sections, menu_pdf_url")
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);

  if (menuErr) throw new Error(menuErr.message);
  if (!business) throw new Error("Business not found");

  const row = menuRow as WebsiteMenuRow | null;
  const menuSource = normalizeMenuSource(row?.menu_source);
  const stored = parseStoredMenuSections(row?.menu_sections ?? []);
  const useApi = menuSource === "api";
  const ids = useApi ? collectTavariProductIdsFromMenuSections(stored) : [];
  const productsById = ids.length > 0 ? await loadProductsByIds(supabase, businessId, ids) : undefined;
  const sections = resolveStoredSectionsToPublic(stored, productsById, useApi);

  return {
    ok: true,
    businessId,
    businessName: trimText(business.name) || "Business",
    timezone: trimText(business.timezone) || "America/Toronto",
    asOf: asOfIso,
    menuSource,
    menuPdfUrl: trimText(row?.menu_pdf_url) || null,
    sections,
  };
}
