import React, { useEffect, useState } from 'react';
import { CalendarDays, RefreshCw, Send, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import DateDropdownInput from '../../components/UI/DateDropdownInput';

const REQUEST_TYPES = [
  { value: 'vacation', label: 'Vacation' },
  { value: 'sick', label: 'Sick' },
  { value: 'personal', label: 'Personal' },
  { value: 'bereavement', label: 'Bereavement' },
  { value: 'jury_duty', label: 'Jury Duty' },
  { value: 'other', label: 'Other' },
];

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const getLocalDateString = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const PortalTimeOff = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [business, setBusiness] = useState(null);
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState({
    request_type: 'vacation',
    start_date: getLocalDateString(addDays(new Date(), 1)),
    end_date: getLocalDateString(addDays(new Date(), 1)),
    is_partial_day: false,
    start_time: '09:00',
    end_time: '17:00',
    notes: '',
  });

  const loadTimeOff = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const { data, error } = await supabase.functions.invoke('employee-time-off-action', {
        body: { action: 'list' }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setBusiness(data.business || null);
      setRequests(data.requests || []);
    } catch (error) {
      console.error('[PortalTimeOff] load failed:', error);
      toast.error(error.message || 'Could not load time-off requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTimeOff();
  }, []);

  const submitTimeOff = async (event) => {
    event.preventDefault();
    if (new Date(`${form.end_date}T12:00:00`) < new Date(`${form.start_date}T12:00:00`)) {
      toast.error('End date must be on or after start date');
      return;
    }
    if (form.is_partial_day && form.start_time >= form.end_time) {
      toast.error('End time must be after start time');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('employee-time-off-action', {
        body: {
          action: 'submit',
          ...form,
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success('Time-off request submitted');
      setForm((current) => ({ ...current, notes: '' }));
      await loadTimeOff({ silent: true });
    } catch (error) {
      console.error('[PortalTimeOff] submit failed:', error);
      toast.error(error.message || 'Could not submit time-off request');
    } finally {
      setSaving(false);
    }
  };

  const cancelRequest = async (requestId) => {
    const confirmed = window.confirm('Cancel this time-off request?');
    if (!confirmed) return;

    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('employee-time-off-action', {
        body: {
          action: 'cancel',
          request_id: requestId,
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success('Time-off request cancelled');
      await loadTimeOff({ silent: true });
    } catch (error) {
      console.error('[PortalTimeOff] cancel failed:', error);
      toast.error(error.message || 'Could not cancel request');
    } finally {
      setSaving(false);
    }
  };

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  if (loading) return <div style={styles.loading}>Loading time off...</div>;

  return (
    <div style={styles.page}>
      <section style={styles.hero}>
        <div style={styles.eyebrow}>Employee Time Off</div>
        <h1 style={styles.title}>Request time away</h1>
        <p style={styles.subtitle}>
          Submit time-off requests and track whether they are pending, approved, denied, or cancelled.
        </p>
        {business?.name && <p style={styles.businessName}>{business.name}</p>}
      </section>

      <section style={styles.grid}>
        <form style={styles.card} onSubmit={submitTimeOff}>
          <div style={styles.cardHeader}>
            <CalendarDays size={22} style={{ color: TavariStyles.colors.primary }} />
            <h2 style={styles.cardTitle}>New Time-Off Request</h2>
          </div>

          <label style={styles.label}>Request type</label>
          <select
            value={form.request_type}
            onChange={(event) => updateForm('request_type', event.target.value)}
            style={styles.input}
          >
            {REQUEST_TYPES.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>

          <div style={styles.twoColumns}>
            <Field label="Start date" type="date" value={form.start_date} onChange={(value) => updateForm('start_date', value)} />
            <Field label="End date" type="date" value={form.end_date} onChange={(value) => updateForm('end_date', value)} />
          </div>

          <TavariCheckbox
            id="portal-timeoff-partial-day"
            checked={form.is_partial_day}
            onChange={(checked) => updateForm('is_partial_day', checked)}
            label="Partial day"
            size="md"
            style={styles.tavariCheckboxRow}
            labelStyle={styles.tavariCheckboxLabel}
          />

          {form.is_partial_day && (
            <div style={styles.twoColumns}>
              <Field label="Start" type="time" value={form.start_time} onChange={(value) => updateForm('start_time', value)} />
              <Field label="End" type="time" value={form.end_time} onChange={(value) => updateForm('end_time', value)} />
            </div>
          )}

          <label style={styles.label}>Notes</label>
          <textarea
            value={form.notes}
            onChange={(event) => updateForm('notes', event.target.value)}
            style={styles.textarea}
            rows={4}
            placeholder="Add details your manager should know."
          />

          <button type="submit" style={styles.primaryButton} disabled={saving}>
            <Send size={17} />
            {saving ? 'Submitting...' : 'Submit Request'}
          </button>
        </form>

        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <h2 style={styles.cardTitle}>My Requests</h2>
            <button type="button" style={styles.refreshButton} onClick={() => loadTimeOff({ silent: true })}>
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>

          {requests.length === 0 ? (
            <div style={styles.empty}>No time-off requests yet.</div>
          ) : (
            <div style={styles.list}>
              {requests.map((request) => (
                <div key={request.id} style={styles.requestCard}>
                  <div style={styles.requestTop}>
                    <div>
                      <strong>{formatRequestType(request.request_type)}</strong>
                      <div style={styles.muted}>{formatDateRange(request)}</div>
                    </div>
                    <span style={{ ...styles.statusPill, ...getStatusStyle(request.status) }}>
                      {formatStatus(request.status)}
                    </span>
                  </div>
                  {request.is_partial_day && (
                    <div style={styles.muted}>{formatTime(request.start_time)} - {formatTime(request.end_time)}</div>
                  )}
                  {request.notes && <div style={styles.notes}>{request.notes}</div>}
                  {request.denial_reason && <div style={styles.denial}>Denied: {request.denial_reason}</div>}
                  {request.status === 'pending' && (
                    <button
                      type="button"
                      style={styles.cancelButton}
                      onClick={() => cancelRequest(request.id)}
                      disabled={saving}
                    >
                      <XCircle size={15} />
                      Cancel Request
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  );
};

const Field = ({ label, type, value, onChange, required: req = true, min, max }) => (
  <div>
    <label style={styles.label}>{label}</label>
    {type === 'date' ? (
      <DateDropdownInput
        idPrefix={`portal-timeoff-${label.replace(/\s+/g, '-').toLowerCase()}`}
        value={value}
        onChange={onChange}
        required={req}
        min={min}
        max={max}
        selectStyle={{ ...styles.input, flex: 1, minWidth: 0 }}
      />
    ) : (
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={styles.input}
        required={req}
      />
    )}
  </div>
);

const formatRequestType = (value) => REQUEST_TYPES.find((type) => type.value === value)?.label || formatStatus(value);
const formatStatus = (status = 'pending') => String(status).replace(/_/g, ' ');

const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  return new Date(`${dateString}T12:00:00`).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatDateRange = (request) => {
  if (!request?.start_date) return 'No date';
  return request.start_date === request.end_date
    ? formatDate(request.start_date)
    : `${formatDate(request.start_date)} - ${formatDate(request.end_date)}`;
};

const formatTime = (timeString) => {
  if (!timeString) return '';
  const [hours, minutes] = timeString.split(':').map(Number);
  const date = new Date();
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
};

const getStatusStyle = (status) => {
  if (status === 'approved') return { backgroundColor: '#dcfce7', color: '#166534' };
  if (status === 'denied') return { backgroundColor: '#fee2e2', color: '#991b1b' };
  if (status === 'cancelled') return { backgroundColor: '#f3f4f6', color: '#4b5563' };
  return { backgroundColor: '#fef3c7', color: '#92400e' };
};

const styles = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.lg,
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
  },
  hero: {
    background: `linear-gradient(135deg, ${TavariStyles.colors.primary}, #0f766e)`,
    color: '#fff',
    borderRadius: '24px',
    padding: TavariStyles.spacing.xl,
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
  subtitle: {
    marginTop: TavariStyles.spacing.sm,
    opacity: 0.9,
    lineHeight: 1.5,
  },
  businessName: {
    marginTop: TavariStyles.spacing.md,
    opacity: 0.8,
    fontSize: TavariStyles.typography.fontSize.sm,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))',
    gap: TavariStyles.spacing.lg,
    alignItems: 'start',
  },
  card: {
    backgroundColor: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '18px',
    padding: TavariStyles.spacing.lg,
    boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
    minWidth: 0,
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm,
    marginBottom: TavariStyles.spacing.md,
    flexWrap: 'wrap',
  },
  cardTitle: {
    margin: 0,
    color: '#111827',
    fontSize: TavariStyles.typography.fontSize.lg,
  },
  label: {
    display: 'block',
    color: '#374151',
    fontWeight: 700,
    fontSize: '14px',
    marginBottom: '6px',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: '10px',
    padding: '11px 12px',
    marginBottom: '12px',
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: '10px',
    padding: '11px 12px',
    marginBottom: '12px',
    fontFamily: 'inherit',
    resize: 'vertical',
  },
  twoColumns: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '12px',
  },
  tavariCheckboxRow: {
    margin: '0 0 12px',
    alignItems: 'center',
  },
  tavariCheckboxLabel: {
    fontWeight: 700,
    color: '#374151',
  },
  primaryButton: {
    width: '100%',
    backgroundColor: TavariStyles.colors.primary,
    color: '#fff',
    border: 'none',
    borderRadius: '12px',
    padding: '13px 15px',
    fontWeight: 800,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  refreshButton: {
    border: '1px solid #d1d5db',
    borderRadius: '10px',
    backgroundColor: '#fff',
    color: '#374151',
    padding: '8px 11px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontWeight: 700,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  requestCard: {
    border: '1px solid #e5e7eb',
    borderRadius: '14px',
    padding: '14px',
  },
  requestTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'flex-start',
    marginBottom: '8px',
  },
  statusPill: {
    borderRadius: '999px',
    padding: '5px 9px',
    fontSize: '13px',
    fontWeight: 800,
    textTransform: 'capitalize',
    whiteSpace: 'nowrap',
  },
  muted: {
    color: '#6b7280',
    fontSize: '13px',
    lineHeight: 1.45,
  },
  notes: {
    marginTop: '8px',
    color: '#374151',
    fontSize: '13px',
  },
  denial: {
    marginTop: '8px',
    color: '#991b1b',
    fontSize: '13px',
    fontWeight: 700,
  },
  cancelButton: {
    marginTop: '10px',
    border: '1px solid #fecaca',
    backgroundColor: '#fef2f2',
    color: '#991b1b',
    borderRadius: '999px',
    padding: '8px 11px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontWeight: 700,
  },
  empty: {
    color: '#6b7280',
    padding: '18px',
    backgroundColor: '#f9fafb',
    borderRadius: '12px',
    textAlign: 'center',
  },
  loading: {
    textAlign: 'center',
    padding: TavariStyles.spacing['3xl'],
    color: TavariStyles.colors.gray600,
  },
};

export default PortalTimeOff;
