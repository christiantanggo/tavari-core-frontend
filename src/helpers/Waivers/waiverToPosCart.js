import { supabase } from '../../supabaseClient';
import {
  assignTicketsToParticipantsStrict,
  applyFreeWithPurchaseTicketAssignments,
  summarizeParticipantTicketIssues,
} from '../../utils/bookingTicketAssignment';
import {
  isWaiverAdditionalAdultParticipant,
  isWaiverMinorParticipant,
} from '../../utils/waiverParticipantClassification';

function personIdentityKey(person) {
  const first = String(person?.first_name || '').trim().toLowerCase();
  const last = String(person?.last_name || '').trim().toLowerCase();
  const dob =
    person?.date_of_birth != null && String(person.date_of_birth).trim()
      ? String(person.date_of_birth).trim().split('T')[0]
      : '';
  return `${first}|${last}|${dob}`;
}

function waiverSignerLabel(waiver) {
  return [waiver?.first_name, waiver?.last_name].filter(Boolean).join(' ').trim() || 'Waiver';
}

/**
 * Build person rows from a signed waiver for POS ticket assignment.
 * Skips legacy count-only minors (no name/DOB).
 * Adds waiver context + a unique selectionKey for multi-waiver carts.
 */
export function buildWaiverPeopleForPosCart(waiver) {
  if (!waiver) return [];

  const threshold =
    waiver?.waiver_templates?.minor_age_threshold ??
    waiver?.minor_age_threshold ??
    18;

  const parts = Array.isArray(waiver.waiver_participants) ? waiver.waiver_participants : [];
  const people = [];
  const seen = new Set();
  const waiverLabel = waiverSignerLabel(waiver);

  const pushPerson = (person) => {
    if (!person?.id || seen.has(person.id)) return;
    if (person._legacyCountOnly || person._legacyPlaceholder) return;
    seen.add(person.id);
    const selectionKey = `w:${waiver.id}:${person.id}`;
    people.push({
      ...person,
      id: selectionKey,
      source_participant_id: person.id,
      waiver_id: waiver.id,
      waiver_customer_id: waiver.customer_id || null,
      waiver_label: waiverLabel,
      selectionKey,
    });
  };

  const primaryPart = parts.find(
    (p) => String(p.participant_type || '').toLowerCase() === 'primary',
  );

  if (primaryPart) {
    pushPerson({
      ...primaryPart,
      date_of_birth: primaryPart.date_of_birth || waiver.date_of_birth || null,
      first_name: primaryPart.first_name || waiver.first_name || '',
      last_name: primaryPart.last_name || waiver.last_name || '',
      email: primaryPart.email || waiver.email || null,
      phone_number: primaryPart.phone_number || waiver.phone_number || null,
      participant_type: 'primary',
    });
  } else {
    const syntheticId = `primary:${waiver.id}`;
    pushPerson({
      id: syntheticId,
      first_name: waiver.first_name || '',
      last_name: waiver.last_name || '',
      date_of_birth: waiver.date_of_birth || null,
      participant_type: 'primary',
      email: waiver.email || null,
      phone_number: waiver.phone_number || null,
    });
  }

  parts.forEach((p) => {
    const type = String(p.participant_type || '').toLowerCase().replace(/\s+/g, '_');
    if (type === 'primary') return;
    if (isWaiverMinorParticipant(p, threshold)) {
      pushPerson({ ...p, participant_type: 'minor' });
      return;
    }
    if (isWaiverAdditionalAdultParticipant(p) || type === 'adult' || type === 'additional_adult') {
      pushPerson({ ...p, participant_type: 'additional_adult' });
      return;
    }
    // Unknown type with no minor signal — treat as adult so they still get a ticket seat.
    pushPerson({ ...p, participant_type: 'additional_adult' });
  });

  return people;
}

/**
 * Build the POS person row for a dashboard checkbox selection.
 * Uses the same subjectType the UI used so selection cannot be lost on rematch.
 */
