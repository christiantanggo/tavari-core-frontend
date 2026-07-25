// Legal Warning Step - Shows before each additional adult signs
import React from 'react';
import { FiAlertTriangle, FiCheckCircle } from 'react-icons/fi';
import { TavariStyles } from '../../../utils/TavariStyles';
import { useInactivityTimer } from '../../../hooks/useInactivityTimer';
import {
  WAIVER_POST_OTP_TIMEOUT_SECONDS,
  WAIVER_TIMEOUT_WARNING_SECONDS
} from '../../../constants/waiverInactivity';
import TimeoutWarningModal from './TimeoutWarningModal';

const LegalWarningStep = ({ onAcknowledge, onCancel, suspendInactivityTimer = false }) => {
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
    if (onCancel) onCancel({ reason: 'idle_ad' });
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
      <div style={styles.content} className="public-waiver-card">
        <div style={styles.warningBox}>
          <FiAlertTriangle size={64} style={styles.warningIcon} />
          <h1 style={styles.title} className="public-waiver-title">Important Legal Notice</h1>
          <div style={styles.warningContent}>
            <p style={styles.warningText}>
              <strong>It is illegal to sign a legal document (such as a liability waiver) for someone else.</strong>
            </p>
            <p style={styles.warningText}>
              Each adult must sign the waiver themselves. You cannot sign on behalf of another adult.
            </p>
            <p style={styles.warningText}>
              By clicking "I Understand" below, you acknowledge that:
            </p>
            <ul style={styles.list}>
              <li>You are accepting responsibility for signing this waiver</li>
              <li>You understand it is illegal to sign for someone else</li>
              <li>The person signing must be present and consenting</li>
            </ul>
          </div>
          <div style={styles.buttonContainer} className="public-waiver-actions">
            {onCancel && (
              <button
                onClick={onCancel}
                style={styles.cancelButton}
              >
                Cancel
              </button>
            )}
            <button
              onClick={onAcknowledge}
              style={styles.button}
            >
              <FiCheckCircle style={styles.buttonIcon} />
              I Understand - Continue
            </button>
          </div>
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
    padding: '2rem',
    backgroundColor: TavariStyles.colors.background
  },
  content: {
    width: '100%',
    maxWidth: '600px',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    boxShadow: TavariStyles.shadows.xl,
    overflow: 'hidden'
  },
  warningBox: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: 0,
    padding: '3rem',
    boxShadow: 'none',
    border: `3px solid #F59E0B`,
    textAlign: 'center',
    boxSizing: 'border-box'
  },
  warningIcon: {
    color: '#F59E0B',
    marginBottom: '1.5rem'
  },
  title: {
    fontSize: '1.75rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    marginBottom: '1.5rem'
  },
  warningContent: {
    textAlign: 'left',
    marginBottom: '2rem'
  },
  warningText: {
    fontSize: '1rem',
    color: TavariStyles.colors.text,
    lineHeight: '1.6',
    marginBottom: '1rem'
  },
  list: {
    marginLeft: '1.5rem',
    marginTop: '1rem',
    lineHeight: '1.8'
  },
  buttonContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '1rem',
    justifyContent: 'stretch',
    width: '100%',
    maxWidth: '100%'
  },
  button: {
    padding: '1rem 2rem',
    backgroundColor: '#F59E0B',
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
    flex: '1 1 8rem',
    minWidth: 0,
    maxWidth: '100%',
    transition: 'background-color 0.2s'
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
    flex: '1 1 8rem',
    minWidth: 0,
    maxWidth: '100%'
  },
  buttonIcon: {
    fontSize: '1.25rem'
  }
};

export default LegalWarningStep;



