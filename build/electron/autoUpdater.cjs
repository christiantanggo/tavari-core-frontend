const { autoUpdater } = require('electron-updater');
const { dialog } = require('electron');
const log = require('electron-log');

// Configure logging
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

// Configure update server
autoUpdater.setFeedURL({
  provider: 'generic',
  url: 'https://updates.tavari.com/music-desktop'
});

class UpdateManager {
  constructor() {
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    autoUpdater.on('checking-for-update', () => {
      log.info('Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
      log.info('Update available:', info);
      this.notifyUpdateAvailable(info);
    });

    autoUpdater.on('update-not-available', (info) => {
      log.info('Update not available:', info);
    });

    autoUpdater.on('error', (err) => {
      log.error('Update error:', err);
    });

    autoUpdater.on('download-progress', (progressObj) => {
      log.info(`Download progress: ${progressObj.percent}%`);
    });

    autoUpdater.on('update-downloaded', (info) => {
      log.info('Update downloaded:', info);
      this.notifyUpdateReady(info);
    });
  }

  async checkForUpdates() {
    try {
      const result = await autoUpdater.checkForUpdatesAndNotify();
      return result;
    } catch (error) {
      log.error('Check for updates failed:', error);
      return null;
    }
  }

  notifyUpdateAvailable(info) {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `Tavari Music v${info.version} is available`,
      detail: 'The update will be downloaded in the background.',
      buttons: ['OK']
    });
  }

  notifyUpdateReady(info) {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'Update downloaded and ready to install',
      detail: 'Restart the application to apply the update.',
      buttons: ['Restart Now', 'Later']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  }
}

module.exports = new UpdateManager();