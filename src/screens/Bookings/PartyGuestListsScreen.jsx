import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import partyGuestListService from '../../services/Bookings/PartyGuestListService';
import { buildPartyGuestListPrintMeta } from '../../helpers/Bookings/partyGuestListPrint';
import { getPartyGuestListPortalPath } from '../../utils/partyGuestList';
import { formatBusinessDate } from '../../utils/businessDateFormat';

function PartyGuestListsContent() {
  const auth = usePOSAuth();
  const businessId = auth.selectedBusinessId;
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      partyGuestListService.setBusinessId(businessId);
      const rows = await partyGuestListService.listGuestLists({ fromDate });
      setLists(rows);
    } catch (err) {
      toast.error(err.message || 'Failed to load guest lists');
    } finally {
      setLoading(false);
    }
  }, [businessId, fromDate]);

  useEffect(() => {
    load();
  }, [load]);

  const copyHostLink = () => {
    const url = `${window.location.origin}${getPartyGuestListPortalPath(businessId)}`;
    navigator.clipboard.writeText(url);
    toast.success('Host link copied');
  };

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <label style={{ fontSize: 14, fontWeight: 600 }}>
          From date{' '}
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ marginLeft: 8, padding: 8, borderRadius: 8, border: '1px solid #d1d5db' }} />
        </label>
        <button type="button" onClick={copyHostLink} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>
          Copy host portal link
        </button>
        <Link to={`/dashboard/bookings/party-guest-list-settings`} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db', textDecoration: 'none', color: '#111', fontWeight: 600 }}>
          Settings
        </Link>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : lists.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No guest lists found from this date forward.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {lists.map((row) => {
            const entries = row.party_guest_entries || [];
            const attending = entries.filter((e) => e.is_attending !== false);
            const waiverIssues = entries.filter((e) => e.waiver_status !== 'verified').length;
            const activity = row.bookings?.booking_activities?.activity_name || 'Party';
            const rawDate = row.party_date || row.bookings?.booking_date || '';
            const dateLabel = rawDate
              ? formatBusinessDate(
                  rawDate,
                  undefined,
                  { year: 'numeric', month: 'long', day: 'numeric' },
                  'en-US',
                )
              : '—';
            const meta = buildPartyGuestListPrintMeta({
              guestList: row,
              booking: row.bookings,
              entries,
            });
            const parentName = meta.partyParentName || '—';
            const birthdayChildName = meta.birthdayChildName || '—';
            return (
              <Link
                key={row.id}
                to={`/dashboard/bookings/party-guest-lists/${row.id}`}
                style={{
                  display: 'block',
                  padding: 16,
                  borderRadius: 10,
                  border: '1px solid #e5e7eb',
                  background: '#fff',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{activity} · {dateLabel}</div>
                    <div style={{ fontSize: 14, color: '#111827', marginTop: 4 }}>
                      Parent: {parentName} · Birthday child: {birthdayChildName}
                    </div>
                    <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
                      Phone: {row.booker_phone} · {attending.length} guests · Status: {row.status}
                      {row.bookings?.booking_number ? ` · #${row.bookings.booking_number}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {entries.length === 0 && (
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#dc2626', background: '#fef2f2', padding: '4px 10px', borderRadius: 999 }}>Incomplete</span>
                    )}
                    {waiverIssues > 0 && (
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#d97706', background: '#fffbeb', padding: '4px 10px', borderRadius: 999 }}>{waiverIssues} waiver review</span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function PartyGuestListsScreen({ embedded = false } = {}) {
  if (embedded) {
    return <PartyGuestListsContent />;
  }

  return (
    <POSAuthWrapper componentName="PartyGuestListsScreen">
      <div style={{ padding: 24 }}>
        <TavariModuleHeader title="Party guest lists" description="Manage birthday party guest lists and waiver status" />
        <PartyGuestListsContent />
      </div>
    </POSAuthWrapper>
  );
}
