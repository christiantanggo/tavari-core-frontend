import React from 'react';
import { Navigate, useParams } from 'react-router-dom';

const CustomerPortalDashboard = () => {
  const { businessId } = useParams();
  return <Navigate to={`/customer-portal/${businessId}/account/bookings`} replace />;
};

export default CustomerPortalDashboard;
