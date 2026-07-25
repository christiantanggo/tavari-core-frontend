// screens/POS/PaymentScreen.jsx - Updated with Permissions and Clean Logging
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { logAction } from '../../helpers/posAudit';
import { scheduleCustomerDisplayMirrorPush } from '../../services/customerDisplayMirrorSync';
import {
  cancelCustomerDisplayPaymentExpiry,
  clearCustomerDisplayPaymentLocalAndMirror,
  scheduleCustomerDisplayPaymentAutoClear
} from '../../services/customerDisplayLocalState';

// Foundation Components
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { TavariStyles } from '../../utils/TavariStyles';

// Permission system integration
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import toast from 'react-hot-toast';
import { FiLock } from 'react-icons/fi';

// Payment Screen Components
import PaymentSummary from '../../components/POS/POSPaymentScreenComponents/PaymentSummary';
import PaymentMethods from '../../components/POS/POSPaymentScreenComponents/PaymentMethods';
import PaymentAmountInput from '../../components/POS/POSPaymentScreenComponents/PaymentAmountInput';
import TipControls from '../../components/POS/POSPaymentScreenComponents/TipControls';
import DiscountControls from '../../components/POS/POSPaymentScreenComponents/DiscountControls';
import ManagerOverrideModal from '../../components/POS/POSPaymentScreenComponents/ManagerOverrideModal';
import LoyaltyDisplay from '../../components/POS/POSPaymentScreenComponents/LoyaltyDisplay';
import { useSaleProcessor } from '../../components/POS/POSPaymentScreenComponents/SaleProcessor';
import HelcimCardReader from '../../components/POS/HelcimCardReader';
import useHelcimPayment from '../../hooks/useHelcimPayment';
import { resolveCurrentPosAttribution } from '../../utils/posSaleAttribution';
import {
  dollarsToLoyaltyPoints,
  getSpendableDollarsInDollarsMode,
  getSpendableDollarsInPointsMode,
  isPointsLoyaltyMode,
  splitLoyaltyRedemptionDollars
} from '../../utils/posLoyaltyMoney';
import { calculateTotalLoyaltyPointsToEarn } from '../../utils/loyaltyRewards';
import { applySaleStockAdjustments } from '../../utils/posInventoryStock';
import { persistRegisterLockAfterSale } from '../../utils/posRegisterLock';
import { getSaleItemFoodCostFields } from '../../utils/posLineFoodCost';
import { getPosLineSubtotal, getPosLineUnitPrice } from '../../utils/posLinePricing';
import * as GiftCardService from '../../services/GiftCards/GiftCardService';

