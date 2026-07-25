import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SupabaseClient = ReturnType<typeof createClient>;

const nowIso = () => new Date().toISOString();

const dollarsToLoyaltyPoints = (dollars: number, redemptionRate: number) => {
  const r = Number(redemptionRate) || 10000;
  const d = Number(dollars) || 0;
  return Math.round((d * r) / 10);
};

const sumCartItemBonusPoints = (
  items: Array<{ loyalty_points_earned?: number; quantity?: number }> = [],
) =>
  items.reduce((sum, item) => {
    const bonus = Math.max(0, Number.parseInt(String(item?.loyalty_points_earned ?? 0), 10) || 0);
    const qty = Math.max(0, Number.parseInt(String(item?.quantity ?? 1), 10) || 1);
    return sum + bonus * qty;
  }, 0);

export type AwardBookingLoyaltyResult = {
  awarded: boolean;
  pointsAwarded: number;
  skippedReason?: string;
};

/**
 * Award loyalty points for a paid online booking (server-side, idempotent).
 * Uses booking id as transaction_id so client + server cannot double-credit.
 */
export async function awardBookingLoyaltyPoints(
  supabase: SupabaseClient,
  {
    businessId,
    bookingId,
    customerId,
    bookingSubtotal,
  }: {
    businessId: string;
    bookingId: string;
    customerId: string | null | undefined;
    bookingSubtotal: number;
  },
): Promise<AwardBookingLoyaltyResult> {
  if (!businessId || !bookingId) {
    return { awarded: false, pointsAwarded: 0, skippedReason: "missing_ids" };
  }
  if (!customerId) {
    return { awarded: false, pointsAwarded: 0, skippedReason: "no_customer" };
  }

  const { data: existingTx } = await supabase
    .from("pos_loyalty_transactions")
    .select("id, points")
    .eq("business_id", businessId)
    .eq("loyalty_account_id", customerId)
    .eq("transaction_id", bookingId)
    .eq("transaction_type", "earn")
    .limit(1)
    .maybeSingle();

  if (existingTx?.id) {
    return {
      awarded: false,
      pointsAwarded: Number(existingTx.points) || 0,
      skippedReason: "already_awarded",
    };
  }

  const { data: settings, error: settingsError } = await supabase
    .from("pos_loyalty_settings")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  if (settingsError) {
    console.warn("[awardBookingLoyalty] settings load failed:", settingsError);
    return { awarded: false, pointsAwarded: 0, skippedReason: "settings_error" };
  }
  if (!settings || settings.is_active === false) {
    return { awarded: false, pointsAwarded: 0, skippedReason: "loyalty_inactive" };
  }

  const { data: participants } = await supabase
    .from("booking_participants")
    .select("inventory_item_id")
    .eq("booking_id", bookingId);

  const { data: addonItems } = await supabase
    .from("booking_addon_items")
    .select("quantity, booking_addons(inventory_item_id)")
    .eq("booking_id", bookingId);

  const invIds = [
    ...(participants || []).map((p) => p.inventory_item_id).filter(Boolean),
    ...(addonItems || [])
      .map((row: Record<string, unknown>) => {
        const addon = row.booking_addons as { inventory_item_id?: string } | null;
        return addon?.inventory_item_id || null;
      })
      .filter(Boolean),
  ] as string[];

  let cartLikeLines: Array<{ loyalty_points_earned: number; quantity: number }> = [];
  if (invIds.length > 0) {
    const { data: invRows } = await supabase
      .from("pos_inventory")
      .select("id, loyalty_points_earned")
      .eq("business_id", businessId)
      .in("id", [...new Set(invIds)]);
    const bonusById = new Map((invRows || []).map((r) => [r.id, r.loyalty_points_earned || 0]));
    cartLikeLines = [
      ...(participants || []).map((p) => ({
        loyalty_points_earned: Number(bonusById.get(p.inventory_item_id) || 0),
        quantity: 1,
      })),
      ...(addonItems || []).map((row: Record<string, unknown>) => {
        const addon = row.booking_addons as { inventory_item_id?: string } | null;
        const inventoryId = addon?.inventory_item_id || null;
        return {
          loyalty_points_earned: inventoryId ? Number(bonusById.get(inventoryId) || 0) : 0,
          quantity: Math.max(1, Number(row.quantity) || 1),
        };
      }),
    ];
  }

  const { data: account, error: accountError } = await supabase
    .from("pos_loyalty_accounts")
    .select("*")
    .eq("business_id", businessId)
    .eq("id", customerId)
    .maybeSingle();

  if (accountError) {
    console.warn("[awardBookingLoyalty] account load failed:", accountError);
    return { awarded: false, pointsAwarded: 0, skippedReason: "account_error" };
  }
  if (!account) {
    return { awarded: false, pointsAwarded: 0, skippedReason: "account_missing" };
  }

  const subtotal = Math.max(0, Number(bookingSubtotal) || 0);
  const earnRatePercent = (Number(settings.earn_rate_percentage) || 0) / 100;
  const creditsToEarn = subtotal * earnRatePercent;
  const itemBonus = sumCartItemBonusPoints(cartLikeLines);
  const basePoints = dollarsToLoyaltyPoints(creditsToEarn, Number(settings.redemption_rate) || 10000);
  const pointsToEarn = Math.max(0, basePoints + itemBonus);

  if (pointsToEarn === 0 && creditsToEarn === 0) {
    return { awarded: false, pointsAwarded: 0, skippedReason: "zero_points" };
  }

  const currentBalance = Number.parseFloat(String(account.balance || 0)) || 0;
  const currentPoints = Number.parseInt(String(account.points || 0), 10) || 0;
  const newBalance = currentBalance + creditsToEarn;
  const newPoints = settings.loyalty_mode === "dollars"
    ? Math.round(newBalance * (Number(settings.redemption_rate) || 1))
    : currentPoints + pointsToEarn;

  let expiryDate: string | null = null;
  if (settings.credits_expire && settings.expiry_months) {
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + Number(settings.expiry_months));
    expiryDate = expiry.toISOString().split("T")[0];
  }

  const { error: updateError } = await supabase
    .from("pos_loyalty_accounts")
    .update({
      balance: newBalance,
      points: newPoints,
      total_earned: (Number.parseFloat(String(account.total_earned || 0)) || 0) + creditsToEarn,
      last_activity: nowIso(),
      updated_at: nowIso(),
    })
    .eq("id", account.id)
    .eq("business_id", businessId);

  if (updateError) {
    console.error("[awardBookingLoyalty] account update failed:", updateError);
    return { awarded: false, pointsAwarded: 0, skippedReason: "update_failed" };
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const bonusNote = itemBonus > 0 ? ` (includes ${itemBonus} item bonus pts)` : "";

  const { error: txError } = await supabase.from("pos_loyalty_transactions").insert({
    business_id: businessId,
    loyalty_account_id: account.id,
    transaction_id: bookingId,
    transaction_type: "earn",
    amount: creditsToEarn,
    points: pointsToEarn,
    balance_before: currentBalance,
    balance_after: newBalance,
    points_before: currentPoints,
    points_after: newPoints,
    description: `Points earned from online booking${bonusNote}`,
    earned_date: tomorrow.toISOString().split("T")[0],
    expires_at: expiryDate,
    processed_at: nowIso(),
  });

  if (txError) {
    // Unique collision = another path already awarded; treat as success.
    if (String(txError.code) === "23505") {
      return { awarded: false, pointsAwarded: pointsToEarn, skippedReason: "already_awarded" };
    }
    console.error("[awardBookingLoyalty] transaction insert failed:", txError);
    // Points already on account — still report awarded.
  }

  return { awarded: true, pointsAwarded: pointsToEarn };
}
