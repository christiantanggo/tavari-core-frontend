import React, { useState } from 'react';
import { FiRefreshCw } from 'react-icons/fi';
import toast from 'react-hot-toast';
import bookingService from '../../services/Bookings/BookingService';
import { usePermissions } from '../../hooks/usePermissions';
import { TavariStyles } from '../../utils/TavariStyles';
import { supabase } from '../../supabaseClient';

export default function BookingRestoreButton({
  booking,
  businessId,
  onRestored,
  compact = false,
  stopPropagation = true,
}) {
  const { hasPermission, hasElevatedPrivileges } = usePermissions();
  const canEdit = hasPermission('bookings.edit') || hasElevatedPrivileges();
  const [restoring, setRestoring] = useState(false);

  if (!canEdit || booking?.status !== 'cancelled' || !booking?.id || !businessId) {
    return null;
  }

  const handleRestore = async (event) => {
    if (stopPropagation) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (restoring) return;
    if (!window.confirm('Restore this cancelled booking? The customer can pay their deposit and keep the reservation.')) {
      return;
    }

    setRestoring(true);
    try {
      bookingService.setBusinessId(businessId);
      const { data: { user } } = await supabase.auth.getUser();
      await bookingService.restoreBooking(booking.id, { updatedBy: user?.id || null });
      toast.success('Booking restored');
      onRestored?.();
    } catch (err) {
      toast.error(err?.message || 'Could not restore booking');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleRestore}
      disabled={restoring}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: compact ? '6px 10px' : '8px 12px',
        borderRadius: 8,
        border: `1px solid ${TavariStyles.colors.primary}`,
        background: '#ecfdf5',
        color: TavariStyles.colors.primary,
        fontSize: compact ? 12 : 13,
        fontWeight: 700,
        cursor: restoring ? 'wait' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      <FiRefreshCw size={compact ? 14 : 16} />
      {restoring ? 'Restoring…' : 'Restore'}
    </button>
  );
}
