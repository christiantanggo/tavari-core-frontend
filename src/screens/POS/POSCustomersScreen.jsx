// screens/POS/POSCustomersScreen.jsx - With Permissions and Clean Logging
import React, { useState, useEffect, useCallback } from 'react';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { supabase } from '../../supabaseClient';
import { X, History, CreditCard, Plus, Minus, Lock, AlertCircle } from 'lucide-react';

// Permission system integration
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import toast from 'react-hot-toast';

const POSCustomersScreen = () => {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showTransactions, setShowTransactions] = useState(false);
  const [customerTransactions, setCustomerTransactions] = useState([]);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  
  // Loyalty transaction history states
  const [showLoyaltyHistory, setShowLoyaltyHistory] = useState(false);
  const [loyaltyTransactions, setLoyaltyTransactions] = useState([]);
  const [loyaltyHistoryLoading, setLoyaltyHistoryLoading] = useState(false);
  const [loyaltySettings, setLoyaltySettings] = useState(null);
  
  // Manual points adjustment states
  const [showAddPoints, setShowAddPoints] = useState(false);
  const [showRemovePoints, setShowRemovePoints] = useState(false);
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [adjustmentLoading, setAdjustmentLoading] = useState(false);
  const [adjustmentError, setAdjustmentError] = useState(null);
  
  // Form state
  const [formData, setFormData] = useState({
    customer_name: '',
    customer_email: '',
    customer_phone: '',
    balance: 0,
    points: 0,
    notes: ''
  });

  const auth = usePOSAuth({
    requireBusiness: true,
    componentName: 'POSCustomersScreen'
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

  // Permission checks
  const canViewCustomers = hasAnyPermission(['pos.customers.view', 'pos.loyalty.manage']) || hasElevatedPrivileges();
  const canManageCustomers = hasPermission('pos.customers.manage') || hasElevatedPrivileges();
  const canViewLoyalty = hasPermission('pos.loyalty.use') || hasElevatedPrivileges();
  const canManageLoyalty = hasPermission('pos.loyalty.manage') || hasElevatedPrivileges();
  const canAdjustPoints = hasPermission('pos.loyalty.adjust') || isOwner();
  const canDeleteCustomers = hasPermission('pos.customers.manage') || isOwner();

  const { formatTaxAmount } = useTaxCalculations(auth.selectedBusinessId);

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewCustomers) {
      toast.error('You do not have permission to view customers');
    }
  }, [permissionsLoading, canViewCustomers]);

  // Load loyalty settings
  useEffect(() => {
    const loadLoyaltySettings = async () => {
      if (!auth.selectedBusinessId) return;

      try {
        const { data: settings, error } = await supabase
          .from('pos_loyalty_settings')
          .select('*')
          .eq('business_id', auth.selectedBusinessId)
          .single();

        if (error && error.code !== 'PGRST116') {
          return;
        }

        if (settings) {
          setLoyaltySettings(settings);
        }
      } catch (err) {
        // Silent fail
      }
    };

    if (auth.selectedBusinessId) {
      loadLoyaltySettings();
    }
  }, [auth.selectedBusinessId]);

  // Load customers
  const loadCustomers = useCallback(async () => {
    if (!auth.selectedBusinessId || !canViewCustomers) return;
    
    setLoading(true);
    try {
      const { data, error: fetchError } = await supabase
        .from('pos_loyalty_accounts')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .order(sortBy, { ascending: sortOrder === 'asc' });

      if (fetchError) throw fetchError;
      setCustomers(data || []);
    } catch (err) {
      setError('Failed to load customers: ' + err.message);
      toast.error('Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [auth.selectedBusinessId, sortBy, sortOrder, canViewCustomers]);

  // Load customer POS sales transactions
  const loadCustomerTransactions = useCallback(async (customerId) => {
    if (!customerId || !canViewCustomers) return;
    
    try {
      const { data, error: fetchError } = await supabase
        .from('pos_sales')
        .select(`
          id,
          sale_number,
          total,
          created_at,
          payment_status,
          user_id,
          users!pos_sales_user_id_fkey(name)
        `)
        .eq('loyalty_customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (fetchError) throw fetchError;
      setCustomerTransactions(data || []);
    } catch (err) {
      toast.error('Failed to load customer transactions');
    }
  }, [canViewCustomers]);

  // Load customer loyalty transaction history
  const loadLoyaltyHistory = useCallback(async (customer) => {
    if (!customer || !auth.selectedBusinessId || !canViewLoyalty) {
      if (!canViewLoyalty) {
        toast.error('You do not have permission to view loyalty history');
      }
      return;
    }
    
    setSelectedCustomer(customer);
    setShowLoyaltyHistory(true);
    setLoyaltyHistoryLoading(true);

    try {
      // Get ALL loyalty transactions for this customer
      const { data, error } = await supabase
        .from('pos_loyalty_transactions')
        .select('*')
        .eq('loyalty_account_id', customer.id)
        .eq('business_id', auth.selectedBusinessId)
        .order('created_at', { ascending: false });

      if (error) {
        setLoyaltyTransactions([]);
        toast.error('Failed to load loyalty history');
      } else {
        setLoyaltyTransactions(data || []);
      }

    } catch (err) {
      setLoyaltyTransactions([]);
      toast.error('Failed to load loyalty history');
    } finally {
      setLoyaltyHistoryLoading(false);
    }
  }, [auth.selectedBusinessId, canViewLoyalty]);

  // Validate manager PIN
  const validateManagerPin = async (pin) => {
    if (!auth.authUser || !auth.selectedBusinessId) {
      return false;
    }

    try {
      // Get user's PIN from database
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('pin')
        .eq('id', auth.authUser.id)
        .single();

      if (userError || !userData?.pin) {
        return false;
      }

      const storedPin = userData.pin;

      // Check if PIN is hashed (bcrypt format)
      if (storedPin.startsWith('$2b$') || storedPin.startsWith('$2a$')) {
        try {
          const bcrypt = await import('bcryptjs');
          const isValid = await bcrypt.compare(pin, storedPin);
          return isValid;
        } catch (bcryptError) {
          return String(pin) === String(storedPin);
        }
      } else {
        // Plain text PIN comparison
        return String(pin) === String(storedPin);
      }
      
    } catch (err) {
      return false;
    }
  };

  // Handle manual points adjustment
  const handlePointsAdjustment = async (isAddition) => {
    // Permission check
    if (!canAdjustPoints) {
      toast.error('You do not have permission to adjust loyalty points');
      return;
    }

    if (!selectedCustomer || !adjustmentAmount || !adjustmentReason.trim() || !managerPin) {
      setAdjustmentError('Please fill in all fields');
      return;
    }

    const points = parseInt(adjustmentAmount);
    if (isNaN(points) || points <= 0) {
      setAdjustmentError('Please enter a valid positive number');
      return;
    }

    setAdjustmentLoading(true);
    setAdjustmentError(null);

    try {
      // Validate manager PIN
      const pinValid = await validateManagerPin(managerPin);
      if (!pinValid) {
        setAdjustmentError('Invalid manager PIN');
        setAdjustmentLoading(false);
        return;
      }

      // Calculate new balance
      const currentBalance = selectedCustomer.balance || 0;
      let newBalance;
      let transactionType;
      let transactionPoints;
      let transactionAmount;

      if (loyaltySettings?.loyalty_mode === 'points') {
        // Points mode: convert points to dollars for balance storage
        const dollarValue = points * 10 / loyaltySettings.redemption_rate;
        newBalance = isAddition ? currentBalance + dollarValue : Math.max(0, currentBalance - dollarValue);
        transactionType = 'adjust';
        transactionPoints = isAddition ? points : -points;
        transactionAmount = isAddition ? dollarValue : -dollarValue;
      } else {
        // Dollar mode: points represent dollars
        newBalance = isAddition ? currentBalance + points : Math.max(0, currentBalance - points);
        transactionType = isAddition ? 'manual_add' : 'manual_subtract';
        transactionPoints = null;
        transactionAmount = isAddition ? points : -points;
      }

      // Update customer balance
      const { error: updateError } = await supabase
        .from('pos_loyalty_accounts')
        .update({
          balance: newBalance,
          last_activity: new Date().toISOString()
        })
        .eq('id', selectedCustomer.id);

      if (updateError) throw updateError;

      // Log the transaction
      const { error: logError } = await supabase
        .from('pos_loyalty_transactions')
        .insert({
          business_id: auth.selectedBusinessId,
          loyalty_account_id: selectedCustomer.id,
          transaction_type: transactionType,
          amount: transactionAmount,
          points: transactionPoints,
          balance_before: currentBalance,
          balance_after: newBalance,
          points_before: 0,
          points_after: 0,
          description: `Manual ${isAddition ? 'addition' : 'subtraction'}: ${adjustmentReason}`,
          processed_by: auth.authUser.id,
          processed_at: new Date().toISOString()
        });

      if (logError) throw logError;

      // Update local state
      setSelectedCustomer({ ...selectedCustomer, balance: newBalance });
      
      // Reload data
      await loadCustomers();
      await loadLoyaltyHistory({ ...selectedCustomer, balance: newBalance });

      // Reset form
      setAdjustmentAmount('');
      setAdjustmentReason('');
      setManagerPin('');
      setShowAddPoints(false);
      setShowRemovePoints(false);

      toast.success(`Successfully ${isAddition ? 'added' : 'removed'} ${points} ${loyaltySettings?.loyalty_mode === 'points' ? 'points' : 'dollars'}`);

    } catch (err) {
      setAdjustmentError('Failed to adjust points: ' + err.message);
      toast.error('Failed to adjust points');
    } finally {
      setAdjustmentLoading(false);
    }
  };

  // Reset adjustment form when closing
  const resetAdjustmentForm = () => {
    setAdjustmentAmount('');
    setAdjustmentReason('');
    setManagerPin('');
    setAdjustmentError(null);
    setShowAddPoints(false);
    setShowRemovePoints(false);
  };

  // Handle add points button click
  const handleAddPointsClick = () => {
    if (!canAdjustPoints) {
      toast.error('You do not have permission to adjust loyalty points');
      return;
    }

    setShowAddPoints(!showAddPoints);
    setShowRemovePoints(false);
    if (!showAddPoints) {
      setAdjustmentAmount('');
      setAdjustmentReason('');
      setManagerPin('');
      setAdjustmentError(null);
    }
  };

  // Handle remove points button click
  const handleRemovePointsClick = () => {
    if (!canAdjustPoints) {
      toast.error('You do not have permission to adjust loyalty points');
      return;
    }

    setShowRemovePoints(!showRemovePoints);
    setShowAddPoints(false);
    if (!showRemovePoints) {
      setAdjustmentAmount('');
      setAdjustmentReason('');
      setManagerPin('');
      setAdjustmentError(null);
    }
  };

  useEffect(() => {
    if (auth.selectedBusinessId && !permissionsLoading) {
      loadCustomers();
    }
  }, [loadCustomers, permissionsLoading]);

  // Filter customers based on search
  const filteredCustomers = customers.filter(customer => 
    customer.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.customer_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.customer_phone?.includes(searchTerm)
  );

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Permission check
    if (!canManageCustomers) {
      toast.error('You do not have permission to manage customers');
      return;
    }

    if (!auth.selectedBusinessId) return;

    try {
      const customerData = {
        customer_name: formData.customer_name,
        customer_email: formData.customer_email || null,
        customer_phone: formData.customer_phone || null,
        balance: Number(formData.balance) || 0,
        points: Number(formData.points) || 0,
        business_id: auth.selectedBusinessId
      };

      let result;
      if (selectedCustomer) {
        // Update existing customer
        result = await supabase
          .from('pos_loyalty_accounts')
          .update(customerData)
          .eq('id', selectedCustomer.id)
          .eq('business_id', auth.selectedBusinessId);
      } else {
        // Create new customer
        result = await supabase
          .from('pos_loyalty_accounts')
          .insert([customerData]);
      }

      if (result.error) throw result.error;

      toast.success(`Customer ${selectedCustomer ? 'updated' : 'created'} successfully`);
      await loadCustomers();
      handleCloseModal();
    } catch (err) {
      setError('Failed to save customer: ' + err.message);
      toast.error('Failed to save customer');
    }
  };

  // Handle delete customer
  const handleDeleteCustomer = async (customerId) => {
    // Permission check
    if (!canDeleteCustomers) {
      toast.error('You do not have permission to delete customers');
      return;
    }

    if (!window.confirm('Are you sure you want to delete this customer? This action cannot be undone.')) {
      return;
    }

    try {
      const { error: deleteError } = await supabase
        .from('pos_loyalty_accounts')
        .delete()
        .eq('id', customerId)
        .eq('business_id', auth.selectedBusinessId);

      if (deleteError) throw deleteError;
      
      toast.success('Customer deleted successfully');
      await loadCustomers();
    } catch (err) {
      setError('Failed to delete customer: ' + err.message);
      toast.error('Failed to delete customer');
    }
  };

  // Handle modal open/close
  const handleCreateCustomer = () => {
    if (!canManageCustomers) {
      toast.error('You do not have permission to create customers');
      return;
    }

    setFormData({
      customer_name: '',
      customer_email: '',
      customer_phone: '',
      balance: 0,
      points: 0,
      notes: ''
    });
    setSelectedCustomer(null);
    setShowCreateModal(true);
  };

  const handleEditCustomer = (customer) => {
    if (!canManageCustomers) {
      toast.error('You do not have permission to edit customers');
      return;
    }

    setFormData({
      customer_name: customer.customer_name || '',
      customer_email: customer.customer_email || '',
      customer_phone: customer.customer_phone || '',
      balance: customer.balance || 0,
      points: customer.points || 0,
      notes: customer.notes || ''
    });
    setSelectedCustomer(customer);
    setShowEditModal(true);
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    setShowEditModal(false);
    setSelectedCustomer(null);
    setError(null);
  };

  const handleViewTransactions = async (customer) => {
    if (!canViewCustomers) {
      toast.error('You do not have permission to view transactions');
      return;
    }

    setSelectedCustomer(customer);
    await loadCustomerTransactions(customer.id);
    setShowTransactions(true);
  };

  // Helper function to display balance in correct format
  const getBalanceDisplay = (customer) => {
    if (!loyaltySettings) return '$0.00';
    
    if (loyaltySettings.loyalty_mode === 'points') {
      const dollarBalance = customer.balance || 0;
      const points = Math.round(dollarBalance * (loyaltySettings.redemption_rate || 10000) / 10);
      return `${points.toLocaleString()} pts`;
    }
    const balance = customer.balance || 0;
    return `$${balance.toFixed(2)}`;
  };

  // Helper function to format transaction type for display
  const formatTransactionType = (type) => {
    const typeMap = {
      'earn': 'Earned',
      'redeem': 'Redeemed',
      'manual_add': 'Manual Add',
      'manual_subtract': 'Manual Subtract',
      'initial_balance': 'Initial Setup',
      'adjustment': 'Adjustment'
    };
    return typeMap[type] || type.charAt(0).toUpperCase() + type.slice(1);
  };

  // Helper function to get transaction amount display
  const getTransactionAmountDisplay = (transaction) => {
    const isEarn = ['earn', 'manual_add', 'initial_balance'].includes(transaction.transaction_type);
    const isRedeem = ['redeem', 'manual_subtract'].includes(transaction.transaction_type);
    
    if (loyaltySettings?.loyalty_mode === 'points' && transaction.points !== null) {
      const points = Math.abs(transaction.points || 0);
      return `${isEarn ? '+' : isRedeem ? '-' : ''}${points.toLocaleString()} pts`;
    } else {
      const amount = Math.abs(transaction.amount || 0);
      return `${isEarn ? '+' : isRedeem ? '-' : ''}$${amount.toFixed(2)}`;
    }
  };

  // Create styles using TavariStyles
  const styles = {
    container: {
      ...TavariStyles.layout.container,
      padding: TavariStyles.spacing.xl
    },
    
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.xl,
      paddingBottom: TavariStyles.spacing.lg,
      borderBottom: `2px solid ${TavariStyles.colors.primary}`
    },
    
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      margin: 0
    },

    readOnlyBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      backgroundColor: TavariStyles.colors.warningBg,
      border: `2px solid ${TavariStyles.colors.warning}`,
      borderRadius: TavariStyles.borderRadius.md,
      color: TavariStyles.colors.warningText,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      marginBottom: TavariStyles.spacing.md
    },

    accessDenied: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing['4xl'],
      textAlign: 'center',
      marginTop: TavariStyles.spacing['4xl']
    },

    accessDeniedIcon: {
      color: TavariStyles.colors.danger,
      marginBottom: TavariStyles.spacing.lg
    },

    accessDeniedTitle: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.md
    },

    accessDeniedText: {
      fontSize: TavariStyles.typography.fontSize.md,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.xl
    },
    
    searchSection: {
      display: 'flex',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.xl,
      alignItems: 'center'
    },
    
    searchInput: {
      ...TavariStyles.components.form.input,
      flex: 1,
      maxWidth: '400px'
    },
    
    sortSelect: {
      ...TavariStyles.components.form.select,
      minWidth: '150px'
    },
    
    createButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg
    },

    disabledButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.sizes.lg,
      backgroundColor: TavariStyles.colors.gray300,
      color: TavariStyles.colors.gray600,
      cursor: 'not-allowed',
      opacity: 0.6
    },
    
    tableContainer: {
      ...TavariStyles.components.table.container
    },
    
    table: {
      ...TavariStyles.components.table.table
    },
    
    headerRow: {
      ...TavariStyles.components.table.headerRow
    },
    
    th: {
      ...TavariStyles.components.table.th
    },
    
    row: {
      ...TavariStyles.components.table.row
    },
    
    td: {
      ...TavariStyles.components.table.td
    },
    
    actionButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.sizes.sm,
      marginRight: TavariStyles.spacing.xs
    },
    
    editButton: {
      ...TavariStyles.components.button.variants.secondary
    },
    
    deleteButton: {
      ...TavariStyles.components.button.variants.danger
    },
    
    viewButton: {
      backgroundColor: TavariStyles.colors.info,
      color: TavariStyles.colors.white
    },
    
    loyaltyButton: {
      ...TavariStyles.components.button.base,
      backgroundColor: TavariStyles.colors.success,
      color: TavariStyles.colors.white,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: '80px',
      height: '50px',
      fontSize: TavariStyles.typography.fontSize.xs,
      lineHeight: '1.2',
      border: `2px solid ${TavariStyles.colors.success}`,
      borderRadius: TavariStyles.borderRadius.md
    },
    
    loyaltyButtonBalance: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: '2px'
    },
    
    loyaltyButtonSubtext: {
      fontSize: '10px',
      opacity: 0.9,
      fontWeight: TavariStyles.typography.fontWeight.normal
    },
    
    modal: {
      ...TavariStyles.components.modal.overlay
    },
    
    modalContent: {
      ...TavariStyles.components.modal.content,
      maxWidth: '600px'
    },
    
    modalHeader: {
      ...TavariStyles.components.modal.header
    },
    
    modalBody: {
      ...TavariStyles.components.modal.body
    },
    
    modalFooter: {
      ...TavariStyles.components.modal.footer
    },
    
    loyaltyModal: {
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
    
    loyaltyModalContent: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      maxWidth: '700px',
      width: '90%',
      maxHeight: '80vh',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: TavariStyles.shadows.xl
    },
    
    loyaltyModalHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: TavariStyles.spacing.lg,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      borderTopLeftRadius: TavariStyles.borderRadius.lg,
      borderTopRightRadius: TavariStyles.borderRadius.lg
    },
    
    loyaltyModalTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      margin: 0
    },
    
    loyaltyModalBody: {
      flex: 1,
      padding: TavariStyles.spacing.lg,
      overflowY: 'auto'
    },
    
    adjustmentButtonRow: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.lg,
      justifyContent: 'center'
    },
    
    addPointsButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      flex: 1,
      cursor: 'pointer'
    },
    
    removePointsButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.danger,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      flex: 1,
      cursor: 'pointer'
    },
    
    adjustmentSection: {
      marginBottom: TavariStyles.spacing.lg,
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      transition: 'all 0.3s ease',
      maxHeight: showAddPoints || showRemovePoints ? '400px' : '0px',
      overflow: 'hidden',
      opacity: showAddPoints || showRemovePoints ? 1 : 0
    },
    
    adjustmentTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.md
    },
    
    adjustmentForm: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.md
    },
    
    adjustmentFormGroup: {
      display: 'flex',
      flexDirection: 'column'
    },
    
    adjustmentLabel: {
      ...TavariStyles.components.form.label,
      marginBottom: TavariStyles.spacing.xs
    },
    
    adjustmentInput: {
      ...TavariStyles.components.form.input
    },
    
    adjustmentActions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      justifyContent: 'flex-end',
      marginTop: TavariStyles.spacing.md
    },
    
    adjustmentSubmit: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary
    },
    
    adjustmentCancel: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary
    },
    
    adjustmentError: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      marginBottom: TavariStyles.spacing.md
    },
    
    customerSummary: {
      marginBottom: TavariStyles.spacing.lg,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.successBg,
      borderRadius: TavariStyles.borderRadius.sm,
      border: `1px solid ${TavariStyles.colors.success}30`
    },
    
    customerSummaryName: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xs
    },
    
    customerSummaryBalance: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.success,
      fontWeight: TavariStyles.typography.fontWeight.semibold
    },
    
    transactionsList: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },
    
    transactionItem: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.sm,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    
    transactionLeft: {
      flex: 1
    },
    
    transactionType: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xs
    },
    
    transactionDate: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500
    },
    
    transactionDescription: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      marginTop: '2px',
      fontStyle: 'italic'
    },
    
    transactionAmount: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      textAlign: 'right'
    },
    
    earnedAmount: {
      color: TavariStyles.colors.success
    },
    
    redeemedAmount: {
      color: TavariStyles.colors.danger
    },
    
    adjustmentAmount: {
      color: TavariStyles.colors.warning
    },
    
    loadingMessage: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: TavariStyles.spacing.xl,
      color: TavariStyles.colors.gray500,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    
    emptyMessage: {
      textAlign: 'center',
      color: TavariStyles.colors.gray500,
      padding: TavariStyles.spacing.xl,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    
    closeButton: {
      background: 'transparent',
      border: 'none',
      fontSize: '24px',
      cursor: 'pointer',
      color: TavariStyles.colors.white,
      padding: TavariStyles.spacing.xs,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: TavariStyles.borderRadius.sm
    },
    
    form: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.lg
    },
    
    formGroup: {
      display: 'flex',
      flexDirection: 'column'
    },
    
    label: {
      ...TavariStyles.components.form.label
    },
    
    input: {
      ...TavariStyles.components.form.input
    },
    
    errorBanner: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error
    },
    
    emptyState: {
      textAlign: 'center',
      padding: TavariStyles.spacing['6xl'],
      color: TavariStyles.colors.gray500
    },
    
    loadingState: {
      ...TavariStyles.components.loading.container
    },
    
    statsCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.lg,
      textAlign: 'center',
      marginBottom: TavariStyles.spacing.lg
    },
    
    statValue: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary
    },
    
    statLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    }
  };

  // Render loyalty history modal with manual adjustment functionality
  const renderLoyaltyHistoryModal = () => {
    if (!showLoyaltyHistory || !selectedCustomer) return null;

    return (
      <div style={styles.loyaltyModal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.loyaltyModalContent}>
          <div style={styles.loyaltyModalHeader}>
            <h3 style={styles.loyaltyModalTitle}>
              Loyalty History - {selectedCustomer.customer_name}
            </h3>
            <button 
              style={styles.closeButton}
              onClick={() => {
                setShowLoyaltyHistory(false);
                setSelectedCustomer(null);
                setLoyaltyTransactions([]);
                resetAdjustmentForm();
              }}
            >
              <X size={20} />
            </button>
          </div>
          
          <div style={styles.loyaltyModalBody}>
            <div style={styles.customerSummary}>
              <div style={styles.customerSummaryName}>
                {selectedCustomer.customer_name}
              </div>
              <div style={styles.customerSummaryBalance}>
                Current Balance: {getBalanceDisplay(selectedCustomer)}
              </div>
              {selectedCustomer.customer_email && (
                <div style={styles.transactionDescription}>
                  {selectedCustomer.customer_email}
                </div>
              )}
              {selectedCustomer.customer_phone && (
                <div style={styles.transactionDescription}>
                  {selectedCustomer.customer_phone}
                </div>
              )}
            </div>

            {/* Points adjustment buttons - Protected by permission */}
            <PermissionGate
              requireOwner
              fallback={
                <div style={styles.readOnlyBadge}>
                  <AlertCircle size={16} />
                  <span>Only owners can adjust loyalty points</span>
                </div>
              }
            >
              <div style={styles.adjustmentButtonRow}>
                <button
                  style={styles.addPointsButton}
                  onClick={handleAddPointsClick}
                >
                  <Plus size={16} />
                  Add {loyaltySettings?.loyalty_mode === 'points' ? 'Points' : 'Credit'}
                </button>
                <button
                  style={styles.removePointsButton}
                  onClick={handleRemovePointsClick}
                >
                  <Minus size={16} />
                  Remove {loyaltySettings?.loyalty_mode === 'points' ? 'Points' : 'Credit'}
                </button>
              </div>
            </PermissionGate>

            {/* Add points section */}
            {showAddPoints && (
              <div style={styles.adjustmentSection}>
                <h4 style={styles.adjustmentTitle}>
                  Add {loyaltySettings?.loyalty_mode === 'points' ? 'Points' : 'Credit'}
                </h4>
                
                {adjustmentError && (
                  <div style={styles.adjustmentError}>{adjustmentError}</div>
                )}
                
                <div style={styles.adjustmentForm}>
                  <div style={styles.adjustmentFormGroup}>
                    <label style={styles.adjustmentLabel}>
                      Amount ({loyaltySettings?.loyalty_mode === 'points' ? 'Points' : 'Dollars'}):
                    </label>
                    <input
                      type="number"
                      value={adjustmentAmount}
                      onChange={(e) => setAdjustmentAmount(e.target.value)}
                      placeholder={loyaltySettings?.loyalty_mode === 'points' ? 'Enter points' : 'Enter dollar amount'}
                      style={styles.adjustmentInput}
                      min="1"
                    />
                  </div>
                  
                  <div style={styles.adjustmentFormGroup}>
                    <label style={styles.adjustmentLabel}>Reason:</label>
                    <input
                      type="text"
                      value={adjustmentReason}
                      onChange={(e) => setAdjustmentReason(e.target.value)}
                      placeholder="Enter reason for addition"
                      style={styles.adjustmentInput}
                    />
                  </div>
                  
                  <div style={styles.adjustmentFormGroup}>
                    <label style={styles.adjustmentLabel}>Manager PIN:</label>
                    <input
                      type="password"
                      value={managerPin}
                      onChange={(e) => setManagerPin(e.target.value)}
                      placeholder="Enter manager PIN"
                      style={styles.adjustmentInput}
                    />
                  </div>
                  
                  <div style={styles.adjustmentActions}>
                    <button
                      style={styles.adjustmentCancel}
                      onClick={resetAdjustmentForm}
                    >
                      Cancel
                    </button>
                    <button
                      style={styles.adjustmentSubmit}
                      onClick={() => handlePointsAdjustment(true)}
                      disabled={adjustmentLoading || !adjustmentAmount || !adjustmentReason.trim() || !managerPin}
                    >
                      {adjustmentLoading ? 'Processing...' : 'Add Points'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Remove points section */}
            {showRemovePoints && (
              <div style={styles.adjustmentSection}>
                <h4 style={styles.adjustmentTitle}>
                  Remove {loyaltySettings?.loyalty_mode === 'points' ? 'Points' : 'Credit'}
                </h4>
                
                {adjustmentError && (
                  <div style={styles.adjustmentError}>{adjustmentError}</div>
                )}
                
                <div style={styles.adjustmentForm}>
                  <div style={styles.adjustmentFormGroup}>
                    <label style={styles.adjustmentLabel}>
                      Amount ({loyaltySettings?.loyalty_mode === 'points' ? 'Points' : 'Dollars'}):
                    </label>
                    <input
                      type="number"
                      value={adjustmentAmount}
                      onChange={(e) => setAdjustmentAmount(e.target.value)}
                      placeholder={loyaltySettings?.loyalty_mode === 'points' ? 'Enter points' : 'Enter dollar amount'}
                      style={styles.adjustmentInput}
                      min="1"
                    />
                  </div>
                  
                  <div style={styles.adjustmentFormGroup}>
                    <label style={styles.adjustmentLabel}>Reason:</label>
                    <input
                      type="text"
                      value={adjustmentReason}
                      onChange={(e) => setAdjustmentReason(e.target.value)}
                      placeholder="Enter reason for deduction"
                      style={styles.adjustmentInput}
                    />
                  </div>
                  
                  <div style={styles.adjustmentFormGroup}>
                    <label style={styles.adjustmentLabel}>Manager PIN:</label>
                    <input
                      type="password"
                      value={managerPin}
                      onChange={(e) => setManagerPin(e.target.value)}
                      placeholder="Enter manager PIN"
                      style={styles.adjustmentInput}
                    />
                  </div>
                  
                  <div style={styles.adjustmentActions}>
                    <button
                      style={styles.adjustmentCancel}
                      onClick={resetAdjustmentForm}
                    >
                      Cancel
                    </button>
                    <button
                      style={{...styles.adjustmentSubmit, backgroundColor: TavariStyles.colors.danger}}
                      onClick={() => handlePointsAdjustment(false)}
                      disabled={adjustmentLoading || !adjustmentAmount || !adjustmentReason.trim() || !managerPin}
                    >
                      {adjustmentLoading ? 'Processing...' : 'Remove Points'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {loyaltyHistoryLoading ? (
              <div style={styles.loadingMessage}>
                Loading loyalty history...
              </div>
            ) : loyaltyTransactions.length === 0 ? (
              <div style={styles.emptyMessage}>
                No loyalty transactions found for this customer.
              </div>
            ) : (
              <div style={styles.transactionsList}>
                {loyaltyTransactions.map((transaction, index) => {
                  const isEarn = ['earn', 'manual_add', 'initial_balance'].includes(transaction.transaction_type);
                  const isRedeem = ['redeem', 'manual_subtract'].includes(transaction.transaction_type);
                  const isAdjustment = ['adjustment'].includes(transaction.transaction_type);
                  
                  let amountStyle = styles.adjustmentAmount;
                  if (isEarn) amountStyle = styles.earnedAmount;
                  if (isRedeem) amountStyle = styles.redeemedAmount;
                  
                  return (
                    <div key={index} style={styles.transactionItem}>
                      <div style={styles.transactionLeft}>
                        <div style={styles.transactionType}>
                          {formatTransactionType(transaction.transaction_type)}
                        </div>
                        <div style={styles.transactionDate}>
                          {new Date(transaction.created_at).toLocaleDateString()} at {new Date(transaction.created_at).toLocaleTimeString()}
                        </div>
                        {transaction.description && (
                          <div style={styles.transactionDescription}>
                            {transaction.description}
                          </div>
                        )}
                      </div>
                      <div style={{...styles.transactionAmount, ...amountStyle}}>
                        {getTransactionAmountDisplay(transaction)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Show loading while permissions are being checked
  if (permissionsLoading || loading) {
    return (
      <POSAuthWrapper 
        requireBusiness={true}
        componentName="POSCustomersScreen"
      >
        <div style={styles.container}>
          <div style={styles.loadingState}>
            {permissionsLoading ? 'Loading permissions...' : 'Loading customers...'}
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  // Show access denied if no permission
  if (!canViewCustomers) {
    return (
      <POSAuthWrapper 
        requireBusiness={true}
        componentName="POSCustomersScreen"
      >
        <div style={styles.container}>
          <div style={styles.accessDenied}>
            <Lock size={64} style={styles.accessDeniedIcon} />
            <h2 style={styles.accessDeniedTitle}>Access Denied</h2>
            <p style={styles.accessDeniedText}>
              You do not have permission to view customers.
            </p>
            <p style={styles.accessDeniedText}>
              Contact your administrator to request access.
            </p>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper 
      requireBusiness={true}
      componentName="POSCustomersScreen"
    >
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.title}>Customer Management</h1>
          
          <PermissionGate
            permission="pos.customers.manage"
            fallback={
              <button style={styles.disabledButton} disabled>
                <Lock size={16} style={{ marginRight: '8px' }} />
                Add Customer (Locked)
              </button>
            }
          >
            <button style={styles.createButton} onClick={handleCreateCustomer}>
              + Add New Customer
            </button>
          </PermissionGate>
        </div>

        {!canManageCustomers && (
          <div style={styles.readOnlyBadge}>
            <AlertCircle size={16} />
            <span>View-Only Mode - Contact admin to create or edit customers</span>
          </div>
        )}

        {error && <div style={styles.errorBanner}>{error}</div>}

        {/* Customer Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: TavariStyles.spacing.lg, marginBottom: TavariStyles.spacing.xl }}>
          <div style={styles.statsCard}>
            <div style={styles.statValue}>{customers.length}</div>
            <div style={styles.statLabel}>Total Customers</div>
          </div>
          <div style={styles.statsCard}>
            <div style={styles.statValue}>
              ${formatTaxAmount(customers.reduce((sum, c) => sum + (Number(c.balance) || 0), 0))}
            </div>
            <div style={styles.statLabel}>Total Loyalty Balance</div>
          </div>
          <div style={styles.statsCard}>
            <div style={styles.statValue}>
              {loyaltySettings?.loyalty_mode === 'points' 
                ? customers.reduce((sum, c) => {
                    const dollarBalance = Number(c.balance) || 0;
                    const points = Math.round(dollarBalance * (loyaltySettings.redemption_rate || 10000) / 10);
                    return sum + points;
                  }, 0).toLocaleString()
                : customers.reduce((sum, c) => sum + (Number(c.points) || 0), 0)
              } {loyaltySettings?.loyalty_mode === 'points' ? 'pts' : ''}
            </div>
            <div style={styles.statLabel}>
              {loyaltySettings?.loyalty_mode === 'points' ? 'Total Points' : 'Total Points'}
            </div>
          </div>
        </div>

        {/* Search and Sort */}
        <div style={styles.searchSection}>
          <input
            type="text"
            placeholder="Search customers by name, email, or phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />
          
          <select
            value={`${sortBy}-${sortOrder}`}
            onChange={(e) => {
              const [field, order] = e.target.value.split('-');
              setSortBy(field);
              setSortOrder(order);
            }}
            style={styles.sortSelect}
          >
            <option value="created_at-desc">Newest First</option>
            <option value="created_at-asc">Oldest First</option>
            <option value="customer_name-asc">Name A-Z</option>
            <option value="customer_name-desc">Name Z-A</option>
            <option value="balance-desc">Highest Balance</option>
            <option value="points-desc">Most Points</option>
          </select>
        </div>

        {/* Customer Table */}
        {filteredCustomers.length === 0 ? (
          <div style={styles.emptyState}>
            {searchTerm ? 'No customers found matching your search.' : 'No customers yet. Create your first customer to get started.'}
          </div>
        ) : (
          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.headerRow}>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Contact</th>
                  <th style={styles.th}>Balance</th>
                  <th style={styles.th}>Points/Loyalty</th>
                  <th style={styles.th}>Created</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.map((customer) => (
                  <tr key={customer.id} style={styles.row}>
                    <td style={styles.td}>
                      <strong>{customer.customer_name}</strong>
                    </td>
                    <td style={styles.td}>
                      <div>
                        {customer.customer_email && <div>{customer.customer_email}</div>}
                        {customer.customer_phone && <div>{customer.customer_phone}</div>}
                      </div>
                    </td>
                    <td style={styles.td}>
                      ${formatTaxAmount(customer.balance || 0)}
                    </td>
                    <td style={styles.td}>
                      <PermissionGate
                        permission="pos.loyalty.use"
                        fallback={
                          <button
                            style={{...styles.loyaltyButton, opacity: 0.5, cursor: 'not-allowed'}}
                            disabled
                            title="You don't have permission to view loyalty details"
                          >
                            <Lock size={16} />
                          </button>
                        }
                      >
                        <button
                          style={styles.loyaltyButton}
                          onClick={() => loadLoyaltyHistory(customer)}
                          title="View complete loyalty transaction history"
                        >
                          <div style={styles.loyaltyButtonBalance}>
                            {getBalanceDisplay(customer)}
                          </div>
                          <div style={styles.loyaltyButtonSubtext}>
                            Tap for more
                          </div>
                        </button>
                      </PermissionGate>
                    </td>
                    <td style={styles.td}>
                      {new Date(customer.created_at).toLocaleDateString()}
                    </td>
                    <td style={styles.td}>
                      <button 
                        style={{ ...styles.actionButton, ...styles.viewButton }}
                        onClick={() => handleViewTransactions(customer)}
                      >
                        View
                      </button>
                      
                      <PermissionGate
                        permission="pos.customers.manage"
                        fallback={
                          <button 
                            style={{ ...styles.actionButton, ...styles.editButton, opacity: 0.5 }}
                            disabled
                            title="You don't have permission to edit"
                          >
                            <Lock size={12} />
                          </button>
                        }
                      >
                        <button 
                          style={{ ...styles.actionButton, ...styles.editButton }}
                          onClick={() => handleEditCustomer(customer)}
                        >
                          Edit
                        </button>
                      </PermissionGate>
                      
                      <PermissionGate
                        requireOwner
                        fallback={
                          <button 
                            style={{ ...styles.actionButton, ...styles.deleteButton, opacity: 0.5 }}
                            disabled
                            title="Only owners can delete"
                          >
                            <Lock size={12} />
                          </button>
                        }
                      >
                        <button 
                          style={{ ...styles.actionButton, ...styles.deleteButton }}
                          onClick={() => handleDeleteCustomer(customer.id)}
                        >
                          Delete
                        </button>
                      </PermissionGate>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Create/Edit Customer Modal */}
        {(showCreateModal || showEditModal) && (
          <div style={styles.modal}>
            <div style={styles.modalContent}>
              <div style={styles.modalHeader}>
                <h3>{selectedCustomer ? 'Edit Customer' : 'Create New Customer'}</h3>
                <button onClick={handleCloseModal} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer' }}>×</button>
              </div>
              
              <div style={styles.modalBody}>
                <form onSubmit={handleSubmit} style={styles.form}>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Customer Name *</label>
                    <input
                      type="text"
                      value={formData.customer_name}
                      onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                      style={styles.input}
                      required
                    />
                  </div>
                  
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Email</label>
                    <input
                      type="email"
                      value={formData.customer_email}
                      onChange={(e) => setFormData({ ...formData, customer_email: e.target.value })}
                      style={styles.input}
                    />
                  </div>
                  
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Phone</label>
                    <input
                      type="tel"
                      value={formData.customer_phone}
                      onChange={(e) => setFormData({ ...formData, customer_phone: e.target.value })}
                      style={styles.input}
                    />
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: TavariStyles.spacing.lg }}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Balance ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.balance}
                        onChange={(e) => setFormData({ ...formData, balance: e.target.value })}
                        style={styles.input}
                      />
                    </div>
                    
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Points</label>
                      <input
                        type="number"
                        value={formData.points}
                        onChange={(e) => setFormData({ ...formData, points: e.target.value })}
                        style={styles.input}
                      />
                    </div>
                  </div>
                  
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Notes</label>
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      style={{ ...styles.input, minHeight: '80px', resize: 'vertical' }}
                      rows={3}
                    />
                  </div>
                </form>
              </div>
              
              <div style={styles.modalFooter}>
                <button onClick={handleCloseModal} style={{ ...styles.actionButton, ...styles.editButton }}>
                  Cancel
                </button>
                <button onClick={handleSubmit} style={styles.createButton}>
                  {selectedCustomer ? 'Update Customer' : 'Create Customer'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Customer POS Transactions Modal */}
        {showTransactions && selectedCustomer && (
          <div style={styles.modal}>
            <div style={{ ...styles.modalContent, maxWidth: '800px' }}>
              <div style={styles.modalHeader}>
                <h3>POS Transaction History - {selectedCustomer.customer_name}</h3>
                <button onClick={() => setShowTransactions(false)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer' }}>×</button>
              </div>
              
              <div style={styles.modalBody}>
                {customerTransactions.length === 0 ? (
                  <div style={styles.emptyState}>No POS transactions found for this customer.</div>
                ) : (
                  <div style={styles.tableContainer}>
                    <table style={styles.table}>
                      <thead>
                        <tr style={styles.headerRow}>
                          <th style={styles.th}>Sale #</th>
                          <th style={styles.th}>Date</th>
                          <th style={styles.th}>Total</th>
                          <th style={styles.th}>Status</th>
                          <th style={styles.th}>Cashier</th>
                        </tr>
                      </thead>
                      <tbody>
                        {customerTransactions.map((transaction) => (
                          <tr key={transaction.id} style={styles.row}>
                            <td style={styles.td}>{transaction.sale_number}</td>
                            <td style={styles.td}>{new Date(transaction.created_at).toLocaleDateString()}</td>
                            <td style={styles.td}>${formatTaxAmount(transaction.total)}</td>
                            <td style={styles.td}>{transaction.payment_status}</td>
                            <td style={styles.td}>{transaction.users?.name || 'Unknown'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              
              <div style={styles.modalFooter}>
                <button onClick={() => setShowTransactions(false)} style={{ ...styles.actionButton, ...styles.editButton }}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Loyalty History Modal with Manual Adjustment */}
        {renderLoyaltyHistoryModal()}
      </div>
    </POSAuthWrapper>
  );
};

export default POSCustomersScreen;