// Security/SecurityAudit.js - Security Audit Logging Service
import { supabase } from '../supabaseClient';
import deviceFingerprint from './DeviceFingerprint';
import SecurityUtils from './SecurityUtils';

const MAX_AUDIT_STRING = 500;
const MAX_AUDIT_DEPTH = 8;
const FINGERPRINT_FIELDS = new Set([
  'identifier',
  'devicefingerprint',
  'device_fingerprint',
  'rate_limit_identifier'
]);

const FINGERPRINT_OMIT_KEYS = new Set(['canvas', 'webgl', 'audio', 'fonts', 'features', 'storage']);

/**
 * Recursively cap / redact values so we never persist full device fingerprints,
 * canvas/base64 blobs, or unbounded caller-provided objects in `details` jsonb.
 */
function sanitizeStringForAudit(s) {
  if (s == null || typeof s !== 'string') return s;
  if (s.length <= MAX_AUDIT_STRING) return s;
  if (s.startsWith('data:') || /^eyJ[A-Za-z0-9+/]+=*$/.test(s.slice(0, 120))) {
    return `[redacted:${s.length}b]`;
  }
  const looksLikeB64 = /^[A-Za-z0-9+/=\s]+$/.test(s) && s.length >= 400;
  if (looksLikeB64) return `[redacted:${s.length}b]`;
  return `${s.slice(0, MAX_AUDIT_STRING - 3)}...`;
}

function sanitizeFingerprintLike(v) {
  if (v == null) return v;
  if (typeof v !== 'string') return sanitizeAuditDetails(v);
  return v.length <= 120 ? v : `fp:${v.slice(0, 8)}…(${v.length}b)`;
}

function sanitizeAuditDetails(input, depth = 0) {
  if (depth > MAX_AUDIT_DEPTH) return '[max depth]';
  if (input == null) return input;
  if (typeof input === 'string') return sanitizeStringForAudit(input);
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (Array.isArray(input)) return input.map((x) => sanitizeAuditDetails(x, depth + 1));
  if (typeof input !== 'object') return sanitizeStringForAudit(String(input));

  const out = {};
  for (const [k, v] of Object.entries(input)) {
    const kl = k.toLowerCase();
    if (FINGERPRINT_OMIT_KEYS.has(kl)) {
      out[k] = '[omitted]';
      continue;
    }
    if (FINGERPRINT_FIELDS.has(kl) || kl.endsWith('devicefingerprint')) {
      out[k] = sanitizeFingerprintLike(v);
      continue;
    }
    out[k] = sanitizeAuditDetails(v, depth + 1);
  }
  return out;
}

/**
 * Security audit logging service for tracking all security-related events
 * across the Tavari platform
 */
class SecurityAudit {
  constructor() {
    this.sessionId = null;
    this.userId = null;
    this.businessId = null;
    this.initialized = false;
    this.queue = [];
    this.isProcessing = false;
    this.batchInterval = null;
    this.loggingDisabledAfter403 = false; // stop re-queuing when DB returns 403
  }

  /**
   * Initialize the security audit system
   * @param {string} userId - Current user ID
   * @param {string} businessId - Current business ID
   */
  async initialize(userId = null, businessId = null) {
    this.userId = userId;
    this.businessId = businessId;
    this.sessionId = this.generateSessionId();
    this.initialized = true;

    // Process any queued events
    await this.processQueue();

    // Set up batch processing interval (every 30 seconds)
    if (!this.batchInterval) {
      this.batchInterval = setInterval(() => {
        this.processQueueBatch();
      }, 30000); // Every 30 seconds
    }

    // Log session start (medium severity - will be batched)
    await this.logEvent('session_start', {
      session_id: this.sessionId,
      user_agent: navigator.userAgent.substring(0, 200), // Limit size
      url: window.location.href.substring(0, 500), // Limit size
      referrer: document.referrer.substring(0, 500) // Limit size
    }, 'medium');
  }

  /**
   * Generate a unique session ID
   * @returns {string} Session ID
   */
  generateSessionId() {
    return btoa(Date.now() + Math.random() + navigator.userAgent).replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
  }

