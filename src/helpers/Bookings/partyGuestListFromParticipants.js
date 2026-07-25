import { PARTY_ROLES } from '../../utils/bookingPartySettings';
import { normalizePhoneDigits } from '../../utils/waiverExistingViewerAccess';
import {
  getParticipantContactBits,
  linkedCustomerParticipant,
  linkedWaiverParticipant,
  participantMinorFlags,
  waiverSigViaSignatureId,
  waiverSigViaWaiverId,
} from './participantIdentity';

export function mapBookingWaiverStatusToGuestList(waiverStatus) {
  const status = String(waiverStatus || '').toLowerCase();
  if (status === 'valid') return 'verified';
  if (status === 'expired') return 'expired';
  if (status === 'missing') return 'missing';
  return 'not_verified';
}

export function guestEntryIdentityKey(entry) {
  const first = String(entry?.first_name || '').trim().toLowerCase();
  const last = String(entry?.last_name || '').trim().toLowerCase();
  return `${first}|${last}`;
}

function guestEntryPreferenceScore(entry) {
  let score = 0;
  if (entry?.is_birthday_child) score += 100;
  if (entry?.waiver_status === 'verified') score += 50;
  if (entry?.source === 'staff') score += 10;
  if (entry?.source === 'host') score += 5;
  score -= Number(entry?.sort_order) || 0;
  return score;
}

export function dedupeGuestEntriesByIdentity(entries = []) {
  const groups = new Map();
  (entries || []).forEach((entry) => {
    const key = guestEntryIdentityKey(entry);
    if (!key || key === '|') return;
    const group = groups.get(key) || [];
    group.push(entry);
    groups.set(key, group);
  });

  const preferred = [];
  const duplicateIds = [];

  groups.forEach((group) => {
    const sorted = [...group].sort((a, b) => guestEntryPreferenceScore(b) - guestEntryPreferenceScore(a));
    preferred.push(sorted[0]);
    sorted.slice(1).forEach((entry) => {
      if (entry?.id) duplicateIds.push(entry.id);
    });
  });

  preferred.sort((a, b) => {
    const sortDiff = (Number(a.display_sort_order) || 0) - (Number(b.display_sort_order) || 0);
    if (sortDiff !== 0) return sortDiff;
    return (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
  });

  return { preferred, duplicateIds };
}

function getParticipantNameParts(participant) {
  const bcp = linkedCustomerParticipant(participant);
  const wp = linkedWaiverParticipant(participant);
  const sig = waiverSigViaWaiverId(participant) || waiverSigViaSignatureId(participant);
  return {
    first_name: String(
      participant?.first_name || bcp?.first_name || wp?.first_name || sig?.first_name || '',
    ).trim(),
    last_name: String(
      participant?.last_name || bcp?.last_name || wp?.last_name || sig?.last_name || '',
    ).trim(),
  };
}

export function participantHasResolvableName(participant) {
  const { first_name, last_name } = getParticipantNameParts(participant);
  return !!(first_name && last_name);
}

export function computeGuestEntryDisplaySortOrder(entry, sortOrder = 0) {
  const typeRank = entry.guest_type === 'child'
    ? (entry.is_birthday_child ? 0 : 1)
    : (entry.is_attending === false ? 4 : 3);
  return typeRank * 1000 + sortOrder;
}

function participantSortRank(participant) {
  if (participant?.party_role === PARTY_ROLES.BIRTHDAY_CHILD) return 0;
  if (participant?.party_role === PARTY_ROLES.HOST_ADULT) return 1;
  if (participantMinorFlags(participant).showBadge) return 2;
  return 3;
}

export function bookingParticipantToGuestEntry(participant, index, bookerPhone = '') {
  const { first_name, last_name } = getParticipantNameParts(participant);
  if (!first_name || !last_name) return null;

  const partyRole = participant.party_role || null;
  const isBirthdayChild = partyRole === PARTY_ROLES.BIRTHDAY_CHILD;
  const isChild = isBirthdayChild || participantMinorFlags(participant).showBadge;
  const guestType = isChild ? 'child' : 'adult';
  const contact = getParticipantContactBits(participant);
  const phone = normalizePhoneDigits(contact.phone || bookerPhone || '');
  const roleTag = guestType === 'adult'
    ? 'adult'
    : (isBirthdayChild ? 'birthday_child' : 'child');

  const entry = {
    guest_type: guestType,
    first_name,
    last_name,
    parent_last_name: null,
    household_phone: phone,
    role_tag: roleTag,
    is_attending: true,
    is_birthday_child: isBirthdayChild,
    waiver_signature_id: participant.waiver_id || participant.waiver_signature_id || null,
    waiver_status: mapBookingWaiverStatusToGuestList(participant.waiver_status),
    sort_order: index,
    display_sort_order: 0,
    source: 'staff',
  };
  entry.display_sort_order = computeGuestEntryDisplaySortOrder(entry, index);
  return entry;
}

export function buildGuestEntriesFromBookingParticipants(bookingParticipants = [], bookerPhone = '') {
  const sorted = [...(bookingParticipants || [])].sort((a, b) => {
    const rankDiff = participantSortRank(a) - participantSortRank(b);
    if (rankDiff !== 0) return rankDiff;
    const aName = getParticipantNameParts(a);
    const bName = getParticipantNameParts(b);
    return `${aName.first_name} ${aName.last_name}`.localeCompare(`${bName.first_name} ${bName.last_name}`);
  });

  const seen = new Set();
  const uniqueParticipants = sorted.filter((participant) => {
    const { first_name, last_name } = getParticipantNameParts(participant);
    const key = guestEntryIdentityKey({ first_name, last_name });
    if (!key || key === '|' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return uniqueParticipants
    .map((participant, index) => bookingParticipantToGuestEntry(participant, index, bookerPhone))
    .filter(Boolean)
    .map((entry, index) => ({
      ...entry,
      sort_order: index,
      display_sort_order: computeGuestEntryDisplaySortOrder(entry, index),
    }));
}

export function findMissingGuestEntries(existingEntries = [], candidateEntries = []) {
  const existingKeys = new Set(
    (existingEntries || []).map(guestEntryIdentityKey).filter((key) => key !== '|'),
  );
  const missing = [];
  (candidateEntries || []).forEach((entry) => {
    const key = guestEntryIdentityKey(entry);
    if (!key || key === '|' || existingKeys.has(key)) return;
    existingKeys.add(key);
    missing.push(entry);
  });
  return missing;
}
