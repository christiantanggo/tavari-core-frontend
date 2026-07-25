import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { appendHelcimPayIframeCompat, isHelcimPayJsMessage } from '../../helpers/helcimPayIframe';
import toast from 'react-hot-toast';
import BookingActivityTabPanel from '../../components/Bookings/BookingActivityTabPanel';
import {
  normalizeActivityTab,
  tabVisibleToAudience,
} from '../../helpers/Bookings/bookingActivityTabs';

const HELCIM_PAY_SCRIPT_URL = 'https://secure.helcim.app/helcim-pay/services/start.js';

const styles = {
  page: {
    minHeight: '100dvh',
    background: TavariStyles.colors?.gray50 || '#f9fafb',
    padding: 'clamp(12px, 3vw, 24px) clamp(10px, 3vw, 16px)',
    boxSizing: 'border-box',
    overflowX: 'hidden',
    width: '100%',
  },
  container: {
    maxWidth: 760,
    width: '100%',
    margin: '0 auto',
    background: '#fff',
    borderRadius: 12,
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    padding: 'clamp(14px, 3vw, 24px)',
    boxSizing: 'border-box',
    overflowX: 'hidden',
  },
  title: {
    fontSize: 'clamp(22px, 5vw, 28px)',
    fontWeight: 700,
    marginBottom: 20,
    color: TavariStyles.colors?.gray900 || '#111827',
    overflowWrap: 'anywhere',
  },
  card: {
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: 'clamp(12px, 2.5vw, 16px)',
    marginBottom: 16,
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: '100%',
    overflowX: 'hidden',
  },
  row: {
    marginBottom: 10,
    color: TavariStyles.colors?.gray700 || '#374151',
    minWidth: 0,
  },
  value: {
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
  },
  label: {
    fontSize: 13,
    fontWeight: 700,
    color: TavariStyles.colors?.gray500 || '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: 4,
  },
  buttons: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 20,
    width: '100%',
    maxWidth: '100%',
  },
  button: {
    padding: '10px 18px',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
    maxWidth: '100%',
    boxSizing: 'border-box',
    whiteSpace: 'normal',
    textAlign: 'center',
  },
  primary: {
    background: TavariStyles.colors?.primary || '#2563eb',
    color: '#fff',
  },
  danger: {
    background: '#dc2626',
    color: '#fff',
  },
  secondary: {
    background: '#e5e7eb',
    color: '#111827',
  },
  textarea: {
    width: '100%',
    maxWidth: '100%',
    minHeight: 84,
    borderRadius: 8,
    border: '1px solid #d1d5db',
    padding: 12,
    fontSize: 14,
    boxSizing: 'border-box',
    resize: 'vertical',
  },
  radioRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '12px 0',
    borderTop: '1px solid #f3f4f6',
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
    minWidth: 0,
  },
  muted: {
    color: TavariStyles.colors?.gray600 || '#4b5563',
    fontSize: 14,
    lineHeight: 1.55,
    overflowWrap: 'anywhere',
  },
  policyText: {
    color: TavariStyles.colors?.gray600 || '#4b5563',
    fontSize: 14,
    lineHeight: 1.55,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    maxWidth: '100%',
  },
  emailNotice: {
    marginBottom: 16,
    padding: '14px 16px',
    borderRadius: 10,
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    color: '#1e3a8a',
    fontSize: 14,
    lineHeight: 1.55,
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: '100%',
    overflowWrap: 'anywhere',
  },
  emailNoticeTitle: {
    fontWeight: 700,
    marginBottom: 6,
    color: '#1e40af',
  },
  error: {
    color: '#b91c1c',
    textAlign: 'center',
    padding: 24,
    overflowWrap: 'anywhere',
  },
};

const formatSessionLabel = (session) => {
  const date = session?.session_date ? new Date(`${session.session_date}T12:00:00`) : null;
  const dateText = date ? date.toLocaleDateString() : session?.session_date || 'Unknown date';
  return `${dateText} at ${session?.start_time || ''}`;
};

