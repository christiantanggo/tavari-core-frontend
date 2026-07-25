/** Shared waiver lookup + validity → public website status mapping. */

import { normalizePhone } from "./customerAppSession.ts";

export type WaiverStatusRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_number: string | null;
  signed_at: string | null;
  expires_at: string | null;
  is_valid: boolean | null;
  customer_id: string | null;
  template_id?: string | null;
  waiver_templates?: { expiry_days?: number | null } | { expiry_days?: number | null }[] | null;
};

export type PublicWaiverStatus = {
  valid: boolean;
  found: boolean;
  expiresAt: string | null;
  lastSignedAt: string | null;
  expiringSoon: boolean;
  needsResign: boolean;
  message: string;
};

const DISPLAY_FALLBACK_EXPIRY_DAYS = 365;
const EXPIRING_SOON_DAYS = 30;

const WAIVER_STATUS_SELECT =
  "id, first_name, last_name, email, phone_number, signed_at, expires_at, is_valid, customer_id, template_id, waiver_templates:template_id(expiry_days)";

function parsePositiveExpiryDays(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function coerceNumericSettingValue(raw: unknown): unknown {
  if (raw == null) return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = parseInt(String(raw).trim(), 10);
    return Number.isFinite(n) ? n : raw;
  }
  if (typeof raw === "object" && raw !== null) {
    const o = raw as Record<string, unknown>;
    if ("value" in o) return coerceNumericSettingValue(o.value);
    if ("days" in o) return coerceNumericSettingValue(o.days);
  }
  return raw;
}

