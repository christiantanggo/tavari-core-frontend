import React, { useState } from 'react';
import bookingService from '../../services/Bookings/BookingService';
import BookingParticipantCheckInModal from './BookingParticipantCheckInModal';
import { TavariStyles } from '../../utils/TavariStyles';
import { FiCheck } from 'react-icons/fi';

const BookingCheckInButton = ({
  booking,
  onCheckInComplete,
  canCheckIn = true,
  fullWidth = false,
  showBookingDetailsButton = true,
  /** When true, partial check-ins refresh the parent quietly; full sync runs when the modal closes. */
  syncOnPartialCheckIn = false,
}) => {
  const [modalOpen, setModalOpen] = useState(false);

  const participants = booking?.booking_participants || [];
  const n = participants.length;
  const checked = participants.filter((p) => p.checked_in_at).length;
  const allParticipantsIn = n > 0 && checked === n;

  const buttonLabel = (() => {
    if (n === 0) {
      return booking.status === 'checked_in' ? 'Checked-in' : 'Check-In';
    }
    if (allParticipantsIn || booking.status === 'checked_in') {
      return 'Checked-in';
    }
    return `Check-In (${checked}/${n})`;
  })();

  const handleOpen = (e) => {
    e.stopPropagation();
    if (!canCheckIn) return;
    bookingService.setBusinessId(booking?.business_id || null);
    setModalOpen(true);
  };

  const handlePartialUpdate = () => {
    onCheckInComplete?.({ silent: true });
  };

  const handleFinalUpdate = () => {
    onCheckInComplete?.({ silent: false });
  };

  const handleUpdated = () => {
    if (syncOnPartialCheckIn) {
      handlePartialUpdate();
      return;
    }
    onCheckInComplete?.({ silent: false });
  };

  const handleClosed = () => {
    if (syncOnPartialCheckIn) {
      handleFinalUpdate();
    }
  };

  if (!canCheckIn) return null;

  if (!['pending', 'confirmed', 'checked_in'].includes(booking.status)) {
    return null;
  }

  const openSummary =
    n > 0 ? `${checked} of ${n} arrived` : booking.status === 'checked_in' ? 'Fully checked in' : '';

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        title={openSummary || 'Open check-in'}
        style={{
          padding: '8px 16px',
          width: fullWidth ? '100%' : undefined,
          justifyContent: fullWidth ? 'center' : undefined,
          boxSizing: 'border-box',
          backgroundColor:
            booking.status === 'checked_in' || allParticipantsIn ? '#10b981' : 'white',
          color:
            booking.status === 'checked_in' || allParticipantsIn ? 'white' : TavariStyles.colors.primary,
          border: `1px solid ${
            booking.status === 'checked_in' || allParticipantsIn ? '#10b981' : TavariStyles.colors.primary
          }`,
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: '600',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          whiteSpace: 'nowrap',
        }}
      >
        <FiCheck size={14} />
        {buttonLabel}
      </button>
      {modalOpen && (
        <BookingParticipantCheckInModal
          booking={booking}
          canCheckIn={canCheckIn}
          showBookingDetailsButton={showBookingDetailsButton}
          onClose={() => {
            setModalOpen(false);
            handleClosed();
          }}
          onUpdated={handleUpdated}
        />
      )}
    </>
  );
};

export default BookingCheckInButton;
