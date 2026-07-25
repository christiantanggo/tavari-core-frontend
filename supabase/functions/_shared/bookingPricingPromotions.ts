import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const BOOKING_PROMOTION_CHANNELS = ["online", "in_person", "both"] as const;
export const BOOKING_PROMOTION_PRICE_MODES = [
  "override_prices",
  "percent_off",
  "fixed_off",
  "flat_package_price",
] as const;

export type BookingPricingPromotionRow = {
  id?: string;
  business_id?: string;
  name?: string;
  description?: string | null;
  internal_notes?: string | null;
  is_active?: boolean;
  priority?: number;
  promo_code?: string | null;
  channel?: string;
  activity_scope?: {
    mode?: string;
    category_keys?: string[];
    activity_ids?: string[];
  };
  purchase_starts_at?: string | null;
  purchase_ends_at?: string | null;
  visit_start_date?: string | null;
  visit_end_date?: string | null;
  visit_days_of_week?: number[] | null;
  visit_start_time?: string | null;
  visit_end_time?: string | null;
  visit_times?: string[] | null;
  visit_blackout_dates?: string[] | null;
  price_adjustments?: {
    mode?: string;
    items?: Array<{
      inventory_item_id?: string;
      price?: number | null;
      percent?: number | null;
      amount?: number | null;
    }>;
    flat_price?: number | null;
  };
  min_tickets?: number | null;
  max_total_redemptions?: number | null;
  max_redemptions_per_customer?: number | null;
  apply_conditional_free_rules?: boolean;
  uses_count?: number;
};

export type PromotionMatchContext = {
  activityId?: string | null;
  categoryKey?: string | null;
  bookingDate?: string | null;
  bookingTime?: string | null;
  purchaseAt?: Date | string;
  promoCode?: string;
  channel?: "online" | "in_person";
  totalTickets?: number;
};

