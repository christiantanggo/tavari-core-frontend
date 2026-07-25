export const PORTAL_OPTIONS_DISPLAY_MODES = {

  SINGLE_MODAL: "single_modal",

  STEP_MODALS: "step_modals",

} as const;



type PortalOption = {

  id: string;

  name: string;

  price: number | null;

  inventory_item_id: string | null;

  max_quantity: number;

  required: boolean;

  included: boolean;

  show_when_option_id: string | null;

  sort_order: number;

};



type PortalGroup = {

  id: string;

  name: string;

  price: number | null;

  show_when_option_id: string | null;

  max_selections: number | null;

  options: PortalOption[];

};



const parseOptionalPrice = (value: unknown): number | null => {

  if (value === null || value === undefined || value === "") return null;

  const parsed = Number.parseFloat(String(value));

  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;

};



const groupHasIncludedOption = (group: PortalGroup) =>
  (group.options || []).some((opt) => opt.included === true);

const includedPackageChoiceOptions = (group: PortalGroup) =>
  (group.options || []).filter(
    (opt) => String(opt.name || "").trim() || opt.inventory_item_id,
  );

const includedPackagePickCount = (group: PortalGroup) =>
  Math.max(1, Number.parseInt(String(group.max_selections ?? ""), 10) || 1);

/** Every option included; max_selections = free units / minimum required units. */
const groupIsIncludedPackageChoice = (group: PortalGroup) => {
  const options = includedPackageChoiceOptions(group);
  if (options.length < 2) return false;
  return options.every((opt) => opt.included === true);
};

const groupIsIncludedPickOneChoice = (group: PortalGroup) =>
  groupIsIncludedPackageChoice(group) && includedPackagePickCount(group) === 1;

const groupIsPickOne = (group: PortalGroup) => {
  if (groupIsIncludedPackageChoice(group)) return false;
  return (
    groupHasIncludedOption(group) ||
    Number.parseInt(String(group.max_selections ?? ""), 10) === 1
  );
};

