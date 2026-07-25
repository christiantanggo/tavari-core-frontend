import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendBookingCancellationEmail } from "./bookingCancellationEmail.ts";
import { insertBookingHistory } from "./bookingHistoryLog.ts";
import { BOOKING_TRANSACTIONAL_FROM_EMAIL } from "./bookingTransactionalMail.ts";
import {
  resolveBookingMailRecipients,
  withBookingMailRecipients,
} from "./bookingRecipientEmail.ts";
import { buildBookingManageUrl, getOrCreateBookingSelfServiceToken } from "./bookingSelfService.ts";
import {
  buildBookingPaymentCancelWarningEmail,
  buildBookingPaymentFollowUpEmail,
  buildBookingPaymentRequestEmail,
  formatDateTimeInBusinessTimezone,
  loadBookingEmailBusinessContext,
  resolveBookingRecipientName,
  type BookingPaymentFollowUpType,
} from "./bookingTransactionalEmail.ts";
import { getBusinessTimezone } from "./bookingScheduleResources.ts";
import {
  calculateOnlineCheckoutAmounts,
  parseOnlinePaymentFromTicketSettings,
} from "./bookingPaymentSettings.ts";

export type PaymentRequestType = "deposit" | "full" | "custom";

export interface SendBookingPaymentRequestParams {
  businessId: string;
  bookingId: string;
  requestType: PaymentRequestType;
  amount?: number;
  dueAt?: string | null;
  sentBy?: string | null;
  resend?: boolean;
  requestId?: string;
}

const roundMoney = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

