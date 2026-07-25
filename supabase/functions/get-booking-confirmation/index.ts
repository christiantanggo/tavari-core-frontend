// Returns booking confirmation data for the success page. Uses service role so anon can view their booking.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildBookingManageUrl, resolveBookingSelfServiceToken } from "../_shared/bookingSelfService.ts";
import {
  bookingRequiresPartyTermsApprovalCta,
  activityShowsTermsOnConfirmation,
  buildBookingTermsAckUrl,
  ensureBookingTermsAckToken,
} from "../_shared/bookingTermsAcknowledgment.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

type PersonDetail = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone_number?: string | null;
  date_of_birth?: string | null;
  is_account_owner?: boolean | null;
};

const formatPersonName = (person: PersonDetail | null | undefined) =>
  person
    ? [person.first_name, person.last_name].filter(Boolean).join(" ").trim() || "—"
    : "—";

const ageYearsAt = (birthdate: string | null | undefined, refDate = new Date()) => {
  if (!birthdate) return null;
  const birth = new Date(birthdate);
  if (Number.isNaN(birth.getTime())) return null;
  let years = refDate.getFullYear() - birth.getFullYear();
  const monthDiff = refDate.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && refDate.getDate() < birth.getDate())) {
    years -= 1;
  }
  return years;
};

