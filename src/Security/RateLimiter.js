// Security/RateLimiter.js - Advanced Rate Limiting System with All Actions
import securityAudit from './SecurityAudit';

/**
 * Advanced rate limiting system for preventing abuse and brute force attacks
 * Supports multiple rate limiting strategies and automatic escalation
 */
class RateLimiter {
  constructor() {
    this.limiters = new Map();
    this.globalLimiters = new Map();
    this.escalationRules = new Map();
    this.whitelistedIPs = new Set();
    this.blacklistedIPs = new Set();
    this.suspiciousActivities = new Map();
  }

  /**
   * Create a rate limiter for a specific action
   * @param {string} action - Action identifier (e.g., 'login', 'api_call', 'password_reset')
   * @param {object} config - Rate limiter configuration
   */
  createLimiter(action, config) {
    const defaultConfig = {
      maxAttempts: 5,
      windowMs: 15 * 60 * 1000, // 15 minutes
      blockDurationMs: 15 * 60 * 1000, // 15 minutes
      escalationEnabled: true,
      trackGlobally: true,
      bypassWhitelist: true,
      strictMode: false
    };

    const limiterConfig = { ...defaultConfig, ...config };
    
    this.limiters.set(action, {
      config: limiterConfig,
      attempts: new Map(), // identifier -> attempts array
      blocked: new Map(), // identifier -> block info
      globalAttempts: [], // global attempts for pattern detection
      stats: {
        totalAttempts: 0,
        totalBlocks: 0,
        lastReset: Date.now()
      }
    });

    // Set up escalation rules if enabled
    if (limiterConfig.escalationEnabled) {
      this.setupEscalationRules(action, limiterConfig);
    }

    return this.limiters.get(action);
  }

  /**
   * Set up escalation rules for progressive penalties
   * @param {string} action - Action identifier
   * @param {object} config - Limiter configuration
   */
  setupEscalationRules(action, config) {
    const escalationLevels = [
      {
        level: 1,
        triggerCount: config.maxAttempts,
        blockDuration: config.blockDurationMs,
        description: 'Initial rate limit'
      },
      {
        level: 2,
        triggerCount: config.maxAttempts * 2,
        blockDuration: config.blockDurationMs * 2,
        description: 'Escalated rate limit'
      },
      {
        level: 3,
        triggerCount: config.maxAttempts * 3,
        blockDuration: config.blockDurationMs * 4,
        description: 'High-risk activity detected'
      },
      {
        level: 4,
        triggerCount: config.maxAttempts * 5,
        blockDuration: config.blockDurationMs * 8,
        description: 'Potential attack - extended block'
      },
      {
        level: 5,
        triggerCount: config.maxAttempts * 10,
        blockDuration: 24 * 60 * 60 * 1000, // 24 hours
        description: 'Persistent abuse - long-term block'
      }
    ];

    this.escalationRules.set(action, escalationLevels);
  }

  /**
   * Check if an action is allowed for a specific identifier
   * @param {string} action - Action being performed
   * @param {string} identifier - Unique identifier (IP, user ID, email, etc.)
   * @param {object} context - Additional context (user agent, location, etc.)
   * @returns {object} Rate limit result
   */
  async checkLimit(action, identifier, context = {}) {
    const limiter = this.limiters.get(action);
    if (!limiter) {
      console.warn(`Rate limiter not found for action: ${action}`);
      return { allowed: true, reason: 'no_limiter' };
    }

    const now = Date.now();
    const { config } = limiter;

    // Check IP blacklist
    if (context.ip && this.blacklistedIPs.has(context.ip)) {
      await securityAudit.logEvent('rate_limit_blacklist_hit', {
        component: action,
        rate_limit_identifier: identifier,
        ip_address: context.ip,
        details: { reason: 'IP blacklisted' }
      }, 'high');
      
      return {
        allowed: false,
        reason: 'blacklisted',
        message: 'Access denied from this location',
        retryAfter: null
      };
    }

    // Check IP whitelist bypass
    if (config.bypassWhitelist && context.ip && this.whitelistedIPs.has(context.ip)) {
      return { allowed: true, reason: 'whitelisted' };
    }

    // Check if currently blocked
    const blockInfo = limiter.blocked.get(identifier);
    if (blockInfo && now < blockInfo.blockedUntil) {
      const remainingTime = blockInfo.blockedUntil - now;
      
      await securityAudit.logEvent('rate_limit_block_active', {
        component: action,
        rate_limit_identifier: identifier,
        rate_limit_block_level: blockInfo.level,
        rate_limit_block_duration: remainingTime,
        details: { originalReason: blockInfo.reason }
      }, 'medium');

      return {
        allowed: false,
        reason: 'rate_limited',
        message: `Too many attempts. Try again in ${Math.ceil(remainingTime / 1000)} seconds.`,
        retryAfter: new Date(blockInfo.blockedUntil),
        blockLevel: blockInfo.level,
        remainingMs: remainingTime
      };
    }

    // Get current attempts
    const attempts = limiter.attempts.get(identifier) || [];
    const windowStart = now - config.windowMs;
    
    // Filter attempts within current window
    const validAttempts = attempts.filter(attempt => attempt.timestamp > windowStart);
    
    // Check if limit exceeded
    if (validAttempts.length >= config.maxAttempts) {
      // Calculate escalation level
      const totalAttempts = attempts.length;
      const escalationLevel = this.calculateEscalationLevel(action, totalAttempts);
      const blockDuration = this.getBlockDuration(action, escalationLevel);
      const blockedUntil = now + blockDuration;

      // Block the identifier
      limiter.blocked.set(identifier, {
        blockedAt: now,
        blockedUntil,
        level: escalationLevel,
        reason: `Rate limit exceeded (${validAttempts.length}/${config.maxAttempts})`,
        attempts: totalAttempts
      });

      // Update stats
      limiter.stats.totalBlocks++;

      // Log security event
      await securityAudit.logEvent('rate_limit_exceeded', {
        component: action,
        rate_limit_identifier: identifier,
        rate_limit_attempts: validAttempts.length,
        rate_limit_max_attempts: config.maxAttempts,
        rate_limit_block_level: escalationLevel,
        rate_limit_block_duration: blockDuration,
        details: context
      }, escalationLevel >= 3 ? 'high' : 'medium');

      // Check for suspicious patterns
      await this.analyzeAttackPatterns(action, identifier, context);

      return {
        allowed: false,
        reason: 'rate_limited',
        message: `Rate limit exceeded. Blocked for ${Math.ceil(blockDuration / 1000)} seconds.`,
        retryAfter: new Date(blockedUntil),
        blockLevel: escalationLevel,
        remainingMs: blockDuration,
        attemptsUsed: validAttempts.length,
        maxAttempts: config.maxAttempts
      };
    }

    // Allow the action
    return {
      allowed: true,
      reason: 'within_limits',
      remaining: config.maxAttempts - validAttempts.length,
      resetTime: new Date(windowStart + config.windowMs),
      windowMs: config.windowMs
    };
  }

