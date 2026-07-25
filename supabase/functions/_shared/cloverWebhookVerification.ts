import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCloverCredentialsForBusiness } from "./cloverBusinessCredentials.ts";

export type CloverWebhookVerificationResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Clover sends X-Clover-Auth on webhook payloads after URL verification.
 * Value matches the Clover Auth Code on App Settings → Webhooks.
 */
export async function verifyCloverWebhook(params: {
  req: Request;
  businessId: string;
  supabase: SupabaseClient;
}): Promise<CloverWebhookVerificationResult> {
  const creds = await getCloverCredentialsForBusiness(params.supabase, params.businessId);
  if (!creds) {
    return { ok: false, status: 404, error: "No Clover credentials" };
  }

  const expected = creds.cloverAuthCode?.trim();
  if (!expected) {
    // Auth code optional during initial setup; allow if not configured yet.
    return { ok: true };
  }

  const header =
    params.req.headers.get("X-Clover-Auth") ||
    params.req.headers.get("x-clover-auth") ||
    '';

  if (!header || header.trim() !== expected) {
    return { ok: false, status: 401, error: "Invalid Clover auth header" };
  }

  return { ok: true };
}
