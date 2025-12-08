// src/hooks/useMusicService.js - NON-INITIALIZING HOOK
// Returns DesktopMusicService in Electron (with caching), GlobalMusicService otherwise

import { useEffect } from 'react';
import { globalMusicService } from '../services/GlobalMusicService';
import { desktopMusicService } from '../services/DesktopMusicService';

export const useMusicService = () => {
  // If you want to attach global window listeners or analytics later, do it here.

  // IMPORTANT: Do NOT initialize here. App.jsx owns initialization.

  useEffect(() => {
    // no-op on mount
    return () => {
      // no-op on unmount
    };
  }, []);

  // In Electron, use DesktopMusicService (has caching)
  // Otherwise, use GlobalMusicService (web version)
  if (window.electronAPI) {
    return desktopMusicService;
  }
  
  return globalMusicService;
};