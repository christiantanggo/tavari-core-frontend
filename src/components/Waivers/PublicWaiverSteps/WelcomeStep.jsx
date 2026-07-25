// Welcome Step for Public Waiver Flow
// First screen - shows company logo, welcome message, and "Start Waiver" button
import React, { useEffect, useState } from 'react';
import { FiFileText, FiArrowRight } from 'react-icons/fi';
import { TavariStyles } from '../../../utils/TavariStyles';
import { useInactivityTimer } from '../../../hooks/useInactivityTimer';
import {
  WAIVER_PRE_OTP_TIMEOUT_SECONDS,
  WAIVER_TIMEOUT_WARNING_SECONDS
} from '../../../constants/waiverInactivity';
import TimeoutWarningModal from './TimeoutWarningModal';

const WelcomeStep = ({ business, onStart, onCancel, suspendInactivityTimer = false }) => {
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    setLogoFailed(false);
  }, [business?.logo_url]);

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

  const showLogo = Boolean(business?.logo_url) && !logoFailed;

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
        {showLogo && (
          <img
            src={business.logo_url}
            alt=""
            role="presentation"
            style={styles.logo}
            onError={() => setLogoFailed(true)}
          />
        )}
        {!showLogo && (
          <FiFileText size={64} style={styles.icon} />
        )}
        
        <h1 style={styles.title} className="public-waiver-title">
          Welcome to {business?.name || 'Our Facility'}
        </h1>
        
        <p style={styles.subtitle}>
          Please complete the waiver to continue
        </p>

        <button
          onClick={onStart}
          style={styles.button}
        >
          Start Waiver
          <FiArrowRight style={styles.buttonIcon} />
        </button>
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
  content: {
    width: '100%',
    maxWidth: '500px',
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: '3rem',
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    boxShadow: `0 0 0 1px ${TavariStyles.colors.gray200}, ${TavariStyles.shadows.xl}`,
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1.5rem'
  },
  logo: {
    maxWidth: '200px',
    maxHeight: '150px',
    objectFit: 'contain',
    marginBottom: '1rem'
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
    fontSize: '1.125rem',
    color: TavariStyles.colors.gray600,
    marginBottom: '1rem'
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
    transition: 'background-color 0.2s',
    marginTop: '1rem',
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box'
  },
  buttonIcon: {
    fontSize: '1.25rem'
  }
};

export default WelcomeStep;

