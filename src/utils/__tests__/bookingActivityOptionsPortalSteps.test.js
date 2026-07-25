import {
  portalOptionStepRequiresSelection,
  parsePortalActivityOptions,
  calculatePortalOptionsSubtotal,
  calculatePortalOptionsSubtotalFromConfig,
  buildPortalOptionCheckoutRows,
  buildPortalOptionCheckoutRowsFromConfig,
  listSelectedPortalOptionsForDisplay,
  listSelectedPortalOptionsForDisplayFromConfig,
  canRemovePortalOrderSelection,
  portalConfigToAddonSettingsRaw,
  applyPortalOptionSelectionChange,
} from '../bookingActivityOptions';

describe('portalOptionStepRequiresSelection', () => {
  const settings = {
    portal_options: {
      display_mode: 'step_modals',
      groups: [
        {
          id: 'g1',
          name: 'Pizza',
          options: [
            { id: 'opt-a', name: 'Cheese', required: false },
            { id: 'opt-b', name: 'Upgrade', required: true },
          ],
        },
        {
          id: 'g2',
          name: 'Drinks',
          options: [{ id: 'opt-c', name: 'Juice', required: false }],
        },
      ],
    },
  };

  const { groups } = parsePortalActivityOptions(settings);

  it('returns true when a visible option is required', () => {
    expect(portalOptionStepRequiresSelection(groups[0], {}, groups)).toBe(true);
  });

  it('returns false when no visible options are required', () => {
    expect(portalOptionStepRequiresSelection(groups[1], {}, groups)).toBe(false);
  });
});

describe('included portal options pricing', () => {
  const invId = '11111111-1111-4111-8111-111111111103';
  const settings = {
    portal_options: {
      groups: [
        {
          id: 'g-food',
          name: 'Food package',
          options: [
            {
              id: 'opt-included',
              name: 'Cheese Pizza',
              price: 15.71,
              inventory_item_id: invId,
              included: true,
            },
            {
              id: 'opt-upgrade',
              name: 'Pepperoni Pizza',
              inventory_item_id: invId,
              included: false,
            },
          ],
        },
      ],
    },
  };
  const inventoryItems = [{ id: invId, name: 'Cheese Pizza', price: 15.71 }];
  const selections = { 'opt-included': 1 };

  it('charges $0 for a single included option', () => {
    expect(
      calculatePortalOptionsSubtotal(settings, selections, inventoryItems)
    ).toBe(0);
    const rows = buildPortalOptionCheckoutRows(settings, selections, inventoryItems);
    expect(rows).toHaveLength(1);
    expect(rows[0].unit_price).toBe(15.71);
    expect(rows[0].total_price).toBe(0);
    expect(rows[0].included_quantity).toBe(1);
    expect(rows[0].paid_quantity).toBe(0);
  });

  it('charges list price for each included option beyond the first free unit', () => {
    expect(
      calculatePortalOptionsSubtotal(settings, { 'opt-included': 2 }, inventoryItems)
    ).toBe(15.71);
    const rows = buildPortalOptionCheckoutRows(settings, { 'opt-included': 2 }, inventoryItems);
    expect(rows[0].total_price).toBe(15.71);
    expect(rows[0].paid_quantity).toBe(1);
  });

  it('charges list price for three included units (first free, two paid)', () => {
    expect(
      calculatePortalOptionsSubtotal(settings, { 'opt-included': 3 }, inventoryItems)
    ).toBe(31.42);
  });

  it('charges inventory price for non-included upgrades', () => {
    expect(
      calculatePortalOptionsSubtotal(
        settings,
        { 'opt-upgrade': 1 },
        inventoryItems
      )
    ).toBe(15.71);
  });

  it('lists bundle component lines under selected options', () => {
    const bundleId = '22222222-2222-4222-8222-222222222222';
    const cheeseId = '33333333-3333-4333-8333-333333333333';
    const juiceId = '44444444-4444-4444-8444-444444444444';
    const bundleSettings = {
      portal_options: {
        groups: [
          {
            id: 'g-food',
            name: 'Food',
            options: [
              {
                id: 'opt-food-a',
                name: 'Food Option A',
                inventory_item_id: bundleId,
                included: true,
              },
            ],
          },
        ],
      },
    };
    const bundleItems = [
      {
        id: 'b1',
        bundle_inventory_id: bundleId,
        component_inventory_id: cheeseId,
        quantity: 2,
        sort_order: 0,
        component: { id: cheeseId, name: '12" Medium Cheese', is_bundle: false },
      },
      {
        id: 'b2',
        bundle_inventory_id: bundleId,
        component_inventory_id: juiceId,
        quantity: 12,
        sort_order: 1,
        component: { id: juiceId, name: 'Juice Box', is_bundle: false },
      },
    ];
    const bundleContext = {
      bundleItemsByBundleId: new Map([[bundleId, bundleItems]]),
      componentItems: [],
    };
    const display = listSelectedPortalOptionsForDisplay(
      bundleSettings,
      { 'opt-food-a': 1 },
      [{ id: bundleId, name: 'Food Option A', price: 0, is_bundle: true }],
      bundleContext
    );
    expect(display[0].bundle_includes).toEqual([
      '12" Medium Cheese × 2',
      'Juice Box × 12',
    ]);
  });
});

