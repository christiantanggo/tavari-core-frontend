import React from 'react';
import CakeReceiptPanel from './CakeReceiptPanel';

export default function BookingCakeReceiptsTab({ booking, businessId, businessTimezone }) {
  if (!booking?.id || !businessId) {
    return <div style={{ padding: 16, color: '#6b7280' }}>No booking selected.</div>;
  }

  const cancelled = booking.status === 'cancelled';

  return (
    <div style={{ padding: '8px 0' }}>
      <CakeReceiptPanel
        mode="staff"
        businessId={businessId}
        bookingId={booking.id}
        businessTimezone={businessTimezone}
        disabled={cancelled}
      />
    </div>
  );
}
