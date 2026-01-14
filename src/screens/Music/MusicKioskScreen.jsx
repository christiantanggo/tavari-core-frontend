// src/screens/Music/MusicKioskScreen.jsx
// Kiosk mode screen for continuous background music playback
// Auto-detects Music V2 vs Classic system based on feature flag
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMusicService } from '../../hooks/useMusicService';
import { useMusicV2Service } from '../../hooks/useMusicV2Service';
import { isMusicV2Enabled } from '../../utils/musicV2FeatureFlag';
import { supabase } from '../../supabaseClient';
import { useUserProfile } from '../../hooks/useUserProfile';
import { FiRefreshCw, FiChevronDown, FiX, FiSettings } from 'react-icons/fi';
import { desktopInstallationService } from '../../services/DesktopInstallationService';

const MusicKioskScreen = () => {
  // DON'T USE CONTEXT - it might have stale/incorrect data
  // Always read fresh DIRECTLY from localStorage where login sets it
  const navigate = useNavigate();
  const { profile } = useUserProfile();
  
  // Get both services - we'll use the appropriate one based on feature flag
  const classicService = useMusicService();
  const v2Service = useMusicV2Service();
  // Note: v2Service is a hook that returns {state, methods}, not a service object
  // It has initialize(), play(), pause(), etc. methods, but getState() might not exist
  
  // Track which service is active
  const [activeService, setActiveService] = useState(null);
  const [isV2Enabled, setIsV2Enabled] = useState(false);
  
  // Business selection state
  const [businesses, setBusinesses] = useState([]);
  const [currentBusinessId, setCurrentBusinessId] = useState(null);
  const [showBusinessSelector, setShowBusinessSelector] = useState(false);
  const [isSwitchingBusiness, setIsSwitchingBusiness] = useState(false);
  
  // Login state for kiosk (when no session found)
  const [showLogin, setShowLogin] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
  // Business ID modal state
  const [showBusinessIdModal, setShowBusinessIdModal] = useState(false);
  const [businessIdInput, setBusinessIdInput] = useState('');
  
  // Music system version state
  const [showSystemSelector, setShowSystemSelector] = useState(false);
  const [forcedSystemVersion, setForcedSystemVersion] = useState(null); // 'v1', 'v2', or null (auto)
  const [currentSystemVersion, setCurrentSystemVersion] = useState(null); // Track which system is active
  
  // NO AUTH CHECK - This is a dedicated music kiosk, works without login
  useEffect(() => {
    const isDesktopApp = window.electronAPI || window.__TAVARI_KIOSK_MODE__;
    console.log('🎵 Music Kiosk loaded - Desktop app:', isDesktopApp);
    
    // CRITICAL: Ensure we're on the correct hash route
    // HashRouter might not have parsed the hash yet, so force it
    if (window.location.hash !== '#/kiosk/music') {
      console.log('🔧 Fixing hash route...');
      window.location.hash = '#/kiosk/music';
    }
    
    // Don't check auth - just load music
  }, []);

  // Fetch user's businesses and set the correct business
  // FOR ELECTRON: Skip auth - use business from localStorage or allow manual selection
  useEffect(() => {
    const fetchBusinesses = async () => {
      const isDesktopApp = window.electronAPI || window.__TAVARI_KIOSK_MODE__;
      
      // FOR ELECTRON KIOSK: Work without profile/auth
      if (isDesktopApp) {
        // CRITICAL: Set business ID from localStorage IMMEDIATELY (synchronous)
        // This prevents the "Initializing..." screen from showing
        const storedBusinessId = localStorage.getItem('selectedBusinessId') || localStorage.getItem('currentBusinessId');
        if (storedBusinessId && !currentBusinessId) {
          setCurrentBusinessId(storedBusinessId);
          console.log('🎵 Using stored business ID for kiosk (immediate):', storedBusinessId);
        }
        
        // Try to restore session first - needed to fetch businesses
        const restoreSession = async () => {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) {
            // Try localStorage
            const savedSession = localStorage.getItem('tavari_session');
            if (savedSession) {
              try {
                const sessionData = JSON.parse(savedSession);
                if (sessionData.access_token && sessionData.refresh_token) {
                  await supabase.auth.setSession({
                    access_token: sessionData.access_token,
                    refresh_token: sessionData.refresh_token
                  });
                  console.log('✅ Session restored for business fetch');
                }
              } catch (e) {
                console.warn('⚠️ Session restore failed');
              }
            }
          }
          
          // Now try to fetch businesses if we have a session
          const { data: { session: currentSession } } = await supabase.auth.getSession();
          if (currentSession) {
            try {
              const { data: profileData } = await supabase.from('users').select('id').eq('id', currentSession.user.id).single();
              if (profileData) {
                const { data: bizData } = await supabase
                  .from('business_users')
                  .select('business_id, businesses(id, name)')
                  .eq('user_id', profileData.id)
                  .limit(1);
                
                if (bizData && bizData.length > 0 && bizData[0].businesses) {
                  const businessId = bizData[0].businesses.id;
                  setCurrentBusinessId(businessId);
                  localStorage.setItem('selectedBusinessId', businessId);
                  localStorage.setItem('currentBusinessId', businessId);
                  console.log('✅ Business ID found from session:', businessId);
                  return;
                }
              }
            } catch (e) {
              console.warn('⚠️ Failed to fetch businesses from session');
            }
          }
          
          // Fallback: Try to get business ID from localStorage (set during download)
          const storedBusinessId2 = localStorage.getItem('selectedBusinessId') || localStorage.getItem('currentBusinessId');
          if (storedBusinessId2 && storedBusinessId2 !== currentBusinessId) {
            setCurrentBusinessId(storedBusinessId2);
            console.log('🎵 Using stored business ID for kiosk:', storedBusinessId2);
          } else if (!storedBusinessId2) {
            // Last resort: Check if Electron has business ID in saved session
            if (window.electronAPI) {
              try {
                const savedSession = await window.electronAPI.loadSession();
                if (savedSession?.business_id) {
                  setCurrentBusinessId(savedSession.business_id);
                  localStorage.setItem('selectedBusinessId', savedSession.business_id);
                  localStorage.setItem('currentBusinessId', savedSession.business_id);
                  console.log('✅ Business ID found in Electron session:', savedSession.business_id);
                  return;
                }
              } catch (e) {
                console.warn('⚠️ Failed to load business ID from Electron session');
              }
            }
            
            // Only show login if we truly have no business ID
            if (!currentBusinessId) {
              console.log('⚠️ No business ID found - showing login screen');
              setShowLogin(true); // Show login screen
            }
          }
        };
        
        restoreSession();
        return;
      }
      
      // WEB BROWSER: Require profile
      if (!profile?.id) return;
      
      try {
        const { data, error } = await supabase
          .from('business_users')
          .select(`
            business_id,
            role,
            businesses (
              id,
              name
            )
          `)
          .eq('user_id', profile.id);
        
        if (error) {
          console.error('Error fetching businesses:', error);
          return;
        }
        
        if (data) {
          const bizList = data
            .map((d) => d.businesses)
            .filter(biz => biz && biz.id && biz.name);
          
          setBusinesses(bizList);
          
          // CRITICAL: Always use the FIRST business this user has access to
          // Don't trust localStorage - it might be from a different user
          if (bizList.length > 0) {
            const userBusinessId = bizList[0].id;
            console.log('🎵 Setting business to user\'s first business:', userBusinessId, bizList[0].name);
            setCurrentBusinessId(userBusinessId);
            // Update localStorage to match
            localStorage.setItem('selectedBusinessId', userBusinessId);
            localStorage.setItem('currentBusinessId', userBusinessId);
          } else {
            console.error('🎵 User has no businesses!');
          }
        }
      } catch (error) {
        console.error('Error in fetchBusinesses:', error);
      }
    };
    
    fetchBusinesses();
  }, [profile?.id]);

  // Load forced system version from localStorage on mount
  useEffect(() => {
    const savedVersion = localStorage.getItem('music_system_version_override');
    if (savedVersion && (savedVersion === 'v1' || savedVersion === 'v2')) {
      setForcedSystemVersion(savedVersion);
      console.log('🎵 Loaded forced system version from localStorage:', savedVersion);
    } else if (savedVersion === 'auto' || savedVersion === 'null') {
      setForcedSystemVersion(null);
      console.log('🎵 Loaded auto-detect system version from localStorage');
    }
  }, []);

  useEffect(() => {
    // Read business ID fresh from localStorage (not context)
    const storedBusinessId = localStorage.getItem('selectedBusinessId') || localStorage.getItem('currentBusinessId');
    console.log('🎵 MusicKioskScreen: Initializing...', { 
      storedBusinessId,
      fromSelectedKey: localStorage.getItem('selectedBusinessId'),
      fromCurrentKey: localStorage.getItem('currentBusinessId'),
      kioskMode: window.__TAVARI_KIOSK_MODE__,
      hasActiveService: !!activeService,
      activeServiceBusinessId: activeService?.businessId,
      currentBusinessId
    });
    
    // Check if we need to re-initialize (business ID changed or service not initialized)
    const needsReinit = !activeService || 
                        !activeService.isInitialized || 
                        (activeService.businessId && activeService.businessId !== currentBusinessId && currentBusinessId);
    
    if (activeService && activeService.isInitialized && !needsReinit) {
      console.log('🎵 Service already initialized with correct business ID, skipping...');
      return;
    }
    
    if (needsReinit && activeService) {
      console.log('🎵 Business ID changed or service not properly initialized - will re-initialize');
    }
    
    // Enable kiosk mode will be done after we determine which service to use

    // Initialize music - NO AUTH REQUIRED for kiosk mode
    const initializeMusic = async () => {
      try {
        // Try to restore session if available, but don't require it
        let { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
          // Try to restore from localStorage (optional)
          const savedSession = localStorage.getItem('tavari_session');
          if (savedSession) {
            try {
              const sessionData = JSON.parse(savedSession);
              if (sessionData.access_token && sessionData.refresh_token) {
                const { data, error } = await supabase.auth.setSession({
                  access_token: sessionData.access_token,
                  refresh_token: sessionData.refresh_token
                }).catch(() => ({ data: null, error: { message: 'Session restore failed' } }));
                
                if (!error) {
                  const { data: { session: restoredSession } } = await supabase.auth.getSession();
                  if (restoredSession) {
                    session = restoredSession;
                    console.log('✅ Session restored for kiosk');
                  }
                }
              }
            } catch (e) {
              console.warn('⚠️ Session restore failed, continuing without auth');
            }
          }
          // No session is OK - kiosk works without it
        }

        // Get business ID - use state first, fallback to localStorage for kiosk mode
        let businessId = currentBusinessId;
        
        // For Electron kiosk: use stored business ID if available
        const isDesktopApp = window.electronAPI || window.__TAVARI_KIOSK_MODE__;
        if (!businessId && isDesktopApp) {
          businessId = localStorage.getItem('selectedBusinessId') || localStorage.getItem('currentBusinessId');
          if (businessId) {
            setCurrentBusinessId(businessId);
            console.log('🎵 Using stored business ID for kiosk:', businessId);
          }
        }
        
        // If still no business ID, wait or show selector
        if (!businessId) {
          console.log('🎵 ⏳ No business ID yet - will show business selector if needed');
          // Don't return - let it try to initialize with null (service will handle it)
        }
        
        console.log('🎵 Business ID sources:', {
          fromState: currentBusinessId,
          fromLocalStorage_selected: localStorage.getItem('selectedBusinessId'),
          fromLocalStorage_current: localStorage.getItem('currentBusinessId'),
          using: businessId,
          note: 'Using state value (logged-in user\'s actual business)'
        });
        
        console.log('🎵 ✅ Using business ID from logged-in user:', businessId);

        // Auto-register desktop installation if in Electron and has business ID
        if (businessId && window.electronAPI) {
          try {
            console.log('🔍 [MusicKioskScreen] Attempting auto-registration...');
            const installationId = await desktopInstallationService.autoRegisterInstallation(businessId);
            if (installationId) {
              console.log('✅ [MusicKioskScreen] Desktop installation registered:', installationId);
              // last_seen updates are started automatically by DesktopInstallationService
            } else {
              console.log('ℹ️ [MusicKioskScreen] Auto-registration skipped or failed (may already be registered)');
            }
          } catch (error) {
            console.warn('⚠️ [MusicKioskScreen] Auto-registration error (non-critical):', error);
          }
        }

        // Initialize music service - check which system to use
        if (businessId) {
          // Check if Music V2 is enabled for this business
          console.log('🎵 Checking Music V2 feature flag for business:', businessId);
          const v2Enabled = await isMusicV2Enabled(businessId);
          console.log('🎵 Database check result - music_v2_enabled:', v2Enabled);
          setIsV2Enabled(v2Enabled);
          
          // Determine which system to use (forced or auto-detect)
          let useV2 = v2Enabled;
          if (forcedSystemVersion === 'v1') {
            useV2 = false;
            console.log('🎵 ⚠️ FORCED to use Music V1 (Classic) - override active!');
          } else if (forcedSystemVersion === 'v2') {
            useV2 = true;
            console.log('🎵 ⚠️ FORCED to use Music V2 (New) - override active!');
          } else {
            console.log('🎵 ✅ Auto-detecting system (V2 enabled in DB:', v2Enabled, ')');
          }
          
          if (useV2) {
            setCurrentSystemVersion('v2');
            // Music V2: Need to get location ID first
            console.log('🎵 Music V2 enabled - initializing V2 system');
            const { data: location, error: locError } = await supabase
              .from('music_v2_locations')
              .select('id')
              .eq('business_id', businessId)
              .maybeSingle();
            
            if (locError || !location) {
              console.error('🎵 Music V2 location not found, falling back to Classic');
              // Fallback to classic system
              setCurrentSystemVersion('v1');
              setActiveService(classicService);
              await classicService.initialize(businessId);
              if (window.__TAVARI_KIOSK_MODE__ && classicService.enableKioskMode) {
                classicService.enableKioskMode();
              }
            } else {
              // Initialize Music V2 with location ID
              setCurrentSystemVersion('v2');
              setActiveService(v2Service);
              
              // Get device info (DeviceService not available - use defaults)
              let deviceId = localStorage.getItem('music_v2_device_id');
              let deviceToken = localStorage.getItem('music_v2_device_token');
              
              // Generate defaults if not stored
              if (!deviceId) {
                deviceId = `device-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                localStorage.setItem('music_v2_device_id', deviceId);
              }
              if (!deviceToken) {
                deviceToken = `token-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                localStorage.setItem('music_v2_device_token', deviceToken);
              }
              
              console.log('🎵 Using device ID:', deviceId);
              
              // Use the hook's initialize method (takes locationId only - device handled internally)
              try {
                await v2Service.initialize(location.id);
                console.log('🎵 Music V2 service initialized');
              } catch (initError) {
                console.error('🎵 V2 initialization failed, falling back to Classic:', initError);
                // Fallback to classic
                setCurrentSystemVersion('v1');
                setActiveService(classicService);
                await classicService.initialize(businessId);
                if (window.__TAVARI_KIOSK_MODE__ && classicService.enableKioskMode) {
                  classicService.enableKioskMode();
                }
              }
            }
          } else {
            // Classic system: Initialize with business ID
            console.log('🎵 Classic Music system - initializing with business:', businessId);
            setCurrentSystemVersion('v1');
            setActiveService(classicService);
            await classicService.initialize(businessId);
            if (window.__TAVARI_KIOSK_MODE__ && classicService.enableKioskMode) {
              classicService.enableKioskMode();
            }
            console.log('🎵 Classic music service initialized');
          }
        } else {
          console.error('🎵 No business ID available - cannot initialize music');
        }
      } catch (error) {
        console.error('🎵 Initialization error:', error);
      }
    };

    // Initialize if we have business ID and need to (no service, not initialized, or business ID changed)
    if (currentBusinessId) {
      if (!activeService || !activeService.isInitialized || (activeService.businessId && activeService.businessId !== currentBusinessId)) {
        console.log('🎵 Initializing music service with business ID:', currentBusinessId);
        initializeMusic();
      }
    } else {
      // Try to use stored business ID from localStorage
      const storedId = localStorage.getItem('selectedBusinessId') || localStorage.getItem('currentBusinessId');
      if (storedId && (!activeService || !activeService.isInitialized || activeService.businessId !== storedId)) {
        console.log('🎵 Using stored business ID from localStorage:', storedId);
        setCurrentBusinessId(storedId);
        // This will trigger the effect again with the business ID set
      }
    }

    // Auto-refresh session every 55 minutes to prevent expiration
    const refreshInterval = setInterval(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await supabase.auth.refreshSession();
      }
    }, 55 * 60 * 1000); // 55 minutes

    return () => {
      clearInterval(refreshInterval);
    };
  }, [currentBusinessId, forcedSystemVersion, activeService]); // Include activeService to prevent re-init

  // Minimal UI for kiosk mode - just show current track info
  const [currentTrack, setCurrentTrack] = React.useState(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [appState, setAppState] = React.useState({ isInitialized: false });

  // Listen to active service state changes
  useEffect(() => {
    if (!activeService) {
      setAppState({ isInitialized: false });
      return;
    }

    const updateState = () => {
      // Check if service has getState method (V2 service hook might not have it)
      if (typeof activeService.getState === 'function') {
        try {
          const state = activeService.getState();
          setCurrentTrack(state.currentTrack || state.currentTrack);
          setIsPlaying(state.isPlaying || false);
          setAppState({
            isInitialized: state.isInitialized || activeService.isInitialized || false,
            currentTrack: state.currentTrack || null,
            isPlaying: state.isPlaying || false,
            playlist: state.playlist || activeService.playlist || []
          });
        } catch (error) {
          console.warn('⚠️ Error getting service state:', error);
          // Fallback: try to get state from service properties directly
          setAppState({
            isInitialized: activeService.isInitialized || false,
            currentTrack: activeService.currentTrack || null,
            isPlaying: activeService.isPlaying || false,
            playlist: activeService.playlist || []
          });
        }
      } else {
        // V2 service hook or service without getState - use properties directly
        // V2 hook returns state as properties: isInitialized, currentTrack, isPlaying, playlist
        setCurrentTrack(activeService.currentTrack || null);
        setIsPlaying(activeService.isPlaying || false);
        setAppState({
          isInitialized: activeService.isInitialized || false,
          currentTrack: activeService.currentTrack || null,
          isPlaying: activeService.isPlaying || false,
          playlist: activeService.playlist || []
        });
      }
    };

    updateState();
    
    // Only subscribe to listeners if service has addListener method
    let unsubscribe = () => {};
    if (typeof activeService.addListener === 'function') {
      unsubscribe = activeService.addListener(updateState);
    } else {
      // V2 hook doesn't have addListener - poll for state changes
      // Update immediately, then poll every second
      updateState();
      const pollInterval = setInterval(updateState, 1000);
      unsubscribe = () => clearInterval(pollInterval);
    }
    
    // Fallback: if still initializing after 5 seconds, mark as initialized anyway
    const timeout = setTimeout(() => {
      const currentState = typeof activeService.getState === 'function' 
        ? activeService.getState() 
        : { 
            isInitialized: activeService.isInitialized || false,
            currentTrack: activeService.currentTrack || null,
            isPlaying: activeService.isPlaying || false,
            playlist: activeService.playlist || []
          };
      if (!currentState.isInitialized && !activeService.isInitialized) {
        console.log('🎵 Initialization timeout - showing UI anyway');
        setAppState({ ...currentState, isInitialized: true });
      }
    }, 5000);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
      clearTimeout(timeout);
    };
  }, [activeService]);

  // Keyboard shortcut for business switching (Ctrl+B or Cmd+B)
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Ctrl+B (Windows/Linux) or Cmd+B (Mac)
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        if (businesses.length > 1) {
          setShowBusinessSelector(!showBusinessSelector);
        }
      }
      // Escape to close selector
      if (e.key === 'Escape' && showBusinessSelector) {
        setShowBusinessSelector(false);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [businesses.length, showBusinessSelector]);

  const hasTracks = appState.playlist?.length > 0 || false;
  const isInitialized = appState.isInitialized || false;

  // Handle login for kiosk (when no session found)
  const handleKioskLogin = async (e) => {
    if (e) e.preventDefault();
    if (isLoggingIn) return;
    
    setLoginError('');
    setIsLoggingIn(true);
    
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword
      });
      
      if (error) {
        setLoginError('Invalid email or password');
        setIsLoggingIn(false);
        return;
      }
      
      if (data.session) {
        console.log('✅ Login successful - saving session and fetching business ID');
        
        // Save session to Electron if available
        if (window.electronAPI?.saveSession) {
          await window.electronAPI.saveSession(data.session);
          console.log('✅ Session saved to Electron');
        }
        
        // Also save to localStorage as backup
        localStorage.setItem('tavari_session', JSON.stringify({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token
        }));
        
        // Now fetch business ID
        const { data: profileData } = await supabase
          .from('users')
          .select('id')
          .eq('id', data.session.user.id)
          .single();
        
        if (profileData) {
          const { data: bizData } = await supabase
            .from('business_users')
            .select('business_id, businesses(id, name)')
            .eq('user_id', profileData.id)
            .limit(1);
          
          if (bizData && bizData.length > 0 && bizData[0].businesses) {
            const businessId = bizData[0].businesses.id;
            setCurrentBusinessId(businessId);
            localStorage.setItem('selectedBusinessId', businessId);
            localStorage.setItem('currentBusinessId', businessId);
            setShowLogin(false);
            console.log('✅ Business ID found after login:', businessId);
          } else {
            setLoginError('No business found for this account');
          }
        }
      }
    } catch (err) {
      console.error('Login error:', err);
      setLoginError('Login failed. Please try again.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Handle business switching
  const handleBusinessSwitch = async (newBusinessId) => {
    if (newBusinessId === currentBusinessId) {
      setShowBusinessSelector(false);
      return;
    }
    
    setIsSwitchingBusiness(true);
    
    try {
      // Stop and cleanup current music service
      if (activeService) {
        if (activeService.pause) {
          activeService.pause();
        }
        if (activeService.destroy) {
          activeService.destroy();
        }
      }
      
      // Update localStorage
      localStorage.setItem('selectedBusinessId', newBusinessId);
      localStorage.setItem('currentBusinessId', newBusinessId);
      
      // Clear Music V2 device info if switching businesses (device is tied to location)
      localStorage.removeItem('music_v2_device_id');
      localStorage.removeItem('music_v2_device_token');
      
      // Clear active service
      setActiveService(null);
      
      // Update state - this will trigger useEffect to re-initialize
      setCurrentBusinessId(newBusinessId);
      setShowBusinessSelector(false);
      
      console.log('🎵 Business switched to:', newBusinessId);
    } catch (error) {
      console.error('Error switching business:', error);
    } finally {
      setIsSwitchingBusiness(false);
    }
  };

  // Handle system version switching
  const handleSystemVersionSwitch = async (version) => {
    if (version === forcedSystemVersion) {
      setShowSystemSelector(false);
      return;
    }
    
    try {
      // Stop and cleanup current music service
      if (activeService) {
        if (activeService.pause) {
          activeService.pause();
        }
        if (activeService.destroy) {
          activeService.destroy();
        }
      }
      
      // Set forced version (null = auto-detect)
      setForcedSystemVersion(version);
      if (version) {
        localStorage.setItem('music_system_version_override', version);
        console.log('🎵 System override set to:', version);
      } else {
        localStorage.setItem('music_system_version_override', 'auto');
        console.log('🎵 System override cleared - using auto-detection from database');
      }
      
      // Clear active service
      setActiveService(null);
      
      // This will trigger useEffect to re-initialize with new system
      setShowSystemSelector(false);
      
      console.log('🎵 System version switched to:', version || 'auto-detect');
    } catch (error) {
      console.error('Error switching system version:', error);
    }
  };

  // Force refresh feature flag check
  const handleRefreshFeatureFlag = async () => {
    if (!currentBusinessId) {
      console.warn('🎵 No business ID available for refresh');
      return;
    }
    
    try {
      console.log('🎵 🔄 Manually refreshing Music V2 feature flag...');
      // Stop current service
      if (activeService) {
        if (activeService.pause) {
          activeService.pause();
        }
        if (activeService.destroy) {
          activeService.destroy();
        }
      }
      
      // Clear active service to force re-initialization
      setActiveService(null);
      
      // Clear forced version to use auto-detection
      setForcedSystemVersion(null);
      localStorage.setItem('music_system_version_override', 'auto');
      
      console.log('🎵 ✅ Feature flag refresh complete - system will re-initialize');
    } catch (error) {
      console.error('Error refreshing feature flag:', error);
    }
  };

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {/* Settings/Selector Panel (top-right) */}
      <div style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        zIndex: 1000,
        display: 'flex',
        gap: '10px',
        flexDirection: 'column',
        alignItems: 'flex-end'
      }}>
        {/* Reload Tracks Button */}
        {activeService && (
          <button
            onClick={async () => {
              try {
                console.log('🔄 Manual track reload requested from kiosk UI');
                console.log('📊 Current state:', {
                  currentBusinessId,
                  activeServiceType: currentSystemVersion,
                  storedBusinessId: localStorage.getItem('selectedBusinessId') || localStorage.getItem('currentBusinessId'),
                  serviceBusinessId: activeService.businessId || (window.globalMusicService?.businessId)
                });
                
                // ALWAYS use globalMusicService directly since it's what actually loads tracks
                const service = window.globalMusicService;
                if (!service) {
                  console.error('❌ globalMusicService not found!');
                  alert('Music service not available. Please refresh the app.');
                  return;
                }
                
                // Ensure businessId is up to date before reloading
                const businessIdToUse = currentBusinessId || localStorage.getItem('selectedBusinessId') || localStorage.getItem('currentBusinessId');
                if (businessIdToUse && service.businessId !== businessIdToUse) {
                  console.log('🔄 Updating businessId before reload:', businessIdToUse);
                  service.businessId = businessIdToUse;
                }
                
                if (service.reloadTracks) {
                  console.log('🔄 Calling reloadTracks() on globalMusicService...');
                  const result = await service.reloadTracks();
                  console.log('✅ Reload complete:', result);
                  
                  // Show alert with diagnostic info
                  if (result.diagnostic) {
                    const diag = result.diagnostic;
                    if (diag.totalInDb > diag.loadedTracks) {
                      alert(`⚠️ MISMATCH DETECTED!\n\nDatabase has ${diag.totalInDb} tracks\nOnly ${diag.loadedTracks} are loaded\n\n${diag.totalInDb - diag.loadedTracks} tracks are being filtered out.\n\nCheck console for details.`);
                    } else {
                      alert(`✅ Reloaded tracks\n\nDatabase: ${diag.totalInDb} tracks\nLoaded: ${diag.loadedTracks} tracks\nShuffle tracks: ${diag.shuffleInDb}`);
                    }
                  }
                } else {
                  console.error('❌ reloadTracks method not found on globalMusicService!');
                  // Fallback to loadTracks
                  if (service.loadTracks) {
                    await service.loadTracks();
                    console.log('✅ Used loadTracks() as fallback');
                  }
                }
              } catch (error) {
                console.error('❌ Error reloading tracks:', error);
                alert(`Failed to reload tracks: ${error.message}\n\nCheck console for details.`);
              }
            }}
            style={{
              padding: '10px 16px',
              backgroundColor: 'rgba(34, 197, 94, 0.25)',
              color: 'white',
              border: '2px solid rgba(34, 197, 94, 0.4)',
              borderRadius: '10px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '500',
              backdropFilter: 'blur(10px)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)'
            }}
            title="Reload tracks from database (check for new music)"
          >
            <FiRefreshCw size={16} />
            <span>Reload Music</span>
          </button>
        )}
        
        {/* Business ID Override Button - Show prominently if no ID or tracks not loading */}
        {window.electronAPI && (
          <>
            <button
              onClick={() => {
                const currentId = currentBusinessId || localStorage.getItem('selectedBusinessId') || localStorage.getItem('currentBusinessId');
                setBusinessIdInput(currentId || '');
                setShowBusinessIdModal(true);
              }}
              style={{
                padding: '10px 16px',
                backgroundColor: !currentBusinessId 
                  ? 'rgba(239, 68, 68, 0.4)' 
                  : 'rgba(168, 85, 247, 0.25)',
                color: 'white',
                border: !currentBusinessId
                  ? '2px solid rgba(239, 68, 68, 0.6)'
                  : '2px solid rgba(168, 85, 247, 0.4)',
                borderRadius: '10px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '500',
                backdropFilter: 'blur(10px)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
                marginTop: '8px'
              }}
              title={!currentBusinessId 
                ? "⚠️ No Business ID set! Click to set Business ID"
                : "Change Business ID (if tracks are in a different business)"}
            >
              <FiSettings size={16} />
              <span>{!currentBusinessId ? '⚠️ Set Business ID' : 'Set Business ID'}</span>
            </button>
            
            {/* Business ID Modal */}
            {showBusinessIdModal && (
              <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000
              }}
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setShowBusinessIdModal(false);
                }
              }}
              >
                <div style={{
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  padding: '24px',
                  maxWidth: '500px',
                  width: '90%',
                  boxShadow: '0 10px 25px rgba(0, 0, 0, 0.3)'
                }}
                onClick={(e) => e.stopPropagation()}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px'
                  }}>
                    <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>
                      Set Business ID
                    </h2>
                    <button
                      onClick={() => setShowBusinessIdModal(false)}
                      style={{
                        background: 'none',
                        border: 'none',
                        fontSize: '24px',
                        cursor: 'pointer',
                        color: '#6b7280'
                      }}
                    >
                      <FiX size={20} />
                    </button>
                  </div>
                  
                  <div style={{ marginBottom: '16px' }}>
                    <label style={{
                      display: 'block',
                      fontSize: '14px',
                      fontWeight: '600',
                      color: '#374151',
                      marginBottom: '8px'
                    }}>
                      Current Business ID:
                    </label>
                    <div style={{
                      padding: '8px 12px',
                      backgroundColor: '#f3f4f6',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                      color: '#6b7280',
                      wordBreak: 'break-all'
                    }}>
                      {currentBusinessId || localStorage.getItem('selectedBusinessId') || localStorage.getItem('currentBusinessId') || 'Not set'}
                    </div>
                  </div>
                  
                  <div style={{ marginBottom: '20px' }}>
                    <label style={{
                      display: 'block',
                      fontSize: '14px',
                      fontWeight: '600',
                      color: '#374151',
                      marginBottom: '8px'
                    }}>
                      Enter Business ID:
                    </label>
                    <input
                      type="text"
                      value={businessIdInput}
                      onChange={(e) => setBusinessIdInput(e.target.value)}
                      placeholder="Enter Business ID (UUID)"
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '2px solid #e5e7eb',
                        borderRadius: '8px',
                        fontSize: '16px',
                        outline: 'none',
                        fontFamily: 'monospace'
                      }}
                      autoFocus
                    />
                  </div>
                  
                  <div style={{
                    display: 'flex',
                    gap: '12px',
                    justifyContent: 'flex-end'
                  }}>
                    <button
                      onClick={() => setShowBusinessIdModal(false)}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: '#e5e7eb',
                        color: '#374151',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '16px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        if (!businessIdInput.trim()) {
                          alert('Please enter a Business ID');
                          return;
                        }
                        
                        const trimmedId = businessIdInput.trim();
                        const currentId = currentBusinessId || localStorage.getItem('selectedBusinessId') || localStorage.getItem('currentBusinessId');
                        
                        setCurrentBusinessId(trimmedId);
                        localStorage.setItem('selectedBusinessId', trimmedId);
                        localStorage.setItem('currentBusinessId', trimmedId);
                        
                        // Update service
                        if (window.globalMusicService) {
                          window.globalMusicService.businessId = trimmedId;
                          // Force reload
                          await window.globalMusicService.loadTracks();
                        }
                        
                        // Reinitialize if needed
                        if (activeService && activeService.initialize) {
                          await activeService.initialize(trimmedId);
                        } else if (classicService && classicService.initialize) {
                          await classicService.initialize(trimmedId);
                        }
                        
                        console.log('✅ Business ID updated to:', trimmedId);
                        setShowBusinessIdModal(false);
                        alert(`Business ID updated!\n\nNew ID: ${trimmedId}\n\nTracks are reloading...\n\nClick "Reload Music" if tracks don't appear.`);
                        
                        // Auto-reload after a moment
                        setTimeout(async () => {
                          if (window.globalMusicService && window.globalMusicService.reloadTracks) {
                            await window.globalMusicService.reloadTracks();
                          }
                        }, 1000);
                      }}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: '#14B8A6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '16px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        
        {/* Diagnostic Button - Check database directly */}
        {window.globalMusicService && (
          <button
            onClick={async () => {
              try {
                const service = window.globalMusicService;
                const businessId = service.businessId || currentBusinessId || localStorage.getItem('selectedBusinessId') || localStorage.getItem('currentBusinessId');
                
                if (!businessId) {
                  alert('No business ID found! Use "Set Business ID" button first.');
                  return;
                }
                
                console.log('🔍 Running diagnostic check for business:', businessId);
                
                // Direct database query
                const { data: allTracks, error } = await supabase
                  .from('music_tracks')
                  .select('id, title, artist, include_in_shuffle, uploaded_at, business_id')
                  .eq('business_id', businessId)
                  .order('uploaded_at', { ascending: false });
                
                if (error) {
                  console.error('❌ Database query error:', error);
                  alert(`Database error: ${error.message}`);
                  return;
                }
                
                const shuffleTracks = allTracks.filter(t => t.include_in_shuffle);
                const loadedCount = service.tracks?.length || 0;
                
                const diagnostic = {
                  businessId,
                  totalInDb: allTracks.length,
                  shuffleInDb: shuffleTracks.length,
                  nonShuffleInDb: allTracks.length - shuffleTracks.length,
                  loadedTracks: loadedCount,
                  allTracks: allTracks.map(t => ({
                    id: t.id,
                    title: t.title,
                    artist: t.artist,
                    include_in_shuffle: t.include_in_shuffle,
                    uploaded_at: t.uploaded_at
                  }))
                };
                
                console.log('📊 Database Diagnostic:', diagnostic);
                console.log('📋 ALL TRACKS IN DATABASE:', diagnostic.allTracks);
                
                let message = `📊 DATABASE DIAGNOSTIC\n\n`;
                message += `Business ID: ${businessId}\n`;
                message += `Total tracks in DB: ${diagnostic.totalInDb}\n`;
                message += `Shuffle tracks: ${diagnostic.shuffleInDb}\n`;
                message += `Non-shuffle tracks: ${diagnostic.nonShuffleInDb}\n`;
                message += `Currently loaded: ${diagnostic.loadedTracks}\n\n`;
                
                if (diagnostic.totalInDb > diagnostic.loadedTracks) {
                  message += `⚠️ MISMATCH: ${diagnostic.totalInDb - diagnostic.loadedTracks} tracks not loaded!\n`;
                  message += `This means tracks are being filtered out.\n\n`;
                } else if (diagnostic.totalInDb === 0) {
                  message += `⚠️ NO TRACKS FOUND!\n`;
                  message += `The database has 0 tracks for this business.\n`;
                  message += `If you uploaded tracks, they may be in a different business.\n\n`;
                }
                
                message += `All ${diagnostic.totalInDb} tracks:\n`;
                diagnostic.allTracks.slice(0, 20).forEach((t, i) => {
                  const date = t.uploaded_at ? new Date(t.uploaded_at).toLocaleDateString() : 'unknown';
                  message += `${i + 1}. ${t.title || 'Untitled'}${t.artist ? ` - ${t.artist}` : ''} (shuffle: ${t.include_in_shuffle ? 'yes' : 'no'}, uploaded: ${date})\n`;
                });
                
                if (diagnostic.totalInDb > 20) {
                  message += `\n... and ${diagnostic.totalInDb - 20} more (see console for full list)`;
                }
                
                message += `\n\nCheck console for full track list.`;
                
                alert(message);
              } catch (error) {
                console.error('❌ Diagnostic error:', error);
                alert(`Diagnostic failed: ${error.message}`);
              }
            }}
            style={{
              padding: '10px 16px',
              backgroundColor: 'rgba(59, 130, 246, 0.25)',
              color: 'white',
              border: '2px solid rgba(59, 130, 246, 0.4)',
              borderRadius: '10px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '500',
              backdropFilter: 'blur(10px)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
              marginTop: '8px'
            }}
            title="Check database directly (diagnostic tool)"
          >
            <FiRefreshCw size={16} />
            <span>Check Database</span>
          </button>
        )}
        
        {/* Restart App Button - Only show in Electron */}
        {window.electronAPI && (
          <button
            onClick={async () => {
              if (window.confirm('Restart the desktop app? Music will resume automatically after restart.')) {
                try {
                  console.log('🔄 Manual restart requested from kiosk UI');
                  await window.electronAPI.restartApp();
                } catch (error) {
                  console.error('Error restarting app:', error);
                  alert('Failed to restart app. Please restart manually.');
                }
              }
            }}
            style={{
              padding: '10px 16px',
              backgroundColor: 'rgba(239, 68, 68, 0.25)',
              color: 'white',
              border: '2px solid rgba(239, 68, 68, 0.4)',
              borderRadius: '10px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '500',
              backdropFilter: 'blur(10px)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)'
            }}
            title="Restart the desktop app (daily auto-restart at 3:00 AM)"
          >
            <FiRefreshCw size={16} />
            <span>Restart App</span>
          </button>
        )}
        
        {/* System Version Selector */}
        <div style={{ position: 'relative' }}>
          {!showSystemSelector ? (
            <button
              onClick={() => setShowSystemSelector(true)}
              style={{
                padding: '10px 16px',
                backgroundColor: 'rgba(255, 255, 255, 0.25)',
                color: 'white',
                border: '2px solid rgba(255, 255, 255, 0.4)',
                borderRadius: '10px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '500',
                backdropFilter: 'blur(10px)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)'
              }}
              title="Switch Music System (V1/V2)"
            >
              <FiSettings size={16} />
              <span>System: {forcedSystemVersion ? (forcedSystemVersion === 'v2' ? 'V2 (Forced)' : 'V1 (Forced)') : (currentSystemVersion === 'v2' ? 'V2 (Auto)' : currentSystemVersion === 'v1' ? 'V1 (Auto)' : 'Auto')}</span>
            </button>
          ) : (
            <div style={{
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              borderRadius: '12px',
              padding: '16px',
              minWidth: '250px',
              backdropFilter: 'blur(20px)',
              border: '2px solid rgba(255, 255, 255, 0.3)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px'
              }}>
                <div style={{
                  color: 'white',
                  fontWeight: 'bold',
                  fontSize: '16px'
                }}>
                  Music System
                </div>
                <button
                  onClick={() => setShowSystemSelector(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'rgba(255, 255, 255, 0.7)',
                    cursor: 'pointer',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '4px'
                  }}
                >
                  <FiX size={18} />
                </button>
              </div>
              <button
                onClick={() => handleSystemVersionSwitch(null)}
                style={{
                  width: '100%',
                  padding: '12px',
                  marginBottom: '8px',
                  backgroundColor: forcedSystemVersion === null 
                    ? 'rgba(59, 130, 246, 0.6)' 
                    : 'rgba(255, 255, 255, 0.1)',
                  color: 'white',
                  border: forcedSystemVersion === null 
                    ? '2px solid #3b82f6' 
                    : '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <span>Auto (Recommended)</span>
                {forcedSystemVersion === null && <span>✓</span>}
              </button>
              <button
                onClick={() => handleSystemVersionSwitch('v1')}
                style={{
                  width: '100%',
                  padding: '12px',
                  marginBottom: '8px',
                  backgroundColor: forcedSystemVersion === 'v1' 
                    ? 'rgba(59, 130, 246, 0.6)' 
                    : 'rgba(255, 255, 255, 0.1)',
                  color: 'white',
                  border: forcedSystemVersion === 'v1' 
                    ? '2px solid #3b82f6' 
                    : '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <span>V1 (Classic)</span>
                {forcedSystemVersion === 'v1' && <span>✓</span>}
              </button>
              <button
                onClick={() => handleSystemVersionSwitch('v2')}
                style={{
                  width: '100%',
                  padding: '12px',
                  marginBottom: '8px',
                  backgroundColor: forcedSystemVersion === 'v2' 
                    ? 'rgba(59, 130, 246, 0.6)' 
                    : 'rgba(255, 255, 255, 0.1)',
                  color: 'white',
                  border: forcedSystemVersion === 'v2' 
                    ? '2px solid #3b82f6' 
                    : '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <span>V2 (New)</span>
                {forcedSystemVersion === 'v2' && <span>✓</span>}
              </button>
              <div style={{
                marginTop: '12px',
                paddingTop: '12px',
                borderTop: '1px solid rgba(255, 255, 255, 0.2)'
              }}>
                <button
                  onClick={handleRefreshFeatureFlag}
                  style={{
                    width: '100%',
                    padding: '10px',
                    backgroundColor: 'rgba(59, 130, 246, 0.3)',
                    color: 'white',
                    border: '1px solid rgba(59, 130, 246, 0.5)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                  title="Refresh feature flag from database"
                >
                  <FiRefreshCw size={14} />
                  <span>Refresh from Database</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Business Selector (if multiple businesses) */}
        {businesses.length > 1 && (
          <div style={{ position: 'relative' }}>
          {!showBusinessSelector ? (
            <button
              onClick={() => setShowBusinessSelector(true)}
              style={{
                padding: '12px 24px',
                backgroundColor: 'rgba(255, 255, 255, 0.25)',
                color: 'white',
                border: '2px solid rgba(255, 255, 255, 0.4)',
                borderRadius: '12px',
                cursor: 'pointer',
                fontSize: '15px',
                fontWeight: '500',
                backdropFilter: 'blur(10px)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
                transition: 'all 0.2s ease',
                hover: {
                  backgroundColor: 'rgba(255, 255, 255, 0.35)',
                  transform: 'scale(1.05)'
                }
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.35)';
                e.currentTarget.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)';
                e.currentTarget.style.transform = 'scale(1)';
              }}
              title="Switch Business (Ctrl+B)"
            >
              <FiRefreshCw size={18} /> 
              <span>Switch Business</span>
              <FiChevronDown size={16} />
            </button>
          ) : (
            <div style={{
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              borderRadius: '12px',
              padding: '20px',
              minWidth: '300px',
              maxWidth: '400px',
              backdropFilter: 'blur(20px)',
              border: '2px solid rgba(255, 255, 255, 0.3)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px'
              }}>
                <div style={{
                  color: 'white',
                  fontWeight: 'bold',
                  fontSize: '18px'
                }}>
                  Select Business
                </div>
                <button
                  onClick={() => setShowBusinessSelector(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'rgba(255, 255, 255, 0.7)',
                    cursor: 'pointer',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '4px',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                    e.currentTarget.style.color = 'white';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
                  }}
                  title="Close (Esc)"
                >
                  <FiX size={20} />
                </button>
              </div>
              <div style={{
                maxHeight: '400px',
                overflowY: 'auto',
                marginBottom: '12px'
              }}>
                {businesses.map(biz => (
                  <button
                    key={biz.id}
                    onClick={() => handleBusinessSwitch(biz.id)}
                    disabled={isSwitchingBusiness || biz.id === currentBusinessId}
                    style={{
                      width: '100%',
                      padding: '14px 16px',
                      marginBottom: '8px',
                      backgroundColor: biz.id === currentBusinessId 
                        ? 'rgba(59, 130, 246, 0.6)' 
                        : 'rgba(255, 255, 255, 0.1)',
                      color: 'white',
                      border: biz.id === currentBusinessId 
                        ? '2px solid #3b82f6' 
                        : '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: '8px',
                      cursor: isSwitchingBusiness || biz.id === currentBusinessId ? 'not-allowed' : 'pointer',
                      textAlign: 'left',
                      fontSize: '15px',
                      opacity: isSwitchingBusiness ? 0.6 : 1,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      transition: 'all 0.2s ease',
                      fontWeight: biz.id === currentBusinessId ? '600' : '400'
                    }}
                    onMouseEnter={(e) => {
                      if (!isSwitchingBusiness && biz.id !== currentBusinessId) {
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
                        e.currentTarget.style.transform = 'translateX(4px)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (biz.id !== currentBusinessId) {
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.transform = 'translateX(0)';
                      }
                    }}
                  >
                    <span>{biz.name}</span>
                    {biz.id === currentBusinessId && (
                      <span style={{
                        fontSize: '18px',
                        color: '#3b82f6'
                      }}>✓</span>
                    )}
                  </button>
                ))}
              </div>
              {isSwitchingBusiness && (
                <div style={{
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontSize: '13px',
                  textAlign: 'center',
                  fontStyle: 'italic',
                  marginTop: '8px'
                }}>
                  Switching business...
                </div>
              )}
              <div style={{
                marginTop: '12px',
                paddingTop: '12px',
                borderTop: '1px solid rgba(255, 255, 255, 0.2)',
                fontSize: '11px',
                color: 'rgba(255, 255, 255, 0.5)',
                textAlign: 'center'
              }}>
                Press <kbd style={{
                  padding: '2px 6px',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  borderRadius: '4px',
                  fontFamily: 'monospace'
                }}>Ctrl+B</kbd> to toggle
              </div>
            </div>
          )}
          </div>
        )}
      </div>

      <div style={{
        textAlign: 'center',
        padding: '40px',
        background: 'rgba(255, 255, 255, 0.1)',
        borderRadius: '20px',
        backdropFilter: 'blur(10px)',
        minWidth: '400px',
        maxWidth: '600px'
      }}>
        <h1 style={{ fontSize: '48px', marginBottom: '20px', fontWeight: 'bold' }}>
          Tavari Music
        </h1>
        {currentBusinessId && businesses.length > 0 && (
          <div style={{ 
            fontSize: '16px', 
            opacity: 0.9, 
            marginBottom: '20px',
            padding: '8px 16px',
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
            borderRadius: '8px',
            display: 'inline-block',
            fontWeight: '500'
          }}>
            📍 {businesses.find(b => b.id === currentBusinessId)?.name || 'Unknown Business'}
            {businesses.length > 1 && (
              <span style={{
                fontSize: '12px',
                opacity: 0.7,
                marginLeft: '8px',
                fontStyle: 'italic'
              }}>
                ({businesses.length} businesses available)
              </span>
            )}
          </div>
        )}
        
        {showLogin ? (
          <div style={{
            background: 'rgba(255, 255, 255, 0.1)',
            padding: '30px',
            borderRadius: '12px',
            maxWidth: '400px',
            margin: '0 auto'
          }}>
            <h2 style={{ fontSize: '24px', marginBottom: '20px', fontWeight: 'bold' }}>
              Login Required
            </h2>
            <p style={{ fontSize: '14px', opacity: 0.8, marginBottom: '20px' }}>
              Please log in to connect this kiosk to your business.
            </p>
            <form onSubmit={handleKioskLogin}>
              <input
                type="email"
                placeholder="Email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '12px',
                  marginBottom: '12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: 'white',
                  fontSize: '16px'
                }}
              />
              <input
                type="password"
                placeholder="Password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '12px',
                  marginBottom: '12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: 'white',
                  fontSize: '16px'
                }}
              />
              {loginError && (
                <div style={{
                  color: '#ff6b6b',
                  fontSize: '14px',
                  marginBottom: '12px',
                  padding: '8px',
                  background: 'rgba(255, 107, 107, 0.2)',
                  borderRadius: '6px'
                }}>
                  {loginError}
                </div>
              )}
              <button
                type="submit"
                disabled={isLoggingIn}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '8px',
                  border: 'none',
                  background: isLoggingIn ? 'rgba(255, 255, 255, 0.3)' : '#20c997',
                  color: 'white',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: isLoggingIn ? 'not-allowed' : 'pointer',
                  opacity: isLoggingIn ? 0.6 : 1
                }}
              >
                {isLoggingIn ? 'Logging in...' : 'Login'}
              </button>
            </form>
          </div>
        ) : !currentBusinessId ? (
          <div style={{ fontSize: '18px', opacity: 0.8, color: '#ff6b6b' }}>
            ⚠️ No business ID found. Please log in or select a business.
            <br />
            <small style={{ fontSize: '14px', opacity: 0.7 }}>
              The kiosk needs a business ID to initialize music playback.
            </small>
            {isPlaying && (
              <div style={{ fontSize: '14px', marginTop: '10px', color: '#20c997' }}>
                ✅ Music is playing in the background
              </div>
            )}
          </div>
        ) : !isInitialized && !isPlaying ? (
          <div style={{ fontSize: '18px', opacity: 0.8 }}>
            Initializing...
            {hasTracks && (
              <div style={{ fontSize: '14px', marginTop: '10px', opacity: 0.7 }}>
                {appState.playlist?.length || 0} tracks loaded
              </div>
            )}
          </div>
        ) : currentTrack ? (
          <>
            <div style={{ fontSize: '24px', marginBottom: '10px', fontWeight: '500' }}>
              {currentTrack.title || 'Unknown Track'}
            </div>
            <div style={{ fontSize: '18px', opacity: 0.8, marginBottom: '20px' }}>
              {currentTrack.artist || 'Unknown Artist'}
            </div>
            <div style={{ marginTop: '20px', fontSize: '16px', opacity: 0.9 }}>
              {isPlaying ? '▶️ Playing' : '⏸️ Paused'}
            </div>
            <div style={{ marginTop: '10px', fontSize: '14px', opacity: 0.6 }}>
              {hasTracks ? `${appState.playlist.length} tracks in playlist` : 'No tracks available'}
            </div>
          </>
        ) : hasTracks ? (
          <div style={{ fontSize: '18px', opacity: 0.8 }}>
            Ready to play - {appState.playlist.length} tracks loaded
          </div>
        ) : (
          <>
            <div style={{ fontSize: '18px', opacity: 0.8, marginBottom: '20px' }}>
              No tracks found
            </div>
            <div style={{ fontSize: '14px', opacity: 0.7, lineHeight: '1.6' }}>
              Upload music tracks from the web dashboard<br />
              to start playing background music.
            </div>
            <div style={{ marginTop: '20px', fontSize: '14px', opacity: 0.6 }}>
              Status: {isPlaying ? 'Playing' : 'Stopped'}
            </div>
          </>
        )}
      </div>
      
      {/* Hidden audio element for playback */}
      <audio
        id="global-audio-element"
        style={{ display: 'none' }}
        autoPlay
        preload="auto"
      />
    </div>
  );
};

export default MusicKioskScreen;

