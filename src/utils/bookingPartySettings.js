import dayjs from 'dayjs';
import { participantAgeInMonths, parseActivityTicketSettings } from './bookingTicketAssignment';
import { participantTypeKey } from './waiverParticipantClassification';

export const BIRTHDAY_PARTY_TYPE_KEY = 'birthday_party';

export const PARTY_ADULT_AGE_MONTHS = 18 * 12;

const MINOR_TYPE_KEYS = new Set([
  'minor',
  'child',
  'children',
  'minor_child',
  'dependent',
  'youth',
]);

const ADULT_TYPE_KEYS = new Set([
  'additional_adult',
  'additionaladult',
  'guardian',
]);

export const PARTY_ROLES = {
  HOST_ADULT: 'host_adult',
  BIRTHDAY_CHILD: 'birthday_child',
};

export const defaultPartyCategorySessionRules = () => ({
  party_booking: true,
  require_birthday_child: true,
  default_spaces_per_slot: 1,
});

export const defaultPartyActivityTicketFlags = (requireBirthdayChild = true) => ({
  party_booking: true,
  require_birthday_child: requireBirthdayChild,
});

export const parsePartyCategorySessionRules = (sessionRules) => {
  const raw =
    sessionRules && typeof sessionRules === 'object' ? sessionRules : {};
  return {
    partyBooking: raw.party_booking === true || raw.partyBooking === true,
    requireBirthdayChild: raw.require_birthday_child !== false,
    defaultSpacesPerSlot: Math.max(1, Number.parseInt(raw.default_spaces_per_slot, 10) || 1),
  };
};

export const serializePartyCategorySessionRules = ({
  requireBirthdayChild = true,
  defaultSpacesPerSlot = 1,
} = {}) => ({
  party_booking: true,
  require_birthday_child: requireBirthdayChild !== false,
  default_spaces_per_slot: Math.max(1, Number.parseInt(defaultSpacesPerSlot, 10) || 1),
});

export const parsePartyActivitySettings = (ticketSettingsRaw, bookingType = null) => {
  const ticketParsed = parseActivityTicketSettings(ticketSettingsRaw);
  const categoryRules = parsePartyCategorySessionRules(bookingType?.session_rules);

  const isBirthdayPartyType =
    String(bookingType?.type_key || '').toLowerCase() === BIRTHDAY_PARTY_TYPE_KEY;

  const partyBooking =
    ticketParsed.party_booking === true
    || ticketParsed.partyBooking === true
    || categoryRules.partyBooking
    || isBirthdayPartyType;

  const requireBirthdayChild =
    ticketParsed.require_birthday_child != null
      ? ticketParsed.require_birthday_child !== false
      : categoryRules.requireBirthdayChild;

  const defaultSpacesPerSlot = categoryRules.defaultSpacesPerSlot;

  return {
    isPartyBooking: partyBooking,
    requireBirthdayChild,
    defaultSpacesPerSlot,
  };
};

export const isBirthdayPartyCategory = (bookingType) =>
  String(bookingType?.type_key || '').toLowerCase() === BIRTHDAY_PARTY_TYPE_KEY;

/** Under 18 by DOB, or explicit minor/child participant type. Age wins over primary/account_owner. */
export const isRosterMinor = (participant, now = dayjs()) => {
  if (!participant) return false;
  const type = participantTypeKey(participant);
  if (MINOR_TYPE_KEYS.has(type)) return true;

  const ageMonths = participantAgeInMonths(participant.date_of_birth, now);
  if (ageMonths != null) {
    return ageMonths < PARTY_ADULT_AGE_MONTHS;
  }

  return false;
};

/** 18+ by DOB, or explicit adult type. Never classifies minors as adults. */
export const isRosterAdult = (participant, now = dayjs()) => {
  if (!participant || isRosterMinor(participant, now)) return false;

  const type = participantTypeKey(participant);
  if (ADULT_TYPE_KEYS.has(type)) return true;

  const ageMonths = participantAgeInMonths(participant.date_of_birth, now);
  if (ageMonths != null) {
    return ageMonths >= PARTY_ADULT_AGE_MONTHS;
  }

  // Account holder without DOB on file — assume supervising adult.
  if (type === 'primary' || participant.is_account_owner) {
    return true;
  }

  return false;
};

export const partitionRosterForParty = (participants = [], now = dayjs()) => {
  const adults = [];
  const minors = [];
  (participants || []).forEach((participant) => {
    if (isRosterMinor(participant, now)) {
      minors.push(participant);
    } else if (isRosterAdult(participant, now)) {
      adults.push(participant);
    }
  });
  return { adults, minors };
};