const inferPartyChildTargetAge = (activityName: string | null | undefined) => {
  const name = String(activityName || "");
  const paired = name.match(/\b(\d{1,2})\s*(?:&|and)\s*(\d{1,2})\b/i);
  if (paired) {
    const first = Number.parseInt(paired[1], 10);
    const second = Number.parseInt(paired[2], 10);
    if (Number.isFinite(first) && Number.isFinite(second)) {
      return Math.round((first + second) / 2);
    }
  }
  const ageMatch = name.match(/\bage\s*(\d{1,2})\b/i);
  if (ageMatch) {
    const parsed = Number.parseInt(ageMatch[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const pickLegacyPartyChild = (
  minors: PersonDetail[],
  targetAge: number | null,
  bookingDate: string | null | undefined,
) => {
  if (minors.length === 0) return null;
  if (minors.length === 1) return minors[0];

  const refDate = bookingDate ? new Date(bookingDate) : new Date();
  if (targetAge == null) {
    return [...minors].sort((a, b) => {
      const ageA = ageYearsAt(a.date_of_birth, refDate) ?? 999;
      const ageB = ageYearsAt(b.date_of_birth, refDate) ?? 999;
      return ageA - ageB;
    })[0];
  }

  return minors.reduce((best, candidate) => {
    const bestAge = ageYearsAt(best.date_of_birth, refDate);
    const candidateAge = ageYearsAt(candidate.date_of_birth, refDate);
    const bestDiff = bestAge == null ? 999 : Math.abs(bestAge - targetAge);
    const candidateDiff = candidateAge == null ? 999 : Math.abs(candidateAge - targetAge);
    return candidateDiff < bestDiff ? candidate : best;
  });
};

async function loadParticipantDetails(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  participantIds: string[],
): Promise<Map<string, PersonDetail>> {
  const map = new Map<string, PersonDetail>();
  if (participantIds.length === 0) return map;

  const { data } = await supabase
    .from("booking_customer_participants")
    .select("id, first_name, last_name, email, phone_number, date_of_birth")
    .eq("business_id", businessId)
    .in("id", participantIds);

  for (const row of data || []) {
    map.set(row.id, row);
  }
  return map;
}

async function loadWaiverParticipantDetails(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  waiverParticipantIds: string[],
): Promise<Map<string, PersonDetail>> {
  const map = new Map<string, PersonDetail>();
  if (waiverParticipantIds.length === 0) return map;

  const { data } = await supabase
    .from("waiver_participants")
    .select("id, first_name, last_name, date_of_birth, is_account_owner")
    .eq("business_id", businessId)
    .in("id", waiverParticipantIds);

  for (const row of data || []) {
    map.set(row.id, row);
  }
  return map;
}

async function loadWaiverRosterFallback(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  customerId: string | null,
): Promise<PersonDetail[]> {
  if (!customerId) return [];
  const { data } = await supabase
    .from("waiver_participants")
    .select("id, first_name, last_name, is_account_owner, date_of_birth")
    .eq("business_id", businessId)
    .eq("customer_id", customerId);
  return (data || []) as PersonDetail[];
}

async function loadBookingCustomerChildren(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  customerId: string | null,
): Promise<PersonDetail[]> {
  if (!customerId) return [];
  const { data } = await supabase
    .from("booking_customer_participants")
    .select("first_name, last_name, date_of_birth, is_account_owner")
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .eq("is_account_owner", false);
  return (data || []) as PersonDetail[];
}

async function loadCamperRegistrationDetails(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  camperDocIds: string[],
): Promise<Map<string, PersonDetail>> {
  const map = new Map<string, PersonDetail>();
  if (camperDocIds.length === 0) return map;

  const { data } = await supabase
    .from("camper_registration_documents")
    .select("id, first_name, last_name, date_of_birth")
    .eq("business_id", businessId)
    .in("id", camperDocIds);

  for (const row of data || []) {
    map.set(row.id, {
      first_name: row.first_name,
      last_name: row.last_name,
      date_of_birth: row.date_of_birth,
    });
  }
  return map;
}

async function loadLoyaltyBookerDetail(
  supabase: ReturnType<typeof createClient>,
  businessId: string,
  customerId: string | null,
): Promise<PersonDetail | null> {
  if (!customerId) return null;
  const { data } = await supabase
    .from("pos_loyalty_accounts")
    .select("customer_name, customer_email, customer_phone")
    .eq("id", customerId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!data) return null;
  const nameParts = String(data.customer_name || "").trim().split(/\s+/).filter(Boolean);
  return {
    first_name: nameParts[0] || null,
    last_name: nameParts.slice(1).join(" ") || null,
    email: data.customer_email,
    phone_number: data.customer_phone,
    is_account_owner: true,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const businessId = body?.businessId ?? body?.business_id;
    const bookingId = body?.bookingId ?? body?.booking_id;
    const token = String(body?.token || "").trim();
    if (!businessId || !bookingId || !token) {
      return new Response(
        JSON.stringify({ error: "Missing businessId, bookingId, or token" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const resolvedToken = await resolveBookingSelfServiceToken(supabase, token);
    if (!resolvedToken) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired booking token" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (resolvedToken.business_id !== businessId || resolvedToken.booking_id !== bookingId) {
      return new Response(
        JSON.stringify({ error: "Booking token does not match this booking" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select(
        "id, booking_number, customer_id, customer_email, customer_phone, business_id, activity_id, booking_type_id, booking_date, booking_time, status, terms_package_id, terms_status, terms_ack_token, terms_signed_at",
      )
      .eq("id", bookingId)
      .eq("business_id", businessId)
      .single();
    if (bookingErr || !booking) {
      return new Response(
        JSON.stringify({ error: "Booking not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const [businessRes, activityRes, participantsRes, paymentsRes] = await Promise.all([
      supabase.from("businesses").select("id, name, business_website").eq("id", businessId).single(),
      supabase
        .from("booking_activities")
        .select("id, activity_name, terms_show_on_confirmation")
        .eq("id", booking.activity_id)
        .single(),
      supabase
        .from("booking_participants")
        .select(
          "id, participant_id, waiver_participant_id, inventory_item_id, party_role, camper_registration_document_id",
        )
        .eq("booking_id", bookingId)
        .order("created_at"),
      supabase.from("booking_payments").select("id, amount_paid, payment_type, status").eq("booking_id", bookingId),
    ]);

    const termsRequired = bookingRequiresPartyTermsApprovalCta(
      booking,
      activityRes.data,
    );

    let termsAckToken = booking.terms_ack_token || null;
    if (termsRequired) {
      termsAckToken = await ensureBookingTermsAckToken(supabase, String(bookingId));
      booking.terms_ack_token = termsAckToken;
    }
    const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || Deno.env.get("SITE_URL") || "").replace(/\/$/, "");
    const termsAckUrl =
      termsRequired && termsAckToken
        ? buildBookingTermsAckUrl(String(businessId), termsAckToken, siteUrl || "")
        : null;
    // Prefer relative path when site URL is unset so the SPA can navigate locally.
    const termsAckPath =
      termsRequired && termsAckToken
        ? `/customer-portal/${businessId}/portal/booking-terms/${termsAckToken}`
        : null;

    const participants = participantsRes.data || [];
    const invIds = [...new Set(participants.map((p: { inventory_item_id?: string | null }) => p.inventory_item_id).filter(Boolean))];
    const inventoryMap: Record<string, string> = {};
    if (invIds.length > 0) {
      const { data: inv } = await supabase.from("pos_inventory").select("id, name").in("id", invIds);
      for (const item of inv || []) {
        inventoryMap[item.id] = item.name || "Ticket";
      }
    }

    const byItem: Record<string, { name: string; qty: number }> = {};
    for (const p of participants) {
      if (!p.inventory_item_id) continue;
      const key = p.inventory_item_id;
      if (!byItem[key]) {
        byItem[key] = { name: inventoryMap[p.inventory_item_id] || "Ticket", qty: 0 };
      }
      byItem[key].qty += 1;
    }
    const ticketSummary = Object.values(byItem);

    const participantIds = [
      ...new Set(participants.map((p: { participant_id?: string | null }) => p.participant_id).filter(Boolean)),
    ] as string[];
    const waiverParticipantIds = [
      ...new Set(participants.map((p: { waiver_participant_id?: string | null }) => p.waiver_participant_id).filter(Boolean)),
    ] as string[];

    const [participantDetails, waiverParticipantDetails] = await Promise.all([
      loadParticipantDetails(supabase, String(businessId), participantIds),
      loadWaiverParticipantDetails(supabase, String(businessId), waiverParticipantIds),
    ]);

    const partyHostRow = participants.find((p: { party_role?: string | null }) => p.party_role === "host_adult");
    const partyChildRow = participants.find((p: { party_role?: string | null }) => p.party_role === "birthday_child");
    const isPartyBooking = Boolean(partyHostRow || partyChildRow);

    let partyParentDetail: PersonDetail | null = null;
    if (partyHostRow?.participant_id) {
      partyParentDetail = participantDetails.get(partyHostRow.participant_id) || null;
    }
    if (!partyParentDetail && partyHostRow?.waiver_participant_id) {
      partyParentDetail = waiverParticipantDetails.get(partyHostRow.waiver_participant_id) || null;
    }

    let partyChildDetail: PersonDetail | null = null;
    if (partyChildRow?.participant_id) {
      partyChildDetail = participantDetails.get(partyChildRow.participant_id) || null;
    }
    if (!partyChildDetail && partyChildRow?.waiver_participant_id) {
      partyChildDetail = waiverParticipantDetails.get(partyChildRow.waiver_participant_id) || null;
    }

    if (isPartyBooking && booking.customer_id && (!partyParentDetail || !partyChildDetail)) {
      const [waiverRoster, bookingChildren] = await Promise.all([
        loadWaiverRosterFallback(supabase, String(businessId), booking.customer_id),
        loadBookingCustomerChildren(supabase, String(businessId), booking.customer_id),
      ]);

      if (!partyParentDetail) {
        partyParentDetail = waiverRoster.find((p) => p.is_account_owner === true) || null;
      }

      if (!partyChildDetail && partyChildRow) {
        const waiverMinors = waiverRoster.filter((p) => p.is_account_owner !== true);
        if (waiverMinors.length === 1) {
          partyChildDetail = waiverMinors[0];
        } else if (waiverMinors.length > 1) {
          const targetAge = inferPartyChildTargetAge(activityRes.data?.activity_name);
          partyChildDetail = pickLegacyPartyChild(
            waiverMinors,
            targetAge,
            booking.booking_date,
          );
        } else if (bookingChildren.length === 1) {
          partyChildDetail = bookingChildren[0];
        }
      }
    }

    const camperDocIds = [
      ...new Set(
        participants
          .map((p: { camper_registration_document_id?: string | null }) => p.camper_registration_document_id)
          .filter(Boolean),
      ),
    ] as string[];
    const [camperDetails, bookerDetail] = await Promise.all([
      loadCamperRegistrationDetails(supabase, String(businessId), camperDocIds),
      loadLoyaltyBookerDetail(supabase, String(businessId), booking.customer_id || null),
    ]);

    let participant1Detail: PersonDetail | null = null;
    const firstParticipant = participants[0];
    if (firstParticipant?.participant_id) {
      participant1Detail = participantDetails.get(firstParticipant.participant_id) || null;
    }
    if (!participant1Detail && firstParticipant?.waiver_participant_id) {
      participant1Detail = waiverParticipantDetails.get(firstParticipant.waiver_participant_id) || null;
    }
    if (!participant1Detail && firstParticipant?.camper_registration_document_id) {
      participant1Detail = camperDetails.get(firstParticipant.camper_registration_document_id) || null;
    }
    // Contact fields: prefer linked person, fill gaps from booker account.
    if (participant1Detail && bookerDetail) {
      participant1Detail = {
        ...participant1Detail,
        email: participant1Detail.email || bookerDetail.email || booking.customer_email,
        phone_number:
          participant1Detail.phone_number || bookerDetail.phone_number || booking.customer_phone,
      };
    } else if (!participant1Detail && bookerDetail) {
      participant1Detail = bookerDetail;
    }

    const payments = paymentsRes.data || [];
    const totalPaid = payments
      .filter((p: { status?: string | null }) => p.status === "completed")
      .reduce((sum: number, p: { amount_paid?: number | null }) => sum + Number(p.amount_paid || 0), 0);
    const manageUrl = buildBookingManageUrl(String(businessId), token);

    const payload = {
      booking,
      business: businessRes.data,
      activity: activityRes.data,
      participants,
      payments,
      ticketSummary,
      participant1Detail,
      isPartyBooking,
      partyParentName: formatPersonName(partyParentDetail),
      partyChildName: formatPersonName(partyChildDetail),
      totalPaid,
      totalPrice: null,
      balanceOwing: null,
      manageUrl,
      termsRequired,
      termsAckUrl: termsAckUrl || termsAckPath,
      termsAckPath,
      termsShowOnConfirmation: activityShowsTermsOnConfirmation(activityRes.data),
    };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[get-booking-confirmation]", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
