/**
 * Helcim's start.js always adds `origin=<window.origin>` to the iframe URL. Helcim/Cloudflare
 * responds with 403 for origin=http://localhost... — the error page sets X-Frame-Options and the
 * iframe fails. Mirror Helcim's iframe URL (see secure.helcim.app/helcim-pay/services/start.js)
 * but omit origin/referrer on local dev hosts.
 *
 * Load https://secure.helcim.app/helcim-pay/services/start.js first so `watchForExit` exists.
 */

const TOKEN_LENGTH = 22;

function isValidUrlValue(value) {
  if (!value || typeof value !== 'string') return false;
  const invalidValues = ['null', 'undefined', 'false', ''];
  return !invalidValues.includes(value.toLowerCase().trim());
}

/** Hosts where Helcim returns 403 if `origin` is passed (localhost, loopback, RFC1918, *.localhost). */
function shouldSkipHelcimOriginTracking(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (h === 'localhost' || h === '[::1]' || h.endsWith('.localhost')) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const m = h.match(ipv4);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/**
 * @param {string} token - checkoutToken from helcim-pay/initialize (22 chars)
 * @param {boolean} [showExitButton=true]
 * @param {string} [phone='']
 * @param {string} [email='']
 * @param {string} [csrf='']
 * @returns {HTMLIFrameElement | undefined}
 */
export function appendHelcimPayIframeCompat(token, showExitButton = true, phone = '', email = '', csrf = '') {
  const tokenStr = token == null ? '' : String(token).trim();
  if (!tokenStr || tokenStr.length !== TOKEN_LENGTH) {
    console.error('[HelcimPay] Invalid checkout token (expected 22 characters).');
    return undefined;
  }

  if (typeof window.watchForExit !== 'function') {
    console.error('[HelcimPay] Load helcim-pay/services/start.js before opening checkout.');
    return undefined;
  }

  const hostname = window.location.hostname;
  const dev =
    hostname.endsWith('.helcim.test') || hostname.endsWith('.myhelcim.test');
  const domain = !dev ? 'secure.helcim.app' : 'secure-app.helcim.test';

  const skipOriginTracking = shouldSkipHelcimOriginTracking(hostname);

  const referrer = document.referrer;
  const origin = window.origin;

  const queryParts = [];
  if (showExitButton) queryParts.push('allowExit');
  if (phone) queryParts.push(`phone=${phone}`);
  if (email) queryParts.push(`email=${email}`);
  if (!skipOriginTracking && isValidUrlValue(referrer)) {
    queryParts.push(`referrer=${encodeURIComponent(referrer)}`);
  }
  if (!skipOriginTracking && isValidUrlValue(origin)) {
    queryParts.push(`origin=${encodeURIComponent(origin)}`);
  }

  const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
  const url = `https://${domain}/helcim-pay/${tokenStr}${queryString}`;

  const iframeElem = document.createElement('iframe');
  iframeElem.name = csrf;
  iframeElem.id = 'helcimPayIframe';
  iframeElem.src = url;
  iframeElem.width = '100%';
  iframeElem.height = '100%';
  iframeElem.frameBorder = '0';
  iframeElem.style.cssText =
    'position: fixed; inset: 0; top: 0; left: 0; width: 100%; height: 100%; border: none; z-index: 998;';
  iframeElem.allow = 'payment';

  window.addEventListener('message', window.watchForExit, false);

  return document.body.appendChild(iframeElem);
}

/** HelcimPay.js posts `helcim-pay-js-{checkoutToken}`; some builds also emit `helcim-pay-js-v2`. */
export function isHelcimPayJsMessage(event, checkoutToken) {
  const name = event?.data?.eventName;
  const token = checkoutToken == null ? '' : String(checkoutToken).trim();
  if (!name || !token) return false;
  return name === `helcim-pay-js-${token}` || name === 'helcim-pay-js-v2';
}

/**
 * Full URL to open Helcim Pay in a new tab or encode in a QR code (customer pays on their phone).
 * Uses the same host/dev logic as {@link appendHelcimPayIframeCompat}; optional query mirrors iframe UX.
 *
 * @param {string} token - checkoutToken from helcim-pay-init (22 chars)
 * @param {{ allowExit?: boolean }} [opts]
 * @returns {string | null}
 */
export function getHelcimPayCheckoutPageUrl(token, opts = {}) {
  const tokenStr = token == null ? '' : String(token).trim();
  if (!tokenStr || tokenStr.length !== TOKEN_LENGTH) {
    console.error('[HelcimPay] Invalid checkout token for checkout URL.');
    return null;
  }

  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const dev =
    hostname.endsWith('.helcim.test') || hostname.endsWith('.myhelcim.test');
  const domain = !dev ? 'secure.helcim.app' : 'secure-app.helcim.test';

  const skipOriginTracking = shouldSkipHelcimOriginTracking(hostname);

  const queryParts = [];
  if (opts.allowExit !== false) queryParts.push('allowExit');
  if (!skipOriginTracking && typeof window !== 'undefined') {
    const referrer = document.referrer;
    const origin = window.origin;
    if (isValidUrlValue(referrer)) queryParts.push(`referrer=${encodeURIComponent(referrer)}`);
    if (isValidUrlValue(origin)) queryParts.push(`origin=${encodeURIComponent(origin)}`);
  }

  const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
  return `https://${domain}/helcim-pay/${tokenStr}${queryString}`;
}
