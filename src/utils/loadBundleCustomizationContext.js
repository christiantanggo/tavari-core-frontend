import { loadModifierGroupsForInventoryItem } from './posModifierGroupsLoader';
import { expandBundleModifierSlots } from './posBundleModifiers';
import { fetchAllBundleItemRows, groupBundleItemsByBundleId } from './posInventoryBundles';

/** Load bundle slots + modifier groups for the all-in-one customization modal. */
export async function loadBundleCustomizationContext(supabase, businessId, bundleInventoryId) {
  const bundleRows = await fetchAllBundleItemRows(supabase, businessId, [bundleInventoryId]);
  const bundleItemsByBundleId = groupBundleItemsByBundleId(bundleRows || []);
  const bundleItems = bundleItemsByBundleId.get(bundleInventoryId) || [];

  const componentIds = [
    ...new Set(bundleItems.map((row) => row.component_inventory_id).filter(Boolean)),
  ];

  let inventoryById = new Map();
  if (componentIds.length > 0) {
    const { data: components, error: compError } = await supabase
      .from('pos_inventory')
      .select('id, name, modifier_group_ids')
      .eq('business_id', businessId)
      .in('id', componentIds);
    if (compError) throw compError;
    inventoryById = new Map((components || []).map((row) => [row.id, row]));
  }

  const slots = expandBundleModifierSlots(bundleInventoryId, bundleItems, inventoryById);
  const slotModifierGroups = {};

  await Promise.all(
    slots.map(async (slot) => {
      const component = inventoryById.get(slot.component_inventory_id);
      if (!component) return;
      slotModifierGroups[slot.slot_key] = await loadModifierGroupsForInventoryItem(
        supabase,
        businessId,
        component
      );
    })
  );

  return { slots, slotModifierGroups, inventoryById };
}
