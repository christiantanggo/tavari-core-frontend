/**
 * Server-side POS inventory stock adjustments (nested bundles).
 * Keep in sync with src/utils/posInventoryStock.js
 */

type SaleLine = { inventoryId: string; quantity: number };

type InventoryRow = {
  id: string;
  is_bundle?: boolean;
  track_stock?: boolean;
};

type BundleComponentRow = {
  bundle_inventory_id: string;
  component_inventory_id: string;
  quantity: number;
  sort_order?: number;
};

const normalizeSaleLines = (saleLines: unknown[]): SaleLine[] => {
  const normalized: SaleLine[] = [];
  for (const raw of saleLines || []) {
    const line = raw as Record<string, unknown>;
    const inventoryId = String(line?.inventoryId ?? line?.inventory_id ?? line?.id ?? "").trim();
    const quantity = Math.max(0, Number.parseInt(String(line?.quantity ?? 1), 10) || 0);
    if (!inventoryId || inventoryId.startsWith("custom_") || quantity <= 0) continue;
    normalized.push({ inventoryId, quantity });
  }
  return normalized;
};

const groupBundleItemsByBundleId = (bundleItemRows: BundleComponentRow[] = []) => {
  const map = new Map<string, BundleComponentRow[]>();
  for (const row of bundleItemRows || []) {
    const bundleId = String(row?.bundle_inventory_id || "").trim();
    if (!bundleId) continue;
    if (!map.has(bundleId)) map.set(bundleId, []);
    map.get(bundleId)!.push({
      bundle_inventory_id: bundleId,
      component_inventory_id: row.component_inventory_id,
      quantity: Math.max(1, Number.parseInt(String(row.quantity ?? 1), 10) || 1),
      sort_order: Number.parseInt(String(row.sort_order ?? 0), 10) || 0,
    });
  }
  map.forEach((rows, key) => {
    map.set(key, [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)));
  });
  return map;
};

const mergeBundleItemRows = (existingRows: BundleComponentRow[], newRows: BundleComponentRow[]) => {
  const byKey = new Map<string, BundleComponentRow>();
  for (const row of [...existingRows, ...newRows]) {
    const bundleId = String(row?.bundle_inventory_id || "").trim();
    const componentId = String(row?.component_inventory_id || "").trim();
    if (!bundleId || !componentId) continue;
    byKey.set(`${bundleId}:${componentId}`, row);
  }
  return [...byKey.values()];
};

const fetchAllBundleItemRows = async (
  supabase: { from: (table: string) => any },
  businessId: string,
  seedBundleIds: string[],
) => {
  const loaded = new Set<string>();
  let pending = [...new Set(seedBundleIds.filter(Boolean))];
  let allRows: BundleComponentRow[] = [];

  while (pending.length > 0) {
    const batch = pending.filter((id) => !loaded.has(id));
    if (batch.length === 0) break;
    batch.forEach((id) => loaded.add(id));

    const { data, error } = await supabase
      .from("pos_inventory_bundle_items")
      .select("bundle_inventory_id, component_inventory_id, quantity, sort_order")
      .eq("business_id", businessId)
      .in("bundle_inventory_id", batch);

    if (error) throw error;

    allRows = mergeBundleItemRows(allRows, (data || []) as BundleComponentRow[]);

    const componentIds = [
      ...new Set(
        ((data || []) as BundleComponentRow[])
          .map((row) => String(row.component_inventory_id || ""))
          .filter(Boolean),
      ),
    ];

    if (componentIds.length === 0) {
      pending = [];
      continue;
    }

    const { data: compMeta, error: compError } = await supabase
      .from("pos_inventory")
      .select("id, is_bundle")
      .eq("business_id", businessId)
      .in("id", componentIds);

    if (compError) throw compError;

    pending = ((compMeta || []) as InventoryRow[])
      .filter((row) => row.is_bundle)
      .map((row) => String(row.id || ""))
      .filter((id) => id && !loaded.has(id));
  }

  return allRows;
};

const expandBundleStockAdjustments = (
  bundleId: string,
  saleQuantity: number,
  inventoryById: Map<string, InventoryRow>,
  bundleItemsByBundleId: Map<string, BundleComponentRow[]>,
  addDelta: (inventoryId: string, delta: number) => void,
  visiting = new Set<string>(),
) => {
  const id = String(bundleId || "").trim();
  const qty = Math.max(0, Number.parseInt(String(saleQuantity ?? 0), 10) || 0);
  if (!id || qty <= 0 || visiting.has(id)) return;

  visiting.add(id);
  for (const comp of bundleItemsByBundleId.get(id) || []) {
    const compId = String(comp.component_inventory_id || "").trim();
    if (!compId) continue;
    const compQty = Math.max(1, Number.parseInt(String(comp.quantity ?? 1), 10) || 1) * qty;
    const compInv = inventoryById.get(compId);
    if (!compInv) continue;

    if (compInv.is_bundle) {
      expandBundleStockAdjustments(
        compId,
        compQty,
        inventoryById,
        bundleItemsByBundleId,
        addDelta,
        visiting,
      );
      continue;
    }

    if (compInv.track_stock) {
      addDelta(compId, -compQty);
    }
  }
  visiting.delete(id);

  const bundleInv = inventoryById.get(id);
  if (bundleInv?.track_stock) {
    addDelta(id, -qty);
  }
};

