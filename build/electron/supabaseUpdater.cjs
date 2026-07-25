// build/electron/supabaseUpdater.cjs
// Custom auto-updater that works with Supabase Storage
// Downloads installers directly from Supabase and installs them

const { app, dialog, shell } = require('electron');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const log = require('electron-log');

// Supabase configuration
// Get from environment or use defaults
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://iagcamwcfuiopmwefohz.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_PROJECT_ID = SUPABASE_URL.match(/https?:\/\/([^.]+)/)?.[1] || 'iagcamwcfuiopmwefohz';

class SupabaseUpdateManager {
  constructor() {
    this.currentVersion = app.getVersion();
    this.updateInfo = null;
    this.downloadPath = null;
    this.isDownloading = false;
    this.downloadProgress = 0;
  }

  /**
   * Check Supabase for latest version
   */
  async checkForUpdates() {
    try {
      log.info('🔍 Checking for updates from Supabase...');
      log.info(`   Current version: ${this.currentVersion}`);

      // Call Supabase function to get latest version
      const response = await this.fetchSupabaseFunction('get_latest_app_version');
      
      if (!response || !response.version_number) {
        log.info('✅ No updates available');
        return { updateAvailable: false };
      }

      const latestVersion = response.version_number;
      log.info(`   Latest version: ${latestVersion}`);

      // Compare versions
      if (this.isNewerVersion(latestVersion, this.currentVersion)) {
        log.info('🆕 Update available!');
        this.updateInfo = response;
        return {
          updateAvailable: true,
          version: latestVersion,
          info: response
        };
      } else {
        log.info('✅ App is up to date');
        return { updateAvailable: false };
      }
    } catch (error) {
      log.error('❌ Error checking for updates:', error);
      return { updateAvailable: false, error: error.message };
    }
  }

