const { app, BrowserWindow, ipcMain, Menu, systemPreferences, screen, session, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require('url');
const isDev = process.env.NODE_ENV === 'development';

// 🔇 Fix for AUDIO_RENDERER_ERROR - allow autoplay without user gesture
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-media-stream');

let mainWindow;
let isLocked = false;
let httpServer = null;
let serverPort = null;
let updateCheckInterval = null;

/** Save business ID + Supabase session to disk, then relaunch (nightly kiosk refresh). */
function relaunchWaiverKioskApp(reason) {
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
          const supabaseClient = window.__supabaseClient || window.supabase;
          if (window.electronAPI?.saveSession) {
            const { data: { session } } = supabaseClient
              ? await supabaseClient.auth.getSession()
              : { data: { session: null } };
            const bid =
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
              console.log('💾 Waiver kiosk session/business saved to disk before restart');
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

function persistRendererWaiverKioskSession(reason = 'periodic') {
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
            localStorage.getItem('selectedBusinessId') ||
            localStorage.getItem('currentBusinessId');
          if (!window.electronAPI?.saveSession) return false;
          const { data: { session } } = supabaseClient
            ? await supabaseClient.auth.getSession()
            : { data: { session: null } };
          if (!session && !bid) return false;
          await window.electronAPI.saveSession({
            access_token: session?.access_token,
            refresh_token: session?.refresh_token,
            expires_at: session?.expires_at,
            user: session?.user,
            business_id: bid,
            pinned_business_id: bid
          });
          console.log('💾 Waiver kiosk session persisted (${reason})');
          return true;
        } catch (e) {
          console.warn('Session persist failed:', e);
          return false;
        }
      })();
    `
    )
    .catch((err) => {
      console.warn('⚠️ persistRendererWaiverKioskSession failed:', err);
      return false;
    });
}

// Kiosk mode flag - set via environment variable or config
// This is a dedicated waiver kiosk app, so default to kiosk mode
const isKioskMode = process.env.KIOSK_MODE !== 'false' && (process.env.KIOSK_MODE === 'true' || process.argv.includes('--kiosk') || true);
// Fullscreen + Electron kiosk by default (production .exe). Opt out for debugging: KIOSK_FULLSCREEN=false or --windowed
const kioskWindowed =
  process.env.KIOSK_FULLSCREEN === 'false' || process.argv.includes('--windowed');
const kioskFullscreen = !kioskWindowed;

/** Splash (#/kiosk/waiver) or in-app navigate to public signing (#/waiver/..., #/waiver-from-booking/...). */
function isWaiverKioskAllowedNavigationUrl(navigationUrl) {
  if (!navigationUrl || typeof navigationUrl !== 'string') return false;
  return (
    navigationUrl.includes('#/kiosk/waiver') ||
    navigationUrl.includes('/kiosk/waiver') ||
    navigationUrl.includes('#/waiver') ||
    navigationUrl.includes('#/waiver-from-booking')
  );
}

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
    
    // Prevent navigation away from waiver kiosk page
    // This is a dedicated waiver app - stay on waiver kiosk only
    mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
      // Block leaving Tavari except kiosk splash + public waiver signing routes
      const isDevUrl = navigationUrl.includes('localhost');
      const allowed = isWaiverKioskAllowedNavigationUrl(navigationUrl);
      
      if (!allowed || navigationUrl.endsWith('/') || navigationUrl.match(/\/$/) || navigationUrl === navigationUrl.split('#')[0]) {
        event.preventDefault();
        console.log('🚫 BLOCKED navigation to:', navigationUrl);
        // Force redirect back to waiver kiosk with hash routing
        const productionUrl = process.env.VITE_PRODUCTION_URL || process.env.PRODUCTION_URL || 'https://www.tavarios.ca';
        const correctUrl = isDevUrl 
          ? `http://localhost:${process.env.VITE_PORT || '5173'}/#/kiosk/waiver`
          : `${productionUrl}/#/kiosk/waiver`;
        mainWindow.loadURL(correctUrl);
      }
    });
  }

  // Load app - Use production web URL instead of bundling everything
  // This is a WAIVER KIOSK app - always load the waiver kiosk screen
  if (isDev) {
    const vitePort = process.env.VITE_PORT || '5173';
    // Always load waiver kiosk - this is a dedicated waiver signing app
    // Use hash routing for Electron compatibility
    // Route is /kiosk/waiver (public route, no auth required)
    const startUrl = `http://localhost:${vitePort}/#/kiosk/waiver`;
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
    
    // ALWAYS load waiver kiosk - this is a dedicated waiver signing app
    // Not the full Tavari OS, just the waiver kiosk
    // Use hash routing for Electron compatibility
    // Route is /kiosk/waiver (public route, no auth required)
    const startUrl = `${productionUrl}/#/kiosk/waiver`;
    
    console.log('═══════════════════════════════════════');
    console.log('📋 Tavari Waiver Kiosk - Loading');
    console.log('═══════════════════════════════════════');
    console.log('📍 URL:', startUrl);
    console.log('🎯 Dedicated Waiver Signing App');
    console.log('💡 App size reduced: ~50-100 MB (vs 1.8 GB bundled)');
    console.log('✅ Always gets latest version automatically');
    console.log('═══════════════════════════════════════');
    
    // Load from production URL
    // CRITICAL: Set hash in URL itself to ensure React Router matches correctly
    // HashRouter parses the hash from the URL, so it must be in the URL when loaded
    
    // Do not wipe localStorage on startup — nightly restart restores from tavari-session.json
    // and clearing storage races with that restore (blank/black kiosk until manual refresh).
    const cacheBuster = `?v=${Date.now()}`;
    const urlWithCacheBust = startUrl.includes('?')
      ? `${startUrl}&v=${Date.now()}`
      : `${startUrl}${cacheBuster}`;

    mainWindow.loadURL(urlWithCacheBust).then(() => {
      console.log('✅ Window loaded from production URL');
      
      // Wait for page to load, then ensure we're on the correct route
      mainWindow.webContents.once('did-finish-load', () => {
        // CRITICAL: Force hash route immediately after page load
        // This ensures React Router recognizes the kiosk route before any redirects happen
        mainWindow.webContents.executeJavaScript(`
          (function() {
            var h = window.location.hash;
            var ok = h === '#/login' || (h && h.indexOf('#/kiosk/waiver') >= 0) || (h && h.indexOf('#/waiver') === 0);
            if (!ok) {
              console.log('🔧 [Electron] Fixing hash route to #/kiosk/waiver');
              window.location.hash = '#/kiosk/waiver';
            }
          })();
        `).catch(err => console.warn('⚠️ Error setting hash route:', err));
        
        console.log('✅ Page loaded, setting up auto-login...');
        
        // Try to restore session from saved file FIRST (before React loads)
        const sessionManager = require('./sessionManager.cjs');
        const savedSession = sessionManager.loadSession();
        
        // CRITICAL: Set business ID and session to localStorage IMMEDIATELY if available
        // This ensures React app can find it on first render
        // Use synchronous executeJavaScript to ensure it happens before React renders
        if (savedSession) {
          try {
            mainWindow.webContents.executeJavaScript(`
              (function() {
                // Set business ID immediately (synchronous)
                ${savedSession.business_id ? `
                  localStorage.setItem('selectedBusinessId', ${JSON.stringify(savedSession.business_id)});
                  localStorage.setItem('currentBusinessId', ${JSON.stringify(savedSession.business_id)});
                  console.log('✅ Business ID set immediately from saved session:', ${JSON.stringify(savedSession.business_id)});
                ` : 'console.log("⚠️ No business ID in saved session");'}
                
                // Set session to localStorage for Supabase
                if (${JSON.stringify(savedSession.access_token || '')}) {
                  const sessionData = {
                    access_token: ${JSON.stringify(savedSession.access_token)},
                    refresh_token: ${JSON.stringify(savedSession.refresh_token || '')},
                    expires_at: ${savedSession.expires_at || null},
                    user: ${JSON.stringify(savedSession.user || {})}
                  };
                  localStorage.setItem('tavari_session', JSON.stringify(sessionData));
                  console.log('✅ Session data set to localStorage for Supabase');
                } else {
                  console.warn('⚠️ No access token in saved session');
                }
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
                    business_id: config.business_id
                  });
                  
                  // Also save business ID to localStorage for immediate use
                  if (config.business_id) {
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
        
        if (savedSession) {
          console.log('🔐 Found saved session, attempting auto-login...');
          // Session and business ID already set to localStorage above
          // Now restore Supabase session
          mainWindow.webContents.executeJavaScript(`
            (async function() {
              try {
                // Wait for Supabase to initialize (with retry)
                let retries = 0;
                while (!window.supabase && retries < 10) {
                  await new Promise(resolve => setTimeout(resolve, 200));
                  retries++;
                }
                
                if (!window.supabase) {
                  console.warn('⚠️ Supabase not initialized after 2 seconds - will retry later');
                  return;
                }
                
                // Restore Supabase session
                const { data: { session }, error } = await window.supabase.auth.setSession({
                  access_token: ${JSON.stringify(savedSession.access_token)},
                  refresh_token: ${JSON.stringify(savedSession.refresh_token || '')}
                });
                
                if (error) {
                  console.warn('⚠️ Auto-login failed:', error.message);
                  // Don't redirect - let kiosk handle it
                } else if (session) {
                  console.log('✅ Auto-login successful! Session restored.');
                  
                  // Business ID already set above, just confirm
                  const businessId = localStorage.getItem('selectedBusinessId') || localStorage.getItem('currentBusinessId');
                  if (businessId) {
                    console.log('✅ Business ID confirmed:', businessId);
                  }
                  
                  // Navigate to kiosk splash if not on signing surface
                  var _h = window.location.hash;
                  var _ok = _h === '#/login' || (_h && _h.indexOf('#/kiosk/waiver') >= 0) || (_h && _h.indexOf('#/waiver') === 0);
                  if (!_ok) {
                    window.location.hash = '#/kiosk/waiver';
                  }
                }
              } catch (err) {
                console.error('❌ Auto-login error:', err);
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
              const { data: { session } } = await window.supabase?.auth?.getSession();
              
              if (session) {
                console.log('✅ Session found in localStorage');
                var _h2 = window.location.hash;
                var _ok2 = _h2 === '#/login' || (_h2 && _h2.indexOf('#/kiosk/waiver') >= 0) || (_h2 && _h2.indexOf('#/waiver') === 0);
                if (!_ok2) {
                  window.location.hash = '#/kiosk/waiver';
                }
              } else {
                console.log('⚠️ No session found');
                if (!window.location.hash.includes('/login')) {
                  window.location.hash = '#/kiosk/waiver';
                }
              }
            })();
          `);
        }
      });
    }).catch(err => {
      console.error('❌ Failed to load URL:', err);
      // Fallback: Retry loading music kiosk with hash routing
      mainWindow.loadURL(`${productionUrl}/#/kiosk/waiver`);
    });
  }
  
  // Runtime reload disabled — updates apply at the controlled daily 3:00 AM restart (see below).
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
      relaunchWaiverKioskApp('Daily restart at 3:00 AM');
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
      
      // FORCE hash routing - kiosk splash or public /waiver/* signing (same as WaiverKioskScreen navigate)
      (function() {
        var h = window.location.hash;
        var ok = h === '#/login' || (h && h.indexOf('#/kiosk/waiver') >= 0) || (h && h.indexOf('#/waiver') === 0);
        if (!ok) {
          console.log('🔴 FORCING redirect to waiver kiosk...');
          window.location.hash = '#/kiosk/waiver';
        }
      })();
      
      console.log('═══════════════════════════════════════');
      console.log('🎵 Tavari Waiver Kiosk Desktop - Renderer Process');
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
          var hashOk = currentHash === '#/login' || (currentHash && currentHash.indexOf('#/kiosk/waiver') >= 0) || (currentHash && currentHash.indexOf('#/waiver') === 0);
          if (!hashOk) {
            console.log('🔴 User navigated away from kiosk - forcing back...');
            window.location.hash = '#/kiosk/waiver';
          }
        }
      }, 500);
      
      // Auto-login: Supabase automatically restores session from localStorage
      (async function() {
        try {
          // Wait for Supabase to initialize
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          if (window.supabase) {
            const { data: { session } } = await window.supabase.auth.getSession();
            
            if (session) {
              console.log('✅ Session found - user is logged in');
              var _h3 = window.location.hash;
              var _ok3 = _h3 === '#/login' || (_h3 && _h3.indexOf('#/kiosk/waiver') >= 0) || (_h3 && _h3.indexOf('#/waiver') === 0);
              if (!_ok3) {
                window.location.hash = '#/kiosk/waiver';
              }
            } else {
              console.log('⚠️ No session - will show login, then redirect to kiosk');
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

    if (!isDev) {
      setTimeout(() => persistRendererWaiverKioskSession('post-startup'), 30000);
      setInterval(() => persistRendererWaiverKioskSession('periodic'), 5 * 60 * 1000);
    }
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
        console.log('💡 All console logs from the waiver flow will appear in DevTools');
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
  
  // Check for installation config file before creating window
  // This allows auto-login on first run when downloaded from logged-in session
  try {
    const configPath = path.join(__dirname, '../tavari-installation-config.json');
    if (fs.existsSync(configPath)) {
      console.log('📦 Found installation config file, loading session...');
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      
      // Save to session manager for auto-login
      const sessionManager = require('./sessionManager.cjs');
      sessionManager.saveSession({
        access_token: config.accessToken,
        refresh_token: config.refreshToken,
        expires_at: config.expiresAt,
        user: { id: config.userId }
      });
      
      // Delete config file after reading (one-time use, security)
      fs.unlinkSync(configPath);
      console.log('✅ Installation config loaded - auto-login will be attempted');
    }
  } catch (error) {
    console.warn('⚠️ Could not load installation config:', error.message);
  }
  
  createWindow();
  
  // Auto-start setup - app will launch on Windows boot (for headless mini PC)
  app.setLoginItemSettings({
    openAtLogin: true,
    name: 'Tavari Waiver Kiosk',
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

// Check for installation config file in app directory
ipcMain.handle('check-installation-config', async () => {
  try {
    const configPath = path.join(__dirname, '../tavari-installation-config.json');
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      
      // Save to session manager
      const sessionManager = require('./sessionManager.cjs');
      sessionManager.saveSession({
        access_token: config.accessToken,
        refresh_token: config.refreshToken,
        expires_at: config.expiresAt,
        user: { id: config.userId }
      });
      
      // Delete config file after reading (one-time use)
      fs.unlinkSync(configPath);
      console.log('✅ Installation config loaded and saved');
      
      return config;
    }
    return null;
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
  relaunchWaiverKioskApp('Manual restart requested from UI');
});

// File cache operations for offline music playback
ipcMain.handle('cache:save-track', async (event, trackId, fileData, metadata) => {
  try {
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