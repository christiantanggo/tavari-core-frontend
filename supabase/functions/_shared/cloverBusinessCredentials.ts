/**
 * Per-business Clover credentials: AES-256-GCM encryption + DB lookup.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  decryptSecret,
  encryptSecret,
  hintFromSecret,
} from "./helcimBusinessCredentials.ts";
import {
  expiresAtFromUnix,
  isAccessTokenExpiringSoon,
  refreshCloverOAuthToken,
} from "./cloverOAuth.ts";

export { decryptSecret, encryptSecret, hintFromSecret };

export type CloverCredentials = {
  merchantId: string;
  apiToken: string;
  cloverAuthCode: string | null;
  sandbox: boolean;
  paymentSource: string;
  authMethod: "api_token" | "oauth";
};

type CredentialRow = {
  merchant_id: string;
  api_token_encrypted: string | null;
  oauth_access_token_encrypted: string | null;
  oauth_refresh_token_encrypted: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  clover_auth_code_encrypted: string | null;
  sandbox: boolean;
  payment_source: string;
};

async function resolveOAuthAccessToken(
  supabase: SupabaseClient,
  businessId: string,
  row: CredentialRow,
): Promise<string | null> {
  if (!row.oauth_access_token_encrypted) return null;

  let accessToken = (await decryptSecret(row.oauth_access_token_encrypted)).trim();
  if (!accessToken) return null;

  if (!isAccessTokenExpiringSoon(row.access_token_expires_at)) {
    return accessToken;
  }

  if (!row.oauth_refresh_token_encrypted) return accessToken;

  const refreshToken = (await decryptSecret(row.oauth_refresh_token_encrypted)).trim();
  if (!refreshToken) return accessToken;

  const refreshed = await refreshCloverOAuthToken({
    refreshToken,
    sandbox: row.sandbox === true,
  });
  if (!refreshed?.access_token) return accessToken;

  accessToken = refreshed.access_token;
  const accessEnc = await encryptSecret(accessToken);
  const refreshEnc = refreshed.refresh_token
    ? await encryptSecret(refreshed.refresh_token)
    : row.oauth_refresh_token_encrypted;

  await supabase
    .from("business_clover_credentials")
    .update({
      oauth_access_token_encrypted: accessEnc,
      oauth_refresh_token_encrypted: refreshEnc,
      access_token_expires_at: expiresAtFromUnix(refreshed.access_token_expiration),
      refresh_token_expires_at: expiresAtFromUnix(refreshed.refresh_token_expiration),
      api_token_hint: hintFromSecret(accessToken),
    })
    .eq("business_id", businessId);

  return accessToken;
}

export async function getCloverCredentialsForBusiness(
  supabase: SupabaseClient,
  businessId: string | null | undefined,
): Promise<CloverCredentials | null> {
  const bid = typeof businessId === "string" ? businessId.trim() : '';
  if (!bid) return null;

  const { data: row, error } = await supabase
    .from("business_clover_credentials")
    .select(
      "merchant_id, api_token_encrypted, oauth_access_token_encrypted, oauth_refresh_token_encrypted, access_token_expires_at, refresh_token_expires_at, clover_auth_code_encrypted, sandbox, payment_source",
    )
    .eq("business_id", bid)
    .maybeSingle();

  if (error || !row?.merchant_id) {
    if (error) console.error("[clover credentials] load error:", error.message);
    return null;
  }

  const credRow = row as CredentialRow;

  try {
    let cloverAuthCode: string | null = null;
    if (credRow.clover_auth_code_encrypted) {
      cloverAuthCode = (await decryptSecret(credRow.clover_auth_code_encrypted)).trim() || null;
    }

    if (credRow.oauth_access_token_encrypted) {
      const oauthToken = await resolveOAuthAccessToken(supabase, bid, credRow);
      if (oauthToken) {
        return {
          merchantId: String(credRow.merchant_id).trim(),
          apiToken: oauthToken,
          cloverAuthCode,
          sandbox: credRow.sandbox === true,
          paymentSource: String(credRow.payment_source || "clover_pos").trim() || "clover_pos",
          authMethod: "oauth",
        };
      }
    }

    if (!credRow.api_token_encrypted) return null;

    const apiToken = (await decryptSecret(credRow.api_token_encrypted)).trim();
    if (!apiToken) return null;

    return {
      merchantId: String(credRow.merchant_id).trim(),
      apiToken,
      cloverAuthCode,
      sandbox: credRow.sandbox === true,
      paymentSource: String(credRow.payment_source || "clover_pos").trim() || "clover_pos",
      authMethod: "api_token",
    };
  } catch (e) {
    console.error("[clover credentials] decrypt failed:", e);
    return null;
  }
}

export function isCloverConfigured(row: Record<string, unknown> | null): boolean {
  if (!row) return false;
  return !!(row.api_token_hint || row.oauth_access_token_encrypted);
}
