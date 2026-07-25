/** Signed session tokens for OTWK app / external customer API clients. */

export type CustomerSessionPayload = {
  v: 1;
  customerId: string;
  businessId: string;
  phone: string;
  exp: number;
};

export type WaiverViewerPayload = {
  v: 1;
  kind: "waiver_viewer";
  businessId: string;
  phone: string;
  exp: number;
};

export type WaiverStatusPayload = {
  v: 1;
  kind: "waiver_status";
  businessId: string;
  phone: string;
  exp: number;
};

export type WaiverStatusPendingPayload = {
  v: 1;
  kind: "waiver_status_pending";
  businessId: string;
  phone: string;
  exp: number;
};

export type WaiverEmbedPendingPayload = {
  v: 1;
  kind: "waiver_embed_pending";
  businessId: string;
  phone: string;
  email: string;
  exp: number;
};

export type WaiverEmbedSubmitPayload = {
  v: 1;
  kind: "waiver_embed_submit";
  businessId: string;
  phone: string;
  email: string;
  templateId: string;
  exp: number;
};

export type PartyGuestListSessionPayload = {
  v: 1;
  kind: "party_guest_list";
  businessId: string;
  phone: string;
  guestListId: string;
  bookingId?: string | null;
  exp: number;
};

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const WAIVER_VIEWER_TTL_MS = 24 * 60 * 60 * 1000;
const WAIVER_STATUS_TTL_MS = 24 * 60 * 60 * 1000;
const WAIVER_STATUS_PENDING_TTL_MS = 10 * 60 * 1000;
const WAIVER_EMBED_PENDING_TTL_MS = 10 * 60 * 1000;
const WAIVER_EMBED_SUBMIT_TTL_MS = 30 * 60 * 1000;
const PARTY_GUEST_LIST_TTL_MS = 24 * 60 * 60 * 1000;

function sessionSecret(): string {
  return (
    Deno.env.get("CUSTOMER_APP_SESSION_SECRET")?.trim() ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
    ""
  );
}

