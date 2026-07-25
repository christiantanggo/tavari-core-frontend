const { app, BrowserWindow, ipcMain, Menu, systemPreferences, screen, session, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require('url');
const isDev = process.env.NODE_ENV === 'development';
const fsSync = require('fs');

// Keep ALL Electron/Chromium data off OneDrive-backed folders (Roaming/Desktop/Documents).
// LocalAppData is not synced by OneDrive and is the correct place for kiosk caches.
function configureKioskUserDataPath() {
  const localAppData =
    process.env.LOCALAPPDATA ||
    path.join(process.env.USERPROFILE || 'C:\\Users\\Public', 'AppData', 'Local');
  const kioskUserData = path.join(localAppData, 'TavariMusicKiosk');
  try {
    fsSync.mkdirSync(kioskUserData, { recursive: true });
    app.setPath('userData', kioskUserData);
    console.log('📁 Kiosk userData (non-OneDrive):', kioskUserData);
  } catch (error) {
    console.warn('⚠️ Could not set kiosk userData path:', error.message);
  }
}
configureKioskUserDataPath();

if (!process.env.TAVARI_MUSIC_CACHE_MAX_MB) {
  process.env.TAVARI_MUSIC_CACHE_MAX_MB = '100';
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://iagcamwcfuiopmwefohz.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhZ2NhbXdjZnVpb3Btd2Vmb2h6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM1NjY1MTksImV4cCI6MjA2OTE0MjUxOX0.qIw6wSI7O3Yl6Av-LVfDYL9TyKWNpeH0f2WIl221QW4';

// 🔇 Fix for AUDIO_RENDERER_ERROR - allow autoplay without user gesture
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-media-stream');
// Cap Chromium HTTP cache so Electron profile does not grow without bound.
app.commandLine.appendSwitch('disk-cache-size', '52428800'); // 50 MB

let mainWindow;
let isLocked = false;

/** Remove old music caches from legacy Roaming AppData (often OneDrive-backed on mini PCs). */
function cleanupLegacyMusicCacheDirs() {
  const roaming = process.env.APPDATA;
  if (!roaming) return;

  const legacyRoots = [
    path.join(roaming, 'Tavari Music Desktop'),
    path.join(roaming, 'com.tavari.music-desktop'),
    path.join(roaming, 'tavari-music-desktop')
  ];

  legacyRoots.forEach((root) => {
    const cacheDir = path.join(root, 'cache');
    if (!fsSync.existsSync(cacheDir)) return;
    try {
      fsSync.rmSync(cacheDir, { recursive: true, force: true });
      console.log('🧹 Removed legacy music cache:', cacheDir);
    } catch (error) {
      console.warn('⚠️ Could not remove legacy cache:', cacheDir, error.message);
    }
  });
}

function isKioskStreamOnlyMode() {
  return process.env.TAVARI_KIOSK_OFFLINE_CACHE === '0';
}

/** Copy session + config from legacy Roaming AppData into LocalAppData (one-time after updater). */
function migrateLegacyKioskSessionFiles() {
  const roaming = process.env.APPDATA;
  const localAppData =
    process.env.LOCALAPPDATA ||
    path.join(process.env.USERPROFILE || 'C:\\Users\\Public', 'AppData', 'Local');
  if (!roaming) return;

  const legacyDirs = [
    path.join(roaming, 'Tavari Music Desktop'),
    path.join(roaming, 'com.tavari.music-desktop'),
    path.join(roaming, 'tavari-music-desktop')
  ];
  const newUserData = path.join(localAppData, 'TavariMusicKiosk');
  const destSession = path.join(newUserData, 'tavari-session.json');
  const destBackup = path.join(newUserData, 'tavari-session.backup.json');

  if (fsSync.existsSync(destSession)) return;

  for (const legacyDir of legacyDirs) {
    for (const name of ['tavari-session.json', 'tavari-session.backup.json']) {
      const src = path.join(legacyDir, name);
      const dest = name.includes('backup') ? destBackup : destSession;
      if (!fsSync.existsSync(src) || fsSync.existsSync(dest)) continue;
      try {
        fsSync.mkdirSync(newUserData, { recursive: true });
        fsSync.copyFileSync(src, dest);
        console.log('📁 Migrated legacy kiosk session:', src, '→', dest);
        return;
      } catch (error) {
        console.warn('⚠️ Could not migrate legacy session:', error.message);
      }
    }
  }
}

async function runKioskDiskMaintenance() {
  migrateLegacyKioskSessionFiles();
  cleanupLegacyMusicCacheDirs();

  try {
    const fileCache = require('./fileCache.cjs');
    const orphan = await fileCache.pruneOrphanMp3Files();
    const trimmed = await fileCache.enforceMaxTrackCount(50);

    // Keep existing cached MP3s — only prune orphans and enforce caps (do not wipe on boot).
    if (isKioskStreamOnlyMode()) {
      await fileCache.clearCache();
      console.log('🧹 Stream-only kiosk: cleared on-disk music cache');
    } else {
      console.log('🎵 Offline pack mode: preserving cached tracks (cap 50 files / 100MB)');
    }

    console.log('🧹 Kiosk disk maintenance complete:', { orphan, trimmed });
  } catch (error) {
    console.warn('⚠️ Kiosk disk maintenance failed:', error.message);
  }
}

function httpJsonRequest(requestUrl, options = {}, body = null, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(requestUrl);
    const transport = urlObj.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const req = transport.request(
      urlObj,
      {
        method: options.method || 'GET',
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(options.headers || {})
        },
        timeout: timeoutMs
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = data;
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function refreshSavedKioskSession(sessionData) {
  if (!sessionData?.refresh_token) {
    return sessionData || null;
  }

  try {
    const refreshed = await httpJsonRequest(
      `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        }
      },
      { refresh_token: sessionData.refresh_token }
    );

    if (!refreshed?.access_token || !refreshed?.refresh_token) {
      return sessionData;
    }

    const expiresAt =
      refreshed.expires_at ||
      (refreshed.expires_in ? Math.floor(Date.now() / 1000) + Number(refreshed.expires_in) : sessionData.expires_at);
    const nextSession = {
      ...sessionData,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: expiresAt,
      user: refreshed.user || sessionData.user
    };

    require('./sessionManager.cjs').saveSession(nextSession);
    console.log('✅ Saved kiosk session refreshed by Electron main process');
    return nextSession;
  } catch (error) {
    console.warn('⚠️ Electron session refresh failed; using saved/pinned session fallback:', error.message);
    return sessionData;
  }
}

/**
 * Save playback + Supabase session to disk, then relaunch (music kiosk mini PCs).
 */
function relaunchMusicKioskApp(reason) {
  const tag = reason || 'App restart';
  console.log(`🔄 ${tag} — flushing session/state, then relaunching...`);
  const exitSoon = () => {
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 500);
  };

  if (!mainWindow || mainWindow.isDestroyed()) {
    exitSoon();
    return;
  }

  mainWindow.webContents
    .executeJavaScript(
      `
      (async function() {
        try {
          const service = window.globalMusicService;
          if (service && service.currentTrack) {
            localStorage.setItem('_reload_resume_track', JSON.stringify({
              trackId: service.currentTrack.id,
              currentTime: service.audio?.currentTime || 0,
              wasPlaying: service.isPlaying || false
            }));
          }
          const supabaseClient = window.__supabaseClient || window.supabase;
          if (window.electronAPI?.saveSession) {
            const { data: { session } } = supabaseClient
              ? await supabaseClient.auth.getSession()
              : { data: { session: null } };
            const bid =
              localStorage.getItem('tavariPinnedBusinessId') ||
              localStorage.getItem('selectedBusinessId') ||
              localStorage.getItem('currentBusinessId');
            if (session || bid) {
              await window.electronAPI.saveSession({
                access_token: session?.access_token,
                refresh_token: session?.refresh_token,
                expires_at: session?.expires_at,
                user: session?.user,
                business_id: bid,
                pinned_business_id: bid
              });
              console.log('💾 Kiosk session/business saved to disk before restart');
            }
          }
        } catch (e) {
          console.warn('Pre-restart flush:', e);
        }
      })();
    `
    )
    .then(() => exitSoon())
    .catch((err) => {
      console.warn('⚠️ Pre-restart flush failed:', err);
      exitSoon();
    });
}

function persistRendererKioskSession(reason = 'periodic') {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve(false);
  }

  return mainWindow.webContents
    .executeJavaScript(
      `
      (async function() {
        try {
          const supabaseClient = window.__supabaseClient || window.supabase;
          const bid =
            localStorage.getItem('tavariPinnedBusinessId') ||
            localStorage.getItem('selectedBusinessId') ||
            localStorage.getItem('currentBusinessId');
          const { data: { session } } = supabaseClient
            ? await supabaseClient.auth.getSession()
            : { data: { session: null } };

          if (!window.electronAPI?.saveSession || (!session && !bid)) {
            return false;
          }

          await window.electronAPI.saveSession({
            access_token: session?.access_token,
            refresh_token: session?.refresh_token,
            expires_at: session?.expires_at,
            user: session?.user,
            business_id: bid,
            pinned_business_id: bid
          });
          console.log('💾 Kiosk session/business persisted (${reason})');
          return true;
        } catch (e) {
          console.warn('Kiosk session persist failed (${reason}):', e);
          return false;
        }
      })();
    `
    )
    .catch((error) => {
      console.warn(`⚠️ Could not persist kiosk session (${reason}):`, error.message);
      return false;
    });
}

function restoreRendererKioskSession(reason = 'startup') {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve(false);
  }

  const sessionManager = require('./sessionManager.cjs');
  const savedSession = sessionManager.loadSession();
  if (!savedSession) {
    console.log(`ℹ️ No saved kiosk session to restore (${reason})`);
    return Promise.resolve(false);
  }

  const businessId = savedSession.pinned_business_id || savedSession.business_id || null;
  return mainWindow.webContents
    .executeJavaScript(
      `
      (async function() {
        try {
          const savedBusinessId = ${JSON.stringify(businessId)};
          const existingBusinessId =
            localStorage.getItem('tavariPinnedBusinessId') ||
            localStorage.getItem('selectedBusinessId') ||
            localStorage.getItem('currentBusinessId');
          const businessId = existingBusinessId || savedBusinessId;
          const accessToken = ${JSON.stringify(savedSession.access_token || '')};
          const refreshToken = ${JSON.stringify(savedSession.refresh_token || '')};
          const expiresAt = ${savedSession.expires_at || null};
          const user = ${JSON.stringify(savedSession.user || null)};

          if (businessId) {
            localStorage.setItem('tavariPinnedBusinessId', businessId);
            localStorage.setItem('selectedBusinessId', businessId);
            localStorage.setItem('currentBusinessId', businessId);
          }

          if (!window.location.hash.includes('/kiosk/music')) {
            window.location.hash = '#/kiosk/music';
          }

          console.log('✅ Kiosk session/business restored (${reason})');
          return true;
        } catch (e) {
          console.warn('Kiosk restore failed (${reason}):', e);
          return false;
        }
      })();
    `
    )
    .catch((error) => {
      console.warn(`⚠️ Could not restore kiosk session (${reason}):`, error.message);
      return false;
    });
}
let httpServer = null;
let serverPort = null;

function normalizeInstallationConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') {
    return null;
  }

  const accessToken = rawConfig.accessToken || rawConfig.access_token;
  const refreshToken = rawConfig.refreshToken || rawConfig.refresh_token;
  const expiresAt = rawConfig.expiresAt || rawConfig.expires_at;
  const userId = rawConfig.userId || rawConfig.user_id || rawConfig.user?.id;
  const businessId =
    rawConfig.business_id ||
    rawConfig.businessId ||
    rawConfig.pinned_business_id ||
    rawConfig.pinnedBusinessId ||
    null;

  if (!accessToken || !refreshToken || !userId) {
    return null;
  }

  return {
    accessToken,
    refreshToken,
    expiresAt,
    userId,
    businessId,
    source: rawConfig.source || 'installation_config',
    generatedAt: rawConfig.generatedAt || rawConfig.savedAt || new Date().toISOString()
  };
}

function findInstallationConfigPath() {
  const directCandidates = [
    path.join(__dirname, '../tavari-installation-config.json'),
    path.join(path.dirname(app.getPath('exe')), 'tavari-installation-config.json'),
    path.join(app.getPath('downloads'), 'tavari-installation-config.json'),
    path.join(app.getPath('desktop'), 'tavari-installation-config.json')
  ];

  const matchedPaths = [];

  directCandidates.forEach((candidatePath) => {
    if (fs.existsSync(candidatePath)) {
      matchedPaths.push(candidatePath);
    }
  });

  const downloadableDirs = [app.getPath('downloads'), app.getPath('desktop')];
  const configPattern = /^tavari-installation-config(?: \(\d+\))?\.json$/i;

  downloadableDirs.forEach((dirPath) => {
    try {
      if (!fs.existsSync(dirPath)) return;

      const files = fs.readdirSync(dirPath)
        .filter((fileName) => configPattern.test(fileName))
        .map((fileName) => path.join(dirPath, fileName));

      matchedPaths.push(...files);
    } catch (error) {
      console.warn('⚠️ Could not scan config directory:', dirPath, error.message);
    }
  });

  const uniquePaths = [...new Set(matchedPaths)].filter((candidatePath) => fs.existsSync(candidatePath));

  if (uniquePaths.length === 0) {
    return null;
  }

  uniquePaths.sort((leftPath, rightPath) => {
    const leftTime = fs.statSync(leftPath).mtimeMs;
    const rightTime = fs.statSync(rightPath).mtimeMs;
    return rightTime - leftTime;
  });

  return uniquePaths[0];
}

function importInstallationConfig(configPath) {
  const configData = fs.readFileSync(configPath, 'utf8');
  const normalizedConfig = normalizeInstallationConfig(JSON.parse(configData));

  if (!normalizedConfig) {
    throw new Error('Installation config is missing required fields');
  }

  const sessionManager = require('./sessionManager.cjs');
  sessionManager.saveSession({
    access_token: normalizedConfig.accessToken,
    refresh_token: normalizedConfig.refreshToken,
    expires_at: normalizedConfig.expiresAt,
    user: { id: normalizedConfig.userId },
    business_id: normalizedConfig.businessId,
    pinned_business_id: normalizedConfig.businessId
  });

  try {
    fs.unlinkSync(configPath);
    console.log('✅ Installation config imported and deleted:', configPath);
  } catch (error) {
    console.warn('⚠️ Installation config imported but could not be deleted:', configPath, error.message);
  }

  return normalizedConfig;
}

function loadInstallationConfigIfAvailable() {
  const configPath = findInstallationConfigPath();

  if (!configPath) {
    return null;
  }

  console.log('📦 Found installation config file:', configPath);
  return importInstallationConfig(configPath);
}

// Kiosk mode flag - set via environment variable or config
// This is the dedicated music kiosk app, so default to kiosk mode
const isKioskMode = process.env.KIOSK_MODE !== 'false' && (process.env.KIOSK_MODE === 'true' || process.argv.includes('--kiosk') || true);
const kioskFullscreen = process.env.KIOSK_FULLSCREEN === 'true' || process.argv.includes('--fullscreen');

// 🔥 CRITICAL: Block AdSense at Electron level - prevents it from loading even from production website
app.whenReady().then(() => {
  const filter = {
    urls: ['*://*/*']
  };
  
  session.defaultSession.webRequest.onBeforeRequest(filter, (details, callback) => {
    // Block ALL AdSense/Google ad requests
    if (details.url.includes('googlesyndication.com') || 
        details.url.includes('adsbygoogle') ||
        details.url.includes('doubleclick.net') ||
        details.url.includes('googleadservices.com')) {
      console.log('🛑 BLOCKED AdSense request:', details.url);
      callback({ cancel: true });
      return;
    }
    callback({});
  });
  
  console.log('🛑 AdSense blocker active at Electron level');
});

// Security: Prevent new-window
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
  });
});

function createWindow() {
  // For kiosk mode, use fullscreen or minimal window
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  const windowOptions = {
    width: isKioskMode ? (kioskFullscreen ? width : 800) : 1200,
    height: isKioskMode ? (kioskFullscreen ? height : 600) : 800,
    minWidth: isKioskMode ? 0 : 800,
    minHeight: isKioskMode ? 0 : 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      webSecurity: false, // Required for ES modules with file://
      autoplay: true,
      allowRunningInsecureContent: true,
      // Disable cache to always get latest version from production
      cache: false
    },
    icon: path.join(__dirname, 'assets/icon.ico'),
    show: true, // Show window immediately
    // Kiosk mode settings
    kiosk: kioskFullscreen || false,
    fullscreen: kioskFullscreen || false,
    frame: !isKioskMode, // Hide frame in kiosk mode
    autoHideMenuBar: isKioskMode
  };
  
  mainWindow = new BrowserWindow(windowOptions);
  
  // Set up kiosk mode behaviors
  if (isKioskMode) {
    // Prevent window from being closed
    mainWindow.on('close', (event) => {
      event.preventDefault();
      mainWindow.hide();
    });
    
    // Allow right-click menu in development mode (for debugging)
    // In production, disable right-click
    if (!isDev) {
      mainWindow.webContents.on('context-menu', (event) => {
        event.preventDefault();
      });
    }
    
    // Keep window always on top in kiosk mode
    mainWindow.setAlwaysOnTop(true);
    
    // Prevent navigation away from the music kiosk page
    // This is a dedicated music app - stay on music kiosk only
    mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
      // ALWAYS prevent navigation to root or any route that's not the music kiosk
      const isDevUrl = navigationUrl.includes('localhost');
      const isMusicKioskRoute = navigationUrl.includes('/kiosk/music') || navigationUrl.includes('#/kiosk/music');
      
      if (!isMusicKioskRoute || navigationUrl.endsWith('/') || navigationUrl.match(/\/$/) || navigationUrl === navigationUrl.split('#')[0]) {
        event.preventDefault();
        console.log('🚫 BLOCKED navigation to:', navigationUrl);
        // Force redirect back to music kiosk with hash routing
        const productionUrl = process.env.VITE_PRODUCTION_URL || process.env.PRODUCTION_URL || 'https://www.tavarios.ca';
        const correctUrl = isDevUrl 
          ? `http://localhost:${process.env.VITE_PORT || '5173'}/#/kiosk/music`
          : `${productionUrl}/#/kiosk/music`;
        mainWindow.loadURL(correctUrl);
      }
    });
  }

  // Load app - Use production web URL instead of bundling everything
  // This is a MUSIC KIOSK app - always load the music kiosk screen
  if (isDev) {
    const vitePort = process.env.VITE_PORT || '5173';
    // Always load music kiosk - this is a dedicated music player app
    // Use hash routing for Electron compatibility
    // Route is /kiosk/music (public route, no auth required)
    const startUrl = `http://localhost:${vitePort}/#/kiosk/music`;
    mainWindow.loadURL(startUrl);
    // Don't auto-open dev tools in kiosk mode
  } else {
    // PRODUCTION: Load from web URL instead of bundling
    // This makes the app much smaller (50-100 MB vs 1.8 GB)
    // And always gets the latest version automatically
    
    // Get production URL from environment or use default
    const productionUrl = process.env.VITE_PRODUCTION_URL || 
                         process.env.PRODUCTION_URL || 
                         'https://www.tavarios.ca';
    
    // ALWAYS load music kiosk - this is a dedicated music player app
    // Not the full Tavari OS, just the music kiosk
    // Use hash routing for Electron compatibility
    // Route is /kiosk/music (public route, no auth required)
    const startUrl = `${productionUrl}/#/kiosk/music`;
    
    console.log('═══════════════════════════════════════');
    console.log('🎵 Tavari Music Kiosk - Loading');
    console.log('═══════════════════════════════════════');
    console.log('📍 URL:', startUrl);
    console.log('🎯 Dedicated Music Player App');
    console.log('💡 App size reduced: ~50-100 MB (vs 1.8 GB bundled)');
    console.log('✅ Always gets latest version automatically');
    console.log('═══════════════════════════════════════');
    
    // Load from production URL
    // CRITICAL: Set hash in URL itself to ensure React Router matches correctly
    // HashRouter parses the hash from the URL, so it must be in the URL when loaded
    
    // Keep runtime storage stable. The kiosk depends on local cache for tracks,
    // schedules, pinned business ID, and playback resume after transient failures.
    console.log('🧹 Clearing browser HTTP cache before first load...');
    const cacheBuster = `?v=${Date.now()}`;
    const urlWithCacheBust = startUrl.includes('?')
      ? `${startUrl}&v=${Date.now()}`
      : `${startUrl}${cacheBuster}`;

    const sessionManager = require('./sessionManager.cjs');
    const savedSessionBeforeLoad = sessionManager.loadSession();
    Promise.all([
      mainWindow.webContents.session.clearCache(),
      refreshSavedKioskSession(savedSessionBeforeLoad)
    ])
      .then(() => {
        console.log('✅ Browser HTTP cache cleared and kiosk session prepared before load');
        return mainWindow.loadURL(urlWithCacheBust);
      })
      .then(() => {
      console.log('✅ Window loaded from production URL');

        // CRITICAL: Force hash route immediately after page load
        // This ensures React Router recognizes the kiosk route before any redirects happen
        mainWindow.webContents.executeJavaScript(`
          (function() {
            if (window.location.hash !== '#/kiosk/music') {
              console.log('🔧 [Electron] Fixing hash route to #/kiosk/music');
              window.location.hash = '#/kiosk/music';
            }
          })();
        `).catch(err => console.warn('⚠️ Error setting hash route:', err));
        
        console.log('✅ Page loaded, setting up auto-login...');
        
        // Try to restore session from saved file FIRST (before React loads)
        const savedSession = sessionManager.loadSession();
        
        // CRITICAL: Set business ID and session to localStorage IMMEDIATELY if available
        // This ensures React app can find it on first render
        // Use synchronous executeJavaScript to ensure it happens before React renders
        if (savedSession) {
          try {
            mainWindow.webContents.executeJavaScript(`
              (function() {
                const savedBusinessId = ${JSON.stringify(savedSession.pinned_business_id || savedSession.business_id || null)};
                const existingBusinessId =
                  localStorage.getItem('tavariPinnedBusinessId') ||
                  localStorage.getItem('selectedBusinessId') ||
                  localStorage.getItem('currentBusinessId');
                const businessId = existingBusinessId || savedBusinessId;

                // Set business ID immediately (synchronous)
                ${(savedSession.pinned_business_id || savedSession.business_id) ? `
                  localStorage.setItem('tavariPinnedBusinessId', businessId);
                  localStorage.setItem('selectedBusinessId', businessId);
                  localStorage.setItem('currentBusinessId', businessId);
                  console.log('✅ Business ID set immediately from saved session:', businessId);
                ` : 'console.log("⚠️ No business ID in saved session");'}
              })();
            `, true); // true = synchronous execution
          } catch (err) {
            console.error('❌ Failed to set business ID/session to localStorage:', err);
          }
        }
        
        // CRITICAL: Check for pending config from download page (localStorage)
        // This allows the app to be pre-configured with business ID during download
        mainWindow.webContents.executeJavaScript(`
          (async function() {
            const pendingConfig = localStorage.getItem('tavari_electron_pending_config');
            if (pendingConfig) {
              try {
                const config = JSON.parse(pendingConfig);
                console.log('✅ Found pending config from download - saving to Electron');
                
                // Save to Electron session file
                if (window.electronAPI?.saveSession) {
                  await window.electronAPI.saveSession({
                    access_token: config.access_token,
                    refresh_token: config.refresh_token,
                    expires_at: config.expires_at,
                    user: config.user,
                    business_id: config.business_id,
                    pinned_business_id: config.business_id
                  });
                  
                  // Also save business ID to localStorage for immediate use
                  if (config.business_id) {
                    localStorage.setItem('tavariPinnedBusinessId', config.business_id);
                    localStorage.setItem('selectedBusinessId', config.business_id);
                    localStorage.setItem('currentBusinessId', config.business_id);
                    console.log('✅ Business ID saved:', config.business_id);
                  }
                  
                  // Clear pending config
                  localStorage.removeItem('tavari_electron_pending_config');
                  console.log('✅ Pending config processed and cleared');
                }
              } catch (e) {
                console.error('❌ Failed to process pending config:', e);
              }
            }
          })();
        `);
        
        if (savedSession?.refresh_token) {
          console.log('🔐 Refreshing kiosk session (refresh_token only, no stale access_token)...');
          mainWindow.webContents.executeJavaScript(`
            (async function() {
              try {
                let retries = 0;
                while (!(window.__supabaseClient || window.supabase) && retries < 15) {
                  await new Promise(resolve => setTimeout(resolve, 200));
                  retries++;
                }
                const supabaseClient = window.__supabaseClient || window.supabase;
                if (!supabaseClient) return;

                const refreshToken = ${JSON.stringify(savedSession.refresh_token || '')};
                if (!refreshToken) return;

                const { data, error } = await supabaseClient.auth.refreshSession({
                  refresh_token: refreshToken
                });

                if (error || !data?.session) {
                  console.warn('⚠️ Kiosk refresh failed:', error?.message || 'no session');
                  return;
                }

                console.log('✅ Kiosk session refreshed (valid JWT for track library)');

                const businessId =
                  localStorage.getItem('tavariPinnedBusinessId') ||
                  localStorage.getItem('selectedBusinessId') ||
                  localStorage.getItem('currentBusinessId');

                if (window.electronAPI?.saveSession) {
                  await window.electronAPI.saveSession({
                    access_token: data.session.access_token,
                    refresh_token: data.session.refresh_token,
                    expires_at: data.session.expires_at,
                    user: data.session.user,
                    business_id: businessId,
                    pinned_business_id: businessId
                  });
                }

                window.dispatchEvent(new CustomEvent('tavari-kiosk-auth-ready'));
              } catch (err) {
                console.error('❌ Kiosk refresh error:', err);
              }
            })();
          `);
        } else {
          // No saved session - Supabase will check localStorage automatically
          console.log('📝 No saved session file - checking localStorage...');
          mainWindow.webContents.executeJavaScript(`
            (async function() {
              // Wait for Supabase to initialize
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // Check if session exists in localStorage (Supabase persistence)
              const supabaseClient = window.__supabaseClient || window.supabase;
              const { data: { session } } = await supabaseClient?.auth?.getSession() || { data: { session: null } };
              
              if (session) {
                console.log('✅ Session found in localStorage');
                if (!window.location.hash.includes('/kiosk/music')) {
                  window.location.hash = '#/kiosk/music';
                }
              } else {
                console.log('⚠️ No session found');
                if (!window.location.hash.includes('/login')) {
                  window.location.hash = '#/kiosk/music';
                }
              }
            })();
          `);
        }

        setTimeout(() => restoreRendererKioskSession('startup-5s'), 5000);
        setTimeout(() => persistRendererKioskSession('post-startup'), 30000);
        setInterval(() => persistRendererKioskSession('periodic'), 5 * 60 * 1000);
      })
      .catch((err) => {
        console.error('❌ Failed to clear cache or load URL:', err);
        mainWindow.loadURL(`${productionUrl}/#/kiosk/music`).catch(() => {});
      });
  }
  
  // Runtime reloads are intentionally disabled for the unattended music kiosk.
  // The old HEAD check used volatile headers (Date/fallback timestamps) and could
  // reload the app every few minutes, dropping playback and emptying in-memory tracks.
  // Updates are picked up by the controlled daily 3:00 AM app restart below.
  console.log('✅ Runtime code-update reload disabled; updates apply at daily 3:00 AM restart');
  
  // Daily restart at 3:00 AM local time. Single timer to next 3:00 AM; after relaunch this runs again.
  const scheduleDailyRestart = () => {
    const now = new Date();
    const target = new Date(now);
    target.setHours(3, 0, 0, 0);
    if (now >= target) {
      target.setDate(target.getDate() + 1);
    }
    const msUntilRestart = target.getTime() - now.getTime();
    console.log(
      `⏰ Daily restart scheduled for ${target.toLocaleString()} (in ${Math.round(msUntilRestart / 1000 / 60)} minutes)`
    );
    setTimeout(() => {
      relaunchMusicKioskApp('Daily restart at 3:00 AM');
    }, msUntilRestart);
  };
  scheduleDailyRestart();
  
  // Log all console messages from renderer - ENHANCED LOGGING
  // These will appear in both the Electron main process console AND the DevTools console
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : '📝';
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `${prefix} [${timestamp}] [Renderer ${level}]: ${message}`;
    
    // Log to Electron main process console (visible in terminal/command prompt)
    console.log(logMessage);
    if (sourceId && line) {
      console.log(`   📍 Source: ${sourceId}:${line}`);
    }
  });
  
  // Inject kiosk mode flag and log page status
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('═══════════════════════════════════════');
    console.log('✅ Page finished loading');
    console.log('📍 Current URL:', mainWindow.webContents.getURL());
    console.log('═══════════════════════════════════════');
    
    mainWindow.webContents.executeJavaScript(`
      // Set Electron flags BEFORE React loads - CRITICAL
      window.__TAVARI_KIOSK_MODE__ = true;
      window.__TAVARI_ELECTRON__ = true;
      window.__TAVARI_ENABLE_AUTOPLAY__ = true;
      window.__TAVARI_KIOSK_STREAM_ONLY__ = false;
      
      // FORCE hash routing - redirect immediately if not on music kiosk
      if (!window.location.hash || !window.location.hash.includes('/kiosk/music')) {
        console.log('🔴 FORCING redirect to music kiosk...');
        window.location.hash = '#/kiosk/music';
      }
      
      console.log('═══════════════════════════════════════');
      console.log('🎵 Tavari Music Desktop - Renderer Process');
      console.log('═══════════════════════════════════════');
      console.log('📍 URL:', window.location.href);
      console.log('📍 Hash:', window.location.hash);
      console.log('🔍 Root element:', document.getElementById('root'));
      console.log('📄 Document ready:', document.readyState);
      console.log('═══════════════════════════════════════');
      
      // Monitor hash changes and force back to kiosk if user navigates away
      let lastHash = window.location.hash;
      const hashCheck = setInterval(() => {
        const currentHash = window.location.hash;
        if (currentHash !== lastHash) {
          lastHash = currentHash;
          if (!currentHash.includes('/kiosk/music') && currentHash !== '#/login') {
            console.log('🔴 User navigated away from kiosk - forcing back...');
            window.location.hash = '#/kiosk/music';
          }
        }
      }, 500);
      
      // Auto-login: Supabase automatically restores session from localStorage
      (async function() {
        try {
          // Wait for Supabase to initialize
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const supabaseClient = window.__supabaseClient || window.supabase;
          if (supabaseClient) {
            const { data: { session } } = await supabaseClient.auth.getSession();
            
            if (session) {
              console.log('✅ Session found - user is logged in');
              // Force to kiosk
              if (!window.location.hash.includes('/kiosk/music')) {
                window.location.hash = '#/kiosk/music';
              }
            } else {
              const pinned =
                localStorage.getItem('tavariPinnedBusinessId') ||
                localStorage.getItem('selectedBusinessId') ||
                localStorage.getItem('currentBusinessId');
              if (pinned) {
                console.log('✅ Music kiosk running without auth (pinned business):', pinned);
              } else {
                console.log('⚠️ No session or pinned business — login may be required');
              }
            }
          }
        } catch (err) {
          console.error('Session check error:', err);
        }
      })();
      
      // Check for React root
      setTimeout(() => {
        const root = document.getElementById('root');
        if (root && root.innerHTML.trim()) {
          console.log('✅ React app appears to be loaded');
        } else {
          console.error('❌ Root element is empty - React may not have loaded!');
        }
      }, 2000);
    `).catch(err => {
      console.error('❌ Failed to execute JavaScript:', err.message);
    });
  });
  
  // Log failed loads
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('═══════════════════════════════════════');
    console.error('❌ PAGE FAILED TO LOAD');
    console.error('═══════════════════════════════════════');
    console.error('📍 URL:', validatedURL);
    console.error('🔢 Error Code:', errorCode);
    console.error('📝 Description:', errorDescription);
    console.error('═══════════════════════════════════════');
  });

  // Force window to show and be on top
  mainWindow.once('ready-to-show', () => {
    // Move window to primary display center
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    const windowBounds = mainWindow.getBounds();
    const x = Math.floor((screenWidth - windowBounds.width) / 2);
    const y = Math.floor((screenHeight - windowBounds.height) / 2);
    mainWindow.setPosition(x, y);
    
    // Force show and bring to front
    mainWindow.show();
    mainWindow.focus();
    mainWindow.moveTop();
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.setVisibleOnAllWorkspaces(false);
    
    // Enable DevTools for debugging - always show in development, or if ENABLE_DEVTOOLS env var is set
    // For kiosk debugging, we'll enable it by default so console logs are visible
    const enableDevTools = isDev || process.env.ENABLE_DEVTOOLS === 'true' || process.argv.includes('--devtools') || true; // Always enable for now
    
    if (enableDevTools) {
      console.log('🔧 DevTools enabled - opening DevTools window');
      
      // Open DevTools in a separate window (undocked) so it's always visible
      // This is better for kiosk mode where the main window might be fullscreen
      mainWindow.webContents.openDevTools({ mode: 'undocked' });
      
      // Position DevTools window to the right side of the screen
      setTimeout(() => {
        const displays = screen.getAllDisplays();
        const primaryDisplay = displays[0];
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
        
        // Try to find the DevTools window and position it
        // Note: Electron doesn't give us direct access to DevTools window, but we can set main window position
        // The DevTools will open in undocked mode and can be positioned manually
        
        console.log('🔧 DevTools opened in undocked mode - position it as needed');
        console.log('💡 All console logs from the music kiosk will appear in DevTools');
      }, 500);
    } else {
      console.log('💡 DevTools can be opened with Ctrl+Shift+I or F12');
    }
    
    // Check for updates (optional - only if autoUpdater exists)
    if (!isDev) {
      try {
        const autoUpdater = require('./autoUpdater.cjs');
        if (autoUpdater && autoUpdater.checkForUpdates) {
          autoUpdater.checkForUpdates();
        }
      } catch (error) {
        // AutoUpdater is optional - continue without it
        console.warn('AutoUpdater not available:', error.message);
      }
    }
  });

  // Handle close (only for non-kiosk mode)
  if (!isKioskMode) {
    mainWindow.on('close', (event) => {
      if (!app.isQuiting) {
        event.preventDefault();
        mainWindow.hide();
      }
    });
  }
  
  // Clean up HTTP server when window is actually closed
  mainWindow.on('closed', () => {
    if (httpServer) {
      httpServer.close(() => {
        console.log('✅ HTTP Server closed');
      });
      httpServer = null;
    }
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Register keyboard shortcuts to toggle DevTools (for debugging)
  // These work even in kiosk mode
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0 && windows[0]) {
      const mainWin = windows[0];
      mainWin.webContents.toggleDevTools();
      console.log('🔧 DevTools toggled via Ctrl+Shift+I');
    }
  });
  
  globalShortcut.register('F12', () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0 && windows[0]) {
      const mainWin = windows[0];
      mainWin.webContents.toggleDevTools();
      console.log('🔧 DevTools toggled via F12');
    }
  });
  
  console.log('✅ DevTools shortcuts registered:');
  console.log('   - Ctrl+Shift+I or F12: Toggle DevTools');
  console.log('   - DevTools opens automatically to show console logs');
  
  // Check for installation config file before creating window.
  // Accept it from the app folder or the user's Downloads/Desktop folder.
  try {
    loadInstallationConfigIfAvailable();
  } catch (error) {
    console.warn('⚠️ Could not load installation config:', error.message);
  }

  runKioskDiskMaintenance()
    .catch((error) => console.warn('⚠️ Disk maintenance error:', error.message))
    .finally(() => createWindow());
  
  // Auto-start setup - app will launch on Windows boot (for headless mini PC)
  app.setLoginItemSettings({
    openAtLogin: true,
    name: 'Tavari Music Desktop',
    path: app.getPath('exe')
  });
  
  console.log('✅ Auto-start configured - app will launch on boot');
});

