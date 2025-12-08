// Security/SecurityUtils.js - FIXED: Cached IP detection to stop console spam

class SecurityUtils {
  // Cache IP result to prevent repeated calls and console spam
  static _cachedIP = null;
  static _ipCacheTime = null;
  static _ipCacheExpiry = 5 * 60 * 1000; // 5 minutes
  
  /**
   * Input validation methods
   */
  
  static validateEmail(email) {
    if (!email || typeof email !== 'string') {
      return { valid: false, error: 'Email is required' };
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const maxLength = 254; // RFC 5321 limit
    
    if (email.length > maxLength) {
      return { valid: false, error: 'Email is too long' };
    }
    
    if (!emailRegex.test(email)) {
      return { valid: false, error: 'Invalid email format' };
    }
    
    // Check for suspicious patterns
    const suspiciousPatterns = [
      /[<>]/,  // HTML tags
      /javascript:/i,  // JavaScript protocol
      /data:/i,  // Data protocol
      /vbscript:/i,  // VBScript protocol
      /\s{10,}/,  // Excessive whitespace
    ];
    
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(email)) {
        return { valid: false, error: 'Email contains invalid characters' };
      }
    }
    
    return { valid: true };
  }
  
  static validatePassword(password) {
    if (!password || typeof password !== 'string') {
      return { valid: false, error: 'Password is required' };
    }
    
    const minLength = 8;
    const maxLength = 128;
    
    if (password.length < minLength) {
      return { valid: false, error: `Password must be at least ${minLength} characters` };
    }
    
    if (password.length > maxLength) {
      return { valid: false, error: `Password must not exceed ${maxLength} characters` };
    }
    
    // Check for common weak patterns
    const weakPatterns = [
      /^(.)\1{7,}$/,  // Repeated characters
      /^(012|123|234|345|456|567|678|789|890|abc|def|ghi|jkl|mno|pqr|stu|vwx|xyz)+$/i,  // Sequential characters
      /^(password|12345678|qwerty|admin|guest|user|test|demo)$/i,  // Common passwords
    ];
    
    for (const pattern of weakPatterns) {
      if (pattern.test(password)) {
        return { valid: false, error: 'Password is too weak' };
      }
    }
    
    return { valid: true };
  }
  
  static validatePhone(phone) {
    if (!phone) {
      return { valid: true }; // Phone is optional
    }
    
    if (typeof phone !== 'string') {
      return { valid: false, error: 'Phone must be a string' };
    }
    
    // Remove common formatting characters
    const cleaned = phone.replace(/[\s\-\(\)\+\.]/g, '');
    
    // Check if only digits remain
    if (!/^\d+$/.test(cleaned)) {
      return { valid: false, error: 'Phone number contains invalid characters' };
    }
    
    // Check length (international numbers can be 7-15 digits)
    if (cleaned.length < 7 || cleaned.length > 15) {
      return { valid: false, error: 'Phone number length is invalid' };
    }
    
    return { valid: true, cleaned };
  }
  
  static validateName(name, fieldName = 'Name') {
    if (!name || typeof name !== 'string') {
      return { valid: false, error: `${fieldName} is required` };
    }
    
    const trimmed = name.trim();
    
    if (trimmed.length === 0) {
      return { valid: false, error: `${fieldName} cannot be empty` };
    }
    
    if (trimmed.length > 100) {
      return { valid: false, error: `${fieldName} is too long` };
    }
    
    // Allow letters, spaces, hyphens, apostrophes, and common international characters
    const validNameRegex = /^[a-zA-Z\s\-'àáâäãåąčćęèéêëėįìíîïłńòóôöõøùúûüųūÿýżźñçčšžÀÁÂÄÃÅĄĆČĖĘÈÉÊËÌÍÎÏĮŁŃÒÓÔÖÕØÙÚÛÜŲŪŸÝŻŹÑßÇŒÆČŠŽ∂ð]+$/;
    
    if (!validNameRegex.test(trimmed)) {
      return { valid: false, error: `${fieldName} contains invalid characters` };
    }
    
    return { valid: true, cleaned: trimmed };
  }
  
  /**
   * String sanitization
   */
  
  static sanitizeString(input, options = {}) {
    if (typeof input !== 'string') {
      return '';
    }
    
    const {
      maxLength = 1000,
      allowHTML = false,
      allowSpecialChars = true
    } = options;
    
    let sanitized = input.trim();
    
    // Remove HTML if not allowed
    if (!allowHTML) {
      sanitized = sanitized.replace(/<[^>]*>/g, '');
    }
    
    // Remove special characters if not allowed
    if (!allowSpecialChars) {
      sanitized = sanitized.replace(/[^\w\s\-\.]/g, '');
    }
    
    // Truncate to max length
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
    }
    
    return sanitized;
  }
  
  static sanitizeNumeric(input) {
    if (typeof input === 'number') {
      return isFinite(input) ? input : null;
    }
    
    if (typeof input !== 'string') {
      return null;
    }
    
    // Remove non-numeric characters except decimal point and minus sign
    const cleaned = input.replace(/[^\d\.\-]/g, '');
    
    const number = parseFloat(cleaned);
    
    return isFinite(number) ? number : null;
  }
  
  /**
   * Security threat detection
   */
  
  static checkForXSS(input) {
    if (!input || typeof input !== 'string') {
      return { safe: true };
    }
    
    const xssPatterns = [
      /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
      /<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /<[^>]*on\w+[^>]*>/gi,
      /eval\s*\(/gi,
      /expression\s*\(/gi,
      /vbscript:/gi,
      /src\s*=\s*["']?data:/gi,
    ];
    
    for (const pattern of xssPatterns) {
      if (pattern.test(input)) {
        return {
          safe: false,
          threat: 'XSS',
          pattern: pattern.toString()
        };
      }
    }
    
    return { safe: true };
  }
  
  static checkForSQLInjection(input) {
    if (!input || typeof input !== 'string') {
      return { safe: true };
    }
    
    const sqlPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/gi,
      /(\b(UNION|OR|AND)\b.*\b(SELECT|INSERT|UPDATE|DELETE)\b)/gi,
      // Only match SQL comment pattern (--) not single dashes which are valid in emails/names
      /(\-\-)/gi,
      /((\%3D)|(=))[^\n]*((\%27)|(\')|(\-\-)|(\%3B)|(:))/gi,
      /(\w*)((\%27)|(\'))((\%6F)|o|(\%4F))((\%72)|r|(\%52))/gi,
      /((\%27)|(\'))union/gi,
      // Match single quotes that might be used for SQL injection (but allow apostrophes in names)
      /('.*(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|OR|AND).*')/gi,
    ];
    
    for (const pattern of sqlPatterns) {
      if (pattern.test(input)) {
        return {
          safe: false,
          threat: 'SQL_INJECTION',
          pattern: pattern.toString()
        };
      }
    }
    
    return { safe: true };
  }
  
  static checkForCommandInjection(input) {
    if (!input || typeof input !== 'string') {
      return { safe: true };
    }
    
    const commandPatterns = [
      /[;&|`$(){}[\]\\]/,
      /\b(cat|ls|pwd|whoami|id|uname|ps|netstat|ifconfig|ping|wget|curl|nc|telnet|ssh|ftp)\b/gi,
      /(\||&|;|`|\$\(|\$\{)/,
    ];
    
    for (const pattern of commandPatterns) {
      if (pattern.test(input)) {
        return {
          safe: false,
          threat: 'COMMAND_INJECTION',
          pattern: pattern.toString()
        };
      }
    }
    
    return { safe: true };
  }
  
  /**
   * FIXED: Network utilities with caching to prevent console spam
   */
  
  static async getClientIP() {
    try {
      // Check cache first
      const now = Date.now();
      if (this._cachedIP && this._ipCacheTime && (now - this._ipCacheTime < this._ipCacheExpiry)) {
        return this._cachedIP;
      }

      // Development environment detection - only log once
      if (process.env.NODE_ENV === 'development' || window.location.hostname === 'localhost') {
        const devIP = 'localhost';
        
        // Cache the result
        this._cachedIP = devIP;
        this._ipCacheTime = now;
        
        // Only log once per cache period
        if (!this._ipCacheTime || (now - this._ipCacheTime > this._ipCacheExpiry)) {
          console.log('Development environment detected, using localhost IP');
        }
        
        return devIP;
      }

      // Try multiple IP services for production with proper timeout
      const services = [
        'https://api.ipify.org?format=json',
        'https://ipapi.co/json/',
        'https://httpbin.org/ip',
      ];
      
      for (const service of services) {
        try {
          // Use AbortController for proper timeout handling
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
          
          const response = await fetch(service, { 
            signal: controller.signal,
            method: 'GET',
            mode: 'cors'
          });
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          
          const data = await response.json();
          
          // Different services return IP in different formats
          const ip = data.ip || data.origin || data.query;
          if (ip) {
            // Cache the result
            this._cachedIP = ip;
            this._ipCacheTime = now;
            return ip;
          }
        } catch (error) {
          if (error.name === 'AbortError') {
            console.warn(`IP service ${service} timed out`);
          } else {
            console.warn(`Failed to get IP from ${service}:`, error);
          }
          continue;
        }
      }
      
      // Fallback
      const fallbackIP = 'unknown';
      this._cachedIP = fallbackIP;
      this._ipCacheTime = now;
      return fallbackIP;
      
    } catch (error) {
      console.warn('Failed to get client IP:', error);
      const fallbackIP = 'unknown';
      this._cachedIP = fallbackIP;
      this._ipCacheTime = Date.now();
      return fallbackIP;
    }
  }
  
  static detectVPN() {
    // Basic VPN detection (not foolproof)
    const vpnIndicators = {
      suspiciousUserAgent: /vpn|proxy|tor|tunnel/i.test(navigator.userAgent),
      suspiciousTimezone: false,
      unusualScreenResolution: false,
      noWebRTC: !window.RTCPeerConnection,
    };
    
    // Check timezone vs expected location (requires location data)
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // This would need location data to properly validate
      vpnIndicators.suspiciousTimezone = false;
    } catch (error) {
      vpnIndicators.suspiciousTimezone = true;
    }
    
    // Check for unusual screen resolutions (common in VPS/VDI)
    const { width, height } = screen;
    const commonResolutions = [
      '1920x1080', '1366x768', '1536x864', '1440x900',
      '1280x720', '1600x900', '2560x1440', '3840x2160'
    ];
    
    vpnIndicators.unusualScreenResolution = !commonResolutions.includes(`${width}x${height}`);
    
    const suspiciousCount = Object.values(vpnIndicators).filter(Boolean).length;
    
    return {
      indicators: vpnIndicators,
      suspiciousCount,
      likely: suspiciousCount >= 2
    };
  }
  
  /**
   * Rate limiting utilities
   */
  
  static createRateLimiter(maxAttempts, windowMs) {
    const attempts = new Map();
    
    return {
      checkLimit: (identifier) => {
        const now = Date.now();
        const userAttempts = attempts.get(identifier) || [];
        
        // Remove old attempts outside the window
        const validAttempts = userAttempts.filter(
          timestamp => now - timestamp < windowMs
        );
        
        if (validAttempts.length >= maxAttempts) {
          return {
            allowed: false,
            remaining: 0,
            resetTime: Math.min(...validAttempts) + windowMs
          };
        }
        
        // Add current attempt
        validAttempts.push(now);
        attempts.set(identifier, validAttempts);
        
        return {
          allowed: true,
          remaining: maxAttempts - validAttempts.length,
          resetTime: now + windowMs
        };
      },
      
      reset: (identifier) => {
        attempts.delete(identifier);
      },
      
      clear: () => {
        attempts.clear();
      }
    };
  }
  
  /**
   * Session utilities
   */
  
  static generateSecureToken(length = 32) {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  
  static generateSessionId() {
    const timestamp = Date.now().toString(36);
    const randomPart = this.generateSecureToken(16);
    return `${timestamp}_${randomPart}`;
  }
  
  /**
   * Content Security Policy utilities
   */
  
  static setCSPNonce() {
    const nonce = this.generateSecureToken(16);
    
    // Add nonce to meta tag for server-side CSP
    let nonceTag = document.querySelector('meta[name="csp-nonce"]');
    if (!nonceTag) {
      nonceTag = document.createElement('meta');
      nonceTag.name = 'csp-nonce';
      document.head.appendChild(nonceTag);
    }
    nonceTag.content = nonce;
    
    return nonce;
  }
  
  /**
   * Security headers simulation (for client-side awareness)
   */
  
  static checkSecurityHeaders() {
    const headers = {
      'X-Frame-Options': false,
      'X-Content-Type-Options': false,
      'X-XSS-Protection': false,
      'Strict-Transport-Security': false,
      'Content-Security-Policy': false,
      'Referrer-Policy': false
    };
    
    // Check if security headers would be beneficial
    // (This is informational - headers must be set server-side)
    
    if (window.self !== window.top) {
      headers['X-Frame-Options'] = 'DENY needed - page in iframe';
    }
    
    if (location.protocol !== 'https:') {
      headers['Strict-Transport-Security'] = 'HTTPS needed';
    }
    
    return headers;
  }
  
  /**
   * Utility for secure data handling
   */
  
  static maskSensitiveData(data, fields = ['password', 'pin', 'ssn', 'creditCard']) {
    if (!data || typeof data !== 'object') {
      return data;
    }
    
    const masked = { ...data };
    
    for (const field of fields) {
      if (masked[field]) {
        const value = String(masked[field]);
        if (value.length > 4) {
          masked[field] = '*'.repeat(value.length - 4) + value.slice(-4);
        } else {
          masked[field] = '*'.repeat(value.length);
        }
      }
    }
    
    return masked;
  }
  
  static redactLogData(data) {
    const sensitiveFields = [
      'password', 'pin', 'ssn', 'social_security_number',
      'credit_card', 'creditcard', 'card_number',
      'security_code', 'cvv', 'cvc',
      'api_key', 'access_token', 'refresh_token',
      'private_key', 'secret'
    ];
    
    return this.maskSensitiveData(data, sensitiveFields);
  }
}

export default SecurityUtils;