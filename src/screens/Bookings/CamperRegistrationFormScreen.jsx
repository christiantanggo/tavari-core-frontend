import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FiPlus, FiTrash2, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import WaiverSignatureCapture from '../../components/Waivers/WaiverSignatureCapture';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import BirthdateCalendarPicker from '../../components/UI/BirthdateCalendarPicker';
import {
  applyCamperRegistrationPreviewSample,
  CAMPER_REGISTRATION_PREVIEW_SAMPLE,
  CAMPER_REGISTRATION_SECTION_KEYS,
  computeAgeFromDob,
  CUSTODY_OPTIONS,
  DEFAULT_AUTHORIZATION_TEXTS,
  readCamperRegistrationPreviewPayload,
  sectionEnabled,
  sectionField,
  sectionLabel,
  sectionPrompt,
  sectionRequired,
  getBusinessWebsiteUrl,
} from '../../constants/camperRegistrationForm';
import camperRegistrationService from '../../services/Bookings/CamperRegistrationService';
import {
  applyAccountDefaultsToFormState,
  buildCamperRegistrationFormStateFromDocument,
} from '../../utils/camperRegistrationFormPrefill';
import { birthdatePartsToIso, isoToBirthdateParts } from '../../utils/birthdatePickerHelpers';
import { formatPhoneDisplay, formatPhoneInput } from '../../utils/phoneFormat';
import { formatPostalCodeDisplay, formatPostalCodeInput } from '../../utils/postalFormat';
import { TavariStyles } from '../../utils/TavariStyles';

const emptyBirthdate = () => ({ year: '', month: '', day: '' });

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

function guardianHasAnyContent(guardian) {
  return !!(
    guardian?.name?.trim() ||
    guardian?.primary_phone?.trim() ||
    guardian?.secondary_phone?.trim() ||
    guardian?.email?.trim()
  );
}

function guardianHasRequiredFields(guardian) {
  return !!(guardian?.name?.trim() && guardian?.primary_phone?.trim());
}

function emergencyContactsHasAnyContent(contacts) {
  return (contacts || []).some((c) => c.name?.trim() || c.phone?.trim());
}

function emergencyContactsHasCompleteRow(contacts) {
  return (contacts || []).some((c) => c.name?.trim() && c.phone?.trim());
}

function allergiesHasContent(rows) {
  return (rows || []).some(
    (a) => a.allergen?.trim() || a.potential_symptoms?.trim() || a.other?.trim()
  );
}

function medicationsHasContent(rows) {
  return (rows || []).some((m) => m.name?.trim());
}

const inputStyle = {
  width: '100%',
  padding: '10px 14px',
  border: `1px solid ${TavariStyles.colors.gray300}`,
  borderRadius: '8px',
  fontSize: '14px',
  boxSizing: 'border-box',
};

const labelStyle = {
  display: 'block',
  marginBottom: 6,
  fontWeight: 600,
  fontSize: 13,
  color: TavariStyles.colors.gray800,
};

const sectionTitleStyle = {
  margin: '0 0 12px',
  fontSize: 16,
  fontWeight: 700,
  color: TavariStyles.colors.gray900,
  paddingBottom: 8,
  borderBottom: `2px solid ${TavariStyles.colors.primary}`,
};

const sectionBoxStyle = {
  marginBottom: 28,
  padding: 16,
  borderRadius: 8,
  border: `1px solid ${TavariStyles.colors.gray200}`,
  background: '#fff',
};

function handleCamperBirthdateChange(birthdate, setCamperBirthdate, setAgeAtCamp) {
  setCamperBirthdate(birthdate);
  const iso = birthdatePartsToIso(birthdate);
  if (iso) setAgeAtCamp(computeAgeFromDob(iso));
}

function formatGuardianPhones(guardian) {
  const g = guardian || emptyGuardian();
  return {
    ...g,
    primary_phone: formatPhoneDisplay(g.primary_phone || ''),
    secondary_phone: formatPhoneDisplay(g.secondary_phone || ''),
  };
}

function formatEmergencyContactsForDisplay(contacts) {
  const rows = contacts?.length ? contacts : [emptyEmergencyContact(), emptyEmergencyContact()];
  return rows.map((c) => ({
    ...c,
    phone: formatPhoneDisplay(c.phone || ''),
  }));
}

function collectValidationIssues(ctx) {
  const {
    participant,
    template,
    camperBirthdate,
    camperAddress,
    camperCity,
    camperPostal,
    camperHomePhone,
    guardian1,
    guardian2,
    guardian2Na,
    custodyType,
    custodyOther,
    emergencyContacts,
    emergencyContactsNa,
    pickupParentGuardians,
    pickupEmergencyContacts,
    pickupOther,
    medicalNeedsText,
    medicalNeedsNa,
    allergies,
    allergiesNa,
    allergyMedAuthAcknowledged,
    medications,
    medicationsNa,
    ackCamp,
    ackMedical,
    ackOffPremises,
    signedByName,
    signatureData,
    existingSignatureUrl,
  } = ctx;

  const errors = [];
  const invalidSections = new Set();
  const SK = CAMPER_REGISTRATION_SECTION_KEYS;

  const issue = (sectionKey, message) => {
    errors.push({ sectionKey, message });
    invalidSections.add(sectionKey);
  };

  if (!participant) {
    issue('general', 'Missing camper information. Return to booking and try again.');
    return { errors, invalidSections, isValid: false };
  }

  if (sectionRequired(template, SK.camperInfo)) {
    if (!birthdatePartsToIso(camperBirthdate)) issue(SK.camperInfo, 'Camper birthdate is required.');
    if (!camperAddress.trim()) issue(SK.camperInfo, 'Camper address is required.');
    if (!camperCity.trim()) issue(SK.camperInfo, 'Camper city is required.');
    if (!camperPostal.trim()) issue(SK.camperInfo, 'Camper postal code is required.');
    if (!camperHomePhone.trim()) issue(SK.camperInfo, 'Home phone number is required.');
  }

  if (sectionRequired(template, SK.guardians)) {
    if (!guardian1.name.trim()) issue(SK.guardians, 'Parent/Guardian 1 name is required.');
    if (!guardian1.primary_phone.trim()) issue(SK.guardians, 'Parent/Guardian 1 primary phone is required.');
  }

  if (sectionEnabled(template, SK.guardians)) {
    if (guardian2Na) {
      // Explicit N/A for second guardian.
    } else if (guardianHasAnyContent(guardian2)) {
      if (!guardianHasRequiredFields(guardian2)) {
        issue(SK.guardians, 'Please complete Parent/Guardian 2 name and primary phone, or check N/A.');
      }
    } else {
      issue(SK.guardians, 'Please complete Parent/Guardian 2 information or check N/A.');
    }
  }

  if (sectionRequired(template, SK.custody) && !custodyType) {
    issue(SK.custody, 'Please select custody of camper.');
  }
  if (custodyType === 'other' && !custodyOther.trim()) {
    issue(SK.custody, 'Please describe custody (Other).');
  }

  if (sectionEnabled(template, SK.emergencyContacts)) {
    if (sectionRequired(template, SK.emergencyContacts)) {
      if (!emergencyContactsHasCompleteRow(emergencyContacts)) {
        issue(SK.emergencyContacts, 'At least one emergency contact with name and phone is required.');
      }
    } else if (emergencyContactsNa) {
      // Explicit N/A.
    } else if (emergencyContactsHasCompleteRow(emergencyContacts)) {
      // Valid emergency contact provided.
    } else if (emergencyContactsHasAnyContent(emergencyContacts)) {
      issue(SK.emergencyContacts, 'Please complete emergency contact name and phone, or check N/A.');
    } else {
      issue(SK.emergencyContacts, 'Please add an emergency contact or check N/A.');
    }
  }

  if (sectionRequired(template, SK.authorizedPickup)) {
    if (!pickupParentGuardians && !pickupEmergencyContacts && !pickupOther.trim()) {
      issue(SK.authorizedPickup, 'Please select who is authorized for pick-up.');
    }
  }

  if (
    sectionEnabled(template, SK.allergyMedAuthorization) &&
    !allergiesNa &&
    allergies.some((a) => a.allergen.trim()) &&
    !allergyMedAuthAcknowledged
  ) {
    issue(SK.allergyMedAuthorization, 'Please acknowledge allergy medication authorization when allergies are listed.');
  }

  if (sectionEnabled(template, SK.medicalInformation)) {
    if (medicalNeedsNa) {
      // Explicit N/A.
    } else if (!medicalNeedsText.trim()) {
      issue(SK.medicalInformation, 'Please enter medical information or check N/A.');
    }
  }

  if (sectionEnabled(template, SK.allergies)) {
    if (allergiesNa) {
      // Explicit N/A.
    } else if (allergiesHasContent(allergies)) {
      if (!allergies.some((a) => a.allergen.trim())) {
        issue(SK.allergies, 'Please enter at least one allergen or check N/A.');
      }
    } else {
      issue(SK.allergies, 'Please add allergy information or check N/A.');
    }
  }

  if (sectionEnabled(template, SK.medications)) {
    if (medicationsNa) {
      // Explicit N/A.
    } else if (medicationsHasContent(medications)) {
      if (!medications.some((m) => m.name.trim())) {
        issue(SK.medications, 'Please enter at least one medication name or check N/A.');
      }
    } else {
      issue(SK.medications, 'Please add medication information or check N/A.');
    }
  }

  if (sectionRequired(template, SK.campAuthorization)) {
    if (!ackCamp || !ackMedical || !ackOffPremises) {
      issue(SK.campAuthorization, 'Please read and acknowledge all authorization sections.');
    }
    if (!signedByName.trim()) issue(SK.campAuthorization, 'Please enter the signing parent/guardian name.');
    if (!signatureData && !existingSignatureUrl) {
      issue(SK.campAuthorization, 'Parent/guardian signature is required.');
    }
  }

  return { errors, invalidSections, isValid: errors.length === 0 };
}

