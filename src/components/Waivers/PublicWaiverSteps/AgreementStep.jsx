// Agreement Step - User must scroll to bottom and agree (or proceed if content is short)
import React, { useState, useRef, useEffect } from 'react';
import { FiFileText, FiCheck, FiArrowDown } from 'react-icons/fi';
import { TavariStyles } from '../../../utils/TavariStyles';
import TavariCheckbox from '../../UI/TavariCheckbox';
import { useInactivityTimer } from '../../../hooks/useInactivityTimer';
import {
  WAIVER_POST_OTP_TIMEOUT_SECONDS,
  WAIVER_TIMEOUT_WARNING_SECONDS
} from '../../../constants/waiverInactivity';
import CancelConfirmationModal from './CancelConfirmationModal';
import TimeoutWarningModal from './TimeoutWarningModal';
import toast from 'react-hot-toast';
import { waiverTemplateBodyInnerHtml } from '../../../services/Waivers/waiverRecordDocumentHtml';

const SCROLL_THRESHOLD = 50;

function shouldDefaultMarketingConsentToChecked(rawValue) {
  if (typeof rawValue === 'boolean') return rawValue;
  if (typeof rawValue === 'number') return rawValue !== 0;
  if (typeof rawValue === 'string') {
    return !['false', '0', 'no', 'off'].includes(rawValue.trim().toLowerCase());
  }
  return rawValue !== false;
}

