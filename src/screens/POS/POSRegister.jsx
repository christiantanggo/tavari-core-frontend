// screens/POS/POSRegister.jsx - Production Ready with Permissions & Security
import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import POSProductGrid from "../../components/POS/POSProductGrid";
import POSCartPanel from "../../components/POS/POSCartPanel";
import SessionLockModal from "../../components/POS/SessionLockModal";
import BarcodeScanHandler from "../../components/POS/BarcodeScanHandler";
import POSDrawerComponent from "../../components/POS/POSDrawerComponent";
import POSAuthWrapper from "../../components/Auth/POSAuthWrapper";
import PinModal from "../../components/POS/POSRegisterComponents/PinModal";
import RegisterHeader from "../../components/POS/POSRegisterComponents/RegisterHeader";
import SaveCartModal from "../../components/POS/POSRegisterComponents/SaveCartModal";
import CategorySelector from "../../components/POS/POSRegisterComponents/CategorySelector";
import { useSessionLock } from "../../hooks/useSessionLock";
import { usePOSAuth } from "../../hooks/usePOSAuth";
import { usePermissions } from "../../hooks/usePermissions";
import { useTaxCalculations } from "../../hooks/useTaxCalculations";
import { useAuditLog } from "../../hooks/useAuditLog";
import { SecurityWrapper, useSecurityContext } from "../../Security";
import { TavariStyles } from "../../utils/TavariStyles";
import dayjs from "dayjs";
import { supabase } from "../../supabaseClient";
import bcrypt from "bcryptjs";

