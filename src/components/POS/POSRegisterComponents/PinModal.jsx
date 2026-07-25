// components/POS/POSRegisterComponents/PinModal.jsx
import React, { useRef, useEffect } from 'react';
import { TavariStyles } from '../../../utils/TavariStyles';

const PinModal = ({
  showPinModal,
  pinInput,
  setPinInput,
  pinError,
  setPinError,
  failedAttempts,
  currentUnlockingUser,
  onPinUnlock,
  onCancel = null,
  title = 'Register Locked',
  subtitle = "Enter any staff member's 4-digit PIN to unlock the register.",
  helperText = 'Any employee with a PIN can unlock and complete sales.',
  buttonLabel = 'Unlock Register',
  lockedButtonLabel = 'Locked - Contact Manager',
  cancelButtonLabel = 'Cancel',
  showUserInfo = true,
  userInfoLabel = 'Last unlocked by:'
}) => {
  const pinInputRef = useRef(null);
  const modalRef = useRef(null);

  // Keep focus on PIN input when modal is shown and trap focus
  useEffect(() => {
    if (showPinModal && pinInputRef.current) {
      // Focus immediately
      pinInputRef.current.focus();
      
      // Also set focus after a short delay to ensure it takes
      const focusTimeout = setTimeout(() => {
        if (pinInputRef.current && showPinModal) {
          pinInputRef.current.focus();
        }
      }, 50);

      // Trap focus within modal - prevent tabbing to other elements
      const handleTabKey = (e) => {
        if (e.key === 'Tab' && showPinModal) {
          e.preventDefault();
          if (pinInputRef.current) {
            pinInputRef.current.focus();
          }
        }
      };

      // Intercept number keys globally when modal is open
      const handleKeyDown = (e) => {
        if (!showPinModal) return;
        
        // If a number key is pressed and focus is not on the PIN input, redirect it
        if (/^[0-9]$/.test(e.key) && document.activeElement !== pinInputRef.current) {
          e.preventDefault();
          e.stopPropagation();
          if (pinInputRef.current) {
            pinInputRef.current.focus();
            // Manually add the digit to the input
            const value = (pinInput + e.key).slice(0, 4).replace(/\D/g, '');
            setPinInput(value);
            setPinError('');
          }
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('keydown', handleTabKey);

      return () => {
        clearTimeout(focusTimeout);
        document.removeEventListener('keydown', handleKeyDown);
        document.removeEventListener('keydown', handleTabKey);
      };
    }
  }, [showPinModal, pinInput, setPinInput, setPinError]);

  if (!showPinModal) return null;

  const styles = {
    modal: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000
    },
    
    modalContent: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius.lg,
      maxWidth: '400px',
      width: '90%',
      boxShadow: TavariStyles.shadows.xl
    },
    
    modalHeader: {
      padding: TavariStyles.spacing.lg,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      textAlign: 'center'
    },
    
    modalBody: {
      padding: TavariStyles.spacing.lg
    },
    
    modalFooter: {
      padding: TavariStyles.spacing.lg,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      display: 'flex',
      gap: TavariStyles.spacing.sm,
    },
    
    pinInput: {
      ...TavariStyles.components.form.input,
      width: '120px',
      margin: '0 auto',
      display: 'block',
      fontSize: '24px',
      textAlign: 'center',
      letterSpacing: '8px',
      fontFamily: 'monospace'
    },
    
    errorText: {
      color: TavariStyles.colors.danger,
      textAlign: 'center',
      marginTop: '10px',
      fontSize: '14px'
    },
    
    attemptsText: {
      textAlign: 'center',
      marginTop: '10px',
      fontSize: '12px',
      color: TavariStyles.colors.gray600
    },

    cancelButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      flex: 1,
    },
    
    unlockButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      flex: 1,
    },
    
    userInfo: {
      padding: '10px',
      backgroundColor: TavariStyles.colors.gray50,
      borderTop: `1px solid ${TavariStyles.colors.gray200}`,
      fontSize: '12px',
      textAlign: 'center',
      color: TavariStyles.colors.gray600
    }
  };

  return (
    <div 
      ref={modalRef}
      style={styles.modal}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (pinInputRef.current) {
          pinInputRef.current.focus();
        }
      }}
      onKeyDown={(e) => {
        // Trap all keyboard events within modal
        if (e.key === 'Tab') {
          e.preventDefault();
          if (pinInputRef.current) {
            pinInputRef.current.focus();
          }
        }
      }}
    >
      <div 
        style={styles.modalContent}
        onClick={(e) => {
          e.stopPropagation();
          if (pinInputRef.current) {
            pinInputRef.current.focus();
          }
        }}
      >
        <div style={styles.modalHeader}>
          <h3>{title}</h3>
        </div>
        
        <div style={styles.modalBody}>
          <p style={{ marginBottom: '20px', textAlign: 'center' }}>
            {subtitle}
            {helperText ? (
              <span style={{ fontSize: '10px', color: '#666', marginTop: '8px', display: 'block' }}>
                {helperText}
              </span>
            ) : null}
          </p>
          
          <input
            ref={pinInputRef}
            type="password"
            maxLength={4}
            value={pinInput}
            onChange={(e) => {
              const value = e.target.value.replace(/\D/g, '');
              setPinInput(value);
              setPinError('');
            }}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && pinInput.length === 4) {
                onPinUnlock();
              }
            }}
            onBlur={(e) => {
              // Aggressively prevent blur - refocus immediately
              if (showPinModal) {
                e.preventDefault();
                // Use requestAnimationFrame for immediate refocus
                requestAnimationFrame(() => {
                  if (showPinModal && pinInputRef.current) {
                    pinInputRef.current.focus();
                  }
                });
              }
            }}
            onFocus={(e) => {
              // Ensure input stays focused
              e.target.select();
            }}
            placeholder="••••"
            style={styles.pinInput}
            autoFocus
            disabled={failedAttempts >= 3}
            autoComplete="off"
            inputMode="numeric"
            pattern="[0-9]*"
          />
          
          {pinError && (
            <p style={styles.errorText}>
              {pinError}
            </p>
          )}
          
          <div style={styles.attemptsText}>
            Attempts: {failedAttempts}/3
          </div>
        </div>
        
        <div style={styles.modalFooter}>
          {typeof onCancel === 'function' ? (
            <button
              type="button"
              onClick={onCancel}
              style={styles.cancelButton}
            >
              {cancelButtonLabel}
            </button>
          ) : null}
          <button
            onClick={onPinUnlock}
            disabled={failedAttempts >= 3 || pinInput.length !== 4}
            style={{
              ...styles.unlockButton,
              opacity: (failedAttempts >= 3 || pinInput.length !== 4) ? 0.5 : 1,
              cursor: (failedAttempts >= 3 || pinInput.length !== 4) ? 'not-allowed' : 'pointer'
            }}
          >
            {failedAttempts >= 3 ? lockedButtonLabel : buttonLabel}
          </button>
        </div>
        
        {showUserInfo && currentUnlockingUser && (
          <div style={styles.userInfo}>
            {userInfoLabel} {currentUnlockingUser.name || currentUnlockingUser.full_name || currentUnlockingUser.email}
          </div>
        )}
      </div>
    </div>
  );
};

export default PinModal;