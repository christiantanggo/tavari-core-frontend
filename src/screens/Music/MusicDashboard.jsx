// src/screens/Music/MusicDashboard.jsx - TABBED INTERFACE WITH UX ENHANCEMENTS
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FiMusic, FiUpload, FiList, FiSettings, FiLock, FiPlay, FiAlertCircle, FiDollarSign, FiDownload, FiMonitor, FiRefreshCw, FiCalendar, FiHardDrive, FiVolume2 } from 'react-icons/fi';

// Tavari Build Standards - Required imports
import { TavariStyles } from '../../utils/TavariStyles';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { SecurityWrapper } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useSecurityContext } from '../../Security/useSecurityContext';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';

// Permission system integration
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import { useModuleSubscription } from '../../hooks/useModuleSubscription';
import toast from 'react-hot-toast';

// UX Enhancement Components
import ErrorBoundary from '../../components/UI/ErrorBoundary';
import Breadcrumbs from '../../components/UI/Breadcrumbs';
import SkeletonLoader from '../../components/UI/SkeletonLoader';
import EmptyState from '../../components/UI/EmptyState';
import ContextualHelp from '../../components/UI/ContextualHelp';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import TavariTabSystemComponent from '../../components/UI/TavariTabSystemComponent';

// Services
import ModuleCatalogService from '../../services/ModuleCatalogService';
import RecentActivityService from '../../services/RecentActivityService';
import { supabase } from '../../supabaseClient';

// Music-specific components
import AudioPlayer from '../../components/Music/AudioPlayer';
import SystemMonitor from '../../components/Music/SystemMonitor';
import PlaybackMonitor from '../../components/Music/PlaybackMonitor';
import InstallationListManager from '../../components/Desktop/InstallationListManager';
import MusicSubscriptionGate from '../../components/Music/MusicSubscriptionGate';
import { globalMusicService } from '../../services/GlobalMusicService';

// Music screen components for tabs
import MusicUpload from './MusicUpload';
import MusicLibrary from './MusicLibrary';
import PlaylistManager from './PlaylistManager';
import MusicSchedules from './MusicSchedules';
import MusicSystemMonitor from './MusicSystemMonitor';
import MusicAdManager from './MusicAdManager';

/**
 * Music Dashboard - Main hub for music management with tabbed interface
 * Integrates with Tavari permission system for granular access control
 */
