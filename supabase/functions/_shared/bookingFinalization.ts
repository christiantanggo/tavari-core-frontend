import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrCreateBookingSelfServiceToken } from "./bookingSelfService.ts";
import { applySaleStockAdjustments } from "./posInventoryStock.ts";
import { resolveBookingCustomerParticipantId } from "./resolveBookingCustomerParticipant.ts";
import { assertUniqueBookingParticipantIdentities } from "./assertUniqueBookingParticipants.ts";
import { syncBookingResourcesFromActivitySchedule } from "./bookingScheduleResources.ts";
import { assertBookingWithinBusinessHours } from "./businessHoursValidation.ts";
import { releaseBookingSlotHoldByToken, validateBookingSlotHold } from "./bookingSlotHolds.ts";
import { awardBookingLoyaltyPoints } from "./awardBookingLoyalty.ts";
import { insertBookingHistory } from "./bookingHistoryLog.ts";
import {
  activityShowsTermsOnConfirmation,
} from "./bookingTermsAcknowledgment.ts";
import { redeemGiftCardForBooking } from "./bookingGiftCards.ts";

type SupabaseClient = ReturnType<typeof createClient>;

type FinalizePendingBookingArgs = {
  supabase: SupabaseClient;
  pendingId: string;
  transactionId?: string | null;
  amount?: number | string | null;
  approvalCode?: string | null;
  customerCode?: string | null;
  /** Staff recovery: customer already paid; skip expired slot-hold gate. */
  recoverPaidCheckout?: boolean;
};

type FinalizePendingBookingResult =
  | { ok: true; bookingId: string; manageToken: string; alreadyCompleted?: boolean }
  | { ok: false; status: number; message: string };

const nowIso = () => new Date().toISOString();

const amountToNumber = (value: unknown) => {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Number(numeric) : 0;
};

