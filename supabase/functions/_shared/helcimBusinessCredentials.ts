/**
 * Per-business Helcim credentials: AES-256-GCM encryption + DB lookup only.
 * Env HELCIM_CREDENTIALS_ENCRYPTION_KEY: base64-encoded 32 bytes, or any string (SHA-256 stretched to 32 bytes).
 * Each business stores its own Helcim API token — there is no platform-wide payment token fallback.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

function decodeBase64Loose(input: string): Uint8Array {
  const normalized = String(input || "").trim();
  const binary = atob(normalized);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

let cachedAesKey: CryptoKey | null = null;

async function importAesKey(): Promise<CryptoKey> {
  if (cachedAesKey) return cachedAesKey;
  const rawEnv = Deno.env.get("HELCIM_CREDENTIALS_ENCRYPTION_KEY")?.trim();
  if (!rawEnv) {
    throw new Error("HELCIM_CREDENTIALS_ENCRYPTION_KEY is not set (required to store per-business Helcim secrets)");
  }

  let keyBytes: Uint8Array;
  try {
    keyBytes = decodeBase64Loose(rawEnv);
    if (keyBytes.length !== 32) {
      const digest = await crypto.subtle.digest("SHA-256", keyBytes);
      keyBytes = new Uint8Array(digest);
    }
  } catch {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawEnv));
    keyBytes = new Uint8Array(digest);
  }

  cachedAesKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return cachedAesKey;
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await importAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const combined = new Uint8Array(iv.length + ct.length);
  combined.set(iv);
  combined.set(ct, iv.length);
  return bytesToBase64(combined);
}

export async function decryptSecret(b64Cipher: string): Promise<string> {
  const combined = decodeBase64Loose(b64Cipher.trim());
  if (combined.length < 13) throw new Error("Invalid ciphertext");
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);
  const key = await importAesKey();
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

export function hintFromSecret(value: string): string {
  const s = String(value || "").trim();
  if (s.length <= 6) return "******";
  return `******${s.slice(-6)}`;
}

export type HelcimCredentials = {
  apiToken: string;
  accountId: string | null;
};

/**
 * Resolve Helcim API token + optional account id for a business (database only).
 */
export async function getHelcimCredentialsForBusiness(
  supabase: SupabaseClient,
  businessId: string | null | undefined,
): Promise<HelcimCredentials | null> {
  const bid = typeof businessId === "string" ? businessId.trim() : "";
  if (!bid) {
    console.warn("[helcim credentials] missing businessId");
    return null;
  }

  const { data: row, error } = await supabase
    .from("business_helcim_credentials")
    .select("api_token_encrypted, helcim_account_id")
    .eq("business_id", bid)
    .maybeSingle();

  if (error) {
    console.error("[helcim credentials] load error:", error.message);
    return null;
  }

  if (!row?.api_token_encrypted) {
    return null;
  }

  try {
    const apiToken = (await decryptSecret(row.api_token_encrypted)).trim();
    if (!apiToken) return null;
    const accountId =
      typeof row.helcim_account_id === "string" && row.helcim_account_id.trim()
        ? row.helcim_account_id.trim()
        : null;
    return { apiToken, accountId };
  } catch (e) {
    console.error("[helcim credentials] decrypt failed:", e);
    return null;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Best-effort resolve business_id from Helcim webhook JSON before signature verification.
 */
export async function resolveBusinessIdFromHelcimWebhookPayload(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
): Promise<string | null> {
  const dataObj = typeof body?.data === "object" && body.data !== null
    ? (body.data as Record<string, unknown>)
    : null;
  const saleReference =
    (typeof body?.saleReference === "string" ? body.saleReference : null) ??
    (typeof body?.sale_reference === "string" ? body.sale_reference : null) ??
    (typeof dataObj?.saleReference === "string" ? dataObj.saleReference : null);
  if (typeof saleReference === "string" && saleReference.includes("-")) {
    const firstHyphen = saleReference.indexOf("-");
    const bid = saleReference.slice(0, firstHyphen);
    const rest = saleReference.slice(firstHyphen + 1);
    if (bid && rest && UUID_RE.test(bid)) return bid;
  }

  const invoiceRaw =
    body?.invoiceNumber ??
    (body?.invoice as Record<string, unknown> | undefined)?.number ??
    body?.reference ??
    (body?.data as Record<string, unknown> | undefined)?.invoiceNumber;
  const invoiceNumber = typeof invoiceRaw === "string" ? invoiceRaw.trim() : "";

  if (invoiceNumber.startsWith("BP-")) {
    const pendingId = invoiceNumber.slice(3);
    if (UUID_RE.test(pendingId)) {
      const { data } = await supabase
        .from("booking_pending_helcim")
        .select("business_id")
        .eq("id", pendingId)
        .maybeSingle();
      if (data?.business_id) return String(data.business_id);
    }
  }

  if (invoiceNumber.startsWith("IP-")) {
    const pendingId = invoiceNumber.slice(3);
    if (UUID_RE.test(pendingId)) {
      const { data } = await supabase
        .from("invoice_pending_helcim")
        .select("business_id")
        .eq("id", pendingId)
        .maybeSingle();
      if (data?.business_id) return String(data.business_id);
    }
  }

  if (invoiceNumber.startsWith("SALE-")) {
    const saleId = invoiceNumber.replace(/^SALE-/i, "");
    if (UUID_RE.test(saleId)) {
      const { data } = await supabase
        .from("pos_sales")
        .select("business_id")
        .eq("id", saleId)
        .maybeSingle();
      if (data?.business_id) return String(data.business_id);
    }
  }

  if (invoiceNumber && UUID_RE.test(invoiceNumber)) {
    const { data } = await supabase
      .from("pos_sales")
      .select("business_id")
      .eq("id", invoiceNumber)
      .maybeSingle();
    if (data?.business_id) return String(data.business_id);

    const { data: byInvoice } = await supabase
      .from("pos_sales")
      .select("business_id")
      .eq("invoice_number", invoiceNumber)
      .maybeSingle();
    if (byInvoice?.business_id) return String(byInvoice.business_id);
  }

  const transactionId =
    body?.transactionId ??
    (body?.transaction as Record<string, unknown> | undefined)?.transactionId ??
    body?.id ??
    (body?.data as Record<string, unknown> | undefined)?.transactionId;
  if (transactionId != null && String(transactionId).trim()) {
    const tid = String(transactionId).trim();
    const { data: saleTx } = await supabase
      .from("pos_sales")
      .select("business_id")
      .eq("helcim_transaction_id", tid)
      .maybeSingle();
    if (saleTx?.business_id) return String(saleTx.business_id);
  }

  return null;
}
