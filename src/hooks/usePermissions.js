// src/hooks/usePermissions.js - FIXED TO WAIT FOR VALID BUSINESS
/**
 * Centralized Permission Management Hook
 * Handles permission checking across the entire Tavari system
 */

import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useBusinessContext } from '../contexts/BusinessContext';
import { getTaskKioskDashboardContext } from '../helpers/taskManagerKioskSession';
import { resolveMembershipUserIds } from '../utils/membershipUserIds';
import {
  isPrivilegedMembershipRole,
  isTerminatedAtBusiness,
  resolveEmploymentFields,
} from '../utils/businessEmploymentStatus';
import {
  clearPermissionsSessionCache,
  getBootstrapBusinessId,
  getPermissionsSessionCache,
  setPermissionsSessionCache,
} from '../utils/posAuthSessionCache';

function isPosFloorPath(pathname = '') {
  const path = String(pathname || '').toLowerCase();
  const isPosBackOfficeRoute =
    path.includes('/pos/inventory') ||
    path.includes('/pos/modifiers') ||
    path.includes('/pos/categories') ||
    path.includes('/pos/bundles');
  if (isPosBackOfficeRoute) return false;
  return path.includes('/pos/') ||
    path.includes('/register') ||
    path.includes('/payment') ||
    path.includes('/receipt') ||
    path.includes('/tab');
}

function isPosBackOfficePath(pathname = '') {
  const path = String(pathname || '').toLowerCase();
  return path.includes('/pos/inventory') ||
    path.includes('/pos/modifiers') ||
    path.includes('/pos/categories') ||
    path.includes('/pos/bundles');
}

const readBootstrapPermissionsCache = () => {
  const businessId = getBootstrapBusinessId();
  return businessId ? getPermissionsSessionCache(businessId) : null;
};

/**
 * Custom hook for checking user permissions
 * @returns {Object} Permission checking functions and state
 */
