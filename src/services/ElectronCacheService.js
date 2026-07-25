// src/services/ElectronCacheService.js
// PHASE 3, STEPS 71-95: Offline cache service for Electron desktop app
// Purpose: Wraps GlobalMusicService and adds offline file caching capabilities

// ⚠️ BUILD FIX: Don't throw at module level - check in getElectronCacheService() instead
// This allows the module to be imported in web browsers without errors

class ElectronCacheService {
  constructor() {
    // ⚠️ CONFLICT RESOLUTION: Service worker cache DISABLED in Electron
    // Check if we're in Electron and disable service worker
    if (window.electronAPI) {
      this.disableServiceWorker();
    }
    
    // Cache configuration (aligned with build/electron/fileCache.cjs default cap)
    this.maxCacheSizeMB = 100;
    this.maxTracksToCache = 50;
    this.preloadCount = 3; // Preload next 3 tracks
    this.maxConcurrentDownloads = 3; // Limit concurrent downloads
    
    // Cache state
    this.cacheMetadata = null;
    this.cacheStats = null;
    this.cacheStatsTime = null;
    this.cacheStatsTTL = 60000; // 1 minute
    
    // Download queue
    this.downloadQueue = [];
    this.activeDownloads = new Set();
    this.downloadProgress = new Map();
    
    // Background tasks
    this.backgroundUpdateInterval = null;
    this.cleanupInterval = null;
    
    // Track access statistics
    this.accessStats = {
      hits: 0,
      misses: 0,
      totalRequests: 0
    };
    
    this.isInitialized = false;
  }

  isKioskStreamOnly() {
    return window.__TAVARI_KIOSK_STREAM_ONLY__ === true;
  }

