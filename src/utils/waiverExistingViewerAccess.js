/**
 * Resolve how the public “waiver on file” screen should behave after OTP,
 * based on whether the verified phone matches the signature row or an additional adult participant.
 */

import { isWaiverAdditionalAdultParticipant } from './waiverParticipantClassification';

/** Digits only; strip leading US/CA country code 1 so signature + participant rows compare. */
export function normalizePhoneDigits(value) {
  let d = String(value ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d;
}

/** Phone on DB row or in-memory flow shape (`data.phoneNumber`). */
export function participantPhoneDigits(p) {
  if (!p) return '';
  const raw =
    p.phone_number ??
    p.phone ??
    p.customer_phone ??
    p.data?.phoneNumber ??
    '';
  return normalizePhoneDigits(raw);
}

/**
 * @param {object|null} waiver — waiver_signatures row
 * @param {Array} participants — waiver_participants rows
 * @param {string} normalizedEnteredPhone — digits only, >= 10
 * @returns {{ mode: 'signer' | 'co_primary' | 'full_view' | 'self_only', participantId: string|null }}
 */
export function resolveWaiverViewerAccess(waiver, participants, normalizedEnteredPhone) {
  const entered = normalizePhoneDigits(normalizedEnteredPhone);
  if (!entered || entered.length < 10) {
    return { mode: 'signer', participantId: null };
  }

  const sigPhone = normalizePhoneDigits(waiver?.phone_number);
  if (sigPhone && sigPhone === entered) {
    return { mode: 'signer', participantId: null };
  }

  const match = (participants || []).find((p) => {
    if (!isWaiverAdditionalAdultParticipant(p)) return false;
    const pPhone = participantPhoneDigits(p);
    return pPhone === entered && pPhone.length >= 10;
  });

  if (!match) {
    return { mode: 'signer', participantId: null };
  }

  const raw = match.participant_portal_access || 'full_view';
  const mode =
    raw === 'co_primary'
      ? 'co_primary'
      : raw === 'self_only'
        ? 'self_only'
        : 'full_view';

  return { mode, participantId: match.id ?? null };
}

/**
 * Where to send the existing-waiver OTP: primary signer email vs additional adult's email on file.
 * When the entered phone matches an additional_adult row (not the signature row), use their email and
 * skip loyalty-account email override so the code is not sent to the primary.
 *
 * `matched === null` means this phone is not on the signature row or any additional-adult row — never
 * fall back to the primary’s email (that would send the code to someone who did not enter this phone).
 *
 * @returns {{ email: string|null, preferProvidedEmail: boolean, matched: 'signature' | 'additional_adult' | null }}
 */
export function resolveOtpDeliveryForExistingWaiver(waiver, participants, normalizedEnteredPhone) {
  const entered = normalizePhoneDigits(normalizedEnteredPhone);
  if (!entered || entered.length < 10) {
    return { email: null, preferProvidedEmail: false, matched: null };
  }

  const sigPhone = normalizePhoneDigits(waiver?.phone_number);
  if (sigPhone && sigPhone === entered) {
    const email = (waiver?.email || '').trim() || null;
    return { email, preferProvidedEmail: false, matched: 'signature' };
  }

  const adult = (participants || []).find((p) => {
    if (!isWaiverAdditionalAdultParticipant(p)) return false;
    const pPhone = participantPhoneDigits(p);
    return pPhone === entered && pPhone.length >= 10;
  });

  if (adult) {
    const email =
      String(adult.email || adult.contact_email || adult.data?.email || '')
        .trim() || null;
    return { email, preferProvidedEmail: true, matched: 'additional_adult' };
  }

  return { email: null, preferProvidedEmail: false, matched: null };
}
