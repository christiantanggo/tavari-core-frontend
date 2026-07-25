import React, { useEffect, useMemo, useState } from 'react';
import { FiAlertTriangle, FiX } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import {
  businessSlotToIso,
  filterScheduleTimesForDate,
  formatScheduleSlotLabel,
  getBusinessDayUtcRange,
  getBusinessMinutesFromIso,
  getBusinessToday,
  isFutureBusinessSlot,
  isBusinessSlotExpired,
  normalizeFormScheduleTimes,
  resolveBusinessTimezone
} from '../../utils/formsBusinessDate';
import { parseTimeToMinutes } from '../../helpers/Bookings/operatingHoursTimeOptions';
import { TavariStyles } from '../../utils/TavariStyles';

const parseRpcPayload = (data) => (typeof data === 'string' ? JSON.parse(data) : data);

const FormsSlotPickerModal = ({ form, businessId, businessTimezone, onClose, onContinue }) => {
  const tz = resolveBusinessTimezone(businessTimezone);
  const maxDate = useMemo(() => getBusinessToday(tz), [tz]);

  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [scheduleTimes, setScheduleTimes] = useState([]);
  const [dueWindowMinutes, setDueWindowMinutes] = useState(60);
  const [submittedSlots, setSubmittedSlots] = useState([]);
  const [scheduledDate, setScheduledDate] = useState(maxDate);
  const [scheduledTime, setScheduledTime] = useState('');
  const [slotCheck, setSlotCheck] = useState(null);

  useEffect(() => {
    setScheduledDate((prev) => (prev > maxDate ? maxDate : prev));
  }, [maxDate]);

  useEffect(() => {
    if (!form?.id || !businessId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('forms_get_form_schedule_info', {
          p_business_id: businessId,
          p_form_template_id: form.id
        });
        if (error) throw error;
        const payload = parseRpcPayload(data);
        if (!payload?.success) throw new Error(payload?.error || 'Could not load schedule');
        if (cancelled) return;

        const times = normalizeFormScheduleTimes(payload);
        setScheduleTimes(times);
        const linked = Array.isArray(payload.linked_templates) ? payload.linked_templates : [];
        const windowMinutes = linked
          .map((template) => Number(template?.due_window_minutes))
          .find((value) => Number.isFinite(value) && value > 0);
        setDueWindowMinutes(windowMinutes || 60);
        const availableToday = filterScheduleTimesForDate(times, maxDate, tz);
        setScheduledTime(availableToday[availableToday.length - 1] || times[times.length - 1] || '');
      } catch (err) {
        if (!cancelled) {
          setScheduleTimes([]);
          setDueWindowMinutes(60);
          setScheduledTime('');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [form?.id, businessId, maxDate, tz]);

  useEffect(() => {
    if (!form?.id || !businessId || !scheduledDate) return;
    let cancelled = false;
    (async () => {
      const { startUtc, endUtc } = getBusinessDayUtcRange(scheduledDate, tz);
      const { data, error } = await supabase
        .from('forms_submissions')
        .select('id, scheduled_for, submitted_at, users:employee_id(full_name, first_name, last_name)')
        .eq('business_id', businessId)
        .eq('form_template_id', form.id)
        .gte('scheduled_for', startUtc)
        .lt('scheduled_for', endUtc)
        .order('scheduled_for', { ascending: true });

      if (cancelled) return;
      if (error) {
        setSubmittedSlots([]);
        return;
      }
      setSubmittedSlots(data || []);
    })();
    return () => { cancelled = true; };
  }, [form?.id, businessId, scheduledDate, tz]);

  useEffect(() => {
    setSlotCheck(null);
  }, [scheduledDate, scheduledTime]);

  const availableScheduleTimes = useMemo(
    () => filterScheduleTimesForDate(scheduleTimes, scheduledDate, tz),
    [scheduleTimes, scheduledDate, tz]
  );

  const latestSubmittedMinutes = useMemo(() => {
    const minutes = submittedSlots
      .map((slot) => getBusinessMinutesFromIso(slot.scheduled_for, tz))
      .filter((value) => value != null);
    return minutes.length ? Math.max(...minutes) : null;
  }, [submittedSlots, tz]);

  const timeOptions = useMemo(() => {
    const baseTimes = scheduledDate === maxDate ? availableScheduleTimes : scheduleTimes;
    return baseTimes.filter((time) => {
      const minutes = parseTimeToMinutes(time);
      if (minutes == null) return false;
      if (latestSubmittedMinutes != null && minutes < latestSubmittedMinutes) return false;
      return !isBusinessSlotExpired(scheduledDate, time, dueWindowMinutes, tz);
    });
  }, [scheduledDate, maxDate, availableScheduleTimes, scheduleTimes, latestSubmittedMinutes, dueWindowMinutes, tz]);

  const selectedTimeValue = useMemo(() => {
    if (!timeOptions.length) return '';
    if (timeOptions.includes(scheduledTime)) return scheduledTime;
    return timeOptions[timeOptions.length - 1];
  }, [timeOptions, scheduledTime]);

  useEffect(() => {
    if (!timeOptions.length) return;
    if (!timeOptions.includes(scheduledTime)) {
      setScheduledTime(timeOptions[timeOptions.length - 1]);
    }
  }, [timeOptions, scheduledTime]);

  const futureSlotBlocked = useMemo(
    () => isFutureBusinessSlot(scheduledDate, selectedTimeValue, tz),
    [scheduledDate, selectedTimeValue, tz]
  );

  const runSlotCheck = async () => {
    if (scheduledDate > maxDate || futureSlotBlocked) {
      setSlotCheck({
        allowed: false,
        status: 'future',
        message: scheduledDate > maxDate
          ? 'You cannot complete a check for a future date.'
          : 'You cannot complete a check for a future time.'
      });
      return;
    }

    setChecking(true);
    try {
      const { data, error } = await supabase.rpc('forms_check_completion_slot', {
        p_business_id: businessId,
        p_form_template_id: form.id,
        p_scheduled_date: scheduledDate,
        p_scheduled_time: selectedTimeValue
      });
      if (error) throw error;
      const payload = parseRpcPayload(data);
      if (!payload?.success) throw new Error(payload?.error || 'Could not verify time slot');
      setSlotCheck(payload);
      if (payload.allowed) {
        onContinue({
          scheduledDate,
          scheduledTime: selectedTimeValue,
          scheduledFor: payload.scheduled_for || businessSlotToIso(scheduledDate, selectedTimeValue, tz),
          taskId: payload.task_id || null,
          taskTemplateId: payload.task_template_id || null,
          occurrenceKey: payload.occurrence_key
        });
      }
    } catch (err) {
      setSlotCheck({
        allowed: false,
        status: 'error',
        message: err.message || 'Could not verify this time slot'
      });
    } finally {
      setChecking(false);
    }
  };

  const warningStyle = slotCheck?.status === 'missed'
    ? styles.warningMissed
    : slotCheck?.status === 'completed'
      ? styles.warningCompleted
      : slotCheck?.status === 'future'
        ? styles.warningFuture
        : styles.warningError;

  const showFutureWarning = futureSlotBlocked && !slotCheck;
  const hasScheduledTimes = scheduleTimes.length > 0;
  const noTimesToday = scheduledDate === maxDate && hasScheduledTimes && !availableScheduleTimes.length;
  const noOpenSlots = hasScheduledTimes && !timeOptions.length;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>When is this check for?</h2>
            <p style={styles.subtitle}>{form.title}</p>
          </div>
          <button type="button" style={styles.closeBtn} onClick={onClose} aria-label="Close">
            <FiX size={20} />
          </button>
        </div>

        {loading ? (
          <p style={styles.muted}>Loading schedule…</p>
        ) : (
          <>
            <label style={styles.field}>
              <span>Date</span>
              <input
                type="date"
                value={scheduledDate}
                max={maxDate}
                onChange={(e) => setScheduledDate(e.target.value > maxDate ? maxDate : e.target.value)}
                style={styles.input}
              />
              <span style={styles.muted}>Uses business timezone ({tz}). Future dates are not allowed.</span>
            </label>

            {hasScheduledTimes ? (
              <label style={styles.field}>
                <span>Scheduled time</span>
                {noTimesToday || noOpenSlots ? (
                  <p style={styles.warningFutureInline}>
                    {noTimesToday
                      ? 'No scheduled times are available for today yet. Choose an earlier date or try again later.'
                      : 'No open scheduled times remain for this date. Earlier checks are closed once their window expires or a later check is completed.'}
                  </p>
                ) : (
                  <select
                    value={selectedTimeValue}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    style={styles.input}
                  >
                    {timeOptions.map((time) => (
                      <option key={time} value={time}>{formatScheduleSlotLabel(time)}</option>
                    ))}
                  </select>
                )}
                <span style={styles.muted}>Choose the scheduled check time for this form.</span>
              </label>
            ) : (
              <div style={styles.warningFutureInline}>
                This form has no scheduled check times yet. Link it to a daily task template with schedule times in Task Manager.
              </div>
            )}

            {(showFutureWarning || (slotCheck && !slotCheck.allowed)) && (
              <div style={warningStyle}>
                <strong style={styles.warningTitle}>
                  <FiAlertTriangle style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  {slotCheck?.status === 'completed'
                    ? 'Already completed'
                    : slotCheck?.status === 'missed'
                      ? 'Window missed'
                      : slotCheck?.status === 'future' || showFutureWarning
                        ? 'Future date or time'
                        : 'Cannot complete'}
                </strong>
                <p style={styles.warningText}>
                  {slotCheck?.message || (scheduledDate > maxDate
                    ? 'You cannot complete a check for a future date.'
                    : 'You cannot complete a check for a future time.')}
                </p>
                {slotCheck?.submission?.submitted_at && (
                  <p style={styles.warningText}>
                    Completed {new Date(slotCheck.submission.submitted_at).toLocaleString()}
                    {slotCheck.submission.employee_name ? ` by ${slotCheck.submission.employee_name}` : ''}.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        <div style={styles.actions}>
          <button type="button" style={styles.secondaryBtn} onClick={onClose} disabled={checking}>
            Cancel
          </button>
          <button
            type="button"
            style={styles.primaryBtn}
            disabled={loading || checking || !scheduledDate || !selectedTimeValue || futureSlotBlocked || noTimesToday || noOpenSlots || !hasScheduledTimes}
            onClick={runSlotCheck}
          >
            {checking ? 'Checking…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 1000
  },
  modal: {
    width: '100%',
    maxWidth: 480,
    background: '#fff',
    borderRadius: 16,
    padding: 24,
    boxShadow: '0 20px 40px rgba(0,0,0,0.18)'
  },
  header: { display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 16 },
  title: { margin: 0, fontSize: 20 },
  subtitle: { margin: '6px 0 0', color: '#6b7280', fontSize: 14 },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' },
  field: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 },
  input: { padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d5db', fontSize: 14 },
  muted: { color: '#6b7280', fontSize: 13 },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
  primaryBtn: {
    background: TavariStyles.colors.primary || '#008080',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '12px 18px',
    fontWeight: 700,
    cursor: 'pointer'
  },
  secondaryBtn: {
    background: '#f3f4f6',
    border: '1px solid #d1d5db',
    borderRadius: 10,
    padding: '12px 18px',
    cursor: 'pointer'
  },
  warningCompleted: {
    marginTop: 8,
    padding: 14,
    borderRadius: 10,
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    color: '#1e3a8a'
  },
  warningMissed: {
    marginTop: 8,
    padding: 14,
    borderRadius: 10,
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#991b1b'
  },
  warningFuture: {
    marginTop: 8,
    padding: 14,
    borderRadius: 10,
    background: '#fffbeb',
    border: '1px solid #fde68a',
    color: '#92400e'
  },
  warningFutureInline: {
    margin: 0,
    padding: 12,
    borderRadius: 10,
    background: '#fffbeb',
    border: '1px solid #fde68a',
    color: '#92400e',
    fontSize: 13,
    lineHeight: 1.5
  },
  warningError: {
    marginTop: 8,
    padding: 14,
    borderRadius: 10,
    background: '#fffbeb',
    border: '1px solid #fde68a',
    color: '#92400e'
  },
  warningTitle: { display: 'block', marginBottom: 6 },
  warningText: { margin: '4px 0 0', fontSize: 14, lineHeight: 1.5 }
};

export default FormsSlotPickerModal;
