import React, { useEffect, useMemo, useState } from 'react';
import { Bell, CheckCircle, MessageSquareText, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';

const PortalStaffUpdates = () => {
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [business, setBusiness] = useState(null);
  const [updates, setUpdates] = useState([]);

  const counts = useMemo(() => {
    const pending = updates.filter((item) => item.requires_acknowledgement && !item.acknowledged_at).length;
    const acknowledged = updates.filter((item) => item.acknowledged_at).length;
    return { pending, acknowledged, total: updates.length };
  }, [updates]);

  const loadUpdates = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const { data, error } = await supabase.functions.invoke('employee-updates-action', {
        body: { action: 'list' }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setBusiness(data.business || null);
      setUpdates(data.updates || []);
    } catch (error) {
      console.error('[PortalStaffUpdates] load failed:', error);
      toast.error(error.message || 'Could not load staff updates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUpdates();
  }, []);

  const acknowledgeUpdate = async (item) => {
    const confirmed = window.confirm(`Acknowledge "${item.title}"?`);
    if (!confirmed) return;

    setSavingId(item.id);
    try {
      const { data, error } = await supabase.functions.invoke('employee-updates-action', {
        body: {
          action: 'acknowledge',
          update_id: item.id,
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success('Acknowledged');
      await loadUpdates({ silent: true });
      window.dispatchEvent(new Event('employee-account-badge-refresh'));
      window.dispatchEvent(new Event('employee-notification-badge-refresh'));
    } catch (error) {
      console.error('[PortalStaffUpdates] acknowledge failed:', error);
      toast.error(error.message || 'Could not acknowledge update');
    } finally {
      setSavingId(null);
    }
  };

  if (loading) return <div style={styles.loading}>Loading staff updates...</div>;

  const pendingUpdates = updates.filter((item) => item.requires_acknowledgement && !item.acknowledged_at);
  const otherUpdates = updates.filter((item) => !item.requires_acknowledgement || item.acknowledged_at);

  return (
    <div style={styles.page}>
      <section style={styles.hero}>
        <div style={styles.eyebrow}>Staff Updates</div>
        <h1 style={styles.title}>Notes, Updates & Announcements</h1>
        <p style={styles.subtitle}>
          Staff-specific notes, company updates, and announcements assigned to you by your managers.
        </p>
        {business?.name && <p style={styles.businessName}>{business.name}</p>}
      </section>

      <section style={styles.summaryGrid}>
        <SummaryCard label="Needs Acknowledgement" value={counts.pending} danger={counts.pending > 0} />
        <SummaryCard label="Acknowledged" value={counts.acknowledged} success />
        <SummaryCard label="Total Updates" value={counts.total} />
      </section>

      <section style={styles.sectionHeader}>
        <h2 style={styles.sectionTitle}>Needs Your Acknowledgement</h2>
        <button type="button" style={styles.refreshButton} onClick={() => loadUpdates({ silent: true })}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </section>

      {pendingUpdates.length === 0 ? (
        <section style={styles.empty}>
          <CheckCircle size={28} />
          <h2 style={styles.emptyTitle}>Nothing pending</h2>
          <p style={styles.emptyText}>Updates that need acknowledgement will appear here.</p>
        </section>
      ) : (
        <section style={styles.list}>
          {pendingUpdates.map((item) => (
            <UpdateCard
              key={item.id}
              item={item}
              saving={savingId === item.id}
              onAcknowledge={acknowledgeUpdate}
            />
          ))}
        </section>
      )}

      {otherUpdates.length > 0 && (
        <>
          <h2 style={styles.sectionTitle}>Recent Updates</h2>
          <section style={styles.list}>
            {otherUpdates.map((item) => (
              <UpdateCard key={item.id} item={item} acknowledged={Boolean(item.acknowledged_at)} />
            ))}
          </section>
        </>
      )}
    </div>
  );
};

const UpdateCard = ({ item, saving, onAcknowledge, acknowledged = false }) => (
  <article style={styles.card}>
    <div style={styles.cardTop}>
      <div style={{ ...styles.iconWrap, ...getPriorityTone(item.priority) }}>
        {item.update_type === 'announcement' ? <Bell size={20} /> : <MessageSquareText size={20} />}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={styles.typeText}>{formatType(item.update_type)} - {formatPriority(item.priority)}</div>
        <h3 style={styles.cardTitle}>{item.title}</h3>
        <div style={styles.metaText}>{formatDateTime(item.created_at)}</div>
        {item.due_date && <div style={styles.metaText}>Due {formatDate(item.due_date)}</div>}
        {item.body && <div style={styles.bodyText}>{item.body}</div>}
        {item.acknowledged_at && <div style={styles.ackText}>Acknowledged {formatDateTime(item.acknowledged_at)}</div>}
      </div>
    </div>
    {!acknowledged && item.requires_acknowledgement && (
      <button type="button" style={styles.primaryButton} onClick={() => onAcknowledge(item)} disabled={saving}>
        {saving ? 'Acknowledging...' : 'Acknowledge'}
      </button>
    )}
  </article>
);

const SummaryCard = ({ label, value, danger, success }) => (
  <div style={{ ...styles.summaryCard, ...(danger ? styles.dangerCard : {}), ...(success ? styles.successCard : {}) }}>
    <div style={styles.summaryValue}>{value}</div>
    <div style={styles.summaryLabel}>{label}</div>
  </div>
);

const formatType = (value = '') => ({
  note: 'Staff Note',
  update: 'Update',
  announcement: 'Announcement',
}[value] || String(value).replace(/_/g, ' '));
const formatPriority = (value = '') => String(value || 'normal').replace(/_/g, ' ');
const formatDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const formatDateTime = (value) => value ? new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const getPriorityTone = (priority) => {
  if (priority === 'critical') return { backgroundColor: '#fee2e2', color: '#991b1b' };
  if (priority === 'important') return { backgroundColor: '#fef3c7', color: '#92400e' };
  return { backgroundColor: '#dbeafe', color: '#1d4ed8' };
};

const styles = {
  loading: { minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: TavariStyles.colors.gray600 },
  page: { width: '100%', maxWidth: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: TavariStyles.spacing.lg, boxSizing: 'border-box', overflowX: 'hidden' },
  hero: { background: 'linear-gradient(135deg, #0f766e, #14b8a6)', color: TavariStyles.colors.white, borderRadius: '24px', padding: TavariStyles.spacing.xl, boxShadow: TavariStyles.shadows?.lg || '0 10px 20px rgba(0,0,0,0.15)', boxSizing: 'border-box' },
  eyebrow: { fontSize: TavariStyles.typography.fontSize.sm, opacity: 0.85, marginBottom: TavariStyles.spacing.xs },
  title: { margin: 0, fontSize: TavariStyles.typography.fontSize['2xl'], fontWeight: TavariStyles.typography.fontWeight.bold },
  subtitle: { margin: `${TavariStyles.spacing.sm} 0 0`, opacity: 0.9, lineHeight: 1.5 },
  businessName: { margin: `${TavariStyles.spacing.md} 0 0`, fontWeight: TavariStyles.typography.fontWeight.bold },
  summaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: TavariStyles.spacing.md },
  summaryCard: { backgroundColor: TavariStyles.colors.white, border: `1px solid ${TavariStyles.colors.gray200}`, borderRadius: '16px', padding: TavariStyles.spacing.lg },
  dangerCard: { borderColor: '#fecaca', backgroundColor: '#fef2f2' },
  successCard: { borderColor: '#bbf7d0', backgroundColor: '#f0fdf4' },
  summaryValue: { fontSize: '28px', fontWeight: 800, color: TavariStyles.colors.gray900 },
  summaryLabel: { color: TavariStyles.colors.gray600, fontSize: TavariStyles.typography.fontSize.sm },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: TavariStyles.spacing.md },
  sectionTitle: { margin: 0, color: TavariStyles.colors.gray900 },
  refreshButton: { border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: '999px', backgroundColor: TavariStyles.colors.white, color: TavariStyles.colors.gray700, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' },
  empty: { padding: TavariStyles.spacing.xl, borderRadius: '18px', backgroundColor: TavariStyles.colors.white, border: `1px solid ${TavariStyles.colors.gray200}`, textAlign: 'center', color: TavariStyles.colors.gray600 },
  emptyTitle: { margin: '12px 0 6px', color: TavariStyles.colors.gray900 },
  emptyText: { margin: 0 },
  list: { display: 'grid', gap: TavariStyles.spacing.md },
  card: { backgroundColor: TavariStyles.colors.white, border: `1px solid ${TavariStyles.colors.gray200}`, borderRadius: '18px', padding: TavariStyles.spacing.lg, boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)' },
  cardTop: { display: 'flex', gap: TavariStyles.spacing.md, alignItems: 'flex-start' },
  iconWrap: { width: '42px', height: '42px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  typeText: { color: TavariStyles.colors.gray500, fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' },
  cardTitle: { margin: '4px 0', color: TavariStyles.colors.gray900 },
  metaText: { color: TavariStyles.colors.gray600, fontSize: TavariStyles.typography.fontSize.sm },
  bodyText: { marginTop: TavariStyles.spacing.md, color: TavariStyles.colors.gray700, lineHeight: 1.55, whiteSpace: 'pre-wrap' },
  ackText: { marginTop: TavariStyles.spacing.sm, color: '#166534', fontWeight: 700 },
  primaryButton: { marginTop: TavariStyles.spacing.lg, border: 'none', borderRadius: '12px', padding: '11px 16px', backgroundColor: '#0f766e', color: TavariStyles.colors.white, fontWeight: 800, cursor: 'pointer' },
};

export default PortalStaffUpdates;
