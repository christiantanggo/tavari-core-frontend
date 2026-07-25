/** Pricing + availability {{token}} substitution for public website copy and FAQs. */

import {
  ACTIVITY_PARTY_PACKAGE_SELECT_COLS,
  DEFAULT_UNLIMITED_PLAY_POLICY,
  INVENTORY_PARTY_PACKAGE_SELECT_COLS,
  mapActivityToPublicPartyPackage,
  mapInventoryOnlyToPublicPartyPackage,
  primaryInventoryIdFromTicketSettings,
  type ActivityRow,
  type InventoryPartyRow,
  type PublicPartyPackage,
} from "./tavariPublicPartyPackages.ts";
import {
  INVENTORY_WEBSITE_SELECT_COLS,
  mapInventoryToPublicProduct,
  type InventoryRow,
} from "./tavariPublicProducts.ts";
import { loadLiveCapacitySnapshot } from "./tavariPublicLiveCapacity.ts";
import {
  BOOKING_AVAILABILITY_SCHEDULE_COLS,
  addDaysToDateString,
  buildDateAvailability,
  buildWebsiteSummaries,
  enumerateDateStrings,
  findNextOpenSlot,
  formatDateInTimeZone,
  parseOccupancyMap,
  pickSchedulesForActivityOnDate,
  resolveHostPortalUrl,
  type ActivityAvailabilityRow,
  type PublicActivityAvailability,
  type ScheduleRow,
} from "./tavariPublicBookingAvailability.ts";

export type WebsiteCopyTokens = Record<string, string>;

export type PublicWebsiteCopyTokensPayload = {
  ok: true;
  businessId: string;
  businessName: string;
  timezone: string;
  asOf: string;
  tokens: WebsiteCopyTokens;
};

export const WEBSITE_COPY_TOKEN_KEYS = [
  "grip_socks_price",
  "party_12_price",
  "party_24_price",
  "party_36_price",
  "party_private_price",
  "party_entry_capacity",
  "party_entry_adults",
  "party_entry_food_credit",
  "party_capacity_summary",
  "party_packages_summary",
  "party_starting_price",
  "walk_in_message",
  "party_weekend_urgency",
  "camp_spots_message",
] as const;

/** OTWK grip socks inventory id (Expose to website API). */
export const DEFAULT_GRIP_SOCKS_PRODUCT_ID = "082e07ec-1401-43c8-8217-b9afde287c07";

const LEGACY_PARTY_PRICE_KEYS = [
  "party_12_price",
  "party_24_price",
  "party_36_price",
  "party_private_price",
] as const;

const FALLBACK_TOKENS: WebsiteCopyTokens = {
  grip_socks_price: "$3.54",
  party_12_price: "$299.99",
  party_24_price: "$574.99",
  party_36_price: "$849.99",
  party_private_price: "$1,034.99",
  party_entry_capacity: "10",
  party_entry_adults: "10",
  party_entry_food_credit: "$50",
  party_capacity_summary: "up to 10, 20, or 30 kids",
  party_packages_summary:
    "party packages for up to 10 kids ($299.99), up to 20 kids ($574.99), up to 30 kids ($849.99), and private facility rental for up to 150 people ($1,034.99)",
  party_starting_price: "$299.99",
  walk_in_message: "Walk-ins welcome subject to capacity.",
  party_weekend_urgency:
    "Weekend party slots often book about four weeks out — reserve early for Saturdays and peak times.",
  camp_spots_message: "Camp spots fill quickly — register online when dates are posted.",
};

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatPartyCapacitySummary(packages: PublicPartyPackage[]): string {
  const kids = packages
    .map((pkg) => pkg.includedKids)
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  if (kids.length === 0) return FALLBACK_TOKENS.party_capacity_summary;
  return `up to ${kids.join(", ")} kids`;
}

function applyPartyPackageTokens(tokens: WebsiteCopyTokens, packages: PublicPartyPackage[]): void {
  packages.forEach((party, index) => {
    const legacyKey = LEGACY_PARTY_PRICE_KEYS[index];
    if (legacyKey && party.startingPriceFormatted) {
      tokens[legacyKey] = party.startingPriceFormatted;
    }
  });

  const entry = packages.find((party) => party.activityId) ?? packages[0];
  if (entry) {
    if (entry.includedKids > 0) tokens.party_entry_capacity = String(entry.includedKids);
    if (entry.includedAdults > 0) tokens.party_entry_adults = String(entry.includedAdults);
    if (entry.foodCreditFormatted) {
      const match = entry.foodCreditFormatted.match(/\$(\d+(?:\.\d{1,2})?)/);
      if (match) tokens.party_entry_food_credit = `$${match[1]}`;
    }
    if (entry.startingPriceFormatted) tokens.party_starting_price = entry.startingPriceFormatted;
  }

  if (packages.length > 0) {
    const summaryParts = packages.map((party) => {
      const label = party.includedKids > 0
        ? `up to ${party.includedKids} kids`
        : party.name.split(" — ")[0]?.trim().toLowerCase() || party.name.toLowerCase();
      return `${label} (${party.startingPriceFormatted})`;
    });
    tokens.party_packages_summary = summaryParts.join(", ");
    tokens.party_capacity_summary = formatPartyCapacitySummary(packages);
    if (!tokens.party_starting_price) {
      tokens.party_starting_price = packages[0]?.startingPriceFormatted ?? tokens.party_starting_price;
    }
  }
}

