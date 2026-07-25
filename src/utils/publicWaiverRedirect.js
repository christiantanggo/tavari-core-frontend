/**
 * Where to send customers after a public (non-kiosk) waiver completes.
 * Kiosk flows should not use these helpers — they reset to the welcome screen instead.
 */

export function getSafeInAppReturnPath(rawReturnUrl) {
  if (!rawReturnUrl) return null;

  try {
    const decoded = decodeURIComponent(rawReturnUrl).trim();
    if (!decoded || !decoded.startsWith('/')) return null;
    if (decoded.startsWith('//')) return null;

    const parsed = new URL(decoded, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

/** https/http URL for leaving Tavari after signing (business site, thank-you page, etc.). */
export function normalizeExternalRedirectUrl(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function isPublicWaiverKioskMode(searchParams) {
  if (typeof window === 'undefined') return false;
  const signingStation =
    (searchParams && typeof searchParams.get === 'function'
      ? searchParams.get('signingStation')
      : null) ||
    new URLSearchParams(window.location.search || '').get('signingStation');

  if (signingStation === 'browser_kiosk') return true;
  if (window.electronAPI || window.__TAVARI_KIOSK_MODE__ || window.__TAVARI_ELECTRON__) {
    return true;
  }
  try {
    if (sessionStorage.getItem('tavari_native_waiver_kiosk') === '1') return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * @returns {{ kind: 'in_app' | 'external', href: string } | null}
 */
export function resolvePublicWaiverCompletionRedirect({ returnUrl, businessWebsite, isKioskMode }) {
  if (isKioskMode) return null;

  const inApp = getSafeInAppReturnPath(returnUrl);
  if (inApp) return { kind: 'in_app', href: inApp };

  const externalFromParam = normalizeExternalRedirectUrl(returnUrl);
  if (externalFromParam) return { kind: 'external', href: externalFromParam };

  const businessSite = normalizeExternalRedirectUrl(businessWebsite);
  if (businessSite) return { kind: 'external', href: businessSite };

  return null;
}

export function completionRedirectMessage(redirect) {
  if (!redirect) return null;
  if (redirect.kind === 'in_app') return 'Redirecting you back in';
  try {
    const host = new URL(redirect.href).hostname.replace(/^www\./i, '');
    return host ? `Returning to ${host} in` : 'Returning to our website in';
  } catch {
    return 'Returning to our website in';
  }
}
