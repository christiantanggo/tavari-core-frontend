// src/screens/POS/POSModifiers.jsx - Simplified modifier groups with automatic item addition
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { logAction } from '../../helpers/posAudit';

// Foundation imports
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';
import { SecurityWrapper } from '../../Security';
import { useSecurityContext } from '../../Security';

const POSModifiers = () => {
  const navigate = useNavigate();

  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'POSModifiers'
  });

  // Security context for modifier operations
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'POSModifiers',
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
  const canViewModifiers = hasAnyPermission([
    'pos.modifiers.view',
    'pos.modifiers.create',
    'pos.modifiers.edit'
  ]) || hasElevatedPrivileges();

  const canCreateModifiers = hasPermission('pos.modifiers.create') || hasElevatedPrivileges();
  const canEditModifiers = hasPermission('pos.modifiers.edit') || hasElevatedPrivileges();
  const canDeleteModifiers = hasPermission('pos.modifiers.delete') || hasElevatedPrivileges();
  const canManageItems = hasPermission('pos.modifiers.manage_items') || hasElevatedPrivileges();

  // State
  const [modifierGroups, setModifierGroups] = useState([]);
  const [categories, setCategories] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Form states for new group
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupRequired, setNewGroupRequired] = useState(false);
  const [newGroupMinSelections, setNewGroupMinSelections] = useState('');
  const [newGroupMaxSelections, setNewGroupMaxSelections] = useState('');
  const [newGroupMaxFree, setNewGroupMaxFree] = useState('');

  // Edit group states
  const [editGroupId, setEditGroupId] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupRequired, setEditGroupRequired] = useState(false);
  const [editGroupMinSelections, setEditGroupMinSelections] = useState('');
  const [editGroupMaxSelections, setEditGroupMaxSelections] = useState('');
  const [editGroupMaxFree, setEditGroupMaxFree] = useState('');

  // States for adding items to groups
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [selectedInventoryId, setSelectedInventoryId] = useState('');
  const [addItemType, setAddItemType] = useState('existing');
  const [priceOverride, setPriceOverride] = useState('');

  // States for creating new inventory items
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [newInventoryName, setNewInventoryName] = useState('');
  const [newInventoryPrice, setNewInventoryPrice] = useState('');
  const [newInventoryCost, setNewInventoryCost] = useState('');
  const [newInventorySKU, setNewInventorySKU] = useState('');
  const [newInventoryCategory, setNewInventoryCategory] = useState('');
  const [newInventoryTrackStock, setNewInventoryTrackStock] = useState(false);

  // Expanded groups for showing items
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  // Load data when authenticated
  useEffect(() => {
    if (auth.selectedBusinessId && auth.authUser && canViewModifiers) {
      fetchModifierGroups();
      fetchCategories();
      fetchInventoryItems();
    }
  }, [auth.selectedBusinessId, auth.authUser, canViewModifiers]);

  const fetchModifierGroups = async () => {
    if (!auth.selectedBusinessId) return;

    setLoading(true);
    setError(null);
    try {
      await logSecurityEvent('modifiers_accessed', {
        action: 'fetch_modifier_groups',
        business_id: auth.selectedBusinessId
      }, 'low');

      const { data, error } = await supabase
        .from('pos_modifier_groups')
        .select(`
          *,
          pos_modifier_group_items (
            id,
            inventory_id,
            price_override,
            is_free,
            is_default_selected,
            sort_order,
            pos_inventory (
              id,
              name,
              price,
              cost
            )
          )
        `)
        .eq('business_id', auth.selectedBusinessId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      setModifierGroups(data || []);

      await logAction({
        action: 'pos_modifier_groups_loaded',
        context: 'POSModifiers',
        metadata: { group_count: data?.length || 0 }
      });

    } catch (err) {
      await logSecurityEvent('modifiers_fetch_error', {
        error: err.message,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError('Error fetching modifier groups: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    if (!auth.selectedBusinessId) return;

    try {
      const { data, error } = await supabase
        .from('pos_categories')
        .select('id, name')
        .eq('business_id', auth.selectedBusinessId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      setCategories(data || []);
    } catch (err) {
      await logSecurityEvent('categories_fetch_error', {
        error: err.message,
        business_id: auth.selectedBusinessId
      }, 'low');
    }
  };

  const fetchInventoryItems = async () => {
    if (!auth.selectedBusinessId) return;

    try {
      const { data, error } = await supabase
        .from('pos_inventory')
        .select('id, name, price, cost, category_id')
        .eq('business_id', auth.selectedBusinessId)
        .order('name', { ascending: true });
      if (error) throw error;
      setInventoryItems(data || []);
    } catch (err) {
      await logSecurityEvent('inventory_fetch_error', {
        error: err.message,
        business_id: auth.selectedBusinessId
      }, 'low');
    }
  };

  const addModifierGroup = async () => {
    if (!canCreateModifiers) {
      setError('You do not have permission to create modifier groups');
      return;
    }

    // Validate input
    const nameValidation = validateInput(newGroupName, 'text', 'group_name');
    if (!nameValidation.valid || !newGroupName.trim()) {
      setError('Group name is required');
      return;
    }

    // Rate limiting check
    const rateLimitCheck = await checkRateLimit('modifier_group_create', 10, 60000);
    if (!rateLimitCheck.allowed) {
      setError('Too many creation attempts. Please wait a moment.');
      return;
    }

    const minSel = parseInt(newGroupMinSelections) || 0;
    const maxSel = parseInt(newGroupMaxSelections) || 0;
    const maxFree = parseInt(newGroupMaxFree) || 0;

    if (newGroupRequired && minSel === 0) {
      setError('Required groups must have minimum selections > 0');
      return;
    }

    setError(null);
    try {
      const maxSortOrder = modifierGroups.length > 0 ? Math.max(...modifierGroups.map(g => g.sort_order || 0)) : 0;

      const { error } = await supabase.from('pos_modifier_groups').insert([{
        business_id: auth.selectedBusinessId,
        name: newGroupName.trim(),
        is_required: newGroupRequired,
        min_selections: minSel || null,
        max_selections: maxSel || null,
        max_free_items: maxFree || null,
        sort_order: maxSortOrder + 1,
        is_active: true,
        created_at: new Date().toISOString()
      }]);

      if (error) throw error;

      await logSecurityEvent('modifier_group_created', {
        group_name: newGroupName.trim(),
        is_required: newGroupRequired,
        min_selections: minSel,
        max_selections: maxSel,
        max_free_items: maxFree,
        business_id: auth.selectedBusinessId,
        created_by: auth.authUser?.id
      }, 'low');

      await logAction({
        action: 'pos_modifier_group_created',
        context: 'POSModifiers',
        metadata: {
          group_name: newGroupName.trim(),
          is_required: newGroupRequired,
          min_selections: minSel,
          max_selections: maxSel,
          max_free_items: maxFree
        }
      });

      await recordAction('modifier_group_created', { group_name: newGroupName.trim() }, true);

      setNewGroupName('');
      setNewGroupRequired(false);
      setNewGroupMinSelections('');
      setNewGroupMaxSelections('');
      setNewGroupMaxFree('');
      fetchModifierGroups();
      showToast('Modifier group created successfully!', 'success');
    } catch (err) {
      await logSecurityEvent('modifier_group_create_error', {
        error: err.message,
        group_name: newGroupName,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError('Error adding modifier group: ' + err.message);
    }
  };

  const openEditModal = (group) => {
    if (!canEditModifiers) {
      setError('You do not have permission to edit modifier groups');
      return;
    }

    setEditGroupId(group.id);
    setEditGroupName(group.name);
    setEditGroupRequired(group.is_required || false);
    setEditGroupMinSelections(group.min_selections || '');
    setEditGroupMaxSelections(group.max_selections || '');
    setEditGroupMaxFree(group.max_free_items || '');
    setShowEditModal(true);
  };

  const updateModifierGroup = async () => {
    if (!canEditModifiers) {
      setError('You do not have permission to edit modifier groups');
      return;
    }

    // Validate input
    const nameValidation = validateInput(editGroupName, 'text', 'group_name');
    if (!nameValidation.valid || !editGroupName.trim()) {
      setError('Group name is required');
      return;
    }

    // Rate limiting check
    const rateLimitCheck = await checkRateLimit('modifier_group_update', 15, 60000);
    if (!rateLimitCheck.allowed) {
      setError('Too many update attempts. Please wait a moment.');
      return;
    }

    const minSel = parseInt(editGroupMinSelections) || 0;
    const maxSel = parseInt(editGroupMaxSelections) || 0;
    const maxFree = parseInt(editGroupMaxFree) || 0;

    if (editGroupRequired && minSel === 0) {
      setError('Required groups must have minimum selections > 0');
      return;
    }

    setError(null);
    try {
      const { error } = await supabase
        .from('pos_modifier_groups')
        .update({
          name: editGroupName.trim(),
          is_required: editGroupRequired,
          min_selections: minSel || null,
          max_selections: maxSel || null,
          max_free_items: maxFree || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', editGroupId);

      if (error) throw error;

      await logSecurityEvent('modifier_group_updated', {
        group_id: editGroupId,
        group_name: editGroupName.trim(),
        business_id: auth.selectedBusinessId,
        updated_by: auth.authUser?.id
      }, 'low');

      await logAction({
        action: 'pos_modifier_group_updated',
        context: 'POSModifiers',
        metadata: {
          group_id: editGroupId,
          group_name: editGroupName.trim()
        }
      });

      await recordAction('modifier_group_updated', { group_id: editGroupId }, true);

      setShowEditModal(false);
      setEditGroupId(null);
      fetchModifierGroups();
      showToast('Modifier group updated successfully!', 'success');
    } catch (err) {
      await logSecurityEvent('modifier_group_update_error', {
        error: err.message,
        group_id: editGroupId,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError('Error updating modifier group: ' + err.message);
    }
  };

  const toggleGroupExpanded = (groupId) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupId)) {
      newExpanded.delete(groupId);
    } else {
      newExpanded.add(groupId);
    }
    setExpandedGroups(newExpanded);
  };

  const createInventoryItem = async () => {
    if (!canManageItems) {
      setError('You do not have permission to create inventory items');
      return;
    }

    // Validate input
    const nameValidation = validateInput(newInventoryName, 'text', 'item_name');
    if (!nameValidation.valid || !newInventoryName.trim()) {
      setError('Item name is required');
      return;
    }

    const price = parseFloat(newInventoryPrice) || 0;
    const cost = parseFloat(newInventoryCost) || 0;

    if (price < 0 || cost < 0) {
      setError('Price and cost cannot be negative');
      return;
    }

    // Rate limiting check
    const rateLimitCheck = await checkRateLimit('inventory_create', 15, 60000);
    if (!rateLimitCheck.allowed) {
      setError('Too many creation attempts. Please wait a moment.');
      return;
    }

    setError(null);
    try {
      const { data: newItem, error } = await supabase
        .from('pos_inventory')
        .insert([{
          business_id: auth.selectedBusinessId,
          name: newInventoryName.trim(),
          price: price,
          cost: cost,
          sku: newInventorySKU.trim() || null,
          category_id: newInventoryCategory || null,
          track_stock: newInventoryTrackStock,
          stock_quantity: newInventoryTrackStock ? 0 : null,
          low_stock_threshold: newInventoryTrackStock ? 5 : null,
          is_modifier_item: true,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) throw error;

      await logSecurityEvent('inventory_item_created', {
        item_name: newInventoryName.trim(),
        price: price,
        cost: cost,
        created_for_modifier: true,
        business_id: auth.selectedBusinessId,
        created_by: auth.authUser?.id
      }, 'low');

      await logAction({
        action: 'pos_inventory_item_created',
        context: 'POSModifiers',
        metadata: {
          item_name: newInventoryName.trim(),
          price: price,
          cost: cost,
          created_for_modifier: true
        }
      });

      // Reset inventory form
      setNewInventoryName('');
      setNewInventoryPrice('');
      setNewInventoryCost('');
      setNewInventorySKU('');
      setNewInventoryCategory('');
      setNewInventoryTrackStock(false);
      setShowInventoryModal(false);

      await fetchInventoryItems();

      // Automatically add the new item to the modifier group
      const priceOverrideValue = parseFloat(priceOverride) || null;

      const { error: addError } = await supabase
        .from('pos_modifier_group_items')
        .insert([{
          modifier_group_id: selectedGroupId,
          inventory_id: newItem.id,
          price_override: priceOverrideValue,
          is_free: priceOverrideValue === 0,
          is_default_selected: false,
          is_active: true,
          sort_order: 1
        }]);

      if (addError) {
        setError('Item created but failed to add to group: ' + addError.message);
        return;
      }

      await logSecurityEvent('modifier_item_added', {
        group_id: selectedGroupId,
        item_name: newInventoryName.trim(),
        price_override: priceOverrideValue,
        auto_added: true,
        business_id: auth.selectedBusinessId,
        added_by: auth.authUser?.id
      }, 'low');

      await logAction({
        action: 'pos_modifier_item_added',
        context: 'POSModifiers',
        metadata: {
          group_id: selectedGroupId,
          item_name: newInventoryName.trim(),
          price_override: priceOverrideValue,
          auto_added: true
        }
      });

      await recordAction('modifier_item_created_and_added', { item_name: newInventoryName.trim() }, true);

      setShowAddItemModal(false);
      setSelectedGroupId(null);
      setPriceOverride('');
      fetchModifierGroups();
      setExpandedGroups(prev => new Set([...prev, selectedGroupId]));
      showToast('Inventory item created and added to modifier group!', 'success');
      
    } catch (err) {
      await logSecurityEvent('inventory_create_error', {
        error: err.message,
        item_name: newInventoryName,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError('Error creating inventory item: ' + err.message);
    }
  };

  const addItemToGroup = async () => {
    if (!canManageItems) {
      setError('You do not have permission to add items to modifier groups');
      return;
    }

    if (!selectedGroupId || !selectedInventoryId) {
      setError('Please select an inventory item');
      return;
    }

    // Rate limiting check
    const rateLimitCheck = await checkRateLimit('modifier_add_item', 20, 60000);
    if (!rateLimitCheck.allowed) {
      setError('Too many item additions. Please wait a moment.');
      return;
    }

    const priceOverrideValue = parseFloat(priceOverride) || null;

    setError(null);
    try {
      const { error } = await supabase
        .from('pos_modifier_group_items')
        .insert([{
          modifier_group_id: selectedGroupId,
          inventory_id: selectedInventoryId,
          price_override: priceOverrideValue,
          is_free: priceOverrideValue === 0,
          is_default_selected: false,
          is_active: true,
          sort_order: 1
        }]);

      if (error) throw error;

      const selectedItem = inventoryItems.find(item => item.id === selectedInventoryId);
      
      await logSecurityEvent('modifier_item_added', {
        group_id: selectedGroupId,
        item_name: selectedItem?.name,
        price_override: priceOverrideValue,
        business_id: auth.selectedBusinessId,
        added_by: auth.authUser?.id
      }, 'low');

      await logAction({
        action: 'pos_modifier_item_added',
        context: 'POSModifiers',
        metadata: {
          group_id: selectedGroupId,
          item_name: selectedItem?.name,
          price_override: priceOverrideValue
        }
      });

      await recordAction('modifier_item_added', { item_name: selectedItem?.name }, true);

      setSelectedInventoryId('');
      setPriceOverride('');
      setShowAddItemModal(false);
      setSelectedGroupId(null);
      
      fetchModifierGroups();
      setExpandedGroups(prev => new Set([...prev, selectedGroupId]));
      showToast('Item added to modifier group!', 'success');
    } catch (err) {
      await logSecurityEvent('modifier_add_item_error', {
        error: err.message,
        group_id: selectedGroupId,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError('Error adding item to group: ' + err.message);
    }
  };

  const deleteModifierGroup = async (groupId, groupName) => {
    if (!canDeleteModifiers) {
      setError('You do not have permission to delete modifier groups');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete modifier group "${groupName}" and all its items?`)) return;

    setError(null);
    try {
      await supabase
        .from('pos_modifier_group_items')
        .delete()
        .eq('modifier_group_id', groupId);

      const { error } = await supabase
        .from('pos_modifier_groups')
        .delete()
        .eq('id', groupId);

      if (error) throw error;

      await logSecurityEvent('modifier_group_deleted', {
        group_id: groupId,
        group_name: groupName,
        business_id: auth.selectedBusinessId,
        deleted_by: auth.authUser?.id
      }, 'medium');

      await logAction({
        action: 'pos_modifier_group_deleted',
        context: 'POSModifiers',
        metadata: { group_id: groupId, group_name: groupName }
      });

      await recordAction('modifier_group_deleted', { group_name: groupName }, true);

      fetchModifierGroups();
      showToast('Modifier group deleted successfully', 'success');
    } catch (err) {
      await logSecurityEvent('modifier_group_delete_error', {
        error: err.message,
        group_id: groupId,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError('Error deleting modifier group: ' + err.message);
    }
  };

  const removeItemFromGroup = async (groupItemId, itemName) => {
    if (!canManageItems) {
      setError('You do not have permission to remove items from modifier groups');
      return;
    }

    if (!window.confirm(`Remove "${itemName}" from this modifier group?`)) return;

    try {
      const { error } = await supabase
        .from('pos_modifier_group_items')
        .delete()
        .eq('id', groupItemId);

      if (error) throw error;

      await logSecurityEvent('modifier_item_removed', {
        group_item_id: groupItemId,
        item_name: itemName,
        business_id: auth.selectedBusinessId,
        removed_by: auth.authUser?.id
      }, 'low');

      await recordAction('modifier_item_removed', { item_name: itemName }, true);

      fetchModifierGroups();
      showToast('Item removed from group', 'success');
    } catch (err) {
      await logSecurityEvent('modifier_remove_item_error', {
        error: err.message,
        group_item_id: groupItemId,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError('Error removing item: ' + err.message);
    }
  };

  const showToast = (message, type = 'info') => {
    const toast = document.createElement('div');
    const bgColor = type === 'error' ? TavariStyles.colors.danger : 
                   type === 'success' ? TavariStyles.colors.success : 
                   TavariStyles.colors.primary;
    
    toast.style.cssText = `
      position: fixed;
      top: 120px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 6px;
      color: white;
      font-weight: bold;
      z-index: 1000;
      background-color: ${bgColor};
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      if (document.body.contains(toast)) {
        document.body.removeChild(toast);
      }
    }, 4000);
  };

  const styles = {
    container: TavariStyles.layout.container,
    
    header: {
      marginBottom: TavariStyles.spacing['2xl'],
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
    
    loading: TavariStyles.components.loading.container,
    
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
    
    addButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg,
      alignSelf: 'flex-start'
    },
    
    groupCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing.lg,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    
    groupHeader: {
      ...TavariStyles.layout.flexBetween,
      marginBottom: TavariStyles.spacing.lg,
      cursor: 'pointer'
    },
    
    groupName: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800
    },
    
    groupInfo: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.md
    },
    
    actionButtons: {
      display: 'flex',
      gap: TavariStyles.spacing.sm
    },
    
    smallButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.sm
    },

    editButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.sm
    },
    
    deleteButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.danger,
      ...TavariStyles.components.button.sizes.sm
    },

    expandButton: {
      backgroundColor: 'transparent',
      border: 'none',
      fontSize: TavariStyles.typography.fontSize.lg,
      cursor: 'pointer',
      color: TavariStyles.colors.primary,
      padding: TavariStyles.spacing.sm
    },
    
    itemsList: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
      gap: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.lg,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    
    itemCard: {
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: TavariStyles.shadows.sm
    },
    
    itemName: {
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xs
    },
    
    itemDetails: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.sm
    },
    
    removeButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.danger,
      ...TavariStyles.components.button.sizes.sm,
      fontSize: TavariStyles.typography.fontSize.xs
    },
    
    modal: {
      ...TavariStyles.components.modal.overlay
    },
    
    modalContent: {
      ...TavariStyles.components.modal.content,
      maxWidth: '600px'
    },
    
    modalHeader: TavariStyles.components.modal.header,
    modalBody: TavariStyles.components.modal.body,
    modalFooter: TavariStyles.components.modal.footer,
    
    createInventoryButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.success,
      ...TavariStyles.components.button.sizes.md,
      marginTop: TavariStyles.spacing.md
    },
    
    emptyState: {
      textAlign: 'center',
      padding: `${TavariStyles.spacing['6xl']} ${TavariStyles.spacing.xl}`,
      color: TavariStyles.colors.gray500
    },
    
    emptyIcon: {
      fontSize: '48px',
      marginBottom: TavariStyles.spacing.lg
    },
    
    emptyTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: TavariStyles.spacing.sm
    },

    noItems: {
      textAlign: 'center',
      padding: TavariStyles.spacing.lg,
      color: TavariStyles.colors.gray500,
      fontStyle: 'italic'
    },

    noAccessContainer: {
      padding: TavariStyles.spacing['3xl'],
      textAlign: 'center'
    },

    noAccessText: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600,
      margin: 0
    }
  };

  const loadingContent = (
    <div style={styles.container}>
      <div style={styles.loading}>Loading modifier management...</div>
    </div>
  );

  // Check overall access permission
  if (!loading && !permissionsLoading && !canViewModifiers) {
    return (
      <SecurityWrapper>
        <POSAuthWrapper
          requiredRoles={['employee', 'manager', 'owner']}
          requireBusiness={true}
          componentName="POSModifiers"
        >
          <div style={styles.container}>
            <div style={styles.noAccessContainer}>
              <h3 style={styles.errorBanner}>Access Denied</h3>
              <p style={styles.noAccessText}>
                You do not have permission to view modifiers.
              </p>
            </div>
          </div>
        </POSAuthWrapper>
      </SecurityWrapper>
    );
  }

  return (
    <SecurityWrapper>
      <POSAuthWrapper
        requiredRoles={['employee', 'manager', 'owner']}
        requireBusiness={true}
        componentName="POSModifiers"
        loadingContent={loadingContent}
      >
        <div style={styles.container}>
          <div style={styles.header}>
            <h2 style={styles.title}>POS Modifiers</h2>
            <p style={styles.subtitle}>Create modifier groups and add items for customer customization</p>
          </div>

          {error && <div style={styles.errorBanner}>{error}</div>}

          {/* Add New Modifier Group */}
          {canCreateModifiers && (
            <PermissionGate
              permissions={['pos.modifiers.create']}
              requireElevated
              fallback={
                <div style={styles.noAccessContainer}>
                  <p style={styles.noAccessText}>
                    ⚠️ You do not have permission to create modifier groups
                  </p>
                </div>
              }
            >
              <div style={styles.addSection}>
                <h3 style={styles.sectionTitle}>Create New Modifier Group</h3>
                <div style={styles.form}>
                  <div style={styles.formRow}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Group Name *</label>
                      <input
                        type="text"
                        placeholder="e.g., Size, Toppings, Drink Options"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        style={styles.input}
                      />
                    </div>
                  </div>

                  <div style={styles.formRow}>
                    <div style={styles.formGroup}>
                      <TavariCheckbox
                        checked={newGroupRequired}
                        onChange={(checked) => setNewGroupRequired(checked)}
                        label="Required Group (Customer must select)"
                        size="md"
                      />
                    </div>
                  </div>

                  <div style={styles.formRow}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Minimum Selections</label>
                      <input
                        type="number"
                        placeholder="0 = no minimum"
                        value={newGroupMinSelections}
                        onChange={(e) => setNewGroupMinSelections(e.target.value)}
                        style={styles.input}
                        min="0"
                      />
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Maximum Selections</label>
                      <input
                        type="number"
                        placeholder="0 = unlimited"
                        value={newGroupMaxSelections}
                        onChange={(e) => setNewGroupMaxSelections(e.target.value)}
                        style={styles.input}
                        min="0"
                      />
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Maximum Free Items</label>
                      <input
                        type="number"
                        placeholder="0 = none free"
                        value={newGroupMaxFree}
                        onChange={(e) => setNewGroupMaxFree(e.target.value)}
                        style={styles.input}
                        min="0"
                      />
                    </div>
                  </div>

                  <button 
                    onClick={addModifierGroup} 
                    style={styles.addButton}
                    disabled={!newGroupName.trim()}
                  >
                    Create Modifier Group
                  </button>
                </div>
              </div>
            </PermissionGate>
          )}

          {/* Modifier Groups List */}
          {loading || permissionsLoading ? (
            <div style={styles.loading}>Loading modifier groups...</div>
          ) : modifierGroups.length === 0 ? (
            <div style={styles.emptyState}>
              <div style={styles.emptyIcon}>📋</div>
              <div style={styles.emptyTitle}>No modifier groups found</div>
              <div style={{ fontSize: TavariStyles.typography.fontSize.base }}>
                Create your first modifier group above to get started
              </div>
            </div>
          ) : (
            modifierGroups.map(group => (
              <div key={group.id} style={styles.groupCard}>
                <div style={styles.groupHeader} onClick={() => toggleGroupExpanded(group.id)}>
                  <div>
                    <div style={styles.groupName}>
                      {group.name}
                      <button style={styles.expandButton}>
                        {expandedGroups.has(group.id) ? '−' : '+'}
                      </button>
                    </div>
                    <div style={styles.groupInfo}>
                      {group.is_required && 'Required • '}
                      {group.min_selections > 0 && `Min: ${group.min_selections} • `}
                      {group.max_selections > 0 && `Max: ${group.max_selections} • `}
                      {group.max_free_items > 0 && `${group.max_free_items} free items • `}
                      {group.pos_modifier_group_items?.length || 0} items
                    </div>
                  </div>
                  <div style={styles.actionButtons}>
                    {canEditModifiers && (
                      <button 
                        style={styles.editButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditModal(group);
                        }}
                      >
                        Edit Group
                      </button>
                    )}
                    {canManageItems && (
                      <button 
                        style={styles.smallButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedGroupId(group.id);
                          setShowAddItemModal(true);
                        }}
                      >
                        Add Items
                      </button>
                    )}
                    {canDeleteModifiers && (
                      <button 
                        style={styles.deleteButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteModifierGroup(group.id, group.name);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                {expandedGroups.has(group.id) && (
                  <div>
                    {group.pos_modifier_group_items && group.pos_modifier_group_items.length > 0 ? (
                      <div style={styles.itemsList}>
                        {group.pos_modifier_group_items.map(item => (
                          <div key={item.id} style={styles.itemCard}>
                            <div style={styles.itemName}>
                              {item.pos_inventory?.name || 'Unknown Item'}
                            </div>
                            <div style={styles.itemDetails}>
                              Price: {item.is_free ? 'Free' : 
                               item.price_override !== null ? `$${Number(item.price_override).toFixed(2)}` :
                               `$${Number(item.pos_inventory?.price || 0).toFixed(2)}`}
                              <br />
                              Cost: ${Number(item.pos_inventory?.cost || 0).toFixed(2)}
                            </div>
                            {canManageItems && (
                              <button
                                style={styles.removeButton}
                                onClick={() => removeItemFromGroup(item.id, item.pos_inventory?.name)}
                              >
                                Remove from Group
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={styles.noItems}>
                        No items in this group. {canManageItems ? 'Click "Add Items" to add some.' : ''}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}

          {/* Edit Group Modal */}
          {showEditModal && canEditModifiers && (
            <div style={styles.modal}>
              <div style={styles.modalContent}>
                <div style={styles.modalHeader}>
                  <h3 style={{ margin: 0 }}>Edit Modifier Group</h3>
                  <button 
                    style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer' }}
                    onClick={() => {
                      setShowEditModal(false);
                      setEditGroupId(null);
                    }}
                  >
                    ×
                  </button>
                </div>
                
                <div style={styles.modalBody}>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Group Name *</label>
                    <input
                      type="text"
                      value={editGroupName}
                      onChange={(e) => setEditGroupName(e.target.value)}
                      style={styles.input}
                    />
                  </div>

                  <div style={styles.formGroup}>
                    <TavariCheckbox
                      checked={editGroupRequired}
                      onChange={(checked) => setEditGroupRequired(checked)}
                      label="Required Group (Customer must select)"
                      size="md"
                    />
                  </div>

                  <div style={styles.formRow}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Minimum Selections</label>
                      <input
                        type="number"
                        value={editGroupMinSelections}
                        onChange={(e) => setEditGroupMinSelections(e.target.value)}
                        style={styles.input}
                        min="0"
                      />
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Maximum Selections</label>
                      <input
                        type="number"
                        value={editGroupMaxSelections}
                        onChange={(e) => setEditGroupMaxSelections(e.target.value)}
                        style={styles.input}
                        min="0"
                      />
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Maximum Free Items</label>
                      <input
                        type="number"
                        value={editGroupMaxFree}
                        onChange={(e) => setEditGroupMaxFree(e.target.value)}
                        style={styles.input}
                        min="0"
                      />
                    </div>
                  </div>
                </div>

                <div style={styles.modalFooter}>
                  <button
                    style={TavariStyles.components.button.variants.secondary}
                    onClick={() => {
                      setShowEditModal(false);
                      setEditGroupId(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    style={TavariStyles.components.button.variants.primary}
                    onClick={updateModifierGroup}
                    disabled={!editGroupName.trim()}
                  >
                    Update Group
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Add Item Modal */}
          {showAddItemModal && canManageItems && (
            <div style={styles.modal}>
              <div style={styles.modalContent}>
                <div style={styles.modalHeader}>
                  <h3 style={{ margin: 0 }}>Add Item to Modifier Group</h3>
                  <button 
                    style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer' }}
                    onClick={() => {
                      setShowAddItemModal(false);
                      setSelectedGroupId(null);
                      setSelectedInventoryId('');
                      setPriceOverride('');
                    }}
                  >
                    ×
                  </button>
                </div>
                
                <div style={styles.modalBody}>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Select Inventory Item *</label>
                    <select
                      value={selectedInventoryId}
                      onChange={(e) => setSelectedInventoryId(e.target.value)}
                      style={styles.select}
                    >
                      <option value="">-- Select Item --</option>
                      {inventoryItems.map(item => (
                        <option key={item.id} value={item.id}>
                          {item.name} - ${Number(item.price).toFixed(2)} (Cost: ${Number(item.cost || 0).toFixed(2)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    style={styles.createInventoryButton}
                    onClick={() => setShowInventoryModal(true)}
                  >
                    + Create New Inventory Item (Auto-adds to group)
                  </button>

                  <div style={styles.formGroup}>
                    <label style={styles.label}>Price Override (optional)</label>
                    <input
                      type="number"
                      placeholder="Leave blank to use item price"
                      value={priceOverride}
                      onChange={(e) => setPriceOverride(e.target.value)}
                      style={styles.input}
                      step="0.01"
                      min="0"
                    />
                  </div>
                </div>

                <div style={styles.modalFooter}>
                  <button
                    style={TavariStyles.components.button.variants.secondary}
                    onClick={() => {
                      setShowAddItemModal(false);
                      setSelectedGroupId(null);
                      setSelectedInventoryId('');
                      setPriceOverride('');
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    style={TavariStyles.components.button.variants.primary}
                    onClick={addItemToGroup}
                    disabled={!selectedInventoryId}
                  >
                    Add Item
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Create Inventory Item Modal */}
          {showInventoryModal && canManageItems && (
            <div style={styles.modal}>
              <div style={styles.modalContent}>
                <div style={styles.modalHeader}>
                  <h3 style={{ margin: 0 }}>Create New Inventory Item</h3>
                  <button 
                    style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer' }}
                    onClick={() => {
                      setShowInventoryModal(false);
                      setNewInventoryName('');
                      setNewInventoryPrice('');
                      setNewInventoryCost('');
                      setNewInventorySKU('');
                      setNewInventoryCategory('');
                      setNewInventoryTrackStock(false);
                    }}
                  >
                    ×
                  </button>
                </div>
                
                <div style={styles.modalBody}>
                  <div style={styles.formRow}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Item Name *</label>
                      <input
                        type="text"
                        placeholder="e.g., Small, Large, Extra Cheese"
                        value={newInventoryName}
                        onChange={(e) => setNewInventoryName(e.target.value)}
                        style={styles.input}
                      />
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Price *</label>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={newInventoryPrice}
                        onChange={(e) => setNewInventoryPrice(e.target.value)}
                        style={styles.input}
                        step="0.01"
                        min="0"
                      />
                    </div>
                  </div>

                  <div style={styles.formRow}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Cost</label>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={newInventoryCost}
                        onChange={(e) => setNewInventoryCost(e.target.value)}
                        style={styles.input}
                        step="0.01"
                        min="0"
                      />
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>SKU</label>
                      <input
                        type="text"
                        placeholder="Optional"
                        value={newInventorySKU}
                        onChange={(e) => setNewInventorySKU(e.target.value)}
                        style={styles.input}
                      />
                    </div>
                  </div>

                  <div style={styles.formRow}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Category</label>
                      <select
                        value={newInventoryCategory}
                        onChange={(e) => setNewInventoryCategory(e.target.value)}
                        style={styles.select}
                      >
                        <option value="">-- Select Category --</option>
                        {categories.map(cat => (
                          <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))}
                      </select>
                    </div>
                    <div style={styles.formGroup}>
                      <TavariCheckbox
                        checked={newInventoryTrackStock}
                        onChange={(checked) => setNewInventoryTrackStock(checked)}
                        label="Track Stock"
                        size="md"
                      />
                    </div>
                  </div>
                </div>

                <div style={styles.modalFooter}>
                  <button
                    style={TavariStyles.components.button.variants.secondary}
                    onClick={() => {
                      setShowInventoryModal(false);
                      setNewInventoryName('');
                      setNewInventoryPrice('');
                      setNewInventoryCost('');
                      setNewInventorySKU('');
                      setNewInventoryCategory('');
                      setNewInventoryTrackStock(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    style={TavariStyles.components.button.variants.primary}
                    onClick={createInventoryItem}
                    disabled={!newInventoryName.trim() || !newInventoryPrice}
                  >
                    Create & Add to Group
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

export default POSModifiers;