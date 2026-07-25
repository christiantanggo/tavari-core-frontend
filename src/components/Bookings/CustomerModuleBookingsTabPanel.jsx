// Rich Bookings-module view inside POS customer profile (embedded from Bookings dashboard).
import React, { useCallback, useEffect, useMemo, useState, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBookingDetailModal } from '../../contexts/BookingDetailModalContext';
import { ChevronDown, ChevronRight, Plus, RotateCcw, Trash2, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import bookingService from '../../services/Bookings/BookingService';
import bookingActivityService from '../../services/Bookings/BookingActivityService';
import { formatDateShort, formatDateTimeForBusiness, getBusinessTimezone } from '../../utils/businessDateFormat';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import { getParticipantDisplayName } from '../../helpers/Bookings/participantIdentity';
import BookingAdditionalItemModal from './BookingAdditionalItemModal';

const money = (n) => (Number(n) || 0).toFixed(2);

const sourceLabel = (s) => {
  const m = { app: 'Customer (app)', web: 'Customer (web)', kiosk: 'Kiosk', staff: 'Staff' };
  return m[s] || s || '—';
};

function timeInputValue(raw) {
  if (raw == null) return '';
  const t = String(raw);
  if (t.length >= 5) return t.slice(0, 5);
  return t;
}

/**
 * @param {Object} props
 * @param {string} props.customerId
 * @param {string} [props.focusBookingId]
 * @param {string} props.businessId
 * @param {import('react').CSSProperties} [props.style]
 */
export default function CustomerModuleBookingsTabPanel({ customerId, focusBookingId, businessId, style }) {
  const navigate = useNavigate();
  const { openBookingDetail } = useBookingDetailModal();
  const auth = usePOSAuth({ requireBusiness: true, componentName: 'CustomerModuleBookingsTabPanel' });
  const { hasPermission, hasElevatedPrivileges } = usePermissions();
  const canEdit = hasPermission('bookings.edit') || hasElevatedPrivileges();
  const businessTimezone = getBusinessTimezone(auth.businessData);

  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState([]);
  const [taxRows, setTaxRows] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set(focusBookingId ? [focusBookingId] : []));
  const [creatorNames, setCreatorNames] = useState({});

  const [addonModal, setAddonModal] = useState(null);
  const [restoringId, setRestoringId] = useState(null);

  const loadBookings = useCallback(async () => {
    if (!businessId || !customerId) return;
    setLoading(true);
    try {
      bookingService.setBusinessId(businessId);
      const rows = await bookingService.getBookings({ customerId });
      setBookings(Array.isArray(rows) ? rows : []);
    } catch (e) {
      console.error(e);
      toast.error(e?.message || 'Failed to load bookings');
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, [businessId, customerId]);

  const loadActivities = useCallback(async () => {
    if (!businessId) return;
    try {
      bookingActivityService.setBusinessId(businessId);
      const a = await bookingActivityService.getActivities({ activeOnly: true });
      setActivities(Array.isArray(a) ? a : []);
    } catch (e) {
      console.warn('Activities load failed', e);
      setActivities([]);
    }
  }, [businessId]);

  const loadTaxes = useCallback(async () => {
    if (!businessId) return;
    const { data, error } = await supabase
      .from('pos_tax_categories')
      .select('id, name, rate, category_type')
      .eq('business_id', businessId)
      .eq('is_active', true);
    if (error) {
      console.warn('Tax categories load failed', error);
      setTaxRows([]);
      return;
    }
    setTaxRows((data || []).filter((r) => r.category_type === 'tax'));
  }, [businessId]);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  useEffect(() => {
    void loadActivities();
    void loadTaxes();
  }, [loadActivities, loadTaxes]);

  useEffect(() => {
    if (focusBookingId) {
      setExpanded((prev) => new Set(prev).add(focusBookingId));
    }
  }, [focusBookingId]);

  useEffect(() => {
    if (!bookings.length) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      bookings.forEach((booking) => {
        if (booking.status === 'cancelled') next.add(booking.id);
      });
      return next;
    });
  }, [bookings]);

  const handleRestoreBooking = async (booking) => {
    if (!canEdit || !booking?.id || booking.status !== 'cancelled' || restoringId) return;
    if (!window.confirm('Restore this cancelled booking? The customer can pay their deposit and keep the reservation.')) {
      return;
    }
    setRestoringId(booking.id);
    try {
      bookingService.setBusinessId(businessId);
      await bookingService.restoreBooking(booking.id);
      toast.success('Booking restored');
      await loadBookings();
    } catch (e) {
      toast.error(e?.message || 'Could not restore booking');
    } finally {
      setRestoringId(null);
    }
  };

  const orderedBookings = useMemo(() => {
    const list = [...bookings];
    if (focusBookingId) {
      const i = list.findIndex((b) => b.id === focusBookingId);
      if (i > 0) {
        const [f] = list.splice(i, 1);
        list.unshift(f);
      }
    }
    return list;
  }, [bookings, focusBookingId]);

  const creatorIds = useMemo(() => {
    const ids = new Set();
    for (const b of bookings) {
      if (b.created_by) ids.add(b.created_by);
    }
    return [...ids];
  }, [bookings]);

  useEffect(() => {
    if (!creatorIds.length) {
      setCreatorNames({});
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', creatorIds.slice(0, 50));
      if (cancelled) return;
      if (error) {
        console.warn('[CustomerModuleBookingsTabPanel] created_by user lookup:', error.message);
        return;
      }
      const map = {};
      for (const u of data || []) {
        const fromName = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
        const label = fromName || (u.email && String(u.email).trim()) || u.id;
        map[u.id] = String(label).trim();
      }
      setCreatorNames(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [creatorIds]);

  const toggleExpand = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveBookingCore = async (booking, draft) => {
    bookingService.setBusinessId(businessId);
    await bookingService.updateBooking(booking.id, {
      activity_id: draft.activityId,
      booking_date: draft.bookingDate,
      booking_time: draft.bookingTime.length === 5 ? `${draft.bookingTime}:00` : draft.bookingTime
    });
    toast.success('Booking updated');
    await loadBookings();
  };

  if (!customerId) {
    return (
      <div style={{ padding: TavariStyles.spacing.md, color: TavariStyles.colors.gray600 }}>
        No customer selected.
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: TavariStyles.spacing.lg, color: TavariStyles.colors.gray600 }}>Loading bookings…</div>;
  }

  if (!orderedBookings.length) {
    return (
      <div style={{ padding: TavariStyles.spacing.md, color: TavariStyles.colors.gray600 }}>
        No module bookings for this customer yet.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: TavariStyles.spacing.md, ...style }}>
      {orderedBookings.map((booking, idx) => {
        const isFocus = idx === 0 && focusBookingId && booking.id === focusBookingId;
        const isOpen = expanded.has(booking.id);
        return (
          <div
            key={booking.id}
            style={{
              border: `1px solid ${booking.status === 'cancelled' ? '#fecaca' : TavariStyles.colors.gray200}`,
              borderRadius: TavariStyles.borderRadius.md,
              overflow: 'hidden',
              backgroundColor: booking.status === 'cancelled'
                ? '#fef2f2'
                : (isFocus ? TavariStyles.colors.gray50 : TavariStyles.colors.white),
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'stretch',
                gap: 8,
                padding: '12px 14px',
              }}
            >
              <button
                type="button"
                onClick={() => toggleExpand(booking.id)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 0,
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  font: 'inherit',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: TavariStyles.colors.gray900 }}>
                      {booking.booking_activities?.activity_name || 'Activity'}
                      {booking.booking_number ? (
                        <span style={{ fontWeight: 500, color: TavariStyles.colors.gray600, marginLeft: 8 }}>
                          #{booking.booking_number}
                        </span>
                      ) : null}
                      {booking.status === 'cancelled' ? (
                        <span style={{
                          marginLeft: 8,
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#b91c1c',
                          background: '#fee2e2',
                          border: '1px solid #fecaca',
                          borderRadius: 999,
                          padding: '2px 8px',
                          verticalAlign: 'middle',
                        }}>
                          Cancelled
                        </span>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 13, color: TavariStyles.colors.gray600 }}>
                      {booking.booking_date ? formatDateShort(booking.booking_date, businessTimezone) : '—'} ·{' '}
                      {timeInputValue(booking.booking_time) || '—'} · {String(booking.status || '')}
                    </div>
                    {booking.status === 'cancelled' && booking.cancellation_reason ? (
                      <div style={{ fontSize: 11, color: '#991b1b', marginTop: 2 }}>
                        {booking.cancellation_reason}
                      </div>
                    ) : null}
                  </div>
                </div>
                {isFocus ? (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: TavariStyles.colors.primary,
                      whiteSpace: 'nowrap',
                      marginLeft: 8,
                    }}
                  >
                    From messages
                  </span>
                ) : null}
              </button>
              {booking.status === 'cancelled' && canEdit ? (
                <button
                  type="button"
                  onClick={() => handleRestoreBooking(booking)}
                  disabled={restoringId === booking.id}
                  style={{
                    flexShrink: 0,
                    alignSelf: 'center',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: `1px solid ${TavariStyles.colors.primary}`,
                    background: '#ecfdf5',
                    color: TavariStyles.colors.primary,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: restoringId === booking.id ? 'wait' : 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <RotateCcw size={14} />
                  {restoringId === booking.id ? 'Restoring…' : 'Restore'}
                </button>
              ) : null}
            </div>

            {isOpen ? (
              <BookingCardBody
                booking={booking}
                businessId={businessId}
                activities={activities}
                taxRows={taxRows}
                canEdit={canEdit}
                businessTimezone={businessTimezone}
                creatorLabel={booking.created_by ? creatorNames[booking.created_by] : null}
                onSaveCore={saveBookingCore}
                onOpenAddonModal={() => setAddonModal(booking)}
                onDeleteAddonLine={async (lineId) => {
                  try {
                    bookingService.setBusinessId(businessId);
                    await bookingService.deleteBookingAddonItem(lineId);
                    toast.success('Line removed');
                    await loadBookings();
                  } catch (e) {
                    toast.error(e?.message || 'Could not remove line');
                  }
                }}
                onOpenFullBooking={() => openBookingDetail(booking.id, { onUpdated: loadBookings })}
                onRestore={() => handleRestoreBooking(booking)}
                restoring={restoringId === booking.id}
              />
            ) : null}
          </div>
        );
      })}

      {addonModal ? (
        <BookingAdditionalItemModal
          open
          bookingId={addonModal.id}
          taxRows={taxRows}
          businessId={businessId}
          onClose={() => setAddonModal(null)}
          onSaved={async () => {
            setAddonModal(null);
            await loadBookings();
          }}
        />
      ) : null}
    </div>
  );
}

