import { getEffectiveBookingPricingSummary, formatBookingMoney } from './bookingPricing';
import {
  calculateOnlineCheckoutAmounts,
  parseOnlinePaymentSettings,
} from './bookingPaymentSettings';

export const PAYMENT_DASHBOARD_BUCKETS = {
  OVERDUE: 'overdue',
  PENDING: 'pending',
  BALANCE_AFTER_PARTY: 'balance_after_party',
};

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

export function getTodayDateString(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function normalizeActivePaymentRequest(booking) {
  const raw = booking?.active_payment_request;
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] || null : raw;
}

export function isBookingEligibleForPaymentTracking(booking) {
  if (!booking?.id) return false;
  if (booking.status === 'cancelled' || booking.status === 'completed') return false;
  if (booking.requires_approval && !booking.approved_at) return false;
  return true;
}

export function getBookingDepositDueDate(booking) {
  const activeRequest = normalizeActivePaymentRequest(booking);
  if (activeRequest?.status === 'pending' && activeRequest.due_at) {
    return String(activeRequest.due_at);
  }
  if (booking?.deposit_due_at) {
    return String(booking.deposit_due_at);
  }
  return null;
}

export function getBookingDepositRequiredAmount(booking, pricing) {
  const orderTotal = Number(booking?.order_total) || pricing?.totalPrice || 0;
  if (orderTotal <= 0) return orderTotal;

  const settings = parseOnlinePaymentSettings(booking?.booking_activities?.ticket_settings);
  return calculateOnlineCheckoutAmounts(orderTotal, settings).chargeNow;
}

export function isDepositDueDatePassed(dueAt, todayStr) {
  if (!dueAt) return false;
  const dueDay = String(dueAt).slice(0, 10);
  return dueDay < todayStr;
}

export function isPartyDatePassed(booking, todayStr) {
  const partyDate = String(booking?.booking_date || '').slice(0, 10);
  if (!partyDate) return false;
  return partyDate < todayStr;
}

export function hasOutstandingDeposit(booking, pricing) {
  if (pricing.totalDue <= 0.005) return false;
  const depositRequired = getBookingDepositRequiredAmount(booking, pricing);
  if (depositRequired <= 0.005) return false;
  return pricing.totalPaid + 0.005 < depositRequired;
}

export function classifyBookingPaymentDashboard(booking, options = {}) {
  if (!isBookingEligibleForPaymentTracking(booking)) return null;

  const pricing = getEffectiveBookingPricingSummary(booking);
  if (pricing.totalDue <= 0.005) return null;

  const todayStr = options.todayStr || getTodayDateString(options.now);
  const dueDate = getBookingDepositDueDate(booking);
  const activeRequest = normalizeActivePaymentRequest(booking);
  const depositOutstanding = hasOutstandingDeposit(booking, pricing);
  const partyPassed = isPartyDatePassed(booking, todayStr);

  if (partyPassed) {
    return {
      bucket: PAYMENT_DASHBOARD_BUCKETS.BALANCE_AFTER_PARTY,
      pricing,
      dueDate,
      amountDue: pricing.totalDue,
      detailLabel: `${formatBookingMoney(pricing.totalDue)} balance due`,
    };
  }

  if (
    depositOutstanding
    && dueDate
    && isDepositDueDatePassed(dueDate, todayStr)
  ) {
    const depositRequired = getBookingDepositRequiredAmount(booking, pricing);
    const depositDue = roundMoney(Math.max(0, depositRequired - pricing.totalPaid));
    return {
      bucket: PAYMENT_DASHBOARD_BUCKETS.OVERDUE,
      pricing,
      dueDate,
      amountDue: depositDue > 0.005 ? depositDue : pricing.totalDue,
      detailLabel: `Deposit overdue · ${formatBookingMoney(depositDue > 0.005 ? depositDue : pricing.totalDue)}`,
    };
  }

  const hasPendingRequest = activeRequest?.status === 'pending';
  const awaitingPayment =
    hasPendingRequest
    || depositOutstanding
    || booking.payment_status === 'unpaid'
    || booking.payment_status === 'partial';

  if (awaitingPayment) {
    const amountDue = activeRequest?.amount
      ? roundMoney(Number(activeRequest.amount))
      : pricing.totalDue;
    let detailLabel = `${formatBookingMoney(amountDue)} due`;
    if (dueDate) {
      detailLabel = `Due ${String(dueDate).slice(0, 10)} · ${formatBookingMoney(amountDue)}`;
    } else if (hasPendingRequest) {
      detailLabel = `Payment request sent · ${formatBookingMoney(amountDue)}`;
    }

    return {
      bucket: PAYMENT_DASHBOARD_BUCKETS.PENDING,
      pricing,
      dueDate,
      amountDue,
      detailLabel,
    };
  }

  return null;
}

export function buildBookingPaymentDashboardQueues(bookings = [], options = {}) {
  const queues = {
    [PAYMENT_DASHBOARD_BUCKETS.OVERDUE]: [],
    [PAYMENT_DASHBOARD_BUCKETS.PENDING]: [],
    [PAYMENT_DASHBOARD_BUCKETS.BALANCE_AFTER_PARTY]: [],
  };

  (bookings || []).forEach((booking) => {
    const classified = classifyBookingPaymentDashboard(booking, options);
    if (!classified) return;
    queues[classified.bucket].push({
      booking,
      ...classified,
    });
  });

  const sortByDueDate = (a, b) => {
    const aDue = a.dueDate ? String(a.dueDate).slice(0, 10) : '9999-99-99';
    const bDue = b.dueDate ? String(b.dueDate).slice(0, 10) : '9999-99-99';
    return aDue.localeCompare(bDue);
  };

  const sortByPartyDate = (a, b) =>
    String(a.booking?.booking_date || '').localeCompare(String(b.booking?.booking_date || ''));

  queues[PAYMENT_DASHBOARD_BUCKETS.OVERDUE].sort(sortByDueDate);
  queues[PAYMENT_DASHBOARD_BUCKETS.PENDING].sort(sortByDueDate);
  queues[PAYMENT_DASHBOARD_BUCKETS.BALANCE_AFTER_PARTY].sort(sortByPartyDate);

  return queues;
}
