/** Portal checkout options configured per activity (stored in addon_settings.portal_options). */

import {
  buildBundleIncludesLabel,
  buildInventoryPriceMapWithBundles,
  buildPortalInventoryById,
  groupBundleItemsByBundleId,
  listBundleComponentDisplayLines,
} from './posInventoryBundles';
import { formatBundleCustomizationDetailLines, formatPortalBundleComponentDetailLines, validatePortalBundleCustomizations } from './posBundleModifiers';

export const PORTAL_OPTIONS_DISPLAY_MODES = {
  SINGLE_MODAL: 'single_modal',
  STEP_MODALS: 'step_modals',
};

export const newPortalOptionGroupId = () =>
  `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const newPortalOptionItemId = () =>
  `opt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const defaultPortalOptionGroup = (overrides = {}) => ({
  id: newPortalOptionGroupId(),
  name: '',
  description: '',
  /** Default unit price for options in this group when option.price is unset. */
  price: null,
  /** When set, this group only appears after the customer selects this option. */
  show_when_option_id: null,
  /** When 1, only one option in the group can be selected (e.g. pizza size). */
  max_selections: null,
  sort_order: 0,
  options: [],
  ...overrides,
});

export const PORTAL_OPTION_DEFAULT_MAX_QUANTITY = 100;

export const defaultPortalOptionItem = (overrides = {}) => ({
  id: newPortalOptionItemId(),
  name: '',
  description: '',
  /** null = use linked inventory (or bundle) price; number = override per option */
  price: null,
  /** Links to pos_inventory row (regular item or bundle from Inventory → Bundles). */
  inventory_item_id: null,
  max_quantity: PORTAL_OPTION_DEFAULT_MAX_QUANTITY,
  required: false,
  included: false,
  show_when_option_id: null,
  input_type: 'quantity',
  sort_order: 0,
  ...overrides,
});

export const portalOptionFromInventoryItem = (item) =>
  defaultPortalOptionItem({
    name: String(item?.name || '').trim(),
    inventory_item_id: item?.id || null,
    price: null,
  });

export const buildInventoryPriceMap = (inventoryItems = []) =>
  Object.fromEntries(
    (inventoryItems || [])
      .filter((item) => item?.id)
      .map((item) => [item.id, parseOptionalPrice(item.price) ?? 0])
  );

export const parseOptionalPrice = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
};

/** List/catalog price (ignores included package flag). */
export const resolvePortalOptionListPrice = (group, option, inventoryPrices = {}) => {
  const optionPrice = parseOptionalPrice(option?.price);
  if (optionPrice !== null) return optionPrice;
  const invId = String(option?.inventory_item_id || '').trim();
  if (invId && inventoryPrices[invId] != null) {
    return inventoryPrices[invId];
  }
  return parseOptionalPrice(group?.price) ?? 0;
};

/** Unit price shown at checkout: $0 when included in package (first unit only at line level). */
export const resolvePortalOptionUnitPrice = (group, option, inventoryPrices = {}) => {
  if (option?.included === true) return 0;
  return resolvePortalOptionListPrice(group, option, inventoryPrices);
};

/**
 * Free units for an included package group (up to max_selections total).
 * Allocates across selected options by sort_order — quantity counts
 * (e.g. Super with 2 free: A×2 is fully included, or A×1 + B×1).
 */
export const resolveIncludedFreeQuantityByOptionId = (group, selections = {}) => {
  if (!groupIsIncludedPackageChoice(group)) return {};
  let remaining = includedPackagePickCount(group);
  const freeById = {};
  const selected = (group?.options || [])
    .map((opt) => ({
      opt,
      qty: Math.max(0, Number.parseInt(selections?.[opt.id], 10) || 0),
    }))
    .filter((row) => row.qty > 0)
    .sort((a, b) => (a.opt.sort_order ?? 0) - (b.opt.sort_order ?? 0));

  selected.forEach((row) => {
    if (remaining <= 0) return;
    const freeQty = Math.min(row.qty, remaining);
    if (freeQty > 0) {
      freeById[row.opt.id] = freeQty;
      remaining -= freeQty;
    }
  });
  return freeById;
};

/** Option IDs that receive any free unit(s) in an included package group. */
export const resolveIncludedFreeOptionIdsForGroup = (group, selections = {}) =>
  Object.keys(resolveIncludedFreeQuantityByOptionId(group, selections));

/** Which option in an included pick-one group receives the single free first unit. */
export const resolveIncludedFreeOptionIdForGroup = (group, selections = {}) => {
  const ids = resolveIncludedFreeOptionIdsForGroup(group, selections);
  return ids[0] || null;
};

export const optionReceivesIncludedFreeSlot = (group, option, selections = {}) => {
  if (!option?.included) return false;
  if (group && groupIsIncludedPackageChoice(group)) {
    return (resolveIncludedFreeQuantityByOptionId(group, selections)[option.id] || 0) > 0;
  }
  return option?.included === true;
};

export const calculatePortalOptionLinePricing = (
  group,
  option,
  rawQuantity,
  inventoryPrices = {},
  selections = null,
) => {
  const maxQty = Math.max(1, Number.parseInt(option?.max_quantity, 10) || PORTAL_OPTION_DEFAULT_MAX_QUANTITY);
  const quantity = Math.min(Math.max(0, Number.parseInt(rawQuantity, 10) || 0), maxQty);
  const listUnitPrice = resolvePortalOptionListPrice(group, option, inventoryPrices);
  if (quantity <= 0) {
    return {
      quantity: 0,
      listUnitPrice,
      includedQuantity: 0,
      paidQuantity: 0,
      unitPrice: listUnitPrice,
      totalPrice: 0,
    };
  }
  const selectionMap = selections && typeof selections === 'object' ? selections : {};

  if (group && groupIsIncludedPackageChoice(group) && option?.included) {
    const freeById = resolveIncludedFreeQuantityByOptionId(group, selectionMap);
    const includedQuantity = Math.min(quantity, freeById[option.id] || 0);
    const paidQuantity = Math.max(0, quantity - includedQuantity);
    const totalPrice = Math.round(paidQuantity * listUnitPrice * 100) / 100;
    return {
      quantity,
      listUnitPrice,
      includedQuantity,
      paidQuantity,
      unitPrice: listUnitPrice,
      totalPrice,
    };
  }

  const receivesIncludedSlot = optionReceivesIncludedFreeSlot(group, option, selectionMap);
  if (receivesIncludedSlot) {
    const includedQuantity = Math.min(1, quantity);
    const paidQuantity = Math.max(0, quantity - includedQuantity);
    const totalPrice = Math.round(paidQuantity * listUnitPrice * 100) / 100;
    return {
      quantity,
      listUnitPrice,
      includedQuantity,
      paidQuantity,
      unitPrice: listUnitPrice,
      totalPrice,
    };
  }
  const totalPrice = Math.round(quantity * listUnitPrice * 100) / 100;
  return {
    quantity,
    listUnitPrice,
    includedQuantity: 0,
    paidQuantity: quantity,
    unitPrice: listUnitPrice,
    totalPrice,
  };
};

