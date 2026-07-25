// screens/POS/POSRegister.jsx - Production Ready with Permissions & Security
import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import POSProductGrid from "../../components/POS/POSProductGrid";
import POSCartPanel from "../../components/POS/POSCartPanel";
// SessionLockModal removed - causing random lockouts that users cannot unlock
import BarcodeScanHandler from "../../components/POS/BarcodeScanHandler";
import POSDrawerComponent from "../../components/POS/POSDrawerComponent";
import POSAuthWrapper from "../../components/Auth/POSAuthWrapper";
import PinModal from "../../components/POS/POSRegisterComponents/PinModal";
import RegisterHeader from "../../components/POS/POSRegisterComponents/RegisterHeader";
import SaveCartModal from "../../components/POS/POSRegisterComponents/SaveCartModal";
import CategorySelector from "../../components/POS/POSRegisterComponents/CategorySelector";
import { useSessionLock } from "../../hooks/useSessionLock";
import { usePOSAuth } from "../../hooks/usePOSAuth";
import { useModuleEnabled } from "../../hooks/useModuleEnabled";
import { usePermissions } from "../../hooks/usePermissions";
import { useTaxCalculations } from "../../hooks/useTaxCalculations";
import { useAuditLog } from "../../hooks/useAuditLog";
import { SecurityWrapper, useSecurityContext } from "../../Security";
import { TavariStyles } from "../../utils/TavariStyles";
import dayjs from "dayjs";
import { supabase } from "../../supabaseClient";
import bcrypt from "bcryptjs";
import { flushCustomerDisplayMirrorPush } from "../../services/customerDisplayMirrorSync";
import { fetchPosSettingsForTerminal } from "../../utils/posSettingsQuery";
import { syncRegisterStationFromDb } from "../../services/posRegisterStationsService";
import {
  clearCustomerDisplayPaymentLocalAndMirror,
  setCustomerDisplayPosLocked
} from "../../services/customerDisplayLocalState";
import {
  buildRegisterNavigationState,
  clearPosActiveUserOnRegisterLock,
  consumePendingRegisterLock,
} from "../../utils/posRegisterLock";
import { getPosLineSubtotal, getPosLineUnitPrice } from "../../utils/posLinePricing";

