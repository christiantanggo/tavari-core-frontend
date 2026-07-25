import {
  getBookingPricingSummary,
  sumCompletedDepositPayments,
  sumUnbilledExtensionCharges,
} from '../bookingPricing';

describe('bookingPricing extension charges', () => {
  it('sums paid extension charges not yet billed as addon lines', () => {
    const booking = {
      id: 'b1',
      booking_time_extensions: [
        { extension_type: 'paid', amount_charged: 30 },
        { extension_type: 'courtesy', amount_charged: null },
      ],
      booking_addon_items: [],
    };

    expect(sumUnbilledExtensionCharges(booking)).toBe(30);
  });

  it('does not double-count extension charges already on addon lines', () => {
    const booking = {
      id: 'b1',
      booking_time_extensions: [
        { extension_type: 'paid', amount_charged: 30 },
      ],
      booking_addon_items: [{
        total_price: 30,
        booking_addons: { addon_key: 'manual-b1-x', addon_name: 'Time extension (+30 min)' },
      }],
    };

    expect(sumUnbilledExtensionCharges(booking)).toBe(0);
  });

  it('includes unbilled extension charges in booking total', () => {
    const booking = {
      id: 'b1',
      order_total: 200,
      tax_amount: 26,
      booking_payments: [],
      booking_time_extensions: [
        { extension_type: 'paid', amount_charged: 30 },
      ],
      booking_addon_items: [],
    };

    const pricing = getBookingPricingSummary(booking);
    expect(pricing.totalPrice).toBe(230);
    expect(pricing.totalDue).toBe(230);
  });
});

describe('sumCompletedDepositPayments', () => {
  it('sums completed deposit payments only', () => {
    const booking = {
      booking_payments: [
        { status: 'completed', payment_type: 'deposit', amount_paid: 50 },
        { status: 'completed', payment_type: 'full', amount_paid: 100 },
        { status: 'pending', payment_type: 'deposit', amount_paid: 25 },
      ],
    };

    expect(sumCompletedDepositPayments(booking)).toBe(50);
  });
});