export const resolvePortalOptionDefaultPrice = (group, option, inventoryPrices = {}) =>
  resolvePortalOptionListPrice(group, { ...option, price: null }, inventoryPrices);

export const optionHasPriceOverride = (option) => parseOptionalPrice(option?.price) !== null;

export const optionUsesGroupDefaultPrice = (group, option) =>
  parseOptionalPrice(option?.price) === null;

export const groupHasIncludedOption = (group) =>
  (group?.options || []).some((opt) => opt.included === true);

const includedPackageChoiceOptions = (group) =>
  (group?.options || []).filter(
    (opt) => String(opt?.name || '').trim() || opt?.inventory_item_id,
  );

export const includedPackagePickCount = (group) =>
  Math.max(1, Number.parseInt(group?.max_selections, 10) || 1);

/** Every option included; max_selections = free units / minimum required units (not a hard max). */
export const groupIsIncludedPackageChoice = (group) => {
  const options = includedPackageChoiceOptions(group);
  if (options.length < 2) return false;
  return options.every((opt) => opt.included === true);
};

/** Included package with a single free slot (max_selections = 1). Extra options/qty are paid. */
export const groupIsIncludedPickOneChoice = (group) =>
  groupIsIncludedPackageChoice(group) && includedPackagePickCount(group) === 1;

export const groupIsIncludedMultiPickChoice = (group) =>
  groupIsIncludedPackageChoice(group) && includedPackagePickCount(group) > 1;

/** One default included option with paid upgrades (legacy pizza-size pattern). */
export const groupIsUpgradeFromIncluded = (group) =>
  groupHasIncludedOption(group) && !groupIsIncludedPackageChoice(group);

export const groupIsPickOne = (group) => {
  if (groupIsIncludedPackageChoice(group)) return false;
  return (
    groupHasIncludedOption(group) ||
    Number.parseInt(group?.max_selections, 10) === 1
  );
};

/**
 * Portal UI: checkbox selection for pick-one upgrade groups only.
 * Included package food choices use quantity steppers so customers can add extras
 * beyond the free included unit(s).
 */
export const groupUsesCheckboxPortalSelection = (group) =>
  groupIsPickOne(group) && !groupIsIncludedPackageChoice(group);

export const getIncludedOptionForGroup = (group) =>
  (group?.options || []).find((opt) => opt.included === true) || null;

export const findPortalOptionGroupForOption = (groups = [], optionId) => {
  const id = String(optionId || '').trim();
  if (!id) return null;
  return (
    (groups || []).find((group) => (group.options || []).some((opt) => opt.id === id)) || null
  );
};

/** Active choice in a pick-one group; resolves conflicts when multiple options are selected. */
export const getActivePickOneSelection = (group, selections = {}) => {
  const options = group?.options || [];
  const selected = options.filter(
    (opt) => (Number.parseInt(selections?.[opt.id], 10) || 0) > 0
  );
  if (selected.length === 0) return null;
  if (selected.length === 1) return selected[0];
  if (groupIsIncludedPackageChoice(group)) {
    return selected.reduce((best, opt) => ((opt.sort_order ?? 0) < (best.sort_order ?? 0) ? opt : best));
  }
  if (groupHasIncludedOption(group)) {
    return selected.find((opt) => !opt.included) || selected[0];
  }
  return selected.reduce((best, opt) => (opt.sort_order >= best.sort_order ? opt : best));
};

const isParentOptionActive = (parentOptionId, selections = {}, allGroups = []) => {
  const id = String(parentOptionId || '').trim();
  if (!id) return true;

  const parentGroup = findPortalOptionGroupForOption(allGroups, id);
  if (parentGroup && groupIsPickOne(parentGroup)) {
    const active = getActivePickOneSelection(parentGroup, selections);
    return !!active && active.id === id;
  }

  return (Number.parseInt(selections?.[id], 10) || 0) > 0;
};

/** Option is visible when it has no parent option, or the parent is the active pick-one choice. */
export const isPortalOptionVisible = (option, selections = {}, allGroups = []) =>
  isParentOptionActive(option?.show_when_option_id, selections, allGroups);

export const filterVisiblePortalOptionItems = (group, selections = {}, allGroups = []) =>
  (group?.options || []).filter((option) => isPortalOptionVisible(option, selections, allGroups));

/** True when a portal step/group has at least one visible required option. */
export const portalOptionStepRequiresSelection = (group, selections = {}, allGroups = []) => {
  if (groupIsIncludedPackageChoice(group)) {
    const visible = filterVisiblePortalOptionItems(group, selections, allGroups);
    const requiredUnits = includedPackagePickCount(group);
    const selectedUnits = visible.reduce(
      (sum, opt) => sum + (Number.parseInt(selections?.[opt.id], 10) || 0),
      0,
    );
    return selectedUnits < requiredUnits;
  }
  return filterVisiblePortalOptionItems(group, selections, allGroups).some((opt) => opt.required === true);
};

/** Group is visible when it has no parent option, or any of its options would be visible. */
export const isPortalOptionGroupVisible = (group, selections = {}, allGroups = []) => {
  const groupParentId = String(group?.show_when_option_id || '').trim();
  if (groupParentId) {
    return isParentOptionActive(groupParentId, selections, allGroups);
  }

  const hasConditionalOptions = (group?.options || []).some((opt) =>
    String(opt?.show_when_option_id || '').trim()
  );
  if (hasConditionalOptions) {
    return filterVisiblePortalOptionItems(group, selections, allGroups).length > 0;
  }

  return true;
};

export const filterVisiblePortalOptionGroups = (groups = [], selections = {}) =>
  (groups || []).filter((group) => isPortalOptionGroupVisible(group, selections, groups));

