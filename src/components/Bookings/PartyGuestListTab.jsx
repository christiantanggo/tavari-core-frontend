import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import {
  PrintGuestListButton,
} from '../../components/Bookings/PartyGuestListComponents';
import PartyGuestListPrintSheet from '../../components/Bookings/PartyGuestListPrintSheet';
import { useBookingDetailModal } from '../../contexts/BookingDetailModalContext';
import { printPartyGuestList } from '../../helpers/Bookings/partyGuestListPrint';
import partyGuestListService from '../../services/Bookings/PartyGuestListService';
import { getPartyGuestListPortalPath } from '../../utils/partyGuestList';
import { TavariStyles } from '../../utils/TavariStyles';

export default function PartyGuestListTab({ booking, businessId, resources = [] }) {
  const navigate = useNavigate();
  const { closeBookingDetail, bookingDetailModalOpen } = useBookingDetailModal();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const participantSyncKey = useMemo(
    () => (booking?.booking_participants || [])
      .map((participant) => `${participant.id}:${participant.party_role || ''}`)
      .join('|'),
    [booking?.booking_participants],
  );

  const load = useCallback(async () => {
    if (!businessId || !booking?.id) return;
    setLoading(true);
    try {
      partyGuestListService.setBusinessId(businessId);
      const result = await partyGuestListService.loadGuestListForBooking(booking);
      setData(result);
    } catch (err) {
      toast.error(err.message || 'Failed to load guest list');
    } finally {
      setLoading(false);
    }
  }, [businessId, booking, participantSyncKey]);

  useEffect(() => {
    load();
  }, [load]);

  const copyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}${getPartyGuestListPortalPath(businessId)}`);
    toast.success('Host link copied');
  };

  const handlePrint = () => {
    try {
      printPartyGuestList({
        booking,
        guestList,
        entries,
        resources,
      });
    } catch (err) {
      toast.error(err.message || 'Could not open print window');
    }
  };

  const handleEditGuestList = () => {
    const guestListId = data?.guestList?.id;
    if (!guestListId) {
      toast.error('Guest list is not ready yet');
      return;
    }
    const path = `/dashboard/bookings/party-guest-lists/${guestListId}`;
    // Booking detail often sits in a portal modal above the router outlet.
    // Navigate alone updates the page underneath and looks like a no-op.
    if (bookingDetailModalOpen) {
      closeBookingDetail();
    }
    navigate(path);
  };

  if (loading) return <div style={{ padding: 16, color: '#6b7280' }}>Loading guest list…</div>;
  if (!data) return <div style={{ padding: 16 }}>No guest list yet.</div>;

  const { guestList, entries } = data;
  const incomplete = !entries?.length;
  const waiverFlags = (entries || []).filter((e) => e.waiver_status !== 'verified').length;

  return (
    <div style={{ padding: '8px 0' }}>
      <p style={{ fontSize: 13, color: TavariStyles.colors.gray600, margin: '0 0 16px', lineHeight: 1.5 }}>
        Party host, birthday child, and selected waiver participants are added automatically. The host can add more guests from the portal link.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        {incomplete && (
          <span style={{ fontSize: 13, fontWeight: 600, color: '#dc2626', background: '#fef2f2', padding: '4px 10px', borderRadius: 999 }}>Guest list incomplete</span>
        )}
        {waiverFlags > 0 && (
          <span style={{ fontSize: 13, fontWeight: 600, color: '#d97706', background: '#fffbeb', padding: '4px 10px', borderRadius: 999 }}>{waiverFlags} waiver review</span>
        )}
        <span style={{ fontSize: 13, color: '#6b7280' }}>Status: {guestList.status}</span>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleEditGuestList}
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            border: 'none',
            background: TavariStyles.colors.primary,
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Edit guest list
        </button>
        <button type="button" onClick={copyLink} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>
          Copy host link
        </button>
        <PrintGuestListButton onPrint={handlePrint} />
      </div>

      <PartyGuestListPrintSheet
        booking={booking}
        guestList={guestList}
        entries={entries}
        resources={resources}
      />
    </div>
  );
}
