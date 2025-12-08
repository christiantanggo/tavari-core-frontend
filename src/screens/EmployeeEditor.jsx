// src/screens/EmployeeEditor.jsx - WITH PERMISSION SYSTEM
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '/src/supabaseClient.js';
import SessionManager from '../components/SessionManager';
import bcrypt from 'bcryptjs';
import { TavariStyles } from '../utils/TavariStyles';
import POSAuthWrapper from '../components/Auth/POSAuthWrapper';
import { usePOSAuth } from '../hooks/usePOSAuth';
import { usePermissions } from '../hooks/usePermissions';
import { SecurityWrapper, useSecurityContext } from '../Security';
import PermissionGate from '../components/Auth/PermissionGate';
import toast from 'react-hot-toast';

const EmployeeEditor = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const availableRoles = ['customer', 'employee', 'keyholder', 'manager', 'admin', 'owner'];

  const [employee, setEmployee] = useState(null);
  const [editing, setEditing] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmFinal, setConfirmFinal] = useState(false);
  const [pinPrompt, setPinPrompt] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinEditMode, setPinEditMode] = useState(false);
  const [passwordEditMode, setPasswordEditMode] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(true);

  // Security context for sensitive employee data
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'EmployeeEditor',
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
    isManager,
    isOwner
  } = usePOSAuth({
    requiredRoles: ['manager', 'owner', 'admin'],
    requireBusiness: true,
    componentName: 'EmployeeEditor'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Permission checks
  const canViewEmployees = hasPermission('hr.employees.view') || hasElevatedPrivileges();
  const canEditEmployees = hasPermission('hr.employees.edit') || hasElevatedPrivileges();
  const canEditWages = hasPermission('hr.wages.edit') || isOwner();
  const canDeleteEmployees = hasPermission('hr.employees.delete') || isOwner();
  const canTerminateEmployees = hasPermission('hr.employees.terminate') || hasElevatedPrivileges();
  const canResetPins = hasPermission('hr.employees.reset_pin') || hasElevatedPrivileges();
  const canResetPasswords = hasPermission('hr.employees.reset_password') || hasElevatedPrivileges();

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewEmployees) {
      toast.error('You do not have permission to view employee details');
      navigate('/dashboard/employees');
    }
  }, [permissionsLoading, canViewEmployees]);

  useEffect(() => {
    if (selectedBusinessId && !authLoading && !permissionsLoading && canViewEmployees) {
      fetchEmployee();
    }
  }, [id, selectedBusinessId, authLoading, permissionsLoading, canViewEmployees]);

  const fetchEmployee = async () => {
    if (!selectedBusinessId) return;

    try {
      await recordAction('employee_view', id, true);
      
      console.log('[EmployeeEditor] Fetching employee data...', { id, selectedBusinessId });
      
      const { data, error } = await supabase
        .from('users')
        .select(`
          *,
          business_users!inner(business_id, role)
        `)
        .eq('id', id)
        .eq('business_users.business_id', selectedBusinessId)
        .single();

      if (error) {
        console.error('[EmployeeEditor] Error fetching employee:', error);
        throw error;
      }

      if (data) {
        console.log('[EmployeeEditor] Employee data loaded:', {
          id: data.id,
          name: data.full_name,
          business_users: data.business_users,
          role: data.business_users?.[0]?.role
        });
        setEmployee(data);
        await logSecurityEvent('employee_details_accessed', {
          employee_id: id,
          business_id: selectedBusinessId,
          viewer_role: userRole
        }, 'medium');
      }
    } catch (err) {
      console.error('[EmployeeEditor] Fetch employee error:', err);
      await logSecurityEvent('employee_fetch_error', {
        error: err.message,
        employee_id: id,
        business_id: selectedBusinessId
      }, 'high');
      toast.error('Failed to load employee details');
      navigate('/dashboard/employees');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field, value) => {
    if (!canEditEmployees) {
      toast.error('You do not have permission to edit employees');
      return;
    }

    // Wage editing requires special permission
    if (field === 'wage' && !canEditWages) {
      toast.error('You do not have permission to edit wages');
      return;
    }

    // Role editing requires special permission and validation
    if (field === 'role') {
      console.log('[EmployeeEditor] Role change initiated:', {
        oldRole: getEmployeeRole(),
        newRole: value,
        employeeId: employee?.id,
        authUserId: authUser?.id
      });
      
      // Prevent non-owners from assigning owner role
      if (value === 'owner' && !isOwner()) {
        toast.error('Only owners can assign the owner role');
        return;
      }
      // Prevent users from changing their own role
      if (employee?.id === authUser?.id) {
        toast.error('You cannot change your own role');
        return;
      }
      // Update the nested business_users role
      const updatedBusinessUsers = employee.business_users?.map((bu, idx) => 
        idx === 0 ? { ...bu, role: value } : bu
      ) || [{ business_id: selectedBusinessId, role: value }];
      
      console.log('[EmployeeEditor] Updated business_users:', updatedBusinessUsers);
      
      setEmployee({
        ...employee,
        business_users: updatedBusinessUsers
      });
      setEditing({ ...editing, [field]: true });
      
      console.log('[EmployeeEditor] Role change state updated, editing state:', { ...editing, [field]: true });
      return;
    }

    // Validate input
    const validation = validateInput(value, field, { required: false });
    if (!validation.isValid) {
      toast.error(validation.error);
      return;
    }

    setEmployee({ ...employee, [field]: value });
    setEditing({ ...editing, [field]: true });
  };

  const handleSave = async () => {
    console.log('[EmployeeEditor] ========== SAVE STARTED ==========');
    console.log('[EmployeeEditor] Editing state:', editing);
    console.log('[EmployeeEditor] Employee state:', employee);
    console.log('[EmployeeEditor] Current role:', getEmployeeRole());
    
    if (!canEditEmployees) {
      toast.error('You do not have permission to save changes');
      return;
    }

    // Rate limit check
    const rateLimitOk = await checkRateLimit('employee_save', 10, 60000);
    if (!rateLimitOk) {
      toast.error('Too many save attempts. Please wait a moment.');
      return;
    }

    try {
      await recordAction('employee_update', id, true);

      // Prepare user update data (exclude business_users from the update)
      const { business_users, ...userUpdateData } = employee;
      
      console.log('[EmployeeEditor] User update data (excluding business_users):', userUpdateData);
      console.log('[EmployeeEditor] Business users data:', business_users);
      
      // Update users table
      const { error: userError } = await supabase
        .from('users')
        .update(userUpdateData)
        .eq('id', id);

      if (userError) {
        console.error('[EmployeeEditor] Error updating users table:', userError);
        throw userError;
      }
      console.log('[EmployeeEditor] Successfully updated users table');

      // Check if role was changed - if editing.role is true, we need to update
      const roleNeedsUpdate = editing.role === true;
      
      console.log('[EmployeeEditor] Role change check:', {
        'editing.role': editing.role,
        'business_users[0].role': business_users?.[0]?.role,
        'roleNeedsUpdate': roleNeedsUpdate
      });

      // If role was changed, update business_users table
      if (roleNeedsUpdate && business_users?.[0]?.role) {
        const newRole = business_users[0].role;
        
        console.log('[EmployeeEditor] ========== UPDATING ROLE ==========');
        console.log('[EmployeeEditor] Updating role in business_users:', {
          user_id: id,
          business_id: selectedBusinessId,
          newRole
        });

        // Check if business_users record exists
        const { data: existingBU, error: checkError } = await supabase
          .from('business_users')
          .select('id, role')
          .eq('user_id', id)
          .eq('business_id', selectedBusinessId)
          .maybeSingle();

        console.log('[EmployeeEditor] Existing business_users record:', existingBU);
        
        if (checkError) {
          console.error('[EmployeeEditor] Error checking business_users:', checkError);
          throw checkError;
        }

        if (existingBU) {
          // Update existing record
          console.log('[EmployeeEditor] Updating existing business_users record:', existingBU.id);
          const { data: updateData, error: buError } = await supabase
            .from('business_users')
            .update({ role: newRole })
            .eq('user_id', id)
            .eq('business_id', selectedBusinessId)
            .select();

          if (buError) {
            console.error('[EmployeeEditor] Error updating business_users:', buError);
            console.error('[EmployeeEditor] Error details:', JSON.stringify(buError, null, 2));
            throw buError;
          }
          
          console.log('[EmployeeEditor] Update response:', { updateData, updateDataLength: updateData?.length });
          
          // Verify the update by querying the record again
          const { data: verifyData, error: verifyError } = await supabase
            .from('business_users')
            .select('id, role, user_id, business_id')
            .eq('user_id', id)
            .eq('business_id', selectedBusinessId)
            .maybeSingle();
            
          console.log('[EmployeeEditor] Verification query result:', verifyData);
          
          if (verifyError) {
            console.error('[EmployeeEditor] Error verifying update:', verifyError);
          } else if (verifyData && verifyData.role !== newRole) {
            console.error('[EmployeeEditor] WARNING: Role update did not persist!', {
              expected: newRole,
              actual: verifyData.role
            });
            throw new Error(`Role update failed: Expected ${newRole} but got ${verifyData.role}`);
          } else {
            console.log('[EmployeeEditor] ✅ Role update verified successfully:', verifyData);
          }
        } else {
          // Create new record if it doesn't exist
          console.log('[EmployeeEditor] Creating new business_users record');
          const { data: insertData, error: buError } = await supabase
            .from('business_users')
            .insert({
              user_id: id,
              business_id: selectedBusinessId,
              role: newRole
            })
            .select();

          if (buError) {
            console.error('[EmployeeEditor] Error creating business_users record:', buError);
            throw buError;
          }
          console.log('[EmployeeEditor] Successfully created business_users record:', insertData);
        }
      } else {
        console.log('[EmployeeEditor] Role was not changed, skipping business_users update');
      }

      await logSecurityEvent('employee_updated', {
        employee_id: id,
        business_id: selectedBusinessId,
        fields_updated: Object.keys(editing),
        updated_by: authUser?.id
      }, 'medium');

      // Reload employee data to get fresh business_users data
      console.log('[EmployeeEditor] Reloading employee data...');
      await fetchEmployee();
      
      setEditing({});
      console.log('[EmployeeEditor] ========== SAVE COMPLETE ==========');
      toast.success('Employee updated successfully');
    } catch (err) {
      console.error('[EmployeeEditor] ========== SAVE ERROR ==========');
      console.error('[EmployeeEditor] Save error:', err);
      await logSecurityEvent('employee_update_error', {
        error: err.message,
        employee_id: id
      }, 'high');
      toast.error(`Failed to update employee: ${err.message}`);
    }
  };

  const handleTerminate = async () => {
    if (!canTerminateEmployees) {
      toast.error('You do not have permission to terminate employees');
      return;
    }

    const rateLimitOk = await checkRateLimit('employee_terminate', 5, 300000);
    if (!rateLimitOk) {
      toast.error('Too many termination attempts. Please wait.');
      return;
    }

    try {
      await recordAction('employee_terminate', id, true);

      const { error } = await supabase
        .from('users')
        .update({ 
          employment_status: 'terminated',
          status: 'terminated',
          termination_date: new Date().toISOString().split('T')[0]
        })
        .eq('id', id);

      if (error) throw error;

      await logSecurityEvent('employee_terminated', {
        employee_id: id,
        business_id: selectedBusinessId,
        terminated_by: authUser?.id,
        termination_date: new Date().toISOString()
      }, 'high');

      setEmployee({
        ...employee, 
        employment_status: 'terminated',
        status: 'terminated'
      });

      toast.success('Employee marked as terminated');
    } catch (err) {
      await logSecurityEvent('employee_termination_error', {
        error: err.message,
        employee_id: id
      }, 'high');
      toast.error('Failed to terminate employee');
    }
  };

  const handleDelete = async () => {
    if (!canDeleteEmployees) {
      toast.error('You do not have permission to delete employees');
      return;
    }

    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    if (!confirmFinal) {
      setConfirmFinal(true);
      return;
    }

    if (!pinPrompt || pinPrompt.length < 4) {
      toast.error('Enter your PIN to confirm deletion');
      return;
    }

    const rateLimitOk = await checkRateLimit('employee_delete', 3, 300000);
    if (!rateLimitOk) {
      toast.error('Too many deletion attempts. Please wait.');
      return;
    }

    try {
      await recordAction('employee_delete_attempt', id, true);

      const { data: currentUser } = await supabase
        .from('users')
        .select('pin')
        .eq('id', authUser?.id)
        .single();

      if (!currentUser?.pin) {
        toast.error('Current user PIN not found');
        return;
      }

      const match = await bcrypt.compare(pinPrompt, currentUser.pin);
      if (!match) {
        await logSecurityEvent('employee_delete_incorrect_pin', {
          employee_id: id,
          attempt_by: authUser?.id
        }, 'high');
        toast.error('Incorrect PIN');
        return;
      }

      // Delete in correct order: user_roles → business_users → users
      // Step 1: Delete from user_roles first
      const { error: rolesError } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', id);

      if (rolesError) throw rolesError;

      // Step 2: Delete from business_users
      const { error: businessUserError } = await supabase
        .from('business_users')
        .delete()
        .eq('user_id', id);

      if (businessUserError) throw businessUserError;

      // Step 3: Delete from users
      const { error: userError } = await supabase
        .from('users')
        .delete()
        .eq('id', id);

      if (userError) throw userError;

      await logSecurityEvent('employee_deleted', {
        employee_id: id,
        business_id: selectedBusinessId,
        deleted_by: authUser?.id,
        employee_name: getEmployeeName()
      }, 'critical');

      toast.success('Employee permanently deleted');
      navigate('/dashboard/employees');
    } catch (err) {
      await logSecurityEvent('employee_deletion_error', {
        error: err.message,
        employee_id: id
      }, 'critical');
      toast.error('Failed to delete employee');
    }
  };

  const handlePinChange = async () => {
    if (!canResetPins) {
      toast.error('You do not have permission to reset PINs');
      return;
    }

    if (!pinPrompt || !newPin) {
      toast.error('Enter both current and new PIN');
      return;
    }

    if (newPin.length !== 4) {
      toast.error('PIN must be exactly 4 digits');
      return;
    }

    const rateLimitOk = await checkRateLimit('pin_reset', 5, 300000);
    if (!rateLimitOk) {
      toast.error('Too many PIN reset attempts. Please wait.');
      return;
    }

    try {
      await recordAction('employee_pin_reset_attempt', id, true);

      const { data: currentUser } = await supabase
        .from('users')
        .select('pin')
        .eq('id', authUser?.id)
        .single();

      if (!currentUser?.pin) {
        toast.error('Current user PIN not found');
        return;
      }

      const match = await bcrypt.compare(pinPrompt, currentUser.pin);
      if (!match) {
        await logSecurityEvent('pin_reset_incorrect_auth_pin', {
          employee_id: id,
          attempt_by: authUser?.id
        }, 'high');
        toast.error('Incorrect current PIN');
        return;
      }

      const hashed = await bcrypt.hash(newPin, 10);

      const { error } = await supabase
        .from('users')
        .update({ pin: hashed })
        .eq('id', id);

      if (error) throw error;

      await logSecurityEvent('employee_pin_reset', {
        employee_id: id,
        business_id: selectedBusinessId,
        reset_by: authUser?.id
      }, 'high');

      toast.success('PIN updated successfully');
      setNewPin('');
      setPinPrompt('');
      setPinEditMode(false);
    } catch (err) {
      await logSecurityEvent('pin_reset_error', {
        error: err.message,
        employee_id: id
      }, 'high');
      toast.error('Failed to update PIN');
    }
  };

  const handlePasswordChange = async () => {
    if (!canResetPasswords) {
      toast.error('You do not have permission to reset passwords');
      return;
    }

    if (!newPassword || !confirmPassword) {
      toast.error('Both password fields are required');
      return;
    }
  
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
  
    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
  
    if (!pinPrompt) {
      toast.error('Enter your PIN to confirm');
      return;
    }

    const rateLimitOk = await checkRateLimit('password_reset', 5, 300000);
    if (!rateLimitOk) {
      toast.error('Too many password reset attempts. Please wait.');
      return;
    }

    try {
      await recordAction('employee_password_reset_attempt', id, true);

      const { data: currentUser, error: userError } = await supabase
        .from('users')
        .select('pin')
        .eq('id', authUser?.id)
        .single();

      if (userError || !currentUser?.pin) {
        toast.error('Could not verify your PIN. Please try again.');
        return;
      }

      let pinValid = false;
    
      if (currentUser.pin.startsWith('$2b$') || currentUser.pin.startsWith('$2a$')) {
        pinValid = await bcrypt.compare(pinPrompt, currentUser.pin);
      } else {
        pinValid = String(pinPrompt).trim() === String(currentUser.pin).trim();
      }

      if (!pinValid) {
        await logSecurityEvent('password_reset_incorrect_auth_pin', {
          employee_id: id,
          attempt_by: authUser?.id
        }, 'high');
        toast.error('Incorrect PIN. Please try again.');
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
    
      if (!session) {
        toast.error('Not authenticated. Please log in again.');
        return;
      }

      console.log('[EmployeeEditor] Resetting password for:', employee.email);
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-reset-password`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
          },
          body: JSON.stringify({
            employee_email: employee.email,
            new_password: newPassword
          })
        }
      );

      let result;
      try {
        result = await response.json();
      } catch (parseError) {
        const text = await response.text();
        console.error('[EmployeeEditor] Failed to parse response:', text);
        throw new Error(`Password reset failed: ${response.status} ${response.statusText}`);
      }

      console.log('[EmployeeEditor] Password reset response:', { status: response.status, result });

      if (!response.ok) {
        const errorMessage = result?.error || result?.message || `Password reset failed: ${response.status}`;
        console.error('[EmployeeEditor] Password reset error:', errorMessage);
        throw new Error(errorMessage);
      }

      await logSecurityEvent('employee_password_reset', {
        employee_id: id,
        employee_email: employee.email,
        business_id: selectedBusinessId,
        reset_by: authUser?.id
      }, 'critical');

      toast.success(`Password successfully reset for ${employee.email}!`);
      setPasswordEditMode(false);
      setNewPassword('');
      setConfirmPassword('');
      setPinPrompt('');

    } catch (error) {
      await logSecurityEvent('password_reset_error', {
        error: error.message,
        employee_id: id
      }, 'critical');
      toast.error(`Failed to reset password: ${error.message}`);
    }
  };

  const getEmployeeName = () => {
    if (employee?.first_name && employee?.last_name) {
      return `${employee.first_name} ${employee.last_name}`;
    }
    return employee?.full_name || 'Unknown Employee';
  };

  const getEmployeeRole = () => {
    return employee?.business_users?.[0]?.role || 'employee';
  };

  if (loading || authLoading || permissionsLoading) {
    return (
      <SessionManager>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: '#f9fafb',
          paddingTop: '60px',
          paddingLeft: '20px',
          paddingRight: '20px',
          paddingBottom: '20px'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '32px',
              height: '32px',
              border: '3px solid #14B8A6',
              borderTop: '3px solid transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 8px auto'
            }}></div>
            <p style={{ 
              margin: 0, 
              color: '#6b7280',
              fontSize: '16px',
              fontWeight: '500'
            }}>
              Loading employee details...
            </p>
          </div>
        </div>
      </SessionManager>
    );
  }

  if (!canViewEmployees) {
    return (
      <SessionManager>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: '#f9fafb',
          paddingTop: '60px'
        }}>
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ color: '#374151', marginBottom: '16px' }}>Access Denied</h2>
            <p style={{ color: '#6b7280' }}>You do not have permission to view employee details</p>
          </div>
        </div>
      </SessionManager>
    );
  }

  if (!employee) {
    return (
      <SessionManager>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: '#f9fafb',
          paddingTop: '60px'
        }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#6b7280' }}>Employee not found</p>
          </div>
        </div>
      </SessionManager>
    );
  }

  const renderRow = (label, key, value, type = 'text') => {
    const isWageField = key === 'wage';
    const isEditable = canEditEmployees && (!isWageField || canEditWages);

    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        marginBottom: '20px',
        gap: '20px'
      }}>
        <div style={{
          fontWeight: '600',
          color: '#374151',
          minWidth: '200px',
          fontSize: '16px'
        }}>
          {label}
        </div>
        <div style={{ flex: 1 }}>
          <input
            type={type}
            value={value || ''}
            onChange={(e) => handleChange(key, e.target.value)}
            disabled={!isEditable}
            style={{
              width: '100%',
              padding: '12px 16px',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              fontSize: '16px',
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
              backgroundColor: !isEditable ? '#f9fafb' : 'white',
              cursor: !isEditable ? 'not-allowed' : 'text'
            }}
            onFocus={(e) => {
              if (isEditable) {
                e.target.style.borderColor = '#14B8A6';
                e.target.style.boxShadow = '0 0 0 3px rgba(20, 184, 166, 0.1)';
              }
            }}
            onBlur={(e) => {
              e.target.style.borderColor = '#d1d5db';
              e.target.style.boxShadow = 'none';
            }}
          />
        </div>
      </div>
    );
  };

  return (
    <POSAuthWrapper
      requiredRoles={['manager', 'owner', 'admin']}
      requireBusiness={true}
      componentName="EmployeeEditor"
    >
      <SessionManager>
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#f9fafb',
          paddingTop: '60px',
          paddingLeft: '20px',
          paddingRight: '20px',
          paddingBottom: '20px'
        }}>
          <style>
            {`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}
          </style>

          <div style={{
            maxWidth: '900px',
            margin: '0 auto'
          }}>
            {/* Header */}
            <div style={{ marginBottom: '30px' }}>
              <h1 style={{ 
                fontSize: '32px', 
                fontWeight: 'bold', 
                color: '#111827',
                margin: '0 0 8px 0'
              }}>
                Employee Editor
              </h1>
              <p style={{ 
                color: '#6b7280', 
                fontSize: '16px',
                margin: 0
              }}>
                Editing: {getEmployeeName()} • Role: {getEmployeeRole()}
              </p>
            </div>

            {/* Employee Information Card */}
            <div style={{
              backgroundColor: 'white',
              padding: '30px',
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
              marginBottom: '30px'
            }}>
              <h2 style={{
                fontSize: '24px',
                fontWeight: '600',
                color: '#111827',
                margin: '0 0 30px 0'
              }}>
                Basic Information
              </h2>

              {renderRow('Full Name', 'full_name', employee.full_name)}
              {renderRow('First Name', 'first_name', employee.first_name)}
              {renderRow('Last Name', 'last_name', employee.last_name)}
              {renderRow('Email Address', 'email', employee.email, 'email')}
              {renderRow('Phone Number', 'phone', employee.phone, 'tel')}
              {renderRow('Employee Number', 'employee_number', employee.employee_number)}
              {renderRow('Position/Title', 'position', employee.position)}
              {renderRow('Department', 'department', employee.department)}
              {renderRow('Hire Date', 'hire_date', employee.hire_date, 'date')}
              {renderRow('Wage (per hour)', 'wage', employee.wage, 'number')}

              <div style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: '20px',
                gap: '20px'
              }}>
                <div style={{
                  fontWeight: '600',
                  color: '#374151',
                  minWidth: '200px',
                  fontSize: '16px'
                }}>
                  Role
                </div>
                <div style={{ flex: 1 }}>
                  <select
                    value={getEmployeeRole()}
                    onChange={(e) => handleChange('role', e.target.value)}
                    disabled={!canEditEmployees || employee?.id === authUser?.id}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      border: '1px solid #d1d5db',
                      borderRadius: '8px',
                      fontSize: '16px',
                      outline: 'none',
                      boxSizing: 'border-box',
                      backgroundColor: (canEditEmployees && employee?.id !== authUser?.id) ? 'white' : '#f9fafb',
                      cursor: (canEditEmployees && employee?.id !== authUser?.id) ? 'pointer' : 'not-allowed'
                    }}
                  >
                    {availableRoles.map(role => (
                      <option key={role} value={role}>
                        {role.charAt(0).toUpperCase() + role.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: '20px',
                gap: '20px'
              }}>
                <div style={{
                  fontWeight: '600',
                  color: '#374151',
                  minWidth: '200px',
                  fontSize: '16px'
                }}>
                  Employment Status
                </div>
                <div style={{ flex: 1 }}>
                  <select
                    value={employee.employment_status || employee.status || 'active'}
                    onChange={(e) => handleChange('employment_status', e.target.value)}
                    disabled={!canEditEmployees}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      border: '1px solid #d1d5db',
                      borderRadius: '8px',
                      fontSize: '16px',
                      outline: 'none',
                      boxSizing: 'border-box',
                      backgroundColor: canEditEmployees ? 'white' : '#f9fafb',
                      cursor: canEditEmployees ? 'pointer' : 'not-allowed'
                    }}
                  >
                    <option value="active">Active</option>
                    <option value="terminated">Terminated</option>
                    <option value="on_leave">On Leave</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Security Settings Card */}
            <PermissionGate
              permissions={['hr.employees.reset_pin', 'hr.employees.reset_password']}
              requireAny
              fallback={null}
            >
              <div style={{
                backgroundColor: 'white',
                padding: '30px',
                borderRadius: '12px',
                border: '1px solid #e5e7eb',
                boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                marginBottom: '30px'
              }}>
                <h2 style={{
                  fontSize: '24px',
                  fontWeight: '600',
                  color: '#111827',
                  margin: '0 0 30px 0'
                }}>
                  Security Settings
                </h2>

                {/* PIN Section */}
                <PermissionGate permission="hr.employees.reset_pin" fallback={null}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: '30px',
                    gap: '20px'
                  }}>
                    <div style={{
                      fontWeight: '600',
                      color: '#374151',
                      minWidth: '200px',
                      fontSize: '16px'
                    }}>
                      PIN (requires your PIN)
                    </div>
                    <div style={{ flex: 1 }}>
                      {!pinEditMode ? (
                        <button 
                          onClick={() => setPinEditMode(true)}
                          style={{
                            padding: '12px 24px',
                            backgroundColor: 'white',
                            border: '2px solid #14B8A6',
                            color: '#374151',
                            borderRadius: '8px',
                            fontSize: '16px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            outline: 'none'
                          }}
                          onMouseOver={(e) => {
                            e.target.style.backgroundColor = '#f0fdfa';
                            e.target.style.color = '#0F766E';
                          }}
                          onMouseOut={(e) => {
                            e.target.style.backgroundColor = 'white';
                            e.target.style.color = '#374151';
                          }}
                        >
                          Edit PIN
                        </button>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <input
                            type="password"
                            placeholder="Your current PIN"
                            value={pinPrompt}
                            onChange={(e) => setPinPrompt(e.target.value)}
                            style={{
                              padding: '12px 16px',
                              border: '1px solid #d1d5db',
                              borderRadius: '8px',
                              fontSize: '16px',
                              outline: 'none',
                              boxSizing: 'border-box'
                            }}
                          />
                          <input
                            type="text"
                            placeholder="New 4-digit PIN"
                            value={newPin}
                            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                            maxLength={4}
                            style={{
                              padding: '12px 16px',
                              border: '1px solid #d1d5db',
                              borderRadius: '8px',
                              fontSize: '16px',
                              outline: 'none',
                              boxSizing: 'border-box'
                            }}
                          />
                          <div style={{ display: 'flex', gap: '12px' }}>
                            <button 
                              onClick={handlePinChange}
                              style={{
                                padding: '12px 24px',
                                backgroundColor: '#14B8A6',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '16px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                transition: 'background-color 0.2s ease',
                                outline: 'none'
                              }}
                              onMouseOver={(e) => e.target.style.backgroundColor = '#0F766E'}
                              onMouseOut={(e) => e.target.style.backgroundColor = '#14B8A6'}
                            >
                              Update PIN
                            </button>
                            <button 
                              onClick={() => {
                                setPinEditMode(false);
                                setPinPrompt('');
                                setNewPin('');
                              }}
                              style={{
                                padding: '12px 24px',
                                backgroundColor: '#6b7280',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '16px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                transition: 'background-color 0.2s ease',
                                outline: 'none'
                              }}
                              onMouseOver={(e) => e.target.style.backgroundColor = '#4b5563'}
                              onMouseOut={(e) => e.target.style.backgroundColor = '#6b7280'}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </PermissionGate>

                {/* Password Section */}
                <PermissionGate permission="hr.employees.reset_password" fallback={null}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: '20px',
                    gap: '20px'
                  }}>
                    <div style={{
                      fontWeight: '600',
                      color: '#374151',
                      minWidth: '200px',
                      fontSize: '16px'
                    }}>
                      Password (requires your PIN)
                    </div>
                    <div style={{ flex: 1 }}>
                      {!passwordEditMode ? (
                        <button 
                          onClick={() => setPasswordEditMode(true)}
                          style={{
                            padding: '12px 24px',
                            backgroundColor: 'white',
                            border: '2px solid #14B8A6',
                            color: '#374151',
                            borderRadius: '8px',
                            fontSize: '16px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            outline: 'none'
                          }}
                          onMouseOver={(e) => {
                            e.target.style.backgroundColor = '#f0fdfa';
                            e.target.style.color = '#0F766E';
                          }}
                          onMouseOut={(e) => {
                            e.target.style.backgroundColor = 'white';
                            e.target.style.color = '#374151';
                          }}
                        >
                          Change Password
                        </button>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <input
                            type="password"
                            placeholder="New Password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            style={{
                              padding: '12px 16px',
                              border: '1px solid #d1d5db',
                              borderRadius: '8px',
                              fontSize: '16px',
                              outline: 'none',
                              boxSizing: 'border-box'
                            }}
                          />
                          <input
                            type="password"
                            placeholder="Confirm Password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            style={{
                              padding: '12px 16px',
                              border: '1px solid #d1d5db',
                              borderRadius: '8px',
                              fontSize: '16px',
                              outline: 'none',
                              boxSizing: 'border-box'
                            }}
                          />
                          <input
                            type="password"
                            placeholder="Your PIN to confirm"
                            value={pinPrompt}
                            onChange={(e) => setPinPrompt(e.target.value)}
                            style={{
                              padding: '12px 16px',
                              border: '1px solid #d1d5db',
                              borderRadius: '8px',
                              fontSize: '16px',
                              outline: 'none',
                              boxSizing: 'border-box'
                            }}
                          />
                          <div style={{ display: 'flex', gap: '12px' }}>
                            <button 
                              onClick={handlePasswordChange}
                              style={{
                                padding: '12px 24px',
                                backgroundColor: '#14B8A6',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '16px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                transition: 'background-color 0.2s ease',
                                outline: 'none'
                              }}
                              onMouseOver={(e) => e.target.style.backgroundColor = '#0F766E'}
                              onMouseOut={(e) => e.target.style.backgroundColor = '#14B8A6'}
                            >
                              Update Password
                            </button>
                            <button 
                              onClick={() => {
                                setPasswordEditMode(false);
                                setNewPassword('');
                                setConfirmPassword('');
                                setPinPrompt('');
                              }}
                              style={{
                                padding: '12px 24px',
                                backgroundColor: '#6b7280',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '16px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                transition: 'background-color 0.2s ease',
                                outline: 'none'
                              }}
                              onMouseOver={(e) => e.target.style.backgroundColor = '#4b5563'}
                              onMouseOut={(e) => e.target.style.backgroundColor = '#6b7280'}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </PermissionGate>
              </div>
            </PermissionGate>

            {/* Actions */}
            <div style={{
              display: 'flex',
              gap: '16px',
              marginBottom: '30px',
              flexWrap: 'wrap'
            }}>
              {Object.keys(editing).length > 0 && canEditEmployees && (
                <button 
                  onClick={handleSave}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#14B8A6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s ease',
                    outline: 'none'
                  }}
                  onMouseOver={(e) => e.target.style.backgroundColor = '#0F766E'}
                  onMouseOut={(e) => e.target.style.backgroundColor = '#14B8A6'}
                >
                  Save Changes
                </button>
              )}
              
              <PermissionGate permission="hr.employees.terminate" fallback={null}>
                <button 
                  onClick={handleTerminate}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#f59e0b',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s ease',
                    outline: 'none'
                  }}
                  onMouseOver={(e) => e.target.style.backgroundColor = '#d97706'}
                  onMouseOut={(e) => e.target.style.backgroundColor = '#f59e0b'}
                >
                  Mark as Terminated
                </button>
              </PermissionGate>
              
              <PermissionGate permission="hr.employees.delete" requireOwner fallback={null}>
                <button 
                  onClick={handleDelete}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#ef4444',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s ease',
                    outline: 'none'
                  }}
                  onMouseOver={(e) => e.target.style.backgroundColor = '#dc2626'}
                  onMouseOut={(e) => e.target.style.backgroundColor = '#ef4444'}
                >
                  {confirmFinal ? 'Confirm & Delete' : confirmDelete ? 'Confirm Again' : 'Delete Employee'}
                </button>
              </PermissionGate>
            </div>

            {confirmFinal && (
              <div style={{
                backgroundColor: '#fee2e2',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                padding: '20px',
                marginBottom: '30px'
              }}>
                <h3 style={{
                  color: '#991b1b',
                  fontSize: '18px',
                  fontWeight: '600',
                  margin: '0 0 12px 0'
                }}>
                  Final Confirmation Required
                </h3>
                <p style={{
                  color: '#7f1d1d',
                  margin: '0 0 16px 0'
                }}>
                  This action cannot be undone. Please enter your PIN to permanently delete this employee.
                </p>
                <input
                  type="password"
                  placeholder="Enter your PIN to confirm"
                  value={pinPrompt}
                  onChange={(e) => setPinPrompt(e.target.value)}
                  style={{
                    padding: '12px 16px',
                    border: '1px solid #fca5a5',
                    borderRadius: '8px',
                    fontSize: '16px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    width: '200px'
                  }}
                />
              </div>
            )}

            {/* Back Button */}
            <button 
              onClick={() => navigate('/dashboard/employees')}
              style={{
                padding: '12px 24px',
                backgroundColor: 'white',
                border: '2px solid #14B8A6',
                color: '#374151',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                outline: 'none'
              }}
              onMouseOver={(e) => {
                e.target.style.backgroundColor = '#f0fdfa';
                e.target.style.color = '#0F766E';
              }}
              onMouseOut={(e) => {
                e.target.style.backgroundColor = 'white';
                e.target.style.color = '#374151';
              }}
            >
              ← Back to Employee List
            </button>
          </div>
        </div>
      </SessionManager>
    </POSAuthWrapper>
  );
};

export default EmployeeEditor;