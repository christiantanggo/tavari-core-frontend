import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthorizeNetCredentialsForBusiness } from "./authorizeNetBusinessCredentials.ts";

const textEncoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array {
  const normalized = String(hex || "").trim();
  if (!normalized || normalized.length % 2 !== 0) {
    throw new Error("Invalid hex signature key");
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    out[i / 2] = parseInt(normalized.slice(i, i + 2), 16);
  }
  return out;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}

function parseAnetSignatureHeader(header: string | null): string | null {
  const raw = String(header || "").trim();
  if (!raw) return null;
  if (raw.includes("=")) {
    const [, value] = raw.split("=", 2);
    return value?.trim().toLowerCase() || null;
  }
  return raw.toLowerCase();
}

async function hmacSha512Hex(keyBytes: Uint8Array, bodyText: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    textEncoder.encode(bodyText),
  );
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Authorize.net docs/SDKs disagree on whether the signature key is hex-decoded or used as UTF-8. */
async function computeAnetSignatures(bodyText: string, signatureKey: string): Promise<string[]> {
  const trimmed = String(signatureKey || "").trim();
  if (!trimmed) return [];

  const out: string[] = [];
  const seen = new Set<string>();

  const push = async (keyBytes: Uint8Array) => {
    const sig = await hmacSha512Hex(keyBytes, bodyText);
    if (!seen.has(sig)) {
      seen.add(sig);
      out.push(sig);
    }
  };

  // Hex-decoded key (matches Authorize.net TransHash samples for the same portal key).
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length >= 2 && trimmed.length % 2 === 0) {
    try {
      await push(hexToBytes(trimmed));
    } catch {
      // ignore invalid hex
    }
  }

  // UTF-8 string key (matches common C#/PHP webhook samples).
  await push(textEncoder.encode(trimmed));

  return out;
}

export async function verifyAuthorizeNetWebhook({
  req,
  bodyText,
  businessId,
  supabase,
}: {
  req: Request;
  bodyText: string;
  businessId: string;
  supabase: SupabaseClient;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const creds = await getAuthorizeNetCredentialsForBusiness(supabase, businessId);
  if (!creds?.signatureKey) {
    return {
      ok: false,
      status: 401,
      error: "Authorize.net signature key not configured for this business",
    };
  }

  const received = parseAnetSignatureHeader(req.headers.get("X-ANET-Signature"));
  if (!received) {
    return { ok: false, status: 401, error: "Missing X-ANET-Signature header" };
  }

  try {
    const computed = await computeAnetSignatures(bodyText, creds.signatureKey);
    const valid = computed.some((candidate) => timingSafeEqualHex(candidate, received));
    if (!valid) {
      console.error(
        "[authorize.net webhook] signature mismatch",
        `(tried ${computed.length} key encoding(s), received prefix ${received.slice(0, 12)}…)`,
      );
      return { ok: false, status: 401, error: "Invalid Authorize.net webhook signature" };
    }
    return { ok: true };
  } catch (e) {
    console.error("[authorize.net webhook] signature verify failed:", e);
    return { ok: false, status: 401, error: "Could not verify webhook signature" };
  }
}
