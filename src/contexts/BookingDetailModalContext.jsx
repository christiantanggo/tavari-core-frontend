import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BookingDetailModal from '../components/Bookings/BookingDetailModal';

const BookingDetailModalContext = createContext(null);

let hasWarnedMissingBookingDetailModalProvider = false;

export function BookingDetailModalProvider({ children }) {
  const [bookingId, setBookingId] = useState(null);
  const [initialTab, setInitialTab] = useState(null);
  const onUpdatedRef = useRef(null);

  const openBookingDetail = useCallback((id, options = {}) => {
    if (!id) return;
    onUpdatedRef.current = typeof options.onUpdated === 'function' ? options.onUpdated : null;
    setInitialTab(options.initialTab || null);
    setBookingId(id);
  }, []);

  const closeBookingDetail = useCallback(() => {
    setBookingId(null);
    setInitialTab(null);
    onUpdatedRef.current = null;
  }, []);

  const handleBookingUpdated = useCallback(() => {
    onUpdatedRef.current?.();
  }, []);

  const value = useMemo(
    () => ({
      openBookingDetail,
      closeBookingDetail,
      bookingDetailModalOpen: Boolean(bookingId),
      bookingDetailModalId: bookingId,
    }),
    [openBookingDetail, closeBookingDetail, bookingId],
  );

  return (
    <BookingDetailModalContext.Provider value={value}>
      {children}
      <BookingDetailModal
        bookingId={bookingId}
        initialTab={initialTab}
        open={Boolean(bookingId)}
        onClose={closeBookingDetail}
        onBookingUpdated={handleBookingUpdated}
      />
    </BookingDetailModalContext.Provider>
  );
}

/**
 * Open the standard booking detail modal.
 * Provider is mounted on DashboardLayout so all dashboard routes can open bookings in-place.
 */
export function useBookingDetailModal() {
  const context = useContext(BookingDetailModalContext);
  const navigate = useNavigate();

  if (context) {
    return context;
  }

  if (import.meta.env.DEV && !hasWarnedMissingBookingDetailModalProvider) {
    hasWarnedMissingBookingDetailModalProvider = true;
    console.warn(
      '[useBookingDetailModal] BookingDetailModalProvider is missing; falling back to full-page route.',
    );
  }

  return {
    openBookingDetail: (id) => {
      if (id) navigate(`/dashboard/bookings/${id}`);
    },
    closeBookingDetail: () => {},
    bookingDetailModalOpen: false,
    bookingDetailModalId: null,
  };
}
