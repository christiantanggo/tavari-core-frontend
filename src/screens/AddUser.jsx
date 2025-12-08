// screens/AddUser.jsx - WITH PERMISSION SYSTEM + NO CONSOLE LOGGING
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import toast from 'react-hot-toast';

// Security & Authentication
import { SecurityWrapper, useSecurityContext } from '../Security';
import { useUserProfile } from '../hooks/useUserProfile';
import useAccessProtection from '../hooks/useAccessProtection';
import { usePermissions } from '../hooks/usePermissions';
import PermissionGate from '../components/Auth/PermissionGate';

// Foundation Components
import SessionManager from '../components/SessionManager';
import { TavariStyles } from '../utils/TavariStyles';

const AddUser = () => {
  useAccessProtection();
  const navigate = useNavigate();
  const { profile } = useUserProfile();

  // Security context for sensitive user creation operations
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'AddUser',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    isOwner,
    isManager,
    loading: permissionsLoading 
  } = usePermissions();

  // Permission checks
  const canCreateUsers = hasPermission('user.create') || hasElevatedPrivileges();
  const canAssignRoles = hasPermission('user.assign_roles') || hasElevatedPrivileges();
  const canViewBusinesses = hasPermission('business.view') || hasElevatedPrivileges();

  const [businesses, setBusinesses] = useState([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    phone: '',
    password: '',
    pin_code: '',
    role: 'employee',
    start_date: '',
    end_date: ''
  });

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canCreateUsers) {
      toast.error('You do not have permission to create users');
      navigate('/dashboard');
    }
  }, [permissionsLoading, canCreateUsers, navigate]);

  // Log initial access
  useEffect(() => {
    if (profile?.id && canCreateUsers) {
      logInitialAccess();
    }
  }, [profile?.id, canCreateUsers]);

  const logInitialAccess = async () => {
    try {
      await logSecurityEvent('add_user_screen_accessed', {
        action: 'add_user_screen_loaded',
        user_id: profile?.id,
        timestamp: new Date().toISOString()
      }, 'medium');

      await recordAction('add_user_screen_accessed', profile?.id, true);
    } catch (err) {
      // Silent fail on logging
    }
  };

  useEffect(() => {
    const fetchBusinesses = async () => {
      if (!canViewBusinesses) {
        toast.error('You do not have permission to view businesses');
        return;
      }

      try {
        await logSecurityEvent('businesses_load_attempt', {
          action: 'load_user_businesses',
          user_id: profile?.id
        }, 'low');

        const { data, error } = await supabase
          .from('user_roles')
          .select('business_id, businesses(name)')
          .eq('user_id', profile?.id)
          .eq('role', 'owner')
          .eq('active', true);

        if (error) throw error;

        if (data) {
          const mapped = data.map(r => ({
            id: r.business_id,
            name: r.businesses.name
          }));
          setBusinesses(mapped);

          const storedBusinessId = localStorage.getItem('currentBusinessId');
          if (storedBusinessId && mapped.find(b => b.id === storedBusinessId)) {
            setSelectedBusinessId(storedBusinessId);
          } else if (mapped.length === 1) {
            setSelectedBusinessId(mapped[0].id);
          }

          await logSecurityEvent('businesses_loaded', {
            action: 'load_user_businesses_success',
            user_id: profile?.id,
            business_count: mapped.length
          }, 'low');
        }
      } catch (err) {
        await logSecurityEvent('businesses_load_error', {
          action: 'load_user_businesses_failed',
          user_id: profile?.id,
          error_message: err.message
        }, 'medium');
        
        toast.error('Failed to load businesses');
      }
    };

    if (profile?.id && canViewBusinesses) {
      fetchBusinesses();
    }
  }, [profile, canViewBusinesses]);

  const handleChange = async (e) => {
    const { name, value } = e.target;

    // Validate input based on field type
    if (value.length > 0) {
      let fieldType = 'text';
      if (name === 'email') fieldType = 'email';
      if (name === 'phone') fieldType = 'phone';
      if (name === 'pin_code') fieldType = 'text';

      const validation = await validateInput(value, fieldType, name);
      if (!validation.valid) {
        // Log validation warning but don't block input
        await logSecurityEvent('input_validation_warning', {
          action: 'input_validation_failed',
          field: name,
          user_id: profile?.id
        }, 'low');
      }
    }

    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleCancel = async () => {
    await logSecurityEvent('add_user_cancelled', {
      action: 'user_creation_cancelled',
      user_id: profile?.id
    }, 'low');

    navigate(-1);
  };

  const handleCreate = async () => {
    if (!canCreateUsers) {
      toast.error('You do not have permission to create users');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Rate limit check
      const rateLimitCheck = await checkRateLimit('create_user');
      if (!rateLimitCheck.allowed) {
        toast.error('Too many requests. Please wait a moment.');
        setLoading(false);
        return;
      }

      // Validate all required fields
      if (!formData.full_name || !formData.email || !formData.password) {
        throw new Error('Please fill in all required fields');
      }

      // Validate email
      const emailValidation = await validateInput(formData.email, 'email', 'email');
      if (!emailValidation.valid) {
        throw new Error('Invalid email address');
      }

      // Validate phone if provided
      if (formData.phone) {
        const phoneValidation = await validateInput(formData.phone, 'phone', 'phone');
        if (!phoneValidation.valid) {
          throw new Error('Invalid phone number');
        }
      }

      // Validate PIN if provided
      if (formData.pin_code && (formData.pin_code.length !== 4 || !/^\d{4}$/.test(formData.pin_code))) {
        throw new Error('PIN must be exactly 4 digits');
      }

      // Validate password strength
      if (formData.password.length < 8) {
        throw new Error('Password must be at least 8 characters long');
      }

      // Check role assignment permission
      if (!canAssignRoles && formData.role !== 'employee') {
        throw new Error('You do not have permission to assign manager or admin roles');
      }

      await logSecurityEvent('user_creation_initiated', {
        action: 'create_user_started',
        creator_id: profile?.id,
        new_user_email: formData.email,
        new_user_role: formData.role,
        business_id: selectedBusinessId
      }, 'high');

      // Step 1: Create Auth User
      const { data: signUpResult, error: signUpError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password
      });

      if (signUpError) {
        throw new Error('Error creating user: ' + signUpError.message);
      }

      const userId = signUpResult?.user?.id;
      if (!userId) {
        throw new Error('User was not created');
      }

      // Step 2: Insert into 'users' table
      const { error: userInsertError } = await supabase.from('users').insert({
        id: userId,
        full_name: formData.full_name,
        email: formData.email,
        phone: formData.phone,
        pin: formData.pin_code || null,
        roles: [formData.role],
        start_date: formData.start_date || null,
        end_date: formData.end_date || null,
        status: 'active',
        business_id: selectedBusinessId
      });

      if (userInsertError) {
        throw new Error('Error inserting user data: ' + userInsertError.message);
      }

      // Step 3: Insert into 'user_roles' table
      const { error: roleInsertError } = await supabase.from('user_roles').insert({
        user_id: userId,
        business_id: selectedBusinessId,
        role: formData.role,
        active: true
      });

      if (roleInsertError) {
        throw new Error('Error assigning user role: ' + roleInsertError.message);
      }

      await recordAction('user_created', userId, true);
      await logSecurityEvent('user_created', {
        action: 'create_user_success',
        creator_id: profile?.id,
        new_user_id: userId,
        new_user_email: formData.email,
        new_user_role: formData.role,
        business_id: selectedBusinessId
      }, 'high');

      toast.success('User created successfully');
      navigate(-1);

    } catch (error) {
      await logSecurityEvent('user_creation_error', {
        action: 'create_user_failed',
        creator_id: profile?.id,
        error_message: error.message,
        attempted_email: formData.email
      }, 'high');

      setError(error.message);
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const styles = {
    container: {
      padding: TavariStyles.spacing.xl,
      maxWidth: '500px',
      margin: '0 auto'
    },
    header: {
      marginBottom: TavariStyles.spacing.xl
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.sm
    },
    form: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.lg
    },
    formGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.sm
    },
    label: {
      ...TavariStyles.components.form.label
    },
    input: {
      ...TavariStyles.components.form.input
    },
    select: {
      ...TavariStyles.components.form.select
    },
    buttonGroup: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.xl
    },
    submitButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      flex: 1
    },
    cancelButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      flex: 1
    },
    error: {
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.errorBg,
      color: TavariStyles.colors.errorText,
      borderRadius: TavariStyles.borderRadius.md,
      marginBottom: TavariStyles.spacing.lg
    },
    infoBox: {
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.infoBg,
      color: TavariStyles.colors.infoText,
      borderRadius: TavariStyles.borderRadius.md,
      marginBottom: TavariStyles.spacing.lg,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    accessDenied: {
      padding: '40px',
      textAlign: 'center',
      color: TavariStyles.colors.danger
    }
  };

  if (permissionsLoading) {
    return (
      <SecurityWrapper componentName="AddUser" sensitiveComponent={true} securityLevel="high">
        <SessionManager>
          <div style={styles.container}>
            <div style={TavariStyles.components.loading.container}>
              <div style={TavariStyles.components.loading.spinner}></div>
              <div>Loading...</div>
              <style>{TavariStyles.keyframes.spin}</style>
            </div>
          </div>
        </SessionManager>
      </SecurityWrapper>
    );
  }

  if (!canCreateUsers) {
    return (
      <SecurityWrapper componentName="AddUser" sensitiveComponent={true} securityLevel="high">
        <SessionManager>
          <div style={styles.container}>
            <div style={styles.accessDenied}>
              <h2>Access Denied</h2>
              <p>You do not have permission to create users.</p>
            </div>
          </div>
        </SessionManager>
      </SecurityWrapper>
    );
  }

  if (!selectedBusinessId) {
    return (
      <SecurityWrapper componentName="AddUser" sensitiveComponent={true} securityLevel="high">
        <SessionManager>
          <div style={styles.container}>
            <div style={styles.infoBox}>
              Please select or create a business before adding users.
            </div>
          </div>
        </SessionManager>
      </SecurityWrapper>
    );
  }

  return (
    <SecurityWrapper componentName="AddUser" sensitiveComponent={true} securityLevel="high">
      <SessionManager>
        <div style={styles.container}>
          <div style={styles.header}>
            <h2 style={styles.title}>Add New User</h2>
          </div>

          {error && (
            <div style={styles.error}>
              {error}
            </div>
          )}

          <form style={styles.form} onSubmit={(e) => { e.preventDefault(); handleCreate(); }}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Full Name *</label>
              <input
                type="text"
                name="full_name"
                value={formData.full_name}
                onChange={handleChange}
                style={styles.input}
                placeholder="Enter full name"
                required
                disabled={loading}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Email *</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                style={styles.input}
                placeholder="Enter email address"
                required
                disabled={loading}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Phone</label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                style={styles.input}
                placeholder="Enter phone number"
                disabled={loading}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Password *</label>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                style={styles.input}
                placeholder="Minimum 8 characters"
                required
                disabled={loading}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>4-Digit PIN (Optional)</label>
              <input
                type="text"
                name="pin_code"
                value={formData.pin_code}
                onChange={handleChange}
                style={styles.input}
                placeholder="Enter 4-digit PIN"
                maxLength="4"
                pattern="\d{4}"
                disabled={loading}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Business</label>
              <select 
                value={selectedBusinessId} 
                onChange={(e) => setSelectedBusinessId(e.target.value)}
                style={styles.select}
                disabled={loading}
              >
                <option value="">Select Business</option>
                {businesses.map((biz) => (
                  <option key={biz.id} value={biz.id}>{biz.name}</option>
                ))}
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Role</label>
              <select 
                name="role" 
                value={formData.role} 
                onChange={handleChange}
                style={styles.select}
                disabled={loading || !canAssignRoles}
              >
                <option value="employee">Employee</option>
                {canAssignRoles && (
                  <>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </>
                )}
              </select>
              {!canAssignRoles && (
                <small style={{ color: TavariStyles.colors.gray500, fontSize: TavariStyles.typography.fontSize.xs }}>
                  You can only create employee accounts
                </small>
              )}
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Start Date</label>
              <input 
                type="date" 
                name="start_date" 
                value={formData.start_date} 
                onChange={handleChange}
                style={styles.input}
                disabled={loading}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>End Date</label>
              <input 
                type="date" 
                name="end_date" 
                value={formData.end_date} 
                onChange={handleChange}
                style={styles.input}
                disabled={loading}
              />
            </div>

            <div style={styles.buttonGroup}>
              <button 
                type="submit" 
                style={styles.submitButton}
                disabled={loading}
              >
                {loading ? 'Creating User...' : 'Create User'}
              </button>
              <button 
                type="button"
                onClick={handleCancel}
                style={styles.cancelButton}
                disabled={loading}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </SessionManager>
    </SecurityWrapper>
  );
};

export default AddUser;