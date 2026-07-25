import dayjs from 'dayjs';

const DEFAULT_PRIORITY_BASE = 1000;

/**
 * Online booking / customer portal price: prefer website_online_price when set,
 * otherwise fall back to gate/POS price.
 */
export const resolveInventoryTicketPrice = (item) => {
  if (!item) return 0;
  const online = Number.parseFloat(item.website_online_price);
  if (Number.isFinite(online) && online > 0) return online;
  const price = Number.parseFloat(item.price ?? 0);
  return Number.isFinite(price) && price > 0 ? price : (Number.isFinite(price) ? price : 0);
};

/** Remap inventory rows so `.price` is the online-channel unit price. */
export const applyOnlineChannelPrices = (items = []) =>
  (items || []).map((item) => {
    if (!item) return item;
    return {
      ...item,
      gate_price: item.price,
      price: resolveInventoryTicketPrice(item),
    };
  });

const toIntOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

export const parseAgeRestriction = (value) => {
  if (value == null) return { parsed: null, hasRestriction: false };
  const parsed = typeof value === 'string'
    ? (() => {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      })()
    : value;
  if (!parsed || typeof parsed !== 'object') {
    return { parsed: null, hasRestriction: false };
  }
  const hasRestriction = parsed.min_value != null || parsed.max_value != null;
  return {
    parsed: hasRestriction
      ? {
          min_value: parsed.min_value ?? 0,
          min_unit: parsed.min_unit || 'years',
          max_value: parsed.max_value ?? null,
          max_unit: parsed.max_unit || 'years'
        }
      : null,
    hasRestriction
  };
};

export const ageRestrictionToMonths = (ageRestriction) => {
  const { parsed, hasRestriction } = parseAgeRestriction(ageRestriction);
  if (!hasRestriction || !parsed) return null;
  const minMonths = parsed.min_unit === 'months' ? (parsed.min_value ?? 0) : (parsed.min_value ?? 0) * 12;
  const maxRaw = parsed.max_value == null ? 999 : parsed.max_value;
  const maxMonths = parsed.max_unit === 'months' ? maxRaw : maxRaw * 12;
  return { minMonths, maxMonths };
};

export const participantAgeInMonths = (dateOfBirth, now = dayjs()) => {
  if (!dateOfBirth) return null;
  const birth = dayjs(dateOfBirth);
  if (!birth.isValid()) return null;
  return now.diff(birth, 'month');
};

export const participantMatchesAgeRestriction = (dateOfBirth, ageRestriction, now = dayjs()) => {
  const range = ageRestrictionToMonths(ageRestriction);
  if (!range) return true;
  const ageMonths = participantAgeInMonths(dateOfBirth, now);
  if (ageMonths == null) return false;
  return ageMonths >= range.minMonths && ageMonths <= range.maxMonths;
};

const ADULT_MIN_MONTHS = 18 * 12;

export const isAdultPortalParticipant = (participant, now = dayjs()) => {
  if (!participant) return false;
  const type = String(participant.participant_type || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (type === 'primary' || type === 'additional_adult' || type === 'additionaladult') return true;
  if (participant.is_account_owner) return true;
  const ageMonths = participantAgeInMonths(participant.date_of_birth, now);
  return ageMonths != null && ageMonths >= ADULT_MIN_MONTHS;
};

export const findAdultInventoryItem = (items = [], { preferPaid = true } = {}) => {
  const candidates = [];
  (items || []).forEach((item) => {
    const range = ageRestrictionToMonths(item?.age_restriction);
    const { parsed, hasRestriction } = parseAgeRestriction(item?.age_restriction);
    const minYears = parsed?.min_unit === 'years' ? (parsed?.min_value ?? 0) : null;
    const isAdultBand =
      (range && range.minMonths >= ADULT_MIN_MONTHS) ||
      (hasRestriction && minYears != null && minYears >= 18);
    const nameLooksAdult = /\badult\b/i.test(String(item?.name || ''));
    if (isAdultBand || nameLooksAdult) {
      candidates.push(item);
    }
  });
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const priceA = Number.parseFloat(a.price || 0);
    const priceB = Number.parseFloat(b.price || 0);
    if (preferPaid && (priceA <= 0) !== (priceB <= 0)) {
      return priceA <= 0 ? 1 : -1;
    }
    // Prefer the cheaper paid adult SKU when both are paid (e.g. Adult over Additional adults).
    if (preferPaid && priceA > 0 && priceB > 0 && priceA !== priceB) {
      return priceA - priceB;
    }
    const rangeA = ageRestrictionToMonths(a.age_restriction);
    const rangeB = ageRestrictionToMonths(b.age_restriction);
    return (rangeB?.minMonths ?? 0) - (rangeA?.minMonths ?? 0);
  });
  return sorted[0];
};

