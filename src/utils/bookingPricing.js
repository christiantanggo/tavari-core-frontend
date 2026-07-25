import { isBookingIndianStatusActive } from './bookingIndianStatus';

function sumCompletedBookingPayments(booking) {
  const payments = booking?.booking_payments || [];
  return payments
    .filter((payment) => payment.status === 'completed')
    .reduce((sum, payment) => sum + (Number(payment.amount_paid) || 0), 0);
}

export function sumCompletedDepositPayments(booking) {
  const payments = booking?.booking_payments || [];
  return payments
    .filter((payment) => payment.status === 'completed' && payment.payment_type === 'deposit')
    .reduce((sum, payment) => sum + (Number(payment.amount_paid) || 0), 0);
}

export function sumBookingAddonTotals(booking) {
  return (booking?.booking_addon_items || []).reduce(
    (sum, item) => sum + (Number(item.total_price) || 0),
    0,
  );
}

export function isPortalBookingAddonItem(item, bookingId = null) {
  const key = String(item?.booking_addons?.addon_key || '');
  if (!key.startsWith('portal-')) return false;
  if (bookingId) return key.startsWith(`portal-${bookingId}-`);
  return true;
}

export function sumPortalBookingAddonTotals(booking) {
  const bookingId = booking?.id || null;
  return (booking?.booking_addon_items || []).reduce((sum, item) => {
    if (!isPortalBookingAddonItem(item, bookingId)) return sum;
    return sum + (Number(item.total_price) || 0);
  }, 0);
}

export function sumManualBookingAddonTotals(booking) {
  const bookingId = booking?.id || null;
  return (booking?.booking_addon_items || []).reduce((sum, item) => {
    if (isPortalBookingAddonItem(item, bookingId)) return sum;
    return sum + (Number(item.total_price) || 0);
  }, 0);
}

/** Parse tax amount stored on manual booking addon descriptions. */
export function parseManualAddonTaxAmount(description) {
  const match = String(description || '').match(/Total tax amount:\s*([0-9.]+)/i);
  return match ? Math.max(0, Number.parseFloat(match[1]) || 0) : 0;
}

export function sumManualBookingAddonTax(booking) {
  const bookingId = booking?.id || null;
  return (booking?.booking_addon_items || []).reduce((sum, item) => {
    if (isPortalBookingAddonItem(item, bookingId)) return sum;
    return sum + parseManualAddonTaxAmount(item?.booking_addons?.description);
  }, 0);
}

/** Paid extension charges not yet represented as manual addon line items. */
export function sumUnbilledExtensionCharges(booking) {
  const bookingId = booking?.id || null;
  const extensionTotal = (booking?.booking_time_extensions || [])
    .filter((row) => row.extension_type === 'paid')
    .reduce((sum, row) => sum + (Number(row.amount_charged) || 0), 0);

  const billedViaAddon = (booking?.booking_addon_items || [])
    .filter((item) => !isPortalBookingAddonItem(item, bookingId))
    .filter((item) => String(item?.booking_addons?.addon_name || '').startsWith('Time extension'))
    .reduce((sum, item) => sum + (Number(item.total_price) || 0), 0);

  return Math.max(0, Math.round((extensionTotal - billedViaAddon) * 100) / 100);
}

function buildPricingResult(booking, subtotal, taxAmount, totalPrice) {
  const totalPaid = sumCompletedBookingPayments(booking);
  const totalDue = Math.max(0, Math.round((totalPrice - totalPaid) * 100) / 100);

  let dueNow = 0;
  if (booking?.payment_status === 'partial' || booking?.payment_status === 'unpaid') {
    if (booking?.requires_approval && booking?.approved_at && totalDue > 0) {
      dueNow = totalDue;
    } else if (booking?.payment_status === 'partial' && totalDue > 0) {
      dueNow = totalDue;
    }
  }

  return {
    subtotal,
    taxAmount,
    totalPrice,
    totalPaid,
    totalDue,
    dueNow,
    hasPricing: totalPrice > 0 || totalPaid > 0,
  };
}

/**
 * Checkout baseline (order_total / tax_amount) covers tickets + portal options.
 * Manual staff add-ons stack on top and are not stored in order_total.
 */
