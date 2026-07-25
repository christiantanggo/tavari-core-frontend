/**
 * Bundle component modifier slots — expand bundle lines, validate selections,
 * flatten for POS cart / receipts, and build booking portal option groups.
 */
import {
  defaultPortalOptionGroup,
  defaultPortalOptionItem,
} from './bookingActivityOptions';
import { inventoryItemHasModifiers, normalizeModifierGroupIds } from './posModifierGroupsLoader';
import { buildPortalInventoryById } from './posInventoryBundles';

export const buildBundleSlotKey = (bundleId, componentId, slotIndex) =>
  `${bundleId}:${componentId}:${slotIndex}`;

/** Expand bundle component rows into per-unit slots (only components with modifiers). */
export const expandBundleModifierSlots = (
  bundleId,
  bundleItems = [],
  inventoryById = new Map()
) => {
  const slots = [];
  (bundleItems || []).forEach((row) => {
    const componentId = String(row?.component_inventory_id || '').trim();
    const component = inventoryById.get(componentId) || row?.component || null;
    if (!componentId || !component || !inventoryItemHasModifiers(component)) return;

    const quantity = Math.max(1, Number.parseInt(row?.quantity, 10) || 1);
    const sameComponentCount = (bundleItems || []).filter(
      (other) => String(other?.component_inventory_id || '') === componentId
    ).reduce((sum, other) => sum + Math.max(1, Number.parseInt(other?.quantity, 10) || 1), 0);

    for (let unit = 1; unit <= quantity; unit += 1) {
      const slotIndex = slots.filter((slot) => slot.component_inventory_id === componentId).length + 1;
      slots.push({
        slot_key: buildBundleSlotKey(bundleId, componentId, unit),
        bundle_inventory_id: bundleId,
        component_inventory_id: componentId,
        component_name: component.name || 'Item',
        slot_index: slotIndex,
        slot_total: sameComponentCount,
        slot_label:
          sameComponentCount > 1
            ? `${component.name || 'Item'} ${slotIndex} of ${sameComponentCount}`
            : component.name || 'Item',
        modifier_group_ids: normalizeModifierGroupIds(component.modifier_group_ids),
      });
    }
  });
  return slots;
};

export const bundleNeedsComponentModifiers = (bundleId, bundleItems = [], inventoryById = new Map()) =>
  expandBundleModifierSlots(bundleId, bundleItems, inventoryById).length > 0;

/** Per-slot style picking applies to modifier bundles, but never mascot lines. */
export const portalOptionSupportsBalloonSlotCustomization = (option, group = null, inv = null) => {
  const optionLabel = `${option?.name || ''} ${inv?.name || ''}`.toLowerCase();
  const groupName = String(group?.name || '').toLowerCase();

  if (/mascot/.test(optionLabel)) return false;
  if (/mascot/.test(groupName) && !/balloon/.test(optionLabel)) return false;

  return true;
};

/** @deprecated use portalOptionSupportsBalloonSlotCustomization */
export const portalOptionGroupSupportsBalloonSlotCustomization = (group) =>
  !/mascot/i.test(String(group?.name || ''));

export const validateBundleSlotSelections = (slots = [], slotSelections = {}) => {
  const missing = [];
  (slots || []).forEach((slot) => {
    const selected = slotSelections[slot.slot_key] || [];
    if (!Array.isArray(selected) || selected.length === 0) {
      missing.push(slot.slot_label);
    }
  });
  if (missing.length > 0) {
    return { ok: false, message: `Please choose options for: ${missing.join(', ')}.` };
  }
  return { ok: true };
};

export const buildBundleComponentModifiersPayload = (slots = [], slotSelections = {}) =>
  (slots || []).map((slot) => ({
    slot_key: slot.slot_key,
    component_inventory_id: slot.component_inventory_id,
    component_name: slot.component_name,
    slot_label: slot.slot_label,
    slot_index: slot.slot_index,
    slot_total: slot.slot_total,
    modifiers: (slotSelections[slot.slot_key] || []).map((modifier) => ({
      id: modifier.id,
      name: modifier.name,
      price: modifier.is_free ? 0 : Number(modifier.price) || 0,
      cost: Number(modifier.cost) || 0,
      cost_multiplier: Number(modifier.cost_multiplier) || 1,
      group_id: modifier.group_id,
      group_name: modifier.group_name,
      modifier_group_item_id: modifier.modifier_group_item_id,
    })),
  }));

