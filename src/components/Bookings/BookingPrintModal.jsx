import React, { useEffect, useState } from 'react';
import { FiPrinter, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import {
  BOOKING_PRINT_SECTIONS,
  DEFAULT_BOOKING_PRINT_SECTIONS,
  loadSavedPrintSectionPreferences,
  savePrintSectionPreferences,
} from '../../helpers/Bookings/bookingPrint';

const btnSecondary = {
  padding: '10px 18px',
  borderRadius: 8,
  border: `1px solid ${TavariStyles.colors.gray300}`,
  background: TavariStyles.colors.white,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 14,
};

const btnPrimary = {
  padding: '10px 18px',
  borderRadius: 8,
  border: 'none',
  background: TavariStyles.colors.primary,
  color: '#fff',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};

export default function BookingPrintModal({
  open,
  onClose,
  businessId,
  loading = false,
  onPrint,
}) {
  const [sections, setSections] = useState({ ...DEFAULT_BOOKING_PRINT_SECTIONS });
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (open && businessId) {
      setSections(loadSavedPrintSectionPreferences(businessId));
    }
  }, [open, businessId]);

  if (!open) return null;

  const selectedCount = BOOKING_PRINT_SECTIONS.filter((section) => sections[section.id]).length;

  const toggleSection = (sectionId, checked) => {
    setSections((current) => ({ ...current, [sectionId]: checked }));
  };

  const handlePrint = async () => {
    if (selectedCount === 0) {
      toast.error('Select at least one section to print.');
      return;
    }

    setPrinting(true);
    try {
      savePrintSectionPreferences(businessId, sections);
      await onPrint?.(sections);
      onClose?.();
    } catch (error) {
      toast.error(error?.message || 'Could not print booking');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 20000,
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      role="presentation"
      onClick={() => { if (!printing) onClose?.(); }}
    >
      <div
        style={{
          background: TavariStyles.colors.white,
          borderRadius: 12,
          maxWidth: 520,
          width: '100%',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-print-modal-title"
      >
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
        }}
        >
          <div>
            <h3 id="booking-print-modal-title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
              Print booking
            </h3>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: TavariStyles.colors.gray600 }}>
              Choose which sections to include. Your selections are remembered for next time.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { if (!printing) onClose?.(); }}
            disabled={printing}
            aria-label="Close"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: printing ? 'not-allowed' : 'pointer',
              color: TavariStyles.colors.gray500,
              padding: 4,
            }}
          >
            <FiX size={20} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <p style={{ margin: 0, color: TavariStyles.colors.gray600, fontSize: 14 }}>
              Loading guest list, notes, and print data…
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {BOOKING_PRINT_SECTIONS.map((section) => (
                <label
                  key={section.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '12px 14px',
                    borderRadius: 8,
                    border: `1px solid ${sections[section.id] ? TavariStyles.colors.primary : '#e5e7eb'}`,
                    backgroundColor: sections[section.id] ? '#f0fdf4' : 'white',
                    cursor: 'pointer',
                  }}
                >
                  <div onClick={(event) => event.stopPropagation()}>
                    <TavariCheckbox
                      checked={!!sections[section.id]}
                      onChange={(checked) => toggleSection(section.id, checked)}
                      disabled={printing}
                      size="sm"
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: TavariStyles.colors.gray900 }}>
                      {section.label}
                    </div>
                    <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 4, lineHeight: 1.45 }}>
                      {section.description}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
        >
          <span style={{ fontSize: 13, color: TavariStyles.colors.gray600 }}>
            {selectedCount} section{selectedCount === 1 ? '' : 's'} selected
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={() => { if (!printing) onClose?.(); }}
              disabled={printing}
              style={{ ...btnSecondary, cursor: printing ? 'not-allowed' : 'pointer', opacity: printing ? 0.6 : 1 }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={printing || loading || selectedCount === 0}
              style={{
                ...btnPrimary,
                cursor: printing || loading || selectedCount === 0 ? 'not-allowed' : 'pointer',
                opacity: printing || loading || selectedCount === 0 ? 0.6 : 1,
              }}
            >
              <FiPrinter size={16} />
              {printing ? 'Printing…' : 'Print'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
