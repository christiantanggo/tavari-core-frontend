/**
 * booking_types.cancellation_rules — two bands split by notice_split_hours (default 48):
 * - Early: hours until start >= notice_split_hours
 * - Late: 0 < hours until start < notice_split_hours
 *
 * Canonical keys:
 * - notice_split_hours (number, default 48)
 * - early_cancel_mode, late_cancel_mode: refund_money | refund_credit | contact_business | cancel_only
 * - early_deposit_cancel_policy, late_deposit_cancel_policy: follow_cancel_mode | credit_only | non_refundable
 * - allow_self_service_reschedule, min_hours_before_reschedule
 * - cancel_contact_phone, cancel_contact_email
 *
 * Legacy (single-rule) categories are migrated in normalizeCancellationRules().
 */

export type CancelMode = "refund_money" | "refund_credit" | "contact_business" | "cancel_only";

export type DepositCancelPolicy = "follow_cancel_mode" | "credit_only" | "non_refundable";

export type CancellationBand = "early" | "late";

export type PaymentSummaryRow = {
  payment_type?: string | null;
  status?: string | null;
  amount_paid?: number | null;
};

export type NormalizedCancellationRules = {
  noticeSplitHours: number;
  earlyCancelMode: CancelMode;
  earlyDepositPolicy: DepositCancelPolicy;
  lateCancelMode: CancelMode;
  lateDepositPolicy: DepositCancelPolicy;
  rescheduleEnabled: boolean;
  minHoursBeforeReschedule: number | null;
  contactPhone: string | null;
  contactEmail: string | null;
};

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function parseCancelMode(raw: unknown, fallback: CancelMode): CancelMode {
  const modeRaw = String(raw ?? "").toLowerCase();
  if (modeRaw === "refund_credit" || modeRaw === "store_credit" || modeRaw === "issue_store_credit") {
    return "refund_credit";
  }
  if (modeRaw === "contact_business" || modeRaw === "contact_only" || modeRaw === "contact") {
    return "contact_business";
  }
  if (
    modeRaw === "cancel_only" ||
    modeRaw === "forfeit" ||
    modeRaw === "no_refund" ||
    modeRaw === "booking_only"
  ) {
    return "cancel_only";
  }
  if (modeRaw === "refund_money" || modeRaw === "online_refund") return "refund_money";
  return fallback;
}

function parseDepositPolicy(raw: unknown, fallback: DepositCancelPolicy): DepositCancelPolicy {
  const depositRaw = String(raw ?? "follow_cancel_mode").toLowerCase();
  if (depositRaw === "credit_only") return "credit_only";
  if (depositRaw === "non_refundable" || depositRaw === "forfeit") return "non_refundable";
  return fallback;
}

export function normalizeCancellationRules(
  raw: Record<string, unknown> | null | undefined,
): NormalizedCancellationRules {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const hasNewShape =
    r.early_cancel_mode != null ||
    r.late_cancel_mode != null ||
    r.notice_split_hours != null;

  let noticeSplitHours = num(r.notice_split_hours) ?? 48;
  if (noticeSplitHours < 1) noticeSplitHours = 48;

  let earlyCancelMode: CancelMode = "refund_money";
  let earlyDepositPolicy: DepositCancelPolicy = "follow_cancel_mode";
  let lateCancelMode: CancelMode = "contact_business";
  let lateDepositPolicy: DepositCancelPolicy = "non_refundable";

  if (hasNewShape) {
    earlyCancelMode = parseCancelMode(r.early_cancel_mode, "refund_money");
    earlyDepositPolicy = parseDepositPolicy(r.early_deposit_cancel_policy, "follow_cancel_mode");
    lateCancelMode = parseCancelMode(r.late_cancel_mode, "contact_business");
    lateDepositPolicy = parseDepositPolicy(r.late_deposit_cancel_policy, "non_refundable");
  } else {
    /** Legacy single-rule row → early = old behavior; late = strict defaults */
    const legacyMode = parseCancelMode(r.self_service_cancel_mode ?? r.cancel_mode, "refund_money");
    const legacyDeposit = parseDepositPolicy(r.deposit_cancel_policy ?? r.deposit_refund_mode, "follow_cancel_mode");
    earlyCancelMode = legacyMode;
    earlyDepositPolicy = legacyDeposit;
    lateCancelMode = "contact_business";
    lateDepositPolicy = "non_refundable";
    /** Old min_hours_before_cancel often meant “must cancel at least N hours before” — reuse as split when set */
    const legacySplit =
      num(r.min_hours_before_cancel) ??
      num(r.self_service_cancel_hours) ??
      num(r.cancel_hours_before) ??
      num(r.cancellation_hours) ??
      num(r.min_cancel_notice_hours);
    if (legacySplit != null && legacySplit >= 1) {
      noticeSplitHours = legacySplit;
    }
  }

  const rescheduleEnabled =
    r.allow_self_service_reschedule !== false &&
    r.self_service_reschedule_enabled !== false &&
    r.disable_self_service_reschedule !== true;

  const minHoursBeforeReschedule =
    num(r.min_hours_before_reschedule) ??
    num(r.self_service_reschedule_hours) ??
    num(r.reschedule_hours_before) ??
    num(r.min_reschedule_notice_hours) ??
    null;

  const contactPhone =
    typeof r.cancel_contact_phone === "string" && r.cancel_contact_phone.trim()
      ? r.cancel_contact_phone.trim()
      : typeof r.contact_phone === "string" && r.contact_phone.trim()
        ? r.contact_phone.trim()
        : null;

  const contactEmail =
    typeof r.cancel_contact_email === "string" && r.cancel_contact_email.trim()
      ? r.cancel_contact_email.trim()
      : typeof r.contact_email === "string" && r.contact_email.trim()
        ? r.contact_email.trim()
        : null;

  return {
    noticeSplitHours,
    earlyCancelMode,
    earlyDepositPolicy,
    lateCancelMode,
    lateDepositPolicy,
    rescheduleEnabled,
    minHoursBeforeReschedule,
    contactPhone,
    contactEmail,
  };
}

