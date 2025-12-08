// hooks/usePOSAuth.js - Standardized Authentication Hook for POS Components
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

/**
 * Standardized authentication hook for POS components
 * Handles user authentication, business context, and role verification
 * 
 * @param {Object} options - Configuration options
 * @param {string[]} options.requiredRoles - Required user roles (default: any role)
 * @param {boolean} options.requireBusiness - Whether business selection is required (default: true)
 * @param {string} options.componentName - Component name for logging (default: 'Component')
 * @returns {Object} Authentication state and methods
 */
export const usePOSAuth = (options = {}) => {
  const {
    requiredRoles = null, // null means any role is allowed
    requireBusiness = true,
    componentName = 'Component'
  } = options;

  const navigate = useNavigate();

  // Authentication state
  const [authUser, setAuthUser] = useState(null);
  const [selectedBusinessId, setSelectedBusinessId] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [loginUserRole, setLoginUserRole] = useState(null);
  const [businessData, setBusinessData] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [activePOSUser, setActivePOSUser] = useState(null);

  const getActivePosUser = useCallback((businessId = null) => {
    try {
      const raw = localStorage.getItem('posActiveUser');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (businessId && parsed?.business_id !== businessId) {
        return null;
      }
      return parsed;
    } catch (err) {
      return null;
    }
  }, []);

  useEffect(() => {
    initializeAuth();
  }, []);

  const initializeAuth = async () => {
    try {
      // Check current session
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !session?.user) {
        navigate('/login');
        return;
      }

      setAuthUser(session.user);

      // Get business context if required
      if (requireBusiness) {
        const currentBusinessId = localStorage.getItem('currentBusinessId');

        if (!currentBusinessId) {
          setAuthError('No business selected. Please select a business from the dashboard.');
          setAuthLoading(false);
          return;
        }

        setSelectedBusinessId(currentBusinessId);

        // Verify user has access to this business and get role
        // Try user_roles first, fallback to business_users if it fails
        let primaryRole = null;
        
        try {
          const { data: userRoles, error: roleError } = await supabase
            .from('user_roles')
            .select('role, active')
            .eq('user_id', session.user.id)
            .eq('business_id', currentBusinessId)
            .eq('active', true)
            .maybeSingle();

          // Check for 406 Not Acceptable or other errors
          if (roleError) {
            // 406 means the query format isn't accepted - likely RLS or table structure issue
            if (roleError.code === 'PGRST116' || roleError.message?.includes('406')) {
              // Silently fall back to business_users
              console.warn('user_roles query not accepted, using business_users fallback');
            } else {
              // Other errors - log but continue
              console.warn('user_roles query error:', roleError.message);
            }
          } else if (userRoles) {
            primaryRole = userRoles.role;
          }
        } catch (err) {
          // user_roles table may not exist or have issues - silently continue
          console.warn('user_roles table not available, using business_users fallback');
        }

        // Fallback to business_users table if user_roles didn't work
        if (!primaryRole) {
          const { data: businessAccess, error: accessError } = await supabase
            .from('business_users')
            .select('role')
            .eq('user_id', session.user.id)
            .eq('business_id', currentBusinessId)
            .maybeSingle();

          if (businessAccess?.role) {
            primaryRole = businessAccess.role;
          }
        }

        // If still no role, default to employee
        if (!primaryRole) {
          primaryRole = 'employee';
        }

        setLoginUserRole(primaryRole);

        const activeUserOverride = getActivePosUser(currentBusinessId);
        if (activeUserOverride) {
          setActivePOSUser(activeUserOverride);
          setUserRole(activeUserOverride.role || primaryRole);
        } else {
          setActivePOSUser(null);
          setUserRole(primaryRole);
        }

        // Check if user has required role
        if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(primaryRole)) {
          setAuthError(`Insufficient permissions. This feature requires: ${requiredRoles.join(' or ')}`);
          setAuthLoading(false);
          return;
        }

        // Load business data
        try {
          const { data: business, error: businessError } = await supabase
            .from('businesses')
            .select('*')
            .eq('id', currentBusinessId)
            .single();

          if (businessError) {
            // Silent error handling
          } else {
            setBusinessData(business);
          }
        } catch (businessErr) {
          // Silent error handling
        }
      }

      setAuthLoading(false);

    } catch (err) {
      setAuthError(err.message || 'An unexpected authentication error occurred');
      setAuthLoading(false);
    }
  };

  useEffect(() => {
    if (!requireBusiness) return;

    const handleActiveUserChange = () => {
      if (!selectedBusinessId) return;
      const activeUser = getActivePosUser(selectedBusinessId);
      if (activeUser) {
        setActivePOSUser(activeUser);
        setUserRole(activeUser.role || loginUserRole || userRole);
      } else {
        setActivePOSUser(null);
        setUserRole(loginUserRole || userRole);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('pos-active-user-changed', handleActiveUserChange);
      const storageHandler = (event) => {
        if (event.key === 'posActiveUser') {
          handleActiveUserChange();
        }
      };
      window.addEventListener('storage', storageHandler);
      return () => {
        window.removeEventListener('pos-active-user-changed', handleActiveUserChange);
        window.removeEventListener('storage', storageHandler);
      };
    }

    return undefined;
  }, [selectedBusinessId, getActivePosUser, loginUserRole, requireBusiness, userRole]);

  /**
   * Check if user has specific role
   * @param {string|string[]} roles - Role or array of roles to check
   * @returns {boolean} Whether user has the role(s)
   */
  const hasRole = (roles) => {
    if (!userRole) return false;
    if (typeof roles === 'string') return userRole === roles;
    if (Array.isArray(roles)) return roles.includes(userRole);
    return false;
  };

  /**
   * Check if user has manager-level permissions
   * @returns {boolean} Whether user is manager or owner
   */
  const isManager = () => {
    return hasRole(['manager', 'owner']);
  };

  /**
   * Check if user is owner
   * @returns {boolean} Whether user is owner
   */
  const isOwner = () => {
    return hasRole('owner');
  };

  /**
   * Validate manager PIN for sensitive operations
   * @param {string} pin - PIN to validate
   * @returns {Promise<boolean>} Whether PIN is valid
   */
  const validateManagerPin = async (pin) => {
    if (!authUser || !selectedBusinessId) {
      return false;
    }

    if (!isManager()) {
      return false;
    }

    try {

      // Get user's PIN from database
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('pin')
        .eq('id', authUser.id)
        .single();

      if (userError || !userData?.pin) {
        return false;
      }

      const storedPin = userData.pin;

      // Check if PIN is hashed (bcrypt format)
      if (storedPin.startsWith('$2b$') || storedPin.startsWith('$2a$')) {
        try {
          const bcrypt = await import('bcryptjs');
          const isValid = await bcrypt.compare(pin, storedPin);
          return isValid;
        } catch (bcryptError) {
          return String(pin) === String(storedPin);
        }
      } else {
        // Plain text PIN comparison
        return String(pin) === String(storedPin);
      }
      
    } catch (err) {
      return false;
    }
  };

  /**
   * Refresh authentication state
   */
  const refreshAuth = () => {
    setAuthLoading(true);
    initializeAuth();
  };

  /**
   * Clear authentication error
   */
  const clearAuthError = () => {
    setAuthError(null);
  };

  /**
   * Navigate to login page
   */
  const goToLogin = () => {
    navigate('/login');
  };

  /**
   * Navigate to dashboard
   */
  const goToDashboard = () => {
    navigate('/dashboard');
  };

  return {
    // Authentication state
    authUser,
    selectedBusinessId,
    userRole,
    activePOSUser,
    businessData,
    authLoading,
    authError,
    
    // Authentication status
    isAuthenticated: !!authUser && !authLoading && !authError,
    isReady: !authLoading && !!authUser && (!requireBusiness || !!selectedBusinessId),
    
    // Role checking methods
    hasRole,
    isManager,
    isOwner,
    
    // Utility methods
    validateManagerPin,
    refreshAuth,
    clearAuthError,
    goToLogin,
    goToDashboard,
    
    // Raw authentication data for custom logic
    rawAuthData: {
      authUser,
      selectedBusinessId,
      userRole,
      activePOSUser,
      businessData
    }
  };
};

export default usePOSAuth;