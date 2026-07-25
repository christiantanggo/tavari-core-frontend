// src/components/Settings/RoleManagementTab.jsx - FIXED WITH USER COUNTS
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import RoleEditor from './RoleEditor';
import PermissionMatrix from './PermissionMatrix';
import { Users, Shield, Plus, Edit2, Trash2 } from 'lucide-react';

/** Shown in Roles & Access even when `role_templates` has no rows — matches add-employee / user_roles keys. */
const CORE_SYSTEM_ROLES = [
  {
    role_key: 'owner',
    role_name: 'Owner',
    description: 'Full business control. Assign sparingly.',
    is_system_role: true,
    color: '#0f766e',
    icon: '👑'
  },
  {
    role_key: 'admin',
    role_name: 'Admin',
    description: 'Broad operational access; typically below owner.',
    is_system_role: true,
    color: '#1d4ed8',
    icon: '🛡️'
  },
  {
    role_key: 'manager',
    role_name: 'Manager',
    description: 'Day-to-day leadership and most staff workflows.',
    is_system_role: true,
    color: '#7c3aed',
    icon: '👔'
  },
  {
    role_key: 'employee',
    role_name: 'Employee',
    description: 'Standard staff access (POS, tasks, etc. as permitted).',
    is_system_role: true,
    color: '#64748b',
    icon: '👤'
  }
];

function enrichRoleRow(roleRow, permissions, userCountByRole) {
  const key = roleRow.role_key;
  return {
    ...roleRow,
    role_permissions: (permissions || []).filter((p) => p.role_key === key),
    user_count: userCountByRole[key] || 0
  };
}

