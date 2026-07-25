// build/electron/networkMonitor.cjs
// PHASE 2, STEPS 45-49: Network monitoring module
// Purpose: Monitor network connectivity and handle reconnection

const { EventEmitter } = require('events');
const https = require('https');
const http = require('http');

class NetworkMonitor extends EventEmitter {
  constructor() {
    super();
    this.isOnline = true;
    this.lastCheck = null;
    this.latency = null;
    this.quality = 'good';
    this.checkInterval = null;
    this.checkIntervalMs = 30000; // 30 seconds
    this.checkTimeout = 5000; // 5 seconds
    this.supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://iagcamwcfuiopmwefohz.supabase.co';
    this.cachedResult = null;
    this.cacheTimeout = 5000; // Cache result for 5 seconds to avoid spam
    this.lastCachedTime = 0;
  }

  // STEP 46: Check connectivity
  async checkConnectivity() {
    // Check cache first
    const now = Date.now();
    if (this.cachedResult !== null && (now - this.lastCachedTime) < this.cacheTimeout) {
      return this.cachedResult;
    }
    
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      const url = new URL(this.supabaseUrl);
      const protocol = url.protocol === 'https:' ? https : http;
      
      const request = protocol.get(url.origin, {
        timeout: this.checkTimeout,
        headers: {
          'User-Agent': 'Tavari-Music-Desktop/1.0'
        }
      }, (response) => {
        const latency = Date.now() - startTime;
        this.latency = latency;
        
        // Consider online if we get any response (even error codes mean we're connected)
        const online = response.statusCode !== undefined;
        
        // Determine quality based on latency
        if (latency < 200) {
          this.quality = 'good';
        } else if (latency < 1000) {
          this.quality = 'poor';
        } else {
          this.quality = 'poor';
        }
        
        this.isOnline = online;
        this.lastCheck = new Date().toISOString();
        this.cachedResult = online;
        this.lastCachedTime = now;
        
        response.on('data', () => {}); // Consume response
        response.on('end', () => {
          resolve(online);
        });
      });
      
      request.on('timeout', () => {
        request.destroy();
        this.isOnline = false;
        this.lastCheck = new Date().toISOString();
        this.quality = 'offline';
        this.latency = null;
        this.cachedResult = false;
        this.lastCachedTime = now;
        resolve(false);
      });
      
      request.on('error', (error) => {
        this.isOnline = false;
        this.lastCheck = new Date().toISOString();
        this.quality = 'offline';
        this.latency = null;
        this.cachedResult = false;
        this.lastCachedTime = now;
        resolve(false);
      });
    });
  }

  // STEP 47: Monitor connection
  startMonitoring() {
    if (this.checkInterval) {
      return; // Already monitoring
    }
    
    // Initial check
    this.checkConnectivity().then((wasOnline) => {
      const previousStatus = this.isOnline;
      if (wasOnline !== previousStatus) {
        this.emit('status-change', {
          isOnline: wasOnline,
          previousStatus: previousStatus
        });
      }
    });
    
    // Set up interval
    this.checkInterval = setInterval(async () => {
      const previousStatus = this.isOnline;
      const isOnline = await this.checkConnectivity();
      
      if (isOnline !== previousStatus) {
        this.emit('status-change', {
          isOnline: isOnline,
          previousStatus: previousStatus
        });
        
        if (isOnline && !previousStatus) {
          // Connection restored
          await this.handleReconnection();
        }
      }
    }, this.checkIntervalMs);
    
    console.log('Network monitoring started');
  }

  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('Network monitoring stopped');
    }
  }

  // STEP 48: Handle reconnection
  async handleReconnection() {
    console.log('🔄 Network connection restored');
    
    try {
      // Emit reconnection event
      this.emit('reconnected', {
        timestamp: new Date().toISOString(),
        latency: this.latency,
        quality: this.quality
      });
      
      // Trigger sync operations (will be handled by listeners)
      this.emit('sync-required');
      
      // Log reconnection
      console.log('✅ Reconnection handled, sync operations triggered');
    } catch (error) {
      console.error('Error handling reconnection:', error);
    }
  }

  // STEP 49: Get network status
  getNetworkStatus() {
    return {
      isOnline: this.isOnline,
      lastCheck: this.lastCheck,
      latency: this.latency,
      quality: this.quality,
      supabaseUrl: this.supabaseUrl
    };
  }

  // Set check interval (for configuration)
  setCheckInterval(intervalMs) {
    this.checkIntervalMs = intervalMs;
    
    // Restart monitoring with new interval if already running
    if (this.checkInterval) {
      this.stopMonitoring();
      this.startMonitoring();
    }
  }
}

// Create singleton instance
const networkMonitor = new NetworkMonitor();

module.exports = networkMonitor;