export function computeBookingPricingWithPortalAddonSubtotal(booking, portalAddonSubtotalOverride) {
  const baselineOrderTotal = Number(booking?.order_total) || 0;
  const baselineTax = Number(booking?.tax_amount) || 0;
  const manualPretax = sumManualBookingAddonTotals(booking) + sumUnbilledExtensionCharges(booking);

  if (isBookingIndianStatusActive(booking) && baselineOrderTotal > 0) {
    const baselineSubtotal = Math.max(0, Math.round((baselineOrderTotal - baselineTax) * 100) / 100);
    const subtotal = Math.round((baselineSubtotal + manualPretax) * 100) / 100;
    const totalPrice = Math.round((baselineOrderTotal + manualPretax) * 100) / 100;
    return buildPricingResult(booking, subtotal, baselineTax, totalPrice);
  }

  const manualTax = sumManualBookingAddonTax(booking);
  const currentPortalPretax = sumPortalBookingAddonTotals(booking);
  const portalAddonSubtotal = Math.max(0, Number(portalAddonSubtotalOverride) || 0);

  const baselineSubtotal = Math.max(0, Math.round((baselineOrderTotal - baselineTax) * 100) / 100);
  const ticketBasePretax = Math.max(0, Math.round((baselineSubtotal - currentPortalPretax) * 100) / 100);

  const newBaselineSubtotal = Math.round((ticketBasePretax + portalAddonSubtotal) * 100) / 100;
  const oldBaselineTaxable = ticketBasePretax + currentPortalPretax;
  const newBaselineTaxable = ticketBasePretax + portalAddonSubtotal;
  const newBaselineTax = oldBaselineTaxable > 0
    ? Math.round(baselineTax * (newBaselineTaxable / oldBaselineTaxable) * 100) / 100
    : 0;

  const subtotal = Math.round((newBaselineSubtotal + manualPretax) * 100) / 100;
  const taxAmount = Math.round((newBaselineTax + manualTax) * 100) / 100;
  const totalPrice = Math.round((newBaselineSubtotal + newBaselineTax + manualPretax + manualTax) * 100) / 100;

  return buildPricingResult(booking, subtotal, taxAmount, totalPrice);
}

export function getEffectiveBookingPricingSummary(booking, preview = null) {
  if (
    preview
    && preview.portalAddonSubtotal != null
    && Number.isFinite(Number(preview.portalAddonSubtotal))
  ) {
    return computeBookingPricingWithPortalAddonSubtotal(booking, preview.portalAddonSubtotal);
  }
  return getBookingPricingSummary(booking);
}

export function getBookingPricingSummary(booking) {
  const totalPaid = sumCompletedBookingPayments(booking);
  const baselineOrderTotal = Number(booking?.order_total) || 0;
  const baselineTax = Number(booking?.tax_amount) || 0;
  const manualPretax = sumManualBookingAddonTotals(booking) + sumUnbilledExtensionCharges(booking);
  const manualTax = sumManualBookingAddonTax(booking);
  const addonLines = booking?.booking_addon_items || [];

  if (baselineOrderTotal > 0 || manualPretax > 0 || addonLines.length > 0) {
    const portalPretax = sumPortalBookingAddonTotals(booking);
    return computeBookingPricingWithPortalAddonSubtotal(booking, portalPretax);
  }

  const addonTotal = sumBookingAddonTotals(booking);
  const explicitTotal = Number(booking?.total_amount);

  let subtotal = 0;
  let taxAmount = 0;
  let totalPrice = 0;

  if (Number.isFinite(explicitTotal) && explicitTotal > 0) {
    totalPrice = explicitTotal;
    subtotal = explicitTotal;
  } else if (addonTotal > 0) {
    subtotal = addonTotal;
    totalPrice = addonTotal;
  } else if (totalPaid > 0) {
    subtotal = totalPaid;
    totalPrice = totalPaid;
  }

  return buildPricingResult(booking, subtotal, taxAmount, totalPrice);
}

/** Persisted checkout baseline excluding stacked manual add-ons and extension charges. */
export function checkoutBaselineFromFullPricing(pricing, booking) {
  const manualPretax = sumManualBookingAddonTotals(booking) + sumUnbilledExtensionCharges(booking);
  const manualTax = sumManualBookingAddonTax(booking);
  return {
    order_total: Math.max(0, Math.round((pricing.totalPrice - manualPretax - manualTax) * 100) / 100),
    tax_amount: Math.max(0, Math.round((pricing.taxAmount - manualTax) * 100) / 100),
  };
}

export function formatBookingMoney(amount) {
  return `$${(Number(amount) || 0).toFixed(2)}`;
}
