import { parseActivityTicketSettings } from './bookingTicketAssignment';

export const ONLINE_PAYMENT_MODES = {
  REQUIRE_FULL: 'require_full',
  REQUIRE_DEPOSIT: 'require_deposit',
};

export const DEPOSIT_TYPES = {
  FIXED: 'fixed',
  PERCENTAGE: 'percentage',
};

export const defaultOnlinePaymentSettings = () => ({
  mode: ONLINE_PAYMENT_MODES.REQUIRE_FULL,
  depositType: DEPOSIT_TYPES.FIXED,
  depositFixedAmount: '',
  depositPercentage: '',
  /** When true (default), customer pays online immediately. When false, staff must approve first. */
  autoApprove: true,
  /** Days after staff approval that the customer has to pay their deposit. */
  depositDueDaysAfterApproval: 7,
});

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

export const parseOnlinePaymentSettings = (ticketSettingsRaw) => {
  const parsed = parseActivityTicketSettings(ticketSettingsRaw);
  const raw = parsed?.online_payment && typeof parsed.online_payment === 'object'
    ? parsed.online_payment
    : {};

  const mode = raw.mode === ONLINE_PAYMENT_MODES.REQUIRE_DEPOSIT
    ? ONLINE_PAYMENT_MODES.REQUIRE_DEPOSIT
    : ONLINE_PAYMENT_MODES.REQUIRE_FULL;

  const depositType = raw.deposit_type === DEPOSIT_TYPES.PERCENTAGE
    ? DEPOSIT_TYPES.PERCENTAGE
    : DEPOSIT_TYPES.FIXED;

  return {
    mode,
    depositType,
    depositFixedAmount:
      raw.deposit_fixed_amount != null && raw.deposit_fixed_amount !== ''
        ? String(raw.deposit_fixed_amount)
        : '',
    depositPercentage:
      raw.deposit_percentage != null && raw.deposit_percentage !== ''
        ? String(raw.deposit_percentage)
        : '',
    autoApprove: raw.auto_approve !== false,
    depositDueDaysAfterApproval: (() => {
      const parsed = Number.parseInt(String(raw.deposit_due_days_after_approval ?? 7), 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
    })(),
  };
};

export const serializeOnlinePaymentSettings = (settings = {}) => {
  const mode = settings.mode === ONLINE_PAYMENT_MODES.REQUIRE_DEPOSIT
    ? ONLINE_PAYMENT_MODES.REQUIRE_DEPOSIT
    : ONLINE_PAYMENT_MODES.REQUIRE_FULL;

  const depositType = settings.depositType === DEPOSIT_TYPES.PERCENTAGE
    ? DEPOSIT_TYPES.PERCENTAGE
    : DEPOSIT_TYPES.FIXED;

  const fixedAmount = roundMoney(settings.depositFixedAmount);
  const percentage = Number.parseFloat(settings.depositPercentage);

  return {
    mode,
    deposit_type: depositType,
    deposit_fixed_amount: mode === ONLINE_PAYMENT_MODES.REQUIRE_DEPOSIT && depositType === DEPOSIT_TYPES.FIXED
      ? (Number.isFinite(fixedAmount) && fixedAmount > 0 ? fixedAmount : null)
      : null,
    deposit_percentage: mode === ONLINE_PAYMENT_MODES.REQUIRE_DEPOSIT && depositType === DEPOSIT_TYPES.PERCENTAGE
      ? (Number.isFinite(percentage) && percentage > 0 ? Math.min(100, percentage) : null)
      : null,
    auto_approve: settings.autoApprove !== false,
    deposit_due_days_after_approval: (() => {
      const days = Number.parseInt(String(settings.depositDueDaysAfterApproval ?? 7), 10);
      return Number.isFinite(days) && days > 0 ? days : 7;
    })(),
  };
};

/**
 * @param {number} orderTotalWithTax Full booking total including tax
 * @param {object} settings Parsed or raw online payment settings
 */
export const calculateOnlineCheckoutAmounts = (orderTotalWithTax, settingsInput = {}) => {
  const settings = settingsInput?.mode
    ? settingsInput
    : parseOnlinePaymentSettings(settingsInput);

  const orderTotal = roundMoney(Math.max(0, orderTotalWithTax));

  if (settings.mode !== ONLINE_PAYMENT_MODES.REQUIRE_DEPOSIT) {
    return {
      mode: ONLINE_PAYMENT_MODES.REQUIRE_FULL,
      orderTotal,
      chargeNow: orderTotal,
      balanceDue: 0,
      isDeposit: false,
      depositType: null,
    };
  }

  let chargeNow = orderTotal;
  if (settings.depositType === DEPOSIT_TYPES.PERCENTAGE) {
    const pct = Number.parseFloat(settings.depositPercentage);
    if (Number.isFinite(pct) && pct > 0) {
      chargeNow = roundMoney(orderTotal * (Math.min(100, pct) / 100));
    }
  } else {
    const fixed = roundMoney(settings.depositFixedAmount);
    if (Number.isFinite(fixed) && fixed > 0) {
      chargeNow = Math.min(orderTotal, fixed);
    }
  }

  chargeNow = roundMoney(Math.max(0, Math.min(orderTotal, chargeNow)));
  const balanceDue = roundMoney(Math.max(0, orderTotal - chargeNow));

  return {
    mode: ONLINE_PAYMENT_MODES.REQUIRE_DEPOSIT,
    orderTotal,
    chargeNow,
    balanceDue,
    isDeposit: balanceDue > 0.005,
    depositType: settings.depositType,
  };
};

export const activityRequiresStaffApproval = (ticketSettingsRaw) => {
  const settings = parseOnlinePaymentSettings(ticketSettingsRaw);
  return settings.autoApprove === false;
};

/** Staff must approve before manual payment requests (auto-send on approve still allowed). */
export const bookingBlocksPaymentRequestUntilApproved = (booking) =>
  Boolean(booking?.requires_approval) && !booking?.approved_at;

/** Whether staff can return an approved request to pending without cancelling the booking. */
export const canRevokeBookingApproval = (booking) => {
  if (!booking?.requires_approval || !booking?.approved_at) return false;
  if (booking.status === 'cancelled') return false;
  if (['checked_in', 'completed'].includes(booking.status)) return false;
  if (['partial', 'paid', 'refunded'].includes(booking.payment_status)) return false;
  return true;
};

export const revokeBookingApprovalBlockedReason = (booking) => {
  if (!booking?.requires_approval || !booking?.approved_at) {
    return 'This booking is not approved.';
  }
  if (booking.status === 'cancelled') return 'Cannot change approval on a cancelled booking.';
  if (['checked_in', 'completed'].includes(booking.status)) {
    return 'Cannot remove approval after the party has checked in or completed.';
  }
  if (booking.payment_status === 'partial' || booking.payment_status === 'paid') {
    return 'Cannot remove approval after a deposit or payment has been received.';
  }
  if (booking.payment_status === 'refunded') {
    return 'Cannot remove approval on a refunded booking.';
  }
  return null;
};

export const validateOnlinePaymentSettings = (settings = {}) => {
  if (settings.autoApprove === false) {
    const days = Number.parseInt(String(settings.depositDueDaysAfterApproval ?? 7), 10);
    if (!Number.isFinite(days) || days <= 0) {
      return { ok: false, message: 'Enter how many days the customer has to pay the deposit after approval.' };
    }
  }

  if (settings.mode !== ONLINE_PAYMENT_MODES.REQUIRE_DEPOSIT) {
    return { ok: true };
  }

  if (settings.depositType === DEPOSIT_TYPES.PERCENTAGE) {
    const pct = Number.parseFloat(settings.depositPercentage);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return { ok: false, message: 'Enter a deposit percentage between 1 and 100.' };
    }
    return { ok: true };
  }

  const fixed = roundMoney(settings.depositFixedAmount);
  if (!Number.isFinite(fixed) || fixed <= 0) {
    return { ok: false, message: 'Enter a deposit fixed amount greater than zero.' };
  }
  return { ok: true };
};

export const formatOnlinePaymentModeLabel = (mode) => {
  if (mode === ONLINE_PAYMENT_MODES.REQUIRE_DEPOSIT) return 'Require payment of deposit';
  return 'Require online payment';
};
