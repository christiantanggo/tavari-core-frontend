import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle, RefreshCw, RotateCcw } from 'lucide-react';
import { useBusiness } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import { TavariStyles } from '../../utils/TavariStyles';
import {
  listCompletedReminderOccurrences,
  uncompleteReminderOccurrence,
} from '../../services/Reminders/reminderService';

const formatDateTime = (value) => {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

export default function CompletedReminders() {
  const { business } = useBusiness();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('reminders.dashboard.edit');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [rows, setRows] = useState([]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!business?.id) return;
    try {
      if (!silent) setLoading(true);
      const data = await listCompletedReminderOccurrences(business.id);
      setRows(data);
    } catch (err) {
      console.error('[CompletedReminders] load failed:', err);
      toast.error(err.message || 'Failed to load completed reminders');
    } finally {
      setLoading(false);
    }
  }, [business?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => ({
    completed: rows.length,
    today: rows.filter((row) => {
      if (!row.completed_at) return false;
      return new Date(row.completed_at).toDateString() === new Date().toDateString();
    }).length,
  }), [rows]);

  const handleUndoCompletion = async (row) => {
    if (!canEdit) return;
    const ok = window.confirm('Cancel this completion and move the reminder back to active?');
    if (!ok) return;

    try {
      setSavingId(row.id);
      await uncompleteReminderOccurrence(row.id);
      toast.success('Completion cancelled');
      await load({ silent: true });
    } catch (err) {
      console.error('[CompletedReminders] undo failed:', err);
      toast.error(err.message || 'Could not cancel completion');
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return <p style={{ color: TavariStyles.colors.gray600 }}>Loading completed reminders...</p>;
  }

  return (
    <div style={styles.page}>
      <section style={styles.summaryRow}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{summary.completed}</div>
          <div style={styles.summaryLabel}>Completed</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{summary.today}</div>
          <div style={styles.summaryLabel}>Completed today</div>
        </div>
        <button type="button" style={styles.refreshButton} onClick={() => load({ silent: true })}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </section>

      {rows.length === 0 ? (
        <section style={styles.empty}>
          <CheckCircle size={28} />
          <h2 style={styles.emptyTitle}>No completed reminders</h2>
          <p style={styles.emptyText}>Completed reminder occurrences will appear here.</p>
        </section>
      ) : (
        <section style={styles.list}>
          {rows.map((row) => {
            const reminder = Array.isArray(row.tavari_reminders)
              ? row.tavari_reminders[0]
              : row.tavari_reminders;
            return (
              <article key={row.id} style={styles.card}>
                <div style={styles.cardBody}>
                  <div style={styles.cardTop}>
                    <div>
                      <div style={styles.kicker}>Completed occurrence</div>
                      <h3 style={styles.title}>{reminder?.title || 'Reminder'}</h3>
                    </div>
                    <span style={styles.badge}>Completed</span>
                  </div>
                  {reminder?.body && <p style={styles.bodyText}>{reminder.body}</p>}
                  <dl style={styles.metaGrid}>
                    <div>
                      <dt>Completed</dt>
                      <dd>{formatDateTime(row.completed_at)}</dd>
                    </div>
                    <div>
                      <dt>Last sent</dt>
                      <dd>{formatDateTime(row.sent_at)}</dd>
                    </div>
                    <div>
                      <dt>Planned date</dt>
                      <dd>{row.planned_date || 'Not recorded'}</dd>
                    </div>
                    <div>
                      <dt>Automatic repeats</dt>
                      <dd>{row.repeat_count || 0}</dd>
                    </div>
                  </dl>
                </div>
                <div style={styles.cardActions}>
                  <button
                    type="button"
                    style={styles.undoButton}
                    onClick={() => handleUndoCompletion(row)}
                    disabled={!canEdit || savingId === row.id}
                  >
                    <RotateCcw size={16} />
                    {savingId === row.id ? 'Cancelling...' : 'Cancel completion'}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}

const styles = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.lg,
  },
  summaryRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: TavariStyles.spacing.md,
    alignItems: 'stretch',
  },
  summaryCard: {
    backgroundColor: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: 16,
    padding: TavariStyles.spacing.lg,
  },
  summaryValue: {
    fontSize: 28,
    fontWeight: 800,
    color: TavariStyles.colors.gray900,
  },
  summaryLabel: {
    color: TavariStyles.colors.gray600,
    fontSize: TavariStyles.typography.fontSize.sm,
  },
  refreshButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: 12,
    background: TavariStyles.colors.white,
    color: TavariStyles.colors.gray700,
    fontWeight: 700,
    cursor: 'pointer',
    padding: '10px 14px',
  },
  empty: {
    padding: 32,
    borderRadius: 16,
    border: `1px dashed ${TavariStyles.colors.gray300}`,
    color: TavariStyles.colors.gray600,
    textAlign: 'center',
  },
  emptyTitle: {
    margin: '10px 0 6px',
    color: TavariStyles.colors.gray900,
  },
  emptyText: {
    margin: 0,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.md,
  },
  card: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: TavariStyles.spacing.lg,
    backgroundColor: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: 16,
    padding: TavariStyles.spacing.lg,
  },
  cardBody: {
    minWidth: 0,
  },
  cardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: TavariStyles.spacing.md,
    alignItems: 'flex-start',
  },
  kicker: {
    color: TavariStyles.colors.success || '#047857',
    fontSize: TavariStyles.typography.fontSize.xs || 12,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  title: {
    margin: '4px 0 0',
    color: TavariStyles.colors.gray900,
    fontSize: TavariStyles.typography.fontSize.lg,
  },
  badge: {
    background: '#dcfce7',
    color: '#166534',
    borderRadius: 999,
    padding: '4px 10px',
    fontSize: 13,
    fontWeight: 700,
  },
  bodyText: {
    color: TavariStyles.colors.gray600,
    lineHeight: 1.5,
    margin: '12px 0 0',
    whiteSpace: 'pre-wrap',
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
    gap: TavariStyles.spacing.md,
    margin: '16px 0 0',
  },
  cardActions: {
    display: 'flex',
    alignItems: 'center',
  },
  undoButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    borderRadius: 12,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    background: TavariStyles.colors.white,
    color: TavariStyles.colors.gray800,
    fontWeight: 800,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
};
