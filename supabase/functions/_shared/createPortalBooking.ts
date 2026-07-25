import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrCreateBookingSelfServiceToken } from "./bookingSelfService.ts";
import { applySaleStockAdjustments } from "./posInventoryStock.ts";
import { resolveBookingCustomerParticipantId } from "./resolveBookingCustomerParticipant.ts";
import { assertUniqueBookingParticipantIdentities } from "./assertUniqueBookingParticipants.ts";
import { syncBookingResourcesFromActivitySchedule, assertScheduleResourcesAvailableForSlot } from "./bookingScheduleResources.ts";
import { assertBookingWithinBusinessHours } from "./businessHoursValidation.ts";
import { releaseBookingSlotHoldByToken, validateBookingSlotHold } from "./bookingSlotHolds.ts";
import { insertBookingHistory } from "./bookingHistoryLog.ts";
import { activityUsesPendingTermsOnBooking } from "./bookingTermsAcknowledgment.ts";

type SupabaseClient = ReturnType<typeof createClient>;

const nowIso = () => new Date().toISOString();

export type PortalBookingCreateInput = {
  businessId: string;
  activityId: string;
  customerId: string | null;
  bookingDate: string;
  bookingTime: string;
  participantRows: Record<string, unknown>[];
  addonRows: Record<string, unknown>[];
  orderTotal: number;
  taxAmount: number;
  requiresApproval: boolean;
  status?: string;
  clientIp?: string | null;
  slotHoldToken?: string | null;
};

export type PortalBookingCreateResult =
  | {
      ok: true;
      bookingId: string;
      manageToken: string;
      bookingNumber: string | null;
      termsAckToken: string | null;
    }
  | { ok: false; status: number; message: string };

async function insertPortalAddons(
  supabase: SupabaseClient,
  bookingId: string,
  businessId: string,
  activityId: string,
  addonRows: Record<string, unknown>[],
) {
  const resolvedAddonItems = [];
  for (const rowRaw of addonRows) {
    const row = rowRaw as Record<string, unknown>;
    const optionName = typeof row?.name === "string" && row.name.trim() ? row.name.trim() : "Add-on";
    const quantity = Math.max(1, Number.parseInt(String(row?.quantity ?? 1), 10) || 1);
    const unitPrice = Math.max(0, Number.parseFloat(String(row?.unit_price ?? 0)) || 0);
    const addonKey = `portal-${bookingId}-${String(row?.option_id || Date.now())}`;

    const { data: createdAddon, error: createdAddonError } = await supabase
      .from("booking_addons")
      .insert({
        business_id: businessId,
        addon_name: optionName,
        addon_key: addonKey,
        description: "Customer portal option",
        price: unitPrice,
        is_global: false,
        activity_ids: activityId ? [activityId] : null,
        inventory_tracked: false,
        current_stock: null,
        is_active: false,
      })
      .select("id")
      .single();

    if (createdAddonError || !createdAddon?.id) continue;

    resolvedAddonItems.push({
      booking_id: bookingId,
      addon_id: createdAddon.id,
      quantity,
      unit_price: unitPrice,
    });
  }

  if (resolvedAddonItems.length > 0) {
    const { error: addonItemsError } = await supabase.from("booking_addon_items").insert(resolvedAddonItems);
    if (addonItemsError) throw addonItemsError;

    const stockLines = addonRows
      .map((rowRaw) => {
        const row = rowRaw as Record<string, unknown>;
        const inventoryId = String(row?.inventory_item_id || "").trim();
        const quantity = Math.max(1, Number.parseInt(String(row?.quantity ?? 1), 10) || 1);
        return inventoryId ? { inventoryId, quantity } : null;
      })
      .filter(Boolean);

    if (stockLines.length > 0) {
      try {
        await applySaleStockAdjustments(supabase, businessId, stockLines);
      } catch (stockError) {
        console.warn("[createPortalBooking] stock adjustment failed:", stockError);
      }
    }
  }
}

