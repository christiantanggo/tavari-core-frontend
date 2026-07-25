// Security/index.js - Security Module Exports
/**
 * Centralized exports for all Tavari Security components and utilities
 * Import this file to access all security features across the platform
 */

// Import all modules first
import SecurityWrapperComponent from './SecurityWrapper.jsx';
import { useSecurityContext } from './useSecurityContext.js';
import deviceFingerprintInstance from './DeviceFingerprint.js';
import securityAuditInstance from './SecurityAudit.js';
import SecurityUtilsClass from './SecurityUtils.js';
import rateLimiterInstance from './RateLimiter.js';

// Core Security Components
export { default as SecurityWrapper } from './SecurityWrapper.jsx';
export { useSecurityContext } from './useSecurityContext.js';

// Security Services
export { default as deviceFingerprint } from './DeviceFingerprint.js';
export { default as securityAudit } from './SecurityAudit.js';
export { default as SecurityUtils } from './SecurityUtils.js';
export { default as rateLimiter } from './RateLimiter.js';

// Security Configuration
export const SECURITY_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

export const THREAT_TYPES = {
  XSS: 'xss_detected',
  SQL_INJECTION: 'sql_injection_detected',
  COMMAND_INJECTION: 'command_injection_detected',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  SUSPICIOUS_ACTIVITY: 'suspicious_activity',
  MALICIOUS_INPUT: 'malicious_input_detected',
  SESSION_TIMEOUT: 'session_timeout',
  UNAUTHORIZED_ACCESS: 'unauthorized_access',
  DEVICE_ANOMALY: 'device_anomaly',
  LOCATION_ANOMALY: 'location_anomaly'
};

export const SECURITY_EVENTS = {
  LOGIN_ATTEMPT: 'login_attempt',
  LOGIN_SUCCESS: 'login_success',
  LOGIN_FAILURE: 'login_failure',
  LOGOUT: 'logout',
  PASSWORD_CHANGE: 'password_change',
  ACCOUNT_LOCKOUT: 'account_lockout',
  PERMISSION_ESCALATION: 'permission_escalation',
  DATA_ACCESS: 'data_access',
  DATA_EXPORT: 'data_export',
  BULK_DATA_CHANGE: 'bulk_data_change',
  FINANCIAL_TRANSACTION: 'financial_transaction',
  COMPLIANCE_EVENT: 'compliance_event',
  SYSTEM_ERROR: 'system_error',
  SECURITY_CONFIG_CHANGE: 'security_config_change'
};

// Security Configuration Presets
export const SECURITY_PRESETS = {
  // Low security for public/marketing pages
  PUBLIC: {
    enableRateLimiting: true,
    enableDeviceTracking: false,
    enableInputValidation: true,
    enableAuditLogging: false,
    sensitiveComponent: false,
    requireSecureConnection: false,
    sessionTimeout: 60 * 60 * 1000, // 1 hour
    securityLevel: SECURITY_LEVELS.LOW,
    autoBlock: false
  },
  
  // Standard security for authenticated user areas
  STANDARD: {
    enableRateLimiting: true,
    enableDeviceTracking: true,
    enableInputValidation: true,
    enableAuditLogging: true,
    sensitiveComponent: false,
    requireSecureConnection: true,
    sessionTimeout: 30 * 60 * 1000, // 30 minutes
    securityLevel: SECURITY_LEVELS.MEDIUM,
    autoBlock: false
  },
  
  // Enhanced security for admin areas
  ADMIN: {
    enableRateLimiting: true,
    enableDeviceTracking: true,
    enableInputValidation: true,
    enableAuditLogging: true,
    sensitiveComponent: true,
    requireSecureConnection: true,
    sessionTimeout: 15 * 60 * 1000, // 15 minutes
    securityLevel: SECURITY_LEVELS.HIGH,
    autoBlock: true
  },
  
  // Maximum security for financial/payment areas
  FINANCIAL: {
    enableRateLimiting: true,
    enableDeviceTracking: true,
    enableInputValidation: true,
    enableAuditLogging: true,
    sensitiveComponent: true,
    requireSecureConnection: true,
    sessionTimeout: 10 * 60 * 1000, // 10 minutes
    securityLevel: SECURITY_LEVELS.CRITICAL,
    autoBlock: true
  }
};

// Rate Limiting Presets
export const RATE_LIMIT_PRESETS = {
  LENIENT: {
    maxAttempts: 10,
    windowMs: 60 * 1000, // 1 minute
    blockDurationMs: 60 * 1000 // 1 minute
  },
  
  STANDARD: {
    maxAttempts: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
    blockDurationMs: 15 * 60 * 1000 // 15 minutes
  },
  
  STRICT: {
    maxAttempts: 3,
    windowMs: 60 * 60 * 1000, // 1 hour
    blockDurationMs: 60 * 60 * 1000 // 1 hour
  },
  
  LOCKDOWN: {
    maxAttempts: 1,
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    blockDurationMs: 24 * 60 * 60 * 1000 // 24 hours
  }
};

// Utility Functions
/**
 * Initialize security for the entire application
 * @param {object} config - Global security configuration
 */