/** Reconstruct addon_settings shape from an enriched portal config. */
export const portalConfigToAddonSettingsRaw = (config) => ({
  portal_options: {
    groups: config?.groups || [],
    display_mode: config?.displayMode || PORTAL_OPTIONS_DISPLAY_MODES.SINGLE_MODAL,
  },
});

/** Step index in visible groups for reopening the options modal on a specific group. */
export const findPortalOptionsStepIndexForGroup = (config, selections = {}, groupId) => {
  const visible = filterVisiblePortalOptionGroups(config?.groups || [], selections);
  const idx = visible.findIndex((group) => group.id === groupId);
  return idx >= 0 ? idx : 0;
};

/** True when clearing this option to qty 0 is allowed (optional add-ons, paid upgrades, etc.). */
export const canRemovePortalOrderSelection = (
  addonSettingsRaw,
  config,
  selections = {},
  optionId
) => {
  const group = findPortalOptionGroupForOption(config?.groups || [], optionId);
  if (!group) return false;
  const opt = (group.options || []).find((o) => o.id === optionId);
  if (!opt) return false;
  const beforeQty = Number.parseInt(selections?.[optionId], 10) || 0;
  if (beforeQty <= 0) return false;
  if (opt.required) return false;
  if (groupIsIncludedPackageChoice(group)) {
    const requiredUnits = includedPackagePickCount(group);
    const remainingUnits = (group.options || []).reduce((sum, option) => {
      if (option.id === optionId) return sum;
      return sum + (Number.parseInt(selections?.[option.id], 10) || 0);
    }, 0);
    return remainingUnits >= requiredUnits;
  }
  const next = applyPortalOptionSelectionChange(
    addonSettingsRaw || portalConfigToAddonSettingsRaw(config),
    selections,
    group,
    optionId,
    0
  );
  const afterQty = Number.parseInt(next?.[optionId], 10) || 0;
  return afterQty === 0;
};

/** Clear an optional order line; reverts upgrade groups to the included default when applicable. */
export const removePortalOrderSelection = (
  addonSettingsRaw,
  config,
  selections = {},
  optionId
) => {
  const group = findPortalOptionGroupForOption(config?.groups || [], optionId);
  if (!group) return selections;
  return applyPortalOptionSelectionChange(
    addonSettingsRaw || portalConfigToAddonSettingsRaw(config),
    selections,
    group,
    optionId,
    0
  );
};

export const pruneSelectionsForHiddenPortalGroups = (groups = [], selections = {}) => {
  const next = { ...(selections || {}) };
  (groups || []).forEach((group) => {
    if (!isPortalOptionGroupVisible(group, next, groups)) {
      (group.options || []).forEach((opt) => {
        next[opt.id] = 0;
      });
      return;
    }
    (group.options || []).forEach((opt) => {
      if (!isPortalOptionVisible(opt, next, groups)) {
        next[opt.id] = 0;
      }
    });
  });
  return next;
};

/** Options from other groups that can unlock this group. */
export const listPortalOptionParentChoices = (groups = [], excludeGroupId = null) => {
  const choices = [];
  (groups || []).forEach((group) => {
    if (group.id === excludeGroupId) return;
    (group.options || []).forEach((opt) => {
      if (!String(opt?.name || '').trim() && !opt?.inventory_item_id) return;
      choices.push({
        optionId: opt.id,
        label: `${group.name || 'Group'}: ${opt.name || 'Option'}`,
      });
    });
  });
  return choices;
};

export const findPortalOptionLabel = (groups = [], optionId) => {
  for (const group of groups || []) {
    const opt = (group.options || []).find((o) => o.id === optionId);
    if (opt) return `${group.name || 'Group'}: ${opt.name || 'Option'}`;
  }
  return null;
};

/** Remove one option from a group and clear show_when references to it. */
export const removePortalOptionFromGroups = (groups = [], groupIndex, optionIndex) => {
  const group = groups[groupIndex];
  const optionId = group?.options?.[optionIndex]?.id;
  if (!optionId) return groups;

  return groups.map((g, gIdx) => {
    const clearedGroup =
      g.show_when_option_id === optionId ? { ...g, show_when_option_id: null } : g;

    if (gIdx !== groupIndex) {
      return {
        ...clearedGroup,
        options: (clearedGroup.options || []).map((opt) =>
          opt.show_when_option_id === optionId ? { ...opt, show_when_option_id: null } : opt
        ),
      };
    }

    return {
      ...clearedGroup,
      options: (clearedGroup.options || []).filter((_, oIdx) => oIdx !== optionIndex),
    };
  });
};

export const countPortalOptionDependents = (groups = [], optionId) => {
  if (!optionId) return 0;
  let count = 0;
  for (const group of groups || []) {
    if (group.show_when_option_id === optionId) count += 1;
    for (const opt of group.options || []) {
      if (opt.show_when_option_id === optionId) count += 1;
    }
  }
  return count;
};

export const finalizePortalOptionSelections = (addonSettingsRaw, selections = {}) => {
  const { groups } = parsePortalActivityOptions(addonSettingsRaw);
  const pruned = pruneSelectionsForHiddenPortalGroups(groups, selections);
  return normalizePortalOptionSelections(addonSettingsRaw, pruned);
};

/** Pre-select included options (qty 1) when the options modal opens. */
export const buildDefaultPortalOptionSelections = (addonSettingsRaw) => {
  const { groups } = parsePortalActivityOptions(addonSettingsRaw);
  const selections = {};
  groups.forEach((group) => {
    if (groupIsIncludedPackageChoice(group)) return;
    const included = getIncludedOptionForGroup(group);
    if (included) {
      selections[included.id] = 1;
    }
  });
  return selections;
};

/** Apply included defaults and enforce one choice per pick-one group. */
export const normalizePortalOptionSelections = (addonSettingsRaw, selections = {}) => {
  const { groups } = parsePortalActivityOptions(addonSettingsRaw);
  const normalized = { ...(selections || {}) };

  groups.forEach((group) => {
    if (!groupIsPickOne(group) || groupIsIncludedPackageChoice(group)) return;

    const options = group.options || [];
    const selected = options.filter(
      (opt) => (Number.parseInt(normalized[opt.id], 10) || 0) > 0
    );
    if (selected.length <= 1) return;

    const chosen = getActivePickOneSelection(group, normalized);
    if (!chosen) return;

    options.forEach((opt) => {
      normalized[opt.id] = 0;
    });
    normalized[chosen.id] = Math.min(
      Math.max(1, Number.parseInt(normalized[chosen.id], 10) || 1),
      chosen.max_quantity
    );
  });

  // Included package groups: max_selections controls free units / minimum required units,
  // not a hard cap on how many options or quantity the customer may select.

  groups.forEach((group) => {
    if (groupIsIncludedPackageChoice(group)) return;
    const included = getIncludedOptionForGroup(group);
    if (!included) return;

    const options = group.options || [];
    const hasSelection = options.some(
      (opt) => (Number.parseInt(normalized[opt.id], 10) || 0) > 0
    );
    if (hasSelection) return;

    options.forEach((opt) => {
      normalized[opt.id] = 0;
    });
    normalized[included.id] = 1;
  });

  return pruneSelectionsForHiddenPortalGroups(groups, normalized);
};

