/** Shared booking activity + inventory → public website party package mapping. */

import {
  buildProductPriceFields,
  formatCadPrice,
  type InventoryRow,
  isProductAvailable,
  trimText,
} from "./tavariPublicProducts.ts";

export type ActivityRow = {
  id: string;
  activity_name: string;
  description: string | null;
  duration_minutes: number | null;
  party_included_kids: number | null;
  party_included_adults: number | null;
  ticket_settings: unknown;
  website_food_credit: number | string | null;
  website_highlighted: boolean | null;
  website_sort_order: number | null;
  website_package_inclusions: unknown;
  is_active: boolean | null;
};

export type InventoryPartyRow = InventoryRow & {
  website_show_party_package?: boolean | null;
};

export type PublicPartyPackage = {
  id: string;
  activityId: string | null;
  inventoryItemId: string | null;
  name: string;
  summary: string;
  description: string;
  includedKids: number;
  includedAdults: number;
  durationMinutes: number;
  foodCredit: number | null;
  foodCreditFormatted: string | null;
  inclusions: string[];
  startingPrice: number;
  startingPriceFormatted: string;
  onlinePrice: number | null;
  onlinePriceFormatted: string | null;
  unlimitedPlayPolicy: string;
  highlighted: boolean;
  sortOrder: number;
  available: boolean;
};

export const DEFAULT_UNLIMITED_PLAY_POLICY =
  "Unlimited play in the facility until we close";

export const DEFAULT_PARTY_ROOM_LINE =
  "90 minutes in the private party room (on your booked schedule)";

const FOOD_CREDIT_RE = /\$\s*(\d+(?:\.\d{1,2})?)\s*food credit/i;

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null || value === "") return null;
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function parseFoodCreditFromText(text: string): number | null {
  const match = text.match(FOOD_CREDIT_RE);
  if (!match) return null;
  const n = parseFloat(match[1]);
  return Number.isFinite(n) ? n : null;
}

export function primaryInventoryIdFromTicketSettings(ticketSettings: unknown): string | null {
  if (!ticketSettings || typeof ticketSettings !== "object") return null;
  const ids = (ticketSettings as Record<string, unknown>).inventory_item_ids;
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const first = String(ids[0] ?? "").trim();
  return first || null;
}

function parseInclusionsOverride(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const lines = value
    .map((line) => trimText(line))
    .filter(Boolean);
  return lines.length > 0 ? lines : null;
}

function formatFoodCredit(amount: number | null): string | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  const rounded = Number.isInteger(amount) ? amount : amount;
  return `$${rounded} food credit applied at end of party`;
}

function resolveFoodCredit(
  activity: ActivityRow,
  inventory: InventoryRow | null | undefined,
): number | null {
  const fromActivity = parseNumeric(activity.website_food_credit);
  if (fromActivity != null) return fromActivity;
  const invDesc = trimText(inventory?.description);
  if (invDesc) {
    const fromInventory = parseFoodCreditFromText(invDesc);
    if (fromInventory != null) return fromInventory;
  }
  return null;
}

