import React, { useEffect, useRef, useState } from 'react';
import { TavariStyles } from '../../utils/TavariStyles';

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: `1px solid ${TavariStyles.colors.gray300}`,
  borderRadius: '8px',
  fontSize: '14px',
  boxSizing: 'border-box',
  backgroundColor: 'white',
};

const labelStyle = {
  fontSize: '13px',
  fontWeight: '600',
  color: TavariStyles.colors.gray900,
  marginBottom: '8px',
};

/**
 * Local-state customer fields so typing does not re-render the schedule grid on every keystroke.
 * Syncs to parent on a short debounce (for customer search + submit payload).
 * Also writes the latest values to liveFieldsRef so submit can flush without waiting.
 */
export default function ScheduleNewBookingCustomerFields({
  customerId,
  customerFirstName,
  customerLastName,
  customerEmail,
  customerPhone,
  gridTemplateColumns,
  contentMaxWidth,
  onFieldsChange,
  liveFieldsRef = null,
  syncVersion = 0,
}) {
  const [local, setLocal] = useState({
    customerFirstName: customerFirstName || '',
    customerLastName: customerLastName || '',
    customerEmail: customerEmail || '',
    customerPhone: customerPhone || '',
  });
  const onFieldsChangeRef = useRef(onFieldsChange);
  onFieldsChangeRef.current = onFieldsChange;

  // Re-hydrate when parent selects a customer or resets the form.
  useEffect(() => {
    setLocal({
      customerFirstName: customerFirstName || '',
      customerLastName: customerLastName || '',
      customerEmail: customerEmail || '',
      customerPhone: customerPhone || '',
    });
  }, [syncVersion, customerId]);

  useEffect(() => {
    if (liveFieldsRef) {
      liveFieldsRef.current = local;
    }
  }, [local, liveFieldsRef]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      onFieldsChangeRef.current?.(local);
    }, 200);
    return () => window.clearTimeout(timeoutId);
  }, [local]);

  const updateField = (field, value) => {
    setLocal((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns,
        gap: '14px',
        width: '100%',
        maxWidth: contentMaxWidth,
      }}
    >
      <div>
        <div style={labelStyle}>Customer first name</div>
        <input
          type="text"
          value={local.customerFirstName}
          onChange={(e) => updateField('customerFirstName', e.target.value)}
          style={inputStyle}
          autoComplete="given-name"
        />
      </div>
      <div>
        <div style={labelStyle}>Last name</div>
        <input
          type="text"
          value={local.customerLastName}
          onChange={(e) => updateField('customerLastName', e.target.value)}
          style={inputStyle}
          autoComplete="family-name"
        />
      </div>
      <div>
        <div style={labelStyle}>Email</div>
        <input
          type="email"
          value={local.customerEmail}
          onChange={(e) => updateField('customerEmail', e.target.value)}
          style={inputStyle}
          autoComplete="email"
        />
      </div>
      <div>
        <div style={labelStyle}>Phone</div>
        <input
          type="tel"
          value={local.customerPhone}
          onChange={(e) => updateField('customerPhone', e.target.value)}
          style={inputStyle}
          autoComplete="tel"
        />
      </div>
    </div>
  );
}