/** Update selections for one option; upgrade groups allow only one active choice. */
export const applyPortalOptionSelectionChange = (
  addonSettingsRaw,
  selections = {},
  group,
  optionId,
  quantity
) => {
  const { groups: allGroups } = parsePortalActivityOptions(addonSettingsRaw);
  const resolvedGroup = allGroups.find((g) => g.id === group?.id) || group;
  const qty = Math.max(0, Number.parseInt(quantity, 10) || 0);
  const next = { ...(selections || {}), [optionId]: qty };
  const included = getIncludedOptionForGroup(resolvedGroup);
  const options = resolvedGroup.options || [];

  if (groupIsIncludedPackageChoice(resolvedGroup)) {
    const cappedQty = Math.min(
      Math.max(0, qty),
      options.find((o) => o.id === optionId)?.max_quantity || PORTAL_OPTION_DEFAULT_MAX_QUANTITY,
    );
    next[optionId] = cappedQty;
    return finalizePortalOptionSelections(addonSettingsRaw, next);
  }

  if (!groupIsPickOne(resolvedGroup)) {
    if (qty >= 0) {
      next[optionId] = Math.min(
        qty,
        options.find((o) => o.id === optionId)?.max_quantity || PORTAL_OPTION_DEFAULT_MAX_QUANTITY,
      );
    }
    return finalizePortalOptionSelections(addonSettingsRaw, next);
  }

  if (qty > 0) {
    options.forEach((opt) => {
      if (opt.id !== optionId) next[opt.id] = 0;
    });
    next[optionId] = Math.min(
      qty,
      options.find((o) => o.id === optionId)?.max_quantity || PORTAL_OPTION_DEFAULT_MAX_QUANTITY,
    );
    return finalizePortalOptionSelections(addonSettingsRaw, next);
  }

  if (included && !groupIsIncludedPackageChoice(resolvedGroup)) {
    const otherSelected = options.some(
      (opt) => opt.id !== optionId && (Number.parseInt(next[opt.id], 10) || 0) > 0
    );
    if (!otherSelected) {
      next[included.id] = 1;
    }
  }
  return finalizePortalOptionSelections(addonSettingsRaw, next);
};

export const parsePortalActivityOptions = (addonSettingsRaw) => {
  const raw =
    addonSettingsRaw && typeof addonSettingsRaw === 'string'
      ? (() => {
          try {
            return JSON.parse(addonSettingsRaw);
          } catch {
            return {};
          }
        })()
      : addonSettingsRaw && typeof addonSettingsRaw === 'object'
        ? addonSettingsRaw
        : {};

  const portal = raw.portal_options && typeof raw.portal_options === 'object'
    ? raw.portal_options
    : {};

  const displayMode =
    portal.display_mode === PORTAL_OPTIONS_DISPLAY_MODES.STEP_MODALS
      ? PORTAL_OPTIONS_DISPLAY_MODES.STEP_MODALS
      : PORTAL_OPTIONS_DISPLAY_MODES.SINGLE_MODAL;

  const groups = (Array.isArray(portal.groups) ? portal.groups : [])
    .map((group, groupIndex) => ({
      id: group?.id || newPortalOptionGroupId(),
      name: String(group?.name || '').trim(),
      description: String(group?.description || '').trim(),
      price: parseOptionalPrice(group?.price),
      show_when_option_id: String(group?.show_when_option_id || '').trim() || null,
      max_selections:
        group?.max_selections === null || group?.max_selections === undefined || group?.max_selections === ''
          ? null
          : Math.max(1, Number.parseInt(group?.max_selections, 10) || 1),
      sort_order: Number.parseInt(group?.sort_order, 10) || groupIndex,
      options: (Array.isArray(group?.options) ? group.options : [])
        .map((opt, optIndex) => ({
          id: opt?.id || newPortalOptionItemId(),
          name: String(opt?.name || '').trim(),
          description: String(opt?.description || '').trim(),
          price: parseOptionalPrice(opt?.price),
          inventory_item_id: String(opt?.inventory_item_id || '').trim() || null,
          max_quantity: Math.max(1, Number.parseInt(opt?.max_quantity, 10) || PORTAL_OPTION_DEFAULT_MAX_QUANTITY),
          required: opt?.required === true,
          included: opt?.included === true,
          show_when_option_id: String(opt?.show_when_option_id || '').trim() || null,
          input_type: opt?.input_type === 'checkbox' ? 'checkbox' : 'quantity',
          sort_order: Number.parseInt(opt?.sort_order, 10) || optIndex,
        }))
        .filter((opt) => opt.id && (opt.name || opt.inventory_item_id))
        .sort((a, b) => a.sort_order - b.sort_order),
    }))
    .filter((group) => group.name || group.options.length > 0)
    .sort((a, b) => a.sort_order - b.sort_order);

  return { displayMode, groups };
};

export const collectPortalOptionInventoryItemIds = (addonSettingsRaw) => {
  const { groups } = parsePortalActivityOptions(addonSettingsRaw);
  const ids = new Set();
  (groups || []).forEach((group) => {
    (group.options || []).forEach((opt) => {
      const invId = String(opt?.inventory_item_id || '').trim();
      if (invId) ids.add(invId);
    });
  });
  return [...ids];
};

