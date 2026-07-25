// Step 71: Create appBuilderUtils.js
// Shared utility functions for app builder

/**
 * Validate bundle ID format (iOS/Android)
 * @param {string} bundleId - Bundle ID to validate
 * @returns {boolean} - True if valid
 */
export const validateBundleId = (bundleId) => {
  if (!bundleId) return false;
  
  // iOS: com.company.appname
  // Android: com.company.appname
  const bundleIdRegex = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
  return bundleIdRegex.test(bundleId);
};

/**
 * Generate bundle ID from business name
 * @param {string} businessName - Business name
 * @returns {string} - Generated bundle ID
 */
export const generateBundleId = (businessName) => {
  if (!businessName) return 'com.tavari.app';
  
  const normalized = businessName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 20);
  
  return `com.tavari.${normalized}`;
};

/**
 * Validate color format (hex)
 * @param {string} color - Color to validate
 * @returns {boolean} - True if valid
 */
export const validateColor = (color) => {
  if (!color) return false;
  const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
  return hexColorRegex.test(color);
};

/**
 * Format version string
 * @param {string} version - Version string
 * @returns {string} - Formatted version
 */
export const formatVersion = (version) => {
  if (!version) return '1.0.0';
  
  // Ensure version follows semantic versioning
  const parts = version.split('.');
  while (parts.length < 3) {
    parts.push('0');
  }
  
  return parts.slice(0, 3).join('.');
};

/**
 * Parse version string
 * @param {string} version - Version string
 * @returns {Object} - Parsed version {major, minor, patch}
 */
export const parseVersion = (version) => {
  const parts = version.split('.').map(Number);
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0
  };
};

/**
 * Generate share token
 * @returns {string} - Random share token
 */
export const generateShareToken = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
};




