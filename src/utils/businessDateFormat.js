// utils/businessDateFormat.js - Business timezone-aware date formatting utilities
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_BUSINESS_TIMEZONE = 'America/Toronto';

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_WITHOUT_TZ_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

export const getBusinessTimezone = (businessData) => {
  return businessData?.timezone || DEFAULT_BUSINESS_TIMEZONE;
};

/** Exported for mail digest / edge parity: validate IANA ID, fallback to America/Toronto. */
export const getValidBusinessTimezone = (businessTimezone) => {
  const timezone = businessTimezone || DEFAULT_BUSINESS_TIMEZONE;

  try {
    Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch (error) {
    console.warn('Invalid business timezone, falling back to default:', timezone, error);
    return DEFAULT_BUSINESS_TIMEZONE;
  }
};

const normalizeDateInput = (dateString) => {
  if (!dateString) return null;

  if (dateString instanceof Date) {
    return isNaN(dateString.getTime()) ? null : dateString;
  }

  if (typeof dateString === 'string') {
    if (DATE_ONLY_REGEX.test(dateString)) {
      return dateString;
    }

    const normalizedDateString = ISO_DATETIME_WITHOUT_TZ_REGEX.test(dateString)
      ? `${dateString}Z`
      : dateString;

    const date = new Date(normalizedDateString);
    return isNaN(date.getTime()) ? null : date;
  }

  return null;
};

const formatDateOnlyString = (dateString, locale = 'en-CA', options = {}) => {
  const [year, month, day] = dateString.split('-').map(Number);

  if (isNaN(year) || isNaN(month) || isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    return '';
  }

  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...options
  }).format(date);
};

export const formatBusinessDate = (
  dateString,
  businessTimezone = DEFAULT_BUSINESS_TIMEZONE,
  options = {},
  locale = 'en-CA'
) => {
  if (!dateString) return '';

  const normalized = normalizeDateInput(dateString);
  if (!normalized) {
    return dateString?.toString() || '';
  }

  try {
    if (typeof normalized === 'string') {
      return formatDateOnlyString(normalized, locale, options);
    }

    return new Intl.DateTimeFormat(locale, {
      timeZone: getValidBusinessTimezone(businessTimezone),
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      ...options
    }).format(normalized);
  } catch (err) {
    console.error('Error formatting date for business timezone:', err, dateString);
    return dateString?.toString() || '';
  }
};

/**
 * Format a date string or Date object using the business timezone
 * @param {string|Date} dateString - Date to format (ISO string or Date object)
 * @param {string} businessTimezone - Business timezone (e.g., 'America/Toronto')
 * @param {Object} options - Intl.DateTimeFormat options
 * @returns {string} Formatted date string
 */
export const formatDateForBusiness = (dateString, businessTimezone = 'America/Toronto', options = {}) => {
  return formatBusinessDate(dateString, businessTimezone, options);
};

/**
 * Format a date as a short date string (MMM DD, YYYY) in business timezone
 */
export const formatDateShort = (dateString, businessTimezone = 'America/Toronto') => {
  // Handle YYYY-MM-DD directly
  if (typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [year, month, day] = dateString.split('-').map(Number);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName = months[month - 1] || 'Jan';
    return `${monthName} ${day}, ${year}`;
  }
  
  return formatDateForBusiness(dateString, businessTimezone, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

/** e.g. Saturday July 19, 2026 */
export const formatDateWithWeekday = (dateString, businessTimezone = 'America/Toronto') => {
  if (!dateString) return '';

  const normalized = normalizeDateInput(dateString);
  if (!normalized) return dateString?.toString() || '';

  try {
    const tz = getValidBusinessTimezone(businessTimezone);
    if (typeof normalized === 'string') {
      return dayjs.tz(`${normalized}T12:00:00`, tz).format('dddd MMMM D, YYYY');
    }
    return dayjs(normalized).tz(tz).format('dddd MMMM D, YYYY');
  } catch (err) {
    console.error('Error formatting date with weekday:', err, dateString);
    return formatDateShort(dateString, businessTimezone);
  }
};

/**
 * Format a date as a numeric date string (YYYY-MM-DD) in business timezone
 */
export const formatDateNumeric = (dateString, businessTimezone = 'America/Toronto') => {
  if (!dateString) return '';
  
  try {
    const normalized = normalizeDateInput(dateString);
    if (!normalized) {
      return '';
    }

    if (typeof normalized === 'string') {
      return normalized;
    }

    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: getValidBusinessTimezone(businessTimezone)
    }).format(normalized);
  } catch (err) {
    console.error('Error formatting numeric date:', err, dateString);
    return dateString?.toString() || '';
  }
};

/**
 * Format a date with time in business timezone
 */
export const formatDateTimeForBusiness = (dateString, businessTimezone = 'America/Toronto') => {
  return formatBusinessDate(dateString, businessTimezone, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
};

export const formatTimeForBusiness = (
  dateString,
  businessTimezone = DEFAULT_BUSINESS_TIMEZONE,
  options = {}
) => {
  return formatBusinessDate(dateString, businessTimezone, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    ...options
  });
};

/**
 * Get current date in business timezone as ISO string (YYYY-MM-DD)
 */
export const getCurrentBusinessDate = (businessTimezone = DEFAULT_BUSINESS_TIMEZONE) => {
  try {
    const now = new Date();
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: getValidBusinessTimezone(businessTimezone)
    }).format(now);
  } catch (err) {
    console.error('Error getting current business date:', err);
    return new Date().toISOString().split('T')[0];
  }
};

/** Prefer accounting config timezone, then business profile timezone. */
export const resolveAccountingTimezone = (accountingConfig, business) =>
  getValidBusinessTimezone(accountingConfig?.business_timezone || business?.timezone);

/** Compact YYYY-MM-DD label for accounting tables (no UTC off-by-one on date-only strings). */
export const formatAccountingDateLabel = (dateString, businessTimezone = DEFAULT_BUSINESS_TIMEZONE) => {
  if (!dateString) return '—';
  const formatted = formatDateNumeric(dateString, businessTimezone);
  return formatted || '—';
};

export const getBusinessDateRangeStart = (
  days,
  businessTimezone = DEFAULT_BUSINESS_TIMEZONE,
  referenceDate = new Date()
) => {
  const safeDays = Math.max(Number(days) || 0, 0);
  const date = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const shifted = new Date(date.getTime() - safeDays * 24 * 60 * 60 * 1000);
  return formatDateNumeric(shifted, businessTimezone);
};

export const getBusinessRangeStartIso = (
  days,
  businessTimezone = DEFAULT_BUSINESS_TIMEZONE,
  referenceDate = new Date()
) => {
  const safeDays = Math.max(Number(days) || 0, 0);
  const timezoneToUse = getValidBusinessTimezone(businessTimezone);
  const reference = dayjs(referenceDate).tz(timezoneToUse);
  return reference.subtract(safeDays, 'day').startOf('day').utc().toISOString();
};