async function insertPortalParticipants(
  supabase: SupabaseClient,
  bookingId: string,
  businessId: string,
  customerId: string | null,
  participantRows: Record<string, unknown>[],
) {
  const requestedWaiverIds = Array.from(
    new Set(
      participantRows
        .map((row) =>
          typeof row?.waiver_id === "string" && row.waiver_id.trim() ? row.waiver_id.trim() : null,
        )
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const verifiedWaiverStatus = new Map<string, "valid" | "expired" | "missing">();
  if (requestedWaiverIds.length > 0) {
    const { data: waiverRows } = await supabase
      .from("waiver_signatures")
      .select("id, is_valid, expires_at")
      .eq("business_id", businessId)
      .in("id", requestedWaiverIds);

    const nowMs = Date.now();
    const waiverById = new Map((waiverRows || []).map((row) => [row.id, row]));
    for (const waiverId of requestedWaiverIds) {
      const waiver = waiverById.get(waiverId);
      const isExpired =
        typeof waiver?.expires_at === "string" && waiver.expires_at.trim()
          ? new Date(waiver.expires_at).getTime() <= nowMs
          : false;
      verifiedWaiverStatus.set(
        waiverId,
        !waiver ? "missing" : waiver.is_valid !== true || isExpired ? "expired" : "valid",
      );
    }
  }

  const rows = [];
  for (const row of participantRows) {
    const requestedWaiverId =
      typeof row?.waiver_id === "string" && row.waiver_id.trim() ? row.waiver_id.trim() : null;
    const waiverStatus = requestedWaiverId
      ? verifiedWaiverStatus.get(requestedWaiverId) || "missing"
      : "missing";
    const partyRole =
      typeof row?.party_role === "string" && row.party_role.trim() ? row.party_role.trim() : null;
    const participantId = await resolveBookingCustomerParticipantId(
      supabase,
      businessId,
      customerId,
      row,
    );

    const waiverParticipantIdRaw =
      typeof row?.waiver_participant_id === "string" && row.waiver_participant_id.trim()
        ? row.waiver_participant_id.trim()
        : null;

    rows.push({
      booking_id: bookingId,
      participant_id: participantId,
      waiver_participant_id: waiverParticipantIdRaw,
      inventory_item_id: row?.inventory_item_id ?? null,
      party_role: partyRole,
      waiver_id: waiverStatus === "valid" ? requestedWaiverId : null,
      waiver_status: waiverStatus,
      camper_registration_document_id:
        typeof row?.camper_registration_document_id === "string" && row.camper_registration_document_id.trim()
          ? row.camper_registration_document_id.trim()
          : null,
      camper_registration_status:
        typeof row?.camper_registration_status === "string" && row.camper_registration_status.trim()
          ? row.camper_registration_status.trim()
          : "not_required",
      created_at: nowIso(),
    });
  }

  const uniqueCheck = assertUniqueBookingParticipantIdentities(rows);
  if (!uniqueCheck.ok) {
    throw new Error(uniqueCheck.message);
  }

  const { error: participantError } = await supabase.from("booking_participants").insert(rows);
  if (participantError) throw participantError;
}

export async function createPortalBooking(
  supabase: SupabaseClient,
  input: PortalBookingCreateInput,
): Promise<PortalBookingCreateResult> {
  const {
    businessId,
    activityId,
    customerId,
    bookingDate,
    bookingTime,
    participantRows,
    addonRows,
    orderTotal,
    taxAmount,
    requiresApproval,
    status = requiresApproval ? "pending" : "confirmed",
    clientIp = null,
    slotHoldToken = null,
  } = input;

  const holdCheck = await validateBookingSlotHold(supabase, {
    holdToken: slotHoldToken,
    businessId,
    activityId,
    bookingDate,
    bookingTime,
  });
  if (!holdCheck.ok) {
    return { ok: false, status: 409, message: holdCheck.message };
  }

  const { data: activityRow, error: activityLoadError } = await supabase
    .from("booking_activities")
    .select("type_id, duration_minutes, terms_package_id, terms_show_on_confirmation")
    .eq("id", activityId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (activityLoadError || !activityRow) {
    return { ok: false, status: 400, message: "Booking activity not found." };
  }

  const attachPendingTerms = activityUsesPendingTermsOnBooking(activityRow);

  const termsPackageId = attachPendingTerms
    ? String((activityRow as { terms_package_id?: string | null }).terms_package_id)
    : null;
  const termsAckToken = termsPackageId
    ? crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "")
    : null;

  const durationMinutes = Number(activityRow.duration_minutes) > 0
    ? Number(activityRow.duration_minutes)
    : 60;

  const hoursCheck = await assertBookingWithinBusinessHours(
    supabase,
    businessId,
    bookingDate,
    bookingTime,
    durationMinutes,
  );
  if (!hoursCheck.ok) {
    return { ok: false, status: 400, message: hoursCheck.message };
  }

  const resourceCheck = await assertScheduleResourcesAvailableForSlot(supabase, {
    businessId,
    activityId,
    bookingDate,
    bookingTime,
    durationMinutes,
  });
  if (!resourceCheck.ok) {
    return {
      ok: false,
      status: 409,
      message:
        resourceCheck.message ||
        "Required party room(s) are not available for this time. Please choose another time.",
    };
  }

  const [{ data: sessionRow }, { data: loyaltyRow }] = await Promise.all([
    supabase
      .from("booking_sessions")
      .select("id")
      .eq("activity_id", activityId)
      .eq("session_date", bookingDate)
      .eq("start_time", bookingTime)
      .maybeSingle(),
    customerId
      ? supabase
          .from("pos_loyalty_accounts")
          .select("customer_email, customer_phone")
          .eq("id", customerId)
          .eq("business_id", businessId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const { data: bookingNumber, error: bookingNumberError } = await supabase.rpc("generate_booking_number", {
    business_uuid: businessId,
  });

  if (bookingNumberError) {
    return { ok: false, status: 500, message: "Failed to generate booking number" };
  }

  const bookingInsert = {
    business_id: businessId,
    activity_id: activityId,
    booking_type_id: activityRow?.type_id ?? null,
    session_id: sessionRow?.id ?? null,
    customer_id: customerId,
    customer_email: loyaltyRow?.customer_email ?? null,
    customer_phone: loyaltyRow?.customer_phone ?? null,
    booking_date: bookingDate,
    booking_time: bookingTime,
    booking_number: typeof bookingNumber === "string" ? bookingNumber : null,
    status,
    payment_status: "unpaid",
    source: "web",
    requires_approval: requiresApproval,
    order_total: Math.round(Math.max(0, orderTotal) * 100) / 100,
    tax_amount: Math.round(Math.max(0, taxAmount) * 100) / 100,
    terms_package_id: termsPackageId,
    terms_status: termsPackageId ? "pending" : "not_required",
    terms_ack_token: termsAckToken,
    created_ip: clientIp ? String(clientIp).trim() : null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .insert(bookingInsert)
    .select("id, booking_number")
    .single();

  if (bookingError || !booking?.id) {
    console.error("[createPortalBooking] insert failed:", bookingError);
    return { ok: false, status: 500, message: "Failed to create booking" };
  }

  try {
    if (participantRows.length > 0) {
      await insertPortalParticipants(supabase, booking.id, businessId, customerId, participantRows);
    }
    if (addonRows.length > 0) {
      await insertPortalAddons(supabase, booking.id, businessId, activityId, addonRows);
    }
    await syncBookingResourcesFromActivitySchedule(supabase, {
      businessId,
      activityId,
      bookingId: booking.id,
      bookingDate,
      bookingTime,
    });
    await supabase.rpc("generate_booking_qr_code", { booking_uuid: booking.id });
  } catch (error) {
    console.error("[createPortalBooking] downstream failed:", error);
    await supabase.from("bookings").delete().eq("id", booking.id);
    const detail =
      error && typeof error === "object" && "message" in error
        ? String((error as { message?: string }).message || "")
        : error instanceof Error
        ? error.message
        : "";
    const isDuplicate =
      /different person|unnamed seats|same participant|same waiver participant|same name/i.test(detail);
    return {
      ok: false,
      status: isDuplicate ? 400 : 500,
      message: detail
        ? (isDuplicate ? detail : `Failed to save booking details: ${detail}`)
        : "Failed to save booking details",
    };
  }

  const manageToken = await getOrCreateBookingSelfServiceToken(supabase, booking.id, businessId);

  await releaseBookingSlotHoldByToken(supabase, slotHoldToken);

  await insertBookingHistory(supabase, {
    businessId,
    bookingId: booking.id,
    actionType: requiresApproval ? "booking.request_submitted" : "booking.created",
    summary: requiresApproval ? "Booking request submitted" : "Online booking created",
    details: {
      actor_label: "Customer",
      source: "web",
      changes: [
        { field: "Booking number", from: null, to: booking.booking_number },
        { field: "Date", from: null, to: bookingDate },
        { field: "Time", from: null, to: bookingTime },
        { field: "Status", from: null, to: status },
        ...(termsPackageId
          ? [{ field: "Terms & Conditions", from: null, to: "Pending signature" }]
          : []),
      ].filter((row) => row.to != null),
    },
    changedIp: clientIp ? String(clientIp).trim() : null,
  });

  return {
    ok: true,
    bookingId: booking.id,
    manageToken,
    bookingNumber: booking.booking_number ?? null,
    termsAckToken: termsAckToken || null,
  };
}
