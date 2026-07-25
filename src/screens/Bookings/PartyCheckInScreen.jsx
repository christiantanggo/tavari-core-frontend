import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import {
  CheckInEntryRow,
  PrintGuestListButton,
} from '../../components/Bookings/PartyGuestListComponents';
import {
  buildPartyGuestListPrintMeta,
  printPartyGuestList,
} from '../../helpers/Bookings/partyGuestListPrint';
import PartyGuestListPrintSheet from '../../components/Bookings/PartyGuestListPrintSheet';
import partyGuestListService from '../../services/Bookings/PartyGuestListService';
import bookingSettingsService from '../../services/Bookings/BookingSettingsService';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';

function PartyCheckInContent({ embedded = false } = {}) {
  const auth = usePOSAuth();
  const businessId = auth.selectedBusinessId;
  const [partyDate, setPartyDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lists, setLists] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyEntry, setBusyEntry] = useState(null);
  const [walkIn, setWalkIn] = useState({ guest_type: 'adult', first_name: '', last_name: '', household_phone: '' });
  const [resources, setResources] = useState([]);

  useEffect(() => {
    if (!businessId) return;
    bookingSettingsService.setBusinessId(businessId);
    bookingSettingsService.getBookingResources()
      .then((rows) => setResources(rows || []))
      .catch(() => setResources([]));
  }, [businessId]);

  const loadLists = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      partyGuestListService.setBusinessId(businessId);
      const rows = await partyGuestListService.listGuestLists({ fromDate: partyDate, toDate: partyDate });
      setLists(rows);
      if (rows.length === 1) {
        setSelectedId(rows[0].id);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [businessId, partyDate]);

  const loadEntries = useCallback(async () => {
    if (!selectedId) {
      setEntries([]);
      return;
    }
    try {
      partyGuestListService.setBusinessId(businessId);
      const data = await partyGuestListService.getGuestListById(selectedId);
      setEntries(data.entries || []);
    } catch (err) {
      toast.error(err.message || 'Failed to load entries');
    }
  }, [businessId, selectedId]);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const toggleCheckIn = async (entry, next) => {
    setBusyEntry(entry.id);
    try {
      partyGuestListService.setBusinessId(businessId);
      await partyGuestListService.checkInEntry(entry.id, next);
      await loadEntries();
    } catch (err) {
      toast.error(err.message || 'Check-in failed');
    } finally {
      setBusyEntry(null);
    }
  };

  const addWalkIn = async () => {
    if (!selectedId || !walkIn.first_name || !walkIn.last_name) {
      toast.error('First and last name required');
      return;
    }
    try {
      partyGuestListService.setBusinessId(businessId);
      await partyGuestListService.addWalkIn(selectedId, walkIn);
      setWalkIn({ guest_type: 'adult', first_name: '', last_name: '', household_phone: '' });
      await loadEntries();
      toast.success('Walk-in added');
    } catch (err) {
      toast.error(err.message || 'Could not add walk-in');
    }
  };

  const selectedList = lists.find((l) => l.id === selectedId);

  /** Staff need parent + birthday child to tell same-day parties apart, not a phone number. */
  const describeParty = (list) => {
    if (!list) return '';
    const listEntries = list.party_guest_entries || [];
    const meta = buildPartyGuestListPrintMeta({
      guestList: list,
      booking: list.bookings,
      entries: listEntries,
    });
    // Participant rows without a real name resolve to "Guest 1"; that is no better than a phone.
    const realName = (name) => {
      const trimmed = String(name || '').trim();
      return trimmed && !/^guest \d+$/i.test(trimmed) ? trimmed : '';
    };
    const entryName = (entry) => realName([entry?.first_name, entry?.last_name].filter(Boolean).join(' '));

    const activity = meta.activityName || 'Party';
    const parent = realName(meta.partyParentName)
      || entryName(listEntries.find((e) => e.guest_type === 'adult'))
      || list.booker_phone
      || 'Unknown parent';
    const child = realName(meta.birthdayChildName)
      || entryName(listEntries.find((e) => e.is_birthday_child));

    return child
      ? `${activity} · ${parent} · Birthday: ${child}`
      : `${activity} · ${parent}`;
  };

  return (
    <>
      {!embedded && (
        <>
          <Link to="/dashboard/bookings/parties" style={{ color: TavariStyles.colors.primary }}>← Parties</Link>
          <h1 style={{ margin: '16px 0 8px' }}>Party check-in</h1>
        </>
      )}
      <p style={{ color: '#6b7280', marginBottom: 20, marginTop: embedded ? 0 : undefined }}>
        One tap checks in the guest (waiver + arrival).
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <label style={{ fontWeight: 600 }}>
          Party date
          <input type="date" value={partyDate} onChange={(e) => { setPartyDate(e.target.value); setSelectedId(null); }} style={{ marginLeft: 8, padding: 8, borderRadius: 8, border: '1px solid #d1d5db' }} />
        </label>
        {lists.length > 1 && (
          <select value={selectedId || ''} onChange={(e) => setSelectedId(e.target.value)} style={{ padding: 10, borderRadius: 8, border: '1px solid #d1d5db', minWidth: 320 }}>
            <option value="">Select party…</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {describeParty(l)}
              </option>
            ))}
          </select>
        )}
        {selectedId && (
          <PrintGuestListButton
            onPrint={() => {
              try {
                printPartyGuestList({
                  guestList: selectedList,
                  entries,
                  businessName: auth.selectedBusiness?.name || '',
                  resources,
                });
              } catch (err) {
                toast.error(err.message || 'Could not open print window');
              }
            }}
          />
        )}
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : lists.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No parties with guest lists on this date.</p>
      ) : !selectedId ? (
        <p style={{ color: '#6b7280' }}>Select a party to begin check-in.</p>
      ) : (
        <>
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 16 }}>
            {describeParty(selectedList)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
            {entries.map((entry) => (
              <CheckInEntryRow
                key={entry.id}
                entry={entry}
                busy={busyEntry === entry.id}
                onToggle={(next) => toggleCheckIn(entry, next)}
              />
            ))}
          </div>

          <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 24 }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>Add walk-in</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              <select value={walkIn.guest_type} onChange={(e) => setWalkIn({ ...walkIn, guest_type: e.target.value })} style={{ padding: 10, borderRadius: 8, border: '1px solid #d1d5db' }}>
                <option value="child">Child</option>
                <option value="adult">Adult</option>
              </select>
              <input placeholder="First name" value={walkIn.first_name} onChange={(e) => setWalkIn({ ...walkIn, first_name: e.target.value })} style={{ padding: 10, borderRadius: 8, border: '1px solid #d1d5db' }} />
              <input placeholder="Last name" value={walkIn.last_name} onChange={(e) => setWalkIn({ ...walkIn, last_name: e.target.value })} style={{ padding: 10, borderRadius: 8, border: '1px solid #d1d5db' }} />
              <input placeholder="Phone" value={walkIn.household_phone} onChange={(e) => setWalkIn({ ...walkIn, household_phone: e.target.value })} style={{ padding: 10, borderRadius: 8, border: '1px solid #d1d5db' }} />
            </div>
            <button type="button" onClick={addWalkIn} style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, border: 'none', background: TavariStyles.colors.primary, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
              Add walk-in
            </button>
          </div>

          <PartyGuestListPrintSheet guestList={selectedList} entries={entries} resources={resources} />
        </>
      )}
    </>
  );
}

export default function PartyCheckInScreen({ embedded = false } = {}) {
  if (embedded) {
    return <PartyCheckInContent embedded />;
  }

  return (
    <POSAuthWrapper componentName="PartyCheckInScreen">
      <div style={{ padding: 24 }}>
        <PartyCheckInContent />
      </div>
    </POSAuthWrapper>
  );
}
