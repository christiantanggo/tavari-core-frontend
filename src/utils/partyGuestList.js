export const PARTY_GUEST_OVERAGE_PAYMENT_OPTIONS = [
  { value: 'host_bill', label: 'I will cover admission on the final party bill' },
  { value: 'guest_at_gate', label: 'Extra guests will pay at the gate themselves' },
];

export const PARTY_GUEST_OVERAGE_FOOD_OPTIONS = [
  { value: 'guests_buy_own', label: 'Guests will purchase their own additional food & drinks' },
  { value: 'host_tab_food', label: 'I would like to run a tab for my party guests for food only' },
  { value: 'host_tab_drinks', label: 'I would like to run a tab for my party guests for drinks only' },
  { value: 'host_tab_food_drinks', label: 'I would like to run a tab for my party guests for food & drinks' },
  { value: 'other', label: 'Other' },
];

export const PARTY_GUEST_OVERAGE_SOCKS_OPTIONS = [
  { value: 'guests_buy_own', label: 'Guests will buy their own socks if they forget them' },
  { value: 'host_bill', label: 'I will pay for socks if guests forget them' },
];

export const PARTY_GUEST_OVERAGE_FOOD_VALUES = PARTY_GUEST_OVERAGE_FOOD_OPTIONS.map((option) => option.value);
export const PARTY_GUEST_OVERAGE_SOCKS_VALUES = PARTY_GUEST_OVERAGE_SOCKS_OPTIONS.map((option) => option.value);

export const DEFAULT_PARTY_GUEST_OVERAGE_PAYMENT = 'guest_at_gate';
export const DEFAULT_PARTY_GUEST_OVERAGE_FOOD = 'guests_buy_own';
export const DEFAULT_PARTY_GUEST_OVERAGE_SOCKS = 'guests_buy_own';

const LEGACY_OVERAGE_FOOD_VALUES = {
  host_tab: 'host_tab_food_drinks',
};

export function resolvePartyGuestOveragePayment(value) {
  if (value === 'host_bill' || value === 'guest_at_gate') return value;
  return DEFAULT_PARTY_GUEST_OVERAGE_PAYMENT;
}

export function resolvePartyGuestOverageFood(value) {
  const normalized = String(value || '').trim();
  if (PARTY_GUEST_OVERAGE_FOOD_VALUES.includes(normalized)) return normalized;
  if (LEGACY_OVERAGE_FOOD_VALUES[normalized]) return LEGACY_OVERAGE_FOOD_VALUES[normalized];
  return DEFAULT_PARTY_GUEST_OVERAGE_FOOD;
}

export function resolvePartyGuestOverageSocks(value) {
  if (value === 'host_bill' || value === 'guests_buy_own') return value;
  // Legacy aliases from earlier drafts
  if (value === 'host_covers') return 'host_bill';
  if (value === 'guest_buys') return 'guests_buy_own';
  return DEFAULT_PARTY_GUEST_OVERAGE_SOCKS;
}

export const formatPartyGuestOveragePayment = (value) =>
  PARTY_GUEST_OVERAGE_PAYMENT_OPTIONS.find((option) => option.value === resolvePartyGuestOveragePayment(value))?.label || null;

/** Returns the host's selected food/drinks preference label only (not the full option list). */
export function formatPartyGuestOverageFood(valueOrGuestList, otherText) {
  let value = valueOrGuestList;
  let other = otherText;
  if (valueOrGuestList && typeof valueOrGuestList === 'object') {
    value = valueOrGuestList.overage_food;
    other = valueOrGuestList.overage_food_other;
  }

  const resolved = resolvePartyGuestOverageFood(value);
  if (resolved === 'other') {
    const text = String(other || '').trim();
    return text ? `Other: ${text}` : 'Other';
  }

  return PARTY_GUEST_OVERAGE_FOOD_OPTIONS.find((option) => option.value === resolved)?.label || null;
}

export const formatPartyGuestOverageSocks = (value) =>
  PARTY_GUEST_OVERAGE_SOCKS_OPTIONS.find((option) => option.value === resolvePartyGuestOverageSocks(value))?.label || null;

export const PARTY_GUEST_WAIVER_STATUSES = {
  verified: { label: 'Waiver verified', color: '#10b981', bg: '#ecfdf5' },
  name_mismatch: { label: 'Review name match', color: '#d97706', bg: '#fffbeb' },
  missing: { label: 'No waiver found', color: '#ef4444', bg: '#fef2f2' },
  expired: { label: 'Waiver expired', color: '#ef4444', bg: '#fef2f2' },
  not_verified: { label: 'Waiver not verified', color: '#6b7280', bg: '#f3f4f6' },
};

