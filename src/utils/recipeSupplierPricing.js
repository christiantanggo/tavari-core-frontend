/**
 * Normalize supplier price records to a comparable per-unit cost for best-price comparison.
 */

const UNIT_ALIASES = {
  ea: 'each',
  each: 'each',
  pc: 'each',
  pcs: 'each',
  ct: 'each',
  count: 'each',
  kg: 'kg',
  g: 'g',
  gram: 'g',
  grams: 'g',
  l: 'l',
  litre: 'l',
  liter: 'l',
  ml: 'ml',
  lb: 'lb',
  lbs: 'lb',
  oz: 'oz',
};

export function normalizeUnit(unit) {
  if (!unit) return '';
  const key = String(unit).trim().toLowerCase();
  return UNIT_ALIASES[key] || key;
}

export function parseMoney(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export function getLinkedItemId(record) {
  return record?.pos_inventory_id || record?.inventory_id || null;
}

export function getLinkedIngredientId(record) {
  return record?.ingredient_id || null;
}

/**
 * Returns comparable unit price for an inventory item, or null if not comparable.
 */
export function getComparableUnitPrice(priceRecord, inventoryUnit) {
  if (!priceRecord) return null;

  const shelfPrice = parseMoney(priceRecord.promo_price ?? priceRecord.price_per_unit);
  if (shelfPrice == null || shelfPrice <= 0) return null;

  const packSize = parseMoney(priceRecord.pack_size) || 1;
  const packUnit = normalizeUnit(priceRecord.pack_size_unit || priceRecord.unit_of_measure);
  const targetUnit = normalizeUnit(inventoryUnit);

  if (packSize <= 0) return null;

  if (!targetUnit || !packUnit || packUnit === targetUnit) {
    return shelfPrice / packSize;
  }

  // Simple metric conversions when units differ but are compatible
  if (packUnit === 'g' && targetUnit === 'kg') return (shelfPrice / packSize) * 1000;
  if (packUnit === 'kg' && targetUnit === 'g') return (shelfPrice / packSize) / 1000;
  if (packUnit === 'ml' && targetUnit === 'l') return (shelfPrice / packSize) * 1000;
  if (packUnit === 'l' && targetUnit === 'ml') return (shelfPrice / packSize) / 1000;

  return null;
}

export function pickBestSupplierPrice(priceRecords, inventoryUnit) {
  let best = null;

  for (const record of priceRecords || []) {
    const unitPrice = getComparableUnitPrice(record, inventoryUnit);
    if (unitPrice == null) continue;

    if (!best || unitPrice < best.unitPrice) {
      best = { record, unitPrice };
    }
  }

  return best;
}

export function buildBestPriceOrderGuide({ inventoryItems, suppliers, priceRecords }) {
  const supplierMap = new Map((suppliers || []).map((s) => [s.id, s]));
  const pricesByInventory = new Map();

  for (const record of priceRecords || []) {
    const itemId = getLinkedItemId(record);
    if (!record.is_current || !itemId) continue;
    const list = pricesByInventory.get(itemId) || [];
    list.push(record);
    pricesByInventory.set(itemId, list);
  }

  const assignments = [];
  const unpriced = [];

  for (const item of inventoryItems || []) {
    const candidates = pricesByInventory.get(item.id) || [];
    const best = pickBestSupplierPrice(candidates, item.unit_of_measure || 'each');

    if (!best) {
      unpriced.push(item);
      continue;
    }

    assignments.push({
      inventoryId: item.id,
      inventoryName: item.name,
      unitOfMeasure: item.unit_of_measure,
      supplierId: best.record.supplier_id,
      supplierName: supplierMap.get(best.record.supplier_id)?.name || 'Unknown supplier',
      unitPrice: best.unitPrice,
      shelfPrice: parseMoney(best.record.promo_price ?? best.record.price_per_unit),
      packSize: best.record.pack_size,
      packSizeUnit: best.record.pack_size_unit || best.record.unit_of_measure,
      productUrl: best.record.product_url,
      scrapedAt: best.record.scraped_at,
      allPrices: candidates
        .map((record) => ({
          supplierId: record.supplier_id,
          supplierName: supplierMap.get(record.supplier_id)?.name || 'Unknown',
          unitPrice: getComparableUnitPrice(record, item.unit_of_measure),
          shelfPrice: parseMoney(record.promo_price ?? record.price_per_unit),
          scrapedAt: record.scraped_at,
          scrapeError: record.scrape_error,
        }))
        .filter((row) => row.unitPrice != null),
    });
  }

  const bySupplier = new Map();
  for (const row of assignments) {
    const group = bySupplier.get(row.supplierId) || {
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      items: [],
      estimatedTotal: 0,
    };
    group.items.push(row);
    group.estimatedTotal += row.unitPrice;
    bySupplier.set(row.supplierId, group);
  }

  const groups = Array.from(bySupplier.values()).sort((a, b) =>
    a.supplierName.localeCompare(b.supplierName)
  );

  return { groups, unpriced, assignments };
}

export function buildIngredientOrderGuide({ ingredients, suppliers, priceRecords }) {
  const supplierMap = new Map((suppliers || []).map((s) => [s.id, s]));
  const pricesByIngredient = new Map();

  for (const record of priceRecords || []) {
    const ingredientId = getLinkedIngredientId(record);
    if (!record.is_current || !ingredientId) continue;
    const list = pricesByIngredient.get(ingredientId) || [];
    list.push(record);
    pricesByIngredient.set(ingredientId, list);
  }

  const assignments = [];
  const unpriced = [];

  for (const ingredient of ingredients || []) {
    const candidates = pricesByIngredient.get(ingredient.id) || [];
    const best = pickBestSupplierPrice(candidates, ingredient.unit_of_measure || 'each');

    if (!best) {
      unpriced.push(ingredient);
      continue;
    }

    assignments.push({
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      unitOfMeasure: ingredient.unit_of_measure,
      supplierId: best.record.supplier_id,
      supplierName: supplierMap.get(best.record.supplier_id)?.name || 'Unknown supplier',
      unitPrice: best.unitPrice,
      shelfPrice: parseMoney(best.record.promo_price ?? best.record.price_per_unit),
      packSize: best.record.pack_size,
      packSizeUnit: best.record.pack_size_unit || best.record.unit_of_measure,
      productUrl: best.record.product_url,
      scrapedAt: best.record.scraped_at,
      allPrices: candidates
        .map((record) => ({
          supplierId: record.supplier_id,
          supplierName: supplierMap.get(record.supplier_id)?.name || 'Unknown',
          unitPrice: getComparableUnitPrice(record, ingredient.unit_of_measure),
          shelfPrice: parseMoney(record.promo_price ?? record.price_per_unit),
          scrapedAt: record.scraped_at,
          scrapeError: record.scrape_error,
        }))
        .filter((row) => row.unitPrice != null),
    });
  }

  const bySupplier = new Map();
  for (const row of assignments) {
    const group = bySupplier.get(row.supplierId) || {
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      items: [],
      estimatedTotal: 0,
    };
    group.items.push(row);
    group.estimatedTotal += row.unitPrice;
    bySupplier.set(row.supplierId, group);
  }

  const groups = Array.from(bySupplier.values()).sort((a, b) =>
    a.supplierName.localeCompare(b.supplierName)
  );

  return { groups, unpriced, assignments };
}

export function roundFoodCost(amount) {
  if (amount == null || Number.isNaN(amount)) return null;
  const n = typeof amount === 'number' ? amount : parseFloat(String(amount));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1e6) / 1e6;
}

