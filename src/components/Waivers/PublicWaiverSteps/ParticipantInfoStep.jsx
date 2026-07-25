// Participant Information Entry Step
import React, { useState, useEffect, useRef } from 'react';
import { FiUser, FiArrowRight, FiPlus } from 'react-icons/fi';
import { TavariStyles } from '../../../utils/TavariStyles';
import { useInactivityTimer } from '../../../hooks/useInactivityTimer';
import {
  WAIVER_POST_OTP_TIMEOUT_SECONDS,
  WAIVER_TIMEOUT_WARNING_SECONDS
} from '../../../constants/waiverInactivity';
import TavariCheckbox from '../../UI/TavariCheckbox';
import CancelConfirmationModal from './CancelConfirmationModal';
import TimeoutWarningModal from './TimeoutWarningModal';
import {
  birthFormPartsFromValue,
  combineBirthFormPartsToIso,
  calculateAgeFromIsoDateOfBirth,
  parseIsoCalendarDate
} from '../../../utils/waiverDateOfBirth';
import { getCurrentBusinessDate } from '../../../utils/businessDateFormat';

const DEFAULT_PARTICIPANT_FIELDS_CONFIG = {
  participantFields: {
    phoneNumber: true,
    emailAddress: true,
    firstName: true,
    lastName: true,
    birthdate: true,
    address: true,
    city: true,
    postalCode: true
  },
  minorFields: {}
};

const FIELD_KEY_ALIASES = {
  streetAddress: 'address',
  street_address: 'address'
};

const extractParticipantFieldsConfig = (value) => {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const rootParticipantFields = {};
  const rootMinorFields = {};

  ['firstName', 'lastName', 'birthdate', 'phoneNumber', 'emailAddress', 'address', 'city', 'postalCode'].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      rootParticipantFields[key] = config[key];
    }
  });

  Object.keys(FIELD_KEY_ALIASES).forEach((legacyKey) => {
    if (Object.prototype.hasOwnProperty.call(config, legacyKey)) {
      rootParticipantFields[FIELD_KEY_ALIASES[legacyKey]] = config[legacyKey];
    }
  });

  if (config.minorFields && typeof config.minorFields === 'object' && !Array.isArray(config.minorFields)) {
    Object.assign(rootMinorFields, config.minorFields);
  }

  if (config.participantFields && typeof config.participantFields === 'object' && !Array.isArray(config.participantFields)) {
    Object.assign(rootParticipantFields, config.participantFields);
    Object.keys(FIELD_KEY_ALIASES).forEach((legacyKey) => {
      if (Object.prototype.hasOwnProperty.call(config.participantFields, legacyKey)) {
        rootParticipantFields[FIELD_KEY_ALIASES[legacyKey]] = config.participantFields[legacyKey];
      }
    });
  }

  return {
    participantFields: rootParticipantFields,
    minorFields: rootMinorFields
  };
};

const normalizeParticipantFieldsConfig = (...values) => {
  const merged = values.reduce(
    (acc, value) => {
      const extracted = extractParticipantFieldsConfig(value);
      return {
        participantFields: {
          ...acc.participantFields,
          ...extracted.participantFields
        },
        minorFields: {
          ...acc.minorFields,
          ...extracted.minorFields
        }
      };
    },
    {
      participantFields: {},
      minorFields: {}
    }
  );

  return {
    participantFields: {
      ...DEFAULT_PARTICIPANT_FIELDS_CONFIG.participantFields,
      ...merged.participantFields
    },
    minorFields: {
      ...merged.minorFields
    }
  };
};

const getExplicitParticipantFieldValue = (value, key) => {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  if (!config) return undefined;

  const aliases = Object.keys(FIELD_KEY_ALIASES).filter((aliasKey) => FIELD_KEY_ALIASES[aliasKey] === key);
  const candidateKeys = [key, ...aliases];

  for (const candidateKey of candidateKeys) {
    if (Object.prototype.hasOwnProperty.call(config, candidateKey)) {
      return config[candidateKey];
    }
  }

  const nested = config.participantFields && typeof config.participantFields === 'object' && !Array.isArray(config.participantFields)
    ? config.participantFields
    : null;
  if (!nested) return undefined;

  for (const candidateKey of candidateKeys) {
    if (Object.prototype.hasOwnProperty.call(nested, candidateKey)) {
      return nested[candidateKey];
    }
  }

  return undefined;
};

