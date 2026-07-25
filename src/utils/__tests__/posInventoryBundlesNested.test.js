import {
  buildInventoryPriceMapWithBundles,
  bundleContainsBundleId,
  groupBundleItemsByBundleId,
  resolveNestedBundlePrice,
  wouldAddingBundleComponentCreateCycle,
} from '../posInventoryBundles';
import { buildSaleStockAdjustmentMap as buildStockMap } from '../posInventoryStock';

describe('nested pos inventory bundles', () => {
  const bundleItemsByBundleId = groupBundleItemsByBundleId([
    {
      bundle_inventory_id: 'pizza-pack',
      component_inventory_id: 'cheese-pizza',
      quantity: 2,
      sort_order: 0,
    },
    {
      bundle_inventory_id: 'party-food',
      component_inventory_id: 'pizza-pack',
      quantity: 1,
      sort_order: 0,
    },
    {
      bundle_inventory_id: 'party-food',
      component_inventory_id: 'juice',
      quantity: 4,
      sort_order: 1,
    },
  ]);

  const inventoryById = new Map([
    ['cheese-pizza', { id: 'cheese-pizza', is_bundle: false, price: 10, track_stock: true }],
    ['juice', { id: 'juice', is_bundle: false, price: 2, track_stock: true }],
    ['pizza-pack', { id: 'pizza-pack', is_bundle: true, bundle_use_auto_price: true, price: 0 }],
    ['party-food', { id: 'party-food', is_bundle: true, bundle_use_auto_price: true, price: 0 }],
  ]);

  it('detects bundle cycles', () => {
    expect(bundleContainsBundleId('party-food', 'party-food', bundleItemsByBundleId)).toBe(true);
    expect(
      wouldAddingBundleComponentCreateCycle('pizza-pack', 'party-food', bundleItemsByBundleId)
    ).toBe(true);
    expect(
      wouldAddingBundleComponentCreateCycle('party-food', 'pizza-pack', bundleItemsByBundleId)
    ).toBe(false);
  });

  it('resolves nested bundle auto prices', () => {
    const prices = buildInventoryPriceMapWithBundles(
      [...inventoryById.values()],
      bundleItemsByBundleId,
      {}
    );
    expect(prices['cheese-pizza']).toBe(10);
    expect(prices['pizza-pack']).toBe(20);
    expect(prices['party-food']).toBe(28);
    expect(resolveNestedBundlePrice('party-food', inventoryById, bundleItemsByBundleId, {})).toBe(28);
  });

  it('expands nested bundle stock to leaf items', () => {
    const inventoryForStock = new Map([
      ['cheese-pizza', { id: 'cheese-pizza', is_bundle: false, track_stock: true }],
      ['juice', { id: 'juice', is_bundle: false, track_stock: true }],
      ['pizza-pack', { id: 'pizza-pack', is_bundle: true, track_stock: false }],
      ['party-food', { id: 'party-food', is_bundle: true, track_stock: false }],
    ]);

    const adjustments = buildStockMap(
      [{ inventoryId: 'party-food', quantity: 1 }],
      inventoryForStock,
      bundleItemsByBundleId
    );

    expect(adjustments.get('cheese-pizza')).toBe(-2);
    expect(adjustments.get('juice')).toBe(-4);
  });
});
