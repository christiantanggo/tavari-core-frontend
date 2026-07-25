const { contextBridge, ipcRenderer } = require('electron');

// Expose secure API to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // System information
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  
  // Update management
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  
  // App control
  restartApp: () => ipcRenderer.invoke('restart-app'),
  
  // Audio device management
  getAudioDevices: () => ipcRenderer.invoke('get-audio-devices'),
  
  // Installation management (legacy)
  registerInstallation: (data) => ipcRenderer.invoke('register-installation', data),
  validateLicense: (key) => ipcRenderer.invoke('validate-license', key),
  
  // PHASE 2: Installation management (new)
  installationRegister: (data) => ipcRenderer.invoke('installation:register', data),
  installationValidate: (key) => ipcRenderer.invoke('installation:validate', key),
  installationUpdateLastSeen: (id) => ipcRenderer.invoke('installation:update-last-seen', id),
  installationCheckLicense: (id) => ipcRenderer.invoke('installation:check-license', id),
  installationReportHealth: (id, status) => ipcRenderer.invoke('installation:report-health', id, status),
  
  // Health monitoring (legacy)
  reportHealth: (data) => ipcRenderer.invoke('report-health', data),
  
  // PHASE 2: File cache operations
  cacheSaveTrack: (trackId, fileData, metadata) => ipcRenderer.invoke('cache:save-track', trackId, fileData, metadata),
  cacheGetTrack: (trackId) => ipcRenderer.invoke('cache:get-track', trackId),
  cacheDeleteTrack: (trackId) => ipcRenderer.invoke('cache:delete-track', trackId),
  cacheGetStats: () => ipcRenderer.invoke('cache:get-stats'),
  cacheClear: () => ipcRenderer.invoke('cache:clear'),
  cacheEvictLruBytes: (minBytesToFree) => ipcRenderer.invoke('cache:evict-lru-bytes', minBytesToFree),
  
  // PHASE 2: Network monitoring
  networkCheck: () => ipcRenderer.invoke('network:check'),
  networkGetStatus: () => ipcRenderer.invoke('network:get-status'),
  
  // File system (limited)
  selectMusicFiles: () => ipcRenderer.invoke('select-music-files'),
  
  // Notifications
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', title, body),
  
  // Session management for auto-login
  saveSession: (sessionData) => ipcRenderer.invoke('save-session', sessionData),
  loadSession: () => ipcRenderer.invoke('load-session'),
  checkInstallationConfig: () => ipcRenderer.invoke('check-installation-config')
});

// PHASE 2: Listen for network events from main process
ipcRenderer.on('network-status-changed', (event, data) => {
  window.dispatchEvent(new CustomEvent('network-status-changed', { detail: data }));
});

ipcRenderer.on('network-reconnected', (event, data) => {
  window.dispatchEvent(new CustomEvent('network-reconnected', { detail: data }));
});

ipcRenderer.on('sync-required', () => {
  window.dispatchEvent(new CustomEvent('sync-required'));
});

// Expose kiosk mode flag to renderer
// ALWAYS true for Electron app - this is a dedicated music kiosk
contextBridge.exposeInMainWorld('__TAVARI_KIOSK_MODE__', true);
contextBridge.exposeInMainWorld('__TAVARI_ENABLE_AUTOPLAY__', true);
contextBridge.exposeInMainWorld('__TAVARI_ELECTRON__', true);

// Prevent access to Node.js APIs
delete window.require;
delete window.exports;
delete window.module;