export const enrichPortalOptionsConfig = (
  addonSettingsRaw,
  inventoryItems = [],
  bundleContext = {}
) => {
  const config = parsePortalActivityOptions(addonSettingsRaw);
  const bundleItemsByBundleId =
    bundleContext.bundleItemsByBundleId instanceof Map
      ? bundleContext.bundleItemsByBundleId
      : groupBundleItemsByBundleId(bundleContext.bundleRows || []);
  const componentItems = bundleContext.componentItems || [];
  const mergedInventory = [
    ...(inventoryItems || []),
    ...componentItems.filter((item) => !(inventoryItems || []).some((row) => row.id === item.id)),
  ];
  const inventoryPrices = buildInventoryPriceMapWithBundles(
    mergedInventory,
    bundleItemsByBundleId,
    buildInventoryPriceMap(componentItems)
  );
  const byId = new Map(mergedInventory.map((item) => [item.id, item]));
  const enrichedConfig = {
    ...config,
    inventoryPrices,
    bundleItemsByBundleId,
    groups: (config.groups || []).map((group) => ({
      ...group,
      options: (group.options || []).map((opt) => {
        const inv = opt.inventory_item_id ? byId.get(opt.inventory_item_id) : null;
        const bundleItems = inv?.is_bundle ? bundleItemsByBundleId.get(inv.id) || [] : [];
        const includesLabel = inv?.is_bundle
          ? buildBundleIncludesLabel(bundleItems, inv.bundle_description)
          : '';
        return {
          ...opt,
          name: opt.name || inv?.name || '',
          description: String(opt.description || '').trim(),
          category_id: inv?.category_id ?? null,
          item_tax_overrides: inv?.item_tax_overrides ?? [],
          includes_label: includesLabel,
          is_inventory_bundle: !!inv?.is_bundle,
          default_unit_price: resolvePortalOptionDefaultPrice(group, opt, inventoryPrices),
        };
      }),
    })),
  };

  return enrichedConfig;
};

export const serializePortalActivityOptions = ({ displayMode, groups } = {}) => ({
  display_mode:
    displayMode === PORTAL_OPTIONS_DISPLAY_MODES.STEP_MODALS
      ? PORTAL_OPTIONS_DISPLAY_MODES.STEP_MODALS
      : PORTAL_OPTIONS_DISPLAY_MODES.SINGLE_MODAL,
  groups: (groups || [])
    .map((group, groupIndex) => ({
      id: group.id,
      name: String(group.name || '').trim(),
      description: String(group.description || '').trim(),
      price: parseOptionalPrice(group.price),
      show_when_option_id: group.show_when_option_id || null,
      max_selections:
        group.max_selections === null || group.max_selections === undefined || group.max_selections === ''
          ? null
          : Math.max(1, Number.parseInt(group.max_selections, 10) || 1),
      sort_order: groupIndex,
      options: (group.options || [])
        .filter((opt) => String(opt?.name || '').trim() || opt?.inventory_item_id)
        .map((opt, optIndex) => ({
          id: opt.id,
          name: String(opt.name || '').trim(),
          description: String(opt.description || '').trim(),
          price: parseOptionalPrice(opt.price),
          inventory_item_id: opt.inventory_item_id || null,
          max_quantity: Math.max(1, Number.parseInt(opt.max_quantity, 10) || PORTAL_OPTION_DEFAULT_MAX_QUANTITY),
          required: opt.required === true,
          included: opt.included === true,
          show_when_option_id: opt.show_when_option_id || null,
          input_type: opt.input_type === 'checkbox' ? 'checkbox' : 'quantity',
          sort_order: optIndex,
        })),
    }))
    .filter((group) => group.name && group.options.length > 0),
});

export const mergeAddonSettingsWithPortalOptions = (existingAddonSettings, portalOptionsSerialized) => {
  const existing =
    existingAddonSettings && typeof existingAddonSettings === 'object'
      ? existingAddonSettings
      : {};
  return {
    ...existing,
    portal_options: portalOptionsSerialized,
  };
};

/** Stable identity for matching the same option group across activities. */
export const portalOptionGroupFingerprint = (group) => {
  const name = String(group?.name || '').trim().toLowerCase();
  const optionKeys = (group?.options || [])
    .map((opt) => {
      const inv = String(opt?.inventory_item_id || '').trim();
      if (inv) return `inv:${inv}`;
      return `name:${String(opt?.name || '').trim().toLowerCase()}`;
    })
    .filter((key) => key !== 'name:')
    .sort();
  return `${name}::${optionKeys.join('|')}`;
};

/** Deep-clone a group with fresh IDs, remapping internal show_when references. */
export const clonePortalOptionGroup = (group) => {
  const source = group && typeof group === 'object' ? group : {};
  const optionIdMap = new Map();
  (source.options || []).forEach((opt) => {
    const oldId = String(opt?.id || '').trim();
    if (oldId) optionIdMap.set(oldId, newPortalOptionItemId());
  });

  const remapShowWhen = (value) => {
    const key = String(value || '').trim();
    if (!key) return null;
    return optionIdMap.get(key) || null;
  };

  return defaultPortalOptionGroup({
    name: String(source.name || '').trim(),
    description: String(source.description || '').trim(),
    price: parseOptionalPrice(source.price),
    show_when_option_id: remapShowWhen(source.show_when_option_id),
    max_selections:
      source.max_selections === null || source.max_selections === undefined || source.max_selections === ''
        ? null
        : Math.max(1, Number.parseInt(source.max_selections, 10) || 1),
    options: (source.options || [])
      .filter((opt) => String(opt?.name || '').trim() || opt?.inventory_item_id)
      .map((opt, index) => {
        const oldId = String(opt?.id || '').trim();
        return defaultPortalOptionItem({
          id: optionIdMap.get(oldId) || newPortalOptionItemId(),
          name: String(opt.name || '').trim(),
          description: String(opt.description || '').trim(),
          price: parseOptionalPrice(opt.price),
          inventory_item_id: String(opt.inventory_item_id || '').trim() || null,
          max_quantity: Math.max(1, Number.parseInt(opt.max_quantity, 10) || PORTAL_OPTION_DEFAULT_MAX_QUANTITY),
          required: opt.required === true,
          included: opt.included === true,
          show_when_option_id: remapShowWhen(opt.show_when_option_id),
          input_type: opt.input_type === 'checkbox' ? 'checkbox' : 'quantity',
          sort_order: index,
        });
      }),
  });
};

/**
 * Collect unique option groups across activities for the settings Options library.
 * Returns rows: { fingerprint, group, activityIds, instances }
 */
