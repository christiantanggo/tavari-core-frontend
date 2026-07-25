/** Shared booking types + portal activities → public website catalog mapping. */

import {
  resolveCheckoutPricing,
  resolveTicketInventoryItemIds,
} from "./bookingCheckoutPricing.ts";
import { formatCadPrice, trimText } from "./tavariPublicProducts.ts";

export type BookingTypeRow = {
  id: string;
  type_name: string;
  display_name: string | null;
  description: string | null;
  type_key: string;
  display_order?: number | null;
};

export type BookingActivityRow = {
  id: string;
  activity_name: string;
  type_id: string | null;
  description: string | null;
  duration_minutes: number | null;
  ticket_settings: unknown;
  display_order?: number | null;
};

export type InventoryPriceRow = {
  id: string;
  name?: string | null;
  price?: number | string | null;
  website_online_price?: number | string | null;
  age_restriction?: unknown;
};

export type PublicBookingType = {
  id: string;
  typeKey: string;
  name: string;
  displayName: string;
  description: string;
  portalUrl: string;
  activityCount: number;
};

export type PublicBookingActivity = {
  id: string;
  typeId: string | null;
  typeKey: string;
  name: string;
  description: string;
  summary: string;
  durationMinutes: number;
  imageUrl: string;
  images: string[];
  startingPrice: number;
  startingPriceFormatted: string;
  priceFromLabel: string;
  perParticipant: boolean;
  portalUrl: string;
  sortOrder: number;
};

function parseJsonField(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

function parseActivityImages(ticketSettings: Record<string, unknown>): string[] {
  const raw = ticketSettings.activity_images ?? ticketSettings.activityImages;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((url) => (typeof url === "string" ? url.trim() : ""))
    .filter(Boolean);
}

function parsePartySettings(
  ticketSettings: Record<string, unknown>,
  bookingType: BookingTypeRow | null | undefined,
): { isPartyBooking: boolean } {
  const sessionRules =
    bookingType && typeof bookingType === "object"
      ? parseJsonField((bookingType as Record<string, unknown>).session_rules)
      : {};

  const ticketParty =
    ticketSettings.party_booking === true || ticketSettings.partyBooking === true;
  const categoryParty =
    sessionRules.party_booking === true || sessionRules.partyBooking === true;
  const isBirthdayType = String(bookingType?.type_key || "").toLowerCase().trim() === "birthday_party";

  return { isPartyBooking: ticketParty || categoryParty || isBirthdayType };
}

function buildSummary(description: string, name: string): string {
  const text = description.trim();
  if (!text) return name.trim();
  const firstLine = text.split(/\r?\n/)[0]?.trim() || text;
  if (firstLine.length <= 180) return firstLine;
  return `${firstLine.slice(0, 177).trim()}…`;
}

function buildPriceFromLabel(amount: number, perParticipant: boolean): string {
  if (!Number.isFinite(amount) || amount <= 0) return "";
  const formatted = formatCadPrice(amount);
  return perParticipant ? `From ${formatted}` : formatted;
}

export function resolveHostPortalUrl(businessId: string, siteUrl?: string): string {
  const base = (siteUrl || Deno.env.get("PUBLIC_SITE_URL") || "https://www.tavarios.ca").replace(/\/$/, "");
  return `${base}/customer-portal/${businessId}/portal`;
}

export function resolveActivityPortalUrl(hostPortalUrl: string, activityId: string): string {
  return `${hostPortalUrl.replace(/\/$/, "")}/${activityId}`;
}

export function resolveTypePortalUrl(hostPortalUrl: string, typeId: string): string {
  const base = hostPortalUrl.replace(/\/$/, "");
  return `${base}?type=${encodeURIComponent(typeId)}`;
}

export function mapActivityToPublicBookingActivity(
  activity: BookingActivityRow,
  options: {
    hostPortalUrl: string;
    typeById: Map<string, BookingTypeRow>;
    inventoryById: Map<string, InventoryPriceRow>;
    sortOrder?: number;
  },
): PublicBookingActivity {
  const ticketSettings = parseJsonField(activity.ticket_settings);
  const type = activity.type_id ? options.typeById.get(activity.type_id) ?? null : null;
  const partySettings = parsePartySettings(ticketSettings, type);
  const inventoryIds = resolveTicketInventoryItemIds(ticketSettings);
  const inventoryRows = inventoryIds
    .map((id) => options.inventoryById.get(id))
    .filter((row): row is InventoryPriceRow => Boolean(row));

  const checkoutPricing = resolveCheckoutPricing(
    ticketSettings,
    partySettings.isPartyBooking,
    inventoryRows,
  );

  const images = parseActivityImages(ticketSettings);
  const description = trimText(activity.description);
  const name = trimText(activity.activity_name);

  return {
    id: activity.id,
    typeId: activity.type_id,
    typeKey: trimText(type?.type_key),
    name,
    description,
    summary: buildSummary(description, name),
    durationMinutes: typeof activity.duration_minutes === "number" ? activity.duration_minutes : 60,
    imageUrl: images[0] ?? "",
    images,
    startingPrice: checkoutPricing.amount,
    startingPriceFormatted: checkoutPricing.amount > 0 ? formatCadPrice(checkoutPricing.amount) : "",
    priceFromLabel: buildPriceFromLabel(checkoutPricing.amount, checkoutPricing.perParticipant),
    perParticipant: checkoutPricing.perParticipant,
    portalUrl: resolveActivityPortalUrl(options.hostPortalUrl, activity.id),
    sortOrder: options.sortOrder ?? 0,
  };
}

export function mapTypeToPublicBookingType(
  type: BookingTypeRow,
  options: { hostPortalUrl: string; activityCount: number },
): PublicBookingType {
  const displayName = trimText(type.display_name) || trimText(type.type_name);
  return {
    id: type.id,
    typeKey: trimText(type.type_key),
    name: trimText(type.type_name),
    displayName,
    description: trimText(type.description),
    portalUrl: resolveTypePortalUrl(options.hostPortalUrl, type.id),
    activityCount: options.activityCount,
  };
}

export const BOOKING_TYPE_SELECT_COLS = "id, type_name, display_name, description, type_key, display_order";
export const BOOKING_ACTIVITY_CATALOG_SELECT_COLS =
  "id, activity_name, type_id, description, duration_minutes, ticket_settings, display_order";

export const BOOKING_CATALOG_TYPE_KEYS = {
  openPlay: "drop_in_play",
  party: "birthday_party",
  camp: "day_camp",
  group: "group_visit",
  specialEvent: "special_event",
} as const;