const PaymentScreen = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Authentication using standardized hook
  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'PaymentScreen'
  });
  
  // Permission system integration
  const { 
    hasPermission, 
    hasAnyPermission,
    isOwner, 
    isManager,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Permission checks - all users should be able to process transactions
  // Permissions match the PIN used to unlock the register (employee's permissions)
  const canProcessPayments = hasAnyPermission(['pos.sales.process', 'pos.sales.create', 'pos.register.operate']) || hasElevatedPrivileges();
  const canApplyDiscounts =
    hasPermission('pos.discounts.apply') ||
    hasPermission('pos.discounts.apply_any') ||
    hasElevatedPrivileges();
  const canUseLoyalty = hasPermission('pos.loyalty.use') || hasElevatedPrivileges();
  const canProcessRefunds = hasPermission('pos.refunds.process') || hasElevatedPrivileges();
  const canOverridePayments = hasPermission('pos.override.manager') || isManager() || isOwner();
  
  // Tax calculation utility using standardized hook
  const taxCalc = useTaxCalculations(auth.selectedBusinessId);
  
  const [saleData, setSaleData] = useState(null);
  const [loyaltySettings, setLoyaltySettings] = useState(null);
  const [businessSettings, setBusinessSettings] = useState(null);
  
  const [payments, setPayments] = useState([]);
  const paymentsRef = useRef([]);
  const [currentPayment, setCurrentPayment] = useState({ method: 'cash', amount: '' });
  const [customMethodName, setCustomMethodName] = useState('');
  const [showCustomMethod, setShowCustomMethod] = useState(false);
  const [showManagerOverride, setShowManagerOverride] = useState(false);
  const [managerPin, setManagerPin] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [tipAmount, setTipAmount] = useState(0);
  const [overrideError, setOverrideError] = useState('');
  
  // HELCIM TERMINAL STATE
  const [showHelcimTerminal, setShowHelcimTerminal] = useState(false);
  const [helcimPaymentAmount, setHelcimPaymentAmount] = useState(0);
  const [helcimSaleId, setHelcimSaleId] = useState(null); // real pos_sales.id used for Helcim invoiceNumber
  const [draftSaleId, setDraftSaleId] = useState(null);
  const [draftReceiptNumber, setDraftReceiptNumber] = useState(null);
  const helcimPayment = useHelcimPayment(auth.selectedBusinessId);
  
  // LOYALTY STATE
  const [autoLoyaltyApplied, setAutoLoyaltyApplied] = useState(0);
  const [availableLoyaltyCredit, setAvailableLoyaltyCredit] = useState(0);
  const [loyaltyPointsToEarn, setLoyaltyPointsToEarn] = useState(0);
  const [loyaltyCreditsToEarn, setLoyaltyCreditsToEarn] = useState(0);
  const [dailyUsageRemaining, setDailyUsageRemaining] = useState(0);

  const receivedSaleData = location.state?.saleData;

  const navigateBackFromPayment = () => {
    const fromRegister = location.state?.from === 'register';
    if (!fromRegister) {
      navigate('/dashboard/pos/tabs');
      return;
    }

    const source = saleData || receivedSaleData;
    const items = source?.items || [];
    const customer = source?.loyaltyCustomer || null;

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

  const clearPersistedRegisterCart = () => {
    if (!auth.selectedBusinessId) return;
    sessionStorage.removeItem(`pos_cart_${auth.selectedBusinessId}`);
  };

  const buildPosSaleNotes = (loyaltyRedeemed, data = saleData) => {
    const parts = [];
    if (loyaltyRedeemed > 0) {
      parts.push(`Loyalty redemption: $${loyaltyRedeemed.toFixed(2)}`);
    }
    const discountAmt = Number(data?.discount_amount) || 0;
    if (discountAmt > 0) {
      const label = data?.discount_name || 'Discount';
      parts.push(`${label}: −$${discountAmt.toFixed(2)}`);
    }
    if (data?.indian_status_gst_only && (data?.indian_status_certificate_number || '').trim()) {
      parts.push(
        `Indian Status (GST only) #${(data.indian_status_certificate_number || '').trim()}`
      );
    }
    return parts.length ? parts.join(' | ') : null;
  };

  // Keep a live reference so async finalization never sees stale `payments`.
  useEffect(() => {
    paymentsRef.current = payments || [];
  }, [payments]);

  // Sale processor utilities
  const saleProcessor = useSaleProcessor(auth, taxCalc, businessSettings);
  const saleAttribution = resolveCurrentPosAttribution({
    authUser: auth.authUser,
    activePOSUser: auth.activePOSUser,
    businessId: auth.selectedBusinessId
  });
  const effectiveOperatorUserId = saleAttribution.operatorUserId || auth.authUser?.id || null;

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canProcessPayments) {
      toast.error('You do not have permission to process payments');
      navigateBackFromPayment();
    }
  }, [permissionsLoading, canProcessPayments, navigate, location.state?.from]);

  // Helper function to display balance in correct format
  const getBalanceDisplay = (dollarAmount) => {
    if (!loyaltySettings) return '$0.00';
    
    const balanceInDollars = Math.abs(dollarAmount || 0);
    
    if (loyaltySettings.loyalty_mode === 'points') {
      const points = Math.round(balanceInDollars * loyaltySettings.redemption_rate);
      const displayPoints = Math.abs(points);
      return `${displayPoints.toLocaleString()} pts`;
    }
    return `$${balanceInDollars.toFixed(2)}`;
  };

  // Create a POS sale record BEFORE terminal payment so we have a stable ID to tie to Helcim.
  // This allows invoiceNumber = `SALE-{pos_sales.id}` and enables webhook/lookup to update the correct sale.
  const ensureDraftSaleForHelcim = async () => {
    if (draftSaleId) return { saleId: draftSaleId, receiptNumber: draftReceiptNumber };

    if (!auth?.authUser?.id) {
      throw new Error('User not authenticated');
    }
    if (!auth.selectedBusinessId) {
      throw new Error('Business not selected');
    }

    // Use the same receipt number that will be used at finalization.
    const receiptNumber = await saleProcessor.generateReceiptNumber();
    const nowIso = new Date().toISOString();

    // Calculate total loyalty redeemed from all loyalty payment methods + auto apply
    const totalLoyaltyRedeemed = payments
      .filter(p => p.method === 'loyalty_credit')
      .reduce((sum, p) => sum + (p.amount || 0), 0) + autoLoyaltyApplied;

    const draftSaleRecord = {
      business_id: auth.selectedBusinessId,
      user_id: effectiveOperatorUserId,
      login_user_id: saleAttribution.loginUserId,
      operator_user_id: effectiveOperatorUserId,
      login_user_name: saleAttribution.loginUserName,
      operator_user_name: saleAttribution.operatorUserName,
      customer_id: saleData?.loyaltyCustomer?.id || null,
      loyalty_customer_id: saleData?.loyaltyCustomer?.id || null,
      customer_name: saleData?.loyaltyCustomer?.customer_name || null,
      customer_phone: saleData?.loyaltyCustomer?.customer_phone || null,

      subtotal: saleSubtotal,
      tax: finalTaxAmount,
      discount: discountAmount,
      loyalty_discount: totalLoyaltyRedeemed,
      total: displayTotal,

      payment_status: 'unpaid',
      payment_method: 'helcim_terminal',
      sale_number: receiptNumber,
      notes: buildPosSaleNotes(totalLoyaltyRedeemed, saleData),
      indian_status_gst_only: !!saleData?.indian_status_gst_only,
      indian_status_certificate_number: saleData?.indian_status_certificate_number?.trim() || null,
      item_count: saleData?.items?.length || 0,
      created_at: nowIso,
      updated_at: nowIso
    };

    const { data: sale, error: saleError } = await supabase
      .from('pos_sales')
      .insert(draftSaleRecord)
      .select()
      .single();

    if (saleError) {
      throw new Error(saleError.message || 'Failed to create draft sale');
    }

    setDraftSaleId(sale.id);
    setDraftReceiptNumber(receiptNumber);
    setHelcimSaleId(sale.id);

    return { saleId: sale.id, receiptNumber };
  };

  // Set up sale data when authentication is ready
  useEffect(() => {
    if (auth.isReady && receivedSaleData && !permissionsLoading) {
      if (!canProcessPayments) {
        toast.error('You do not have permission to process payments');
        navigateBackFromPayment();
        return;
      }

      setSaleData(receivedSaleData);
      
      logAction({
        action: 'payment_screen_opened',
        context: 'PaymentScreen',
        metadata: {
          sale_total: receivedSaleData.total_amount,
          item_count: receivedSaleData.item_count,
          customer_attached: !!receivedSaleData.loyaltyCustomer,
          tax_breakdown: receivedSaleData.aggregated_taxes,
          rebate_breakdown: receivedSaleData.aggregated_rebates
        }
      });
    } else if (auth.isReady && !receivedSaleData) {
      setError('No sale data provided - please return to tabs and try again');
    }
  }, [auth.isReady, receivedSaleData, permissionsLoading, canProcessPayments]);

  // Load settings after authentication
  useEffect(() => {
    if (auth.isReady && !permissionsLoading) {
      loadLoyaltySettings();
      loadBusinessSettings();
    }
  }, [auth.isReady, permissionsLoading]);

  const loadBusinessSettings = async () => {
    if (!auth.selectedBusinessId) return;

    try {
      const { data: businessInfo, error: businessError } = await supabase
        .from('businesses')
        .select('name')
        .eq('id', auth.selectedBusinessId)
        .single();

      const { data: posSettings, error: posError } = await supabase
        .from('pos_settings')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .maybeSingle();

      if (businessError && businessError.code !== 'PGRST116') {
        toast.error('Failed to load business settings');
      }

      if (posError && posError.code && posError.code !== 'PGRST116') {
        console.warn('⚠️ Failed to load POS settings:', posError.message);
      }

      const combinedSettings = {
        timezone: 'America/Toronto',
        name: businessInfo?.name || 'Business',
        tip_enabled: posSettings?.tip_enabled || false,
        default_tip_percent: posSettings?.default_tip_percent || 0.15,
        ...posSettings
      };

      setBusinessSettings(combinedSettings);
    } catch (err) {
      toast.error('Failed to load business settings');
      setBusinessSettings({
        timezone: 'America/Toronto',
        name: 'Business',
        tip_enabled: false,
        default_tip_percent: 0.15
      });
    }
  };

  const loadLoyaltySettings = async () => {
    if (!auth.selectedBusinessId) return;

    try {
      const { data: settings, error } = await supabase
        .from('pos_loyalty_settings')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .maybeSingle();

      if (error && error.code && error.code !== 'PGRST116') {
        console.warn('⚠️ Failed to load loyalty settings:', error.message);
        return;
      }

      if (settings) {
        setLoyaltySettings(settings);
      } else {
        setLoyaltySettings(null);
      }
    } catch (err) {
      setLoyaltySettings(null);
    }
  };

  // MAIN LOYALTY CALCULATION
  const calculateLoyaltyCredits = async () => {
    if (!saleData?.loyaltyCustomer || !loyaltySettings?.is_active || !canUseLoyalty) {
      setAvailableLoyaltyCredit(0);
      setAutoLoyaltyApplied(0);
      setLoyaltyPointsToEarn(0);
      setLoyaltyCreditsToEarn(0);
      return;
    }

    try {
      // Get today's date in business timezone
      const today = saleProcessor.getTodayInBusinessTimezone();
      
      // Get today's usage for this customer
      const { data: todayUsage, error: usageError } = await supabase
        .from('pos_loyalty_daily_usage')
        .select('amount_used')
        .eq('loyalty_account_id', saleData.loyaltyCustomer.id)
        .eq('usage_date', today)
        .maybeSingle();

      if (usageError && usageError.code && usageError.code !== 'PGRST116') {
        console.warn('⚠️ Failed to load daily loyalty usage:', usageError.message);
      }

      const usedTodayDollars = todayUsage?.amount_used || 0;
      
      // Daily cap in dollars (align with cart: max_redemption_per_day is in “points” at rate/10)
      const rate = Number(loyaltySettings.redemption_rate) || 10000;
      const dailyLimitPoints = loyaltySettings.max_redemption_per_day || 5000;
      const dailyLimitDollars = (dailyLimitPoints / rate) * 10;
      
      const remainingDailyLimitDollars = Math.max(0, dailyLimitDollars - usedTodayDollars);
      setDailyUsageRemaining(remainingDailyLimitDollars);
      
      const acc = saleData.loyaltyCustomer;
      const customerBalanceDollars = isPointsLoyaltyMode(loyaltySettings)
        ? getSpendableDollarsInPointsMode(acc, loyaltySettings)
        : getSpendableDollarsInDollarsMode(acc);
      
      // Available credit is minimum of: customer pool, remaining daily limit, and sale amount
      const saleSubtotal = saleData?.subtotal || 0;
      const maxUsableDollars = Math.min(customerBalanceDollars, remainingDailyLimitDollars, saleSubtotal);
      
      setAvailableLoyaltyCredit(Math.max(0, maxUsableDollars));

      // Auto-apply logic
      let autoApplyAmount = 0;
      if (loyaltySettings.auto_apply === 'always' && maxUsableDollars > 0) {
        // Minimum redemption in dollars (points ÷ rate × 10, same as cart)
        const minRedemptionPoints = loyaltySettings.min_redemption || 5000;
        const minRedemptionDollars = (minRedemptionPoints / rate) * 10;
        
        if (maxUsableDollars >= minRedemptionDollars) {
          if (loyaltySettings.allow_partial_redemption) {
            // Use maximum available up to daily limit and sale amount
            autoApplyAmount = Math.min(maxUsableDollars, saleSubtotal);
          } else {
            // Use minimum redemption amount if customer has enough
            autoApplyAmount = Math.min(minRedemptionDollars, maxUsableDollars, saleSubtotal);
          }
        }
      }
      
      setAutoLoyaltyApplied(autoApplyAmount);

      // Calculate points to earn on this purchase
      const earnRatePercent = loyaltySettings.earn_rate_percentage / 100;
      const taxableAmountForEarning = saleSubtotal - autoApplyAmount; // Earn on amount after loyalty redemption
      const dollarsToEarn = taxableAmountForEarning * earnRatePercent;
      const pointsToEarn = calculateTotalLoyaltyPointsToEarn({
        subtotal: taxableAmountForEarning,
        earnRatePercentage: loyaltySettings.earn_rate_percentage,
        redemptionRate: rate,
        cartItems: saleData?.items || [],
      });
      
      setLoyaltyCreditsToEarn(dollarsToEarn);
      setLoyaltyPointsToEarn(pointsToEarn);

    } catch (err) {
      setAvailableLoyaltyCredit(0);
      setAutoLoyaltyApplied(0);
      setLoyaltyPointsToEarn(0);
      setLoyaltyCreditsToEarn(0);
    }
  };

  // Calculate loyalty credits after saleData, settings, and business settings are loaded
  useEffect(() => {
    if (saleData && loyaltySettings && businessSettings && auth.selectedBusinessId && canUseLoyalty) {
      calculateLoyaltyCredits();
    }
  }, [saleData, loyaltySettings, businessSettings, auth.selectedBusinessId, canUseLoyalty]);

  // ENHANCED TAX CALCULATIONS using the standardized utility
  const saleSubtotal = saleData?.subtotal || 0;
  const loyaltyRedemption = autoLoyaltyApplied; // Use calculated auto-apply amount
  const discountAmount = saleData?.discount_amount || 0;

  const handleDiscountChange = ({ amount, discount }) => {
    if (!canApplyDiscounts) {
      toast.error('You do not have permission to apply discounts');
      return;
    }
    if (!saleData) return;

    const subtotal = Number(saleData.subtotal) || 0;
    const loyaltyRedemption = Number(autoLoyaltyApplied) || 0;
    const maxDiscount = Math.max(0, subtotal - loyaltyRedemption);
    const cappedDiscount = Math.round(Math.min(Math.max(0, Number(amount) || 0), maxDiscount) * 100) / 100;

    setSaleData((prev) => ({
      ...prev,
      discount_amount: cappedDiscount,
      discount_id: discount?.id || null,
      discount_name: discount?.name || null,
      discount_type: discount?.type || null,
      discount_value: discount?.value ?? null
    }));
  };
  
  // Recalculate taxes when tip changes or when we have all required data
  const recalculateTaxes = () => {
    if (!saleData?.items) {
      return {
        totalTax: saleData?.tax_amount || 0,
        aggregatedTaxes: saleData?.aggregated_taxes || {},
        aggregatedRebates: saleData?.aggregated_rebates || {},
        itemTaxDetails: saleData?.item_tax_details || []
      };
    }

    if (saleData.indian_status_gst_only) {
      const rate =
        Number(saleData.indian_status_gst_rate) ||
        Number(businessSettings?.indian_status_gst_rate) ||
        0.05;
      const label =
        (saleData.indian_status_tax_label && String(saleData.indian_status_tax_label).trim()) ||
        (businessSettings?.indian_status_tax_label && String(businessSettings.indian_status_tax_label).trim()) ||
        'GST (Indian Status)';
      return taxCalc.calculateTotalTax(
        saleData.items,
        discountAmount,
        loyaltyRedemption,
        saleSubtotal,
        { enabled: true, gstRate: rate, taxLabel: label }
      );
    }

    if (taxCalc.loading || !taxCalc.taxCategories.length) {
      return {
        totalTax: saleData?.tax_amount || 0,
        aggregatedTaxes: saleData?.aggregated_taxes || {},
        aggregatedRebates: saleData?.aggregated_rebates || {},
        itemTaxDetails: saleData?.item_tax_details || []
      };
    }

    return taxCalc.calculateTotalTax(
      saleData.items,
      discountAmount,
      loyaltyRedemption,
      saleSubtotal
    );
  };

  const taxCalculation = recalculateTaxes();
  const finalTaxAmount = taxCalculation.totalTax;
  
  // Calculate taxable amount after discounts and loyalty
  const taxableAmount = saleSubtotal - discountAmount - loyaltyRedemption;
  
  // Final total calculation with tip
  const subtotalAfterReductions = taxableAmount;
  const finalTotal = subtotalAfterReductions + finalTaxAmount + tipAmount;
  
  const cashRoundedTotal = taxCalc.applyCashRounding(finalTotal, 'cash');
  const hasPayments = payments.length > 0;
  const allAppliedPaymentsAreCash = payments.every((payment) => payment.method === 'cash');
  const shouldUseCashRounding =
    currentPayment.method === 'cash' &&
    currentPayment.amount !== '' &&
    (!hasPayments || allAppliedPaymentsAreCash);

  // Only round when the transaction is actually being paid as cash.
  const displayTotal = shouldUseCashRounding ? cashRoundedTotal : finalTotal;
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const remainingBalance = displayTotal - totalPaid;
  /** Unrounded balance owed — card/terminal/loyalty must never use penny-free cash totals. */
  const exactRemainingBalance = Math.max(0, finalTotal - totalPaid);
  const changeOwed = Math.max(0, totalPaid - displayTotal);
  const cashRemainingBalance = Math.max(0, cashRoundedTotal - totalPaid);

  // Update payment status on customer display
  const updatePaymentStatus = (status, additionalData = {}) => {
    const currentPaymentData = localStorage.getItem('tavari_customer_display_payment');
    if (currentPaymentData) {
      try {
        const paymentData = JSON.parse(currentPaymentData);
        const updatedPaymentData = {
          ...paymentData,
          status,
          ...additionalData,
          timestamp: Date.now()
        };
        localStorage.setItem('tavari_customer_display_payment', JSON.stringify(updatedPaymentData));
        scheduleCustomerDisplayMirrorPush(auth.selectedBusinessId);
        console.log('💳 PaymentScreen: Payment status updated:', status, updatedPaymentData);
      } catch (error) {
        console.error('❌ PaymentScreen: Error updating payment status:', error);
      }
    }
  };

  // Payment handling functions
  const handleAddPayment = async (amount, method, customName) => {
    // Permission check
    if (!canProcessPayments) {
      toast.error('You do not have permission to process payments');
      return;
    }

    let paymentAmount = amount;
    let giftCardMeta = null;

    // Special handling for loyalty credit payments
    if (method === 'loyalty_credit') {
      if (!canUseLoyalty) {
        toast.error('You do not have permission to use loyalty credits');
        return;
      }

      if (amount > availableLoyaltyCredit) {
        setError(`Maximum loyalty credit available: ${availableLoyaltyCredit.toFixed(2)}`);
        return;
      }
      
      if (!loyaltySettings.allow_partial_redemption) {
        const minRedemptionDollars = loyaltySettings.min_redemption / loyaltySettings.redemption_rate;
        if (amount < minRedemptionDollars) {
          setError(`Minimum redemption: $${minRedemptionDollars.toFixed(2)}`);
          return;
        }
      }
    }

    // Gift card: scan/enter code → apply up to balance → remaining tender still needed
    if (method === 'gift_card') {
      const code = window.prompt('Scan or enter gift card code:');
      if (!code || !String(code).trim()) {
        setError('Gift card code is required');
        return;
      }
      try {
        const result = await GiftCardService.redeemGiftCard({
          businessId: auth.selectedBusinessId,
          codeOrPayload: code.trim(),
          amountDollars: amount,
          redeemerCustomerId: saleData?.loyaltyCustomer?.id || null,
          processedByUserId: auth.authUser?.id || null,
        });
        paymentAmount = Number(result.appliedAmount) || 0;
        if (paymentAmount <= 0) {
          setError('No balance available on this gift card');
          return;
        }
        giftCardMeta = {
          gift_card_code: result.card?.code,
          gift_card_id: result.card?.id,
          attached_credit: result.attachedCredit || 0,
        };
        if (result.remainingDue > 0.009) {
          toast(`Gift card applied $${paymentAmount.toFixed(2)}. Collect another tender for $${result.remainingDue.toFixed(2)}.`, { icon: '🎁' });
        } else {
          toast.success(`Gift card applied $${paymentAmount.toFixed(2)}`);
        }
        if (result.attachedCredit > 0) {
          toast.success(`Residual $${result.attachedCredit.toFixed(2)} attached to customer gift card credit`);
        }
      } catch (gcErr) {
        setError(gcErr.message || 'Gift card redeem failed');
        toast.error(gcErr.message || 'Gift card redeem failed');
        return;
      }
    }

    // Check for overpayment - allow small overpayments without manager approval
    // All employees should be able to process transactions without manager override
    // Allow $0.05 tolerance for exact payments to account for floating point precision issues
    const exactPaymentTolerance = 0.05;
    const smallOverpaymentThreshold = 0.05;
    const isSignificantOverpayment = paymentAmount > (remainingBalance + smallOverpaymentThreshold);
    const isWithinExactTolerance = Math.abs(paymentAmount - remainingBalance) <= exactPaymentTolerance;
    
    // Cash payments can always go over (for giving change)
    // For non-cash payments, allow payments within $0.05 tolerance without any approval
    // Only require manager approval for overpayments > $0.05
    if (isSignificantOverpayment && method !== 'cash' && !isWithinExactTolerance) {
      if (!showManagerOverride) {
        // Always show the manager override modal when overpayment is detected
        // The modal will require a manager PIN to approve
        setShowManagerOverride(true);
        setOverrideReason(`Overpayment detected: Payment amount ($${paymentAmount.toFixed(2)}) exceeds remaining balance ($${remainingBalance.toFixed(2)}) by more than $${smallOverpaymentThreshold.toFixed(2)}. Manager approval required.`);
        setError(''); // Clear any previous errors
        return;
      }
    }
    // Payments within $0.05 tolerance are automatically allowed - no approval needed for any employee

    if (method === 'custom' && !customName?.trim()) {
      setError('Please enter a custom payment method name');
      return;
    }

    if (showManagerOverride) {
      // Validate manager PIN - if valid, allow approval regardless of user's permissions
      // The PIN itself is the authorization for the override
      if (!managerPin || managerPin.trim() === '') {
        setOverrideError('Please enter a manager PIN to approve this override');
        return;
      }

      const isValidPin = await auth.validateManagerPin(managerPin);
      if (!isValidPin) {
        setOverrideError('Invalid manager PIN. Please try again.');
        return;
      }

      // PIN is valid - proceed with override
      setOverrideError('');
      await logAction({
        action: 'manager_override_payment',
        context: 'PaymentScreen',
        metadata: { 
          reason: overrideReason, 
          amount: paymentAmount, 
          method: method,
          approved_by_pin: true
        }
      });
    }

    const newPayment = {
      id: Date.now(),
      method: method,
      amount: paymentAmount,
      custom_method_name: method === 'custom' ? customName : null,
      tip_amount: payments.length === 0 ? tipAmount : 0,
      timestamp: new Date().toISOString(),
      ...(giftCardMeta || {}),
    };

    const updatedPayments = [...payments, newPayment];
    setPayments(updatedPayments);
    paymentsRef.current = updatedPayments;
    
    // Send payment info to customer display
    const paymentData = {
      method: method,
      amount: paymentAmount,
      change: method === 'cash' ? Math.max(0, paymentAmount - remainingBalance) : 0,
      status: 'processing',
      timestamp: Date.now(),
      customMethodName: method === 'custom' ? customName : null
    };
    
    localStorage.setItem('tavari_customer_display_payment', JSON.stringify(paymentData));
    scheduleCustomerDisplayMirrorPush(auth.selectedBusinessId);
    cancelCustomerDisplayPaymentExpiry();
    console.log('💳 PaymentScreen: Payment data sent to customer display:', paymentData);
    
    const newRemainingBalance = remainingBalance - paymentAmount;
    setCurrentPayment({ 
      method: 'cash', 
      amount: newRemainingBalance > 0 ? newRemainingBalance.toFixed(2) : '' 
    });
    setCustomMethodName('');
    setShowCustomMethod(false);
    setShowManagerOverride(false);
    setManagerPin('');
    setOverrideReason('');
    setOverrideError('');
    setError(null);

    // Update payment status based on method
    if (method === 'cash') {
      // Cash payments are immediate
      updatePaymentStatus('success');
      if (newRemainingBalance <= 0.01) {
        await finalizeSale(updatedPayments);
      }
    } else if (method === 'card') {
      // Card payments need terminal processing
      updatePaymentStatus('processing');
    } else if (method === 'helcim_terminal') {
      // Helcim Gen 2 terminal payments - show terminal interface
      try {
        const draft = await ensureDraftSaleForHelcim();
        setHelcimSaleId(draft.saleId);
      } catch (draftErr) {
        // Remove the pending payment we just added (since we can't start terminal flow)
        setPayments(prev => prev.filter(p => p.id !== newPayment.id));
        paymentsRef.current = (paymentsRef.current || []).filter((p) => p.id !== newPayment.id);
        setError(draftErr.message || 'Unable to create sale record for Helcim payment');
        updatePaymentStatus('error', { errorMessage: draftErr.message });
        toast.error(draftErr.message || 'Unable to start Helcim payment');
        return;
      }

      setHelcimPaymentAmount(paymentAmount);
      setShowHelcimTerminal(true);
      updatePaymentStatus('processing');
    } else {
      // Other methods (gift card, loyalty, custom) are immediate
      updatePaymentStatus('success');
      if (newRemainingBalance <= 0.01) {
        await finalizeSale(updatedPayments);
      }
    }
  };

  // Handle Helcim terminal payment success
  const handleHelcimPaymentSuccess = async (paymentResult) => {
    console.log('[PaymentScreen] Helcim payment successful:', paymentResult);
    
    // If payment is awaiting card, keep terminal UI open and wait for customer to complete
    if (paymentResult.status === 'awaiting_card' || paymentResult.status === 'awaiting_confirmation') {
      console.log('[PaymentScreen] Payment awaiting confirmation - keeping terminal UI open');
      toast.info('Waiting for Helcim to confirm the transaction...');
      // Don't close terminal UI or complete sale yet - wait for customer
      // The terminal UI will show the message to complete payment
      return;
    }
    
    // Payment is completed (or has transaction details)
    if (!paymentResult.transactionId) {
      console.error('[PaymentScreen] Missing transactionId for completed Helcim payment:', paymentResult);
      toast.error('Payment could not be verified (missing transaction ID). Please retry verification.');
      return;
    }

    // Update the last payment with transaction details
    const updatedPayments = [...payments];
    if (updatedPayments.length > 0) {
      const lastPayment = updatedPayments[updatedPayments.length - 1];
      if (lastPayment.method === 'helcim_terminal') {
        lastPayment.transaction_id = paymentResult.transactionId;
        lastPayment.approval_code = paymentResult.approvalCode;
        lastPayment.card_type = paymentResult.cardType;
        lastPayment.last_four = paymentResult.lastFour;
        lastPayment.status = 'completed';

        // A manager-authorized +$0.01 override charges a different amount than the sale
        // total so Helcim's duplicate check lets it through. Record what was actually
        // charged so the till matches the Helcim batch.
        if (paymentResult.duplicateOverride?.chargedCents) {
          lastPayment.amount = paymentResult.duplicateOverride.chargedCents / 100;
          lastPayment.duplicate_override = paymentResult.duplicateOverride;
        } else if (typeof paymentResult.amount === 'number' && paymentResult.amount > 0) {
          const charged = Number(paymentResult.amount);
          const recorded = Number(lastPayment.amount);
          if (Math.abs(charged - recorded) >= 0.005 && Math.abs(charged - recorded) <= 0.02) {
            lastPayment.amount = charged;
          }
        }
      }
    }
    setPayments(updatedPayments);
    paymentsRef.current = updatedPayments;
    
    setShowHelcimTerminal(false);
    updatePaymentStatus('success');
    if (paymentResult.duplicateOverride) {
      toast.success(
        `Payment processed (manager override charged $${Number(paymentResult.amount).toFixed(2)})`
      );
      logAction({
        action: 'helcim_duplicate_override',
        context: 'PaymentScreen',
        metadata: {
          sale_id: helcimSaleId || draftSaleId || saleData?.id || null,
          original_cents: paymentResult.duplicateOverride.originalCents,
          charged_cents: paymentResult.duplicateOverride.chargedCents,
          transaction_id: paymentResult.transactionId || null
        }
      }).catch(() => {});
    } else {
      toast.success('Payment processed successfully');
    }
    
    // Never block sale completion on device clear — Helcim already captured.
    // Clear can hang on slow/unavailable Helcim device endpoints.
    const deviceCode = paymentResult.deviceCode || localStorage.getItem('helcim_device_code') || 'JSV5';
    Promise.resolve()
      .then(() => helcimPayment.clearDevice(deviceCode))
      .then(() => console.log('[PaymentScreen] Device clear attempted'))
      .catch((clearError) => {
        console.log('[PaymentScreen] Device clear failed (non-critical):', clearError);
      });
    
    // Calculate new remaining balance with updated payments
    const totalPaidAfterPayment = updatedPayments.reduce((sum, p) => sum + Number(p.amount), 0);
    const newRemainingBalance = displayTotal - totalPaidAfterPayment;
    
    // If balance is paid off, automatically complete the sale
    if (newRemainingBalance <= 0.01) {
      console.log('[PaymentScreen] Balance paid in full, automatically completing sale...');
      // Pass the authoritative payment snapshot (includes Helcim transaction id)
      await finalizeSale(updatedPayments);
    }
  };

  // Handle Helcim terminal payment error
  const handleHelcimPaymentError = (errorMessage) => {
    console.error('[PaymentScreen] Helcim payment failed:', errorMessage);
    
    // Remove the failed payment
    setPayments(currentPayments => {
      const next = currentPayments.filter((p, index) =>
        !(index === currentPayments.length - 1 && p.method === 'helcim_terminal')
      );
      paymentsRef.current = next;
      return next;
    });
    
    setShowHelcimTerminal(false);
    setError(errorMessage || 'Helcim payment failed. Please try again.');
    updatePaymentStatus('error', { errorMessage });
    toast.error(errorMessage || 'Payment failed');
  };

  /**
   * Helcim declined the charge as a suspected duplicate. Split the blocked total into
   * two uneven amounts, charge the first half now, and leave the second half as the
   * remaining balance for a follow-up terminal tap.
   */
  const handleHelcimDuplicateSplit = ({ firstCents, secondCents }) => {
    const firstAmount = (Number(firstCents) || 0) / 100;
    const secondAmount = (Number(secondCents) || 0) / 100;
    if (firstAmount <= 0 || secondAmount <= 0) return;

    setPayments((currentPayments) => {
      const next = [...currentPayments];
      const last = next[next.length - 1];
      if (last?.method === 'helcim_terminal') {
        next[next.length - 1] = {
          ...last,
          amount: firstAmount,
          duplicate_split: {
            first_amount: firstAmount,
            second_amount: secondAmount
          }
        };
      }
      paymentsRef.current = next;
      return next;
    });

    setHelcimPaymentAmount(firstAmount);
    setShowHelcimTerminal(false);

    // Remount the terminal reader with the smaller first charge.
    window.setTimeout(() => {
      setShowHelcimTerminal(true);
    }, 50);

    toast(
      `Charging $${firstAmount.toFixed(2)} now. After it clears, tap Helcim Terminal again for the remaining $${secondAmount.toFixed(2)}.`,
      { icon: '💳', duration: 6000 }
    );
  };

  // Handle Helcim terminal cancellation
  const handleHelcimPaymentCancel = (details = {}) => {
    console.log('[PaymentScreen] Helcim payment cancelled', details);
    
    // Remove the cancelled payment
    setPayments(currentPayments => currentPayments.filter((p, index) =>
      !(index === currentPayments.length - 1 && p.method === 'helcim_terminal')
    ));
    
    setShowHelcimTerminal(false);
    setError(null);
    updatePaymentStatus('cancelled');

    const message = details?.message || 'Payment cancelled';
    toast(message);
  };

  // Handle card payment success/error
  const handleCardPaymentResult = (success, errorMessage = null) => {
    if (success) {
      updatePaymentStatus('success');
    } else {
      updatePaymentStatus('error', { errorMessage });
    }
  };

  // Clear payment display when sale is finalized
  const clearPaymentDisplay = () => {
    localStorage.removeItem('tavari_customer_display_payment');
    scheduleCustomerDisplayMirrorPush(auth.selectedBusinessId);
    console.log('💳 PaymentScreen: Payment display cleared');
  };

  // Complete sale finalization with enhanced loyalty processing
  // Accept an optional snapshot to avoid stale-state issues in async callbacks.
  const finalizeSale = async (paymentsSnapshot = null) => {
    // Permission check
    if (!canProcessPayments) {
      toast.error('You do not have permission to process payments');
      return;
    }

    // CRITICAL: Prevent double-clicks and multiple submissions
    if (isProcessing) {
      return;
    }

    const paymentsForBalance = paymentsSnapshot || paymentsRef.current || payments || [];
    const paidForBalance = paymentsForBalance.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const remainingForFinalize = displayTotal - paidForBalance;

    if (remainingForFinalize > 0.01) {
      setError('Payment incomplete. Please add more payments to cover the total.');
      return;
    }

    // Set processing flag IMMEDIATELY to prevent any race conditions
    setIsProcessing(true);
    setLoading(true);
    setError(null);

    try {
      if (!auth.authUser) {
        throw new Error('User not authenticated');
      }

      // Generate receipt number and QR code with built-in retry logic
      const receiptNumber = draftReceiptNumber || await saleProcessor.generateReceiptNumber();
      const qrCode = saleProcessor.generateQRCode(receiptNumber);

      // Prefer the snapshot from auto-finalize (cash/loyalty/etc.) — React state may still be stale.
      const paymentsToSave = paymentsSnapshot || paymentsRef.current || payments || [];
      const paidForReceipt = paymentsToSave.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const changeForReceipt = Math.max(0, paidForReceipt - displayTotal);

      // Calculate total loyalty redeemed from all loyalty payment methods
      const totalLoyaltyRedeemed = paymentsToSave
        .filter(p => p.method === 'loyalty_credit')
        .reduce((sum, p) => sum + p.amount, 0) + autoLoyaltyApplied;

      // Create basic sale record
      const saleRecord = {
        business_id: auth.selectedBusinessId,
        user_id: effectiveOperatorUserId,
        login_user_id: saleAttribution.loginUserId,
        operator_user_id: effectiveOperatorUserId,
        login_user_name: saleAttribution.loginUserName,
        operator_user_name: saleAttribution.operatorUserName,
        customer_id: saleData.loyaltyCustomer?.id || null,
        loyalty_customer_id: saleData.loyaltyCustomer?.id || null,
        customer_name: saleData.loyaltyCustomer?.customer_name || null,
        customer_phone: saleData.loyaltyCustomer?.customer_phone || null,
        
        subtotal: saleSubtotal,
        tax: finalTaxAmount,
        discount: discountAmount,
        loyalty_discount: totalLoyaltyRedeemed,
        total: displayTotal,
        
        payment_status: 'completed',
        payment_method: paymentsToSave[0]?.method || 'cash',
        sale_number: receiptNumber,
        notes: buildPosSaleNotes(totalLoyaltyRedeemed, saleData),
        indian_status_gst_only: !!saleData.indian_status_gst_only,
        indian_status_certificate_number: saleData.indian_status_certificate_number?.trim() || null,
        item_count: saleData.items?.length || 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      let sale;
      if (draftSaleId) {
        // Update the existing draft sale instead of inserting a new one
        const saleUpdateRecord = { ...saleRecord };
        delete saleUpdateRecord.created_at;

        const { data: updatedSale, error: saleError } = await supabase
          .from('pos_sales')
          .update(saleUpdateRecord)
          .eq('id', draftSaleId)
          .select()
          .single();

        if (saleError) throw saleError;
        sale = updatedSale;
      } else {
        const { data: insertedSale, error: saleError } = await supabase
          .from('pos_sales')
          .insert(saleRecord)
          .select()
          .single();

        if (saleError) {
          // Check if it's a duplicate key error
          if (saleError.code === '23505' && saleError.message.includes('idx_pos_sales_business_sale_number')) {
            throw new Error('Duplicate sale detected. This may be a double-click issue. Please refresh and try again.');
          }
          throw saleError;
        }
        sale = insertedSale;
      }

      // Create receipt record
      const receipt = await saleProcessor.createReceiptRecord(
        sale.id, receiptNumber, qrCode, saleData, paymentsToSave, tipAmount,
        changeForReceipt, displayTotal, taxCalculation, finalTaxAmount,
        saleSubtotal, discountAmount, totalLoyaltyRedeemed, saleAttribution
      );

      // Save sale items (custom items have no inventory_id)
      if (saleData.items && saleData.items.length > 0) {
        const saleItems = saleData.items.map(item => {
          const quantity = item.quantity || 1;
          const unitPrice = getPosLineUnitPrice(item);
          const foodCost = getSaleItemFoodCostFields(item);
          return {
            business_id: auth.selectedBusinessId,
            sale_id: sale.id,
            inventory_id: item.is_custom || (typeof item.id === 'string' && item.id.startsWith('custom_')) ? null : item.id,
            category_id: item.category_id || null,
            name: item.name,
            quantity,
            unit_price: unitPrice,
            total_price: getPosLineSubtotal(item),
            unit_cost: foodCost.unit_cost,
            food_cost_total: foodCost.food_cost_total,
            modifiers: item.modifiers || null,
            created_at: new Date().toISOString()
          };
        });

        const { error: itemsError } = await supabase
          .from('pos_sale_items')
          .insert(saleItems);

        if (itemsError) {
          toast.error('Failed to save sale items');
        } else if (saleItems.length > 0) {
          try {
            await applySaleStockAdjustments(
              supabase,
              auth.selectedBusinessId,
              saleData.items.map((item) => ({
                inventoryId:
                  item.is_custom || (typeof item.id === 'string' && item.id.startsWith('custom_'))
                    ? null
                    : item.id,
                quantity: item.quantity || 1,
              }))
            );
          } catch (stockError) {
            console.warn('[PaymentScreen] Inventory stock adjustment failed:', stockError);
          }
        }
      }

      // Save payment records
      if (paymentsToSave.length > 0) {
        console.log('[PaymentScreen] Saving payment records:', {
          saleId: sale.id,
          count: paymentsToSave.length,
          methods: paymentsToSave.map(p => p.method),
        });

        const paymentRecords = paymentsToSave.map(payment => ({
          business_id: auth.selectedBusinessId,
          sale_id: sale.id,
          payment_method: payment.method,
          amount: payment.amount,
          custom_method_name: payment.custom_method_name || null,
          // For Helcim terminal payments, persist the processor transaction id.
          // `pos_payments` does not have dedicated Helcim columns, so we store it in `reference_number`.
          reference_number: payment.reference_number || payment.transaction_id || null,
          // Optionally store extra card/approval metadata for audits/reporting.
          notes: payment.notes || (
            payment.method === 'helcim_terminal'
              ? JSON.stringify({
                  helcim: {
                    transactionId: payment.transaction_id || null,
                    approvalCode: payment.approval_code || null,
                    cardType: payment.card_type || null,
                    lastFour: payment.last_four || null
                  }
                })
              : null
          ),
          processed_by: effectiveOperatorUserId,
          login_user_id: saleAttribution.loginUserId,
          operator_user_id: effectiveOperatorUserId,
          login_user_name: saleAttribution.loginUserName,
          operator_user_name: saleAttribution.operatorUserName,
          created_at: new Date().toISOString()
        }));

        const { error: paymentsError } = await supabase
          .from('pos_payments')
          .insert(paymentRecords);

        if (paymentsError) {
          console.error('[PaymentScreen] Failed to save payment records:', paymentsError);
          toast.error('Failed to save payment records');
        }
      }

      // Issue gift cards sold on this sale (after payment is collected)
      let issuedGiftCards = [];
      try {
        const giftCardLines = (saleData.items || []).filter((item) => item.gift_card || item.is_gift_card);
        for (const item of giftCardLines) {
          const gc = item.gift_card || {};
          const qty = Math.max(1, Number(item.quantity) || 1);
          for (let i = 0; i < qty; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            const card = await GiftCardService.issueGiftCard({
              businessId: auth.selectedBusinessId,
              productId: gc.gift_card_product_id || item.gift_card_product_id || null,
              cardType: gc.card_type || 'money',
              faceValue: gc.face_value ?? item.price,
              amountPaid: gc.amount_paid ?? item.price,
              inventoryItemId: gc.inventory_item_id || null,
              inventoryQty: gc.inventory_qty || 1,
              purchaserCustomerId: gc.purchaser_customer_id || saleData?.loyaltyCustomer?.id || null,
              purchaserName: gc.purchaser_name || saleData?.loyaltyCustomer?.customer_name || null,
              purchaserEmail: gc.purchaser_email || saleData?.loyaltyCustomer?.customer_email || null,
              purchaserPhone: gc.purchaser_phone || saleData?.loyaltyCustomer?.customer_phone || null,
              recipientName: gc.recipient_name || null,
              recipientEmail: gc.recipient_email || null,
              personalMessage: gc.personal_message || null,
              notifyRecipient: Boolean(gc.notify_recipient),
              saleSource: 'pos',
              saleSaleId: sale.id,
              processedByUserId: effectiveOperatorUserId,
            });
            issuedGiftCards.push(card);
          }
        }
        if (issuedGiftCards.length > 0) {
          toast.success(
            issuedGiftCards.length === 1
              ? `Gift card issued: ${issuedGiftCards[0].code}`
              : `${issuedGiftCards.length} gift cards issued`
          );
        }
      } catch (gcIssueErr) {
        console.error('[PaymentScreen] Gift card issue failed:', gcIssueErr);
        toast.error(gcIssueErr.message || 'Sale saved, but gift card issue failed — issue manually from Gift Cards module');
      }

      // DINING MODE: Mark tab items as paid
      if (saleData.dining_mode && saleData.activeTab && saleData.items) {
        try {
          // Calculate payment amount per item (proportional to item price)
          const totalItemValue = saleData.items.reduce((sum, item) => {
            return sum + ((item.price || 0) * (item.quantity || 1));
          }, 0);
          
          const totalPaid = paymentsToSave.reduce((sum, p) => sum + (p.amount || 0), 0);
          
          // Collect all updates first, then apply them
          const itemUpdates = [];
          
          // Prepare all item updates
          for (const item of saleData.items) {
            if (item.tab_item_id) {
              // Direct seat item - mark as fully paid
              const itemValue = (item.price || 0) * (item.quantity || 1);
              const paidAmount = totalItemValue > 0 ? (itemValue / totalItemValue) * totalPaid : itemValue;
              
              // Get current paid_amount and add to it (for partial payments)
              const { data: existingItem, error: fetchError } = await supabase
                .from('pos_tab_items')
                .select('paid_amount')
                .eq('id', item.tab_item_id)
                .single();
              
              if (fetchError) {
                console.error('Error fetching existing tab item:', fetchError);
                continue;
              }
              
              const currentPaid = parseFloat(existingItem?.paid_amount || 0);
              const newPaidAmount = currentPaid + paidAmount;
              
              itemUpdates.push({
                id: item.tab_item_id,
                paidAmount: newPaidAmount
              });
            } else if (item.isTableShare && item.originalTableItems) {
              // Table share item - mark original table items as partially paid
              const tableShareValue = item.price || 0;
              const shareOfTotal = totalItemValue > 0 ? tableShareValue / totalItemValue : 0;
              const paidForTableShare = totalPaid * shareOfTotal;
              
              // Split payment proportionally among original table items
              const totalOriginalValue = item.originalTableItems.reduce((sum, tItem) => {
                return sum + ((tItem.price || 0) * (tItem.quantity || 1));
              }, 0);
              
              for (const tableItem of item.originalTableItems) {
                if (tableItem.tab_item_id) {
                  const tableItemValue = (tableItem.price || 0) * (tableItem.quantity || 1);
                  const tableItemPaidAmount = totalOriginalValue > 0 
                    ? (tableItemValue / totalOriginalValue) * paidForTableShare 
                    : 0;
                  
                  // Get current paid_amount
                  const { data: existingItem, error: fetchError } = await supabase
                    .from('pos_tab_items')
                    .select('paid_amount')
                    .eq('id', tableItem.tab_item_id)
                    .single();
                  
                  if (fetchError) {
                    console.error('Error fetching existing table item:', fetchError);
                    continue;
                  }
                  
                  const currentPaid = parseFloat(existingItem?.paid_amount || 0);
                  const newPaidAmount = currentPaid + tableItemPaidAmount;
                  
                  itemUpdates.push({
                    id: tableItem.tab_item_id,
                    paidAmount: newPaidAmount
                  });
                }
              }
            }
          }
          
          // Apply all item updates in parallel (triggers will fire but may fail - we'll fix status after)
          await Promise.all(itemUpdates.map(async (update) => {
            const { error: updateError } = await supabase
              .from('pos_tab_items')
              .update({
                paid_amount: update.paidAmount.toFixed(2),
                  paid_by: effectiveOperatorUserId
              })
              .eq('id', update.id);
            
            if (updateError) {
              console.error('Error updating tab item paid_amount:', updateError);
            }
          }));
          
          // CRITICAL: After ALL items are updated, manually fix the tab status
          // This overrides any invalid status set by the trigger
          if (saleData.activeTab?.id) {
            // Wait a moment for triggers to complete
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Calculate total paid from all tab items
            const { data: allTabItems, error: itemsError } = await supabase
              .from('pos_tab_items')
              .select('paid_amount')
              .eq('tab_id', saleData.activeTab.id);
            
            if (!itemsError && allTabItems) {
              const totalPaidFromItems = allTabItems.reduce((sum, item) => {
                return sum + parseFloat(item.paid_amount || 0);
              }, 0);
              
              // Get current tab data to calculate status
              const { data: currentTab, error: tabError } = await supabase
                .from('pos_tabs')
                .select('subtotal, tax_amount, total_amount')
                .eq('id', saleData.activeTab.id)
                .single();
              
              if (!tabError && currentTab) {
                const balanceRemaining = parseFloat(currentTab.total_amount || 0) - totalPaidFromItems;
                let newStatus = 'open';
                if (balanceRemaining <= 0.01) {
                  newStatus = 'closed';
                } else if (totalPaidFromItems > 0) {
                  newStatus = 'partial';
                }
                
                // Update tab with correct amount_paid and status (this will override trigger's status)
                const { error: tabUpdateError } = await supabase
                  .from('pos_tabs')
                  .update({
                    amount_paid: totalPaidFromItems.toFixed(2),
                    balance_remaining: balanceRemaining.toFixed(2),
                    status: newStatus
                  })
                  .eq('id', saleData.activeTab.id);
                
                if (tabUpdateError) {
                  console.error('Error updating tab totals:', tabUpdateError);
                }
              }
            }
            
            // Also create a tab payment record (if RLS allows)
            const totalPaidAmount = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
            const { error: paymentError } = await supabase
              .from('pos_tab_payments')
              .insert({
                tab_id: saleData.activeTab.id,
                payment_method: payments[0]?.method || 'cash',
                amount: totalPaidAmount.toFixed(2),
                processed_by: effectiveOperatorUserId,
                processed_at: new Date().toISOString(),
                notes: `Payment for seats: ${saleData.selected_seats?.join(', ') || 'N/A'}`
              });
            
            if (paymentError) {
              console.warn('Could not create tab payment record (RLS may be blocking):', paymentError);
            }
          }
        } catch (diningError) {
          console.error('Error updating dining tab items:', diningError);
          // Don't fail the sale if this errors, but log it
        }
      }

      // ENHANCED LOYALTY PROCESSING — store_credit + points vs legacy balance (dollars program)
      if (saleData.loyaltyCustomer && loyaltySettings?.is_active && canUseLoyalty) {
        const today = saleProcessor.getTodayInBusinessTimezone();
        const acc = saleData.loyaltyCustomer;
        const rate = Number(loyaltySettings.redemption_rate) || 10000;
        const isPoints = isPointsLoyaltyMode(loyaltySettings);
        const store0 = Number(acc.store_credit) || 0;
        const points0 = Math.max(0, Number(acc.points) || 0);
        const bal0 = Math.max(0, Math.abs(Number(acc.balance) || 0));

        let s = store0;
        let p = points0;
        let b = bal0;
        const pointsModeEarn = isPoints && loyaltyPointsToEarn > 0;
        const dollarsModeEarn = !isPoints && loyaltyCreditsToEarn > 0;
        const mustPersist =
          totalLoyaltyRedeemed > 0 || pointsModeEarn || dollarsModeEarn;

        if (totalLoyaltyRedeemed > 0) {
          const split = splitLoyaltyRedemptionDollars(totalLoyaltyRedeemed, acc, loyaltySettings);
          s = split.newStore;
          p = split.newPoints;
          b = split.newBalance;

          await supabase
            .from('pos_loyalty_transactions')
            .insert({
              business_id: auth.selectedBusinessId,
              loyalty_account_id: acc.id,
              transaction_id: sale.id,
              transaction_type: 'redeem',
              amount: totalLoyaltyRedeemed,
              points: isPoints ? split.pointsRedeemed : null,
              balance_before: isPoints ? store0 : bal0,
              balance_after: isPoints ? s : b,
              points_before: points0,
              points_after: p,
              description: `Redeemed for receipt ${receiptNumber}`,
              processed_by: effectiveOperatorUserId,
              earned_date: today
            });

          const maxDay = (loyaltySettings.max_redemption_per_day / rate) * 10;
          const todayUsed = dailyUsageRemaining > 0
            ? maxDay - dailyUsageRemaining + totalLoyaltyRedeemed
            : totalLoyaltyRedeemed;

          await supabase
            .from('pos_loyalty_daily_usage')
            .upsert(
              {
                business_id: auth.selectedBusinessId,
                loyalty_account_id: acc.id,
                usage_date: today,
                amount_used: todayUsed
              },
              {
                onConflict: 'business_id,loyalty_account_id,usage_date',
                ignoreDuplicates: false
              }
            );
        }

        if (pointsModeEarn) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);

          let expiryDate = null;
          if (loyaltySettings.credits_expire && loyaltySettings.expiry_months) {
            expiryDate = new Date();
            expiryDate.setMonth(expiryDate.getMonth() + loyaltySettings.expiry_months);
          }

          const pBefore = p;
          p += loyaltyPointsToEarn;

          await supabase
            .from('pos_loyalty_transactions')
            .insert({
              business_id: auth.selectedBusinessId,
              loyalty_account_id: acc.id,
              transaction_id: sale.id,
              transaction_type: 'earn',
              amount: loyaltyCreditsToEarn,
              points: loyaltyPointsToEarn,
              balance_before: s,
              balance_after: s,
              points_before: pBefore,
              points_after: p,
              description: `Earned from receipt ${receiptNumber}`,
              processed_by: effectiveOperatorUserId,
              earned_date: tomorrow.toISOString().split('T')[0],
              expires_at: expiryDate ? expiryDate.toISOString().split('T')[0] : null
            });
        } else if (dollarsModeEarn) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);

          let expiryDate = null;
          if (loyaltySettings.credits_expire && loyaltySettings.expiry_months) {
            expiryDate = new Date();
            expiryDate.setMonth(expiryDate.getMonth() + loyaltySettings.expiry_months);
          }

          const pBeforeEarn = p;
          const bBefore = b;
          b += loyaltyCreditsToEarn;
          p = Math.round(b * rate);
          const pointsEarnedDelta = Math.max(0, p - pBeforeEarn);

          await supabase
            .from('pos_loyalty_transactions')
            .insert({
              business_id: auth.selectedBusinessId,
              loyalty_account_id: acc.id,
              transaction_id: sale.id,
              transaction_type: 'earn',
              amount: loyaltyCreditsToEarn,
              points: pointsEarnedDelta,
              balance_before: bBefore,
              balance_after: b,
              points_before: pBeforeEarn,
              points_after: p,
              description: `Earned from receipt ${receiptNumber}`,
              processed_by: effectiveOperatorUserId,
              earned_date: tomorrow.toISOString().split('T')[0],
              expires_at: expiryDate ? expiryDate.toISOString().split('T')[0] : null
            });
        }

        if (mustPersist) {
          const te = (Number(acc.total_earned) || 0) + (loyaltyCreditsToEarn || 0);
          const ts = (Number(acc.total_spent) || 0) + (totalLoyaltyRedeemed || 0);
          await supabase
            .from('pos_loyalty_accounts')
            .update({
              store_credit: s,
              points: p,
              balance: b,
              total_earned: te,
              total_spent: ts,
              last_activity: new Date().toISOString()
            })
            .eq('id', acc.id);
        }
      }

      // Save enhanced sale data for receipt screen
      const enhancedSaleData = {
        ...saleData,
        sale_id: sale.id,
        receipt_id: receipt.id,
        receipt_number: receiptNumber,
        qr_code: qrCode,
        payments: paymentsToSave,
        tip_amount: tipAmount,
        change_given: changeForReceipt,
        final_total: displayTotal,
        final_tax_amount: finalTaxAmount,
        final_taxable_amount: taxableAmount,
        tax_calculation: taxCalculation,
        cash_rounding_applied: taxCalc.applyCashRounding(finalTotal, 'cash') !== finalTotal,
        business_name: businessSettings?.name || 'Business',
        cashier_name: saleAttribution.operatorUserName,
        login_user_id: saleAttribution.loginUserId,
        login_user_name: saleAttribution.loginUserName,
        operator_user_id: effectiveOperatorUserId,
        operator_user_name: saleAttribution.operatorUserName,
        loyalty_redeemed: totalLoyaltyRedeemed,
        loyalty_points_earned: loyaltyPointsToEarn,
        issued_gift_cards: issuedGiftCards,
      };
      
      sessionStorage.setItem('lastSaleData', JSON.stringify(enhancedSaleData));

      persistRegisterLockAfterSale(saleData);

      toast.success('Sale completed successfully');

      // Log successful completion
      await logAction({
        action: 'sale_completed',
        context: 'PaymentScreen',
        metadata: {
          business_id: auth.selectedBusinessId,
          sale_id: sale.id,
          receipt_id: receipt.id,
          receipt_number: receiptNumber,
          total_amount: displayTotal,
          payment_methods: paymentsToSave.map(p => p.method),
          customer_attached: !!saleData.loyaltyCustomer,
          loyalty_redeemed: totalLoyaltyRedeemed,
          loyalty_points_earned: loyaltyPointsToEarn,
          login_user_id: saleAttribution.loginUserId,
          operator_user_id: effectiveOperatorUserId,
          user_role: auth.userRole,
          indian_status_gst_only: !!saleData?.indian_status_gst_only
        }
      });

      // Clear cart data from localStorage to reset customer display (keep payment summary ≤5s)
      localStorage.removeItem('tavari_customer_display_cart');
      clearPersistedRegisterCart();
      scheduleCustomerDisplayMirrorPush(auth.selectedBusinessId);
      console.log('🧹 PaymentScreen: Cart data cleared from localStorage');
      
      // Send sale completion signal to customer display
      const saleCompletionData = {
        completed: true,
        saleId: sale.id,
        receiptNumber: receiptNumber,
        timestamp: Date.now()
      };
      localStorage.setItem('tavari_customer_display_sale_complete', JSON.stringify(saleCompletionData));
      scheduleCustomerDisplayMirrorPush(auth.selectedBusinessId);

      // Refresh payment timestamp so customer display 5s window starts at sale completion (multi-tender safe)
      try {
        const payStr = localStorage.getItem('tavari_customer_display_payment');
        if (payStr) {
          const p = JSON.parse(payStr);
          p.timestamp = Date.now();
          p.status = 'success';
          localStorage.setItem('tavari_customer_display_payment', JSON.stringify(p));
          scheduleCustomerDisplayMirrorPush(auth.selectedBusinessId);
        }
      } catch {
        /* ignore */
      }

      // Payment UI on customer display: max 5s from sale completion (receipt can stay open longer)
      scheduleCustomerDisplayPaymentAutoClear(auth.selectedBusinessId);
      console.log('✅ PaymentScreen: Sale completion signal sent to customer display:', saleCompletionData);
      
      // For dining mode, navigate back to dining order screen after showing receipt
      if (saleData.dining_mode && saleData.activeTab) {
        // Store receipt data for viewing, but navigate back to dining order
        sessionStorage.setItem('lastSaleData', JSON.stringify(enhancedSaleData));
        
        // Navigate back to dining order screen with the same tab
        navigate('/dashboard/dining/table-order', {
          state: {
            activeTab: saleData.activeTab,
            tableId: saleData.table_info?.tableId,
            tableName: saleData.table_info?.tableName,
            guestCount: saleData.guest_count,
            showReceipt: true,
            receiptData: enhancedSaleData
          }
        });
      } else {
        // Regular register - go to receipt screen
        navigate('/dashboard/pos/receipt', {
          state: {
            saleData: enhancedSaleData,
            from: location.state?.from || 'payment'
          }
        });
      }

    } catch (err) {
      setError(`Failed to complete sale: ${err.message}`);
      toast.error(`Failed to complete sale: ${err.message}`);
      
      await logAction({
        action: 'sale_completion_error',
        context: 'PaymentScreen',
        metadata: {
          business_id: auth.selectedBusinessId,
          error: err.message,
          error_code: err.code,
          user_role: auth.userRole
        }
      });
    } finally {
      // Always reset flags in finally block
      setLoading(false);
      setIsProcessing(false);
    }
  };

  // Show loading while permissions are being checked
  if (permissionsLoading) {
    return (
      <POSAuthWrapper
        requiredRoles={['employee', 'manager', 'owner']}
        componentName="PaymentScreen"
      >
        <div style={styles.container}>
          <div style={styles.loading}>
            <div style={TavariStyles.components.loading.spinner}></div>
            <div>Loading permissions...</div>
            <style>{TavariStyles.keyframes.spin}</style>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  // Show access denied if no permission
  if (!canProcessPayments) {
    return (
      <POSAuthWrapper
        requiredRoles={['employee', 'manager', 'owner']}
        componentName="PaymentScreen"
      >
        <div style={TavariStyles.utils.merge(styles.container, TavariStyles.layout.flexCenter)}>
          <div style={styles.errorCard}>
            <FiLock size={64} style={{ color: TavariStyles.colors.danger, marginBottom: TavariStyles.spacing.lg }} />
            <h3 style={styles.errorTitle}>Access Denied</h3>
            <p style={styles.errorMessage}>
              You do not have permission to process payments.
            </p>
            <p style={styles.errorMessage}>
              Contact your administrator to request access.
            </p>
            <button 
              style={TavariStyles.utils.merge(
                TavariStyles.components.button.base,
                TavariStyles.components.button.variants.primary
              )}
              onClick={() => navigate('/dashboard/pos/tabs')}
            >
              Back to Tabs
            </button>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  // Error handling for missing sale data
  if (!receivedSaleData) {
    return (
      <POSAuthWrapper
        requiredRoles={['employee', 'manager', 'owner']}
        componentName="PaymentScreen"
      >
        <div style={TavariStyles.utils.merge(styles.container, TavariStyles.layout.flexCenter)}>
          <div style={styles.errorCard}>
            <h3 style={styles.errorTitle}>No Sale Data</h3>
            <p style={styles.errorMessage}>No sale data was provided. Please return to tabs and try again.</p>
            <button 
              style={TavariStyles.utils.merge(
                TavariStyles.components.button.base,
                TavariStyles.components.button.variants.primary
              )}
              onClick={() => navigate('/dashboard/pos/tabs')}
            >
              Back to Tabs
            </button>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  // Loading state while settings load
  if (!saleData || !businessSettings) {
    return (
      <POSAuthWrapper
        requiredRoles={['employee', 'manager', 'owner']}
        componentName="PaymentScreen"
      >
        <div style={styles.container}>
          <div style={styles.loading}>
            <div style={TavariStyles.components.loading.spinner}></div>
            <div>Loading payment screen...</div>
            <style>{TavariStyles.keyframes.spin}</style>
            <br />
            <small>Business ID: {auth.selectedBusinessId || 'Not found'}</small>
            <br />
            <small>Sale Data: {saleData ? 'Loaded' : 'Missing'}</small>
            <br />
            <small>Loyalty Settings: {loyaltySettings ? 'Loaded' : 'Loading...'}</small>
            <br />
            <small>Business Settings: {businessSettings ? 'Loaded' : 'Loading...'}</small>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper
      requiredRoles={['employee', 'manager', 'owner']}
      componentName="PaymentScreen"
    >
      <style>{`
        @media (max-width: 720px) {
          .payment-screen-summary-methods {
            flex-direction: column !important;
            align-items: stretch !important;
          }
          .payment-screen-methods-col {
            flex-basis: auto !important;
            width: 100% !important;
            max-width: none !important;
          }
          .payment-screen-actions {
            flex-direction: column !important;
          }
        }
      `}</style>
      <div style={styles.container}>
        {saleData.loyaltyCustomer && loyaltySettings?.is_active && (
          <div style={styles.loyaltyStrip}>
            <LoyaltyDisplay
              loyaltyCustomer={saleData.loyaltyCustomer}
              loyaltySettings={loyaltySettings}
              availableLoyaltyCredit={availableLoyaltyCredit}
              dailyUsageRemaining={dailyUsageRemaining}
              loyaltyPointsToEarn={loyaltyPointsToEarn}
              loyaltyCreditsToEarn={loyaltyCreditsToEarn}
            />
          </div>
        )}

        <div style={styles.content}>
          <div className="payment-screen-summary-methods" style={styles.summaryAndMethodsRow}>
            <div style={styles.summaryColumn}>
              <PaymentSummary
                fillColumn={false}
                saleSubtotal={saleSubtotal}
                discountAmount={discountAmount}
                loyaltyRedemption={loyaltyRedemption}
                taxableAmount={taxableAmount}
                taxCalculation={taxCalculation}
                finalTaxAmount={finalTaxAmount}
                tipAmount={tipAmount}
                displayTotal={displayTotal}
                totalPaid={totalPaid}
                remainingBalance={remainingBalance}
                saleData={saleData}
                loyaltySettings={loyaltySettings}
                loyaltyPointsToEarn={loyaltyPointsToEarn}
                loyaltyCreditsToEarn={loyaltyCreditsToEarn}
                getBalanceDisplay={getBalanceDisplay}
              />
            </div>

            <div className="payment-screen-methods-col" style={styles.methodsColumn}>
              <div className="payment-screen-methods-card" style={styles.methodsCard}>
                <PaymentMethods
                  variant="stacked"
                  fillColumn={false}
                  currentPayment={currentPayment}
                  setCurrentPayment={setCurrentPayment}
                  loyaltySettings={loyaltySettings}
                  availableLoyaltyCredit={availableLoyaltyCredit}
                  remainingBalance={remainingBalance}
                  exactRemainingBalance={exactRemainingBalance}
                  cashRemainingBalance={cashRemainingBalance}
                  getBalanceDisplay={getBalanceDisplay}
                  showCustomMethod={showCustomMethod}
                  setShowCustomMethod={setShowCustomMethod}
                  customMethodName={customMethodName}
                  setCustomMethodName={setCustomMethodName}
                />
              </div>
            </div>
          </div>

          <DiscountControls
            saleSubtotal={saleSubtotal}
            discountAmount={discountAmount}
            discountName={saleData.discount_name || null}
            selectedDiscountId={saleData.discount_id || null}
            onDiscountChange={handleDiscountChange}
            businessId={auth.selectedBusinessId}
            canApply={canApplyDiscounts}
          />

          <TipControls
            tipAmount={tipAmount}
            onTipChange={setTipAmount}
            saleSubtotal={saleSubtotal}
            businessSettings={businessSettings}
            defaultTipPercent={businessSettings?.default_tip_percent || 0.15}
          />

          {/* Payment Amount Input */}
          <PaymentAmountInput
            currentPayment={currentPayment}
            setCurrentPayment={setCurrentPayment}
            remainingBalance={remainingBalance}
            availableLoyaltyCredit={availableLoyaltyCredit}
            getBalanceDisplay={getBalanceDisplay}
            onAddPayment={(amount, method, customName) => handleAddPayment(Number(amount), method, customName)}
            error={error}
          />

          {error && (
            <div style={TavariStyles.utils.merge(
              TavariStyles.components.banner.base,
              TavariStyles.components.banner.variants.error
            )}>
              {error}
            </div>
          )}
        </div>

        {/* Manager Override Modal */}
        <ManagerOverrideModal
          showManagerOverride={showManagerOverride}
          setShowManagerOverride={setShowManagerOverride}
          overrideReason={overrideReason}
          managerPin={managerPin}
          setManagerPin={setManagerPin}
          onApprove={() => handleAddPayment(
            Number(currentPayment.amount),
            currentPayment.method,
            customMethodName
          )}
          onCancel={() => {
            setShowManagerOverride(false);
            setManagerPin('');
            setOverrideError('');
          }}
          overrideError={overrideError}
        />

        {/* Helcim Terminal Payment Modal */}
        {showHelcimTerminal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}>
            <div style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '500px',
              width: '90%',
              maxHeight: '90vh',
              overflow: 'auto'
            }}>
              <HelcimCardReader
                amount={helcimPaymentAmount * 100} // Convert to cents
                currency="CAD"
                saleId={helcimSaleId || draftSaleId || saleData?.id || saleData?.receipt_number}
                description={`POS Sale ${draftReceiptNumber || saleData?.receipt_number || 'N/A'}`}
                businessId={auth.selectedBusinessId}
                onPaymentSuccess={handleHelcimPaymentSuccess}
                onPaymentError={handleHelcimPaymentError}
                onCancel={handleHelcimPaymentCancel}
                onSplitRequest={handleHelcimDuplicateSplit}
                isVisible={showHelcimTerminal}
              />
            </div>
          </div>
        )}

        <div className="payment-screen-actions" style={styles.actions}>
          <button
            style={TavariStyles.utils.merge(
              TavariStyles.components.button.base,
              TavariStyles.components.button.variants.secondary,
              TavariStyles.components.button.sizes.lg,
              loading || isProcessing ? TavariStyles.utils.disabled({}, {}) : {}
            )}
            onClick={navigateBackFromPayment}
            disabled={loading || isProcessing}
          >
            {location.state?.from === 'register' ? 'Back to Register' : 'Back to Tabs'}
          </button>
          
          <button
            style={TavariStyles.utils.merge(
              TavariStyles.components.button.base,
              remainingBalance > 0.01 || loading || isProcessing ? 
                TavariStyles.components.button.variants.secondary : 
                TavariStyles.components.button.variants.success,
              TavariStyles.components.button.sizes.lg,
              { flex: 2 },
              remainingBalance > 0.01 || loading || isProcessing ? 
                TavariStyles.utils.disabled({}, {}) : {}
            )}
            onClick={finalizeSale}
            disabled={remainingBalance > 0.01 || loading || isProcessing}
          >
            {isProcessing ? '⏳ Processing Sale...' : 
             loading ? '💾 Saving...' : 
             remainingBalance > 0.01 ? `$${remainingBalance.toFixed(2)} Remaining` : 
             '✅ Complete Sale'}
          </button>
        </div>
      </div>
    </POSAuthWrapper>
  );
};

// Custom styles using TavariStyles as base
const styles = {
  container: {
    ...TavariStyles.layout.container,
    gap: TavariStyles.spacing.md
  },

  loyaltyStrip: {
    flexShrink: 0,
    textAlign: 'left'
  },

  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.md
  },

  /** Side-by-side on wide terminals; equal-height columns via alignItems stretch */
  summaryAndMethodsRow: {
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: TavariStyles.spacing.lg
  },

  summaryColumn: {
    flex: '1 1 280px',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    alignSelf: 'stretch'
  },

  methodsColumn: {
    display: 'flex',
    flexDirection: 'column',
    flex: '0 0 auto',
    width: 'min(280px, 100%)',
    maxWidth: '100%',
    minWidth: 'min(200px, 100%)',
    alignSelf: 'stretch'
  },

  methodsCard: {
    ...TavariStyles.layout.card,
    padding: TavariStyles.spacing.lg,
    height: '100%',
    boxSizing: 'border-box'
  },
 
  actions: {
    display: 'flex',
    flexDirection: 'row',
    gap: TavariStyles.spacing.lg,
    justifyContent: 'space-between',
    marginTop: TavariStyles.spacing.md
  },
 
  loading: {
    ...TavariStyles.components.loading.container,
    textAlign: 'center',
    lineHeight: TavariStyles.typography.lineHeight.relaxed
  },
 
  errorCard: {
    ...TavariStyles.layout.card,
    padding: TavariStyles.spacing['3xl'],
    textAlign: 'center',
    maxWidth: '500px',
    border: `2px solid ${TavariStyles.colors.danger}`
  },
 
  errorTitle: {
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.danger,
    marginBottom: TavariStyles.spacing.lg
  },
 
  errorMessage: {
    fontSize: TavariStyles.typography.fontSize.lg,
    color: TavariStyles.colors.gray700,
    marginBottom: TavariStyles.spacing.xl,
    lineHeight: TavariStyles.typography.lineHeight.relaxed
  }
};

export default PaymentScreen;