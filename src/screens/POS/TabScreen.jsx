// screens/POS/TabScreen.jsx - WITH PERMISSION SYSTEM + NO CONSOLE LOGGING
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import { Eye } from 'lucide-react';

// Security & Authentication
import { SecurityWrapper, useSecurityContext } from '../../Security';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';

// Foundation Components and Hooks
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';

// Existing Components
import BarcodeScanHandler from '../../components/POS/BarcodeScanHandler';
import CreateTabModal from '../../components/POS/CreateTabModal';
import ItemSelectionModal from '../../components/POS/ItemSelectionModal';
import CustomerSelectionModal from '../../components/POS/CustomerSelectionModal';
import { ManagerOverrideModal, TabDetailsModal, QRManualInputModal, QRScannerModal } from '../../components/POS/TabScreenModals';

const TabScreen = () => {
  const navigate = useNavigate();
  
  // Security context for sensitive tab operations
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'TabScreen',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Authentication (will be handled by POSAuthWrapper)
  const [authData, setAuthData] = useState(null);
  
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
  const canViewTabs = hasAnyPermission(['pos.sales.create', 'pos.sales.view_all']) || hasElevatedPrivileges();
  const canCreateTabs = hasPermission('pos.sales.create') || hasElevatedPrivileges();
  const canEditTabs = hasPermission('pos.sales.create') || hasElevatedPrivileges();
  const canDeleteTabs = hasPermission('pos.sales.void') || isOwner();
  const canCloseTabs = hasAnyPermission(['pos.sales.create', 'pos.cash.count']) || hasElevatedPrivileges();
  const canProcessPayments = hasPermission('pos.sales.create') || hasElevatedPrivileges();
  
  // Tax calculations
  const taxCalculations = useTaxCalculations(authData?.selectedBusinessId);
  
  // State
  const [tabs, setTabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTab, setSelectedTab] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTabDetails, setShowTabDetails] = useState(false);
  const [showItemSelectionModal, setShowItemSelectionModal] = useState(false);
  const [showCustomerSelectionModal, setShowCustomerSelectionModal] = useState(false);
  const [selectedPaymentTab, setSelectedPaymentTab] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [paymentCustomer, setPaymentCustomer] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [qrSearchValue, setQrSearchValue] = useState('');
  const [sortBy, setSortBy] = useState('updated_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [showSearchScanner, setShowSearchScanner] = useState(false);
  const [showQRManualInput, setShowQRManualInput] = useState(false);

  // Manager override for tab operations
  const [showManagerOverride, setShowManagerOverride] = useState(false);
  const [managerPin, setManagerPin] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [pendingAction, setPendingAction] = useState(null);

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewTabs) {
      toast.error('You do not have permission to view tabs');
      navigate('/dashboard/pos');
    }
  }, [permissionsLoading, canViewTabs, navigate]);

  // Helper function to format currency using TavariStyles
  const formatCurrency = (amount) => {
    return `$${(Number(amount) || 0).toFixed(2)}`;
  };

  // Initialize when auth is ready
  const handleAuthReady = async (auth) => {
    await logSecurityEvent('tab_screen_accessed', {
      action: 'tab_screen_loaded',
      business_id: auth.selectedBusinessId,
      user_id: auth.authUser?.id
    }, 'low');

    setAuthData(auth);
  };

  // Load tabs when business ID is available
  useEffect(() => {
    if (authData?.selectedBusinessId && !permissionsLoading && canViewTabs) {
      loadTabs();
      
      // Set up real-time subscription
      const subscription = supabase
        .channel(`pos_tabs_${authData.selectedBusinessId}`)
        .on('postgres_changes', 
          { event: '*', schema: 'public', table: 'pos_tabs', filter: `business_id=eq.${authData.selectedBusinessId}` },
          loadTabs
        )
        .subscribe();

      return () => {
        supabase.removeChannel(subscription);
      };
    }
  }, [authData?.selectedBusinessId, permissionsLoading, canViewTabs]);

  const loadTabs = async () => {
    if (!authData?.selectedBusinessId) return;

    try {
      setLoading(true);
      setError(null);

      // Rate limit check
      const rateLimitCheck = await checkRateLimit('load_tabs');
      if (!rateLimitCheck.allowed) {
        setError('Too many requests. Please wait a moment.');
        setLoading(false);
        return;
      }

      await logSecurityEvent('tabs_load_initiated', {
        action: 'load_tabs',
        business_id: authData.selectedBusinessId,
        sort_by: sortBy,
        sort_order: sortOrder
      }, 'low');

      // Fixed query - removed category_id that doesn't exist in pos_tab_items table
      const { data, error: tabError } = await supabase
        .from('pos_tabs')
        .select(`
          *,
          pos_tab_items (
            id, name, quantity, unit_price, total_price, modifiers, notes
          )
        `)
        .eq('business_id', authData.selectedBusinessId)
        .in('status', ['open', 'partial'])
        .order(sortBy, { ascending: sortOrder === 'asc' });

      if (tabError) throw tabError;

      // Load loyalty account information and recalculate totals with proper tax calculations
      const tabsWithLoyalty = await Promise.all((data || []).map(async (tab) => {
        let updatedTab = { ...tab };

        // Recalculate totals from tab items using tax calculations
        if (tab.pos_tab_items && tab.pos_tab_items.length > 0) {
          const itemsSubtotal = tab.pos_tab_items.reduce((sum, item) => sum + (Number(item.total_price) || 0), 0);
          
          // If tab shows $0 but has items, recalculate with proper tax logic
          if ((Number(tab.subtotal) || 0) === 0 && itemsSubtotal > 0) {
            await logSecurityEvent('tab_recalculation', {
              action: 'recalculate_tab_totals',
              business_id: authData.selectedBusinessId,
              tab_id: tab.id,
              tab_number: tab.tab_number
            }, 'low');
            
            // Since pos_tab_items doesn't have category_id, we'll use a fallback tax calculation
            let taxAmount = 0;
            
            if (!taxCalculations.loading && taxCalculations.taxCategories.length > 0) {
              const itemsForTaxCalc = tab.pos_tab_items.map(item => ({
                ...item,
                price: item.unit_price || 0,
                quantity: item.quantity || 1,
                category_id: null
              }));
              
              const taxResult = taxCalculations.calculateTotalTax(
                itemsForTaxCalc, 
                0,
                0,
                itemsSubtotal
              );
              
              taxAmount = taxResult.totalTax;
            } else {
              // Fallback to basic tax calculation (13% HST as example)
              taxAmount = itemsSubtotal * 0.13;
            }
            
            const totalAmount = itemsSubtotal + taxAmount;
            const balanceRemaining = totalAmount - (Number(tab.amount_paid) || 0);

            // Update the tab in database
            const { error: updateError } = await supabase
              .from('pos_tabs')
              .update({
                subtotal: itemsSubtotal,
                tax_amount: taxAmount,
                total_amount: totalAmount,
                balance_remaining: balanceRemaining,
                updated_at: new Date().toISOString()
              })
              .eq('id', tab.id);

            if (!updateError) {
              updatedTab = {
                ...tab,
                subtotal: itemsSubtotal,
                tax_amount: taxAmount,
                total_amount: totalAmount,
                balance_remaining: balanceRemaining
              };
            }
          }
        }

        // Load loyalty account if needed
        if (updatedTab.loyalty_customer_id) {
          const { data: loyaltyAccount } = await supabase
            .from('pos_loyalty_accounts')
            .select('id, customer_name, customer_email, customer_phone, balance')
            .eq('id', updatedTab.loyalty_customer_id)
            .eq('business_id', authData.selectedBusinessId)
            .single();
          
          return { ...updatedTab, pos_loyalty_accounts: loyaltyAccount };
        }
        
        return updatedTab;
      }));

      setTabs(tabsWithLoyalty || []);

      await recordAction('tabs_loaded', authData.selectedBusinessId, true);
      await logSecurityEvent('tabs_loaded', {
        action: 'load_tabs_success',
        business_id: authData.selectedBusinessId,
        tab_count: tabsWithLoyalty.length
      }, 'low');

    } catch (err) {
      await logSecurityEvent('tabs_load_error', {
        action: 'load_tabs_failed',
        business_id: authData.selectedBusinessId,
        error_message: err.message
      }, 'medium');
      
      setError('Failed to load tabs: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleManagerOverride = async (pin) => {
    if (!authData?.validateManagerPin) {
      setError('Manager PIN validation not available');
      return;
    }

    // Rate limit check
    const rateLimitCheck = await checkRateLimit('manager_override');
    if (!rateLimitCheck.allowed) {
      toast.error('Too many override attempts. Please wait a moment.');
      return;
    }

    const isValidPin = await authData.validateManagerPin(pin);
    if (!isValidPin) {
      await logSecurityEvent('invalid_manager_override', {
        action: 'manager_override_failed',
        business_id: authData.selectedBusinessId,
        reason: overrideReason
      }, 'high');
      
      setError('Invalid manager PIN');
      return;
    }

    try {
      await logSecurityEvent('manager_override_approved', {
        action: 'manager_override_tab',
        business_id: authData.selectedBusinessId,
        reason: overrideReason,
        pending_action: pendingAction?.type,
        tab_id: pendingAction?.tab?.id
      }, 'high');

      await recordAction('manager_override_tab', pendingAction?.tab?.id, true);

      // Execute the pending action
      if (pendingAction?.type === 'close_tab') {
        await executeCloseTab(pendingAction.tab);
      } else if (pendingAction?.type === 'delete_tab') {
        await executeDeleteTab(pendingAction.tab);
      }

      // Reset manager override
      setShowManagerOverride(false);
      setManagerPin('');
      setOverrideReason('');
      setPendingAction(null);
      
    } catch (err) {
      await logSecurityEvent('manager_override_error', {
        action: 'manager_override_execution_failed',
        business_id: authData.selectedBusinessId,
        error_message: err.message
      }, 'high');
      
      setError('Failed to execute override: ' + err.message);
    }
  };

  // Handle barcode scanner input for QR codes
  const handleBarcodeOrQRScan = (code) => {
    if (showSearchScanner) {
      handleSearchQRScan(code);
    }
  };

  const handleSearchQRScan = async (qrData) => {
    if (!authData?.selectedBusinessId) return;

    try {
      // Rate limit check
      const rateLimitCheck = await checkRateLimit('qr_scan_search');
      if (!rateLimitCheck.allowed) {
        toast.error('Too many scan attempts. Please wait a moment.');
        return;
      }

      setShowSearchScanner(false);
      setQrSearchValue('');
      
      await logSecurityEvent('qr_search_scan', {
        action: 'qr_search_initiated',
        business_id: authData.selectedBusinessId,
        code_length: qrData.length
      }, 'low');
      
      let searchValue = '';
      
      // Try to parse as JSON first (loyalty customer QR)
      try {
        const parsed = JSON.parse(qrData);
        if (parsed.type === 'loyalty_customer' && parsed.customer_id) {
          const { data: loyaltyCustomer, error } = await supabase
            .from('pos_loyalty_accounts')
            .select('customer_name, customer_phone, customer_email')
            .eq('id', parsed.customer_id)
            .eq('business_id', authData.selectedBusinessId)
            .single();

          if (loyaltyCustomer && !error) {
            searchValue = loyaltyCustomer.customer_name;
          }
        }
      } catch (jsonError) {
        // Not JSON, continue to other formats
      }

      // Try as direct loyalty account ID (UUID format)
      if (!searchValue && qrData.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        const { data: loyaltyCustomer, error } = await supabase
          .from('pos_loyalty_accounts')
          .select('customer_name, customer_phone, customer_email')
          .eq('id', qrData)
          .eq('business_id', authData.selectedBusinessId)
          .single();

        if (loyaltyCustomer && !error) {
          searchValue = loyaltyCustomer.customer_name;
        }
      }

      // Try as phone number
      if (!searchValue && qrData.match(/^\+?[\d\s\-\(\)]+$/)) {
        const cleanPhone = qrData.replace(/\D/g, '');
        searchValue = cleanPhone;
      }

      // Use as direct text if it's reasonable length
      if (!searchValue && qrData.length > 2 && qrData.length < 50 && !qrData.includes('/')) {
        searchValue = qrData;
      }

      if (searchValue) {
        setSearchTerm(searchValue);
        await recordAction('qr_search_completed', authData.selectedBusinessId, true);
      } else {
        await logSecurityEvent('qr_search_invalid', {
          action: 'qr_search_failed',
          business_id: authData.selectedBusinessId
        }, 'low');
        setError('Could not determine search term from QR code');
      }

    } catch (err) {
      await logSecurityEvent('qr_search_error', {
        action: 'qr_search_error',
        business_id: authData.selectedBusinessId,
        error_message: err.message
      }, 'medium');
      
      setError('Failed to process QR code for search: ' + err.message);
    }
  };

  const handleManualQRSearch = async () => {
    // Validate input
    const validation = await validateInput(qrSearchValue.trim(), 'text', 'qr_search');
    if (!validation.valid) {
      setError('Invalid QR code input');
      return;
    }

    if (!qrSearchValue.trim()) {
      setError('Please enter a QR code value');
      return;
    }

    await handleSearchQRScan(qrSearchValue.trim());
    setShowQRManualInput(false);
    setQrSearchValue('');
  };

  // Item Selection Modal Functions
  const handleItemToggle = (item) => {
    setSelectedItems(prev => {
      const isSelected = prev.some(selected => selected.id === item.id);
      if (isSelected) {
        return prev.filter(selected => selected.id !== item.id);
      } else {
        return [...prev, item];
      }
    });
  };

  const handleSelectAllItems = () => {
    if (selectedPaymentTab?.pos_tab_items) {
      setSelectedItems([...selectedPaymentTab.pos_tab_items]);
    }
  };

  const handleClearItemSelection = () => {
    setSelectedItems([]);
  };

  const proceedToCustomerSelection = () => {
    if (selectedItems.length === 0) {
      setError('Please select at least one item to pay for');
      return;
    }
    setShowItemSelectionModal(false);
    setShowCustomerSelectionModal(true);
  };

  const proceedToPayment = async () => {
    if (!canProcessPayments) {
      toast.error('You do not have permission to process payments');
      return;
    }

    try {
      // Calculate totals for selected items using tax calculations
      const selectedSubtotal = selectedItems.reduce((sum, item) => sum + (Number(item.total_price) || 0), 0);
      
      // Prepare items for tax calculation (add fallback structure)
      const itemsForTaxCalc = selectedItems.map(item => ({
        ...item,
        price: item.unit_price || 0,
        quantity: item.quantity || 1,
        category_id: null
      }));
      
      let taxResult = { totalTax: 0, aggregatedTaxes: {}, aggregatedRebates: {}, itemTaxDetails: [] };
      
      // Use tax calculation hook if available
      if (!taxCalculations.loading && taxCalculations.taxCategories.length > 0) {
        taxResult = taxCalculations.calculateTotalTax(itemsForTaxCalc, 0, 0, selectedSubtotal);
      } else {
        // Fallback tax calculation
        taxResult.totalTax = selectedSubtotal * 0.13; // 13% HST fallback
      }
      
      const selectedTotal = selectedSubtotal + taxResult.totalTax;

      await logSecurityEvent('tab_payment_initiated', {
        action: 'proceed_to_payment',
        business_id: authData.selectedBusinessId,
        tab_id: selectedPaymentTab.id,
        item_count: selectedItems.length,
        total_amount: selectedTotal
      }, 'medium');

      await recordAction('tab_payment_initiated', selectedPaymentTab.id, true);

      // Navigate to payment screen with selected items and customer
      navigate('/dashboard/pos/payment', {
        state: {
          saleData: {
            ...selectedPaymentTab,
            items: selectedItems,
            loyaltyCustomer: paymentCustomer,
            tab_mode: true,
            payment_type: 'partial',
            subtotal: selectedSubtotal,
            tax_amount: taxResult.totalTax,
            total_amount: selectedTotal,
            amount_paid: 0,
            balance_remaining: selectedTotal,
            is_partial_payment: true,
            original_tab_id: selectedPaymentTab.id,
            aggregatedTaxes: taxResult.aggregatedTaxes,
            aggregatedRebates: taxResult.aggregatedRebates,
            itemTaxDetails: taxResult.itemTaxDetails
          }
        }
      });

      // Reset modal states
      setShowCustomerSelectionModal(false);
      setSelectedPaymentTab(null);
      setSelectedItems([]);
      setPaymentCustomer(null);

    } catch (err) {
      await logSecurityEvent('tab_payment_error', {
        action: 'proceed_to_payment_failed',
        business_id: authData.selectedBusinessId,
        error_message: err.message
      }, 'medium');
      
      toast.error('Failed to proceed to payment: ' + err.message);
    }
  };

  const handleCreateTab = async (tabData) => {
    if (!canCreateTabs) {
      toast.error('You do not have permission to create tabs');
      return;
    }

    try {
      // Rate limit check
      const rateLimitCheck = await checkRateLimit('create_tab');
      if (!rateLimitCheck.allowed) {
        toast.error('Too many requests. Please wait a moment.');
        return;
      }

      await logSecurityEvent('tab_create_initiated', {
        action: 'create_tab',
        business_id: authData.selectedBusinessId,
        customer_name: tabData.customer_name
      }, 'medium');

      const { data: tab, error } = await supabase
        .from('pos_tabs')
        .insert(tabData)
        .select()
        .single();

      if (error) throw error;

      await recordAction('tab_created', tab.id, true);
      await logSecurityEvent('tab_created', {
        action: 'create_tab_success',
        business_id: authData.selectedBusinessId,
        tab_id: tab.id,
        tab_number: tab.tab_number,
        customer_name: tab.customer_name,
        loyalty_customer_id: tab.loyalty_customer_id
      }, 'medium');

      setShowCreateModal(false);
      toast.success('Tab created successfully');

      navigate('/dashboard/pos/register', {
        state: {
          activeTab: tab,
          mode: 'tab',
          justCreated: true
        }
      });

    } catch (err) {
      await logSecurityEvent('tab_create_error', {
        action: 'create_tab_failed',
        business_id: authData.selectedBusinessId,
        error_message: err.message
      }, 'medium');
      
      toast.error('Failed to create tab: ' + err.message);
    }
  };

  const handleSelectTab = async (tab) => {
    await logSecurityEvent('tab_details_viewed', {
      action: 'view_tab_details',
      business_id: authData.selectedBusinessId,
      tab_id: tab.id
    }, 'low');

    setSelectedTab(tab);
    setShowTabDetails(true);
  };

  const handleAddItemsToTab = async (tab) => {
    if (!canEditTabs) {
      toast.error('You do not have permission to edit tabs');
      return;
    }

    await logSecurityEvent('tab_edit_initiated', {
      action: 'add_items_to_tab',
      business_id: authData.selectedBusinessId,
      tab_id: tab.id
    }, 'medium');

    navigate('/dashboard/pos/register', {
      state: {
        activeTab: tab,
        mode: 'tab'
      }
    });
  };

  const handlePayTab = async (tab, paymentType = 'partial') => {
    if (!canProcessPayments) {
      toast.error('You do not have permission to process payments');
      return;
    }

    await logSecurityEvent('tab_payment_modal_opened', {
      action: 'open_payment_modal',
      business_id: authData.selectedBusinessId,
      tab_id: tab.id,
      payment_type: paymentType
    }, 'medium');

    setSelectedPaymentTab(tab);
    setSelectedItems([]);
    setPaymentCustomer(null);
    setShowItemSelectionModal(true);
  };

  const handleCloseTab = (tab) => {
    if (!canCloseTabs) {
      toast.error('You do not have permission to close tabs');
      return;
    }

    if (tab.balance_remaining > 0.01) {
      setPendingAction({ type: 'close_tab', tab });
      setOverrideReason('Closing tab with remaining balance');
      setShowManagerOverride(true);
    } else {
      executeCloseTab(tab);
    }
  };

  const executeCloseTab = async (tab) => {
    try {
      setLoading(true);

      await logSecurityEvent('tab_close_initiated', {
        action: 'close_tab',
        business_id: authData.selectedBusinessId,
        tab_id: tab.id,
        final_balance: tab.balance_remaining
      }, 'high');

      const { error } = await supabase
        .from('pos_tabs')
        .update({ 
          status: 'closed',
          closed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', tab.id);

      if (error) throw error;

      await recordAction('tab_closed', tab.id, true);
      await logSecurityEvent('tab_closed', {
        action: 'close_tab_success',
        business_id: authData.selectedBusinessId,
        tab_id: tab.id,
        tab_number: tab.tab_number,
        final_balance: tab.balance_remaining
      }, 'high');

      toast.success('Tab closed successfully');
      loadTabs();

    } catch (err) {
      await logSecurityEvent('tab_close_error', {
        action: 'close_tab_failed',
        business_id: authData.selectedBusinessId,
        tab_id: tab.id,
        error_message: err.message
      }, 'high');
      
      setError('Failed to close tab: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTab = (tab) => {
    if (!canDeleteTabs) {
      toast.error('You do not have permission to delete tabs');
      return;
    }

    setPendingAction({ type: 'delete_tab', tab });
    setOverrideReason('Deleting tab - requires manager approval');
    setShowManagerOverride(true);
  };

  const executeDeleteTab = async (tab) => {
    try {
      setLoading(true);

      await logSecurityEvent('tab_delete_initiated', {
        action: 'delete_tab',
        business_id: authData.selectedBusinessId,
        tab_id: tab.id,
        tab_number: tab.tab_number
      }, 'high');
      
      // First delete associated tab items
      await supabase
        .from('pos_tab_items')
        .delete()
        .eq('tab_id', tab.id);

      // Then delete the tab
      const { error } = await supabase
        .from('pos_tabs')
        .delete()
        .eq('id', tab.id);

      if (error) throw error;

      await recordAction('tab_deleted', tab.id, true);
      await logSecurityEvent('tab_deleted', {
        action: 'delete_tab_success',
        business_id: authData.selectedBusinessId,
        tab_id: tab.id,
        tab_number: tab.tab_number,
        customer_name: tab.customer_name
      }, 'high');

      toast.success('Tab deleted successfully');
      loadTabs();

    } catch (err) {
      await logSecurityEvent('tab_delete_error', {
        action: 'delete_tab_failed',
        business_id: authData.selectedBusinessId,
        tab_id: tab.id,
        error_message: err.message
      }, 'high');
      
      setError('Failed to delete tab: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchChange = async (value) => {
    // Validate search input
    const validation = await validateInput(value, 'text', 'tab_search');
    if (!validation.valid) {
      return;
    }
    setSearchTerm(value);
  };

  const filteredTabs = tabs.filter(tab => {
    if (!searchTerm) return true;
    return (
      tab.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tab.customer_phone?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tab.customer_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tab.tab_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tab.notes?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const getTabStatus = (tab) => {
    if (tab.status === 'closed') return 'Closed';
    if (tab.balance_remaining <= 0) return 'Paid in Full';
    if (tab.amount_paid > 0) return 'Partial Payment';
    return 'Open';
  };

  const getStatusColor = (tab) => {
    if (tab.status === 'closed') return TavariStyles.colors.gray500;
    if (tab.balance_remaining <= 0) return TavariStyles.colors.success;
    if (tab.amount_paid > 0) return TavariStyles.colors.warning;
    return TavariStyles.colors.info;
  };

  // Create styles using TavariStyles
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
      ...TavariStyles.components.banner.variants.error
    },
    controls: {
      display: 'flex',
      gap: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing.xl,
      alignItems: 'flex-end',
      flexWrap: 'wrap'
    },
    searchSection: {
      flex: 1,
      display: 'flex',
      gap: TavariStyles.spacing.lg,
      alignItems: 'flex-end',
      flexWrap: 'wrap'
    },
    searchGroup: {
      display: 'flex',
      flexDirection: 'column',
      minWidth: '250px',
      flex: 1
    },
    qrSearchGroup: {
      display: 'flex',
      flexDirection: 'column',
      minWidth: '180px'
    },
    sortGroup: {
      display: 'flex',
      flexDirection: 'column',
      minWidth: '150px'
    },
    searchLabel: {
      ...TavariStyles.components.form.label
    },
    searchInput: {
      ...TavariStyles.components.form.input,
      borderColor: TavariStyles.colors.primary,
      borderWidth: '2px'
    },
    qrButtonGroup: {
      display: 'flex',
      gap: TavariStyles.spacing.sm
    },
    qrScanButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.sm,
      flex: 1,
      whiteSpace: 'nowrap'
    },
    qrManualButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.sizes.sm,
      flex: 1,
      backgroundColor: TavariStyles.colors.gray600,
      color: TavariStyles.colors.white,
      whiteSpace: 'nowrap'
    },
    sortSelect: {
      ...TavariStyles.components.form.select,
      borderColor: TavariStyles.colors.primary,
      borderWidth: '2px',
      minWidth: '150px'
    },
    createButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.md,
      whiteSpace: 'nowrap'
    },
    stats: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing['3xl']
    },
    statCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      textAlign: 'center'
    },
    statValue: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary,
      marginBottom: TavariStyles.spacing.sm
    },
    statLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray500
    },
    content: {
      flex: 1,
      overflowY: 'auto'
    },
    emptyState: {
      textAlign: 'center',
      padding: `${TavariStyles.spacing['6xl']} ${TavariStyles.spacing.xl}`,
      color: TavariStyles.colors.gray500
    },
    emptyIcon: {
      fontSize: '64px',
      marginBottom: TavariStyles.spacing.xl
    },
    emptyTitle: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: TavariStyles.spacing.md
    },
    emptyText: {
      fontSize: TavariStyles.typography.fontSize.lg,
      marginBottom: TavariStyles.spacing['3xl']
    },
    tabGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
      gap: TavariStyles.spacing.xl,
      paddingBottom: TavariStyles.spacing.xl
    },
    tabCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      border: `2px solid ${TavariStyles.colors.gray200}`,
      transition: TavariStyles.transitions.normal,
      boxShadow: TavariStyles.shadows.md
    },
    tabHeader: {
      ...TavariStyles.layout.flexBetween,
      marginBottom: TavariStyles.spacing.lg,
      paddingBottom: TavariStyles.spacing.md,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`
    },
    tabNumber: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800
    },
    tabStatus: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.sm,
      backgroundColor: TavariStyles.colors.gray100
    },
    tabBody: {
      marginBottom: TavariStyles.spacing.lg
    },
    customerInfo: {
      marginBottom: TavariStyles.spacing.lg
    },
    customerName: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xs
    },
    customerPhone: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray500,
      marginBottom: TavariStyles.spacing.xs
    },
    customerEmail: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray500,
      marginBottom: TavariStyles.spacing.xs
    },
    loyaltyBadge: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.success,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      backgroundColor: TavariStyles.colors.successBg,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.sm,
      display: 'inline-block',
      marginBottom: TavariStyles.spacing.xs
    },
    tabNotes: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray500,
      fontStyle: 'italic'
    },
    tabAmounts: {
      marginBottom: TavariStyles.spacing.lg
    },
    amountRow: {
      ...TavariStyles.layout.flexBetween,
      marginBottom: TavariStyles.spacing.xs,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    totalAmount: {
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800
    },
    paidAmount: {
      color: TavariStyles.colors.success
    },
    balanceAmount: {
      fontWeight: TavariStyles.typography.fontWeight.bold
    },
    tabMeta: {
      ...TavariStyles.layout.flexBetween,
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray400
    },
    tabActions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      justifyContent: 'space-between'
    },
    actionButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.ghost,
      ...TavariStyles.components.button.sizes.sm,
      flex: 1
    },
    payButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.success,
      ...TavariStyles.components.button.sizes.sm,
      flex: 1
    },
    closeButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.sm,
      flex: 1
    },
    deleteButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.danger,
      ...TavariStyles.components.button.sizes.sm,
      minWidth: '40px'
    },
    loading: {
      ...TavariStyles.components.loading.container
    }
  };

  const TabScreenContent = () => {
    if (loading) {
      return (
        <div style={styles.container}>
          <div style={styles.loading}>Loading tabs...</div>
        </div>
      );
    }

    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h2 style={styles.title}>Tab Management</h2>
          <p style={styles.subtitle}>Manage customer tabs and open orders</p>
        </div>

        {error && <div style={styles.errorBanner}>{error}</div>}

        {/* Controls */}
        <div style={styles.controls}>
          <div style={styles.searchSection}>
            {/* Text Search */}
            <div style={styles.searchGroup}>
              <label style={styles.searchLabel}>Search Tabs:</label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Customer name, phone, or tab number..."
                style={styles.searchInput}
              />
            </div>

            {/* QR Code Search */}
            <div style={styles.qrSearchGroup}>
              <label style={styles.searchLabel}>QR Search:</label>
              <div style={styles.qrButtonGroup}>
                <button
                  style={styles.qrScanButton}
                  onClick={() => setShowSearchScanner(true)}
                  title="Scan customer QR code"
                >
                  Scan QR
                </button>
                <button
                  style={styles.qrManualButton}
                  onClick={() => setShowQRManualInput(true)}
                  title="Enter QR code manually"
                >
                  Enter QR
                </button>
              </div>
            </div>

            {/* Sort */}
            <div style={styles.sortGroup}>
              <label style={styles.searchLabel}>Sort:</label>
              <select
                value={`${sortBy}-${sortOrder}`}
                onChange={(e) => {
                  const [field, order] = e.target.value.split('-');
                  setSortBy(field);
                  setSortOrder(order);
                  loadTabs();
                }}
                style={styles.sortSelect}
              >
                <option value="updated_at-desc">Most Recent</option>
                <option value="updated_at-asc">Oldest First</option>
                <option value="customer_name-asc">Customer A-Z</option>
                <option value="customer_name-desc">Customer Z-A</option>
                <option value="total_amount-desc">Highest Amount</option>
                <option value="total_amount-asc">Lowest Amount</option>
              </select>
            </div>
          </div>
          
          <PermissionGate permission="pos.sales.create">
            <button
              style={styles.createButton}
              onClick={() => setShowCreateModal(true)}
            >
              + Create New Tab
            </button>
          </PermissionGate>
        </div>

        {/* Stats */}
        <div style={styles.stats}>
          <div style={styles.statCard}>
            <div style={styles.statValue}>{filteredTabs.length}</div>
            <div style={styles.statLabel}>Active Tabs</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statValue}>
              {formatCurrency(filteredTabs.reduce((sum, tab) => sum + (tab.total_amount || 0), 0))}
            </div>
            <div style={styles.statLabel}>Total Tab Value</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statValue}>
              {formatCurrency(filteredTabs.reduce((sum, tab) => sum + (tab.balance_remaining || 0), 0))}
            </div>
            <div style={styles.statLabel}>Outstanding Balance</div>
          </div>
        </div>

        {/* Tab List */}
        <div style={styles.content}>
          {filteredTabs.length === 0 ? (
            <div style={styles.emptyState}>
              <div style={styles.emptyIcon}>📋</div>
              <div style={styles.emptyTitle}>No Active Tabs</div>
              <div style={styles.emptyText}>
                {searchTerm ? 'No tabs match your search criteria' : 'Create a new tab to get started'}
              </div>
              {!searchTerm && (
                <PermissionGate permission="pos.sales.create">
                  <button
                    style={styles.createButton}
                    onClick={() => setShowCreateModal(true)}
                  >
                    Create First Tab
                  </button>
                </PermissionGate>
              )}
            </div>
          ) : (
            <div style={styles.tabGrid}>
              {filteredTabs.map(tab => (
                <div key={tab.id} style={styles.tabCard}>
                  <div style={styles.tabHeader}>
                    <div style={styles.tabNumber}>{tab.tab_number}</div>
                    <div 
                      style={{
                        ...styles.tabStatus,
                        color: getStatusColor(tab)
                      }}
                    >
                      {getTabStatus(tab)}
                    </div>
                  </div>
                  
                  <div style={styles.tabBody}>
                    <div style={styles.customerInfo}>
                      <div style={styles.customerName}>{tab.customer_name}</div>
                      {tab.customer_phone && (
                        <div style={styles.customerPhone}>📞 {tab.customer_phone}</div>
                      )}
                      {tab.customer_email && (
                        <div style={styles.customerEmail}>✉️ {tab.customer_email}</div>
                      )}
                      {tab.pos_loyalty_accounts && (
                        <div style={styles.loyaltyBadge}>⭐ Loyalty Member</div>
                      )}
                      {tab.notes && (
                        <div style={styles.tabNotes}>📝 {tab.notes}</div>
                      )}
                    </div>
                    
                    <div style={styles.tabAmounts}>
                      <div style={styles.amountRow}>
                        <span>Total:</span>
                        <span style={styles.totalAmount}>{formatCurrency(tab.total_amount)}</span>
                      </div>
                      <div style={styles.amountRow}>
                        <span>Paid:</span>
                        <span style={styles.paidAmount}>{formatCurrency(tab.amount_paid)}</span>
                      </div>
                      <div style={styles.amountRow}>
                        <span>Balance:</span>
                        <span style={{
                          ...styles.balanceAmount,
                          color: tab.balance_remaining > 0 ? TavariStyles.colors.danger : TavariStyles.colors.success
                        }}>
                          {formatCurrency(tab.balance_remaining)}
                        </span>
                      </div>
                    </div>
                    
                    <div style={styles.tabMeta}>
                      <div style={styles.tabDate}>
                        Created: {new Date(tab.created_at).toLocaleDateString()}
                      </div>
                      <div style={styles.tabItems}>
                        Items: {tab.pos_tab_items?.length || 0}
                      </div>
                    </div>
                  </div>
                  
                  <div style={styles.tabActions}>
                    <button
                      style={styles.actionButton}
                      onClick={() => handleSelectTab(tab)}
                      title="View Details"
                    >
                      <Eye size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> View
                    </button>
                    
                    <PermissionGate permission="pos.sales.create">
                      <button
                        style={styles.actionButton}
                        onClick={() => handleAddItemsToTab(tab)}
                        title="Add Items"
                      >
                        ➕ Add Items
                      </button>
                    </PermissionGate>
                    
                    {tab.balance_remaining > 0 ? (
                      <PermissionGate permission="pos.sales.create">
                        <button
                          style={styles.payButton}
                          onClick={() => handlePayTab(tab, 'partial')}
                          title="Make Payment"
                        >
                          💳 Pay
                        </button>
                      </PermissionGate>
                    ) : (
                      <PermissionGate permissions={['pos.sales.create', 'pos.cash.count']} requireAny>
                        <button
                          style={styles.closeButton}
                          onClick={() => handleCloseTab(tab)}
                          title="Close Tab"
                        >
                          ✅ Close
                        </button>
                      </PermissionGate>
                    )}
                    
                    <PermissionGate permission="pos.sales.void" requireOwner>
                      <button
                        style={styles.deleteButton}
                        onClick={() => handleDeleteTab(tab)}
                        title="Delete Tab"
                      >
                        🗑️
                      </button>
                    </PermissionGate>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modals */}
        <CreateTabModal
          showModal={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onCreateTab={handleCreateTab}
          selectedBusinessId={authData?.selectedBusinessId}
          authUser={authData?.authUser}
        />

        <ItemSelectionModal
          showModal={showItemSelectionModal}
          onClose={() => {
            setShowItemSelectionModal(false);
            setSelectedPaymentTab(null);
            setSelectedItems([]);
          }}
          selectedPaymentTab={selectedPaymentTab}
          selectedItems={selectedItems}
          onItemToggle={handleItemToggle}
          onSelectAllItems={handleSelectAllItems}
          onClearItemSelection={handleClearItemSelection}
          onProceedToCustomerSelection={proceedToCustomerSelection}
          formatCurrency={formatCurrency}
        />

        <CustomerSelectionModal
          showModal={showCustomerSelectionModal}
          onClose={() => {
            setShowCustomerSelectionModal(false);
            setPaymentCustomer(null);
          }}
          onBackToItems={() => {
            setShowCustomerSelectionModal(false);
            setShowItemSelectionModal(true);
          }}
          selectedItems={selectedItems}
          selectedPaymentTab={selectedPaymentTab}
          paymentCustomer={paymentCustomer}
          onCustomerSelected={setPaymentCustomer}
          onProceedToPayment={proceedToPayment}
          formatCurrency={formatCurrency}
          selectedBusinessId={authData?.selectedBusinessId}
        />

        <ManagerOverrideModal
          showModal={showManagerOverride}
          onClose={() => {
            setShowManagerOverride(false);
            setPendingAction(null);
            setManagerPin('');
            setError(null);
          }}
          overrideReason={overrideReason}
          onApproveOverride={handleManagerOverride}
          error={error}
        />

        <TabDetailsModal
          showModal={showTabDetails}
          onClose={() => {
            setShowTabDetails(false);
            setSelectedTab(null);
          }}
          selectedTab={selectedTab}
          onAddItems={handleAddItemsToTab}
          onMakePayment={handlePayTab}
          formatCurrency={formatCurrency}
        />

        <QRManualInputModal
          showModal={showQRManualInput}
          onClose={() => {
            setShowQRManualInput(false);
            setQrSearchValue('');
          }}
          onSubmit={handleManualQRSearch}
          value={qrSearchValue}
          onChange={setQrSearchValue}
          title="Enter QR Code Manually"
          instructions="Enter the QR code data from a customer's loyalty card. This can be: Customer UUID, Phone number, Customer name, or JSON loyalty data"
        />

        <QRScannerModal
          showModal={showSearchScanner}
          onClose={() => setShowSearchScanner(false)}
          onScan={handleBarcodeOrQRScan}
          title="Scan Customer QR Code"
          instructions="Scan a customer's loyalty card QR code to search for their open tabs"
        />
      </div>
    );
  };

  return (
    <SecurityWrapper
      componentName="TabScreen"
      sensitiveComponent={true}
      requireSecureConnection={false}
      securityLevel="high"
    >
      <POSAuthWrapper
        requireBusiness={true}
        requiredRoles={['employee', 'manager', 'owner']}
        componentName="Tab Management"
        onAuthReady={handleAuthReady}
      >
        <TabScreenContent />
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default TabScreen;