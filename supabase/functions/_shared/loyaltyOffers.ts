import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type PurchaseContext = {
  lastActivityAt: string | null;
  purchasedInventoryIds: Set<string>;
  purchasedCategoryIds: Set<string>;
  bookedCategoryIds: Set<string>;
  bookedActivityIds: Set<string>;
};

type CategorySource = "pos" | "booking";

function categorySourceFromConfig(
  cfg: Record<string, unknown>,
  key = "category_source",
): CategorySource {
  return String(cfg[key] || "pos").trim().toLowerCase() === "booking" ? "booking" : "pos";
}

function categorySetForSource(ctx: PurchaseContext, source: CategorySource): Set<string> {
  return source === "booking" ? ctx.bookedCategoryIds : ctx.purchasedCategoryIds;
}

export type OfferRuleRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  priority: number;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  reward_type: string;
  reward_config: Record<string, unknown>;
  offer_valid_days: number;
  max_active_per_customer: number;
};

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
}

function ruleMatches(ctx: PurchaseContext, rule: OfferRuleRow): boolean {
  const cfg = rule.trigger_config || {};
  switch (rule.trigger_type) {
    case "inactive_days": {
      const minDays = Number(cfg.inactive_days ?? cfg.days ?? 30);
      if (!Number.isFinite(minDays) || minDays <= 0) return false;
      if (!ctx.lastActivityAt) return minDays <= 365;
      const since = daysSince(ctx.lastActivityAt);
      return since != null && since >= minDays;
    }
    case "never_purchased_category": {
      const categoryId = String(cfg.category_id || "").trim();
      const source = categorySourceFromConfig(cfg);
      return categoryId.length > 0 && !categorySetForSource(ctx, source).has(categoryId);
    }
    case "never_purchased_inventory": {
      const itemId = String(cfg.inventory_item_id || "").trim();
      return itemId.length > 0 && !ctx.purchasedInventoryIds.has(itemId);
    }
    case "has_category_not_category": {
      const hasCat = String(cfg.has_category_id || "").trim();
      const missingCat = String(cfg.missing_category_id || "").trim();
      if (!hasCat || !missingCat) return false;
      const hasSource = categorySourceFromConfig(cfg, "has_category_source");
      const missingSource = categorySourceFromConfig(cfg, "missing_category_source");
      const hasSet = categorySetForSource(ctx, hasSource);
      const missingSet = categorySetForSource(ctx, missingSource);
      return hasSet.has(hasCat) && !missingSet.has(missingCat);
    }
    case "never_booked_activity": {
      const activityId = String(cfg.activity_id || "").trim();
      return activityId.length > 0 && !ctx.bookedActivityIds.has(activityId);
    }
    default:
      return false;
  }
}

function enrichRewardConfigFromTrigger(rule: OfferRuleRow): Record<string, unknown> {
  const reward = { ...(rule.reward_config || {}) };
  const trigger = rule.trigger_config || {};
  if (rule.trigger_type === "never_purchased_category" && trigger.category_id) {
    const source = categorySourceFromConfig(trigger);
    if (source === "booking") {
      reward.target_booking_category_ids = [String(trigger.category_id)];
    } else {
      reward.target_category_ids = [String(trigger.category_id)];
    }
  }
  if (rule.trigger_type === "never_purchased_inventory" && trigger.inventory_item_id) {
    reward.target_inventory_ids = [String(trigger.inventory_item_id)];
  }
  if (rule.trigger_type === "has_category_not_category" && trigger.missing_category_id) {
    const source = categorySourceFromConfig(trigger, "missing_category_source");
    if (source === "booking") {
      reward.target_booking_category_ids = [String(trigger.missing_category_id)];
    } else {
      reward.target_category_ids = [String(trigger.missing_category_id)];
    }
  }
  if (rule.trigger_type === "never_booked_activity" && trigger.activity_id) {
    reward.target_activity_ids = [String(trigger.activity_id)];
  }
  return reward;
}

function offerTitle(rule: OfferRuleRow): string {
  const cfg = rule.reward_config || {};
  if (rule.reward_type === "bonus_points") {
    const pts = Number(cfg.bonus_points ?? 0);
    return pts > 0 ? `Earn ${pts.toLocaleString()} bonus points` : rule.name;
  }
  if (rule.reward_type === "percent_discount") {
    const pct = Number(cfg.percent_discount ?? 0);
    return pct > 0 ? `${pct}% off your next purchase` : rule.name;
  }
  if (rule.reward_type === "fixed_discount") {
    const amt = Number(cfg.fixed_discount ?? 0);
    return amt > 0 ? `$${amt.toFixed(2)} off your next purchase` : rule.name;
  }
  return rule.name;
}

