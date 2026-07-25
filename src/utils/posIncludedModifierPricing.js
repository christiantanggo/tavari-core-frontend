/**
 * Combo/meal included-category pricing.
 * Charge max(0, drink inventory price − included max) before tax.
 */

export function getIncludedModifierAllowance(product) {
  const categoryId = product?.included_modifier_category_id;
  if (!categoryId) return null;
  const maxPrice = Number(product?.included_modifier_max_price);
  if (!Number.isFinite(maxPrice) || maxPrice < 0) return null;
  return {
    categoryId: String(categoryId),
    maxPrice,
  };
}

/**
 * Resolve the displayed/charged price for one modifier option.
 * When the parent product has an included-category allowance, that formula wins
 * for items in that category (ignores legacy is_free / price_override on combo drinks).
 */
export function resolveModifierChargePrice({
  inventoryPrice,
  categoryId,
  priceOverride = null,
  isFree = false,
  allowance = null,
}) {
  const inv = Number(inventoryPrice) || 0;

  if (allowance && String(categoryId || '') === String(allowance.categoryId)) {
    return Math.max(0, Math.round((inv - allowance.maxPrice) * 100) / 100);
  }

  if (isFree) return 0;

  if (priceOverride !== null && priceOverride !== undefined && priceOverride !== '') {
    const n = Number(priceOverride);
    return Number.isFinite(n) ? n : 0;
  }

  return inv;
}

/**
 * Pool allowance across all selected modifiers in the included category.
 * Sum inventory prices in category, charge max(0, sum − max) on the highest-priced item.
 */
export function applyIncludedCategoryPool(modifiers = [], product) {
  const allowance = getIncludedModifierAllowance(product);
  if (!allowance || !Array.isArray(modifiers) || modifiers.length === 0) {
    return modifiers;
  }

  const next = modifiers.map((m) => ({ ...m }));
  const included = next
    .map((m, index) => ({
      index,
      inv: Number(m.inventory_price ?? m.menu_price) || 0,
      cat: String(m.category_id || ''),
      isFree: m.is_free === true,
    }))
    // Free follow-up flavours (e.g. Bubly Lime) keep a vending SKU price but must not
    // consume the combo drink allowance — only the primary drink / size does.
    .filter((row) => row.cat === allowance.categoryId && !row.isFree);

  if (included.length === 0) return next;

  const sum = included.reduce((s, row) => s + row.inv, 0);
  const upgrade = Math.max(0, Math.round((sum - allowance.maxPrice) * 100) / 100);

  included.forEach((row) => {
    next[row.index] = { ...next[row.index], price: 0, is_free: false };
  });

  const primary = included.reduce((best, row) => (row.inv > best.inv ? row : best));
  next[primary.index] = { ...next[primary.index], price: upgrade, is_free: false };

  return next;
}

export function sumModifierPrices(modifiers = []) {
  return (modifiers || []).reduce((total, modifier) => {
    // After allowance pooling, price is authoritative (is_free may be stale legacy data)
    return total + (Number(modifier?.price) || 0);
  }, 0);
}

/**
 * List-price preview for a combo option when nested modifiers hold the real price
 * (e.g. Slush Puppie $0 → Size Small $3.54). Uses max(own, nestedMin) inventory.
 * isFrom=true means show "from +$X" because the charge depends on a follow-up pick.
 */
export function getModifierOptionPricePreview({
  inventoryPrice = 0,
  categoryId = null,
  price = 0,
  nestedMinInventoryPrice = 0,
  allowance = null,
}) {
  const inv = Number(inventoryPrice) || 0;
  const nestedMin = Number(nestedMinInventoryPrice) || 0;
  const effectiveInv = Math.max(inv, nestedMin);
  const isFrom = nestedMin > inv;

  let amount;
  if (allowance && String(categoryId || '') === String(allowance.categoryId)) {
    amount = Math.max(0, Math.round((effectiveInv - allowance.maxPrice) * 100) / 100);
  } else if (isFrom) {
    amount = Math.max(Number(price) || 0, nestedMin);
  } else {
    amount = Number(price) || 0;
  }

  return {
    amount: Math.round(amount * 100) / 100,
    isFrom,
    effectiveInventoryPrice: effectiveInv,
  };
}

/** Combo Side / Combo Drink lists — not Size or Toppings. */
export function isComboSideOrDrinkGroup(group) {
  return /combo\s*(side|drink)/i.test(String(group?.name || ''));
}

/**
 * Included options first (A–Z), then upcharge options (A–Z).
 * Leaves Size groups (and non side/drink groups) in their existing order.
 */
export function sortModifierOptionsIncludedFirst(
  modifiers = [],
  { group = null, allGroups = [], product = null, nestedMinByModifierId = null } = {}
) {
  const list = [...(modifiers || [])];
  const groupName = String(group?.name || '');
  if (/\bsize\b/i.test(groupName)) return list;
  if (!isComboSideOrDrinkGroup(group)) return list;

  const allowance = getIncludedModifierAllowance(product);

  const sortKey = (mod) => {
    const nestedMin =
      nestedMinByModifierId && Object.prototype.hasOwnProperty.call(nestedMinByModifierId, mod.id)
        ? Number(nestedMinByModifierId[mod.id]) || 0
        : 0;
    const preview = getModifierOptionPricePreview({
      inventoryPrice: mod.inventory_price,
      categoryId: mod.category_id,
      price: mod.price,
      nestedMinInventoryPrice: nestedMin,
      allowance,
    });
    return {
      tier: preview.amount === 0 ? 0 : 1,
      name: String(mod.name || '').toLowerCase(),
    };
  };

  return list.sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    if (ka.tier !== kb.tier) return ka.tier - kb.tier;
    return ka.name.localeCompare(kb.name, undefined, { sensitivity: 'base' });
  });
}