function YesNoRadio({ name, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      {['yes', 'no'].map((option) => (
        <label key={option} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' }}>
          <input
            type="radio"
            name={name}
            checked={value === option}
            onChange={() => onChange(option)}
          />
          {option === 'yes' ? 'Yes' : 'No'}
        </label>
      ))}
    </div>
  );
}

function SectionNaCheckbox({ checked, onChange, disabled = false }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <TavariCheckbox
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        size="md"
        appearance="native"
        label="Not applicable (N/A)"
        labelStyle={{ fontWeight: 600, color: TavariStyles.colors.gray800 }}
      />
    </div>
  );
}

function applyFormStateToScreen(state, setters) {
  if (!state) return;
  setters.setCamperAddress(state.camperAddress || '');
  setters.setCamperCity(state.camperCity || '');
  setters.setCamperPostal(formatPostalCodeDisplay(state.camperPostal || ''));
  setters.setCamperHomePhone(formatPhoneDisplay(state.camperHomePhone || ''));
  setters.setAgeAtCamp(state.ageAtCamp || '');
  setters.setGuardian1(formatGuardianPhones(state.guardian1));
  setters.setGuardian2(formatGuardianPhones(state.guardian2));
  setters.setCustodyType(state.custodyType || '');
  setters.setCustodyOther(state.custodyOther || '');
  setters.setEmergencyContacts(formatEmergencyContactsForDisplay(state.emergencyContacts));
  setters.setPickupParentGuardians(!!state.pickupParentGuardians);
  setters.setPickupEmergencyContacts(!!state.pickupEmergencyContacts);
  setters.setPickupOther(state.pickupOther || '');
  setters.setMedicalNeedsText(state.medicalNeedsText || '');
  setters.setAllergies(state.allergies || []);
  setters.setAllergyMedAuthAcknowledged(!!state.allergyMedAuthAcknowledged);
  setters.setMedications(state.medications || []);
  setters.setGuardian2Na(!!state.guardian2Na);
  setters.setEmergencyContactsNa(!!state.emergencyContactsNa);
  setters.setMedicalNeedsNa(!!state.medicalNeedsNa);
  setters.setAllergiesNa(!!state.allergiesNa);
  setters.setMedicationsNa(!!state.medicationsNa);
  setters.setAckCamp(!!state.ackCamp);
  setters.setAckMedical(!!state.ackMedical);
  setters.setAckOffPremises(!!state.ackOffPremises);
  setters.setSignedByName(state.signedByName || '');
  setters.setCustomFieldValues(state.customFieldValues || {});
  setters.setExistingSignatureUrl(state.existingSignatureUrl || null);
  setters.setLoadedFromExisting(!!state.loadedFromDocumentId);
}

