import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import POSAuthWrapper from '../Auth/POSAuthWrapper';
import BookingDetailPanel from '../../screens/Bookings/BookingDetailPanel';

function readViewport() {
  if (typeof window === 'undefined') {
    return { width: 1280, height: 800 };
  }
  return {
    width: window.innerWidth || document.documentElement.clientWidth || 1280,
    height: window.innerHeight || document.documentElement.clientHeight || 800,
  };
}

/**
 * Keep the booking detail dialog inside the visible viewport on short /
 * scaled workstations without forcing users to zoom out.
 */
function buildShellStyle(viewport) {
  const pad = viewport.width <= 768 ? 8 : viewport.height <= 720 ? 10 : 16;
  const maxWidthPx = Math.max(280, viewport.width - pad * 2);
  const maxHeightPx = Math.max(320, viewport.height - pad * 2);
  const preferredWidth = Math.min(1120, maxWidthPx);
  const preferredHeight = Math.min(900, maxHeightPx);

  return {
    width: preferredWidth,
    maxWidth: maxWidthPx,
    height: preferredHeight,
    maxHeight: maxHeightPx,
    display: 'flex',
    flexDirection: 'column',
    background: '#fff',
    borderRadius: viewport.width <= 768 ? 10 : 12,
    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.18)',
    overflow: 'hidden',
    minHeight: 0,
    minWidth: 0,
    boxSizing: 'border-box',
  };
}

function buildOverlayStyle(viewport) {
  const pad = viewport.width <= 768 ? 8 : viewport.height <= 720 ? 10 : 16;
  const short = viewport.height <= 720;

  return {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.45)',
    display: 'flex',
    alignItems: short ? 'flex-start' : 'center',
    justifyContent: 'center',
    padding: pad,
    // Safety net: if anything still overflows, scroll the overlay instead of clipping.
    overflowY: 'auto',
    overflowX: 'hidden',
    zIndex: 2000,
    boxSizing: 'border-box',
  };
}

const BookingDetailModal = ({ bookingId, initialTab, open, onClose, onBookingUpdated }) => {
  const [viewport, setViewport] = useState(readViewport);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleResize = () => setViewport(readViewport());
    handleResize();
    window.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('scroll', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('scroll', handleResize);
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  const overlayStyle = useMemo(() => buildOverlayStyle(viewport), [viewport]);
  const shellStyle = useMemo(() => buildShellStyle(viewport), [viewport]);

  if (!open || !bookingId) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Booking details"
      style={overlayStyle}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div style={shellStyle} onClick={(event) => event.stopPropagation()}>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            height: '100%',
          }}
        >
          <POSAuthWrapper
            requiredRoles={['employee', 'manager', 'owner']}
            requireBusiness
            componentName="BookingDetailModal"
          >
            <BookingDetailPanel
              bookingId={bookingId}
              initialTab={initialTab}
              variant="modal"
              onClose={onClose}
              onBookingUpdated={onBookingUpdated}
            />
          </POSAuthWrapper>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default BookingDetailModal;
