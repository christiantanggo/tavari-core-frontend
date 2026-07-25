import { PARTY_ROLES } from '../../utils/bookingPartySettings';
import {
  getParticipantContactBits,
  getParticipantDisplayName,
  participantIdentityKey,
  participantMinorFlags,
} from './participantIdentity';

const WAIVER_SIGNATURE_SELECT = `
  id,
  first_name,
  last_name,
  email,
  phone_number,
  date_of_birth,
  is_valid,
  expires_at,
  signed_at,
  waiver_participants (
    id,
    waiver_id,
    first_name,
    last_name,
    email,
    phone_number,
    date_of_birth,
    participant_type,
    is_account_owner,
    is_active
  )
`;

function isWaiverExpired(expiresAt) {
  if (!expiresAt) return false;
  const expires = new Date(expiresAt);
  return !Number.isNaN(expires.getTime()) && expires.getTime() < Date.now();
}

function waiverStatusFromRow(waiver) {
  if (!waiver) return 'missing';
  if (waiver.is_valid === false) return 'expired';
  if (isWaiverExpired(waiver.expires_at)) return 'expired';
  return 'valid';
}

function normalizeWaiverRosterRow(row, waiverMeta = null) {
  const waiverStatus = waiverMeta ? waiverStatusFromRow(waiverMeta) : 'missing';
  return {
    id: row.id,
    first_name: row.first_name || '',
    last_name: row.last_name || '',
    date_of_birth: row.date_of_birth ?? null,
    email: row.email ?? null,
    phone_number: row.phone_number ?? null,
    participant_type: row.participant_type || (row.is_account_owner ? 'primary' : 'additional_adult'),
    is_account_owner: !!row.is_account_owner,
    is_active: row.is_active !== false,
    waiver_id: row.waiver_id ?? waiverMeta?.id ?? null,
    waiver_participant_id: row.waiver_participant_id ?? row.id ?? null,
    booking_customer_participant_id: row.booking_customer_participant_id ?? null,
    waiver_status: row.waiver_status || waiverStatus,
    waiver_expires_at: waiverMeta?.expires_at ?? null,
    waiver_signed_at: waiverMeta?.signed_at ?? null,
  };
}

async function queryWaiversByCustomerOrContact(supabase, businessId, customer) {
  const rows = [];

  if (customer?.customerId || customer?.id) {
    const customerId = customer.customerId || customer.id;
    const { data } = await supabase
      .from('waiver_signatures')
      .select(WAIVER_SIGNATURE_SELECT)
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .order('signed_at', { ascending: false })
      .limit(10);
    if (Array.isArray(data)) rows.push(...data);
  }

  if (rows.length === 0 && (customer?.customer_email || customer?.customer_phone)) {
    const normalizedEmail = String(customer.customer_email || '').trim().toLowerCase();
    const normalizedPhone = String(customer.customer_phone || '').replace(/\D/g, '');
    const fallbackResults = [];

    if (normalizedEmail) {
      const { data } = await supabase
        .from('waiver_signatures')
        .select(WAIVER_SIGNATURE_SELECT)
        .eq('business_id', businessId)
        .ilike('email', normalizedEmail)
        .order('signed_at', { ascending: false })
        .limit(10);
      if (Array.isArray(data)) fallbackResults.push(...data);
    }

    if (normalizedPhone) {
      const { data } = await supabase
        .from('waiver_signatures')
        .select(WAIVER_SIGNATURE_SELECT)
        .eq('business_id', businessId)
        .eq('phone_number', normalizedPhone)
        .order('signed_at', { ascending: false })
        .limit(10);
      if (Array.isArray(data)) fallbackResults.push(...data);
    }

    if (fallbackResults.length > 0) {
      return Array.from(new Map(fallbackResults.map((row) => [row.id, row])).values())
        .sort((a, b) => new Date(b.signed_at || 0).getTime() - new Date(a.signed_at || 0).getTime());
    }
  }

  return rows;
}

/**
 * Load all people on the customer's active waiver(s) — primary signer plus additional adults/minors.
 */
