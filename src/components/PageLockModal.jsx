// components/PageLockModal.jsx - WORKING VERSION - DIRECT DATABASE CHECK
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import bcrypt from 'bcryptjs';
import { TavariStyles } from '../utils/TavariStyles';
import { SecurityWrapper } from '../Security';
import { useSecurityContext } from '../Security';

const PageLockModal = ({
  isOpen,
  onUnlock,
  onCancel = null,
  title = "Restricted Access",
  subtitle = "Enter your 4-digit manager PIN and press Enter",
  maxAttempts = 3,
  redirectPath = '/dashboard/home',
  pageName = 'Restricted Page'
}) => {
  const navigate = useNavigate();
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinAttempts, setPinAttempts] = useState(0);
  const inputRef = useRef(null);

  // Security context - optional logging
  const {
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'PageLockModal',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Focus input when modal opens and clear PIN for security
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setPinInput('');
      setPinError('');
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Clear PIN when modal closes for security
  useEffect(() => {
    if (!isOpen) {
      setPinInput('');
      setPinError('');
      setPinAttempts(0);
    }
  }, [isOpen]);

  // Handle PIN input change
  const handlePinChange = (e) => {
    const value = e.target.value.replace(/\D/g, ''); // Only allow digits
    if (value.length <= 4) {
      setPinInput(value);
      setPinError(''); // Clear error when user starts typing
    }
  };

  // Handle key press
  const handleKeyPress = async (e) => {
    if (e.key === 'Enter' && pinInput.length === 4) {
      await handlePinSubmit();
    }
  };

  // Handle PIN submission - DIRECT DATABASE CHECK
  const handlePinSubmit = async () => {
    if (pinInput.length !== 4) {
      setPinError('PIN must be exactly 4 digits');
      return;
    }

    try {
      // Get current business ID from localStorage
      const businessId = localStorage.getItem('currentBusinessId');
      
      if (!businessId) {
        setPinError('No business selected. Please refresh the page.');
        return;
      }

      // Get all managers/owners/admins for this business from user_roles
      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role')
        .eq('business_id', businessId)
        .eq('active', true)
        .in('role', ['manager', 'owner', 'admin']);

      if (rolesError) {
        setPinError('Error validating PIN. Please try again.');
        return;
      }

      if (!userRoles || userRoles.length === 0) {
        setPinError('No managers found for this business.');
        return;
      }

      const managerUserIds = userRoles.map(ur => ur.user_id);

      // Get PINs for all managers
      const { data: managers, error: managersError } = await supabase
        .from('users')
        .select('id, full_name, email, pin')
        .in('id', managerUserIds);

      if (managersError) {
        setPinError('Error validating PIN. Please try again.');
        return;
      }

      // Check PIN against all managers
      let pinMatched = false;
      let matchedManager = null;

      for (const manager of managers) {
        if (!manager.pin) {
          continue;
        }

        // Check if PIN is hashed (bcrypt) or plain text
        if (manager.pin.startsWith('$2b$') || manager.pin.startsWith('$2a$')) {
          // Bcrypt hashed PIN
          const matches = await bcrypt.compare(pinInput, manager.pin);
          if (matches) {
            pinMatched = true;
            matchedManager = manager;
            break;
          }
        } else {
          // Plain text PIN
          const matches = String(manager.pin) === String(pinInput);
          if (matches) {
            pinMatched = true;
            matchedManager = manager;
            break;
          }
        }
      }

      if (pinMatched && matchedManager) {
        
        // Log success
        try {
          await logSecurityEvent('page_access_granted', {
            page: pageName,
            user_id: matchedManager.id,
            business_id: businessId,
            manager_email: matchedManager.email
          }, 'high');
        } catch (logError) {
          console.warn('Failed to log security event:', logError);
        }

        setPinError('');
        setPinAttempts(0);
        setPinInput('');
        onUnlock();
      } else {
        console.log('❌ PageLockModal: PIN did not match any manager');
        
        const newAttempts = pinAttempts + 1;
        setPinAttempts(newAttempts);
        setPinInput('');
        
        // Refocus input after error
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
          }
        }, 100);
        
        // After max attempts, redirect
        if (newAttempts >= maxAttempts) {
          console.log('⚠️ PageLockModal: Max attempts reached, redirecting...');
          
          try {
            await logSecurityEvent('page_access_denied_max_attempts', {
              page: pageName,
              business_id: businessId,
              total_attempts: newAttempts
            }, 'high');
          } catch (logError) {
            console.warn('Failed to log security event:', logError);
          }

          alert('Too many failed attempts. Redirecting to dashboard.');
          navigate(redirectPath);
          return;
        }
        
        setPinError(`Invalid PIN. Attempt ${newAttempts} of ${maxAttempts}.`);
      }
    } catch (error) {
      console.error('❌ PageLockModal: PIN validation exception:', error);
      setPinError('Error validating PIN. Please try again.');
    }
  };

  const handleCancel = () => {
    console.log('PageLockModal: User cancelled');
    
    // Clear PIN for security
    setPinInput('');
    setPinError('');
    setPinAttempts(0);
    
    // Use custom cancel handler if provided, otherwise navigate to redirectPath
    if (onCancel) {
      onCancel();
    } else {
      navigate(redirectPath);
    }
  };

  // Don't render if not open
  if (!isOpen) return null;

  const styles = {
    modal: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000
    },
    content: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing['3xl'],
      maxWidth: '400px',
      width: '90%',
      textAlign: 'center',
      boxShadow: '0 20px 40px rgba(0,0,0,0.3)'
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.lg
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.md,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing['3xl']
    },
    pinInput: {
      width: '200px',
      padding: TavariStyles.spacing.lg,
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      textAlign: 'center',
      border: `2px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      marginBottom: TavariStyles.spacing.lg,
      letterSpacing: '8px',
      fontFamily: 'monospace'
    },
    pinInputFocus: {
      borderColor: TavariStyles.colors.primary,
      outline: 'none',
      boxShadow: `0 0 0 3px ${TavariStyles.colors.primary}20`
    },
    submitButton: {
      ...TavariStyles.components.button?.base,
      ...TavariStyles.components.button?.variants?.primary,
      width: '100%',
      marginBottom: TavariStyles.spacing.md,
      fontSize: TavariStyles.typography.fontSize.md,
      padding: TavariStyles.spacing.lg
    },
    cancelButton: {
      ...TavariStyles.components.button?.base,
      ...TavariStyles.components.button?.variants?.secondary,
      width: '100%',
      fontSize: TavariStyles.typography.fontSize.md,
      padding: TavariStyles.spacing.lg
    },
    error: {
      color: TavariStyles.colors.danger,
      fontSize: TavariStyles.typography.fontSize.sm,
      marginBottom: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.errorBg,
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      border: `1px solid ${TavariStyles.colors.danger}40`
    },
    instruction: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray500,
      marginBottom: TavariStyles.spacing.lg,
      fontStyle: 'italic'
    }
  };

  return (
    <div style={styles.modal}>
      <div style={styles.content}>
        <h2 style={styles.title}>{title}</h2>
        <p style={styles.subtitle}>{subtitle}</p>
        
        <p style={styles.instruction}>
          Type your 4-digit PIN and press Enter
        </p>
        
        {/* PIN Input Field */}
        <input
          ref={inputRef}
          type="password"
          value={pinInput}
          onChange={handlePinChange}
          onKeyPress={handleKeyPress}
          placeholder="••••"
          maxLength="4"
          style={{
            ...styles.pinInput,
            ...(document.activeElement === inputRef.current ? styles.pinInputFocus : {})
          }}
          autoComplete="off"
          autoFocus
        />
        
        {/* Error Message */}
        {pinError && (
          <div style={styles.error}>
            {pinError}
            <br />
            <small>Attempts: {pinAttempts}/{maxAttempts}</small>
          </div>
        )}
        
        {/* Submit Button */}
        <button 
          onClick={handlePinSubmit}
          disabled={pinInput.length !== 4}
          style={{
            ...styles.submitButton,
            opacity: pinInput.length !== 4 ? 0.5 : 1,
            cursor: pinInput.length !== 4 ? 'not-allowed' : 'pointer'
          }}
        >
          Unlock (Enter)
        </button>
        
        {/* Cancel Button - ALWAYS WORKS */}
        <button style={styles.cancelButton} onClick={handleCancel}>
          Cancel (Go to Dashboard)
        </button>
      </div>
    </div>
  );
};

export default PageLockModal;