// Step 61: Create waiverUtils.js
// Utility functions for waiver operations
// Note: Using native Date methods instead of date-fns to avoid dependency

import {
  parseIsoCalendarDate,
  calculateAgeFromIsoDateOfBirth
} from './waiverDateOfBirth';

/**
 * Format waiver name (first + last)
 */
export const formatWaiverName = (firstName, lastName) => {
  return `${firstName || ''} ${lastName || ''}`.trim();
};

/**
 * Generate signature token (client-side helper - actual generation done in DB)
 */
export const generateSignatureToken = (businessId) => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `WV-${businessId.substring(0, 8)}-${timestamp}-${random}`.toUpperCase();
};

/**
 * Validate date of birth
 */
export const validateDOB = (dob) => {
  if (!dob) return { valid: false, error: 'Date of birth is required' };
  
  const date = typeof dob === 'string' ? new Date(dob) : dob;
  
  if (isNaN(date.getTime())) {
    return { valid: false, error: 'Invalid date format' };
  }

  if (date > new Date()) {
    return { valid: false, error: 'Date of birth cannot be in the future' };
  }

  return { valid: true };
};

/**
 * Calculate age from date of birth
 */
export const calculateAge = (dob) => {
  if (!dob) return null;
  if (dob instanceof Date) {
    if (Number.isNaN(dob.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age--;
    return age;
  }
  const fromIso = calculateAgeFromIsoDateOfBirth(dob);
  if (fromIso !== null) return fromIso;
  const date = new Date(dob);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const monthDiff = today.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) age--;
  return age;
};

/**
 * Format expiry date
 */
export const formatExpiryDate = (expiresAt) => {
  if (!expiresAt) return 'No expiry';
  
  const date = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  
  if (isNaN(date.getTime())) return 'Invalid date';
  
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  
  return `${month} ${day.toString().padStart(2, '0')}, ${year}`;
};

/**
 * Check if waiver is expired
 */
export const isWaiverExpired = (expiresAt) => {
  if (!expiresAt) return false;
  
  const expiryDate = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  return expiryDate <= new Date();
};

/**
 * Get waiver status
 */
export const getWaiverStatus = (waiver) => {
  if (!waiver.is_valid) return 'invalid';
  if (!waiver.expires_at) return 'valid';
  if (isWaiverExpired(waiver.expires_at)) return 'expired';
  return 'valid';
};

