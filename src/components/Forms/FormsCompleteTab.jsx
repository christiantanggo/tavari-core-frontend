import React, { useEffect, useMemo, useState } from 'react';
import { FiAlertCircle, FiCheckCircle, FiChevronRight } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import OperationalFormRenderer from '../FormFields/OperationalFormRenderer';
import PinModal from '../POS/POSRegisterComponents/PinModal';
import FormsSlotPickerModal from './FormsSlotPickerModal';
import { getOutOfRangeFields } from '../../utils/formsFieldValidation';
import { buildFormResponsesPayload, getEscalationValidationMessage } from '../../utils/formsEscalation';
import {
  filterScheduleTimesForDate,
  formatScheduleSlotLabel,
  getBusinessToday,
  normalizeFormScheduleTimes,
  resolveBusinessTimezone,
  resolveFormScheduledFor
} from '../../utils/formsBusinessDate';
import { TavariStyles } from '../../utils/TavariStyles';

const parseRpcPayload = (data) => (typeof data === 'string' ? JSON.parse(data) : data);

const formatScheduledLabel = (session, tz) => {
  const scheduledFor = resolveFormScheduledFor(session, tz);
  if (!scheduledFor) return '';
  const d = new Date(scheduledFor);
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

const FormCompletionBadge = ({ status }) => {
  const value = status || { status: 'loading', label: 'Checking…' };
  const style = styles.statusBadge[value.status] || styles.statusBadge.unknown;
  const Icon = value.status === 'complete' ? FiCheckCircle : FiAlertCircle;

  return (
    <span style={style} title={value.detail || value.label}>
      <Icon size={16} />
      {value.label}
    </span>
  );
};

const FormsCompleteTab = ({ businessId, businessTimezone, forms, onSubmitted }) => {
  const activeForms = useMemo(
    () => (forms || []).filter((form) => form.status === 'active'),
    [forms]
  );

  const [pickerForm, setPickerForm] = useState(null);
  const [session, setSession] = useState(null);
  const [step, setStep] = useState('list');
  const [loadingForm, setLoadingForm] = useState(false);
  const [template, setTemplate] = useState(null);
  const [fields, setFields] = useState([]);
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [pinInput, setPinInput] = useState('');
  const [verifiedPin, setVerifiedPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [employeeId, setEmployeeId] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formStatuses, setFormStatuses] = useState({});
  const [statusRefreshKey, setStatusRefreshKey] = useState(0);
  const [escalations, setEscalations] = useState({});
  const uploadSessionId = useMemo(
    () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `forms-${Date.now()}`),
    [session?.occurrenceKey, session?.formId]
  );

  const outOfRangeFields = useMemo(() => getOutOfRangeFields(fields, values), [fields, values]);
  const reviewFieldKeys = useMemo(() => outOfRangeFields.map((field) => field.key), [outOfRangeFields]);
  const showPinModal = step === 'pin' && !loadingForm;
  const tz = useMemo(() => resolveBusinessTimezone(businessTimezone), [businessTimezone]);
  const today = useMemo(() => getBusinessToday(tz), [tz]);

  useEffect(() => {
    if (!businessId || activeForms.length === 0) {
      setFormStatuses({});
      return;
    }

    let cancelled = false;

    const loadStatuses = async () => {
      const entries = await Promise.all(activeForms.map(async (form) => {
        try {
          const { data, error } = await supabase.rpc('forms_get_form_schedule_info', {
            p_business_id: businessId,
            p_form_template_id: form.id
          });
          if (error) throw error;
          const schedulePayload = parseRpcPayload(data);
          if (!schedulePayload?.success) throw new Error(schedulePayload?.error || 'Could not load schedule');

          const scheduleTimes = normalizeFormScheduleTimes(schedulePayload);
          const actionableTimes = filterScheduleTimesForDate(scheduleTimes, today, tz);
          if (actionableTimes.length === 0) {
            return [form.id, { status: 'complete', label: 'Complete', detail: 'No outstanding scheduled checks right now.' }];
          }

          for (const time of actionableTimes) {
            const { data: checkData, error: checkError } = await supabase.rpc('forms_check_completion_slot', {
              p_business_id: businessId,
              p_form_template_id: form.id,
              p_scheduled_date: today,
              p_scheduled_time: time
            });
            if (checkError) throw checkError;
            const checkPayload = parseRpcPayload(checkData);
            if (checkPayload?.success && checkPayload.allowed) {
              return [
                form.id,
                {
                  status: 'incomplete',
                  label: 'Incomplete',
                  detail: `${formatScheduleSlotLabel(time)} is ready to complete.`
                }
              ];
            }
          }

          return [form.id, { status: 'complete', label: 'Complete', detail: 'All available scheduled checks are completed.' }];
        } catch (err) {
          return [form.id, { status: 'unknown', label: 'Status unavailable', detail: err.message || 'Could not check this form.' }];
        }
      }));

      if (!cancelled) {
        setFormStatuses(Object.fromEntries(entries));
      }
    };

    setFormStatuses(Object.fromEntries(activeForms.map((form) => [
      form.id,
      { status: 'loading', label: 'Checking…', detail: 'Checking scheduled checks.' }
    ])));
    loadStatuses();

    return () => { cancelled = true; };
  }, [activeForms, businessId, statusRefreshKey, today, tz]);

  const resetCompletion = () => {
    setSession(null);
    setStep('list');
    setTemplate(null);
    setFields([]);
    setValues({});
    setErrors({});
    setPinInput('');
    setVerifiedPin('');
    setPinError('');
    setFailedAttempts(0);
    setEmployeeId('');
    setEmployeeName('');
    setEscalations({});
  };

  const startCompletion = async (slotSession) => {
    const formId = pickerForm.id;
    setSession({ ...slotSession, formId });
    setStep('pin');
    setPinInput('');
    setVerifiedPin('');
    setPinError('');
    setFailedAttempts(0);
    setLoadingForm(true);
    try {
      const { data, error } = await supabase.rpc('forms_get_template_for_fill', {
        p_form_template_id: formId,
        p_business_id: businessId
      });
      if (error) throw error;
      const payload = parseRpcPayload(data);
      if (!payload?.success) throw new Error(payload?.error || 'Form not found');
      setTemplate(payload.template);
      setFields(payload.fields || []);
      setPickerForm(null);
    } catch (err) {
      toast.error(err.message || 'Could not load form');
      resetCompletion();
    } finally {
      setLoadingForm(false);
    }
  };

  useEffect(() => {
    if (!session) return;
    setValues({});
    setErrors({});
    setPinInput('');
    setVerifiedPin('');
    setPinError('');
    setFailedAttempts(0);
    setEmployeeId('');
    setEmployeeName('');
    setEscalations({});
  }, [session?.occurrenceKey]);

  useEffect(() => {
    const activeKeys = new Set(reviewFieldKeys);
    setEscalations((prev) => Object.fromEntries(
      Object.entries(prev).filter(([key]) => activeKeys.has(key))
    ));
  }, [reviewFieldKeys]);

  const verifyPin = async () => {
    if (pinInput.length !== 4) {
      setPinError('PIN must be 4 digits');
      return;
    }
    if (failedAttempts >= 3) return;

    setSubmitting(true);
    setPinError('');
    try {
      const { data, error } = await supabase.rpc('task_manager_verify_pin', {
        p_business_id: businessId,
        p_pin: pinInput.trim()
      });
      if (error) throw error;
      if (!data?.length) {
        const nextAttempts = failedAttempts + 1;
        setFailedAttempts(nextAttempts);
        setPinError(nextAttempts >= 3 ? 'Too many attempts. Contact a manager.' : 'PIN not recognized');
        setPinInput('');
        return;
      }
      setEmployeeId(data[0].employee_id);
      setEmployeeName(data[0].full_name || 'Staff');
      setVerifiedPin(pinInput.trim());
      setFailedAttempts(0);
      setStep('form');
    } catch (err) {
      setPinError(err.message || 'PIN verification failed');
    } finally {
      setSubmitting(false);
    }
  };

  const onChange = (key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: null }));
  };

  const onEscalationChange = (key, next) => {
    setEscalations((prev) => ({ ...prev, [key]: next }));
  };

  const submitForm = async () => {
    if (!session?.formId) return;

    const scheduledFor = resolveFormScheduledFor(session, tz);
    if (!scheduledFor) {
      toast.error('Scheduled date and time are required for this form');
      return;
    }

    for (const field of outOfRangeFields) {
      const message = getEscalationValidationMessage(field.label, escalations[field.key]);
      if (message) {
        toast.error(message);
        return;
      }
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('forms_submit', {
        p_business_id: businessId,
        p_form_template_id: session.formId,
        p_employee_id: employeeId,
        p_pin: verifiedPin,
        p_responses: buildFormResponsesPayload(values, escalations),
        p_task_id: session.taskId || null,
        p_task_template_id: session.taskTemplateId || null,
        p_scheduled_for: scheduledFor,
        p_manager_override: false,
        p_override_explanation: null,
        p_submitted_via: 'forms_dashboard'
      });
      if (error) throw error;
      const result = parseRpcPayload(data);
      if (!result?.success) throw new Error(result?.error || 'Submit failed');

      toast.success(result.requires_manager_review
        ? 'Submitted — out-of-range reading flagged for review'
        : 'Form submitted');

      resetCompletion();
      setStatusRefreshKey((key) => key + 1);
      onSubmitted?.();
    } catch (err) {
      toast.error(err.message || 'Could not submit');
    } finally {
      setSubmitting(false);
    }
  };

  if (step !== 'list') {
    return (
      <>
        <section style={styles.panel}>
          <div style={styles.panelHeader}>
            <div>
              <h2 style={styles.panelTitle}>{template?.title || 'Complete form'}</h2>
              {session && <p style={styles.muted}>For {formatScheduledLabel(session, tz)}</p>}
            </div>
            <button type="button" style={styles.secondaryBtn} onClick={resetCompletion} disabled={submitting}>
              Back to forms
            </button>
          </div>

          {loadingForm ? (
            <p style={styles.muted}>Loading form…</p>
          ) : step === 'form' ? (
            <>
              <p style={styles.muted}>Signed in as {employeeName}</p>
              {template?.description && <p style={styles.muted}>{template.description}</p>}
              <OperationalFormRenderer
                fields={fields}
                values={values}
                errors={errors}
                onChange={onChange}
                reviewFieldKeys={reviewFieldKeys}
                escalations={escalations}
                onEscalationChange={onEscalationChange}
                businessId={businessId}
                uploadSessionId={uploadSessionId}
              />

              {outOfRangeFields.length > 0 && (
                <div style={styles.summaryWarning}>
                  <strong>Needs review</strong>
                  <p style={styles.summaryWarningText}>
                    Complete the follow-up details for each flagged answer below, then submit. The designated reviewer will be alerted by email.
                  </p>
                  <ul style={styles.summaryList}>
                    {outOfRangeFields.map((field) => (
                      <li key={field.key}>{field.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              <button type="button" style={styles.primaryBtn} disabled={submitting} onClick={submitForm}>
                {submitting ? 'Submitting…' : outOfRangeFields.length > 0 ? 'Submit log anyway' : 'Submit log'}
              </button>
            </>
          ) : null}
        </section>

        <PinModal
          showPinModal={showPinModal}
          pinInput={pinInput}
          setPinInput={setPinInput}
          pinError={pinError}
          setPinError={setPinError}
          failedAttempts={failedAttempts}
          currentUnlockingUser={null}
          onPinUnlock={verifyPin}
          title="Enter PIN"
          subtitle="Enter your 4-digit POS PIN to sign this check."
          helperText=""
          buttonLabel={submitting ? 'Checking…' : 'Continue'}
          showUserInfo={false}
        />
      </>
    );
  }

  return (
    <>
      <section style={styles.panel}>
        <h2 style={styles.panelTitle}>Complete a form</h2>
        <p style={styles.muted}>Select a form, then choose the date and time this check is for.</p>
        {activeForms.length === 0 ? (
          <p style={styles.muted}>No active forms yet.</p>
        ) : (
          <div style={styles.formList}>
            {activeForms.map((form) => (
              <button
                key={form.id}
                type="button"
                style={styles.formListItem}
                onClick={() => setPickerForm(form)}
              >
                <div style={styles.formListMain}>
                  <div>
                    <strong>{form.title}</strong>
                    {form.description && <p style={styles.formListDesc}>{form.description}</p>}
                  </div>
                  <FormCompletionBadge status={formStatuses[form.id]} />
                </div>
                <FiChevronRight size={18} color="#6b7280" />
              </button>
            ))}
          </div>
        )}
      </section>

      {pickerForm && (
        <FormsSlotPickerModal
          form={pickerForm}
          businessId={businessId}
          businessTimezone={businessTimezone}
          onClose={() => setPickerForm(null)}
          onContinue={startCompletion}
        />
      )}
    </>
  );
};

const styles = {
  panel: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginTop: 20 },
  panelHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 16 },
  panelTitle: { margin: 0, fontSize: 18 },
  muted: { color: '#6b7280', fontSize: 14, lineHeight: 1.5 },
  formList: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 },
  formListItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    width: '100%',
    textAlign: 'left',
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: '14px 16px',
    cursor: 'pointer'
  },
  formListMain: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 },
  formListDesc: { margin: '4px 0 0', color: '#6b7280', fontSize: 13 },
  statusBadge: {
    complete: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      width: 'fit-content',
      padding: '5px 9px',
      borderRadius: 999,
      background: '#ecfdf5',
      color: '#047857',
      border: '1px solid #a7f3d0',
      fontSize: 13,
      fontWeight: 700
    },
    incomplete: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      width: 'fit-content',
      padding: '5px 9px',
      borderRadius: 999,
      background: '#fffbeb',
      color: '#92400e',
      border: '1px solid #fde68a',
      fontSize: 13,
      fontWeight: 700
    },
    loading: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      width: 'fit-content',
      padding: '5px 9px',
      borderRadius: 999,
      background: '#f3f4f6',
      color: '#6b7280',
      border: '1px solid #e5e7eb',
      fontSize: 13,
      fontWeight: 700
    },
    unknown: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      width: 'fit-content',
      padding: '5px 9px',
      borderRadius: 999,
      background: '#fef2f2',
      color: '#991b1b',
      border: '1px solid #fecaca',
      fontSize: 13,
      fontWeight: 700
    }
  },
  primaryBtn: {
    marginTop: 16,
    background: TavariStyles.colors.primary || '#008080',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '14px 20px',
    fontWeight: 700,
    fontSize: 16,
    cursor: 'pointer'
  },
  secondaryBtn: {
    background: '#f3f4f6',
    border: '1px solid #d1d5db',
    borderRadius: 10,
    padding: '10px 14px',
    cursor: 'pointer'
  },
  summaryWarning: { marginTop: 20, padding: 14, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, color: '#92400e' },
  summaryWarningText: { margin: '8px 0 0', fontSize: 14, lineHeight: 1.5 },
  summaryList: { margin: '10px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }
};

export default FormsCompleteTab;
