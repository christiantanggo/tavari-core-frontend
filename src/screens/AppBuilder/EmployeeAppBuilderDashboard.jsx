// EmployeeAppBuilderDashboard.jsx
// Main dashboard for AppBuilder module - Employee interface
// Tavari Standards: 3x grid layout, white buttons with teal border, 20px padding, bold text
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Palette, Settings, Package, Smartphone, Upload, BarChart3, 
  CheckCircle2, Clock, AlertCircle, XCircle
} from 'lucide-react';
import { 
  FiMail, FiMusic, FiUsers, FiShoppingCart, FiPackage, FiStar, FiCalendar
} from 'react-icons/fi';
import { TavariStyles } from '../../utils/TavariStyles';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useAppBuilder } from '../../hooks/useAppBuilder';
import { useAppBuilderModules } from '../../hooks/useAppBuilderModules';
import { useAppBuilderBuilds } from '../../hooks/useAppBuilderBuilds';
import SecurityWrapper from '../../Security/SecurityWrapper.jsx';
import PermissionGate from '../../components/Auth/PermissionGate';
import { usePermissions } from '../../hooks/usePermissions';
import TavariModuleHeader from '../../components/UI/TavariModuleHeader';
import EmployeeGridButton from '../../components/UI/EmployeeGridButton';
import { getContainerStyles, getEmployeeGridStyles, getCenteredContentStyles } from '../../utils/tavariLayoutUtils';
import toast from 'react-hot-toast';
import TavariCheckbox from '../../components/UI/TavariCheckbox';

// Helper functions - must be defined before component
const getBuildStatusStyle = (status) => {
  try {
    if (!status) return { backgroundColor: TavariStyles?.colors?.gray100 || '#f3f4f6', color: TavariStyles?.colors?.gray800 || '#1f2937' };
    
    switch (status) {
      case 'success':
        return { backgroundColor: TavariStyles?.colors?.successBg || '#d1fae5', color: TavariStyles?.colors?.successText || '#065f46' };
      case 'failed':
        return { backgroundColor: TavariStyles?.colors?.errorBg || '#fee2e2', color: TavariStyles?.colors?.errorText || '#991b1b' };
      case 'building':
        return { backgroundColor: TavariStyles?.colors?.warningBg || '#fef3c7', color: TavariStyles?.colors?.warningText || '#92400e' };
      default:
        return { backgroundColor: TavariStyles?.colors?.gray100 || '#f3f4f6', color: TavariStyles?.colors?.gray800 || '#1f2937' };
    }
  } catch (e) {
    console.error('Error in getBuildStatusStyle:', e);
    return { backgroundColor: '#f3f4f6', color: '#1f2937' };
  }
};

