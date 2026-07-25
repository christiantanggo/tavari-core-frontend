// services/PlaybackTrackingService.js
// Unified service for tracking song and ad playback with offline support
import { supabase } from '../supabaseClient';
import { isEmployeePortalPath } from '../utils/employeeAppRouting';

/** Employee portal sessions use JWT roles that cannot satisfy music_v2_playback_logs RLS — skip DB writes on portal routes. */
function skipPlaybackDbWrites() {
  if (typeof window === 'undefined') return false;
  return isEmployeePortalPath(window.location.pathname || '');
}

/** music_v2_playback_logs.*_id columns are UUID FKs; browser sends synthetic ids like "browser-…". */
function uuidOrNull(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
  ) {
    return null;
  }
  return s;
}

function isPlaybackLogAuthError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.code === '42501' ||
    error?.code === 'PGRST301' ||
    error?.status === 401 ||
    message.includes('row-level security') ||
    message.includes('unauthorized') ||
    message.includes('permission denied')
  );
}

/** PostgREST returns HTTP 409 for unique (23505) and FK (23503) violations. */
function isPlaybackLogConflictError(error) {
  if (!error) return false;
  if (error.status === 409) return true;
  return error.code === '23505' || error.code === '23503';
}

/**
 * music_v2_playback_logs.playlist_id FK targets music_v2_curated_playlists, but the app
 * uses music_playlists IDs — omit playlist_id to avoid 409 FK conflicts on every log.
 */
function buildPlaybackLogRow(data, options = {}) {
  const { includePlaylist = false, includeTrack = true } = options;
  return {
    business_id: uuidOrNull(data.business_id),
    installation_id: uuidOrNull(data.installation_id),
    device_id: uuidOrNull(data.device_id),
    location_id: uuidOrNull(data.location_id),
    log_type: data.log_type,
    track_id: includeTrack ? uuidOrNull(data.track_id) : null,
    ad_id: uuidOrNull(data.ad_id),
    playlist_id: includePlaylist ? uuidOrNull(data.playlist_id) : null,
    start_time: data.start_time,
    end_time: data.end_time || null,
    duration_played: data.duration_played ?? null,
    completed: data.completed !== undefined ? data.completed : true,
    skipped: data.skipped || false,
    error: data.error || null,
    synced_to_server: true,
  };
}