const BookingCardBody = memo(function BookingCardBody({
  booking: b0,
  businessId,
  activities,
  taxRows,
  canEdit,
  businessTimezone,
  creatorLabel,
  onSaveCore,
  onOpenAddonModal,
  onDeleteAddonLine,
  onOpenFullBooking,
  onRestore,
  restoring = false,
}) {
  const activityOptions = useMemo(() => {
    const byId = new Map();
    for (const a of activities) {
      byId.set(a.id, a);
    }
    const bid = b0.activity_id;
    const nested = b0.booking_activities;
    if (bid && !byId.has(bid)) {
      byId.set(bid, {
        id: bid,
        activity_name: nested?.activity_name || 'Activity'
      });
    }
    return [...byId.values()];
  }, [activities, b0.activity_id, b0.booking_activities]);

  const [activityId, setActivityId] = useState(b0.activity_id || '');
  const [bookingDate, setBookingDate] = useState(b0.booking_date || '');
  const [bookingTime, setBookingTime] = useState(timeInputValue(b0.booking_time));
  const [saving, setSaving] = useState(false);

  const isCancelled = b0.status === 'cancelled';

  useEffect(() => {
    setActivityId(b0.activity_id || '');
    setBookingDate(b0.booking_date || '');
    setBookingTime(timeInputValue(b0.booking_time));
  }, [b0.id, b0.activity_id, b0.booking_date, b0.booking_time]);

  const participants = b0.booking_participants || [];

  const handleSave = async () => {
    if (!canEdit || isCancelled) return;
    setSaving(true);
    try {
      await onSaveCore(b0, {
        activityId,
        bookingDate,
        bookingTime
      });
    } catch (e) {
      toast.error(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = () => {
    if (!canEdit || !isCancelled || restoring) return;
    onRestore?.();
  };

  return (
    <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          onClick={onOpenFullBooking}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            borderRadius: 6,
            border: `1px solid ${TavariStyles.colors.gray300}`,
            background: TavariStyles.colors.white,
            fontSize: 13,
            cursor: 'pointer'
          }}
        >
          <ExternalLink size={14} /> Full booking page
        </button>
        {canEdit && isCancelled ? (
          <button
            type="button"
            onClick={handleRestore}
            disabled={restoring}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              borderRadius: 6,
              border: `1px solid ${TavariStyles.colors.primary}`,
              background: '#ecfdf5',
              color: TavariStyles.colors.primary,
              fontSize: 13,
              fontWeight: 700,
              cursor: restoring ? 'wait' : 'pointer'
            }}
          >
            <RotateCcw size={14} />
            {restoring ? 'Restoring…' : 'Restore booking'}
          </button>
        ) : null}
      </div>

      {isCancelled ? (
        <div style={{
          padding: '10px 12px',
          borderRadius: 8,
          background: '#fef2f2',
          border: '1px solid #fecaca',
          fontSize: 13,
          color: '#991b1b',
        }}>
          This booking is cancelled
          {b0.cancellation_reason ? `: ${b0.cancellation_reason}` : '.'}
          {' '}
          Restore it if the customer is ready to pay.
        </div>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          maxWidth: 520
        }}
      >
        <label style={lbl}>
          Activity
          <select
            value={activityId}
            onChange={(e) => setActivityId(e.target.value)}
            disabled={!canEdit || isCancelled}
            style={inp}
          >
            {activityOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.activity_name}
              </option>
            ))}
          </select>
        </label>
        <label style={lbl}>
          Booking ID
          <input readOnly value={b0.booking_number || b0.id?.slice(0, 8) || ''} style={{ ...inp, background: TavariStyles.colors.gray50 }} />
        </label>
        <label style={lbl}>
          Date
          <input
            type="date"
            value={bookingDate ? String(bookingDate).slice(0, 10) : ''}
            onChange={(e) => setBookingDate(e.target.value)}
            disabled={!canEdit || isCancelled}
            style={inp}
          />
        </label>
        <label style={lbl}>
          Time
          <input
            type="time"
            value={bookingTime}
            onChange={(e) => setBookingTime(e.target.value)}
            disabled={!canEdit || isCancelled}
            style={inp}
          />
        </label>
      </div>

      {canEdit && !isCancelled ? (
        <div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !activityId || !bookingDate}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: TavariStyles.colors.primary,
              color: '#fff',
              fontWeight: 600,
              cursor: saving ? 'wait' : 'pointer'
            }}
          >
            {saving ? 'Saving…' : 'Save activity & schedule'}
          </button>
        </div>
      ) : null}

      <section>
        <h4 style={h4}>Line items & add-ons</h4>
        <p style={hint}>Prices can be negative (adjustments). Taxes follow POS tax categories.</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: TavariStyles.colors.gray600 }}>
                <th style={th}>Description</th>
                <th style={th}>Qty</th>
                <th style={th}>Unit</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {(b0.booking_addon_items || []).map((row) => {
                const ad = row.booking_addons || {};
                const name = ad.addon_name || 'Add-on';
                return (
                  <tr key={row.id} style={{ borderTop: `1px solid ${TavariStyles.colors.gray200}` }}>
                    <td style={td}>
                      <div>{name}</div>
                      {ad.description ? (
                        <div style={{ fontSize: 11, color: TavariStyles.colors.gray500 }}>{ad.description}</div>
                      ) : null}
                    </td>
                    <td style={td}>{row.quantity}</td>
                    <td style={td}>${money(row.unit_price)}</td>
                    <td style={td}>
                      {canEdit && !isCancelled ? (
                        <button
                          type="button"
                          aria-label="Remove line"
                          onClick={() => onDeleteAddonLine(row.id)}
                          style={{
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            color: TavariStyles.colors.danger
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canEdit && !isCancelled ? (
          <button
            type="button"
            onClick={onOpenAddonModal}
            style={{
              marginTop: 8,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 6,
              border: `1px dashed ${TavariStyles.colors.primary}`,
              background: 'none',
              color: TavariStyles.colors.primary,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <Plus size={16} /> Add item
          </button>
        ) : null}
      </section>

      <section>
        <h4 style={h4}>Participants & waivers</h4>
        {participants.length === 0 ? (
          <p style={hint}>No participants on file.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {participants.map((p, i) => (
              <li key={p.id || i} style={{ marginBottom: 6 }}>
                <strong>{getParticipantDisplayName(p, i)}</strong>
                <span style={{ color: TavariStyles.colors.gray600 }}>
                  {' '}
                  — waiver: {p.waiver_status || '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h4 style={h4}>Provenance</h4>
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          <div>
            <strong>Source:</strong> {sourceLabel(b0.source)}
          </div>
          <div>
            <strong>Created:</strong>{' '}
            {b0.created_at ? formatDateTimeForBusiness(b0.created_at, businessTimezone) : '—'}
          </div>
          <div>
            <strong>Created by:</strong> {creatorLabel || (b0.created_by ? 'User' : '—')}
          </div>
          <div>
            <strong>Client IP:</strong> {b0.created_ip?.trim() || 'Not recorded'}
          </div>
        </div>
      </section>

      <section>
        <h4 style={h4}>Promotions</h4>
        <select disabled style={{ ...inp, maxWidth: 320, opacity: 0.7 }}>
          <option>Assign promotion (coming soon)</option>
        </select>
        <p style={hint}>Promo code from checkout is not on the bookings table yet—verify schema before showing.</p>
      </section>

      <section>
        <h4 style={h4}>Gift vouchers</h4>
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: TavariStyles.colors.gray50,
            color: TavariStyles.colors.gray600,
            fontSize: 13
          }}
        >
          Placeholder — voucher linking for bookings is not wired yet.
        </div>
      </section>
    </div>
  );
});

const lbl = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600, color: TavariStyles.colors.gray700 };
const inp = {
  padding: '8px 10px',
  borderRadius: 6,
  border: `1px solid ${TavariStyles.colors.gray300}`,
  fontSize: 14
};
const th = { padding: '6px 4px', fontSize: 13, fontWeight: 600 };
const td = { padding: '8px 4px', verticalAlign: 'top' };
const h4 = {
  margin: '0 0 6px',
  fontSize: 14,
  fontWeight: 700,
  color: TavariStyles.colors.gray900
};
const hint = { fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 0 };
