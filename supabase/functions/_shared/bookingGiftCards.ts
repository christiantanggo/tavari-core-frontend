import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const roundMoney = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

export function normalizeGiftCardCode(code: string): string {
  return String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export type GiftCardRow = {
  id: string;
  business_id: string;
  issuing_business_id?: string | null;
  card_type?: string | null;
  code?: string | null;
  code_normalized?: string | null;
  qr_payload?: string | null;
  status?: string | null;
  balance_remaining?: number | string | null;
  invalid_reason?: string | null;
  expires_at?: string | null;
  first_redeemed_at?: string | null;
  redeemer_customer_id?: string | null;
};

async function canRedeemAtBusiness(
  supabase: SupabaseClient,
  issuerBusinessId: string,
  redeemerBusinessId: string,
): Promise<boolean> {
  if (!issuerBusinessId || !redeemerBusinessId) return false;
  if (issuerBusinessId === redeemerBusinessId) return true;
  const { data, error } = await supabase
    .from("gift_card_business_links")
    .select("id")
    .eq("issuer_business_id", issuerBusinessId)
    .eq("partner_business_id", redeemerBusinessId)
    .eq("status", "approved")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

export async function lookupGiftCardForBusiness(
  supabase: SupabaseClient,
  businessId: string,
  codeOrPayload: string,
): Promise<GiftCardRow | null> {
  const normalized = normalizeGiftCardCode(codeOrPayload);
  const raw = String(codeOrPayload || "").trim();
  if (!normalized && !raw) return null;

  let q = supabase.from("gift_cards").select("*").eq("business_id", businessId);
  q = normalized ? q.eq("code_normalized", normalized) : q.eq("qr_payload", raw);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (data) return data as GiftCardRow;

  if (!normalized) return null;

  const { data: anyCard, error: anyErr } = await supabase
    .from("gift_cards")
    .select("*")
    .eq("code_normalized", normalized)
    .maybeSingle();
  if (anyErr) throw anyErr;
  if (!anyCard) return null;

  const card = anyCard as GiftCardRow;
  if (card.business_id === businessId) return card;

  const issuerId = String(card.issuing_business_id || card.business_id);
  const allowed = await canRedeemAtBusiness(supabase, issuerId, businessId);
  if (!allowed) {
    throw new Error("This gift card cannot be redeemed at this business.");
  }
  return card;
}

export function assertGiftCardRedeemableForBooking(card: GiftCardRow): void {
  const status = String(card.status || "").toLowerCase();
  if (["voided", "replaced", "expired", "redeemed"].includes(status)) {
    throw new Error(card.invalid_reason || `This gift card is ${status}.`);
  }
  if (card.expires_at && new Date(card.expires_at) < new Date()) {
    throw new Error("This gift card has expired.");
  }
  if (String(card.card_type || "money").toLowerCase() !== "money") {
    throw new Error("Only money gift cards can be applied to online bookings.");
  }
  const balance = roundMoney(Number(card.balance_remaining) || 0);
  if (balance <= 0) {
    throw new Error("This gift card has no remaining balance.");
  }
}

export type GiftCardPreviewResult = {
  giftCardId: string;
  code: string;
  balance: number;
  appliedAmount: number;
  remainingDue: number;
};

/** Preview how much of `chargeNow` a gift card can cover (no debit). */
export async function previewGiftCardForBookingCharge(
  supabase: SupabaseClient,
  businessId: string,
  codeOrPayload: string,
  chargeNow: number,
): Promise<GiftCardPreviewResult> {
  const card = await lookupGiftCardForBusiness(supabase, businessId, codeOrPayload);
  if (!card) throw new Error("Gift card not found.");
  assertGiftCardRedeemableForBooking(card);

  const due = roundMoney(Math.max(0, Number(chargeNow) || 0));
  const balance = roundMoney(Number(card.balance_remaining) || 0);
  const appliedAmount = roundMoney(Math.min(balance, due));

  return {
    giftCardId: card.id,
    code: String(card.code || ""),
    balance,
    appliedAmount,
    remainingDue: roundMoney(Math.max(0, due - appliedAmount)),
  };
}

export type RedeemGiftCardForBookingResult = {
  giftCardId: string;
  code: string;
  appliedAmount: number;
};

/**
 * Debit a money gift card toward a booking. Service-role only.
 * Does not attach residual credit (portal customers may not have loyalty linked the same way);
 * residual stays on the card for later use.
 */
export async function redeemGiftCardForBooking(
  supabase: SupabaseClient,
  {
    businessId,
    codeOrPayload,
    amountDollars,
    bookingId,
    customerId = null,
  }: {
    businessId: string;
    codeOrPayload: string;
    amountDollars: number;
    bookingId: string;
    customerId?: string | null;
  },
): Promise<RedeemGiftCardForBookingResult> {
  const requested = roundMoney(amountDollars);
  if (requested <= 0) {
    return { giftCardId: "", code: "", appliedAmount: 0 };
  }

  const card = await lookupGiftCardForBusiness(supabase, businessId, codeOrPayload);
  if (!card) throw new Error("Gift card not found.");
  assertGiftCardRedeemableForBooking(card);

  const issuerId = String(card.issuing_business_id || card.business_id);
  const crossBusiness = issuerId !== businessId;
  const before = roundMoney(Number(card.balance_remaining) || 0);
  const applied = roundMoney(Math.min(before, requested));
  if (applied <= 0) throw new Error("This gift card has no remaining balance.");
  if (applied + 0.009 < requested) {
    throw new Error(
      `Gift card balance is only $${before.toFixed(2)}. Refresh checkout and try again.`,
    );
  }

  const after = roundMoney(before - applied);
  const newStatus = after <= 0 ? "redeemed" : "partially_redeemed";

  const { data: updated, error } = await supabase
    .from("gift_cards")
    .update({
      balance_remaining: after,
      status: newStatus,
      redeemer_customer_id: customerId || card.redeemer_customer_id || null,
      first_redeemed_at: card.first_redeemed_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", card.id)
    .gte("balance_remaining", applied)
    .select("id, code, balance_remaining")
    .maybeSingle();

  if (error) throw error;
  if (!updated) {
    throw new Error("Gift card was updated by another transaction. Please try again.");
  }

  const { data: txRow, error: txErr } = await supabase
    .from("gift_card_transactions")
    .insert({
      business_id: issuerId,
      gift_card_id: card.id,
      customer_id: customerId,
      transaction_type: "redeem",
      amount: -applied,
      balance_before: before,
      balance_after: after,
      redeeming_business_id: businessId,
      booking_id: bookingId,
      reason: "Online booking gift card payment",
      metadata: { source: "portal_booking", requested },
    })
    .select("id")
    .single();
  if (txErr) throw txErr;

  if (crossBusiness && applied > 0) {
    const { data: link } = await supabase
      .from("gift_card_business_links")
      .select("settlement_fee_percent")
      .eq("issuer_business_id", issuerId)
      .eq("partner_business_id", businessId)
      .eq("status", "approved")
      .maybeSingle();
    const feePct = Number(link?.settlement_fee_percent) || 0;
    const fee = roundMoney((applied * feePct) / 100);
    await supabase.from("gift_card_settlements").insert({
      issuer_business_id: issuerId,
      redeemer_business_id: businessId,
      gift_card_transaction_id: txRow?.id,
      amount: applied,
      fee_amount: fee,
      net_amount: roundMoney(applied - fee),
      status: "open",
    });
  }

  return {
    giftCardId: card.id,
    code: String(updated.code || card.code || ""),
    appliedAmount: applied,
  };
}