const getBusinessLocalDateString = (timeZone = 'America/Toronto') => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  const yyyy = get('year');
  const mm = get('month').padStart(2, '0');
  const dd = get('day').padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const POSRegister = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Authentication
  // Allow any logged-in employee to access the register
  // The register unlock system will handle permission checks via PIN
  const auth = usePOSAuth({
    requiredRoles: null, // Allow any logged-in user - unlock system handles permissions
    requireBusiness: true,
    componentName: 'POSRegister'
  });

  // Security context
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'POSRegister',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Permission system
  const {
    hasPermission,
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading
  } = usePermissions();

  // Permission checks
  const canOperateRegister = hasAnyPermission([
    'pos.register.operate',
    'pos.sales.create'
  ]) || hasElevatedPrivileges();

  const canAccessDrawer = hasPermission('pos.drawer.access') || hasElevatedPrivileges();
  const canSaveCart = hasPermission('pos.cart.save') || hasElevatedPrivileges();
  const canViewRefunds = hasPermission('pos.refunds.view') || hasElevatedPrivileges();
  const canManageTabs = hasPermission('pos.tabs.manage') || hasElevatedPrivileges();
  const canAttachCustomer = hasPermission('pos.loyalty.attach') || hasElevatedPrivileges();

  // Audit logging
  const { logPOS, logSecurity } = useAuditLog();

  // Tax calculations
  const {
    taxCategories,
    categoryTaxAssignments,
    calculateTotalTax
  } = useTaxCalculations(auth.selectedBusinessId);
  const { isEnabled: waiversModuleEnabled } = useModuleEnabled('waivers');

  // Register PIN lock (startup / after sale / pin_required) — idle lock is app-wide in App.jsx
  const [registerLocked, setRegisterLocked] = useState(false);
  const [currentTerminalId, setCurrentTerminalId] = useState(null);
  
  /** Register PIN lock: paired customer display shows full-screen ads while register is locked */
  useEffect(() => {
    setCustomerDisplayPosLocked(registerLocked);
    if (auth.selectedBusinessId) {
      flushCustomerDisplayMirrorPush(auth.selectedBusinessId);
    }
  }, [registerLocked, auth.selectedBusinessId]);
  
  // Legacy session lock variables (for compatibility with other code)
  const isLocked = registerLocked;
  const warningSeconds = null;
  const pinAttempts = 0;
  const lockedUntil = null;
  const unlockWithPin = async () => ({ ok: false });
  const managerOverride = async () => false;
  const isOverrideActive = () => false;

  // App state
  const [businessName, setBusinessName] = useState("");
  const [businessTimeZone, setBusinessTimeZone] = useState("America/Toronto");
  const [employeeName, setEmployeeName] = useState("");
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [activeCategory, setActiveCategory] = useState(null);
  const [cartItems, setCartItems] = useState([]);
  const [time, setTime] = useState(dayjs().format("hh:mm A"));
  
  // Drawer management
  const [showDrawerManager, setShowDrawerManager] = useState(false);
  // currentTerminalId moved above to fix initialization order
  
  // PIN unlock state (registerLocked moved above to fix initialization order)
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinSwitchMode, setPinSwitchMode] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [currentUnlockingUser, setCurrentUnlockingUser] = useState(null);
  const [posSettings, setPosSettings] = useState({
    pin_required: false,
    lock_on_startup: false,
    lock_after_sale: false
  });
  const [indianStatusGstRate, setIndianStatusGstRate] = useState(0.05);
  const [indianStatusTaxLabel, setIndianStatusTaxLabel] = useState('GST (Indian Status)');
  const [indianStatusGstOnly, setIndianStatusGstOnly] = useState(false);
  const [indianStatusCertificateNumber, setIndianStatusCertificateNumber] = useState('');
  
  // Loyalty state
  const [currentCustomer, setCurrentCustomer] = useState(null);
  /** Adults with loyalty accounts on this party (e.g. from waiver → POS) for switching earn target. */
  const [loyaltyCandidates, setLoyaltyCandidates] = useState([]);
  
  // Cart state
  const [cartInitialized, setCartInitialized] = useState(false);
  const [savedCartId, setSavedCartId] = useState(null);
  const [isFromSavedCarts, setIsFromSavedCarts] = useState(false);
  const [businessSettings, setBusinessSettings] = useState({});
  const [nameOfDayPromo, setNameOfDayPromo] = useState(null);

  // Tab state
  const [activeTab, setActiveTab] = useState(null);
  const [isTabMode, setIsTabMode] = useState(false);
  const [tabItems, setTabItems] = useState([]);

  // Modal state
  const [showSaveCartModal, setShowSaveCartModal] = useState(false);

  // Add custom item (e.g. birthday party balance) - name and price only, not in inventory
  const handleAddCustomItem = (payload) => {
    if (isLocked || registerLocked || !canOperateRegister) return;
    if (isTabMode) {
      showToast('Custom items are not available in tab mode', 'error');
      return;
    }
    const name = (payload?.name || '').trim();
    const price = parseFloat(payload?.price);
    if (!name) {
      showToast('Please enter a name for the custom item', 'error');
      return;
    }
    if (Number.isNaN(price) || price < 0) {
      showToast('Please enter a valid price', 'error');
      return;
    }
    const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const taxIncluded = payload.tax_included !== false;
    const customItem = {
      id,
      name,
      price,
      quantity: 1,
      modifiers: [],
      category_id: null,
      is_custom: true,
      tax_included: taxIncluded
    };
    setCartItems((prev) => {
      const next = [...prev, customItem];
      const cartData = {
        cartItems: next,
        businessId: auth.selectedBusinessId,
        timestamp: Date.now()
      };
      localStorage.setItem('tavari_customer_display_cart', JSON.stringify(cartData));
      clearCustomerDisplayPaymentLocalAndMirror(auth.selectedBusinessId);
      window.dispatchEvent(new CustomEvent('tavari-cart-update', { detail: cartData }));
      return next;
    });
    logPOS('custom_item_added', { name, price, terminal_id: currentTerminalId });
  };

  const handleUpdateCustomItem = (itemId, { name: newName, price: newPrice, tax_included: newTaxIncluded }) => {
    if (isLocked || registerLocked || !canOperateRegister) return;
    const name = (newName ?? '').trim();
    const price = parseFloat(newPrice);
    if (!name || Number.isNaN(price) || price < 0) return;
    const taxIncluded = newTaxIncluded !== false;
    setCartItems((prev) => {
      const next = prev.map((item) =>
        item.id === itemId ? { ...item, name, price, tax_included: taxIncluded } : item
      );
      const cartData = {
        cartItems: next,
        businessId: auth.selectedBusinessId,
        timestamp: Date.now()
      };
      localStorage.setItem('tavari_customer_display_cart', JSON.stringify(cartData));
      clearCustomerDisplayPaymentLocalAndMirror(auth.selectedBusinessId);
      window.dispatchEvent(new CustomEvent('tavari-cart-update', { detail: cartData }));
      return next;
    });
    logPOS('custom_item_updated', { item_id: itemId, name, price, terminal_id: currentTerminalId });
  };

  const getActivePosUserFromStorage = () => {
    try {
      const raw = localStorage.getItem('posActiveUser');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  };

  const getLoginPosUserFromStorage = () => {
    try {
      const raw = localStorage.getItem('posLoginUser');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  };

  useEffect(() => {
    const syncActivePosUser = () => {
      const activeUser = getActivePosUserFromStorage();
      const loginUser = getLoginPosUserFromStorage();

      if (loginUser && loginUser.business_id === auth.selectedBusinessId) {
        setEmployeeName(loginUser.name || loginUser.full_name || loginUser.email || 'POS Team Member');
      } else if (auth.authUser) {
        setEmployeeName(auth.authUser.email || 'POS Team Member');
      }

      if (activeUser && activeUser.business_id === auth.selectedBusinessId) {
        setCurrentUnlockingUser(activeUser);
      } else {
        setCurrentUnlockingUser(null);
      }
    };

    syncActivePosUser();

    if (typeof window !== 'undefined') {
      window.addEventListener('pos-active-user-changed', syncActivePosUser);
      const handleStorage = (event) => {
        if (event.key === 'posActiveUser' || event.key === 'posLoginUser') {
          syncActivePosUser();
        }
      };
      window.addEventListener('storage', handleStorage);
      return () => {
        window.removeEventListener('pos-active-user-changed', syncActivePosUser);
        window.removeEventListener('storage', handleStorage);
      };
    }

    return undefined;
  }, [auth.selectedBusinessId]);

  const activePosUser = currentUnlockingUser && currentUnlockingUser.business_id === auth.selectedBusinessId
    ? currentUnlockingUser
    : null;

  const effectiveUserId = activePosUser?.id || auth.authUser?.id || null;
  const effectiveUserName = activePosUser?.name || activePosUser?.full_name || employeeName;

  // Check for lock after sale on mount / return from receipt
  useEffect(() => {
    const shouldLockAfterSale =
      location.state?.shouldLock === true || consumePendingRegisterLock();

    if (!shouldLockAfterSale) return;

    clearPosActiveUserOnRegisterLock();
    setCurrentUnlockingUser(null);
    setRegisterLocked(true);
    setPinSwitchMode(false);
    setShowPinModal(true);

    logSecurityEvent('register_locked_after_sale', {
      terminal_id: currentTerminalId,
      lock_reason: 'sale_completed',
      triggered_by_navigation: true
    }, 'low');

    logPOS('register_locked_after_sale', {
      terminal_id: currentTerminalId,
      lock_reason: 'sale_completed',
      triggered_by_navigation: true
    });

    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state?.shouldLock]);

  // Load terminal ID
  useEffect(() => {
    const storedTerminalId = localStorage.getItem('tavari_terminal_id');
    if (storedTerminalId) {
      setCurrentTerminalId(storedTerminalId);
    } else {
      const terminalId = generateTerminalId();
      setCurrentTerminalId(terminalId);
    }
  }, []);

  useEffect(() => {
    if (!auth.selectedBusinessId || !currentTerminalId) return;
    syncRegisterStationFromDb(auth.selectedBusinessId, currentTerminalId);
  }, [auth.selectedBusinessId, currentTerminalId]);

  // Generate terminal ID
  const generateTerminalId = () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('Terminal fingerprint', 2, 2);
    
    const fingerprint = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      new Date().getTimezoneOffset(),
      canvas.toDataURL()
    ].join('|');
    
    let hash = 0;
    for (let i = 0; i < fingerprint.length; i++) {
      const char = fingerprint.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    const terminalId = `TERM_${Math.abs(hash).toString(36).toUpperCase().substring(0, 8)}`;
    localStorage.setItem('tavari_terminal_id', terminalId);
    return terminalId;
  };

  // Fetch POS settings
  useEffect(() => {
    const fetchPosSettings = async () => {
      if (!auth.selectedBusinessId) return;
      
      try {
        await logSecurityEvent('pos_settings_accessed', {
          action: 'fetch_lock_settings',
          business_id: auth.selectedBusinessId,
          terminal_id: currentTerminalId
        }, 'low');

        const { data, error } = await fetchPosSettingsForTerminal(
          auth.selectedBusinessId,
          currentTerminalId,
          'pin_required, lock_on_startup, lock_after_sale, indian_status_gst_rate, indian_status_tax_label'
        );

        if (error) {
          console.warn('⚠️ POS settings fetch error:', error.message);
        }

        if (data) {
          const settings = {
            pin_required: data.pin_required || false,
            lock_on_startup: data.lock_on_startup || false,
            lock_after_sale: data.lock_after_sale || false
          };
          
          setPosSettings(settings);
          const gstR = parseFloat(data.indian_status_gst_rate);
          setIndianStatusGstRate(Number.isFinite(gstR) && gstR >= 0 ? gstR : 0.05);
          setIndianStatusTaxLabel(
            (data.indian_status_tax_label && String(data.indian_status_tax_label).trim()) ||
              'GST (Indian Status)'
          );
          
          const shouldLock = data.pin_required === true || data.lock_on_startup === true;
          
          if (shouldLock) {
            setRegisterLocked(true);
            setPinSwitchMode(false);
            setShowPinModal(true);
            
            await logSecurityEvent('register_locked_on_startup', {
              terminal_id: currentTerminalId,
              lock_reason: data.pin_required ? 'pin_required' : 'lock_on_startup',
              settings: { pin_required: data.pin_required, lock_on_startup: data.lock_on_startup },
              business_id: auth.selectedBusinessId
            }, 'low');
            
            logPOS('register_locked_on_startup', {
              terminal_id: currentTerminalId,
              lock_reason: data.pin_required ? 'pin_required' : 'lock_on_startup',
              settings: { pin_required: data.pin_required, lock_on_startup: data.lock_on_startup }
            });
          }
        } else {
          setRegisterLocked(true);
          setPinSwitchMode(false);
          setShowPinModal(true);
        }
      } catch (err) {
        await logSecurityEvent('pos_settings_fetch_error', {
          error: err.message,
          business_id: auth.selectedBusinessId,
          terminal_id: currentTerminalId
        }, 'medium');
        
        setRegisterLocked(true);
        setPinSwitchMode(false);
        setShowPinModal(true);
      }
    };

    if (auth.isReady && auth.selectedBusinessId) {
      fetchPosSettings();
    }
  }, [auth.isReady, auth.selectedBusinessId, currentTerminalId, logPOS]);

  // PIN unlock handler
  const handlePinUnlock = async () => {
    if (!pinInput || pinInput.length !== 4) {
      setPinError('PIN must be 4 digits');
      return;
    }

    // Rate limiting
    const rateLimitCheck = await checkRateLimit('pin_unlock', 5, 300000);
    if (!rateLimitCheck.allowed) {
      setPinError('Too many unlock attempts. Please wait 5 minutes.');
      await logSecurityEvent('pin_unlock_rate_limited', {
        terminal_id: currentTerminalId,
        business_id: auth.selectedBusinessId
      }, 'high');
      return;
    }

    try {
      console.log('[POSRegister] PIN unlock attempt - checking ALL employees for business, NOT just logged-in user');
      console.log('[POSRegister] Logged-in user ID (for reference only):', effectiveUserId);
      console.log('[POSRegister] Business ID:', auth.selectedBusinessId);
      
      await logSecurityEvent('pin_unlock_attempted', {
        business_id: auth.selectedBusinessId,
        terminal_id: currentTerminalId,
        logged_in_user: effectiveUserId,
        note: 'Register unlock checks ALL employees, not just logged-in user'
      }, 'medium');
      
      console.log('[POSRegister] Using get_all_staff_pins_for_unlock RPC to bypass RLS and get ALL employees');
      console.log('[POSRegister] This RPC uses SECURITY DEFINER to access all employees regardless of logged-in user');
      
      // Use get_all_staff_pins_for_unlock which bypasses RLS using SECURITY DEFINER
      // This allows us to see ALL employees' PINs, not just the logged-in user
      const { data: staffMembers, error: staffError } = await supabase.rpc(
        'get_all_staff_pins_for_unlock',
        { 
          p_business_id: auth.selectedBusinessId
        }
      );

      if (staffError) {
        console.error('[POSRegister] get_staff_pins_for_unlock RPC error:', staffError);
        console.error('[POSRegister] Error details:', {
          message: staffError.message,
          code: staffError.code,
          details: staffError.details,
          hint: staffError.hint
        });
        
        await logSecurityEvent('pin_unlock_staff_error', {
          error: staffError.message,
          error_code: staffError.code,
          business_id: auth.selectedBusinessId
        }, 'high');
        
        setPinError('Error validating PIN. Please try again.');
        return;
      }

      console.log('[POSRegister] get_all_staff_pins_for_unlock RPC result:', {
        staff_count: staffMembers?.length || 0,
        staff_with_pins: staffMembers?.filter(s => s.pin)?.length || 0,
        staff_ids: staffMembers?.map(s => s.id) || [],
        staff_names: staffMembers?.map(s => s.full_name || s.email) || []
      });
      
      if (!staffMembers || staffMembers.length === 0) {
        console.error('[POSRegister] ❌ No staff members returned from RPC - this might be an RLS issue');
        await logSecurityEvent('pin_unlock_no_staff_returned', {
          business_id: auth.selectedBusinessId,
          terminal_id: currentTerminalId
        }, 'high');
        
        setPinError('No staff members found. Please contact support.');
        return;
      }

      let unlockingUser = null;
      let pinMatched = false;
      
      console.log('[POSRegister] Checking PIN against', staffMembers?.length || 0, 'staff members');
      
      for (const staff of staffMembers || []) {
        if (!staff.pin) {
          console.log('[POSRegister] Skipping staff member', staff.id, '- no PIN set');
          continue;
        }
        
        console.log('[POSRegister] Checking PIN for staff member:', {
          id: staff.id,
          name: staff.full_name || staff.email,
          pin_hashed: staff.pin.startsWith('$2b$') || staff.pin.startsWith('$2a$')
        });
        
        if (staff.pin.startsWith('$2b$') || staff.pin.startsWith('$2a$')) {
          const matches = await bcrypt.compare(pinInput, staff.pin);
          if (matches) {
            console.log('[POSRegister] ✅ PIN matched for staff member:', staff.id, staff.full_name || staff.email);
            unlockingUser = staff;
            pinMatched = true;
            break;
          }
        } else {
          const matches = staff.pin === pinInput;
          if (matches) {
            console.log('[POSRegister] ✅ PIN matched (plain text) for staff member:', staff.id, staff.full_name || staff.email);
            unlockingUser = staff;
            pinMatched = true;
            break;
          }
        }
      }
      
      if (!pinMatched) {
        console.log('[POSRegister] ❌ PIN did not match any staff member');
      }

      if (pinMatched && unlockingUser) {
        // The get_all_staff_pins_for_unlock RPC returns the role with each staff member
        const wasSwitchUser = pinSwitchMode;
        const staffRole = unlockingUser.role || 'employee';
        const displayName = unlockingUser.full_name || unlockingUser.email || 'POS Team Member';
        const unlockingUserWithMeta = {
          ...unlockingUser,
          role: staffRole,
          name: displayName,
          business_id: auth.selectedBusinessId,
          unlocked_at: Date.now()
        };

        setRegisterLocked(false);
        setShowPinModal(false);
        setPinSwitchMode(false);
        setPinInput('');
        setPinError('');
        setFailedAttempts(0);
        setCurrentUnlockingUser(unlockingUserWithMeta);
 
        try {
          const activeUserPayload = {
            id: unlockingUser.id,
            role: staffRole,
            full_name: unlockingUser.full_name || null,
            first_name: unlockingUser.first_name || null,
            last_name: unlockingUser.last_name || null,
            email: unlockingUser.email || null,
            name: displayName,
            business_id: auth.selectedBusinessId,
            unlocked_at: Date.now(),
            source: 'register_pin'
          };

          localStorage.setItem('posActiveUser', JSON.stringify(activeUserPayload));
          localStorage.setItem('posLastUnlockedBy', JSON.stringify(activeUserPayload));
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('pos-active-user-changed'));
          }
        } catch (syncError) {
          console.warn('Unable to update active POS user after register unlock:', syncError?.message || syncError);
        }
 
        await logSecurityEvent('register_unlocked', {
          unlocked_by_id: unlockingUser.id,
          unlocked_by_name: unlockingUser.full_name || unlockingUser.email,
          unlock_method: 'pin',
          terminal_id: currentTerminalId,
          previous_failed_attempts: failedAttempts,
          logged_in_user_id: unlockingUser.id,
          business_id: auth.selectedBusinessId
        }, 'medium');

        await logPOS('register_unlocked', {
          unlocked_by_id: unlockingUser.id,
          unlocked_by_name: unlockingUser.full_name || unlockingUser.email,
          unlock_method: 'pin',
          terminal_id: currentTerminalId,
          previous_failed_attempts: failedAttempts,
          logged_in_user_id: unlockingUser.id
        });

        await recordAction('register_unlocked', { 
          unlocked_by: unlockingUser.full_name || unlockingUser.email 
        }, true);

        showToast(
          wasSwitchUser
            ? `Switched to ${displayName}`
            : `Register unlocked by ${displayName}`,
          'success'
        );

      } else {
        const newFailedCount = failedAttempts + 1;
        setFailedAttempts(newFailedCount);
        setPinInput('');

        await logSecurityEvent('failed_register_unlock', {
          attempt_number: newFailedCount,
          terminal_id: currentTerminalId,
          pin_length: pinInput.length,
          business_id: auth.selectedBusinessId
        }, 'high');

        await logSecurity('failed_register_unlock', {
          attempt_number: newFailedCount,
          terminal_id: currentTerminalId,
          pin_length: pinInput.length,
          business_id: auth.selectedBusinessId
        });

        if (newFailedCount >= 3) {
          setPinError('Too many failed attempts. Contact a manager.');
          
          await logSecurityEvent('register_lockout_triggered', {
            type: 'PIN brute force attempt',
            total_attempts: newFailedCount,
            terminal_id: currentTerminalId,
            lockout_duration: '5_minutes',
            business_id: auth.selectedBusinessId
          }, 'critical');
          
          await logSecurity('register_lockout_triggered', {
            type: 'PIN brute force attempt',
            total_attempts: newFailedCount,
            terminal_id: currentTerminalId,
            lockout_duration: '5_minutes'
          });
        } else {
          setPinError(`Incorrect PIN. Attempt ${newFailedCount} of 3.`);
        }
      }
    } catch (error) {
      await logSecurityEvent('pin_unlock_exception', {
        error: error.message,
        terminal_id: currentTerminalId,
        business_id: auth.selectedBusinessId
      }, 'critical');
      
      setPinError('Error validating PIN. Please try again.');
    }
  };

  // Drawer handlers
  const handleDrawerOpened = async (drawer) => {
    if (!canAccessDrawer) {
      showToast('You do not have permission to access the cash drawer', 'error');
      return;
    }

    await logSecurityEvent('cash_drawer_opened', {
      terminal_id: currentTerminalId,
      drawer_id: drawer?.id,
      opened_by: effectiveUserId,
      opened_by_name: effectiveUserName,
      business_id: auth.selectedBusinessId
    }, 'medium');

    logPOS('cash_drawer_opened', {
      terminal_id: currentTerminalId,
      drawer_id: drawer?.id,
      opened_by: effectiveUserId,
      opened_by_name: effectiveUserName
    });

    await recordAction('cash_drawer_opened', { drawer_id: drawer?.id }, true);
    
    showToast('Cash drawer opened successfully', 'success');
  };

  const handleDrawerClosed = async (drawer) => {
    await logSecurityEvent('cash_drawer_closed', {
      terminal_id: currentTerminalId,
      drawer_id: drawer?.id,
      closed_by: effectiveUserId,
      closed_by_name: effectiveUserName,
      expected_amount: drawer?.expected_amount,
      actual_amount: drawer?.actual_amount,
      variance: drawer?.variance,
      business_id: auth.selectedBusinessId
    }, 'medium');

    logPOS('cash_drawer_closed', {
      terminal_id: currentTerminalId,
      drawer_id: drawer?.id,
      closed_by: effectiveUserId,
      closed_by_name: effectiveUserName,
      expected_amount: drawer?.expected_amount,
      actual_amount: drawer?.actual_amount,
      variance: drawer?.variance
    });

    await recordAction('cash_drawer_closed', { drawer_id: drawer?.id }, true);
    
    showToast('Cash drawer closed successfully', 'success');
  };

  // Cart resumption and tab handling
  useEffect(() => {
    if (location.state?.activeTab) {
      const tab = location.state.activeTab;
      setActiveTab(tab);
      setIsTabMode(true);
      setCartInitialized(true);
      
      logPOS('tab_mode_activated', {
        tab_id: tab.id,
        tab_name: tab.customer_name,
        terminal_id: currentTerminalId
      });
      
      if (tab.loyalty_customer_id) {
        loadTabCustomer(tab.loyalty_customer_id);
      } else if (tab.customer_name) {
        setCurrentCustomer({
          customer_name: tab.customer_name,
          customer_phone: tab.customer_phone,
          customer_email: tab.customer_email,
          id: null
        });
      }

      loadTabItems(tab.id);
      return;
    }
    
    if (location.state?.resumeCart) {
      const { items, customer, cartId, loyaltyCandidates: resumeCandidates, silent } = location.state.resumeCart;
      
      if (items && items.length > 0) {
        setCartItems(items);
        setCartInitialized(true);
        
        logPOS('cart_resumed', {
          cart_id: cartId,
          item_count: items.length,
          has_customer: !!customer,
          terminal_id: currentTerminalId
        });
        
        if (cartId) {
          setSavedCartId(cartId);
          setIsFromSavedCarts(true);
        }
      }
      
      if (customer) {
        setCurrentCustomer(customer);
      }

      const candidates = Array.isArray(resumeCandidates) ? resumeCandidates.filter((c) => c?.id) : [];
      if (customer?.id && !candidates.some((c) => c.id === customer.id)) {
        candidates.unshift(customer);
      }
      setLoyaltyCandidates(candidates);
      
      if (!silent) {
        showToast(`Resumed cart with ${items?.length || 0} items`, 'success');
      }
      
      navigate(location.pathname, { replace: true, state: {} });
      return;
    }

    if (!cartInitialized) {
      setCartInitialized(true);
    }
  }, [location.state, cartInitialized, logPOS, currentTerminalId, navigate, location.pathname]);

  // Session storage for cart persistence
  useEffect(() => {
    if (!cartInitialized || isTabMode || !auth.selectedBusinessId) return;

    const sessionKey = `pos_cart_${auth.selectedBusinessId}`;
    
    if (cartItems.length === 0 && !currentCustomer) {
      const savedCart = sessionStorage.getItem(sessionKey);
      if (savedCart) {
        try {
          const parsed = JSON.parse(savedCart);
          if (parsed.items && Array.isArray(parsed.items)) {
            setCartItems(parsed.items);
            if (parsed.customer) {
              setCurrentCustomer(parsed.customer);
            }
            if (Array.isArray(parsed.loyaltyCandidates)) {
              setLoyaltyCandidates(parsed.loyaltyCandidates.filter((c) => c?.id));
            }
          }
        } catch (err) {
          // Silent fail for cart restoration
        }
      }
    }
  }, [cartInitialized, isTabMode, auth.selectedBusinessId]);

  // Save to session storage
  useEffect(() => {
    if (!cartInitialized || isTabMode || !auth.selectedBusinessId) return;

    const sessionKey = `pos_cart_${auth.selectedBusinessId}`;
    const cartData = {
      items: cartItems,
      customer: currentCustomer,
      loyaltyCandidates,
      timestamp: Date.now()
    };
    
    sessionStorage.setItem(sessionKey, JSON.stringify(cartData));
  }, [cartItems, currentCustomer, loyaltyCandidates, auth.selectedBusinessId, isTabMode, cartInitialized]);

  // Supabase mirror for Electron customer display — all cart modes (normal, tab, resumed / restored)
  // Brief delay when cart is empty so sessionStorage restore can run first (avoids wiping mirror on reload/deploy)
  useEffect(() => {
    if (!cartInitialized || !auth.selectedBusinessId) return;
    const delayMs = cartItems.length === 0 ? 450 : 0;
    const t = setTimeout(() => {
      const cartData = {
        cartItems,
        businessId: auth.selectedBusinessId,
        timestamp: Date.now()
      };
      try {
        localStorage.setItem('tavari_customer_display_cart', JSON.stringify(cartData));
      } catch {
        /* ignore */
      }
      clearCustomerDisplayPaymentLocalAndMirror(auth.selectedBusinessId);
    }, delayMs);
    return () => clearTimeout(t);
  }, [cartItems, auth.selectedBusinessId, cartInitialized]);

  // Save cart manually
  const saveCartManually = async (cartName) => {
    if (!canSaveCart) {
      showToast('You do not have permission to save carts', 'error');
      return;
    }

    if (!cartItems.length) {
      showToast('No items in cart to save', 'error');
      return;
    }

    const nameValidation = validateInput(cartName, 'text', 'cart_name');
    if (!nameValidation.valid || !cartName.trim()) {
      showToast('Please enter a valid cart name', 'error');
      return;
    }

    const rateLimitCheck = await checkRateLimit('save_cart', 10, 60000);
    if (!rateLimitCheck.allowed) {
      showToast('Too many cart save attempts. Please wait a moment.', 'error');
      return;
    }

    try {
      const subtotal = cartItems.reduce((sum, item) => {
        return sum + getPosLineSubtotal(item);
      }, 0);

      const { totalTax } = calculateTotalTax(cartItems, 0, 0, subtotal);
      const total = subtotal + totalTax;

      const cartData = {
        items: cartItems,
        savedAt: new Date().toISOString()
      };

      const customerInfo = currentCustomer ? {
        id: currentCustomer.id,
        name: currentCustomer.customer_name,
        phone: currentCustomer.customer_phone,
        email: currentCustomer.customer_email
      } : null;

      const { error } = await supabase
        .from('pos_saved_orders')
        .insert({
          business_id: auth.selectedBusinessId,
          saved_by: effectiveUserId,
          order_name: cartName.trim(),
          cart_data: cartData,
          subtotal: subtotal.toFixed(2),
          tax_amount: totalTax.toFixed(2),
          total_amount: total.toFixed(2),
          item_count: cartItems.length,
          customer_info: customerInfo,
          save_reason: 'manual'
        });

      if (error) throw error;

      await logSecurityEvent('cart_saved_manually', {
        cart_name: cartName.trim(),
        item_count: cartItems.length,
        total_amount: total.toFixed(2),
        has_customer: !!currentCustomer,
        terminal_id: currentTerminalId,
        business_id: auth.selectedBusinessId,
        saved_by: effectiveUserId
      }, 'low');

      logPOS('cart_saved_manually', {
        cart_name: cartName.trim(),
        item_count: cartItems.length,
        total_amount: total.toFixed(2),
        has_customer: !!currentCustomer,
        terminal_id: currentTerminalId
      });

      await recordAction('cart_saved', { cart_name: cartName.trim() }, true);
      
      showToast('Cart saved successfully!', 'success');
      setShowSaveCartModal(false);
      clearCurrentCart();
    } catch (err) {
      await logSecurityEvent('cart_save_error', {
        error: err.message,
        cart_name: cartName,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      showToast('Error saving cart: ' + err.message, 'error');
    }
  };

  // Save and exit
  const handleSaveAndExit = () => {
    if (isLocked || registerLocked) return;
    
    logPOS('save_and_exit_clicked', {
      item_count: cartItems.length,
      cart_mode: isTabMode ? 'tab' : 'normal',
      tab_id: activeTab?.id || null,
      has_customer: !!currentCustomer,
      terminal_id: currentTerminalId
    });
    
    if (isTabMode && activeTab) {
      setCartItems([]);
      setIndianStatusGstOnly(false);
      setIndianStatusCertificateNumber('');
      showToast('Tab saved - ready for next transaction', 'success');
    } else {
      clearCurrentCart();
      showToast('Cart cleared - ready for next transaction', 'success');
    }
  };

  // Delete cart
  const handleDeleteCart = async (cartId) => {
    if (!canSaveCart) {
      showToast('You do not have permission to delete carts', 'error');
      return;
    }

    try {
      const { error } = await supabase
        .from('pos_saved_orders')
        .delete()
        .eq('id', cartId)
        .eq('business_id', auth.selectedBusinessId);

      if (error) throw error;

      await logSecurityEvent('saved_cart_deleted', {
        cart_id: cartId,
        deleted_by: effectiveUserId,
        terminal_id: currentTerminalId,
        business_id: auth.selectedBusinessId
      }, 'medium');

      logPOS('saved_cart_deleted', {
        cart_id: cartId,
        deleted_by: effectiveUserId,
        terminal_id: currentTerminalId
      });

      await recordAction('cart_deleted', { cart_id: cartId }, true);

      showToast('Saved cart deleted successfully', 'success');
      clearCurrentCart();
      
    } catch (error) {
      await logSecurityEvent('cart_delete_error', {
        error: error.message,
        cart_id: cartId,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      showToast(`Error deleting cart: ${error.message}`, 'error');
    }
  };

  const handleClearCart = () => {
    logPOS('cart_cleared', {
      item_count: cartItems.length,
      had_customer: !!currentCustomer,
      terminal_id: currentTerminalId
    });
    
    clearCurrentCart();
    showToast('Cart cleared successfully', 'success');
  };

  const clearCurrentCart = () => {
    setCartItems([]);
    setCurrentCustomer(null);
    setLoyaltyCandidates([]);
    setSavedCartId(null);
    setIsFromSavedCarts(false);
    setIndianStatusGstOnly(false);
    setIndianStatusCertificateNumber('');
    
    // Clear cart data in localStorage for customer display
    localStorage.removeItem('tavari_customer_display_cart');
    clearCustomerDisplayPaymentLocalAndMirror(auth.selectedBusinessId);

    // Also dispatch event for same-window components
    const cartClearEvent = new CustomEvent('tavari-cart-clear', {
      detail: {
        businessId: auth.selectedBusinessId
      }
    });
    window.dispatchEvent(cartClearEvent);
    
    if (auth.selectedBusinessId && !isTabMode) {
      const sessionKey = `pos_cart_${auth.selectedBusinessId}`;
      sessionStorage.removeItem(sessionKey);
    }
  };

  const loadTabCustomer = async (loyaltyCustomerId) => {
    if (!auth.selectedBusinessId) return;
    
    try {
      const { data, error } = await supabase
        .from('pos_loyalty_accounts')
        .select('*')
        .eq('id', loyaltyCustomerId)
        .eq('business_id', auth.selectedBusinessId)
        .single();

      if (data && !error) {
        setCurrentCustomer(data);
      }
    } catch (err) {
      await logSecurityEvent('tab_customer_load_error', {
        error: err.message,
        loyalty_customer_id: loyaltyCustomerId,
        business_id: auth.selectedBusinessId
      }, 'low');
    }
  };

  const loadTabItems = async (tabId) => {
    try {
      const { data, error } = await supabase
        .from('pos_tab_items')
        .select('*')
        .eq('tab_id', tabId)
        .order('created_at', { ascending: true });

      if (data && !error) {
        const convertedItems = data.map(item => ({
          id: item.product_id || item.id,
          name: item.name,
          price: item.unit_price,
          quantity: item.quantity,
          modifiers: item.modifiers || [],
          notes: item.notes,
          category_id: item.category_id,
          item_tax_overrides: item.item_tax_overrides,
          tab_item_id: item.id
        }));
        
        setTabItems(convertedItems);
        setCartItems(convertedItems);
      }
    } catch (err) {
      await logSecurityEvent('tab_items_load_error', {
        error: err.message,
        tab_id: tabId,
        business_id: auth.selectedBusinessId
      }, 'low');
    }
  };

  // Clock updater
  useEffect(() => {
    const interval = setInterval(() => {
      setTime(dayjs().format("hh:mm A"));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch user info
  useEffect(() => {
    const fetchUserInfo = async () => {
      if (!auth.authUser || !auth.selectedBusinessId) return;

      const activeUser = getActivePosUserFromStorage();
      if (activeUser && activeUser.business_id === auth.selectedBusinessId) {
        return;
      }

      try {
        const [userResult, businessResult] = await Promise.all([
          supabase.from("users").select("full_name, email").eq("id", auth.authUser.id).single(),
          supabase.from("businesses").select("name, timezone").eq("id", auth.selectedBusinessId).single()
        ]);

        if (userResult.data) {
          setEmployeeName(userResult.data.full_name || userResult.data.email || "Unknown User");
        }

        if (businessResult.data) {
          setBusinessName(businessResult.data.name);
          setBusinessTimeZone(businessResult.data.timezone || "America/Toronto");
        }
      } catch (err) {
        await logSecurityEvent('user_info_fetch_error', {
          error: err.message,
          business_id: auth.selectedBusinessId
        }, 'low');
      }
    };
    
    if (auth.isReady) {
      fetchUserInfo();
    }
  }, [auth.authUser, auth.selectedBusinessId, auth.isReady]);

  // Fetch categories
  useEffect(() => {
    if (!auth.selectedBusinessId || !auth.isReady) return;

    const fetchCategories = async () => {
      try {
        const { data, error } = await supabase
          .from("pos_categories")
          .select("id, name, color, emoji, sort_order")
          .eq("business_id", auth.selectedBusinessId)
          .order("sort_order", { ascending: true });

        if (!error) {
          setCategories(data || []);
        }
      } catch (err) {
        await logSecurityEvent('categories_fetch_error', {
          error: err.message,
          business_id: auth.selectedBusinessId
        }, 'low');
      }
    };

    fetchCategories();

    const catSubscription = supabase
      .channel(`pos_categories_${auth.selectedBusinessId}`)
      .on("postgres_changes", { 
        event: "*", 
        schema: "public", 
        table: "pos_categories", 
        filter: `business_id=eq.${auth.selectedBusinessId}` 
      }, fetchCategories)
      .subscribe();

    return () => supabase.removeChannel(catSubscription);
  }, [auth.selectedBusinessId, auth.isReady]);

  // Fetch today's Name-of-Day promo for the register banner.
  useEffect(() => {
    if (!auth.selectedBusinessId || !auth.isReady) {
      setNameOfDayPromo(null);
      return;
    }

    let cancelled = false;

    const fetchNameOfDayPromo = async () => {
      try {
        const today = getBusinessLocalDateString(businessTimeZone);

        const { data: automations, error: automationError } = await supabase
          .from('mail_automations')
          .select('id, is_enabled, status, criteria')
          .eq('business_id', auth.selectedBusinessId)
          .eq('automation_type', 'custom')
          .eq('is_enabled', true)
          .neq('status', 'archived');

        if (automationError) throw automationError;

        const hasActiveNameOfDay = (automations || []).some((automation) => {
          const criteria = automation?.criteria && typeof automation.criteria === 'object'
            ? automation.criteria
            : {};
          return String(criteria.source || '') === 'name_of_day';
        });

        if (!hasActiveNameOfDay) {
          if (!cancelled) setNameOfDayPromo(null);
          return;
        }

        const { data: pick, error: pickError } = await supabase
          .from('mail_name_of_day_picks')
          .select('girl_display_name, boy_display_name, girl_normalized, boy_normalized')
          .eq('business_id', auth.selectedBusinessId)
          .eq('local_date', today)
          .maybeSingle();

        if (pickError) throw pickError;

        const girlName = String(pick?.girl_display_name || pick?.girl_normalized || '').trim();
        const boyName = String(pick?.boy_display_name || pick?.boy_normalized || '').trim();

        if (!girlName || !boyName) {
          if (!cancelled) setNameOfDayPromo(null);
          return;
        }

        if (!cancelled) {
          setNameOfDayPromo({
            localDate: today,
            girlName,
            boyName
          });
        }
      } catch (err) {
        if (!cancelled) setNameOfDayPromo(null);
        console.warn('[POSRegister] Name-of-Day promo banner unavailable:', err?.message || err);
      }
    };

    fetchNameOfDayPromo();

    const picksSubscription = supabase
      .channel(`pos_name_of_day_picks_${auth.selectedBusinessId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'mail_name_of_day_picks',
        filter: `business_id=eq.${auth.selectedBusinessId}`
      }, fetchNameOfDayPromo)
      .subscribe();

    const automationsSubscription = supabase
      .channel(`pos_name_of_day_automations_${auth.selectedBusinessId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'mail_automations',
        filter: `business_id=eq.${auth.selectedBusinessId}`
      }, fetchNameOfDayPromo)
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(picksSubscription);
      supabase.removeChannel(automationsSubscription);
    };
  }, [auth.selectedBusinessId, auth.isReady, businessTimeZone]);

  // Fetch business settings
  useEffect(() => {
    const fetchBusinessSettings = async () => {
      try {
        const { data, error } = await fetchPosSettingsForTerminal(
          auth.selectedBusinessId,
          currentTerminalId
        );

        if (error) {
          setBusinessSettings({
            tabs_enabled: true,
            default_tab_limit: 500.00,
            max_tab_limit: 1000.00,
            tab_limit_requires_manager: true,
            tab_warning_threshold: 0.8
          });
        } else {
          setBusinessSettings(data || {});
        }
      } catch (err) {
        setBusinessSettings({});
      }
    };

    if (auth.selectedBusinessId && auth.isReady) {
      fetchBusinessSettings();
    }
  }, [auth.selectedBusinessId, auth.isReady]);

  const fetchProducts = useCallback(async () => {
    if (!auth.selectedBusinessId || !auth.isReady) return;
    try {
      const { data, error } = await supabase
        .from("pos_inventory")
        .select("id, name, price, cost, sku, barcode, category_id, category_sort_order, track_stock, stock_quantity, low_stock_threshold, station_ids, image_url, item_tax_overrides, modifier_group_ids, included_modifier_category_id, included_modifier_max_price, is_bundle, loyalty_points_earned, display_on_pos, is_modifier_item, parent_inventory_id, is_gift_card, gift_card_product_id, tax_exempt")
        .eq("business_id", auth.selectedBusinessId)
        .or("is_active.eq.true,is_active.is.null")
        .order("name", { ascending: true });

      if (!error) {
        setProducts(
          (data || []).filter(
            (item) =>
              item.display_on_pos !== false &&
              (item.is_modifier_item !== true || !!item.parent_inventory_id),
          ),
        );
      }
    } catch (err) {
      await logSecurityEvent('products_fetch_error', {
        error: err.message,
        business_id: auth.selectedBusinessId
      }, 'low');
    }
  }, [auth.selectedBusinessId, auth.isReady]);

  useEffect(() => {
    if (!auth.selectedBusinessId || !auth.isReady) return;

    fetchProducts();

    const prodSubscription = supabase
      .channel(`pos_inventory_${auth.selectedBusinessId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "pos_inventory",
        filter: `business_id=eq.${auth.selectedBusinessId}`
      }, fetchProducts)
      .subscribe();

    return () => supabase.removeChannel(prodSubscription);
  }, [auth.selectedBusinessId, auth.isReady, fetchProducts]);

  useEffect(() => {
    const onInventoryUpdated = (e) => {
      const bid = e?.detail?.businessId;
      if (bid && bid === auth.selectedBusinessId) {
        fetchProducts();
      }
    };
    window.addEventListener("tavari:pos-inventory-updated", onInventoryUpdated);
    return () => window.removeEventListener("tavari:pos-inventory-updated", onInventoryUpdated);
  }, [auth.selectedBusinessId, fetchProducts]);

  const filteredProducts = useMemo(() => {
    const catRankById = new Map(
      (categories || []).map((c) => [String(c.id), Number(c.sort_order ?? 0)])
    );
    const itemRank = (p) => Number(p.category_sort_order ?? 0);
    const nameKey = (p) => String(p.name || "");

    if (!activeCategory) {
      return [...products].sort((a, b) => {
        const cidA = a.category_id != null ? String(a.category_id) : "";
        const cidB = b.category_id != null ? String(b.category_id) : "";
        const catA = cidA ? (catRankById.has(cidA) ? catRankById.get(cidA) : 999999) : 1000000;
        const catB = cidB ? (catRankById.has(cidB) ? catRankById.get(cidB) : 999999) : 1000000;
        if (catA !== catB) return catA - catB;
        const ia = itemRank(a);
        const ib = itemRank(b);
        if (ia !== ib) return ia - ib;
        return nameKey(a).localeCompare(nameKey(b));
      });
    }

    const active = String(activeCategory);
    return [...products]
      .filter((p) => p.category_id != null && String(p.category_id) === active)
      .sort((a, b) => {
        const ao = itemRank(a);
        const bo = itemRank(b);
        if (ao !== bo) return ao - bo;
        return nameKey(a).localeCompare(nameKey(b));
      });
  }, [products, activeCategory, categories]);

  // Cart operations
  const handleAddToCart = async (product) => {
    if (isLocked || registerLocked) return;
    if (!canOperateRegister) {
      showToast('You do not have permission to operate the register', 'error');
      return;
    }
    
    await logSecurityEvent('product_added_to_cart', {
      product_id: product.id,
      product_name: product.name,
      product_price: product.price,
      cart_mode: isTabMode ? 'tab' : 'normal',
      terminal_id: currentTerminalId,
      business_id: auth.selectedBusinessId,
      added_by: effectiveUserId
    }, 'low');
    
    logPOS('product_added_to_cart', {
      product_id: product.id,
      product_name: product.name,
      product_price: product.price,
      cart_mode: isTabMode ? 'tab' : 'normal',
      terminal_id: currentTerminalId
    });
    
    if (isTabMode && activeTab) {
      addItemToTab(product);
    } else {
      setCartItems((prev) => {
        // Gift cards with personal details never merge — each is its own issued card
        if (product.gift_card || product.is_gift_card || product.cart_line_key) {
          const newCartItems = [...prev, { ...product, quantity: product.quantity || 1 }];
          const cartData = {
            cartItems: newCartItems,
            businessId: auth.selectedBusinessId,
            timestamp: Date.now()
          };
          localStorage.setItem('tavari_customer_display_cart', JSON.stringify(cartData));
          clearCustomerDisplayPaymentLocalAndMirror(auth.selectedBusinessId);
          window.dispatchEvent(new CustomEvent('tavari-cart-update', { detail: cartData }));
          return newCartItems;
        }

        const existing = prev.find(
          (item) =>
            item.id === product.id &&
            !item.gift_card &&
            !item.cart_line_key &&
            JSON.stringify(item.modifiers || []) === JSON.stringify(product.modifiers || [])
        );

        let newCartItems;
        if (existing) {
          newCartItems = prev.map((item) =>
            item.id === product.id &&
            !item.gift_card &&
            !item.cart_line_key &&
            JSON.stringify(item.modifiers || []) === JSON.stringify(product.modifiers || [])
              ? { ...item, quantity: item.quantity + 1 }
              : item
          );
        } else {
          newCartItems = [...prev, { ...product, quantity: 1 }];
        }

        // Store cart data in localStorage for customer display
        console.log('🚀 POS Register: Storing cart data in localStorage:', {
          cartItems: newCartItems,
          businessId: auth.selectedBusinessId,
          itemCount: newCartItems.length
        });
        
        const cartData = {
          cartItems: newCartItems,
          businessId: auth.selectedBusinessId,
          timestamp: Date.now()
        };
        
        localStorage.setItem('tavari_customer_display_cart', JSON.stringify(cartData));
        clearCustomerDisplayPaymentLocalAndMirror(auth.selectedBusinessId);

        // Also dispatch event for same-window components
        const cartUpdateEvent = new CustomEvent('tavari-cart-update', {
          detail: cartData
        });
        window.dispatchEvent(cartUpdateEvent);
        
        console.log('✅ POS Register: Cart data stored in localStorage successfully');

        return newCartItems;
      });
    }
  };

  const handleRemoveFromCart = async (productId) => {
    if (isLocked || registerLocked) return;
    if (!canOperateRegister) {
      showToast('You do not have permission to operate the register', 'error');
      return;
    }
    
    await logSecurityEvent('product_removed_from_cart', {
      product_id: productId,
      cart_mode: isTabMode ? 'tab' : 'normal',
      terminal_id: currentTerminalId,
      business_id: auth.selectedBusinessId,
      removed_by: effectiveUserId
    }, 'low');
    
    logPOS('product_removed_from_cart', {
      product_id: productId,
      cart_mode: isTabMode ? 'tab' : 'normal',
      terminal_id: currentTerminalId
    });
    
    if (isTabMode && activeTab) {
      removeItemFromTab(productId);
    } else {
      setCartItems((prev) => {
        const newCartItems = prev.filter((item) => item.id !== productId);
        
        // Store cart data in localStorage for customer display
        const cartData = {
          cartItems: newCartItems,
          businessId: auth.selectedBusinessId,
          timestamp: Date.now()
        };
        localStorage.setItem('tavari_customer_display_cart', JSON.stringify(cartData));
        clearCustomerDisplayPaymentLocalAndMirror(auth.selectedBusinessId);

        // Also dispatch event for same-window components
        const cartUpdateEvent = new CustomEvent('tavari-cart-update', {
          detail: cartData
        });
        window.dispatchEvent(cartUpdateEvent);
        
        return newCartItems;
      });
    }
  };

  const handleUpdateQty = async (productId, qty) => {
    if (isLocked || registerLocked) return;
    if (!canOperateRegister) {
      showToast('You do not have permission to operate the register', 'error');
      return;
    }
    
    if (qty <= 0) return handleRemoveFromCart(productId);
    
    await logSecurityEvent('product_quantity_updated', {
      product_id: productId,
      new_quantity: qty,
      cart_mode: isTabMode ? 'tab' : 'normal',
      terminal_id: currentTerminalId,
      business_id: auth.selectedBusinessId,
      updated_by: effectiveUserId
    }, 'low');
    
    logPOS('product_quantity_updated', {
      product_id: productId,
      new_quantity: qty,
      cart_mode: isTabMode ? 'tab' : 'normal',
      terminal_id: currentTerminalId
    });
    
    if (isTabMode && activeTab) {
      updateTabItemQty(productId, qty);
    } else {
      setCartItems((prev) => {
        const newCartItems = prev.map((item) => (item.id === productId ? { ...item, quantity: qty } : item));
        
        // Store cart data in localStorage for customer display
        const cartData = {
          cartItems: newCartItems,
          businessId: auth.selectedBusinessId,
          timestamp: Date.now()
        };
        localStorage.setItem('tavari_customer_display_cart', JSON.stringify(cartData));
        clearCustomerDisplayPaymentLocalAndMirror(auth.selectedBusinessId);

        // Also dispatch event for same-window components
        const cartUpdateEvent = new CustomEvent('tavari-cart-update', {
          detail: cartData
        });
        window.dispatchEvent(cartUpdateEvent);
        
        return newCartItems;
      });
    }
  };

  // Tab functions
  const addItemToTab = async (product) => {
    await performAddItemToTab(product);
  };

  const performAddItemToTab = async (product) => {
    try {
      const existingTabItem = tabItems.find(item => item.id === product.id);
      
      if (existingTabItem) {
        const newQuantity = existingTabItem.quantity + 1;
        const newTotalPrice = newQuantity * getPosLineUnitPrice(product);
        
        const { error } = await supabase
          .from('pos_tab_items')
          .update({ 
            quantity: newQuantity,
            total_price: newTotalPrice
          })
          .eq('id', existingTabItem.tab_item_id);

        if (error) throw error;

        setCartItems(prev => 
          prev.map(item => 
            item.id === product.id 
              ? { ...item, quantity: newQuantity }
              : item
          )
        );
        setTabItems(prev => 
          prev.map(item => 
            item.id === product.id 
              ? { ...item, quantity: newQuantity }
              : item
          )
        );
      } else {
        const tabItemData = {
          business_id: auth.selectedBusinessId,
          tab_id: activeTab.id,
          inventory_id: product.id,
          product_id: product.id,
          name: product.name,
          quantity: 1,
          unit_price: getPosLineUnitPrice(product),
          total_price: getPosLineSubtotal(product),
          modifiers: product.modifiers || [],
          category_id: product.category_id,
          item_tax_overrides: product.item_tax_overrides,
          added_by: effectiveUserId
        };

        const { data: newTabItem, error } = await supabase
          .from('pos_tab_items')
          .insert(tabItemData)
          .select()
          .single();

        if (error) throw error;

        const cartItem = {
          ...product,
          quantity: 1,
          tab_item_id: newTabItem.id
        };

        setCartItems(prev => [...prev, cartItem]);
        setTabItems(prev => [...prev, cartItem]);
      }

      showToast(`Added ${product.name} to tab`, 'success');
    } catch (err) {
      await logSecurityEvent('tab_item_add_error', {
        error: err.message,
        product_id: product.id,
        tab_id: activeTab.id,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      showToast('Error adding item to tab: ' + err.message, 'error');
    }
  };

  const removeItemFromTab = async (productId) => {
    try {
      const tabItem = tabItems.find(item => item.id === productId);
      if (tabItem && tabItem.tab_item_id) {
        const { error } = await supabase
          .from('pos_tab_items')
          .delete()
          .eq('id', tabItem.tab_item_id);

        if (error) throw error;

        setCartItems(prev => prev.filter(item => item.id !== productId));
        setTabItems(prev => prev.filter(item => item.id !== productId));
      }
    } catch (err) {
      await logSecurityEvent('tab_item_remove_error', {
        error: err.message,
        product_id: productId,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      showToast('Error removing item from tab', 'error');
    }
  };

  const updateTabItemQty = async (productId, qty) => {
    try {
      const tabItem = tabItems.find(item => item.id === productId);
      if (tabItem && tabItem.tab_item_id) {
        const newTotalPrice = qty * getPosLineUnitPrice(tabItem);

        const { error } = await supabase
          .from('pos_tab_items')
          .update({
            quantity: qty,
            total_price: newTotalPrice
          })
          .eq('id', tabItem.tab_item_id);

        if (error) throw error;

        setCartItems(prev =>
          prev.map(item =>
            item.id === productId ? { ...item, quantity: qty } : item
          )
        );
        setTabItems(prev =>
          prev.map(item =>
            item.id === productId ? { ...item, quantity: qty } : item
          )
        );
      }
    } catch (err) {
      await logSecurityEvent('tab_item_update_error', {
        error: err.message,
        product_id: productId,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      showToast('Error updating quantity', 'error');
    }
  };

  // Barcode scanning
  const handleBarcodeScan = async (code) => {
    if (isLocked || registerLocked) return;
    if (!canOperateRegister) {
      showToast('You do not have permission to scan items', 'error');
      return;
    }
    
    await logSecurityEvent('barcode_scanned', {
      scanned_code: code,
      scan_type: 'product_or_customer',
      terminal_id: currentTerminalId,
      business_id: auth.selectedBusinessId,
      scanned_by: effectiveUserId
    }, 'low');
    
    logPOS('barcode_scanned', {
      scanned_code: code,
      scan_type: 'product_or_customer',
      terminal_id: currentTerminalId
    });
    
    const foundProduct = products.find(
      (p) => 
        (p.sku && p.sku.trim() === code.trim()) ||
        (p.barcode && p.barcode.trim() === code.trim())
    );
    
    if (foundProduct) {
      handleAddToCart(foundProduct);
      showToast(`Added ${foundProduct.name} to cart`, 'success');
      
      await logSecurityEvent('barcode_scan_success', {
        scanned_code: code,
        product_id: foundProduct.id,
        product_name: foundProduct.name,
        terminal_id: currentTerminalId,
        business_id: auth.selectedBusinessId
      }, 'low');
      
      logPOS('barcode_scan_success', {
        scanned_code: code,
        product_id: foundProduct.id,
        product_name: foundProduct.name,
        terminal_id: currentTerminalId
      });
      return;
    }

    handleCustomerScan(code);
  };

  // Customer attachment
  const handleCustomerScan = async (customerId) => {
    if (isLocked || registerLocked || !auth.selectedBusinessId) return;
    if (!canAttachCustomer) {
      showToast('You do not have permission to attach customers', 'error');
      return;
    }
    
    try {
      const { data, error } = await supabase
        .from('pos_loyalty_accounts')
        .select('*')
        .eq('id', customerId)
        .eq('business_id', auth.selectedBusinessId)
        .eq('is_active', true)
        .single();

      if (error || !data) {
        showToast('Customer not found or inactive', 'error');
        
        await logSecurityEvent('customer_scan_failed', {
          scanned_code: customerId,
          error: error?.message || 'Customer not found',
          terminal_id: currentTerminalId,
          business_id: auth.selectedBusinessId
        }, 'low');
        
        logPOS('customer_scan_failed', {
          scanned_code: customerId,
          error: error?.message || 'Customer not found',
          terminal_id: currentTerminalId
        });
        return;
      }

      setCurrentCustomer(data);
      setLoyaltyCandidates((prev) => {
        if (!Array.isArray(prev) || prev.length === 0) return prev;
        if (prev.some((c) => c.id === data.id)) {
          return prev.map((c) => (c.id === data.id ? data : c));
        }
        return [...prev, data];
      });
      showToast(`Customer attached: ${data.customer_name}`, 'success');

      await logSecurityEvent('customer_attached', {
        customer_id: data.id,
        customer_name: data.customer_name,
        customer_balance: data.balance,
        attachment_method: 'qr_scan',
        terminal_id: currentTerminalId,
        business_id: auth.selectedBusinessId,
        attached_by: effectiveUserId
      }, 'low');

      logPOS('customer_attached', {
        customer_id: data.id,
        customer_name: data.customer_name,
        customer_balance: data.balance,
        attachment_method: 'qr_scan',
        terminal_id: currentTerminalId
      });

    } catch (err) {
      await logSecurityEvent('customer_scan_error', {
        error: err.message,
        scanned_code: customerId,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      showToast('Error scanning customer QR code', 'error');
    }
  };

  const handleSwitchLoyaltyCustomer = async (customerOrId) => {
    const fromCandidate =
      customerOrId && typeof customerOrId === 'object' ? customerOrId : null;
    const customerId = String(fromCandidate?.id || customerOrId || '').trim();
    const currentId = String(currentCustomer?.id || '').trim();

    if (isLocked || registerLocked) {
      showToast('Unlock the register to change the loyalty customer', 'error');
      return false;
    }
    if (!auth.selectedBusinessId) {
      showToast('No business selected', 'error');
      return false;
    }
    if (!customerId) {
      showToast('No loyalty account selected', 'error');
      return false;
    }
    if (customerId === currentId) {
      return true;
    }

    try {
      let nextCustomer = null;
      const { data, error } = await supabase
        .from('pos_loyalty_accounts')
        .select('*')
        .eq('id', customerId)
        .eq('business_id', auth.selectedBusinessId)
        .maybeSingle();

      if (!error && data?.id) {
        nextCustomer = data;
      } else if (fromCandidate?.id) {
        // Party list already has this adult — still switch even if refresh fails.
        nextCustomer = { ...fromCandidate };
      } else {
        const fallback = (loyaltyCandidates || []).find(
          (c) => String(c?.id || '') === customerId,
        );
        if (fallback) nextCustomer = { ...fallback };
      }

      if (!nextCustomer?.id) {
        showToast(
          error?.message || 'Customer not found or inactive',
          'error',
        );
        return false;
      }

      setCurrentCustomer(nextCustomer);
      setLoyaltyCandidates((prev) => {
        const list = Array.isArray(prev) ? [...prev] : [];
        const idx = list.findIndex((c) => String(c?.id || '') === String(nextCustomer.id));
        if (idx >= 0) list[idx] = nextCustomer;
        else list.push(nextCustomer);
        return list;
      });
      showToast(`Loyalty points will go to ${nextCustomer.customer_name}`, 'success');

      logPOS('loyalty_customer_switched', {
        customer_id: nextCustomer.id,
        customer_name: nextCustomer.customer_name,
        terminal_id: currentTerminalId
      });
      return true;
    } catch (err) {
      showToast(err?.message || 'Could not switch loyalty customer', 'error');
      return false;
    }
  };

  const handleDetachCustomer = async () => {
    if (currentCustomer) {
      await logSecurityEvent('customer_detached', {
        customer_id: currentCustomer.id,
        customer_name: currentCustomer.customer_name,
        terminal_id: currentTerminalId,
        business_id: auth.selectedBusinessId,
        detached_by: effectiveUserId
      }, 'low');
      
      logPOS('customer_detached', {
        customer_id: currentCustomer.id,
        customer_name: currentCustomer.customer_name,
        terminal_id: currentTerminalId
      });
    }
    
    setCurrentCustomer(null);
    showToast('Customer detached', 'info');
  };

  const showToast = (message, type = 'info') => {
    const toast = document.createElement('div');
    const bgColor = type === 'error' ? TavariStyles.colors.danger : 
                   type === 'success' ? TavariStyles.colors.success : 
                   TavariStyles.colors.primary;
    
    toast.style.cssText = `
      position: fixed;
      top: 120px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 6px;
      color: white;
      font-weight: bold;
      z-index: 1000;
      background-color: ${bgColor};
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      if (document.body.contains(toast)) {
        document.body.removeChild(toast);
      }
    }, 3000);
  };

  // Checkout handler
  const handleCheckout = async (checkoutData) => {
    if (isLocked || registerLocked) return;
    if (!canOperateRegister) {
      showToast('You do not have permission to process checkouts', 'error');
      return;
    }
    
    await logSecurityEvent('checkout_initiated', {
      item_count: cartItems.length,
      subtotal: checkoutData.subtotal || 0,
      total: checkoutData.total || 0,
      has_customer: !!currentCustomer,
      cart_mode: isTabMode ? 'tab' : 'normal',
      terminal_id: currentTerminalId,
      business_id: auth.selectedBusinessId,
      initiated_by: effectiveUserId
    }, 'medium');
    
    logPOS('checkout_initiated', {
      item_count: cartItems.length,
      subtotal: checkoutData.subtotal || 0,
      total: checkoutData.total || 0,
      has_customer: !!currentCustomer,
      cart_mode: isTabMode ? 'tab' : 'normal',
      terminal_id: currentTerminalId
    });

    // Keep session cart so "Back to Register" can restore it for edits.
    // Cart is cleared only after a completed sale (or explicit clear).
    
    if (isTabMode && activeTab) {
      const cleanSaleData = {
        items: cartItems.map(item => ({
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          modifiers: item.modifiers || [],
          category_id: item.category_id,
          item_tax_overrides: item.item_tax_overrides,
          is_custom: item.is_custom || false,
          tax_included: item.tax_included !== false,
          is_gift_card: !!item.is_gift_card || !!item.gift_card,
          gift_card_product_id: item.gift_card_product_id || null,
          gift_card: item.gift_card || null,
          cart_line_key: item.cart_line_key || null,
          tax_exempt: !!(item.tax_exempt || item.is_gift_card || item.gift_card),
        })),
        business_id: auth.selectedBusinessId,
        loyalty_customer_id: currentCustomer?.id || null,
        loyaltyCustomer: currentCustomer ? {
          id: currentCustomer.id,
          customer_name: currentCustomer.customer_name,
          customer_phone: currentCustomer.customer_phone,
          customer_email: currentCustomer.customer_email,
          balance: currentCustomer.balance
        } : null,
        activeTab: {
          id: activeTab.id,
          customer_name: activeTab.customer_name,
          customer_phone: activeTab.customer_phone,
          total_amount: activeTab.total_amount
        },
        tab_mode: true,
        subtotal: checkoutData.subtotal || 0,
        total_amount: checkoutData.total || 0,
        tax_amount: checkoutData.tax || 0,
        item_tax_details: checkoutData.itemTaxDetails || [],
        aggregated_taxes: checkoutData.aggregated_taxes || {},
        aggregated_rebates: checkoutData.aggregated_rebates || {},
        indian_status_gst_only: !!checkoutData.indian_status_gst_only,
        indian_status_certificate_number: checkoutData.indian_status_certificate_number || null,
        indian_status_gst_rate: checkoutData.indian_status_gst_rate ?? indianStatusGstRate,
        indian_status_tax_label: checkoutData.indian_status_tax_label || indianStatusTaxLabel,
        lock_after_sale: posSettings.lock_after_sale,
        pin_required: posSettings.pin_required
      };
      
      navigate('/dashboard/pos/payment', {
        state: { 
          saleData: cleanSaleData,
          from: 'register'
        }
      });
    } else {
      const cleanCheckoutData = {
        items: cartItems.map(item => ({
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          modifiers: item.modifiers || [],
          category_id: item.category_id,
          item_tax_overrides: item.item_tax_overrides,
          is_custom: item.is_custom || false,
          tax_included: item.tax_included !== false,
          is_gift_card: !!item.is_gift_card || !!item.gift_card,
          gift_card_product_id: item.gift_card_product_id || null,
          gift_card: item.gift_card || null,
          cart_line_key: item.cart_line_key || null,
          tax_exempt: !!(item.tax_exempt || item.is_gift_card || item.gift_card),
        })),
        business_id: auth.selectedBusinessId,
        loyalty_customer_id: currentCustomer?.id || null,
        loyaltyCustomer: currentCustomer ? {
          id: currentCustomer.id,
          customer_name: currentCustomer.customer_name,
          customer_phone: currentCustomer.customer_phone,
          customer_email: currentCustomer.customer_email,
          balance: currentCustomer.balance
        } : null,
        subtotal: checkoutData.subtotal || 0,
        total_amount: checkoutData.total || 0,
        tax_amount: checkoutData.tax || 0,
        item_count: cartItems.length,
        discount_amount: checkoutData.discount_amount || 0,
        loyalty_redemption: checkoutData.loyalty_redemption || 0,
        aggregated_taxes: checkoutData.aggregated_taxes || {},
        aggregated_rebates: checkoutData.aggregated_rebates || {},
        item_tax_details: checkoutData.itemTaxDetails || [],
        indian_status_gst_only: !!checkoutData.indian_status_gst_only,
        indian_status_certificate_number: checkoutData.indian_status_certificate_number || null,
        indian_status_gst_rate: checkoutData.indian_status_gst_rate ?? indianStatusGstRate,
        indian_status_tax_label: checkoutData.indian_status_tax_label || indianStatusTaxLabel,
        lock_after_sale: posSettings.lock_after_sale,
        pin_required: posSettings.pin_required
      };
      
      navigate('/dashboard/pos/sale-review', {
        state: { 
          checkoutData: cleanCheckoutData,
          from: 'register'
        }
      });
    }
  };

  // Header action handlers
  const handleSaveCartClick = () => {
    if (!canSaveCart) {
      showToast('You do not have permission to save carts', 'error');
      return;
    }
    setShowSaveCartModal(true);
  };

  const handleDrawerManagerClick = () => {
    if (!canAccessDrawer) {
      showToast('You do not have permission to access the cash drawer', 'error');
      return;
    }
    setShowDrawerManager(true);
  };

  const handleNavigateToRefunds = () => {
    if (!canViewRefunds) {
      showToast('You do not have permission to view refunds', 'error');
      return;
    }
    navigate('/dashboard/pos/refunds');
  };

  const handleNavigateToSavedCarts = () => {
    if (!canSaveCart) {
      showToast('You do not have permission to view saved carts', 'error');
      return;
    }
    navigate('/dashboard/pos/saved-carts');
  };

  const handleNavigateToTabs = () => {
    if (!canManageTabs) {
      showToast('You do not have permission to manage tabs', 'error');
      return;
    }
    navigate('/dashboard/pos/tabs');
  };

  const handleNavigateToWaivers = () => {
    navigate('/dashboard/waivers');
  };

  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      backgroundColor: TavariStyles.colors.gray50,
      paddingTop: '140px',
      boxSizing: 'border-box',
      overflow: 'hidden'
    },
    
    warning: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.warning,
      marginBottom: TavariStyles.spacing.md,
      position: 'fixed',
      top: '140px',
      left: '0',
      right: '0',
      zIndex: 1000
    },
    
    mainContent: {
      display: 'flex',
      flex: 1,
      minWidth: 0,
      height: 'calc(100vh - 140px)',
      overflow: 'hidden',
      alignItems: 'stretch'
    },
    
    productsSection: {
      flex: '1 1 0%',
      display: 'flex',
      flexDirection: 'column',
      padding: TavariStyles.spacing.lg,
      paddingRight: TavariStyles.spacing.sm,
      overflow: 'hidden',
      minWidth: 0,
      boxSizing: 'border-box'
    },

    nameOfDayBanner: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: TavariStyles.spacing.md,
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
      marginBottom: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius.lg,
      border: `1px solid ${TavariStyles.colors.primary}33`,
      background: 'linear-gradient(135deg, #fff7ed 0%, #f0fdfa 100%)',
      boxShadow: TavariStyles.shadows.sm,
      color: TavariStyles.colors.gray900,
      flexShrink: 0
    },

    nameOfDayBannerText: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      minWidth: 0,
      flexWrap: 'wrap'
    },

    nameOfDayBannerLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray600,
      textTransform: 'uppercase',
      letterSpacing: '0.04em'
    },

    nameOfDayBannerNames: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary,
      lineHeight: 1.1
    },

    nameOfDayBannerHint: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      whiteSpace: 'nowrap'
    },
    
    cartSection: {
      flex: '0 0 auto',
      width: 'clamp(280px, 32vw, 380px)',
      maxWidth: '100%',
      flexShrink: 0,
      padding: TavariStyles.spacing.lg,
      paddingLeft: TavariStyles.spacing.sm,
      overflow: 'hidden',
      boxSizing: 'border-box'
    },
    
    productGridContainer: {
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      overflow: 'hidden'
    },

    noAccessContainer: {
      padding: TavariStyles.spacing['3xl'],
      textAlign: 'center'
    },

    noAccessText: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600,
      margin: 0
    }
  };

  // Check overall access permission
  if (!permissionsLoading && !canOperateRegister) {
    return (
      <SecurityWrapper>
        <POSAuthWrapper
          requiredRoles={['employee', 'manager', 'owner']}
          requireBusiness={true}
          componentName="POS Register"
        >
          <div style={styles.container}>
            <div style={styles.noAccessContainer}>
              <h3 style={{ color: TavariStyles.colors.danger }}>Access Denied</h3>
              <p style={styles.noAccessText}>
                You do not have permission to operate the POS register.
              </p>
            </div>
          </div>
        </POSAuthWrapper>
      </SecurityWrapper>
    );
  }

  return (
    <SecurityWrapper>
      <POSAuthWrapper
        requiredRoles={['employee', 'manager', 'owner']}
        requireBusiness={true}
        componentName="POS Register"
      >
        <style>{`
          /* POS register: never let the product column overflow under the cart */
          .pos-register-main {
            min-width: 0;
          }
          .pos-register-products,
          .pos-register-product-scroll {
            min-width: 0;
          }
          @media (max-width: 768px) {
            .pos-register-header {
              left: 0 !important;
            }
          }
          @media (max-width: 900px) {
            .pos-register-root {
              height: auto !important;
              min-height: calc(100vh - 140px) !important;
              overflow-x: hidden !important;
              overflow-y: auto !important;
            }
            .pos-register-main {
              flex-direction: column !important;
              flex: 1 1 auto !important;
              height: auto !important;
              min-height: 0 !important;
              overflow-x: hidden !important;
              overflow-y: visible !important;
            }
            .pos-register-products {
              flex: 1 1 auto !important;
              min-height: min(52vh, 520px) !important;
              overflow: hidden !important;
            }
            .pos-register-cart {
              width: 100% !important;
              max-width: 100% !important;
              flex-shrink: 0 !important;
              box-sizing: border-box !important;
            }
            .pos-name-of-day-banner {
              align-items: flex-start !important;
              flex-direction: column !important;
            }
          }
        `}</style>
        <div className="pos-register-root" style={styles.container}>
          {!!warningSeconds && !isLocked && (
            <div style={styles.warning}>
              Auto-lock in <b>{warningSeconds}s</b>
            </div>
          )}

          <RegisterHeader
            businessName={businessName}
            employeeName={employeeName}
            currentUnlockingUser={currentUnlockingUser}
            authUser={auth.authUser}
            time={time}
            isTabMode={isTabMode}
            cartItems={cartItems}
            isLocked={isLocked}
            registerLocked={registerLocked}
            onSaveCart={handleSaveCartClick}
            onDrawerManager={handleDrawerManagerClick}
            onNavigateToWaivers={handleNavigateToWaivers}
            onNavigateToRefunds={handleNavigateToRefunds}
            onNavigateToSavedCarts={handleNavigateToSavedCarts}
            onNavigateToTabs={handleNavigateToTabs}
            onSwitchUser={() => {
              setPinSwitchMode(true);
              setPinInput('');
              setPinError('');
              setShowPinModal(true);
            }}
            showWaiverButton={waiversModuleEnabled}
            canAccessDrawer={canAccessDrawer}
            canSaveCart={canSaveCart}
            canViewRefunds={canViewRefunds}
            canManageTabs={canManageTabs}
          />

          <div className="pos-register-main" style={styles.mainContent}>
            <div className="pos-register-products" style={styles.productsSection}>
              {nameOfDayPromo && (
                <div className="pos-name-of-day-banner" style={styles.nameOfDayBanner}>
                  <div style={styles.nameOfDayBannerText}>
                    <span style={styles.nameOfDayBannerLabel}>Name of the Day</span>
                    <span style={styles.nameOfDayBannerNames}>
                      {nameOfDayPromo.girlName} &amp; {nameOfDayPromo.boyName}
                    </span>
                  </div>
                  <span style={styles.nameOfDayBannerHint}>
                    Promo active today
                  </span>
                </div>
              )}

              <CategorySelector
                categories={categories}
                activeCategory={activeCategory}
                onCategorySelect={setActiveCategory}
                registerLocked={registerLocked}
              />

              <div className="pos-register-product-scroll" style={styles.productGridContainer}>
                <POSProductGrid 
                  products={filteredProducts}
                  allProducts={products}
                  onAddToCart={handleAddToCart}
                  disabled={registerLocked}
                />
              </div>
            </div>

            <div className="pos-register-cart" style={styles.cartSection}>
              <POSCartPanel
                cartItems={cartItems}
                onRemoveItem={handleRemoveFromCart}
                onUpdateQty={handleUpdateQty}
                onCheckout={handleCheckout}
                onSaveAndExit={handleSaveAndExit}
                sessionLocked={isLocked || registerLocked}
                attachedCustomer={currentCustomer}
                tabMode={isTabMode}
                activeTab={activeTab}
                loyaltyCustomer={currentCustomer}
                loyaltyCandidates={loyaltyCandidates}
                businessSettings={businessSettings}
                currentEmployee={{ id: effectiveUserId, name: effectiveUserName }}
                businessId={auth.selectedBusinessId}
                taxCategories={taxCategories}
                categoryTaxAssignments={categoryTaxAssignments}
                categories={categories}
                savedCartId={savedCartId}
                isFromSavedCarts={isFromSavedCarts}
                onDeleteCart={handleDeleteCart}
                onClearCart={handleClearCart}
                onCustomerAttach={handleCustomerScan}
                onCustomerDetach={handleDetachCustomer}
                onLoyaltyCustomerSwitch={handleSwitchLoyaltyCustomer}
                onAddCustomItem={handleAddCustomItem}
                onUpdateCustomItem={handleUpdateCustomItem}
                indianStatusGstOnly={indianStatusGstOnly}
                indianStatusCertificateNumber={indianStatusCertificateNumber}
                indianStatusGstRate={indianStatusGstRate}
                indianStatusTaxLabel={indianStatusTaxLabel}
                onIndianStatusApply={(cert) => {
                  setIndianStatusGstOnly(true);
                  setIndianStatusCertificateNumber((cert || '').trim());
                }}
                onIndianStatusClear={() => {
                  setIndianStatusGstOnly(false);
                  setIndianStatusCertificateNumber('');
                }}
              />
            </div>
          </div>

          <BarcodeScanHandler onScan={handleBarcodeScan} />
          
          {/* SessionLockModal removed - causing random lockouts */}

          {canAccessDrawer && (
            <POSDrawerComponent
              businessId={auth.selectedBusinessId}
              currentTerminalId={currentTerminalId}
              visible={showDrawerManager}
              onClose={() => setShowDrawerManager(false)}
              onDrawerOpened={handleDrawerOpened}
              onDrawerClosed={handleDrawerClosed}
            />
          )}

          <PinModal
            showPinModal={showPinModal}
            pinInput={pinInput}
            setPinInput={setPinInput}
            pinError={pinError}
            setPinError={setPinError}
            failedAttempts={failedAttempts}
            currentUnlockingUser={currentUnlockingUser}
            onPinUnlock={handlePinUnlock}
            onCancel={
              pinSwitchMode
                ? () => {
                    setShowPinModal(false);
                    setPinSwitchMode(false);
                    setPinInput('');
                    setPinError('');
                  }
                : null
            }
            title={pinSwitchMode ? 'Switch User' : 'Register Locked'}
            subtitle={
              pinSwitchMode
                ? "Enter any staff member's 4-digit PIN to take over the register."
                : "Enter any staff member's 4-digit PIN to unlock the register."
            }
            helperText={
              pinSwitchMode
                ? 'Sales and drawer actions will be attributed to the person whose PIN you enter.'
                : 'Any employee with a PIN can unlock and complete sales.'
            }
            buttonLabel={pinSwitchMode ? 'Switch User' : 'Unlock Register'}
            userInfoLabel={pinSwitchMode ? 'Currently unlocked by:' : 'Last unlocked by:'}
          />

          <SaveCartModal
            showSaveCartModal={showSaveCartModal}
            onSaveCart={saveCartManually}
            onClose={() => setShowSaveCartModal(false)}
          />
        </div>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default POSRegister;