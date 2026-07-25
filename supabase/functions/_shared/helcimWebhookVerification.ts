import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  decryptSecret,
  resolveBusinessIdFromHelcimWebhookPayload,
} from "./helcimBusinessCredentials.ts";

const textEncoder = new TextEncoder();

function decodeBase64(input: string) {
  const normalized = String(input || "").trim();
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a[index]! ^ b[index]!;
  }

  return mismatch === 0;
}

function parseSignatureHeader(signatureHeader: string | null) {
  const values = String(signatureHeader || "")
    .trim()
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return values
    .map((entry) => {
      const [version, signature] = entry.split(",", 2);
      return {
        version: version?.trim() || "",
        signature: signature?.trim() || "",
      };
    })
    .filter((entry) => entry.version && entry.signature);
}

async function verifyHelcimWebhookSignatureWithVerifierToken(
  req: Request,
  bodyText: string,
  verifierTokenBase64: string,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const verifierToken = String(verifierTokenBase64 || "").trim();
  if (!verifierToken) {
    return {
      ok: false,
      status: 500,
      error: "Missing Helcim webhook verifier token",
    };
  }

  const webhookId = req.headers.get("webhook-id");
  const webhookTimestamp = req.headers.get("webhook-timestamp");
  const signatureHeader = req.headers.get("webhook-signature");

  if (!webhookId || !webhookTimestamp || !signatureHeader) {
    return {
      ok: false,
      status: 401,
      error: "Missing Helcim webhook signature headers",
    };
  }

  const signatures = parseSignatureHeader(signatureHeader);
  if (signatures.length === 0) {
    return {
      ok: false,
      status: 401,
      error: "Malformed Helcim webhook signature header",
    };
  }

  const signedContent = `${webhookId}.${webhookTimestamp}.${bodyText}`;
  let keyBytes: Uint8Array;
  try {
    keyBytes = decodeBase64(verifierToken);
  } catch {
    return {
      ok: false,
      status: 401,
      error: "Invalid Helcim webhook verifier encoding",
    };
  }

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    textEncoder.encode(signedContent),
  );
  const expectedSignature = new Uint8Array(signatureBuffer);

  const matches = signatures.some((entry) => {
    if (entry.version !== "v1") {
      return false;
    }

    try {
      return timingSafeEqual(expectedSignature, decodeBase64(entry.signature));
    } catch (_error) {
      return false;
    }
  });

  if (!matches) {
    return {
      ok: false,
      status: 401,
      error: "Invalid Helcim webhook signature",
    };
  }

  return { ok: true as const };
}

export async function verifyHelcimWebhook({
  req,
  bodyText,
}: {
  req: Request;
  bodyText: string;
}) {
  const verifierToken = Deno.env.get("HELCIM_WEBHOOK_VERIFIER_TOKEN");
  if (!verifierToken) {
    return {
      ok: false,
      status: 500,
      error: "Missing HELCIM_WEBHOOK_VERIFIER_TOKEN secret",
    };
  }

  return verifyHelcimWebhookSignatureWithVerifierToken(req, bodyText, verifierToken);
}

/** Verify using an explicit base64 verifier key (same format as HELCIM_WEBHOOK_VERIFIER_TOKEN). */
export async function verifyHelcimWebhookWithVerifierToken({
  req,
  bodyText,
  verifierTokenBase64,
}: {
  req: Request;
  bodyText: string;
  verifierTokenBase64: string;
}) {
  return verifyHelcimWebhookSignatureWithVerifierToken(req, bodyText, verifierTokenBase64);
}

/**
 * Prefer per-business webhook signing secret when the payload maps to a business_id;
 * otherwise fall back to HELCIM_WEBHOOK_VERIFIER_TOKEN (legacy / platform default).
 */
export async function verifyHelcimWebhookMultiTenant({
  req,
  bodyText,
  body,
  supabase,
}: {
  req: Request;
  bodyText: string;
  body: Record<string, unknown>;
  supabase: SupabaseClient;
}) {
  const businessId = await resolveBusinessIdFromHelcimWebhookPayload(supabase, body);

  if (businessId) {
    const { data: row } = await supabase
      .from("business_helcim_credentials")
      .select("webhook_verifier_encrypted, api_token_encrypted")
      .eq("business_id", businessId)
      .maybeSingle();

    if (!row?.api_token_encrypted) {
      return {
        ok: false,
        status: 401,
        error:
          "Webhook rejected: configure Helcim API credentials for this business (POS Settings → Payments).",
      };
    }

    if (row.webhook_verifier_encrypted) {
      try {
        const verifierPlain = (await decryptSecret(row.webhook_verifier_encrypted)).trim();
        return await verifyHelcimWebhookSignatureWithVerifierToken(req, bodyText, verifierPlain);
      } catch (e) {
        console.error("[Helcim webhook] verifier decrypt failed:", e);
        return {
          ok: false,
          status: 500,
          error: "Stored webhook verifier could not be decrypted",
        };
      }
    }

    return {
      ok: false,
      status: 401,
      error:
        "Webhook rejected: add the Helcim webhook signing secret for this business (POS Settings → Payments).",
    };
  }

  return verifyHelcimWebhook({ req, bodyText });
}