  /**
   * Record an attempt (successful or failed)
   * @param {string} action - Action performed
   * @param {string} identifier - Identifier
   * @param {boolean} successful - Whether attempt was successful
   * @param {object} context - Additional context
   */
  async recordAttempt(action, identifier, successful = false, context = {}) {
    const limiter = this.limiters.get(action);
    if (!limiter) return;

    const now = Date.now();
    const attempts = limiter.attempts.get(identifier) || [];
    
    const attemptRecord = {
      timestamp: now,
      successful,
      context: {
        userAgent: context.userAgent,
        ip: context.ip,
        location: context.location,
        deviceFingerprint: context.deviceFingerprint
      }
    };

    attempts.push(attemptRecord);
    limiter.attempts.set(identifier, attempts);

    // Track globally for pattern analysis
    if (limiter.config.trackGlobally) {
      limiter.globalAttempts.push({
        ...attemptRecord,
        identifier,
        action
      });
    }

    // Update stats
    limiter.stats.totalAttempts++;

    // If successful, clear the identifier's attempts (reset counter)
    if (successful) {
      this.reset(action, identifier);
    }

    // Clean up old attempts periodically
    if (attempts.length > 100) {
      this.cleanupOldAttempts(action, identifier);
    }
  }

  /**
   * Calculate escalation level based on attempt history
   * @param {string} action - Action
   * @param {number} totalAttempts - Total attempts by identifier
   * @returns {number} Escalation level
   */
  calculateEscalationLevel(action, totalAttempts) {
    const escalationRules = this.escalationRules.get(action);
    if (!escalationRules) return 1;

    for (let i = escalationRules.length - 1; i >= 0; i--) {
      if (totalAttempts >= escalationRules[i].triggerCount) {
        return escalationRules[i].level;
      }
    }

    return 1;
  }

  /**
   * Get block duration based on escalation level
   * @param {string} action - Action
   * @param {number} level - Escalation level
   * @returns {number} Block duration in milliseconds
   */
  getBlockDuration(action, level) {
    const escalationRules = this.escalationRules.get(action);
    if (!escalationRules) {
      const limiter = this.limiters.get(action);
      return limiter ? limiter.config.blockDurationMs : 15 * 60 * 1000;
    }

    const rule = escalationRules.find(r => r.level === level);
    return rule ? rule.blockDuration : escalationRules[0].blockDuration;
  }

