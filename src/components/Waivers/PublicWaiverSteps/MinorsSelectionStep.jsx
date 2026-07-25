// Minors Selection Step for Public Waiver Flow
import React, { useState } from 'react';
import { FiUsers, FiArrowRight } from 'react-icons/fi';
import { TavariStyles } from '../../../utils/TavariStyles';
import { useInactivityTimer } from '../../../hooks/useInactivityTimer';
import {
  WAIVER_POST_OTP_TIMEOUT_SECONDS,
  WAIVER_TIMEOUT_WARNING_SECONDS
} from '../../../constants/waiverInactivity';
import CancelConfirmationModal from './CancelConfirmationModal';
import TimeoutWarningModal from './TimeoutWarningModal';

const MinorsSelectionStep = ({ onSelect, onCancel }) => {
  const [selectedCount, setSelectedCount] = useState(0);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const { timeRemaining, resetTimer, showWarning, setShowWarning } = useInactivityTimer(
    () => {
      if (onCancel) onCancel({ reason: 'idle_ad' });
    },
    WAIVER_POST_OTP_TIMEOUT_SECONDS,
    null,
    { warningSeconds: WAIVER_TIMEOUT_WARNING_SECONDS }
  );

  const handleExtendSession = () => {
    resetTimer();
    setShowWarning(false);
  };

  const handleCloseSession = () => {
    if (onCancel) onCancel({ reason: 'idle_ad' });
  };

  const handleContinue = () => {
    onSelect(selectedCount);
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
          <FiUsers size={48} style={styles.icon} />
          <h1 style={styles.title} className="public-waiver-title">Number of Minors</h1>
          <p style={styles.subtitle}>
            How many minors (under 18) will be included in this waiver?
          </p>
        </div>

        <div style={styles.body}>
        <label style={styles.label}>Select Number of Minors</label>
        <select
          value={selectedCount}
          onChange={(e) => setSelectedCount(parseInt(e.target.value))}
          style={styles.select}
        >
          {[...Array(20)].map((_, i) => (
            <option key={i} value={i}>
              {i === 0 ? 'No Minors' : `${i} ${i === 1 ? 'Minor' : 'Minors'}`}
            </option>
          ))}
        </select>

        <div style={styles.infoBox}>
          <p style={styles.infoText}>
            <strong>Note:</strong> Each waiver covers 1 adult (18+) and minor(s) only. 
            Additional adults (18+) will need to sign separately.
          </p>
        </div>

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
            onClick={handleContinue}
            style={styles.button}
          >
            Continue
            <FiArrowRight style={styles.buttonIcon} />
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
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem'
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
  label: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: TavariStyles.colors.text
  },
  select: {
    padding: '1rem',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    width: '100%',
    cursor: 'pointer'
  },
  infoBox: {
    padding: '1rem',
    backgroundColor: '#FEF3C7',
    borderRadius: TavariStyles.borderRadius.md,
    border: '1px solid #FCD34D'
  },
  infoText: {
    fontSize: '0.875rem',
    color: TavariStyles.colors.text,
    margin: 0,
    lineHeight: '1.5'
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
    maxWidth: '100%'
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

export default MinorsSelectionStep;



