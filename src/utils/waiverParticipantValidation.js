import {
  calculateAgeFromIsoDateOfBirth,
  combineBirthFormPartsToIso,
  normalizeDateOfBirthToYyyyMmDd,
  parseIsoCalendarDate
} from './waiverDateOfBirth';
import { getCurrentBusinessDate } from './businessDateFormat';

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

export const normalizeParticipantFieldsConfig = (...values) => {
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

export const getExplicitParticipantFieldValue = (value, key) => {
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

export const getResolvedParticipantFieldsConfig = ({ waiverSettings = {}, template = {} } = {}) =>
  normalizeParticipantFieldsConfig(
    waiverSettings?.participant_fields_config,
    template?.fields_config
  );

export const getResolvedExplicitParticipantFieldValue = ({
  waiverSettings = {},
  template = {},
  key
} = {}) => {
  const globalValue = getExplicitParticipantFieldValue(waiverSettings?.participant_fields_config, key);
  if (globalValue === false) return false;
  const templateValue = getExplicitParticipantFieldValue(template?.fields_config, key);
  if (templateValue !== undefined) return templateValue;
  return globalValue;
};

const validateEmail = (email) => {
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
};

const getBusinessToday = (businessTimezone) => {
  const businessTodayIso = getCurrentBusinessDate(businessTimezone);
  const businessTodayParts = parseIsoCalendarDate(businessTodayIso);
  return businessTodayParts
    ? new Date(businessTodayParts.y, businessTodayParts.m - 1, businessTodayParts.d)
    : new Date();
};

export const validateWaiverParticipantData = ({
  participantType,
  formData = {},
  customerInfo = null,
  minorAgeThreshold = 18,
  waiverSettings = {},
  template = {},
  businessTimezone = 'America/Toronto'
}) => {
  const isMinor = participantType === 'minor';
  const isAdditionalAdult = participantType === 'additional_adult';
  const today = getBusinessToday(businessTimezone);

  const resolvedFieldConfig = getResolvedParticipantFieldsConfig({ waiverSettings, template });
  const explicitGlobalEmail = getResolvedExplicitParticipantFieldValue({ waiverSettings, template, key: 'emailAddress' });
  const explicitGlobalPhone = getResolvedExplicitParticipantFieldValue({ waiverSettings, template, key: 'phoneNumber' });
  const explicitGlobalAddress = getResolvedExplicitParticipantFieldValue({ waiverSettings, template, key: 'address' });
  const explicitGlobalCity = getResolvedExplicitParticipantFieldValue({ waiverSettings, template, key: 'city' });
  const explicitGlobalPostalCode = getResolvedExplicitParticipantFieldValue({ waiverSettings, template, key: 'postalCode' });

  const showEmailField = !isMinor && (explicitGlobalEmail !== undefined ? explicitGlobalEmail !== false : resolvedFieldConfig.participantFields.emailAddress !== false);
  const showPhoneField = !isMinor && (explicitGlobalPhone !== undefined ? explicitGlobalPhone !== false : resolvedFieldConfig.participantFields.phoneNumber !== false);
  const showAddressField = !isMinor && (explicitGlobalAddress !== undefined ? explicitGlobalAddress !== false : resolvedFieldConfig.participantFields.address !== false);
  const showCityField = !isMinor && (
    (explicitGlobalCity !== undefined ? explicitGlobalCity !== false : resolvedFieldConfig.participantFields.city !== false) ||
    (explicitGlobalAddress !== undefined ? explicitGlobalAddress !== false : resolvedFieldConfig.participantFields.address !== false)
  );
  const showPostalCodeField = !isMinor && (explicitGlobalPostalCode !== undefined ? explicitGlobalPostalCode !== false : resolvedFieldConfig.participantFields.postalCode !== false);

  const errors = {};

  if (!formData.firstName || String(formData.firstName).trim().length < 2) {
    errors.firstName = 'First name must be at least 2 letters';
  } else if (String(formData.firstName).trim().toUpperCase() === 'NA') {
    errors.firstName = 'First name cannot be "NA"';
  }

  if (!formData.lastName || String(formData.lastName).trim().length < 2) {
    errors.lastName = 'Last name must be at least 2 letters';
  } else if (String(formData.lastName).trim().toUpperCase() === 'NA') {
    errors.lastName = 'Last name cannot be "NA"';
  }

  const combinedDateOfBirth =
    formData.birthYear && formData.birthMonth && formData.birthDay
      ? combineBirthFormPartsToIso(formData.birthYear, formData.birthMonth, formData.birthDay)
      : normalizeDateOfBirthToYyyyMmDd(formData.dateOfBirth);

  if (!combinedDateOfBirth) {
    errors.dateOfBirth = isMinor ? 'Date of birth is required for each child' : 'Date of birth is required';
  } else {
    const age = calculateAgeFromIsoDateOfBirth(combinedDateOfBirth, today);
    if (age === null) {
      errors.dateOfBirth = 'Invalid date of birth';
    } else if (isMinor && age >= minorAgeThreshold) {
      errors.dateOfBirth = `This participant must be under ${minorAgeThreshold} to be listed as a minor.`;
    } else if (!isMinor && age < minorAgeThreshold) {
      errors.dateOfBirth = `You must be at least ${minorAgeThreshold} years old to sign this waiver. If you are under ${minorAgeThreshold}, a guardian must sign on your behalf.`;
    }
  }

  if (showEmailField) {
    if (!formData.email || !String(formData.email).trim()) {
      errors.email = 'Email is required';
    } else if (!validateEmail(formData.email)) {
      errors.email = 'Please enter a valid email address';
    }
  }

  if (showPhoneField) {
    let phoneDigits = String(formData.phoneNumber || '').replace(/\D/g, '');
    if (!isMinor && !isAdditionalAdult && phoneDigits.length < 10) {
      const fallbackPhoneDigits = String(customerInfo?.phoneNumber || '').replace(/\D/g, '');
      if (fallbackPhoneDigits.length >= 10) {
        phoneDigits = fallbackPhoneDigits;
      }
    }
    if (phoneDigits.length < 10) {
      errors.phoneNumber = 'Please enter a valid 10-digit phone number';
    }
  }

  if (showAddressField && !String(formData.address || '').trim()) {
    errors.address = 'Street address is required';
  }
  if (showCityField && !String(formData.city || '').trim()) {
    errors.city = 'City is required';
  }
  if (showPostalCodeField && !String(formData.postalCode || '').trim()) {
    errors.postalCode = 'Postal code is required';
  }

  return {
    errors,
    hasErrors: Object.keys(errors).length > 0
  };
};
