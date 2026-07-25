import {
  buildPriceOverridesFromPromotion,
  buildEffectiveTicketPriceOverrides,
  normalizeBookingTimeValue,
  promotionMatchesContext,
  resolveApplicableBookingPromotion,
} from '../bookingPricingPromotions';

describe('bookingPricingPromotions', () => {
  const childTicket = { id: 'child-id', price: 13.27 };
  const adultTicket = { id: 'adult-id', price: 5.31 };

  const tenAmPromotion = {
    id: 'promo-1',
    name: '$10 at 10am',
    is_active: true,
    priority: 10,
    promo_code: '',
    channel: 'both',
    activity_scope: { mode: 'all', category_keys: [], activity_ids: [] },
    visit_times: ['10:00:00'],
    price_adjustments: {
      mode: 'override_prices',
      items: [{ inventory_item_id: 'child-id', price: 10 }],
    },
    apply_conditional_free_rules: true,
  };

  test('normalizeBookingTimeValue handles AM labels', () => {
    expect(normalizeBookingTimeValue('10:00 AM')).toBe('10:00:00');
    expect(normalizeBookingTimeValue('10:00:00')).toBe('10:00:00');
  });

  test('resolves time-slot promotion for matching visit time', () => {
    const resolved = resolveApplicableBookingPromotion([tenAmPromotion], {
      activityId: 'activity-1',
      categoryKey: 'drop_in_play',
      bookingDate: '2026-07-10',
      bookingTime: '10:00 AM',
      channel: 'online',
      totalTickets: 2,
    });
    expect(resolved?.id).toBe('promo-1');
  });

  test('does not resolve time-slot promotion for other times', () => {
    const resolved = resolveApplicableBookingPromotion([tenAmPromotion], {
      activityId: 'activity-1',
      categoryKey: 'drop_in_play',
      bookingDate: '2026-07-10',
      bookingTime: '12:30 PM',
      channel: 'online',
      totalTickets: 2,
    });
    expect(resolved).toBeNull();
  });

  test('requires promo code when configured', () => {
    const codePromo = {
      ...tenAmPromotion,
      id: 'promo-code',
      visit_times: [],
      promo_code: 'EARLYBIRD',
      price_adjustments: {
        mode: 'flat_package_price',
        flat_price: 299,
        items: [{ inventory_item_id: 'party-id', price: 299 }],
      },
    };

    expect(resolveApplicableBookingPromotion([codePromo], {
      activityId: 'activity-1',
      bookingDate: '2026-12-01',
      bookingTime: '02:00 PM',
      promoCode: 'EARLYBIRD',
      channel: 'online',
      totalTickets: 1,
    })?.id).toBe('promo-code');

    expect(resolveApplicableBookingPromotion([codePromo], {
      activityId: 'activity-1',
      bookingDate: '2026-12-01',
      bookingTime: '02:00 PM',
      promoCode: 'WRONG',
      channel: 'online',
      totalTickets: 1,
    })).toBeNull();
  });

  test('purchase window can apply before visit date constraints', () => {
    const earlyBird = {
      id: 'early-bird',
      is_active: true,
      priority: 5,
      channel: 'online',
      activity_scope: { mode: 'categories', category_keys: ['birthday_party'], activity_ids: [] },
      purchase_starts_at: '2026-03-01T00:00:00.000Z',
      purchase_ends_at: '2026-03-31T23:59:59.000Z',
      price_adjustments: {
        mode: 'flat_package_price',
        flat_price: 349,
        items: [{ inventory_item_id: 'party-id', price: 349 }],
      },
    };

    expect(promotionMatchesContext(earlyBird, {
      activityId: 'party-activity',
      categoryKey: 'birthday_party',
      bookingDate: '2026-08-15',
      bookingTime: '01:00 PM',
      purchaseAt: new Date('2026-03-15T12:00:00.000Z'),
      channel: 'online',
      totalTickets: 1,
    })).toBe(true);
  });

  test('buildPriceOverridesFromPromotion applies override prices', () => {
    const overrides = buildPriceOverridesFromPromotion(
      tenAmPromotion,
      [childTicket, adultTicket],
      { 'child-id': 2, 'adult-id': 1 },
    );
    expect(overrides['child-id']).toBe(10);
    expect(overrides['adult-id']).toBeUndefined();
  });

  test('buildEffectiveTicketPriceOverrides prorates short multi-day weeks', () => {
    const overrides = buildEffectiveTicketPriceOverrides({
      items: [{ id: 'camp-ticket', price: 250 }],
      selectedTickets: { 'camp-ticket': 1 },
      weekDayCount: 4,
      fullWeekDayCount: 5,
    });
    expect(overrides['camp-ticket']).toBe(200);
  });

  test('buildEffectiveTicketPriceOverrides applies percent_off to prorated base', () => {
    const overrides = buildEffectiveTicketPriceOverrides({
      items: [{ id: 'camp-ticket', price: 250 }],
      selectedTickets: { 'camp-ticket': 1 },
      weekDayCount: 4,
      fullWeekDayCount: 5,
      promotion: {
        name: '10% off',
        is_active: true,
        price_adjustments: {
          mode: 'percent_off',
          items: [{ inventory_item_id: 'camp-ticket', percent: 10 }],
        },
      },
    });
    // 4/5 of 250 = 200, then 10% off => 180
    expect(overrides['camp-ticket']).toBe(180);
  });
});
