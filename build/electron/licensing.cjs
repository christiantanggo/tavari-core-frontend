const { ipcMain } = require('electron');
const { machineIdSync } = require('node-machine-id');
const os = require('os');

class LicenseManager {
  constructor() {
    this.setupIpcHandlers();
  }

  setupIpcHandlers() {
    ipcMain.handle('register-installation', async (event, data) => {
      return this.registerInstallation(data);
    });

    ipcMain.handle('validate-license', async (event, licenseKey) => {
      return this.validateLicense(licenseKey);
    });

    ipcMain.handle('get-device-fingerprint', async () => {
      return this.getDeviceFingerprint();
    });
  }

  getDeviceFingerprint() {
    try {
      const machineId = machineIdSync();
      const hostname = os.hostname();
      const platform = os.platform();
      const arch = os.arch();
      
      return `${machineId}-${hostname}-${platform}-${arch}`;
    } catch (error) {
      console.error('Error generating device fingerprint:', error);
      return `fallback-${Date.now()}`;
    }
  }

  async registerInstallation(data) {
    try {
      const deviceFingerprint = this.getDeviceFingerprint();
      const systemInfo = {
        device_fingerprint: deviceFingerprint,
        device_name: os.hostname(),
        windows_version: os.release(),
        app_version: require('../package.json').version
      };

      // Send to your existing Supabase via the renderer process
      return { success: true, fingerprint: deviceFingerprint, ...systemInfo };
    } catch (error) {
      console.error('Registration error:', error);
      return { success: false, error: error.message };
    }
  }

  async validateLicense(licenseKey) {
    try {
      // Basic validation format
      if (!licenseKey || licenseKey.length < 16) {
        return { valid: false, error: 'Invalid license format' };
      }

      // This will be validated against Supabase in the renderer process
      return { valid: true, requiresOnlineValidation: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
}

module.exports = new LicenseManager();