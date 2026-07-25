// Step 73: Create appBuilderValidators.js
// Validation logic for app configurations

/**
 * Validate branding configuration
 * @param {Object} branding - Branding data
 * @returns {Object} - {valid: boolean, errors: string[]}
 */
export const validateBranding = (branding) => {
  const errors = [];

  if (branding.app_name && branding.app_name.length < 3) {
    errors.push('App name must be at least 3 characters');
  }

  if (branding.app_name && branding.app_name.length > 50) {
    errors.push('App name must be less than 50 characters');
  }

  if (branding.primary_color && !/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(branding.primary_color)) {
    errors.push('Primary color must be a valid hex color');
  }

  if (branding.secondary_color && !/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(branding.secondary_color)) {
    errors.push('Secondary color must be a valid hex color');
  }

  if (branding.support_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(branding.support_email)) {
    errors.push('Support email must be a valid email address');
  }

  if (branding.privacy_url && !/^https?:\/\/.+/.test(branding.privacy_url)) {
    errors.push('Privacy URL must be a valid URL');
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Validate module configuration
 * @param {Object} moduleConfig - Module configuration
 * @returns {Object} - {valid: boolean, errors: string[]}
 */
export const validateModuleConfig = (moduleConfig) => {
  const errors = [];

  if (!moduleConfig.module_key) {
    errors.push('Module key is required');
  }

  if (moduleConfig.enabled && moduleConfig.trial_expires_at) {
    const expiresAt = new Date(moduleConfig.trial_expires_at);
    if (expiresAt < new Date()) {
      errors.push('Trial expiration date must be in the future');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Validate store listing
 * @param {Object} listing - Store listing data
 * @param {string} platform - Platform (ios/android)
 * @returns {Object} - {valid: boolean, errors: string[]}
 */
export const validateStoreListing = (listing, platform) => {
  const errors = [];

  if (!listing.title || listing.title.length < 3) {
    errors.push('Title must be at least 3 characters');
  }

  if (listing.title && listing.title.length > 50) {
    errors.push('Title must be less than 50 characters');
  }

  if (platform === 'ios' && listing.subtitle && listing.subtitle.length > 30) {
    errors.push('iOS subtitle must be less than 30 characters');
  }

  if (!listing.description || listing.description.length < 10) {
    errors.push('Description must be at least 10 characters');
  }

  if (listing.description && listing.description.length > 4000) {
    errors.push('Description must be less than 4000 characters');
  }

  if (!listing.screenshots || listing.screenshots.length < 1) {
    errors.push('At least one screenshot is required');
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Validate asset
 * @param {File} file - File to validate
 * @param {string} assetType - Asset type
 * @returns {Object} - {valid: boolean, errors: string[]}
 */
export const validateAsset = (file, assetType) => {
  const errors = [];

  if (!file) {
    errors.push('File is required');
    return { valid: false, errors };
  }

  const maxSize = 50 * 1024 * 1024; // 50MB
  if (file.size > maxSize) {
    errors.push('File size must be less than 50MB');
  }

  const allowedTypes = {
    logo: ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'],
    icon: ['image/png', 'image/jpeg', 'image/jpg', 'image/x-icon'],
    splash: ['image/png', 'image/jpeg', 'image/jpg'],
    screenshot: ['image/png', 'image/jpeg', 'image/jpg'],
    favicon: ['image/x-icon', 'image/png']
  };

  if (allowedTypes[assetType] && !allowedTypes[assetType].includes(file.type)) {
    errors.push(`Invalid file type. Allowed: ${allowedTypes[assetType].join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
};




