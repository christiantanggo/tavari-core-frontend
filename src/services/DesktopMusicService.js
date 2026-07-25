// src/services/DesktopMusicService.js
// PHASE 3, STEP 94: Desktop Music Service - Wraps GlobalMusicService for Electron
// ⚠️ CONFLICT RESOLUTION: DesktopMusicService wraps (not extends) GlobalMusicService
// Purpose: Adds offline caching and preloading without modifying GlobalMusicService

import { globalMusicService } from './GlobalMusicService';
import { getElectronCacheService } from './ElectronCacheService';
import { supabase } from '../supabaseClient';

const OFFLINE_PACK_TRACK_LIMIT = 50;

class DesktopMusicService {
  constructor() {
    // Wrap GlobalMusicService - DO NOT extend it
    this.globalService = globalMusicService;
    this.originalLoadTrack = this.globalService.loadTrack.bind(this.globalService);
    
    // Cache service (only available in Electron)
    this.cacheService = null;
    this.isElectron = false;
    
    // Check if we're in Electron
    if (window.electronAPI) {
      this.isElectron = true;
      this.cacheService = getElectronCacheService(); // Returns null if not in Electron or cache unavailable
    }
    
    // Preloading state
    this.preloadQueue = [];
    this.isPreloading = false;
    
    // Track caching state
    this.cachingInProgress = new Set();
    this.offlinePackInProgress = false;
    this.offlinePackInitialized = false;
    this.offlinePackMode = false;
    this.offlineFallbackInProgress = false;
    
    // Listen to GlobalMusicService events
    this.patchGlobalTrackLoading();
    this.setupEventListeners();
    this.setupOfflineFallbackListeners();
  }

  isUnattendedKiosk() {
    return Boolean(
      window.__TAVARI_KIOSK_MODE__ === true ||
      window.location.hash.includes('/kiosk/music')
    );
  }

  isKioskStreamOnly() {
    if (!this.isUnattendedKiosk()) return false;
    return window.__TAVARI_KIOSK_STREAM_ONLY__ === true;
  }

  patchGlobalTrackLoading() {
    if (this.globalService.__desktopMusicLoadTrackPatched) {
      return;
    }

    // GlobalMusicService.next()/loadFirstTrack() call this.loadTrack internally.
    // Route those calls through the desktop wrapper so cached/offline files are
    // used after the first track too.
    this.globalService.loadTrack = async (track) => this.loadTrack(track);
    this.globalService.__desktopMusicLoadTrackPatched = true;
  }

  setupEventListeners() {
    // Listen to track changes to cache and preload
    this.globalService.addListener(() => {
      this.handleTrackChange();
    });
  }

  setupOfflineFallbackListeners() {
    if (!this.isElectron || !this.globalService?.audio || this.isKioskStreamOnly()) {
      return;
    }

    window.addEventListener('offline', () => {
      this.activateOfflinePack('browser-offline').catch((error) => {
        console.warn('Offline pack activation failed:', error);
      });
    });

    window.addEventListener('online', () => {
      if (!this.offlinePackMode) return;
      console.log('🎵 Internet restored - leaving offline pack after current cached playback cycle');
      this.offlinePackMode = false;
    });

    this.globalService.audio.addEventListener('error', () => {
      if (!this.isUnattendedKiosk() || this.offlineFallbackInProgress) {
        return;
      }

      this.activateOfflinePack('audio-error').catch((error) => {
        console.warn('Offline pack activation failed after audio error:', error);
      });
    });
  }

  async handleTrackChange() {
    if (!this.isElectron || !this.cacheService || this.isKioskStreamOnly()) {
      return;
    }

    const isUnattendedKiosk =
      window.__TAVARI_KIOSK_MODE__ === true ||
      window.location.hash.includes('/kiosk/music');
    
    const currentTrack = this.globalService.currentTrack;
    const playlist = this.globalService.playlist;
    const currentIndex = this.globalService.currentIndex;
    
    if (currentTrack) {
      // Cache current track in background
      this.cacheCurrentTrack(currentTrack).catch(error => {
        console.warn('Error caching current track:', error);
      });

      // Mini PCs have limited memory. Do not fan out background MP3 downloads
      // on the unattended kiosk; stream/cached current playback only.
      if (isUnattendedKiosk) {
        return;
      }
      
      // Preload next tracks
      if (playlist && playlist.length > 0) {
        this.preloadNextTracks(currentIndex, playlist).catch(error => {
          console.warn('Error preloading next tracks:', error);
        });
      }
    }
  }

