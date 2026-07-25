import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildBookingManageUrl,
  getOrCreateBookingSelfServiceToken,
} from "../_shared/bookingSelfService.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const normalizePhone = (value: unknown) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  return digits;
};

/** Same fallback as WaiversDashboard `DISPLAY_FALLBACK_EXPIRY_DAYS`. */
const DISPLAY_FALLBACK_EXPIRY_DAYS = 365;

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
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return raw;
}

/** Mirrors `getEffectiveWaiverExpiryDate` in WaiversDashboard.jsx (snake_case row). */
function computeEffectiveExpiresAtIso(waiver: any, businessDefaultExpiryDays: number | null): string | null {
  if (waiver?.expires_at) {
    const expiryDate = new Date(waiver.expires_at);
    if (!Number.isNaN(expiryDate.getTime())) return expiryDate.toISOString();
  }

  if (!waiver?.signed_at) return null;

  const signedDate = new Date(waiver.signed_at);
  if (Number.isNaN(signedDate.getTime())) return null;

  const fromSettings = parsePositiveExpiryDays(businessDefaultExpiryDays);
  const fromTemplate = parsePositiveExpiryDays(waiver?.waiver_templates?.expiry_days);
  const expiryDays = fromSettings || fromTemplate || DISPLAY_FALLBACK_EXPIRY_DAYS;

  return new Date(signedDate.getTime() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
}

async function loadBusinessDefaultExpiryDays(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("waiver_settings")
    .select("setting_value")
    .eq("business_id", businessId)
    .eq("setting_key", "default_expiry_days")
    .eq("is_global", true)
    .is("template_id", null)
    .maybeSingle();

  if (error || !data) return null;
  return parsePositiveExpiryDays(coerceNumericSettingValue(data.setting_value));
}

const isUpcomingBooking = (booking: any) => {
  if (!booking?.booking_date) return false;
  const time = booking.booking_time || "00:00:00";
  const date = new Date(`${booking.booking_date}T${time}`);
  return Number.isFinite(date.getTime()) && date.getTime() >= Date.now();
};

const mapAccessLevel = (participant: any) => {
  if (participant?.is_account_owner) return "Owner";
  if (participant?.participant_type === "additional_adult") return "Can Book";
  return "Member";
};

async function validateCustomer(supabase: ReturnType<typeof createClient>, businessId: string, customerId: string, phone: string) {
  const { data: customer, error } = await supabase
    .from("pos_loyalty_accounts")
    .select("id, business_id, customer_name, customer_email, customer_phone, is_active, created_at, updated_at")
    .eq("id", customerId)
    .eq("business_id", businessId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!customer) return null;

  const expectedPhone = normalizePhone(customer.customer_phone);
  if (!phone || !expectedPhone || normalizePhone(phone) !== expectedPhone) {
    return null;
  }

  return customer;
}

async function loadAttachedPeople(supabase: ReturnType<typeof createClient>, customerId: string, businessId: string) {
  const { data, error } = await supabase.rpc("bookings_get_portal_participants", {
    p_customer_id: customerId,
    p_business_id: businessId,
  });

  if (error) throw error;

  const participants = Array.isArray(data) ? data : data ? [data] : [];
  return participants.map((participant: any) => ({
    ...participant,
    accessLevel: mapAccessLevel(participant),
    displayName: [participant.first_name, participant.last_name].filter(Boolean).join(" ").trim() || "Participant",
  }));
}

async function loadBookings(supabase: ReturnType<typeof createClient>, customerId: string, businessId: string) {
  const { data, error } = await supabase
    .from("bookings")
    .select(`
      id,
      booking_number,
      booking_date,
      booking_time,
      status,
      payment_status,
      requires_approval,
      approved_at,
      created_at,
      activity_id,
      booking_activities:activity_id (
        activity_name
      ),
      booking_types:booking_type_id (
        display_name,
        type_name
      ),
      booking_participants (
        id,
        waiver_status
      )
    `)
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .order("booking_date", { ascending: false })
    .order("booking_time", { ascending: false })
    .limit(100);

  if (error) throw error;

  const bookings = await Promise.all(
    (data || []).map(async (booking: any) => {
      const manageToken = await getOrCreateBookingSelfServiceToken(supabase, booking.id, businessId);
      const activityName = booking.booking_activities?.activity_name || "Booking";
      const bookingTypeName =
        booking.booking_types?.display_name || booking.booking_types?.type_name || null;
      const missingWaiverCount = (booking.booking_participants || []).filter(
        (participant: any) => participant.waiver_status !== "valid"
      ).length;

      return {
        id: booking.id,
        bookingNumber: booking.booking_number,
        bookingDate: booking.booking_date,
        bookingTime: booking.booking_time,
        status: booking.status,
        paymentStatus: booking.payment_status,
        requiresApproval: booking.requires_approval === true,
        approvedAt: booking.approved_at || null,
        createdAt: booking.created_at,
        activityName,
        bookingTypeName,
        missingWaiverCount,
        manageToken,
        manageUrl: buildBookingManageUrl(businessId, manageToken),
      };
    })
  );

  const upcoming = bookings.filter((booking) => isUpcomingBooking({
    booking_date: booking.bookingDate,
    booking_time: booking.bookingTime,
  }));
  const past = bookings.filter((booking) => !upcoming.some((upcomingBooking) => upcomingBooking.id === booking.id));
  const parties = bookings.filter((booking) =>
    /party|birthday|event/i.test(`${booking.activityName || ""} ${booking.bookingTypeName || ""}`)
  );

  return {
    upcoming,
    past,
    parties: {
      upcoming: parties.filter((booking) => upcoming.some((upcomingBooking) => upcomingBooking.id === booking.id)),
      past: parties.filter((booking) => past.some((pastBooking) => pastBooking.id === booking.id)),
    },
  };
}

async function buildWaiverPdfUrl(supabase: ReturnType<typeof createClient>, waiverId: string) {
  try {
    const { data: pdfPath, error: pathError } = await supabase.rpc("waivers_get_waiver_pdf_url", {
      waiver_uuid: waiverId,
    });

    if (pathError || !pdfPath) return null;

    const { data, error } = await supabase.storage.from("waivers").createSignedUrl(String(pdfPath), 3600);
    if (error) return null;
    return data?.signedUrl || null;
  } catch (_error) {
    return null;
  }
}

async function loadWaivers(
  supabase: ReturnType<typeof createClient>,
  customerId: string,
  businessId: string,
  businessDefaultExpiryDays: number | null,
) {
  const { data, error } = await supabase
    .from("waiver_signatures")
    .select(`
      id,
      template_id,
      first_name,
      last_name,
      email,
      phone_number,
      date_of_birth,
      signed_at,
      expires_at,
      is_valid,
      waiver_templates:template_id (
        expiry_days
      ),
      waiver_participants (
        id,
        first_name,
        last_name,
        participant_type,
        email,
        phone_number,
        date_of_birth
      )
    `)
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .order("signed_at", { ascending: false, nullsFirst: false })
    .limit(100);

  if (error) throw error;

  return await Promise.all(
    (data || []).map(async (waiver: any) => ({
      id: waiver.id,
      signedAt: waiver.signed_at,
      expiresAt: waiver.expires_at,
      effectiveExpiresAt: computeEffectiveExpiresAtIso(waiver, businessDefaultExpiryDays),
      isValid: waiver.is_valid,
      firstName: waiver.first_name,
      lastName: waiver.last_name,
      dateOfBirth: waiver.date_of_birth,
      email: waiver.email,
      phoneNumber: waiver.phone_number,
      attachedPeople: waiver.waiver_participants || [],
      pdfUrl: await buildWaiverPdfUrl(supabase, waiver.id),
    }))
  );
}

function buildNotifications(bookings: any, waivers: any[], attachedPeople: any[]) {
  const notifications: Array<Record<string, unknown>> = [];

  if (waivers.length === 0) {
    notifications.push({
      id: "waiver-needed",
      title: "Complete your waiver",
      description: "No completed waiver was found for this account yet.",
      category: "waivers",
      href: "waivers",
    });
  }

  bookings.upcoming.forEach((booking: any) => {
    if (booking.missingWaiverCount > 0) {
      notifications.push({
        id: `booking-waiver-${booking.id}`,
        title: "Waiver still needed",
        description: `${booking.missingWaiverCount} participant(s) still need a waiver for ${booking.activityName}.`,
        category: "bookings",
        href: "waivers",
      });
    }
  });

  if (attachedPeople.length === 0) {
    notifications.push({
      id: "no-attached-people",
      title: "Add people to your account",
      description: "Add family members or participants so their waivers and bookings stay linked together.",
      category: "account",
      href: "account",
    });
  }

  notifications.push({
    id: "party-paperwork-placeholder",
    title: "Party paperwork area ready",
    description: "Party planning and paperwork can live under Parties as that workflow is expanded.",
    category: "parties",
    href: "parties",
  });

  return notifications;
}

async function loadPortalPayload(supabase: ReturnType<typeof createClient>, customer: any) {
  const attachedPeople = await loadAttachedPeople(supabase, customer.id, customer.business_id);
  const bookings = await loadBookings(supabase, customer.id, customer.business_id);
  const businessDefaultExpiryDays = await loadBusinessDefaultExpiryDays(supabase, customer.business_id);
  const waivers = await loadWaivers(supabase, customer.id, customer.business_id, businessDefaultExpiryDays);
  const notifications = buildNotifications(bookings, waivers, attachedPeople);

  return {
    customer,
    bookings,
    waivers,
    account: {
      attachedPeople,
      customer,
    },
    parties: bookings.parties,
    notifications,
    dashboard: {
      cards: [
        { id: "bookings", title: "Bookings", description: "Create a new booking and review all past and upcoming bookings.", count: bookings.upcoming.length + bookings.past.length },
        { id: "waivers", title: "Waivers", description: "Download signed waivers, complete new waivers, and view who is attached.", count: waivers.length },
        { id: "account", title: "Account", description: "Update your information and review the people linked to your account.", count: attachedPeople.length + 1 },
        { id: "parties", title: "Parties", description: "See party-related bookings and get ready for party planning details.", count: bookings.parties.upcoming.length + bookings.parties.past.length },
        { id: "notifications", title: "Notifications", description: "Review anything that still needs your attention.", count: notifications.length },
      ],
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "load");
    const businessId = String(body.businessId || "");
    const customerId = String(body.customerId || "");
    const phone = normalizePhone(body.phone);

    if (!businessId || !customerId || !phone) {
      return jsonResponse({ error: "Missing businessId, customerId, or phone" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const customer = await validateCustomer(supabase, businessId, customerId, phone);
    if (!customer) {
      return jsonResponse({ error: "Customer portal session is invalid" }, 403);
    }

    if (action === "updateAccount") {
      const nextName = String(body.customerName || customer.customer_name || "").trim();
      const nextEmail = String(body.customerEmail || customer.customer_email || "").trim() || null;
      const nextPhoneRaw = String(body.customerPhone || customer.customer_phone || "");
      const nextPhone = normalizePhone(nextPhoneRaw);

      if (!nextName) {
        return jsonResponse({ error: "Customer name is required" }, 400);
      }
      if (!nextPhone || nextPhone.length < 10) {
        return jsonResponse({ error: "A valid phone number is required" }, 400);
      }

      const { data: updatedCustomer, error: updateError } = await supabase
        .from("pos_loyalty_accounts")
        .update({
          customer_name: nextName,
          customer_email: nextEmail,
          customer_phone: nextPhone,
          updated_at: new Date().toISOString(),
        })
        .eq("id", customer.id)
        .eq("business_id", businessId)
        .select("id, business_id, customer_name, customer_email, customer_phone, is_active, created_at, updated_at")
        .single();

      if (updateError || !updatedCustomer) {
        return jsonResponse({ error: updateError?.message || "Failed to update account" }, 500);
      }

      const payload = await loadPortalPayload(supabase, updatedCustomer);
      return jsonResponse(payload);
    }

    if (action === "addParticipant") {
      const firstName = String(body.firstName || body.first_name || "").trim();
      const lastName = String(body.lastName || body.last_name || "").trim();
      const dateOfBirth = String(body.dateOfBirth || body.date_of_birth || "").trim() || null;
      const participantType = String(
        body.participantType || body.participant_type || "minor",
      ).trim();

      if (!firstName || !lastName) {
        return jsonResponse({ error: "firstName and lastName are required" }, 400);
      }

      const { error: rpcError } = await supabase.rpc("bookings_add_portal_participant", {
        p_customer_id: customer.id,
        p_business_id: businessId,
        p_first_name: firstName,
        p_last_name: lastName,
        p_date_of_birth: dateOfBirth,
        p_participant_type: participantType,
      });

      if (rpcError) {
        return jsonResponse({ error: rpcError.message }, 400);
      }

      const payload = await loadPortalPayload(supabase, customer);
      return jsonResponse(payload);
    }

    const payload = await loadPortalPayload(supabase, customer);
    return jsonResponse(payload);
  } catch (error) {
    console.error("[customer-portal-data]", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Server error" },
      500,
    );
  }
});
