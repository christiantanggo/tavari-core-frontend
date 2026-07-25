/**
 * Preload for Tavari Customer Display only (POS second screen).
 * Does NOT set __TAVARI_KIOSK_MODE__ — music / waiver kiosks are unaffected.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__TAVARI_CUSTOMER_DISPLAY_APP__', true);
contextBridge.exposeInMainWorld('__TAVARI_ELECTRON__', true);
contextBridge.exposeInMainWorld('tavariCustomerDisplayCompletePairing', (config) =>
  ipcRenderer.invoke('customer-display-complete-pairing', config)
);

delete window.require;
delete window.exports;
delete window.module;
