import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, FileWarning, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';

const PortalAcknowledgements = () => {
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [business, setBusiness] = useState(null);
  const [items, setItems] = useState([]);

  const counts = useMemo(() => {
    const pending = items.filter((item) => !item.acknowledged_at).length;
    const overdue = items.filter((item) => !item.acknowledged_at && isOverdue(item.due_date)).length;
    return { pending, overdue, acknowledged: items.length - pending };
  }, [items]);

  const loadAcknowledgements = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const { data, error } = await supabase.functions.invoke('employee-acknowledgements-action', {
        body: { action: 'list' }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setBusiness(data.business || null);
      setItems(data.acknowledgements || []);
    } catch (error) {
      console.error('[PortalAcknowledgements] load failed:', error);
      toast.error(error.message || 'Could not load acknowledgements');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAcknowledgements();
  }, []);

  const acknowledgeItem = async (item) => {
    const confirmed = window.confirm(`By acknowledging "${item.title}", you confirm that you have received and reviewed this item. Continue?`);
    if (!confirmed) return;

    setSavingId(item.id);
    try {
      const { data, error } = await supabase.functions.invoke('employee-acknowledgements-action', {
        body: {
          action: 'acknowledge',
          acknowledgement_id: item.id,
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success('Acknowledged');
      await loadAcknowledgements({ silent: true });
      window.dispatchEvent(new Event('employee-account-badge-refresh'));
      window.dispatchEvent(new Event('employee-notification-badge-refresh'));
    } catch (error) {
      console.error('[PortalAcknowledgements] acknowledgement failed:', error);
      toast.error(error.message || 'Could not acknowledge item');
    } finally {
      setSavingId(null);
    }
  };

  if (loading) return <div style={styles.loading}>Loading acknowledgements...</div>;

  const pendingItems = items.filter((item) => !item.acknowledged_at);
  const acknowledgedItems = items.filter((item) => item.acknowledged_at);

  return (
    <div style={styles.page}>
      <section style={styles.hero}>
        <div style={styles.eyebrow}>Employee Acknowledgements</div>
        <h1 style={styles.title}>Required Acknowledgements</h1>
        <p style={styles.subtitle}>
          Review and acknowledge important HR items, including write-ups, disciplinary actions, termination notices, and company notices.
        </p>
        {business?.name && <p style={styles.businessName}>{business.name}</p>}
      </section>

      <section style={styles.summaryGrid}>
        <SummaryCard label="Pending" value={counts.pending} />
        <SummaryCard label="Overdue" value={counts.overdue} danger />
        <SummaryCard label="Acknowledged" value={counts.acknowledged} success />
      </section>

      <section style={styles.sectionHeader}>
        <h2 style={styles.sectionTitle}>Needs Your Acknowledgement</h2>
        <button type="button" style={styles.refreshButton} onClick={() => loadAcknowledgements({ silent: true })}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </section>

      {pendingItems.length === 0 ? (
        <section style={styles.empty}>
          <CheckCircle size={28} />
          <h2 style={styles.emptyTitle}>Nothing pending</h2>
          <p style={styles.emptyText}>Any forced acknowledgements assigned to you will appear here.</p>
        </section>
      ) : (
        <section style={styles.list}>
          {pendingItems.map((item) => (
            <AcknowledgementCard
              key={item.id}
              item={item}
              saving={savingId === item.id}
              onAcknowledge={acknowledgeItem}
            />
          ))}
        </section>
      )}

      {acknowledgedItems.length > 0 && (
        <>
          <h2 style={styles.sectionTitle}>Acknowledged</h2>
          <section style={styles.list}>
            {acknowledgedItems.map((item) => (
              <AcknowledgementCard key={item.id} item={item} acknowledged />
            ))}
          </section>
        </>
      )}
    </div>
  );
};

const AcknowledgementCard = ({ item, saving, onAcknowledge, acknowledged = false }) => {
  const overdue = !item.acknowledged_at && isOverdue(item.due_date);
  return (
    <article style={{ ...styles.card, ...(overdue ? styles.cardOverdue : {}) }}>
      <div style={styles.cardTop}>
        <div style={styles.iconWrap}>
          {overdue ? <AlertTriangle size={20} /> : <FileWarning size={20} />}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={styles.typeText}>{formatItemType(item.item_type)} • {formatSeverity(item.severity)}</div>
          <h3 style={styles.cardTitle}>{item.title}</h3>
          {item.due_date && <div style={styles.metaText}>Due {formatDate(item.due_date)}</div>}
          {item.body && <div style={styles.bodyText}>{item.body}</div>}
          {item.manager_note && <div style={styles.noteText}>Manager note: {item.manager_note}</div>}
          {item.acknowledged_at && <div style={styles.ackText}>Acknowledged {formatDateTime(item.acknowledged_at)}</div>}
        </div>
      </div>
      {!acknowledged && (
        <button type="button" style={styles.primaryButton} onClick={() => onAcknowledge(item)} disabled={saving}>
          {saving ? 'Acknowledging...' : 'Acknowledge'}
        </button>
      )}
    </article>
  );
};

const SummaryCard = ({ label, value, danger, success }) => (
  <div style={{ ...styles.summaryCard, ...(danger ? styles.dangerCard : {}), ...(success ? styles.successCard : {}) }}>
    <div style={styles.summaryValue}>{value}</div>
    <div style={styles.summaryLabel}>{label}</div>
  </div>
);

const isOverdue = (date) => Boolean(date && new Date(`${date}T23:59:59`) < new Date());
const formatItemType = (value = '') => ({
  writeup: 'Write-Up',
  disciplinary_action: 'Disciplinary Action',
  termination: 'Termination',
  important_notice: 'Important Notice',
}[value] || String(value).replace(/_/g, ' '));
const formatSeverity = (value = '') => String(value || 'normal').replace(/_/g, ' ');
const formatDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const formatDateTime = (value) => value ? new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';

const styles = {
  loading: { minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: TavariStyles.colors.gray600 },
  page: { width: '100%', maxWidth: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: TavariStyles.spacing.lg, boxSizing: 'border-box', overflowX: 'hidden' },
  hero: { background: 'linear-gradient(135deg, #991b1b, #dc2626)', color: TavariStyles.colors.white, borderRadius: '24px', padding: TavariStyles.spacing.xl, boxShadow: TavariStyles.shadows?.lg || '0 10px 20px rgba(0,0,0,0.15)', boxSizing: 'border-box' },
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
  cardOverdue: { borderColor: '#fca5a5', boxShadow: '0 10px 24px rgba(220, 38, 38, 0.12)' },
  cardTop: { display: 'flex', gap: TavariStyles.spacing.md, alignItems: 'flex-start' },
  iconWrap: { width: '42px', height: '42px', borderRadius: '14px', backgroundColor: '#fee2e2', color: '#991b1b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  typeText: { color: TavariStyles.colors.gray500, fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' },
  cardTitle: { margin: '4px 0', color: TavariStyles.colors.gray900 },
  metaText: { color: TavariStyles.colors.gray600, fontSize: TavariStyles.typography.fontSize.sm },
  bodyText: { marginTop: TavariStyles.spacing.md, color: TavariStyles.colors.gray700, lineHeight: 1.55, whiteSpace: 'pre-wrap' },
  noteText: { marginTop: TavariStyles.spacing.md, padding: TavariStyles.spacing.md, borderRadius: '12px', backgroundColor: '#f8fafc', color: TavariStyles.colors.gray700 },
  ackText: { marginTop: TavariStyles.spacing.sm, color: '#166534', fontWeight: 700 },
  primaryButton: { marginTop: TavariStyles.spacing.lg, border: 'none', borderRadius: '12px', padding: '11px 16px', backgroundColor: '#dc2626', color: TavariStyles.colors.white, fontWeight: 800, cursor: 'pointer' },
};

export default PortalAcknowledgements;