const MusicDashboard = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'overview');

  // Tavari standardized authentication
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'], // Music access restricted to managers and owners
    requireBusiness: true,
    componentName: 'MusicDashboard'
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
    componentName: 'MusicDashboard',
    sensitiveComponent: true // Music dashboard contains business content
  });

  // Tax calculations (for potential music purchases/licensing)
  const taxCalc = useTaxCalculations(auth.selectedBusinessId);

  // Module subscription check
  const subscription = useModuleSubscription('music', { autoCheck: true });

  // Permission checks based on permissionRegistry.js
  const canAccessDashboard = hasAnyPermission([
    'music.control.play_pause',
    'music.library.upload',
    'music.playlists.create',
    'music.settings.edit'
  ]) || hasElevatedPrivileges();

  const canControlMusic = hasPermission('music.control.play_pause');
  const canUploadMusic = hasPermission('music.library.upload') || hasElevatedPrivileges();
  const canManagePlaylists = hasPermission('music.playlists.create') || hasElevatedPrivileges();
  const canEditSettings = hasPermission('music.settings.edit') || hasElevatedPrivileges();
  const canManageAds = hasPermission('music.ads.manage') || hasElevatedPrivileges();
  const canManageSchedules = hasPermission('music.schedules.manage') || hasElevatedPrivileges();
  const canViewSystemMonitor = hasPermission('music.system_monitor.view') || hasElevatedPrivileges();

  // ALL HOOKS MUST BE CALLED BEFORE ANY CONDITIONAL RETURNS
  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canAccessDashboard) {
      toast.error('You do not have permission to access the Music Dashboard');
      navigate('/dashboard');
    }
  }, [permissionsLoading, canAccessDashboard, navigate]);

  // Module/recent-activity tracking on each visit; security audit DB rows only once per session per business
  useEffect(() => {
    const logAccess = async () => {
      if (!canAccessDashboard) return;

      ModuleCatalogService.setBusinessId(auth.selectedBusinessId);
      await ModuleCatalogService.trackModuleUsage('music');

      RecentActivityService.setBusinessId(auth.selectedBusinessId);
      await RecentActivityService.trackActivity('music', 'dashboard', null, 'Music Dashboard');

      const auditKey = `tavari_audit_music_dashboard_${auth.selectedBusinessId}`;
      const alreadyLogged =
        typeof sessionStorage !== 'undefined' && sessionStorage.getItem(auditKey) === '1';
      if (alreadyLogged) return;

      try {
        await security.logSecurityEvent(
          'music_dashboard_access',
          {
            user_role: auth.userRole,
            business_id: auth.selectedBusinessId,
            permissions: {
              canControlMusic,
              canUploadMusic,
              canManagePlaylists,
              canEditSettings
            }
          },
          'low'
        );
        await security.recordAction('music_dashboard_view', true);
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem(auditKey, '1');
        }
      } catch (e) {
        console.warn('[MusicDashboard] Session audit log skipped:', e);
      }
    };

    if (auth.selectedBusinessId && !permissionsLoading) {
      logAccess();
    }
  }, [auth.selectedBusinessId, auth.userRole, security, permissionsLoading, canAccessDashboard, canControlMusic, canUploadMusic, canManagePlaylists, canEditSettings]);

  // Test announcement state - MUST be called before any conditional returns
  const [testingAnnouncement, setTestingAnnouncement] = useState(false);
  
  // Remote restart state - MUST be called before any conditional returns
  const [restartingKiosk, setRestartingKiosk] = useState(false);

  // NOW ALL HOOKS ARE CALLED - SAFE TO DO CONDITIONAL RETURNS
  // Check subscription access
  if (subscription.loading || permissionsLoading) {
    return (
      <SecurityWrapper>
        <div style={{ padding: '24px' }}>
          <SkeletonLoader variant="card" count={3} />
        </div>
      </SecurityWrapper>
    );
  }

  // Show subscription gate if no access
  if (!subscription.hasAccess) {
    return (
      <MusicSubscriptionGate
        tier={subscription.tier}
        status={subscription.status}
        isTrial={subscription.isTrial}
        trialDaysRemaining={subscription.trialDaysRemaining}
      />
    );
  }

  // Tab configuration with permission-based filtering
  const tabs = [
    { 
      id: 'overview', 
      label: 'Overview', 
      icon: '🎵', 
      description: 'Quick player and system status',
      requiredPermissions: [],
      requiresElevated: false
    },
    { 
      id: 'upload', 
      label: 'Upload Music', 
      icon: '📤', 
      description: 'Add new songs to your music library',
      requiredPermissions: ['music.library.upload'],
      requiresElevated: false
    },
    { 
      id: 'library', 
      label: 'Music Library', 
      icon: '📚', 
      description: 'View and manage your song collection',
      requiredPermissions: ['music.library.view'],
      requiresElevated: false
    },
    { 
      id: 'playlists', 
      label: 'Playlists', 
      icon: '📋', 
      description: 'Create and manage custom playlists',
      requiredPermissions: ['music.playlists.create'],
      requiresElevated: false
    },
    { 
      id: 'schedules', 
      label: 'Schedules', 
      icon: '📅', 
      description: 'Schedule playlists by time and day',
      requiredPermissions: ['music.schedules.manage'],
      requiresElevated: false
    },
    { 
      id: 'monitoring', 
      label: 'Monitoring', 
      icon: '📊', 
      description: 'System status and playback tracking',
      requiredPermissions: ['music.system_monitor.view'],
      requiresElevated: false
    },
    { 
      id: 'ads', 
      label: 'Ad Manager', 
      icon: '💰', 
      description: 'Manage advertisements and revenue',
      requiredPermissions: ['music.ads.manage'],
      requiresElevated: false
    }
  ];

  // Filter tabs based on user permissions
  const availableTabs = tabs.filter(tab => {
    // Check if user has elevated privileges if required
    if (tab.requiresElevated && !hasElevatedPrivileges()) {
      return false;
    }
    
    // Check if user has any of the required permissions
    if (tab.requiredPermissions && tab.requiredPermissions.length > 0) {
      return hasAnyPermission(tab.requiredPermissions);
    }
    
    return true;
  });

  const handleTabChange = (tabId) => {
    // Check if user has permission to access this tab
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    // Verify permissions before switching
    if (tab.requiredPermissions && tab.requiredPermissions.length > 0) {
      if (!hasAnyPermission(tab.requiredPermissions)) {
        toast.error('You do not have permission to access this tab');
        return;
      }
    }

    if (tab.requiresElevated && !hasElevatedPrivileges()) {
      toast.error('This feature requires elevated privileges (manager or owner)');
      return;
    }

    setActiveTab(tabId);
  };

  // Test announcement function
  const handleTestAnnouncement = async () => {
    if (!auth.selectedBusinessId) {
      toast.error('No business selected');
      return;
    }

    setTestingAnnouncement(true);
    try {
      // Send a test announcement
      await globalMusicService.constructor.sendAnnouncement(auth.selectedBusinessId, {
        text: 'Test announcement from dashboard',
        type: 'test',
        timestamp: new Date().toISOString()
      });
      
      toast.success('📢 Test announcement sent! Check kiosk console for receipt.');
    } catch (error) {
      console.error('Error sending test announcement:', error);
      toast.error(`Failed to send announcement: ${error.message}`);
    } finally {
      setTestingAnnouncement(false);
    }
  };

  // Remote restart function
  const handleRemoteRestart = async () => {
    if (!auth.selectedBusinessId) {
      toast.error('No business selected');
      return;
    }

    const confirmRestart = window.confirm(
      '🔄 Restart all kiosks at your facility?\n\n' +
      'This will restart all kiosks running the music system. Music will automatically resume after restart.\n\n' +
      'This is useful after code updates to ensure kiosks have the latest features.'
    );

    if (!confirmRestart) {
      return;
    }

    setRestartingKiosk(true);
    try {
      await globalMusicService.constructor.sendRemoteRestart(
        auth.selectedBusinessId,
        'Remote restart from dashboard'
      );
      
      toast.success('🔄 Restart command sent! Kiosks will restart in a few seconds.');
    } catch (error) {
      console.error('Error sending restart command:', error);
      toast.error(`Failed to send restart command: ${error.message}`);
    } finally {
      setRestartingKiosk(false);
    }
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div>
            {/* Remote Control Section */}
            <div style={styles.testAnnouncementSection}>
              <h3 style={styles.sectionTitle}>🎮 Remote Kiosk Control</h3>
              
              {/* Test Announcement */}
              <div style={styles.remoteControlItem}>
                <h4 style={styles.remoteControlTitle}>📢 Test Announcement</h4>
                <p style={styles.testDescription}>
                  Send a test announcement to all kiosks at your facility. The kiosk will receive it and log it to the console.
                </p>
                <button
                  style={{
                    ...styles.testButton,
                    opacity: testingAnnouncement ? 0.6 : 1
                  }}
                  onClick={handleTestAnnouncement}
                  disabled={testingAnnouncement || !auth.selectedBusinessId}
                >
                  {testingAnnouncement ? (
                    <>
                      <FiRefreshCw style={{ ...styles.testButtonIcon, animation: 'spin 1s linear infinite' }} />
                      Sending...
                    </>
                  ) : (
                    <>
                      <FiVolume2 style={styles.testButtonIcon} />
                      Send Test Announcement
                    </>
                  )}
                </button>
              </div>

              {/* Remote Restart */}
              <div style={styles.remoteControlItem}>
                <h4 style={styles.remoteControlTitle}>🔄 Remote Restart</h4>
                <p style={styles.testDescription}>
                  Restart all kiosks at your facility remotely. Useful after code updates to ensure kiosks have the latest features. Music will automatically resume after restart.
                </p>
                <button
                  style={{
                    ...styles.restartButton,
                    opacity: restartingKiosk ? 0.6 : 1
                  }}
                  onClick={handleRemoteRestart}
                  disabled={restartingKiosk || !auth.selectedBusinessId}
                >
                  {restartingKiosk ? (
                    <>
                      <FiRefreshCw style={{ ...styles.testButtonIcon, animation: 'spin 1s linear infinite' }} />
                      Sending Restart Command...
                    </>
                  ) : (
                    <>
                      <FiRefreshCw style={styles.testButtonIcon} />
                      Restart All Kiosks
                    </>
                  )}
                </button>
              </div>

              <p style={styles.testNote}>
                Note: Kiosks must be online and subscribed to remote commands. Check the kiosk console for "🎮 ✅ Subscribed to remote commands channel" message.
              </p>
            </div>

            {/* Quick Actions */}
            <div style={styles.quickActionsSection}>
              <h3 style={styles.sectionTitle}>Quick Actions</h3>
              <div style={styles.quickActionsGrid}>
                {/* Music V2 System */}
                <div 
                  style={{
                    ...styles.quickActionCard,
                    border: `2px solid ${TavariStyles.colors.success}`,
                    background: `linear-gradient(135deg, ${TavariStyles.colors.white} 0%, ${TavariStyles.colors.success}08 100%)`
                  }}
                  onClick={() => navigate('/dashboard/music/v2/dashboard')}
                >
                  <FiMusic size={24} style={{ color: TavariStyles.colors.success }} />
                  <span style={styles.quickActionLabel}>Music V2</span>
                  <span style={styles.quickActionBadge}>NEW</span>
                </div>

                {/* Desktop Download */}
                <div 
                  style={styles.quickActionCard}
                  onClick={() => navigate('/dashboard/music/desktop-download')}
                >
                  <FiDownload size={24} />
                  <span style={styles.quickActionLabel}>Desktop App</span>
                </div>

                {/* Restart Desktop App - Only show in Electron */}
                {window.electronAPI && (
                  <div 
                    style={{
                      ...styles.quickActionCard,
                      border: `2px solid ${TavariStyles.colors.error}`
                    }}
                    onClick={async () => {
                      if (window.confirm('Restart the desktop app? Music will resume automatically after restart.')) {
                        try {
                          console.log('🔄 Manual restart requested from dashboard');
                          await window.electronAPI.restartApp();
                        } catch (error) {
                          console.error('Error restarting app:', error);
                          toast.error('Failed to restart app. Please restart manually.');
                        }
                      }
                    }}
                  >
                    <FiRefreshCw size={24} style={{ color: TavariStyles.colors.error }} />
                    <span style={styles.quickActionLabel}>Restart App</span>
                    <span style={styles.quickActionBadge}>DESKTOP</span>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Player - Only visible on overview tab */}
            <div style={styles.playerSection}>
              <h3 style={styles.playerTitle}>
                <FiMusic style={styles.playerIcon} />
                Quick Music Player
              </h3>
              <PermissionGate
                permission="music.control.play_pause"
                fallback={
                  <div style={styles.playerLocked}>
                    <FiLock size={32} style={{ color: TavariStyles.colors.gray400, marginBottom: TavariStyles.spacing.md }} />
                    <p>You do not have permission to control music playback.</p>
                    <p style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray400 }}>
                      Contact your administrator to request access.
                    </p>
                  </div>
                }
              >
                <div style={{ width: '100%' }}>
                  <AudioPlayer />
                </div>
              </PermissionGate>
            </div>

            {/* System Status */}
            <div style={styles.statusSection}>
              <h3 style={styles.sectionTitle}>System Status</h3>
              <div style={{
                ...styles.statusCard,
                borderColor: security.securityState.isSecure ? TavariStyles.colors.success : TavariStyles.colors.warning
              }}>
                {security.securityState.isSecure ? 
                  <span style={{ color: TavariStyles.colors.success }}>✓ All systems operational</span> : 
                  <span style={{ color: TavariStyles.colors.warning }}>⚠ Security warnings detected</span>
                }
              </div>
            </div>
          </div>
        );

      case 'upload':
        return (
          <PermissionGate 
            permissions={['music.library.upload']} 
            requireAny
            fallback={
              <div style={styles.noAccessContainer}>
                <p style={styles.noAccessText}>⚠️ You do not have permission to upload music</p>
              </div>
            }
          >
            <div style={styles.uploadWrapper}>
              <div style={{ marginTop: '-30px' }}>
                <MusicUpload />
              </div>
            </div>
          </PermissionGate>
        );

      case 'library':
        return (
          <div style={{ marginTop: '-30px', marginLeft: '-12px', marginRight: '-12px' }}>
            <MusicLibrary />
          </div>
        );

      case 'playlists':
        return (
          <PermissionGate 
            permissions={['music.playlists.create']} 
            requireAny
            fallback={
              <div style={styles.noAccessContainer}>
                <p style={styles.noAccessText}>⚠️ You do not have permission to manage playlists</p>
              </div>
            }
          >
            <PlaylistManager />
          </PermissionGate>
        );

      case 'schedules':
        return (
          <PermissionGate 
            permissions={['music.schedules.manage']} 
            requireAny
            fallback={
              <div style={styles.noAccessContainer}>
                <p style={styles.noAccessText}>⚠️ You do not have permission to manage schedules</p>
              </div>
            }
          >
            <MusicSchedules />
          </PermissionGate>
        );

      case 'monitoring':
        return (
          <div>
            <div style={styles.monitorSection}>
              <SystemMonitor />
            </div>
            <div style={styles.monitorSection}>
              <PlaybackMonitor />
            </div>
            <div style={styles.monitorSection}>
              <InstallationListManager />
            </div>
            {canViewSystemMonitor && (
              <div style={styles.monitorSection}>
                <MusicSystemMonitor />
              </div>
            )}
          </div>
        );

      case 'ads':
        return (
          <PermissionGate 
            permissions={['music.ads.manage']} 
            requireAny
            fallback={
              <div style={styles.noAccessContainer}>
                <p style={styles.noAccessText}>⚠️ You do not have permission to manage ads</p>
              </div>
            }
          >
            <ErrorBoundary moduleName="Ad Manager" moduleKey="music-ads">
              <div style={{ marginTop: '-30px', marginLeft: '-12px', marginRight: '-12px' }}>
                <MusicAdManager />
              </div>
            </ErrorBoundary>
          </PermissionGate>
        );

      case 'settings':
        return (
          <PermissionGate 
            permissions={['music.settings.edit']} 
            requireElevated
            fallback={
              <div style={styles.noAccessContainer}>
                <p style={styles.noAccessText}>⚠️ You do not have permission to edit music settings (requires manager/owner)</p>
              </div>
            }
          >
            <div style={styles.redirectCard}>
              <FiSettings size={48} style={{ color: TavariStyles.colors.primary, marginBottom: TavariStyles.spacing.lg }} />
              <h3 style={styles.redirectTitle}>Music Settings</h3>
              <p style={styles.redirectText}>
                Configure volume, shuffle, and other music preferences.
              </p>
              <button
                style={styles.redirectButton}
                onClick={() => navigate('/dashboard/music/settings')}
              >
                Go to Settings
              </button>
            </div>
          </PermissionGate>
        );

      default:
        return (
          <div style={styles.defaultContent}>
            <h3>Select a tab to get started</h3>
            <p>Choose from the available music management options above.</p>
          </div>
        );
    }
  };

  const styles = {
    container: {
      ...TavariStyles.layout.container,
      maxWidth: '1400px',
      margin: '0 auto',
      padding: '10px',
      paddingTop: '80px'
    },
    loading: {
      ...TavariStyles.layout.flexCenter,
      minHeight: '400px',
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600
    },
    accessDenied: {
      ...TavariStyles.layout.card,
      textAlign: 'center',
      padding: TavariStyles.spacing['6xl'],
      margin: '40px auto',
      maxWidth: '600px'
    },
    accessDeniedIcon: {
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
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.md,
      lineHeight: TavariStyles.typography.lineHeight.relaxed
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: TavariStyles.spacing.lg,
      paddingBottom: TavariStyles.spacing.md,
      borderBottom: `2px solid ${TavariStyles.colors.gray200}`
    },
    headerLeft: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.md,
      flex: 1
    },
    headerRight: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.md,
      flexShrink: 0
    },
    headerContent: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    headerIcon: {
      color: TavariStyles.colors.primary,
      flexShrink: 0
    },
    subscriptionInfo: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: TavariStyles.spacing.xs,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius.md,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      minWidth: '200px'
    },
    subscriptionInfoHover: {
      backgroundColor: TavariStyles.colors.gray100,
      borderColor: TavariStyles.colors.primary
    },
    subscriptionStatus: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    subscriptionLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    subscriptionValue: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.success,
      fontWeight: TavariStyles.typography.fontWeight.semibold
    },
    subscriptionDetails: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500
    },
    subscriptionPlan: {
      fontWeight: TavariStyles.typography.fontWeight.medium
    },
    subscriptionSeparator: {
      color: TavariStyles.colors.gray400
    },
    subscriptionRenewal: {
      color: TavariStyles.colors.gray500
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      margin: 0
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600,
      margin: 0
    },
    limitedAccessBadge: {
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
    tabContent: {
      padding: TavariStyles.spacing.xl,
      minHeight: '400px'
    },
    tabContentUpload: {
      paddingTop: '10px',
      paddingLeft: TavariStyles.spacing.xl,
      paddingRight: TavariStyles.spacing.xl,
      paddingBottom: TavariStyles.spacing.xl,
      minHeight: '400px'
    },
    tabContentLibrary: {
      paddingTop: '10px',
      paddingLeft: TavariStyles.spacing.md,
      paddingRight: TavariStyles.spacing.md,
      paddingBottom: TavariStyles.spacing.xl,
      minHeight: '400px'
    },
    uploadWrapper: {
      // Pull up to achieve exactly 10px spacing from tabs to upload icon
      marginTop: '0px',
      // Override MusicUpload container padding if needed
    },
    playerSection: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing.xl,
      border: `2px solid ${TavariStyles.colors.primary}`,
      background: `linear-gradient(135deg, ${TavariStyles.colors.white} 0%, ${TavariStyles.colors.gray50} 100%)`
    },
    playerTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.lg,
      textAlign: 'center',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TavariStyles.spacing.md
    },
    playerIcon: {
      color: TavariStyles.colors.primary
    },
    playerLocked: {
      padding: TavariStyles.spacing['3xl'],
      textAlign: 'center',
      color: TavariStyles.colors.gray500
    },
    testAnnouncementSection: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing.xl,
      border: `2px solid ${TavariStyles.colors.primary}`,
      backgroundColor: `${TavariStyles.colors.primary}08`
    },
    testDescription: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.md,
      lineHeight: TavariStyles.typography.lineHeight.relaxed
    },
    remoteControlItem: {
      marginBottom: TavariStyles.spacing.xl,
      paddingBottom: TavariStyles.spacing.xl,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`
    },
    remoteControlTitle: {
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.sm
    },
    testButton: {
      ...TavariStyles.components.button.primary,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.sm
    },
    restartButton: {
      ...TavariStyles.components.button.primary,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.error,
      borderColor: TavariStyles.colors.error
    },
    testButtonIcon: {
      fontSize: '14px'
    },
    testNote: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      fontStyle: 'italic',
      marginTop: TavariStyles.spacing.sm
    },
    quickActionsSection: {
      marginBottom: TavariStyles.spacing.xl
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.md
    },
    quickActionsGrid: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      flexWrap: 'wrap'
    },
    quickActionCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.md,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      border: `2px solid ${TavariStyles.colors.gray200}`,
      transition: 'all 0.2s ease',
      minWidth: '150px'
    },
    quickActionLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700
    },
    quickActionBadge: {
      fontSize: '10px',
      fontWeight: 'bold',
      padding: '2px 6px',
      borderRadius: '4px',
      backgroundColor: TavariStyles.colors.primary,
      color: 'white',
      marginLeft: 'auto'
    },
    statusSection: {
      marginBottom: TavariStyles.spacing.xl
    },
    statusCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.md,
      border: `2px solid ${TavariStyles.colors.gray200}`,
      textAlign: 'center'
    },
    monitorSection: {
      marginBottom: TavariStyles.spacing.xl
    },
    redirectCard: {
      ...TavariStyles.layout.card,
      textAlign: 'center',
      padding: TavariStyles.spacing['4xl'],
      maxWidth: '500px',
      margin: '0 auto'
    },
    redirectTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.md
    },
    redirectText: {
      fontSize: TavariStyles.typography.fontSize.md,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.xl,
      lineHeight: TavariStyles.typography.lineHeight.relaxed
    },
    redirectButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`
    },
    defaultContent: {
      textAlign: 'center',
      padding: `${TavariStyles.spacing['3xl']} 0`,
      color: TavariStyles.colors.gray600
    },
    noAccessContainer: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: `${TavariStyles.spacing['3xl']} 0`,
      minHeight: '400px'
    },
    noAccessText: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      textAlign: 'center'
    }
  };

  // Show loading state while permissions are being checked
  if (permissionsLoading || auth.authLoading) {
    return (
      <POSAuthWrapper 
        componentName="MusicDashboard"
        requiredRoles={['manager', 'owner']}
      >
        <SecurityWrapper 
          componentName="MusicDashboard"
          sensitiveComponent={true}
        >
          <div style={styles.loading}>Loading permissions...</div>
        </SecurityWrapper>
      </POSAuthWrapper>
    );
  }

  // Show access denied if no permission
  if (!canAccessDashboard) {
    return (
      <POSAuthWrapper 
        componentName="MusicDashboard"
        requiredRoles={['manager', 'owner']}
      >
        <SecurityWrapper 
          componentName="MusicDashboard"
          sensitiveComponent={true}
        >
          <div style={styles.container}>
            <div style={styles.accessDenied}>
              <FiLock size={64} style={styles.accessDeniedIcon} />
              <h2 style={styles.accessDeniedTitle}>Access Denied</h2>
              <p style={styles.accessDeniedText}>
                You do not have permission to access the Music Dashboard.
              </p>
              <p style={styles.accessDeniedText}>
                Contact your administrator to request music system access.
              </p>
            </div>
          </div>
        </SecurityWrapper>
      </POSAuthWrapper>
    );
  }

  const breadcrumbItems = [
    { label: 'Music', path: '/dashboard/music' }
  ];

  // Add current tab to breadcrumbs if not overview
  if (activeTab !== 'overview') {
    const currentTab = tabs.find(t => t.id === activeTab);
    if (currentTab) {
      breadcrumbItems.push({ label: currentTab.label });
    }
  }

  return (
    <ErrorBoundary moduleName="Music" moduleKey="music">
      <POSAuthWrapper 
        componentName="MusicDashboard"
        requiredRoles={['manager', 'owner']}
      >
        <SecurityWrapper 
          componentName="MusicDashboard"
          sensitiveComponent={true}
        >
          <div style={styles.container}>
            <TavariModuleHeader
              title="Tavari Music"
              description="Manage uploads, playlists, schedules, ads, playback, and system monitoring."
              actionLabel="Upload Music"
              actionIcon={<FiUpload size={18} />}
              onAction={() => handleTabChange('upload')}
            />
            <Breadcrumbs items={breadcrumbItems} />

            <div style={{ ...styles.headerRight, justifyContent: 'flex-end', marginBottom: TavariStyles.spacing.xl }}>
              {!canEditSettings && !canUploadMusic && (
                <div style={styles.limitedAccessBadge}>
                  <FiAlertCircle />
                  <span>Limited Access - Some features restricted</span>
                </div>
              )}
              <div 
                style={styles.subscriptionInfo} 
                onClick={() => navigate('/dashboard/settings')}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = TavariStyles.colors.gray100;
                  e.currentTarget.style.borderColor = TavariStyles.colors.primary;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = TavariStyles.colors.gray50;
                  e.currentTarget.style.borderColor = TavariStyles.colors.gray200;
                }}
              >
                <div style={styles.subscriptionStatus}>
                  <span style={styles.subscriptionLabel}>Subscription:</span>
                  <span style={{
                    ...styles.subscriptionValue,
                    color: subscription.status === 'trial' ? TavariStyles.colors.warning : 
                           subscription.status === 'active' ? TavariStyles.colors.success : 
                           TavariStyles.colors.gray600
                  }}>
                    {subscription.status === 'trial' ? 'Trial' : 
                     subscription.status === 'active' ? 'Active' : 
                     subscription.tier || 'Free'}
                  </span>
                </div>
                <div style={styles.subscriptionDetails}>
                  <span style={styles.subscriptionPlan}>
                    {subscription.tier ? subscription.tier.charAt(0).toUpperCase() + subscription.tier.slice(1) : 'Free'} Tier
                  </span>
                  {subscription.isTrial && subscription.trialDaysRemaining !== null && (
                    <>
                      <span style={styles.subscriptionSeparator}>•</span>
                      <span style={styles.subscriptionRenewal}>
                        {subscription.trialDaysRemaining} day{subscription.trialDaysRemaining !== 1 ? 's' : ''} left
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

          <TavariTabSystemComponent
            tabs={availableTabs}
            mode="state"
            activeTab={activeTab}
            onTabChange={handleTabChange}
            ariaLabel="Music module"
            variant="module"
          />

          {/* Tab Content */}
          <div style={
            activeTab === 'upload' ? styles.tabContentUpload : 
            activeTab === 'library' ? styles.tabContentLibrary : 
            styles.tabContent
          }>
            {renderTabContent()}
          </div>

          {/* Security Status Display */}
          {security.securityState.threats.length > 0 && (
            <div style={{
              ...TavariStyles.components.banner.base,
              ...TavariStyles.components.banner.variants.warning,
              position: 'fixed',
              bottom: TavariStyles.spacing.lg,
              right: TavariStyles.spacing.lg,
              maxWidth: '300px',
              zIndex: 1000
            }}>
              Security Alert: {security.securityState.threats.length} threat(s) detected
            </div>
          )}
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
    </ErrorBoundary>
  );
};

export default MusicDashboard;
