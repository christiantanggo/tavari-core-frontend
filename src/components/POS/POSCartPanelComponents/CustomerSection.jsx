// src/components/POS/POSCartPanelComponents/CustomerSection.jsx
import React, { useState, useEffect } from 'react';
import { User, Search, History } from 'lucide-react';
import { TavariStyles } from '../../../utils/TavariStyles';
import { supabase } from '../../../supabaseClient';

const CustomerSection = ({
  loyaltyCustomer,
  loyaltySettings,
  cartItems = [],
  businessId,
  businessSettings = {},
  onCustomerAttach,
  onCustomerDetach,
  onLoyaltyHistoryLoad
}) => {
  // State for customer management
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [manualCustomerId, setManualCustomerId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Loyalty metrics state
  const [availableLoyaltyCredit, setAvailableLoyaltyCredit] = useState(0);
  const [loyaltyPointsToEarn, setLoyaltyPointsToEarn] = useState(0);
  const [autoLoyaltyApplied, setAutoLoyaltyApplied] = useState(0);
  const [dailyUsageRemaining, setDailyUsageRemaining] = useState(0);
  const [usedToday, setUsedToday] = useState(0);

  // Search customers when search term changes
  useEffect(() => {
    if (searchTerm.trim().length >= 2) {
      searchCustomers(searchTerm.trim());
    } else {
      setSearchResults([]);
    }
  }, [searchTerm]);

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

  // Calculate loyalty metrics
  const calculateLoyaltyMetrics = async () => {
    if (!loyaltyCustomer || !loyaltySettings?.is_active || cartItems.length === 0) {
      return;
    }

    try {
      const today = getTodayInBusinessTimezone();
      
      // Get today's usage
      const { data: todayUsage, error: usageError } = await supabase
        .from('pos_loyalty_daily_usage')
        .select('amount_used')
        .eq('loyalty_account_id', loyaltyCustomer.id)
        .eq('usage_date', today)
        .maybeSingle();

      if (usageError && usageError.code && usageError.code !== 'PGRST116') {
        console.error('Error loading loyalty usage:', usageError);
        return;
      }

      let usedTodayDollars = todayUsage?.amount_used || 0;
      
      if (loyaltySettings.loyalty_mode === 'points' && usedTodayDollars > 100) {
        usedTodayDollars = (usedTodayDollars / loyaltySettings.redemption_rate) * 10;
      }
      
      setUsedToday(usedTodayDollars);
      
      // Calculate daily limit in dollars
      const dailyLimitPoints = loyaltySettings.max_redemption_per_day || 5000;
      const dailyLimitDollars = (dailyLimitPoints / loyaltySettings.redemption_rate) * 10;
      const remainingDailyLimitDollars = Math.max(0, dailyLimitDollars - usedTodayDollars);
      
      setDailyUsageRemaining(remainingDailyLimitDollars);
      
      // Calculate cart subtotal
      const subtotal = cartItems.reduce((sum, item) => {
        const price = parseFloat(item.price) || 0;
        const quantity = parseInt(item.quantity) || 1;
        return sum + (price * quantity);
      }, 0);

      // Customer balance in dollars
      const customerBalanceDollars = loyaltyCustomer.balance || 0;
      
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
      const pointsToEarn = Math.round(dollarsToEarn * loyaltySettings.redemption_rate / 10);
      
      setLoyaltyPointsToEarn(pointsToEarn);

    } catch (err) {
      console.error('Error calculating loyalty metrics:', err);
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

  // Helper function to display balance in correct format
  const getBalanceDisplay = (dollarAmount) => {
    if (!loyaltySettings) return '$0.00';
    
    if (loyaltySettings.loyalty_mode === 'points') {
      const points = Math.round(dollarAmount * loyaltySettings.redemption_rate / 10);
      return `${points.toLocaleString()} pts`;
    }
    return `$${dollarAmount.toFixed(2)}`;
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

  const styles = {
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
    }
  };

  return (
    <div style={styles.customerSection}>
      <div style={styles.customerHeader}>
        <User size={16} style={styles.customerIcon} />
        <div style={styles.customerDetails}>
          {loyaltyCustomer ? (
            <>
              <div style={styles.customerName}>
                {loyaltyCustomer.customer_name}
              </div>
              <div style={styles.customerBalance}>
                Balance: {getBalanceDisplay(loyaltyCustomer.balance || 0)}
              </div>
            </>
          ) : (
            <>
              <div style={styles.customerName}>
                No Customer
              </div>
              <div style={styles.customerSubtext}>
                Scan QR code, Enter Name, Enter Phone Number, or Enter ID
              </div>
            </>
          )}
        </div>
        <div style={styles.statusBadge}>
          {loyaltyCustomer ? 'ATTACHED' : 'NONE'}
        </div>
      </div>
      
      {/* Loyalty Cards - Only show when customer is attached */}
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
            onClick={onLoyaltyHistoryLoad}
          >
            <History size={14} />
            View Loyalty Usage
          </button>
        </>
      )}
      
      {/* Button Row */}
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

      {/* Expandable Manual Entry Section */}
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

      {/* Expandable Search Section */}
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
                    {customer.customer_phone} • Balance: {getBalanceDisplay(customer.balance || 0)}
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
  );
};

export default CustomerSection;