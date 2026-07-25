/** Canonical website links for external marketing sites (OTWK). */

import {
  BOOKING_ACTIVITY_CATALOG_SELECT_COLS,
  BOOKING_TYPE_SELECT_COLS,
  mapActivityToPublicBookingActivity,
  mapTypeToPublicBookingType,
  resolveActivityPortalUrl,
  resolveHostPortalUrl,
  resolveTypePortalUrl,
  type BookingActivityRow,
  type BookingTypeRow,
  type InventoryPriceRow,
  type PublicBookingActivity,
} from "./tavariPublicBookingCatalog.ts";
import { resolveLeaveReviewUrl } from "./tavariPublicReputationFeed.ts";
import { resolveHostManageBookingUrl, resolveManageBookingPortalUrls } from "./tavariPublicManageBooking.ts";
import { resolveTicketInventoryItemIds } from "./bookingCheckoutPricing.ts";
import { resolveDefaultWaiverTemplate } from "./tavariPublicWaiverEmbed.ts";

export type BusinessWebsiteLinkOverrides = {
  website_base_url?: string | null;
  booking_url?: string | null;
  open_play_booking_url?: string | null;
  party_booking_url?: string | null;
  camp_booking_url?: string | null;
  group_booking_url?: string | null;
  waiver_url?: string | null;
  review_url?: string | null;
  google_review_url?: string | null;
  customer_portal_url?: string | null;
  party_guest_list_url?: string | null;
  camp_registration_url?: string | null;
  party_manage_url?: string | null;
  manage_booking_url?: string | null;
  review_link_label?: string | null;
};

export type PublicBusinessLinks = {
  ok: true;
  businessId: string;
  businessName: string;
  websiteBaseUrl: string | null;
  hostPortalUrl: string;
  links: {
    bookingUrl: string;
    openPlayBookingUrl: string;
    partyBookingUrl: string;
    campBookingUrl: string;
    groupBookingUrl: string;
    waiverUrl: string;
    reviewUrl: string;
    googleReviewUrl: string | null;
    customerPortalUrl: string;
    partyGuestListUrl: string;
    partyGuestListHostUrl: string;
    campRegistrationUrl: string;
    campRegistrationHostUrl: string;
    partyManageUrl: string;
    manageBookingUrl: string;
  };
  labels: {
    reviewLinkLabel: string;
  };
};

const BOOKING_TYPE_KEYS = {
  openPlay: "drop_in_play",
  party: "birthday_party",
  camp: "day_camp",
  group: "group_visit",
} as const;

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function coalesceUrl(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = trimText(value);
    if (trimmed) return trimmed;
  }
  return null;
}

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

function pickTypePortalUrl(
  types: Array<{ typeKey: string; portalUrl: string }>,
  typeKey: string,
): string | null {
  const match = types.find((type) => type.typeKey === typeKey);
  return match?.portalUrl?.trim() || null;
}

function pickLowestPricedActivity(
  activities: PublicBookingActivity[],
  typeKey: string,
): PublicBookingActivity | null {
  const matches = activities.filter((activity) => activity.typeKey === typeKey);
  if (matches.length === 0) return null;
  return matches.reduce((best, current) =>
    best.startingPrice <= 0 || (current.startingPrice > 0 && current.startingPrice < best.startingPrice)
      ? current
      : best
  );
}

