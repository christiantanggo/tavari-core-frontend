import { describe, expect, it } from 'vitest';
import {
  getModifierOptionPricePreview,
  resolveModifierChargePrice,
  sortModifierOptionsIncludedFirst,
} from '../posIncludedModifierPricing';
import { getNestedMinInventoryPrice } from '../posModifierVisibility';

describe('combo nested modifier price preview', () => {
  const allowance = { categoryId: 'drinks', maxPrice: 2.25 };

  const groups = [
    {
      id: 'combo-drink',
      show_when_inventory_id: null,
      modifiers: [
        { id: 'slush', name: 'Slush Puppie', inventory_price: 0, category_id: 'drinks', price: 0 },
        { id: 'water', name: 'Water', inventory_price: 1.77, category_id: 'drinks', price: 0 },
      ],
    },
    {
      id: 'slush-size',
      show_when_inventory_id: 'slush',
      modifiers: [
        { id: 'small', name: 'Small', inventory_price: 3.54, category_id: 'drinks', price: 1.29 },
        { id: 'large', name: 'Large', inventory_price: 5.97, category_id: 'drinks', price: 3.72 },
      ],
    },
    {
      id: 'slush-flavour',
      show_when_inventory_id: 'slush',
      modifiers: [
        { id: 'cherry', name: 'Cherry', inventory_price: 0, category_id: 'drinks', price: 0 },
      ],
    },
  ];

  it('uses cheapest nested size, ignoring free flavours', () => {
    expect(getNestedMinInventoryPrice(groups, 'slush')).toBe(3.54);
    expect(getNestedMinInventoryPrice(groups, 'water')).toBe(0);
  });

  it('does not show Included for $0 parent when nested size exceeds allowance', () => {
    const preview = getModifierOptionPricePreview({
      inventoryPrice: 0,
      categoryId: 'drinks',
      price: 0,
      nestedMinInventoryPrice: 3.54,
      allowance,
    });
    expect(preview.amount).toBe(1.29);
    expect(preview.isFrom).toBe(true);
  });

  it('still shows Included when own price is within allowance and no nested upcharge', () => {
    const preview = getModifierOptionPricePreview({
      inventoryPrice: 1.77,
      categoryId: 'drinks',
      price: resolveModifierChargePrice({
        inventoryPrice: 1.77,
        categoryId: 'drinks',
        allowance,
      }),
      nestedMinInventoryPrice: 0,
      allowance,
    });
    expect(preview.amount).toBe(0);
    expect(preview.isFrom).toBe(false);
  });
});

describe('sortModifierOptionsIncludedFirst', () => {
  const allowanceProduct = {
    included_modifier_category_id: 'drinks',
    included_modifier_max_price: 2.25,
  };

  it('puts Included drinks A–Z above upcharge drinks A–Z', () => {
    const group = { name: 'Combo Drink' };
    const mods = [
      { id: 'monster', name: 'Monster', inventory_price: 4.5, category_id: 'drinks', price: 2.25 },
      { id: 'water', name: 'Water', inventory_price: 1.77, category_id: 'drinks', price: 0 },
      { id: 'aloe', name: 'Aloe', inventory_price: 3.5, category_id: 'drinks', price: 1.25 },
      { id: 'bubly', name: 'Bubly', inventory_price: 1.77, category_id: 'drinks', price: 0 },
    ];
    const sorted = sortModifierOptionsIncludedFirst(mods, {
      group,
      product: allowanceProduct,
      nestedMinByModifierId: {},
    });
    expect(sorted.map((m) => m.name)).toEqual(['Bubly', 'Water', 'Aloe', 'Monster']);
  });

  it('does not reorder Size groups', () => {
    const group = { name: 'Fountain Pop Size' };
    const mods = [
      { id: 'l', name: 'Large', inventory_price: 3.98, category_id: 'drinks', price: 1.73 },
      { id: 's', name: 'Small', inventory_price: 2.21, category_id: 'drinks', price: 0 },
    ];
    const sorted = sortModifierOptionsIncludedFirst(mods, {
      group,
      product: allowanceProduct,
      nestedMinByModifierId: {},
    });
    expect(sorted.map((m) => m.name)).toEqual(['Large', 'Small']);
  });

  it('treats nested size upcharge as not-included for parent drink', () => {
    const group = { name: 'Combo Drink' };
    const mods = [
      { id: 'slush', name: 'Slush Puppie', inventory_price: 0, category_id: 'drinks', price: 0 },
      { id: 'water', name: 'Water', inventory_price: 1.77, category_id: 'drinks', price: 0 },
    ];
    const sorted = sortModifierOptionsIncludedFirst(mods, {
      group,
      product: allowanceProduct,
      nestedMinByModifierId: { slush: 3.54, water: 0 },
    });
    expect(sorted.map((m) => m.name)).toEqual(['Water', 'Slush Puppie']);
  });
});