export const roleTagLabel = (roleTag) => {
  if (roleTag === 'birthday_child') return 'Birthday Child';
  if (roleTag === 'non_moving_baby') return 'Adult or Non-moving baby';
  if (roleTag === 'adult') return 'Adult or Non-moving baby';
  return 'Child';
};

export const formatGuestFullName = (entry) =>
  [entry?.first_name, entry?.last_name].filter(Boolean).join(' ').trim();

export const splitEntriesForStaffView = (entries = []) => {
  const seen = new Set();
  const unique = (entries || []).filter((entry) => {
    const first = String(entry?.first_name || '').trim().toLowerCase();
    const last = String(entry?.last_name || '').trim().toLowerCase();
    const key = `${first}|${last}`;
    if (!key || key === '|' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const kids = unique
    .filter((e) => e.guest_type === 'child')
    .sort((a, b) => (a.display_sort_order ?? 0) - (b.display_sort_order ?? 0));
  const adults = unique
    .filter((e) => e.guest_type === 'adult')
    .sort((a, b) => (a.display_sort_order ?? 0) - (b.display_sort_order ?? 0));
  return { kids, adults };
};

export const emptyChildEntry = (sortOrder = 0) => ({
  guest_type: 'child',
  first_name: '',
  last_name: '',
  parent_last_name: '',
  household_phone: '',
  is_attending: true,
  is_birthday_child: false,
  sort_order: sortOrder,
});

export const emptyAdultEntry = (sortOrder = 0) => ({
  guest_type: 'adult',
  first_name: '',
  last_name: '',
  household_phone: '',
  is_attending: true,
  is_birthday_child: false,
  sort_order: sortOrder,
});

export const emptyGuestDraft = () => ({
  guest_type: 'child',
  first_name: '',
  last_name: '',
  parent_last_name: '',
  household_phone: '',
  is_attending: true,
  is_birthday_child: false,
});

export const draftToGuestEntry = (draft, sortOrder = 0) => ({
  guest_type: draft.guest_type === 'adult' ? 'adult' : 'child',
  first_name: String(draft.first_name || '').trim(),
  last_name: String(draft.last_name || '').trim(),
  parent_last_name: draft.guest_type === 'child' ? String(draft.parent_last_name || '').trim() : '',
  household_phone: String(draft.household_phone || '').trim(),
  is_attending: draft.is_attending !== false,
  is_birthday_child: draft.guest_type === 'child' ? !!draft.is_birthday_child : false,
  sort_order: sortOrder,
});

export const getPartyGuestListPortalPath = (businessId) =>
  `/customer-portal/${businessId}/party-guest-list`;

export const isNamedGuestEntry = (entry) =>
  Boolean(String(entry?.first_name || '').trim() && String(entry?.last_name || '').trim());

export function resolveGuestListIncludedLimits(businessSettings = {}, activity = null) {
  const includedKids = activity?.party_included_kids != null
    ? Number(activity.party_included_kids)
    : Number(businessSettings.default_included_kids) || 12;
  const includedAdults = activity?.party_included_adults != null
    ? Number(activity.party_included_adults)
    : Number(businessSettings.default_included_adults) || 12;
  const oneAdultPerChildEnabled = activity?.party_one_adult_per_child != null
    ? activity.party_one_adult_per_child === true
    : businessSettings.one_adult_per_child_enabled === true;

  return {
    includedKids,
    includedAdults,
    kidsChairLimit: Number(businessSettings.kids_chair_limit_per_room) || 18,
    oneAdultPerChildEnabled,
  };
}

export function extractListLimitSettingsFromApiData(data) {
  const fromGuestList = extractListLimitSettingsFromGuestList(data?.guestList, data?.settings);
  if (fromGuestList) return fromGuestList;
  const settings = data?.settings || {};
  const activity = data?.guestList?.bookings?.booking_activities || null;
  return resolveGuestListIncludedLimits(settings, activity);
}

export function extractListLimitSettingsFromGuestList(guestList, apiSettings = null) {
  const snapshot = guestList?.settings_snapshot;
  if (snapshot && typeof snapshot === 'object') {
    const includedKids = snapshot.includedKids ?? snapshot.included_kids;
    if (includedKids != null || snapshot.includedAdults != null || snapshot.included_adults != null) {
      return {
        includedKids: Number(includedKids) || 12,
        includedAdults: Number(snapshot.includedAdults ?? snapshot.included_adults) || 12,
        kidsChairLimit: Number(snapshot.kidsChairLimit ?? snapshot.kids_chair_limit) || 18,
        oneAdultPerChildEnabled: snapshot.oneAdultPerChildEnabled === true
          || snapshot.one_adult_per_child_enabled === true,
      };
    }
  }
  if (apiSettings) {
    return resolveGuestListIncludedLimits(apiSettings, guestList?.bookings?.booking_activities || null);
  }
  return null;
}

export function computeFreeAdultSlots(listedKids, includedAdults, oneAdultPerChildEnabled) {
  if (!oneAdultPerChildEnabled) return includedAdults;
  return Math.max(includedAdults, listedKids);
}

export function pickInventoryDisplayPrice(item) {
  if (!item) return null;
  const online = Number.parseFloat(item.website_online_price);
  const regular = Number.parseFloat(item.price);
  if (Number.isFinite(online) && online >= 0) return Math.round(online * 100) / 100;
  if (Number.isFinite(regular) && regular >= 0) return Math.round(regular * 100) / 100;
  return null;
}

export function formatPartyGuestMoney(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '$0.00';
  return `$${n.toFixed(2)}`;
}

function normalizeInventoryItemName(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isRegularChildAdmissionItem(item) {
  const name = normalizeInventoryItemName(item?.name);
  if (!name || /name(s)? of the day/.test(name)) return false;
  if (name === 'ages 2-17') return true;
  if (/ages?\s*2\s*[-–]\s*17/.test(name)) return true;
  if (/gen(eration)?\s*admission.*2\s*[-–]\s*17/.test(name)) return true;
  if (/regular admission.*2\s*[-–]\s*17/.test(name)) return true;
  return false;
}

function isAdditionalAdultTicketItem(item) {
  const name = normalizeInventoryItemName(item?.name);
  if (!name) return false;
  if (/additional\s*adults?/.test(name)) return true;
  if (/extra\s*adult/.test(name)) return true;
  return false;
}

/** Resolve child/adult overage ticket prices from POS inventory (settings override or name match). */
export function resolvePartyGuestOveragePricing(inventoryItems = [], settings = {}) {
  const items = (inventoryItems || []).filter(Boolean);
  const childId = settings.extra_child_inventory_item_id || settings.extraChildInventoryItemId;
  const adultId = settings.extra_adult_inventory_item_id || settings.extraAdultInventoryItemId;

  let childItem = childId ? items.find((item) => item.id === childId) : null;
  let adultItem = adultId ? items.find((item) => item.id === adultId) : null;

  if (!childItem) {
    childItem = items.find(isRegularChildAdmissionItem) || null;
  }
  if (!adultItem) {
    adultItem = items.find(isAdditionalAdultTicketItem) || null;
  }

  const childPrice = pickInventoryDisplayPrice(childItem);
  const adultPrice = pickInventoryDisplayPrice(adultItem);

  return {
    childInventoryItemId: childItem?.id || null,
    adultInventoryItemId: adultItem?.id || null,
    childPrice,
    adultPrice,
    childLabel: childItem?.name || 'Child admission (ages 2–17)',
    adultLabel: adultItem?.name || 'Additional adult',
    hasPricing: childPrice != null || adultPrice != null,
  };
}

export function computePartyGuestOverageSummary(entries = [], settings = null, overagePricing = null) {
  const meta = buildGuestListEntryDisplayMeta(entries, settings, overagePricing);
  let extraChildCount = 0;
  let extraAdultCount = 0;
  let childSubtotal = 0;
  let adultSubtotal = 0;

  for (const value of meta.values()) {
    if (!value?.isPackageOverLimit || value.overagePrice == null) continue;
    if (value.guestType === 'child') {
      extraChildCount += 1;
      childSubtotal += value.overagePrice;
    } else if (value.guestType === 'adult') {
      extraAdultCount += 1;
      adultSubtotal += value.overagePrice;
    }
  }

  const total = Math.round((childSubtotal + adultSubtotal) * 100) / 100;
  return {
    extraChildCount,
    extraAdultCount,
    childSubtotal: Math.round(childSubtotal * 100) / 100,
    adultSubtotal: Math.round(adultSubtotal * 100) / 100,
    total,
    hasOverage: total > 0,
  };
}

export function computeGuestListWarnings(entries, settings = {}) {
  const namedEntries = (entries || []).filter(isNamedGuestEntry);
  const warnings = [];

  if (namedEntries.length === 0) {
    return {
      listedKids: 0,
      listedAdults: 0,
      attendingKids: 0,
      attendingAdults: 0,
      freeAdultSlots: 0,
      warnings,
    };
  }

  const listedKids = namedEntries.filter((e) => e.guest_type === 'child').length;
  const listedAdults = namedEntries.filter((e) => e.guest_type === 'adult').length;
  const attendingKids = namedEntries.filter((e) => e.guest_type === 'child' && e.is_attending !== false).length;
  const attendingAdults = namedEntries.filter((e) => e.guest_type === 'adult' && e.is_attending !== false).length;

  const includedKids = Number(settings.includedKids) || 12;
  const includedAdults = Number(settings.includedAdults) || 12;
  const chairLimit = Number(settings.kidsChairLimit) || 18;
  const oneAdultPerChildEnabled = settings.oneAdultPerChildEnabled === true;
  const freeAdultSlots = computeFreeAdultSlots(listedKids, includedAdults, oneAdultPerChildEnabled);

  if (listedKids > includedKids) {
    warnings.push(
      `You have ${listedKids} children on your list (${attendingKids} attending); your package includes ${includedKids}.`,
    );
  }

  if (listedAdults > freeAdultSlots) {
    if (oneAdultPerChildEnabled) {
      warnings.push(
        `You have ${listedAdults} adults on your list (${attendingAdults} attending). Up to ${freeAdultSlots} adults are included (the higher of ${includedAdults} in your package or 1 per child on your list).`,
      );
    } else {
      warnings.push(
        `You have ${listedAdults} adults on your list (${attendingAdults} attending); your package includes ${includedAdults}.`,
      );
    }
  }

  if (attendingKids > chairLimit) {
    warnings.push(
      `Your party room has ${chairLimit} chairs. You have ${listedKids} children on your list (${attendingKids} attending).`,
    );
  }

  return {
    listedKids,
    listedAdults,
    attendingKids,
    attendingAdults,
    freeAdultSlots,
    warnings,
  };
}

/** Per-row list number and over-limit highlight for host guest list editor. */
export function buildGuestListEntryDisplayMeta(entries = [], settings = null, overagePricing = null) {
  const metaByIndex = new Map();
  if (!settings) {
    entries.forEach((_, index) => metaByIndex.set(index, {
      listNumber: null,
      isOverLimit: false,
      isPackageOverLimit: false,
      guestType: null,
      overagePrice: null,
      overageLabel: null,
    }));
    return metaByIndex;
  }

  const includedKids = Number(settings.includedKids) || 12;
  const chairLimit = Number(settings.kidsChairLimit) || 18;
  const includedAdults = Number(settings.includedAdults) || 12;
  const oneAdultPerChildEnabled = settings.oneAdultPerChildEnabled === true;

  const namedEntries = (entries || []).filter(isNamedGuestEntry);
  const listedKids = namedEntries.filter((e) => e.guest_type === 'child').length;
  const freeAdultSlots = computeFreeAdultSlots(listedKids, includedAdults, oneAdultPerChildEnabled);

  let childNumber = 0;
  let adultNumber = 0;
  let attendingChildRank = 0;

  entries.forEach((entry, index) => {
    if (!isNamedGuestEntry(entry)) {
      metaByIndex.set(index, {
        listNumber: null,
        isOverLimit: false,
        isPackageOverLimit: false,
        guestType: null,
        overagePrice: null,
        overageLabel: null,
      });
      return;
    }

    const isChild = entry.guest_type === 'child';
    let listNumber;
    let isPackageOverLimit = false;
    let isOverLimit = false;

    if (isChild) {
      childNumber += 1;
      listNumber = childNumber;
      if (childNumber > includedKids) {
        isPackageOverLimit = true;
        isOverLimit = true;
      }
      if (entry.is_attending !== false) {
        attendingChildRank += 1;
        if (attendingChildRank > chairLimit) isOverLimit = true;
      }
    } else {
      adultNumber += 1;
      listNumber = adultNumber;
      if (adultNumber > freeAdultSlots) {
        isPackageOverLimit = true;
        isOverLimit = true;
      }
    }

    let overagePrice = null;
    let overageLabel = null;
    if (isPackageOverLimit && overagePricing) {
      if (isChild && overagePricing.childPrice != null) {
        overagePrice = overagePricing.childPrice;
        overageLabel = overagePricing.childLabel;
      } else if (!isChild && overagePricing.adultPrice != null) {
        overagePrice = overagePricing.adultPrice;
        overageLabel = overagePricing.adultLabel;
      }
    }

    metaByIndex.set(index, {
      listNumber,
      isOverLimit,
      isPackageOverLimit,
      guestType: isChild ? 'child' : 'adult',
      overagePrice,
      overageLabel,
    });
  });

  return metaByIndex;
}

export const waiverStatusStyle = (status) =>
  PARTY_GUEST_WAIVER_STATUSES[status] || PARTY_GUEST_WAIVER_STATUSES.not_verified;
