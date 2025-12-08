// Security/useSecurityContext.js - Security Context Hook
import { useState, useEffect, useCallback, useRef } from 'react';
import deviceFingerprint from './DeviceFingerprint.js';
import securityAudit from './SecurityAudit.js';
import SecurityUtils from './SecurityUtils.js';
import rateLimiter from './RateLimiter.js';

/**
 * Security context hook that provides comprehensive security features
 * for any React component in the Tavari platform
 */
export const useSecurityContext = (options = {}) => {
  const {
    enableRateLimiting = true,
    enableDeviceTracking = true,
    enableInputValidation = true,
    enableAuditLogging = true,
    autoInitialize = true,
    sessionTimeout = Infinity, // BULLETPROOF: Never timeout
    componentName = 'UnknownComponent',
    sensitiveComponent = false
  } = options;

  // State management
  const [securityState, setSecurityState] = useState({
    initialized: false,
    deviceFingerprint: null,
    sessionId: null,
    lastActivity: Date.now(),
    isSecure: true,
    threats: [],
    rateLimitStatus: {},
    validationErrors: {},
    userIP: null
  });

  const [securityMetrics, setSecurityMetrics] = useState({
    pageLoadTime: null,
    interactionCount: 0,
    validationAttempts: 0,
    rateLimitHits: 0,
    threatDetections: 0
  });

  // Refs for tracking
  const initializationRef = useRef(false);
  const activityTimerRef = useRef(null);
  const componentMountTime = useRef(Date.now());
  const interactionTimerRef = useRef(null);

  /**
   * Initialize security context with timeout protection
   */
  const initializeSecurity = useCallback(async () => {
    if (initializationRef.current) return;
    initializationRef.current = true;

    // Set a maximum timeout for initialization (5 seconds - reduced for faster login)
    const initTimeout = new Promise((resolve) => {
      setTimeout(() => {
        resolve({ timeout: true });
      }, 5000);
    });

    const initPromise = (async () => {
      try {
        const startTime = Date.now();

        // Generate device fingerprint with timeout (reduced to 2 seconds)
        let fingerprint = null;
        if (enableDeviceTracking) {
          try {
            const fingerprintPromise = deviceFingerprint.generate();
            const fingerprintTimeout = new Promise((resolve) => setTimeout(() => resolve(null), 2000));
            fingerprint = await Promise.race([fingerprintPromise, fingerprintTimeout]);
          } catch (err) {
            console.warn('Device fingerprint generation failed or timed out:', err);
            fingerprint = null;
          }
        }

        // Get user IP with timeout (reduced to 1 second)
        let userIP = 'unknown';
        try {
          const ipPromise = SecurityUtils.getClientIP();
          const ipTimeout = new Promise((resolve) => setTimeout(() => resolve('unknown'), 1000));
          userIP = await Promise.race([ipPromise, ipTimeout]);
        } catch (err) {
          console.warn('IP lookup failed or timed out:', err);
          userIP = 'unknown';
        }

        // Generate session ID (synchronous, no timeout needed)
        const sessionId = SecurityUtils.generateSessionId();

        // Initialize audit logging if enabled (with timeout - reduced to 1 second)
        if (enableAuditLogging) {
          try {
            const auditPromise = Promise.all([
              securityAudit.initialize(),
              securityAudit.logPageView(componentName, Date.now() - componentMountTime.current)
            ]);
            const auditTimeout = new Promise((resolve) => setTimeout(() => resolve(), 1000));
            await Promise.race([auditPromise, auditTimeout]);
          } catch (err) {
            console.warn('Audit logging initialization failed or timed out:', err);
            // Continue even if audit fails
          }
        }

        const endTime = Date.now();
        const pageLoadTime = endTime - startTime;

        setSecurityState(prev => ({
          ...prev,
          initialized: true,
          deviceFingerprint: fingerprint,
          sessionId,
          userIP,
          lastActivity: Date.now()
        }));

        setSecurityMetrics(prev => ({
          ...prev,
          pageLoadTime
        }));

        // Log successful initialization (non-blocking)
        if (enableAuditLogging) {
          securityAudit.logEvent('security_context_initialized', {
            component: componentName,
            device_fingerprint: fingerprint ? 'generated' : 'disabled',
            session_id: sessionId,
            ip_address: userIP,
            page_load_time: pageLoadTime,
            sensitive_data: sensitiveComponent
          }, sensitiveComponent ? 'medium' : 'low').catch(err => {
            console.warn('Failed to log initialization event:', err);
          });
        }

        return { success: true };
      } catch (error) {
        console.error('Security context initialization failed:', error);
        
        setSecurityState(prev => ({
          ...prev,
          initialized: true,
          isSecure: false,
          threats: [...prev.threats, {
            type: 'initialization_failed',
            message: 'Security context failed to initialize',
            timestamp: Date.now(),
            severity: 'medium'
          }]
        }));

        if (enableAuditLogging) {
          securityAudit.logSystemError(error, {
            component: componentName,
            data_action: 'security_initialization'
          }).catch(err => {
            console.warn('Failed to log system error:', err);
          });
        }

        return { success: false, error };
      }
    })();

    // Race between initialization and timeout
    const result = await Promise.race([initPromise, initTimeout]);

    // If timeout occurred, force initialization to complete
    if (result.timeout) {
      console.warn('Security context initialization timed out, completing with defaults');
      setSecurityState(prev => ({
        ...prev,
        initialized: true,
        deviceFingerprint: null,
        sessionId: SecurityUtils.generateSessionId(),
        userIP: 'unknown',
        lastActivity: Date.now(),
        isSecure: true
      }));
    }
  }, [enableDeviceTracking, enableAuditLogging, componentName, sensitiveComponent, sessionTimeout]);

  /**
   * Start activity monitoring for session timeout
   */
  const startActivityMonitoring = useCallback(() => {
    const updateActivity = () => {
      setSecurityState(prev => ({
        ...prev,
        lastActivity: Date.now()
      }));
    };

    // Set up activity listeners
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    
    const throttledUpdate = throttle(updateActivity, 1000); // Throttle to once per second

    events.forEach(event => {
      document.addEventListener(event, throttledUpdate, true);
    });

    // Set up session timeout check
    activityTimerRef.current = setInterval(() => {
      const now = Date.now();
      const timeSinceActivity = now - securityState.lastActivity;
      
      if (timeSinceActivity > sessionTimeout) {
        handleSessionTimeout();
      }
    }, 60000); // Check every minute

    // Cleanup function
    return () => {
      events.forEach(event => {
        document.removeEventListener(event, throttledUpdate, true);
      });
      if (activityTimerRef.current) {
        clearInterval(activityTimerRef.current);
      }
    };
  }, [securityState.lastActivity, sessionTimeout]);

  /**
   * Handle session timeout
   */
  const handleSessionTimeout = useCallback(async () => {
    if (enableAuditLogging) {
      await securityAudit.logEvent('session_timeout', {
        component: componentName,
        session_duration: Date.now() - componentMountTime.current,
        last_activity: new Date(securityState.lastActivity),
        timeout_duration: sessionTimeout
      }, 'low');
    }

    setSecurityState(prev => ({
      ...prev,
      isSecure: false,
      threats: [...prev.threats, {
        type: 'session_timeout',
        message: 'Session timed out due to inactivity',
        timestamp: Date.now(),
        severity: 'low'
      }]
    }));

    // Trigger session timeout callback if provided
    if (options.onSessionTimeout) {
      options.onSessionTimeout();
    }
  }, [componentName, securityState.lastActivity, sessionTimeout, enableAuditLogging, options]);

  /**
   * Validate user input with security checks
   */
  const validateInput = useCallback(async (input, validationType, fieldName = 'input') => {
    if (!enableInputValidation) {
      return { valid: true, sanitized: input };
    }

    setSecurityMetrics(prev => ({
      ...prev,
      validationAttempts: prev.validationAttempts + 1
    }));

    try {
      let validationResult = { valid: true };
      let sanitized = input;

      // Perform validation based on type
      switch (validationType) {
        case 'email':
          validationResult = SecurityUtils.validateEmail(input);
          if (validationResult.valid) {
            sanitized = input.toLowerCase().trim();
          }
          break;

        case 'password':
          validationResult = SecurityUtils.validatePassword(input);
          sanitized = input; // Don't modify passwords
          break;

        case 'phone':
          validationResult = SecurityUtils.validatePhone(input);
          sanitized = validationResult.cleaned || input;
          break;

        case 'name':
          validationResult = SecurityUtils.validateName(input, fieldName);
          sanitized = validationResult.cleaned || input;
          break;

        case 'text':
          sanitized = SecurityUtils.sanitizeString(input, {
            maxLength: 1000,
            allowHTML: false
          });
          break;

        case 'numeric':
          sanitized = SecurityUtils.sanitizeNumeric(input);
          if (sanitized === null) {
            validationResult = { valid: false, error: 'Invalid numeric value' };
          }
          break;

        default:
          // Generic sanitization
          sanitized = SecurityUtils.sanitizeString(input);
      }

      // Security threat checks
      // Skip SQL injection check for email fields - emails are validated separately and dashes are valid
      const xssCheck = SecurityUtils.checkForXSS(input);
      const sqlCheck = validationType === 'email' ? { safe: true } : SecurityUtils.checkForSQLInjection(input);
      const commandCheck = SecurityUtils.checkForCommandInjection(input);

      const threats = [];
      if (!xssCheck.safe) threats.push('XSS');
      if (!sqlCheck.safe) threats.push('SQL_INJECTION');
      if (!commandCheck.safe) threats.push('COMMAND_INJECTION');

      if (threats.length > 0) {
        const threatInfo = {
          type: 'malicious_input_detected',
          message: `Potential security threat in ${fieldName}: ${threats.join(', ')}`,
          timestamp: Date.now(),
          severity: 'high',
          details: { threats, fieldName, inputLength: input.length }
        };

        setSecurityState(prev => ({
          ...prev,
          threats: [...prev.threats, threatInfo]
        }));

        setSecurityMetrics(prev => ({
          ...prev,
          threatDetections: prev.threatDetections + 1
        }));

        if (enableAuditLogging) {
          await securityAudit.logSuspiciousActivity('malicious_input', {
            component: componentName,
            threat_type: 'malicious_input_detected',
            threat_details: {
              fieldName,
              threats,
              inputLength: input.length
            },
            malicious_input_sample: input.substring(0, 100) // Log first 100 chars only
          }, 'high');
        }

        validationResult = {
          valid: false,
          error: 'Input contains potentially malicious content'
        };
      }

      // Update validation errors state
      setSecurityState(prev => ({
        ...prev,
        validationErrors: {
          ...prev.validationErrors,
          [fieldName]: validationResult.valid ? null : validationResult.error
        }
      }));

      return {
        valid: validationResult.valid,
        error: validationResult.error,
        sanitized,
        threats
      };

    } catch (error) {
      console.error('Input validation error:', error);
      
      if (enableAuditLogging) {
        await securityAudit.logSystemError(error, {
          component: componentName,
          data_action: 'input_validation',
          details: { fieldName, validationType }
        });
      }

      return {
        valid: false,
        error: 'Validation failed due to system error',
        sanitized: input
      };
    }
  }, [enableInputValidation, enableAuditLogging, componentName]);

  /**
   * Check rate limiting for actions
   */
  const checkRateLimit = useCallback(async (action, identifier = null) => {
    if (!enableRateLimiting) {
      return { allowed: true, reason: 'rate_limiting_disabled' };
    }

    try {
      // Use device fingerprint or IP as identifier if not provided
      const effectiveIdentifier = identifier || 
                                 securityState.deviceFingerprint || 
                                 securityState.userIP || 
                                 'unknown';

      const context = {
        ip: securityState.userIP,
        userAgent: navigator.userAgent,
        component: componentName,
        deviceFingerprint: securityState.deviceFingerprint
      };

      // Add timeout to rate limiting to prevent hanging
      const rateLimitPromise = rateLimiter.checkLimit(action, effectiveIdentifier, context);
      const rateLimitTimeout = new Promise((resolve) => 
        setTimeout(() => resolve({ allowed: true, reason: 'rate_limit_timeout' }), 2000)
      );
      const result = await Promise.race([rateLimitPromise, rateLimitTimeout]);

      // Update rate limit status
      setSecurityState(prev => ({
        ...prev,
        rateLimitStatus: {
          ...prev.rateLimitStatus,
          [action]: result
        }
      }));

      if (!result.allowed) {
        setSecurityMetrics(prev => ({
          ...prev,
          rateLimitHits: prev.rateLimitHits + 1
        }));

        setSecurityState(prev => ({
          ...prev,
          threats: [...prev.threats, {
            type: 'rate_limit_exceeded',
            message: `Rate limit exceeded for action: ${action}`,
            timestamp: Date.now(),
            severity: 'medium',
            details: { action, blockLevel: result.blockLevel }
          }]
        }));
      }

      return result;
    } catch (error) {
      console.error('Rate limit check error:', error);
      
      if (enableAuditLogging) {
        await securityAudit.logSystemError(error, {
          component: componentName,
          data_action: 'rate_limit_check'
        });
      }

      return { allowed: true, reason: 'rate_limit_error' };
    }
  }, [enableRateLimiting, securityState.deviceFingerprint, securityState.userIP, componentName, enableAuditLogging]);

  /**
   * Record user action for rate limiting
   */
  const recordAction = useCallback(async (action, successful = true, identifier = null) => {
    if (!enableRateLimiting) return;

    try {
      const effectiveIdentifier = identifier || 
                                 securityState.deviceFingerprint || 
                                 securityState.userIP || 
                                 'unknown';

      const context = {
        ip: securityState.userIP,
        userAgent: navigator.userAgent,
        component: componentName,
        deviceFingerprint: securityState.deviceFingerprint,
        successful
      };

      await rateLimiter.recordAttempt(action, effectiveIdentifier, successful, context);

      setSecurityMetrics(prev => ({
        ...prev,
        interactionCount: prev.interactionCount + 1
      }));

      if (enableAuditLogging) {
        await securityAudit.logUserAction(action, componentName, {
          successful,
          identifier: effectiveIdentifier
        });
      }

    } catch (error) {
      console.error('Action recording error:', error);
    }
  }, [enableRateLimiting, securityState.deviceFingerprint, securityState.userIP, componentName, enableAuditLogging]);

  /**
   * Log security event
   */
  const logSecurityEvent = useCallback(async (eventType, details = {}, severity = 'medium') => {
    if (!enableAuditLogging) return;

    try {
      await securityAudit.logEvent(eventType, {
        component: componentName,
        ...details
      }, severity);
    } catch (error) {
      console.error('Security event logging error:', error);
    }
  }, [enableAuditLogging, componentName]);

  /**
   * Clear security threats
   */
  const clearThreats = useCallback(() => {
    setSecurityState(prev => ({
      ...prev,
      threats: []
    }));
  }, []);

  /**
   * Clear validation errors
   */
  const clearValidationErrors = useCallback((fieldName = null) => {
    setSecurityState(prev => ({
      ...prev,
      validationErrors: fieldName 
        ? { ...prev.validationErrors, [fieldName]: null }
        : {}
    }));
  }, []);

  /**
   * Get security status summary
   */
  const getSecurityStatus = useCallback(() => {
    const threatCount = securityState.threats.length;
    const validationErrorCount = Object.values(securityState.validationErrors).filter(Boolean).length;
    const hasRateLimitIssues = Object.values(securityState.rateLimitStatus).some(status => !status.allowed);

    let status = 'secure';
    let score = 100;

    if (threatCount > 0) {
      status = 'threats_detected';
      score -= threatCount * 20;
    }

    if (validationErrorCount > 0) {
      status = 'validation_errors';
      score -= validationErrorCount * 10;
    }

    if (hasRateLimitIssues) {
      status = 'rate_limited';
      score -= 30;
    }

    if (!securityState.initialized) {
      status = 'initializing';
      score -= 50;
    }

    return {
      status,
      score: Math.max(0, score),
      initialized: securityState.initialized,
      threatCount,
      validationErrorCount,
      rateLimitIssues: hasRateLimitIssues,
      sessionActive: Date.now() - securityState.lastActivity < sessionTimeout
    };
  }, [securityState, sessionTimeout]);

  // Initialize on mount
  useEffect(() => {
    if (autoInitialize && !initializationRef.current) {
      initializeSecurity();
    }

    // Cleanup on unmount
    return () => {
      if (activityTimerRef.current) {
        clearInterval(activityTimerRef.current);
      }
      if (interactionTimerRef.current) {
        clearInterval(interactionTimerRef.current);
      }
    };
  }, [autoInitialize, initializeSecurity]);

      // Return security context API
  return {
    // State
    securityState,
    securityMetrics,
    
    // Methods
    initializeSecurity,
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent,
    clearThreats,
    clearValidationErrors,
    getSecurityStatus,
    
    // Computed values
    isInitialized: securityState.initialized,
    isSecure: securityState.isSecure,
    hasThreats: securityState.threats.length > 0,
    hasValidationErrors: Object.values(securityState.validationErrors).some(Boolean),
    sessionActive: Date.now() - securityState.lastActivity < sessionTimeout
  };
};

// Utility function for throttling
function throttle(func, limit) {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

export default useSecurityContext;