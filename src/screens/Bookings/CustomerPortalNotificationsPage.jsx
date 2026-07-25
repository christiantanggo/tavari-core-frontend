import React from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';

const itemStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 16,
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const CustomerPortalNotificationsPage = () => {
  const { portalData } = useOutletContext();
  const { businessId } = useParams();
  const notifications = portalData?.notifications || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Notifications</h2>
        <p style={{ margin: '8px 0 0', color: '#6b7280' }}>
          Review the items that still need your attention, including waivers and future party paperwork.
        </p>
      </div>

      {notifications.length === 0 ? (
        <div style={itemStyle}>You do not have any notifications right now.</div>
      ) : notifications.map((notification) => (
        <div key={notification.id} style={itemStyle}>
          <div>
            <div style={{ fontWeight: 700 }}>{notification.title}</div>
            <div style={{ color: '#6b7280', marginTop: 6 }}>{notification.description}</div>
          </div>
          <Link
            to={`/customer-portal/${businessId}/account/${notification.href}`}
            style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}
          >
            Open
          </Link>
        </div>
      ))}
    </div>
  );
};

export default CustomerPortalNotificationsPage;
