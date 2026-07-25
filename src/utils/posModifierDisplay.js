/**
 * Display helpers for POS modifiers (pizza halves, receipt lines, etc.).
 */

/**
 * True when this group should be considered "done" for auto-advance.
 * Pick-one (max=1): done after one selection.
 * Capped multi: done when count reaches max_selections.
 * Unlimited multi (null/0 max): never auto-done — staff stay until they tap another tab.
 */
export function isModifierGroupSelectionComplete(group, selections = []) {
  const count = (selections || []).filter((row) => row?.group_id === group?.id).length;
  const max = Number.parseInt(group?.max_selections, 10);
  if (Number.isFinite(max) && max === 1) return count >= 1;
  if (Number.isFinite(max) && max > 1) return count >= max;
  return false;
}

/**
 * Label for cart / kitchen / customer receipt.
 * 12" toppings already include Left/Right in inventory names.
 * 7" shares SKUs across Full/Left/Right — append side from group_name.
 */
export function formatPosModifierLabel(mod) {
  const name = String(mod?.name || '').trim();
  if (!name) return '';

  if (/\b(left|right|full)\b/i.test(name)) {
    return name;
  }

  const groupName = String(mod?.group_name || '').trim();
  const sideMatch = groupName.match(/\b(Left|Right|Full)\b/i);
  if (!sideMatch) return name;

  const side =
    sideMatch[1].charAt(0).toUpperCase() + sideMatch[1].slice(1).toLowerCase();
  return `${name} (${side})`;
}