export function hoursUntilBooking(booking: {
  booking_date?: string | null;
  booking_time?: string | null;
}): number | null {
  if (!booking?.booking_date || !booking?.booking_time) return null;
  const dt = new Date(`${booking.booking_date}T${booking.booking_time}`);
  if (!Number.isFinite(dt.getTime())) return null;
  return (dt.getTime() - Date.now()) / (1000 * 60 * 60);
}

export function cancellationBandForHours(
  hoursUntil: number | null,
  noticeSplitHours: number,
): CancellationBand | null {
  if (hoursUntil == null || hoursUntil <= 0) return null;
  return hoursUntil >= noticeSplitHours ? "early" : "late";
}

export function selectBandRules(
  rules: NormalizedCancellationRules,
  band: CancellationBand,
): { cancelMode: CancelMode; depositPolicy: DepositCancelPolicy } {
  if (band === "early") {
    return { cancelMode: rules.earlyCancelMode, depositPolicy: rules.earlyDepositPolicy };
  }
  return { cancelMode: rules.lateCancelMode, depositPolicy: rules.lateDepositPolicy };
}

export function passesMinHours(hoursUntil: number | null, minHours: number | null): boolean {
  if (hoursUntil == null) return false;
  if (hoursUntil <= 0) return false;
  if (minHours == null || minHours <= 0) return true;
  return hoursUntil >= minHours;
}

function completedPayments(payments: PaymentSummaryRow[]) {
  return payments.filter((p) => p.status === "completed");
}

export function totalCompletedPaid(payments: PaymentSummaryRow[]): number {
  return completedPayments(payments).reduce((s, p) => s + Number(p.amount_paid || 0), 0);
}

function hasDepositPayment(payments: PaymentSummaryRow[]): boolean {
  return completedPayments(payments).some((p) => p.payment_type === "deposit");
}

export function canSelfServiceCancelByRules(
  rules: NormalizedCancellationRules,
  booking: { status?: string | null; booking_date?: string | null; booking_time?: string | null },
  payments: PaymentSummaryRow[],
): boolean {
  if (!booking || !["pending", "confirmed"].includes(String(booking.status || ""))) return false;
  const hu = hoursUntilBooking(booking);
  const band = cancellationBandForHours(hu, rules.noticeSplitHours);
  if (band == null) return false;
  const { cancelMode } = selectBandRules(rules, band);
  return cancelMode !== "contact_business";
}

export function canSelfServiceRescheduleByRules(
  rules: NormalizedCancellationRules,
  booking: { status?: string | null; booking_date?: string | null; booking_time?: string | null },
): boolean {
  if (!rules.rescheduleEnabled) return false;
  if (!booking || !["pending", "confirmed"].includes(String(booking.status || ""))) return false;
  const hu = hoursUntilBooking(booking);
  return passesMinHours(hu, rules.minHoursBeforeReschedule);
}

export type PaymentSettlement = "helcim_refund" | "loyalty_credit" | "none";

export function resolveSettlementOnCancel(
  rules: NormalizedCancellationRules,
  payments: PaymentSummaryRow[],
  hoursUntil: number | null,
): { settlement: PaymentSettlement; amount: number } {
  const sum = totalCompletedPaid(payments);
  if (sum <= 0) return { settlement: "none", amount: 0 };

  const band = cancellationBandForHours(hoursUntil, rules.noticeSplitHours);
  if (band == null) return { settlement: "none", amount: 0 };

  const { cancelMode, depositPolicy } = selectBandRules(rules, band);

  /** Cancel booking online only — no card refund, no store credit (payment rows unchanged). */
  if (cancelMode === "cancel_only") {
    return { settlement: "none", amount: 0 };
  }

  const deposit = hasDepositPayment(payments);

  if (deposit && depositPolicy === "non_refundable") {
    return { settlement: "none", amount: 0 };
  }
  if (deposit && depositPolicy === "credit_only") {
    return { settlement: "loyalty_credit", amount: sum };
  }

  if (cancelMode === "refund_credit") {
    return { settlement: "loyalty_credit", amount: sum };
  }
  if (cancelMode === "refund_money") {
    return { settlement: "helcim_refund", amount: sum };
  }

  return { settlement: "none", amount: 0 };
}
