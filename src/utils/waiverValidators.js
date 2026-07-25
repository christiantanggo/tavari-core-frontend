// Step 62: Create waiverValidators.js
// Validation functions for waiver data
import { parse, isValid, differenceInYears } from 'date-fns';

/**
 * Validate name (minimum 4 letters, configurable)
 */
export const validateName = (name, minLength = 4, allowManagerOverride = false) => {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Name is required' };
  }

  const trimmed = name.trim();
  const letterCount = trimmed.replace(/[^a-zA-Z]/g, '').length;

  if (letterCount < minLength) {
    return {
      valid: allowManagerOverride, // Can be overridden with manager PIN
      error: `Name must contain at least ${minLength} letters`,
      canOverride: allowManagerOverride
    };
  }

  return { valid: true };
};

/**
 * Validate phone number
 */
export const validatePhone = (phone) => {
  if (!phone) return { valid: true }; // Phone is optional

  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // North American format: 10 digits
  if (digits.length === 10 || digits.length === 11) {
    return { valid: true };
  }

  // International format: 7-15 digits
  if (digits.length >= 7 && digits.length <= 15) {
    return { valid: true };
  }

  return { valid: false, error: 'Invalid phone number format' };
};

/**
 * Validate email
 */
export const validateEmail = (email) => {
  if (!email) return { valid: true }; // Email is optional

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }

  return { valid: true };
};

/**
 * Validate date of birth
 */
export const validateDOB = (dob) => {
  if (!dob) return { valid: true }; // DOB is optional

  const date = typeof dob === 'string' ? parse(dob, 'yyyy-MM-dd', new Date()) : dob;

  if (!isValid(date)) {
    return { valid: false, error: 'Invalid date format' };
  }

  if (date > new Date()) {
    return { valid: false, error: 'Date of birth cannot be in the future' };
  }

  // Check if too old (e.g., > 150 years)
  const age = differenceInYears(new Date(), date);
  if (age > 150) {
    return { valid: false, error: 'Invalid date of birth' };
  }

  return { valid: true };
};

/**
 * Validate signature (check if signature image exists)
 */
export const validateSignature = (signatureImageUrl, signatureData) => {
  if (!signatureImageUrl && !signatureData) {
    return { valid: false, error: 'Signature is required' };
  }

  return { valid: true };
};

/**
 * Validate all participant data
 */
export const validateParticipant = (participant, validationRules = {}) => {
  const errors = [];

  // Validate name
  const nameValidation = validateName(
    `${participant.firstName} ${participant.lastName}`,
    validationRules.minNameLength || 4,
    validationRules.allowManagerOverride || false
  );
  if (!nameValidation.valid) {
    errors.push(nameValidation.error);
  }

  // Validate phone if provided
  if (participant.phoneNumber) {
    const phoneValidation = validatePhone(participant.phoneNumber);
    if (!phoneValidation.valid) {
      errors.push(phoneValidation.error);
    }
  }

  // Validate email if provided
  if (participant.email) {
    const emailValidation = validateEmail(participant.email);
    if (!emailValidation.valid) {
      errors.push(emailValidation.error);
    }
  }

  // Validate DOB if provided
  if (participant.dateOfBirth) {
    const dobValidation = validateDOB(participant.dateOfBirth);
    if (!dobValidation.valid) {
      errors.push(dobValidation.error);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
};




