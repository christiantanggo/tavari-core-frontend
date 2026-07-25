import {
  buildSaleStockAdjustmentMap,
  invertAdjustmentMap,
  normalizeSaleLines,
} from '../posInventoryStock';

describe('posInventoryStock', () => {
  it('normalizes sale lines and skips custom items', () => {
    expect(
      normalizeSaleLines([
        { id: 'item-1', quantity: 2 },
        { id: 'custom_abc', quantity: 1 },
        { inventory_id: 'item-2', quantity: 0 },
      ])
    ).toEqual([{ inventoryId: 'item-1', quantity: 2 }]);
  });

  it('deducts tracked components when a bundle is sold', () => {
    const inventoryById = new Map([
      ['bundle-1', { id: 'bundle-1', is_bundle: true, track_stock: false }],
      ['comp-a', { id: 'comp-a', is_bundle: false, track_stock: true }],
      ['comp-b', { id: 'comp-b', is_bundle: false, track_stock: false }],
    ]);
    const bundleItemsByBundleId = new Map([
      [
        'bundle-1',
        [
          { component_inventory_id: 'comp-a', quantity: 2 },
          { component_inventory_id: 'comp-b', quantity: 1 },
        ],
      ],
    ]);

    const adjustments = buildSaleStockAdjustmentMap(
      [{ inventoryId: 'bundle-1', quantity: 3 }],
      inventoryById,
      bundleItemsByBundleId
    );

    expect(adjustments.get('comp-a')).toBe(-6);
    expect(adjustments.has('comp-b')).toBe(false);
    expect(adjustments.has('bundle-1')).toBe(false);
  });

  it('deducts tracked regular items directly', () => {
    const inventoryById = new Map([
      ['item-1', { id: 'item-1', is_bundle: false, track_stock: true }],
    ]);

    const adjustments = buildSaleStockAdjustmentMap(
      [{ inventoryId: 'item-1', quantity: 4 }],
      inventoryById,
      new Map()
    );

    expect(adjustments.get('item-1')).toBe(-4);
  });

  it('inverts sale adjustments for restock', () => {
    const saleMap = new Map([['comp-a', -6]]);
    const restockMap = invertAdjustmentMap(saleMap);
    expect(restockMap.get('comp-a')).toBe(6);
  });
});
