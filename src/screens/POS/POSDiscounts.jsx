// src/screens/POS/POSDiscounts.jsx
// Updated with permissions system and removed console logging
import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { logAction } from '../../helpers/posAudit';
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { SecurityWrapper } from '../../Security';
import { useSecurityContext } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';

const POSDiscountsContent = ({ authState }) => {
  const { selectedBusinessId, authUser } = authState;
  
  // Security context for discount operations
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'POSDiscounts',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'medium'
  });

  // Permission system
  const {
    hasPermission,
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading
  } = usePermissions();

  // Permission checks
  const canViewDiscounts = hasAnyPermission([
    'pos.discounts.view',
    'pos.discounts.create',
    'pos.discounts.edit'
  ]) || hasElevatedPrivileges();

  const canCreateDiscounts = hasPermission('pos.discounts.create') || hasElevatedPrivileges();
  const canEditDiscounts = hasPermission('pos.discounts.edit') || hasElevatedPrivileges();
  const canDeleteDiscounts = hasPermission('pos.discounts.delete') || hasElevatedPrivileges();
  const canToggleStatus = hasPermission('pos.discounts.toggle_status') || hasElevatedPrivileges();
  
  // Tax calculations hook for discount validation and preview
  const {
    taxCategories,
    categoryTaxAssignments,
    categories,
    calculateItemTax,
    calculateTotalTax,
    getItemTaxes,
    getCategoryTaxes,
    loading: taxLoading,
    error: taxError
  } = useTaxCalculations(selectedBusinessId);

  const [discounts, setDiscounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [previewCart, setPreviewCart] = useState([]);

  // New discount form
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('percentage');
  const [newValue, setNewValue] = useState('');
  const [newApplicationType, setNewApplicationType] = useState('transaction');
  const [newAutoApply, setNewAutoApply] = useState(false);
  const [newManagerRequired, setNewManagerRequired] = useState(false);
  const [newValidFrom, setNewValidFrom] = useState('');
  const [newValidTo, setNewValidTo] = useState('');
  const [newMinPurchase, setNewMinPurchase] = useState('');
  const [newMaxUses, setNewMaxUses] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newTaxExempt, setNewTaxExempt] = useState(false);
  const [newCombineWithOthers, setNewCombineWithOthers] = useState(true);
  const [newApplyBeforeTax, setNewApplyBeforeTax] = useState(true);

  // Edit discount form
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('percentage');
  const [editValue, setEditValue] = useState('');
  const [editApplicationType, setEditApplicationType] = useState('transaction');
  const [editAutoApply, setEditAutoApply] = useState(false);
  const [editManagerRequired, setEditManagerRequired] = useState(false);
  const [editValidFrom, setEditValidFrom] = useState('');
  const [editValidTo, setEditValidTo] = useState('');
  const [editMinPurchase, setEditMinPurchase] = useState('');
  const [editMaxUses, setEditMaxUses] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editTaxExempt, setEditTaxExempt] = useState(false);
  const [editCombineWithOthers, setEditCombineWithOthers] = useState(true);
  const [editApplyBeforeTax, setEditApplyBeforeTax] = useState(true);

  useEffect(() => {
    if (selectedBusinessId && canViewDiscounts) {
      fetchDiscounts();
      loadPreviewCart();
    }
  }, [selectedBusinessId, canViewDiscounts]);

  // Load sample cart items for discount preview calculations
  const loadPreviewCart = async () => {
    try {
      await logSecurityEvent('discount_preview_loaded', {
        action: 'load_preview_cart',
        business_id: selectedBusinessId
      }, 'low');

      const { data: products, error } = await supabase
        .from('pos_products')
        .select('id, name, price, category_id')
        .eq('business_id', selectedBusinessId)
        .eq('is_active', true)
        .limit(3);

      if (error) throw error;

      const sampleCart = products?.map(product => ({
        id: product.id,
        name: product.name,
        price: Number(product.price),
        quantity: 1,
        category_id: product.category_id,
        modifiers: []
      })) || [];

      setPreviewCart(sampleCart);
    } catch (err) {
      await logSecurityEvent('discount_preview_error', {
        error: err.message,
        business_id: selectedBusinessId
      }, 'low');
      
      // Set a fallback sample cart for preview
      setPreviewCart([
        { id: 'sample1', name: 'Sample Item 1', price: 10.00, quantity: 1, category_id: null, modifiers: [] },
        { id: 'sample2', name: 'Sample Item 2', price: 15.50, quantity: 1, category_id: null, modifiers: [] },
        { id: 'sample3', name: 'Sample Item 3', price: 8.75, quantity: 1, category_id: null, modifiers: [] }
      ]);
    }
  };

  const fetchDiscounts = async () => {
    if (!selectedBusinessId) return;

    setLoading(true);
    setError(null);
    try {
      await logSecurityEvent('discounts_accessed', {
        action: 'fetch_discounts',
        business_id: selectedBusinessId
      }, 'low');

      const { data, error } = await supabase
        .from('pos_discounts')
        .select('*')
        .eq('business_id', selectedBusinessId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDiscounts(data || []);

      await logAction({
        action: 'pos_discounts_loaded',
        context: 'POSDiscounts',
        metadata: { discount_count: data?.length || 0 }
      });

    } catch (err) {
      await logSecurityEvent('discounts_fetch_error', {
        error: err.message,
        business_id: selectedBusinessId
      }, 'medium');
      
      setError('Error fetching discounts: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Calculate discount impact with tax considerations
  const calculateDiscountPreview = (discount, cartItems = previewCart) => {
    if (!cartItems?.length) return { subtotal: 0, discountAmount: 0, taxAmount: 0, total: 0 };

    // Calculate subtotal
    const subtotal = cartItems.reduce((sum, item) => {
      const basePrice = Number(item.price) || 0;
      const modifiersTotal = item.modifiers?.reduce((mSum, mod) => {
        return mSum + (Number(mod.price) || 0);
      }, 0) || 0;
      return sum + ((basePrice + modifiersTotal) * (Number(item.quantity) || 1));
    }, 0);

    // Calculate discount amount
    let discountAmount = 0;
    if (discount.type === 'percentage') {
      discountAmount = subtotal * (Number(discount.value) / 100);
    } else if (discount.type === 'fixed') {
      discountAmount = Number(discount.value) || 0;
    }
    discountAmount = Math.min(discountAmount, subtotal);

    // Apply discount based on tax rules
    let taxableAmount = subtotal;
    if (discount.apply_before_tax) {
      taxableAmount = subtotal - discountAmount;
    }

    // Calculate tax on taxable amount using the tax hook
    let totalTax = 0;
    if (calculateTotalTax) {
      const taxResult = calculateTotalTax(cartItems, discount.apply_before_tax ? discountAmount : 0, 0, subtotal);
      totalTax = taxResult.totalTax;
    } else {
      // Fallback to 13% if hook not available
      totalTax = taxableAmount * 0.13;
    }

    let finalTotal;
    if (discount.apply_before_tax) {
      finalTotal = taxableAmount + totalTax;
    } else {
      finalTotal = subtotal + totalTax - discountAmount;
    }

    return {
      subtotal: subtotal,
      discountAmount: discountAmount,
      taxAmount: totalTax,
      total: Math.max(0, finalTotal),
      taxableAmount: taxableAmount
    };
  };

  const validateDiscountForm = (name, type, value, validFrom, validTo, minPurchase) => {
    // Validate input using security context
    const nameValidation = validateInput(name, 'text', 'discount_name');
    if (!nameValidation.valid) {
      return 'Invalid discount name';
    }
    
    if (!name.trim()) return 'Discount name is required';
    if (!value || parseFloat(value) <= 0) return 'Valid discount value is required';
    
    if (type === 'percentage' && parseFloat(value) > 100) {
      return 'Percentage discount cannot exceed 100%';
    }

    if (validFrom && validTo && new Date(validFrom) >= new Date(validTo)) {
      return 'Valid from date must be before valid to date';
    }

    if (minPurchase && parseFloat(minPurchase) < 0) {
      return 'Minimum purchase amount cannot be negative';
    }

    return null;
  };

  const addDiscount = async () => {
    if (!canCreateDiscounts) {
      setError('You do not have permission to create discounts');
      return;
    }

    // Rate limiting check
    const rateLimitCheck = await checkRateLimit('discount_create', 5, 60000);
    if (!rateLimitCheck.allowed) {
      setError('Too many discount creation attempts. Please wait a moment.');
      return;
    }

    const validationError = validateDiscountForm(
      newName, newType, newValue, newValidFrom, newValidTo, newMinPurchase
    );
    
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!selectedBusinessId) {
      setError('No business selected');
      return;
    }

    setError(null);
    try {
      const discountData = {
        business_id: selectedBusinessId,
        name: newName.trim(),
        type: newType,
        value: parseFloat(newValue),
        application_type: newApplicationType,
        auto_apply: newAutoApply,
        manager_required: newManagerRequired,
        valid_from: newValidFrom || null,
        valid_to: newValidTo || null,
        min_purchase_amount: newMinPurchase ? parseFloat(newMinPurchase) : null,
        max_uses: newMaxUses ? parseInt(newMaxUses) : null,
        current_uses: 0,
        description: newDescription.trim() || null,
        is_active: true,
        tax_exempt: newTaxExempt,
        combine_with_others: newCombineWithOthers,
        apply_before_tax: newApplyBeforeTax,
        created_at: new Date().toISOString()
      };

      const { error } = await supabase.from('pos_discounts').insert([discountData]);
      if (error) throw error;

      await logSecurityEvent('discount_created', {
        discount_name: newName.trim(),
        type: newType,
        value: parseFloat(newValue),
        auto_apply: newAutoApply,
        manager_required: newManagerRequired,
        tax_exempt: newTaxExempt,
        apply_before_tax: newApplyBeforeTax,
        business_id: selectedBusinessId,
        created_by: authUser?.id
      }, 'low');

      await logAction({
        action: 'pos_discount_created',
        context: 'POSDiscounts',
        metadata: {
          discount_name: newName.trim(),
          type: newType,
          value: parseFloat(newValue),
          auto_apply: newAutoApply,
          manager_required: newManagerRequired,
          tax_exempt: newTaxExempt,
          apply_before_tax: newApplyBeforeTax
        }
      });

      // Reset form
      setNewName('');
      setNewType('percentage');
      setNewValue('');
      setNewApplicationType('transaction');
      setNewAutoApply(false);
      setNewManagerRequired(false);
      setNewValidFrom('');
      setNewValidTo('');
      setNewMinPurchase('');
      setNewMaxUses('');
      setNewDescription('');
      setNewTaxExempt(false);
      setNewCombineWithOthers(true);
      setNewApplyBeforeTax(true);

      await recordAction('discount_added', { discount_name: newName.trim() }, true);
      fetchDiscounts();
    } catch (err) {
      await logSecurityEvent('discount_create_error', {
        error: err.message,
        discount_name: newName.trim(),
        business_id: selectedBusinessId
      }, 'medium');
      
      setError('Error adding discount: ' + err.message);
    }
  };

  const startEdit = (discount) => {
    if (!canEditDiscounts) {
      setError('You do not have permission to edit discounts');
      return;
    }

    setEditId(discount.id);
    setEditName(discount.name);
    setEditType(discount.type);
    setEditValue(discount.value?.toString() || '');
    setEditApplicationType(discount.application_type || 'transaction');
    setEditAutoApply(discount.auto_apply || false);
    setEditManagerRequired(discount.manager_required || false);
    setEditValidFrom(discount.valid_from || '');
    setEditValidTo(discount.valid_to || '');
    setEditMinPurchase(discount.min_purchase_amount?.toString() || '');
    setEditMaxUses(discount.max_uses?.toString() || '');
    setEditDescription(discount.description || '');
    setEditIsActive(discount.is_active !== false);
    setEditTaxExempt(discount.tax_exempt || false);
    setEditCombineWithOthers(discount.combine_with_others !== false);
    setEditApplyBeforeTax(discount.apply_before_tax !== false);
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditName('');
    setEditType('percentage');
    setEditValue('');
    setEditApplicationType('transaction');
    setEditAutoApply(false);
    setEditManagerRequired(false);
    setEditValidFrom('');
    setEditValidTo('');
    setEditMinPurchase('');
    setEditMaxUses('');
    setEditDescription('');
    setEditIsActive(true);
    setEditTaxExempt(false);
    setEditCombineWithOthers(true);
    setEditApplyBeforeTax(true);
  };

  const saveEdit = async () => {
    if (!canEditDiscounts) {
      setError('You do not have permission to edit discounts');
      return;
    }

    // Rate limiting check
    const rateLimitCheck = await checkRateLimit('discount_edit', 10, 60000);
    if (!rateLimitCheck.allowed) {
      setError('Too many edit attempts. Please wait a moment.');
      return;
    }

    const validationError = validateDiscountForm(
      editName, editType, editValue, editValidFrom, editValidTo, editMinPurchase
    );
    
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    try {
      const discountData = {
        name: editName.trim(),
        type: editType,
        value: parseFloat(editValue),
        application_type: editApplicationType,
        auto_apply: editAutoApply,
        manager_required: editManagerRequired,
        valid_from: editValidFrom || null,
        valid_to: editValidTo || null,
        min_purchase_amount: editMinPurchase ? parseFloat(editMinPurchase) : null,
        max_uses: editMaxUses ? parseInt(editMaxUses) : null,
        description: editDescription.trim() || null,
        is_active: editIsActive,
        tax_exempt: editTaxExempt,
        combine_with_others: editCombineWithOthers,
        apply_before_tax: editApplyBeforeTax,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('pos_discounts')
        .update(discountData)
        .eq('id', editId);

      if (error) throw error;

      await logSecurityEvent('discount_updated', {
        discount_id: editId,
        discount_name: editName.trim(),
        is_active: editIsActive,
        tax_exempt: editTaxExempt,
        apply_before_tax: editApplyBeforeTax,
        business_id: selectedBusinessId,
        updated_by: authUser?.id
      }, 'low');

      await logAction({
        action: 'pos_discount_updated',
        context: 'POSDiscounts',
        metadata: {
          discount_id: editId,
          discount_name: editName.trim(),
          is_active: editIsActive,
          tax_exempt: editTaxExempt,
          apply_before_tax: editApplyBeforeTax
        }
      });

      await recordAction('discount_updated', { discount_id: editId, discount_name: editName.trim() }, true);
      cancelEdit();
      fetchDiscounts();
    } catch (err) {
      await logSecurityEvent('discount_update_error', {
        error: err.message,
        discount_id: editId,
        business_id: selectedBusinessId
      }, 'medium');
      
      setError('Error updating discount: ' + err.message);
    }
  };

  const deleteDiscount = async (id, name) => {
    if (!canDeleteDiscounts) {
      setError('You do not have permission to delete discounts');
      return;
    }

    if (!window.confirm(`Delete discount "${name}"? This action cannot be undone.`)) return;
    
    setError(null);
    try {
      const { error } = await supabase.from('pos_discounts').delete().eq('id', id);
      if (error) throw error;

      await logSecurityEvent('discount_deleted', {
        discount_id: id,
        discount_name: name,
        business_id: selectedBusinessId,
        deleted_by: authUser?.id
      }, 'medium');

      await logAction({
        action: 'pos_discount_deleted',
        context: 'POSDiscounts',
        metadata: { discount_id: id, discount_name: name }
      });

      await recordAction('discount_deleted', { discount_id: id, discount_name: name }, true);
      fetchDiscounts();
    } catch (err) {
      await logSecurityEvent('discount_delete_error', {
        error: err.message,
        discount_id: id,
        business_id: selectedBusinessId
      }, 'medium');
      
      setError('Error deleting discount: ' + err.message);
    }
  };

  const toggleDiscountStatus = async (id, currentStatus, name) => {
    if (!canToggleStatus) {
      setError('You do not have permission to toggle discount status');
      return;
    }

    const newStatus = !currentStatus;
    
    setError(null);
    try {
      const { error } = await supabase
        .from('pos_discounts')
        .update({ 
          is_active: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (error) throw error;

      await logSecurityEvent('discount_status_changed', {
        discount_id: id,
        discount_name: name,
        old_status: currentStatus,
        new_status: newStatus,
        business_id: selectedBusinessId,
        changed_by: authUser?.id
      }, 'low');

      await logAction({
        action: 'pos_discount_status_changed',
        context: 'POSDiscounts',
        metadata: {
          discount_id: id,
          discount_name: name,
          old_status: currentStatus,
          new_status: newStatus
        }
      });

      await recordAction('discount_status_toggled', { discount_id: id, new_status: newStatus }, true);
      fetchDiscounts();
    } catch (err) {
      await logSecurityEvent('discount_status_change_error', {
        error: err.message,
        discount_id: id,
        business_id: selectedBusinessId
      }, 'medium');
      
      setError('Error updating discount status: ' + err.message);
    }
  };

  const getDiscountSummary = (discount) => {
    const parts = [];
    
    if (discount.type === 'percentage') {
      parts.push(`${discount.value}% off`);
    } else {
      parts.push(`$${discount.value?.toFixed(2) || '0.00'} off`);
    }

    if (discount.application_type === 'item') {
      parts.push('per item');
    } else {
      parts.push('total order');
    }

    if (discount.min_purchase_amount) {
      parts.push(`(min $${discount.min_purchase_amount.toFixed(2)})`);
    }

    // Add tax information
    if (discount.tax_exempt) {
      parts.push('• Tax exempt');
    }
    if (discount.apply_before_tax) {
      parts.push('• Before tax');
    } else {
      parts.push('• After tax');
    }

    return parts.join(' ');
  };

  const getDateStatus = (discount) => {
    const now = new Date();
    const validFrom = discount.valid_from ? new Date(discount.valid_from) : null;
    const validTo = discount.valid_to ? new Date(discount.valid_to) : null;

    if (validFrom && now < validFrom) {
      return { text: 'Not yet active', color: TavariStyles.colors.warning, icon: '⏳' };
    }

    if (validTo && now > validTo) {
      return { text: 'Expired', color: TavariStyles.colors.danger, icon: '❌' };
    }

    if (validFrom && validTo) {
      return { text: 'Active', color: TavariStyles.colors.success, icon: '✅' };
    }

    return { text: 'Always active', color: TavariStyles.colors.success, icon: '♾️' };
  };

  const getUsageStatus = (discount) => {
    if (!discount.max_uses) return null;
    
    const remaining = discount.max_uses - (discount.current_uses || 0);
    const percentage = ((discount.current_uses || 0) / discount.max_uses) * 100;
    
    let color = TavariStyles.colors.success;
    if (percentage > 80) color = TavariStyles.colors.danger;
    else if (percentage > 60) color = TavariStyles.colors.warning;

    return {
      text: `${remaining} uses remaining`,
      color,
      percentage
    };
  };

  // Create styles using TavariStyles
  const styles = {
    container: TavariStyles.layout.container,
    
    header: {
      marginBottom: TavariStyles.spacing['2xl'],
      textAlign: 'center'
    },
    
    errorBanner: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error
    },
    
    loading: TavariStyles.components.loading.container,
    
    noAccessContainer: {
      padding: TavariStyles.spacing['3xl'],
      textAlign: 'center'
    },

    noAccessText: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600,
      margin: 0
    },
    
    previewToggle: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.xl,
      backgroundColor: TavariStyles.colors.gray50,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    
    previewContent: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.lg,
      marginTop: TavariStyles.spacing.lg
    },
    
    previewCard: {
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray300}`
    },
    
    addSection: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing['2xl'],
      border: `2px solid ${TavariStyles.colors.primary}`
    },
    
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xl,
      paddingBottom: TavariStyles.spacing.md,
      borderBottom: `2px solid ${TavariStyles.colors.primary}`
    },
    
    form: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xl
    },
    
    formRow: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.lg,
      alignItems: 'end'
    },
    
    formGroup: {
      display: 'flex',
      flexDirection: 'column'
    },
    
    label: TavariStyles.components.form.label,
    input: TavariStyles.components.form.input,
    select: TavariStyles.components.form.select,
    
    textarea: {
      ...TavariStyles.components.form.input,
      fontFamily: 'inherit',
      resize: 'vertical'
    },
    
    checkboxGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
      gap: TavariStyles.spacing.lg,
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    
    checkboxGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },
    
    checkboxGroupTitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.xs
    },
    
    addButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg,
      alignSelf: 'flex-start'
    },
    
    tableContainer: TavariStyles.components.table.container,
    table: TavariStyles.components.table.table,
    
    headerRow: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    },
    
    th: {
      ...TavariStyles.components.table.th,
      color: TavariStyles.colors.white,
      borderBottom: `2px solid ${TavariStyles.colors.primaryDark}`
    },
    
    row: TavariStyles.components.table.row,
    td: TavariStyles.components.table.td,
    
    emptyCell: {
      padding: TavariStyles.spacing['4xl'],
      textAlign: 'center',
      color: TavariStyles.colors.gray500,
      fontStyle: 'italic'
    },
    
    statusCell: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.md
    },
    
    statusIndicator: {
      width: '12px',
      height: '12px',
      borderRadius: TavariStyles.borderRadius.full
    },
    
    statusLabels: {
      display: 'flex',
      flexDirection: 'column',
      gap: '2px'
    },
    
    statusLabel: {
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800
    },
    
    dateStatusLabel: {
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.normal
    },
    
    nameSection: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    
    discountName: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800
    },
    
    discountDescription: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      fontStyle: 'italic'
    },
    
    discountSummary: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray700
    },
    
    taxInfo: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.primary,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginTop: TavariStyles.spacing.xs
    },
    
    valueDisplay: {
      textAlign: 'center'
    },
    
    discountValue: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary
    },
    
    applicationType: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      marginTop: '2px'
    },
    
    editSection: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },
    
    smallInput: {
      ...TavariStyles.components.form.input,
      padding: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.xs
    },
    
    smallSelect: {
      ...TavariStyles.components.form.select,
      padding: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.xs
    },
    
    smallTextarea: {
      ...TavariStyles.components.form.input,
      padding: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.xs,
      fontFamily: 'inherit',
      resize: 'vertical'
    },
    
    rulesDisplay: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },
    
    rulesList: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    
    rule: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray700
    },
    
    usageStatus: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    
    usageText: {
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.bold
    },
    
    usageBar: {
      width: '100%',
      height: '4px',
      backgroundColor: TavariStyles.colors.gray200,
      borderRadius: TavariStyles.borderRadius.sm,
      overflow: 'hidden'
    },
    
    usageProgress: {
      height: '100%',
      transition: TavariStyles.transitions.normal
    },
    
    datesDisplay: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    
    dateInfo: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray700
    },
    
    actions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      flexWrap: 'wrap'
    },
    
    editButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.sm
    },
    
    toggleButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.sizes.sm,
      color: TavariStyles.colors.white
    },
    
    deleteButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.danger,
      ...TavariStyles.components.button.sizes.sm
    },
    
    saveButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.success,
      ...TavariStyles.components.button.sizes.sm
    },
    
    cancelButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.ghost,
      ...TavariStyles.components.button.sizes.sm
    },
    
    previewButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.sm
    },
    
    infoPanel: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl
    },
    
    infoTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.lg,
      textAlign: 'center'
    },
    
    infoGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: TavariStyles.spacing.lg
    },
    
    infoCard: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.lg,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    
    infoIcon: {
      fontSize: '24px',
      minWidth: '32px'
    },
    
    infoContent: {
      flex: 1
    },
    
    infoLabel: {
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xs
    },
    
    infoText: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      lineHeight: TavariStyles.typography.lineHeight.relaxed
    }
  };

  if (loading || permissionsLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading discounts...</div>
      </div>
    );
  }

  // Check overall access permission
  if (!canViewDiscounts) {
    return (
      <div style={styles.container}>
        <div style={styles.noAccessContainer}>
          <h3 style={styles.errorBanner}>Access Denied</h3>
          <p style={styles.noAccessText}>
            You do not have permission to view discounts.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2>POS Discounts</h2>
        <p>Create and manage promotional discounts with advanced rules and tax integration</p>
      </div>

      {error && <div style={styles.errorBanner}>{error}</div>}
      {taxError && <div style={styles.errorBanner}>Tax System Error: {taxError}</div>}

      {/* Discount Preview Toggle */}
      <div style={styles.previewToggle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: TavariStyles.spacing.md }}>
          <h3>Discount Preview Calculator</h3>
          <button 
            onClick={() => setPreviewMode(!previewMode)}
            style={styles.previewButton}
          >
            {previewMode ? 'Hide Preview' : 'Show Preview'}
          </button>
        </div>
        
        {previewMode && previewCart.length > 0 && (
          <div style={styles.previewContent}>
            <div style={styles.previewCard}>
              <h4>Sample Cart</h4>
              {previewCart.map(item => (
                <div key={item.id} style={{ fontSize: TavariStyles.typography.fontSize.sm, marginBottom: TavariStyles.spacing.xs }}>
                  {item.name} - ${Number(item.price).toFixed(2)}
                </div>
              ))}
            </div>
            
            {discounts.filter(d => d.is_active).slice(0, 3).map(discount => {
              const preview = calculateDiscountPreview(discount);
              return (
                <div key={discount.id} style={styles.previewCard}>
                  <h4>{discount.name}</h4>
                  <div style={{ fontSize: TavariStyles.typography.fontSize.xs }}>
                    <div>Subtotal: ${preview.subtotal.toFixed(2)}</div>
                    <div style={{ color: TavariStyles.colors.danger }}>
                      Discount: -${preview.discountAmount.toFixed(2)}
                    </div>
                    <div>Tax: ${preview.taxAmount.toFixed(2)}</div>
                    <div style={{ fontWeight: TavariStyles.typography.fontWeight.bold }}>
                      Total: ${preview.total.toFixed(2)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add New Discount */}
      {canCreateDiscounts && (
        <PermissionGate
          permissions={['pos.discounts.create']}
          requireElevated
          fallback={
            <div style={styles.noAccessContainer}>
              <p style={styles.noAccessText}>
                ⚠️ You do not have permission to create discounts (requires manager/owner)
              </p>
            </div>
          }
        >
          <div style={styles.addSection}>
            <h3 style={styles.sectionTitle}>Add New Discount</h3>
            <div style={styles.form}>
              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Discount Name *</label>
                  <input
                    type="text"
                    placeholder="e.g., Senior Discount, Happy Hour"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    style={styles.input}
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Type *</label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    style={styles.select}
                  >
                    <option value="percentage">Percentage</option>
                    <option value="fixed">Fixed Amount</option>
                  </select>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>
                    Value * {newType === 'percentage' ? '(%)' : '($)'}
                  </label>
                  <input
                    type="number"
                    placeholder={newType === 'percentage' ? '10' : '5.00'}
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    style={styles.input}
                    step={newType === 'percentage' ? '1' : '0.01'}
                    min="0"
                    max={newType === 'percentage' ? '100' : undefined}
                  />
                </div>
              </div>

              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Apply To</label>
                  <select
                    value={newApplicationType}
                    onChange={(e) => setNewApplicationType(e.target.value)}
                    style={styles.select}
                  >
                    <option value="transaction">Entire Transaction</option>
                    <option value="item">Per Item</option>
                  </select>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Minimum Purchase ($)</label>
                  <input
                    type="number"
                    placeholder="0.00 = no minimum"
                    value={newMinPurchase}
                    onChange={(e) => setNewMinPurchase(e.target.value)}
                    style={styles.input}
                    step="0.01"
                    min="0"
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Maximum Uses</label>
                  <input
                    type="number"
                    placeholder="Leave blank = unlimited"
                    value={newMaxUses}
                    onChange={(e) => setNewMaxUses(e.target.value)}
                    style={styles.input}
                    min="1"
                  />
                </div>
              </div>

              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Valid From (Optional)</label>
                  <input
                    type="date"
                    value={newValidFrom}
                    onChange={(e) => setNewValidFrom(e.target.value)}
                    style={styles.input}
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Valid To (Optional)</label>
                  <input
                    type="date"
                    value={newValidTo}
                    onChange={(e) => setNewValidTo(e.target.value)}
                    style={styles.input}
                  />
                </div>
              </div>

              <div style={styles.formRow}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Description (Optional)</label>
                  <textarea
                    placeholder="Additional details about this discount..."
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    style={styles.textarea}
                    rows="2"
                  />
                </div>
              </div>

              <div style={styles.checkboxGrid}>
                <div style={styles.checkboxGroup}>
                  <div style={styles.checkboxGroupTitle}>Application Rules</div>
                  <TavariCheckbox
                    checked={newAutoApply}
                    onChange={(checked) => setNewAutoApply(checked)}
                    label="Auto-apply when conditions are met"
                    size="md"
                  />
                  <TavariCheckbox
                    checked={newManagerRequired}
                    onChange={(checked) => setNewManagerRequired(checked)}
                    label="Require manager approval"
                    size="md"
                  />
                  <TavariCheckbox
                    checked={newCombineWithOthers}
                    onChange={(checked) => setNewCombineWithOthers(checked)}
                    label="Can combine with other discounts"
                    size="md"
                  />
                </div>

                <div style={styles.checkboxGroup}>
                  <div style={styles.checkboxGroupTitle}>Tax Behavior</div>
                  <TavariCheckbox
                    checked={newApplyBeforeTax}
                    onChange={(checked) => setNewApplyBeforeTax(checked)}
                    label="Apply discount before tax calculation"
                    size="md"
                  />
                  <TavariCheckbox
                    checked={newTaxExempt}
                    onChange={(checked) => setNewTaxExempt(checked)}
                    label="Discount is tax exempt (reduces taxable amount)"
                    size="md"
                  />
                </div>
              </div>

              <button 
                onClick={addDiscount}
                style={styles.addButton}
                disabled={!newName.trim() || !newValue}
              >
                Add Discount
              </button>
            </div>
          </div>
        </PermissionGate>
      )}

      {/* Discounts Table */}
      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr style={styles.headerRow}>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Name & Details</th>
              <th style={styles.th}>Value & Tax</th>
              <th style={styles.th}>Rules & Usage</th>
              <th style={styles.th}>Dates</th>
              <th style={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {discounts.length === 0 && (
              <tr>
                <td colSpan="6" style={styles.emptyCell}>
                  No discounts found. {canCreateDiscounts ? 'Create your first discount above.' : 'No discounts available.'}
                </td>
              </tr>
            )}
            {discounts.map((discount, i) => {
              const dateStatus = getDateStatus(discount);
              const usageStatus = getUsageStatus(discount);
              
              return (
                <tr key={discount.id} style={{
                  ...styles.row,
                  backgroundColor: i % 2 === 0 ? TavariStyles.colors.gray50 : TavariStyles.colors.white,
                  opacity: !discount.is_active ? 0.6 : 1
                }}>
                  <td style={styles.td}>
                    <div style={styles.statusCell}>
                      <div
                        style={{
                          ...styles.statusIndicator,
                          backgroundColor: discount.is_active ? TavariStyles.colors.success : TavariStyles.colors.danger
                        }}
                      />
                      <div style={styles.statusLabels}>
                        <div style={styles.statusLabel}>
                          {discount.is_active ? 'Active' : 'Inactive'}
                        </div>
                        <div style={{
                          ...styles.dateStatusLabel,
                          color: dateStatus.color
                        }}>
                          {dateStatus.icon} {dateStatus.text}
                        </div>
                      </div>
                    </div>
                  </td>
                  
                  <td style={styles.td}>
                    {editId === discount.id ? (
                      <div style={styles.editSection}>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          style={styles.smallInput}
                          placeholder="Discount name"
                        />
                        <textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          style={styles.smallTextarea}
                          placeholder="Description..."
                          rows="2"
                        />
                      </div>
                    ) : (
                      <div style={styles.nameSection}>
                        <div style={styles.discountName}>{discount.name}</div>
                        {discount.description && (
                          <div style={styles.discountDescription}>{discount.description}</div>
                        )}
                        <div style={styles.discountSummary}>
                          {getDiscountSummary(discount)}
                        </div>
                      </div>
                    )}
                  </td>
                  
                  <td style={styles.td}>
                    {editId === discount.id ? (
                      <div style={styles.editSection}>
                        <select
                          value={editType}
                          onChange={(e) => setEditType(e.target.value)}
                          style={styles.smallSelect}
                        >
                          <option value="percentage">%</option>
                          <option value="fixed">$</option>
                        </select>
                        <input
                          type="number"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          style={styles.smallInput}
                          step={editType === 'percentage' ? '1' : '0.01'}
                          min="0"
                          max={editType === 'percentage' ? '100' : undefined}
                        />
                        <select
                          value={editApplicationType}
                          onChange={(e) => setEditApplicationType(e.target.value)}
                          style={styles.smallSelect}
                        >
                          <option value="transaction">Total</option>
                          <option value="item">Per Item</option>
                        </select>
                        <div style={{ display: 'flex', gap: TavariStyles.spacing.xs, flexWrap: 'wrap' }}>
                          <TavariCheckbox
                            checked={editApplyBeforeTax}
                            onChange={(checked) => setEditApplyBeforeTax(checked)}
                            label="Before Tax"
                            size="sm"
                          />
                          <TavariCheckbox
                            checked={editTaxExempt}
                            onChange={(checked) => setEditTaxExempt(checked)}
                            label="Tax Exempt"
                            size="sm"
                          />
                        </div>
                      </div>
                    ) : (
                      <div style={styles.valueDisplay}>
                        <div style={styles.discountValue}>
                          {discount.type === 'percentage' 
                            ? `${discount.value}%` 
                            : `$${discount.value?.toFixed(2) || '0.00'}`
                          }
                        </div>
                        <div style={styles.applicationType}>
                          {discount.application_type === 'item' ? 'Per Item' : 'Total Order'}
                        </div>
                        <div style={styles.taxInfo}>
                          {discount.apply_before_tax ? 'Before Tax' : 'After Tax'}
                          {discount.tax_exempt && ' • Tax Exempt'}
                        </div>
                      </div>
                    )}
                  </td>
                  
                  <td style={styles.td}>
                    {editId === discount.id ? (
                      <div style={styles.editSection}>
                        <input
                          type="number"
                          value={editMinPurchase}
                          onChange={(e) => setEditMinPurchase(e.target.value)}
                          style={styles.smallInput}
                          placeholder="Min $"
                          step="0.01"
                          min="0"
                        />
                        <input
                          type="number"
                          value={editMaxUses}
                          onChange={(e) => setEditMaxUses(e.target.value)}
                          style={styles.smallInput}
                          placeholder="Max uses"
                          min="1"
                        />
                        <div style={{ display: 'flex', gap: TavariStyles.spacing.xs, flexWrap: 'wrap' }}>
                          <TavariCheckbox
                            checked={editAutoApply}
                            onChange={(checked) => setEditAutoApply(checked)}
                            label="Auto"
                            size="sm"
                          />
                          <TavariCheckbox
                            checked={editManagerRequired}
                            onChange={(checked) => setEditManagerRequired(checked)}
                            label="Mgr"
                            size="sm"
                          />
                          <TavariCheckbox
                            checked={editCombineWithOthers}
                            onChange={(checked) => setEditCombineWithOthers(checked)}
                            label="Stack"
                            size="sm"
                          />
                          <TavariCheckbox
                            checked={editIsActive}
                            onChange={(checked) => setEditIsActive(checked)}
                            label="Active"
                            size="sm"
                          />
                        </div>
                      </div>
                    ) : (
                      <div style={styles.rulesDisplay}>
                        <div style={styles.rulesList}>
                          {discount.min_purchase_amount && (
                            <div style={styles.rule}>
                              💰 Min: ${discount.min_purchase_amount.toFixed(2)}
                            </div>
                          )}
                          {discount.auto_apply && (
                            <div style={styles.rule}>⚡ Auto-apply</div>
                          )}
                          {discount.manager_required && (
                            <div style={styles.rule}>🔒 Manager required</div>
                          )}
                          {discount.combine_with_others && (
                            <div style={styles.rule}>🔗 Stackable</div>
                          )}
                        </div>
                        {usageStatus && (
                          <div style={styles.usageStatus}>
                            <div style={{
                              ...styles.usageText,
                              color: usageStatus.color
                            }}>
                              {usageStatus.text}
                            </div>
                            <div style={styles.usageBar}>
                              <div 
                                style={{
                                  ...styles.usageProgress,
                                  width: `${usageStatus.percentage}%`,
                                  backgroundColor: usageStatus.color
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  
                  <td style={styles.td}>
                    {editId === discount.id ? (
                      <div style={styles.editSection}>
                        <input
                          type="date"
                          value={editValidFrom}
                          onChange={(e) => setEditValidFrom(e.target.value)}
                          style={styles.smallInput}
                        />
                        <input
                          type="date"
                          value={editValidTo}
                          onChange={(e) => setEditValidTo(e.target.value)}
                          style={styles.smallInput}
                        />
                      </div>
                    ) : (
                      <div style={styles.datesDisplay}>
                        {discount.valid_from && (
                          <div style={styles.dateInfo}>
                            <strong>From:</strong> {new Date(discount.valid_from).toLocaleDateString()}
                          </div>
                        )}
                        {discount.valid_to && (
                          <div style={styles.dateInfo}>
                            <strong>To:</strong> {new Date(discount.valid_to).toLocaleDateString()}
                          </div>
                        )}
                        {!discount.valid_from && !discount.valid_to && (
                          <div style={styles.dateInfo}>Always active</div>
                        )}
                      </div>
                    )}
                  </td>
                  
                  <td style={styles.td}>
                    {editId === discount.id ? (
                      <div style={styles.actions}>
                        <button 
                          onClick={saveEdit} 
                          style={styles.saveButton}
                          disabled={!editName.trim() || !editValue}
                        >
                          Save
                        </button>
                        <button onClick={cancelEdit} style={styles.cancelButton}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={styles.actions}>
                        {canEditDiscounts && (
                          <button 
                            onClick={() => startEdit(discount)} 
                            style={styles.editButton}
                          >
                            Edit
                          </button>
                        )}
                        {canToggleStatus && (
                          <button
                            onClick={() => toggleDiscountStatus(discount.id, discount.is_active, discount.name)}
                            style={{
                              ...styles.toggleButton,
                              backgroundColor: discount.is_active ? TavariStyles.colors.warning : TavariStyles.colors.success
                            }}
                          >
                            {discount.is_active ? 'Disable' : 'Enable'}
                          </button>
                        )}
                        {canDeleteDiscounts && (
                          <button 
                            onClick={() => deleteDiscount(discount.id, discount.name)} 
                            style={styles.deleteButton}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Info Panel */}
      <div style={styles.infoPanel}>
        <h3 style={styles.infoTitle}>Advanced Discount Features</h3>
        <div style={styles.infoGrid}>
          <div style={styles.infoCard}>
            <div style={styles.infoIcon}>⚡</div>
            <div style={styles.infoContent}>
              <div style={styles.infoLabel}>Auto-Apply Logic</div>
              <div style={styles.infoText}>
                Automatically apply discounts when conditions are met (minimum purchase, date range, etc.)
              </div>
            </div>
          </div>
          
          <div style={styles.infoCard}>
            <div style={styles.infoIcon}>🔒</div>
            <div style={styles.infoContent}>
              <div style={styles.infoLabel}>Manager Approval</div>
              <div style={styles.infoText}>
                Require manager PIN entry before applying sensitive discounts
              </div>
            </div>
          </div>
          
          <div style={styles.infoCard}>
            <div style={styles.infoIcon}>🧮</div>
            <div style={styles.infoContent}>
              <div style={styles.infoLabel}>Tax Integration</div>
              <div style={styles.infoText}>
                Configure whether discounts apply before or after tax calculation with full tax system compatibility
              </div>
            </div>
          </div>
          
          <div style={styles.infoCard}>
            <div style={styles.infoIcon}>🔗</div>
            <div style={styles.infoContent}>
              <div style={styles.infoLabel}>Discount Stacking</div>
              <div style={styles.infoText}>
                Control which discounts can be combined with others for flexible promotional strategies
              </div>
            </div>
          </div>
          
          <div style={styles.infoCard}>
            <div style={styles.infoIcon}>📅</div>
            <div style={styles.infoContent}>
              <div style={styles.infoLabel}>Date Validation</div>
              <div style={styles.infoText}>
                Set valid date ranges for promotional periods and seasonal discounts
              </div>
            </div>
          </div>
          
          <div style={styles.infoCard}>
            <div style={styles.infoIcon}>🎯</div>
            <div style={styles.infoContent}>
              <div style={styles.infoLabel}>Usage Limits</div>
              <div style={styles.infoText}>
                Control discount usage with maximum use counts and minimum purchase amounts
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Main component with authentication wrapper
const POSDiscounts = () => {
  const [authState, setAuthState] = useState(null);

  return (
    <SecurityWrapper>
      <POSAuthWrapper
        componentName="POS Discounts"
        requiredRoles={['owner', 'manager', 'employee']}
        requireBusiness={true}
        onAuthReady={setAuthState}
      >
        {authState && <POSDiscountsContent authState={authState} />}
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default POSDiscounts;