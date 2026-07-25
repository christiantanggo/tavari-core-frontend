import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Save, Send } from 'lucide-react';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { TavariStyles } from '../../utils/TavariStyles';
import { computeInvoiceTotals, defaultDueDate } from '../../utils/invoiceCalculations';
import { isInvoiceEditable, parseInvoiceEmailList } from '../../utils/invoiceEmailUtils';
import invoiceService from '../../services/Invoices/invoiceService';
import { sendInvoiceEmail } from '../../services/Invoices/invoiceEmailService';
import { supabase } from '../../supabaseClient';
import InvoiceLineItemsEditor from '../../components/Invoices/InvoiceLineItemsEditor';
import SummarySourcePicker from '../../components/Invoices/SummarySourcePicker';
import InvoiceSendEmailModal from '../../components/Invoices/InvoiceSendEmailModal';
import TavariCheckbox from '../../components/UI/TavariCheckbox';

const cardStyle = {
  backgroundColor: '#fff',
  borderRadius: '12px',
  border: '1px solid #e5e7eb',
  padding: '24px',
  marginTop: '20px',
};

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  fontSize: '14px',
  boxSizing: 'border-box',
};

const labelStyle = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 600,
  marginBottom: '6px',
  color: '#374151',
};

export default function InvoiceFormScreen() {
  const { id } = useParams();
  const isEdit = id && id !== 'new';
  const [searchParams] = useSearchParams();
  const isSummary = searchParams.get('type') === 'summary' || false;

  const navigate = useNavigate();
  const { selectedBusinessId, businessData } = useBusinessContext();
  const { hasPermission } = usePermissions();
  const taxCalc = useTaxCalculations(selectedBusinessId);
  const canCreate = hasPermission('invoices.create');
  const canSend = hasPermission('invoices.send');

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState([]);
  const [settings, setSettings] = useState(null);
  const [posSettings, setPosSettings] = useState(null);
  const [lines, setLines] = useState([]);
  const [sourceLinks, setSourceLinks] = useState([]);
  const [selectedLineKeys, setSelectedLineKeys] = useState([]);
  const [invoiceStatus, setInvoiceStatus] = useState('draft');
  const [showSendModal, setShowSendModal] = useState(false);
  const [pendingSendInvoiceId, setPendingSendInvoiceId] = useState(null);
  const [form, setForm] = useState({
    invoice_type: isSummary ? 'summary' : 'standard',
    recipient_type: 'customer',
    loyalty_customer_id: null,
    recipient_name: '',
    recipient_email: '',
    recipient_phone: '',
    recipient_company: '',
    notes: '',
    footer_terms: 'Due on receipt',
    due_date: defaultDueDate(0),
    indian_status_gst_only: false,
    indian_status_certificate_number: '',
    display_dba: '',
    logo_url: '',
  });

  const taxSummary = useMemo(() => {
    if (taxCalc.loading) return null;
    return computeInvoiceTotals(lines, taxCalc, {
      indian_status_gst_only: form.indian_status_gst_only,
      indian_status_gst_rate: Number(posSettings?.indian_status_gst_rate) || 0.05,
      indian_status_tax_label: posSettings?.indian_status_tax_label,
    });
  }, [lines, taxCalc, form.indian_status_gst_only, posSettings, taxCalc.loading]);

  const loadDefaults = useCallback(async () => {
    if (!selectedBusinessId) return;
    try {
      invoiceService.setBusinessId(selectedBusinessId);
      const [invoiceSettings, business, pos] = await Promise.all([
        invoiceService.getSettings(),
        invoiceService.getBusinessProfile(),
        invoiceService.getPosSettings(),
      ]);
      setSettings(invoiceSettings);
      setPosSettings(pos);
      if (!isEdit) {
        setForm((prev) => ({
          ...prev,
          footer_terms: invoiceSettings?.footer_terms || 'Due on receipt',
          due_date: defaultDueDate(invoiceSettings?.default_due_days ?? 0),
          display_dba: invoiceSettings?.doing_business_as || '',
          logo_url: invoiceSettings?.default_logo_url || business?.logo_url || '',
        }));
      }
    } catch (err) {
      console.error('[InvoiceFormScreen] loadDefaults:', err);
      toast.error(err.message || 'Failed to load invoice defaults');
    }
  }, [selectedBusinessId, isEdit]);

  useEffect(() => {
    loadDefaults();
  }, [loadDefaults]);

  useEffect(() => {
    if (!isEdit || !selectedBusinessId) return;
    (async () => {
      setLoading(true);
      try {
        invoiceService.setBusinessId(selectedBusinessId);
        const invoice = await invoiceService.getInvoice(id);
        if (!invoice) throw new Error('Invoice not found');
        if (!isInvoiceEditable(invoice.status)) {
          toast.error('This invoice cannot be edited');
          navigate(`/dashboard/invoices/${id}`);
          return;
        }
        setInvoiceStatus(invoice.status);
        setForm({
          invoice_type: invoice.invoice_type,
          recipient_type: invoice.recipient_type,
          loyalty_customer_id: invoice.loyalty_customer_id,
          recipient_name: invoice.recipient_name,
          recipient_email: invoice.recipient_email || '',
          recipient_phone: invoice.recipient_phone || '',
          recipient_company: invoice.recipient_company || '',
          notes: invoice.notes || '',
          footer_terms: invoice.footer_terms || 'Due on receipt',
          due_date: invoice.due_date || defaultDueDate(0),
          indian_status_gst_only: invoice.indian_status_gst_only,
          indian_status_certificate_number: invoice.indian_status_certificate_number || '',
          display_dba: invoice.display_dba || '',
          logo_url: invoice.logo_url || '',
        });
        setLines(
          (invoice.tavari_invoice_line_items || []).map((line) => ({
            ...line,
            clientId: line.id,
          }))
        );
        setSourceLinks(invoice.tavari_invoice_source_links || []);
      } catch (err) {
        toast.error(err.message || 'Failed to load invoice');
        navigate('/dashboard/invoices');
      } finally {
        setLoading(false);
      }
    })();
  }, [isEdit, id, selectedBusinessId, navigate]);

  const searchCustomers = async () => {
    if (!selectedBusinessId) return;
    invoiceService.setBusinessId(selectedBusinessId);
    const rows = await invoiceService.searchCustomers(customerSearch);
    setCustomerResults(rows);
  };

  const selectCustomer = (customer) => {
    setForm((prev) => ({
      ...prev,
      loyalty_customer_id: customer.id,
      recipient_name: customer.customer_name,
      recipient_email: customer.customer_email || '',
      recipient_phone: customer.customer_phone || '',
    }));
    setCustomerResults([]);
    setCustomerSearch(customer.customer_name);
  };

  const buildPayload = (statusOverride) => ({
    id: isEdit ? id : undefined,
    ...form,
    status: statusOverride ?? (isEdit ? invoiceStatus : 'draft'),
    subtotal: taxSummary?.subtotal || 0,
    tax_amount: taxSummary?.tax_amount || 0,
    total: taxSummary?.total || 0,
    balance_due: form.invoice_type === 'summary' ? 0 : taxSummary?.total || 0,
    lines,
    source_links: sourceLinks,
  });

  const handleSendFromModal = async ({ recipients, updatePrimaryEmail }) => {
    if (!pendingSendInvoiceId) return;
    const targetId = pendingSendInvoiceId;
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;
    await invoiceService.sendInvoice(targetId, { userId });
    const result = await sendInvoiceEmail(targetId, selectedBusinessId, {
      recipients,
      updatePrimaryEmail,
    });
    toast.success(
      `Invoice emailed to ${result.recipients?.length || recipients.length} recipient(s)`
    );
    setShowSendModal(false);
    setPendingSendInvoiceId(null);
    navigate(`/dashboard/invoices/${targetId}`);
  };

  const handleSave = async (andSend = false, { openSendModalAfter = false } = {}) => {
    if (!canCreate) {
      toast.error('You do not have permission to create invoices');
      return;
    }
    if (!form.recipient_name?.trim()) {
      toast.error('Recipient name is required');
      return;
    }
    if (lines.length === 0) {
      toast.error('Add at least one line item');
      return;
    }

    setSaving(true);
    try {
      invoiceService.setBusinessId(selectedBusinessId);
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id;

      const saved = await invoiceService.saveInvoice(buildPayload(), {
        userId,
      });

      if (andSend) {
        if (!canSend) {
          toast.error('You do not have permission to send invoices');
        } else {
          const recipients = parseInvoiceEmailList(form.recipient_email);
          if (recipients.length === 0) {
            setPendingSendInvoiceId(saved.id);
            setShowSendModal(true);
            toast.success('Invoice saved — add email addresses to send');
            return;
          }
          await invoiceService.sendInvoice(saved.id, { userId });
          const result = await sendInvoiceEmail(saved.id, selectedBusinessId, {
            recipients,
            updatePrimaryEmail: true,
          });
          toast.success(
            `Invoice sent and emailed to ${result.recipients?.length || recipients.length} recipient(s)`
          );
          navigate(`/dashboard/invoices/${saved.id}`);
          return;
        }
      }

      toast.success(isEdit && invoiceStatus !== 'draft' ? 'Invoice updated' : 'Invoice saved');
      if (openSendModalAfter) {
        setPendingSendInvoiceId(saved.id);
        setShowSendModal(true);
        return;
      }
      navigate(`/dashboard/invoices/${saved.id}`);
    } catch (err) {
      toast.error(err.message || 'Failed to save invoice');
    } finally {
      setSaving(false);
    }
  };

  if (!canCreate) {
    return (
      <div style={{ ...cardStyle, textAlign: 'center' }}>
        You do not have permission to create invoices.
      </div>
    );
  }

  if (loading) {
    return <div style={cardStyle}>Loading invoice…</div>;
  }

  const isSentEdit = isEdit && invoiceStatus !== 'draft';

  return (
    <div>
      {showSendModal && (
        <InvoiceSendEmailModal
          invoice={{
            invoice_number: pendingSendInvoiceId ? 'Invoice' : '',
            recipient_email: form.recipient_email,
          }}
          onClose={() => {
            setShowSendModal(false);
            if (pendingSendInvoiceId) {
              navigate(`/dashboard/invoices/${pendingSendInvoiceId}`);
            }
            setPendingSendInvoiceId(null);
          }}
          onSend={handleSendFromModal}
        />
      )}

      <div style={{
        display: 'flex',
        gap: '12px',
        marginTop: '20px',
        flexWrap: 'wrap',
      }}>
        <button type="button" onClick={() => navigate(isEdit ? `/dashboard/invoices/${id}` : '/dashboard/invoices')} style={secondaryBtnStyle}>
          <ArrowLeft size={16} /> Back
        </button>
        <button type="button" onClick={() => handleSave(false)} disabled={saving} style={secondaryBtnStyle}>
          <Save size={16} /> {isSentEdit ? 'Save changes' : 'Save draft'}
        </button>
        {canSend && !isSentEdit && (
          <button type="button" onClick={() => handleSave(true)} disabled={saving} style={primaryBtnStyle}>
            <Send size={16} /> Save & send
          </button>
        )}
        {canSend && isSentEdit && (
          <button
            type="button"
            onClick={() => handleSave(false, { openSendModalAfter: true })}
            disabled={saving}
            style={primaryBtnStyle}
          >
            <Send size={16} /> Save & resend
          </button>
        )}
      </div>

      <div style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>
          {isEdit ? 'Edit invoice' : isSummary ? 'New summary invoice' : 'New invoice'}
        </h2>

        <div style={gridStyle}>
          <div>
            <label style={labelStyle}>Recipient type</label>
            <select
              style={inputStyle}
              value={form.recipient_type}
              onChange={(e) => setForm((p) => ({ ...p, recipient_type: e.target.value }))}
            >
              <option value="customer">Customer</option>
              <option value="business">Business</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Search customer</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchCustomers()}
                placeholder="Name, email, or phone"
              />
              <button type="button" onClick={searchCustomers} style={secondaryBtnStyle}>
                Search
              </button>
            </div>
            {customerResults.length > 0 && (
              <div style={dropdownStyle}>
                {customerResults.map((c) => (
                  <button key={c.id} type="button" style={dropdownItemStyle} onClick={() => selectCustomer(c)}>
                    {c.customer_name} — {c.customer_email || c.customer_phone || 'No contact'}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={gridStyle}>
          <div>
            <label style={labelStyle}>Recipient name *</label>
            <input
              style={inputStyle}
              value={form.recipient_name}
              onChange={(e) => setForm((p) => ({ ...p, recipient_name: e.target.value }))}
            />
          </div>
          {form.recipient_type === 'business' && (
            <div>
              <label style={labelStyle}>Company</label>
              <input
                style={inputStyle}
                value={form.recipient_company}
                onChange={(e) => setForm((p) => ({ ...p, recipient_company: e.target.value }))}
              />
            </div>
          )}
          <div>
            <label style={labelStyle}>Email</label>
            <input
              style={inputStyle}
              type="text"
              value={form.recipient_email}
              onChange={(e) => setForm((p) => ({ ...p, recipient_email: e.target.value }))}
              placeholder="customer@example.com, billing@example.com"
            />
            <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
              Primary bill-to email (first address). Use commas for additional recipients when sending.
            </div>
          </div>
          <div>
            <label style={labelStyle}>Phone</label>
            <input
              style={inputStyle}
              value={form.recipient_phone}
              onChange={(e) => setForm((p) => ({ ...p, recipient_phone: e.target.value }))}
            />
          </div>
        </div>
      </div>

      {form.invoice_type === 'summary' && (
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Paid receipts & bookings</h3>
          <SummarySourcePicker
            businessId={selectedBusinessId}
            customerId={form.loyalty_customer_id}
            selectedLineKeys={selectedLineKeys}
            onSelectedLineKeysChange={setSelectedLineKeys}
            onLinesChange={setLines}
            onSourceLinksChange={setSourceLinks}
          />
        </div>
      )}

      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>Line items</h3>
        <InvoiceLineItemsEditor
          businessId={selectedBusinessId}
          lines={lines}
          onChange={setLines}
          taxSummary={taxSummary}
        />
      </div>

      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>Tax & terms</h3>
        <div style={gridStyle}>
          <div>
            <TavariCheckbox
              checked={form.indian_status_gst_only}
              onChange={(checked) => setForm((p) => ({ ...p, indian_status_gst_only: checked }))}
              label="Indian Status (GST only on entire invoice)"
            />
          </div>
          {form.indian_status_gst_only && (
            <div>
              <label style={labelStyle}>Certificate number</label>
              <input
                style={inputStyle}
                value={form.indian_status_certificate_number}
                onChange={(e) =>
                  setForm((p) => ({ ...p, indian_status_certificate_number: e.target.value }))
                }
              />
            </div>
          )}
          <div>
            <label style={labelStyle}>Due date</label>
            <input
              style={inputStyle}
              type="date"
              value={form.due_date || ''}
              onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))}
            />
          </div>
          <div>
            <label style={labelStyle}>Footer / terms</label>
            <input
              style={inputStyle}
              value={form.footer_terms}
              onChange={(e) => setForm((p) => ({ ...p, footer_terms: e.target.value }))}
            />
          </div>
          <div>
            <label style={labelStyle}>DBA (on invoice)</label>
            <input
              style={inputStyle}
              value={form.display_dba}
              onChange={(e) => setForm((p) => ({ ...p, display_dba: e.target.value }))}
            />
          </div>
        </div>
        <div style={{ marginTop: '16px' }}>
          <label style={labelStyle}>Notes</label>
          <textarea
            style={{
              ...inputStyle,
              minHeight: '90px',
              resize: 'vertical',
            }}
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
          />
        </div>
      </div>
    </div>
  );
}

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '16px',
  marginTop: '16px',
};

const primaryBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  padding: '10px 18px',
  backgroundColor: TavariStyles.colors.primary || '#008080',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  fontWeight: 600,
};

const secondaryBtnStyle = {
  ...primaryBtnStyle,
  backgroundColor: '#fff',
  color: '#374151',
  border: '1px solid #d1d5db',
};

const dropdownStyle = {
  marginTop: '8px',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  overflow: 'hidden',
  backgroundColor: '#fff',
};

const dropdownItemStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '10px 12px',
  border: 'none',
  borderBottom: '1px solid #f3f4f6',
  background: '#fff',
  cursor: 'pointer',
  fontSize: '14px',
};