export function resolvePosPersonFromWaiverCheckbox(
  waiver,
  waiverParticipantId,
  subjectType,
) {
  if (!waiver?.id) return null;

  const waiverLabel = waiverSignerLabel(waiver);
  const parts = Array.isArray(waiver.waiver_participants) ? waiver.waiver_participants : [];
  const pidRaw =
    waiverParticipantId != null && String(waiverParticipantId).trim() !== ''
      ? String(waiverParticipantId)
      : null;
  const pid = pidRaw && pidRaw !== 'primary' ? pidRaw : null;

  const toPosPerson = (raw, participantType, sourceId) => {
    const id = sourceId || raw?.id;
    if (!id) return null;
    return {
      ...(raw || {}),
      id: `w:${waiver.id}:${id}`,
      source_participant_id: id,
      first_name: raw?.first_name || '',
      last_name: raw?.last_name || '',
      date_of_birth: raw?.date_of_birth || null,
      email: raw?.email || null,
      phone_number: raw?.phone_number || null,
      participant_type: participantType,
      waiver_id: waiver.id,
      waiver_customer_id: waiver.customer_id || null,
      waiver_label: waiverLabel,
      selectionKey: `w:${waiver.id}:${id}`,
    };
  };

  if (subjectType === 'primary_signer') {
    const primaryPart =
      (pid && parts.find((p) => String(p.id) === pid)) ||
      parts.find((p) => String(p.participant_type || '').toLowerCase() === 'primary') ||
      null;
    if (primaryPart) {
      return toPosPerson(
        {
          ...primaryPart,
          first_name: primaryPart.first_name || waiver.first_name || '',
          last_name: primaryPart.last_name || waiver.last_name || '',
          date_of_birth: primaryPart.date_of_birth || waiver.date_of_birth || null,
          email: primaryPart.email || waiver.email || null,
          phone_number: primaryPart.phone_number || waiver.phone_number || null,
        },
        'primary',
        primaryPart.id,
      );
    }
    return toPosPerson(
      {
        first_name: waiver.first_name || '',
        last_name: waiver.last_name || '',
        date_of_birth: waiver.date_of_birth || null,
        email: waiver.email || null,
        phone_number: waiver.phone_number || null,
      },
      'primary',
      `primary:${waiver.id}`,
    );
  }

  if (!pid) return null;
  const part = parts.find((p) => String(p.id) === pid);
  if (!part) return null;

  const participantType = subjectType === 'minor' ? 'minor' : 'additional_adult';
  return toPosPerson(part, participantType, part.id);
}

/**
 * Merge people from multiple waivers into one POS party.
 * By default does NOT drop distinct seats — callers that need identity dedupe can opt in.
 */
export function buildPeopleFromWaiversForPosCart(waivers = [], { dedupeByIdentity = false } = {}) {
  const list = [];
  const seenIdentity = new Set();

  (Array.isArray(waivers) ? waivers : []).forEach((waiver) => {
    buildWaiverPeopleForPosCart(waiver).forEach((person) => {
      if (dedupeByIdentity) {
        const identity = personIdentityKey(person);
        if (identity !== '||' && seenIdentity.has(identity)) return;
        if (identity !== '||') seenIdentity.add(identity);
      }
      list.push(person);
    });
  });

  return list;
}

export function groupPosPeopleByWaiver(people = []) {
  const groups = [];
  const byWaiver = new Map();

  (people || []).forEach((person) => {
    const waiverId = person.waiver_id || 'unknown';
    if (!byWaiver.has(waiverId)) {
      const group = {
        waiverId,
        waiverLabel: person.waiver_label || 'Waiver',
        people: [],
      };
      byWaiver.set(waiverId, group);
      groups.push(group);
    }
    byWaiver.get(waiverId).people.push(person);
  });

  return groups;
}

export function waiverPersonDisplayName(person, fallback = 'Guest') {
  const name = [person?.first_name, person?.last_name].filter(Boolean).join(' ').trim();
  return name || fallback;
}

export function buildLoyaltyCustomerFromWaiver(waiver) {
  if (!waiver) return { id: null, customer_name: 'Guest' };
  const customerName =
    [waiver.first_name, waiver.last_name].filter(Boolean).join(' ').trim() || 'Guest';
  return {
    id: waiver.customer_id || null,
    customer_name: customerName,
    customer_email: waiver.email || null,
    customer_phone: waiver.phone_number || null,
  };
}

