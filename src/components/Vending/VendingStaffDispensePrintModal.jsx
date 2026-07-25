import React, { useEffect, useState } from 'react';
import { FiPrinter, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import {
  DEFAULT_VENDING_STAFF_DISPENSE_PRINT_SECTIONS,
  loadSavedVendingStaffDispensePrintSections,
  saveVendingStaffDispensePrintSections,
  VENDING_STAFF_DISPENSE_PRINT_SECTIONS
} from '../../helpers/Vending/vendingStaffDispensePrint';

const btnSecondary = {
  padding: '10px 18px',
  borderRadius: 8,
  border: `1px solid ${TavariStyles.colors.gray300}`,
  background: TavariStyles.colors.white,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 14
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
  gap: 8
};

export default function VendingStaffDispensePrintModal({
  open,
  onClose,
  businessId,
  loading = false,
  onPrint
}) {
  const [sections, setSections] = useState({ ...DEFAULT_VENDING_STAFF_DISPENSE_PRINT_SECTIONS });
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (open && businessId) {
      setSections(loadSavedVendingStaffDispensePrintSections(businessId));
    }
  }, [open, businessId]);

  if (!open) return null;

  const selectedCount = VENDING_STAFF_DISPENSE_PRINT_SECTIONS.filter(
    (section) => sections[section.id]
  ).length;

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
      saveVendingStaffDispensePrintSections(businessId, sections);
      await onPrint?.(sections);
      onClose?.();
    } catch (error) {
      toast.error(error?.message || 'Could not print report');
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
        padding: 16
      }}
      role="presentation"
      onClick={() => {
        if (!printing) onClose?.();
      }}
    >
      <div
        style={{
          background: TavariStyles.colors.white,
          borderRadius: 12,
          maxWidth: 520,
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: TavariStyles.shadows.xl
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vending-staff-dispense-print-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: `1px solid ${TavariStyles.colors.gray200}`
          }}
        >
          <h2 id="vending-staff-dispense-print-title" style={{ margin: 0, fontSize: 18 }}>
            Print staff dispense report
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={printing}
            aria-label="Close"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: printing ? 'not-allowed' : 'pointer',
              color: TavariStyles.colors.gray600
            }}
          >
            <FiX size={20} />
          </button>
        </div>

        <div style={{ padding: '16px 20px' }}>
          <p style={{ marginTop: 0, color: TavariStyles.colors.gray600, fontSize: 14 }}>
            Choose which sections to include. Your choices are saved for this business.
          </p>

          <div style={{ display: 'grid', gap: 12 }}>
            {VENDING_STAFF_DISPENSE_PRINT_SECTIONS.map((section) => (
              <div
                key={section.id}
                style={{
                  border: `1px solid ${TavariStyles.colors.gray200}`,
                  borderRadius: 8,
                  padding: 12
                }}
              >
                <TavariCheckbox
                  id={`vending-staff-print-${section.id}`}
                  checked={Boolean(sections[section.id])}
                  onChange={(checked) => toggleSection(section.id, checked)}
                  label={section.label}
                />
                <p style={{ margin: '6px 0 0 28px', fontSize: 13, color: TavariStyles.colors.gray600 }}>
                  {section.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            padding: '16px 20px',
            borderTop: `1px solid ${TavariStyles.colors.gray200}`
          }}
        >
          <button type="button" style={btnSecondary} onClick={onClose} disabled={printing}>
            Cancel
          </button>
          <button type="button" style={btnPrimary} onClick={handlePrint} disabled={printing || loading}>
            <FiPrinter size={16} />
            {printing ? 'Printing…' : `Print (${selectedCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}
