import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  calculateOnlineCheckoutAmounts,
  amountsMatchWithinCent,
  type ParsedOnlinePaymentSettings,
} from "./bookingPaymentSettings.ts";
import {
  buildPriceOverridesFromPromotion,
  loadActiveBookingPricingPromotions,
  resolveApplicableBookingPromotion,
  type BookingPricingPromotionRow,
} from "./bookingPricingPromotions.ts";
import {
  buildMultiDayProratedPriceOverrides,
  mergeTicketPriceOverrides,
  parseMultiDaySettings,
  resolveMultiDaySeriesDayCountForDate,
} from "./bookingMultiDayPricing.ts";
import { resolveInventoryTicketPrice } from "./bookingCheckoutPricing.ts";

const roundMoney = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

type InventoryRow = {
  id: string;
  price?: number | string | null;
  website_online_price?: number | string | null;
  category_id?: string | null;
  item_tax_overrides?: string[] | null;
};

type TaxCategory = {
  id: string;
  name?: string;
  rate?: number | string | null;
  category_type?: string | null;
  is_active?: boolean | null;
};

type TaxAssignment = {
  category_id: string;
  pos_tax_categories?: TaxCategory | null;
};

type PricingRule = {
  inventory_item_id?: string;
  enabled?: boolean;
  trigger_item_ids?: string[];
  trigger_quantity?: number;
  discounted_quantity?: number;
  max_discounted_quantity?: number | null;
  count_paid_triggers_only?: boolean;
};

