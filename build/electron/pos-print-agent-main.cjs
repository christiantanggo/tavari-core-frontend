/**
 * Electron tray app: Tavari Receipt Printer helper.
 * Silent local bridge so the web POS can print ESC/POS to LAN printers.
 * Does NOT replace music/waiver Electron launchers.
 */
const { app, Tray, Menu, nativeImage, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.tavari.pos-print-agent');
}

/** Minimal 16x16 teal PNG for tray (no external icon asset required). */
function createTrayIcon() {
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAPElEQVQ4T2NkYGD4z0ABYBzVMKoBBgYGBob/DAwMjP8ZGBj+MzAw/P8PAowgGkYGBgYGRgYGhv8MDAAAAAD//wMAF9gCAfVxY2sAAAAASUVORK5CYII=';
  // Prefer a solid teal square generated at runtime when possible
  try {
    const size = 16;
    // 1x1 teal pixel scaled — Electron accepts PNG buffers
    const tealPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const img = nativeImage.createFromBuffer(tealPng);
    if (!img.isEmpty()) {
      return img.resize({ width: size, height: size });
    }
  } catch {
    /* fall through */
  }
  return nativeImage.createFromDataURL(`data:image/png;base64,${pngBase64}`);
}

function resolvePrintAgentLib() {
  const candidates = [
    path.join(__dirname, '..', '..', 'tools', 'pos-print-agent', 'lib.cjs'),
    path.join(process.resourcesPath || '', 'tools', 'pos-print-agent', 'lib.cjs'),
    path.join(app.getAppPath(), 'tools', 'pos-print-agent', 'lib.cjs'),
    path.join(__dirname, 'pos-print-agent-lib.cjs'),
  ];
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}

let tray = null;
let agentHandle = null;
let lastStatus = 'Starting…';
const logLines = [];

function pushLog(line) {
  const stamped = `[${new Date().toLocaleTimeString()}] ${line}`;
  logLines.push(stamped);
  if (logLines.length > 200) logLines.shift();
  console.log(stamped);
}

function setStatus(text) {
  lastStatus = text;
  if (tray && !tray.isDestroyed()) {
    tray.setToolTip(`Tavari Receipt Printer — ${text}`);
  }
  rebuildMenu();
}

function rebuildMenu() {
  if (!tray || tray.isDestroyed()) return;
  const menu = Menu.buildFromTemplate([
    { label: `Status: ${lastStatus}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Show recent logs',
      click: () => {
        dialog.showMessageBox({
          type: 'info',
          title: 'Tavari Receipt Printer',
          message: 'Recent activity',
          detail: logLines.slice(-40).join('\n') || 'No activity yet.',
        });
      },
    },
    {
      label: 'Open at login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true });
        pushLog(`Open at login: ${item.checked ? 'on' : 'off'}`);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: async () => {
        if (agentHandle?.stop) await agentHandle.stop();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

async function startAgent() {
  const libPath = resolvePrintAgentLib();
  if (!libPath) {
    setStatus('Missing print library');
    pushLog('Could not find tools/pos-print-agent/lib.cjs');
    dialog.showErrorBox(
      'Tavari Receipt Printer',
      'Print helper library is missing. Reinstall Tavari Receipt Printer.'
    );
    return;
  }

  // eslint-disable-next-line import/no-dynamic-require, global-require
  const { startPrintAgent } = require(libPath);
  try {
    agentHandle = startPrintAgent({
      log: (msg) => pushLog(String(msg)),
      logError: (...args) => pushLog(args.map(String).join(' ')),
    });
    await agentHandle.ready;
    setStatus(`Running on port ${agentHandle.port}`);
    pushLog(`Helper ready at http://${agentHandle.host}:${agentHandle.port}`);
    if (Notification.isSupported()) {
      new Notification({
        title: 'Tavari Receipt Printer',
        body: 'Ready — POS can print to your receipt printer.',
      }).show();
    }
  } catch (err) {
    const message = err?.message || String(err);
    setStatus('Failed to start');
    pushLog(`Start failed: ${message}`);
    dialog.showErrorBox(
      'Tavari Receipt Printer',
      `Could not start the print helper.\n\n${message}\n\nIs another copy already running?`
    );
  }
}

app.whenReady().then(async () => {
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true,
  });

  tray = new Tray(createTrayIcon());
  tray.setToolTip('Tavari Receipt Printer');
  rebuildMenu();

  await startAgent();
});

app.on('window-all-closed', () => {
  // Tray-only app: do not quit when no BrowserWindows exist.
});

app.on('second-instance', () => {
  if (Notification.isSupported()) {
    new Notification({
      title: 'Tavari Receipt Printer',
      body: 'Already running in the system tray.',
    }).show();
  }
});