export async function sumCompletedPayments(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<number> {
  const { data } = await supabase
    .from("booking_payments")
    .select("amount_paid, status")
    .eq("booking_id", bookingId);

  return (data || [])
    .filter((row) => row.status === "completed")
    .reduce((sum, row) => sum + (Number(row.amount_paid) || 0), 0);
}

export async function resolvePaymentRequestAmount(
  supabase: SupabaseClient,
  booking: {
    id: string;
    order_total?: number | null;
    activity_id?: string | null;
  },
  businessId: string,
  requestType: PaymentRequestType,
  customAmount?: number,
): Promise<{ amount: number; orderTotal: number; balanceDue: number }> {
  const orderTotal = roundMoney(Number(booking.order_total) || 0);
  const totalPaid = await sumCompletedPayments(supabase, booking.id);
  const balanceDue = roundMoney(Math.max(0, orderTotal - totalPaid));

  if (requestType === "full") {
    if (balanceDue <= 0) {
      throw new Error("Nothing left to pay on this booking.");
    }
    return { amount: balanceDue, orderTotal, balanceDue };
  }

  if (requestType === "custom") {
    const amount = roundMoney(customAmount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Enter a custom amount greater than zero.");
    }
    if (amount > balanceDue + 0.005) {
      throw new Error(`Custom amount cannot exceed the remaining balance ($${balanceDue.toFixed(2)}).`);
    }
    return { amount, orderTotal, balanceDue };
  }

  const { data: activity } = await supabase
    .from("booking_activities")
    .select("ticket_settings")
    .eq("id", booking.activity_id)
    .eq("business_id", businessId)
    .maybeSingle();

  let ticketSettings: Record<string, unknown> = {};
  const raw = activity?.ticket_settings;
  if (typeof raw === "string") {
    try {
      ticketSettings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      ticketSettings = {};
    }
  } else if (raw && typeof raw === "object") {
    ticketSettings = raw as Record<string, unknown>;
  }

  const onlinePayment = parseOnlinePaymentFromTicketSettings(ticketSettings);
  const checkout = calculateOnlineCheckoutAmounts(orderTotal, onlinePayment);
  let amount = roundMoney(checkout.chargeNow);

  if (customAmount != null && Number.isFinite(customAmount) && customAmount > 0) {
    amount = roundMoney(customAmount);
  }

  if (amount <= 0) {
    throw new Error("Could not calculate a deposit amount for this booking.");
  }
  if (amount > balanceDue + 0.005) {
    amount = balanceDue;
  }

  return { amount, orderTotal, balanceDue };
}

async function supersedePendingRequests(
  supabase: SupabaseClient,
  bookingId: string,
  cancelledBy?: string | null,
) {
  const now = new Date().toISOString();
  await supabase
    .from("booking_payment_requests")
    .update({
      status: "superseded",
      cancelled_at: now,
      cancelled_by: cancelledBy ?? null,
      updated_at: now,
    })
    .eq("booking_id", bookingId)
    .eq("status", "pending");
}

export async function sendBookingPaymentRequest(
  supabase: SupabaseClient,
  params: SendBookingPaymentRequestParams,
): Promise<{ sent: boolean; requestId: string; payUrl: string; amount: number; skipped?: boolean; reason?: string }> {
  const {
    businessId,
    bookingId,
    requestType,
    amount: amountOverride,
    dueAt,
    sentBy,
    resend = false,
    requestId: existingRequestId,
  } = params;

  const { data: booking, error: bookingErr } = await supabase
    .from("bookings")
    .select(`
      id,
      booking_number,
      customer_email,
      secondary_customer_email,
      customer_id,
      booking_date,
      booking_time,
      activity_id,
      deposit_due_at,
      payment_status,
      order_total,
      approved_at,
      requires_approval
    `)
    .eq("id", bookingId)
    .eq("business_id", businessId)
    .single();

  if (bookingErr || !booking) {
    throw new Error("Booking not found");
  }

  if (booking.payment_status === "paid") {
    throw new Error("This booking is already fully paid.");
  }

  if (booking.requires_approval && !booking.approved_at) {
    throw new Error("This booking must be approved before sending a payment request.");
  }

  const pricing = await resolvePaymentRequestAmount(
    supabase,
    booking,
    businessId,
    requestType,
    amountOverride,
  );

  const amount = pricing.amount;
  const now = new Date().toISOString();
  const dueDate = dueAt || booking.deposit_due_at;
  const requestId = existingRequestId || crypto.randomUUID();
  const campaignId = `${bookingId}-payment-request-${requestId}`;

  if (!resend) {
    const { data: existing } = await supabase
      .from("mail_campaign_sends")
      .select("id")
      .eq("campaign_id", campaignId)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return {
        sent: false,
        skipped: true,
        reason: "already_sent",
        requestId,
        payUrl: "",
        amount,
      };
    }
  }

  await supersedePendingRequests(supabase, bookingId, sentBy ?? null);

  const { error: insertErr } = await supabase.from("booking_payment_requests").insert({
    id: requestId,
    business_id: businessId,
    booking_id: bookingId,
    request_type: requestType,
    amount,
    order_total: pricing.orderTotal,
    balance_before_request: pricing.balanceDue,
    due_at: dueDate,
    status: "pending",
    sent_at: now,
    sent_by: sentBy ?? null,
    campaign_id: campaignId,
    created_at: now,
    updated_at: now,
  });

  if (insertErr) {
    console.error("[sendBookingPaymentRequest] insert failed:", insertErr);
    throw new Error("Failed to create payment request");
  }

  const recipients = await resolveBookingMailRecipients(supabase, booking, businessId);
  if (!recipients) {
    throw new Error("No recipient email on this booking");
  }

  const [{ data: activity }] = await Promise.all([
    supabase.from("booking_activities").select("activity_name").eq("id", booking.activity_id).single(),
  ]);

  const business = await loadBookingEmailBusinessContext(supabase, businessId);
  const recipientName = await resolveBookingRecipientName(supabase, booking, businessId);
  const manageToken = await getOrCreateBookingSelfServiceToken(supabase, bookingId, businessId);
  const manageUrl = buildBookingManageUrl(businessId, manageToken);
  const payUrl = `${manageUrl}?pay=1`;
  const dueLabel = dueDate
    ? new Date(dueDate).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })
    : "soon";

  const email = buildBookingPaymentRequestEmail({
    business,
    recipientName,
    bookingNumber: booking.booking_number || booking.id.slice(0, 8),
    activityName: activity?.activity_name || "Activity",
    bookingDate: String(booking.booking_date),
    bookingTime: String(booking.booking_time),
    requestType,
    amount,
    orderTotal: pricing.orderTotal > 0 ? pricing.orderTotal : null,
    balanceDue: pricing.balanceDue > 0 ? pricing.balanceDue : null,
    dueLabel,
    payUrl,
    manageUrl,
    approved: !!booking.approved_at,
  });

  const mailResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify(withBookingMailRecipients({
      businessId,
      campaignId,
      contactId: booking.customer_id || bookingId,
      emailType: "transactional",
      fromEmail: BOOKING_TRANSACTIONAL_FROM_EMAIL,
      fromName: `${business.name} - Bookings`,
      subject: email.subject,
      html: email.html,
      text: email.text,
    }, recipients)),
  });

  if (!mailResponse.ok) {
    const errText = await mailResponse.text();
    await supabase
      .from("booking_payment_requests")
      .update({ status: "cancelled", cancelled_at: now, updated_at: now })
      .eq("id", requestId);
    throw new Error(`Failed to send email: ${errText}`);
  }

  await supabase
    .from("bookings")
    .update({
      payment_request_sent_at: now,
      payment_request_sent_by: sentBy ?? null,
      active_payment_request_id: requestId,
      deposit_due_at: dueDate || booking.deposit_due_at,
      updated_at: now,
    })
    .eq("id", bookingId)
    .eq("business_id", businessId);

  return { sent: true, requestId, payUrl, amount };
}

