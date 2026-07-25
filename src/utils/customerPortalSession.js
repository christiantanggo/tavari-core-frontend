const getStorageKey = (businessId) => `customer-portal-session:${businessId}`;

export function loadCustomerPortalSession(businessId) {
  if (!businessId || typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(getStorageKey(businessId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Only restore sessions created after a successful OTP / explicit sign-in.
    if (!parsed?.id || parsed.verified !== true) return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

export function saveCustomerPortalSession(businessId, customerAccount) {
  if (!businessId || !customerAccount?.id || typeof window === 'undefined') return;

  const payload = {
    id: customerAccount.id,
    phone: customerAccount.phone || customerAccount.customer_phone || '',
    email: customerAccount.email || customerAccount.customer_email || '',
    customer_email: customerAccount.customer_email || customerAccount.email || '',
    customer_name: customerAccount.customer_name || '',
    // Helcim vault linkage — must persist across refresh so Pay init sends customerCode before full RPC load.
    helcim_customer_code: customerAccount.helcim_customer_code || null,
    // Gate session restore: never treat "OTP sent" / partial loads as authenticated.
    verified: true,
    verifiedAt: Date.now(),
  };

  window.sessionStorage.setItem(getStorageKey(businessId), JSON.stringify(payload));
}

export function clearCustomerPortalSession(businessId) {
  if (!businessId || typeof window === 'undefined') return;
  window.sessionStorage.removeItem(getStorageKey(businessId));
}