export async function loadWaiverRosterForCustomer(supabase, businessId, customer) {
  if (!supabase || !businessId || !customer) return [];

  const participants = [];

  const { data: rpcRows, error: rpcError } = await supabase.rpc('bookings_get_portal_participants', {
    p_customer_id: customer.customerId || customer.id,
    p_business_id: businessId,
  });

  if (!rpcError && Array.isArray(rpcRows) && rpcRows.length > 0) {
    participants.push(...rpcRows.map((row) => normalizeWaiverRosterRow(row)));
  }

  const waiverRows = await queryWaiversByCustomerOrContact(supabase, businessId, customer);
  const validWaivers = waiverRows.filter((waiver) => {
    if (waiver?.is_valid === false) return false;
    if (waiver?.expires_at && isWaiverExpired(waiver.expires_at)) return false;
    return true;
  });

  const waiversToUse = validWaivers.length > 0 ? validWaivers : waiverRows.slice(0, 1);

  waiversToUse.forEach((waiver) => {
    participants.push(normalizeWaiverRosterRow({
      id: waiver.id,
      waiver_id: waiver.id,
      first_name: waiver.first_name || '',
      last_name: waiver.last_name || '',
      date_of_birth: waiver.date_of_birth ?? null,
      email: waiver.email || customer.customer_email || null,
      phone_number: waiver.phone_number || customer.customer_phone || null,
      participant_type: 'primary',
      is_account_owner: true,
      is_active: true,
    }, waiver));

    (waiver.waiver_participants || []).forEach((participant) => {
      if (String(participant?.participant_type || '').toLowerCase() === 'primary') return;
      participants.push(normalizeWaiverRosterRow({
        ...participant,
        waiver_id: participant.waiver_id ?? waiver.id,
      }, waiver));
    });
  });

  const byIdentity = new Map();
  participants.forEach((participant) => {
    const key = participantIdentityKey(participant);
    const existing = byIdentity.get(key);
    if (!existing || (participant.waiver_id && !existing.waiver_id)) {
      byIdentity.set(key, participant);
    }
  });

  const merged = Array.from(byIdentity.values());
  merged.sort((a, b) => Number(!!b.is_account_owner) - Number(!!a.is_account_owner));
  return merged;
}

function bookingParticipantMatchesRoster(bookingParticipant, rosterRow) {
  if (!bookingParticipant || !rosterRow) return false;

  if (
    bookingParticipant.waiver_participant_id
    && rosterRow.waiver_participant_id
    && bookingParticipant.waiver_participant_id === rosterRow.waiver_participant_id
  ) {
    return true;
  }

  if (
    bookingParticipant.participant_id
    && rosterRow.booking_customer_participant_id
    && bookingParticipant.participant_id === rosterRow.booking_customer_participant_id
  ) {
    return true;
  }

  if (
    bookingParticipant.waiver_id
    && rosterRow.waiver_id
    && bookingParticipant.waiver_id === rosterRow.waiver_id
    && rosterRow.participant_type === 'primary'
  ) {
    return true;
  }

  return participantIdentityKey(bookingParticipant) === participantIdentityKey(rosterRow);
}

export function partyRoleLabel(partyRole) {
  if (partyRole === PARTY_ROLES.BIRTHDAY_CHILD) return 'Birthday child';
  if (partyRole === PARTY_ROLES.HOST_ADULT) return 'Party host';
  return null;
}

/**
 * Merge booking participants with the full waiver roster for the Participants tab.
 * Birthday child and party host badges come from booking_participants.party_role.
 */
