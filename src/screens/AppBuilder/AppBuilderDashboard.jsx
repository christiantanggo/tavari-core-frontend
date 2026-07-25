// EmployeeAppBuilderDashboard.jsx (Legacy - use EmployeeAppBuilderDashboard.jsx instead)
// Main dashboard for AppBuilder module
// NOTE: This file is being replaced by EmployeeAppBuilderDashboard.jsx which follows Tavari standards
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Palette, Settings, Package, Smartphone, Upload, BarChart3, 
  Eye, PlayCircle, CheckCircle2, Clock, AlertCircle, XCircle
} from 'lucide-react';
import { 
  FiMail, FiMusic, FiUsers, FiShoppingCart, FiPackage, FiStar, FiCalendar
} from 'react-icons/fi';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useAppBuilder } from '../../hooks/useAppBuilder';
import { useAppBuilderModules } from '../../hooks/useAppBuilderModules';
import { useAppBuilderBuilds } from '../../hooks/useAppBuilderBuilds';
import SecurityWrapper from '../../Security/SecurityWrapper.jsx';
import PermissionGate from '../../components/Auth/PermissionGate';
import { usePermissions } from '../../hooks/usePermissions';
import toast from 'react-hot-toast';
import TavariCheckbox from '../../components/UI/TavariCheckbox';