function joinWebsitePath(base: string, path: string): string {
  const normalizedBase = base.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

async function loadBookingCatalogUrls(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  hostPortalUrl: string,
  websiteBaseUrl: string | null,
) {
  const [{ data: types }, { data: activities }] = await Promise.all([
    supabase
      .from("booking_types")
      .select(BOOKING_TYPE_SELECT_COLS)
      .eq("business_id", businessId)
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .order("type_name", { ascending: true }),
    supabase
      .from("booking_activities")
      .select(BOOKING_ACTIVITY_CATALOG_SELECT_COLS)
      .eq("business_id", businessId)
      .eq("is_active", true)
      .eq("portal_visible", true)
      .order("display_order", { ascending: true })
      .order("activity_name", { ascending: true }),
  ]);

  const typeRows = (types ?? []) as BookingTypeRow[];
  const activityRows = (activities ?? []) as BookingActivityRow[];
  const typeById = new Map(typeRows.map((row) => [row.id, row]));

  const inventoryIds = new Set<string>();
  for (const activity of activityRows) {
    const ticketSettings = parseJsonField(activity.ticket_settings);
    for (const id of resolveTicketInventoryItemIds(ticketSettings)) {
      inventoryIds.add(id);
    }
  }

  let inventoryById = new Map<string, InventoryPriceRow>();
  if (inventoryIds.size > 0) {
    const { data: inventoryRows } = await supabase
      .from("pos_inventory")
      .select("id, name, price, website_online_price, age_restriction")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .in("id", Array.from(inventoryIds));

    inventoryById = new Map(
      ((inventoryRows ?? []) as InventoryPriceRow[]).map((row) => [row.id, row]),
    );
  }

  const activityCountByType = new Map<string, number>();
  for (const activity of activityRows) {
    if (!activity.type_id) continue;
    activityCountByType.set(
      activity.type_id,
      (activityCountByType.get(activity.type_id) ?? 0) + 1,
    );
  }

  const publicTypes = typeRows
    .filter((type) => (activityCountByType.get(type.id) ?? 0) > 0)
    .map((type) =>
      mapTypeToPublicBookingType(type, {
        hostPortalUrl,
        activityCount: activityCountByType.get(type.id) ?? 0,
      })
    );

  const publicActivities = activityRows.map((activity, index) =>
    mapActivityToPublicBookingActivity(activity, {
      hostPortalUrl,
      typeById,
      inventoryById,
      sortOrder: index,
    })
  );

  function resolvePurposeUrl(typeKey: string, fallback?: string | null): string {
    const activity = pickLowestPricedActivity(publicActivities, typeKey);
    if (activity?.portalUrl) return activity.portalUrl;
    const typeUrl = pickTypePortalUrl(publicTypes, typeKey);
    if (typeUrl) return typeUrl;
    return fallback || hostPortalUrl;
  }

  return {
    bookingUrl: resolvePurposeUrl(BOOKING_TYPE_KEYS.openPlay),
    openPlayBookingUrl: resolvePurposeUrl(BOOKING_TYPE_KEYS.openPlay),
    partyBookingUrl: resolvePurposeUrl(BOOKING_TYPE_KEYS.party),
    campBookingUrl: resolvePurposeUrl(BOOKING_TYPE_KEYS.camp),
    groupBookingUrl: resolvePurposeUrl(
      BOOKING_TYPE_KEYS.group,
      websiteBaseUrl ? joinWebsitePath(websiteBaseUrl, "/contact") : null,
    ),
  };
}

async function loadWaiverDefaultUrl(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  websiteBaseUrl: string | null,
  siteUrl: string,
): Promise<string> {
  const overrideBase = websiteBaseUrl || trimText(Deno.env.get("BUSINESS_WEBSITE_BASE_URL"));
  if (overrideBase) {
    return joinWebsitePath(overrideBase, "/waiver");
  }

  const { data: templates } = await supabase
    .from("waiver_templates")
    .select(
      "id, template_key, template_name, waiver_title, fields_config, requires_digital_signature, expiry_days, minor_age_threshold, version, is_active",
    )
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("version", { ascending: false });

  const { data: settingsRows } = await supabase
    .from("waiver_settings")
    .select("setting_key, setting_value")
    .eq("business_id", businessId)
    .is("template_id", null)
    .eq("is_global", true);

  const settings: Record<string, unknown> = {};
  for (const row of settingsRows || []) {
    settings[String((row as { setting_key?: string }).setting_key || "")] =
      (row as { setting_value?: unknown }).setting_value;
  }

  const resolved = resolveDefaultWaiverTemplate(
    (templates || []) as Parameters<typeof resolveDefaultWaiverTemplate>[0],
    settings,
  );
  const templateKey = trimText(resolved?.template_key || resolved?.id);
  const base = siteUrl.replace(/\/$/, "");
  if (templateKey) return `${base}/waiver/${businessId}/${templateKey}`;
  return `${base}/waiver/${businessId}`;
}

export async function loadPublicBusinessLinks(
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>,
  businessId: string,
  options: { siteUrl?: string } = {},
): Promise<PublicBusinessLinks> {
  const siteUrl = (options.siteUrl || Deno.env.get("PUBLIC_SITE_URL") || "https://www.tavarios.ca").replace(/\/$/, "");

  const [
    { data: business, error: bizErr },
    { data: overrides },
    { data: reputationSettings },
    { data: partySettings },
    { data: campTemplate },
  ] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name, business_website")
      .eq("id", businessId)
      .maybeSingle(),
    supabase
      .from("business_website_links")
      .select("*")
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase
      .from("reputation_settings")
      .select("google_review_url")
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase
      .from("party_guest_list_settings")
      .select("website_portal_url")
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase
      .from("camper_registration_form_templates")
      .select("website_portal_url")
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);

  if (bizErr) throw new Error(bizErr.message);
  if (!business) throw new Error("Business not found");

  const overrideRow = (overrides || {}) as BusinessWebsiteLinkOverrides;
  const websiteBaseUrl = coalesceUrl(
    overrideRow.website_base_url,
    business.business_website,
    Deno.env.get("BUSINESS_WEBSITE_BASE_URL"),
  );
  const hostPortalUrl = coalesceUrl(
    overrideRow.customer_portal_url,
    resolveHostPortalUrl(businessId, siteUrl),
  )!;
  const bookingDefaults = await loadBookingCatalogUrls(supabase, businessId, hostPortalUrl, websiteBaseUrl);
  const partyGuestListHostUrl = `${siteUrl}/customer-portal/${businessId}/party-guest-list`;
  const campRegistrationHostUrl = `${siteUrl}/customer-portal/${businessId}/camp-registration`;
  const defaultWaiverUrl = await loadWaiverDefaultUrl(supabase, businessId, websiteBaseUrl, siteUrl);
  const leaveReviewUrl = coalesceUrl(
    overrideRow.review_url,
    resolveLeaveReviewUrl(businessId, siteUrl),
  )!;

  const partyGuestListWebsiteUrl = coalesceUrl(
    overrideRow.party_guest_list_url,
    partySettings?.website_portal_url,
    websiteBaseUrl ? joinWebsitePath(websiteBaseUrl, "/party-guest-list") : null,
    partyGuestListHostUrl,
  )!;

  const campRegistrationWebsiteUrl = coalesceUrl(
    overrideRow.camp_registration_url,
    campTemplate?.website_portal_url,
    websiteBaseUrl ? joinWebsitePath(websiteBaseUrl, "/camp-registration") : null,
    campRegistrationHostUrl,
  )!;

  const manageBookingUrls = resolveManageBookingPortalUrls({
    businessId,
    siteUrl,
    websiteBaseUrl,
    customerPortalUrl: hostPortalUrl,
    manageBookingUrlOverride: overrideRow.manage_booking_url,
    partyManageUrlOverride: overrideRow.party_manage_url,
  });

  return {
    ok: true,
    businessId,
    businessName: trimText(business.name) || "Business",
    websiteBaseUrl,
    hostPortalUrl,
    links: {
      bookingUrl: coalesceUrl(overrideRow.booking_url, overrideRow.open_play_booking_url, bookingDefaults.bookingUrl)!,
      openPlayBookingUrl: coalesceUrl(
        overrideRow.open_play_booking_url,
        overrideRow.booking_url,
        bookingDefaults.openPlayBookingUrl,
      )!,
      partyBookingUrl: coalesceUrl(overrideRow.party_booking_url, bookingDefaults.partyBookingUrl)!,
      campBookingUrl: coalesceUrl(overrideRow.camp_booking_url, bookingDefaults.campBookingUrl)!,
      groupBookingUrl: coalesceUrl(overrideRow.group_booking_url, bookingDefaults.groupBookingUrl)!,
      waiverUrl: coalesceUrl(overrideRow.waiver_url, defaultWaiverUrl)!,
      reviewUrl: leaveReviewUrl,
      googleReviewUrl: coalesceUrl(
        overrideRow.google_review_url,
        reputationSettings?.google_review_url,
      ),
      customerPortalUrl: hostPortalUrl,
      partyGuestListUrl: partyGuestListWebsiteUrl,
      partyGuestListHostUrl,
      campRegistrationUrl: campRegistrationWebsiteUrl,
      campRegistrationHostUrl,
      manageBookingUrl: manageBookingUrls.manageBookingUrl,
      partyManageUrl: coalesceUrl(
        overrideRow.party_manage_url,
        overrideRow.manage_booking_url,
        manageBookingUrls.hostManageBookingUrl,
        websiteBaseUrl ? joinWebsitePath(websiteBaseUrl, "/manage-your-party") : null,
        hostPortalUrl,
      )!,
    },
    labels: {
      reviewLinkLabel: trimText(overrideRow.review_link_label) || 'Leave Us A Review',
    },
  };
}

export { resolveHostPortalUrl, resolveActivityPortalUrl, resolveTypePortalUrl, resolveHostManageBookingUrl };
