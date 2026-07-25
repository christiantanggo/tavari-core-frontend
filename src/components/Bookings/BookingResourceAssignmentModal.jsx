import React, { useEffect, useMemo, useState } from 'react';
import { FiAlertTriangle, FiX } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';

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
};

function sortIds(ids = []) {
  return [...ids].sort();
}

function idsEqual(a = [], b = []) {
  const sa = sortIds(a);
  const sb = sortIds(b);
  return sa.length === sb.length && sa.every((id, index) => id === sb[index]);
}

export default function BookingResourceAssignmentModal({
  open,
  onClose,
  categoryName = 'Room',
  resourceOptions = [],
  currentResourceIds = [],
  scheduledResourceIds = [],
  scheduledResourceNames = [],
  saving = false,
  onConfirm,
}) {
  const [selectedIds, setSelectedIds] = useState([]);

  useEffect(() => {
    if (open) {
      setSelectedIds([...currentResourceIds]);
    }
  }, [open, currentResourceIds]);

  const selectedNames = useMemo(
    () => selectedIds
      .map((id) => resourceOptions.find((resource) => resource.id === id)?.name || id)
      .filter(Boolean),
    [selectedIds, resourceOptions],
  );

  const currentNames = useMemo(
    () => currentResourceIds
      .map((id) => resourceOptions.find((resource) => resource.id === id)?.name || id)
      .filter(Boolean),
    [currentResourceIds, resourceOptions],
  );

  const requiredCount = scheduledResourceIds.length > 0
    ? scheduledResourceIds.length
    : Math.max(1, currentResourceIds.length);

  const selectionChanged = !idsEqual(selectedIds, currentResourceIds);
  const countMismatch = requiredCount > 0 && selectedIds.length !== requiredCount;

  if (!open) return null;

  const toggleResource = (resourceId, disabled) => {
    if (disabled || saving) return;
    setSelectedIds((current) => (
      current.includes(resourceId)
        ? current.filter((id) => id !== resourceId)
        : [...current, resourceId]
    ));
  };

  const handleConfirm = () => {
    if (selectedIds.length === 0 || saving) return;
    onConfirm?.(selectedIds);
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
      onClick={() => { if (!saving) onClose?.(); }}
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
        aria-labelledby="booking-resource-assignment-modal-title"
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
            <h3 id="booking-resource-assignment-modal-title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
              Change {categoryName}
            </h3>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: TavariStyles.colors.gray600 }}>
              Select one or more resources for this booking.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { if (!saving) onClose?.(); }}
            disabled={saving}
            aria-label="Close"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: saving ? 'not-allowed' : 'pointer',
              color: TavariStyles.colors.gray500,
              padding: 4,
            }}
          >
            <FiX size={20} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          <div style={{
            display: 'flex',
            gap: 12,
            padding: '14px 16px',
            borderRadius: 8,
            backgroundColor: '#fffbeb',
            border: '1px solid #fcd34d',
            marginBottom: 20,
          }}
          >
            <FiAlertTriangle size={20} color="#b45309" style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 13, color: '#92400e', lineHeight: 1.55 }}>
              <strong>Changing rooms can affect weekend capacity.</strong>
              {' '}
              Activities are scheduled with specific room combinations to fit as many parties as possible.
              Moving this booking to different rooms may block time slots that were planned for other parties,
              or free up rooms that other bookings still expect to use.
            </div>
          </div>

          {scheduledResourceNames.length > 0 ? (
            <div style={{
              fontSize: 13,
              color: TavariStyles.colors.gray700,
              marginBottom: 16,
              padding: '12px 14px',
              backgroundColor: TavariStyles.colors.gray50,
              borderRadius: 8,
              border: '1px solid #e5e7eb',
            }}
            >
              <strong>Scheduled default for this activity:</strong>
              {' '}
              {scheduledResourceNames.join(' + ')}
              {requiredCount > 1 ? ` (${requiredCount} rooms required)` : ''}
            </div>
          ) : null}

          {selectionChanged ? (
            <div style={{
              fontSize: 13,
              marginBottom: 16,
              padding: '12px 14px',
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              backgroundColor: '#f8fafc',
            }}
            >
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: TavariStyles.colors.gray600 }}>From: </span>
                <strong>{currentNames.length ? currentNames.join(' + ') : 'Not assigned'}</strong>
              </div>
              <div>
                <span style={{ color: TavariStyles.colors.gray600 }}>To: </span>
                <strong>{selectedNames.length ? selectedNames.join(' + ') : '—'}</strong>
              </div>
            </div>
          ) : null}

          {countMismatch ? (
            <div style={{
              fontSize: 13,
              color: '#b45309',
              marginBottom: 16,
              padding: '10px 12px',
              borderRadius: 8,
              backgroundColor: '#fff7ed',
              border: '1px solid #fed7aa',
            }}
            >
              This activity is normally scheduled with {requiredCount} room{requiredCount !== 1 ? 's' : ''}.
              You have selected {selectedIds.length}.
            </div>
          ) : null}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {resourceOptions.map((resource) => {
              const isSelected = selectedIds.includes(resource.id);
              const isDisabled = resource.disabled && !isSelected;

              return (
                <div
                  key={resource.id}
                  role="button"
                  tabIndex={isDisabled ? -1 : 0}
                  onClick={() => toggleResource(resource.id, isDisabled)}
                  onKeyDown={(event) => {
                    if (isDisabled) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggleResource(resource.id, isDisabled);
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '12px 14px',
                    borderRadius: 8,
                    border: `1px solid ${isSelected ? TavariStyles.colors.primary : '#e5e7eb'}`,
                    backgroundColor: isDisabled ? '#f9fafb' : 'white',
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    opacity: isDisabled ? 0.7 : 1,
                  }}
                >
                  <div onClick={(event) => event.stopPropagation()}>
                    <TavariCheckbox
                      checked={isSelected}
                      onChange={() => toggleResource(resource.id, isDisabled)}
                      disabled={saving || isDisabled}
                      size="sm"
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: TavariStyles.colors.gray900 }}>
                      {resource.name}
                    </div>
                    {isDisabled ? (
                      <div style={{ fontSize: 13, color: '#b45309', marginTop: 4 }}>
                        {resource.label !== resource.name ? resource.label : 'In use during this time'}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          {resourceOptions.some((resource) => resource.disabled) ? (
            <p style={{ fontSize: 13, color: TavariStyles.colors.gray600, margin: '14px 0 0', lineHeight: 1.5 }}>
              Rooms marked as in use overlap this booking&apos;s time window, including turnover padding.
            </p>
          ) : null}
        </div>

        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
        }}
        >
          <button
            type="button"
            onClick={() => { if (!saving) onClose?.(); }}
            disabled={saving}
            style={{ ...btnSecondary, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving || selectedIds.length === 0 || !selectionChanged}
            style={{
              ...btnPrimary,
              cursor: saving || selectedIds.length === 0 || !selectionChanged ? 'not-allowed' : 'pointer',
              opacity: saving || selectedIds.length === 0 || !selectionChanged ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Confirm room change'}
          </button>
        </div>
      </div>
    </div>
  );
}
