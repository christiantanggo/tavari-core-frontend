import React, { useEffect, useState } from 'react';
import { CalendarCheck, RefreshCw, Send, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import DateDropdownInput from '../../components/UI/DateDropdownInput';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const getLocalDateString = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const PortalAvailability = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [business, setBusiness] = useState(null);
  const [availability, setAvailability] = useState([]);
  const [form, setForm] = useState({
    day_of_week: new Date().getDay(),
    is_available: true,
    all_day: true,
    start_time: '09:00',
    end_time: '17:00',
    effective_date: getLocalDateString(),
    expiry_date: '',
    notes: '',
  });

  const loadAvailability = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const { data, error } = await supabase.functions.invoke('employee-availability-action', {
        body: { action: 'list' }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setBusiness(data.business || null);
      setAvailability(data.availability || []);
    } catch (error) {
      console.error('[PortalAvailability] load failed:', error);
      toast.error(error.message || 'Could not load availability');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAvailability();
  }, []);

  const submitAvailability = async (event) => {
    event.preventDefault();
    if (!form.all_day && form.start_time >= form.end_time) {
      toast.error('End time must be after start time');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('employee-availability-action', {
        body: {
          action: 'submit',
          ...form,
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success('Availability submitted for approval');
      setForm((current) => ({ ...current, notes: '' }));
      await loadAvailability({ silent: true });
    } catch (error) {
      console.error('[PortalAvailability] submit failed:', error);
      toast.error(error.message || 'Could not submit availability');
    } finally {
      setSaving(false);
    }
  };

  const cancelAvailability = async (availabilityId) => {
    const confirmed = window.confirm('Cancel this availability request?');
    if (!confirmed) return;

    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('employee-availability-action', {
        body: {
          action: 'cancel',
          availability_id: availabilityId,
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success('Availability request cancelled');
      await loadAvailability({ silent: true });
    } catch (error) {
      console.error('[PortalAvailability] cancel failed:', error);
      toast.error(error.message || 'Could not cancel availability');
    } finally {
      setSaving(false);
    }
  };

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  if (loading) {
    return <div style={styles.loading}>Loading availability...</div>;
  }

  return (
    <div style={styles.page}>
      <section style={styles.hero}>
        <div style={styles.eyebrow}>Employee Availability</div>
        <h1 style={styles.title}>When can you work?</h1>
        <p style={styles.subtitle}>
          Submit days and times you can or cannot work. Managers review these before they affect scheduling.
        </p>
        {business?.name && <p style={styles.businessName}>{business.name}</p>}
      </section>

      <section style={styles.grid}>
        <form style={styles.card} onSubmit={submitAvailability}>
          <div style={styles.cardHeader}>
            <CalendarCheck size={22} style={{ color: TavariStyles.colors.primary }} />
            <h2 style={styles.cardTitle}>Submit Availability</h2>
          </div>

          <label style={styles.label}>Day</label>
          <select
            value={form.day_of_week}
            onChange={(event) => updateForm('day_of_week', Number(event.target.value))}
            style={styles.input}
          >
            {DAYS.map((day, index) => (
              <option key={day} value={index}>{day}</option>
            ))}
          </select>

          <label style={styles.label}>I am</label>
          <select
            value={form.is_available ? 'available' : 'unavailable'}
            onChange={(event) => updateForm('is_available', event.target.value === 'available')}
            style={styles.input}
          >
            <option value="available">Available to work</option>
            <option value="unavailable">Not available to work</option>
          </select>

          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={form.all_day}
              onChange={(event) => updateForm('all_day', event.target.checked)}
            />
            Applies all day
          </label>

          {!form.all_day && (
            <div style={styles.twoColumns}>
              <Field label="Start" type="time" value={form.start_time} onChange={(value) => updateForm('start_time', value)} />
              <Field label="End" type="time" value={form.end_time} onChange={(value) => updateForm('end_time', value)} />
            </div>
          )}

          <div style={styles.twoColumns}>
            <Field label="Effective date" type="date" value={form.effective_date} onChange={(value) => updateForm('effective_date', value)} />
            <Field label="Expiry date" type="date" value={form.expiry_date} onChange={(value) => updateForm('expiry_date', value)} required={false} />
          </div>

          <label style={styles.label}>Notes</label>
          <textarea
            value={form.notes}
            onChange={(event) => updateForm('notes', event.target.value)}
            style={styles.textarea}
            rows={4}
            placeholder="Example: School on Tuesdays, available after 4 PM."
          />

          <button type="submit" style={styles.primaryButton} disabled={saving}>
            <Send size={17} />
            {saving ? 'Submitting...' : 'Submit for Approval'}
          </button>
        </form>

        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <h2 style={styles.cardTitle}>My Availability Requests</h2>
            <button type="button" style={styles.refreshButton} onClick={() => loadAvailability({ silent: true })}>
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>

          {availability.length === 0 ? (
            <div style={styles.empty}>No availability requests yet.</div>
          ) : (
            <div style={styles.list}>
              {availability.map((item) => (
                <div key={item.id} style={styles.requestCard}>
                  <div style={styles.requestTop}>
                    <div>
                      <strong>{DAYS[item.day_of_week] || 'Day'} • {item.is_available ? 'Available' : 'Unavailable'}</strong>
                      <div style={styles.muted}>
                        {item.all_day ? 'All day' : `${formatTime(item.start_time)} - ${formatTime(item.end_time)}`}
                      </div>
                    </div>
                    <span style={{ ...styles.statusPill, ...getStatusStyle(item.status) }}>
                      {formatStatus(item.status)}
                    </span>
                  </div>
                  <div style={styles.muted}>
                    Effective {formatDate(item.effective_date)}{item.expiry_date ? ` to ${formatDate(item.expiry_date)}` : ' with no expiry'}
                  </div>
                  {item.notes && <div style={styles.notes}>{item.notes}</div>}
                  {item.denial_reason && <div style={styles.denial}>Denied: {item.denial_reason}</div>}
                  {item.status === 'pending' && (
                    <button
                      type="button"
                      style={styles.cancelButton}
                      onClick={() => cancelAvailability(item.id)}
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

const Field = ({ label, type, value, onChange, required = true, min, max }) => (
  <div>
    <label style={styles.label}>{label}</label>
    {type === 'date' ? (
      <DateDropdownInput
        idPrefix={`portal-avail-${label.replace(/\s+/g, '-').toLowerCase()}`}
        value={value}
        onChange={onChange}
        required={required}
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
        required={required}
      />
    )}
  </div>
);

const formatTime = (timeString) => {
  if (!timeString) return 'TBD';
  const [hours, minutes] = timeString.split(':').map(Number);
  const date = new Date();
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
};

const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  return new Date(`${dateString}T12:00:00`).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatStatus = (status = 'pending') => String(status).replace(/_/g, ' ');

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
  checkboxLabel: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    margin: '0 0 12px',
    color: '#374151',
    fontWeight: 700,
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

export default PortalAvailability;
