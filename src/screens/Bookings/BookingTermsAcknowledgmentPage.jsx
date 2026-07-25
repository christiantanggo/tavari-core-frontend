import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiCheck, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import WaiverSignatureCapture from '../../components/Waivers/WaiverSignatureCapture';

/**
 * Public customer flow: acknowledge each Terms & Conditions step, then draw signature.
 * Route: /customer-portal/:businessId/portal/booking-terms/:token
 */
export default function BookingTermsAcknowledgmentPage() {
  const { businessId, token } = useParams();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [payload, setPayload] = useState(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [acknowledgedStepIds, setAcknowledgedStepIds] = useState(() => new Set());
  const [signerName, setSignerName] = useState('');
  const [signaturePayload, setSignaturePayload] = useState(null);
  const [signatureReady, setSignatureReady] = useState(false);
  const [completed, setCompleted] = useState(false);
  const pageTopRef = useRef(null);
  const stepBodyRef = useRef(null);
  const cardRef = useRef(null);

  const scrollStepToTop = useCallback(() => {
    const reset = () => {
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        if (document.documentElement) document.documentElement.scrollTop = 0;
        if (document.body) document.body.scrollTop = 0;
      }
      pageTopRef.current?.scrollIntoView?.({ behavior: 'auto', block: 'start' });
      if (cardRef.current) {
        cardRef.current.scrollTop = 0;
        cardRef.current.scrollLeft = 0;
      }
      if (stepBodyRef.current) {
        stepBodyRef.current.scrollTop = 0;
        stepBodyRef.current.scrollLeft = 0;
      }
      try {
        pageTopRef.current?.focus?.({ preventScroll: true });
      } catch {
        // ignore focus errors on older browsers
      }
    };

    reset();
    requestAnimationFrame(() => {
      reset();
      requestAnimationFrame(reset);
    });
  }, []);

  const load = useCallback(async () => {
    if (!businessId || !token) {
      setError('Invalid terms link.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('booking-terms-ack', {
        body: { action: 'load', businessId, token },
      });
      if (invokeError) throw new Error(invokeError.message || 'Could not load terms');
      if (data?.error) throw new Error(data.error);
      setPayload(data);
      if (data?.alreadySigned) setCompleted(true);
    } catch (err) {
      setError(err?.message || 'Could not load Terms & Conditions');
    } finally {
      setLoading(false);
    }
  }, [businessId, token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (loading || error || completed) return;
    scrollStepToTop();
    const t1 = window.setTimeout(scrollStepToTop, 50);
    const t2 = window.setTimeout(scrollStepToTop, 200);
    const t3 = window.setTimeout(scrollStepToTop, 400);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [stepIndex, loading, error, completed, scrollStepToTop]);

  const steps = payload?.steps || [];
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
    scrollStepToTop();
  };

  const handleBack = () => {
    setStepIndex((prev) => Math.max(0, prev - 1));
    scrollStepToTop();
  };

  const handleSubmit = async () => {
    if (!signerName.trim()) {
      toast.error('Please enter your full name');
      return;
    }
    if (!signatureReady || !signaturePayload?.imageUrl) {
      toast.error('Please draw your signature');
      return;
    }
    setSubmitting(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('booking-terms-ack', {
        body: {
          action: 'submit',
          businessId,
          token,
          signerName: signerName.trim(),
          signatureData: signaturePayload,
          acknowledgments: Array.from(acknowledgedStepIds).map((stepId) => ({ stepId })),
        },
      });
      if (invokeError) throw new Error(invokeError.message || 'Could not submit');
      if (data?.error) throw new Error(data.error);
      setCompleted(true);
      toast.success('Terms & Conditions signed');
    } catch (err) {
      toast.error(err?.message || 'Could not submit signature');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>Loading Terms & Conditions…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h1 style={styles.title}>Unable to open Terms & Conditions</h1>
          <p style={styles.body}>{error}</p>
        </div>
      </div>
    );
  }

  if (completed || payload?.alreadySigned) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.successIcon}><FiCheck size={28} /></div>
          <h1 style={styles.title}>Thank you</h1>
          <p style={styles.body}>
            Your Terms & Conditions acknowledgment for{' '}
            <strong>{payload?.booking?.activity_name || 'your booking'}</strong> has been received.
            Our team will review it and follow up once your booking is approved.
          </p>
          {payload?.booking?.booking_number && (
            <p style={{ ...styles.body, marginTop: 8 }}>
              Booking #{payload.booking.booking_number}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div
        ref={pageTopRef}
        id="booking-terms-top"
        tabIndex={-1}
        style={styles.topAnchor}
        aria-hidden="true"
      />
      <div style={styles.card} ref={cardRef}>
        <div style={styles.eyebrow}>{payload?.business?.name || 'Booking'}</div>
        <h1 style={styles.title}>{payload?.package?.name || 'Terms & Conditions'}</h1>
        <p style={styles.meta}>
          {payload?.booking?.activity_name}
          {payload?.booking?.booking_number ? ` · #${payload.booking.booking_number}` : ''}
        </p>
        <div style={styles.progress}>{progressLabel}</div>

        {!isSignatureStep && currentStep ? (
          <>
            <h2 style={styles.stepTitle}>{currentStep.title}</h2>
            <div
              key={`step-body-${currentStep.id}`}
              style={styles.stepBody}
              ref={stepBodyRef}
            >
              {(currentStep.body || '').split(/\n+/).filter(Boolean).map((paragraph, index) => (
                <p key={`${currentStep.id}-${index}`} style={{ margin: '0 0 12px' }}>
                  {paragraph}
                </p>
              ))}
            </div>
            {currentStep.require_acknowledge !== false && (
              <div style={{ marginTop: 16 }}>
                <TavariCheckbox
                  id={`ack-step-${currentStep.id}`}
                  checked={currentAcknowledged}
                  onChange={handleAcknowledgeCurrent}
                  label="I have read and understand this section"
                />
              </div>
            )}
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
            <h2 style={styles.stepTitle}>Sign to confirm</h2>
            <p style={styles.body}>
              By signing below, you confirm that you have read and agree to all Terms & Conditions steps for this booking.
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
            <div style={{ marginTop: 16 }}>
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
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                style={styles.primaryBtn}
              >
                {submitting ? 'Submitting…' : 'Submit signed Terms'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100dvh',
    background: 'linear-gradient(180deg, #f0fdfa 0%, #f8fafc 40%, #eef2ff 100%)',
    padding: 'clamp(16px, 3vw, 40px) clamp(12px, 4vw, 32px)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    boxSizing: 'border-box',
    position: 'relative',
  },
  topAnchor: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    outline: 'none',
  },
  card: {
    width: '100%',
    maxWidth: 'min(920px, 100%)',
    background: '#fff',
    borderRadius: 16,
    padding: 'clamp(20px, 3vw, 36px) clamp(16px, 3vw, 32px)',
    boxShadow: '0 16px 40px rgba(15, 23, 42, 0.08)',
    boxSizing: 'border-box',
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: TavariStyles.colors.primary,
    marginBottom: 8,
  },
  title: {
    margin: 0,
    fontSize: 'clamp(22px, 2.4vw, 30px)',
    fontWeight: 800,
    color: TavariStyles.colors.gray900,
  },
  meta: {
    margin: '8px 0 0',
    color: TavariStyles.colors.gray600,
    fontSize: 14,
  },
  progress: {
    marginTop: 16,
    marginBottom: 20,
    fontSize: 13,
    fontWeight: 600,
    color: TavariStyles.colors.gray500,
  },
  stepTitle: {
    margin: '0 0 12px',
    fontSize: 'clamp(17px, 1.8vw, 22px)',
    fontWeight: 700,
    color: TavariStyles.colors.gray900,
  },
  stepBody: {
    fontSize: 'clamp(14px, 1.15vw, 16px)',
    lineHeight: 1.65,
    color: TavariStyles.colors.gray700,
    // Mobile stays compact; desktop grows with the viewport so it doesn't look like a tiny box.
    maxHeight: 'clamp(260px, 58vh, 70dvh)',
    overflow: 'auto',
    paddingRight: 4,
    overflowAnchor: 'none',
    WebkitOverflowScrolling: 'touch',
  },
  body: {
    fontSize: 15,
    lineHeight: 1.6,
    color: TavariStyles.colors.gray700,
    margin: 0,
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    marginTop: 16,
  },
  input: {
    border: '1px solid #d1d5db',
    borderRadius: 8,
    padding: '12px 14px',
    fontSize: 15,
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 24,
  },
  primaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    border: 'none',
    borderRadius: 10,
    padding: '12px 18px',
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
    padding: '12px 18px',
    backgroundColor: '#fff',
    color: TavariStyles.colors.gray700,
    fontWeight: 600,
    cursor: 'pointer',
  },
  successIcon: {
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: '#d1fae5',
    color: '#047857',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
};
