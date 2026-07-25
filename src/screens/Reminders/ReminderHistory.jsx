import React, { useCallback, useEffect, useState } from 'react';
import { useBusiness } from '../../contexts/BusinessContext';
import { TavariStyles } from '../../utils/TavariStyles';
import { listDeliveryHistory } from '../../services/Reminders/reminderService';
import toast from 'react-hot-toast';

export default function ReminderHistory() {
  const { business } = useBusiness();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    if (!business?.id) return;
    try {
      setLoading(true);
      const data = await listDeliveryHistory(business.id);
      setRows(data);
    } catch (err) {
      toast.error(err.message || 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [business?.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p style={{ color: TavariStyles.colors.gray600 }}>Loading history…</p>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th>When</th>
            <th>Reminder</th>
            <th>Channel</th>
            <th>Recipient</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} style={styles.empty}>No deliveries yet.</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleString()}</td>
                <td>{row.tavari_reminders?.title || '—'}</td>
                <td>{row.channel}</td>
                <td>{row.recipient_email || row.recipient_user_id || '—'}</td>
                <td>
                  <span style={{ ...styles.badge, ...(row.status === 'sent' ? styles.ok : styles.fail) }}>
                    {row.status}
                  </span>
                  {row.error_message && <div style={styles.error}>{row.error_message}</div>}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

const styles = {
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  empty: { padding: 24, textAlign: 'center', color: TavariStyles.colors.gray500 },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 13, fontWeight: 600 },
  ok: { background: '#dcfce7', color: '#166534' },
  fail: { background: '#fee2e2', color: '#991b1b' },
  error: { fontSize: 13, color: '#b91c1c', marginTop: 4 },
};