function buildDefaultInclusions(
  activity: ActivityRow,
  inventory: InventoryRow | null | undefined,
  foodCredit: number | null,
  unlimitedPlayPolicy: string,
): string[] {
  const override = parseInclusionsOverride(activity.website_package_inclusions);
  if (override) return override;

  const lines: string[] = [];
  const duration = activity.duration_minutes ?? 90;
  if (duration > 0) {
    if (duration === 120) {
      lines.push("2-hour party");
    } else {
      lines.push(`${duration} minutes in the private party room (on your booked schedule)`);
    }
  }

  const kids = activity.party_included_kids ?? 0;
  const adults = activity.party_included_adults ?? 0;
  if (kids > 0 && adults > 0 && kids === adults) {
    lines.push(unlimitedPlayPolicy);
    lines.push(`${adults} free adults`);
  } else if (kids > 0 || adults > 0) {
    lines.push(unlimitedPlayPolicy);
    if (adults > 0) lines.push(`${adults} free adults`);
  } else {
    lines.push(unlimitedPlayPolicy);
  }

  const foodLine = formatFoodCredit(foodCredit);
  if (foodLine) lines.push(foodLine);

  if (!lines.length && inventory?.description) {
    return trimText(inventory.description)
      .split("·")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return lines;
}

function buildInventoryOnlyInclusions(
  inventory: InventoryRow,
  foodCredit: number | null,
): string[] {
  const desc = trimText(inventory.description);
  if (desc.includes("·")) {
    return desc
      .split("·")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  const lines: string[] = [];
  if (desc) lines.push(desc);
  const foodLine = formatFoodCredit(foodCredit);
  if (foodLine && !desc.toLowerCase().includes("food credit")) lines.push(foodLine);
  return lines;
}

function joinDescription(lines: string[]): string {
  return lines.filter(Boolean).join(" · ");
}

function buildDisplayName(
  activity: ActivityRow,
  inventory: InventoryRow | null | undefined,
): string {
  const activityName = trimText(activity.activity_name);
  if (activityName) return activityName;
  return trimText(inventory?.name);
}

export function mapActivityToPublicPartyPackage(
  activity: ActivityRow,
  inventory: InventoryRow | null | undefined,
  options: { unlimitedPlayPolicy?: string } = {},
): PublicPartyPackage | null {
  if (activity.is_active === false) return null;

  const unlimitedPlayPolicy = options.unlimitedPlayPolicy ?? DEFAULT_UNLIMITED_PLAY_POLICY;
  const inventoryItemId = primaryInventoryIdFromTicketSettings(activity.ticket_settings);
  const foodCredit = resolveFoodCredit(activity, inventory);
  const inclusions = buildDefaultInclusions(activity, inventory, foodCredit, unlimitedPlayPolicy);
  const description = joinDescription(inclusions);
  const name = buildDisplayName(activity, inventory);

  const priceFields = inventory
    ? buildProductPriceFields(inventory)
    : {
      price: 0,
      priceFormatted: "",
      gatePrice: 0,
      gatePriceFormatted: "",
      onlinePrice: null as number | null,
      onlinePriceFormatted: null as string | null,
    };

  const available = inventory ? isProductAvailable(inventory) : false;
  const kids = activity.party_included_kids ?? 0;
  const adults = activity.party_included_adults ?? 0;
  const summary =
    kids > 0 && adults > 0
      ? `${kids} kids & ${adults} adults · ${activity.duration_minutes ?? 90} min party room`
      : name;

  return {
    id: activity.id,
    activityId: activity.id,
    inventoryItemId,
    name,
    summary,
    description,
    includedKids: kids,
    includedAdults: adults,
    durationMinutes: activity.duration_minutes ?? 90,
    foodCredit,
    foodCreditFormatted: formatFoodCredit(foodCredit),
    inclusions,
    startingPrice: priceFields.price,
    startingPriceFormatted: priceFields.priceFormatted,
    onlinePrice: priceFields.onlinePrice,
    onlinePriceFormatted: priceFields.onlinePriceFormatted,
    unlimitedPlayPolicy,
    highlighted: activity.website_highlighted === true,
    sortOrder: typeof activity.website_sort_order === "number" ? activity.website_sort_order : 0,
    available,
  };
}

export function mapInventoryOnlyToPublicPartyPackage(
  inventory: InventoryRow,
  options: { unlimitedPlayPolicy?: string; highlighted?: boolean } = {},
): PublicPartyPackage | null {
  if (inventory.is_active === false) return null;

  const unlimitedPlayPolicy = options.unlimitedPlayPolicy ?? DEFAULT_UNLIMITED_PLAY_POLICY;
  const foodCredit = parseFoodCreditFromText(trimText(inventory.description));
  const inclusions = buildInventoryOnlyInclusions(inventory, foodCredit);
  const description = joinDescription(inclusions);
  const name = trimText(inventory.name);
  const priceFields = buildProductPriceFields(inventory);
  const available = isProductAvailable(inventory);

  let includedKids = 0;
  let includedAdults = 0;
  let durationMinutes = 90;

  const descLower = description.toLowerCase();
  const peopleMatch = descLower.match(/up to (\d+) people.*\((\d+) kids & (\d+) adults\)/i);
  if (peopleMatch) {
    includedKids = parseInt(peopleMatch[2], 10) || 0;
    includedAdults = parseInt(peopleMatch[3], 10) || 0;
  }
  if (descLower.includes("2-hour")) durationMinutes = 120;

  return {
    id: inventory.id,
    activityId: null,
    inventoryItemId: inventory.id,
    name,
    summary: name,
    description,
    includedKids,
    includedAdults,
    durationMinutes,
    foodCredit,
    foodCreditFormatted: formatFoodCredit(foodCredit),
    inclusions,
    startingPrice: priceFields.price,
    startingPriceFormatted: priceFields.priceFormatted,
    onlinePrice: priceFields.onlinePrice,
    onlinePriceFormatted: priceFields.onlinePriceFormatted,
    unlimitedPlayPolicy,
    highlighted: options.highlighted === true,
    sortOrder: typeof inventory.sort_order === "number" ? inventory.sort_order : 999,
    available,
  };
}

export const ACTIVITY_PARTY_PACKAGE_SELECT_COLS =
  "id, activity_name, description, duration_minutes, party_included_kids, party_included_adults, ticket_settings, website_food_credit, website_highlighted, website_sort_order, website_package_inclusions, is_active";

export const INVENTORY_PARTY_PACKAGE_SELECT_COLS =
  "id, name, description, price, website_online_price, image_url, sort_order, track_stock, stock_quantity, is_active, expose_to_website_api, website_show_party_package";
