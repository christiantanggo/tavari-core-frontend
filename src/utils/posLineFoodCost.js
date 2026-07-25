/** Composite POS line food cost: base item + sum of selected modifier costs. */

export const DEFAULT_RECIPE_MARGIN_PERCENT = 60;

export function parseFoodCost(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

/** Suggested retail price from food cost and target margin (matches Recipe Manager). */
export function suggestedPriceFromCost(cost, marginPercent = DEFAULT_RECIPE_MARGIN_PERCENT) {
  const foodCost = parseFoodCost(cost);
  const margin = parseFoodCost(marginPercent) ?? DEFAULT_RECIPE_MARGIN_PERCENT;
  if (foodCost == null || foodCost <= 0 || margin >= 100) return null;
  return Math.round((foodCost / (1 - margin / 100)) * 100) / 100;
}

/**
 * @param {number|null|undefined} parentCost - base recipe cost on sellable item
 * @param {Array<{ cost?: number }>} modifiers - selected options; each cost comes from Recipe Manager
 */
export function computePosLineFoodCost(parentCost, modifiers = []) {
  const base = parseFoodCost(parentCost) ?? 0;
  let modifierCostTotal = 0;

  for (const mod of modifiers || []) {
    modifierCostTotal += parseFoodCost(mod.cost) ?? 0;
  }

  const lineCost = base + modifierCostTotal;
  return Math.round(lineCost * 1e6) / 1e6;
}

export function getSaleItemFoodCostFields(item) {
  const qty = parseFoodCost(item?.quantity) ?? 1;
  const unitCost = computePosLineFoodCost(item?.cost, item?.modifiers);
  return {
    unit_cost: unitCost,
    food_cost_total: Math.round(unitCost * qty * 1e6) / 1e6,
  };
}

/** Prefer saved sale line cost, then composite from modifiers, then inventory cost. */
export function resolveSaleLineUnitCost(saleItem) {
  const saved = parseFoodCost(saleItem?.unit_cost);
  if (saved != null) return saved;
  const fromInventory = parseFoodCost(saleItem?.pos_inventory?.cost);
  if (fromInventory != null && (!saleItem?.modifiers || saleItem.modifiers.length === 0)) {
    return fromInventory;
  }
  return computePosLineFoodCost(fromInventory ?? 0, saleItem?.modifiers);
}
