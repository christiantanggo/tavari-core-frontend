// src/screens/Waivers/WaiverKioskScreen.jsx
// Full-screen kiosk mode for waiver signing on tablets (optimized for older iPads)
// Similar to MusicKioskScreen but for waivers

import React, { useEffect, useState } from 'react';
import { FiTablet } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import WaiverKioskFullscreenOverlay from '../../components/Waivers/WaiverKioskFullscreenOverlay';
import { requestSignageFullscreen } from '../../utils/signageFullscreen';

/** Match main.jsx Router choice (HashRouter vs BrowserRouter). */
function isHashRouterStyleApp() {
  if (typeof window === 'undefined') return false;
  return (
    window.location.protocol === 'file:' ||
    window.navigator.userAgent.includes('Electron') ||
    typeof window.electronAPI !== 'undefined' ||
    typeof window.__TAVARI_KIOSK_MODE__ !== 'undefined' ||
    (window.location.hostname === '127.0.0.1' && window.location.port !== '')
  );
}

function buildBrowserKioskWaiverHandoffUrl(businessId, templateKey) {
  const qs = 'signingStation=browser_kiosk';
  const path = templateKey
    ? `/waiver/${businessId}/${templateKey}?${qs}`
    : `/waiver/${businessId}?${qs}`;
  const baseUrl = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

  if (isHashRouterStyleApp()) {
    const prefix = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    return `${prefix}#${path}`;
  }

  return `${window.location.origin}${baseUrl}${path}`;
}

/**
 * Full-document navigation (not client-side navigate) so we never assign a URL from
 * a chrome-error:// frame (Chrome blocks that). Also breaks out of iframes.
 */
function handOffToPublicWaiverUrl(handoffUrl) {
  try {
    if (window.top !== window.self) {
      window.top.location.replace(handoffUrl);
      return;
    }
  } catch {
    /* cross-origin parent — cannot replace top */
  }
  window.location.replace(handoffUrl);
}