describe('included pick-one choice groups', () => {
  const settings = {
    portal_options: {
      display_mode: 'step_modals',
      groups: [
        {
          id: 'g-included-food',
          name: 'Included party food',
          max_selections: 1,
          options: [
            { id: 'opt-a', name: 'Package A', included: true, inventory_item_id: 'bundle-a' },
            { id: 'opt-b', name: 'Package B', included: true, inventory_item_id: 'bundle-b' },
            { id: 'opt-c', name: 'Package C', included: true, inventory_item_id: 'bundle-c' },
          ],
        },
        {
          id: 'g-extra-food',
          name: 'Extra food',
          options: [
            { id: 'opt-extra', name: 'Extra pizza', included: false, price: 25 },
          ],
        },
      ],
    },
  };

  const { groups } = parsePortalActivityOptions(settings);

  it('requires a selection before continuing the included-food step', () => {
    expect(portalOptionStepRequiresSelection(groups[0], {}, groups)).toBe(true);
    expect(portalOptionStepRequiresSelection(groups[0], { 'opt-b': 1 }, groups)).toBe(false);
  });

  it('charges only one included unit across the group when multiple choices are selected', () => {
    const inventoryItems = [
      { id: 'bundle-a', name: 'Package A', price: 60 },
      { id: 'bundle-b', name: 'Package B', price: 56.41 },
      { id: 'bundle-c', name: 'Package C', price: 59.26 },
    ];
    const pricedSettings = {
      portal_options: {
        groups: [
          {
            id: 'g-included-food',
            name: 'Included party food',
            max_selections: 1,
            options: [
              {
                id: 'opt-a',
                name: 'Package A',
                included: true,
                inventory_item_id: 'bundle-a',
                sort_order: 0,
                price: 60,
              },
              {
                id: 'opt-b',
                name: 'Package B',
                included: true,
                inventory_item_id: 'bundle-b',
                sort_order: 1,
                price: 56.41,
              },
              {
                id: 'opt-c',
                name: 'Package C',
                included: true,
                inventory_item_id: 'bundle-c',
                sort_order: 2,
                price: 59.26,
              },
            ],
          },
        ],
      },
    };

    // First selected option (by sort order) is free; additional options are charged.
    expect(
      calculatePortalOptionsSubtotal(pricedSettings, { 'opt-a': 1, 'opt-b': 1 }, inventoryItems),
    ).toBe(56.41);

    const rows = buildPortalOptionCheckoutRows(
      pricedSettings,
      { 'opt-a': 1, 'opt-b': 1 },
      inventoryItems,
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.option_id === 'opt-a')).toMatchObject({
      included_quantity: 1,
      paid_quantity: 0,
      total_price: 0,
    });
    expect(rows.find((row) => row.option_id === 'opt-b')).toMatchObject({
      included_quantity: 0,
      paid_quantity: 1,
      total_price: 56.41,
    });
  });

  it('charges extra quantity on the included choice plus full price for add-on choices', () => {
    const inventoryItems = [
      { id: 'bundle-a', name: 'Package A', price: 60 },
      { id: 'bundle-b', name: 'Package B', price: 56.41 },
    ];
    const pricedSettings = {
      portal_options: {
        groups: [
          {
            id: 'g-included-food',
            name: 'Included party food',
            max_selections: 1,
            options: [
              {
                id: 'opt-a',
                name: 'Package A',
                included: true,
                inventory_item_id: 'bundle-a',
                sort_order: 0,
                price: 60,
              },
              {
                id: 'opt-b',
                name: 'Package B',
                included: true,
                inventory_item_id: 'bundle-b',
                sort_order: 1,
                price: 56.41,
              },
            ],
          },
        ],
      },
    };

    expect(
      calculatePortalOptionsSubtotal(pricedSettings, { 'opt-a': 2, 'opt-b': 1 }, inventoryItems),
    ).toBe(116.41);
  });

  it('keeps multiple included-food options when the customer adds a second choice', () => {
    const next = applyPortalOptionSelectionChange(
      settings,
      { 'opt-a': 1 },
      groups[0],
      'opt-b',
      1,
    );
    expect(next['opt-a']).toBe(1);
    expect(next['opt-b']).toBe(1);
  });
});

