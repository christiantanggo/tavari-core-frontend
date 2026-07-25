/**
 * Shared conditional modifier visibility for POS register and booking portal.
 * Groups/items with show_when_inventory_id only appear after that modifier is selected.
 */

export const getSelectedModifierInventoryIds = (selections = []) => {
  const ids = new Set();
  (selections || []).forEach((row) => {
    const id = String(row?.id || row?.inventory_item_id || row?.inventory_id || '').trim();
    if (id) ids.add(id);
  });
  return ids;
};

export const isPickOneModifierGroup = (group) =>
  Number.parseInt(group?.max_selections, 10) === 1;

export const getActivePickOneModifierId = (group, selections = []) => {
  const groupId = group?.id;
  const inGroup = (selections || []).filter((row) => row?.group_id === groupId);
  if (inGroup.length === 0) return null;
  if (inGroup.length === 1) return inGroup[0]?.id || null;
  return inGroup[inGroup.length - 1]?.id || null;
};

/** Group visible when show_when is unset, the product itself is the parent, or that modifier is selected. */
export const isPosModifierGroupVisible = (group, selections = [], allGroups = [], productId = null) => {
  const parentInvId = String(group?.show_when_inventory_id || '').trim();
  if (!parentInvId) return true;

  // When customizing the parent product itself (e.g. Slush Puppie → Flavour + Size)
  if (productId && String(productId) === parentInvId) return true;

  const parentGroup = (allGroups || []).find((g) =>
    (g?.modifiers || []).some((m) => String(m?.id || '') === parentInvId)
  );

  // show_when points at inventory that isn't an option on this product
  // (e.g. 7" pizza combo has 7" toppings gated on "7\" Personal Cheese",
  // which is only selectable on standalone Cheese Pizza). Fail open so those
  // attached groups still appear — do not hide toppings on fixed-size combos.
  if (!parentGroup) {
    return true;
  }

  if (isPickOneModifierGroup(parentGroup)) {
    const activeId = getActivePickOneModifierId(parentGroup, selections);
    return activeId === parentInvId;
  }

  return getSelectedModifierInventoryIds(selections).has(parentInvId);
};

export const filterVisiblePosModifierGroups = (groups = [], selections = [], productId = null) =>
  (groups || []).filter((group) => isPosModifierGroupVisible(group, selections, groups, productId));

export const isPosModifierItemVisible = (item, selections = [], allGroups = [], productId = null) => {
  const parentInvId = String(item?.show_when_inventory_id || '').trim();
  if (!parentInvId) return true;

  if (productId && String(productId) === parentInvId) return true;

  const parentGroup = (allGroups || []).find((g) =>
    (g?.modifiers || []).some((m) => String(m?.id || '') === parentInvId)
  );

  // Same orphan-gate rule as groups: if the parent isn't selectable here, show the item.
  if (!parentGroup) {
    return true;
  }

  if (isPickOneModifierGroup(parentGroup)) {
    const activeId = getActivePickOneModifierId(parentGroup, selections);
    return activeId === parentInvId;
  }

  return getSelectedModifierInventoryIds(selections).has(parentInvId);
};

export const filterVisiblePosModifierItems = (group, selections = [], allGroups = [], productId = null) =>
  (group?.modifiers || []).filter((item) =>
    isPosModifierItemVisible(
      { ...item, show_when_inventory_id: item.show_when_inventory_id || null },
      selections,
      allGroups,
      productId
    )
  );

export const prunePosModifierSelections = (groups = [], selections = [], productId = null) => {
  const next = [...(selections || [])];
  return next.filter((row) => {
    const group = (groups || []).find((g) => g.id === row?.group_id);
    if (!group) return false;
    if (!isPosModifierGroupVisible(group, next, groups, productId)) return false;
    const modifier = (group.modifiers || []).find((m) => m.id === row?.id);
    if (modifier && !isPosModifierItemVisible(modifier, next, groups, productId)) return false;
    return true;
  });
};

/** Enforce max_selections=1 within a group; returns updated selection array.
 * Selection identity is (group_id, modifier.id) so the same inventory SKU can be
 * chosen on Full and Left pizza topping groups (7" shared toppings).
 */
