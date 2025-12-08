// screens/POS/RefundsScreen.jsx - WITH PERMISSION SYSTEM + NO CONSOLE LOGGING
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';

// Security & Authentication
import { SecurityWrapper, useSecurityContext } from '../../Security';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';

// Foundation Components
import { TavariStyles } from '../../utils/TavariStyles';

// Refund Components
import RefundSearchControls from '../../components/POS/POSRefundComponents/RefundSearchControls';
import RefundTransactionCard from '../../components/POS/POSRefundComponents/RefundTransactionCard';
import RefundModal from '../../components/POS/POSRefundComponents/RefundModal';
import ManualRefundModal from '../../components/POS/POSRefundComponents/ManualRefundModal';

// Use existing BarcodeScanHandler for QR scanning
import BarcodeScanHandler from '../../components/POS/BarcodeScanHandler';

const RefundsScreen = () => {
  const navigate = useNavigate();
  
  // Security context for sensitive refund operations
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'RefundsScreen',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Authentication using standardized hook
  const auth = usePOSAuth({
    requiredRoles: ['cashier', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'RefundsScreen'
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
  const canProcessRefunds = hasPermission('pos.sales.refund') || hasElevatedPrivileges();
  const canViewAllSales = hasPermission('pos.sales.view_all') || hasElevatedPrivileges();
  const canVoidSales = hasPermission('pos.sales.void') || isOwner();
  const canManualRefund = hasAnyPermission(['pos.sales.refund', 'pos.discounts.manager_override']) || hasElevatedPrivileges();

  // State management
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState('today');
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [showManualRefundModal, setShowManualRefundModal] = useState(false);
  const [businessSettings, setBusinessSettings] = useState({});

  // QR Scanner state
  const [qrScanResult, setQrScanResult] = useState(null);
  const [isQrScannerActive, setIsQrScannerActive] = useState(false);

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canProcessRefunds) {
      toast.error('You do not have permission to process refunds');
      navigate('/dashboard/pos');
    }
  }, [permissionsLoading, canProcessRefunds, navigate]);

  useEffect(() => {
    if (auth.selectedBusinessId && !permissionsLoading && canProcessRefunds) {
      loadTransactions();
      loadBusinessSettings();
    }
  }, [auth.selectedBusinessId, dateRange, permissionsLoading, canProcessRefunds]);

  useEffect(() => {
    if (auth.selectedBusinessId && !permissionsLoading && canProcessRefunds) {
      if (searchTerm) {
        searchTransactions();
      } else {
        loadTransactions();
      }
    }
  }, [searchTerm, auth.selectedBusinessId, permissionsLoading, canProcessRefunds]);

  const loadBusinessSettings = async () => {
    try {
      await logSecurityEvent('business_settings_access', {
        action: 'load_refund_settings',
        business_id: auth.selectedBusinessId
      }, 'low');

      // Load POS settings
      const { data: posSettings, error: posError } = await supabase
        .from('pos_settings')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .single();

      if (posError && posError.code !== 'PGRST116') throw posError;

      // Load business info
      const { data: business, error: businessError } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', auth.selectedBusinessId)
        .single();

      if (businessError) throw businessError;

      // Combine settings
      const combinedSettings = {
        ...posSettings,
        business_name: business.name,
        business_address: business.business_address || business.address || '123 Main St',
        business_city: business.business_city || business.city || 'Your City',
        business_state: business.business_state || business.state || 'ON',
        business_postal: business.business_postal || business.postal_code || 'N1A 1A1',
        business_phone: business.business_phone || business.phone,
        business_email: business.business_email || business.email,
        tax_number: business.tax_number || business.hst_number,
        timezone: business.timezone || 'America/Toronto'
      };

      setBusinessSettings(combinedSettings);
    } catch (err) {
      await logSecurityEvent('business_settings_error', {
        action: 'load_refund_settings_failed',
        business_id: auth.selectedBusinessId,
        error_message: err.message
      }, 'medium');

      // Set minimal defaults
      setBusinessSettings({
        business_name: 'Your Business Name',
        business_address: '123 Main St',
        business_city: 'Your City',
        business_state: 'ON',
        business_postal: 'N1A 1A1'
      });
    }
  };

  const getDateFilter = () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    switch (dateRange) {
      case 'today':
        return today.toISOString();
      case 'week':
        const weekAgo = new Date(today);
        weekAgo.setDate(today.getDate() - 7);
        return weekAgo.toISOString();
      case 'month':
        const monthAgo = new Date(today);
        monthAgo.setMonth(today.getMonth() - 1);
        return monthAgo.toISOString();
      case 'all':
        return '2020-01-01T00:00:00.000Z';
      default:
        return today.toISOString();
    }
  };

  const loadTransactions = async () => {
    try {
      setLoading(true);
      setError(null);

      // Rate limit check
      const rateLimitCheck = await checkRateLimit('load_refund_transactions');
      if (!rateLimitCheck.allowed) {
        setError('Too many requests. Please wait a moment.');
        setLoading(false);
        return;
      }

      await logSecurityEvent('refund_transactions_access', {
        action: 'load_transactions',
        business_id: auth.selectedBusinessId,
        date_range: dateRange
      }, 'low');

      const dateFilter = getDateFilter();
      
      // Query with only existing columns
      const { data: sales, error: salesError } = await supabase
        .from('pos_sales')
        .select(`
          id,
          sale_number,
          subtotal,
          tax,
          discount,
          loyalty_discount,
          total,
          payment_status,
          customer_name,
          created_at,
          user_id,
          qr_code,
          pos_sale_items (
            id,
            inventory_id,
            name,
            sku,
            quantity,
            unit_price,
            total_price,
            modifiers,
            notes
          )
        `)
        .eq('business_id', auth.selectedBusinessId)
        .eq('payment_status', 'completed')
        .gte('created_at', dateFilter)
        .order('created_at', { ascending: false })
        .limit(100);

      if (salesError) throw salesError;

      await recordAction('refund_transactions_loaded', auth.selectedBusinessId, true);

      // Get existing refunds for these sales
      if (sales && sales.length > 0) {
        const saleIds = sales.map(sale => sale.id);
        const { data: refunds, error: refundsError } = await supabase
          .from('pos_refunds')
          .select('original_sale_id, total_refund_amount')
          .in('original_sale_id', saleIds);

        if (refundsError) {
          await logSecurityEvent('refund_load_warning', {
            action: 'load_refunds_failed',
            business_id: auth.selectedBusinessId,
            error_message: refundsError.message
          }, 'low');
        }

        // Calculate refunded amounts per sale
        const refundAmounts = {};
        (refunds || []).forEach(refund => {
          refundAmounts[refund.original_sale_id] = 
            (refundAmounts[refund.original_sale_id] || 0) + (refund.total_refund_amount || 0);
        });

        // Add refund info to transactions
        const transactionsWithRefunds = sales.map(sale => ({
          ...sale,
          total_refunded: refundAmounts[sale.id] || 0,
          remaining_refundable: (sale.total || 0) - (refundAmounts[sale.id] || 0)
        }));

        setTransactions(transactionsWithRefunds);
      } else {
        setTransactions([]);
      }
    } catch (err) {
      await logSecurityEvent('refund_transactions_error', {
        action: 'load_transactions_failed',
        business_id: auth.selectedBusinessId,
        error_message: err.message
      }, 'medium');
      
      setError('Failed to load transactions: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const searchTransactions = async () => {
    if (!searchTerm.trim()) {
      loadTransactions();
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Validate search input
      const validation = await validateInput(searchTerm, 'text', 'search_term');
      if (!validation.valid) {
        setError(validation.error);
        setLoading(false);
        return;
      }

      // Rate limit check
      const rateLimitCheck = await checkRateLimit('search_refund_transactions');
      if (!rateLimitCheck.allowed) {
        setError('Too many search requests. Please wait a moment.');
        setLoading(false);
        return;
      }

      await logSecurityEvent('refund_search', {
        action: 'search_transactions',
        business_id: auth.selectedBusinessId,
        search_term_length: searchTerm.length
      }, 'low');

      const { data: sales, error } = await supabase
        .from('pos_sales')
        .select(`
          id,
          sale_number,
          subtotal,
          tax,
          discount,
          loyalty_discount,
          total,
          payment_status,
          customer_name,
          created_at,
          user_id,
          qr_code,
          pos_sale_items (
            id,
            inventory_id,
            name,
            sku,
            quantity,
            unit_price,
            total_price,
            modifiers,
            notes
          )
        `)
        .eq('business_id', auth.selectedBusinessId)
        .eq('payment_status', 'completed')
        .or(`sale_number.ilike.%${searchTerm}%,customer_name.ilike.%${searchTerm}%`)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      await recordAction('refund_search_completed', auth.selectedBusinessId, true);

      // Get refund info for search results
      if (sales && sales.length > 0) {
        const saleIds = sales.map(sale => sale.id);
        const { data: refunds } = await supabase
          .from('pos_refunds')
          .select('original_sale_id, total_refund_amount')
          .in('original_sale_id', saleIds);

        const refundAmounts = {};
        (refunds || []).forEach(refund => {
          refundAmounts[refund.original_sale_id] = 
            (refundAmounts[refund.original_sale_id] || 0) + (refund.total_refund_amount || 0);
        });

        const transactionsWithRefunds = sales.map(sale => ({
          ...sale,
          total_refunded: refundAmounts[sale.id] || 0,
          remaining_refundable: (sale.total || 0) - (refundAmounts[sale.id] || 0)
        }));

        setTransactions(transactionsWithRefunds);
      } else {
        setTransactions([]);
      }
    } catch (err) {
      await logSecurityEvent('refund_search_error', {
        action: 'search_transactions_failed',
        business_id: auth.selectedBusinessId,
        error_message: err.message
      }, 'medium');
      
      setError('Failed to search transactions: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // QR Code scan handler
  const handleQRTransactionFound = async (transaction) => {
    setQrScanResult(transaction);
    setSelectedTransaction(transaction);
    setIsQrScannerActive(false);
    
    toast.success(`Found transaction: Sale #${transaction.sale_number}`);
    
    await logSecurityEvent('qr_transaction_found', {
      action: 'qr_scan_success',
      business_id: auth.selectedBusinessId,
      transaction_id: transaction.id,
      sale_number: transaction.sale_number,
      scan_method: 'qr_code'
    }, 'low');

    await recordAction('qr_scan_transaction_found', transaction.id, true);
  };

  // QR/Barcode scan handler - simplified for actual database structure  
  const handleBarcodeScan = async (scannedCode) => {
    if (!isQrScannerActive) return;
    
    setError(null);
    
    try {
      // Rate limit check
      const rateLimitCheck = await checkRateLimit('qr_scan');
      if (!rateLimitCheck.allowed) {
        setError('Too many scan attempts. Please wait a moment.');
        return;
      }

      await logSecurityEvent('barcode_scan_attempt', {
        action: 'scan_initiated',
        business_id: auth.selectedBusinessId,
        code_length: scannedCode.length
      }, 'low');

      // Try direct QR code lookup first (when QR codes start getting populated)
      let { data: transaction, error } = await supabase
        .from('pos_sales')
        .select(`
          id, sale_number, subtotal, tax, discount, loyalty_discount, total,
          payment_status, customer_name, created_at, user_id, qr_code,
          pos_sale_items (
            id, inventory_id, name, sku, quantity, unit_price, total_price, modifiers, notes
          )
        `)
        .eq('business_id', auth.selectedBusinessId)
        .eq('qr_code', scannedCode)
        .eq('payment_status', 'completed')
        .single();

      // If no QR match, try sale_number lookup
      if (error || !transaction) {
        const result = await supabase
          .from('pos_sales')
          .select(`
            id, sale_number, subtotal, tax, discount, loyalty_discount, total,
            payment_status, customer_name, created_at, user_id, qr_code,
            pos_sale_items (
              id, inventory_id, name, sku, quantity, unit_price, total_price, modifiers, notes
            )
          `)
          .eq('business_id', auth.selectedBusinessId)
          .eq('sale_number', scannedCode)
          .eq('payment_status', 'completed')
          .single();
          
        transaction = result.data;
        error = result.error;
      }

      // If still no match, try UUID lookup (transaction ID)
      if (error || !transaction) {
        if (scannedCode.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
          const result = await supabase
            .from('pos_sales')
            .select(`
              id, sale_number, subtotal, tax, discount, loyalty_discount, total,
              payment_status, customer_name, created_at, user_id, qr_code,
              pos_sale_items (
                id, inventory_id, name, sku, quantity, unit_price, total_price, modifiers, notes
              )
            `)
            .eq('business_id', auth.selectedBusinessId)
            .eq('id', scannedCode)
            .eq('payment_status', 'completed')
            .single();
            
          transaction = result.data;
          error = result.error;
        }
      }

      if (error || !transaction) {
        await logSecurityEvent('qr_scan_not_found', {
          action: 'scan_failed',
          business_id: auth.selectedBusinessId,
          scanned_code_length: scannedCode.length
        }, 'low');
        
        throw new Error(`No transaction found for scanned code: ${scannedCode}`);
      }

      // Calculate refund info
      const { data: refunds } = await supabase
        .from('pos_refunds')
        .select('total_refund_amount')
        .eq('original_sale_id', transaction.id);

      const totalRefunded = refunds?.reduce((sum, refund) => sum + (refund.total_refund_amount || 0), 0) || 0;
      
      const transactionWithRefundInfo = {
        ...transaction,
        total_refunded: totalRefunded,
        remaining_refundable: (transaction.total || 0) - totalRefunded
      };

      await handleQRTransactionFound(transactionWithRefundInfo);
      
    } catch (err) {
      await logSecurityEvent('qr_scan_error', {
        action: 'scan_error',
        business_id: auth.selectedBusinessId,
        error_message: err.message
      }, 'medium');
      
      setError(err.message);
      toast.error(err.message);
    }
  };

  const handleSelectTransaction = async (transaction) => {
    setSelectedTransaction(transaction);
    setShowRefundModal(true);
    
    await logSecurityEvent('refund_transaction_selected', {
      action: 'transaction_selected',
      business_id: auth.selectedBusinessId,
      sale_id: transaction.id,
      sale_number: transaction.sale_number,
      original_total: transaction.total,
      remaining_refundable: transaction.remaining_refundable
    }, 'medium');

    await recordAction('refund_transaction_selected', transaction.id, true);
  };

  const handleManualRefund = async () => {
    if (!canManualRefund) {
      toast.error('You do not have permission to process manual refunds');
      return;
    }

    setShowManualRefundModal(true);
    
    await logSecurityEvent('manual_refund_initiated', {
      action: 'manual_refund_started',
      business_id: auth.selectedBusinessId,
      initiated_by: auth.authUser?.id
    }, 'high');

    await recordAction('manual_refund_initiated', auth.selectedBusinessId, true);
  };

  const handleCloseRefundModal = () => {
    setShowRefundModal(false);
    setSelectedTransaction(null);
    setQrScanResult(null);
  };

  const handleCloseManualRefundModal = () => {
    setShowManualRefundModal(false);
  };

  const handleRefundCompleted = () => {
    setShowRefundModal(false);
    setShowManualRefundModal(false);
    setSelectedTransaction(null);
    setQrScanResult(null);
    loadTransactions(); // Refresh the list
  };

  const handleToggleQrScanner = () => {
    setIsQrScannerActive(!isQrScannerActive);
    if (qrScanResult) {
      setQrScanResult(null);
    }
  };

  const renderTransactionsList = () => {
    if (loading) {
      return (
        <div style={styles.loading}>
          Loading transactions...
        </div>
      );
    }

    if (transactions.length === 0) {
      return (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>🧾</div>
          <div style={styles.emptyTitle}>No transactions found</div>
          <div style={styles.emptyText}>
            {searchTerm ? 'Try a different search term or scan a QR code' : 'No transactions for the selected time period'}
          </div>
          <PermissionGate permission="pos.sales.refund">
            <div style={styles.emptyActions}>
              <button 
                style={styles.manualRefundButton}
                onClick={handleManualRefund}
              >
                💰 Manual Refund
              </button>
            </div>
          </PermissionGate>
        </div>
      );
    }

    return (
      <div style={styles.transactionsList}>
        {transactions.map(transaction => (
          <RefundTransactionCard
            key={transaction.id}
            transaction={transaction}
            qrScanResult={qrScanResult}
            onSelect={handleSelectTransaction}
          />
        ))}
      </div>
    );
  };

  const styles = {
    container: {
      ...TavariStyles.layout.container
    },
    header: {
      marginBottom: TavariStyles.spacing['3xl'],
      textAlign: 'center'
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.sm
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600
    },
    errorBanner: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      marginBottom: TavariStyles.spacing.xl
    },
    successBanner: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.success,
      marginBottom: TavariStyles.spacing.xl
    },
    content: {
      flex: 1,
      overflowY: 'auto'
    },
    loading: {
      ...TavariStyles.components.loading.container
    },
    emptyState: {
      textAlign: 'center',
      padding: `${TavariStyles.spacing['6xl']} ${TavariStyles.spacing.xl}`,
      color: TavariStyles.colors.gray500
    },
    emptyIcon: {
      fontSize: TavariStyles.typography.fontSize['4xl'],
      marginBottom: TavariStyles.spacing.lg
    },
    emptyTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: TavariStyles.spacing.sm
    },
    emptyText: {
      fontSize: TavariStyles.typography.fontSize.base,
      marginBottom: TavariStyles.spacing.lg
    },
    emptyActions: {
      marginTop: TavariStyles.spacing.xl
    },
    transactionsList: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.md
    },
    manualRefundButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.warning,
      ...TavariStyles.components.button.sizes.md,
      whiteSpace: 'nowrap'
    }
  };

  return (
    <SecurityWrapper
      componentName="RefundsScreen"
      sensitiveComponent={true}
      requireSecureConnection={false}
      securityLevel="high"
    >
      <POSAuthWrapper 
        requiredRoles={['cashier', 'manager', 'owner']}
        requireBusiness={true}
        componentName="RefundsScreen"
      >
        <div style={styles.container}>
          <div style={styles.header}>
            <h2 style={styles.title}>Process Refunds</h2>
            <p style={styles.subtitle}>Search transactions by sale number or customer name, or scan QR codes for quick refunds</p>
          </div>

          <RefundSearchControls
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            isQrScannerActive={isQrScannerActive}
            onToggleQrScanner={handleToggleQrScanner}
            onManualRefund={handleManualRefund}
            loading={loading}
            canManualRefund={canManualRefund}
          />

          {error && (
            <div style={styles.errorBanner}>
              {error}
            </div>
          )}

          {qrScanResult && (
            <div style={styles.successBanner}>
              QR scan successful! Found transaction: Sale #{qrScanResult.sale_number}
            </div>
          )}

          <div style={styles.content}>
            {renderTransactionsList()}
          </div>

          {/* Barcode/QR Scanner - Uses existing BarcodeScanHandler */}
          {isQrScannerActive && (
            <BarcodeScanHandler
              onScan={handleBarcodeScan}
              disabled={false}
              testId="refunds-qr-scanner"
            />
          )}

          {/* Regular Refund Modal */}
          {showRefundModal && selectedTransaction && (
            <RefundModal
              transaction={selectedTransaction}
              businessSettings={businessSettings}
              selectedBusinessId={auth.selectedBusinessId}
              authUser={auth.authUser}
              onClose={handleCloseRefundModal}
              onRefundCompleted={handleRefundCompleted}
            />
          )}

          {/* Manual Refund Modal */}
          {showManualRefundModal && (
            <ManualRefundModal
              businessSettings={businessSettings}
              selectedBusinessId={auth.selectedBusinessId}
              authUser={auth.authUser}
              onClose={handleCloseManualRefundModal}
              onRefundCompleted={handleRefundCompleted}
            />
          )}
        </div>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default RefundsScreen;