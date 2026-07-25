// src/screens/Bookings/BookingConfirmedPage.jsx
// Success page after payment: /customer-portal/:businessId/portal/booking-confirmed/:bookingId

import React, { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { bookingRequiresPartyTermsApprovalCta } from '../../utils/bookingTermsAcknowledgment';

const styles = {
  page: {
    minHeight: '100vh',
    background: TavariStyles.colors?.gray50 || '#f9fafb',
    padding: '24px 16px',
  },
  container: {
    maxWidth: 560,
    margin: '0 auto',
    background: '#fff',
    borderRadius: 12,
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    padding: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    color: TavariStyles.colors?.gray900 || '#111',
    marginBottom: 24,
    textAlign: 'center',
  },
  row: {
    marginBottom: 12,
    fontSize: 15,
    color: TavariStyles.colors?.gray700 || '#374151',
  },
  label: {
    fontWeight: 600,
    color: TavariStyles.colors?.gray600 || '#4b5563',
    marginBottom: 2,
  },
  value: {
    color: TavariStyles.colors?.gray900 || '#111',
  },
  section: {
    marginTop: 24,
    paddingTop: 24,
    borderTop: `1px solid ${TavariStyles.colors?.border || '#e5e7eb'}`,
  },
  nextStepSection: {
    marginTop: 28,
    padding: '20px 18px',
    borderRadius: 12,
    background: '#fff7ed',
    border: '2px solid #f59e0b',
    boxShadow: '0 0 0 4px rgba(245, 158, 11, 0.12)',
  },
  nextStepEyebrow: {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: '#b45309',
    marginBottom: 6,
  },
  nextStepTitle: {
    fontSize: 20,
    fontWeight: 800,
    color: TavariStyles.colors?.gray900 || '#111',
    marginBottom: 8,
    lineHeight: 1.25,
  },
  nextStepCopy: {
    margin: '0 0 16px',
    fontSize: 14,
    lineHeight: 1.55,
    color: TavariStyles.colors?.gray700 || '#374151',
  },
  buttonTerms: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    textAlign: 'center',
    padding: '16px 20px',
    borderRadius: 10,
    fontSize: 18,
    fontWeight: 800,
    letterSpacing: '0.01em',
    cursor: 'pointer',
    border: 'none',
    textDecoration: 'none',
    background: TavariStyles.colors?.primaryDark || '#006666',
    color: '#fff',
    boxShadow: '0 4px 14px rgba(0, 102, 102, 0.35)',
  },
  buttons: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 32,
    justifyContent: 'center',
  },
  button: {
    padding: '12px 24px',
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    textDecoration: 'none',
    display: 'inline-block',
  },
  buttonPrimary: {
    background: TavariStyles.colors?.primary || '#2563eb',
    color: '#fff',
  },
  buttonSecondary: {
    background: TavariStyles.colors?.gray200 || '#e5e7eb',
    color: TavariStyles.colors?.gray800 || '#1f2937',
  },
  loading: {
    textAlign: 'center',
    padding: 48,
    color: TavariStyles.colors?.gray600,
  },
  error: {
    textAlign: 'center',
    padding: 48,
    color: TavariStyles.colors?.error || '#dc2626',
  },
  printOnly: {
    display: 'none',
  },
  emailNotice: {
    marginBottom: 20,
    padding: '14px 16px',
    borderRadius: 10,
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    color: '#1e3a8a',
    fontSize: 14,
    lineHeight: 1.55,
  },
  emailNoticeTitle: {
    fontWeight: 700,
    marginBottom: 6,
    color: '#1e40af',
  },
};