export const collectPortalOptionLibrary = (activities = []) => {
  const byFingerprint = new Map();

  (activities || []).forEach((activity) => {
    const activityId = activity?.id;
    if (!activityId) return;
    const { groups } = parsePortalActivityOptions(activity.addon_settings);
    groups.forEach((group) => {
      if (!(group.name || (group.options || []).length)) return;
      const fingerprint = portalOptionGroupFingerprint(group);
      if (!fingerprint || fingerprint === '::') return;
      const existing = byFingerprint.get(fingerprint);
      if (!existing) {
        byFingerprint.set(fingerprint, {
          fingerprint,
          group: clonePortalOptionGroup(group),
          activityIds: [activityId],
          instances: [{ activityId, groupId: group.id }],
        });
        return;
      }
      if (!existing.activityIds.includes(activityId)) {
        existing.activityIds.push(activityId);
      }
      existing.instances.push({ activityId, groupId: group.id });
      // Prefer the richest option list as the template
      if ((group.options || []).length > (existing.group.options || []).length) {
        existing.group = clonePortalOptionGroup(group);
      }
    });
  });

  return [...byFingerprint.values()].sort((a, b) =>
    String(a.group?.name || '').localeCompare(String(b.group?.name || '')),
  );
};

/** Apply desired activity membership for one library group (add/remove by fingerprint). */
export const applyPortalOptionLibraryAssignment = ({
  activities = [],
  fingerprint,
  templateGroup,
  selectedActivityIds = [],
}) => {
  const selected = new Set((selectedActivityIds || []).filter(Boolean));
  const updates = [];

  (activities || []).forEach((activity) => {
    if (!activity?.id) return;
    const { displayMode, groups } = parsePortalActivityOptions(activity.addon_settings);
    const hasMatch = groups.some((group) => portalOptionGroupFingerprint(group) === fingerprint);
    const shouldHave = selected.has(activity.id);

    if (shouldHave === hasMatch) return;

    let nextGroups = groups;
    if (shouldHave && !hasMatch) {
      nextGroups = [...groups, clonePortalOptionGroup(templateGroup)];
    } else if (!shouldHave && hasMatch) {
      nextGroups = groups.filter((group) => portalOptionGroupFingerprint(group) !== fingerprint);
    }

    const addonSettings = mergeAddonSettingsWithPortalOptions(
      activity.addon_settings && typeof activity.addon_settings === 'object'
        ? activity.addon_settings
        : {},
      serializePortalActivityOptions({ displayMode, groups: nextGroups }),
    );
    updates.push({ activityId: activity.id, addonSettings });
  });

  return updates;
};

/**
 * Create or update a library option group across activities.
 * When previousFingerprint is set, matching groups are replaced/removed, then the new template
 * is added to each selected activity.
 */
export const applyPortalOptionLibraryGroupUpsert = ({
  activities = [],
  previousFingerprint = null,
  templateGroup,
  selectedActivityIds = [],
}) => {
  const selected = new Set((selectedActivityIds || []).filter(Boolean));
  const nextFingerprint = portalOptionGroupFingerprint(templateGroup);
  const updates = [];

  (activities || []).forEach((activity) => {
    if (!activity?.id) return;
    const { displayMode, groups } = parsePortalActivityOptions(activity.addon_settings);
    let nextGroups = [...groups];
    const shouldHave = selected.has(activity.id);
    let changed = false;

    const stripFingerprint = (list, fingerprint) => {
      if (!fingerprint) return { list, removed: false };
      const filtered = list.filter((group) => portalOptionGroupFingerprint(group) !== fingerprint);
      return { list: filtered, removed: filtered.length !== list.length };
    };

    if (previousFingerprint) {
      const stripped = stripFingerprint(nextGroups, previousFingerprint);
      nextGroups = stripped.list;
      changed = changed || stripped.removed;
    }

    if (shouldHave) {
      const stripped = stripFingerprint(nextGroups, nextFingerprint);
      nextGroups = [...stripped.list, clonePortalOptionGroup(templateGroup)];
      changed = true;
    }

    if (!changed) return;

    updates.push({
      activityId: activity.id,
      addonSettings: mergeAddonSettingsWithPortalOptions(
        activity.addon_settings && typeof activity.addon_settings === 'object'
          ? activity.addon_settings
          : {},
        serializePortalActivityOptions({ displayMode, groups: nextGroups }),
      ),
    });
  });

  return updates;
};

export const activityHasPortalOptions = (addonSettingsRaw) => {
  const { groups } = parsePortalActivityOptions(addonSettingsRaw);
  return groups.some((group) => group.options.length > 0);
};

export const flattenPortalOptions = (config, inventoryPrices = {}) => {
  const prices = inventoryPrices && Object.keys(inventoryPrices).length > 0
    ? inventoryPrices
    : config?.inventoryPrices || {};
  const map = new Map();
  (config?.groups || []).forEach((group) => {
    (group.options || []).forEach((opt) => {
      map.set(opt.id, {
        ...opt,
        groupId: group.id,
        groupName: group.name,
        unit_price: resolvePortalOptionListPrice(group, opt, prices),
      });
    });
  });
  return map;
};

export const resolvePortalInventoryPrices = (inventoryItems = [], bundleContext = {}) => {
  const bundleItemsByBundleId =
    bundleContext.bundleItemsByBundleId instanceof Map
      ? bundleContext.bundleItemsByBundleId
      : groupBundleItemsByBundleId(bundleContext.bundleRows || []);
  const componentItems = bundleContext.componentItems || [];
  const merged = [
    ...(inventoryItems || []),
    ...componentItems.filter((item) => !(inventoryItems || []).some((row) => row.id === item.id)),
  ];
  return buildInventoryPriceMapWithBundles(
    merged,
    bundleItemsByBundleId,
    buildInventoryPriceMap(componentItems)
  );
};

/** selections: { [optionId]: quantity } */
export const calculatePortalOptionsSubtotal = (
  addonSettingsRaw,
  selections = {},
  inventoryItems = [],
  bundleContext = {}
) => {
  const config = parsePortalActivityOptions(addonSettingsRaw);
  const inventoryPrices = resolvePortalInventoryPrices(inventoryItems, bundleContext);
  const normalized = normalizePortalOptionSelections(addonSettingsRaw, selections);
  const catalog = flattenPortalOptions(config, inventoryPrices);
  let subtotal = 0;
  Object.entries(normalized || {}).forEach(([optionId, rawQty]) => {
    const opt = catalog.get(optionId);
    if (!opt) return;
    if (opt.is_bundle_component_modifier) return;
    const group = (config.groups || []).find((g) => g.id === opt.groupId);
    if (group && !isPortalOptionGroupVisible(group, normalized, config.groups)) return;
    if (!isPortalOptionVisible(opt, normalized, config.groups)) return;
    const qty = Math.max(0, Number.parseInt(rawQty, 10) || 0);
    const capped = Math.min(qty, opt.max_quantity);
    const pricing = calculatePortalOptionLinePricing(group, opt, capped, inventoryPrices, normalized);
    subtotal += pricing.totalPrice;
  });
  return Math.round(subtotal * 100) / 100;
};

