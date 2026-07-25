import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus, RefreshCw, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';

const INCIDENT_TYPES = [
  { value: 'general', label: 'General' },
  { value: 'safety', label: 'Safety' },
  { value: 'injury', label: 'Injury' },
  { value: 'customer', label: 'Customer' },
  { value: 'conflict', label: 'Conflict' },
  { value: 'property_damage', label: 'Property Damage' },
  { value: 'policy_violation', label: 'Policy Violation' },
  { value: 'other', label: 'Other' },
];

const SEVERITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const PortalIncidents = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [business, setBusiness] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    incident_type: 'general',
    severity: 'normal',
    location: '',
    occurred_at: toDatetimeLocal(new Date()),
  });

  const counts = useMemo(() => ({
    open: incidents.filter((incident) => ['open', 'reviewing'].includes(incident.status)).length,
    closed: incidents.filter((incident) => ['resolved', 'closed'].includes(incident.status)).length,
    critical: incidents.filter((incident) => incident.severity === 'critical').length,
  }), [incidents]);

  const loadIncidents = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const { data, error } = await supabase.functions.invoke('employee-incidents-action', {
        body: { action: 'list' }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setBusiness(data.business || null);
      setIncidents(data.incidents || []);
    } catch (error) {
      console.error('[PortalIncidents] load failed:', error);
      toast.error(error.message || 'Could not load incidents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIncidents();
  }, []);

  const submitIncident = async (event) => {
    event.preventDefault();
    if (!form.title.trim() || !form.description.trim()) {
      toast.error('Add a title and details');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('employee-incidents-action', {
        body: {
          action: 'submit',
          ...form,
          occurred_at: form.occurred_at ? new Date(form.occurred_at).toISOString() : new Date().toISOString(),
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success('Incident submitted');
      setForm({
        title: '',
        description: '',
        incident_type: 'general',
        severity: 'normal',
        location: '',
        occurred_at: toDatetimeLocal(new Date()),
      });
      setShowForm(false);
      await loadIncidents({ silent: true });
    } catch (error) {
      console.error('[PortalIncidents] submit failed:', error);
      toast.error(error.message || 'Could not submit incident');
    } finally {
      setSaving(false);
    }
  };

  const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  if (loading) return <div style={styles.loading}>Loading incidents...</div>;

  return (
    <div style={styles.page}>
      <section style={styles.hero}>
        <div style={styles.eyebrow}>Employee Incident Tracker</div>
        <h1 style={styles.title}>Incidents</h1>
        <p style={styles.subtitle}>
          Submit workplace incidents and view incidents that are visible to you.
        </p>
        {business?.name && <p style={styles.businessName}>{business.name}</p>}
      </section>

      <section style={styles.summaryGrid}>
        <SummaryCard label="Open / Reviewing" value={counts.open} />
        <SummaryCard label="Resolved / Closed" value={counts.closed} success />
        <SummaryCard label="Critical" value={counts.critical} danger />
      </section>

      <section style={styles.actions}>
        <button type="button" style={styles.primaryButton} onClick={() => setShowForm((current) => !current)}>
          <Plus size={16} />
          {showForm ? 'Hide Form' : 'Report Incident'}
        </button>
        <button type="button" style={styles.secondaryButton} onClick={() => loadIncidents({ silent: true })}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </section>

      {showForm && (
        <form style={styles.formCard} onSubmit={submitIncident}>
          <h2 style={styles.sectionTitle}>Report an Incident</h2>
          <label style={styles.label}>Title</label>
          <input value={form.title} onChange={(event) => updateForm('title', event.target.value)} style={styles.input} required />

          <div style={styles.twoColumns}>
            <div>
              <label style={styles.label}>Type</label>
              <select value={form.incident_type} onChange={(event) => updateForm('incident_type', event.target.value)} style={styles.input}>
                {INCIDENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </div>
            <div>
              <label style={styles.label}>Severity</label>
              <select value={form.severity} onChange={(event) => updateForm('severity', event.target.value)} style={styles.input}>
                {SEVERITIES.map((severity) => <option key={severity.value} value={severity.value}>{severity.label}</option>)}
              </select>
            </div>
          </div>

          <div style={styles.twoColumns}>
            <div>
              <label style={styles.label}>When did it happen?</label>
              <input type="datetime-local" value={form.occurred_at} onChange={(event) => updateForm('occurred_at', event.target.value)} style={styles.input} />
            </div>
            <div>
              <label style={styles.label}>Location</label>
              <input value={form.location} onChange={(event) => updateForm('location', event.target.value)} style={styles.input} placeholder="Optional" />
            </div>
          </div>

          <label style={styles.label}>Details</label>
          <textarea value={form.description} onChange={(event) => updateForm('description', event.target.value)} style={styles.textarea} rows={5} required />

          <button type="submit" style={styles.primaryButton} disabled={saving}>
            <Send size={16} />
            {saving ? 'Submitting...' : 'Submit Incident'}
          </button>
        </form>
      )}

      <section style={styles.list}>
        {incidents.length === 0 ? (
          <div style={styles.empty}>No visible incidents right now.</div>
        ) : (
          incidents.map((incident) => (
            <article key={incident.id} style={styles.card}>
              <div style={styles.cardTop}>
                <div style={{ ...styles.iconWrap, ...getSeverityTone(incident.severity) }}>
                  <AlertTriangle size={20} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={styles.meta}>{formatType(incident.incident_type)} • {formatStatus(incident.severity)}</div>
                  <h3 style={styles.cardTitle}>{incident.title}</h3>
                  <div style={styles.metaText}>
                    {formatDateTime(incident.occurred_at || incident.created_at)}
                    {incident.location ? ` • ${incident.location}` : ''}
                  </div>
                  {incident.description && <p style={styles.bodyText}>{incident.description}</p>}
                  {incident.resolution_notes && <p style={styles.noteText}>Resolution: {incident.resolution_notes}</p>}
                </div>
                <span style={{ ...styles.statusPill, ...getStatusTone(incident.status) }}>{formatStatus(incident.status)}</span>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
};

const SummaryCard = ({ label, value, danger, success }) => (
  <div style={{ ...styles.summaryCard, ...(danger ? styles.dangerCard : {}), ...(success ? styles.successCard : {}) }}>
    <div style={styles.summaryValue}>{value}</div>
    <div style={styles.summaryLabel}>{label}</div>
  </div>
);

const toDatetimeLocal = (date) => {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const formatType = (value = '') => INCIDENT_TYPES.find((type) => type.value === value)?.label || formatStatus(value);
const formatStatus = (value = '') => String(value || '').replace(/_/g, ' ');
const formatDateTime = (value) => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const getSeverityTone = (severity) => ({
  low: { backgroundColor: '#dcfce7', color: '#166534' },
  normal: { backgroundColor: '#dbeafe', color: '#1d4ed8' },
  high: { backgroundColor: '#fef3c7', color: '#92400e' },
  critical: { backgroundColor: '#fee2e2', color: '#991b1b' },
}[severity] || { backgroundColor: '#f3f4f6', color: '#374151' });
const getStatusTone = (status) => ({
  open: { backgroundColor: '#fee2e2', color: '#991b1b' },
  reviewing: { backgroundColor: '#fef3c7', color: '#92400e' },
  resolved: { backgroundColor: '#dcfce7', color: '#166534' },
  closed: { backgroundColor: '#e5e7eb', color: '#374151' },
}[status] || { backgroundColor: '#e5e7eb', color: '#374151' });

const styles = {
  loading: { minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: TavariStyles.colors.gray600 },
  page: { width: '100%', maxWidth: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: TavariStyles.spacing.lg, boxSizing: 'border-box', overflowX: 'hidden' },
  hero: { background: 'linear-gradient(135deg, #7c2d12, #ea580c)', color: TavariStyles.colors.white, borderRadius: '24px', padding: TavariStyles.spacing.xl, boxShadow: TavariStyles.shadows?.lg || '0 10px 20px rgba(0,0,0,0.15)', boxSizing: 'border-box' },
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
  actions: { display: 'flex', gap: TavariStyles.spacing.sm, flexWrap: 'wrap' },
  primaryButton: { border: 'none', borderRadius: '12px', padding: '10px 14px', backgroundColor: '#ea580c', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 800, cursor: 'pointer' },
  secondaryButton: { border: `1px solid ${TavariStyles.colors.gray300}`, borderRadius: '12px', padding: '10px 14px', backgroundColor: TavariStyles.colors.white, color: TavariStyles.colors.gray800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 800, cursor: 'pointer' },
  formCard: { backgroundColor: TavariStyles.colors.white, border: `1px solid ${TavariStyles.colors.gray200}`, borderRadius: '18px', padding: TavariStyles.spacing.lg, boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)' },
  sectionTitle: { margin: '0 0 12px', color: TavariStyles.colors.gray900 },
  twoColumns: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' },
  label: { display: 'block', margin: '12px 0 6px', fontWeight: 700, color: TavariStyles.colors.gray700, fontSize: '13px' },
  input: { width: '100%', border: '1px solid #d1d5db', borderRadius: '12px', padding: '11px 12px', boxSizing: 'border-box', fontSize: '15px' },
  textarea: { width: '100%', border: '1px solid #d1d5db', borderRadius: '12px', padding: '11px 12px', boxSizing: 'border-box', fontSize: '15px', resize: 'vertical' },
  list: { display: 'grid', gap: TavariStyles.spacing.md },
  empty: { padding: TavariStyles.spacing.xl, borderRadius: '18px', backgroundColor: TavariStyles.colors.white, border: `1px solid ${TavariStyles.colors.gray200}`, textAlign: 'center', color: TavariStyles.colors.gray600 },
  card: { backgroundColor: TavariStyles.colors.white, border: `1px solid ${TavariStyles.colors.gray200}`, borderRadius: '18px', padding: TavariStyles.spacing.lg, boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)' },
  cardTop: { display: 'flex', gap: TavariStyles.spacing.md, alignItems: 'flex-start' },
  iconWrap: { width: '42px', height: '42px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  meta: { color: TavariStyles.colors.gray500, fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' },
  cardTitle: { margin: '4px 0', color: TavariStyles.colors.gray900 },
  metaText: { color: TavariStyles.colors.gray600, fontSize: TavariStyles.typography.fontSize.sm },
  bodyText: { marginTop: TavariStyles.spacing.md, color: TavariStyles.colors.gray700, lineHeight: 1.55, whiteSpace: 'pre-wrap' },
  noteText: { marginTop: TavariStyles.spacing.md, padding: TavariStyles.spacing.md, borderRadius: '12px', backgroundColor: '#f8fafc', color: TavariStyles.colors.gray700 },
  statusPill: { borderRadius: '999px', padding: '6px 10px', fontSize: '13px', fontWeight: 800, textTransform: 'capitalize', whiteSpace: 'nowrap' },
};

export default PortalIncidents;
