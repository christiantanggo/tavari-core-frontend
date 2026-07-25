// Second confirmation before adding an additional adult — legal acknowledgment stored with the waiver.
import React, { useState } from 'react';
import { FiAlertTriangle, FiArrowLeft, FiCheck } from 'react-icons/fi';
import { TavariStyles } from '../../../utils/TavariStyles';
import { useInactivityTimer } from '../../../hooks/useInactivityTimer';
import {
  WAIVER_POST_OTP_TIMEOUT_SECONDS,
  WAIVER_TIMEOUT_WARNING_SECONDS
} from '../../../constants/waiverInactivity';
import CancelConfirmationModal from './CancelConfirmationModal';
import TimeoutWarningModal from './TimeoutWarningModal';
import { getAdditionalAdultIntentAcknowledgmentFullText } from '../../../constants/waiverLegalCopy';
import {
  ADDITIONAL_ADULT_PORTAL_OPTIONS,
  DEFAULT_ADDITIONAL_ADULT_PORTAL_ACCESS
} from '../../../constants/waiverParticipantPortalAccess';

const AdditionalAdultIntentAckStep = ({
  onConfirm,
  onBack,
  onCancel,
  portalAccess = DEFAULT_ADDITIONAL_ADULT_PORTAL_ACCESS,
  onPortalAccessChange,
  suspendInactivityTimer = false
}) => {
  const [checked, setChecked] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const fullText = getAdditionalAdultIntentAcknowledgmentFullText();

  const { timeRemaining, resetTimer, showWarning, setShowWarning } = useInactivityTimer(() => {
    if (onCancel) onCancel({ reason: 'idle_ad' });
  }, WAIVER_POST_OTP_TIMEOUT_SECONDS, null, {
    enabled: !suspendInactivityTimer,
    warningSeconds: WAIVER_TIMEOUT_WARNING_SECONDS
  });

  const handleExtendSession = () => {
    resetTimer();
    setShowWarning(false);
  };

  const handleCloseSession = () => {
    if (onCancel) onCancel();
  };

  return (
    <div style={styles.container}>
      {showWarning && (
        <TimeoutWarningModal
          onClose={handleCloseSession}
          onExtend={handleExtendSession}
          timeRemaining={timeRemaining}
        />
      )}
      {showCancelConfirm && (
        <CancelConfirmationModal
          onConfirm={() => {
            setShowCancelConfirm(false);
            if (onCancel) onCancel();
          }}
          onCancel={() => setShowCancelConfirm(false)}
        />
      )}
      <div style={styles.card}>
        <div style={styles.header}>
          <FiAlertTriangle size={40} style={styles.icon} />
          <h1 style={styles.title}>Confirm: additional adult will sign personally</h1>
          <p style={styles.subtitle}>
            Read this carefully. Your acknowledgment is stored with the waiver for legal purposes.
          </p>
        </div>

        <div style={styles.bodyBox}>
          <p style={styles.bodyText}>{fullText}</p>
        </div>

        <div style={styles.portalSection}>
          <h2 style={styles.portalTitle}>When they look up this waiver with their own phone</h2>
          <p style={styles.portalHint}>
            Choose what the additional adult may see after they verify their number. This applies to this
            waiver only.
          </p>
          <div style={styles.portalOptions} role="radiogroup" aria-label="Portal access for additional adult">
            {ADDITIONAL_ADULT_PORTAL_OPTIONS.map((opt) => (
              <label key={opt.value} style={styles.portalOptionRow}>
                <input
                  type="radio"
                  name="additional-adult-portal-access"
                  value={opt.value}
                  checked={portalAccess === opt.value}
                  onChange={() => onPortalAccessChange?.(opt.value)}
                  style={styles.portalRadio}
                />
                <span style={styles.portalOptionText}>
                  <span style={styles.portalOptionTitle}>{opt.title}</span>
                  <span style={styles.portalOptionDesc}>{opt.description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <label style={styles.checkRow}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            style={styles.checkbox}
          />
          <span style={styles.checkLabel}>
            I have read the above, I am the primary signer or an authorized person starting this step for the
            correct additional adult only, and the information is true.
          </span>
        </label>

        <div style={styles.buttons}>
          <button
            type="button"
            onClick={onBack}
            style={styles.backButton}
          >
            <FiArrowLeft style={styles.buttonIcon} />
            Back
          </button>
          <button
            type="button"
            disabled={!checked}
            onClick={() => checked && onConfirm()}
            style={{
              ...styles.confirmButton,
              ...(!checked ? { opacity: 0.45, cursor: 'not-allowed' } : {})
            }}
          >
            <FiCheck style={styles.buttonIcon} />
            I understand — continue
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={() => setShowCancelConfirm(true)}
              style={styles.cancelButton}
            >
              Cancel entire waiver
            </button>
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
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1.25rem',
    backgroundColor: TavariStyles.colors.background,
    boxSizing: 'border-box'
  },
  card: {
    width: '100%',
    maxWidth: '720px',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: '1.75rem',
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    boxShadow: `0 0 0 1px ${TavariStyles.colors.gray200}, ${TavariStyles.shadows.lg}`
  },
  header: {
    textAlign: 'center',
    marginBottom: '1.25rem'
  },
  icon: {
    color: '#D97706',
    marginBottom: '0.75rem'
  },
  title: {
    fontSize: '1.35rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    margin: '0 0 0.5rem 0',
    lineHeight: 1.25
  },
  subtitle: {
    fontSize: '0.9rem',
    color: TavariStyles.colors.gray600,
    margin: 0
  },
  bodyBox: {
    padding: '1rem 1.1rem',
    backgroundColor: '#FEFCE8',
    border: '1px solid #FDE047',
    borderRadius: TavariStyles.borderRadius.md,
    marginBottom: '1.25rem',
    maxHeight: 'min(42vh, 320px)',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch'
  },
  bodyText: {
    margin: 0,
    fontSize: '0.875rem',
    lineHeight: 1.65,
    color: TavariStyles.colors.text,
    whiteSpace: 'pre-wrap'
  },
  portalSection: {
    marginBottom: '1.25rem',
    padding: '1rem',
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    backgroundColor: '#fafafa'
  },
  portalTitle: {
    margin: '0 0 0.35rem 0',
    fontSize: '1rem',
    fontWeight: 700,
    color: TavariStyles.colors.text
  },
  portalHint: {
    margin: '0 0 0.75rem 0',
    fontSize: '0.8rem',
    lineHeight: 1.45,
    color: TavariStyles.colors.gray600
  },
  portalOptions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  portalOptionRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    cursor: 'pointer'
  },
  portalRadio: {
    marginTop: '4px',
    flexShrink: 0
  },
  portalOptionText: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  portalOptionTitle: {
    fontSize: '0.875rem',
    fontWeight: 600,
    color: TavariStyles.colors.text
  },
  portalOptionDesc: {
    fontSize: '0.75rem',
    lineHeight: 1.4,
    color: TavariStyles.colors.gray600
  },
  checkRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    marginBottom: '1.25rem',
    cursor: 'pointer',
    fontSize: '0.9rem',
    lineHeight: 1.5,
    color: TavariStyles.colors.text
  },
  checkbox: {
    marginTop: '4px',
    width: '18px',
    height: '18px',
    flexShrink: 0
  },
  checkLabel: {
    flex: 1,
    minWidth: 0
  },
  buttons: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  backButton: {
    padding: '0.85rem 1.25rem',
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.text,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    width: '100%'
  },
  confirmButton: {
    padding: '0.85rem 1.25rem',
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    width: '100%'
  },
  cancelButton: {
    padding: '0.75rem',
    backgroundColor: 'transparent',
    color: TavariStyles.colors.gray600,
    border: 'none',
    fontSize: '0.875rem',
    cursor: 'pointer',
    textDecoration: 'underline'
  },
  buttonIcon: {
    fontSize: '1.15rem'
  }
};

export default AdditionalAdultIntentAckStep;