export async function cancelBookingPaymentRequest(
  supabase: SupabaseClient,
  businessId: string,
  bookingId: string,
  cancelledBy?: string | null,
  requestId?: string | null,
): Promise<{ cancelled: boolean }> {
  const now = new Date().toISOString();
  let query = supabase
    .from("booking_payment_requests")
    .update({
      status: "cancelled",
      cancelled_at: now,
      cancelled_by: cancelledBy ?? null,
      updated_at: now,
    })
    .eq("booking_id", bookingId)
    .eq("business_id", businessId)
    .eq("status", "pending");

  if (requestId) {
    query = query.eq("id", requestId);
  }

  const { data, error } = await query.select("id");
  if (error) {
    throw new Error("Failed to cancel payment request");
  }

  if (!data?.length) {
    return { cancelled: false };
  }

  await supabase
    .from("bookings")
    .update({
      active_payment_request_id: null,
      updated_at: now,
    })
    .eq("id", bookingId)
    .eq("business_id", businessId);

  return { cancelled: true };
}

export async function getActivePaymentRequest(
  supabase: SupabaseClient,
  bookingId: string,
) {
  const { data } = await supabase
    .from("booking_payment_requests")
    .select("*")
    .eq("booking_id", bookingId)
    .eq("status", "pending")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data;
}

/** Staff: record a deposit/payment received outside automatic Helcim finalize (e.g. sync could not find txn). */
export async function recordManualBookingPayment(
  supabase: SupabaseClient,
  businessId: string,
  bookingId: string,
  {
    amount,
    recordedBy,
    transactionId = null,
    paymentRequestId = null,
    note = "Recorded manually by staff",
  }: {
    amount: number;
    recordedBy?: string | null;
    transactionId?: string | null;
    paymentRequestId?: string | null;
    note?: string | null;
  },
): Promise<{ recorded: boolean; paymentStatus: string; amountPaid: number }> {
  const { data: booking, error: bookingErr } = await supabase
    .from("bookings")
    .select("id, order_total, payment_status")
    .eq("id", bookingId)
    .eq("business_id", businessId)
    .single();

  if (bookingErr || !booking) {
    throw new Error("Booking not found");
  }

  const amountPaid = roundMoney(amount);
  if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
    throw new Error("Enter a payment amount greater than zero.");
  }

  const txnRef = String(transactionId || "").trim();
  const helcimInvoice = txnRef.startsWith("BP-") ? txnRef : null;
  const paymentMethod = helcimInvoice ? "helcim_hosted" : "manual";

  const orderTotal = roundMoney(Number(booking.order_total) || 0);
  const existingPaid = await sumCompletedPayments(supabase, bookingId);
  const newTotalPaid = roundMoney(existingPaid + amountPaid);
  if (orderTotal > 0 && newTotalPaid > orderTotal + 0.005) {
    throw new Error(`Amount would exceed the booking total ($${orderTotal.toFixed(2)}).`);
  }

  const isDeposit = orderTotal > newTotalPaid + 0.005;
  const paymentStatus = isDeposit ? "partial" : "paid";
  const now = new Date().toISOString();

  const { error: paymentError } = await supabase.from("booking_payments").insert({
    booking_id: bookingId,
    payment_type: isDeposit ? "deposit" : "full",
    amount_paid: amountPaid,
    deposit_amount: isDeposit ? amountPaid : null,
    remaining_balance: isDeposit ? roundMoney(Math.max(0, orderTotal - newTotalPaid)) : null,
    payment_method: paymentMethod,
    transaction_id: txnRef || note || "manual",
    status: "completed",
    created_at: now,
    updated_at: now,
  });

  if (paymentError) {
    throw new Error("Failed to record payment");
  }

  const bookingUpdate: Record<string, unknown> = {
    payment_status: paymentStatus,
    updated_at: now,
  };
  if (paymentStatus === "paid") {
    bookingUpdate.active_payment_request_id = null;
  }

  await supabase
    .from("bookings")
    .update(bookingUpdate)
    .eq("id", bookingId)
    .eq("business_id", businessId);

  if (paymentRequestId) {
    const { data: linkedRequest } = await supabase
      .from("booking_payment_requests")
      .select("id, amount, status")
      .eq("id", paymentRequestId)
      .eq("booking_id", bookingId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (
      linkedRequest?.status === "pending"
      && amountPaid >= roundMoney(Number(linkedRequest.amount)) - 0.005
    ) {
      await supabase
        .from("booking_payment_requests")
        .update({ status: "paid", updated_at: now })
        .eq("id", paymentRequestId);
    }
  } else if (paymentStatus === "paid") {
    await supabase
      .from("booking_payment_requests")
      .update({ status: "paid", updated_at: now })
      .eq("booking_id", bookingId)
      .eq("business_id", businessId)
      .eq("status", "pending");
  }

  await supabase
    .from("booking_pending_helcim")
    .update({ status: helcimInvoice ? "completed" : "superseded", updated_at: now })
    .eq("booking_id", bookingId)
    .eq("business_id", businessId)
    .eq("status", "pending");

  return { recorded: true, paymentStatus, amountPaid };
}

