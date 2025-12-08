// services/GlobalMusicService.js - COMPLETE VERSION WITH REALTIME SUBSCRIPTIONS
import { supabase } from '../supabaseClient';
import { playbackTrackingService } from './PlaybackTrackingService';

class GlobalMusicService {
  constructor() {
    // Core audio state
    this.audio = null;
    this.currentTrack = null;
    this.playlist = [];
    this.currentIndex = 0;
    this.isPlaying = false;
    this.volume = 0.7;
    this.businessId = null;
    this.isInitialized = false;
    this.listeners = [];
    this.readyToPlay = false;
	
    // UI mode flags
    this.isShuffleAllMode = true;
    this.shuffleMode = true;
    this.currentPlaylistId = null;
    this.playlistInfo = null;

    // Schedule monitoring
    this.scheduleInterval = null;
    this.scheduleReloadInterval = null;
    this.midnightReloadTimeout = null;
    this.activeSchedule = null;
    this.schedules = [];
    this.checkFrequency = 10000; // 10 seconds - check for schedule activation
    this.lastScheduleActivationDate = null; // Track when schedule was last activated
    
    // Track reloading - poll for new tracks periodically
    this.trackReloadInterval = null;
    this.trackReloadFrequency = 5 * 60 * 1000; // 5 minutes - reload tracks to catch new uploads
    
    // Realtime subscriptions
    this.scheduleSubscription = null;
    this.playlistSubscription = null;
    this.trackSubscription = null;
    
    // Network and offline handling
    this.isOnline = navigator.onLine;
    this.offlineCache = {
      schedules: null,
      currentPlaylist: null,
      tracks: null,
      lastSync: null
    };
    this.networkCheckInterval = null;
    this.syncRetryCount = 0;
    this.maxSyncRetries = 5;
    
    // Playlist loop control
    this.loopPlaylist = true; // Default: loop
    this.stopWhenComplete = false; // Default: don't stop
    this.playlistHasCompletedOnce = false; // Track if playlist finished once

    // Auto-play handling
    this.userInteracted = false;
    this.autoPlayEnabled = true;
    
    // Keepalive mechanism for continuous playback
    this.keepaliveInterval = null;
    this.keepaliveFrequency = 60000; // Check every 60 seconds
    this.lastPlaybackCheck = null;
    this.isKioskMode = false;

    // Playback tracking
    this.currentPlayLogId = null;

    this.setupAudio();
    this.setupUserInteraction();
  }

