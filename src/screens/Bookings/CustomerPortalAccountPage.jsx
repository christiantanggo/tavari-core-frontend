import React, { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../../supabaseClient';

const boxStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const inputStyle = {
  width: '100%',
  padding: '12px 14px',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  fontSize: 14,
};

const CustomerPortalAccountPage = () => {
  const { portalData, setPortalData } = useOutletContext();
  const customer = portalData?.customer || {};
  const attachedPeople = portalData?.account?.attachedPeople || [];
  const [form, setForm] = useState({
    customerName: customer.customer_name || '',
    customerEmail: customer.customer_email || '',
    customerPhone: customer.customer_phone || '',
  });
  const [saving, setSaving] = useState(false);

  const summary = useMemo(() => ({
    totalPeople: attachedPeople.length + 1,
    owners: attachedPeople.filter((person) => person.accessLevel === 'Owner').length + 1,
  }), [attachedPeople]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('customer-portal-data', {
        body: {
          action: 'updateAccount',
          businessId: customer.business_id,
          customerId: customer.id,
          phone: customer.customer_phone,
          customerName: form.customerName,
          customerEmail: form.customerEmail,
          customerPhone: form.customerPhone,
        },
      });

      if (error || data?.error) {
        throw new Error(data?.error || error?.message || 'Failed to update account');
      }

      setPortalData(data);
    } catch (updateError) {
      console.error(updateError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Account</h2>
        <p style={{ margin: '8px 0 0', color: '#6b7280' }}>
          Review who is attached to your account and update your primary customer details.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        <div style={boxStyle}>
          <div style={{ fontSize: 14, color: '#6b7280' }}>People connected</div>
          <div style={{ fontSize: 33, fontWeight: 700 }}>{summary.totalPeople}</div>
        </div>
        <div style={boxStyle}>
          <div style={{ fontSize: 14, color: '#6b7280' }}>Account owners</div>
          <div style={{ fontSize: 33, fontWeight: 700 }}>{summary.owners}</div>
        </div>
      </div>

      <div style={boxStyle}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>Primary account information</div>
        <input
          style={inputStyle}
          value={form.customerName}
          onChange={(event) => setForm((prev) => ({ ...prev, customerName: event.target.value }))}
          placeholder="Full name"
        />
        <input
          style={inputStyle}
          value={form.customerEmail}
          onChange={(event) => setForm((prev) => ({ ...prev, customerEmail: event.target.value }))}
          placeholder="Email address"
        />
        <input
          style={inputStyle}
          value={form.customerPhone}
          onChange={(event) => setForm((prev) => ({ ...prev, customerPhone: event.target.value }))}
          placeholder="Phone number"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{ alignSelf: 'flex-start', background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, padding: '12px 18px', fontWeight: 600, cursor: 'pointer' }}
        >
          {saving ? 'Saving...' : 'Save account changes'}
        </button>
      </div>

      <div style={boxStyle}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>People attached to this account</div>
        <div style={{ color: '#6b7280' }}>
          Access levels are shown here now. Editing custom access levels can be expanded next if you want separate permission rules per person.
        </div>
        {attachedPeople.length === 0 ? (
          <div style={{ color: '#6b7280' }}>No additional people are attached yet.</div>
        ) : attachedPeople.map((person) => (
          <div key={person.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>{person.displayName}</div>
            <div style={{ color: '#6b7280' }}>{person.accessLevel}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CustomerPortalAccountPage;
