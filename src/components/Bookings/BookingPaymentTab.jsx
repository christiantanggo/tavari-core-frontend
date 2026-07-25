import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import bookingPaymentService from '../../services/Bookings/BookingPaymentService';
import bookingService from '../../services/Bookings/BookingService';
import IndianStatusModal from './IndianStatusModal';
import { TavariStyles } from '../../utils/TavariStyles';
import { formatDateTimeForBusiness, getBusinessTimezone } from '../../utils/businessDateFormat';
import { formatBookingMoney, getEffectiveBookingPricingSummary } from '../../utils/bookingPricing';
import { isBookingIndianStatusActive } from '../../utils/bookingIndianStatus';
import { fetchPosBusinessSettings } from '../../utils/posSettingsQuery';
import {
  calculateOnlineCheckoutAmounts,
  parseOnlinePaymentSettings,
  bookingBlocksPaymentRequestUntilApproved,
} from '../../utils/bookingPaymentSettings';
import { BOOKING_HISTORY_ACTIONS } from '../../helpers/Bookings/bookingHistory';
import BookingPaymentStaffOutreach from './BookingPaymentStaffOutreach';

const REQUEST_TYPES = {
  DEPOSIT: 'deposit',
  FULL: 'full',
  CUSTOM: 'custom',
};

const cardStyle = {
  backgroundColor: '#fff',
  borderRadius: '12px',
  padding: '20px',
  border: '1px solid #e5e7eb',
  marginBottom: '16px',
};

const fieldLabelStyle = {
  fontSize: '13px',
  fontWeight: '600',
  color: TavariStyles.colors.gray600,
  marginBottom: '4px',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

function statusBadge(status) {
  const map = {
    pending: { bg: '#fef3c7', color: '#92400e', label: 'Pending' },
    paid: { bg: '#d1fae5', color: '#065f46', label: 'Paid' },
    cancelled: { bg: '#f3f4f6', color: '#6b7280', label: 'Cancelled' },
    superseded: { bg: '#f3f4f6', color: '#6b7280', label: 'Superseded' },
  };
  const style = map[status] || map.pending;
  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: '999px',
        fontSize: '13px',
        fontWeight: 600,
        backgroundColor: style.bg,
        color: style.color,
      }}
    >
      {style.label}
    </span>
  );
}

function requestTypeLabel(type) {
  if (type === REQUEST_TYPES.FULL) return 'Full payment';
  if (type === REQUEST_TYPES.CUSTOM) return 'Custom amount';
  return 'Deposit';
}

