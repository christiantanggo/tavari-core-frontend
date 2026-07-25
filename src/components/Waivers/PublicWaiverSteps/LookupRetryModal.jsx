import React from 'react';
import { FiAlertCircle, FiRefreshCw } from 'react-icons/fi';
import { TavariStyles } from '../../../utils/TavariStyles';

const LookupRetryModal = ({
  title = 'Could Not Check Existing Waivers',
  message = 'We could not check for an existing waiver right now. Please try again.',
  onRetry,
  retryLabel = 'Retry'
}) => {
  return (
    <div style={styles.overlay}>
      <div style={styles.modal} className="public-waiver-card" onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <FiAlertCircle size={32} style={styles.icon} />
          <h2 style={styles.title}>{title}</h2>
        </div>
        <p style={styles.message}>{message}</p>
        <div style={styles.buttonContainer} className="public-waiver-actions">
          <button onClick={onRetry} style={styles.retryButton}>
            <FiRefreshCw size={18} />
            {retryLabel}
          </button>
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
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10001,
    padding: '2rem'
  },
  modal: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: '2rem',
    maxWidth: '440px',
    width: '100%',
    boxSizing: 'border-box',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    boxShadow: TavariStyles.shadows.xl
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    marginBottom: '1rem'
  },
  icon: {
    color: '#EF4444'
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: TavariStyles.colors.text,
    margin: 0
  },
  message: {
    fontSize: '1rem',
    color: TavariStyles.colors.gray600,
    marginBottom: '2rem',
    lineHeight: '1.5'
  },
  buttonContainer: {
    display: 'flex',
    justifyContent: 'flex-end'
  },
  retryButton: {
    padding: '0.75rem 1.5rem',
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
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box'
  }
};

export default LookupRetryModal;
