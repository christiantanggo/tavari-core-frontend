import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';

/** Lead times offered for automated shift reminder emails (dispatcher uses business timezone). */
const SHIFT_REMINDER_HOURS_OPTIONS = [
  { value: 1, label: '1 hour' },
  { value: 2, label: '2 hours' },
  { value: 3, label: '3 hours' },
  { value: 4, label: '4 hours' },
  { value: 6, label: '6 hours' },
  { value: 8, label: '8 hours' },
  { value: 12, label: '12 hours' },
  { value: 18, label: '18 hours' },
  { value: 24, label: '24 hours' },
  { value: 36, label: '36 hours' },
  { value: 48, label: '48 hours' }
];

const NOTIFICATION_EVENTS = [
  {
    group: 'Schedule',
    items: [
      {
        key: 'schedule_posted',
        title: 'Schedule posted',
        description: 'Notify employees when a new schedule is published.'
      },
      {
        key: 'schedule_changed',
        title: 'Schedule changed',
        description: 'Notify affected employees when a shift is added, removed, or changed.'
      },
      {
        key: 'shift_marked_sick',
        title: 'Employee marked sick',
        description: 'Notify managers when a scheduled employee is marked sick.'
      }
    ]
  },
  {
    group: 'Shift reminders',
    items: [
      {
        key: 'shift_reminder',
        title: 'Upcoming shift reminder',
        description:
          'Email employees before a scheduled shift starts. Choose how far in advance; delivery uses each business’s timezone.'
      }
    ]
  },
  {
    group: 'Availability',
    items: [
      {
        key: 'availability_submitted',
        title: 'Availability submitted',
        description: 'Notify managers when an employee submits availability.'
      },
      {
        key: 'availability_approved',
        title: 'Availability approved',
        description: 'Notify employees when their availability is approved.'
      },
      {
        key: 'availability_denied',
        title: 'Availability denied',
        description: 'Notify employees when their availability request is denied.'
      }
    ]
  },
  {
    group: 'Time Off',
    items: [
      {
        key: 'time_off_requested',
        title: 'Time off requested',
        description: 'Notify managers when an employee requests time off.'
      },
      {
        key: 'time_off_approved',
        title: 'Time off approved',
        description: 'Notify employees when time off is approved.'
      },
      {
        key: 'time_off_denied',
        title: 'Time off denied',
        description: 'Notify employees when time off is denied.'
      },
      {
        key: 'shift_coverage_requested',
        title: 'Shift coverage requested',
        description: 'Notify managers when an employee requests coverage or a shift swap.'
      },
      {
        key: 'shift_coverage_approved',
        title: 'Shift coverage approved',
        description: 'Notify employees when a shift coverage request is approved.'
      },
      {
        key: 'shift_coverage_denied',
        title: 'Shift coverage denied',
        description: 'Notify employees when a shift coverage request is denied.'
      }
    ]
  },
  {
    group: 'Timesheets',
    items: [
      {
        key: 'missed_clock_in',
        title: 'Missed clock-in',
        description: 'Notify managers when a scheduled shift has no clock-in.'
      },
      {
        key: 'late_clock_in',
        title: 'Late clock-in',
        description: 'Notify managers when an employee clocks in late.'
      },
      {
        key: 'early_clock_out',
        title: 'Early clock-out',
        description: 'Notify managers when an employee clocks out before their scheduled end time.'
      },
      {
        key: 'missed_break',
        title: 'Missed break',
        description: 'Notify managers when a required unpaid break appears to be missed.'
      }
    ]
  }
];

const DEFAULT_SETTINGS = NOTIFICATION_EVENTS.reduce((acc, group) => {
  group.items.forEach((item) => {
    acc[item.key] =
      item.key === 'shift_reminder'
        ? { email: true, sms: false, hours_before: 24 }
        : { email: true, sms: false };
  });
  return acc;
}, {});

