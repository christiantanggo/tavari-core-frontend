import React, { useState } from 'react';
import ManagerOverrideModal from '../POS/POSPaymentScreenComponents/ManagerOverrideModal';

export default function BookingBusinessHoursOverrideModal({
  open,
  reason,
  onCancel,
  onApproved,
}) {
  const [managerPin, setManagerPin] = useState('');
  const [overrideError, setOverrideError] = useState('');

  if (!open) return null;

  const handleCancel = () => {
    setManagerPin('');
    setOverrideError('');
    onCancel?.();
  };

  const handleApprove = async () => {
    setOverrideError('');
    try {
      await onApproved?.(managerPin);
    } catch (err) {
      setOverrideError(err?.message || 'Could not approve override');
    }
  };

  return (
    <ManagerOverrideModal
      showManagerOverride={open}
      setShowManagerOverride={(value) => {
        if (!value) handleCancel();
      }}
      overrideReason={reason || 'This booking is outside configured business hours. A manager PIN is required.'}
      managerPin={managerPin}
      setManagerPin={setManagerPin}
      overrideError={overrideError}
      onApprove={handleApprove}
      onCancel={handleCancel}
    />
  );
}
