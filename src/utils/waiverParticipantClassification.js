/**
 * Classify waiver_participants rows for display (customer flow + dashboard).
 * Matches WaiversDashboard: minors include type "minor" OR inferred under-18 from DOB when not primary/additional_adult.
 */
import { calculateAgeFromIsoDateOfBirth } from './waiverDateOfBirth';

export function participantTypeLower(p) {
  return String(p?.participant_type || p?.type || p?.data?.type || '').toLowerCase();
}

/** DB / imports may use "additional adult", "Additional Adult", "additional_adult" — normalize for comparisons. */
export function participantTypeKey(p) {
  return participantTypeLower(p).replace(/\s+/g, '_').replace(/-+/g, '_');
}

function ageFromParticipantDob(dob) {
  if (dob == null || dob === '') return null;
  if (typeof dob === 'string') {
    return calculateAgeFromIsoDateOfBirth(dob);
  }
  if (dob instanceof Date && !Number.isNaN(dob.getTime())) {
    const y = dob.getFullYear();
    const m = dob.getMonth() + 1;
    const d = dob.getDate();
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return calculateAgeFromIsoDateOfBirth(iso);
  }
  return null;
}

/**
 * @param {object} p — waiver_participants row (or flow shape with .data)
 * @param {number} [minorAgeThreshold=18]
 */
export function isWaiverMinorParticipant(p, minorAgeThreshold = 18) {
  if (!p) return false;
  const k = participantTypeKey(p);
  if (
    k === 'minor' ||
    k === 'child' ||
    k === 'children' ||
    k === 'minor_child' ||
    k === 'dependent' ||
    k === 'youth'
  ) {
    return true;
  }
  if (k === 'primary' || k === 'additional_adult' || k === 'additionaladult' || k === 'guardian') {
    return false;
  }
  const dob = p.date_of_birth ?? p.data?.dateOfBirth;
  const age = ageFromParticipantDob(dob);
  return age !== null && age >= 0 && age < minorAgeThreshold;
}

export function isWaiverAdditionalAdultParticipant(p) {
  if (!p) return false;
  const k = participantTypeKey(p);
  return k === 'additional_adult' || k === 'additionaladult';
}