  /**
   * Analyze attack patterns and update security measures
   * @param {string} action - Action
   * @param {string} identifier - Identifier
   * @param {object} context - Context
   */
  async analyzeAttackPatterns(action, identifier, context) {
    const limiter = this.limiters.get(action);
    if (!limiter) return;

    const now = Date.now();
    const windowMs = 60 * 60 * 1000; // 1 hour window
    const recentAttempts = limiter.globalAttempts.filter(
      attempt => now - attempt.timestamp < windowMs
    );

    // Check for distributed attacks (many IPs)
    if (context.ip) {
      const uniqueIPs = new Set(
        recentAttempts
          .filter(attempt => attempt.context.ip)
          .map(attempt => attempt.context.ip)
      );

      if (uniqueIPs.size > 50 && recentAttempts.length > 500) {
        await securityAudit.logEvent('distributed_attack_detected', {
          component: action,
          threat_type: 'distributed_attack',
          attack_pattern: 'multiple_ips',
          threat_details: {
            uniqueIPs: uniqueIPs.size,
            totalAttempts: recentAttempts.length,
            timeWindowMs: windowMs
          }
        }, 'critical');
      }
    }

    // Check for credential stuffing (same user agent, different identifiers)
    if (context.userAgent) {
      const sameUserAgentAttempts = recentAttempts.filter(
        attempt => attempt.context.userAgent === context.userAgent
      );
      
      const uniqueIdentifiers = new Set(
        sameUserAgentAttempts.map(attempt => attempt.identifier)
      );

      if (uniqueIdentifiers.size > 20 && sameUserAgentAttempts.length > 100) {
        await securityAudit.logEvent('credential_stuffing_detected', {
          component: action,
          threat_type: 'credential_stuffing',
          attack_pattern: 'same_user_agent_multiple_identifiers',
          user_agent: context.userAgent,
          threat_details: {
            uniqueIdentifiers: uniqueIdentifiers.size,
            attempts: sameUserAgentAttempts.length
          }
        }, 'high');

        // Consider blacklisting the IP
        if (context.ip) {
          this.addToBlacklist(context.ip, 'credential_stuffing', 24 * 60 * 60 * 1000);
        }
      }
    }

    // Check for concentrated attacks (single IP, many attempts)
    if (context.ip) {
      const sameIPAttempts = recentAttempts.filter(
        attempt => attempt.context.ip === context.ip
      );

      if (sameIPAttempts.length > 200) {
        await securityAudit.logEvent('concentrated_attack_detected', {
          component: action,
          threat_type: 'concentrated_attack',
          attack_pattern: 'single_ip_high_volume',
          ip_address: context.ip,
          threat_details: {
            attempts: sameIPAttempts.length,
            timeWindowMs: windowMs
          }
        }, 'high');

        // Blacklist aggressive IPs
        this.addToBlacklist(context.ip, 'concentrated_attack', 24 * 60 * 60 * 1000);
      }
    }
  }

  /**
   * Reset rate limiting for an identifier
   * @param {string} action - Action
   * @param {string} identifier - Identifier
   */
  reset(action, identifier) {
    const limiter = this.limiters.get(action);
    if (!limiter) return;

    limiter.attempts.delete(identifier);
    limiter.blocked.delete(identifier);
  }

  /**
   * Add IP to blacklist
   * @param {string} ip - IP address
   * @param {string} reason - Reason for blacklisting
   * @param {number} durationMs - Duration in milliseconds
   */
  addToBlacklist(ip, reason, durationMs = 24 * 60 * 60 * 1000) {
    this.blacklistedIPs.add(ip);
    
    // Auto-remove after duration
    setTimeout(() => {
      this.blacklistedIPs.delete(ip);
      securityAudit.logEvent('ip_blacklist_expired', { 
        ip_address: ip, 
        details: { reason }
      }, 'low');
    }, durationMs);

    securityAudit.logEvent('ip_blacklisted', { 
      ip_address: ip, 
      details: { 
        reason, 
        durationMs,
        expiresAt: new Date(Date.now() + durationMs)
      }
    }, 'high');
  }

  /**
   * Add IP to whitelist
   * @param {string} ip - IP address
   */
  addToWhitelist(ip) {
    this.whitelistedIPs.add(ip);
    securityAudit.logEvent('ip_whitelisted', { ip_address: ip }, 'low');
  }

  /**
   * Remove IP from blacklist
   * @param {string} ip - IP address
   */
  removeFromBlacklist(ip) {
    this.blacklistedIPs.delete(ip);
    securityAudit.logEvent('ip_blacklist_removed', { ip_address: ip }, 'low');
  }

  /**
   * Remove IP from whitelist
   * @param {string} ip - IP address
   */
  removeFromWhitelist(ip) {
    this.whitelistedIPs.delete(ip);
    securityAudit.logEvent('ip_whitelist_removed', { ip_address: ip }, 'low');
  }

  /**
   * Clean up old attempts to prevent memory buildup
   * @param {string} action - Action
   * @param {string} identifier - Identifier
   */
  cleanupOldAttempts(action, identifier) {
    const limiter = this.limiters.get(action);
    if (!limiter) return;

    const now = Date.now();
    const maxAge = limiter.config.windowMs * 5; // Keep 5 windows worth of data
    
    const attempts = limiter.attempts.get(identifier) || [];
    const validAttempts = attempts.filter(
      attempt => now - attempt.timestamp < maxAge
    );
    
    limiter.attempts.set(identifier, validAttempts);

    // Clean up global attempts
    limiter.globalAttempts = limiter.globalAttempts.filter(
      attempt => now - attempt.timestamp < maxAge
    );

    // Clean up expired blocks
    for (const [id, blockInfo] of limiter.blocked.entries()) {
      if (now > blockInfo.blockedUntil) {
        limiter.blocked.delete(id);
      }
    }
  }

