// src/components/Auth/PermissionGate.jsx
/**
 * Permission Gate Component
 * Conditionally renders children based on user permissions
 * 
 * Usage Examples:
 * 
 * // Single permission required
 * <PermissionGate permission="pos.sales.void">
 *   <button>Void Sale</button>
 * </PermissionGate>
 * 
 * // Any of multiple permissions (OR logic)
 * <PermissionGate permissions={['pos.sales.create', 'pos.sales.refund']} requireAny>
 *   <div>Sales Actions</div>
 * </PermissionGate>
 * 
 * // All permissions required (AND logic)
 * <PermissionGate permissions={['hr.employees.edit', 'hr.wages.edit']} requireAll>
 *   <button>Edit Employee & Wage</button>
 * </PermissionGate>
 * 
 * // Show fallback if no permission
 * <PermissionGate permission="pos.reports.view" fallback={<p>Access Denied</p>}>
 *   <ReportViewer />
 * </PermissionGate>
 */

import React from 'react';
import { usePermissions } from '../../hooks/usePermissions';

const PermissionGate = ({
  // Single permission
  permission,
  
  // Multiple permissions
  permissions,
  requireAny = false,
  requireAll = false,
  
  // Role-based shortcuts
  requireOwner = false,
  requireAdmin = false,
  requireManager = false,
  requireElevated = false,
  
  // What to render
  children,
  fallback = null,
  
  // Loading state
  loadingFallback = null,

  // Skip permission checks (e.g. task kiosk already validated server-side)
  bypass = false,
  
  // Invert logic (hide instead of show)
  invert = false
}) => {
  const {
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    isOwner,
    isAdmin,
    isManager,
    hasElevatedPrivileges,
    loading
  } = usePermissions();

  // Handle loading state
  if (loading) {
    return loadingFallback;
  }

  if (bypass) {
    return children;
  }

  let hasAccess = false;

  // Check role-based shortcuts first
  if (requireOwner) {
    hasAccess = isOwner();
  } else if (requireAdmin) {
    hasAccess = isAdmin();
  } else if (requireManager) {
    hasAccess = isManager();
  } else if (requireElevated) {
    hasAccess = hasElevatedPrivileges();
    // When both elevated and explicit permissions are specified, allow either (OR).
    if (!hasAccess) {
      if (permission) {
        hasAccess = hasPermission(permission);
      } else if (permissions && Array.isArray(permissions)) {
        hasAccess = requireAll
          ? hasAllPermissions(permissions)
          : hasAnyPermission(permissions);
      }
    }
  }
  // Check permission-based access
  else if (permission) {
    hasAccess = hasPermission(permission);
  } else if (permissions && Array.isArray(permissions)) {
    if (requireAll) {
      hasAccess = hasAllPermissions(permissions);
    } else if (requireAny) {
      hasAccess = hasAnyPermission(permissions);
    } else {
      // Default to ANY if neither specified
      hasAccess = hasAnyPermission(permissions);
    }
  } else {
    // No permission specified - allow by default
    hasAccess = true;
  }

  // Apply invert logic if specified
  if (invert) {
    hasAccess = !hasAccess;
  }

  // Render based on access
  return hasAccess ? children : fallback;
};

export default PermissionGate;