import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Ban,
  CheckCircle,
  Copy,
  Download,
  Mail,
  Printer,
  Send,
} from 'lucide-react';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import { TavariStyles } from '../../utils/TavariStyles';
import invoiceService from '../../services/Invoices/invoiceService';
import { supabase } from '../../supabaseClient';
import { generateInvoiceHTML, buildBusinessDisplay } from '../../utils/InvoiceBuilder';
import { downloadInvoicePdf } from '../../utils/invoicePdf';
import { sendInvoiceEmail, sendPaidReceiptEmail } from '../../services/Invoices/invoiceEmailService';
import InvoiceLineItemsEditor from '../../components/Invoices/InvoiceLineItemsEditor';
import InvoiceRefundModal from '../../components/Invoices/InvoiceRefundModal';
import InvoiceSendEmailModal from '../../components/Invoices/InvoiceSendEmailModal';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { isInvoiceEditable, parseInvoiceEmailList } from '../../utils/invoiceEmailUtils';

export default function InvoiceDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const { hasPermission } = usePermissions();
  const canSend = hasPermission('invoices.send');
  const canCreate = hasPermission('invoices.create');
  const canVoid = hasPermission('invoices.void');
  const canRefund = hasPermission('invoices.refund');

  const [invoice, setInvoice] = useState(null);
  const [business, setBusiness] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendPaidReceipt, setSendPaidReceipt] = useState(true);
  const [authUserId, setAuthUserId] = useState(null);
  const previewRef = useRef(null);

  const loadInvoice = useCallback(async () => {
    if (!selectedBusinessId || !id) return;
    setLoading(true);
    try {
      invoiceService.setBusinessId(selectedBusinessId);
      const [row, profile, invoiceSettings] = await Promise.all([
        invoiceService.getInvoice(id),
        invoiceService.getBusinessProfile(),
        invoiceService.getSettings(),
      ]);
      if (!row) throw new Error('Invoice not found');
      setInvoice(row);
      setBusiness(profile);
      setSettings(invoiceSettings);
    } catch (err) {
      toast.error(err.message || 'Failed to load invoice');
      navigate('/dashboard/invoices');
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId, id, navigate]);

  useEffect(() => {
    loadInvoice();
    supabase.auth.getUser().then(({ data }) => setAuthUserId(data?.user?.id || null));
  }, [loadInvoice]);

  useEffect(() => {
    if (!invoice) return;
    setSendPaidReceipt(Boolean(parseInvoiceEmailList(invoice.recipient_email).length));
  }, [invoice?.id, invoice?.recipient_email]);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';

  const buildEmailHtml = (inv, bizDisplay) => {
    const payUrl =
      inv.balance_due > 0 && inv.pay_token
        ? `${window.location.origin}/pay/invoice/${inv.pay_token}?src=email`
        : null;
    const trackingPixelUrl = inv.email_tracking_token
      ? `${supabaseUrl}/functions/v1/invoice-track?token=${encodeURIComponent(inv.email_tracking_token)}&event=open`
      : null;
    return generateInvoiceHTML(inv, bizDisplay, { payUrl, trackingPixelUrl });
  };

  const getPreviewHtml = () => {
    if (!invoice || !business) return '';
    const display = buildBusinessDisplay(invoice, business, settings);
    return buildEmailHtml(invoice, display);
  };

  const handlePrint = () => {
    const html = getPreviewHtml();
    const win = window.open('', '_blank');
    if (!win) {
      toast.error('Pop-up blocked — allow pop-ups to print');
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  const handleDownloadPdf = async () => {
    setBusy(true);
    try {
      const html = getPreviewHtml();
      await downloadInvoicePdf(html, `Invoice-${invoice.invoice_number}.pdf`);
      toast.success('PDF downloaded');
    } catch (err) {
      toast.error(err.message || 'PDF download failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSendEmail = async ({ recipients, updatePrimaryEmail }) => {
    setBusy(true);
    try {
      invoiceService.setBusinessId(selectedBusinessId);
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id;
      await invoiceService.sendInvoice(invoice.id, { userId });
      const result = await sendInvoiceEmail(invoice.id, selectedBusinessId, {
        recipients,
        updatePrimaryEmail,
      });
      toast.success(
        `Invoice emailed to ${result.recipients?.length || recipients.length} recipient(s)`
      );
      loadInvoice();
    } catch (err) {
      toast.error(err.message || 'Failed to send invoice email');
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const handleMarkPaid = async () => {
    setBusy(true);
    try {
      invoiceService.setBusinessId(selectedBusinessId);
      const { data: authData } = await supabase.auth.getUser();
      await invoiceService.markPaid(invoice.id, {
        userId: authData?.user?.id,
        paymentMethod: 'manual',
      });

      if (sendPaidReceipt && canSend && parseInvoiceEmailList(invoice.recipient_email).length) {
        try {
          const result = await sendPaidReceiptEmail(invoice.id, selectedBusinessId);
          toast.success(
            `Invoice marked paid — receipt emailed to ${result.recipients?.length || 1} recipient(s)`
          );
        } catch (emailErr) {
          toast.success('Invoice marked paid');
          toast.error(emailErr.message || 'Paid receipt email failed');
        }
      } else {
        toast.success('Invoice marked paid');
      }

      loadInvoice();
    } catch (err) {
      toast.error(err.message || 'Failed to mark paid');
    } finally {
      setBusy(false);
    }
  };

  const handleSendPaidReceipt = async () => {
    setBusy(true);
    try {
      invoiceService.setBusinessId(selectedBusinessId);
      const result = await sendPaidReceiptEmail(invoice.id, selectedBusinessId);
      toast.success(`Paid receipt emailed to ${result.recipients?.length || 1} recipient(s)`);
    } catch (err) {
      toast.error(err.message || 'Failed to send paid receipt');
    } finally {
      setBusy(false);
    }
  };

  const handleReissue = async () => {
    setBusy(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      invoiceService.setBusinessId(selectedBusinessId);
      const draft = await invoiceService.reissueInvoice(invoice.id, {
        userId: authData?.user?.id,
      });
      toast.success('Draft invoice created from voided invoice');
      navigate(`/dashboard/invoices/${draft.id}/edit`);
    } catch (err) {
      toast.error(err.message || 'Failed to re-issue invoice');
    } finally {
      setBusy(false);
    }
  };

  const handleVoid = async () => {
    const reason = window.prompt('Void reason (optional):') ?? '';
    if (reason === null) return;
    setBusy(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      await invoiceService.voidInvoice(invoice.id, {
        userId: authData?.user?.id,
        reason,
      });
      toast.success('Invoice voided');
      loadInvoice();
    } catch (err) {
      toast.error(err.message || 'Failed to void invoice');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div style={cardStyle}>Loading invoice…</div>
    );
  }

  if (!invoice) return null;

  const lines = (invoice.tavari_invoice_line_items || []).map((line) => ({
    ...line,
    clientId: line.id,
  }));

  const balanceDue = Number(invoice.balance_due) || 0;
  const canMarkPaid =
    balanceDue > 0 && !['paid', 'void', 'refunded'].includes(invoice.status);
  const canSendPaidReceipt =
    canSend &&
    invoice.status === 'paid' &&
    parseInvoiceEmailList(invoice.recipient_email).length > 0;
  const canVoidNow = !['void', 'refunded'].includes(invoice.status);

  const canEdit = canCreate && isInvoiceEditable(invoice.status);

  return (
    <div>
      <div style={toolbarStyle}>
        <button type="button" onClick={() => navigate('/dashboard/invoices')} style={secondaryBtn}>
          <ArrowLeft size={16} /> Back
        </button>
        {canEdit && (
          <button type="button" onClick={() => navigate(`/dashboard/invoices/${id}/edit`)} style={secondaryBtn}>
            Edit
          </button>
        )}
        {canSend && !['void', 'refunded'].includes(invoice.status) && (
          <button type="button" onClick={() => setShowSendModal(true)} disabled={busy} style={primaryBtn}>
            <Send size={16} /> {invoice.first_sent_at ? 'Resend' : 'Send'} email
          </button>
        )}
        <button type="button" onClick={handleDownloadPdf} disabled={busy} style={secondaryBtn}>
          <Download size={16} /> PDF
        </button>
        <button type="button" onClick={handlePrint} style={secondaryBtn}>
          <Printer size={16} /> Print
        </button>
        {canMarkPaid && (
          <button type="button" onClick={handleMarkPaid} disabled={busy} style={secondaryBtn}>
            <CheckCircle size={16} /> Mark paid
          </button>
        )}
        {canSendPaidReceipt && (
          <button type="button" onClick={handleSendPaidReceipt} disabled={busy} style={secondaryBtn}>
            <Mail size={16} /> Send paid receipt
          </button>
        )}
        {canVoid && canVoidNow && (
          <button type="button" onClick={handleVoid} disabled={busy} style={dangerBtn}>
            <Ban size={16} /> Void
          </button>
        )}
        {canCreate && invoice.status === 'void' && (
          <button type="button" onClick={handleReissue} disabled={busy} style={secondaryBtn}>
            <Copy size={16} /> Re-issue
          </button>
        )}
        {canRefund && invoice.status === 'paid' && invoice.pos_sale_id && (
          <button type="button" onClick={() => setShowRefundModal(true)} style={secondaryBtn}>
            Refund
          </button>
        )}
      </div>

      {canMarkPaid && canSend && (
        <div style={{
          marginTop: '12px',
          padding: '12px 16px',
          backgroundColor: '#fff',
          borderRadius: '10px',
          border: '1px solid #e5e7eb',
        }}>
          <TavariCheckbox
            label={
              parseInvoiceEmailList(invoice.recipient_email).length
                ? `Email paid receipt to ${invoice.recipient_email} when marking paid`
                : 'Email paid receipt when marking paid (add recipient email first)'
            }
            checked={sendPaidReceipt}
            onChange={setSendPaidReceipt}
            disabled={!parseInvoiceEmailList(invoice.recipient_email).length}
          />
        </div>
      )}

      {showSendModal && (
        <InvoiceSendEmailModal
          invoice={invoice}
          isResend={!!invoice.first_sent_at}
          onClose={() => setShowSendModal(false)}
          onSend={handleSendEmail}
        />
      )}

      {showRefundModal && (
        <InvoiceRefundModal
          invoice={invoice}
          businessId={selectedBusinessId}
          userId={authUserId}
          onClose={() => setShowRefundModal(false)}
          onRefunded={loadInvoice}
        />
      )}

      <div style={cardStyle}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '16px',
          flexWrap: 'wrap',
        }}>
          <div>
            <h2 style={{ margin: '0 0 4px' }}>{invoice.invoice_number}</h2>
            <div style={{ color: '#6b7280' }}>
              {invoice.recipient_name}
              {invoice.recipient_company ? ` · ${invoice.recipient_company}` : ''}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{
              display: 'inline-block',
              padding: '6px 12px',
              borderRadius: '999px',
              backgroundColor: '#f3f4f6',
              textTransform: 'capitalize',
              fontWeight: 600,
            }}>
              {invoice.status?.replace('_', ' ')}
            </div>
            <div style={{
              fontSize: '28px',
              fontWeight: 700,
              color: TavariStyles.colors.primary,
              marginTop: '8px',
            }}>
              ${Number(invoice.total || 0).toFixed(2)}
            </div>
            {balanceDue > 0 && (
              <div style={{ color: '#dc2626', fontWeight: 600 }}>
                Balance due: ${balanceDue.toFixed(2)}
              </div>
            )}
          </div>
        </div>

        <div style={metaGridStyle}>
          <div><strong>Email:</strong> {invoice.recipient_email || '—'}</div>
          <div><strong>Due:</strong> {invoice.due_date || '—'}</div>
          <div><strong>Type:</strong> {invoice.invoice_type}</div>
          <div><strong>Sent:</strong> {invoice.first_sent_at ? new Date(invoice.first_sent_at).toLocaleString() : 'Not yet'}</div>
          {invoice.erpnext_sales_invoice_name && (
            <div><strong>ERPNext:</strong> {invoice.erpnext_sales_invoice_name}</div>
          )}
          {invoice.recurring_template_id && (
            <div>
              <strong>Recurring template:</strong>{' '}
              <button
                type="button"
                onClick={() => navigate(`/dashboard/invoices/recurring/${invoice.recurring_template_id}`)}
                style={{ background: 'none', border: 'none', color: TavariStyles.colors.primary, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
              >
                View schedule
              </button>
            </div>
          )}
          {invoice.reissued_from_invoice_id && (
            <div>
              <strong>Re-issued from:</strong>{' '}
              <button
                type="button"
                onClick={() => navigate(`/dashboard/invoices/${invoice.reissued_from_invoice_id}`)}
                style={{ background: 'none', border: 'none', color: TavariStyles.colors.primary, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
              >
                View original
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>Line items</h3>
        <InvoiceLineItemsEditor
          businessId={selectedBusinessId}
          lines={lines}
          onChange={() => {}}
          readOnly
          taxSummary={{
            subtotal: invoice.subtotal,
            tax_amount: invoice.tax_amount,
            total: invoice.total,
            aggregatedTaxes: { Tax: invoice.tax_amount },
          }}
        />
      </div>

      {invoice.notes && (
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Notes</h3>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{invoice.notes}</p>
        </div>
      )}

      <div style={{ ...cardStyle, display: 'none' }} ref={previewRef} dangerouslySetInnerHTML={{ __html: getPreviewHtml() }} />
    </div>
  );
}

const cardStyle = {
  marginTop: '20px',
  backgroundColor: '#fff',
  borderRadius: '12px',
  border: '1px solid #e5e7eb',
  padding: '24px',
};

const toolbarStyle = {
  display: 'flex',
  gap: '10px',
  marginTop: '20px',
  flexWrap: 'wrap',
};

const metaGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '12px',
  marginTop: '20px',
  fontSize: '14px',
  color: '#374151',
};

const btnBase = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  padding: '10px 16px',
  borderRadius: '8px',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '14px',
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

const dangerBtn = {
  ...btnBase,
  backgroundColor: '#fef2f2',
  color: '#dc2626',
  border: '1px solid #fecaca',
};