export function normalizeBookingTimeValue(timeValue: unknown): string | null {
  if (timeValue == null || timeValue === "") return null;
  const raw = String(timeValue).trim();
  if (!raw) return null;

  const ampmMatch = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hours = Number.parseInt(ampmMatch[1], 10);
    const minutes = ampmMatch[2];
    const seconds = ampmMatch[3] || "00";
    if (/PM/i.test(ampmMatch[4]) && hours < 12) hours += 12;
    if (/AM/i.test(ampmMatch[4]) && hours === 12) hours = 0;
    return `${String(hours).padStart(2, "0")}:${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  const hmsMatch = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hmsMatch) {
    return `${String(hmsMatch[1]).padStart(2, "0")}:${hmsMatch[2]}:${hmsMatch[3] || "00"}`;
  }

  return raw;
}

function bookingTimeToMinutes(timeValue: unknown): number | null {
  const normalized = normalizeBookingTimeValue(timeValue);
  if (!normalized) return null;
  const match = normalized.match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
}

function parseBookingDateOnly(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}

function parseDateOnlyToUtcMs(dateOnly: string): number | null {
  const match = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function dayOfWeekFromDateOnly(dateOnly: string): number | null {
  const ms = parseDateOnlyToUtcMs(dateOnly);
  if (ms == null) return null;
  return new Date(ms).getUTCDay();
}

function normalizePromoCode(code: unknown): string {
  if (code == null) return "";
  return String(code).trim().toUpperCase();
}

function normalizeActivityScope(scope: BookingPricingPromotionRow["activity_scope"]) {
  const parsed = scope && typeof scope === "object" ? scope : {};
  const mode = parsed.mode === "categories" || parsed.mode === "activities" ? parsed.mode : "all";
  return {
    mode,
    category_keys: Array.isArray(parsed.category_keys)
      ? parsed.category_keys.map((key) => String(key).trim()).filter(Boolean)
      : [],
    activity_ids: Array.isArray(parsed.activity_ids)
      ? parsed.activity_ids.map((id) => String(id).trim()).filter(Boolean)
      : [],
  };
}

export function normalizePriceAdjustments(raw: BookingPricingPromotionRow["price_adjustments"]) {
  const parsed = raw && typeof raw === "object" ? raw : {};
  const mode = BOOKING_PROMOTION_PRICE_MODES.includes(parsed.mode as typeof BOOKING_PROMOTION_PRICE_MODES[number])
    ? parsed.mode
    : "override_prices";
  const items = Array.isArray(parsed.items)
    ? parsed.items
      .map((row) => ({
        inventory_item_id: row?.inventory_item_id ? String(row.inventory_item_id) : "",
        price: row?.price != null ? Number(row.price) : null,
        percent: row?.percent != null ? Number(row.percent) : null,
        amount: row?.amount != null ? Number(row.amount) : null,
      }))
      .filter((row) => row.inventory_item_id)
    : [];
  return {
    mode,
    items,
    flat_price: parsed.flat_price != null ? Number(parsed.flat_price) : null,
  };
}

export function normalizeBookingPricingPromotion(row: BookingPricingPromotionRow | null | undefined) {
  if (!row || typeof row !== "object") return null;
  return {
    ...row,
    id: row.id ? String(row.id) : null,
    business_id: row.business_id ? String(row.business_id) : null,
    is_active: row.is_active !== false,
    priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : 0,
    promo_code: row.promo_code ? String(row.promo_code).trim() : "",
    channel: BOOKING_PROMOTION_CHANNELS.includes(row.channel as typeof BOOKING_PROMOTION_CHANNELS[number])
      ? row.channel
      : "both",
    activity_scope: normalizeActivityScope(row.activity_scope),
    visit_days_of_week: Array.isArray(row.visit_days_of_week)
      ? row.visit_days_of_week.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6)
      : [],
    visit_times: Array.isArray(row.visit_times)
      ? row.visit_times.map((t) => normalizeBookingTimeValue(t)).filter(Boolean) as string[]
      : [],
    visit_blackout_dates: Array.isArray(row.visit_blackout_dates)
      ? row.visit_blackout_dates.map((d) => parseBookingDateOnly(d)).filter(Boolean) as string[]
      : [],
    price_adjustments: normalizePriceAdjustments(row.price_adjustments),
    min_tickets: row.min_tickets != null && row.min_tickets !== undefined
      ? Math.max(0, Number.parseInt(String(row.min_tickets), 10) || 0)
      : null,
    max_total_redemptions: row.max_total_redemptions != null && row.max_total_redemptions !== undefined
      ? Math.max(0, Number.parseInt(String(row.max_total_redemptions), 10) || 0)
      : null,
    max_redemptions_per_customer: row.max_redemptions_per_customer != null &&
        row.max_redemptions_per_customer !== undefined
      ? Math.max(0, Number.parseInt(String(row.max_redemptions_per_customer), 10) || 0)
      : null,
    apply_conditional_free_rules: row.apply_conditional_free_rules !== false,
    uses_count: Number(row.uses_count) || 0,
  };
}

function promotionMatchesContext(promotion: ReturnType<typeof normalizeBookingPricingPromotion>, context: PromotionMatchContext) {
  if (!promotion || promotion.is_active === false) return false;

  const channel = context.channel || "online";
  if (promotion.channel !== "both" && promotion.channel !== channel) return false;

  const scope = promotion.activity_scope || { mode: "all", category_keys: [], activity_ids: [] };
  if (scope.mode === "activities" && !scope.activity_ids.includes(String(context.activityId || ""))) {
    return false;
  }
  if (scope.mode === "categories" && !scope.category_keys.includes(String(context.categoryKey || ""))) {
    return false;
  }

  const purchaseAt = context.purchaseAt instanceof Date
    ? context.purchaseAt
    : new Date(context.purchaseAt || Date.now());
  if (promotion.purchase_starts_at && purchaseAt < new Date(promotion.purchase_starts_at)) return false;
  if (promotion.purchase_ends_at && purchaseAt > new Date(promotion.purchase_ends_at)) return false;

  const visitDate = parseBookingDateOnly(context.bookingDate);
  if (!visitDate) return false;
  if (promotion.visit_blackout_dates?.includes(visitDate)) return false;
  if (promotion.visit_start_date) {
    const startMs = parseDateOnlyToUtcMs(parseBookingDateOnly(promotion.visit_start_date) || "");
    const visitMs = parseDateOnlyToUtcMs(visitDate);
    if (startMs != null && visitMs != null && visitMs < startMs) return false;
  }
  if (promotion.visit_end_date) {
    const endMs = parseDateOnlyToUtcMs(parseBookingDateOnly(promotion.visit_end_date) || "");
    const visitMs = parseDateOnlyToUtcMs(visitDate);
    if (endMs != null && visitMs != null && visitMs > endMs) return false;
  }
  if (promotion.visit_days_of_week?.length) {
    const dow = dayOfWeekFromDateOnly(visitDate);
    if (dow == null || !promotion.visit_days_of_week.includes(dow)) return false;
  }

  const specificTimes = promotion.visit_times || [];
  if (specificTimes.length > 0) {
    const normalizedTime = normalizeBookingTimeValue(context.bookingTime);
    if (!normalizedTime) return false;
    if (!specificTimes.includes(normalizedTime)) return false;
  } else {
    const normalizedTime = normalizeBookingTimeValue(context.bookingTime);
    if (normalizedTime) {
      const visitMinutes = bookingTimeToMinutes(normalizedTime);
      const startMinutes = promotion.visit_start_time ? bookingTimeToMinutes(promotion.visit_start_time) : null;
      const endMinutes = promotion.visit_end_time ? bookingTimeToMinutes(promotion.visit_end_time) : null;
      if (startMinutes != null && visitMinutes != null && visitMinutes < startMinutes) return false;
      if (endMinutes != null && visitMinutes != null && visitMinutes > endMinutes) return false;
    }
  }

  const requiredCode = normalizePromoCode(promotion.promo_code);
  if (requiredCode && normalizePromoCode(context.promoCode) !== requiredCode) return false;

  if (promotion.min_tickets != null && promotion.min_tickets > 0) {
    if ((context.totalTickets || 0) < promotion.min_tickets) return false;
  }

  if (promotion.max_total_redemptions != null && promotion.max_total_redemptions > 0) {
    if ((promotion.uses_count || 0) >= promotion.max_total_redemptions) return false;
  }

  return true;
}

export function resolveApplicableBookingPromotion(
  promotions: BookingPricingPromotionRow[] = [],
  context: PromotionMatchContext = {},
) {
  const matches = (promotions || [])
    .map((row) => normalizeBookingPricingPromotion(row))
    .filter(Boolean)
    .filter((promotion) => promotionMatchesContext(promotion, context))
    .sort((a, b) => (b!.priority || 0) - (a!.priority || 0));

  return matches[0] || null;
}

type InventoryRow = { id: string; price?: number | string | null };

export function buildPriceOverridesFromPromotion(
  promotion: BookingPricingPromotionRow | ReturnType<typeof normalizeBookingPricingPromotion> | null,
  items: InventoryRow[] = [],
  selectedTickets: Record<string, number> = {},
): Record<string, number> {
  const normalized = normalizeBookingPricingPromotion(promotion || undefined);
  if (!normalized) return {};

  const adjustments = normalized.price_adjustments || { mode: "override_prices", items: [] };
  const itemById = new Map(items.map((item) => [String(item.id), item]));
  const selectedIds = Object.keys(selectedTickets).filter((id) => (selectedTickets[id] || 0) > 0);
  const targetIds = selectedIds.length > 0
    ? selectedIds
    : (adjustments.items || []).map((row) => row.inventory_item_id);

  const overrides: Record<string, number> = {};

  if (adjustments.mode === "flat_package_price") {
    const flatPrice = Number(adjustments.flat_price);
    if (!Number.isFinite(flatPrice)) return overrides;
    const packageIds = (adjustments.items || []).length > 0
      ? adjustments.items.map((row) => row.inventory_item_id)
      : targetIds;
    packageIds.forEach((itemId) => {
      if (itemById.has(itemId)) overrides[itemId] = flatPrice;
    });
    return overrides;
  }

  (adjustments.items || []).forEach((row) => {
    const itemId = row.inventory_item_id;
    const item = itemById.get(itemId);
    if (!item) return;
    const basePrice = Number.parseFloat(String(item.price ?? 0)) || 0;

    if (adjustments.mode === "override_prices") {
      if (Number.isFinite(Number(row.price))) overrides[itemId] = Math.max(0, Number(row.price));
      return;
    }
    if (adjustments.mode === "percent_off") {
      const pct = Number(row.percent ?? 0);
      if (!Number.isFinite(pct)) return;
      overrides[itemId] = Math.max(0, basePrice * (1 - pct / 100));
      return;
    }
    if (adjustments.mode === "fixed_off") {
      const amount = Number(row.amount ?? 0);
      if (!Number.isFinite(amount)) return;
      overrides[itemId] = Math.max(0, basePrice - amount);
    }
  });

  return overrides;
}

export async function loadActiveBookingPricingPromotions(
  supabase: SupabaseClient,
  businessId: string,
): Promise<BookingPricingPromotionRow[]> {
  const { data, error } = await supabase
    .from("booking_pricing_promotions")
    .select("*")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("priority", { ascending: false });

  if (error) throw error;
  return (data || []) as BookingPricingPromotionRow[];
}

export async function resolvePortalBookingPromotion(options: {
  supabase: SupabaseClient;
  businessId: string;
  activityId: string;
  categoryKey?: string | null;
  bookingDate: string;
  bookingTime: string;
  promoCode?: string;
  totalTickets?: number;
  purchaseAt?: Date;
}) {
  const promotions = await loadActiveBookingPricingPromotions(options.supabase, options.businessId);
  return resolveApplicableBookingPromotion(promotions, {
    activityId: options.activityId,
    categoryKey: options.categoryKey,
    bookingDate: options.bookingDate,
    bookingTime: options.bookingTime,
    promoCode: options.promoCode,
    channel: "online",
    totalTickets: options.totalTickets,
    purchaseAt: options.purchaseAt || new Date(),
  });
}
