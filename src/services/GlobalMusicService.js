// services/GlobalMusicService.js - COMPLETE WORKING VERSION
import { supabase } from '../supabaseClient';

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
    this.activeSchedule = null;
    this.schedules = [];
    this.checkFrequency = 10000; // 10 seconds

    // Auto-play handling
    this.userInteracted = false;
    this.autoPlayEnabled = true;

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
      this.notifyListeners();
    });

    this.audio.addEventListener('pause', () => {
      if (!this.audio.ended) {
        this.isPlaying = false;
        this.notifyListeners();
      }
    });

    this.audio.addEventListener('ended', () => {
      this.next();
    });

    this.audio.addEventListener('error', () => {
      this.next();
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
    };

    ['click', 'keydown', 'touchstart'].forEach(event => {
      document.addEventListener(event, handleInteraction, { once: true });
    });
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

    try {
      await this.loadTracks();
      await this.loadSchedules();
      this.startScheduleMonitoring();

      if (this.playlist.length > 0) {
        await this.loadFirstTrack();
        this.attemptAutoPlay();
      }

      this.isInitialized = true;
    } catch (error) {
    }
  }

  async loadTracks() {
    if (!this.businessId) {
      console.error('[loadTracks] Cannot load tracks - businessId is not set!');
      return;
    }

    const { data, error } = await supabase
      .from('music_tracks')
      .select('*')
      .eq('business_id', this.businessId)
      .eq('include_in_shuffle', true);

    if (error) {
      console.error('[loadTracks] Error loading tracks:', error);
      return;
    }

    this.playlist = data || [];
    this.isShuffleAllMode = true;
    this.shuffleMode = true;
    this.currentPlaylistId = null;
    this.playlistInfo = null;
    
    if (this.playlist.length > 0) {
      this.shufflePlaylist();
    } else {
      console.warn('[loadTracks] No tracks available for playback!');
    }
    this.notifyListeners();
  }

  async loadSchedules() {
    const { data, error } = await supabase
      .from('music_playlist_schedules')
      .select(`
        *,
        playlist:music_playlists(id, name, playlist_type)
      `)
      .eq('business_id', this.businessId)
      .eq('active', true);

    if (error) {
      return;
    }

    this.schedules = data || [];
  }

  startScheduleMonitoring() {
    if (this.scheduleInterval) {
      clearInterval(this.scheduleInterval);
    }

    this.scheduleInterval = setInterval(() => {
      this.checkSchedules();
    }, this.checkFrequency);

    this.checkSchedules();
  }

  checkSchedules() {
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

    if (activeSchedules.length === 0) {
      if (this.activeSchedule) {
        this.activeSchedule = null;
        this.switchToShuffle();
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

    if (
      !this.activeSchedule ||
      this.activeSchedule.playlist_id !== bestSchedule.playlist_id ||
      this.activeSchedule.id !== bestSchedule.id
    ) {
      this.activeSchedule = bestSchedule;
      this.switchToScheduledPlaylist(bestSchedule.playlist_id);
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

  async switchToScheduledPlaylist(playlistId) {
    try {
      const { data: playlist, error: playlistError } = await supabase
        .from('music_playlists')
        .select('*')
        .eq('id', playlistId)
        .single();

      if (playlistError) throw playlistError;

      let tracks = [];
      
      if (playlist.playlist_type === 'shuffle') {
        const { data, error } = await supabase
          .from('music_tracks')
          .select('*')
          .eq('business_id', this.businessId)
          .eq('include_in_shuffle', true);

        if (error) throw error;
        tracks = data || [];
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

      this.notifyListeners();
    } catch (err) {
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
      console.warn('[loadFirstTrack] Playlist is empty - attempting to reload tracks...');
      try {
        await this.loadTracks();
        if (this.playlist.length === 0) {
          console.error('[loadFirstTrack] Still no tracks after reload - cannot load first track');
          return;
        }
        console.log(`[loadFirstTrack] Reloaded ${this.playlist.length} tracks - loading first track`);
      } catch (error) {
        console.error('[loadFirstTrack] Failed to reload tracks:', error);
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
    }
  }

  attemptAutoPlay() {
    if (!this.userInteracted) {
      return;
    }
    this.play();
  }

  async play() {
    if (!this.readyToPlay || !this.currentTrack) {
      await this.loadFirstTrack();
    }

    try {
      await this.audio.play();
    } catch (error) {
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
      console.warn('[next] Playlist is empty - attempting to reload tracks...');
      try {
        await this.loadTracks();
        if (this.playlist.length === 0) {
          console.error('[next] Still no tracks after reload - cannot play next track');
          return;
        }
        console.log(`[next] Reloaded ${this.playlist.length} tracks - continuing playback`);
      } catch (error) {
        console.error('[next] Failed to reload tracks:', error);
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
      }
    });
  }

  destroy() {
    if (this.scheduleInterval) {
      clearInterval(this.scheduleInterval);
    }
    this.pause();
    if (this.audio) {
      this.audio.src = '';
    }
    this.listeners = [];
  }

  controls() {
    return {
      play: () => this.play(),
      pause: () => this.pause(),
      toggle: () => this.togglePlay(),
      next: () => this.next(),
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