export async function sendBookingPaymentFollowUp(
  supabase: SupabaseClient,
  params: {
    businessId: string;
    bookingId: string;
    followUpType: BookingPaymentFollowUpType;
    sentBy?: string | null;
  },
): Promise<{ sent: boolean; payUrl: string; amountDue: number }> {
  const { businessId, bookingId, followUpType, sentBy } = params;

  if (!["overdue", "pending", "balance_after_party"].includes(followUpType)) {
    throw new Error("Invalid follow-up type");
  }

  const { data: booking, error: bookingErr } = await supabase
    .from("bookings")
    .select(`
      id,
      booking_number,
      customer_email,
      secondary_customer_email,
      customer_id,
      booking_date,
      booking_time,
      activity_id,
      deposit_due_at,
      payment_status,
      order_total,
      approved_at,
      requires_approval
    `)
    .eq("id", bookingId)
    .eq("business_id", businessId)
    .single();

  if (bookingErr || !booking) {
    throw new Error("Booking not found");
  }

  if (booking.payment_status === "paid") {
    throw new Error("This booking is already fully paid.");
  }

  if (booking.requires_approval && !booking.approved_at) {
    throw new Error("This booking must be approved before sending a payment follow-up.");
  }

  const orderTotal = roundMoney(Number(booking.order_total) || 0);
  const totalPaid = await sumCompletedPayments(supabase, bookingId);
  const balanceDue = roundMoney(Math.max(0, orderTotal - totalPaid));

  if (balanceDue <= 0.005) {
    throw new Error("Nothing left to pay on this booking.");
  }

  let amountDue = balanceDue;
  if (followUpType === "overdue" || followUpType === "pending") {
    const depositPricing = await resolvePaymentRequestAmount(
      supabase,
      booking,
      businessId,
      "deposit",
    );
    const depositOutstanding = roundMoney(Math.max(0, depositPricing.amount - totalPaid));
    if (depositOutstanding > 0.005) {
      amountDue = depositOutstanding;
    }
  }

  const recipients = await resolveBookingMailRecipients(supabase, booking, businessId);
  if (!recipients) {
    throw new Error("No recipient email on this booking");
  }

  const [{ data: activity }] = await Promise.all([
    supabase.from("booking_activities").select("activity_name").eq("id", booking.activity_id).single(),
  ]);

  const business = await loadBookingEmailBusinessContext(supabase, businessId);
  const recipientName = await resolveBookingRecipientName(supabase, booking, businessId);
  const manageToken = await getOrCreateBookingSelfServiceToken(supabase, bookingId, businessId);
  const manageUrl = buildBookingManageUrl(businessId, manageToken);
  const payUrl = `${manageUrl}?pay=1`;
  const dueDate = booking.deposit_due_at;
  const dueLabel = dueDate
    ? new Date(dueDate).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })
    : null;

  const email = buildBookingPaymentFollowUpEmail({
    business,
    recipientName,
    bookingNumber: booking.booking_number || booking.id.slice(0, 8),
    activityName: activity?.activity_name || "Activity",
    bookingDate: String(booking.booking_date),
    bookingTime: String(booking.booking_time),
    followUpType,
    amountDue,
    dueLabel,
    payUrl,
    manageUrl,
  });

  const now = new Date().toISOString();
  const campaignId = `${bookingId}-payment-followup-${followUpType}-${Date.now()}`;

  const mailResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify(withBookingMailRecipients({
      businessId,
      campaignId,
      contactId: booking.customer_id || bookingId,
      emailType: "transactional",
      fromEmail: BOOKING_TRANSACTIONAL_FROM_EMAIL,
      fromName: `${business.name} - Bookings`,
      subject: email.subject,
      html: email.html,
      text: email.text,
    }, recipients)),
  });

  if (!mailResponse.ok) {
    const errText = await mailResponse.text();
    throw new Error(`Failed to send email: ${errText}`);
  }

  await supabase
    .from("bookings")
    .update({
      payment_request_sent_at: now,
      payment_request_sent_by: sentBy ?? null,
      updated_at: now,
    })
    .eq("id", bookingId)
    .eq("business_id", businessId);

  return { sent: true, payUrl, amountDue };
}

