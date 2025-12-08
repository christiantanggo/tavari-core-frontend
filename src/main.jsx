// Buffer polyfill for browser compatibility
import { Buffer } from 'buffer';
window.Buffer = Buffer;

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
const isElectron = window.location.protocol === 'file:' || 
                   window.navigator.userAgent.includes('Electron') ||
                   typeof window.electronAPI !== 'undefined' ||
                   typeof window.__TAVARI_KIOSK_MODE__ !== 'undefined' ||
                   (window.location.hostname === '127.0.0.1' && window.location.port !== '');

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