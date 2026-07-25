import React from 'react';
import { TavariStyles } from '../../utils/TavariStyles';
import { formatSlotHoldCountdown } from '../../helpers/Bookings/bookingSlotHold';

export default function BookingSlotHoldBanner({ secondsRemaining, idleSecondsLeft }) {
  if (secondsRemaining == null) return null;

  return (
    <div
      style={{
        marginBottom: 16,
        padding: '12px 14px',
        borderRadius: 8,
        backgroundColor: '#fffbeb',
        border: '1px solid #fcd34d',
        color: '#92400e',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <strong>Complete this booking within {formatSlotHoldCountdown(secondsRemaining)}</strong>
      <div style={{ marginTop: 4, color: TavariStyles.colors.gray700 }}>
        This time is reserved for you. If you are inactive for{' '}
        {formatSlotHoldCountdown(idleSecondsLeft)} more, or when the timer reaches zero, the slot
        will be released for others to book.
      </div>
    </div>
  );
}
