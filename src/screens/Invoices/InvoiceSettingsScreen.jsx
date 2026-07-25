import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Save } from 'lucide-react';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import { TavariStyles } from '../../utils/TavariStyles';
import invoiceService from '../../services/Invoices/invoiceService';
import ModuleDeactivationPanel from '../../components/Modules/ModuleDeactivationPanel';

const DEFAULT_REMINDERS = [
  { days_before_due: 0, days_after_due: 3, recipient: 'both' },
  { days_before_due: 0, days_after_due: 7, recipient: 'both' },
  { days_before_due: 0, days_after_due: 14, recipient: 'both' },
];

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
};

export default function InvoiceSettingsScreen() {
  const { selectedBusinessId } = useBusinessContext();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('invoices.settings');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [business, setBusiness] = useState(null);
  const [form, setForm] = useState({
    doing_business_as: '',
    address_override: '',
    city_override: '',
    state_override: '',
    postal_override: '',
    tax_number_override: '',
    default_logo_url: '',
    footer_terms: 'Due on receipt',
    default_due_days: 0,
    e_transfer_password_hint: 'Tanggo',
    reminder_schedule_json: JSON.stringify(DEFAULT_REMINDERS, null, 2),
  });

  useEffect(() => {
    if (!selectedBusinessId) return;
    (async () => {
      setLoading(true);
      try {
        invoiceService.setBusinessId(selectedBusinessId);
        const [settings, profile] = await Promise.all([
          invoiceService.getSettings(),
          invoiceService.getBusinessProfile(),
        ]);
        setBusiness(profile);
        if (settings) {
          setForm({
            doing_business_as: settings.doing_business_as || '',
            address_override: settings.address_override || '',
            city_override: settings.city_override || '',
            state_override: settings.state_override || '',
            postal_override: settings.postal_override || '',
            tax_number_override: settings.tax_number_override || '',
            default_logo_url: settings.default_logo_url || profile?.logo_url || '',
            footer_terms: settings.footer_terms || 'Due on receipt',
            default_due_days: settings.default_due_days ?? 0,
            e_transfer_password_hint: settings.e_transfer_password_hint || 'Tanggo',
            reminder_schedule_json: JSON.stringify(
              settings.reminder_schedule || DEFAULT_REMINDERS,
              null,
              2
            ),
          });
        }
      } catch (err) {
        toast.error(err.message || 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedBusinessId]);

  const handleSave = async () => {
    if (!canEdit) {
      toast.error('You do not have permission to edit invoice settings');
      return;
    }
    setSaving(true);
    try {
      let reminder_schedule = DEFAULT_REMINDERS;
      try {
        reminder_schedule = JSON.parse(form.reminder_schedule_json);
      } catch {
        throw new Error('Reminder schedule must be valid JSON');
      }

      invoiceService.setBusinessId(selectedBusinessId);
      await invoiceService.upsertSettings({
        doing_business_as: form.doing_business_as || null,
        address_override: form.address_override || null,
        city_override: form.city_override || null,
        state_override: form.state_override || null,
        postal_override: form.postal_override || null,
        tax_number_override: form.tax_number_override || null,
        default_logo_url: form.default_logo_url || null,
        footer_terms: form.footer_terms || 'Due on receipt',
        default_due_days: Number(form.default_due_days) || 0,
        e_transfer_password_hint: form.e_transfer_password_hint || 'Tanggo',
        reminder_schedule,
      });
      toast.success('Invoice settings saved');
    } catch (err) {
      toast.error(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={cardStyle}>Loading settings…</div>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
      }}>
        <h2 style={{ margin: 0 }}>Invoice Settings</h2>
        {canEdit && (
          <button type="button" onClick={handleSave} disabled={saving} style={saveBtnStyle}>
            <Save size={16} /> {saving ? 'Saving…' : 'Save settings'}
          </button>
        )}
      </div>

      <p style={{ color: '#6b7280', fontSize: '14px' }}>
        Legal name uses <strong>{business?.name || 'business profile'}</strong>.
        E-transfer sends to <strong>{business?.business_email || 'business email'}</strong>.
      </p>

      <div style={gridStyle}>
        <div>
          <label style={labelStyle}>Doing business as (DBA)</label>
          <input
            style={inputStyle}
            value={form.doing_business_as}
            disabled={!canEdit}
            onChange={(e) => setForm((p) => ({ ...p, doing_business_as: e.target.value }))}
          />
        </div>
        <div>
          <label style={labelStyle}>Default due days (0 = due on receipt)</label>
          <input
            style={inputStyle}
            type="number"
            min="0"
            value={form.default_due_days}
            disabled={!canEdit}
            onChange={(e) => setForm((p) => ({ ...p, default_due_days: e.target.value }))}
          />
        </div>
        <div>
          <label style={labelStyle}>E-transfer password hint</label>
          <input
            style={inputStyle}
            value={form.e_transfer_password_hint}
            disabled={!canEdit}
            onChange={(e) => setForm((p) => ({ ...p, e_transfer_password_hint: e.target.value }))}
          />
        </div>
        <div>
          <label style={labelStyle}>Footer / terms default</label>
          <input
            style={inputStyle}
            value={form.footer_terms}
            disabled={!canEdit}
            onChange={(e) => setForm((p) => ({ ...p, footer_terms: e.target.value }))}
          />
        </div>
      </div>

      <h3 style={{ marginTop: '24px' }}>Address & HST overrides</h3>
      <div style={gridStyle}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Address override</label>
          <input
            style={inputStyle}
            placeholder={business?.business_address || ''}
            value={form.address_override}
            disabled={!canEdit}
            onChange={(e) => setForm((p) => ({ ...p, address_override: e.target.value }))}
          />
        </div>
        <div>
          <label style={labelStyle}>City</label>
          <input style={inputStyle} value={form.city_override} disabled={!canEdit} onChange={(e) => setForm((p) => ({ ...p, city_override: e.target.value }))} />
        </div>
        <div>
          <label style={labelStyle}>Province</label>
          <input style={inputStyle} value={form.state_override} disabled={!canEdit} onChange={(e) => setForm((p) => ({ ...p, state_override: e.target.value }))} />
        </div>
        <div>
          <label style={labelStyle}>Postal</label>
          <input style={inputStyle} value={form.postal_override} disabled={!canEdit} onChange={(e) => setForm((p) => ({ ...p, postal_override: e.target.value }))} />
        </div>
        <div>
          <label style={labelStyle}>HST number override</label>
          <input
            style={inputStyle}
            placeholder={business?.tax_number || ''}
            value={form.tax_number_override}
            disabled={!canEdit}
            onChange={(e) => setForm((p) => ({ ...p, tax_number_override: e.target.value }))}
          />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Default logo URL</label>
          <input
            style={inputStyle}
            value={form.default_logo_url}
            disabled={!canEdit}
            onChange={(e) => setForm((p) => ({ ...p, default_logo_url: e.target.value }))}
          />
        </div>
      </div>

      <h3 style={{ marginTop: '24px' }}>Reminder schedule (JSON)</h3>
      <p style={{ fontSize: '13px', color: '#6b7280' }}>
        Reminders go to the customer and the business when an invoice is unpaid. Use days_after_due from the due date.
      </p>
      <textarea
        style={{
          ...inputStyle,
          minHeight: '160px',
          fontFamily: 'monospace',
          marginTop: '8px',
        }}
        value={form.reminder_schedule_json}
        disabled={!canEdit}
        onChange={(e) => setForm((p) => ({ ...p, reminder_schedule_json: e.target.value }))}
      />

      <ModuleDeactivationPanel moduleKey="invoices" />
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

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '16px',
  marginTop: '12px',
};

const saveBtnStyle = {
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
