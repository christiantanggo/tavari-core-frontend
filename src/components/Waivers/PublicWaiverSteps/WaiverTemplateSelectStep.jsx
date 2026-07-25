import React from 'react';
import { FiArrowRight, FiFileText } from 'react-icons/fi';
import { TavariStyles } from '../../../utils/TavariStyles';
import { useInactivityTimer } from '../../../hooks/useInactivityTimer';
import {
  WAIVER_PRE_OTP_TIMEOUT_SECONDS,
  WAIVER_TIMEOUT_WARNING_SECONDS
} from '../../../constants/waiverInactivity';
import TimeoutWarningModal from './TimeoutWarningModal';

const WaiverTemplateSelectStep = ({
  business,
  options = [],
  onSelect,
  onCancel,
  suspendInactivityTimer = false
}) => {
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

  return (
    <div style={styles.container}>
      {showWarning && (
        <TimeoutWarningModal
          onClose={handleCloseSession}
          onExtend={handleExtendSession}
          timeRemaining={timeRemaining}
        />
      )}
      <div style={styles.card}>
        <div style={styles.header}>
          <FiFileText size={44} style={styles.icon} />
          <h1 style={styles.title}>Choose Your Activity</h1>
          <p style={styles.subtitle}>
            Select the activity you are participating in so we can show you the correct waiver
            {business?.name ? ` for ${business.name}` : ''}.
          </p>
        </div>

        <div style={styles.optionList}>
          {options.map((option) => (
            <button
              key={option.templateKey}
              type="button"
              onClick={() => onSelect?.(option)}
              style={styles.optionButton}
            >
              <div style={styles.optionContent}>
                <div style={styles.optionTitle}>{option.displayName}</div>
              </div>
              <FiArrowRight style={styles.optionIcon} />
            </button>
          ))}
        </div>

        {onCancel ? (
          <div style={styles.footer}>
            <button type="button" onClick={onCancel} style={styles.cancelButton}>
              Cancel
            </button>
          </div>
        ) : null}
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
  card: {
    width: '100%',
    maxWidth: '760px',
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
  icon: {
    color: TavariStyles.colors.primary,
    marginBottom: '0.75rem'
  },
  title: {
    fontSize: '2rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    margin: '0 0 0.5rem 0'
  },
  subtitle: {
    fontSize: '1rem',
    color: TavariStyles.colors.gray600,
    margin: 0,
    lineHeight: 1.5
  },
  optionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  optionButton: {
    width: '100%',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1rem',
    padding: '1.25rem 3.5rem 1.25rem 1.5rem',
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    backgroundColor: TavariStyles.colors.white,
    cursor: 'pointer',
    textAlign: 'left'
  },
  optionContent: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center'
  },
  optionTitle: {
    fontSize: '1.1rem',
    fontWeight: '700',
    color: TavariStyles.colors.text,
    marginBottom: 0
  },
  optionIcon: {
    position: 'absolute',
    right: '1.25rem',
    flexShrink: 0,
    fontSize: '1.25rem',
    color: TavariStyles.colors.primary
  },
  footer: {
    display: 'flex',
    justifyContent: 'center',
    marginTop: '1.5rem'
  },
  cancelButton: {
    padding: '0.9rem 1.5rem',
    backgroundColor: TavariStyles.colors.white,
    color: TavariStyles.colors.text,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer'
  }
};

export default WaiverTemplateSelectStep;
