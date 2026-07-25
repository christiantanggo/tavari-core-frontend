import React, { useEffect, useState } from 'react';
import { FiX } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import BundleCustomizationPanel from '../POS/BundleCustomizationPanel';
import { loadBundleCustomizationContext } from '../../utils/loadBundleCustomizationContext';
import {
  buildBundleComponentModifiersPayload,
  validateBundleSlotSelections,
} from '../../utils/posBundleModifiers';

export default function PortalBundleCustomizationModal({
  open,
  businessId,
  bundleInventoryId,
  bundleName,
  initialSlotSelections = {},
  onSave,
  onClose,
  modalStyles = {},
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [slots, setSlots] = useState([]);
  const [slotModifierGroups, setSlotModifierGroups] = useState({});
  const [slotSelections, setSlotSelections] = useState(initialSlotSelections);

  useEffect(() => {
    if (!open || !businessId || !bundleInventoryId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSlotSelections(initialSlotSelections || {});

    loadBundleCustomizationContext(supabase, businessId, bundleInventoryId)
      .then((ctx) => {
        if (cancelled) return;
        setSlots(ctx.slots || []);
        setSlotModifierGroups(ctx.slotModifierGroups || {});
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load balloon options.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, businessId, bundleInventoryId, initialSlotSelections]);

  if (!open) return null;

  const overlayStyle = modalStyles.modalOverlay || {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
    padding: 16,
  };

  const contentStyle = modalStyles.modalContent || {
    backgroundColor: '#fff',
    borderRadius: 12,
    width: '100%',
    maxWidth: 560,
    maxHeight: '90vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  };

  const handleSave = () => {
    if (slots.length === 0) {
      onSave({ slotSelections: {}, bundleComponentModifiers: [] });
      return;
    }
    const validation = validateBundleSlotSelections(slots, slotSelections);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    onSave({
      slotSelections,
      bundleComponentModifiers: buildBundleComponentModifiersPayload(slots, slotSelections),
    });
  };

  return (
    <div style={overlayStyle}>
      <div style={contentStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 18 }}>Customize: {bundleName}</div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <FiX size={22} />
          </button>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
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

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 12,
            padding: '16px 20px',
            borderTop: `1px solid ${TavariStyles.colors.gray200}`,
          }}
        >
          <button type="button" onClick={onClose} style={modalStyles.footerBack || { padding: '10px 16px' }}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            style={modalStyles.footerNext || {
              padding: '10px 16px',
              backgroundColor: TavariStyles.colors.primary,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Save choices
          </button>
        </div>
      </div>
    </div>
  );
}
