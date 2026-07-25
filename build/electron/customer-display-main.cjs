/**
 * Electron entry: POS customer-facing display on a second monitor.
 * Pairing: no config file → 6-digit code (from POS → Customer display) redeems read_token via Supabase.
 */
const { app, BrowserWindow, screen, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = process.env.NODE_ENV === 'development';

if (process.platform === 'win32') {
  app.setAppUserModelId('com.tavari.customer-display');
}

let displayWindow = null;
let pairingWindow = null;

function focusExistingMainWindow() {
  if (displayWindow && !displayWindow.isDestroyed()) {
    if (displayWindow.isMinimized()) displayWindow.restore();
    displayWindow.show();
    displayWindow.focus();
    return true;
  }
  if (pairingWindow && !pairingWindow.isDestroyed()) {
    if (pairingWindow.isMinimized()) pairingWindow.restore();
    pairingWindow.show();
    pairingWindow.focus();
    return true;
  }
  return false;
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

function getProductionUrl() {
  return (
    process.env.VITE_PRODUCTION_URL ||
    process.env.PRODUCTION_URL ||
    'https://www.tavarios.ca'
  );
}

/** Optional JSON: { "productionUrl", "hashRoute", "displayToken": "uuid", "staffProof": false } */
function readOptionalConfig() {
  const candidates = [
    path.join(__dirname, 'customer-display-config.json'),
    path.join(path.dirname(app.getPath('exe')), 'customer-display-config.json'),
    path.join(app.getPath('userData'), 'customer-display-config.json')
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (raw && typeof raw === 'object') return raw;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function writeCustomerDisplayConfig(obj) {
  const json = JSON.stringify(obj, null, 2);
  const preferred = path.join(path.dirname(app.getPath('exe')), 'customer-display-config.json');
  const fallback = path.join(app.getPath('userData'), 'customer-display-config.json');
  for (const p of [preferred, fallback]) {
    try {
      fs.writeFileSync(p, json, 'utf8');
      return { path: p };
    } catch {
      /* try next */
    }
  }
  return { error: 'Could not save config. Try running the app as administrator, or contact support.' };
}

function pickExternalDisplayBounds() {
  const displays = screen.getAllDisplays();
  if (!displays.length) {
    return { x: 0, y: 0, width: 1280, height: 720 };
  }
  const primary = screen.getPrimaryDisplay();
  const external = displays.find((d) => d.id !== primary.id);
  const target = external || primary;
  const { x, y, width, height } = target.bounds;
  return { x, y, width, height };
}

function isStaffProofMode(cfg) {
  if (process.env.CUSTOMER_DISPLAY_BROWSER_MODE === 'true') return false;
  if (cfg && cfg.staffProof === false) return false;
  if (!app.isPackaged && process.env.CUSTOMER_DISPLAY_STAFF_PROOF !== 'true') return false;
  return true;
}

function createCustomerDisplayWindow() {
  const cfg = readOptionalConfig();
  const staffProof = isStaffProofMode(cfg);
  const { x, y, width, height } = pickExternalDisplayBounds();

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    title: 'Tavari Customer Display',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    show: false,
    autoHideMenuBar: true,
    frame: !staffProof,
    fullscreen: false,
    fullscreenable: staffProof,
    skipTaskbar: staffProof,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'customer-display-preload.cjs'),
      webSecurity: true
    }
  });

  displayWindow = win;

  const baseUrl = (cfg && cfg.productionUrl) || getProductionUrl();
  const normalizedBase = String(baseUrl).replace(/\/$/, '');
  const hashRoute = (cfg && cfg.hashRoute) || (cfg && cfg.path) || '/customer-display';
  const route = hashRoute.startsWith('/') ? hashRoute : `/${hashRoute}`;

  const port = process.env.VITE_PORT || '5173';
  const displayToken = (cfg && cfg.displayToken) || process.env.CUSTOMER_DISPLAY_TOKEN || '';
  const baseForUrl = isDev ? `http://localhost:${port}/` : `${normalizedBase}/`;
  const loadUrl = new URL(baseForUrl);
  const tokenTrim = String(displayToken).trim();
  if (tokenTrim) {
    loadUrl.searchParams.set('displayToken', tokenTrim);
  }
  // HashRouter: token in hash is reliable; some builds dropped query-before-hash for sessionStorage
  let hashFragment = route;
  if (tokenTrim) {
    const enc = encodeURIComponent(tokenTrim);
    hashFragment = `${route}?displayToken=${enc}`;
  }
  const startUrl = `${loadUrl.origin}${loadUrl.pathname}${loadUrl.search}#${hashFragment}`;

  win.once('ready-to-show', () => {
    win.show();
    if (staffProof) {
      win.setMenuBarVisibility(false);
      win.setFullScreen(true);
    } else if (process.env.CUSTOMER_DISPLAY_FULLSCREEN === 'true') {
      win.setFullScreen(true);
    }
  });

  if (staffProof) {
    const ok = globalShortcut.register('CommandOrControl+Shift+Q', () => {
      app.quit();
    });
    if (!ok) {
      console.warn('[CustomerDisplay] Could not register Ctrl+Shift+Q quit shortcut');
    }
  }

  win.loadURL(startUrl).catch((err) => {
    console.error('[CustomerDisplay] loadURL failed:', err);
  });

  win.on('closed', () => {
    displayWindow = null;
    app.quit();
  });
}

function getPairingLoadUrl() {
  if (isDev) {
    const port = process.env.VITE_PORT || '5173';
    return `http://127.0.0.1:${port}/#/customer-display-pair`;
  }
  let base = readOptionalConfig()?.productionUrl || getProductionUrl();
  base = String(base).replace(/\/$/, '');
  return `${base}/#/customer-display-pair`;
}

function createPairingWindow() {
  pairingWindow = new BrowserWindow({
    width: 460,
    height: 560,
    resizable: false,
    minimizable: true,
    maximizable: false,
    title: 'Connect — Tavari Customer Display',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'customer-display-preload.cjs')
    }
  });

  pairingWindow.loadURL(getPairingLoadUrl()).catch((err) => {
    console.error('[CustomerDisplay] pairing loadURL failed:', err);
  });

  pairingWindow.on('closed', () => {
    pairingWindow = null;
    if (!displayWindow) {
      app.quit();
    }
  });
}

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    focusExistingMainWindow();
  });

  ipcMain.handle('customer-display-complete-pairing', async (_event, cfgIn) => {
    try {
      const cfg = cfgIn && typeof cfgIn === 'object' ? cfgIn : {};
      const productionUrl = String(cfg.productionUrl || '').replace(/\/$/, '');
      const displayToken = String(cfg.displayToken || '').trim();
      const hashRoute = cfg.hashRoute || '/customer-display';
      if (!displayToken || !productionUrl) {
        return { ok: false, message: 'Missing token or site URL.' };
      }
      const toSave = { productionUrl, displayToken, hashRoute };
      const w = writeCustomerDisplayConfig(toSave);
      if (w.error) {
        return { ok: false, message: w.error };
      }
      createCustomerDisplayWindow();
      if (pairingWindow && !pairingWindow.isDestroyed()) {
        pairingWindow.close();
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err?.message || 'Could not save pairing.' };
    }
  });

  app.whenReady().then(() => {
    const cfg = readOptionalConfig();
    const token = (cfg && cfg.displayToken) || process.env.CUSTOMER_DISPLAY_TOKEN || '';
    if (String(token).trim()) {
      createCustomerDisplayWindow();
    } else {
      createPairingWindow();
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
