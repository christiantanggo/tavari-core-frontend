// hooks/useSmartMusicService.js
// Smart music service hook that auto-detects which system to use based on feature flag
// This ensures the desktop app uses Music V2 when enabled, old system otherwise

import { useState, useEffect } from 'react';
import { useBusiness } from '../contexts/BusinessContext';
import { isMusicV2Enabled } from '../utils/musicV2FeatureFlag';
import { useMusicService } from './useMusicService';
import { useMusicV2Service } from './useMusicV2Service';

/**
 * Smart hook that automatically uses the correct music service based on feature flag
 * - If music_v2_enabled = true → uses MusicV2Service (DesktopMusicV2Service in Electron)
 * - If music_v2_enabled = false → uses GlobalMusicService (DesktopMusicService in Electron)
 * 
 * This ensures the desktop app automatically uses the right system without code changes
 */
export const useSmartMusicService = () => {
  const { business } = useBusiness();
  const [isV2Enabled, setIsV2Enabled] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  
  // Get both services (they're singletons, so this is safe)
  const oldService = useMusicService();
  const v2Service = useMusicV2Service();
  
  // Check feature flag
  useEffect(() => {
    const checkFeatureFlag = async () => {
      if (!business?.id) {
        setIsV2Enabled(false);
        setIsChecking(false);
        return;
      }
      
      try {
        const enabled = await isMusicV2Enabled(business.id);
        setIsV2Enabled(enabled);
        console.log(`🎵 Music System: ${enabled ? 'V2 (New)' : 'V1 (Classic)'} - Feature flag: ${enabled}`);
      } catch (error) {
        console.error('Error checking Music V2 feature flag:', error);
        setIsV2Enabled(false);
      } finally {
        setIsChecking(false);
      }
    };
    
    checkFeatureFlag();
  }, [business?.id]);
  
  // Return the appropriate service based on feature flag
  if (isChecking) {
    // Return old service while checking (safe default)
    return oldService;
  }
  
  // Return V2 service if enabled, otherwise old service
  return isV2Enabled ? v2Service : oldService;
};

export default useSmartMusicService;


