import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FiChevronDown, FiChevronRight, FiClock, FiUser } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import bookingService from '../../services/Bookings/BookingService';
import { TavariStyles } from '../../utils/TavariStyles';
import {
  formatHistoryActionLabel,
  formatHistoryTimestamp,
  getHistoryChangeLines,
  resolveHistoryActorLabel,
} from '../../helpers/Bookings/bookingHistory';

const cardStyle = {
  backgroundColor: 'white',
  padding: '24px',
  borderRadius: '12px',
  border: '1px solid #e5e7eb',
  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
};

const BookingHistoryTab = ({
  booking,
  businessId,
  businessTimezone,
  refreshKey = 0,
}) => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userNames, setUserNames] = useState({});
  const [expandedId, setExpandedId] = useState(null);

  const bookingId = booking?.id;

  const loadHistory = useCallback(async () => {
    if (!bookingId || !businessId) return;
    setLoading(true);
    try {
      bookingService.setBusinessId(businessId);
      const rows = await bookingService.listBookingHistory(bookingId, booking);
      setEntries(rows || []);
    } catch (error) {
      console.error('Error loading booking history:', error);
      toast.error('Could not load history');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [booking, bookingId, businessId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory, refreshKey]);

  const userIds = useMemo(() => {
    const ids = new Set();
    for (const entry of entries) {
      if (entry.changed_by) ids.add(entry.changed_by);
    }
    if (booking?.created_by) ids.add(booking.created_by);
    return [...ids];
  }, [entries, booking?.created_by]);

  useEffect(() => {
    if (!userIds.length) {
      setUserNames({});
      return undefined;
    }

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .in('id', userIds);

      if (cancelled) return;

      if (error) {
        console.warn('Could not load history user names:', error);
        setUserNames({});
        return;
      }

      const map = {};
      for (const user of data || []) {
        const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
        map[user.id] = name || user.email || 'Staff user';
      }
      setUserNames(map);
    })();

    return () => {
      cancelled = true;
    };
  }, [userIds]);

  if (loading) {
    return (
      <div style={cardStyle}>
        <p style={{ margin: 0, color: TavariStyles.colors.gray600 }}>Loading history…</p>
      </div>
    );
  }

  if (!entries.length) {
    return (
      <div style={cardStyle}>
        <h2 style={{ fontSize: '20px', fontWeight: '600', marginTop: 0, marginBottom: '8px' }}>
          History
        </h2>
        <p style={{ margin: 0, color: TavariStyles.colors.gray600 }}>
          No changes recorded for this booking yet.
        </p>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <h2 style={{ fontSize: '20px', fontWeight: '600', marginTop: 0, marginBottom: '16px' }}>
        History
      </h2>
      <p style={{ margin: '0 0 20px', color: TavariStyles.colors.gray600, fontSize: '14px' }}>
        Every change to this booking is listed below, newest first.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {entries.map((entry) => {
          const isExpanded = expandedId === entry.id;
          const actor = resolveHistoryActorLabel(entry, userNames);
          const timestamp = formatHistoryTimestamp(entry.created_at, businessTimezone);
          const actionLabel = formatHistoryActionLabel(entry.action_type);
          const changeLines = getHistoryChangeLines(entry);

          return (
            <div
              key={entry.id}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: '10px',
                overflow: 'hidden',
                background: isExpanded ? '#f9fafb' : '#fff',
              }}
            >
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '14px 16px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ color: TavariStyles.colors.gray500, flexShrink: 0 }}>
                  {isExpanded ? <FiChevronDown size={18} /> : <FiChevronRight size={18} />}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: 'block',
                      fontWeight: '700',
                      fontSize: '14px',
                      color: TavariStyles.colors.gray900,
                      marginBottom: '4px',
                    }}
                  >
                    {entry.summary || actionLabel}
                  </span>
                  <span
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '12px',
                      fontSize: '13px',
                      color: TavariStyles.colors.gray600,
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <FiUser size={12} />
                      {actor}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <FiClock size={12} />
                      {timestamp}
                    </span>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '999px',
                        background: '#eef2ff',
                        color: '#4338ca',
                        fontWeight: '600',
                      }}
                    >
                      {actionLabel}
                    </span>
                  </span>
                </span>
              </button>

              {isExpanded ? (
                <div
                  style={{
                    padding: '0 16px 16px 46px',
                    borderTop: '1px solid #e5e7eb',
                  }}
                >
                  <div style={{ paddingTop: '14px' }}>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: '700',
                        color: TavariStyles.colors.gray600,
                        marginBottom: '8px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      What changed
                    </div>
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: '18px',
                        color: TavariStyles.colors.gray800,
                        fontSize: '14px',
                        lineHeight: 1.6,
                      }}
                    >
                      {changeLines.map((line, idx) => (
                        <li key={`${entry.id}-line-${idx}`}>{line}</li>
                      ))}
                    </ul>
                    {entry.changed_ip ? (
                      <p
                        style={{
                          margin: '12px 0 0',
                          fontSize: '13px',
                          color: TavariStyles.colors.gray500,
                        }}
                      >
                        IP address: {entry.changed_ip}
                      </p>
                    ) : null}
                    {entry._synthetic ? (
                      <p
                        style={{
                          margin: '8px 0 0',
                          fontSize: '13px',
                          color: TavariStyles.colors.gray500,
                          fontStyle: 'italic',
                        }}
                      >
                        Reconstructed from booking creation data (no detailed history was stored at the time).
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default BookingHistoryTab;
