import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import OperationalFormRenderer from '../../components/FormFields/OperationalFormRenderer';
import PinModal from '../../components/POS/POSRegisterComponents/PinModal';
import { getOutOfRangeFields } from '../../utils/formsFieldValidation';
import { buildFormResponsesPayload, getEscalationValidationMessage } from '../../utils/formsEscalation';
import { readTaskManagerKioskEmployeeForBusiness } from '../../helpers/taskManagerKioskSession';
import { TavariStyles } from '../../utils/TavariStyles';

/** Kiosk / tablet form fill — Tavari Forms module only (not waivers). */
const FormsFillScreen = () => {
  const { formId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const businessId = searchParams.get('business') || '';
  const taskId = searchParams.get('task') || '';
  const returnUrl = searchParams.get('return') || '';

  const [loading, setLoading] = useState(true);
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
  const [step, setStep] = useState('pin');
  const [escalations, setEscalations] = useState({});
  const [taskMeta, setTaskMeta] = useState(null);
  const [taskContextLoading, setTaskContextLoading] = useState(false);
  const uploadSessionId = useMemo(
    () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `forms-${Date.now()}`),
    [formId, businessId]
  );

  useEffect(() => {
    if (!formId || !businessId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase.rpc('forms_get_template_for_fill', {
          p_form_template_id: formId,
          p_business_id: businessId
        });
        if (error) throw error;
        const payload = typeof data === 'string' ? JSON.parse(data) : data;
        if (!payload?.success) throw new Error(payload?.error || 'Form not found');
        setTemplate(payload.template);
        setFields(payload.fields || []);
      } catch (e) {
        toast.error(e.message || 'Could not load form');
      } finally {
        setLoading(false);
      }
    })();
  }, [formId, businessId]);

  useEffect(() => {
    if (!taskId || !businessId) {
      setTaskMeta(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setTaskContextLoading(true);
      try {
        const { data, error } = await supabase.rpc('task_manager_get_task_form_fill_context', {
          p_business_id: businessId,
          p_task_id: taskId
        });
        if (cancelled) return;
        if (error) throw error;
        const payload = typeof data === 'string' ? JSON.parse(data) : data;
        if (!payload?.success) throw new Error(payload?.error || 'Could not load task context');
        setTaskMeta(payload);
      } catch (e) {
        if (!cancelled) {
          setTaskMeta(null);
          toast.error(e.message || 'Could not load checklist task');
        }
      } finally {
        if (!cancelled) setTaskContextLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [taskId, businessId]);

  useEffect(() => {
    if (!taskId || !businessId) return;
    const kioskEmployee = readTaskManagerKioskEmployeeForBusiness(businessId);
    if (!kioskEmployee) return;
    setEmployeeId(kioskEmployee.employeeId);
    setEmployeeName(kioskEmployee.employeeName);
    setVerifiedPin(kioskEmployee.pin);
    setStep('form');
  }, [taskId, businessId]);

  const outOfRangeFields = useMemo(() => getOutOfRangeFields(fields, values), [fields, values]);
  const reviewFieldKeys = useMemo(() => outOfRangeFields.map((field) => field.key), [outOfRangeFields]);
  const title = useMemo(() => template?.title || 'Form', [template]);
  const showPinModal = step === 'pin' && !loading;

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
    } catch (e) {
      setPinError(e.message || 'PIN verification failed');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    const activeKeys = new Set(reviewFieldKeys);
    setEscalations((prev) => Object.fromEntries(
      Object.entries(prev).filter(([key]) => activeKeys.has(key))
    ));
  }, [reviewFieldKeys]);

  const onEscalationChange = (key, next) => {
    setEscalations((prev) => ({ ...prev, [key]: next }));
  };

  const onChange = (key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: null }));
  };

  const submitForm = async () => {
    for (const field of outOfRangeFields) {
      const message = getEscalationValidationMessage(field.label, escalations[field.key]);
      if (message) {
        toast.error(message);
        return;
      }
    }

    if (taskId && taskMeta?.is_checklist_task && taskMeta.available === false) {
      toast.error(taskMeta.message || 'This checklist is not available right now.');
      return;
    }

    setSubmitting(true);
    try {
      const scheduledFor = taskMeta?.is_checklist_task ? null : (taskMeta?.scheduled_for || null);
      const { data, error } = await supabase.rpc('forms_submit', {
        p_business_id: businessId,
        p_form_template_id: formId,
        p_employee_id: employeeId,
        p_pin: verifiedPin,
        p_responses: buildFormResponsesPayload(values, escalations),
        p_task_id: taskId || null,
        p_task_template_id: null,
        p_scheduled_for: scheduledFor,
        p_manager_override: false,
        p_override_explanation: null,
        p_submitted_via: taskId ? 'task_kiosk' : 'forms_kiosk'
      });
      if (error) throw error;
      const result = typeof data === 'string' ? JSON.parse(data) : data;
      if (!result?.success) throw new Error(result?.error || 'Submit failed');

      if (result.requires_manager_review) {
        toast.success('Submitted — out-of-range reading flagged for review');
      } else {
        toast.success('Form submitted');
      }

      if (returnUrl) {
        const sep = returnUrl.includes('?') ? '&' : '?';
        window.location.href = `${returnUrl}${sep}submitted=1`;
        return;
      }
      if (taskId) {
        navigate(`/task-manager-kiosk/index.html?business=${encodeURIComponent(businessId)}&submitted=1`);
        return;
      }
      setStep('done');
    } catch (e) {
      toast.error(e.message || 'Could not submit');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div style={styles.wrap}><div style={styles.card}>Loading form…</div></div>;
  if (!businessId || !formId) return <div style={styles.wrap}><div style={styles.card}>Missing business or form link.</div></div>;

  if (step === 'done') {
    return (
      <div style={styles.wrap}>
        <div style={styles.card}>
          <h1>Thank you</h1>
          <p style={styles.muted}>Your log was saved. You can close this screen or fill another check.</p>
        </div>
      </div>
    );
  }

  if (step === 'pin') {
    return (
      <>
        <div style={styles.wrap}>
          <div style={styles.card}>
            <h1>{title}</h1>
            <p style={styles.muted}>
              {taskId
                ? 'Your task kiosk session expired. Enter your POS PIN to continue.'
                : 'Enter your POS PIN to continue.'}
            </p>
          </div>
        </div>
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
    <div style={styles.wrap}>
      <div style={styles.card}>
        <h1>{title}</h1>
        {template?.description && <p style={styles.muted}>{template.description}</p>}
        {taskId && taskMeta?.is_checklist_task && (
          <p style={styles.muted}>
            {taskMeta.category_name ? `${taskMeta.category_name} checklist · ` : ''}
            {taskMeta.available === false
              ? (taskMeta.message || 'This checklist is not available right now.')
              : 'Check time is recorded when you submit.'}
          </p>
        )}
        <p style={styles.muted}>Signed in as {employeeName}</p>

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

        <button type="button" style={styles.primaryBtn} disabled={submitting || taskContextLoading || (taskId && taskMeta?.is_checklist_task && taskMeta.available === false)} onClick={submitForm}>
          {submitting ? 'Submitting…' : outOfRangeFields.length > 0 ? 'Submit log anyway' : 'Submit log'}
        </button>
        <p style={styles.hint}>Submitting completes the linked task automatically — no second tap needed.</p>
      </div>
    </div>
  );
};

const styles = {
  wrap: { minHeight: '100vh', background: '#f3f4f6', padding: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' },
  card: { width: '100%', maxWidth: 640, background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' },
  muted: { color: '#6b7280', lineHeight: 1.5 },
  hint: { color: '#6b7280', fontSize: 13, marginTop: 12 },
  primaryBtn: { marginTop: 16, background: TavariStyles.colors.primary || '#008080', color: '#fff', border: 'none', borderRadius: 10, padding: '14px 20px', fontWeight: 700, fontSize: 16, cursor: 'pointer', width: '100%' },
  summaryWarning: { marginTop: 20, padding: 14, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, color: '#92400e' },
  summaryWarningText: { margin: '8px 0 0', fontSize: 14, lineHeight: 1.5 },
  summaryList: { margin: '10px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }
};

export default FormsFillScreen;