export async function sendBookingPaymentCancelWarning(
  supabase: SupabaseClient,
  params: {
    businessId: string;
    bookingId: string;
    cancelDeadlineAt: string;
    sentBy?: string | null;
  },
): Promise<{ sent: boolean; payUrl: string; amountDue: number; cancelDeadlineAt: string }> {
  const { businessId, bookingId, sentBy } = params;
  const cancelDeadlineAt = String(params.cancelDeadlineAt || "").trim();
  if (!cancelDeadlineAt) {
    throw new Error("Cancel deadline is required");
  }

  const deadlineMs = new Date(cancelDeadlineAt).getTime();
  if (!Number.isFinite(deadlineMs)) {
    throw new Error("Invalid cancel deadline");
  }
  if (deadlineMs <= Date.now()) {
    throw new Error("Cancel deadline must be in the future");
  }

  const { data: booking, error: bookingErr } = await supabase
    .from("bookings")
    .select(`
      id,
      booking_number,
      customer_email,
      secondary_customer_email,
      customer_id,
      booking_date,
      booking_time,
      activity_id,
      deposit_due_at,
      payment_status,
      order_total,
      approved_at,
      requires_approval,
      status
    `)
    .eq("id", bookingId)
    .eq("business_id", businessId)
    .single();

  if (bookingErr || !booking) {
    throw new Error("Booking not found");
  }

  if (booking.status === "cancelled") {
    throw new Error("This booking is already cancelled");
  }

  if (booking.payment_status === "paid") {
    throw new Error("This booking is already fully paid.");
  }

  if (booking.requires_approval && !booking.approved_at) {
    throw new Error("This booking must be approved before sending a cancel warning.");
  }

  const orderTotal = roundMoney(Number(booking.order_total) || 0);
  const totalPaid = await sumCompletedPayments(supabase, bookingId);
  const balanceDue = roundMoney(Math.max(0, orderTotal - totalPaid));

  if (balanceDue <= 0.005) {
    throw new Error("Nothing left to pay on this booking.");
  }

  const depositPricing = await resolvePaymentRequestAmount(
    supabase,
    booking,
    businessId,
    "deposit",
  );
  const depositOutstanding = roundMoney(Math.max(0, depositPricing.amount - totalPaid));
  const amountDue = depositOutstanding > 0.005 ? depositOutstanding : balanceDue;

  const recipients = await resolveBookingMailRecipients(supabase, booking, businessId);
  if (!recipients) {
    throw new Error("No recipient email on this booking");
  }
  const [{ data: activity }] = await Promise.all([
    supabase.from("booking_activities").select("activity_name").eq("id", booking.activity_id).single(),
  ]);

  const business = await loadBookingEmailBusinessContext(supabase, businessId);
  const businessTimezone = await getBusinessTimezone(supabase, businessId);
  const recipientName = await resolveBookingRecipientName(supabase, booking, businessId);
  const manageToken = await getOrCreateBookingSelfServiceToken(supabase, bookingId, businessId);
  const manageUrl = buildBookingManageUrl(businessId, manageToken);
  const payUrl = `${manageUrl}?pay=1`;
  const cancelDeadlineLabel = formatDateTimeInBusinessTimezone(cancelDeadlineAt, businessTimezone);

  const email = buildBookingPaymentCancelWarningEmail({
    business,
    recipientName,
    bookingNumber: booking.booking_number || booking.id.slice(0, 8),
    activityName: activity?.activity_name || "Activity",
    bookingDate: String(booking.booking_date),
    bookingTime: String(booking.booking_time),
    amountDue,
    cancelDeadlineLabel,
    payUrl,
    manageUrl,
  });

  const now = new Date().toISOString();
  const campaignId = `${bookingId}-payment-cancel-warning-${Date.now()}`;

  const mailResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mail-send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify(withBookingMailRecipients({
      businessId,
      campaignId,
      contactId: booking.customer_id || bookingId,
      emailType: "transactional",
      fromEmail: BOOKING_TRANSACTIONAL_FROM_EMAIL,
      fromName: `${business.name} - Bookings`,
      subject: email.subject,
      html: email.html,
      text: email.text,
    }, recipients)),
  });

  if (!mailResponse.ok) {
    const errText = await mailResponse.text();
    throw new Error(`Failed to send email: ${errText}`);
  }

  await supabase
    .from("bookings")
    .update({
      payment_cancel_deadline_at: cancelDeadlineAt,
      payment_cancel_warning_sent_at: now,
      payment_cancel_warning_sent_by: sentBy ?? null,
      payment_request_sent_at: now,
      payment_request_sent_by: sentBy ?? null,
      updated_at: now,
    })
    .eq("id", bookingId)
    .eq("business_id", businessId);

  return { sent: true, payUrl, amountDue, cancelDeadlineAt };
}

