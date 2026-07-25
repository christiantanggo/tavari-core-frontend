const DEFAULT_PUBLIC_SITE_URL = "https://www.tavarios.ca";

/** Hosts that must never be used for customer-facing links (not deployed). */
function isInvalidPublicSiteHost(hostname: string): boolean {
  const host = String(hostname || "").trim().toLowerCase();
  return host === "app.tavari.ca" || host === "tavari.ca";
}

export function normalizePublicSiteUrl(value: string | undefined | null): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    if (isInvalidPublicSiteHost(url.hostname)) {
      return DEFAULT_PUBLIC_SITE_URL;
    }
    return `${url.protocol}//${url.host}`.replace(/\/$/, "");
  } catch {
    if (/^https?:\/\/(?:app\.)?tavari\.ca\/?$/i.test(trimmed)) {
      return DEFAULT_PUBLIC_SITE_URL;
    }
    return trimmed.replace(/\/$/, "");
  }
}

export function resolvePublicSiteUrl(fallback?: string | null) {
  return (
    normalizePublicSiteUrl(fallback) ||
    normalizePublicSiteUrl(Deno.env.get("PUBLIC_SITE_URL")) ||
    normalizePublicSiteUrl(Deno.env.get("SITE_URL")) ||
    normalizePublicSiteUrl(Deno.env.get("VITE_PUBLIC_SITE_URL")) ||
    normalizePublicSiteUrl(Deno.env.get("VITE_APP_URL")) ||
    DEFAULT_PUBLIC_SITE_URL
  );
}