export function getSupplierPriceDraft(record) {
  if (!record || !(parseFloat(record.price_per_unit) > 0)) return '';
  return String(record.price_per_unit);
}

export function getSupplierPackSizeDraft(record, ingredient) {
  const packSize = parseFloat(record?.pack_size);
  if (Number.isFinite(packSize) && packSize > 0) return String(packSize);
  return '';
}

export function resolvePackSizeDraft(packSizeDrafts, ingredientId, existing, ingredient) {
  const key = String(ingredientId);
  if (key in packSizeDrafts) return packSizeDrafts[key];
  return getSupplierPackSizeDraft(existing, ingredient);
}

export function resolveLinkDraft(linkDrafts, ingredientId, existing) {
  const key = String(ingredientId);
  if (key in linkDrafts) return String(linkDrafts[key] ?? '').trim();
  return String(existing?.product_url ?? '').trim();
}

export function isDraftFieldCleared(drafts, id) {
  return String(id) in drafts && String(drafts[id]).trim() === '';
}

/** Merge DB-backed drafts with in-progress local edits; drop cleared rows and stale deleted keys. */
export function mergeSupplierDraftMaps(prev, fromDb) {
  const next = { ...fromDb };
  for (const [key, value] of Object.entries(prev)) {
    if (key in fromDb) continue;
    if (String(value).trim() !== '') next[key] = value;
  }
  return next;
}

