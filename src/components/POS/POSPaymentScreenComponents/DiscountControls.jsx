// components/POS/POSPaymentScreenComponents/DiscountControls.jsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../../../supabaseClient';
import { TavariStyles } from '../../../utils/TavariStyles';

/**
 * Compute dollar discount from a catalog row or custom entry.
 * percentage values are stored as 0–100 (e.g. 25 = 25% off).
 */
export function computeDiscountAmount(discount, subtotal) {
  const safeSubtotal = Math.max(0, Number(subtotal) || 0);
  if (!discount || safeSubtotal <= 0) return 0;

  const value = Number(discount.value) || 0;
  let amount = 0;

  if (discount.type === 'percentage') {
    amount = safeSubtotal * (value / 100);
  } else {
    amount = value;
  }

  return Math.round(Math.min(Math.max(0, amount), safeSubtotal) * 100) / 100;
}

const formatDiscountLabel = (discount) => {
  if (!discount) return '';
  if (discount.type === 'percentage') {
    return `${discount.name} (${Number(discount.value)}%)`;
  }
  return `${discount.name} ($${Number(discount.value).toFixed(2)})`;
};

/**
 * @param {object} props
 * @param {number} props.saleSubtotal
 * @param {number} props.discountAmount
 * @param {string|null} props.discountName
 * @param {string|null} props.selectedDiscountId
 * @param {(payload: { amount: number, discount: object|null }) => void} props.onDiscountChange
 * @param {string} props.businessId
 * @param {boolean} props.canApply
 */
const DiscountControls = ({
  saleSubtotal = 0,
  discountAmount = 0,
  discountName = null,
  selectedDiscountId = null,
  onDiscountChange,
  businessId,
  canApply = false
}) => {
  const [discounts, setDiscounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [customMode, setCustomMode] = useState(null); // 'percentage' | 'fixed' | null
  const [customValue, setCustomValue] = useState('');

  useEffect(() => {
    if (!businessId || !canApply) return;

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('pos_discounts')
          .select('id, name, type, value, recurring, is_active, manager_required')
          .eq('business_id', businessId)
          .order('name', { ascending: true });

        if (error) {
          // Fall back to core columns if optional fields are missing on this DB
          const fallback = await supabase
            .from('pos_discounts')
            .select('id, name, type, value, recurring')
            .eq('business_id', businessId)
            .order('name', { ascending: true });
          if (!cancelled && !fallback.error) {
            setDiscounts(fallback.data || []);
          }
        } else if (!cancelled) {
          const rows = (data || []).filter((d) => d.is_active !== false);
          setDiscounts(rows);
        }
      } catch {
        // ignore — custom discount still works
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [businessId, canApply]);

  if (!canApply) {
    return null;
  }

  const applyCatalogDiscount = (discount) => {
    setCustomMode(null);
    setCustomValue('');
    const amount = computeDiscountAmount(discount, saleSubtotal);
    onDiscountChange?.({
      amount,
      discount: {
        id: discount.id,
        name: discount.name,
        type: discount.type,
        value: Number(discount.value)
      }
    });
  };

  const clearDiscount = () => {
    setCustomMode(null);
    setCustomValue('');
    onDiscountChange?.({ amount: 0, discount: null });
  };

  const applyCustom = (type) => {
    const raw = Number(customValue);
    if (!Number.isFinite(raw) || raw <= 0) return;

    const discount = {
      id: null,
      name: type === 'percentage' ? `Custom ${raw}%` : `Custom $${raw.toFixed(2)}`,
      type,
      value: raw
    };
    const amount = computeDiscountAmount(discount, saleSubtotal);
    onDiscountChange?.({ amount, discount });
  };

  const styles = {
    section: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing.xl
    },
    sectionTitle: {
      margin: 0,
      marginBottom: TavariStyles.spacing.lg,
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      borderBottom: `2px solid ${TavariStyles.colors.primary}`,
      paddingBottom: TavariStyles.spacing.sm
    },
    tipControls: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      flexWrap: 'wrap',
      alignItems: 'center'
    },
    tipButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.sm
    },
    activeButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.sm
    },
    noTipButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.ghost,
      ...TavariStyles.components.button.sizes.sm,
      border: `2px solid ${TavariStyles.colors.gray400}`,
      color: TavariStyles.colors.gray600,
      fontWeight: TavariStyles.typography.fontWeight.semibold
    },
    customTipInput: {
      ...TavariStyles.components.form.input,
      width: '110px',
      textAlign: 'center'
    },
    tipDisplay: {
      marginTop: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.danger,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    hint: {
      marginTop: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray500
    },
    customRow: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      flexWrap: 'wrap',
      alignItems: 'center',
      marginTop: TavariStyles.spacing.md
    }
  };

  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>Discount</h3>
      <div style={styles.tipControls}>
        <button type="button" style={styles.noTipButton} onClick={clearDiscount}>
          No Discount
        </button>

        {discounts.map((d) => {
          const active = selectedDiscountId === d.id;
          return (
            <button
              key={d.id}
              type="button"
              style={active ? styles.activeButton : styles.tipButton}
              onClick={() => applyCatalogDiscount(d)}
              title={formatDiscountLabel(d)}
            >
              {formatDiscountLabel(d)}
            </button>
          );
        })}

        <button
          type="button"
          style={customMode === 'percentage' ? styles.activeButton : styles.tipButton}
          onClick={() => {
            setCustomMode('percentage');
            setCustomValue(customMode === 'percentage' ? customValue : '25');
          }}
        >
          Custom %
        </button>
        <button
          type="button"
          style={customMode === 'fixed' ? styles.activeButton : styles.tipButton}
          onClick={() => {
            setCustomMode('fixed');
            setCustomValue(customMode === 'fixed' ? customValue : '');
          }}
        >
          Custom $
        </button>
      </div>

      {customMode && (
        <div style={styles.customRow}>
          <input
            type="number"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            style={styles.customTipInput}
            placeholder={customMode === 'percentage' ? '%' : '$'}
            step={customMode === 'percentage' ? '1' : '0.01'}
            min="0"
            max={customMode === 'percentage' ? '100' : undefined}
            onFocus={(e) => e.target.select()}
          />
          <button
            type="button"
            style={styles.activeButton}
            onClick={() => applyCustom(customMode)}
          >
            Apply
          </button>
        </div>
      )}

      {discountAmount > 0 && (
        <div style={styles.tipDisplay}>
          Applied: {discountName || 'Discount'} −${Number(discountAmount).toFixed(2)}
          {saleSubtotal > 0
            ? ` (${((discountAmount / saleSubtotal) * 100).toFixed(1)}% of subtotal)`
            : ''}
        </div>
      )}

      {!loading && discounts.length === 0 && (
        <div style={styles.hint}>
          No saved discounts yet — use Custom % or Custom $ (e.g. 25% staff discount), or add discounts under POS → Discounts.
        </div>
      )}
    </div>
  );
};

export default DiscountControls;