const buildSaleStockAdjustmentMap = (
  saleLines: SaleLine[],
  inventoryById: Map<string, InventoryRow>,
  bundleItemsByBundleId: Map<string, BundleComponentRow[]>,
) => {
  const adjustments = new Map<string, number>();
  const addDelta = (inventoryId: string, delta: number) => {
    if (!inventoryId || !delta) return;
    adjustments.set(inventoryId, (adjustments.get(inventoryId) || 0) + delta);
  };

  for (const { inventoryId, quantity } of saleLines) {
    const inv = inventoryById.get(inventoryId);
    if (!inv) continue;

    if (inv.is_bundle) {
      expandBundleStockAdjustments(
        inventoryId,
        quantity,
        inventoryById,
        bundleItemsByBundleId,
        addDelta,
      );
      continue;
    }

    if (inv.track_stock) addDelta(inventoryId, -quantity);
  }

  return adjustments;
};

const adjustmentMapToPayload = (adjustmentMap: Map<string, number>) =>
  [...adjustmentMap.entries()]
    .filter(([, quantityDelta]) => quantityDelta !== 0)
    .map(([inventory_id, quantity_delta]) => ({ inventory_id, quantity_delta }));

const loadNestedBundleContext = async (
  supabase: { from: (table: string) => any },
  businessId: string,
  seedInventoryIds: string[],
) => {
  const inventoryById = new Map<string, InventoryRow>();
  if (!businessId || seedInventoryIds.length === 0) {
    return { inventoryById, bundleItemsByBundleId: new Map<string, BundleComponentRow[]>() };
  }

  const pendingInventoryIds = [...new Set(seedInventoryIds.filter(Boolean))];
  const loadedInventoryIds = new Set<string>();

  while (pendingInventoryIds.length > 0) {
    const batch = pendingInventoryIds.filter((id) => !loadedInventoryIds.has(id));
    if (batch.length === 0) break;
    batch.forEach((id) => loadedInventoryIds.add(id));

    const { data: inventoryRows, error } = await supabase
      .from("pos_inventory")
      .select("id, is_bundle, track_stock")
      .eq("business_id", businessId)
      .in("id", batch);

    if (error) throw error;

    for (const row of (inventoryRows || []) as InventoryRow[]) {
      inventoryById.set(row.id, row);
    }
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
    ...new Set(bundleRows.map((row) => String(row.component_inventory_id || "")).filter(Boolean)),
  ].filter((id) => !inventoryById.has(id));

  if (nestedComponentIds.length > 0) {
    const { data: componentRows, error: componentError } = await supabase
      .from("pos_inventory")
      .select("id, is_bundle, track_stock")
      .eq("business_id", businessId)
      .in("id", nestedComponentIds);

    if (componentError) throw componentError;
    for (const row of (componentRows || []) as InventoryRow[]) {
      inventoryById.set(row.id, row);
    }
  }

  return { inventoryById, bundleItemsByBundleId };
};

const applyStockAdjustmentMapFallback = async (
  supabase: { from: (table: string) => any },
  businessId: string,
  adjustmentMap: Map<string, number>,
) => {
  let applied = 0;
  for (const [inventoryId, quantityDelta] of adjustmentMap.entries()) {
    if (!quantityDelta) continue;

    const { data: invRow, error: readError } = await supabase
      .from("pos_inventory")
      .select("stock_quantity, track_stock")
      .eq("id", inventoryId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (readError || !invRow?.track_stock) continue;

    const currentQty = Number(invRow.stock_quantity ?? 0);
    const nextQty = Math.max(0, currentQty + quantityDelta);
    const { error: updateError } = await supabase
      .from("pos_inventory")
      .update({ stock_quantity: nextQty, updated_at: new Date().toISOString() })
      .eq("id", inventoryId)
      .eq("business_id", businessId)
      .eq("track_stock", true);

    if (!updateError) applied += 1;
  }
  return applied;
};

export const applySaleStockAdjustments = async (
  supabase: { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }> },
  businessId: string,
  saleLines: unknown[],
) => {
  const normalizedLines = normalizeSaleLines(saleLines);
  if (!businessId || normalizedLines.length === 0) {
    return { ok: true, applied: 0 };
  }

  const { inventoryById, bundleItemsByBundleId } = await loadNestedBundleContext(
    supabase,
    businessId,
    normalizedLines.map((line) => line.inventoryId),
  );
  const adjustmentMap = buildSaleStockAdjustmentMap(
    normalizedLines,
    inventoryById,
    bundleItemsByBundleId,
  );
  const payload = adjustmentMapToPayload(adjustmentMap);
  if (payload.length === 0) return { ok: true, applied: 0 };

  const { data, error } = await supabase.rpc("apply_pos_inventory_stock_adjustments", {
    p_business_id: businessId,
    p_adjustments: payload,
  });

  if (error) {
    console.warn("[posInventoryStock] RPC failed, using fallback updates:", error.message);
    const applied = await applyStockAdjustmentMapFallback(supabase, businessId, adjustmentMap);
    return { ok: true, applied };
  }

  return { ok: true, applied: Number(data) || 0 };
};
