import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../utils/TavariStyles';
import invoiceService from '../../services/Invoices/invoiceService';

export default function InvoiceRefundModal({ invoice, businessId, userId, onClose, onRefunded }) {
  const maxRefundable = Number(invoice?.total) || 0;
  const [amount, setAmount] = useState(maxRefundable.toFixed(2));
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const refundAmount = Number(amount);
    if (!refundAmount || refundAmount <= 0) {
      toast.error('Enter a valid refund amount');
      return;
    }
    if (refundAmount > maxRefundable + 0.001) {
      toast.error('Refund cannot exceed invoice total');
      return;
    }
    if (!reason.trim()) {
      toast.error('Refund reason is required');
      return;
    }

    setSubmitting(true);
    try {
      invoiceService.setBusinessId(businessId);
      await invoiceService.processRefund(invoice.id, {
        userId,
        amount: refundAmount,
        reason: reason.trim(),
        isFull: Math.abs(refundAmount - maxRefundable) < 0.01,
      });
      toast.success('Refund recorded');
      onRefunded?.();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Refund failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Refund invoice {invoice.invoice_number}</h3>
        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>Refund amount</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            max={maxRefundable}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={inputStyle}
          />
          <label style={labelStyle}>Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ ...inputStyle, minHeight: '80px' }}
            required
          />
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={secondaryBtn}>Cancel</button>
            <button type="submit" disabled={submitting} style={primaryBtn}>
              {submitting ? 'Processing…' : 'Process refund'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
  padding: '20px',
};

const modalStyle = {
  backgroundColor: '#fff',
  borderRadius: '12px',
  padding: '24px',
  width: '100%',
  maxWidth: '440px',
  boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
};

const labelStyle = { display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', marginTop: '12px' };
const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  fontSize: '14px',
  boxSizing: 'border-box',
};

const primaryBtn = {
  padding: '10px 16px',
  backgroundColor: TavariStyles.colors.primary || '#008080',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtn = {
  ...primaryBtn,
  backgroundColor: '#fff',
  color: '#374151',
  border: '1px solid #d1d5db',
};