/** Flatten bundle component choices for cart line display and sale item JSON. */
export const flattenBundleComponentModifiersForDisplay = (bundleComponentModifiers = []) => {
  const flat = [];
  (bundleComponentModifiers || []).forEach((slot) => {
    (slot.modifiers || []).forEach((modifier) => {
      flat.push({
        id: modifier.id,
        name: `${slot.slot_label}: ${modifier.name}`,
        price: modifier.price || 0,
        cost: modifier.cost || 0,
        cost_multiplier: modifier.cost_multiplier || 1,
        group_id: modifier.group_id,
        group_name: modifier.group_name,
        modifier_group_item_id: modifier.modifier_group_item_id,
        bundle_component_slot_key: slot.slot_key,
        bundle_component_name: slot.component_name,
      });
    });
  });
  return flat;
};

export const buildPortalBundleComponentModifierGroups = ({
  parentOptionId,
  parentOptionName,
  bundleInventoryId,
  bundleItems = [],
  inventoryById = new Map(),
  componentModifierGroupsByInventoryId = new Map(),
  sortOrderStart = 0,
}) => {
  const groups = [];
  let sortOrder = sortOrderStart;

  const slots = expandBundleModifierSlots(
    bundleInventoryId,
    bundleItems,
    inventoryById
  );

  slots.forEach((slot) => {
    const modifierGroups = componentModifierGroupsByInventoryId.get(slot.component_inventory_id) || [];
    modifierGroups.forEach((modifierGroup) => {
      const groupId = `bundle_grp_${parentOptionId}_${slot.slot_key}_${modifierGroup.id}`;
      const options = (modifierGroup.modifiers || []).map((modifier, index) =>
        defaultPortalOptionItem({
          id: `bundle_mod_${parentOptionId}_${slot.slot_key}_${modifier.id}`,
          name: modifier.name,
          inventory_item_id: modifier.id,
          price: 0,
          included: true,
          required: false,
          input_type: 'checkbox',
          max_quantity: 1,
          sort_order: index,
          is_bundle_component_modifier: true,
          bundle_component_slot_key: slot.slot_key,
          bundle_component_inventory_id: slot.component_inventory_id,
          bundle_parent_option_id: parentOptionId,
        })
      );

      if (!options.length) return;

      groups.push(
        defaultPortalOptionGroup({
          id: groupId,
          name: `${parentOptionName || 'Bundle'} — ${slot.slot_label}${modifierGroups.length > 1 ? ` (${modifierGroup.name})` : ''}`,
          description: `Choose ${modifierGroup.name || 'style'} for this item.`,
          show_when_option_id: parentOptionId,
          max_selections: 1,
          sort_order: sortOrder,
          is_bundle_component_group: true,
          bundle_component_slot_key: slot.slot_key,
          bundle_parent_option_id: parentOptionId,
          options,
        })
      );
      sortOrder += 1;
    });
  });

  return groups;
};

export const injectBundleComponentModifierGroups = (
  config,
  inventoryById = new Map(),
  bundleItemsByBundleId = new Map(),
  componentModifierGroupsByInventoryId = new Map()
) => {
  const baseGroups = [...(config?.groups || [])];
  const injected = [];
  let sortOrder = baseGroups.length;

  baseGroups.forEach((group) => {
    (group.options || []).forEach((option) => {
      const invId = String(option?.inventory_item_id || '').trim();
      const inv = invId ? inventoryById.get(invId) : null;
      if (!inv?.is_bundle) return;

      const bundleItems = bundleItemsByBundleId.get(inv.id) || [];
      if (!bundleNeedsComponentModifiers(inv.id, bundleItems, inventoryById)) return;
      if (!portalOptionSupportsBalloonSlotCustomization(option, group, inv)) return;

      const newGroups = buildPortalBundleComponentModifierGroups({
        parentOptionId: option.id,
        parentOptionName: option.name || inv.name,
        bundleInventoryId: inv.id,
        bundleItems,
        inventoryById,
        componentModifierGroupsByInventoryId,
        sortOrderStart: sortOrder,
      });
      injected.push(...newGroups);
      sortOrder += newGroups.length;
    });
  });

  return {
    ...config,
    groups: [...baseGroups, ...injected].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
    ),
  };
};