  /**
   * Get rate limiting statistics
   * @param {string} action - Action (optional, returns all if not specified)
   * @returns {object} Statistics
   */
  getStats(action = null) {
    if (action) {
      const limiter = this.limiters.get(action);
      if (!limiter) return null;

      const now = Date.now();
      const activeBlocks = Array.from(limiter.blocked.values()).filter(
        block => now < block.blockedUntil
      ).length;

      const recentAttempts = limiter.globalAttempts.filter(
        attempt => now - attempt.timestamp < 60 * 60 * 1000 // Last hour
      ).length;

      return {
        action,
        config: limiter.config,
        stats: {
          ...limiter.stats,
          activeBlocks,
          recentAttempts,
          totalIdentifiers: limiter.attempts.size
        }
      };
    }

    // Return stats for all actions
    const allStats = {};
    for (const [actionName, limiter] of this.limiters.entries()) {
      allStats[actionName] = this.getStats(actionName);
    }

    return {
      global: {
        totalActions: this.limiters.size,
        blacklistedIPs: this.blacklistedIPs.size,
        whitelistedIPs: this.whitelistedIPs.size
      },
      actions: allStats
    };
  }

  /**
   * Get blocked identifiers for an action
   * @param {string} action - Action
   * @returns {Array} List of blocked identifiers with details
   */
  getBlockedIdentifiers(action) {
    const limiter = this.limiters.get(action);
    if (!limiter) return [];

    const now = Date.now();
    const blocked = [];

    for (const [identifier, blockInfo] of limiter.blocked.entries()) {
      if (now < blockInfo.blockedUntil) {
        blocked.push({
          identifier,
          blockedAt: new Date(blockInfo.blockedAt),
          blockedUntil: new Date(blockInfo.blockedUntil),
          remainingMs: blockInfo.blockedUntil - now,
          level: blockInfo.level,
          reason: blockInfo.reason,
          totalAttempts: blockInfo.attempts
        });
      }
    }

    return blocked.sort((a, b) => b.blockedAt - a.blockedAt);
  }

  /**
   * Manually block an identifier
   * @param {string} action - Action
   * @param {string} identifier - Identifier to block
   * @param {number} durationMs - Block duration
   * @param {string} reason - Reason for manual block
   */
  async manualBlock(action, identifier, durationMs, reason = 'Manual block') {
    const limiter = this.limiters.get(action);
    if (!limiter) return false;

    const now = Date.now();
    limiter.blocked.set(identifier, {
      blockedAt: now,
      blockedUntil: now + durationMs,
      level: 999, // Manual block level
      reason: `Manual: ${reason}`,
      attempts: 0
    });

    await securityAudit.logEvent('manual_rate_limit_block', {
      component: action,
      rate_limit_identifier: identifier,
      rate_limit_block_duration: durationMs,
      details: {
        reason,
        blockedUntil: new Date(now + durationMs)
      }
    }, 'medium');

    return true;
  }

  /**
   * Manually unblock an identifier
   * @param {string} action - Action
   * @param {string} identifier - Identifier to unblock
   * @param {string} reason - Reason for manual unblock
   */
  async manualUnblock(action, identifier, reason = 'Manual unblock') {
    const limiter = this.limiters.get(action);
    if (!limiter) return false;

    const wasBlocked = limiter.blocked.has(identifier);
    limiter.blocked.delete(identifier);
    limiter.attempts.delete(identifier);

    if (wasBlocked) {
      await securityAudit.logEvent('manual_rate_limit_unblock', {
        component: action,
        rate_limit_identifier: identifier,
        details: { reason }
      }, 'low');
    }

    return wasBlocked;
  }