// Define styles function - must be defined before component
// Wrap in try-catch to prevent module-level errors
const getStyles = () => {
  try {
    return {
      container: {
        minHeight: '100vh',
        backgroundColor: TavariStyles?.colors?.gray50 || TavariStyles?.colors?.background || '#f9fafb',
        padding: TavariStyles?.spacing?.xl || '20px',
        paddingTop: '120px'
      },
      loadingContainer: {
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: TavariStyles?.colors?.gray50 || TavariStyles?.colors?.background || '#f9fafb'
      },
      loadingContent: {
        textAlign: 'center'
      },
      spinner: {
        width: '48px',
        height: '48px',
        border: `3px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
        borderTop: `3px solid ${TavariStyles?.colors?.primary || '#008080'}`,
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
        margin: '0 auto'
      },
      loadingText: {
        marginTop: TavariStyles?.spacing?.lg || '16px',
        color: TavariStyles?.colors?.gray600 || '#4b5563',
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px'
      },
      errorContainer: {
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: TavariStyles?.colors?.gray50 || TavariStyles?.colors?.background || '#f9fafb'
      },
      errorContent: {
        textAlign: 'center'
      },
      errorText: {
        color: TavariStyles?.colors?.danger || '#ef4444',
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px'
      },
      header: {
        textAlign: 'center',
        marginBottom: TavariStyles?.spacing?.xl || '20px'
      },
      headerIcon: {
        color: TavariStyles?.colors?.primary || '#008080',
        marginBottom: TavariStyles?.spacing?.md || '12px'
      },
      title: {
        fontSize: TavariStyles?.typography?.fontSize?.['3xl'] || '24px',
        fontWeight: TavariStyles?.typography?.fontWeight?.bold || '700',
        color: TavariStyles?.colors?.gray700 || TavariStyles?.colors?.text || '#374151',
        marginBottom: TavariStyles?.spacing?.sm || '8px',
        margin: 0
      },
      subtitle: {
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
        color: TavariStyles?.colors?.gray600 || '#4b5563',
        margin: 0
      },
      statsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: TavariStyles?.spacing?.xl || '20px',
        marginBottom: TavariStyles?.spacing?.xl || '20px'
      },
      statCard: {
        backgroundColor: TavariStyles?.colors?.white || '#ffffff',
        padding: TavariStyles?.spacing?.lg || '16px',
        borderRadius: TavariStyles?.borderRadius?.md || '6px',
        boxShadow: TavariStyles?.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: TavariStyles?.spacing?.md || '12px'
      },
      statContent: {
        flex: 1
      },
      statValue: {
        fontSize: TavariStyles?.typography?.fontSize?.['2xl'] || '20px',
        fontWeight: TavariStyles?.typography?.fontWeight?.bold || '700',
        color: TavariStyles?.colors?.gray700 || TavariStyles?.colors?.text || '#374151',
        margin: 0
      },
      statLabel: {
        fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
        color: TavariStyles?.colors?.gray600 || '#4b5563',
        margin: 0,
        marginTop: TavariStyles?.spacing?.xs || '4px'
      },
      quickActionsSection: {
        marginBottom: TavariStyles?.spacing?.xl || '20px'
      },
      sectionTitle: {
        fontSize: TavariStyles?.typography?.fontSize?.xl || '18px',
        fontWeight: TavariStyles?.typography?.fontWeight?.bold || '700',
        color: TavariStyles?.colors?.gray700 || TavariStyles?.colors?.text || '#374151',
        marginBottom: TavariStyles?.spacing?.xl || '20px',
        margin: 0
      },
      brandingSection: {
        backgroundColor: TavariStyles?.colors?.white || '#ffffff',
        padding: TavariStyles?.spacing?.xl || '20px',
        borderRadius: TavariStyles?.borderRadius?.md || '6px',
        boxShadow: TavariStyles?.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
        marginBottom: TavariStyles?.spacing?.xl || '20px'
      },
      brandingHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: TavariStyles?.spacing?.lg || '16px'
      },
      editButton: {
        backgroundColor: 'transparent',
        border: 'none',
        color: TavariStyles?.colors?.primary || '#008080',
        fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
        fontWeight: TavariStyles?.typography?.fontWeight?.medium || '500',
        cursor: 'pointer',
        padding: TavariStyles?.spacing?.xs || '4px'
      },
      brandingContent: {
        display: 'flex',
        alignItems: 'center',
        gap: TavariStyles?.spacing?.lg || '16px'
      },
      logo: {
        width: '64px',
        height: '64px',
        objectFit: 'contain'
      },
      brandingName: {
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
        fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
        color: TavariStyles?.colors?.gray700 || TavariStyles?.colors?.text || '#374151',
        margin: 0,
        marginBottom: TavariStyles?.spacing?.sm || '8px'
      },
      colorSwatches: {
        display: 'flex',
        gap: TavariStyles?.spacing?.sm || '8px'
      },
      colorSwatch: {
        width: '24px',
        height: '24px',
        borderRadius: '50%',
        border: `2px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`
      },
      modulesSection: {
        backgroundColor: TavariStyles?.colors?.white || '#ffffff',
        padding: TavariStyles?.spacing?.xl || '20px',
        borderRadius: TavariStyles?.borderRadius?.md || '6px',
        boxShadow: TavariStyles?.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
        marginBottom: TavariStyles?.spacing?.xl || '20px'
      },
      modulesGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: TavariStyles?.spacing?.lg || '16px'
      },
      moduleCard: {
        border: `1px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
        borderRadius: TavariStyles?.borderRadius?.md || '6px',
        padding: TavariStyles?.spacing?.lg || '16px',
        transition: 'all 0.2s ease'
      },
      moduleHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: TavariStyles?.spacing?.sm || '8px'
      },
      moduleInfo: {
        display: 'flex',
        alignItems: 'center',
        gap: TavariStyles?.spacing?.md || '12px',
        flex: 1
      },
      moduleName: {
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
        fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
        color: TavariStyles?.colors?.gray700 || TavariStyles?.colors?.text || '#374151',
        margin: 0
      },
      moduleDescription: {
        fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
        color: TavariStyles?.colors?.gray600 || '#4b5563',
        margin: 0,
        marginBottom: TavariStyles?.spacing?.xs || '4px'
      },
      moduleUsage: {
        fontSize: TavariStyles?.typography?.fontSize?.xs || '12px',
        color: TavariStyles?.colors?.gray500 || '#6b7280',
        margin: 0
      },
      buildsSection: {
        backgroundColor: TavariStyles?.colors?.white || '#ffffff',
        padding: TavariStyles?.spacing?.xl || '20px',
        borderRadius: TavariStyles?.borderRadius?.md || '6px',
        boxShadow: TavariStyles?.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)'
      },
      buildsHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: TavariStyles?.spacing?.lg || '16px'
      },
      viewAllButton: {
        backgroundColor: 'transparent',
        border: 'none',
        color: TavariStyles?.colors?.primary || '#008080',
        fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
        fontWeight: TavariStyles?.typography?.fontWeight?.medium || '500',
        cursor: 'pointer',
        padding: TavariStyles?.spacing?.xs || '4px'
      },
      buildsList: {
        display: 'flex',
        flexDirection: 'column',
        gap: TavariStyles?.spacing?.md || '12px'
      },
      buildCard: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: TavariStyles?.spacing?.lg || '16px',
        border: `1px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
        borderRadius: TavariStyles?.borderRadius?.md || '6px'
      },
      buildInfo: {
        display: 'flex',
        alignItems: 'center',
        gap: TavariStyles?.spacing?.lg || '16px',
        flex: 1
      },
      buildTitle: {
        fontSize: TavariStyles?.typography?.fontSize?.base || '14px',
        fontWeight: TavariStyles?.typography?.fontWeight?.semibold || '600',
        color: TavariStyles?.colors?.gray700 || TavariStyles?.colors?.text || '#374151',
        margin: 0,
        marginBottom: TavariStyles?.spacing?.xs || '4px'
      },
      buildDetails: {
        fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
        color: TavariStyles?.colors?.gray600 || '#4b5563',
        margin: 0
      },
      buildStatus: {
        padding: `${TavariStyles?.spacing?.xs || '4px'} ${TavariStyles?.spacing?.md || '12px'}`,
        borderRadius: TavariStyles?.borderRadius?.full || '9999px',
        fontSize: TavariStyles?.typography?.fontSize?.sm || '13px',
        fontWeight: TavariStyles?.typography?.fontWeight?.medium || '500'
      }
    };
  } catch (e) {
    console.error('Error in getStyles:', e);
    // Return minimal safe styles if there's an error
    return {
      container: { minHeight: '100vh', padding: '20px', backgroundColor: '#f9fafb' },
      loadingContainer: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' },
      loadingContent: { textAlign: 'center' },
      spinner: { width: '48px', height: '48px', border: '3px solid #d1d5db', borderTop: '3px solid #008080', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' },
      loadingText: { marginTop: '16px', color: '#4b5563', fontSize: '14px' },
      errorContainer: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' },
      errorContent: { textAlign: 'center' },
      errorText: { color: '#ef4444', fontSize: '14px' },
      header: { textAlign: 'center', marginBottom: '20px' },
      headerIcon: { color: '#008080', marginBottom: '12px' },
      title: { fontSize: '24px', fontWeight: '700', color: '#374151', marginBottom: '8px', margin: 0 },
      subtitle: { fontSize: '14px', color: '#4b5563', margin: 0 },
      statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '20px' },
      statCard: { backgroundColor: '#ffffff', padding: '16px', borderRadius: '6px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', gap: '12px' },
      statContent: { flex: 1 },
      statValue: { fontSize: '20px', fontWeight: '700', color: '#374151', margin: 0 },
      statLabel: { fontSize: '13px', color: '#4b5563', margin: 0, marginTop: '4px' },
      quickActionsSection: { marginBottom: '20px' },
      sectionTitle: { fontSize: '18px', fontWeight: '700', color: '#374151', marginBottom: '20px', margin: 0 },
      brandingSection: { backgroundColor: '#ffffff', padding: '20px', borderRadius: '6px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '20px' },
      brandingHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' },
      editButton: { backgroundColor: 'transparent', border: 'none', color: '#008080', fontSize: '13px', fontWeight: '500', cursor: 'pointer', padding: '4px' },
      brandingContent: { display: 'flex', alignItems: 'center', gap: '16px' },
      logo: { width: '64px', height: '64px', objectFit: 'contain' },
      brandingName: { fontSize: '14px', fontWeight: '600', color: '#374151', margin: 0, marginBottom: '8px' },
      colorSwatches: { display: 'flex', gap: '8px' },
      colorSwatch: { width: '24px', height: '24px', borderRadius: '50%', border: '2px solid #d1d5db' },
      modulesSection: { backgroundColor: '#ffffff', padding: '20px', borderRadius: '6px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '20px' },
      modulesGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' },
      moduleCard: { border: '1px solid #d1d5db', borderRadius: '6px', padding: '16px', transition: 'all 0.2s ease' },
      moduleHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' },
      moduleInfo: { display: 'flex', alignItems: 'center', gap: '12px', flex: 1 },
      moduleName: { fontSize: '14px', fontWeight: '600', color: '#374151', margin: 0 },
      moduleDescription: { fontSize: '13px', color: '#4b5563', margin: 0, marginBottom: '4px' },
      moduleUsage: { fontSize: '13px', color: '#6b7280', margin: 0 },
      buildsSection: { backgroundColor: '#ffffff', padding: '20px', borderRadius: '6px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
      buildsHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' },
      viewAllButton: { backgroundColor: 'transparent', border: 'none', color: '#008080', fontSize: '13px', fontWeight: '500', cursor: 'pointer', padding: '4px' },
      buildsList: { display: 'flex', flexDirection: 'column', gap: '12px' },
      buildCard: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', border: '1px solid #d1d5db', borderRadius: '6px' },
      buildInfo: { display: 'flex', alignItems: 'center', gap: '16px', flex: 1 },
      buildTitle: { fontSize: '14px', fontWeight: '600', color: '#374151', margin: 0, marginBottom: '4px' },
      buildDetails: { fontSize: '13px', color: '#4b5563', margin: 0 },
      buildStatus: { padding: '4px 12px', borderRadius: '9999px', fontSize: '13px', fontWeight: '500' }
    };
  }
};

const EmployeeAppBuilderDashboard = () => {
  const navigate = useNavigate();

  // Initialize styles inside component with memoization
  const styles = useMemo(() => getStyles(), []);

  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'EmployeeAppBuilderDashboard'
  });

  const { hasPermission, hasElevatedPrivileges } = usePermissions();

  // App Builder hooks
  const { branding, modules, loading: brandingLoading, refresh: refreshBranding } = useAppBuilder();
  const { availableModules, enabledModules, loading: modulesLoading, toggleModule } = useAppBuilderModules();
  const { builds, currentBuild, loading: buildsLoading } = useAppBuilderBuilds();

  // Local state
  const [stats, setStats] = useState({
    enabledModules: 0,
    recentBuilds: 0,
    pendingBuilds: 0
  });

  useEffect(() => {
    if (enabledModules && Array.isArray(enabledModules)) {
      setStats(prev => ({
        ...prev,
        enabledModules: enabledModules.length
      }));
    } else {
      setStats(prev => ({ ...prev, enabledModules: 0 }));
    }
  }, [enabledModules]);

  useEffect(() => {
    if (builds && Array.isArray(builds)) {
      try {
        const recent = builds.filter(b => {
          if (!b || !b.created_at) return false;
          const buildDate = new Date(b.created_at);
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          return buildDate > weekAgo;
        });

        const pending = builds.filter(b => 
          b && (b.build_status === 'queued' || b.build_status === 'building')
        );

        setStats(prev => ({
          ...prev,
          recentBuilds: recent.length,
          pendingBuilds: pending.length
        }));
      } catch (error) {
        console.error('EmployeeAppBuilderDashboard: Error calculating stats:', error);
      }
    }
  }, [builds]);

  const canManageBranding = hasPermission('appbuilder.branding.manage') || hasElevatedPrivileges();
  const canToggleModules = hasPermission('appbuilder.modules.toggle') || hasElevatedPrivileges();
  const canBuildApp = hasPermission('appbuilder.build.create') || hasElevatedPrivileges();

  const handleToggleModule = async (moduleKey, enabled) => {
    if (!moduleKey) {
      console.error('EmployeeAppBuilderDashboard: Cannot toggle module - no module key');
      toast.error('Invalid module');
      return;
    }

    try {
      await toggleModule(moduleKey, enabled);
      toast.success(`Module ${enabled ? 'enabled' : 'disabled'} successfully`);
      await refreshBranding();
    } catch (error) {
      console.error('EmployeeAppBuilderDashboard: Error toggling module:', error);
      toast.error('Failed to toggle module');
    }
  };

  const handleNavigation = (path) => {
    try {
      navigate(path);
    } catch (error) {
      console.error('EmployeeAppBuilderDashboard: Navigation error:', error);
      toast.error('Navigation failed. Please try again.');
    }
  };

  const getModuleIcon = (moduleKey) => {
    if (!moduleKey) return Package;
    const icons = {
      mail: FiMail,
      music: FiMusic,
      hr: FiUsers,
      pos: FiShoppingCart,
      recipe_builder: FiPackage,
      loyalty: FiStar,
      scheduling: FiCalendar
    };
    return icons[moduleKey] || Package;
  };

  const getBuildStatusIcon = (status) => {
    if (!status) return <AlertCircle size={20} style={{ color: TavariStyles?.colors?.gray500 || '#6b7280' }} />;
    
    switch (status) {
      case 'success':
        return <CheckCircle2 size={20} style={{ color: TavariStyles?.colors?.success || '#10b981' }} />;
      case 'building':
      case 'queued':
        return <Clock size={20} style={{ color: TavariStyles?.colors?.warning || '#f59e0b' }} />;
      case 'failed':
        return <XCircle size={20} style={{ color: TavariStyles?.colors?.danger || '#ef4444' }} />;
      default:
        return <AlertCircle size={20} style={{ color: TavariStyles?.colors?.gray500 || '#6b7280' }} />;
    }
  };

  if (auth.authLoading || brandingLoading || modulesLoading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingContent}>
          <div style={styles.spinner}></div>
          <p style={styles.loadingText}>Loading App Builder...</p>
        </div>
      </div>
    );
  }

  if (auth.authError) {
    return (
      <div style={styles.errorContainer}>
        <div style={styles.errorContent}>
          <AlertCircle size={48} style={{ color: TavariStyles?.colors?.danger || '#ef4444', marginBottom: TavariStyles?.spacing?.md || '12px' }} />
          <p style={styles.errorText}>{auth.authError}</p>
        </div>
      </div>
    );
  }

  return (
    <SecurityWrapper>
      <div style={styles.container}>
        <div style={getCenteredContentStyles()}>
          <TavariModuleHeader
            title="Tavari App Builder"
            description="Manage your white-label app configuration, branding, modules, builds, and deployments."
            actionLabel="Module Settings"
            actionIcon={<Settings size={18} />}
            onAction={() => navigate('/dashboard/appbuilder/settings')}
          />

          {/* Stats Cards */}
          <div style={styles.statsGrid}>
            <div style={styles.statCard}>
              <Package size={32} style={{ color: TavariStyles?.colors?.primary || '#008080' }} />
              <div style={styles.statContent}>
                <h3 style={styles.statValue}>{stats.enabledModules || 0}</h3>
                <p style={styles.statLabel}>Enabled Modules</p>
              </div>
            </div>
            <div style={styles.statCard}>
              <Smartphone size={32} style={{ color: TavariStyles?.colors?.success || '#10b981' }} />
              <div style={styles.statContent}>
                <h3 style={styles.statValue}>{stats.recentBuilds || 0}</h3>
                <p style={styles.statLabel}>Recent Builds</p>
              </div>
            </div>
            <div style={styles.statCard}>
              <Clock size={32} style={{ color: TavariStyles?.colors?.warning || '#f59e0b' }} />
              <div style={styles.statContent}>
                <h3 style={styles.statValue}>{stats.pendingBuilds || 0}</h3>
                <p style={styles.statLabel}>Pending Builds</p>
              </div>
            </div>
          </div>

          {/* Quick Actions - 3x Grid Layout (Tavari Standard) */}
          <div style={styles.quickActionsSection}>
            <h2 style={styles.sectionTitle}>Quick Actions</h2>
            <div style={getEmployeeGridStyles()}>
              <PermissionGate permission="appbuilder.branding.manage" fallback={
                <EmployeeGridButton
                  icon={Palette}
                  label="Branding"
                  description="Configure colors, logos, and branding"
                  disabled={true}
                />
              }>
                <EmployeeGridButton
                  icon={Palette}
                  label="Branding"
                  description="Configure colors, logos, and branding"
                  onClick={() => handleNavigation('/appbuilder/branding')}
                />
              </PermissionGate>

              <PermissionGate permission="appbuilder.modules.toggle" fallback={
                <EmployeeGridButton
                  icon={Settings}
                  label="Modules"
                  description="Enable/disable app modules"
                  disabled={true}
                />
              }>
                <EmployeeGridButton
                  icon={Settings}
                  label="Modules"
                  description="Enable/disable app modules"
                  onClick={() => handleNavigation('/appbuilder/modules')}
                />
              </PermissionGate>

              <PermissionGate permission="appbuilder.build.create" fallback={
                <EmployeeGridButton
                  icon={Upload}
                  label="Builds"
                  description="Create and manage app builds"
                  disabled={true}
                />
              }>
                <EmployeeGridButton
                  icon={Upload}
                  label="Builds"
                  description="Create and manage app builds"
                  onClick={() => handleNavigation('/appbuilder/builds')}
                />
              </PermissionGate>

              <EmployeeGridButton
                icon={BarChart3}
                label="Analytics"
                description="View app usage and analytics"
                onClick={() => handleNavigation('/appbuilder/analytics')}
              />

              <PermissionGate requireElevated fallback={
                <EmployeeGridButton
                  icon={Settings}
                  label="Module Settings"
                  description="Deactivate or manage module activation"
                  disabled={true}
                />
              }>
                <EmployeeGridButton
                  icon={Settings}
                  label="Module Settings"
                  description="Deactivate or manage module activation"
                  onClick={() => handleNavigation('/appbuilder/settings')}
                />
              </PermissionGate>
            </div>
          </div>

          {/* Branding Preview */}
          {branding ? (
            <div style={styles.brandingSection}>
              <div style={styles.brandingHeader}>
                <h2 style={styles.sectionTitle}>Branding Preview</h2>
                <button
                  onClick={() => handleNavigation('/appbuilder/branding')}
                  style={styles.editButton}
                >
                  Edit Branding
                </button>
              </div>
              <div style={styles.brandingContent}>
                {branding.logo_url && (
                  <img
                    src={branding.logo_url}
                    alt="App Logo"
                    style={styles.logo}
                  />
                )}
                <div>
                  <h3 style={styles.brandingName}>{branding.app_name || 'My App'}</h3>
                  <div style={styles.colorSwatches}>
                    {branding.primary_color && (
                      <div
                        style={{
                          ...styles.colorSwatch,
                          backgroundColor: branding.primary_color
                        }}
                      />
                    )}
                    {branding.secondary_color && (
                      <div
                        style={{
                          ...styles.colorSwatch,
                          backgroundColor: branding.secondary_color
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={styles.brandingSection}>
              <div style={styles.brandingHeader}>
                <h2 style={styles.sectionTitle}>Branding Preview</h2>
                <button
                  onClick={() => handleNavigation('/appbuilder/branding')}
                  style={styles.editButton}
                >
                  Configure Branding
                </button>
              </div>
              <p style={styles.subtitle}>No branding configured yet. Click above to set it up.</p>
            </div>
          )}

          {/* Enabled Modules Grid */}
          {enabledModules && enabledModules.length > 0 && (
            <div style={styles.modulesSection}>
              <h2 style={styles.sectionTitle}>Enabled Modules</h2>
              <div style={styles.modulesGrid}>
                {enabledModules.map((module) => {
                  if (!module || !module.module_key) return null;
                  const Icon = getModuleIcon(module.module_key);
                  return (
                    <div key={module.module_key} style={styles.moduleCard}>
                      <div style={styles.moduleHeader}>
                        <div style={styles.moduleInfo}>
                          <Icon size={24} style={{ color: TavariStyles?.colors?.primary || '#008080' }} />
                          <h3 style={styles.moduleName}>
                            {module.module_name || module.catalog_name || 'Unknown Module'}
                          </h3>
                        </div>
                        {canToggleModules && (
                          <TavariCheckbox
                            checked={module.enabled || false}
                            onChange={(checked) => handleToggleModule(module.module_key, checked)}
                          />
                        )}
                      </div>
                      {module.description && (
                        <p style={styles.moduleDescription}>{module.description}</p>
                      )}
                      {module.usage_count !== undefined && (
                        <p style={styles.moduleUsage}>Usage: {module.usage_count}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recent Builds */}
          {builds && builds.length > 0 && (
            <div style={styles.buildsSection}>
              <div style={styles.buildsHeader}>
                <h2 style={styles.sectionTitle}>Recent Builds</h2>
                <button
                  onClick={() => handleNavigation('/appbuilder/builds')}
                  style={styles.viewAllButton}
                >
                  View All
                </button>
              </div>
              <div style={styles.buildsList}>
                {builds.slice(0, 5).map((build) => {
                  if (!build || !build.id) return null;
                  return (
                    <div key={build.id} style={styles.buildCard}>
                      <div style={styles.buildInfo}>
                        {getBuildStatusIcon(build.build_status)}
                        <div>
                          <h3 style={styles.buildTitle}>
                            {build.app_version || 'Unknown'} ({build.platform || 'Unknown'})
                          </h3>
                          <p style={styles.buildDetails}>
                            Build #{build.build_number || 'N/A'} • {build.created_at ? new Date(build.created_at).toLocaleDateString() : 'Unknown date'}
                          </p>
                        </div>
                      </div>
                      <span style={{
                        ...styles.buildStatus,
                        ...getBuildStatusStyle(build.build_status)
                      }}>
                        {build.build_status || 'unknown'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </SecurityWrapper>
  );
};

// Add CSS animation for spinner
if (typeof document !== 'undefined') {
  const existingStyle = document.querySelector('#app-builder-spinner-animation');
  if (!existingStyle) {
    const style = document.createElement('style');
    style.id = 'app-builder-spinner-animation';
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
}

export default EmployeeAppBuilderDashboard;

