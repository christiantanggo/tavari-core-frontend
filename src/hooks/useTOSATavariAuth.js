// hooks/useTOSATavariAuth.js - TOSA Authentication Hook
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

/**
 * TOSA (Tavari OS Admin) Authentication Hook
 * Handles authentication and authorization for Tavari employees
 * 
 * @param {Object} options - Configuration options
 * @param {string[]} options.requiredPermissions - Required permissions (default: any permission)
 * @param {string} options.componentName - Component name for logging (default: 'TOSAComponent')
 * @returns {Object} Authentication state and methods
 */
export const useTOSATavariAuth = (options = {}) => {
  const {
    requiredPermissions = null,
    componentName = 'TOSAComponent'
  } = options;

  const navigate = useNavigate();

  // Authentication state
  const [authUser, setAuthUser] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    initializeTOSAAuth();
  }, []);

  const initializeTOSAAuth = async () => {
    try {
      console.log(`${componentName}: Initializing TOSA authentication...`);
      
      // TOSA is now open - no authentication required
      // Set default permissions for open access
      setAuthUser({ id: 'tosa-open-access', email: 'admin@tavari.com' });
      setEmployee({ 
        id: 'tosa-open', 
        full_name: 'TOSA Admin',
        email: 'admin@tavari.com'
      });
      
      // Set all permissions to true for open access
      const allPermissions = [
        'dashboard_access',
        'business_management',
        'security_monitoring',
        'customer_support',
        'system_monitoring',
        'user_management',
        'module_management',
        'super_admin'
      ];
      setPermissions(allPermissions);
      
      // Set authenticated state - TOSA is now open access
      // Note: isAuthenticated is computed from authUser and employee, not a state variable
      setAuthLoading(false);

    } catch (error) {
      console.error(`${componentName}: Authentication error:`, error);
      setAuthError(error.message || 'Authentication failed');
    } finally {
      setAuthLoading(false);
    }
  };

  /**
   * Check if user has required permissions
   */
  const hasPermissions = (userPermissions, requiredPerms) => {
    if (!requiredPerms || requiredPerms.length === 0) return true;
    return requiredPerms.every(perm => userPermissions.includes(perm));
  };

  /**
   * Check if user has a specific permission
   */
  const hasPermission = (permission) => {
    return permissions.includes(permission);
  };

  /**
   * Check if user is a super admin
   */
  const isSuperAdmin = () => {
    return employee?.tavari_employee_roles?.role_name === 'super_admin' || 
           hasPermission('super_admin');
  };

  /**
   * Check if user is a support agent
   */
  const isSupportAgent = () => {
    return employee?.tavari_employee_roles?.role_name === 'support' || 
           hasPermission('customer_support');
  };

  /**
   * Check if user is a security analyst
   */
  const isSecurityAnalyst = () => {
    return employee?.tavari_employee_roles?.role_name === 'security' || 
           hasPermission('security_monitoring');
  };

  /**
   * Check if user can manage businesses
   */
  const canManageBusinesses = () => {
    return hasPermission('business_management') || isSuperAdmin();
  };

  /**
   * Check if user can view system health
   */
  const canViewSystemHealth = () => {
    return hasPermission('system_monitoring') || isSuperAdmin();
  };

  /**
   * Refresh authentication data
   */
  const refreshAuth = async () => {
    setAuthLoading(true);
    await initializeTOSAAuth();
  };

  /**
   * Clear authentication error
   */
  const clearAuthError = () => {
    setAuthError(null);
  };

  /**
   * Navigate to employee portal
   */
  const goToEmployeePortal = () => {
    navigate('/employeeportal');
  };

  /**
   * Navigate to TOSA dashboard
   */
  const goToDashboard = () => {
    navigate('/tosa/dashboard');
  };

  /**
   * Log user action for audit trail
   */
  const logUserAction = async (action, details = {}) => {
    if (!employee) return;

    try {
      await supabase.from('security_audit_logs').insert({
        event_type: 'tosa_user_action',
        user_id: authUser?.id,
        severity: 'low',
        details: {
          action,
          employee_id: employee.id,
          employee_name: employee.full_name,
          component: componentName,
          timestamp: new Date().toISOString(),
          ...details
        }
      });
    } catch (error) {
      console.error('Failed to log user action:', error);
    }
  };

  return {
    // Authentication state
    authUser,
    employee,
    permissions,
    authLoading,
    authError,
    
    // Computed state
    isAuthenticated: !!authUser && !!employee,
    needsAuth: !authUser && !authLoading && !authError,
    isReady: !authLoading && !!authUser && !!employee,
    
    // Permission checking methods
    hasPermission,
    hasPermissions: (perms) => hasPermissions(permissions, perms),
    isSuperAdmin,
    isSupportAgent,
    isSecurityAnalyst,
    canManageBusinesses,
    canViewSystemHealth,
    
    // Utility methods
    refreshAuth,
    clearAuthError,
    goToEmployeePortal,
    goToDashboard,
    logUserAction,
    
    // Raw authentication data for custom logic
    rawAuthData: {
      authUser,
      employee,
      permissions
    }
  };
};

export default useTOSATavariAuth;