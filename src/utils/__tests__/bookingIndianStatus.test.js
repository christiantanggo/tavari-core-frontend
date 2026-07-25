import {
  checkoutBaselineForIndianStatus,
  computeIndianStatusBookingTotals,
  isBookingIndianStatusActive,
} from '../bookingIndianStatus';

describe('bookingIndianStatus', () => {
  it('computes GST-only totals from pretax subtotal', () => {
    expect(computeIndianStatusBookingTotals(100, 0.05)).toEqual({
      pretaxSubtotal: 100,
      taxAmount: 5,
      totalPrice: 105,
    });
  });

  it('detects active Indian status when flag and certificate are set', () => {
    expect(isBookingIndianStatusActive({
      indian_status_gst_only: true,
      indian_status_certificate_number: 'ABC-123',
    })).toBe(true);
    expect(isBookingIndianStatusActive({
      indian_status_gst_only: true,
      indian_status_certificate_number: '  ',
    })).toBe(false);
  });

  it('builds checkout baseline excluding manual addon pretax', () => {
    const booking = {
      booking_addon_items: [{
        total_price: 20,
        booking_addons: { addon_key: 'manual-x' },
      }],
    };
    const pricing = { subtotal: 120 };
    const baseline = checkoutBaselineForIndianStatus(pricing, booking, 0.05);
    expect(baseline).toEqual({
      order_total: 106,
      tax_amount: 6,
    });
  });
});
