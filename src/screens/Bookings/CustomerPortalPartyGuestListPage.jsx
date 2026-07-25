import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import partyGuestListService from '../../services/Bookings/PartyGuestListService';
import { TavariStyles } from '../../utils/TavariStyles';
import { formatDateShort } from '../../utils/businessDateFormat';
import { formatBookingTimeRangeLabel } from '../../utils/bookingTimeRange';
import { normalizePhoneDigits } from '../../utils/waiverExistingViewerAccess';
import { formatPhoneInput } from '../../utils/phoneFormat';
import {
  PartyGuestListEntryEditor,
  PartyGuestListOverageOptions,
  PartyGuestListWarnings,
  PrintGuestListButton,
} from '../../components/Bookings/PartyGuestListComponents';
import { printPartyGuestList } from '../../helpers/Bookings/partyGuestListPrint';
import {
  computeGuestListWarnings,
  extractListLimitSettingsFromApiData,
  resolvePartyGuestOverageFood,
  resolvePartyGuestOveragePayment,
  resolvePartyGuestOverageSocks,
} from '../../utils/partyGuestList';

const SESSION_KEY = (businessId) => `party_guest_list_session_${businessId}`;

const btnPrimary = {
  padding: '12px 18px',
  borderRadius: 8,
  border: 'none',
  background: TavariStyles.colors.primary || '#2563eb',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
};

