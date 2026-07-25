import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus, X } from 'lucide-react';
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

const STATUSES = ['open', 'reviewing', 'resolved', 'closed'];
const SEVERITIES = ['low', 'normal', 'high', 'critical'];

const IncidentCenter = ({ businessId }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [statusFilter, setStatusFilter] = useState('open');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    incident_type: 'general',
    severity: 'normal',
    status: 'open',
    occurred_at: toDatetimeLocal(new Date()),
    location: '',
    reported_by_employee_id: '',
    subject_employee_id: '',
    employee_visible: true,
    manager_notes: '',
  });

  const filteredIncidents = useMemo(() => {
    if (statusFilter === 'all') return incidents;
    return incidents.filter((incident) => incident.status === statusFilter);
  }, [incidents, statusFilter]);

  const stats = useMemo(() => ({
    open: incidents.filter((incident) => incident.status === 'open').length,
    reviewing: incidents.filter((incident) => incident.status === 'reviewing').length,
    critical: incidents.filter((incident) => incident.severity === 'critical' && !['resolved', 'closed'].includes(incident.status)).length,
    closed: incidents.filter((incident) => ['resolved', 'closed'].includes(incident.status)).length,
  }), [incidents]);

  useEffect(() => {
    if (!businessId) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([loadEmployees(), loadIncidents()]);
    } catch (error) {
      console.error('Error loading incidents:', error);
      toast.error(error.message || 'Failed to load incidents');
    } finally {
      setLoading(false);
    }
  };

  const loadEmployees = async () => {
    const { data, error } = await supabase
      .from('business_users')
      .select('user_id, users!business_users_user_id_fkey(id, full_name, email, employment_status, status)')
      .eq('business_id', businessId);

    if (error) throw error;

    setEmployees((data || [])
      .map((row) => row.users)
      .filter(Boolean)
      .sort((a, b) => String(a.full_name || a.email || '').localeCompare(String(b.full_name || b.email || ''))));
  };

  const loadIncidents = async () => {
    const { data, error } = await supabase
      .from('hr_incidents')
      .select(`
        *,
        reported_by:reported_by_employee_id(id, full_name, email),
        subject_employee:subject_employee_id(id, full_name, email)
      `)
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    setIncidents(data || []);
  };

  const createIncident = async (event) => {
    event.preventDefault();
    if (!form.title.trim()) {
      toast.error('Add an incident title');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('hr_incidents')
        .insert({
          business_id: businessId,
          title: form.title.trim(),
          description: cleanText(form.description),
          incident_type: form.incident_type,
          severity: form.severity,
          status: form.status,
          occurred_at: form.occurred_at ? new Date(form.occurred_at).toISOString() : null,
          location: cleanText(form.location),
          reported_by_employee_id: form.reported_by_employee_id || null,
          subject_employee_id: form.subject_employee_id || null,
          employee_visible: form.employee_visible,
          manager_notes: cleanText(form.manager_notes),
          created_by: user?.id,
        });

      if (error) throw error;
      toast.success('Incident created');
      setShowModal(false);
      resetForm();
      await loadIncidents();
    } catch (error) {
      console.error('Error creating incident:', error);
      toast.error(error.message || 'Failed to create incident');
    } finally {
      setSaving(false);
    }
  };

  const updateIncident = async (incident, patch) => {
    setSaving(true);
    try {
      const payload = {
        ...patch,
        updated_at: new Date().toISOString(),
      };
      if (patch.status === 'closed' || patch.status === 'resolved') {
        payload.closed_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('hr_incidents')
        .update(payload)
        .eq('id', incident.id)
        .eq('business_id', businessId);

      if (error) throw error;
      await loadIncidents();
    } catch (error) {
      console.error('Error updating incident:', error);
      toast.error(error.message || 'Failed to update incident');
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => setForm({
    title: '',
    description: '',
    incident_type: 'general',
    severity: 'normal',
    status: 'open',
    occurred_at: toDatetimeLocal(new Date()),
    location: '',
    reported_by_employee_id: '',
    subject_employee_id: '',
    employee_visible: true,
    manager_notes: '',
  });

  if (loading) return <div style={styles.empty}>Loading incident tracker...</div>;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>HR Incidents</div>
          <h2 style={styles.title}>Incident Tracker</h2>
          <p style={styles.subtitle}>Review employee-submitted incidents and control which records employees can see.</p>
        </div>
        <button type="button" style={styles.primaryButton} onClick={() => setShowModal(true)}>
          <Plus size={16} />
          New Incident
        </button>
      </div>

      <div style={styles.statsGrid}>
        <StatCard label="Open" value={stats.open} />
        <StatCard label="Reviewing" value={stats.reviewing} />
        <StatCard label="Critical Open" value={stats.critical} danger />
        <StatCard label="Resolved / Closed" value={stats.closed} success />
      </div>

      <div style={styles.filters}>
        {['open', 'reviewing', 'resolved', 'closed', 'all'].map((status) => (
          <button key={status} type="button" onClick={() => setStatusFilter(status)} style={{ ...styles.filterButton, ...(statusFilter === status ? styles.filterButtonActive : {}) }}>
            {formatStatus(status)}
          </button>
        ))}
      </div>

      {filteredIncidents.length === 0 ? (
        <div style={styles.empty}>No incidents found.</div>
      ) : (
        <div style={styles.grid}>
          {filteredIncidents.map((incident) => (
            <article key={incident.id} style={styles.card}>
              <div style={styles.cardTop}>
                <div style={{ ...styles.iconWrap, ...getSeverityTone(incident.severity) }}>
                  <AlertTriangle size={20} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={styles.meta}>{formatType(incident.incident_type)} • {formatStatus(incident.severity)}</div>
                  <h3 style={styles.cardTitle}>{incident.title}</h3>
                  <p style={styles.detail}>
                    {formatDateTime(incident.occurred_at || incident.created_at)}
                    {incident.location ? ` • ${incident.location}` : ''}
                  </p>
                  <p style={styles.detail}>Reported by: {incident.reported_by?.full_name || incident.reported_by?.email || 'Unknown'}</p>
                  {incident.subject_employee && <p style={styles.detail}>Visible employee: {incident.subject_employee.full_name || incident.subject_employee.email}</p>}
                  {incident.description && <p style={styles.body}>{incident.description}</p>}
                  {incident.manager_notes && <p style={styles.note}>Manager note: {incident.manager_notes}</p>}
                  {incident.resolution_notes && <p style={styles.note}>Resolution: {incident.resolution_notes}</p>}
                </div>
              </div>
              <div style={styles.cardActions}>
                <select value={incident.status} onChange={(event) => updateIncident(incident, { status: event.target.value })} style={styles.input} disabled={saving}>
                  {STATUSES.map((status) => <option key={status} value={status}>{formatStatus(status)}</option>)}
                </select>
                <button type="button" style={incident.employee_visible ? styles.visibilityOn : styles.visibilityOff} onClick={() => updateIncident(incident, { employee_visible: !incident.employee_visible })} disabled={saving}>
                  {incident.employee_visible ? 'Employee Visible' : 'Hidden From Employee'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {showModal && (
        <div style={styles.modalOverlay}>
          <form style={styles.modal} onSubmit={createIncident}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>New Incident</h3>
              <button type="button" style={styles.iconButton} onClick={() => setShowModal(false)}>
                <X size={20} />
              </button>
            </div>

            <Field label="Title" value={form.title} onChange={(value) => setForm((current) => ({ ...current, title: value }))} required />
            <TextArea label="Details" value={form.description} onChange={(value) => setForm((current) => ({ ...current, description: value }))} rows={5} />

            <div style={styles.twoColumns}>
              <Select label="Type" value={form.incident_type} options={INCIDENT_TYPES} onChange={(value) => setForm((current) => ({ ...current, incident_type: value }))} />
              <Select label="Severity" value={form.severity} options={SEVERITIES.map((value) => ({ value, label: formatStatus(value) }))} onChange={(value) => setForm((current) => ({ ...current, severity: value }))} />
            </div>

            <div style={styles.twoColumns}>
              <Field label="Occurred At" type="datetime-local" value={form.occurred_at} onChange={(value) => setForm((current) => ({ ...current, occurred_at: value }))} />
              <Field label="Location" value={form.location} onChange={(value) => setForm((current) => ({ ...current, location: value }))} />
            </div>

            <div style={styles.twoColumns}>
              <EmployeeSelect label="Reported By" value={form.reported_by_employee_id} employees={employees} onChange={(value) => setForm((current) => ({ ...current, reported_by_employee_id: value }))} />
              <EmployeeSelect label="Visible Employee / Subject" value={form.subject_employee_id} employees={employees} onChange={(value) => setForm((current) => ({ ...current, subject_employee_id: value }))} />
            </div>

            <TextArea label="Manager Notes" value={form.manager_notes} onChange={(value) => setForm((current) => ({ ...current, manager_notes: value }))} />
            <label style={styles.checkboxLabel}>
              <input type="checkbox" checked={form.employee_visible} onChange={(event) => setForm((current) => ({ ...current, employee_visible: event.target.checked }))} />
              Visible to involved employee(s)
            </label>

            <div style={styles.modalActions}>
              <button type="button" style={styles.secondaryButton} onClick={() => setShowModal(false)}>Cancel</button>
              <button type="submit" style={styles.primaryButton} disabled={saving}>{saving ? 'Saving...' : 'Create Incident'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

const Field = ({ label, value, onChange, type = 'text', required = false }) => (
  <div>
    <label style={styles.label}>{label}</label>
    <input type={type} value={value} onChange={(event) => onChange(event.target.value)} style={styles.input} required={required} />
  </div>
);

const TextArea = ({ label, value, onChange, rows = 4 }) => (
  <div>
    <label style={styles.label}>{label}</label>
    <textarea value={value} onChange={(event) => onChange(event.target.value)} style={styles.textarea} rows={rows} />
  </div>
);

const Select = ({ label, value, options, onChange }) => (
  <div>
    <label style={styles.label}>{label}</label>
    <select value={value} onChange={(event) => onChange(event.target.value)} style={styles.input}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </div>
);

const EmployeeSelect = ({ label, value, employees, onChange }) => (
  <div>
    <label style={styles.label}>{label}</label>
    <select value={value} onChange={(event) => onChange(event.target.value)} style={styles.input}>
      <option value="">None selected</option>
      {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name || employee.email}</option>)}
    </select>
  </div>
);

const StatCard = ({ label, value, danger, success }) => (
  <div style={{ ...styles.statCard, ...(danger ? styles.statDanger : {}), ...(success ? styles.statSuccess : {}) }}>
    <div style={styles.statValue}>{value}</div>
    <div style={styles.statLabel}>{label}</div>
  </div>
);

const cleanText = (value) => {
  const text = String(value || '').trim();
  return text || null;
};
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

const styles = {
  container: { padding: '24px', backgroundColor: '#f8fafc', minHeight: '640px' },
  header: { display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start', marginBottom: '18px', flexWrap: 'wrap' },
  eyebrow: { fontSize: '13px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#ea580c', fontWeight: 800 },
  title: { margin: '4px 0', fontSize: '26px', color: TavariStyles.colors.gray900 },
  subtitle: { margin: 0, color: TavariStyles.colors.gray600 },
  primaryButton: { border: 'none', borderRadius: '12px', padding: '10px 14px', backgroundColor: '#ea580c', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 800, cursor: 'pointer' },
  secondaryButton: { border: '1px solid #d1d5db', borderRadius: '12px', padding: '10px 14px', backgroundColor: 'white', color: TavariStyles.colors.gray800, fontWeight: 800, cursor: 'pointer' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '18px' },
  statCard: { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '16px', padding: '16px' },
  statDanger: { borderColor: '#fecaca', backgroundColor: '#fef2f2' },
  statSuccess: { borderColor: '#bbf7d0', backgroundColor: '#f0fdf4' },
  statValue: { fontSize: '28px', fontWeight: 800, color: TavariStyles.colors.gray900 },
  statLabel: { color: TavariStyles.colors.gray600, fontSize: '13px' },
  filters: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' },
  filterButton: { border: '1px solid #d1d5db', backgroundColor: 'white', color: TavariStyles.colors.gray700, borderRadius: '999px', padding: '8px 12px', fontWeight: 700, cursor: 'pointer' },
  filterButtonActive: { backgroundColor: '#ea580c', borderColor: '#ea580c', color: 'white' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '12px' },
  card: { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '18px', padding: '16px', boxShadow: '0 10px 24px rgba(15,23,42,0.06)' },
  cardTop: { display: 'flex', gap: '12px', alignItems: 'flex-start' },
  iconWrap: { width: '42px', height: '42px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  meta: { color: TavariStyles.colors.gray500, fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' },
  cardTitle: { margin: '4px 0', color: TavariStyles.colors.gray900 },
  detail: { margin: '8px 0 0', color: TavariStyles.colors.gray700, fontSize: '14px' },
  body: { margin: '12px 0 0', color: TavariStyles.colors.gray700, lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  note: { margin: '10px 0 0', padding: '10px', borderRadius: '12px', backgroundColor: '#f8fafc', color: TavariStyles.colors.gray700 },
  cardActions: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '10px', marginTop: '14px', alignItems: 'center' },
  visibilityOn: { border: '1px solid #bbf7d0', borderRadius: '12px', padding: '10px 12px', backgroundColor: '#f0fdf4', color: '#166534', fontWeight: 800, cursor: 'pointer' },
  visibilityOff: { border: '1px solid #d1d5db', borderRadius: '12px', padding: '10px 12px', backgroundColor: '#f9fafb', color: TavariStyles.colors.gray700, fontWeight: 800, cursor: 'pointer' },
  empty: { padding: '28px', textAlign: 'center', borderRadius: '16px', backgroundColor: 'white', border: '1px solid #e5e7eb', color: TavariStyles.colors.gray600 },
  modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', zIndex: 9999 },
  modal: { width: 'min(720px, 100%)', maxHeight: '90vh', overflowY: 'auto', backgroundColor: 'white', borderRadius: '18px', padding: '20px', boxSizing: 'border-box' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '14px' },
  modalTitle: { margin: 0, color: TavariStyles.colors.gray900 },
  iconButton: { border: 'none', backgroundColor: 'transparent', cursor: 'pointer', color: TavariStyles.colors.gray700 },
  twoColumns: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' },
  label: { display: 'block', margin: '12px 0 6px', fontWeight: 700, color: TavariStyles.colors.gray700, fontSize: '13px' },
  input: { width: '100%', border: '1px solid #d1d5db', borderRadius: '12px', padding: '11px 12px', boxSizing: 'border-box', fontSize: '15px' },
  textarea: { width: '100%', border: '1px solid #d1d5db', borderRadius: '12px', padding: '11px 12px', boxSizing: 'border-box', fontSize: '15px', resize: 'vertical' },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', color: TavariStyles.colors.gray700, fontWeight: 700 },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px', flexWrap: 'wrap' },
};

export default IncidentCenter;