async function sendBookingConfirmation(
  supabaseUrl: string,
  serviceRoleKey: string,
  businessId: string,
  bookingId: string,
) {
  try {
    const confirmRes = await fetch(`${supabaseUrl}/functions/v1/send-booking-confirmation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ bookingId, businessId }),
    });

    if (!confirmRes.ok) {
      const errText = await confirmRes.text();
      console.error("[bookingFinalization] send-booking-confirmation failed:", confirmRes.status, errText);
    }
  } catch (error) {
    console.error("[bookingFinalization] Exception sending booking confirmation:", error);
  }

  try {
    const guideRes = await fetch(`${supabaseUrl}/functions/v1/send-booking-camp-guide`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ bookingId, businessId }),
    });
    if (!guideRes.ok) {
      const errText = await guideRes.text();
      console.warn("[bookingFinalization] send-booking-camp-guide:", guideRes.status, errText);
    }
  } catch (error) {
    console.warn("[bookingFinalization] camp guide email skipped:", error);
  }
}

async function applyPendingTermsAcknowledgment(
  supabase: SupabaseClient,
  bookingId: string,
  businessId: string,
  activityTermsPackageId: string | null,
  termsAcknowledgment: unknown,
  showOnConfirmation: boolean = false,
) {
  if (!activityTermsPackageId) return;

  const usesConfirmationTermsFlow = showOnConfirmation === true;

  const ack = termsAcknowledgment && typeof termsAcknowledgment === "object"
    ? termsAcknowledgment as Record<string, unknown>
    : null;

  if (!ack) {
    // Post-booking Terms CTA only when the activity opts into confirmation-page T&Cs.
    if (!usesConfirmationTermsFlow) return;
    await supabase.from("bookings").update({
      terms_package_id: activityTermsPackageId,
      terms_status: "pending",
      updated_at: nowIso(),
    }).eq("id", bookingId);
    return;
  }

  const signerName = String(ack.signerName || ack.signer_name || "").trim();
  const signedAt = String(ack.signedAt || ack.signed_at || nowIso());
  const signatureData = ack.signatureData && typeof ack.signatureData === "object"
    ? ack.signatureData as Record<string, unknown>
    : null;
  const imageUrl = typeof signatureData?.imageUrl === "string"
    ? signatureData.imageUrl
    : typeof ack.signatureImageUrl === "string"
    ? ack.signatureImageUrl
    : "";

  const acknowledgments = Array.isArray(ack.acknowledgments) ? ack.acknowledgments : [];
  const stepIds = acknowledgments
    .map((row) => String((row as { stepId?: string; step_id?: string })?.stepId
      || (row as { step_id?: string })?.step_id
      || "").trim())
    .filter(Boolean);

  const { data: steps } = await supabase
    .from("booking_terms_steps")
    .select("id, step_order, title, body, require_acknowledge")
    .eq("package_id", activityTermsPackageId)
    .eq("business_id", businessId)
    .order("step_order", { ascending: true });

  const requiredSteps = (steps || []).filter((step) => step.require_acknowledge !== false);
  const ackSet = new Set(stepIds);
  const allRequiredAcked = requiredSteps.every((step) => ackSet.has(String(step.id)));

  if (signerName && imageUrl.startsWith("data:image/") && allRequiredAcked) {
    await supabase.from("booking_terms_acknowledgments").delete().eq("booking_id", bookingId);
    if (requiredSteps.length) {
      await supabase.from("booking_terms_acknowledgments").insert(
        requiredSteps.map((step) => ({
          booking_id: bookingId,
          business_id: businessId,
          package_id: activityTermsPackageId,
          step_id: step.id,
          step_order: step.step_order,
          step_title_snapshot: step.title,
          step_body_snapshot: step.body || "",
          acknowledged_at: signedAt,
        })),
      );
    }
    await supabase.from("bookings").update({
      terms_package_id: activityTermsPackageId,
      terms_status: "signed",
      terms_signed_at: signedAt,
      terms_signer_name: signerName,
      terms_signature_data: {
        imageUrl,
        capturedAt: signedAt,
        signerName,
      },
      updated_at: nowIso(),
    }).eq("id", bookingId);

    await insertBookingHistory(supabase, {
      businessId,
      bookingId,
      actionType: "booking.terms_signed",
      summary: "Terms & Conditions signed",
      details: {
        actor_label: "Customer",
        signer_name: signerName,
        changes: [
          { field: "Terms status", from: "pending", to: "signed" },
          { field: "Signer", from: null, to: signerName },
        ],
      },
    });
  } else if (usesConfirmationTermsFlow) {
    await supabase.from("bookings").update({
      terms_package_id: activityTermsPackageId,
      terms_status: "pending",
      updated_at: nowIso(),
    }).eq("id", bookingId);
  }
}

async function broadcastCompletion(
  supabase: SupabaseClient,
  invoiceNumber: string | null,
  checkoutToken: string | null,
  bookingId: string,
  manageToken: string,
  pendingId: string,
  transactionId: string | null,
  amount: number,
  approvalCode: string | null,
) {
  const channelsToNotify = new Set<string>();

  if (invoiceNumber) {
    channelsToNotify.add(`helcim-payment-${invoiceNumber}`);
  }
  if (checkoutToken) {
    channelsToNotify.add(`helcim-payment-${checkoutToken}`);
  }

  for (const channelName of channelsToNotify) {
    try {
      await supabase.channel(channelName).send({
        type: "broadcast",
        event: "payment_completed",
        payload: {
          invoiceNumber,
          transactionId,
          status: "completed",
          amount,
          approvalCode,
          bookingId,
          manageToken,
          pendingId,
          timestamp: nowIso(),
        },
      });
    } catch (error) {
      console.error("[bookingFinalization] Failed to broadcast completion:", { channelName, error });
    }
  }
}

export async function finalizePendingBooking({
  supabase,
  pendingId,
  transactionId = null,
  amount = null,
  approvalCode = null,
  customerCode = null,
  recoverPaidCheckout = false,
}: FinalizePendingBookingArgs): Promise<FinalizePendingBookingResult> {
  const loadPending = async () =>
    await supabase
    .from("booking_pending_helcim")
    .select(`
      id,
      invoice_number,
      checkout_token,
      business_id,
      activity_id,
      session_id,
      customer_id,
      booking_date,
      booking_time,
      participant_rows,
      amount,
      order_total,
      tax_amount,
      payment_type,
      addon_rows,
      currency,
      status,
      booking_id,
      helcim_transaction_id,
      client_ip,
      promo_code,
      pricing_promotion_id,
      gift_card_id,
      gift_card_code,
      gift_card_amount,
      slot_hold_token,
      terms_acknowledgment
    `)
    .eq("id", pendingId)
    .maybeSingle();

  const { data: pending, error: pendingError } = await loadPending();

  if (pendingError) {
    console.error("[bookingFinalization] Failed to load pending row:", pendingError);
    return { ok: false, status: 500, message: "Failed to load pending booking" };
  }

  if (!pending) {
    return { ok: false, status: 404, message: "Pending booking not found" };
  }

  if (pending.status === "completed" && pending.booking_id) {
    const manageToken = await getOrCreateBookingSelfServiceToken(
      supabase,
      pending.booking_id,
      pending.business_id,
    );
    await broadcastCompletion(
      supabase,
      pending.invoice_number ?? null,
      pending.checkout_token ?? null,
      pending.booking_id,
      manageToken,
      pending.id,
      transactionId ?? pending.helcim_transaction_id ?? null,
      amountToNumber(amount ?? pending.amount),
      approvalCode,
    );
    return { ok: true, bookingId: pending.booking_id, manageToken, alreadyCompleted: true };
  }

  if (pending.status !== "pending") {
    return { ok: false, status: 409, message: `Pending booking is already ${pending.status}` };
  }

  if (pending.booking_id) {
    const { data: claimedExisting, error: claimExistingError } = await supabase
      .from("booking_pending_helcim")
      .update({
        status: "processing",
        updated_at: nowIso(),
        helcim_transaction_id: transactionId ? String(transactionId) : pending.helcim_transaction_id ?? null,
      })
      .eq("id", pending.id)
      .eq("status", "pending")
      .not("booking_id", "is", null)
      .select("id")
      .maybeSingle();

    if (claimExistingError) {
      return { ok: false, status: 500, message: "Failed to claim pending payment" };
    }
    if (!claimedExisting) {
      return { ok: false, status: 409, message: "Pending payment is already being processed" };
    }

    const amountPaid = amountToNumber(amount ?? pending.amount);
    const orderTotal = amountToNumber(pending.order_total ?? pending.amount ?? amountPaid);
    const isDepositCheckout = String(pending.payment_type || "full").toLowerCase() === "deposit";
    const paymentStatus =
      amountPaid <= 0
        ? "unpaid"
        : isDepositCheckout && orderTotal > amountPaid + 0.005
          ? "partial"
          : "paid";

    const { error: paymentError } = await supabase.from("booking_payments").insert({
      booking_id: pending.booking_id,
      payment_type: isDepositCheckout ? "deposit" : "full",
      amount_paid: amountPaid,
      deposit_amount: isDepositCheckout ? amountPaid : null,
      remaining_balance: isDepositCheckout ? Math.max(0, Math.round((orderTotal - amountPaid) * 100) / 100) : null,
      payment_method: "helcim_hosted",
      transaction_id: transactionId ? String(transactionId) : "",
      status: "completed",
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    if (paymentError) {
      await supabase.from("booking_pending_helcim").update({ status: "failed", updated_at: nowIso() }).eq("id", pending.id);
      return { ok: false, status: 500, message: "Failed to record payment" };
    }

    await supabase
      .from("bookings")
      .update({
        payment_status: paymentStatus,
        status: "confirmed",
        active_payment_request_id: null,
        updated_at: nowIso(),
      })
      .eq("id", pending.booking_id);

    await supabase
      .from("booking_payment_requests")
      .update({ status: "paid", updated_at: nowIso() })
      .eq("booking_id", pending.booking_id)
      .eq("status", "pending");

    await supabase
      .from("booking_pending_helcim")
      .update({ status: "completed", updated_at: nowIso() })
      .eq("id", pending.id);

    if (amountPaid > 0) {
      await insertBookingHistory(supabase, {
        businessId: pending.business_id,
        bookingId: pending.booking_id,
        actionType: "booking.payment_received",
        summary: isDepositCheckout ? "Deposit payment received" : "Payment received",
        details: {
          actor_label: "Customer",
          changes: [
            {
              field: "Amount",
              from: null,
              to: `$${amountPaid.toFixed(2)}`,
            },
            {
              field: "Payment type",
              from: null,
              to: isDepositCheckout ? "deposit" : "full",
            },
            {
              field: "Payment status",
              from: null,
              to: paymentStatus,
            },
          ],
        },
        changedIp: typeof pending.client_ip === "string" ? pending.client_ip.trim() : null,
      });
    }

    const manageToken = await getOrCreateBookingSelfServiceToken(
      supabase,
      pending.booking_id,
      pending.business_id,
    );

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && serviceRoleKey) {
      await sendBookingConfirmation(supabaseUrl, serviceRoleKey, pending.business_id, pending.booking_id);
    }

    await broadcastCompletion(
      supabase,
      pending.invoice_number ?? null,
      pending.checkout_token ?? null,
      pending.booking_id,
      manageToken,
      pending.id,
      transactionId,
      amountPaid,
      approvalCode,
    );

    const helcimCustomerCode = String(customerCode || "").trim();
    if (helcimCustomerCode && pending.customer_id && pending.business_id) {
      await supabase
        .from("pos_loyalty_accounts")
        .update({ helcim_customer_code: helcimCustomerCode })
        .eq("id", pending.customer_id)
        .eq("business_id", pending.business_id);
    }

    return { ok: true, bookingId: pending.booking_id, manageToken };
  }

  const { data: claimedPending, error: claimError } = await supabase
    .from("booking_pending_helcim")
    .update({
      status: "processing",
      updated_at: nowIso(),
      helcim_transaction_id: transactionId ? String(transactionId) : pending.helcim_transaction_id ?? null,
    })
    .eq("id", pending.id)
    .eq("status", "pending")
    .is("booking_id", null)
    .select("id")
    .maybeSingle();

  if (claimError) {
    console.error("[bookingFinalization] Failed to claim pending booking:", claimError);
    return { ok: false, status: 500, message: "Failed to claim pending booking" };
  }

  if (!claimedPending) {
    const { data: latestPending, error: latestPendingError } = await loadPending();
    if (latestPendingError) {
      console.error("[bookingFinalization] Failed to reload pending booking after claim race:", latestPendingError);
      return { ok: false, status: 500, message: "Failed to reload pending booking" };
    }

    if (latestPending?.status === "completed" && latestPending.booking_id) {
      const manageToken = await getOrCreateBookingSelfServiceToken(
        supabase,
        latestPending.booking_id,
        latestPending.business_id,
      );
      await broadcastCompletion(
        supabase,
        latestPending.invoice_number ?? null,
        latestPending.checkout_token ?? null,
        latestPending.booking_id,
        manageToken,
        latestPending.id,
        transactionId ?? latestPending.helcim_transaction_id ?? null,
        amountToNumber(amount ?? latestPending.amount),
        approvalCode,
      );
      return { ok: true, bookingId: latestPending.booking_id, manageToken, alreadyCompleted: true };
    }

    return { ok: false, status: 409, message: "Pending booking is already being processed" };
  }

  const markPendingFailed = async (message: string) => {
    try {
      await supabase
        .from("booking_pending_helcim")
        .update({
          status: "failed",
          updated_at: nowIso(),
        })
        .eq("id", pending.id)
        .eq("status", "processing");
    } catch (error) {
      console.error("[bookingFinalization] Failed to mark pending booking failed:", { message, error });
    }
  };

  const durationMinutes = Number(pending.duration_minutes) > 0
    ? Number(pending.duration_minutes)
    : 60;

  const hoursCheck = await assertBookingWithinBusinessHours(
    supabase,
    String(pending.business_id),
    String(pending.booking_date),
    String(pending.booking_time),
    durationMinutes,
  );
  if (!hoursCheck.ok) {
    await markPendingFailed(hoursCheck.message);
    return { ok: false, status: 400, message: hoursCheck.message };
  }

  const holdCheck = recoverPaidCheckout
    ? { ok: true as const }
    : await validateBookingSlotHold(supabase, {
      holdToken: typeof pending.slot_hold_token === "string" ? pending.slot_hold_token : null,
      businessId: String(pending.business_id),
      activityId: String(pending.activity_id),
      bookingDate: String(pending.booking_date),
      bookingTime: String(pending.booking_time),
    });
  if (!holdCheck.ok) {
    await markPendingFailed(holdCheck.message);
    return { ok: false, status: 409, message: holdCheck.message };
  }

  const [{ data: sessionRow }, { data: loyaltyRow }, { data: activityRow }] = await Promise.all([
    pending.session_id
      ? Promise.resolve({ data: { id: pending.session_id } })
      : supabase
          .from("booking_sessions")
          .select("id")
          .eq("activity_id", pending.activity_id)
          .eq("session_date", String(pending.booking_date))
          .eq("start_time", String(pending.booking_time))
          .maybeSingle(),
    pending.customer_id
      ? supabase
          .from("pos_loyalty_accounts")
          .select("customer_email, customer_phone")
          .eq("id", pending.customer_id)
          .eq("business_id", pending.business_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("booking_activities")
      .select("type_id, terms_package_id, terms_show_on_confirmation, ticket_settings")
      .eq("id", pending.activity_id)
      .eq("business_id", pending.business_id)
      .maybeSingle(),
  ]);

  const { data: bookingNumber, error: bookingNumberError } = await supabase.rpc("generate_booking_number", {
    business_uuid: pending.business_id,
  });

  if (bookingNumberError) {
    console.error("[bookingFinalization] Failed to generate booking number:", bookingNumberError);
    await markPendingFailed("booking_number");
    return { ok: false, status: 500, message: "Failed to generate booking number" };
  }

  const amountPaid = amountToNumber(amount ?? pending.amount);
  const giftCardAmount = amountToNumber(pending.gift_card_amount);
  const totalCollected = Math.round((amountPaid + giftCardAmount) * 100) / 100;
  const orderTotal = amountToNumber(pending.order_total ?? pending.amount ?? amountPaid);
  const isDepositCheckout = String(pending.payment_type || "full").toLowerCase() === "deposit";
  const paymentStatus =
    totalCollected <= 0.009
      ? "unpaid"
      : isDepositCheckout && orderTotal > totalCollected + 0.005
        ? "partial"
        : "paid";
  const bookingInsert = {
    business_id: pending.business_id,
    activity_id: pending.activity_id,
    booking_type_id: activityRow?.type_id ?? null,
    session_id: sessionRow?.id ?? null,
    customer_id: pending.customer_id,
    customer_email: loyaltyRow?.customer_email ?? null,
    customer_phone: loyaltyRow?.customer_phone ?? null,
    booking_date: String(pending.booking_date),
    booking_time: String(pending.booking_time),
    booking_number: typeof bookingNumber === "string" ? bookingNumber : null,
    order_total: orderTotal > 0 ? orderTotal : null,
    tax_amount: amountToNumber(pending.tax_amount) > 0 ? amountToNumber(pending.tax_amount) : null,
    status: "confirmed",
    payment_status: paymentStatus,
    source: "web",
    created_ip: typeof pending.client_ip === "string" && pending.client_ip.trim()
      ? pending.client_ip.trim()
      : null,
    promo_code_used: typeof pending.promo_code === "string" && pending.promo_code.trim()
      ? pending.promo_code.trim()
      : null,
    pricing_promotion_id: pending.pricing_promotion_id ?? null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .insert(bookingInsert)
    .select("id")
    .single();

  if (bookingError || !booking?.id) {
    console.error("[bookingFinalization] Failed to create booking:", bookingError);
    await markPendingFailed("create_booking");
    return { ok: false, status: 500, message: "Failed to create booking" };
  }

  const cleanupBooking = async () => {
    try {
      await supabase.from("bookings").delete().eq("id", booking.id);
    } catch (error) {
      console.error("[bookingFinalization] Failed to roll back booking after downstream error:", error);
    }
  };

  const participantRows = Array.isArray(pending.participant_rows) ? pending.participant_rows : [];
  if (participantRows.length > 0) {
    const requestedWaiverIds = Array.from(
      new Set(
        participantRows
          .map((row: Record<string, unknown>) =>
            typeof row?.waiver_id === "string" && row.waiver_id.trim() ? row.waiver_id.trim() : null,
          )
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const requestedCamperRegistrationIds = Array.from(
      new Set(
        participantRows
          .map((row: Record<string, unknown>) =>
            typeof row?.camper_registration_document_id === "string" && row.camper_registration_document_id.trim()
              ? row.camper_registration_document_id.trim()
              : null,
          )
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const verifiedWaiverStatus = new Map<string, "valid" | "expired" | "missing">();
    if (requestedWaiverIds.length > 0) {
      const { data: waiverRows, error: waiverValidationError } = await supabase
        .from("waiver_signatures")
        .select("id, is_valid, expires_at")
        .eq("business_id", pending.business_id)
        .in("id", requestedWaiverIds);

      if (waiverValidationError) {
        console.error("[bookingFinalization] Failed to validate participant waiver links:", waiverValidationError);
        await cleanupBooking();
        await markPendingFailed("validate_participant_waivers");
        return { ok: false, status: 500, message: "Failed to validate participant waivers" };
      }

      const nowMs = Date.now();
      const waiverById = new Map((waiverRows || []).map((row) => [row.id, row]));
      for (const waiverId of requestedWaiverIds) {
        const waiver = waiverById.get(waiverId);
        const isExpired =
          typeof waiver?.expires_at === "string" && waiver.expires_at.trim()
            ? new Date(waiver.expires_at).getTime() <= nowMs
            : false;
        const status = !waiver
          ? "missing"
          : waiver.is_valid !== true || isExpired
            ? "expired"
            : "valid";
        verifiedWaiverStatus.set(waiverId, status);
      }
    }

    const verifiedCamperRegistrationStatus = new Map<string, "valid" | "expired" | "missing">();
    if (requestedCamperRegistrationIds.length > 0) {
      const { data: registrationRows, error: registrationValidationError } = await supabase
        .from("camper_registration_documents")
        .select("id, is_valid, expires_at")
        .eq("business_id", pending.business_id)
        .in("id", requestedCamperRegistrationIds);

      if (registrationValidationError) {
        console.error("[bookingFinalization] Failed to validate camper registration links:", registrationValidationError);
        await cleanupBooking();
        await markPendingFailed("validate_camper_registrations");
        return { ok: false, status: 500, message: "Failed to validate camper registrations" };
      }

      const nowMs = Date.now();
      const bookingDateAsOf = String(pending.booking_date || "").trim();
      const asOfMs = bookingDateAsOf
        ? new Date(`${bookingDateAsOf}T23:59:59.999`).getTime()
        : nowMs;
      const registrationById = new Map((registrationRows || []).map((row) => [row.id, row]));
      for (const registrationId of requestedCamperRegistrationIds) {
        const registration = registrationById.get(registrationId);
        const expiresMs =
          typeof registration?.expires_at === "string" && registration.expires_at.trim()
            ? new Date(registration.expires_at).getTime()
            : NaN;
        const isRegistrationExpired = Number.isFinite(expiresMs)
          ? expiresMs <= (Number.isFinite(asOfMs) ? asOfMs : nowMs)
          : false;
        const status = !registration
          ? "missing"
          : registration.is_valid !== true || isRegistrationExpired
            ? "expired"
            : "valid";
        verifiedCamperRegistrationStatus.set(registrationId, status);
      }
    }

    const rows = [];
    const customerId = pending.customer_id ? String(pending.customer_id) : null;
    for (const row of participantRows) {
      const requestedWaiverId =
        typeof row?.waiver_id === "string" && row.waiver_id.trim() ? row.waiver_id.trim() : null;
      const waiverStatus = requestedWaiverId
        ? verifiedWaiverStatus.get(requestedWaiverId) || "missing"
        : "missing";
      const requestedCamperRegistrationId =
        typeof row?.camper_registration_document_id === "string" && row.camper_registration_document_id.trim()
          ? row.camper_registration_document_id.trim()
          : null;
      const requestedCamperRegistrationStatus =
        typeof row?.camper_registration_status === "string" && row.camper_registration_status.trim()
          ? row.camper_registration_status.trim()
          : null;
      const camperRegistrationStatus = requestedCamperRegistrationId
        ? verifiedCamperRegistrationStatus.get(requestedCamperRegistrationId) || "missing"
        : requestedCamperRegistrationStatus === "not_required"
          ? "not_required"
          : "missing";

      const partyRole =
        typeof row?.party_role === "string" && row.party_role.trim() ? row.party_role.trim() : null;
      const participantId = await resolveBookingCustomerParticipantId(
        supabase,
        String(pending.business_id),
        customerId,
        row,
      );

      rows.push({
        booking_id: booking.id,
        participant_id: participantId,
        waiver_participant_id:
          typeof row?.waiver_participant_id === "string" && row.waiver_participant_id.trim()
            ? row.waiver_participant_id.trim()
            : null,
        inventory_item_id: row?.inventory_item_id ?? null,
        party_role: partyRole,
        waiver_id: waiverStatus === "valid" ? requestedWaiverId : null,
        waiver_status: waiverStatus,
        camper_registration_document_id:
          camperRegistrationStatus === "valid" ? requestedCamperRegistrationId : null,
        camper_registration_status: camperRegistrationStatus,
        created_at: nowIso(),
      });
    }

    const uniqueCheck = assertUniqueBookingParticipantIdentities(rows);
    if (!uniqueCheck.ok) {
      console.error("[bookingFinalization] Duplicate participant identities:", uniqueCheck.message);
      await cleanupBooking();
      await markPendingFailed("duplicate_participants");
      return { ok: false, status: 400, message: uniqueCheck.message };
    }

    const { error: participantError } = await supabase.from("booking_participants").insert(rows);
    if (participantError) {
      console.error("[bookingFinalization] Failed to create booking participants:", participantError);
      await cleanupBooking();
      await markPendingFailed("create_participants");
      return { ok: false, status: 500, message: "Failed to create booking participants" };
    }
  }

  const addonRows = Array.isArray(pending.addon_rows) ? pending.addon_rows : [];
  if (addonRows.length > 0) {
    const resolvedAddonItems = [];
    for (const rowRaw of addonRows) {
      const row = rowRaw as Record<string, unknown>;
      const optionName = typeof row?.name === "string" && row.name.trim() ? row.name.trim() : "Add-on";
      const quantity = Math.max(1, Number.parseInt(String(row?.quantity ?? 1), 10) || 1);
      const unitPrice = Math.max(0, Number.parseFloat(String(row?.unit_price ?? 0)) || 0);
      const addonKey = `portal-${booking.id}-${String(row?.option_id || Date.now())}`;

      const { data: createdAddon, error: createdAddonError } = await supabase
        .from("booking_addons")
        .insert({
          business_id: pending.business_id,
          addon_name: optionName,
          addon_key: addonKey,
          description: "Customer portal option",
          price: unitPrice,
          is_global: false,
          activity_ids: pending.activity_id ? [pending.activity_id] : null,
          inventory_tracked: false,
          current_stock: null,
          is_active: false,
        })
        .select("id")
        .single();

      if (createdAddonError || !createdAddon?.id) {
        console.error("[bookingFinalization] Failed to create portal addon:", createdAddonError);
        continue;
      }

      resolvedAddonItems.push({
        booking_id: booking.id,
        addon_id: createdAddon.id,
        quantity,
        unit_price: unitPrice,
      });
    }

    if (resolvedAddonItems.length > 0) {
      const { error: addonItemsError } = await supabase.from("booking_addon_items").insert(resolvedAddonItems);
      if (addonItemsError) {
        console.error("[bookingFinalization] Failed to create booking addon items:", addonItemsError);
        await cleanupBooking();
        await markPendingFailed("create_addon_items");
        return { ok: false, status: 500, message: "Failed to create booking add-ons" };
      }

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
          const stockResult = await applySaleStockAdjustments(
            supabase,
            String(pending.business_id),
            stockLines,
          );
          console.log("[bookingFinalization] Inventory stock adjusted:", stockResult);
        } catch (stockError) {
          console.warn("[bookingFinalization] Inventory stock adjustment failed:", stockError);
        }
      }
    }
  }

  if (amountPaid > 0) {
    const remainingBalance = isDepositCheckout
      ? Math.max(0, Math.round((orderTotal - totalCollected) * 100) / 100)
      : null;
    const { error: paymentError } = await supabase.from("booking_payments").insert({
      booking_id: booking.id,
      payment_type: isDepositCheckout ? "deposit" : "full",
      amount_paid: amountPaid,
      deposit_amount: isDepositCheckout ? amountPaid : null,
      remaining_balance: remainingBalance,
      payment_method: "helcim_hosted",
      transaction_id: transactionId ? String(transactionId) : "",
      status: "completed",
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    if (paymentError) {
      console.error("[bookingFinalization] Failed to create booking payment:", paymentError);
      await cleanupBooking();
      await markPendingFailed("create_payment");
      return { ok: false, status: 500, message: "Failed to create booking payment" };
    }
  }

  if (giftCardAmount > 0.009) {
    const codeOrId = typeof pending.gift_card_code === "string" && pending.gift_card_code.trim()
      ? pending.gift_card_code.trim()
      : null;
    if (!codeOrId) {
      console.error("[bookingFinalization] Missing gift card code on pending checkout");
      await cleanupBooking();
      await markPendingFailed("gift_card_missing");
      return { ok: false, status: 400, message: "Gift card is missing from this checkout session" };
    }
    try {
      await redeemGiftCardForBooking(supabase, {
        businessId: String(pending.business_id),
        codeOrPayload: codeOrId,
        amountDollars: giftCardAmount,
        bookingId: booking.id,
        customerId: pending.customer_id ? String(pending.customer_id) : null,
      });
    } catch (gcErr) {
      console.error("[bookingFinalization] Gift card redeem failed:", gcErr);
      await cleanupBooking();
      await markPendingFailed("gift_card_redeem");
      return {
        ok: false,
        status: 400,
        message: gcErr instanceof Error ? gcErr.message : "Gift card could not be redeemed",
      };
    }

    const remainingAfterGift = isDepositCheckout
      ? Math.max(0, Math.round((orderTotal - totalCollected) * 100) / 100)
      : null;
    const { error: giftPaymentError } = await supabase.from("booking_payments").insert({
      booking_id: booking.id,
      payment_type: isDepositCheckout ? "deposit" : "full",
      amount_paid: giftCardAmount,
      deposit_amount: isDepositCheckout ? giftCardAmount : null,
      remaining_balance: remainingAfterGift,
      payment_method: "gift_card",
      gift_card_id: pending.gift_card_id || null,
      gift_card_code: pending.gift_card_code || null,
      transaction_id: "",
      status: "completed",
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    if (giftPaymentError) {
      console.error("[bookingFinalization] Failed to create gift card payment:", giftPaymentError);
      await cleanupBooking();
      await markPendingFailed("create_gift_card_payment");
      return { ok: false, status: 500, message: "Failed to record gift card payment" };
    }
  }

  if (totalCollected <= 0.009) {
    console.error("[bookingFinalization] No payment collected (Helcim or gift card)");
    await cleanupBooking();
    await markPendingFailed("no_payment");
    return { ok: false, status: 400, message: "No payment was collected for this booking" };
  }

  try {
    await syncBookingResourcesFromActivitySchedule(supabase, {
      businessId: String(pending.business_id),
      activityId: String(pending.activity_id),
      bookingId: booking.id,
      bookingDate: String(pending.booking_date),
      bookingTime: String(pending.booking_time),
    });
    await supabase.rpc("generate_booking_qr_code", { booking_uuid: booking.id });
  } catch (error) {
    console.warn("[bookingFinalization] Failed to generate QR code or schedule resources:", error);
  }

  const { error: updatePendingError } = await supabase
    .from("booking_pending_helcim")
    .update({
      status: "completed",
      booking_id: booking.id,
      helcim_transaction_id: transactionId ? String(transactionId) : pending.helcim_transaction_id ?? null,
      updated_at: nowIso(),
    })
    .eq("id", pending.id)
    .eq("status", "processing");

  if (updatePendingError) {
    console.error("[bookingFinalization] Failed to mark pending booking completed:", updatePendingError);
    await cleanupBooking();
    await markPendingFailed("complete_pending");
    return { ok: false, status: 500, message: "Failed to finalize pending booking" };
  }

  if (pending.pricing_promotion_id) {
    try {
      await supabase.from("booking_pricing_promotion_redemptions").insert({
        promotion_id: pending.pricing_promotion_id,
        business_id: pending.business_id,
        customer_id: pending.customer_id ?? null,
        booking_id: booking.id,
        pending_id: pending.id,
        promo_code_used: typeof pending.promo_code === "string" ? pending.promo_code.trim() || null : null,
      });
      await supabase.rpc("increment_booking_pricing_promotion_uses", {
        p_promotion_id: pending.pricing_promotion_id,
      });
    } catch (promoErr) {
      console.warn("[bookingFinalization] Failed to record pricing promotion redemption:", promoErr);
    }
  }

  try {
    await supabase
      .from("booking_portal_funnel")
      .update({ current_stage: "converted", updated_at: nowIso() })
      .eq("pending_helcim_id", pending.id);
  } catch (funnelErr) {
    console.warn("[bookingFinalization] funnel convert:", funnelErr);
  }

  const manageToken = await getOrCreateBookingSelfServiceToken(
    supabase,
    booking.id,
    pending.business_id,
  );

  await insertBookingHistory(supabase, {
    businessId: pending.business_id,
    bookingId: booking.id,
    actionType: "booking.created",
    summary: "Online booking created",
    details: {
      actor_label: "Customer",
      source: "web",
      changes: [
        { field: "Booking number", from: null, to: bookingInsert.booking_number },
        { field: "Date", from: null, to: bookingInsert.booking_date },
        { field: "Time", from: null, to: bookingInsert.booking_time },
        { field: "Payment status", from: null, to: paymentStatus },
      ].filter((row) => row.to != null),
    },
    changedIp: typeof pending.client_ip === "string" ? pending.client_ip.trim() : null,
  });

  if (totalCollected > 0.009) {
    await insertBookingHistory(supabase, {
      businessId: pending.business_id,
      bookingId: booking.id,
      actionType: "booking.payment_received",
      summary: isDepositCheckout ? "Deposit payment received" : "Payment received",
      details: {
        actor_label: "Customer",
        changes: [
          { field: "Amount", from: null, to: `$${totalCollected.toFixed(2)}` },
          { field: "Payment type", from: null, to: isDepositCheckout ? "deposit" : "full" },
          ...(giftCardAmount > 0.009
            ? [{ field: "Gift card", from: null, to: `$${giftCardAmount.toFixed(2)}` }]
            : []),
          ...(amountPaid > 0.009
            ? [{ field: "Card", from: null, to: `$${amountPaid.toFixed(2)}` }]
            : []),
        ],
      },
      changedIp: typeof pending.client_ip === "string" ? pending.client_ip.trim() : null,
    });
  }

  try {
    const activityTermsPackageId =
      typeof activityRow?.terms_package_id === "string" && activityRow.terms_package_id.trim()
        ? activityRow.terms_package_id.trim()
        : null;
    await applyPendingTermsAcknowledgment(
      supabase,
      booking.id,
      String(pending.business_id),
      activityTermsPackageId,
      pending.terms_acknowledgment,
      activityShowsTermsOnConfirmation(activityRow),
    );
  } catch (termsErr) {
    console.warn("[bookingFinalization] terms acknowledgment apply failed:", termsErr);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (supabaseUrl && serviceRoleKey) {
    await sendBookingConfirmation(supabaseUrl, serviceRoleKey, pending.business_id, booking.id);
  }

  await broadcastCompletion(
    supabase,
    pending.invoice_number ?? null,
    pending.checkout_token ?? null,
    booking.id,
    manageToken,
    pending.id,
    transactionId,
    totalCollected,
    approvalCode,
  );

  await releaseBookingSlotHoldByToken(
    supabase,
    typeof pending.slot_hold_token === "string" ? pending.slot_hold_token : null,
  );

  const helcimCustomerCode = String(customerCode || "").trim();
  if (helcimCustomerCode && pending.customer_id && pending.business_id) {
    await supabase
      .from("pos_loyalty_accounts")
      .update({ helcim_customer_code: helcimCustomerCode, updated_at: nowIso() })
      .eq("id", pending.customer_id)
      .eq("business_id", pending.business_id);
  }

  try {
    const orderTotalNum = amountToNumber(pending.order_total);
    const taxNum = amountToNumber(pending.tax_amount);
    const bookingSubtotal = Math.max(0, orderTotalNum - taxNum);
    const participantRows = Array.isArray(pending.participant_rows) ? pending.participant_rows : [];
    const addonRows = Array.isArray(pending.addon_rows) ? pending.addon_rows : [];
    const inventoryLines = [
      ...participantRows.map((row: Record<string, unknown>) => ({
        inventory_item_id:
          typeof row?.inventory_item_id === "string" ? row.inventory_item_id : null,
        quantity: 1,
      })),
      ...addonRows.map((row: Record<string, unknown>) => ({
        inventory_item_id:
          typeof row?.inventory_item_id === "string" ? row.inventory_item_id : null,
        quantity: Math.max(1, Number.parseInt(String(row?.quantity ?? 1), 10) || 1),
      })),
    ];

    const loyaltyResult = await awardBookingLoyaltyPoints(supabase, {
      businessId: String(pending.business_id),
      bookingId: booking.id,
      customerId: pending.customer_id ? String(pending.customer_id) : null,
      bookingSubtotal,
      inventoryLines,
    });
    if (loyaltyResult.awarded) {
      console.log(
        `[bookingFinalization] Awarded ${loyaltyResult.pointsAwarded} loyalty points for booking ${booking.id}`,
      );
    } else if (loyaltyResult.skippedReason && loyaltyResult.skippedReason !== "already_awarded" && loyaltyResult.skippedReason !== "zero_points" && loyaltyResult.skippedReason !== "no_customer") {
      console.warn(
        `[bookingFinalization] Loyalty award skipped (${loyaltyResult.skippedReason}) for booking ${booking.id}`,
      );
    }
  } catch (loyaltyErr) {
    console.warn("[bookingFinalization] Loyalty award failed:", loyaltyErr);
  }

  return { ok: true, bookingId: booking.id, manageToken };
}
