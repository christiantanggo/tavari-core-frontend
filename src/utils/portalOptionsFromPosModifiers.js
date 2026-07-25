import {
  defaultPortalOptionGroup,
  defaultPortalOptionItem,
  newPortalOptionItemId,
} from './bookingActivityOptions.js';

const normalizeGroupIds = (raw) => {
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (raw && typeof raw === 'object') return Object.values(raw).filter(Boolean);
  return [];
};

const inferSizeParentOptionId = (groupName, sizeOptionsByKey) => {
  const name = String(groupName || '').toLowerCase();
  if (name.includes('7"') || name.includes('7 inch') || name.includes('7\\"')) {
    return sizeOptionsByKey.personal7 || null;
  }
  if (name.includes('12"') || name.includes('12 inch') || name.includes('12\\"')) {
    return sizeOptionsByKey.medium12 || null;
  }
  return null;
};

const classifySizeInventory = (itemName) => {
  const name = String(itemName || '').toLowerCase();
  if (name.includes('7"') || name.includes('7 inch') || name.includes('personal')) return 'personal7';
  if (name.includes('12"') || name.includes('12 inch') || name.includes('medium')) return 'medium12';
  return null;
};

/**
 * Build portal option groups from a POS inventory item's modifier groups (e.g. Cheese Pizza).
 * Maps size pick-one groups and links topping groups/options to the correct size choice.
 */
export async function buildPortalOptionGroupsFromPosItem(supabase, businessId, inventoryItemId) {
  const { data: item, error: itemError } = await supabase
    .from('pos_inventory')
    .select('id, name, modifier_group_ids')
    .eq('business_id', businessId)
    .eq('id', inventoryItemId)
    .maybeSingle();

  if (itemError) throw itemError;
  if (!item) throw new Error('POS inventory item not found.');

  const groupIds = normalizeGroupIds(item.modifier_group_ids);
  if (groupIds.length === 0) {
    throw new Error(`"${item.name}" has no modifier groups. Assign them in POS → Modifiers, then link on the inventory item.`);
  }

  const { data: groups, error: groupsError } = await supabase
    .from('pos_modifier_groups')
    .select('id, name, min_selections, max_selections, sort_order, is_required, show_when_inventory_id')
    .eq('business_id', businessId)
    .in('id', groupIds)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (groupsError) throw groupsError;
  if (!groups?.length) throw new Error('Modifier groups could not be loaded.');

  const groupsWithItems = await Promise.all(
    groups.map(async (group) => {
      const { data: groupItems, error: groupItemsError } = await supabase
        .from('pos_modifier_group_items')
        .select('inventory_id, sort_order, price_override, is_default_selected')
        .eq('modifier_group_id', group.id)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (groupItemsError) throw groupItemsError;

      const inventoryIds = (groupItems || []).map((row) => row.inventory_id).filter(Boolean);
      let inventoryById = new Map();
      if (inventoryIds.length > 0) {
        const { data: inventoryRows, error: inventoryError } = await supabase
          .from('pos_inventory')
          .select('id, name, price')
          .eq('business_id', businessId)
          .in('id', inventoryIds);
        if (inventoryError) throw inventoryError;
        inventoryById = new Map((inventoryRows || []).map((row) => [row.id, row]));
      }

      const options = (groupItems || [])
        .map((row, index) => {
          const inv = inventoryById.get(row.inventory_id);
          if (!inv) return null;
          return defaultPortalOptionItem({
            id: newPortalOptionItemId(),
            name: inv.name,
            inventory_item_id: inv.id,
            price: row.price_override != null ? Number.parseFloat(row.price_override) : null,
            included: row.is_default_selected === true,
            input_type: 'checkbox',
            sort_order: index,
          });
        })
        .filter(Boolean);

      return { group, options };
    })
  );

  const portalGroups = [];
  const inventoryIdToOptionId = new Map();
  const sizeOptionsByKey = { personal7: null, medium12: null };
  let sizeGroupIndex = groupsWithItems.findIndex(
    ({ group, options }) =>
      Number.parseInt(String(group.max_selections ?? ''), 10) === 1 && options.length >= 2
  );
  if (sizeGroupIndex < 0) {
    sizeGroupIndex = groupsWithItems.findIndex(({ group }) =>
      /size/i.test(String(group.name || ''))
    );
  }

  const mergedToppingOptions = [];

  groupsWithItems.forEach(({ group, options }, index) => {
    if (!options.length) return;

    const isSizeGroup = index === sizeGroupIndex;
    if (isSizeGroup) {
      options.forEach((opt) => {
        if (opt.inventory_item_id) {
          inventoryIdToOptionId.set(opt.inventory_item_id, opt.id);
        }
        const key = classifySizeInventory(opt.name);
        if (key) sizeOptionsByKey[key] = opt.id;
      });
      portalGroups.push(
        defaultPortalOptionGroup({
          name: group.name || 'Size',
          max_selections: 1,
          sort_order: portalGroups.length,
          options,
        })
      );
      return;
    }

    options.forEach((opt) => {
      if (opt.inventory_item_id) {
        inventoryIdToOptionId.set(opt.inventory_item_id, opt.id);
      }
    });

    const parentFromDb = group.show_when_inventory_id
      ? inventoryIdToOptionId.get(group.show_when_inventory_id)
      : null;
    const parentOptionId = parentFromDb || inferSizeParentOptionId(group.name, sizeOptionsByKey);
    const isToppingGroup = /topping/i.test(String(group.name || ''));

    if (parentOptionId && isToppingGroup) {
      mergedToppingOptions.push(
        ...options.map((opt) => ({
          ...opt,
          show_when_option_id: parentOptionId,
        }))
      );
      return;
    }

    if (parentOptionId) {
      portalGroups.push(
        defaultPortalOptionGroup({
          name: group.name,
          show_when_option_id: parentOptionId,
          sort_order: portalGroups.length,
          options,
        })
      );
      return;
    }

    portalGroups.push(
      defaultPortalOptionGroup({
        name: group.name,
        sort_order: portalGroups.length,
        options,
      })
    );
  });

  if (mergedToppingOptions.length > 0) {
    portalGroups.push(
      defaultPortalOptionGroup({
        name: 'Toppings',
        description: `Toppings for ${item.name}`,
        sort_order: portalGroups.length,
        options: mergedToppingOptions,
      })
    );
  }

  if (portalGroups.length === 0) {
    throw new Error('No portal options could be built from this item’s modifier groups.');
  }

  return {
    sourceItemName: item.name,
    groups: portalGroups,
  };
}