/** Build rb_supplier_prices fields from a case or unit price entered manually. */
export function buildManualPriceFields(
  ingredient,
  caseOrUnitPrice,
  fallbackCasePrice,
  packSizeOverride,
  { allowPriceFallback = true, allowPackFallback = true } = {},
) {
  let price = parseFloat(caseOrUnitPrice);
  if ((!Number.isFinite(price) || price <= 0) && allowPriceFallback && fallbackCasePrice != null) {
    price = parseFloat(fallbackCasePrice);
  }
  if (!Number.isFinite(price) || price <= 0) return null;

  const packProvided = packSizeOverride !== undefined && packSizeOverride !== null && packSizeOverride !== '';
  let unitsPerCase = packProvided ? parseFloat(packSizeOverride) : NaN;
  if ((!Number.isFinite(unitsPerCase) || unitsPerCase <= 0) && allowPackFallback) {
    unitsPerCase = parseFloat(ingredient.units_per_case);
  }
  const unit = ingredient.unit_of_measure || 'each';

  if (Number.isFinite(unitsPerCase) && unitsPerCase > 0) {
    return {
      price_per_unit: roundFoodCost(price),
      pack_size: unitsPerCase,
      pack_size_unit: unit,
      unit_of_measure: unit,
    };
  }

  return {
    price_per_unit: roundFoodCost(price),
    pack_size: 1,
    pack_size_unit: unit,
    unit_of_measure: unit,
  };
}

export function buildSupplierPricePreview(ingredient, priceDraft, packDraft, existing, draftFlags = {}) {
  const { priceInDraft = false, packInDraft = false } = draftFlags;
  if (priceInDraft && String(priceDraft).trim() === '') return null;

  const packCleared = packInDraft && String(packDraft).trim() === '';
  return buildManualPriceFields(
    ingredient,
    priceDraft,
    priceInDraft ? null : ingredient?.case_price,
    packInDraft ? packDraft : undefined,
    {
      allowPriceFallback: !priceInDraft,
      allowPackFallback: !packInDraft || !packCleared,
    },
  );
}

export function resolvePriceDraft(priceDrafts, ingredientId, existing) {
  const key = String(ingredientId);
  return key in priceDrafts ? priceDrafts[key] : getSupplierPriceDraft(existing);
}

/**
 * Persist manual supplier prices for one supplier across many ingredients.
 * Returns number of rows written. Throws on first database error.
 */
