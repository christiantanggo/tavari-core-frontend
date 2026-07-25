import { sumManualBookingAddonTotals } from './bookingPricing';

export function clampIndianStatusGstRate(rate) {
  return Math.min(1, Math.max(0, Number(rate) || 0));
}

export function isBookingIndianStatusActive(booking) {
  return !!booking?.indian_status_gst_only
    && String(booking?.indian_status_certificate_number || '').trim().length > 0;
}

/** Whole-order GST-only totals from pretax subtotal (matches POS cart behaviour). */
export function computeIndianStatusBookingTotals(pretaxSubtotal, gstRate) {
  const pretax = Math.max(0, Math.round((Number(pretaxSubtotal) || 0) * 100) / 100);
  const rate = clampIndianStatusGstRate(gstRate);
  const taxAmount = Math.round(pretax * rate * 100) / 100;
  const totalPrice = Math.round((pretax + taxAmount) * 100) / 100;
  return { pretaxSubtotal: pretax, taxAmount, totalPrice };
}

/**
 * Persisted checkout baseline when Indian Status applies GST to the full booking pretax.
 * Manual add-on lines store pretax only; all tax lives on the booking baseline.
 */
export function checkoutBaselineForIndianStatus(pricing, booking, gstRate) {
  const { taxAmount, totalPrice } = computeIndianStatusBookingTotals(pricing.subtotal, gstRate);
  const manualPretax = sumManualBookingAddonTotals(booking);
  return {
    order_total: Math.max(0, Math.round((totalPrice - manualPretax) * 100) / 100),
    tax_amount: Math.max(0, taxAmount),
  };
}
