export type CloverMerchantProfile = {
  merchantId: string;
  name: string;
  email: string | null;
  timezone: string | null;
  phone: string | null;
  website: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

function asString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function apiBaseUrl(sandbox: boolean): string {
  return sandbox ? "https://apisandbox.dev.clover.com" : "https://api.clover.com";
}

function parseAddress(raw: unknown): Pick<
  CloverMerchantProfile,
  "phone" | "addressLine1" | "city" | "state" | "postalCode"
> {
  if (!raw || typeof raw !== "object") {
    return {
      phone: null,
      addressLine1: null,
      city: null,
      state: null,
      postalCode: null,
    };
  }

  const address = raw as Record<string, unknown>;
  return {
    phone: asString(address.phoneNumber) || asString(address.phone),
    addressLine1: asString(address.address1) || asString(address.line1) || asString(address.address),
    city: asString(address.city),
    state: asString(address.state) || asString(address.province),
    postalCode: asString(address.zip) || asString(address.postalCode),
  };
}

export function businessPatchFromCloverProfile(
  profile: CloverMerchantProfile,
): Record<string, string | null> {
  return {
    name: profile.name,
    timezone: profile.timezone || "America/Toronto",
    business_email: profile.email,
    business_phone: profile.phone,
    business_website: profile.website,
    business_address: profile.addressLine1,
    business_city: profile.city,
    business_state: profile.state,
    business_postal: profile.postalCode,
  };
}

export async function fetchCloverMerchantProfile(params: {
  merchantId: string;
  accessToken: string;
  sandbox: boolean;
}): Promise<CloverMerchantProfile | null> {
  const url =
    `${apiBaseUrl(params.sandbox)}/v3/merchants/${encodeURIComponent(params.merchantId)}?expand=address,owner`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${params.accessToken}`,
    },
  });

  if (!response.ok) {
    console.error(
      "[clover waiver merchant] profile fetch failed:",
      response.status,
      await response.text(),
    );
    return null;
  }

  const json = (await response.json()) as Record<string, unknown>;
  const owner = json.owner as Record<string, unknown> | undefined;
  const ownerEmail = asString(owner?.email);
  const address = parseAddress(json.address);

  return {
    merchantId: params.merchantId,
    name: asString(json.name) || `Clover Merchant ${params.merchantId.slice(0, 8)}`,
    email: ownerEmail || asString(json.customerContactEmail) || asString(json.email),
    timezone: asString(json.timezone) || "America/Toronto",
    website: asString(json.website),
    phone: address.phone || asString(json.phoneNumber),
    addressLine1: address.addressLine1,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
  };
}
