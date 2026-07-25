const encoder = new TextEncoder();
const decoder = new TextDecoder();

function normalizeSecret(secret: string | undefined | null) {
  const value = String(secret || "").trim();
  if (!value) {
    throw new Error("Mail token secret is not configured");
  }
  return value;
}

function toBase64Url(bytes: Uint8Array) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function importSigningKey(secret: string) {
  return await crypto.subtle.importKey(
    "raw",
    encoder.encode(normalizeSecret(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signPayload(payloadText: string, secret: string) {
  const key = await importSigningKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadText));
  return new Uint8Array(signature);
}

export type SignedMailTokenPayload = Record<string, unknown> & {
  v?: number;
  iat?: number;
  exp?: number;
};

export async function createSignedMailToken(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSeconds: number,
) {
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload: SignedMailTokenPayload = {
    ...payload,
    v: 2,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const payloadText = JSON.stringify(tokenPayload);
  const signature = await signPayload(payloadText, secret);
  return `${toBase64Url(encoder.encode(payloadText))}.${toBase64Url(signature)}`;
}

export function decodeSignedMailTokenPayload(token: string) {
  const [encodedPayload] = String(token || "").split(".");
  if (!encodedPayload) {
    throw new Error("Missing token payload");
  }

  const payloadText = decoder.decode(fromBase64Url(encodedPayload));
  return JSON.parse(payloadText) as SignedMailTokenPayload;
}

export async function verifySignedMailToken(token: string, secret: string) {
  const [encodedPayload, encodedSignature] = String(token || "").split(".");
  if (!encodedPayload || !encodedSignature) {
    throw new Error("Malformed token");
  }

  const payloadBytes = fromBase64Url(encodedPayload);
  const payloadText = decoder.decode(payloadBytes);
  const payload = JSON.parse(payloadText) as SignedMailTokenPayload;

  const key = await importSigningKey(secret);
  const signatureBytes = fromBase64Url(encodedSignature);
  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    encoder.encode(payloadText),
  );

  if (!isValid) {
    throw new Error("Invalid token signature");
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) {
    throw new Error("Token expired");
  }

  return payload;
}

export function getMailTokenSigningSecret() {
  return normalizeSecret(
    Deno.env.get("MAIL_LINK_SIGNING_SECRET") ||
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  );
}