/** Assign one ticket for a participant when explicit rules or age match did not run. Returns true if assigned. */
export const assignParticipantTicketFallback = (
  participant,
  items = [],
  ticketCounts = {},
  participantAssignments = null,
  { now = dayjs(), participantMatchesAge = participantMatchesAgeRestriction, preferPaid = false } = {}
) => {
  if (!participant?.id || !Array.isArray(items) || items.length === 0) return false;

  const recordAssignment = (item) => {
    ticketCounts[item.id] = (ticketCounts[item.id] || 0) + 1;
    if (participantAssignments) {
      participantAssignments[participant.id] = {
        inventory_item_id: item.id,
        inventory_item_name: item.name || 'Ticket',
      };
    }
    return true;
  };

  const itemPassesPaidFilter = (item) => {
    if (!preferPaid) return true;
    return Number.parseFloat(item?.price || 0) > 0;
  };

  if (participant.date_of_birth) {
    if (isAdultPortalParticipant(participant, now)) {
      const adultItem = findAdultInventoryItem(items, { preferPaid });
      if (adultItem && itemPassesPaidFilter(adultItem) && participantMatchesAge(participant.date_of_birth, adultItem.age_restriction, now)) {
        return recordAssignment(adultItem);
      }
    }
    for (const item of items) {
      if (!itemPassesPaidFilter(item)) continue;
      if (participantMatchesAge(participant.date_of_birth, item.age_restriction, now)) {
        return recordAssignment(item);
      }
    }
  }

  let unrestrictedItem = null;
  for (const item of items) {
    if (!itemPassesPaidFilter(item)) continue;
    const { hasRestriction } = parseAgeRestriction(item.age_restriction);
    if (!hasRestriction) {
      unrestrictedItem = item;
      break;
    }
  }
  if (unrestrictedItem) {
    return recordAssignment(unrestrictedItem);
  }

  return false;
};

/** Rebuild aggregate ticket counts from per-participant assignments. */
export const ticketCountsFromAssignments = (participantAssignments = {}) => {
  const ticketCounts = {};
  Object.values(participantAssignments).forEach((assignment) => {
    const itemId = assignment?.inventory_item_id;
    if (!itemId) return;
    ticketCounts[itemId] = (ticketCounts[itemId] || 0) + 1;
  });
  return ticketCounts;
};

/** Ensure every participant has exactly one ticket; repair after FWP caps zero out a line. */
export const ensureEachParticipantHasTicket = ({
  participants = [],
  items = [],
  ticketCounts = {},
  participantAssignments = {},
  participantMatchesAge = participantMatchesAgeRestriction,
  now = dayjs(),
} = {}) => {
  const assignments = { ...participantAssignments };
  const counts = { ...ticketCounts };

  participants.forEach((participant) => {
    if (!participant?.id) return;
    const existing = assignments[participant.id];
    const assignedId = existing?.inventory_item_id;
    const assignedQty = assignedId ? (counts[assignedId] || 0) : 0;

    if (assignedId && assignedQty > 0) return;

    delete assignments[participant.id];

    const reassigned = assignParticipantTicketFallback(
      participant,
      items,
      counts,
      assignments,
      { now, participantMatchesAge, preferPaid: true }
    );
    if (!reassigned) {
      assignParticipantTicketFallback(
        participant,
        items,
        counts,
        assignments,
        { now, participantMatchesAge, preferPaid: false }
      );
    }
  });

  return {
    ticketCounts: ticketCountsFromAssignments(assignments),
    participantAssignments: assignments,
  };
};

const formatAgeValue = (value, unit) => {
  if (value == null) return 'any';
  return `${value} ${unit === 'months' ? 'months' : 'years'}`;
};

export const formatAgeRestrictionSummary = (ageRestriction) => {
  const { parsed, hasRestriction } = parseAgeRestriction(ageRestriction);
  if (!hasRestriction || !parsed) return 'Any age';
  if (parsed.max_value == null) {
    return `${formatAgeValue(parsed.min_value ?? 0, parsed.min_unit)}+`;
  }
  return `${formatAgeValue(parsed.min_value ?? 0, parsed.min_unit)} to ${formatAgeValue(parsed.max_value, parsed.max_unit)}`;
};

const buildRuleAgeRestriction = (rule, item) => {
  const useInventoryAgeRestriction = rule?.use_inventory_age_restriction !== false;
  if (useInventoryAgeRestriction) {
    const parsedItem = parseAgeRestriction(item?.age_restriction);
    return parsedItem.hasRestriction ? parsedItem.parsed : null;
  }

  const minValue = toIntOrNull(rule?.min_value);
  const maxValue = toIntOrNull(rule?.max_value);
  const minUnit = rule?.min_unit || 'years';
  const maxUnit = rule?.max_unit || 'years';

  if (minValue == null && maxValue == null) return null;
  return {
    min_value: minValue ?? 0,
    min_unit: minUnit,
    max_value: maxValue,
    max_unit: maxUnit
  };
};

const defaultPriorityForItem = (item, index) => {
  const range = ageRestrictionToMonths(item?.age_restriction);
  if (!range) return DEFAULT_PRIORITY_BASE + index;
  return range.minMonths * 10 + index;
};

export const buildDefaultTicketAssignmentRules = (items = [], existingRules = []) => {
  const existingByItemId = new Map(
    (existingRules || [])
      .filter((rule) => rule?.inventory_item_id)
      .map((rule) => [rule.inventory_item_id, rule])
  );

  return (items || []).map((item, index) => {
    const existing = existingByItemId.get(item.id);
    if (existing) {
      return {
        inventory_item_id: item.id,
        enabled: existing.enabled !== false,
        priority: toIntOrNull(existing.priority) ?? defaultPriorityForItem(item, index),
        use_inventory_age_restriction: existing.use_inventory_age_restriction !== false,
        min_value: toIntOrNull(existing.min_value),
        min_unit: existing.min_unit || 'years',
        max_value: toIntOrNull(existing.max_value),
        max_unit: existing.max_unit || 'years'
      };
    }

    const parsedAge = parseAgeRestriction(item?.age_restriction);
    const price = Number.parseFloat(item?.price || 0);
    const unrestricted = !parsedAge.hasRestriction;

    return {
      inventory_item_id: item.id,
      enabled: !(unrestricted && price <= 0),
      priority: defaultPriorityForItem(item, index),
      use_inventory_age_restriction: true,
      min_value: null,
      min_unit: 'years',
      max_value: null,
      max_unit: 'years'
    };
  });
};

