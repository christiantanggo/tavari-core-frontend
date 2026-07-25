import React, { useState } from 'react';
import { FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import bookingService from '../../services/Bookings/BookingService';

const lbl = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 13,
  fontWeight: 600,
  color: TavariStyles.colors.gray700,
};

const inp = {
  padding: '8px 10px',
  borderRadius: 6,
  border: `1px solid ${TavariStyles.colors.gray300}`,
  fontSize: 14,
  boxSizing: 'border-box',
  width: '100%',
};

const hint = { fontSize: 13, color: TavariStyles.colors.gray600, margin: 0 };

const btnSecondary = {
  padding: '8px 14px',
  borderRadius: 8,
  border: `1px solid ${TavariStyles.colors.gray300}`,
  background: TavariStyles.colors.white,
  cursor: 'pointer',
  fontWeight: 600,
};

const btnPrimary = {
  padding: '8px 14px',
  borderRadius: 8,
  border: 'none',
  background: TavariStyles.colors.primary,
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
};

export default function BookingAdditionalItemModal({
  open,
  bookingId,
  businessId,
  taxRows = [],
  onClose,
  onSaved,
  getAuditContext,
}) {
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('0');
  const [taxExempt, setTaxExempt] = useState(false);
  const [selectedTaxIds, setSelectedTaxIds] = useState(() => new Set());
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const resetForm = () => {
    setDescription('');
    setQuantity('1');
    setUnitPrice('0');
    setTaxExempt(false);
    setSelectedTaxIds(new Set());
  };

  const handleClose = () => {
    if (submitting) return;
    resetForm();
    onClose?.();
  };

  const submit = async () => {
    const q = Math.max(1, parseInt(quantity, 10) || 1);
    const price = Number.parseFloat(unitPrice);
    if (!description.trim()) {
      toast.error('Enter a description');
      return;
    }
    if (!Number.isFinite(price)) {
      toast.error('Enter a valid price');
      return;
    }

    setSubmitting(true);
    try {
      bookingService.setBusinessId(businessId);
      const audit = getAuditContext ? await getAuditContext() : {};
      const taxRateIds = taxExempt ? [] : [...selectedTaxIds];
      await bookingService.addManualAddonLinesToBooking(
        bookingId,
        [{
          addonName: description.trim(),
          quantity: q,
          unitPrice: price,
          taxRateIds,
        }],
        audit,
      );
      toast.success('Item added');
      resetForm();
      await onSaved?.();
      onClose?.();
    } catch (error) {
      toast.error(error?.message || 'Failed to add item');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 20000,
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      role="presentation"
      onClick={handleClose}
    >
      <div
        style={{
          background: TavariStyles.colors.white,
          borderRadius: TavariStyles.borderRadius?.lg || 12,
          maxWidth: 440,
          width: '100%',
          padding: TavariStyles.spacing?.lg || 24,
          boxShadow: TavariStyles.shadows?.xl || TavariStyles.shadows?.lg || '0 20px 40px rgba(0,0,0,0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-additional-item-modal-title"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <h3 id="booking-additional-item-modal-title" style={{ margin: 0, fontSize: 18 }}>
            Add additional item
          </h3>
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            aria-label="Close"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: submitting ? 'not-allowed' : 'pointer',
              color: TavariStyles.colors.gray500,
              padding: 4,
            }}
          >
            <FiX size={20} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={lbl}>
            Description
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={inp}
              placeholder="e.g. Extra harness"
              autoFocus
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={lbl}>
              Quantity
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                style={inp}
              />
            </label>
            <label style={lbl}>
              Unit price
              <input
                type="number"
                step="0.01"
                min={0}
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                style={inp}
              />
            </label>
          </div>

          <div
            style={{
              border: `1px solid ${TavariStyles.colors.gray200}`,
              borderRadius: 8,
              padding: 10,
              maxHeight: 180,
              overflowY: 'auto',
            }}
          >
            <div style={{ marginBottom: 8 }}>
              <TavariCheckbox
                id="booking-additional-item-tax-exempt"
                appearance="native"
                checked={taxExempt}
                onChange={(checked) => setTaxExempt(!!checked)}
                label="Tax exempt (no taxes)"
                size="md"
              />
            </div>
            {!taxExempt ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Taxes</div>
                {taxRows.length === 0 ? (
                  <p style={hint}>No active tax categories.</p>
                ) : (
                  taxRows.map((tax) => (
                    <div key={tax.id} style={{ marginBottom: 6 }}>
                      <TavariCheckbox
                        id={`booking-additional-item-tax-${tax.id}`}
                        appearance="native"
                        checked={selectedTaxIds.has(tax.id)}
                        onChange={(checked) => {
                          setSelectedTaxIds((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(tax.id);
                            else next.delete(tax.id);
                            return next;
                          });
                        }}
                        label={`${tax.name} (${((Number(tax.rate) || 0) * 100).toFixed(2)}%)`}
                        size="sm"
                      />
                    </div>
                  ))
                )}
              </>
            ) : null}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={handleClose} disabled={submitting} style={btnSecondary}>
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={submitting} style={btnPrimary}>
              {submitting ? 'Adding…' : 'Add item'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
