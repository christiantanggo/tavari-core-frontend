import {
  buildBundleSlotKey,
  expandBundleModifierSlots,
  flattenBundleComponentModifiersForDisplay,
  injectBundleComponentModifierGroups,
  optionNeedsBundleCustomization,
  portalOptionSupportsBalloonSlotCustomization,
  validateBundleSlotSelections,
} from '../posBundleModifiers';

describe('posBundleModifiers', () => {
  const latexId = 'latex-1';
  const foilId = 'foil-1';
  const bundleId = 'bundle-1';

  const inventoryById = new Map([
    [latexId, { id: latexId, name: 'Latex Balloon', modifier_group_ids: ['grp-latex'] }],
    [foilId, { id: foilId, name: 'Foil Balloon', modifier_group_ids: ['grp-foil'] }],
    ['helium-1', { id: 'helium-1', name: 'Helium', modifier_group_ids: [] }],
  ]);

  it('expands bundle rows into per-unit modifier slots', () => {
    const slots = expandBundleModifierSlots(bundleId, [
      { component_inventory_id: latexId, quantity: 3 },
      { component_inventory_id: 'helium-1', quantity: 3 },
    ], inventoryById);

    expect(slots).toHaveLength(3);
    expect(slots[0].slot_label).toBe('Latex Balloon 1 of 3');
    expect(slots[2].slot_key).toBe(buildBundleSlotKey(bundleId, latexId, 3));
  });

  it('validates required slot selections', () => {
    const slots = expandBundleModifierSlots(bundleId, [
      { component_inventory_id: latexId, quantity: 2 },
    ], inventoryById);
    const slotKey = slots[0].slot_key;
    expect(validateBundleSlotSelections(slots, {}).ok).toBe(false);
    expect(
      validateBundleSlotSelections(slots, {
        [slotKey]: [{ id: 'mod-1', name: 'Red - Latex', price: 0, group_id: 'grp-latex' }],
      }).ok
    ).toBe(false);
    expect(
      validateBundleSlotSelections(slots, {
        [slotKey]: [{ id: 'mod-1', name: 'Red - Latex', price: 0, group_id: 'grp-latex' }],
        [slots[1].slot_key]: [{ id: 'mod-2', name: 'Blue - Latex', price: 0, group_id: 'grp-latex' }],
      }).ok
    ).toBe(true);
  });

  it('injects portal groups for bundle options with component modifiers', () => {
    const parentOptionId = 'opt-bundle';
    const config = {
      groups: [
        {
          id: 'grp-main',
          name: 'Balloons',
          options: [
            {
              id: parentOptionId,
              name: 'Helium - 7 Latex',
              inventory_item_id: bundleId,
            },
          ],
        },
      ],
    };

    const bundleItemsByBundleId = new Map([
      [
        bundleId,
        [{ component_inventory_id: latexId, quantity: 2 }],
      ],
    ]);

    const inventoryByIdWithBundle = new Map([
      ...inventoryById,
      [bundleId, { id: bundleId, name: 'Helium - 7 Latex', is_bundle: true }],
    ]);

    const componentModifierGroupsByInventoryId = new Map([
      [
        latexId,
        [
          {
            id: 'grp-latex',
            name: 'Latex Style',
            modifiers: [
              { id: 'mod-red', name: 'Red - Latex', price: 0, is_free: true },
              { id: 'mod-blue', name: 'Blue - Latex', price: 0, is_free: true },
            ],
          },
        ],
      ],
    ]);

    const enriched = injectBundleComponentModifierGroups(
      config,
      inventoryByIdWithBundle,
      bundleItemsByBundleId,
      componentModifierGroupsByInventoryId
    );

    expect(enriched.groups).toHaveLength(3);
    const injected = enriched.groups.filter((group) => group.is_bundle_component_group);
    expect(injected).toHaveLength(2);
    expect(injected[0].show_when_option_id).toBe(parentOptionId);
    expect(injected[0].options[0].is_bundle_component_modifier).toBe(true);
  });

  it('flattens bundle component modifiers for cart display', () => {
    const flat = flattenBundleComponentModifiersForDisplay([
      {
        slot_label: 'Latex Balloon 1 of 2',
        slot_key: 'slot-1',
        component_name: 'Latex Balloon',
        modifiers: [{ id: 'mod-red', name: 'Red - Latex', price: 0, group_id: 'grp-latex' }],
      },
    ]);
    expect(flat[0].name).toBe('Latex Balloon 1 of 2: Red - Latex');
  });

  it('enables balloon slot customization for modifier bundles except mascots', () => {
    const decorationsGroup = { id: 'grp-deco', name: 'Party decorations' };
    const mascotGroup = { id: 'grp-mascots', name: 'Mascots' };
    const bundleItemsByBundleId = new Map([
      [bundleId, [{ component_inventory_id: latexId, quantity: 2 }]],
    ]);
    const inventoryByIdWithBundle = new Map([
      ...inventoryById,
      [bundleId, { id: bundleId, name: 'Helium - 7 Latex', is_bundle: true }],
    ]);
    const balloonOption = { id: 'opt-1', name: 'Helium bouquet', inventory_item_id: bundleId };
    const mascotOption = { id: 'opt-2', name: 'Blue mascot visit', inventory_item_id: bundleId };

    expect(portalOptionSupportsBalloonSlotCustomization(balloonOption, decorationsGroup, inventoryByIdWithBundle.get(bundleId))).toBe(true);
    expect(portalOptionSupportsBalloonSlotCustomization(mascotOption, mascotGroup, inventoryByIdWithBundle.get(bundleId))).toBe(false);

    expect(
      optionNeedsBundleCustomization(balloonOption, inventoryByIdWithBundle, bundleItemsByBundleId, decorationsGroup)
    ).toBe(true);
    expect(
      optionNeedsBundleCustomization(mascotOption, inventoryByIdWithBundle, bundleItemsByBundleId, mascotGroup)
    ).toBe(false);
  });

  it('requires bundle component inventory rows to detect modifier slots', () => {
    const group = { id: 'grp-deco', name: 'Decorations' };
    const bundleItemsByBundleId = new Map([
      [bundleId, [{ component_inventory_id: latexId, quantity: 2 }]],
    ]);
    const topLevelOnly = new Map([
      [bundleId, { id: bundleId, name: 'Helium - 7 Latex', is_bundle: true }],
    ]);
    const option = { id: 'opt-1', name: 'Helium bouquet', inventory_item_id: bundleId };

    expect(optionNeedsBundleCustomization(option, topLevelOnly, bundleItemsByBundleId, group)).toBe(false);

    const withComponents = new Map([
      ...topLevelOnly,
      ...inventoryById,
    ]);
    expect(optionNeedsBundleCustomization(option, withComponents, bundleItemsByBundleId, group)).toBe(true);
  });
});
