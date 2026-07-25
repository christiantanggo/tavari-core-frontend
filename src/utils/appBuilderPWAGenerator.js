// Step 78: Create appBuilderPWAGenerator.js
// PWA manifest and service worker generation

/**
 * Generate PWA manifest
 * @param {Object} config - PWA configuration
 * @returns {Object} - PWA manifest JSON
 */
export const generateManifest = (config) => {
  const {
    name,
    shortName,
    description,
    startUrl = '/',
    display = 'standalone',
    backgroundColor = '#ffffff',
    themeColor = '#3B82F6',
    icons = []
  } = config;

  return {
    name: name || 'Tavari App',
    short_name: shortName || name || 'Tavari',
    description: description || `${name || 'Tavari'} App`,
    start_url: startUrl,
    display: display,
    background_color: backgroundColor,
    theme_color: themeColor,
    icons: icons,
    orientation: 'portrait',
    scope: '/',
    lang: 'en'
  };
};

/**
 * Generate service worker
 * @param {Object} config - Service worker configuration
 * @returns {string} - Service worker code
 */
export const generateServiceWorker = (config = {}) => {
  const {
    cacheName = 'tavari-app-v1',
    staticAssets = [],
    apiCachePatterns = []
  } = config;

  return `
// Service Worker for Tavari App
const CACHE_NAME = '${cacheName}';
const STATIC_ASSETS = ${JSON.stringify(staticAssets)};

// Install event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

// Fetch event
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        return response || fetch(event.request);
      })
  );
});

// Activate event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
});
  `.trim();
};

/**
 * Validate PWA configuration
 * @param {Object} config - PWA configuration
 * @returns {Object} - {valid: boolean, errors: string[]}
 */
export const validatePWAConfig = (config) => {
  const errors = [];

  if (!config.name || config.name.length < 3) {
    errors.push('App name must be at least 3 characters');
  }

  if (!config.icons || config.icons.length < 1) {
    errors.push('At least one icon is required');
  }

  if (!config.themeColor || !/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(config.themeColor)) {
    errors.push('Theme color must be a valid hex color');
  }

  return {
    valid: errors.length === 0,
    errors
  };
};




