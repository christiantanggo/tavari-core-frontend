import {
  buildBookingPrintChargeLines,
  buildBookingPrintHtml,
  buildBookingPrintOptionsCatalog,
} from '../bookingPrint';

describe('bookingPrint portal options', () => {
  const booking = {
    id: 'booking-1',
    booking_number: 'B-100',
    booking_date: '2026-06-15',
    booking_time: '14:00:00',
    status: 'confirmed',
    payment_status: 'paid',
    customer_email: 'guest@example.com',
    customer_phone: '5195551234',
    booking_activities: {
      activity_name: 'Birthday Party',
      addon_settings: {
        portal_options: {
          display_mode: 'single_modal',
          groups: [
            {
              id: 'grp-food',
              name: 'Food',
              description: 'Pick your pizza package',
              sort_order: 0,
              options: [
                {
                  id: 'opt-a',
                  name: 'Cheese Pizza',
                  description: 'Comes with juice boxes for every child',
                  sort_order: 0,
                  included: true,
                  price: 12.5,
                },
                {
                  id: 'opt-b',
                  name: 'Pepperoni Pizza',
                  sort_order: 1,
                  price: 15,
                },
              ],
            },
          ],
        },
      },
    },
    booking_addon_items: [
      {
        id: 'line-1',
        quantity: 1,
        unit_price: 0,
        booking_addons: {
          addon_key: 'portal-booking-1-opt-a',
          addon_name: 'Cheese Pizza',
          description: 'Customer portal option',
        },
      },
    ],
  };

  it('builds print catalog with names only (no group or option descriptions)', () => {
    const catalog = buildBookingPrintOptionsCatalog(booking);
    expect(catalog.groups).toHaveLength(1);
    expect(catalog.groups[0].name).toBe('Food');
    expect(catalog.groups[0].description).toBeUndefined();
    expect(catalog.groups[0].options[0].name).toBe('Cheese Pizza');
    expect(catalog.groups[0].options[0].description).toBeUndefined();
    expect(catalog.groups[0].options[0].listPrice).toBe(12.5);
    expect(catalog.groups[0].options[1].listPrice).toBe(15);
  });

  it('renders option prices beside each item in print html', () => {
    const html = buildBookingPrintHtml({
      booking,
      businessTimezone: 'America/Toronto',
      sections: { food_options: true },
      optionsCatalog: buildBookingPrintOptionsCatalog(booking),
      participants: [],
      guestListEntries: [],
      pricing: { subtotal: 100, taxAmount: 13, total: 113, totalPaid: 50, totalDue: 63 },
      resourceLabel: 'Room A',
    });

    expect(html).toContain('Cheese Pizza');
    expect(html).toContain('Pepperoni Pizza');
    expect(html).toContain('$12.50');
    expect(html).toContain('$15.00');
  });

  it('does not render group or option descriptions in print html', () => {
    const html = buildBookingPrintHtml({
      booking,
      businessTimezone: 'America/Toronto',
      sections: { food_options: true },
      optionsCatalog: buildBookingPrintOptionsCatalog(booking),
      participants: [],
      guestListEntries: [],
      pricing: { subtotal: 100, taxAmount: 13, total: 113, totalPaid: 50, totalDue: 63 },
      resourceLabel: 'Room A',
    });

    expect(html).toContain('Cheese Pizza');
    expect(html).not.toContain('Pick your pizza package');
    expect(html).not.toContain('Comes with juice boxes for every child');
  });

  it('fills print quantities from Bookeo/legacy food lines matched by option name', () => {
    const legacyBooking = {
      ...booking,
      booking_addon_items: [
        {
          id: 'line-bookeo-1',
          quantity: 20,
          unit_price: 1.33,
          booking_addons: {
            addon_key: 'bookeo-food-1556606129742840-juice-box',
            addon_name: 'Juice Box',
            description: 'Bookeo import food — CSV: Juice Box',
          },
        },
        {
          id: 'line-bookeo-2',
          quantity: 1,
          unit_price: 15.71,
          booking_addons: {
            addon_key: 'bookeo-food-1556606129742840-cheese-pizza',
            addon_name: 'Cheese Pizza',
            description: 'Bookeo import food — CSV: Medium Cheese Pizza (8 Slices)',
          },
        },
      ],
      booking_activities: {
        ...booking.booking_activities,
        addon_settings: {
          portal_options: {
            display_mode: 'single_modal',
            groups: [
              {
                id: 'grp-food',
                name: 'Food',
                sort_order: 0,
                options: [
                  {
                    id: 'opt-juice',
                    name: 'Juice Box',
                    sort_order: 0,
                    price: 1.33,
                  },
                  {
                    id: 'opt-a',
                    name: 'Cheese Pizza',
                    sort_order: 1,
                    price: 12.5,
                  },
                  {
                    id: 'opt-b',
                    name: 'Pepperoni Pizza',
                    sort_order: 2,
                    price: 15,
                  },
                ],
              },
            ],
          },
        },
      },
    };

    const catalog = buildBookingPrintOptionsCatalog(legacyBooking);
    const byName = Object.fromEntries(
      catalog.groups[0].options.map((option) => [option.name, option.quantity]),
    );

    expect(byName['Juice Box']).toBe(20);
    expect(byName['Cheese Pizza']).toBe(1);
    expect(byName['Pepperoni Pizza']).toBe(0);
    expect(catalog.additionalItems).toHaveLength(0);

    const html = buildBookingPrintHtml({
      booking: legacyBooking,
      businessTimezone: 'America/Toronto',
      sections: { food_options: true },
      optionsCatalog: catalog,
      participants: [],
      guestListEntries: [],
      pricing: { subtotal: 100, taxAmount: 13, total: 113, totalPaid: 50, totalDue: 63 },
      resourceLabel: 'Room A',
    });

    expect(html).toContain('<strong style="font-size: 13px;">20</strong>');
    expect(html).toContain('<strong style="font-size: 13px;">1</strong>');
  });

  it('stacks included food bundle components with quantities only when selected', () => {
    const bundleBooking = {
      ...booking,
      booking_addon_items: [
        {
          id: 'line-a',
          quantity: 1,
          unit_price: 60,
          booking_addons: {
            addon_key: 'portal-booking-1-opt-bundle-a',
            addon_name: 'Food Option A',
          },
        },
      ],
      booking_activities: {
        ...booking.booking_activities,
        addon_settings: {
          portal_options: {
            display_mode: 'single_modal',
            groups: [
              {
                id: 'grp-included',
                name: 'Included Food Options',
                sort_order: 0,
                options: [
                  {
                    id: 'opt-bundle-a',
                    name: 'Food Option A (12" Medium Cheese × 3, Juice Box × 10)',
                    included: true,
                    price: 60,
                    inventory_item_id: 'inv-bundle-a',
                    sort_order: 0,
                  },
                  {
                    id: 'opt-bundle-b',
                    name: 'Food Option B (Chip Bowl, Gold Fish Bowl)',
                    included: true,
                    price: 56,
                    inventory_item_id: 'inv-bundle-b',
                    sort_order: 1,
                  },
                ],
              },
            ],
          },
        },
      },
    };

    const catalog = buildBookingPrintOptionsCatalog(bundleBooking, {
      inventoryItems: [
        { id: 'inv-bundle-a', name: 'Food Option A', is_bundle: true, price: 60 },
        { id: 'inv-bundle-b', name: 'Food Option B', is_bundle: true, price: 56 },
      ],
      bundleContext: {
        bundleItemsByBundleId: new Map([
          [
            'inv-bundle-a',
            [
              { quantity: 3, component: { name: '12" Medium Cheese' } },
              { quantity: 10, component: { name: 'Juice Box' } },
            ],
          ],
          [
            'inv-bundle-b',
            [
              { quantity: 1, component: { name: 'Chip Bowl' } },
              { quantity: 1, component: { name: 'Gold Fish Bowl' } },
            ],
          ],
        ]),
      },
    });

    const [optionA, optionB] = catalog.groups[0].options;
    expect(optionA.name).toBe('Food Option A');
    expect(optionA.quantity).toBe(1);
    expect(optionA.components).toEqual([
      { name: '12" Medium Cheese', quantity: 3 },
      { name: 'Juice Box', quantity: 10 },
    ]);
    expect(optionB.name).toBe('Food Option B');
    expect(optionB.quantity).toBe(0);
    expect(optionB.components).toEqual([
      { name: 'Chip Bowl', quantity: 0 },
      { name: 'Gold Fish Bowl', quantity: 0 },
    ]);

    const html = buildBookingPrintHtml({
      booking: bundleBooking,
      businessTimezone: 'America/Toronto',
      sections: { food_options: true },
      optionsCatalog: catalog,
      participants: [],
      guestListEntries: [],
      pricing: { subtotal: 100, taxAmount: 13, total: 113, totalPaid: 50, totalDue: 63 },
      resourceLabel: 'Room A',
    });

    expect(html).toContain('Food Option A');
    expect(html).toContain('Food Option B');
    expect(html).toContain('12&quot; Medium Cheese');
    expect(html).toContain('Chip Bowl');
    expect(html).toContain('<strong style="font-size: 11px;">3</strong>');
    expect(html).toContain('<strong style="font-size: 11px;">10</strong>');
    expect(html).not.toContain('<strong style="font-size: 11px;">0</strong>');
  });

  it('keeps pizza bundles as a single line instead of stacking toppings', () => {
    const pizzaBooking = {
      ...booking,
      booking_addon_items: [
        {
          id: 'line-pizza',
          quantity: 2,
          unit_price: 22,
          booking_addons: {
            addon_key: 'portal-booking-1-opt-canadian',
            addon_name: 'Canadian Pizza',
          },
        },
      ],
      booking_activities: {
        ...booking.booking_activities,
        addon_settings: {
          portal_options: {
            display_mode: 'single_modal',
            groups: [
              {
                id: 'grp-addons',
                name: 'Additional Food Add Ons',
                sort_order: 0,
                options: [
                  {
                    id: 'opt-canadian',
                    name: 'Canadian Pizza',
                    price: 22,
                    inventory_item_id: 'inv-canadian',
                    sort_order: 0,
                  },
                ],
              },
            ],
          },
        },
      },
    };

    const catalog = buildBookingPrintOptionsCatalog(pizzaBooking, {
      inventoryItems: [
        { id: 'inv-canadian', name: 'Canadian Pizza', is_bundle: true, price: 22 },
      ],
      bundleContext: {
        bundleItemsByBundleId: new Map([
          [
            'inv-canadian',
            [
              { quantity: 1, component: { name: '12" Medium Cheese' } },
              { quantity: 1, component: { name: 'Pepperoni (12" Full)' } },
              { quantity: 1, component: { name: 'Bacon Crumble (12" Full)' } },
              { quantity: 1, component: { name: 'Mushroom (12" Full)' } },
            ],
          ],
        ]),
      },
    });

    const [pizzaOption] = catalog.groups[0].options;
    expect(pizzaOption.name).toBe('Canadian Pizza');
    expect(pizzaOption.quantity).toBe(2);
    expect(pizzaOption.components).toEqual([]);

    const html = buildBookingPrintHtml({
      booking: pizzaBooking,
      businessTimezone: 'America/Toronto',
      sections: { food_options: true },
      optionsCatalog: catalog,
      participants: [],
      guestListEntries: [],
      pricing: { subtotal: 100, taxAmount: 13, total: 113, totalPaid: 50, totalDue: 63 },
      resourceLabel: 'Room A',
    });

    expect(html).toContain('Canadian Pizza');
    expect(html).not.toContain('Pepperoni (12&quot; Full)');
    expect(html).not.toContain('Bacon Crumble');
  });

  it('forces Balloons onto a new page in two columns', () => {
    const catalog = {
      groups: [
        {
          id: 'grp-food',
          name: 'Included Food Options',
          options: [{ id: 'opt-a', name: 'Food Option A', quantity: 1, listPrice: 12.5, included: true }],
        },
        {
          id: 'grp-balloons',
          name: 'Balloons',
          options: [
            { id: 'opt-b1', name: 'Helium - 7 Latex', quantity: 0, listPrice: 10, included: false },
            { id: 'opt-b2', name: 'Helium - 5 Foil', quantity: 1, listPrice: 15, included: false },
          ],
        },
      ],
      additionalItems: [],
    };

    const html = buildBookingPrintHtml({
      booking,
      businessTimezone: 'America/Toronto',
      sections: { food_options: true },
      optionsCatalog: catalog,
      participants: [],
      guestListEntries: [],
      pricing: { subtotal: 100, taxAmount: 13, total: 113, totalPaid: 50, totalDue: 63 },
      resourceLabel: 'Room A',
    });

    expect(html).toContain('Balloons');
    expect(html).toContain('page-break-before:always');
    expect(html).toContain('break-before:page');
    expect(html).toContain('data-print-food-col="1"');
    expect(html).toContain('data-print-food-col="2"');
    // Page-1 options stay before the page break; balloons split across two grid columns after it.
    const pageBreakIndex = html.indexOf('page-break-before:always');
    const foodIndex = html.indexOf('Food Option A');
    const balloonItemIndex = html.indexOf('Helium - 7 Latex');
    const rightColumnItemIndex = html.indexOf('Helium - 5 Foil');
    expect(foodIndex).toBeGreaterThan(-1);
    expect(pageBreakIndex).toBeGreaterThan(foodIndex);
    expect(balloonItemIndex).toBeGreaterThan(pageBreakIndex);
    expect(rightColumnItemIndex).toBeGreaterThan(balloonItemIndex);
  });

  it('combines party overview into one section without booking details duplicates', () => {
    const html = buildBookingPrintHtml({
      booking,
      businessTimezone: 'America/Toronto',
      sections: { party_overview: true },
      optionsCatalog: { groups: [], additionalItems: [] },
      participants: [],
      guestListEntries: [],
      partyHostName: 'safa breiche',
      birthdayChildName: 'baylee zebian',
      pricing: { subtotal: 100, taxAmount: 13, total: 113, totalPaid: 50, totalDue: 63 },
      resourceLabel: 'Teal Room',
    });

    expect(html).toContain('Party overview');
    expect(html).not.toContain('Booking details');
    // Activity name appears in <title> and once in the overview body (no duplicate header block).
    expect(html.match(/Birthday Party/g)?.length).toBe(2);
    expect(html.match(/B-100/g)?.length).toBe(1);
    expect(html.match(/Teal Room/g)?.length).toBe(1);
    expect(html).toContain('safa breiche');
    expect(html).toContain('baylee zebian');
    expect(html).toContain('Customer email');
    expect(html).toContain('Payment status');
  });

  it('places included food, party host, and mascot in column 1 and additional food in column 2', () => {
    const catalog = {
      groups: [
        {
          id: 'grp-mascot',
          name: 'Mascot',
          options: [{ id: 'opt-m', name: 'Pikachu', quantity: 0, listPrice: 25, included: false }],
        },
        {
          id: 'grp-host',
          name: 'Party Host',
          options: [{ id: 'opt-h', name: 'Digital Host (TV Screen)', quantity: 1, listPrice: 0, included: true }],
        },
        {
          id: 'grp-included',
          name: 'Included Food Options',
          options: [{ id: 'opt-a', name: 'Food Option A', quantity: 1, listPrice: 60, included: true }],
        },
        {
          id: 'grp-additional',
          name: 'Additional Food Add Ons',
          options: [{ id: 'opt-p', name: 'Canadian Pizza', quantity: 1, listPrice: 22, included: false }],
        },
      ],
      additionalItems: [],
    };

    const html = buildBookingPrintHtml({
      booking,
      businessTimezone: 'America/Toronto',
      sections: { food_options: true },
      optionsCatalog: catalog,
      participants: [],
      guestListEntries: [],
      pricing: { subtotal: 100, taxAmount: 13, total: 113, totalPaid: 50, totalDue: 63 },
      resourceLabel: 'Room A',
    });

    const col1 = html.match(/data-print-food-col="1">([\s\S]*?)<div data-print-food-col="2"/)?.[1] || '';
    const col2 = html.match(/data-print-food-col="2">([\s\S]*?)(?:<div style="break-before:page|$)/)?.[1] || '';

    expect(col1.indexOf('Included food')).toBeLessThan(col1.indexOf('Party Host'));
    expect(col1.indexOf('Party Host')).toBeLessThan(col1.indexOf('Mascot'));
    expect(col1).toContain('Food Option A');
    expect(col1).toContain('Digital Host');
    expect(col1).toContain('Pikachu');
    expect(col1).not.toContain('Canadian Pizza');
    expect(col2).toContain('Additional food');
    expect(col2).toContain('Canadian Pizza');
  });
});

describe('bookingPrint payment summary', () => {
  const booking = {
    id: 'booking-2',
    booking_number: 'B-200',
    booking_date: '2026-06-20',
    booking_time: '15:00:00',
    order_total: 226,
    tax_amount: 26,
    booking_activities: {
      activity_name: 'Birthday Party',
    },
    booking_addon_items: [
      {
        id: 'line-1',
        quantity: 2,
        unit_price: 25,
        total_price: 50,
        booking_addons: {
          addon_name: 'Extra pizza',
        },
      },
    ],
    booking_payments: [
      {
        id: 'pay-1',
        amount_paid: 100,
        status: 'completed',
        payment_method: 'helcim',
      },
      {
        id: 'pay-2',
        amount_paid: 50,
        status: 'completed',
        payment_method: 'manual',
      },
    ],
  };

  const pricing = {
    subtotal: 200,
    taxAmount: 26,
    totalPrice: 226,
    totalPaid: 150,
    totalDue: 76,
  };

  it('builds charge lines for package and add-ons', () => {
    const lines = buildBookingPrintChargeLines(booking, pricing);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({
      label: 'Birthday Party',
      detail: null,
      amount: 150,
    });
    expect(lines[1]).toEqual({
      label: 'Extra pizza',
      detail: '2 × $25.00',
      amount: 50,
    });
  });

  it('renders itemized charges, totals, and payments in print html', () => {
    const html = buildBookingPrintHtml({
      booking,
      businessTimezone: 'America/Toronto',
      sections: { payment_summary: true },
      optionsCatalog: { groups: [], additionalItems: [] },
      participants: [],
      guestListEntries: [],
      pricing,
      resourceLabel: 'Room A',
    });

    expect(html).toContain('Payment summary');
    expect(html).toContain('Birthday Party');
    expect(html).toContain('Extra pizza');
    expect(html).toContain('$150.00');
    expect(html).toContain('$50.00');
    expect(html).toContain('Subtotal');
    expect(html).toContain('$200.00');
    expect(html).toContain('Taxes');
    expect(html).toContain('$26.00');
    expect(html).toContain('$226.00');
    expect(html).toContain('Payments received');
    expect(html).toContain('Helcim');
    expect(html).toContain('Manual payment');
    expect(html).toContain('Total paid');
    expect(html).toContain('Balance due');
    expect(html).toContain('$76.00');
  });
});

describe('bookingPrint notes section', () => {
  const booking = {
    id: 'booking-3',
    booking_number: 'B-300',
    booking_date: '2026-06-22',
    booking_time: '11:00:00',
    notes: 'Legacy booking note',
    booking_activities: {
      activity_name: 'Birthday Party',
    },
  };

  it('includes notes when the notes section is selected', () => {
    const html = buildBookingPrintHtml({
      booking,
      businessTimezone: 'America/Toronto',
      sections: { notes: true },
      bookingNotes: [
        {
          id: 'n1',
          note_text: 'Child is allergic to peanuts',
          created_at: '2026-06-01T14:00:00.000Z',
        },
      ],
      optionsCatalog: { groups: [], additionalItems: [] },
      participants: [],
      guestListEntries: [],
      pricing: null,
      resourceLabel: 'Room A',
    });

    expect(html).toContain('Notes');
    expect(html).toContain('Legacy booking note');
    expect(html).toContain('Child is allergic to peanuts');
  });

  it('omits notes when the notes section is unchecked', () => {
    const html = buildBookingPrintHtml({
      booking,
      businessTimezone: 'America/Toronto',
      sections: { notes: false, party_overview: true },
      bookingNotes: [
        {
          id: 'n1',
          note_text: 'Do not print this',
          created_at: '2026-06-01T14:00:00.000Z',
        },
      ],
      optionsCatalog: { groups: [], additionalItems: [] },
      participants: [],
      guestListEntries: [],
      pricing: { subtotal: 0, taxAmount: 0, total: 0, totalPaid: 0, totalDue: 0 },
      resourceLabel: 'Room A',
    });

    expect(html).not.toContain('Do not print this');
    expect(html).not.toContain('Legacy booking note');
  });
});