const CamperRegistrationFormScreen = () => {
  const { businessId, participantId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isPreviewMode = searchParams.get('preview') === '1' || participantId === 'preview';

  const [previewState, setPreviewState] = useState(null);
  const state = previewState || location.state || {};
  const participant = state.participant;
  const customerAccount = state.customerAccount;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const submittingLockRef = useRef(false);
  const [template, setTemplate] = useState(null);
  const [businessName, setBusinessName] = useState('');
  const [businessWebsiteUrl, setBusinessWebsiteUrl] = useState(null);

  const [camperAddress, setCamperAddress] = useState('');
  const [camperCity, setCamperCity] = useState('');
  const [camperPostal, setCamperPostal] = useState('');
  const [camperHomePhone, setCamperHomePhone] = useState('');
  const [ageAtCamp, setAgeAtCamp] = useState('');
  const [camperBirthdate, setCamperBirthdate] = useState(emptyBirthdate);

  const [guardian1, setGuardian1] = useState(emptyGuardian());
  const [guardian2, setGuardian2] = useState(emptyGuardian());
  const [custodyType, setCustodyType] = useState('');
  const [custodyOther, setCustodyOther] = useState('');

  const [emergencyContacts, setEmergencyContacts] = useState([emptyEmergencyContact(), emptyEmergencyContact()]);

  const [pickupParentGuardians, setPickupParentGuardians] = useState(false);
  const [pickupEmergencyContacts, setPickupEmergencyContacts] = useState(false);
  const [pickupOther, setPickupOther] = useState('');

  const [medicalNeedsText, setMedicalNeedsText] = useState('');
  const [allergies, setAllergies] = useState([]);
  const [allergyMedAuthAcknowledged, setAllergyMedAuthAcknowledged] = useState(false);
  const [medications, setMedications] = useState([]);

  const [guardian2Na, setGuardian2Na] = useState(false);
  const [emergencyContactsNa, setEmergencyContactsNa] = useState(false);
  const [medicalNeedsNa, setMedicalNeedsNa] = useState(false);
  const [allergiesNa, setAllergiesNa] = useState(false);
  const [medicationsNa, setMedicationsNa] = useState(false);

  const [ackCamp, setAckCamp] = useState(false);
  const [ackMedical, setAckMedical] = useState(false);
  const [ackOffPremises, setAckOffPremises] = useState(false);

  const [signedByName, setSignedByName] = useState('');
  const [signatureData, setSignatureData] = useState(null);
  const [existingSignatureUrl, setExistingSignatureUrl] = useState(null);
  const [loadedFromExisting, setLoadedFromExisting] = useState(false);
  const [customFieldValues, setCustomFieldValues] = useState({});

  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const sectionRefs = useRef({});

  const camperName = useMemo(() => {
    const first = participant?.first_name || participant?.firstName || '';
    const last = participant?.last_name || participant?.lastName || '';
    return `${first} ${last}`.trim() || 'Camper';
  }, [participant]);

  const authTexts = useMemo(
    () => ({
      ...DEFAULT_AUTHORIZATION_TEXTS,
      ...(template?.fields_config?.authorization_texts || {}),
    }),
    [template]
  );

  const signatureRequired = !existingSignatureUrl || Boolean(signatureData);

  const handleSignatureCaptured = useCallback((value) => {
    setSignatureData(value);
    if (value) setExistingSignatureUrl(null);
  }, []);

  const handleSignatureClear = useCallback(() => {
    setSignatureData(null);
  }, []);

  useEffect(() => {
    if (!isPreviewMode || !businessId) return;

    let cancelled = false;

    const applyPreviewPayload = (parsed) => {
      if (!parsed?.participant || cancelled) return false;
      setPreviewState(parsed);
      if (parsed.previewTemplate) setTemplate(parsed.previewTemplate);
      if (parsed.participant?.date_of_birth) {
        setCamperBirthdate(isoToBirthdateParts(parsed.participant.date_of_birth));
        setAgeAtCamp(computeAgeFromDob(parsed.participant.date_of_birth));
      }
      const ca = parsed.customerAccount;
      if (ca) {
        setCamperHomePhone(formatPhoneDisplay(ca.customer_phone || ca.phone || ''));
        setGuardian1(formatGuardianPhones({
          name: ca.customer_name || '',
          primary_phone: ca.customer_phone || ca.phone || '',
          secondary_phone: '',
          email: ca.customer_email || ca.email || '',
        }));
        setSignedByName(ca.customer_name || '');
      }
      return true;
    };

    (async () => {
      try {
        const stored = readCamperRegistrationPreviewPayload(businessId);
        if (applyPreviewPayload(stored)) {
          if (!cancelled) setLoading(false);
          return;
        }

        camperRegistrationService.setBusinessId(businessId);
        const tpl = await camperRegistrationService.getFormTemplate(businessId);
        if (cancelled) return;
        setTemplate(tpl);
        setPreviewState(CAMPER_REGISTRATION_PREVIEW_SAMPLE);
        applyCamperRegistrationPreviewSample({
          setAgeAtCamp,
          setCamperHomePhone,
          setGuardian1,
          setSignedByName,
        });
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          toast.error(error.message || 'Could not load preview');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isPreviewMode, businessId]);

  useEffect(() => {
    if (isPreviewMode) return;
    if (!businessId || !participant) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        camperRegistrationService.setBusinessId(businessId);
        const tpl = await camperRegistrationService.getFormTemplate(businessId);
        setTemplate(tpl);

        if (participant?.date_of_birth) {
          setCamperBirthdate(isoToBirthdateParts(participant.date_of_birth));
        }

        const accountPhone = customerAccount?.customer_phone || customerAccount?.phone || '';
        const accountEmail = customerAccount?.customer_email || customerAccount?.email || '';
        const accountName = customerAccount?.customer_name || '';

        const accountDefaults = {
          camperHomePhone: formatPhoneDisplay(accountPhone),
          ageAtCamp: computeAgeFromDob(participant.date_of_birth),
          guardian1: formatGuardianPhones({
            name: accountName,
            primary_phone: accountPhone,
            secondary_phone: '',
            email: accountEmail,
          }),
          signedByName: accountName,
        };

        const setters = {
          setCamperAddress,
          setCamperCity,
          setCamperPostal,
          setCamperHomePhone,
          setAgeAtCamp,
          setGuardian1,
          setGuardian2,
          setCustodyType,
          setCustodyOther,
          setEmergencyContacts,
          setPickupParentGuardians,
          setPickupEmergencyContacts,
          setPickupOther,
          setMedicalNeedsText,
          setAllergies,
          setAllergyMedAuthAcknowledged,
          setMedications,
          setGuardian2Na,
          setEmergencyContactsNa,
          setMedicalNeedsNa,
          setAllergiesNa,
          setMedicationsNa,
          setAckCamp,
          setAckMedical,
          setAckOffPremises,
          setSignedByName,
          setCustomFieldValues,
          setExistingSignatureUrl,
          setLoadedFromExisting,
        };

        let prefillDoc = null;
        if (customerAccount?.id) {
          prefillDoc = await camperRegistrationService.getRegistrationPrefill(customerAccount.id, participant);
        }

        if (prefillDoc) {
          const fromDoc = buildCamperRegistrationFormStateFromDocument(prefillDoc);
          applyFormStateToScreen(applyAccountDefaultsToFormState(accountDefaults, fromDoc), setters);
        } else {
          applyFormStateToScreen(applyAccountDefaultsToFormState(accountDefaults, {}), setters);
        }
      } catch (error) {
        toast.error(error.message || 'Could not load form');
      } finally {
        setLoading(false);
      }
    })();
  }, [businessId, participant, customerAccount, isPreviewMode]);

  useEffect(() => {
    if (!businessId) return;
    (async () => {
      const { supabase } = await import('../../supabaseClient');
      const { data } = await supabase.from('businesses').select('name, business_website').eq('id', businessId).maybeSingle();
      if (data?.name) setBusinessName(data.name);
      setBusinessWebsiteUrl(getBusinessWebsiteUrl(data?.business_website));
    })();
  }, [businessId]);

  const updateListItem = (setter, index, patch, clearNa) => {
    if (clearNa) clearNa();
    setter((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const updateAllergyItem = (index, patch) => {
    updateListItem(setAllergies, index, patch, () => setAllergiesNa(false));
  };

  const updateMedicationItem = (index, patch) => {
    updateListItem(setMedications, index, patch, () => setMedicationsNa(false));
  };

  const updateEmergencyContact = (index, patch) => {
    if (emergencyContactsNa) setEmergencyContactsNa(false);
    setEmergencyContacts((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const handleGuardian2Na = (checked) => {
    setGuardian2Na(checked);
    if (checked) setGuardian2(emptyGuardian());
  };

  const handleEmergencyContactsNa = (checked) => {
    setEmergencyContactsNa(checked);
    if (checked) setEmergencyContacts([emptyEmergencyContact(), emptyEmergencyContact()]);
  };

  const handleMedicalNeedsNa = (checked) => {
    setMedicalNeedsNa(checked);
    if (checked) setMedicalNeedsText('');
  };

  const handleAllergiesNa = (checked) => {
    setAllergiesNa(checked);
    if (checked) {
      setAllergies([]);
      setAllergyMedAuthAcknowledged(false);
    }
  };

  const handleMedicationsNa = (checked) => {
    setMedicationsNa(checked);
    if (checked) setMedications([]);
  };

  const updateGuardian2 = (patch) => {
    if (guardian2Na) setGuardian2Na(false);
    setGuardian2((prev) => ({ ...prev, ...patch }));
  };

  const validationContext = useMemo(
    () => ({
      participant,
      template,
      camperBirthdate,
      camperAddress,
      camperCity,
      camperPostal,
      camperHomePhone,
      guardian1,
      guardian2,
      guardian2Na,
      custodyType,
      custodyOther,
      emergencyContacts,
      emergencyContactsNa,
      pickupParentGuardians,
      pickupEmergencyContacts,
      pickupOther,
      medicalNeedsText,
      medicalNeedsNa,
      allergies,
      allergiesNa,
      allergyMedAuthAcknowledged,
      medications,
      medicationsNa,
      ackCamp,
      ackMedical,
      ackOffPremises,
      signedByName,
      signatureData,
      existingSignatureUrl,
    }),
    [
      participant,
      template,
      camperBirthdate,
      camperAddress,
      camperCity,
      camperPostal,
      camperHomePhone,
      guardian1,
      guardian2,
      guardian2Na,
      custodyType,
      custodyOther,
      emergencyContacts,
      emergencyContactsNa,
      pickupParentGuardians,
      pickupEmergencyContacts,
      pickupOther,
      medicalNeedsText,
      medicalNeedsNa,
      allergies,
      allergiesNa,
      allergyMedAuthAcknowledged,
      medications,
      medicationsNa,
      ackCamp,
      ackMedical,
      ackOffPremises,
      signedByName,
      signatureData,
      existingSignatureUrl,
    ]
  );

  const validationSnapshot = useMemo(
    () => collectValidationIssues(validationContext),
    [validationContext]
  );

  const highlightedSections = submitAttempted ? validationSnapshot.invalidSections : new Set();

  const getSectionBoxStyleFor = (sectionKey) => ({
    ...sectionBoxStyle,
    ...(highlightedSections.has(sectionKey)
      ? {
          border: '2px solid #dc2626',
          background: '#fef2f2',
          boxShadow: '0 0 0 1px #fecaca',
        }
      : {}),
  });

  const getSectionTitleStyleFor = (sectionKey) => ({
    ...sectionTitleStyle,
    ...(highlightedSections.has(sectionKey)
      ? {
          color: '#b91c1c',
          borderBottomColor: '#dc2626',
        }
      : {}),
  });

  const bindSection = (sectionKey) => ({
    ref: (el) => {
      if (el) sectionRefs.current[sectionKey] = el;
      else delete sectionRefs.current[sectionKey];
    },
    style: getSectionBoxStyleFor(sectionKey),
  });

  const closeValidationModal = () => {
    setShowValidationModal(false);
    const firstInvalid = validationSnapshot.errors.find((entry) => entry.sectionKey !== 'general')?.sectionKey;
    if (firstInvalid && sectionRefs.current[firstInvalid]) {
      sectionRefs.current[firstInvalid].scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submittingLockRef.current || submitting) return;
    if (isPreviewMode) {
      toast('Preview only — save the form in settings, then complete from the booking portal.');
      return;
    }
    if (!validationSnapshot.isValid) {
      setSubmitAttempted(true);
      setValidationErrors(validationSnapshot.errors);
      setShowValidationModal(true);
      return;
    }
    if (!customerAccount?.id) {
      setSubmitAttempted(true);
      setValidationErrors([{ sectionKey: 'general', message: 'Please sign in to your customer account first.' }]);
      setShowValidationModal(true);
      return;
    }

    setSubmitAttempted(false);
    setShowValidationModal(false);
    setValidationErrors([]);

    submittingLockRef.current = true;
    setSubmitting(true);
    try {
      camperRegistrationService.setBusinessId(businessId);

      const formData = {
        camper_info: {
          address: camperAddress.trim(),
          city: camperCity.trim(),
          postal_code: formatPostalCodeDisplay(camperPostal.trim()),
          home_phone: camperHomePhone.trim(),
          age_at_camp: ageAtCamp.trim(),
        },
        guardians: {
          guardian_1: {
            name: guardian1.name.trim(),
            primary_phone: guardian1.primary_phone.trim(),
            secondary_phone: guardian1.secondary_phone.trim(),
            email: guardian1.email.trim(),
          },
          guardian_2: {
            name: guardian2.name.trim(),
            primary_phone: guardian2.primary_phone.trim(),
            secondary_phone: guardian2.secondary_phone.trim(),
            email: guardian2.email.trim(),
          },
        },
        custody: {
          type: custodyType,
          other_detail: custodyOther.trim(),
        },
        emergency_contacts: emergencyContacts
          .map((c) => ({ name: c.name.trim(), phone: c.phone.trim() }))
          .filter((c) => c.name || c.phone),
        authorized_pickup: {
          parent_guardians: pickupParentGuardians,
          emergency_contacts: pickupEmergencyContacts,
          other_detail: pickupOther.trim(),
        },
        medical_needs: medicalNeedsText.trim(),
        allergies: allergies
          .filter((a) => a.allergen.trim() || a.potential_symptoms.trim() || a.other.trim())
          .map((a) => ({
            allergen: a.allergen.trim(),
            potential_symptoms: a.potential_symptoms.trim(),
            other: a.other.trim(),
            is_anaphylactic: a.is_anaphylactic || null,
            has_epipen: a.has_epipen || null,
          })),
        allergy_med_authorization_acknowledged: allergyMedAuthAcknowledged,
        medications: medications
          .filter((m) => m.name.trim())
          .map((m) => ({
            name: m.name.trim(),
            dosage_instructions: m.dosage_instructions.trim(),
            time_to_dispense: m.time_to_dispense.trim(),
            refrigeration: m.refrigeration || null,
          })),
        camp_authorization: {
          camp_acknowledged: ackCamp,
          medical_acknowledged: ackMedical,
          off_premises_acknowledged: ackOffPremises,
        },
        custom_fields: customFieldValues,
        section_na: {
          guardian_2: guardian2Na,
          emergency_contacts:
            sectionEnabled(template, CAMPER_REGISTRATION_SECTION_KEYS.emergencyContacts) &&
            !sectionRequired(template, CAMPER_REGISTRATION_SECTION_KEYS.emergencyContacts)
              ? emergencyContactsNa
              : false,
          medical_information: medicalNeedsNa,
          allergies: allergiesNa,
          medications: medicationsNa,
        },
        signed_at: new Date().toISOString(),
      };

      const filteredAllergies = formData.allergies;
      const filteredMedications = formData.medications;

      const medicalSummary = {
        medical_needs: formData.medical_needs,
        allergies: filteredAllergies,
        medications: filteredMedications,
        has_alerts:
          (!medicalNeedsNa && !!formData.medical_needs) ||
          (!allergiesNa && filteredAllergies.length > 0) ||
          (!medicationsNa && filteredMedications.length > 0),
      };

      const authorizedPickups = [];
      if (pickupParentGuardians) {
        if (guardian1.name.trim()) {
          authorizedPickups.push({ name: guardian1.name.trim(), relationship: 'Parent/Guardian 1', source: 'parent_guardians' });
        }
        if (guardian2.name.trim()) {
          authorizedPickups.push({ name: guardian2.name.trim(), relationship: 'Parent/Guardian 2', source: 'parent_guardians' });
        }
      }
      if (pickupEmergencyContacts) {
        formData.emergency_contacts.forEach((c) => {
          if (c.name) authorizedPickups.push({ name: c.name, relationship: 'Emergency contact', source: 'emergency_contacts' });
        });
      }
      if (pickupOther.trim()) {
        authorizedPickups.push({ name: pickupOther.trim(), relationship: 'Other', source: 'other' });
      }

      const signatureImage =
        signatureData?.imageUrl || signatureData?.imageData || existingSignatureUrl || null;

      const dateOfBirth = birthdatePartsToIso(camperBirthdate) || participant.date_of_birth || null;

      await camperRegistrationService.submitRegistration({
        customerId: customerAccount.id,
        participant: {
          ...participant,
          date_of_birth: dateOfBirth,
        },
        formData,
        authorizedPickups,
        medicalSummary,
        signatureImageUrl: signatureImage,
        signatureData: signatureImage ? { dataUrl: signatureImage } : null,
        signedByName: signedByName.trim(),
        signedByRelationship: 'Parent/Guardian',
        expiryDays: template?.expiry_days || 365,
      });

      const returnUrl =
        searchParams.get('returnUrl') ||
        state?.returnUrl ||
        null;

      if (returnUrl) {
        // Resume booking portal compliance after in-checkout registration
        window.location.assign(returnUrl);
        return;
      }

      let websiteUrl = businessWebsiteUrl;
      if (!websiteUrl && businessId) {
        const { data: businessRow } = await supabase
          .from('businesses')
          .select('business_website')
          .eq('id', businessId)
          .maybeSingle();
        websiteUrl = getBusinessWebsiteUrl(businessRow?.business_website);
      }

      if (websiteUrl) {
        window.location.assign(websiteUrl);
        return;
      }

      navigate(`/customer-portal/${businessId}/camp-registration/complete`, {
        replace: true,
        state: {
          camperName,
          wasUpdate: loadedFromExisting,
        },
      });
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Could not save registration');
    } finally {
      submittingLockRef.current = false;
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center' }}>Loading form…</div>;
  }

  if (!participant && !isPreviewMode) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p>
          Camper information is missing. Open this form from the{' '}
          <a href={`/customer-portal/${businessId}/camp-registration`}>camp registration portal</a> or the booking portal.
        </p>
      </div>
    );
  }

  if (isPreviewMode && !previewState?.participant && !loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p>Could not load preview. Return to Bookings settings and click Preview form again.</p>
      </div>
    );
  }

  if (
    !isPreviewMode &&
    participant &&
    !camperRegistrationService.participantRequiresCamperRegistration(participant, true)
  ) {
    return (
      <div style={{ padding: 40, textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
        <p style={{ lineHeight: 1.5 }}>
          The annual camp registration form is for <strong>minor campers</strong> only. Parents and adult
          chaperones do not complete this form.
        </p>
      </div>
    );
  }

  const customFields = template?.fields_config?.custom_fields || [];
  const medicalPrompt = sectionPrompt(
    template,
    CAMPER_REGISTRATION_SECTION_KEYS.medicalInformation,
    "Please describe any allergies or medical needs your child's camp staff should know about:"
  );
  const emergencyHelperText = sectionField(
    template,
    CAMPER_REGISTRATION_SECTION_KEYS.emergencyContacts,
    'helper_text',
    'Other than parent/guardian'
  );
  const pickupIdNote = sectionField(
    template,
    CAMPER_REGISTRATION_SECTION_KEYS.authorizedPickup,
    'pickup_id_note',
    'Staff will verify photo ID at pickup. We do not store photos of government IDs.'
  );

  return (
    <div style={{ minHeight: '100vh', background: TavariStyles.colors.gray50, padding: '24px 16px 48px' }}>
      {isPreviewMode && (
        <div
          style={{
            maxWidth: 820,
            margin: '0 auto 16px',
            padding: '12px 16px',
            borderRadius: 8,
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            color: '#1e40af',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Preview mode — changes here are not saved. Close this tab when done reviewing.
        </div>
      )}
      {loadedFromExisting && !isPreviewMode && (
        <div
          style={{
            maxWidth: 820,
            margin: '0 auto 16px',
            padding: '12px 16px',
            borderRadius: 8,
            background: '#ecfdf5',
            border: '1px solid #10b981',
            color: '#065f46',
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          Your previous registration has been loaded below. Review and change any fields, then submit to save an
          updated form.
        </div>
      )}
      <form
        onSubmit={handleSubmit}
        style={{
          maxWidth: 820,
          margin: '0 auto',
          background: '#fff',
          borderRadius: 12,
          border: `1px solid ${TavariStyles.colors.gray200}`,
          padding: '24px 20px',
        }}
      >
        <div style={{ marginBottom: 24, textAlign: 'center' }}>
          {businessName ? (
            <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginBottom: 4 }}>{businessName}</div>
          ) : null}
          <h1 style={{ margin: '0 0 8px', fontSize: 23, fontWeight: 700 }}>
            {template?.form_title || 'Camp Registration & Medical Form'}
          </h1>
          {template?.form_intro ? (
            <p style={{ margin: 0, fontSize: 14, color: TavariStyles.colors.gray700, lineHeight: 1.5 }}>
              {template.form_intro}
            </p>
          ) : null}
        </div>

        {sectionEnabled(template, CAMPER_REGISTRATION_SECTION_KEYS.camperInfo) && (
          <div {...bindSection(CAMPER_REGISTRATION_SECTION_KEYS.camperInfo)}>
            <h2 style={getSectionTitleStyleFor(CAMPER_REGISTRATION_SECTION_KEYS.camperInfo)}>
              {sectionLabel(template, CAMPER_REGISTRATION_SECTION_KEYS.camperInfo, 'Camper information')}
            </h2>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={labelStyle}>Name</label>
                <input style={{ ...inputStyle, background: TavariStyles.colors.gray50 }} value={camperName} readOnly />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Birthdate</label>
                  <BirthdateCalendarPicker
                    value={camperBirthdate}
                    onChange={(birthdate) => handleCamperBirthdateChange(birthdate, setCamperBirthdate, setAgeAtCamp)}
                    yearRangeBack={19}
                    disabled={isPreviewMode}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Age at camp</label>
                  <input
                    style={inputStyle}
                    value={ageAtCamp}
                    onChange={(e) => setAgeAtCamp(e.target.value)}
                    placeholder="Age"
                  />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Address{sectionRequired(template, CAMPER_REGISTRATION_SECTION_KEYS.camperInfo) ? ' *' : ''}</label>
                <input style={inputStyle} value={camperAddress} onChange={(e) => setCamperAddress(e.target.value)} required={sectionRequired(template, CAMPER_REGISTRATION_SECTION_KEYS.camperInfo)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 12 }}>
                <div>
                  <label style={labelStyle}>City{sectionRequired(template, CAMPER_REGISTRATION_SECTION_KEYS.camperInfo) ? ' *' : ''}</label>
                  <input style={inputStyle} value={camperCity} onChange={(e) => setCamperCity(e.target.value)} required={sectionRequired(template, CAMPER_REGISTRATION_SECTION_KEYS.camperInfo)} />
                </div>
                <div>
                  <label style={labelStyle}>Postal code{sectionRequired(template, CAMPER_REGISTRATION_SECTION_KEYS.camperInfo) ? ' *' : ''}</label>
                  <input style={inputStyle} value={camperPostal} onChange={(e) => setCamperPostal(formatPostalCodeInput(e.target.value))} placeholder="A1A 1A1" autoComplete="postal-code" maxLength={7} required={sectionRequired(template, CAMPER_REGISTRATION_SECTION_KEYS.camperInfo)} />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Home phone number{sectionRequired(template, CAMPER_REGISTRATION_SECTION_KEYS.camperInfo) ? ' *' : ''}</label>
                <input style={inputStyle} type="tel" value={camperHomePhone} onChange={(e) => setCamperHomePhone(formatPhoneInput(e.target.value))} placeholder="(519) 555-1234" required={sectionRequired(template, CAMPER_REGISTRATION_SECTION_KEYS.camperInfo)} />
              </div>
            </div>
          </div>
        )}

        {sectionEnabled(template, CAMPER_REGISTRATION_SECTION_KEYS.guardians) && (
          <div {...bindSection(CAMPER_REGISTRATION_SECTION_KEYS.guardians)}>
            <h2 style={getSectionTitleStyleFor(CAMPER_REGISTRATION_SECTION_KEYS.guardians)}>
              {sectionLabel(template, CAMPER_REGISTRATION_SECTION_KEYS.guardians, 'Parent/guardian information')}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
              <div style={{ padding: 14, borderRadius: 8, background: TavariStyles.colors.gray50, border: `1px solid ${TavariStyles.colors.gray200}` }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Parent/Guardian 1</div>
                <div style={{ display: 'grid', gap: 10 }}>
                  <div>
                    <label style={labelStyle}>
                      Name{sectionRequired(template, CAMPER_REGISTRATION_SECTION_KEYS.guardians) ? ' *' : ''}
                    </label>
                    <input
                      style={inputStyle}
                      value={guardian1.name}
                      onChange={(e) => setGuardian1((p) => ({ ...p, name: e.target.value }))}
                      required={sectionRequired(template, CAMPER_REGISTRATION_SECTION_KEYS.guardians)}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>
                      Primary phone{sectionRequired(template, CAMPER_REGISTRATION_SECTION_KEYS.guardians) ? ' *' : ''}
                    </label>
                    <input
                      style={inputStyle}
                      type="tel"
                      value={guardian1.primary_phone}
                      onChange={(e) => setGuardian1((p) => ({ ...p, primary_phone: formatPhoneInput(e.target.value) }))}
                      placeholder="(519) 555-1234"
                      required={sectionRequired(template, CAMPER_REGISTRATION_SECTION_KEYS.guardians)}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Secondary phone</label>
                    <input
                      style={inputStyle}
                      type="tel"
                      value={guardian1.secondary_phone}
                      onChange={(e) => setGuardian1((p) => ({ ...p, secondary_phone: formatPhoneInput(e.target.value) }))}
                      placeholder="(519) 555-1234"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>E-mail</label>
                    <input
                      style={inputStyle}
                      type="email"
                      value={guardian1.email}
                      onChange={(e) => setGuardian1((p) => ({ ...p, email: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
              <div style={{ padding: 14, borderRadius: 8, background: TavariStyles.colors.gray50, border: `1px solid ${TavariStyles.colors.gray200}` }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Parent/Guardian 2</div>
                <SectionNaCheckbox checked={guardian2Na} onChange={handleGuardian2Na} />
                <div style={{ display: 'grid', gap: 10, opacity: guardian2Na ? 0.55 : 1 }}>
                  <div>
                    <label style={labelStyle}>Name</label>
                    <input
                      style={inputStyle}
                      value={guardian2.name}
                      onChange={(e) => updateGuardian2({ name: e.target.value })}
                      disabled={guardian2Na}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Primary phone</label>
                    <input
                      style={inputStyle}
                      type="tel"
                      value={guardian2.primary_phone}
                      onChange={(e) => updateGuardian2({ primary_phone: formatPhoneInput(e.target.value) })}
                      placeholder="(519) 555-1234"
                      disabled={guardian2Na}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Secondary phone</label>
                    <input
                      style={inputStyle}
                      type="tel"
                      value={guardian2.secondary_phone}
                      onChange={(e) => updateGuardian2({ secondary_phone: formatPhoneInput(e.target.value) })}
                      placeholder="(519) 555-1234"
                      disabled={guardian2Na}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>E-mail</label>
                    <input
                      style={inputStyle}
                      type="email"
                      value={guardian2.email}
                      onChange={(e) => updateGuardian2({ email: e.target.value })}
                      disabled={guardian2Na}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {sectionEnabled(template, CAMPER_REGISTRATION_SECTION_KEYS.custody) && (
          <div {...bindSection(CAMPER_REGISTRATION_SECTION_KEYS.custody)}>
            <h2 style={getSectionTitleStyleFor(CAMPER_REGISTRATION_SECTION_KEYS.custody)}>
              {sectionLabel(template, CAMPER_REGISTRATION_SECTION_KEYS.custody, 'Custody of camper')}
            </h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
              {CUSTODY_OPTIONS.map((opt) => (
                <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="custody"
                    checked={custodyType === opt.value}
                    onChange={() => setCustodyType(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            {custodyType === 'other' && (
              <div>
                <label style={labelStyle}>Other (please specify)</label>
                <input style={inputStyle} value={custodyOther} onChange={(e) => setCustodyOther(e.target.value)} />
              </div>
            )}
          </div>
        )}

        {sectionEnabled(template, CAMPER_REGISTRATION_SECTION_KEYS.emergencyContacts) && (
          <div {...bindSection(CAMPER_REGISTRATION_SECTION_KEYS.emergencyContacts)}>
            <h2 style={getSectionTitleStyleFor(CAMPER_REGISTRATION_SECTION_KEYS.emergencyContacts)}>
              {sectionLabel(template, CAMPER_REGISTRATION_SECTION_KEYS.emergencyContacts, 'Emergency contact')}
            </h2>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: TavariStyles.colors.gray600 }}>
              {emergencyHelperText}
            </p>
            {!sectionRequired(template, CAMPER_REGISTRATION_SECTION_KEYS.emergencyContacts) && (
              <SectionNaCheckbox checked={emergencyContactsNa} onChange={handleEmergencyContactsNa} />
            )}
            <div style={{ display: 'grid', gap: 12, opacity: emergencyContactsNa ? 0.55 : 1 }}>
              {emergencyContacts.map((row, index) => (
                <div key={`ec-${index}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Name</label>
                    <input
                      style={inputStyle}
                      value={row.name}
                      onChange={(e) => updateEmergencyContact(index, { name: e.target.value })}
                      disabled={emergencyContactsNa}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Preferred contact number</label>
                    <input
                      style={inputStyle}
                      type="tel"
                      value={row.phone}
                      onChange={(e) => updateEmergencyContact(index, { phone: formatPhoneInput(e.target.value) })}
                      placeholder="(519) 555-1234"
                      disabled={emergencyContactsNa}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {sectionEnabled(template, CAMPER_REGISTRATION_SECTION_KEYS.authorizedPickup) && (
          <div {...bindSection(CAMPER_REGISTRATION_SECTION_KEYS.authorizedPickup)}>
            <h2 style={getSectionTitleStyleFor(CAMPER_REGISTRATION_SECTION_KEYS.authorizedPickup)}>
              {sectionLabel(template, CAMPER_REGISTRATION_SECTION_KEYS.authorizedPickup, 'Authorized pick-up')}
            </h2>
            <p style={{ margin: '0 0 12px', fontSize: 14, color: TavariStyles.colors.gray700 }}>
              Who is authorized to pick-up at the end of camp?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                <TavariCheckbox checked={pickupParentGuardians} onChange={setPickupParentGuardians} size="md" />
                Parent/Guardian(s)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                <TavariCheckbox checked={pickupEmergencyContacts} onChange={setPickupEmergencyContacts} size="md" />
                Emergency contact(s)
              </label>
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>Other:</span>
                </label>
                <input
                  style={inputStyle}
                  placeholder="Names of other authorized pick-up people"
                  value={pickupOther}
                  onChange={(e) => setPickupOther(e.target.value)}
                />
                <p style={{ margin: '8px 0 0', fontSize: 13, color: TavariStyles.colors.gray600 }}>
                  {pickupIdNote}
                </p>
              </div>
            </div>
          </div>
        )}

        {sectionEnabled(template, CAMPER_REGISTRATION_SECTION_KEYS.medicalInformation) && (
          <div {...bindSection(CAMPER_REGISTRATION_SECTION_KEYS.medicalInformation)}>
            <h2 style={getSectionTitleStyleFor(CAMPER_REGISTRATION_SECTION_KEYS.medicalInformation)}>
              {sectionLabel(template, CAMPER_REGISTRATION_SECTION_KEYS.medicalInformation, 'Medical information')}
            </h2>
            <SectionNaCheckbox checked={medicalNeedsNa} onChange={handleMedicalNeedsNa} />
            <label style={labelStyle}>{medicalPrompt}</label>
            <textarea
              style={{ ...inputStyle, minHeight: 90, resize: 'vertical', opacity: medicalNeedsNa ? 0.55 : 1 }}
              value={medicalNeedsText}
              onChange={(e) => {
                if (medicalNeedsNa) setMedicalNeedsNa(false);
                setMedicalNeedsText(e.target.value);
              }}
              disabled={medicalNeedsNa}
              placeholder="e.g. medical devices, care instructions, general health notes"
            />
          </div>
        )}

        {sectionEnabled(template, CAMPER_REGISTRATION_SECTION_KEYS.allergies) && (
          <div {...bindSection(CAMPER_REGISTRATION_SECTION_KEYS.allergies)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ ...getSectionTitleStyleFor(CAMPER_REGISTRATION_SECTION_KEYS.allergies), margin: 0, border: 'none', padding: 0 }}>
                {sectionLabel(template, CAMPER_REGISTRATION_SECTION_KEYS.allergies, 'Allergy information')}
              </h2>
              {!allergiesNa && (
                <button
                  type="button"
                  onClick={() => setAllergies((p) => [...p, emptyAllergy()])}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    borderRadius: 8,
                    border: `1px solid ${TavariStyles.colors.gray300}`,
                    background: '#fff',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  <FiPlus size={14} />
                  Add allergy
                </button>
              )}
            </div>
            <SectionNaCheckbox checked={allergiesNa} onChange={handleAllergiesNa} />
            {!allergiesNa && allergies.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: TavariStyles.colors.gray600 }}>
                Add an allergy below, or check N/A if none apply.
              </p>
            ) : null}
            {!allergiesNa && allergies.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {allergies.map((row, index) => (
                  <RepeaterRow key={`al-${index}`} onRemove={() => setAllergies((p) => p.filter((_, i) => i !== index))}>
                    <input style={inputStyle} placeholder="Allergen" value={row.allergen} onChange={(e) => updateAllergyItem(index, { allergen: e.target.value })} />
                    <input style={inputStyle} placeholder="Potential symptoms" value={row.potential_symptoms} onChange={(e) => updateAllergyItem(index, { potential_symptoms: e.target.value })} />
                    <input style={inputStyle} placeholder="Other" value={row.other} onChange={(e) => updateAllergyItem(index, { other: e.target.value })} />
                    <div>
                      <label style={{ ...labelStyle, marginBottom: 4 }}>Is this an anaphylactic allergy?</label>
                      <YesNoRadio name={`anaphylactic-${index}`} value={row.is_anaphylactic} onChange={(v) => updateAllergyItem(index, { is_anaphylactic: v })} />
                    </div>
                    <div>
                      <label style={{ ...labelStyle, marginBottom: 4 }}>Does the participant have an Epi-Pen for this allergy?</label>
                      <YesNoRadio name={`epipen-${index}`} value={row.has_epipen} onChange={(v) => updateAllergyItem(index, { has_epipen: v })} />
                    </div>
                  </RepeaterRow>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {sectionEnabled(template, CAMPER_REGISTRATION_SECTION_KEYS.allergyMedAuthorization) &&
          !allergiesNa &&
          allergies.length > 0 && (
          <div {...bindSection(CAMPER_REGISTRATION_SECTION_KEYS.allergyMedAuthorization)}>
            <h2 style={getSectionTitleStyleFor(CAMPER_REGISTRATION_SECTION_KEYS.allergyMedAuthorization)}>
              {sectionLabel(
                template,
                CAMPER_REGISTRATION_SECTION_KEYS.allergyMedAuthorization,
                'Allergy medication authorization'
              )}
            </h2>
            <p style={{ margin: '0 0 12px', fontSize: 14, color: TavariStyles.colors.gray700, lineHeight: 1.5 }}>
              {authTexts.allergy_med_admin}
            </p>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14 }}>
              <TavariCheckbox checked={allergyMedAuthAcknowledged} onChange={setAllergyMedAuthAcknowledged} size="md" />
              <span>I authorize camp staff to administer medication as described above.</span>
            </label>
          </div>
        )}

        {sectionEnabled(template, CAMPER_REGISTRATION_SECTION_KEYS.medications) && (
          <div {...bindSection(CAMPER_REGISTRATION_SECTION_KEYS.medications)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ ...getSectionTitleStyleFor(CAMPER_REGISTRATION_SECTION_KEYS.medications), margin: 0, border: 'none', padding: 0 }}>
                {sectionLabel(template, CAMPER_REGISTRATION_SECTION_KEYS.medications, 'Medication information')}
              </h2>
              {!medicationsNa && (
                <button
                  type="button"
                  onClick={() => setMedications((p) => [...p, emptyMedication()])}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    borderRadius: 8,
                    border: `1px solid ${TavariStyles.colors.gray300}`,
                    background: '#fff',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  <FiPlus size={14} />
                  Add medication
                </button>
              )}
            </div>
            <SectionNaCheckbox checked={medicationsNa} onChange={handleMedicationsNa} />
            {!medicationsNa && medications.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: TavariStyles.colors.gray600 }}>
                Add a medication below, or check N/A if none apply.
              </p>
            ) : null}
            {!medicationsNa && medications.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {medications.map((row, index) => (
                  <RepeaterRow key={`med-${index}`} onRemove={() => setMedications((p) => p.filter((_, i) => i !== index))}>
                    <input style={inputStyle} placeholder="Medication name" value={row.name} onChange={(e) => updateMedicationItem(index, { name: e.target.value })} />
                    <input style={inputStyle} placeholder="Dosage / instructions" value={row.dosage_instructions} onChange={(e) => updateMedicationItem(index, { dosage_instructions: e.target.value })} />
                    <input style={inputStyle} placeholder="Time to dispense" value={row.time_to_dispense} onChange={(e) => updateMedicationItem(index, { time_to_dispense: e.target.value })} />
                    <div>
                      <label style={{ ...labelStyle, marginBottom: 4 }}>Refrigeration (Y / N)</label>
                      <YesNoRadio name={`fridge-${index}`} value={row.refrigeration} onChange={(v) => updateMedicationItem(index, { refrigeration: v })} />
                    </div>
                  </RepeaterRow>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {customFields.length > 0 && (
          <div style={sectionBoxStyle}>
            <h2 style={sectionTitleStyle}>Additional questions</h2>
            <div style={{ display: 'grid', gap: 14 }}>
              {customFields.map((field) => (
                <div key={field.field_key}>
                  <label style={labelStyle}>
                    {field.field_label}
                    {field.is_required ? ' *' : ''}
                  </label>
                  {field.field_type === 'textarea' ? (
                    <textarea
                      style={{ ...inputStyle, minHeight: 70 }}
                      required={!!field.is_required}
                      value={customFieldValues[field.field_key] || ''}
                      onChange={(e) => setCustomFieldValues((p) => ({ ...p, [field.field_key]: e.target.value }))}
                    />
                  ) : field.field_type === 'checkbox' ? (
                    <TavariCheckbox
                      checked={!!customFieldValues[field.field_key]}
                      onChange={(checked) => setCustomFieldValues((p) => ({ ...p, [field.field_key]: checked }))}
                    />
                  ) : (
                    <input
                      style={inputStyle}
                      required={!!field.is_required}
                      value={customFieldValues[field.field_key] || ''}
                      onChange={(e) => setCustomFieldValues((p) => ({ ...p, [field.field_key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {sectionEnabled(template, CAMPER_REGISTRATION_SECTION_KEYS.campAuthorization) && (
          <div {...bindSection(CAMPER_REGISTRATION_SECTION_KEYS.campAuthorization)}>
            <h2 style={getSectionTitleStyleFor(CAMPER_REGISTRATION_SECTION_KEYS.campAuthorization)}>
              {sectionLabel(
                template,
                CAMPER_REGISTRATION_SECTION_KEYS.campAuthorization,
                'Camp & medical authorization'
              )}
            </h2>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Camp authorization</div>
              <p style={{ margin: '0 0 10px', fontSize: 14, color: TavariStyles.colors.gray700, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                {authTexts.camp}
              </p>
              <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14 }}>
                <TavariCheckbox checked={ackCamp} onChange={setAckCamp} size="md" />
                <span>I have read and agree to the camp authorization above.</span>
              </label>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Medical authorization</div>
              <p style={{ margin: '0 0 10px', fontSize: 14, color: TavariStyles.colors.gray700, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                {authTexts.medical}
              </p>
              <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14 }}>
                <TavariCheckbox checked={ackMedical} onChange={setAckMedical} size="md" />
                <span>I have read and agree to the medical authorization above.</span>
              </label>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Off premises activities authorization</div>
              <p style={{ margin: '0 0 10px', fontSize: 14, color: TavariStyles.colors.gray700, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                {authTexts.off_premises}
              </p>
              <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14 }}>
                <TavariCheckbox checked={ackOffPremises} onChange={setAckOffPremises} size="md" />
                <span>I have read and agree to the off premises activities authorization above.</span>
              </label>
            </div>

            <div style={{ paddingTop: 12, borderTop: `1px solid ${TavariStyles.colors.gray200}` }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Signature of parent/guardian</h3>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Signing name *</label>
                <input style={inputStyle} value={signedByName} onChange={(e) => setSignedByName(e.target.value)} required />
              </div>
              {existingSignatureUrl && !signatureData ? (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: TavariStyles.colors.gray700 }}>
                    Previous signature on file
                  </div>
                  <img
                    src={existingSignatureUrl}
                    alt="Previous signature"
                    style={{
                      maxWidth: 280,
                      maxHeight: 80,
                      border: `1px solid ${TavariStyles.colors.gray300}`,
                      borderRadius: 4,
                      background: '#fff',
                    }}
                  />
                  <p style={{ margin: '8px 0 0', fontSize: 13, color: TavariStyles.colors.gray600 }}>
                    Draw a new signature below to replace it, or leave the box empty to keep this signature.
                  </p>
                </div>
              ) : null}
              <WaiverSignatureCapture
                onSignatureCaptured={handleSignatureCaptured}
                onClear={handleSignatureClear}
                required={signatureRequired}
              />
              <div style={{ marginTop: 12, fontSize: 13, color: TavariStyles.colors.gray600 }}>
                Date signed: {new Date().toLocaleDateString('en-CA')}
              </div>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            width: '100%',
            padding: '14px 20px',
            borderRadius: 8,
            border: 'none',
            background: TavariStyles.colors.primary,
            color: '#fff',
            fontWeight: 700,
            fontSize: 16,
            cursor: submitting ? 'not-allowed' : 'pointer',
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? 'Saving…' : loadedFromExisting ? 'Save updated registration' : 'Submit camp registration & medical form'}
        </button>
      </form>

      {showValidationModal ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 10000,
          }}
          onClick={closeValidationModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="camper-registration-validation-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: 24,
              width: 'min(520px, 100%)',
              maxHeight: '90vh',
              overflow: 'auto',
              border: '1px solid #fecaca',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.18)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <h2 id="camper-registration-validation-title" style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#b91c1c' }}>
                Please complete required fields
              </h2>
              <button
                type="button"
                onClick={closeValidationModal}
                aria-label="Close"
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, color: TavariStyles.colors.gray600 }}
              >
                <FiX size={20} />
              </button>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 14, color: TavariStyles.colors.gray700, lineHeight: 1.5 }}>
              Some sections still need attention. They are highlighted in red on the form below.
            </p>
            <ul style={{ margin: '0 0 20px', paddingLeft: 20, color: '#374151', fontSize: 14, lineHeight: 1.6 }}>
              {validationErrors.map((entry, index) => (
                <li key={`${entry.sectionKey}-${index}`}>{entry.message}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={closeValidationModal}
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: 8,
                border: 'none',
                background: TavariStyles.colors.primary,
                color: '#fff',
                fontWeight: 700,
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              Go to form
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

function RepeaterRow({ children, onRemove }) {
  return (
    <div style={{ padding: 12, borderRadius: 8, border: `1px solid ${TavariStyles.colors.gray200}`, background: TavariStyles.colors.gray50 }}>
      <div style={{ display: 'grid', gap: 8 }}>{children}</div>
      {onRemove ? (
        <button type="button" onClick={onRemove} style={{ marginTop: 8, border: 'none', background: 'transparent', color: '#b91c1c', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
          <FiTrash2 size={14} /> Remove
        </button>
      ) : null}
    </div>
  );
}

export default CamperRegistrationFormScreen;