// Cleanup intervals on app quit
app.on('before-quit', () => {
  // Unregister all global shortcuts
  globalShortcut.unregisterAll();
  
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
  }
});

app.on('window-all-closed', () => {
  // Close HTTP server when app closes
  if (httpServer) {
    httpServer.close(() => {
      console.log('✅ HTTP Server closed');
    });
    httpServer = null;
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handlers for desktop features
// Cache fingerprint so it's consistent across calls
let cachedFingerprint = null;

ipcMain.handle('get-system-info', async () => {
  // Get device fingerprint for installation registration (cached for consistency)
  let fingerprint = cachedFingerprint;
  
  if (!fingerprint) {
    try {
      console.log('🔍 [get-system-info] Loading installationManager...');
      const installationManager = require('./installationManager.cjs');
      console.log('✅ [get-system-info] installationManager loaded, generating fingerprint...');
      fingerprint = installationManager.generateDeviceFingerprint();
      cachedFingerprint = fingerprint; // Cache it
      console.log('✅ [get-system-info] Fingerprint generated and cached:', fingerprint ? fingerprint.substring(0, 16) + '...' : 'null');
    } catch (error) {
      console.error('❌ [get-system-info] Error generating device fingerprint:', error);
      console.error('❌ [get-system-info] Error stack:', error.stack);
      // Try fallback fingerprint generation
      try {
        const crypto = require('crypto');
        const os = require('os');
        // Use stable values for fallback (no timestamp!)
        const fallbackData = `${os.hostname()}-${os.platform()}-${os.arch()}`;
        fingerprint = crypto.createHash('sha256').update(fallbackData).digest('hex');
        cachedFingerprint = fingerprint; // Cache it
        console.log('⚠️ [get-system-info] Using fallback fingerprint:', fingerprint.substring(0, 16) + '...');
      } catch (fallbackError) {
        console.error('❌ [get-system-info] Fallback fingerprint generation also failed:', fallbackError);
      }
    }
  } else {
    console.log('♻️ [get-system-info] Using cached fingerprint:', fingerprint.substring(0, 16) + '...');
  }
  
  const systemInfo = {
    platform: process.platform,
    version: process.getSystemVersion(),
    arch: process.arch,
    appVersion: app.getVersion(),
    fingerprint: fingerprint
  };
  
  console.log('📡 [get-system-info] Returning system info with fingerprint:', fingerprint ? 'present' : 'missing');
  return systemInfo;
});

// Session management for auto-login
ipcMain.handle('save-session', async (event, sessionData) => {
  try {
    const sessionManager = require('./sessionManager.cjs');
    return sessionManager.saveSession(sessionData);
  } catch (error) {
    console.error('Failed to save session:', error);
    return false;
  }
});

ipcMain.handle('load-session', async () => {
  try {
    const sessionManager = require('./sessionManager.cjs');
    return sessionManager.loadSession();
  } catch (error) {
    console.error('Failed to load session:', error);
    return null;
  }
});

// Check for installation config file in app directory or Downloads/Desktop
ipcMain.handle('check-installation-config', async () => {
  try {
    return loadInstallationConfigIfAvailable();
  } catch (error) {
    console.error('Failed to check installation config:', error);
    return null;
  }
});

ipcMain.handle('check-for-updates', async () => {
  try {
    const autoUpdater = require('./autoUpdater.cjs');
    return autoUpdater ? autoUpdater.checkForUpdates() : { error: 'AutoUpdater not available' };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('restart-app', () => {
  console.log('🔄 Manual restart requested from UI');
  relaunchMusicKioskApp('Manual restart from kiosk UI');
});

// File cache operations for offline music playback
ipcMain.handle('cache:save-track', async (event, trackId, fileData, metadata) => {
  try {
    // Hard stop: even stale web bundles cannot mirror MP3s when stream-only is active.
    if (isKioskStreamOnlyMode()) {
      return {
        success: false,
        data: null,
        skipped: true,
        error: 'Stream-only kiosk: MP3 caching disabled (unset TAVARI_KIOSK_OFFLINE_CACHE=0 to enable)'
      };
    }
    if (!trackId || typeof trackId !== 'string') {
      return { success: false, data: null, error: 'Invalid trackId' };
    }
    if (!fileData) {
      return { success: false, data: null, error: 'No file data provided' };
    }
    const fileCache = require('./fileCache.cjs');
    if (!fileCache || !fileCache.saveTrackToCache) {
      return { success: false, data: null, error: 'Cache module not available' };
    }
    // Convert base64 or ArrayBuffer to Buffer if needed
    let bufferData = fileData;
    if (typeof fileData === 'string') {
      // Assume base64
      bufferData = Buffer.from(fileData, 'base64');
    } else if (fileData instanceof ArrayBuffer) {
      bufferData = Buffer.from(fileData);
    } else if (!Buffer.isBuffer(fileData) && !(fileData instanceof Uint8Array)) {
      return { success: false, data: null, error: 'Invalid file data format' };
    }
    const result = await fileCache.saveTrackToCache(trackId, bufferData, metadata);
    // Ensure result has success property
    if (result && typeof result === 'object' && 'success' in result) {
      return result;
    }
    // If fileCache returns different format, wrap it
    return { success: true, data: result };
  } catch (error) {
    console.error('Error in cache:save-track:', error);
    return { success: false, data: null, error: error.message || 'Unknown error' };
  }
});

ipcMain.handle('cache:get-track', async (event, trackId) => {
  try {
    if (!trackId || typeof trackId !== 'string') {
      return { success: false, data: null, error: 'Invalid trackId' };
    }
    const fileCache = require('./fileCache.cjs');
    if (!fileCache || !fileCache.getCachedTrack) {
      return { success: false, data: null, error: 'Cache module not available' };
    }
    const filePath = await fileCache.getCachedTrack(trackId);
    // Return in format expected by ElectronCacheService
    if (filePath) {
      return { success: true, data: filePath };
    }
    return { success: false, data: null };
  } catch (error) {
    console.error('Error in cache:get-track:', error);
    return { success: false, data: null, error: error.message || 'Unknown error' };
  }
});

ipcMain.handle('cache:delete-track', async (event, trackId) => {
  try {
    if (!trackId || typeof trackId !== 'string') {
      return { success: false, data: null, error: 'Invalid trackId' };
    }
    const fileCache = require('./fileCache.cjs');
    if (!fileCache || !fileCache.deleteCachedTrack) {
      return { success: false, data: null, error: 'Cache module not available' };
    }
    const result = await fileCache.deleteCachedTrack(trackId);
    // Ensure result has success property
    if (result && typeof result === 'object' && 'success' in result) {
      return result;
    }
    return { success: true, data: result };
  } catch (error) {
    console.error('Error in cache:delete-track:', error);
    return { success: false, data: null, error: error.message || 'Unknown error' };
  }
});

ipcMain.handle('cache:get-stats', async () => {
  try {
    const fileCache = require('./fileCache.cjs');
    if (!fileCache || !fileCache.getCacheStats) {
      return {
        success: false,
        data: {
          totalFiles: 0,
          totalSizeBytes: 0,
          totalSizeMB: 0,
          oldestEntry: null,
          newestEntry: null,
          averageFileSize: 0,
          version: '1.0',
          lastSync: null
        },
        error: 'Cache module not available'
      };
    }
    const stats = await fileCache.getCacheStats();
    // Return in format expected by ElectronCacheService
    if (stats && typeof stats === 'object') {
      return { success: true, data: stats };
    }
    return {
      success: false,
      data: {
        totalFiles: 0,
        totalSizeBytes: 0,
        totalSizeMB: 0,
        oldestEntry: null,
        newestEntry: null,
        averageFileSize: 0,
        version: '1.0',
        lastSync: null
      },
      error: 'Invalid stats format'
    };
  } catch (error) {
    console.error('Error in cache:get-stats:', error);
    return {
      success: false,
      data: {
        totalFiles: 0,
        totalSizeBytes: 0,
        totalSizeMB: 0,
        oldestEntry: null,
        newestEntry: null,
        averageFileSize: 0,
        version: '1.0',
        lastSync: null
      },
      error: error.message || 'Unknown error'
    };
  }
});

ipcMain.handle('cache:clear', async () => {
  try {
    const fileCache = require('./fileCache.cjs');
    if (!fileCache || !fileCache.clearCache) {
      return { success: false, data: null, error: 'Cache module not available' };
    }
    const result = await fileCache.clearCache();
    // Ensure result has success property
    if (result && typeof result === 'object' && 'success' in result) {
      return result;
    }
    return { success: true, data: result };
  } catch (error) {
    console.error('Error in cache:clear:', error);
    return { success: false, data: null, error: error.message || 'Unknown error' };
  }
});

ipcMain.handle('cache:evict-lru-bytes', async (event, minBytesToFree) => {
  try {
    const fileCache = require('./fileCache.cjs');
    if (!fileCache || !fileCache.evictLeastRecentlyUsedBytes) {
      return { success: false, data: null, error: 'Cache module not available' };
    }
    const n = typeof minBytesToFree === 'number' && minBytesToFree > 0 ? minBytesToFree : 0;
    if (!n) {
      return { success: true, data: { freedBytes: 0, deletedCount: 0 } };
    }
    const result = await fileCache.evictLeastRecentlyUsedBytes(n);
    return { success: true, data: result };
  } catch (error) {
    console.error('Error in cache:evict-lru-bytes:', error);
    return { success: false, data: null, error: error.message || 'Unknown error' };
  }
});