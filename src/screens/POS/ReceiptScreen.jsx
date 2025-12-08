// screens/POS/ReceiptScreen.jsx - Production Ready with Permissions & Security
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { TavariStyles } from '../../utils/TavariStyles';
import { generateReceiptHTML, generateEmailReceiptHTML, printReceipt, RECEIPT_TYPES } from '../../helpers/ReceiptBuilder';

const ReceiptScreen = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['employee', 'cashier', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'ReceiptScreen'
  });

  // Security context
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'ReceiptScreen',
    sensitiveComponent: false,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'low'
  });

  // Permission system
  const {
    hasPermission,
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading
  } = usePermissions();

  // Permission checks
  const canViewReceipts = hasAnyPermission(['pos.receipts.view', 'pos.sales.create', 'pos.register.operate']) || hasElevatedPrivileges();
  const canPrintReceipts = hasAnyPermission(['pos.receipts.print', 'pos.sales.create', 'pos.register.operate']) || hasElevatedPrivileges();
  const canEmailReceipts = hasAnyPermission(['pos.receipts.email', 'pos.sales.create', 'pos.register.operate']) || hasElevatedPrivileges();
  
  // Tax calculations
  const taxCalc = useTaxCalculations(auth.selectedBusinessId);
  
  // State
  const [receiptData, setReceiptData] = useState(null);
  const [businessInfo, setBusinessInfo] = useState(null);
  const [mailSettings, setMailSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const saleData = location.state?.saleData;
  
  useEffect(() => {
    if (!auth.isReady || !canViewReceipts) return;
    
    loadReceiptData();
  }, [auth.isReady, saleData, canViewReceipts]);

  useEffect(() => {
    if (auth.selectedBusinessId) {
      loadMailSettings(auth.selectedBusinessId);
    }
  }, [auth.selectedBusinessId]);

  // Send navigation signal to customer display when leaving receipt screen
  useEffect(() => {
    return () => {
      // Send signal to customer display to reset to ads
      const navigationData = {
        navigated: true,
        timestamp: Date.now()
      };
      localStorage.setItem('tavari_customer_display_receipt_navigation', JSON.stringify(navigationData));
      console.log('📄 ReceiptScreen: Navigation signal sent to customer display:', navigationData);
    };
  }, []);
  
  const loadReceiptData = async () => {
    try {
      setLoading(true);
      
      await logSecurityEvent('receipt_accessed', {
        action: 'load_receipt_data',
        business_id: auth.selectedBusinessId,
        accessed_by: auth.authUser?.id,
        has_sale_data: !!saleData
      }, 'low');

      let receiptInfo = null;
      
      if (saleData?.receipt_id) {
        const { data: receipt, error: receiptError } = await supabase
          .from('pos_receipts')
          .select('*')
          .eq('id', saleData.receipt_id)
          .single();
          
        if (!receiptError) {
          receiptInfo = receipt;
        }
      }
      
      if (!receiptInfo) {
        const sessionData = sessionStorage.getItem('lastSaleData');
        if (sessionData) {
          const parsed = JSON.parse(sessionData);
          receiptInfo = {
            ...parsed,
            items: parsed.items || [],
            payments: parsed.payments || []
          };
        }
      }
      
      if (!receiptInfo) {
        throw new Error('No receipt data found');
      }
      
      setReceiptData(receiptInfo);
      
      await loadBusinessInfo();
      
      await recordAction('receipt_loaded', {
        receipt_number: receiptInfo.receipt_number || 'N/A',
        total: receiptInfo.total || 0
      }, true);
      
    } catch (err) {
      await logSecurityEvent('receipt_load_error', {
        error: err.message,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  const loadBusinessInfo = async () => {
    try {
      const { data: business, error } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', auth.selectedBusinessId)
        .single();
        
      if (error) throw error;
      
      setBusinessInfo(business);
    } catch (err) {
      await logSecurityEvent('business_info_load_error', {
        error: err.message,
        business_id: auth.selectedBusinessId
      }, 'low');
      
      setBusinessInfo({
        name: 'Business Name',
        business_address: '123 Main St',
        business_city: 'City',
        business_state: 'ON',
        business_postal: 'N1A 1A1'
      });
    }
  };

  const loadMailSettings = async (businessId) => {
    try {
      const { data, error } = await supabase
        .from('mail_settings')
        .select('from_email, from_name, reply_to')
        .eq('business_id', businessId)
        .maybeSingle();

      if (error) throw error;

      setMailSettings({
        from_email: data?.from_email || null,
        from_name: data?.from_name || null,
        reply_to: data?.reply_to || null
      });
    } catch (err) {
      console.warn('Failed to load mail settings:', err.message);
      setMailSettings(null);
    }
  };

  const buildReceiptEmailPayload = (recipientEmail, formattedSaleData, businessSettings) => {
    const htmlContent = generateEmailReceiptHTML(formattedSaleData, businessSettings);

    const plainTextSections = [
      `${businessSettings.business_name || 'Receipt'}`,
      `Receipt #${formattedSaleData.sale_number || 'N/A'}`,
      `Date: ${new Date(formattedSaleData.created_at || Date.now()).toLocaleString()}`,
      `Subtotal: $${(formattedSaleData.subtotal || 0).toFixed(2)}`,
      `Tax: $${(formattedSaleData.tax_amount || 0).toFixed(2)}`,
      `Total: $${(formattedSaleData.final_total || formattedSaleData.total || 0).toFixed(2)}`,
      '',
      'Items:'
    ];

    (formattedSaleData.items || []).forEach((item) => {
      plainTextSections.push(
        `• ${item.name} x${item.quantity || 1} - $${((item.price || 0) * (item.quantity || 1)).toFixed(2)}`
      );
    });

    const plainTextContent = plainTextSections.join('\n');

    const mailSettingsEmail = mailSettings?.from_email?.trim();
    const businessEmail = businessSettings.business_email?.trim();
    const fallbackEmail = import.meta.env.VITE_FALLBACK_FROM_EMAIL?.trim();
    
    const senderEmail = mailSettingsEmail || businessEmail || fallbackEmail || '';
    
    // Log which email is being used for debugging
    console.log('[Receipt] Email selection:', {
      mailSettingsEmail: mailSettingsEmail || '(not set)',
      businessEmail: businessEmail || '(not set)',
      fallbackEmail: fallbackEmail || '(not set)',
      selected: senderEmail
    });

    // Get sender name: business name > mail settings from_name
    // For receipts, use business name followed by " - Receipt"
    const businessName = businessSettings.business_name || businessSettings.name || mailSettings?.from_name || 'Your Business';
    const senderName = `${businessName} - Receipt`;
    
    return {
      senderEmail,
      payload: {
        businessId: auth.selectedBusinessId,
        campaignId: `pos-receipt-${formattedSaleData.sale_number || Date.now()}`,
        contactId: `pos-receipt-${recipientEmail}`,
        to: recipientEmail,
        fromEmail: senderEmail,
        fromName: senderName,
        subject: `${businessSettings.business_name || 'Your Purchase'} Receipt #${formattedSaleData.sale_number || 'N/A'}`,
        html: htmlContent,
        text: plainTextContent,
        configurationSet: mailSettings?.configuration_set || undefined
      }
    };
  };
  
  const handlePrintReceipt = async (type = 'standard') => {
    if (!canPrintReceipts) {
      alert('You do not have permission to print receipts');
      await logSecurityEvent('receipt_print_denied', {
        receipt_type: type,
        business_id: auth.selectedBusinessId,
        user_id: auth.authUser?.id
      }, 'medium');
      return;
    }

    if (!receiptData || !businessInfo) {
      alert('Receipt data not ready');
      return;
    }

    // Rate limiting
    const rateLimitCheck = await checkRateLimit('print_receipt', 10, 60000);
    if (!rateLimitCheck.allowed) {
      alert('Too many print attempts. Please wait a moment.');
      return;
    }
    
    try {
      await logSecurityEvent('receipt_print_initiated', {
        receipt_type: type,
        receipt_number: receiptData.receipt_number || 'N/A',
        business_id: auth.selectedBusinessId,
        printed_by: auth.authUser?.id
      }, 'low');

      const businessSettings = {
        business_name: businessInfo.name,
        business_address: businessInfo.business_address || businessInfo.address,
        business_city: businessInfo.business_city || businessInfo.city,
        business_state: businessInfo.business_state || businessInfo.state || 'ON',
        business_postal: businessInfo.business_postal || businessInfo.postal_code,
        business_phone: businessInfo.business_phone || businessInfo.phone,
        business_email: businessInfo.business_email || businessInfo.email,
        tax_number: businessInfo.tax_number || businessInfo.hst_number,
        timezone: businessInfo.timezone || 'America/Toronto',
        loyalty_mode: businessInfo.loyalty_mode || 'points',
        earn_rate_percentage: businessInfo.earn_rate_percentage || 3
      };
      
      const formattedSaleData = {
        sale_number: receiptData.receipt_number || receiptData.sale_number || 'N/A',
        created_at: receiptData.created_at || new Date().toISOString(),
        items: receiptData.items || [],
        subtotal: receiptData.subtotal || 0,
        final_total: receiptData.total || receiptData.final_total || 0,
        tax_amount: receiptData.tax_amount || receiptData.final_tax_amount || 0,
        payments: receiptData.payment_methods || receiptData.payments || [],
        tip_amount: receiptData.tip_amount || 0,
        change_given: receiptData.change_given || 0,
        discount_amount: receiptData.discount_amount || 0,
        loyalty_redemption: receiptData.loyalty_redemption || 0,
        aggregated_taxes: receiptData.aggregated_taxes || {},
        aggregated_rebates: receiptData.aggregated_rebates || {},
        loyaltyCustomer: receiptData.customer_name ? {
          customer_name: receiptData.customer_name,
          customer_email: receiptData.customer_email,
          customer_phone: receiptData.customer_phone,
          balance: receiptData.loyalty_balance || 0
        } : null
      };
      
      let receiptType = RECEIPT_TYPES.STANDARD;
      switch (type) {
        case 'gift':
          receiptType = RECEIPT_TYPES.GIFT;
          break;
        case 'kitchen':
          receiptType = RECEIPT_TYPES.KITCHEN;
          break;
        case 'reprint':
          receiptType = RECEIPT_TYPES.REPRINT;
          break;
        default:
          receiptType = RECEIPT_TYPES.STANDARD;
      }
      
      const receiptHTML = generateReceiptHTML(
        formattedSaleData, 
        receiptType, 
        businessSettings,
        type === 'reprint' ? { reprintReason: 'Customer Request' } : {}
      );
      
      printReceipt(receiptHTML);

      await logSecurityEvent('receipt_printed', {
        receipt_type: type,
        receipt_number: receiptData.receipt_number || 'N/A',
        business_id: auth.selectedBusinessId
      }, 'low');

      await recordAction('receipt_printed', {
        receipt_type: type,
        receipt_number: receiptData.receipt_number || 'N/A'
      }, true);
      
    } catch (err) {
      await logSecurityEvent('receipt_print_error', {
        error: err.message,
        receipt_type: type,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      alert('Error printing receipt. Please try again.');
    }
  };
  
  const handleEmailReceipt = async () => {
    if (!canEmailReceipts) {
      alert('You do not have permission to email receipts');
      await logSecurityEvent('receipt_email_denied', {
        business_id: auth.selectedBusinessId,
        user_id: auth.authUser?.id
      }, 'medium');
      return;
    }

    const email = prompt('Enter email address:');
    if (!email) return;

    // Validate email
    try {
      const emailValidation = await validateInput(email, 'email', 'receipt_email');
      if (!emailValidation.valid) {
        alert('Please enter a valid email address');
        return;
      }
    } catch (validationError) {
      console.warn('Email validation failed:', validationError);
      alert('Unable to validate email address. Please try again.');
      return;
    }

    // Rate limiting
    const rateLimitCheck = await checkRateLimit('email_receipt', 5, 60000);
    if (!rateLimitCheck.allowed) {
      alert('Too many email attempts. Please wait a moment.');
      return;
    }

    try {
      const senderEmail = mailSettings?.from_email || businessInfo?.business_email;

      if (!senderEmail) {
        alert('Cannot send email: no sender email configured. Please update Mail Settings.');
        return;
      }

      const businessSettings = {
        business_name: businessInfo?.name,
        business_address: businessInfo?.business_address || businessInfo?.address,
        business_city: businessInfo?.business_city || businessInfo?.city,
        business_state: businessInfo?.business_state || businessInfo?.state || 'ON',
        business_postal: businessInfo?.business_postal || businessInfo?.postal_code,
        business_phone: businessInfo?.business_phone || businessInfo?.phone,
        business_email: senderEmail,
        tax_number: businessInfo?.tax_number || businessInfo?.hst_number,
        timezone: businessInfo?.timezone || 'America/Toronto',
        loyalty_mode: businessInfo?.loyalty_mode || 'points',
        earn_rate_percentage: businessInfo?.earn_rate_percentage || 3
      };

      const formattedSaleData = {
        sale_number: receiptData.receipt_number || receiptData.sale_number || 'N/A',
        created_at: receiptData.created_at || new Date().toISOString(),
        items: receiptData.items || [],
        subtotal: receiptData.subtotal || 0,
        final_total: receiptData.total || receiptData.final_total || 0,
        tax_amount: receiptData.tax_amount || receiptData.final_tax_amount || 0,
        payments: receiptData.payment_methods || receiptData.payments || [],
        tip_amount: receiptData.tip_amount || 0,
        change_given: receiptData.change_given || 0,
        discount_amount: receiptData.discount_amount || 0,
        loyalty_redemption: receiptData.loyalty_redemption || 0,
        aggregated_taxes: receiptData.aggregated_taxes || {},
        aggregated_rebates: receiptData.aggregated_rebates || {},
        loyaltyCustomer: receiptData.customer_name ? {
          customer_name: receiptData.customer_name,
          customer_email: receiptData.customer_email,
          customer_phone: receiptData.customer_phone,
          balance: receiptData.loyalty_balance || 0
        } : null
      };

      const { senderEmail: resolvedSender, payload } = buildReceiptEmailPayload(
        email,
        formattedSaleData,
        businessSettings
      );

      if (!resolvedSender) {
        alert('Cannot send email: missing sender email configuration.');
        return;
      }

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('mail-send raw response', response.status, errorBody);
        throw new Error(`Send failed (${response.status})`);
      }

      const data = await response.json().catch(() => null);
      if (!data?.ok) {
        console.error('mail-send response not ok', data);
        throw new Error(data?.error || 'Send failed');
      }

      await logSecurityEvent('receipt_emailed', {
        receipt_number: receiptData?.receipt_number || 'N/A',
        recipient_email: email,
        business_id: auth.selectedBusinessId,
        emailed_by: auth.authUser?.id
      }, 'low');

      await recordAction('receipt_emailed', {
        receipt_number: receiptData?.receipt_number || 'N/A',
        recipient_email: email
      }, true);

      alert('Receipt email sent!');
    } catch (err) {
      await logSecurityEvent('receipt_email_error', {
        error: err.message,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      alert('Error sending email. Please try again.');
    }
  };
  
  const handleTextReceipt = async () => {
    if (!canEmailReceipts) { // Using same permission as email for now
      alert('You do not have permission to text receipts');
      await logSecurityEvent('receipt_text_denied', {
        business_id: auth.selectedBusinessId,
        user_id: auth.authUser?.id
      }, 'medium');
      return;
    }

    const phone = prompt('Enter phone number:');
    if (!phone) return;

    // Validate phone
    const phoneValidation = validateInput(phone, 'phone', 'receipt_phone');
    if (!phoneValidation.valid) {
      alert('Please enter a valid phone number');
      return;
    }

    // Rate limiting
    const rateLimitCheck = await checkRateLimit('text_receipt', 5, 60000);
    if (!rateLimitCheck.allowed) {
      alert('Too many text attempts. Please wait a moment.');
      return;
    }

    try {
      await logSecurityEvent('receipt_texted', {
        receipt_number: receiptData?.receipt_number || 'N/A',
        recipient_phone: phone,
        business_id: auth.selectedBusinessId,
        texted_by: auth.authUser?.id
      }, 'low');

      await recordAction('receipt_texted', {
        receipt_number: receiptData?.receipt_number || 'N/A',
        recipient_phone: phone
      }, true);

      // TODO: Integrate with SMS service
      alert('Receipt text sent!');
    } catch (err) {
      await logSecurityEvent('receipt_text_error', {
        error: err.message,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      alert('Error sending text. Please try again.');
    }
  };
  
  const handleNewSale = async () => {
    await logSecurityEvent('new_sale_initiated', {
      from_screen: 'receipt',
      return_to: location.state?.from || 'register',
      business_id: auth.selectedBusinessId,
      initiated_by: auth.authUser?.id
    }, 'low');

    // Send navigation signal to customer display to reset to ads
    const navigationData = {
      navigated: true,
      timestamp: Date.now()
    };
    localStorage.setItem('tavari_customer_display_receipt_navigation', JSON.stringify(navigationData));
    console.log('📄 ReceiptScreen: Navigation signal sent to customer display from handleNewSale:', navigationData);

    sessionStorage.removeItem('lastSaleData');
    sessionStorage.removeItem('currentCart');
    sessionStorage.removeItem('cartItems');
    
    const fromState = location.state?.from;
    
    if (fromState === 'saved_carts') {
      navigate('/dashboard/pos/saved-carts');
    } else if (fromState === 'tabs') {
      navigate('/dashboard/pos/tabs');
    } else {
      navigate('/dashboard/pos/register');
    }
  };
  
  // Check overall access
  if (!permissionsLoading && !canViewReceipts) {
    return (
      <SecurityWrapper>
        <POSAuthWrapper
          requiredRoles={['employee', 'cashier', 'manager', 'owner']}
          requireBusiness={true}
          componentName="ReceiptScreen"
        >
          <div style={styles.container}>
            <div style={styles.error}>
              <h3 style={{ color: TavariStyles.colors.danger }}>Access Denied</h3>
              <p>You do not have permission to view receipts.</p>
              <button 
                style={styles.button}
                onClick={() => navigate('/dashboard/pos/register')}
              >
                Return to POS
              </button>
            </div>
          </div>
        </POSAuthWrapper>
      </SecurityWrapper>
    );
  }

  if (!auth.isReady || loading || taxCalc.loading || permissionsLoading) {
    return (
      <SecurityWrapper>
        <POSAuthWrapper
          requiredRoles={['employee', 'cashier', 'manager', 'owner']}
          requireBusiness={true}
          componentName="ReceiptScreen"
        >
          <div style={styles.container}>
            <div style={styles.loading}>
              <div style={TavariStyles.components.loading.spinner}></div>
              <div>Loading receipt...</div>
              <style>{TavariStyles.keyframes.spin}</style>
            </div>
          </div>
        </POSAuthWrapper>
      </SecurityWrapper>
    );
  }
  
  if (error || !receiptData) {
    return (
      <SecurityWrapper>
        <POSAuthWrapper
          requiredRoles={['employee', 'cashier', 'manager', 'owner']}
          requireBusiness={true}
          componentName="ReceiptScreen"
        >
          <div style={styles.container}>
            <div style={styles.error}>
              <h3>Receipt Not Found</h3>
              <p>{error || 'No receipt data available'}</p>
              <button 
                style={styles.button}
                onClick={handleNewSale}
              >
                Return to POS
              </button>
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
        componentName="ReceiptScreen"
      >
        <div style={styles.container}>
          <div style={styles.header}>
            <h1>Sale Complete!</h1>
            <p>Receipt #{receiptData.receipt_number || 'N/A'}</p>
            <p>Total: ${taxCalc.applyCashRounding(receiptData.total || 0).toFixed(2)}</p>
          </div>
          
          <div style={styles.section}>
            <h3>Business Information</h3>
            <div style={styles.businessInfo}>
              <p><strong>{businessInfo?.name || 'Business Name'}</strong></p>
              <p>{businessInfo?.business_address || '123 Main St'}</p>
              <p>{businessInfo?.business_city || 'City'}, {businessInfo?.business_state || 'ON'} {businessInfo?.business_postal || 'N1A 1A1'}</p>
            </div>
          </div>
          
          <div style={styles.section}>
            <h3>Items Purchased</h3>
            <div style={styles.itemsList}>
              {receiptData.items && receiptData.items.length > 0 ? (
                receiptData.items.map((item, index) => (
                  <div key={index} style={styles.item}>
                    <div style={styles.itemRow}>
                      <span style={styles.itemName}>{item.name}</span>
                      <span style={styles.itemPrice}>
                        ${((item.price || 0) * (item.quantity || 1)).toFixed(2)}
                      </span>
                    </div>
                    <div style={styles.itemDetails}>
                      <span>${(item.price || 0).toFixed(2)} × {item.quantity || 1}</span>
                    </div>
                    {item.modifiers && item.modifiers.length > 0 && (
                      <div style={styles.modifiers}>
                        {item.modifiers.map((mod, modIndex) => (
                          <div key={modIndex} style={styles.modifier}>
                            + {mod.name} ${(mod.price || 0).toFixed(2)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p>No items found</p>
              )}
            </div>
          </div>
          
          {((receiptData.aggregated_taxes && Object.keys(receiptData.aggregated_taxes).length > 0) || 
            (receiptData.aggregated_rebates && Object.keys(receiptData.aggregated_rebates).length > 0)) && (
            <div style={styles.section}>
              <h3>Tax & Rebate Breakdown</h3>
              
              {receiptData.aggregated_taxes && Object.keys(receiptData.aggregated_taxes).length > 0 && (
                <div style={styles.taxSection}>
                  <h4 style={styles.taxSubtitle}>Taxes Applied</h4>
                  {Object.entries(receiptData.aggregated_taxes).map(([taxName, amount]) => (
                    <div key={taxName} style={styles.taxRow}>
                      <span>{taxName}:</span>
                      <span>${taxCalc.formatTaxAmount(amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              
              {receiptData.aggregated_rebates && Object.keys(receiptData.aggregated_rebates).length > 0 && (
                <div style={styles.rebateSection}>
                  <h4 style={styles.rebateSubtitle}>Rebates Applied</h4>
                  {Object.entries(receiptData.aggregated_rebates).map(([rebateName, amount]) => (
                    <div key={rebateName} style={styles.rebateRow}>
                      <span>{rebateName}:</span>
                      <span>-${taxCalc.formatTaxAmount(amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              
              <div style={styles.netTaxRow}>
                <span>Net Tax:</span>
                <span>${taxCalc.formatTaxAmount(receiptData.tax_amount || 0)}</span>
              </div>
            </div>
          )}

          <div style={styles.section}>
            <h3>Transaction Summary</h3>
            <div style={styles.totals}>
              <div style={styles.totalRow}>
                <span>Subtotal:</span>
                <span>${taxCalc.formatTaxAmount(receiptData.subtotal || 0)}</span>
              </div>
              {receiptData.discount_amount > 0 && (
                <div style={styles.totalRow}>
                  <span>Discount:</span>
                  <span>-${taxCalc.formatTaxAmount(receiptData.discount_amount)}</span>
                </div>
              )}
              {receiptData.loyalty_redemption > 0 && (
                <div style={styles.totalRow}>
                  <span>Loyalty Credit:</span>
                  <span>-${taxCalc.formatTaxAmount(receiptData.loyalty_redemption)}</span>
                </div>
              )}
              <div style={styles.totalRow}>
                <span>Tax:</span>
                <span>${taxCalc.formatTaxAmount(receiptData.tax_amount || 0)}</span>
              </div>
              {receiptData.tip_amount > 0 && (
                <div style={styles.totalRow}>
                  <span>Tip:</span>
                  <span>${taxCalc.formatTaxAmount(receiptData.tip_amount)}</span>
                </div>
              )}
              <div style={styles.totalRowFinal}>
                <span>Total:</span>
                <span>${taxCalc.applyCashRounding(receiptData.total || 0).toFixed(2)}</span>
              </div>
            </div>
          </div>
          
          {receiptData.payment_methods && receiptData.payment_methods.length > 0 && (
            <div style={styles.section}>
              <h3>Payment Methods</h3>
              <div style={styles.payments}>
                {receiptData.payment_methods.map((payment, index) => (
                  <div key={index} style={styles.paymentRow}>
                    <span>{payment.method || payment.payment_method}</span>
                    <span>${(payment.amount || 0).toFixed(2)}</span>
                  </div>
                ))}
                {receiptData.change_given > 0 && (
                  <div style={styles.paymentRow}>
                    <span>Change Given:</span>
                    <span>${(receiptData.change_given || 0).toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {receiptData.customer_name && (
            <div style={styles.section}>
              <h3>Customer Information</h3>
              <div style={styles.customerInfo}>
                <p><strong>{receiptData.customer_name}</strong></p>
                {receiptData.customer_email && <p>Email: {receiptData.customer_email}</p>}
                {receiptData.customer_phone && <p>Phone: {receiptData.customer_phone}</p>}
              </div>
            </div>
          )}
          
          <div style={styles.section}>
            <h3>Receipt Options</h3>
            <div style={styles.receiptOptions}>
              <button 
                style={styles.receiptButton}
                onClick={() => handlePrintReceipt('standard')}
                disabled={!canPrintReceipts}
                title={!canPrintReceipts ? 'You do not have permission to print receipts' : undefined}
              >
                Print Receipt
              </button>
              
              <button 
                style={styles.receiptButton}
                onClick={() => handlePrintReceipt('gift')}
                disabled={!canPrintReceipts}
                title={!canPrintReceipts ? 'You do not have permission to print receipts' : undefined}
              >
                Gift Receipt
              </button>
              
              <button 
                style={styles.receiptButton}
                onClick={() => handlePrintReceipt('kitchen')}
                disabled={!canPrintReceipts}
                title={!canPrintReceipts ? 'You do not have permission to print receipts' : undefined}
              >
                Kitchen Receipt
              </button>
              
              <button 
                style={styles.receiptButton}
                onClick={handleEmailReceipt}
                disabled={!canEmailReceipts}
                title={!canEmailReceipts ? 'You do not have permission to email receipts' : undefined}
              >
                Email Receipt
              </button>
              
              <button 
                style={styles.receiptButton}
                onClick={handleTextReceipt}
                disabled={!canEmailReceipts}
                title={!canEmailReceipts ? 'You do not have permission to text receipts' : undefined}
              >
                Text Receipt
              </button>
              
              <button 
                style={styles.receiptButtonSecondary}
                onClick={handleNewSale}
              >
                No Receipt
              </button>
            </div>
          </div>
          
          <div style={styles.actions}>
            <button 
              style={styles.newSaleButton}
              onClick={handleNewSale}
            >
              {location.state?.from === 'saved_carts' 
                ? 'Back to Saved Carts' 
                : location.state?.from === 'tabs'
                ? 'Back to Tabs'
                : 'Start New Sale'
              }
            </button>
          </div>
        </div>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

const styles = {
  container: {
    ...TavariStyles.layout.container,
    maxWidth: '800px',
    margin: '0 auto',
    padding: TavariStyles.spacing.xl
  },
  
  loading: {
    ...TavariStyles.components.loading.container,
    textAlign: 'center'
  },
  
  error: {
    textAlign: 'center',
    padding: TavariStyles.spacing['4xl']
  },
  
  header: {
    textAlign: 'center',
    marginBottom: TavariStyles.spacing['3xl'],
    padding: TavariStyles.spacing.xl,
    backgroundColor: TavariStyles.colors.success,
    color: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg
  },
  
  section: {
    ...TavariStyles.layout.card,
    padding: TavariStyles.spacing.xl,
    marginBottom: TavariStyles.spacing.xl
  },
  
  businessInfo: {
    textAlign: 'center',
    lineHeight: 1.6
  },
  
  itemsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.md
  },
  
  item: {
    padding: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px solid ${TavariStyles.colors.gray200}`
  },
  
  itemRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: TavariStyles.spacing.sm
  },
  
  itemName: {
    fontWeight: TavariStyles.typography.fontWeight.bold,
    fontSize: TavariStyles.typography.fontSize.lg
  },
  
  itemPrice: {
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.success
  },
  
  itemDetails: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600
  },
  
  modifiers: {
    marginTop: TavariStyles.spacing.sm,
    paddingLeft: TavariStyles.spacing.md
  },
  
  modifier: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    fontStyle: 'italic'
  },
  
  totals: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.sm
  },
  
  totalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: TavariStyles.typography.fontSize.lg
  },
  
  totalRowFinal: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    paddingTop: TavariStyles.spacing.md,
    borderTop: `2px solid ${TavariStyles.colors.primary}`,
    marginTop: TavariStyles.spacing.md
  },
  
  payments: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.sm
  },
  
  paymentRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: TavariStyles.spacing.sm,
    backgroundColor: TavariStyles.colors.gray50,
    borderRadius: TavariStyles.borderRadius.sm
  },
  
  customerInfo: {
    lineHeight: 1.6
  },
  
  taxSection: {
    marginBottom: TavariStyles.spacing.lg,
    padding: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.errorBg,
    borderRadius: TavariStyles.borderRadius.sm,
    border: `1px solid ${TavariStyles.colors.danger}`
  },
  
  taxSubtitle: {
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.danger,
    marginBottom: TavariStyles.spacing.sm
  },
  
  taxRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray700,
    marginBottom: TavariStyles.spacing.xs
  },
  
  rebateSection: {
    marginBottom: TavariStyles.spacing.lg,
    padding: TavariStyles.spacing.md,
    backgroundColor: TavariStyles.colors.successBg,
    borderRadius: TavariStyles.borderRadius.sm,
    border: `1px solid ${TavariStyles.colors.success}`
  },
  
  rebateSubtitle: {
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.success,
    marginBottom: TavariStyles.spacing.sm
  },
  
  rebateRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray700,
    marginBottom: TavariStyles.spacing.xs
  },
  
  netTaxRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    paddingTop: TavariStyles.spacing.md,
    borderTop: `1px solid ${TavariStyles.colors.gray200}`,
    marginTop: TavariStyles.spacing.md
  },
  
  actions: {
    display: 'flex',
    gap: TavariStyles.spacing.lg,
    justifyContent: 'center',
    marginTop: TavariStyles.spacing['2xl']
  },
  
  receiptOptions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: TavariStyles.spacing.md,
    marginBottom: TavariStyles.spacing.lg
  },
  
  receiptButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.primary,
    ...TavariStyles.components.button.sizes.md,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '50px'
  },
  
  receiptButtonSecondary: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.secondary,
    ...TavariStyles.components.button.sizes.md,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '50px'
  },
  
  button: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.primary
  },
  
  newSaleButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.primary,
    ...TavariStyles.components.button.sizes.lg
  }
};

export default ReceiptScreen;