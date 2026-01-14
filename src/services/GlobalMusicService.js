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
      console.warn('⚠️ [GlobalMusicService] initialize called without businessId');
      return;
    }

    if (this.isInitialized && this.businessId === businessId) {
      console.log('✅ [GlobalMusicService] Already initialized with same business ID:', businessId);
      return;
    }

    if (this.isInitialized && this.businessId && this.businessId !== businessId) {
      console.log('🔄 [GlobalMusicService] Business ID changed, destroying old service:', this.businessId, '->', businessId);
      this.destroy();
    }

    console.log('🎵 [GlobalMusicService] Initializing with business ID:', businessId);
    this.businessId = businessId;
    
    // Check for kiosk mode flag from Electron or window
    if (window.__TAVARI_KIOSK_MODE__ || window.__TAVARI_ENABLE_AUTOPLAY__) {
      this.enableKioskMode();
    }

    try {
      // Load schedules FIRST before loading tracks
      // This ensures we check for active schedules before defaulting to shuffle
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
              .select('id, device_id, device_name, business_id, status')
              .eq('device_fingerprint', systemInfo.fingerprint)
              .eq('business_id', businessId)
              .eq('status', 'active')
              .maybeSingle();
            
            // If not found, try without business_id filter (in case it was registered to a different business)
            if (!data && !error) {
              const { data: data2, error: error2 } = await supabase
                .from('music_installations')
                .select('id, device_id, device_name, business_id, status')
                .eq('device_fingerprint', systemInfo.fingerprint)
                .eq('status', 'active')
                .maybeSingle();
              
              if (data2) {
                // Still use it if business matches or if we want to allow cross-business
                if (data2.business_id === businessId) {
                  data = data2;
                }
              }
            }
            
            if (!error && data) {
              installationId = data.id;
              deviceId = data.device_id;
            }
          }
        } catch (error) {
          // Silent error handling
        }
      }
      
      await playbackTrackingService.initialize(businessId, installationId, deviceId);
      
      // Set up network monitoring FIRST
      this.setupNetworkMonitoring();
      
      // Set up realtime subscriptions BEFORE starting schedule monitoring
      this.subscribeToScheduleChanges();
      this.subscribeToPlaylistChanges();
      this.subscribeToTrackChanges();
      this.subscribeToAnnouncements();
      this.subscribeToRemoteCommands();
      
      // Start aggressive schedule monitoring (realtime + polling hybrid)
      // This will check schedules immediately and switch if needed
      await this.startScheduleMonitoring();
      
      // Only load default tracks if no schedule is active
      // If a schedule activated, it will have already loaded the playlist
      if (!this.activeSchedule || !this.currentPlaylistId) {
        await this.loadTracks();
      }
      
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

    if (!this.businessId) {
      console.warn('📢 Cannot subscribe to announcements: no business ID');
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
          console.log('📢 Announcement received:', payload);
          await this.playAnnouncement(payload.payload);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('📢 ✅ Subscribed to announcements channel:', channelName);
        } else if (status === 'CHANNEL_ERROR') {
          console.error('📢 ❌ Failed to subscribe to announcements channel');
        }
      });
  }
  
  /**
   * Manually re-subscribe to announcements (useful after code updates)
   * Call this from browser console: window.globalMusicService.resubscribeAnnouncements()
   */
  resubscribeAnnouncements() {
    console.log('📢 Manually re-subscribing to announcements...');
    this.subscribeToAnnouncements();
  }

  /**
   * Play an announcement - pauses music, plays announcement, then resumes music
   */
  async playAnnouncement(announcementData) {
    if (!announcementData || this.isPlayingAnnouncement) {
      return; // Already playing an announcement or invalid data
    }

    // Store current music state OUTSIDE try block so it's available in finally
    const wasPlaying = this.isPlaying;
    
    try {
      this.isPlayingAnnouncement = true;
      
      this.musicVolumeBeforeAnnouncement = this.volume;
      
      // Pause music
      if (wasPlaying) {
        this.pause();
      }
      
      // Lower music volume to 20% if it was playing (ducking)
      if (wasPlaying && this.audio) {
        this.audio.volume = 0.2;
      }
      
      // Create announcement audio element if it doesn't exist
      if (!this.announcementAudio) {
        this.announcementAudio = new Audio();
        this.announcementAudio.volume = 1.0; // Announcements play at full volume
      }
      
      // Get audio URL from announcement data
      let audioUrl = null;
      
      if (announcementData.audioUrl) {
        // Direct URL provided
        audioUrl = announcementData.audioUrl;
      } else if (announcementData.file_path) {
        // File path provided - get signed URL
        const { data, error } = await supabase.storage
          .from('music-files')
          .createSignedUrl(announcementData.file_path, 3600);
        
        if (error || !data?.signedUrl) {
          throw new Error('Failed to get announcement audio URL');
        }
        
        audioUrl = data.signedUrl;
      } else if (announcementData.text) {
        // Text-to-speech announcement - would need TTS service
        console.warn('📢 Text-to-speech announcements not yet implemented');
        this.isPlayingAnnouncement = false;
        if (wasPlaying) {
          this.audio.volume = this.musicVolumeBeforeAnnouncement;
          await this.play();
        }
        return;
      } else {
        throw new Error('No audio source provided in announcement');
      }
      
      // Load and play announcement
      this.announcementAudio.src = audioUrl;
      
      await new Promise((resolve, reject) => {
        this.announcementAudio.onended = () => {
          resolve();
        };
        
        this.announcementAudio.onerror = (error) => {
          console.error('📢 Error playing announcement:', error);
          reject(error);
        };
        
        this.announcementAudio.play().catch(reject);
      });
      
      console.log('📢 Announcement finished playing');
      
    } catch (error) {
      console.error('📢 Error in playAnnouncement:', error);
    } finally {
      // Restore music state
      this.isPlayingAnnouncement = false;
      
      if (this.audio) {
        this.audio.volume = this.musicVolumeBeforeAnnouncement;
      }
      
      // Resume music if it was playing
      if (wasPlaying && this.audio) {
        await this.play();
      }
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
      console.error('📢 Error sending announcement:', error);
      throw error;
    }

    console.log('📢 Announcement sent to channel:', channelName);
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

    if (!this.businessId) {
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
          console.log('🎮 Remote command received:', payload);
          await this.handleRemoteCommand(payload.payload);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('🎮 ✅ Subscribed to remote commands channel:', channelName);
        } else if (status === 'CHANNEL_ERROR') {
          console.error('🎮 ❌ Failed to subscribe to remote commands channel');
        }
      });
  }

  /**
   * Handle remote commands from dashboard
   */
  async handleRemoteCommand(commandData) {
    if (!commandData || !commandData.action) {
      console.warn('🎮 Invalid remote command received');
      return;
    }

    try {
      switch (commandData.action) {
        case 'restart':
          console.log('🔄 Remote restart command received');
          await this.handleRemoteRestart(commandData);
          break;
        case 'resubscribe':
          console.log('🔄 Remote resubscribe command received');
          this.subscribeToAnnouncements();
          this.subscribeToRemoteCommands();
          break;
        default:
          console.warn('🎮 Unknown remote command:', commandData.action);
      }
    } catch (error) {
      console.error('🎮 Error handling remote command:', error);
    }
  }

  /**
   * Handle remote restart command
   */
  async handleRemoteRestart(commandData) {
    // If Electron app, use Electron API to restart
    if (window.electronAPI && window.electronAPI.restartApp) {
      console.log('🔄 Restarting Electron app via remote command...');
      try {
        await window.electronAPI.restartApp();
      } catch (error) {
        console.error('🔄 Error restarting Electron app:', error);
        // Fallback to page reload
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      }
    } else {
      // Web app - just reload the page
      console.log('🔄 Reloading page via remote command...');
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
      console.error('🎮 Error sending remote command:', error);
      throw error;
    }

    console.log('🎮 Remote command sent to channel:', channelName, commandData);
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
    if (!this.businessId) {
      return;
    }
    
    // Don't load tracks if we're in a scheduled playlist (not shuffle mode)
    // This prevents overwriting the scheduled playlist
    if (this.activeSchedule && !this.isShuffleAllMode && this.currentPlaylistId) {
      return;
    }
    
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
      
      // Add a small random delay to prevent caching issues
      const { data, error } = await query;

      if (error) {
        console.error('❌ [GlobalMusicService] Error loading tracks:', error);
        console.error('❌ [GlobalMusicService] Business ID:', this.businessId);
        console.error('❌ [GlobalMusicService] Query details:', {
          table: 'music_tracks',
          business_id: this.businessId,
          page,
          pageSize
        });
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
    
    // Filter to shuffle tracks (like MusicLibrary does in JavaScript)
    const shuffleTracks = allTracks.filter(t => t.include_in_shuffle !== false);
    const nonShuffleTracks = allTracks.filter(t => t.include_in_shuffle === false);
    
    // Use shuffle tracks if available, otherwise fall back to ALL tracks
    // This ensures shuffle mode works, but if no shuffle tracks exist, we still show all tracks
    // IMPORTANT: If include_in_shuffle is null/undefined, treat it as true (include in shuffle)
    // Only exclude tracks where include_in_shuffle is explicitly false
    this.tracks = shuffleTracks.length > 0 ? shuffleTracks : allTracks;
    
    // Log track loading results
    console.log('🎵 [GlobalMusicService] Track loading complete:', {
      businessId: this.businessId,
      totalInDb: allTracks.length,
      shuffleTracks: shuffleTracks.length,
      nonShuffleTracks: nonShuffleTracks.length,
      loadedTracks: this.tracks.length
    });
    
    // Log track filtering for debugging
    if (allTracks.length > 0 && this.tracks.length === 0) {
      console.warn('⚠️ All tracks filtered out!', {
        totalTracks: allTracks.length,
        shuffleTracks: shuffleTracks.length,
        nonShuffleTracks: nonShuffleTracks.length,
        sampleTrack: allTracks[0] ? {
          id: allTracks[0].id,
          title: allTracks[0].title,
          include_in_shuffle: allTracks[0].include_in_shuffle
        } : null
      });
    }
    
    if (allTracks.length === 0) {
      console.warn('⚠️ [GlobalMusicService] No tracks found in database for business:', this.businessId);
    }

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
   * 
   * ⚠️ CRITICAL: DO NOT MODIFY THIS FUNCTION UNLESS EXPLICITLY REQUESTED
   * This function sets up the schedule checking intervals. Any changes can break
   * schedule activation and cause music to not play at scheduled times.
   */
  async startScheduleMonitoring() {
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
          await this.checkSchedules();
          this.syncRetryCount = 0; // Reset on success
        } else {
          // Offline - use cached schedules
          await this.loadCachedSchedules();
          await this.checkSchedules();
        }
      } catch (error) {
        await this.loadCachedSchedules();
        await this.checkSchedules();
      }
    }, 30 * 1000); // 30 seconds - MUCH more aggressive

    // Check schedules for activation every 10 seconds (unchanged)
    this.scheduleInterval = setInterval(async () => {
      await this.checkSchedules();
    }, this.checkFrequency);

    // Check immediately on start
    await this.checkSchedules();
    
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
      this.isOnline = true;
      this.syncRetryCount = 0;
      this.loadSchedules().then(async () => {
        await this.cacheCurrentState();
        await this.checkSchedules();
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
          console.error(`📅 Error checking schedule ${schedule.id}:`, error);
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
        console.log(`📅 ✅ ACTIVATING schedule: ${bestSchedule.playlist?.name || bestSchedule.playlist_id} (Priority: ${bestSchedule.priority || 1})`);
        console.log(`📅 Schedule details:`, {
          id: bestSchedule.id,
          playlist_id: bestSchedule.playlist_id,
          start_time: bestSchedule.start_time,
          end_time: bestSchedule.end_time,
          schedule_date: bestSchedule.schedule_date,
          repeat_type: bestSchedule.repeat_type,
          day_of_week: bestSchedule.day_of_week
        });
        this.activeSchedule = bestSchedule;
        this.lastScheduleActivationDate = currentDate; // Track when it was activated
        try {
          await this.switchToScheduledPlaylist(bestSchedule.playlist_id, bestSchedule);
          console.log(`📅 ✅ Successfully switched to scheduled playlist: ${bestSchedule.playlist?.name || bestSchedule.playlist_id}`);
          await this.cacheCurrentState();
        } catch (error) {
          console.error(`📅 ❌ ERROR switching to scheduled playlist:`, error);
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
          if (!hasTracks || !hasCurrentTrack) {
            try {
              await this.switchToScheduledPlaylist(this.activeSchedule.playlist_id, this.activeSchedule);
              await this.cacheCurrentState();
            } catch (error) {
              console.error(`📅 ❌ ERROR reloading playlist:`, error);
            }
          } else if (!isActuallyPlaying && (this.userInteracted || this.isKioskMode)) {
            // Just ensure playback - don't reload the playlist
            try {
              await this.ensurePlayback();
            } catch (error) {
              console.error(`📅 ❌ ERROR starting playback:`, error);
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
            console.log(`📅 ⚠️ Schedule marked active but playlist mismatch! Current: ${this.currentPlaylistId}, Expected: ${this.activeSchedule.playlist_id}`);
            console.log(`📅 🔄 Forcing playlist switch to match active schedule...`);
            try {
              this.lastPlaylistSwitchTime = Date.now();
              await this.switchToScheduledPlaylist(this.activeSchedule.playlist_id, this.activeSchedule);
              console.log(`📅 ✅ Successfully corrected playlist to match active schedule`);
              await this.cacheCurrentState();
            } catch (error) {
              console.error(`📅 ❌ ERROR correcting playlist:`, error);
            }
          }
        }
      }
    } catch (error) {
      console.error(`📅 ❌ CRITICAL ERROR in checkSchedules:`, error);
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
      console.error(`📅 Error in isScheduleActive for schedule ${schedule.id}:`, error);
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
    console.log(`🔄 [switchToScheduledPlaylist] Starting switch to playlist: ${playlistId}`, { schedule });
    try {
      const { data: playlist, error: playlistError } = await supabase
        .from('music_playlists')
        .select('*')
        .eq('id', playlistId)
        .single();

      if (playlistError) {
        console.error(`❌ [switchToScheduledPlaylist] Error loading playlist:`, playlistError);
        throw playlistError;
      }
      
      console.log(`✅ [switchToScheduledPlaylist] Loaded playlist: ${playlist.name} (type: ${playlist.playlist_type})`);

      let tracks = [];
      
      // For both shuffle and ordered playlists, load tracks from the playlist_tracks junction table
      // The playlist_type only determines playback order, not which tracks to include
      const { data: playlistTracksData, error: playlistTracksError } = await supabase
        .from('music_playlist_tracks')
        .select('music_tracks(*)')
        .eq('playlist_id', playlistId)
        .order('sort_order');

      if (playlistTracksError) {
        console.error(`❌ [switchToScheduledPlaylist] Error loading playlist tracks:`, playlistTracksError);
        throw playlistTracksError;
      }
      
      tracks = playlistTracksData?.map(pt => pt.music_tracks).filter(t => t !== null) || [];
      
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

      console.log(`📦 [switchToScheduledPlaylist] Loaded ${tracks.length} tracks for playlist: ${playlist.name}`);

      if (tracks.length > 0) {
        await this.loadTrack(tracks[0]);
        console.log(`🎵 [switchToScheduledPlaylist] Loaded first track: ${tracks[0].title}`);
        
        // For scheduled playlists, always try to play (enable kiosk mode if needed)
        if (!this.isKioskMode && !this.userInteracted) {
          this.enableKioskMode();
        }
        
        if (this.userInteracted || this.isKioskMode) {
          await this.play();
          console.log(`▶️ [switchToScheduledPlaylist] Started playback`);
          
          // Ensure playback continues (handles autoplay blocking)
          setTimeout(() => {
            this.ensurePlayback();
          }, 500);
        } else {
          console.log(`⏸️ [switchToScheduledPlaylist] Waiting for user interaction before playing`);
        }
      } else {
        console.warn(`⚠️ [switchToScheduledPlaylist] Playlist ${playlist.name} has no tracks!`);
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

      console.log(`✅ [switchToScheduledPlaylist] Playlist switch complete: ${playlist.name} (${tracks.length} tracks)`);
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
    
    if (this.announcementSubscription) {
      supabase.removeChannel(this.announcementSubscription);
      this.announcementSubscription = null;
    }
    
    if (this.remoteCommandSubscription) {
      supabase.removeChannel(this.remoteCommandSubscription);
      this.remoteCommandSubscription = null;
    }
    
    // Clean up announcement audio
    if (this.announcementAudio) {
      this.announcementAudio.pause();
      this.announcementAudio.src = '';
      this.announcementAudio = null;
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
    if (!this.businessId) {
      // Try to get businessId from localStorage as fallback
      const storedBusinessId = localStorage.getItem('selectedBusinessId') || localStorage.getItem('currentBusinessId');
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