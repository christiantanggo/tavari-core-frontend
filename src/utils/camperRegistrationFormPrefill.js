import { resolveCamperRegistrationSignatureSrc } from './generateCamperRegistrationHTMLContent';
import { formatPostalCodeDisplay } from './postalFormat';

const emptyGuardian = () => ({ name: '', primary_phone: '', secondary_phone: '', email: '' });
const emptyEmergencyContact = () => ({ name: '', phone: '' });
const emptyAllergy = () => ({
  allergen: '',
  potential_symptoms: '',
  other: '',
  is_anaphylactic: '',
  has_epipen: '',
});
const emptyMedication = () => ({
  name: '',
  dosage_instructions: '',
  time_to_dispense: '',
  refrigeration: '',
});

function normalizeEmergencyContacts(contacts) {
  const rows = Array.isArray(contacts) ? contacts : [];
  const padded = [emptyEmergencyContact(), emptyEmergencyContact()];
  rows.slice(0, 2).forEach((row, index) => {
    padded[index] = {
      name: row?.name || '',
      phone: row?.phone || '',
    };
  });
  return padded;
}

function normalizeAllergies(allergies) {
  const rows = Array.isArray(allergies) ? allergies : [];
  if (!rows.length) return [];
  return rows.map((row) => ({
    allergen: row?.allergen || '',
    potential_symptoms: row?.potential_symptoms || '',
    other: row?.other || '',
    is_anaphylactic: row?.is_anaphylactic || '',
    has_epipen: row?.has_epipen || '',
  }));
}

function normalizeMedications(medications) {
  const rows = Array.isArray(medications) ? medications : [];
  if (!rows.length) return [];
  return rows.map((row) => ({
    name: row?.name || '',
    dosage_instructions: row?.dosage_instructions || '',
    time_to_dispense: row?.time_to_dispense || '',
    refrigeration: row?.refrigeration || '',
  }));
}

/**
 * Build editable form state from a stored camper registration document.
 */
export function buildCamperRegistrationFormStateFromDocument(doc) {
  if (!doc) return null;

  const fd = doc.form_data || {};
  const camper = fd.camper_info || {};
  const guardians = fd.guardians || {};
  const g1 = guardians.guardian_1 || {};
  const g2 = guardians.guardian_2 || {};
  const custody = fd.custody || {};
  const pickup = fd.authorized_pickup || {};
  const campAuth = fd.camp_authorization || {};
  const sectionNa = fd.section_na && typeof fd.section_na === 'object' ? fd.section_na : {};
  const allergies = fd.allergies?.length
    ? fd.allergies
    : doc.medical_summary?.allergies || [];
  const medications = fd.medications?.length
    ? fd.medications
    : doc.medical_summary?.medications || [];

  return {
    camperAddress: camper.address || '',
    camperCity: camper.city || '',
    camperPostal: formatPostalCodeDisplay(camper.postal_code || ''),
    camperHomePhone: camper.home_phone || '',
    ageAtCamp: camper.age_at_camp || '',
    guardian1: {
      name: g1.name || '',
      primary_phone: g1.primary_phone || '',
      secondary_phone: g1.secondary_phone || '',
      email: g1.email || '',
    },
    guardian2: {
      name: g2.name || '',
      primary_phone: g2.primary_phone || '',
      secondary_phone: g2.secondary_phone || '',
      email: g2.email || '',
    },
    custodyType: custody.type || '',
    custodyOther: custody.other_detail || '',
    emergencyContacts: normalizeEmergencyContacts(fd.emergency_contacts),
    pickupParentGuardians: pickup.parent_guardians === true,
    pickupEmergencyContacts: pickup.emergency_contacts === true,
    pickupOther: pickup.other_detail || '',
    medicalNeedsText: fd.medical_needs || doc.medical_summary?.medical_needs || '',
    allergies: normalizeAllergies(allergies),
    allergyMedAuthAcknowledged: fd.allergy_med_authorization_acknowledged === true,
    medications: normalizeMedications(medications),
    guardian2Na: sectionNa.guardian_2 === true,
    emergencyContactsNa: sectionNa.emergency_contacts === true,
    medicalNeedsNa: sectionNa.medical_information === true,
    allergiesNa: sectionNa.allergies === true,
    medicationsNa: sectionNa.medications === true,
    ackCamp: campAuth.camp_acknowledged === true,
    ackMedical: campAuth.medical_acknowledged === true,
    ackOffPremises: campAuth.off_premises_acknowledged === true,
    signedByName: doc.signed_by_name || '',
    customFieldValues:
      fd.custom_fields && typeof fd.custom_fields === 'object' ? { ...fd.custom_fields } : {},
    existingSignatureUrl: resolveCamperRegistrationSignatureSrc(doc) || null,
    loadedFromDocumentId: doc.id || null,
  };
}

export function applyAccountDefaultsToFormState(accountDefaults, existingState = {}) {
  const next = { ...existingState };
  if (!next.camperHomePhone && accountDefaults.camperHomePhone) {
    next.camperHomePhone = accountDefaults.camperHomePhone;
  }
  if (!next.guardian1?.name && accountDefaults.guardian1) {
    next.guardian1 = { ...emptyGuardian(), ...next.guardian1, ...accountDefaults.guardian1 };
  } else if (accountDefaults.guardian1) {
    next.guardian1 = { ...emptyGuardian(), ...accountDefaults.guardian1, ...next.guardian1 };
  }
  if (!next.signedByName && accountDefaults.signedByName) {
    next.signedByName = accountDefaults.signedByName;
  }
  if (!next.ageAtCamp && accountDefaults.ageAtCamp) {
    next.ageAtCamp = accountDefaults.ageAtCamp;
  }
  return next;
}

export { emptyGuardian, emptyEmergencyContact, emptyAllergy, emptyMedication };
