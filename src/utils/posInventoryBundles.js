/** POS inventory bundles — component items combined into one sellable inventory row. */
import { loadModifierGroupsForInventoryIds } from './posModifierGroupsLoader.js';

export const parseOptionalPrice = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
};

export const groupBundleItemsByBundleId = (bundleItemRows = []) => {
  const map = new Map();
  (bundleItemRows || []).forEach((row) => {
    const bundleId = String(row?.bundle_inventory_id || '').trim();
    if (!bundleId) return;
    if (!map.has(bundleId)) map.set(bundleId, []);
    map.get(bundleId).push({
      id: row.id,
      bundle_inventory_id: bundleId,
      component_inventory_id: row.component_inventory_id,
      quantity: Math.max(1, Number.parseInt(row.quantity, 10) || 1),
      sort_order: Number.parseInt(row.sort_order, 10) || 0,
      component: row.component || row.pos_inventory || null,
    });
  });
  map.forEach((rows, key) => {
    map.set(
      key,
      [...rows].sort((a, b) => a.sort_order - b.sort_order)
    );
  });
  return map;
};

export const mergeBundleItemRows = (existingRows = [], newRows = []) => {
  const byKey = new Map();
  [...(existingRows || []), ...(newRows || [])].forEach((row) => {
    const bundleId = String(row?.bundle_inventory_id || '').trim();
    const componentId = String(row?.component_inventory_id || '').trim();
    if (!bundleId || !componentId) return;
    byKey.set(`${bundleId}:${componentId}`, row);
  });
  return [...byKey.values()];
};

/** True if startBundleId transitively contains targetBundleId through nested bundle components. */
export const bundleContainsBundleId = (
  startBundleId,
  targetBundleId,
  bundleItemsByBundleId = new Map(),
  visited = new Set()
) => {
  const startId = String(startBundleId || '').trim();
  const targetId = String(targetBundleId || '').trim();
  if (!startId || !targetId) return false;
  if (startId === targetId) return true;
  if (visited.has(startId)) return false;
  visited.add(startId);

  for (const row of bundleItemsByBundleId.get(startId) || []) {
    const compId = String(row?.component_inventory_id || '').trim();
    if (!compId || !bundleItemsByBundleId.has(compId)) continue;
    if (bundleContainsBundleId(compId, targetId, bundleItemsByBundleId, visited)) {
      return true;
    }
  }
  return false;
};

/** Adding componentId to bundleId would create a cycle (bundle inside itself). */
export const wouldAddingBundleComponentCreateCycle = (
  bundleId,
  componentId,
  bundleItemsByBundleId = new Map()
) => {
  const parentId = String(bundleId || '').trim();
  const component = String(componentId || '').trim();
  if (!parentId || !component) return false;
  if (parentId === component) return true;
  if (!bundleItemsByBundleId.has(component)) return false;
  return bundleContainsBundleId(component, parentId, bundleItemsByBundleId);
};

export const resolveComponentUnitPrice = (componentRow, inventoryPrices = {}) => {
  const comp = componentRow?.component || componentRow?.pos_inventory || componentRow;
  const id = String(componentRow?.component_inventory_id || comp?.id || '').trim();
  if (id && inventoryPrices[id] != null) {
    return Number.parseFloat(inventoryPrices[id]) || 0;
  }
  return parseOptionalPrice(comp?.price) ?? 0;
};

export const calculateBundleAutoPrice = (bundleItems = [], inventoryPrices = {}) => {
  const total = (bundleItems || []).reduce((sum, row) => {
    const qty = Math.max(1, Number.parseInt(row?.quantity, 10) || 1);
    return sum + resolveComponentUnitPrice(row, inventoryPrices) * qty;
  }, 0);
  return Math.round(total * 100) / 100;
};

export const resolveNestedBundlePrice = (
  bundleId,
  inventoryById = new Map(),
  bundleItemsByBundleId = new Map(),
  prices = {},
  visiting = new Set()
) => {
  const id = String(bundleId || '').trim();
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
  const rows = bundleItemsByBundleId.get(id) || [];
  let total = 0;

  rows.forEach((row) => {
    const compId = String(row?.component_inventory_id || '').trim();
    if (!compId) return;
    const qty = Math.max(1, Number.parseInt(row?.quantity, 10) || 1);
    const comp = inventoryById.get(compId);
    let unit = prices[compId];
    if (comp?.is_bundle) {
      unit = resolveNestedBundlePrice(compId, inventoryById, bundleItemsByBundleId, prices, visiting);
    } else if (unit == null) {
      unit = parseOptionalPrice(comp?.price) ?? 0;
      prices[compId] = unit;
    }
    total += unit * qty;
  });

  visiting.delete(id);
  const rounded = Math.round(total * 100) / 100;
  prices[id] = rounded;
  return rounded;
};