const RoleManagementTab = ({ businessId, styles }) => {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showRoleEditor, setShowRoleEditor] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [showPermissionMatrix, setShowPermissionMatrix] = useState(false);
  const [selectedRole, setSelectedRole] = useState(null);

  useEffect(() => {
    if (businessId) {
      loadRoles();
    }
  }, [businessId]);

  const loadRoles = async () => {
    try {
      setLoading(true);
      
      // Step 1: Load role templates
      const { data: roleTemplates, error: rolesError } = await supabase
        .from('role_templates')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: true });

      if (rolesError) throw rolesError;

      // Step 2: Load all permissions for this business
      const { data: permissions, error: permsError } = await supabase
        .from('role_permissions')
        .select('*')
        .eq('business_id', businessId);

      if (permsError) throw permsError;

      // Step 3: Count users for each role from user_roles table
      const { data: userRoles, error: userRolesError } = await supabase
        .from('user_roles')
        .select('role, user_id')
        .eq('business_id', businessId)
        .eq('active', true);

      if (userRolesError) {
        console.warn('Error loading user roles:', userRolesError);
      }

      // Count users per role
      const userCountByRole = {};
      if (userRoles) {
        userRoles.forEach(ur => {
          userCountByRole[ur.role] = (userCountByRole[ur.role] || 0) + 1;
        });
      }

      const templates = roleTemplates || [];
      const templateByKey = new Map();
      templates.forEach((t) => {
        if (t?.role_key) templateByKey.set(String(t.role_key).toLowerCase(), t);
      });

      const merged = [];

      // Always surface the four built-in keys first (use DB row when present)
      for (const def of CORE_SYSTEM_ROLES) {
        const db = templateByKey.get(def.role_key);
        if (db) {
          templateByKey.delete(def.role_key);
          merged.push(enrichRoleRow(db, permissions, userCountByRole));
        } else {
          merged.push(
            enrichRoleRow(
              {
                ...def,
                id: null,
                business_id: businessId,
                system_role_placeholder: true
              },
              permissions,
              userCountByRole
            )
          );
        }
      }

      // Any other templates (custom roles, or legacy keys not in the core four)
      const remainder = Array.from(templateByKey.values()).sort(
        (a, b) =>
          new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
      );
      remainder.forEach((row) => {
        merged.push(enrichRoleRow(row, permissions, userCountByRole));
      });

      setRoles(merged);
    } catch (err) {
      console.error('Error loading roles:', err);
      toast.error('Failed to load roles');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRole = () => {
    setEditingRole(null);
    setShowRoleEditor(true);
  };

  const handleEditRole = (role) => {
    setEditingRole(role);
    setShowRoleEditor(true);
  };

  const handleDeleteRole = async (role) => {
    if (!role.id) {
      toast.error('Built-in roles are not stored as templates and cannot be deleted here');
      return;
    }
    if (role.is_system_role) {
      toast.error('Cannot delete system roles');
      return;
    }

    if (!confirm(`Are you sure you want to delete the role "${role.role_name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      // Check if any users have this role
      const { data: userCount, error: countError } = await supabase
        .from('user_roles')
        .select('id', { count: 'exact' })
        .eq('business_id', businessId)
        .eq('role', role.role_key)
        .eq('active', true);

      if (countError) {
        console.warn('Could not check user count:', countError);
      }

      if (userCount && userCount.length > 0) {
        toast.error(`Cannot delete role that is assigned to ${userCount.length} user(s)`);
        return;
      }

      // Delete role permissions first
      const { error: permError } = await supabase
        .from('role_permissions')
        .delete()
        .eq('business_id', businessId)
        .eq('role_key', role.role_key);

      if (permError) {
        console.warn('Error deleting permissions:', permError);
      }

      // Delete role template
      const { error } = await supabase
        .from('role_templates')
        .delete()
        .eq('id', role.id);

      if (error) throw error;

      toast.success('Role deleted successfully');
      loadRoles();
    } catch (err) {
      console.error('Error deleting role:', err);
      toast.error('Failed to delete role');
    }
  };

  const handleManagePermissions = (role) => {
    setSelectedRole(role);
    setShowPermissionMatrix(true);
  };

  const handleRoleSaved = () => {
    setShowRoleEditor(false);
    setEditingRole(null);
    loadRoles();
  };

  const handlePermissionsSaved = () => {
    setShowPermissionMatrix(false);
    setSelectedRole(null);
    loadRoles();
  };

  if (loading) {
    return (
      <div style={styles.section}>
        <div style={localStyles.loading}>Loading roles...</div>
      </div>
    );
  }

  return (
    <>
      <div style={styles.section}>
        <div style={localStyles.roleHeader}>
          <div>
            <h3 style={styles.sectionTitle}>
              <Shield size={20} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
              Role Management
            </h3>
            <p style={styles.subtitle}>
              Built-in roles (Owner, Admin, Manager, Employee) always appear here so you can set permissions.
              Use &quot;Create Custom Role&quot; for additional roles. Job titles live in HR → Position Management.
            </p>
          </div>
          <button onClick={handleCreateRole} style={localStyles.primaryButton}>
            <Plus size={16} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
            Create Custom Role
          </button>
        </div>

        {roles.length === 0 ? (
          <div style={localStyles.emptyState}>
            <Shield size={48} style={{ color: '#9ca3af', marginBottom: '16px' }} />
            <p>No roles to show</p>
            <p style={{ fontSize: '14px', color: '#6b7280' }}>
              Select a business or try refreshing. Built-in roles should load automatically.
            </p>
          </div>
        ) : (
          <div style={localStyles.rolesGrid}>
            {roles.map((role) => (
              <div key={role.id || `core-${role.role_key}`} style={localStyles.roleCard}>
                <div style={localStyles.roleCardHeader}>
                  <div 
                    style={{
                      ...localStyles.roleIcon,
                      backgroundColor: role.color || '#008080'
                    }}
                  >
                    {role.icon || '👤'}
                  </div>
                  <div style={localStyles.roleInfo}>
                    <h4 style={localStyles.roleName}>{role.role_name}</h4>
                    <p style={localStyles.roleDescription}>{role.description || 'No description'}</p>
                  </div>
                  {role.is_system_role && (
                    <span style={localStyles.systemBadge}>System</span>
                  )}
                </div>

                <div style={localStyles.roleStats}>
                  <div style={localStyles.roleStat}>
                    <Users size={14} />
                    <span>{role.user_count} {role.user_count === 1 ? 'user' : 'users'}</span>
                  </div>
                  <div style={localStyles.roleStat}>
                    <Shield size={14} />
                    <span>{role.role_permissions?.length || 0} permissions</span>
                  </div>
                </div>

                <div style={localStyles.roleActions}>
                  <button
                    onClick={() => handleManagePermissions(role)}
                    style={localStyles.actionButton}
                    title="Manage Permissions"
                  >
                    <Shield size={16} />
                    Permissions
                  </button>
                  {!role.is_system_role && (
                    <>
                      <button
                        onClick={() => handleEditRole(role)}
                        style={localStyles.actionButton}
                        title="Edit Role"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteRole(role)}
                        style={localStyles.deleteButton}
                        title="Delete Role"
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Role Editor Modal */}
      {showRoleEditor && (
        <RoleEditor
          businessId={businessId}
          role={editingRole}
          onClose={() => {
            setShowRoleEditor(false);
            setEditingRole(null);
          }}
          onSave={handleRoleSaved}
          styles={styles}
        />
      )}

      {/* Permission Matrix Modal */}
      {showPermissionMatrix && selectedRole && (
        <PermissionMatrix
          businessId={businessId}
          role={selectedRole}
          onClose={() => {
            setShowPermissionMatrix(false);
            setSelectedRole(null);
          }}
          onSave={handlePermissionsSaved}
          styles={styles}
        />
      )}
    </>
  );
};

// Local styles specific to this component
const localStyles = {
  loading: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '40px',
    color: '#6b7280'
  },
  roleHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '30px'
  },
  primaryButton: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 20px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s'
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 20px',
    color: '#6b7280'
  },
  rolesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '20px',
    marginTop: '20px'
  },
  roleCard: {
    backgroundColor: '#f9fafb',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    padding: '20px',
    transition: 'all 0.2s ease'
  },
  roleCardHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    marginBottom: '16px'
  },
  roleIcon: {
    width: '48px',
    height: '48px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
    flexShrink: 0
  },
  roleInfo: {
    flex: 1,
    minWidth: 0
  },
  roleName: {
    margin: '0 0 4px 0',
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#1f2937'
  },
  roleDescription: {
    margin: 0,
    fontSize: '13px',
    color: '#6b7280',
    lineHeight: '1.4'
  },
  systemBadge: {
    padding: '2px 8px',
    backgroundColor: '#dbeafe',
    color: '#2563eb',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 'bold',
    textTransform: 'uppercase'
  },
  roleStats: {
    display: 'flex',
    gap: '16px',
    padding: '12px 0',
    borderTop: '1px solid #e5e7eb',
    borderBottom: '1px solid #e5e7eb',
    marginBottom: '12px'
  },
  roleStat: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    color: '#6b7280'
  },
  roleActions: {
    display: 'flex',
    gap: '8px'
  },
  actionButton: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    transition: 'all 0.2s ease'
  },
  deleteButton: {
    padding: '8px 12px',
    backgroundColor: '#dc2626',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }
};

export default RoleManagementTab;