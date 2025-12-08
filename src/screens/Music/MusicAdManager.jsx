// src/screens/Music/MusicAdManager.jsx - WITH PERMISSION SYSTEM INTEGRATION
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiDollarSign, FiUpload, FiPlay, FiPause, FiSettings, FiBarChart, FiToggleLeft, FiToggleRight, FiAlertCircle, FiCheckCircle, FiTrash2, FiEdit, FiLock, FiEye } from 'react-icons/fi';

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
    localAdsEnabled: true
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
    try {
      const { data, error } = await supabase
        .from('music_local_ads')
        .select('*')
        .eq('business_id', auth.selectedBusinessId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setLocalAds(data || []);

    } catch (error) {
      setErrors(prev => ({ ...prev, localAds: 'Failed to load local ads' }));
    }
  };

  /**
   * Load ad settings
   */
  const loadAdSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('music_settings')
        .select('ad_frequency, ad_enabled, ad_volume_adjustment, network_ads_enabled, local_ads_enabled')
        .eq('business_id', auth.selectedBusinessId)
        .single();

      if (data) {
        setAdSettings({
          frequency: data.ad_frequency || 5,
          enabled: data.ad_enabled !== false,
          volume_adjustment: data.ad_volume_adjustment || 0.8,
          networkAdsEnabled: data.network_ads_enabled !== false,
          localAdsEnabled: data.local_ads_enabled !== false
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

      // Local ad plays
      const { count: localCount } = await supabase
        .from('music_local_ad_plays')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', auth.selectedBusinessId);

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

    // Validate input
    const validatedSettings = security.validateInput(newSettings, {
      frequency: 'number',
      enabled: 'boolean',
      volume_adjustment: 'number',
      networkAdsEnabled: 'boolean',
      localAdsEnabled: 'boolean'
    });

    if (!validatedSettings.isValid) {
      setErrors(prev => ({ ...prev, settings: 'Invalid settings data' }));
      toast.error('Invalid settings data');
      return;
    }

    try {
      const { error } = await supabase
        .from('music_settings')
        .upsert({
          business_id: auth.selectedBusinessId,
          ad_frequency: newSettings.frequency,
          ad_enabled: newSettings.enabled,
          ad_volume_adjustment: newSettings.volume_adjustment,
          network_ads_enabled: newSettings.networkAdsEnabled,
          local_ads_enabled: newSettings.localAdsEnabled,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'business_id'
        });

      if (error) throw error;

      setAdSettings(newSettings);
      setErrors(prev => ({ ...prev, settings: null }));
      toast.success('Ad settings updated successfully');

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
   * Simulate ad play with proper tracking
   */
  const simulateAdPlay = async (ad, isLocal = false) => {
    // Permission check
    if (!canManageAds) {
      toast.error('You do not have permission to test advertisements');
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

      const tableName = isLocal ? 'music_local_ad_plays' : 'music_ad_plays';
      const adIdField = isLocal ? 'local_ad_id' : 'ad_id';

      // Log the ad play
      const { error } = await supabase
        .from(tableName)
        .insert({
          [adIdField]: ad.id,
          business_id: auth.selectedBusinessId,
          played_at: new Date().toISOString(),
          test_play: true
        });

      if (error) throw error;

      // Log security event
      await security.logSecurityEvent('ad_test_play', {
        ad_type: isLocal ? 'local' : 'network',
        ad_id: ad.id,
        ad_title: ad.title
      }, 'low');

      toast.success('Test play recorded successfully');
      if (canViewRevenue) {
        loadAdStats(); // Refresh stats if user can view them
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
                  <option value={0.6}>60% of music volume</option>
                  <option value={0.7}>70% of music volume</option>
                  <option value={0.8}>80% of music volume</option>
                  <option value={0.9}>90% of music volume</option>
                  <option value={1.0}>100% of music volume</option>
                </select>
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
          </div>

          {/* Local Ad Upload - Protected by permission */}
          <div style={styles.uploadSection}>
            <h2 style={styles.sectionTitle}>Upload Local Advertisement</h2>
            <p style={styles.uploadDescription}>
              Upload your own advertisements to promote your business or products
            </p>
            
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
            </PermissionGate>
          </div>

          {/* Local Ads */}
          <div style={styles.adsSection}>
            <h2 style={styles.sectionTitle}>Your Local Ads ({localAds.length})</h2>
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
                        Duration: {ad.duration}s • Plays every {ad.play_frequency} songs
                        {ad.description && ` • ${ad.description}`}
                      </p>
                    </div>
                    <div style={styles.adActions}>
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
                        >
                          <FiPlay size={16} />
                          Test
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