/** Effective sell price for an inventory row (bundle auto-sum or fixed override). */
export const resolveInventoryEffectivePrice = (
  item,
  bundleItems = [],
  inventoryPrices = {}
) => {
  if (!item?.is_bundle) {
    return parseOptionalPrice(item?.price) ?? inventoryPrices[item?.id] ?? 0;
  }
  if (item.bundle_use_auto_price !== false) {
    return calculateBundleAutoPrice(bundleItems, inventoryPrices);
  }
  return parseOptionalPrice(item?.price) ?? 0;
};

export const buildBundleIncludesLabel = (bundleItems = [], fallbackDescription = '') => {
  const lines = listBundleComponentDisplayLines(bundleItems, fallbackDescription);
  return lines.join(', ');
};

/** Human-readable component lines for bundle review UI (one line per component). */
export const listBundleComponentDisplayLines = (bundleItems = [], fallbackDescription = '') => {
  const explicit = String(fallbackDescription || '').trim();
  if (explicit && (!bundleItems || bundleItems.length === 0)) {
    return [explicit];
  }
  return (bundleItems || []).map((row) => {
    const comp = row?.component || row?.pos_inventory;
    const name = comp?.name || 'Item';
    const qty = Math.max(1, Number.parseInt(row?.quantity, 10) || 1);
    const bundleTag = comp?.is_bundle ? ' (bundle)' : '';
    return qty > 1 ? `${name}${bundleTag} × ${qty}` : `${name}${bundleTag}`;
  });
};

export const buildInventoryPriceMapWithBundles = (
  inventoryItems = [],
  bundleItemsByBundleId = new Map(),
  componentPriceMap = {}
) => {
  const inventoryById = new Map(
    (inventoryItems || []).filter((item) => item?.id).map((item) => [item.id, item])
  );
  const prices = {
    ...Object.fromEntries(
      (inventoryItems || [])
        .filter((item) => item?.id && !item?.is_bundle)
        .map((item) => [item.id, parseOptionalPrice(item.price) ?? 0])
    ),
    ...componentPriceMap,
  };

  (inventoryItems || [])
    .filter((item) => item?.is_bundle && item?.id)
    .forEach((item) => {
      resolveNestedBundlePrice(item.id, inventoryById, bundleItemsByBundleId, prices);
    });

  return prices;
};

/** Fetch bundle component rows, including nested bundle children. */
export const fetchAllBundleItemRows = async (supabase, businessId, seedBundleIds = []) => {
  const loaded = new Set();
  let pending = [...new Set((seedBundleIds || []).filter(Boolean))];
  let allRows = [];

  while (pending.length > 0) {
    const batch = pending.filter((id) => !loaded.has(id));
    if (batch.length === 0) break;
    batch.forEach((id) => loaded.add(id));

    const { data, error } = await supabase
      .from('pos_inventory_bundle_items')
      .select(`
        id,
        business_id,
        bundle_inventory_id,
        component_inventory_id,
        quantity,
        sort_order,
        component:pos_inventory!pos_inventory_bundle_items_component_inventory_id_fkey (
          id,
          name,
          price,
          category_id,
          item_tax_overrides,
          is_bundle,
          bundle_use_auto_price,
          bundle_description
        )
      `)
      .eq('business_id', businessId)
      .in('bundle_inventory_id', batch)
      .order('sort_order', { ascending: true });

    if (error) throw error;

    allRows = mergeBundleItemRows(allRows, data || []);

    const componentIds = [
      ...new Set((data || []).map((row) => row.component_inventory_id).filter(Boolean)),
    ];
    if (componentIds.length === 0) {
      pending = [];
      continue;
    }

    const { data: compMeta, error: compError } = await supabase
      .from('pos_inventory')
      .select('id, is_bundle')
      .eq('business_id', businessId)
      .in('id', componentIds);

    if (compError) throw compError;

    pending = (compMeta || [])
      .filter((row) => row.is_bundle)
      .map((row) => row.id)
      .filter((id) => !loaded.has(id));
  }

  return allRows;
};