export async function saveSupplierIngredientPrices(supabase, {
  supplierId,
  ingredients,
  priceDrafts,
  linkDrafts,
  packSizeDrafts = {},
  priceByIngredientId,
}) {
  let savedCount = 0;

  const assertOk = (result, context) => {
    if (result?.error) {
      throw new Error(result.error.message || `Failed to save supplier price (${context})`);
    }
  };

  for (const ingredient of ingredients || []) {
    const ingredientId = ingredient.id;
    const existing = priceByIngredientId?.get?.(ingredientId);
    const url = resolveLinkDraft(linkDrafts, ingredientId, existing);
    const priceDraft = resolvePriceDraft(priceDrafts, ingredientId, existing);
    const packSizeDraft = resolvePackSizeDraft(packSizeDrafts, ingredientId, existing, ingredient);
    const priceCleared = isDraftFieldCleared(priceDrafts, ingredientId);
    const packInDrafts = String(ingredientId) in packSizeDrafts;
    const packCleared = isDraftFieldCleared(packSizeDrafts, ingredientId);
    const priceInDrafts = String(ingredientId) in priceDrafts;

    const manualPriceFields = priceCleared
      ? null
      : buildManualPriceFields(
          ingredient,
          priceDraft,
          priceInDrafts ? null : ingredient.case_price,
          packInDrafts ? packSizeDraft : undefined,
          {
            allowPriceFallback: !priceInDrafts,
            allowPackFallback: !packInDrafts || !packCleared,
          },
        );
    const hasUrl = Boolean(url);
    const hasManualPrice = Boolean(manualPriceFields);

    if (!hasUrl && !hasManualPrice) {
      if (existing && (existing.product_url || parseFloat(existing.price_per_unit) > 0)) {
        assertOk(
          await supabase.from('rb_supplier_prices').delete().eq('id', existing.id),
          `clear ${ingredient.name || ingredientId}`,
        );
        savedCount += 1;
      }
      continue;
    }

    const baseFields = {
      ingredient_id: ingredientId,
      pos_inventory_id: null,
      inventory_id: null,
      unit_of_measure: ingredient.unit_of_measure || 'each',
      is_current: true,
      last_updated: new Date().toISOString(),
      scrape_error: null,
    };

    if (existing) {
      const nextUrl = hasUrl ? url : null;
      const priceCleared = isDraftFieldCleared(priceDrafts, ingredientId);
      const nextPriceFields = hasManualPrice
        ? manualPriceFields
        : priceCleared
          ? null
          : {
              price_per_unit: existing.price_per_unit,
              pack_size: existing.pack_size,
              pack_size_unit: existing.pack_size_unit,
            };

      if (!nextPriceFields && !nextUrl) {
        assertOk(
          await supabase.from('rb_supplier_prices').delete().eq('id', existing.id),
          `remove ${ingredient.name || ingredientId}`,
        );
        savedCount += 1;
        continue;
      }

      if (!nextPriceFields) {
        assertOk(
          await supabase
            .from('rb_supplier_prices')
            .update({
              ...baseFields,
              product_url: nextUrl,
            })
            .eq('id', existing.id),
          `url ${ingredient.name || ingredientId}`,
        );
        savedCount += 1;
        continue;
      }

      const unchanged =
        (existing.product_url || null) === nextUrl
        && parseFloat(existing.price_per_unit) === parseFloat(nextPriceFields.price_per_unit)
        && parseFloat(existing.pack_size || 1) === parseFloat(nextPriceFields.pack_size || 1)
        && (existing.pack_size_unit || existing.unit_of_measure || '') === (nextPriceFields.pack_size_unit || '');

      if (unchanged) continue;

      assertOk(
        await supabase
          .from('rb_supplier_prices')
          .update({
            ...baseFields,
            product_url: nextUrl,
            price_per_unit: nextPriceFields.price_per_unit,
            pack_size: nextPriceFields.pack_size,
            pack_size_unit: nextPriceFields.pack_size_unit,
          })
          .eq('id', existing.id),
        `update ${ingredient.name || ingredientId}`,
      );
    } else {
      if (!hasManualPrice) {
        if (!hasUrl) continue;
        throw new Error(
          `Enter a case/unit price for ${ingredient.name || 'this item'}, or save the case breakdown first, before adding a product URL`,
        );
      }

      const insertPayload = {
        ...baseFields,
        supplier_id: supplierId,
        product_url: hasUrl ? url : null,
        price_per_unit: manualPriceFields.price_per_unit,
        pack_size: manualPriceFields.pack_size,
        pack_size_unit: manualPriceFields.pack_size_unit,
      };

      const insertResult = await supabase
        .from('rb_supplier_prices')
        .insert(insertPayload)
        .select('id')
        .single();

      if (insertResult.error?.code === '23505') {
        const { data: conflictRow, error: conflictError } = await supabase
          .from('rb_supplier_prices')
          .select('id')
          .eq('supplier_id', supplierId)
          .eq('ingredient_id', ingredientId)
          .eq('is_current', true)
          .maybeSingle();

        if (conflictError) throw new Error(conflictError.message);
        if (conflictRow?.id) {
          assertOk(
            await supabase
              .from('rb_supplier_prices')
              .update({
                ...baseFields,
                product_url: hasUrl ? url : null,
                price_per_unit: manualPriceFields.price_per_unit,
                pack_size: manualPriceFields.pack_size,
                pack_size_unit: manualPriceFields.pack_size_unit,
              })
              .eq('id', conflictRow.id),
            `upsert ${ingredient.name || ingredientId}`,
          );
        } else {
          throw new Error(insertResult.error.message || `Failed to insert price for ${ingredient.name || ingredientId}`);
        }
      } else {
        assertOk(insertResult, `insert ${ingredient.name || ingredientId}`);
      }
    }
    savedCount += 1;
  }

  return savedCount;
}