const AgreementStep = ({
  template,
  agreementScrolled,
  agreementAgreed,
  onScroll,
  onAgree,
  onCancel,
  onBack,
  waiverSettings = {},
  onConsentChange,
  consentStates = {},
  signingForMinors = false,
  minorsLabel = '',
  suspendInactivityTimer = false
}) => {
  const contentRef = useRef(null);
  const showMarketingConsent = true;
  const defaultMarketingConsentChecked = shouldDefaultMarketingConsentToChecked(waiverSettings?.auto_click_marketing);
  const [scrolled, setScrolled] = useState(agreementScrolled || false);
  const [contentNeedsScroll, setContentNeedsScroll] = useState(true); // true until we measure
  const [localAgreed, setLocalAgreed] = useState(agreementAgreed || false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(
    typeof consentStates?.marketing === 'boolean'
      ? consentStates.marketing
      : defaultMarketingConsentChecked
  );

  const { timeRemaining, resetTimer, showWarning, setShowWarning } = useInactivityTimer(
    () => {
      if (onCancel) onCancel({ reason: 'idle_ad' });
    },
    WAIVER_POST_OTP_TIMEOUT_SECONDS,
    null,
    { enabled: !suspendInactivityTimer, warningSeconds: WAIVER_TIMEOUT_WARNING_SECONDS }
  );
  
  const handleExtendSession = () => {
    resetTimer();
    setShowWarning(false);
  };
  
  const handleCloseSession = () => {
    if (onCancel) onCancel();
  };

  // Sync with parent state
  React.useEffect(() => {
    setScrolled(agreementScrolled || false);
  }, [agreementScrolled]);

  React.useEffect(() => {
    setLocalAgreed(agreementAgreed || false);
  }, [agreementAgreed]);

  React.useEffect(() => {
    setMarketingConsent(
      typeof consentStates?.marketing === 'boolean'
        ? consentStates.marketing
        : defaultMarketingConsentChecked
    );
  }, [consentStates, defaultMarketingConsentChecked]);

  React.useEffect(() => {
    if (!showMarketingConsent || !onConsentChange) return;
    if (consentStates?.marketing === marketingConsent) return;
    onConsentChange({
      ...(consentStates && typeof consentStates === 'object' ? consentStates : {}),
      marketing: marketingConsent
    });
  }, [marketingConsent, showMarketingConsent, onConsentChange, consentStates]);

  // When waiver content is short (no overflow), treat as already scrolled so user can continue without scrolling
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !template?.waiver_content) return;
    const check = () => {
      const overflow = el.scrollHeight > el.clientHeight + SCROLL_THRESHOLD;
      setContentNeedsScroll(overflow);
      if (!overflow && !scrolled) {
        setScrolled(true);
        if (onScroll) onScroll({ target: el });
      }
    };
    check();
    const t = setTimeout(check, 100); // re-check after innerHTML/layout
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, [template?.waiver_content, scrolled, onScroll]);

  const handleScroll = (e) => {
    try {
      const element = e.target;
      const scrolledToBottom = element.scrollHeight - element.scrollTop <= element.clientHeight + SCROLL_THRESHOLD;

      if (scrolledToBottom && !scrolled) {
        setScrolled(true);
        if (onScroll) onScroll(e);
      }
    } catch (error) {
      console.error('[AgreementStep] Scroll error:', error);
    }
  };

  const handleAgree = () => {
    if (!scrolled) {
      toast.error('Please scroll to the bottom of the waiver to read it completely');
      return;
    }
    if (!localAgreed) {
      toast.error('Please check the agreement checkbox to continue');
      return;
    }
    if (onAgree) {
      onAgree(
        showMarketingConsent
          ? {
              ...(consentStates && typeof consentStates === 'object' ? consentStates : {}),
              marketing: marketingConsent
            }
          : (consentStates && typeof consentStates === 'object' ? consentStates : {})
      );
    }
  };

  const handleCancelClick = () => {
    setShowCancelConfirm(true);
  };

  const handleCancelConfirm = () => {
    setShowCancelConfirm(false);
    if (onCancel) onCancel();
  };

  const handleCancelCancel = () => {
    setShowCancelConfirm(false);
  };

  return (
    <div style={styles.container} className="public-waiver-shell public-waiver-flow">
      {showWarning && (
        <TimeoutWarningModal
          onClose={handleCloseSession}
          onExtend={handleExtendSession}
          timeRemaining={timeRemaining}
        />
      )}
      {showCancelConfirm && (
        <CancelConfirmationModal
          onConfirm={handleCancelConfirm}
          onCancel={handleCancelCancel}
        />
      )}
      <div style={styles.card} className="public-waiver-card">
        <div style={styles.header}>
          <FiFileText size={48} style={styles.icon} />
          <h1 style={styles.title} className="public-waiver-title">
            {signingForMinors ? 'Sign for Minors (Guardian)' : 'Please Read the Waiver'}
          </h1>
          <p style={styles.subtitle}>
            {signingForMinors && minorsLabel
              ? `As their guardian, read the waiver and agree on behalf of: ${minorsLabel}`
              : contentNeedsScroll
                ? 'Scroll to the bottom of the waiver content and agree to continue'
                : 'Read the waiver content and agree to continue'}
          </p>
        </div>

        <div style={styles.body}>
        {contentNeedsScroll && (
          <div style={styles.instructions}>
            <FiArrowDown style={styles.instructionIcon} />
            <p>Scroll down to read the entire waiver document</p>
          </div>
        )}

        <div
          ref={contentRef}
          onScroll={handleScroll}
          style={styles.waiverContent}
          className="public-waiver-waiver-scroll"
          dangerouslySetInnerHTML={{ __html: waiverTemplateBodyInnerHtml(template?.waiver_content || '') }}
          onError={(e) => {
            console.error('[AgreementStep] Error rendering waiver content:', e);
            // Fallback: show error message
            if (contentRef.current) {
              contentRef.current.innerHTML = '<p style="color: red; padding: 20px;">Error loading waiver content. Please refresh the page.</p>';
            }
          }}
        />

        <div style={styles.agreementSection} className="public-waiver-agreement-section">
          <TavariCheckbox
            checked={localAgreed}
            onChange={(checked) => setLocalAgreed(checked)}
            label={
              scrolled
                ? 'I have read and understood the waiver. I agree to the terms and conditions.'
                : 'Scroll to the bottom of the waiver before you can confirm that you understand it.'
            }
            size="md"
            disabled={!scrolled}
          />

          {showMarketingConsent && (
            <div style={styles.marketingConsentCard}>
              <TavariCheckbox
                checked={marketingConsent}
                onChange={setMarketingConsent}
                label="I agree to marketing communications"
                size="md"
              />
              <p style={styles.marketingConsentDescription}>
                Receive marketing communications and updates.
              </p>
            </div>
          )}

          <div style={styles.buttonContainer} className="public-waiver-actions">
            {onBack && (
              <button
                onClick={onBack}
                style={styles.backButton}
              >
                Back
              </button>
            )}
            {onCancel && (
              <button
                onClick={handleCancelClick}
                style={styles.cancelButton}
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleAgree}
              disabled={!localAgreed}
              style={{
                ...styles.button,
                ...(!localAgreed && styles.buttonDisabled)
              }}
            >
              <FiCheck style={styles.buttonIcon} />
              I Agree - Continue
            </button>
          </div>
        </div>

        {contentNeedsScroll && !scrolled && (
          <div style={styles.scrollPrompt}>
            <FiArrowDown style={styles.scrollIcon} />
            <p>Please scroll to the bottom to continue</p>
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '2rem',
    backgroundColor: TavariStyles.colors.background
  },
  card: {
    width: '100%',
    maxWidth: '800px',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: '2rem',
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    boxShadow: `0 0 0 1px ${TavariStyles.colors.gray200}, ${TavariStyles.shadows.lg}`
  },
  header: {
    textAlign: 'center',
    marginBottom: '1.5rem'
  },
  body: {
    width: '100%'
  },
  icon: {
    color: TavariStyles.colors.primary,
    marginBottom: '1rem'
  },
  title: {
    fontSize: '2rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    marginBottom: '0.5rem'
  },
  subtitle: {
    fontSize: '1rem',
    color: TavariStyles.colors.gray600
  },
  instructions: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '1rem',
    backgroundColor: '#EFF6FF',
    borderRadius: TavariStyles.borderRadius.md,
    marginBottom: '1rem',
    color: '#1E40AF'
  },
  instructionIcon: {
    fontSize: '1.25rem'
  },
  waiverContent: {
    minHeight: '400px',
    maxHeight: 'calc(100vh - 300px)',
    overflowY: 'auto',
    padding: '1.5rem',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    marginBottom: '1.5rem',
    backgroundColor: TavariStyles.colors.white,
    lineHeight: '1.8',
    whiteSpace: 'break-spaces',
    wordBreak: 'break-word'
  },
  agreementSection: {
    padding: '1.5rem',
    backgroundColor: '#F9FAFB',
    borderRadius: TavariStyles.borderRadius.md,
    border: `2px solid ${TavariStyles.colors.primary}`
  },
  marketingConsentCard: {
    marginTop: '1rem',
    marginBottom: '1.5rem',
    padding: '1rem',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.sm,
    border: `1px solid ${TavariStyles.colors.gray300}`
  },
  marketingConsentDescription: {
    margin: '0.5rem 0 0 2rem',
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray600,
    lineHeight: 1.5
  },
  button: {
    padding: '1rem 2rem',
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    minWidth: 0,
    flex: 1
  },
  buttonDisabled: {
    backgroundColor: TavariStyles.colors.gray300,
    cursor: 'not-allowed',
    opacity: 0.6
  },
  buttonIcon: {
    fontSize: '1.25rem'
  },
  buttonContainer: {
    display: 'flex',
    gap: '1rem',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    width: '100%'
  },
  backButton: {
    padding: '1rem 2rem',
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.text,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    minWidth: 0,
    flex: 1
  },
  cancelButton: {
    padding: '1rem 2rem',
    backgroundColor: '#EF4444',
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    minWidth: 0,
    flex: 1
  },
  scrollPrompt: {
    textAlign: 'center',
    padding: '1rem',
    color: TavariStyles.colors.gray600
  },
  scrollIcon: {
    fontSize: '2rem',
    marginBottom: '0.5rem',
    animation: 'bounce 1s infinite'
  }
};

export default AgreementStep;