/** Human-readable lines from saved bundle customization payload. */
export const formatBundleCustomizationDetailLines = (bundleComponentModifiers = []) =>
  (bundleComponentModifiers || []).flatMap((slot) =>
    (slot.modifiers || []).map(
      (modifier) => `${slot.slot_label}: ${modifier.name}`
    )
  );

export const optionNeedsBundleCustomization = (
  option,
  inventoryById = new Map(),
  bundleItemsByBundleId = new Map(),
  group = null,
) => {
  const invId = String(option?.inventory_item_id || '').trim();
  const inv = invId ? inventoryById.get(invId) : null;
  if (!inv?.is_bundle) return false;
  const bundleItems = bundleItemsByBundleId.get(inv.id) || [];
  if (!bundleNeedsComponentModifiers(inv.id, bundleItems, inventoryById)) return false;
  return portalOptionSupportsBalloonSlotCustomization(option, group, inv);
};

/** Validate portal bundle customizations stored outside option selections. */
export const validatePortalBundleCustomizations = (
  config,
  selections = {},
  bundleCustomizations = {},
  inventoryItems = [],
  bundleContext = {}
) => {
  const inventoryById = buildPortalInventoryById(inventoryItems, bundleContext);
  const bundleItemsByBundleId =
    bundleContext.bundleItemsByBundleId instanceof Map
      ? bundleContext.bundleItemsByBundleId
      : new Map();

  const missing = [];
  (config?.groups || []).forEach((group) => {
    (group.options || []).forEach((option) => {
      const qty = Number.parseInt(selections?.[option.id], 10) || 0;
      if (qty <= 0) return;
      if (!optionNeedsBundleCustomization(option, inventoryById, bundleItemsByBundleId, group)) return;

      const saved = bundleCustomizations?.[option.id];
      const payload = saved?.bundleComponentModifiers || [];
      const lines = formatBundleCustomizationDetailLines(payload);
      const slotsNeeded = payload.length;
      if (slotsNeeded === 0 || lines.length < slotsNeeded) {
        missing.push(option.name || 'Balloon bouquet');
      }
    });
  });

  if (missing.length > 0) {
    return {
      ok: false,
      message: `Please customize: ${missing.join(', ')}.`,
    };
  }
  return { ok: true };
};

export const collectBundleComponentModifierSelections = (config, selections = {}) => {
  const byParentOption = new Map();
  (config?.groups || []).forEach((group) => {
    if (!group?.is_bundle_component_group) return;
    (group.options || []).forEach((option) => {
      const qty = Number.parseInt(selections?.[option.id], 10) || 0;
      if (qty <= 0) return;
      const parentId = option.bundle_parent_option_id || group.bundle_parent_option_id;
      if (!parentId) return;
      if (!byParentOption.has(parentId)) byParentOption.set(parentId, []);
      byParentOption.get(parentId).push({
        slot_key: option.bundle_component_slot_key || group.bundle_component_slot_key,
        component_inventory_id: option.bundle_component_inventory_id,
        modifier_inventory_id: option.inventory_item_id,
        modifier_name: option.name,
        option_id: option.id,
      });
    });
  });
  return byParentOption;
};

export const formatPortalBundleComponentDetailLines = (config, selections = {}) => {
  const byParent = collectBundleComponentModifierSelections(config, selections);
  const linesByParent = new Map();

  byParent.forEach((rows, parentOptionId) => {
    const grouped = new Map();
    rows.forEach((row) => {
      const key = row.slot_key || row.component_inventory_id;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row.modifier_name);
    });
    linesByParent.set(
      parentOptionId,
      [...grouped.entries()].map(([slotKey, names], index) => {
        const group = (config?.groups || []).find(
          (g) => g.bundle_component_slot_key === slotKey
        );
        const label = group?.name?.split(' — ').slice(1).join(' — ') || `Item ${index + 1}`;
        return `${label}: ${names.join(', ')}`;
      })
    );
  });

  return linesByParent;
};