function toBase64Url(bytes: Uint8Array): string {
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacSign(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toBase64Url(new Uint8Array(sig));
}

export function normalizePhone(value: unknown): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export async function createCustomerSessionToken(input: {
  customerId: string;
  businessId: string;
  phone: string;
}): Promise<string> {
  const secret = sessionSecret();
  if (!secret) throw new Error("Session secret not configured");

  const payload: CustomerSessionPayload = {
    v: 1,
    customerId: input.customerId,
    businessId: input.businessId,
    phone: normalizePhone(input.phone),
    exp: Date.now() + SESSION_TTL_MS,
  };

  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(body, secret);
  return `${body}.${sig}`;
}

export async function createWaiverViewerToken(input: {
  businessId: string;
  phone: string;
}): Promise<string> {
  const secret = sessionSecret();
  if (!secret) throw new Error("Session secret not configured");

  const payload: WaiverViewerPayload = {
    v: 1,
    kind: "waiver_viewer",
    businessId: input.businessId,
    phone: normalizePhone(input.phone),
    exp: Date.now() + WAIVER_VIEWER_TTL_MS,
  };

  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(body, secret);
  return `${body}.${sig}`;
}

export async function createWaiverEmbedPendingToken(input: {
  businessId: string;
  phone: string;
  email: string;
}): Promise<string> {
  const secret = sessionSecret();
  if (!secret) throw new Error("Session secret not configured");

  const payload: WaiverEmbedPendingPayload = {
    v: 1,
    kind: "waiver_embed_pending",
    businessId: input.businessId,
    phone: normalizePhone(input.phone),
    email: String(input.email || "").trim().toLowerCase(),
    exp: Date.now() + WAIVER_EMBED_PENDING_TTL_MS,
  };

  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(body, secret);
  return `${body}.${sig}`;
}

export async function verifyWaiverEmbedPendingToken(
  token: string,
): Promise<WaiverEmbedPendingPayload | null> {
  const secret = sessionSecret();
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [body, sig] = parts;
  const expected = await hmacSign(body, secret);
  if (sig !== expected) return null;

  try {
    const json = new TextDecoder().decode(fromBase64Url(body));
    const payload = JSON.parse(json) as WaiverEmbedPendingPayload;
    if (payload.v !== 1 || payload.kind !== "waiver_embed_pending") return null;
    if (!payload.businessId || !payload.phone || !payload.email) return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function createWaiverEmbedSubmitToken(input: {
  businessId: string;
  phone: string;
  email: string;
  templateId: string;
}): Promise<string> {
  const secret = sessionSecret();
  if (!secret) throw new Error("Session secret not configured");

  const payload: WaiverEmbedSubmitPayload = {
    v: 1,
    kind: "waiver_embed_submit",
    businessId: input.businessId,
    phone: normalizePhone(input.phone),
    email: String(input.email || "").trim().toLowerCase(),
    templateId: input.templateId,
    exp: Date.now() + WAIVER_EMBED_SUBMIT_TTL_MS,
  };

  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(body, secret);
  return `${body}.${sig}`;
}

export async function verifyWaiverEmbedSubmitToken(
  token: string,
): Promise<WaiverEmbedSubmitPayload | null> {
  const secret = sessionSecret();
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [body, sig] = parts;
  const expected = await hmacSign(body, secret);
  if (sig !== expected) return null;

  try {
    const json = new TextDecoder().decode(fromBase64Url(body));
    const payload = JSON.parse(json) as WaiverEmbedSubmitPayload;
    if (payload.v !== 1 || payload.kind !== "waiver_embed_submit") return null;
    if (!payload.businessId || !payload.phone || !payload.email || !payload.templateId) return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function createWaiverStatusPendingToken(input: {
  businessId: string;
  phone: string;
}): Promise<string> {
  const secret = sessionSecret();
  if (!secret) throw new Error("Session secret not configured");

  const payload: WaiverStatusPendingPayload = {
    v: 1,
    kind: "waiver_status_pending",
    businessId: input.businessId,
    phone: normalizePhone(input.phone),
    exp: Date.now() + WAIVER_STATUS_PENDING_TTL_MS,
  };

  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(body, secret);
  return `${body}.${sig}`;
}

export async function verifyWaiverStatusPendingToken(
  token: string,
): Promise<WaiverStatusPendingPayload | null> {
  const secret = sessionSecret();
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [body, sig] = parts;
  const expected = await hmacSign(body, secret);
  if (sig !== expected) return null;

  try {
    const json = new TextDecoder().decode(fromBase64Url(body));
    const payload = JSON.parse(json) as WaiverStatusPendingPayload;
    if (payload.v !== 1 || payload.kind !== "waiver_status_pending") return null;
    if (!payload.businessId || !payload.phone) return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function createWaiverStatusToken(input: {
  businessId: string;
  phone: string;
}): Promise<string> {
  const secret = sessionSecret();
  if (!secret) throw new Error("Session secret not configured");

  const payload: WaiverStatusPayload = {
    v: 1,
    kind: "waiver_status",
    businessId: input.businessId,
    phone: normalizePhone(input.phone),
    exp: Date.now() + WAIVER_STATUS_TTL_MS,
  };

  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(body, secret);
  return `${body}.${sig}`;
}

export async function verifyWaiverStatusToken(
  token: string,
): Promise<WaiverStatusPayload | null> {
  const secret = sessionSecret();
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [body, sig] = parts;
  const expected = await hmacSign(body, secret);
  if (sig !== expected) return null;

  try {
    const json = new TextDecoder().decode(fromBase64Url(body));
    const payload = JSON.parse(json) as WaiverStatusPayload;
    if (payload.v !== 1 || payload.kind !== "waiver_status") return null;
    if (!payload.businessId || !payload.phone) return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function verifyWaiverViewerToken(
  token: string,
): Promise<WaiverViewerPayload | null> {
  const secret = sessionSecret();
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [body, sig] = parts;
  const expected = await hmacSign(body, secret);
  if (sig !== expected) return null;

  try {
    const json = new TextDecoder().decode(fromBase64Url(body));
    const payload = JSON.parse(json) as WaiverViewerPayload;
    if (payload.v !== 1 || payload.kind !== "waiver_viewer") return null;
    if (!payload.businessId || !payload.phone) return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function verifyCustomerSessionToken(
  token: string,
): Promise<CustomerSessionPayload | null> {
  const secret = sessionSecret();
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [body, sig] = parts;
  const expected = await hmacSign(body, secret);
  if (sig !== expected) return null;

  try {
    const json = new TextDecoder().decode(fromBase64Url(body));
    const payload = JSON.parse(json) as CustomerSessionPayload;
    if (payload.v !== 1) return null;
    if (!payload.customerId || !payload.businessId || !payload.phone) return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function createPartyGuestListSessionToken(input: {
  businessId: string;
  phone: string;
  guestListId: string;
  bookingId?: string | null;
}): Promise<string> {
  const secret = sessionSecret();
  if (!secret) throw new Error("Session secret not configured");

  const payload: PartyGuestListSessionPayload = {
    v: 1,
    kind: "party_guest_list",
    businessId: input.businessId,
    phone: normalizePhone(input.phone),
    guestListId: input.guestListId,
    bookingId: input.bookingId || null,
    exp: Date.now() + PARTY_GUEST_LIST_TTL_MS,
  };

  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(body, secret);
  return `${body}.${sig}`;
}

export async function verifyPartyGuestListSessionToken(
  token: string,
): Promise<PartyGuestListSessionPayload | null> {
  const secret = sessionSecret();
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [body, sig] = parts;
  const expected = await hmacSign(body, secret);
  if (sig !== expected) return null;

  try {
    const json = new TextDecoder().decode(fromBase64Url(body));
    const payload = JSON.parse(json) as PartyGuestListSessionPayload;
    if (payload.v !== 1 || payload.kind !== "party_guest_list") return null;
    if (!payload.businessId || !payload.phone || !payload.guestListId) return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const header = req.headers.get("X-Customer-Session")?.trim();
  return header || null;
}
