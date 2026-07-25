import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Check, Plus, X } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { sendSchedulingNotification } from '../../helpers/Scheduling/schedulingNotificationService';
import TavariCheckbox from '../UI/TavariCheckbox';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';

const REQUEST_TYPES = [
  { value: 'vacation', label: 'Vacation' },
  { value: 'sick', label: 'Sick' },
  { value: 'personal', label: 'Personal' },
  { value: 'bereavement', label: 'Bereavement' },
  { value: 'jury_duty', label: 'Jury Duty' },
  { value: 'other', label: 'Other' }
];

const STATUS_FILTERS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'denied', label: 'Denied' },
  { value: 'all', label: 'All' }
];

const TimeOffRequestsTab = ({ businessId }) => {
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [policyBlockModal, setPolicyBlockModal] = useState({ open: false, title: '', message: '' });

  const [form, setForm] = useState({
    employee_id: '',
    request_type: 'vacation',
    start_date: dayjs().add(1, 'day').format('YYYY-MM-DD'),
    end_date: dayjs().add(1, 'day').format('YYYY-MM-DD'),
    is_partial_day: false,
    start_time: '09:00',
    end_time: '17:00',
    notes: ''
  });

  useEffect(() => {
    if (!businessId) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, statusFilter]);

  const employeeMap = useMemo(() => {
    const map = new Map();
    employees.forEach((employee) => map.set(employee.id, employee));
    return map;
  }, [employees]);

  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([loadEmployees(), loadRequests()]);
    } catch (error) {
      console.error('Error loading time off data:', error);
      toast.error('Failed to load time off requests');
    } finally {
      setLoading(false);
    }
  };

  const loadEmployees = async () => {
    const { data: businessUsers, error: buError } = await supabase
      .from('business_users')
      .select(`
        user_id,
        role,
        users!business_users_user_id_fkey (
          id,
          full_name,
          email,
          phone
        )
      `)
      .eq('business_id', businessId);

    if (buError) throw buError;

    const employeeRows = (businessUsers || [])
      .map((row) => row.users ? { ...row.users, role: row.role } : null)
      .filter(Boolean);

    const { data: directUsers } = await supabase
      .from('users')
      .select('id, full_name, email, phone')
      .eq('business_id', businessId);

    const byId = new Map();
    [...employeeRows, ...(directUsers || [])].forEach((employee) => {
      if (employee?.id) byId.set(employee.id, employee);
    });

    const sortedEmployees = Array.from(byId.values())
      .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));

    setEmployees(sortedEmployees);
    setForm((current) => ({
      ...current,
      employee_id: current.employee_id || sortedEmployees[0]?.id || ''
    }));
  };

  const loadRequests = async () => {
    let query = supabase
      .from('scheduling_time_off')
      .select(`
        id,
        business_id,
        employee_id,
        request_type,
        start_date,
        end_date,
        start_time,
        end_time,
        total_hours,
        status,
        requested_by,
        approved_by,
        denied_by,
        approved_at,
        denied_at,
        denial_reason,
        notes,
        is_partial_day,
        created_at,
        updated_at,
        users!scheduling_time_off_employee_id_fkey (
          id,
          full_name,
          email,
          phone
        )
      `)
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }

    const { data, error } = await query;
    if (error) throw error;
    setRequests(data || []);
  };

  const resetForm = () => {
    setForm({
      employee_id: employees[0]?.id || '',
      request_type: 'vacation',
      start_date: dayjs().add(1, 'day').format('YYYY-MM-DD'),
      end_date: dayjs().add(1, 'day').format('YYYY-MM-DD'),
      is_partial_day: false,
      start_time: '09:00',
      end_time: '17:00',
      notes: ''
    });
  };

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const calculateTotalHours = () => {
    if (!form.is_partial_day) return null;
    const start = dayjs(`${form.start_date}T${form.start_time}`);
    const end = dayjs(`${form.start_date}T${form.end_time}`);
    if (!start.isValid() || !end.isValid() || !end.isAfter(start)) return null;
    return Number(end.diff(start, 'hour', true).toFixed(2));
  };

  const handleCreateRequest = async (event) => {
    event.preventDefault();
    if (!form.employee_id) {
      toast.error('Choose an employee');
      return;
    }
    if (dayjs(form.end_date).isBefore(dayjs(form.start_date), 'day')) {
      toast.error('End date must be on or after start date');
      return;
    }

    setSaving(true);
    try {
      const { data: elig, error: eligErr } = await supabase.rpc('scheduling_check_time_off_eligible', {
        p_business_id: businessId,
        p_employee_id: form.employee_id,
        p_start_date: form.start_date,
        p_end_date: form.end_date,
        p_exclude_request_id: null,
      });
      if (eligErr) throw eligErr;
      if (elig && elig.ok === false) {
        setPolicyBlockModal({
          open: true,
          title: elig.code === 'blackout'
            ? 'Date not available'
            : elig.code === 'schedule_published'
              ? 'Schedule already posted'
              : 'Too many people off',
          message: String(elig.message || 'This time off request is not allowed.'),
        });
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      const totalHours = calculateTotalHours();
      const employee = employeeMap.get(form.employee_id);

      const { data: request, error } = await supabase
        .from('scheduling_time_off')
        .insert({
          business_id: businessId,
          employee_id: form.employee_id,
          request_type: form.request_type,
          start_date: form.start_date,
          end_date: form.end_date,
          start_time: form.is_partial_day ? `${form.start_time}:00` : null,
          end_time: form.is_partial_day ? `${form.end_time}:00` : null,
          total_hours: form.is_partial_day ? totalHours : null,
          status: 'pending',
          requested_by: user?.id,
          notes: form.notes || null,
          is_partial_day: form.is_partial_day
        })
        .select('*')
        .single();

      if (error) throw error;

      await sendSchedulingNotification({
        businessId,
        eventKey: 'time_off_requested',
        employeeId: form.employee_id,
        context: buildNotificationContext(request, employee)
      });

      toast.success('Time off request submitted');
      setShowModal(false);
      resetForm();
      await loadRequests();
    } catch (error) {
      console.error('Error creating time off request:', error);
      toast.error(error.message || 'Failed to submit time off request');
    } finally {
      setSaving(false);
    }
  };

  const handleDecision = async (request, decision) => {
    const denialReason = decision === 'denied'
      ? window.prompt('Reason for denial? This will be visible in the request.', request.denial_reason || '')
      : '';

    if (decision === 'denied' && denialReason === null) return;

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const updatePayload = decision === 'approved'
        ? {
            status: 'approved',
            approved_by: user?.id,
            approved_at: new Date().toISOString(),
            denied_by: null,
            denied_at: null,
            denial_reason: null,
            updated_at: new Date().toISOString()
          }
        : {
            status: 'denied',
            denied_by: user?.id,
            denied_at: new Date().toISOString(),
            approved_by: null,
            approved_at: null,
            denial_reason: denialReason || null,
            updated_at: new Date().toISOString()
          };

      const { data: updatedRequest, error } = await supabase
        .from('scheduling_time_off')
        .update(updatePayload)
        .eq('id', request.id)
        .select('*')
        .single();

      if (error) throw error;

      await sendSchedulingNotification({
        businessId,
        eventKey: decision === 'approved' ? 'time_off_approved' : 'time_off_denied',
        employeeId: request.employee_id,
        context: buildNotificationContext(updatedRequest, request.users || employeeMap.get(request.employee_id))
      });

      toast.success(`Time off request ${decision}`);
      await loadRequests();
    } catch (error) {
      console.error('Error updating time off request:', error);
      toast.error(error.message || 'Failed to update time off request');
    } finally {
      setSaving(false);
    }
  };

  const buildNotificationContext = (request, employee) => ({
    requestId: request.id,
    employeeName: employee?.full_name,
    requestType: request.request_type,
    startDate: request.start_date,
    endDate: request.end_date,
    startTime: request.start_time,
    endTime: request.end_time,
    totalHours: request.total_hours,
    isPartialDay: request.is_partial_day,
    status: request.status,
    notes: request.notes,
    denialReason: request.denial_reason
  });

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Scheduling</div>
          <h2 style={styles.title}>Time Off Requests</h2>
          <p style={styles.subtitle}>Submit, approve, and deny employee time off requests.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          style={styles.primaryButton}
        >
          <Plus size={16} />
          New Request
        </button>
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

      {loading ? (
        <div style={styles.empty}>Loading time off requests...</div>
      ) : requests.length === 0 ? (
        <div style={styles.empty}>No {statusFilter === 'all' ? '' : statusFilter} time off requests found.</div>
      ) : (
        <div style={styles.requestGrid}>
          {requests.map((request) => (
            <div key={request.id} style={styles.card}>
              <div style={styles.cardTop}>
                <div>
                  <h3 style={styles.cardTitle}>{request.users?.full_name || 'Employee'}</h3>
                  <div style={styles.muted}>{formatRequestType(request.request_type)}</div>
                </div>
                <span style={{ ...styles.statusBadge, ...statusStyles[request.status] }}>
                  {formatStatus(request.status)}
                </span>
              </div>

              <div style={styles.detailRow}>
                <Calendar size={16} />
                <span>{formatDateRange(request)}</span>
              </div>
              {request.is_partial_day && (
                <div style={styles.detailRow}>
                  <span style={styles.detailIconSpacer} />
                  <span>{formatTime(request.start_time)} - {formatTime(request.end_time)}</span>
                </div>
              )}
              {request.notes && <p style={styles.notes}>{request.notes}</p>}
              {request.denial_reason && <p style={styles.denial}>Denied reason: {request.denial_reason}</p>}

              {request.status === 'pending' && (
                <div style={styles.cardActions}>
                  <button
                    type="button"
                    style={styles.approveButton}
                    onClick={() => handleDecision(request, 'approved')}
                    disabled={saving}
                  >
                    <Check size={15} />
                    Approve
                  </button>
                  <button
                    type="button"
                    style={styles.denyButton}
                    onClick={() => handleDecision(request, 'denied')}
                    disabled={saving}
                  >
                    <X size={15} />
                    Deny
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div style={styles.modalOverlay}>
          <form style={styles.modal} onSubmit={handleCreateRequest}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>New Time Off Request</h3>
              <button type="button" onClick={() => setShowModal(false)} style={styles.iconButton}>
                <X size={20} />
              </button>
            </div>

            <label style={styles.label}>Employee</label>
            <select
              value={form.employee_id}
              onChange={(event) => updateForm('employee_id', event.target.value)}
              style={styles.input}
            >
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.full_name || employee.email}</option>
              ))}
            </select>

            <label style={styles.label}>Request Type</label>
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
              <div>
                <label style={styles.label}>Start Date</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(event) => updateForm('start_date', event.target.value)}
                  style={styles.input}
                  required
                />
              </div>
              <div>
                <label style={styles.label}>End Date</label>
                <input
                  type="date"
                  value={form.end_date}
                  onChange={(event) => updateForm('end_date', event.target.value)}
                  style={styles.input}
                  required
                />
              </div>
            </div>

            <TavariCheckbox
              checked={form.is_partial_day}
              onChange={(checked) => updateForm('is_partial_day', checked)}
              label="Partial-day request"
              appearance="native"
              style={styles.checkboxRow}
            />

            {form.is_partial_day && (
              <div style={styles.twoColumns}>
                <div>
                  <label style={styles.label}>Start Time</label>
                  <input
                    type="time"
                    value={form.start_time}
                    onChange={(event) => updateForm('start_time', event.target.value)}
                    style={styles.input}
                  />
                </div>
                <div>
                  <label style={styles.label}>End Time</label>
                  <input
                    type="time"
                    value={form.end_time}
                    onChange={(event) => updateForm('end_time', event.target.value)}
                    style={styles.input}
                  />
                </div>
              </div>
            )}

            <label style={styles.label}>Notes</label>
            <textarea
              value={form.notes}
              onChange={(event) => updateForm('notes', event.target.value)}
              placeholder="Optional notes for the request..."
              style={styles.textarea}
              rows={4}
            />

            <div style={styles.modalActions}>
              <button type="button" onClick={() => setShowModal(false)} style={styles.secondaryButton}>Cancel</button>
              <button type="submit" style={styles.primaryButton} disabled={saving}>
                {saving ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </form>
        </div>
      )}

      {policyBlockModal.open ? (
        <div style={{ ...styles.modalOverlay, zIndex: 10060 }} role="dialog" aria-modal="true">
          <div style={{ ...styles.modal, maxWidth: '420px' }}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>{policyBlockModal.title}</h3>
              <button
                type="button"
                onClick={() => setPolicyBlockModal({ open: false, title: '', message: '' })}
                style={styles.iconButton}
              >
                <X size={20} />
              </button>
            </div>
            <p style={{ ...styles.subtitle, marginBottom: '18px', color: '#374151' }}>{policyBlockModal.message}</p>
            <div style={styles.modalActions}>
              <button
                type="button"
                onClick={() => setPolicyBlockModal({ open: false, title: '', message: '' })}
                style={styles.primaryButton}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const formatRequestType = (value) => REQUEST_TYPES.find((type) => type.value === value)?.label || value;
const formatStatus = (value) => String(value || 'pending').replace(/_/g, ' ');
const formatDateRange = (request) => {
  const start = dayjs(request.start_date).format('MMM D, YYYY');
  const end = dayjs(request.end_date).format('MMM D, YYYY');
  return start === end ? start : `${start} - ${end}`;
};
const formatTime = (value) => {
  if (!value) return '';
  const [hour, minute] = value.split(':');
  return dayjs().hour(Number(hour)).minute(Number(minute)).format('h:mm A');
};

const statusStyles = {
  pending: { backgroundColor: '#fef3c7', color: '#92400e' },
  approved: { backgroundColor: '#dcfce7', color: '#166534' },
  denied: { backgroundColor: '#fee2e2', color: '#991b1b' },
  cancelled: { backgroundColor: '#e5e7eb', color: '#374151' }
};

const styles = {
  container: {
    padding: '24px',
    minHeight: '640px',
    backgroundColor: '#f8fafc'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '20px',
    alignItems: 'flex-start',
    marginBottom: '20px'
  },
  eyebrow: {
    color: TavariStyles.colors.primary,
    fontSize: '13px',
    fontWeight: 800,
    letterSpacing: '0.08em',
    textTransform: 'uppercase'
  },
  title: {
    margin: '4px 0',
    color: TavariStyles.colors.text,
    fontSize: '26px'
  },
  subtitle: {
    margin: 0,
    color: TavariStyles.colors.textSecondary
  },
  filters: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    marginBottom: '20px'
  },
  filterButton: {
    border: '1px solid #d1d5db',
    backgroundColor: '#ffffff',
    color: '#374151',
    borderRadius: '999px',
    padding: '9px 14px',
    fontWeight: 700,
    cursor: 'pointer'
  },
  filterButtonActive: {
    backgroundColor: TavariStyles.colors.primary,
    borderColor: TavariStyles.colors.primary,
    color: '#ffffff'
  },
  requestGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '16px'
  },
  card: {
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '16px',
    padding: '18px',
    boxShadow: '0 8px 20px rgba(15, 23, 42, 0.06)'
  },
  cardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '14px',
    marginBottom: '14px'
  },
  cardTitle: {
    margin: 0,
    color: TavariStyles.colors.text,
    fontSize: '18px'
  },
  muted: {
    color: TavariStyles.colors.textSecondary,
    fontSize: '13px',
    marginTop: '3px'
  },
  statusBadge: {
    borderRadius: '999px',
    padding: '6px 10px',
    fontSize: '13px',
    fontWeight: 800,
    textTransform: 'capitalize',
    height: 'fit-content'
  },
  detailRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    color: '#374151',
    fontSize: '14px',
    marginBottom: '8px'
  },
  detailIconSpacer: {
    width: '16px'
  },
  notes: {
    backgroundColor: '#f9fafb',
    borderRadius: '10px',
    padding: '10px',
    color: '#374151',
    fontSize: '13px'
  },
  denial: {
    backgroundColor: '#fef2f2',
    color: '#991b1b',
    borderRadius: '10px',
    padding: '10px',
    fontSize: '13px'
  },
  cardActions: {
    display: 'flex',
    gap: '8px',
    marginTop: '16px'
  },
  primaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: TavariStyles.colors.primary,
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    padding: '11px 16px',
    fontWeight: 800,
    cursor: 'pointer'
  },
  secondaryButton: {
    backgroundColor: '#ffffff',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '10px',
    padding: '11px 16px',
    fontWeight: 700,
    cursor: 'pointer'
  },
  approveButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    backgroundColor: '#16a34a',
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    padding: '10px 12px',
    fontWeight: 800,
    cursor: 'pointer'
  },
  denyButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    backgroundColor: '#dc2626',
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    padding: '10px 12px',
    fontWeight: 800,
    cursor: 'pointer'
  },
  empty: {
    backgroundColor: '#ffffff',
    border: '1px dashed #d1d5db',
    borderRadius: '14px',
    padding: '32px',
    textAlign: 'center',
    color: TavariStyles.colors.textSecondary
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '20px'
  },
  modal: {
    backgroundColor: '#ffffff',
    borderRadius: '18px',
    padding: '22px',
    width: '100%',
    maxWidth: '620px',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 24px 60px rgba(15, 23, 42, 0.25)'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '18px'
  },
  modalTitle: {
    margin: 0,
    color: TavariStyles.colors.text
  },
  iconButton: {
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: '#64748b'
  },
  label: {
    display: 'block',
    marginBottom: '7px',
    color: TavariStyles.colors.text,
    fontWeight: 700,
    fontSize: '14px'
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: '10px',
    padding: '11px 12px',
    marginBottom: '14px'
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: '10px',
    padding: '11px 12px',
    resize: 'vertical',
    fontFamily: 'inherit'
  },
  twoColumns: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '12px'
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: TavariStyles.colors.text,
    fontWeight: 700,
    margin: '4px 0 14px'
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    marginTop: '18px'
  }
};

export default TimeOffRequestsTab;
