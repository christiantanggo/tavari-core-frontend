/** Supplier URLs that need a logged-in browser (Playwright) instead of HTTP scrape. */

export function isSyscoShopUrl(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'shop.sysco.ca' || host === 'shop.sysco.com';
  } catch {
    return /shop\.sysco\.(ca|com)/i.test(String(url));
  }
}

export function requiresBrowserScrape(url) {
  return isSyscoShopUrl(url);
}

export const RECIPE_SYSCO_BRIDGE_URL =
  import.meta.env.VITE_RECIPE_SYSCO_BRIDGE_URL || 'http://127.0.0.1:3927';
