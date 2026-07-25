// screens/POS/SaleReviewScreen.jsx - WITH PERMISSION SYSTEM + NO CONSOLE LOGGING
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';

// Security & Authentication
import { SecurityWrapper, useSecurityContext } from '../../Security';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';

// Foundation Components
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { TavariStyles } from '../../utils/TavariStyles';
import { formatDateTimeForBusiness, getBusinessTimezone } from '../../utils/businessDateFormat';
import { getPosLineSubtotal } from '../../utils/posLinePricing';
import DiscountControls from '../../components/POS/POSPaymentScreenComponents/DiscountControls';

const SaleReviewScreen = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Security context for sensitive sale review operations
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'SaleReviewScreen',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Use standardized auth hook
  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'SaleReviewScreen'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    isOwner,
    isManager,
    loading: permissionsLoading 
  } = usePermissions();

  // Permission checks
  const canCreateSales = hasAnyPermission(['pos.sales.create', 'pos.register.operate']) || hasElevatedPrivileges();
  const canViewAllSales = hasPermission('pos.sales.view_all') || hasElevatedPrivileges();
  const canViewReports = hasPermission('pos.reports.view') || hasElevatedPrivileges();
  const canApplyDiscounts =
    hasPermission('pos.discounts.apply') ||
    hasPermission('pos.discounts.apply_any') ||
    hasElevatedPrivileges();

  // Use tax calculations hook
  const taxCalc = useTaxCalculations(auth.selectedBusinessId);
  
  const [cartData, setCartData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [businessSettings, setBusinessSettings] = useState({});
  const [loyaltyCustomer, setLoyaltyCustomer] = useState(null);
  const [dailyUsage, setDailyUsage] = useState(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const businessTimezone = getBusinessTimezone(auth.businessData);

  // Get cart data from navigation state
  const checkoutData = location.state?.checkoutData;

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canCreateSales) {
      toast.error('You do not have permission to create sales');
      navigate(location.state?.from === 'register' ? '/dashboard/pos/register' : '/dashboard/pos');
    }
  }, [permissionsLoading, canCreateSales, navigate, location.state?.from]);

  // Helper function to get rebate names for a specific item using tax hook
  const getItemRebateNames = (item) => {
    if (!cartData.item_tax_details) return [];
    
    const itemTaxDetail = cartData.item_tax_details.find(detail => 
      detail.itemId === item.id || detail.itemName === item.name
    );
    
    if (!itemTaxDetail || !itemTaxDetail.rebateBreakdown) return [];
    
    return Object.keys(itemTaxDetail.rebateBreakdown);
  };

  useEffect(() => {
    if (auth.isReady && auth.selectedBusinessId && !permissionsLoading && canCreateSales) {
      if (!checkoutData) {
        setError('No checkout data provided');
        setLoading(false);
        return;
      }

      loadSaleData();
    }
  }, [auth.isReady, auth.selectedBusinessId, checkoutData, permissionsLoading, canCreateSales]);

  const loadSaleData = async () => {
    try {
      setLoading(true);

      // Rate limit check
      const rateLimitCheck = await checkRateLimit('load_sale_review');
      if (!rateLimitCheck.allowed) {
        setError('Too many requests. Please wait a moment.');
        setLoading(false);
        return;
      }

      await logSecurityEvent('sale_review_access', {
        action: 'load_sale_data',
        business_id: auth.selectedBusinessId,
        item_count: checkoutData?.items?.length || 0,
        total_amount: checkoutData?.total_amount || 0
      }, 'medium');

      // Fetch business settings - Handle missing or multiple records
      const { data: settingsArray, error: settingsError } = await supabase
        .from('pos_settings')
        .select('*')
        .eq('business_id', auth.selectedBusinessId);

      if (settingsError) {
        await logSecurityEvent('settings_load_error', {
          action: 'load_pos_settings_failed',
          business_id: auth.selectedBusinessId,
          error_message: settingsError.message
        }, 'low');
      }

      // Use first settings record or defaults
      const settings = settingsArray && settingsArray.length > 0 ? settingsArray[0] : {};

      // Fetch loyalty settings separately - Handle missing or multiple records
      const { data: loyaltyArray, error: loyaltyError } = await supabase
        .from('pos_loyalty_settings')
        .select('*')
        .eq('business_id', auth.selectedBusinessId);

      if (loyaltyError) {
        await logSecurityEvent('loyalty_settings_error', {
          action: 'load_loyalty_settings_failed',
          business_id: auth.selectedBusinessId,
          error_message: loyaltyError.message
        }, 'low');
      }

      // Use first loyalty settings record or defaults
      const loyaltySettings = loyaltyArray && loyaltyArray.length > 0 ? loyaltyArray[0] : {};

      // Combine both settings objects
      const enhancedSettings = {
        ...settings,
        loyalty_mode: loyaltySettings?.loyalty_mode || 'dollars',
        earn_rate_percentage: loyaltySettings?.earn_rate_percentage || 3,
        redemption_rate: loyaltySettings?.redemption_rate || 0.01,
        min_redemption: loyaltySettings?.min_redemption || 5,
        ...loyaltySettings
      };
      
      setBusinessSettings(enhancedSettings);

      // If loyalty customer is attached, fetch their details and daily usage
      if (checkoutData.loyalty_customer_id) {
        const { data: customerArray, error: customerError } = await supabase
          .from('pos_loyalty_accounts')
          .select('*')
          .eq('id', checkoutData.loyalty_customer_id);

        if (customerError) {
          await logSecurityEvent('loyalty_customer_error', {
            action: 'load_loyalty_customer_failed',
            business_id: auth.selectedBusinessId,
            customer_id: checkoutData.loyalty_customer_id,
            error_message: customerError.message
          }, 'low');
        } else if (customerArray && customerArray.length > 0) {
          const customer = customerArray[0];
          setLoyaltyCustomer(customer);
          
          await logSecurityEvent('loyalty_customer_loaded', {
            action: 'load_loyalty_customer_success',
            business_id: auth.selectedBusinessId,
            customer_id: customer.id
          }, 'low');
          
          await loadDailyLoyaltyUsage(checkoutData.loyalty_customer_id);
        }
      }

      setCartData(checkoutData);
      
      await recordAction('sale_review_loaded', auth.selectedBusinessId, true);

    } catch (err) {
      await logSecurityEvent('sale_review_error', {
        action: 'load_sale_data_failed',
        business_id: auth.selectedBusinessId,
        error_message: err.message
      }, 'medium');
      
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadDailyLoyaltyUsage = async (customerId) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      await logSecurityEvent('daily_loyalty_usage_access', {
        action: 'load_daily_usage',
        business_id: auth.selectedBusinessId,
        customer_id: customerId
      }, 'low');

      const { data: loyaltyTransactions, error } = await supabase
        .from('pos_loyalty_transactions')
        .select(`
          *,
          pos_sales!inner(sale_number, created_at, final_total)
        `)
        .eq('customer_id', customerId)
        .eq('transaction_type', 'redeem')
        .gte('created_at', today + 'T00:00:00.000Z')
        .lt('created_at', today + 'T23:59:59.999Z')
        .order('created_at', { ascending: false });

      if (!error && loyaltyTransactions && loyaltyTransactions.length > 0) {
        const totalUsedToday = loyaltyTransactions.reduce((sum, transaction) => {
          return sum + Math.abs(transaction.amount);
        }, 0);

        setDailyUsage({
          transactions: loyaltyTransactions,
          totalUsed: totalUsedToday
        });
      }
    } catch (err) {
      await logSecurityEvent('daily_loyalty_usage_error', {
        action: 'load_daily_usage_failed',
        business_id: auth.selectedBusinessId,
        customer_id: customerId,
        error_message: err.message
      }, 'low');
    }
  };

  const handleTransactionClick = async (saleNumber) => {
    if (!canViewAllSales) {
      toast.error('You do not have permission to view transaction details');
      return;
    }

    try {
      // Rate limit check
      const rateLimitCheck = await checkRateLimit('view_transaction_details');
      if (!rateLimitCheck.allowed) {
        toast.error('Too many requests. Please wait a moment.');
        return;
      }

      await logSecurityEvent('transaction_detail_access', {
        action: 'view_transaction',
        business_id: auth.selectedBusinessId,
        sale_number: saleNumber
      }, 'medium');

      // Handle potential multiple or no results
      const { data: saleArray, error } = await supabase
        .from('pos_sales')
        .select(`
          *,
          pos_sale_items(
            *,
            inventory(name, price)
          ),
          pos_payments(*),
          pos_loyalty_accounts(customer_name, customer_email, customer_phone)
        `)
        .eq('sale_number', saleNumber)
        .eq('business_id', auth.selectedBusinessId);

      if (error) throw error;

      if (!saleArray || saleArray.length === 0) {
        await logSecurityEvent('transaction_not_found', {
          action: 'view_transaction_failed',
          business_id: auth.selectedBusinessId,
          sale_number: saleNumber
        }, 'low');
        
        toast.error('Transaction not found');
        return;
      }

      // Use first result if multiple found
      const saleData = saleArray[0];
      setSelectedTransaction(saleData);
      setShowReceiptModal(true);

      await recordAction('transaction_viewed', saleData.id, true);

    } catch (err) {
      await logSecurityEvent('transaction_detail_error', {
        action: 'view_transaction_error',
        business_id: auth.selectedBusinessId,
        sale_number: saleNumber,
        error_message: err.message
      }, 'medium');
      
      toast.error('Could not load transaction details: ' + err.message);
    }
  };

  const handleBackToRegister = async () => {
    await logSecurityEvent('sale_review_cancelled', {
      action: 'back_to_register',
      business_id: auth.selectedBusinessId
    }, 'low');

    await recordAction('sale_review_cancelled', auth.selectedBusinessId, true);

    const items = cartData?.items || checkoutData?.items || [];
    const customer =
      loyaltyCustomer ||
      cartData?.loyaltyCustomer ||
      checkoutData?.loyaltyCustomer ||
      null;

    navigate('/dashboard/pos/register', {
      state: {
        resumeCart: {
          items,
          customer,
          loyaltyCandidates: customer?.id ? [customer] : [],
        },
      },
    });
  };

  const recalculateCartWithDiscount = (discountAmount, discountMeta = null) => {
    if (!cartData?.items) return;

    const subtotal = Number(cartData.subtotal) || 0;
    const loyaltyRedemption = Number(cartData.loyalty_redemption) || 0;
    const maxDiscount = Math.max(0, subtotal - loyaltyRedemption);
    const cappedDiscount = Math.round(Math.min(Math.max(0, Number(discountAmount) || 0), maxDiscount) * 100) / 100;

    let taxResult;
    if (cartData.indian_status_gst_only) {
      const rate =
        Number(cartData.indian_status_gst_rate) ||
        Number(businessSettings?.indian_status_gst_rate) ||
        0.05;
      const label =
        (cartData.indian_status_tax_label && String(cartData.indian_status_tax_label).trim()) ||
        (businessSettings?.indian_status_tax_label && String(businessSettings.indian_status_tax_label).trim()) ||
        'GST (Indian Status)';
      taxResult = taxCalc.calculateTotalTax(
        cartData.items,
        cappedDiscount,
        loyaltyRedemption,
        subtotal,
        { enabled: true, gstRate: rate, taxLabel: label }
      );
    } else if (!taxCalc.loading && taxCalc.taxCategories?.length) {
      taxResult = taxCalc.calculateTotalTax(
        cartData.items,
        cappedDiscount,
        loyaltyRedemption,
        subtotal
      );
    } else {
      taxResult = {
        totalTax: Number(cartData.tax_amount) || 0,
        aggregatedTaxes: cartData.aggregated_taxes || {},
        aggregatedRebates: cartData.aggregated_rebates || {},
        itemTaxDetails: cartData.item_tax_details || []
      };
    }

    const serviceFeeRate = Number(businessSettings.service_fee) || 0;
    const serviceFee = serviceFeeRate > 0 ? subtotal * serviceFeeRate : 0;
    const taxableAmount = subtotal - cappedDiscount - loyaltyRedemption;
    const totalAmount = taxableAmount + (Number(taxResult.totalTax) || 0) + serviceFee;

    setCartData((prev) => ({
      ...prev,
      discount_amount: cappedDiscount,
      discount_id: discountMeta?.id || null,
      discount_name: discountMeta?.name || null,
      discount_type: discountMeta?.type || null,
      discount_value: discountMeta?.value ?? null,
      tax_amount: Number(taxResult.totalTax) || 0,
      aggregated_taxes: taxResult.aggregatedTaxes || {},
      aggregated_rebates: taxResult.aggregatedRebates || {},
      item_tax_details: taxResult.itemTaxDetails || [],
      total_amount: Math.round(totalAmount * 100) / 100
    }));
  };

  const handleDiscountChange = ({ amount, discount }) => {
    if (!canApplyDiscounts) {
      toast.error('You do not have permission to apply discounts');
      return;
    }
    recalculateCartWithDiscount(amount, discount);
  };

  const handleProceedToPayment = async () => {
    try {
      // Rate limit check
      const rateLimitCheck = await checkRateLimit('proceed_to_payment');
      if (!rateLimitCheck.allowed) {
        toast.error('Too many requests. Please wait a moment.');
        return;
      }

      await logSecurityEvent('proceed_to_payment', {
        action: 'proceed_to_payment',
        business_id: auth.selectedBusinessId,
        total_amount: cartData.total_amount,
        item_count: cartData.items?.length || 0
      }, 'medium');

      await recordAction('proceed_to_payment', auth.selectedBusinessId, true);

      navigate('/dashboard/pos/payment', {
        state: {
          saleData: {
            ...cartData,
            businessSettings,
            loyaltyCustomer,
            business_id: auth.selectedBusinessId
          },
          from: location.state?.from || 'register'
        }
      });
    } catch (err) {
      await logSecurityEvent('proceed_to_payment_error', {
        action: 'proceed_to_payment_failed',
        business_id: auth.selectedBusinessId,
        error_message: err.message
      }, 'medium');
      
      toast.error('Error proceeding to payment: ' + err.message);
    }
  };

  const renderLoyaltyBalance = () => {
    if (!loyaltyCustomer) return null;

    const isPointsMode = businessSettings.loyalty_mode === 'points';
    const dollarBalance = loyaltyCustomer.balance || 0;
    const pointsPerDollar = 1000;

    if (isPointsMode) {
      const calculatedPoints = Math.round(dollarBalance * pointsPerDollar);
      return `Balance: ${calculatedPoints.toLocaleString()} points`;
    } else {
      return `Balance: $${dollarBalance.toFixed(2)}`;
    }
  };

  const renderDailyUsage = () => {
    if (!dailyUsage || !dailyUsage.transactions.length) return null;

    const isPointsMode = businessSettings.loyalty_mode === 'points';
    const totalUsedDisplay = isPointsMode 
      ? `${Math.round(dailyUsage.totalUsed * 1000).toLocaleString()} points`
      : `$${dailyUsage.totalUsed.toFixed(2)}`;

    return (
      <div style={styles.dailyUsage}>
        <div style={styles.usageHeader}>
          Used today: {totalUsedDisplay}
        </div>
        {dailyUsage.transactions.map((transaction, index) => (
          <div key={index} style={styles.usageTransaction}>
            <span 
              style={styles.transactionNumber}
              onClick={() => handleTransactionClick(transaction.pos_sales.sale_number)}
            >
              #{transaction.pos_sales.sale_number}
            </span>
            <span style={styles.transactionAmount}>
              {isPointsMode 
                ? `-${Math.round(Math.abs(transaction.amount) * 1000).toLocaleString()} pts`
                : `-$${Math.abs(transaction.amount).toFixed(2)}`
              }
            </span>
            <span style={styles.transactionTime}>
              {new Date(transaction.created_at).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
    );
  };

  // Loading state
  if (loading) {
    return (
      <SecurityWrapper
        componentName="SaleReviewScreen"
        sensitiveComponent={true}
        requireSecureConnection={false}
        securityLevel="high"
      >
        <POSAuthWrapper
          requiredRoles={['employee', 'manager', 'owner']}
          requireBusiness={true}
          componentName="SaleReviewScreen"
        >
          <div style={styles.container}>
            <div style={styles.loading}>
              <div style={styles.spinner}></div>
              <div>Loading sale review...</div>
              <style>{TavariStyles.keyframes.spin}</style>
              <div style={{ fontSize: TavariStyles.typography.fontSize.sm, marginTop: TavariStyles.spacing.md }}>
                Business ID: {auth.selectedBusinessId?.slice(0, 8) || 'Not selected'}...
              </div>
              {checkoutData && (
                <div style={{ fontSize: TavariStyles.typography.fontSize.sm, marginTop: TavariStyles.spacing.xs }}>
                  Items count: {checkoutData.items?.length || 0}
                </div>
              )}
            </div>
          </div>
        </POSAuthWrapper>
      </SecurityWrapper>
    );
  }

  if (error) {
    return (
      <SecurityWrapper
        componentName="SaleReviewScreen"
        sensitiveComponent={true}
        requireSecureConnection={false}
        securityLevel="high"
      >
        <POSAuthWrapper
          requiredRoles={['employee', 'manager', 'owner']}
          requireBusiness={true}
          componentName="SaleReviewScreen"
        >
          <div style={styles.container}>
            <div style={styles.error}>
              <h3>Error</h3>
              <p>{error}</p>
              <div style={{ fontSize: TavariStyles.typography.fontSize.sm, marginTop: TavariStyles.spacing.md, color: TavariStyles.colors.gray600 }}>
                Debug Info:
                <br />Business ID: {auth.selectedBusinessId?.slice(0, 8) || 'Not selected'}...
                <br />Checkout Data: {checkoutData ? 'Present' : 'Missing'}
                {checkoutData && (
                  <>
                    <br />Items: {checkoutData.items?.length || 'No items'}
                    <br />Total: ${checkoutData.total_amount?.toFixed(2) || 'No total'}
                  </>
                )}
              </div>
              <button style={styles.backButton} onClick={handleBackToRegister}>
                Back to Register
              </button>
            </div>
          </div>
        </POSAuthWrapper>
      </SecurityWrapper>
    );
  }

  if (!cartData) {
    return (
      <SecurityWrapper
        componentName="SaleReviewScreen"
        sensitiveComponent={true}
        requireSecureConnection={false}
        securityLevel="high"
      >
        <POSAuthWrapper
          requiredRoles={['employee', 'manager', 'owner']}
          requireBusiness={true}
          componentName="SaleReviewScreen"
        >
          <div style={styles.container}>
            <div style={styles.error}>
              <h3>No Sale Data</h3>
              <p>No items to review</p>
              <button style={styles.backButton} onClick={handleBackToRegister}>
                Back to Register
              </button>
            </div>
          </div>
        </POSAuthWrapper>
      </SecurityWrapper>
    );
  }

  return (
    <SecurityWrapper
      componentName="SaleReviewScreen"
      sensitiveComponent={true}
      requireSecureConnection={false}
      securityLevel="high"
    >
      <POSAuthWrapper
        requiredRoles={['employee', 'manager', 'owner']}
        requireBusiness={true}
        componentName="SaleReviewScreen"
      >
        <div style={styles.container}>
          <div style={styles.mainArea}>
            <div style={styles.header}>
              <h2>Review Sale</h2>
              <p>Please review the order details before proceeding to payment</p>
            </div>

            <div style={styles.content}>
            {/* Cart Items Review - WITH REBATE NAMES */}
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Items ({cartData.item_count})</h3>
              <div style={styles.itemsList}>
                {cartData.items?.map((item, index) => {
                  const itemRebateNames = getItemRebateNames(item);
                  
                  return (
                    <div key={index} style={styles.item}>
                      <div style={styles.itemInfo}>
                        <div style={styles.itemName}>{item.name}</div>
                        {item.modifiers && item.modifiers.length > 0 && (
                          <div style={styles.modifiers}>
                            {item.modifiers.map((mod, modIndex) => (
                              <div key={modIndex} style={styles.modifier}>
                                {mod.required ? '• ' : '+ '}{mod.name}
                                {mod.price > 0 && <span> (+${Number(mod.price).toFixed(2)})</span>}
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Show rebate names for this item */}
                        {itemRebateNames.length > 0 && (
                          <div style={styles.itemRebates}>
                            {itemRebateNames.map((rebateName, rebateIndex) => (
                              <div key={rebateIndex} style={styles.rebateName}>
                                {rebateName}
                              </div>
                            ))}
                          </div>
                        )}
                        {item.notes && (
                          <div style={styles.notes}>Note: {item.notes}</div>
                        )}
                      </div>
                      <div style={styles.itemDetails}>
                        <div style={styles.quantity}>Qty: {item.quantity}</div>
                        <div style={styles.price}>${getPosLineSubtotal(item).toFixed(2)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Customer Information */}
            {loyaltyCustomer && (
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>Customer</h3>
                <div style={styles.customerInfo}>
                  <div style={styles.customerName}>{loyaltyCustomer.customer_name}</div>
                  {loyaltyCustomer.customer_email && (
                    <div style={styles.customerDetail}>{loyaltyCustomer.customer_email}</div>
                  )}
                  {loyaltyCustomer.customer_phone && (
                    <div style={styles.customerDetail}>{loyaltyCustomer.customer_phone}</div>
                  )}
                  <div style={styles.loyaltyBalance}>
                    {renderLoyaltyBalance()}
                  </div>
                  {renderDailyUsage()}
                </div>
              </div>
            )}

            <DiscountControls
              saleSubtotal={cartData.subtotal || 0}
              discountAmount={cartData.discount_amount || 0}
              discountName={cartData.discount_name || null}
              selectedDiscountId={cartData.discount_id || null}
              onDiscountChange={handleDiscountChange}
              businessId={auth.selectedBusinessId}
              canApply={canApplyDiscounts}
            />

            {/* Sale Totals - USING ACTUAL CHECKOUT DATA */}
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Order Total</h3>
              {cartData.indian_status_gst_only && (cartData.indian_status_certificate_number || '').trim() && (
                <div style={{
                  padding: TavariStyles.spacing.md,
                  backgroundColor: TavariStyles.colors.successBg || '#e8f5e9',
                  borderRadius: TavariStyles.borderRadius.md,
                  marginBottom: TavariStyles.spacing.md,
                  fontSize: TavariStyles.typography.fontSize.sm
                }}>
                  <strong>Indian Status (GST only)</strong>
                  <div>Status #: {(cartData.indian_status_certificate_number || '').trim()}</div>
                  <div style={{ marginTop: 4, color: TavariStyles.colors.gray600 }}>
                    Tax uses federal GST rate from settings ({((Number(cartData.indian_status_gst_rate) || 0.05) * 100).toFixed(2)}%)
                  </div>
                </div>
              )}
              <div style={styles.totals}>
                <div style={styles.totalRow}>
                  <span>Subtotal</span>
                  <span>${cartData.subtotal.toFixed(2)}</span>
                </div>

                {cartData.discount_amount > 0 && (
                  <div style={styles.totalRowDiscount}>
                    <span>{cartData.discount_name || 'Discount'}</span>
                    <span>-${cartData.discount_amount.toFixed(2)}</span>
                  </div>
                )}

                {cartData.loyalty_redemption > 0 && (
                  <div style={styles.totalRowLoyalty}>
                    <span>
                      {businessSettings.loyalty_mode === 'points' ? 'Points Redemption' : 'Loyalty Redemption'}
                    </span>
                    <span>
                      {businessSettings.loyalty_mode === 'points' 
                        ? `-${Math.round(cartData.loyalty_redemption * 1000).toLocaleString()} pts`
                        : `-$${cartData.loyalty_redemption.toFixed(2)}`
                      }
                    </span>
                  </div>
                )}

                <div style={styles.totalRowSubtotal}>
                  <span>Taxable Amount</span>
                  <span>${(cartData.subtotal - (cartData.discount_amount || 0) - (cartData.loyalty_redemption || 0)).toFixed(2)}</span>
                </div>

                {/* ACTUAL TAX BREAKDOWN FROM CHECKOUT DATA */}
                {(cartData.aggregated_taxes && Object.keys(cartData.aggregated_taxes).length > 0) || 
                 (cartData.aggregated_rebates && Object.keys(cartData.aggregated_rebates).length > 0) ? (
                  <div style={styles.taxSection}>
                    <div style={styles.taxSectionTitle}>Tax Details</div>
                    
                    {/* Show aggregated taxes from actual checkout data */}
                    {cartData.aggregated_taxes && Object.entries(cartData.aggregated_taxes).map(([taxName, amount]) => (
                      <div key={taxName} style={styles.taxRow}>
                        <span>{taxName}</span>
                        <span>${amount.toFixed(2)}</span>
                      </div>
                    ))}
                    
                    {/* Show aggregated rebates from actual checkout data */}
                    {cartData.aggregated_rebates && Object.entries(cartData.aggregated_rebates).map(([rebateName, amount]) => (
                      <div key={rebateName} style={styles.rebateRow}>
                        <span>{rebateName}</span>
                        <span>-${amount.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div style={styles.totalRow}>
                  <span>Total Tax</span>
                  <span>${cartData.tax_amount.toFixed(2)}</span>
                </div>

                {businessSettings.service_fee > 0 && (
                  <div style={styles.totalRow}>
                    <span>Service Fee</span>
                    <span>${((cartData.subtotal * businessSettings.service_fee) || 0).toFixed(2)}</span>
                  </div>
                )}

                <div style={styles.totalRowFinal}>
                  <span>Total</span>
                  <span>${cartData.total_amount.toFixed(2)}</span>
                </div>
              </div>
            </div>
            </div>
          </div>

          {/* Action Buttons - right column: 25% width, Back 25% height / Proceed 75% height */}
          <div style={styles.actionsColumn}>
            <div style={styles.backButtonWrapper}>
              <button style={styles.backButton} onClick={handleBackToRegister}>
                Back to Register
              </button>
            </div>
            <div style={styles.proceedButtonWrapper}>
              <button style={styles.proceedButton} onClick={handleProceedToPayment}>
                Proceed to Payment - ${cartData.total_amount.toFixed(2)}
              </button>
            </div>
          </div>

          {/* Transaction Receipt Modal */}
          {showReceiptModal && selectedTransaction && (
            <div style={styles.modal}>
              <div style={styles.modalContent}>
                <div style={styles.modalHeader}>
                  <h3>Transaction #{selectedTransaction.sale_number}</h3>
                  <button 
                    style={styles.closeButton}
                    onClick={() => setShowReceiptModal(false)}
                  >
                    ×
                  </button>
                </div>
                <div style={styles.receiptDetails}>
                  <div style={styles.detailRow}>
                    <strong>Date:</strong> {formatDateTimeForBusiness(selectedTransaction.created_at, businessTimezone)}
                  </div>
                  <div style={styles.detailRow}>
                    <strong>Total:</strong> ${selectedTransaction.final_total?.toFixed(2) || selectedTransaction.total?.toFixed(2) || '0.00'}
                  </div>
                  <div style={styles.detailRow}>
                    <strong>Customer:</strong> {selectedTransaction.pos_loyalty_accounts?.customer_name || 'N/A'}
                  </div>
                  
                  <h4 style={styles.itemsHeader}>Items</h4>
                  {selectedTransaction.pos_sale_items?.map((item, index) => (
                    <div key={index} style={styles.receiptItem}>
                      <span>{item.quantity}x {item.inventory?.name || item.name || 'Item'}</span>
                      <span>${((item.price || item.unit_price || 0) * (item.quantity || 1)).toFixed(2)}</span>
                    </div>
                  ))}
                  
                  <h4 style={styles.itemsHeader}>Payments</h4>
                  {selectedTransaction.pos_payments?.map((payment, index) => (
                    <div key={index} style={styles.receiptItem}>
                      <span>{payment.payment_method || payment.method}</span>
                      <span>${payment.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div style={styles.modalActions}>
                  <button 
                    style={styles.closeModalButton}
                    onClick={() => setShowReceiptModal(false)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

// Updated styles using TavariStyles
const styles = {
  container: {
    ...TavariStyles.layout.container,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'stretch',
    padding: TavariStyles.spacing.xl,
    paddingTop: '56px',
    gap: TavariStyles.spacing.lg,
    minHeight: 'auto'
  },
  mainArea: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column'
  },
  header: {
    marginBottom: TavariStyles.spacing.lg,
    textAlign: 'center',
    flexShrink: 0
  },
  content: {
    overflowY: 'auto',
    marginBottom: 0
  },
  actionsColumn: {
    width: '25%',
    minWidth: 140,
    display: 'flex',
    flexDirection: 'column',
    alignSelf: 'stretch',
    gap: 0
  },
  backButtonWrapper: {
    height: '25%',
    minHeight: 56,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: TavariStyles.spacing.sm
  },
  proceedButtonWrapper: {
    height: '75%',
    flex: 1,
    minHeight: 120,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: TavariStyles.spacing.sm
  },
  section: {
    ...TavariStyles.layout.card,
    padding: TavariStyles.spacing.xl,
    marginBottom: TavariStyles.spacing.xl
  },
  sectionTitle: {
    margin: `0 0 ${TavariStyles.spacing.lg} 0`,
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    borderBottom: `2px solid ${TavariStyles.colors.primary}`,
    paddingBottom: TavariStyles.spacing.sm
  },
  itemsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.md
  },
  item: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px solid ${TavariStyles.colors.gray200}`
  },
  itemInfo: {
    flex: 1
  },
  itemName: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.gray800,
    marginBottom: TavariStyles.spacing.xs
  },
  modifiers: {
    marginLeft: TavariStyles.spacing.lg,
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600
  },
  modifier: {
    marginBottom: '2px',
    fontStyle: 'italic'
  },
  itemRebates: {
    marginLeft: TavariStyles.spacing.lg,
    marginTop: TavariStyles.spacing.xs
  },
  rebateName: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.success,
    fontWeight: TavariStyles.typography.fontWeight.medium,
    fontStyle: 'italic',
    marginBottom: '2px'
  },
  notes: {
    marginTop: TavariStyles.spacing.sm,
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.success,
    fontStyle: 'italic'
  },
  itemDetails: {
    textAlign: 'right',
    minWidth: '100px'
  },
  quantity: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    marginBottom: TavariStyles.spacing.xs
  },
  price: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.gray800
  },
  customerInfo: {
    padding: TavariStyles.spacing.lg,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.md
  },
  customerName: {
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    marginBottom: TavariStyles.spacing.xs
  },
  customerDetail: {
    fontSize: TavariStyles.typography.fontSize.sm,
    marginBottom: TavariStyles.spacing.xs,
    opacity: 0.9
  },
  loyaltyBalance: {
    fontSize: TavariStyles.typography.fontSize.sm,
    marginTop: TavariStyles.spacing.sm,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    backgroundColor: 'rgba(255,255,255,0.2)',
    padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.md}`,
    borderRadius: TavariStyles.borderRadius.sm,
    display: 'inline-block'
  },
  dailyUsage: {
    marginTop: TavariStyles.spacing.md,
    backgroundColor: 'rgba(255,255,255,0.1)',
    padding: TavariStyles.spacing.md,
    borderRadius: TavariStyles.borderRadius.sm,
    borderLeft: '3px solid rgba(255,255,255,0.5)'
  },
  usageHeader: {
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    marginBottom: TavariStyles.spacing.sm,
    opacity: 0.9
  },
  usageTransaction: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: TavariStyles.typography.fontSize.xs,
    marginBottom: TavariStyles.spacing.xs,
    opacity: 0.9
  },
  transactionNumber: {
    cursor: 'pointer',
    textDecoration: 'underline',
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    flex: 1
  },
  transactionAmount: {
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    marginRight: TavariStyles.spacing.md
  },
  transactionTime: {
    fontSize: '11px',
    opacity: 0.7
  },
  totals: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.sm
  },
  totalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: TavariStyles.typography.fontSize.lg,
    color: TavariStyles.colors.gray800
  },
  totalRowDiscount: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: TavariStyles.typography.fontSize.lg,
    color: TavariStyles.colors.danger,
    fontWeight: TavariStyles.typography.fontWeight.medium
  },
  totalRowLoyalty: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: TavariStyles.typography.fontSize.lg,
    color: TavariStyles.colors.success,
    fontWeight: TavariStyles.typography.fontWeight.medium
  },
  totalRowSubtotal: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.medium,
    color: TavariStyles.colors.gray800,
    paddingTop: TavariStyles.spacing.sm,
    borderTop: `1px solid ${TavariStyles.colors.gray200}`,
    marginTop: TavariStyles.spacing.xs
  },
  taxSection: {
    ...TavariStyles.pos.tax.section
  },
  taxSectionTitle: {
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray700,
    marginBottom: TavariStyles.spacing.sm,
    borderBottom: `1px solid ${TavariStyles.colors.gray300}`,
    paddingBottom: TavariStyles.spacing.xs
  },
  taxRow: {
    ...TavariStyles.pos.tax.row
  },
  rebateRow: {
    ...TavariStyles.pos.tax.rebate
  },
  totalRowFinal: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    paddingTop: TavariStyles.spacing.md,
    borderTop: `2px solid ${TavariStyles.colors.primary}`,
    marginTop: TavariStyles.spacing.sm
  },
  actions: {
    display: 'flex',
    gap: TavariStyles.spacing.lg,
    justifyContent: 'space-between'
  },
  backButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.secondary,
    ...TavariStyles.components.button.sizes.lg,
    width: '100%',
    minHeight: 48,
    flex: 1,
    alignSelf: 'stretch'
  },
  proceedButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.primary,
    ...TavariStyles.components.button.sizes.lg,
    width: '100%',
    minHeight: 48,
    flex: 1,
    alignSelf: 'stretch'
  },
  loading: {
    ...TavariStyles.components.loading.container,
    flex: 1,
    fontSize: TavariStyles.typography.fontSize.xl,
    color: TavariStyles.colors.gray600
  },
  spinner: {
    ...TavariStyles.components.loading.spinner,
    marginBottom: TavariStyles.spacing.xl
  },
  error: {
    flex: 1,
    textAlign: 'center',
    padding: TavariStyles.spacing['4xl'],
    color: TavariStyles.colors.danger
  },
  modal: {
    ...TavariStyles.components.modal.overlay
  },
  modalContent: {
    ...TavariStyles.components.modal.content,
    maxWidth: '600px',
    width: '90%',
    maxHeight: '80vh'
  },
  modalHeader: {
    ...TavariStyles.components.modal.header
  },
  closeButton: {
    background: 'transparent',
    border: 'none',
    fontSize: TavariStyles.typography.fontSize['3xl'],
    cursor: 'pointer',
    color: TavariStyles.colors.gray600
  },
  receiptDetails: {
    marginBottom: TavariStyles.spacing.xl
  },
  detailRow: {
    padding: `${TavariStyles.spacing.sm} 0`,
    borderBottom: `1px solid ${TavariStyles.colors.gray100}`,
    fontSize: TavariStyles.typography.fontSize.sm
  },
  itemsHeader: {
    marginTop: TavariStyles.spacing.xl,
    marginBottom: TavariStyles.spacing.md,
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800
  },
  receiptItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: `${TavariStyles.spacing.xs} 0`,
    fontSize: TavariStyles.typography.fontSize.sm,
    borderBottom: `1px solid ${TavariStyles.colors.gray50}`
  },
  modalActions: {
    ...TavariStyles.components.modal.footer,
    justifyContent: 'flex-end'
  },
  closeModalButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.secondary,
    ...TavariStyles.components.button.sizes.md
  }
};

export default SaleReviewScreen;