export const buildPortalOptionCheckoutRows = (
  addonSettingsRaw,
  selections = {},
  inventoryItems = [],
  bundleContext = {},
  options = {}
) => {
  const skipVisibilityFilter = options?.skipVisibilityFilter === true;
  const config = parsePortalActivityOptions(addonSettingsRaw);
  const inventoryById = new Map((inventoryItems || []).map((item) => [item.id, item]));
  const inventoryPrices = resolvePortalInventoryPrices(inventoryItems, bundleContext);
  const normalized = normalizePortalOptionSelections(addonSettingsRaw, selections);
  const catalog = flattenPortalOptions(config, inventoryPrices);
  const rows = [];
  Object.entries(normalized || {}).forEach(([optionId, rawQty]) => {
    const opt = catalog.get(optionId);
    if (!opt) return;
    if (opt.is_bundle_component_modifier) return;
    const group = (config.groups || []).find((g) => g.id === opt.groupId);
    if (!skipVisibilityFilter) {
      if (group && !isPortalOptionGroupVisible(group, normalized, config.groups)) return;
      if (!isPortalOptionVisible(opt, normalized, config.groups)) return;
    }
    const quantity = Math.min(
      Math.max(0, Number.parseInt(rawQty, 10) || 0),
      opt.max_quantity
    );
    if (quantity <= 0) return;
    const pricing = calculatePortalOptionLinePricing(group, opt, quantity, inventoryPrices, normalized);
    const inv = opt.inventory_item_id ? inventoryById.get(opt.inventory_item_id) : null;
    rows.push({
      option_id: optionId,
      group_id: opt.groupId,
      inventory_item_id: opt.inventory_item_id || null,
      name: opt.name || inv?.name || 'Option',
      quantity: pricing.quantity,
      included_quantity: pricing.includedQuantity,
      paid_quantity: pricing.paidQuantity,
      unit_price: pricing.unitPrice,
      total_price: pricing.totalPrice,
      category_id: inv?.category_id ?? opt.category_id ?? null,
      item_tax_overrides: inv?.item_tax_overrides ?? opt.item_tax_overrides ?? [],
    });
  });
  return rows;
};

/** Validate selections against an enriched portal config (includes runtime bundle modifier groups). */
export const validatePortalOptionsConfig = (config, selections = {}, bundleCustomizations = {}, inventoryItems = [], bundleContext = {}) => {
  const groups = config?.groups || [];
  const normalized = { ...(selections || {}) };
  const missing = [];

  groups.forEach((group) => {
    if (!isPortalOptionGroupVisible(group, normalized, groups)) return;

    if (groupIsIncludedPackageChoice(group)) {
      const visible = filterVisiblePortalOptionItems(group, normalized, groups);
      const requiredUnits = includedPackagePickCount(group);
      const selectedUnits = visible.reduce(
        (sum, opt) => sum + (Number.parseInt(normalized?.[opt.id], 10) || 0),
        0,
      );
      if (selectedUnits < requiredUnits) {
        missing.push(group.name || 'Included package choice');
      }
      return;
    }

    (group.options || []).forEach((opt) => {
      if (!opt.required || !isPortalOptionVisible(opt, normalized, groups)) return;
      const qty = Number.parseInt(normalized?.[opt.id], 10) || 0;
      if (qty <= 0) {
        missing.push(opt.name || 'Required option');
      }
    });
  });

  if (missing.length > 0) {
    return { ok: false, message: `Please select: ${missing.join(', ')}.` };
  }

  return validatePortalBundleCustomizations(
    config,
    normalized,
    bundleCustomizations,
    inventoryItems,
    bundleContext
  );
};

export const calculatePortalOptionsSubtotalFromConfig = (config, selections = {}) => {
  const inventoryPrices = config?.inventoryPrices || {};
  const normalized = normalizePortalOptionSelections(
    portalConfigToAddonSettingsRaw(config),
    selections
  );
  const catalog = flattenPortalOptions(config, inventoryPrices);
  let subtotal = 0;
  Object.entries(normalized || {}).forEach(([optionId, rawQty]) => {
    const opt = catalog.get(optionId);
    if (!opt) return;
    if (opt.is_bundle_component_modifier) return;
    const group = (config.groups || []).find((g) => g.id === opt.groupId);
    if (group && !isPortalOptionGroupVisible(group, normalized, config.groups)) return;
    if (!isPortalOptionVisible(opt, normalized, config.groups)) return;
    const qty = Math.max(0, Number.parseInt(rawQty, 10) || 0);
    const capped = Math.min(qty, opt.max_quantity);
    const pricing = calculatePortalOptionLinePricing(group, opt, capped, inventoryPrices, normalized);
    subtotal += pricing.totalPrice;
  });
  return Math.round(subtotal * 100) / 100;
};

const formatPortalOptionDisplayLabel = (withDetail, row, included) => {
  if (!included) return withDetail;
  if (row.total_price === 0) return `${withDetail} (Included)`;
  if (row.included_quantity > 0 && row.paid_quantity > 0) {
    return `${withDetail} (1 included, ${row.paid_quantity} extra)`;
  }
  return withDetail;
};

