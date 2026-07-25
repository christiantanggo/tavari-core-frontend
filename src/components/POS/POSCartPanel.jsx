// components/POS/POSCartPanel.jsx - Complete refactored version with Save & Exit functionality
import React, { useState, useEffect } from 'react';
import { TavariStyles } from '../../utils/TavariStyles';
import { ShoppingCart, Plus, Minus, Trash2, User, Search, History, X, Pencil, BadgeCheck } from 'lucide-react';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { supabase } from '../../supabaseClient';
import TavariCheckbox from '../UI/TavariCheckbox';
import {
  getSpendableDollarsInDollarsMode,
  getSpendableDollarsInPointsMode,
  isPointsLoyaltyMode
} from '../../utils/posLoyaltyMoney';
import { calculateTotalLoyaltyPointsToEarn } from '../../utils/loyaltyRewards';
import { getPosLineSubtotal } from '../../utils/posLinePricing';

const POSCartPanel = ({
  cartItems = [],
  onRemoveItem,
  onUpdateQty,
  onCheckout,
  sessionLocked = false,
  attachedCustomer = null,
  tabMode = false,
  activeTab = null,
  loyaltyCustomer = null,
  loyaltyCandidates = [],
  businessSettings = {},
  currentEmployee = null,
  businessId,
  taxCategories = [],
  categoryTaxAssignments = [],
  categories = [],
  
  // Cart deletion props
  savedCartId = null,
  isFromSavedCarts = false,
  onDeleteCart = null,
  onClearCart = null,
  
  // Customer management props
  onCustomerAttach = null,
  onCustomerDetach = null,
  onLoyaltyCustomerSwitch = null,
  
  // Save and Exit Tab functionality
  onSaveAndExit = null,
  
  // Custom item (e.g. birthday party balance)
  onAddCustomItem = null,
  onUpdateCustomItem = null,

  // Indian Status (GST-only) — whole order; cleared when cart is cleared
  indianStatusGstOnly = false,
  indianStatusCertificateNumber = '',
  indianStatusGstRate = 0.05,
  indianStatusTaxLabel = 'GST (Indian Status)',
  onIndianStatusApply = null,
  onIndianStatusClear = null
}) => {
	
  // Custom item modals
  const [showCustomItemModal, setShowCustomItemModal] = useState(false);
  const [customItemName, setCustomItemName] = useState('');
  const [customItemPrice, setCustomItemPrice] = useState('');
  const [customItemTaxIncluded, setCustomItemTaxIncluded] = useState(true);
  const [editingCustomItem, setEditingCustomItem] = useState(null);
  const [editCustomName, setEditCustomName] = useState('');
  const [editCustomPrice, setEditCustomPrice] = useState('');
  const [editCustomTaxIncluded, setEditCustomTaxIncluded] = useState(true);

  const [showIndianStatusModal, setShowIndianStatusModal] = useState(false);
  const [indianCertDraft, setIndianCertDraft] = useState('');
	
  // LOYALTY STATE
  const [loyaltySettings, setLoyaltySettings] = useState(null);
  const [availableLoyaltyCredit, setAvailableLoyaltyCredit] = useState(0);
  const [loyaltyPointsToEarn, setLoyaltyPointsToEarn] = useState(0);
  const [autoLoyaltyApplied, setAutoLoyaltyApplied] = useState(0);
  const [dailyUsageRemaining, setDailyUsageRemaining] = useState(0);
  const [usedToday, setUsedToday] = useState(0);
  const [showLoyaltyHistory, setShowLoyaltyHistory] = useState(false);
  const [loyaltyHistory, setLoyaltyHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Transaction detail modal state
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [transactionLoading, setTransactionLoading] = useState(false);

  // Customer entry state
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [manualCustomerId, setManualCustomerId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showLoyaltySwitchModal, setShowLoyaltySwitchModal] = useState(false);
  const [loyaltySwitchBusy, setLoyaltySwitchBusy] = useState(false);

  // Tax calculation hook
  const {
    calculateTotalTax,
    getCombinedTaxRate,
    applyCashRounding,
    formatTaxAmount
  } = useTaxCalculations(businessId);

  // Load loyalty settings
  useEffect(() => {
    const loadLoyaltySettings = async () => {
      if (!businessId) return;

      try {
        const { data: settings, error } = await supabase
          .from('pos_loyalty_settings')
          .select('*')
          .eq('business_id', businessId)
          .maybeSingle();

        if (error && error.code && error.code !== 'PGRST116') {
          console.error('Error loading loyalty settings:', error);
          return;
        }

        if (settings) {
          setLoyaltySettings(settings);
        }
      } catch (err) {
        console.error('Failed to load loyalty settings:', err);
      }
    };

    loadLoyaltySettings();
  }, [businessId]);

  // Calculate loyalty metrics when cart or customer changes
  useEffect(() => {
    if (loyaltyCustomer && loyaltySettings?.is_active && cartItems.length > 0) {
      calculateLoyaltyMetrics();
    } else {
      setAvailableLoyaltyCredit(0);
      setLoyaltyPointsToEarn(0);
      setAutoLoyaltyApplied(0);
      setDailyUsageRemaining(0);
      setUsedToday(0);
    }
  }, [cartItems, loyaltyCustomer, loyaltySettings]);

  // Search customers when search term changes
  useEffect(() => {
    if (searchTerm.trim().length >= 2) {
      searchCustomers(searchTerm.trim());
    } else {
      setSearchResults([]);
    }
  }, [searchTerm]);

  // Helper function to get today's date in business timezone
  const getTodayInBusinessTimezone = () => {
    const businessTimezone = businessSettings?.timezone || 'America/Toronto';
    const today = new Date();
    
    const todayInBizTz = new Intl.DateTimeFormat('sv-SE', {
      timeZone: businessTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(today);
    
    return todayInBizTz;
  };

  // LOYALTY CALCULATIONS
  const calculateLoyaltyMetrics = async () => {
    if (!loyaltyCustomer || !loyaltySettings?.is_active || cartItems.length === 0) {
      return;
    }

    try {
      const today = getTodayInBusinessTimezone();
      
      // Get today's usage - FIXED: This should be in DOLLARS, not points
      const { data: todayUsage } = await supabase
        .from('pos_loyalty_daily_usage')
        .select('amount_used')
        .eq('loyalty_account_id', loyaltyCustomer.id)
        .eq('usage_date', today)
        .maybeSingle();

      // FIXED: Convert points to dollars if loyalty mode is points
      let usedTodayDollars = todayUsage?.amount_used || 0;
      
      // If the stored value looks like points (large number) and we're in points mode, convert it
      if (loyaltySettings.loyalty_mode === 'points' && usedTodayDollars > 100) {
        // Convert points to dollars: points ÷ redemption_rate × 10
        usedTodayDollars = (usedTodayDollars / loyaltySettings.redemption_rate) * 10;
      }
      
      setUsedToday(usedTodayDollars);
      
      // Calculate daily limit in dollars
      const rate = Number(loyaltySettings.redemption_rate) || 10000;
      const dailyLimitPoints = loyaltySettings.max_redemption_per_day || 5000;
      const dailyLimitDollars = (dailyLimitPoints / rate) * 10;
      const remainingDailyLimitDollars = Math.max(0, dailyLimitDollars - usedTodayDollars);
      
      setDailyUsageRemaining(remainingDailyLimitDollars);
      
      // Calculate cart subtotal
      const subtotal = cartItems.reduce((sum, item) => {
        return sum + getPosLineSubtotal(item);
      }, 0);

      // Spendable dollars: store credit + points (or legacy pool) — not raw `balance` alone in points mode
      const customerBalanceDollars = isPointsLoyaltyMode(loyaltySettings)
        ? getSpendableDollarsInPointsMode(loyaltyCustomer, loyaltySettings)
        : getSpendableDollarsInDollarsMode(loyaltyCustomer);
      
      // Available credit calculation
      const maxUsableDollars = Math.min(customerBalanceDollars, remainingDailyLimitDollars, subtotal);
      setAvailableLoyaltyCredit(Math.max(0, maxUsableDollars));

      // Auto-apply logic preview
      let autoApplyAmount = 0;
      if (loyaltySettings.auto_apply === 'always' && maxUsableDollars > 0) {
        const minRedemptionPoints = loyaltySettings.min_redemption || 5000;
        const minRedemptionDollars = (minRedemptionPoints / loyaltySettings.redemption_rate) * 10;
        
        if (maxUsableDollars >= minRedemptionDollars) {
          if (loyaltySettings.allow_partial_redemption) {
            autoApplyAmount = Math.min(maxUsableDollars, subtotal);
          } else {
            autoApplyAmount = Math.min(minRedemptionDollars, maxUsableDollars, subtotal);
          }
        }
      }
      
      setAutoLoyaltyApplied(autoApplyAmount);

      // Calculate points to earn
      const earnRatePercent = loyaltySettings.earn_rate_percentage / 100;
      const taxableAmountForEarning = subtotal - autoApplyAmount;
      const dollarsToEarn = taxableAmountForEarning * earnRatePercent;
      const pointsToEarn = calculateTotalLoyaltyPointsToEarn({
        subtotal: taxableAmountForEarning,
        earnRatePercentage: loyaltySettings.earn_rate_percentage,
        redemptionRate: rate,
        cartItems,
      });
      
      setLoyaltyPointsToEarn(pointsToEarn);

    } catch (err) {
      console.error('Error calculating loyalty metrics:', err);
    }
  };

  // Load loyalty history
  const loadLoyaltyHistory = async () => {
    if (!loyaltyCustomer || !businessId) {
      console.warn('Cannot load loyalty history - missing data:', {
        loyaltyCustomer: !!loyaltyCustomer,
        businessId: !!businessId
      });
      return;
    }

    console.log('Loading loyalty history for customer:', loyaltyCustomer.id);
    
    // ALWAYS show the modal, even if loading or no data
    setShowLoyaltyHistory(true);
    setHistoryLoading(true);

    try {
      const today = getTodayInBusinessTimezone();
      console.log('Today in business timezone:', today);
      
      const startTime = today + 'T00:00:00.000Z';
      const endTime = today + 'T23:59:59.999Z';
      console.log('Query date range:', startTime, 'to', endTime);
      
      // Execute the query
      const { data, error } = await supabase
        .from('pos_loyalty_transactions')
        .select('*')
        .eq('loyalty_account_id', loyaltyCustomer.id)
        .eq('business_id', businessId)
        .eq('transaction_type', 'redeem')
        .gte('created_at', startTime)
        .lt('created_at', endTime)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error loading loyalty history:', error);
        setLoyaltyHistory([]);
      } else {
        console.log('Loyalty history loaded:', data);
        setLoyaltyHistory(data || []);
      }

    } catch (err) {
      console.error('Error loading loyalty history:', err);
      setLoyaltyHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Handle transaction click to show sale details
  const handleTransactionClick = async (transaction) => {
    if (!transaction.transaction_id) {
      alert('This appears to be a test transaction with no associated sale details.');
      return;
    }

    setTransactionLoading(true);
    setShowTransactionModal(true);

    try {
      console.log('Loading transaction details for:', transaction.transaction_id);
      
      // Try to find the sale record
      const { data: saleData, error: saleError } = await supabase
        .from('pos_sales')
        .select(`
          *,
          pos_sale_items(
            *,
            pos_inventory(name, price)
          ),
          pos_payments(*),
          pos_loyalty_accounts(customer_name, customer_email, customer_phone)
        `)
        .eq('id', transaction.transaction_id)
        .single();

      if (saleError) {
        console.error('Sale lookup error:', saleError);
        
        // If sale not found, show transaction details only
        setSelectedTransaction({
          ...transaction,
          sale_items: [],
          payments: [],
          is_test_transaction: true,
          error_message: 'Sale details not found - this may be a test transaction'
        });
      } else {
        console.log('Sale data loaded:', saleData);
        setSelectedTransaction({
          ...transaction,
          sale_data: saleData,
          sale_items: saleData.pos_sale_items || [],
          payments: saleData.pos_payments || [],
          customer: saleData.pos_loyalty_accounts,
          is_test_transaction: false
        });
      }

    } catch (err) {
      console.error('Error loading transaction details:', err);
      setSelectedTransaction({
        ...transaction,
        sale_items: [],
        payments: [],
        is_test_transaction: true,
        error_message: 'Error loading sale details: ' + err.message
      });
    } finally {
      setTransactionLoading(false);
    }
  };

  // Search customers function
  const searchCustomers = async (term) => {
    if (!businessId || !term.trim()) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    try {
      const { data, error } = await supabase
        .from('pos_loyalty_accounts')
        .select('id, customer_name, customer_phone, customer_email, balance')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .or(`customer_name.ilike.%${term}%,customer_phone.ilike.%${term}%`)
        .limit(5);

      if (error) {
        console.error('Error searching customers:', error);
        setSearchResults([]);
      } else {
        setSearchResults(data || []);
      }
    } catch (err) {
      console.error('Error searching customers:', err);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  // Manual customer entry handler
  const handleManualCustomerEntry = async () => {
    if (!manualCustomerId.trim()) {
      console.warn('Please enter a customer ID');
      return;
    }

    if (onCustomerAttach) {
      await onCustomerAttach(manualCustomerId.trim());
    }
    
    setManualCustomerId('');
    setShowManualEntry(false);
  };

  // Search customer selection handler
  const handleSearchCustomerSelect = async (customer) => {
    if (onCustomerAttach) {
      await onCustomerAttach(customer.id);
    }
    
    setSearchTerm('');
    setSearchResults([]);
    setShowSearch(false);
  };

  // Detach customer handler
  const handleDetachCustomer = () => {
    if (onCustomerDetach) {
      onCustomerDetach();
    }
  };

  // Cancel search handler
  const handleCancelSearch = () => {
    setShowSearch(false);
    setSearchTerm('');
    setSearchResults([]);
  };

  // Cancel manual entry handler
  const handleCancelManualEntry = () => {
    setShowManualEntry(false);
    setManualCustomerId('');
  };

  // ENHANCED: Handle Save & Exit for tabs with better debugging
  const handleSaveAndExit = async () => {
    console.log('Save & Exit clicked - Debug info:', {
      tabMode,
      activeTab: !!activeTab,
      activeTabDetails: activeTab,
      onSaveAndExit: !!onSaveAndExit,
      cartItemsCount: cartItems.length
    });
    
    if (!tabMode) {
      console.warn('Not in tab mode');
      alert('Save & Exit is only available when working with tabs.');
      return;
    }

    if (!activeTab) {
      console.warn('No active tab found');
      alert('No active tab found. Please select a tab first.');
      return;
    }

    if (!onSaveAndExit) {
      console.warn('onSaveAndExit handler not provided by parent component');
      alert('Save & Exit functionality not available. The parent component needs to provide an onSaveAndExit handler.');
      return;
    }

    if (cartItems.length === 0) {
      console.warn('No items in cart to save');
      alert('No items in cart to save to the tab.');
      return;
    }

    try {
      console.log('Attempting to save items to tab:', {
        tabId: activeTab.id || activeTab.tab_id,
        itemCount: cartItems.length
      });
      
      // Call the parent's save and exit handler
      await onSaveAndExit(activeTab, cartItems);
      
      console.log('Tab save successful, clearing cart');
      
      // Clear the cart after successful save
      if (onClearCart) {
        onClearCart();
      }
      
      console.log('Save & Exit completed successfully');
      
    } catch (err) {
      console.error('Error saving and exiting tab:', err);
      alert('Failed to save tab items: ' + (err.message || 'Unknown error'));
    }
  };

  const indianModeActive =
    !!indianStatusGstOnly && (indianStatusCertificateNumber || '').trim().length > 0;

  const gstRateForIndian = Math.min(1, Math.max(0, Number(indianStatusGstRate) || 0));

  // Calculate subtotal (for tax-included custom items, use pre-tax amount so subtotal + tax = total)
  const subtotal = cartItems.reduce((sum, item) => {
    const lineTotal = getPosLineSubtotal(item);
    if (item.is_custom && item.tax_included !== false && getCombinedTaxRate) {
      const rate = indianModeActive ? gstRateForIndian : getCombinedTaxRate(item);
      if (rate > 0) return sum + lineTotal / (1 + rate);
    }
    return sum + lineTotal;
  }, 0);

  const indianTaxOptions = indianModeActive
    ? {
        enabled: true,
        gstRate: gstRateForIndian,
        taxLabel: (indianStatusTaxLabel || 'GST (Indian Status)').trim() || 'GST (Indian Status)'
      }
    : null;

  // Calculate tax using the standardized utility
  const taxCalculation = cartItems.length > 0 ? 
    calculateTotalTax(cartItems, 0, autoLoyaltyApplied, subtotal, indianTaxOptions) :
    { totalTax: 0, aggregatedTaxes: {}, aggregatedRebates: {} };

  const taxAmount = taxCalculation.totalTax;
  const finalSubtotal = subtotal - autoLoyaltyApplied;
  const total = finalSubtotal + taxAmount;

  const formatLoyaltyAccountSummary = (c) => {
    if (!c) return '—';
    if (!loyaltySettings) {
      const n = (Number(c.store_credit) || 0) + (Number(c.balance) || 0);
      return `$${n.toFixed(2)}`;
    }
    if (isPointsLoyaltyMode(loyaltySettings)) {
      const pts = Math.round(Number(c.points) || 0);
      const sc = Number(c.store_credit) || 0;
      if (sc > 0) {
        return `${pts.toLocaleString()} pts · $${sc.toFixed(2)} acct`;
      }
      return `${pts.toLocaleString()} pts`;
    }
    return `$${getSpendableDollarsInDollarsMode(c).toFixed(2)}`;
  };

  const switchableLoyaltyCandidates = (Array.isArray(loyaltyCandidates) ? loyaltyCandidates : [])
    .filter((c) => c?.id);
  const canSwitchLoyaltyCustomer =
    !!loyaltyCustomer?.id &&
    typeof onLoyaltyCustomerSwitch === 'function' &&
    switchableLoyaltyCandidates.length > 1;

  const handlePickLoyaltyCandidate = async (candidate) => {
    const candidateId = String(candidate?.id || '').trim();
    if (!candidateId || loyaltySwitchBusy || !onLoyaltyCustomerSwitch) return;
    if (candidateId === String(loyaltyCustomer?.id || '').trim()) {
      setShowLoyaltySwitchModal(false);
      return;
    }
    setLoyaltySwitchBusy(true);
    try {
      const ok = await onLoyaltyCustomerSwitch(candidate);
      if (ok) setShowLoyaltySwitchModal(false);
    } finally {
      setLoyaltySwitchBusy(false);
    }
  };

  const styles = {
    // MAIN CONTAINER
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 180px)',
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      boxShadow: TavariStyles.shadows.md,
      overflow: 'hidden'
    },
    
    // HEADER: row 1 = cart + qty + GST badge; row 2 = action buttons
    header: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: TavariStyles.spacing.sm,
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
      paddingBottom: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      borderTopLeftRadius: TavariStyles.borderRadius.lg,
      borderTopRightRadius: TavariStyles.borderRadius.lg,
      flexShrink: 0
    },

    headerTopRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.sm,
      minHeight: 28
    },

    headerTopRowClear: {
      flexShrink: 0,
      marginLeft: 'auto'
    },
    
    headerTitle: {
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.xs,
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      flex: '1 1 auto'
    },
    
    cartCount: {
      marginLeft: TavariStyles.spacing.xs,
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.primary,
      borderRadius: TavariStyles.borderRadius.full,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold
    },

    headerButtonRow: {
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      paddingTop: TavariStyles.spacing.sm,
      borderTop: '1px solid rgba(255,255,255,0.28)'
    },
    
    buttonGroup: {
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    
    clearButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.sizes.sm,
      backgroundColor: 'rgba(255,255,255,0.2)',
      color: TavariStyles.colors.white,
      border: `1px solid rgba(255,255,255,0.3)`
    },
    
    saveExitButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.sizes.sm,
      backgroundColor: TavariStyles.colors.warning,
      color: TavariStyles.colors.white,
      border: `1px solid ${TavariStyles.colors.warning}`
    },
    
    // CUSTOMER SECTION
    customerSection: {
      padding: TavariStyles.spacing.md,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      backgroundColor: loyaltyCustomer ? TavariStyles.colors.successBg : TavariStyles.colors.gray50,
      flexShrink: 0,
      minHeight: loyaltyCustomer ? '220px' : '100px',
      maxHeight: showSearch || showManualEntry ? '320px' : (loyaltyCustomer ? '220px' : '100px'),
      overflow: 'hidden',
      transition: 'max-height 0.3s ease'
    },
    
    customerHeader: {
      display: 'flex',
      alignItems: 'flex-start',
      marginBottom: TavariStyles.spacing.sm
    },
    
    customerIcon: {
      color: loyaltyCustomer ? TavariStyles.colors.success : TavariStyles.colors.gray500,
      marginRight: TavariStyles.spacing.sm,
      marginTop: '2px'
    },
    
    customerDetails: {
      flex: 1,
      minWidth: 0
    },

    customerNameRow: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: TavariStyles.spacing.sm,
      width: '100%'
    },

    customerLoyaltyRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: TavariStyles.spacing.sm,
      width: '100%',
      marginTop: '4px'
    },
    
    customerName: {
      fontSize: loyaltyCustomer ? TavariStyles.typography.fontSize['2xl'] : TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      margin: 0,
      lineHeight: '1.1',
      minWidth: 0,
      flex: 1
    },
    
    customerBalance: {
      fontSize: loyaltyCustomer ? TavariStyles.typography.fontSize.lg : TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.success,
      margin: 0,
      lineHeight: '1.3',
      minWidth: 0,
      flex: 1
    },
    
    customerSubtext: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      margin: 0,
      lineHeight: '1.3',
      marginTop: '2px'
    },
    
    statusBadge: {
      fontSize: '10px',
      color: loyaltyCustomer ? TavariStyles.colors.success : TavariStyles.colors.gray500,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      backgroundColor: loyaltyCustomer ? TavariStyles.colors.successBg : TavariStyles.colors.gray100,
      padding: '2px 6px',
      borderRadius: TavariStyles.borderRadius.sm,
      border: `1px solid ${loyaltyCustomer ? TavariStyles.colors.success : TavariStyles.colors.gray300}`,
      alignSelf: 'flex-start',
      flexShrink: 0,
      textAlign: 'center',
      minWidth: '72px'
    },

    switchLoyaltyButton: {
      border: `1px solid ${TavariStyles.colors.primary || '#008080'}`,
      background: TavariStyles.colors.white,
      color: TavariStyles.colors.primary || '#008080',
      borderRadius: TavariStyles.borderRadius.sm,
      padding: '2px 8px',
      fontSize: '32px',
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: sessionLocked ? 'not-allowed' : 'pointer',
      flexShrink: 0,
      minWidth: '72px',
      textAlign: 'center',
      opacity: sessionLocked ? 0.6 : 1
    },

    loyaltySwitchOverlay: {
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0,0,0,0.45)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1200,
      padding: TavariStyles.spacing.lg
    },

    loyaltySwitchModal: {
      width: '100%',
      maxWidth: 420,
      maxHeight: '80vh',
      overflow: 'auto',
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg || 12,
      boxShadow: TavariStyles.shadows?.lg || '0 10px 30px rgba(0,0,0,0.2)',
      padding: TavariStyles.spacing.lg
    },

    loyaltySwitchHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.sm
    },

    loyaltySwitchTitle: {
      margin: 0,
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900
    },

    loyaltySwitchClose: {
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      padding: 4,
      color: TavariStyles.colors.gray600
    },

    loyaltySwitchHint: {
      margin: `0 0 ${TavariStyles.spacing.md}`,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      lineHeight: 1.4
    },

    loyaltySwitchList: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },

    loyaltySwitchOption: {
      width: '100%',
      textAlign: 'left',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      background: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.md,
      padding: TavariStyles.spacing.md,
      cursor: loyaltySwitchBusy ? 'wait' : 'pointer'
    },

    loyaltySwitchOptionActive: {
      borderColor: TavariStyles.colors.primary || '#008080',
      background: TavariStyles.colors.successBg || '#ecfdf5'
    },

    loyaltySwitchOptionName: {
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
      marginBottom: 2
    },

    loyaltySwitchOptionMeta: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    
    // LOYALTY CARDS
    loyaltyCards: {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: TavariStyles.spacing.sm,
      marginTop: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.sm
    },
    
    loyaltyCard: {
      backgroundColor: TavariStyles.colors.white,
      border: `1px solid ${TavariStyles.colors.success}30`,
      borderRadius: TavariStyles.borderRadius.md,
      padding: TavariStyles.spacing.md,
      textAlign: 'center',
      boxShadow: TavariStyles.shadows.sm
    },
    
    cardLabel: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      textTransform: 'uppercase',
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      marginBottom: TavariStyles.spacing.xs,
      letterSpacing: '0.05em'
    },
    
    cardValue: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.success,
      lineHeight: '1'
    },
    
    loyaltyHistoryButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      fontSize: TavariStyles.typography.fontSize.xs,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      height: '28px',
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      marginBottom: TavariStyles.spacing.sm
    },
    
    buttonRow: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      marginTop: TavariStyles.spacing.sm
    },
    
    fullWidthButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      flex: 1,
      fontSize: TavariStyles.typography.fontSize.xs,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.xs}`,
      height: '32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TavariStyles.spacing.xs
    },
    
    searchButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      flex: 1,
      fontSize: TavariStyles.typography.fontSize.xs,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.xs}`,
      height: '32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TavariStyles.spacing.xs
    },
    
    detachButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.danger,
      width: '100%',
      fontSize: TavariStyles.typography.fontSize.xs,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.xs}`,
      height: '32px'
    },
    
    // EXPANDABLE SECTIONS
    expandableSection: {
      marginTop: TavariStyles.spacing.sm,
      padding: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.sm,
      border: `1px solid ${TavariStyles.colors.gray300}`
    },
    
    searchInput: {
      ...TavariStyles.components.form.input,
      display: 'block',
      width: '100%',
      fontSize: TavariStyles.typography.fontSize.sm,
      marginBottom: TavariStyles.spacing.sm,
      boxSizing: 'border-box',
      padding: TavariStyles.spacing.sm,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.sm
    },
    
    manualInput: {
      ...TavariStyles.components.form.input,
      display: 'block',
      width: '100%',
      fontSize: TavariStyles.typography.fontSize.sm,
      marginBottom: TavariStyles.spacing.sm,
      boxSizing: 'border-box',
      padding: TavariStyles.spacing.sm,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.sm
    },
    
    searchResults: {
      maxHeight: '120px',
      overflowY: 'auto',
      marginBottom: TavariStyles.spacing.sm
    },
    
    searchResultItem: {
      padding: TavariStyles.spacing.sm,
      cursor: 'pointer',
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      transition: TavariStyles.transitions.fast
    },
    
    resultName: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900
    },
    
    resultDetails: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600
    },
    
    actionButtons: {
      display: 'flex',
      gap: TavariStyles.spacing.sm
    },
    
    actionButton: {
      ...TavariStyles.components.button.base,
      fontSize: TavariStyles.typography.fontSize.xs,
      padding: TavariStyles.spacing.sm,
      height: '36px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius.sm,
      boxSizing: 'border-box'
    },
    
    primaryActionButton: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      borderColor: TavariStyles.colors.primary
    },
    
    secondaryActionButton: {
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.gray700,
      borderColor: TavariStyles.colors.gray300
    },
    
    // SCROLLABLE ITEMS LIST
    itemsList: {
      flex: 1,
      overflowY: 'auto',
      padding: TavariStyles.spacing.sm,
      minHeight: 0
    },
    
    emptyCart: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      color: TavariStyles.colors.gray400,
      textAlign: 'center'
    },
    
    emptyCartIcon: {
      fontSize: '10px',
      marginBottom: TavariStyles.spacing.sm
    },
    
    cartItem: {
      display: 'flex',
      alignItems: 'flex-start',
      padding: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.xs,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.sm,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      minHeight: '50px'
    },
    
    itemInfo: {
      flex: 1,
      marginRight: TavariStyles.spacing.sm
    },
    
    itemRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '2px'
    },
    
    itemName: {
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900
    },
    
    itemPrice: {
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700
    },
    
    modifierRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingLeft: '20px',
      marginBottom: '1px'
    },
    
    modifierName: {
      fontSize: '10px',
      color: TavariStyles.colors.gray600,
      fontStyle: 'italic'
    },
    
    modifierPrice: {
      fontSize: '12px',
      color: TavariStyles.colors.gray600,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    
    quantityControls: {
      display: 'flex',
      alignItems: 'center',
      gap: '4px'
    },
    
    quantityButton: {
      ...TavariStyles.components.button.base,
      backgroundColor: TavariStyles.colors.gray200,
      color: TavariStyles.colors.gray700,
      minWidth: '24px',
      height: '24px',
      padding: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '12px'
    },
    
    quantity: {
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      minWidth: '16px',
      textAlign: 'center'
    },
    
    removeButton: {
      ...TavariStyles.components.button.base,
      backgroundColor: TavariStyles.colors.danger,
      color: TavariStyles.colors.white,
      padding: '2px',
      marginLeft: '4px',
      minWidth: '24px',
      height: '24px',
      fontSize: '24px'
    },
    
    // CHECKOUT SECTION
    checkoutSection: {
      padding: TavariStyles.spacing.md,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      backgroundColor: TavariStyles.colors.gray50,
      borderBottomLeftRadius: TavariStyles.borderRadius.lg,
      borderBottomRightRadius: TavariStyles.borderRadius.lg,
      flexShrink: 0,
      height: '160px'
    },
    
    summaryRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '4px'
    },
    
    summaryLabel: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray700
    },
    
    summaryValue: {
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900
    },
    
    totalRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: TavariStyles.spacing.xs,
      borderTop: `1px solid ${TavariStyles.colors.gray300}`,
      marginTop: TavariStyles.spacing.xs,
      marginBottom: TavariStyles.spacing.sm
    },
    
    totalLabel: {
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900
    },
    
    totalValue: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.success
    },
    
    checkoutButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg,
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TavariStyles.spacing.sm
    },
    
    // MODAL STYLES
    modal: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999
    },
    
    modalContent: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      maxWidth: '500px',
      width: '90%',
      maxHeight: '80vh',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: TavariStyles.shadows.xl
    },
    
    modalHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: TavariStyles.spacing.lg,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      flexShrink: 0
    },
    
    modalTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      margin: 0
    },
    
    modalBody: {
      flex: 1,
      padding: TavariStyles.spacing.lg,
      overflowY: 'auto'
    },
    
    closeButton: {
      background: 'transparent',
      border: 'none',
      fontSize: '19px',
      cursor: 'pointer',
      color: TavariStyles.colors.gray600,
      padding: TavariStyles.spacing.xs,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: TavariStyles.borderRadius.sm,
      transition: TavariStyles.transitions.fast
    }
  };

  const showHeaderButtonRow =
    (!tabMode && (!!onAddCustomItem || !!onIndianStatusApply)) ||
    (tabMode && activeTab && cartItems.length > 0);

  return (
    <div style={styles.container}>
      {/* HEADER: row 1 cart/qty/GST + Clear; row 2 other actions */}
      <div style={styles.header}>
        <div style={styles.headerTopRow}>
          <div style={styles.headerTitle}>
            <ShoppingCart size={18} aria-hidden />
            <span>{tabMode && activeTab ? `Tab: ${activeTab.customer_name || 'Unnamed'}` : 'Cart'}</span>
            <span style={styles.cartCount} title="Items in cart">
              {cartItems.length}
            </span>
            {indianModeActive ? (
              <span
                title="Indian Status (GST only) is applied to this sale"
                style={{
                  marginLeft: TavariStyles.spacing.xs,
                  padding: '3px 10px',
                  borderRadius: TavariStyles.borderRadius.full,
                  fontSize: '8px',
                  fontWeight: TavariStyles.typography.fontWeight.bold,
                  letterSpacing: '0.08em',
                  backgroundColor: TavariStyles.colors.white,
                  color: '#0f766e',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.15)'
                }}
              >
                GST ONLY
              </span>
            ) : (
              <span
                title="Standard POS tax rules apply to this sale"
                style={{
                  marginLeft: TavariStyles.spacing.xs,
                  padding: '3px 10px',
                  borderRadius: TavariStyles.borderRadius.full,
                  fontSize: '8px',
                  fontWeight: TavariStyles.typography.fontWeight.semibold,
                  letterSpacing: '0.06em',
                  backgroundColor: 'rgba(255,255,255,0.22)',
                  color: TavariStyles.colors.white,
                  border: '1px solid rgba(255,255,255,0.35)'
                }}
              >
                STANDARD TAX
              </span>
            )}
          </div>

          {cartItems.length > 0 && onClearCart && (
            <div style={styles.headerTopRowClear}>
              <button
                onClick={onClearCart}
                disabled={sessionLocked}
                style={{
                  ...styles.clearButton,
                  opacity: sessionLocked ? 0.5 : 1
                }}
                title="Clear cart"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {showHeaderButtonRow && (
          <div style={styles.headerButtonRow}>
            <div style={styles.buttonGroup}>
              {!tabMode && onAddCustomItem && (
                <button
                  onClick={() => {
                    setCustomItemName('');
                    setCustomItemPrice('');
                    setCustomItemTaxIncluded(true);
                    setShowCustomItemModal(true);
                  }}
                  disabled={sessionLocked}
                  style={{
                    ...styles.clearButton,
                    opacity: sessionLocked ? 0.5 : 1
                  }}
                  title="Add custom item (e.g. party balance)"
                >
                  Custom Item
                </button>
              )}
              {!tabMode && onIndianStatusApply && (
                <button
                  onClick={() => {
                    setIndianCertDraft((indianStatusCertificateNumber || '').trim());
                    setShowIndianStatusModal(true);
                  }}
                  disabled={sessionLocked}
                  style={{
                    ...styles.clearButton,
                    opacity: sessionLocked ? 0.5 : 1,
                    ...(indianModeActive ? { backgroundColor: 'rgba(255,255,255,0.35)', fontWeight: 700 } : {})
                  }}
                  title="Indian Status — charge GST only (enter certificate number)"
                >
                  Indian Status (GST Only)
                </button>
              )}
              {cartItems.length > 0 && tabMode && activeTab && (
                <button
                  onClick={handleSaveAndExit}
                  style={styles.saveExitButton}
                  title="Save items to tab and clear cart"
                >
                  Save & Exit
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {indianModeActive && (
        <div
          role="status"
          aria-live="polite"
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'flex-start',
            gap: TavariStyles.spacing.md,
            padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
            background: 'linear-gradient(95deg, #0f766e 0%, #14b8a6 55%, #2dd4bf 100%)',
            color: TavariStyles.colors.white,
            borderBottom: `2px solid #0d9488`,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)'
          }}
        >
          <BadgeCheck size={26} strokeWidth={2.5} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: TavariStyles.typography.fontWeight.bold,
                fontSize: TavariStyles.typography.fontSize.base
              }}
            >
              Indian Status (GST only) — on this sale
            </div>
            <div
              style={{
                fontSize: TavariStyles.typography.fontSize.sm,
                marginTop: TavariStyles.spacing.xs,
                opacity: 0.96,
                wordBreak: 'break-word'
              }}
            >
              Status #:{' '}
              <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>
                {(indianStatusCertificateNumber || '').trim()}
              </span>
            </div>
            <div
              style={{
                fontSize: TavariStyles.typography.fontSize.xs,
                marginTop: TavariStyles.spacing.sm,
                opacity: 0.9,
                lineHeight: 1.35
              }}
            >
              Charging GST only at {(gstRateForIndian * 100).toFixed(2)}%. Tap &quot;Indian Status (GST Only)&quot;
              above to change the number or remove.
            </div>
          </div>
        </div>
      )}

      {/* CUSTOMER SECTION */}
      <div style={styles.customerSection}>
        <div style={styles.customerHeader}>
          <User size={16} style={styles.customerIcon} />
          <div style={styles.customerDetails}>
            {loyaltyCustomer ? (
              <>
                <div style={styles.customerNameRow}>
                  <div style={styles.customerName}>
                    {loyaltyCustomer.customer_name}
                  </div>
                  <div style={styles.statusBadge}>ATTACHED</div>
                </div>
                <div style={styles.customerLoyaltyRow}>
                  <div style={styles.customerBalance}>
                    Loyalty: {formatLoyaltyAccountSummary(loyaltyCustomer)}
                  </div>
                  {canSwitchLoyaltyCustomer ? (
                    <button
                      type="button"
                      style={styles.switchLoyaltyButton}
                      disabled={sessionLocked || loyaltySwitchBusy}
                      title="Choose which adult earns loyalty points on this sale"
                      onClick={() => setShowLoyaltySwitchModal(true)}
                    >
                      Change
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <div style={styles.customerNameRow}>
                  <div style={styles.customerName}>
                    No Customer
                  </div>
                  <div style={styles.statusBadge}>NONE</div>
                </div>
                <div style={styles.customerSubtext}>
                  Scan QR code, Enter Name, Enter Phone Number, or Enter ID
                </div>
              </>
            )}
          </div>
        </div>
        
        {/* LOYALTY CARDS - Only show when customer is attached */}
        {loyaltyCustomer && loyaltySettings?.is_active && cartItems.length > 0 && (
          <>
            <div style={styles.loyaltyCards}>
              <div style={styles.loyaltyCard}>
                <div style={styles.cardLabel}>Will Earn</div>
                <div style={styles.cardValue}>
                  {loyaltySettings.loyalty_mode === 'points' 
                    ? `${loyaltyPointsToEarn} pts`
                    : `$${(loyaltyPointsToEarn * 10 / loyaltySettings.redemption_rate).toFixed(2)}`
                  }
                </div>
              </div>
              
              <div style={styles.loyaltyCard}>
                <div style={styles.cardLabel}>Available</div>
                <div style={styles.cardValue}>
                  ${availableLoyaltyCredit.toFixed(2)}
                </div>
              </div>
              
              <div style={styles.loyaltyCard}>
                <div style={styles.cardLabel}>Used Today</div>
                <div style={styles.cardValue}>
                  ${usedToday.toFixed(2)}
                </div>
              </div>
              
              <div style={styles.loyaltyCard}>
                <div style={styles.cardLabel}>Remaining</div>
                <div style={styles.cardValue}>
                  ${dailyUsageRemaining.toFixed(2)}
                </div>
              </div>
            </div>
            
            <button
              style={styles.loyaltyHistoryButton}
              onClick={loadLoyaltyHistory}
            >
              <History size={14} />
              View Loyalty Usage
            </button>
          </>
        )}
        
        {/* BUTTON ROW */}
        {loyaltyCustomer ? (
          <button
            style={styles.detachButton}
            onClick={handleDetachCustomer}
          >
            Detach Customer
          </button>
        ) : (
          <div style={styles.buttonRow}>
            <button
              style={styles.fullWidthButton}
              onClick={() => {
                setShowManualEntry(true);
                setShowSearch(false);
              }}
            >
              Manual Entry
            </button>
            <button
              style={styles.searchButton}
              onClick={() => {
                setShowSearch(true);
                setShowManualEntry(false);
              }}
            >
              <Search size={14} />
              Search
            </button>
          </div>
        )}

        {/* EXPANDABLE MANUAL ENTRY SECTION */}
        {showManualEntry && (
          <div style={styles.expandableSection}>
            <input
              type="text"
              value={manualCustomerId}
              onChange={(e) => setManualCustomerId(e.target.value)}
              placeholder="Enter Customer ID"
              style={styles.manualInput}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleManualCustomerEntry();
                }
              }}
              autoFocus
            />
            <div style={styles.actionButtons}>
              <button
                style={{
                  ...styles.actionButton,
                  ...styles.primaryActionButton,
                  flex: 1
                }}
                onClick={handleManualCustomerEntry}
                disabled={!manualCustomerId.trim()}
              >
                Add Customer
              </button>
              <button
                style={{
                  ...styles.actionButton,
                  ...styles.secondaryActionButton,
                  flex: 1
                }}
                onClick={handleCancelManualEntry}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* EXPANDABLE SEARCH SECTION */}
        {showSearch && (
          <div style={styles.expandableSection}>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name or phone number"
              style={styles.searchInput}
              autoFocus
            />
            
            {searchLoading && (
              <div style={{ textAlign: 'center', color: TavariStyles.colors.gray500, fontSize: TavariStyles.typography.fontSize.xs }}>
                Searching...
              </div>
            )}
            
            {searchResults.length > 0 && (
              <div style={styles.searchResults}>
                {searchResults.map((customer) => (
                  <div
                    key={customer.id}
                    style={styles.searchResultItem}
                    onClick={() => handleSearchCustomerSelect(customer)}
                    onMouseEnter={(e) => {
                      e.target.style.backgroundColor = TavariStyles.colors.gray100;
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.backgroundColor = 'transparent';
                    }}
                  >
                    <div style={styles.resultName}>{customer.customer_name}</div>
                    <div style={styles.resultDetails}>
                      {customer.customer_phone} • {formatLoyaltyAccountSummary(customer)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {searchTerm.length >= 2 && !searchLoading && searchResults.length === 0 && (
              <div style={{ textAlign: 'center', color: TavariStyles.colors.gray500, fontSize: TavariStyles.typography.fontSize.xs, marginBottom: TavariStyles.spacing.sm }}>
                No customers found
              </div>
            )}
            
            <button
              style={{
                ...styles.actionButton,
                ...styles.secondaryActionButton,
                width: '100%'
              }}
              onClick={handleCancelSearch}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* SCROLLABLE ITEMS LIST */}
      <div style={styles.itemsList}>
        {cartItems.length === 0 ? (
          <div style={styles.emptyCart}>
            <div style={styles.emptyCartIcon}>🛒</div>
            <p>Cart is empty</p>
          </div>
        ) : (
          cartItems.map((item, index) => {
            // Extract base name and modifiers
            const baseName = item.name.includes(' - ') ? item.name.split(' - ')[0] : item.name;
            let modifiersToShow = [];
            
            // Try to use modifiers array first
            if (item.modifiers && Array.isArray(item.modifiers) && item.modifiers.length > 0) {
              modifiersToShow = item.modifiers;
            } else if (item.name.includes(' - ')) {
              // Extract from name if no modifiers array
              const parts = item.name.split(' - ');
              const modifierNames = parts.slice(1);
              modifiersToShow = modifierNames.map(name => ({ name, price: 0 }));
            }
            
            return (
              <div key={`${item.id}-${index}`} style={styles.cartItem}>
                <div style={styles.itemInfo}>
                  {/* Main item row with name and price aligned */}
                  <div style={styles.itemRow}>
                    <span style={styles.itemName}>{baseName}</span>
                    <span style={styles.itemPrice}>${parseFloat(item.price || 0).toFixed(2)}</span>
                  </div>
                  
                  {/* Show modifiers indented below if they exist */}
                  {modifiersToShow.length > 0 && (
                    modifiersToShow.map((modifier, modIndex) => (
                      <div key={modIndex} style={styles.modifierRow}>
                        <span style={styles.modifierName}>{modifier.name}</span>
                        <span style={styles.modifierPrice}>${parseFloat(modifier.price || 0).toFixed(2)}</span>
                      </div>
                    ))
                  )}
                </div>
                
                <div style={styles.quantityControls}>
                  {item.is_custom && onUpdateCustomItem && (
                    <button
                      onClick={() => {
                        setEditingCustomItem(item);
                        setEditCustomName(item.name);
                        setEditCustomPrice(String(item.price ?? ''));
                        setEditCustomTaxIncluded(item.tax_included !== false);
                      }}
                      disabled={sessionLocked}
                      style={{
                        ...styles.quantityButton,
                        opacity: sessionLocked ? 0.5 : 1,
                        backgroundColor: TavariStyles.colors.primary,
                        color: TavariStyles.colors.white
                      }}
                      title="Edit name and price"
                    >
                      <Pencil size={10} />
                    </button>
                  )}
                  <button
                    onClick={() => onUpdateQty(item.id, Math.max(1, item.quantity - 1))}
                    disabled={sessionLocked || item.quantity <= 1}
                    style={{
                      ...styles.quantityButton,
                      opacity: (sessionLocked || item.quantity <= 1) ? 0.5 : 1
                    }}
                  >
                    <Minus size={10} />
                  </button>
                  
                  <div style={styles.quantity}>{item.quantity}</div>
                  
                  <button
                    onClick={() => onUpdateQty(item.id, item.quantity + 1)}
                    disabled={sessionLocked}
                    style={{
                      ...styles.quantityButton,
                      opacity: sessionLocked ? 0.5 : 1
                    }}
                  >
                    <Plus size={10} />
                  </button>
                  
                  <button
                    onClick={() => onRemoveItem(item.id)}
                    disabled={sessionLocked}
                    style={{
                      ...styles.removeButton,
                      opacity: sessionLocked ? 0.5 : 1
                    }}
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add Custom Item Modal */}
      {showCustomItemModal && onAddCustomItem && (
        <div style={styles.modal} onClick={() => setShowCustomItemModal(false)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Add Custom Item</h3>
              <button style={styles.closeButton} onClick={() => setShowCustomItemModal(false)}><X size={20} /></button>
            </div>
            <div style={styles.modalBody}>
              <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginBottom: TavariStyles.spacing.sm }}>
                For one-off amounts (e.g. birthday party balance). Name and price.
              </p>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: TavariStyles.typography.fontSize.sm }}>Name</label>
              <input
                type="text"
                value={customItemName}
                onChange={(e) => setCustomItemName(e.target.value)}
                placeholder="e.g. Birthday Party Balance"
                style={styles.searchInput}
                autoFocus
              />
              <label style={{ display: 'block', marginBottom: 4, marginTop: TavariStyles.spacing.sm, fontWeight: 600, fontSize: TavariStyles.typography.fontSize.sm }}>Price ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={customItemPrice}
                onChange={(e) => setCustomItemPrice(e.target.value)}
                placeholder="0.00"
                style={styles.searchInput}
              />
              <div style={{ marginTop: TavariStyles.spacing.sm }}>
                <TavariCheckbox
                  id="custom-item-tax-included"
                  checked={customItemTaxIncluded}
                  onChange={(checked) => setCustomItemTaxIncluded(checked)}
                  label="Tax included (price is total with tax)"
                />
              </div>
              <div style={{ display: 'flex', gap: TavariStyles.spacing.sm, marginTop: TavariStyles.spacing.md }}>
                <button style={{ ...styles.actionButton, ...styles.secondaryActionButton, flex: 1 }} onClick={() => setShowCustomItemModal(false)}>Cancel</button>
                <button
                  style={{ ...styles.actionButton, ...styles.primaryActionButton, flex: 1 }}
                  onClick={() => {
                    const name = customItemName.trim();
                    const price = parseFloat(customItemPrice);
                    if (!name) return;
                    if (Number.isNaN(price) || price < 0) return;
                    onAddCustomItem({ name, price, tax_included: customItemTaxIncluded });
                    setShowCustomItemModal(false);
                    setCustomItemName('');
                    setCustomItemPrice('');
                    setCustomItemTaxIncluded(true);
                  }}
                >
                  Add to Cart
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Indian Status (GST only) — certificate required */}
      {showIndianStatusModal && onIndianStatusApply && (
        <div style={styles.modal} onClick={() => setShowIndianStatusModal(false)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Indian Status (GST Only)</h3>
              <button style={styles.closeButton} onClick={() => setShowIndianStatusModal(false)}><X size={20} /></button>
            </div>
            <div style={styles.modalBody}>
              <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginBottom: TavariStyles.spacing.sm }}>
                Enter the certificate / registry number. Tax for this sale will use only the GST rate from POS Settings (Taxes).
              </p>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: TavariStyles.typography.fontSize.sm }}>
                Indian Status number
              </label>
              <input
                type="text"
                value={indianCertDraft}
                onChange={(e) => setIndianCertDraft(e.target.value)}
                placeholder="Required to apply"
                style={styles.searchInput}
                autoFocus
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: TavariStyles.spacing.sm, marginTop: TavariStyles.spacing.md }}>
                <button
                  style={{ ...styles.actionButton, ...styles.primaryActionButton, width: '100%' }}
                  onClick={() => {
                    const cert = indianCertDraft.trim();
                    if (!cert) return;
                    onIndianStatusApply(cert);
                    setShowIndianStatusModal(false);
                  }}
                >
                  Apply to this sale
                </button>
                {indianStatusGstOnly && onIndianStatusClear && (
                  <button
                    style={{ ...styles.actionButton, ...styles.secondaryActionButton, width: '100%' }}
                    onClick={() => {
                      onIndianStatusClear();
                      setIndianCertDraft('');
                      setShowIndianStatusModal(false);
                    }}
                  >
                    Remove Indian Status
                  </button>
                )}
                <button
                  style={{ ...styles.actionButton, ...styles.secondaryActionButton, width: '100%' }}
                  onClick={() => setShowIndianStatusModal(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Custom Item Modal */}
      {editingCustomItem && onUpdateCustomItem && (
        <div style={styles.modal} onClick={() => setEditingCustomItem(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Edit Custom Item</h3>
              <button style={styles.closeButton} onClick={() => setEditingCustomItem(null)}><X size={20} /></button>
            </div>
            <div style={styles.modalBody}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: TavariStyles.typography.fontSize.sm }}>Name</label>
              <input
                type="text"
                value={editCustomName}
                onChange={(e) => setEditCustomName(e.target.value)}
                style={styles.searchInput}
              />
              <label style={{ display: 'block', marginBottom: 4, marginTop: TavariStyles.spacing.sm, fontWeight: 600, fontSize: TavariStyles.typography.fontSize.sm }}>Price ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={editCustomPrice}
                onChange={(e) => setEditCustomPrice(e.target.value)}
                style={styles.searchInput}
              />
              <div style={{ marginTop: TavariStyles.spacing.sm }}>
                <TavariCheckbox
                  id="edit-custom-item-tax-included"
                  checked={editCustomTaxIncluded}
                  onChange={(checked) => setEditCustomTaxIncluded(checked)}
                  label="Tax included (price is total with tax)"
                />
              </div>
              <div style={{ display: 'flex', gap: TavariStyles.spacing.sm, marginTop: TavariStyles.spacing.md }}>
                <button style={{ ...styles.actionButton, ...styles.secondaryActionButton, flex: 1 }} onClick={() => setEditingCustomItem(null)}>Cancel</button>
                <button
                  style={{ ...styles.actionButton, ...styles.primaryActionButton, flex: 1 }}
                  onClick={() => {
                    const name = editCustomName.trim();
                    const price = parseFloat(editCustomPrice);
                    if (!name || Number.isNaN(price) || price < 0) return;
                    onUpdateCustomItem(editingCustomItem.id, { name, price, tax_included: editCustomTaxIncluded });
                    setEditingCustomItem(null);
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CHECKOUT SECTION */}
      {cartItems.length > 0 && (
        <div style={styles.checkoutSection}>
          <div style={styles.summaryRow}>
            <span style={styles.summaryLabel}>Subtotal:</span>
            <span style={styles.summaryValue}>${subtotal.toFixed(2)}</span>
          </div>

          {indianModeActive && (
            <div style={{ ...styles.summaryRow, fontSize: TavariStyles.typography.fontSize.sm }}>
              <span style={styles.summaryLabel}>Indian Status:</span>
              <span style={{ ...styles.summaryValue, fontWeight: 600 }}>
                GST only ({(gstRateForIndian * 100).toFixed(2)}%)
              </span>
            </div>
          )}
          
          {autoLoyaltyApplied > 0 && (
            <div style={styles.summaryRow}>
              <span style={styles.summaryLabel}>Loyalty Credit:</span>
              <span style={styles.summaryValue}>-${autoLoyaltyApplied.toFixed(2)}</span>
            </div>
          )}
          
          <div style={styles.summaryRow}>
            <span style={styles.summaryLabel}>Tax:</span>
            <span style={styles.summaryValue}>${formatTaxAmount(taxAmount)}</span>
          </div>
          
          <div style={styles.totalRow}>
            <span style={styles.totalLabel}>Total:</span>
            <span style={styles.totalValue}>${total.toFixed(2)}</span>
          </div>
          
          <button
            onClick={() => onCheckout({
              items: cartItems,
              subtotal,
              tax: taxAmount,
              total,
              customer: attachedCustomer || loyaltyCustomer,
              tabMode,
              activeTab,
              loyaltyCustomer: loyaltyCustomer,
              discount_amount: 0,
              loyalty_redemption: autoLoyaltyApplied,
              aggregated_taxes: taxCalculation.aggregatedTaxes,
              aggregated_rebates: taxCalculation.aggregatedRebates,
              itemTaxDetails: taxCalculation.itemTaxDetails || [],
              indian_status_gst_only: indianModeActive,
              indian_status_certificate_number: indianModeActive
                ? (indianStatusCertificateNumber || '').trim()
                : null,
              indian_status_gst_rate: indianModeActive ? gstRateForIndian : null,
              indian_status_tax_label: indianModeActive
                ? ((indianStatusTaxLabel || 'GST (Indian Status)').trim() || 'GST (Indian Status)')
                : null
            })}
            disabled={sessionLocked || cartItems.length === 0}
            style={{
              ...styles.checkoutButton,
              opacity: (sessionLocked || cartItems.length === 0) ? 0.5 : 1,
              cursor: (sessionLocked || cartItems.length === 0) ? 'not-allowed' : 'pointer'
            }}
          >
            <ShoppingCart size={18} />
            {tabMode ? 'Process Tab Payment' : 'Checkout'}
          </button>
        </div>
      )}

      {showLoyaltySwitchModal ? (
        <div
          style={styles.loyaltySwitchOverlay}
          onClick={() => !loyaltySwitchBusy && setShowLoyaltySwitchModal(false)}
          role="presentation"
        >
          <div
            style={styles.loyaltySwitchModal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="loyalty-switch-title"
          >
            <div style={styles.loyaltySwitchHeader}>
              <h3 id="loyalty-switch-title" style={styles.loyaltySwitchTitle}>
                Loyalty points to
              </h3>
              <button
                type="button"
                style={styles.loyaltySwitchClose}
                aria-label="Close"
                disabled={loyaltySwitchBusy}
                onClick={() => setShowLoyaltySwitchModal(false)}
              >
                <X size={20} />
              </button>
            </div>
            <p style={styles.loyaltySwitchHint}>
              Choose which adult on this sale should earn the loyalty points.
            </p>
            <div style={styles.loyaltySwitchList}>
              {switchableLoyaltyCandidates.map((candidate) => {
                const isActive =
                  String(candidate.id) === String(loyaltyCustomer?.id || '');
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    disabled={loyaltySwitchBusy}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handlePickLoyaltyCandidate(candidate);
                    }}
                    style={{
                      ...styles.loyaltySwitchOption,
                      ...(isActive ? styles.loyaltySwitchOptionActive : {}),
                    }}
                  >
                    <div style={styles.loyaltySwitchOptionName}>
                      {candidate.customer_name || 'Loyalty account'}
                      {isActive ? ' · Current' : ''}
                    </div>
                    <div style={styles.loyaltySwitchOptionMeta}>
                      Loyalty: {formatLoyaltyAccountSummary(candidate)}
                      {candidate.customer_phone
                        ? ` · ${candidate.customer_phone}`
                        : candidate.customer_email
                          ? ` · ${candidate.customer_email}`
                          : ''}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {/* LOYALTY HISTORY MODAL */}
      {showLoyaltyHistory && (
        <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Today's Loyalty Usage</h3>
              <button 
                style={styles.closeButton}
                onClick={() => setShowLoyaltyHistory(false)}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = TavariStyles.colors.gray100;
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = 'transparent';
                }}
              >
                <X size={20} />
              </button>
            </div>
            
            <div style={styles.modalBody}>
              {historyLoading ? (
                <div style={{ textAlign: 'center', padding: TavariStyles.spacing.xl }}>
                  Loading transaction history...
                </div>
              ) : loyaltyHistory.length === 0 ? (
                <div>
                  <div style={{ marginBottom: TavariStyles.spacing.lg, padding: TavariStyles.spacing.md, backgroundColor: TavariStyles.colors.successBg, borderRadius: TavariStyles.borderRadius.sm }}>
                    <p style={{ margin: 0 }}>
                      <strong>Total used today:</strong> ${usedToday.toFixed(2)}
                    </p>
                  </div>
                  <div style={{ textAlign: 'center', color: TavariStyles.colors.gray500 }}>
                    No loyalty transactions found for today.
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: TavariStyles.spacing.lg, padding: TavariStyles.spacing.md, backgroundColor: TavariStyles.colors.successBg, borderRadius: TavariStyles.borderRadius.sm }}>
                    <p style={{ margin: 0 }}>
                      <strong>Total used today:</strong> ${usedToday.toFixed(2)} ({loyaltyHistory.length} transactions)
                    </p>
                  </div>
                  
                  {loyaltyHistory.map((transaction, index) => (
                    <div key={index} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: TavariStyles.spacing.md,
                      marginBottom: TavariStyles.spacing.sm,
                      backgroundColor: TavariStyles.colors.gray50,
                      borderRadius: TavariStyles.borderRadius.sm
                    }}>
                      <div style={{ flex: 1 }}>
                        <div 
                          style={{
                            fontSize: TavariStyles.typography.fontSize.sm,
                            fontWeight: TavariStyles.typography.fontWeight.semibold,
                            color: TavariStyles.colors.primary,
                            cursor: 'pointer',
                            textDecoration: 'underline'
                          }}
                          onClick={() => handleTransactionClick(transaction)}
                        >
                          Transaction #{transaction.transaction_id?.slice(-8) || 'Unknown'}
                        </div>
                        <div style={{
                          fontSize: TavariStyles.typography.fontSize.xs,
                          color: TavariStyles.colors.gray500,
                          marginTop: '2px'
                        }}>
                          {new Date(transaction.created_at).toLocaleTimeString()}
                        </div>
                      </div>
                      <div style={{
                        fontSize: TavariStyles.typography.fontSize.sm,
                        fontWeight: TavariStyles.typography.fontWeight.bold,
                        color: TavariStyles.colors.danger
                      }}>
                        {loyaltySettings?.loyalty_mode === 'points' && Math.abs(transaction.amount) > 100
                          ? `-$${((Math.abs(transaction.amount) / loyaltySettings.redemption_rate) * 10).toFixed(2)}`
                          : `-$${Math.abs(transaction.amount).toFixed(2)}`
                        }
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TRANSACTION DETAIL MODAL */}
      {showTransactionModal && (
        <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div style={{
            ...styles.modalContent,
            maxWidth: '600px'
          }}>
            <div style={{
              ...styles.modalHeader,
              backgroundColor: TavariStyles.colors.primary,
              color: TavariStyles.colors.white,
              borderTopLeftRadius: TavariStyles.borderRadius.lg,
              borderTopRightRadius: TavariStyles.borderRadius.lg
            }}>
              <h3 style={{
                ...styles.modalTitle,
                color: TavariStyles.colors.white
              }}>
                Transaction Details #{selectedTransaction?.transaction_id?.slice(-8) || 'Unknown'}
              </h3>
              <button 
                style={{
                  ...styles.closeButton,
                  color: TavariStyles.colors.white
                }}
                onClick={() => {
                  setShowTransactionModal(false);
                  setSelectedTransaction(null);
                }}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = 'rgba(255,255,255,0.2)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = 'transparent';
                }}
              >
                <X size={20} />
              </button>
            </div>
            
            <div style={styles.modalBody}>
              {transactionLoading ? (
                <div style={{ textAlign: 'center', padding: TavariStyles.spacing.xl }}>
                  Loading transaction details...
                </div>
              ) : selectedTransaction ? (
                <div>
                  {selectedTransaction.error_message && (
                    <div style={{
                      backgroundColor: TavariStyles.colors.warningBg,
                      color: TavariStyles.colors.warningText,
                      padding: TavariStyles.spacing.md,
                      borderRadius: TavariStyles.borderRadius.sm,
                      marginBottom: TavariStyles.spacing.md
                    }}>
                      {selectedTransaction.error_message}
                    </div>
                  )}
                  
                  <div style={{ marginBottom: TavariStyles.spacing.lg }}>
                    <h4 style={{
                      fontSize: TavariStyles.typography.fontSize.lg,
                      fontWeight: TavariStyles.typography.fontWeight.bold,
                      color: TavariStyles.colors.gray800,
                      marginBottom: TavariStyles.spacing.md,
                      borderBottom: `2px solid ${TavariStyles.colors.primary}`,
                      paddingBottom: TavariStyles.spacing.sm
                    }}>Transaction Information</h4>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${TavariStyles.spacing.sm} 0`, borderBottom: `1px solid ${TavariStyles.colors.gray100}` }}>
                      <span style={{ fontWeight: TavariStyles.typography.fontWeight.medium }}>Date:</span>
                      <span>{new Date(selectedTransaction.created_at).toLocaleDateString()}</span>
                    </div>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${TavariStyles.spacing.sm} 0`, borderBottom: `1px solid ${TavariStyles.colors.gray100}` }}>
                      <span style={{ fontWeight: TavariStyles.typography.fontWeight.medium }}>Time:</span>
                      <span>{new Date(selectedTransaction.created_at).toLocaleTimeString()}</span>
                    </div>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${TavariStyles.spacing.sm} 0`, borderBottom: `1px solid ${TavariStyles.colors.gray100}` }}>
                      <span style={{ fontWeight: TavariStyles.typography.fontWeight.medium }}>Type:</span>
                      <span>{selectedTransaction.transaction_type.charAt(0).toUpperCase() + selectedTransaction.transaction_type.slice(1)}</span>
                    </div>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${TavariStyles.spacing.sm} 0` }}>
                      <span style={{ fontWeight: TavariStyles.typography.fontWeight.medium }}>Amount:</span>
                      <span>${Math.abs(selectedTransaction.amount).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: TavariStyles.spacing.xl }}>
                  No transaction details available.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default POSCartPanel;