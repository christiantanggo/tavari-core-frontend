// components/POS/ModifierSelectionModal.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import { supabase } from '../../supabaseClient';
import {
  applyPosModifierToggle,
  filterVisiblePosModifierGroups,
  filterVisiblePosModifierItems,
  getModifierDrilldownParent,
  getNestedMinInventoryPrice,
  isPickOneModifierGroup,
  modifierUnlocksFollowUpGroups,
  pickNewlyUnlockedGroupId,
  prunePosModifierSelections,
} from '../../utils/posModifierVisibility';
import {
  formatPosModifierLabel,
  isModifierGroupSelectionComplete,
} from '../../utils/posModifierDisplay';
import { normalizeModifierGroupIds, sortModifierGroupsForDisplay, mergeNestedModifierGroupsFromOptions } from '../../utils/posModifierGroupsLoader';
import {
  applyIncludedCategoryPool,
  getIncludedModifierAllowance,
  getModifierOptionPricePreview,
  resolveModifierChargePrice,
  sortModifierOptionsIncludedFirst,
  sumModifierPrices,
} from '../../utils/posIncludedModifierPricing';

/** Select is_default_selected options for newly visible groups that have no selection yet. */
const applyDefaultSelections = (groups, selections, productId) => {
  let next = [...(selections || [])];
  let guard = 0;
  while (guard < 5) {
    guard += 1;
    const visible = filterVisiblePosModifierGroups(groups, next, productId);
    let changed = false;
    visible.forEach((group) => {
      const hasSelection = next.some((row) => row.group_id === group.id);
      if (hasSelection) return;
      const defaults = (group.modifiers || []).filter((m) => m.is_default_selected);
      defaults.forEach((modifier) => {
        next = applyPosModifierToggle(groups, next, modifier, group, true, productId);
        changed = true;
      });
    });
    if (!changed) break;
  }
  return prunePosModifierSelections(groups, next, productId);
};