describe('included multi-pick package choice groups', () => {
  const bundleOptions = [
    { id: 'opt-a', name: 'Package A', included: true, inventory_item_id: 'bundle-a', sort_order: 0, price: 60 },
    { id: 'opt-b', name: 'Package B', included: true, inventory_item_id: 'bundle-b', sort_order: 1, price: 56.41 },
    { id: 'opt-c', name: 'Package C', included: true, inventory_item_id: 'bundle-c', sort_order: 2, price: 59.26 },
  ];
  const inventoryItems = [
    { id: 'bundle-a', name: 'Package A', price: 60 },
    { id: 'bundle-b', name: 'Package B', price: 56.41 },
    { id: 'bundle-c', name: 'Package C', price: 59.26 },
  ];

  it('requires two units for a Super-style included food group', () => {
    const settings = {
      portal_options: {
        groups: [{ id: 'g-food', name: 'Included Food', max_selections: 2, options: bundleOptions }],
      },
    };
    const { groups } = parsePortalActivityOptions(settings);
    expect(portalOptionStepRequiresSelection(groups[0], { 'opt-a': 1 }, groups)).toBe(true);
    expect(portalOptionStepRequiresSelection(groups[0], { 'opt-a': 2 }, groups)).toBe(false);
    expect(portalOptionStepRequiresSelection(groups[0], { 'opt-a': 1, 'opt-b': 1 }, groups)).toBe(false);
  });

  it('includes two of the same option at no charge for max_selections = 2', () => {
    const settings = {
      portal_options: {
        groups: [{ id: 'g-food', name: 'Included Food', max_selections: 2, options: bundleOptions }],
      },
    };
    expect(
      calculatePortalOptionsSubtotal(settings, { 'opt-a': 2 }, inventoryItems),
    ).toBe(0);
  });

  it('includes two bundles at no charge for max_selections = 2', () => {
    const settings = {
      portal_options: {
        groups: [{ id: 'g-food', name: 'Included Food', max_selections: 2, options: bundleOptions }],
      },
    };
    expect(
      calculatePortalOptionsSubtotal(settings, { 'opt-a': 1, 'opt-b': 1 }, inventoryItems),
    ).toBe(0);
  });

  it('includes all three bundles at no charge for max_selections = 3', () => {
    const settings = {
      portal_options: {
        groups: [{ id: 'g-food', name: 'Included Food', max_selections: 3, options: bundleOptions }],
      },
    };
    expect(
      calculatePortalOptionsSubtotal(settings, { 'opt-a': 1, 'opt-b': 1, 'opt-c': 1 }, inventoryItems),
    ).toBe(0);
    expect(portalOptionStepRequiresSelection(parsePortalActivityOptions(settings).groups[0], { 'opt-a': 1, 'opt-b': 1 }, parsePortalActivityOptions(settings).groups)).toBe(true);
  });

  it('charges units beyond the free multi-pick slots', () => {
    const settings = {
      portal_options: {
        groups: [{ id: 'g-food', name: 'Included Food', max_selections: 2, options: bundleOptions }],
      },
    };
    expect(
      calculatePortalOptionsSubtotal(
        settings,
        { 'opt-a': 1, 'opt-b': 1, 'opt-c': 1 },
        inventoryItems,
      ),
    ).toBe(59.26);
    expect(
      calculatePortalOptionsSubtotal(settings, { 'opt-a': 3 }, inventoryItems),
    ).toBe(60);
  });
});

