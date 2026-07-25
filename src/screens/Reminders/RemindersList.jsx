import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, Pause, Play, Trash2 } from 'lucide-react';
import { useBusiness } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import { TavariStyles } from '../../utils/TavariStyles';
import { supabase } from '../../supabaseClient';
import { deleteReminder, listReminders } from '../../services/Reminders/reminderService';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK_ORDINALS = ['', 'First', 'Second', 'Third', 'Fourth', 'Last'];

const scheduleLabel = (row) => {
  const time = row.schedule_time || '09:00';
  if (row.schedule_type === 'once') return `Once on ${row.schedule_once_date} at ${time}`;
  if (row.schedule_type === 'weekly') {
    return `Every ${WEEKDAYS[row.schedule_day_of_week ?? 1]} at ${time}`;
  }
  if (row.schedule_type === 'biweekly') {
    return `Every other ${WEEKDAYS[row.schedule_day_of_week ?? 1]} at ${time}`;
  }
  if (row.schedule_type === 'monthly') return `Monthly on day ${row.schedule_day_of_month ?? 1} at ${time}`;
  if (row.schedule_type === 'quarterly') return `Quarterly on day ${row.schedule_day_of_month ?? 1} at ${time}`;
  if (row.schedule_type === 'monthly_weekday') {
    const ord = WEEK_ORDINALS[row.schedule_week_of_month ?? 1] || 'First';
    const day = WEEKDAYS[row.schedule_day_of_week ?? 1];
    return `${ord} ${day} of each month at ${time}`;
  }
  return time;
};

export default function RemindersList() {
  const navigate = useNavigate();
  const { business } = useBusiness();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('reminders.dashboard.edit');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    if (!business?.id) return;
    try {
      setLoading(true);
      const data = await listReminders(business.id);
      setRows(data);
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Failed to load reminders');
    } finally {
      setLoading(false);
    }
  }, [business?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const togglePause = async (row) => {
    if (!canEdit) return;
    try {
      const { error } = await supabase
        .from('tavari_reminders')
        .update({ paused: !row.paused })
        .eq('id', row.id);
      if (error) throw error;
      toast.success(row.paused ? 'Reminder resumed' : 'Reminder paused');
      load();
    } catch (err) {
      toast.error(err.message || 'Could not update reminder');
    }
  };

  const remove = async (row) => {
    if (!canEdit || !window.confirm(`Delete "${row.title}"?`)) return;
    try {
      await deleteReminder(row.id, business.id);
      toast.success('Reminder deleted');
      load();
    } catch (err) {
      toast.error(err.message || 'Delete failed');
    }
  };

  if (loading) return <p style={{ color: TavariStyles.colors.gray600 }}>Loading reminders…</p>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: TavariStyles.spacing.lg, flexWrap: 'wrap', gap: 12 }}>
        <p style={{ margin: 0, color: TavariStyles.colors.gray600 }}>
          {rows.length} reminder{rows.length === 1 ? '' : 's'}
        </p>
        {canEdit && (
          <button
            type="button"
            style={styles.primaryBtn}
            onClick={() => navigate('/dashboard/reminders/new')}
          >
            <Plus size={16} />
            New reminder
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div style={styles.empty}>
          <p>No reminders yet. Create one to email and notify staff on a schedule.</p>
        </div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Schedule</th>
                <th>Recipients</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const staffCount = row.tavari_reminder_staff_recipients?.length || 0;
                const manualCount = (row.manual_emails || []).length;
                return (
                  <tr key={row.id}>
                    <td>
                      <button type="button" style={styles.linkBtn} onClick={() => navigate(`/dashboard/reminders/${row.id}`)}>
                        {row.title}
                      </button>
                    </td>
                    <td>{scheduleLabel(row)}</td>
                    <td>{staffCount + manualCount} total</td>
                    <td>
                      <span style={{ ...styles.badge, ...(row.paused ? styles.badgePaused : styles.badgeActive) }}>
                        {row.paused ? 'Paused' : 'Active'}
                      </span>
                    </td>
                    <td style={styles.actions}>
                      {canEdit && (
                        <>
                          <button type="button" title={row.paused ? 'Resume' : 'Pause'} style={styles.iconBtn} onClick={() => togglePause(row)}>
                            {row.paused ? <Play size={16} /> : <Pause size={16} />}
                          </button>
                          <button type="button" title="Delete" style={styles.iconBtnDanger} onClick={() => remove(row)}>
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const styles = {
  primaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    borderRadius: 10,
    border: 'none',
    background: TavariStyles.colors.primary,
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
  },
  empty: {
    padding: 32,
    borderRadius: 16,
    border: `1px dashed ${TavariStyles.colors.gray300}`,
    color: TavariStyles.colors.gray600,
    textAlign: 'center',
  },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  linkBtn: {
    background: 'none',
    border: 'none',
    padding: 0,
    color: TavariStyles.colors.primary,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'left',
  },
  badge: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
  },
  badgeActive: { background: '#dcfce7', color: '#166534' },
  badgePaused: { background: '#fef3c7', color: '#92400e' },
  actions: { textAlign: 'right', whiteSpace: 'nowrap' },
  iconBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 6,
    color: TavariStyles.colors.gray700,
  },
  iconBtnDanger: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 6,
    color: '#b91c1c',
  },
};
