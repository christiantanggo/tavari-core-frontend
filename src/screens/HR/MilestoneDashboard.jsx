// src/screens/HR/MilestoneDashboard.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { useNavigate } from 'react-router-dom';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import toast from 'react-hot-toast';

const MilestoneDashboard = () => {
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  // Security context
  const {
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'MilestoneDashboard',
    sensitiveComponent: false,
    enableRateLimiting: false,
    enableAuditLogging: true,
    securityLevel: 'low'
  });

  // Authentication
  const {
    selectedBusinessId,
    authUser,
    userRole,
    businessData,
    authLoading,
    authError,
    isManager,
    isOwner
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin', 'hr_admin'],
    requireBusiness: true,
    componentName: 'MilestoneDashboard'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Permission checks
  const canViewMilestones = hasAnyPermission([
    'hr.onboarding.view',
    'hr.milestones.view'
  ]) || hasElevatedPrivileges();

  const canViewEmployees = hasPermission('hr.employees.view') || hasElevatedPrivileges();
  const canViewOnboarding = hasPermission('hr.onboarding.view') || hasElevatedPrivileges();

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewMilestones) {
      toast.error('You do not have permission to view milestone dashboard');
      navigate('/dashboard/hr/dashboard');
    }
  }, [permissionsLoading, canViewMilestones]);

  useEffect(() => {
    if (selectedBusinessId && !authLoading && !permissionsLoading && canViewMilestones) {
      loadDashboardData();
    }
  }, [selectedBusinessId, authLoading, permissionsLoading, canViewMilestones]);

  const loadDashboardData = async () => {
    if (!canViewMilestones) {
      toast.error('You do not have permission to view milestone data');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      await logSecurityEvent('milestone_dashboard_access', {
        action: 'load_milestone_dashboard',
        business_id: selectedBusinessId
      }, 'low');

      const { data, error } = await supabase
        .rpc('get_milestone_dashboard_summary', {
          p_business_id: selectedBusinessId
        });

      if (error) throw error;
      setDashboardData(data[0] || null);

      recordAction('view_milestone_dashboard', selectedBusinessId);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      setError(error.message);
      toast.error('Failed to load milestone dashboard');

      await logSecurityEvent('milestone_dashboard_load_failed', {
        error_message: error.message,
        business_id: selectedBusinessId
      }, 'medium');
    } finally {
      setLoading(false);
    }
  };

  const getMilestoneDisplayName = (type) => {
    const names = {
      'orientation': 'Orientation Complete',
      'first-week': 'First Week Champion',
      'essentials': 'Essentials Master',
      'quarter': 'Quarter Progress',
      'half': 'Halfway Hero',
      'three-quarter': 'Almost There',
      'complete': 'Onboarding Graduate'
    };
    return names[type] || type.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const handleNavigate = (path) => {
    recordAction('navigate_from_milestone_dashboard', path);
    navigate(path);
  };

  // Loading states
  if (permissionsLoading || authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  if (!canViewMilestones) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <div className="text-red-800">
          <h3 className="font-semibold mb-2">Access Denied</h3>
          <p>You do not have permission to view the milestone dashboard</p>
          <button
            onClick={() => navigate('/dashboard/hr/dashboard')}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            Return to HR Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <div className="text-red-800">
          <h3 className="font-semibold mb-2">Authentication Error</h3>
          <p>{authError}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <div className="text-red-800">
          <h3 className="font-semibold mb-2">Error Loading Dashboard</h3>
          <p>{error}</p>
          <button
            onClick={loadDashboardData}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!dashboardData) {
    return (
      <div className="text-center text-gray-500 py-12">
        No milestone data available
      </div>
    );
  }

  return (
    <POSAuthWrapper
      requiredRoles={['owner', 'manager', 'admin', 'hr_admin']}
      requireBusiness={true}
      componentName="MilestoneDashboard"
    >
      <SecurityWrapper>
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                    <span className="text-blue-600 font-semibold">👥</span>
                  </div>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Total Employees</p>
                  <p className="text-2xl font-bold text-gray-900">{dashboardData.total_employees}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                    <span className="text-green-600 font-semibold">🏆</span>
                  </div>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">With Achievements</p>
                  <p className="text-2xl font-bold text-gray-900">{dashboardData.employees_with_milestones}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center">
                    <span className="text-yellow-600 font-semibold">⭐</span>
                  </div>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Recent (7 days)</p>
                  <p className="text-2xl font-bold text-gray-900">{dashboardData.recent_achievements}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Completion Rates */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Achievement Breakdown</h3>
              
              {Object.keys(dashboardData.completion_rates || {}).length > 0 ? (
                <div className="space-y-3">
                  {Object.entries(dashboardData.completion_rates).map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">{getMilestoneDisplayName(type)}</span>
                      <div className="flex items-center">
                        <span className="text-sm font-semibold text-gray-900 mr-2">{count}</span>
                        <div className="w-16 bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-teal-600 h-2 rounded-full"
                            style={{
                              width: `${Math.min(100, (count / dashboardData.total_employees) * 100)}%`
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-sm">No achievements yet</p>
              )}
            </div>

            {/* Top Achievers */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Achievers</h3>
              
              {dashboardData.top_achievers && dashboardData.top_achievers.length > 0 ? (
                <div className="space-y-3">
                  {dashboardData.top_achievers.map((achiever, index) => (
                    <div key={achiever.employee_id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center">
                        <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center mr-3">
                          <span className="text-teal-600 font-bold text-sm">#{index + 1}</span>
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{achiever.employee_name}</p>
                          <p className="text-xs text-gray-500">
                            Latest: {new Date(achiever.latest_achievement).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-teal-600">{achiever.milestone_count}</p>
                        <p className="text-xs text-gray-500">achievements</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-sm">No achievements yet</p>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button 
                onClick={loadDashboardData}
                className="flex items-center justify-center px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
              >
                <span className="mr-2">🔄</span>
                Refresh Data
              </button>
              
              <PermissionGate permissions={['hr.onboarding.view']} fallback={
                <button 
                  disabled
                  className="flex items-center justify-center px-4 py-2 bg-gray-300 text-gray-500 rounded-lg cursor-not-allowed"
                >
                  <span className="mr-2">📋</span>
                  View Onboarding
                </button>
              }>
                <button 
                  onClick={() => handleNavigate('/dashboard/hr/onboarding')}
                  className="flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <span className="mr-2">📋</span>
                  View Onboarding
                </button>
              </PermissionGate>
              
              <PermissionGate permissions={['hr.employees.view']} fallback={
                <button 
                  disabled
                  className="flex items-center justify-center px-4 py-2 bg-gray-300 text-gray-500 rounded-lg cursor-not-allowed"
                >
                  <span className="mr-2">👤</span>
                  Employee Profiles
                </button>
              }>
                <button 
                  onClick={() => handleNavigate('/dashboard/hr/employees')}
                  className="flex items-center justify-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  <span className="mr-2">👤</span>
                  Employee Profiles
                </button>
              </PermissionGate>
            </div>
          </div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default MilestoneDashboard;