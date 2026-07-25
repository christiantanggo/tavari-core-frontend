import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useBookingDetailModal } from '../../contexts/BookingDetailModalContext';
import toast from 'react-hot-toast';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import {
  PartyGuestListEntryEditor,
  PartyGuestListOverageOptions,
  PrintGuestListButton,
} from '../../components/Bookings/PartyGuestListComponents';
import PartyGuestListPrintSheet from '../../components/Bookings/PartyGuestListPrintSheet';
import { printPartyGuestList } from '../../helpers/Bookings/partyGuestListPrint';
import partyGuestListService from '../../services/Bookings/PartyGuestListService';
import bookingSettingsService from '../../services/Bookings/BookingSettingsService';
import { getPartyGuestListPortalPath, extractListLimitSettingsFromGuestList, resolvePartyGuestOveragePricing, resolvePartyGuestOverageFood, resolvePartyGuestOveragePayment, resolvePartyGuestOverageSocks } from '../../utils/partyGuestList';
import { TavariStyles } from '../../utils/TavariStyles';
import { usePOSAuth } from '../../hooks/usePOSAuth';

export default function PartyGuestListDetailScreen() {
  const { guestListId } = useParams();
  const { openBookingDetail } = useBookingDetailModal();
  const auth = usePOSAuth();
  const businessId = auth.selectedBusinessId;
  const [guestList, setGuestList] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [overagePayment, setOveragePayment] = useState(() => resolvePartyGuestOveragePayment());
  const [overageFood, setOverageFood] = useState(() => resolvePartyGuestOverageFood());
  const [overageFoodOther, setOverageFoodOther] = useState('');
  const [overageSocks, setOverageSocks] = useState(() => resolvePartyGuestOverageSocks());
  const [overagePricing, setOveragePricing] = useState(null);
  const [resources, setResources] = useState([]);

  const load = useCallback(async () => {
    if (!businessId || !guestListId) return;
    setLoading(true);
    try {
      partyGuestListService.setBusinessId(businessId);
      bookingSettingsService.setBusinessId(businessId);
      const [resourceRows, guestListData, partySettings, inventoryRows] = await Promise.all([
        bookingSettingsService.getBookingResources(),
        partyGuestListService.getGuestListById(guestListId),
        partyGuestListService.loadSettings(),
        partyGuestListService.loadOverageInventoryItems(),
      ]);
      setResources(resourceRows || []);
      setOveragePricing(resolvePartyGuestOveragePricing(inventoryRows || [], partySettings || {}));
      let data = guestListData;
      if (data.guestList?.booking_id) {
        data = await partyGuestListService.syncGuestListFromBookingParticipants({
          id: data.guestList.booking_id,
          customer_phone: data.guestList.booker_phone,
          customer_id: data.guestList.booker_customer_id,
          booking_date: data.guestList.party_date,
        });
      }
      setGuestList(data.guestList);
      setEntries(data.entries);
      setOveragePayment(resolvePartyGuestOveragePayment(data.guestList?.overage_payment));
      setOverageFood(resolvePartyGuestOverageFood(data.guestList?.overage_food));
      setOverageFoodOther(data.guestList?.overage_food_other || '');
      setOverageSocks(resolvePartyGuestOverageSocks(data.guestList?.overage_socks));
    } catch (err) {
      toast.error(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [businessId, guestListId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      partyGuestListService.setBusinessId(businessId);
      await partyGuestListService.staffSaveEntries(guestListId, entries, {
        overagePayment,
        overageFood,
        overageFoodOther,
        overageSocks,
      });
      toast.success('Saved');
      load();
    } catch (err) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const copyHostLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}${getPartyGuestListPortalPath(businessId)}`);
    toast.success('Host link copied');
  };

  const handlePrint = () => {
    try {
      printPartyGuestList({
        guestList,
        entries,
        businessName: auth.selectedBusiness?.name || '',
        resources,
      });
    } catch (err) {
      toast.error(err.message || 'Could not open print window');
    }
  };

  const listLimitSettings = useMemo(
    () => extractListLimitSettingsFromGuestList(guestList),
    [guestList],
  );

  if (loading) {
    return (
      <POSAuthWrapper componentName="PartyGuestListDetailScreen">
        <div style={{ padding: 24 }}>Loading…</div>
      </POSAuthWrapper>
    );
  }

  const title = guestList?.bookings?.booking_activities?.activity_name
    ? `${guestList.bookings.booking_activities.activity_name} — ${guestList.party_date || guestList.bookings?.booking_date || ''}`
    : `Guest list — ${guestList?.booker_phone || ''}`;

  return (
    <POSAuthWrapper componentName="PartyGuestListDetailScreen">
      <div style={{ padding: 24 }} className="party-guest-staff-detail">
        <div style={{ marginBottom: 16 }}>
          <Link to="/dashboard/bookings/parties" style={{ color: TavariStyles.colors.primary }}>← Parties</Link>
        </div>
        <h1 style={{ margin: '0 0 8px' }}>{title}</h1>
        <p style={{ color: '#6b7280', marginBottom: 20 }}>
          Booker phone: {guestList?.booker_phone} · Status: {guestList?.status}
          {guestList?.booking_id && (
            <>
              {' '}
              ·{' '}
              <button
                type="button"
                onClick={() => openBookingDetail(guestList.booking_id, { onUpdated: load })}
                style={{
                  border: 'none',
                  background: 'none',
                  padding: 0,
                  color: TavariStyles.colors.primary,
                  cursor: 'pointer',
                  font: 'inherit',
                  textDecoration: 'underline',
                }}
              >
                Open booking
              </button>
            </>
          )}
        </p>

        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <button type="button" onClick={handleSave} disabled={saving} style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: TavariStyles.colors.primary, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <PrintGuestListButton onPrint={handlePrint} />
          <button type="button" onClick={copyHostLink} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            Copy host link
          </button>
        </div>

        <PartyGuestListOverageOptions
          overagePayment={overagePayment}
          overageFood={overageFood}
          overageFoodOther={overageFoodOther}
          overageSocks={overageSocks}
          onOveragePaymentChange={setOveragePayment}
          onOverageFoodChange={setOverageFood}
          onOverageFoodOtherChange={setOverageFoodOther}
          onOverageSocksChange={setOverageSocks}
        />

        <PartyGuestListEntryEditor
          entries={entries}
          onChange={setEntries}
          locked={false}
          limitSettings={listLimitSettings}
          overagePricing={overagePricing}
          overagePayment={overagePayment}
        />

        <div style={{ marginTop: 24 }}>
          <PartyGuestListPrintSheet guestList={guestList} entries={entries} resources={resources} />
        </div>
      </div>
    </POSAuthWrapper>
  );
}