export function buildParticipantsTabRows(bookingParticipants = [], waiverRoster = []) {
  const bookingRows = Array.isArray(bookingParticipants) ? bookingParticipants : [];
  const rosterRows = Array.isArray(waiverRoster) ? waiverRoster : [];
  const usedBookingIds = new Set();
  const usedRosterKeys = new Set();

  const rows = rosterRows.map((rosterRow, rosterIndex) => {
    const bookingMatch = bookingRows.find((bookingParticipant) => {
      if (usedBookingIds.has(bookingParticipant.id)) return false;
      return bookingParticipantMatchesRoster(bookingParticipant, rosterRow);
    });

    if (bookingMatch) usedBookingIds.add(bookingMatch.id);
    usedRosterKeys.add(participantIdentityKey(rosterRow));

    const partyRole = bookingMatch?.party_role || null;
    const displayParticipant = bookingMatch && rosterRow
      ? {
          ...rosterRow,
          ...bookingMatch,
          first_name: rosterRow.first_name || bookingMatch.first_name,
          last_name: rosterRow.last_name || bookingMatch.last_name,
          waiver_participants: rosterRow.waiver_participants || bookingMatch.waiver_participants,
          booking_customer_participants:
            rosterRow.booking_customer_participants || bookingMatch.booking_customer_participants,
        }
      : bookingMatch || rosterRow;

    return {
      id: bookingMatch?.id || rosterRow.id || `roster-${rosterIndex}`,
      rosterRow,
      bookingParticipant: bookingMatch || null,
      party_role: partyRole,
      is_on_booking: !!bookingMatch,
      is_birthday_child: partyRole === PARTY_ROLES.BIRTHDAY_CHILD,
      is_party_host: partyRole === PARTY_ROLES.HOST_ADULT,
      waiver_status: bookingMatch?.waiver_status || rosterRow.waiver_status || 'missing',
      displayName: getParticipantDisplayName(displayParticipant, rosterIndex),
      contact: getParticipantContactBits(displayParticipant),
      minorFlags: participantMinorFlags(displayParticipant),
      selectionKey: null,
    };
  });

  bookingRows.forEach((bookingParticipant, bookingIndex) => {
    if (usedBookingIds.has(bookingParticipant.id)) return;

    const identity = participantIdentityKey(bookingParticipant);
    // Duplicate attending seats for the same person must not appear as multiple valid rows.
    if (identity && usedRosterKeys.has(identity)) return;
    if (identity) usedRosterKeys.add(identity);

    const partyRole = bookingParticipant.party_role || null;
    rows.push({
      id: bookingParticipant.id || `booking-only-${bookingIndex}`,
      rosterRow: null,
      bookingParticipant,
      party_role: partyRole,
      is_on_booking: true,
      is_birthday_child: partyRole === PARTY_ROLES.BIRTHDAY_CHILD,
      is_party_host: partyRole === PARTY_ROLES.HOST_ADULT,
      waiver_status: bookingParticipant.waiver_status || 'missing',
      displayName: getParticipantDisplayName(bookingParticipant, bookingIndex),
      contact: getParticipantContactBits(bookingParticipant),
      minorFlags: participantMinorFlags(bookingParticipant),
      selectionKey: null,
    });
  });

  rows.forEach((row) => {
    row.selectionKey = getParticipantsTabRowKey(row);
  });

  rows.sort((a, b) => {
    const rank = (row) => {
      if (row.is_birthday_child) return 0;
      if (row.is_party_host) return 1;
      if (row.minorFlags?.showBadge) return 2;
      if (row.is_on_booking) return 3;
      return 4;
    };
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    return String(a.displayName || '').localeCompare(String(b.displayName || ''));
  });

  return rows;
}

export function getParticipantsTabRowKey(row) {
  if (row?.selectionKey) return row.selectionKey;
  if (row?.bookingParticipant?.id) return `bp:${row.bookingParticipant.id}`;
  if (row?.rosterRow) return `wr:${participantIdentityKey(row.rosterRow)}`;
  return `row:${row?.id || 'unknown'}`;
}

export function getInitialSelectedParticipantKeys(participantsTabRows = []) {
  return participantsTabRows
    .filter((row) => row.is_on_booking)
    .map((row) => getParticipantsTabRowKey(row));
}

export function isParticipantSelectionLocked(row) {
  return !!(row?.is_birthday_child || row?.is_party_host);
}

export function participantSelectionKeysEqual(a = [], b = []) {
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.length === sb.length && sa.every((key, index) => key === sb[index]);
}

export function tabRowToBookingParticipantPayload(row) {
  const roster = row.rosterRow;
  const bookingParticipant = row.bookingParticipant;
  const contact = row.contact || getParticipantContactBits(bookingParticipant || roster || {});

  return {
    party_role: row.party_role || null,
    first_name: roster?.first_name || bookingParticipant?.first_name || '',
    last_name: roster?.last_name || bookingParticipant?.last_name || '',
    date_of_birth: roster?.date_of_birth ?? contact.dateOfBirth ?? null,
    email: roster?.email ?? contact.email ?? null,
    phone_number: roster?.phone_number ?? contact.phone ?? null,
    participant_id: roster?.booking_customer_participant_id || bookingParticipant?.participant_id || null,
    waiver_participant_id: roster?.waiver_participant_id || bookingParticipant?.waiver_participant_id || null,
    waiver_id: roster?.waiver_id || bookingParticipant?.waiver_id || null,
    waiver_status: row.waiver_status || roster?.waiver_status || bookingParticipant?.waiver_status || 'missing',
    bookingParticipant,
  };
}
