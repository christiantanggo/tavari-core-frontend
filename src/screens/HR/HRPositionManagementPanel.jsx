import React from 'react';
import PositionsTab from '../../components/HR/PositionsTab';

const HRPositionManagementPanel = ({ businessId }) => {
  if (!businessId) {
    return <div style={{ padding: 24, color: '#6b7280' }}>Select a business to manage positions.</div>;
  }

  return (
    <div style={{ width: '100%' }}>
      <PositionsTab businessId={businessId} />
    </div>
  );
};

export default HRPositionManagementPanel;
