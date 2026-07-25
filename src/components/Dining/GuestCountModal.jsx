// C:\TAVARI-FULL-PROJECT\tavari-core-frontend\src\components\Dining\GuestCountModal.jsx
import React, { useState } from 'react';
import { TavariStyles } from '../../utils/TavariStyles';
import { FiUsers, FiX } from 'react-icons/fi';

const GuestCountModal = ({ table, onConfirm, onCancel }) => {
  const [guestCount, setGuestCount] = useState(table.capacity || 4);

  const handleQuickSelect = (count) => {
    setGuestCount(count);
  };

  const handleConfirm = () => {
    if (guestCount < 1) {
      alert('Guest count must be at least 1');
      return;
    }
    onConfirm(guestCount);
  };

  const showCapacityWarning = guestCount > table.capacity;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>Table {table.table_number}</h2>
            {table.table_name && (
              <p style={styles.subtitle}>{table.table_name}</p>
            )}
          </div>
          <button style={styles.closeButton} onClick={onCancel}>
            <FiX size={24} />
          </button>
        </div>

        <div style={styles.content}>
          <div style={styles.questionSection}>
            <FiUsers size={32} color={TavariStyles.colors.primary} />
            <h3 style={styles.question}>How many guests?</h3>
            <p style={styles.capacityInfo}>
              Table capacity: {table.capacity} seats
            </p>
          </div>

          {/* Quick Select Numbers */}
          <div style={styles.quickSelectGrid}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
              <button
                key={num}
                style={{
                  ...styles.quickSelectButton,
                  ...(guestCount === num ? styles.quickSelectButtonActive : {})
                }}
                onClick={() => handleQuickSelect(num)}
              >
                {num}
              </button>
            ))}
          </div>

          {/* Custom Input */}
          <div style={styles.customInputSection}>
            <label style={styles.customLabel}>Or enter custom amount:</label>
            <input
              type="number"
              min="1"
              max="99"
              value={guestCount}
              onChange={(e) => setGuestCount(parseInt(e.target.value) || 1)}
              style={styles.customInput}
            />
          </div>

          {/* Capacity Warning */}
          {showCapacityWarning && (
            <div style={styles.warningBox}>
              <strong>Note:</strong> Party of {guestCount} exceeds table capacity of {table.capacity}. 
              Additional seating may be needed.
            </div>
          )}

          {/* Current Selection Display */}
          <div style={styles.selectionDisplay}>
            <FiUsers size={20} />
            <span style={styles.selectionText}>
              Seating {guestCount} {guestCount === 1 ? 'guest' : 'guests'}
            </span>
          </div>
        </div>

        <div style={styles.actions}>
          <button style={styles.cancelButton} onClick={onCancel}>
            Cancel
          </button>
          <button style={styles.confirmButton} onClick={handleConfirm}>
            Continue
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
    zIndex: 2000
  },
  modal: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    width: '90%',
    maxWidth: '500px',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '24px',
    borderBottom: '1px solid #e0e0e0'
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    margin: 0,
    color: '#333'
  },
  subtitle: {
    fontSize: '14px',
    color: '#666',
    margin: '4px 0 0 0'
  },
  closeButton: {
    padding: '8px',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: '#666',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  content: {
    padding: '24px'
  },
  questionSection: {
    textAlign: 'center',
    marginBottom: '32px'
  },
  question: {
    fontSize: '20px',
    fontWeight: '600',
    margin: '16px 0 8px 0',
    color: '#333'
  },
  capacityInfo: {
    fontSize: '14px',
    color: '#666',
    margin: 0
  },
  quickSelectGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: '12px',
    marginBottom: '24px'
  },
  quickSelectButton: {
    padding: '16px',
    backgroundColor: '#f5f5f5',
    border: '2px solid #e0e0e0',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '18px',
    fontWeight: '600',
    color: '#333',
    transition: 'all 0.2s ease'
  },
  quickSelectButtonActive: {
    backgroundColor: '#008080',
    border: '2px solid #008080',
    color: '#fff'
  },
  customInputSection: {
    marginBottom: '24px'
  },
  customLabel: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '500',
    marginBottom: '8px',
    color: '#333'
  },
  customInput: {
    width: '100%',
    padding: '12px',
    border: '2px solid #e0e0e0',
    borderRadius: '8px',
    fontSize: '16px',
    textAlign: 'center'
  },
  warningBox: {
    padding: '12px 16px',
    backgroundColor: '#fff3cd',
    border: '1px solid #ffc107',
    borderRadius: '6px',
    fontSize: '14px',
    color: '#856404',
    marginBottom: '16px'
  },
  selectionDisplay: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '16px',
    backgroundColor: '#f0f8f8',
    borderRadius: '8px',
    border: '2px solid #008080'
  },
  selectionText: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#008080'
  },
  actions: {
    display: 'flex',
    gap: '12px',
    padding: '24px',
    borderTop: '1px solid #e0e0e0'
  },
  cancelButton: {
    flex: 1,
    padding: '14px',
    backgroundColor: '#f5f5f5',
    border: '1px solid #ddd',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: '600',
    color: '#333'
  },
  confirmButton: {
    flex: 1,
    padding: '14px',
    backgroundColor: '#008080',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: '600',
    color: '#fff'
  }
};

export default GuestCountModal;