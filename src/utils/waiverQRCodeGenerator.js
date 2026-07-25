// Step 168: Create WaiverQRCodeGenerator.js
// QR code generation utilities for waivers
// Note: In production, use a proper QR code library like qrcode.react or qrcode

/**
 * Generate QR code data for waiver
 * Format: WV-{business_id}-{waiver_id}-{hash}
 */
export const generateWaiverQR = (businessId, waiverId, signatureToken) => {
  const hash = signatureToken ? signatureToken.substring(0, 8) : Math.random().toString(36).substring(2, 10);
  return `WV-${businessId.substring(0, 8)}-${waiverId.substring(0, 8)}-${hash}`.toUpperCase();
};

/**
 * Scan and validate QR code
 */
export const scanWaiverQR = (qrData) => {
  if (!qrData || !qrData.startsWith('WV-')) {
    return { valid: false, error: 'Invalid QR code format' };
  }

  const parts = qrData.split('-');
  if (parts.length !== 4) {
    return { valid: false, error: 'Invalid QR code format' };
  }

  const [, businessId, waiverId, hash] = parts;

  return {
    valid: true,
    businessId: businessId,
    waiverId: waiverId,
    hash: hash,
    signatureToken: qrData // Use full QR data as token
  };
};

/**
 * Validate QR code format
 */
export const validateQRCode = (qrData) => {
  const result = scanWaiverQR(qrData);
  return result.valid;
};




