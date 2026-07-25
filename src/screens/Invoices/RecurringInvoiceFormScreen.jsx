import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Save } from 'lucide-react';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { computeInvoiceTotals } from '../../utils/invoiceCalculations';
import { firstMonthlyRunDate, formatRecurringSchedule } from '../../utils/invoiceRecurringSchedule';
import invoiceService from '../../services/Invoices/invoiceService';
import recurringInvoiceService from '../../services/Invoices/recurringInvoiceService';
import { supabase } from '../../supabaseClient';
import InvoiceLineItemsEditor from '../../components/Invoices/InvoiceLineItemsEditor';
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
  backgroundColor: '#008080',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtnStyle = {
  ...primaryBtnStyle,
  backgroundColor: '#fff',
  color: '#374151',
  border: '1px solid #d1d5db',
};

export default function RecurringInvoiceFormScreen() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const { hasPermission } = usePermissions();
  const taxCalc = useTaxCalculations(selectedBusinessId);
  const canCreate = hasPermission('invoices.create');

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState([]);
  const [settings, setSettings] = useState(null);
  const [posSettings, setPosSettings] = useState(null);
  const [lines, setLines] = useState([]);
  const [runHistory, setRunHistory] = useState([]);
  const [form, setForm] = useState({
    name: '',
    recipient_type: 'customer',
    loyalty_customer_id: null,
    recipient_name: '',
    recipient_email: '',
    recipient_phone: '',
    recipient_company: '',
    notes: '',
    footer_terms: 'Due on receipt',
    schedule_day_of_month: 1,
    starts_on: new Date().toISOString().slice(0, 10),
    ends_on: '',
    max_occurrences: '',
    auto_send: true,
    due_days_override: '',
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

  const previewNextRun = useMemo(() => {
    const dom = Math.min(28, Math.max(1, Number(form.schedule_day_of_month) || 1));
    return firstMonthlyRunDate(form.starts_on, dom);
  }, [form.starts_on, form.schedule_day_of_month]);

  const loadDefaults = useCallback(async () => {
    if (!selectedBusinessId) return;
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
        due_days_override: invoiceSettings?.default_due_days ?? '',
        display_dba: invoiceSettings?.doing_business_as || '',
        logo_url: invoiceSettings?.default_logo_url || business?.logo_url || '',
      }));
    }
  }, [selectedBusinessId, isEdit]);

  useEffect(() => {
    loadDefaults().catch((err) => toast.error(err.message || 'Failed to load defaults'));
  }, [loadDefaults]);

  useEffect(() => {
    if (!isEdit || !selectedBusinessId) return;
    (async () => {
      setLoading(true);
      try {
        recurringInvoiceService.setBusinessId(selectedBusinessId);
        const template = await recurringInvoiceService.getTemplate(id);
        if (!template) throw new Error('Recurring invoice not found');
        setForm({
          name: template.name || '',
          recipient_type: template.recipient_type,
          loyalty_customer_id: template.loyalty_customer_id,
          recipient_name: template.recipient_name,
          recipient_email: template.recipient_email || '',
          recipient_phone: template.recipient_phone || '',
          recipient_company: template.recipient_company || '',
          notes: template.notes || '',
          footer_terms: template.footer_terms || 'Due on receipt',
          schedule_day_of_month: template.schedule_day_of_month || 1,
          starts_on: template.starts_on,
          ends_on: template.ends_on || '',
          max_occurrences: template.max_occurrences ?? '',
          auto_send: template.auto_send !== false,
          due_days_override: template.due_days_override ?? '',
          indian_status_gst_only: template.indian_status_gst_only,
          indian_status_certificate_number: template.indian_status_certificate_number || '',
          display_dba: template.display_dba || '',
          logo_url: template.logo_url || '',
        });
        setLines(
          (template.tavari_recurring_invoice_line_items || []).map((line) => ({
            ...line,
            clientId: line.id,
          }))
        );
        const history = await recurringInvoiceService.getRunHistory(id);
        setRunHistory(history);
      } catch (err) {
        toast.error(err.message || 'Failed to load recurring invoice');
        navigate('/dashboard/invoices/recurring');
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
      name: prev.name || `${customer.customer_name} — monthly`,
    }));
    setCustomerResults([]);
    setCustomerSearch(customer.customer_name);
  };

  const handleSave = async () => {
    if (!form.recipient_name?.trim()) {
      toast.error('Recipient name is required');
      return;
    }
    if (!form.name?.trim()) {
      toast.error('Template name is required');
      return;
    }
    if (lines.length === 0) {
      toast.error('Add at least one line item');
      return;
    }
    if (form.auto_send && !form.recipient_email?.trim()) {
      toast.error('Email is required when auto-send is enabled');
      return;
    }

    setSaving(true);
    try {
      recurringInvoiceService.setBusinessId(selectedBusinessId);
      const { data: authData } = await supabase.auth.getUser();
      const saved = await recurringInvoiceService.saveTemplate(
        {
          id: isEdit ? id : undefined,
          ...form,
          subtotal: taxSummary?.subtotal || 0,
          tax_amount: taxSummary?.tax_amount || 0,
          total: taxSummary?.total || 0,
          lines,
        },
        { userId: authData?.user?.id }
      );
      toast.success(isEdit ? 'Recurring invoice updated' : 'Recurring invoice created');
      navigate('/dashboard/invoices/recurring');
    } catch (err) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!canCreate) {
    return <div style={{ ...cardStyle, textAlign: 'center' }}>You do not have permission to create recurring invoices.</div>;
  }

  if (loading) {
    return <div style={cardStyle}>Loading…</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', marginTop: '20px', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => navigate('/dashboard/invoices/recurring')} style={secondaryBtnStyle}>
          <ArrowLeft size={16} /> Back
        </button>
        <button type="button" onClick={handleSave} disabled={saving} style={primaryBtnStyle}>
          <Save size={16} /> {isEdit ? 'Save changes' : 'Create recurring invoice'}
        </button>
      </div>

      <div style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>{isEdit ? 'Edit recurring invoice' : 'New recurring invoice'}</h2>

        <div style={gridStyle}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Template name *</label>
            <input
              style={inputStyle}
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Monthly membership — Jane Smith"
            />
          </div>
        </div>

        <h3 style={{ marginTop: '24px', marginBottom: 0 }}>Schedule</h3>
        <div style={gridStyle}>
          <div>
            <label style={labelStyle}>Day of month</label>
            <select
              style={inputStyle}
              value={form.schedule_day_of_month}
              onChange={(e) => setForm((p) => ({ ...p, schedule_day_of_month: Number(e.target.value) }))}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>First issue date</label>
            <input
              style={inputStyle}
              type="date"
              value={form.starts_on}
              onChange={(e) => setForm((p) => ({ ...p, starts_on: e.target.value }))}
            />
          </div>
          <div>
            <label style={labelStyle}>End date (optional)</label>
            <input
              style={inputStyle}
              type="date"
              value={form.ends_on}
              onChange={(e) => setForm((p) => ({ ...p, ends_on: e.target.value }))}
            />
          </div>
          <div>
            <label style={labelStyle}>Max occurrences (optional)</label>
            <input
              style={inputStyle}
              type="number"
              min="1"
              value={form.max_occurrences}
              onChange={(e) => setForm((p) => ({ ...p, max_occurrences: e.target.value }))}
              placeholder="Unlimited"
            />
          </div>
          <div>
            <label style={labelStyle}>Due days after issue</label>
            <input
              style={inputStyle}
              type="number"
              min="0"
              value={form.due_days_override}
              onChange={(e) => setForm((p) => ({ ...p, due_days_override: e.target.value }))}
              placeholder={String(settings?.default_due_days ?? 0)}
            />
          </div>
        </div>

        <div style={{ marginTop: '12px', fontSize: '13px', color: '#6b7280' }}>
          {formatRecurringSchedule({ schedule_day_of_month: form.schedule_day_of_month })}
          {' · '}
          Next scheduled run: {previewNextRun}
        </div>

        <div style={{ marginTop: '16px' }}>
          <TavariCheckbox
            label="Automatically send invoice by email when generated"
            checked={form.auto_send}
            onChange={(checked) => setForm((p) => ({ ...p, auto_send: checked }))}
          />
        </div>

        <h3 style={{ marginTop: '28px', marginBottom: 0 }}>Recipient</h3>
        <div style={gridStyle}>
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
              <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', marginTop: '8px', overflow: 'hidden' }}>
                {customerResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => selectCustomer(c)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 12px',
                      border: 'none',
                      borderBottom: '1px solid #f3f4f6',
                      background: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    {c.customer_name} — {c.customer_email || c.customer_phone || 'No contact'}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label style={labelStyle}>Recipient name *</label>
            <input
              style={inputStyle}
              value={form.recipient_name}
              onChange={(e) => setForm((p) => ({ ...p, recipient_name: e.target.value }))}
            />
          </div>
          <div>
            <label style={labelStyle}>Email</label>
            <input
              style={inputStyle}
              value={form.recipient_email}
              onChange={(e) => setForm((p) => ({ ...p, recipient_email: e.target.value }))}
              placeholder="customer@example.com"
            />
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

        <h3 style={{ marginTop: '28px', marginBottom: 0 }}>Line items</h3>
        <InvoiceLineItemsEditor
          lines={lines}
          onChange={setLines}
          businessId={selectedBusinessId}
          indianStatusGstOnly={form.indian_status_gst_only}
        />

        {taxSummary && (
          <div style={{ marginTop: '16px', textAlign: 'right', fontSize: '15px' }}>
            <div>Subtotal: ${taxSummary.subtotal.toFixed(2)}</div>
            <div>Tax: ${taxSummary.tax_amount.toFixed(2)}</div>
            <div style={{ fontWeight: 700, fontSize: '18px', marginTop: '4px' }}>
              Total: ${taxSummary.total.toFixed(2)} / month
            </div>
          </div>
        )}

        <div style={{ marginTop: '16px' }}>
          <TavariCheckbox
            label="Indian Status — GST only on taxable items"
            checked={form.indian_status_gst_only}
            onChange={(checked) => setForm((p) => ({ ...p, indian_status_gst_only: checked }))}
          />
        </div>

        <div style={{ marginTop: '16px' }}>
          <label style={labelStyle}>Notes (shown on invoice)</label>
          <textarea
            style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }}
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
          />
        </div>
      </div>

      {isEdit && runHistory.length > 0 && (
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Issued invoices</h3>
          <ul style={{ margin: 0, paddingLeft: '20px' }}>
            {runHistory.map((run) => (
              <li key={run.id} style={{ marginBottom: '8px' }}>
                {run.planned_date} —{' '}
                {run.tavari_invoices ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/dashboard/invoices/${run.invoice_id}`)}
                    style={{ background: 'none', border: 'none', color: '#008080', cursor: 'pointer', padding: 0, fontWeight: 600 }}
                  >
                    {run.tavari_invoices.invoice_number}
                  </button>
                ) : (
                  'Invoice removed'
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
