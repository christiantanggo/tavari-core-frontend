// Signature Step - Capture signature using canvas
import React, { useState } from 'react';
import { FiEdit3, FiCheck, FiX } from 'react-icons/fi';
import { TavariStyles } from '../../../utils/TavariStyles';
import WaiverSignatureCapture from '../WaiverSignatureCapture';
import { useInactivityTimer } from '../../../hooks/useInactivityTimer';
import {
  WAIVER_POST_OTP_TIMEOUT_SECONDS,
  WAIVER_TIMEOUT_WARNING_SECONDS
} from '../../../constants/waiverInactivity';
import CancelConfirmationModal from './CancelConfirmationModal';
import TimeoutWarningModal from './TimeoutWarningModal';
import toast from 'react-hot-toast';

const SignatureStep = ({
  participant,
  onSignatureComplete,
  onCancel,
  onBack,
  onCancelForPaper,
  suspendInactivityTimer = false
}) => {
  const [signatureData, setSignatureData] = useState(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [signatureState, setSignatureState] = useState({
    hasSignature: false,
    authorized: false,
    ready: false
  });
  const [showAuthorizationPrompt, setShowAuthorizationPrompt] = useState(false);

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

  const handleSignatureCaptured = (signature) => {
    setSignatureData(signature);
  };

  const handleContinue = () => {
    if (!signatureState.hasSignature) {
      toast.error('Please provide your signature');
      setShowAuthorizationPrompt(false);
      return;
    }

    if (!signatureState.authorized) {
      setShowAuthorizationPrompt(true);
      return;
    }

    if (!signatureData) {
      toast.error('Please authorize your electronic signature to continue');
      return;
    }

    // Authorization is handled by WaiverSignatureCapture component
    onSignatureComplete(signatureData);
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

  const handleCancelForPaper = () => {
    if (onCancelForPaper) {
      onCancelForPaper();
    } else if (onCancel) {
      onCancel();
    }
  };

  const participantLabel = participant?.type === 'minor' 
    ? 'Guardian Signature' 
    : participant?.type === 'additional_adult'
    ? 'Additional Adult Signature'
    : 'Your Signature';
  const isContinueReady = signatureState.ready && !!signatureData;

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
          <FiEdit3 size={48} style={styles.icon} />
          <h1 style={styles.title} className="public-waiver-title">Sign the Waiver</h1>
          <p style={styles.subtitle}>
            Please sign using your finger, mouse, or other pointing device
          </p>
        </div>

        <div style={styles.body}>
        <WaiverSignatureCapture
          onSignatureCaptured={handleSignatureCaptured}
          onClear={() => setSignatureData(null)}
          onSignatureStateChange={(nextState) => {
            setSignatureState(nextState);
            if (nextState.authorized && showAuthorizationPrompt) {
              setShowAuthorizationPrompt(false);
            }
          }}
          showAuthorizationPrompt={showAuthorizationPrompt}
          onDismissAuthorizationPrompt={() => setShowAuthorizationPrompt(false)}
          required={true}
          label={participantLabel}
        />


        {/* Cancel for Paper Option */}
        {(participant?.type === 'additional_adult' || participant?.type === 'primary') && (
          <div style={styles.paperOption}>
            <button
              onClick={handleCancelForPaper}
              style={styles.paperButton}
            >
              <FiX style={styles.buttonIcon} />
              Cancel - Sign on Paper Instead
            </button>
            <p style={styles.paperNote}>
              {participant?.type === 'additional_adult'
                ? 'If you prefer to sign on paper, you can cancel and return to add another adult or continue.'
                : 'If you prefer to sign on paper, you can cancel this digital signing flow and complete the waiver on paper instead.'}
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
            type="button"
            data-testid="waiver-signature-continue"
            onClick={handleContinue}
            aria-disabled={!isContinueReady}
            style={{
              ...styles.button,
              ...(!isContinueReady && styles.buttonDisabled)
            }}
          >
            <FiCheck style={styles.buttonIcon} />
            Continue
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
    flexDirection: 'column',
    alignItems: 'center',
    padding: '2rem',
    backgroundColor: TavariStyles.colors.background
  },
  card: {
    width: '100%',
    maxWidth: '700px',
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
    flex: 1,
    minWidth: 0,
    minHeight: '56px'
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
    marginTop: '1.5rem',
    alignItems: 'stretch',
    width: '100%',
    flexWrap: 'wrap'
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
    flex: 1,
    minWidth: 0,
    minHeight: '56px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  cancelButton: {
    padding: '1rem 2rem',
    backgroundColor: '#FFF5F5',
    color: '#B91C1C',
    border: '1px solid #FECACA',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    flex: 1,
    minWidth: 0,
    minHeight: '56px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  paperOption: {
    marginTop: '1.5rem',
    padding: '1rem',
    backgroundColor: '#F9FAFB',
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    textAlign: 'center'
  },
  paperButton: {
    padding: '0.75rem 1.5rem',
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.gray700,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '0.875rem',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    margin: '0 auto 0.5rem'
  },
  paperNote: {
    fontSize: '0.75rem',
    color: TavariStyles.colors.gray600,
    margin: 0
  }
};

export default SignatureStep;


