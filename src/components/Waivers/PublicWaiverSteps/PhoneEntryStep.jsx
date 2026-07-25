// Phone Entry Step for Public Waiver Flow
// First screen - just collect phone number
import React, { useState } from 'react';
import { FiPhone, FiArrowRight } from 'react-icons/fi';
import { TavariStyles } from '../../../utils/TavariStyles';
import { useInactivityTimer } from '../../../hooks/useInactivityTimer';
import {
  WAIVER_PRE_OTP_TIMEOUT_SECONDS,
  WAIVER_TIMEOUT_WARNING_SECONDS
} from '../../../constants/waiverInactivity';
import CancelConfirmationModal from './CancelConfirmationModal';
import TimeoutWarningModal from './TimeoutWarningModal';
import LookupRetryModal from './LookupRetryModal';
import toast from 'react-hot-toast';

const PhoneEntryStep = ({
  phoneNumber,
  setPhoneNumber,
  onContinue,
  loading = false,
  onCancel,
  showLookupRetryModal = false,
  lookupRetryMessage = '',
  onRetryLookup,
  suspendInactivityTimer = false
}) => {
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
    if (onCancel) onCancel({ reason: 'idle_ad' });
  };
  // Format phone number with dashes
  const formatPhoneNumber = (value) => {
    // Remove all non-digit characters
    const digits = value.replace(/\D/g, '');
    
    // Format as (XXX) XXX-XXXX
    if (digits.length <= 3) {
      return digits;
    } else if (digits.length <= 6) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    } else {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
    }
  };

  const handlePhoneChange = (e) => {
    const formatted = formatPhoneNumber(e.target.value);
    setPhoneNumber(formatted);
  };

  const handleContinue = () => {
    if (!phoneNumber || phoneNumber.replace(/\D/g, '').length < 10) {
      toast.error('Please enter a valid phone number');
      return;
    }
    onContinue();
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
      {showLookupRetryModal && (
        <LookupRetryModal
          message={
            lookupRetryMessage ||
            'We could not check for an existing waiver right now. Please try again.'
          }
          onRetry={onRetryLookup || onContinue}
        />
      )}
      <div style={styles.card} className="public-waiver-card">
        <div style={styles.header}>
          <FiPhone size={48} style={styles.icon} />
          <h1 style={styles.title} className="public-waiver-title">Welcome</h1>
          <p style={styles.subtitle}>
            Please enter your phone number to continue
          </p>
        </div>

        <div style={styles.body}>
          <div style={styles.form}>
            <label style={styles.label}>
              <FiPhone style={styles.labelIcon} />
              Phone Number
            </label>
            <input
              type="tel"
              data-testid="waiver-phone-entry"
              value={phoneNumber}
              onChange={handlePhoneChange}
              placeholder="(555) 123-4567"
              style={styles.input}
              maxLength={14}
              autoFocus
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleContinue();
                }
              }}
            />
            <div style={styles.buttonContainer} className="public-waiver-actions">
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
                data-testid="waiver-phone-continue"
                onClick={handleContinue}
                disabled={loading || !phoneNumber}
                style={{
                  ...styles.button,
                  ...((loading || !phoneNumber) && styles.buttonDisabled)
                }}
              >
                {loading ? 'Checking...' : 'Continue'}
                <FiArrowRight style={styles.buttonIcon} />
              </button>
            </div>
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
  buttonContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '1rem',
    justifyContent: 'stretch',
    alignItems: 'stretch',
    width: '100%',
    maxWidth: '100%'
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
  buttonDisabled: {
    backgroundColor: TavariStyles.colors.gray300,
    cursor: 'not-allowed',
    opacity: 0.6
  },
  buttonIcon: {
    fontSize: '1.25rem'
  }
};

export default PhoneEntryStep;


