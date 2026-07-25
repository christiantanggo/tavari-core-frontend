// Timeout Warning Modal - Shows 10 seconds before timeout
import React from 'react';
import { FiAlertCircle, FiX, FiClock } from 'react-icons/fi';
import { TavariStyles } from '../../../utils/TavariStyles';
import { WAIVER_TIMEOUT_WARNING_SECONDS } from '../../../constants/waiverInactivity';

const TimeoutWarningModal = ({
  onClose,
  onExtend,
  timeRemaining,
  /** When false (e.g. after OTP on waiver on-file), stranger cannot keep PII on screen by “extending”. */
  allowExtend = true
}) => {
  const clampedTimeRemaining = Math.max(0, Number(timeRemaining) || 0);
  const progressPercent = Math.max(
    0,
    Math.min(100, (clampedTimeRemaining / WAIVER_TIMEOUT_WARNING_SECONDS) * 100)
  );

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <FiAlertCircle size={48} style={styles.icon} />
          <h2 style={styles.title}>Session About to Expire</h2>
          <p style={styles.message}>
            {allowExtend
              ? `Your session will return to the start in ${clampedTimeRemaining} seconds due to inactivity.`
              : `For privacy, this screen will return to the start in ${clampedTimeRemaining} seconds if no one is using it. Another person cannot extend your session.`}
          </p>
        </div>

        <div style={styles.progressSection}>
          <div style={styles.progressTrack}>
            <div
              style={{
                ...styles.progressFill,
                width: `${progressPercent}%`
              }}
            />
          </div>
          <div style={styles.progressLabel}>
            {clampedTimeRemaining} second{clampedTimeRemaining === 1 ? '' : 's'} remaining
          </div>
        </div>

        <div
          style={{
            ...styles.buttonContainer,
            ...(allowExtend ? {} : { justifyContent: 'center' })
          }}
        >
          <button
            onClick={onClose}
            style={allowExtend ? styles.closeButton : styles.singleEndButton}
            type="button"
          >
            <FiX style={styles.buttonIcon} />
            {allowExtend ? 'End Session' : 'Return to start now'}
          </button>
          {allowExtend && (
            <button onClick={onExtend} style={styles.extendButton} type="button">
              <FiClock style={styles.buttonIcon} />
              Extend Session
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000
  },
  modal: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: '2rem',
    maxWidth: '500px',
    width: '90%',
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    boxShadow: TavariStyles.shadows.xl,
    textAlign: 'center'
  },
  header: {
    marginBottom: '2rem'
  },
  icon: {
    color: '#F59E0B',
    marginBottom: '1rem'
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    marginBottom: '1rem'
  },
  message: {
    fontSize: '1rem',
    color: TavariStyles.colors.gray600,
    lineHeight: '1.6'
  },
  progressSection: {
    marginBottom: '1.5rem'
  },
  progressTrack: {
    width: '100%',
    height: '12px',
    borderRadius: '999px',
    backgroundColor: TavariStyles.colors.gray200,
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    borderRadius: '999px',
    backgroundColor: '#F59E0B',
    transition: 'width 0.9s linear'
  },
  progressLabel: {
    marginTop: '0.75rem',
    fontSize: '0.9rem',
    fontWeight: '600',
    color: TavariStyles.colors.gray700
  },
  buttonContainer: {
    display: 'flex',
    gap: '1rem',
    justifyContent: 'center'
  },
  closeButton: {
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
    minWidth: '120px'
  },
  extendButton: {
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
    minWidth: '120px'
  },
  singleEndButton: {
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
    minWidth: '200px'
  },
  buttonIcon: {
    fontSize: '1.25rem'
  }
};

export default TimeoutWarningModal;