export const listSelectedPortalOptionsForDisplayFromConfig = (
  config,
  selections = {},
  inventoryItems = [],
  bundleContext = {},
  bundleCustomizations = {},
  options = {}
) => {
  const addonSettingsRaw = options?.addonSettingsRaw || portalConfigToAddonSettingsRaw(config);
  const rows = buildPortalOptionCheckoutRowsFromConfig(
    config,
    selections,
    inventoryItems,
    bundleContext,
    { bundleCustomizations }
  );
  const inventoryById = buildPortalInventoryById(inventoryItems, bundleContext);
  const bundleItemsByBundleId =
    bundleContext.bundleItemsByBundleId instanceof Map
      ? bundleContext.bundleItemsByBundleId
      : groupBundleItemsByBundleId(bundleContext.bundleRows || []);

  return rows.map((row) => {
    let included = false;
    let groupMeta = null;
    for (const group of config.groups || []) {
      const opt = (group.options || []).find((o) => o.id === row.option_id);
      if (opt) {
        groupMeta = group;
        if (opt.included) included = true;
        break;
      }
    }
    const inv = row.inventory_item_id ? inventoryById.get(row.inventory_item_id) : null;
    const bundleIncludes = inv?.is_bundle
      ? listBundleComponentDisplayLines(
          bundleItemsByBundleId.get(inv.id) || [],
          inv.bundle_description
        )
      : [];
    const base = row.quantity > 1 ? `${row.name} × ${row.quantity}` : row.name;
    const componentDetails = formatBundleCustomizationDetailLines(
      bundleCustomizations?.[row.option_id]?.bundleComponentModifiers || []
    );
    const canRemove = canRemovePortalOrderSelection(
      addonSettingsRaw,
      config,
      selections,
      row.option_id
    );
    return {
      ...row,
      label: formatPortalOptionDisplayLabel(base, row, included),
      group_name: groupMeta?.name || null,
      group_id: row.group_id || groupMeta?.id || null,
      is_bundle: !!inv?.is_bundle,
      bundle_includes: bundleIncludes,
      bundle_component_details: componentDetails,
      can_remove: canRemove,
      can_edit: true,
    };
  });
};

export const buildPortalOptionCheckoutRowsFromConfig = (
  config,
  selections = {},
  inventoryItems = [],
  bundleContext = {},
  options = {}
) => {
  const bundleCustomizations = options?.bundleCustomizations || {};
  const skipVisibilityFilter = options?.skipVisibilityFilter === true;
  const inventoryById = buildPortalInventoryById(inventoryItems, bundleContext);
  const inventoryPrices = config?.inventoryPrices || resolvePortalInventoryPrices(inventoryItems, bundleContext);
  const normalized = normalizePortalOptionSelections(
    portalConfigToAddonSettingsRaw(config),
    selections
  );
  const catalog = flattenPortalOptions(config, inventoryPrices);
  const rows = [];
  Object.entries(normalized || {}).forEach(([optionId, rawQty]) => {
    const opt = catalog.get(optionId);
    if (!opt) return;
    if (opt.is_bundle_component_modifier) return;
    const group = (config.groups || []).find((g) => g.id === opt.groupId);
    if (!skipVisibilityFilter) {
      if (group && !isPortalOptionGroupVisible(group, normalized, config.groups)) return;
      if (!isPortalOptionVisible(opt, normalized, config.groups)) return;
    }
    const quantity = Math.min(
      Math.max(0, Number.parseInt(rawQty, 10) || 0),
      opt.max_quantity
    );
    if (quantity <= 0) return;
    const pricing = calculatePortalOptionLinePricing(group, opt, quantity, inventoryPrices, normalized);
    const inv = opt.inventory_item_id ? inventoryById.get(opt.inventory_item_id) : null;
    rows.push({
      option_id: optionId,
      group_id: opt.groupId,
      inventory_item_id: opt.inventory_item_id || null,
      name: opt.name || inv?.name || 'Option',
      quantity: pricing.quantity,
      included_quantity: pricing.includedQuantity,
      paid_quantity: pricing.paidQuantity,
      unit_price: pricing.unitPrice,
      total_price: pricing.totalPrice,
      category_id: inv?.category_id ?? opt.category_id ?? null,
      item_tax_overrides: inv?.item_tax_overrides ?? opt.item_tax_overrides ?? [],
      bundle_component_modifiers:
        bundleCustomizations?.[optionId]?.bundleComponentModifiers || null,
    });
  });
  return rows;
};

export const validatePortalOptionSelections = (addonSettingsRaw, selections = {}) => {
  const config = parsePortalActivityOptions(addonSettingsRaw);
  const normalized = normalizePortalOptionSelections(addonSettingsRaw, selections);
  const missing = [];
  (config.groups || []).forEach((group) => {
    if (!isPortalOptionGroupVisible(group, normalized, config.groups)) return;

    if (groupIsIncludedPackageChoice(group)) {
      const visible = filterVisiblePortalOptionItems(group, normalized, config.groups);
      const requiredUnits = includedPackagePickCount(group);
      const selectedUnits = visible.reduce(
        (sum, opt) => sum + (Number.parseInt(normalized?.[opt.id], 10) || 0),
        0,
      );
      if (selectedUnits < requiredUnits) {
        missing.push(group.name || 'Included package choice');
      }
      return;
    }

    (group.options || []).forEach((opt) => {
      if (!opt.required || !isPortalOptionVisible(opt, normalized, config.groups)) return;
      const qty = Number.parseInt(normalized?.[opt.id], 10) || 0;
      if (qty <= 0) {
        missing.push(opt.name || 'Required option');
      }
    });
  });
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Please select: ${missing.join(', ')}.`,
    };
  }
  return { ok: true };
};

export const listSelectedPortalOptionsForDisplay = (
  addonSettingsRaw,
  selections = {},
  inventoryItems = [],
  bundleContext = {}
) => {
  const rows = buildPortalOptionCheckoutRows(
    addonSettingsRaw,
    selections,
    inventoryItems,
    bundleContext
  );
  const config = parsePortalActivityOptions(addonSettingsRaw);
  const inventoryById = new Map((inventoryItems || []).map((item) => [item.id, item]));
  const bundleComponentDetails = formatPortalBundleComponentDetailLines(config, selections);
  const bundleItemsByBundleId =
    bundleContext.bundleItemsByBundleId instanceof Map
      ? bundleContext.bundleItemsByBundleId
      : groupBundleItemsByBundleId(bundleContext.bundleRows || []);

  return rows.map((row) => {
    let included = false;
    let optionMeta = null;
    for (const group of config.groups || []) {
      const opt = (group.options || []).find((o) => o.id === row.option_id);
      if (opt) {
        optionMeta = opt;
        if (opt.included) included = true;
        break;
      }
    }
    const inv = row.inventory_item_id ? inventoryById.get(row.inventory_item_id) : null;
    const bundleIncludes = inv?.is_bundle
      ? listBundleComponentDisplayLines(
          bundleItemsByBundleId.get(inv.id) || [],
          inv.bundle_description
        )
      : [];
    const base = row.quantity > 1 ? `${row.name} × ${row.quantity}` : row.name;
    const componentDetails = bundleComponentDetails.get(row.option_id) || [];
    return {
      ...row,
      label: formatPortalOptionDisplayLabel(base, row, included),
      is_bundle: !!inv?.is_bundle,
      bundle_includes: bundleIncludes,
      bundle_component_details: componentDetails,
    };
  });
};