  setupAudio() {
    this.audio = document.getElementById('global-audio-element') || new Audio();
    if (!document.getElementById('global-audio-element')) {
      this.audio.id = 'global-audio-element';
      this.audio.style.display = 'none';
      document.body.appendChild(this.audio);
    }

    this.audio.volume = this.volume;
    this.audio.preload = 'auto';

    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      // Log song start when playback actually begins
      if (this.currentTrack && this.businessId) {
        this.logSongStart();
      }
      this.notifyListeners();
    });

    this.audio.addEventListener('pause', () => {
      if (!this.audio.ended) {
        this.isPlaying = false;
        this.notifyListeners();
      }
    });

    this.audio.addEventListener('ended', async () => {
      // Log song completion before moving to next
      if (this.currentPlayLogId) {
        await playbackTrackingService.logSongEnd(this.currentPlayLogId, {
          completed: true,
          skipped: false,
          duration: Math.floor(this.audio.duration || 0)
        });
        this.currentPlayLogId = null;
      }
      await this.next();
      this.ensurePlayback();
    });

    this.audio.addEventListener('error', async () => {
      // Log current song as error before moving to next
      if (this.currentPlayLogId && this.currentTrack) {
        await playbackTrackingService.logSongEnd(this.currentPlayLogId, {
          completed: false,
          skipped: true,
          error: 'Playback error',
          duration: this.audio?.currentTime ? Math.floor(this.audio.currentTime) : null
        });
        this.currentPlayLogId = null;
      }
      await this.next();
      this.ensurePlayback();
    });

    // Update currentTime on timeupdate for live progress bar
    this.audio.addEventListener('timeupdate', () => {
      this.notifyListeners();
    });

    // Update duration when loaded
    this.audio.addEventListener('loadedmetadata', () => {
      this.notifyListeners();
    });
  }

  setupUserInteraction() {
    const handleInteraction = () => {
      if (!this.userInteracted) {
        this.userInteracted = true;
        
        if (!this.isPlaying && this.playlist.length > 0) {
          this.play();
        }
      }
      this.ensurePlayback();
    };

    ['click', 'keydown', 'touchstart'].forEach(event => {
      document.addEventListener(event, handleInteraction, { once: true });
    });
    
    // For kiosk/background mode, automatically enable after a short delay
    setTimeout(() => {
      if (!this.userInteracted) {
        this.enableKioskMode();
      }
    }, 2000);
  }
  
  enableKioskMode() {
    this.isKioskMode = true;
    // Mark as interacted to allow autoplay
    this.userInteracted = true;
    this.startKeepalive();
  }
  
  startKeepalive() {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
    }
    
    this.keepaliveInterval = setInterval(() => {
      this.ensurePlayback();
    }, this.keepaliveFrequency);
  }
  
  stopKeepalive() {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }
  
  async ensurePlayback() {
    // Ensure music is playing if it should be
    if (!this.isInitialized || !this.businessId) {
      return;
    }
    
    // CRITICAL FIX: Detect when tracks are missing and reload them
    // This prevents the "no tracks to play" issue where tracks get lost
    if (this.playlist.length === 0 && this.tracks.length === 0 && (this.isKioskMode || this.userInteracted)) {
      console.warn('⚠️ [Keepalive] Detected missing tracks - attempting to reload...', {
        businessId: this.businessId,
        isInitialized: this.isInitialized,
        isKioskMode: this.isKioskMode,
        userInteracted: this.userInteracted,
        timestamp: new Date().toISOString()
      });
      
      try {
        await this.loadTracks();
        
        if (this.tracks.length > 0) {
          console.log(`✅ [Keepalive] Successfully reloaded ${this.tracks.length} tracks`);
          // Try to start playback if we have tracks now
          if (!this.currentTrack && this.playlist.length > 0) {
            await this.loadFirstTrack();
            if (this.isKioskMode || this.userInteracted) {
              await this.attemptAutoPlay();
            }
          }
        } else {
          console.error('❌ [Keepalive] Track reload returned 0 tracks!', {
            businessId: this.businessId,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error('❌ [Keepalive] Failed to reload tracks:', error, {
          businessId: this.businessId,
          timestamp: new Date().toISOString()
        });
      }
    }
    
    // If we have a current track and should be playing, make sure it's actually playing
    if (this.currentTrack && this.shouldBePlaying() && !this.isPlaying && this.readyToPlay) {
      try {
        // Check if audio is paused or stopped
        if (this.audio.paused || this.audio.ended) {
          await this.play();
        }
      } catch (error) {
        // If autoplay is blocked, try to resume
        if (error.name === 'NotAllowedError') {
          // Wait and try again - user interaction may have occurred
          setTimeout(async () => {
            try {
              await this.play();
            } catch (e) {
              // Silent fail
            }
          }, 1000);
        }
      }
    }
  }
  
  shouldBePlaying() {
    // Should be playing if:
    // 1. We're initialized
    // 2. We have tracks
    // 3. We're in kiosk mode or user has interacted
    // 4. We're not explicitly paused by user
    return this.isInitialized && 
           this.playlist.length > 0 && 
           (this.isKioskMode || this.userInteracted);
  }

  async initialize(businessId) {
    if (!businessId) {
      return;
    }

    if (this.isInitialized && this.businessId === businessId) {
      return;
    }

    if (this.isInitialized && this.businessId && this.businessId !== businessId) {
      this.destroy();
    }

    this.businessId = businessId;
    
    // Check for kiosk mode flag from Electron or window
    if (window.__TAVARI_KIOSK_MODE__ || window.__TAVARI_ENABLE_AUTOPLAY__) {
      this.enableKioskMode();
    }

    try {
      await this.loadTracks();
      await this.loadSchedules();
      
      // Initialize playback tracking service with installation context
      // Try to get installation ID if in Electron
      let installationId = null;
      let deviceId = null;
      
      if (window.electronAPI) {
        try {
          console.log('🔍 [GlobalMusicService] Detected Electron - looking up installation...');
          const systemInfo = await window.electronAPI.getSystemInfo();
          console.log('📡 [GlobalMusicService] System info:', systemInfo);
          
          if (systemInfo?.fingerprint) {
            console.log('🔍 [GlobalMusicService] Looking up installation by fingerprint:', systemInfo.fingerprint, 'for business:', businessId);
            
            // First try with business_id filter
            let { data, error } = await supabase
              .from('music_installations')
              .select('id, device_name, business_id, status')
              .eq('device_fingerprint', systemInfo.fingerprint)
              .eq('business_id', businessId)
              .eq('status', 'active')
              .maybeSingle();
            
            console.log('📦 [GlobalMusicService] Installation lookup result (with business filter):', { data, error });
            
            // If not found, try without business_id filter (in case it was registered to a different business)
            if (!data && !error) {
              console.log('🔍 [GlobalMusicService] Not found with business filter, trying without business filter...');
              const { data: data2, error: error2 } = await supabase
                .from('music_installations')
                .select('id, device_name, business_id, status')
                .eq('device_fingerprint', systemInfo.fingerprint)
                .eq('status', 'active')
                .maybeSingle();
              
              console.log('📦 [GlobalMusicService] Installation lookup result (without business filter):', { data: data2, error: error2 });
              
              if (data2) {
                console.log('⚠️ [GlobalMusicService] Found installation but for different business:', data2.business_id, 'vs current:', businessId);
                // Still use it if business matches or if we want to allow cross-business
                if (data2.business_id === businessId) {
                  data = data2;
                }
              }
            }
            
            if (error) {
              console.warn('⚠️ [GlobalMusicService] Error looking up installation:', error);
            } else if (data) {
              installationId = data.id;
              // device_id doesn't exist in music_installations table
              deviceId = null;
              console.log('✅ [GlobalMusicService] Found installation:', { 
                installationId, 
                deviceName: data.device_name,
                businessId: data.business_id
              });
            } else {
              console.log('ℹ️ [GlobalMusicService] No installation found for fingerprint:', systemInfo.fingerprint);
              console.log('💡 [GlobalMusicService] Desktop kiosk may need to be registered via InstallationManager');
            }
          } else {
            console.log('⚠️ [GlobalMusicService] No fingerprint in system info:', systemInfo);
          }
        } catch (error) {
          console.warn('⚠️ [GlobalMusicService] Error getting installation info:', error);
        }
      } else {
        // Running in browser - no installation ID
      }
      
      // Initializing playback tracking
      
      await playbackTrackingService.initialize(businessId, installationId, deviceId);
      
      // Set up network monitoring FIRST
      this.setupNetworkMonitoring();
      
      // Cache current data for offline use
      await this.cacheCurrentState();
      
      // Set up realtime subscriptions BEFORE starting schedule monitoring
      this.subscribeToScheduleChanges();
      this.subscribeToPlaylistChanges();
      this.subscribeToTrackChanges();
      
      // Start aggressive schedule monitoring (realtime + polling hybrid)
      this.startScheduleMonitoring();
      
      // Start periodic track reloading to catch new uploads
      this.startTrackReloading();
      
      // Try to resume playback after page reload
      this.resumeAfterReload();

      if (this.playlist.length > 0) {
        await this.loadFirstTrack();
        this.attemptAutoPlay();
      }

      this.isInitialized = true;
      
      if (this.playlist.length > 0 && !this.currentTrack) {
        await this.loadFirstTrack();
      }
      
      // Start keepalive if in kiosk mode or after user interaction
      if (this.isKioskMode || this.userInteracted) {
        this.startKeepalive();
      }
      
      // Notify listeners of state change
      this.notifyListeners();
    } catch (error) {
      // Silent error handling
    }
  }

  /**
   * Subscribe to schedule changes in realtime
   * When you change a schedule on your laptop, the tablet gets notified instantly
   */
  subscribeToScheduleChanges() {
    // Unsubscribe from any existing subscription first
    if (this.scheduleSubscription) {
      supabase.removeChannel(this.scheduleSubscription);
      this.scheduleSubscription = null;
    }

    // Create a unique channel name for this business
    const channelName = `music-schedules-${this.businessId}`;

    this.scheduleSubscription = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'music_playlist_schedules',
          filter: `business_id=eq.${this.businessId}`
        },
        async (payload) => {
          const previouslyActiveId = this.activeSchedule?.id;
          const previousActivationDate = this.lastScheduleActivationDate;

          await this.loadSchedules();

          if ((payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') && previouslyActiveId) {
            const updatedId = payload.new?.id;
            if (updatedId && updatedId === previouslyActiveId) {
              this.activeSchedule = null;
              this.lastScheduleActivationDate = null;
            }
          }

          if (payload.eventType === 'DELETE' && previouslyActiveId && payload.old?.id === previouslyActiveId) {
            this.activeSchedule = null;
            this.lastScheduleActivationDate = null;
          }

          const shouldForce = this.activeSchedule === null;
          this.checkSchedules(shouldForce);

          // Update cache
          await this.cacheCurrentState();
        }
      )
      .subscribe((status) => {
        // Silent subscription handling
      });
  }

  /**
   * Subscribe to playlist changes in realtime
   * Updates when playlists are created, modified, or deleted
   */
  subscribeToPlaylistChanges() {
    // Unsubscribe from any existing subscription first
    if (this.playlistSubscription) {
      supabase.removeChannel(this.playlistSubscription);
      this.playlistSubscription = null;
    }

    const channelName = `music-playlists-${this.businessId}`;

    this.playlistSubscription = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'music_playlists',
          filter: `business_id=eq.${this.businessId}`
        },
        async (payload) => {
          // If currently playing this playlist and it was deleted, switch to shuffle
          if (payload.eventType === 'DELETE' && 
              payload.old?.id === this.currentPlaylistId) {
            await this.switchToShuffle();
          }
          
          // If currently playing this playlist and it was updated, reload it
          if (payload.eventType === 'UPDATE' && 
              payload.new?.id === this.currentPlaylistId) {
            await this.switchToScheduledPlaylist(this.currentPlaylistId);
          }
        }
      )
      .subscribe((status) => {
        // Silent subscription handling
      });
  }

  /**
   * Subscribe to track changes in realtime
   * Updates when tracks are added, modified, or deleted
   */
  subscribeToTrackChanges() {
    // Unsubscribe from any existing subscription first
    if (this.trackSubscription) {
      supabase.removeChannel(this.trackSubscription);
      this.trackSubscription = null;
    }

    const channelName = `music-tracks-${this.businessId}`;

    this.trackSubscription = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'music_tracks',
          filter: `business_id=eq.${this.businessId}`
        },
        async (payload) => {
          console.log('🔄 Track change detected via realtime:', payload.eventType);
          
          // Always reload tracks when they change (new upload, update, or delete)
          if (this.isShuffleAllMode) {
            const previousTrackCount = this.tracks?.length || 0;
            await this.loadTracks();
            const newTrackCount = this.tracks?.length || 0;
            console.log(`✅ Tracks reloaded: ${previousTrackCount} → ${newTrackCount}`);
            
            // If we got new tracks and nothing is playing, start playing
            if (newTrackCount > previousTrackCount && !this.currentTrack && this.playlist.length > 0) {
              await this.loadFirstTrack();
              if (this.isKioskMode || this.userInteracted) {
                await this.attemptAutoPlay();
              }
            }
          }
          
          // If currently playing an ordered playlist, reload it to get updated tracks
          if (this.currentPlaylistId && !this.isShuffleAllMode) {
            await this.switchToScheduledPlaylist(this.currentPlaylistId);
          }
        }
      )
      .subscribe((status) => {
        // Silent subscription handling
      });
  }

  async loadTracks() {
    if (!this.businessId) {
      console.error('❌ Cannot load tracks - businessId is not set!', {
        businessId: this.businessId,
        isInitialized: this.isInitialized,
        timestamp: new Date().toISOString()
      });
      return;
    }

    console.log(`🔄 [loadTracks] Starting track load for business: ${this.businessId}`, {
      timestamp: new Date().toISOString(),
      previousTrackCount: this.tracks?.length || 0
    });
    
    // Load all tracks without pagination limit
    let allTracks = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;
    let queryErrors = [];

    // Use EXACT same query pattern as MusicLibrary.jsx (which works)
    // Load ALL tracks first, then filter in JavaScript
    // Add cache-busting timestamp to ensure fresh data
    const cacheBuster = Date.now();
    while (hasMore) {
      let query = supabase
        .from('music_tracks')
        .select('*')
        .eq('business_id', this.businessId)
        .order('title', { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);
      
      // Add a small random delay to prevent caching issues
      const { data, error } = await query;

      if (error) {
        console.error(`❌ [loadTracks] Error loading tracks page ${page}:`, error, {
          businessId: this.businessId,
          page,
          pageSize,
          timestamp: new Date().toISOString()
        });
        queryErrors.push({ page, error });
        
        // Don't return immediately - try to continue with other pages
        // But if it's a critical error (like RLS policy), we should stop
        if (error.code === 'PGRST301' || error.message?.includes('permission') || error.message?.includes('policy')) {
          console.error('❌ [loadTracks] Critical permission error - stopping track load');
          // Keep existing tracks if we have them, don't clear them
          if (this.tracks.length === 0) {
            console.warn('⚠️ [loadTracks] No tracks loaded and permission error - tracks may be empty');
          }
          return;
        }
        
        // For other errors, continue to next page
        hasMore = false;
        break;
      }

      if (data && data.length > 0) {
        allTracks = allTracks.concat(data);
        console.log(`📦 [loadTracks] Loaded page ${page}: ${data.length} tracks (total so far: ${allTracks.length})`);
        page++;
        hasMore = data.length === pageSize;
      } else {
        hasMore = false;
      }
    }
    
    console.log(`📊 [loadTracks] Loaded ${allTracks.length} total tracks from database`, {
      businessId: this.businessId,
      pages: page,
      errors: queryErrors.length,
      timestamp: new Date().toISOString()
    });
    
    // Filter to shuffle tracks (like MusicLibrary does in JavaScript)
    const shuffleTracks = allTracks.filter(t => t.include_in_shuffle);
    const nonShuffleTracks = allTracks.filter(t => !t.include_in_shuffle);
    
    console.log(`🎲 [loadTracks] Track breakdown: ${shuffleTracks.length} shuffle tracks, ${nonShuffleTracks.length} non-shuffle tracks`);
    
    // Use shuffle tracks if available, otherwise fall back to ALL tracks
    // This ensures shuffle mode works, but if no shuffle tracks exist, we still show all tracks
    this.tracks = shuffleTracks.length > 0 ? shuffleTracks : allTracks;

    // Use filtered tracks for playlist
    this.playlist = this.tracks;
    this.isShuffleAllMode = true;
    this.shuffleMode = true;
    this.currentPlaylistId = null;
    this.playlistInfo = null;
    this.loopPlaylist = true; // Shuffle always loops
    this.stopWhenComplete = false;
    this.playlistHasCompletedOnce = false;
    
    if (this.tracks.length > 0) {
      this.shufflePlaylist();
      console.log(`✅ [loadTracks] Successfully loaded ${this.tracks.length} tracks for playback`);
    } else {
      console.warn('⚠️ [loadTracks] No tracks available for playback!', {
        businessId: this.businessId,
        allTracksCount: allTracks.length,
        shuffleTracksCount: shuffleTracks.length,
        nonShuffleTracksCount: nonShuffleTracks.length,
        queryErrors: queryErrors.length,
        timestamp: new Date().toISOString()
      });
    }
    this.notifyListeners();
  }

  /**
   * Load schedules with retry logic and offline fallback
   */
  async loadSchedules() {
    // If offline, use cache
    if (!this.isOnline) {
      await this.loadCachedSchedules();
      return;
    }
    
    try {
      const { data, error } = await supabase
        .from('music_playlist_schedules')
        .select(`
          *,
          playlist:music_playlists(id, name, playlist_type)
        `)
        .eq('business_id', this.businessId)
        .eq('active', true);

      if (error) {
        await this.loadCachedSchedules();
        // Retry on next interval
        return;
      }

      this.schedules = data || [];
      
      // Update cache on successful load
      await this.cacheCurrentState();
    } catch (error) {
      await this.loadCachedSchedules();
    }
  }

  /**
   * BULLETPROOF schedule monitoring with:
   * - Real-time subscriptions (instant updates)
   * - Aggressive polling (30 seconds - backup when realtime fails)
   * - Frequent activation checks (10 seconds)
   * - Offline cache support
   */
  startScheduleMonitoring() {
    if (this.scheduleInterval) {
      clearInterval(this.scheduleInterval);
    }
    if (this.scheduleReloadInterval) {
      clearInterval(this.scheduleReloadInterval);
    }

    // AGGRESSIVE POLLING: Reload schedules every 30 seconds (not 5 minutes!)
    // This ensures we catch changes even if realtime fails
    this.scheduleReloadInterval = setInterval(async () => {
      try {
        if (this.isOnline) {
          await this.loadSchedules();
          await this.cacheCurrentState(); // Update cache
          this.checkSchedules();
          this.syncRetryCount = 0; // Reset on success
        } else {
          // Offline - use cached schedules
          await this.loadCachedSchedules();
          this.checkSchedules();
        }
      } catch (error) {
        await this.loadCachedSchedules();
        this.checkSchedules();
      }
    }, 30 * 1000); // 30 seconds - MUCH more aggressive

    // Check schedules for activation every 10 seconds (unchanged)
    this.scheduleInterval = setInterval(() => {
      this.checkSchedules();
    }, this.checkFrequency);

    // Check immediately on start
    this.checkSchedules();
    
    // Reload schedules on date change (midnight check)
    this.setupDailyScheduleReload();
  }
  
  /**
   * Start periodic track reloading to catch new uploads
   * This ensures new tracks are picked up even if realtime subscription fails
   */
  startTrackReloading() {
    if (this.trackReloadInterval) {
      clearInterval(this.trackReloadInterval);
    }
    
    // Reload tracks every 5 minutes to catch new uploads
    this.trackReloadInterval = setInterval(async () => {
      try {
        if (this.isOnline && this.businessId) {
          console.log('🔄 Periodic track reload - checking for new tracks...');
          const previousTrackCount = this.tracks?.length || 0;
          await this.loadTracks();
          const newTrackCount = this.tracks?.length || 0;
          
          if (newTrackCount > previousTrackCount) {
            console.log(`✅ Found ${newTrackCount - previousTrackCount} new tracks! Reloaded playlist.`);
            // If we have a current track, keep playing - new tracks will be in the shuffle
            // If playlist is empty, load first track
            if (this.playlist.length > 0 && !this.currentTrack) {
              await this.loadFirstTrack();
              if (this.isKioskMode || this.userInteracted) {
                await this.attemptAutoPlay();
              }
            }
          } else if (newTrackCount < previousTrackCount) {
            console.log(`⚠️ Track count decreased from ${previousTrackCount} to ${newTrackCount}`);
            // If current track was deleted, load next
            if (this.currentTrack && !this.playlist.find(t => t.id === this.currentTrack.id)) {
              console.log('🎵 Current track was deleted, loading next...');
              await this.next();
            }
          }
          
          // Update cache
          await this.cacheCurrentState();
        }
      } catch (error) {
        console.warn('⚠️ Error during periodic track reload:', error);
      }
    }, this.trackReloadFrequency);
    
    // Track reloading started
  }
  
  /**
   * Resume playback after page reload
   * This ensures music continues playing even when code updates trigger a reload
   */
  async resumeAfterReload() {
    try {
      const savedState = localStorage.getItem('_reload_resume_track');
      if (!savedState) return;
      
      const state = JSON.parse(savedState);
      console.log('🔄 Attempting to resume playback after reload...', state);
      
      // Wait a bit for tracks to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Find the track that was playing
      if (state.trackId && this.tracks) {
        const trackIndex = this.tracks.findIndex(t => t.id === state.trackId);
        if (trackIndex !== -1) {
          // Load the track
          this.currentIndex = trackIndex;
          await this.loadTrack(this.tracks[trackIndex]);
          
          // Resume from saved position if it was playing
          if (state.wasPlaying && this.audio) {
            if (state.currentTime > 0 && state.currentTime < this.audio.duration) {
              this.audio.currentTime = state.currentTime;
            }
            // Auto-play will be handled by kiosk mode
            if (this.isKioskMode || this.userInteracted) {
              await this.attemptAutoPlay();
            }
            console.log('✅ Resumed playback after reload');
          }
        }
      }
      
      // Clear saved state
      localStorage.removeItem('_reload_resume_track');
    } catch (error) {
      console.warn('⚠️ Could not resume playback after reload:', error);
      localStorage.removeItem('_reload_resume_track');
    }
  }
  
  /**
   * Setup network status monitoring
   */
  setupNetworkMonitoring() {
    // Listen for online/offline events
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.syncRetryCount = 0;
      this.loadSchedules().then(() => {
        this.cacheCurrentState();
        this.checkSchedules();
      });
    });
    
    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.loadCachedSchedules();
    });
    
    // Check network status periodically
    this.networkCheckInterval = setInterval(() => {
      const wasOnline = this.isOnline;
      this.isOnline = navigator.onLine;
      
      if (!wasOnline && this.isOnline) {
        // Just came back online - sync immediately
        this.loadSchedules().then(() => {
          this.cacheCurrentState();
          this.checkSchedules();
        });
      }
    }, 5000); // Check every 5 seconds
  }
  
  /**
   * Cache current state for offline use
   */
  async cacheCurrentState() {
    try {
      const cacheData = {
        schedules: this.schedules,
        currentPlaylist: {
          id: this.currentPlaylistId,
          info: this.playlistInfo,
          tracks: this.playlist,
          currentIndex: this.currentIndex
        },
        activeSchedule: this.activeSchedule,
        lastSync: new Date().toISOString(),
        businessId: this.businessId
      };
      
      localStorage.setItem(`tavari_music_cache_${this.businessId}`, JSON.stringify(cacheData));
      this.offlineCache = cacheData;
    } catch (error) {
      // Silent error handling
    }
  }
  
  /**
   * Load schedules from cache when offline
   */
  async loadCachedSchedules() {
    try {
      const cached = localStorage.getItem(`tavari_music_cache_${this.businessId}`);
      if (cached) {
        const cacheData = JSON.parse(cached);
        this.schedules = cacheData.schedules || [];
        this.activeSchedule = cacheData.activeSchedule;
        return true;
      }
    } catch (error) {
      // Silent error handling
    }
    return false;
  }
  
  setupDailyScheduleReload() {
    // Clear any existing timeout
    if (this.midnightReloadTimeout) {
      clearTimeout(this.midnightReloadTimeout);
    }
    
    // Reload schedules and reset activation date at midnight
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0); // Next midnight
    const msUntilMidnight = midnight.getTime() - now.getTime();
    
    this.midnightReloadTimeout = setTimeout(() => {
      // Reload schedules at midnight
      this.loadSchedules();
      // Reset activation date so recurring schedules can activate again
      this.lastScheduleActivationDate = null;
      // Check schedules immediately
      this.checkSchedules();
      
      // Schedule next midnight reload
      this.setupDailyScheduleReload();
    }, msUntilMidnight);
  }

  /**
   * BULLETPROOF schedule checking - runs every 10 seconds
   * Handles offline mode and ensures immediate activation
   */
  checkSchedules(force = false) {
    // Ensure we have schedules (load from cache if needed)
    if (!this.schedules || this.schedules.length === 0) {
      if (!this.isOnline) {
        this.loadCachedSchedules();
      }
      return;
    }
    
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const currentDate = `${year}-${month}-${day}`;
    const currentTime = now.getHours() * 60 + now.getMinutes();
    const currentDay = now.getDay();

    const activeSchedules = (this.schedules || []).filter(schedule => {
      return this.isScheduleActive(schedule, currentTime, currentDate, currentDay);
    });

    // Debug logging for schedule checking
    if (this.schedules.length > 0) {
      // Schedule check
    }

    if (activeSchedules.length === 0) {
      if (this.activeSchedule) {
        // Schedule has ended - clear it so it can activate again tomorrow
        console.log('📅 Active schedule ended, switching to shuffle');
        this.activeSchedule = null;
        this.lastScheduleActivationDate = null;
        this.switchToShuffle();
        this.cacheCurrentState();
      }
      return;
    }

    const bestSchedule = activeSchedules
      .slice()
      .sort((a, b) => {
        const pa = a.priority ?? 1;
        const pb = b.priority ?? 1;
        if (pb !== pa) return pb - pa;
        const aCreated = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bCreated = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bCreated - aCreated;
      })[0];

    // Check if we need to activate the schedule
    // For recurring schedules, activate if:
    // 1. No active schedule currently
    // 2. Different schedule (ID or playlist)
    // 3. Same schedule but different day (for recurring daily schedules)
    const shouldActivate = force ||
      !this.activeSchedule ||
      this.activeSchedule.playlist_id !== bestSchedule.playlist_id ||
      this.activeSchedule.id !== bestSchedule.id ||
      (this.activeSchedule.id === bestSchedule.id && 
       this.lastScheduleActivationDate !== currentDate);

    if (shouldActivate) {
      console.log(`📅 Activating schedule: ${bestSchedule.playlist?.name || bestSchedule.playlist_id} (Priority: ${bestSchedule.priority || 1})`);
      this.activeSchedule = bestSchedule;
      this.lastScheduleActivationDate = currentDate; // Track when it was activated
      this.switchToScheduledPlaylist(bestSchedule.playlist_id, bestSchedule).then(() => {
        this.cacheCurrentState();
      });
    }
  }

  isScheduleActive(schedule, currentTime, currentDate, currentDay) {
    const startTime = this.timeToMinutes(schedule.start_time);
    const endTime = this.timeToMinutes(schedule.end_time);

    let timeMatch = false;
    if (startTime === endTime) {
      timeMatch = Math.abs(currentTime - startTime) <= 1;
    } else if (startTime < endTime) {
      timeMatch = currentTime >= startTime && currentTime < endTime;
    } else {
      timeMatch = currentTime >= startTime || currentTime < endTime;
    }

    if (!timeMatch) {
      return false;
    }

    if (schedule.schedule_date) {
      const scheduleDate = new Date(schedule.schedule_date + 'T00:00:00');
      const checkDate = new Date(currentDate + 'T00:00:00');
    
      if (schedule.repeat_until) {
        const repeatUntilDate = new Date(schedule.repeat_until + 'T00:00:00');
        if (checkDate > repeatUntilDate) {
          return false;
        }
      }

      if (schedule.repeat_type === 'once') {
        return schedule.schedule_date === currentDate;
      } 
    
      if (schedule.repeat_type === 'daily') {
        return checkDate >= scheduleDate;
      } 
    
      if (schedule.repeat_type === 'weekly') {
        return checkDate >= scheduleDate && currentDay === scheduleDate.getDay();
      }
    
      if (schedule.repeat_type === 'monthly') {
        return checkDate >= scheduleDate && checkDate.getDate() === scheduleDate.getDate();
      }
    }

    if (schedule.day_of_week !== null && schedule.day_of_week !== undefined) {
      return currentDay === schedule.day_of_week;
    }

    return true;
  }

  timeToMinutes(timeString) {
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours * 60 + minutes;
  }

  async switchToScheduledPlaylist(playlistId, schedule = null) {
    try {
      const { data: playlist, error: playlistError } = await supabase
        .from('music_playlists')
        .select('*')
        .eq('id', playlistId)
        .single();

      if (playlistError) throw playlistError;

      let tracks = [];
      
      if (playlist.playlist_type === 'shuffle') {
        // Load all tracks without pagination limit
        let allTracks = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;

        while (hasMore) {
          const { data, error } = await supabase
            .from('music_tracks')
            .select('*')
            .eq('business_id', this.businessId)
            .eq('include_in_shuffle', true)
            .range(page * pageSize, (page + 1) * pageSize - 1);

          if (error) throw error;

          if (data && data.length > 0) {
            allTracks = allTracks.concat(data);
            page++;
            hasMore = data.length === pageSize;
          } else {
            hasMore = false;
          }
        }

        tracks = allTracks;
        this.shuffleArray(tracks);
      } else {
        const { data, error } = await supabase
          .from('music_playlist_tracks')
          .select('music_tracks(*)')
          .eq('playlist_id', playlistId)
          .order('sort_order');

        if (error) throw error;
        tracks = data?.map(pt => pt.music_tracks) || [];
      }

      this.playlist = tracks;
      this.currentIndex = 0;
      this.playlistHasCompletedOnce = false;

      // Set loop controls from schedule settings
      if (schedule) {
        this.loopPlaylist = schedule.loop_playlist !== false; // Default true
        this.stopWhenComplete = schedule.stop_when_complete === true; // Default false
      } else {
        this.loopPlaylist = true;
        this.stopWhenComplete = false;
      }

      if (tracks.length > 0) {
        await this.loadTrack(tracks[0]);
        if (this.userInteracted) {
          this.play();
        }
      }
	  
      this.currentPlaylistId = playlistId;
      this.playlistInfo = {
        id: playlist.id,
        name: playlist.name,
        description: playlist.description || '',
      };
      this.isShuffleAllMode = false;
      this.shuffleMode = playlist.playlist_type === 'shuffle';

      this.notifyListeners();
    } catch (error) {
      // Silent error handling
    }
  }
  
  async switchToPlaylist(playlistId) {
    return this.switchToScheduledPlaylist(playlistId);
  }

  async switchToShuffle() {
    try {
      await this.loadTracks();
      this.currentIndex = 0;

      if (this.playlist.length > 0) {
        await this.loadTrack(this.playlist[0]);
        if (this.userInteracted) {
          this.play();
        }
      }

      this.activeSchedule = null;
      this.currentPlaylistId = null;
      this.playlistInfo = null;
      this.isShuffleAllMode = true;
      this.shuffleMode = true;
      this.loopPlaylist = true;
      this.stopWhenComplete = false;
      this.playlistHasCompletedOnce = false;

      this.notifyListeners();
    } catch (err) {
      // Silent error handling
    }
  }

  shufflePlaylist() {
    this.shuffleArray(this.playlist);
  }

  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  async loadFirstTrack() {
    // CRITICAL FIX: If playlist is empty, try to reload tracks first
    if (this.playlist.length === 0) {
      console.warn('⚠️ [loadFirstTrack] Playlist is empty - attempting to reload tracks...', {
        businessId: this.businessId,
        tracksLength: this.tracks?.length || 0,
        timestamp: new Date().toISOString()
      });
      
      try {
        await this.loadTracks();
        
        if (this.playlist.length === 0) {
          console.error('❌ [loadFirstTrack] Still no tracks after reload - cannot load first track', {
            businessId: this.businessId,
            timestamp: new Date().toISOString()
          });
          return;
        }
        
        console.log(`✅ [loadFirstTrack] Reloaded ${this.playlist.length} tracks - loading first track`);
      } catch (error) {
        console.error('❌ [loadFirstTrack] Failed to reload tracks:', error, {
          businessId: this.businessId,
          timestamp: new Date().toISOString()
        });
        return;
      }
    }
    
    if (this.playlist.length > 0) {
      this.currentIndex = Math.floor(Math.random() * this.playlist.length);
      await this.loadTrack(this.playlist[this.currentIndex]);
    }
  }

  async loadTrack(track) {
    try {
      const { data } = supabase.storage
        .from('music-files')
        .getPublicUrl(track.file_path);

      this.audio.src = data.publicUrl;
      this.currentTrack = track;
      this.readyToPlay = true;
      this.notifyListeners();
    } catch (error) {
      // Silent error handling
    }
  }

  /**
   * Log song start for tracking
   */
  async logSongStart() {
    if (!this.currentTrack || !this.businessId) {
      return;
    }

    try {
      const logId = await playbackTrackingService.logSongStart(
        this.currentTrack,
        this.currentPlaylistId
      );
      this.currentPlayLogId = logId;
    } catch (error) {
      // Silent error handling - don't break playback if tracking fails
      console.warn('Failed to log song start:', error);
    }
  }

  attemptAutoPlay() {
    // In kiosk mode, always try to play
    if (this.isKioskMode) {
      // Set userInteracted to allow autoplay
      this.userInteracted = true;
      this.play().catch((error) => {
        // If autoplay fails, it will be retried by keepalive
      });
      return;
    }
    
    if (!this.userInteracted) {
      return;
    }
    this.play();
  }

  async play() {
    if (!this.readyToPlay || !this.currentTrack) {
      await this.loadFirstTrack();
    }

    if (!this.audio || !this.audio.src) {
      return;
    }

    try {
      await this.audio.play();
      this.isPlaying = true;
      this.notifyListeners();
    } catch (error) {
      this.isPlaying = false;
      this.notifyListeners();
    }
  }

  pause() {
    this.audio.pause();
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  async next() {
    // CRITICAL FIX: If playlist is empty, try to reload tracks before giving up
    if (this.playlist.length === 0) {
      console.warn('⚠️ [next] Playlist is empty - attempting to reload tracks...', {
        businessId: this.businessId,
        tracksLength: this.tracks?.length || 0,
        timestamp: new Date().toISOString()
      });
      
      try {
        await this.loadTracks();
        
        if (this.playlist.length === 0) {
          console.error('❌ [next] Still no tracks after reload - cannot play next track', {
            businessId: this.businessId,
            timestamp: new Date().toISOString()
          });
          return;
        }
        
        console.log(`✅ [next] Reloaded ${this.playlist.length} tracks - continuing playback`);
      } catch (error) {
        console.error('❌ [next] Failed to reload tracks:', error, {
          businessId: this.businessId,
          timestamp: new Date().toISOString()
        });
        return;
      }
    }
    
    // Log current song as skipped/completed before moving to next
    if (this.currentPlayLogId && this.currentTrack) {
      const wasSkipped = this.isPlaying; // If playing, it's being skipped
      await playbackTrackingService.logSongEnd(this.currentPlayLogId, {
        completed: !wasSkipped,
        skipped: wasSkipped,
        duration: this.audio?.currentTime ? Math.floor(this.audio.currentTime) : null
      });
      this.currentPlayLogId = null;
    }
    
    // Check if we're at the end of the playlist
    const isLastTrack = this.currentIndex === this.playlist.length - 1;
    
    if (isLastTrack) {
      this.playlistHasCompletedOnce = true;
      
      // Check if we should stop instead of looping
      if (this.stopWhenComplete && !this.loopPlaylist) {
        await this.switchToShuffle();
        return;
      }
      
      // If loop is disabled but stop_when_complete is false, also switch to shuffle
      if (!this.loopPlaylist) {
        await this.switchToShuffle();
        return;
      }
    }
    
    this.currentIndex = (this.currentIndex + 1) % this.playlist.length;
    await this.loadTrack(this.playlist[this.currentIndex]);
    
    if (this.isPlaying) {
      this.play();
    }
  }

  async previous() {
    if (this.playlist.length === 0) return;
    
    // Log current song as skipped before going to previous
    if (this.currentPlayLogId && this.currentTrack) {
      await playbackTrackingService.logSongEnd(this.currentPlayLogId, {
        completed: false,
        skipped: true,
        duration: this.audio?.currentTime ? Math.floor(this.audio.currentTime) : null
      });
      this.currentPlayLogId = null;
    }
    
    this.currentIndex = this.currentIndex === 0 ? this.playlist.length - 1 : this.currentIndex - 1;
    await this.loadTrack(this.playlist[this.currentIndex]);
    
    if (this.isPlaying) {
      this.play();
    }
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.audio.volume = this.volume;
    this.notifyListeners();
  }

  getState() {
    return {
      currentTrack: this.currentTrack,
      playlist: this.playlist,
      currentIndex: this.currentIndex,
      isPlaying: this.isPlaying,
      volume: this.volume,
      currentTime: this.audio?.currentTime || 0,
      duration: this.audio?.duration || 0,
      isInitialized: this.isInitialized,
      readyToPlay: this.readyToPlay,
      userInteracted: this.userInteracted,
      activeSchedule: this.activeSchedule,
      schedulesCount: this.schedules.length,
      currentTrackNumber: this.playlist.length ? this.currentIndex + 1 : 0,
      totalTracks: this.playlist.length,
      isShuffleAllMode: this.isShuffleAllMode || false,
      shuffleMode: this.shuffleMode || false,
      currentPlaylistId: this.currentPlaylistId || null,
      playlistInfo: this.playlistInfo || null,
      loopPlaylist: this.loopPlaylist,
      stopWhenComplete: this.stopWhenComplete,
    };
  }

  addListener(callback) {
    this.listeners.push(callback);
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) this.listeners.splice(index, 1);
    };
  }

  notifyListeners() {
    const state = this.getState();
    this.listeners.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        // Silent error handling
      }
    });
  }

  async destroy() {
    // Stop schedule monitoring
    if (this.scheduleInterval) {
      clearInterval(this.scheduleInterval);
      this.scheduleInterval = null;
    }
    
    if (this.scheduleReloadInterval) {
      clearInterval(this.scheduleReloadInterval);
      this.scheduleReloadInterval = null;
    }
    
    if (this.trackReloadInterval) {
      clearInterval(this.trackReloadInterval);
      this.trackReloadInterval = null;
    }
    
    if (this.midnightReloadTimeout) {
      clearTimeout(this.midnightReloadTimeout);
      this.midnightReloadTimeout = null;
    }
    
    // Unsubscribe from all realtime channels
    if (this.scheduleSubscription) {
      supabase.removeChannel(this.scheduleSubscription);
      this.scheduleSubscription = null;
    }
    
    if (this.playlistSubscription) {
      supabase.removeChannel(this.playlistSubscription);
      this.playlistSubscription = null;
    }
    
    if (this.trackSubscription) {
      supabase.removeChannel(this.trackSubscription);
      this.trackSubscription = null;
    }
    
    // Clear network monitoring
    if (this.networkCheckInterval) {
      clearInterval(this.networkCheckInterval);
      this.networkCheckInterval = null;
    }
    
    // Stop audio
    this.pause();
    if (this.audio) {
      this.audio.src = '';
    }
    
    // Stop keepalive
    this.stopKeepalive();
    
    // Log current song end if playing
    if (this.currentPlayLogId && this.currentTrack) {
      try {
        await playbackTrackingService.logSongEnd(this.currentPlayLogId, {
          completed: false,
          skipped: true,
          duration: this.audio?.currentTime ? Math.floor(this.audio.currentTime) : null
        });
      } catch (error) {
        // Silent error handling
      }
      this.currentPlayLogId = null;
    }
    
    // Clear listeners
    this.listeners = [];
    
    // Reset state
    this.isInitialized = false;
    this.businessId = null;
  }

  /**
   * Diagnostic function to check what's actually in the database
   */
  async diagnosticCheck() {
    if (!this.businessId) {
      console.error('❌ Cannot run diagnostic - no business ID');
      return null;
    }

    try {
      // Direct query to see ALL tracks in database for this business
      const { data: allDbTracks, error: dbError } = await supabase
        .from('music_tracks')
        .select('id, title, artist, include_in_shuffle, uploaded_at, business_id')
        .eq('business_id', this.businessId)
        .order('uploaded_at', { ascending: false });

      if (dbError) {
        console.error('❌ Database query error:', dbError);
        return null;
      }

      const shuffleDbTracks = allDbTracks.filter(t => t.include_in_shuffle);
      
      return {
        totalInDb: allDbTracks.length,
        shuffleInDb: shuffleDbTracks.length,
        nonShuffleInDb: allDbTracks.length - shuffleDbTracks.length,
        loadedTracks: this.tracks?.length || 0,
        businessId: this.businessId,
        allTracks: allDbTracks.map(t => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          include_in_shuffle: t.include_in_shuffle,
          uploaded_at: t.uploaded_at
        })),
        sampleTracks: allDbTracks.slice(0, 10).map(t => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          include_in_shuffle: t.include_in_shuffle,
          uploaded_at: t.uploaded_at
        }))
      };
    } catch (error) {
      console.error('❌ Diagnostic check failed:', error);
      return null;
    }
  }

  /**
   * Manually reload tracks from database
   * Useful for forcing an immediate refresh when new music is uploaded
   */
  async reloadTracks() {
    if (!this.businessId) {
      console.error('❌ Cannot reload tracks - no business ID set!');
      console.error('Current state:', {
        businessId: this.businessId,
        isInitialized: this.isInitialized,
        localStorage_businessId: localStorage.getItem('selectedBusinessId') || localStorage.getItem('currentBusinessId')
      });
      
      // Try to get businessId from localStorage as fallback
      const storedBusinessId = localStorage.getItem('selectedBusinessId') || localStorage.getItem('currentBusinessId');
      if (storedBusinessId) {
        console.log('🔄 Attempting to use businessId from localStorage:', storedBusinessId);
        this.businessId = storedBusinessId;
      } else {
        console.error('❌ No businessId available anywhere - cannot reload tracks');
        return { error: 'No businessId available', previousCount: 0, newCount: 0 };
      }
    }
    
    console.log('🔄 Manual track reload requested for business:', this.businessId);
    console.log('📋 Business ID sources:', {
      serviceBusinessId: this.businessId,
      localStorage_selected: localStorage.getItem('selectedBusinessId'),
      localStorage_current: localStorage.getItem('currentBusinessId')
    });
    
    const previousTrackCount = this.tracks?.length || 0;
    const previousTrackIds = new Set((this.tracks || []).map(t => t.id));
    
    // Run diagnostic BEFORE reload to see what's in DB
    console.log('🔍 Running diagnostic check...');
    const diagnostic = await this.diagnosticCheck();
    if (diagnostic) {
      console.log('📊 Database Diagnostic:', {
        'Total tracks in DB': diagnostic.totalInDb,
        'Shuffle tracks in DB': diagnostic.shuffleInDb,
        'Non-shuffle tracks in DB': diagnostic.nonShuffleInDb,
        'Currently loaded tracks': diagnostic.loadedTracks,
        'Business ID': diagnostic.businessId,
        'Sample tracks': diagnostic.sampleTracks
      });
      
      if (diagnostic.totalInDb > diagnostic.loadedTracks) {
        console.warn(`⚠️ MISMATCH: Database has ${diagnostic.totalInDb} tracks but only ${diagnostic.loadedTracks} are loaded!`);
        console.warn(`   This suggests tracks are being filtered out or businessId mismatch`);
      }
    }
    
    await this.loadTracks();
    
    const newTrackCount = this.tracks?.length || 0;
    const newTrackIds = new Set((this.tracks || []).map(t => t.id));
    
    // Find truly new tracks (by ID)
    const addedTracks = Array.from(newTrackIds).filter(id => !previousTrackIds.has(id));
    const removedTracks = Array.from(previousTrackIds).filter(id => !newTrackIds.has(id));
    
    // Run diagnostic AFTER reload to compare
    const diagnosticAfter = await this.diagnosticCheck();
    
    console.log('📊 Reload summary:', {
      previousCount: previousTrackCount,
      newCount: newTrackCount,
      added: addedTracks.length,
      removed: removedTracks.length,
      businessId: this.businessId,
      'DB total tracks': diagnosticAfter?.totalInDb,
      'DB shuffle tracks': diagnosticAfter?.shuffleInDb,
      'Loaded tracks': diagnosticAfter?.loadedTracks
    });
    
    if (newTrackCount > previousTrackCount) {
      console.log(`✅ Found ${newTrackCount - previousTrackCount} new tracks! (${addedTracks.length} by ID comparison)`);
      // If playlist is empty, load first track
      if (this.playlist.length > 0 && !this.currentTrack) {
        await this.loadFirstTrack();
        if (this.isKioskMode || this.userInteracted) {
          await this.attemptAutoPlay();
        }
      }
    } else if (newTrackCount === previousTrackCount) {
      if (addedTracks.length > 0 || removedTracks.length > 0) {
        console.log(`🔄 Tracks reloaded - same count but ${addedTracks.length} added, ${removedTracks.length} removed`);
      } else {
        console.log('✅ Tracks reloaded - no changes detected');
        
        // If diagnostic shows more tracks in DB, warn user
        if (diagnosticAfter && diagnosticAfter.totalInDb > newTrackCount) {
          console.error(`❌ PROBLEM DETECTED: Database has ${diagnosticAfter.totalInDb} tracks but only ${newTrackCount} are loaded!`);
          console.error(`   This means ${diagnosticAfter.totalInDb - newTrackCount} tracks are being filtered out.`);
          console.error(`   Check if tracks have include_in_shuffle=false or businessId mismatch`);
        }
      }
    } else {
      console.log(`⚠️ Track count decreased from ${previousTrackCount} to ${newTrackCount} (${removedTracks.length} removed)`);
    }
    
    this.notifyListeners();
    return { 
      previousCount: previousTrackCount, 
      newCount: newTrackCount, 
      added: addedTracks.length,
      removed: removedTracks.length,
      diagnostic: diagnosticAfter
    };
  }

  controls() {
    return {
      play: () => this.play(),
      pause: () => this.pause(),
      toggle: () => this.togglePlay(),
      next: () => this.next(),
      reloadTracks: () => this.reloadTracks(),
      previous: () => this.previous(),
      setVolume: (v) => this.setVolume(v),
    };
  }
}

export const globalMusicService = new GlobalMusicService();
if (typeof window !== 'undefined') {
  window.globalMusicService = globalMusicService;
}
export default globalMusicService;