/**
 * Shared localStorage + timers for POS → customer display (same tab + mirror push).
 */
import { flushCustomerDisplayMirrorPush } from './customerDisplayMirrorSync';

export const LS_CUSTOMER_DISPLAY_PAYMENT = 'tavari_customer_display_payment';
export const LS_CUSTOMER_DISPLAY_POS_LOCKED = 'tavari_customer_display_pos_locked';

export const CUSTOMER_DISPLAY_PAYMENT_MAX_MS = 5000;

let paymentExpiryTimer = null;

export function getCustomerDisplayBusinessId() {
  try {
    return (
      localStorage.getItem('currentBusinessId') ||
      localStorage.getItem('selectedBusinessId') ||
      ''
    ).trim();
  } catch {
    return '';
  }
}

export function cancelCustomerDisplayPaymentExpiry() {
  if (paymentExpiryTimer) {
    clearTimeout(paymentExpiryTimer);
    paymentExpiryTimer = null;
  }
}

/** Remove payment blob and push mirror (cancels any pending auto-clear). */
export function clearCustomerDisplayPaymentLocalAndMirror(businessId) {
  cancelCustomerDisplayPaymentExpiry();
  try {
    localStorage.removeItem(LS_CUSTOMER_DISPLAY_PAYMENT);
  } catch {
    /* ignore */
  }
  const bid = (businessId || getCustomerDisplayBusinessId()).trim();
  if (bid) flushCustomerDisplayMirrorPush(bid);
}

/**
 * Clear cart / payment / completion keys and push mirror immediately.
 * Use when leaving POS routes so the paired display does not keep stale sale UI.
 */
export function resetCustomerDisplayMirrorToAds(businessId) {
  cancelCustomerDisplayPaymentExpiry();
  try {
    localStorage.removeItem('tavari_customer_display_cart');
    localStorage.removeItem(LS_CUSTOMER_DISPLAY_PAYMENT);
    localStorage.removeItem('tavari_customer_display_sale_complete');
    localStorage.removeItem('tavari_customer_display_receipt_navigation');
  } catch {
    /* ignore */
  }
  const bid = (businessId || getCustomerDisplayBusinessId()).trim();
  if (bid) flushCustomerDisplayMirrorPush(bid);
}

/** Start / restart the 5s auto-clear from “now” (sale completed or payment success). */
export function scheduleCustomerDisplayPaymentAutoClear(businessId) {
  cancelCustomerDisplayPaymentExpiry();
  const bid = (businessId || getCustomerDisplayBusinessId()).trim();
  if (!bid) return;
  paymentExpiryTimer = setTimeout(() => {
    paymentExpiryTimer = null;
    try {
      localStorage.removeItem(LS_CUSTOMER_DISPLAY_PAYMENT);
    } catch {
      /* ignore */
    }
    flushCustomerDisplayMirrorPush(bid);
  }, CUSTOMER_DISPLAY_PAYMENT_MAX_MS);
}

export function setCustomerDisplayPosLocked(locked) {
  try {
    if (locked) {
      localStorage.setItem(LS_CUSTOMER_DISPLAY_POS_LOCKED, '1');
    } else {
      localStorage.removeItem(LS_CUSTOMER_DISPLAY_POS_LOCKED);
    }
  } catch {
    /* ignore */
  }
}

export function isCustomerDisplayPosLocked() {
  try {
    return localStorage.getItem(LS_CUSTOMER_DISPLAY_POS_LOCKED) === '1';
  } catch {
    return false;
  }
}