/** Free units allocated by sort_order; quantity counts toward max_selections. */
const resolveIncludedFreeQuantityByOptionId = (
  group: PortalGroup,
  selections: Record<string, number> = {},
) => {
  if (!groupIsIncludedPackageChoice(group)) return {} as Record<string, number>;
  let remaining = includedPackagePickCount(group);
  const freeById: Record<string, number> = {};
  const selected = (group.options || [])
    .map((opt) => ({
      opt,
      qty: Math.max(0, Number.parseInt(String(selections[opt.id] ?? 0), 10) || 0),
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

const resolveIncludedFreeOptionIdsForGroup = (
  group: PortalGroup,
  selections: Record<string, number> = {},
) => Object.keys(resolveIncludedFreeQuantityByOptionId(group, selections));

const resolveIncludedFreeOptionIdForGroup = (
  group: PortalGroup,
  selections: Record<string, number> = {},
) => resolveIncludedFreeOptionIdsForGroup(group, selections)[0] || null;

const optionReceivesIncludedFreeSlot = (
  group: PortalGroup,
  option: PortalOption,
  selections: Record<string, number> = {},
) => {
  if (!option.included) return false;
  if (groupIsIncludedPackageChoice(group)) {
    return (resolveIncludedFreeQuantityByOptionId(group, selections)[option.id] || 0) > 0;
  }
  return option.included === true;
};



const findPortalOptionGroupForOption = (groups: PortalGroup[], optionId: string) => {

  const id = String(optionId || "").trim();

  if (!id) return null;

  return groups.find((group) => group.options.some((opt) => opt.id === id)) || null;

};



const getActivePickOneSelection = (

  group: PortalGroup,

  selections: Record<string, number> = {},

) => {

  const selected = group.options.filter(

    (opt) => (Number.parseInt(String(selections[opt.id] ?? 0), 10) || 0) > 0,

  );

  if (selected.length === 0) return null;

  if (selected.length === 1) return selected[0];

  if (groupIsIncludedPickOneChoice(group)) {

    return selected.reduce((best, opt) =>

      (opt.sort_order ?? 0) < (best.sort_order ?? 0) ? opt : best,

    );

  }

  if (groupHasIncludedOption(group)) {

    return selected.find((opt) => !opt.included) || selected[0];

  }

  return selected.reduce((best, opt) => (opt.sort_order >= best.sort_order ? opt : best));

};



const isParentOptionActive = (

  parentOptionId: string,

  selections: Record<string, number> = {},

  allGroups: PortalGroup[] = [],

): boolean => {

  const id = String(parentOptionId || "").trim();

  if (!id) return true;



  const parentGroup = findPortalOptionGroupForOption(allGroups, id);

  if (parentGroup && groupIsPickOne(parentGroup)) {

    const active = getActivePickOneSelection(parentGroup, selections);

    return !!active && active.id === id;

  }



  return (Number.parseInt(String(selections[id] ?? 0), 10) || 0) > 0;

};



const isPortalOptionVisible = (

  option: PortalOption,

  selections: Record<string, number> = {},

  allGroups: PortalGroup[] = [],

): boolean => isParentOptionActive(String(option.show_when_option_id || ""), selections, allGroups);



const filterVisiblePortalOptionItems = (

  group: PortalGroup,

  selections: Record<string, number> = {},

  allGroups: PortalGroup[] = [],

) => group.options.filter((option) => isPortalOptionVisible(option, selections, allGroups));



export const isPortalOptionGroupVisible = (

  group: PortalGroup,

  selections: Record<string, number> = {},

  allGroups: PortalGroup[] = [],

): boolean => {

  const groupParentId = String(group.show_when_option_id || "").trim();

  if (groupParentId) {

    return isParentOptionActive(groupParentId, selections, allGroups);

  }



  const hasConditionalOptions = group.options.some((opt) =>

    String(opt.show_when_option_id || "").trim()

  );

  if (hasConditionalOptions) {

    return filterVisiblePortalOptionItems(group, selections, allGroups).length > 0;

  }



  return true;

};



export const resolvePortalOptionListPrice = (
  group: PortalGroup,
  option: PortalOption,
  inventoryPrices: Record<string, number> = {},
): number => {
  const optionPrice = parseOptionalPrice(option.price);
  if (optionPrice !== null) return optionPrice;
  const invId = String(option.inventory_item_id || "").trim();
  if (invId && inventoryPrices[invId] != null) {
    return inventoryPrices[invId];
  }
  return parseOptionalPrice(group.price) ?? 0;
};

export const resolvePortalOptionUnitPrice = (
  group: PortalGroup,
  option: PortalOption,
  inventoryPrices: Record<string, number> = {},
): number => {
  if (option.included === true) return 0;
  return resolvePortalOptionListPrice(group, option, inventoryPrices);
};

export const calculatePortalOptionLinePricing = (
  group: PortalGroup,
  option: PortalOption,
  rawQuantity: unknown,
  inventoryPrices: Record<string, number> = {},
  selections: Record<string, number> | null = null,
) => {
  const maxQty = Math.max(1, Number.parseInt(String(option.max_quantity ?? 1), 10) || 1);
  const quantity = Math.min(
    Math.max(0, Number.parseInt(String(rawQuantity ?? 0), 10) || 0),
    maxQty,
  );
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
  const selectionMap = selections && typeof selections === "object" ? selections : {};

  if (groupIsIncludedPackageChoice(group) && option.included) {
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



export const parsePortalActivityOptions = (addonSettingsRaw: unknown) => {

  let raw: Record<string, unknown> = {};

  if (typeof addonSettingsRaw === "string") {

    try {

      raw = JSON.parse(addonSettingsRaw) as Record<string, unknown>;

    } catch {

      raw = {};

    }

  } else if (addonSettingsRaw && typeof addonSettingsRaw === "object") {

    raw = addonSettingsRaw as Record<string, unknown>;

  }



  const portal =

    raw.portal_options && typeof raw.portal_options === "object"

      ? (raw.portal_options as Record<string, unknown>)

      : {};



  const groups = (Array.isArray(portal.groups) ? portal.groups : [])

    .map((groupRaw) => {

      const group = groupRaw as Record<string, unknown>;

      const options = (Array.isArray(group.options) ? group.options : [])

        .map((optRaw) => {

          const opt = optRaw as Record<string, unknown>;

          return {

            id: String(opt.id || ""),

            name: String(opt.name || "").trim(),

            price: parseOptionalPrice(opt.price),

            inventory_item_id: String(opt.inventory_item_id || "").trim() || null,

            max_quantity: Math.max(1, Number.parseInt(String(opt.max_quantity ?? 1), 10) || 1),

            required: opt.required === true,

            included: opt.included === true,

            show_when_option_id: String(opt.show_when_option_id || "").trim() || null,

            sort_order: Number.parseInt(String(opt.sort_order ?? 0), 10) || 0,

          };

        })

        .filter((opt) => opt.id && (opt.name || opt.inventory_item_id));

      return {

        id: String(group.id || ""),

        name: String(group.name || "").trim(),

        price: parseOptionalPrice(group.price),

        show_when_option_id: String(group.show_when_option_id || "").trim() || null,

        max_selections:

          group.max_selections === null || group.max_selections === undefined || group.max_selections === ""

            ? null

            : Math.max(1, Number.parseInt(String(group.max_selections), 10) || 1),

        options,

      };

    })

    .filter((group) => group.options.length > 0);



  return { groups };

};



export const collectPortalOptionInventoryItemIds = (addonSettingsRaw: unknown): string[] => {

  const { groups } = parsePortalActivityOptions(addonSettingsRaw);

  const ids = new Set<string>();

  groups.forEach((group) => {

    group.options.forEach((opt) => {

      if (opt.inventory_item_id) ids.add(opt.inventory_item_id);

    });

  });

  return [...ids];

};



export const validatePortalOptionRowsAgainstActivity = (

  addonSettingsRaw: unknown,

  addonRows: unknown[],

  inventoryPrices: Record<string, number> = {},

) => {

  const { groups } = parsePortalActivityOptions(addonSettingsRaw);

  const catalog = new Map<string, PortalOption & { groupId: string; unitPrice: number }>();

  const groupById = new Map(groups.map((group) => [group.id, group]));



  groups.forEach((group) => {

    group.options.forEach((opt) => {

      catalog.set(opt.id, {

        ...opt,

        groupId: group.id,

        unitPrice: resolvePortalOptionListPrice(group, opt, inventoryPrices),

      });

    });

  });



  const selectionsFromRows: Record<string, number> = {};

  for (const rowRaw of addonRows) {

    const row = rowRaw as Record<string, unknown>;

    const optionId = String(row?.option_id || "").trim();

    const quantity = Math.max(0, Number.parseInt(String(row?.quantity ?? 0), 10) || 0);

    if (optionId && quantity > 0) {

      selectionsFromRows[optionId] = quantity;

    }

  }



  let subtotal = 0;

  for (const rowRaw of addonRows) {

    const row = rowRaw as Record<string, unknown>;

    const optionId = String(row?.option_id || "").trim();

    const opt = catalog.get(optionId);

    if (!opt) {

      return { ok: false as const, message: "Invalid activity option in checkout." };

    }

    const group = groupById.get(opt.groupId);

    if (group && !isPortalOptionGroupVisible(group, selectionsFromRows, groups)) {

      return {

        ok: false as const,

        message: "Selected option is not available for the current choices.",

      };

    }

    if (!isPortalOptionVisible(opt, selectionsFromRows, groups)) {

      return {

        ok: false as const,

        message: "Selected option is not available for the current choices.",

      };

    }

    const quantity = Math.min(

      Math.max(0, Number.parseInt(String(row?.quantity ?? 0), 10) || 0),

      opt.max_quantity,

    );

    const unitPrice = Math.max(

      0,

      Number.parseFloat(String(row?.unit_price ?? opt.unitPrice)) || 0,

    );

    if (Math.abs(unitPrice - opt.unitPrice) > 0.02) {

      return { ok: false as const, message: "Option price does not match activity configuration." };

    }

    if (quantity <= 0) continue;

    const pricing = calculatePortalOptionLinePricing(

      group!,

      opt,

      quantity,

      inventoryPrices,

      selectionsFromRows,

    );
    subtotal += pricing.totalPrice;

  }



  for (const group of groups) {

    if (!isPortalOptionGroupVisible(group, selectionsFromRows, groups)) continue;

    for (const opt of group.options) {

      if (!opt.required) continue;

      const row = addonRows.find(

        (r) => String((r as Record<string, unknown>)?.option_id || "") === opt.id,

      ) as Record<string, unknown> | undefined;

      const qty = Number.parseInt(String(row?.quantity ?? 0), 10) || 0;

      if (qty <= 0) {

        return { ok: false as const, message: `Required option missing: ${opt.name}.` };

      }

    }

  }



  return { ok: true as const, subtotal: Math.round(subtotal * 100) / 100 };

};


