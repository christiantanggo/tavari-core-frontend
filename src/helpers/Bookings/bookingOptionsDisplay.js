import {
  buildDefaultPortalOptionSelections,
  normalizePortalOptionSelections,
  parsePortalActivityOptions,
} from '../../utils/bookingActivityOptions';

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

export function extractPortalOptionIdFromAddon(addon = {}, bookingId = null) {
  const addonKey = String(addon.addon_key || '').trim();
  if (!addonKey.startsWith('portal-')) return null;

  if (bookingId) {
    const prefix = `portal-${bookingId}-`;
    if (addonKey.startsWith(prefix)) {
      return addonKey.slice(prefix.length) || null;
    }
  }

  const parts = addonKey.split('-');
  if (parts.length >= 3 && parts[0] === 'portal') {
    return parts.slice(2).join('-') || null;
  }

  return null;
}

function mapAddonLine(line, bookingId) {
  const addon = line.booking_addons || {};
  const quantity = Math.max(0, Number.parseInt(line.quantity, 10) || 0);
  if (quantity <= 0) return null;

  const unitPrice = Number(line.unit_price) || Number(addon.price) || 0;
  const totalPrice = Number(line.total_price) || quantity * unitPrice;

  return {
    lineItemId: line.id,
    optionId: extractPortalOptionIdFromAddon(addon, bookingId),
    nameKey: normalizeName(addon.addon_name),
    addonName: String(addon.addon_name || '').trim(),
    description: String(addon.description || '').trim(),
    quantity,
    unitPrice,
    totalPrice,
  };
}

/** Map existing portal addon lines to { [optionId]: quantity }. */
export function buildPortalOptionSelectionsFromBooking(booking) {
  const activity = booking?.booking_activities || {};
  const selections = buildDefaultPortalOptionSelections(activity.addon_settings);

  for (const line of booking?.booking_addon_items || []) {
    const addon = line.booking_addons || {};
    const optionId = extractPortalOptionIdFromAddon(addon, booking?.id || null);
    if (!optionId) continue;
    selections[optionId] = Math.max(0, Number.parseInt(line.quantity, 10) || 0);
  }

  return normalizePortalOptionSelections(activity.addon_settings, selections);
}

/**
 * Build grouped option selections for the booking detail Options tab.
 */
export function buildBookingSelectedOptionsView(booking) {
  const activity = booking?.booking_activities || {};
  const config = parsePortalActivityOptions(activity.addon_settings);
  const groups = [...(config.groups || [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );

  const lines = (booking?.booking_addon_items || [])
    .map((line) => mapAddonLine(line, booking?.id || null))
    .filter(Boolean);

  const linesByOptionId = new Map();
  const linesByName = new Map();
  for (const line of lines) {
    if (line.optionId && !linesByOptionId.has(line.optionId)) {
      linesByOptionId.set(line.optionId, line);
    }
    if (line.nameKey && !linesByName.has(line.nameKey)) {
      linesByName.set(line.nameKey, line);
    }
  }

  const consumedLineIds = new Set();
  const grouped = [];

  for (const group of groups) {
    const options = [...(group.options || [])]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((opt) => {
        const selection =
          linesByOptionId.get(opt.id) ||
          linesByName.get(normalizeName(opt.name)) ||
          null;

        if (!selection) return null;

        consumedLineIds.add(selection.lineItemId);

        const included = opt.included === true || selection.unitPrice === 0;

        return {
          optionId: opt.id,
          name: opt.name || selection.addonName || 'Option',
          description: opt.description || '',
          quantity: selection.quantity,
          unitPrice: selection.unitPrice,
          totalPrice: selection.totalPrice,
          included,
        };
      })
      .filter(Boolean);

    if (options.length === 0) continue;

    grouped.push({
      id: group.id,
      name: group.name || 'Options',
      description: group.description || '',
      options,
    });
  }

  const additionalItems = lines
    .filter((line) => !consumedLineIds.has(line.lineItemId))
    .map((line) => ({
      lineItemId: line.lineItemId,
      name: line.addonName || 'Add-on',
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      totalPrice: line.totalPrice,
    }));

  const hasActivityOptions = groups.some((group) => (group.options || []).length > 0);

  return {
    hasActivityOptions,
    groups: grouped,
    additionalItems,
    hasSelections: grouped.length > 0 || additionalItems.length > 0,
  };
}

/** Non-portal addon lines (manual / legacy) shown read-only on the Options tab. */
export function listNonPortalAddonItems(booking) {
  const bookingId = booking?.id || null;
  return (booking?.booking_addon_items || [])
    .map((line) => mapAddonLine(line, bookingId))
    .filter((line) => line && !line.optionId);
}
