// screens/Dining/DiningOrderScreen.jsx - WITH NEW PERMISSION SYSTEM
import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import POSProductGrid from "../../components/POS/POSProductGrid";
import DiningCartPanel from "../../components/Dining/DiningCartPanel";
import SessionLockModal from "../../components/POS/SessionLockModal";
import BarcodeScanHandler from "../../components/POS/BarcodeScanHandler";
import POSDrawerComponent from "../../components/POS/POSDrawerComponent";
import PinModal from "../../components/POS/POSRegisterComponents/PinModal";
import RegisterHeader from "../../components/POS/POSRegisterComponents/RegisterHeader";
import CategorySelector from "../../components/POS/POSRegisterComponents/CategorySelector";
import SeatPaymentModal from "../../components/Dining/SeatPaymentModal";
import { useSessionLock } from "../../hooks/useSessionLock";
import { usePOSAuth } from "../../hooks/usePOSAuth";
import { usePermissions } from "../../hooks/usePermissions";
import PermissionGate from "../../components/Auth/PermissionGate";
import { useTaxCalculations } from "../../hooks/useTaxCalculations";
import { useAuditLog } from "../../hooks/useAuditLog";
import { TavariStyles } from "../../utils/TavariStyles";
import toast from 'react-hot-toast';
import dayjs from "dayjs";
import { supabase } from "../../supabaseClient";
import bcrypt from "bcryptjs";

