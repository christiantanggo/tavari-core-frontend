import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FiAlertTriangle, FiMail, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { getBookingAdultDisplayName } from '../../helpers/Bookings/participantIdentity';
import bookingPaymentService from '../../services/Bookings/BookingPaymentService';
import { TavariStyles } from '../../utils/TavariStyles';
import { formatDateShort, formatDateTimeForBusiness } from '../../utils/businessDateFormat';
import { formatBookingTimeRangeLabel } from '../../utils/bookingTimeRange';
import { PAYMENT_DASHBOARD_BUCKETS } from '../../utils/bookingPaymentDashboard';

dayjs.extend(utc);
dayjs.extend(timezone);

const SECTIONS = [
  {
    key: PAYMENT_DASHBOARD_BUCKETS.OVERDUE,
    title: 'Overdue payments',
    emptyText: 'No overdue deposits',
    accent: '#dc2626',
    accentBg: '#fef2f2',
    sendLabel: 'Payment overdue',
  },
  {
    key: PAYMENT_DASHBOARD_BUCKETS.PENDING,
    title: 'Pending payments',
    emptyText: 'No pending payments',
    accent: '#d97706',
    accentBg: '#fffbeb',
    sendLabel: 'Follow up',
  },
  {
    key: PAYMENT_DASHBOARD_BUCKETS.BALANCE_AFTER_PARTY,
    title: 'Balance due after party',
    emptyText: 'No post-party balances',
    accent: '#7c3aed',
    accentBg: '#f5f3ff',
    sendLabel: 'Pay immediately',
  },
];

function defaultCancelDeadlineLocal(businessTimezone) {
  const local = dayjs().tz(businessTimezone || 'America/Toronto').add(48, 'hour');
  return {
    localDate: local.format('YYYY-MM-DD'),
    localTime: local.format('HH:mm'),
  };
}

function localDeadlineToUtcIso(localDate, localTime, businessTimezone) {
  const tz = businessTimezone || 'America/Toronto';
  const parsed = dayjs.tz(`${localDate}T${localTime}`, tz);
  if (!parsed.isValid()) {
    throw new Error('Invalid cancel deadline date or time');
  }
  return parsed.toISOString();
}