/** Human-readable duration until booking start (updates when `ms` is recomputed). */
function formatDurationRemaining(ms) {
  if (ms == null || ms <= 0) return 'less than a minute';
  const totalMins = Math.floor(ms / 60000);
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;
  const parts = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins} minute${mins === 1 ? '' : 's'}`);
  return parts.join(', ');
}

const CustomerManageBookingPage = () => {
  const { businessId, token } = useParams();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [payLoading, setPayLoading] = useState(false);
  const [error, setError] = useState(null);
  const [payload, setPayload] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [scheduleClock, setScheduleClock] = useState(() => Date.now());
  const helcimCheckoutRef = useRef({ checkoutToken: null, finalized: false });
  const helcimPollingIntervalRef = useRef(null);
  const autoPayTriggeredRef = useRef(false);

  const bookingStartMs = useMemo(() => {
    const b = payload?.booking;
    if (!b?.booking_date || !b?.booking_time) return null;
    const d = new Date(`${b.booking_date}T${b.booking_time}`);
    return Number.isFinite(d.getTime()) ? d.getTime() : null;
  }, [payload?.booking?.booking_date, payload?.booking?.booking_time]);

  const minHoursRescheduleSetting = payload?.selfService?.minHoursBeforeReschedule;

  const msUntilBookingStart = useMemo(() => {
    if (bookingStartMs == null) return null;
    return Math.max(0, bookingStartMs - scheduleClock);
  }, [bookingStartMs, scheduleClock]);

  const rescheduleDeadlineMs = useMemo(() => {
    if (bookingStartMs == null || minHoursRescheduleSetting == null || minHoursRescheduleSetting <= 0) {
      return null;
    }
    return bookingStartMs - minHoursRescheduleSetting * 3600000;
  }, [bookingStartMs, minHoursRescheduleSetting]);

  useEffect(() => {
    const id = setInterval(() => setScheduleClock(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const loadBooking = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('manage-booking-self-service', {
        body: { action: 'lookup', token },
      });
      if (fnError || data?.error) {
        throw new Error(data?.error || fnError?.message || 'Booking not found');
      }
      setPayload(data);
      setCancelReason(data.booking?.cancellation_reason || '');
    } catch (err) {
      setError(err?.message || 'Could not load booking');
    } finally {
      setLoading(false);
    }
  };

  const loadAvailability = async () => {
    try {
      const { data, error: fnError } = await supabase.functions.invoke('manage-booking-self-service', {
        body: { action: 'availability', token },
      });
      if (fnError || data?.error) {
        throw new Error(data?.error || fnError?.message || 'Could not load availability');
      }
      setSessions(data.sessions || []);
      const currentSessionId = payload?.booking?.session_id;
      setSelectedSessionId(currentSessionId || data.sessions?.[0]?.id || '');
    } catch (err) {
      toast.error(err?.message || 'Could not load availability');
    }
  };

  useEffect(() => {
    if (token) {
      loadBooking();
    }
  }, [token]);

  useEffect(() => {
    const allow = payload?.selfService?.rescheduleAllowed ?? payload?.canReschedule;
    if (allow) {
      loadAvailability();
    }
  }, [payload?.selfService?.rescheduleAllowed, payload?.canReschedule]);

  useEffect(() => {
    const removeHelcimIframe = () => {
      const frame = document.getElementById('helcimPayIframe');
      if (frame?.parentNode) frame.remove();
    };

    const stopPolling = () => {
      if (helcimPollingIntervalRef.current) {
        clearInterval(helcimPollingIntervalRef.current);
        helcimPollingIntervalRef.current = null;
      }
    };

    const finishPaymentSuccess = async (checkoutToken, customerId, customerCodeFromHelcim) => {
      if (customerId) {
        try {
          await supabase.functions.invoke('save-helcim-customer-code', {
            body: {
              checkoutToken,
              businessId,
              customerId,
              customerCode: customerCodeFromHelcim || undefined,
              action: 'getDefaultCard',
            },
          });
        } catch (syncErr) {
          console.warn('[CustomerManageBooking] card sync after payment:', syncErr);
        }
      }
      removeHelcimIframe();
      toast.success('Deposit payment received.');
      await loadBooking();
      setPayLoading(false);
      helcimCheckoutRef.current = { checkoutToken: null, finalized: false };
      stopPolling();
    };

    const startPollingForCompletion = (checkoutToken) => {
      if (!checkoutToken || helcimPollingIntervalRef.current) return;
      let attempts = 0;
      const maxAttempts = 40;
      helcimPollingIntervalRef.current = setInterval(async () => {
        attempts += 1;
        if (attempts > maxAttempts) {
          stopPolling();
          setPayLoading(false);
          return;
        }
        try {
          const { data, error } = await supabase.functions.invoke('helcim-pay-status', {
            body: { checkoutToken },
          });
          if (error) return;
          if (data?.status === 'completed') {
            await finishPaymentSuccess(checkoutToken, payload?.booking?.customer_id, null);
          }
        } catch (_) {
          // keep polling
        }
      }, 3000);
    };

    const onHelcimMessage = (event) => {
      const checkoutToken = helcimCheckoutRef.current.checkoutToken;
      if (!isHelcimPayJsMessage(event, checkoutToken)) return;
      if (event.data.eventStatus === 'ABORTED') {
        removeHelcimIframe();
        setPayLoading(false);
        helcimCheckoutRef.current = { checkoutToken: null, finalized: false };
        return;
      }
      if (event.data.eventStatus !== 'SUCCESS') return;
      if (helcimCheckoutRef.current.finalized) {
        removeHelcimIframe();
        return;
      }

      const msg = event.data.eventMessage;
      let customerCodeFromHelcim = null;
      try {
        const parsed = typeof msg === 'string' ? JSON.parse(msg) : msg;
        const data = parsed?.data ?? parsed;
        customerCodeFromHelcim = data?.customerCode ?? data?.customer_code ?? null;
      } catch (_) {
        // ignore parse errors
      }

      helcimCheckoutRef.current.finalized = true;
      (async () => {
        try {
          const booking = payload?.booking;
          if (checkoutToken && booking?.customer_id) {
            await supabase.functions.invoke('save-helcim-customer-code', {
              body: {
                checkoutToken,
                customerCode: customerCodeFromHelcim,
                businessId,
                customerId: booking.customer_id,
              },
            });
          }

          const { data: finData, error: finError } = await supabase.functions.invoke('helcim-pay-finalize', {
            body: { checkoutToken, eventMessage: msg },
          });
          if (!finError && finData?.ok !== false && !finData?.error) {
            await finishPaymentSuccess(checkoutToken, booking?.customer_id, customerCodeFromHelcim);
            return;
          }

          toast.error('Confirming payment… checking with Helcim.');
          startPollingForCompletion(checkoutToken);
          try {
            const { data: stData, error: stErr } = await supabase.functions.invoke('helcim-pay-status', {
              body: { checkoutToken },
            });
            if (!stErr && stData?.status === 'completed') {
              await finishPaymentSuccess(checkoutToken, booking?.customer_id, customerCodeFromHelcim);
            }
          } catch (_) {
            // polling will continue
          }
        } catch (err) {
          console.error('[CustomerManageBooking] helcim finalize:', err);
          toast.error(err?.message || 'Payment received but confirmation failed. Please contact the venue.');
          startPollingForCompletion(checkoutToken);
        } finally {
          if (!helcimPollingIntervalRef.current) {
            setPayLoading(false);
          }
        }
      })();
    };

    window.addEventListener('message', onHelcimMessage);
    return () => {
      window.removeEventListener('message', onHelcimMessage);
      stopPolling();
    };
  }, [businessId, payload?.booking?.customer_id]);

  const totalPaid = useMemo(
    () => (payload?.payments || [])
      .filter((payment) => payment.status === 'completed')
      .reduce((sum, payment) => sum + Number(payment.amount_paid || 0), 0),
    [payload],
  );

  const handlePayDeposit = useCallback(async () => {
    const booking = payload?.booking;
    const depositAmount = payload?.selfService?.depositDueAmount;
    if (!booking?.id || !depositAmount) return;
    setPayLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('helcim-pay-init', {
        body: {
          amount: Number(Number(depositAmount).toFixed(2)),
          orderTotalWithTax: Number(booking.order_total || depositAmount),
          currency: 'CAD',
          businessId,
          existingBookingId: booking.id,
          customerId: booking.customer_id || null,
          setAsDefaultPaymentMethod: true,
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Could not start payment');
      const checkoutToken = data?.checkoutToken;
      if (!checkoutToken) throw new Error('No checkout token');
      helcimCheckoutRef.current = { checkoutToken, finalized: false };
      if (!document.querySelector(`script[src="${HELCIM_PAY_SCRIPT_URL}"]`)) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = HELCIM_PAY_SCRIPT_URL;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load payment form'));
          document.head.appendChild(script);
        });
      }
      appendHelcimPayIframeCompat(checkoutToken);
    } catch (err) {
      toast.error(err?.message || 'Payment is unavailable');
      setPayLoading(false);
    }
  }, [businessId, payload?.booking, payload?.selfService?.depositDueAmount]);

  const wantsPayFromLink = searchParams.get('pay') === '1' || searchParams.get('pay') === 'true';

  useEffect(() => {
    if (loading || autoPayTriggeredRef.current || !payload?.selfService?.awaitingDeposit) return;
    if (!wantsPayFromLink) return;
    autoPayTriggeredRef.current = true;
    handlePayDeposit();
  }, [loading, payload?.selfService?.awaitingDeposit, wantsPayFromLink, handlePayDeposit]);

  const handleCancel = async () => {
    setSubmitting(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('manage-booking-self-service', {
        body: { action: 'cancel', token, reason: cancelReason },
      });
      if (fnError || data?.error) {
        throw new Error(data?.error || fnError?.message || 'Could not cancel booking');
      }
      setPayload(data);
      toast.success('Booking cancelled');
    } catch (err) {
      toast.error(err?.message || 'Could not cancel booking');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReschedule = async () => {
    if (!selectedSessionId) {
      toast.error('Select a new session first');
      return;
    }
    setSubmitting(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('manage-booking-self-service', {
        body: { action: 'reschedule', token, sessionId: selectedSessionId },
      });
      if (fnError || data?.error) {
        throw new Error(data?.error || fnError?.message || 'Could not reschedule booking');
      }
      setPayload(data);
      toast.success('Booking rescheduled');
      await loadAvailability();
    } catch (err) {
      toast.error(err?.message || 'Could not reschedule booking');
    } finally {
      setSubmitting(false);
    }
  };

  const customerActivityTabs = useMemo(() => {
    const rows = Array.isArray(payload?.activityTabs) ? payload.activityTabs : [];
    return rows
      .map((row) => normalizeActivityTab(row))
      .filter((tab) => tab && tabVisibleToAudience(tab, 'customer'));
  }, [payload?.activityTabs]);

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.container}>Loading booking...</div>
      </div>
    );
  }

  if (error || !payload?.booking) {
    return (
      <div style={styles.page}>
        <div style={styles.container}>
          <div style={styles.error}>{error || 'Booking not found.'}</div>
          <Link to={`/customer-portal/${businessId}/portal`} style={{ color: TavariStyles.colors?.primary || '#2563eb' }}>
            Return to portal
          </Link>
        </div>
      </div>
    );
  }

  const { booking, business, ticketSummary, cancellationPolicy, canCancel, canReschedule } = payload;
  const selfService = payload.selfService || {};
  const cancelAllowed = selfService.cancelAllowed ?? canCancel;
  const rescheduleAllowed = selfService.rescheduleAllowed ?? canReschedule;
  const rescheduleBlockedReason = selfService.rescheduleBlockedReason ?? null;
  const minHoursBeforeReschedule = selfService.minHoursBeforeReschedule;
  const requiresContact = Boolean(selfService.requiresContactForCancel);
  const settlementPreview = selfService.settlementPreview || { settlement: 'none', amount: 0 };
  const contactPhone = selfService.contactPhone || '';
  const contactEmail = selfService.contactEmail || '';
  const creditBlocked =
    settlementPreview.settlement === 'loyalty_credit' &&
    settlementPreview.amount > 0 &&
    !booking.customer_id;

  const noticeSplitHours = selfService.noticeSplitHours ?? 48;
  const cancellationBand = selfService.cancellationBand;
  const activeCancelMode = selfService.activeCancelMode || '';

  const cancelOutcomeHint = () => {
    const bandSentence =
      cancellationBand === 'early'
        ? `You are at least ${noticeSplitHours} hours before the start (early cancellation rules apply). `
        : cancellationBand === 'late'
          ? `You are within ${noticeSplitHours} hours of the start (late cancellation rules apply). `
          : '';
    if (requiresContact) {
      return `${bandSentence}Cancellations are handled directly by the business (see below).`;
    }
    if (!cancelAllowed) {
      return 'Online cancellation is not available for this booking based on timing or policy.';
    }
    if (creditBlocked) {
      return 'This booking is set to refund as store credit, but no customer account is linked. Please contact the business.';
    }
    let moneySentence = '';
    switch (settlementPreview.settlement) {
      case 'helcim_refund':
        moneySentence = `If you cancel now, up to $${Number(totalPaid).toFixed(2)} will be refunded to your original card.`;
        break;
      case 'loyalty_credit':
        moneySentence = `If you cancel now, up to $${Number(totalPaid).toFixed(2)} will be added to your store credit balance.`;
        break;
      case 'none':
        moneySentence =
          activeCancelMode === 'cancel_only'
            ? 'If you cancel now, your booking will be cancelled. No refund and no store credit will be issued.'
            : 'If you cancel now, your booking will be cancelled. Per the policy for this timing, payments may not be refunded or credited.';
        break;
      default:
        moneySentence = '';
    }
    return bandSentence + moneySentence;
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <h1 style={styles.title}>Manage Booking</h1>

        <div style={styles.emailNotice} role="status">
          <div style={styles.emailNoticeTitle}>Check your junk or spam folder</div>
          <p style={{ margin: 0 }}>
            If you do not receive our booking emails in your inbox, please check your junk, spam, or promotions folder.
            Mark the message as <strong>Not junk</strong> / <strong>Not spam</strong> so future emails reach you.
          </p>
        </div>

        <div style={styles.card}>
          <div style={styles.row}>
            <div style={styles.label}>Business</div>
            <div style={styles.value}>{business?.name || 'Business'}</div>
          </div>
          <div style={styles.row}>
            <div style={styles.label}>Booking Number</div>
            <div style={styles.value}>{booking.booking_number || booking.id}</div>
          </div>
          <div style={styles.row}>
            <div style={styles.label}>Activity</div>
            <div style={styles.value}>{booking.booking_activities?.activity_name || 'Activity'}</div>
          </div>
          <div style={styles.row}>
            <div style={styles.label}>Current Booking Time</div>
            <div style={styles.value}>{new Date(`${booking.booking_date}T12:00:00`).toLocaleDateString()} at {booking.booking_time}</div>
          </div>
          <div style={styles.row}>
            <div style={styles.label}>Status</div>
            <div style={styles.value}>{booking.status}</div>
          </div>
          <div style={styles.row}>
            <div style={styles.label}>Total Paid</div>
            <div style={styles.value}>${Number(totalPaid).toFixed(2)}</div>
          </div>
          <div style={styles.row}>
            <div style={styles.label}>Tickets</div>
            <div style={styles.value}>{ticketSummary?.length ? ticketSummary.map((ticket) => `${ticket.name} x ${ticket.qty}`).join(', ') : 'No ticket summary available'}</div>
          </div>
        </div>

        {booking?.status !== 'cancelled' && customerActivityTabs.map((tab) => (
          <div key={tab.id || tab.tab_key} style={styles.card}>
            <div style={styles.label}>{tab.label || 'Details'}</div>
            <BookingActivityTabPanel
              tab={tab}
              booking={booking}
              businessId={businessId || booking.business_id}
              businessTimezone={payload?.businessTimezone}
              mode="customer"
              token={token}
              disabled={submitting}
            />
          </div>
        ))}

        {payload?.selfService?.awaitingDeposit && (
          <div style={{ ...styles.card, borderColor: '#bfdbfe', backgroundColor: '#eff6ff' }}>
            <div style={styles.label}>Deposit payment due</div>
            <p style={{ ...styles.muted, marginTop: 0 }}>
              Your booking was approved. Please pay your deposit
              {payload.selfService.depositDueAt
                ? ` by ${new Date(payload.selfService.depositDueAt).toLocaleDateString()}`
                : ''}.
            </p>
            <button
              type="button"
              onClick={handlePayDeposit}
              disabled={payLoading}
              style={{ ...styles.button, ...styles.primary, marginTop: 12, width: '100%' }}
            >
              {payLoading ? 'Opening secure payment…' : `Pay deposit $${Number(payload.selfService.depositDueAmount).toFixed(2)}`}
            </button>
          </div>
        )}

        <div style={styles.card}>
          <div style={styles.label}>Cancellation Policy</div>
          <div style={styles.policyText}>
            {typeof cancellationPolicy === 'string' && cancellationPolicy.trim()
              ? cancellationPolicy
              : 'No cancellation policy has been configured for this business.'}
          </div>
        </div>

        {requiresContact ? (
          <div style={styles.card}>
            <div style={styles.label}>Cancel or change this booking</div>
            <p style={{ ...styles.muted, marginTop: 0 }}>
              This category requires you to contact the business to cancel or change your booking.
            </p>
            {(contactPhone || contactEmail) && (
              <ul style={{ margin: '12px 0 0', paddingLeft: 18, color: TavariStyles.colors?.gray700 || '#374151', overflowWrap: 'anywhere' }}>
                {contactPhone ? (
                  <li style={{ marginBottom: 6 }}>
                    Phone:{' '}
                    <a href={`tel:${contactPhone.replace(/\s/g, '')}`} style={{ color: TavariStyles.colors?.primary || '#2563eb' }}>
                      {contactPhone}
                    </a>
                  </li>
                ) : null}
                {contactEmail ? (
                  <li>
                    Email:{' '}
                    <a href={`mailto:${contactEmail}`} style={{ color: TavariStyles.colors?.primary || '#2563eb', overflowWrap: 'anywhere' }}>
                      {contactEmail}
                    </a>
                  </li>
                ) : null}
              </ul>
            )}
            {!contactPhone && !contactEmail ? (
              <p style={styles.muted}>Ask the venue for contact details if you need to cancel.</p>
            ) : null}
          </div>
        ) : (
          <div style={styles.card}>
            <div style={styles.label}>Cancel Booking</div>
            <p style={{ ...styles.muted, marginTop: 0 }}>{cancelOutcomeHint()}</p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Optional reason for cancellation"
              style={styles.textarea}
              disabled={!cancelAllowed || submitting || creditBlocked}
            />
            <div style={styles.buttons}>
              <button
                type="button"
                onClick={handleCancel}
                disabled={!cancelAllowed || submitting || creditBlocked}
                style={{
                  ...styles.button,
                  ...styles.danger,
                  width: '100%',
                  opacity: !cancelAllowed || submitting || creditBlocked ? 0.6 : 1,
                }}
              >
                {cancelAllowed && !creditBlocked ? 'Cancel Booking' : 'Cancellation not available online'}
              </button>
            </div>
          </div>
        )}

        <div style={styles.card}>
          <div style={styles.label}>Reschedule Booking</div>
          {!rescheduleAllowed ? (
            <div style={styles.muted}>
              {rescheduleBlockedReason === 'category_disabled' && (
                <p style={{ marginTop: 0 }}>
                  Online rescheduling is not enabled for this type of booking. Contact the business if you need a
                  different time.
                </p>
              )}
              {rescheduleBlockedReason === 'past' && (
                <p style={{ marginTop: 0 }}>
                  This booking&apos;s start time has already passed. Contact the business if you need help.
                </p>
              )}
              {rescheduleBlockedReason === 'too_close' && (
                <>
                  <p style={{ marginTop: 0 }}>
                    {minHoursBeforeReschedule != null && minHoursBeforeReschedule > 0 ? (
                      <>
                        Rescheduling online is not permitted with less than{' '}
                        <strong>{minHoursBeforeReschedule}</strong> hours&apos; notice before your booking starts.
                        That option is available when you have enough advance notice; right now you are inside that
                        window, so please contact the business if you need to change your time.
                      </>
                    ) : (
                      <>
                        Online rescheduling is not available for this booking based on timing. Please contact the
                        business if you need to change your time.
                      </>
                    )}
                  </p>
                  {msUntilBookingStart != null && (
                    <p style={{ marginTop: 12 }}>
                      <strong>Time until your booking:</strong> {formatDurationRemaining(msUntilBookingStart)}.
                    </p>
                  )}
                  {minHoursBeforeReschedule != null &&
                    minHoursBeforeReschedule > 0 &&
                    rescheduleDeadlineMs != null && (
                      <p style={{ marginTop: 8 }}>
                        The last moment you could reschedule online was{' '}
                        <strong>
                          {new Date(rescheduleDeadlineMs).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </strong>{' '}
                        (at least {minHoursBeforeReschedule} hours before your scheduled start).
                      </p>
                    )}
                </>
              )}
              {rescheduleBlockedReason !== 'category_disabled' &&
                rescheduleBlockedReason !== 'past' &&
                rescheduleBlockedReason !== 'too_close' && (
                  <p style={{ marginTop: 0 }}>
                    Online rescheduling is not available for this booking.
                    {booking.status !== 'pending' && booking.status !== 'confirmed' ? (
                      <> This may be because the booking is no longer active.</>
                    ) : null}
                  </p>
                )}
            </div>
          ) : sessions.length === 0 ? (
            <div style={styles.muted}>No alternative sessions are available right now.</div>
          ) : (
            sessions.map((session) => (
              <label key={session.id} style={styles.radioRow}>
                <input
                  type="radio"
                  name="session"
                  value={session.id}
                  checked={selectedSessionId === session.id}
                  onChange={() => setSelectedSessionId(session.id)}
                  disabled={!rescheduleAllowed || submitting}
                  style={{ flexShrink: 0, marginTop: 3 }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={styles.value}>{formatSessionLabel(session)}</div>
                  <div style={styles.muted}>
                    {session.id === booking.session_id ? 'Current session' : `${session.available_spots} spot(s) available`}
                  </div>
                </div>
              </label>
            ))
          )}
          <div style={styles.buttons}>
            <button
              type="button"
              onClick={handleReschedule}
              disabled={!rescheduleAllowed || submitting || !selectedSessionId}
              style={{
                ...styles.button,
                ...styles.primary,
                opacity: !rescheduleAllowed || submitting || !selectedSessionId ? 0.6 : 1,
              }}
            >
              {rescheduleAllowed ? 'Reschedule Booking' : 'Online rescheduling unavailable'}
            </button>
          </div>
        </div>

        <div style={styles.buttons}>
          <button type="button" onClick={loadBooking} style={{ ...styles.button, ...styles.secondary }}>
            Refresh
          </button>
          <Link
            to={`/customer-portal/${businessId}/portal`}
            style={{ ...styles.button, ...styles.secondary, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
          >
            Return to portal
          </Link>
        </div>
      </div>
    </div>
  );
};

export default CustomerManageBookingPage;