export async function buildCustomerPurchaseContext(
  supabase: SupabaseClient,
  businessId: string,
  customerId: string,
): Promise<PurchaseContext> {
  const purchasedInventoryIds = new Set<string>();
  const purchasedCategoryIds = new Set<string>();
  const bookedCategoryIds = new Set<string>();
  const bookedActivityIds = new Set<string>();
  let lastActivityAt: string | null = null;

  const touch = (iso: string | null | undefined) => {
    if (!iso) return;
    if (!lastActivityAt || new Date(iso).getTime() > new Date(lastActivityAt).getTime()) {
      lastActivityAt = iso;
    }
  };

  const { data: sales } = await supabase
    .from("pos_sales")
    .select("id, created_at, pos_sale_items(inventory_id, category_id, quantity)")
    .eq("business_id", businessId)
    .or(`loyalty_customer_id.eq.${customerId},customer_id.eq.${customerId}`)
    .order("created_at", { ascending: false })
    .limit(150);

  for (const sale of sales || []) {
    touch(sale.created_at);
    for (const line of (sale as { pos_sale_items?: Array<{ inventory_id?: string; category_id?: string }> }).pos_sale_items || []) {
      if (line.inventory_id) purchasedInventoryIds.add(String(line.inventory_id));
      if (line.category_id) purchasedCategoryIds.add(String(line.category_id));
    }
  }

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, created_at, activity_id, booking_type_id, booking_addons(inventory_item_id), booking_participants(inventory_item_id)")
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .in("status", ["confirmed", "completed", "paid", "approved"])
    .order("created_at", { ascending: false })
    .limit(100);

  const activityIdsMissingType = new Set<string>();

  for (const booking of bookings || []) {
    touch(booking.created_at);
    if (booking.activity_id) {
      bookedActivityIds.add(String(booking.activity_id));
      activityIdsMissingType.add(String(booking.activity_id));
    }
    if (booking.booking_type_id) {
      bookedCategoryIds.add(String(booking.booking_type_id));
    }
    for (const row of (booking as { booking_addons?: Array<{ inventory_item_id?: string }> }).booking_addons || []) {
      if (row.inventory_item_id) purchasedInventoryIds.add(String(row.inventory_item_id));
    }
    for (const row of (booking as { booking_participants?: Array<{ inventory_item_id?: string }> }).booking_participants || []) {
      if (row.inventory_item_id) purchasedInventoryIds.add(String(row.inventory_item_id));
    }
  }

  if (activityIdsMissingType.size > 0) {
    const { data: activityRows } = await supabase
      .from("booking_activities")
      .select("id, type_id")
      .eq("business_id", businessId)
      .in("id", [...activityIdsMissingType]);
    for (const row of activityRows || []) {
      if (row.type_id) bookedCategoryIds.add(String(row.type_id));
    }
  }

  if (purchasedInventoryIds.size > 0) {
    const ids = [...purchasedInventoryIds];
    const { data: invRows } = await supabase
      .from("pos_inventory")
      .select("id, category_id")
      .eq("business_id", businessId)
      .in("id", ids);
    for (const row of invRows || []) {
      if (row.category_id) purchasedCategoryIds.add(String(row.category_id));
    }
  }

  return {
    lastActivityAt,
    purchasedInventoryIds,
    purchasedCategoryIds,
    bookedCategoryIds,
    bookedActivityIds,
  };
}

export async function loadFeaturedRewardItems(
  supabase: SupabaseClient,
  businessId: string,
) {
  const { data } = await supabase
    .from("pos_inventory")
    .select("id, name, price, image_url, loyalty_points_earned, loyalty_rewards_blurb, show_on_rewards_tab")
    .eq("business_id", businessId)
    .eq("show_on_rewards_tab", true)
    .eq("is_active", true)
    .gt("loyalty_points_earned", 0)
    .order("name", { ascending: true })
    .limit(40);

  return (data || [])
    .map((row) => ({
      id: row.id,
      name: row.name,
      bonusPoints: Number(row.loyalty_points_earned) || 0,
      blurb: row.loyalty_rewards_blurb || null,
      imageUrl: row.image_url || null,
      price: Number(row.price) || 0,
    }))
    .filter((row) => row.bonusPoints > 0);
}

export async function syncCustomerLoyaltyOffers(
  supabase: SupabaseClient,
  businessId: string,
  customerId: string,
): Promise<void> {
  await supabase
    .from("customer_loyalty_offers")
    .update({ status: "expired" })
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .eq("status", "active")
    .lt("expires_at", new Date().toISOString());

  const { data: rules } = await supabase
    .from("loyalty_offer_rules")
    .select("*")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("priority", { ascending: true });

  if (!rules?.length) return;

  const ctx = await buildCustomerPurchaseContext(supabase, businessId, customerId);

  const { data: activeOffers } = await supabase
    .from("customer_loyalty_offers")
    .select("id, rule_id")
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .eq("status", "active");

  const activeRuleIds = new Set(
    (activeOffers || []).map((o) => o.rule_id).filter(Boolean),
  );

  for (const rule of rules as OfferRuleRow[]) {
    if (activeRuleIds.has(rule.id)) continue;
    if (!ruleMatches(ctx, rule)) continue;

    const maxActive = Math.max(1, Number(rule.max_active_per_customer) || 1);
    const activeCount = (activeOffers || []).filter((o) => o.rule_id === rule.id).length;
    if (activeCount >= maxActive) continue;

    const validDays = Math.max(1, Number(rule.offer_valid_days) || 14);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + validDays);

    await supabase.from("customer_loyalty_offers").insert({
      business_id: businessId,
      customer_id: customerId,
      rule_id: rule.id,
      title: offerTitle(rule),
      description: rule.description || null,
      reward_type: rule.reward_type,
      reward_config: enrichRewardConfigFromTrigger(rule),
      status: "active",
      expires_at: expiresAt.toISOString(),
      metadata: { rule_name: rule.name, trigger_type: rule.trigger_type },
    });

    activeRuleIds.add(rule.id);
  }
}