export const normalizeTicketAssignmentRules = (rules = [], items = []) => {
  const itemById = new Map((items || []).map((item) => [item.id, item]));

  return (rules || [])
    .filter((rule) => rule?.inventory_item_id && itemById.has(rule.inventory_item_id))
    .map((rule, index) => {
      const item = itemById.get(rule.inventory_item_id);
      const ageRestriction = buildRuleAgeRestriction(rule, item);
      return {
        inventory_item_id: rule.inventory_item_id,
        enabled: rule.enabled !== false,
        priority: toIntOrNull(rule.priority) ?? defaultPriorityForItem(item, index),
        use_inventory_age_restriction: rule.use_inventory_age_restriction !== false,
        min_value: toIntOrNull(rule.min_value),
        min_unit: rule.min_unit || 'years',
        max_value: toIntOrNull(rule.max_value),
        max_unit: rule.max_unit || 'years',
        item,
        age_restriction: ageRestriction
      };
    })
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return String(a.item?.name || '').localeCompare(String(b.item?.name || ''));
    });
};

export const serializeTicketAssignmentRules = (rules = [], items = []) =>
  normalizeTicketAssignmentRules(rules, items).map((rule) => ({
    inventory_item_id: rule.inventory_item_id,
    enabled: rule.enabled !== false,
    priority: rule.priority,
    use_inventory_age_restriction: rule.use_inventory_age_restriction !== false,
    min_value: rule.use_inventory_age_restriction ? null : toIntOrNull(rule.min_value),
    min_unit: rule.use_inventory_age_restriction ? 'years' : (rule.min_unit || 'years'),
    max_value: rule.use_inventory_age_restriction ? null : toIntOrNull(rule.max_value),
    max_unit: rule.use_inventory_age_restriction ? 'years' : (rule.max_unit || 'years')
  }));

export const hasExplicitTicketAssignmentRules = (ticketSettings) =>
  Array.isArray(ticketSettings?.assignment_rules) && ticketSettings.assignment_rules.length > 0;

const sortItemsForTicketMatching = (items = []) =>
  [...items].sort((a, b) => {
    const restrictionA = parseAgeRestriction(a.age_restriction);
    const restrictionB = parseAgeRestriction(b.age_restriction);
    if (restrictionA.hasRestriction !== restrictionB.hasRestriction) {
      return restrictionA.hasRestriction ? -1 : 1;
    }
    const priceA = Number.parseFloat(a.price || 0);
    const priceB = Number.parseFloat(b.price || 0);
    if ((priceA <= 0) !== (priceB <= 0)) {
      return priceA <= 0 ? 1 : -1;
    }
    return priceA - priceB;
  });

const findAdultTicketForParticipant = (participant, items = [], now = dayjs()) => {
  const adultItem = findAdultInventoryItem(items, { preferPaid: true });
  if (!adultItem) return null;
  if (!participant?.date_of_birth) {
    return isAdultPortalParticipant(participant, now) ? adultItem : null;
  }
  return participantMatchesAgeRestriction(participant.date_of_birth, adultItem.age_restriction, now)
    ? adultItem
    : null;
};

/** Age-appropriate ticket only — never assigns a restricted ticket outside the participant's age band. */
export const findStrictMatchingTicketForParticipant = (
  participant,
  items = [],
  ticketSettings = {},
  now = dayjs()
) => {
  if (!items?.length) return null;

  const sortedItems = sortItemsForTicketMatching(items);

  if (hasExplicitTicketAssignmentRules(ticketSettings)) {
    if (participant?.date_of_birth) {
      const rules = normalizeTicketAssignmentRules(ticketSettings.assignment_rules, sortedItems)
        .filter((rule) => rule.enabled !== false);
      const matchingRule = rules.find((rule) =>
        participantMatchesAgeRestriction(participant.date_of_birth, rule.age_restriction, now)
      );
      if (matchingRule?.item) {
        // Never lock adults onto a $0 "Free - Adult" assignment-rule SKU when a paid
        // adult ticket exists — free-with-purchase grants free seats after assignment.
        const matched = matchingRule.item;
        const matchedPrice = Number.parseFloat(matched.price || 0);
        const matchedLooksFreeAdult =
          matchedPrice <= 0 &&
          (/\badult\b/i.test(String(matched.name || '')) ||
            (ageRestrictionToMonths(matched.age_restriction)?.minMonths ?? 0) >= ADULT_MIN_MONTHS);
        if (matchedLooksFreeAdult) {
          const paidAdult = findAdultTicketForParticipant(participant, sortedItems, now);
          if (paidAdult && Number.parseFloat(paidAdult.price || 0) > 0) {
            return paidAdult;
          }
        }
        return matched;
      }
    }

    const adultTicket = findAdultTicketForParticipant(participant, sortedItems, now);
    if (adultTicket) return adultTicket;

    if (!participant?.date_of_birth) return null;

    for (const item of sortedItems) {
      const { hasRestriction } = parseAgeRestriction(item.age_restriction);
      if (!hasRestriction) continue;
      if (participantMatchesAgeRestriction(participant.date_of_birth, item.age_restriction, now)) {
        return item;
      }
    }

    for (const item of sortedItems) {
      const { hasRestriction } = parseAgeRestriction(item.age_restriction);
      if (!hasRestriction) return item;
    }

    return null;
  }

  if (!participant?.date_of_birth) {
    return findAdultTicketForParticipant(participant, sortedItems, now);
  }

  if (isAdultPortalParticipant(participant, now)) {
    const adultItem = findAdultTicketForParticipant(participant, sortedItems, now);
    if (adultItem) return adultItem;
  }

  for (const item of sortedItems) {
    const { hasRestriction } = parseAgeRestriction(item.age_restriction);
    if (!hasRestriction) continue;
    if (participantMatchesAgeRestriction(participant.date_of_birth, item.age_restriction, now)) {
      return item;
    }
  }

  for (const item of sortedItems) {
    const { hasRestriction } = parseAgeRestriction(item.age_restriction);
    if (!hasRestriction) return item;
  }

  return null;
};

