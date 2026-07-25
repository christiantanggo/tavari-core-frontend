import React, { useState } from 'react';
import { useUser } from '../contexts/UserContext';
import { usePOSAuth } from '../hooks/usePOSAuth';
import TavariStyles from '../utils/TavariStyles';

const ManagerLockModal = ({ isOpen, onClose }) => {
  const { userProfile, lockApp, unlockApp } = useUser();
  const { validateManagerPin, isManager, isOwner } = usePOSAuth();
  const [lockReason, setLockReason] = useState('');
  const [isLocking, setIsLocking] = useState(false);

  const handleLockApp = async () => {
    if (!isManager(userProfile) && !isOwner(userProfile)) {
      alert('Only managers and owners can lock the application');
      return;
    }

    setIsLocking(true);
    try {
      const reason = lockReason.trim() || 'Manager has locked the application';
      lockApp(reason);
      onClose();
    } catch (error) {
      console.error('Error locking app:', error);
      alert('Failed to lock application');
    } finally {
      setIsLocking(false);
    }
  };

  const handleUnlockApp = async () => {
    console.log('🔓 ManagerLockModal: Unlock attempt by user:', userProfile);
    console.log('🔓 ManagerLockModal: isManager:', isManager(userProfile));
    console.log('🔓 ManagerLockModal: isOwner:', isOwner(userProfile));
    
    if (!isManager(userProfile) && !isOwner(userProfile)) {
      alert('Only managers and owners can unlock the application');
      return;
    }

    const pin = prompt('Enter your manager PIN to unlock:');
    if (!pin) return;

    console.log('🔓 ManagerLockModal: Validating PIN...');
    try {
      const isValid = await validateManagerPin(pin);
      console.log('🔓 ManagerLockModal: PIN validation result:', isValid);
      if (isValid) {
        unlockApp();
        onClose();
      } else {
        alert('Invalid PIN');
      }
    } catch (error) {
      console.error('Error unlocking app:', error);
      alert('Failed to unlock application');
    }
  };

  if (!isOpen) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h3>Manager Lock Control</h3>
          <button style={styles.closeButton} onClick={onClose}>×</button>
        </div>
        
        <div style={styles.content}>
          <p style={styles.description}>
            Lock the application to prevent staff access. Staff will only be able to unlock pages they have permission to access.
          </p>
          
          <div style={styles.section}>
            <label style={styles.label}>Lock Reason (Optional):</label>
            <textarea
              style={styles.textarea}
              value={lockReason}
              onChange={(e) => setLockReason(e.target.value)}
              placeholder="e.g., End of shift, System maintenance, etc."
              rows={3}
            />
          </div>
          
          <div style={styles.buttons}>
            <button
              style={{...styles.button, ...styles.lockButton}}
              onClick={handleLockApp}
              disabled={isLocking}
            >
              🔒 Lock Application
            </button>
            
            <button
              style={{...styles.button, ...styles.unlockButton}}
              onClick={handleUnlockApp}
            >
              🔓 Unlock Application
            </button>
          </div>
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
    zIndex: 1000,
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '24px',
    maxWidth: '500px',
    width: '90%',
    maxHeight: '80vh',
    overflow: 'auto',
    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
    paddingBottom: '16px',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    cursor: 'pointer',
    color: TavariStyles.colors.gray500,
    padding: '0',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  description: {
    color: TavariStyles.colors.gray600,
    fontSize: TavariStyles.typography.fontSize.sm,
    lineHeight: 1.5,
    margin: 0,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    fontWeight: TavariStyles.typography.fontWeight.medium,
    color: TavariStyles.colors.gray700,
    fontSize: TavariStyles.typography.fontSize.sm,
  },
  textarea: {
    width: '100%',
    padding: '12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: '6px',
    fontSize: TavariStyles.typography.fontSize.sm,
    fontFamily: 'inherit',
    resize: 'vertical',
    minHeight: '80px',
  },
  buttons: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
  },
  button: {
    padding: '12px 24px',
    borderRadius: '6px',
    border: 'none',
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.medium,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  lockButton: {
    backgroundColor: TavariStyles.colors.danger,
    color: 'white',
  },
  unlockButton: {
    backgroundColor: TavariStyles.colors.success,
    color: 'white',
  },
};

export default ManagerLockModal;
