import React from 'react';
import { FiClock } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import { buildSpecialHoursReminderMessage } from '../../utils/businessSpecialHours';

export default function SpecialHoursReminderModal({
  open,
  entry,
  dateLabel,
  onConfirm,
}) {
  if (!open || !entry) return null;

  const message = buildSpecialHoursReminderMessage(entry, { dateLabel });

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="special-hours-reminder-title"
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: 12,
          maxWidth: 520,
          width: '100%',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '20px 24px',
            borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 999,
              backgroundColor: '#fffbeb',
              color: '#d97706',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <FiClock size={20} />
          </div>
          <div>
            <h2
              id="special-hours-reminder-title"
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 700,
                color: TavariStyles.colors.gray900,
              }}
            >
              Special hours reminder
            </h2>
            {dateLabel ? (
              <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 4 }}>
                {dateLabel}
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ padding: '20px 24px' }}>
          <p
            style={{
              margin: 0,
              fontSize: 15,
              lineHeight: 1.6,
              color: TavariStyles.colors.gray700,
            }}
          >
            {message}
          </p>
        </div>

        <div
          style={{
            padding: '16px 24px',
            borderTop: `1px solid ${TavariStyles.colors.gray200}`,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: TavariStyles.colors.primary,
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