const SchedulingNotificationsTab = ({ businessId }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [updatedAt, setUpdatedAt] = useState(null);

  const enabledCounts = useMemo(() => {
    return Object.values(settings).reduce((acc, item) => {
      if (item.email) acc.email += 1;
      if (item.sms) acc.sms += 1;
      return acc;
    }, { email: 0, sms: 0 });
  }, [settings]);

  useEffect(() => {
    loadSettings();
  }, [businessId]);

  const loadSettings = async () => {
    if (!businessId) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('scheduling_notification_settings')
        .select('settings, updated_at')
        .eq('business_id', businessId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;

      setSettings(mergeSettings(data?.settings || {}));
      setUpdatedAt(data?.updated_at || null);
    } catch (error) {
      console.error('Error loading scheduling notification settings:', error);
      toast.error('Unable to load notification settings');
    } finally {
      setLoading(false);
    }
  };

  const mergeSettings = (loadedSettings) => {
    const next = { ...DEFAULT_SETTINGS };
    Object.keys(next).forEach((key) => {
      next[key] = {
        ...next[key],
        ...(loadedSettings[key] || {})
      };
    });
    if (next.shift_reminder) {
      const hb = Number(next.shift_reminder.hours_before);
      next.shift_reminder.hours_before =
        Number.isFinite(hb) && hb > 0 ? Math.min(168, Math.round(hb)) : 24;
    }
    return next;
  };

  const toggleChannel = (eventKey, channel) => {
    setSettings((current) => ({
      ...current,
      [eventKey]: {
        ...current[eventKey],
        [channel]: !current[eventKey]?.[channel]
      }
    }));
  };

  const setShiftReminderHours = (hours) => {
    const h = Math.min(168, Math.max(1, Math.round(Number(hours)) || 24));
    setSettings((current) => ({
      ...current,
      shift_reminder: {
        email: current.shift_reminder?.email !== false,
        sms: !!current.shift_reminder?.sms,
        hours_before: h
      }
    }));
  };

  const saveSettings = async () => {
    try {
      setSaving(true);
      const { data, error } = await supabase
        .from('scheduling_notification_settings')
        .upsert({
          business_id: businessId,
          settings
        }, { onConflict: 'business_id' })
        .select('updated_at')
        .single();

      if (error) throw error;

      setUpdatedAt(data?.updated_at || new Date().toISOString());
      toast.success('Notification settings saved');
    } catch (error) {
      console.error('Error saving scheduling notification settings:', error);
      toast.error('Unable to save notification settings');
    } finally {
      setSaving(false);
    }
  };

  if (!businessId) {
    return <div style={styles.emptyState}>Select a business to configure scheduling notifications.</div>;
  }

  if (loading) {
    return <div style={styles.emptyState}>Loading notification settings...</div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Scheduling Notifications</h2>
          <p style={styles.subtitle}>
            Configure which scheduling events should send email or SMS notifications.
          </p>
          <p style={styles.note}>
            Email notifications are enabled by default for all scheduling events. Turn off any event you do not want to send.
            SMS settings are available here but require an SMS provider before messages can be delivered.
            Shift reminder emails are dispatched automatically: <strong>pg_cron</strong> calls{' '}
            <code style={styles.inlineCode}>scheduling-dispatch-shift-reminders</code> every <strong>15 minutes</strong>{' '}
            (same pattern as attendance alerts). Ensure migration <code style={styles.inlineCode}>schedule_shift_reminder_cron</code>{' '}
            is applied on your database.
          </p>
        </div>
        <button
          type="button"
          onClick={saveSettings}
          disabled={saving}
          style={{
            ...styles.saveButton,
            opacity: saving ? 0.7 : 1
          }}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <div style={styles.summaryGrid}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{enabledCounts.email}</div>
          <div style={styles.summaryLabel}>Email notifications enabled</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{enabledCounts.sms}</div>
          <div style={styles.summaryLabel}>SMS notifications enabled</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{NOTIFICATION_EVENTS.reduce((total, group) => total + group.items.length, 0)}</div>
          <div style={styles.summaryLabel}>Events configurable</div>
        </div>
      </div>

      <div style={styles.groups}>
        {NOTIFICATION_EVENTS.map((group) => (
          <div key={group.group} style={styles.groupCard}>
            <h3 style={styles.groupTitle}>{group.group}</h3>
            <div style={styles.tableHeader}>
              <div>Event</div>
              <div style={styles.channelHeader}>Email</div>
              <div style={styles.channelHeader}>SMS</div>
            </div>
            {group.items.map((item) => (
              <React.Fragment key={item.key}>
                <div style={styles.eventRow}>
                  <div>
                    <div style={styles.eventTitle}>{item.title}</div>
                    <div style={styles.eventDescription}>{item.description}</div>
                  </div>
                  <div style={styles.toggleCell}>
                    <TavariCheckbox
                      id={`${item.key}-email`}
                      size="md"
                      checked={!!settings[item.key]?.email}
                      onChange={() => toggleChannel(item.key, 'email')}
                      appearance="custom"
                    />
                  </div>
                  <div style={styles.toggleCell}>
                    <TavariCheckbox
                      id={`${item.key}-sms`}
                      size="md"
                      checked={!!settings[item.key]?.sms}
                      onChange={() => toggleChannel(item.key, 'sms')}
                      appearance="custom"
                    />
                  </div>
                </div>
                {item.key === 'shift_reminder' && (
                  <div style={styles.shiftReminderOptions}>
                    <div style={styles.shiftReminderOptionsLabel}>Reminder timing</div>
                    <div style={styles.shiftReminderRow}>
                      <label htmlFor="shift-reminder-hours" style={styles.reminderFieldLabel}>
                        Send email
                      </label>
                      <select
                        id="shift-reminder-hours"
                        value={Number(settings.shift_reminder?.hours_before) || 24}
                        onChange={(e) => setShiftReminderHours(e.target.value)}
                        style={styles.select}
                      >
                        {SHIFT_REMINDER_HOURS_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <span style={styles.reminderHint}>before shift start · uses business timezone</span>
                    </div>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        ))}
      </div>

      {updatedAt && (
        <div style={styles.updatedAt}>
          Last saved: {new Date(updatedAt).toLocaleString()}
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    padding: '24px',
    backgroundColor: TavariStyles.colors.background,
    minHeight: '100%'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '16px',
    flexWrap: 'wrap',
    marginBottom: '20px'
  },
  title: {
    margin: 0,
    color: '#111827',
    fontSize: '24px'
  },
  subtitle: {
    margin: '6px 0 0',
    color: '#6b7280',
    fontSize: '14px'
  },
  note: {
    margin: '8px 0 0',
    color: '#92400e',
    backgroundColor: '#fef3c7',
    border: '1px solid #fde68a',
    borderRadius: '8px',
    padding: '10px',
    fontSize: '13px'
  },
  saveButton: {
    padding: '12px 18px',
    border: 'none',
    borderRadius: '8px',
    backgroundColor: '#008080',
    color: 'white',
    cursor: 'pointer',
    fontWeight: 700
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '12px',
    marginBottom: '20px'
  },
  summaryCard: {
    backgroundColor: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    padding: '16px'
  },
  summaryValue: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#008080'
  },
  summaryLabel: {
    color: '#6b7280',
    fontSize: '13px',
    marginTop: '4px'
  },
  groups: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  groupCard: {
    backgroundColor: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    overflow: 'hidden'
  },
  groupTitle: {
    margin: 0,
    padding: '16px',
    borderBottom: '1px solid #e5e7eb',
    fontSize: '18px',
    color: '#111827'
  },
  tableHeader: {
    display: 'grid',
    gridTemplateColumns: '1fr 90px 90px',
    gap: '12px',
    padding: '10px 16px',
    backgroundColor: '#f9fafb',
    color: '#374151',
    fontSize: '13px',
    fontWeight: 700
  },
  channelHeader: {
    textAlign: 'center'
  },
  eventRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 90px 90px',
    gap: '12px',
    alignItems: 'center',
    padding: '14px 16px',
    borderTop: '1px solid #f3f4f6'
  },
  eventTitle: {
    color: '#111827',
    fontWeight: 700,
    fontSize: '14px'
  },
  eventDescription: {
    color: '#6b7280',
    fontSize: '13px',
    marginTop: '3px'
  },
  toggleCell: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center'
  },
  updatedAt: {
    marginTop: '16px',
    color: '#6b7280',
    fontSize: '13px'
  },
  emptyState: {
    padding: '40px',
    textAlign: 'center',
    color: '#6b7280'
  },
  inlineCode: {
    fontSize: '13px',
    backgroundColor: '#f3f4f6',
    padding: '2px 6px',
    borderRadius: '4px'
  },
  shiftReminderOptions: {
    padding: '12px 16px 16px',
    borderTop: '1px solid #f3f4f6',
    backgroundColor: '#fafafa'
  },
  shiftReminderOptionsLabel: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: '8px'
  },
  shiftReminderRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '10px'
  },
  reminderFieldLabel: {
    fontSize: '14px',
    color: '#374151',
    fontWeight: 600
  },
  select: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid #d1d5db',
    fontSize: '14px',
    color: '#111827',
    backgroundColor: '#fff',
    minWidth: '140px',
    cursor: 'pointer'
  },
  reminderHint: {
    fontSize: '13px',
    color: '#6b7280'
  }
};

export default SchedulingNotificationsTab;