const AppBuilderDashboard = () => {
  const navigate = useNavigate();

  // Authentication
  const auth = usePOSAuth({
    requiredRoles: ['manager', 'owner'],
    requireBusiness: true,
    componentName: 'AppBuilderDashboard'
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
        console.error('Error calculating build stats:', error);
        setStats(prev => ({
          ...prev,
          recentBuilds: 0,
          pendingBuilds: 0
        }));
      }
    } else {
      setStats(prev => ({
        ...prev,
        recentBuilds: 0,
        pendingBuilds: 0
      }));
    }
  }, [builds]);

  const canManageBranding = hasPermission('appbuilder.branding.manage') || hasElevatedPrivileges();
  const canToggleModules = hasPermission('appbuilder.modules.toggle') || hasElevatedPrivileges();
  const canBuildApp = hasPermission('appbuilder.build.create') || hasElevatedPrivileges();

  const handleToggleModule = async (moduleKey, enabled) => {
    if (!moduleKey) {
      console.error('AppBuilderDashboard: Cannot toggle module - no module key');
      toast.error('Invalid module');
      return;
    }

    try {
      await toggleModule(moduleKey, enabled);
      toast.success(`Module ${enabled ? 'enabled' : 'disabled'} successfully`);
      await refreshBranding();
    } catch (error) {
      console.error('AppBuilderDashboard: Error toggling module:', error);
      toast.error('Failed to toggle module');
    }
  };

  const getModuleIcon = (moduleKey) => {
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
    switch (status) {
      case 'success':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'building':
      case 'queued':
        return <Clock className="w-5 h-5 text-yellow-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <AlertCircle className="w-5 h-5 text-gray-500" />;
    }
  };

  if (auth.authLoading || brandingLoading || modulesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading App Builder...</p>
        </div>
      </div>
    );
  }

  if (auth.authError) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-600">{auth.authError}</p>
        </div>
      </div>
    );
  }

  return (
    <SecurityWrapper>
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">App Builder</h1>
            <p className="text-gray-600">Manage your white-label app configuration</p>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 mb-1">Enabled Modules</p>
                  <p className="text-3xl font-bold text-gray-900">{stats.enabledModules}</p>
                </div>
                <Package className="w-10 h-10 text-blue-500" />
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 mb-1">Recent Builds</p>
                  <p className="text-3xl font-bold text-gray-900">{stats.recentBuilds}</p>
                </div>
                <Smartphone className="w-10 h-10 text-green-500" />
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 mb-1">Pending Builds</p>
                  <p className="text-3xl font-bold text-gray-900">{stats.pendingBuilds}</p>
                </div>
                <Clock className="w-10 h-10 text-yellow-500" />
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <PermissionGate permission="appbuilder.branding.manage">
              <button
                onClick={() => navigate('/appbuilder/branding')}
                className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow text-left"
              >
                <Palette className="w-8 h-8 text-blue-500 mb-2" />
                <h3 className="font-semibold text-gray-900 mb-1">Branding</h3>
                <p className="text-sm text-gray-600">Configure colors, logos, and branding</p>
              </button>
            </PermissionGate>

            <PermissionGate permission="appbuilder.modules.toggle">
              <button
                onClick={() => navigate('/appbuilder/modules')}
                className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow text-left"
              >
                <Settings className="w-8 h-8 text-green-500 mb-2" />
                <h3 className="font-semibold text-gray-900 mb-1">Modules</h3>
                <p className="text-sm text-gray-600">Enable/disable app modules</p>
              </button>
            </PermissionGate>

            <PermissionGate permission="appbuilder.build.create">
              <button
                onClick={() => navigate('/appbuilder/builds')}
                className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow text-left"
              >
                <Upload className="w-8 h-8 text-purple-500 mb-2" />
                <h3 className="font-semibold text-gray-900 mb-1">Builds</h3>
                <p className="text-sm text-gray-600">Create and manage app builds</p>
              </button>
            </PermissionGate>

            <button
              onClick={() => navigate('/appbuilder/analytics')}
              className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow text-left"
            >
              <BarChart3 className="w-8 h-8 text-orange-500 mb-2" />
              <h3 className="font-semibold text-gray-900 mb-1">Analytics</h3>
              <p className="text-sm text-gray-600">View app usage and analytics</p>
            </button>
          </div>

          {/* Branding Preview */}
          {branding ? (
            <div className="bg-white rounded-lg shadow p-6 mb-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Branding Preview</h2>
                <button
                  onClick={() => navigate('/appbuilder/branding')}
                  className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                >
                  Edit Branding
                </button>
              </div>
              <div className="flex items-center gap-4">
                {branding.logo_url && (
                  <img
                    src={branding.logo_url}
                    alt="App Logo"
                    className="w-16 h-16 object-contain"
                  />
                )}
                <div>
                  <h3 className="font-semibold text-gray-900">{branding.app_name || 'My App'}</h3>
                  <div className="flex gap-2 mt-2">
                    {branding.primary_color && (
                      <div
                        className="w-6 h-6 rounded-full border-2 border-gray-300"
                        style={{ backgroundColor: branding.primary_color }}
                      />
                    )}
                    {branding.secondary_color && (
                      <div
                        className="w-6 h-6 rounded-full border-2 border-gray-300"
                        style={{ backgroundColor: branding.secondary_color }}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Enabled Modules Grid */}
          {enabledModules && enabledModules.length > 0 ? (
            <div className="bg-white rounded-lg shadow p-6 mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Enabled Modules</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {enabledModules.map((module) => {
                  if (!module || !module.module_key) return null;
                  const Icon = getModuleIcon(module.module_key);
                  return (
                    <div key={module.module_key} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <Icon className="w-6 h-6 text-blue-500" />
                          <h3 className="font-semibold text-gray-900">{module.module_name || module.catalog_name || 'Unknown Module'}</h3>
                        </div>
                        {canToggleModules && (
                          <TavariCheckbox
                            checked={module.enabled || false}
                            onChange={(checked) => handleToggleModule(module.module_key, checked)}
                          />
                        )}
                      </div>
                      {module.description && (
                        <p className="text-sm text-gray-600 mb-2">{module.description}</p>
                      )}
                      {module.usage_count !== undefined && (
                        <p className="text-xs text-gray-500">Usage: {module.usage_count}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow p-6 mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Enabled Modules</h2>
              <p className="text-gray-600">No modules enabled yet. Enable modules from the Modules section.</p>
            </div>
          )}

          {/* Recent Builds */}
          {builds && builds.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900">Recent Builds</h2>
                <button
                  onClick={() => navigate('/appbuilder/builds')}
                  className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                >
                  View All
                </button>
              </div>
              <div className="space-y-3">
                {builds.slice(0, 5).map((build) => {
                  if (!build || !build.id) return null;
                  return (
                    <div key={build.id} className="flex items-center justify-between border rounded-lg p-4">
                      <div className="flex items-center gap-4">
                        {getBuildStatusIcon(build.build_status)}
                        <div>
                          <h3 className="font-semibold text-gray-900">
                            {build.app_version || 'Unknown'} ({build.platform || 'Unknown'})
                          </h3>
                          <p className="text-sm text-gray-600">
                            Build #{build.build_number || 'N/A'} • {build.created_at ? new Date(build.created_at).toLocaleDateString() : 'Unknown date'}
                          </p>
                        </div>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                        build.build_status === 'success' ? 'bg-green-100 text-green-800' :
                        build.build_status === 'failed' ? 'bg-red-100 text-red-800' :
                        build.build_status === 'building' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
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

export default AppBuilderDashboard;