  /**
   * Configure rate limiting for common Tavari actions
   */
  setupDefaultLimiters() {
    // Login attempts
    this.createLimiter('login', {
      maxAttempts: 5,
      windowMs: 15 * 60 * 1000, // 15 minutes
      blockDurationMs: 15 * 60 * 1000, // 15 minutes
      escalationEnabled: true,
      strictMode: true
    });

    // User registration
    this.createLimiter('user_registration', {
      maxAttempts: 3,
      windowMs: 60 * 60 * 1000, // 1 hour
      blockDurationMs: 60 * 60 * 1000, // 1 hour
      escalationEnabled: true,
      strictMode: true
    });

    // Password reset attempts
    this.createLimiter('password_reset', {
      maxAttempts: 3,
      windowMs: 60 * 60 * 1000, // 1 hour
      blockDurationMs: 60 * 60 * 1000, // 1 hour
      escalationEnabled: true
    });

    // API calls (general)
    this.createLimiter('api_call', {
      maxAttempts: 100,
      windowMs: 60 * 1000, // 1 minute
      blockDurationMs: 60 * 1000, // 1 minute
      escalationEnabled: false
    });

    // File uploads
    this.createLimiter('file_upload', {
      maxAttempts: 10,
      windowMs: 60 * 1000, // 1 minute
      blockDurationMs: 5 * 60 * 1000, // 5 minutes
      escalationEnabled: true
    });

    // Ad test play (Music Ad Manager)
    this.createLimiter('ad_test_play', {
      maxAttempts: 10,
      windowMs: 60 * 1000, // 1 minute
      blockDurationMs: 60 * 1000, // 1 minute
      escalationEnabled: false
    });

    // Email sending
    this.createLimiter('email_send', {
      maxAttempts: 50,
      windowMs: 60 * 60 * 1000, // 1 hour
      blockDurationMs: 60 * 60 * 1000, // 1 hour
      escalationEnabled: true
    });
    this.createLimiter('email_receipt', {
      maxAttempts: 5,
      windowMs: 60 * 1000, // 1 minute
      blockDurationMs: 5 * 60 * 1000, // 5 minutes
      escalationEnabled: true
    });
    this.createLimiter('load_campaign', {
      maxAttempts: 30,
      windowMs: 60 * 1000, // 1 minute
      blockDurationMs: 5 * 60 * 1000, // 5 minutes
      escalationEnabled: false
    });
    this.createLimiter('load_campaigns', {
      maxAttempts: 30,
      windowMs: 60 * 1000, // 1 minute
      blockDurationMs: 5 * 60 * 1000, // 5 minutes
      escalationEnabled: false
    });
    this.createLimiter('load_settings', {
      maxAttempts: 15,
      windowMs: 60 * 1000, // 1 minute
      blockDurationMs: 60 * 1000, // 1 minute
      escalationEnabled: false
    });
    this.createLimiter('save_mail_settings', {
      maxAttempts: 5,
      windowMs: 60 * 1000, // 1 minute
      blockDurationMs: 2 * 60 * 1000, // 2 minutes
      escalationEnabled: false
    });
    this.createLimiter('save_pos_settings', {
      maxAttempts: 10,
      windowMs: 60 * 1000,
      blockDurationMs: 60 * 1000,
      escalationEnabled: false
    });
    this.createLimiter('load_dashboard_stats', {
      maxAttempts: 30,
      windowMs: 60 * 1000, // 1 minute
      blockDurationMs: 60 * 1000, // 1 minute
      escalationEnabled: false
    });
    this.createLimiter('load_contact_stats', {
      maxAttempts: 30,
      windowMs: 60 * 1000, // 1 minute
      blockDurationMs: 60 * 1000, // 1 minute
      escalationEnabled: false
    });
    this.createLimiter('send_test_email', {
      maxAttempts: 5,
      windowMs: 15 * 60 * 1000, // 15 minutes
      blockDurationMs: 30 * 60 * 1000, // 30 minutes
      escalationEnabled: true
    });
    this.createLimiter('send_campaign', {
      maxAttempts: 3,
      windowMs: 5 * 60 * 1000, // 5 minutes
      blockDurationMs: 5 * 60 * 1000, // 5 minutes
      escalationEnabled: false
    });

    // SMS sending
    this.createLimiter('sms_send', {
      maxAttempts: 10,
      windowMs: 60 * 60 * 1000, // 1 hour
      blockDurationMs: 60 * 60 * 1000, // 1 hour
      escalationEnabled: true
    });

    // Database export operations
    this.createLimiter('data_export', {
      maxAttempts: 5,
      windowMs: 60 * 60 * 1000, // 1 hour
      blockDurationMs: 60 * 60 * 1000, // 1 hour
      escalationEnabled: true
    });

    // Report generation and delivery
    this.createLimiter('generate_report', {
      maxAttempts: 20,
      windowMs: 60 * 1000, // 1 minute
      blockDurationMs: 60 * 1000, // 1 minute
      escalationEnabled: false
    });
    this.createLimiter('export_report', {
      maxAttempts: 5,
      windowMs: 60 * 1000, // 1 minute
      blockDurationMs: 5 * 60 * 1000, // 5 minutes
      escalationEnabled: true
    });
    this.createLimiter('email_report', {
      maxAttempts: 3,
      windowMs: 60 * 1000, // 1 minute
      blockDurationMs: 5 * 60 * 1000, // 5 minutes
      escalationEnabled: true
    });

    // Account creation
    this.createLimiter('account_creation', {
      maxAttempts: 3,
      windowMs: 60 * 60 * 1000, // 1 hour
      blockDurationMs: 24 * 60 * 60 * 1000, // 24 hours
      escalationEnabled: true
    });

    // Business creation - More lenient limits
    this.createLimiter('create_business', {
      maxAttempts: 10, // Allow 10 attempts
      windowMs: 60 * 60 * 1000, // 1 hour window
      blockDurationMs: 15 * 60 * 1000, // 15 minute block
      escalationEnabled: false, // Don't escalate for business creation
      strictMode: false
    });

    // Payment processing
    this.createLimiter('payment_process', {
      maxAttempts: 3,
      windowMs: 30 * 60 * 1000, // 30 minutes
      blockDurationMs: 60 * 60 * 1000, // 1 hour
      escalationEnabled: true,
      strictMode: true
    });

    // Search operations (to prevent scraping)
    this.createLimiter('search', {
      maxAttempts: 60,
      windowMs: 60 * 1000, // 1 minute
      blockDurationMs: 60 * 1000, // 1 minute
      escalationEnabled: false
    });

    // ===== PAYROLL & HR SPECIFIC RATE LIMITERS =====
    
    // Employee payroll calculations (high volume, low restriction)
    this.createLimiter('calculate_employee_pay', {
      maxAttempts: 200,
      windowMs: 5 * 60 * 1000, // 5 minutes
      blockDurationMs: 1 * 60 * 1000, // 1 minute
      escalationEnabled: false,
      trackGlobally: false,
      strictMode: false
    });

    // Load payroll data
    this.createLimiter('load_payroll_data', {
      maxAttempts: 50,
      windowMs: 5 * 60 * 1000, // 5 minutes
      blockDurationMs: 2 * 60 * 1000, // 2 minutes
      escalationEnabled: false,
      trackGlobally: false
    });

    // Initialize payroll settings
    this.createLimiter('initialize_settings', {
      maxAttempts: 10,
      windowMs: 15 * 60 * 1000, // 15 minutes
      blockDurationMs: 5 * 60 * 1000, // 5 minutes
      escalationEnabled: true
    });

    // Update payroll settings
    this.createLimiter('update_settings', {
      maxAttempts: 20,
      windowMs: 10 * 60 * 1000, // 10 minutes
      blockDurationMs: 5 * 60 * 1000, // 5 minutes
      escalationEnabled: true
    });

    // Update employee premiums
    this.createLimiter('update_premium', {
      maxAttempts: 30,
      windowMs: 10 * 60 * 1000, // 10 minutes
      blockDurationMs: 2 * 60 * 1000, // 2 minutes
      escalationEnabled: false
    });

    // Edit finalized payroll (sensitive operation)
    this.createLimiter('edit_finalized_payroll', {
      maxAttempts: 15,
      windowMs: 30 * 60 * 1000, // 30 minutes
      blockDurationMs: 10 * 60 * 1000, // 10 minutes
      escalationEnabled: true,
      strictMode: true
    });

    // Delete finalized payroll runs (highly sensitive)
    this.createLimiter('delete_payroll_run', {
      maxAttempts: 3,
      windowMs: 60 * 60 * 1000, // 1 hour
      blockDurationMs: 30 * 60 * 1000, // 30 minutes
      escalationEnabled: true,
      strictMode: true
    });

    // Generate pay statements
    this.createLimiter('generate_pay_statement', {
      maxAttempts: 100,
      windowMs: 10 * 60 * 1000, // 10 minutes
      blockDurationMs: 5 * 60 * 1000, // 5 minutes
      escalationEnabled: false
    });

    // Bulk pay statement generation
    this.createLimiter('bulk_pay_statements', {
      maxAttempts: 5,
      windowMs: 30 * 60 * 1000, // 30 minutes
      blockDurationMs: 15 * 60 * 1000, // 15 minutes
      escalationEnabled: true
    });

    // YTD calculations
    this.createLimiter('calculate_ytd', {
      maxAttempts: 50,
      windowMs: 10 * 60 * 1000, // 10 minutes
      blockDurationMs: 2 * 60 * 1000, // 2 minutes
      escalationEnabled: false
    });

    // Tax calculations
    this.createLimiter('calculate_taxes', {
      maxAttempts: 100,
      windowMs: 5 * 60 * 1000, // 5 minutes
      blockDurationMs: 1 * 60 * 1000, // 1 minute
      escalationEnabled: false
    });

    // ROE/T4 report generation
    this.createLimiter('generate_roe_t4', {
      maxAttempts: 10,
      windowMs: 60 * 60 * 1000, // 1 hour
      blockDurationMs: 15 * 60 * 1000, // 15 minutes
      escalationEnabled: true
    });

    // Payroll import operations
    this.createLimiter('payroll_import', {
      maxAttempts: 5,
      windowMs: 60 * 60 * 1000, // 1 hour
      blockDurationMs: 30 * 60 * 1000, // 30 minutes
      escalationEnabled: true
    });

    // Employee management operations
    this.createLimiter('employee_management', {
      maxAttempts: 50,
      windowMs: 15 * 60 * 1000, // 15 minutes
      blockDurationMs: 5 * 60 * 1000, // 5 minutes
      escalationEnabled: true
    });

    // Create employee (sensitive operation)
    this.createLimiter('create_employee', {
      maxAttempts: 10,
      windowMs: 15 * 60 * 1000, // 15 minutes
      blockDurationMs: 5 * 60 * 1000, // 5 minutes
      escalationEnabled: true,
      strictMode: true
    });

    // Sensitive employee data access
    this.createLimiter('employee_sensitive_data', {
      maxAttempts: 30,
      windowMs: 30 * 60 * 1000, // 30 minutes
      blockDurationMs: 15 * 60 * 1000, // 15 minutes
      escalationEnabled: true,
      strictMode: true
    });

    // ===== EMPLOYEE SCREEN ACTIONS =====
    
    // Employee data access (main list loading)
    this.createLimiter('employee_data_access', {
      maxAttempts: 30,
      windowMs: 10 * 60 * 1000, // 10 minutes
      blockDurationMs: 5 * 60 * 1000, // 5 minutes
      escalationEnabled: true,
      strictMode: false
    });

    // View individual employee details
    this.createLimiter('view_employee_details', {
      maxAttempts: 50,
      windowMs: 10 * 60 * 1000, // 10 minutes
      blockDurationMs: 2 * 60 * 1000, // 2 minutes
      escalationEnabled: false,
      strictMode: false
    });

    // Edit employee information
    this.createLimiter('edit_employee', {
      maxAttempts: 20,
      windowMs: 15 * 60 * 1000, // 15 minutes
      blockDurationMs: 5 * 60 * 1000, // 5 minutes
      escalationEnabled: true,
      strictMode: true
    });

    // Save employee changes
    this.createLimiter('save_employee', {
      maxAttempts: 15,
      windowMs: 10 * 60 * 1000, // 10 minutes
      blockDurationMs: 3 * 60 * 1000, // 3 minutes
      escalationEnabled: true,
      strictMode: true
    });

    // Delete employee operations (highly sensitive)
    this.createLimiter('delete_employee', {
      maxAttempts: 5,
      windowMs: 60 * 60 * 1000, // 1 hour
      blockDurationMs: 30 * 60 * 1000, // 30 minutes
      escalationEnabled: true,
      strictMode: true
    });

    // EmployeeEditor: terminate (distinct from delete / remove from business)
    this.createLimiter('employee_terminate', {
      maxAttempts: 8,
      windowMs: 15 * 60 * 1000, // 15 minutes
      blockDurationMs: 5 * 60 * 1000, // 5 minutes
      escalationEnabled: true,
      strictMode: true
    });

    // EmployeeEditor: manager PIN reset for another employee
    this.createLimiter('pin_reset', {
      maxAttempts: 10,
      windowMs: 15 * 60 * 1000, // 15 minutes
      blockDurationMs: 5 * 60 * 1000, // 5 minutes
      escalationEnabled: true,
      strictMode: true
    });

    // EmployeeEditModal: save / update from modal (checkRateLimit key)
    this.createLimiter('employee_update', {
      maxAttempts: 20,
      windowMs: 10 * 60 * 1000, // 10 minutes
      blockDurationMs: 3 * 60 * 1000, // 3 minutes
      escalationEnabled: true,
      strictMode: true
    });

    // Navigate to add employee
    this.createLimiter('navigate_add_employee', {
      maxAttempts: 10,
      windowMs: 5 * 60 * 1000, // 5 minutes
      blockDurationMs: 1 * 60 * 1000, // 1 minute
      escalationEnabled: false,
      strictMode: false
    });

    // EmployeeScreen: open add-employee modal
    this.createLimiter('add_employee_modal', {
      maxAttempts: 10,
      windowMs: 5 * 60 * 1000, // 5 minutes
      blockDurationMs: 1 * 60 * 1000, // 1 minute
      escalationEnabled: false,
      strictMode: false
    });

    // EmployeeScreen: row click / view details rate limit key
    this.createLimiter('employee_view', {
      maxAttempts: 30,
      windowMs: 10 * 60 * 1000, // 10 minutes
      blockDurationMs: 2 * 60 * 1000, // 2 minutes
      escalationEnabled: false,
      strictMode: false
    });

    // EmployeeScreen: fix auth modal
    this.createLimiter('fix_auth_modal', {
      maxAttempts: 5,
      windowMs: 5 * 60 * 1000, // 5 minutes
      blockDurationMs: 2 * 60 * 1000, // 2 minutes
      escalationEnabled: true,
      strictMode: true
    });

    // Open lieu time modal
    this.createLimiter('open_lieu_time_modal', {
      maxAttempts: 25,
      windowMs: 10 * 60 * 1000, // 10 minutes
      blockDurationMs: 2 * 60 * 1000, // 2 minutes
      escalationEnabled: false,
      strictMode: false
    });

    // Lieu time manual entry
    this.createLimiter('lieu_time_manual_entry', {
      maxAttempts: 20,
      windowMs: 15 * 60 * 1000, // 15 minutes
      blockDurationMs: 5 * 60 * 1000, // 5 minutes
      escalationEnabled: true,
      strictMode: true
    });

    // Employee search operations
    this.createLimiter('employee_search', {
      maxAttempts: 100,
      windowMs: 5 * 60 * 1000, // 5 minutes
      blockDurationMs: 1 * 60 * 1000, // 1 minute
      escalationEnabled: false,
      strictMode: false
    });

    // Employee profile updates
    this.createLimiter('employee_profile_update', {
      maxAttempts: 25,
      windowMs: 15 * 60 * 1000, // 15 minutes
      blockDurationMs: 5 * 60 * 1000, // 5 minutes
      escalationEnabled: true,
      strictMode: true
    });

    // ===== SETTINGS SCREEN ACTIONS =====
    
    // Settings save operations
    this.createLimiter('settings_save', {
      maxAttempts: 10,
      windowMs: 60 * 1000, // 1 minute
      blockDurationMs: 5 * 60 * 1000, // 5 minutes
      escalationEnabled: true,
      strictMode: false
    });

    // Business settings access
    this.createLimiter('settings_access', {
      maxAttempts: 30,
      windowMs: 5 * 60 * 1000, // 5 minutes
      blockDurationMs: 2 * 60 * 1000, // 2 minutes
      escalationEnabled: false,
      strictMode: false
    });

    // Settings validation
    this.createLimiter('settings_validation', {
      maxAttempts: 50,
      windowMs: 5 * 60 * 1000, // 5 minutes
      blockDurationMs: 1 * 60 * 1000, // 1 minute
      escalationEnabled: false,
      strictMode: false
    });

    // Tavari Pay onboarding
    this.createLimiter('tavari_pay_onboarding', {
      maxAttempts: 3,
      windowMs: 60 * 60 * 1000, // 1 hour
      blockDurationMs: 60 * 60 * 1000, // 1 hour
      escalationEnabled: true,
      strictMode: true
    });

    // Tavari Pay link generation
    this.createLimiter('tavari_pay_link_generation', {
      maxAttempts: 5,
      windowMs: 30 * 60 * 1000, // 30 minutes
      blockDurationMs: 15 * 60 * 1000, // 15 minutes
      escalationEnabled: true,
      strictMode: false
    });

    // Tavari Pay status checks
    this.createLimiter('tavari_pay_status_check', {
      maxAttempts: 20,
      windowMs: 5 * 60 * 1000, // 5 minutes
      blockDurationMs: 2 * 60 * 1000, // 2 minutes
      escalationEnabled: false,
      strictMode: false
    });

    // Role management operations
    this.createLimiter('role_management', {
      maxAttempts: 30,
      windowMs: 10 * 60 * 1000, // 10 minutes
      blockDurationMs: 5 * 60 * 1000, // 5 minutes
      escalationEnabled: true,
      strictMode: true
    });

    // Holiday hours management
    this.createLimiter('holiday_hours_update', {
      maxAttempts: 20,
      windowMs: 10 * 60 * 1000, // 10 minutes
      blockDurationMs: 3 * 60 * 1000, // 3 minutes
      escalationEnabled: false,
      strictMode: false
    });
  }

