// services/GlobalMusicService.js - COMPLETE VERSION WITH REALTIME SUBSCRIPTIONS
//
// ⚠️⚠️⚠️ CRITICAL WARNING ⚠️⚠️⚠️
// 
// THIS FILE CONTAINS THE MUSIC SCHEDULE SYSTEM.
// DO NOT MODIFY THE FOLLOWING FUNCTIONS UNLESS EXPLICITLY REQUESTED:
//   - checkSchedules()
//   - isScheduleActive()
//   - startScheduleMonitoring()
//   - switchToScheduledPlaylist()
//
// These functions are critical for music schedules to work. Any modifications
// can cause schedules to fail to activate, resulting in music not playing
// at scheduled times. This has caused significant issues in the past.
//
// If you need to modify schedule logic, you MUST:
//   1. Get explicit approval from the user
//   2. Test thoroughly with all repeat types (once, daily, weekly, monthly)
//   3. Test with overnight schedules (e.g., 22:00 to 06:00)
//   4. Test with timezone edge cases
//   5. Verify schedules activate at the correct times
//
// Last verified working: [Current Date]
//
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
    this.lastPlaylistSwitchTime = 0; // Track when playlist was last switched to prevent rapid switching
    
    // Track reloading - poll for new tracks periodically
    this.trackReloadInterval = null;
    this.trackReloadFrequency = 5 * 60 * 1000; // 5 minutes - reload tracks to catch new uploads
    
    // Realtime subscriptions
    this.scheduleSubscription = null;
    this.playlistSubscription = null;
    this.trackSubscription = null;
    this.announcementSubscription = null;
    this.remoteCommandSubscription = null;
    
    // Announcement handling
    this.announcementAudio = null;
    /** Used for signed/cross-origin URLs only; never connected to Web Audio to avoid CORS silence. */
    this._announcementDirect = null;
    this.isPlayingAnnouncement = false;
    this.musicVolumeBeforeAnnouncement = 0.7;
    
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

    // Play announcement/ad every X songs (local ads only; does not touch schedule logic)
    this.songsPlayedSinceLastAd = 0;
    this.adEveryXSongsSettings = null; // { ad_frequency, local_ads_enabled }
    this.adSettingsCacheTime = 0;
    this.AD_SETTINGS_CACHE_MS = 60 * 1000;
    /** When true, play an ad after every 1 song (for testing). Overrides ad_frequency. */
    this.adTestModeEveryOneSong = false;
    /** True while we're fetching an ad in the ended handler so a second ended doesn't start another ad. */
    this._adPlayScheduled = false;
    /** True while playAnnouncementsThenNext is running; prevents overlapping ad runs. */
    this._announcementsInProgress = false;
    /** For round-robin: index into the ordered list of local ads (wraps). */
    this._localAdRoundRobinIndex = 0;
    /** Interval that force-stops music during ad block so it can never play behind ads. */
    this._adBlockMusicGuardInterval = null;

    this.setupAudio();
    this.setupUserInteraction();
  }

  normalizeBusinessId(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || normalized === 'null' || normalized === 'undefined') {
      return null;
    }
    return normalized;
  }

  hasValidBusinessId() {
    return Boolean(this.normalizeBusinessId(this.businessId));
  }

  setupAudio() {
    // CRITICAL: Only one music element must exist. Remove any existing (legacy or ours)
    // so we never have two elements both playing.
    ['global-audio-element', 'tavari-global-music-audio'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.pause();
        el.remove();
      }
    });
    this.audio = new Audio();
    this.audio.id = 'tavari-global-music-audio';
    this.audio.style.display = 'none';
    document.body.appendChild(this.audio);

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
      if (this.isPlayingAnnouncement || this._adPlayScheduled) return;
      this._adPlayScheduled = true;
      this.songsPlayedSinceLastAd += 1;
      this._forceStopMusic();
      try {
        if (this.currentPlayLogId) {
          await playbackTrackingService.logSongEnd(this.currentPlayLogId, {
            completed: true,
            skipped: false,
            duration: Math.floor(this.audio.duration || 0)
          });
          this.currentPlayLogId = null;
        }
        const settings = await this.getAdEveryXSongsSettings();
        const effectiveFrequency = this.adTestModeEveryOneSong ? 1 : (settings?.ad_frequency ?? 0);
        const adEnabled = this.adTestModeEveryOneSong || (settings?.ad_enabled && settings?.local_ads_enabled);
        if (adEnabled && effectiveFrequency > 0 && this.songsPlayedSinceLastAd >= effectiveFrequency) {
          this.songsPlayedSinceLastAd = 0;
          const adsPerSlot = Math.max(1, Math.min(10, settings?.ads_per_slot || 1));
          const ads = await this.getNextLocalAds(adsPerSlot);
          const withPath = ads.filter((a) => a?.file_path);
          if (withPath.length > 0) {
            await this.playAnnouncementsThenNext(withPath);
            return;
          }
        }
        await this.next();
        this.ensurePlayback();
      } catch (e) {
        await this.next();
        this.ensurePlayback();
      } finally {
        this._adPlayScheduled = false;
      }
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
    if (this.isPlayingAnnouncement || this._adPlayScheduled || this._announcementsInProgress) return;
    // Ensure music is playing if it should be
    if (!this.isInitialized || !this.businessId) {
      return;
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
    const normalizedBusinessId = this.normalizeBusinessId(businessId);
    if (!normalizedBusinessId) {
      console.error('🎵 Refusing to initialize music service without a valid businessId:', businessId);
      return { success: false, error: 'businessId is required' };
    }

    if (this.isInitialized && this.businessId === normalizedBusinessId) {
      return;
    }

    if (this.isInitialized && this.businessId && this.businessId !== normalizedBusinessId) {
      this.destroy();
    }

    this.businessId = normalizedBusinessId;
    
    // CRITICAL: Set app.current_business_id for RLS policies
    // This is required for music_playlist_tracks RLS to work correctly
    try {
      const { error: configError } = await supabase.rpc('exec_sql', {
        sql: `SELECT set_config('app.current_business_id', '${normalizedBusinessId}', false)`
      }).catch(() => ({ error: null })); // Silently fail if RPC doesn't exist
      
      if (!configError) {
        // RLS session variable set
      }
    } catch (e) {
      // RPC might not exist, use session variable
    }
    
    // Check for kiosk mode flag from Electron or window
    if (window.__TAVARI_KIOSK_MODE__ || window.__TAVARI_ENABLE_AUTOPLAY__) {
      this.enableKioskMode();
    }

    try {
      // CRITICAL: Ensure business ID is set before loading tracks
      if (!this.businessId) {
        throw new Error('businessId is required for initialization');
      }
      
      // CRITICAL: Load tracks FIRST (old working order)
      // This ensures tracks are always available, even if schedule check fails
      await this.loadTracks();
      
      // If loadTracks returned 0 tracks, continue (might be RLS or session issue)
      if (!this.tracks || this.tracks.length === 0) {
        try {
          await supabase.auth.getSession();
        } catch (e) {
          // Ignore session check errors
        }
      }
      
      await this.loadSchedules();
      
      // Initialize playback tracking service with installation context
      // Try to get installation ID if in Electron
      let installationId = null;
      let deviceId = null;
      
      if (window.electronAPI) {
        try {
          const systemInfo = await window.electronAPI.getSystemInfo();
          
          if (systemInfo?.fingerprint) {
            // First try with business_id filter
            let { data, error } = await supabase
              .from('music_installations')
              .select('id, device_name, business_id, status')
              .eq('device_fingerprint', systemInfo.fingerprint)
              .eq('business_id', normalizedBusinessId)
              .eq('status', 'active')
              .maybeSingle();
            
            // If not found, try without business_id filter (in case it was registered to a different business)
            if (!data && !error) {
              const { data: data2, error: error2 } = await supabase
                .from('music_installations')
                .select('id, device_name, business_id, status')
                .eq('device_fingerprint', systemInfo.fingerprint)
                .eq('status', 'active')
                .maybeSingle();
              
              if (data2) {
                if (data2.business_id === normalizedBusinessId) {
                  data = data2;
                }
              }
            }
            
            if (!error && data) {
              installationId = data.id;
              deviceId = null;
            }
          }
        } catch (error) {
          // Ignore installation lookup errors
        }
      } else {
        // Running in browser - use a stable browser-specific device ID for playback reporting
        try {
          deviceId = localStorage.getItem('music_v2_device_id');
          if (!deviceId) {
            deviceId = `browser-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
            localStorage.setItem('music_v2_device_id', deviceId);
          }
        } catch (error) {
          deviceId = `browser-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
        }
      }
      
      // Initializing playback tracking
      
      await playbackTrackingService.initialize(normalizedBusinessId, installationId, deviceId);
      
      // Set up network monitoring FIRST
      this.setupNetworkMonitoring();
      
      // Cache current data for offline use
      await this.cacheCurrentState();
      
      // Set up realtime subscriptions BEFORE starting schedule monitoring
      this.subscribeToScheduleChanges();
      this.subscribeToPlaylistChanges();
      this.subscribeToTrackChanges();
      this.subscribeToAnnouncements();
      this.subscribeToRemoteCommands();
      
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
      
      // Cache current data for offline use (after everything is set up)
      await this.cacheCurrentState();
      
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

    if (!this.hasValidBusinessId()) {
      return;
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
          await this.checkSchedules(shouldForce);

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

    if (!this.hasValidBusinessId()) {
      return;
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

    if (!this.hasValidBusinessId()) {
      return;
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
          // Always reload tracks when they change (new upload, update, or delete)
          if (this.isShuffleAllMode) {
            const previousTrackCount = this.tracks?.length || 0;
            await this.loadTracks();
            const newTrackCount = this.tracks?.length || 0;
            
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

  /**
   * Subscribe to announcement broadcasts for this business
   * When an announcement is sent, it will pause music, play the announcement, then resume
   * 
   * This can be called manually to re-subscribe if needed (e.g., after code update)
   */
  subscribeToAnnouncements() {
    // Unsubscribe from any existing subscription first
    if (this.announcementSubscription) {
      supabase.removeChannel(this.announcementSubscription);
      this.announcementSubscription = null;
    }

    if (!this.hasValidBusinessId()) {
      return;
    }

    const channelName = `music-announcements-${this.businessId}`;

    this.announcementSubscription = supabase
      .channel(channelName)
      .on(
        'broadcast',
        {
          event: 'announcement'
        },
        async (payload) => {
          await this.playAnnouncement(payload.payload);
        }
      )
      .subscribe(() => {});
  }
  
  /**
   * Manually re-subscribe to announcements (useful after code updates)
   * Call this from browser console: window.globalMusicService.resubscribeAnnouncements()
   */
  resubscribeAnnouncements() {
    this.subscribeToAnnouncements();
  }

  /**
   * Play an announcement - pauses music, plays announcement, then resumes music.
   * Uses the same single ad element and lock as song-ended ads so only one ad ever plays at a time.
   */
  async playAnnouncement(announcementData) {
    if (!announcementData) return;
    if (this._announcementsInProgress || this.isPlayingAnnouncement) return;
    this._announcementsInProgress = true;
    this.isPlayingAnnouncement = true;
    const wasPlaying = this.isPlaying;
    try {
      this._stopAnyPlayingAnnouncement();
      this.musicVolumeBeforeAnnouncement = this.volume;
      if (this.audio) {
        this.audio.volume = 0;
        this.audio.pause();
      }
      this.isPlaying = false;
      this.notifyListeners();

      let audioUrl = null;
      if (announcementData.audioUrl) {
        audioUrl = announcementData.audioUrl;
      } else if (announcementData.file_path) {
        const { data, error } = await supabase.storage
          .from('music-files')
          .createSignedUrl(announcementData.file_path, 3600);
        if (error || !data?.signedUrl) throw new Error('Failed to get announcement audio URL');
        audioUrl = data.signedUrl;
      } else if (announcementData.text) {
        this.isPlayingAnnouncement = false;
        this._announcementsInProgress = false;
        if (this.audio) this.audio.volume = this.musicVolumeBeforeAnnouncement;
        this.isPlaying = wasPlaying;
        this.notifyListeners();
        if (wasPlaying && this.audio) await this.play();
        return;
      } else {
        throw new Error('No audio source provided in announcement');
      }

      const adVolume = await this._getAdVolumeAdjustment();
      await this._playAnnouncementUrlDirect(audioUrl, adVolume);
    } catch (error) {
      // Announcement playback failed
    } finally {
      this.isPlayingAnnouncement = false;
      this._announcementsInProgress = false;
      if (this.audio) this.audio.volume = this.musicVolumeBeforeAnnouncement;
      this.isPlaying = wasPlaying;
      this.notifyListeners();
      if (wasPlaying && this.audio) await this.play();
    }
  }

  /**
   * Test mode: when true, an ad plays after every 1 song (overrides ad_frequency).
   * Use for testing announcement/ad flow without waiting for multiple songs.
   */
  setAdTestModeEveryOneSong(enabled) {
    this.adTestModeEveryOneSong = !!enabled;
  }

  getAdTestModeEveryOneSong() {
    return this.adTestModeEveryOneSong;
  }

  /**
   * Clear cached ad-every-X-songs settings so the next check refetches from the database.
   * Call this after saving ad settings in the UI so the running player uses the new values.
   */
  clearAdEveryXSongsSettingsCache() {
    this.adEveryXSongsSettings = null;
    this.adSettingsCacheTime = 0;
  }

  /**
   * Get ad-every-X-songs settings from music_settings (cached briefly).
   * Returns { ad_frequency: number, local_ads_enabled: boolean } or null.
   */
  async getAdEveryXSongsSettings() {
    const now = Date.now();
    if (this.adEveryXSongsSettings && (now - this.adSettingsCacheTime) < this.AD_SETTINGS_CACHE_MS) {
      return this.adEveryXSongsSettings;
    }
    if (!this.businessId) return null;
    try {
      const { data, error } = await supabase
        .from('music_settings')
        .select('ad_frequency, ad_enabled, ad_volume_adjustment, ad_selection_mode, ads_per_slot')
        .eq('business_id', this.businessId)
        .limit(1)
        .maybeSingle();
      if (error || !data) return null;
      const vol = data.ad_volume_adjustment != null ? parseFloat(data.ad_volume_adjustment) : 2;
      const mode = data.ad_selection_mode === 'round_robin' ? 'round_robin' : 'random';
      const perSlot = data.ads_per_slot != null ? Math.max(1, Math.min(10, parseInt(data.ads_per_slot, 10) || 1)) : 1;
      this.adEveryXSongsSettings = {
        ad_frequency: typeof data.ad_frequency === 'number' ? data.ad_frequency : parseInt(data.ad_frequency, 10) || 0,
        ad_enabled: data.ad_enabled !== false,
        local_ads_enabled: true,
        ad_volume_adjustment: (Number.isNaN(vol) || vol < 0.5 || vol > 2) ? 2 : vol,
        ad_selection_mode: mode,
        ads_per_slot: perSlot
      };
      this.adSettingsCacheTime = now;
      return this.adEveryXSongsSettings;
    } catch (e) {
      return null;
    }
  }

  /**
   * Get one active local ad for this business (for rotation, picks randomly from first 20).
   * Only returns ads whose schedule includes today (start_date <= today <= end_date; null = no limit).
   * If start_date/end_date columns are missing (schema not migrated), returns any active ad.
   */
  async getNextLocalAd() {
    if (!this.businessId) return null;
    try {
      const { data, error } = await supabase
        .from('music_local_ads')
        .select('id, file_path, start_date, end_date')
        .eq('business_id', this.businessId)
        .eq('active', true)
        .limit(50);
      if (error) {
        if (error.message && error.message.includes('start_date') || error.message?.includes('end_date')) {
          const fallback = await supabase
            .from('music_local_ads')
            .select('id, file_path')
            .eq('business_id', this.businessId)
            .eq('active', true)
            .limit(20);
          if (fallback.error || !fallback.data?.length) return null;
          const pick = fallback.data[Math.floor(Math.random() * fallback.data.length)];
          return pick;
        }
        return null;
      }
      if (!data?.length) return null;
      const today = new Date().toISOString().slice(0, 10);
      const scheduled = data.filter((ad) => {
        const startOk = ad.start_date == null || String(ad.start_date).slice(0, 10) <= today;
        const endOk = ad.end_date == null || String(ad.end_date).slice(0, 10) >= today;
        return startOk && endOk;
      });
      if (!scheduled.length) return null;
      const pick = scheduled[Math.floor(Math.random() * Math.min(20, scheduled.length))];
      return { id: pick.id, file_path: pick.file_path };
    } catch (e) {
      return null;
    }
  }

  /**
   * Get up to `count` local ads for this business. Uses ad_selection_mode (random vs round_robin).
   * Returns array of { id, file_path }. Only includes ads whose schedule includes today.
   */
  async getNextLocalAds(count = 1) {
    if (!this.businessId || count < 1) return [];
    const settings = await this.getAdEveryXSongsSettings();
    const mode = settings?.ad_selection_mode === 'round_robin' ? 'round_robin' : 'random';
    try {
      const { data, error } = await supabase
        .from('music_local_ads')
        .select('id, file_path, start_date, end_date')
        .eq('business_id', this.businessId)
        .eq('active', true)
        .order('id', { ascending: true })
        .limit(100);
      if (error) {
        if (error.message && (error.message.includes('start_date') || error.message.includes('end_date'))) {
          const fallback = await supabase
            .from('music_local_ads')
            .select('id, file_path')
            .eq('business_id', this.businessId)
            .eq('active', true)
            .order('id', { ascending: true })
            .limit(100);
          if (fallback.error || !fallback.data?.length) return [];
          return this._pickLocalAds(fallback.data, count, mode);
        }
        return [];
      }
      if (!data?.length) return [];
      const today = new Date().toISOString().slice(0, 10);
      const scheduled = data.filter((ad) => {
        const startOk = ad.start_date == null || String(ad.start_date).slice(0, 10) <= today;
        const endOk = ad.end_date == null || String(ad.end_date).slice(0, 10) >= today;
        return startOk && endOk;
      });
      return this._pickLocalAds(scheduled, count, mode);
    } catch (e) {
      return [];
    }
  }

  _pickLocalAds(scheduled, count, mode) {
    if (!scheduled?.length) return [];
    const take = Math.min(count, scheduled.length);
    let out = [];
    if (mode === 'round_robin') {
      const start = this._localAdRoundRobinIndex % scheduled.length;
      for (let i = 0; i < take; i++) {
        out.push(scheduled[(start + i) % scheduled.length]);
      }
      this._localAdRoundRobinIndex = (start + take) % scheduled.length;
    } else {
      const shuffled = [...scheduled].sort(() => Math.random() - 0.5);
      out = shuffled.slice(0, take);
    }
    const seen = new Set();
    const deduped = out.filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
    return deduped.map((a) => ({ id: a.id, file_path: a.file_path }));
  }

  /**
   * Boost for live ad/announcement playback (1.0 = normal, 2.0 = 200% of music).
   * Uses Web Audio API so we can go above the HTML5 Audio volume cap of 1.0.
   */
  static get AD_VOLUME_BOOST() {
    return 2;
  }

  /**
   * Force music to stop and stay silent. Call at start of ad block and repeatedly during ads.
   * Ensures music never plays behind ads even if another path tries to start it.
   */
  _forceStopMusic() {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.volume = 0;
  }

  /**
   * Start a guard interval that force-stops music every 150ms while ads are playing.
   * Stops music from ever playing behind ads (back-to-back or single).
   */
  _startAdBlockMusicGuard() {
    this._stopAdBlockMusicGuard();
    this._forceStopMusic();
    this._adBlockMusicGuardInterval = setInterval(() => {
      if (this.isPlayingAnnouncement || this._announcementsInProgress) {
        this._forceStopMusic();
      } else {
        this._stopAdBlockMusicGuard();
      }
    }, 150);
  }

  _stopAdBlockMusicGuard() {
    if (this._adBlockMusicGuardInterval) {
      clearInterval(this._adBlockMusicGuardInterval);
      this._adBlockMusicGuardInterval = null;
    }
  }

  /**
   * Stop any currently playing announcement on both ad elements so only one ad plays at a time.
   */
  _stopAnyPlayingAnnouncement() {
    if (this.announcementAudio) {
      this.announcementAudio.pause();
      this.announcementAudio.removeAttribute('src');
      this.announcementAudio.load();
    }
    if (this._announcementDirect) {
      this._announcementDirect.pause();
      this._announcementDirect.removeAttribute('src');
      this._announcementDirect.src = '';
      this._announcementDirect.load();
      this._announcementDirect.onended = null;
      this._announcementDirect.onerror = null;
    }
  }

  /**
   * Dispose the current ad element so the next play uses a fresh one.
   * Prevents compounded echo from reused element state across many ad plays.
   */
  _disposeAnnouncementDirect() {
    if (this._announcementDirect) {
      this._announcementDirect.pause();
      this._announcementDirect.removeAttribute('src');
      this._announcementDirect.src = '';
      this._announcementDirect.load();
      this._announcementDirect.onended = null;
      this._announcementDirect.onerror = null;
      this._announcementDirect = null;
    }
  }

  /**
   * Get ad volume multiplier from settings (1 = same as music, 2 = 200% of music). Uses cache.
   */
  async _getAdVolumeAdjustment() {
    const settings = await this.getAdEveryXSongsSettings();
    const v = settings?.ad_volume_adjustment;
    if (v == null || Number.isNaN(parseFloat(v))) return 2;
    const n = parseFloat(v);
    return (n >= 0.5 && n <= 2) ? n : 2;
  }

  /**
   * ONLY ad audio output: one HTML Audio element per ad play, then disposed.
   * When volumeAdjustment > 1, routes through Web Audio GainNode so announcements can play at 200% of music.
   */
  async _playAnnouncementUrlDirect(audioUrl, volumeAdjustment = 1) {
    this._stopAnyPlayingAnnouncement();
    this._forceStopMusic();
    this._disposeAnnouncementDirect();
    const el = new Audio();
    this._announcementDirect = el;
    const gainMultiplier = Math.max(0.5, Math.min(2, volumeAdjustment || 1));
    el.volume = gainMultiplier > 1 ? 1 : gainMultiplier;
    el.crossOrigin = 'anonymous';
    el.src = audioUrl;
    if (gainMultiplier > 1) {
      const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (Ctx) {
        try {
          const ctx = this._adAudioContext || new Ctx();
          if (!this._adAudioContext) this._adAudioContext = ctx;
          if (ctx.state === 'suspended') await ctx.resume();
          const source = ctx.createMediaElementSource(el);
          const gainNode = ctx.createGain();
          gainNode.gain.value = gainMultiplier;
          source.connect(gainNode);
          gainNode.connect(ctx.destination);
        } catch (e) {
          if (typeof console !== 'undefined' && console.warn) console.warn('[GlobalMusicService] ad gain setup failed', e);
        }
      }
    }
    return new Promise((resolve, reject) => {
      const done = (err) => {
        el.onended = null;
        el.onerror = null;
        if (err) reject(err);
        else resolve();
      };
      el.onended = () => done();
      el.onerror = (e) => done(e);
      this._forceStopMusic();
      el.play().catch(reject);
    });
  }

  /**
   * Play cross-origin URL with volume boost via fetch + decodeAudioData + GainNode (no CORS zeroes).
   */
  async _playAnnouncementUrlWithGain(audioUrl, gainValue) {
    const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!Ctx) throw new Error('Web Audio not supported');
    const ctx = this._adAudioContext || new Ctx();
    if (!this._adAudioContext) this._adAudioContext = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    const response = await fetch(audioUrl, { mode: 'cors' });
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    const source = ctx.createBufferSource();
    source.buffer = decoded;
    const gainNode = ctx.createGain();
    gainNode.gain.value = gainValue;
    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start(0);
    return new Promise((resolve) => {
      const durationMs = (decoded.duration || 30) * 1000;
      setTimeout(resolve, durationMs + 100);
    });
  }

  /**
   * Ensure announcement audio is routed through Web Audio API gain so we can boost volume.
   */
  _ensureAnnouncementGain() {
    if (!this.announcementAudio) return;
    if (this._announcementGainNode) return;
    try {
      const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!Ctx) return;
      if (!this._adAudioContext) this._adAudioContext = new Ctx();
      const ctx = this._adAudioContext;
      const source = ctx.createMediaElementSource(this.announcementAudio);
      const gainNode = ctx.createGain();
      gainNode.gain.value = GlobalMusicService.AD_VOLUME_BOOST;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      this._announcementGainNode = gainNode;
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[GlobalMusicService] announcement gain setup failed', e);
      }
    }
  }

  /**
   * Play an announcement then either resume the same track or advance to the next.
   * @param {Object} announcementData - { file_path } or { audioUrl }
   * @param {Object} [options] - { resumeSameTrack: boolean } When true (e.g. Test live), resume current song after ad; otherwise play next track.
   */
  async playAnnouncementThenNext(announcementData, options = {}) {
    if (!announcementData) return;
    if (this._announcementsInProgress || this.isPlayingAnnouncement) return;
    this._announcementsInProgress = true;
    this.isPlayingAnnouncement = true;
    const wasPlaying = this.isPlaying;
    const resumeSameTrack = options.resumeSameTrack === true;
    this._forceStopMusic();
    this._startAdBlockMusicGuard();
    try {
      this._stopAnyPlayingAnnouncement();
      this.musicVolumeBeforeAnnouncement = this.volume;
      this._forceStopMusic();
      this.isPlaying = false;
      this.notifyListeners();

      let audioUrl = null;
      if (announcementData.audioUrl) {
        audioUrl = announcementData.audioUrl;
      } else if (announcementData.file_path) {
        const { data, error } = await supabase.storage
          .from('music-files')
          .createSignedUrl(announcementData.file_path, 3600);
        if (error || !data?.signedUrl) throw new Error('Failed to get ad audio URL');
        audioUrl = data.signedUrl;
      } else {
        throw new Error('No audio source in announcement data');
      }
      const adVolume = await this._getAdVolumeAdjustment();
      await this._playAnnouncementUrlDirect(audioUrl, adVolume);
    } catch (e) {
      throw e;
    } finally {
      this._stopAdBlockMusicGuard();
      this.isPlayingAnnouncement = false;
      this._announcementsInProgress = false;
      if (this.audio) this.audio.volume = this.musicVolumeBeforeAnnouncement;
      this.isPlaying = wasPlaying;
      this.notifyListeners();
      if (resumeSameTrack) {
        if (wasPlaying && this.audio?.src) this.play().catch(() => {});
      } else {
        await this.next();
        this.ensurePlayback();
      }
    }
  }

  /**
   * Play multiple ads strictly one-after-another, then advance to the next music track.
   * Music and ads never play at the same time.
   * @param {Array<{ file_path: string }>} adsArray - Ads to play in order
   */
  async playAnnouncementsThenNext(adsArray) {
    if (!adsArray?.length) return;
    if (this._announcementsInProgress) return;
    this._announcementsInProgress = true;
    if (this.isPlayingAnnouncement) {
      this._announcementsInProgress = false;
      return;
    }
    this.isPlayingAnnouncement = true;
    const wasPlaying = this.isPlaying;
    this._forceStopMusic();
    this._startAdBlockMusicGuard();
    try {
      this._stopAnyPlayingAnnouncement();
      this.musicVolumeBeforeAnnouncement = this.volume;
      this._forceStopMusic();
      this.isPlaying = false;
      this.notifyListeners();

      const adVolume = await this._getAdVolumeAdjustment();
      for (let i = 0; i < adsArray.length; i++) {
        const ad = adsArray[i];
        if (!ad?.file_path) continue;
        this._forceStopMusic();
        const { data, error } = await supabase.storage
          .from('music-files')
          .createSignedUrl(ad.file_path, 3600);
        if (error || !data?.signedUrl) continue;
        this._forceStopMusic();
        await this._playAnnouncementUrlDirect(data.signedUrl, adVolume);
      }
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[GlobalMusicService] playAnnouncementsThenNext error', e);
      }
    } finally {
      this._stopAdBlockMusicGuard();
      this.isPlayingAnnouncement = false;
      this._announcementsInProgress = false;
      if (this.audio) this.audio.volume = this.musicVolumeBeforeAnnouncement;
      this.isPlaying = wasPlaying;
      this.notifyListeners();
      await this.next();
      this.ensurePlayback();
    }
  }

  /**
   * Send an announcement to all kiosks for this business
   * This is a static helper method that can be called from anywhere
   */
  static async sendAnnouncement(businessId, announcementData) {
    if (!businessId || !announcementData) {
      throw new Error('Business ID and announcement data are required');
    }

    const channelName = `music-announcements-${businessId}`;
    const channel = supabase.channel(channelName);
    
    const { error } = await channel.send({
      type: 'broadcast',
      event: 'announcement',
      payload: announcementData
    });

    if (error) {
      throw error;
    }

    return true;
  }

  /**
   * Subscribe to remote commands (restart, etc.) for this business
   * Allows dashboard to remotely control kiosks
   */
  subscribeToRemoteCommands() {
    // Unsubscribe from any existing subscription first
    if (this.remoteCommandSubscription) {
      supabase.removeChannel(this.remoteCommandSubscription);
      this.remoteCommandSubscription = null;
    }

    if (!this.hasValidBusinessId()) {
      return;
    }

    const channelName = `music-remote-commands-${this.businessId}`;

    this.remoteCommandSubscription = supabase
      .channel(channelName)
      .on(
        'broadcast',
        {
          event: 'command'
        },
        async (payload) => {
          await this.handleRemoteCommand(payload.payload);
        }
      )
      .subscribe(() => {});
  }

  /**
   * Handle remote commands from dashboard
   */
  async handleRemoteCommand(commandData) {
    if (!commandData || !commandData.action) {
      return;
    }

    try {
      switch (commandData.action) {
        case 'restart':
          await this.handleRemoteRestart(commandData);
          break;
        case 'resubscribe':
          this.subscribeToAnnouncements();
          this.subscribeToRemoteCommands();
          break;
        default:
          break;
      }
    } catch (error) {
      // Ignore remote command errors
    }
  }

  /**
   * Handle remote restart command
   */
  async handleRemoteRestart(commandData) {
    // If Electron app, use Electron API to restart
    if (window.electronAPI && window.electronAPI.restartApp) {
      try {
        await window.electronAPI.restartApp();
      } catch (error) {
        // Fallback to page reload
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      }
    } else {
      // Web app - just reload the page
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    }
  }

  /**
   * Send a remote command to all kiosks for this business
   * This is a static helper method that can be called from anywhere
   */
  static async sendRemoteCommand(businessId, commandData) {
    if (!businessId || !commandData || !commandData.action) {
      throw new Error('Business ID and command data with action are required');
    }

    const channelName = `music-remote-commands-${businessId}`;
    const channel = supabase.channel(channelName);
    
    const { error } = await channel.send({
      type: 'broadcast',
      event: 'command',
      payload: {
        ...commandData,
        timestamp: new Date().toISOString(),
        sentBy: 'dashboard'
      }
    });

    if (error) {
      throw error;
    }

    return true;
  }

  /**
   * Send a restart command to all kiosks
   */
  static async sendRemoteRestart(businessId, reason = 'Remote restart from dashboard') {
    return this.sendRemoteCommand(businessId, {
      action: 'restart',
      reason: reason
    });
  }

  async loadTracks() {
    if (!this.hasValidBusinessId()) {
      console.warn('🎵 Skipping track load without a valid businessId');
      return;
    }
    
    // Don't load tracks if we're in a scheduled playlist (not shuffle mode)
    // This prevents overwriting the scheduled playlist
    if (this.activeSchedule && !this.isShuffleAllMode && this.currentPlaylistId) {
      return;
    }
    
    const previousTracks = Array.isArray(this.tracks) ? this.tracks : [];
    const previousPlaylist = Array.isArray(this.playlist) ? this.playlist : [];

    // Load all tracks without pagination limit
    let allTracks = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

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
      
      const { data, error } = await query;

      if (error) {
        console.error('🎵 loadTracks query failed:', {
          message: error.message,
          code: error.code,
          businessId: this.businessId,
          hint: 'Music kiosk needs a valid Supabase login on this device (RLS).',
        });
        // Do not replace a known-good in-memory list with an empty list because
        // of a transient network/auth/RLS failure.
        if (previousTracks.length > 0) {
          return;
        }

        const recovered = this.restoreTracksFromCache();
        if (recovered) {
          return;
        }

        return;
      }

      if (data && data.length > 0) {
        allTracks = allTracks.concat(data);
        page++;
        hasMore = data.length === pageSize;
      } else {
        hasMore = false;
      }
    }
    
    if (allTracks.length === 0) {
      console.warn('🎵 loadTracks returned 0 rows for business:', this.businessId, {
        hint: 'Often caused by loading before JWT refresh completes, or RLS denying this user.',
      });
      if (previousTracks.length > 0 || previousPlaylist.length > 0) {
        // Empty responses can happen during session restore or brief Supabase/RLS
        // failures. Keep the music playing with the last known good state.
        return;
      }

      const recovered = this.restoreTracksFromCache();
      if (recovered) {
        return;
      }
    }

    // Filter to shuffle tracks (like MusicLibrary does in JavaScript)
    const shuffleTracks = allTracks.filter(t => t.include_in_shuffle);
    const nonShuffleTracks = allTracks.filter(t => !t.include_in_shuffle);
    
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
    }
    this.notifyListeners();
  }

  restoreTracksFromCache() {
    try {
      const cached = localStorage.getItem(`tavari_music_cache_${this.businessId}`);
      if (!cached) return false;

      const cacheData = JSON.parse(cached);
      const cachedTracks = cacheData?.currentPlaylist?.tracks || [];
      if (!Array.isArray(cachedTracks) || cachedTracks.length === 0) {
        return false;
      }

      this.tracks = cachedTracks;
      this.playlist = cachedTracks;
      this.currentIndex = Math.min(
        cacheData?.currentPlaylist?.currentIndex || 0,
        Math.max(cachedTracks.length - 1, 0)
      );
      this.isShuffleAllMode = true;
      this.shuffleMode = true;
      this.currentPlaylistId = cacheData?.currentPlaylist?.id || null;
      this.playlistInfo = cacheData?.currentPlaylist?.info || null;
      this.offlineCache = cacheData;
      this.notifyListeners();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Load schedules with retry logic and offline fallback
   */
  async loadSchedules() {
    if (!this.hasValidBusinessId()) {
      console.warn('🎵 Skipping schedule load without a valid businessId');
      return;
    }

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
   * - Fallback polling (2 minutes - backup when realtime fails)
   * - Frequent activation checks (10 seconds)
   * - Offline cache support
   * 
   * ⚠️ CRITICAL: DO NOT MODIFY THIS FUNCTION UNLESS EXPLICITLY REQUESTED
   * This function sets up the schedule checking intervals. Any changes can break
   * schedule activation and cause music to not play at scheduled times.
   */
  async startScheduleMonitoring() {
    if (!this.hasValidBusinessId()) {
      console.warn('🎵 Schedule monitoring blocked: missing valid businessId');
      if (this.scheduleInterval) {
        clearInterval(this.scheduleInterval);
        this.scheduleInterval = null;
      }
      if (this.scheduleReloadInterval) {
        clearInterval(this.scheduleReloadInterval);
        this.scheduleReloadInterval = null;
      }
      return;
    }

    if (this.scheduleInterval) {
      clearInterval(this.scheduleInterval);
    }
    if (this.scheduleReloadInterval) {
      clearInterval(this.scheduleReloadInterval);
    }

    // Fallback polling catches changes if realtime fails without hitting Supabase every 30 seconds.
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
    }, 2 * 60 * 1000);

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
      if (this.isOnline && this.hasValidBusinessId()) {
          const previousTrackCount = this.tracks?.length || 0;
          await this.loadTracks();
          const newTrackCount = this.tracks?.length || 0;
          
          if (newTrackCount > previousTrackCount) {
            // If we have a current track, keep playing - new tracks will be in the shuffle
            // If playlist is empty, load first track
            if (this.playlist.length > 0 && !this.currentTrack) {
              await this.loadFirstTrack();
              if (this.isKioskMode || this.userInteracted) {
                await this.attemptAutoPlay();
              }
            }
          } else if (newTrackCount < previousTrackCount) {
            // If current track was deleted, load next
            if (this.currentTrack && !this.playlist.find(t => t.id === this.currentTrack.id)) {
              await this.next();
            }
          }
          
          // Update cache
          await this.cacheCurrentState();
        }
      } catch (error) {
        // Silent error handling
      }
    }, this.trackReloadFrequency);
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
          }
        }
      }
      
      // Clear saved state
      localStorage.removeItem('_reload_resume_track');
    } catch (error) {
      localStorage.removeItem('_reload_resume_track');
    }
  }
  
  /**
   * Setup network status monitoring
   */
  setupNetworkMonitoring() {
    // Listen for online/offline events
    window.addEventListener('online', () => {
      if (!this.hasValidBusinessId()) {
        return;
      }

      this.isOnline = true;
      this.syncRetryCount = 0;
      this.loadSchedules().then(async () => {
        await this.cacheCurrentState();
        await this.checkSchedules();
      });
    });
    
    window.addEventListener('offline', () => {
      if (!this.hasValidBusinessId()) {
        return;
      }

      this.isOnline = false;
      this.loadCachedSchedules();
    });
    
    // Check network status periodically
    this.networkCheckInterval = setInterval(() => {
      const wasOnline = this.isOnline;
      this.isOnline = navigator.onLine;
      
      if (!wasOnline && this.isOnline && this.hasValidBusinessId()) {
        // Just came back online - sync immediately
        this.loadSchedules().then(async () => {
          await this.cacheCurrentState();
          await this.checkSchedules();
        });
      }
    }, 5000); // Check every 5 seconds
  }
  
  /**
   * Cache current state for offline use
   */
  async cacheCurrentState() {
    if (!this.hasValidBusinessId()) {
      return;
    }

    try {
      const existingCached = localStorage.getItem(`tavari_music_cache_${this.businessId}`);
      let existingCacheData = null;
      if (existingCached) {
        try {
          existingCacheData = JSON.parse(existingCached);
        } catch (error) {
          existingCacheData = null;
        }
      }

      const currentTracks = Array.isArray(this.playlist) ? this.playlist : [];
      const existingTracks = existingCacheData?.currentPlaylist?.tracks || [];
      if (currentTracks.length === 0 && Array.isArray(existingTracks) && existingTracks.length > 0) {
        // Never overwrite a working offline cache with an empty transient state.
        return;
      }

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
    if (!this.hasValidBusinessId()) {
      return false;
    }

    try {
      const cached = localStorage.getItem(`tavari_music_cache_${this.businessId}`);
      if (cached) {
        const cacheData = JSON.parse(cached);
        this.schedules = cacheData.schedules || [];
        this.activeSchedule = cacheData.activeSchedule;
        const cachedTracks = cacheData?.currentPlaylist?.tracks || [];
        if ((!this.playlist || this.playlist.length === 0) && cachedTracks.length > 0) {
          this.tracks = cachedTracks;
          this.playlist = cachedTracks;
          this.currentIndex = Math.min(
            cacheData?.currentPlaylist?.currentIndex || 0,
            Math.max(cachedTracks.length - 1, 0)
          );
        }
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
    
    this.midnightReloadTimeout = setTimeout(async () => {
      // Reload schedules at midnight
      await this.loadSchedules();
      // Reset activation date so recurring schedules can activate again
      this.lastScheduleActivationDate = null;
      // Check schedules immediately
      await this.checkSchedules();
      
      // Schedule next midnight reload
      this.setupDailyScheduleReload();
    }, msUntilMidnight);
  }

  /**
   * BULLETPROOF schedule checking - runs every 10 seconds
   * Handles offline mode and ensures immediate activation
   * 
   * ⚠️ CRITICAL: DO NOT MODIFY THIS FUNCTION UNLESS EXPLICITLY REQUESTED
   * This function is the core of the music schedule system. Any changes can break
   * schedule activation and cause music to not play at scheduled times.
   */
  async checkSchedules(force = false) {
    try {
      // Ensure we have schedules (load from cache if needed, or reload if online)
      if (!this.schedules || this.schedules.length === 0) {
        if (this.isOnline) {
          // Try to reload schedules if online
          await this.loadSchedules();
          // If still no schedules, return early
          if (!this.schedules || this.schedules.length === 0) {
            return;
          }
        } else {
          // Offline - try cache
          await this.loadCachedSchedules();
          if (!this.schedules || this.schedules.length === 0) {
            return;
          }
        }
      }
      
      // Get current time/date info - use local time consistently
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const currentDate = `${year}-${month}-${day}`;
      const currentTime = now.getHours() * 60 + now.getMinutes();
      const currentDay = now.getDay();

      // Filter to find active schedules
      const activeSchedules = (this.schedules || []).filter(schedule => {
        try {
          return this.isScheduleActive(schedule, currentTime, currentDate, currentDay);
        } catch (error) {
          return false;
        }
      });

      // If no active schedules, clear current schedule and switch to shuffle
      if (activeSchedules.length === 0) {
        if (this.activeSchedule) {
          // Schedule has ended - clear it so it can activate again tomorrow
          this.activeSchedule = null;
          this.lastScheduleActivationDate = null;
          await this.switchToShuffle();
          await this.cacheCurrentState();
        }
        return;
      }

      // Select best schedule by priority (higher priority wins, then most recent)
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
      // 4. **CRITICAL**: Current playlist doesn't match the active schedule's playlist (playlist was switched manually or lost)
      const hasNoActiveSchedule = !this.activeSchedule;
      const differentPlaylist = this.activeSchedule && this.activeSchedule.playlist_id !== bestSchedule.playlist_id;
      const differentScheduleId = this.activeSchedule && this.activeSchedule.id !== bestSchedule.id;
      const sameScheduleDifferentDay = this.activeSchedule && 
        this.activeSchedule.id === bestSchedule.id && 
        this.lastScheduleActivationDate !== currentDate;
      
      // CRITICAL FIX: Check if current playlist matches the active schedule
      // If activeSchedule exists but currentPlaylistId doesn't match, we need to switch!
      const playlistMismatch = this.activeSchedule && 
        this.activeSchedule.id === bestSchedule.id &&
        this.currentPlaylistId !== bestSchedule.playlist_id &&
        !this.isShuffleAllMode; // Only check if we're not in shuffle mode

      const shouldActivate = force ||
        hasNoActiveSchedule ||
        differentPlaylist ||
        differentScheduleId ||
        sameScheduleDifferentDay ||
        playlistMismatch;

      if (shouldActivate) {
        this.activeSchedule = bestSchedule;
        this.lastScheduleActivationDate = currentDate; // Track when it was activated
        try {
          await this.switchToScheduledPlaylist(bestSchedule.playlist_id, bestSchedule);
          await this.cacheCurrentState();
        } catch (error) {
          // Don't throw - allow retry on next check
        }
      } else {
        // Schedule is already active - only verify playback, don't switch unless absolutely necessary
        if (this.activeSchedule && 
            this.currentPlaylistId === this.activeSchedule.playlist_id &&
            !this.isShuffleAllMode) {
          // Playlist matches - just ensure playback is happening
          const hasTracks = this.playlist && this.playlist.length > 0;
          const isActuallyPlaying = this.isPlaying && this.audio && !this.audio.paused;
          const hasCurrentTrack = this.currentTrack !== null;
          
          // Only reload if we have no tracks or no current track
          // Add a debounce to prevent rapid reloads (max once per 10 seconds)
          const lastReloadKey = `last_reload_${this.activeSchedule.playlist_id}`;
          const lastReloadTime = this[lastReloadKey] || 0;
          const timeSinceLastReload = Date.now() - lastReloadTime;
          
          if ((!hasTracks || !hasCurrentTrack) && timeSinceLastReload > 10000) {
            try {
              this[lastReloadKey] = Date.now(); // Update reload timestamp
              await this.switchToScheduledPlaylist(this.activeSchedule.playlist_id, this.activeSchedule);
              await this.cacheCurrentState();
            } catch (error) {
              // Ignore reload errors
            }
          } else if (!isActuallyPlaying && (this.userInteracted || this.isKioskMode)) {
            // Just ensure playback - don't reload the playlist
            try {
              await this.ensurePlayback();
            } catch (error) {
              // Ignore playback errors
            }
          }
        } else if (this.activeSchedule && 
                   this.currentPlaylistId !== this.activeSchedule.playlist_id && 
                   !this.isShuffleAllMode) {
          // Playlist mismatch - but only switch if we're not in the middle of switching
          // Add a small delay to prevent rapid switching
          const lastSwitchTime = this.lastPlaylistSwitchTime || 0;
          const timeSinceLastSwitch = Date.now() - lastSwitchTime;
          
          if (timeSinceLastSwitch > 5000) { // Only switch if it's been at least 5 seconds since last switch
            try {
              this.lastPlaylistSwitchTime = Date.now();
              await this.switchToScheduledPlaylist(this.activeSchedule.playlist_id, this.activeSchedule);
              await this.cacheCurrentState();
            } catch (error) {
              // Ignore correction errors
            }
          }
        }
      }
    } catch (error) {
      // Don't throw - allow retry on next interval
    }
  }

  /**
   * Check if a schedule is currently active based on time, date, and day constraints
   * 
   * ⚠️ CRITICAL: DO NOT MODIFY THIS FUNCTION UNLESS EXPLICITLY REQUESTED
   * This function determines when schedules activate. Any changes can break
   * schedule activation and cause music to not play at scheduled times.
   * 
   * @param {Object} schedule - The schedule object from database
   * @param {number} currentTime - Current time in minutes since midnight (0-1439)
   * @param {string} currentDate - Current date in YYYY-MM-DD format
   * @param {number} currentDay - Current day of week (0=Sunday, 6=Saturday)
   * @returns {boolean} - True if schedule should be active now
   */
  isScheduleActive(schedule, currentTime, currentDate, currentDay) {
    try {
      // First check if time matches
      const startTime = this.timeToMinutes(schedule.start_time);
      const endTime = this.timeToMinutes(schedule.end_time);

      let timeMatch = false;
      if (startTime === endTime) {
        // Same start/end time means it's a single moment - allow 1 minute tolerance
        timeMatch = Math.abs(currentTime - startTime) <= 1;
      } else if (startTime < endTime) {
        // Normal case: start < end (e.g., 09:00 to 17:00)
        timeMatch = currentTime >= startTime && currentTime < endTime;
      } else {
        // Overnight case: start > end (e.g., 22:00 to 06:00)
        timeMatch = currentTime >= startTime || currentTime < endTime;
      }

      if (!timeMatch) {
        return false;
      }

      // If schedule has schedule_date, use date-based logic
      if (schedule.schedule_date) {
        // Parse dates using local timezone to avoid timezone issues
        // Use YYYY-MM-DD format directly for comparison to avoid timezone conversion
        const scheduleDateStr = schedule.schedule_date;
        const scheduleDateParts = scheduleDateStr.split('-');
        const currentDateParts = currentDate.split('-');
        
        // Compare dates as integers (YYYYMMDD) to avoid timezone issues
        const scheduleDateInt = parseInt(scheduleDateParts[0] + scheduleDateParts[1] + scheduleDateParts[2]);
        const currentDateInt = parseInt(currentDateParts[0] + currentDateParts[1] + currentDateParts[2]);
        
        // Check if repeat_until date has passed
        if (schedule.repeat_until) {
          const repeatUntilParts = schedule.repeat_until.split('-');
          const repeatUntilInt = parseInt(repeatUntilParts[0] + repeatUntilParts[1] + repeatUntilParts[2]);
          if (currentDateInt > repeatUntilInt) {
            return false;
          }
        }

        // Check repeat_type
        if (schedule.repeat_type === 'once') {
          // One-time schedule: must match exact date
          return scheduleDateStr === currentDate;
        } 
      
        if (schedule.repeat_type === 'daily') {
          // Daily: current date must be >= schedule start date
          return currentDateInt >= scheduleDateInt;
        } 
      
        if (schedule.repeat_type === 'weekly') {
          // Weekly: current date must be >= schedule start date AND
          // current day of week must match the day of week from schedule_date
          if (currentDateInt < scheduleDateInt) {
            return false; // Not started yet
          }
          
          // Get day of week from the original schedule_date
          // Use the date string to create a date object and get its day of week
          const scheduleDateObj = new Date(scheduleDateStr + 'T12:00:00'); // Use noon to avoid timezone edge cases
          const scheduleDayOfWeek = scheduleDateObj.getDay();
          
          // Check if current day matches the schedule's day of week
          return currentDay === scheduleDayOfWeek;
        }
      
        if (schedule.repeat_type === 'monthly') {
          // Monthly: current date must be >= schedule start date AND
          // day of month must match (e.g., 15th of every month)
          if (currentDateInt < scheduleDateInt) {
            return false; // Not started yet
          }
          
          // Get day of month from schedule_date
          const scheduleDayOfMonth = parseInt(scheduleDateParts[2]);
          const currentDayOfMonth = parseInt(currentDateParts[2]);
          
          return currentDayOfMonth === scheduleDayOfMonth;
        }
        
        // If schedule_date exists but no repeat_type matches, return false
        return false;
      }

      // If no schedule_date, check day_of_week (legacy format)
      if (schedule.day_of_week !== null && schedule.day_of_week !== undefined) {
        return currentDay === schedule.day_of_week;
      }

      // If no date or day constraints, schedule is always active (time already matched)
      return true;
    } catch (error) {
      return false; // Fail safe: don't activate if there's an error
    }
  }

  timeToMinutes(timeString) {
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours * 60 + minutes;
  }

  /**
   * Switch to a scheduled playlist
   * 
   * ⚠️ CRITICAL: DO NOT MODIFY THIS FUNCTION UNLESS EXPLICITLY REQUESTED
   * This function handles switching to scheduled playlists. Any changes can break
   * schedule activation and cause music to not play at scheduled times.
   */
  async switchToScheduledPlaylist(playlistId, schedule = null) {
    try {
      const { data: playlist, error: playlistError } = await supabase
        .from('music_playlists')
        .select('*')
        .eq('id', playlistId)
        .single();

      if (playlistError) {
        throw playlistError;
      }

      let tracks = [];
      
      // For shuffle playlists, load tracks dynamically from music_tracks based on include_in_shuffle
      // For ordered playlists, load from playlist_tracks junction table
      if (playlist.playlist_type === 'shuffle') {
        const { data: shuffleTracks, error: shuffleError } = await supabase
          .from('music_tracks')
          .select('*')
          .eq('business_id', this.businessId)
          .eq('include_in_shuffle', true);
        
        if (shuffleError) {
          throw shuffleError;
        }
        
        tracks = shuffleTracks || [];
      } else {
        // For ordered playlists, load from playlist_tracks junction table
        const { data: playlistTracksData, error: playlistTracksError } = await supabase
          .from('music_playlist_tracks')
          .select('music_tracks(*), track_id, sort_order')
          .eq('playlist_id', playlistId)
          .order('sort_order');

        if (playlistTracksError) {
          // Try alternative query without nested select
          const { data: trackIds, error: idsError } = await supabase
            .from('music_playlist_tracks')
            .select('track_id, sort_order')
            .eq('playlist_id', playlistId)
            .order('sort_order');
          
          if (!idsError && trackIds && trackIds.length > 0) {
            const trackIdList = trackIds.map(pt => pt.track_id).filter(Boolean);
            const { data: tracksData, error: tracksError } = await supabase
              .from('music_tracks')
              .select('*')
              .in('id', trackIdList)
              .eq('business_id', this.businessId);
            
            if (!tracksError && tracksData) {
              // Sort by original order
              const trackMap = {};
              tracksData.forEach(t => trackMap[t.id] = t);
              tracks = trackIds.map(pt => trackMap[pt.track_id]).filter(t => t !== null);
            } else {
              throw playlistTracksError; // Throw original error
            }
          } else {
            throw playlistTracksError;
          }
        } else {
          tracks = playlistTracksData?.map(pt => pt.music_tracks).filter(t => t !== null && t !== undefined) || [];
        }
      }

      if (tracks.length === 0 && this.playlist?.length > 0) {
        // A scheduled playlist query can briefly return empty during auth/RLS/network
        // recovery. Do not wipe an active playlist because of that transient state.
        return;
      }
      
      // If playlist type is shuffle, randomize the order
      if (playlist.playlist_type === 'shuffle') {
        this.shuffleArray(tracks);
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
        
        // For scheduled playlists, always try to play (enable kiosk mode if needed)
        if (!this.isKioskMode && !this.userInteracted) {
          this.enableKioskMode();
        }
        
        if (this.userInteracted || this.isKioskMode) {
          await this.play();
          
          // Ensure playback continues (handles autoplay blocking)
          setTimeout(() => {
            this.ensurePlayback();
          }, 500);
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
      this.lastPlaylistSwitchTime = Date.now(); // Track when we switched to prevent rapid re-switching

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
    if (this.isPlayingAnnouncement || this._announcementsInProgress) {
      this._forceStopMusic();
      return;
    }
    if (!this.readyToPlay || !this.currentTrack) {
      await this.loadFirstTrack();
    }

    if (!this.audio || !this.audio.src) {
      return;
    }

    this._pauseOtherMusicElements();
    try {
      await this.audio.play();
      this.isPlaying = true;
      this.notifyListeners();
    } catch (error) {
      this.isPlaying = false;
      this.notifyListeners();
    }
  }

  /**
   * Pause any audio element that could be playing music (same id) so only one plays.
   */
  _pauseOtherMusicElements() {
    const ourId = this.audio?.id;
    if (!ourId) return;
    document.querySelectorAll('audio').forEach((el) => {
      if (el !== this.audio && (el.id === ourId || el.id === 'global-audio-element')) {
        el.pause();
        el.currentTime = 0;
      }
    });
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
    if (this.playlist.length === 0) return;
    
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
    if (this.audio) this.audio.volume = this.volume;
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
    if (!this.isPlayingAnnouncement && !this._announcementsInProgress) {
      this.audio.volume = this.volume;
    }
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
    
    if (this.announcementSubscription) {
      supabase.removeChannel(this.announcementSubscription);
      this.announcementSubscription = null;
    }
    
    if (this.remoteCommandSubscription) {
      supabase.removeChannel(this.remoteCommandSubscription);
      this.remoteCommandSubscription = null;
    }
    
    this._adPlayScheduled = false;
    if (this.announcementAudio) {
      this.announcementAudio.pause();
      this.announcementAudio.src = '';
      this.announcementAudio = null;
    }
    if (this._announcementDirect) {
      this._announcementDirect.pause();
      this._announcementDirect.removeAttribute('src');
      this._announcementDirect = null;
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
    this._stopAdBlockMusicGuard();
    
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
      return null;
    }
  }

  /**
   * Manually reload tracks from database
   * Useful for forcing an immediate refresh when new music is uploaded
   */
  async reloadTracks() {
    if (!this.hasValidBusinessId()) {
      // Try to get businessId from localStorage as fallback
      const storedBusinessId =
        this.normalizeBusinessId(localStorage.getItem('tavariPinnedBusinessId')) ||
        this.normalizeBusinessId(localStorage.getItem('selectedBusinessId')) ||
        this.normalizeBusinessId(localStorage.getItem('currentBusinessId'));
      if (storedBusinessId) {
        this.businessId = storedBusinessId;
      } else {
        return { error: 'No businessId available', previousCount: 0, newCount: 0 };
      }
    }
    
    const previousTrackCount = this.tracks?.length || 0;
    const previousTrackIds = new Set((this.tracks || []).map(t => t.id));
    
    // Run diagnostic BEFORE reload to see what's in DB
    const diagnostic = await this.diagnosticCheck();
    
    await this.loadTracks();
    
    const newTrackCount = this.tracks?.length || 0;
    const newTrackIds = new Set((this.tracks || []).map(t => t.id));
    
    // Find truly new tracks (by ID)
    const addedTracks = Array.from(newTrackIds).filter(id => !previousTrackIds.has(id));
    const removedTracks = Array.from(previousTrackIds).filter(id => !newTrackIds.has(id));
    
    // Run diagnostic AFTER reload to compare
    const diagnosticAfter = await this.diagnosticCheck();
    
    if (newTrackCount > previousTrackCount) {
      // If playlist is empty, load first track
      if (this.playlist.length > 0 && !this.currentTrack) {
        await this.loadFirstTrack();
        if (this.isKioskMode || this.userInteracted) {
          await this.attemptAutoPlay();
        }
      }
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