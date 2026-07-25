import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import bookingPaymentService from '../../services/Bookings/BookingPaymentService';
import { TavariStyles } from '../../utils/TavariStyles';
import { formatBookingMoney } from '../../utils/bookingPricing';

dayjs.extend(utc);
dayjs.extend(timezone);

export default function BookingPaymentStaffOutreach({
  booking,
  businessId,
  businessTimezone,
  balanceDue,
  disabled = false,
  onUpdated,
}) {
  const [sending, setSending] = useState(null);
  const [cancelDeadlineDate, setCancelDeadlineDate] = useState('');
  const [cancelDeadlineTime, setCancelDeadlineTime] = useState('');

  const defaultDeadline = useMemo(() => {
    const local = dayjs().tz(businessTimezone || 'America/Toronto').add(48, 'hour');
    return { date: local.format('YYYY-MM-DD'), time: local.format('HH:mm') };
  }, [businessTimezone]);

  const sendFollowUp = async (followUpType) => {
    if (!businessId || !booking?.id || disabled) return;
    setSending(followUpType);
    try {
      bookingPaymentService.setBusinessId(businessId);
      await bookingPaymentService.sendPaymentFollowUp({ bookingId: booking.id, followUpType });
      toast.success('Follow-up email sent');
      onUpdated?.();
    } catch (err) {
      toast.error(err?.message || 'Could not send follow-up');
    } finally {
      setSending(null);
    }
  };

  const sendCancelWarning = async () => {
    if (!businessId || !booking?.id || disabled) return;
    const date = cancelDeadlineDate || defaultDeadline.date;
    const time = cancelDeadlineTime || defaultDeadline.time;
    const tz = businessTimezone || 'America/Toronto';
    const parsed = dayjs.tz(`${date}T${time}`, tz);
    if (!parsed.isValid()) {
      toast.error('Enter a valid cancel deadline');
      return;
    }
    if (!parsed.isAfter(dayjs())) {
      toast.error('Cancel deadline must be in the future');
      return;
    }

    setSending('cancel_warning');
    try {
      bookingPaymentService.setBusinessId(businessId);
      await bookingPaymentService.sendPaymentCancelWarning({
        bookingId: booking.id,
        cancelDeadlineAt: parsed.toISOString(),
      });
      toast.success('Cancel warning sent');
      onUpdated?.();
    } catch (err) {
      toast.error(err?.message || 'Could not send cancel warning');
    } finally {
      setSending(null);
    }
  };

  if (balanceDue <= 0.005 || booking?.payment_status === 'paid') {
    return null;
  }

  return (
    <div style={{
      backgroundColor: '#fff',
      borderRadius: 12,
      padding: 20,
      border: '1px solid #e5e7eb',
      marginBottom: 16,
    }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>Payment follow-ups</h2>
      <p style={{ margin: '0 0 16px', color: TavariStyles.colors.gray600, fontSize: 14, lineHeight: 1.5 }}>
        Send overdue, pending, or post-party balance reminders. Use cancel warning to set an automatic cancellation deadline.
        Balance due: {formatBookingMoney(balanceDue)}.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {[
          { key: 'overdue', label: 'Payment overdue' },
          { key: 'pending', label: 'Follow up' },
          { key: 'balance_after_party', label: 'Pay immediately' },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            disabled={disabled || Boolean(sending)}
            onClick={() => sendFollowUp(item.key)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              background: '#fff',
              fontWeight: 600,
              fontSize: 13,
              cursor: disabled || sending ? 'not-allowed' : 'pointer',
            }}
          >
            {sending === item.key ? 'Sending…' : item.label}
          </button>
        ))}
      </div>
      <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>Cancel warning</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 10 }}>
          <input
            type="date"
            value={cancelDeadlineDate || defaultDeadline.date}
            onChange={(e) => setCancelDeadlineDate(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d5db' }}
          />
          <input
            type="time"
            value={cancelDeadlineTime || defaultDeadline.time}
            onChange={(e) => setCancelDeadlineTime(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d5db' }}
          />
        </div>
        <button
          type="button"
          disabled={disabled || Boolean(sending)}
          onClick={sendCancelWarning}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #fecaca',
            background: '#fef2f2',
            color: '#b91c1c',
            fontWeight: 700,
            fontSize: 13,
            cursor: disabled || sending ? 'not-allowed' : 'pointer',
          }}
        >
          {sending === 'cancel_warning' ? 'Sending…' : 'Send cancel warning'}
        </button>
      </div>
    </div>
  );
}
