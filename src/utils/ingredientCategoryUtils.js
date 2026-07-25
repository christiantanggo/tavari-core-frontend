/**
 * Helpers for ingredient categories — strip legacy "Category - Name" prefixes from CSV imports.
 */

export function buildLikelyCategoryPrefixes(ingredients = []) {
  const counts = new Map();
  for (const ing of ingredients) {
    const name = ing.name || '';
    const dashIdx = name.indexOf(' - ');
    if (dashIdx <= 0) continue;
    const prefix = name.slice(0, dashIdx).trim().toLowerCase();
    if (prefix) counts.set(prefix, (counts.get(prefix) || 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count >= 2).map(([prefix]) => prefix));
}

export function parseCategoryPrefixedName(name, categories = [], likelyPrefixes = null) {
  const raw = (name || '').trim();
  if (!raw) return { cleanName: '', categoryId: null };

  const dashIdx = raw.indexOf(' - ');
  if (dashIdx <= 0) return { cleanName: raw, categoryId: null };

  const prefix = raw.slice(0, dashIdx).trim();
  const remainder = raw.slice(dashIdx + 3).trim();
  if (!remainder) return { cleanName: raw, categoryId: null };

  const match = categories.find((c) => c.name.toLowerCase() === prefix.toLowerCase());
  if (match) {
    return { cleanName: remainder, categoryId: match.id };
  }

  if (likelyPrefixes?.has(prefix.toLowerCase())) {
    return { cleanName: remainder, categoryId: null };
  }

  return { cleanName: raw, categoryId: null };
}

export function getIngredientDisplayName(ingredient, categoriesById) {
  const name = (ingredient?.name || '').trim();
  if (!name) return '';

  const cat = ingredient?.category_id ? categoriesById?.get?.(ingredient.category_id) : null;
  if (cat?.name) {
    const prefix = `${cat.name} - `;
    if (name.toLowerCase().startsWith(prefix.toLowerCase())) {
      return name.slice(prefix.length);
    }
  }

  return name;
}

export function buildCategoriesById(categories = []) {
  return new Map(categories.map((c) => [c.id, c]));
}

/**
 * Returns DB updates needed to strip a known category prefix from stored names.
 */
export function getIngredientPrefixCleanupUpdate(ingredient, categories = [], likelyPrefixes = null) {
  const parsed = parseCategoryPrefixedName(ingredient.name, categories, likelyPrefixes);
  const update = {};

  if (parsed.cleanName && parsed.cleanName !== ingredient.name) {
    update.name = parsed.cleanName;
  }
  if (!ingredient.category_id && parsed.categoryId) {
    update.category_id = parsed.categoryId;
  }

  return Object.keys(update).length > 0 ? update : null;
}
