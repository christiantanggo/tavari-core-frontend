import React, { useEffect, useMemo, useState } from 'react';
import { FiAlertTriangle, FiX } from 'react-icons/fi';
import { assessBookingExtensionAvailability } from '../../helpers/Bookings/bookingExtensionAvailability';
import { getBookingBookerDisplayName } from '../../helpers/Bookings/bookingProvenance';
import { formatDateShort } from '../../utils/businessDateFormat';
import {
  calculateExtensionPrice,
  formatExtensionPricingSummary,
  formatExtensionPricingUnitLabel,
} from '../../utils/bookingExtensionPricing';
import { formatBookingMoney } from '../../utils/bookingPricing';
import { formatBookingTimeRangeLabel, formatTime12Hour, getBookingEndTime } from '../../utils/bookingTimeRange';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';

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
  maxWidth: 560,
  width: '100%',
  maxHeight: '90vh',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
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

const fieldInputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: `1px solid ${TavariStyles.colors.gray300}`,
  fontSize: 14,
  boxSizing: 'border-box',
};

const EXTENSION_TYPES = [
  { id: 'paid', label: 'Paid extension' },
  { id: 'courtesy', label: 'Courtesy (no charge)' },
  { id: 'operational', label: 'Operational (no charge)' },
];

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

export default function BookingExtendTimeModal({
  open,
  booking = null,
  businessTimezone = null,
  extensionPricing = null,
  dayBookings = [],
  resources = [],
  resourcePaddingById = new Map(),
  resourceQuantityById = new Map(),
  checkingAvailability = false,
  loading = false,
  onClose,
  onConfirm,
}) {
  const [addedMinutes, setAddedMinutes] = useState('30');
  const [extensionType, setExtensionType] = useState('paid');
  const [reason, setReason] = useState('');
  const [useCustomCharge, setUseCustomCharge] = useState(false);
  const [customCharge, setCustomCharge] = useState('');
  const [confirmStep, setConfirmStep] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAddedMinutes('30');
    setExtensionType('paid');
    setReason('');
    setUseCustomCharge(false);
    setCustomCharge('');
    setConfirmStep(false);
  }, [open, booking?.id]);

  const availability = useMemo(() => assessBookingExtensionAvailability({
    booking,
    addedMinutes,
    dayBookings,
    resources,
    resourcePaddingById,
    resourceQuantityById,
  }), [
    booking,
    addedMinutes,
    dayBookings,
    resources,
    resourcePaddingById,
    resourceQuantityById,
  ]);

  const calculatedCharge = useMemo(
    () => calculateExtensionPrice(addedMinutes, extensionPricing),
    [addedMinutes, extensionPricing],
  );

  const resolvedCharge = useMemo(() => {
    if (extensionType !== 'paid') return 0;
    if (useCustomCharge) {
      const parsed = Number.parseFloat(customCharge);
      return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : null;
    }
    return calculatedCharge;
  }, [extensionType, useCustomCharge, customCharge, calculatedCharge]);

  const currentEndLabel = booking ? formatTime12Hour(getBookingEndTime(booking)) : '';
  const newEndLabel = availability.newEndTimeLabel
    ? formatTime12Hour(availability.newEndTimeLabel)
    : '';

  const trimmedReason = reason.trim();
  const minutesValid = Number.parseInt(addedMinutes, 10) > 0;
  const chargeValid = extensionType !== 'paid'
    || (!useCustomCharge && Number.isFinite(resolvedCharge))
    || (useCustomCharge && Number.isFinite(resolvedCharge) && resolvedCharge >= 0);

  const canProceed = minutesValid
    && trimmedReason.length > 0
    && availability.ok
    && chargeValid
    && !checkingAvailability
    && !loading;

  if (!open) return null;

  const handlePrimaryAction = () => {
    if (!confirmStep) {
      if (!canProceed) return;
      setConfirmStep(true);
      return;
    }

    onConfirm?.({
      addedMinutes: Number.parseInt(addedMinutes, 10),
      extensionType,
      reason: trimmedReason,
      amountCharged: extensionType === 'paid' ? resolvedCharge : 0,
      priceOverridden: extensionType === 'paid' && useCustomCharge,
      calculatedCharge,
    });
  };

  return (
    <div style={overlayStyle} role="presentation" onClick={() => { if (!loading) onClose?.(); }}>
      <div
        style={cardStyle}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-extend-time-title"
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
            <h3 id="booking-extend-time-title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
              {confirmStep ? 'Confirm extension' : 'Extend booking time'}
            </h3>
            <p style={{ margin: '8px 0 0', fontSize: 14, color: TavariStyles.colors.gray600, lineHeight: 1.5 }}>
              {confirmStep
                ? 'Review the details below, then confirm to extend this party and block the extra time on the schedule.'
                : 'Add time, quote the customer, and record why the extension is being granted.'}
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

        <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'grid', gap: 16 }}>
          <BookingSummary booking={booking} businessTimezone={businessTimezone} />

          {!confirmStep ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <div>
                  <label htmlFor="booking-extend-minutes" style={fieldLabelStyle}>Minutes to add</label>
                  <input
                    id="booking-extend-minutes"
                    type="number"
                    min="1"
                    step="1"
                    value={addedMinutes}
                    onChange={(event) => setAddedMinutes(event.target.value)}
                    disabled={loading}
                    style={fieldInputStyle}
                  />
                </div>
                <div>
                  <label htmlFor="booking-extend-type" style={fieldLabelStyle}>Extension type</label>
                  <select
                    id="booking-extend-type"
                    value={extensionType}
                    onChange={(event) => {
                      setExtensionType(event.target.value);
                      if (event.target.value !== 'paid') {
                        setUseCustomCharge(false);
                      }
                    }}
                    disabled={loading}
                    style={{ ...fieldInputStyle, backgroundColor: 'white' }}
                  >
                    {EXTENSION_TYPES.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{
                padding: '14px 16px',
                borderRadius: 8,
                border: `1px solid ${TavariStyles.colors.gray200}`,
                backgroundColor: '#f9fafb',
                display: 'grid',
                gap: 8,
              }}
              >
                <div style={{ fontWeight: 600, fontSize: 14, color: TavariStyles.colors.gray900 }}>
                  Schedule check
                </div>
                {checkingAvailability ? (
                  <div style={{ fontSize: 13, color: TavariStyles.colors.gray600 }}>Checking room availability…</div>
                ) : null}
                <div style={{ fontSize: 13, color: TavariStyles.colors.gray700 }}>
                  Current end: <strong>{currentEndLabel || '—'}</strong>
                  {newEndLabel ? (
                    <>
                      {' '}→ New end: <strong>{newEndLabel}</strong>
                    </>
                  ) : null}
                </div>
                {availability.warning ? (
                  <div style={{ fontSize: 13, color: '#92400e' }}>{availability.warning}</div>
                ) : null}
                {!checkingAvailability && !availability.ok ? (
                  <div style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#991b1b',
                    fontSize: 13,
                    lineHeight: 1.45,
                  }}
                  >
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <FiAlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                      <div>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{availability.message}</div>
                        {availability.conflicts.map((conflict) => (
                          <div key={`${conflict.resourceId}-${conflict.bookingNumber}`}>
                            {conflict.resourceName}
                            {conflict.bookingNumber ? ` · Booking #${conflict.bookingNumber}` : ''}
                            {conflict.bookingTime ? ` at ${formatTime12Hour(conflict.bookingTime)}` : ''}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
                {!checkingAvailability && availability.ok && !availability.warning ? (
                  <div style={{ fontSize: 13, color: '#166534' }}>
                    Room is available for the extended time. Confirming will block this window so other parties cannot book it.
                  </div>
                ) : null}
              </div>

              <div style={{
                padding: '14px 16px',
                borderRadius: 8,
                border: `1px solid ${TavariStyles.colors.gray200}`,
                backgroundColor: 'white',
                display: 'grid',
                gap: 10,
              }}
              >
                <div style={{ fontWeight: 600, fontSize: 14, color: TavariStyles.colors.gray900 }}>
                  Pricing
                </div>
                <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, lineHeight: 1.45 }}>
                  {extensionPricing?.enabled === false
                    ? 'Extended time pricing is disabled for this activity.'
                    : formatExtensionPricingSummary(extensionPricing, Number.parseInt(addedMinutes, 10) || 0)}
                  {extensionPricing?.unit && extensionPricing?.enabled !== false ? (
                    <div style={{ marginTop: 4 }}>
                      Rate: {formatExtensionPricingUnitLabel(extensionPricing.unit).toLowerCase()}
                    </div>
                  ) : null}
                </div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  fontSize: 15,
                  fontWeight: 700,
                  color: TavariStyles.colors.gray900,
                }}
                >
                  <span>Calculated charge</span>
                  <span>{formatBookingMoney(extensionType === 'paid' ? calculatedCharge : 0)}</span>
                </div>
                {extensionType === 'paid' ? (
                  <>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                      <TavariCheckbox
                        checked={useCustomCharge}
                        onChange={setUseCustomCharge}
                        size="sm"
                      />
                      <span style={{ fontSize: 14, color: TavariStyles.colors.gray900, lineHeight: 1.5 }}>
                        Override charge amount
                      </span>
                    </label>
                    {useCustomCharge ? (
                      <div>
                        <label htmlFor="booking-extend-custom-charge" style={fieldLabelStyle}>Custom charge</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ color: TavariStyles.colors.gray600 }}>$</span>
                          <input
                            id="booking-extend-custom-charge"
                            type="number"
                            min="0"
                            step="0.01"
                            value={customCharge}
                            onChange={(event) => setCustomCharge(event.target.value)}
                            placeholder={calculatedCharge.toFixed(2)}
                            disabled={loading}
                            style={fieldInputStyle}
                          />
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>

              <div>
                <label htmlFor="booking-extend-reason" style={fieldLabelStyle}>Reason</label>
                <textarea
                  id="booking-extend-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Why is this party being extended? (required)"
                  disabled={loading}
                  style={{
                    ...fieldInputStyle,
                    minHeight: 96,
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    lineHeight: 1.45,
                  }}
                />
              </div>
            </>
          ) : (
            <div style={{
              padding: '16px',
              borderRadius: 8,
              border: `1px solid ${TavariStyles.colors.gray200}`,
              backgroundColor: '#f9fafb',
              display: 'grid',
              gap: 10,
              fontSize: 14,
              lineHeight: 1.5,
            }}
            >
              <div><strong>Minutes added:</strong> {addedMinutes}</div>
              <div><strong>New end time:</strong> {newEndLabel || '—'}</div>
              <div><strong>Extension type:</strong> {EXTENSION_TYPES.find((row) => row.id === extensionType)?.label}</div>
              <div><strong>Charge:</strong> {formatBookingMoney(resolvedCharge ?? 0)}</div>
              <div><strong>Reason:</strong> {trimmedReason}</div>
              <div style={{ fontSize: 13, color: TavariStyles.colors.gray600 }}>
                The extended window will be reserved on the schedule so overlapping parties cannot be booked in the same room.
              </div>
            </div>
          )}
        </div>

        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
        }}
        >
          {confirmStep ? (
            <button
              type="button"
              onClick={() => setConfirmStep(false)}
              disabled={loading}
              style={{ ...btnSecondary, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
            >
              Back
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
            <button
              type="button"
              onClick={() => { if (!loading) onClose?.(); }}
              disabled={loading}
              style={{ ...btnSecondary, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePrimaryAction}
              disabled={confirmStep ? loading : !canProceed}
              style={{
                padding: '10px 18px',
                borderRadius: 8,
                border: 'none',
                background: TavariStyles.colors.primary,
                color: '#fff',
                fontWeight: 600,
                fontSize: 14,
                cursor: (confirmStep ? loading : !canProceed) ? 'not-allowed' : 'pointer',
                opacity: (confirmStep ? loading : !canProceed) ? 0.6 : 1,
              }}
            >
              {loading
                ? 'Extending…'
                : confirmStep
                  ? 'Confirm extension'
                  : 'Review & confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
