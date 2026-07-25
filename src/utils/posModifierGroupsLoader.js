/** Load POS modifier groups + items for an inventory row. */

import {
  getIncludedModifierAllowance,
  resolveModifierChargePrice,
} from './posIncludedModifierPricing';

const compareAlpha = (a, b) =>
  String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });

export const sortModifierGroupItemsAlpha = (items = []) =>
  [...items].sort((a, b) => {
    const nameA = a?.pos_inventory?.name ?? a?.name ?? '';
    const nameB = b?.pos_inventory?.name ?? b?.name ?? '';
    return compareAlpha(nameA, nameB);
  });

export const sortModifierGroupsAlpha = (groups = []) =>
  [...groups]
    .sort((a, b) => compareAlpha(a?.name, b?.name))
    .map((group) => ({
      ...group,
      pos_modifier_group_items: group.pos_modifier_group_items
        ? sortModifierGroupItemsAlpha(group.pos_modifier_group_items)
        : group.pos_modifier_group_items,
      modifiers: group.modifiers ? sortModifierGroupItemsAlpha(group.modifiers) : group.modifiers,
    }));

export const normalizeModifierGroupIds = (raw) => {
  if (typeof raw === 'string') {
    try {
      return normalizeModifierGroupIds(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (raw && typeof raw === 'object') return Object.values(raw).filter(Boolean);
  return [];
};

/** Keep groups in the order they are attached on the inventory item (no alpha). */
export const orderModifierGroupsByIds = (groups = [], groupIds = []) => {
  const ids = normalizeModifierGroupIds(groupIds);
  const byId = new Map((groups || []).map((g) => [String(g.id), g]));
  const ordered = [];
  ids.forEach((id) => {
    const group = byId.get(String(id));
    if (group) {
      ordered.push(group);
      byId.delete(String(id));
    }
  });
  // Unattached leftovers keep DB sort_order, then stable id — never alpha by name
  const rest = [...byId.values()].sort((a, b) => {
    const soA = Number.isFinite(Number(a?.sort_order)) ? Number(a.sort_order) : 999;
    const soB = Number.isFinite(Number(b?.sort_order)) ? Number(b.sort_order) : 999;
    if (soA !== soB) return soA - soB;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
  return [...ordered, ...rest];
};

/**
 * Display order: product attachment order first, then Size before Flavour for
 * nested follow-ups under the same parent, then group sort_order.
 * Attachment order lets each meal/combo define tab sequence without fighting
 * shared group sort_order (e.g. 7" pizza combo: Toppings → Side → Drink → Left → Right).
 */
export const sortModifierGroupsForDisplay = (groups = [], groupIds = []) => {
  const ids = normalizeModifierGroupIds(groupIds);
  const attachmentIndex = (id) => {
    const idx = ids.findIndex((x) => String(x) === String(id));
    return idx === -1 ? 999 : idx;
  };
  const sortOrderValue = (group) => {
    if (group?.sort_order === null || group?.sort_order === undefined || group?.sort_order === '') {
      return 999;
    }
    const n = Number(group.sort_order);
    return Number.isFinite(n) ? n : 999;
  };
  /** Nested drink steps: Size → other required → Flavour → rest */
  const followUpRank = (group) => {
    const name = String(group?.name || '').toLowerCase();
    if (/\bsize\b/.test(name)) return 0;
    if (group?.is_required) return 1;
    if (/flavour|flavor/.test(name)) return 2;
    return 3;
  };
  return [...(groups || [])].sort((a, b) => {
    const swA = String(a?.show_when_inventory_id || '');
    const swB = String(b?.show_when_inventory_id || '');
    // Same parent follow-ups: Size before Flavour (ignore attachment order)
    if (swA && swA === swB) {
      const rA = followUpRank(a);
      const rB = followUpRank(b);
      if (rA !== rB) return rA - rB;
    }

    const iA = attachmentIndex(a?.id);
    const iB = attachmentIndex(b?.id);
    if (ids.length > 0 && iA !== iB) return iA - iB;

    const soA = sortOrderValue(a);
    const soB = sortOrderValue(b);
    if (soA !== soB) return soA - soB;
    return followUpRank(a) - followUpRank(b);
  });
};

/** Admin list order: sort_order only (not alphabetical). */
export const sortModifierGroupsBySortOrder = (groups = []) =>
  [...(groups || [])].sort((a, b) => {
    const soA =
      a?.sort_order === null || a?.sort_order === undefined || a?.sort_order === ''
        ? 999
        : Number(a.sort_order);
    const soB =
      b?.sort_order === null || b?.sort_order === undefined || b?.sort_order === ''
        ? 999
        : Number(b.sort_order);
    const nA = Number.isFinite(soA) ? soA : 999;
    const nB = Number.isFinite(soB) ? soB : 999;
    if (nA !== nB) return nA - nB;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });

/** Items inside a group: respect saved sort_order (not alphabetical). */
export const sortModifierGroupItemsBySortOrder = (items = []) =>
  [...(items || [])].sort((a, b) => {
    const soA =
      a?.sort_order === null || a?.sort_order === undefined || a?.sort_order === ''
        ? 999
        : Number(a.sort_order);
    const soB =
      b?.sort_order === null || b?.sort_order === undefined || b?.sort_order === ''
        ? 999
        : Number(b.sort_order);
    const nA = Number.isFinite(soA) ? soA : 999;
    const nB = Number.isFinite(soB) ? soB : 999;
    if (nA !== nB) return nA - nB;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });

export const inventoryItemHasModifiers = (item) =>
  normalizeModifierGroupIds(item?.modifier_group_ids).length > 0;

export async function loadModifierGroupsForInventoryItem(supabase, businessId, inventoryItem) {
  const groupIds = normalizeModifierGroupIds(inventoryItem?.modifier_group_ids);
  if (!businessId || !groupIds.length) return [];

  const { data: groups, error: groupsError } = await supabase
    .from('pos_modifier_groups')
    .select('*')
    .in('id', groupIds)
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true, nullsFirst: false });

  if (groupsError) throw groupsError;
  if (!groups?.length) return [];

  const groupsWithModifiers = await Promise.all(
    groups.map(async (group) => {
      const { data: groupItems, error: groupItemsError } = await supabase
        .from('pos_modifier_group_items')
        .select('*')
        .eq('modifier_group_id', group.id)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (groupItemsError || !groupItems?.length) {
        return { ...group, modifiers: [] };
      }

      const inventoryIds = groupItems.map((item) => item.inventory_id);
      const { data: inventoryItems, error: inventoryError } = await supabase
        .from('pos_inventory')
        .select('id, name, price, cost, category_id, modifier_group_ids')
        .in('id', inventoryIds)
        .eq('business_id', businessId);

      if (inventoryError) {
        return { ...group, modifiers: [] };
      }

      const allowance = getIncludedModifierAllowance(inventoryItem);

      const modifiers = groupItems
        .map((groupItem) => {
          const inventoryRow = inventoryItems?.find((inv) => inv.id === groupItem.inventory_id);
          if (!inventoryRow) return null;
          const inventoryPrice = Number(inventoryRow.price) || 0;
          return {
            id: inventoryRow.id,
            name: inventoryRow.name,
            inventory_price: inventoryPrice,
            category_id: inventoryRow.category_id || null,
            modifier_group_ids: inventoryRow.modifier_group_ids || null,
            price: resolveModifierChargePrice({
              inventoryPrice,
              categoryId: inventoryRow.category_id,
              priceOverride: groupItem.price_override,
              isFree: groupItem.is_free || false,
              allowance,
            }),
            cost: inventoryRow.cost ?? 0,
            cost_multiplier: groupItem.cost_multiplier ?? 1,
            is_free: groupItem.is_free || false,
            is_default_selected: groupItem.is_default_selected || false,
            modifier_group_item_id: groupItem.id,
            show_when_inventory_id: groupItem.show_when_inventory_id || null,
          };
        })
        .filter(Boolean);

      return {
        ...group,
        show_when_inventory_id: group.show_when_inventory_id || null,
        modifiers,
      };
    })
  );

  return sortModifierGroupsForDisplay(
    groupsWithModifiers.filter((group) => (group.modifiers || []).length > 0),
    groupIds
  );
}

export async function loadModifierGroupsForInventoryIds(supabase, businessId, inventoryItems = []) {
  const map = new Map();
  const itemsWithModifiers = (inventoryItems || []).filter((item) =>
    inventoryItemHasModifiers(item)
  );

  await Promise.all(
    itemsWithModifiers.map(async (item) => {
      const groups = await loadModifierGroupsForInventoryItem(supabase, businessId, item);
      if (groups.length > 0) {
        map.set(item.id, groups);
      }
    })
  );

  return map;
}

/**
 * Combos/meals: reuse each option's own modifier_group_ids (Size → Flavour), same as
 * selling that inventory item alone. Gates those groups with show_when = the option id.
 */
export async function mergeNestedModifierGroupsFromOptions(
  supabase,
  businessId,
  groups = [],
  parentProduct = null
) {
  if (!supabase || !businessId || !groups?.length) return groups || [];

  const next = (groups || []).map((group) => ({
    ...group,
    modifiers: [...(group.modifiers || [])],
  }));
  const byId = new Map(next.map((group) => [String(group.id), group]));

  const optionsById = new Map();
  next.forEach((group) => {
    (group.modifiers || []).forEach((modifier) => {
      if (!modifier?.id) return;
      optionsById.set(String(modifier.id), { ...modifier });
    });
  });

  // Backfill modifier_group_ids from inventory when the option row omitted them.
  const needsLookup = [...optionsById.values()].filter(
    (opt) => normalizeModifierGroupIds(opt.modifier_group_ids).length === 0
  );
  if (needsLookup.length > 0) {
    const ids = needsLookup.map((opt) => opt.id);
    const { data: invRows } = await supabase
      .from('pos_inventory')
      .select('id, modifier_group_ids')
      .in('id', ids)
      .eq('business_id', businessId);
    (invRows || []).forEach((row) => {
      const existing = optionsById.get(String(row.id));
      if (!existing) return;
      existing.modifier_group_ids = row.modifier_group_ids;
      optionsById.set(String(row.id), existing);
    });
  }

  for (const opt of optionsById.values()) {
    const nestedIds = normalizeModifierGroupIds(opt.modifier_group_ids);
    if (nestedIds.length === 0) continue;
    const ownerId = String(opt.id);

    // Keep option objects in group modifiers in sync for later renders
    next.forEach((group) => {
      group.modifiers = (group.modifiers || []).map((modifier) =>
        String(modifier.id) === ownerId
          ? { ...modifier, modifier_group_ids: opt.modifier_group_ids }
          : modifier
      );
    });

    nestedIds.forEach((groupId) => {
      const existing = byId.get(String(groupId));
      if (existing) {
        existing.show_when_inventory_id = ownerId;
      }
    });

    const missingIds = nestedIds.filter((groupId) => !byId.has(String(groupId)));
    if (missingIds.length === 0) continue;

    const loaded = await loadModifierGroupsForInventoryItem(supabase, businessId, {
      id: ownerId,
      modifier_group_ids: missingIds,
      included_modifier_category_id: parentProduct?.included_modifier_category_id,
      included_modifier_max_price: parentProduct?.included_modifier_max_price,
    });

    (loaded || []).forEach((group) => {
      const key = String(group.id);
      if (byId.has(key)) return;
      const gated = {
        ...group,
        show_when_inventory_id: ownerId,
      };
      byId.set(key, gated);
      next.push(gated);
    });
  }

  return next;
}
