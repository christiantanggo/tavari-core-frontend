// src/screens/RoleManager.jsx - WITH PERMISSIONS & SECURITY
import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { SecurityWrapper, useSecurityContext } from '../Security';
import { usePOSAuth } from '../hooks/usePOSAuth';
import { usePermissions } from '../hooks/usePermissions';
import POSAuthWrapper from '../components/Auth/POSAuthWrapper';
import PermissionGate from '../components/Auth/PermissionGate';
import SessionManager from '../components/SessionManager';
import { TavariStyles } from '../utils/TavariStyles';
import toast from 'react-hot-toast';

export default function RoleManager() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState({});
  const [permissions, setPermissions] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  const availableRoles = ['customer', 'employee', 'keyholder', 'manager', 'admin', 'owner'];
  const permissionList = ['canAccessReports', 'canEditSchedule', 'canSeePayroll'];

  // Security context for role management
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'RoleManager',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'critical'
  });

  // Authentication
  const {
    selectedBusinessId,
    authUser,
    userRole,
    businessData,
    authLoading,
    authError,
    isOwner,
    isAdmin
  } = usePOSAuth({
    requiredRoles: ['owner', 'admin'],
    requireBusiness: true,
    componentName: 'RoleManager'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Permission checks
  const canViewRoles = hasPermission('admin.roles.view') || hasElevatedPrivileges();
  const canEditRoles = hasPermission('admin.roles.edit') || isOwner();
  const canEditPermissions = hasPermission('admin.permissions.edit') || isOwner();

  useEffect(() => {
    if (!authLoading && !permissionsLoading && canViewRoles && selectedBusinessId) {
      loadUserRoles();
    }
  }, [authLoading, permissionsLoading, canViewRoles, selectedBusinessId]);

  const loadUserRoles = async () => {
    try {
      setLoading(true);

      await recordAction('role_manager_access', selectedBusinessId, true);

      await logSecurityEvent('role_manager_accessed', {
        user_id: authUser?.id,
        business_id: selectedBusinessId,
        user_role: userRole,
        data_type: 'role_management',
        data_action: 'view_roles'
      }, 'medium');

      // Get all active roles for the current business
      const { data, error } = await supabase
        .from('user_roles')
        .select('id, user_id, role, active, custom_permissions, users(id, email, full_name, status)')
        .eq('active', true)
        .eq('business_id', selectedBusinessId)
        .order('role', { ascending: false });

      if (error) throw error;

      setUsers(data || []);

      const roleMap = {};
      const permMap = {};

      data?.forEach((u) => {
        roleMap[u.id] = u.role;
        permMap[u.id] = u.custom_permissions || {};
      });

      setRoles(roleMap);
      setPermissions(permMap);

      await logSecurityEvent('roles_loaded', {
        user_id: authUser?.id,
        business_id: selectedBusinessId,
        role_count: data?.length || 0,
        data_type: 'role_management',
        data_action: 'roles_data_loaded'
      }, 'low');

      // Audit log
      await supabase.from('audit_logs').insert({
        user_id: authUser?.id,
        event_type: 'user_profile_access',
        details: {
          accessed_from: 'role_manager',
          accessed_count: data?.length || 0,
          business_id: selectedBusinessId,
        },
      });

    } catch (error) {
      await logSecurityEvent('role_manager_load_error', {
        user_id: authUser?.id,
        business_id: selectedBusinessId,
        error_message: error.message,
        data_type: 'role_management',
        data_action: 'load_failed'
      }, 'high');

      toast.error('Failed to load roles');
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (id, newRole) => {
    if (!canEditRoles) {
      toast.error('You do not have permission to edit roles');
      return;
    }

    // Prevent users from changing their own role
    const targetUser = users.find(u => u.id === id);
    if (targetUser?.user_id === authUser?.id) {
      toast.error('You cannot change your own role');
      return;
    }

    // Prevent non-owners from assigning owner role
    if (newRole === 'owner' && !isOwner()) {
      toast.error('Only owners can assign the owner role');
      return;
    }

    setRoles((prev) => ({ ...prev, [id]: newRole }));

    await logSecurityEvent('role_change_initiated', {
      user_id: authUser?.id,
      target_user_role_id: id,
      target_user_id: targetUser?.user_id,
      old_role: roles[id],
      new_role: newRole,
      business_id: selectedBusinessId,
      data_type: 'role_management',
      data_action: 'role_modified'
    }, 'high');
  };

  const togglePermission = async (id, permission) => {
    if (!canEditPermissions) {
      toast.error('You do not have permission to edit permissions');
      return;
    }

    // Prevent users from changing their own permissions
    const targetUser = users.find(u => u.id === id);
    if (targetUser?.user_id === authUser?.id) {
      toast.error('You cannot change your own permissions');
      return;
    }

    setPermissions((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [permission]: !prev[id]?.[permission],
      },
    }));

    await logSecurityEvent('permission_toggle_initiated', {
      user_id: authUser?.id,
      target_user_role_id: id,
      target_user_id: targetUser?.user_id,
      permission,
      new_value: !permissions[id]?.[permission],
      business_id: selectedBusinessId,
      data_type: 'permission_management',
      data_action: 'permission_toggled'
    }, 'high');
  };

  const saveChanges = async (id) => {
    if (!canEditRoles && !canEditPermissions) {
      toast.error('You do not have permission to save changes');
      return;
    }

    // Rate limiting: 20 role updates per minute
    const rateLimitOk = await checkRateLimit('role_update', 20, 60000);
    if (!rateLimitOk) {
      toast.error('Too many updates. Please wait a moment.');
      return;
    }

    setSavingId(id);

    try {
      const targetUser = users.find(u => u.id === id);

      // Prevent users from modifying their own role
      if (targetUser?.user_id === authUser?.id) {
        toast.error('You cannot modify your own role or permissions');
        setSavingId(null);
        return;
      }

      await recordAction('role_update_attempt', id, true);

      let safePermissions = permissions[id];
      if (typeof safePermissions !== 'object' || safePermissions === null) {
        safePermissions = {};
      }

      const updates = {
        role: roles[id],
        custom_permissions: safePermissions,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('user_roles')
        .update(updates)
        .eq('id', id);

      if (error) throw error;

      await logSecurityEvent('role_updated', {
        user_id: authUser?.id,
        target_user_role_id: id,
        target_user_id: targetUser?.user_id,
        target_email: targetUser?.users?.email,
        new_role: roles[id],
        new_permissions: safePermissions,
        business_id: selectedBusinessId,
        data_type: 'role_management',
        data_action: 'role_saved_successfully'
      }, 'high');

      // Audit log
      await supabase.from('audit_logs').insert({
        user_id: authUser?.id,
        event_type: 'role_updated',
        details: {
          target_user_role_id: id,
          target_user_id: targetUser?.user_id,
          new_role: roles[id],
          new_permissions: safePermissions,
          business_id: selectedBusinessId,
        },
      });

      toast.success('Role and permissions updated successfully');

    } catch (error) {
      await logSecurityEvent('role_update_error', {
        user_id: authUser?.id,
        target_user_role_id: id,
        error_message: error.message,
        business_id: selectedBusinessId,
        data_type: 'role_management',
        data_action: 'save_failed'
      }, 'high');

      toast.error(`Failed to update: ${error.message}`);
    } finally {
      setSavingId(null);
    }
  };

  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing['3xl'],
      paddingTop: '100px'
    },
    header: {
      marginBottom: TavariStyles.spacing['3xl']
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.xs,
      margin: '0 0 8px 0'
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.md,
      color: TavariStyles.colors.gray600
    },
    userCard: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing.lg,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)'
    },
    userHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.lg,
      paddingBottom: TavariStyles.spacing.md,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`
    },
    userName: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800
    },
    userEmail: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    roleSection: {
      marginBottom: TavariStyles.spacing.lg
    },
    label: {
      display: 'block',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.xs
    },
    select: {
      width: '100%',
      maxWidth: '300px',
      padding: '10px 14px',
      fontSize: TavariStyles.typography.fontSize.md,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      outline: 'none',
      backgroundColor: TavariStyles.colors.white,
      cursor: 'pointer'
    },
    permissionsSection: {
      marginBottom: TavariStyles.spacing.lg
    },
    permissionsList: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.sm
    },
    checkboxLabel: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray700,
      cursor: 'pointer'
    },
    checkbox: {
      width: '18px',
      height: '18px',
      cursor: 'pointer'
    },
    saveButton: {
      padding: '10px 24px',
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: 'pointer',
      transition: 'background-color 0.2s ease',
      opacity: savingId ? 0.6 : 1
    },
    loading: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '400px',
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600
    },
    emptyState: {
      textAlign: 'center',
      padding: '60px 20px',
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    selfBadge: {
      padding: '4px 12px',
      backgroundColor: '#e3f2fd',
      color: '#1976D2',
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.semibold
    }
  };

  if (authLoading || permissionsLoading || loading) {
    return (
      <SessionManager>
        <div style={styles.container}>
          <div style={styles.loading}>
            <div style={{
              width: '32px',
              height: '32px',
              border: '3px solid #14B8A6',
              borderTop: '3px solid transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 8px auto'
            }}></div>
            <p>Loading roles...</p>
          </div>
        </div>
      </SessionManager>
    );
  }

  if (!canViewRoles) {
    return (
      <SessionManager>
        <div style={styles.container}>
          <div style={styles.emptyState}>
            <h2 style={{ color: TavariStyles.colors.gray700, marginBottom: '16px' }}>
              Access Denied
            </h2>
            <p style={{ color: TavariStyles.colors.gray600 }}>
              You do not have permission to view the role manager
            </p>
          </div>
        </div>
      </SessionManager>
    );
  }

  return (
    <POSAuthWrapper
      requiredRoles={['owner', 'admin']}
      requireBusiness={true}
      componentName="RoleManager"
    >
      <SecurityWrapper>
        <SessionManager>
          <div style={styles.container}>
            <style>
              {`
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}
            </style>

            <div style={styles.header}>
              <h2 style={styles.title}>Role Manager</h2>
              <p style={styles.subtitle}>
                Manage user roles and permissions for {businessData?.name || 'your business'}
              </p>
            </div>

            {users.length === 0 ? (
              <div style={styles.emptyState}>
                <h3 style={{ color: TavariStyles.colors.gray700, marginBottom: '8px' }}>
                  No Users Found
                </h3>
                <p style={{ color: TavariStyles.colors.gray600 }}>
                  There are no active users in this business.
                </p>
              </div>
            ) : (
              users.map((u) => {
                const isSelf = u.user_id === authUser?.id;
                const canEdit = canEditRoles && !isSelf;
                const canEditPerms = canEditPermissions && !isSelf;

                return (
                  <div key={u.id} style={styles.userCard}>
                    <div style={styles.userHeader}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={styles.userName}>
                            {u.users?.full_name || u.users?.email || 'Unknown User'}
                          </div>
                          {isSelf && <span style={styles.selfBadge}>YOU</span>}
                        </div>
                        <div style={styles.userEmail}>{u.users?.email}</div>
                      </div>
                      {u.users?.status && (
                        <div style={{
                          padding: '4px 12px',
                          backgroundColor: u.users.status === 'active' 
                            ? '#e8f5e9' 
                            : '#ffebee',
                          color: u.users.status === 'active' 
                            ? '#2e7d32' 
                            : '#c62828',
                          borderRadius: TavariStyles.borderRadius?.sm || '4px',
                          fontSize: TavariStyles.typography.fontSize.xs,
                          fontWeight: TavariStyles.typography.fontWeight.bold,
                          textTransform: 'uppercase'
                        }}>
                          {u.users.status}
                        </div>
                      )}
                    </div>

                    <PermissionGate permission="admin.roles.edit" fallback={
                      <div style={styles.roleSection}>
                        <label style={styles.label}>Role</label>
                        <div style={{
                          padding: '10px 14px',
                          backgroundColor: TavariStyles.colors.gray100,
                          borderRadius: TavariStyles.borderRadius?.md || '8px',
                          fontSize: TavariStyles.typography.fontSize.md,
                          color: TavariStyles.colors.gray700,
                          maxWidth: '300px'
                        }}>
                          {roles[u.id]}
                        </div>
                      </div>
                    }>
                      <div style={styles.roleSection}>
                        <label style={styles.label}>Role</label>
                        <select
                          value={roles[u.id]}
                          onChange={(e) => handleRoleChange(u.id, e.target.value)}
                          style={styles.select}
                          disabled={!canEdit || savingId === u.id}
                        >
                          {availableRoles.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                        {isSelf && (
                          <div style={{
                            fontSize: TavariStyles.typography.fontSize.xs,
                            color: TavariStyles.colors.gray500,
                            marginTop: TavariStyles.spacing.xs
                          }}>
                            You cannot change your own role
                          </div>
                        )}
                      </div>
                    </PermissionGate>

                    <div style={styles.permissionsSection}>
                      <label style={styles.label}>Custom Permissions</label>
                      <div style={styles.permissionsList}>
                        {permissionList.map((perm) => (
                          <label key={perm} style={styles.checkboxLabel}>
                            <input
                              type="checkbox"
                              checked={permissions[u.id]?.[perm] || false}
                              onChange={() => togglePermission(u.id, perm)}
                              disabled={!canEditPerms || savingId === u.id}
                              style={styles.checkbox}
                            />
                            {perm}
                          </label>
                        ))}
                      </div>
                    </div>

                    {(canEdit || canEditPerms) && (
                      <button
                        onClick={() => saveChanges(u.id)}
                        style={styles.saveButton}
                        disabled={savingId === u.id || isSelf}
                        onMouseOver={(e) => {
                          if (savingId !== u.id && !isSelf) {
                            e.target.style.backgroundColor = TavariStyles.colors.primaryHover || '#0d7377';
                          }
                        }}
                        onMouseOut={(e) => {
                          e.target.style.backgroundColor = TavariStyles.colors.primary;
                        }}
                      >
                        {savingId === u.id ? 'Saving...' : 'Save Changes'}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </SessionManager>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
}