function participantRowsToTicketCounts(
  rows: Array<{ inventory_item_id?: string | null }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const id = String(row?.inventory_item_id || "").trim();
    if (!id) continue;
    counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

function addonRowsSubtotal(
  addonRows: Array<{ inventory_item_id?: string | null; quantity?: number | null; unit_price?: number | null }>,
  inventoryPrices: Record<string, number>,
): number {
  let subtotal = 0;
  for (const row of addonRows || []) {
    const itemId = String(row?.inventory_item_id || "").trim();
    const qty = Math.max(0, Number(row?.quantity) || 0);
    if (!itemId || qty <= 0) continue;
    const unit =
      row?.unit_price != null && Number.isFinite(Number(row.unit_price))
        ? Number(row.unit_price)
        : Number(inventoryPrices[itemId] || 0);
    subtotal += unit * qty;
  }
  return roundMoney(subtotal);
}

function normalizePricingRules(rules: PricingRule[], itemIds: Set<string>): PricingRule[] {
  return (rules || [])
    .filter((rule) => rule?.enabled === true && rule.inventory_item_id && itemIds.has(rule.inventory_item_id))
    .map((rule) => ({
      ...rule,
      trigger_item_ids: (Array.isArray(rule.trigger_item_ids) ? rule.trigger_item_ids : [])
        .filter((id) => itemIds.has(id)),
      trigger_quantity: Math.max(1, Number.parseInt(String(rule.trigger_quantity ?? 1), 10) || 1),
      discounted_quantity: Math.max(1, Number.parseInt(String(rule.discounted_quantity ?? 1), 10) || 1),
    }))
    .filter((rule) => (rule.trigger_item_ids?.length || 0) > 0);
}

function calculateTicketSubtotal(
  selectedTickets: Record<string, number>,
  items: InventoryRow[],
  ticketSettings: Record<string, unknown>,
  priceOverridesByItemId: Record<string, number> = {},
): number {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const itemIds = new Set(items.map((item) => item.id));
  const pricingRules = normalizePricingRules(
    (ticketSettings?.pricing_rules as PricingRule[]) || [],
    itemIds,
  );

  let freeQuantitiesByItem: Record<string, number> = {};

  if (pricingRules.length > 0) {
    let previousSerialized: string | null = null;
    for (let pass = 0; pass < 8; pass += 1) {
      const paidQuantitiesForPass: Record<string, number> = {};
      for (const [inventoryItemId, quantity] of Object.entries(selectedTickets)) {
        paidQuantitiesForPass[inventoryItemId] = Math.max(
          0,
          (quantity || 0) - (freeQuantitiesByItem[inventoryItemId] || 0),
        );
      }

      const nextFreeQuantities: Record<string, number> = {};

      for (const rule of pricingRules) {
        const selectedQty = selectedTickets[rule.inventory_item_id!] || 0;
        if (selectedQty <= 0) continue;

        const hasSelfTrigger = (rule.trigger_item_ids || []).includes(rule.inventory_item_id!);
        const nonSelfTriggerIds = (rule.trigger_item_ids || []).filter((id) => id !== rule.inventory_item_id);
        const triggerSource = rule.count_paid_triggers_only !== false
          ? paidQuantitiesForPass
          : selectedTickets;
        const externalTriggerCount = nonSelfTriggerIds.reduce(
          (sum, triggerId) => sum + (triggerSource[triggerId] || 0),
          0,
        );

        const externalAllowance =
          Math.floor(externalTriggerCount / (rule.trigger_quantity || 1)) * (rule.discounted_quantity || 1);
        let allowedFreeQty = externalAllowance;
        if (hasSelfTrigger) {
          const bundleSize = (rule.trigger_quantity || 1) + (rule.discounted_quantity || 1);
          if (bundleSize > 0) {
            const selfAllowance =
              Math.floor(selectedQty / bundleSize) * (rule.discounted_quantity || 1);
            allowedFreeQty = Math.max(externalAllowance, selfAllowance);
          }
        }
        if (allowedFreeQty <= 0) continue;

        if (rule.max_discounted_quantity != null && rule.max_discounted_quantity >= 0) {
          allowedFreeQty = Math.min(allowedFreeQty, rule.max_discounted_quantity);
        }

        const freeQty = Math.min(selectedQty, allowedFreeQty);
        if (freeQty > 0) {
          nextFreeQuantities[rule.inventory_item_id!] = freeQty;
        }
      }

      const nextSerialized = JSON.stringify(nextFreeQuantities);
      if (nextSerialized === previousSerialized) {
        freeQuantitiesByItem = nextFreeQuantities;
        break;
      }
      freeQuantitiesByItem = nextFreeQuantities;
      previousSerialized = nextSerialized;
    }
  }

  let subtotal = 0;
  for (const [inventoryItemId, quantity] of Object.entries(selectedTickets)) {
    if ((quantity || 0) <= 0) continue;
    const item = itemById.get(inventoryItemId);
    const basePrice = resolveInventoryTicketPrice(item || {});
    const unitPrice = priceOverridesByItemId[inventoryItemId] != null
      ? Number.parseFloat(String(priceOverridesByItemId[inventoryItemId])) || 0
      : basePrice;
    const freeQty = Math.min(quantity || 0, freeQuantitiesByItem[inventoryItemId] || 0);
    const paidQty = Math.max(0, (quantity || 0) - freeQty);
    subtotal += unitPrice * paidQty;
  }

  return roundMoney(subtotal);
}

function getItemTaxes(
  item: InventoryRow,
  taxCategories: TaxCategory[],
  assignments: TaxAssignment[],
): TaxCategory[] {
  const applicable: TaxCategory[] = [];

  if (item.category_id) {
    for (const assignment of assignments) {
      if (assignment.category_id !== item.category_id) continue;
      const tax = assignment.pos_tax_categories;
      if (tax) applicable.push(tax);
    }
  }

  if (Array.isArray(item.item_tax_overrides) && item.item_tax_overrides.length > 0) {
    for (const tax of taxCategories) {
      if (item.item_tax_overrides.includes(tax.id)) applicable.push(tax);
    }
  }

  return applicable.filter((tax, index, self) =>
    index === self.findIndex((t) => t.id === tax.id)
  );
}

function calculateCartTax(
  cartLines: Array<{ item: InventoryRow; quantity: number; unitPrice: number }>,
  taxCategories: TaxCategory[],
  assignments: TaxAssignment[],
): number {
  let totalTax = 0;

  for (const line of cartLines) {
    if (line.quantity <= 0) continue;
    const lineSubtotal = line.unitPrice * line.quantity;
    const taxes = getItemTaxes(line.item, taxCategories, assignments);
    for (const tax of taxes) {
      if (tax.category_type !== "tax") continue;
      totalTax += lineSubtotal * (Number.parseFloat(String(tax.rate ?? 0)) || 0);
    }
  }

  return roundMoney(totalTax);
}

async function loadPortalTaxData(supabase: SupabaseClient, businessId: string) {
  const [{ data: taxCategories }, { data: assignments }] = await Promise.all([
    supabase
      .from("pos_tax_categories")
      .select("id, name, rate, category_type, is_active")
      .eq("business_id", businessId)
      .eq("is_active", true),
    supabase
      .from("pos_category_tax_assignments")
      .select("category_id, tax_category_id, pos_tax_categories(id, name, rate, category_type, is_active)")
      .eq("business_id", businessId),
  ]);

  return {
    taxCategories: (taxCategories || []) as TaxCategory[],
    assignments: (assignments || []) as TaxAssignment[],
  };
}

export type PortalCheckoutPricingResult =
  | {
      ok: true;
      subtotal: number;
      taxAmount: number;
      orderTotalWithTax: number;
      chargeNow: number;
      pricingPromotionId?: string | null;
    }
  | { ok: false; message: string };

export async function validatePortalHelcimCheckoutAmounts(options: {
  supabase: SupabaseClient;
  businessId: string;
  ticketSettings: Record<string, unknown>;
  participantRows: Array<{ inventory_item_id?: string | null }>;
  addonRows?: Array<{ inventory_item_id?: string | null; quantity?: number | null; unit_price?: number | null }>;
  addonInventoryPrices?: Record<string, number>;
  clientAmount: number;
  clientOrderTotalWithTax: number;
  onlinePayment: ParsedOnlinePaymentSettings;
  activityId?: string;
  categoryKey?: string | null;
  bookingDate?: string;
  bookingTime?: string;
  promoCode?: string;
  clientPricingPromotionId?: string | null;
  priceOverridesByItemId?: Record<string, number>;
  resolvedPromotion?: BookingPricingPromotionRow | null;
  /** When true, only order total is verified (Helcim amount checked separately after gift card). */
  skipClientAmountCheck?: boolean;
}): Promise<PortalCheckoutPricingResult> {
  const {
    supabase,
    businessId,
    ticketSettings,
    participantRows,
    addonRows = [],
    addonInventoryPrices = {},
    clientAmount,
    clientOrderTotalWithTax,
    onlinePayment,
    activityId,
    categoryKey,
    bookingDate,
    bookingTime,
    promoCode,
    clientPricingPromotionId,
    priceOverridesByItemId: providedOverrides = {},
    resolvedPromotion: providedPromotion = null,
    skipClientAmountCheck = false,
  } = options;

  const ticketCounts = participantRowsToTicketCounts(participantRows);
  const inventoryIds = [
    ...new Set([
      ...Object.keys(ticketCounts),
      ...addonRows.map((row) => String(row?.inventory_item_id || "").trim()).filter(Boolean),
    ]),
  ];

  if (inventoryIds.length === 0) {
    return { ok: false, message: "No ticket or add-on items in checkout." };
  }

  const { data: inventoryRows, error: inventoryError } = await supabase
    .from("pos_inventory")
    .select("id, price, website_online_price, category_id, item_tax_overrides")
    .eq("business_id", businessId)
    .in("id", inventoryIds);

  if (inventoryError || !inventoryRows?.length) {
    return { ok: false, message: "Could not validate ticket pricing." };
  }

  // Portal / Helcim checkout uses online price when set; gate price remains the fallback.
  const items = (inventoryRows as InventoryRow[]).map((item) => ({
    ...item,
    price: resolveInventoryTicketPrice(item),
  }));

  let resolvedPromotion = providedPromotion;
  if (!resolvedPromotion && activityId && bookingDate && bookingTime) {
    const promotions = await loadActiveBookingPricingPromotions(supabase, businessId);
    resolvedPromotion = resolveApplicableBookingPromotion(promotions, {
      activityId,
      categoryKey,
      bookingDate,
      bookingTime,
      promoCode,
      channel: "online",
      totalTickets: Object.values(ticketCounts).reduce((sum, qty) => sum + (qty || 0), 0),
      purchaseAt: new Date(),
    });
  }

  if (clientPricingPromotionId) {
    if (!resolvedPromotion?.id || String(resolvedPromotion.id) !== String(clientPricingPromotionId)) {
      return { ok: false, message: "Promotion is invalid or no longer available for this booking." };
    }
  }

  const multiDayConfig = parseMultiDaySettings(ticketSettings);
  let weekDayCount: number | null = multiDayConfig?.dayCount ?? null;
  if (multiDayConfig && activityId && bookingDate) {
    const { data: scheduleRows } = await supabase
      .from("booking_activity_schedules")
      .select("schedule_name, start_date, end_date")
      .eq("business_id", businessId)
      .eq("activity_id", activityId)
      .eq("is_active", true);
    const fromSchedule = resolveMultiDaySeriesDayCountForDate(scheduleRows || [], bookingDate);
    if (fromSchedule) weekDayCount = fromSchedule;
  }

  const proratedOverrides = buildMultiDayProratedPriceOverrides(items, {
    weekDayCount,
    fullWeekDayCount: multiDayConfig?.dayCount ?? null,
  });
  const itemsForPromo = Object.keys(proratedOverrides).length > 0
    ? items.map((item) => (
      proratedOverrides[item.id] != null
        ? { ...item, price: proratedOverrides[item.id] }
        : item
    ))
    : items;

  const promotionOverrides = Object.keys(providedOverrides).length > 0
    ? providedOverrides
    : resolvedPromotion
      ? buildPriceOverridesFromPromotion(resolvedPromotion, itemsForPromo, ticketCounts)
      : {};

  const priceOverridesByItemId = mergeTicketPriceOverrides(proratedOverrides, promotionOverrides);

  const ticketSubtotal = calculateTicketSubtotal(ticketCounts, items, ticketSettings, priceOverridesByItemId);
  const addonSubtotal = addonRowsSubtotal(addonRows, addonInventoryPrices);
  const subtotal = roundMoney(ticketSubtotal + addonSubtotal);

  const itemById = new Map(items.map((item) => [item.id, item]));
  const { taxCategories, assignments } = await loadPortalTaxData(supabase, businessId);

  const cartLines: Array<{ item: InventoryRow; quantity: number; unitPrice: number }> = [];

  // Ticket paid lines (respect pricing rules free qty)
  const pricingRules = normalizePricingRules(
    (ticketSettings?.pricing_rules as PricingRule[]) || [],
    new Set(items.map((item) => item.id)),
  );
  let freeQuantitiesByItem: Record<string, number> = {};
  if (pricingRules.length > 0) {
    // Re-use calculateTicketSubtotal logic output via duplicate pass for paid qty only
    const selectedTickets = ticketCounts;
    let previousSerialized: string | null = null;
    for (let pass = 0; pass < 8; pass += 1) {
      const paidQuantitiesForPass: Record<string, number> = {};
      for (const [inventoryItemId, quantity] of Object.entries(selectedTickets)) {
        paidQuantitiesForPass[inventoryItemId] = Math.max(
          0,
          (quantity || 0) - (freeQuantitiesByItem[inventoryItemId] || 0),
        );
      }
      const nextFreeQuantities: Record<string, number> = {};
      for (const rule of pricingRules) {
        const selectedQty = selectedTickets[rule.inventory_item_id!] || 0;
        if (selectedQty <= 0) continue;
        const hasSelfTrigger = (rule.trigger_item_ids || []).includes(rule.inventory_item_id!);
        const nonSelfTriggerIds = (rule.trigger_item_ids || []).filter((id) => id !== rule.inventory_item_id);
        const triggerSource = rule.count_paid_triggers_only !== false
          ? paidQuantitiesForPass
          : selectedTickets;
        const externalTriggerCount = nonSelfTriggerIds.reduce(
          (sum, triggerId) => sum + (triggerSource[triggerId] || 0),
          0,
        );
        const externalAllowance =
          Math.floor(externalTriggerCount / (rule.trigger_quantity || 1)) * (rule.discounted_quantity || 1);
        let allowedFreeQty = externalAllowance;
        if (hasSelfTrigger) {
          const bundleSize = (rule.trigger_quantity || 1) + (rule.discounted_quantity || 1);
          if (bundleSize > 0) {
            allowedFreeQty = Math.max(
              externalAllowance,
              Math.floor(selectedQty / bundleSize) * (rule.discounted_quantity || 1),
            );
          }
        }
        if (rule.max_discounted_quantity != null && rule.max_discounted_quantity >= 0) {
          allowedFreeQty = Math.min(allowedFreeQty, rule.max_discounted_quantity);
        }
        const freeQty = Math.min(selectedQty, allowedFreeQty);
        if (freeQty > 0) nextFreeQuantities[rule.inventory_item_id!] = freeQty;
      }
      const nextSerialized = JSON.stringify(nextFreeQuantities);
      if (nextSerialized === previousSerialized) {
        freeQuantitiesByItem = nextFreeQuantities;
        break;
      }
      freeQuantitiesByItem = nextFreeQuantities;
      previousSerialized = nextSerialized;
    }
  }

  for (const [inventoryItemId, quantity] of Object.entries(ticketCounts)) {
    const item = itemById.get(inventoryItemId);
    if (!item || (quantity || 0) <= 0) continue;
    const unitPrice = priceOverridesByItemId[inventoryItemId] != null
      ? Number.parseFloat(String(priceOverridesByItemId[inventoryItemId])) || 0
      : Number.parseFloat(String(item.price ?? 0)) || 0;
    const freeQty = Math.min(quantity || 0, freeQuantitiesByItem[inventoryItemId] || 0);
    const paidQty = Math.max(0, (quantity || 0) - freeQty);
    if (paidQty > 0) cartLines.push({ item, quantity: paidQty, unitPrice });
  }

  for (const row of addonRows || []) {
    const itemId = String(row?.inventory_item_id || "").trim();
    const qty = Math.max(0, Number(row?.quantity) || 0);
    if (!itemId || qty <= 0) continue;
    const item = itemById.get(itemId);
    if (!item) continue;
    const unitPrice =
      row?.unit_price != null && Number.isFinite(Number(row.unit_price))
        ? Number(row.unit_price)
        : Number.parseFloat(String(item.price ?? 0)) || 0;
    cartLines.push({ item, quantity: qty, unitPrice });
  }

  const taxAmount = calculateCartTax(cartLines, taxCategories, assignments);
  const orderTotalWithTax = roundMoney(subtotal + taxAmount);
  const expectedCheckout = calculateOnlineCheckoutAmounts(orderTotalWithTax, onlinePayment);
  const chargeNow = expectedCheckout.chargeNow;

  if (!amountsMatchWithinCent(clientOrderTotalWithTax, orderTotalWithTax)) {
    return {
      ok: false,
      message: `Checkout total mismatch. Expected ${orderTotalWithTax.toFixed(2)} (incl. tax), received ${clientOrderTotalWithTax.toFixed(2)}.`,
    };
  }

  if (!skipClientAmountCheck && !amountsMatchWithinCent(clientAmount, chargeNow)) {
    return {
      ok: false,
      message: `Payment amount mismatch. Expected ${chargeNow.toFixed(2)}, received ${clientAmount.toFixed(2)}.`,
    };
  }

  return {
    ok: true,
    subtotal,
    taxAmount,
    orderTotalWithTax,
    chargeNow,
    pricingPromotionId: resolvedPromotion?.id ? String(resolvedPromotion.id) : null,
  };
}