/** Merge top-level portal inventory with bundle component rows (modifier_group_ids live on components). */
export const buildPortalInventoryById = (inventoryItems = [], bundleContext = {}) => {
  const map = new Map((inventoryItems || []).map((item) => [item.id, item]));
  for (const item of bundleContext?.componentItems || []) {
    if (item?.id) map.set(item.id, item);
  }
  return map;
};

/** Fetch bundle component rows and component inventory for pricing. */
export const fetchBundleDataForInventoryIds = async (supabase, businessId, inventoryItems = []) => {
  const bundleIds = (inventoryItems || [])
    .filter((item) => item?.is_bundle && item?.id)
    .map((item) => item.id);
  if (!businessId || bundleIds.length === 0) {
    return { bundleItemsByBundleId: new Map(), componentItems: [], componentModifierGroupsByInventoryId: new Map() };
  }

  const bundleRows = await fetchAllBundleItemRows(supabase, businessId, bundleIds);
  const bundleItemsByBundleId = groupBundleItemsByBundleId(bundleRows || []);
  const componentIds = [
    ...new Set((bundleRows || []).map((row) => row.component_inventory_id).filter(Boolean)),
  ];

  let componentItems = [];
  if (componentIds.length > 0) {
    const { data: compData, error: compError } = await supabase
      .from('pos_inventory')
      .select('id, name, price, category_id, item_tax_overrides, is_bundle, bundle_use_auto_price, bundle_description, modifier_group_ids')
      .eq('business_id', businessId)
      .in('id', componentIds);
    if (compError) throw compError;
    componentItems = compData || [];
  }

  let componentModifierGroupsByInventoryId = new Map();
  try {
    componentModifierGroupsByInventoryId = await loadModifierGroupsForInventoryIds(
      supabase,
      businessId,
      componentItems
    );
  } catch (err) {
    console.warn('[fetchBundleDataForInventoryIds] modifier group preload failed:', err);
  }

  return { bundleItemsByBundleId, componentItems, bundleRows: bundleRows || [], componentModifierGroupsByInventoryId };
};

export const collectAllInventoryIdsForBundlePricing = (
  inventoryItems = [],
  bundleItemsByBundleId = new Map()
) => {
  const ids = new Set((inventoryItems || []).map((item) => item.id).filter(Boolean));
  const visitBundle = (bundleId, visited = new Set()) => {
    if (!bundleId || visited.has(bundleId)) return;
    visited.add(bundleId);
    (bundleItemsByBundleId.get(bundleId) || []).forEach((row) => {
      if (row.component_inventory_id) {
        ids.add(row.component_inventory_id);
        if (bundleItemsByBundleId.has(row.component_inventory_id)) {
          visitBundle(row.component_inventory_id, visited);
        }
      }
    });
  };

  (inventoryItems || [])
    .filter((item) => item?.is_bundle && item?.id)
    .forEach((item) => visitBundle(item.id));

  return [...ids];
};

/** Expand bundle sale/restock into leaf inventory stock deltas. */
export const expandBundleStockAdjustments = (
  bundleId,
  saleQuantity,
  inventoryById = new Map(),
  bundleItemsByBundleId = new Map(),
  addDelta,
  visiting = new Set()
) => {
  const id = String(bundleId || '').trim();
  const qty = Math.max(0, Number.parseInt(String(saleQuantity ?? 0), 10) || 0);
  if (!id || qty <= 0 || visiting.has(id)) return;

  visiting.add(id);
  (bundleItemsByBundleId.get(id) || []).forEach((comp) => {
    const compId = String(comp?.component_inventory_id || '').trim();
    if (!compId) return;
    const compQty = Math.max(1, Number.parseInt(comp?.quantity, 10) || 1) * qty;
    const compInv = inventoryById.get(compId);
    if (!compInv) return;

    if (compInv.is_bundle) {
      expandBundleStockAdjustments(
        compId,
        compQty,
        inventoryById,
        bundleItemsByBundleId,
        addDelta,
        visiting
      );
      return;
    }

    if (compInv.track_stock) {
      addDelta(compId, -compQty);
    }
  });
  visiting.delete(id);

  const bundleInv = inventoryById.get(id);
  if (bundleInv?.track_stock) {
    addDelta(id, -qty);
  }
};
