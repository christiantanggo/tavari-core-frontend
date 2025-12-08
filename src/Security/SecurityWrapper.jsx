// Security/SecurityWrapper.jsx - Security Wrapper Component
import React, { useEffect, useState } from 'react';
import { TavariStyles } from '../utils/TavariStyles';
import { useSecurityContext } from './useSecurityContext.js';

/**
 * Security wrapper component that adds comprehensive security features
 * to any Tavari component or screen
 */
const SecurityWrapper = ({
  children,
  componentName = 'UnknownComponent',
  enableRateLimiting = true,
  enableDeviceTracking = true,
  enableInputValidation = true,
  enableAuditLogging = true,
  sensitiveComponent = false,
  requireSecureConnection = false,
  showSecurityStatus = false,
  sessionTimeout = 30 * 60 * 1000,
  onSecurityThreat = null,
  onSessionTimeout = null,
  onRateLimitExceeded = null,
  securityLevel = 'medium', // low, medium, high, critical
  autoBlock = false,
  className = '',
  style = {},
  ...props
}) => {
  const [securityAlerts, setSecurityAlerts] = useState([]);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockReason, setBlockReason] = useState('');

  const securityOptions = {
    enableRateLimiting,
    enableDeviceTracking,
    enableInputValidation,
    enableAuditLogging,
    componentName,
    sensitiveComponent,
    sessionTimeout,
    onSessionTimeout: (sessionData) => {
      if (onSessionTimeout) {
        onSessionTimeout(sessionData);
      }
      if (autoBlock && securityLevel !== 'low') {
        handleSecurityBlock('Session timeout - security protocol activated');
      }
    }
  };

  const {
    securityState,
    securityMetrics,
    isInitialized,
    isSecure,
    hasThreats,
    hasValidationErrors,
    sessionActive,
    getSecurityStatus,
    clearThreats,
    logSecurityEvent
  } = useSecurityContext(securityOptions);

  // Monitor security threats
  useEffect(() => {
    if (hasThreats && securityState.threats.length > 0) {
      const latestThreat = securityState.threats[securityState.threats.length - 1];
      
      // Create alert
      const alert = {
        id: Date.now(),
        type: latestThreat.type,
        message: latestThreat.message,
        severity: latestThreat.severity,
        timestamp: latestThreat.timestamp,
        component: componentName
      };

      setSecurityAlerts(prev => [...prev, alert]);

      // Handle security threat callback
      if (onSecurityThreat) {
        onSecurityThreat(latestThreat);
      }

      // Auto-block on critical threats
      if (autoBlock && (latestThreat.severity === 'critical' || latestThreat.severity === 'high')) {
        handleSecurityBlock(`Security threat detected: ${latestThreat.type}`);
      }

      // Auto-clear alert after timeout
      setTimeout(() => {
        setSecurityAlerts(prev => prev.filter(a => a.id !== alert.id));
      }, getSeverityTimeout(alert.severity));
    }
  }, [hasThreats, securityState.threats, onSecurityThreat, autoBlock, componentName]);

  // Check secure connection requirement
  useEffect(() => {
    if (requireSecureConnection && location.protocol !== 'https:') {
      const threat = {
        type: 'insecure_connection',
        message: 'Secure HTTPS connection required for this component',
        severity: 'high',
        timestamp: Date.now()
      };

      if (onSecurityThreat) {
        onSecurityThreat(threat);
      }

      if (autoBlock) {
        handleSecurityBlock('Insecure connection detected');
      }

      logSecurityEvent('insecure_connection_detected', {
        protocol: location.protocol,
        url: location.href,
        required_security_level: securityLevel
      }, 'high');
    }
  }, [requireSecureConnection, autoBlock, onSecurityThreat, logSecurityEvent, securityLevel]);

  // Monitor rate limiting
  useEffect(() => {
    const rateLimitStatuses = Object.values(securityState.rateLimitStatus || {});
    const blockedActions = rateLimitStatuses.filter(status => !status.allowed);
    
    if (blockedActions.length > 0 && onRateLimitExceeded) {
      onRateLimitExceeded(blockedActions);
    }
  }, [securityState.rateLimitStatus, onRateLimitExceeded]);

  /**
   * Handle security block
   */
  const handleSecurityBlock = (reason) => {
    setIsBlocked(true);
    setBlockReason(reason);
    
    logSecurityEvent('component_security_blocked', {
      reason,
      security_level: securityLevel,
      auto_block: autoBlock,
      threats: securityState.threats
    }, 'high');
  };

  /**
   * Get timeout based on severity
   */
  const getSeverityTimeout = (severity) => {
    switch (severity) {
      case 'critical': return 30000; // 30 seconds
      case 'high': return 20000; // 20 seconds
      case 'medium': return 10000; // 10 seconds
      case 'low': return 5000; // 5 seconds
      default: return 10000;
    }
  };

  /**
   * Get security level color
   */
  const getSecurityLevelColor = () => {
    const status = getSecurityStatus();
    
    switch (status.status) {
      case 'secure': return TavariStyles.colors.success;
      case 'threats_detected': return TavariStyles.colors.danger;
      case 'validation_errors': return TavariStyles.colors.warning;
      case 'rate_limited': return TavariStyles.colors.warning;
      case 'initializing': return TavariStyles.colors.gray500;
      default: return TavariStyles.colors.gray500;
    }
  };

  /**
   * Dismiss security alert
   */
  const dismissAlert = (alertId) => {
    setSecurityAlerts(prev => prev.filter(alert => alert.id !== alertId));
  };

  /**
   * Clear all threats and unblock
   */
  const clearSecurityBlock = () => {
    setIsBlocked(false);
    setBlockReason('');
    clearThreats();
    setSecurityAlerts([]);
    
    logSecurityEvent('component_security_unblocked', {
      component: componentName,
      manual_clear: true
    }, 'medium');
  };

  const styles = {
    wrapper: {
      position: 'relative',
      width: '100%',
      height: '100%',
      ...style
    },
    
    securityOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      backdropFilter: 'blur(5px)'
    },
    
    securityBlockCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing['3xl'],
      maxWidth: '500px',
      width: '90%',
      textAlign: 'center',
      border: `2px solid ${TavariStyles.colors.danger}`
    },
    
    securityBlockTitle: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.danger,
      marginBottom: TavariStyles.spacing.lg
    },
    
    securityBlockMessage: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.xl,
      lineHeight: TavariStyles.typography.lineHeight.relaxed
    },
    
    securityStatus: {
      position: 'fixed',
      top: TavariStyles.spacing.md,
      right: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.white,
      border: `2px solid ${getSecurityLevelColor()}`,
      borderRadius: TavariStyles.borderRadius.lg,
      padding: TavariStyles.spacing.md,
      boxShadow: TavariStyles.shadows.lg,
      fontSize: TavariStyles.typography.fontSize.xs,
      minWidth: '200px',
      zIndex: 9998
    },
    
    securityStatusTitle: {
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: getSecurityLevelColor(),
      marginBottom: TavariStyles.spacing.xs
    },
    
    securityStatusItem: {
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: TavariStyles.spacing.xs,
      fontSize: TavariStyles.typography.fontSize.xs
    },
    
    securityAlert: {
      position: 'fixed',
      top: TavariStyles.spacing.md,
      left: '50%',
      transform: 'translateX(-50%)',
      backgroundColor: TavariStyles.colors.white,
      border: `2px solid ${TavariStyles.colors.danger}`,
      borderRadius: TavariStyles.borderRadius.lg,
      padding: TavariStyles.spacing.lg,
      boxShadow: TavariStyles.shadows.xl,
      maxWidth: '400px',
      width: '90%',
      zIndex: 9997,
      animation: 'slideDown 0.3s ease-out'
    },
    
    alertTitle: {
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.danger,
      marginBottom: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    
    alertMessage: {
      color: TavariStyles.colors.gray700,
      fontSize: TavariStyles.typography.fontSize.xs,
      marginBottom: TavariStyles.spacing.md
    },
    
    alertActions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      justifyContent: 'flex-end'
    },
    
    button: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.sizes.sm
    },
    
    primaryButton: {
      ...TavariStyles.components.button.variants.primary
    },
    
    secondaryButton: {
      ...TavariStyles.components.button.variants.secondary
    },
    
    dangerButton: {
      ...TavariStyles.components.button.variants.danger
    },
    
    loadingContainer: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: TavariStyles.spacing.xl,
      color: TavariStyles.colors.gray600
    },
    
    loadingSpinner: {
      width: '20px',
      height: '20px',
      border: '2px solid #f3f4f6',
      borderTop: '2px solid #008080',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
      marginRight: TavariStyles.spacing.md
    },
    initializingOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255, 255, 255, 0.75)',
      backdropFilter: 'blur(3px)',
      zIndex: 5000,
      pointerEvents: 'none'
    }
  };

  return (
    <div style={styles.wrapper} className={className} {...props}>
      {children}
      {!isInitialized && (
        <div style={styles.initializingOverlay}>
          <div style={styles.loadingContainer}>
            <div style={styles.loadingSpinner}></div>
            Initializing security context...
          </div>
        </div>
      )}
      {/* Allow children to render even if not initialized - overlay is non-blocking */}
      {isBlocked && (
        <div style={styles.securityOverlay}>
          <div style={styles.securityBlockCard}>
            <h3 style={styles.securityBlockTitle}>🔒 Access Blocked</h3>
            <p style={styles.securityBlockMessage}>{blockReason}</p>
            
            <div style={styles.alertActions}>
              <button 
                style={{...styles.button, ...styles.secondaryButton}}
                onClick={() => window.location.reload()}
              >
                Refresh Page
              </button>
              {securityLevel !== 'critical' && (
                <button 
                  style={{...styles.button, ...styles.dangerButton}}
                  onClick={clearSecurityBlock}
                >
                  Clear Block (Admin)
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Security status indicator */}
      {showSecurityStatus && (
        <div style={styles.securityStatus}>
          <div style={styles.securityStatusTitle}>
            Security Status
          </div>
          <div style={styles.securityStatusItem}>
            <span>Status:</span>
            <span>{getSecurityStatus().status}</span>
          </div>
          <div style={styles.securityStatusItem}>
            <span>Score:</span>
            <span>{getSecurityStatus().score}/100</span>
          </div>
          <div style={styles.securityStatusItem}>
            <span>Threats:</span>
            <span>{securityState.threats.length}</span>
          </div>
          <div style={styles.securityStatusItem}>
            <span>Session:</span>
            <span>{sessionActive ? 'Active' : 'Inactive'}</span>
          </div>
          {securityMetrics.interactionCount > 0 && (
            <div style={styles.securityStatusItem}>
              <span>Interactions:</span>
              <span>{securityMetrics.interactionCount}</span>
            </div>
          )}
        </div>
      )}
      
      {/* Security alerts */}
      {securityAlerts.map(alert => (
        <div key={alert.id} style={styles.securityAlert}>
          <div style={styles.alertTitle}>
            Security Alert: {alert.type.replace(/_/g, ' ').toUpperCase()}
          </div>
          <div style={styles.alertMessage}>
            {alert.message}
          </div>
          <div style={styles.alertActions}>
            <button 
              style={{...styles.button, ...styles.secondaryButton}}
              onClick={() => dismissAlert(alert.id)}
            >
              Dismiss
            </button>
            {alert.severity === 'high' || alert.severity === 'critical' ? (
              <button 
                style={{...styles.button, ...styles.dangerButton}}
                onClick={clearSecurityBlock}
              >
                Clear All
              </button>
            ) : null}
          </div>
        </div>
      ))}
      
      {/* CSS animations */}
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          @keyframes slideDown {
            from { transform: translateX(-50%) translateY(-100%); opacity: 0; }
            to { transform: translateX(-50%) translateY(0); opacity: 1; }
          }
        `}
      </style>
    </div>
  );
};

export default SecurityWrapper;