import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  calculateOnlineCheckoutAmounts,
  parseOnlinePaymentFromTicketSettings,
} from "./bookingPaymentSettings.ts";
import {
  canSelfServiceCancelByRules,
  canSelfServiceRescheduleByRules,
  cancellationBandForHours,
  hoursUntilBooking,
  normalizeCancellationRules,
  passesMinHours,
  resolveSettlementOnCancel,
  selectBandRules,
  totalCompletedPaid,
  type PaymentSummaryRow,
} from "./bookingCancellationRules.ts";
import { getActivePaymentRequest } from "./bookingPaymentRequest.ts";

type SupabaseClient = ReturnType<typeof createClient>;

export async function loadBookingSelfServicePayload(
  supabase: SupabaseClient,
  bookingId: string,
  businessId: string,
) {
  const { data: booking, error: bookingErr } = await supabase
    .from("bookings")
    .select(`
      id,
      booking_number,
      customer_id,
      customer_email,
      customer_phone,
      business_id,
      activity_id,
      session_id,
      booking_date,
      booking_time,
      status,
      payment_status,
      requires_approval,
      approved_at,
      deposit_due_at,
      order_total,
      cancellation_reason,
      cancelled_at,
      checked_in_at,
      booking_activities:activity_id (
        id,
        activity_name,
        duration_minutes,
        type_id,
        ticket_settings
      ),
      booking_types:booking_type_id (
        id,
        display_name,
        type_name,
        cancellation_rules
      )
    `)
    .eq("id", bookingId)
    .eq("business_id", businessId)
    .single();

  if (bookingErr || !booking) {
    throw bookingErr || new Error("Booking not found");
  }

  const activityId = (booking as { activity_id?: string | null }).activity_id || null;

  const [businessRes, participantsRes, paymentsRes, settingsRes, activityTabsRes] = await Promise.all([
    supabase.from("businesses").select("id, name, business_website, timezone").eq("id", businessId).single(),
    supabase
      .from("booking_participants")
      .select("id, participant_id, inventory_item_id, waiver_status")
      .eq("booking_id", bookingId)
      .order("created_at"),
    supabase
      .from("booking_payments")
      .select("id, amount_paid, payment_type, status, payment_method, transaction_id")
      .eq("booking_id", bookingId),
    supabase
      .from("booking_settings")
      .select("setting_value")
      .eq("business_id", businessId)
      .eq("setting_key", "cancellationPolicy")
      .is("activity_id", null)
      .eq("is_global", true)
      .maybeSingle(),
    activityId
      ? supabase
        .from("booking_activity_tabs")
        .select("id, activity_id, tab_key, label, display_order, is_active, audience, content_blocks, reminders")
        .eq("business_id", businessId)
        .eq("activity_id", activityId)
        .eq("is_active", true)
        .order("display_order", { ascending: true })
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);

  const participants = participantsRes.data || [];
  const payments = (paymentsRes.data || []) as PaymentSummaryRow[];
  const cancellationPolicyRaw = settingsRes.data?.setting_value;
  const cancellationPolicy =
    typeof cancellationPolicyRaw === "string"
      ? cancellationPolicyRaw
      : cancellationPolicyRaw == null
        ? ""
        : String(cancellationPolicyRaw);
  const invIds = [...new Set(participants.map((p: { inventory_item_id?: string | null }) => p.inventory_item_id).filter(Boolean))];
  const inventoryMap: Record<string, string> = {};
  if (invIds.length > 0) {
    const { data: inv } = await supabase.from("pos_inventory").select("id, name").in("id", invIds);
    (inv || []).forEach((item: { id: string; name?: string | null }) => {
      inventoryMap[item.id] = item.name || "Ticket";
    });
  }

  const ticketSummaryMap: Record<string, { name: string; qty: number }> = {};
  participants.forEach((participant: { inventory_item_id?: string | null }) => {
    const key = participant.inventory_item_id || "other";
    if (!ticketSummaryMap[key]) {
      ticketSummaryMap[key] = {
        name: inventoryMap[participant.inventory_item_id || ""] || "Participant",
        qty: 0,
      };
    }
    ticketSummaryMap[key].qty += 1;
  });

  const totalPaid = totalCompletedPaid(payments);

  const rawRules = (booking as { booking_types?: { cancellation_rules?: unknown } | null }).booking_types?.cancellation_rules;
  const cancellationRules = normalizeCancellationRules(
    rawRules && typeof rawRules === "object" ? (rawRules as Record<string, unknown>) : {},
  );

  const hu = hoursUntilBooking(booking);
  const cancellationBand = cancellationBandForHours(hu, cancellationRules.noticeSplitHours);
  const bandRules = cancellationBand
    ? selectBandRules(cancellationRules, cancellationBand)
    : { cancelMode: "contact_business" as const, depositPolicy: "non_refundable" as const };

  const canCancel = canSelfServiceCancelByRules(cancellationRules, booking, payments);
  const canReschedule = canSelfServiceRescheduleByRules(cancellationRules, booking);
  const settlementPreview = resolveSettlementOnCancel(cancellationRules, payments, hu);

  let ticketSettingsRaw: Record<string, unknown> = {};
  const activityTicketSettings = (booking.booking_activities as { ticket_settings?: unknown } | null)?.ticket_settings;
  if (typeof activityTicketSettings === "string") {
    try {
      ticketSettingsRaw = JSON.parse(activityTicketSettings) as Record<string, unknown>;
    } catch {
      ticketSettingsRaw = {};
    }
  } else if (activityTicketSettings && typeof activityTicketSettings === "object") {
    ticketSettingsRaw = activityTicketSettings as Record<string, unknown>;
  }
  const orderTotal = Number(booking.order_total || 0);
  const depositCheckout = orderTotal > 0
    ? calculateOnlineCheckoutAmounts(orderTotal, parseOnlinePaymentFromTicketSettings(ticketSettingsRaw))
    : null;
  const activePaymentRequest = await getActivePaymentRequest(supabase, booking.id);
  const depositDue = booking.approved_at && booking.payment_status !== "paid"
    ? (activePaymentRequest
      ? Number(activePaymentRequest.amount)
      : depositCheckout?.chargeNow ?? null)
    : null;

  let rescheduleBlockedReason: "category_disabled" | "too_close" | "past" | null = null;
  if (!canReschedule) {
    if (!cancellationRules.rescheduleEnabled) {
      rescheduleBlockedReason = "category_disabled";
    } else if (hu != null && hu <= 0) {
      rescheduleBlockedReason = "past";
    } else if (
      hu != null &&
      cancellationRules.minHoursBeforeReschedule != null &&
      cancellationRules.minHoursBeforeReschedule > 0 &&
      !passesMinHours(hu, cancellationRules.minHoursBeforeReschedule)
    ) {
      rescheduleBlockedReason = "too_close";
    } else {
      rescheduleBlockedReason = "too_close";
    }
  }

  const activityTabs = ((activityTabsRes as { data?: Array<Record<string, unknown>> | null }).data || [])
    .filter((tab) => {
      const audience = String(tab.audience || "both");
      return audience === "both" || audience === "customer";
    });

  return {
    booking,
    business: businessRes.data,
    businessTimezone: (businessRes.data as { timezone?: string | null } | null)?.timezone || "America/Toronto",
    activityTabs,
    participants,
    payments,
    ticketSummary: Object.values(ticketSummaryMap),
    totalPaid,
    cancellationPolicy,
    canCancel,
    canReschedule,
    cancellationRules,
    selfService: {
      cancelAllowed: canCancel,
      rescheduleAllowed: canReschedule,
      rescheduleEnabled: cancellationRules.rescheduleEnabled,
      minHoursBeforeReschedule: cancellationRules.minHoursBeforeReschedule,
      hoursUntilBooking: hu,
      rescheduleBlockedReason,
      noticeSplitHours: cancellationRules.noticeSplitHours,
      cancellationBand,
      activeCancelMode: bandRules.cancelMode,
      settlementPreview: {
        settlement: settlementPreview.settlement,
        amount: settlementPreview.amount,
      },
      contactPhone: cancellationRules.contactPhone,
      contactEmail: cancellationRules.contactEmail,
      requiresContactForCancel: bandRules.cancelMode === "contact_business",
      depositDueAmount: depositDue,
      depositDueAt: activePaymentRequest?.due_at || booking.deposit_due_at,
      paymentRequestType: activePaymentRequest?.request_type || null,
      awaitingDeposit: !!depositDue && Number(depositDue) > 0,
    },
  };
}
