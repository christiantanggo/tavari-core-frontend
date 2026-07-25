import React, { useEffect, useState } from 'react';
import { FiAlertTriangle, FiX } from 'react-icons/fi';
import { getBookingBookerDisplayName } from '../../helpers/Bookings/bookingProvenance';
import { formatDateShort } from '../../utils/businessDateFormat';
import { formatBookingTimeRangeLabel } from '../../utils/bookingTimeRange';
import { TavariStyles } from '../../utils/TavariStyles';

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

const fieldLabelStyle = {
  display: 'block',
  marginBottom: 6,
  fontWeight: 600,
  fontSize: 13,
  color: TavariStyles.colors.gray900,
};

const fieldTextareaStyle = {
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
  const activityName = booking.booking_activities?.activity_name || 'Booking';
  const dateLabel = formatDateShort(booking.booking_date, businessTimezone);
  const timeLabel = formatBookingTimeRangeLabel(booking);

  return (
    <div style={{
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

export default function BookingCancelActionModal({
  open,
  booking = null,
  businessTimezone = null,
  loading = false,
  onClose,
  onConfirm,
}) {
  const [reason, setReason] = useState('');
  const [acknowledgeNoEmail, setAcknowledgeNoEmail] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setAcknowledgeNoEmail(false);
  }, [open, booking?.id]);

  if (!open || !booking) return null;

  const trimmedReason = reason.trim();
  const hasCustomerEmail = Boolean(String(booking.customer_email || '').trim());
  const confirmDisabled = loading
    || !trimmedReason
    || (!hasCustomerEmail && !acknowledgeNoEmail);

  return (
    <div style={overlayStyle} role="presentation" onClick={() => { if (!loading) onClose?.(); }}>
      <div
        style={cardStyle}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-cancel-action-title"
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
            <h3 id="booking-cancel-action-title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
              Cancel booking?
            </h3>
            <p style={{ margin: '8px 0 0', fontSize: 14, color: TavariStyles.colors.gray600, lineHeight: 1.5 }}>
              This will cancel the reservation and notify the customer when an email is on file.
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

          {!hasCustomerEmail ? (
            <div style={{
              padding: '12px 14px',
              borderRadius: 8,
              backgroundColor: '#fffbeb',
              border: '1px solid #fcd34d',
              fontSize: 13,
              lineHeight: 1.45,
              color: '#92400e',
            }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <FiAlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  No customer email is on file, so no cancellation notice will be sent.
                  Confirm below to proceed anyway.
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={acknowledgeNoEmail}
                  onChange={(event) => setAcknowledgeNoEmail(event.target.checked)}
                  disabled={loading}
                />
                <span>I understand no email will be sent</span>
              </label>
            </div>
          ) : null}

          <div>
            <label htmlFor="booking-cancel-reason" style={fieldLabelStyle}>
              Cancellation reason
            </label>
            <textarea
              id="booking-cancel-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why is this booking being cancelled? (required)"
              disabled={loading}
              style={{
                ...fieldTextareaStyle,
                opacity: loading ? 0.7 : 1,
              }}
            />
          </div>
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
            Keep booking
          </button>
          <button
            type="button"
            onClick={() => onConfirm?.(trimmedReason)}
            disabled={confirmDisabled}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: 'none',
              background: '#dc2626',
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
              cursor: confirmDisabled ? 'not-allowed' : 'pointer',
              opacity: confirmDisabled ? 0.6 : 1,
            }}
          >
            {loading ? 'Cancelling…' : 'Cancel booking'}
          </button>
        </div>
      </div>
    </div>
  );
}
