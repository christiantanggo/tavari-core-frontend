function getDefaultLegacyKioskBaseUrl() {
  if (typeof window === 'undefined') return '';
  const host = window.location.hostname;
  if (host === 'clover-waivers.tavarios.ca' || host.endsWith('.clover-waivers.tavarios.ca')) {
    return 'https://legacy-waiver.tavarios.ca';
  }
  return '';
}

function getDefaultLegacyDownloadsBaseUrl() {
  if (typeof window === 'undefined') return '';
  const host = window.location.hostname;
  if (host === 'clover-waivers.tavarios.ca' || host.endsWith('.clover-waivers.tavarios.ca')) {
    return 'https://tavarios.ca';
  }
  return '';
}

function getWaiverBrowserKioskOverrideUrl() {
  return (
    import.meta.env.VITE_WAIVER_SUBDOMAIN_URL ||
    import.meta.env.VITE_WAIVER_BROWSER_KIOSK_URL ||
    import.meta.env.VITE_WAIVER_LEGACY_URL ||
    getDefaultLegacyKioskBaseUrl() ||
    ''
  )
    .trim()
    .replace(/\/$/, '');
}

/**
 * Build URL for in-dashboard waiver kiosk route and open in a new tab (tablet / second screen).
 * @returns {boolean} true if a window was opened
 */
export function openWaiverKioskInNewTab() {
  const path = '/dashboard/waivers/kiosk';
  const hashMode =
    window.location.protocol === 'file:' ||
    window.navigator.userAgent.includes('Electron') ||
    typeof window.electronAPI !== 'undefined' ||
    typeof window.__TAVARI_KIOSK_MODE__ !== 'undefined';
  const baseUrl = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = hashMode
    ? `${window.location.origin}${window.location.pathname}${window.location.search}#${normalizedPath}`
    : `${window.location.origin}${baseUrl}${normalizedPath}`;
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  return !!w;
}

/**
 * Open the static legacy waiver entry page (ES5 + XHR) for very old browsers/tablets.
 * @param {string} businessId UUID
 * @returns {boolean} true if a window was opened
 */
export function openLegacyWaiverKioskInNewTab(businessId) {
  if (!businessId || typeof businessId !== 'string') return false;
  const overrideUrl = getWaiverBrowserKioskOverrideUrl();
  if (overrideUrl) {
    const separator = overrideUrl.includes('?') ? '&' : '?';
    const url = `${overrideUrl}${separator}business=${encodeURIComponent(businessId)}`;
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    return !!w;
  }
  const baseUrl = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const qs = `?business=${encodeURIComponent(businessId)}`;
  const url = `${window.location.origin}${baseUrl}/waiver-browser-kiosk/${qs}`;
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  return !!w;
}

/**
 * Open the static legacy downloads page (large links, no React) for old tablets.
 * @returns {boolean} true if a window was opened
 */
export function openLegacyKioskDownloadsInNewTab() {
  const downloadsBase = getDefaultLegacyDownloadsBaseUrl();
  if (downloadsBase) {
    const url = `${downloadsBase.replace(/\/$/, '')}/legacy-kiosk-downloads/`;
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    return !!w;
  }
  const overrideUrl = getWaiverBrowserKioskOverrideUrl();
  if (overrideUrl) {
    const url = `${overrideUrl.replace(/\/$/, '')}/legacy-kiosk-downloads/`;
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    return !!w;
  }
  const baseUrl = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const url = `${window.location.origin}${baseUrl}/legacy-kiosk-downloads/`;
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  return !!w;
}
