/** Public manage-booking API helpers for external websites (OTWK). */

import {
  buildBookingManageUrl,
  getOrCreateBookingSelfServiceToken,
} from "./bookingSelfService.ts";
import { loadBookingSelfServicePayload } from "./bookingSelfServicePayload.ts";

type SupabaseClient = ReturnType<typeof import("@supabase/supabase-js").createClient>;

export type ManageBookingPortalUrls = {
  hostManageBookingUrl: string;
  websiteManageUrl: string | null;
  manageBookingUrl: string;
  customerPortalUrl: string;
};

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

function joinWebsitePath(base: string, path: string): string {
  const normalizedBase = base.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function resolveHostManageBookingUrl(businessId: string, siteUrl?: string): string {
  const base = (siteUrl || Deno.env.get("PUBLIC_SITE_URL") || "https://www.tavarios.ca").replace(/\/$/, "");
  return `${base}/customer-portal/${businessId}/portal/manage-booking`;
}

export function resolveManageBookingPortalUrls(input: {
  businessId: string;
  siteUrl?: string;
  websiteBaseUrl?: string | null;
  customerPortalUrl?: string | null;
  manageBookingUrlOverride?: string | null;
  partyManageUrlOverride?: string | null;
}): ManageBookingPortalUrls {
  const siteUrl = (input.siteUrl || Deno.env.get("PUBLIC_SITE_URL") || "https://www.tavarios.ca").replace(/\/$/, "");
  const hostManageBookingUrl = resolveHostManageBookingUrl(input.businessId, siteUrl);
  const customerPortalUrl = coalesceUrl(
    input.customerPortalUrl,
    `${siteUrl}/customer-portal/${input.businessId}/portal`,
  )!;
  const websiteManageUrl = coalesceUrl(
    input.manageBookingUrlOverride,
    input.partyManageUrlOverride,
    input.websiteBaseUrl ? joinWebsitePath(input.websiteBaseUrl, "/manage-your-party") : null,
  );
  const manageBookingUrl = coalesceUrl(
    input.manageBookingUrlOverride,
    input.partyManageUrlOverride,
    websiteManageUrl,
    hostManageBookingUrl,
    customerPortalUrl,
  )!;

  return {
    hostManageBookingUrl,
    websiteManageUrl,
    manageBookingUrl,
    customerPortalUrl,
  };
}

export function buildManageBookingLinks(
  businessId: string,
  token: string,
  selfService?: { awaitingDeposit?: boolean },
) {
  const manageBookingUrl = buildBookingManageUrl(businessId, token);
  const paymentUrl = selfService?.awaitingDeposit
    ? `${manageBookingUrl}?pay=1`
    : null;
  return {
    manageBookingUrl,
    paymentUrl,
    rescheduleUrl: manageBookingUrl,
  };
}

export type PublicManageBookingListItem = {
  bookingId: string;
  bookingNumber: string | null;
  bookingDate: string;
  bookingTime: string | null;
  status: string;
  paymentStatus: string | null;
  activityName: string;
  bookingTypeName: string | null;
  customerName: string | null;
};

export function mapManageBookingListItem(row: Record<string, unknown>): PublicManageBookingListItem {
  return {
    bookingId: String(row.booking_id || row.bookingId || ""),
    bookingNumber: trimText(row.booking_number || row.bookingNumber) || null,
    bookingDate: String(row.booking_date || row.bookingDate || ""),
    bookingTime: trimText(row.booking_time || row.bookingTime) || null,
    status: String(row.status || ""),
    paymentStatus: trimText(row.payment_status || row.paymentStatus) || null,
    activityName: trimText(row.activity_name || row.activityName) || "Booking",
    bookingTypeName: trimText(row.booking_type_name || row.bookingTypeName) || null,
    customerName: trimText(row.customer_name || row.customerName) || null,
  };
}

export type PublicManageBookingSummary = {
  ok: true;
  businessId: string;
  businessName: string;
  bookingId: string;
  bookingNumber: string | null;
  bookingDate: string;
  bookingTime: string | null;
  status: string;
  paymentStatus: string | null;
  activityName: string;
  bookingTypeName: string | null;
  ticketSummary: Array<{ name: string; qty: number }>;
  orderTotal: number | null;
  totalPaid: number;
  manageToken: string;
  manageBookingUrl: string;
  links: {
    manageBookingUrl: string;
    paymentUrl: string | null;
    rescheduleUrl: string;
    customerPortalUrl: string;
  };
  actions: {
    cancelAllowed: boolean;
    rescheduleAllowed: boolean;
    payDepositAllowed: boolean;
    requiresContactForCancel: boolean;
  };
  selfService: Record<string, unknown>;
};

export async function buildPublicManageBookingSummary(
  supabase: SupabaseClient,
  businessId: string,
  bookingId: string,
  options: { customerPortalUrl?: string; manageToken?: string } = {},
): Promise<PublicManageBookingSummary> {
  const manageToken = options.manageToken ||
    await getOrCreateBookingSelfServiceToken(supabase, bookingId, businessId);
  const payload = await loadBookingSelfServicePayload(supabase, bookingId, businessId);
  const booking = payload.booking as Record<string, unknown>;
  const activity = booking.booking_activities as { activity_name?: string } | null;
  const bookingType = booking.booking_types as { display_name?: string; type_name?: string } | null;
  const links = buildManageBookingLinks(businessId, manageToken, payload.selfService);
  const customerPortalUrl = trimText(options.customerPortalUrl) ||
    `${(Deno.env.get("PUBLIC_SITE_URL") || "https://www.tavarios.ca").replace(/\/$/, "")}/customer-portal/${businessId}/portal`;

  return {
    ok: true,
    businessId,
    businessName: trimText((payload.business as { name?: string } | null)?.name) || "Business",
    bookingId: String(booking.id || bookingId),
    bookingNumber: trimText(booking.booking_number) || null,
    bookingDate: String(booking.booking_date || ""),
    bookingTime: trimText(booking.booking_time) || null,
    status: String(booking.status || ""),
    paymentStatus: trimText(booking.payment_status) || null,
    activityName: trimText(activity?.activity_name) || "Booking",
    bookingTypeName: trimText(bookingType?.display_name || bookingType?.type_name) || null,
    ticketSummary: payload.ticketSummary,
    orderTotal: booking.order_total != null ? Number(booking.order_total) : null,
    totalPaid: payload.totalPaid,
    manageToken,
    manageBookingUrl: links.manageBookingUrl,
    links: {
      ...links,
      customerPortalUrl,
    },
    actions: {
      cancelAllowed: payload.selfService.cancelAllowed === true,
      rescheduleAllowed: payload.selfService.rescheduleAllowed === true,
      payDepositAllowed: payload.selfService.awaitingDeposit === true,
      requiresContactForCancel: payload.selfService.requiresContactForCancel === true,
    },
    selfService: payload.selfService as Record<string, unknown>,
  };
}

export async function invokeManageBookingSelfService(
  body: Record<string, unknown>,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const response = await fetch(`${supabaseUrl}/functions/v1/manage-booking-self-service`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, data };
}