export default function BookingPaymentFollowUpsModal({
  open,
  onClose,
  paymentQueues = {},
  businessTimezone,
  businessId,
  onSelectBooking,
  onEmailSent,
  isMobile = false,
}) {
  const [sendingKey, setSendingKey] = useState(null);
  const [cancelWarningBookingId, setCancelWarningBookingId] = useState(null);
  const [cancelDeadlineDate, setCancelDeadlineDate] = useState('');
  const [cancelDeadlineTime, setCancelDeadlineTime] = useState('');

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

  useEffect(() => {
    if (!open) {
      setSendingKey(null);
      setCancelWarningBookingId(null);
    }
  }, [open]);

  const timezoneLabel = useMemo(() => {
    try {
      return Intl.DateTimeFormat('en-CA', {
        timeZone: businessTimezone || 'America/Toronto',
        timeZoneName: 'short',
      })
        .formatToParts(new Date())
        .find((part) => part.type === 'timeZoneName')?.value || businessTimezone;
    } catch {
      return businessTimezone || 'Local time';
    }
  }, [businessTimezone]);

  if (!open) return null;

  const totalCount = SECTIONS.reduce(
    (sum, section) => sum + (paymentQueues[section.key]?.length || 0),
    0,
  );

  const openCancelWarningForm = (booking) => {
    const defaults = defaultCancelDeadlineLocal(businessTimezone);
    setCancelWarningBookingId(booking.id);
    setCancelDeadlineDate(defaults.localDate);
    setCancelDeadlineTime(defaults.localTime);
  };

  const handleSendFollowUp = async (event, booking, sectionKey) => {
    event.stopPropagation();
    if (!businessId || !booking?.id || sendingKey) return;

    const actionKey = `${booking.id}-followup`;
    setSendingKey(actionKey);
    try {
      bookingPaymentService.setBusinessId(businessId);
      await bookingPaymentService.sendPaymentFollowUp({
        bookingId: booking.id,
        followUpType: sectionKey,
      });
      toast.success('Follow-up email sent.');
      onEmailSent?.();
    } catch (err) {
      toast.error(err.message || 'Could not send follow-up email');
    } finally {
      setSendingKey(null);
    }
  };

  const handleSendCancelWarning = async (booking) => {
    if (!businessId || !booking?.id || sendingKey) return;
    if (!cancelDeadlineDate || !cancelDeadlineTime) {
      toast.error('Choose a cancel deadline date and time');
      return;
    }

    const actionKey = `${booking.id}-cancel-warning`;
    setSendingKey(actionKey);
    try {
      const cancelDeadlineAt = localDeadlineToUtcIso(
        cancelDeadlineDate,
        cancelDeadlineTime,
        businessTimezone,
      );
      if (new Date(cancelDeadlineAt).getTime() <= Date.now()) {
        throw new Error('Cancel deadline must be in the future');
      }

      bookingPaymentService.setBusinessId(businessId);
      await bookingPaymentService.sendPaymentCancelWarning({
        bookingId: booking.id,
        cancelDeadlineAt,
      });
      toast.success('Cancel warning sent. Booking will auto-cancel if unpaid by the deadline.');
      setCancelWarningBookingId(null);
      onEmailSent?.();
    } catch (err) {
      toast.error(err.message || 'Could not send cancel warning');
    } finally {
      setSendingKey(null);
    }
  };

  const renderActionButtons = (booking, section) => {
    const followUpKey = `${booking.id}-followup`;
    const cancelWarningKey = `${booking.id}-cancel-warning`;
    const isOverdue = section.key === PAYMENT_DASHBOARD_BUCKETS.OVERDUE;

    return (
      <div style={{
        flexShrink: 0,
        alignSelf: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}>
        <button
          type="button"
          onClick={(event) => handleSendFollowUp(event, booking, section.key)}
          disabled={!businessId || Boolean(sendingKey)}
          aria-label={`Send ${section.sendLabel} email`}
          title={booking.customer_email ? `Email ${booking.customer_email}` : 'No customer email on file'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: isMobile ? '8px 10px' : '8px 12px',
            border: `1px solid ${section.accent}`,
            borderRadius: '8px',
            background: section.accentBg,
            color: section.accent,
            fontSize: '13px',
            fontWeight: 700,
            cursor: !businessId || sendingKey ? 'wait' : 'pointer',
            opacity: !businessId ? 0.6 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          <FiMail size={14} />
          {sendingKey === followUpKey ? 'Sending…' : section.sendLabel}
        </button>
        {isOverdue ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (cancelWarningBookingId === booking.id) {
                setCancelWarningBookingId(null);
              } else {
                openCancelWarningForm(booking);
              }
            }}
            disabled={!businessId || Boolean(sendingKey)}
            aria-label="Send cancel warning email"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: isMobile ? '8px 10px' : '8px 12px',
              border: '1px solid #991b1b',
              borderRadius: '8px',
              background: cancelWarningBookingId === booking.id ? '#991b1b' : '#fff',
              color: cancelWarningBookingId === booking.id ? '#fff' : '#991b1b',
              fontSize: '13px',
              fontWeight: 700,
              cursor: !businessId || sendingKey ? 'wait' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <FiAlertTriangle size={14} />
            Cancel warning
          </button>
        ) : null}
      </div>
    );
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Payment follow-ups"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isMobile ? '8px' : '16px',
        zIndex: 1990,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: isMobile ? '100%' : 'min(720px, 96vw)',
          maxHeight: isMobile ? '92vh' : 'min(720px, 88vh)',
          display: 'flex',
          flexDirection: 'column',
          background: '#fff',
          borderRadius: isMobile ? '10px' : '12px',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.18)',
          overflow: 'hidden',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: isMobile ? '14px 16px' : '18px 22px',
          borderBottom: '1px solid #e5e7eb',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: isMobile ? '18px' : '20px', fontWeight: 700 }}>
              Payment follow-ups
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: TavariStyles.colors.gray600 }}>
              {totalCount} booking{totalCount === 1 ? '' : 's'} need attention
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: 'none',
              background: '#f3f4f6',
              borderRadius: '8px',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <FiX size={18} />
          </button>
        </div>

        <div style={{
          overflowY: 'auto',
          padding: isMobile ? '14px 16px' : '18px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          WebkitOverflowScrolling: 'touch',
        }}>
          {SECTIONS.map((section) => {
            const rows = paymentQueues[section.key] || [];
            return (
              <section key={section.key}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  marginBottom: '10px',
                }}>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
                    {section.title}
                  </h3>
                  <span style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    color: section.accent,
                    background: section.accentBg,
                    padding: '2px 8px',
                    borderRadius: '999px',
                  }}>
                    {rows.length}
                  </span>
                </div>
                {rows.length === 0 ? (
                  <p style={{ margin: 0, color: TavariStyles.colors.gray500, fontSize: '13px' }}>
                    {section.emptyText}
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {rows.map(({ booking, detailLabel }) => (
                      <div key={booking.id}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'stretch',
                            gap: '10px',
                            padding: '12px 14px',
                            border: '1px solid #e5e7eb',
                            borderRadius: cancelWarningBookingId === booking.id ? '8px 8px 0 0' : '8px',
                            background: '#fff',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => onSelectBooking?.(booking.id)}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              textAlign: 'left',
                              padding: 0,
                              border: 'none',
                              background: 'transparent',
                              cursor: 'pointer',
                            }}
                          >
                            <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '4px', color: '#111827' }}>
                              {getBookingAdultDisplayName(booking)}
                            </div>
                            <div style={{ color: TavariStyles.colors.gray600, fontSize: '13px', marginBottom: '2px' }}>
                              {booking.booking_activities?.activity_name || 'Activity'}
                            </div>
                            <div style={{ color: TavariStyles.colors.gray600, fontSize: '13px', marginBottom: '4px' }}>
                              {formatDateShort(booking.booking_date, businessTimezone)}
                              {' · '}
                              {formatBookingTimeRangeLabel(booking)}
                            </div>
                            {booking.booking_number ? (
                              <div style={{ color: TavariStyles.colors.gray500, fontSize: '13px', marginBottom: '4px' }}>
                                Booking #{booking.booking_number}
                              </div>
                            ) : null}
                            <div style={{ fontSize: '13px', fontWeight: 600, color: section.accent }}>
                              {detailLabel}
                            </div>
                            {booking.payment_cancel_deadline_at ? (
                              <div style={{ fontSize: '13px', color: '#991b1b', marginTop: '4px' }}>
                                Auto-cancel scheduled:{' '}
                                {formatDateTimeForBusiness(booking.payment_cancel_deadline_at, businessTimezone)}
                              </div>
                            ) : null}
                          </button>
                          {renderActionButtons(booking, section)}
                        </div>
                        {cancelWarningBookingId === booking.id ? (
                          <div style={{
                            padding: '12px 14px',
                            border: '1px solid #e5e7eb',
                            borderTop: 'none',
                            borderRadius: '0 0 8px 8px',
                            background: '#fef2f2',
                          }}>
                            <p style={{ margin: '0 0 10px', fontSize: '13px', color: '#7f1d1d' }}>
                              Customer will be emailed that the booking will be cancelled if payment is not received by this date and time ({timezoneLabel}).
                            </p>
                            <div style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '10px',
                              alignItems: 'flex-end',
                            }}>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600 }}>
                                Cancel if unpaid by (date)
                                <input
                                  type="date"
                                  value={cancelDeadlineDate}
                                  onChange={(event) => setCancelDeadlineDate(event.target.value)}
                                  style={{
                                    padding: '8px 10px',
                                    borderRadius: 6,
                                    border: '1px solid #fca5a5',
                                  }}
                                />
                              </label>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600 }}>
                                Time ({timezoneLabel})
                                <input
                                  type="time"
                                  value={cancelDeadlineTime}
                                  onChange={(event) => setCancelDeadlineTime(event.target.value)}
                                  style={{
                                    padding: '8px 10px',
                                    borderRadius: 6,
                                    border: '1px solid #fca5a5',
                                  }}
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => handleSendCancelWarning(booking)}
                                disabled={Boolean(sendingKey)}
                                style={{
                                  padding: '8px 14px',
                                  borderRadius: 8,
                                  border: 'none',
                                  background: '#991b1b',
                                  color: '#fff',
                                  fontWeight: 700,
                                  fontSize: 13,
                                  cursor: sendingKey ? 'wait' : 'pointer',
                                }}
                              >
                                {sendingKey === `${booking.id}-cancel-warning` ? 'Sending…' : 'Send cancel warning'}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
