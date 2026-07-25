import { normalizePhone } from "./customerAppSession.ts";

export type WaiverParticipant = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  participant_type?: string | null;
  type?: string | null;
  phone_number?: string | null;
  phone?: string | null;
  date_of_birth?: string | null;
};

export type WaiverRecord = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  phone_number?: string | null;
  signed_at?: string | null;
  expires_at?: string | null;
  is_valid?: boolean | null;
};

export type GuestEntryInput = {
  id?: string;
  guest_type: "child" | "adult";
  first_name: string;
  last_name: string;
  parent_last_name?: string | null;
  household_phone?: string | null;
  is_attending?: boolean;
  is_birthday_child?: boolean;
  sort_order?: number;
  source?: "host" | "staff" | "walk_in";
};

export type GuestEntryRow = GuestEntryInput & {
  id: string;
  role_tag: string;
  display_sort_order: number;
  waiver_signature_id?: string | null;
  waiver_status: string;
};

const normName = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const fullName = (first: unknown, last: unknown) =>
  [String(first || "").trim(), String(last || "").trim()].filter(Boolean).join(" ");

const nameSimilar = (a: string, b: string) => {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const aParts = a.split(" ");
  const bParts = b.split(" ");
  const overlap = aParts.filter((p) => p.length > 1 && bParts.includes(p));
  return overlap.length >= Math.min(aParts.length, bParts.length) - 1 && overlap.length > 0;
};

export function computeDisplaySortOrder(entry: {
  guest_type: string;
  is_birthday_child?: boolean;
  is_attending?: boolean;
  sort_order?: number;
}) {
  const typeRank = entry.guest_type === "child"
    ? (entry.is_birthday_child ? 0 : 1)
    : (entry.is_attending === false ? 4 : 3);
  return typeRank * 1000 + (Number(entry.sort_order) || 0);
}

export function deriveRoleTag(entry: {
  guest_type: string;
  is_birthday_child?: boolean;
  is_non_moving_baby?: boolean;
}) {
  if (entry.guest_type === "adult") {
    return entry.is_non_moving_baby ? "non_moving_baby" : "adult";
  }
  return entry.is_birthday_child ? "birthday_child" : "child";
}

export function roleTagLabel(roleTag: string) {
  if (roleTag === "birthday_child") return "Birthday Child";
  if (roleTag === "non_moving_baby") return "Adult or Non-moving baby";
  if (roleTag === "adult") return "Adult or Non-moving baby";
  return "Child";
}

export function isWaiverExpired(expiresAt: string | null | undefined) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

export function matchGuestToWaiver(
  entry: { first_name: string; last_name: string; guest_type: string },
  waivers: WaiverRecord[],
  participantsByWaiver: Map<string, WaiverParticipant[]>,
): {
  waiver_signature_id: string | null;
  waiver_status: string;
} {
  const targetName = normName(fullName(entry.first_name, entry.last_name));
  if (!targetName) {
    return { waiver_signature_id: null, waiver_status: "missing" };
  }

  for (const waiver of waivers) {
    const participants = participantsByWaiver.get(waiver.id) || [];
    const signerName = normName(fullName(waiver.first_name, waiver.last_name));

    const participantHit = participants.find((p) => {
      const pn = normName(fullName(p.first_name, p.last_name));
      return pn === targetName || nameSimilar(pn, targetName);
    });

    const signerHit = signerName && (signerName === targetName || nameSimilar(signerName, targetName));

    if (participantHit || signerHit) {
      const expired = waiver.is_valid === false || isWaiverExpired(waiver.expires_at);
      if (expired) {
        return { waiver_signature_id: waiver.id, waiver_status: "expired" };
      }
      const exact = participantHit
        ? normName(fullName(participantHit.first_name, participantHit.last_name)) === targetName
        : signerName === targetName;
      return {
        waiver_signature_id: waiver.id,
        waiver_status: exact ? "verified" : "name_mismatch",
      };
    }
  }

  if (waivers.length > 0) {
    return { waiver_signature_id: waivers[0].id, waiver_status: "name_mismatch" };
  }

  return { waiver_signature_id: null, waiver_status: "not_verified" };
}