export function resolveLoyaltyCustomerFromSelectedPeople(selectedPeople = [], focusWaiver = null) {
  if (focusWaiver?.customer_id) {
    return buildLoyaltyCustomerFromWaiver(focusWaiver);
  }

  const withCustomer = (selectedPeople || []).find((p) => p.waiver_customer_id);
  if (withCustomer) {
    return {
      id: withCustomer.waiver_customer_id,
      customer_name: withCustomer.waiver_label || waiverPersonDisplayName(withCustomer),
      customer_email: withCustomer.email || null,
      customer_phone: withCustomer.phone_number || null,
    };
  }

  const first = selectedPeople?.[0];
  if (first) {
    return {
      id: null,
      customer_name: first.waiver_label || waiverPersonDisplayName(first),
      customer_email: first.email || null,
      customer_phone: first.phone_number || null,
    };
  }

  return buildLoyaltyCustomerFromWaiver(focusWaiver);
}

const LOYALTY_ACCOUNT_SELECT =
  'id, customer_name, customer_email, customer_phone, balance, points, store_credit, is_active';

function normalizePhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Resolve one loyalty account the same way waiver detail does:
 * linked customer_id → email → phone → name.
 */
async function findLoyaltyAccount(queryBuilder) {
  const { data, error } = await queryBuilder.limit(1);
  if (!error && data?.[0]?.id) return data[0];
  return null;
}

async function resolveOneLoyaltyAccountForAdult({ businessId, customerId, email, phone, name }) {
  if (!businessId) return null;

  if (customerId) {
    const { data, error } = await supabase
      .from('pos_loyalty_accounts')
      .select(LOYALTY_ACCOUNT_SELECT)
      .eq('id', customerId)
      .eq('business_id', businessId)
      .eq('is_active', true)
      .maybeSingle();
    if (!error && data?.id) return data;
  }

  const emailNorm = String(email || '').trim();
  if (emailNorm) {
    const match = await findLoyaltyAccount(
      supabase
        .from('pos_loyalty_accounts')
        .select(LOYALTY_ACCOUNT_SELECT)
        .eq('business_id', businessId)
        .eq('is_active', true)
        .ilike('customer_email', emailNorm),
    );
    if (match) return match;
  }

  const phoneDigits = normalizePhoneDigits(phone);
  if (phoneDigits.length >= 7) {
    const suffix = phoneDigits.slice(-7);
    const match = await findLoyaltyAccount(
      supabase
        .from('pos_loyalty_accounts')
        .select(LOYALTY_ACCOUNT_SELECT)
        .eq('business_id', businessId)
        .eq('is_active', true)
        .ilike('customer_phone', `%${suffix}%`),
    );
    if (match) return match;
  }

  const nameNorm = String(name || '').trim();
  if (nameNorm && nameNorm.toLowerCase() !== 'guest') {
    const match = await findLoyaltyAccount(
      supabase
        .from('pos_loyalty_accounts')
        .select(LOYALTY_ACCOUNT_SELECT)
        .eq('business_id', businessId)
        .eq('is_active', true)
        .ilike('customer_name', `%${nameNorm}%`),
    );
    if (match) return match;
  }

  return null;
}

/**
 * Adults on the POS party who have a loyalty account (by waiver link, email, phone, or name).
 * Used so staff can redirect earn points to a different adult on the sale.
 */
export async function resolveLoyaltyCandidatesForPosParty({
  selectedPeople = [],
  waivers = [],
  businessId,
} = {}) {
  if (!businessId) return [];

  const adults = (selectedPeople || []).filter(
    (p) => p && String(p.participant_type || '').toLowerCase() !== 'minor',
  );
  if (adults.length === 0) return [];

  const waiverById = new Map(
    (Array.isArray(waivers) ? waivers : [])
      .filter((w) => w?.id)
      .map((w) => [w.id, w]),
  );

  const byId = new Map();

  for (const adult of adults) {
    const waiver = waiverById.get(adult.waiver_id) || null;
    const customerId =
      adult.waiver_customer_id ||
      adult.customer_id ||
      waiver?.customer_id ||
      null;
    const email = adult.email || waiver?.email || null;
    const phone = adult.phone_number || waiver?.phone_number || null;
    const name =
      waiverPersonDisplayName(adult, '') ||
      [waiver?.first_name, waiver?.last_name].filter(Boolean).join(' ').trim() ||
      adult.waiver_label ||
      '';

    const account = await resolveOneLoyaltyAccountForAdult({
      businessId,
      customerId,
      email,
      phone,
      name,
    });
    if (account?.id) byId.set(account.id, account);
  }

  return [...byId.values()].sort((a, b) =>
    String(a.customer_name || '').localeCompare(String(b.customer_name || '')),
  );
}

