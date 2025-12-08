// Security/DeviceFingerprint.js - Device Fingerprinting Service
/**
 * Device fingerprinting service for tracking and identifying devices
 * Used for security monitoring and suspicious activity detection
 */

class DeviceFingerprint {
  constructor() {
    this.fingerprint = null;
    this.initialized = false;
  }

  /**
   * Generate a comprehensive device fingerprint
   * @returns {Promise<string>} Base64 encoded fingerprint
   */
  async generate() {
    if (this.fingerprint && this.initialized) {
      return this.fingerprint;
    }

    try {
      const fingerprintData = {
        // Browser information
        userAgent: navigator.userAgent,
        language: navigator.language,
        languages: navigator.languages || [],
        platform: navigator.platform,
        cookieEnabled: navigator.cookieEnabled,
        doNotTrack: navigator.doNotTrack,
        
        // Screen information
        screen: {
          width: screen.width,
          height: screen.height,
          colorDepth: screen.colorDepth,
          pixelDepth: screen.pixelDepth,
          availWidth: screen.availWidth,
          availHeight: screen.availHeight
        },
        
        // Timezone information
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timezoneOffset: new Date().getTimezoneOffset(),
        
        // Hardware information
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory,
        maxTouchPoints: navigator.maxTouchPoints,
        
        // Canvas fingerprint
        canvas: await this.getCanvasFingerprint(),
        
        // WebGL fingerprint
        webgl: this.getWebGLFingerprint(),
        
        // Audio fingerprint
        audio: await this.getAudioFingerprint(),
        
        // Fonts detection
        fonts: this.getAvailableFonts(),
        
        // Browser features
        features: this.getBrowserFeatures(),
        
        // Storage availability
        storage: this.getStorageInfo(),
        
        // Generation timestamp
        timestamp: Date.now(),
        
        // Version for fingerprint format
        version: '1.0'
      };

      this.fingerprint = btoa(JSON.stringify(fingerprintData));
      this.initialized = true;
      
      return this.fingerprint;
    } catch (error) {
      console.warn('Error generating device fingerprint:', error);
      
      // Fallback fingerprint with basic information
      const fallbackData = {
        userAgent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
        screen: `${screen.width}x${screen.height}`,
        timestamp: Date.now(),
        fallback: true
      };
      
      this.fingerprint = btoa(JSON.stringify(fallbackData));
      this.initialized = true;
      
      return this.fingerprint;
    }
  }

