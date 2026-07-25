export type CloverOAuthTokenResponse = {
  access_token: string;
  access_token_expiration: number;
  refresh_token: string;
  refresh_token_expiration: number;
};

export type CloverOAuthEnv = {
  appId: string;
  appSecret: string;
  sandbox: boolean;
};

export function cloverOAuthEnv(sandbox: boolean): CloverOAuthEnv | null {
  const appId = sandbox
    ? (Deno.env.get("CLOVER_SANDBOX_APP_ID") || Deno.env.get("CLOVER_APP_ID") || "").trim()
    : (Deno.env.get("CLOVER_APP_ID") || "").trim();
  const appSecret = sandbox
    ? (Deno.env.get("CLOVER_SANDBOX_APP_SECRET") || Deno.env.get("CLOVER_APP_SECRET") || "").trim()
    : (Deno.env.get("CLOVER_APP_SECRET") || "").trim();

  if (!appId || !appSecret) return null;
  return { appId, appSecret, sandbox };
}

export function cloverOAuthRedirectUri(): string {
  const base = (
    Deno.env.get("CLOVER_OAUTH_REDIRECT_URL") ||
    Deno.env.get("PUBLIC_SITE_URL") ||
    "https://tavarios.ca"
  ).replace(/\/$/, "");
  return `${base}/dashboard/pos/settings`;
}

function oauthHost(sandbox: boolean): string {
  return sandbox ? "https://sandbox.dev.clover.com" : "https://www.clover.com";
}

function apiHost(sandbox: boolean): string {
  return sandbox ? "https://apisandbox.dev.clover.com" : "https://api.clover.com";
}

export function buildCloverAuthorizeUrl(params: {
  merchantId: string;
  sandbox: boolean;
}): string | null {
  const env = cloverOAuthEnv(params.sandbox);
  if (!env) return null;

  const redirectUri = encodeURIComponent(cloverOAuthRedirectUri());
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

export async function exchangeCloverOAuthCode(params: {
  code: string;
  sandbox: boolean;
}): Promise<CloverOAuthTokenResponse | null> {
  const env = cloverOAuthEnv(params.sandbox);
  if (!env) return null;

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
    console.error("[clover oauth] token exchange failed:", response.status, await response.text());
    return null;
  }

  return (await response.json()) as CloverOAuthTokenResponse;
}

export async function refreshCloverOAuthToken(params: {
  refreshToken: string;
  sandbox: boolean;
}): Promise<CloverOAuthTokenResponse | null> {
  const env = cloverOAuthEnv(params.sandbox);
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
    console.error("[clover oauth] refresh failed:", response.status, await response.text());
    return null;
  }

  return (await response.json()) as CloverOAuthTokenResponse;
}

export function expiresAtFromUnix(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

export function isAccessTokenExpiringSoon(expiresAt: string | null | undefined, bufferMs = 5 * 60 * 1000): boolean {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return true;
  return t - Date.now() <= bufferMs;
}