export async function loadActiveCustomerOffers(
  supabase: SupabaseClient,
  businessId: string,
  customerId: string,
) {
  const { data } = await supabase
    .from("customer_loyalty_offers")
    .select("id, title, description, reward_type, reward_config, status, expires_at, created_at, rule_id")
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .eq("status", "active")
    .gte("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: true })
    .limit(20);

  return (data || []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    rewardType: row.reward_type,
    rewardConfig: row.reward_config || {},
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    ruleId: row.rule_id,
  }));
}

/** Match cart/booking lines against an active offer; returns first redeemable offer + bonus points. */
export function matchOfferToPurchaseLines(
  offers: Array<{ id: string; rewardType: string; rewardConfig: Record<string, unknown> }>,
  lineInventoryIds: string[],
  lineCategoryIds: string[] = [],
  lineBookingCategoryIds: string[] = [],
  lineActivityIds: string[] = [],
): { offerId: string; bonusPoints: number; percentDiscount: number; fixedDiscount: number } | null {
  const invSet = new Set(lineInventoryIds.filter(Boolean));
  const catSet = new Set(lineCategoryIds.filter(Boolean));
  const bookingCatSet = new Set(lineBookingCategoryIds.filter(Boolean));
  const activitySet = new Set(lineActivityIds.filter(Boolean));

  for (const offer of offers) {
    const cfg = offer.rewardConfig || {};
    const targets = [
      ...(Array.isArray(cfg.target_inventory_ids) ? cfg.target_inventory_ids : []),
      cfg.inventory_item_id ? [cfg.inventory_item_id] : [],
    ].flat().map(String);
    const targetCats = [
      ...(Array.isArray(cfg.target_category_ids) ? cfg.target_category_ids : []),
      cfg.category_id ? [cfg.category_id] : [],
    ].flat().map(String);
    const targetBookingCats = [
      ...(Array.isArray(cfg.target_booking_category_ids) ? cfg.target_booking_category_ids : []),
    ].flat().map(String);
    const targetActivities = [
      ...(Array.isArray(cfg.target_activity_ids) ? cfg.target_activity_ids : []),
      cfg.activity_id ? [cfg.activity_id] : [],
    ].flat().map(String);

    const hasTarget = targets.length > 0 || targetCats.length > 0 ||
      targetBookingCats.length > 0 || targetActivities.length > 0;
    const invMatch = targets.length === 0 || targets.some((id) => invSet.has(id));
    const catMatch = targetCats.length === 0 || targetCats.some((id) => catSet.has(id));
    const bookingCatMatch = targetBookingCats.length === 0 ||
      targetBookingCats.some((id) => bookingCatSet.has(id));
    const activityMatch = targetActivities.length === 0 ||
      targetActivities.some((id) => activitySet.has(id));
    if (hasTarget && !(invMatch && catMatch && bookingCatMatch && activityMatch)) continue;

    if (offer.rewardType === "bonus_points") {
      const pts = Number(cfg.bonus_points ?? 0);
      if (pts > 0) return { offerId: offer.id, bonusPoints: pts, percentDiscount: 0, fixedDiscount: 0 };
    }
    if (offer.rewardType === "percent_discount") {
      const pct = Number(cfg.percent_discount ?? 0);
      if (pct > 0) return { offerId: offer.id, bonusPoints: 0, percentDiscount: pct, fixedDiscount: 0 };
    }
    if (offer.rewardType === "fixed_discount") {
      const amt = Number(cfg.fixed_discount ?? 0);
      if (amt > 0) return { offerId: offer.id, bonusPoints: 0, percentDiscount: 0, fixedDiscount: amt };
    }
  }
  return null;
}

export async function redeemCustomerOffer(
  supabase: SupabaseClient,
  offerId: string,
  customerId: string,
): Promise<void> {
  await supabase
    .from("customer_loyalty_offers")
    .update({ status: "redeemed", redeemed_at: new Date().toISOString() })
    .eq("id", offerId)
    .eq("customer_id", customerId)
    .eq("status", "active");
}
