// components/Bookings/BookingPaymentRefundModal.jsx
import React, { useMemo, useState } from 'react';
import { logAction } from '../../helpers/posAudit';
import { generateReceiptHTML, printReceipt, RECEIPT_TYPES } from '../../helpers/ReceiptBuilder';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import BookingPaymentService from '../../services/Bookings/BookingPaymentService';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';

function isHelcimMethod(method) {
  const m = String(method || '').toLowerCase();
  return m.includes('helcim') || m === 'credit' || m === 'debit' || m === 'card';
}

function remainingRefundable(payment) {
  const paid = Number(payment?.amount_paid) || 0;
  const refunded = Number(payment?.refund_amount) || 0;
  return Math.max(0, Math.round((paid - refunded) * 100) / 100);
}

/**
 * Staff refund for a booking_payments row — amount, reason, manager PIN,
 * Helcim (or record-only), then refund receipt print (incl. signature copy).
 */
export default function BookingPaymentRefundModal({
  payment,
  businessId,
  businessSettings = {},
  authUser,
  onClose,
  onRefundCompleted,
}) {
  const maxRefundable = useMemo(() => remainingRefundable(payment), [payment]);
  const helcimPayment = isHelcimMethod(payment?.payment_method);
  const [refundAmount, setRefundAmount] = useState(
    maxRefundable > 0 ? maxRefundable.toFixed(2) : ''
  );
  const [refundReason, setRefundReason] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [recordOnly, setRecordOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'BookingPaymentRefundModal',
  });

  const booking = payment?.bookings;
  const bookingLabel = booking?.booking_number || payment?.booking_id?.slice(0, 8) || 'Booking';

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amount = parseFloat(refundAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid refund amount greater than $0.00');
      return;
    }
    if (amount > maxRefundable + 0.001) {
      setError(`Refund cannot exceed remaining $${maxRefundable.toFixed(2)}`);
      return;
    }
    if (!refundReason.trim()) {
      setError('Please provide a reason for the refund');
      return;
    }
    if (!managerPin) {
      setError('Manager PIN is required for all refunds');
      return;
    }

    const pinOk = await auth.validateManagerPin(managerPin);
    if (!pinOk) {
      setError('Invalid manager PIN');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      BookingPaymentService.setBusinessId(businessId);
      const result = await BookingPaymentService.processRefund(payment.id, {
        amount,
        reason: refundReason.trim(),
        recordOnly: helcimPayment ? recordOnly : true,
      });

      await logAction({
        action: 'booking_payment_refund',
        context: 'BookingPaymentRefundModal',
        metadata: {
          payment_id: payment.id,
          booking_id: payment.booking_id,
          booking_number: booking?.booking_number,
          refund_amount: amount,
          fully_refunded: result.fullyRefunded,
          payment_method: payment.payment_method,
          record_only: helcimPayment ? recordOnly : true,
          refund_reason: refundReason.trim(),
          manager_id: authUser?.id,
        },
      });

      const receiptData = {
        sale_number: `BK-REFUND-${String(bookingLabel).replace(/\s/g, '').slice(-10).toUpperCase()}`,
        created_at: new Date().toISOString(),
        items: [
          {
            name: `Booking refund (${bookingLabel})`,
            quantity: 1,
            price: -amount,
            total_price: -amount,
            modifiers: [],
          },
        ],
        subtotal: -amount,
        final_total: -amount,
        tax_amount: 0,
        total: -amount,
        payments: [
          {
            method: payment.payment_method || 'refund',
            payment_method: payment.payment_method || 'refund',
            amount,
            reference_number: payment.transaction_id || null,
          },
        ],
        tip_amount: 0,
        change_given: 0,
        discount_amount: 0,
        loyalty_redemption: 0,
        aggregated_taxes: {},
        aggregated_rebates: {},
        customer_email: booking?.customer_email || null,
        customer_phone: booking?.customer_phone || null,
        refund_reason: refundReason.trim(),
        original_sale_number: bookingLabel,
        operator_user_name: authUser?.email || authUser?.id || null,
      };

      try {
        const html = await generateReceiptHTML(
          receiptData,
          RECEIPT_TYPES.REFUND,
          businessSettings,
          { refundReason: refundReason.trim() }
        );
        await printReceipt(html, {
          saleData: receiptData,
          receiptType: RECEIPT_TYPES.REFUND,
          businessSettings,
        });
      } catch (printErr) {
        console.error('Booking refund receipt print failed:', printErr);
      }

      onRefundCompleted?.(result);
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Refund failed');
    } finally {
      setLoading(false);
    }
  };

  if (maxRefundable <= 0) {
    return (
      <div style={styles.overlay} onClick={onClose}>
        <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
          <h3 style={styles.title}>Refund booking payment</h3>
          <p style={{ margin: '0 0 16px', color: '#6b7280' }}>
            This payment has already been fully refunded.
          </p>
          <button type="button" style={styles.secondaryBtn} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.title}>Refund booking payment</h3>
        <p style={styles.meta}>
          {bookingLabel}
          {booking?.customer_email ? ` · ${booking.customer_email}` : ''}
        </p>
        <p style={styles.meta}>
          Paid ${Number(payment.amount_paid || 0).toFixed(2)} · Remaining $
          {maxRefundable.toFixed(2)}
          {payment.transaction_id ? ` · H-ID ${payment.transaction_id}` : ''}
        </p>

        <form onSubmit={handleSubmit}>
          <label style={styles.label}>Refund amount</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            max={maxRefundable}
            value={refundAmount}
            onChange={(e) => setRefundAmount(e.target.value)}
            style={styles.input}
            disabled={loading}
          />

          <label style={styles.label}>Reason</label>
          <textarea
            value={refundReason}
            onChange={(e) => setRefundReason(e.target.value)}
            style={{ ...styles.input, minHeight: '80px', resize: 'vertical' }}
            disabled={loading}
            required
          />

          {helcimPayment ? (
            <div style={{ marginTop: '12px' }}>
              <TavariCheckbox
                id="booking-refund-record-only"
                checked={recordOnly}
                onChange={(next) => setRecordOnly(next)}
                label="Already refunded in Helcim (record only — do not process in Helcim again)"
                disabled={loading}
              />
              <p style={{ ...styles.meta, marginTop: '8px' }}>
                Same-day online card payments are reversed (voided) automatically when Helcim rejects a
                normal refund. Partial same-day refunds usually need to wait until the batch settles.
              </p>
            </div>
          ) : (
            <p style={{ ...styles.meta, marginTop: '12px' }}>
              Non-card payment — this will record the refund only (no Helcim chargeback).
            </p>
          )}

          <label style={styles.label}>Manager PIN</label>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={managerPin}
            onChange={(e) => setManagerPin(e.target.value)}
            style={styles.input}
            disabled={loading}
          />

          {error ? <div style={styles.error}>{error}</div> : null}

          <div style={styles.actions}>
            <button type="button" style={styles.secondaryBtn} onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" style={styles.primaryBtn} disabled={loading}>
              {loading ? 'Processing…' : 'Process refund'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: '20px',
  },
  modal: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    padding: '24px',
    width: '100%',
    maxWidth: '460px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
  },
  title: { margin: '0 0 8px', fontSize: '18px', fontWeight: 700, color: '#111827' },
  meta: { margin: '0 0 4px', fontSize: '13px', color: '#6b7280' },
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: 600,
    marginBottom: '6px',
    marginTop: '12px',
    color: '#374151',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '14px',
    boxSizing: 'border-box',
  },
  error: {
    marginTop: '12px',
    padding: '10px 12px',
    backgroundColor: '#fef2f2',
    color: '#b91c1c',
    borderRadius: '8px',
    fontSize: '13px',
  },
  actions: {
    display: 'flex',
    gap: '10px',
    marginTop: '16px',
    justifyContent: 'flex-end',
  },
  primaryBtn: {
    padding: '10px 16px',
    backgroundColor: TavariStyles.colors.primary || '#008080',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  secondaryBtn: {
    padding: '10px 16px',
    backgroundColor: '#fff',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontWeight: 600,
    cursor: 'pointer',
  },
};