export async function autoCancelBookingsPastPaymentDeadline(
  supabase: SupabaseClient,
): Promise<{ scanned: number; cancelled: number }> {
  const now = new Date().toISOString();

  const { data: rows, error } = await supabase
    .from("bookings")
    .select(`
      id,
      business_id,
      booking_number,
      status,
      payment_status,
      order_total,
      approved_at,
      requires_approval,
      payment_cancel_deadline_at
    `)
    .not("payment_cancel_deadline_at", "is", null)
    .lte("payment_cancel_deadline_at", now)
    .neq("status", "cancelled")
    .neq("status", "completed")
    .neq("payment_status", "paid");

  if (error) {
    throw new Error(`Failed to load overdue payment cancellations: ${error.message}`);
  }

  let cancelled = 0;
  for (const booking of rows || []) {
    const orderTotal = roundMoney(Number(booking.order_total) || 0);
    const totalPaid = await sumCompletedPayments(supabase, booking.id);
    const balanceDue = roundMoney(Math.max(0, orderTotal - totalPaid));
    if (balanceDue <= 0.005) {
      await supabase
        .from("bookings")
        .update({
          payment_cancel_deadline_at: null,
          updated_at: now,
        })
        .eq("id", booking.id);
      continue;
    }

    const businessTimezone = await getBusinessTimezone(supabase, booking.business_id);
    const deadlineLabel = booking.payment_cancel_deadline_at
      ? formatDateTimeInBusinessTimezone(String(booking.payment_cancel_deadline_at), businessTimezone)
      : "the payment deadline";

    const previousStatus = booking.status || "confirmed";
    const reason = `Automatically cancelled — deposit not received by ${deadlineLabel}`;

    const { error: updateErr } = await supabase
      .from("bookings")
      .update({
        status: "cancelled",
        status_before_cancellation: previousStatus,
        cancellation_reason: reason,
        cancelled_at: now,
        payment_cancel_deadline_at: null,
        active_payment_request_id: null,
        updated_at: now,
      })
      .eq("id", booking.id)
      .eq("business_id", booking.business_id)
      .neq("status", "cancelled");

    if (updateErr) {
      console.error("[autoCancelBookingsPastPaymentDeadline] cancel failed:", booking.id, updateErr);
      continue;
    }

    await supabase
      .from("booking_payment_requests")
      .update({
        status: "cancelled",
        cancelled_at: now,
        updated_at: now,
      })
      .eq("booking_id", booking.id)
      .eq("business_id", booking.business_id)
      .eq("status", "pending");

    try {
      await sendBookingCancellationEmail(supabase, {
        businessId: booking.business_id,
        bookingId: booking.id,
        cancelledBy: "system",
        reason,
        cancelledAt: now,
      });
    } catch (emailErr) {
      console.error("[autoCancelBookingsPastPaymentDeadline] cancellation email failed:", booking.id, emailErr);
    }

    await insertBookingHistory(supabase, {
      businessId: booking.business_id,
      bookingId: booking.id,
      actionType: "booking.cancelled",
      summary: "Booking cancelled automatically",
      details: {
        reason,
        changes: [{ field: "Status", from: previousStatus, to: "cancelled" }],
      },
    });

    cancelled += 1;
  }

  return { scanned: rows?.length || 0, cancelled };
}