  /**
   * Fetch from Supabase function
   */
  async fetchSupabaseFunction(functionName) {
    return new Promise((resolve, reject) => {
      const url = `${SUPABASE_URL}/rest/v1/rpc/${functionName}`;
      
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      };

      const protocol = url.startsWith('https') ? https : http;
      const req = protocol.request(url, options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const result = JSON.parse(data);
              // Function returns array, get first item
              resolve(Array.isArray(result) && result.length > 0 ? result[0] : result);
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            }
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Compare version strings (e.g., "1.0.1" vs "1.0.0")
   */
  isNewerVersion(latest, current) {
    const latestParts = latest.split('.').map(Number);
    const currentParts = current.split('.').map(Number);
    
    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
      const latestPart = latestParts[i] || 0;
      const currentPart = currentParts[i] || 0;
      
      if (latestPart > currentPart) return true;
      if (latestPart < currentPart) return false;
    }
    
    return false;
  }

  /**
   * Download installer from Supabase Storage
   */
  async downloadUpdate(platform = 'windows') {
    if (!this.updateInfo) {
      throw new Error('No update info available. Check for updates first.');
    }

    if (this.isDownloading) {
      log.warn('⚠️ Download already in progress');
      return;
    }

    this.isDownloading = true;
    this.downloadProgress = 0;

    try {
      // Get installer URL for platform
      let installerUrl;
      if (platform === 'windows') {
        installerUrl = this.updateInfo.installer_url_windows;
      } else if (platform === 'mac') {
        installerUrl = this.updateInfo.installer_url_mac;
      } else if (platform === 'linux') {
        installerUrl = this.updateInfo.installer_url_linux;
      } else {
        throw new Error(`Unsupported platform: ${platform}`);
      }

      if (!installerUrl) {
        throw new Error(`No installer URL available for platform: ${platform}`);
      }

      log.info(`📥 Downloading update from: ${installerUrl}`);

      // If URL is relative, make it absolute using Supabase Storage
      if (installerUrl.startsWith('/')) {
        installerUrl = `https://${SUPABASE_PROJECT_ID}.supabase.co/storage/v1/object/public/music-installers${installerUrl}`;
      } else if (!installerUrl.startsWith('http')) {
        installerUrl = `https://${SUPABASE_PROJECT_ID}.supabase.co/storage/v1/object/public/music-installers/${installerUrl}`;
      }

      // Download file
      const downloadPath = path.join(app.getPath('temp'), `tavari-music-update-${this.updateInfo.version_number}.exe`);
      await this.downloadFile(installerUrl, downloadPath);

      this.downloadPath = downloadPath;
      log.info(`✅ Update downloaded to: ${downloadPath}`);

      return downloadPath;
    } catch (error) {
      log.error('❌ Download failed:', error);
      throw error;
    } finally {
      this.isDownloading = false;
    }
  }

  /**
   * Download file with progress tracking
   */
  async downloadFile(url, filePath) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(filePath);

      protocol.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Follow redirect
          return this.downloadFile(response.headers.location, filePath)
            .then(resolve)
            .catch(reject);
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          this.downloadProgress = totalSize ? (downloadedSize / totalSize) * 100 : 0;
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve(filePath);
        });

        file.on('error', (err) => {
          fs.unlink(filePath, () => {}); // Delete file on error
          reject(err);
        });
      }).on('error', reject);
    });
  }

  /**
   * Install the downloaded update
   */
  async installUpdate(autoInstall = false) {
    if (!this.downloadPath || !fs.existsSync(this.downloadPath)) {
      throw new Error('No update file available. Download update first.');
    }

    log.info(`🔧 Installing update from: ${this.downloadPath}`);

    // For kiosk mode or auto-install, skip confirmation
    if (autoInstall || process.env.KIOSK_MODE === 'true') {
      log.info('🔧 Auto-installing update (kiosk mode)');
      // Launch installer silently
      if (process.platform === 'win32') {
        spawn(this.downloadPath, ['/S'], {
          detached: true,
          stdio: 'ignore'
        });
      } else if (process.platform === 'darwin') {
        shell.openPath(this.downloadPath);
      } else {
        fs.chmodSync(this.downloadPath, '755');
        spawn(this.downloadPath, [], {
          detached: true,
          stdio: 'ignore'
        });
      }
      // Quit app (installer will restart it)
      setTimeout(() => {
        app.quit();
      }, 2000);
      return;
    }

    // Show dialog asking user to confirm
    const result = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `Tavari Music v${this.updateInfo.version_number} is ready to install`,
      detail: 'The installer will launch. Please follow the installation prompts.\n\nAfter installation, the app will restart automatically.',
      buttons: ['Install Now', 'Later'],
      defaultId: 0,
      cancelId: 1
    });

    if (result.response === 0) {
      // Launch installer
      if (process.platform === 'win32') {
        spawn(this.downloadPath, ['/S'], {
          detached: true,
          stdio: 'ignore'
        });
      } else if (process.platform === 'darwin') {
        shell.openPath(this.downloadPath);
      } else {
        fs.chmodSync(this.downloadPath, '755');
        spawn(this.downloadPath, [], {
          detached: true,
          stdio: 'ignore'
        });
      }

      // Quit app (installer will restart it)
      setTimeout(() => {
        app.quit();
      }, 2000);
    }
  }

  /**
   * Check and download update automatically
   */
  async checkAndDownloadUpdate(platform = 'windows', showNotifications = true) {
    try {
      const checkResult = await this.checkForUpdates();
      
      if (!checkResult.updateAvailable) {
        if (showNotifications) {
          dialog.showMessageBox({
            type: 'info',
            title: 'No Updates',
            message: 'You are running the latest version',
            buttons: ['OK']
          });
        }
        return { updateAvailable: false };
      }

      // Show update available dialog
      if (showNotifications) {
        const result = await dialog.showMessageBox({
          type: 'info',
          title: 'Update Available',
          message: `Tavari Music v${checkResult.version} is available`,
          detail: checkResult.info.release_notes || 'A new version is available for download.',
          buttons: ['Download Now', 'Later'],
          defaultId: 0,
          cancelId: 1
        });

        if (result.response === 1) {
          return { updateAvailable: true, downloaded: false };
        }
      }

      // Download update
      log.info('📥 Downloading update...');
      await this.downloadUpdate(platform);

      // Install update (auto-install in kiosk mode)
      const isKioskMode = process.env.KIOSK_MODE === 'true';
      await this.installUpdate(isKioskMode);

      return { updateAvailable: true, downloaded: true };
    } catch (error) {
      log.error('❌ Update process failed:', error);
      if (showNotifications) {
        dialog.showErrorBox('Update Failed', error.message);
      }
      return { updateAvailable: false, error: error.message };
    }
  }

  /**
   * Get download progress (0-100)
   */
  getDownloadProgress() {
    return this.downloadProgress;
  }
}

module.exports = new SupabaseUpdateManager();