  /**
   * Log a security event
   * @param {string} eventType - Type of security event
   * @param {object} details - Event details
   * @param {string} severity - Event severity (low, medium, high, critical)
   * @param {string} userId - Override user ID
   * @param {string} businessId - Override business ID
   */
  async logEvent(eventType, details = {}, severity = 'medium', userId = null, businessId = null) {
    const safeDetails = sanitizeAuditDetails(details);
    const event = {
      event_type: eventType,
      user_id: userId || this.userId,
      business_id: businessId || this.businessId,
      session_id: this.sessionId,
      severity,
      details: await this.enrichEventDetails(safeDetails),
      created_at: new Date().toISOString()
    };

    if (!this.initialized) {
      // Queue event if not initialized
      this.queue.push(event);
      return;
    }

    try {
      await this.sendToDatabase(event);
    } catch (error) {
      console.error('Failed to log security event:', error);
      // Store in local storage as backup
      this.storeLocally(event);
    }
  }

  /**
   * Enrich event details with additional security information
   * @param {object} details - Original event details
   * @returns {object} Enriched event details
   */
  async enrichEventDetails(details) {
    // Limit detail sizes to prevent huge log entries
    const limitString = (str, maxLength = 500) => {
      if (!str) return null;
      return typeof str === 'string' ? str.substring(0, maxLength) : str;
    };

    const enriched = {
      ...details,
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      url: limitString(window.location.href, 500),
      user_agent: limitString(navigator.userAgent, 200),
      ip_address: await SecurityUtils.getClientIP(),
      device_fingerprint: limitString(await deviceFingerprint.generate(), 200),
      screen_resolution: `${screen.width}x${screen.height}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
      platform: navigator.platform,
      connection_type: navigator.connection ? navigator.connection.effectiveType : 'unknown',
      online_status: navigator.onLine,
      cookies_enabled: navigator.cookieEnabled
    };

    // Add performance metrics if available
    if (window.performance && window.performance.memory) {
      enriched.memory_usage = {
        used: window.performance.memory.usedJSHeapSize,
        total: window.performance.memory.totalJSHeapSize,
        limit: window.performance.memory.jsHeapSizeLimit
      };
    }

    // Add battery info if available
    if ('getBattery' in navigator) {
      try {
        const battery = await navigator.getBattery();
        enriched.battery_info = {
          charging: battery.charging,
          level: battery.level,
          chargingTime: battery.chargingTime,
          dischargingTime: battery.dischargingTime
        };
      } catch (error) {
        // Battery API might not be available
      }
    }

    return sanitizeAuditDetails(enriched);
  }

  /**
   * Send event to database
   * @param {object} event - Security event
   */
  async sendToDatabase(event) {
    // Rate limiting: Only log critical/high severity events immediately
    // Low/medium events are batched and sent less frequently
    if (event.severity === 'low' || event.severity === 'medium') {
      // Queue low/medium events for batch processing
      this.queue.push(event);
      // Process queue every 30 seconds or when it reaches 50 events
      if (this.queue.length >= 50) {
        this.processQueueBatch();
      }
      return;
    }

    // Critical/high events are sent immediately
    try {
      if (this.loggingDisabledAfter403) {
        this.storeLocally(event);
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        this.storeLocally(event);
        return;
      }
      const { error } = await supabase
        .from('tavari_admin_security_logs')
        .insert([event]);

      if (error) {
        const isAuthBlocked =
          error.message?.includes('403') ||
          error.message?.includes('401') ||
          error.code === 'PGRST301' ||
          error.status === 403 ||
          error.status === 401;
        if (isAuthBlocked) this.loggingDisabledAfter403 = true;
        this.storeLocally(event);
      }
    } catch (error) {
      this.storeLocally(event);
    }
  }

  /**
   * Process queue in batches to reduce database load
   */
  async processQueueBatch() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }
    if (this.loggingDisabledAfter403) {
      this.queue.length = 0;
      return;
    }

    this.isProcessing = true;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        this.queue.length = 0;
        return;
      }

      const batch = this.queue.splice(0, 50);
      
      if (batch.length > 0) {
        const { error } = await supabase
          .from('tavari_admin_security_logs')
          .insert(batch);

        if (error) {
          const isAuthBlocked =
            error.message?.includes('403') ||
            error.message?.includes('401') ||
            error.code === 'PGRST301' ||
            error.status === 403 ||
            error.status === 401;
          if (isAuthBlocked) {
            this.loggingDisabledAfter403 = true;
            if (typeof console !== 'undefined' && console.debug) {
              console.debug('[SecurityAudit] Logging paused (unauthorized). Events kept locally.');
            }
          }
          if (!this.loggingDisabledAfter403 && this.queue.length < 1000) {
            this.queue.unshift(...batch);
          }
        }
      }
    } catch (error) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[SecurityAudit] Batch processing error:', error);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Store event locally as backup
   * @param {object} event - Security event
   */
  storeLocally(event) {
    try {
      const stored = JSON.parse(localStorage.getItem('tavari_security_logs') || '[]');
      stored.push(event);
      
      // Keep only last 100 events
      if (stored.length > 100) {
        stored.splice(0, stored.length - 100);
      }
      
      localStorage.setItem('tavari_security_logs', JSON.stringify(stored));
    } catch (error) {
      console.warn('Failed to store security event locally:', error);
    }
  }

  /**
   * Process queued events (legacy - now uses batch processing)
   */
  async processQueue() {
    // Use batch processing instead
    await this.processQueueBatch();
  }

  /**
   * Security event logging methods for common events
   */

  // Authentication events
  async logLogin(method = 'email_password', success = true, additionalDetails = {}) {
    await this.logEvent('login_attempt', {
      login_method: method,
      login_success: success,
      ...additionalDetails
    }, success ? 'low' : 'medium');
  }

  async logLogout(reason = 'user_initiated') {
    await this.logEvent('logout', { reason }, 'low');
  }

  async logFailedLogin(email, reason, attemptNumber = 1) {
    await this.logEvent('failed_login', {
      email_attempted: email,
      lockout_reason: reason,
      failed_attempt_count: attemptNumber
    }, attemptNumber > 3 ? 'high' : 'medium');
  }

  async logAccountLockout(email, reason) {
    await this.logEvent('account_lockout', {
      email,
      lockout_reason: reason
    }, 'high');
  }

  async logPasswordChange(success = true) {
    await this.logEvent('password_change', { login_success: success }, 'medium');
  }

  // Access control events
  async logUnauthorizedAccess(resource, requiredRole, userRole) {
    await this.logEvent('unauthorized_access', {
      data_type: resource,
      data_action: 'access_denied',
      threat_type: 'unauthorized_access',
      threat_details: {
        required_role: requiredRole,
        user_role: userRole
      }
    }, 'high');
  }

  async logPermissionEscalation(fromRole, toRole, resource) {
    await this.logEvent('permission_escalation', {
      data_type: resource,
      data_action: 'role_escalation',
      threat_type: 'privilege_escalation',
      threat_details: {
        from_role: fromRole,
        to_role: toRole
      }
    }, 'critical');
  }

  async logPrivilegedAction(action, resource, justification = '') {
    await this.logEvent('privileged_action', {
      data_action: action,
      data_type: resource,
      details: { justification }
    }, 'medium');
  }

  // Data access events
  async logDataAccess(dataType, action, recordId = null, sensitive = false) {
    await this.logEvent('data_access', {
      data_type: dataType,
      data_action: action,
      record_id: recordId,
      sensitive_data: sensitive
    }, sensitive ? 'medium' : 'low');
  }

  async logDataExport(dataType, recordCount, format = 'csv') {
    await this.logEvent('data_export', {
      data_type: dataType,
      record_count: recordCount,
      export_format: format
    }, 'medium');
  }

  async logBulkDataChange(dataType, action, recordCount, criteria = {}) {
    await this.logEvent('bulk_data_change', {
      data_type: dataType,
      data_action: action,
      record_count: recordCount,
      details: { criteria }
    }, 'high');
  }

  // Suspicious activity events
  async logSuspiciousActivity(activityType, details, severity = 'medium') {
    await this.logEvent('suspicious_activity', {
      threat_type: activityType,
      threat_details: details,
      attack_pattern: details.pattern || 'unknown'
    }, severity);
  }

  async logRateLimitExceeded(endpoint, limit, actual) {
    await this.logEvent('rate_limit_exceeded', {
      component: endpoint,
      rate_limit_max_attempts: limit,
      rate_limit_attempts: actual,
      rate_limit_action: 'blocked'
    }, 'medium');
  }

  async logUnusualDeviceLogin() {
    await this.logEvent('unusual_device_login', {
      threat_type: 'device_anomaly',
      threat_details: { new_device: true }
    }, 'medium');
  }

  async logUnusualLocationLogin(location) {
    await this.logEvent('unusual_location_login', {
      location,
      threat_type: 'location_anomaly',
      threat_details: { new_location: true }
    }, 'medium');
  }

  // System events
  async logSystemError(error, context = {}) {
    await this.logEvent('system_error', {
      error_message: error.message,
      error_stack: error.stack,
      system_context: context
    }, 'medium');
  }

  async logSecurityConfigChange(setting, oldValue, newValue) {
    await this.logEvent('security_config_change', {
      data_type: 'security_config',
      data_action: 'config_change',
      details: {
        setting,
        old_value: oldValue,
        new_value: newValue
      }
    }, 'high');
  }

  async logIntegrationEvent(integration, event, data = {}) {
    await this.logEvent('integration_event', {
      component: integration,
      data_action: event,
      details: data
    }, 'low');
  }

  // Business logic events
  async logFinancialTransaction(type, amount, currency = 'CAD', reference = null) {
    await this.logEvent('financial_transaction', {
      data_type: 'financial_transaction',
      transaction_amount: amount,
      transaction_currency: currency,
      transaction_reference: reference,
      details: { transaction_type: type }
    }, 'medium');
  }

  async logComplianceEvent(regulation, event, status = 'compliant') {
    await this.logEvent('compliance_event', {
      compliance_regulation: regulation,
      compliance_status: status,
      data_action: event
    }, status === 'non_compliant' ? 'high' : 'low');
  }

  // Utility methods
  async logPageView(page, loadTime = null) {
    await this.logEvent('page_view', {
      component: page,
      page_load_time: loadTime,
      url: window.location.href
    }, 'low');
  }

  async logUserAction(action, component, details = {}) {
    await this.logEvent('user_action', {
      data_action: action,
      component,
      details
    }, 'low');
  }

  async logApiCall(endpoint, method, statusCode, duration = null) {
    await this.logEvent('api_call', {
      component: endpoint,
      data_action: method,
      details: {
        status_code: statusCode,
        duration
      }
    }, statusCode >= 400 ? 'medium' : 'low');
  }

  /**
   * Get stored security logs (local backup)
   * @returns {Array} Array of security events
   */
  getStoredLogs() {
    try {
      return JSON.parse(localStorage.getItem('tavari_security_logs') || '[]');
    } catch (error) {
      console.warn('Failed to retrieve stored security logs:', error);
      return [];
    }
  }

  /**
   * Clear stored security logs
   */
  clearStoredLogs() {
    try {
      localStorage.removeItem('tavari_security_logs');
    } catch (error) {
      console.warn('Failed to clear stored security logs:', error);
    }
  }

  /**
   * Update user and business context
   * @param {string} userId - New user ID
   * @param {string} businessId - New business ID
   */
  updateContext(userId, businessId) {
    this.userId = userId;
    this.businessId = businessId;
  }

  /**
   * End current session
   */
  async endSession() {
    await this.logEvent('session_end', {
      session_duration: Date.now() - parseInt(this.sessionId, 36)
    }, 'low');
    
    this.sessionId = null;
    this.initialized = false;
  }
}

// Create singleton instance and export as default
const securityAuditInstance = new SecurityAudit();

export default securityAuditInstance;