export const applyPosModifierToggle = (groups, selections, modifier, group, adding, productId = null) => {
  let next = [...(selections || [])];
  const sameSlot = (m) => m.id === modifier.id && m.group_id === group.id;
  const existingIndex = next.findIndex(sameSlot);

  if (!adding) {
    next = next.filter((m) => !sameSlot(m));
  } else if (isPickOneModifierGroup(group)) {
    next = next.filter((m) => m.group_id !== group.id);
    next.push({
      ...modifier,
      group_id: group.id,
      group_name: group.name,
    });
  } else if (existingIndex < 0) {
    next.push({
      ...modifier,
      group_id: group.id,
      group_name: group.name,
    });
  }

  return prunePosModifierSelections(groups, next, productId);
};

/** Groups that become visible only after this inventory option is selected. */
export const getGroupsUnlockedByModifier = (allGroups = [], modifierInventoryId) => {
  const parentId = String(modifierInventoryId || '').trim();
  if (!parentId) return [];
  return (allGroups || []).filter(
    (g) => String(g?.show_when_inventory_id || '').trim() === parentId
  );
};

export const modifierUnlocksFollowUpGroups = (allGroups = [], modifierInventoryId) =>
  getGroupsUnlockedByModifier(allGroups, modifierInventoryId).length > 0;

/**
 * Cheapest follow-up path after picking this option (e.g. Slush → Size Small).
 * Per unlocked group, uses the lowest priced option (> $0). Free flavour groups add 0.
 */
export const getNestedMinInventoryPrice = (allGroups = [], modifierInventoryId) => {
  const unlocked = getGroupsUnlockedByModifier(allGroups, modifierInventoryId);
  let total = 0;
  unlocked.forEach((group) => {
    const priced = (group.modifiers || [])
      .map((m) => Number(m.inventory_price) || 0)
      .filter((p) => p > 0);
    if (priced.length === 0) return;
    total += Math.min(...priced);
  });
  return Math.round(total * 100) / 100;
};

/**
 * After a selection change, pick which newly unlocked group to auto-advance to.
 * Prefers Size, then required, then first newly visible nested group.
 * Never prefer Flavour over Size when both unlock together.
 */
export const pickNewlyUnlockedGroupId = (prevVisibleGroups = [], nextVisibleGroups = []) => {
  const prevIds = new Set((prevVisibleGroups || []).map((g) => g.id));
  const newlyVisible = (nextVisibleGroups || []).filter((g) => !prevIds.has(g.id));
  if (newlyVisible.length === 0) return null;
  const rank = (g) => {
    const name = String(g?.name || '').toLowerCase();
    if (/\bsize\b/.test(name)) return 0;
    if (g?.is_required) return 1;
    if (/flavour|flavor/.test(name)) return 2;
    return 3;
  };
  const sorted = [...newlyVisible].sort((a, b) => rank(a) - rank(b));
  return sorted[0]?.id || null;
};

/**
 * Parent group + option that unlocked the active nested (show_when) group.
 * Returns null when the group is top-level or gated only to the product itself.
 */
export const getModifierDrilldownParent = (allGroups = [], selections = [], activeGroup, productId = null) => {
  if (!activeGroup) return null;
  const parentInvId = String(activeGroup?.show_when_inventory_id || '').trim();
  if (!parentInvId) return null;
  if (productId && String(productId) === parentInvId) return null;

  let parentGroup = null;
  let parentModifier = null;
  for (const g of allGroups || []) {
    const mod = (g?.modifiers || []).find((m) => String(m?.id || '') === parentInvId);
    if (mod) {
      parentGroup = g;
      parentModifier = mod;
      break;
    }
  }
  if (!parentModifier) {
    const selected = (selections || []).find((s) => String(s?.id || '') === parentInvId);
    if (selected) {
      parentModifier = selected;
      parentGroup =
        (allGroups || []).find((g) => g.id === selected.group_id) ||
        (allGroups || []).find((g) =>
          (g?.modifiers || []).some((m) => String(m?.id || '') === parentInvId)
        ) ||
        null;
    }
  }
  if (!parentModifier) return null;

  return {
    parentGroup,
    parentModifier,
    parentName: parentModifier.name || 'Selected option',
    parentGroupId: parentGroup?.id || null,
  };
};

/** Compact breadcrumb when viewing a nested (show_when) group, e.g. "Poutine → Cheese type". */
export const getModifierDrilldownStepHint = (allGroups = [], selections = [], activeGroup, productId = null) => {
  const parent = getModifierDrilldownParent(allGroups, selections, activeGroup, productId);
  if (!parent || !activeGroup) return null;
  return `${parent.parentName} → ${activeGroup.name}`;
};
