// Surface boot failures on-screen when DevTools is unavailable (kiosk / fullscreen).
// Only replace the page during initial boot — runtime errors (e.g. PDF.js worker)
// must not wipe an already-running dashboard.
let appBooted = false;
function showBootError(message) {
  if (appBooted) {
    console.error('[runtime]', message);
    return;
  }
  try {
    const root = document.getElementById('root');
    if (!root) return;
    root.innerHTML = `
      <div style="font-family:system-ui,sans-serif;padding:24px;max-width:640px;margin:40px auto;color:#111;">
        <h1 style="font-size: 16px;margin:0 0 12px;">Tavari could not start</h1>
        <p style="margin:0 0 12px;line-height:1.5;color:#444;">
          The app hit an error while loading. Try a hard refresh (Ctrl+Shift+R) or clear site data for this URL.
        </p>
        <pre style="white-space:pre-wrap;word-break:break-word;background:#f3f4f6;padding:12px;border-radius:8px;font-size: 10px;">${String(message || 'Unknown error')}</pre>
      </div>
    `;
  } catch {
    /* ignore */
  }
}

window.addEventListener('error', (event) => {
  showBootError(event.error?.message || event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  showBootError(event.reason?.message || String(event.reason));
});

// Buffer polyfill for browser compatibility
import { Buffer } from 'buffer';

window.Buffer = Buffer;

// Full reload (F5, deploy refresh): clear POS→customer-display ephemeral keys so the next mirror upsert
// does not combine an empty/restoring cart with a previous sale_complete / receipt_navigation / payment blob.
try {
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  if (nav && nav.type === 'reload') {
    localStorage.removeItem('tavari_customer_display_sale_complete');
    localStorage.removeItem('tavari_customer_display_receipt_navigation');
    localStorage.removeItem('tavari_customer_display_payment');
  }
} catch {
  /* ignore */
}

// PHASE 3, STEP 71.5: Disable service worker in Electron
// ⚠️ BUILD FIX: Service worker cache DISABLED in Electron - use file cache instead
if (window.electronAPI) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      registrations.forEach(registration => {
        registration.unregister().catch(() => {});
      });
      console.log('🔧 Service worker disabled in Electron - using file cache instead');
    });
    
    // Prevent future service worker registration
    const originalRegister = navigator.serviceWorker.register;
    navigator.serviceWorker.register = function() {
      console.warn('⚠️ Service worker registration blocked in Electron');
      return Promise.reject(new Error('Service workers disabled in Electron'));
    };
  }
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { UserProvider } from './contexts/UserContext';
import { BusinessProvider } from './contexts/BusinessContext';
import { RoleProvider } from './contexts/RoleContext';
import { ErrorProvider } from './contexts/ErrorContext';

// Use HashRouter for Electron (file:// protocol) and BrowserRouter for web
// Check if we're in Electron by looking at the protocol or global flags
// Note: When using HTTP server in Electron, protocol will be 'http:' not 'file:'
// Do not treat Vite dev (127.0.0.1:5173) as Electron — that forces HashRouter and breaks /dashboard paths.
const isElectron = window.location.protocol === 'file:' ||
                   window.navigator.userAgent.includes('Electron') ||
                   typeof window.electronAPI !== 'undefined' ||
                   typeof window.__TAVARI_KIOSK_MODE__ !== 'undefined';

const Router = isElectron ? HashRouter : BrowserRouter;

if (isElectron) {
  console.log('🖥️ Electron detected - using HashRouter');
  console.log('🔍 Detection method:', 
    window.location.protocol === 'file:' ? 'file:// protocol' :
    window.navigator.userAgent.includes('Electron') ? 'UserAgent' :
    typeof window.electronAPI !== 'undefined' ? 'electronAPI' :
    typeof window.__TAVARI_KIOSK_MODE__ !== 'undefined' ? 'Kiosk mode flag' :
    'localhost detection'
  );
} else {
  console.log('🌐 Web browser detected - using BrowserRouter');
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <Router>
      <UserProvider>
        <BusinessProvider>
          <RoleProvider>
            <ErrorProvider>
              <App />
            </ErrorProvider>
          </RoleProvider>
        </BusinessProvider>
      </UserProvider>
    </Router>
  </React.StrictMode>
);
appBooted = true;