export const usePermissions = () => {
  const { selectedBusinessId } = useBusinessContext();
  const location = useLocation();
  const pathname = location?.pathname || '';
  const onPosFloor = isPosFloorPath(pathname);

  const bootstrapCache = readBootstrapPermissionsCache();
  // Never hydrate the dashboard shell with a stale POS-floor override role.
  const bootstrapRole = (() => {
    if (!bootstrapCache) return null;
    const loginRole = bootstrapCache.loggedInUserRole || bootstrapCache.userRole || null;
    if (
      !onPosFloor &&
      bootstrapCache.userRole &&
      loginRole &&
      bootstrapCache.userRole !== loginRole
    ) {
      return loginRole;
    }
    return onPosFloor ? (bootstrapCache.userRole ?? null) : (loginRole ?? bootstrapCache.userRole ?? null);
  })();

  const [userPermissions, setUserPermissions] = useState(
    () => {
      if (!bootstrapCache) return [];
      if (
        !onPosFloor &&
        bootstrapCache.userRole &&
        bootstrapCache.loggedInUserRole &&
        bootstrapCache.userRole !== bootstrapCache.loggedInUserRole
      ) {
        return [];
      }
      return bootstrapCache.userPermissions ?? [];
    }
  );
  const [userRole, setUserRole] = useState(() => bootstrapRole);
  const [loggedInUserRole, setLoggedInUserRole] = useState(
    () => bootstrapCache?.loggedInUserRole ?? bootstrapCache?.userRole ?? null
  );
  const [loading, setLoading] = useState(() => {
    if (!bootstrapCache) return true;
    if (
      !onPosFloor &&
      bootstrapCache.userRole &&
      bootstrapCache.loggedInUserRole &&
      bootstrapCache.userRole !== bootstrapCache.loggedInUserRole
    ) {
      return true;
    }
    return false;
  });
  const [userId, setUserId] = useState(() => bootstrapCache?.userId ?? null);
  const [posUserVersion, setPosUserVersion] = useState(() => Date.now());

  const watchActivePosUser = useCallback(() => {
    setPosUserVersion(Date.now());
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener('pos-active-user-changed', watchActivePosUser);
      const handleStorage = (event) => {
        if (event.key === 'posActiveUser') {
          watchActivePosUser();
        }
      };
      window.addEventListener('storage', handleStorage);
      return () => {
        window.removeEventListener('pos-active-user-changed', watchActivePosUser);
        window.removeEventListener('storage', handleStorage);
      };
    }
  }, [watchActivePosUser]);

  // Load user's role and permissions
  useEffect(() => {
    // Only load permissions if we have a business ID
    if (selectedBusinessId) {
      loadUserPermissions();
    } else {
      // No business selected - clear permissions
      setUserPermissions([]);
      setUserRole(null);
      setLoading(false);
    }
  // Re-run when leaving/entering POS floor so owner dashboard never keeps a cashier override.
  }, [selectedBusinessId, posUserVersion, pathname]);

  const loadUserPermissions = async () => {
    try {
      if (!selectedBusinessId) {
        console.warn('No business selected');
        setLoading(false);
        return;
      }

      const path = (window.location.pathname || '').toLowerCase();
      const isPosBackOfficeRoute = isPosBackOfficePath(path);
      const isPOSScreen = isPosFloorPath(path);

      // Back-office pages always use the logged-in user's role — skip stale register cache.
      const cachedPermissions = isPosBackOfficeRoute
        ? null
        : getPermissionsSessionCache(selectedBusinessId);
      if (cachedPermissions) {
        const cachedLoginRole = cachedPermissions.loggedInUserRole || cachedPermissions.userRole || null;
        const cachedEffectiveRole = cachedPermissions.userRole || null;
        const cacheHasPosOverride =
          Boolean(cachedLoginRole) &&
          Boolean(cachedEffectiveRole) &&
          cachedEffectiveRole !== cachedLoginRole;

        // Dashboard / non-POS: never apply a POS cashier override from cache.
        if (!isPOSScreen && cacheHasPosOverride) {
          // Fall through and reload as the logged-in owner/manager.
        } else if (isPOSScreen) {
          setUserPermissions(cachedPermissions.userPermissions ?? []);
          setUserRole(cachedEffectiveRole);
          setLoggedInUserRole(cachedLoginRole);
          setUserId(cachedPermissions.userId ?? null);
          setLoading(false);
          return;
        } else {
          // Non-POS with clean cache: use logged-in role.
          setUserPermissions(cachedPermissions.userPermissions ?? []);
          setUserRole(cachedLoginRole || cachedEffectiveRole);
          setLoggedInUserRole(cachedLoginRole || cachedEffectiveRole);
          setUserId(cachedPermissions.userId ?? null);
          setLoading(false);
          return;
        }
      }

      setLoading(true);

      // IMPORTANT: Only use POS active user for register/checkout flows.
      // Inventory, modifiers, categories, and bundles use the logged-in user's role.
      const activePosUserRaw = localStorage.getItem('posActiveUser');
      let activePosUser = null;
      try {
        activePosUser = activePosUserRaw ? JSON.parse(activePosUserRaw) : null;
      } catch (err) {
        activePosUser = null;
      }

      const shouldUseActivePosUserForPermissions =
        isPOSScreen &&
        !isPosBackOfficeRoute &&
        activePosUser &&
        activePosUser.business_id === selectedBusinessId;

      const taskKioskCtx = isPOSScreen ? getTaskKioskDashboardContext() : null;

      if (taskKioskCtx?.dashboardToken) {
        const businessIdForRpc = taskKioskCtx.businessId || selectedBusinessId;
        const { data: permPayload, error: permRpcError } = await supabase.rpc('task_kiosk_dashboard_permissions', {
          p_token: taskKioskCtx.dashboardToken,
          p_business_id: businessIdForRpc
        });

        if (permRpcError) {
          console.warn('Task kiosk permissions load failed:', permRpcError);
          setUserPermissions([]);
          setUserRole(null);
          setLoading(false);
          return;
        }

        const role = permPayload?.role || taskKioskCtx.employee?.role || 'employee';
        const rawPermissions = permPayload?.permissions;
        let permissions = [];
        if (Array.isArray(rawPermissions)) {
          permissions = rawPermissions;
        } else if (typeof rawPermissions === 'string') {
          try {
            permissions = JSON.parse(rawPermissions);
          } catch {
            permissions = [];
          }
        }
        const employeeId = permPayload?.employee_id || taskKioskCtx.employeeId;

        setLoggedInUserRole(role);
        setUserId(employeeId);
        setUserRole(role);
        setUserPermissions(permissions);
        setLoading(false);
        return;
      }

      // Get current authenticated user (non–task-kiosk POS / dashboard flows)
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError || !user) {
        console.warn('No authenticated user');
        setLoading(false);
        return;
      }

      // Always load the logged-in user's role for override permission checks
      const membershipIds = await resolveMembershipUserIds(user);
      if (!membershipIds) {
        setLoading(false);
        return;
      }

      let loggedInUserRoleValue = null;
      try {
        const { data: loggedInUserRoleData, error: loggedInRoleError } = await supabase
          .from('user_roles')
          .select('role, active')
          .or(membershipIds.membershipFilter)
          .eq('business_id', selectedBusinessId)
          .eq('active', true)
          .maybeSingle();

        if (!loggedInRoleError && loggedInUserRoleData) {
          loggedInUserRoleValue = loggedInUserRoleData.role;
        } else {
          const { data: businessAccess, error: accessError } = await supabase
            .from('business_users')
            .select('role')
            .or(membershipIds.membershipFilter)
            .eq('business_id', selectedBusinessId)
            .maybeSingle();

          if (!accessError && businessAccess?.role) {
            loggedInUserRoleValue = businessAccess.role;
          }
        }
      } catch (err) {
        console.warn('Error loading logged-in user role:', err);
      }
      setLoggedInUserRole(loggedInUserRoleValue);

      // Only use POS active user role on register/checkout — not inventory management pages
      if (shouldUseActivePosUserForPermissions) {
        const effectiveRole = activePosUser.role || 'employee';
        setUserId(activePosUser.id || null);
        setUserRole(effectiveRole);

        const { data: rolePermissions, error: permError } = await supabase
          .from('role_permissions')
          .select('permission_key, granted')
          .eq('business_id', selectedBusinessId)
          .eq('role_key', effectiveRole)
          .eq('granted', true);

        if (permError) {
          console.warn('Error loading permissions for active POS user:', permError);
          setUserPermissions([]);
        } else {
          const permissions = (rolePermissions || []).map((p) => p.permission_key);
          setUserPermissions(permissions);
          setPermissionsSessionCache(selectedBusinessId, {
            userPermissions: permissions,
            userRole: effectiveRole,
            loggedInUserRole: loggedInUserRoleValue || effectiveRole,
            userId: activePosUser.id || null,
          });
        }

        setLoading(false);
        return;
      }
      
      // For non-POS screens, always use the logged-in user's role (fall through to below)

      setUserId(membershipIds.publicUserId || user.id);

      const { data: businessAccess, error: accessError } = await supabase
        .from('business_users')
        .select('business_id, role, employment_status, termination_date')
        .or(membershipIds.membershipFilter)
        .eq('business_id', selectedBusinessId)
        .maybeSingle();

      if (accessError || !businessAccess) {
        // Multi-business owners: fall back to user_roles when business_users row is missing
        const { data: roleOnlyAccess } = await supabase
          .from('user_roles')
          .select('business_id, role, active')
          .or(membershipIds.membershipFilter)
          .eq('business_id', selectedBusinessId)
          .eq('active', true)
          .maybeSingle();

        if (!roleOnlyAccess?.role) {
          console.warn('User does not have access to business:', selectedBusinessId);
          setUserPermissions([]);
          setUserRole(null);
          setLoggedInUserRole(null);
          setLoading(false);
          return;
        }

        const role = roleOnlyAccess.role;
        setUserRole(role);
        if (!loggedInUserRoleValue) {
          setLoggedInUserRole(role);
        }

        const { data: rolePermissions, error: permError } = await supabase
          .from('role_permissions')
          .select('permission_key, granted')
          .eq('business_id', selectedBusinessId)
          .eq('role_key', role)
          .eq('granted', true);

        const permissions = permError ? [] : (rolePermissions || []).map((p) => p.permission_key);
        setUserPermissions(permissions);
        setPermissionsSessionCache(selectedBusinessId, {
          userPermissions: permissions,
          userRole: role,
          loggedInUserRole: loggedInUserRoleValue || role,
          userId: membershipIds.publicUserId || user.id,
        });
        setLoading(false);
        return;
      }

      const role = businessAccess.role;

      // Termination applies per business membership, not globally on users.employment_status.
      if (!isPrivilegedMembershipRole(role)) {
        const { data: userData } = await supabase
          .from('users')
          .select('employment_status, termination_date')
          .eq('id', membershipIds.publicUserId || user.id)
          .single();

        const employment = resolveEmploymentFields({
          membership: businessAccess,
          user: userData,
        });

        if (isTerminatedAtBusiness({ membership: businessAccess, user: userData, role })) {
          if (employment.termination_date) {
            const terminationDate = new Date(employment.termination_date);
            const accessEndDate = new Date(terminationDate);
            accessEndDate.setFullYear(accessEndDate.getFullYear() + 7);

            if (new Date() > accessEndDate) {
              console.warn('Terminated employee access expired at this business');
              setUserPermissions([]);
              setUserRole(null);
              setLoading(false);
              return;
            }
          }

          const isPortalRoute = window.location.pathname?.startsWith('/portal');
          if (!isPortalRoute) {
            console.warn('Terminated at selected business — blocking main app access');
            setUserPermissions([]);
            setUserRole(null);
            setLoading(false);
            return;
          }
        }
      }

      if (!loggedInUserRoleValue) {
        setLoggedInUserRole(role);
      }

      // Try to get role from user_roles table, but don't block if it fails
      let finalRole = role || 'employee';
      
      try {
        const { data: userRoleData, error: roleError } = await supabase
          .from('user_roles')
          .select('role, active')
          .or(membershipIds.membershipFilter)
          .eq('business_id', selectedBusinessId)
          .eq('active', true)
          .maybeSingle();

        if (roleError) {
          if (roleError.code === 'PGRST116' || roleError.message?.includes('406')) {
            console.warn('user_roles query not accepted, using business_users role');
          } else {
            console.warn('user_roles query error:', roleError.message);
          }
        } else if (userRoleData) {
          finalRole = userRoleData.role;
        }
      } catch (err) {
        console.warn('user_roles table not available, using business_users role');
        finalRole = role || 'employee';
      }

      setUserRole(finalRole);

      const { data: rolePermissions, error: permError } = await supabase
        .from('role_permissions')
        .select('permission_key, granted')
        .eq('business_id', selectedBusinessId)
        .eq('role_key', finalRole)
        .eq('granted', true);

      if (permError) {
        console.warn('Error loading permissions:', permError);
        setUserPermissions([]);
      } else {
        const permissions = (rolePermissions || []).map((p) => p.permission_key);
        setUserPermissions(permissions);
        setPermissionsSessionCache(selectedBusinessId, {
          userPermissions: permissions,
          userRole: finalRole,
          loggedInUserRole: loggedInUserRoleValue || finalRole,
          userId: membershipIds.publicUserId || user.id,
        });
      }

    } catch (error) {
      clearPermissionsSessionCache(selectedBusinessId);
      console.error('Error loading user permissions:', error);
      setUserPermissions([]);
      setUserRole(null);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Check if user has a specific permission
   * @param {string} permissionKey - Permission key to check (e.g., 'pos.sales.create')
   * @returns {boolean} True if user has permission
   */
  const hasPermission = useCallback((permissionKey) => {
    if (!permissionKey) return false;
    
    // System roles have implicit permissions
    if (userRole === 'owner') return true; // Owners have all permissions
    if (userRole === 'admin') {
      // Admins have all permissions except owner-only ones
      if (permissionKey.startsWith('owner.')) return false;
      return true;
    }

    return userPermissions.includes(permissionKey);
  }, [userPermissions, userRole]);

  /**
   * Check if user has ANY of the specified permissions (OR logic)
   * @param {Array<string>} permissionKeys - Array of permission keys
   * @returns {boolean} True if user has at least one permission
   */
  const hasAnyPermission = useCallback((permissionKeys) => {
    if (!Array.isArray(permissionKeys) || permissionKeys.length === 0) {
      return false;
    }

    // System roles have implicit permissions
    if (userRole === 'owner') return true;
    if (userRole === 'admin') {
      // Check if any permission is owner-only
      const hasOwnerOnlyPermission = permissionKeys.some(key => key.startsWith('owner.'));
      if (!hasOwnerOnlyPermission) return true;
    }

    return permissionKeys.some(key => hasPermission(key));
  }, [userPermissions, userRole, hasPermission]);

  /**
   * Check if user has ALL of the specified permissions (AND logic)
   * @param {Array<string>} permissionKeys - Array of permission keys
   * @returns {boolean} True if user has all permissions
   */
  const hasAllPermissions = useCallback((permissionKeys) => {
    if (!Array.isArray(permissionKeys) || permissionKeys.length === 0) {
      return false;
    }

    return permissionKeys.every(key => hasPermission(key));
  }, [hasPermission]);

  /**
   * Check if user is owner
   * @returns {boolean} True if user is owner
   */
  const isOwner = useCallback(() => {
    return userRole === 'owner';
  }, [userRole]);

  /**
   * Check if user is admin
   * @returns {boolean} True if user is admin
   */
  const isAdmin = useCallback(() => {
    return userRole === 'admin';
  }, [userRole]);

  /**
   * Check if user is manager
   * @returns {boolean} True if user is manager
   */
  const isManager = useCallback(() => {
    return userRole === 'manager';
  }, [userRole]);

  /**
   * Check if user has elevated privileges (owner or admin)
   * @returns {boolean} True if user is owner or admin
   */
  const hasElevatedPrivileges = useCallback(() => {
    return (
      userRole === 'owner' ||
      userRole === 'admin' ||
      loggedInUserRole === 'owner' ||
      loggedInUserRole === 'admin'
    );
  }, [userRole, loggedInUserRole]);

  /**
   * Check if logged-in user (not active POS user) is owner
   * This is important for override permissions when an employee is using the register
   * @returns {boolean} True if logged-in user is owner
   */
  const isLoggedInUserOwner = useCallback(() => {
    return loggedInUserRole === 'owner';
  }, [loggedInUserRole]);

  /**
   * Check if logged-in user (not active POS user) is manager
   * This is important for override permissions when an employee is using the register
   * @returns {boolean} True if logged-in user is manager or owner
   */
  const isLoggedInUserManager = useCallback(() => {
    return loggedInUserRole === 'manager' || loggedInUserRole === 'owner';
  }, [loggedInUserRole]);

  /**
   * Check if logged-in user (not active POS user) has elevated privileges
   * This is important for override permissions when an employee is using the register
   * @returns {boolean} True if logged-in user is owner or admin
   */
  const hasLoggedInUserElevatedPrivileges = useCallback(() => {
    return loggedInUserRole === 'owner' || loggedInUserRole === 'admin';
  }, [loggedInUserRole]);

  /**
   * Get user's role name
   * @returns {string|null} User's role or null
   */
  const getRole = useCallback(() => {
    return userRole;
  }, [userRole]);

  /**
   * Get all user's permissions
   * @returns {Array<string>} Array of permission keys
   */
  const getAllPermissions = useCallback(() => {
    return userPermissions;
  }, [userPermissions]);

  /**
   * Refresh permissions (useful after role changes)
   */
  const refreshPermissions = useCallback(() => {
    if (selectedBusinessId) {
      loadUserPermissions();
    }
  }, [selectedBusinessId]);

  return {
    // Permission checking
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    
    // Role checking (uses effective role - active POS user on POS screens)
    isOwner,
    isAdmin,
    isManager,
    hasElevatedPrivileges,
    getRole,
    
    // Logged-in user role checking (always checks logged-in user, not active POS user)
    // Use these for override permissions when an employee is using the register
    isLoggedInUserOwner,
    isLoggedInUserManager,
    hasLoggedInUserElevatedPrivileges,
    
    // Data access
    getAllPermissions,
    userPermissions,
    userRole,
    loggedInUserRole,
    userId,
    
    // Utility
    refreshPermissions,
    loading
  };
};

export default usePermissions;