async function loadPartyPackages(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
): Promise<PublicPartyPackage[]> {
  const [{ data: activities }, { data: inventoryOnly }] = await Promise.all([
    supabase
      .from("booking_activities")
      .select(ACTIVITY_PARTY_PACKAGE_SELECT_COLS)
      .eq("business_id", businessId)
      .eq("website_show_party_package", true)
      .eq("is_active", true)
      .order("website_sort_order", { ascending: true }),
    supabase
      .from("pos_inventory")
      .select(INVENTORY_PARTY_PACKAGE_SELECT_COLS)
      .eq("business_id", businessId)
      .eq("website_show_party_package", true)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ]);

  const activityRows = (activities ?? []) as ActivityRow[];
  const inventoryOnlyRows = (inventoryOnly ?? []) as InventoryPartyRow[];
  const inventoryIds = new Set<string>();

  for (const activity of activityRows) {
    const id = primaryInventoryIdFromTicketSettings(activity.ticket_settings);
    if (id) inventoryIds.add(id);
  }
  for (const row of inventoryOnlyRows) inventoryIds.add(row.id);

  let inventoryById = new Map<string, InventoryPartyRow>();
  if (inventoryIds.size > 0) {
    const { data: inventoryRows } = await supabase
      .from("pos_inventory")
      .select(INVENTORY_PARTY_PACKAGE_SELECT_COLS)
      .eq("business_id", businessId)
      .in("id", Array.from(inventoryIds));
    inventoryById = new Map(
      ((inventoryRows ?? []) as InventoryPartyRow[]).map((row) => [row.id, row]),
    );
  }

  const packages: PublicPartyPackage[] = [];
  const linkedInventoryIds = new Set<string>();

  for (const activity of activityRows) {
    const inventoryId = primaryInventoryIdFromTicketSettings(activity.ticket_settings);
    if (inventoryId) linkedInventoryIds.add(inventoryId);
    const inventory = inventoryId ? inventoryById.get(inventoryId) ?? null : null;
    const pkg = mapActivityToPublicPartyPackage(activity, inventory, {
      unlimitedPlayPolicy: DEFAULT_UNLIMITED_PLAY_POLICY,
    });
    if (pkg?.available) packages.push(pkg);
  }

  for (const row of inventoryOnlyRows) {
    if (linkedInventoryIds.has(row.id)) continue;
    const pkg = mapInventoryOnlyToPublicPartyPackage(row, {
      unlimitedPlayPolicy: DEFAULT_UNLIMITED_PLAY_POLICY,
      highlighted: true,
    });
    if (pkg?.available) packages.push(pkg);
  }

  packages.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return packages;
}

const AVAILABILITY_SUMMARY_RANGE_DAYS = 27;

async function loadAvailabilitySummaryTokens(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  timeZone: string,
): Promise<Pick<WebsiteCopyTokens, "walk_in_message" | "party_weekend_urgency" | "camp_spots_message">> {
  const out = {
    walk_in_message: FALLBACK_TOKENS.walk_in_message,
    party_weekend_urgency: FALLBACK_TOKENS.party_weekend_urgency,
    camp_spots_message: FALLBACK_TOKENS.camp_spots_message,
  };

  const today = formatDateInTimeZone(new Date(), timeZone);
  const rangeTo = addDaysToDateString(today, AVAILABILITY_SUMMARY_RANGE_DAYS);

  const { data: activityRows, error: actErr } = await supabase
    .from("booking_activities")
    .select("id, activity_name, type_id, booking_types!inner(type_key)")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .eq("portal_visible", true)
    .order("activity_name");
  if (actErr || !activityRows?.length) return out;

  const activities = activityRows.map((row) => {
    const bt = row.booking_types as { type_key?: string } | { type_key?: string }[] | null;
    const typeKeyValue = Array.isArray(bt) ? bt[0]?.type_key : bt?.type_key;
    return {
      id: row.id as string,
      activity_name: row.activity_name as string,
      type_id: row.type_id as string | null,
      type_key: String(typeKeyValue ?? "").trim(),
    } satisfies ActivityAvailabilityRow;
  });

  const activityIds = activities.map((activity) => activity.id);
  const { data: scheduleRows, error: schedErr } = await supabase
    .from("booking_activity_schedules")
    .select(BOOKING_AVAILABILITY_SCHEDULE_COLS)
    .eq("business_id", businessId)
    .in("activity_id", activityIds)
    .eq("is_active", true);
  if (schedErr) return out;

  const schedulesByActivity = new Map<string, ScheduleRow[]>();
  for (const row of (scheduleRows ?? []) as ScheduleRow[]) {
    const list = schedulesByActivity.get(row.activity_id) ?? [];
    list.push(row);
    schedulesByActivity.set(row.activity_id, list);
  }

  const dateStrings = enumerateDateStrings(today, rangeTo);
  const hostPortalUrl = resolveHostPortalUrl(businessId);
  const publicActivities: PublicActivityAvailability[] = [];

  for (const activity of activities) {
    const schedules = schedulesByActivity.get(activity.id) ?? [];
    const dates = [];

    for (const dateStr of dateStrings) {
      const daySchedules = pickSchedulesForActivityOnDate(schedules, dateStr, timeZone);
      if (daySchedules.length === 0) {
        dates.push(buildDateAvailability(dateStr, [], {}));
        continue;
      }

      const { data: occupancyRaw, error: occErr } = await supabase.rpc(
        "booking_get_portal_slot_occupancy",
        {
          p_business_id: businessId,
          p_activity_id: activity.id,
          p_booking_date: dateStr,
          p_exclude_hold_token: null,
        },
      );
      if (occErr) return out;

      dates.push(
        buildDateAvailability(dateStr, daySchedules, parseOccupancyMap(occupancyRaw)),
      );
    }

    publicActivities.push({
      activityId: activity.id,
      typeKey: activity.type_key,
      name: activity.activity_name,
      portalUrl: `${hostPortalUrl.replace(/\/$/, "")}/${activity.id}`,
      dates,
      nextOpenSlot: findNextOpenSlot(dates, hostPortalUrl, activity.id),
    });
  }

  const summaries = buildWebsiteSummaries(publicActivities, today, timeZone);
  if (summaries.dropInPlay?.walkInMessage) {
    out.walk_in_message = summaries.dropInPlay.walkInMessage;
  }
  if (summaries.party?.weekendUrgencyMessage) {
    out.party_weekend_urgency = summaries.party.weekendUrgencyMessage;
  }
  if (summaries.camp?.spotsMessage) {
    out.camp_spots_message = summaries.camp.spotsMessage;
  }

  return out;
}

