import React from 'react';
import { useParams } from 'react-router-dom';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import BookingDetailPanel from './BookingDetailPanel';

const BookingDetailScreen = () => {
  const { id } = useParams();

  useSecurityContext({
    componentName: 'BookingDetailScreen',
    sensitiveComponent: false,
    enableAuditLogging: true,
    securityLevel: 'low',
  });

  return (
    <SecurityWrapper>
      <POSAuthWrapper
        requiredRoles={['employee', 'manager', 'owner']}
        requireBusiness
        componentName="BookingDetailScreen"
      >
        <BookingDetailPanel bookingId={id} variant="page" />
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default BookingDetailScreen;
