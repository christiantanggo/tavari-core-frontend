// screens/Bookings/BookingsReceipts.jsx — booking deposits & payments list
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiExternalLink, FiRefreshCw } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { SecurityWrapper } from '../../Security';
import BookingPaymentRefundModal from '../../components/Bookings/BookingPaymentRefundModal';
import { TavariStyles } from '../../utils/TavariStyles';
import { formatDateTimeForBusiness, getBusinessTimezone } from '../../utils/businessDateFormat';

function paymentTypeLabel(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'deposit') return 'Deposit';
  if (t === 'full') return 'Full payment';
  if (t === 'custom') return 'Custom';
  if (t === 'refund') return 'Refund';
  return type || 'Payment';
}

function paymentMethodLabel(method) {
  const m = String(method || '').toLowerCase();
  if (m === 'helcim_hosted') return 'Online (Helcim)';
  if (m === 'helcim_card_on_file') return 'Card on file';
  if (m === 'manual' || m === 'manual_cash' || m === 'cash') return 'Manual / cash';
  if (m === 'manual_card' || m === 'card') return 'Manual / card';
  if (m === 'eft' || m === 'e-transfer') return 'E-transfer';
  return method || '—';
}

function bookerDisplayName(booking) {
  if (!booking) return 'Guest';
  const email = String(booking.customer_email ?? '').trim();
  if (email) return email.split('@')[0] || email;
  const phone = String(booking.customer_phone ?? '').trim();
  return phone || 'Guest';
}

function remainingRefundable(payment) {
  const paid = Number(payment?.amount_paid) || 0;
  const refunded = Number(payment?.refund_amount) || 0;
  return Math.max(0, Math.round((paid - refunded) * 100) / 100);
}

function canRefundPaymentRow(payment) {
  const status = String(payment?.status || '').toLowerCase();
  if (status === 'failed' || status === 'pending') return false;
  return remainingRefundable(payment) > 0.005;
}