const BookingConfirmedPage = () => {
  const { businessId, bookingId } = useParams();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [booking, setBooking] = useState(null);
  const [business, setBusiness] = useState(null);
  const [activity, setActivity] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [payments, setPayments] = useState([]);
  const [ticketSummary, setTicketSummary] = useState([]); // { name, qty }
  const [manageUrl, setManageUrl] = useState(null);
  const [termsAckPath, setTermsAckPath] = useState(null);
  const [termsRequired, setTermsRequired] = useState(false);
  const bookingToken = searchParams.get('token') || '';
  const requestSubmitted = searchParams.get('submitted') === '1';
  const termsTokenFromQuery = searchParams.get('termsToken') || '';

  useEffect(() => {
    if (!businessId || !bookingId || !bookingToken) return;
    loadBooking();
  }, [businessId, bookingId, bookingToken]);

  const [participant1Detail, setParticipant1Detail] = useState(null);
  const [isPartyBooking, setIsPartyBooking] = useState(false);
  const [partyParentName, setPartyParentName] = useState('');
  const [partyChildName, setPartyChildName] = useState('');

  const loadBooking = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('get-booking-confirmation', {
        body: { businessId, bookingId, token: bookingToken },
      });
      if (fnError || data?.error) {
        setError(data?.error || fnError?.message || 'Booking not found.');
        setLoading(false);
        return;
      }
      setBooking(data.booking);
      setBusiness(data.business || null);
      setActivity(data.activity || null);
      setParticipants(data.participants || []);
      setPayments(data.payments || []);
      setTicketSummary(data.ticketSummary || []);
      setParticipant1Detail(data.participant1Detail || null);
      setIsPartyBooking(Boolean(data.isPartyBooking));
      setPartyParentName(data.partyParentName || '');
      setPartyChildName(data.partyChildName || '');
      // Sole gate: pending Terms + activity opted into confirmation CTA.
      // Never show “Party Approval” from a stale API flag or terms token alone.
      const needsTerms = bookingRequiresPartyTermsApprovalCta(
        data.booking,
        data.termsShowOnConfirmation ?? data.activity,
      );
      setTermsRequired(needsTerms);
      const tokenForTerms =
        data.booking?.terms_ack_token || termsTokenFromQuery || null;
      const ackPath =
        data.termsAckPath ||
        (typeof data.termsAckUrl === 'string' && data.termsAckUrl.startsWith('/')
          ? data.termsAckUrl
          : null) ||
        (tokenForTerms
          ? `/customer-portal/${businessId}/portal/booking-terms/${tokenForTerms}`
          : null);
      setTermsAckPath(needsTerms ? ackPath : null);
      // Confirmation email is sent once by payment finalization (helcim-pay-finalize / webhook).
    } catch (e) {
      setError(e?.message || 'Failed to load booking.');
    } finally {
      setLoading(false);
    }
  };

  const totalPaid = (payments || []).filter((p) => p.status === 'completed').reduce((sum, p) => sum + Number(p.amount_paid || 0), 0);

  const participant1Name = participant1Detail
    ? [participant1Detail.first_name, participant1Detail.last_name].filter(Boolean).join(' ') || '—'
    : booking?.customer_id
      ? 'Customer'
      : '—';
  const participant1Email = participant1Detail?.email || booking?.customer_email || '—';
  const participant1Phone = participant1Detail?.phone_number || booking?.customer_phone || '—';

  const handlePrint = () => {
    window.print();
  };

  const websiteUrl = business?.business_website
    ? (business.business_website.startsWith('http') ? business.business_website : `https://${business.business_website}`)
    : null;

  if (!bookingToken) {
    return (
      <div style={styles.page}>
        <div style={styles.error}>
          This confirmation link is missing its booking token.
          <Link to={`/customer-portal/${businessId}/portal`} style={{ display: 'block', marginTop: 12 }}>Return to portal</Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.loading}>Loading your booking…</div>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div style={styles.page}>
        <div style={styles.error}>
          {error || 'Booking not found.'}
          <Link to={`/customer-portal/${businessId}/portal`} style={{ display: 'block', marginTop: 12 }}>Return to portal</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.container} className="booking-confirmed-print">
        <h1 style={styles.title}>{requestSubmitted ? 'Request Submitted' : 'Booking Confirmed'}</h1>
        <div style={styles.emailNotice} role="status">
          <div style={styles.emailNoticeTitle}>Check your email — including junk or spam</div>
          <p style={{ margin: 0 }}>
            We&apos;ve sent a message to the email address on this booking. If you don&apos;t see it in your inbox within a few minutes, please check your junk, spam, or promotions folder.
            To help future emails reach you, mark our message as <strong>Not junk</strong> or <strong>Not spam</strong>, or add us to your safe senders / approved senders list (sometimes called a whitelist).
          </p>
        </div>
        {requestSubmitted ? (
          <p style={{ ...styles.row, color: TavariStyles.colors?.gray700 || '#374151', marginBottom: 16, textAlign: 'center' }}>
            Your spot is held while our team reviews your request. You will receive an email with a deposit payment link once your booking is approved.
          </p>
        ) : (
          <p style={{ ...styles.row, color: TavariStyles.colors?.gray700 || '#374151', marginBottom: 16, textAlign: 'center' }}>
            A confirmation email has been sent to the address on this booking.
          </p>
        )}

        {isPartyBooking ? (
          <>
            <div style={styles.row}>
              <div style={styles.label}>Party Parent</div>
              <div style={styles.value}>{partyParentName || '—'}</div>
            </div>
            <div style={styles.row}>
              <div style={styles.label}>Party Child</div>
              <div style={styles.value}>{partyChildName || '—'}</div>
            </div>
          </>
        ) : (
          <div style={styles.row}>
            <div style={styles.label}>
              {participant1Detail?.first_name ? 'Camper / Participant' : 'Name of Participant 1'}
            </div>
            <div style={styles.value}>{participant1Name}</div>
          </div>
        )}
        <div style={styles.row}>
          <div style={styles.label}>Contact email</div>
          <div style={styles.value}>{participant1Email}</div>
        </div>
        <div style={styles.row}>
          <div style={styles.label}>Contact phone</div>
          <div style={styles.value}>{participant1Phone}</div>
        </div>
        <div style={styles.row}>
          <div style={styles.label}>Booking Number</div>
          <div style={styles.value}>{booking.booking_number || booking.id.slice(0, 8)}</div>
        </div>

        <div style={styles.section}>
          <div style={styles.label}>Tickets purchased</div>
          {ticketSummary.length > 0 ? (
            ticketSummary.map((t, i) => (
              <div key={i} style={styles.row}>
                <span style={styles.value}>{t.name} × {t.qty}</span>
              </div>
            ))
          ) : (
            <div style={styles.value}>—</div>
          )}
        </div>

        <div style={styles.row}>
          <div style={styles.label}>Total Paid</div>
          <div style={styles.value}>${Number(totalPaid).toFixed(2)}</div>
        </div>

        {termsRequired && termsAckPath && (
          <div style={styles.nextStepSection} className="no-print" role="region" aria-label="Next step for party approval">
            <div style={styles.nextStepEyebrow}>Action required</div>
            <div style={styles.nextStepTitle}>Next Step For Party Approval</div>
            <p style={styles.nextStepCopy}>
              Your request cannot be approved until you review and sign the Terms &amp; Conditions.
              This only takes a few minutes.
            </p>
            <Link to={termsAckPath} style={styles.buttonTerms}>
              Acknowledge Terms &amp; Conditions Now
            </Link>
          </div>
        )}

        <div style={styles.buttons} className="no-print">
          {bookingToken && (
            <Link
              to={`/customer-portal/${businessId}/portal/manage-booking/${encodeURIComponent(bookingToken)}`}
              style={{ ...styles.button, ...styles.buttonPrimary }}
            >
              Manage Booking
            </Link>
          )}
          <button type="button" onClick={handlePrint} style={{ ...styles.button, ...styles.buttonPrimary }}>
            Print PDF of booking
          </button>
          {websiteUrl ? (
            <a href={websiteUrl} target="_blank" rel="noopener noreferrer" style={{ ...styles.button, ...styles.buttonSecondary }}>
              Return to Main Website
            </a>
          ) : (
            <Link to={`/customer-portal/${businessId}/portal`} style={{ ...styles.button, ...styles.buttonSecondary }}>
              Return to portal
            </Link>
          )}
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          .booking-confirmed-print, .booking-confirmed-print * { visibility: visible; }
          .booking-confirmed-print { position: absolute; left: 0; top: 0; width: 100%; padding: 16px; box-shadow: none; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
};

export default BookingConfirmedPage;
