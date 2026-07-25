// Public party guest list API — OTP auth, CRUD, waiver matching (OTWK website + host portal).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createPartyGuestListSessionToken,
  extractBearerToken,
  normalizePhone,
  verifyPartyGuestListSessionToken,
} from "../_shared/customerAppSession.ts";
import {
  buildGuestListSettingsSnapshot,
  buildResourceLabelFromAssignments,
  computeDisplaySortOrder,
  computeGuestListWarnings,
  deriveRoleTag,
  DEFAULT_PARTY_GUEST_OVERAGE_FOOD,
  DEFAULT_PARTY_GUEST_OVERAGE_PAYMENT,
  DEFAULT_PARTY_GUEST_OVERAGE_SOCKS,
  isValidPartyGuestOverageFood,
  isValidPartyGuestOverageSocks,
  loadPartyGuestOveragePricing,
  loadWaiverParticipants,
  matchGuestToWaiver,
  normalizeGuestPhone,
  resolvePartyGuestOverageFood,
  resolvePartyGuestOveragePayment,
  resolvePartyGuestOverageSocks,
  searchWaiversByPhone,
  type GuestEntryInput,
} from "../_shared/partyGuestList.ts";
import { syncGuestListFromBookingParticipants, enrichPartyPickerBookings, syncGuestListPartyDateFromBooking } from "../_shared/partyGuestListBookingSync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-party-guest-session",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function resolveHostPortalUrl(businessId: string) {
  const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://www.tavarios.ca").replace(/\/$/, "");
  return `${siteUrl}/customer-portal/${businessId}/party-guest-list`;
}

function resolveRequestParams(req: Request, body: Record<string, unknown>) {
  const url = new URL(req.url);
  const businessId = String(
    body.businessId
      ?? body.business_id
      ?? url.searchParams.get("businessId")
      ?? url.searchParams.get("business_id")
      ?? "",
  ).trim();
  const action = String(body.action ?? url.searchParams.get("action") ?? "").trim();
  return { businessId, action };
}

function maskEmail(email: string) {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 1) return "***@***";
  return `${trimmed[0]}***@${trimmed.slice(at + 1)}`;
}