  /**
   * Generate canvas fingerprint
   * @returns {string} Canvas data URL
   */
  async getCanvasFingerprint() {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      canvas.width = 200;
      canvas.height = 50;
      
      // Add text with various properties
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.fillText('Tavari Security 🔒', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.2)';
      ctx.fillText('Device Fingerprint', 4, 17);
      
      // Add some geometric shapes
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgb(255,0,255)';
      ctx.beginPath();
      ctx.arc(50, 50, 50, 0, Math.PI * 2, true);
      ctx.closePath();
      ctx.fill();
      
      return canvas.toDataURL();
    } catch (error) {
      console.warn('Canvas fingerprint error:', error);
      return 'canvas_error';
    }
  }

  /**
   * Generate WebGL fingerprint
   * @returns {object} WebGL information
   */
  getWebGLFingerprint() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      
      if (!gl) {
        return { error: 'WebGL not supported' };
      }

      return {
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        maxVertexTextureImageUnits: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
        maxTextureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
        maxCombinedTextureImageUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
        maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
        maxVertexUniformVectors: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
        maxFragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
        maxVaryingVectors: gl.getParameter(gl.MAX_VARYING_VECTORS)
      };
    } catch (error) {
      console.warn('WebGL fingerprint error:', error);
      return { error: error.message };
    }
  }

  /**
   * Generate audio fingerprint
   * @returns {Promise<object>} Audio context information
   */
  async getAudioFingerprint() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      
      if (!AudioContext) {
        return { error: 'AudioContext not supported' };
      }

      // Check if AudioContext would be suspended before creating it
      // Browsers require user interaction to create/resume AudioContext
      // Skip audio fingerprinting entirely to avoid errors
      // This is called during component mount, before user interaction
      return { 
        skipped: true, 
        reason: 'requires_user_interaction',
        note: 'Audio fingerprinting disabled to comply with browser autoplay policies'
      };
    } catch (error) {
      // Silently skip - audio fingerprinting is optional and shouldn't break the app
      return { skipped: true, reason: 'autoplay_policy' };
    }
  }

  /**
   * Detect available fonts
   * @returns {Array<string>} List of available fonts
   */
  getAvailableFonts() {
    try {
      const testString = 'mmmmmmmmmmlli';
      const testSize = '72px';
      const baseFonts = ['monospace', 'sans-serif', 'serif'];
      const fontList = [
        'Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Verdana',
        'Georgia', 'Palatino', 'Garamond', 'Bookman', 'Comic Sans MS',
        'Trebuchet MS', 'Arial Black', 'Impact', 'Lucida Sans Unicode',
        'Tahoma', 'Lucida Console', 'Monaco', 'Courier', 'Bradley Hand',
        'Brush Script MT', 'Luminari', 'Chalkduster'
      ];

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      context.font = testSize + ' monospace';

      const baselineSize = context.measureText(testString).width;
      const availableFonts = [];

      for (const font of fontList) {
        context.font = testSize + ' ' + font + ', monospace';
        const newSize = context.measureText(testString).width;
        if (newSize !== baselineSize) {
          availableFonts.push(font);
        }
      }

      return availableFonts;
    } catch (error) {
      console.warn('Font detection error:', error);
      return [];
    }
  }

  /**
   * Get browser features and capabilities
   * @returns {object} Browser features
   */
  getBrowserFeatures() {
    return {
      // Storage
      localStorage: !!window.localStorage,
      sessionStorage: !!window.sessionStorage,
      indexedDB: !!window.indexedDB,
      
      // APIs
      geolocation: !!navigator.geolocation,
      webRTC: !!(window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection),
      webGL: !!window.WebGLRenderingContext,
      canvas: !!window.CanvasRenderingContext2D,
      
      // Features
      touchSupport: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
      deviceMotion: !!window.DeviceMotionEvent,
      deviceOrientation: !!window.DeviceOrientationEvent,
      
      // Network
      onLine: navigator.onLine,
      connection: navigator.connection ? {
        effectiveType: navigator.connection.effectiveType,
        downlink: navigator.connection.downlink,
        rtt: navigator.connection.rtt
      } : null,
      
      // Permissions
      permissions: !!navigator.permissions,
      serviceWorker: !!navigator.serviceWorker,
      
      // Media
      mediaDevices: !!navigator.mediaDevices,
      getUserMedia: !!(navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia)
    };
  }

  /**
   * Get storage information
   * @returns {object} Storage capabilities and usage
   */
  getStorageInfo() {
    const storage = {};

    try {
      // Test localStorage
      localStorage.setItem('_test', '1');
      localStorage.removeItem('_test');
      storage.localStorage = true;
    } catch (e) {
      storage.localStorage = false;
    }

    try {
      // Test sessionStorage
      sessionStorage.setItem('_test', '1');
      sessionStorage.removeItem('_test');
      storage.sessionStorage = true;
    } catch (e) {
      storage.sessionStorage = false;
    }

    // IndexedDB
    storage.indexedDB = !!window.indexedDB;

    // WebSQL (deprecated but still detectable)
    storage.webSQL = !!window.openDatabase;

    return storage;
  }

  /**
   * Get the current fingerprint without regenerating
   * @returns {string|null} Current fingerprint or null if not generated
   */
  getCurrent() {
    return this.fingerprint;
  }

  /**
   * Check if fingerprint has been initialized
   * @returns {boolean} Initialization status
   */
  isInitialized() {
    return this.initialized;
  }

  /**
   * Clear the current fingerprint (forces regeneration)
   */
  clear() {
    this.fingerprint = null;
    this.initialized = false;
  }

  /**
   * Compare two fingerprints for similarity
   * @param {string} fingerprint1 - First fingerprint
   * @param {string} fingerprint2 - Second fingerprint
   * @returns {number} Similarity score (0-1, where 1 is identical)
   */
  static compare(fingerprint1, fingerprint2) {
    if (!fingerprint1 || !fingerprint2) {
      return 0;
    }

    if (fingerprint1 === fingerprint2) {
      return 1;
    }

    try {
      const data1 = JSON.parse(atob(fingerprint1));
      const data2 = JSON.parse(atob(fingerprint2));

      let matches = 0;
      let total = 0;

      // Compare key fields
      const fieldsToCompare = [
        'userAgent', 'platform', 'language', 'screen',
        'timezone', 'canvas', 'webgl', 'audio'
      ];

      for (const field of fieldsToCompare) {
        total++;
        if (JSON.stringify(data1[field]) === JSON.stringify(data2[field])) {
          matches++;
        }
      }

      return matches / total;
    } catch (error) {
      console.warn('Error comparing fingerprints:', error);
      return 0;
    }
  }
}

// Create singleton instance and export as default
const deviceFingerprintInstance = new DeviceFingerprint();

export default deviceFingerprintInstance;