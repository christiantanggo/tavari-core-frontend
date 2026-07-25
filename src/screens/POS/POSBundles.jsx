// src/screens/POS/POSBundles.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { FiChevronDown, FiMinus, FiPlus, FiTrash2, FiX } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import { TavariStyles } from '../../utils/TavariStyles';
import POSInventoryManagementTabs from '../../components/POS/POSInventoryManagementTabs';
import { SecurityWrapper } from '../../Security';
import {
  buildBundleIncludesLabel,
  buildInventoryPriceMapWithBundles,
  bundleContainsBundleId,
  calculateBundleAutoPrice,
  fetchAllBundleItemRows,
  groupBundleItemsByBundleId,
  parseOptionalPrice,
  resolveInventoryEffectivePrice,
  wouldAddingBundleComponentCreateCycle,
} from '../../utils/posInventoryBundles';

const POSBundles = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const createFromQueryHandled = useRef(false);

  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'POSBundles',
  });

  const { hasAnyPermission, hasElevatedPrivileges, hasPermission } = usePermissions();

  const canView = hasAnyPermission(['pos.inventory.view', 'pos.inventory.create', 'pos.inventory.edit'])
    || hasElevatedPrivileges();
  const canManage = hasPermission('pos.inventory.create') || hasPermission('pos.inventory.edit') || hasElevatedPrivileges();

  const [bundles, setBundles] = useState([]);
  const [bundleItemsByBundleId, setBundleItemsByBundleId] = useState(new Map());
  const [componentInventory, setComponentInventory] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedBundleId, setExpandedBundleId] = useState(null);

  const [showEditor, setShowEditor] = useState(false);
  const [editingBundle, setEditingBundle] = useState(null);
  const [editorName, setEditorName] = useState('');
  const [editorDescription, setEditorDescription] = useState('');
  const [editorCategoryId, setEditorCategoryId] = useState('');
  const [editorUseAutoPrice, setEditorUseAutoPrice] = useState(true);
  const [editorPrice, setEditorPrice] = useState('');
  const [editorComponents, setEditorComponents] = useState([]);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState(null);

  const [showComponentPicker, setShowComponentPicker] = useState(false);
  const [componentSearch, setComponentSearch] = useState('');
  const [componentCategoryId, setComponentCategoryId] = useState('');
  const [pickerItems, setPickerItems] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerSelection, setPickerSelection] = useState([]);

  const inventoryById = useMemo(
    () => new Map([...bundles, ...componentInventory, ...pickerItems].map((item) => [item.id, item])),
    [bundles, componentInventory, pickerItems]
  );

  const editorComponentIds = useMemo(
    () => editorComponents.map((row) => row.component_inventory_id),
    [editorComponents]
  );

  const updateEditorComponentQuantity = (componentId, nextQuantity) => {
    const quantity = Math.max(1, Number.parseInt(String(nextQuantity), 10) || 1);
    setEditorComponents((prev) =>
      prev.map((row) =>
        row.component_inventory_id === componentId ? { ...row, quantity } : row
      )
    );
  };

  const removeEditorComponent = (componentId) => {
    setEditorComponents((prev) =>
      prev.filter((row) => row.component_inventory_id !== componentId)
    );
  };

  const bundlePriceMap = useMemo(() => {
    const inventoryItems = [...bundles, ...componentInventory];
    const uniqueItems = [...new Map(inventoryItems.map((item) => [item.id, item])).values()];
    return buildInventoryPriceMapWithBundles(uniqueItems, bundleItemsByBundleId, {});
  }, [bundles, componentInventory, bundleItemsByBundleId]);

  const editorAutoPrice = useMemo(() => {
    const rows = editorComponents.map((row, index) => ({
      component_inventory_id: row.component_inventory_id,
      quantity: row.quantity,
      sort_order: index,
      component: inventoryById.get(row.component_inventory_id),
    }));
    return calculateBundleAutoPrice(rows, bundlePriceMap);
  }, [editorComponents, inventoryById, bundlePriceMap]);

  const fetchBundles = useCallback(async () => {
    if (!auth.selectedBusinessId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: bundleRows, error: bundleError } = await supabase
        .from('pos_inventory')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .eq('is_bundle', true)
        .or('is_active.eq.true,is_active.is.null')
        .order('name', { ascending: true });
      if (bundleError) throw bundleError;

      const list = bundleRows || [];
      setBundles(list);

      if (list.length === 0) {
        setBundleItemsByBundleId(new Map());
        return;
      }

      const itemRows = await fetchAllBundleItemRows(
        supabase,
        auth.selectedBusinessId,
        list.map((b) => b.id)
      );

      setBundleItemsByBundleId(groupBundleItemsByBundleId(itemRows || []));

      const componentIds = [
        ...new Set((itemRows || []).map((row) => row.component_inventory_id).filter(Boolean)),
      ];
      if (componentIds.length > 0) {
        const { data: compData, error: compError } = await supabase
          .from('pos_inventory')
          .select('id, name, price, category_id, is_bundle, bundle_use_auto_price')
          .eq('business_id', auth.selectedBusinessId)
          .in('id', componentIds);
        if (compError) throw compError;
        setComponentInventory(compData || []);
      } else {
        setComponentInventory([]);
      }
    } catch (err) {
      setError(err.message || 'Failed to load bundles');
    } finally {
      setLoading(false);
    }
  }, [auth.selectedBusinessId]);

  const fetchCategories = useCallback(async () => {
    if (!auth.selectedBusinessId) return;
    const { data } = await supabase
      .from('pos_categories')
      .select('id, name')
      .eq('business_id', auth.selectedBusinessId)
      .order('name', { ascending: true });
    setCategories(data || []);
  }, [auth.selectedBusinessId]);

  useEffect(() => {
    if (auth.selectedBusinessId && canView) {
      fetchBundles();
      fetchCategories();
    }
  }, [auth.selectedBusinessId, canView, fetchBundles, fetchCategories]);

  const loadPickerItems = useCallback(async () => {
    if (!auth.selectedBusinessId) return;
    setPickerLoading(true);
    try {
      let query = supabase
        .from('pos_inventory')
        .select('id, name, price, sku, category_id, is_bundle, bundle_use_auto_price')
        .eq('business_id', auth.selectedBusinessId)
        .or('is_active.eq.true,is_active.is.null')
        .order('name', { ascending: true });

      if (componentCategoryId) query = query.eq('category_id', componentCategoryId);
      if (componentSearch.trim()) {
        query = query.or(
          `name.ilike.%${componentSearch.trim()}%,sku.ilike.%${componentSearch.trim()}%`
        );
      }

      const { data, error: qError } = await query;
      if (qError) throw qError;

      let items = (data || []).filter((item) => {
        if (editingBundle?.id && item.id === editingBundle.id) return false;
        if (
          editingBundle?.id &&
          item.is_bundle &&
          bundleContainsBundleId(item.id, editingBundle.id, bundleItemsByBundleId)
        ) {
          return false;
        }
        return true;
      });
      const keepIds = [...new Set([...pickerSelection, ...editorComponentIds])].filter(Boolean);
      if (keepIds.length > 0) {
        const { data: pinned } = await supabase
          .from('pos_inventory')
          .select('id, name, price, sku, category_id, is_bundle')
          .eq('business_id', auth.selectedBusinessId)
          .in('id', keepIds);
        const existing = new Set(items.map((item) => item.id));
        items = [...items, ...(pinned || []).filter((item) => !existing.has(item.id))].sort(
          (a, b) => a.name.localeCompare(b.name)
        );
      }
      setPickerItems(items);
    } catch (err) {
      setEditorError(err.message || 'Failed to load inventory');
    } finally {
      setPickerLoading(false);
    }
  }, [
    auth.selectedBusinessId,
    componentCategoryId,
    componentSearch,
    pickerSelection,
    editorComponentIds,
    editingBundle?.id,
    bundleItemsByBundleId,
  ]);

  useEffect(() => {
    if (showComponentPicker) loadPickerItems();
  }, [showComponentPicker, loadPickerItems]);

  useEffect(() => {
    if (createFromQueryHandled.current) return;
    if (searchParams.get('create') !== '1' || !canManage || loading) return;

    createFromQueryHandled.current = true;
    setEditingBundle(null);
    setEditorName('');
    setEditorDescription('');
    setEditorCategoryId('');
    setEditorUseAutoPrice(true);
    setEditorPrice('');
    setEditorComponents([]);
    setEditorError(null);
    setShowEditor(true);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('create');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, canManage, loading, setSearchParams]);

  const openCreate = () => {
    setEditingBundle(null);
    setEditorName('');
    setEditorDescription('');
    setEditorCategoryId('');
    setEditorUseAutoPrice(true);
    setEditorPrice('');
    setEditorComponents([]);
    setEditorError(null);
    setShowEditor(true);
  };

  const openEdit = (bundle) => {
    const items = bundleItemsByBundleId.get(bundle.id) || [];
    setEditingBundle(bundle);
    setEditorName(bundle.name || '');
    setEditorDescription(bundle.bundle_description || '');
    setEditorCategoryId(bundle.category_id || '');
    setEditorUseAutoPrice(bundle.bundle_use_auto_price !== false);
    setEditorPrice(
      bundle.bundle_use_auto_price === false && bundle.price != null
        ? String(bundle.price)
        : ''
    );
    setEditorComponents(
      items.map((row) => ({
        component_inventory_id: row.component_inventory_id,
        quantity: Math.max(1, Number.parseInt(row.quantity, 10) || 1),
      }))
    );
    setEditorError(null);
    setShowEditor(true);
  };

  const saveBundle = async () => {
    if (!canManage || !auth.selectedBusinessId) return;
    if (!editorName.trim()) {
      setEditorError('Bundle name is required');
      return;
    }
    if (editorComponents.length < 1) {
      setEditorError('Add at least one inventory item or bundle to the bundle');
      return;
    }

    if (editingBundle?.id) {
      const cycleComponent = editorComponents.find((row) =>
        wouldAddingBundleComponentCreateCycle(
          editingBundle.id,
          row.component_inventory_id,
          bundleItemsByBundleId
        )
      );
      if (cycleComponent) {
        setEditorError('A bundle cannot contain itself or another bundle that already contains it.');
        return;
      }
    }

    setEditorSaving(true);
    setEditorError(null);
    try {
      const autoPrice = editorAutoPrice;
      const useAuto = editorUseAutoPrice;
      const fixedPrice = parseOptionalPrice(editorPrice);
      const effectivePrice = useAuto ? autoPrice : (fixedPrice ?? autoPrice);

      const inventoryPayload = {
        name: editorName.trim(),
        bundle_description: editorDescription.trim() || null,
        category_id: editorCategoryId || null,
        is_bundle: true,
        bundle_use_auto_price: useAuto,
        price: effectivePrice,
        cost: 0,
        business_id: auth.selectedBusinessId,
        track_stock: false,
        updated_at: new Date().toISOString(),
      };

      let bundleId = editingBundle?.id;
      if (editingBundle) {
        const { error: updateError } = await supabase
          .from('pos_inventory')
          .update(inventoryPayload)
          .eq('id', editingBundle.id);
        if (updateError) throw updateError;
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('pos_inventory')
          .insert([{ ...inventoryPayload, is_active: true }])
          .select('id')
          .single();
        if (insertError) throw insertError;
        bundleId = inserted.id;
      }

      await supabase
        .from('pos_inventory_bundle_items')
        .delete()
        .eq('bundle_inventory_id', bundleId);

      const rows = editorComponents.map((row, index) => ({
        business_id: auth.selectedBusinessId,
        bundle_inventory_id: bundleId,
        component_inventory_id: row.component_inventory_id,
        quantity: Math.max(1, Number.parseInt(String(row.quantity), 10) || 1),
        sort_order: index,
      }));
      const { error: itemsError } = await supabase.from('pos_inventory_bundle_items').insert(rows);
      if (itemsError) throw itemsError;

      setShowEditor(false);
      setEditingBundle(null);
      await fetchBundles();
    } catch (err) {
      setEditorError(err.message || 'Failed to save bundle');
    } finally {
      setEditorSaving(false);
    }
  };

  const deleteBundle = async (bundle) => {
    if (!canManage || !window.confirm(`Delete bundle "${bundle.name}"?`)) return;
    try {
      await supabase.from('pos_inventory').delete().eq('id', bundle.id);
      await fetchBundles();
    } catch (err) {
      setError(err.message || 'Failed to delete bundle');
    }
  };

  const styles = {
    container: {
      ...TavariStyles.layout.container,
      padding: TavariStyles.spacing['2xl'],
      paddingTop: '80px',
      maxWidth: '1400px',
      margin: '0 auto',
    },
    card: {
      border: '1px solid #e5e7eb',
      borderRadius: 12,
      backgroundColor: '#fafafa',
      overflow: 'hidden',
      marginBottom: 12,
    },
    modalOverlay: {
      ...TavariStyles.components.modal.overlay,
      zIndex: 10000,
    },
    modalContent: {
      ...TavariStyles.components.modal.content,
      maxWidth: 640,
      width: 'min(560px, calc(100vw - 32px))',
    },
    modalHeader: TavariStyles.components.modal.header,
    modalBody: TavariStyles.components.modal.body,
    modalFooter: TavariStyles.components.modal.footer,
    label: {
      display: 'block',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.xs,
    },
    input: {
      width: '100%',
      padding: '10px 12px',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      boxSizing: 'border-box',
      fontSize: TavariStyles.typography.fontSize.base,
    },
    formGroup: {
      marginBottom: TavariStyles.spacing.lg,
    },
    error: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      marginBottom: TavariStyles.spacing.md,
    },
    cancelBtn: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.md,
    },
    saveBtn: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.md,
    },
    closeBtn: {
      background: 'none',
      border: 'none',
      fontSize: 24,
      lineHeight: 1,
      cursor: 'pointer',
      color: TavariStyles.colors.gray500,
      padding: 4,
      borderRadius: 4,
    },
    qtyButton: {
      width: 32,
      height: 32,
      borderRadius: 6,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      background: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
    },
    componentRow: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 12px',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      backgroundColor: 'white',
      marginBottom: 8,
    },
  };

  const renderEditorModal = () => {
    if (!showEditor) return null;
    return createPortal(
      <div
        style={styles.modalOverlay}
        onClick={() => !editorSaving && setShowEditor(false)}
        role="presentation"
      >
        <div
          style={styles.modalContent}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="bundle-editor-title"
        >
          <div style={styles.modalHeader}>
            <h3 id="bundle-editor-title" style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
              {editingBundle ? 'Edit bundle' : 'New bundle'}
            </h3>
            <button
              type="button"
              style={styles.closeBtn}
              onClick={() => !editorSaving && setShowEditor(false)}
              aria-label="Close"
            >
              <FiX size={22} />
            </button>
          </div>

          <div style={styles.modalBody}>
            {editorError && <div style={styles.error}>{editorError}</div>}

            <div style={styles.formGroup}>
              <label style={styles.label} htmlFor="bundle-name">Name *</label>
              <input
                id="bundle-name"
                type="text"
                value={editorName}
                onChange={(e) => setEditorName(e.target.value)}
                style={styles.input}
                placeholder="e.g. Canadian Pizza"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label} htmlFor="bundle-description">
                Description (shown to customers)
              </label>
              <textarea
                id="bundle-description"
                value={editorDescription}
                onChange={(e) => setEditorDescription(e.target.value)}
                rows={3}
                style={{ ...styles.input, resize: 'vertical', minHeight: 72 }}
                placeholder={
                  buildBundleIncludesLabel(
                    editorComponents.map((row, i) => ({
                      component: inventoryById.get(row.component_inventory_id),
                      quantity: row.quantity,
                      sort_order: i,
                    })),
                    ''
                  ) || 'Pepperoni, Bacon, Mushroom'
                }
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label} htmlFor="bundle-category">Category</label>
              <select
                id="bundle-category"
                value={editorCategoryId}
                onChange={(e) => setEditorCategoryId(e.target.value)}
                style={styles.input}
              >
                <option value="">None</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>

            <div style={styles.formGroup}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={styles.label}>Included items or bundles *</span>
                <button
                  type="button"
                  onClick={() => {
                    setPickerSelection([...editorComponentIds]);
                    setComponentSearch('');
                    setComponentCategoryId('');
                    setShowComponentPicker(true);
                  }}
                  style={{
                    ...TavariStyles.components.button.base,
                    ...TavariStyles.components.button.sizes.sm,
                    border: `1px solid ${TavariStyles.colors.primary}`,
                    background: 'white',
                    color: TavariStyles.colors.primary,
                    fontWeight: 600,
                  }}
                >
                  {editorComponentIds.length ? 'Edit items' : '+ Add items'}
                </button>
              </div>
              {editorComponents.length === 0 ? (
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 8,
                    border: '1px solid #e5e7eb',
                    backgroundColor: '#f9fafb',
                    fontSize: 14,
                    color: TavariStyles.colors.gray500,
                  }}
                >
                  No items selected.
                </div>
              ) : (
                <div>
                  {editorComponents.map((row) => {
                    const item = inventoryById.get(row.component_inventory_id);
                    if (!item) return null;
                    const linePrice =
                      (bundlePriceMap[row.component_inventory_id] ??
                        parseOptionalPrice(item.price) ??
                        0) * row.quantity;
                    return (
                      <div key={row.component_inventory_id} style={styles.componentRow}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>
                            {item.name}
                            {item.is_bundle && (
                              <span
                                style={{
                                  marginLeft: 8,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: '#1d4ed8',
                                  backgroundColor: '#dbeafe',
                                  padding: '2px 8px',
                                  borderRadius: 999,
                                }}
                              >
                                Bundle
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 13, color: TavariStyles.colors.gray500, marginTop: 4 }}>
                            ${linePrice.toFixed(2)} total
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => updateEditorComponentQuantity(row.component_inventory_id, row.quantity - 1)}
                            disabled={row.quantity <= 1}
                            style={styles.qtyButton}
                            aria-label="Decrease quantity"
                          >
                            <FiMinus size={16} />
                          </button>
                          <input
                            type="number"
                            min={1}
                            value={row.quantity}
                            onChange={(e) =>
                              updateEditorComponentQuantity(
                                row.component_inventory_id,
                                e.target.value
                              )
                            }
                            style={{
                              ...styles.input,
                              width: 64,
                              padding: '8px 10px',
                              textAlign: 'center',
                            }}
                            aria-label={`Quantity for ${item.name}`}
                          />
                          <button
                            type="button"
                            onClick={() => updateEditorComponentQuantity(row.component_inventory_id, row.quantity + 1)}
                            style={styles.qtyButton}
                            aria-label="Increase quantity"
                          >
                            <FiPlus size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeEditorComponent(row.component_inventory_id)}
                            style={{
                              ...styles.qtyButton,
                              borderColor: '#fecaca',
                              color: '#dc2626',
                            }}
                            aria-label={`Remove ${item.name}`}
                          >
                            <FiTrash2 size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={styles.formGroup}>
              <TavariCheckbox
                checked={editorUseAutoPrice}
                onChange={setEditorUseAutoPrice}
                label={`Auto-calculate price from items ($${editorAutoPrice.toFixed(2)})`}
                size="md"
              />
            </div>

            {!editorUseAutoPrice && (
              <div style={styles.formGroup}>
                <label style={styles.label} htmlFor="bundle-price">Fixed price override</label>
                <input
                  id="bundle-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={editorPrice}
                  onChange={(e) => setEditorPrice(e.target.value)}
                  style={styles.input}
                  placeholder={editorAutoPrice.toFixed(2)}
                />
              </div>
            )}
          </div>

          <div style={styles.modalFooter}>
            <button
              type="button"
              onClick={() => setShowEditor(false)}
              disabled={editorSaving}
              style={styles.cancelBtn}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveBundle}
              disabled={editorSaving}
              style={styles.saveBtn}
            >
              {editorSaving ? 'Saving…' : 'Save bundle'}
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  };

  const renderComponentPickerModal = () => {
    if (!showComponentPicker) return null;
    return createPortal(
      <div
        style={{ ...styles.modalOverlay, zIndex: 10001 }}
        onClick={() => setShowComponentPicker(false)}
        role="presentation"
      >
        <div
          style={{ ...styles.modalContent, maxWidth: 720 }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="bundle-picker-title"
        >
          <div style={styles.modalHeader}>
            <h3 id="bundle-picker-title" style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
              Select inventory items or bundles
            </h3>
            <button
              type="button"
              style={styles.closeBtn}
              onClick={() => setShowComponentPicker(false)}
              aria-label="Close"
            >
              <FiX size={22} />
            </button>
          </div>

          <div style={styles.modalBody}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <input
                type="text"
                value={componentSearch}
                onChange={(e) => setComponentSearch(e.target.value)}
                placeholder="Search by name or SKU…"
                style={{ ...styles.input, flex: '1 1 200px' }}
              />
              <select
                value={componentCategoryId}
                onChange={(e) => setComponentCategoryId(e.target.value)}
                style={{ ...styles.input, flex: '0 1 180px' }}
              >
                <option value="">All categories</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>

            {pickerSelection.length > 0 && (
              <div
                style={{
                  marginBottom: 16,
                  padding: '10px 12px',
                  backgroundColor: '#f0f9ff',
                  borderRadius: 8,
                  border: '1px solid #bae6fd',
                  fontSize: 13,
                  color: TavariStyles.colors.gray800,
                }}
              >
                <strong>Selected ({pickerSelection.length}):</strong>{' '}
                {pickerSelection.map((id) => pickerItems.find((i) => i.id === id)?.name || 'Item').join(', ')}
              </div>
            )}

            <div
              style={{
                maxHeight: 360,
                overflowY: 'auto',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 8,
              }}
            >
              {pickerLoading ? (
                <div style={{ padding: 24, textAlign: 'center', color: TavariStyles.colors.gray600 }}>
                  Loading…
                </div>
              ) : pickerItems.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: TavariStyles.colors.gray600 }}>
                  No items found.
                </div>
              ) : (
                pickerItems.map((item) => {
                  const checked = pickerSelection.includes(item.id);
                  return (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        setPickerSelection((prev) =>
                          prev.includes(item.id)
                            ? prev.filter((id) => id !== item.id)
                            : [...prev, item.id]
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setPickerSelection((prev) =>
                            prev.includes(item.id)
                              ? prev.filter((id) => id !== item.id)
                              : [...prev, item.id]
                          );
                        }
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 12px',
                        border: `1px solid ${checked ? TavariStyles.colors.primary : '#e5e7eb'}`,
                        borderRadius: 8,
                        marginBottom: 8,
                        cursor: 'pointer',
                        backgroundColor: checked ? `${TavariStyles.colors.primary}10` : 'white',
                      }}
                    >
                      <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <TavariCheckbox
                          checked={checked}
                          onChange={(next) =>
                            setPickerSelection((prev) =>
                              next
                                ? prev.includes(item.id) ? prev : [...prev, item.id]
                                : prev.filter((id) => id !== item.id)
                            )
                          }
                          size="md"
                        />
                      </div>
                      <div style={{ flex: 1, fontSize: 14 }}>
                        {item.name}
                        {item.is_bundle && (
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 11,
                              fontWeight: 700,
                              color: '#1d4ed8',
                              backgroundColor: '#dbeafe',
                              padding: '2px 8px',
                              borderRadius: 999,
                            }}
                          >
                            Bundle
                          </span>
                        )}
                      </div>
                      <div style={{ fontWeight: 600, color: TavariStyles.colors.primary }}>
                        ${(bundlePriceMap[item.id] ?? parseOptionalPrice(item.price) ?? 0).toFixed(2)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div style={styles.modalFooter}>
            <button type="button" onClick={() => setShowComponentPicker(false)} style={styles.cancelBtn}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setEditorComponents((prev) => {
                  const quantityById = new Map(
                    prev.map((row) => [row.component_inventory_id, row.quantity])
                  );
                  return pickerSelection.map((id) => ({
                    component_inventory_id: id,
                    quantity: quantityById.get(id) ?? 1,
                  }));
                });
                setShowComponentPicker(false);
              }}
              style={styles.saveBtn}
            >
              Done ({pickerSelection.length})
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  };

  if (!canView) {
    return (
      <SecurityWrapper>
        <POSAuthWrapper
          requiredRoles={['employee', 'manager', 'owner']}
          requireBusiness={true}
          componentName="POSBundles"
        >
          <div style={styles.container}>
            <p style={{ textAlign: 'center', color: TavariStyles.colors.gray600 }}>
              You do not have permission to view bundles.
            </p>
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
        componentName="POSBundles"
      >
        <div style={styles.container}>
          <TavariModuleHeader
            title="Inventory Bundles"
            description="Combine inventory items and other bundles into preset packages for parties, food platters, and add-ons. Price auto-calculates from included items unless you set a fixed override."
            actionLabel={canManage ? 'New bundle' : undefined}
            actionIcon={canManage ? <FiPlus /> : undefined}
            onAction={openCreate}
          />

          <POSInventoryManagementTabs />

          {error && <div style={{ ...styles.error, marginBottom: 16 }}>{error}</div>}

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: TavariStyles.colors.gray600 }}>
              Loading bundles…
            </div>
          ) : bundles.length === 0 ? (
            <div
              style={{
                padding: 32,
                textAlign: 'center',
                border: '1px dashed #e5e7eb',
                borderRadius: 12,
                color: TavariStyles.colors.gray600,
                backgroundColor: 'white',
              }}
            >
              No bundles yet. Create one to sell combined items as a single choice.
            </div>
          ) : (
            bundles.map((bundle) => {
              const items = bundleItemsByBundleId.get(bundle.id) || [];
              const price = resolveInventoryEffectivePrice(bundle, items, bundlePriceMap);
              const includes = buildBundleIncludesLabel(items, bundle.bundle_description);
              const isExpanded = expandedBundleId === bundle.id;
              return (
                <div key={bundle.id} style={styles.card}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedBundleId(isExpanded ? null : bundle.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setExpandedBundleId(isExpanded ? null : bundle.id);
                      }
                    }}
                    style={{
                      padding: '14px 16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      backgroundColor: isExpanded ? '#f0f9ff' : '#fafafa',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <FiChevronDown style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 16 }}>{bundle.name}</div>
                        {includes && (
                          <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 4 }}>
                            {includes}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                      <span style={{ fontWeight: 700, color: TavariStyles.colors.primary }}>
                        ${price.toFixed(2)}
                        {bundle.bundle_use_auto_price !== false && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: TavariStyles.colors.gray500, marginLeft: 6 }}>
                            auto
                          </span>
                        )}
                      </span>
                      {canManage && (
                        <>
                          <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(bundle); }} style={{ border: 'none', background: 'transparent', color: TavariStyles.colors.primary, cursor: 'pointer', fontWeight: 600 }}>
                            Edit
                          </button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); deleteBundle(bundle); }} style={{ border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer', padding: 4 }}>
                            <FiTrash2 />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{ padding: '12px 16px 16px', borderTop: '1px solid #e5e7eb', backgroundColor: 'white' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Included items</div>
                      {items.length === 0 ? (
                        <div style={{ fontSize: 13, color: TavariStyles.colors.gray500 }}>No components configured.</div>
                      ) : (
                        items.map((row) => {
                          const qty = Math.max(1, Number.parseInt(row.quantity, 10) || 1);
                          const unitPrice =
                            bundlePriceMap[row.component_inventory_id] ??
                            parseOptionalPrice(row.component?.price) ??
                            0;
                          const name = row.component?.name || 'Item';
                          const qtyLabel = qty > 1 ? `${name} × ${qty}` : name;
                          return (
                            <div key={row.id} style={{ fontSize: 13, padding: '4px 0', color: TavariStyles.colors.gray700 }}>
                              {qtyLabel}
                              {row.component?.is_bundle ? ' (bundle)' : ''}
                              {' — '}
                              ${(unitPrice * qty).toFixed(2)}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {renderEditorModal()}
        {renderComponentPickerModal()}
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default POSBundles;
