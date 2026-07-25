type PriceRecord = {
  supplier_id: string;
  ingredient_id?: string | null;
  pos_inventory_id?: string | null;
  inventory_id?: string | null;
  price_per_unit: number;
  promo_price?: number | null;
  pack_size?: number | null;
  pack_size_unit?: string | null;
  unit_of_measure?: string | null;
  is_current?: boolean;
};

type IngredientRow = {
  id: string;
  purchase_unit_size?: number | null;
  cost_sync_enabled?: boolean | null;
  unit_of_measure?: string | null;
  units_per_case?: number | null;
};

function parseMoney(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function normalizeUnit(unit: string | null | undefined): string {
  if (!unit) return '';
  const key = unit.trim().toLowerCase();
  const aliases: Record<string, string> = {
    ea: 'each',
    each: 'each',
    pc: 'each',
    pcs: 'each',
    ct: 'each',
    count: 'each',
    kg: 'kg',
    g: 'g',
    l: 'l',
    ml: 'ml',
    lb: 'lb',
    oz: 'oz',
  };
  return aliases[key] || key;
}

export function getComparableUnitPrice(
  priceRecord: PriceRecord,
  inventoryUnit?: string | null,
): number | null {
  const shelfPrice = parseMoney(priceRecord.promo_price ?? priceRecord.price_per_unit);
  if (shelfPrice == null || shelfPrice <= 0) return null;

  const packSize = parseMoney(priceRecord.pack_size) || 1;
  const packUnit = normalizeUnit(priceRecord.pack_size_unit || priceRecord.unit_of_measure);
  const targetUnit = normalizeUnit(inventoryUnit || 'each');

  if (packSize <= 0) return null;
  if (!packUnit || packUnit === targetUnit) return shelfPrice / packSize;
  if (packUnit === 'g' && targetUnit === 'kg') return (shelfPrice / packSize) * 1000;
  if (packUnit === 'kg' && targetUnit === 'g') return (shelfPrice / packSize) / 1000;
  if (packUnit === 'ml' && targetUnit === 'l') return (shelfPrice / packSize) * 1000;
  if (packUnit === 'l' && targetUnit === 'ml') return (shelfPrice / packSize) / 1000;
  return null;
}

export function pickBestUnitPrice(
  priceRecords: PriceRecord[],
  inventoryUnit?: string | null,
): number | null {
  let best: number | null = null;
  for (const record of priceRecords) {
    const unitPrice = getComparableUnitPrice(record, inventoryUnit);
    if (unitPrice == null) continue;
    if (best == null || unitPrice < best) best = unitPrice;
  }
  return best;
}

export function getLinkedItemId(record: PriceRecord): string | null {
  return record.pos_inventory_id || record.inventory_id || null;
}

export async function syncIngredientCostsFromSupplierPrices(
  supabaseAdmin: {
    from: (table: string) => unknown;
  },
  businessId: string,
): Promise<{ ingredientsUpdated: number; inventoryUpdated: number }> {
  const { data: suppliers, error: suppliersError } = await supabaseAdmin
    .from('rb_suppliers')
    .select('id')
    .eq('business_id', businessId)
    .eq('is_active', true);

  if (suppliersError) throw new Error(suppliersError.message);

  const supplierIds = ((suppliers || []) as { id: string }[]).map((s) => s.id);
  if (supplierIds.length === 0) return { ingredientsUpdated: 0, inventoryUpdated: 0 };

  const { data: prices, error: pricesError } = await supabaseAdmin
    .from('rb_supplier_prices')
    .select(
      'supplier_id, ingredient_id, price_per_unit, promo_price, pack_size, pack_size_unit, unit_of_measure, is_current',
    )
    .in('supplier_id', supplierIds)
    .eq('is_current', true)
    .not('ingredient_id', 'is', null);

  if (pricesError) throw new Error(pricesError.message);

  const pricesByIngredient = new Map<string, PriceRecord[]>();
  for (const row of (prices || []) as PriceRecord[]) {
    if (!row.ingredient_id) continue;
    const list = pricesByIngredient.get(row.ingredient_id) || [];
    list.push(row);
    pricesByIngredient.set(row.ingredient_id, list);
  }

  const { data: ingredients, error: ingredientsError } = await supabaseAdmin
    .from('ingredients')
    .select('id, purchase_unit_size, cost_sync_enabled, unit_of_measure, units_per_case')
    .eq('business_id', businessId);

  if (ingredientsError) throw new Error(ingredientsError.message);

  let ingredientsUpdated = 0;

  for (const ingredient of (ingredients || []) as IngredientRow[]) {
    if (ingredient.cost_sync_enabled === false) continue;

    const linkedPrices = pricesByIngredient.get(ingredient.id) || [];
    if (linkedPrices.length === 0) continue;

    let bestUnitPrice: number | null = null;
    let bestRecord: PriceRecord | null = null;
    for (const record of linkedPrices) {
      const unitPrice = getComparableUnitPrice(record, ingredient.unit_of_measure || 'each');
      if (unitPrice == null) continue;
      if (bestUnitPrice == null || unitPrice < bestUnitPrice) {
        bestUnitPrice = unitPrice;
        bestRecord = record;
      }
    }

    if (bestUnitPrice == null || !bestRecord) continue;

    const shelfPrice = parseMoney(bestRecord.promo_price ?? bestRecord.price_per_unit);
    const scrapedPackSize = parseMoney(bestRecord.pack_size);
    const unitsPerCase = parseMoney(ingredient.units_per_case) || scrapedPackSize || 1;
    const packUnit = bestRecord.pack_size_unit || bestRecord.unit_of_measure || '';
    const caseSizeLabel = scrapedPackSize && packUnit
      ? `${scrapedPackSize} ${packUnit}`.trim()
      : null;

    let ingredientCost = bestUnitPrice;
    if (shelfPrice != null && shelfPrice > 0 && unitsPerCase > 0) {
      ingredientCost = shelfPrice / unitsPerCase;
    } else if (
      bestUnitPrice != null &&
      shelfPrice != null &&
      bestUnitPrice > 0 &&
      bestUnitPrice < shelfPrice * 0.25
    ) {
      ingredientCost = bestUnitPrice;
    } else {
      continue;
    }

    const purchaseUnitSize = parseMoney(ingredient.purchase_unit_size) || 1;
    ingredientCost *= purchaseUnitSize;
    ingredientCost = Math.round(ingredientCost * 1e6) / 1e6;

    const { error: updateIngredientError } = await supabaseAdmin
      .from('ingredients')
      .update({
        cost: ingredientCost,
        case_price: shelfPrice,
        units_per_case: unitsPerCase,
        case_size: caseSizeLabel,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ingredient.id);

    if (updateIngredientError) throw new Error(updateIngredientError.message);
    ingredientsUpdated += 1;
  }

  return { ingredientsUpdated, inventoryUpdated: 0 };
}
