const PENDING_LOCK_KEY = 'pos_lock_on_register_return';

/** Whether the register should require PIN when staff return after a completed sale. */
export function shouldLockRegisterAfterSale(saleOrCheckoutData = {}) {
  return !!(saleOrCheckoutData.lock_after_sale || saleOrCheckoutData.pin_required);
}

/** Navigation state when returning to the POS register after a sale. */
export function buildRegisterNavigationState(saleOrCheckoutData = {}, extra = {}) {
  return {
    ...extra,
    shouldLock: shouldLockRegisterAfterSale(saleOrCheckoutData),
  };
}

/** Remember that the register must lock even if navigation state is lost (e.g. browser back). */
export function persistRegisterLockAfterSale(saleOrCheckoutData = {}) {
  if (!shouldLockRegisterAfterSale(saleOrCheckoutData)) return;
  try {
    sessionStorage.setItem(PENDING_LOCK_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function consumePendingRegisterLock() {
  try {
    const pending = sessionStorage.getItem(PENDING_LOCK_KEY) === '1';
    sessionStorage.removeItem(PENDING_LOCK_KEY);
    return pending;
  } catch {
    return false;
  }
}

/** Clear the active cashier so the next unlock must enter a staff PIN. */
export function clearPosActiveUserOnRegisterLock() {
  try {
    localStorage.removeItem('posActiveUser');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('pos-active-user-changed'));
    }
  } catch {
    /* ignore */
  }
}
