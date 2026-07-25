import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Repeat2, Send, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { getEmployeePortalSelectedBusinessId } from '../../utils/employeeProfileSelection';

const REQUEST_TYPES = [
  { value: 'coverage', label: 'Coverage', description: 'Ask your manager to help find someone to cover this shift.' },
  { value: 'swap', label: 'Shift Swap', description: 'Ask to swap this shift with another employee.' },
];

const PortalShiftCoverage = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [business, setBusiness] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState({
    shift_id: '',
    request_type: 'coverage',
    reason: '',
  });

  const selectedType = useMemo(
    () => REQUEST_TYPES.find((type) => type.value === form.request_type) || REQUEST_TYPES[0],
    [form.request_type]
  );

  const getBusinessIdPayload = () => {
    const id = getEmployeePortalSelectedBusinessId();
    return id ? { business_id: id } : {};
  };

  const loadCoverage = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const { data, error } = await supabase.functions.invoke('employee-shift-coverage-action', {
        body: { action: 'list', ...getBusinessIdPayload() },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const nextShifts = data.shifts || [];
      setBusiness(data.business || null);
      setShifts(nextShifts);
      setRequests(data.requests || []);
      setForm((current) => ({
        ...current,
        shift_id: current.shift_id || nextShifts[0]?.id || '',
      }));
    } catch (error) {
      console.error('[PortalShiftCoverage] load failed:', error);
      toast.error(error.message || 'Could not load shift coverage requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCoverage();
  }, []);

  const submitRequest = async (event) => {
    event.preventDefault();
    if (!form.shift_id) {
      toast.error('Choose a shift');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('employee-shift-coverage-action', {
        body: {
          action: 'submit',
          ...getBusinessIdPayload(),
          ...form,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success('Shift coverage request submitted');
      setForm((current) => ({ ...current, reason: '' }));
      await loadCoverage({ silent: true });
    } catch (error) {
      console.error('[PortalShiftCoverage] submit failed:', error);
      toast.error(error.message || 'Could not submit request');
    } finally {
      setSaving(false);
    }
  };

  const cancelRequest = async (requestId) => {
    const confirmed = window.confirm('Cancel this shift coverage request?');
    if (!confirmed) return;

    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('employee-shift-coverage-action', {
        body: {
          action: 'cancel',
          ...getBusinessIdPayload(),
          request_id: requestId,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success('Shift coverage request cancelled');
      await loadCoverage({ silent: true });
    } catch (error) {
      console.error('[PortalShiftCoverage] cancel failed:', error);
      toast.error(error.message || 'Could not cancel request');
    } finally {
      setSaving(false);
    }
  };

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  if (loading) return <div style={styles.loading}>Loading shift coverage...</div>;

  return (
    <div style={styles.page}>
      <section style={styles.hero}>
        <div style={styles.eyebrow}>Shift Coverage</div>
        <h1 style={styles.title}>Request coverage or a swap</h1>
        <p style={styles.subtitle}>
          Need someone to take a shift or want to swap? Submit the request here so your manager can review it.
        </p>
        {business?.name && <p style={styles.businessName}>{business.name}</p>}
      </section>

      <section style={styles.grid}>
        <form style={styles.card} onSubmit={submitRequest}>
          <div style={styles.cardHeader}>
            <Repeat2 size={22} style={{ color: TavariStyles.colors.primary }} />
            <h2 style={styles.cardTitle}>New Request</h2>
          </div>

          <label style={styles.label}>Shift</label>
          <select
            value={form.shift_id}
            onChange={(event) => updateForm('shift_id', event.target.value)}
            style={styles.input}
            disabled={shifts.length === 0}
            required
          >
            {shifts.length === 0 ? (
              <option value="">No upcoming published shifts</option>
            ) : (
              shifts.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {formatShift(shift)}
                </option>
              ))
            )}
          </select>

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
          <p style={styles.helperText}>{selectedType.description}</p>

          <label style={styles.label}>Reason</label>
          <textarea
            value={form.reason}
            onChange={(event) => updateForm('reason', event.target.value)}
            style={styles.textarea}
            rows={4}
            placeholder="Add details your manager should know."
          />

          <button type="submit" style={styles.primaryButton} disabled={saving || shifts.length === 0}>
            <Send size={17} />
            {saving ? 'Submitting...' : 'Submit Request'}
          </button>
        </form>

        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <h2 style={styles.cardTitle}>My Requests</h2>
            <button type="button" style={styles.refreshButton} onClick={() => loadCoverage({ silent: true })}>
              <RefreshCw size={15} />
              Refresh
            </button>
          </div>

          {requests.length === 0 ? (
            <div style={styles.empty}>No shift coverage requests yet.</div>
          ) : (
            <div style={styles.list}>
              {requests.map((request) => (
                <div key={request.id} style={styles.requestCard}>
                  <div style={styles.requestTop}>
                    <div>
                      <strong>{formatRequestType(request.request_type)}</strong>
                      <div style={styles.muted}>{formatRequestShift(request)}</div>
                    </div>
                    <span style={{ ...styles.statusPill, ...getStatusStyle(request.status) }}>
                      {formatStatus(request.status)}
                    </span>
                  </div>
                  {request.reason && <div style={styles.notes}>{request.reason}</div>}
                  {request.manager_notes && <div style={styles.managerNotes}>Manager note: {request.manager_notes}</div>}
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

const formatRequestType = (value) => REQUEST_TYPES.find((type) => type.value === value)?.label || formatStatus(value);
const formatStatus = (value) => String(value || 'pending').replace(/_/g, ' ');

const formatShift = (shift) => {
  const parts = [
    formatDate(shift.shift_date),
    `${formatTime(shift.start_time)} - ${formatTime(shift.end_time)}`,
    shift.position,
  ].filter(Boolean);
  return parts.join(' • ');
};

const formatRequestShift = (request) => {
  const shift = request.scheduling_shifts;
  return shift ? formatShift(shift) : 'Shift details unavailable';
};

const formatDate = (value) => {
  if (!value) return '';
  return new Date(`${value}T12:00:00`).toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

const formatTime = (value) => {
  if (!value) return '';
  const [hour, minute] = value.split(':');
  const date = new Date();
  date.setHours(Number(hour), Number(minute), 0, 0);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const getStatusStyle = (status) => ({
  pending: { backgroundColor: '#fef3c7', color: '#92400e' },
  approved: { backgroundColor: '#dcfce7', color: '#166534' },
  denied: { backgroundColor: '#fee2e2', color: '#991b1b' },
  cancelled: { backgroundColor: '#e5e7eb', color: '#374151' },
}[status] || { backgroundColor: '#e5e7eb', color: '#374151' });

const styles = {
  loading: {
    minHeight: '60vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: TavariStyles.colors.gray600,
    backgroundColor: TavariStyles.colors.gray50,
  },
  page: {
    width: '100%',
    maxWidth: '100vw',
    padding: '20px',
    paddingBottom: '96px',
    boxSizing: 'border-box',
    backgroundColor: TavariStyles.colors.gray50,
    minHeight: '100vh',
    overflowX: 'hidden',
  },
  hero: {
    background: 'linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)',
    borderRadius: '24px',
    padding: '24px',
    color: 'white',
    marginBottom: '18px',
    boxSizing: 'border-box',
  },
  eyebrow: {
    fontSize: '13px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    opacity: 0.85,
    fontWeight: 700,
  },
  title: {
    margin: '8px 0',
    fontSize: '28px',
    lineHeight: 1.1,
  },
  subtitle: {
    margin: 0,
    lineHeight: 1.5,
    opacity: 0.9,
  },
  businessName: {
    margin: '14px 0 0',
    fontWeight: 700,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '18px',
    alignItems: 'start',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '20px',
    padding: '20px',
    boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
    border: '1px solid #e5e7eb',
    minWidth: 0,
    boxSizing: 'border-box',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    marginBottom: '16px',
  },
  cardTitle: {
    margin: 0,
    fontSize: '20px',
    color: TavariStyles.colors.gray900,
  },
  label: {
    display: 'block',
    margin: '12px 0 6px',
    fontSize: '13px',
    fontWeight: 700,
    color: TavariStyles.colors.gray700,
  },
  input: {
    width: '100%',
    padding: '12px',
    borderRadius: '12px',
    border: '1px solid #d1d5db',
    fontSize: '15px',
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%',
    padding: '12px',
    borderRadius: '12px',
    border: '1px solid #d1d5db',
    fontSize: '15px',
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  helperText: {
    margin: '8px 0 0',
    fontSize: '13px',
    color: TavariStyles.colors.gray600,
    lineHeight: 1.4,
  },
  primaryButton: {
    marginTop: '16px',
    width: '100%',
    border: 'none',
    borderRadius: '14px',
    padding: '13px 16px',
    backgroundColor: TavariStyles.colors.primary,
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  refreshButton: {
    border: '1px solid #d1d5db',
    borderRadius: '999px',
    backgroundColor: 'white',
    color: TavariStyles.colors.gray700,
    padding: '8px 10px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    cursor: 'pointer',
  },
  empty: {
    padding: '24px',
    textAlign: 'center',
    borderRadius: '14px',
    backgroundColor: '#f8fafc',
    color: TavariStyles.colors.gray600,
  },
  list: {
    display: 'grid',
    gap: '12px',
  },
  requestCard: {
    border: '1px solid #e5e7eb',
    borderRadius: '16px',
    padding: '14px',
    backgroundColor: '#ffffff',
  },
  requestTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '10px',
  },
  muted: {
    color: TavariStyles.colors.gray600,
    fontSize: '13px',
    marginTop: '4px',
  },
  notes: {
    marginTop: '10px',
    padding: '10px',
    borderRadius: '12px',
    backgroundColor: '#f8fafc',
    color: TavariStyles.colors.gray700,
    fontSize: '14px',
    lineHeight: 1.4,
  },
  managerNotes: {
    marginTop: '10px',
    padding: '10px',
    borderRadius: '12px',
    backgroundColor: '#ecfeff',
    color: '#155e75',
    fontSize: '14px',
    lineHeight: 1.4,
  },
  statusPill: {
    borderRadius: '999px',
    padding: '5px 10px',
    fontSize: '13px',
    fontWeight: 800,
    textTransform: 'capitalize',
    whiteSpace: 'nowrap',
  },
  cancelButton: {
    marginTop: '12px',
    border: '1px solid #fecaca',
    borderRadius: '12px',
    padding: '10px 12px',
    backgroundColor: '#fff1f2',
    color: '#be123c',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    fontWeight: 700,
    cursor: 'pointer',
  },
};

export default PortalShiftCoverage;