/** Load a full loyalty account row for cart attach / switch. */
export async function loadLoyaltyAccountForPos(businessId, customerId) {
  if (!businessId || !customerId) return null;
  const { data, error } = await supabase
    .from('pos_loyalty_accounts')
    .select('*')
    .eq('business_id', businessId)
    .eq('id', customerId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export function getPosPersonCheckInLookup(person) {
  const subjectType =
    person.participant_type === 'primary'
      ? 'primary_signer'
      : person.participant_type === 'minor'
        ? 'minor'
        : 'additional_adult';
  const sourceId = person.source_participant_id || person.id;
  const waiverParticipantId =
    person.participant_type === 'primary' && String(sourceId).startsWith('primary:')
      ? null
      : sourceId;
  return {
    waiverId: person.waiver_id,
    waiverParticipantId,
    subjectType,
  };
}

export async function loadFreeWithPurchasePromotions(businessId) {
  if (!businessId) return [];
  const { data, error } = await supabase
    .from('pos_free_with_purchase_promotions')
    .select('id, business_id, quantity, free_item_id, trigger_item_ids')
    .eq('business_id', businessId);
  if (error) throw error;
  return data || [];
}

/**
 * Admission pricing items plus FWP free SKUs (e.g. Free - Adult) so walk-in
 * ticket assignment can mirror the online portal catalog.
 */
export async function loadAdmissionInventoryForPos(businessId, promotions = []) {
  if (!businessId) return [];

  const { data: admissionItems, error } = await supabase
    .from('pos_inventory')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .eq('website_show_admission_pricing', true)
    .order('name');

  if (error) throw error;

  const byId = new Map((admissionItems || []).map((item) => [item.id, item]));
  const extraIds = [];
  (promotions || []).forEach((promo) => {
    if (promo?.free_item_id && !byId.has(promo.free_item_id)) {
      extraIds.push(promo.free_item_id);
    }
    (Array.isArray(promo?.trigger_item_ids) ? promo.trigger_item_ids : []).forEach((id) => {
      if (id && !byId.has(id)) extraIds.push(id);
    });
  });

  const uniqueExtraIds = [...new Set(extraIds)];
  if (uniqueExtraIds.length > 0) {
    const { data: extraItems, error: extraError } = await supabase
      .from('pos_inventory')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .in('id', uniqueExtraIds);
    if (extraError) throw extraError;
    (extraItems || []).forEach((item) => byId.set(item.id, item));
  }

  return [...byId.values()].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || '')),
  );
}

/**
 * Assign age-matched admission tickets (with free-with-purchase) and build POS cart lines.
 */
export function buildPosCartLinesFromAssignments({
  people = [],
  inventoryItems = [],
  ticketSettings = {},
  promotions = [],
} = {}) {
  if (!people.length) {
    return { ok: false, message: 'Select at least one person to send to POS.' };
  }
  if (!inventoryItems.length) {
    return {
      ok: false,
      message:
        'No admission tickets are configured. Mark walk-in tickets with “Show on admission pricing page” in Inventory.',
    };
  }

  const strict = assignTicketsToParticipantsStrict({
    participants: people,
    items: inventoryItems,
    ticketSettings,
  });

  if (strict.unmatched.length > 0) {
    return {
      ok: false,
      message: summarizeParticipantTicketIssues(strict.unmatched),
      unmatched: strict.unmatched,
      participantAssignments: strict.participantAssignments,
      ticketCounts: strict.ticketCounts,
    };
  }

  const withFwp = applyFreeWithPurchaseTicketAssignments({
    participants: people,
    items: inventoryItems,
    participantAssignments: strict.participantAssignments,
    ticketCounts: strict.ticketCounts,
    promotions,
  });

  const itemsById = new Map(inventoryItems.map((item) => [item.id, item]));
  const cartItems = [];

  Object.entries(withFwp.ticketCounts || {}).forEach(([inventoryId, qty]) => {
    const item = itemsById.get(inventoryId);
    const quantity = Math.max(0, Number(qty) || 0);
    if (!item || quantity <= 0) return;
    cartItems.push({
      ...item,
      quantity,
    });
  });

  if (cartItems.length === 0) {
    return { ok: false, message: 'Could not build cart tickets for the selected people.' };
  }

  return {
    ok: true,
    cartItems,
    assignments: withFwp.participantAssignments,
    ticketCounts: withFwp.ticketCounts,
    unmatched: [],
  };
}