export const assignTicketsToParticipantsStrict = ({
  participants = [],
  items = [],
  ticketSettings = {},
  now = dayjs(),
} = {}) => {
  const participantAssignments = {};
  const unmatched = [];

  (participants || []).forEach((participant) => {
    if (!participant?.id) return;

    const matchingTicket = findStrictMatchingTicketForParticipant(
      participant,
      items,
      ticketSettings,
      now
    );

    if (!matchingTicket) {
      unmatched.push({
        participant,
        reason: participant.date_of_birth ? 'no_matching_ticket' : 'missing_birthdate',
      });
      return;
    }

    participantAssignments[participant.id] = {
      inventory_item_id: matchingTicket.id,
      inventory_item_name: matchingTicket.name || 'Ticket',
    };
  });

  return {
    participantAssignments,
    ticketCounts: ticketCountsFromAssignments(participantAssignments),
    unmatched,
  };
};

export const formatParticipantTicketIssueMessage = (issue) => {
  const name =
    [issue?.participant?.first_name, issue?.participant?.last_name].filter(Boolean).join(' ') ||
    'This participant';

  if (issue?.reason === 'missing_birthdate') {
    return `${name} needs a birthdate before tickets can be assigned. Edit their profile and add a date of birth.`;
  }

  return 'Unfortunately there are no spaces available for this age.';
};

export const summarizeParticipantTicketIssues = (unmatched = []) => {
  if (!Array.isArray(unmatched) || unmatched.length === 0) return null;
  return unmatched.map(formatParticipantTicketIssueMessage).join(' ');
};

const normalizeTriggerIds = (value, itemById) => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((id) => typeof id === 'string' && itemById.has(id))
    .filter((id, index, arr) => arr.indexOf(id) === index);
};

const toPositiveInt = (value, fallback = 1) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return parsed;
};

export const buildDefaultTicketPricingRules = (items = [], existingRules = []) => {
  const existingByItemId = new Map(
    (existingRules || [])
      .filter((rule) => rule?.inventory_item_id)
      .map((rule) => [rule.inventory_item_id, rule])
  );

  return (items || []).map((item) => {
    const existing = existingByItemId.get(item.id);
    if (existing) {
      return {
        inventory_item_id: item.id,
        enabled: existing.enabled === true,
        trigger_item_ids: Array.isArray(existing.trigger_item_ids) ? existing.trigger_item_ids : [],
        trigger_quantity: toPositiveInt(existing.trigger_quantity, 1),
        discounted_quantity: toPositiveInt(existing.discounted_quantity, 1),
        max_discounted_quantity: toIntOrNull(existing.max_discounted_quantity),
        count_paid_triggers_only: existing.count_paid_triggers_only !== false,
        allow_additional_paid_tickets: existing.allow_additional_paid_tickets !== false,
      };
    }

    return {
      inventory_item_id: item.id,
      enabled: false,
      trigger_item_ids: [],
      trigger_quantity: 1,
      discounted_quantity: 1,
      max_discounted_quantity: null,
      count_paid_triggers_only: true,
      allow_additional_paid_tickets: true,
    };
  });
};

export const normalizeTicketPricingRules = (rules = [], items = []) => {
  const itemById = new Map((items || []).map((item) => [item.id, item]));

  return (rules || [])
    .filter((rule) => rule?.inventory_item_id && itemById.has(rule.inventory_item_id))
    .map((rule) => {
      const triggerItemIds = normalizeTriggerIds(rule.trigger_item_ids, itemById);
      const hasSelfTrigger = triggerItemIds.includes(rule.inventory_item_id);
      return {
        inventory_item_id: rule.inventory_item_id,
        enabled: rule.enabled === true,
        trigger_item_ids: triggerItemIds,
        trigger_quantity: toPositiveInt(rule.trigger_quantity, 1),
        discounted_quantity: toPositiveInt(rule.discounted_quantity, 1),
        max_discounted_quantity: toIntOrNull(rule.max_discounted_quantity),
        // Self-trigger rules must use paid triggers only to avoid recursive free loops.
        count_paid_triggers_only: hasSelfTrigger ? true : (rule.count_paid_triggers_only !== false),
        allow_additional_paid_tickets: rule.allow_additional_paid_tickets !== false,
        item: itemById.get(rule.inventory_item_id),
      };
    });
};

