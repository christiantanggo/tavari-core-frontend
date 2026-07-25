import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { TavariStyles } from '../../utils/TavariStyles';

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10050,
  padding: 16,
};

const modalStyle = {
  backgroundColor: '#fff',
  borderRadius: 12,
  width: '100%',
  maxWidth: 440,
  boxShadow: '0 20px 40px rgba(0,0,0,0.18)',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 20px',
  borderBottom: '1px solid #e5e7eb',
};

const bodyStyle = {
  padding: 20,
};

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  fontSize: 14,
  boxSizing: 'border-box',
};

const primaryBtn = {
  width: '100%',
  padding: '10px 16px',
  borderRadius: 8,
  border: 'none',
  backgroundColor: TavariStyles.colors.primary,
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryBtn = {
  width: '100%',
  padding: '10px 16px',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  backgroundColor: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
};

export default function IndianStatusModal({
  open,
  onClose,
  gstRate = 0.05,
  taxLabel = 'GST (Indian Status)',
  active = false,
  initialCertificate = '',
  onApply,
  onClear,
  applying = false,
}) {
  const [certDraft, setCertDraft] = useState(initialCertificate);

  useEffect(() => {
    if (open) {
      setCertDraft(initialCertificate || '');
    }
  }, [open, initialCertificate]);

  if (!open) return null;

  const gstPercent = (clampRate(gstRate) * 100).toFixed(2);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Indian Status (GST Only)</h3>
          <button
            type="button"
            onClick={onClose}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4 }}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        <div style={bodyStyle}>
          <p style={{ fontSize: 13, color: TavariStyles.colors.gray600, margin: '0 0 16px', lineHeight: 1.5 }}>
            Enter the certificate / registry number. Tax for this booking will use only
            {' '}
            {taxLabel || 'GST (Indian Status)'}
            {' '}
            at
            {' '}
            {gstPercent}
            % from POS Settings (Taxes).
          </p>
          <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 13 }}>
            Indian Status number
          </label>
          <input
            type="text"
            value={certDraft}
            onChange={(e) => setCertDraft(e.target.value)}
            placeholder="Required to apply"
            style={inputStyle}
            autoFocus
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
            <button
              type="button"
              style={{ ...primaryBtn, opacity: applying ? 0.7 : 1 }}
              disabled={applying || !certDraft.trim()}
              onClick={() => {
                const cert = certDraft.trim();
                if (!cert) return;
                onApply?.(cert);
              }}
            >
              {applying ? 'Applying…' : 'Apply to this booking'}
            </button>
            {active && onClear && (
              <button
                type="button"
                style={secondaryBtn}
                disabled={applying}
                onClick={() => onClear?.()}
              >
                Remove Indian Status
              </button>
            )}
            <button type="button" style={secondaryBtn} disabled={applying} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function clampRate(rate) {
  return Math.min(1, Math.max(0, Number(rate) || 0));
}
