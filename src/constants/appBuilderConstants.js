// Step 72: Create appBuilderConstants.js
// Centralized constants for app builder

// Module keys (matches app_modules table)
export const MODULE_KEYS = {
  MAIL: 'mail',
  MUSIC: 'music',
  HR: 'hr',
  POS: 'pos',
  RECIPE_BUILDER: 'recipe_builder',
  LOYALTY: 'loyalty',
  SCHEDULING: 'scheduling'
};

// Platform options
export const PLATFORM_OPTIONS = [
  { value: 'ios', label: 'iOS' },
  { value: 'android', label: 'Android' },
  { value: 'both', label: 'Both' }
];

// Build statuses
export const BUILD_STATUSES = {
  QUEUED: 'queued',
  BUILDING: 'building',
  SUCCESS: 'success',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

// Deployment types
export const DEPLOYMENT_TYPES = {
  TESTFLIGHT: 'testflight',
  APP_STORE: 'app_store',
  PLAY_STORE: 'play_store',
  INTERNAL: 'internal'
};

// Deployment statuses
export const DEPLOYMENT_STATUSES = {
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  IN_REVIEW: 'in_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  LIVE: 'live'
};

// Asset types
export const ASSET_TYPES = {
  LOGO: 'logo',
  ICON: 'icon',
  SPLASH: 'splash',
  SCREENSHOT: 'screenshot',
  FAVICON: 'favicon',
  OTHER: 'other'
};

// Template categories
export const TEMPLATE_CATEGORIES = [
  'Restaurant',
  'Retail',
  'Entertainment',
  'Fitness',
  'General'
];