const POSRegister = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['employee', 'cashier', 'manager', 'owner'],
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

  // Session lock
  const {
    isLocked,
    warningSeconds,
    pinAttempts,
    lockedUntil,
    unlockWithPin,
    managerOverride,
    isOverrideActive,
  } = useSessionLock();

  // App state
  const [businessName, setBusinessName] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [activeCategory, setActiveCategory] = useState(null);
  const [cartItems, setCartItems] = useState([]);
  const [time, setTime] = useState(dayjs().format("hh:mm A"));
  
  // Drawer management
  const [showDrawerManager, setShowDrawerManager] = useState(false);
  const [currentTerminalId, setCurrentTerminalId] = useState(null);
  
  // PIN unlock state
  const [registerLocked, setRegisterLocked] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [currentUnlockingUser, setCurrentUnlockingUser] = useState(null);
  const [posSettings, setPosSettings] = useState({
    pin_required: false,
    lock_on_startup: false,
    lock_after_sale: false
  });
  
  // Loyalty state
  const [currentCustomer, setCurrentCustomer] = useState(null);
  
  // Cart state
  const [cartInitialized, setCartInitialized] = useState(false);
  const [savedCartId, setSavedCartId] = useState(null);
  const [isFromSavedCarts, setIsFromSavedCarts] = useState(false);
  const [businessSettings, setBusinessSettings] = useState({});

  // Tab state
  const [activeTab, setActiveTab] = useState(null);
  const [isTabMode, setIsTabMode] = useState(false);
  const [tabItems, setTabItems] = useState([]);

  // Modal state
  const [showSaveCartModal, setShowSaveCartModal] = useState(false);

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

  // Check for lock after sale on mount
  useEffect(() => {
    if (location.state?.shouldLock) {
      setRegisterLocked(true);
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
    }
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

        const { data, error } = await supabase
          .from('pos_settings')
          .select('pin_required, lock_on_startup, lock_after_sale')
          .eq('business_id', auth.selectedBusinessId)
          .maybeSingle();

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
          
          const shouldLock = data.pin_required === true || data.lock_on_startup === true;
          
          if (shouldLock) {
            setRegisterLocked(true);
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
          setShowPinModal(true);
        }
      } catch (err) {
        await logSecurityEvent('pos_settings_fetch_error', {
          error: err.message,
          business_id: auth.selectedBusinessId,
          terminal_id: currentTerminalId
        }, 'medium');
        
        setRegisterLocked(true);
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
      await logSecurityEvent('pin_unlock_attempted', {
        business_id: auth.selectedBusinessId,
        terminal_id: currentTerminalId,
        logged_in_user: effectiveUserId
      }, 'medium');
      
      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .eq('business_id', auth.selectedBusinessId)
        .eq('active', true);

      if (rolesError) {
        await logSecurityEvent('pin_unlock_roles_error', {
          error: rolesError.message,
          business_id: auth.selectedBusinessId
        }, 'high');
        
        setPinError('Error validating PIN. Please try again.');
        return;
      }

      const allowedRoles = ['employee', 'cashier', 'manager', 'owner', 'admin'];
      const authorizedUserIds = userRoles
        .filter(ur => allowedRoles.includes(ur.role))
        .map(ur => ur.user_id);

      if (authorizedUserIds.length === 0) {
        await logSecurityEvent('pin_unlock_no_authorized_users', {
          business_id: auth.selectedBusinessId,
          terminal_id: currentTerminalId
        }, 'high');
        
        setPinError('No authorized users found');
        return;
      }

      const { data: staffMembers, error: staffError } = await supabase.rpc(
        'get_staff_pins_for_unlock',
        { 
          p_business_id: auth.selectedBusinessId,
          business_user_ids: authorizedUserIds 
        }
      );

      if (staffError) {
        await logSecurityEvent('pin_unlock_staff_error', {
          error: staffError.message,
          business_id: auth.selectedBusinessId
        }, 'high');
        
        setPinError('Error validating PIN. Please try again.');
        return;
      }

      let unlockingUser = null;
      let pinMatched = false;
      
      for (const staff of staffMembers) {
        if (!staff.pin) continue;
        
        if (staff.pin.startsWith('$2b$') || staff.pin.startsWith('$2a$')) {
          const matches = await bcrypt.compare(pinInput, staff.pin);
          if (matches) {
            unlockingUser = staff;
            pinMatched = true;
            break;
          }
        } else {
          const matches = staff.pin === pinInput;
          if (matches) {
            unlockingUser = staff;
            pinMatched = true;
            break;
          }
        }
      }

      if (pinMatched && unlockingUser) {
        const roleMap = new Map(userRoles.map((ur) => [ur.user_id, ur.role]));
        const staffRole = roleMap.get(unlockingUser.id) || 'employee';
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

        showToast(`Register unlocked by ${unlockingUser.full_name || unlockingUser.email}`, 'success');

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
      const { items, customer, cartId } = location.state.resumeCart;
      
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
      
      showToast(`Resumed cart with ${items?.length || 0} items`, 'success');
      
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
      timestamp: Date.now()
    };
    
    sessionStorage.setItem(sessionKey, JSON.stringify(cartData));
  }, [cartItems, currentCustomer, auth.selectedBusinessId, isTabMode, cartInitialized]);

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
        const basePrice = Number(item.price) || 0;
        const itemTotal = basePrice * (Number(item.quantity) || 1);
        return sum + itemTotal;
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
    setSavedCartId(null);
    setIsFromSavedCarts(false);
    
    // Clear cart data in localStorage for customer display
    localStorage.removeItem('tavari_customer_display_cart');
    
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
          supabase.from("businesses").select("name").eq("id", auth.selectedBusinessId).single()
        ]);

        if (userResult.data) {
          setEmployeeName(userResult.data.full_name || userResult.data.email || "Unknown User");
        }

        if (businessResult.data) {
          setBusinessName(businessResult.data.name);
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

  // Fetch business settings
  useEffect(() => {
    const fetchBusinessSettings = async () => {
      try {
        const { data, error } = await supabase
          .from('pos_settings')
          .select('*')
          .eq('business_id', auth.selectedBusinessId)
          .single();

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

  // Fetch products
  useEffect(() => {
    if (!auth.selectedBusinessId || !auth.isReady) return;

    const fetchProducts = async () => {
      try {
        const { data, error } = await supabase
          .from("pos_inventory")
          .select("id, name, price, cost, sku, barcode, category_id, track_stock, stock_quantity, low_stock_threshold, station_ids, image_url, item_tax_overrides, modifier_group_ids")
          .eq("business_id", auth.selectedBusinessId)
          .order("name", { ascending: true });

        if (!error) {
          setProducts(data || []);
        }
      } catch (err) {
        await logSecurityEvent('products_fetch_error', {
          error: err.message,
          business_id: auth.selectedBusinessId
        }, 'low');
      }
    };

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
  }, [auth.selectedBusinessId, auth.isReady]);

  const filteredProducts = activeCategory
    ? products.filter((p) => p.category_id === activeCategory)
    : products;

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
        const existing = prev.find(
          (item) =>
            item.id === product.id &&
            JSON.stringify(item.modifiers || []) === JSON.stringify(product.modifiers || [])
        );

        let newCartItems;
        if (existing) {
          newCartItems = prev.map((item) =>
            item.id === product.id &&
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
        const newTotalPrice = newQuantity * product.price;
        
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
          unit_price: product.price,
          total_price: product.price,
          modifiers: [],
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
        const newTotalPrice = qty * tabItem.price;

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
    
    if (!isTabMode) {
      const sessionKey = `pos_cart_${auth.selectedBusinessId}`;
      sessionStorage.removeItem(sessionKey);
    }
    
    if (isTabMode && activeTab) {
      const cleanSaleData = {
        items: cartItems.map(item => ({
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          modifiers: item.modifiers || [],
          category_id: item.category_id,
          item_tax_overrides: item.item_tax_overrides
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
          item_tax_overrides: item.item_tax_overrides
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

  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      backgroundColor: TavariStyles.colors.gray50,
      paddingTop: '80px',
      overflow: 'hidden'
    },
    
    warning: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.warning,
      marginBottom: TavariStyles.spacing.md,
      position: 'fixed',
      top: '80px',
      left: '0',
      right: '0',
      zIndex: 1000
    },
    
    mainContent: {
      display: 'flex',
      flex: 1,
      height: 'calc(100vh - 80px)',
      overflow: 'hidden'
    },
    
    productsSection: {
      flex: '1',
      display: 'flex',
      flexDirection: 'column',
      padding: TavariStyles.spacing.lg,
      paddingRight: TavariStyles.spacing.sm,
      overflow: 'hidden',
      minWidth: '400px'
    },
    
    cartSection: {
      width: '380px',
      flexShrink: 0,
      padding: TavariStyles.spacing.lg,
      paddingLeft: TavariStyles.spacing.sm,
      overflow: 'hidden'
    },
    
    productGridContainer: {
      flex: 1,
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
          requiredRoles={['employee', 'cashier', 'manager', 'owner']}
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
        requiredRoles={['employee', 'cashier', 'manager', 'owner']}
        requireBusiness={true}
        componentName="POS Register"
      >
        <div style={styles.container}>
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
            onNavigateToRefunds={handleNavigateToRefunds}
            onNavigateToSavedCarts={handleNavigateToSavedCarts}
            onNavigateToTabs={handleNavigateToTabs}
            canAccessDrawer={canAccessDrawer}
            canSaveCart={canSaveCart}
            canViewRefunds={canViewRefunds}
            canManageTabs={canManageTabs}
          />

          <div style={styles.mainContent}>
            <div style={styles.productsSection}>
              <CategorySelector
                categories={categories}
                activeCategory={activeCategory}
                onCategorySelect={setActiveCategory}
                registerLocked={registerLocked}
              />

              <div style={styles.productGridContainer}>
                <POSProductGrid 
                  products={filteredProducts} 
                  onAddToCart={handleAddToCart}
                  disabled={registerLocked}
                />
              </div>
            </div>

            <div style={styles.cartSection}>
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
              />
            </div>
          </div>

          <BarcodeScanHandler onScan={handleBarcodeScan} />
          
          {isLocked && (
            <SessionLockModal
              visible={isLocked}
              onSubmitPin={unlockWithPin}
              onManagerOverride={managerOverride}
              pinAttempts={pinAttempts}
              lockedUntil={lockedUntil}
              warningSeconds={warningSeconds}
              overrideActive={isOverrideActive()}
            />
          )}

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