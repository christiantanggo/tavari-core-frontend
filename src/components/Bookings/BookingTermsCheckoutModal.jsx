import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { FiCheck, FiChevronLeft, FiChevronRight, FiX } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import WaiverSignatureCapture from '../Waivers/WaiverSignatureCapture';

/**
 * In-checkout Terms & Conditions acknowledgment (day camp / activities with a package).
 * Collects step acknowledgments + signature before payment/submit.
 */
export default function BookingTermsCheckoutModal({
  open,
  businessId,
  packageId,
  activityName = 'this activity',
  bookerName = '',
  onClose,
  onComplete,
}) {
  const [loading, setLoading] = useState(true);
  const [pkg, setPkg] = useState(null);
  const [steps, setSteps] = useState([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [acknowledgedStepIds, setAcknowledgedStepIds] = useState(() => new Set());
  const [signerName, setSignerName] = useState(bookerName || '');
  const [signaturePayload, setSignaturePayload] = useState(null);
  const [signatureReady, setSignatureReady] = useState(false);
  const stepBodyRef = useRef(null);
  const modalRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setSignerName((prev) => prev || bookerName || '');
  }, [open, bookerName]);

  useEffect(() => {
    if (!open || !businessId || !packageId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [{ data: packageRow, error: pkgError }, { data: stepRows, error: stepsError }] = await Promise.all([
          supabase
            .from('booking_terms_packages')
            .select('id, name, description')
            .eq('id', packageId)
            .eq('business_id', businessId)
            .maybeSingle(),
          supabase
            .from('booking_terms_steps')
            .select('id, step_order, title, body, require_acknowledge')
            .eq('package_id', packageId)
            .eq('business_id', businessId)
            .order('step_order', { ascending: true }),
        ]);
        if (pkgError) throw pkgError;
        if (stepsError) throw stepsError;
        if (cancelled) return;
        setPkg(packageRow);
        setSteps(stepRows || []);
        setStepIndex(0);
        setAcknowledgedStepIds(new Set());
        setSignaturePayload(null);
        setSignatureReady(false);
      } catch (err) {
        if (cancelled) return;
        toast.error(err?.message || 'Could not load Terms & Conditions');
        onClose?.();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally omit onClose — parent inline handlers would retrigger load forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open/businessId/packageId gate the fetch
  }, [open, businessId, packageId]);

  const scrollBodyToTop = useCallback(() => {
    if (modalRef.current) {
      modalRef.current.scrollTop = 0;
      modalRef.current.scrollLeft = 0;
    }
    if (stepBodyRef.current) {
      stepBodyRef.current.scrollTop = 0;
      stepBodyRef.current.scrollLeft = 0;
    }
  }, []);

  useEffect(() => {
    if (!open || loading) return;
    scrollBodyToTop();
    const t1 = window.setTimeout(scrollBodyToTop, 50);
    const t2 = window.setTimeout(scrollBodyToTop, 200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [stepIndex, open, loading, scrollBodyToTop]);

  const isSignatureStep = stepIndex >= steps.length;
  const currentStep = !isSignatureStep ? steps[stepIndex] : null;
  const currentAcknowledged = currentStep ? acknowledgedStepIds.has(currentStep.id) : false;

  const progressLabel = useMemo(() => {
    if (!steps.length) return '';
    if (isSignatureStep) return `Signature · Step ${steps.length + 1} of ${steps.length + 1}`;
    return `Step ${stepIndex + 1} of ${steps.length + 1}`;
  }, [isSignatureStep, stepIndex, steps.length]);

  const handleAcknowledgeCurrent = (checked) => {
    if (!currentStep) return;
    setAcknowledgedStepIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(currentStep.id);
      else next.delete(currentStep.id);
      return next;
    });
  };

  const handleNext = () => {
    if (currentStep?.require_acknowledge !== false && !currentAcknowledged) {
      toast.error('Please acknowledge this step to continue');
      return;
    }
    setStepIndex((prev) => Math.min(prev + 1, steps.length));
    scrollBodyToTop();
  };

  const handleBack = () => {
    setStepIndex((prev) => Math.max(0, prev - 1));
    scrollBodyToTop();
  };

  const handleFinish = () => {
    if (!signerName.trim()) {
      toast.error('Please enter your full name');
      return;
    }
    if (!signatureReady || !signaturePayload?.imageUrl) {
      toast.error('Please draw your signature');
      return;
    }
    const requiredSteps = steps.filter((step) => step.require_acknowledge !== false);
    for (const step of requiredSteps) {
      if (!acknowledgedStepIds.has(step.id)) {
        toast.error(`Please acknowledge: ${step.title}`);
        setStepIndex(Math.max(0, steps.findIndex((s) => s.id === step.id)));
        return;
      }
    }
    onComplete?.({
      packageId,
      signerName: signerName.trim(),
      signatureData: signaturePayload,
      acknowledgments: Array.from(acknowledgedStepIds).map((stepId) => ({ stepId })),
      signedAt: new Date().toISOString(),
    });
  };

  if (!open) return null;

  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-label="Terms and Conditions">
      <div style={styles.modal} ref={modalRef}>
        <div style={styles.header}>
          <div>
            <div style={styles.eyebrow}>Required before booking</div>
            <h2 style={styles.title}>{pkg?.name || 'Terms & Conditions'}</h2>
            <p style={styles.meta}>{activityName}</p>
          </div>
          <button type="button" onClick={onClose} style={styles.closeBtn} aria-label="Close">
            <FiX size={20} />
          </button>
        </div>

        {loading ? (
          <div style={styles.bodyPad}>Loading Terms & Conditions…</div>
        ) : (
          <div style={styles.bodyPad}>
            <div style={styles.progress}>{progressLabel}</div>
            {!isSignatureStep && currentStep ? (
              <>
                <h3 style={styles.stepTitle}>{currentStep.title}</h3>
                <div
                  key={`checkout-terms-${currentStep.id}`}
                  ref={stepBodyRef}
                  style={styles.stepBody}
                >
                  {String(currentStep.body || '')
                    .split(/\n+/)
                    .filter(Boolean)
                    .map((paragraph, index) => (
                      <p key={`${currentStep.id}-${index}`} style={{ margin: '0 0 10px' }}>
                        {paragraph}
                      </p>
                    ))}
                </div>
                {currentStep.require_acknowledge !== false ? (
                  <div style={{ marginTop: 14 }}>
                    <TavariCheckbox
                      id={`checkout-ack-${currentStep.id}`}
                      checked={currentAcknowledged}
                      onChange={handleAcknowledgeCurrent}
                      label="I have read and understand this section"
                    />
                  </div>
                ) : null}
                <div style={styles.footer}>
                  <button type="button" onClick={handleBack} disabled={stepIndex === 0} style={styles.secondaryBtn}>
                    <FiChevronLeft size={16} /> Back
                  </button>
                  <button type="button" onClick={handleNext} style={styles.primaryBtn}>
                    Next <FiChevronRight size={16} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 style={styles.stepTitle}>Sign to confirm</h3>
                <p style={styles.copy}>
                  By signing below, you confirm that you have read and agree to all Terms & Conditions for {activityName}.
                </p>
                <label style={styles.label}>
                  Full legal name
                  <input
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder="Type your full name"
                    style={styles.input}
                  />
                </label>
                <div style={{ marginTop: 14 }}>
                  <WaiverSignatureCapture
                    required
                    label="Draw your signature"
                    showAuthorizationPrompt
                    onSignatureCaptured={setSignaturePayload}
                    onSignatureStateChange={(state) => setSignatureReady(Boolean(state?.ready))}
                  />
                </div>
                <div style={styles.footer}>
                  <button type="button" onClick={handleBack} style={styles.secondaryBtn}>
                    <FiChevronLeft size={16} /> Back
                  </button>
                  <button type="button" onClick={handleFinish} style={styles.primaryBtn}>
                    <FiCheck size={16} /> Continue booking
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.5)',
    zIndex: 10060,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'clamp(8px, 2vw, 24px)',
  },
  modal: {
    width: 'min(920px, 100%)',
    maxHeight: 'min(920px, 94vh)',
    overflow: 'auto',
    background: '#fff',
    borderRadius: 14,
    boxShadow: '0 20px 48px rgba(0,0,0,0.2)',
    overflowAnchor: 'none',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    padding: 'clamp(14px, 2vw, 22px) clamp(14px, 2vw, 22px) 12px',
    borderBottom: '1px solid #e5e7eb',
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: TavariStyles.colors.primary,
    marginBottom: 4,
  },
  title: {
    margin: 0,
    fontSize: 'clamp(18px, 2vw, 22px)',
    fontWeight: 800,
    color: TavariStyles.colors.gray900,
  },
  meta: { margin: '4px 0 0', fontSize: 13, color: TavariStyles.colors.gray600 },
  closeBtn: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: TavariStyles.colors.gray600,
    padding: 4,
  },
  bodyPad: { padding: 'clamp(14px, 2vw, 22px)' },
  progress: { fontSize: 13, fontWeight: 600, color: TavariStyles.colors.gray500, marginBottom: 12 },
  stepTitle: {
    margin: '0 0 10px',
    fontSize: 'clamp(15px, 1.6vw, 18px)',
    fontWeight: 700,
  },
  stepBody: {
    maxHeight: 'clamp(220px, 48vh, 62dvh)',
    overflow: 'auto',
    fontSize: 'clamp(14px, 1.1vw, 16px)',
    lineHeight: 1.55,
    color: TavariStyles.colors.gray700,
    overflowAnchor: 'none',
    WebkitOverflowScrolling: 'touch',
  },
  copy: { margin: '0 0 12px', fontSize: 14, lineHeight: 1.5, color: TavariStyles.colors.gray700 },
  label: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 },
  input: {
    border: '1px solid #d1d5db',
    borderRadius: 8,
    padding: '11px 12px',
    fontSize: 15,
  },
  footer: { display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 18 },
  primaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    border: 'none',
    borderRadius: 10,
    padding: '11px 16px',
    backgroundColor: TavariStyles.colors.primary,
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    border: '1px solid #d1d5db',
    borderRadius: 10,
    padding: '11px 16px',
    backgroundColor: '#fff',
    color: TavariStyles.colors.gray700,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