const WaiverKioskScreen = () => {
  const [businessId, setBusinessId] = useState(null);
  const [templateKey, setTemplateKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [business, setBusiness] = useState(null);
  const [showBusinessIdModal, setShowBusinessIdModal] = useState(false);
  const [businessIdInput, setBusinessIdInput] = useState('');

  useEffect(() => {
    const isDesktopApp = window.electronAPI || window.__TAVARI_KIOSK_MODE__;
    console.log('📋 Waiver Kiosk loaded - Desktop app:', isDesktopApp);

    // HashRouter only: ensure correct hash route (BrowserRouter apps skip this).
    if (isHashRouterStyleApp() && window.location.hash !== '#/kiosk/waiver') {
      console.log('🔧 Fixing hash route...');
      window.location.hash = '#/kiosk/waiver';
    }

    // Browser fullscreen for kiosk (re-requested on waiver handoff via PublicWaiverFlow)
    if (!isDesktopApp) {
      requestSignageFullscreen().catch(() => {});
    }

    loadKioskConfig();
  }, []);

  const loadKioskConfig = async () => {
    try {
      setLoading(true);

      // FOR ELECTRON KIOSK: Work without auth, use business from localStorage
      const isDesktopApp = window.electronAPI || window.__TAVARI_KIOSK_MODE__;
      
      // Get business ID from localStorage or URL params
      const storedBusinessId = localStorage.getItem('selectedBusinessId') || 
                                localStorage.getItem('currentBusinessId') ||
                                new URLSearchParams(window.location.search).get('businessId');
      
      if (!storedBusinessId) {
        // For Electron: Show business ID modal instead of error
        if (isDesktopApp) {
          setShowBusinessIdModal(true);
          setLoading(false);
          return;
        }
        toast.error('Business ID not found');
        setLoading(false);
        return;
      }

      setBusinessId(storedBusinessId);

      // Load business
      const { data: biz, error: bizError } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', storedBusinessId)
        .single();

      if (bizError) {
        console.error('[WaiverKioskScreen] Business not found:', bizError);
        // If business doesn't exist, show modal to enter correct ID
        if (isDesktopApp) {
          setShowBusinessIdModal(true);
          setBusinessId(null);
          setLoading(false);
          return;
        }
        throw bizError;
      }

      setBusiness(biz);

      // Keep an explicit template override when one is provided in the URL.
      const urlTemplateKey = new URLSearchParams(window.location.search).get('templateKey');
      if (urlTemplateKey) {
        setTemplateKey(urlTemplateKey);
      }
    } catch (error) {
      console.error('[WaiverKioskScreen] Error loading config:', error);
      toast.error('Error loading kiosk configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleBusinessIdSave = async () => {
    if (!businessIdInput.trim()) {
      toast.error('Please enter a Business ID');
      return;
    }
    
    const trimmedId = businessIdInput.trim();
    
    // Validate business exists
    try {
      const { data: biz, error } = await supabase
        .from('businesses')
        .select('id, name')
        .eq('id', trimmedId)
        .single();
      
      if (error) {
        console.error('[WaiverKioskScreen] Business lookup error:', error);
        toast.error(`Business ID not found: ${error.message || 'Please check and try again.'}`);
        return;
      }
      
      if (!biz) {
        console.error('[WaiverKioskScreen] Business not found - no data returned');
        toast.error('Business ID not found. Please check and try again.');
        return;
      }
      
      // Save to localStorage
      setBusinessId(trimmedId);
      localStorage.setItem('selectedBusinessId', trimmedId);
      localStorage.setItem('currentBusinessId', trimmedId);
      
      setShowBusinessIdModal(false);
      setBusinessIdInput('');
      toast.success(`Business ID set: ${biz.name}`);
    } catch (error) {
      console.error('[WaiverKioskScreen] Error validating business:', error);
      toast.error('Error validating business ID');
    }
  };

  // Hand off to public waiver URL via full page load (see handOffToPublicWaiverUrl).
  // CRITICAL: All hooks must be BEFORE any conditional returns to follow Rules of Hooks
  useEffect(() => {
    if (!loading && businessId && !showBusinessIdModal) {
      const url = buildBrowserKioskWaiverHandoffUrl(businessId, templateKey);
      handOffToPublicWaiverUrl(url);
    }
  }, [businessId, templateKey, loading, showBusinessIdModal]);

  // Now we can safely use conditional returns
  if (loading) {
    return (
      <>
        <WaiverKioskFullscreenOverlay />
        <div style={styles.container}>
        <div style={styles.loading}>
          <FiTablet size={64} style={styles.loadingIcon} />
          <p style={styles.loadingText}>Loading Waiver Kiosk...</p>
        </div>
      </div>
      </>
    );
  }

  // Show business ID modal if no business ID
  if (!businessId || showBusinessIdModal) {
    return (
      <>
        <WaiverKioskFullscreenOverlay />
        <div style={styles.container}>
        <div style={styles.configScreen}>
          <FiTablet size={64} style={styles.configIcon} />
          <h2 style={styles.configTitle}>Waiver Kiosk Configuration</h2>
          <p style={styles.configText}>
            {!businessId 
              ? 'Please enter your Business ID to continue'
              : 'Update Business ID'}
          </p>
          
          <div style={styles.configForm}>
            <label style={styles.configLabel}>
              Business ID:
            </label>
            <input
              type="text"
              value={businessIdInput}
              onChange={(e) => setBusinessIdInput(e.target.value)}
              placeholder="Enter Business ID (UUID)"
              style={styles.configInput}
              autoFocus
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleBusinessIdSave();
                }
              }}
            />
            <div style={styles.configButtons}>
              <button
                onClick={handleBusinessIdSave}
                style={styles.configSaveButton}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      </div>
      </>
    );
  }

  return (
    <>
      <WaiverKioskFullscreenOverlay />
      <div style={styles.container}>
      <div style={styles.loading}>
        <FiTablet size={64} style={styles.loadingIcon} />
        <p style={styles.loadingText}>Loading Waiver...</p>
      </div>
    </div>
    </>
  );
};

const styles = {
  container: {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TavariStyles.colors.background,
    overflow: 'hidden'
  },
  kioskContainer: {
    width: '100vw',
    height: '100vh',
    overflow: 'auto',
    backgroundColor: TavariStyles.colors.background
  },
  loading: {
    textAlign: 'center',
    padding: '2rem'
  },
  loadingIcon: {
    color: TavariStyles.colors.primary,
    marginBottom: '1rem'
  },
  loadingText: {
    fontSize: '1.25rem',
    color: TavariStyles.colors.text,
    marginTop: '1rem'
  },
  configScreen: {
    textAlign: 'center',
    padding: '3rem',
    maxWidth: '500px',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    boxShadow: TavariStyles.shadows.lg
  },
  configIcon: {
    color: TavariStyles.colors.primary,
    marginBottom: '1.5rem'
  },
  configTitle: {
    fontSize: '1.75rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    marginBottom: '1rem'
  },
  configText: {
    fontSize: '1rem',
    color: TavariStyles.colors.gray600,
    marginBottom: '2rem'
  },
  configForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  configLabel: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: TavariStyles.colors.text,
    textAlign: 'left'
  },
  configInput: {
    width: '100%',
    padding: '12px',
    border: `2px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontFamily: 'monospace',
    outline: 'none'
  },
  configButtons: {
    display: 'flex',
    gap: '1rem',
    justifyContent: 'flex-end',
    marginTop: '0.5rem'
  },
  configSaveButton: {
    padding: '12px 24px',
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer'
  }
};

export default WaiverKioskScreen;
