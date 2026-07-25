import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';

export default function PublicInvoiceEtransferConfirmPage() {
  const { confirmToken } = useParams();
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [payload, setPayload] = useState(null);
  const [confirmed, setConfirmed] = useState(false);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
      const res = await fetch(
        `${supabaseUrl}/functions/v1/invoice-etransfer-confirm?token=${encodeURIComponent(confirmToken)}`,
        {
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Invalid confirmation link');
      setPayload(data);
      if (!data.canConfirm || data.invoice?.status === 'paid') {
        setConfirmed(true);
      }
    } catch (err) {
      toast.error(err.message || 'Could not load invoice');
    } finally {
      setLoading(false);
    }
  }, [confirmToken]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const { data, error } = await supabase.functions.invoke('invoice-etransfer-confirm', {
        body: { confirmToken },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      setConfirmed(true);
      toast.success('Invoice marked paid — e-transfer confirmed');
      loadPreview();
    } catch (err) {
      toast.error(err.message || 'Confirmation failed');
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return <div style={pageStyle}>Loading…</div>;
  }

  if (!payload?.invoice) {
    return <div style={pageStyle}>This confirmation link is invalid or has expired.</div>;
  }

  const { invoice, business } = payload;
  const balanceDue = Number(invoice.balance_due) || 0;

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={{ marginTop: 0, fontSize: '23px' }}>Confirm e-transfer</h1>
        <p style={{ color: '#6b7280', marginTop: 0 }}>
          {business?.name || 'Business'} — manager confirmation
        </p>

        <div style={{ marginTop: '16px', fontSize: '14px' }}>
          <div><strong>Invoice:</strong> {invoice.invoice_number}</div>
          <div><strong>Customer:</strong> {invoice.recipient_name}</div>
          {invoice.recipient_email && (
            <div><strong>Email:</strong> {invoice.recipient_email}</div>
          )}
          <div><strong>Amount:</strong> ${Number(invoice.total).toFixed(2)}</div>
          {invoice.etransfer_customer_notified_at && (
            <div style={{ marginTop: '8px', color: '#6b7280' }}>
              Customer notified: {new Date(invoice.etransfer_customer_notified_at).toLocaleString()}
            </div>
          )}
        </div>

        {confirmed || balanceDue <= 0 || invoice.status === 'paid' ? (
          <div style={successStyle}>
            This invoice is paid in full. E-transfer confirmation complete.
          </div>
        ) : (
          <>
            <p style={{ fontSize: '14px', marginTop: '20px' }}>
              Only tap below after the e-transfer has arrived in your bank account.
            </p>
            <button type="button" onClick={handleConfirm} disabled={confirming} style={confirmBtnStyle}>
              {confirming ? 'Confirming…' : 'E-transfer received'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const pageStyle = {
  minHeight: '100vh',
  backgroundColor: '#f3f4f6',
  padding: '40px 20px',
  boxSizing: 'border-box',
};

const cardStyle = {
  maxWidth: '560px',
  margin: '0 auto',
  backgroundColor: '#fff',
  borderRadius: '12px',
  border: '1px solid #e5e7eb',
  padding: '28px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
};

const confirmBtnStyle = {
  marginTop: '8px',
  width: '100%',
  padding: '14px 20px',
  backgroundColor: TavariStyles.colors.primary || '#008080',
  color: '#fff',
  border: 'none',
  borderRadius: '10px',
  fontSize: '16px',
  fontWeight: 700,
  cursor: 'pointer',
};

const successStyle = {
  marginTop: '24px',
  padding: '14px',
  backgroundColor: '#ecfdf5',
  color: '#065f46',
  borderRadius: '8px',
  fontWeight: 600,
  textAlign: 'center',
};
