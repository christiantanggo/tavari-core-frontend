import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { appendHelcimPayIframeCompat } from '../../helpers/helcimPayIframe';
import { TavariStyles } from '../../utils/TavariStyles';

const HELCIM_PAY_SCRIPT_URL = 'https://secure.helcim.app/helcim-pay/services/start.js';

export default function PublicInvoicePayPage() {
  const { payToken } = useParams();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [payload, setPayload] = useState(null);
  const [etransferPending, setEtransferPending] = useState(false);
  const [etransferNotifying, setEtransferNotifying] = useState(false);
  const helcimRef = useRef({ checkoutToken: null });
  const finalizedRef = useRef(false);

  const loadInvoice = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('invoice-public-view', {
        body: { payToken },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Invoice not found');
      setPayload(data);
      if (Number(data.invoice?.balance_due) <= 0 || data.invoice?.status === 'paid') {
        setPaid(true);
        setEtransferPending(false);
      } else if (data.invoice?.etransfer_customer_notified_at) {
        setEtransferPending(true);
      }
    } catch (err) {
      toast.error(err.message || 'Could not load invoice');
    } finally {
      setLoading(false);
    }
  }, [payToken]);

  useEffect(() => {
    loadInvoice();
  }, [loadInvoice]);

  useEffect(() => {
    if (searchParams.get('src') !== 'email') return;
    const token = payload?.invoice?.email_tracking_token;
    if (!token) return;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
    fetch(`${supabaseUrl}/functions/v1/invoice-track?token=${encodeURIComponent(token)}&event=click`, {
      mode: 'no-cors',
    }).catch(() => {});
  }, [payload, searchParams]);

  useEffect(() => {
    if (!etransferPending || paid) return undefined;
    const timer = setInterval(() => {
      loadInvoice();
    }, 15000);
    return () => clearInterval(timer);
  }, [etransferPending, paid, loadInvoice]);

  const handleEtransferNotify = async () => {
    if (!payToken || etransferNotifying) return;
    setEtransferNotifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('invoice-etransfer-notify', {
        body: {
          payToken,
          siteUrl: window.location.origin,
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      if (data?.alreadyPaid) {
        setPaid(true);
        toast.success('This invoice is already paid');
        return;
      }
      setEtransferPending(true);
      if (data?.warning) {
        toast.error(data.warning);
      } else {
        toast.success('Thanks — we notified the business. Send your e-transfer when ready.');
      }
      loadInvoice();
    } catch (err) {
      toast.error(err.message || 'Could not send notification');
    } finally {
      setEtransferNotifying(false);
    }
  };

  const ensureHelcimScript = async () => {
    if (document.querySelector(`script[src="${HELCIM_PAY_SCRIPT_URL}"]`)) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = HELCIM_PAY_SCRIPT_URL;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load payment form'));
      document.head.appendChild(script);
    });
  };

  const handlePay = async () => {
    if (!payToken || paying) return;
    setPaying(true);
    try {
      const { data, error } = await supabase.functions.invoke('invoice-helcim-pay-init', {
        body: { payToken },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Could not start payment');

      const checkoutToken = data.checkoutToken;
      if (!checkoutToken) throw new Error('No checkout token');

      await ensureHelcimScript();
      helcimRef.current.checkoutToken = checkoutToken;

      const onMessage = async (event) => {
        const key = `helcim-pay-js-${checkoutToken}`;
        if (event.data?.eventName !== key) return;

        if (event.data.eventStatus === 'SUCCESS') {
          if (finalizedRef.current) return;
          try {
            const { data: finData, error: finError } = await supabase.functions.invoke('invoice-helcim-pay-finalize', {
              body: { checkoutToken, eventMessage: event.data.eventMessage },
            });
            if (finError || finData?.error) throw new Error(finData?.error || finError?.message);
            finalizedRef.current = true;
            setPaid(true);
            toast.success('Payment successful — thank you!');
            document.getElementById('helcimPayIframe')?.remove();
            window.removeEventListener('message', onMessage);
            loadInvoice();
          } catch (err) {
            toast.error(err.message || 'Payment verification failed');
          }
        }

        if (event.data.eventStatus === 'HIDE') {
          const poll = setInterval(async () => {
            const { data: statusData } = await supabase.functions.invoke('helcim-pay-status', {
              body: { checkoutToken },
            });
            if (statusData?.status === 'completed' && statusData?.sessionKind === 'invoice') {
              clearInterval(poll);
              if (!finalizedRef.current) {
                finalizedRef.current = true;
                setPaid(true);
                toast.success('Payment successful!');
                loadInvoice();
              }
            }
          }, 3000);
          setTimeout(() => clearInterval(poll), 120000);
        }

        if (event.data.eventStatus === 'ABORTED') {
          toast.error('Payment cancelled');
          setPaying(false);
        }
      };

      window.addEventListener('message', onMessage);
      appendHelcimPayIframeCompat(checkoutToken, true, '', payload?.invoice?.recipient_email || '');
    } catch (err) {
      toast.error(err.message || 'Payment unavailable');
      setPaying(false);
    }
  };

  if (loading) {
    return <div style={pageStyle}>Loading invoice…</div>;
  }

  if (!payload?.invoice) {
    return <div style={pageStyle}>Invoice not found.</div>;
  }

  const { invoice, business } = payload;
  const balanceDue = Number(invoice.balance_due) || 0;

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            {business?.logo_url && (
              <img src={business.logo_url} alt="" style={{ maxHeight: '64px', marginBottom: '12px' }} />
            )}
            <h1 style={{ margin: '0 0 4px', fontSize: '23px' }}>{business?.name || 'Invoice'}</h1>
            {business?.dba && <div style={{ color: '#6b7280' }}>DBA: {business.dba}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700, fontSize: '18px' }}>{invoice.invoice_number}</div>
            {invoice.due_date && <div style={{ color: '#6b7280' }}>Due {invoice.due_date}</div>}
          </div>
        </div>

        <div style={{ marginTop: '20px', fontSize: '14px' }}>
          <strong>Bill to:</strong> {invoice.recipient_name}
          {invoice.recipient_company ? ` · ${invoice.recipient_company}` : ''}
        </div>

        <table style={{ width: '100%', marginTop: '20px', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ textAlign: 'left', padding: '8px 4px' }}>Item</th>
              <th style={{ textAlign: 'right', padding: '8px 4px' }}>Qty</th>
              <th style={{ textAlign: 'right', padding: '8px 4px' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {(invoice.tavari_invoice_line_items || []).map((line) => (
              <tr key={line.name + line.unit_price} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 4px' }}>
                  {line.name}
                  {line.participant_name && (
                    <div style={{ fontSize: '13px', color: '#6b7280' }}>{line.participant_name}</div>
                  )}
                </td>
                <td style={{ padding: '8px 4px', textAlign: 'right' }}>{line.quantity}</td>
                <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                  ${Number(line.total_price ?? line.quantity * line.unit_price).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: '16px', textAlign: 'right', fontSize: '16px' }}>
          <div>Total: <strong>${Number(invoice.total).toFixed(2)}</strong></div>
          {balanceDue > 0 && (
            <div style={{ color: '#dc2626', fontWeight: 700, marginTop: '4px' }}>
              Balance due: ${balanceDue.toFixed(2)}
            </div>
          )}
        </div>

        {paid || balanceDue <= 0 ? (
          <div style={paidBannerStyle}>This invoice is paid in full. Thank you!</div>
        ) : (
          <>
            <button type="button" onClick={handlePay} disabled={paying} style={payBtnStyle}>
              {paying ? 'Opening secure payment…' : `Pay $${balanceDue.toFixed(2)} now`}
            </button>
            {business?.email && (
              <div style={eTransferStyle}>
                <div style={eTransferHeaderStyle}>
                  <div>
                    <strong>E-Transfer alternative</strong>
                    <div>Send to: {business.email}</div>
                    <div>For password enter: {business.e_transfer_password_hint || 'Tanggo'}</div>
                  </div>
                  {!etransferPending ? (
                    <button
                      type="button"
                      onClick={handleEtransferNotify}
                      disabled={etransferNotifying}
                      style={eTransferBtnStyle}
                    >
                      {etransferNotifying ? 'Sending…' : 'Paying by e-transfer'}
                    </button>
                  ) : (
                    <div style={eTransferPendingBadgeStyle}>Notification sent</div>
                  )}
                </div>
                {etransferPending && (
                  <div style={eTransferNoteStyle}>
                    We've notified {business?.name || 'the business'}. Once they confirm your e-transfer,
                    this page will update to paid automatically.
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {invoice.footer_terms && (
          <p style={{ marginTop: '16px', fontSize: '13px', color: '#6b7280' }}>{invoice.footer_terms}</p>
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
  maxWidth: '720px',
  margin: '0 auto',
  backgroundColor: '#fff',
  borderRadius: '12px',
  border: '1px solid #e5e7eb',
  padding: '28px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
};

const payBtnStyle = {
  marginTop: '24px',
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

const paidBannerStyle = {
  marginTop: '24px',
  padding: '14px',
  backgroundColor: '#ecfdf5',
  color: '#065f46',
  borderRadius: '8px',
  fontWeight: 600,
  textAlign: 'center',
};

const eTransferStyle = {
  marginTop: '20px',
  padding: '14px',
  backgroundColor: '#f9fafb',
  borderRadius: '8px',
  fontSize: '14px',
  lineHeight: 1.6,
};

const eTransferHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '16px',
  flexWrap: 'wrap',
};

const eTransferBtnStyle = {
  flexShrink: 0,
  padding: '10px 16px',
  backgroundColor: '#fff',
  color: TavariStyles.colors.primary || '#008080',
  border: `2px solid ${TavariStyles.colors.primary || '#008080'}`,
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const eTransferPendingBadgeStyle = {
  flexShrink: 0,
  padding: '8px 12px',
  backgroundColor: '#ecfdf5',
  color: '#065f46',
  borderRadius: '8px',
  fontSize: '13px',
  fontWeight: 600,
};

const eTransferNoteStyle = {
  marginTop: '12px',
  paddingTop: '12px',
  borderTop: '1px solid #e5e7eb',
  fontSize: '13px',
  color: '#4b5563',
};