  // Initialize - wraps GlobalMusicService.initialize
  async initialize(businessId) {
    const normalizedBusinessId =
      typeof businessId === 'string' ? businessId.trim() : '';

    if (!normalizedBusinessId || normalizedBusinessId === 'null' || normalizedBusinessId === 'undefined') {
      console.error('🖥️ [DesktopMusicService] Refusing to initialize without a valid businessId:', businessId);
      return { success: false, error: 'businessId is required' };
    }

    console.log('🖥️ [DesktopMusicService] Initializing with businessId:', normalizedBusinessId);

    // Initialize cache service before GlobalMusicService picks the first track
    // so internal loadTrack calls can use local files immediately.
    if (this.isElectron && this.cacheService) {
      try {
        await this.cacheService.initialize();
      } catch (error) {
        console.warn('Failed to initialize cache service:', error);
        // Continue without cache - not critical
      }
    }
    
    // Initialize GlobalMusicService first
    await this.globalService.initialize(normalizedBusinessId);
    
    // Verify businessId was set
    console.log('🖥️ [DesktopMusicService] After initialization:', {
      businessId: this.globalService.businessId,
      isInitialized: this.globalService.isInitialized,
      tracksCount: this.globalService.tracks?.length || 0,
      playlistCount: this.globalService.playlist?.length || 0
    });
    
    if (this.isUnattendedKiosk()) {
      if (!this.isKioskStreamOnly()) {
        this.ensureOfflinePack().catch((error) => {
          console.warn('Offline pack build failed:', error);
        });
      } else {
        console.log('🎵 Stream-only kiosk: skipping offline pack downloads');
      }
    }
    
    return { success: true };
  }

  // Load track - intercepts to check cache first
  async loadTrack(track) {
    if (!track) {
      return;
    }
    
    // Stream-only kiosk: never mirror MP3s to disk (prevents disk/OneDrive bloat).
    if (!this.isElectron || !this.cacheService || this.isKioskStreamOnly()) {
      return await this.originalLoadTrack(track);
    }
    
    try {
      // Check if track is cached
      const cachedPath = await this.cacheService.getCachedTrackPath(track.id);
      
      if (cachedPath) {
        // Use cached file - convert to file:// URL for Electron
        const fileUrl = `file://${cachedPath}`;
        this.globalService.audio.src = fileUrl;
        this.globalService.currentTrack = track;
        this.globalService.readyToPlay = true;
        this.globalService.notifyListeners();
        
        console.log('🎵 Using cached track:', track.title);
        return;
      }
      
      if (this.offlinePackMode) {
        const fallback = await this.activateOfflinePack('missing-offline-track');
        if (fallback) return;
      }
      
      // Not cached - use GlobalMusicService to load from network
      await this.originalLoadTrack(track);
      
      // Cache track in background (don't await)
      this.cacheCurrentTrack(track).catch(error => {
        console.warn('Error caching track after load:', error);
      });
      
    } catch (error) {
      console.error('Error in DesktopMusicService.loadTrack:', error);
      if (this.isUnattendedKiosk()) {
        const fallback = await this.activateOfflinePack('load-track-error');
        if (fallback) return;
      }
      // Fallback to GlobalMusicService
      await this.originalLoadTrack(track);
    }
  }

  // Cache current track
  async cacheCurrentTrack(track, options = {}) {
    if (!this.isElectron || !this.cacheService || !track || !track.id || this.isKioskStreamOnly()) {
      return { success: false };
    }
    
    // Check if already caching
    if (this.cachingInProgress.has(track.id)) {
      return { success: false, message: 'Already caching' };
    }
    
    // Check if already cached
    const isCached = await this.cacheService.isTrackCached(track.id);
    if (isCached) {
      return { success: true, cached: true };
    }

    if (this.isUnattendedKiosk()) {
      const stats = await this.cacheService.getCacheStatistics();
      const cachedIds = new Set((stats?.cachedTracks || []).map((item) => item.id).filter(Boolean));
      const libraryIds = new Set(this.getOfflinePackSourceTracks().map((item) => item.id));
      const cachedCount = Array.from(cachedIds).filter((id) => libraryIds.has(id)).length;
      if (cachedCount >= OFFLINE_PACK_TRACK_LIMIT && !options.offlinePackBuild) {
        return {
          success: true,
          cached: false,
          skipped: true,
          message: `Offline pack already has ${cachedCount} tracks`
        };
      }
    }
    
    this.cachingInProgress.add(track.id);
    
    try {
      // Get track URL from Supabase
      const { data } = supabase.storage
        .from('music-files')
        .getPublicUrl(track.file_path);
      
      if (!data || !data.publicUrl) {
        throw new Error('Failed to get track URL');
      }
      
      // Download and cache
      const result = await this.cacheService.downloadAndCacheTrack(
        track.id,
        data.publicUrl,
        {
          title: track.title,
          artist: track.artist,
          file_path: track.file_path,
          business_id: track.business_id
        }
      );
      
      return result;
    } catch (error) {
      console.error('Error caching track:', error);
      return { success: false, error: error.message };
    } finally {
      this.cachingInProgress.delete(track.id);
    }
  }