class PlaybackTrackingService {
  constructor() {
    this.queue = [];
    this.isOnline = navigator.onLine;
    this.batchSize = 10;
    this.batchInterval = 30000; // 30 seconds
    this.maxRetries = 5;
    this.uploadInterval = null;
    this.activeLogs = new Map(); // Track ongoing plays: logId -> { startTime, trackId, ... }
    this.installationId = null;
    this.deviceId = null;
    this.locationId = null;
    this.businessId = null;
    this.dbWritesDisabled =
      typeof window !== 'undefined' &&
      (window.__TAVARI_ELECTRON__ === true || window.__TAVARI_KIOSK_MODE__ === true) &&
      window.location?.hash?.includes('/kiosk/music');
    
    // Initialize
    this.loadQueue();
    this.setupNetworkMonitoring();
    this.startBatchUpload();
    
    // Listen for online/offline events
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());
  }

  /**
   * Initialize with business and installation context
   */
  async initialize(businessId, installationId = null, deviceId = null, locationId = null) {
    this.businessId = businessId;
    this.installationId = installationId;
    this.deviceId = deviceId;
    this.locationId = locationId;
    this.dbWritesDisabled =
      typeof window !== 'undefined' &&
      (window.__TAVARI_ELECTRON__ === true || window.__TAVARI_KIOSK_MODE__ === true) &&
      window.location?.hash?.includes('/kiosk/music');

    if (this.dbWritesDisabled) {
      this.queue = [];
      this.activeLogs.clear();
      this.saveQueue();
      return;
    }
    
    // Try to get installation info if in Electron and not provided
    if (window.electronAPI && !installationId) {
      try {
        console.log('🔍 [PlaybackTrackingService] Auto-detecting installation in Electron...');
        const systemInfo = await window.electronAPI.getSystemInfo();
        console.log('📡 [PlaybackTrackingService] System info:', systemInfo);
        
        if (systemInfo?.fingerprint) {
          console.log('🔍 [PlaybackTrackingService] Looking up installation by fingerprint:', systemInfo.fingerprint, 'for business:', businessId);
          // Try to find installation by fingerprint
          let { data, error } = await supabase
            .from('music_installations')
            .select('id, device_name, business_id, status')
            .eq('device_fingerprint', systemInfo.fingerprint)
            .eq('business_id', businessId)
            .eq('status', 'active')
            .maybeSingle();
          
          console.log('📦 [PlaybackTrackingService] Installation lookup result (with business filter):', { data, error });
          
          // If not found, try without business_id filter
          if (!data && !error) {
            console.log('🔍 [PlaybackTrackingService] Not found with business filter, trying without...');
            const { data: data2, error: error2 } = await supabase
              .from('music_installations')
              .select('id, device_name, business_id, status')
              .eq('device_fingerprint', systemInfo.fingerprint)
              .eq('status', 'active')
              .maybeSingle();
            
            console.log('📦 [PlaybackTrackingService] Installation lookup result (without business filter):', { data: data2, error: error2 });
            
            if (data2 && data2.business_id === businessId) {
              data = data2;
            } else if (data2) {
              console.log('⚠️ [PlaybackTrackingService] Found installation but for different business:', data2.business_id);
            }
          }
          
          if (error) {
            console.warn('⚠️ [PlaybackTrackingService] Error looking up installation:', error);
          } else if (data) {
            this.installationId = data.id;
            // device_id doesn't exist in music_installations table
            this.deviceId = null;
            console.log('✅ [PlaybackTrackingService] Found installation:', {
              installationId: data.id,
              deviceName: data.device_name,
              businessId: data.business_id
            });
          } else {
            console.log('ℹ️ [PlaybackTrackingService] No installation found for fingerprint:', systemInfo.fingerprint);
            console.log('💡 [PlaybackTrackingService] Desktop kiosk needs to be registered. Logs will have installation_id = null');
          }
        } else {
          console.log('⚠️ [PlaybackTrackingService] No fingerprint in system info:', systemInfo);
        }
      } catch (error) {
        console.warn('⚠️ [PlaybackTrackingService] Could not get installation info:', error);
      }
    }
    
    // PlaybackTrackingService initialized
    
    // Process any queued logs
    this.processQueue();
  }

  /**
   * Log when a song starts playing
   */
  async logSongStart(track, playlistId = null) {
    if (skipPlaybackDbWrites()) {
      return null;
    }
    if (this.dbWritesDisabled) {
      return null;
    }
    if (!this.businessId || !track?.id) {
      console.warn('⚠️ [PlaybackTrackingService] Cannot log song start: missing businessId or track');
      return null;
    }

    // Validate playlist_id exists if provided (to avoid foreign key constraint errors)
    let validPlaylistId = null;
    if (playlistId && this.businessId) {
      try {
        const { data, error } = await supabase
          .from('music_playlists')
          .select('id')
          .eq('id', playlistId)
          .eq('business_id', this.businessId)
          .maybeSingle();
        
        // Only use playlist_id if validation succeeds AND we got valid data
        if (!error && data && data.id && data.id === playlistId) {
          validPlaylistId = playlistId;
        }
        // Otherwise, validPlaylistId stays null (safe default)
      } catch (error) {
        // Any error - default to null to prevent foreign key violations
        validPlaylistId = null;
      }
    }

    const logId = this.generateId();
    const startTime = new Date().toISOString();
    
    const logEntry = {
      id: logId,
      type: 'song',
      data: {
        track_id: track.id,
        track_title: track.title || track.name,
        track_artist: track.artist,
        playlist_id: validPlaylistId, // Use validated playlist_id or null
        business_id: this.businessId,
        installation_id: this.installationId,
        device_id: this.deviceId,
        location_id: this.locationId,
        start_time: startTime,
        log_type: 'song'
      },
      retries: 0,
      createdAt: Date.now()
    };

    // Store active log for completion tracking
    this.activeLogs.set(logId, {
      startTime: new Date(startTime),
      trackId: track.id,
      trackTitle: track.title || track.name,
      playlistId: validPlaylistId // Use validated playlist_id
    });

    // Try to upload immediately, or queue if offline
    if (this.isOnline) {
      try {
        await this.uploadLog(logEntry);
        return logId;
      } catch (error) {
        if (isPlaybackLogAuthError(error)) {
          this.disableDbWritesForSession(error);
          this.activeLogs.delete(logId);
          return null;
        }
        console.warn('Failed to upload log immediately, queuing:', error.message || error);
        this.queueLog(logEntry);
        return logId;
      }
    } else {
      this.queueLog(logEntry);
      return logId;
    }
  }

  /**
   * Log when a song completes or is skipped
   */
  async logSongEnd(logId, options = {}) {
    if (!logId) {
      return;
    }
    if (skipPlaybackDbWrites()) {
      this.activeLogs.delete(logId);
      return;
    }
    if (this.dbWritesDisabled) {
      this.activeLogs.delete(logId);
      return;
    }

    const activeLog = this.activeLogs.get(logId);
    if (!activeLog) {
      console.warn('Cannot log song end: log not found', logId);
      return;
    }

    const {
      completed = true,
      skipped = false,
      duration = null,
      error = null
    } = options;

    // Calculate duration if not provided
    let actualDuration = duration;
    if (!actualDuration && activeLog.startTime) {
      actualDuration = Math.floor((Date.now() - activeLog.startTime.getTime()) / 1000);
    }

    const endTime = new Date().toISOString();
    
    // Update the log entry
    const updateData = {
      end_time: endTime,
      duration_played: actualDuration,
      completed: completed && !skipped,
      skipped: skipped,
      error: error
    };

    // Try to update existing log in database, or create completion entry
    if (this.isOnline) {
      try {
        // Try to find and update the log
        const query = supabase
          .from('music_v2_playback_logs')
          .select('id')
          .eq('track_id', activeLog.trackId)
          .is('end_time', null)
          .order('start_time', { ascending: false })
          .limit(1);
        
        // Add business_id filter if available
        if (this.businessId) {
          query.eq('business_id', this.businessId);
        }
        
        const { data: existingLogs } = await query;

        if (existingLogs && existingLogs.length > 0) {
          // Update existing log
          await supabase
            .from('music_v2_playback_logs')
            .update(updateData)
            .eq('id', existingLogs[0].id);
        } else {
          // Create new completion log (fallback)
          await this.createCompleteLog({
            ...activeLog,
            ...updateData,
            start_time: activeLog.startTime.toISOString()
          });
        }
      } catch (error) {
        if (isPlaybackLogAuthError(error)) {
          this.disableDbWritesForSession(error);
        } else {
          console.warn('Failed to update log, queuing completion:', error.message || error);
          this.queueCompletion(logId, updateData);
        }
      }
    } else {
      this.queueCompletion(logId, updateData);
    }

    // Remove from active logs
    this.activeLogs.delete(logId);
  }

  /**
   * Log ad play (for compatibility with existing ad system)
   */
  async logAdPlay(adId, options = {}) {
    if (skipPlaybackDbWrites()) {
      return null;
    }
    if (this.dbWritesDisabled) {
      return null;
    }
    if (!this.businessId || !adId) {
      console.warn('Cannot log ad play: missing businessId or adId');
      return null;
    }

    const {
      duration = null,
      completed = true,
      skipped = false
    } = options;

    const logEntry = {
      id: this.generateId(),
      type: 'ad',
      data: {
        ad_id: adId,
        business_id: this.businessId,
        installation_id: this.installationId,
        device_id: this.deviceId,
        location_id: this.locationId,
        start_time: new Date().toISOString(),
        end_time: duration ? new Date(Date.now() + duration * 1000).toISOString() : null,
        duration_played: duration,
        completed: completed,
        skipped: skipped,
        log_type: 'ad'
      },
      retries: 0,
      createdAt: Date.now()
    };

    if (this.isOnline) {
      try {
        await this.uploadLog(logEntry);
        return logEntry.id;
      } catch (error) {
        if (isPlaybackLogAuthError(error)) {
          this.disableDbWritesForSession(error);
          return null;
        }
        console.warn('Failed to upload ad log, queuing:', error);
        this.queueLog(logEntry);
        return logEntry.id;
      }
    } else {
      this.queueLog(logEntry);
      return logEntry.id;
    }
  }

  /**
   * Upload a single log entry to database
   */
  async uploadLog(logEntry) {
    try {
      if (skipPlaybackDbWrites()) {
        return null;
      }
      if (this.dbWritesDisabled) {
        return null;
      }
      // Check if user is authenticated before attempting insert
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session && !logEntry.data.device_id) {
        const authError = new Error('Playback log upload skipped: kiosk is not authenticated for RLS');
        authError.status = 401;
        throw authError;
      }

      const { data, error } = await supabase
        .from('music_v2_playback_logs')
        .insert(buildPlaybackLogRow(logEntry.data))
        .select('id')
        .maybeSingle();

      if (error) {
        if (isPlaybackLogConflictError(error)) {
          const { data: retryResult, error: retryError } = await supabase
            .from('music_v2_playback_logs')
            .insert(buildPlaybackLogRow(logEntry.data, { includeTrack: false }))
            .select('id')
            .maybeSingle();
          if (!retryError) return retryResult;
          if (isPlaybackLogConflictError(retryError)) return retryResult ?? null;
        }
        if (isPlaybackLogAuthError(error)) {
          throw error;
        }
        throw error;
      }

      return data;
    } catch (error) {
      // Re-throw to be handled by caller (will queue the log)
      throw error;
    }
  }

  /**
   * Create a complete log entry (for songs that completed)
   */
  async createCompleteLog(logData) {
    // Validate playlist_id if provided
    let validPlaylistId = null;
    if (logData.playlistId) {
      try {
        const { data, error } = await supabase
          .from('music_playlists')
          .select('id')
          .eq('id', logData.playlistId)
          .eq('business_id', this.businessId)
          .maybeSingle();
        
        if (!error && data && data.id) {
          validPlaylistId = logData.playlistId;
        }
      } catch (error) {
        // Silently ignore - set to null
        validPlaylistId = null;
      }
    }
    
    return await this.uploadLog({
      id: this.generateId(),
      type: 'song',
      data: {
        track_id: logData.trackId,
        playlist_id: validPlaylistId, // Use validated playlist_id
        business_id: this.businessId,
        installation_id: this.installationId,
        device_id: this.deviceId,
        location_id: this.locationId,
        start_time: logData.start_time,
        end_time: logData.end_time,
        duration_played: logData.duration_played,
        completed: logData.completed,
        skipped: logData.skipped,
        error: logData.error || null,
        log_type: 'song'
      },
      retries: 0,
      createdAt: Date.now()
    });
  }

  /**
   * Queue a log entry for later upload
   */
  queueLog(logEntry) {
    this.queue.push(logEntry);
    this.saveQueue();
  }

  /**
   * Queue a completion update
   */
  queueCompletion(logId, updateData) {
    const completionEntry = {
      id: this.generateId(),
      type: 'completion',
      data: {
        original_log_id: logId,
        ...updateData
      },
      retries: 0,
      createdAt: Date.now()
    };
    this.queue.push(completionEntry);
    this.saveQueue();
  }

  disableDbWritesForSession(error) {
    if (!this.dbWritesDisabled) {
      // Expected when a leftover playback queue flushes without a music-kiosk JWT.
      if (typeof console !== 'undefined' && console.debug) {
        console.debug(
          '[PlaybackTracking] Skipping DB writes for this session:',
          error?.message || error
        );
      }
    }
    this.dbWritesDisabled = true;
    this.queue = this.queue.filter((log) => log?.type !== 'song' && log?.type !== 'ad' && log?.type !== 'completion');
    this.activeLogs.clear();
    this.saveQueue();
  }

  /**
   * Process queued logs
   */
  async processQueue() {
    if (this.dbWritesDisabled || !this.isOnline || this.queue.length === 0) {
      return;
    }
    if (skipPlaybackDbWrites()) {
      return;
    }

    // Don't hammer RLS with stale offline queue when the dashboard has no staff JWT.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        this.queue = [];
        this.saveQueue();
        return;
      }
    } catch {
      this.queue = [];
      this.saveQueue();
      return;
    }

    const logsToProcess = this.queue.slice(0, this.batchSize);
    const remainingQueue = this.queue.slice(this.batchSize);

    const results = await Promise.allSettled(
      logsToProcess.map(log => this.processQueuedLog(log))
    );

    // Remove successfully processed logs
    const failedLogs = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        // Success - log will be removed
      } else {
        // Failed - increment retries and keep if under max
        const log = logsToProcess[index];
        if (isPlaybackLogAuthError(result.reason)) {
          this.disableDbWritesForSession(result.reason);
          return;
        }
        if (isPlaybackLogConflictError(result.reason)) {
          return;
        }
        log.retries++;
        if (log.retries < this.maxRetries) {
          failedLogs.push(log);
        } else {
          console.error('Log exceeded max retries, dropping:', log);
        }
      }
    });

    // Update queue with failed logs + remaining
    this.queue = [...failedLogs, ...remainingQueue];
    this.saveQueue();
  }

  /**
   * Process a single queued log
   */
  async processQueuedLog(logEntry) {
    if (logEntry.type === 'completion') {
      // Handle completion updates
      const activeLog = this.activeLogs.get(logEntry.data.original_log_id);
      if (!activeLog) {
        // Active log not found, skip
        return;
      }

      const query = supabase
        .from('music_v2_playback_logs')
        .select('id')
        .eq('track_id', activeLog.trackId)
        .is('end_time', null)
        .order('start_time', { ascending: false })
        .limit(1);
      
      // Add business_id filter if available
      if (this.businessId) {
        query.eq('business_id', this.businessId);
      }
      
      const { data: existingLogs } = await query;

      if (existingLogs && existingLogs.length > 0) {
        await supabase
          .from('music_v2_playback_logs')
          .update({
            end_time: logEntry.data.end_time,
            duration_played: logEntry.data.duration_played,
            completed: logEntry.data.completed,
            skipped: logEntry.data.skipped,
            error: logEntry.data.error || null
          })
          .eq('id', existingLogs[0].id);
      }
    } else {
      // Handle new log entries
      // Validate playlist_id before uploading queued logs
      if (logEntry.data.playlist_id) {
        try {
          const { data, error } = await supabase
            .from('music_playlists')
            .select('id')
            .eq('id', logEntry.data.playlist_id)
            .eq('business_id', this.businessId || logEntry.data.business_id)
            .maybeSingle();
          
          if (error || !data || !data.id) {
            // Playlist doesn't exist - remove playlist_id
            logEntry.data.playlist_id = null;
          }
        } catch (error) {
          // Validation failed - remove playlist_id
          logEntry.data.playlist_id = null;
        }
      }
      
      await this.uploadLog(logEntry);
    }
  }

  /**
   * Start batch upload interval
   */
  startBatchUpload() {
    if (this.uploadInterval) {
      clearInterval(this.uploadInterval);
    }

    this.uploadInterval = setInterval(() => {
      this.processQueue();
    }, this.batchInterval);
  }

  /**
   * Setup network monitoring
   */
  setupNetworkMonitoring() {
    this.isOnline = navigator.onLine;
  }

  /**
   * Handle online event
   */
  handleOnline() {
    this.isOnline = true;
    this.processQueue();
  }

  /**
   * Handle offline event
   */
  handleOffline() {
    this.isOnline = false;
  }

  /**
   * Load queue from localStorage
   */
  loadQueue() {
    try {
      const stored = localStorage.getItem('playback_logs_queue');
      if (stored) {
        this.queue = JSON.parse(stored);
        // Filter out very old logs (older than 7 days)
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        this.queue = this.queue.filter(log => log.createdAt > sevenDaysAgo);
        if (this.queue.length !== JSON.parse(stored).length) {
          this.saveQueue();
        }
      }
    } catch (error) {
      console.error('Failed to load queue:', error);
      this.queue = [];
    }
  }

  /**
   * Save queue to localStorage
   */
  saveQueue() {
    try {
      localStorage.setItem('playback_logs_queue', JSON.stringify(this.queue));
    } catch (error) {
      console.error('Failed to save queue:', error);
      // If localStorage is full, try to remove oldest entries
      if (error.name === 'QuotaExceededError') {
        this.queue = this.queue.slice(-this.batchSize * 2); // Keep only recent entries
        try {
          localStorage.setItem('playback_logs_queue', JSON.stringify(this.queue));
        } catch (e) {
          console.error('Failed to save reduced queue:', e);
        }
      }
    }
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get queue status
   */
  getQueueStatus() {
    return {
      queued: this.queue.length,
      active: this.activeLogs.size,
      online: this.isOnline
    };
  }

  /**
   * Clear old logs from queue
   */
  clearOldLogs(daysOld = 7) {
    const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    this.queue = this.queue.filter(log => log.createdAt > cutoff);
    this.saveQueue();
  }

  /**
   * Destroy service
   */
  destroy() {
    if (this.uploadInterval) {
      clearInterval(this.uploadInterval);
      this.uploadInterval = null;
    }
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
  }
}

// Export singleton instance
export const playbackTrackingService = new PlaybackTrackingService();

