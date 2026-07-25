// OTP Authentication Step for Public Waiver Flow
import React, { useState } from 'react';
import { FiLock, FiMail, FiPhone, FiArrowRight } from 'react-icons/fi';
import { TavariStyles } from '../../../utils/TavariStyles';
import { useInactivityTimer } from '../../../hooks/useInactivityTimer';
import {
  WAIVER_PRE_OTP_TIMEOUT_SECONDS,
  WAIVER_TIMEOUT_WARNING_SECONDS
} from '../../../constants/waiverInactivity';
import CancelConfirmationModal from './CancelConfirmationModal';
import TimeoutWarningModal from './TimeoutWarningModal';
import toast from 'react-hot-toast';

const OTPStep = ({
  phoneNumber,
  setPhoneNumber,
  otpCode,
  setOtpCode,
  otpSent,
  otpVerified,
  setOtpSent,
  onSendOTP,
  onVerifyOTP,
  onSkip,
  onCancel,
  suspendInactivityTimer = false
}) => {
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const { timeRemaining, resetTimer, showWarning, setShowWarning } = useInactivityTimer(
    () => {
      if (onCancel) onCancel({ reason: 'idle_ad' });
    },
    WAIVER_PRE_OTP_TIMEOUT_SECONDS,
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

  const handleSend = async () => {
    if (!phoneNumber || phoneNumber.replace(/\D/g, '').length < 10) {
      toast.error('Please enter a valid phone number');
      return;
    }
    setSending(true);
    try {
      await onSendOTP();
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async () => {
    if (!otpCode || otpCode.length !== 6) {
      toast.error('Please enter a valid 6-digit OTP code');
      return;
    }
    setVerifying(true);
    try {
      await onVerifyOTP();
    } finally {
      setVerifying(false);
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
          <FiLock size={48} style={styles.icon} />
          <h1 style={styles.title} className="public-waiver-title">Verify Your Identity</h1>
          <p style={styles.subtitle}>
            For security, we'll send a one-time code to your email address
          </p>
        </div>

        <div style={styles.body}>
        {!otpSent ? (
          <div style={styles.form}>
            <label style={styles.label}>
              <FiPhone style={styles.labelIcon} />
              Phone Number
            </label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="(555) 123-4567"
              style={styles.input}
              maxLength={20}
            />
            <button
              onClick={handleSend}
              disabled={sending || !phoneNumber}
              style={{
                ...styles.button,
                ...((sending || !phoneNumber) && styles.buttonDisabled)
              }}
            >
              {sending ? 'Sending...' : 'Send OTP Code'}
              <FiArrowRight style={styles.buttonIcon} />
            </button>

            {onSkip && (
              <>
                <p style={styles.signNewHint}>
                  Can&apos;t access your email, or prefer not to verify? You can complete a new waiver
                  using this phone number instead.
                </p>
                <button
                  type="button"
                  onClick={onSkip}
                  style={styles.signNewWaiverButton}
                >
                  Sign New Waiver
                </button>
              </>
            )}
          </div>
        ) : !otpVerified ? (
          <div style={styles.form}>
            <div style={styles.successMessage}>
              <FiMail style={styles.successIcon} />
              <div>
                <p style={styles.successText}>OTP sent to your email</p>
                <p style={styles.successSubtext}>
                  Please check your email and enter the 6-digit code
                </p>
              </div>
            </div>
            
            <label style={styles.label}>
              Enter OTP Code
            </label>
            <input
              type="text"
              value={otpCode}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                setOtpCode(value);
              }}
              placeholder="000000"
              style={styles.otpInput}
              maxLength={6}
              autoFocus
            />
            
            <button
              onClick={handleVerify}
              disabled={verifying || otpCode.length !== 6}
              style={{
                ...styles.button,
                ...((verifying || otpCode.length !== 6) && styles.buttonDisabled)
              }}
            >
              {verifying ? 'Verifying...' : 'Verify OTP'}
              <FiArrowRight style={styles.buttonIcon} />
            </button>

            {onSkip && (
              <p style={styles.signNewHint}>
                Can&apos;t access your email? You can complete a new waiver using this phone number
                instead.
              </p>
            )}

            <div style={styles.linkButtonContainer} className="public-waiver-actions">
              <button
                onClick={() => {
                  if (setOtpSent) setOtpSent(false);
                  setOtpCode('');
                }}
                style={styles.linkButton}
              >
                Change phone number
              </button>
              {onSkip && (
                <button type="button" onClick={onSkip} style={styles.signNewWaiverButtonSecondary}>
                  Sign New Waiver
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
            </div>
          </div>
        ) : (
          <div style={styles.verified}>
            <FiLock style={styles.verifiedIcon} />
            <h2 style={styles.verifiedTitle}>Identity Verified</h2>
            <p style={styles.verifiedText}>You can now proceed to sign the waiver</p>
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
    justifyContent: 'center',
    padding: '2rem',
    backgroundColor: TavariStyles.colors.background
  },
  card: {
    width: '100%',
    maxWidth: '450px',
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
    color: TavariStyles.colors.gray600,
    maxWidth: '500px'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem'
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: TavariStyles.colors.text,
    marginBottom: '0.5rem'
  },
  labelIcon: {
    color: TavariStyles.colors.gray600
  },
  input: {
    padding: '0.875rem',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    width: '100%',
    boxSizing: 'border-box'
  },
  otpInput: {
    padding: '1rem',
    border: `2px solid ${TavariStyles.colors.primary}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1.5rem',
    fontWeight: 'bold',
    textAlign: 'center',
    letterSpacing: '0.5rem',
    width: '100%',
    boxSizing: 'border-box'
  },
  button: {
    padding: '1rem',
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
    transition: 'background-color 0.2s'
  },
  buttonDisabled: {
    backgroundColor: TavariStyles.colors.gray300,
    cursor: 'not-allowed',
    opacity: 0.6
  },
  buttonIcon: {
    fontSize: '1.25rem'
  },
  linkButtonContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    alignItems: 'stretch',
    width: '100%',
    maxWidth: '100%'
  },
  signNewHint: {
    fontSize: '0.875rem',
    color: TavariStyles.colors.gray600,
    textAlign: 'center',
    lineHeight: 1.45,
    margin: '0',
    marginTop: '0.25rem'
  },
  signNewWaiverButton: {
    padding: '0.875rem 1rem',
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.primary,
    border: `2px solid ${TavariStyles.colors.primary}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    width: '100%',
    boxSizing: 'border-box'
  },
  signNewWaiverButtonSecondary: {
    padding: '0.75rem 1rem',
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.primary,
    border: `2px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '0.9375rem',
    fontWeight: '600',
    cursor: 'pointer',
    width: '100%',
    maxWidth: '280px',
    boxSizing: 'border-box'
  },
  linkButton: {
    background: 'none',
    border: 'none',
    color: TavariStyles.colors.primary,
    cursor: 'pointer',
    fontSize: '0.875rem',
    textDecoration: 'underline',
    padding: '0.5rem'
  },
  successMessage: {
    display: 'flex',
    gap: '1rem',
    padding: '1rem',
    backgroundColor: '#ECFDF5',
    borderRadius: TavariStyles.borderRadius.md,
    border: '1px solid #10B981',
    marginBottom: '1rem'
  },
  successIcon: {
    color: '#10B981',
    fontSize: '1.5rem',
    flexShrink: 0
  },
  successText: {
    fontWeight: '600',
    color: TavariStyles.colors.text,
    marginBottom: '0.25rem'
  },
  successSubtext: {
    fontSize: '0.875rem',
    color: TavariStyles.colors.gray600
  },
  verified: {
    textAlign: 'center',
    padding: '2rem'
  },
  verifiedIcon: {
    fontSize: '4rem',
    color: '#10B981',
    marginBottom: '1rem'
  },
  verifiedTitle: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    marginBottom: '0.5rem'
  },
  verifiedText: {
    color: TavariStyles.colors.gray600
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
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box'
  }
};

export default OTPStep;