export default function BookingPaymentTab({ booking, businessId, onUpdated }) {
  const businessTimezone = getBusinessTimezone();
  const [requests, setRequests] = useState([]);
  const [senderNames, setSenderNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [resending, setResending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [recordingManual, setRecordingManual] = useState(false);
  const [manualPaymentModalOpen, setManualPaymentModalOpen] = useState(false);
  const [manualPaymentAmount, setManualPaymentAmount] = useState('');
  const [manualPaymentReference, setManualPaymentReference] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [requestType, setRequestType] = useState(REQUEST_TYPES.DEPOSIT);
  const [customAmount, setCustomAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [storedCard, setStoredCard] = useState(null);
  const [linkedHelcimCustomerCode, setLinkedHelcimCustomerCode] = useState('');
  const [helcimCustomerCodeInput, setHelcimCustomerCodeInput] = useState('');
  const [linkingHelcimCode, setLinkingHelcimCode] = useState(false);
  const [cardLoading, setCardLoading] = useState(false);
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeMode, setChargeMode] = useState('custom');
  const [charging, setCharging] = useState(false);
  const [indianStatusModalOpen, setIndianStatusModalOpen] = useState(false);
  const [indianStatusApplying, setIndianStatusApplying] = useState(false);
  const [indianStatusGstRate, setIndianStatusGstRate] = useState(0.05);
  const [indianStatusTaxLabel, setIndianStatusTaxLabel] = useState('GST (Indian Status)');

  const indianModeActive = isBookingIndianStatusActive(booking);
  const indianCertificate = (booking?.indian_status_certificate_number || '').trim();

  const pricing = useMemo(
    () => getEffectiveBookingPricingSummary(booking),
    [booking],
  );

  const onlinePayment = useMemo(
    () => parseOnlinePaymentSettings(booking?.booking_activities?.ticket_settings),
    [booking?.booking_activities?.ticket_settings],
  );

  const depositDefault = useMemo(() => {
    const orderTotal = Number(booking?.order_total) || pricing.totalPrice || 0;
    if (orderTotal <= 0) return 0;
    return calculateOnlineCheckoutAmounts(orderTotal, onlinePayment).chargeNow;
  }, [booking?.order_total, onlinePayment, pricing.totalPrice]);

  const balanceDue = pricing.totalDue;

  const resolvedChargeAmount = useMemo(() => {
    if (chargeMode === 'full') return balanceDue;
    const parsed = Number.parseFloat(chargeAmount);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [chargeMode, chargeAmount, balanceDue]);

  const suggestedAmount = useMemo(() => {
    if (requestType === REQUEST_TYPES.FULL) return balanceDue;
    if (requestType === REQUEST_TYPES.CUSTOM) {
      const parsed = Number.parseFloat(customAmount);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }
    const parsed = Number.parseFloat(customAmount);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return depositDefault;
  }, [requestType, balanceDue, customAmount, depositDefault]);

  const activeRequest = useMemo(
    () => requests.find((row) => row.status === 'pending') || null,
    [requests],
  );

  const legacyRequest = !activeRequest && booking?.payment_request_sent_at
    ? {
        id: 'legacy',
        status: 'pending',
        amount: depositDefault,
        request_type: REQUEST_TYPES.DEPOSIT,
        sent_at: booking.payment_request_sent_at,
        sent_by: booking.payment_request_sent_by,
        due_at: booking.deposit_due_at,
        legacy: true,
      }
    : null;

  const displayActiveRequest = activeRequest || legacyRequest;

  const loadStoredCard = useCallback(async () => {
    if (!businessId || !booking?.id || !booking?.customer_id) {
      setStoredCard(null);
      setLinkedHelcimCustomerCode('');
      return;
    }
    setCardLoading(true);
    try {
      bookingPaymentService.setBusinessId(businessId);
      const result = await bookingPaymentService.lookupStoredCard(booking.id);
      setStoredCard(result?.defaultCard || null);
      const code = String(result?.customerCode || result?.defaultCard?.customerCode || '').trim();
      setLinkedHelcimCustomerCode(code);
      if (code) {
        setHelcimCustomerCodeInput(code);
      }
    } catch (err) {
      console.warn('[BookingPaymentTab] stored card lookup:', err?.message);
      setStoredCard(null);
    } finally {
      setCardLoading(false);
    }
  }, [businessId, booking?.id, booking?.customer_id]);

  const handleLinkHelcimCustomerCode = async () => {
    if (!businessId || !booking?.customer_id) return;

    const customerCode = helcimCustomerCodeInput.trim();
    if (!customerCode) {
      toast.error('Enter a Helcim customer code (e.g. cst7926).');
      return;
    }

    setLinkingHelcimCode(true);
    try {
      bookingPaymentService.setBusinessId(businessId);
      const result = await bookingPaymentService.linkHelcimCustomerCode({
        customerId: booking.customer_id,
        customerCode,
      });
      const linkedCode = String(result?.customerCode || customerCode).trim();
      setLinkedHelcimCustomerCode(linkedCode);
      setHelcimCustomerCodeInput(linkedCode);
      setStoredCard(result?.defaultCard || null);
      if (result?.defaultCard?.maskedCard || result?.defaultCard?.lastFour) {
        toast.success('Helcim customer linked and card loaded.');
      } else {
        toast.success('Helcim customer linked. No default card found on that profile yet.');
      }
      await loadStoredCard();
    } catch (err) {
      toast.error(err.message || 'Could not link Helcim customer');
    } finally {
      setLinkingHelcimCode(false);
    }
  };

  const load = useCallback(async () => {
    if (!businessId || !booking?.id) return;
    setLoading(true);
    try {
      bookingPaymentService.setBusinessId(businessId);
      const rows = await bookingPaymentService.getPaymentRequests(booking.id);
      setRequests(rows);

      const userIds = [
        ...rows.map((row) => row.sent_by),
        ...rows.map((row) => row.cancelled_by),
        booking.payment_request_sent_by,
      ].filter(Boolean);

      if (userIds.length) {
        const { data: users } = await supabase
          .from('users')
          .select('id, email, first_name, last_name')
          .in('id', [...new Set(userIds)]);

        const map = {};
        for (const user of users || []) {
          const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
          map[user.id] = name || user.email || user.id;
        }
        setSenderNames(map);
      } else {
        setSenderNames({});
      }
    } catch (err) {
      toast.error(err.message || 'Failed to load payment requests');
    } finally {
      setLoading(false);
    }
  }, [businessId, booking?.id, booking?.payment_request_sent_by]);

  useEffect(() => {
    load();
    loadStoredCard();
  }, [load, loadStoredCard]);

  useEffect(() => {
    setHelcimCustomerCodeInput('');
    setLinkedHelcimCustomerCode('');
  }, [booking?.customer_id]);

  useEffect(() => {
    setChargeMode('custom');
    setChargeAmount('');
  }, [booking?.id]);

  useEffect(() => {
    if (chargeMode === 'full' && balanceDue > 0) {
      setChargeAmount(balanceDue.toFixed(2));
    }
  }, [chargeMode, balanceDue]);

  useEffect(() => {
    if (displayActiveRequest?.due_at) {
      const datePart = String(displayActiveRequest.due_at).slice(0, 10);
      setDueDate(datePart);
    } else if (booking?.deposit_due_at) {
      setDueDate(String(booking.deposit_due_at).slice(0, 10));
    }
  }, [displayActiveRequest?.due_at, booking?.deposit_due_at]);

  useEffect(() => {
    if (requestType === REQUEST_TYPES.DEPOSIT && depositDefault > 0) {
      setCustomAmount(depositDefault.toFixed(2));
    } else if (requestType === REQUEST_TYPES.FULL && balanceDue > 0) {
      setCustomAmount(balanceDue.toFixed(2));
    }
  }, [requestType, depositDefault, balanceDue]);

  const loadIndianStatusSettings = useCallback(async () => {
    if (!businessId) return;
    try {
      const { data, error } = await fetchPosBusinessSettings(
        businessId,
        'indian_status_gst_rate, indian_status_tax_label',
      );
      if (error) throw error;
      const gstR = parseFloat(data?.indian_status_gst_rate);
      if (Number.isFinite(gstR)) {
        setIndianStatusGstRate(Math.min(1, Math.max(0, gstR)));
      }
      const label = (data?.indian_status_tax_label || 'GST (Indian Status)').trim();
      if (label) setIndianStatusTaxLabel(label);
    } catch (err) {
      console.warn('[BookingPaymentTab] Indian status settings:', err?.message);
    }
  }, [businessId]);

  useEffect(() => {
    loadIndianStatusSettings();
  }, [loadIndianStatusSettings]);

  const getAuditContext = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return { updatedBy: user?.id || null };
  };

  const handleIndianStatusApply = async (certificateNumber) => {
    if (!businessId || !booking?.id) return;
    setIndianStatusApplying(true);
    try {
      bookingService.setBusinessId(businessId);
      const audit = await getAuditContext();
      await bookingService.applyIndianStatusToBooking(booking.id, certificateNumber, audit);
      toast.success('Indian Status (GST only) applied to this booking.');
      setIndianStatusModalOpen(false);
      onUpdated?.();
    } catch (err) {
      toast.error(err.message || 'Could not apply Indian Status');
    } finally {
      setIndianStatusApplying(false);
    }
  };

  const handleIndianStatusClear = async () => {
    if (!businessId || !booking?.id) return;
    setIndianStatusApplying(true);
    try {
      bookingService.setBusinessId(businessId);
      const audit = await getAuditContext();
      await bookingService.clearIndianStatusFromBooking(booking.id, audit);
      toast.success('Indian Status removed. Standard tax restored.');
      setIndianStatusModalOpen(false);
      onUpdated?.();
    } catch (err) {
      toast.error(err.message || 'Could not remove Indian Status');
    } finally {
      setIndianStatusApplying(false);
    }
  };

  const handleChargeCardOnFile = async () => {
    if (!booking?.id) return;
    const amount = resolvedChargeAmount;
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid charge amount.');
      return;
    }
    if (amount > balanceDue + 0.005) {
      toast.error(`Amount cannot exceed the remaining balance (${formatBookingMoney(balanceDue)}).`);
      return;
    }

    const cardLabel = storedCard?.maskedCard || storedCard?.lastFour
      ? `card ending in ${storedCard.lastFour || '****'}`
      : 'saved card';
    if (!window.confirm(`Charge ${formatBookingMoney(amount)} to the customer's ${cardLabel}?`)) {
      return;
    }

    setCharging(true);
    try {
      bookingPaymentService.setBusinessId(businessId);
      await bookingPaymentService.chargeCardOnFile({ bookingId: booking.id, amount });
      toast.success('Payment charged successfully.');
      if (chargeMode === 'custom') {
        setChargeAmount('');
      }
      await load();
      await loadStoredCard();
      onUpdated?.();
    } catch (err) {
      toast.error(err.message || 'Could not charge card on file');
    } finally {
      setCharging(false);
    }
  };

  const handleSend = async (resend = false) => {
    if (!businessId || !booking?.id) return;
    if (bookingBlocksPaymentRequestUntilApproved(booking)) {
      toast.error('Approve this booking before sending a payment request.');
      return;
    }
    if (balanceDue <= 0 && booking.payment_status === 'paid') {
      toast.error('This booking is already fully paid.');
      return;
    }

    const amount = suggestedAmount;
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid payment amount.');
      return;
    }
    if (amount > balanceDue + 0.005) {
      toast.error(`Amount cannot exceed the remaining balance (${formatBookingMoney(balanceDue)}).`);
      return;
    }

    setSending(true);
    try {
      await bookingPaymentService.sendPaymentRequest({
        bookingId: booking.id,
        requestType,
        amount: requestType === REQUEST_TYPES.CUSTOM || resend ? amount : undefined,
        dueAt: dueDate ? new Date(`${dueDate}T23:59:59`).toISOString() : null,
        resend,
      });
      toast.success(resend ? 'Payment request updated and sent.' : 'Payment request sent.');
      await load();
      onUpdated?.();
    } catch (err) {
      toast.error(err.message || 'Could not send payment request');
    } finally {
      setSending(false);
    }
  };

  const handleResendEmail = async () => {
    if (!businessId || !booking?.id || !displayActiveRequest) return;
    if (bookingBlocksPaymentRequestUntilApproved(booking)) {
      toast.error('Approve this booking before resending a payment request.');
      return;
    }

    const amount = Number(displayActiveRequest.amount) || 0;
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('No payment amount on the active request.');
      return;
    }
    if (amount > balanceDue + 0.005) {
      toast.error(`Amount cannot exceed the remaining balance (${formatBookingMoney(balanceDue)}).`);
      return;
    }

    const requestLabel = displayActiveRequest.request_type === REQUEST_TYPES.DEPOSIT
      ? 'deposit payment email'
      : 'payment email';
    if (!window.confirm(`Resend the ${requestLabel} to the customer with the same amount and due date?`)) {
      return;
    }

    setResending(true);
    try {
      bookingPaymentService.setBusinessId(businessId);
      await bookingPaymentService.sendPaymentRequest({
        bookingId: booking.id,
        requestType: displayActiveRequest.request_type || REQUEST_TYPES.DEPOSIT,
        amount,
        dueAt: displayActiveRequest.due_at || (dueDate ? new Date(`${dueDate}T23:59:59`).toISOString() : null),
        resend: true,
      });
      toast.success('Payment email resent to the customer.');
      await load();
      onUpdated?.();
    } catch (err) {
      toast.error(err.message || 'Could not resend payment email');
    } finally {
      setResending(false);
    }
  };

  const handleSyncPayment = async () => {
    if (!businessId || !booking?.id) return;
    setSyncing(true);
    try {
      bookingPaymentService.setBusinessId(businessId);
      const result = await bookingPaymentService.syncPendingHelcimPayments(booking.id);
      if (Number(result?.synced) > 0 || Number(result?.cardOnFileSynced) > 0) {
        toast.success('Payment found and applied to this booking.');
      } else if (result?.paymentStatusReconciled) {
        toast.success('Payment status updated from recorded payments.');
      } else if (result?.cardSynced) {
        toast.success('Saved card found and linked to this customer.');
      } else {
        toast.error('Helcim API did not return this payment yet. If the customer has a Helcim receipt, record it with Manual Payment.');
      }
      await load();
      onUpdated?.();
    } catch (err) {
      toast.error(err.message || 'Could not sync payment status');
    } finally {
      setSyncing(false);
    }
  };

  const openManualPaymentModal = () => {
    setManualPaymentAmount(balanceDue > 0 ? balanceDue.toFixed(2) : '');
    setManualPaymentReference('');
    setManualPaymentModalOpen(true);
  };

  const handleSubmitManualPayment = async () => {
    if (!businessId || !booking?.id) return;

    const amount = Number.parseFloat(manualPaymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid payment amount.');
      return;
    }
    if (amount > balanceDue + 0.005) {
      toast.error(`Amount cannot exceed the remaining balance (${formatBookingMoney(balanceDue)}).`);
      return;
    }

    if (
      !window.confirm(
        `Record a manual payment of ${formatBookingMoney(amount)} on this booking? Use this when the customer paid outside Tavari (cash, e-transfer, Helcim receipt, etc.).`,
      )
    ) {
      return;
    }

    setRecordingManual(true);
    try {
      bookingPaymentService.setBusinessId(businessId);

      let helcimInvoice = String(manualPaymentReference || '').trim() || null;
      if (!helcimInvoice) {
        const { data: pendingRows } = await supabase
          .from('booking_pending_helcim')
          .select('invoice_number, amount')
          .eq('booking_id', booking.id)
          .eq('business_id', businessId)
          .in('status', ['pending', 'completed'])
          .order('created_at', { ascending: false })
          .limit(5);
        const match = (pendingRows || []).find(
          (row) => Math.abs(Number(row.amount) - amount) < 0.011,
        );
        if (match?.invoice_number) helcimInvoice = match.invoice_number;
      }

      const linkedRequest = displayActiveRequest && !displayActiveRequest.legacy
        ? displayActiveRequest
        : null;
      const requestId = linkedRequest
        && amount >= Number(linkedRequest.amount) - 0.005
        ? linkedRequest.id
        : null;

      await bookingPaymentService.recordManualPayment({
        bookingId: booking.id,
        amount,
        transactionId: helcimInvoice,
        requestId,
      });

      bookingService.setBusinessId(businessId);
      await bookingService.logBookingHistoryEvent(
        booking.id,
        BOOKING_HISTORY_ACTIONS.PAYMENT_RECEIVED,
        `Payment received — $${amount.toFixed(2)}`,
        {
          changes: [{
            text: `Manual payment of $${amount.toFixed(2)} recorded${helcimInvoice ? ` (${helcimInvoice})` : ''}`,
          }],
        },
      );

      toast.success('Manual payment recorded on this booking.');
      setManualPaymentModalOpen(false);
      await load();
      onUpdated?.();
    } catch (err) {
      toast.error(err.message || 'Could not record payment');
    } finally {
      setRecordingManual(false);
    }
  };

  const handleCancel = async () => {
    if (!businessId || !booking?.id || !displayActiveRequest || displayActiveRequest.legacy) {
      toast.error('No active payment request to cancel.');
      return;
    }
    if (!window.confirm('Cancel this payment request? The customer will no longer be prompted to pay this amount.')) {
      return;
    }

    setCancelling(true);
    try {
      await bookingPaymentService.cancelPaymentRequest(booking.id, displayActiveRequest.id);
      toast.success('Payment request cancelled.');
      await load();
      onUpdated?.();
    } catch (err) {
      toast.error(err.message || 'Could not cancel payment request');
    } finally {
      setCancelling(false);
    }
  };

  const senderLabel = (userId) => {
    if (!userId) return 'System';
    return senderNames[userId] || 'Staff member';
  };

  if (loading) {
    return <div style={{ padding: 16, color: TavariStyles.colors.gray600 }}>Loading payment details…</div>;
  }

  const canSend = balanceDue > 0
    && booking?.status !== 'cancelled'
    && !bookingBlocksPaymentRequestUntilApproved(booking);

  const awaitingApproval = bookingBlocksPaymentRequestUntilApproved(booking);
  const canRecordManualPayment = balanceDue > 0 && booking?.status !== 'cancelled';

  return (
    <div>
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>Payment summary</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canRecordManualPayment ? (
              <button
                type="button"
                onClick={openManualPaymentModal}
                disabled={recordingManual}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: '1px solid #86efac',
                  backgroundColor: '#ecfdf5',
                  color: '#047857',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: recordingManual ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Manual Payment
              </button>
            ) : null}
            {booking?.status !== 'cancelled' && (
            <button
              type="button"
              onClick={() => setIndianStatusModalOpen(true)}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: indianModeActive ? `2px solid ${TavariStyles.colors.primary}` : '1px solid #d1d5db',
                backgroundColor: indianModeActive ? 'rgba(20, 184, 166, 0.12)' : '#fff',
                fontWeight: indianModeActive ? 700 : 600,
                fontSize: 13,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              title="Indian Status — charge GST only (enter certificate number)"
            >
              Indian Status (GST Only)
            </button>
            )}
          </div>
        </div>
        {indianModeActive && (
          <div
            style={{
              marginBottom: 16,
              padding: '12px 14px',
              borderRadius: 8,
              backgroundColor: '#ecfdf5',
              border: '1px solid #6ee7b7',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              Indian Status (GST only) — on this booking
            </div>
            <div>
              Certificate:
              {' '}
              <span style={{ fontFamily: 'monospace' }}>{indianCertificate}</span>
            </div>
            <div style={{ color: TavariStyles.colors.gray600, marginTop: 4 }}>
              Charging GST only at
              {' '}
              {(Math.min(1, Math.max(0, indianStatusGstRate)) * 100).toFixed(2)}
              %. Tap &quot;Indian Status (GST Only)&quot; to update or remove.
            </div>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
          <div>
            <div style={fieldLabelStyle}>Total</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{formatBookingMoney(pricing.totalPrice)}</div>
          </div>
          {pricing.taxAmount > 0 && (
            <div>
              <div style={fieldLabelStyle}>Tax</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {formatBookingMoney(pricing.taxAmount)}
                {indianModeActive ? ` (${indianStatusTaxLabel})` : ''}
              </div>
            </div>
          )}
          <div>
            <div style={fieldLabelStyle}>Paid</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#059669' }}>{formatBookingMoney(pricing.totalPaid)}</div>
          </div>
          <div>
            <div style={fieldLabelStyle}>Balance due</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: balanceDue > 0 ? '#dc2626' : '#059669' }}>
              {formatBookingMoney(balanceDue)}
            </div>
          </div>
          <div>
            <div style={fieldLabelStyle}>Payment status</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{booking.payment_status || 'unpaid'}</div>
          </div>
        </div>
      </div>

      {booking?.customer_id && (
        <div style={cardStyle}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 16px' }}>Saved payment method</h2>
          {cardLoading ? (
            <div style={{ color: TavariStyles.colors.gray600 }}>Looking up saved payment method…</div>
          ) : storedCard?.maskedCard || storedCard?.lastFour ? (
            <>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: balanceDue > 0 ? 16 : 0 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {storedCard.cardType
                    ? `${storedCard.cardType} ending in ${storedCard.lastFour}`
                    : `Card ending in ${storedCard.lastFour}`}
                </div>
                <div style={{ fontSize: 13, color: TavariStyles.colors.gray600 }}>
                  {storedCard.cardHolderName ? `${storedCard.cardHolderName} • ` : ''}
                  {storedCard.cardExpiry ? `Exp ${storedCard.cardExpiry} • ` : ''}
                  Stored in Helcim
                  {linkedHelcimCustomerCode ? ` • ${linkedHelcimCustomerCode}` : ''}
                </div>
              </div>
              {balanceDue > 0 && (
                <>
                  <p style={{ fontSize: 13, color: TavariStyles.colors.gray600, margin: '0 0 16px', lineHeight: 1.5 }}>
                    Charge any amount up to the remaining balance ({formatBookingMoney(balanceDue)}), or send a payment request below if the customer should pay themselves.
                  </p>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                    {[
                      { id: 'custom', label: 'Custom amount' },
                      { id: 'full', label: `Full balance (${formatBookingMoney(balanceDue)})` },
                    ].map((option) => (
                      <label
                        key={option.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '8px 12px',
                          borderRadius: 8,
                          border: chargeMode === option.id ? `2px solid ${TavariStyles.colors.primary}` : '1px solid #d1d5db',
                          cursor: 'pointer',
                          fontWeight: chargeMode === option.id ? 600 : 400,
                        }}
                      >
                        <input
                          type="radio"
                          name="chargeCardMode"
                          checked={chargeMode === option.id}
                          onChange={() => setChargeMode(option.id)}
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                  {chargeMode === 'custom' ? (
                    <div style={{ maxWidth: 220, marginBottom: 16 }}>
                      <label style={fieldLabelStyle} htmlFor="charge-card-amount">Amount to charge</label>
                      <input
                        id="charge-card-amount"
                        type="number"
                        min="0.01"
                        step="0.01"
                        max={balanceDue}
                        placeholder="e.g. 50.00"
                        value={chargeAmount}
                        onChange={(e) => setChargeAmount(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          borderRadius: 8,
                          border: '1px solid #d1d5db',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  ) : (
                    <div style={{ marginBottom: 16, fontSize: 15, fontWeight: 600 }}>
                      {formatBookingMoney(balanceDue)}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={handleChargeCardOnFile}
                      disabled={charging || resolvedChargeAmount <= 0}
                      style={{
                        padding: '12px 18px',
                        borderRadius: 8,
                        border: 'none',
                        background: '#059669',
                        color: '#fff',
                        fontWeight: 600,
                        cursor: charging || resolvedChargeAmount <= 0 ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {charging
                        ? 'Processing…'
                        : resolvedChargeAmount > 0
                          ? `Charge ${formatBookingMoney(resolvedChargeAmount)}`
                          : 'Enter amount to charge'}
                    </button>
                    <button
                      type="button"
                      onClick={loadStoredCard}
                      disabled={cardLoading || charging}
                      style={{
                        padding: '12px 18px',
                        borderRadius: 8,
                        border: '1px solid #d1d5db',
                        background: '#fff',
                        fontWeight: 600,
                        cursor: cardLoading || charging ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Refresh card
                    </button>
                  </div>
                </>
              )}
              {balanceDue <= 0 && (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={loadStoredCard}
                    disabled={cardLoading}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 8,
                      border: '1px solid #d1d5db',
                      background: '#fff',
                      fontWeight: 600,
                      cursor: cardLoading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Refresh card
                  </button>
                </div>
              )}
            </>
          ) : (
            <div style={{ color: TavariStyles.colors.gray600, lineHeight: 1.6 }}>
              No saved payment method found for this customer. The card is stored in Helcim when the customer pays online
              (portal checkout or deposit payment link), or you can link an existing Helcim profile below.
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  onClick={loadStoredCard}
                  disabled={cardLoading}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid #d1d5db',
                    background: '#fff',
                    fontWeight: 600,
                    cursor: cardLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {cardLoading ? 'Checking…' : 'Check again'}
                </button>
              </div>
            </div>
          )}

          <div
            style={{
              marginTop: 20,
              paddingTop: 20,
              borderTop: '1px solid #e5e7eb',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: TavariStyles.colors.gray900, marginBottom: 6 }}>
              Link existing Helcim profile
            </div>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: TavariStyles.colors.gray600, lineHeight: 1.5 }}>
              If this customer already has a card on file in Helcim, paste their customer code here (e.g. cst7926).
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 180px', maxWidth: 280 }}>
                <label style={fieldLabelStyle} htmlFor="helcim-customer-code-input">
                  Helcim customer code
                </label>
                <input
                  id="helcim-customer-code-input"
                  type="text"
                  placeholder="cst7926"
                  value={helcimCustomerCodeInput}
                  onChange={(e) => setHelcimCustomerCodeInput(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #d1d5db',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <button
                type="button"
                onClick={handleLinkHelcimCustomerCode}
                disabled={linkingHelcimCode || cardLoading || !helcimCustomerCodeInput.trim()}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: TavariStyles.colors.primary,
                  color: '#fff',
                  fontWeight: 600,
                  cursor: linkingHelcimCode || cardLoading || !helcimCustomerCodeInput.trim()
                    ? 'not-allowed'
                    : 'pointer',
                  opacity: linkingHelcimCode || cardLoading || !helcimCustomerCodeInput.trim() ? 0.7 : 1,
                }}
              >
                {linkingHelcimCode ? 'Linking…' : 'Link & load card'}
              </button>
            </div>
            {linkedHelcimCustomerCode ? (
              <div style={{ marginTop: 10, fontSize: 13, color: '#047857', fontWeight: 600 }}>
                Linked: {linkedHelcimCustomerCode}
              </div>
            ) : null}
          </div>
        </div>
      )}

      <div style={cardStyle}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 16px' }}>Payment request</h2>

        {displayActiveRequest ? (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ fontWeight: 600 }}>Active request</div>
              {statusBadge(displayActiveRequest.status)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div>
                <div style={fieldLabelStyle}>Type</div>
                <div>{requestTypeLabel(displayActiveRequest.request_type)}</div>
              </div>
              <div>
                <div style={fieldLabelStyle}>Amount</div>
                <div style={{ fontWeight: 600 }}>{formatBookingMoney(displayActiveRequest.amount)}</div>
              </div>
              <div>
                <div style={fieldLabelStyle}>Sent</div>
                <div>
                  {displayActiveRequest.sent_at
                    ? formatDateTimeForBusiness(displayActiveRequest.sent_at, businessTimezone)
                    : '—'}
                </div>
              </div>
              <div>
                <div style={fieldLabelStyle}>Sent by</div>
                <div>{senderLabel(displayActiveRequest.sent_by)}</div>
              </div>
              <div>
                <div style={fieldLabelStyle}>Due by</div>
                <div>
                  {displayActiveRequest.due_at
                    ? formatDateTimeForBusiness(displayActiveRequest.due_at, businessTimezone)
                    : '—'}
                </div>
              </div>
            </div>
            {!displayActiveRequest.legacy && (
              <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handleSyncPayment}
                  disabled={syncing || resending || sending}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid #d1d5db',
                    background: '#fff',
                    color: TavariStyles.colors.gray900,
                    fontWeight: 600,
                    cursor: syncing || resending || sending ? 'not-allowed' : 'pointer',
                  }}
                >
                  {syncing ? 'Checking…' : 'Check for received payment'}
                </button>
                <button
                  type="button"
                  onClick={handleResendEmail}
                  disabled={resending || sending || balanceDue <= 0 || booking?.status === 'cancelled'}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: 'none',
                    background: TavariStyles.colors.primary,
                    color: '#fff',
                    fontWeight: 600,
                    cursor: resending || sending || balanceDue <= 0 || booking?.status === 'cancelled'
                      ? 'not-allowed'
                      : 'pointer',
                  }}
                >
                  {resending
                    ? 'Sending…'
                    : displayActiveRequest.request_type === REQUEST_TYPES.DEPOSIT
                      ? 'Resend deposit email'
                      : 'Resend payment email'}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={cancelling}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid #fca5a5',
                    background: '#fff',
                    color: '#dc2626',
                    fontWeight: 600,
                    cursor: cancelling ? 'not-allowed' : 'pointer',
                  }}
                >
                  {cancelling ? 'Cancelling…' : 'Cancel request'}
                </button>
              </div>
            )}
            {displayActiveRequest.legacy && balanceDue > 0 && booking?.status !== 'cancelled' && !awaitingApproval && (
              <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handleSyncPayment}
                  disabled={syncing || resending || sending}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid #d1d5db',
                    background: '#fff',
                    color: TavariStyles.colors.gray900,
                    fontWeight: 600,
                    cursor: syncing || resending || sending ? 'not-allowed' : 'pointer',
                  }}
                >
                  {syncing ? 'Checking…' : 'Check for received payment'}
                </button>
                <button
                  type="button"
                  onClick={handleResendEmail}
                  disabled={resending || sending}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: 'none',
                    background: TavariStyles.colors.primary,
                    color: '#fff',
                    fontWeight: 600,
                    cursor: resending || sending ? 'not-allowed' : 'pointer',
                  }}
                >
                  {resending ? 'Sending…' : 'Resend deposit email'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: TavariStyles.colors.gray600, marginBottom: 16 }}>
            No payment request has been sent yet.
          </div>
        )}

        {awaitingApproval && (
          <div
            style={{
              marginBottom: 16,
              padding: '12px 14px',
              borderRadius: 8,
              backgroundColor: '#fef3c7',
              border: '1px solid #fde047',
              color: '#854d0e',
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            This booking is waiting for staff approval. Payment requests can be sent after the booking is approved
            (approval automatically sends the deposit request when configured).
          </div>
        )}

        {canSend && (
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>
              {displayActiveRequest ? 'Send updated request' : 'Send payment request'}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
              {[
                { id: REQUEST_TYPES.DEPOSIT, label: 'Deposit' },
                { id: REQUEST_TYPES.FULL, label: 'Full balance' },
                { id: REQUEST_TYPES.CUSTOM, label: 'Custom amount' },
              ].map((option) => (
                <label
                  key={option.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: requestType === option.id ? `2px solid ${TavariStyles.colors.primary}` : '1px solid #d1d5db',
                    cursor: 'pointer',
                    fontWeight: requestType === option.id ? 600 : 400,
                  }}
                >
                  <input
                    type="radio"
                    name="paymentRequestType"
                    checked={requestType === option.id}
                    onChange={() => setRequestType(option.id)}
                  />
                  {option.label}
                </label>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={fieldLabelStyle} htmlFor="payment-request-amount">Amount</label>
                <input
                  id="payment-request-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  disabled={requestType === REQUEST_TYPES.FULL}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #d1d5db',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={fieldLabelStyle} htmlFor="payment-request-due">Due date</label>
                <input
                  id="payment-request-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #d1d5db',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleSend(!!displayActiveRequest)}
              disabled={sending}
              style={{
                padding: '12px 18px',
                borderRadius: 8,
                border: 'none',
                background: TavariStyles.colors.primary,
                color: '#fff',
                fontWeight: 600,
                cursor: sending ? 'not-allowed' : 'pointer',
              }}
            >
              {sending
                ? 'Sending…'
                : displayActiveRequest
                  ? 'Update amount & resend'
                  : 'Send payment request'}
            </button>
          </div>
        )}
      </div>

      <BookingPaymentStaffOutreach
        booking={booking}
        businessId={businessId}
        businessTimezone={businessTimezone}
        balanceDue={balanceDue}
        disabled={awaitingApproval}
        onUpdated={onUpdated}
      />

      {booking.booking_payments?.length > 0 && (
        <div style={cardStyle}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 16px' }}>Payment history</h2>
          {booking.booking_payments.map((payment) => (
            <div
              key={payment.id}
              style={{
                padding: '12px',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                marginBottom: 8,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>
                  {formatBookingMoney(payment.amount_paid)} — {payment.payment_method === 'helcim_card_on_file' ? 'Helcim card on file' : payment.payment_method}
                </div>
                <div style={{ fontSize: 13, color: TavariStyles.colors.gray600 }}>
                  {formatDateTimeForBusiness(payment.created_at, businessTimezone)}
                </div>
              </div>
              {statusBadge(payment.status === 'completed' ? 'paid' : 'cancelled')}
            </div>
          ))}
        </div>
      )}

      {requests.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 0 }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 16px' }}>Request history</h2>
          {requests.map((row) => (
            <div
              key={row.id}
              style={{
                padding: '12px',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                marginBottom: 8,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <div>
                <div style={fieldLabelStyle}>Type</div>
                <div>{requestTypeLabel(row.request_type)}</div>
              </div>
              <div>
                <div style={fieldLabelStyle}>Amount</div>
                <div>{formatBookingMoney(row.amount)}</div>
              </div>
              <div>
                <div style={fieldLabelStyle}>Sent</div>
                <div>{row.sent_at ? formatDateTimeForBusiness(row.sent_at, businessTimezone) : '—'}</div>
              </div>
              <div>
                <div style={fieldLabelStyle}>By</div>
                <div>{senderLabel(row.sent_by)}</div>
              </div>
              <div>{statusBadge(row.status)}</div>
            </div>
          ))}
        </div>
      )}

      <IndianStatusModal
        open={indianStatusModalOpen}
        onClose={() => !indianStatusApplying && setIndianStatusModalOpen(false)}
        gstRate={indianStatusGstRate}
        taxLabel={indianStatusTaxLabel}
        active={indianModeActive}
        initialCertificate={indianCertificate}
        onApply={handleIndianStatusApply}
        onClear={handleIndianStatusClear}
        applying={indianStatusApplying}
      />

      {manualPaymentModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="manual-payment-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(17, 24, 39, 0.45)',
            zIndex: 10050,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
          onClick={() => {
            if (!recordingManual) setManualPaymentModalOpen(false);
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 460,
              backgroundColor: '#fff',
              borderRadius: 12,
              padding: 24,
              boxShadow: '0 20px 40px rgba(0,0,0,0.18)',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="manual-payment-title" style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>
              Manual Payment
            </h2>
            <p style={{ margin: '0 0 16px', fontSize: 14, color: TavariStyles.colors.gray600, lineHeight: 1.5 }}>
              Record a payment received outside Tavari — cash, e-transfer, terminal receipt, or any other method.
              Remaining balance: {formatBookingMoney(balanceDue)}.
            </p>
            <div style={{ marginBottom: 16 }}>
              <label style={fieldLabelStyle} htmlFor="manual-payment-amount">Amount</label>
              <input
                id="manual-payment-amount"
                type="number"
                min="0.01"
                step="0.01"
                max={balanceDue}
                value={manualPaymentAmount}
                onChange={(event) => setManualPaymentAmount(event.target.value)}
                disabled={recordingManual}
                autoFocus
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid #d1d5db',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={fieldLabelStyle} htmlFor="manual-payment-reference">Reference (optional)</label>
              <input
                id="manual-payment-reference"
                type="text"
                value={manualPaymentReference}
                onChange={(event) => setManualPaymentReference(event.target.value)}
                disabled={recordingManual}
                placeholder="Helcim invoice, e-transfer ref, etc."
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid #d1d5db',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setManualPaymentModalOpen(false)}
                disabled={recordingManual}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid #d1d5db',
                  background: '#fff',
                  fontWeight: 600,
                  cursor: recordingManual ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitManualPayment}
                disabled={recordingManual}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#059669',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: recordingManual ? 'not-allowed' : 'pointer',
                }}
              >
                {recordingManual ? 'Recording…' : 'Record payment'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
