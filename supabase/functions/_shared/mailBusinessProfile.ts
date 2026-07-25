const PLACEHOLDER_ADDRESS_PATTERNS = [
  /^business address required$/i,
  /^please update your business address/i,
  /^business address required for casl/i,
  /^your business address/i,
];

function isUsableAddress(value: string | null | undefined): boolean {
  const trimmed = String(value || "").trim();
  if (!trimmed) return false;
  return !PLACEHOLDER_ADDRESS_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Resolve display name: businesses.name → mail_settings.from_name → fallback */
export function resolveBusinessName(
  business?: { name?: string | null } | null,
  settings?: { from_name?: string | null } | null,
  fallback = "Tavari",
): string {
  return (
    String(business?.name || "").trim() ||
    String(settings?.from_name || "").trim() ||
    fallback
  );
}

/** Resolve CASL footer address: mail_settings → businesses.business_address → fallback */
export function resolveBusinessAddress(
  settings?: { business_address?: string | null } | null,
  business?: { business_address?: string | null } | null,
  fallback = "Business address required",
): string {
  const fromSettings = String(settings?.business_address || "").trim();
  if (isUsableAddress(fromSettings)) return fromSettings;

  const fromBusiness = String(business?.business_address || "").trim();
  if (isUsableAddress(fromBusiness)) return fromBusiness;

  return fallback;
}
