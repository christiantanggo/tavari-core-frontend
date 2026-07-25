import React, { useEffect, useState } from 'react';
import { Check, Repeat2, X } from 'lucide-react';
import dayjs from 'dayjs';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { sendSchedulingNotification } from '../../helpers/Scheduling/schedulingNotificationService';

const STATUS_FILTERS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'denied', label: 'Denied' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

const REQUEST_TYPES = {
  coverage: 'Coverage',
  swap: 'Shift Swap',
};

const ShiftCoverageRequestsTab = ({ businessId }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending');

  useEffect(() => {
    if (!businessId) return;
    loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, statusFilter]);

  const loadRequests = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('scheduling_shift_coverage_requests')
        .select(`
          id,
          business_id,
          shift_id,
          requester_employee_id,
          request_type,
          status,
          reason,
          manager_notes,
          reviewed_at,
          created_at,
          updated_at,
          users!scheduling_shift_coverage_requests_requester_employee_id_fkey (
            id,
            full_name,
            email,
            phone
          ),
          scheduling_shifts!scheduling_shift_coverage_requests_shift_id_fkey (
            id,
            shift_date,
            start_time,
            end_time,
            position,
            status
          )
        `)
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });

      if (statusFilter !== 'all') query = query.eq('status', statusFilter);

      const { data, error } = await query;
      if (error) throw error;
      setRequests(data || []);
    } catch (error) {
      console.error('Error loading shift coverage requests:', error);
      toast.error(error.message || 'Failed to load shift coverage requests');
    } finally {
      setLoading(false);
    }
  };

  const handleDecision = async (request, decision) => {
    const managerNotes = window.prompt(
      decision === 'approved' ? 'Optional note for the employee:' : 'Reason or note for the employee:',
      request.manager_notes || ''
    );
    if (managerNotes === null) return;

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: updatedRequest, error } = await supabase
        .from('scheduling_shift_coverage_requests')
        .update({
          status: decision,
          manager_notes: managerNotes || null,
          reviewed_by: user?.id,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', request.id)
        .eq('business_id', businessId)
        .select('*')
        .single();

      if (error) throw error;

      await sendSchedulingNotification({
        businessId,
        eventKey: decision === 'approved' ? 'shift_coverage_approved' : 'shift_coverage_denied',
        employeeId: request.requester_employee_id,
        context: buildNotificationContext(updatedRequest, request)
      });

      toast.success(`Shift coverage request ${decision}`);
      await loadRequests();
    } catch (error) {
      console.error('Error updating shift coverage request:', error);
      toast.error(error.message || 'Failed to update request');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Scheduling</div>
          <h2 style={styles.title}>Shift Coverage Requests</h2>
          <p style={styles.subtitle}>Review employee requests for shift coverage or swaps.</p>
        </div>
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
        <div style={styles.empty}>Loading shift coverage requests...</div>
      ) : requests.length === 0 ? (
        <div style={styles.empty}>No {statusFilter === 'all' ? '' : statusFilter} shift coverage requests found.</div>
      ) : (
        <div style={styles.requestGrid}>
          {requests.map((request) => (
            <div key={request.id} style={styles.card}>
              <div style={styles.cardTop}>
                <div>
                  <h3 style={styles.cardTitle}>{request.users?.full_name || request.users?.email || 'Employee'}</h3>
                  <div style={styles.muted}>{REQUEST_TYPES[request.request_type] || request.request_type}</div>
                </div>
                <span style={{ ...styles.statusBadge, ...statusStyles[request.status] }}>
                  {formatStatus(request.status)}
                </span>
              </div>

              <div style={styles.detailRow}>
                <Repeat2 size={16} />
                <span>{formatShift(request.scheduling_shifts)}</span>
              </div>
              {request.reason && <p style={styles.notes}>{request.reason}</p>}
              {request.manager_notes && <p style={styles.managerNotes}>Manager note: {request.manager_notes}</p>}
              <p style={styles.createdAt}>Submitted {dayjs(request.created_at).format('MMM D, YYYY h:mm A')}</p>

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
    </div>
  );
};

const buildNotificationContext = (updatedRequest, originalRequest) => ({
  requestId: updatedRequest.id,
  employeeName: originalRequest.users?.full_name || originalRequest.users?.email,
  requestType: updatedRequest.request_type,
  shiftId: updatedRequest.shift_id,
  shiftDate: originalRequest.scheduling_shifts?.shift_date,
  startTime: originalRequest.scheduling_shifts?.start_time,
  endTime: originalRequest.scheduling_shifts?.end_time,
  position: originalRequest.scheduling_shifts?.position,
  reason: updatedRequest.reason,
  managerNotes: updatedRequest.manager_notes,
  status: updatedRequest.status,
});

const formatStatus = (value) => String(value || 'pending').replace(/_/g, ' ');

const formatShift = (shift) => {
  if (!shift) return 'Shift details unavailable';
  const date = dayjs(shift.shift_date).format('MMM D, YYYY');
  const start = formatTime(shift.start_time);
  const end = formatTime(shift.end_time);
  return `${date} • ${start} - ${end}${shift.position ? ` • ${shift.position}` : ''}`;
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
  cancelled: { backgroundColor: '#e5e7eb', color: '#374151' },
};

const styles = {
  container: {
    padding: '24px',
    minHeight: '640px',
    backgroundColor: '#f8fafc',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '18px',
  },
  eyebrow: {
    fontSize: '13px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: TavariStyles.colors.primary,
    fontWeight: 800,
  },
  title: {
    margin: '4px 0',
    fontSize: '26px',
    color: TavariStyles.colors.gray900,
  },
  subtitle: {
    margin: 0,
    color: TavariStyles.colors.gray600,
  },
  filters: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    marginBottom: '18px',
  },
  filterButton: {
    border: '1px solid #d1d5db',
    backgroundColor: 'white',
    color: TavariStyles.colors.gray700,
    borderRadius: '999px',
    padding: '8px 14px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  filterButtonActive: {
    backgroundColor: TavariStyles.colors.primary,
    borderColor: TavariStyles.colors.primary,
    color: 'white',
  },
  empty: {
    padding: '32px',
    textAlign: 'center',
    borderRadius: '16px',
    backgroundColor: 'white',
    border: '1px solid #e5e7eb',
    color: TavariStyles.colors.gray600,
  },
  requestGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '16px',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '18px',
    padding: '18px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.06)',
  },
  cardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    alignItems: 'flex-start',
    marginBottom: '14px',
  },
  cardTitle: {
    margin: 0,
    fontSize: '18px',
    color: TavariStyles.colors.gray900,
  },
  muted: {
    marginTop: '4px',
    color: TavariStyles.colors.gray600,
    fontSize: '13px',
  },
  statusBadge: {
    borderRadius: '999px',
    padding: '6px 10px',
    fontSize: '13px',
    fontWeight: 800,
    textTransform: 'capitalize',
    whiteSpace: 'nowrap',
  },
  detailRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: TavariStyles.colors.gray700,
    fontSize: '14px',
    marginBottom: '10px',
  },
  notes: {
    margin: '10px 0 0',
    padding: '10px',
    borderRadius: '12px',
    backgroundColor: '#f8fafc',
    color: TavariStyles.colors.gray700,
    lineHeight: 1.45,
  },
  managerNotes: {
    margin: '10px 0 0',
    padding: '10px',
    borderRadius: '12px',
    backgroundColor: '#ecfeff',
    color: '#155e75',
    lineHeight: 1.45,
  },
  createdAt: {
    margin: '12px 0 0',
    color: TavariStyles.colors.gray500,
    fontSize: '13px',
  },
  cardActions: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '10px',
    marginTop: '14px',
  },
  approveButton: {
    border: 'none',
    borderRadius: '12px',
    padding: '10px 12px',
    backgroundColor: '#16a34a',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  denyButton: {
    border: 'none',
    borderRadius: '12px',
    padding: '10px 12px',
    backgroundColor: '#dc2626',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    fontWeight: 800,
    cursor: 'pointer',
  },
};

export default ShiftCoverageRequestsTab;