export const initializeTavariSecurity = async (config = {}) => {
  const defaultConfig = {
    enableGlobalAuditLogging: true,
    enableGlobalRateLimiting: true,
    enableGlobalDeviceTracking: true,
    defaultSecurityLevel: SECURITY_LEVELS.MEDIUM,
    logRetentionDays: 90,
    autoCleanupEnabled: true
  };

  const finalConfig = { ...defaultConfig, ...config };

  try {
    // Initialize rate limiter with default actions
    rateLimiterInstance.setupDefaultLimiters();

    // Initialize security audit logging
    if (finalConfig.enableGlobalAuditLogging) {
      await securityAuditInstance.initialize();
    }

    // Log security initialization
    await securityAuditInstance.logEvent('tavari_security_initialized', {
      config: finalConfig,
      version: '1.0.0',
      features: {
        rateLimiting: finalConfig.enableGlobalRateLimiting,
        auditLogging: finalConfig.enableGlobalAuditLogging,
        deviceTracking: finalConfig.enableGlobalDeviceTracking
      }
    }, 'low');

    console.log('🔒 Tavari Security initialized successfully');
    
    return {
      success: true,
      config: finalConfig,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ Failed to initialize Tavari Security:', error);
    
    await securityAuditInstance.logSystemError(error, {
      data_action: 'security_initialization',
      config: finalConfig
    });

    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
};

/**
 * Quick security validation for forms
 * @param {object} formData - Form data to validate
 * @param {object} validationRules - Validation rules
 */
export const validateFormSecurity = async (formData, validationRules = {}) => {
  const results = {};
  let hasErrors = false;

  for (const [fieldName, value] of Object.entries(formData)) {
    const rules = validationRules[fieldName] || { type: 'text' };
    
    // Basic validation
    let validation = { valid: true };
    
    switch (rules.type) {
      case 'email':
        validation = SecurityUtilsClass.validateEmail(value);
        break;
      case 'password':
        validation = SecurityUtilsClass.validatePassword(value);
        break;
      case 'phone':
        validation = SecurityUtilsClass.validatePhone(value);
        break;
      case 'name':
        validation = SecurityUtilsClass.validateName(value, fieldName);
        break;
      default:
        validation = { valid: true, sanitized: SecurityUtilsClass.sanitizeString(value) };
    }

    // Security checks (skip injection heuristics for passwords — see useSecurityContext validateInput)
    const skipInjectionHeuristics = rules.type === 'password' || fieldName === 'password';
    const xssCheck = skipInjectionHeuristics ? { safe: true } : SecurityUtilsClass.checkForXSS(value);
    const sqlCheck = skipInjectionHeuristics || rules.type === 'email' ? { safe: true } : SecurityUtilsClass.checkForSQLInjection(value);
    const commandCheck = skipInjectionHeuristics ? { safe: true } : SecurityUtilsClass.checkForCommandInjection(value);

    if (!xssCheck.safe || !sqlCheck.safe || !commandCheck.safe) {
      validation.valid = false;
      validation.error = 'Input contains potentially malicious content';
      validation.threats = [];
      if (!xssCheck.safe) validation.threats.push('XSS');
      if (!sqlCheck.safe) validation.threats.push('SQL Injection');
      if (!commandCheck.safe) validation.threats.push('Command Injection');
    }

    results[fieldName] = validation;
    
    if (!validation.valid) {
      hasErrors = true;
    }
  }

  return {
    valid: !hasErrors,
    results,
    sanitizedData: Object.fromEntries(
      Object.entries(results).map(([key, result]) => [
        key,
        result.sanitized || formData[key]
      ])
    )
  };
};

/**
 * Emergency security lockdown
 * @param {string} reason - Reason for lockdown
 * @param {number} durationMs - Lockdown duration
 */
export const emergencyLockdown = async (reason, durationMs = 60 * 60 * 1000) => {
  await rateLimiterInstance.emergencyLockdown(reason, durationMs);
  await securityAuditInstance.logEvent('emergency_lockdown_triggered', {
    threat_type: 'emergency_lockdown',
    details: {
      reason,
      duration: durationMs,
      triggered_by: 'security_module'
    }
  }, 'critical');
};

/**
 * Lift emergency lockdown
 * @param {string} reason - Reason for lifting lockdown
 */
export const liftEmergencyLockdown = async (reason) => {
  await rateLimiterInstance.liftEmergencyLockdown(reason);
  await securityAuditInstance.logEvent('emergency_lockdown_lifted', {
    details: {
      reason,
      lifted_by: 'security_module'
    }
  }, 'medium');
};

/**
 * Get comprehensive security status
 */
export const getGlobalSecurityStatus = () => {
  return {
    rateLimiter: rateLimiterInstance.getStats(),
    audit: {
      initialized: securityAuditInstance.initialized,
      storedLogs: securityAuditInstance.getStoredLogs().length
    },
    emergencyLockdown: rateLimiterInstance.isInEmergencyLockdown(),
    timestamp: new Date().toISOString()
  };
};

// Export everything as default object as well
export default {
  // Constants
  SECURITY_LEVELS,
  THREAT_TYPES,
  SECURITY_EVENTS,
  SECURITY_PRESETS,
  RATE_LIMIT_PRESETS,
  
  // Utilities
  initializeTavariSecurity,
  validateFormSecurity,
  emergencyLockdown,
  liftEmergencyLockdown,
  getGlobalSecurityStatus
};