/**
 * Unit cost from case price ÷ units per case. Prefer this over scraped per-unit when both exist.
 */
export function computeIngredientUnitCost({
  casePrice,
  unitsPerCase,
  purchaseUnitSize = 1,
  storedCost = null,
  scrapedUnitPrice = null,
} = {}) {
  const caseAmt = parseMoney(casePrice);
  const units = parseMoney(unitsPerCase);
  const purchaseSize = parseMoney(purchaseUnitSize) || 1;

  if (caseAmt != null && caseAmt > 0 && units != null && units > 0) {
    return roundFoodCost((caseAmt / units) * purchaseSize);
  }

  const stored = parseMoney(storedCost);
  const scraped = parseMoney(scrapedUnitPrice);

  // Stored cost equal to case price means sync ran before units_per_case was set — ignore it.
  if (stored != null && stored > 0 && caseAmt != null && caseAmt > 0 && stored >= caseAmt * 0.5) {
    return scraped != null && scraped > 0 && scraped < caseAmt ? roundFoodCost(scraped) : 0;
  }

  if (stored != null && stored > 0) return roundFoodCost(stored);
  if (scraped != null && scraped > 0) return roundFoodCost(scraped);
  return 0;
}

/** Display food/unit costs — uses 4 decimals when under $1 (fountain syrup, per-oz, etc.). */
export function formatFoodCost(amount) {
  if (amount == null || Number.isNaN(amount)) return '—';
  const n = typeof amount === 'number' ? amount : parseFloat(String(amount));
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '$0.0000';
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export function formatCurrency(amount) {
  if (amount == null || Number.isNaN(amount)) return '—';
  return `$${amount.toFixed(2)}`;
}

export function formatUnitPrice(amount, unit) {
  if (amount == null || Number.isNaN(amount)) return '—';
  const n = typeof amount === 'number' ? amount : parseFloat(String(amount));
  if (!Number.isFinite(n)) return '—';
  const suffix = unit ? ` / ${unit}` : '';
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}${suffix}`;
  return `$${n.toFixed(4)}${suffix}`;
}
