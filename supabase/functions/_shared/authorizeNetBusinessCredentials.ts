/**
 * Per-business Authorize.net credentials: AES-256-GCM encryption + DB lookup.
 * Reuses HELCIM_CREDENTIALS_ENCRYPTION_KEY (shared payment-credentials encryption secret).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  decryptSecret,
  encryptSecret,
  hintFromSecret,
} from "./helcimBusinessCredentials.ts";

export { decryptSecret, encryptSecret, hintFromSecret };

export type AuthorizeNetCredentials = {
  apiLoginId: string;
  transactionKey: string;
  signatureKey: string | null;
  sandbox: boolean;
  paymentSource: string;
};

export async function getAuthorizeNetCredentialsForBusiness(
  supabase: SupabaseClient,
  businessId: string | null | undefined,
): Promise<AuthorizeNetCredentials | null> {
  const bid = typeof businessId === "string" ? businessId.trim() : '';
  if (!bid) return null;

  const { data: row, error } = await supabase
    .from("business_authorize_net_credentials")
    .select(
      "api_login_id, transaction_key_encrypted, signature_key_encrypted, sandbox, payment_source",
    )
    .eq("business_id", bid)
    .maybeSingle();

  if (error || !row?.transaction_key_encrypted || !row?.api_login_id) {
    if (error) console.error("[authorize.net credentials] load error:", error.message);
    return null;
  }

  try {
    const transactionKey = (await decryptSecret(row.transaction_key_encrypted)).trim();
    if (!transactionKey) return null;

    let signatureKey: string | null = null;
    if (row.signature_key_encrypted) {
      signatureKey = (await decryptSecret(row.signature_key_encrypted)).trim() || null;
    }

    return {
      apiLoginId: String(row.api_login_id).trim(),
      transactionKey,
      signatureKey,
      sandbox: row.sandbox === true,
      paymentSource: String(row.payment_source || "bookeo").trim() || "bookeo",
    };
  } catch (e) {
    console.error("[authorize.net credentials] decrypt failed:", e);
    return null;
  }
}
