/** RevenueCat entitlement id — must match RevenueCat dashboard. */
export const PULLCOPARENT_PREMIUM_ENTITLEMENT = "Premium";

/** Only household premium SKUs for this app (excludes Pet Care and caregiver seats). */
export const PULLCOPARENT_PREMIUM_PRODUCT_PREFIX = "pullcoparent_premium_";

/** Manual / support grants — must not be downgraded by RevenueCat sync. */
export const ADMIN_GRANT_PRODUCT_ID = "admin_grant";

export type PullcoparentSubscriptionStatus = "active" | "trialing" | "cancelled" | "expired";

export interface PullcoparentSubscriptionRow {
  household_id: string;
  purchased_by_user_id: string;
  revenuecat_app_user_id: string;
  product_id: string | null;
  status: PullcoparentSubscriptionStatus;
  expires_at: string | null;
}

export function isOwnAppPremiumProduct(productId: string | null | undefined): boolean {
  return Boolean(productId && productId.startsWith(PULLCOPARENT_PREMIUM_PRODUCT_PREFIX));
}

export function parseExpiresAt(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Matches client-side useHouseholdPremium logic. */
export function isPremiumSubscription(
  status: string | null | undefined,
  expiresAt: string | null | undefined,
): boolean {
  if (!status || status === "expired") return false;
  const exp = parseExpiresAt(expiresAt);
  if (exp && exp <= new Date()) return false;
  return status === "active" || status === "trialing" || status === "cancelled";
}

/** Support grants (product_id admin_grant) must not be overwritten by RevenueCat sync. */
export function isProtectedAdminGrant(row: {
  product_id?: string | null;
  status?: string | null;
  expires_at?: string | null;
} | null | undefined): boolean {
  if (!row || row.product_id !== ADMIN_GRANT_PRODUCT_ID) return false;
  return isPremiumSubscription(row.status, row.expires_at);
}

export function readPurchaserId(subscriber: Record<string, unknown>, fallback: string): string {
  const attrs = subscriber.subscriber_attributes as Record<string, { value?: string }> | undefined;
  const fromAttr = attrs?.purchased_by_user_id?.value?.trim();
  return fromAttr || fallback;
}

export function mapSubscriberToRow(
  householdId: string,
  subscriber: Record<string, unknown>,
  fallbackPurchaserId: string,
): PullcoparentSubscriptionRow {
  const entitlements = subscriber.entitlements as
    | Record<string, { expires_date?: string | null; product_identifier?: string }>
    | undefined;
  const premium = entitlements?.[PULLCOPARENT_PREMIUM_ENTITLEMENT];
  const purchaserId = readPurchaserId(subscriber, fallbackPurchaserId);

  if (!premium) {
    return {
      household_id: householdId,
      purchased_by_user_id: purchaserId,
      revenuecat_app_user_id: householdId,
      product_id: null,
      status: "expired",
      expires_at: null,
    };
  }

  const expiresAt = premium.expires_date
    ? new Date(premium.expires_date).toISOString()
    : null;
  const productId = premium.product_identifier || null;
  const stillValid = !premium.expires_date || new Date(premium.expires_date) > new Date();

  if (productId && !isOwnAppPremiumProduct(productId)) {
    return {
      household_id: householdId,
      purchased_by_user_id: purchaserId,
      revenuecat_app_user_id: householdId,
      product_id: null,
      status: "expired",
      expires_at: null,
    };
  }

  if (!stillValid) {
    return {
      household_id: householdId,
      purchased_by_user_id: purchaserId,
      revenuecat_app_user_id: householdId,
      product_id: productId,
      status: "expired",
      expires_at: expiresAt,
    };
  }

  const subscriptions = subscriber.subscriptions as
    | Record<string, { period_type?: string; unsubscribe_detected_at?: string | null }>
    | undefined;
  const subMeta = productId ? subscriptions?.[productId] : undefined;
  let status: PullcoparentSubscriptionStatus = "active";
  if (subMeta?.period_type === "trial") status = "trialing";
  else if (subMeta?.unsubscribe_detected_at) status = "cancelled";

  return {
    household_id: householdId,
    purchased_by_user_id: purchaserId,
    revenuecat_app_user_id: householdId,
    product_id: productId,
    status,
    expires_at: expiresAt,
  };
}

export async function fetchRevenueCatSubscriber(
  appUserId: string,
): Promise<Record<string, unknown> | null> {
  const key = (Deno.env.get("REVENUECAT_SECRET_API_KEY") || "").trim();
  if (!key) throw new Error("REVENUECAT_SECRET_API_KEY is not configured");

  const res = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
    {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    },
  );

  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RevenueCat API ${res.status}: ${text}`);
  }

  const data = await res.json();
  return (data?.subscriber ?? null) as Record<string, unknown> | null;
}

export function mapWebhookEventToRow(
  householdId: string,
  event: Record<string, unknown>,
  fallbackPurchaserId: string,
): PullcoparentSubscriptionRow | null {
  const type = String(event.type || "").toUpperCase();
  const productId = String(event.product_id || "").trim() || null;
  const entitlementIds = (event.entitlement_ids as string[]) || [];
  const expiresMs = event.expiration_at_ms ? Number(event.expiration_at_ms) : null;
  const expiresAt = expiresMs ? new Date(expiresMs).toISOString() : null;

  if (productId?.startsWith("pullpets_")) return null;

  const activeTypes = new Set([
    "INITIAL_PURCHASE",
    "RENEWAL",
    "UNCANCELLATION",
    "PRODUCT_CHANGE",
    "SUBSCRIPTION_EXTENDED",
    "NON_RENEWING_PURCHASE",
  ]);

  let status: PullcoparentSubscriptionStatus | null = null;

  if (activeTypes.has(type)) {
    if (productId && !isOwnAppPremiumProduct(productId)) return null;
    if (!productId && !entitlementIds.includes(PULLCOPARENT_PREMIUM_ENTITLEMENT)) return null;
    status = event.period_type === "TRIAL" ? "trialing" : "active";
  } else if (type === "CANCELLATION") {
    if (productId && !isOwnAppPremiumProduct(productId)) return null;
    status = "cancelled";
  } else if (type === "EXPIRATION") {
    if (productId && !isOwnAppPremiumProduct(productId)) return null;
    status = "expired";
  } else if (type === "BILLING_ISSUE") {
    if (productId && !isOwnAppPremiumProduct(productId)) return null;
    status = parseExpiresAt(expiresAt) && parseExpiresAt(expiresAt)! > new Date() ? "active" : "expired";
  }

  if (!status) return null;

  const attrs = event.subscriber_attributes as Record<string, { value?: string }> | undefined;
  const purchaserId = attrs?.purchased_by_user_id?.value?.trim() || fallbackPurchaserId;

  return {
    household_id: householdId,
    purchased_by_user_id: purchaserId,
    revenuecat_app_user_id: householdId,
    product_id: productId,
    status,
    expires_at: expiresAt,
  };
}
