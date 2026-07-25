/**
 * Single definition of who consumes a schedule seat (campers/children — not adult chaperones).
 */

import { linkedWaiverParticipant, waiverSigViaSignatureId, waiverSigViaWaiverId } from './participantIdentity';

const ADULT_PARTY_ROLES = new Set(['host_adult']);
const ADULT_WAIVER_TYPES = new Set(['primary', 'adult', 'additional_adult', 'additionaladult']);
const CAMPER_WAIVER_TYPES = new Set(['minor', 'child']);

function inventoryName(participant) {
  const inv = participant?.pos_inventory;
  if (!inv) return '';
  const row = Array.isArray(inv) ? inv[0] : inv;
  return String(row?.name || '').trim();
}

function waiverParticipantType(participant) {
  const wp = linkedWaiverParticipant(participant);
  return String(wp?.participant_type || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function signatureIsMinor(participant) {
  const sig = waiverSigViaWaiverId(participant) || waiverSigViaSignatureId(participant);
  return sig?.is_minor === true;
}

function inventoryLooksAdult(name) {
  const text = String(name || '').trim();
  if (!text) return false;
  return /\badult\b/i.test(text) || /\bchaperone\b/i.test(text);
}

/**
 * Whether this booking_participants row consumes one schedule seat.
 */
export function participantCountsTowardCapacity(participant) {
  if (!participant) return false;

  if (ADULT_PARTY_ROLES.has(String(participant.party_role || '').trim())) {
    return false;
  }

  const waiverType = waiverParticipantType(participant);
  if (CAMPER_WAIVER_TYPES.has(waiverType)) return true;
  if (ADULT_WAIVER_TYPES.has(waiverType)) return false;

  if (participant.waiver_participant_id) {
    if (signatureIsMinor(participant)) return true;
    if (waiverType && !ADULT_WAIVER_TYPES.has(waiverType)) return true;
    return false;
  }

  const invName = inventoryName(participant);
  if (invName) {
    return !inventoryLooksAdult(invName);
  }

  if (participant.is_minor === true) return true;
  if (participant.is_minor === false) return false;

  return false;
}

export function countCapacityParticipantsOnBooking(booking, parentBookingsById = null) {
  if (!booking) return 0;

  const sourceBooking = booking.parent_booking_id && parentBookingsById?.get(booking.parent_booking_id)
    ? parentBookingsById.get(booking.parent_booking_id)
    : booking;

  const participants = sourceBooking?.booking_participants || [];
  return participants.filter(participantCountsTowardCapacity).length;
}

/** Drop-in play: every attendee row consumes one schedule seat (adults and children). */
export function countAllParticipantsOnBooking(booking, parentBookingsById = null) {
  if (!booking) return 0;

  const sourceBooking = booking.parent_booking_id && parentBookingsById?.get(booking.parent_booking_id)
    ? parentBookingsById.get(booking.parent_booking_id)
    : booking;

  return (sourceBooking?.booking_participants || []).length;
}