  // Preload next tracks
  async preloadNextTracks(currentIndex, playlist) {
    if (!this.isElectron || !this.cacheService || !playlist || !Array.isArray(playlist)) {
      return { success: true };
    }
    
    try {
      // Get next 3 track IDs
      const nextTrackIds = [];
      for (let i = 1; i <= 3; i++) {
        const index = currentIndex + i;
        if (index < playlist.length && playlist[index] && playlist[index].id) {
          nextTrackIds.push(playlist[index].id);
        }
      }
      
      if (nextTrackIds.length === 0) {
        return { success: true, preloaded: 0 };
      }
      
      // Preload tracks
      for (const trackId of nextTrackIds) {
        // Check if already cached
        const isCached = await this.cacheService.isTrackCached(trackId);
        if (isCached) {
          continue;
        }
        
        // Find track in playlist
        const track = playlist.find(t => t.id === trackId);
        if (!track) {
          continue;
        }
        
        // Cache in background (don't await)
        this.cacheCurrentTrack(track).catch(error => {
          console.warn('Error preloading track:', trackId, error);
        });
      }
      
      return { success: true, queued: nextTrackIds.length };
    } catch (error) {
      console.error('Error preloading next tracks:', error);
      return { success: false, error: error.message };
    }
  }

  async ensureOfflinePack() {
    if (!this.isElectron || !this.cacheService || !this.isUnattendedKiosk()) {
      return { success: false, reason: 'not_unattended_electron_kiosk' };
    }

    if (this.offlinePackInProgress) {
      return { success: true, reason: 'already_running' };
    }

    const sourceTracks = this.getOfflinePackSourceTracks();
    if (sourceTracks.length === 0) {
      return { success: false, reason: 'no_source_tracks' };
    }

    const stats = await this.cacheService.getCacheStatistics();
    const cachedTracks = Array.isArray(stats?.cachedTracks) ? stats.cachedTracks : [];
    const cachedIds = new Set(cachedTracks.map((track) => track.id).filter(Boolean));
    const sourceIds = new Set(sourceTracks.map((track) => track.id));
    const cachedSourceIds = new Set(
      Array.from(cachedIds).filter((trackId) => sourceIds.has(trackId))
    );

    if (cachedSourceIds.size >= OFFLINE_PACK_TRACK_LIMIT) {
      this.offlinePackInitialized = true;
      console.log(`🎵 Offline pack: ${cachedSourceIds.size}/${OFFLINE_PACK_TRACK_LIMIT} already cached, skipping download`);
      return { success: true, cached: cachedSourceIds.size, downloaded: 0 };
    }

    this.offlinePackInProgress = true;
    let downloaded = 0;

    try {
      console.log(`🎵 Offline pack: ${cachedSourceIds.size}/${OFFLINE_PACK_TRACK_LIMIT} cached, filling slowly...`);

      for (const track of sourceTracks) {
        if (cachedSourceIds.size >= OFFLINE_PACK_TRACK_LIMIT) break;
        if (!navigator.onLine) break;
        if (!track?.id || cachedSourceIds.has(track.id)) continue;

        const result = await this.cacheCurrentTrack(track, { offlinePackBuild: true });
        if (result?.success && !result.cached && !result.skipped) {
          downloaded += 1;
        }
        if (result?.success) {
          cachedSourceIds.add(track.id);
        }
      }

      this.offlinePackInitialized = cachedSourceIds.size >= OFFLINE_PACK_TRACK_LIMIT;
      console.log(`🎵 Offline pack: ${cachedSourceIds.size}/${OFFLINE_PACK_TRACK_LIMIT} cached (${downloaded} downloaded this run)`);
      return { success: true, cached: cachedSourceIds.size, downloaded };
    } finally {
      this.offlinePackInProgress = false;
    }
  }

  getOfflinePackSourceTracks() {
    const seen = new Set();
    const source = [
      ...(Array.isArray(this.globalService.tracks) ? this.globalService.tracks : []),
      ...(Array.isArray(this.globalService.playlist) ? this.globalService.playlist : [])
    ];

    return source.filter((track) => {
      if (!track?.id || !track.file_path || seen.has(track.id)) {
        return false;
      }
      seen.add(track.id);
      return true;
    });
  }

