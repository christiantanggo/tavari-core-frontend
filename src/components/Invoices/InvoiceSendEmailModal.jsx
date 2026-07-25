import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import { parseInvoiceEmailList } from '../../utils/invoiceEmailUtils';

export default function InvoiceSendEmailModal({
  invoice,
  isResend = false,
  onClose,
  onSend,
}) {
  const [emailInput, setEmailInput] = useState(invoice?.recipient_email || '');
  const [updatePrimary, setUpdatePrimary] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setEmailInput(invoice?.recipient_email || '');
  }, [invoice?.recipient_email]);

  const parsedPreview = parseInvoiceEmailList(emailInput);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const recipients = parseInvoiceEmailList(emailInput);
    if (!recipients.length) {
      toast.error('Enter at least one valid email address');
      return;
    }

    setSending(true);
    try {
      await onSend({
        recipients,
        updatePrimaryEmail: updatePrimary,
      });
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to send invoice email');
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(ev) => ev.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>
          {isResend ? 'Resend invoice' : 'Send invoice'} {invoice?.invoice_number}
        </h3>
        <p style={{ margin: '0 0 16px', fontSize: '14px', color: '#6b7280' }}>
          Separate multiple addresses with commas. Each person receives their own copy with the PDF attached.
        </p>

        <form onSubmit={handleSubmit}>
          <label style={labelStyle}>To</label>
          <textarea
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="customer@example.com, billing@example.com"
            style={{ ...inputStyle, minHeight: '72px', resize: 'vertical' }}
            required
          />
          {parsedPreview.length > 0 && (
            <div style={hintStyle}>
              Sending to {parsedPreview.length} recipient{parsedPreview.length === 1 ? '' : 's'}:{' '}
              {parsedPreview.join(', ')}
            </div>
          )}

          <div style={{ marginTop: '14px' }}>
            <TavariCheckbox
              checked={updatePrimary}
              onChange={(checked) => setUpdatePrimary(checked)}
              label="Save first email as the bill-to address on this invoice"
              size="sm"
            />
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={secondaryBtn} disabled={sending}>
              Cancel
            </button>
            <button type="submit" disabled={sending || parsedPreview.length === 0} style={primaryBtn}>
              {sending ? 'Sending…' : isResend ? 'Resend email' : 'Send email'}
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
  zIndex: 1000,
  padding: '16px',
};

const modalStyle = {
  backgroundColor: '#fff',
  borderRadius: '12px',
  padding: '24px',
  width: '100%',
  maxWidth: '520px',
  boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
};

const labelStyle = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 600,
  marginBottom: '6px',
  color: '#374151',
};

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  fontSize: '14px',
  boxSizing: 'border-box',
};

const hintStyle = {
  marginTop: '8px',
  fontSize: '13px',
  color: '#059669',
};

const btnBase = {
  padding: '10px 16px',
  borderRadius: '8px',
  fontWeight: 600,
  fontSize: '14px',
  cursor: 'pointer',
  border: 'none',
};

const primaryBtn = {
  ...btnBase,
  backgroundColor: TavariStyles.colors.primary || '#008080',
  color: '#fff',
};

const secondaryBtn = {
  ...btnBase,
  backgroundColor: '#fff',
  color: '#374151',
  border: '1px solid #d1d5db',
};
