import React from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';

const boxStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const CustomerPortalPartiesPage = () => {
  const { portalData } = useOutletContext();
  const { businessId } = useParams();
  const upcoming = portalData?.parties?.upcoming || [];
  const past = portalData?.parties?.past || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Parties</h2>
        <p style={{ margin: '8px 0 0', color: '#6b7280' }}>
          Party planning is ready to grow here. For now you can review party-related bookings already linked to your account.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link
          to={`/customer-portal/${businessId}/portal`}
          style={{ textDecoration: 'none', background: '#2563eb', color: 'white', padding: '12px 18px', borderRadius: 8, fontWeight: 600 }}
        >
          Book a Party
        </Link>
      </div>

      <div style={boxStyle}>
        <div style={{ fontWeight: 700 }}>Upcoming party bookings</div>
        {upcoming.length === 0 ? (
          <div style={{ color: '#6b7280' }}>No upcoming party bookings were found yet.</div>
        ) : upcoming.map((booking) => (
          <div key={booking.id} style={{ color: '#6b7280' }}>
            {booking.activityName} - {booking.bookingDate} at {booking.bookingTime}
          </div>
        ))}
      </div>

      <div style={boxStyle}>
        <div style={{ fontWeight: 700 }}>Past party bookings</div>
        {past.length === 0 ? (
          <div style={{ color: '#6b7280' }}>Past party bookings will show here after they happen.</div>
        ) : past.map((booking) => (
          <div key={booking.id} style={{ color: '#6b7280' }}>
            {booking.activityName} - {booking.bookingDate} at {booking.bookingTime}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CustomerPortalPartiesPage;
