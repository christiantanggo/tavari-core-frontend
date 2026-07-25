/** Strip to digits only (10+ for North American numbers). */
export function stripPhoneDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Format a phone number for display: (519) 555-1234
 * Accepts raw digits, dashed, or already formatted input.
 */
export function formatPhoneDisplay(value) {
  let digits = stripPhoneDigits(value);
  if (!digits) return '';

  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  }

  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  if (digits.length === 7) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }

  if (digits.length > 10) {
    const local = digits.slice(-10);
    const country = digits.slice(0, -10);
    return `+${country} (${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }

  if (digits.length > 6) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  if (digits.length > 3) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  }

  return digits;
}

/** Format while typing in a phone input field. */
export function formatPhoneInput(value) {
  return formatPhoneDisplay(value);
}
