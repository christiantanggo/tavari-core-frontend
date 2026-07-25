import React from 'react';
import { useOutletContext, Link, useParams } from 'react-router-dom';

const sectionTitleStyle = { margin: 0, fontSize: 24, fontWeight: 700 };
const cardStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const CustomerPortalBookingsPage = () => {
  const { portalData } = useOutletContext();
  const { businessId } = useParams();
  const upcoming = portalData?.bookings?.upcoming || [];
  const past = portalData?.bookings?.past || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h2 style={sectionTitleStyle}>Bookings</h2>
          <p style={{ margin: '8px 0 0', color: '#6b7280' }}>
            Create a new booking or review every booking attached to your customer account.
          </p>
        </div>
        <Link
          to={`/customer-portal/${businessId}/portal`}
          style={{ textDecoration: 'none', background: '#2563eb', color: 'white', padding: '12px 18px', borderRadius: 8, fontWeight: 600 }}
        >
          New Booking
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 14, color: '#6b7280' }}>Upcoming bookings</div>
          <div style={{ fontSize: 33, fontWeight: 700 }}>{upcoming.length}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 14, color: '#6b7280' }}>Past bookings</div>
          <div style={{ fontSize: 33, fontWeight: 700 }}>{past.length}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>Upcoming bookings</h3>
        {upcoming.length === 0 ? (
          <div style={cardStyle}>You do not have any upcoming bookings yet.</div>
        ) : upcoming.map((booking) => (
          <div key={booking.id} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{booking.activityName}</div>
                <div style={{ color: '#6b7280', marginTop: 4 }}>
                  {booking.bookingDate} at {booking.bookingTime}
                </div>
                <div style={{ color: '#6b7280', marginTop: 4 }}>Booking #{booking.bookingNumber || booking.id.slice(0, 8)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600 }}>{booking.status}</div>
                <div style={{ color: '#6b7280', marginTop: 4 }}>{booking.paymentStatus || 'unpaid'}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {booking.manageToken ? (
                <Link
                  to={`/customer-portal/${businessId}/portal/manage-booking/${encodeURIComponent(booking.manageToken)}`}
                  style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}
                >
                  Manage booking
                </Link>
              ) : booking.manageUrl ? (
                <a href={booking.manageUrl} style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>
                  Manage booking
                </a>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>Past bookings</h3>
        {past.length === 0 ? (
          <div style={cardStyle}>Past bookings will appear here after you complete them.</div>
        ) : past.map((booking) => (
          <div key={booking.id} style={cardStyle}>
            <div style={{ fontWeight: 700 }}>{booking.activityName}</div>
            <div style={{ color: '#6b7280' }}>
              {booking.bookingDate} at {booking.bookingTime}
            </div>
            <div style={{ color: '#6b7280' }}>Status: {booking.status}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CustomerPortalBookingsPage;