const DiningOrderScreen = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'DiningOrderScreen'
  });

  // NEW: Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    isOwner, 
    isManager,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Centralized audit logging
  const { logPOS, logSecurity, logManagerOverride } = useAuditLog();

  const {
    taxCategories,
    categoryTaxAssignments,
    calculateTotalTax,
    applyCashRounding
  } = useTaxCalculations(auth.selectedBusinessId);

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
  
  // Drawer management state
  const [showDrawerManager, setShowDrawerManager] = useState(false);
  const [currentTerminalId, setCurrentTerminalId] = useState(null);
  
  // Multi-staff PIN unlock state
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
  
  // Seat payment selection modal
  const [showSeatPaymentModal, setShowSeatPaymentModal] = useState(false);
  const [pendingCheckoutData, setPendingCheckoutData] = useState(null);
  
  // LOYALTY STATE
  const [currentCustomer, setCurrentCustomer] = useState(null);
  
  // Business settings
  const [businessSettings, setBusinessSettings] = useState({});

  // Tab state - DINING SPECIFIC
  const [activeTab, setActiveTab] = useState(null);
  const [tabItems, setTabItems] = useState([]);
  const [tableInfo, setTableInfo] = useState(null);
  
  // DINING-SPECIFIC: Seat selection state
  const [guestCount, setGuestCount] = useState(null);
  const [selectedSeat, setSelectedSeat] = useState('All');

  // Permission checks
  const canTakeOrders = hasPermission('dining.orders.create');
  const canModifyOrders = hasPermission('dining.orders.modify');
  const canViewTables = hasPermission('dining.tables.view');

  // Check permissions on load
  useEffect(() => {
    if (!permissionsLoading && !canTakeOrders) {
      toast.error('You do not have permission to take dining orders');
      navigate('/dashboard/dining/table-map');
    }
  }, [permissionsLoading, canTakeOrders, navigate]);

  // Load terminal ID on component mount
  useEffect(() => {
    const storedTerminalId = localStorage.getItem('tavari_terminal_id');
    if (storedTerminalId) {
      setCurrentTerminalId(storedTerminalId);
    } else {
      const terminalId = generateTerminalId();
      setCurrentTerminalId(terminalId);
    }
  }, []);

  // Generate terminal ID function
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

  // Fetch POS settings for lock configuration
  useEffect(() => {
    const fetchPosSettings = async () => {
      if (!auth.selectedBusinessId) {
        return;
      }
      
      try {
        const { data, error } = await supabase
          .from('pos_settings')
          .select('pin_required, lock_on_startup, lock_after_sale')
          .eq('business_id', auth.selectedBusinessId)
          .single();

        if (data && !error) {
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
        console.error('POS Settings: Exception occurred:', err);
        setRegisterLocked(true);
        setShowPinModal(true);
      }
    };

    if (auth.isReady && auth.selectedBusinessId) {
      fetchPosSettings();
    }
  }, [auth.isReady, auth.selectedBusinessId, currentTerminalId, logPOS]);

  // Multi-staff PIN unlock handler
  const handlePinUnlock = async () => {
    if (!pinInput || pinInput.length !== 4) {
      setPinError('PIN must be 4 digits');
      return;
    }

    try {
      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .eq('business_id', auth.selectedBusinessId)
        .eq('active', true);

      if (rolesError) {
        setPinError('Error validating PIN. Please try again.');
        return;
      }

      const allowedRoles = ['employee', 'manager', 'owner', 'admin'];
      const authorizedUserIds = userRoles
        .filter(ur => allowedRoles.includes(ur.role))
        .map(ur => ur.user_id);

      if (authorizedUserIds.length === 0) {
        setPinError('No authorized users found');
        return;
      }

      const { data: staffMembers, error: staffError } = await supabase
        .from('users')
        .select('id, full_name, email, pin')
        .in('id', authorizedUserIds);

      if (staffError) {
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
        setRegisterLocked(false);
        setShowPinModal(false);
        setPinInput('');
        setPinError('');
        setFailedAttempts(0);
        setCurrentUnlockingUser(unlockingUser);

        await logPOS('register_unlocked', {
          unlocked_by_id: unlockingUser.id,
          unlocked_by_name: unlockingUser.full_name || unlockingUser.email,
          unlock_method: 'pin',
          terminal_id: currentTerminalId,
          previous_failed_attempts: failedAttempts
        });

        toast.success(`Register unlocked by ${unlockingUser.full_name || unlockingUser.email}`);

      } else {
        const newFailedCount = failedAttempts + 1;
        setFailedAttempts(newFailedCount);
        setPinInput('');

        await logSecurity('failed_register_unlock', {
          attempt_number: newFailedCount,
          terminal_id: currentTerminalId,
          pin_length: pinInput.length,
          business_id: auth.selectedBusinessId
        });

        if (newFailedCount >= 3) {
          setPinError('Too many failed attempts. Contact a manager.');
          
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
      console.error('PIN Unlock: Exception:', error);
      setPinError('Error validating PIN. Please try again.');
    }
  };

  // Drawer event handlers
  const handleDrawerOpened = (drawer) => {
    logPOS('cash_drawer_opened', {
      terminal_id: currentTerminalId,
      drawer_id: drawer?.id,
      opened_by: auth.authUser?.id,
      opened_by_name: employeeName
    });
    
    toast.success('Cash drawer opened successfully');
  };

  const handleDrawerClosed = (drawer) => {
    logPOS('cash_drawer_closed', {
      terminal_id: currentTerminalId,
      drawer_id: drawer?.id,
      closed_by: auth.authUser?.id,
      closed_by_name: employeeName,
      expected_amount: drawer?.expected_amount,
      actual_amount: drawer?.actual_amount,
      variance: drawer?.variance
    });
    
    toast.success('Cash drawer closed successfully');
  };

  // DINING-SPECIFIC: Handle table/tab data from navigation
  useEffect(() => {
    if (location.state?.activeTab) {
      const tab = location.state.activeTab;
      const guestCountFromState = location.state.guestCount || tab.guest_count || 2;
      
      setActiveTab(tab);
      setGuestCount(guestCountFromState);
      setTableInfo({
        tableId: location.state.tableId || tab.table_id,
        tableName: location.state.tableName || tab.customer_name
      });
      
      logPOS('dining_mode_activated', {
        tab_id: tab.id,
        table_name: location.state.tableName,
        guest_count: guestCountFromState,
        terminal_id: currentTerminalId
      });
      
      if (tab.loyalty_customer_id) {
        loadTabCustomer(tab.loyalty_customer_id);
      }

      loadTabItems(tab.id);
    }
  }, [location.state, logPOS, currentTerminalId]);

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
      console.error('Error loading tab customer:', err);
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
        const convertedItems = data.map(item => {
          const itemTotal = (item.unit_price || 0) * (item.quantity || 1);
          const paidAmount = parseFloat(item.paid_amount || 0);
          const isFullyPaid = paidAmount >= itemTotal - 0.01; // Allow small rounding differences
          const isPartiallyPaid = paidAmount > 0 && !isFullyPaid;
          
          return {
            id: item.product_id || item.id,
            name: item.name,
            price: item.unit_price,
            quantity: item.quantity,
            modifiers: item.modifiers || [],
            notes: item.notes,
            category_id: item.category_id,
            item_tax_overrides: item.item_tax_overrides,
            tab_item_id: item.id,
            seat: item.seat || 'All',
            paid_amount: paidAmount,
            is_paid: isFullyPaid,
            is_partially_paid: isPartiallyPaid,
            remaining_balance: Math.max(0, itemTotal - paidAmount)
          };
        });
        
        setTabItems(convertedItems);
        // Filter out fully paid items from cart display, but keep partially paid
        const unpaidItems = convertedItems.filter(item => !item.is_paid);
        setCartItems(unpaidItems);
      }
    } catch (err) {
      console.error('Error loading tab items:', err);
    }
  };

  // Clock updater
  useEffect(() => {
    const interval = setInterval(() => {
      setTime(dayjs().format("hh:mm A"));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch user and business info
  useEffect(() => {
    const fetchUserInfo = async () => {
      if (!auth.authUser || !auth.selectedBusinessId) return;

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
        console.error('Error fetching user info:', err);
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
        console.error("Categories fetch error:", err);
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
          .select("id, name, price, cost, sku, barcode, category_id, category_sort_order, track_stock, stock_quantity, low_stock_threshold, station_ids, image_url, item_tax_overrides, modifier_group_ids")
          .eq("business_id", auth.selectedBusinessId)
          .or("is_active.eq.true,is_active.is.null")
          .order("name", { ascending: true });

        if (!error) {
          setProducts(data || []);
        }
      } catch (err) {
        console.error("Products fetch error:", err);
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

  const filteredProducts = useMemo(() => {
    if (!activeCategory) return products;
    return [...products]
      .filter((p) => p.category_id === activeCategory)
      .sort((a, b) => {
        const ao = Number(a.category_sort_order ?? 0);
        const bo = Number(b.category_sort_order ?? 0);
        if (ao !== bo) return ao - bo;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
  }, [products, activeCategory]);

  // DINING-SPECIFIC: Add item with seat assignment
  const handleAddToCart = (product) => {
    if (isLocked || registerLocked) return;
    
    // Check permission
    if (!canTakeOrders) {
      toast.error('You do not have permission to add items to tables');
      return;
    }
    
    // Use current selectedSeat value - ensure we're using the latest state
    const currentSeat = selectedSeat;
    
    console.log('Adding item to cart:', {
      product: product.name,
      selectedSeat: currentSeat,
      productId: product.id
    });
    
    logPOS('product_added_to_cart_dining', {
      product_id: product.id,
      product_name: product.name,
      product_price: product.price,
      seat: currentSeat,
      table_id: tableInfo?.tableId,
      terminal_id: currentTerminalId
    });
    
    if (activeTab) {
      // Pass the current seat explicitly to ensure it's used
      addItemToTab(product, currentSeat);
    }
  };

  const handleRemoveFromCart = (productId) => {
    if (isLocked || registerLocked) return;
    
    // Check permission
    if (!canModifyOrders) {
      toast.error('You do not have permission to remove items from tables');
      return;
    }
    
    logPOS('product_removed_from_cart_dining', {
      product_id: productId,
      table_id: tableInfo?.tableId,
      terminal_id: currentTerminalId
    });
    
    if (activeTab) {
      removeItemFromTab(productId);
    }
  };

  const handleUpdateQty = (productId, qty) => {
    if (isLocked || registerLocked) return;
    if (qty <= 0) return handleRemoveFromCart(productId);
    
    // Check permission
    if (!canModifyOrders) {
      toast.error('You do not have permission to modify table orders');
      return;
    }
    
    logPOS('product_quantity_updated_dining', {
      product_id: productId,
      new_quantity: qty,
      table_id: tableInfo?.tableId,
      terminal_id: currentTerminalId
    });
    
    if (activeTab) {
      updateTabItemQty(productId, qty);
    }
  };

  // Tab functions with seat assignment
  const addItemToTab = async (product, seatOverride = null) => {
    // Use seatOverride if provided, otherwise use current selectedSeat state
    const seatToUse = seatOverride !== null ? seatOverride : selectedSeat;
    await performAddItemToTab(product, seatToUse);
  };

  const performAddItemToTab = async (product, seatToUse) => {
    try {
      // Use the seat value passed in, not the state directly
      const seat = seatToUse !== undefined ? seatToUse : selectedSeat;
      
      console.log('performAddItemToTab:', {
        product: product.name,
        seat: seat,
        selectedSeat: selectedSeat,
        seatToUse: seatToUse
      });
      
      const existingTabItem = tabItems.find(item => 
        item.id === product.id && item.seat === seat
      );
      
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
            item.id === product.id && item.seat === seat
              ? { ...item, quantity: newQuantity }
              : item
          )
        );
        setTabItems(prev => 
          prev.map(item => 
            item.id === product.id && item.seat === seat
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
          added_by: auth.authUser.id,
          seat: seat
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
          tab_item_id: newTabItem.id,
          seat: seat
        };

        setCartItems(prev => [...prev, cartItem]);
        setTabItems(prev => [...prev, cartItem]);
      }

      toast.success(`Added ${product.name} to ${seat === 'All' ? 'table' : 'Seat ' + seat}`);
    } catch (err) {
      toast.error('Error adding item to table: ' + err.message);
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
      toast.error('Error removing item from table');
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
      toast.error('Error updating quantity');
    }
  };

  // Barcode scanning
  const handleBarcodeScan = (code) => {
    if (isLocked || registerLocked) return;
    
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
      toast.success(`Added ${foundProduct.name} to cart`);
      
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
    
    try {
      const { data, error } = await supabase
        .from('pos_loyalty_accounts')
        .select('*')
        .eq('id', customerId)
        .eq('business_id', auth.selectedBusinessId)
        .eq('is_active', true)
        .single();

      if (error || !data) {
        toast.error('Customer not found or inactive');
        
        logPOS('customer_scan_failed', {
          scanned_code: customerId,
          error: error?.message || 'Customer not found',
          terminal_id: currentTerminalId
        });
        return;
      }

      setCurrentCustomer(data);
      toast.success(`Customer attached: ${data.customer_name}`);

      logPOS('customer_attached', {
        customer_id: data.id,
        customer_name: data.customer_name,
        customer_balance: data.balance,
        attachment_method: 'qr_scan',
        terminal_id: currentTerminalId
      });

    } catch (err) {
      console.error('Error scanning customer QR code:', err);
      toast.error('Error scanning customer QR code');
    }
  };

  const handleDetachCustomer = async () => {
    if (currentCustomer) {
      logPOS('customer_detached', {
        customer_id: currentCustomer.id,
        customer_name: currentCustomer.customer_name,
        terminal_id: currentTerminalId
      });
    }
    
    setCurrentCustomer(null);
    toast.success('Customer detached');
  };

  // DINING-SPECIFIC: Handle seat selection
  const handleSeatSelect = (seat) => {
    setSelectedSeat(seat);
    logPOS('seat_selected', {
      seat: seat,
      table_id: tableInfo?.tableId,
      terminal_id: currentTerminalId
    });
  };

  // DINING-SPECIFIC: Save and Exit (return to table map)
  const handleSaveAndExit = async () => {
    // Check permission
    if (!canViewTables) {
      toast.error('You do not have permission to access table map');
      return;
    }

    logPOS('save_and_exit_table', {
      item_count: cartItems.length,
      tab_id: activeTab?.id,
      table_id: tableInfo?.tableId,
      terminal_id: currentTerminalId
    });
    
    // Items are already saved to the tab in real-time, just navigate back
    navigate('/dashboard/dining/table-map');
    toast.success('Returning to table map');
  };

  const handleClearCart = () => {
    // For dining, we don't clear the cart - items stay with the tab
    toast.info('Items are saved to the table');
  };

  // Checkout handler for dining - shows seat selection modal first
  // ONLY for dining mode (tabMode with guestCount)
  const handleCheckout = (checkoutData) => {
    if (isLocked || registerLocked) return;
    
    // Check permission to close tables
    if (!hasPermission('dining.tables.close')) {
      toast.error('You do not have permission to close out tables');
      return;
    }
    
    // ONLY show seat payment modal if this is dining mode (has guestCount)
    // Regular register checkout goes directly to payment screen
    if (guestCount && guestCount > 0) {
      // Store checkout data and show seat selection modal
      setPendingCheckoutData(checkoutData);
      setShowSeatPaymentModal(true);
    } else {
      // Regular register - go directly to payment (shouldn't happen in dining screen, but safety check)
      navigate('/dashboard/pos/payment', {
        state: { saleData: checkoutData }
      });
    }
  };

  // Handle seat payment selection confirmation
  const handleSeatPaymentConfirm = (paymentSelection) => {
    if (!pendingCheckoutData) return;

    console.log('Processing payment for seats:', paymentSelection);
    
    logPOS('dining_checkout_initiated', {
      item_count: paymentSelection.items.length,
      selected_seats: paymentSelection.selectedSeats,
      subtotal: paymentSelection.subtotal || 0,
      total: paymentSelection.total || 0,
      table_share: paymentSelection.tableShare || 0,
      has_customer: !!currentCustomer,
      table_id: tableInfo?.tableId,
      terminal_id: currentTerminalId
    });
    
    // Navigate to payment screen with selected seat items
    // CRITICAL: Include tab_item_id so we can mark items as paid
    const cleanSaleData = {
      items: paymentSelection.items.map(item => {
        const mappedItem = {
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity || item.originalQuantity || 1,
          modifiers: item.modifiers || [],
          category_id: item.category_id,
          item_tax_overrides: item.item_tax_overrides,
          seat: item.seat || item.isTableShare ? 'All' : item.seat,
          isTableShare: item.isTableShare || false,
          tab_item_id: item.tab_item_id || null, // Store tab_item_id to mark as paid
        };
        
        // For table share items, include original table items with their tab_item_ids
        if (item.isTableShare && item.originalTableItems) {
          mappedItem.originalTableItems = item.originalTableItems.map(tItem => ({
            ...tItem,
            tab_item_id: tItem.tab_item_id || null // Ensure tab_item_id is included
          }));
        }
        
        return mappedItem;
      }),
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
        customer_name: activeTab.customer_name || tableInfo?.tableName,
        customer_phone: activeTab.customer_phone,
        total_amount: activeTab.total_amount,
        table_id: tableInfo?.tableId
      },
      tab_mode: true,
      dining_mode: true,
      table_info: tableInfo,
      guest_count: guestCount,
      selected_seats: paymentSelection.selectedSeats,
      subtotal: paymentSelection.subtotal || 0,
      total_amount: paymentSelection.total || 0,
      tax_amount: paymentSelection.tax || 0,
      table_share: paymentSelection.tableShare || 0,
      lock_after_sale: posSettings.lock_after_sale,
      pin_required: posSettings.pin_required
    };
    
    // Close modal and navigate to review screen first (like regular flow)
    setShowSeatPaymentModal(false);
    setPendingCheckoutData(null);
    
    // Navigate to sale review screen first, then it will navigate to payment
    navigate('/dashboard/pos/sale-review', {
      state: { 
        saleData: cleanSaleData,
        from: 'dining'
      }
    });
  };

  // Header action handlers
  const handleDrawerManagerClick = () => {
    setShowDrawerManager(true);
  };

  const handleNavigateToRefunds = () => {
    navigate('/dashboard/pos/refunds');
  };

  const handleNavigateToTabs = () => {
    navigate('/dashboard/pos/tabs');
  };

  // Styles definition - must be before early returns
  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      backgroundColor: TavariStyles.colors.gray50,
      paddingTop: '80px',
      overflow: 'hidden'
    },
    
    loadingContainer: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      gap: '20px'
    },

    loadingSpinner: {
      width: '40px',
      height: '40px',
      border: '4px solid #f3f3f3',
      borderTop: '4px solid #14B8A6',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite'
    },

    loadingText: {
      fontSize: '16px',
      color: '#666'
    },

    noAccessContainer: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '40px'
    },

    noAccessCard: {
      backgroundColor: '#fff',
      border: '2px solid #e9ecef',
      borderRadius: '12px',
      padding: '50px',
      maxWidth: '500px',
      textAlign: 'center'
    },

    noAccessTitle: {
      fontSize: '24px',
      fontWeight: 'bold',
      color: '#dc3545',
      marginBottom: '15px'
    },

    noAccessText: {
      fontSize: '16px',
      color: '#666',
      marginBottom: '20px'
    },

    permissionsRequired: {
      backgroundColor: '#f8f9fa',
      padding: '15px',
      borderRadius: '6px',
      marginBottom: '20px',
      fontSize: '14px'
    },

    backButton: {
      padding: '12px 24px',
      backgroundColor: '#14B8A6',
      color: '#fff',
      border: 'none',
      borderRadius: '6px',
      fontSize: '16px',
      fontWeight: 'bold',
      cursor: 'pointer'
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
    }
  };

  // Loading state
  if (permissionsLoading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingSpinner}></div>
        <p style={styles.loadingText}>Loading permissions...</p>
      </div>
    );
  }

  // No access screen
  if (!canTakeOrders) {
    return (
      <div style={styles.noAccessContainer}>
        <div style={styles.noAccessCard}>
          <h2 style={styles.noAccessTitle}>Access Denied</h2>
          <p style={styles.noAccessText}>
            You do not have permission to take dining orders.
          </p>
          <div style={styles.permissionsRequired}>
            <strong>Required Permission:</strong> Take Table Orders
          </div>
          <button 
            style={styles.backButton}
            onClick={() => navigate('/dashboard/dining/table-map')}
          >
            Return to Table Map
          </button>
        </div>
      </div>
    );
  }

  return (
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
        isTabMode={true}
        cartItems={cartItems}
        isLocked={isLocked}
        registerLocked={registerLocked}
        onSaveCart={() => {}}
        onDrawerManager={handleDrawerManagerClick}
        onNavigateToRefunds={handleNavigateToRefunds}
        onNavigateToSavedCarts={() => {}}
        onNavigateToTabs={handleNavigateToTabs}
        tableName={tableInfo?.tableName}
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
              disabled={registerLocked || !canTakeOrders || showPinModal}
            />
          </div>
        </div>

        <div style={styles.cartSection}>
          <DiningCartPanel
            cartItems={cartItems}
            onRemoveItem={handleRemoveFromCart}
            onUpdateQty={handleUpdateQty}
            onCheckout={handleCheckout}
            onSaveAndExit={handleSaveAndExit}
            sessionLocked={isLocked || registerLocked}
            attachedCustomer={currentCustomer}
            tabMode={true}
            activeTab={activeTab}
            loyaltyCustomer={currentCustomer}
            businessSettings={businessSettings}
            currentEmployee={{ id: auth.authUser?.id, name: employeeName }}
            businessId={auth.selectedBusinessId}
            taxCategories={taxCategories}
            categoryTaxAssignments={categoryTaxAssignments}
            categories={categories}
            onClearCart={handleClearCart}
            onCustomerAttach={handleCustomerScan}
            onCustomerDetach={handleDetachCustomer}
            guestCount={guestCount}
            selectedSeat={selectedSeat}
            onSeatSelect={handleSeatSelect}
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

      <POSDrawerComponent
        businessId={auth.selectedBusinessId}
        currentTerminalId={currentTerminalId}
        visible={showDrawerManager}
        onClose={() => setShowDrawerManager(false)}
        onDrawerOpened={handleDrawerOpened}
        onDrawerClosed={handleDrawerClosed}
      />

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

      {pendingCheckoutData && (
        <SeatPaymentModal
          visible={showSeatPaymentModal}
          onClose={() => {
            setShowSeatPaymentModal(false);
            setPendingCheckoutData(null);
          }}
          onConfirm={handleSeatPaymentConfirm}
          cartItems={cartItems}
          guestCount={guestCount}
          subtotal={pendingCheckoutData.subtotal || 0}
          tax={pendingCheckoutData.tax || 0}
          total={pendingCheckoutData.total || 0}
        />
      )}
    </div>
  );
};

// Add CSS animation
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;
if (!document.querySelector('#dining-order-styles')) {
  styleSheet.id = 'dining-order-styles';
  document.head.appendChild(styleSheet);
}

export default DiningOrderScreen;