// build/electron/installationManager.cjs
// PHASE 2, STEPS 38-43: Installation management module
// Purpose: Handle device fingerprinting, installation registration, and license validation

const crypto = require('crypto');
const os = require('os');
const { machineIdSync } = require('node-machine-id');
const { v4: uuidv4 } = require('uuid');

// Supabase client setup (will be initialized if env vars are available)
let supabaseClient = null;

function initSupabaseClient() {
  if (supabaseClient) {
    return supabaseClient;
  }
  
  try {
    // Try to get Supabase credentials from environment or config
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (supabaseUrl && supabaseAnonKey) {
      // Note: In Electron main process, we'd need to use CommonJS version of @supabase/supabase-js
      // For now, we'll use IPC to communicate with renderer, or set up client if available
      // This is a placeholder - actual implementation depends on how Supabase is set up
      console.log('Supabase client would be initialized here');
      // supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    }
  } catch (error) {
    console.warn('Could not initialize Supabase client in main process:', error.message);
  }
  
  return supabaseClient;
}

// STEP 39: Generate device fingerprint
function generateDeviceFingerprint() {
  try {
    const machineId = machineIdSync();
    const hostname = os.hostname();
    const platform = os.platform();
    const arch = os.arch();
    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown';
    
    // Collect network interfaces for MAC address
    // Sort interface names to ensure deterministic selection
    const networkInterfaces = os.networkInterfaces();
    let macAddress = 'unknown';
    const interfaceNames = Object.keys(networkInterfaces).sort();
    
    for (const interfaceName of interfaceNames) {
      const interfaces = networkInterfaces[interfaceName];
      // Sort interfaces by family to ensure deterministic selection
      const sortedInterfaces = interfaces.sort((a, b) => {
        if (a.family !== b.family) return a.family.localeCompare(b.family);
        return 0;
      });
      
      for (const iface of sortedInterfaces) {
        if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
          macAddress = iface.mac;
          break;
        }
      }
      if (macAddress !== 'unknown') break;
    }
    
    // Combine all data
    const fingerprintData = `${machineId}-${hostname}-${platform}-${arch}-${cpuModel}-${macAddress}`;
    
    // Hash the data
    const hash = crypto.createHash('sha256');
    hash.update(fingerprintData);
    const fingerprint = hash.digest('hex');
    
    return fingerprint;
  } catch (error) {
    console.error('Error generating device fingerprint:', error);
    // Fallback fingerprint
    return `fallback-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }
}

// STEP 40: Register installation
// Note: This function will need to communicate with Supabase via IPC or direct client
async function registerInstallation(businessId, deviceInfo = {}) {
  try {
    if (!businessId) {
      throw new Error('businessId is required');
    }
    
    const deviceFingerprint = generateDeviceFingerprint();
    const installationKey = uuidv4();
    
    const installationData = {
      business_id: businessId,
      installation_key: installationKey,
      device_fingerprint: deviceFingerprint,
      device_name: deviceInfo.deviceName || os.hostname(),
      windows_version: deviceInfo.windowsVersion || os.release(),
      app_version: deviceInfo.appVersion || require('../../package.json').version || '1.0.0',
      status: 'active',
      installed_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      license_type: deviceInfo.licenseType || 'trial',
      expires_at: deviceInfo.expiresAt || null
    };
    
    // TODO: Insert into Supabase music_installations table
    // This will need to be done via IPC to renderer process or direct Supabase client
    // For now, return the data structure that should be inserted
    
    return {
      success: true,
      installation_key: installationKey,
      installation_id: null, // Will be set after database insert
      device_fingerprint: deviceFingerprint,
      data: installationData
    };
  } catch (error) {
    console.error('Error registering installation:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// STEP 41: Validate installation key
async function validateInstallationKey(installationKey) {
  try {
    if (!installationKey) {
      return null;
    }
    
    // TODO: Query Supabase music_installations table
    // SELECT * FROM music_installations 
    // WHERE installation_key = $1 AND status = 'active'
    // AND (expires_at IS NULL OR expires_at > now())
    
    // For now, return structure that would be returned
    // This will need to be implemented via IPC or direct Supabase client
    
    return {
      valid: false, // Will be set based on actual query result
      installation: null,
      error: 'Not implemented - requires Supabase integration'
    };
  } catch (error) {
    console.error('Error validating installation key:', error);
    return {
      valid: false,
      installation: null,
      error: error.message
    };
  }
}

// STEP 42: Update last seen
async function updateLastSeen(installationId) {
  try {
    if (!installationId) {
      return { success: false, error: 'installationId is required' };
    }
    
    // TODO: Update Supabase music_installations table
    // UPDATE music_installations 
    // SET last_seen = now() 
    // WHERE id = $1
    
    // This is a non-critical operation, so we handle errors silently
    return {
      success: true,
      message: 'Last seen updated (not implemented - requires Supabase integration)'
    };
  } catch (error) {
    // Silent error handling for non-critical operation
    console.warn('Error updating last seen (non-critical):', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// STEP 43: Check license status
async function checkLicenseStatus(installationId) {
  try {
    if (!installationId) {
      return {
        valid: false,
        error: 'installationId is required'
      };
    }
    
    // TODO: Query Supabase music_installations table
    // SELECT license_type, expires_at FROM music_installations WHERE id = $1
    
    // Calculate days until expiration
    const now = new Date();
    // const expiresAt = ... (from query)
    // const daysUntilExpiration = expiresAt ? Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)) : null
    
    return {
      valid: false, // Will be set based on actual query
      licenseType: null,
      expiresAt: null,
      daysUntilExpiration: null,
      isExpired: false,
      warnings: [],
      error: 'Not implemented - requires Supabase integration'
    };
  } catch (error) {
    console.error('Error checking license status:', error);
    return {
      valid: false,
      error: error.message
    };
  }
}

// Additional function: Report health status (from plan Step 44)
async function reportHealthStatus(installationId, healthStatus) {
  try {
    if (!installationId) {
      return { success: false, error: 'installationId is required' };
    }
    
    if (!healthStatus || typeof healthStatus !== 'object') {
      return { success: false, error: 'healthStatus object is required' };
    }
    
    // TODO: Insert/update Supabase music_installation_health table
    // This will use the health table we created in Phase 1
    
    const healthData = {
      installation_id: installationId,
      health_status: healthStatus.status || 'healthy',
      last_online_check: healthStatus.lastOnlineCheck || new Date().toISOString(),
      last_playback_check: healthStatus.lastPlaybackCheck || null,
      playback_errors_count: healthStatus.playbackErrorsCount || 0,
      network_errors_count: healthStatus.networkErrorsCount || 0,
      cache_errors_count: healthStatus.cacheErrorsCount || 0,
      last_error_message: healthStatus.lastErrorMessage || null,
      reported_at: new Date().toISOString()
    };
    
    return {
      success: true,
      message: 'Health status reported (not implemented - requires Supabase integration)',
      data: healthData
    };
  } catch (error) {
    console.error('Error reporting health status:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Get device info for registration
function getDeviceInfo() {
  return {
    deviceName: os.hostname(),
    windowsVersion: os.release(),
    platform: os.platform(),
    arch: os.arch(),
    appVersion: require('../../package.json').version || '1.0.0',
    fingerprint: generateDeviceFingerprint()
  };
}

module.exports = {
  generateDeviceFingerprint,
  registerInstallation,
  validateInstallationKey,
  updateLastSeen,
  checkLicenseStatus,
  reportHealthStatus,
  getDeviceInfo,
  initSupabaseClient
};




