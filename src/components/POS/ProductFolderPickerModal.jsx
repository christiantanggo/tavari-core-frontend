import React from 'react';
import { TavariStyles } from '../../utils/TavariStyles';

/**
 * Second-step picker when staff tap a register folder tile (e.g. Bubly → flavours).
 */
const ProductFolderPickerModal = ({
  isOpen,
  onClose,
  folderProduct,
  childrenProducts = [],
  onSelectChild,
  formatPrice,
}) => {
  const displayName = (child) => {
    const full = String(child?.name || '');
    const folder = String(folderProduct?.name || '').trim();
    if (folder) {
      const prefix = `${folder} - `;
      if (full.toLowerCase().startsWith(prefix.toLowerCase())) {
        return full.slice(prefix.length);
      }
    }
    return full;
  };

  const sortedChildren = [...(childrenProducts || [])].sort((a, b) =>
    String(displayName(a) || '').localeCompare(String(displayName(b) || ''), undefined, {
      sensitivity: 'base',
    })
  );

  const styles = {
    backdrop: { ...TavariStyles.components.modal.overlay, zIndex: 1500 },
    modal: {
      ...TavariStyles.components.modal.content,
      width: '520px',
      maxWidth: '92vw',
      maxHeight: '80vh',
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
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
    },
    closeBtn: {
      backgroundColor: 'transparent',
      border: 'none',
      fontSize: TavariStyles.typography.fontSize['2xl'],
      cursor: 'pointer',
      color: TavariStyles.colors.white,
      padding: TavariStyles.spacing.xs,
      borderRadius: TavariStyles.borderRadius.sm,
      width: '32px',
      height: '32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    content: {
      ...TavariStyles.components.modal.body,
      overflowY: 'auto',
      flex: 1,
    },
    hint: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.md,
    },
    list: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm,
    },
    row: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.md,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius.md,
      backgroundColor: TavariStyles.colors.white,
      cursor: 'pointer',
      textAlign: 'left',
      width: '100%',
      font: 'inherit',
    },
    rowDisabled: {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
    name: {
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
    },
    meta: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      marginTop: 2,
    },
    price: {
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      whiteSpace: 'nowrap',
    },
    empty: {
      textAlign: 'center',
      color: TavariStyles.colors.gray500,
      padding: TavariStyles.spacing['3xl'],
    },
    footer: { ...TavariStyles.components.modal.footer },
    cancelBtn: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.lg,
    },
  };

  const isOutOfStock = (product) =>
    product.track_stock && (product.stock_quantity || 0) <= 0;

  if (!isOpen || !folderProduct) return null;

  return (
    <div style={styles.backdrop}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3 style={styles.title}>{folderProduct.name}</h3>
          <button type="button" style={styles.closeBtn} onClick={onClose}>
            ×
          </button>
        </div>

        <div style={styles.content}>
          <p style={styles.hint}>Select a flavour</p>
          {sortedChildren.length === 0 ? (
            <div style={styles.empty}>No items in this folder.</div>
          ) : (
            <div style={styles.list}>
              {sortedChildren.map((child) => {
                const out = isOutOfStock(child);
                return (
                  <button
                    key={child.id}
                    type="button"
                    style={{
                      ...styles.row,
                      ...(out ? styles.rowDisabled : {}),
                    }}
                    disabled={out}
                    onClick={() => {
                      if (!out) onSelectChild(child);
                    }}
                  >
                    <div>
                      <div style={styles.name}>{displayName(child)}</div>
                      {out && <div style={styles.meta}>Out of stock</div>}
                      {!out && child.track_stock && (
                        <div style={styles.meta}>
                          Stock: {child.stock_quantity || 0}
                        </div>
                      )}
                    </div>
                    <div style={styles.price}>
                      {typeof formatPrice === 'function'
                        ? formatPrice(child)
                        : `$${Number(
                            Number(child.price) > 0
                              ? child.price
                              : folderProduct?.price || 0
                          ).toFixed(2)}`}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={styles.footer}>
          <button type="button" style={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductFolderPickerModal;