async function sendOtpEmail(
  businessId: string,
  email: string,
  otpCode: string,
  phone: string,
) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: business } = await supabase.from("businesses").select("name").eq("id", businessId).maybeSingle();
  const businessName = String(business?.name || "Off The Wall Kids").trim();
  const subject = `Your party guest list code - ${businessName}`;
  const text = `Your verification code is: ${otpCode}\n\nExpires in 10 minutes.\n\n${businessName}`;
  const html = `<p>Your verification code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${otpCode}</p><p style="font-size:12px;color:#666">Expires in 10 minutes.</p>`;

  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || ""}`,
    },
    body: JSON.stringify({
      businessId,
      campaignId: `party-guest-otp-${phone}-${Date.now()}`,
      emailType: "transactional",
      to: email,
      fromEmail: "noreply@tavarios.ca",
      fromName: `${businessName} - Party Guest List`,
      subject,
      html,
      text,
    }),
  });
}

async function resolveOtpEmail(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  phone: string,
  providedEmail?: string,
) {
  const trimmed = String(providedEmail || "").trim();
  if (trimmed) return { email: trimmed, customerId: null as string | null };

  const { data: customerRows } = await supabase.rpc("bookings_get_portal_customer_by_phone", {
    p_business_id: businessId,
    p_phone_number: phone,
  });
  const customer = Array.isArray(customerRows) ? customerRows[0] : customerRows;
  const customerEmail = String(customer?.customer_email || "").trim();
  if (customerEmail) {
    return { email: customerEmail, customerId: String(customer?.id || "") || null };
  }

  const waivers = await searchWaiversByPhone(supabase, businessId, phone);
  for (const w of waivers) {
    const { data: sig } = await supabase
      .from("waiver_signatures")
      .select("email")
      .eq("id", w.id)
      .maybeSingle();
    const email = String(sig?.email || "").trim();
    if (email) return { email, customerId: null };
  }

  return { email: null, customerId: null };
}

async function loadSettings(supabase: ReturnType<typeof createClient>, businessId: string) {
  const { data } = await supabase
    .from("party_guest_list_settings")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();
  return data || {
    edit_deadline_days_before_party: 7,
    default_included_kids: 12,
    default_included_adults: 12,
    kids_chair_limit_per_room: 18,
    one_adult_per_child_enabled: false,
    post_deadline_contact_text: "",
    staff_notification_emails: [],
  };
}

function settingsSnapshot(settings: Record<string, unknown>) {
  return buildGuestListSettingsSnapshot(settings);
}

async function resolveSettingsSnapshotForGuestList(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  guestList: { booking_id?: string | null },
  settings?: Record<string, unknown>,
) {
  const businessSettings = settings || await loadSettings(supabase, businessId);
  let activity: {
    party_included_kids?: number | null;
    party_included_adults?: number | null;
    party_one_adult_per_child?: boolean | null;
  } | null = null;

  if (guestList.booking_id && UUID_RE.test(String(guestList.booking_id))) {
    const { data: booking } = await supabase
      .from("bookings")
      .select("activity_id")
      .eq("id", guestList.booking_id)
      .eq("business_id", businessId)
      .maybeSingle();

    if (booking?.activity_id) {
      const { data: activityRow } = await supabase
        .from("booking_activities")
        .select("party_included_kids, party_included_adults, party_one_adult_per_child")
        .eq("id", booking.activity_id)
        .eq("business_id", businessId)
        .maybeSingle();
      activity = activityRow;
    }
  }

  return buildGuestListSettingsSnapshot(businessSettings, activity);
}

function isPastEditDeadline(partyDate: string | null, deadlineDays: number) {
  if (!partyDate) return false;
  const d = new Date(`${partyDate}T12:00:00`);
  const deadline = new Date(d);
  deadline.setDate(deadline.getDate() - deadlineDays);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today > deadline;
}

async function getOrCreateGuestList(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  phone: string,
  bookingId?: string | null,
) {
  if (bookingId && UUID_RE.test(bookingId)) {
    const { data: existing } = await supabase
      .from("party_guest_lists")
      .select("*")
      .eq("business_id", businessId)
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (existing) {
      if (existing.booking_id) {
        const syncedDate = await syncGuestListPartyDateFromBooking(
          supabase,
          String(existing.id),
          String(existing.booking_id),
        );
        if (syncedDate) {
          return { ...existing, party_date: syncedDate };
        }
      }
      return existing;
    }

    const { data: booking } = await supabase
      .from("bookings")
      .select("id, booking_date, customer_id, activity_id")
      .eq("id", bookingId)
      .eq("business_id", businessId)
      .maybeSingle();

    const settings = await loadSettings(supabase, businessId);
    let activity = null;
    if (booking?.activity_id) {
      const { data: activityRow } = await supabase
        .from("booking_activities")
        .select("party_included_kids, party_included_adults, party_one_adult_per_child")
        .eq("id", booking.activity_id)
        .eq("business_id", businessId)
        .maybeSingle();
      activity = activityRow;
    }
    const { data: created, error } = await supabase
      .from("party_guest_lists")
      .insert({
        business_id: businessId,
        booking_id: bookingId,
        booker_phone: phone,
        booker_customer_id: booking?.customer_id || null,
        party_date: booking?.booking_date || null,
        overage_payment: DEFAULT_PARTY_GUEST_OVERAGE_PAYMENT,
        overage_food: DEFAULT_PARTY_GUEST_OVERAGE_FOOD,
        overage_socks: DEFAULT_PARTY_GUEST_OVERAGE_SOCKS,
        settings_snapshot: buildGuestListSettingsSnapshot(settings, activity),
      })
      .select("*")
      .single();
    if (error) throw error;
    return created;
  }

  const { data: phoneLists } = await supabase
    .from("party_guest_lists")
    .select("*")
    .eq("business_id", businessId)
    .eq("booker_phone", phone)
    .is("booking_id", null)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (phoneLists?.[0]) return phoneLists[0];

  const settings = await loadSettings(supabase, businessId);
  const { data: created, error } = await supabase
    .from("party_guest_lists")
    .insert({
      business_id: businessId,
      booking_id: null,
      booker_phone: phone,
      overage_payment: DEFAULT_PARTY_GUEST_OVERAGE_PAYMENT,
      overage_food: DEFAULT_PARTY_GUEST_OVERAGE_FOOD,
      overage_socks: DEFAULT_PARTY_GUEST_OVERAGE_SOCKS,
      settings_snapshot: settingsSnapshot(settings),
    })
    .select("*")
    .single();
  if (error) throw error;
  return created;
}

async function enrichEntriesWithWaivers(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  entries: Array<Record<string, unknown>>,
) {
  const phoneSet = new Set<string>();
  for (const e of entries) {
    const p = normalizeGuestPhone(e.household_phone);
    if (p.length >= 10) phoneSet.add(p);
  }

  const waiverCache = new Map<string, Awaited<ReturnType<typeof searchWaiversByPhone>>>();
  const participantCache = new Map<string, Awaited<ReturnType<typeof loadWaiverParticipants>>>();

  for (const phone of phoneSet) {
    const waivers = await searchWaiversByPhone(supabase, businessId, phone);
    waiverCache.set(phone, waivers);
    const ids = waivers.map((w) => w.id);
    participantCache.set(phone, await loadWaiverParticipants(supabase, ids));
  }

  return entries.map((raw) => {
    const phone = normalizeGuestPhone(raw.household_phone);
    const waivers = waiverCache.get(phone) || [];
    const participantsByWaiver = participantCache.get(phone) || new Map();
    const match = matchGuestToWaiver(
      {
        first_name: String(raw.first_name || ""),
        last_name: String(raw.last_name || ""),
        guest_type: String(raw.guest_type || "child"),
      },
      waivers,
      participantsByWaiver,
    );
    return { ...raw, ...match };
  });
}

async function notifyStaff(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  guestListId: string,
  subject: string,
  body: string,
) {
  const settings = await loadSettings(supabase, businessId);
  const emails = (settings.staff_notification_emails || []) as string[];
  if (!emails.length) return;

  for (const to of emails) {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mail-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || ""}`,
      },
      body: JSON.stringify({
        businessId,
        campaignId: `party-guest-staff-${guestListId}-${Date.now()}`,
        emailType: "transactional",
        to,
        fromEmail: "noreply@tavarios.ca",
        fromName: "Tavari Party Guest List",
        subject,
        html: `<p>${body.replace(/\n/g, "<br>")}</p>`,
        text: body,
      }),
    });
  }
}

