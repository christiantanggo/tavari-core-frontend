import {
  computePosLineFoodCost,
  getSaleItemFoodCostFields,
  resolveSaleLineUnitCost,
  suggestedPriceFromCost,
} from '../posLineFoodCost.js';

describe('posLineFoodCost', () => {
  test('suggested price from cost and margin', () => {
    expect(suggestedPriceFromCost(0.22, 60)).toBeCloseTo(0.55, 2);
    expect(suggestedPriceFromCost(0, 60)).toBeNull();
  });

  test('base only', () => {
    expect(computePosLineFoodCost(0.08, [])).toBe(0.08);
  });

  test('base + modifier costs add up', () => {
    expect(computePosLineFoodCost(0.08, [{ cost: 0.14 }])).toBe(0.22);
    expect(
      computePosLineFoodCost(0.08, [{ cost: 0.14 }, { cost: 0.05 }]),
    ).toBe(0.27);
  });

  test('sale item fields', () => {
    expect(
      getSaleItemFoodCostFields({
        cost: 0.08,
        quantity: 2,
        modifiers: [{ cost: 0.14 }],
      }),
    ).toEqual({ unit_cost: 0.22, food_cost_total: 0.44 });
  });

  test('resolve prefers saved unit_cost', () => {
    expect(resolveSaleLineUnitCost({ unit_cost: 0.5, pos_inventory: { cost: 0.1 } })).toBe(0.5);
  });
});
