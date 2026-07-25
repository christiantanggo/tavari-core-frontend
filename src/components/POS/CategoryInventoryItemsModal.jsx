import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { logAction } from '../../helpers/posAudit';
import toast from 'react-hot-toast';
import { FiMenu } from 'react-icons/fi';

/**
 * Modal: inventory rows in a POS category, drag-and-drop to set category_sort_order.
 */
export default function CategoryInventoryItemsModal({
  isOpen,
  onClose,
  category,
  businessId,
  canReorder
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draggedId, setDraggedId] = useState(null);

  const load = useCallback(async () => {
    if (!businessId || !category?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('pos_inventory')
        .select('id, name, sku, price, category_sort_order, is_active')
        .eq('business_id', businessId)
        .eq('category_id', category.id)
        .order('category_sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;
      setItems(data || []);
    } catch (e) {
      toast.error(e.message || 'Failed to load inventory for this category');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [businessId, category?.id]);

  useEffect(() => {
    if (isOpen && category?.id) {
      load();
    } else if (!isOpen) {
      setItems([]);
      setDraggedId(null);
    }
  }, [isOpen, category?.id, load]);

  const handleDragStart = (e, id) => {
    if (!canReorder) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    setDraggedId(id);
  };

  const handleDragOver = (e) => {
    if (!canReorder) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, targetId) => {
    if (!canReorder) return;
    e.preventDefault();
    const sourceId = e.dataTransfer.getData('text/plain');
    if (!sourceId || sourceId === targetId) return;
    setItems((prev) => {
      const next = [...prev];
      const from = next.findIndex((x) => x.id === sourceId);
      const to = next.findIndex((x) => x.id === targetId);
      if (from < 0 || to < 0) return prev;
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row);
      return next;
    });
    setDraggedId(null);
  };

  const handleDragEnd = () => setDraggedId(null);

  const saveOrder = async () => {
    if (!canReorder || !businessId || items.length === 0) return;
    setSaving(true);
    try {
      const results = await Promise.all(
        items.map((row, idx) =>
          supabase
            .from('pos_inventory')
            .update({
              category_sort_order: idx,
              updated_at: new Date().toISOString()
            })
            .eq('id', row.id)
            .eq('business_id', businessId)
        )
      );
      const err = results.find((r) => r.error)?.error;
      if (err) throw err;

      await logAction({
        action: 'pos_category_inventory_order_saved',
        context: 'CategoryInventoryItemsModal',
        metadata: {
          category_id: category.id,
          category_name: category.name,
          item_count: items.length
        }
      });

      toast.success('Item order saved');
      try {
        window.dispatchEvent(
          new CustomEvent('tavari:pos-inventory-updated', { detail: { businessId } })
        );
      } catch {
        /* ignore */
      }
      onClose();
    } catch (e) {
      toast.error(e.message || 'Failed to save order');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !category) return null;

  return (
    <div style={styles.modal} role="presentation" onClick={onClose}>
      <div
        style={styles.modalContent}
        role="dialog"
        aria-labelledby="category-inv-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={styles.modalHeader}>
          <h3 id="category-inv-modal-title" style={styles.modalTitle}>
            Inventory in &ldquo;{category.name}&rdquo;
          </h3>
          <button type="button" style={styles.closeButton} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div style={styles.modalBody}>
          {!canReorder && (
            <p style={styles.hint}>
              You can view items here. Drag-and-drop ordering requires category management permission.
            </p>
          )}
          {canReorder && (
            <p style={styles.hint}>
              Drag rows to set the order items appear in this category on the register and self-serve kiosk. Use
              Save order when finished.
            </p>
          )}

          {loading && <p style={styles.muted}>Loading…</p>}

          {!loading && items.length === 0 && (
            <p style={styles.muted}>No inventory items are assigned to this category yet.</p>
          )}

          {!loading && items.length > 0 && (
            <ul style={styles.list}>
              {items.map((row) => (
                <li
                  key={row.id}
                  draggable={!!canReorder}
                  onDragStart={(e) => handleDragStart(e, row.id)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, row.id)}
                  onDragEnd={handleDragEnd}
                  style={{
                    ...styles.row,
                    opacity: draggedId === row.id ? 0.65 : 1,
                    cursor: canReorder ? 'grab' : 'default'
                  }}
                >
                  {canReorder && (
                    <span style={styles.grip} aria-hidden title="Drag to reorder">
                      <FiMenu size={18} />
                    </span>
                  )}
                  <span style={styles.rowMain}>
                    <span style={styles.name}>{row.name}</span>
                    {row.sku ? <span style={styles.meta}>SKU: {row.sku}</span> : null}
                    {row.is_active === false ? <span style={styles.inactive}>Inactive</span> : null}
                  </span>
                  {row.price != null && (
                    <span style={styles.price}>${Number(row.price).toFixed(2)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={styles.modalActions}>
          <button type="button" style={styles.cancelButton} onClick={onClose}>
            {canReorder ? 'Cancel' : 'Close'}
          </button>
          {canReorder && items.length > 0 && (
            <button
              type="button"
              style={saving ? styles.disabledButton : styles.saveButton}
              onClick={saveOrder}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save order'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  modal: TavariStyles.components.modal.overlay,
  modalContent: {
    ...TavariStyles.components.modal.content,
    maxWidth: '560px',
    width: '100%'
  },
  modalHeader: TavariStyles.components.modal.header,
  modalBody: {
    ...TavariStyles.components.modal.body,
    maxHeight: 'min(70vh, 480px)',
    overflowY: 'auto'
  },
  modalActions: TavariStyles.components.modal.footer,
  modalTitle: {
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    margin: 0
  },
  closeButton: {
    backgroundColor: 'transparent',
    border: 'none',
    fontSize: TavariStyles.typography.fontSize['2xl'],
    cursor: 'pointer',
    color: TavariStyles.colors.gray500,
    padding: TavariStyles.spacing.xs
  },
  hint: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    marginTop: 0,
    marginBottom: TavariStyles.spacing.md,
    lineHeight: TavariStyles.typography.lineHeight.relaxed
  },
  muted: {
    color: TavariStyles.colors.gray500,
    fontSize: TavariStyles.typography.fontSize.sm
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.xs
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm,
    padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    backgroundColor: TavariStyles.colors.white
  },
  grip: {
    color: TavariStyles.colors.gray400,
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2
  },
  name: {
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.gray800,
    fontSize: TavariStyles.typography.fontSize.base
  },
  meta: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray500
  },
  inactive: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.warningText,
    fontWeight: TavariStyles.typography.fontWeight.medium
  },
  price: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray700,
    flexShrink: 0
  },
  cancelButton: {
    ...TavariStyles.components.button.base,
    backgroundColor: TavariStyles.colors.gray500,
    color: TavariStyles.colors.white,
    ...TavariStyles.components.button.sizes.sm
  },
  saveButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.variants.success,
    ...TavariStyles.components.button.sizes.sm
  },
  disabledButton: {
    ...TavariStyles.components.button.base,
    ...TavariStyles.components.button.sizes.sm,
    opacity: 0.6,
    cursor: 'not-allowed'
  }
};