describe('portal order review from enriched config', () => {
  const settings = {
    portal_options: {
      groups: [
        {
          id: 'g-food',
          name: 'Food package',
          options: [
            {
              id: 'opt-included',
              name: 'Cheese Pizza',
              price: 15.71,
              included: true,
            },
            {
              id: 'opt-extra',
              name: 'Extra balloons',
              price: 25,
              included: false,
            },
          ],
        },
      ],
    },
  };
  const { groups } = parsePortalActivityOptions(settings);
  const config = { groups, inventoryPrices: {}, displayMode: 'step_modals' };

  it('includes auto-default included options in checkout rows from config', () => {
    const rows = buildPortalOptionCheckoutRowsFromConfig(config, {}, [], {});
    expect(rows).toHaveLength(1);
    expect(rows[0].option_id).toBe('opt-included');
    expect(rows[0].total_price).toBe(0);
  });

  it('omits marketing descriptions from order review labels', () => {
    const configWithDesc = {
      ...config,
      groups: [
        {
          ...groups[0],
          description: 'Pick your food',
          options: [
            { ...groups[0].options[0], description: '12 inch cheese pizza' },
            groups[0].options[1],
          ],
        },
      ],
    };
    const display = listSelectedPortalOptionsForDisplayFromConfig(
      configWithDesc,
      { 'opt-included': 1 },
      [],
      {},
      {},
      { addonSettingsRaw: settings }
    );
    expect(display[0].label).toBe('Cheese Pizza (Included)');
    expect(display[0].label).not.toContain('12 inch');
  });

  it('allows removing optional add-ons but not required included pick-one choices', () => {
    const pickOneSettings = {
      portal_options: {
        groups: [
          {
            id: 'g-included-food',
            name: 'Included party food',
            max_selections: 1,
            options: [
              { id: 'opt-a', name: 'Package A', included: true },
              { id: 'opt-b', name: 'Package B', included: true },
            ],
          },
          {
            id: 'g-extra',
            name: 'Extras',
            options: [{ id: 'opt-extra', name: 'Mascot', included: false, price: 50 }],
          },
        ],
      },
    };
    const pickConfig = portalConfigToAddonSettingsRaw(
      parsePortalActivityOptions(pickOneSettings)
    );
    const enriched = {
      groups: pickConfig.portal_options.groups,
      inventoryPrices: {},
    };
    expect(
      canRemovePortalOrderSelection(pickOneSettings, enriched, { 'opt-a': 1 }, 'opt-a')
    ).toBe(false);
    expect(
      canRemovePortalOrderSelection(
        pickOneSettings,
        enriched,
        { 'opt-a': 1, 'opt-b': 1 },
        'opt-b',
      )
    ).toBe(true);
    expect(
      canRemovePortalOrderSelection(
        pickOneSettings,
        enriched,
        { 'opt-a': 1, 'opt-extra': 1 },
        'opt-extra'
      )
    ).toBe(true);
  });
});
