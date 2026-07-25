export const ONLINE_PAYMENT_MODES = {
  REQUIRE_FULL: "require_full",
  REQUIRE_DEPOSIT: "require_deposit",
} as const;

export const DEPOSIT_TYPES = {
  FIXED: "fixed",
  PERCENTAGE: "percentage",
} as const;

export type OnlinePaymentMode = typeof ONLINE_PAYMENT_MODES[keyof typeof ONLINE_PAYMENT_MODES];
export type DepositType = typeof DEPOSIT_TYPES[keyof typeof DEPOSIT_TYPES];

export interface ParsedOnlinePaymentSettings {
  mode: OnlinePaymentMode;
  depositType: DepositType;
  depositFixedAmount: number | null;
  depositPercentage: number | null;
  autoApprove: boolean;
  depositDueDaysAfterApproval: number;
}

const roundMoney = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

export const parseOnlinePaymentFromTicketSettings = (
  ticketSettings: Record<string, unknown> | null | undefined,
): ParsedOnlinePaymentSettings => {
  const raw =
    ticketSettings?.online_payment && typeof ticketSettings.online_payment === "object"
      ? (ticketSettings.online_payment as Record<string, unknown>)
      : {};

  const mode =
    raw.mode === ONLINE_PAYMENT_MODES.REQUIRE_DEPOSIT
      ? ONLINE_PAYMENT_MODES.REQUIRE_DEPOSIT
      : ONLINE_PAYMENT_MODES.REQUIRE_FULL;

  const depositType =
    raw.deposit_type === DEPOSIT_TYPES.PERCENTAGE
      ? DEPOSIT_TYPES.PERCENTAGE
      : DEPOSIT_TYPES.FIXED;

  const fixedRaw = raw.deposit_fixed_amount;
  const pctRaw = raw.deposit_percentage;
  const daysRaw = raw.deposit_due_days_after_approval;

  const depositDueDays = Number.parseInt(String(daysRaw ?? 7), 10);

  return {
    mode,
    depositType,
    depositFixedAmount:
      fixedRaw != null && fixedRaw !== "" && Number.isFinite(Number(fixedRaw))
        ? roundMoney(Number(fixedRaw))
        : null,
    depositPercentage:
      pctRaw != null && pctRaw !== "" && Number.isFinite(Number(pctRaw))
        ? Math.min(100, Number(pctRaw))
        : null,
    autoApprove: raw.auto_approve !== false,
    depositDueDaysAfterApproval:
      Number.isFinite(depositDueDays) && depositDueDays > 0 ? depositDueDays : 7,
  };
};

export const calculateOnlineCheckoutAmounts = (
  orderTotalWithTax: number,
  settings: ParsedOnlinePaymentSettings,
) => {
  const orderTotal = roundMoney(Math.max(0, orderTotalWithTax));

  if (settings.mode !== ONLINE_PAYMENT_MODES.REQUIRE_DEPOSIT) {
    return {
      mode: ONLINE_PAYMENT_MODES.REQUIRE_FULL as OnlinePaymentMode,
      orderTotal,
      chargeNow: orderTotal,
      balanceDue: 0,
      isDeposit: false,
    };
  }

  let chargeNow = orderTotal;
  if (settings.depositType === DEPOSIT_TYPES.PERCENTAGE) {
    if (settings.depositPercentage != null && settings.depositPercentage > 0) {
      chargeNow = roundMoney(orderTotal * (settings.depositPercentage / 100));
    }
  } else if (settings.depositFixedAmount != null && settings.depositFixedAmount > 0) {
    chargeNow = Math.min(orderTotal, settings.depositFixedAmount);
  }

  chargeNow = roundMoney(Math.max(0, Math.min(orderTotal, chargeNow)));
  const balanceDue = roundMoney(Math.max(0, orderTotal - chargeNow));

  return {
    mode: ONLINE_PAYMENT_MODES.REQUIRE_DEPOSIT as OnlinePaymentMode,
    orderTotal,
    chargeNow,
    balanceDue,
    isDeposit: balanceDue > 0.005,
  };
};

export const amountsMatchWithinCent = (a: number, b: number) =>
  Math.abs(roundMoney(a) - roundMoney(b)) < 0.011;

export const activityRequiresStaffApproval = (
  ticketSettings: Record<string, unknown> | null | undefined,
) => !parseOnlinePaymentFromTicketSettings(ticketSettings).autoApprove;