  async getCachedLibraryTracks(limit = OFFLINE_PACK_TRACK_LIMIT) {
    if (!this.cacheService) return [];

    const stats = await this.cacheService.getCacheStatistics();
    const cachedIds = new Set(
      (stats?.cachedTracks || []).map((track) => track.id).filter(Boolean)
    );
    if (cachedIds.size === 0) return [];

    const tracks = this.getOfflinePackSourceTracks()
      .filter((track) => cachedIds.has(track.id))
      .slice(0, limit);

    return this.shuffleCopy(tracks);
  }

  shuffleCopy(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  async activateOfflinePack(reason = 'offline') {
    if (!this.isElectron || !this.cacheService || this.offlineFallbackInProgress) {
      return false;
    }

    this.offlineFallbackInProgress = true;

    try {
      const offlineTracks = await this.getCachedLibraryTracks();
      if (offlineTracks.length === 0) {
        return false;
      }

      console.warn(`🎵 Offline pack active (${reason}) - looping ${offlineTracks.length} cached tracks`);
      this.offlinePackMode = true;
      this.globalService.playlist = offlineTracks;
      this.globalService.tracks = offlineTracks;
      this.globalService.currentIndex = 0;
      this.globalService.currentPlaylistId = null;
      this.globalService.playlistInfo = { name: 'Offline Pack', offline: true };
      this.globalService.activeSchedule = null;
      this.globalService.isShuffleAllMode = true;
      this.globalService.shuffleMode = true;
      this.globalService.loopPlaylist = true;
      this.globalService.stopWhenComplete = false;
      this.globalService.playlistHasCompletedOnce = false;
      this.globalService.userInteracted = true;

      await this.loadTrack(offlineTracks[0]);
      await this.globalService.play();
      this.globalService.notifyListeners();
      return true;
    } finally {
      this.offlineFallbackInProgress = false;
    }
  }

  // Proxy all other methods to GlobalMusicService
  // This ensures DesktopMusicService has the same API as GlobalMusicService
  
  // Proxy important properties (getters and setters)
  get businessId() {
    return this.globalService.businessId;
  }
  
  set businessId(value) {
    this.globalService.businessId = value;
  }
  
  get tracks() {
    return this.globalService.tracks;
  }
  
  get playlist() {
    return this.globalService.playlist;
  }
  
  get currentTrack() {
    return this.globalService.currentTrack;
  }
  
  get isInitialized() {
    return this.globalService.isInitialized;
  }
  
  get isPlaying() {
    return this.globalService.isPlaying;
  }
  
  get currentIndex() {
    return this.globalService.currentIndex;
  }
  
  get volume() {
    return this.globalService.volume;
  }
  
  set volume(value) {
    this.globalService.volume = value;
  }
  
  getState() {
    return this.globalService.getState();
  }

  addListener(callback) {
    return this.globalService.addListener(callback);
  }

  async play() {
    return await this.globalService.play();
  }

  pause() {
    return this.globalService.pause();
  }

  async next() {
    return await this.globalService.next();
  }

  async previous() {
    return await this.globalService.previous();
  }

  setVolume(volume) {
    return this.globalService.setVolume(volume);
  }

  getVolume() {
    return this.globalService.getVolume();
  }

  async loadPlaylist(playlistId) {
    return await this.globalService.loadPlaylist(playlistId);
  }

  async loadTracks() {
    return await this.globalService.loadTracks();
  }

  async reloadTracks() {
    return await this.globalService.reloadTracks();
  }

  async switchToScheduledPlaylist(playlistId, schedule) {
    return await this.globalService.switchToScheduledPlaylist(playlistId, schedule);
  }

  enableKioskMode() {
    return this.globalService.enableKioskMode();
  }

  destroy() {
    if (this.cacheService) {
      this.cacheService.destroy();
    }
    if (this.globalService) {
      return this.globalService.destroy();
    }
  }

  // Cache-specific methods (only available in Electron)
  async getCacheStats() {
    if (!this.isElectron || !this.cacheService) {
      return null;
    }
    return await this.cacheService.getCacheStatistics();
  }

  async clearCache() {
    if (!this.isElectron || !this.cacheService) {
      return { success: false, error: 'Not in Electron' };
    }
    return await this.cacheService.clearCache();
  }
}

// Create singleton instance
let desktopMusicServiceInstance = null;

export function getDesktopMusicService() {
  if (!desktopMusicServiceInstance) {
    desktopMusicServiceInstance = new DesktopMusicService();
  }
  return desktopMusicServiceInstance;
}

// Export the service
export const desktopMusicService = getDesktopMusicService();

export default DesktopMusicService;