export const validatePartyRoleSelection = ({
  hostParticipantId,
  birthdayChildParticipantId,
  requireBirthdayChild = true,
  customerParticipants = [],
} = {}) => {
  if (!hostParticipantId) {
    return { ok: false, message: 'Please select the party host (adult).' };
  }
  const host = customerParticipants.find((p) => p.id === hostParticipantId);
  if (host && !isRosterAdult(host)) {
    return { ok: false, message: 'Party host must be an adult (18+).' };
  }
  if (requireBirthdayChild && !birthdayChildParticipantId) {
    return { ok: false, message: 'Please select the birthday child.' };
  }
  if (birthdayChildParticipantId) {
    const child = customerParticipants.find((p) => p.id === birthdayChildParticipantId);
    if (child && !isRosterMinor(child)) {
      return { ok: false, message: 'Birthday child must be under 18.' };
    }
  }
  if (
    requireBirthdayChild
    && birthdayChildParticipantId
    && hostParticipantId === birthdayChildParticipantId
  ) {
    return { ok: false, message: 'The party host and birthday child must be different people.' };
  }
  return { ok: true };
};

/** One party package ticket assigned to the host only. */
export const assignPartyPackageTicket = ({
  hostParticipantId,
  items = [],
} = {}) => {
  if (!hostParticipantId || !items?.length) {
    return {
      participantAssignments: {},
      ticketCounts: {},
    };
  }
  const partyItem = items[0];
  return {
    participantAssignments: {
      [hostParticipantId]: {
        inventory_item_id: partyItem.id,
        inventory_item_name: partyItem.name || 'Party package',
      },
    },
    ticketCounts: { [partyItem.id]: 1 },
  };
};

/** Resolve checkout identity for party rows — prefer roster account owner over waiver aliases. */
export const resolvePartyCheckoutParticipantIdentity = (
  participant,
  { customerParticipants = [], customerAccount = null } = {},
) => {
  if (!participant) {
    return { participantId: null, firstName: null, lastName: null };
  }

  const rosterOwner = (customerParticipants || []).find(
    (p) => p.is_account_owner && p.booking_customer_participant_id,
  );

  let participantId = participant.booking_customer_participant_id ?? null;
  let firstName = String(participant.first_name || '').trim();
  let lastName = String(participant.last_name || '').trim();

  if (participant.is_account_owner && rosterOwner?.booking_customer_participant_id) {
    participantId = rosterOwner.booking_customer_participant_id;
    firstName = String(rosterOwner.first_name || firstName || '').trim();
    lastName = String(rosterOwner.last_name || lastName || '').trim();
  }

  if (!firstName && !lastName && customerAccount?.customer_name) {
    const parts = String(customerAccount.customer_name).trim().split(/\s+/).filter(Boolean);
    firstName = parts[0] || '';
    lastName = parts.slice(1).join(' ') || '';
  }

  return {
    participantId: participantId || null,
    firstName: firstName || null,
    lastName: lastName || null,
  };
};

export const buildPartyParticipantRowsForCheckout = ({
  customerParticipants = [],
  customerAccount = null,
  hostParticipantId,
  birthdayChildParticipantId,
  selectedParticipantTicketAssignments = {},
  inventoryItems = [],
  getParticipantWaiverStatus,
  getParticipantCamperRegistrationStatus,
}) => {
  const buildRow = (participantId, partyRole, includeTicket) => {
    const participant = customerParticipants.find((p) => p.id === participantId);
    if (!participant) return null;
    const waiverStatus = getParticipantWaiverStatus?.(participant) || 'missing';
    const camperRegistrationStatus = getParticipantCamperRegistrationStatus?.(participant) || 'not_required';
    const assignedTicketId = includeTicket
      ? selectedParticipantTicketAssignments[participantId]?.inventory_item_id
        || inventoryItems[0]?.id
        || null
      : null;
    const identity = resolvePartyCheckoutParticipantIdentity(participant, {
      customerParticipants,
      customerAccount,
    });

    return {
      participant_id: identity.participantId,
      waiver_participant_id: participant?.waiver_participant_id ?? null,
      inventory_item_id: assignedTicketId,
      party_role: partyRole,
      first_name: identity.firstName,
      last_name: identity.lastName,
      date_of_birth: participant.date_of_birth ?? null,
      is_minor: partyRole === PARTY_ROLES.BIRTHDAY_CHILD,
      waiver_id: waiverStatus === 'valid' ? participant?.waiver_id ?? null : null,
      waiver_status: waiverStatus,
      camper_registration_document_id:
        camperRegistrationStatus === 'valid'
          ? participant?.camper_registration_document_id ?? participant?.camper_registration_document?.id ?? null
          : null,
      camper_registration_status: camperRegistrationStatus,
    };
  };

  const rows = [];
  const hostRow = buildRow(hostParticipantId, PARTY_ROLES.HOST_ADULT, true);
  if (hostRow) rows.push(hostRow);
  if (birthdayChildParticipantId) {
    const childRow = buildRow(birthdayChildParticipantId, PARTY_ROLES.BIRTHDAY_CHILD, false);
    if (childRow) rows.push(childRow);
  }
  return rows;
};

export const resolvePartySelectedParticipantIds = ({
  hostParticipantId,
  birthdayChildParticipantId,
  requireBirthdayChild,
}) => {
  const ids = [];
  if (hostParticipantId) ids.push(hostParticipantId);
  if (requireBirthdayChild && birthdayChildParticipantId) ids.push(birthdayChildParticipantId);
  return ids;
};
