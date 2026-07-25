/** Shared POS → public website product mapping for tavari-api-business-products. */

export type WebsiteProductContext = "admission";

export type InventoryRow = {
  id: string;
  name: string;
  description: string | null;
  price: number | string | null;
  website_online_price?: number | string | null;
  image_url: string | null;
  sort_order: number | null;
  track_stock: boolean | null;
  stock_quantity: number | null;
  is_active: boolean | null;
  expose_to_website_api: boolean | null;
  website_show_admission_pricing?: boolean | null;
};

export type UnavailableReason = "inactive" | "not_exposed" | "out_of_stock" | "not_found";

export type PublicProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  priceFormatted: string;
  gatePrice: number;
  gatePriceFormatted: string;
  onlinePrice: number | null;
  onlinePriceFormatted: string | null;
  imageUrl: string;
  sortOrder: number;
  available: boolean;
  unavailableReason?: UnavailableReason;
};

const WEBSITE_CONTEXTS: WebsiteProductContext[] = ["admission"];

export function parseWebsiteContext(
  req: Request,
  body: Record<string, unknown>,
): WebsiteProductContext | null {
  const url = new URL(req.url);
  const raw = (
    url.searchParams.get("context") ??
    url.searchParams.get("websiteContext") ??
    String(body.context ?? body.websiteContext ?? "")
  )
    .trim()
    .toLowerCase();

  if (!raw) return null;
  if (WEBSITE_CONTEXTS.includes(raw as WebsiteProductContext)) {
    return raw as WebsiteProductContext;
  }
  return null;
}

export function inventoryMatchesWebsiteContext(
  row: InventoryRow,
  context: WebsiteProductContext | null,
): boolean {
  if (!context) return true;
  if (context === "admission") return row.website_show_admission_pricing === true;
  return true;
}

export function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parsePrice(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function parseOptionalPrice(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = parsePrice(value);
  return Number.isFinite(n) ? n : null;
}

export function formatCadPrice(price: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price);
}

export function buildProductPriceFields(row: Pick<InventoryRow, "price" | "website_online_price">) {
  const gatePrice = parsePrice(row.price);
  const onlineRaw = parseOptionalPrice(row.website_online_price);
  const onlinePrice = onlineRaw != null && onlineRaw >= 0 ? onlineRaw : null;
  return {
    price: gatePrice,
    priceFormatted: formatCadPrice(gatePrice),
    gatePrice,
    gatePriceFormatted: formatCadPrice(gatePrice),
    onlinePrice,
    onlinePriceFormatted: onlinePrice != null ? formatCadPrice(onlinePrice) : null,
  };
}

function emptyProductPriceFields() {
  return {
    price: 0,
    priceFormatted: "",
    gatePrice: 0,
    gatePriceFormatted: "",
    onlinePrice: null,
    onlinePriceFormatted: null,
  };
}

export function getUnavailableReason(row: InventoryRow | null | undefined): UnavailableReason {
  if (!row) return "not_found";
  if (row.is_active === false) return "inactive";
  if (!row.expose_to_website_api) return "not_exposed";
  if (row.track_stock === true && (row.stock_quantity ?? 0) <= 0) return "out_of_stock";
  return "not_found";
}

export function isProductAvailable(row: InventoryRow | null | undefined): boolean {
  if (!row) return false;
  if (row.is_active === false) return false;
  if (!row.expose_to_website_api) return false;
  if (row.track_stock === true && (row.stock_quantity ?? 0) <= 0) return false;
  return true;
}

export function mapInventoryToPublicProduct(
  row: InventoryRow,
  options: { includeWhenUnavailable?: boolean; context?: WebsiteProductContext | null } = {},
): PublicProduct | null {
  const context = options.context ?? null;
  if (context && !inventoryMatchesWebsiteContext(row, context)) {
    return null;
  }

  const available = isProductAvailable(row);
  if (!available && !options.includeWhenUnavailable) {
    return null;
  }

  const priceFields = buildProductPriceFields(row);
  const base: PublicProduct = {
    id: row.id,
    name: trimText(row.name),
    description: trimText(row.description),
    ...priceFields,
    imageUrl: trimText(row.image_url),
    sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0,
    available,
  };

  if (!available) {
    base.unavailableReason = getUnavailableReason(row);
    if (base.unavailableReason === "not_found") {
      return null;
    }
    if (base.unavailableReason === "not_exposed") {
      return {
        id: row.id,
        name: "",
        description: "",
        ...emptyProductPriceFields(),
        imageUrl: "",
        sortOrder: 0,
        available: false,
        unavailableReason: "not_exposed",
      };
    }
  }

  return base;
}

export const INVENTORY_WEBSITE_SELECT_COLS =
  "id, name, description, price, website_online_price, image_url, sort_order, track_stock, stock_quantity, is_active, expose_to_website_api, website_show_admission_pricing";