export function computeEffectiveExpiresAtIso(
  waiver: WaiverStatusRow,
  businessDefaultExpiryDays: number | null,
): string | null {
  if (waiver.expires_at) {
    const expiryDate = new Date(waiver.expires_at);
    if (!Number.isNaN(expiryDate.getTime())) return expiryDate.toISOString();
  }

  if (!waiver.signed_at) return null;

  const signedDate = new Date(waiver.signed_at);
  if (Number.isNaN(signedDate.getTime())) return null;

  const templateRaw = waiver.waiver_templates;
  const template = Array.isArray(templateRaw) ? templateRaw[0] : templateRaw;
  const fromSettings = parsePositiveExpiryDays(businessDefaultExpiryDays);
  const fromTemplate = parsePositiveExpiryDays(template?.expiry_days);
  const expiryDays = fromSettings || fromTemplate || DISPLAY_FALLBACK_EXPIRY_DAYS;

  return new Date(signedDate.getTime() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
}

export function isWaiverCurrentlyValid(
  waiver: WaiverStatusRow,
  businessDefaultExpiryDays: number | null,
  now = new Date(),
): boolean {
  if (waiver.is_valid === false) return false;
  const effectiveExpiresAt = computeEffectiveExpiresAtIso(waiver, businessDefaultExpiryDays);
  if (!effectiveExpiresAt) return true;
  return new Date(effectiveExpiresAt).getTime() > now.getTime();
}

export function buildPublicWaiverStatus(
  waiver: WaiverStatusRow | null | undefined,
  businessDefaultExpiryDays: number | null,
): PublicWaiverStatus {
  if (!waiver?.signed_at && !waiver?.id) {
    return {
      valid: false,
      found: false,
      expiresAt: null,
      lastSignedAt: null,
      expiringSoon: false,
      needsResign: true,
      message: "No waiver found on file — sign a digital waiver before you arrive.",
    };
  }

  const lastSignedAt = waiver.signed_at ? new Date(waiver.signed_at).toISOString() : null;
  const expiresAt = computeEffectiveExpiresAtIso(waiver, businessDefaultExpiryDays);
  const valid = isWaiverCurrentlyValid(waiver, businessDefaultExpiryDays);
  const now = Date.now();
  const expiringSoon = Boolean(
    valid &&
      expiresAt &&
      new Date(expiresAt).getTime() - now <= EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000,
  );

  let message = "Your digital waiver is valid — no need to sign again before this visit.";
  if (!valid) {
    message = expiresAt
      ? "Your waiver has expired — please sign a new digital waiver before you arrive."
      : "We could not confirm a valid waiver — please sign a digital waiver before you arrive.";
  } else if (expiringSoon && expiresAt) {
    message = "Your waiver is valid but expiring soon — you may need to sign again on a future visit.";
  }

  return {
    valid,
    found: true,
    expiresAt,
    lastSignedAt,
    expiringSoon,
    needsResign: !valid,
    message,
  };
}

export async function loadBusinessDefaultExpiryDays(
  supabase: { from: (table: string) => unknown },
  businessId: string,
): Promise<number | null> {
  const { data, error } = await (supabase as ReturnType<typeof import("@supabase/supabase-js").createClient>)
    .from("waiver_settings")
    .select("setting_value")
    .eq("business_id", businessId)
    .eq("setting_key", "default_expiry_days")
    .eq("is_global", true)
    .is("template_id", null)
    .maybeSingle();

  if (error || !data) return null;
  return parsePositiveExpiryDays(coerceNumericSettingValue((data as { setting_value?: unknown }).setting_value));
}

async function addWaiverRow(
  waivers: WaiverStatusRow[],
  seen: Set<string>,
  row: WaiverStatusRow | null | undefined,
) {
  const id = String(row?.id || "");
  if (!id || seen.has(id) || !row) return;
  seen.add(id);
  waivers.push(row);
}

export async function searchWaiversByPhone(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  phone: string,
): Promise<WaiverStatusRow[]> {
  const normalized = normalizePhone(phone);
  const waivers: WaiverStatusRow[] = [];
  const seen = new Set<string>();

  const { data: byPhone } = await supabase
    .from("waiver_signatures")
    .select(WAIVER_STATUS_SELECT)
    .eq("business_id", businessId)
    .ilike("phone_number", `%${normalized.slice(-10)}%`)
    .order("signed_at", { ascending: false, nullsFirst: false })
    .limit(30);

  for (const row of byPhone || []) {
    if (normalizePhone(row.phone_number) === normalized) {
      await addWaiverRow(waivers, seen, row as WaiverStatusRow);
    }
  }

  const suffix = normalized.slice(-7);
  const { data: customers } = await supabase
    .from("pos_loyalty_accounts")
    .select("id, customer_phone")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .ilike("customer_phone", `%${suffix}%`)
    .limit(50);

  const customerIds = (customers || [])
    .filter((customer) => normalizePhone(customer.customer_phone) === normalized)
    .map((customer) => customer.id);

  if (customerIds.length > 0) {
    const { data: byCustomer } = await supabase
      .from("waiver_signatures")
      .select(WAIVER_STATUS_SELECT)
      .eq("business_id", businessId)
      .in("customer_id", customerIds)
      .order("signed_at", { ascending: false, nullsFirst: false })
      .limit(30);

    for (const row of byCustomer || []) {
      await addWaiverRow(waivers, seen, row as WaiverStatusRow);
    }
  }

  if (normalized.length >= 10) {
    const { data: participantMatches } = await supabase.rpc(
      "waivers_find_ids_by_additional_adult_phone",
      { p_business_id: businessId, p_normalized_phone: normalized },
    );

    const extraIds = [
      ...new Set(
        (participantMatches || [])
          .map((match: { waiver_id?: string }) => match?.waiver_id)
          .filter((id: string | undefined) => id && !seen.has(id)),
      ),
    ];

    if (extraIds.length > 0) {
      const { data: moreWaivers } = await supabase
        .from("waiver_signatures")
        .select(WAIVER_STATUS_SELECT)
        .eq("business_id", businessId)
        .in("id", extraIds);

      for (const row of moreWaivers || []) {
        await addWaiverRow(waivers, seen, row as WaiverStatusRow);
      }
    }
  }

  return waivers.sort((a, b) => {
    const aMs = a.signed_at ? new Date(a.signed_at).getTime() : 0;
    const bMs = b.signed_at ? new Date(b.signed_at).getTime() : 0;
    return bMs - aMs;
  });
}

export async function searchWaiversByEmail(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  email: string,
): Promise<WaiverStatusRow[]> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) return [];

  const waivers: WaiverStatusRow[] = [];
  const seen = new Set<string>();

  const { data: byEmail } = await supabase
    .from("waiver_signatures")
    .select(WAIVER_STATUS_SELECT)
    .eq("business_id", businessId)
    .ilike("email", normalizedEmail)
    .order("signed_at", { ascending: false, nullsFirst: false })
    .limit(20);

  for (const row of byEmail || []) {
    await addWaiverRow(waivers, seen, row as WaiverStatusRow);
  }

  const { data: customers } = await supabase
    .from("pos_loyalty_accounts")
    .select("id")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .ilike("customer_email", normalizedEmail)
    .limit(20);

  const customerIds = (customers || []).map((customer) => customer.id).filter(Boolean);
  if (customerIds.length > 0) {
    const { data: byCustomer } = await supabase
      .from("waiver_signatures")
      .select(WAIVER_STATUS_SELECT)
      .eq("business_id", businessId)
      .in("customer_id", customerIds)
      .order("signed_at", { ascending: false, nullsFirst: false })
      .limit(20);

    for (const row of byCustomer || []) {
      await addWaiverRow(waivers, seen, row as WaiverStatusRow);
    }
  }

  return waivers.sort((a, b) => {
    const aMs = a.signed_at ? new Date(a.signed_at).getTime() : 0;
    const bMs = b.signed_at ? new Date(b.signed_at).getTime() : 0;
    return bMs - aMs;
  });
}

export async function resolvePublicWaiverStatusForPhone(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  phone: string,
): Promise<PublicWaiverStatus> {
  const businessDefaultExpiryDays = await loadBusinessDefaultExpiryDays(supabase, businessId);
  const waivers = await searchWaiversByPhone(supabase, businessId, phone);
  const latest = waivers[0] ?? null;
  return buildPublicWaiverStatus(latest, businessDefaultExpiryDays);
}

export async function resolvePublicWaiverStatusForEmail(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  email: string,
): Promise<{ status: PublicWaiverStatus; phone: string | null }> {
  const businessDefaultExpiryDays = await loadBusinessDefaultExpiryDays(supabase, businessId);
  const waivers = await searchWaiversByEmail(supabase, businessId, email);
  const latest = waivers[0] ?? null;
  const phone = latest?.phone_number ? normalizePhone(latest.phone_number) : null;
  return {
    status: buildPublicWaiverStatus(latest, businessDefaultExpiryDays),
    phone: phone && phone.length >= 10 ? phone : null,
  };
}

export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 1) return "***@***";
  return `${trimmed[0]}***@${trimmed.slice(at + 1)}`;
}

export function formatStatusDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export { normalizePhone };
