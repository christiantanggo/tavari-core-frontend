// src/screens/POS/POSInventory.jsx - FIXED: Allow $0.00 items + Liquor Item Tracking
import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../../supabaseClient';

const POS_PRODUCT_IMAGES_BUCKET = 'pos-product-images';
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
import { logAction } from '../../helpers/posAudit';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import POSInventoryManagementTabs from '../../components/POS/POSInventoryManagementTabs';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import { SecurityWrapper } from '../../Security';
import { useSecurityContext } from '../../Security';

const POSInventory = () => {
  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'POSInventory'
  });

  // Security context for inventory operations
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'POSInventory',
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

  // Permission checks: allow view if user has granular permission, elevated role, OR any POS role (route already requires employee/manager/owner)
  const canViewInventory = hasAnyPermission([
    'pos.inventory.view',
    'pos.inventory.create',
    'pos.inventory.edit'
  ]) || hasElevatedPrivileges() || (auth.isReady && auth.userRole && ['employee', 'manager', 'owner'].includes(auth.userRole));

  // Allow manager/owner full inventory actions when granular permissions aren't configured
  const canManageInventoryByRole = auth.isReady && auth.hasRole && (auth.hasRole('manager') || auth.hasRole('owner'));
  const canCreateInventory = hasPermission('pos.inventory.create') || hasElevatedPrivileges() || canManageInventoryByRole;
  const canEditInventory = hasPermission('pos.inventory.edit') || hasElevatedPrivileges() || canManageInventoryByRole;
  const canDeleteInventory = hasPermission('pos.inventory.delete') || hasElevatedPrivileges() || canManageInventoryByRole;
  const canManageStock = hasPermission('pos.inventory.manage_stock') || hasElevatedPrivileges() || canManageInventoryByRole;
  const canViewCost = hasPermission('pos.inventory.view_cost') || hasElevatedPrivileges() || canManageInventoryByRole;

  // Data state
  const [inventory, setInventory] = useState([]);
  const [categories, setCategories] = useState([]);
  const [folderParentOptions, setFolderParentOptions] = useState([]);
  const [folderChildCount, setFolderChildCount] = useState(0);
  const [stations, setStations] = useState([]);
  const [taxCategories, setTaxCategories] = useState([]);
  const [modifierGroups, setModifierGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Search and pagination
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [totalItems, setTotalItems] = useState(0);
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');

  // Modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  // Image upload state
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadError, setImageUploadError] = useState(null);
  const imageInputRef = useRef(null);

  // Mass delete: selected item ids (Set for fast toggle)
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    price: '',
    cost: '',
    sku: '',
    barcode: '',
    category_id: '',
    station_ids: [],
    track_stock: false,
    stock_quantity: '',
    low_stock_threshold: '5',
    description: '',
    image_url: '',
    allow_price_override: false,
    require_manager_override: false,
    display_on_pos: true,
    online_ordering_available: false,
    expose_to_website_api: false,
    website_show_admission_pricing: false,
    website_online_price: '',
    tax_category_ids: [],
    tax_exempt: false,
    rebate_eligible: false,
    rebate_amount: '',
    rebate_type: 'fixed',
    modifier_group_ids: [],
    included_modifier_category_id: '',
    included_modifier_max_price: '',
    parent_inventory_id: '',
    loyalty_points_earned: '',
    loyalty_points_cost: '',
    show_on_rewards_tab: false,
    loyalty_rewards_blurb: '',
    max_quantity_per_sale: '',
    min_quantity_per_sale: '1',
    prep_time_minutes: '',
    calories: '',
    item_tax_overrides: [],
    is_liquor_item: false,
    // Age selection (e.g. tickets 0–23 months, 2–17 years)
    has_age_restriction: false,
    age_min_unit: 'months',
    age_min_value: 0,
    age_max_unit: 'years',
    age_max_value: 17
  });

  // Calculate pagination values
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  // Load ALL supporting data when authenticated (don't block on canViewInventory so page can resolve to content or Access Denied)
  useEffect(() => {
    if (auth.selectedBusinessId && auth.authUser) {
      Promise.all([
        fetchCategories(),
        fetchStations(),
        fetchTaxCategories(),
        fetchModifierGroups(),
        fetchFolderParentOptions()
      ]).then(() => {
        fetchInventory();
      });
    }
  }, [auth.selectedBusinessId, auth.authUser]);

  // Reload inventory when pagination/search/filter changes
  useEffect(() => {
    if (auth.selectedBusinessId && !loading && canViewInventory) {
      fetchInventory();
    }
  }, [currentPage, itemsPerPage, searchTerm, selectedCategoryId, sortBy, sortOrder, showDeactivated]);

  // Reset to page 1 when search term or category changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCategoryId]);

  const fetchInventory = async () => {
    if (!auth.selectedBusinessId) return;
    setLoading(true);
    setError(null);
    
    try {
      await logSecurityEvent('inventory_accessed', {
        action: 'fetch_inventory',
        business_id: auth.selectedBusinessId,
        search_term: searchTerm,
        page: currentPage
      }, 'low');

      let query = supabase
        .from('pos_inventory')
        .select('*', { count: 'exact' })
        .eq('business_id', auth.selectedBusinessId);

      // Bundles are managed on the Bundles tab
      query = query.or('is_bundle.eq.false,is_bundle.is.null');

      // Hide deactivated items unless "Show deactivated" is on (active = true or null for backward compat)
      if (!showDeactivated) {
        query = query.or('is_active.eq.true,is_active.is.null');
      }

      // Apply search filter
      if (searchTerm.trim()) {
        query = query.or(`name.ilike.%${searchTerm}%,sku.ilike.%${searchTerm}%,barcode.ilike.%${searchTerm}%`);
      }

      // Filter by category
      if (selectedCategoryId) {
        query = query.eq('category_id', selectedCategoryId);
      }

      // Apply sorting
      query = query.order(sortBy, { ascending: sortOrder === 'asc' });
      
      // Apply pagination
      const from = (currentPage - 1) * itemsPerPage;
      const to = from + itemsPerPage - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;

      setInventory(data || []);
      setTotalItems(count || 0);

      await logAction({
        action: 'inventory_loaded',
        context: 'POSInventory',
        metadata: { 
          item_count: data?.length || 0,
          page: currentPage,
          search_term: searchTerm,
          sort: `${sortBy}_${sortOrder}`
        }
      });
    } catch (err) {
      await logSecurityEvent('inventory_fetch_error', {
        error: err.message,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError('Error fetching inventory: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchFolderParentOptions = async (excludeId = null) => {
    if (!auth.selectedBusinessId) {
      setFolderParentOptions([]);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('pos_inventory')
        .select('id, name')
        .eq('business_id', auth.selectedBusinessId)
        .or('is_bundle.eq.false,is_bundle.is.null')
        .or('is_active.eq.true,is_active.is.null')
        .is('parent_inventory_id', null)
        .order('name', { ascending: true });
      if (error) throw error;
      const options = (data || []).filter((row) => !excludeId || row.id !== excludeId);
      setFolderParentOptions(options);
    } catch (err) {
      console.warn('Failed to load folder parent options:', err?.message || err);
      setFolderParentOptions([]);
    }
  };

  const fetchFolderChildCount = async (parentId) => {
    if (!auth.selectedBusinessId || !parentId) {
      setFolderChildCount(0);
      return;
    }
    try {
      const { count, error } = await supabase
        .from('pos_inventory')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', auth.selectedBusinessId)
        .eq('parent_inventory_id', parentId);
      if (error) throw error;
      setFolderChildCount(count || 0);
    } catch {
      setFolderChildCount(0);
    }
  };

  const fetchCategories = async () => {
    if (!auth.selectedBusinessId) return;
    try {
      const { data, error } = await supabase
        .from('pos_categories')
        .select('id, name, color, emoji')
        .eq('business_id', auth.selectedBusinessId)
        .order('name', { ascending: true });
      if (error) throw error;
      setCategories(data || []);
    } catch (err) {
      await logSecurityEvent('categories_fetch_error', {
        error: err.message,
        business_id: auth.selectedBusinessId
      }, 'low');
    }
  };

  const fetchStations = async () => {
    if (!auth.selectedBusinessId) return;
    try {
      const { data, error } = await supabase
        .from('pos_stations')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      
      if (error) throw error;
      
      setStations(data || []);
      
      // If no stations exist, create default Kitchen station
      if (!data || data.length === 0) {
        const { data: newStation, error: createError } = await supabase
          .from('pos_stations')
          .insert({
            business_id: auth.selectedBusinessId,
            name: 'Kitchen',
            description: 'Main kitchen station',
            printer_ids: [],
            is_active: true,
            sort_order: 1
          })
          .select()
          .single();
        
        if (!createError && newStation) {
          setStations([newStation]);
          
          await logSecurityEvent('default_station_created', {
            station_name: 'Kitchen',
            business_id: auth.selectedBusinessId
          }, 'low');
        }
      }
    } catch (err) {
      await logSecurityEvent('stations_fetch_error', {
        error: err.message,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError('Unable to load stations. Please check your station configuration.');
    }
  };

  const fetchTaxCategories = async () => {
    if (!auth.selectedBusinessId) return;
    try {
      const { data, error } = await supabase
        .from('pos_tax_categories')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .eq('is_active', true)
        .order('name', { ascending: true });
      if (error) throw error;
      setTaxCategories(data || []);
    } catch (err) {
      await logSecurityEvent('tax_categories_fetch_error', {
        error: err.message,
        business_id: auth.selectedBusinessId
      }, 'low');
    }
  };

  const fetchModifierGroups = async () => {
    if (!auth.selectedBusinessId) return;
    try {
      const { data, error } = await supabase
        .from('pos_modifier_groups')
        .select('id, name, is_required, max_selections, sort_order')
        .eq('business_id', auth.selectedBusinessId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true, nullsLast: true });
      
      if (error) throw error;
      
      const transformedData = (data || []).map(group => ({
        ...group,
        required: group.is_required || false
      }));
      
      setModifierGroups(transformedData);
      
    } catch (err) {
      await logSecurityEvent('modifier_groups_fetch_error', {
        error: err.message,
        business_id: auth.selectedBusinessId
      }, 'low');
      
      setModifierGroups([]);
    }
  };

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setCurrentPage(1);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      price: '',
      cost: '',
      sku: '',
      barcode: '',
      category_id: '',
      station_ids: [],
      track_stock: false,
      stock_quantity: '',
      low_stock_threshold: '5',
      description: '',
      image_url: '',
      allow_price_override: false,
      require_manager_override: false,
      display_on_pos: true,
      online_ordering_available: false,
      expose_to_website_api: false,
      website_show_admission_pricing: false,
      website_online_price: '',
      tax_category_ids: [],
      tax_exempt: false,
      rebate_eligible: false,
      rebate_amount: '',
      rebate_type: 'fixed',
      modifier_group_ids: [],
      included_modifier_category_id: '',
      included_modifier_max_price: '',
      loyalty_points_earned: '',
      loyalty_points_cost: '',
      show_on_rewards_tab: false,
      loyalty_rewards_blurb: '',
      min_quantity_per_sale: '1',
      prep_time_minutes: '',
      calories: '',
      item_tax_overrides: [],
      is_liquor_item: false,
      parent_inventory_id: '',
      has_age_restriction: false,
      age_min_unit: 'months',
      age_min_value: 0,
      age_max_unit: 'years',
      age_max_value: 17
    });
    setFolderChildCount(0);
  };

  const openAddModal = () => {
    if (!canCreateInventory) {
      setError('You do not have permission to create inventory items');
      return;
    }
    resetForm();
    fetchFolderParentOptions();
    setShowAddModal(true);
  };

  const openEditModal = async (item) => {
    if (!canEditInventory) {
      setError('You do not have permission to edit inventory items');
      return;
    }

    setEditingItem(item);
    console.log('[POSInventory] handleEditItem opened', {
      itemId: item.id,
      itemName: item.name,
      itemNameType: typeof item.name,
      hasAgeRestriction: !!item.age_restriction,
      age_restriction: item.age_restriction
    });

    // Normalize age_restriction (may be object or JSON string from DB)
    let ageRestriction = item.age_restriction;
    if (typeof ageRestriction === 'string') {
      try {
        ageRestriction = JSON.parse(ageRestriction);
      } catch (e) {
        ageRestriction = null;
      }
    }

    // Enhanced station_ids handling
    let stationIds = [];
    
    if (item.station_ids) {
      if (Array.isArray(item.station_ids)) {
        stationIds = item.station_ids;
      } else if (typeof item.station_ids === 'string') {
        try {
          stationIds = JSON.parse(item.station_ids);
        } catch (e) {
          stationIds = [];
        }
      } else if (typeof item.station_ids === 'object') {
        stationIds = Array.isArray(item.station_ids) ? item.station_ids : [];
      }
    }
    
    setFormData({
      name: item.name || '',
      price: (item.price !== undefined && item.price !== null) ? String(item.price) : '',
      cost: (item.cost !== undefined && item.cost !== null) ? String(item.cost) : '',
      sku: item.sku || '',
      barcode: item.barcode || '',
      category_id: item.category_id || '',
      station_ids: stationIds,
      track_stock: item.track_stock || false,
      stock_quantity: item.stock_quantity || '',
      low_stock_threshold: item.low_stock_threshold || '5',
      description: item.description || '',
      image_url: item.image_url || '',
      allow_price_override: item.allow_price_override || false,
      require_manager_override: item.require_manager_override || false,
      display_on_pos: item.display_on_pos !== false,
      online_ordering_available: item.online_ordering_available || false,
      expose_to_website_api: item.expose_to_website_api === true,
      website_show_admission_pricing: item.website_show_admission_pricing === true,
      website_online_price: item.website_online_price != null && item.website_online_price !== ''
        ? String(item.website_online_price)
        : '',
      tax_category_ids: item.tax_category_ids || [],
      tax_exempt: item.tax_exempt || false,
      rebate_eligible: item.rebate_eligible || false,
      rebate_amount: item.rebate_amount || '',
      rebate_type: item.rebate_type || 'fixed',
      modifier_group_ids: item.modifier_group_ids || [],
      included_modifier_category_id: item.included_modifier_category_id || '',
      included_modifier_max_price:
        item.included_modifier_max_price !== null && item.included_modifier_max_price !== undefined
          ? String(item.included_modifier_max_price)
          : '',
      parent_inventory_id: item.parent_inventory_id || '',
      loyalty_points_earned: item.loyalty_points_earned || '',
      loyalty_points_cost: item.loyalty_points_cost || '',
      show_on_rewards_tab: item.show_on_rewards_tab === true,
      loyalty_rewards_blurb: item.loyalty_rewards_blurb || '',
      max_quantity_per_sale: item.max_quantity_per_sale || '',
      min_quantity_per_sale: item.min_quantity_per_sale || '1',
      prep_time_minutes: item.prep_time_minutes || '',
      calories: item.calories || '',
      item_tax_overrides: item.item_tax_overrides || [],
      is_liquor_item: item.is_liquor_item || false,
      has_age_restriction: !!(ageRestriction && (ageRestriction.min_value != null || ageRestriction.max_value != null)),
      age_min_unit: ageRestriction?.min_unit || 'months',
      age_min_value: ageRestriction?.min_value ?? 0,
      age_max_unit: ageRestriction?.max_unit || 'years',
      age_max_value: ageRestriction?.max_value ?? 17
    });

    fetchFolderParentOptions(item.id);
    fetchFolderChildCount(item.id);
    setShowEditModal(true);
  };

  const closeModals = () => {
    setShowAddModal(false);
    setShowEditModal(false);
    setEditingItem(null);
    setImageUploadError(null);
    resetForm();
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const toggleArrayField = (field, value) => {
    setFormData(prev => {
      const currentArray = prev[field] || [];
      
      let newArray;
      if (currentArray.includes(value)) {
        newArray = currentArray.filter(v => v !== value);
      } else {
        newArray = [...currentArray, value];
      }
      
      return {
        ...prev,
        [field]: newArray
      };
    });
  };

  // Get storage object path from our bucket's public URL (for delete)
  const getStoragePathFromImageUrl = (url) => {
    if (!url || typeof url !== 'string') return null;
    const marker = `/${POS_PRODUCT_IMAGES_BUCKET}/`;
    const i = url.indexOf(marker);
    if (i === -1) return null;
    return url.slice(i + marker.length);
  };

  const handleImageFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageUploadError(null);
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setImageUploadError('Please choose a JPEG, PNG, WebP, or GIF image.');
      return;
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setImageUploadError('Image must be 2 MB or smaller.');
      return;
    }
    if (!auth.selectedBusinessId) {
      setImageUploadError('No business selected.');
      return;
    }
    setImageUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, 80);
      const path = `${auth.selectedBusinessId}/${crypto.randomUUID()}_${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from(POS_PRODUCT_IMAGES_BUCKET)
        .upload(path, file, { cacheControl: '3600', upsert: false });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage
        .from(POS_PRODUCT_IMAGES_BUCKET)
        .getPublicUrl(path);
      const publicUrl = urlData?.publicUrl || '';
      // Optionally delete previous image in our bucket when replacing
      const prevUrl = formData.image_url;
      const prevPath = getStoragePathFromImageUrl(prevUrl);
      if (prevPath) {
        await supabase.storage.from(POS_PRODUCT_IMAGES_BUCKET).remove([prevPath]);
      }
      setFormData(prev => ({ ...prev, image_url: publicUrl }));
      await logAction({
        action: 'inventory_image_uploaded',
        context: 'POSInventory',
        metadata: { path, business_id: auth.selectedBusinessId }
      });
    } catch (err) {
      setImageUploadError(err?.message || 'Upload failed.');
      await logSecurityEvent('inventory_image_upload_error', {
        error: err?.message,
        business_id: auth.selectedBusinessId
      }, 'low');
    } finally {
      setImageUploading(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const handleRemoveImage = async () => {
    const url = formData.image_url;
    const path = getStoragePathFromImageUrl(url);
    if (path) {
      try {
        await supabase.storage.from(POS_PRODUCT_IMAGES_BUCKET).remove([path]);
      } catch (err) {
        // Non-blocking; clear form anyway
      }
    }
    setFormData(prev => ({ ...prev, image_url: '' }));
    setImageUploadError(null);
  };

  const saveItem = async () => {
    console.log('[POSInventory] saveItem called', {
      isEdit: !!editingItem,
      editingItemId: editingItem?.id,
      editingItemName: editingItem?.name,
      formDataName: formData.name,
      formDataNameType: typeof formData.name,
      formDataNameTrimmed: formData.name?.trim?.(),
      has_age_restriction: formData.has_age_restriction,
      age_min_value: formData.age_min_value,
      age_max_value: formData.age_max_value
    });

    // Permission checks
    if (editingItem && !canEditInventory) {
      setError('You do not have permission to edit inventory items');
      return;
    }
    if (!editingItem && !canCreateInventory) {
      setError('You do not have permission to create inventory items');
      return;
    }

    // Rate limiting check
    const rateLimitCheck = await checkRateLimit('inventory_save', 10, 60000);
    if (!rateLimitCheck.allowed) {
      setError('Too many save attempts. Please wait a moment.');
      return;
    }

    // Validate input (validateInput is async and returns a Promise)
    const nameValidation = await validateInput(formData.name, 'text', 'item_name');
    console.log('[POSInventory] nameValidation result', {
      valid: nameValidation.valid,
      value: formData.name,
      trimmed: formData.name?.trim?.(),
      trimmedLength: formData.name?.trim?.()?.length,
      validationResult: nameValidation
    });
    if (!nameValidation.valid || !formData.name.trim()) {
      console.error('[POSInventory] Save failed: item name validation', {
        nameValidationValid: nameValidation.valid,
        nameValidationMessage: nameValidation.message,
        formDataName: formData.name,
        formDataNameEmpty: !formData.name?.trim?.()
      });
      setError('Item name is required');
      return;
    }

    // Allow $0.00 items - only check for negative prices or invalid/empty values
    const priceValue = parseFloat(formData.price);
    if (formData.price === '' || formData.price === null || formData.price === undefined) {
      setError('Price is required. Use 0.00 for free items.');
      return;
    }
    if (isNaN(priceValue) || priceValue < 0) {
      setError('Price must be $0.00 or greater');
      return;
    }

    setError(null);
    try {
      // Build itemData using ONLY columns that exist in your actual schema
      const itemData = {
        business_id: auth.selectedBusinessId,
        name: formData.name.trim(),
        price: parseFloat(formData.price) || 0,
        cost: parseFloat(formData.cost) || 0,
        sku: formData.sku.trim() || null,
        barcode: formData.barcode.trim() || null,
        category_id: formData.category_id || null,
        station_ids: Array.isArray(formData.station_ids) ? formData.station_ids : [],
        track_stock: formData.track_stock || false,
        stock_quantity: formData.track_stock ? (parseInt(formData.stock_quantity) || 0) : null,
        low_stock_threshold: formData.track_stock ? (parseInt(formData.low_stock_threshold) || 5) : null,
        description: formData.description ? formData.description.trim() : null,
        image_url: formData.image_url ? formData.image_url.trim() : null,

        allow_price_override: formData.allow_price_override || false,
        require_manager_override: formData.require_manager_override || false,
        display_on_pos: formData.display_on_pos !== undefined ? formData.display_on_pos : true,
        online_ordering_available: formData.online_ordering_available || false,
        expose_to_website_api: formData.expose_to_website_api === true,
        website_show_admission_pricing: formData.expose_to_website_api === true
          && formData.website_show_admission_pricing === true,
        website_online_price: formData.website_online_price !== ''
          ? (parseFloat(formData.website_online_price) || null)
          : null,
        
        tax_category_ids: formData.tax_category_ids && formData.tax_category_ids.length > 0 ? formData.tax_category_ids : null,
        tax_exempt: formData.tax_exempt || false,
        rebate_eligible: formData.rebate_eligible || false,
        rebate_amount: formData.rebate_eligible ? (parseFloat(formData.rebate_amount) || null) : null,
        rebate_type: formData.rebate_eligible ? (formData.rebate_type || 'fixed') : null,
        
        modifier_group_ids: formData.modifier_group_ids && formData.modifier_group_ids.length > 0 ? formData.modifier_group_ids : null,
        included_modifier_category_id: formData.included_modifier_category_id || null,
        included_modifier_max_price:
          formData.included_modifier_category_id && formData.included_modifier_max_price !== ''
            ? (parseFloat(formData.included_modifier_max_price) || 0)
            : null,
        parent_inventory_id: formData.parent_inventory_id || null,
        loyalty_points_earned: parseInt(formData.loyalty_points_earned) || 0,
        loyalty_points_cost: parseInt(formData.loyalty_points_cost) || 0,
        show_on_rewards_tab: formData.show_on_rewards_tab === true && (parseInt(formData.loyalty_points_earned) || 0) > 0,
        loyalty_rewards_blurb: formData.loyalty_rewards_blurb ? formData.loyalty_rewards_blurb.trim() : null,
        
        max_quantity_per_sale: formData.max_quantity_per_sale ? parseInt(formData.max_quantity_per_sale) : null,
        min_quantity_per_sale: parseInt(formData.min_quantity_per_sale) || 1,
        prep_time_minutes: formData.prep_time_minutes ? parseInt(formData.prep_time_minutes) : null,
        calories: formData.calories ? parseInt(formData.calories) : null,
        
        item_tax_overrides: formData.item_tax_overrides && formData.item_tax_overrides.length > 0 ? formData.item_tax_overrides : null,
        
        is_liquor_item: formData.is_liquor_item || false,

        age_restriction: formData.has_age_restriction ? {
          min_unit: formData.age_min_unit,
          min_value: Number(formData.age_min_value) ?? 0,
          max_unit: formData.age_max_unit,
          max_value: Number(formData.age_max_value) ?? 17
        } : null
      };

      console.log('[POSInventory] itemData built for save', {
        name: itemData.name,
        has_age_restriction: !!itemData.age_restriction,
        age_restriction: itemData.age_restriction,
        editingItemId: editingItem?.id
      });

      if (editingItem) {
        const { data, error } = await supabase
          .from('pos_inventory')
          .update({ ...itemData, updated_at: new Date().toISOString() }) // preserves existing is_active
          .eq('id', editingItem.id)
          .select();

        if (error) throw error;

        await logSecurityEvent('inventory_item_updated', {
          item_id: editingItem.id,
          item_name: itemData.name,
          station_ids: itemData.station_ids,
          is_liquor_item: itemData.is_liquor_item,
          business_id: auth.selectedBusinessId,
          updated_by: auth.authUser?.id
        }, 'low');

        await logAction({
          action: 'inventory_item_updated',
          context: 'POSInventory',
          metadata: { 
            item_id: editingItem.id, 
            item_name: itemData.name,
            station_ids: itemData.station_ids,
            is_liquor_item: itemData.is_liquor_item,
            changes: Object.keys(itemData).filter(key => itemData[key] !== editingItem[key])
          }
        });
      } else {
        const { data, error } = await supabase
          .from('pos_inventory')
          .insert([{ ...itemData, is_active: true }])
          .select();

        if (error) throw error;

        await logSecurityEvent('inventory_item_created', {
          item_name: itemData.name,
          price: itemData.price,
          station_ids: itemData.station_ids,
          stations: itemData.station_ids?.length || 0,
          is_liquor_item: itemData.is_liquor_item,
          business_id: auth.selectedBusinessId,
          created_by: auth.authUser?.id
        }, 'low');

        await logAction({
          action: 'inventory_item_created',
          context: 'POSInventory',
          metadata: {
            item_name: itemData.name,
            price: itemData.price,
            station_ids: itemData.station_ids,
            stations: itemData.station_ids?.length || 0,
            is_liquor_item: itemData.is_liquor_item
          }
        });
      }

      await recordAction('inventory_saved', { item_name: itemData.name }, true);
      closeModals();
      fetchInventory();
      fetchFolderParentOptions();
    } catch (err) {
      console.error('[POSInventory] saveItem error', {
        message: err?.message,
        code: err?.code,
        details: err?.details,
        hint: err?.hint,
        fullError: err,
        formDataName: formData.name,
        editingItemId: editingItem?.id,
        editingItemName: editingItem?.name
      });
      await logSecurityEvent('inventory_save_error', {
        error: err.message,
        item_name: formData.name,
        business_id: auth.selectedBusinessId
      }, 'medium');
      
      setError('Error saving item: ' + err.message);
    }
  };

  const deleteItem = async (id) => {
    if (!canDeleteInventory) {
      setError('You do not have permission to delete inventory items');
      return;
    }

    if (!window.confirm('Are you sure you want to delete this item? This action cannot be undone.')) return;
    
    setError(null);
    try {
      const { error } = await supabase.from('pos_inventory').delete().eq('id', id);
      if (error) throw error;

      await logSecurityEvent('inventory_item_deleted', {
        item_id: id,
        business_id: auth.selectedBusinessId,
        deleted_by: auth.authUser?.id
      }, 'medium');

      await logAction({
        action: 'inventory_item_deleted',
        context: 'POSInventory',
        metadata: { item_id: id }
      });

      await recordAction('inventory_deleted', { item_id: id }, true);
      fetchInventory();
    } catch (err) {
      const isConflict = err?.code === '23503' || err?.status === 409 ||
        (err?.message && (err.message.includes('foreign key') || err.message.toLowerCase().includes('conflict')));
      let message;
      if (isConflict) {
        const details = (err?.details || err?.message || '').toString();
        const saleItems = details.includes('pos_sale_items');
        message = saleItems
          ? "This item can't be deleted because it appears in past sales. Deactivate it instead to hide it from the POS."
          : "This item can't be deleted because it's in use (e.g. in sales, booking activities, or promotions). Deactivate it instead to hide it from the POS and bookings.";
      } else {
        message = 'Error deleting item: ' + (err?.message || err);
      }
      console.error('[POSInventory] deleteItem error', { code: err?.code, status: err?.status, message: err?.message, details: err?.details });
      await logSecurityEvent('inventory_delete_error', {
        error: err.message,
        item_id: id,
        business_id: auth.selectedBusinessId
      }, 'medium');
      setError(message);
    }
  };

  const toggleSelected = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOnPage = () => {
    const allIds = inventory.map(item => item.id);
    const allSelected = allIds.length > 0 && allIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) allIds.forEach(id => next.delete(id));
      else allIds.forEach(id => next.add(id));
      return next;
    });
  };

  const deleteSelectedItems = async () => {
    if (!canDeleteInventory || selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected item(s)? This action cannot be undone.`)) return;
    setError(null);
    const ids = Array.from(selectedIds);
    let deleted = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        const { error } = await supabase.from('pos_inventory').delete().eq('id', id);
        if (error) throw error;
        deleted++;
        await logAction({ action: 'inventory_item_deleted', context: 'POSInventory', metadata: { item_id: id } });
      } catch (err) {
        failed++;
        const isConflict = err?.code === '23503' || (err?.message && err.message.includes('foreign key'));
        if (failed === 1) {
          setError(isConflict
            ? "Some items couldn't be deleted (in use in sales or bookings). Deactivate them instead."
            : `Error deleting: ${err?.message || err}`);
        }
      }
    }
    if (deleted > 0) {
      await logSecurityEvent('inventory_bulk_deleted', {
        deleted_count: deleted,
        failed_count: failed,
        business_id: auth.selectedBusinessId,
        deleted_by: auth.authUser?.id
      }, 'medium');
      setSelectedIds(new Set());
      fetchInventory();
    }
    if (deleted > 0 && failed === 0) {
      setError(null);
    }
    if (deleted > 0 && failed > 0) {
      setError(`Deleted ${deleted} item(s). ${failed} could not be deleted (in use). Deactivate them instead.`);
    }
  };

  const deactivateSelectedItems = async () => {
    if (!canEditInventory || selectedIds.size === 0) return;
    if (!window.confirm(`Deactivate ${selectedIds.size} selected item(s)? They will be hidden from POS and bookings.`)) return;
    setError(null);
    const ids = Array.from(selectedIds);
    try {
      const { error } = await supabase
        .from('pos_inventory')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .in('id', ids)
        .eq('business_id', auth.selectedBusinessId);
      if (error) throw error;
      await logSecurityEvent('inventory_bulk_deactivated', {
        count: ids.length,
        business_id: auth.selectedBusinessId,
        deactivated_by: auth.authUser?.id
      }, 'low');
      await logAction({
        action: 'inventory_bulk_deactivated',
        context: 'POSInventory',
        metadata: { count: ids.length, item_ids: ids }
      });
      setSelectedIds(new Set());
      fetchInventory();
    } catch (err) {
      setError('Error deactivating items: ' + (err?.message || err));
    }
  };

  const deactivateItem = async (id) => {
    if (!canEditInventory) {
      setError('You do not have permission to edit inventory items');
      return;
    }
    setError(null);
    try {
      const { error } = await supabase
        .from('pos_inventory')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('business_id', auth.selectedBusinessId);
      if (error) throw error;
      await logSecurityEvent('inventory_item_deactivated', {
        item_id: id,
        business_id: auth.selectedBusinessId,
        deactivated_by: auth.authUser?.id
      }, 'low');
      await logAction({
        action: 'inventory_item_deactivated',
        context: 'POSInventory',
        metadata: { item_id: id }
      });
      fetchInventory();
    } catch (err) {
      setError('Error deactivating item: ' + (err?.message || err));
    }
  };

  const reactivateItem = async (id) => {
    if (!canEditInventory) {
      setError('You do not have permission to edit inventory items');
      return;
    }
    setError(null);
    try {
      const { error } = await supabase
        .from('pos_inventory')
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('business_id', auth.selectedBusinessId);
      if (error) throw error;
      await logSecurityEvent('inventory_item_reactivated', {
        item_id: id,
        business_id: auth.selectedBusinessId,
        reactivated_by: auth.authUser?.id
      }, 'low');
      await logAction({
        action: 'inventory_item_reactivated',
        context: 'POSInventory',
        metadata: { item_id: id }
      });
      fetchInventory();
    } catch (err) {
      setError('Error reactivating item: ' + (err?.message || err));
    }
  };

  const getStockStatus = (item) => {
    if (!item.track_stock) return null;
    
    const currentStock = item.stock_quantity || 0;
    const threshold = item.low_stock_threshold || 5;
    
    if (currentStock <= 0) {
      return { text: 'Out of Stock', color: TavariStyles.colors.danger };
    } else if (currentStock <= threshold) {
      return { text: 'Low Stock', color: TavariStyles.colors.warning };
    } else {
      return { text: 'In Stock', color: TavariStyles.colors.success };
    }
  };

  const getStationNames = (stationIds) => {
    if (!stationIds) {
      return '—';
    }
    
    let idsArray = [];
    
    // Handle different data types for station_ids
    if (Array.isArray(stationIds)) {
      idsArray = stationIds;
    } else if (typeof stationIds === 'string') {
      try {
        idsArray = JSON.parse(stationIds);
      } catch (e) {
        return '—';
      }
    } else if (typeof stationIds === 'object') {
      idsArray = Array.isArray(stationIds) ? stationIds : [];
    }
    
    if (idsArray.length === 0) {
      return '—';
    }
    
    const stationNames = idsArray
      .map(id => {
        const station = stations.find(s => s.id === id);
        return station ? station.name : `Unknown (${id})`;
      })
      .join(', ');
    
    return stationNames;
  };

  const renderPaginationButtons = () => {
    const buttons = [];
    const maxButtons = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);

    if (endPage - startPage + 1 < maxButtons) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    if (startPage > 1) {
      buttons.push(
        <button
          key="first"
          onClick={() => setCurrentPage(1)}
          style={{
            ...styles.pageButton,
            ...styles.pageButtonInactive
          }}
        >
          1
        </button>
      );
      if (startPage > 2) {
        buttons.push(<span key="dots1" style={{ padding: '0 8px' }}>...</span>);
      }
    }

    for (let i = startPage; i <= endPage; i++) {
      buttons.push(
        <button
          key={i}
          onClick={() => setCurrentPage(i)}
          style={{
            ...styles.pageButton,
            ...(i === currentPage ? styles.pageButtonActive : styles.pageButtonInactive)
          }}
        >
          {i}
        </button>
      );
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        buttons.push(<span key="dots2" style={{ padding: '0 8px' }}>...</span>);
      }
      buttons.push(
        <button
          key="last"
          onClick={() => setCurrentPage(totalPages)}
          style={{
            ...styles.pageButton,
            ...styles.pageButtonInactive
          }}
        >
          {totalPages}
        </button>
      );
    }

    return buttons;
  };

  const styles = {
    container: {
      ...TavariStyles.layout.container,
      padding: TavariStyles.spacing['2xl'],
      paddingTop: '80px',
      maxWidth: '1400px',
      margin: '0 auto'
    },
    header: {
      marginBottom: TavariStyles.spacing['3xl'],
      textAlign: 'center'
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.sm
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600
    },
    searchSection: {
      marginBottom: TavariStyles.spacing.xl,
      display: 'flex',
      gap: TavariStyles.spacing.md,
      alignItems: 'center',
      flexWrap: 'wrap'
    },
    searchInput: {
      ...TavariStyles.components.form.input,
      flex: 1,
      minWidth: '250px'
    },
    addButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.md
    },
    itemsPerPageSelect: {
      ...TavariStyles.components.form.select,
      width: 'auto'
    },
    table: {
      ...TavariStyles.components.table.table,
      marginBottom: TavariStyles.spacing.xl
    },
    th: {
      ...TavariStyles.components.table.th,
      backgroundColor: TavariStyles.colors.primary,
      cursor: 'pointer',
      userSelect: 'none',
      position: 'relative'
    },
    td: TavariStyles.components.table.td,
    row: TavariStyles.components.table.row,
    actions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm
    },
    editButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.sm
    },
    deleteButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.danger,
      ...TavariStyles.components.button.sizes.sm
    },
    error: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      marginBottom: TavariStyles.spacing.xl
    },
    modal: {
      ...TavariStyles.components.modal.overlay,
      zIndex: 10000
    },
    modalContent: {
      ...TavariStyles.components.modal.content,
      maxWidth: '900px',
      width: '90%',
      maxHeight: '90vh'
    },
    modalHeader: TavariStyles.components.modal.header,
    modalBody: {
      ...TavariStyles.components.modal.body,
      padding: TavariStyles.spacing.xl
    },
    modalFooter: TavariStyles.components.modal.footer,
    formSection: {
      marginBottom: TavariStyles.spacing.xl,
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    formSectionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.md,
      borderBottom: `1px solid ${TavariStyles.colors.gray300}`,
      paddingBottom: TavariStyles.spacing.xs
    },
    formGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.md
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
      minHeight: '80px',
      resize: 'vertical'
    },
    checkboxGroup: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.sm
    },
    checkboxHint: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.xs,
      fontStyle: 'italic'
    },
    saveButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.md
    },
    cancelButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.ghost,
      ...TavariStyles.components.button.sizes.md
    },
    stockBadge: {
      fontSize: TavariStyles.typography.fontSize.xs,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      display: 'inline-block'
    },
    stationBadge: {
      fontSize: TavariStyles.typography.fontSize.xs,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.sm,
      backgroundColor: TavariStyles.colors.info,
      color: TavariStyles.colors.white,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    paginationSection: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.md,
      boxShadow: TavariStyles.shadows.sm,
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.md
    },
    paginationControls: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      alignItems: 'center'
    },
    pageButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.sizes.sm,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      minWidth: '40px'
    },
    pageButtonActive: {
      ...TavariStyles.components.button.variants.primary
    },
    pageButtonInactive: {
      ...TavariStyles.components.button.variants.ghost
    },
    noStationsWarning: {
      backgroundColor: TavariStyles.colors.warningBg,
      color: TavariStyles.colors.warningText,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius.md,
      marginTop: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    liquorBadge: {
      fontSize: TavariStyles.typography.fontSize.xs,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      borderRadius: TavariStyles.borderRadius.sm,
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginLeft: TavariStyles.spacing.xs
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
      <div style={TavariStyles.components.loading.container}>Loading inventory...</div>
    </div>
  );

  // Check overall access permission
  if (!loading && !permissionsLoading && !canViewInventory) {
    return (
      <SecurityWrapper>
        <POSAuthWrapper
          requiredRoles={['employee', 'manager', 'owner']}
          requireBusiness={true}
          componentName="POSInventory"
        >
          <div style={styles.container}>
            <div style={styles.noAccessContainer}>
              <h3 style={styles.error}>Access Denied</h3>
              <p style={styles.noAccessText}>
                You do not have permission to view inventory.
              </p>
            </div>
          </div>
        </POSAuthWrapper>
      </SecurityWrapper>
    );
  }

  const renderEditModal = () => {
    if (!showEditModal && !showAddModal) return null;

    const isEdit = showEditModal && editingItem;
    const modalTitle = isEdit ? `Edit Item: ${editingItem.name}` : 'Add New Item';

    return (
      <div style={styles.modal}>
        <div style={styles.modalContent}>
          <div style={styles.modalHeader}>
            <h2>{modalTitle}</h2>
            <button onClick={closeModals} style={{ fontSize: '24px', cursor: 'pointer', border: 'none', background: 'none' }}>×</button>
          </div>

          <div style={styles.modalBody}>
            {/* Basic Information */}
            <div style={styles.formSection}>
              <h3 style={styles.formSectionTitle}>Basic Information</h3>
              <div style={styles.formGrid}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    style={styles.input}
                    placeholder="Item name"
                  />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Price * (at-gate / POS)</label>
                  <input
                    type="number"
                    value={formData.price}
                    onChange={(e) => handleInputChange('price', e.target.value)}
                    style={styles.input}
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                  />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Online price (optional)</label>
                  <input
                    id="website-online-price"
                    type="number"
                    value={formData.website_online_price}
                    onChange={(e) => handleInputChange('website_online_price', e.target.value)}
                    style={styles.input}
                    step="0.01"
                    min="0"
                    placeholder="Lower online booking price"
                  />
                  <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, margin: '4px 0 0' }}>
                    When set, websites can show both online and at-gate pricing for this item.
                  </p>
                </div>
                {canViewCost && (
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Cost</label>
                    <input
                      type="number"
                      value={formData.cost}
                      onChange={(e) => handleInputChange('cost', e.target.value)}
                      style={styles.input}
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                    />
                  </div>
                )}
                <div style={styles.formGroup}>
                  <label style={styles.label}>SKU</label>
                  <input
                    type="text"
                    value={formData.sku}
                    onChange={(e) => handleInputChange('sku', e.target.value)}
                    style={styles.input}
                    placeholder="SKU"
                  />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Barcode</label>
                  <input
                    type="text"
                    value={formData.barcode}
                    onChange={(e) => handleInputChange('barcode', e.target.value)}
                    style={styles.input}
                    placeholder="Barcode"
                  />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Category</label>
                  <select
                    value={formData.category_id}
                    onChange={(e) => handleInputChange('category_id', e.target.value)}
                    style={styles.select}
                  >
                    <option value="">No Category</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>
                        {cat.emoji} {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  style={styles.textarea}
                  placeholder="Item description..."
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Product image (for register buttons)</label>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept={ALLOWED_IMAGE_TYPES.join(',')}
                  onChange={handleImageFileSelect}
                  style={{ display: 'none' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: TavariStyles.spacing.md, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={imageUploading}
                    style={{
                      ...TavariStyles.components.button.base,
                      ...TavariStyles.components.button.variants.secondary,
                      ...TavariStyles.components.button.sizes.sm
                    }}
                  >
                    {imageUploading ? 'Uploading…' : formData.image_url ? 'Replace image' : 'Upload image'}
                  </button>
                  {formData.image_url && (
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      disabled={imageUploading}
                      style={{
                        ...TavariStyles.components.button.base,
                        ...TavariStyles.components.button.variants.ghost,
                        ...TavariStyles.components.button.sizes.sm,
                        color: TavariStyles.colors.danger
                      }}
                    >
                      Remove image
                    </button>
                  )}
                </div>
                {imageUploadError && (
                  <div style={{ marginTop: TavariStyles.spacing.xs, fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.danger }}>
                    {imageUploadError}
                  </div>
                )}
                <p style={{ fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray600, marginTop: TavariStyles.spacing.xs }}>
                  JPEG, PNG, WebP or GIF, max 2 MB. Shows on POS register buttons.
                </p>
                {formData.image_url && (
                  <div style={{ marginTop: TavariStyles.spacing.sm, display: 'flex', alignItems: 'center', gap: TavariStyles.spacing.md }}>
                    <div style={{
                      width: 80,
                      height: 60,
                      borderRadius: TavariStyles.borderRadius.sm,
                      overflow: 'hidden',
                      backgroundColor: TavariStyles.colors.gray100,
                      flexShrink: 0
                    }}>
                      <img
                        src={formData.image_url}
                        alt="Preview"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    </div>
                    <span style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600 }}>
                      Preview (shows on POS register)
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Station Routing */}
            <div style={styles.formSection}>
              <h3 style={styles.formSectionTitle}>Station Routing (Kitchen Display)</h3>
              {stations.length > 0 ? (
                <div style={styles.checkboxGroup}>
                  {stations.map(station => (
                    <TavariCheckbox
                      key={station.id}
                      checked={formData.station_ids.includes(station.id)}
                      onChange={() => toggleArrayField('station_ids', station.id)}
                      label={`${station.name}${station.description ? ` - ${station.description}` : ''}`}
                      id={`station-${station.id}`}
                    />
                  ))}
                </div>
              ) : (
                <div style={styles.noStationsWarning}>
                  No stations available. Please configure stations in the Station Management screen first.
                </div>
              )}
              <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginTop: TavariStyles.spacing.sm }}>
                Select which stations should receive this item when ordered. Items will appear on the kitchen display screens for selected stations.
              </p>
            </div>

            {/* Inventory & Stock */}
            {canManageStock && (
              <div style={styles.formSection}>
                <h3 style={styles.formSectionTitle}>Inventory & Stock</h3>
                <div style={styles.formGrid}>
                  <div style={styles.formGroup}>
                    <TavariCheckbox
                      checked={formData.track_stock}
                      onChange={(checked) => handleInputChange('track_stock', checked)}
                      label="Track Stock"
                      id="track-stock"
                    />
                  </div>
                  {formData.track_stock && (
                    <>
                      <div style={styles.formGroup}>
                        <label style={styles.label}>Stock Quantity</label>
                        <input
                          type="number"
                          value={formData.stock_quantity}
                          onChange={(e) => handleInputChange('stock_quantity', e.target.value)}
                          style={styles.input}
                          min="0"
                          placeholder="0"
                        />
                      </div>
                      <div style={styles.formGroup}>
                        <label style={styles.label}>Low Stock Threshold</label>
                        <input
                          type="number"
                          value={formData.low_stock_threshold}
                          onChange={(e) => handleInputChange('low_stock_threshold', e.target.value)}
                          style={styles.input}
                          min="0"
                          placeholder="5"
                        />
                      </div>
                    </>
                  )}
                </div>
                
                {/* Liquor Item Checkbox */}
                <div style={{ marginTop: TavariStyles.spacing.md }}>
                  <TavariCheckbox
                    checked={formData.is_liquor_item}
                    onChange={(checked) => handleInputChange('is_liquor_item', checked)}
                    label="🍾 Liquor Item (Weight Tracking)"
                    id="is-liquor-item"
                  />
                  <p style={styles.checkboxHint}>
                    Enable for liquor inventory that requires weight-based tracking and variance reporting. 
                    Items marked as liquor will appear in the Liquor Management system for bottle weight tracking and shrinkage monitoring.
                  </p>
                </div>
              </div>
            )}

            {/* Modifiers */}
            <div style={styles.formSection}>
              <h3 style={styles.formSectionTitle}>Modifier Groups</h3>
              <div style={styles.checkboxGroup}>
                {modifierGroups && modifierGroups.length > 0 ? (
                  modifierGroups.map(group => (
                    <TavariCheckbox
                      key={group.id}
                      checked={formData.modifier_group_ids.includes(group.id)}
                      onChange={() => toggleArrayField('modifier_group_ids', group.id)}
                      label={`${group.name}${group.required ? ' (Required)' : ''}`}
                      id={`modifier-${group.id}`}
                    />
                  ))
                ) : (
                  <p style={{ color: TavariStyles.colors.gray500, fontStyle: 'italic' }}>
                    No modifier groups available. Create modifier groups in the Modifiers screen to assign them to items.
                  </p>
                )}
              </div>
              <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginTop: TavariStyles.spacing.sm }}>
                Select modifier groups that should be available for this item. Required modifier groups must be selected by customers.
              </p>

              <h3 style={{ ...styles.formSectionTitle, marginTop: TavariStyles.spacing.xl }}>
                Included modifier allowance (meals / combos)
              </h3>
              <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginBottom: TavariStyles.spacing.md }}>
                Example: category Drinks + max $2.25 before tax. Juice box / water / small fountain pop at or under $2.25 are included;
                anything over that amount is charged as an upgrade.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: TavariStyles.spacing.md }}>
                <div>
                  <label style={styles.label}>Included category</label>
                  <select
                    style={styles.select}
                    value={formData.included_modifier_category_id}
                    onChange={(e) => handleInputChange('included_modifier_category_id', e.target.value)}
                  >
                    <option value="">None (charge full modifier prices)</option>
                    {(categories || []).map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={styles.label}>Included max price (before tax)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    style={styles.input}
                    value={formData.included_modifier_max_price}
                    onChange={(e) => handleInputChange('included_modifier_max_price', e.target.value)}
                    placeholder="2.25"
                    disabled={!formData.included_modifier_category_id}
                  />
                </div>
              </div>
            </div>

            {/* Age selection (e.g. tickets 0–23 months, 2–17 years) */}
            <div style={styles.formSection}>
              <h3 style={styles.formSectionTitle}>Age selection</h3>
              <TavariCheckbox
                checked={formData.has_age_restriction}
                onChange={(checked) => handleInputChange('has_age_restriction', checked)}
                label="Restrict by age (e.g. child 0–23 months, youth 2–17 years)"
                id="has-age-restriction"
              />
              {formData.has_age_restriction && (
                <div style={{ marginTop: TavariStyles.spacing.lg, display: 'flex', flexDirection: 'column', gap: TavariStyles.spacing.lg }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: TavariStyles.spacing.lg, alignItems: 'end' }}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Starting age</label>
                      <div style={{ display: 'flex', gap: TavariStyles.spacing.sm, alignItems: 'center' }}>
                        <input
                          type="number"
                          min="0"
                          placeholder={formData.age_min_unit === 'months' ? '0–23' : '0'}
                          value={formData.age_min_value === '' ? '' : formData.age_min_value}
                          onChange={(e) => handleInputChange('age_min_value', e.target.value === '' ? '' : (parseInt(e.target.value, 10) || 0))}
                          style={{ ...styles.input, minWidth: '72px', width: '80px' }}
                        />
                        <select
                          value={formData.age_min_unit}
                          onChange={(e) => handleInputChange('age_min_unit', e.target.value)}
                          style={styles.select}
                        >
                          <option value="months">Months</option>
                          <option value="years">Years</option>
                        </select>
                      </div>
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Ending age</label>
                      <div style={{ display: 'flex', gap: TavariStyles.spacing.sm, alignItems: 'center' }}>
                        <input
                          type="number"
                          min="0"
                          placeholder={formData.age_max_unit === 'months' ? '0–23' : '17'}
                          value={formData.age_max_value === '' ? '' : formData.age_max_value}
                          onChange={(e) => handleInputChange('age_max_value', e.target.value === '' ? '' : (parseInt(e.target.value, 10) || 0))}
                          style={{ ...styles.input, minWidth: '72px', width: '80px' }}
                        />
                        <select
                          value={formData.age_max_unit}
                          onChange={(e) => handleInputChange('age_max_unit', e.target.value)}
                          style={styles.select}
                        >
                          <option value="months">Months</option>
                          <option value="years">Years</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, margin: 0 }}>
                    Use months for under 2 (e.g. 0–23 months) and years for older (e.g. 2–17 years). Customer age is compared against this range when selling or booking.
                  </p>
                </div>
              )}
            </div>

            {/* Loyalty / Rewards tab */}
            <div style={styles.formSection}>
              <h3 style={styles.formSectionTitle}>Loyalty &amp; Rewards</h3>
              <div style={styles.formGrid}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Bonus points per unit</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={formData.loyalty_points_earned}
                    onChange={(e) => handleInputChange('loyalty_points_earned', e.target.value)}
                    style={styles.input}
                    placeholder="0"
                  />
                  <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginTop: TavariStyles.spacing.xs }}>
                    Extra points on top of the global earn rate when this item is purchased.
                  </p>
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Redeem with points (cost)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={formData.loyalty_points_cost}
                    onChange={(e) => handleInputChange('loyalty_points_cost', e.target.value)}
                    style={styles.input}
                    placeholder="0"
                  />
                </div>
              </div>
              <div style={{ marginTop: TavariStyles.spacing.md }}>
                <TavariCheckbox
                  checked={formData.show_on_rewards_tab}
                  onChange={(checked) => handleInputChange('show_on_rewards_tab', checked)}
                  label="Show on customer Rewards tab"
                  id="show-on-rewards-tab"
                  disabled={(parseInt(formData.loyalty_points_earned, 10) || 0) <= 0}
                />
                <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginTop: TavariStyles.spacing.xs, marginLeft: 28 }}>
                  Requires bonus points above. Customers see this item under Earn extra in the OTWK app.
                </p>
              </div>
              {formData.show_on_rewards_tab ? (
                <div style={{ ...styles.formGroup, marginTop: TavariStyles.spacing.md }}>
                  <label style={styles.label}>Rewards tab blurb (optional)</label>
                  <input
                    type="text"
                    value={formData.loyalty_rewards_blurb}
                    onChange={(e) => handleInputChange('loyalty_rewards_blurb', e.target.value)}
                    style={styles.input}
                    placeholder="Try our new flavour — limited time!"
                    maxLength={200}
                  />
                </div>
              ) : null}
            </div>

            {/* Settings & Options */}
            <div style={styles.formSection}>
              <h3 style={styles.formSectionTitle}>Settings & Options</h3>
              <div style={styles.formGroup}>
                <label style={styles.label}>Show under folder</label>
                <select
                  value={formData.parent_inventory_id || ''}
                  onChange={(e) => handleInputChange('parent_inventory_id', e.target.value)}
                  style={styles.select}
                  disabled={folderChildCount > 0}
                >
                  <option value="">None — show on register grid</option>
                  {folderParentOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.name}
                    </option>
                  ))}
                </select>
                <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, marginTop: TavariStyles.spacing.xs }}>
                  Nest this item under a parent tile (e.g. Bubly Lime under Bubly). Staff tap the parent on the register, then pick the flavour.
                </p>
                {folderChildCount > 0 && (
                  <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.primary, marginTop: TavariStyles.spacing.xs, fontWeight: TavariStyles.typography.fontWeight.semibold }}>
                    Folder for {folderChildCount} item{folderChildCount === 1 ? '' : 's'} — this item is a parent tile on the register.
                  </p>
                )}
              </div>
              <div style={styles.checkboxGroup}>
                <TavariCheckbox
                  checked={formData.display_on_pos}
                  onChange={(checked) => handleInputChange('display_on_pos', checked)}
                  label="Display on POS"
                  id="display-on-pos"
                />
                <TavariCheckbox
                  checked={formData.expose_to_website_api}
                  onChange={(checked) => {
                    handleInputChange('expose_to_website_api', checked);
                    if (!checked) handleInputChange('website_show_admission_pricing', false);
                  }}
                  label="Expose to website API"
                  id="expose-to-website-api"
                />
                <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, margin: '4px 0 0 28px', maxWidth: '36rem' }}>
                  When enabled, external websites can show this item&apos;s name, description, and price via{' '}
                  <code style={{ fontSize: '0.85em' }}>tavari-api-business-products</code> (all exposed items, by id, or
                  by context such as <code style={{ fontSize: '0.85em' }}>context=admission</code>). Link menu rows on
                  the OTWK website admin to these SKUs — pricing updates here sync automatically. Stock quantity is never
                  published; if stock tracking is on and quantity reaches zero, the item is hidden from the public list.
                </p>
                {formData.expose_to_website_api ? (
                  <>
                    <TavariCheckbox
                      checked={formData.website_show_admission_pricing}
                      onChange={(checked) => handleInputChange('website_show_admission_pricing', checked)}
                      label="Show on admission pricing page"
                      id="website-show-admission-pricing"
                    />
                    <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600, margin: '4px 0 0 28px', maxWidth: '36rem' }}>
                      When enabled, this item appears on external admission pricing pages via{' '}
                      <code style={{ fontSize: '0.85em' }}>tavari-api-business-products?context=admission</code>.
                      Use the item name as the age-band label and description for policy notes (e.g. one free adult per child).
                    </p>
                  </>
                ) : null}
                <TavariCheckbox
                  checked={formData.allow_price_override}
                  onChange={(checked) => handleInputChange('allow_price_override', checked)}
                  label="Allow Price Override"
                  id="allow-price-override"
                />
                <TavariCheckbox
                  checked={formData.require_manager_override}
                  onChange={(checked) => handleInputChange('require_manager_override', checked)}
                  label="Require Manager Override"
                  id="require-manager-override"
                />
              </div>
            </div>
          </div>

          <div style={styles.modalFooter}>
            <button onClick={closeModals} style={styles.cancelButton}>Cancel</button>
            <button onClick={saveItem} style={styles.saveButton}>
              {isEdit ? 'Update Item' : 'Add Item'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <SecurityWrapper>
      <POSAuthWrapper
        requiredRoles={['employee', 'manager', 'owner']}
        requireBusiness={true}
        componentName="POSInventory"
        loadingContent={loadingContent}
      >
        <div style={styles.container}>
          <TavariModuleHeader
            title="POS Inventory Management"
            description="Manage products, pricing, and station routing"
            actionLabel={canCreateInventory ? 'Add New Item' : undefined}
            onAction={openAddModal}
          />

          <POSInventoryManagementTabs />

          {error && <div style={styles.error}>{error}</div>}

          {/* Search and Controls */}
          <div style={styles.searchSection}>
            <input
              type="text"
              placeholder="Search items by name, SKU, or barcode..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={styles.searchInput}
            />
            <select
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              style={{ ...styles.searchInput, maxWidth: 220 }}
              title="Filter by category"
            >
              <option value="">All categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.emoji ? `${cat.emoji} ` : ''}{cat.name}
                </option>
              ))}
            </select>
            {selectedIds.size > 0 && (
              <>
                {canEditInventory && (
                  <button
                    onClick={deactivateSelectedItems}
                    style={{
                      ...TavariStyles.components.button.base,
                      ...TavariStyles.components.button.variants.secondary,
                      ...TavariStyles.components.button.sizes.md
                    }}
                  >
                    Deactivate selected ({selectedIds.size})
                  </button>
                )}
                {canDeleteInventory && (
                  <button
                    onClick={deleteSelectedItems}
                    style={{
                      ...TavariStyles.components.button.base,
                      ...TavariStyles.components.button.variants.danger,
                      ...TavariStyles.components.button.sizes.md
                    }}
                  >
                    Delete selected ({selectedIds.size})
                  </button>
                )}
              </>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600 }}>
              <input
                type="checkbox"
                checked={showDeactivated}
                onChange={(e) => {
                  setShowDeactivated(e.target.checked);
                  setCurrentPage(1);
                }}
              />
              Show deactivated items
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: TavariStyles.spacing.sm }}>
              <label style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600 }}>
                Items per page:
              </label>
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                style={styles.itemsPerPageSelect}
              >
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>

          {/* Inventory Table */}
          {loading || permissionsLoading ? (
            <div style={TavariStyles.components.loading.container}>Loading items...</div>
          ) : (
            <>
              <table style={styles.table}>
                <thead>
                  <tr>
                    {canDeleteInventory && (
                      <th style={{ ...styles.th, width: 44, cursor: 'default' }}>
                        <TavariCheckbox
                          checked={inventory.length > 0 && inventory.every(item => selectedIds.has(item.id))}
                          onChange={toggleSelectAllOnPage}
                          label=""
                          id="select-all-inventory"
                          aria-label="Select all on page"
                        />
                      </th>
                    )}
                    <th style={styles.th} onClick={() => handleSort('name')}>
                      Name {sortBy === 'name' && (sortOrder === 'asc' ? '▲' : '▼')}
                    </th>
                    <th style={styles.th} onClick={() => handleSort('price')}>
                      Price {sortBy === 'price' && (sortOrder === 'asc' ? '▲' : '▼')}
                    </th>
                    <th style={styles.th}>Category</th>
                    <th style={styles.th}>Stations</th>
                    {canManageStock && <th style={styles.th}>Stock</th>}
                    <th style={styles.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.length === 0 ? (
                    <tr>
                      <td colSpan={canManageStock ? (canDeleteInventory ? 7 : 6) : (canDeleteInventory ? 6 : 5)} style={{ ...styles.td, textAlign: 'center', color: TavariStyles.colors.gray500, fontStyle: 'italic' }}>
                        {searchTerm
                            ? `No items match your search "${searchTerm}"`
                            : selectedCategoryId
                              ? 'No items in this category'
                              : 'No inventory items found'}
                      </td>
                    </tr>
                  ) : (
                    inventory.map((item, i) => {
                      const stockStatus = getStockStatus(item);
                      const category = categories.find(c => c.id === item.category_id);
                      const stationNames = getStationNames(item.station_ids);
                      
                      return (
                        <tr key={item.id} style={{
                          ...styles.row,
                          backgroundColor: i % 2 === 0 ? TavariStyles.colors.gray50 : TavariStyles.colors.white
                        }}>
                          {canDeleteInventory && (
                            <td style={styles.td}>
                              <TavariCheckbox
                                checked={selectedIds.has(item.id)}
                                onChange={() => toggleSelected(item.id)}
                                label=""
                                id={`select-item-${item.id}`}
                                aria-label={`Select ${item.name}`}
                              />
                            </td>
                          )}
                          <td style={styles.td}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                              <div style={{ fontWeight: TavariStyles.typography.fontWeight.bold }}>
                                {item.name}
                              </div>
                              {item.is_liquor_item && (
                                <span style={styles.liquorBadge}>🍾 LIQUOR</span>
                              )}
                            </div>
                            {item.sku && (
                              <div style={{ fontSize: TavariStyles.typography.fontSize.xs, color: TavariStyles.colors.gray600 }}>
                                SKU: {item.sku}
                              </div>
                            )}
                          </td>
                          
                          <td style={styles.td}>
                            ${Number(item.price || 0).toFixed(2)}
                            {Number(item.price || 0) === 0 && (
                              <div style={{ 
                                fontSize: TavariStyles.typography.fontSize.xs, 
                                color: TavariStyles.colors.success,
                                fontWeight: TavariStyles.typography.fontWeight.bold
                              }}>
                                FREE
                              </div>
                            )}
                          </td>
                          
                          <td style={styles.td}>
                            {category ? (
                              <>
                                {category.emoji} {category.name}
                              </>
                            ) : '—'}
                          </td>
                          
                          <td style={styles.td}>
                            {stationNames !== '—' ? (
                              <span style={styles.stationBadge}>
                                {stationNames}
                              </span>
                            ) : (
                              <span style={{ color: TavariStyles.colors.gray500, fontSize: TavariStyles.typography.fontSize.xs }}>
                                No stations
                              </span>
                            )}
                          </td>
                          
                          {canManageStock && (
                            <td style={styles.td}>
                              {stockStatus ? (
                                <span style={{
                                  ...styles.stockBadge,
                                  backgroundColor: stockStatus.color,
                                  color: 'white'
                                }}>
                                  {stockStatus.text}
                                </span>
                              ) : (
                                <span style={{ color: TavariStyles.colors.gray500, fontSize: TavariStyles.typography.fontSize.xs }}>
                                  Not tracked
                                </span>
                              )}
                            </td>
                          )}
                          
                          <td style={styles.td}>
                            <div style={styles.actions}>
                              {canEditInventory && (
                                <button 
                                  onClick={() => openEditModal(item)} 
                                  style={styles.editButton}
                                >
                                  Edit
                                </button>
                              )}
                              {canEditInventory && item.is_active !== false && (
                                <button 
                                  onClick={() => window.confirm('Deactivate this item? It will be hidden from POS and bookings.') && deactivateItem(item.id)} 
                                  style={{ ...styles.editButton, marginLeft: 4 }}
                                >
                                  Deactivate
                                </button>
                              )}
                              {canEditInventory && item.is_active === false && (
                                <button 
                                  onClick={() => reactivateItem(item.id)} 
                                  style={{ ...styles.editButton, marginLeft: 4 }}
                                >
                                  Reactivate
                                </button>
                              )}
                              {canDeleteInventory && (
                                <button 
                                  onClick={() => deleteItem(item.id)} 
                                  style={styles.deleteButton}
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>

              {/* Pagination Controls */}
              {totalItems > 0 && (
                <div style={styles.paginationSection}>
                  <div>
                    Showing {startItem} to {endItem} of {totalItems} items
                  </div>
                  <div style={styles.paginationControls}>
                    <button
                      onClick={() => setCurrentPage(currentPage - 1)}
                      disabled={currentPage === 1}
                      style={styles.pageButton}
                    >
                      Previous
                    </button>
                    {renderPaginationButtons()}
                    <button
                      onClick={() => setCurrentPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      style={styles.pageButton}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Modals */}
          {renderEditModal()}
        </div>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default POSInventory;