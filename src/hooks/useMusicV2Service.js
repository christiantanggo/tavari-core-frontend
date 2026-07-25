// hooks/useMusicV2Service.js
// Hook for accessing Music V2 service
// Returns DesktopMusicV2Service in Electron (with caching), MusicV2Service otherwise

import { useState, useEffect, useCallback } from 'react';

// Stub services - Music V2 services don't exist yet
const createStubService = () => ({
  getState: () => ({
    isInitialized: false,
    isPlaying: false,
    currentTrack: null,
    playlist: [],
    volume: 0.7,
    adVolume: 0.5,
    deviceId: null,
    deviceToken: null
  }),
  addListener: () => () => {}, // Return unsubscribe function
  initialize: async () => {},
  play: async () => {},
  pause: () => {},
  next: async () => {},
  setVolume: () => {},
  setAdVolume: () => {},
  loadCurrentPlaylist: async () => {},
  schedulePlaylistChange: () => {}
});

const musicV2Service = createStubService();
const desktopMusicV2Service = createStubService();

// Stub device service
const deviceService = {
  registerDevice: async () => ({
    deviceId: `device-${Date.now()}`,
    deviceToken: `token-${Date.now()}`
  }),
  forceSync: async () => ({ hasUpdates: false })
};

/**
 * Hook to use Music V2 service
 * @param {string} locationId - Location ID (optional, will be set when initialized)
 * @returns {object} Service state and methods
 */
export const useMusicV2Service = (locationId = null) => {
  // Use desktop service in Electron, base service otherwise
  const service = window.electronAPI ? desktopMusicV2Service : musicV2Service;
  
  const [state, setState] = useState(service.getState());
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState(null);

  // Update state when service notifies
  useEffect(() => {
    const unsubscribe = service.addListener((newState) => {
      setState(newState);
      setIsInitialized(newState.isInitialized);
    });

    return unsubscribe;
  }, [service]);

  // Initialize if locationId provided
  useEffect(() => {
    if (locationId && !isInitialized) {
      initializeService(locationId).catch(err => {
        setError(err);
        console.error('Error initializing Music V2 service:', err);
      });
    }
  }, [locationId, isInitialized]);

  /**
   * Initialize service with location and device
   */
  const initializeService = useCallback(async (locId) => {
    try {
      // Get or register device
      const deviceName = window.electronAPI ? 'Desktop Player' : 'Web Player';
      const deviceType = window.electronAPI ? 'desktop' : 'web';
      
      // Check for existing device token in localStorage
      const storedDeviceId = localStorage.getItem('music_v2_device_id');
      const storedDeviceToken = localStorage.getItem('music_v2_device_token');
      
      const { deviceId, deviceToken } = await deviceService.registerDevice(
        locId,
        deviceName,
        deviceType,
        storedDeviceId,
        storedDeviceToken
      );

      // Store device info
      localStorage.setItem('music_v2_device_id', deviceId);
      localStorage.setItem('music_v2_device_token', deviceToken);

      // Initialize music service (will use desktop service in Electron)
      await service.initialize(locId, deviceId, deviceToken);
      
      setIsInitialized(true);
      setError(null);
    } catch (err) {
      setError(err);
      throw err;
    }
  }, []);

  // Service methods
  const play = useCallback(async () => {
    await service.play();
  }, [service]);

  const pause = useCallback(() => {
    service.pause();
  }, [service]);

  const next = useCallback(async () => {
    await service.next();
  }, [service]);

  const setVolume = useCallback((volume) => {
    service.setVolume(volume);
  }, [service]);

  const setAdVolume = useCallback((adVolume) => {
    service.setAdVolume(adVolume);
  }, [service]);

  const changePlaylist = useCallback(async (playlistType) => {
    service.schedulePlaylistChange(playlistType);
    await service.loadCurrentPlaylist();
  }, [service]);

  const forceSync = useCallback(async () => {
    if (state.deviceId) {
      const result = await deviceService.forceSync(state.deviceId);
      if (result.hasUpdates) {
        // Reload config (service will handle desktop vs web)
        if (service.loadLocationConfig) {
          await service.loadLocationConfig();
        }
        if (service.loadSchedule) {
          await service.loadSchedule();
        }
        if (service.loadCEORules) {
          await service.loadCEORules();
        }
      }
      return result;
    }
    return { hasUpdates: false };
  }, [state.deviceId, service]);

  return {
    // State
    ...state,
    isInitialized,
    error,
    
    // Methods
    initialize: initializeService,
    play,
    pause,
    next,
    setVolume,
    setAdVolume,
    changePlaylist,
    forceSync
  };
};

export default useMusicV2Service;

