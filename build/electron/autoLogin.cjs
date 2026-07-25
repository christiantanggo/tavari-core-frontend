// build/electron/autoLogin.cjs
// Handles auto-login for headless mini PC installations
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const CONFIG_FILE = path.join(app.getPath('userData'), 'tavari-config.json');

/**
 * Save installation credentials for auto-login
 */
function saveInstallationCredentials(businessId, sessionToken, refreshToken) {
  try {
    const config = {
      businessId,
      sessionToken,
      refreshToken,
      savedAt: new Date().toISOString(),
      autoLogin: true
    };
    
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('✅ Installation credentials saved');
    return true;
  } catch (error) {
    console.error('❌ Failed to save credentials:', error);
    return false;
  }
}

/**
 * Load installation credentials
 */
function loadInstallationCredentials() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return null;
    }
    
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    const config = JSON.parse(data);
    
    // Validate config has required fields
    if (!config.businessId || !config.sessionToken) {
      return null;
    }
    
    return config;
  } catch (error) {
    console.error('❌ Failed to load credentials:', error);
    return null;
  }
}

/**
 * Clear installation credentials
 */
function clearInstallationCredentials() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
      console.log('✅ Installation credentials cleared');
    }
    return true;
  } catch (error) {
    console.error('❌ Failed to clear credentials:', error);
    return false;
  }
}

/**
 * Check if auto-login is enabled
 */
function isAutoLoginEnabled() {
  const config = loadInstallationCredentials();
  return config && config.autoLogin === true;
}

module.exports = {
  saveInstallationCredentials,
  loadInstallationCredentials,
  clearInstallationCredentials,
  isAutoLoginEnabled,
  CONFIG_FILE
};




