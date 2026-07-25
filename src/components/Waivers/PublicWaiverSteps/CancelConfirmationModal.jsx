// Cancel Confirmation Modal - Shows confirmation before canceling
import React from 'react';
import { FiAlertCircle, FiX } from 'react-icons/fi';
import { TavariStyles } from '../../../utils/TavariStyles';

const CancelConfirmationModal = ({ onConfirm, onCancel }) => {
  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.modal} className="public-waiver-card" onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <FiAlertCircle size={32} style={styles.icon} />
          <h2 style={styles.title}>Cancel Waiver?</h2>
        </div>
        <p style={styles.message}>
          Are you sure you want to cancel? All entered information will be lost and you will be returned to the welcome screen.
        </p>
        <div style={styles.buttonContainer} className="public-waiver-actions">
          <button
            onClick={onCancel}
            style={styles.cancelButton}
          >
            No, Continue
          </button>
          <button
            onClick={onConfirm}
            style={styles.confirmButton}
          >
            Yes, Cancel
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
    zIndex: 10000,
    padding: '2rem'
  },
  modal: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.lg,
    padding: '2rem',
    maxWidth: '400px',
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
    flexWrap: 'wrap',
    gap: '1rem',
    justifyContent: 'stretch',
    width: '100%',
    maxWidth: '100%'
  },
  cancelButton: {
    padding: '0.75rem 1.5rem',
    backgroundColor: TavariStyles.colors.gray300,
    color: TavariStyles.colors.text,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer'
  },
  confirmButton: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#EF4444',
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer'
  }
};

export default CancelConfirmationModal;



