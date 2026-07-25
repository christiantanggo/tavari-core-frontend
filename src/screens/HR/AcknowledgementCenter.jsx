import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, FileWarning, Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';

const ITEM_TYPES = [
  { value: 'writeup', label: 'Write-Up' },
  { value: 'disciplinary_action', label: 'Disciplinary Action' },
  { value: 'termination', label: 'Termination' },
  { value: 'important_notice', label: 'Important Notice' },
];

const SEVERITIES = [
  { value: 'normal', label: 'Normal' },
  { value: 'important', label: 'Important' },
  { value: 'critical', label: 'Critical' },
];

const STATUS_FILTERS = [
  { value: 'pending', label: 'Pending' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'all', label: 'All' },
];

const AcknowledgementCenter = ({ businessId }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [items, setItems] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [showModal, setShowModal] = useState(false);
  const [selectedEmployees, setSelectedEmployees] = useState([]);
  const [form, setForm] = useState({
    item_type: 'important_notice',
    severity: 'important',
    title: '',
    body: '',
    due_date: '',
    manager_note: '',
  });

  const filteredItems = useMemo(() => {
    const activeItems = items.filter((item) => !item.cancelled_at);
    if (statusFilter === 'all') return activeItems;
    if (statusFilter === 'pending') return activeItems.filter((item) => !item.acknowledged_at);
    if (statusFilter === 'acknowledged') return activeItems.filter((item) => item.acknowledged_at);
    if (statusFilter === 'overdue') return activeItems.filter((item) => !item.acknowledged_at && isOverdue(item.due_date));
    return activeItems;
  }, [items, statusFilter]);

  const stats = useMemo(() => {
    const activeItems = items.filter((item) => !item.cancelled_at);
    const pending = activeItems.filter((item) => !item.acknowledged_at).length;
    return {
      total: activeItems.length,
      pending,
      overdue: activeItems.filter((item) => !item.acknowledged_at && isOverdue(item.due_date)).length,
      acknowledged: activeItems.length - pending,
    };
  }, [items]);

  useEffect(() => {
    if (!businessId) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([loadEmployees(), loadAcknowledgements()]);
    } catch (error) {
      console.error('Error loading acknowledgements:', error);
      toast.error(error.message || 'Failed to load acknowledgements');
    } finally {
      setLoading(false);
    }
  };

  const loadEmployees = async () => {
    const { data, error } = await supabase
      .from('business_users')
      .select(`
        user_id,
        role,
        users!business_users_user_id_fkey (
          id,
          full_name,
          email,
          employment_status,
          status
        )
      `)
      .eq('business_id', businessId);

    if (error) throw error;

    const rows = (data || [])
      .map((row) => row.users ? { ...row.users, role: row.role } : null)
      .filter(Boolean)
      .sort((a, b) => String(a.full_name || a.email || '').localeCompare(String(b.full_name || b.email || '')));

    setEmployees(rows);
  };

  const loadAcknowledgements = async () => {
    const { data, error } = await supabase
      .from('hr_employee_acknowledgements')
      .select(`
        *,
        users!hr_employee_acknowledgements_employee_id_fkey (
          id,
          full_name,
          email,
          employment_status,
          status
        )
      `)
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    setItems(data || []);
  };

  const createAcknowledgements = async (event) => {
    event.preventDefault();
    if (!form.title.trim()) {
      toast.error('Add a title');
      return;
    }
    if (selectedEmployees.length === 0) {
      toast.error('Choose at least one employee');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const rows = selectedEmployees.map((employeeId) => ({
        business_id: businessId,
        employee_id: employeeId,
        item_type: form.item_type,
        severity: form.severity,
        title: form.title.trim(),
        body: cleanText(form.body),
        due_date: form.due_date || null,
        manager_note: cleanText(form.manager_note),
        created_by: user?.id,
      }));

      const { error } = await supabase
        .from('hr_employee_acknowledgements')
        .insert(rows);

      if (error) throw error;

      toast.success('Acknowledgement assigned');
      setShowModal(false);
      setSelectedEmployees([]);
      setForm({
        item_type: 'important_notice',
        severity: 'important',
        title: '',
        body: '',
        due_date: '',
        manager_note: '',
      });
      await loadAcknowledgements();
    } catch (error) {
      console.error('Error creating acknowledgement:', error);
      toast.error(error.message || 'Failed to assign acknowledgement');
    } finally {
      setSaving(false);
    }
  };

  const cancelAcknowledgement = async (item) => {
    const confirmed = window.confirm('Cancel this acknowledgement requirement?');
    if (!confirmed) return;

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('hr_employee_acknowledgements')
        .update({
          cancelled_at: new Date().toISOString(),
          cancelled_by: user?.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id)
        .eq('business_id', businessId);

      if (error) throw error;
      toast.success('Acknowledgement cancelled');
      await loadAcknowledgements();
    } catch (error) {
      console.error('Error cancelling acknowledgement:', error);
      toast.error(error.message || 'Failed to cancel acknowledgement');
    } finally {
      setSaving(false);
    }
  };

  const toggleEmployee = (employeeId) => {
    setSelectedEmployees((current) => (
      current.includes(employeeId)
        ? current.filter((id) => id !== employeeId)
        : [...current, employeeId]
    ));
  };

  if (loading) return <div style={styles.empty}>Loading acknowledgements...</div>;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>HR Acknowledgements</div>
          <h2 style={styles.title}>Forced Acknowledgements</h2>
          <p style={styles.subtitle}>Assign required acknowledgements for write-ups, disciplinary actions, terminations, and important notices.</p>
        </div>
        <button type="button" style={styles.primaryButton} onClick={() => setShowModal(true)}>
          <Plus size={16} />
          New Acknowledgement
        </button>
      </div>

      <div style={styles.statsGrid}>
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Pending" value={stats.pending} />
        <StatCard label="Overdue" value={stats.overdue} danger />
        <StatCard label="Acknowledged" value={stats.acknowledged} success />
      </div>

      <div style={styles.filters}>
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => setStatusFilter(filter.value)}
            style={{
              ...styles.filterButton,
              ...(statusFilter === filter.value ? styles.filterButtonActive : {})
            }}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {filteredItems.length === 0 ? (
        <div style={styles.empty}>No acknowledgement records found.</div>
      ) : (
        <div style={styles.grid}>
          {filteredItems.map((item) => {
            const overdue = !item.acknowledged_at && isOverdue(item.due_date);
            return (
              <article key={item.id} style={{ ...styles.card, ...(overdue ? styles.cardOverdue : {}) }}>
                <div style={styles.cardTop}>
                  <div style={styles.iconWrap}>
                    {item.acknowledged_at ? <CheckCircle size={20} /> : <FileWarning size={20} />}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={styles.meta}>{formatItemType(item.item_type)} • {formatStatus(item.severity)}</div>
                    <h3 style={styles.cardTitle}>{item.title}</h3>
                    <p style={styles.employeeName}>{item.users?.full_name || item.users?.email || 'Employee'}</p>
                    {item.due_date && <p style={styles.detail}>Due {formatDate(item.due_date)}</p>}
                    {item.acknowledged_at && <p style={styles.ackText}>Acknowledged {formatDateTime(item.acknowledged_at)}</p>}
                    {item.body && <p style={styles.body}>{item.body}</p>}
                    {item.employee_note && <p style={styles.note}>Employee note: {item.employee_note}</p>}
                  </div>
                </div>
                {!item.acknowledged_at && !item.cancelled_at && (
                  <button type="button" style={styles.cancelButton} onClick={() => cancelAcknowledgement(item)} disabled={saving}>
                    Cancel Requirement
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}

      {showModal && (
        <div style={styles.modalOverlay}>
          <form style={styles.modal} onSubmit={createAcknowledgements}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>New Forced Acknowledgement</h3>
              <button type="button" style={styles.iconButton} onClick={() => setShowModal(false)}>
                <X size={20} />
              </button>
            </div>

            <div style={styles.twoColumns}>
              <div>
                <label style={styles.label}>Type</label>
                <select value={form.item_type} onChange={(event) => setForm((current) => ({ ...current, item_type: event.target.value }))} style={styles.input}>
                  {ITEM_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
              </div>
              <div>
                <label style={styles.label}>Severity</label>
                <select value={form.severity} onChange={(event) => setForm((current) => ({ ...current, severity: event.target.value }))} style={styles.input}>
                  {SEVERITIES.map((severity) => <option key={severity.value} value={severity.value}>{severity.label}</option>)}
                </select>
              </div>
            </div>

            <Field label="Title" value={form.title} onChange={(value) => setForm((current) => ({ ...current, title: value }))} required />
            <TextArea label="Details" value={form.body} onChange={(value) => setForm((current) => ({ ...current, body: value }))} rows={6} />
            <Field label="Due Date" type="date" value={form.due_date} onChange={(value) => setForm((current) => ({ ...current, due_date: value }))} />
            <TextArea label="Manager Note" value={form.manager_note} onChange={(value) => setForm((current) => ({ ...current, manager_note: value }))} />

            <label style={styles.label}>Employees</label>
            <div style={styles.employeePicker}>
              {employees.map((employee) => (
                <label key={employee.id} style={styles.employeeOption}>
                  <input
                    type="checkbox"
                    checked={selectedEmployees.includes(employee.id)}
                    onChange={() => toggleEmployee(employee.id)}
                  />
                  <span>{employee.full_name || employee.email}</span>
                </label>
              ))}
            </div>

            <div style={styles.modalActions}>
              <button type="button" style={styles.secondaryButton} onClick={() => setShowModal(false)}>Cancel</button>
              <button type="submit" style={styles.primaryButton} disabled={saving}>{saving ? 'Assigning...' : 'Assign Acknowledgement'}</button>
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
const isOverdue = (date) => Boolean(date && new Date(`${date}T23:59:59`) < new Date());
const formatItemType = (value = '') => ITEM_TYPES.find((type) => type.value === value)?.label || String(value).replace(/_/g, ' ');
const formatStatus = (value = '') => String(value || '').replace(/_/g, ' ');
const formatDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const formatDateTime = (value) => value ? new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';

const styles = {
  container: { padding: '24px', backgroundColor: '#f8fafc', minHeight: '640px' },
  header: { display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start', marginBottom: '18px', flexWrap: 'wrap' },
  eyebrow: { fontSize: '13px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#dc2626', fontWeight: 800 },
  title: { margin: '4px 0', fontSize: '26px', color: TavariStyles.colors.gray900 },
  subtitle: { margin: 0, color: TavariStyles.colors.gray600 },
  primaryButton: { border: 'none', borderRadius: '12px', padding: '10px 14px', backgroundColor: '#dc2626', color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 800, cursor: 'pointer' },
  secondaryButton: { border: '1px solid #d1d5db', borderRadius: '12px', padding: '10px 14px', backgroundColor: 'white', color: TavariStyles.colors.gray800, fontWeight: 800, cursor: 'pointer' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '18px' },
  statCard: { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '16px', padding: '16px' },
  statDanger: { borderColor: '#fecaca', backgroundColor: '#fef2f2' },
  statSuccess: { borderColor: '#bbf7d0', backgroundColor: '#f0fdf4' },
  statValue: { fontSize: '28px', fontWeight: 800, color: TavariStyles.colors.gray900 },
  statLabel: { color: TavariStyles.colors.gray600, fontSize: '13px' },
  filters: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' },
  filterButton: { border: '1px solid #d1d5db', backgroundColor: 'white', color: TavariStyles.colors.gray700, borderRadius: '999px', padding: '8px 12px', fontWeight: 700, cursor: 'pointer' },
  filterButtonActive: { backgroundColor: '#dc2626', borderColor: '#dc2626', color: 'white' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px' },
  card: { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '18px', padding: '16px', boxShadow: '0 10px 24px rgba(15,23,42,0.06)' },
  cardOverdue: { borderColor: '#fca5a5', boxShadow: '0 10px 24px rgba(220,38,38,0.12)' },
  cardTop: { display: 'flex', gap: '12px', alignItems: 'flex-start' },
  iconWrap: { width: '42px', height: '42px', borderRadius: '14px', backgroundColor: '#fee2e2', color: '#991b1b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  meta: { color: TavariStyles.colors.gray500, fontSize: '13px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' },
  cardTitle: { margin: '4px 0', color: TavariStyles.colors.gray900 },
  employeeName: { margin: 0, color: TavariStyles.colors.gray600 },
  detail: { margin: '8px 0 0', color: TavariStyles.colors.gray700, fontSize: '14px' },
  ackText: { margin: '8px 0 0', color: '#166534', fontWeight: 700 },
  body: { margin: '12px 0 0', color: TavariStyles.colors.gray700, lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  note: { margin: '10px 0 0', padding: '10px', borderRadius: '12px', backgroundColor: '#f8fafc', color: TavariStyles.colors.gray700 },
  cancelButton: { marginTop: '12px', border: '1px solid #fecaca', borderRadius: '12px', padding: '9px 12px', backgroundColor: '#fff1f2', color: '#be123c', fontWeight: 800, cursor: 'pointer' },
  empty: { padding: '28px', textAlign: 'center', borderRadius: '16px', backgroundColor: 'white', border: '1px solid #e5e7eb', color: TavariStyles.colors.gray600 },
  modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', zIndex: 9999 },
  modal: { width: 'min(680px, 100%)', maxHeight: '90vh', overflowY: 'auto', backgroundColor: 'white', borderRadius: '18px', padding: '20px', boxSizing: 'border-box' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '14px' },
  modalTitle: { margin: 0, color: TavariStyles.colors.gray900 },
  iconButton: { border: 'none', backgroundColor: 'transparent', cursor: 'pointer', color: TavariStyles.colors.gray700 },
  twoColumns: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' },
  label: { display: 'block', margin: '12px 0 6px', fontWeight: 700, color: TavariStyles.colors.gray700, fontSize: '13px' },
  input: { width: '100%', border: '1px solid #d1d5db', borderRadius: '12px', padding: '11px 12px', boxSizing: 'border-box', fontSize: '15px' },
  textarea: { width: '100%', border: '1px solid #d1d5db', borderRadius: '12px', padding: '11px 12px', boxSizing: 'border-box', fontSize: '15px', resize: 'vertical' },
  employeePicker: { marginTop: '8px', display: 'grid', gap: '8px', maxHeight: '220px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '10px' },
  employeeOption: { display: 'flex', alignItems: 'center', gap: '8px', color: TavariStyles.colors.gray800 },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px', flexWrap: 'wrap' },
};

export default AcknowledgementCenter;