export async function searchWaiversByPhone(
  supabase: { from: (table: string) => any },
  businessId: string,
  phone: string,
): Promise<WaiverRecord[]> {
  const normalized = normalizePhone(phone);
  if (normalized.length < 10) return [];

  const waivers: WaiverRecord[] = [];
  const seen = new Set<string>();

  const add = (w: WaiverRecord | null) => {
    if (!w?.id || seen.has(w.id)) return;
    seen.add(w.id);
    waivers.push(w);
  };

  const { data: byPhone } = await supabase
    .from("waiver_signatures")
    .select("id, first_name, last_name, phone_number, signed_at, expires_at, is_valid, customer_id")
    .eq("business_id", businessId)
    .ilike("phone_number", `%${normalized.slice(-10)}%`)
    .order("signed_at", { ascending: false })
    .limit(20);

  for (const w of byPhone || []) {
    if (normalizePhone(w.phone_number) === normalized) add(w as WaiverRecord);
  }

  const { data: customers } = await supabase
    .from("pos_loyalty_accounts")
    .select("id, customer_phone")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .ilike("customer_phone", `%${normalized.slice(-7)}%`)
    .limit(50);

  const customerIds = (customers || [])
    .filter((c: { customer_phone?: string }) => normalizePhone(c.customer_phone) === normalized)
    .map((c: { id: string }) => c.id);

  if (customerIds.length > 0) {
    const { data: byCustomer } = await supabase
      .from("waiver_signatures")
      .select("id, first_name, last_name, phone_number, signed_at, expires_at, is_valid, customer_id")
      .eq("business_id", businessId)
      .in("customer_id", customerIds)
      .order("signed_at", { ascending: false })
      .limit(20);
    for (const w of byCustomer || []) add(w as WaiverRecord);
  }

  return waivers;
}

export async function loadWaiverParticipants(
  supabase: { from: (table: string) => any },
  waiverIds: string[],
): Promise<Map<string, WaiverParticipant[]>> {
  const map = new Map<string, WaiverParticipant[]>();
  if (!waiverIds.length) return map;

  const { data } = await supabase
    .from("waiver_participants")
    .select("id, waiver_id, first_name, last_name, participant_type, type, phone_number, date_of_birth")
    .in("waiver_id", waiverIds);

  for (const row of data || []) {
    const wid = String(row.waiver_id);
    const list = map.get(wid) || [];
    list.push(row as WaiverParticipant);
    map.set(wid, list);
  }
  return map;
}

export function resolveGuestListIncludedLimits(
  businessSettings: {
    default_included_kids?: number | null;
    default_included_adults?: number | null;
    kids_chair_limit_per_room?: number | null;
    edit_deadline_days_before_party?: number | null;
    one_adult_per_child_enabled?: boolean | null;
  },
  activity?: {
    party_included_kids?: number | null;
    party_included_adults?: number | null;
    party_one_adult_per_child?: boolean | null;
  } | null,
) {
  const includedKids = activity?.party_included_kids != null
    ? Number(activity.party_included_kids)
    : Number(businessSettings.default_included_kids) || 12;
  const includedAdults = activity?.party_included_adults != null
    ? Number(activity.party_included_adults)
    : Number(businessSettings.default_included_adults) || 12;

  const oneAdultPerChildEnabled = activity?.party_one_adult_per_child != null
    ? activity.party_one_adult_per_child === true
    : businessSettings.one_adult_per_child_enabled === true;

  return {
    includedKids,
    includedAdults,
    kidsChairLimit: Number(businessSettings.kids_chair_limit_per_room) || 18,
    editDeadlineDays: Number(businessSettings.edit_deadline_days_before_party) || 7,
    oneAdultPerChildEnabled,
  };
}

export function computeFreeAdultSlots(
  listedKids: number,
  includedAdults: number,
  oneAdultPerChildEnabled: boolean,
) {
  if (!oneAdultPerChildEnabled) {
    return includedAdults;
  }
  return Math.max(includedAdults, listedKids);
}

type InventoryPriceRow = {
  id?: string;
  name?: string | null;
  price?: number | string | null;
  website_online_price?: number | string | null;
};

export function pickInventoryDisplayPrice(item: InventoryPriceRow | null | undefined) {
  if (!item) return null;
  const online = Number.parseFloat(String(item.website_online_price ?? ""));
  const regular = Number.parseFloat(String(item.price ?? ""));
  if (Number.isFinite(online) && online >= 0) return Math.round(online * 100) / 100;
  if (Number.isFinite(regular) && regular >= 0) return Math.round(regular * 100) / 100;
  return null;
}

