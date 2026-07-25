/**
 * Server-side portal option pricing (includes nested inventory bundles).
 * Keep in sync with src/utils/posInventoryBundles.js
 */

type BundleComponentRow = {
  bundle_inventory_id: string;
  component_inventory_id: string;
  quantity: number;
  sort_order: number;
};

type InventoryRow = {
  id: string;
  price: unknown;
  is_bundle?: boolean;
  bundle_use_auto_price?: boolean;
};

const parseOptionalPrice = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
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
    map.set(key, [...rows].sort((a, b) => a.sort_order - b.sort_order));
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
      .filter((row) => row.is_bundle === true)
      .map((row) => String(row.id || ""))
      .filter((id) => id && !loaded.has(id));
  }

  return allRows;
};

const resolveNestedBundlePrice = (
  bundleId: string,
  inventoryById: Map<string, InventoryRow>,
  bundleItemsByBundleId: Map<string, BundleComponentRow[]>,
  prices: Record<string, number>,
  visiting = new Set<string>(),
): number => {
  const id = String(bundleId || "").trim();
  if (!id) return 0;
  if (visiting.has(id)) return prices[id] ?? 0;

  const item = inventoryById.get(id);
  if (!item?.is_bundle) {
    const resolved = prices[id] ?? parseOptionalPrice(item?.price) ?? 0;
    prices[id] = resolved;
    return resolved;
  }

  if (item.bundle_use_auto_price === false) {
    const fixed = parseOptionalPrice(item.price) ?? prices[id] ?? 0;
    prices[id] = fixed;
    return fixed;
  }

  visiting.add(id);
  let total = 0;
  for (const row of bundleItemsByBundleId.get(id) || []) {
    const compId = String(row.component_inventory_id || "").trim();
    if (!compId) continue;
    const qty = Math.max(1, Number.parseInt(String(row.quantity ?? 1), 10) || 1);
    const comp = inventoryById.get(compId);
    let unit = prices[compId];
    if (comp?.is_bundle) {
      unit = resolveNestedBundlePrice(compId, inventoryById, bundleItemsByBundleId, prices, visiting);
    } else if (unit == null) {
      unit = parseOptionalPrice(comp?.price) ?? 0;
      prices[compId] = unit;
    }
    total += unit * qty;
  }
  visiting.delete(id);

  const rounded = Math.round(total * 100) / 100;
  prices[id] = rounded;
  return rounded;
};

export const buildPortalOptionInventoryPrices = async (
  supabase: {
    from: (table: string) => any;
  },
  businessId: string,
  inventoryIds: string[],
): Promise<Record<string, number>> => {
  const ids = [...new Set(inventoryIds.filter(Boolean))];
  if (ids.length === 0) return {};

  const { data: inventoryRows, error: inventoryError } = await supabase
    .from("pos_inventory")
    .select("id, price, is_bundle, bundle_use_auto_price")
    .eq("business_id", businessId)
    .in("id", ids);

  if (inventoryError) throw inventoryError;

  const inventoryById = new Map<string, InventoryRow>();
  const prices: Record<string, number> = {};
  for (const row of (inventoryRows || []) as InventoryRow[]) {
    const id = String(row.id || "").trim();
    if (!id) continue;
    inventoryById.set(id, row);
    if (!row.is_bundle) {
      prices[id] = parseOptionalPrice(row.price) ?? 0;
    }
  }

  const bundleIds = ((inventoryRows || []) as InventoryRow[])
    .filter((row) => row.is_bundle === true)
    .map((row) => String(row.id || ""))
    .filter(Boolean);

  if (bundleIds.length === 0) return prices;

  const bundleRows = await fetchAllBundleItemRows(supabase, businessId, bundleIds);
  const bundleItemsByBundleId = groupBundleItemsByBundleId(bundleRows);

  const componentIds = [
    ...new Set(bundleRows.map((row) => String(row.component_inventory_id || "")).filter(Boolean)),
  ].filter((id) => !inventoryById.has(id));

  if (componentIds.length > 0) {
    const { data: componentRows, error: componentError } = await supabase
      .from("pos_inventory")
      .select("id, price, is_bundle, bundle_use_auto_price")
      .eq("business_id", businessId)
      .in("id", componentIds);
    if (componentError) throw componentError;
    for (const row of (componentRows || []) as InventoryRow[]) {
      const id = String(row.id || "").trim();
      if (!id) continue;
      inventoryById.set(id, row);
      if (!row.is_bundle) {
        prices[id] = parseOptionalPrice(row.price) ?? 0;
      }
    }
  }

  for (const bundleId of bundleIds) {
    resolveNestedBundlePrice(bundleId, inventoryById, bundleItemsByBundleId, prices);
  }

  return prices;
};