function formatPartyPickerDate(bookingDate) {
  if (!bookingDate) return '';
  const dateStr = String(bookingDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return formatDateShort(bookingDate);
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return formatDateShort(dateStr);
  return date.toLocaleDateString('en-CA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function PartyPickerCard({ booking, loading, onSelect }) {
  const partyDate = formatPartyPickerDate(booking.booking_date);
  const timeLabel = formatBookingTimeRangeLabel({
    booking_time: booking.booking_time,
    booking_end_time: booking.booking_end_time,
    duration_minutes: booking.duration_minutes,
  });
  const birthdayChild = String(
    booking.birthday_child_name || booking.birthdayChildName || '',
  ).trim();

  return (
    <button
      type="button"
      onClick={() => onSelect(booking.booking_id)}
      disabled={loading}
      style={{
        textAlign: 'left',
        padding: '16px 18px',
        borderRadius: 10,
        border: '1px solid #d1d5db',
        background: '#fff',
        cursor: loading ? 'wait' : 'pointer',
        width: '100%',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 8 }}>
        {booking.activity_name || 'Party'}
      </div>
      <div style={{
        fontSize: 20,
        fontWeight: 700,
        color: '#111827',
        lineHeight: 1.25,
        marginBottom: 6,
      }}>
        {partyDate || 'Date TBD'}
      </div>
      {timeLabel ? (
        <div style={{ fontSize: 16, fontWeight: 600, color: TavariStyles.colors.primary || '#2563eb', marginBottom: 8 }}>
          {timeLabel}
        </div>
      ) : null}
      {birthdayChild ? (
        <div style={{ fontSize: 15, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
          Birthday child: {birthdayChild}
        </div>
      ) : null}
      <div style={{ fontSize: 13, color: '#9ca3af' }}>
        #{booking.booking_number || booking.booking_id?.slice(0, 8)}
      </div>
    </button>
  );
}

export default function CustomerPortalPartyGuestListPage() {
  const { businessId } = useParams();
  const [business, setBusiness] = useState(null);
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [requiresEmail, setRequiresEmail] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessionToken, setSessionToken] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [pickerRequired, setPickerRequired] = useState(false);
  const [entries, setEntries] = useState([]);
  const [guestList, setGuestList] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [listLimitSettings, setListLimitSettings] = useState(null);
  const [overagePricing, setOveragePricing] = useState(null);
  const [locked, setLocked] = useState(false);
  const [postDeadlineContact, setPostDeadlineContact] = useState('');
  const [overagePayment, setOveragePayment] = useState(() => resolvePartyGuestOveragePayment());
  const [overageFood, setOverageFood] = useState(() => resolvePartyGuestOverageFood());
  const [overageFoodOther, setOverageFoodOther] = useState('');
  const [overageSocks, setOverageSocks] = useState(() => resolvePartyGuestOverageSocks());
  const [saving, setSaving] = useState(false);

  const applyListPayload = useCallback((data) => {
    setEntries(data.entries || []);
    setGuestList(data.guestList || null);
    setWarnings(data.warnings?.warnings || []);
    setListLimitSettings(extractListLimitSettingsFromApiData(data));
    setOveragePricing(data.overagePricing || null);
    setLocked(!!data.locked);
    setPostDeadlineContact(data.postDeadlineContact || '');
    setOveragePayment(resolvePartyGuestOveragePayment(data.guestList?.overage_payment));
    setOverageFood(resolvePartyGuestOverageFood(data.guestList?.overage_food));
    setOverageFoodOther(data.guestList?.overage_food_other || '');
    setOverageSocks(resolvePartyGuestOverageSocks(data.guestList?.overage_socks));
  }, []);

  const liveWarnings = useMemo(() => {
    if (!listLimitSettings) return warnings;
    return computeGuestListWarnings(entries, listLimitSettings).warnings;
  }, [entries, listLimitSettings, warnings]);

  const clearSavedSession = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY(businessId));
    setSessionToken(null);
    setStep('phone');
  }, [businessId]);

  const loadList = useCallback(async (token, { silent = false } = {}) => {
    setLoading(true);
    try {
      const data = await partyGuestListService.getList(token);
      applyListPayload(data);
      setSessionToken(token);
      sessionStorage.setItem(SESSION_KEY(businessId), token);
      setStep('list');
    } catch (err) {
      clearSavedSession();
      if (!silent) {
        toast.error(err.message || 'Session expired — please sign in again');
      }
    } finally {
      setLoading(false);
    }
  }, [businessId, clearSavedSession, applyListPayload]);

  useEffect(() => {
    partyGuestListService.setBusinessId(businessId);
    supabase.from('businesses').select('name').eq('id', businessId).single().then(({ data }) => setBusiness(data));

    const saved = sessionStorage.getItem(SESSION_KEY(businessId));
    if (saved) {
      loadList(saved, { silent: true });
    }
  }, [businessId, loadList]);

  const handleSendOtp = async () => {
    const normalized = normalizePhoneDigits(phone);
    if (normalized.length < 10) {
      toast.error('Enter a valid phone number');
      return;
    }
    setLoading(true);
    try {
      const res = await partyGuestListService.sendOtp(normalized, email || null);
      if (res.requiresEmail) {
        setRequiresEmail(true);
        toast('Enter the email on your booking to receive a code');
        return;
      }
      setOtpSent(true);
      setRequiresEmail(false);
      toast.success(`Code sent${res.maskedEmail ? ` to ${res.maskedEmail}` : ''}`);
    } catch (err) {
      toast.error(err.message || 'Could not send code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setLoading(true);
    try {
      const res = await partyGuestListService.verifyOtp(phone, otp);
      if (res.bookingPickerRequired) {
        setBookings(res.bookings || []);
        setPickerRequired(true);
        setStep('picker');
        return;
      }
      if (res.sessionToken) {
        applyListPayload(res);
        setSessionToken(res.sessionToken);
        sessionStorage.setItem(SESSION_KEY(businessId), res.sessionToken);
        setStep('list');
      }
    } catch (err) {
      toast.error(err.message || 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  const handlePickBooking = async (bookingId) => {
    setLoading(true);
    try {
      const res = await partyGuestListService.selectBooking(phone, bookingId);
      setSessionToken(res.sessionToken);
      sessionStorage.setItem(SESSION_KEY(businessId), res.sessionToken);
      applyListPayload(res);
      setStep('list');
    } catch (err) {
      toast.error(err.message || 'Could not open guest list');
    } finally {
      setLoading(false);
    }
  };

  const persistList = useCallback(async (entriesToSave, {
    submit = false,
    silent = true,
    overage = overagePayment,
    food = overageFood,
    foodOther = overageFoodOther,
    socks = overageSocks,
  } = {}) => {
    if (!sessionToken || locked) return false;
    setSaving(true);
    try {
      const res = await partyGuestListService.saveList(sessionToken, entriesToSave, {
        overagePayment: overage,
        overageFood: food,
        overageFoodOther: foodOther,
        overageSocks: socks,
      }, submit);
      applyListPayload(res);
      if (!silent) {
        toast.success(submit ? 'Guest list submitted' : 'Saved');
      }
      return true;
    } catch (err) {
      toast.error(err.message || 'Save failed');
      return false;
    } finally {
      setSaving(false);
    }
  }, [sessionToken, locked, overagePayment, overageFood, overageFoodOther, overageSocks, applyListPayload]);

  const handleSubmit = async () => {
    await persistList(entries, { submit: true, silent: false });
  };

  const persistOveragePreferences = async ({
    payment = overagePayment,
    food = overageFood,
    foodOther = overageFoodOther,
    socks = overageSocks,
  } = {}) => {
    if (!sessionToken || locked) return;
    setSaving(true);
    try {
      const res = await partyGuestListService.saveList(sessionToken, entries, {
        overagePayment: payment,
        overageFood: food,
        overageFoodOther: food === 'other' ? foodOther : '',
        overageSocks: socks,
      }, false);
      applyListPayload(res);
    } catch (err) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleOveragePaymentChange = async (value) => {
    setOveragePayment(value);
    await persistOveragePreferences({ payment: value });
  };

  const handleOverageFoodChange = async (value) => {
    setOverageFood(value);
    const nextOther = value === 'other' ? overageFoodOther : '';
    if (value !== 'other') setOverageFoodOther('');
    await persistOveragePreferences({ food: value, foodOther: nextOther });
  };

  const handleOverageFoodOtherChange = (value) => {
    setOverageFoodOther(value);
  };

  const handleOverageFoodOtherBlur = async (value) => {
    setOverageFoodOther(value);
    if (overageFood !== 'other') return;
    await persistOveragePreferences({ foodOther: value });
  };

  const handleOverageSocksChange = async (value) => {
    setOverageSocks(value);
    await persistOveragePreferences({ socks: value });
  };

  const handlePrint = () => {
    try {
      printPartyGuestList({
        guestList,
        entries,
        businessName: business?.name || '',
      });
    } catch (err) {
      toast.error(err.message || 'Could not open print window');
    }
  };

  return (
    <div className="party-guest-list-portal-page">
      <div className="party-guest-list-portal-card">
        <h1 style={{ margin: '0 0 8px', fontSize: 26 }}>{business?.name || 'Party Guest List'}</h1>
        <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: 14 }}>
          Add the first and last name of every child and adult attending your party. One phone number can cover a child and their parent.
        </p>

        {step === 'phone' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={{ fontWeight: 600, fontSize: 14 }}>Your phone number (party booker)</label>
            <input
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
              placeholder="(519) 555-1234"
              style={{ padding: 12, borderRadius: 8, border: '1px solid #d1d5db', fontSize: 16 }}
            />
            {(requiresEmail || otpSent) && (
              <>
                {requiresEmail && (
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email on your booking"
                    style={{ padding: 12, borderRadius: 8, border: '1px solid #d1d5db' }}
                  />
                )}
                {!otpSent ? (
                  <button type="button" style={btnPrimary} disabled={loading} onClick={handleSendOtp}>
                    {loading ? 'Sending…' : 'Send verification code'}
                  </button>
                ) : (
                  <>
                    <input
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="6-digit code"
                      style={{ padding: 12, borderRadius: 8, border: '1px solid #d1d5db', letterSpacing: 6, fontSize: 20 }}
                    />
                    <button type="button" style={btnPrimary} disabled={loading || otp.length !== 6} onClick={handleVerifyOtp}>
                      {loading ? 'Verifying…' : 'Continue'}
                    </button>
                  </>
                )}
              </>
            )}
            {!requiresEmail && !otpSent && (
              <button type="button" style={btnPrimary} disabled={loading} onClick={handleSendOtp}>
                {loading ? 'Sending…' : 'Send verification code'}
              </button>
            )}
          </div>
        )}

        {step === 'picker' && (
          <div>
            <p style={{ fontWeight: 600, marginBottom: 12 }}>Select your party:</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {bookings.map((b) => (
                <PartyPickerCard
                  key={b.booking_id}
                  booking={b}
                  loading={loading}
                  onSelect={handlePickBooking}
                />
              ))}
            </div>
          </div>
        )}

        {step === 'list' && (
          <div>
            {!locked ? (
              <PartyGuestListOverageOptions
                overagePayment={overagePayment}
                overageFood={overageFood}
                overageFoodOther={overageFoodOther}
                overageSocks={overageSocks}
                onOveragePaymentChange={handleOveragePaymentChange}
                onOverageFoodChange={handleOverageFoodChange}
                onOverageFoodOtherChange={handleOverageFoodOtherChange}
                onOverageFoodOtherBlur={handleOverageFoodOtherBlur}
                onOverageSocksChange={handleOverageSocksChange}
              />
            ) : (
              <PartyGuestListOverageOptions
                overagePayment={overagePayment}
                overageFood={overageFood}
                overageFoodOther={overageFoodOther}
                overageSocks={overageSocks}
                disabled
              />
            )}

            {locked ? (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 14, marginBottom: 16, fontSize: 14 }}>
                The edit deadline has passed. {postDeadlineContact || 'Contact the facility to update your list.'}
              </div>
            ) : null}

            <PartyGuestListWarnings warnings={liveWarnings} />

            <PartyGuestListEntryEditor
              entries={entries}
              onChange={setEntries}
              locked={locked}
              onPersist={persistList}
              persisting={saving}
              limitSettings={listLimitSettings}
              overagePricing={overagePricing}
              overagePayment={overagePayment}
            />

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 20, alignItems: 'center' }}>
              {!locked && (
                <button type="button" style={{ ...btnPrimary, background: '#059669' }} disabled={loading || saving} onClick={handleSubmit}>
                  {saving ? 'Saving…' : 'Submit list'}
                </button>
              )}
              {saving && !locked ? (
                <span style={{ fontSize: 13, color: '#6b7280' }}>Saving changes…</span>
              ) : null}
              <PrintGuestListButton onPrint={handlePrint} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
