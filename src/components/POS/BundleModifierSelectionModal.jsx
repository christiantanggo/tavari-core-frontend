// Single-modal bundle customization for POS (all balloon slots at once).
import React, { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import BundleCustomizationPanel from './BundleCustomizationPanel';
import { loadBundleCustomizationContext } from '../../utils/loadBundleCustomizationContext';
import {
  buildBundleComponentModifiersPayload,
  flattenBundleComponentModifiersForDisplay,
  validateBundleSlotSelections,
} from '../../utils/posBundleModifiers';

const BundleModifierSelectionModal = ({
  isOpen,
  onClose,
  product,
  businessId,
  onAddToCart,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [slots, setSlots] = useState([]);
  const [slotModifierGroups, setSlotModifierGroups] = useState({});
  const [slotSelections, setSlotSelections] = useState({});

  useEffect(() => {
    if (!isOpen || !product?.id || !businessId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSlotSelections({});

    loadBundleCustomizationContext(supabase, businessId, product.id)
      .then((ctx) => {
        if (cancelled) return;
        setSlots(ctx.slots || []);
        setSlotModifierGroups(ctx.slotModifierGroups || {});
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load bundle customization options.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, product?.id, businessId]);

  const handleConfirm = () => {
    if (slots.length === 0) {
      onAddToCart({
        ...product,
        is_bundle: true,
        modifiers: [],
        bundle_component_modifiers: [],
      });
      onClose();
      return;
    }

    const validation = validateBundleSlotSelections(slots, slotSelections);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }

    const bundleComponentModifiers = buildBundleComponentModifiersPayload(slots, slotSelections);
    onAddToCart({
      ...product,
      is_bundle: true,
      modifiers: flattenBundleComponentModifiersForDisplay(bundleComponentModifiers),
      bundle_component_modifiers: bundleComponentModifiers,
    });
    onClose();
  };

  const styles = {
    backdrop: { ...TavariStyles.components.modal.overlay, zIndex: 1500 },
    modal: {
      ...TavariStyles.components.modal.content,
      width: '640px',
      maxWidth: '92vw',
      maxHeight: '85vh',
      padding: 0,
      display: 'flex',
      flexDirection: 'column',
    },
    header: {
      ...TavariStyles.components.modal.header,
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
    },
    title: {
      margin: 0,
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
    },
    closeBtn: {
      backgroundColor: 'transparent',
      border: 'none',
      fontSize: TavariStyles.typography.fontSize['2xl'],
      cursor: 'pointer',
      color: TavariStyles.colors.white,
    },
    content: { ...TavariStyles.components.modal.body, overflowY: 'auto', flex: 1 },
    actions: { ...TavariStyles.components.modal.footer },
    cancelBtn: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.lg,
    },
    addBtn: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg,
    },
  };

  if (!isOpen) return null;

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={styles.title}>{product?.name || 'Bundle'}</h3>
          <button style={styles.closeBtn} onClick={onClose} type="button" disabled={loading}>
            ×
          </button>
        </div>

        <div style={styles.content}>
          <BundleCustomizationPanel
            subtitle="Choose a style for each balloon in this bouquet."
            slots={slots}
            slotModifierGroups={slotModifierGroups}
            slotSelections={slotSelections}
            onSlotSelectionChange={(slotKey, selected) =>
              setSlotSelections((prev) => ({ ...prev, [slotKey]: selected }))
            }
            loading={loading}
            error={error}
          />
        </div>

        {!loading && (
          <div style={styles.actions}>
            <button style={styles.cancelBtn} type="button" onClick={onClose}>
              Cancel
            </button>
            <button style={styles.addBtn} type="button" onClick={handleConfirm}>
              Add to Cart
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default BundleModifierSelectionModal;