export const serializeTicketPricingRules = (rules = [], items = []) =>
  normalizeTicketPricingRules(rules, items).map((rule) => ({
    inventory_item_id: rule.inventory_item_id,
    enabled: rule.enabled === true,
    trigger_item_ids: rule.trigger_item_ids,
    trigger_quantity: rule.trigger_quantity,
    discounted_quantity: rule.discounted_quantity,
    max_discounted_quantity: toIntOrNull(rule.max_discounted_quantity),
    count_paid_triggers_only: rule.count_paid_triggers_only !== false,
    allow_additional_paid_tickets: rule.allow_additional_paid_tickets !== false,
  }));

export const hasConditionalTicketPricingRules = (ticketSettings) =>
  Array.isArray(ticketSettings?.pricing_rules) &&
  ticketSettings.pricing_rules.some(
    (rule) => rule?.enabled === true && Array.isArray(rule.trigger_item_ids) && rule.trigger_item_ids.length > 0
  );

export const calculateTicketPricing = ({
  selectedTickets = {},
  items = [],
  ticketSettings = {},
  legacyPromotions = [],
  priceOverridesByItemId = {},
} = {}) => {
  const itemById = new Map((items || []).map((item) => [item.id, item]));
  const normalizedPricingRules = normalizeTicketPricingRules(ticketSettings?.pricing_rules || [], items)
    .filter((rule) => rule.enabled === true && rule.trigger_item_ids.length > 0);

  let freeQuantitiesByItem = {};
  let appliedPricingRules = [];

  if (normalizedPricingRules.length > 0) {
    let previousSerialized = null;
    for (let pass = 0; pass < 8; pass += 1) {
      const paidQuantitiesForPass = {};
      Object.entries(selectedTickets).forEach(([inventoryItemId, quantity]) => {
        paidQuantitiesForPass[inventoryItemId] = Math.max(
          0,
          (quantity || 0) - (freeQuantitiesByItem[inventoryItemId] || 0)
        );
      });

      const nextFreeQuantities = {};
      const nextAppliedRules = [];

      normalizedPricingRules.forEach((rule) => {
        const selectedQty = selectedTickets[rule.inventory_item_id] || 0;
        if (selectedQty <= 0) return;

        const hasSelfTrigger = rule.trigger_item_ids.includes(rule.inventory_item_id);
        const nonSelfTriggerIds = rule.trigger_item_ids.filter((id) => id !== rule.inventory_item_id);
        const triggerSource = rule.count_paid_triggers_only !== false
          ? paidQuantitiesForPass
          : selectedTickets;
        const externalTriggerCount = nonSelfTriggerIds.reduce(
          (sum, triggerId) => sum + (triggerSource[triggerId] || 0),
          0
        );

        const externalAllowance = Math.floor(externalTriggerCount / rule.trigger_quantity) * rule.discounted_quantity;
        let allowedFreeQty = externalAllowance;
        if (hasSelfTrigger) {
          const bundleSize = rule.trigger_quantity + rule.discounted_quantity;
          if (bundleSize > 0) {
            const selfAllowance = Math.floor(selectedQty / bundleSize) * rule.discounted_quantity;
            // Prevent mixed self-trigger rules from double-counting the same ticket pool.
            // Example: 2 infants + 1 older child should allow 1 free infant, not 2.
            allowedFreeQty = Math.max(externalAllowance, selfAllowance);
          }
        }
        if (allowedFreeQty <= 0) return;

        if (rule.max_discounted_quantity != null && rule.max_discounted_quantity >= 0) {
          allowedFreeQty = Math.min(allowedFreeQty, rule.max_discounted_quantity);
        }

        const freeQty = Math.min(selectedQty, allowedFreeQty);
        if (freeQty <= 0) return;

        nextFreeQuantities[rule.inventory_item_id] = freeQty;
        nextAppliedRules.push({
          inventory_item_id: rule.inventory_item_id,
          trigger_item_ids: rule.trigger_item_ids,
          trigger_quantity: rule.trigger_quantity,
          discounted_quantity: rule.discounted_quantity,
          free_quantity: freeQty,
          count_paid_triggers_only: rule.count_paid_triggers_only !== false,
        });
      });

      const nextSerialized = JSON.stringify(nextFreeQuantities);
      if (nextSerialized === previousSerialized) {
        freeQuantitiesByItem = nextFreeQuantities;
        appliedPricingRules = nextAppliedRules;
        break;
      }

      freeQuantitiesByItem = nextFreeQuantities;
      appliedPricingRules = nextAppliedRules;
      previousSerialized = nextSerialized;
    }
  } else if (Array.isArray(legacyPromotions) && legacyPromotions.length > 0) {
    legacyPromotions.forEach((promo) => {
      const triggerIds = Array.isArray(promo.trigger_item_ids)
        ? promo.trigger_item_ids.filter((id) => itemById.has(id))
        : [];
      const triggerCount = triggerIds.reduce((sum, tid) => sum + (selectedTickets[tid] || 0), 0);
      const freeFromThisPromo = (promo.quantity ?? 1) * triggerCount;
      if (freeFromThisPromo > 0 && promo.free_item_id && itemById.has(promo.free_item_id)) {
        freeQuantitiesByItem[promo.free_item_id] = (freeQuantitiesByItem[promo.free_item_id] || 0) + freeFromThisPromo;
      }
    });
  }

  Object.keys(freeQuantitiesByItem).forEach((itemId) => {
    const selectedQty = selectedTickets[itemId] || 0;
    freeQuantitiesByItem[itemId] = Math.min(selectedQty, freeQuantitiesByItem[itemId] || 0);
  });

  const paidQuantitiesByItem = {};
  const lineItems = Object.entries(selectedTickets)
    .filter(([, quantity]) => (quantity || 0) > 0)
    .map(([inventoryItemId, quantity]) => {
      const item = itemById.get(inventoryItemId);
      const basePrice = Number.parseFloat(item?.price || 0) || 0;
      const unitPrice = priceOverridesByItemId[inventoryItemId] != null
        ? Number.parseFloat(priceOverridesByItemId[inventoryItemId]) || 0
        : basePrice;
      const freeQty = Math.min(quantity || 0, freeQuantitiesByItem[inventoryItemId] || 0);
      const paidQty = Math.max(0, (quantity || 0) - freeQty);
      const subtotal = unitPrice * paidQty;
      paidQuantitiesByItem[inventoryItemId] = paidQty;
      return {
        inventory_item_id: inventoryItemId,
        item,
        quantity: quantity || 0,
        free_quantity: freeQty,
        paid_quantity: paidQty,
        unit_price: unitPrice,
        subtotal,
      };
    });

  const total = lineItems.reduce((sum, line) => sum + line.subtotal, 0);

  return {
    pricingRulesApplied: normalizedPricingRules.length > 0,
    freeQuantitiesByItem,
    paidQuantitiesByItem,
    lineItems,
    appliedPricingRules,
    total,
  };
};

