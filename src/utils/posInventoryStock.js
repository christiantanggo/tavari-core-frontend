/** POS inventory stock adjustments (sales, restocks, nested bundle expansion). */

import {
  expandBundleStockAdjustments,
  fetchAllBundleItemRows,
  groupBundleItemsByBundleId,
} from './posInventoryBundles';

const normalizeSaleLine = (line) => {
  const inventoryId = String(
    line?.inventoryId ?? line?.inventory_id ?? line?.id ?? ''
  ).trim();
  const quantity = Math.max(0, Number.parseInt(String(line?.quantity ?? 1), 10) || 0);
  if (!inventoryId || inventoryId.startsWith('custom_') || quantity <= 0) {
    return null;
  }
  return { inventoryId, quantity };
};

export const normalizeSaleLines = (saleLines = []) =>
  (saleLines || []).map(normalizeSaleLine).filter(Boolean);

/**
 * Build inventory_id -> quantity_delta map for a sale.
 * Bundles expand recursively to tracked leaf items.
 * Deltas are negative for sales.
 */
export const buildSaleStockAdjustmentMap = (
  saleLines = [],
  inventoryById = new Map(),
  bundleItemsByBundleId = new Map()
) => {
  const adjustments = new Map();
  const addDelta = (inventoryId, delta) => {
    if (!inventoryId || !delta) return;
    adjustments.set(inventoryId, (adjustments.get(inventoryId) || 0) + delta);
  };

  normalizeSaleLines(saleLines).forEach(({ inventoryId, quantity }) => {
    const inv = inventoryById.get(inventoryId);
    if (!inv) return;

    if (inv.is_bundle) {
      expandBundleStockAdjustments(
        inventoryId,
        quantity,
        inventoryById,
        bundleItemsByBundleId,
        addDelta
      );
      return;
    }

    if (inv.track_stock) {
      addDelta(inventoryId, -quantity);
    }
  });

  return adjustments;
};

export const adjustmentMapToPayload = (adjustmentMap = new Map()) =>
  [...adjustmentMap.entries()]
    .filter(([, quantityDelta]) => quantityDelta !== 0)
    .map(([inventory_id, quantity_delta]) => ({ inventory_id, quantity_delta }));

export const invertAdjustmentMap = (adjustmentMap = new Map()) => {
  const inverted = new Map();
  adjustmentMap.forEach((delta, inventoryId) => {
    if (delta !== 0) inverted.set(inventoryId, -delta);
  });
  return inverted;
};

const loadNestedBundleContext = async (supabase, businessId, seedInventoryIds = []) => {
  const inventoryById = new Map();
  if (!businessId || seedInventoryIds.length === 0) {
    return { inventoryById, bundleItemsByBundleId: new Map() };
  }

  const pendingInventoryIds = [...new Set(seedInventoryIds.filter(Boolean))];
  const loadedInventoryIds = new Set();

  while (pendingInventoryIds.length > 0) {
    const batch = pendingInventoryIds.filter((id) => !loadedInventoryIds.has(id));
    if (batch.length === 0) break;
    batch.forEach((id) => loadedInventoryIds.add(id));

    const { data: inventoryRows, error } = await supabase
      .from('pos_inventory')
      .select('id, is_bundle, track_stock')
      .eq('business_id', businessId)
      .in('id', batch);

    if (error) throw error;

    (inventoryRows || []).forEach((row) => inventoryById.set(row.id, row));
  }

  const rootBundleIds = [...inventoryById.values()]
    .filter((row) => row.is_bundle)
    .map((row) => row.id);

  const bundleRows =
    rootBundleIds.length > 0
      ? await fetchAllBundleItemRows(supabase, businessId, rootBundleIds)
      : [];
  const bundleItemsByBundleId = groupBundleItemsByBundleId(bundleRows);

  const nestedComponentIds = [
    ...new Set((bundleRows || []).map((row) => row.component_inventory_id).filter(Boolean)),
  ].filter((id) => !inventoryById.has(id));

  if (nestedComponentIds.length > 0) {
    const { data: componentRows, error: componentError } = await supabase
      .from('pos_inventory')
      .select('id, is_bundle, track_stock')
      .eq('business_id', businessId)
      .in('id', nestedComponentIds);

    if (componentError) throw componentError;
    (componentRows || []).forEach((row) => inventoryById.set(row.id, row));
  }

  return { inventoryById, bundleItemsByBundleId };
};

const fetchInventoryContext = async (supabase, businessId, saleLines) => {
  const normalizedLines = normalizeSaleLines(saleLines);
  const inventoryIds = [...new Set(normalizedLines.map((line) => line.inventoryId))];
  return loadNestedBundleContext(supabase, businessId, inventoryIds);
};

const applyStockAdjustmentMapFallback = async (supabase, businessId, adjustmentMap) => {
  let applied = 0;
  for (const [inventoryId, quantityDelta] of adjustmentMap.entries()) {
    if (!quantityDelta) continue;

    const { data: invRow, error: readError } = await supabase
      .from('pos_inventory')
      .select('stock_quantity, track_stock')
      .eq('id', inventoryId)
      .eq('business_id', businessId)
      .maybeSingle();

    if (readError || !invRow?.track_stock) continue;

    const currentQty = Number(invRow.stock_quantity ?? 0);
    const nextQty = Math.max(0, currentQty + quantityDelta);
    const { error: updateError } = await supabase
      .from('pos_inventory')
      .update({ stock_quantity: nextQty, updated_at: new Date().toISOString() })
      .eq('id', inventoryId)
      .eq('business_id', businessId)
      .eq('track_stock', true);

    if (!updateError) applied += 1;
  }
  return applied;
};

export const applyStockAdjustmentMap = async (supabase, businessId, adjustmentMap) => {
  const payload = adjustmentMapToPayload(adjustmentMap);
  if (!businessId || payload.length === 0) {
    return { ok: true, applied: 0 };
  }

  let applied = 0;
  const { data, error } = await supabase.rpc('apply_pos_inventory_stock_adjustments', {
    p_business_id: businessId,
    p_adjustments: payload,
  });

  if (error) {
    console.warn('[posInventoryStock] RPC failed, using fallback updates:', error.message);
    applied = await applyStockAdjustmentMapFallback(supabase, businessId, adjustmentMap);
  } else {
    applied = Number(data) || 0;
  }

  if (applied > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('tavari:pos-inventory-updated', { detail: { businessId } })
    );
  }

  return { ok: true, applied };
};

export const computeSaleStockAdjustmentMap = async (supabase, businessId, saleLines) => {
  const { inventoryById, bundleItemsByBundleId } = await fetchInventoryContext(
    supabase,
    businessId,
    saleLines
  );
  return buildSaleStockAdjustmentMap(saleLines, inventoryById, bundleItemsByBundleId);
};

/** Deduct stock for a completed sale (bundle components + tracked items). */
export const applySaleStockAdjustments = async (supabase, businessId, saleLines) => {
  const adjustmentMap = await computeSaleStockAdjustmentMap(supabase, businessId, saleLines);
  return applyStockAdjustmentMap(supabase, businessId, adjustmentMap);
};

/** Restock inventory for refunded sale lines (mirrors bundle expansion). */
export const applyRestockAdjustments = async (supabase, businessId, restockLines) => {
  const saleAdjustmentMap = await computeSaleStockAdjustmentMap(supabase, businessId, restockLines);
  const restockMap = invertAdjustmentMap(saleAdjustmentMap);
  return applyStockAdjustmentMap(supabase, businessId, restockMap);
};
