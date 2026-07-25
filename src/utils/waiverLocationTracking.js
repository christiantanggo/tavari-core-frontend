// src/utils/waiverLocationTracking.js
// Location tracking for waiver signing (insurance requirements)
// Tracks where waiver was signed: browser, kiosk, in-person, off-site

/**
 * Get current device location using browser geolocation API
 * @returns {Promise<{latitude: number, longitude: number, address?: string, error?: string}>}
 */
export async function getDeviceLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ error: 'Geolocation is not supported by this browser' });
      return;
    }

    const options = {
      enableHighAccuracy: false, // Don't need high accuracy for waiver signing
      timeout: 10000, // 10 second timeout
      maximumAge: 3600000 // Cache for 1 hour
    };

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        
        // Optionally reverse geocode to get address
        let address = null;
        try {
          address = await reverseGeocode(latitude, longitude);
        } catch (error) {
          console.warn('[waiverLocationTracking] Reverse geocoding failed:', error);
        }

        resolve({
          latitude,
          longitude,
          address
        });
      },
      (error) => {
        console.warn('[waiverLocationTracking] Geolocation error:', error);
        resolve({ error: error.message || 'Could not get location' });
      },
      options
    );
  });
}

/**
 * Reverse geocode coordinates to get address
 * @param {number} latitude - Latitude
 * @param {number} longitude - Longitude
 * @returns {Promise<string>} Formatted address
 */
async function reverseGeocode(latitude, longitude) {
  try {
    // Use a free reverse geocoding service (can be replaced with Google Maps API or similar)
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`
    );
    
    if (!response.ok) {
      throw new Error('Reverse geocoding failed');
    }

    const data = await response.json();
    const address = data.address;

    // Format address string
    const parts = [];
    if (address.road) parts.push(address.road);
    if (address.city || address.town) parts.push(address.city || address.town);
    if (address.state) parts.push(address.state);
    if (address.postcode) parts.push(address.postcode);
    if (address.country) parts.push(address.country);

    return parts.join(', ');
  } catch (error) {
    console.warn('[waiverLocationTracking] Reverse geocoding error:', error);
    return null;
  }
}

/**
 * Detect location source based on environment
 * @returns {string} 'browser', 'kiosk', 'in_person', 'off_site', or 'mobile_app'
 */
export function detectLocationSource() {
  // Check if Electron (kiosk)
  if (window.electronAPI || window.__TAVARI_ELECTRON__) {
    return 'kiosk';
  }

  // Check if mobile app (if we have a flag for that)
  if (window.__TAVARI_MOBILE_APP__) {
    return 'mobile_app';
  }

  // Default to browser (could be enhanced with more detection logic)
  return 'browser';
}

/**
 * Get location data for waiver signing
 * @param {string} source - Override source ('browser', 'kiosk', 'in_person', 'off_site')
 * @returns {Promise<{
 *   latitude?: number,
 *   longitude?: number,
 *   address?: string,
 *   city?: string,
 *   state?: string,
 *   postal_code?: string,
 *   country?: string,
 *   source: string,
 *   error?: string
 * }>}
 */
export async function getLocationData(source = null) {
  const detectedSource = source || detectLocationSource();
  
  // For in-person or off-site, we might not have GPS coordinates
  if (detectedSource === 'in_person' || detectedSource === 'off_site') {
    return {
      source: detectedSource,
      // Can still try to get location, but it's optional
    };
  }

  // For browser/kiosk/mobile_app, try to get GPS location
  const location = await getDeviceLocation();
  
  if (location.error) {
    return {
      source: detectedSource,
      error: location.error
    };
  }

  // Parse address if available
  let city = null;
  let state = null;
  let postalCode = null;
  let country = 'CA'; // Default to Canada

  if (location.address) {
    // Simple parsing - can be enhanced
    const parts = location.address.split(', ');
    if (parts.length > 1) {
      city = parts[parts.length - 3] || null;
      state = parts[parts.length - 2] || null;
      postalCode = parts[parts.length - 1]?.match(/\b[A-Z]\d[A-Z] ?\d[A-Z]\d\b/)?.[0] || null;
    }
  }

  return {
    latitude: location.latitude,
    longitude: location.longitude,
    address: location.address,
    city,
    state,
    postal_code: postalCode,
    country,
    source: detectedSource
  };
}

/**
 * Get IP address (fallback if GPS unavailable)
 * @returns {Promise<string>}
 */
export async function getIPAddress() {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    return data.ip || 'unknown';
  } catch (error) {
    console.warn('[waiverLocationTracking] Could not get IP address:', error);
    return 'unknown';
  }
}





