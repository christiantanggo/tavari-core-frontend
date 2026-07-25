// src/helpers/hrPermissions.js

/**
 * HR Permission levels:
 * - owner: Full access to all HR functions
 * - admin: Full access to all HR functions  
 * - manager: Can view and manage employees under them, limited settings access
 * - employee: Can only view their own profile and acknowledge policies
 */

export const HR_PERMISSIONS = {
  // Employee Profile Management
  VIEW_ALL_EMPLOYEES: ['owner', 'admin', 'manager'],
  CREATE_EMPLOYEE: ['owner', 'admin'],
  EDIT_EMPLOYEE: ['owner', 'admin', 'manager'],
  DELETE_EMPLOYEE: ['owner', 'admin'],
  
  // Contract Management
  VIEW_CONTRACTS: ['owner', 'admin', 'manager'],
  CREATE_CONTRACT: ['owner', 'admin'],
  EDIT_CONTRACT: ['owner', 'admin'],
  SIGN_CONTRACT: ['owner', 'admin', 'manager'],
  
  // Onboarding Management
  VIEW_ONBOARDING: ['owner', 'admin', 'manager'],
  MANAGE_ONBOARDING: ['owner', 'admin', 'manager'],
  CREATE_ONBOARDING_TASKS: ['owner', 'admin'],
  
  // Writeups and Disciplinary Actions
  VIEW_WRITEUPS: ['owner', 'admin', 'manager'],
  CREATE_WRITEUP: ['owner', 'admin', 'manager'],
  APPROVE_WRITEUP: ['owner', 'admin'],
  
  // Policy Management
  VIEW_POLICIES: ['owner', 'admin', 'manager', 'employee'],
  CREATE_POLICY: ['owner', 'admin'],
  ASSIGN_POLICY: ['owner', 'admin', 'manager'],
  ACKNOWLEDGE_POLICY: ['owner', 'admin', 'manager', 'employee'],
  
  // Settings and Configuration
  VIEW_HR_SETTINGS: ['owner', 'admin'],
  EDIT_HR_SETTINGS: ['owner', 'admin'],
  
  // Reporting and Analytics
  VIEW_HR_REPORTS: ['owner', 'admin', 'manager'],
  EXPORT_HR_DATA: ['owner', 'admin'],
};

/**
 * Check if user has permission for a specific HR action
 * @param {string} userRole - User's role (owner, admin, manager, employee)
 * @param {string} permission - Permission key from HR_PERMISSIONS
 * @returns {boolean}
 */
export const hasHRPermission = (userRole, permission) => {
  if (!userRole || !permission) return false;
  
  const allowedRoles = HR_PERMISSIONS[permission];
  if (!allowedRoles) return false;
  
  return allowedRoles.includes(userRole.toLowerCase());
};

/**
 * Check if user can access HR module at all
 * @param {string} userRole - User's role
 * @returns {boolean}
 */
export const canAccessHR = (userRole) => {
  return ['owner', 'admin', 'manager'].includes(userRole?.toLowerCase());
};

/**
 * Check if user can manage a specific employee
 * @param {string} userRole - Manager's role
 * @param {string} managerId - Manager's employee profile ID
 * @param {string} employeeManagerId - Employee's manager ID
 * @returns {boolean}
 */
export const canManageEmployee = (userRole, managerId, employeeManagerId) => {
  const role = userRole?.toLowerCase();
  
  // Owners and admins can manage anyone
  if (['owner', 'admin'].includes(role)) return true;
  
  // Managers can only manage their direct reports
  if (role === 'manager') {
    return managerId === employeeManagerId;
  }
  
  return false;
};

/**
 * Get user's HR access level description
 * @param {string} userRole - User's role
 * @returns {string}
 */
export const getHRAccessLevel = (userRole) => {
  const role = userRole?.toLowerCase();
  
  switch (role) {
    case 'owner':
      return 'Full HR Access - All functions available';
    case 'admin':
      return 'Full HR Access - All functions available';
    case 'manager':
      return 'Manager Access - Can manage direct reports';
    case 'employee':
      return 'Employee Access - View own profile only';
    default:
      return 'No HR Access';
  }
};

/**
 * Get filtered HR menu items based on user role
 * @param {string} userRole - User's role
 * @returns {Array}
 */
export const getHRMenuItems = (userRole) => {
  const role = userRole?.toLowerCase();
  
  const allMenuItems = [
    {
      id: 'dashboard',
      title: 'HR Dashboard',
      path: '/dashboard/hr/dashboard',
      requiredPermission: 'VIEW_HR_REPORTS'
    },
    {
      id: 'employees',
      title: 'Employee Profiles',
      path: '/dashboard/hr/employees',
      requiredPermission: 'VIEW_ALL_EMPLOYEES'
    },
    {
      id: 'contracts',
      title: 'Contract Management',
      path: '/dashboard/hr/contracts',
      requiredPermission: 'VIEW_CONTRACTS'
    },
    {
      id: 'onboarding',
      title: 'Onboarding Center',
      path: '/dashboard/hr/onboarding',
      requiredPermission: 'VIEW_ONBOARDING'
    },
    {
      id: 'writeups',
      title: 'Writeup Management',
      path: '/dashboard/hr/writeups',
      requiredPermission: 'VIEW_WRITEUPS'
    },
    {
      id: 'policies',
      title: 'Policy Center',
      path: '/dashboard/hr/policies',
      requiredPermission: 'VIEW_POLICIES'
    },
    {
      id: 'settings',
      title: 'HR configuration',
      path: '/dashboard/hr/employee-management',
      requiredPermission: 'VIEW_HR_SETTINGS'
    }
  ];
  
  // Filter menu items based on user permissions
  return allMenuItems.filter(item => 
    hasHRPermission(role, item.requiredPermission)
  );
};