const ParticipantInfoStep = ({
  participant,
  formData,
  setFormData,
  onSubmit,
  customerInfo,
  onCancel,
  onBack,
  backLabel = 'Back',
  submitLabel = 'Continue',
  minorAgeThreshold = 18,
  waiverSettings = {},
  template = {},
  participants = [],
  onAddChild,
  embedded = false,
  suspendInactivityTimer = false,
  businessTimezone = 'America/Toronto'
}) => {
  const [errors, setErrors] = useState({});
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [usePrimaryAddress, setUsePrimaryAddress] = useState(false);
  const isMinor = participant?.type === 'minor';
  const isAdditionalAdult = participant?.type === 'additional_adult';
  const initializedParticipantRef = useRef(null);
  const firstNameInputRef = useRef(null);
  // Latest customer info without listing customerInfo on the init effect — otherwise OTP/customer
  // updates re-run the effect and can reset additional-adult phone (and other) edits.
  const customerInfoRef = useRef(customerInfo);
  customerInfoRef.current = customerInfo;
  
  // Calculate minor number (1st, 2nd, 3rd, etc.)
  const getMinorNumber = () => {
    if (!isMinor || !participants || participants.length === 0 || !participant) return null;
    
    // Find the current participant in the participants array
    // Use currentParticipantIndex from parent if available, otherwise find by index property
    let participantIndex = -1;
    
    // First try to find by index property (most reliable)
    if (participant?.index !== undefined) {
      participantIndex = participants.findIndex(p => p.index === participant.index && p.type === 'minor');
    }
    
    // If not found, try to find by array position (fallback)
    if (participantIndex === -1) {
      participantIndex = participants.findIndex(p => p === participant);
    }
    
    if (participantIndex === -1) return null;
    
    // Count how many minors come before this one in the array
    const minorsBefore = participants.slice(0, participantIndex).filter(p => p.type === 'minor').length;
    return minorsBefore + 1;
  };
  
  const minorNumber = getMinorNumber();
  const resolvedFieldConfig = normalizeParticipantFieldsConfig(
    waiverSettings?.participant_fields_config,
    template?.fields_config
  );
  const resolveExplicitFieldValue = (key) => {
    const globalValue = getExplicitParticipantFieldValue(waiverSettings?.participant_fields_config, key);
    if (globalValue === false) return false;
    const templateValue = getExplicitParticipantFieldValue(template?.fields_config, key);
    if (templateValue !== undefined) return templateValue;
    return globalValue;
  };
  const explicitGlobalEmail = resolveExplicitFieldValue('emailAddress');
  const explicitGlobalPhone = resolveExplicitFieldValue('phoneNumber');
  const explicitGlobalAddress = resolveExplicitFieldValue('address');
  const explicitGlobalCity = resolveExplicitFieldValue('city');
  const explicitGlobalPostalCode = resolveExplicitFieldValue('postalCode');
  const showEmailField = !isMinor && (explicitGlobalEmail !== undefined ? explicitGlobalEmail !== false : resolvedFieldConfig.participantFields.emailAddress !== false);
  const showPhoneField = !isMinor && (explicitGlobalPhone !== undefined ? explicitGlobalPhone !== false : resolvedFieldConfig.participantFields.phoneNumber !== false);
  const showAddressField = !isMinor && (explicitGlobalAddress !== undefined ? explicitGlobalAddress !== false : resolvedFieldConfig.participantFields.address !== false);
  const showCityField = !isMinor && (
    (explicitGlobalCity !== undefined ? explicitGlobalCity !== false : resolvedFieldConfig.participantFields.city !== false) ||
    (explicitGlobalAddress !== undefined ? explicitGlobalAddress !== false : resolvedFieldConfig.participantFields.address !== false)
  );
  const showPostalCodeField = !isMinor && (explicitGlobalPostalCode !== undefined ? explicitGlobalPostalCode !== false : resolvedFieldConfig.participantFields.postalCode !== false);
  const primaryParticipant = participants.find((p) => p.type === 'primary');
  const primaryAddressData = primaryParticipant?.data || {};
  const canReusePrimaryAddress =
    isAdditionalAdult &&
    (showAddressField || showCityField || showPostalCodeField) &&
    !!(
      String(primaryAddressData.address || '').trim() ||
      String(primaryAddressData.city || '').trim() ||
      String(primaryAddressData.postalCode || '').trim()
    );

  const getMinorLabel = () => {
    if (!minorNumber) return 'Minor Information';
    const labels = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
    return `${labels[minorNumber - 1] || `${minorNumber}th`} Minor Information`;
  };

  const businessTodayIso = getCurrentBusinessDate(businessTimezone);
  const businessTodayParts = parseIsoCalendarDate(businessTodayIso);
  const today = businessTodayParts
    ? new Date(businessTodayParts.y, businessTodayParts.m - 1, businessTodayParts.d)
    : new Date();

  const { timeRemaining, resetTimer, showWarning, setShowWarning } = useInactivityTimer(
    () => {
      if (onCancel) onCancel({ reason: 'idle_ad' });
    },
    WAIVER_POST_OTP_TIMEOUT_SECONDS,
    null,
    { enabled: !suspendInactivityTimer, warningSeconds: WAIVER_TIMEOUT_WARNING_SECONDS }
  );
  
  const handleExtendSession = () => {
    resetTimer();
    setShowWarning(false);
  };
  
  const handleCloseSession = () => {
    if (onCancel) onCancel();
  };

  const parseDateOfBirth = (dateStr) => birthFormPartsFromValue(dateStr);

  const combineDateOfBirth = (year, month, day) =>
    combineBirthFormPartsToIso(year, month, day);

  useEffect(() => {
    // Use a stable identifier that DOES NOT change when user types
    // Use participant index if available (most stable), otherwise use type
    // CRITICAL: Do NOT use current formData values as they change when user types!
    const participantId = participant ? 
      `${participant.type}-${participant.index !== undefined ? participant.index : 0}` : 
      null;
    
    // If participant has existing data (e.g., from resign), ALWAYS use it
    if (participant?.data) {
      // Check if we've already initialized for this participant
      if (initializedParticipantRef.current === participantId) {
        // Already initialized, don't overwrite user edits - CRITICAL: return early
        return;
      }
      
      // Check if formData already matches participant.data (might have been set by parent)
      const participantData = participant.data;
      const alreadyMatches =
        isMinor
          ? formData.firstName === participantData.firstName &&
            formData.lastName === participantData.lastName &&
            (formData.birthYear || '') === (participantData.birthYear || '') &&
            (formData.birthMonth || '') === (participantData.birthMonth || '') &&
            (formData.birthDay || '') === (participantData.birthDay || '')
          : isAdditionalAdult
            ? formData.firstName === participantData.firstName &&
              formData.lastName === participantData.lastName &&
              formData.email === participantData.email &&
              (formData.phoneNumber || '') === (participantData.phoneNumber || '') &&
              (formData.address || '') === (participantData.address || '') &&
              (formData.city || '') === (participantData.city || '') &&
              (formData.postalCode || '') === (participantData.postalCode || '') &&
              (formData.birthYear || '') === (participantData.birthYear || '') &&
              (formData.birthMonth || '') === (participantData.birthMonth || '') &&
              (formData.birthDay || '') === (participantData.birthDay || '')
            : formData.firstName === participantData.firstName &&
              formData.lastName === participantData.lastName &&
              formData.email === participantData.email &&
              (formData.phoneNumber || '') === (participantData.phoneNumber || '') &&
              (formData.address || '') === (participantData.address || '') &&
              (formData.city || '') === (participantData.city || '') &&
              (formData.postalCode || '') === (participantData.postalCode || '') &&
              (formData.birthYear || '') === (participantData.birthYear || '') &&
              (formData.birthMonth || '') === (participantData.birthMonth || '') &&
              (formData.birthDay || '') === (participantData.birthDay || '');
      
      if (alreadyMatches) {
        // FormData already matches, just mark as initialized
        initializedParticipantRef.current = participantId;
        return;
      }
      
      // Initialize from participant data - this is the source of truth for pre-filled data
      const parsedDate = parseDateOfBirth(participantData.dateOfBirth || '');
      const initialForm = {
        firstName: participantData.firstName || '',
        lastName: participantData.lastName || '',
        dateOfBirth: participantData.dateOfBirth || '',
        birthYear: participantData.birthYear || parsedDate.year,
        birthMonth: participantData.birthMonth || parsedDate.month,
        birthDay: participantData.birthDay || parsedDate.day,
        email: participantData.email || '',
        phoneNumber: isAdditionalAdult
          ? (participantData.phoneNumber || '')
          : (participantData.phoneNumber || customerInfoRef.current?.phoneNumber || ''),
        address: participantData.address || '',
        city: participantData.city || '',
        postalCode: participantData.postalCode || '',
        usePrimaryAddress: !!participantData.usePrimaryAddress
      };
      console.log('[ParticipantInfoStep] Initializing formData from participant.data', { participantType: participant?.type, participantDataKeys: Object.keys(participantData), initialFormSample: { firstName: initialForm.firstName, lastName: initialForm.lastName, email: initialForm.email, phoneNumber: initialForm.phoneNumber }, customerInfoPhone: customerInfoRef.current?.phoneNumber });
      setFormData(initialForm);
      setUsePrimaryAddress(!!participantData.usePrimaryAddress);
      initializedParticipantRef.current = participantId;
      return; // Exit early - don't fall through to clearing logic
    }

    // If we've already initialized this participant (even without data), don't clear
    if (initializedParticipantRef.current === participantId) {
      return;
    }

    // Initialize form data - clear for additional adults, auto-fill phone for primary
    if (isAdditionalAdult) {
      // Clear form for additional adult
      setFormData({
        firstName: '',
        lastName: '',
        dateOfBirth: '',
        birthYear: '',
        birthMonth: '',
        birthDay: '',
        email: '',
        phoneNumber: '',
        address: '',
        city: '',
        postalCode: '',
        usePrimaryAddress: false
      });
      setUsePrimaryAddress(false);
      initializedParticipantRef.current = participantId;
    } else if (isMinor) {
      // For minors WITHOUT existing data: clear first/last name, but keep address if parent has one
      // Use empty dateOfBirth for minors (each minor should have their own birthdate)
      // ONLY clear if we haven't already initialized
      const currentAddress = formData.address || '';
      const currentCity = formData.city || '';
      const currentPostalCode = formData.postalCode || '';
      setFormData({
        firstName: '', // Clear for new minors
        lastName: '', // Clear for new minors
        dateOfBirth: '', // Always clear for minors - each minor needs their own birthdate
        birthYear: '',
        birthMonth: '',
        birthDay: '',
        email: '',
        phoneNumber: '',
        address: currentAddress, // Keep address if parent entered it
        city: currentCity, // Keep city if parent entered it
        postalCode: currentPostalCode // Keep postal code if parent entered it
      });
      setUsePrimaryAddress(false);
      initializedParticipantRef.current = participantId;
    } else if (!formData.firstName && !formData.lastName) {
      // Initialize empty form, but auto-fill phone if available
      const parsedDate = parseDateOfBirth(formData.dateOfBirth);
      setFormData({
        firstName: '',
        lastName: '',
        dateOfBirth: '',
        birthYear: parsedDate.year,
        birthMonth: parsedDate.month,
        birthDay: parsedDate.day,
        email: '',
        phoneNumber: customerInfoRef.current?.phoneNumber || '',
        address: '',
        city: '',
        postalCode: '',
        usePrimaryAddress: false
      });
      setUsePrimaryAddress(false);
    } else if (!formData.phoneNumber && customerInfoRef.current?.phoneNumber) {
      // Auto-fill phone if not already set
      setFormData(prev => ({
        ...prev,
        phoneNumber: customerInfoRef.current.phoneNumber
      }));
    } else if (formData.dateOfBirth && !formData.birthYear) {
      // Parse existing dateOfBirth into separate fields
      const parsedDate = parseDateOfBirth(formData.dateOfBirth);
      setFormData(prev => ({
        ...prev,
        birthYear: parsedDate.year,
        birthMonth: parsedDate.month,
        birthDay: parsedDate.day
      }));
    }
  }, [isAdditionalAdult, isMinor, participant]);

  useEffect(() => {
    if (!canReusePrimaryAddress || !usePrimaryAddress) return;
    setFormData((prev) => ({
      ...prev,
      address: showAddressField ? (primaryAddressData.address || '') : prev.address,
      city: showCityField ? (primaryAddressData.city || '') : prev.city,
      postalCode: showPostalCodeField ? (primaryAddressData.postalCode || '') : prev.postalCode,
      usePrimaryAddress: true
    }));
  }, [
    canReusePrimaryAddress,
    usePrimaryAddress,
    setFormData,
    showAddressField,
    showCityField,
    showPostalCodeField,
    primaryAddressData.address,
    primaryAddressData.city,
    primaryAddressData.postalCode
  ]);

  // Primary adult only: when verified phone arrives after this step first mounts, fill empty field.
  // Deliberately not running for minors/additional adults so their numbers stay independent of OTP phone.
  useEffect(() => {
    if (isMinor || isAdditionalAdult) return;
    const phone = customerInfo?.phoneNumber;
    if (!phone || String(phone).replace(/\D/g, '').length < 10) return;
    setFormData((prev) => {
      const d = (prev.phoneNumber || '').replace(/\D/g, '');
      if (d.length >= 10) return prev;
      return { ...prev, phoneNumber: phone };
    });
  }, [isMinor, isAdditionalAdult, customerInfo?.phoneNumber]);

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Validate required fields
    const newErrors = {};
    
    // Name validation - must be more than 1 letter and not "NA"
    if (!formData.firstName || formData.firstName.trim().length < 2) {
      newErrors.firstName = 'First name must be at least 2 letters';
    } else if (formData.firstName.trim().toUpperCase() === 'NA') {
      newErrors.firstName = 'First name cannot be "NA"';
    }
    
    if (!formData.lastName || formData.lastName.trim().length < 2) {
      newErrors.lastName = 'Last name must be at least 2 letters';
    } else if (formData.lastName.trim().toUpperCase() === 'NA') {
      newErrors.lastName = 'Last name cannot be "NA"';
    }
    if (isMinor) {
      if (!formData.birthYear || !formData.birthMonth || !formData.birthDay) {
        newErrors.dateOfBirth = 'Date of birth is required for each child';
      } else {
        const combinedMinor = combineDateOfBirth(formData.birthYear, formData.birthMonth, formData.birthDay);
        if (!combinedMinor) {
          newErrors.dateOfBirth = 'Invalid date of birth';
        } else {
          const age = calculateAgeFromIsoDateOfBirth(combinedMinor, today);
          if (age === null) {
            newErrors.dateOfBirth = 'Invalid date of birth';
          } else if (age >= minorAgeThreshold) {
            newErrors.dateOfBirth = `This participant must be under ${minorAgeThreshold} to be listed as a minor.`;
          }
        }
      }
    } else {
      if (!formData.birthYear || !formData.birthMonth || !formData.birthDay) {
        newErrors.dateOfBirth = 'Date of birth is required';
      } else {
        const combinedDate = combineDateOfBirth(formData.birthYear, formData.birthMonth, formData.birthDay);
        if (!combinedDate) {
          newErrors.dateOfBirth = 'Invalid date of birth';
        } else {
          const age = calculateAgeFromIsoDateOfBirth(combinedDate, today);
          if (age === null) {
            newErrors.dateOfBirth = 'Invalid date of birth';
          } else if (age < minorAgeThreshold) {
            newErrors.dateOfBirth = `You must be at least ${minorAgeThreshold} years old to sign this waiver. If you are under ${minorAgeThreshold}, a guardian must sign on your behalf.`;
          }
        }
      }
    }

    if (showEmailField) {
      if (!formData.email || !String(formData.email).trim()) {
        newErrors.email = 'Email is required';
      } else if (!validateEmail(formData.email)) {
        newErrors.email = 'Please enter a valid email address';
      }
    }

    if (showPhoneField) {
      const phoneDigits = (formData.phoneNumber || '').replace(/\D/g, '');
      if (phoneDigits.length < 10) {
        newErrors.phoneNumber = 'Please enter a valid 10-digit phone number';
      }
    }

    if (showAddressField && !String(formData.address || '').trim()) {
      newErrors.address = 'Street address is required';
    }
    if (showCityField && !String(formData.city || '').trim()) {
      newErrors.city = 'City is required';
    }
    if (showPostalCodeField && !String(formData.postalCode || '').trim()) {
      newErrors.postalCode = 'Postal code is required';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

      // Combine date fields before submission (for both adults and minors)
      const submissionData = {
        ...formData,
        usePrimaryAddress,
        dateOfBirth: (formData.birthYear && formData.birthMonth && formData.birthDay)
          ? combineDateOfBirth(formData.birthYear, formData.birthMonth, formData.birthDay)
          : formData.dateOfBirth || ''
      };

      // Primary: if phone step had a number but field is short, fall back once
      if (showPhoneField && !isMinor && !isAdditionalAdult && customerInfo?.phoneNumber) {
        const fromForm = (submissionData.phoneNumber || '').replace(/\D/g, '');
        if (fromForm.length < 10) {
          const fromCustomer = String(customerInfo.phoneNumber).replace(/\D/g, '');
          if (fromCustomer.length >= 10) {
            submissionData.phoneNumber = customerInfo.phoneNumber;
          }
        }
      }

    console.log('[ParticipantInfoStep] Submitting data:', {
      hasPhoneNumber: !!submissionData.phoneNumber,
      phoneNumber: submissionData.phoneNumber,
      participantType: isMinor ? 'minor' : isAdditionalAdult ? 'additional_adult' : 'primary'
    });
    onSubmit(submissionData);
  };

  // Format phone number with dashes
  const formatPhoneNumber = (value) => {
    // Remove all non-digit characters
    const digits = value.replace(/\D/g, '');
    
    // Format as (XXX) XXX-XXXX
    if (digits.length <= 3) {
      return digits;
    } else if (digits.length <= 6) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    } else {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
    }
  };

  // Validate email format more strictly
  const validateEmail = (email) => {
    if (!email) return true; // Email is optional
    // More strict email validation - requires @ and valid domain
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    return emailRegex.test(email);
  };

  const handleChange = (field, value) => {
    // Name validation - prevent "NA" but allow typing
    // IMPORTANT: Don't block single letters - user needs to type them to get to 2+ letters!
    if (field === 'firstName' || field === 'lastName') {
      // Only validate on blur or submit, not while typing
      // Allow all input while typing, validate later
    }
    
    // Phone number formatting
    if (field === 'phoneNumber') {
      const formatted = formatPhoneNumber(value);
      setFormData(prev => ({ ...prev, [field]: formatted }));
      if (errors[field]) {
        setErrors(prev => ({ ...prev, [field]: null }));
      }
      return;
    }
    
    // Email validation
    if (field === 'email') {
      if (value && !validateEmail(value)) {
        setErrors(prev => ({ ...prev, [field]: 'Please enter a valid email address' }));
      } else {
        setErrors(prev => ({ ...prev, [field]: null }));
      }
    }
    
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field] && field !== 'email') {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  const handleUsePrimaryAddressChange = (checked) => {
    setUsePrimaryAddress(checked);
    setErrors((prev) => ({
      ...prev,
      address: null,
      city: null,
      postalCode: null
    }));
    setFormData((prev) => ({
      ...prev,
      address: checked ? (primaryAddressData.address || '') : '',
      city: checked ? (primaryAddressData.city || '') : '',
      postalCode: checked ? (primaryAddressData.postalCode || '') : '',
      usePrimaryAddress: checked
    }));
  };

  const currentYear = today.getFullYear();
  const currentMonthNumber = today.getMonth() + 1;
  const currentDayOfMonth = today.getDate();
  const adultBoundaryYear = currentYear - minorAgeThreshold;
  const selectedBirthYear = Number(formData.birthYear || 0);
  const selectedBirthMonth = Number(formData.birthMonth || 0);
  const daysInSelectedMonth =
    selectedBirthYear && selectedBirthMonth
      ? new Date(selectedBirthYear, selectedBirthMonth, 0).getDate()
      : 31;

  const allYears = Array.from({ length: 100 }, (_, i) => currentYear - i);
  const years = allYears.filter((year) => {
    if (isMinor) {
      return year >= adultBoundaryYear && year <= currentYear;
    }
    return year <= adultBoundaryYear;
  });

  const allMonths = Array.from({ length: 12 }, (_, i) => {
    const monthNum = i + 1;
    return { value: monthNum.toString().padStart(2, '0'), label: new Date(2000, i, 1).toLocaleString('default', { month: 'long' }) };
  });
  const months = allMonths.filter((month) => {
    const monthNum = Number(month.value);
    if (!selectedBirthYear) return true;
    if (isMinor) {
      if (selectedBirthYear === currentYear) return monthNum <= currentMonthNumber;
      if (selectedBirthYear === adultBoundaryYear) return monthNum >= currentMonthNumber;
      return true;
    }
    if (selectedBirthYear === adultBoundaryYear) return monthNum <= currentMonthNumber;
    return true;
  });

  const days = Array.from({ length: daysInSelectedMonth }, (_, i) => i + 1)
    .filter((day) => {
      if (!selectedBirthYear || !selectedBirthMonth) return true;
      if (isMinor) {
        if (selectedBirthYear === currentYear && selectedBirthMonth === currentMonthNumber) {
          return day <= currentDayOfMonth;
        }
        if (selectedBirthYear === adultBoundaryYear && selectedBirthMonth === currentMonthNumber) {
          return day > currentDayOfMonth;
        }
        return true;
      }
      if (selectedBirthYear === adultBoundaryYear && selectedBirthMonth === currentMonthNumber) {
        return day <= currentDayOfMonth;
      }
      return true;
    })
    .map((day) => day.toString().padStart(2, '0'));

  useEffect(() => {
    if (!formData.birthYear) return;

    const selectedYearStillValid = years.some((year) => year.toString() === formData.birthYear);
    if (!selectedYearStillValid) {
      setFormData((prev) => ({ ...prev, birthYear: '', birthMonth: '', birthDay: '' }));
      return;
    }

    if (formData.birthMonth && !months.some((month) => month.value === formData.birthMonth)) {
      setFormData((prev) => ({ ...prev, birthMonth: '', birthDay: '' }));
      return;
    }

    if (formData.birthDay && !days.includes(formData.birthDay)) {
      setFormData((prev) => ({ ...prev, birthDay: '' }));
    }
  }, [
    days,
    formData.birthDay,
    formData.birthMonth,
    formData.birthYear,
    months,
    setFormData,
    years
  ]);

  useEffect(() => {
    const focusTimer = window.setTimeout(() => {
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch {
        window.scrollTo(0, 0);
      }

      firstNameInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      firstNameInputRef.current?.focus();
    }, 50);

    return () => window.clearTimeout(focusTimer);
  }, [embedded, isAdditionalAdult, isMinor, participant?.index, participant?.type]);

  const handleCancelClick = () => {
    setShowCancelConfirm(true);
  };

  const handleCancelConfirm = () => {
    setShowCancelConfirm(false);
    if (onCancel) onCancel();
  };

  const handleCancelCancel = () => {
    setShowCancelConfirm(false);
  };

  return (
    <div
      style={embedded ? styles.embeddedContainer : styles.container}
      className={embedded ? undefined : 'public-waiver-shell public-waiver-flow'}
    >
      {showWarning && (
        <TimeoutWarningModal
          onClose={handleCloseSession}
          onExtend={handleExtendSession}
          timeRemaining={timeRemaining}
        />
      )}
      {showCancelConfirm && (
        <CancelConfirmationModal
          onConfirm={handleCancelConfirm}
          onCancel={handleCancelCancel}
        />
      )}
      <div
        style={embedded ? { ...styles.card, ...styles.embeddedCard } : styles.card}
        className={embedded ? undefined : 'public-waiver-card'}
      >
        <div style={styles.header}>
          <FiUser size={48} style={styles.icon} />
          <h1 style={styles.title} className={embedded ? undefined : 'public-waiver-title'}>
            {isMinor ? getMinorLabel() : isAdditionalAdult ? 'Additional Adult Information' : 'Adult Information'}
          </h1>
          <p style={styles.subtitle}>
            {isMinor 
              ? minorNumber 
                ? `Please enter information for the ${['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'][minorNumber - 1] || `${minorNumber}th`} minor`
                : 'Please enter information for the minor'
              : isAdditionalAdult
              ? 'Please enter information for the additional adult'
              : 'Please enter your information'}
          </p>
        </div>

        <div style={styles.body}>
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>
              First Name <span style={styles.required}>*</span>
            </label>
            <input
              ref={firstNameInputRef}
              type="text"
              value={formData.firstName || ''}
              onChange={(e) => handleChange('firstName', e.target.value)}
              style={{
                ...styles.input,
                ...(errors.firstName && styles.inputError)
              }}
              required
            />
            {errors.firstName && <span style={styles.error}>{errors.firstName}</span>}
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>
              Last Name <span style={styles.required}>*</span>
            </label>
            <input
              type="text"
              value={formData.lastName || ''}
              onChange={(e) => handleChange('lastName', e.target.value)}
              style={{
                ...styles.input,
                ...(errors.lastName && styles.inputError)
              }}
              required
            />
            {errors.lastName && <span style={styles.error}>{errors.lastName}</span>}
          </div>

          {!isMinor && (
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                Date of Birth <span style={styles.required}>*</span>
              </label>
              <div style={styles.dateFields}>
                <div style={styles.dateField}>
                  <select
                    value={formData.birthYear || ''}
                    onChange={(e) => handleChange('birthYear', e.target.value)}
                    style={{
                      ...styles.input,
                      ...styles.select,
                      ...(errors.dateOfBirth && styles.inputError)
                    }}
                    required
                  >
                    <option value="">Year</option>
                    {years.map(year => (
                      <option key={year} value={year.toString()}>{year}</option>
                    ))}
                  </select>
                </div>
                <div style={styles.dateField}>
                  <select
                    value={formData.birthMonth || ''}
                    onChange={(e) => handleChange('birthMonth', e.target.value)}
                    style={{
                      ...styles.input,
                      ...styles.select,
                      ...(errors.dateOfBirth && styles.inputError)
                    }}
                    required
                  >
                    <option value="">Month</option>
                    {months.map(month => (
                      <option key={month.value} value={month.value}>{month.label}</option>
                    ))}
                  </select>
                </div>
                <div style={styles.dateField}>
                  <select
                    value={formData.birthDay || ''}
                    onChange={(e) => handleChange('birthDay', e.target.value)}
                    style={{
                      ...styles.input,
                      ...styles.select,
                      ...(errors.dateOfBirth && styles.inputError)
                    }}
                    required
                  >
                    <option value="">Day</option>
                    {days.map(day => (
                      <option key={day} value={day}>{day}</option>
                    ))}
                  </select>
                </div>
              </div>
              {errors.dateOfBirth && <span style={styles.error}>{errors.dateOfBirth}</span>}
            </div>
          )}

          {isMinor && (
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                Date of Birth <span style={styles.required}>*</span>
              </label>
              <div style={styles.dateFields}>
                <div style={styles.dateField}>
                  <select
                    value={formData.birthYear || ''}
                    onChange={(e) => handleChange('birthYear', e.target.value)}
                    style={{
                      ...styles.input,
                      ...styles.select,
                      ...(errors.dateOfBirth && styles.inputError)
                    }}
                  >
                    <option value="">Year</option>
                    {years.map(year => (
                      <option key={year} value={year.toString()}>{year}</option>
                    ))}
                  </select>
                </div>
                <div style={styles.dateField}>
                  <select
                    value={formData.birthMonth || ''}
                    onChange={(e) => handleChange('birthMonth', e.target.value)}
                    style={{
                      ...styles.input,
                      ...styles.select,
                      ...(errors.dateOfBirth && styles.inputError)
                    }}
                  >
                    <option value="">Month</option>
                    {months.map(month => (
                      <option key={month.value} value={month.value}>{month.label}</option>
                    ))}
                  </select>
                </div>
                <div style={styles.dateField}>
                  <select
                    value={formData.birthDay || ''}
                    onChange={(e) => handleChange('birthDay', e.target.value)}
                    style={{
                      ...styles.input,
                      ...styles.select,
                      ...(errors.dateOfBirth && styles.inputError)
                    }}
                  >
                    <option value="">Day</option>
                    {days.map(day => (
                      <option key={day} value={day}>{day}</option>
                    ))}
                  </select>
                </div>
              </div>
              {errors.dateOfBirth && <span style={styles.error}>{errors.dateOfBirth}</span>}
            </div>
          )}

          {!isMinor && showEmailField && (
            <>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>
                  Email <span style={styles.required}>*</span>
                </label>
                <input
                  type="email"
                  autoComplete="email"
                  value={formData.email || ''}
                  onChange={(e) => handleChange('email', e.target.value)}
                  style={{
                    ...styles.input,
                    ...(errors.email && styles.inputError)
                  }}
                />
                {errors.email && <span style={styles.error}>{errors.email}</span>}
              </div>
            </>
          )}

          {!isMinor && showPhoneField && (
            <>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>
                  Phone number <span style={styles.required}>*</span>
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="(555) 555-5555"
                  value={formData.phoneNumber || ''}
                  onChange={(e) => handleChange('phoneNumber', e.target.value)}
                  style={{
                    ...styles.input,
                    ...(errors.phoneNumber && styles.inputError)
                  }}
                />
                {errors.phoneNumber && (
                  <span style={styles.error}>{errors.phoneNumber}</span>
                )}
                {!isAdditionalAdult && (
                  <span style={styles.helperText}>
                    Use the same number you entered at the start, or update it if needed.
                  </span>
                )}
              </div>
            </>
          )}

          {!isMinor && (
            <>
              {canReusePrimaryAddress && (
                <div style={styles.fieldGroup}>
                  <TavariCheckbox
                    checked={usePrimaryAddress}
                    onChange={handleUsePrimaryAddressChange}
                    label="Use the same address, city, and postal code as the primary adult"
                    size="md"
                  />
                </div>
              )}
            </>
          )}

          {!isMinor && showAddressField && (
            <>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>
                  Street address <span style={styles.required}>*</span>
                </label>
                <input
                  type="text"
                  autoComplete="street-address"
                  value={formData.address || ''}
                  onChange={(e) => handleChange('address', e.target.value)}
                  readOnly={usePrimaryAddress}
                  style={{
                    ...styles.input,
                    ...(usePrimaryAddress && styles.inputReadonly),
                    ...(errors.address && styles.inputError)
                  }}
                />
                {errors.address && <span style={styles.error}>{errors.address}</span>}
              </div>
            </>
          )}

          {!isMinor && showCityField && (
            <>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>
                  City <span style={styles.required}>*</span>
                </label>
                <input
                  type="text"
                  autoComplete="address-level2"
                  value={formData.city || ''}
                  onChange={(e) => handleChange('city', e.target.value)}
                  readOnly={usePrimaryAddress}
                  style={{
                    ...styles.input,
                    ...(usePrimaryAddress && styles.inputReadonly),
                    ...(errors.city && styles.inputError)
                  }}
                />
                {errors.city && <span style={styles.error}>{errors.city}</span>}
              </div>
            </>
          )}

          {!isMinor && showPostalCodeField && (
            <>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>
                  Postal code <span style={styles.required}>*</span>
                </label>
                <input
                  type="text"
                  autoComplete="postal-code"
                  value={formData.postalCode || ''}
                  onChange={(e) => handleChange('postalCode', e.target.value)}
                  readOnly={usePrimaryAddress}
                  style={{
                    ...styles.input,
                    ...(usePrimaryAddress && styles.inputReadonly),
                    ...(errors.postalCode && styles.inputError)
                  }}
                />
                {errors.postalCode && <span style={styles.error}>{errors.postalCode}</span>}
              </div>
            </>
          )}

          <div style={styles.buttonContainer} className="public-waiver-actions">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                style={styles.backButton}
              >
                {backLabel}
              </button>
            )}
            {onCancel && (
              <button
                type="button"
                onClick={handleCancelClick}
                style={styles.cancelButton}
              >
                Cancel
              </button>
            )}
            {onAddChild && !isMinor && !isAdditionalAdult && (
              <button
                type="button"
                onClick={() => onAddChild()}
                style={styles.addChildButton}
              >
                <FiPlus style={styles.buttonIcon} />
                Add another child
              </button>
            )}
            <button
              type="submit"
              data-testid="waiver-participant-continue"
              style={styles.button}
            >
              {submitLabel}
              <FiArrowRight style={styles.buttonIcon} />
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '2rem',
    backgroundColor: TavariStyles.colors.background
  },
  embeddedContainer: {
    width: '100%'
  },
  card: {
    width: '100%',
    maxWidth: '600px',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: '2rem',
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    boxShadow: `0 0 0 1px ${TavariStyles.colors.gray200}, ${TavariStyles.shadows.lg}`
  },
  embeddedCard: {
    maxWidth: '100%',
    border: 'none',
    boxShadow: 'none',
    padding: 0
  },
  header: {
    textAlign: 'center',
    marginBottom: '1.5rem'
  },
  body: {
    width: '100%'
  },
  icon: {
    color: TavariStyles.colors.primary,
    marginBottom: '1rem'
  },
  title: {
    fontSize: '2rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    marginBottom: '0.5rem'
  },
  subtitle: {
    fontSize: '1rem',
    color: TavariStyles.colors.gray600
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem'
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  label: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: TavariStyles.colors.text
  },
  required: {
    color: TavariStyles.colors.error
  },
  input: {
    padding: '0.875rem',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    width: '100%',
    boxSizing: 'border-box'
  },
  inputReadonly: {
    backgroundColor: TavariStyles.colors.gray100,
    color: TavariStyles.colors.gray700,
    cursor: 'not-allowed'
  },
  select: {
    cursor: 'pointer'
  },
  inputError: {
    borderColor: TavariStyles.colors.error
  },
  error: {
    fontSize: '0.875rem',
    color: TavariStyles.colors.error
  },
  helperText: {
    fontSize: '0.75rem',
    color: TavariStyles.colors.gray600,
    fontStyle: 'italic',
    marginTop: '0.25rem'
  },
  dateFields: {
    display: 'flex',
    gap: '0.5rem'
  },
  dateField: {
    flex: 1
  },
  buttonContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '1rem',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: '1rem',
    width: '100%'
  },
  backButton: {
    padding: '1rem 2rem',
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.text,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    flex: 1,
    minWidth: 0
  },
  addChildButton: {
    padding: '1rem 2rem',
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.primary,
    border: `2px solid ${TavariStyles.colors.primary}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    minWidth: '120px'
  },
  button: {
    padding: '1rem 2rem',
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    flex: 1,
    minWidth: 0
  },
  cancelButton: {
    padding: '1rem 2rem',
    backgroundColor: '#EF4444',
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    flex: 1,
    minWidth: 0
  },
  buttonIcon: {
    fontSize: '1.25rem'
  },
};

export default ParticipantInfoStep;
