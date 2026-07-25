import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bell, BookOpen, Calendar, CalendarDays, CheckCircle, Clock, DollarSign, FileText, FileWarning, MessageSquareText, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { employeeAppPath } from '../../utils/employeeAppRouting';
import { getEmployeePortalSelectedBusinessId } from '../../utils/employeeProfileSelection';

/** Values must match notification.category and special cases All / Unread (see filteredNotifications). */
const FILTER_OPTIONS = ['All', 'Unread', 'Schedule', 'Shift Reminder', 'Reminder', 'Pay', 'Policy', 'Training', 'Time Off', 'Acknowledgement', 'Incident', 'Staff Update'];

const PortalNotifications = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [business, setBusiness] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [filter, setFilter] = useState('All');

  const filteredNotifications = useMemo(() => {
    if (filter === 'All') return notifications;
    if (filter === 'Unread') return notifications.filter((item) => !item.read);
    return notifications.filter((item) => item.category === filter);
  }, [filter, notifications]);

  const unreadCount = notifications.filter((item) => !item.read).length;

  const loadNotifications = async ({ silent = false, showRefreshSpinner = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      if (showRefreshSpinner) setRefreshing(true);
      const selectedBusinessId = getEmployeePortalSelectedBusinessId();
      const { data, error } = await supabase.functions.invoke('employee-notifications-action', {
        body: { action: 'list', ...(selectedBusinessId ? { business_id: selectedBusinessId } : {}) },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setBusiness(data.business || null);
      setNotifications(data.notifications || []);
    } catch (error) {
      console.error('[PortalNotifications] load failed:', error);
      toast.error(error.message || 'Could not load notifications');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadNotifications();
    const onProfileChange = () => loadNotifications({ silent: true });
    window.addEventListener('employee-profile-selection-changed', onProfileChange);
    return () => window.removeEventListener('employee-profile-selection-changed', onProfileChange);
  }, []);

  const markRead = async (notification, navigateAfter = false) => {
    setSaving(true);
    try {
      const selectedBusinessId = getEmployeePortalSelectedBusinessId();
      const { data, error } = await supabase.functions.invoke('employee-notifications-action', {
        body: {
          action: 'mark_read',
          notification_key: notification.key,
          ...(selectedBusinessId ? { business_id: selectedBusinessId } : {}),
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setNotifications((current) => current.map((item) => (
        item.key === notification.key ? { ...item, read: true } : item
      )));
      window.dispatchEvent(new Event('employee-notification-badge-refresh'));

      if (navigateAfter && notification.path) {
        navigate(employeeAppPath(notification.path));
      }
    } catch (error) {
      console.error('[PortalNotifications] mark read failed:', error);
      toast.error(error.message || 'Could not mark notification read');
    } finally {
      setSaving(false);
    }
  };

  const handleReminderAction = async (notification, action) => {
    if (!notification.occurrenceId) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('reminder-action', {
        body: { action, occurrence_id: notification.occurrenceId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(data.message || (action === 'complete' ? 'Marked complete' : 'Reminder rescheduled'));
      await loadNotifications({ silent: true });
    } catch (error) {
      console.error('[PortalNotifications] reminder action failed:', error);
      toast.error(error.message || 'Could not update reminder');
    } finally {
      setSaving(false);
    }
  };

  const markAllRead = async () => {
    setSaving(true);
    try {
      const selectedBusinessId = getEmployeePortalSelectedBusinessId();
      const { data, error } = await supabase.functions.invoke('employee-notifications-action', {
        body: { action: 'mark_all_read', ...(selectedBusinessId ? { business_id: selectedBusinessId } : {}) },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setNotifications((current) => current.map((item) => ({ ...item, read: true })));
      window.dispatchEvent(new Event('employee-notification-badge-refresh'));
      toast.success('Notifications marked as read');
    } catch (error) {
      console.error('[PortalNotifications] mark all read failed:', error);
      toast.error(error.message || 'Could not mark notifications read');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={styles.loading}>Loading notifications...</div>;

  return (
    <div style={styles.page}>
      <style>{TavariStyles.keyframes.spin}</style>
      <section style={styles.hero}>
        <div style={styles.eyebrow}>Employee Notifications</div>
        <h1 style={styles.title}>Notification Center</h1>
        {business?.name && <p style={styles.businessName}>{business.name}</p>}
      </section>

      <section style={styles.summaryRow}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{unreadCount}</div>
          <div style={styles.summaryLabel}>Unread</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{notifications.length}</div>
          <div style={styles.summaryLabel}>Total</div>
        </div>
      </section>

      <section style={styles.controlsSection} aria-label="Notification filters and actions">
        <div style={styles.controlsGrid}>
          <label style={styles.filterControl}>
            <span style={styles.filterControlLabel}>Filters</span>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={styles.filterSelect}
            >
              {FILTER_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
          <button type="button" style={styles.toolbarButtonPrimary} onClick={markAllRead} disabled={saving || refreshing || unreadCount === 0}>
            <CheckCircle size={15} />
            Mark All Read
          </button>
          <button
            type="button"
            style={styles.toolbarButtonSecondary}
            onClick={() => loadNotifications({ silent: true, showRefreshSpinner: true })}
            disabled={saving || refreshing}
            aria-busy={refreshing}
          >
            <RefreshCw size={15} style={refreshing ? styles.refreshIconSpinning : undefined} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </section>

      {filteredNotifications.length === 0 ? (
        <section style={styles.empty}>
          <Bell size={28} />
          <h2 style={styles.emptyTitle}>No notifications found</h2>
          <p style={styles.emptyText}>New employee app updates will appear here as they happen.</p>
        </section>
      ) : (
        <section style={styles.list}>
          {filteredNotifications.map((notification) => {
            const Icon = getNotificationIcon(notification.category);
            return (
              <article
                key={notification.key}
                style={{
                  ...styles.notificationCard,
                  ...(!notification.read ? styles.unreadCard : {})
                }}
              >
                <div style={{ ...styles.iconWrap, ...getCategoryTone(notification.category, notification.priority) }}>
                  <Icon size={20} />
                </div>
                <div style={styles.notificationBody}>
                  <div style={styles.notificationTop}>
                    <div>
                      <div style={styles.category}>{notification.category}</div>
                      <h3 style={styles.notificationTitle}>{notification.title}</h3>
                    </div>
                    {!notification.read && <span style={styles.unreadPill}>New</span>}
                  </div>
                  <p style={styles.notificationText}>{notification.body}</p>
                  <div style={styles.notificationFooter}>
                    <span style={styles.dateText}>{formatDateTime(notification.date)}</span>
                    <div style={styles.actions}>
                      {notification.reminderActions && (
                        <>
                          <button type="button" style={styles.linkButton} onClick={() => handleReminderAction(notification, 'complete')} disabled={saving}>
                            Complete
                          </button>
                          <button type="button" style={styles.linkButton} onClick={() => handleReminderAction(notification, 'snooze')} disabled={saving}>
                            Remind tomorrow
                          </button>
                        </>
                      )}
                      {!notification.read && (
                        <button type="button" style={styles.linkButton} onClick={() => markRead(notification)} disabled={saving}>
                          Mark read
                        </button>
                      )}
                      {!notification.reminderActions && (
                        <button type="button" style={styles.linkButton} onClick={() => markRead(notification, true)} disabled={saving}>
                          View
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
};

const getNotificationIcon = (category) => ({
  Schedule: Calendar,
  'Shift Reminder': Clock,
  Pay: DollarSign,
  Policy: FileText,
  Training: BookOpen,
  'Time Off': CalendarDays,
  Acknowledgement: FileWarning,
  Incident: AlertCircle,
  'Staff Update': MessageSquareText,
  Reminder: Bell,
}[category] || AlertCircle);

const getCategoryTone = (category, priority) => {
  if (priority === 'high') return { backgroundColor: '#fee2e2', color: '#991b1b' };
  return {
    Schedule: { backgroundColor: '#dbeafe', color: '#1d4ed8' },
    'Shift Reminder': { backgroundColor: '#fef3c7', color: '#92400e' },
    Pay: { backgroundColor: '#dcfce7', color: '#166534' },
    Policy: { backgroundColor: '#fef2f2', color: '#be123c' },
    Training: { backgroundColor: '#ede9fe', color: '#6d28d9' },
    'Time Off': { backgroundColor: '#ccfbf1', color: '#0f766e' },
    Acknowledgement: { backgroundColor: '#fee2e2', color: '#991b1b' },
    Incident: { backgroundColor: '#ffedd5', color: '#9a3412' },
    'Staff Update': { backgroundColor: '#dbeafe', color: '#1d4ed8' },
    Reminder: { backgroundColor: '#ccfbf1', color: '#0f766e' },
  }[category] || { backgroundColor: '#f3f4f6', color: '#374151' };
};

const formatDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const styles = {
  loading: {
    minHeight: '60vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: TavariStyles.colors.gray600,
  },
  page: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.lg,
    boxSizing: 'border-box',
    overflowX: 'hidden',
  },
  hero: {
    background: `linear-gradient(135deg, ${TavariStyles.colors.primary}, #0f766e)`,
    color: TavariStyles.colors.white,
    borderRadius: '24px',
    padding: TavariStyles.spacing.xl,
    boxShadow: TavariStyles.shadows?.lg || '0 10px 20px rgba(0,0,0,0.15)',
    boxSizing: 'border-box',
  },
  eyebrow: {
    fontSize: TavariStyles.typography.fontSize.sm,
    opacity: 0.85,
    marginBottom: TavariStyles.spacing.xs,
  },
  title: {
    margin: 0,
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: TavariStyles.typography.fontWeight.bold,
  },
  businessName: {
    margin: `${TavariStyles.spacing.md} 0 0`,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    opacity: 0.95,
  },
  summaryRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: TavariStyles.spacing.md,
    alignItems: 'stretch',
    maxWidth: '100%',
  },
  summaryCard: {
    backgroundColor: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: '16px',
    padding: TavariStyles.spacing.lg,
  },
  summaryValue: {
    fontSize: '28px',
    fontWeight: 800,
    color: TavariStyles.colors.gray900,
  },
  summaryLabel: {
    color: TavariStyles.colors.gray600,
    fontSize: TavariStyles.typography.fontSize.sm,
  },
  controlsSection: {
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
    boxSizing: 'border-box',
  },
  controlsGrid: {
    display: 'grid',
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))',
    gap: TavariStyles.spacing.sm,
    justifyItems: 'stretch',
    alignItems: 'stretch',
  },
  filterControl: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    minWidth: 0,
    width: '100%',
    justifyContent: 'flex-end',
  },
  filterControlLabel: {
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray700,
    textAlign: 'center',
    lineHeight: 1.2,
  },
  filterSelect: {
    width: '100%',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '12px',
    padding: '12px 14px',
    fontWeight: TavariStyles.typography.fontWeight.bold,
    fontSize: TavariStyles.typography.fontSize.base,
    fontFamily: 'inherit',
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.gray900,
    cursor: 'pointer',
    boxSizing: 'border-box',
    minHeight: '46px',
  },
  toolbarButtonPrimary: {
    border: 'none',
    borderRadius: '12px',
    padding: '12px 14px',
    width: '100%',
    minHeight: '46px',
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    fontWeight: TavariStyles.typography.fontWeight.bold,
    cursor: 'pointer',
    boxSizing: 'border-box',
    alignSelf: 'end',
  },
  toolbarButtonSecondary: {
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '12px',
    padding: '12px 14px',
    width: '100%',
    minHeight: '46px',
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.gray800,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    fontWeight: TavariStyles.typography.fontWeight.bold,
    cursor: 'pointer',
    boxSizing: 'border-box',
    alignSelf: 'end',
  },
  refreshIconSpinning: {
    animation: 'spin 1s linear infinite',
  },
  empty: {
    padding: TavariStyles.spacing.xl,
    borderRadius: '18px',
    backgroundColor: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    textAlign: 'center',
    color: TavariStyles.colors.gray600,
  },
  emptyTitle: {
    margin: '12px 0 6px',
    color: TavariStyles.colors.gray900,
  },
  emptyText: {
    margin: 0,
  },
  list: {
    display: 'grid',
    gap: TavariStyles.spacing.md,
  },
  notificationCard: {
    backgroundColor: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: '18px',
    padding: TavariStyles.spacing.lg,
    display: 'flex',
    gap: TavariStyles.spacing.md,
    minWidth: 0,
    boxSizing: 'border-box',
    boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
  },
  unreadCard: {
    borderColor: TavariStyles.colors.primary,
    boxShadow: '0 10px 24px rgba(0, 128, 128, 0.12)',
  },
  iconWrap: {
    width: '42px',
    height: '42px',
    borderRadius: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  notificationBody: {
    flex: 1,
    minWidth: 0,
  },
  notificationTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: TavariStyles.spacing.md,
    alignItems: 'flex-start',
  },
  category: {
    color: TavariStyles.colors.gray500,
    fontSize: '13px',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  notificationTitle: {
    margin: '4px 0 0',
    color: TavariStyles.colors.gray900,
    fontSize: TavariStyles.typography.fontSize.lg,
  },
  notificationText: {
    color: TavariStyles.colors.gray600,
    lineHeight: 1.5,
    margin: `${TavariStyles.spacing.sm} 0`,
  },
  notificationFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: TavariStyles.spacing.md,
    flexWrap: 'wrap',
  },
  dateText: {
    color: TavariStyles.colors.gray500,
    fontSize: TavariStyles.typography.fontSize.sm,
  },
  actions: {
    display: 'flex',
    gap: TavariStyles.spacing.sm,
    alignItems: 'center',
  },
  linkButton: {
    border: 'none',
    backgroundColor: 'transparent',
    color: TavariStyles.colors.primary,
    fontWeight: 800,
    cursor: 'pointer',
    padding: '4px',
  },
  unreadPill: {
    borderRadius: '999px',
    backgroundColor: '#dc2626',
    color: TavariStyles.colors.white,
    padding: '4px 9px',
    fontSize: '13px',
    fontWeight: 800,
  },
};

export default PortalNotifications;
