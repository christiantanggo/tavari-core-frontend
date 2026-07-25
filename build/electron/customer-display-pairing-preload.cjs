const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tavariCustomerDisplayPairing', {
  submitCode: (code) => ipcRenderer.invoke('customer-display-pairing-submit', code)
});