  /**
   * Emergency lockdown mode
   * @param {string} reason - Reason for lockdown
   * @param {number} durationMs - Lockdown duration
   */
  async emergencyLockdown(reason, durationMs = 60 * 60 * 1000) {
    const now = Date.now();
    
    // Block all actions for all identifiers
    for (const [action, limiter] of this.limiters.entries()) {
      limiter.blocked.set('*EMERGENCY*', {
        blockedAt: now,
        blockedUntil: now + durationMs,
        level: 9999,
        reason: `Emergency lockdown: ${reason}`,
        attempts: 0
      });
    }

    await securityAudit.logEvent('emergency_lockdown_activated', {
      threat_type: 'emergency_lockdown',
      details: {
        reason,
        durationMs,
        affectedActions: Array.from(this.limiters.keys())
      }
    }, 'critical');
  }

  /**
   * Lift emergency lockdown
   * @param {string} reason - Reason for lifting lockdown
   */
  async liftEmergencyLockdown(reason) {
    for (const [action, limiter] of this.limiters.entries()) {
      limiter.blocked.delete('*EMERGENCY*');
    }

    await securityAudit.logEvent('emergency_lockdown_lifted', {
      details: { reason }
    }, 'medium');
  }

  /**
   * Check if system is in emergency lockdown
   * @returns {boolean} True if in lockdown
   */
  isInEmergencyLockdown() {
    for (const limiter of this.limiters.values()) {
      if (limiter.blocked.has('*EMERGENCY*')) {
        const lockdown = limiter.blocked.get('*EMERGENCY*');
        if (Date.now() < lockdown.blockedUntil) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Export configuration for backup/restore
   * @returns {object} Configuration data
   */
  exportConfig() {
    const config = {
      limiters: {},
      escalationRules: {},
      whitelistedIPs: Array.from(this.whitelistedIPs),
      blacklistedIPs: Array.from(this.blacklistedIPs),
      exportedAt: new Date().toISOString()
    };

    for (const [action, limiter] of this.limiters.entries()) {
      config.limiters[action] = limiter.config;
    }

    for (const [action, rules] of this.escalationRules.entries()) {
      config.escalationRules[action] = rules;
    }

    return config;
  }

  /**
   * Import configuration from backup
   * @param {object} config - Configuration data
   */
  importConfig(config) {
    if (config.limiters) {
      for (const [action, limiterConfig] of Object.entries(config.limiters)) {
        this.createLimiter(action, limiterConfig);
      }
    }

    if (config.escalationRules) {
      for (const [action, rules] of Object.entries(config.escalationRules)) {
        this.escalationRules.set(action, rules);
      }
    }

    if (config.whitelistedIPs) {
      config.whitelistedIPs.forEach(ip => this.whitelistedIPs.add(ip));
    }

    if (config.blacklistedIPs) {
      config.blacklistedIPs.forEach(ip => this.blacklistedIPs.add(ip));
    }

    securityAudit.logEvent('rate_limiter_config_imported', {
      component: 'rate_limiter',
      data_action: 'config_import',
      details: {
        importedAt: new Date().toISOString(),
        originalExportDate: config.exportedAt
      }
    }, 'medium');
  }
}

// Create singleton instance and export as default
const rateLimiterInstance = new RateLimiter();

// Set up default limiters
rateLimiterInstance.setupDefaultLimiters();

export default rateLimiterInstance;