export function applyWebsiteCopyTokens(text: string, tokens: WebsiteCopyTokens): string {
  let out = text;
  for (const [key, value] of Object.entries(tokens)) {
    if (!value) continue;
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

export async function loadWebsiteCopyTokens(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  options: { gripSocksProductId?: string } = {},
): Promise<WebsiteCopyTokens> {
  const tokens: WebsiteCopyTokens = { ...FALLBACK_TOKENS };
  const gripSocksProductId = trimText(options.gripSocksProductId) || DEFAULT_GRIP_SOCKS_PRODUCT_ID;

  const { data: business } = await supabase
    .from("businesses")
    .select("timezone")
    .eq("id", businessId)
    .maybeSingle();
  const timeZone = trimText(business?.timezone) || "America/Toronto";

  const [packages, socksResult, liveCapacity, availabilityTokens] = await Promise.all([
    loadPartyPackages(supabase, businessId),
    supabase
      .from("pos_inventory")
      .select(INVENTORY_WEBSITE_SELECT_COLS)
      .eq("business_id", businessId)
      .eq("id", gripSocksProductId)
      .maybeSingle(),
    loadLiveCapacitySnapshot(supabase, businessId, { typeKey: "drop_in_play" }).catch(() => null),
    loadAvailabilitySummaryTokens(supabase, businessId, timeZone).catch(() => ({
      walk_in_message: FALLBACK_TOKENS.walk_in_message,
      party_weekend_urgency: FALLBACK_TOKENS.party_weekend_urgency,
      camp_spots_message: FALLBACK_TOKENS.camp_spots_message,
    })),
  ]);

  applyPartyPackageTokens(tokens, packages);

  const socksRow = socksResult.data as InventoryRow | null;
  const socks = socksRow ? mapInventoryToPublicProduct(socksRow) : null;
  if (socks?.available && socks.priceFormatted) {
    tokens.grip_socks_price = socks.priceFormatted;
  }

  tokens.party_weekend_urgency = availabilityTokens.party_weekend_urgency;
  tokens.camp_spots_message = availabilityTokens.camp_spots_message;

  const liveWalkIn = trimText(liveCapacity?.walkInMessage);
  if (liveWalkIn) {
    tokens.walk_in_message = liveWalkIn;
  } else if (availabilityTokens.walk_in_message) {
    tokens.walk_in_message = availabilityTokens.walk_in_message;
  }

  return tokens;
}

export async function loadPublicWebsiteCopyTokens(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  options: { gripSocksProductId?: string; asOf?: Date } = {},
): Promise<PublicWebsiteCopyTokensPayload> {
  const asOf = options.asOf ?? new Date();
  const [{ data: business }, tokens] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, timezone")
      .eq("id", businessId)
      .maybeSingle(),
    loadWebsiteCopyTokens(supabase, businessId, options),
  ]);

  if (!business) throw new Error("Business not found");

  return {
    ok: true,
    businessId,
    businessName: trimText(business.name) || "Business",
    timezone: trimText(business.timezone) || "America/Toronto",
    asOf: asOf.toISOString(),
    tokens,
  };
}