export const assignTicketsByRules = ({
  participants = [],
  items = [],
  ticketSettings = {}
} = {}) => {
  const normalizedRules = normalizeTicketAssignmentRules(ticketSettings?.assignment_rules || [], items)
    .filter((rule) => rule.enabled !== false);

  if (normalizedRules.length === 0) {
    return {
      usedExplicitRules: false,
      ticketCounts: {},
      participantAssignments: {},
      unmatchedParticipantIds: []
    };
  }

  const participantAssignments = {};
  const ticketCounts = {};
  const unmatchedParticipantIds = [];

  const ruleItems = normalizedRules.map((rule) => rule.item).filter(Boolean);

  participants.forEach((participant) => {
    if (!participant?.id) return;

    if (!participant.date_of_birth) {
      if (isAdultPortalParticipant(participant)) {
        const adultItem = findAdultInventoryItem(ruleItems, { preferPaid: true });
        if (adultItem) {
          participantAssignments[participant.id] = {
            inventory_item_id: adultItem.id,
            inventory_item_name: adultItem.name || 'Ticket',
          };
          ticketCounts[adultItem.id] = (ticketCounts[adultItem.id] || 0) + 1;
          return;
        }
      }
      unmatchedParticipantIds.push(participant.id);
      return;
    }

    const matchingRule = normalizedRules.find((rule) =>
      participantMatchesAgeRestriction(participant.date_of_birth, rule.age_restriction)
    );

    if (!matchingRule) {
      unmatchedParticipantIds.push(participant.id);
      return;
    }

    let assignedItem = matchingRule.item;
    const matchedPrice = Number.parseFloat(assignedItem?.price || 0);
    const matchedLooksFreeAdult =
      matchedPrice <= 0 &&
      (/\badult\b/i.test(String(assignedItem?.name || '')) ||
        (ageRestrictionToMonths(assignedItem?.age_restriction)?.minMonths ?? 0) >= ADULT_MIN_MONTHS);
    if (matchedLooksFreeAdult) {
      const paidAdult = findAdultInventoryItem(ruleItems, { preferPaid: true });
      if (paidAdult && Number.parseFloat(paidAdult.price || 0) > 0) {
        assignedItem = paidAdult;
      }
    }

    const assignedItemId = assignedItem?.id || matchingRule.inventory_item_id;
    participantAssignments[participant.id] = {
      inventory_item_id: assignedItemId,
      inventory_item_name: assignedItem?.name || matchingRule.item?.name || 'Ticket',
      rule_priority: matchingRule.priority
    };
    ticketCounts[assignedItemId] = (ticketCounts[assignedItemId] || 0) + 1;
  });

  return {
    usedExplicitRules: true,
    rules: normalizedRules,
    ticketCounts,
    participantAssignments,
    unmatchedParticipantIds
  };
};

/** Parse activity `ticket_settings` (object or JSON string). */
export const parseActivityTicketSettings = (raw) => {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' ? raw : {};
};

/**
 * Resolve POS inventory IDs used as online tickets for an activity.
 * Prefers `inventory_item_ids`, then falls back to assignment/pricing rules.
 * Optionally merges free-with-purchase free SKUs so staff can assign them.
 */
export const resolveTicketInventoryItemIds = (ticketSettings, options = {}) => {
  const parsed = parseActivityTicketSettings(ticketSettings);
  const direct = Array.isArray(parsed.inventory_item_ids)
    ? parsed.inventory_item_ids.filter(Boolean)
    : [];
  let ids = direct.length > 0
    ? [...new Set(direct)]
    : [...new Set(
      [
        ...(Array.isArray(parsed.assignment_rules) ? parsed.assignment_rules : []),
        ...(Array.isArray(parsed.pricing_rules) ? parsed.pricing_rules : []),
      ]
        .map((rule) => rule?.inventory_item_id)
        .filter(Boolean)
    )];

  const extra = Array.isArray(options.extraInventoryItemIds)
    ? options.extraInventoryItemIds.filter(Boolean)
    : [];
  if (extra.length > 0) {
    ids = [...new Set([...ids, ...extra])];
  }

  return ids;
};