const ModifierSelectionModal = ({
  isOpen,
  onClose,
  product,
  businessId,
  onAddToCart
}) => {
  const [modifierGroups, setModifierGroups] = useState([]);
  const [selectedModifiers, setSelectedModifiers] = useState([]);
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [skipVisibleGroupSync, setSkipVisibleGroupSync] = useState(false);
  /** Drink option id — while set, only Size/Flavour for that drink are shown. */
  const [nestedFocusParentId, setNestedFocusParentId] = useState(null);

  useEffect(() => {
    if (isOpen && product?.id && product?.modifier_group_ids && businessId) {
      loadModifierGroups();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: product.id, not product
  }, [isOpen, product?.id, businessId]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedModifiers([]);
      setModifierGroups([]);
      setActiveGroupId(null);
      setError(null);
      setSkipVisibleGroupSync(false);
      setNestedFocusParentId(null);
    }
  }, [isOpen]);

  const followUpRank = (group) => {
    const name = String(group?.name || '').toLowerCase();
    if (/\bsize\b/.test(name)) return 0;
    if (group?.is_required) return 1;
    if (/flavour|flavor/.test(name)) return 2;
    return 3;
  };

  const visibleGroups = useMemo(() => {
    const all = sortModifierGroupsForDisplay(
      filterVisiblePosModifierGroups(modifierGroups, selectedModifiers, product?.id),
      product?.modifier_group_ids
    );
    if (!nestedFocusParentId) return all;
    const nested = all
      .filter(
        (g) => String(g.show_when_inventory_id || '') === String(nestedFocusParentId)
      )
      .sort((a, b) => followUpRank(a) - followUpRank(b));
    return nested.length > 0 ? nested : all;
  }, [
    modifierGroups,
    selectedModifiers,
    product?.id,
    product?.modifier_group_ids,
    nestedFocusParentId,
  ]);

  useEffect(() => {
    if (skipVisibleGroupSync) {
      setSkipVisibleGroupSync(false);
      return;
    }
    if (visibleGroups.length === 0) {
      setActiveGroupId(null);
      return;
    }

    // Hard rule: unfinished Size always wins over Flavour
    const unfinishedSize = visibleGroups.find(
      (g) =>
        /\bsize\b/i.test(String(g.name || '')) &&
        !selectedModifiers.some((s) => s.group_id === g.id)
    );
    if (unfinishedSize) {
      setActiveGroupId(unfinishedSize.id);
      return;
    }

    setActiveGroupId((prev) => {
      if (prev && visibleGroups.some((group) => group.id === prev)) {
        return prev;
      }
      return visibleGroups[0].id;
    });
  }, [visibleGroups, skipVisibleGroupSync, selectedModifiers]);

  const loadModifierGroups = async () => {
    setLoading(true);
    setError(null);

    try {
      // Always re-read the product row so meal modifier_group_ids are not stale
      // (register product cache can lag behind inventory realtime updates).
      let groupIds = normalizeModifierGroupIds(product.modifier_group_ids);
      let allowanceProduct = product;
      const { data: freshProduct } = await supabase
        .from('pos_inventory')
        .select(
          'id, modifier_group_ids, included_modifier_category_id, included_modifier_max_price'
        )
        .eq('id', product.id)
        .eq('business_id', businessId)
        .maybeSingle();
      if (freshProduct) {
        groupIds = normalizeModifierGroupIds(freshProduct.modifier_group_ids);
        allowanceProduct = { ...product, ...freshProduct };
      }

      if (groupIds.length === 0) {
        setLoading(false);
        return;
      }

      const { data: groups, error: groupsError } = await supabase
        .from('pos_modifier_groups')
        .select('*')
        .in('id', groupIds)
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true, nullsFirst: false });

      if (groupsError) throw groupsError;
      if (!groups?.length) {
        setModifierGroups([]);
        setLoading(false);
        return;
      }

      const groupsWithModifiers = await Promise.all(
        groups.map(async (group) => {
          const { data: groupItems, error: groupItemsError } = await supabase
            .from('pos_modifier_group_items')
            .select('*')
            .eq('modifier_group_id', group.id)
            .eq('is_active', true)
            .order('sort_order', { ascending: true });

          if (groupItemsError || !groupItems?.length) {
            return { ...group, modifiers: [] };
          }

          const inventoryIds = groupItems.map((item) => item.inventory_id);
          const { data: inventoryItems, error: inventoryError } = await supabase
            .from('pos_inventory')
            .select('id, name, price, cost, category_id, modifier_group_ids')
            .in('id', inventoryIds)
            .eq('business_id', businessId);

          if (inventoryError) {
            return { ...group, modifiers: [] };
          }

          const allowance = getIncludedModifierAllowance(allowanceProduct);

          const modifiers = groupItems
            .map((groupItem) => {
              const inventoryItem = inventoryItems?.find((inv) => inv.id === groupItem.inventory_id);
              if (!inventoryItem) return null;
              const inventoryPrice = Number(inventoryItem.price) || 0;
              return {
                id: inventoryItem.id,
                name: inventoryItem.name,
                inventory_price: inventoryPrice,
                category_id: inventoryItem.category_id || null,
                modifier_group_ids: inventoryItem.modifier_group_ids || null,
                price: resolveModifierChargePrice({
                  inventoryPrice,
                  categoryId: inventoryItem.category_id,
                  priceOverride: groupItem.price_override,
                  isFree: groupItem.is_free || false,
                  allowance,
                }),
                cost: inventoryItem.cost ?? 0,
                cost_multiplier: groupItem.cost_multiplier ?? 1,
                is_free: groupItem.is_free || false,
                is_default_selected: groupItem.is_default_selected || false,
                modifier_group_item_id: groupItem.id,
                show_when_inventory_id: groupItem.show_when_inventory_id || null,
              };
            })
            .filter(Boolean);

          // Preserve DB sort_order (Size Small→Large; flavours already stored alpha)
          return {
            ...group,
            show_when_inventory_id: group.show_when_inventory_id || null,
            modifiers,
          };
        })
      );

      const withItems = groupsWithModifiers.filter((group) => (group.modifiers || []).length > 0);
      const withNested = await mergeNestedModifierGroupsFromOptions(
        supabase,
        businessId,
        withItems,
        allowanceProduct
      );
      const ordered = sortModifierGroupsForDisplay(withNested, groupIds);
      const withDefaults = applyDefaultSelections(ordered, [], product?.id);
      setSkipVisibleGroupSync(true);
      setModifierGroups(ordered);
      setSelectedModifiers(withDefaults);
      // Open on first group (Size); Flavour remains available as a tab
      setActiveGroupId(ordered[0]?.id || null);
    } catch (err) {
      setError('Failed to load modifier options. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const advanceAfterSelection = (
    groups,
    prevVisible,
    nextSelections,
    group,
    adding,
    pickedModifier = null
  ) => {
    const nextVisible = filterVisiblePosModifierGroups(groups, nextSelections, product?.id);
    const followUpRank = (g) => {
      const name = String(g?.name || '').toLowerCase();
      if (/\bsize\b/.test(name)) return 0;
      if (g?.is_required) return 1;
      if (/flavour|flavor/.test(name)) return 2;
      return 3;
    };

    if (!adding) {
      if (pickedModifier?.id && String(nestedFocusParentId) === String(pickedModifier.id)) {
        setNestedFocusParentId(null);
      }
      return;
    }

    const pickedId = pickedModifier?.id ? String(pickedModifier.id) : null;
    const nestedUnderPicked = pickedId
      ? nextVisible
          .filter((g) => String(g.show_when_inventory_id || '') === pickedId)
          .sort((a, b) => followUpRank(a) - followUpRank(b))
      : [];

    if (nestedUnderPicked.length > 0) {
      setNestedFocusParentId(pickedId);
    }

    // Keep sequencing on the drink (Fountain/Slush) even when picking Small/Medium/Large
    const focusId =
      nestedUnderPicked.length > 0
        ? pickedId
        : nestedFocusParentId
          ? String(nestedFocusParentId)
          : null;

    const nestedForFocus = focusId
      ? nextVisible
          .filter((g) => String(g.show_when_inventory_id || '') === focusId)
          .sort((a, b) => followUpRank(a) - followUpRank(b))
      : [];

    let unlockTargetId = null;

    if (nestedForFocus.length > 0) {
      // Just unlocked this drink's follow-ups → always open Size first,
      // even if a default already filled Size (defaults must not skip past Size).
      if (nestedUnderPicked.length > 0) {
        unlockTargetId = nestedForFocus[0].id;
      } else if (!isModifierGroupSelectionComplete(group, nextSelections)) {
        // Multi-select toppings (unlimited max): stay on this group so staff can
        // add pepperoni + mushrooms etc. Only pick-one / capped groups auto-advance.
        unlockTargetId = null;
      } else {
        const unfinished = nestedForFocus.find(
          (g) =>
            g.id !== group.id && !isModifierGroupSelectionComplete(g, nextSelections)
        );
        if (unfinished) {
          unlockTargetId = unfinished.id;
        } else {
          setNestedFocusParentId(null);
        }
      }
    } else {
      const prevIds = new Set(prevVisible.map((g) => g.id));
      const newlyNeedingPick = nextVisible
        .filter(
          (g) => !prevIds.has(g.id) && !nextSelections.some((row) => row.group_id === g.id)
        )
        .sort((a, b) => followUpRank(a) - followUpRank(b));
      unlockTargetId =
        newlyNeedingPick[0]?.id || pickNewlyUnlockedGroupId(prevVisible, nextVisible);

      if (
        !unlockTargetId &&
        isPickOneModifierGroup(group) &&
        nextSelections.some((row) => row.group_id === group.id)
      ) {
        const idx = nextVisible.findIndex((g) => g.id === group.id);
        const nextUnfinished = nextVisible
          .slice(Math.max(idx + 1, 0))
          .find((g) => !isModifierGroupSelectionComplete(g, nextSelections));
        unlockTargetId = nextUnfinished?.id || null;
      }
    }

    if (unlockTargetId) {
      setSkipVisibleGroupSync(true);
      setActiveGroupId(unlockTargetId);
    }
  };

  const handleModifierToggle = async (modifier, group) => {
    const isSelected = selectedModifiers.some(
      (m) => m.id === modifier.id && m.group_id === group.id
    );
    const adding = !isSelected;
    const prevVisible = filterVisiblePosModifierGroups(
      modifierGroups,
      selectedModifiers,
      product?.id
    );

    // Ensure this option's own Size/Flavour groups are present before unlocking.
    let groupsForToggle = modifierGroups;
    if (adding && normalizeModifierGroupIds(modifier?.modifier_group_ids).length > 0) {
      groupsForToggle = await mergeNestedModifierGroupsFromOptions(
        supabase,
        businessId,
        modifierGroups,
        product
      );
      if (groupsForToggle !== modifierGroups) {
        setModifierGroups(groupsForToggle);
      }
    }

    let nextSelections = applyPosModifierToggle(
      groupsForToggle,
      selectedModifiers,
      modifier,
      group,
      adding,
      product?.id
    );
    // Auto-pick defaults for groups that just became visible (e.g. Full Pizza after 12")
    nextSelections = applyDefaultSelections(groupsForToggle, nextSelections, product?.id);

    advanceAfterSelection(groupsForToggle, prevVisible, nextSelections, group, adding, modifier);
    setSelectedModifiers(nextSelections);
    setError(null);
  };

  const handleGoToGroup = (groupId) => {
    if (!groupId) return;
    setSkipVisibleGroupSync(true);
    setActiveGroupId(groupId);
    setError(null);
  };

  const calculateModifierTotal = () =>
    sumModifierPrices(applyIncludedCategoryPool(selectedModifiers, product));

  const handleAddToCart = () => {
    if (loading) return;

    const requiredGroups = visibleGroups.filter((group) => group.is_required);
    const missingRequired = requiredGroups.filter((group) => {
      const groupSelections = selectedModifiers.filter((mod) => mod.group_id === group.id);
      return groupSelections.length < (group.min_selections || 1);
    });

    if (missingRequired.length > 0) {
      setError(`Please make selections for: ${missingRequired.map((g) => g.name).join(', ')}`);
      return;
    }

    const pricedModifiers = applyIncludedCategoryPool(selectedModifiers, product);

    const productWithModifiers = {
      ...product,
      modifiers: pricedModifiers.map((modifier) => ({
        id: modifier.id,
        name: formatPosModifierLabel(modifier),
        price: Number(modifier.price) || 0,
        cost: Number(modifier.cost) || 0,
        cost_multiplier: Number(modifier.cost_multiplier) || 1,
        group_id: modifier.group_id,
        group_name: modifier.group_name,
        modifier_group_item_id: modifier.modifier_group_item_id,
        category_id: modifier.category_id || null,
        inventory_price: Number(modifier.inventory_price) || 0,
      })),
    };

    onAddToCart(productWithModifiers);
  };

  const isModifierSelected = (modifierId, groupId = null) =>
    selectedModifiers.some(
      (m) => m.id === modifierId && (groupId == null || m.group_id === groupId)
    );

  const styles = {
    backdrop: { ...TavariStyles.components.modal.overlay, zIndex: 1500 },
    modal: { ...TavariStyles.components.modal.content, width: '600px', maxWidth: '90vw', maxHeight: '80vh', padding: 0 },
    header: { ...TavariStyles.components.modal.header, backgroundColor: TavariStyles.colors.primary, color: TavariStyles.colors.white },
    title: { margin: 0, fontSize: TavariStyles.typography.fontSize.xl, fontWeight: TavariStyles.typography.fontWeight.bold },
    closeBtn: { backgroundColor: 'transparent', border: 'none', fontSize: TavariStyles.typography.fontSize['2xl'], cursor: 'pointer', color: TavariStyles.colors.white, padding: TavariStyles.spacing.xs, borderRadius: TavariStyles.borderRadius.sm, width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    content: { ...TavariStyles.components.modal.body, maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', paddingTop: TavariStyles.spacing.md },
    loadingContainer: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: TavariStyles.spacing['4xl'], fontSize: TavariStyles.typography.fontSize.lg, color: TavariStyles.colors.gray600 },
    errorContainer: { ...TavariStyles.components.banner.base, ...TavariStyles.components.banner.variants.error, margin: TavariStyles.spacing.lg },
    noModifiersContainer: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: TavariStyles.spacing['4xl'], fontSize: TavariStyles.typography.fontSize.base, color: TavariStyles.colors.gray500, textAlign: 'center' },
    tabsBar: {
      display: 'flex',
      flexWrap: 'nowrap',
      gap: TavariStyles.spacing.xs,
      overflowX: 'auto',
      marginBottom: TavariStyles.spacing.md,
      paddingBottom: TavariStyles.spacing.xs,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      flexShrink: 0,
    },
    tabBtn: {
      flex: '0 0 auto',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.gray700,
      borderRadius: TavariStyles.borderRadius.md,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    },
    tabBtnActive: {
      borderColor: TavariStyles.colors.primary,
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
    },
    tabBtnHasSelection: {
      boxShadow: `inset 0 -3px 0 ${TavariStyles.colors.success}`,
    },
    stepHint: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      flexWrap: 'wrap',
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray700,
      backgroundColor: `${TavariStyles.colors.primary}12`,
      border: `1px solid ${TavariStyles.colors.primary}33`,
      borderRadius: TavariStyles.borderRadius.md,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      marginBottom: TavariStyles.spacing.md,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      flexShrink: 0,
    },
    backBtn: {
      border: `1px solid ${TavariStyles.colors.primary}`,
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.primary,
      borderRadius: TavariStyles.borderRadius.md,
      padding: `${TavariStyles.spacing.xs} ${TavariStyles.spacing.sm}`,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      cursor: 'pointer',
      flexShrink: 0,
    },
    stepHintText: { flex: '1 1 auto', minWidth: 0 },
    stepHintLink: {
      background: 'none',
      border: 'none',
      padding: 0,
      color: TavariStyles.colors.primary,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      fontSize: 'inherit',
      cursor: 'pointer',
      textDecoration: 'underline',
    },
    selectedStrip: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.xs,
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.md,
      flexShrink: 0,
    },
    selectedStripLabel: {
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray600,
      marginRight: TavariStyles.spacing.xs,
    },
    selectedChip: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.gray800,
      borderRadius: TavariStyles.borderRadius.md,
      padding: `4px ${TavariStyles.spacing.sm}`,
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: 'pointer',
    },
    selectedChipActive: {
      borderColor: TavariStyles.colors.primary,
      backgroundColor: `${TavariStyles.colors.primary}14`,
      color: TavariStyles.colors.primary,
    },
    selectedChipEdit: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.primary,
      fontWeight: TavariStyles.typography.fontWeight.bold,
    },
    modifierGroup: { flex: 1, minHeight: 0 },
    groupHeader: { marginBottom: TavariStyles.spacing.lg },
    groupTitle: { fontSize: TavariStyles.typography.fontSize.lg, fontWeight: TavariStyles.typography.fontWeight.bold, color: TavariStyles.colors.gray900, marginBottom: TavariStyles.spacing.xs },
    groupDescription: { fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600 },
    requiredBadge: { display: 'inline-block', backgroundColor: TavariStyles.colors.danger, color: TavariStyles.colors.white, fontSize: TavariStyles.typography.fontSize.xs, fontWeight: TavariStyles.typography.fontWeight.bold, padding: `2px ${TavariStyles.spacing.xs}`, borderRadius: TavariStyles.borderRadius.sm, marginLeft: TavariStyles.spacing.sm },
    selectionCount: { fontSize: TavariStyles.typography.fontSize.xs, fontWeight: TavariStyles.typography.fontWeight.bold, marginLeft: TavariStyles.spacing.xs, opacity: 0.9 },
    modifiersList: { display: 'flex', flexDirection: 'column', gap: TavariStyles.spacing.sm },
    modifierItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: TavariStyles.spacing.md, backgroundColor: TavariStyles.colors.white, borderRadius: TavariStyles.borderRadius.sm, border: `1px solid ${TavariStyles.colors.gray200}`, transition: TavariStyles.transitions.normal },
    modifierItemSelected: { borderColor: TavariStyles.colors.primary, backgroundColor: `${TavariStyles.colors.primary}10` },
    modifierDetails: { display: 'flex', alignItems: 'center', gap: TavariStyles.spacing.md, flex: 1 },
    modifierNameRow: { display: 'flex', alignItems: 'center', gap: TavariStyles.spacing.sm, flexWrap: 'wrap' },
    modifierName: { fontSize: TavariStyles.typography.fontSize.base, fontWeight: TavariStyles.typography.fontWeight.medium, color: TavariStyles.colors.gray900 },
    moreOptionsHint: {
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary,
      letterSpacing: '0.02em',
    },
    modifierPrice: { fontSize: TavariStyles.typography.fontSize.base, fontWeight: TavariStyles.typography.fontWeight.bold, color: TavariStyles.colors.gray900, minWidth: '60px', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: TavariStyles.spacing.sm },
    freeLabel: { fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.success, fontWeight: TavariStyles.typography.fontWeight.bold },
    chevron: { color: TavariStyles.colors.primary, fontSize: TavariStyles.typography.fontSize.lg, fontWeight: TavariStyles.typography.fontWeight.bold, lineHeight: 1 },
    summary: { backgroundColor: TavariStyles.colors.gray50, padding: TavariStyles.spacing.lg, borderRadius: TavariStyles.borderRadius.md, border: `1px solid ${TavariStyles.colors.gray200}`, marginBottom: TavariStyles.spacing.xl },
    summaryRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: TavariStyles.spacing.sm },
    summaryLabel: { fontSize: TavariStyles.typography.fontSize.base, color: TavariStyles.colors.gray700 },
    summaryValue: { fontSize: TavariStyles.typography.fontSize.base, fontWeight: TavariStyles.typography.fontWeight.bold, color: TavariStyles.colors.gray900 },
    totalRow: { borderTop: `1px solid ${TavariStyles.colors.gray300}`, paddingTop: TavariStyles.spacing.md, marginTop: TavariStyles.spacing.md, marginBottom: 0 },
    totalValue: { fontSize: TavariStyles.typography.fontSize.lg, fontWeight: TavariStyles.typography.fontWeight.bold, color: TavariStyles.colors.primary },
    actions: { ...TavariStyles.components.modal.footer },
    cancelBtn: { ...TavariStyles.components.button.base, ...TavariStyles.components.button.variants.secondary, ...TavariStyles.components.button.sizes.lg },
    addBtn: { ...TavariStyles.components.button.base, ...TavariStyles.components.button.variants.primary, ...TavariStyles.components.button.sizes.lg },
    addBtnDisabled: { backgroundColor: TavariStyles.colors.gray300, color: TavariStyles.colors.gray500, cursor: 'not-allowed' },
  };

  if (!isOpen) return null;

  const modifierTotal = calculateModifierTotal();
  const productTotal = Number(product?.price || 0) + modifierTotal;
  const useTabs = visibleGroups.length > 1;
  const activeGroup =
    visibleGroups.find((group) => group.id === activeGroupId) || visibleGroups[0] || null;
  const groupsToRender = useTabs
    ? (activeGroup ? [activeGroup] : [])
    : visibleGroups;

  const getGroupSelectionCount = (groupId) =>
    selectedModifiers.filter((mod) => mod.group_id === groupId).length;

  const drilldownParent = getModifierDrilldownParent(
    modifierGroups,
    selectedModifiers,
    activeGroup,
    product?.id
  );

  const handleBackToParent = () => {
    if (nestedFocusParentId) {
      const parentGroup = modifierGroups.find((g) =>
        (g.modifiers || []).some((m) => String(m.id) === String(nestedFocusParentId))
      );
      setNestedFocusParentId(null);
      if (parentGroup) {
        handleGoToGroup(parentGroup.id);
        return;
      }
    }
    if (drilldownParent?.parentGroupId) {
      handleGoToGroup(drilldownParent.parentGroupId);
    }
  };

  const displayModifierName = (modifier, group) => {
    const full = String(modifier?.name || '');
    if (!/\bsize\b/i.test(String(group?.name || ''))) return full;
    const cut = full.split(' - ');
    if (cut.length > 1) return cut.slice(1).join(' - ').trim() || full;
    return full;
  };

  // One chip per selected option so staff can jump back and change it
  const selectedChips = selectedModifiers.map((mod) => ({
    key: `${mod.group_id}-${mod.id}`,
    name: formatPosModifierLabel(mod),
    groupId: mod.group_id,
    groupName: mod.group_name || '',
    isActiveGroup: mod.group_id === activeGroup?.id,
  }));

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={styles.title}>Customize: {product?.name || 'Item'}</h3>
          <button style={styles.closeBtn} onClick={onClose} disabled={loading} type="button">×</button>
        </div>

        {error && <div style={styles.errorContainer}>{error}</div>}

        <div style={styles.content}>
          {loading ? (
            <div style={styles.loadingContainer}>Loading modifier options...</div>
          ) : visibleGroups.length > 0 ? (
            <>
              {useTabs && (
                <div style={styles.tabsBar} role="tablist" aria-label="Modifier categories">
                  {visibleGroups.map((group) => {
                    const isActive = group.id === activeGroup?.id;
                    const selectionCount = getGroupSelectionCount(group.id);
                    return (
                      <button
                        key={group.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        style={{
                          ...styles.tabBtn,
                          ...(isActive ? styles.tabBtnActive : {}),
                          ...(!isActive && selectionCount > 0 ? styles.tabBtnHasSelection : {}),
                        }}
                        onClick={() => handleGoToGroup(group.id)}
                        disabled={loading}
                      >
                        {group.name}
                        {group.is_required ? ' *' : ''}
                        {selectionCount > 0 && (
                          <span style={styles.selectionCount}>({selectionCount})</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedChips.length > 0 && (
                <div style={styles.selectedStrip} aria-label="Selected modifiers">
                  <span style={styles.selectedStripLabel}>Selected — tap to edit:</span>
                  {selectedChips.map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      style={{
                        ...styles.selectedChip,
                        ...(chip.isActiveGroup ? styles.selectedChipActive : {}),
                      }}
                      onClick={() => handleGoToGroup(chip.groupId)}
                      disabled={loading}
                      title={chip.groupName ? `Edit ${chip.groupName}` : 'Edit selection'}
                    >
                      {chip.name}
                      <span style={styles.selectedChipEdit}>Edit</span>
                    </button>
                  ))}
                </div>
              )}

              {drilldownParent && (
                <div style={styles.stepHint} aria-live="polite">
                  <button
                    type="button"
                    style={styles.backBtn}
                    onClick={handleBackToParent}
                    disabled={loading || !drilldownParent.parentGroupId}
                  >
                    ← Back
                  </button>
                  <div style={styles.stepHintText}>
                    {drilldownParent.parentGroupId ? (
                      <button
                        type="button"
                        style={styles.stepHintLink}
                        onClick={handleBackToParent}
                        disabled={loading}
                      >
                        {drilldownParent.parentName}
                      </button>
                    ) : (
                      drilldownParent.parentName
                    )}
                    {' → '}
                    {activeGroup?.name}
                  </div>
                </div>
              )}

              {groupsToRender.map((group) => {
                const visibleRaw = filterVisiblePosModifierItems(
                  group,
                  selectedModifiers,
                  modifierGroups,
                  product?.id
                );
                const nestedMinByModifierId = {};
                visibleRaw.forEach((modifier) => {
                  nestedMinByModifierId[modifier.id] = getNestedMinInventoryPrice(
                    modifierGroups,
                    modifier.id
                  );
                });
                const visibleModifiers = sortModifierOptionsIncludedFirst(visibleRaw, {
                  group,
                  allGroups: modifierGroups,
                  product,
                  nestedMinByModifierId,
                });
                return (
                  <div key={group.id} style={styles.modifierGroup}>
                    <div style={styles.groupHeader}>
                      <div style={styles.groupTitle}>
                        {group.name}
                        {group.is_required && <span style={styles.requiredBadge}>REQUIRED</span>}
                      </div>
                      {(group.min_selections > 0 || group.max_selections > 0) && (
                        <div style={styles.groupDescription}>
                          {isPickOneModifierGroup(group)
                            ? 'Select one option'
                            : group.min_selections > 0 && group.max_selections > 0
                              ? `Select ${group.min_selections}-${group.max_selections} options`
                              : group.min_selections > 0
                                ? `Select at least ${group.min_selections} options`
                                : `Select up to ${group.max_selections} options`}
                        </div>
                      )}
                    </div>

                    <div style={styles.modifiersList}>
                      {visibleModifiers.map((modifier) => {
                        const isSelected = isModifierSelected(modifier.id, group.id);
                        const hasFollowUp = modifierUnlocksFollowUpGroups(
                          modifierGroups,
                          modifier.id
                        );
                        const nestedMin = getNestedMinInventoryPrice(
                          modifierGroups,
                          modifier.id
                        );
                        const pricePreview = getModifierOptionPricePreview({
                          inventoryPrice: modifier.inventory_price,
                          categoryId: modifier.category_id,
                          price: modifier.price,
                          nestedMinInventoryPrice: nestedMin,
                          allowance: getIncludedModifierAllowance(product),
                        });
                        const priceLabel =
                          pricePreview.amount === 0 ? (
                            <span style={styles.freeLabel}>Included</span>
                          ) : pricePreview.isFrom ? (
                            `from +$${pricePreview.amount.toFixed(2)}`
                          ) : (
                            `+$${pricePreview.amount.toFixed(2)}`
                          );
                        return (
                          <div
                            key={modifier.id}
                            style={{
                              ...styles.modifierItem,
                              ...(isSelected ? styles.modifierItemSelected : {}),
                            }}
                          >
                            <div style={styles.modifierDetails}>
                              <TavariCheckbox
                                checked={isSelected}
                                onChange={() => handleModifierToggle(modifier, group)}
                                size="md"
                                disabled={loading}
                              />
                              <div style={styles.modifierNameRow}>
                                <div style={styles.modifierName}>{displayModifierName(modifier, group)}</div>
                                {hasFollowUp && (
                                  <span style={styles.moreOptionsHint}>more options</span>
                                )}
                              </div>
                            </div>
                            <div style={styles.modifierPrice}>
                              {priceLabel}
                              {hasFollowUp && <span style={styles.chevron} aria-hidden>›</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          ) : modifierGroups.length > 0 ? (
            <div style={styles.noModifiersContainer}>
              Select a size or required option above to see more choices.
            </div>
          ) : (
            <div style={styles.noModifiersContainer}>
              No modifier options available for this item.
            </div>
          )}
        </div>

        {!loading && modifierGroups.length > 0 && (
          <>
            <div style={styles.summary}>
              {getIncludedModifierAllowance(product) && (
                <div style={{ ...styles.summaryRow, fontSize: '10px', opacity: 0.85 }}>
                  <span style={styles.summaryLabel}>
                    Included drinks up to ${Number(product.included_modifier_max_price).toFixed(2)} before tax
                  </span>
                </div>
              )}
              <div style={styles.summaryRow}>
                <span style={styles.summaryLabel}>Base Price:</span>
                <span style={styles.summaryValue}>${Number(product?.price || 0).toFixed(2)}</span>
              </div>
              {selectedModifiers.length > 0 && (
                <div style={styles.summaryRow}>
                  <span style={styles.summaryLabel}>Modifiers ({selectedModifiers.length}):</span>
                  <span style={styles.summaryValue}>+${modifierTotal.toFixed(2)}</span>
                </div>
              )}
              <div style={{ ...styles.summaryRow, ...styles.totalRow }}>
                <span style={styles.summaryLabel}>Total:</span>
                <span style={styles.totalValue}>${productTotal.toFixed(2)}</span>
              </div>
            </div>

            <div style={styles.actions}>
              <button style={styles.cancelBtn} onClick={onClose} disabled={loading} type="button">Cancel</button>
              <button
                style={{ ...styles.addBtn, ...(loading ? styles.addBtnDisabled : {}) }}
                onClick={handleAddToCart}
                disabled={loading}
                type="button"
              >
                {loading ? 'Adding...' : 'Add to Cart'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ModifierSelectionModal;