function normalizeInventoryItemName(name: unknown) {
  return String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function isRegularChildAdmissionItem(item: InventoryPriceRow) {
  const name = normalizeInventoryItemName(item?.name);
  if (!name || /name(s)? of the day/.test(name)) return false;
  if (name === "ages 2-17") return true;
  if (/ages?\s*2\s*[-–]\s*17/.test(name)) return true;
  if (/gen(eration)?\s*admission.*2\s*[-–]\s*17/.test(name)) return true;
  if (/regular admission.*2\s*[-–]\s*17/.test(name)) return true;
  return false;
}

function isAdditionalAdultTicketItem(item: InventoryPriceRow) {
  const name = normalizeInventoryItemName(item?.name);
  if (!name) return false;
  if (/additional\s*adults?/.test(name)) return true;
  if (/extra\s*adult/.test(name)) return true;
  return false;
}

export function resolvePartyGuestOveragePricing(
  inventoryItems: InventoryPriceRow[] = [],
  settings: Record<string, unknown> = {},
) {
  const items = (inventoryItems || []).filter(Boolean);
  const childId = settings.extra_child_inventory_item_id || settings.extraChildInventoryItemId;
  const adultId = settings.extra_adult_inventory_item_id || settings.extraAdultInventoryItemId;

  let childItem = childId
    ? items.find((item) => item.id === childId) || null
    : null;
  let adultItem = adultId
    ? items.find((item) => item.id === adultId) || null
    : null;

  if (!childItem) childItem = items.find(isRegularChildAdmissionItem) || null;
  if (!adultItem) adultItem = items.find(isAdditionalAdultTicketItem) || null;

  const childPrice = pickInventoryDisplayPrice(childItem);
  const adultPrice = pickInventoryDisplayPrice(adultItem);

  return {
    childInventoryItemId: childItem?.id || null,
    adultInventoryItemId: adultItem?.id || null,
    childPrice,
    adultPrice,
    childLabel: childItem?.name || "Child admission (ages 2–17)",
    adultLabel: adultItem?.name || "Additional adult",
    hasPricing: childPrice != null || adultPrice != null,
  };
}

export async function loadPartyGuestOveragePricing(
  supabase: {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string | boolean) => {
          or?: (filter: string) => {
            eq: (col: string, val: boolean) => Promise<{ data?: InventoryPriceRow[] | null; error?: unknown }>;
          };
          then?: never;
        } & Promise<{ data?: InventoryPriceRow[] | null; error?: unknown }>;
      };
    };
  },
  businessId: string,
  settings: Record<string, unknown> = {},
) {
  const childId = settings.extra_child_inventory_item_id;
  const adultId = settings.extra_adult_inventory_item_id;
  const ids = [childId, adultId].filter(Boolean);

  const orFilter = ids.length > 0
    ? [
      "name.ilike.%2-17%",
      "name.ilike.%additional%adult%",
      ...ids.map((id) => `id.eq.${id}`),
    ].join(",")
    : "name.ilike.%2-17%,name.ilike.%additional%adult%";

  const { data } = await supabase
    .from("pos_inventory")
    .select("id, name, price, website_online_price")
    .eq("business_id", businessId)
    .or(orFilter)
    .eq("is_active", true);

  return resolvePartyGuestOveragePricing(data || [], settings);
}

export function buildGuestListSettingsSnapshot(
  businessSettings: Record<string, unknown>,
  activity?: {
    party_included_kids?: number | null;
    party_included_adults?: number | null;
    party_one_adult_per_child?: boolean | null;
  } | null,
) {
  const limits = resolveGuestListIncludedLimits(
    {
      default_included_kids: Number(businessSettings.default_included_kids),
      default_included_adults: Number(businessSettings.default_included_adults),
      kids_chair_limit_per_room: Number(businessSettings.kids_chair_limit_per_room),
      edit_deadline_days_before_party: Number(businessSettings.edit_deadline_days_before_party),
      one_adult_per_child_enabled: businessSettings.one_adult_per_child_enabled === true,
    },
    activity,
  );

  return {
    includedKids: limits.includedKids,
    includedAdults: limits.includedAdults,
    kidsChairLimit: limits.kidsChairLimit,
    editDeadlineDays: limits.editDeadlineDays,
    oneAdultPerChildEnabled: limits.oneAdultPerChildEnabled,
  };
}

function isNamedGuestEntry(entry: { first_name?: unknown; last_name?: unknown }) {
  return Boolean(String(entry.first_name || "").trim() && String(entry.last_name || "").trim());
}