/**
 * Free-with-purchase free item IDs that should appear in staff ticket pickers
 * when their trigger tickets are already on the activity.
 */
export const collectRelatedFwpFreeItemIds = (inventoryItemIds = [], promotions = []) => {
  const linked = new Set((inventoryItemIds || []).filter(Boolean).map(String));
  if (linked.size === 0) return [];
  const freeIds = [];
  (promotions || []).forEach((promo) => {
    const freeId = String(promo?.free_item_id || '').trim();
    if (!freeId || linked.has(freeId)) return;
    const triggers = Array.isArray(promo?.trigger_item_ids) ? promo.trigger_item_ids : [];
    if (triggers.some((id) => linked.has(String(id)))) {
      freeIds.push(freeId);
    }
  });
  return [...new Set(freeIds)];
};

/**
 * When free-with-purchase free adult SKUs are on the activity, also pull paid adult
 * fallback SKUs so extras can be charged instead of staying on $0 free tickets.
 */
export const collectPaidAdultFallbackItemIds = (inventoryItems = [], allBusinessAdultItems = []) => {
  const loaded = Array.isArray(inventoryItems) ? inventoryItems : [];
  const hasFreeAdult = loaded.some(
    (item) =>
      Number.parseFloat(item?.price || 0) <= 0 &&
      /\badult\b/i.test(String(item?.name || '')),
  );
  if (!hasFreeAdult) return [];

  const loadedIds = new Set(loaded.map((item) => String(item.id)));
  return (allBusinessAdultItems || [])
    .filter((item) => {
      if (!item?.id || loadedIds.has(String(item.id))) return false;
      if (Number.parseFloat(item.price || 0) <= 0) return false;
      const range = ageRestrictionToMonths(item.age_restriction);
      const nameLooksAdult = /\badult\b/i.test(String(item.name || ''));
      return nameLooksAdult || (range && range.minMonths >= ADULT_MIN_MONTHS);
    })
    .map((item) => item.id);
};

/**
 * Min/max ticket limits by channel.
 * - online: only when enforce_online_only !== false (default)
 * - staff: always applies min/max when configured
 */
export const getActivityTicketLimits = (ticketSettings, channel = 'online') => {
  const parsed = parseActivityTicketSettings(ticketSettings);
  const minTickets = toIntOrNull(parsed.min_tickets);
  const maxTickets = toIntOrNull(parsed.max_tickets);

  if (channel === 'staff') {
    const hasLimits = minTickets != null || maxTickets != null;
    return {
      minTickets,
      maxTickets,
      enforced: hasLimits
    };
  }

  if (parsed.enforce_online_only === false) {
    return { minTickets: null, maxTickets: null, enforced: false };
  }
  return {
    minTickets,
    maxTickets,
    enforced: minTickets != null || maxTickets != null
  };
};

/** @deprecated use getActivityTicketLimits(settings, 'online') */
export const getOnlineTicketLimits = (ticketSettings) => getActivityTicketLimits(ticketSettings, 'online');

export const formatTicketLimitsSummary = (limits = {}) => {
  const { minTickets, maxTickets } = limits;
  if (minTickets != null && maxTickets != null && minTickets === maxTickets) {
    return `${minTickets} ticket${minTickets === 1 ? '' : 's'} per booking`;
  }
  if (minTickets != null && maxTickets != null) {
    return `${minTickets}–${maxTickets} tickets per booking`;
  }
  if (maxTickets != null) {
    return `Up to ${maxTickets} ticket${maxTickets === 1 ? '' : 's'} per booking`;
  }
  if (minTickets != null) {
    return `At least ${minTickets} ticket${minTickets === 1 ? '' : 's'} per booking`;
  }
  return null;
};

export const validateParticipantCountAgainstTicketLimits = (count, limits = {}, { override = false } = {}) => {
  if (override) return { ok: true };
  const n = Number(count) || 0;
  const { minTickets, maxTickets } = limits;

  if (maxTickets != null && n > maxTickets) {
    return {
      ok: false,
      message: `Maximum ${maxTickets} ticket${maxTickets === 1 ? '' : 's'} allowed per booking`
    };
  }
  if (minTickets != null && n < minTickets) {
    return {
      ok: false,
      message: `At least ${minTickets} ticket${minTickets === 1 ? '' : 's'} required per booking`
    };
  }
  return { ok: true };
};

/**
 * Remap paid adult seats onto free-with-purchase free tickets (same rules as online portal).
 * Example: 2× Ages 2–17 → up to 2× Free Adult; extra adults stay on the paid adult SKU.
 *
 * Always starts adults on a paid adult ticket when one exists, then grants free seats only
 * up to the promotion allowance — so a $0 "Free - Adult" SKU cannot make every adult free.
 */
