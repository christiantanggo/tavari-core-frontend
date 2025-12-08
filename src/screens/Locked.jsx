// src/screens/Locked.jsx - WITH SECURITY TRACKING
import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { SecurityWrapper, useSecurityContext } from '../Security';
import { TavariStyles } from '../utils/TavariStyles';

const Locked = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Security context for tracking locked account access attempts
  const {
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'Locked',
    sensitiveComponent: true,
    enableRateLimiting: false,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Track locked page view on mount
  useEffect(() => {
    const trackLockedAccess = async () => {
      // Extract reason from location state if available
      const reason = location.state?.reason || 'unknown';
      const userId = location.state?.userId || null;
      const email = location.state?.email || null;

      await recordAction('locked_page_view', userId, true);
      
      await logSecurityEvent('account_locked_page_accessed', {
        reason,
        user_id: userId,
        email,
        timestamp: new Date().toISOString(),
        user_agent: navigator.userAgent,
        previous_path: location.state?.from || 'unknown'
      }, 'high');
    };

    trackLockedAccess();
  }, [location.state]);

  const handleReturnToLogin = async () => {
    await recordAction('locked_page_return_to_login', null, false);
    
    await logSecurityEvent('locked_user_return_to_login', {
      user_id: location.state?.userId || null,
      email: location.state?.email || null,
      timestamp: new Date().toISOString()
    }, 'medium');
    
    navigate('/login');
  };

  const styles = {
    container: {
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.xl
    },
    card: {
      backgroundColor: '#fff3f3',
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      boxShadow: TavariStyles.shadows?.lg || '0 10px 25px rgba(0,0,0,0.1)',
      padding: TavariStyles.spacing['3xl'],
      maxWidth: '550px',
      width: '100%',
      border: '2px solid #ebccd1',
      textAlign: 'center'
    },
    icon: {
      fontSize: '64px',
      marginBottom: TavariStyles.spacing.lg
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: '#a94442',
      marginBottom: TavariStyles.spacing.md,
      margin: '0 0 16px 0'
    },
    message: {
      fontSize: TavariStyles.typography.fontSize.md,
      color: '#843534',
      lineHeight: 1.6,
      marginBottom: TavariStyles.spacing.md
    },
    reasonBox: {
      backgroundColor: '#fef5e7',
      border: '1px solid #f39c12',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      padding: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.lg,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: '#d68910',
      fontWeight: TavariStyles.typography.fontWeight.semibold
    },
    supportText: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: '#6b7280',
      marginBottom: TavariStyles.spacing['2xl'],
      fontStyle: 'italic'
    },
    button: {
      width: '100%',
      padding: '14px',
      backgroundColor: '#d9534f',
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      cursor: 'pointer',
      transition: 'background-color 0.2s ease, transform 0.1s ease',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    },
    divider: {
      width: '60px',
      height: '3px',
      backgroundColor: '#ebccd1',
      margin: `${TavariStyles.spacing.lg} auto`,
      borderRadius: '2px'
    }
  };

  // Get user-friendly reason text
  const getReasonText = () => {
    const reason = location.state?.reason;
    switch (reason) {
      case 'inactive':
        return 'Your account is currently marked as inactive.';
      case 'suspended':
        return 'Your account has been suspended by an administrator.';
      case 'outside_hours':
        return 'You are attempting to access outside your permitted hours.';
      case 'terminated':
        return 'Your employment has been terminated.';
      case 'invalid_session':
        return 'Your session is invalid or has expired.';
      default:
        return 'Your account access is currently restricted.';
    }
  };

  return (
    <SecurityWrapper>
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.icon}>🔒</div>
          
          <h2 style={styles.title}>Account Locked</h2>
          
          <div style={styles.divider}></div>
          
          <p style={styles.message}>
            {getReasonText()}
          </p>

          {location.state?.reason && (
            <div style={styles.reasonBox}>
              <strong>Reason:</strong> {location.state.reason.replace(/_/g, ' ').toUpperCase()}
            </div>
          )}

          <p style={styles.message}>
            You are unable to access the system at this time. Please contact your manager or system administrator for assistance.
          </p>

          <p style={styles.supportText}>
            If you believe this is an error, please reach out to your support team with the timestamp above.
          </p>

          <button 
            style={styles.button}
            onClick={handleReturnToLogin}
            onMouseOver={(e) => {
              e.target.style.backgroundColor = '#c9302c';
              e.target.style.transform = 'translateY(-1px)';
            }}
            onMouseOut={(e) => {
              e.target.style.backgroundColor = '#d9534f';
              e.target.style.transform = 'translateY(0)';
            }}
            onMouseDown={(e) => {
              e.target.style.transform = 'translateY(0)';
            }}
          >
            Return to Login
          </button>

          <div style={{
            marginTop: TavariStyles.spacing.lg,
            fontSize: TavariStyles.typography.fontSize.xs,
            color: '#a0aec0'
          }}>
            Access Denied • {new Date().toLocaleString()}
          </div>
        </div>
      </div>
    </SecurityWrapper>
  );
};

export default Locked;