import React, { useEffect, useState } from 'react';
import { FiX } from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import { formatDateShort } from '../../utils/businessDateFormat';
import { formatBookingTimeRangeLabel } from '../../utils/bookingTimeRange';
import { getBookingBookerDisplayName } from '../../helpers/Bookings/bookingProvenance';

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 20000,
  backgroundColor: 'rgba(15, 23, 42, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const cardStyle = {
  background: TavariStyles.colors.white,
  borderRadius: 12,
  maxWidth: 480,
  width: '100%',
  overflow: 'hidden',
  boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
};

const btnSecondary = {
  padding: '10px 18px',
  borderRadius: 8,
  border: `1px solid ${TavariStyles.colors.gray300}`,
  background: TavariStyles.colors.white,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 14,
};

const explanationLabelStyle = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: TavariStyles.colors.gray900,
  marginBottom: 6,
};

const explanationTextareaStyle = {
  width: '100%',
  minHeight: 96,
  padding: '10px 12px',
  borderRadius: 8,
  border: `1px solid ${TavariStyles.colors.gray300}`,
  fontSize: 14,
  fontFamily: 'inherit',
  lineHeight: 1.45,
  resize: 'vertical',
  boxSizing: 'border-box',
};

function BookingSummary({ booking, businessTimezone }) {
  if (!booking) return null;

  const booker = getBookingBookerDisplayName(booking);
  const activityName = booking.booking_activities?.activity_name || 'Party';
  const dateLabel = formatDateShort(booking.booking_date, businessTimezone);
  const timeLabel = formatBookingTimeRangeLabel(booking);

  return (
    <div
      style={{
        background: '#f9fafb',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '12px 14px',
        fontSize: 14,
        lineHeight: 1.5,
        color: TavariStyles.colors.gray900,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{activityName}</div>
      <div>{booker || 'Customer'}</div>
      <div style={{ color: TavariStyles.colors.gray600 }}>
        {dateLabel}
        {timeLabel ? ` · ${timeLabel}` : ''}
      </div>
      {booking.booking_number ? (
        <div style={{ color: TavariStyles.colors.gray500, fontSize: 13, marginTop: 4 }}>
          Booking #{booking.booking_number}
        </div>
      ) : null}
    </div>
  );
}

export default function BookingApprovalActionModal({
  open,
  mode = 'approve',
  booking = null,
  businessTimezone = null,
  loading = false,
  blockedReason = null,
  onClose,
  onConfirm,
}) {
  const [explanation, setExplanation] = useState('');

  useEffect(() => {
    if (open && mode === 'revoke') {
      setExplanation('');
    }
  }, [open, mode]);

  if (!open) return null;

  const isApprove = mode === 'approve';
  const isRevoke = mode === 'revoke';
  const title = isApprove ? 'Approve this booking?' : 'Remove approval?';
  const confirmLabel = isApprove ? 'Approve & request deposit' : 'Remove approval';
  const body = isApprove
    ? 'This confirms the party request and automatically emails the customer a deposit payment link. The booking will move to confirmed status.'
    : blockedReason
      || 'The booking will return to pending approval. Any outstanding deposit payment request will be cancelled, but the booking itself will stay on the schedule.';

  const trimmedExplanation = explanation.trim();
  const confirmDisabled = loading
    || (!isApprove && !!blockedReason)
    || (isRevoke && !trimmedExplanation);

  const handleConfirm = () => {
    if (isRevoke) {
      onConfirm?.(trimmedExplanation);
      return;
    }
    onConfirm?.();
  };

  return (
    <div style={overlayStyle} role="presentation" onClick={() => { if (!loading) onClose?.(); }}>
      <div
        style={cardStyle}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-approval-action-title"
      >
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
        }}
        >
          <div>
            <h3 id="booking-approval-action-title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
              {title}
            </h3>
            <p style={{ margin: '8px 0 0', fontSize: 14, color: TavariStyles.colors.gray600, lineHeight: 1.5 }}>
              Please confirm you meant to tap this button.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { if (!loading) onClose?.(); }}
            disabled={loading}
            aria-label="Close"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: loading ? 'not-allowed' : 'pointer',
              color: TavariStyles.colors.gray500,
              padding: 4,
            }}
          >
            <FiX size={20} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'grid', gap: 14 }}>
          <BookingSummary booking={booking} businessTimezone={businessTimezone} />
          <p style={{ margin: 0, fontSize: 14, color: blockedReason ? '#b45309' : TavariStyles.colors.gray700, lineHeight: 1.5 }}>
            {body}
          </p>
          {isRevoke && !blockedReason ? (
            <div>
              <label htmlFor="booking-revoke-approval-explanation" style={explanationLabelStyle}>
                Explanation
              </label>
              <textarea
                id="booking-revoke-approval-explanation"
                value={explanation}
                onChange={(event) => setExplanation(event.target.value)}
                placeholder="Explain why approval is being removed (required)"
                disabled={loading}
                style={{
                  ...explanationTextareaStyle,
                  opacity: loading ? 0.7 : 1,
                }}
              />
              <p style={{ margin: '6px 0 0', fontSize: 13, color: TavariStyles.colors.gray500, lineHeight: 1.4 }}>
                This note is saved on the booking history for your team.
              </p>
            </div>
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
            onClick={() => { if (!loading) onClose?.(); }}
            disabled={loading}
            style={{ ...btnSecondary, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
          >
            Go back
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirmDisabled}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: 'none',
              background: isApprove ? TavariStyles.colors.primary : '#ef4444',
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
              cursor: confirmDisabled ? 'not-allowed' : 'pointer',
              opacity: confirmDisabled ? 0.6 : 1,
            }}
          >
            {loading ? (isApprove ? 'Approving…' : 'Removing…') : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
