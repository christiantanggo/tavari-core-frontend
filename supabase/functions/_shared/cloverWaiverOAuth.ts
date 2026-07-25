import type { CloverOAuthTokenResponse } from "./cloverOAuth.ts";

export type CloverWaiverOAuthEnv = {
  appId: string;
  appSecret: string;
  sandbox: boolean;
};

export function cloverWaiverOAuthEnv(sandbox: boolean): CloverWaiverOAuthEnv | null {
  const appId = sandbox
    ? (
      Deno.env.get("CLOVER_WAIVER_SANDBOX_APP_ID") ||
      Deno.env.get("CLOVER_WAIVER_APP_ID") ||
      ""
    ).trim()
    : (Deno.env.get("CLOVER_WAIVER_APP_ID") || "").trim();
  const appSecret = sandbox
    ? (
      Deno.env.get("CLOVER_WAIVER_SANDBOX_APP_SECRET") ||
      Deno.env.get("CLOVER_WAIVER_APP_SECRET") ||
      ""
    ).trim()
    : (Deno.env.get("CLOVER_WAIVER_APP_SECRET") || "").trim();

  if (!appId || !appSecret) return null;
  return { appId, appSecret, sandbox };
}

export function cloverWaiverOAuthRedirectUri(sandbox = false): string {
  if (sandbox) {
    const sandboxExplicit = (
      Deno.env.get("CLOVER_WAIVER_SANDBOX_OAUTH_REDIRECT_URL") ||
      Deno.env.get("CLOVER_WAIVER_OAUTH_REDIRECT_URL") ||
      ""
    ).trim();
    if (sandboxExplicit) return sandboxExplicit.replace(/\/$/, "");
    return "http://localhost:5173/clover-waivers/oauth/callback";
  }

  const explicit = (Deno.env.get("CLOVER_WAIVER_OAUTH_REDIRECT_URL") || "").trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const base = (
    Deno.env.get("CLOVER_WAIVER_SITE_URL") ||
    "https://clover-waivers.tavarios.ca"
  ).replace(/\/$/, "");
  return `${base}/oauth/callback`;
}

function oauthHost(sandbox: boolean): string {
  return sandbox ? "https://sandbox.dev.clover.com" : "https://www.clover.com";
}

function apiHost(sandbox: boolean): string {
  return sandbox ? "https://apisandbox.dev.clover.com" : "https://api.clover.com";
}

export function buildCloverWaiverAuthorizeUrl(params: {
  merchantId: string;
  sandbox: boolean;
}): string | null {
  const env = cloverWaiverOAuthEnv(params.sandbox);
  if (!env) return null;

  const redirectUri = encodeURIComponent(cloverWaiverOAuthRedirectUri(params.sandbox));
  const clientId = encodeURIComponent(env.appId);
  const merchantId = encodeURIComponent(params.merchantId);

  return (
    `${oauthHost(params.sandbox)}/oauth/v2/authorize` +
    `?client_id=${clientId}` +
    `&redirect_uri=${redirectUri}` +
    `&merchant_id=${merchantId}` +
    `&response_type=code`
  );
}

export async function exchangeCloverWaiverOAuthCode(params: {
  code: string;
  sandbox: boolean;
}): Promise<{ tokens: CloverOAuthTokenResponse | null; errorDetail?: string }> {
  const env = cloverWaiverOAuthEnv(params.sandbox);
  if (!env) {
    return {
      tokens: null,
      errorDetail: params.sandbox
        ? "Sandbox Clover waiver app credentials are not configured."
        : "Production Clover waiver app credentials are not configured.",
    };
  }

  const response = await fetch(`${apiHost(params.sandbox)}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: env.appId,
      client_secret: env.appSecret,
      code: params.code,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error(
      "[clover waiver oauth] token exchange failed:",
      response.status,
      detail,
    );
    return { tokens: null, errorDetail: detail || `HTTP ${response.status}` };
  }

  return { tokens: (await response.json()) as CloverOAuthTokenResponse };
}

export async function refreshCloverWaiverOAuthToken(params: {
  refreshToken: string;
  sandbox: boolean;
}): Promise<CloverOAuthTokenResponse | null> {
  const env = cloverWaiverOAuthEnv(params.sandbox);
  if (!env) return null;

  const response = await fetch(`${apiHost(params.sandbox)}/oauth/v2/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: env.appId,
      client_secret: env.appSecret,
      refresh_token: params.refreshToken,
    }),
  });

  if (!response.ok) {
    console.error(
      "[clover waiver oauth] refresh failed:",
      response.status,
      await response.text(),
    );
    return null;
  }

  return (await response.json()) as CloverOAuthTokenResponse;
}

export { expiresAtFromUnix } from "./cloverOAuth.ts";
