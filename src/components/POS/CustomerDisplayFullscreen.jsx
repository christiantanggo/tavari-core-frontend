import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { CUSTOMER_DISPLAY_PAYMENT_MAX_MS } from '../../services/customerDisplayLocalState';
import {
  isCustomerDisplayAdHalfScreen,
  normalizeCustomerDisplayAdType
} from '../../constants/customerDisplayAds';
import { adPassesCustomerDisplaySchedule } from '../../utils/customerDisplayAdSchedule';
import { getPosLineSubtotal, getPosLineUnitPrice } from '../../utils/posLinePricing';

const SYNC_TOKEN_STORAGE_KEY = 'customer_display_sync_token';

function readPairedDisplayTokenFromStorage() {
  try {
    return (sessionStorage.getItem(SYNC_TOKEN_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

/** Electron / paired display: cart & payment live in Supabase mirror, not this window's localStorage (POS is another process). */
function isMirrorOnlyCustomerDisplay() {
  if (typeof window === 'undefined') return false;
  if (window.__TAVARI_CUSTOMER_DISPLAY_APP__) return true;
  try {
    const t = sessionStorage.getItem(SYNC_TOKEN_STORAGE_KEY);
    return !!(t && String(t).trim());
  } catch {
    return false;
  }
}

function mirrorFieldToString(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'string') return val;
  try {
    return JSON.stringify(val);
  } catch {
    return null;
  }
}

/** get_customer_display_state / PostgREST sometimes stringify jsonb; payload.cart may be string or object */
function normalizeMirrorPayloadField(payloadRaw) {
  if (payloadRaw == null || payloadRaw === '') return {};
  if (typeof payloadRaw === 'string') {
    try {
      const o = JSON.parse(payloadRaw);
      return o && typeof o === 'object' ? o : {};
    } catch {
      return {};
    }
  }
  if (typeof payloadRaw === 'object') return payloadRaw;
  return {};
}

function parseCartDocumentFromInner(inner) {
  const c = inner?.cart;
  if (c == null || c === '') return null;
  if (typeof c === 'object') return c;
  if (typeof c === 'string') {
    try {
      return JSON.parse(c);
    } catch {
      return null;
    }
  }
  return null;
}

/** If POS has not refreshed the mirror row recently, default to full-screen ads (fail-safe). */
const MIRROR_ROW_STALE_MS = 2 * 60 * 1000;

function parseMirrorRowUpdatedAtMs(row) {
  const u = row?.updated_at;
  if (u == null) return null;
  if (typeof u === 'number' && Number.isFinite(u)) return u;
  const parsed = typeof u === 'string' ? Date.parse(u) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function mirrorPayloadIndicatesPosLocked(inner) {
  const v = inner?.pos_locked;
  return v === true || v === 1 || v === '1' || v === 'true';
}

function parseAdsRpcResult(data) {
  if (data == null) return [];
  if (Array.isArray(data)) return data;
  if (typeof data === 'string') {
    try {
      const p = JSON.parse(data);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeCustomerDisplayAdRow(rawAd) {
  if (rawAd == null) return null;
  let ad = rawAd;
  if (typeof ad === 'string') {
    try {
      ad = JSON.parse(ad);
    } catch {
      return null;
    }
  }
  if (!ad || typeof ad !== 'object') return null;
  return {
    ...ad,
    image_url: ad.image_url || ad.imageUrl || '',
    ad_type: normalizeCustomerDisplayAdType(
      ad.ad_type ?? ad.display_type ?? ad.displayType ?? ad.type
    )
  };
}

function mirrorPaymentShouldBeVisible(paymentData, activeCartItemCount) {
  if (!paymentData?.method || paymentData.amount == null) return false;

  // Keep the payment panel visible for an active sale. The 5-second timeout is
  // only for the short post-sale payment summary after the cart is cleared.
  if (activeCartItemCount > 0) return true;

  const pTs = Number(paymentData.timestamp) || 0;
  if (pTs <= 0) return false;
  return Date.now() - pTs <= CUSTOMER_DISPLAY_PAYMENT_MAX_MS;
}

/**
 * CustomerDisplayFullscreen - COMPLETELY INDEPENDENT customer-facing display
 * This component has NO dependencies on the main app's contexts or session management
 * It runs in its own isolated environment and is never affected by lock modals
 */
const CustomerDisplayFullscreen = () => {
  const navigate = useNavigate();
  // Get business ID from localStorage (set by main app)
  const [businessId, setBusinessId] = useState(null);
  const [currentTransaction, setCurrentTransaction] = useState(null);
  const [isIdle, setIsIdle] = useState(true);
  const [idleAds, setIdleAds] = useState([]);
  const [transactionAds, setTransactionAds] = useState([]);
  const [currentIdleAdIndex, setCurrentIdleAdIndex] = useState(0);
  const [currentTransactionAdIndex, setCurrentTransactionAdIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  
  // Payment display state
  const [paymentInfo, setPaymentInfo] = useState(null);
  const [showPaymentDisplay, setShowPaymentDisplay] = useState(false);
  
  // Transaction completion state
  const [transactionComplete, setTransactionComplete] = useState(false);

  /** Browser popup from POS has a close tab—prompt stores to use the dedicated .exe instead */
  const [showStaffBrowserHint, setShowStaffBrowserHint] = useState(false);

  /** Electron app launched without ?displayToken= */
  const [electronMissingSyncToken, setElectronMissingSyncToken] = useState(false);

  /** Drives mirror Realtime + polling; must update whenever sessionStorage gains the token (effect [] alone misses that). */
  const [pairedDisplayToken, setPairedDisplayToken] = useState(() =>
    typeof window !== 'undefined' ? readPairedDisplayTokenFromStorage() : ''
  );

  const lastMirrorSaleTsRef = useRef(null);
  const lastMirrorReceiptTsRef = useRef(null);
  const idleAdsRef = useRef([]);
  const transactionAdsRef = useRef([]);

  // Persist displayToken from URL (search and/or hash) then send Electron to pairing if still missing
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      let t = params.get('displayToken');
      if (!t || !t.trim()) {
        const hash = window.location.hash || '';
        const qi = hash.indexOf('?');
        if (qi >= 0) {
          t = new URLSearchParams(hash.slice(qi + 1)).get('displayToken');
        }
      }
      if (t && t.trim()) {
        const v = t.trim();
        sessionStorage.setItem(SYNC_TOKEN_STORAGE_KEY, v);
        setPairedDisplayToken(v);
      }
    } catch {
      /* ignore */
    }

    if (typeof window === 'undefined' || !window.__TAVARI_CUSTOMER_DISPLAY_APP__) return;

    let stored = '';
    try {
      stored = sessionStorage.getItem(SYNC_TOKEN_STORAGE_KEY) || '';
    } catch {
      setElectronMissingSyncToken(true);
      setPairedDisplayToken('');
      navigate('/customer-display-pair', { replace: true });
      return;
    }

    if (!stored.trim()) {
      setElectronMissingSyncToken(true);
      setPairedDisplayToken('');
      navigate('/customer-display-pair', { replace: true });
      return;
    }

    setPairedDisplayToken(stored.trim());
    setElectronMissingSyncToken(false);
  }, [navigate]);

  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      if (window.__TAVARI_CUSTOMER_DISPLAY_APP__) return;
      let hasOpener = false;
      try {
        hasOpener = window.opener != null && window.opener !== window;
      } catch {
        return;
      }
      if (!hasOpener) return;
      if (sessionStorage.getItem('tavari_customer_display_browser_hint_dismissed') === '1') return;
      setShowStaffBrowserHint(true);
    } catch {
      /* ignore */
    }
  }, []);

  const dismissStaffBrowserHint = () => {
    try {
      sessionStorage.setItem('tavari_customer_display_browser_hint_dismissed', '1');
    } catch {
      /* ignore */
    }
    setShowStaffBrowserHint(false);
  };

  // Initial business id from POS browser localStorage (popup mode)
  useEffect(() => {
    try {
      const storedBusinessId = localStorage.getItem('selectedBusinessId') || localStorage.getItem('currentBusinessId');
      if (storedBusinessId) setBusinessId(storedBusinessId);
    } catch {
      /* ignore */
    }
  }, []);

  // Paired display: poll mirror RPC only (no Realtime — same contract as Supabase + one dumb loop).
  useEffect(() => {
    const token = pairedDisplayToken.trim();
    if (!token) return undefined;

    let cancelled = false;
    let rpcWarned = false;
    let tickInFlight = false;

    /** Stale mirror keys (sale_complete / receipt_navigation) survive in DB; refs reset each app open → do not replay old events or wipe an active cart */
    const MIRROR_EVENT_MAX_AGE_MS = 3 * 60 * 1000;

    const resetMirrorUiToIdleAds = () => {
      setCurrentTransaction(null);
      setPaymentInfo(null);
      setShowPaymentDisplay(false);
      setTransactionComplete(false);
      setIsIdle(true);
    };

    const applyMirrorRow = (raw) => {
      let row = raw;
      if (row != null && typeof row === 'string') {
        try {
          row = JSON.parse(row);
        } catch {
          return;
        }
      }
      if (!row || typeof row !== 'object') return;

      const inner = normalizeMirrorPayloadField(row.payload);
      if (row.business_id) {
        setBusinessId((prev) => prev || row.business_id);
      }

      const updatedMs = parseMirrorRowUpdatedAtMs(row);
      if (updatedMs == null || Date.now() - updatedMs > MIRROR_ROW_STALE_MS) {
        resetMirrorUiToIdleAds();
        return;
      }

      if (mirrorPayloadIndicatesPosLocked(inner)) {
        resetMirrorUiToIdleAds();
        return;
      }

      let activeCartItemCount = 0;
      try {
        const cartData = parseCartDocumentFromInner(inner);
        if (cartData?.cartItems && Array.isArray(cartData.cartItems) && cartData.cartItems.length > 0) {
          activeCartItemCount = cartData.cartItems.length;
          const ts = cartData.timestamp ?? Date.now();
          setCurrentTransaction({
            id: `cart_${ts}`,
            items: cartData.cartItems,
            status: 'active',
            created_at: new Date(ts).toISOString(),
            business_id: cartData.businessId
          });
          setIsIdle(false);
        } else {
          setCurrentTransaction(null);
          setIsIdle(true);
        }
      } catch {
        setCurrentTransaction(null);
        setIsIdle(true);
      }

      const paymentDataStr = mirrorFieldToString(inner.payment);
      try {
        if (paymentDataStr) {
          const paymentData = JSON.parse(paymentDataStr);
          if (mirrorPaymentShouldBeVisible(paymentData, activeCartItemCount)) {
            setPaymentInfo(paymentData);
            setShowPaymentDisplay(true);
            setIsIdle(false);
          } else {
            setPaymentInfo(null);
            setShowPaymentDisplay(false);
          }
        } else {
          setPaymentInfo(null);
          setShowPaymentDisplay(false);
        }
      } catch {
        setPaymentInfo(null);
        setShowPaymentDisplay(false);
      }

      const receiptNavigationStr = mirrorFieldToString(inner.receipt_navigation);
      try {
        if (receiptNavigationStr && activeCartItemCount === 0) {
          const navData = JSON.parse(receiptNavigationStr);
          const ts = Number(navData.timestamp) || 0;
          const fresh = ts > 0 && Date.now() - ts < MIRROR_EVENT_MAX_AGE_MS;
          if (navData.navigated && fresh && ts !== lastMirrorReceiptTsRef.current) {
            lastMirrorReceiptTsRef.current = ts;
            setTransactionComplete(false);
            setShowPaymentDisplay(false);
            setPaymentInfo(null);
            setCurrentTransaction(null);
            setIsIdle(true);
          }
        }
      } catch {
        /* ignore */
      }

      const saleCompletionStr = mirrorFieldToString(inner.sale_complete);
      try {
        if (saleCompletionStr) {
          const completionData = JSON.parse(saleCompletionStr);
          const ts = Number(completionData.timestamp) || 0;
          const fresh = ts > 0 && Date.now() - ts < MIRROR_EVENT_MAX_AGE_MS;
          if (
            activeCartItemCount === 0 &&
            completionData.completed &&
            fresh &&
            ts !== lastMirrorSaleTsRef.current
          ) {
            lastMirrorSaleTsRef.current = ts;
            setCurrentTransaction(null);
            setIsIdle(true);
            const payStr = mirrorFieldToString(inner.payment);
            let paymentFresh = false;
            if (payStr) {
              try {
                const pd = JSON.parse(payStr);
                const pTs = Number(pd.timestamp) || 0;
                paymentFresh =
                  !!pd.method &&
                  pd.amount != null &&
                  pTs > 0 &&
                  Date.now() - pTs <= CUSTOMER_DISPLAY_PAYMENT_MAX_MS;
              } catch {
                paymentFresh = false;
              }
            }
            if (!paymentFresh) {
              setTransactionComplete(true);
              setShowPaymentDisplay(false);
              setPaymentInfo(null);
              setTimeout(() => {
                setTransactionComplete(false);
              }, 3000);
            } else {
              setTransactionComplete(false);
            }
          }
        } else {
          setTransactionComplete(false);
        }
      } catch {
        /* ignore */
      }
    };

    /** Fast while POS is updating the mirror; slow when payload is unchanged (idle / ads). */
    const POLL_FAST_MS = 1000;
    const POLL_SLOW_MS = 10000;
    const POLL_HIDDEN_MS = 30000;
    const POLL_ERROR_MS = 10000;
    const STABLE_TICKS_BEFORE_SLOW = 2;

    let timeoutId = null;
    let lastMirrorUpdatedSig = null;
    let stableMirrorTicks = 0;

    const clearPollTimer = () => {
      if (timeoutId != null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const scheduleMirrorPoll = (delayMs) => {
      if (cancelled) return;
      clearPollTimer();
      timeoutId = setTimeout(() => {
        void runMirrorTick();
      }, delayMs);
    };

    const runMirrorTick = async () => {
      if (cancelled) return;
      if (tickInFlight) {
        scheduleMirrorPoll(200);
        return;
      }
      if (!token) return;

      tickInFlight = true;
      try {
        const { data, error } = await supabase.rpc('get_customer_display_state', {
          p_token: token
        });
        if (cancelled) return;
        if (error) {
          if (!rpcWarned) {
            console.warn('Customer display mirror:', error.message);
            rpcWarned = true;
          }
          scheduleMirrorPoll(POLL_ERROR_MS);
          return;
        }
        if (!data) {
          scheduleMirrorPoll(POLL_SLOW_MS);
          return;
        }

        let row = data;
        if (row != null && typeof row === 'string') {
          try {
            row = JSON.parse(row);
          } catch {
            row = null;
          }
        }
        const sig =
          row && typeof row === 'object' && row.updated_at != null
            ? String(row.updated_at)
            : null;

        applyMirrorRow(data);

        if (sig != null) {
          if (sig === lastMirrorUpdatedSig) stableMirrorTicks += 1;
          else {
            lastMirrorUpdatedSig = sig;
            stableMirrorTicks = 0;
          }
        } else {
          stableMirrorTicks = 0;
        }

        let nextMs = POLL_FAST_MS;
        try {
          if (typeof document !== 'undefined' && document.hidden) {
            nextMs = POLL_HIDDEN_MS;
          } else if (stableMirrorTicks >= STABLE_TICKS_BEFORE_SLOW) {
            nextMs = POLL_SLOW_MS;
          }
        } catch {
          /* ignore */
        }

        scheduleMirrorPoll(nextMs);
      } finally {
        tickInFlight = false;
      }
    };

    const onVisibilityChange = () => {
      try {
        if (cancelled || typeof document === 'undefined' || document.hidden) return;
        void runMirrorTick();
      } catch {
        /* ignore */
      }
    };

    try {
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibilityChange);
      }
    } catch {
      /* ignore */
    }

    scheduleMirrorPoll(0);

    return () => {
      cancelled = true;
      clearPollTimer();
      try {
        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', onVisibilityChange);
        }
      } catch {
        /* ignore */
      }
    };
  }, [pairedDisplayToken]);

  useEffect(() => {
    if (!currentTransaction && !showPaymentDisplay && !transactionComplete) {
      setIsIdle(true);
    }
  }, [currentTransaction, showPaymentDisplay, transactionComplete]);

  /**
   * Paired kiosk: anon key + RLS → direct select returns 0 rows. Use read_token RPC (same security
   * model as get_customer_display_state). Logged-in POS browser popup: businessId + JWT → table OK.
   */
  const loadAds = useCallback(async () => {
    try {
      const token = (readPairedDisplayTokenFromStorage() || pairedDisplayToken || '').trim();
      if (!token && !businessId) {
        setIdleAds([]);
        setTransactionAds([]);
        return;
      }

      let rawRows = null;

      if (token) {
        const { data, error } = await supabase.rpc('get_customer_display_ads_for_kiosk', {
          p_token: token
        });
        if (error) {
          console.warn('[CustomerDisplay] get_customer_display_ads_for_kiosk:', error.message);
        } else {
          rawRows = parseAdsRpcResult(data);
        }
      }

      if ((!rawRows || rawRows.length === 0) && businessId) {
        const { data, error } = await supabase
          .from('customer_display_ads')
          .select('*')
          .eq('is_active', true)
          .eq('business_id', businessId)
          .order('display_order', { ascending: true });

        if (error) {
          console.warn('[CustomerDisplay] customer_display_ads select:', error.message);
        } else {
          rawRows = data || [];
        }
      }

      if (!rawRows || !Array.isArray(rawRows)) {
        setIdleAds([]);
        setTransactionAds([]);
        return;
      }

      const normalized = rawRows
        .map((ad) => normalizeCustomerDisplayAdRow(ad))
        .filter(Boolean);

      const filteredAds = normalized.filter((ad) => adPassesCustomerDisplaySchedule(ad));

      const transactionAdsList = filteredAds.filter((ad) => isCustomerDisplayAdHalfScreen(ad));
      const idleAdsList = filteredAds.filter((ad) => !isCustomerDisplayAdHalfScreen(ad));

      setIdleAds(idleAdsList);
      setTransactionAds(transactionAdsList);
    } catch (e) {
      console.warn('[CustomerDisplay] loadAds:', e?.message || e);
      setIdleAds([]);
      setTransactionAds([]);
    } finally {
      setIsLoading(false);
    }
  }, [businessId, pairedDisplayToken]);

  useEffect(() => {
    const token = (readPairedDisplayTokenFromStorage() || pairedDisplayToken || '').trim();
    if (!token && !businessId) return undefined;

    void loadAds();
    const refreshInterval = setInterval(() => {
      void loadAds();
    }, 5 * 60 * 1000);

    return () => clearInterval(refreshInterval);
  }, [businessId, pairedDisplayToken, loadAds]);

  // Disable session locking for customer display.
  useEffect(() => {
    // Add CSS animation for spinner and global fullscreen styles
    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      
      /* Hide scrollbars globally */
      ::-webkit-scrollbar {
        display: none;
      }
      
      html {
        margin: 0;
        padding: 0;
        overflow: hidden !important;
        width: 100%;
        height: 100%;
        max-height: 100dvh;
        overscroll-behavior: none;
      }

      html, body {
        margin: 0;
        padding: 0;
        overflow: hidden !important;
        width: 100%;
        height: 100%;
        max-height: 100dvh;
        overscroll-behavior: none;
      }
      
      /* Ensure fullscreen coverage */
      html:fullscreen, html:-webkit-full-screen, html:-moz-full-screen, html:-ms-fullscreen {
        width: 100%;
        height: 100%;
        max-height: 100dvh;
        overflow: hidden !important;
      }
      
      /* Root must participate in height chain (Vite template / other globals may add padding or flex center on body) */
      #root {
        height: 100% !important;
        max-height: 100dvh !important;
        min-height: 0 !important;
        width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        display: flex !important;
        flex-direction: column !important;
        box-sizing: border-box !important;
      }
      
      /* Ensure customer display is ALWAYS on top and never hidden */
      body {
        z-index: 999999 !important;
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
        max-height: 100dvh !important;
        background: white !important;
        display: flex !important;
        flex-direction: column !important;
        min-height: 0 !important;
        overscroll-behavior: none !important;
      }
      
      /* Hide any lock modals that might appear */
      [class*="lock"], [class*="Lock"], [id*="lock"], [id*="Lock"] {
        display: none !important;
        visibility: hidden !important;
        z-index: -9999 !important;
      }
      
      /* Override main app's lock modal system completely */
      .lock-modal, .LockModal, .session-lock-modal, .SessionLockModal,
      .unlock-modal, .UnlockModal, .manager-lock-modal, .ManagerLockModal {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        z-index: -9999 !important;
        pointer-events: none !important;
      }
      
      /*
       * Must stay display:flex so children with flex:1 / min-height:0 actually shrink to the viewport.
       * display:block !important was overriding inline styles and breaking the no-scroll layout.
       */
      .customer-display-container, .customer-display-fullscreen {
        z-index: 999999 !important;
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100% !important;
        max-width: 100vw !important;
        height: 100dvh !important;
        max-height: 100dvh !important;
        min-height: 0 !important;
        background: #1a1a1a !important;
        display: flex !important;
        flex-direction: column !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }
    `;
    document.head.appendChild(style);

    // COMPLETELY DISABLE main app's session lock system for customer display
    window.sessionLockDisabled = true;
    window.customerDisplayMode = true;
    
    // Override any session lock functions that might exist
    if (window.showLockModal) {
      window.originalShowLockModal = window.showLockModal;
      window.showLockModal = () => {
        console.log('CustomerDisplay: Blocked showLockModal call');
        return false;
      };
    }
    
    if (window.setSessionLock) {
      window.originalSetSessionLock = window.setSessionLock;
      window.setSessionLock = () => {
        console.log('CustomerDisplay: Blocked setSessionLock call');
        return false;
      };
    }
    
    if (window.lockApp) {
      window.originalLockApp = window.lockApp;
      window.lockApp = () => {
        console.log('CustomerDisplay: Blocked lockApp call');
        return false;
      };
    }
    
    // Clear ALL existing timeouts and intervals that might trigger session lock
    const highestTimeoutId = setTimeout(() => {}, 0);
    for (let i = 0; i < highestTimeoutId; i++) {
      clearTimeout(i);
      clearInterval(i);
    }
    
    // Prevent the main app's session lock from affecting this window
    const preventSessionLock = () => {
      // Override any session lock attempts
      if (window.sessionLockDisabled !== true) {
        window.sessionLockDisabled = true;
      }
      
      // Hide any lock modals that might appear
      const lockModals = document.querySelectorAll('[class*="lock"], [class*="Lock"], [id*="lock"], [id*="Lock"]');
      lockModals.forEach(modal => {
        if (modal.style) {
          modal.style.display = 'none';
          modal.style.visibility = 'hidden';
          modal.style.zIndex = '-9999';
          modal.style.opacity = '0';
          modal.style.pointerEvents = 'none';
        }
      });
      
      // Also hide any modals with specific class names
      const specificLockModals = document.querySelectorAll('.lock-modal, .LockModal, .session-lock-modal, .SessionLockModal, .unlock-modal, .UnlockModal, .manager-lock-modal, .ManagerLockModal');
      specificLockModals.forEach(modal => {
        if (modal.style) {
          modal.style.display = 'none';
          modal.style.visibility = 'hidden';
          modal.style.zIndex = '-9999';
          modal.style.opacity = '0';
          modal.style.pointerEvents = 'none';
        }
      });
    };
    
    // Check every second to ensure session lock stays disabled and hide any lock modals
    const lockPreventionInterval = setInterval(preventSessionLock, 1000);
    
    // Use MutationObserver to intercept any new lock modals added to the DOM
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node;
              // Check if the added element is a lock modal
              if (element.classList && (
                element.classList.contains('lock-modal') ||
                element.classList.contains('LockModal') ||
                element.classList.contains('session-lock-modal') ||
                element.classList.contains('SessionLockModal') ||
                element.classList.contains('unlock-modal') ||
                element.classList.contains('UnlockModal') ||
                element.classList.contains('manager-lock-modal') ||
                element.classList.contains('ManagerLockModal') ||
                element.id && element.id.includes('lock') ||
                element.id && element.id.includes('Lock')
              )) {
                // Immediately hide the lock modal
                element.style.display = 'none';
                element.style.visibility = 'hidden';
                element.style.zIndex = '-9999';
                element.style.opacity = '0';
                element.style.pointerEvents = 'none';
              }
              
              // Also check for any lock modals within the added element
              const lockModals = element.querySelectorAll('[class*="lock"], [class*="Lock"], [id*="lock"], [id*="Lock"]');
              lockModals.forEach(modal => {
                modal.style.display = 'none';
                modal.style.visibility = 'hidden';
                modal.style.zIndex = '-9999';
                modal.style.opacity = '0';
                modal.style.pointerEvents = 'none';
              });
            }
          });
        }
      });
    });
    
    // Start observing the entire document for changes
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    return () => {
      clearInterval(lockPreventionInterval);
      observer.disconnect();
      
      // Restore original functions
      if (window.originalShowLockModal) {
        window.showLockModal = window.originalShowLockModal;
        delete window.originalShowLockModal;
      }
      if (window.originalSetSessionLock) {
        window.setSessionLock = window.originalSetSessionLock;
        delete window.originalSetSessionLock;
      }
      if (window.originalLockApp) {
        window.lockApp = window.originalLockApp;
        delete window.originalLockApp;
      }
      
      window.sessionLockDisabled = false;
      window.customerDisplayMode = false;
      document.head.removeChild(style);
    };
  }, []);

  // Handle ESC key to exit fullscreen and auto-fullscreen on load
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === 'Escape') {
        window.close();
      }
    };

    // Auto-enter fullscreen when component loads
    const enterFullscreen = async () => {
      try {
        // Try multiple fullscreen methods
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        } else if (document.documentElement.webkitRequestFullscreen) {
          await document.documentElement.webkitRequestFullscreen();
        } else if (document.documentElement.webkitRequestFullScreen) {
          await document.documentElement.webkitRequestFullScreen();
        } else if (document.documentElement.mozRequestFullScreen) {
          await document.documentElement.mozRequestFullScreen();
        } else if (document.documentElement.msRequestFullscreen) {
          await document.documentElement.msRequestFullscreen();
        }
        
        // Also try window fullscreen
        if (window.screen && window.screen.requestFullscreen) {
          await window.screen.requestFullscreen();
        }
        
        console.log('Fullscreen request sent');
      } catch (error) {
        console.log('Fullscreen not supported or blocked:', error);
        // If fullscreen fails, try to maximize the window
        if (window.moveTo) {
          window.moveTo(0, 0);
          window.resizeTo(screen.width, screen.height);
        }
      }
    };

    // Enter fullscreen immediately and also after a delay
    enterFullscreen();
    setTimeout(enterFullscreen, 1000);
    setTimeout(enterFullscreen, 2000);

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  // Monitor POS cart state via localStorage (same browser profile as POS only — never on Electron / mirror token)
  useEffect(() => {
    if (isMirrorOnlyCustomerDisplay()) return;

    const checkCartData = () => {
      try {
        const cartDataStr = localStorage.getItem('tavari_customer_display_cart');
        
        if (cartDataStr) {
          const cartData = JSON.parse(cartDataStr);
          const { cartItems, businessId, timestamp } = cartData;
          
          if (cartItems && cartItems.length > 0) {
            // Create transaction object from cart data
            const transaction = {
              id: `cart_${timestamp}`,
              items: cartItems,
              status: 'active',
              created_at: new Date(timestamp).toISOString(),
              business_id: businessId
            };
            
            setCurrentTransaction(transaction);
            setIsIdle(false);
          } else {
            setCurrentTransaction(null);
            setIsIdle(true);
          }
        } else {
          setCurrentTransaction(null);
          setIsIdle(true);
        }
      } catch (error) {
        console.error('Cart data check error:', error);
        setCurrentTransaction(null);
        setIsIdle(true);
      }
    };

    // Check immediately
    checkCartData();

    // Listen for localStorage changes
    const handleStorageChange = (e) => {
      if (
        e.key === 'tavari_customer_display_cart' ||
        e.key === 'tavari_customer_display_pos_locked'
      ) {
        checkCartData();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    
    // Also check periodically as backup
    const interval = setInterval(checkCartData, 2000);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  // Monitor payment information via localStorage (same-browser popup only)
  useEffect(() => {
    if (isMirrorOnlyCustomerDisplay()) return;

    const checkPaymentData = () => {
      try {
        const paymentDataStr = localStorage.getItem('tavari_customer_display_payment');
        
        if (paymentDataStr) {
          const paymentData = JSON.parse(paymentDataStr);
          if (paymentData.method && paymentData.amount) {
            setPaymentInfo(paymentData);
            setShowPaymentDisplay(true);
            setIsIdle(false);
          } else {
            setPaymentInfo(null);
            setShowPaymentDisplay(false);
            if (!currentTransaction && !transactionComplete) {
              setIsIdle(true);
            }
          }
        } else {
          setPaymentInfo(null);
          setShowPaymentDisplay(false);
          if (!currentTransaction && !transactionComplete) {
            setIsIdle(true);
          }
        }
      } catch (error) {
        console.error('Payment data check error:', error);
        setPaymentInfo(null);
        setShowPaymentDisplay(false);
        if (!currentTransaction && !transactionComplete) {
          setIsIdle(true);
        }
      }
    };

    // Check immediately
    checkPaymentData();

    // Listen for localStorage changes
    const handlePaymentStorageChange = (e) => {
      if (
        e.key === 'tavari_customer_display_payment' ||
        e.key === 'tavari_customer_display_pos_locked'
      ) {
        checkPaymentData();
      }
    };

    window.addEventListener('storage', handlePaymentStorageChange);
    
    // Also check periodically as backup
    const paymentInterval = setInterval(checkPaymentData, 2000);

    return () => {
      window.removeEventListener('storage', handlePaymentStorageChange);
      clearInterval(paymentInterval);
    };
  }, [currentTransaction, transactionComplete]);

  // Monitor sale completion via localStorage (same-browser popup only)
  useEffect(() => {
    if (isMirrorOnlyCustomerDisplay()) return;

    const checkSaleCompletion = () => {
      try {
        const saleCompletionData = localStorage.getItem('tavari_customer_display_sale_complete');
        if (saleCompletionData) {
          const completionData = JSON.parse(saleCompletionData);
          
          if (completionData.completed) {
            setTransactionComplete(true);
            setShowPaymentDisplay(false);
            setPaymentInfo(null);
            setCurrentTransaction(null);
            setIsIdle(true);
            
            // Show "Transaction Complete" for 3 seconds, then return to ads
            setTimeout(() => {
              setTransactionComplete(false);
              console.log('🔄 CustomerDisplayFullscreen: Returning to full-screen ads');
            }, 3000);
            
            // Clear the completion flag after a delay
            setTimeout(() => {
              localStorage.removeItem('tavari_customer_display_sale_complete');
              console.log('🧹 CustomerDisplayFullscreen: Sale completion data cleared');
            }, 5000);
          }
        }
      } catch (error) {
        console.error('❌ CustomerDisplayFullscreen: Error checking sale completion:', error);
      }
    };

    // Check for receipt screen navigation to reset to ads
    const checkReceiptNavigation = () => {
      try {
        const receiptNavigationData = localStorage.getItem('tavari_customer_display_receipt_navigation');
        if (receiptNavigationData) {
          const navData = JSON.parse(receiptNavigationData);
          console.log('📄 CustomerDisplayFullscreen: Receipt navigation detected:', navData);
          
          if (navData.navigated) {
            // Reset everything back to ad mode
            setTransactionComplete(false);
            setShowPaymentDisplay(false);
            setPaymentInfo(null);
            setCurrentTransaction(null);
            setIsIdle(true);
            
            // Clear the navigation flag
            localStorage.removeItem('tavari_customer_display_receipt_navigation');
            console.log('🔄 CustomerDisplayFullscreen: Reset to full-screen ad mode');
          }
        }
      } catch (error) {
        console.error('❌ CustomerDisplayFullscreen: Error checking receipt navigation:', error);
      }
    };

    // Check immediately
    checkSaleCompletion();
    checkReceiptNavigation();

    // Listen for localStorage changes
    const handleSaleCompletionChange = (e) => {
      if (e.key === 'tavari_customer_display_sale_complete') {
        console.log('✅ CustomerDisplayFullscreen: Sale completion storage change detected');
        checkSaleCompletion();
      } else if (e.key === 'tavari_customer_display_receipt_navigation') {
        console.log('📄 CustomerDisplayFullscreen: Receipt navigation storage change detected');
        checkReceiptNavigation();
      }
    };

    console.log('🎧 CustomerDisplayFullscreen: Setting up sale completion localStorage listener');
    window.addEventListener('storage', handleSaleCompletionChange);
    
    // Also check periodically as backup
    const saleCompletionInterval = setInterval(() => {
      checkSaleCompletion();
      checkReceiptNavigation();
    }, 2000);
    console.log('✅ CustomerDisplayFullscreen: Sale completion monitoring set up successfully');

    return () => {
      console.log('🧹 CustomerDisplayFullscreen: Cleaning up sale completion monitoring');
      window.removeEventListener('storage', handleSaleCompletionChange);
      clearInterval(saleCompletionInterval);
    };
  }, []);

  useEffect(() => {
    setCurrentIdleAdIndex((i) => {
      if (idleAds.length === 0) return 0;
      return i % idleAds.length;
    });
  }, [idleAds.length]);

  useEffect(() => {
    setCurrentTransactionAdIndex((i) => {
      if (transactionAds.length === 0) return 0;
      return i % transactionAds.length;
    });
  }, [transactionAds.length]);

  // Rotate idle ads when idle (per-ad display_duration from POS Display Ads, 2–60s)
  useEffect(() => {
    if (!isIdle || idleAds.length === 0) return undefined;
    const ad = idleAds[currentIdleAdIndex];
    const sec = Math.min(60, Math.max(2, Number(ad?.display_duration) || 5));
    const t = window.setTimeout(() => {
      setCurrentIdleAdIndex((prev) => {
        const list = idleAdsRef.current;
        if (list.length === 0) return 0;
        return (prev + 1) % list.length;
      });
    }, sec * 1000);
    return () => clearTimeout(t);
  }, [isIdle, idleAds, currentIdleAdIndex]);

  // Rotate transaction-side ads during cart / payment
  useEffect(() => {
    if (isIdle || transactionAds.length === 0) return undefined;
    const ad = transactionAds[currentTransactionAdIndex];
    const sec = Math.min(60, Math.max(2, Number(ad?.display_duration) || 5));
    const t = window.setTimeout(() => {
      setCurrentTransactionAdIndex((prev) => {
        const list = transactionAdsRef.current;
        if (list.length === 0) return 0;
        return (prev + 1) % list.length;
      });
    }, sec * 1000);
    return () => clearTimeout(t);
  }, [isIdle, transactionAds, currentTransactionAdIndex]);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD'
    }).format(amount);
  };

  const calculateSubtotal = () => {
    if (!currentTransaction?.items) return 0;
    return currentTransaction.items.reduce((total, item) => {
      return total + getPosLineSubtotal(item);
    }, 0);
  };

  const calculateTax = () => {
    // Simple tax calculation - use 13% HST for Ontario
    const subtotal = calculateSubtotal();
    const tax = subtotal * 0.13;
    return tax;
  };

  const calculateTotal = () => {
    return calculateSubtotal() + calculateTax();
  };

  idleAdsRef.current = idleAds;
  transactionAdsRef.current = transactionAds;

  if (isLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>
          <div style={styles.loadingSpinner}></div>
          <div style={styles.loadingText}>Loading...</div>
        </div>
      </div>
    );
  }

  return (
      <div 
        className="customer-display-fullscreen"
        style={{
          ...styles.container,
          ...(showStaffBrowserHint ? { paddingTop: 'max(52px, env(safe-area-inset-top, 0px))' } : {}),
          ...(electronMissingSyncToken ? { paddingBottom: 'max(88px, env(safe-area-inset-bottom, 0px))' } : {})
        }}
      >
      {showStaffBrowserHint && (
        <div style={styles.staffBrowserHint} role="status">
          <span style={styles.staffBrowserHintText}>
            This is a normal browser window—staff can close it by mistake. For the customer-facing screen, run the{' '}
            <strong>Tavari Customer Display</strong> desktop app on that monitor (no title bar or close button). Quit the app with{' '}
            <strong>Ctrl+Shift+Q</strong> when needed.
          </span>
          <button type="button" style={styles.staffBrowserHintDismiss} onClick={dismissStaffBrowserHint}>
            Dismiss
          </button>
        </div>
      )}
      {electronMissingSyncToken && (
        <div style={styles.electronSyncHint} role="alert">
          <strong>Setup required</strong> — Close this window and use the <strong>Connect this screen</strong> dialog
          that appeared when you opened the app. On the <strong>register</strong>, go to{' '}
          <strong>POS → Customer display</strong>, download the Windows app, then enter the <strong>6-digit code</strong>{' '}
          shown on that page. If you do not see the pairing window, restart the customer display app.
        </div>
      )}
      <div style={styles.mainStage}>
      {isIdle ? (
        // Full Ad Display Mode (when no transaction)
        <div style={styles.adContainer}>
          {idleAds.length > 0 ? (
            <div style={styles.adImageContainer}>
              <img 
                src={idleAds[currentIdleAdIndex]?.image_url} 
                alt={idleAds[currentIdleAdIndex]?.title}
                style={styles.adImage}
              />
            </div>
          ) : (
            <div style={styles.noAds}>
              <h2 style={styles.noAdsTitle}>Welcome!</h2>
              <p style={styles.noAdsText}>Thank you for your business</p>
            </div>
          )}
        </div>
      ) : (
        // Split Screen Mode (transaction + ads) — no page scroll; content fits viewport
        <div style={styles.splitScreenContainer}>
          {/* Left Side - Transaction Display */}
          <div style={styles.transactionPanel}>
            <div style={styles.transactionHeader}>
              <h1 style={styles.transactionTitle}>Your Order</h1>
              <div style={styles.transactionId}>
                Order #{currentTransaction?.id?.slice(-6)}
              </div>
              <div style={styles.transactionTime}>
                {new Date(currentTransaction?.created_at).toLocaleTimeString()}
              </div>
            </div>

            <div style={styles.transactionBody}>
              <div
                style={{
                  ...styles.cartSection,
                  ...(showPaymentDisplay && paymentInfo ? styles.cartSectionWithPayment : null)
                }}
              >
                <div
                  style={
                    currentTransaction?.items && currentTransaction.items.length > 0
                      ? {
                          ...styles.itemsArea,
                          display: 'grid',
                          gridTemplateRows: `repeat(${currentTransaction.items.length}, minmax(0, 1fr))`
                        }
                      : styles.itemsAreaEmpty
                  }
                >
                  {currentTransaction?.items && currentTransaction.items.length > 0 ? (
                    currentTransaction.items.map((item, index) => (
                      <div key={index} style={styles.itemRow}>
                        <div style={styles.itemInfo}>
                          <div style={styles.itemName}>{item.name}</div>
                          <div style={styles.itemDetails}>
                            {item.quantity} × {formatCurrency(getPosLineUnitPrice(item))}
                          </div>
                          {item.description && (
                            <div style={styles.itemDescription}>{item.description}</div>
                          )}
                        </div>
                        <div style={styles.itemTotal}>
                          {formatCurrency(getPosLineSubtotal(item))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={styles.emptyCart}>
                      <div style={styles.emptyCartIcon}>🛒</div>
                      <div style={styles.emptyCartText}>Your order is being prepared...</div>
                    </div>
                  )}
                </div>

                {currentTransaction?.items && currentTransaction.items.length > 0 && (
                  <div style={styles.totalsContainer}>
                    <div style={styles.totalRow}>
                      <span style={styles.totalLabel}>Subtotal:</span>
                      <span style={styles.totalValue}>{formatCurrency(calculateSubtotal())}</span>
                    </div>
                    <div style={styles.totalRow}>
                      <span style={styles.totalLabel}>Tax:</span>
                      <span style={styles.totalValue}>{formatCurrency(calculateTax())}</span>
                    </div>
                    <div style={styles.totalRowFinal}>
                      <span style={styles.totalLabelFinal}>Total:</span>
                      <span style={styles.totalValueFinal}>{formatCurrency(calculateTotal())}</span>
                    </div>
                  </div>
                )}
              </div>

              <div style={styles.transactionFooterSlot}>
              {/* Transaction Complete Display */}
              {transactionComplete ? (
                <div style={styles.transactionCompleteContainer}>
                  <div style={styles.transactionCompleteIcon}>✅</div>
                  <div style={styles.transactionCompleteTitle}>Transaction Complete</div>
                  <div style={styles.transactionCompleteMessage}>Thank you for your business!</div>
                  <div style={styles.transactionCompleteSubtext}>
                    Please take your receipt and have a great day!
                  </div>
                </div>
              ) : showPaymentDisplay && paymentInfo ? (
              <div style={styles.paymentInfoContainer}>
                <div style={styles.paymentInfoHeader}>
                  <h3 style={styles.paymentInfoTitle}>Payment Processing</h3>
                  <div style={styles.paymentMethodDisplay}>
                    {paymentInfo.method === 'cash' && '💵 Cash Payment'}
                    {paymentInfo.method === 'card' && '💳 Card Payment'}
                    {paymentInfo.method === 'helcim' && '📱 Helcim QR Payment'}
                    {paymentInfo.method === 'gift_card' && '🎁 Gift Card'}
                    {paymentInfo.method === 'loyalty_credit' && '⭐ Loyalty Credit'}
                    {paymentInfo.method === 'custom' && '⚙️ Custom Payment'}
                  </div>
                </div>

                <div style={styles.paymentInfoDetails}>
                  <div style={styles.paymentInfoRow}>
                    <span style={styles.paymentInfoLabel}>Amount Paid:</span>
                    <span style={styles.paymentInfoValue}>{formatCurrency(paymentInfo.amount)}</span>
                  </div>

                  {paymentInfo.change && paymentInfo.change > 0 && (
                    <div style={styles.paymentInfoRow}>
                      <span style={styles.paymentInfoLabel}>Change Due:</span>
                      <span style={styles.paymentInfoValue}>{formatCurrency(paymentInfo.change)}</span>
                    </div>
                  )}

                  {paymentInfo.status === 'processing' && (
                    <div style={styles.paymentStatusContainer}>
                      <div style={styles.paymentSpinner}></div>
                      <div style={styles.paymentStatusText}>
                        {paymentInfo.method === 'card' ? 'Please use your card on the terminal' : 'Processing payment...'}
                      </div>
                    </div>
                  )}

                  {paymentInfo.status === 'success' && (
                    <div style={styles.paymentSuccessContainer}>
                      <div style={styles.paymentSuccessIcon}>✅</div>
                      <div style={styles.paymentSuccessText}>Payment Successful!</div>
                    </div>
                  )}

                  {paymentInfo.status === 'error' && (
                    <div style={styles.paymentErrorContainer}>
                      <div style={styles.paymentErrorIcon}>❌</div>
                      <div style={styles.paymentErrorText}>Payment Failed</div>
                      <div style={styles.paymentErrorSubtext}>Please try again</div>
                    </div>
                  )}
                </div>

                {paymentInfo.method === 'card' && paymentInfo.status === 'processing' && (
                  <div style={styles.cardInstructionsContainer}>
                    <div style={styles.cardInstructionTitle}>Card Payment Instructions:</div>
                    <div style={styles.cardInstructionList}>
                      <div style={styles.cardInstructionItem}>• Insert, tap, or swipe your card</div>
                      <div style={styles.cardInstructionItem}>• Follow the prompts on the terminal</div>
                      <div style={styles.cardInstructionItem}>• Wait for approval</div>
                    </div>
                  </div>
                )}

                {paymentInfo.method === 'helcim' && paymentInfo.status === 'processing' && (
                  <div style={styles.qrInstructionsContainer}>
                    <div style={styles.qrInstructionTitle}>QR Payment Instructions:</div>
                    <div style={styles.qrInstructionList}>
                      <div style={styles.qrInstructionItem}>• Scan the QR code with your phone</div>
                      <div style={styles.qrInstructionItem}>• Complete payment in your banking app</div>
                      <div style={styles.qrInstructionItem}>• Wait for confirmation</div>
                    </div>
                  </div>
                )}
              </div>
              ) : (
                <div style={styles.statusContainer}>
                  <div style={styles.statusIcon}>
                    {currentTransaction?.status === 'active' ? '⏳' : '✅'}
                  </div>
                  <div style={styles.statusText}>
                    {currentTransaction?.status === 'active' ? 'Processing your order...' : 'Order complete!'}
                  </div>
                  {currentTransaction?.status === 'active' && (
                    <div style={styles.statusSubtext}>
                      Please wait while we prepare your items
                    </div>
                  )}
                </div>
              )}
              </div>
            </div>
          </div>

          {/* Right Side - Transaction Ad Display */}
          <div style={styles.adPanel}>
            {transactionAds.length > 0 ? (
              <div style={styles.transactionAdImageContainer}>
                <img 
                  src={transactionAds[currentTransactionAdIndex]?.image_url} 
                  alt={transactionAds[currentTransactionAdIndex]?.title}
                  style={styles.transactionAdImage}
                />
                <div style={styles.adOverlay}>
                  <h3 style={styles.adTitle}>{transactionAds[currentTransactionAdIndex]?.title}</h3>
                  {transactionAds[currentTransactionAdIndex]?.description && (
                    <p style={styles.adDescription}>{transactionAds[currentTransactionAdIndex]?.description}</p>
                  )}
                  {transactionAds[currentTransactionAdIndex]?.promo_code && (
                    <div style={styles.promoCode}>
                      Code: {transactionAds[currentTransactionAdIndex]?.promo_code}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={styles.noAds}>
                <h2 style={styles.noAdsTitle}>Welcome!</h2>
                <p style={styles.noAdsText}>Thank you for your business</p>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

const styles = {
  staffBrowserHint: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2147483646,
    backgroundColor: 'rgba(140, 75, 0, 0.97)',
    color: '#fff',
    padding: '10px 14px',
    fontSize: '14px',
    lineHeight: 1.35,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    boxSizing: 'border-box',
    boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
  },
  staffBrowserHintText: {
    flex: 1,
    minWidth: 0,
  },
  staffBrowserHintDismiss: {
    flexShrink: 0,
    background: 'rgba(0,0,0,0.35)',
    border: '1px solid rgba(255,255,255,0.35)',
    color: '#fff',
    padding: '8px 14px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
  },
  electronSyncHint: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 2147483645,
    backgroundColor: 'rgba(20, 40, 90, 0.96)',
    color: '#e8eefc',
    padding: '14px 18px',
    fontSize: '15px',
    lineHeight: 1.4,
    boxSizing: 'border-box',
    boxShadow: '0 -2px 10px rgba(0,0,0,0.35)',
  },
  container: {
    width: '100%',
    maxWidth: '100vw',
    height: '100dvh',
    maxHeight: '100dvh',
    minHeight: '100vh', /* fallback for older engines */
    backgroundColor: '#1a1a1a',
    color: 'white',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'Arial, sans-serif',
    overflow: 'hidden',
    position: 'fixed',
    top: 0,
    left: 0,
    zIndex: 999999, // ULTRA HIGH z-index to ensure it appears in front of ANY modals
    margin: 0,
    padding: 0,
    boxSizing: 'border-box',
    border: 'none',
    outline: 'none',
    visibility: 'visible !important',
    opacity: '1 !important',
    pointerEvents: 'auto !important',
  },
  /** Fills viewport under optional fixed hints; no document scroll */
  mainStage: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: '20px',
  },
  loadingSpinner: {
    width: '50px',
    height: '50px',
    border: '4px solid #333',
    borderTop: '4px solid #fff',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  loadingText: {
    fontSize: '24px',
    color: '#ccc',
  },
  // Ad Display Styles
  adContainer: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  adImageContainer: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  adImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: 'center',
  },
  noAds: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    backgroundColor: '#1a1a1a',
  },
  noAdsTitle: {
    fontSize: '64px',
    fontWeight: 'bold',
    marginBottom: '30px',
    color: '#fff',
  },
  noAdsText: {
    fontSize: '33px',
    color: '#ccc',
  },
  // Transaction Display Styles
  // Split Screen Layout
  splitScreenContainer: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
    width: '100%',
    overflow: 'hidden',
  },
  transactionPanel: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    padding: 'clamp(8px, 1.5vh, 22px) clamp(10px, 1.2vw, 18px)',
    backgroundColor: '#1a1a1a',
    color: 'white',
    display: 'flex',
    flexDirection: 'column',
    borderRight: '2px solid #333',
    overflow: 'hidden',
  },
  adPanel: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: '#000',
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  transactionBody: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  /** Line items + totals; shrinks when payment UI is shown so the column stays on-screen */
  cartSection: {
    flex: '1 1 0%',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  cartSectionWithPayment: {
    flex: '0 1 48%',
    maxHeight: '48%',
  },
  transactionFooterSlot: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  itemsArea: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    gap: 'clamp(2px, 0.5vh, 8px)',
    width: '100%',
  },
  itemsAreaEmpty: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  splitAdImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: 'center',
  },
  adOverlay: {
    position: 'absolute',
    bottom: '0',
    left: '0',
    right: '0',
    background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
    padding: '20px',
    color: 'white',
  },
  adTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    margin: '0 0 10px 0',
  },
  adDescription: {
    fontSize: '16px',
    margin: '0 0 15px 0',
    opacity: 0.9,
  },
  promoCode: {
    backgroundColor: '#008080',
    color: 'white',
    padding: '8px 16px',
    borderRadius: '20px',
    fontSize: '14px',
    fontWeight: 'bold',
    display: 'inline-block',
  },
  transactionContainer: {
    padding: '40px',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
  transactionHeader: {
    textAlign: 'center',
    marginBottom: 'clamp(6px, 1vh, 16px)',
    flexShrink: 0,
  },
  transactionTitle: {
    fontSize: 'clamp(22px, 4vmin, 42px)',
    fontWeight: 'bold',
    marginBottom: '4px',
    color: '#fff',
    lineHeight: 1.15,
  },
  transactionId: {
    fontSize: 'clamp(14px, 2vmin, 22px)',
    color: '#ccc',
  },
  transactionTime: {
    fontSize: 'clamp(12px, 1.6vmin, 16px)',
    color: '#999',
    marginTop: '2px',
  },
  itemsContainer: {
    flex: 1,
    minHeight: 0,
    marginBottom: 0,
    overflow: 'hidden',
  },
  itemRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 0,
    overflow: 'hidden',
    padding: 'clamp(4px, 0.7vh, 12px) 0',
    borderBottom: '1px solid #333',
    fontSize: 'clamp(13px, 2vmin, 22px)',
    gap: '8px',
  },
  itemInfo: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
  },
  itemName: {
    fontWeight: 'bold',
    marginBottom: '2px',
    color: '#fff',
    fontSize: 'clamp(12px, 1.9vmin, 20px)',
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    wordBreak: 'break-word',
    lineHeight: 1.2,
  },
  itemDetails: {
    color: '#ccc',
    fontSize: 'clamp(11px, 1.5vmin, 17px)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  itemDescription: {
    color: '#999',
    fontSize: 'clamp(10px, 1.3vmin, 14px)',
    marginTop: '2px',
    fontStyle: 'italic',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  emptyCart: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 0,
    color: '#999',
    padding: '8px',
    textAlign: 'center',
  },
  emptyCartIcon: {
    fontSize: 'clamp(28px, 5vmin, 44px)',
    marginBottom: 'clamp(6px, 1vh, 14px)',
  },
  emptyCartText: {
    fontSize: 'clamp(14px, 2.2vmin, 22px)',
    textAlign: 'center',
    lineHeight: 1.3,
  },
  itemTotal: {
    fontWeight: 'bold',
    color: '#fff',
    flexShrink: 0,
    fontSize: 'clamp(12px, 1.9vmin, 20px)',
  },
  totalsContainer: {
    borderTop: '2px solid #444',
    paddingTop: 'clamp(6px, 1vh, 14px)',
    flexShrink: 0,
  },
  totalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: 'clamp(4px, 0.7vh, 10px) 0',
    fontSize: 'clamp(14px, 2vmin, 22px)',
  },
  totalRowFinal: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: 'clamp(6px, 0.9vh, 14px) 0',
    fontSize: 'clamp(16px, 2.4vmin, 28px)',
    fontWeight: 'bold',
    borderTop: '2px solid #666',
    marginTop: '6px',
  },
  totalLabel: {
    color: '#ccc',
  },
  totalLabelFinal: {
    color: '#fff',
  },
  totalValue: {
    color: '#fff',
  },
  totalValueFinal: {
    color: '#4ade80',
  },
  statusContainer: {
    textAlign: 'center',
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    padding: '8px',
  },
  statusIcon: {
    fontSize: 'clamp(32px, 5vmin, 48px)',
    marginBottom: 'clamp(8px, 1.2vh, 16px)',
  },
  statusText: {
    fontSize: 'clamp(16px, 2.4vmin, 26px)',
    color: '#4ade80',
    fontWeight: 'bold',
    marginBottom: '6px',
    lineHeight: 1.2,
  },
  statusSubtext: {
    fontSize: 'clamp(12px, 1.8vmin, 17px)',
    color: '#999',
    fontStyle: 'italic',
    lineHeight: 1.25,
  },
  // Inline Payment Display Styles
  paymentInfoContainer: {
    backgroundColor: '#f8f9fa',
    borderRadius: 'clamp(8px, 1.2vh, 14px)',
    padding: 'clamp(10px, 1.4vh, 18px)',
    marginTop: 'clamp(4px, 0.8vh, 12px)',
    border: '2px solid #e9ecef',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    color: '#333',
  },
  paymentInfoHeader: {
    textAlign: 'center',
    marginBottom: 'clamp(6px, 1vh, 12px)',
    flexShrink: 0,
  },
  paymentInfoTitle: {
    fontSize: 'clamp(16px, 2.2vmin, 22px)',
    fontWeight: 'bold',
    color: '#333',
    margin: '0 0 6px 0',
    lineHeight: 1.2,
  },
  paymentMethodDisplay: {
    fontSize: 'clamp(13px, 1.8vmin, 18px)',
    color: '#666',
    fontWeight: '500',
    lineHeight: 1.25,
  },
  paymentInfoDetails: {
    marginBottom: 0,
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  paymentInfoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 'clamp(6px, 0.9vh, 12px) 0',
    borderBottom: '1px solid #dee2e6',
    fontSize: 'clamp(13px, 1.7vmin, 17px)',
    flexShrink: 0,
  },
  paymentInfoLabel: {
    color: '#666',
    fontWeight: '500',
  },
  paymentInfoValue: {
    fontSize: 'clamp(14px, 2vmin, 19px)',
    fontWeight: 'bold',
    color: '#333',
  },
  paymentStatusContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: 'clamp(8px, 1.2vh, 14px) 0',
    flexShrink: 0,
  },
  paymentSpinner: {
    width: '30px',
    height: '30px',
    border: '3px solid #f3f3f3',
    borderTop: '3px solid #007bff',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '15px',
  },
  paymentStatusText: {
    fontSize: 'clamp(12px, 1.6vmin, 15px)',
    color: '#666',
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 1.25,
  },
  paymentSuccessContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: 'clamp(8px, 1.2vh, 14px) 0',
    backgroundColor: '#e8f5e8',
    borderRadius: '8px',
    marginTop: '6px',
    flexShrink: 0,
  },
  paymentSuccessIcon: {
    fontSize: 'clamp(24px, 4vmin, 34px)',
    marginBottom: '6px',
  },
  paymentSuccessText: {
    fontSize: 'clamp(14px, 2vmin, 17px)',
    fontWeight: 'bold',
    color: '#28a745',
  },
  paymentErrorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: 'clamp(8px, 1.2vh, 14px) 0',
    backgroundColor: '#f8d7da',
    borderRadius: '8px',
    marginTop: '6px',
    flexShrink: 0,
  },
  paymentErrorIcon: {
    fontSize: 'clamp(24px, 4vmin, 34px)',
    marginBottom: '6px',
  },
  paymentErrorText: {
    fontSize: 'clamp(14px, 2vmin, 17px)',
    fontWeight: 'bold',
    color: '#dc3545',
    marginBottom: '4px',
  },
  paymentErrorSubtext: {
    fontSize: 'clamp(11px, 1.4vmin, 13px)',
    color: '#721c24',
  },
  cardInstructionsContainer: {
    backgroundColor: '#f8f9fa',
    padding: 'clamp(8px, 1.1vh, 12px)',
    borderRadius: '8px',
    marginTop: '8px',
    flexShrink: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  cardInstructionTitle: {
    fontSize: 'clamp(12px, 1.6vmin, 15px)',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '6px',
  },
  cardInstructionList: {
    textAlign: 'left',
  },
  cardInstructionItem: {
    fontSize: 'clamp(11px, 1.4vmin, 13px)',
    color: '#666',
    marginBottom: '3px',
    paddingLeft: '8px',
    lineHeight: 1.25,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  qrInstructionsContainer: {
    backgroundColor: '#e3f2fd',
    padding: 'clamp(8px, 1.1vh, 12px)',
    borderRadius: '8px',
    marginTop: '8px',
    flexShrink: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  qrInstructionTitle: {
    fontSize: 'clamp(12px, 1.6vmin, 15px)',
    fontWeight: 'bold',
    color: '#1976d2',
    marginBottom: '6px',
  },
  qrInstructionList: {
    textAlign: 'left',
  },
  qrInstructionItem: {
    fontSize: 'clamp(11px, 1.4vmin, 13px)',
    color: '#1976d2',
    marginBottom: '3px',
    paddingLeft: '8px',
    lineHeight: 1.25,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  // Transaction Complete Styles
  transactionCompleteContainer: {
    backgroundColor: '#e8f5e8',
    borderRadius: 'clamp(8px, 1.2vh, 14px)',
    padding: 'clamp(12px, 2vh, 24px) clamp(12px, 1.5vw, 20px)',
    marginTop: 'clamp(4px, 0.8vh, 12px)',
    border: '2px solid #28a745',
    textAlign: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  transactionCompleteIcon: {
    fontSize: 'clamp(36px, 6vmin, 56px)',
    marginBottom: 'clamp(8px, 1.2vh, 14px)',
  },
  transactionCompleteTitle: {
    fontSize: 'clamp(16px, 2.4vmin, 24px)',
    fontWeight: 'bold',
    color: '#28a745',
    marginBottom: '8px',
    lineHeight: 1.2,
  },
  transactionCompleteMessage: {
    fontSize: 'clamp(14px, 2vmin, 20px)',
    color: '#333',
    marginBottom: '6px',
    fontWeight: '500',
    lineHeight: 1.25,
  },
  transactionCompleteSubtext: {
    fontSize: 'clamp(12px, 1.6vmin, 15px)',
    color: '#666',
    fontStyle: 'italic',
    lineHeight: 1.25,
  },

  // Transaction Ad Styles (half-width, same height)
  transactionAdImageContainer: {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  transactionAdImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: 'center',
  },
};

export default CustomerDisplayFullscreen;
