// hooks/usePOSAuth.js - Standardized Authentication Hook for POS Components
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useBusinessContext } from '../contexts/BusinessContext';
import { getPublicUserId } from '../utils/getPublicUserId';
import { sessionPersistence } from '../services/SessionPersistence';
import { getTaskKioskDashboardContext } from '../helpers/taskManagerKioskSession';
import {
  clearPosAuthSessionCache,
  getBootstrapBusinessId,
  getPosAuthSessionCache,
  setPosAuthSessionCache,
} from '../utils/posAuthSessionCache';
import { validateAnyManagerPin } from '../helpers/managerPinValidation';


const readBootstrapAuthCache = () => {
  const businessId = getBootstrapBusinessId();
  return businessId ? getPosAuthSessionCache(businessId) : null;
};

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
  const businessContext = useBusinessContext();
  const contextSelectedBusinessId = businessContext?.selectedBusinessId || null;
  const authRunRef = useRef(0);
  const requiredRolesRef = useRef(requiredRoles);
  const requiredRolesKey = Array.isArray(requiredRoles)
    ? requiredRoles.join('|')
    : (requiredRoles || '');

  // Authentication state — hydrate from session cache to avoid blank flashes on route changes
  const [authUser, setAuthUser] = useState(() => readBootstrapAuthCache()?.authUser ?? null);
  const [selectedBusinessId, setSelectedBusinessId] = useState(
    () => readBootstrapAuthCache()?.selectedBusinessId ?? null
  );
  const [userRole, setUserRole] = useState(() => readBootstrapAuthCache()?.userRole ?? null);
  const [loginUserRole, setLoginUserRole] = useState(
    () => readBootstrapAuthCache()?.loginUserRole ?? null
  );
  const [businessData, setBusinessData] = useState(
    () => readBootstrapAuthCache()?.businessData ?? null
  );
  const [authLoading, setAuthLoading] = useState(() => !readBootstrapAuthCache());
  const [authError, setAuthError] = useState(null);
  const [activePOSUser, setActivePOSUser] = useState(
    () => readBootstrapAuthCache()?.activePOSUser ?? null
  );

  useEffect(() => {
    requiredRolesRef.current = requiredRoles;
  }, [requiredRolesKey]);

  const shouldUsePosRoleOverride = useCallback(() => {
    if (typeof window === 'undefined') return false;
    const path = (window.location?.pathname || '').toLowerCase();
    const isPosBackOfficeRoute =
      path.includes('/pos/inventory') ||
      path.includes('/pos/modifiers') ||
      path.includes('/pos/categories') ||
      path.includes('/pos/bundles');
    if (isPosBackOfficeRoute) return false;
    return path.startsWith('/dashboard/pos') || path.startsWith('/pos') || componentName.toLowerCase().includes('pos');
  }, [componentName]);

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

  const getCurrentBusinessId = useCallback(() => {
    if (contextSelectedBusinessId) return contextSelectedBusinessId;
    return localStorage.getItem('currentBusinessId') || localStorage.getItem('selectedBusinessId');
  }, [contextSelectedBusinessId]);

  const initializeAuth = useCallback(async () => {
    const runId = ++authRunRef.current;
    const safeSetState = (setter, value) => {
      if (authRunRef.current === runId) {
        setter(value);
      }
    };

    try {
      safeSetState(setAuthError, null);

      const cachedBusinessId = getCurrentBusinessId();
      const cachedAuth = cachedBusinessId ? getPosAuthSessionCache(cachedBusinessId) : null;
      if (cachedAuth) {
        const path = (typeof window !== 'undefined' ? window.location.pathname : '').toLowerCase();
        const isPosBackOfficeRoute =
          path.includes('/pos/inventory') ||
          path.includes('/pos/modifiers') ||
          path.includes('/pos/categories') ||
          path.includes('/pos/bundles');
        const effectiveRole =
          isPosBackOfficeRoute && cachedAuth.loginUserRole
            ? cachedAuth.loginUserRole
            : cachedAuth.userRole;

        safeSetState(setAuthUser, cachedAuth.authUser);
        safeSetState(setSelectedBusinessId, cachedAuth.selectedBusinessId);
        safeSetState(setUserRole, effectiveRole);
        safeSetState(setLoginUserRole, cachedAuth.loginUserRole);
        safeSetState(setBusinessData, cachedAuth.businessData);
        safeSetState(setActivePOSUser, isPosBackOfficeRoute ? null : (cachedAuth.activePOSUser ?? null));
        safeSetState(setAuthLoading, false);
        return;
      }

      safeSetState(setAuthLoading, true);

      // Check current session — attempt restore before sending staff to full login
      let { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !session?.user) {
        if (sessionPersistence.isPersistenceEnabled()) {
          const restoreResult = await sessionPersistence.restoreSession();
          if (restoreResult.restored && restoreResult.session) {
            session = restoreResult.session;
            sessionError = null;
          }
        }
      }

      const taskKioskCtx = getTaskKioskDashboardContext();

      if (sessionError || !session?.user) {
        if (taskKioskCtx) {
          const currentBusinessId = taskKioskCtx.businessId || getCurrentBusinessId();
          const activeUser = getActivePosUser(currentBusinessId);
          const effectiveRole = activeUser?.role || taskKioskCtx.employee?.role || 'employee';

          safeSetState(setAuthUser, {
            id: taskKioskCtx.employeeId,
            task_kiosk: true,
            email: null
          });
          safeSetState(setSelectedBusinessId, currentBusinessId);
          safeSetState(setLoginUserRole, effectiveRole);
          safeSetState(setUserRole, effectiveRole);
          safeSetState(setActivePOSUser, activeUser || {
            id: taskKioskCtx.employeeId,
            role: effectiveRole,
            business_id: currentBusinessId,
            source: 'task_kiosk'
          });
          safeSetState(setBusinessData, { id: currentBusinessId });

          const currentRequiredRoles = requiredRolesRef.current;
          if (currentRequiredRoles && currentRequiredRoles.length > 0 && !currentRequiredRoles.includes(effectiveRole)) {
            safeSetState(setAuthError, `Insufficient permissions. This feature requires: ${currentRequiredRoles.join(' or ')}`);
            safeSetState(setAuthLoading, false);
            return;
          }

          safeSetState(setAuthLoading, false);
          return;
        }

        if (sessionPersistence.isPersistenceEnabled()) {
          const onUnlockRoute =
            typeof window !== 'undefined' && window.location.pathname === '/unlock';
          if (!onUnlockRoute) {
            navigate('/unlock');
          }
          safeSetState(setAuthLoading, false);
          return;
        }
        navigate('/login');
        return;
      }

      safeSetState(setAuthUser, session.user);

      const publicUserId = await getPublicUserId(session.user.email);
      const effectiveUserId = publicUserId || session.user.id;

      // Get business context if required
      if (requireBusiness) {
        const currentBusinessId = getCurrentBusinessId();

        if (!currentBusinessId) {
          safeSetState(setSelectedBusinessId, null);
          safeSetState(setBusinessData, null);
          safeSetState(setAuthError, 'No business selected. Please select a business from the dashboard.');
          safeSetState(setAuthLoading, false);
          return;
        }

        safeSetState(setSelectedBusinessId, currentBusinessId);

        // Verify user has access to this business and get role
        // Try user_roles first, fallback to business_users if it fails
        let primaryRole = null;
        
        try {
          const { data: userRoles, error: roleError } = await supabase
            .from('user_roles')
            .select('role, active')
            .eq('user_id', effectiveUserId)
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
            .eq('user_id', effectiveUserId)
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

        safeSetState(setLoginUserRole, primaryRole);

        const activeUserOverride = shouldUsePosRoleOverride() ? getActivePosUser(currentBusinessId) : null;
        const effectiveRole = activeUserOverride?.role || primaryRole;
        if (activeUserOverride) {
          safeSetState(setActivePOSUser, activeUserOverride);
          safeSetState(setUserRole, effectiveRole);
        } else {
          safeSetState(setActivePOSUser, null);
          safeSetState(setUserRole, primaryRole);
        }

        // Check if user has required role
        const currentRequiredRoles = requiredRolesRef.current;
        if (currentRequiredRoles && currentRequiredRoles.length > 0 && !currentRequiredRoles.includes(effectiveRole)) {
          safeSetState(setAuthError, `Insufficient permissions. This feature requires: ${currentRequiredRoles.join(' or ')}`);
          safeSetState(setAuthLoading, false);
          return;
        }

        // Load business data
        let loadedBusinessData = { id: currentBusinessId };
        try {
          const { data: business, error: businessError } = await supabase
            .from('businesses')
            .select('*')
            .eq('id', currentBusinessId)
            .single();

          if (businessError) {
            console.warn(`[usePOSAuth] Failed to load business data for ${componentName}:`, businessError.message || businessError);
          } else {
            loadedBusinessData = business;
          }
        } catch (businessErr) {
          console.warn(`[usePOSAuth] Unexpected business load failure for ${componentName}:`, businessErr);
        }

        safeSetState(setBusinessData, loadedBusinessData);

        setPosAuthSessionCache(currentBusinessId, {
          authUser: session.user,
          selectedBusinessId: currentBusinessId,
          userRole: effectiveRole,
          loginUserRole: primaryRole,
          businessData: loadedBusinessData,
          activePOSUser: activeUserOverride ?? null,
        });
      } else {
        safeSetState(setSelectedBusinessId, null);
      }

      safeSetState(setAuthLoading, false);

    } catch (err) {
      clearPosAuthSessionCache(getCurrentBusinessId());
      safeSetState(setAuthError, err.message || 'An unexpected authentication error occurred');
      safeSetState(setAuthLoading, false);
    }
  }, [componentName, getActivePosUser, getCurrentBusinessId, navigate, requireBusiness, requiredRolesKey, shouldUsePosRoleOverride]);

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  useEffect(() => {
    if (!requireBusiness) return;

    const handleActiveUserChange = () => {
      if (!selectedBusinessId) return;
      const activeUser = shouldUsePosRoleOverride() ? getActivePosUser(selectedBusinessId) : null;
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
        if (event.key === 'selectedBusinessId' || event.key === 'currentBusinessId') {
          clearPosAuthSessionCache();
          initializeAuth();
        }
      };
      window.addEventListener('storage', storageHandler);
      return () => {
        window.removeEventListener('pos-active-user-changed', handleActiveUserChange);
        window.removeEventListener('storage', storageHandler);
      };
    }

    return undefined;
  }, [initializeAuth, selectedBusinessId, getActivePosUser, loginUserRole, requireBusiness, shouldUsePosRoleOverride, userRole]);

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
   * Validate manager PIN for sensitive operations.
   * Accepts any active manager/owner/admin PIN for the current business
   * (same source as unlock / POS register — not limited to the logged-in user
   * or a possibly stale cached role).
   * @param {string} pin - PIN to validate
   * @returns {Promise<boolean>} Whether PIN is valid
   */
  const validateManagerPin = useCallback(async (pin) => {
    const businessId = selectedBusinessId || getCurrentBusinessId();
    if (!businessId) {
      return false;
    }

    const result = await validateAnyManagerPin(businessId, pin);
    return Boolean(result?.ok);
  }, [selectedBusinessId, getCurrentBusinessId]);

  /**
   * Refresh authentication state
   */
  const refreshAuth = () => {
    clearPosAuthSessionCache(getCurrentBusinessId());
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