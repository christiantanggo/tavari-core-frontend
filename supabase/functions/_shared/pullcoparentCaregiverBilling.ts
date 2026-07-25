/** Caregiver seat product — must match App Store / Play / RevenueCat. */
export const CAREGIVER_SEAT_PRODUCT_ID = "pullcoparent_caregiver_seat_monthly";

export const CAREGIVER_RC_USER_PREFIX = "caregiver-";

export function caregiverRevenueCatAppUserId(caregiverId: string): string {
  return `${CAREGIVER_RC_USER_PREFIX}${caregiverId}`;
}

export function parseCaregiverIdFromAppUserId(appUserId: string): string | null {
  const trimmed = appUserId.trim();
  if (!trimmed.startsWith(CAREGIVER_RC_USER_PREFIX)) return null;
  const id = trimmed.slice(CAREGIVER_RC_USER_PREFIX.length);
  return id || null;
}

export function readCaregiverSeatId(
  subscriber: Record<string, unknown>,
  fallbackCaregiverId: string,
): string {
  const attrs = subscriber.subscriber_attributes as Record<string, { value?: string }> | undefined;
  const fromAttr = attrs?.caregiver_seat_id?.value?.trim();
  return fromAttr || fallbackCaregiverId;
}

export function caregiverSeatIsActive(subscriber: Record<string, unknown>): {
  active: boolean;
  expiresAt: string | null;
  externalId: string | null;
} {
  const subscriptions = subscriber.subscriptions as
    | Record<string, { expires_date?: string | null; unsubscribe_detected_at?: string | null }>
    | undefined;
  const sub = subscriptions?.[CAREGIVER_SEAT_PRODUCT_ID];
  if (!sub) {
    return { active: false, expiresAt: null, externalId: null };
  }

  const expiresAt = sub.expires_date ? new Date(sub.expires_date).toISOString() : null;
  const stillValid = !sub.expires_date || new Date(sub.expires_date) > new Date();
  return {
    active: stillValid,
    expiresAt,
    externalId: String(subscriber.original_app_user_id || "") || null,
  };
}

export function mapCaregiverWebhookEvent(
  caregiverId: string,
  event: Record<string, unknown>,
): { billingStatus: "active" | "past_due" | "suspended" | "cancelled"; periodEnd: string | null } | null {
  const productId = String(event.product_id || "").trim();
  if (productId && productId !== CAREGIVER_SEAT_PRODUCT_ID) return null;

  const type = String(event.type || "").toUpperCase();
  const expiresMs = event.expiration_at_ms ? Number(event.expiration_at_ms) : null;
  const periodEnd = expiresMs ? new Date(expiresMs).toISOString() : null;

  const activeTypes = new Set([
    "INITIAL_PURCHASE",
    "RENEWAL",
    "UNCANCELLATION",
    "PRODUCT_CHANGE",
    "SUBSCRIPTION_EXTENDED",
  ]);

  if (activeTypes.has(type)) {
    return { billingStatus: "active", periodEnd };
  }
  if (type === "CANCELLATION") {
    const stillValid = periodEnd && new Date(periodEnd) > new Date();
    return { billingStatus: stillValid ? "active" : "cancelled", periodEnd };
  }
  if (type === "EXPIRATION") {
    return { billingStatus: "cancelled", periodEnd };
  }
  if (type === "BILLING_ISSUE") {
    return { billingStatus: "past_due", periodEnd };
  }

  return null;
}
