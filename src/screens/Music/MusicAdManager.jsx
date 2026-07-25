// src/screens/Music/MusicAdManager.jsx - WITH PERMISSION SYSTEM INTEGRATION
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiDollarSign, FiUpload, FiPlay, FiPause, FiSettings, FiBarChart, FiToggleLeft, FiToggleRight, FiAlertCircle, FiCheckCircle, FiTrash2, FiEdit, FiLock, FiEye, FiZap, FiX, FiRadio } from 'react-icons/fi';

// Tavari Build Standards - Required imports
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useSecurityContext } from '../../Security/useSecurityContext';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';

// Permission system integration
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import toast from 'react-hot-toast';

// Database connection
import { supabase } from '../../supabaseClient';
import { globalMusicService } from '../../services/GlobalMusicService';

/**
 * Music Ad Manager - Manage advertisements and revenue
 * Integrates with Tavari permission system for access control
 */
const MusicAdManager = () => {
  const navigate = useNavigate();

  // Tavari standardized authentication
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'], // Ad management restricted to managers and owners
    requireBusiness: true,
    componentName: 'MusicAdManager'
  });

  // Permission system integration
  const { 
    hasPermission, 
    hasAnyPermission,
    isOwner, 
    isManager,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Tavari standardized security
  // DISABLED device tracking to prevent AudioContext errors
  const security = useSecurityContext({
    enableRateLimiting: true,
    enableDeviceTracking: false, // DISABLED - prevents AudioContext errors
    enableInputValidation: true,
    enableAuditLogging: true,
    componentName: 'MusicAdManager',
    sensitiveComponent: true // Ad management contains revenue data
  });

  // Tax calculations for ad revenue
  const taxCalc = useTaxCalculations(auth.selectedBusinessId);

  // Local state for ad management
  const [ads, setAds] = useState([]);
  const [localAds, setLocalAds] = useState([]);
  const [adSettings, setAdSettings] = useState({
    frequency: 5,
    enabled: true,
    volume_adjustment: 0.8,
    networkAdsEnabled: true,
    localAdsEnabled: true,
    ad_selection_mode: 'random',
    ads_per_slot: 1
  });
  const [adStats, setAdStats] = useState({
    totalPlays: 0,
    todayPlays: 0,
    revenue: 0,
    networkRevenue: 0,
    localAdPlays: 0
  });
  const [loading, setLoading] = useState(true);
  const [uploadingAd, setUploadingAd] = useState(false);
  const [errors, setErrors] = useState({});
  const [showRevenueDetails, setShowRevenueDetails] = useState(false);
  const [showTtsModal, setShowTtsModal] = useState(false);
  const [ttsText, setTtsText] = useState('');
  const [ttsTitle, setTtsTitle] = useState('');
  const [ttsVoice, setTtsVoice] = useState('alloy');
  const [generatingTts, setGeneratingTts] = useState(false);
  const testPlaybackAudioRef = useRef(null);
  const localAdPlaybackUrlsRef = useRef({});
  const [testPlaybackUrl, setTestPlaybackUrl] = useState(null);
  const [adTestEveryOneSong, setAdTestEveryOneSong] = useState(false);
  const [scheduleModalAd, setScheduleModalAd] = useState(null);

  // Permission checks based on permissionRegistry.js
  const canManageAds = hasPermission('music.ads.manage') || hasElevatedPrivileges();
  const canEditSettings = hasPermission('music.settings.edit') || hasElevatedPrivileges();
  const canViewRevenue = hasAnyPermission(['reports.financial.view', 'music.ads.manage']) || hasElevatedPrivileges();
  const canUploadAds = hasPermission('music.ads.manage') || isOwner();
  const canDeleteAds = hasPermission('music.ads.manage') || isOwner();

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canManageAds) {
      toast.error('You do not have permission to manage music advertisements');
      navigate('/dashboard/music/dashboard');
    }
  }, [permissionsLoading, canManageAds, navigate]);

  // Load data when authenticated
  useEffect(() => {
    if (auth.isReady && auth.selectedBusinessId && !permissionsLoading) {
      loadAllData();
    }
  }, [auth.isReady, auth.selectedBusinessId, permissionsLoading]);

  // Sync test mode "ad every 1 song" from global music service (e.g. when returning to this page)
  useEffect(() => {
    setAdTestEveryOneSong(globalMusicService.getAdTestModeEveryOneSong?.() ?? false);
  }, []);

  /**
   * Load all ad-related data
   */
  const loadAllData = async () => {
    // Check permission before loading
    if (!canManageAds) {
      toast.error('You do not have permission to view ad data');
      return;
    }

    setLoading(true);
    try {
      await Promise.all([
        loadNetworkAds(),
        loadLocalAds(),
        loadAdSettings(),
        canViewRevenue && loadAdStats()
      ].filter(Boolean));
    } catch (error) {
      setErrors(prev => ({ ...prev, loading: 'Failed to load ad data' }));
      toast.error('Failed to load ad data');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Load network ads
   */
  const loadNetworkAds = async () => {
    try {
      const { data, error } = await supabase
        .from('music_ads')
        .select('*')
        .or(`target_business_types.cs.{${auth.businessData?.type || 'general'}},target_business_types.cs.{general}`)
        .eq('active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAds(data || []);

      // Log data access
      await security.logSecurityEvent('network_ads_accessed', {
        ad_count: data?.length || 0,
        business_type: auth.businessData?.type
      }, 'low');

    } catch (error) {
      setErrors(prev => ({ ...prev, networkAds: 'Failed to load network ads' }));
    }
  };

  /**
   * Load local business ads
   */
  const loadLocalAds = async () => {
    if (!auth.selectedBusinessId) {
      setLocalAds([]);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('music_local_ads')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .order('uploaded_at', { ascending: false });

      if (error) throw error;
      setLocalAds(data || []);
      setErrors(prev => ({ ...prev, localAds: null }));
      localAdPlaybackUrlsRef.current = {};
      if (data?.length) {
        const expiresAt = Date.now() + 3500 * 1000;
        for (const ad of data) {
          if (ad.file_path) {
            supabase.storage.from('music-files').createSignedUrl(ad.file_path, 3600).then(({ data: d, error: e }) => {
              if (!e && d?.signedUrl) {
                localAdPlaybackUrlsRef.current[ad.id] = { url: d.signedUrl, expiresAt };
              }
            });
          }
        }
      }
    } catch (error) {
      const message = error?.message || String(error);
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[MusicAdManager] loadLocalAds error:', message);
      }
      setErrors(prev => ({ ...prev, localAds: 'Failed to load local ads. Check console for details.' }));
    }
  };

  /**
   * Load ad settings
   */
  const loadAdSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('music_settings')
        .select('ad_frequency, ad_enabled, ad_volume_adjustment, ad_selection_mode, ads_per_slot')
        .eq('business_id', auth.selectedBusinessId)
        .limit(1)
        .maybeSingle();

      if (data) {
        setAdSettings({
          frequency: data.ad_frequency || 5,
          enabled: data.ad_enabled !== false,
          volume_adjustment: data.ad_volume_adjustment ?? 0.8,
          networkAdsEnabled: data.network_ads_enabled !== false,
          localAdsEnabled: data.local_ads_enabled !== false,
          ad_selection_mode: data.ad_selection_mode === 'round_robin' ? 'round_robin' : 'random',
          ads_per_slot: Math.max(1, Math.min(10, parseInt(data.ads_per_slot, 10) || 1))
        });
      }
    } catch (error) {
      setErrors(prev => ({ ...prev, settings: 'Failed to load ad settings' }));
    }
  };

  /**
   * Load ad statistics
   */
  const loadAdStats = async () => {
    // Check permission before loading financial data
    if (!canViewRevenue) {
      return;
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Network ad plays
      const { count: totalCount } = await supabase
        .from('music_ad_plays')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', auth.selectedBusinessId);

      const { count: todayCount } = await supabase
        .from('music_ad_plays')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', auth.selectedBusinessId)
        .gte('played_at', `${today}T00:00:00.000Z`);

      // Local ad plays (table may not exist in all projects)
      let localCount = 0;
      const { count: localCountResult } = await supabase
        .from('music_local_ad_plays')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', auth.selectedBusinessId);
      if (localCountResult != null) localCount = localCountResult;

      // Calculate revenue with tax considerations
      const baseRevenue = (totalCount || 0) * 0.01;
      const taxableRevenue = baseRevenue;
      const taxCalculation = taxCalc.calculateItemTax(
        { category_id: null, name: 'Ad Revenue' },
        taxableRevenue
      );

      setAdStats({
        totalPlays: totalCount || 0,
        todayPlays: todayCount || 0,
        revenue: baseRevenue,
        networkRevenue: baseRevenue,
        localAdPlays: localCount || 0,
        taxableRevenue,
        taxAmount: taxCalculation.taxAmount
      });

    } catch (error) {
      setErrors(prev => ({ ...prev, stats: 'Failed to load ad statistics' }));
    }
  };

  /**
   * Update ad settings with security logging
   */
  const updateAdSettings = async (newSettings) => {
    // Permission check
    if (!canEditSettings) {
      toast.error('You do not have permission to edit ad settings');
      return;
    }

    const frequency = typeof newSettings.frequency === 'number' ? newSettings.frequency : parseInt(newSettings.frequency, 10);
    const volumeAdjustment = typeof newSettings.volume_adjustment === 'number' ? newSettings.volume_adjustment : parseFloat(newSettings.volume_adjustment);
    if (Number.isNaN(frequency) || frequency < 1 || frequency > 20) {
      setErrors(prev => ({ ...prev, settings: 'Ad frequency must be between 1 and 20' }));
      toast.error('Ad frequency must be between 1 and 20');
      return;
    }
    if (Number.isNaN(volumeAdjustment) || volumeAdjustment < 0.5 || volumeAdjustment > 2) {
      setErrors(prev => ({ ...prev, settings: 'Volume adjustment must be between 50% and 200%' }));
      toast.error('Volume adjustment must be between 50% and 200%');
      return;
    }

    const adsPerSlot = Math.max(1, Math.min(10, parseInt(newSettings.ads_per_slot, 10) || 1));
    const adSelectionMode = newSettings.ad_selection_mode === 'round_robin' ? 'round_robin' : 'random';
    try {
      const payload = {
        business_id: auth.selectedBusinessId,
        ad_frequency: frequency,
        ad_enabled: newSettings.enabled === true,
        ad_volume_adjustment: volumeAdjustment,
        ad_selection_mode: adSelectionMode,
        ads_per_slot: adsPerSlot,
        updated_at: new Date().toISOString()
      };
      const { error } = await supabase
        .from('music_settings')
        .upsert(payload, {
          onConflict: 'business_id'
        });

      if (error) throw error;

      setAdSettings({ ...newSettings, frequency, volume_adjustment: volumeAdjustment, ad_selection_mode: adSelectionMode, ads_per_slot: adsPerSlot });
      setErrors(prev => ({ ...prev, settings: null }));
      globalMusicService.clearAdEveryXSongsSettingsCache?.();
      toast.success('Ad settings saved. Ads will play between songs when music is playing.');

      // Log settings change
      await security.logSecurityEvent('ad_settings_updated', {
        changes: newSettings,
        updated_by: auth.authUser.id
      }, 'medium');

    } catch (error) {
      setErrors(prev => ({ ...prev, settings: 'Failed to update ad settings' }));
      toast.error('Failed to update ad settings');
    }
  };

  /**
   * Upload local ad with security validation
   */
  const uploadLocalAd = async (file, adInfo) => {
    // Permission check
    if (!canUploadAds) {
      toast.error('You do not have permission to upload advertisements');
      return;
    }

    // Input validation
    if (!file || !adInfo.title) {
      setErrors(prev => ({ ...prev, upload: 'File and title are required' }));
      toast.error('File and title are required');
      return;
    }

    // File type validation
    if (!file.type.includes('audio')) {
      setErrors(prev => ({ ...prev, upload: 'Only audio files are allowed' }));
      toast.error('Only audio files are allowed');
      return;
    }

    // File size validation (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      setErrors(prev => ({ ...prev, upload: 'File size must be under 10MB' }));
      toast.error('File size must be under 10MB');
      return;
    }

    setUploadingAd(true);
    setErrors(prev => ({ ...prev, upload: null }));

    try {
      // Create unique filename with business ID
      const fileName = `local-ads/${auth.selectedBusinessId}/${Date.now()}_${file.name}`;
      
      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('music-files')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // Get file duration
      const audio = new Audio();
      audio.src = URL.createObjectURL(file);
      
      const duration = await new Promise((resolve) => {
        audio.addEventListener('loadedmetadata', () => {
          resolve(Math.round(audio.duration));
        });
        audio.addEventListener('error', () => {
          resolve(30); // Default 30 seconds
        });
      });

      // Insert into local ads table
      const { error: dbError } = await supabase
        .from('music_local_ads')
        .insert({
          business_id: auth.selectedBusinessId,
          title: adInfo.title,
          description: adInfo.description || '',
          file_path: uploadData.path,
          duration: duration,
          active: true,
          play_frequency: adInfo.frequency || 10,
          uploaded_by: auth.authUser.id
        });

      if (dbError) throw dbError;

      // Log successful upload
      await security.logSecurityEvent('local_ad_uploaded', {
        file_name: file.name,
        file_size: file.size,
        duration: duration,
        title: adInfo.title
      }, 'medium');

      toast.success('Advertisement uploaded successfully');
      loadLocalAds(); // Refresh the list
      setErrors(prev => ({ ...prev, upload: null }));

    } catch (error) {
      setErrors(prev => ({ ...prev, upload: `Failed to upload ad: ${error.message}` }));
      toast.error(`Failed to upload ad: ${error.message}`);
    } finally {
      setUploadingAd(false);
    }
  };

  /**
   * Handle local ad upload with enhanced UI
   */
  const handleLocalAdUpload = () => {
    // Permission check
    if (!canUploadAds) {
      toast.error('You do not have permission to upload advertisements');
      return;
    }

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.mp3,.wav,.m4a,audio/*';
    
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const title = prompt('Enter ad title:', file.name.replace(/\.[^/.]+$/, ''));
      const description = prompt('Enter ad description (optional):', '');
      const frequency = parseInt(prompt('Play every X songs (default: 10):', '10')) || 10;

      if (title) {
        uploadLocalAd(file, { title, description, frequency });
      }
    };

    fileInput.click();
  };

  /**
   * Generate announcement audio with OpenAI TTS and save as local ad
   */
  const generateAnnouncementWithAI = async () => {
    if (!canUploadAds) {
      toast.error('You do not have permission to create advertisements');
      return;
    }
    const text = (ttsText || '').trim();
    const title = (ttsTitle || '').trim() || 'AI announcement';
    if (!text) {
      toast.error('Enter the announcement text to read aloud');
      return;
    }
    setGeneratingTts(true);
    setErrors(prev => ({ ...prev, tts: null }));
    try {
      const { data, error } = await supabase.functions.invoke('music-tts-announcement', {
        body: {
          business_id: auth.selectedBusinessId,
          text,
          title,
          voice: ttsVoice
        }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const file_path = data?.file_path;
      const duration = data?.duration_seconds || 30;
      if (!file_path) throw new Error('No audio path returned');

      const { error: dbError } = await supabase
        .from('music_local_ads')
        .insert({
          business_id: auth.selectedBusinessId,
          title: data.title || title,
          file_path,
          duration,
          active: true,
          play_frequency: 10,
          uploaded_by: auth.authUser?.id
        });

      if (dbError) throw dbError;

      await security.logSecurityEvent('local_ad_ai_generated', {
        title: data.title || title,
        text_length: text.length,
        voice: ttsVoice
      }, 'low');

      toast.success('AI announcement created');
      setShowTtsModal(false);
      setTtsText('');
      setTtsTitle('');
      loadLocalAds();
    } catch (err) {
      const msg = err?.message || (typeof err === 'string' ? err : 'Failed to generate');
      setErrors(prev => ({ ...prev, tts: msg }));
      toast.error(msg);
    } finally {
      setGeneratingTts(false);
    }
  };

  /**
   * Play ad audio for testing (local ads: from storage; network ads: from file_path if present).
   * Returns true if playback started, false otherwise.
   */
  const playAdAudio = async (ad, isLocal) => {
    const path = ad?.file_path;
    if (!path) {
      toast.error('No audio file for this ad');
      return false;
    }

    const cached = isLocal && localAdPlaybackUrlsRef.current[ad.id];
    if (cached?.url && cached.expiresAt > Date.now()) {
      setTestPlaybackUrl(cached.url);
      toast.success('Use the player below — turn up volume if needed');
      return true;
    }

    try {
      let url = null;
      const { data, error } = await supabase.storage
        .from('music-files')
        .createSignedUrl(path, 3600);
      if (error) {
        const { data: publicData } = supabase.storage.from('music-files').getPublicUrl(path);
        url = publicData?.publicUrl;
      } else {
        url = data?.signedUrl;
        if (isLocal && url) {
          localAdPlaybackUrlsRef.current[ad.id] = { url, expiresAt: Date.now() + 3500 * 1000 };
        }
      }
      if (!url) {
        toast.error('Could not load ad audio');
        return false;
      }
      setTestPlaybackUrl(url);
      toast.success('Use the player below — turn up volume if needed');
      return true;
    } catch (e) {
      toast.error('Could not play ad audio');
      return false;
    }
  };

  /**
   * Test ad live: stop current song, play the ad, then resume the same song (or start music if none was playing).
   */
  const testAdLive = async (ad) => {
    if (!ad?.file_path) {
      toast.error('No audio file for this ad');
      return;
    }
    if (!canManageAds) {
      toast.error('You do not have permission to test ads');
      return;
    }
    try {
      await globalMusicService.playAnnouncementThenNext(
        { file_path: ad.file_path },
        { resumeSameTrack: true }
      );
      toast.success('Ad played. Music resumed.');
    } catch (e) {
      const msg = e?.message || String(e);
      toast.error(msg.includes('Failed to get ad audio') ? 'Ad audio could not be loaded. Check storage and permissions.' : `Live test failed: ${msg}`);
    }
  };

  /**
   * Simulate ad play: play the audio, then log the play for tracking
   */
  const simulateAdPlay = async (ad, isLocal = false) => {
    if (!canManageAds) {
      toast.error('You do not have permission to test advertisements');
      return;
    }

    // Play audio first (local ads have file_path in music-files; network ads may have file_path too)
    if (ad?.file_path) {
      const played = await playAdAudio(ad, isLocal);
      if (!played && isLocal) return;
    } else if (isLocal) {
      toast.error('No audio file for this ad');
      return;
    }

    try {
      // Rate limiting for ad testing
      const rateLimitResult = await security.checkRateLimit('ad_test_play', 10, 60000); // 10 per minute
      if (!rateLimitResult.allowed) {
        setErrors(prev => ({ ...prev, play: 'Too many test plays. Please wait.' }));
        toast.warning('Too many test plays. Please wait.');
        return;
      }

      // Log the ad play. Skip insert for local ads when table may not exist (avoids 404).
      const tableName = isLocal ? 'music_local_ad_plays' : 'music_ad_plays';
      const adIdField = isLocal ? 'local_ad_id' : 'ad_id';
      let insertSucceeded = false;

      if (!isLocal) {
        const { error } = await supabase
          .from(tableName)
          .insert({
            [adIdField]: ad.id,
            business_id: auth.selectedBusinessId,
            played_at: new Date().toISOString(),
            test_play: true
          });
        if (error) throw error;
        insertSucceeded = true;
      }

      // Log security event
      await security.logSecurityEvent('ad_test_play', {
        ad_type: isLocal ? 'local' : 'network',
        ad_id: ad.id,
        ad_title: ad.title
      }, 'low');

      if (insertSucceeded) {
        toast.success('Test play recorded successfully');
        if (canViewRevenue) loadAdStats();
      } else if (isLocal) {
        toast.success('Playing ad');
      }
      setErrors(prev => ({ ...prev, play: null }));

    } catch (error) {
      setErrors(prev => ({ ...prev, play: 'Failed to log ad play' }));
      toast.error('Failed to log ad play');
    }
  };

  /**
   * Delete local ad
   */
  const deleteLocalAd = async (adId) => {
    // Permission check
    if (!canDeleteAds) {
      toast.error('You do not have permission to delete advertisements');
      return;
    }

    if (!window.confirm('Are you sure you want to delete this ad?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('music_local_ads')
        .delete()
        .eq('id', adId)
        .eq('business_id', auth.selectedBusinessId);

      if (error) throw error;

      // Log deletion
      await security.logSecurityEvent('local_ad_deleted', {
        ad_id: adId,
        deleted_by: auth.authUser.id
      }, 'medium');

      toast.success('Advertisement deleted successfully');
      loadLocalAds();

    } catch (error) {
      setErrors(prev => ({ ...prev, delete: 'Failed to delete ad' }));
      toast.error('Failed to delete ad');
    }
  };

  /**
   * Format schedule for display: "Always", "Mar 1 – Mar 31, 2025", "From Mar 1", "Until Mar 31"
   */
  const formatSchedule = (ad) => {
    const d = (v) => (v ? new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null);
    const start = d(ad.start_date);
    const end = d(ad.end_date);
    if (!start && !end) return 'Always';
    if (start && end) return `${start} – ${end}`;
    if (start) return `From ${start}`;
    return `Until ${end}`;
  };

  /**
   * Update an ad's start/end schedule dates
   */
  const updateLocalAdSchedule = async (adId, { start_date, end_date }) => {
    if (!canManageAds) return;
    try {
      const payload = { start_date: start_date || null, end_date: end_date || null };
      const { error } = await supabase
        .from('music_local_ads')
        .update(payload)
        .eq('id', adId)
        .eq('business_id', auth.selectedBusinessId);
      if (error) throw error;
      toast.success('Schedule updated');
      setScheduleModalAd(null);
      loadLocalAds();
      globalMusicService.clearAdEveryXSongsSettingsCache?.();
    } catch (e) {
      const msg = e?.message || '';
      if (msg.includes('end_date') || msg.includes('start_date') || msg.includes('schema cache')) {
        toast.error('Schedule columns missing. Run the migration: see supabase/migrations/RUN_THIS_ADD_music_local_ads_schedule_columns.sql in the SQL Editor.');
      } else {
        toast.error(msg || 'Failed to update schedule');
      }
    }
  };

  const styles = {
    container: {
      ...TavariStyles.layout.container,
      maxWidth: '1200px',
      margin: '0 auto'
    },

    loading: {
      ...TavariStyles.layout.flexCenter,
      minHeight: '400px',
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600
    },

    header: {
      textAlign: 'center',
      marginBottom: TavariStyles.spacing['4xl'],
      paddingBottom: TavariStyles.spacing.xl,
      borderBottom: `2px solid ${TavariStyles.colors.gray200}`
    },

    headerIcon: {
      color: TavariStyles.colors.success,
      marginBottom: TavariStyles.spacing.md
    },

    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.md
    },

    subtitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600
    },

    readOnlyBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      backgroundColor: TavariStyles.colors.warningBg,
      border: `2px solid ${TavariStyles.colors.warning}`,
      borderRadius: TavariStyles.borderRadius.md,
      color: TavariStyles.colors.warningText,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      marginTop: TavariStyles.spacing.md
    },

    readOnlyIcon: {
      fontSize: TavariStyles.typography.fontSize.md
    },

    // Error banner
    errorBanner: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      marginBottom: TavariStyles.spacing.lg
    },

    successBanner: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.success,
      marginBottom: TavariStyles.spacing.lg
    },

    // Stats section
    statsSection: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing['4xl']
    },

    statCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.lg,
      border: `2px solid ${TavariStyles.colors.success}`
    },

    statIcon: {
      color: TavariStyles.colors.success,
      fontSize: TavariStyles.typography.fontSize.xl
    },

    statContent: {
      flex: 1
    },

    statNumber: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xs
    },

    statLabel: {
      fontSize: TavariStyles.typography.fontSize.md,
      color: TavariStyles.colors.gray600
    },

    lockedStat: {
      filter: 'blur(4px)',
      pointerEvents: 'none'
    },

    // Settings section
    settingsSection: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing['4xl']
    },

    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.lg
    },

    settingsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
      gap: TavariStyles.spacing.xl
    },

    settingItem: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },

    settingLabel: {
      ...TavariStyles.components.form.label
    },

    settingSelect: {
      ...TavariStyles.components.form.select
    },

    disabledSelect: {
      ...TavariStyles.components.form.select,
      backgroundColor: TavariStyles.colors.gray100,
      cursor: 'not-allowed',
      opacity: 0.6
    },

    toggle: {
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      padding: TavariStyles.spacing.sm
    },

    checkboxContainer: {
      marginTop: TavariStyles.spacing.md
    },

    // Upload section
    uploadSection: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing['3xl'],
      textAlign: 'center',
      marginBottom: TavariStyles.spacing['4xl']
    },

    uploadDescription: {
      fontSize: TavariStyles.typography.fontSize.md,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.lg
    },

    uploadButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.lg,
      marginBottom: TavariStyles.spacing.md
    },

    disabledButton: {
      ...TavariStyles.components.button.base,
      backgroundColor: TavariStyles.colors.gray400,
      color: TavariStyles.colors.white,
      cursor: 'not-allowed'
    },

    lockedButton: {
      ...TavariStyles.components.button.base,
      backgroundColor: TavariStyles.colors.gray300,
      color: TavariStyles.colors.gray600,
      cursor: 'not-allowed',
      border: `2px solid ${TavariStyles.colors.gray400}`
    },

    // Ads sections
    adsSection: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing['4xl']
    },

    emptyState: {
      textAlign: 'center',
      padding: TavariStyles.spacing['4xl'],
      color: TavariStyles.colors.gray500
    },

    emptyIcon: {
      color: TavariStyles.colors.gray300,
      marginBottom: TavariStyles.spacing.lg
    },

    adsList: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.lg
    },

    adItem: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.lg,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: TavariStyles.spacing.lg
    },

    adInfo: {
      flex: 1,
      minWidth: '200px'
    },

    adTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xs
    },

    adMeta: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },

    adActions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm
    },

    actionButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.sm
    },

    dangerButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.danger,
      ...TavariStyles.components.button.sizes.sm
    },

    // Info section
    infoSection: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      backgroundColor: TavariStyles.colors.infoBg,
      border: `2px solid ${TavariStyles.colors.info}`
    },

    infoTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.md
    },

    infoList: {
      margin: 0,
      paddingLeft: TavariStyles.spacing.lg,
      color: TavariStyles.colors.gray700,
      lineHeight: TavariStyles.typography.lineHeight.relaxed
    },

    revenueDetails: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.lg,
      marginTop: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50
    },

    accessDenied: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing['4xl'],
      textAlign: 'center',
      marginTop: TavariStyles.spacing['4xl']
    },

    accessDeniedIcon: {
      fontSize: '64px',
      color: TavariStyles.colors.danger,
      marginBottom: TavariStyles.spacing.lg
    },

    accessDeniedTitle: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.md
    },

    accessDeniedText: {
      fontSize: TavariStyles.typography.fontSize.md,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.xl
    },

    backButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary
    }
  };

  // Show loading while permissions are being checked
  if (permissionsLoading || loading) {
    return (
      <POSAuthWrapper 
        componentName="MusicAdManager"
        requiredRoles={['manager', 'owner']}
      >
        <SecurityWrapper 
          componentName="MusicAdManager"
          sensitiveComponent={true}
        >
          <div style={styles.loading}>
            {permissionsLoading ? 'Loading permissions...' : 'Loading Ad Manager...'}
          </div>
        </SecurityWrapper>
      </POSAuthWrapper>
    );
  }

  // Show access denied if no permission
  if (!canManageAds) {
    return (
      <POSAuthWrapper 
        componentName="MusicAdManager"
        requiredRoles={['manager', 'owner']}
      >
        <SecurityWrapper 
          componentName="MusicAdManager"
          sensitiveComponent={true}
        >
          <div style={styles.container}>
            <div style={styles.accessDenied}>
              <FiLock style={styles.accessDeniedIcon} />
              <h2 style={styles.accessDeniedTitle}>Access Denied</h2>
              <p style={styles.accessDeniedText}>
                You do not have permission to manage music advertisements.
              </p>
              <p style={styles.accessDeniedText}>
                Contact your administrator to request access.
              </p>
              <button 
                style={styles.backButton}
                onClick={() => navigate('/dashboard/music/dashboard')}
              >
                Back to Music Dashboard
              </button>
            </div>
          </div>
        </SecurityWrapper>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper 
      componentName="MusicAdManager"
      requiredRoles={['manager', 'owner']}
    >
      <SecurityWrapper 
        componentName="MusicAdManager"
        sensitiveComponent={true}
      >
        <div style={styles.container}>
          {/* Error Messages */}
          {Object.values(errors).some(error => error) && (
            <div style={styles.errorBanner}>
              {Object.values(errors).filter(error => error).join('. ')}
            </div>
          )}

          {/* Header */}
          <div style={styles.header}>
            <FiDollarSign size={48} style={styles.headerIcon} />
            <h1 style={styles.title}>Music Ad Manager</h1>
            <p style={styles.subtitle}>
              Manage advertisements and revenue for {auth.businessData?.name || 'your business'}
            </p>
            {!canEditSettings && (
              <div style={styles.readOnlyBadge}>
                <FiAlertCircle style={styles.readOnlyIcon} />
                <span>Limited Access - Contact admin for full permissions</span>
              </div>
            )}
          </div>

          {/* Revenue Stats - Protected by permission */}
          <PermissionGate
            permissions={['reports.financial.view', 'music.ads.manage']}
            requireAny
            fallback={
              <div style={styles.statsSection}>
                <div style={{...styles.statCard, ...styles.lockedStat}}>
                  <FiLock style={styles.statIcon} />
                  <div style={styles.statContent}>
                    <div style={styles.statNumber}>***</div>
                    <div style={styles.statLabel}>Revenue Data Locked</div>
                  </div>
                </div>
              </div>
            }
          >
            <div style={styles.statsSection}>
              <div style={styles.statCard}>
                <FiBarChart style={styles.statIcon} />
                <div style={styles.statContent}>
                  <div style={styles.statNumber}>{adStats.totalPlays}</div>
                  <div style={styles.statLabel}>Network Ad Plays</div>
                </div>
              </div>

              <div style={styles.statCard}>
                <FiPlay style={styles.statIcon} />
                <div style={styles.statContent}>
                  <div style={styles.statNumber}>{adStats.localAdPlays}</div>
                  <div style={styles.statLabel}>Local Ad Plays</div>
                </div>
              </div>

              <div style={styles.statCard}>
                <FiDollarSign style={styles.statIcon} />
                <div style={styles.statContent}>
                  <div style={styles.statNumber}>${adStats.revenue?.toFixed(2) || '0.00'}</div>
                  <div style={styles.statLabel}>
                    Total Revenue
                    <button
                      style={{
                        background: 'none',
                        border: 'none',
                        color: TavariStyles.colors.primary,
                        cursor: 'pointer',
                        marginLeft: TavariStyles.spacing.xs
                      }}
                      onClick={() => setShowRevenueDetails(!showRevenueDetails)}
                    >
                      (Details)
                    </button>
                  </div>
                </div>
              </div>

              <div style={styles.statCard}>
                <FiCheckCircle style={styles.statIcon} />
                <div style={styles.statContent}>
                  <div style={styles.statNumber}>{adStats.todayPlays}</div>
                  <div style={styles.statLabel}>Today's Plays</div>
                </div>
              </div>
            </div>

            {/* Revenue Details */}
            {showRevenueDetails && adStats.taxAmount !== undefined && (
              <div style={styles.revenueDetails}>
                <h4>Revenue Breakdown:</h4>
                <p>Gross Revenue: ${adStats.revenue?.toFixed(2) || '0.00'}</p>
                <p>Tax Amount: ${adStats.taxAmount?.toFixed(2) || '0.00'}</p>
                <p>Net Revenue: ${((adStats.revenue || 0) - (adStats.taxAmount || 0)).toFixed(2)}</p>
              </div>
            )}
          </PermissionGate>

          {/* Ad Settings - Protected by permission */}
          <div style={styles.settingsSection}>
            <h2 style={styles.sectionTitle}>Advertisement Settings</h2>
            
            {!canEditSettings && (
              <div style={{...styles.readOnlyBadge, marginBottom: TavariStyles.spacing.lg}}>
                <FiLock style={styles.readOnlyIcon} />
                <span>Settings are read-only. Contact admin to make changes.</span>
              </div>
            )}
            
            <div style={styles.settingsGrid}>
              <div style={styles.settingItem}>
                <label style={styles.settingLabel}>Ad Frequency</label>
                <select
                  style={canEditSettings ? styles.settingSelect : styles.disabledSelect}
                  value={adSettings.frequency}
                  onChange={(e) => updateAdSettings({...adSettings, frequency: parseInt(e.target.value)})}
                  disabled={!canEditSettings}
                >
                  <option value={3}>Every 3 songs</option>
                  <option value={5}>Every 5 songs</option>
                  <option value={7}>Every 7 songs</option>
                  <option value={10}>Every 10 songs</option>
                  <option value={15}>Every 15 songs</option>
                </select>
              </div>

              <div style={styles.settingItem}>
                <label style={styles.settingLabel}>Ad Volume</label>
                <select
                  style={canEditSettings ? styles.settingSelect : styles.disabledSelect}
                  value={adSettings.volume_adjustment}
                  onChange={(e) => updateAdSettings({...adSettings, volume_adjustment: parseFloat(e.target.value)})}
                  disabled={!canEditSettings}
                >
                  <option value={0.6}>60% of music level</option>
                  <option value={0.7}>70% of music level</option>
                  <option value={0.8}>80% of music level</option>
                  <option value={0.9}>90% of music level</option>
                  <option value={1.0}>100% (same as music)</option>
                  <option value={1.1}>110% (louder than music)</option>
                  <option value={1.25}>125% (louder than music)</option>
                  <option value={1.5}>150% (boosted)</option>
                  <option value={1.75}>175% (boosted)</option>
                  <option value={2}>200% (announcement level)</option>
                </select>
              </div>
              <div style={styles.settingItem}>
                <label style={styles.settingLabel}>Ad selection</label>
                <select
                  style={canEditSettings ? styles.settingSelect : styles.disabledSelect}
                  value={adSettings.ad_selection_mode}
                  onChange={(e) => updateAdSettings({...adSettings, ad_selection_mode: e.target.value})}
                  disabled={!canEditSettings}
                >
                  <option value="random">Random (pick randomly each time)</option>
                  <option value="round_robin">Round-robin (cycle through in order)</option>
                </select>
              </div>
              <div style={styles.settingItem}>
                <label style={styles.settingLabel}>Ads per slot</label>
                <select
                  style={canEditSettings ? styles.settingSelect : styles.disabledSelect}
                  value={adSettings.ads_per_slot}
                  onChange={(e) => updateAdSettings({...adSettings, ads_per_slot: parseInt(e.target.value, 10)})}
                  disabled={!canEditSettings}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <option key={n} value={n}>{n} ad{n > 1 ? 's' : ''} back-to-back</option>
                  ))}
                </select>
                <p style={{ margin: '4px 0 0', fontSize: 10, color: TavariStyles.colors.gray600 }}>Play this many ads in a row before the next song</p>
              </div>
            </div>

            <div style={styles.checkboxContainer}>
              <TavariCheckbox
                checked={adSettings.enabled}
                onChange={(checked) => canEditSettings && updateAdSettings({...adSettings, enabled: checked})}
                label="Enable all advertisements"
                size="md"
                disabled={!canEditSettings}
              />
            </div>

            <div style={styles.checkboxContainer}>
              <TavariCheckbox
                checked={adSettings.networkAdsEnabled}
                onChange={(checked) => canEditSettings && updateAdSettings({...adSettings, networkAdsEnabled: checked})}
                label="Enable network advertisements (revenue generating)"
                size="md"
                disabled={!canEditSettings}
              />
            </div>

            <div style={styles.checkboxContainer}>
              <TavariCheckbox
                checked={adSettings.localAdsEnabled}
                onChange={(checked) => canEditSettings && updateAdSettings({...adSettings, localAdsEnabled: checked})}
                label="Enable local business advertisements"
                size="md"
                disabled={!canEditSettings}
              />
            </div>

            <div style={{ ...styles.checkboxContainer, marginTop: 16, padding: 12, background: '#fefce8', borderRadius: 8, border: '1px solid #facc15' }}>
              <TavariCheckbox
                checked={adTestEveryOneSong}
                onChange={(checked) => {
                  globalMusicService.setAdTestModeEveryOneSong?.(checked);
                  setAdTestEveryOneSong(checked);
                  toast.success(checked ? 'Test mode on: ad will play after every 1 song' : 'Test mode off: using normal ad frequency');
                }}
                label="Test mode: play ad every 1 song"
                size="md"
              />
              <p style={{ margin: '4px 0 0 0', fontSize: 10, color: '#713f12' }}>
                Use this to test the announcement flow without waiting for multiple songs. Turn off when done testing.
              </p>
            </div>
          </div>

          {/* Local Ad Upload - Protected by permission */}
          <div style={styles.uploadSection}>
            <h2 style={styles.sectionTitle}>Upload Local Advertisement</h2>
            <p style={styles.uploadDescription}>
              Upload your own advertisements to promote your business or products
            </p>
            
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
              <PermissionGate
                permission="music.ads.manage"
                fallback={
                  <button
                    style={styles.lockedButton}
                    disabled
                    title="You don't have permission to upload ads"
                  >
                    <FiLock size={20} />
                    Upload Locked
                  </button>
                }
              >
                <button
                  style={uploadingAd ? styles.disabledButton : styles.uploadButton}
                  onClick={handleLocalAdUpload}
                  disabled={uploadingAd}
                >
                  <FiUpload size={20} />
                  {uploadingAd ? 'Uploading...' : 'Upload Local Ad'}
                </button>
                <button
                  type="button"
                  style={{
                    ...styles.uploadButton,
                    background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)',
                    color: '#fff'
                  }}
                  onClick={() => setShowTtsModal(true)}
                  disabled={uploadingAd || generatingTts}
                >
                  <FiZap size={20} />
                  Create with AI (read aloud)
                </button>
              </PermissionGate>
            </div>

            {showTtsModal && (
              <div style={{
                position: 'fixed',
                inset: 0,
                zIndex: 1000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0,0,0,0.5)'
              }} onClick={() => !generatingTts && setShowTtsModal(false)}>
                <div style={{
                  background: '#fff',
                  borderRadius: 12,
                  padding: 24,
                  maxWidth: 480,
                  width: '90%',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
                }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h3 style={{ margin: 0, fontSize: 14 }}>AI announcement</h3>
                    <button type="button" onClick={() => !generatingTts && setShowTtsModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><FiX size={24} /></button>
                  </div>
                  <p style={{ color: '#666', fontSize: 11, marginBottom: 12 }}>Enter text and OpenAI will read it aloud and save as a local ad.</p>
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Title (for the ad list)</label>
                  <input
                    type="text"
                    value={ttsTitle}
                    onChange={e => setTtsTitle(e.target.value)}
                    placeholder="e.g. Weekly special"
                    style={{ width: '100%', padding: '8px 12px', marginBottom: 12, border: '1px solid #ccc', borderRadius: 8 }}
                  />
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Text to read aloud</label>
                  <textarea
                    value={ttsText}
                    onChange={e => setTtsText(e.target.value)}
                    placeholder="e.g. This week only, get 20% off all smoothies. Visit us at the counter."
                    rows={4}
                    maxLength={4096}
                    style={{ width: '100%', padding: '8px 12px', marginBottom: 8, border: '1px solid #ccc', borderRadius: 8, resize: 'vertical' }}
                  />
                  <p style={{ fontSize: 10, color: '#888', marginBottom: 12 }}>{ttsText.length} / 4096 characters</p>
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Voice</label>
                  <select
                    value={ttsVoice}
                    onChange={e => setTtsVoice(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', marginBottom: 16, border: '1px solid #ccc', borderRadius: 8 }}
                  >
                    <option value="alloy">Alloy (neutral)</option>
                    <option value="echo">Echo</option>
                    <option value="fable">Fable</option>
                    <option value="onyx">Onyx (deeper)</option>
                    <option value="nova">Nova</option>
                    <option value="shimmer">Shimmer</option>
                  </select>
                  {errors.tts && <p style={{ color: '#dc2626', fontSize: 11, marginBottom: 12 }}>{errors.tts}</p>}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => !generatingTts && setShowTtsModal(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}>Cancel</button>
                    <button type="button" onClick={generateAnnouncementWithAI} disabled={generatingTts || !ttsText.trim()} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: generatingTts ? '#94a3b8' : 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)', color: '#fff', cursor: generatingTts ? 'not-allowed' : 'pointer' }}>
                      {generatingTts ? 'Generating...' : 'Generate & save as ad'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Local Ads */}
          <div style={styles.adsSection}>
            <h2 style={styles.sectionTitle}>Your Local Ads ({localAds.length})</h2>
            {testPlaybackUrl && (
              <div style={{ marginBottom: 16, padding: 12, background: '#f0f9ff', borderRadius: 8, border: '1px solid #bae6fd' }}>
                <p style={{ margin: '0 0 8px 0', fontSize: 11, fontWeight: 600 }}>Test playback — use the volume control below if you don’t hear sound</p>
                <audio
                  ref={testPlaybackAudioRef}
                  src={testPlaybackUrl}
                  controls
                  style={{ width: '100%', maxWidth: 400, height: 40 }}
                  onEnded={() => setTestPlaybackUrl(null)}
                />
                <button type="button" onClick={() => setTestPlaybackUrl(null)} style={{ marginTop: 8, fontSize: 10, color: '#0369a1', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Close player</button>
              </div>
            )}
            {localAds.length === 0 ? (
              <div style={styles.emptyState}>
                <FiUpload size={48} style={styles.emptyIcon} />
                <h3>No local ads uploaded</h3>
                <p>Upload your own advertisements to promote your business</p>
              </div>
            ) : (
              <div style={styles.adsList}>
                {localAds.map(ad => (
                  <div key={ad.id} style={styles.adItem}>
                    <div style={styles.adInfo}>
                      <h3 style={styles.adTitle}>{ad.title}</h3>
                      <p style={styles.adMeta}>
                        Duration: {ad.duration}s • {adTestEveryOneSong ? 'Plays every 1 song (test mode)' : `Plays every ${adSettings.frequency} songs (per settings above)`}
                        {ad.description && ` • ${ad.description}`}
                      </p>
                      <p style={{ ...styles.adMeta, marginTop: 4, fontSize: 10, color: TavariStyles.colors.gray600 }}>
                        Schedule: {formatSchedule(ad)}
                      </p>
                    </div>
                    <div style={styles.adActions}>
                      <PermissionGate permission="music.ads.manage">
                        <button
                          style={styles.actionButton}
                          onClick={() => setScheduleModalAd({
                            id: ad.id,
                            title: ad.title,
                            start_date: ad.start_date ? String(ad.start_date).slice(0, 10) : '',
                            end_date: ad.end_date ? String(ad.end_date).slice(0, 10) : ''
                          })}
                          title="Set start and end date for when this ad runs"
                        >
                          <FiEdit size={16} />
                          Schedule
                        </button>
                      </PermissionGate>
                      {/* Test button - always visible if user can manage ads */}
                      <PermissionGate
                        permission="music.ads.manage"
                        fallback={
                          <button
                            style={{...styles.actionButton, opacity: 0.5}}
                            disabled
                            title="You don't have permission to test ads"
                          >
                            <FiLock size={16} />
                          </button>
                        }
                      >
                        <button
                          style={styles.actionButton}
                          onClick={() => simulateAdPlay(ad, true)}
                          title="Preview in player below"
                        >
                          <FiPlay size={16} />
                          Test
                        </button>
                        <button
                          style={styles.actionButton}
                          onClick={() => testAdLive(ad)}
                          title="Play like live: pauses music, plays ad with volume boost, then resumes"
                        >
                          <FiRadio size={16} />
                          Test live
                        </button>
                      </PermissionGate>

                      {/* Delete button - restricted to owners */}
                      <PermissionGate
                        requireOwner
                        fallback={
                          <button
                            style={{...styles.dangerButton, opacity: 0.5}}
                            disabled
                            title="Only owners can delete ads"
                          >
                            <FiLock size={16} />
                          </button>
                        }
                      >
                        <button
                          style={styles.dangerButton}
                          onClick={() => deleteLocalAd(ad.id)}
                        >
                          <FiTrash2 size={16} />
                          Delete
                        </button>
                      </PermissionGate>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Schedule modal for local ad */}
          {scheduleModalAd && (
            <div style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000
            }} onClick={() => setScheduleModalAd(null)}>
              <div style={{
                background: TavariStyles.colors.white,
                borderRadius: 12,
                padding: 24,
                maxWidth: 400,
                width: '90%',
                boxShadow: '0 20px 40px rgba(0,0,0,0.15)'
              }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 14 }}>Schedule: {scheduleModalAd.title}</h3>
                  <button type="button" onClick={() => setScheduleModalAd(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><FiX size={20} /></button>
                </div>
                <p style={{ fontSize: 10, color: TavariStyles.colors.gray600, marginBottom: 16 }}>Only play this ad between the start and end dates. Leave blank for no limit.</p>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 600, marginBottom: 4 }}>Start date (optional)</label>
                  <input
                    type="date"
                    value={scheduleModalAd.start_date}
                    onChange={(e) => setScheduleModalAd(prev => ({ ...prev, start_date: e.target.value }))}
                    style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #ccc' }}
                  />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 600, marginBottom: 4 }}>End date (optional)</label>
                  <input
                    type="date"
                    value={scheduleModalAd.end_date}
                    onChange={(e) => setScheduleModalAd(prev => ({ ...prev, end_date: e.target.value }))}
                    style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #ccc' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setScheduleModalAd(null)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}>Cancel</button>
                  <button type="button" onClick={() => updateLocalAdSchedule(scheduleModalAd.id, { start_date: scheduleModalAd.start_date || null, end_date: scheduleModalAd.end_date || null })} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: TavariStyles.colors.primary, color: '#fff', cursor: 'pointer' }}>Save</button>
                </div>
              </div>
            </div>
          )}

          {/* Network Ads */}
          <div style={styles.adsSection}>
            <h2 style={styles.sectionTitle}>Network Advertisements ({ads.length})</h2>
            {ads.length === 0 ? (
              <div style={styles.emptyState}>
                <FiDollarSign size={48} style={styles.emptyIcon} />
                <h3>No network ads available</h3>
                <p>Network ads will appear here based on your business type</p>
              </div>
            ) : (
              <div style={styles.adsList}>
                {ads.map(ad => (
                  <div key={ad.id} style={styles.adItem}>
                    <div style={styles.adInfo}>
                      <h3 style={styles.adTitle}>{ad.title}</h3>
                      <p style={styles.adMeta}>
                        Duration: {ad.duration}s • 
                        Target: {ad.target_business_types?.join(', ') || 'All businesses'} • 
                        Revenue: $0.01 per play
                      </p>
                    </div>
                    <div style={styles.adActions}>
                      {/* Test play button - protected */}
                      <PermissionGate
                        permission="music.ads.manage"
                        fallback={
                          <button
                            style={{...styles.actionButton, opacity: 0.5}}
                            disabled
                            title="You don't have permission to test ads"
                          >
                            <FiLock size={16} />
                          </button>
                        }
                      >
                        <button
                          style={styles.actionButton}
                          onClick={() => simulateAdPlay(ad, false)}
                        >
                          <FiPlay size={16} />
                          Test Play
                        </button>
                      </PermissionGate>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Integration Info */}
          <div style={styles.infoSection}>
            <h3 style={styles.infoTitle}>How Advertisement System Works</h3>
            <ul style={styles.infoList}>
              <li>Network ads play automatically between songs and generate revenue for your business</li>
              <li>Local ads let you promote your own products and services to customers</li>
              <li>Ad frequency and volume can be customized to your preferences</li>
              <li>All ad plays are tracked for accurate revenue reporting</li>
              <li>Tax calculations are automatically applied to ad revenue</li>
              <li>Revenue reports help you understand the value of the ad system</li>
              <li><strong>Permission levels:</strong> Managers can view and test ads, Owners can also upload and delete</li>
            </ul>
          </div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default MusicAdManager;