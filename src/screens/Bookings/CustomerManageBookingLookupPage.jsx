import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import manageBookingApiService from '../../services/Bookings/ManageBookingApiService';
import { TavariStyles } from '../../utils/TavariStyles';
import { formatPhoneInput } from '../../utils/phoneFormat';
import { normalizePhoneDigits } from '../../utils/waiverExistingViewerAccess';

const btnPrimary = {
  padding: '12px 18px',
  borderRadius: 8,
  border: 'none',
  background: TavariStyles.colors.primary || '#2563eb',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
};

function formatBookingLabel(booking) {
  const date = booking.bookingDate || booking.booking_date;
  const time = booking.bookingTime || booking.booking_time;
  const activity = booking.activityName || booking.activity_name || 'Booking';
  return `${activity} — ${date || 'Date TBD'}${time ? ` at ${String(time).slice(0, 5)}` : ''}`;
}

export default function CustomerManageBookingLookupPage() {
  const { businessId } = useParams();
  const navigate = useNavigate();
  const [business, setBusiness] = useState(null);
  const [intro, setIntro] = useState('');
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [requiresEmail, setRequiresEmail] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessionToken, setSessionToken] = useState(null);
  const [bookings, setBookings] = useState([]);

  useEffect(() => {
    manageBookingApiService.setBusinessId(businessId);
    supabase.from('businesses').select('name').eq('id', businessId).single().then(({ data }) => setBusiness(data));
    manageBookingApiService.getPortalInfo().then((info) => {
      if (info?.intro) setIntro(String(info.intro));
    }).catch(() => {});
  }, [businessId]);

  const handleSendOtp = async () => {
    const normalized = normalizePhoneDigits(phone);
    if (normalized.length < 10) {
      toast.error('Enter a valid phone number');
      return;
    }
    setLoading(true);
    try {
      const res = await manageBookingApiService.sendOtp(normalized, email || null);
      if (res.requiresEmail) {
        setRequiresEmail(true);
        toast('Enter the email on your booking to receive a code');
        return;
      }
      setStep('otp');
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
      const res = await manageBookingApiService.verifyOtp(phone, otp);
      setSessionToken(res.sessionToken);
      const list = res.bookings || [];
      setBookings(list);
      if (list.length === 0) {
        setStep('picker');
        return;
      }
      if (list.length === 1) {
        await handleSelectBooking(res.sessionToken, list[0].bookingId);
        return;
      }
      setStep('picker');
    } catch (err) {
      toast.error(err.message || 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectBooking = async (token, bookingId) => {
    setLoading(true);
    try {
      const res = await manageBookingApiService.selectBooking(token || sessionToken, bookingId);
      if (res.manageToken) {
        navigate(`/customer-portal/${businessId}/portal/manage-booking/${encodeURIComponent(res.manageToken)}`);
      }
    } catch (err) {
      toast.error(err.message || 'Could not open booking');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', padding: '24px 16px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
          Manage your booking
        </h1>
        {business?.name ? (
          <p style={{ color: '#6b7280', marginBottom: 16 }}>{business.name}</p>
        ) : null}
        {intro ? <p style={{ color: '#374151', marginBottom: 20, lineHeight: 1.5 }}>{intro}</p> : null}

        {step === 'phone' ? (
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>Phone number on booking</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
              style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #d1d5db', marginBottom: 12 }}
            />
            {requiresEmail ? (
              <>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>Email on booking</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #d1d5db', marginBottom: 12 }}
                />
              </>
            ) : null}
            <button type="button" style={btnPrimary} disabled={loading} onClick={handleSendOtp}>
              {loading ? 'Sending…' : 'Send verification code'}
            </button>
          </div>
        ) : null}

        {step === 'otp' ? (
          <div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>Verification code</label>
            <input
              type="text"
              inputMode="numeric"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #d1d5db', marginBottom: 12, letterSpacing: 6, fontSize: 20 }}
            />
            <button type="button" style={btnPrimary} disabled={loading} onClick={handleVerifyOtp}>
              {loading ? 'Checking…' : 'Continue'}
            </button>
          </div>
        ) : null}

        {step === 'picker' ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <p style={{ fontWeight: 600 }}>Select a booking to manage</p>
            {bookings.map((booking) => (
              <button
                key={booking.bookingId}
                type="button"
                disabled={loading}
                onClick={() => handleSelectBooking(sessionToken, booking.bookingId)}
                style={{
                  textAlign: 'left',
                  padding: '14px 16px',
                  borderRadius: 10,
                  border: '1px solid #d1d5db',
                  background: '#fff',
                  cursor: loading ? 'wait' : 'pointer',
                }}
              >
                <div style={{ fontWeight: 700 }}>{formatBookingLabel(booking)}</div>
                <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 4 }}>
                  #{booking.bookingNumber || booking.bookingId?.slice(0, 8)}
                </div>
              </button>
            ))}
            {bookings.length === 0 ? (
              <p style={{ color: '#6b7280' }}>No upcoming bookings were found for this phone number.</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