async function sendExpiredWaiverEmail(
  businessId: string,
  email: string,
  guestName: string,
  waiverUrl: string,
) {
  const subject = "Your waiver is expired — party RSVP";
  const text = `Hi ${guestName},\n\nYou RSVP'd to a party, but your waiver is expired.\n\nPlease update your waiver here:\n${waiverUrl}\n\nThank you!`;
  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || ""}`,
    },
    body: JSON.stringify({
      businessId,
      campaignId: `party-guest-expired-waiver-${Date.now()}`,
      emailType: "transactional",
      to: email,
      fromEmail: "noreply@tavarios.ca",
      fromName: "Off The Wall Kids",
      subject,
      html: `<p>Hi ${guestName},</p><p>You RSVP'd to a party, but your waiver is expired.</p><p><a href="${waiverUrl}">Click here to update your waiver</a></p>`,
      text,
    }),
  });
}

async function buildListPayload(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  guestList: Record<string, unknown>,
) {
  const settings = await loadSettings(supabase, businessId);
  let effectiveGuestList = guestList;

  if (guestList.booking_id && UUID_RE.test(String(guestList.booking_id))) {
    const syncedDate = await syncGuestListPartyDateFromBooking(
      supabase,
      String(guestList.id),
      String(guestList.booking_id),
    );
    if (syncedDate) {
      effectiveGuestList = { ...guestList, party_date: syncedDate };
    }

    await syncGuestListFromBookingParticipants(
      supabase,
      businessId,
      String(guestList.id),
      String(guestList.booking_id),
      String(guestList.booker_phone || ""),
    );
  }

  const snapshot = await resolveSettingsSnapshotForGuestList(
    supabase,
    businessId,
    effectiveGuestList,
    settings,
  );

  const { data: entries } = await supabase
    .from("party_guest_entries")
    .select("*")
    .eq("guest_list_id", effectiveGuestList.id)
    .order("display_sort_order", { ascending: true })
    .order("sort_order", { ascending: true });

  const enriched = await enrichEntriesWithWaivers(supabase, businessId, entries || []);
  const warnings = computeGuestListWarnings(enriched, snapshot);
  const overagePricing = await loadPartyGuestOveragePricing(supabase, businessId, settings);

  const deadlineDays = Number(snapshot.editDeadlineDays) || Number(settings.edit_deadline_days_before_party) || 7;
  const locked = isPastEditDeadline(String(effectiveGuestList.party_date || ""), deadlineDays)
    || effectiveGuestList.status === "locked";

  let guestListForReturn: Record<string, unknown> = effectiveGuestList;
  if (effectiveGuestList.booking_id && UUID_RE.test(String(effectiveGuestList.booking_id))) {
    const { data: bookingDetails } = await supabase
      .from("bookings")
      .select(`
        id,
        booking_number,
        booking_date,
        booking_time,
        booking_end_time,
        duration_minutes,
        customer_phone,
        booking_resource_assignments ( category_id, resource_id ),
        booking_activities ( activity_name )
      `)
      .eq("id", effectiveGuestList.booking_id)
      .eq("business_id", businessId)
      .maybeSingle();

    const { data: resourceSetting } = await supabase
      .from("booking_settings")
      .select("setting_value")
      .eq("business_id", businessId)
      .eq("setting_key", "booking_resources")
      .is("activity_id", null)
      .eq("is_global", true)
      .maybeSingle();

    const resourceCatalog = Array.isArray(resourceSetting?.setting_value)
      ? resourceSetting.setting_value
      : [];
    const resourceLabel = buildResourceLabelFromAssignments(
      (bookingDetails?.booking_resource_assignments || []) as Array<{ category_id?: string; resource_id?: string }>,
      resourceCatalog as Parameters<typeof buildResourceLabelFromAssignments>[1],
    );

    guestListForReturn = {
      ...effectiveGuestList,
      overage_payment: resolvePartyGuestOveragePayment(effectiveGuestList.overage_payment),
      overage_food: resolvePartyGuestOverageFood(effectiveGuestList.overage_food),
      overage_socks: resolvePartyGuestOverageSocks(effectiveGuestList.overage_socks),
      bookings: bookingDetails,
      resource_label: resourceLabel,
    };
  } else {
    guestListForReturn = {
      ...effectiveGuestList,
      overage_payment: resolvePartyGuestOveragePayment(effectiveGuestList.overage_payment),
      overage_food: resolvePartyGuestOverageFood(effectiveGuestList.overage_food),
      overage_socks: resolvePartyGuestOverageSocks(effectiveGuestList.overage_socks),
    };
  }

  return {
    guestList: guestListForReturn,
    entries: enriched,
    settings,
    warnings,
    overagePricing,
    locked,
    postDeadlineContact: settings.post_deadline_contact_text || "",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = req.method === "POST"
      ? await req.json().catch(() => ({})) as Record<string, unknown>
      : {};
    const { businessId, action } = resolveRequestParams(req, body);

    if (!UUID_RE.test(businessId)) {
      return json({ error: "Invalid businessId" }, 400);
    }

    if (!action) {
      return json({ error: "Missing action" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "getPortalInfo") {
      const settings = await loadSettings(supabase, businessId);
      const { data: business } = await supabase
        .from("businesses")
        .select("name")
        .eq("id", businessId)
        .maybeSingle();
      const websitePortalUrl = String(
        settings.website_portal_url
          ?? Deno.env.get("PARTY_GUEST_LIST_WEBSITE_URL")
          ?? "",
      ).trim() || null;

      return json({
        ok: true,
        businessId,
        businessName: String(business?.name || "").trim(),
        hostPortalUrl: resolveHostPortalUrl(businessId),
        websitePortalUrl,
        intro: String(settings.host_portal_intro || "").trim() || null,
        editDeadlineDaysBeforeParty: Number(settings.edit_deadline_days_before_party) || 7,
        postDeadlineContactText: String(settings.post_deadline_contact_text || "").trim(),
      });
    }

    if (req.method === "GET") {
      return json({ error: "GET supports action=getPortalInfo only" }, 405);
    }

    if (action === "sendOtp") {
      const phone = normalizePhone(body.phoneNumber ?? body.phone);
      if (phone.length < 10) return json({ error: "Invalid phone number" }, 400);

      const { email, customerId } = await resolveOtpEmail(
        supabase,
        businessId,
        phone,
        String(body.email || ""),
      );

      if (!email) {
        return json({
          ok: true,
          otpSent: false,
          requiresEmail: true,
          message: "Enter the email on your booking to receive a verification code.",
        });
      }

      const { data: otpCode, error: otpError } = await supabase.rpc("waivers_generate_otp", {
        p_business_id: businessId,
        p_phone_number: phone,
        p_email: email,
        p_customer_id: customerId && UUID_RE.test(customerId) ? customerId : null,
        p_ip_address: req.headers.get("x-forwarded-for") || "unknown",
        p_user_agent: "party-guest-list",
      });

      if (otpError) return json({ error: otpError.message }, 400);
      if (otpCode) await sendOtpEmail(businessId, email, String(otpCode), phone);

      return json({ ok: true, otpSent: true, maskedEmail: maskEmail(email) });
    }

    if (action === "verifyOtp") {
      const phone = normalizePhone(body.phoneNumber ?? body.phone);
      const otpCode = String(body.otpCode || body.otp || "").trim();
      if (phone.length < 10 || otpCode.length !== 6) {
        return json({ error: "Invalid phone or OTP" }, 400);
      }

      const { data: verifyResult, error: verifyError } = await supabase.rpc("waivers_verify_otp", {
        p_phone_number: phone,
        p_otp_code: otpCode,
        p_business_id: businessId,
      });

      if (verifyError) return json({ error: verifyError.message }, 400);
      if (!verifyResult?.valid) {
        return json({ error: verifyResult?.error || "Invalid code" }, 400);
      }

      const { data: bookings } = await supabase.rpc("party_guest_list_find_bookings_by_phone", {
        p_business_id: businessId,
        p_phone_number: phone,
      });

      const bookingList = await enrichPartyPickerBookings(
        supabase,
        (bookings || []) as Array<Record<string, unknown>>,
      );

      if (bookingList.length === 0) {
        const guestList = await getOrCreateGuestList(supabase, businessId, phone, null);
        const sessionToken = await createPartyGuestListSessionToken({
          businessId,
          phone,
          guestListId: String(guestList.id),
          bookingId: null,
        });
        const payload = await buildListPayload(supabase, businessId, guestList);
        return json({
          ok: true,
          sessionToken,
          bookingPickerRequired: false,
          bookings: [],
          ...payload,
        });
      }

      if (bookingList.length === 1) {
        const b = bookingList[0];
        const guestList = await getOrCreateGuestList(
          supabase,
          businessId,
          phone,
          String(b.booking_id),
        );
        const sessionToken = await createPartyGuestListSessionToken({
          businessId,
          phone,
          guestListId: String(guestList.id),
          bookingId: String(b.booking_id),
        });
        const payload = await buildListPayload(supabase, businessId, guestList);
        return json({
          ok: true,
          sessionToken,
          bookingPickerRequired: false,
          bookings: bookingList,
          ...payload,
        });
      }

      return json({
        ok: true,
        bookingPickerRequired: true,
        bookings: bookingList,
        pickerSessionPhone: phone,
      });
    }

    if (action === "selectBooking") {
      const phone = normalizePhone(body.phoneNumber ?? body.phone);
      const bookingId = String(body.bookingId || "").trim();
      const pickerToken = String(body.pickerToken || "").trim();

      if (phone.length < 10 || !UUID_RE.test(bookingId)) {
        return json({ error: "Invalid phone or booking" }, 400);
      }

      const guestList = await getOrCreateGuestList(supabase, businessId, phone, bookingId);
      const sessionToken = pickerToken || await createPartyGuestListSessionToken({
        businessId,
        phone,
        guestListId: String(guestList.id),
        bookingId,
      });
      const payload = await buildListPayload(supabase, businessId, guestList);
      return json({ ok: true, sessionToken, ...payload });
    }

    const sessionToken = String(
      body.sessionToken || extractBearerToken(req) || req.headers.get("x-party-guest-session") || "",
    ).trim();
    const session = await verifyPartyGuestListSessionToken(sessionToken);
    if (!session || session.businessId !== businessId) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { data: guestList, error: listError } = await supabase
      .from("party_guest_lists")
      .select("*")
      .eq("id", session.guestListId)
      .eq("business_id", businessId)
      .single();

    if (listError || !guestList) return json({ error: "Guest list not found" }, 404);

    let effectiveGuestList = guestList as Record<string, unknown>;
    if (guestList.booking_id && UUID_RE.test(String(guestList.booking_id))) {
      const syncedDate = await syncGuestListPartyDateFromBooking(
        supabase,
        String(guestList.id),
        String(guestList.booking_id),
      );
      if (syncedDate) {
        effectiveGuestList = { ...guestList, party_date: syncedDate };
      }
    }

    if (action === "getList") {
      const payload = await buildListPayload(supabase, businessId, effectiveGuestList);
      return json({ ok: true, sessionToken, ...payload });
    }

    const settings = await loadSettings(supabase, businessId);
    const deadlineDays = Number(settings.edit_deadline_days_before_party) || 7;
    const locked = isPastEditDeadline(String(effectiveGuestList.party_date || ""), deadlineDays)
      || effectiveGuestList.status === "locked";

    if (locked && action !== "getList") {
      return json({
        error: "Guest list is locked",
        locked: true,
        postDeadlineContact: settings.post_deadline_contact_text || "",
      }, 403);
    }

    if (action === "saveList" || action === "submitList") {
      const rawEntries = Array.isArray(body.entries) ? body.entries as GuestEntryInput[] : [];
      const overagePayment = String(body.overagePayment || body.overage_payment || "").trim();
      const overageFood = String(body.overageFood || body.overage_food || "").trim();
      const overageFoodOther = String(body.overageFoodOther || body.overage_food_other || "").trim();
      const overageSocks = String(body.overageSocks || body.overage_socks || "").trim();

      await supabase.from("party_guest_entries").delete().eq("guest_list_id", guestList.id);

      const rows = rawEntries.map((entry, index) => {
        const guestType = entry.guest_type === "adult" ? "adult" : "child";
        const isBirthdayChild = guestType === "child" && entry.is_birthday_child === true;
        const roleTag = deriveRoleTag({
          guest_type: guestType,
          is_birthday_child: isBirthdayChild,
        });
        const sortOrder = Number(entry.sort_order ?? index);
        return {
          guest_list_id: guestList.id,
          sort_order: sortOrder,
          display_sort_order: computeDisplaySortOrder({
            guest_type: guestType,
            is_birthday_child: isBirthdayChild,
            is_attending: entry.is_attending !== false,
            sort_order: sortOrder,
          }),
          guest_type: guestType,
          first_name: String(entry.first_name || "").trim(),
          last_name: String(entry.last_name || "").trim(),
          parent_last_name: String(entry.parent_last_name || "").trim() || null,
          household_phone: normalizeGuestPhone(entry.household_phone || session.phone),
          role_tag: roleTag,
          is_attending: entry.is_attending !== false,
          is_birthday_child: isBirthdayChild,
          source: entry.source || "host",
        };
      }).filter((r) => r.first_name && r.last_name);

      if (rows.length) {
        const enriched = await enrichEntriesWithWaivers(supabase, businessId, rows);
        const { error: insertError } = await supabase.from("party_guest_entries").insert(
          enriched.map((r) => ({
            guest_list_id: r.guest_list_id,
            sort_order: r.sort_order,
            display_sort_order: r.display_sort_order,
            guest_type: r.guest_type,
            first_name: r.first_name,
            last_name: r.last_name,
            parent_last_name: r.parent_last_name,
            household_phone: r.household_phone,
            role_tag: r.role_tag,
            is_attending: r.is_attending,
            is_birthday_child: r.is_birthday_child,
            waiver_signature_id: r.waiver_signature_id,
            waiver_status: r.waiver_status,
            source: r.source,
          })),
        );
        if (insertError) return json({ error: insertError.message }, 400);

        const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://tavarios.ca").replace(/\/$/, "");
        const waiverUrl = `${siteUrl}/waiver/${businessId}`;

        for (const row of enriched) {
          if (row.waiver_status !== "expired") continue;
          const phone = normalizeGuestPhone(row.household_phone);
          const waivers = await searchWaiversByPhone(supabase, businessId, phone);
          if (!waivers[0]?.id) continue;
          const { data: sig } = await supabase
            .from("waiver_signatures")
            .select("email")
            .eq("id", waivers[0].id)
            .maybeSingle();
          const email = String(sig?.email || "").trim();
          if (email) {
            await sendExpiredWaiverEmail(
              businessId,
              email,
              `${row.first_name} ${row.last_name}`.trim(),
              waiverUrl,
            );
          }
        }
      }

      const updatePayload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        settings_snapshot: await resolveSettingsSnapshotForGuestList(supabase, businessId, guestList, settings),
      };
      if (overagePayment === "host_bill" || overagePayment === "guest_at_gate") {
        updatePayload.overage_payment = overagePayment;
      }
      if (isValidPartyGuestOverageFood(overageFood)) {
        const resolvedFood = resolvePartyGuestOverageFood(overageFood);
        updatePayload.overage_food = resolvedFood;
        updatePayload.overage_food_other = resolvedFood === "other"
          ? (overageFoodOther || null)
          : null;
      } else if (body.overageFoodOther != null || body.overage_food_other != null) {
        updatePayload.overage_food_other = overageFoodOther || null;
      }
      if (isValidPartyGuestOverageSocks(overageSocks)) {
        updatePayload.overage_socks = resolvePartyGuestOverageSocks(overageSocks);
      }
      if (action === "submitList") {
        updatePayload.status = "submitted";
        updatePayload.submitted_at = new Date().toISOString();
      }

      const pastDeadline = isPastEditDeadline(String(guestList.party_date || ""), deadlineDays);
      if (pastDeadline) {
        updatePayload.last_host_edit_after_deadline_at = new Date().toISOString();
        await notifyStaff(
          supabase,
          businessId,
          String(guestList.id),
          "Party guest list updated after deadline",
          `A host updated the guest list after the edit deadline.\nList ID: ${guestList.id}\nPhone: ${session.phone}`,
        );
      }

      await supabase.from("party_guest_lists").update(updatePayload).eq("id", guestList.id);

      const refreshed = await buildListPayload(supabase, businessId, {
        ...guestList,
        ...updatePayload,
      });
      return json({ ok: true, sessionToken, ...refreshed });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("[tavari-api-party-guest-list]", e);
    return json({ error: e instanceof Error ? e.message : "Server error" }, 500);
  }
});
