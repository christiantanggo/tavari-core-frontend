// components/Dining/DiningCartPanel.jsx - Dining-specific cart with seat assignment
import React, { useState, useEffect } from 'react';
import { TavariStyles } from '../../utils/TavariStyles';
import { ShoppingCart, Plus, Minus, Trash2, User, Search, History, X } from 'lucide-react';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { supabase } from '../../supabaseClient';
import SeatSelector from '../POS/SeatSelector';
import CartItemsBySeat from '../POS/CartItemsBySeat';

const DiningCartPanel = ({
  cartItems = [],
  onRemoveItem,
  onUpdateQty,
  onCheckout,
  sessionLocked = false,
  attachedCustomer = null,
  tabMode = false,
  activeTab = null,
  loyaltyCustomer = null,
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
  
  // DINING-SPECIFIC: Seat assignment props
  guestCount = null,
  selectedSeat = 'All',
  onSeatSelect = () => {},
  
  // Save and Exit Tab functionality
  onSaveAndExit = null
}) => {
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

  // Tax calculation hook
  const {
    calculateTotalTax,
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
      
      const { data: todayUsage, error: usageError } = await supabase
        .from('pos_loyalty_daily_usage')
        .select('amount_used')
        .eq('loyalty_account_id', loyaltyCustomer.id)
        .eq('usage_date', today)
        .maybeSingle();

      if (usageError && usageError.code && usageError.code !== 'PGRST116') {
        console.error('Error loading today loyalty usage:', usageError);
        return;
      }
      
      let usedTodayDollars = todayUsage?.amount_used || 0;
      
      if (loyaltySettings.loyalty_mode === 'points' && usedTodayDollars > 100) {
        usedTodayDollars = (usedTodayDollars / loyaltySettings.redemption_rate) * 10;
      }
      
      setUsedToday(usedTodayDollars);
      
      const dailyLimitPoints = loyaltySettings.max_redemption_per_day || 5000;
      const dailyLimitDollars = (dailyLimitPoints / loyaltySettings.redemption_rate) * 10;
      const remainingDailyLimitDollars = Math.max(0, dailyLimitDollars - usedTodayDollars);
      
      setDailyUsageRemaining(remainingDailyLimitDollars);
      
      const subtotal = cartItems.reduce((sum, item) => {
        const price = parseFloat(item.price) || 0;
        const quantity = parseInt(item.quantity) || 1;
        return sum + (price * quantity);
      }, 0);

      const customerBalanceDollars = loyaltyCustomer.balance || 0;
      
      const maxUsableDollars = Math.min(customerBalanceDollars, remainingDailyLimitDollars, subtotal);
      setAvailableLoyaltyCredit(Math.max(0, maxUsableDollars));

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

      const earnRatePercent = loyaltySettings.earn_rate_percentage / 100;
      const taxableAmountForEarning = subtotal - autoApplyAmount;
      const dollarsToEarn = taxableAmountForEarning * earnRatePercent;
      const pointsToEarn = Math.round(dollarsToEarn * loyaltySettings.redemption_rate / 10);
      
      setLoyaltyPointsToEarn(pointsToEarn);

    } catch (err) {
      console.error('Error calculating loyalty metrics:', err);
    }
  };

  // Load loyalty history
  const loadLoyaltyHistory = async () => {
    if (!loyaltyCustomer || !businessId) {
      console.warn('Cannot load loyalty history - missing data');
      return;
    }

    setShowLoyaltyHistory(true);
    setHistoryLoading(true);

    try {
      const today = getTodayInBusinessTimezone();
      const startTime = today + 'T00:00:00.000Z';
      const endTime = today + 'T23:59:59.999Z';
      
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
        setSelectedTransaction({
          ...transaction,
          sale_items: [],
          payments: [],
          is_test_transaction: true,
          error_message: 'Sale details not found - this may be a test transaction'
        });
      } else {
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

  // Handle Save & Exit for dining tabs
  const handleSaveAndExit = async () => {
    if (!tabMode) {
      alert('Save & Exit is only available when working with tables.');
      return;
    }

    if (!activeTab) {
      alert('No active table found. Please select a table first.');
      return;
    }

    if (!onSaveAndExit) {
      alert('Save & Exit functionality not available.');
      return;
    }

    if (cartItems.length === 0) {
      alert('No items in cart to save to the table.');
      return;
    }

    try {
      await onSaveAndExit(activeTab, cartItems);
      
      if (onClearCart) {
        onClearCart();
      }
      
    } catch (err) {
      console.error('Error saving and exiting table:', err);
      alert('Failed to save table items: ' + (err.message || 'Unknown error'));
    }
  };

  // Calculate subtotal
  const subtotal = cartItems.reduce((sum, item) => {
    const price = parseFloat(item.price) || 0;
    const quantity = parseInt(item.quantity) || 1;
    return sum + (price * quantity);
  }, 0);

  // Calculate tax
  const taxCalculation = cartItems.length > 0 ? 
    calculateTotalTax(cartItems, 0, autoLoyaltyApplied, subtotal) :
    { totalTax: 0, aggregatedTaxes: {}, aggregatedRebates: {} };

  const taxAmount = taxCalculation.totalTax;
  const finalSubtotal = subtotal - autoLoyaltyApplied;
  const total = finalSubtotal + taxAmount;

  // Helper function to display balance in correct format
  const getBalanceDisplay = (dollarAmount) => {
    if (!loyaltySettings) return '$0.00';
    
    if (loyaltySettings.loyalty_mode === 'points') {
      const points = Math.round(dollarAmount * loyaltySettings.redemption_rate / 10);
      return `${points.toLocaleString()} pts`;
    }
    return `$${dollarAmount.toFixed(2)}`;
  };

  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 180px)',
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      boxShadow: TavariStyles.shadows.md,
      overflow: 'hidden'
    },
    
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      borderTopLeftRadius: TavariStyles.borderRadius.lg,
      borderTopRightRadius: TavariStyles.borderRadius.lg,
      flexShrink: 0,
      height: '60px'
    },
    
    headerTitle: {
      display: 'flex',
      alignItems: 'center',
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold
    },
    
    cartCount: {
      marginLeft: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.primary,
      borderRadius: TavariStyles.borderRadius.full,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold
    },
    
    buttonGroup: {
      display: 'flex',
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
      flex: 1
    },
    
    customerName: {
      fontSize: loyaltyCustomer ? TavariStyles.typography.fontSize['2xl'] : TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      margin: 0,
      lineHeight: '1.1'
    },
    
    customerBalance: {
      fontSize: loyaltyCustomer ? TavariStyles.typography.fontSize.lg : TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.success,
      margin: 0,
      lineHeight: '1.3',
      marginTop: '4px'
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
      alignSelf: 'flex-start'
    },
    
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
      fontSize: '33px',
      marginBottom: TavariStyles.spacing.sm
    },
    
    // DINING-SPECIFIC: Seat selector section
    seatSelectorSection: {
      padding: TavariStyles.spacing.md,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      backgroundColor: TavariStyles.colors.gray50,
      flexShrink: 0
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
    
    // DINING-SPECIFIC: Seat badge
    seatBadge: {
      fontSize: '9px',
      color: TavariStyles.colors.primary,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      backgroundColor: TavariStyles.colors.primaryBg,
      padding: '2px 6px',
      borderRadius: TavariStyles.borderRadius.sm,
      border: `1px solid ${TavariStyles.colors.primary}`,
      marginTop: '2px',
      display: 'inline-block'
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
      fontSize: '10px',
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
      fontSize: '13px'
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
      fontSize: '13px'
    },
    
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
      fontSize: '24px',
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

  return (
    <div style={styles.container}>

      {/* DINING-SPECIFIC: SEAT SELECTOR */}
      {guestCount && (
        <div style={styles.seatSelectorSection}>
          <SeatSelector
            guestCount={guestCount}
            selectedSeat={selectedSeat}
            onSeatSelect={onSeatSelect}
          />
        </div>
      )}

      {/* SCROLLABLE ITEMS LIST - Grouped by seat if dining mode */}
      <div style={styles.itemsList}>
        {cartItems.length === 0 ? (
          <div style={styles.emptyCart}>
            <div style={styles.emptyCartIcon}>🛒</div>
            <p>No items ordered yet</p>
          </div>
        ) : guestCount ? (
          // DINING MODE: Show items grouped by seat using CartItemsBySeat
          <CartItemsBySeat
            cartItems={cartItems}
            guestCount={guestCount}
            onUpdateQuantity={onUpdateQty}
            onRemoveItem={onRemoveItem}
            sessionLocked={sessionLocked}
          />
        ) : (
          // NORMAL MODE: Show flat list
          cartItems.map((item, index) => {
            const baseName = item.name.includes(' - ') ? item.name.split(' - ')[0] : item.name;
            let modifiersToShow = [];
            
            if (item.modifiers && Array.isArray(item.modifiers) && item.modifiers.length > 0) {
              modifiersToShow = item.modifiers;
            } else if (item.name.includes(' - ')) {
              const parts = item.name.split(' - ');
              const modifierNames = parts.slice(1);
              modifiersToShow = modifierNames.map(name => ({ name, price: 0 }));
            }
            
            return (
              <div key={`${item.id}-${index}`} style={styles.cartItem}>
                <div style={styles.itemInfo}>
                  <div style={styles.itemRow}>
                    <span style={styles.itemName}>{baseName}</span>
                    <span style={styles.itemPrice}>${parseFloat(item.price || 0).toFixed(2)}</span>
                  </div>
                  
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

      {/* CHECKOUT SECTION */}
      {cartItems.length > 0 && (
        <div style={styles.checkoutSection}>
          <div style={styles.summaryRow}>
            <span style={styles.summaryLabel}>Subtotal:</span>
            <span style={styles.summaryValue}>${subtotal.toFixed(2)}</span>
          </div>
          
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
              aggregated_rebates: taxCalculation.aggregatedRebates
            })}
            disabled={sessionLocked || cartItems.length === 0}
            style={{
              ...styles.checkoutButton,
              opacity: (sessionLocked || cartItems.length === 0) ? 0.5 : 1,
              cursor: (sessionLocked || cartItems.length === 0) ? 'not-allowed' : 'pointer'
            }}
          >
            <ShoppingCart size={18} />
            {tabMode ? 'Process Table Payment' : 'Checkout'}
          </button>
        </div>
      )}

      {/* LOYALTY HISTORY MODAL - Same as before */}
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

export default DiningCartPanel;