  // STEP 71.5: Disable service worker in Electron
  disableServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(registration => {
          registration.unregister().catch(() => {});
        });
        console.log('🔧 Service worker disabled in Electron - using file cache instead');
      });
    }
  }

  // STEP 73: Initialize cache service
  async initialize() {
    try {
      if (this.isInitialized) {
        return { success: true, message: 'Already initialized' };
      }
      
      // Verify cache directory exists (via IPC)
      const stats = await window.electronAPI.cacheGetStats();
      if (!stats.success) {
        throw new Error('Failed to get cache stats: ' + stats.error);
      }
      
      // Load cache metadata
      this.cacheMetadata = stats.data || {};
      
      // Verify integrity (optional - can be slow)
      // await this.verifyCacheIntegrity();
      
      this.isInitialized = true;
      
      // Start background tasks
      this.startBackgroundTasks();
      
      return { success: true, message: 'Cache service initialized' };
    } catch (error) {
      console.error('Error initializing cache service:', error);
      return { success: false, error: error.message };
    }
  }

  // STEP 74: Download and cache track
  async downloadAndCacheTrack(trackId, fileUrl, metadata = {}) {
    try {
      if (this.isKioskStreamOnly()) {
        return { success: true, cached: false, skipped: true, message: 'Stream-only kiosk' };
      }

      // Check if already cached
      if (await this.isTrackCached(trackId)) {
        return { success: true, cached: true, message: 'Track already cached' };
      }
      
      // Check cache size limit
      const cacheSize = await this.getCacheSize();
      const cacheSizeMB = cacheSize / (1024 * 1024);
      
      if (cacheSizeMB >= this.maxCacheSizeMB) {
        // Need to free space
        const bytesToFree = (cacheSizeMB - this.maxCacheSizeMB + 50) * 1024 * 1024; // Free 50MB extra
        await this.evictLRUTracks(bytesToFree);
      }
      
      // Download file
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to download track: ${response.statusText}`);
      }
      
      // Get file data as ArrayBuffer
      const arrayBuffer = await response.arrayBuffer();
      const fileData = new Uint8Array(arrayBuffer);
      
      // Save to cache via IPC
      const result = await window.electronAPI.cacheSaveTrack(trackId, fileData, {
        ...metadata,
        expiresAt: metadata.expiresAt || null
      });
      
      if (!result.success) {
        if (result.error === 'FILE_EXCEEDS_CACHE_CAP' || result.skipped) {
          return {
            success: true,
            cached: false,
            skipped: true,
            message: 'Track larger than local cache cap; streaming only.'
          };
        }
        throw new Error(result.error || 'Failed to save track to cache');
      }
      
      // Update metadata
      await this.updateCacheMetadata(trackId, {
        cachedAt: new Date().toISOString(),
        fileSizeBytes: result.fileSizeBytes,
        checksum: result.checksum
      });

      // The on-disk cache size changed; don't reuse a stale size while a burst
      // of track-change events is deciding whether to download more MP3s.
      this.cacheStats = null;
      this.cacheStatsTime = null;
      
      return {
        success: true,
        cached: false,
        filePath: result.filePath,
        fileSizeBytes: result.fileSizeBytes
      };
    } catch (error) {
      console.error('Error downloading and caching track:', error);
      return { success: false, error: error.message };
    }
  }

  // STEP 75: Get cached track path
  async getCachedTrackPath(trackId) {
    try {
      if (!trackId) {
        return null;
      }
      
      const result = await window.electronAPI.cacheGetTrack(trackId);
      
      if (result.success && result.data) {
        // Update access statistics
        this.accessStats.hits++;
        this.accessStats.totalRequests++;
        
        // Update metadata
        await this.updateCacheMetadata(trackId, {
          lastAccessed: new Date().toISOString()
        });
        
        return result.data;
      } else {
        this.accessStats.misses++;
        this.accessStats.totalRequests++;
        return null;
      }
    } catch (error) {
      console.error('Error getting cached track path:', error);
      this.accessStats.misses++;
      this.accessStats.totalRequests++;
      return null;
    }
  }

  // STEP 76: Check if track is cached
  async isTrackCached(trackId) {
    try {
      const filePath = await this.getCachedTrackPath(trackId);
      return filePath !== null;
    } catch (error) {
      console.error('Error checking if track is cached:', error);
      return false;
    }
  }

  // STEP 77: Get cache size
  async getCacheSize() {
    try {
      // Check cache
      const now = Date.now();
      if (this.cacheStats && this.cacheStatsTime && (now - this.cacheStatsTime) < this.cacheStatsTTL) {
        return this.cacheStats.totalSizeBytes || 0;
      }
      
      const result = await window.electronAPI.cacheGetStats();
      
      if (result.success && result.data) {
        this.cacheStats = result.data;
        this.cacheStatsTime = now;
        return result.data.totalSizeBytes || 0;
      }
      
      return 0;
    } catch (error) {
      console.error('Error getting cache size:', error);
      return 0;
    }
  }

  // STEP 78: Evict LRU tracks
  async evictLRUTracks(bytesToFree) {
    try {
      const target =
        typeof bytesToFree === 'number' && bytesToFree > 0
          ? Math.floor(bytesToFree)
          : Math.floor(this.maxCacheSizeMB * 0.25 * 1024 * 1024);

      if (typeof window.electronAPI.cacheEvictLruBytes === 'function') {
        const ev = await window.electronAPI.cacheEvictLruBytes(target);
        if (ev.success && ev.data) {
          return {
            success: true,
            deletedCount: ev.data.deletedCount || 0,
            bytesFreed: ev.data.freedBytes || 0
          };
        }
      }

      // Never clear the entire offline track cache as an eviction fallback.
      // A full clear turns a transient IPC/LRU failure into total kiosk silence.
      return {
        success: false,
        deletedCount: 0,
        bytesFreed: 0,
        error: 'LRU eviction unavailable; preserving existing track cache'
      };
    } catch (error) {
      console.error('Error evicting LRU tracks:', error);
      return { success: false, error: error.message, deletedCount: 0 };
    }
  }

  // STEP 79: Verify track integrity
  async verifyTrackIntegrity(trackId) {
    try {
      const filePath = await this.getCachedTrackPath(trackId);
      if (!filePath) {
        return { valid: false, error: 'Track not in cache' };
      }
      
      // Get metadata to compare checksum
      const stats = await window.electronAPI.cacheGetStats();
      // TODO: Implement checksum verification
      // For now, just check if file exists
      
      return { valid: true };
    } catch (error) {
      console.error('Error verifying track integrity:', error);
      return { valid: false, error: error.message };
    }
  }

  // STEP 80: Preload tracks
  async preloadTracks(trackIds) {
    try {
      if (this.isKioskStreamOnly()) {
        return { success: true, preloaded: 0, skipped: true };
      }

      if (!Array.isArray(trackIds) || trackIds.length === 0) {
        return { success: true, preloaded: 0 };
      }
      
      // Add to download queue
      for (const trackId of trackIds) {
        if (!this.downloadQueue.includes(trackId) && !this.activeDownloads.has(trackId)) {
          this.downloadQueue.push(trackId);
        }
      }
      
      // Process queue
      await this.processDownloadQueue();
      
      return { success: true, queued: trackIds.length };
    } catch (error) {
      console.error('Error preloading tracks:', error);
      return { success: false, error: error.message };
    }
  }

  // Process download queue with concurrency limit
  async processDownloadQueue() {
    while (this.downloadQueue.length > 0 && this.activeDownloads.size < this.maxConcurrentDownloads) {
      const trackId = this.downloadQueue.shift();
      this.activeDownloads.add(trackId);
      
      // Download in background (don't await)
      this.downloadTrackBackground(trackId).finally(() => {
        this.activeDownloads.delete(trackId);
        // Continue processing queue
        this.processDownloadQueue();
      });
    }
  }

  // Download track in background
  async downloadTrackBackground(trackId) {
    try {
      // Get track URL from Supabase
      // TODO: Get track URL - this will need to be passed or fetched
      // For now, this is a placeholder
      console.log('Preloading track:', trackId);
      
      // This would need the track URL and metadata
      // await this.downloadAndCacheTrack(trackId, trackUrl, metadata);
    } catch (error) {
      console.error('Error downloading track in background:', error);
    }
  }

  // STEP 81: Cleanup expired tracks
  async cleanupExpiredTracks() {
    try {
      // This would check expires_at for each track
      // For now, we'll rely on the main process to handle this
      // TODO: Implement expired track cleanup
      return { success: true, deletedCount: 0 };
    } catch (error) {
      console.error('Error cleaning up expired tracks:', error);
      return { success: false, error: error.message };
    }
  }

  // STEP 82: Cleanup unused tracks
  async cleanupUnusedTracks(activeTrackIds) {
    try {
      if (!Array.isArray(activeTrackIds)) {
        return { success: false, error: 'activeTrackIds must be an array' };
      }
      
      // Get all cached tracks
      const stats = await window.electronAPI.cacheGetStats();
      // TODO: Get list of all cached track IDs and compare with activeTrackIds
      // Delete tracks not in active list
      
      return { success: true, deletedCount: 0 };
    } catch (error) {
      console.error('Error cleaning up unused tracks:', error);
      return { success: false, error: error.message };
    }
  }

  // STEP 84: Get cache statistics
  async getCacheStatistics() {
    try {
      const stats = await window.electronAPI.cacheGetStats();
      
      if (!stats.success || !stats.data) {
        return {
          totalTracks: 0,
          totalSizeMB: 0,
          oldestTrack: null,
          newestTrack: null,
          hitRate: 0,
          cachedTracks: []
        };
      }
      
      const data = stats.data;
      const hitRate = this.accessStats.totalRequests > 0
        ? (this.accessStats.hits / this.accessStats.totalRequests) * 100
        : 0;
      
      // Get list of cached tracks with metadata
      let cachedTracks = [];
      if (data.cachedTracks && Array.isArray(data.cachedTracks)) {
        cachedTracks = data.cachedTracks;
      } else if (this.cacheMetadata && this.cacheMetadata.tracks) {
        // Build list from metadata
        const tracks = this.cacheMetadata.tracks;
        cachedTracks = Object.keys(tracks).map(trackId => {
          const track = tracks[trackId];
          return {
            id: trackId,
            title: track.metadata?.title || 'Unknown Track',
            artist: track.metadata?.artist || null,
            cachedAt: track.cachedAt,
            fileSizeMB: track.fileSizeBytes ? (track.fileSizeBytes / 1048576) : 0,
            lastAccessed: track.lastAccessed || track.cachedAt
          };
        }).sort((a, b) => new Date(b.lastAccessed) - new Date(a.lastAccessed)); // Sort by most recently accessed
      }
      
      return {
        totalTracks: data.totalFiles || 0,
        totalSizeMB: data.totalSizeMB || 0,
        oldestTrack: data.oldestEntry || null,
        newestTrack: data.newestEntry || null,
        hitRate: Math.round(hitRate * 100) / 100,
        averageFileSize: data.averageFileSize || 0,
        maxSizeMB: this.maxCacheSizeMB,
        cachedTracks: cachedTracks,
        cacheDirectory: data.cacheDirectory || null,
        diskSpaceFree: data.diskSpaceFree || null
      };
    } catch (error) {
      console.error('Error getting cache statistics:', error);
      return {
        totalTracks: 0,
        totalSizeMB: 0,
        oldestTrack: null,
        newestTrack: null,
        hitRate: 0,
        cachedTracks: []
      };
    }
  }

  // STEP 85: Clear cache
  async clearCache() {
    try {
      const result = await window.electronAPI.cacheClear();
      
      // Reset metadata
      this.cacheMetadata = null;
      this.cacheStats = null;
      this.cacheStatsTime = null;
      this.accessStats = { hits: 0, misses: 0, totalRequests: 0 };
      
      return result;
    } catch (error) {
      console.error('Error clearing cache:', error);
      return { success: false, error: error.message };
    }
  }

  // STEP 86: Update cache metadata
  async updateCacheMetadata(trackId, updates) {
    try {
      // Metadata is managed by the main process fileCache module
      // This is just a placeholder for future enhancements
      // The actual metadata update happens in fileCache.cjs
    } catch (error) {
      console.error('Error updating cache metadata:', error);
    }
  }

  // STEP 87: Background cache update
  startBackgroundTasks() {
    // Background update every hour
    this.backgroundUpdateInterval = setInterval(() => {
      this.backgroundCacheUpdate().catch(error => {
        console.error('Error in background cache update:', error);
      });
    }, 60 * 60 * 1000); // 1 hour
    
    // Cleanup expired tracks daily
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTracks().catch(error => {
        console.error('Error cleaning up expired tracks:', error);
      });
    }, 24 * 60 * 60 * 1000); // 24 hours
  }

  async backgroundCacheUpdate() {
    try {
      // Check for new tracks in playlists
      // Download new tracks
      // Update existing tracks if changed
      // This will be implemented when integrated with GlobalMusicService
      console.log('Background cache update running...');
    } catch (error) {
      console.error('Error in background cache update:', error);
    }
  }

  // STEP 88: Preload next tracks
  async preloadNextTracks(currentTrackIndex, playlist) {
    try {
      if (!playlist || !Array.isArray(playlist) || playlist.length === 0) {
        return { success: true, preloaded: 0 };
      }
      
      // Get next 3 tracks
      const nextTracks = [];
      for (let i = 1; i <= this.preloadCount; i++) {
        const index = currentTrackIndex + i;
        if (index < playlist.length) {
          nextTracks.push(playlist[index].id);
        }
      }
      
      if (nextTracks.length > 0) {
        return await this.preloadTracks(nextTracks);
      }
      
      return { success: true, preloaded: 0 };
    } catch (error) {
      console.error('Error preloading next tracks:', error);
      return { success: false, error: error.message };
    }
  }

  // Cleanup on destroy
  destroy() {
    if (this.backgroundUpdateInterval) {
      clearInterval(this.backgroundUpdateInterval);
      this.backgroundUpdateInterval = null;
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    this.isInitialized = false;
  }
}

// Export singleton instance
let electronCacheServiceInstance = null;

export function getElectronCacheService() {
  // Check if we're in Electron environment
  if (!window.electronAPI) {
    return null; // Not in Electron - return null gracefully
  }

  // Check if cache methods are available
  if (!window.electronAPI.cacheSaveTrack || !window.electronAPI.cacheGetTrack) {
    console.warn('ElectronCacheService: Cache IPC handlers not available. Ensure preload.cjs exposes cache methods.');
    return null; // Cache not available - return null gracefully
  }

  // Create singleton instance if it doesn't exist
  if (!electronCacheServiceInstance) {
    electronCacheServiceInstance = new ElectronCacheService();
  }
  
  return electronCacheServiceInstance;
}

export default ElectronCacheService;