const BookingsReceipts = () => {
  const navigate = useNavigate();
  const auth = usePOSAuth({
    requiredRoles: ['employee', 'manager', 'owner'],
    requireBusiness: true,
    componentName: 'BookingsReceipts',
  });

  const {
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading,
  } = usePermissions();

  const canView =
    hasAnyPermission([
      'pos.receipts.view',
      'bookings.view',
      'bookings.view_all',
    ]) || hasElevatedPrivileges();

  const canRefund =
    hasAnyPermission(['pos.sales.refund', 'payments.partial_refund']) ||
    hasElevatedPrivileges();

  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState('today');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [refundPayment, setRefundPayment] = useState(null);
  const [businessSettings, setBusinessSettings] = useState({});
  const businessTimezone = getBusinessTimezone();

  useEffect(() => {
    if (!auth.selectedBusinessId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', auth.selectedBusinessId)
        .maybeSingle();
      if (!cancelled && data) setBusinessSettings(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.selectedBusinessId]);

  const fetchPayments = useCallback(async () => {
    if (!auth.selectedBusinessId || !canView) return;

    setLoading(true);
    setError(null);
    try {
      let startDate = null;
      if (dateFilter === 'today') {
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
      } else if (dateFilter === 'week') {
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
      } else if (dateFilter === 'month') {
        startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 1);
      }

      let query = supabase
        .from('booking_payments')
        .select(
          `
          id,
          booking_id,
          payment_type,
          amount_paid,
          deposit_amount,
          remaining_balance,
          payment_method,
          status,
          transaction_id,
          sale_id,
          refund_amount,
          refund_reason,
          refunded_at,
          created_at,
          bookings!inner (
            id,
            business_id,
            booking_number,
            customer_email,
            customer_phone,
            booking_date,
            booking_time,
            payment_status,
            status,
            order_total,
            booking_activities:activity_id (
              activity_name
            )
          )
        `
        )
        .eq('bookings.business_id', auth.selectedBusinessId)
        .order('created_at', { ascending: false })
        .limit(200);

      if (startDate) {
        query = query.gte('created_at', startDate.toISOString());
      }

      const { data, error: fetchError } = await query;
      if (fetchError) throw fetchError;
      setPayments(data || []);
    } catch (err) {
      console.error('BookingsReceipts fetch error:', err);
      setError(err.message || 'Failed to load booking payments');
      setPayments([]);
    } finally {
      setLoading(false);
    }
  }, [auth.selectedBusinessId, canView, dateFilter]);

  useEffect(() => {
    if (auth.isReady && auth.selectedBusinessId && canView) {
      fetchPayments();
    }
  }, [auth.isReady, auth.selectedBusinessId, canView, fetchPayments]);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return (payments || []).filter((row) => {
      const booking = row.bookings;
      if (typeFilter !== 'all') {
        const pt = String(row.payment_type || '').toLowerCase();
        if (typeFilter === 'deposit' && pt !== 'deposit') return false;
        if (typeFilter === 'full' && pt !== 'full') return false;
        if (typeFilter === 'other' && (pt === 'deposit' || pt === 'full')) return false;
      }
      if (!term) return true;
      const hay = [
        booking?.booking_number,
        booking?.customer_email,
        booking?.customer_phone,
        booking?.booking_activities?.activity_name,
        row.payment_type,
        row.payment_method,
        row.transaction_id,
        row.amount_paid,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(term);
    });
  }, [payments, searchTerm, typeFilter]);

  const styles = {
    container: {
      padding: TavariStyles.spacing.xl,
      maxWidth: '1200px',
      margin: '0 auto',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.xl,
      flexWrap: 'wrap',
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: '700',
      color: TavariStyles.colors.gray900,
      margin: 0,
    },
    subtitle: {
      margin: '6px 0 0',
      color: TavariStyles.colors.gray600,
      fontSize: TavariStyles.typography.fontSize.sm,
    },
    filters: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      flexWrap: 'wrap',
      marginBottom: TavariStyles.spacing.lg,
      alignItems: 'center',
    },
    input: {
      ...TavariStyles.components?.form?.input,
      padding: '10px 12px',
      border: '1px solid #d1d5db',
      borderRadius: '8px',
      minWidth: '220px',
      fontSize: '14px',
    },
    select: {
      padding: '10px 12px',
      border: '1px solid #d1d5db',
      borderRadius: '8px',
      fontSize: '14px',
      backgroundColor: '#fff',
    },
    button: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '10px 14px',
      borderRadius: '8px',
      border: '1px solid #d1d5db',
      backgroundColor: '#fff',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: 600,
    },
    primaryButton: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '10px 14px',
      borderRadius: '8px',
      border: 'none',
      backgroundColor: TavariStyles.colors.primary,
      color: '#fff',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: 600,
    },
    dangerButton: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '10px 14px',
      borderRadius: '8px',
      border: 'none',
      backgroundColor: '#b91c1c',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: 600,
    },
    tableWrap: {
      backgroundColor: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: '12px',
      overflow: 'hidden',
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse',
    },
    th: {
      textAlign: 'left',
      padding: '12px 14px',
      fontSize: '13px',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      color: TavariStyles.colors.gray600,
      backgroundColor: '#f9fafb',
      borderBottom: '1px solid #e5e7eb',
    },
    td: {
      padding: '12px 14px',
      borderBottom: '1px solid #f3f4f6',
      fontSize: '14px',
      color: TavariStyles.colors.gray800,
      verticalAlign: 'top',
    },
    badge: {
      display: 'inline-block',
      padding: '3px 8px',
      borderRadius: '999px',
      fontSize: '13px',
      fontWeight: 600,
      backgroundColor: '#ecfeff',
      color: '#0f766e',
    },
    muted: {
      color: TavariStyles.colors.gray500,
      fontSize: '13px',
      marginTop: '2px',
    },
    empty: {
      padding: '40px 20px',
      textAlign: 'center',
      color: TavariStyles.colors.gray500,
    },
    error: {
      padding: '12px 16px',
      backgroundColor: '#fef2f2',
      color: '#991b1b',
      borderRadius: '8px',
      marginBottom: TavariStyles.spacing.lg,
    },
    modalOverlay: {
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0,0,0,0.45)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '16px',
    },
    modal: {
      backgroundColor: '#fff',
      borderRadius: '12px',
      padding: '24px',
      maxWidth: '480px',
      width: '100%',
      boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
    },
    modalRow: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '12px',
      marginBottom: '10px',
      fontSize: '14px',
    },
  };

  if (!permissionsLoading && !canView) {
    return (
      <SecurityWrapper>
        <POSAuthWrapper
          requiredRoles={['employee', 'manager', 'owner']}
          requireBusiness={true}
          componentName="Bookings Receipts"
        >
          <div style={styles.container}>
            <h3>Access Denied</h3>
            <p>You do not have permission to view booking receipts.</p>
          </div>
        </POSAuthWrapper>
      </SecurityWrapper>
    );
  }

  return (
    <SecurityWrapper>
      <POSAuthWrapper
        requiredRoles={['employee', 'manager', 'owner']}
        requireBusiness={true}
        componentName="Bookings Receipts"
      >
        <div style={styles.container}>
          <div style={styles.header}>
            <div>
              <h1 style={styles.title}>Bookings Receipts</h1>
              <p style={styles.subtitle}>
                Deposits and payments from bookings (day camp, parties, drop-in, etc.)
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                style={styles.button}
                onClick={() => navigate('/dashboard/pos/receipts')}
              >
                <FiArrowLeft size={16} />
                POS Receipts
              </button>
              <button type="button" style={styles.button} onClick={fetchPayments} disabled={loading}>
                <FiRefreshCw size={16} />
                Refresh
              </button>
            </div>
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <div style={styles.filters}>
            <input
              style={styles.input}
              type="search"
              placeholder="Search booking #, email, activity…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <select
              style={styles.select}
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
            >
              <option value="today">Today</option>
              <option value="week">Last 7 days</option>
              <option value="month">Last 30 days</option>
              <option value="all">All time</option>
            </select>
            <select
              style={styles.select}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="all">All types</option>
              <option value="deposit">Deposits only</option>
              <option value="full">Full payments</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Booking</th>
                  <th style={styles.th}>Customer</th>
                  <th style={styles.th}>Activity</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Method</th>
                  <th style={styles.th}>Amount</th>
                  <th style={styles.th} />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td style={styles.td} colSpan={8}>
                      Loading booking payments…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td style={styles.td} colSpan={8}>
                      <div style={styles.empty}>
                        No booking payments found for this filter.
                        {dateFilter === 'today'
                          ? ' Try “Last 7 days” if the payment was just after midnight UTC.'
                          : ''}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => {
                    const booking = row.bookings;
                    return (
                      <tr key={row.id}>
                        <td style={styles.td}>
                          {formatDateTimeForBusiness(row.created_at, businessTimezone)}
                        </td>
                        <td style={styles.td}>
                          <div>{booking?.booking_number || booking?.id?.slice(0, 8) || '—'}</div>
                          <div style={styles.muted}>{booking?.payment_status || ''}</div>
                        </td>
                        <td style={styles.td}>
                          <div>{bookerDisplayName(booking)}</div>
                          {booking?.customer_email ? (
                            <div style={styles.muted}>{booking.customer_email}</div>
                          ) : null}
                        </td>
                        <td style={styles.td}>
                          {booking?.booking_activities?.activity_name || '—'}
                        </td>
                        <td style={styles.td}>
                          <span style={styles.badge}>{paymentTypeLabel(row.payment_type)}</span>
                        </td>
                        <td style={styles.td}>{paymentMethodLabel(row.payment_method)}</td>
                        <td style={styles.td}>
                          <div>${parseFloat(row.amount_paid || 0).toFixed(2)}</div>
                          {Number(row.refund_amount) > 0 ? (
                            <div style={styles.muted}>
                              Refunded ${parseFloat(row.refund_amount).toFixed(2)}
                            </div>
                          ) : null}
                        </td>
                        <td style={styles.td}>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              style={styles.button}
                              onClick={() => setSelected(row)}
                            >
                              View
                            </button>
                            {canRefund && canRefundPaymentRow(row) ? (
                              <button
                                type="button"
                                style={styles.dangerButton}
                                onClick={() => setRefundPayment(row)}
                              >
                                Refund
                              </button>
                            ) : null}
                            <button
                              type="button"
                              style={styles.primaryButton}
                              onClick={() =>
                                navigate(`/dashboard/bookings/${booking?.id || row.booking_id}`)
                              }
                            >
                              <FiExternalLink size={14} />
                              Booking
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {selected && (
            <div style={styles.modalOverlay} onClick={() => setSelected(null)}>
              <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                <h2 style={{ marginTop: 0, marginBottom: '16px' }}>Booking payment</h2>
                <div style={styles.modalRow}>
                  <span>Date</span>
                  <strong>
                    {formatDateTimeForBusiness(selected.created_at, businessTimezone)}
                  </strong>
                </div>
                <div style={styles.modalRow}>
                  <span>Booking</span>
                  <strong>
                    {selected.bookings?.booking_number || selected.booking_id?.slice(0, 8)}
                  </strong>
                </div>
                <div style={styles.modalRow}>
                  <span>Customer</span>
                  <strong>{bookerDisplayName(selected.bookings)}</strong>
                </div>
                <div style={styles.modalRow}>
                  <span>Activity</span>
                  <strong>
                    {selected.bookings?.booking_activities?.activity_name || '—'}
                  </strong>
                </div>
                <div style={styles.modalRow}>
                  <span>Type</span>
                  <strong>{paymentTypeLabel(selected.payment_type)}</strong>
                </div>
                <div style={styles.modalRow}>
                  <span>Method</span>
                  <strong>{paymentMethodLabel(selected.payment_method)}</strong>
                </div>
                <div style={styles.modalRow}>
                  <span>Amount</span>
                  <strong>${parseFloat(selected.amount_paid || 0).toFixed(2)}</strong>
                </div>
                {Number(selected.refund_amount) > 0 ? (
                  <div style={styles.modalRow}>
                    <span>Already refunded</span>
                    <strong>${parseFloat(selected.refund_amount).toFixed(2)}</strong>
                  </div>
                ) : null}
                {canRefundPaymentRow(selected) ? (
                  <div style={styles.modalRow}>
                    <span>Refundable</span>
                    <strong>${remainingRefundable(selected).toFixed(2)}</strong>
                  </div>
                ) : null}
                <div style={styles.modalRow}>
                  <span>Status</span>
                  <strong>{selected.status || '—'}</strong>
                </div>
                {selected.transaction_id ? (
                  <div style={styles.modalRow}>
                    <span>Transaction</span>
                    <strong style={{ wordBreak: 'break-all' }}>{selected.transaction_id}</strong>
                  </div>
                ) : null}
                {selected.refund_reason ? (
                  <div style={styles.modalRow}>
                    <span>Refund reason</span>
                    <strong>{selected.refund_reason}</strong>
                  </div>
                ) : null}
                <div style={{ display: 'flex', gap: '8px', marginTop: '20px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button type="button" style={styles.button} onClick={() => setSelected(null)}>
                    Close
                  </button>
                  {canRefund && canRefundPaymentRow(selected) ? (
                    <button
                      type="button"
                      style={styles.dangerButton}
                      onClick={() => {
                        setRefundPayment(selected);
                        setSelected(null);
                      }}
                    >
                      Refund
                    </button>
                  ) : null}
                  <button
                    type="button"
                    style={styles.primaryButton}
                    onClick={() => {
                      const id = selected.bookings?.id || selected.booking_id;
                      setSelected(null);
                      navigate(`/dashboard/bookings/${id}`);
                    }}
                  >
                    Open booking
                  </button>
                </div>
              </div>
            </div>
          )}

          {refundPayment ? (
            <BookingPaymentRefundModal
              payment={refundPayment}
              businessId={auth.selectedBusinessId}
              businessSettings={businessSettings}
              authUser={auth.authUser}
              onClose={() => setRefundPayment(null)}
              onRefundCompleted={() => {
                setRefundPayment(null);
                fetchPayments();
              }}
            />
          ) : null}
        </div>
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default BookingsReceipts;
