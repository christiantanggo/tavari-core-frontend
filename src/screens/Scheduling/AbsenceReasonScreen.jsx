import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { useBusiness } from '../../contexts/BusinessContext';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';

const REASONS = [
  { value: 'sick', label: 'Sick' },
  { value: 'no_show', label: 'No show / no contact' },
  { value: 'called_in_absent', label: 'Called in absent' },
  { value: 'family_emergency', label: 'Family emergency' },
  { value: 'transportation_issue', label: 'Transportation issue' },
  { value: 'weather', label: 'Weather related' },
  { value: 'other', label: 'Other' }
];

const STATUS_BY_REASON = {
  sick: 'sick',
  no_show: 'no_show',
  called_in_absent: 'no_show',
  family_emergency: 'no_show',
  transportation_issue: 'no_show',
  weather: 'no_show',
  other: 'no_show'
};

const AbsenceReasonScreen = () => {
  const { shiftId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { business, setBusiness } = useBusiness();
  const businessIdFromLink = useMemo(
    () => new URLSearchParams(location.search).get('business'),
    [location.search]
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [shift, setShift] = useState(null);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (businessIdFromLink && business?.id !== businessIdFromLink) {
      setBusiness(businessIdFromLink);
      return;
    }
    loadShift();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftId, businessIdFromLink, business?.id]);

  const employee = shift?.users;
  const selectedReasonLabel = useMemo(
    () => REASONS.find((item) => item.value === reason)?.label || '',
    [reason]
  );

  const loadShift = async () => {
    if (!shiftId) return;
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('scheduling_shifts')
        .select(`
          id,
          business_id,
          employee_id,
          shift_date,
          start_time,
          end_time,
          position,
          status,
          notes,
          absence_reason,
          absence_notes,
          absence_recorded_at,
          users!scheduling_shifts_employee_id_fkey (
            id,
            full_name,
            email,
            phone,
            emergency_contact_name,
            emergency_contact_phone,
            emergency_contact_relationship
          )
        `)
        .eq('id', shiftId)
        .eq('business_id', businessIdFromLink || business?.id)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        toast.error('Shift not found for the selected business');
        return;
      }

      if (businessIdFromLink && data.business_id !== businessIdFromLink) {
        toast.error('This absence link does not match the selected business');
        return;
      }

      setShift(data);
      setReason(data.absence_reason || '');
      setNotes(data.absence_notes || '');
    } catch (error) {
      console.error('Error loading absence shift:', error);
      toast.error('Could not load the missed shift');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!shift || !reason) {
      toast.error('Choose a reason for the absence');
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const nextStatus = STATUS_BY_REASON[reason] || 'no_show';

      const { error } = await supabase
        .from('scheduling_shifts')
        .update({
          status: nextStatus,
          absence_reason: reason,
          absence_notes: notes || null,
          absence_recorded_by: user?.id || null,
          absence_recorded_at: new Date().toISOString(),
          updated_by: user?.id || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', shift.id)
        .eq('business_id', businessIdFromLink || business?.id || shift.business_id);

      if (error) throw error;

      toast.success(`Absence reason saved: ${selectedReasonLabel}`);
      await loadShift();
    } catch (error) {
      console.error('Error saving absence reason:', error);
      toast.error('Could not save the absence reason');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>Loading missed shift...</div>
      </div>
    );
  }

  if (!shift) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h1 style={styles.title}>Shift Not Found</h1>
          <button style={styles.secondaryButton} onClick={() => navigate('/dashboard/scheduling')}>
            Back to Scheduling
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Attendance Alert</div>
          <h1 style={styles.title}>Record Absence Reason</h1>
          <p style={styles.subtitle}>
            This employee has not clocked in for their scheduled shift. Choose the reason so the shift record is updated.
          </p>
        </div>
        <button style={styles.secondaryButton} onClick={() => navigate('/dashboard/scheduling')}>
          Back to Scheduling
        </button>
      </div>

      <div style={styles.grid}>
        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Employee</h2>
          <InfoRow label="Name" value={employee?.full_name} />
          <InfoRow label="Phone" value={employee?.phone} />
          <InfoRow label="Email" value={employee?.email} />
          <InfoRow label="Emergency contact" value={employee?.emergency_contact_name} />
          <InfoRow label="Emergency phone" value={employee?.emergency_contact_phone} />
          <InfoRow label="Relationship" value={employee?.emergency_contact_relationship} />
        </section>

        <section style={styles.card}>
          <h2 style={styles.sectionTitle}>Shift</h2>
          <InfoRow label="Date" value={formatDate(shift.shift_date)} />
          <InfoRow label="Time" value={`${formatTime(shift.start_time)} - ${formatTime(shift.end_time)}`} />
          <InfoRow label="Position" value={shift.position} />
          <InfoRow label="Current status" value={formatStatus(shift.status)} />
          <InfoRow label="Recorded reason" value={formatReason(shift.absence_reason)} />
          <InfoRow label="Recorded at" value={shift.absence_recorded_at ? dayjs(shift.absence_recorded_at).format('MMM D, YYYY h:mm A') : ''} />
        </section>
      </div>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Choose Reason</h2>
        <div style={styles.reasonGrid}>
          {REASONS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setReason(item.value)}
              style={{
                ...styles.reasonButton,
                ...(reason === item.value ? styles.reasonButtonActive : {})
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <label style={styles.label} htmlFor="absence-notes">Manager notes</label>
        <textarea
          id="absence-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Optional notes about the absence..."
          style={styles.textarea}
          rows={4}
        />

        <div style={styles.actions}>
          <button style={styles.primaryButton} onClick={handleSave} disabled={saving || !reason}>
            {saving ? 'Saving...' : 'Save Absence Reason'}
          </button>
        </div>
      </section>
    </div>
  );
};

const InfoRow = ({ label, value }) => (
  <div style={styles.infoRow}>
    <span style={styles.infoLabel}>{label}</span>
    <span style={styles.infoValue}>{value || 'Not provided'}</span>
  </div>
);

const formatDate = (value) => (value ? dayjs(value).format('MMM D, YYYY') : 'Not provided');
const formatTime = (value) => {
  if (!value) return 'Not provided';
  const [hours, minutes] = value.split(':');
  return dayjs().hour(Number(hours)).minute(Number(minutes)).format('h:mm A');
};
const formatStatus = (value) => String(value || 'scheduled').replace(/_/g, ' ');
const formatReason = (value) => REASONS.find((item) => item.value === value)?.label || '';

const styles = {
  page: {
    padding: '28px',
    backgroundColor: '#f8fafc',
    minHeight: '100vh'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '20px',
    alignItems: 'flex-start',
    marginBottom: '24px'
  },
  eyebrow: {
    color: '#dc2626',
    fontSize: '13px',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: '8px'
  },
  title: {
    margin: 0,
    fontSize: '30px',
    color: TavariStyles.colors.text,
    fontWeight: 800
  },
  subtitle: {
    margin: '10px 0 0',
    color: TavariStyles.colors.textSecondary,
    maxWidth: '760px',
    lineHeight: 1.6
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '20px',
    marginBottom: '20px'
  },
  card: {
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '16px',
    padding: '22px',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.06)'
  },
  sectionTitle: {
    margin: '0 0 16px',
    fontSize: '18px',
    color: TavariStyles.colors.text,
    fontWeight: 800
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '16px',
    padding: '12px 0',
    borderBottom: '1px solid #f1f5f9'
  },
  infoLabel: {
    color: TavariStyles.colors.textSecondary,
    fontSize: '14px'
  },
  infoValue: {
    color: TavariStyles.colors.text,
    fontSize: '14px',
    fontWeight: 700,
    textAlign: 'right'
  },
  reasonGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '12px',
    marginBottom: '20px'
  },
  reasonButton: {
    border: '1px solid #d1d5db',
    backgroundColor: '#ffffff',
    color: '#111827',
    borderRadius: '12px',
    padding: '14px',
    fontWeight: 700,
    cursor: 'pointer',
    textAlign: 'left'
  },
  reasonButtonActive: {
    borderColor: TavariStyles.colors.primary,
    backgroundColor: '#eef2ff',
    color: TavariStyles.colors.primary
  },
  label: {
    display: 'block',
    marginBottom: '8px',
    color: TavariStyles.colors.text,
    fontWeight: 700
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: '12px',
    padding: '12px',
    fontFamily: 'inherit',
    resize: 'vertical'
  },
  actions: {
    marginTop: '18px',
    display: 'flex',
    justifyContent: 'flex-end'
  },
  primaryButton: {
    backgroundColor: TavariStyles.colors.primary,
    color: '#ffffff',
    border: 'none',
    borderRadius: '999px',
    padding: '12px 20px',
    fontWeight: 800,
    cursor: 'pointer'
  },
  secondaryButton: {
    backgroundColor: '#ffffff',
    color: TavariStyles.colors.text,
    border: '1px solid #d1d5db',
    borderRadius: '999px',
    padding: '10px 16px',
    fontWeight: 700,
    cursor: 'pointer'
  }
};

export default AbsenceReasonScreen;