export function computeGuestListWarnings(
  entries: Array<{ guest_type: string; is_attending?: boolean; first_name?: unknown; last_name?: unknown }>,
  settings: {
    includedKids?: number;
    includedAdults?: number;
    kidsChairLimit?: number;
    oneAdultPerChildEnabled?: boolean;
  },
) {
  const namedEntries = (entries || []).filter(isNamedGuestEntry);
  const warnings: string[] = [];

  if (namedEntries.length === 0) {
    return {
      listedKids: 0,
      listedAdults: 0,
      attendingKids: 0,
      attendingAdults: 0,
      freeAdultSlots: 0,
      warnings,
    };
  }

  const listedKids = namedEntries.filter((e) => e.guest_type === "child").length;
  const listedAdults = namedEntries.filter((e) => e.guest_type === "adult").length;
  const attendingKids = namedEntries.filter((e) => e.guest_type === "child" && e.is_attending !== false).length;
  const attendingAdults = namedEntries.filter((e) => e.guest_type === "adult" && e.is_attending !== false).length;

  const includedKids = Number(settings.includedKids) || 12;
  const includedAdults = Number(settings.includedAdults) || 12;
  const chairLimit = Number(settings.kidsChairLimit) || 18;
  const oneAdultPerChildEnabled = settings.oneAdultPerChildEnabled === true;
  const freeAdultSlots = computeFreeAdultSlots(listedKids, includedAdults, oneAdultPerChildEnabled);

  if (listedKids > includedKids) {
    warnings.push(
      `You have ${listedKids} children on your list (${attendingKids} attending); your package includes ${includedKids}.`,
    );
  }

  if (listedAdults > freeAdultSlots) {
    if (oneAdultPerChildEnabled) {
      warnings.push(
        `You have ${listedAdults} adults on your list (${attendingAdults} attending). Up to ${freeAdultSlots} adults are included (the higher of ${includedAdults} in your package or 1 per child on your list).`,
      );
    } else {
      warnings.push(
        `You have ${listedAdults} adults on your list (${attendingAdults} attending); your package includes ${includedAdults}.`,
      );
    }
  }

  if (attendingKids > chairLimit) {
    warnings.push(
      `Your party room has ${chairLimit} chairs. You have ${listedKids} children on your list (${attendingKids} attending).`,
    );
  }

  return { listedKids, listedAdults, attendingKids, attendingAdults, freeAdultSlots, warnings };
}

type ResourceCatalogCategory = {
  categoryId?: string;
  category_id?: string;
  name?: string;
  categoryName?: string;
  resources?: Array<{ id: string; name: string }>;
};

export function buildResourceLabelFromAssignments(
  assignments: Array<{ category_id?: string; resource_id?: string }> = [],
  resourcesCatalog: ResourceCatalogCategory[] = [],
) {
  if (!assignments.length) return "Not assigned";
  const names = assignments.map((assignment) => {
    const category = resourcesCatalog.find((cat) =>
      (cat.categoryId || cat.category_id) === assignment.category_id
    );
    const resource = category?.resources?.find((res) => res.id === assignment.resource_id);
    return resource?.name || null;
  }).filter(Boolean) as string[];
  return names.length ? [...new Set(names)].join(" + ") : "Not assigned";
}

export function normalizeGuestPhone(value: unknown) {
  return normalizePhone(value);
}

export const DEFAULT_PARTY_GUEST_OVERAGE_PAYMENT = "guest_at_gate";
export const DEFAULT_PARTY_GUEST_OVERAGE_FOOD = "guests_buy_own";
export const DEFAULT_PARTY_GUEST_OVERAGE_SOCKS = "guests_buy_own";

export function resolvePartyGuestOveragePayment(value: unknown) {
  const normalized = String(value || "").trim();
  if (normalized === "host_bill" || normalized === "guest_at_gate") return normalized;
  return DEFAULT_PARTY_GUEST_OVERAGE_PAYMENT;
}

export function resolvePartyGuestOverageFood(value: unknown) {
  const normalized = String(value || "").trim();
  if (
    normalized === "guests_buy_own"
    || normalized === "host_tab_food"
    || normalized === "host_tab_drinks"
    || normalized === "host_tab_food_drinks"
    || normalized === "other"
  ) {
    return normalized;
  }
  if (normalized === "host_tab") return "host_tab_food_drinks";
  return DEFAULT_PARTY_GUEST_OVERAGE_FOOD;
}

export function resolvePartyGuestOverageSocks(value: unknown) {
  const normalized = String(value || "").trim();
  if (normalized === "host_bill" || normalized === "guests_buy_own") return normalized;
  if (normalized === "host_covers") return "host_bill";
  if (normalized === "guest_buys") return "guests_buy_own";
  return DEFAULT_PARTY_GUEST_OVERAGE_SOCKS;
}

export function isValidPartyGuestOverageFood(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized === "guests_buy_own"
    || normalized === "host_tab_food"
    || normalized === "host_tab_drinks"
    || normalized === "host_tab_food_drinks"
    || normalized === "other"
    || normalized === "host_tab";
}

export function isValidPartyGuestOverageSocks(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized === "host_bill"
    || normalized === "guests_buy_own"
    || normalized === "host_covers"
    || normalized === "guest_buys";
}