export const applyFreeWithPurchaseTicketAssignments = ({
  participants = [],
  items = [],
  participantAssignments = {},
  ticketCounts = {},
  promotions = [],
} = {}) => {
  const itemById = new Map((items || []).map((item) => [item.id, item]));
  const nextAssignments = { ...(participantAssignments || {}) };
  const nextCounts = { ...(ticketCounts || {}) };
  const promos = Array.isArray(promotions) ? promotions : [];

  if (promos.length === 0 || Object.keys(nextAssignments).length === 0) {
    return {
      participantAssignments: nextAssignments,
      ticketCounts: nextCounts,
      freeAllowanceByItem: {},
    };
  }

  const freeItemIds = new Set(
    promos.map((promo) => String(promo?.free_item_id || '').trim()).filter(Boolean),
  );
  const paidAdultItem = findAdultInventoryItem(items, { preferPaid: true });

  const adultParticipants = (participants || []).filter((participant) => {
    if (!participant?.id || !nextAssignments[participant.id]) return false;
    return isAdultPortalParticipant(participant);
  });

  const moveAdultToItem = (participant, targetItem) => {
    if (!participant?.id || !targetItem?.id) return;
    const current = nextAssignments[participant.id];
    const currentItemId = current?.inventory_item_id;
    if (!currentItemId || currentItemId === targetItem.id) return;

    nextCounts[currentItemId] = Math.max(0, (nextCounts[currentItemId] || 0) - 1);
    if (nextCounts[currentItemId] <= 0) delete nextCounts[currentItemId];
    nextCounts[targetItem.id] = (nextCounts[targetItem.id] || 0) + 1;
    nextAssignments[participant.id] = {
      inventory_item_id: targetItem.id,
      inventory_item_name: targetItem.name || 'Adult',
      ...(Number.parseFloat(targetItem.price || 0) <= 0 ? { free_with_purchase: true } : {}),
    };
    if (Number.parseFloat(targetItem.price || 0) > 0) {
      delete nextAssignments[participant.id].free_with_purchase;
    }
  };

  // 1) Park every adult on a paid adult ticket first (when one exists).
  if (paidAdultItem && Number.parseFloat(paidAdultItem.price || 0) > 0) {
    adultParticipants.forEach((participant) => {
      const currentItemId = nextAssignments[participant.id]?.inventory_item_id;
      if (!currentItemId) return;
      if (!freeItemIds.has(String(currentItemId)) && Number.parseFloat(itemById.get(currentItemId)?.price || 0) > 0) {
        return;
      }
      moveAdultToItem(participant, paidAdultItem);
    });
  }

  const freeAllowanceByItem = {};
  promos.forEach((promo) => {
    const freeItemId = promo?.free_item_id;
    if (!freeItemId || !itemById.has(freeItemId)) return;
    const triggerIds = Array.isArray(promo.trigger_item_ids) ? promo.trigger_item_ids : [];
    const triggerCount = triggerIds.reduce((sum, tid) => sum + (nextCounts[tid] || 0), 0);
    if (triggerCount <= 0) return;
    const qty = Math.max(1, Number.parseInt(promo.quantity, 10) || 1);
    freeAllowanceByItem[freeItemId] = (freeAllowanceByItem[freeItemId] || 0) + qty * triggerCount;
  });

  const remainingFree = { ...freeAllowanceByItem };

  // 2) Grant free seats only up to the earned allowance.
  adultParticipants.forEach((participant) => {
    const current = nextAssignments[participant.id];
    const currentItemId = current?.inventory_item_id;
    if (!currentItemId) return;

    const freeItemId = Object.keys(remainingFree).find((candidateId) => {
      if ((remainingFree[candidateId] || 0) <= 0) return false;
      const freeItem = itemById.get(candidateId);
      if (!freeItem) return false;
      if (currentItemId === candidateId) return true;
      const currentPrice = Number.parseFloat(itemById.get(currentItemId)?.price || 0);
      if (currentPrice <= 0) return false;
      if (participant.date_of_birth) {
        return participantMatchesAgeRestriction(participant.date_of_birth, freeItem.age_restriction);
      }
      return isAdultPortalParticipant(participant);
    });

    if (!freeItemId) return;
    if (currentItemId === freeItemId) {
      remainingFree[freeItemId] -= 1;
      nextAssignments[participant.id] = {
        ...current,
        free_with_purchase: true,
      };
      return;
    }

    moveAdultToItem(participant, itemById.get(freeItemId));
    remainingFree[freeItemId] -= 1;
  });

  // 3) Keep only `allowance` adults on each free SKU; demote the rest to paid adult.
  if (paidAdultItem && Number.parseFloat(paidAdultItem.price || 0) > 0) {
    Object.keys(freeAllowanceByItem).forEach((freeItemId) => {
      const allowance = freeAllowanceByItem[freeItemId] || 0;
      const onFree = adultParticipants.filter(
        (p) => nextAssignments[p.id]?.inventory_item_id === freeItemId,
      );
      onFree.forEach((participant, index) => {
        if (index < allowance) {
          nextAssignments[participant.id] = {
            ...nextAssignments[participant.id],
            free_with_purchase: true,
          };
          return;
        }
        moveAdultToItem(participant, paidAdultItem);
      });
    });
  }

  return {
    participantAssignments: nextAssignments,
    ticketCounts: nextCounts,
    freeAllowanceByItem,
  };
};

/** Trim pre-selected participants when max tickets is lower (e.g. saved session had 2, max is now 1). */
export const clampParticipantIdsToTicketLimits = (selectedIds, limits = {}) => {
  const ids = Array.isArray(selectedIds) ? [...selectedIds] : [];
  const max = limits?.maxTickets;
  if (max != null && ids.length > max) {
    return ids.slice(0, max);
  }
  return ids;
};
