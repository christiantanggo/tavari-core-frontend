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
import FixEmployeeAuthModal from '../components/HR/FixEmployeeAuthModal';
import PositionSelectWithNew from '../components/HR/PositionSelectWithNew';
import { updateBusinessEmploymentStatus } from '../utils/businessEmploymentStatus';
import AddPositionModal from '../components/HR/AddPositionModal';
import {
  FALLBACK_BUSINESS_ROLE_KEYS,
  formatRoleLabel,
  resolveCanonicalRoleKey,
  rolesAreEquivalentKeys,
} from '../helpers/businessRoleKeys';

const EDITOR_MOBILE_MQ = '(max-width: 768px)';

function normalizeAuthEmail(email) {
  return (email || '').trim().toLowerCase();
}

/** public.users row for the signed-in operator (JWT email may map to a different id than auth.uid()). */
async function fetchOperatorPublicUserRow(supabaseClient, authUser) {
  const em = normalizeAuthEmail(authUser?.email);
  if (em) {
    const { data, error } = await supabaseClient
      .from('users')
      .select('id, pin')
      .eq('email', em)
      .maybeSingle();
    if (!error && data) return data;
  }
  if (authUser?.id) {
    const { data, error } = await supabaseClient
      .from('users')
      .select('id, pin')
      .eq('id', authUser.id)
      .maybeSingle();
    if (!error && data) return data;
  }
  return null;
}

const EmployeeEditor = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [employee, setEmployee] = useState(null);
  const [roleOptionKeys, setRoleOptionKeys] = useState(FALLBACK_BUSINESS_ROLE_KEYS);
  const [originalEmployee, setOriginalEmployee] = useState(null); // Store original employee data to compare changes
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
  const [showFixAuthModal, setShowFixAuthModal] = useState(false);
  const [showAddPositionModal, setShowAddPositionModal] = useState(false);
  const [positionSelectRemountKey, setPositionSelectRemountKey] = useState(0);
  /** public.users.id for the logged-in person (may differ from authUser.id). */
  const [operatorPublicUserId, setOperatorPublicUserId] = useState(null);

  const [isNarrowViewport, setIsNarrowViewport] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(EDITOR_MOBILE_MQ).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(EDITOR_MOBILE_MQ);
    const onChange = () => setIsNarrowViewport(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!authUser?.id) {
        setOperatorPublicUserId(null);
        return;
      }
      const row = await fetchOperatorPublicUserRow(supabase, authUser);
      if (!cancelled) {
        setOperatorPublicUserId(row?.id ?? authUser.id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authUser]);

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

    // Validate that id is a valid UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!id || !uuidRegex.test(id)) {
      console.warn('[EmployeeEditor] Invalid employee ID format:', id);
      console.log('[EmployeeEditor] Redirecting to employees list - invalid ID');
      toast.error('Invalid employee ID');
      navigate('/dashboard/employees');
      return;
    }

    try {
      await recordAction('employee_view', true, id);
      
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
        const { data: permRows } = await supabase
          .from('role_permissions')
          .select('role_key')
          .eq('business_id', selectedBusinessId);

        const uniqueKeys = Array.from(
          new Set((permRows || []).map((r) => r.role_key).filter(Boolean))
        ).sort();
        const permissionKeys = uniqueKeys.length ? uniqueKeys : FALLBACK_BUSINESS_ROLE_KEYS;
        setRoleOptionKeys(permissionKeys);

        // Permissions and HR profiles read role from user_roles first; keep UI aligned with that source.
        const { data: userRoleRow } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', id)
          .eq('business_id', selectedBusinessId)
          .eq('active', true)
          .maybeSingle();

        const buFirst = data.business_users?.[0] || {};
        const rawEffective = userRoleRow?.role ?? buFirst.role ?? 'employee';
        const effectiveRole = resolveCanonicalRoleKey(rawEffective, permissionKeys);

        const normalized = {
          ...data,
          business_users: [{ ...buFirst, role: effectiveRole }],
        };

        // Persist canonical spelling when DB only differs by synonym (e.g. keyholder vs key_holder).
        try {
          if (
            userRoleRow?.role &&
            userRoleRow.role !== effectiveRole &&
            rolesAreEquivalentKeys(userRoleRow.role, effectiveRole)
          ) {
            await supabase
              .from('user_roles')
              .update({ role: effectiveRole })
              .eq('user_id', id)
              .eq('business_id', selectedBusinessId);
          }
          if (
            buFirst.role != null &&
            buFirst.role !== effectiveRole &&
            rolesAreEquivalentKeys(buFirst.role, effectiveRole)
          ) {
            await supabase
              .from('business_users')
              .update({ role: effectiveRole })
              .eq('user_id', id)
              .eq('business_id', selectedBusinessId);
          }
        } catch (syncErr) {
          console.warn('[EmployeeEditor] Role spelling sync skipped:', syncErr?.message || syncErr);
        }

        console.log('[EmployeeEditor] Employee data loaded:', {
          id: data.id,
          name: data.full_name,
          business_users: normalized.business_users,
          role: effectiveRole,
          user_roles_role: userRoleRow?.role,
          business_users_role_before: buFirst.role,
          permission_role_keys: permissionKeys,
        });
        setEmployee(normalized);
        setOriginalEmployee({ ...normalized }); // Store original data for comparison
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

  const handleChange = async (field, value) => {
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
      if (employee?.id === (operatorPublicUserId ?? authUser?.id)) {
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

    // Validate input based on field type
    // For number fields, validate as numeric; for other fields, use text validation
    const numberFields = ['wage', 'additional_tax_per_period', 'max_paid_hours_per_period'];
    const isNumberField = numberFields.includes(field);
    
    // Allow empty values for number fields (user might be clearing/typing)
    if (isNumberField && (value === '' || value === null || value === undefined)) {
      setEmployee({ ...employee, [field]: null });
      setEditing({ ...editing, [field]: true });
      return;
    }
    
    try {
      // For number fields, validate as numeric
      if (isNumberField) {
        const numValue = parseFloat(value);
        if (isNaN(numValue)) {
          console.warn('[EmployeeEditor] Invalid number value for', field, ':', value);
          // Don't show error toast while typing - allow user to continue
          // Only validate on blur or when they try to save
          setEmployee({ ...employee, [field]: value });
          setEditing({ ...editing, [field]: true });
          return;
        }
        
        if (numValue < 0) {
          toast.error(`${field === 'wage' ? 'Wage' : field === 'additional_tax_per_period' ? 'Additional tax' : field} cannot be negative`);
          return;
        }
        
        // For additional_tax_per_period, allow reasonable values (0 to 50000 per period)
        if (field === 'additional_tax_per_period' && numValue > 50000) {
          toast.error('Additional tax per period seems unusually high. Please verify.');
          // Still allow it, but warn the user
        }
        
        console.log(`[EmployeeEditor] Setting ${field} to:`, numValue, '(type:', typeof numValue, ')');
        setEmployee({ ...employee, [field]: numValue });
      } else {
        // For text fields, validate using security context
        const validationType = field === 'email' ? 'email' : field === 'phone' ? 'phone' : 'text';
        
        // For email and phone, allow typing freely — validate on blur or save
        if (field === 'email' || field === 'phone') {
          setEmployee({ ...employee, [field]: value });
        } else {
          // For other text fields, use full validation
          const validation = await validateInput(value ?? '', validationType, field);
          if (validation.valid === false) {
            console.error('[EmployeeEditor] Validation failed for', field, ':', validation.error);
            toast.error(validation.error || 'Invalid value');
            return;
          }
          setEmployee({ ...employee, [field]: validation.sanitized ?? value });
        }
      }
      setEditing({ ...editing, [field]: true });
    } catch (error) {
      console.error('[EmployeeEditor] Validation error for', field, ':', error);
      // If validation fails unexpectedly, still allow the change but log the error
      // This prevents blocking legitimate input due to validation bugs
      setEmployee({ ...employee, [field]: value });
      setEditing({ ...editing, [field]: true });
    }
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
    const rateLimitOk = await checkRateLimit('save_employee');
    if (!rateLimitOk?.allowed) {
      toast.error('Too many save attempts. Please wait a moment.');
      return;
    }

    try {
      await recordAction('employee_update', true, id);

      if (employee.phone && String(employee.phone).trim()) {
        const phoneValidation = await validateInput(String(employee.phone).trim(), 'phone', 'phone');
        if (phoneValidation.valid === false) {
          toast.error(phoneValidation.error || 'Invalid phone number');
          return;
        }
      }

      // Prepare user update data (exclude business_users from the update)
      const { business_users, ...userUpdateData } = employee;
      
      console.log('[EmployeeEditor] User update data (excluding business_users):', userUpdateData);
      console.log('[EmployeeEditor] Additional tax per period in update:', userUpdateData.additional_tax_per_period, '(type:', typeof userUpdateData.additional_tax_per_period, ')');
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

      // Note: If email was changed, the auth account email will need to be updated separately
      // using the "Fix Auth" modal or by an admin. This is intentional to prevent accidental
      // auth account issues. The users table email is updated above.

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

        // Keep user_roles in sync — when present, this row drives permissions (usePermissions / usePOSAuth).
        const { data: existingUr, error: urSelectErr } = await supabase
          .from('user_roles')
          .select('id')
          .eq('user_id', id)
          .eq('business_id', selectedBusinessId)
          .maybeSingle();

        if (urSelectErr) {
          console.error('[EmployeeEditor] Error checking user_roles:', urSelectErr);
          throw urSelectErr;
        }

        if (existingUr) {
          const { error: urUpdateErr } = await supabase
            .from('user_roles')
            .update({ role: newRole })
            .eq('user_id', id)
            .eq('business_id', selectedBusinessId);

          if (urUpdateErr) {
            console.error('[EmployeeEditor] Error updating user_roles:', urUpdateErr);
            throw urUpdateErr;
          }
        } else {
          const { error: urInsertErr } = await supabase
            .from('user_roles')
            .insert({
              user_id: id,
              business_id: selectedBusinessId,
              role: newRole,
              active: true,
            });

          if (urInsertErr) {
            console.error('[EmployeeEditor] Error inserting user_roles:', urInsertErr);
            throw urInsertErr;
          }
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
      setOriginalEmployee(employee); // Update original employee data after successful save
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

    const rateLimitOk = await checkRateLimit('employee_terminate');
    if (!rateLimitOk?.allowed) {
      toast.error('Too many termination attempts. Please wait.');
      return;
    }

    try {
      console.log('[EmployeeEditor] Attempting to terminate employee:', {
        employee_id: id,
        employee_email: employee?.email,
        business_id: selectedBusinessId
      });

      await recordAction('employee_terminate', true, id);

      const terminationDay = new Date().toISOString().split('T')[0];
      const { data: updateResult, error } = await updateBusinessEmploymentStatus(supabase, {
        userId: id,
        businessId: selectedBusinessId,
        employment_status: 'terminated',
        termination_date: terminationDay,
      });

      if (error) {
        console.error('[EmployeeEditor] Error terminating employee:', {
          error,
          employee_id: id,
          employee_email: employee?.email,
        });
        throw error;
      }

      if (!updateResult) {
        console.warn('[EmployeeEditor] Termination update returned no rows. Employee ID may not exist:', id);
        throw new Error('Employee membership not found for this business.');
      }

      console.log('[EmployeeEditor] Employee terminated successfully:', updateResult);

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
      console.error('[EmployeeEditor] Exception terminating employee:', {
        error: err,
        message: err.message,
        stack: err.stack,
        employee_id: id,
        employee_email: employee?.email
      });
      await logSecurityEvent('employee_termination_error', {
        error: err.message,
        employee_id: id,
        error_details: JSON.stringify(err)
      }, 'high');
      toast.error(`Failed to terminate employee: ${err.message || 'Unknown error'}`);
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

    const rateLimitOk = await checkRateLimit('delete_employee');
    if (!rateLimitOk?.allowed) {
      toast.error('Too many deletion attempts. Please wait.');
      return;
    }

    if (!selectedBusinessId) {
      toast.error('No business selected');
      return;
    }

    if (String(id) === String(operatorPublicUserId ?? authUser?.id)) {
      toast.error('You cannot remove your own account from the roster here.');
      return;
    }

    try {
      await recordAction('employee_delete_attempt', true, id);

      const operatorRow = await fetchOperatorPublicUserRow(supabase, authUser);
      if (!operatorRow?.pin) {
        toast.error('Current user PIN not found');
        return;
      }

      const match = await bcrypt.compare(pinPrompt, operatorRow.pin);
      if (!match) {
        await logSecurityEvent('employee_delete_incorrect_pin', {
          employee_id: id,
          attempt_by: authUser?.id
        }, 'high');
        toast.error('Incorrect PIN');
        return;
      }

      // RLS often blocks direct DELETE on user_roles/business_users; use SECURITY DEFINER RPC
      const { data: rpcResult, error: rpcError } = await supabase.rpc('remove_employee_from_business', {
        p_target_user_id: id,
        p_business_id: selectedBusinessId
      });

      if (rpcError) throw rpcError;

      const removedCount =
        (rpcResult?.user_roles_deleted != null ? Number(rpcResult.user_roles_deleted) : 0) +
        (rpcResult?.business_users_deleted != null ? Number(rpcResult.business_users_deleted) : 0);

      if (!rpcResult?.ok || removedCount === 0) {
        throw new Error(
          'No roster rows were removed. The employee may not belong to this business, or they were already removed.'
        );
      }

      await logSecurityEvent('employee_deleted', {
        employee_id: id,
        business_id: selectedBusinessId,
        deleted_by: authUser?.id,
        employee_name: getEmployeeName(),
        user_roles_removed: rpcResult?.user_roles_deleted ?? 0,
        business_users_removed: rpcResult?.business_users_deleted ?? 0,
      }, 'critical');

      toast.success(`${getEmployeeName() || 'Employee'} removed from this business.`);
      navigate('/dashboard/employees');
    } catch (err) {
      await logSecurityEvent('employee_deletion_error', {
        error: err.message,
        employee_id: id
      }, 'critical');
      toast.error(`Failed to remove employee: ${err.message || 'Unknown error'}`);
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

    const rateLimitOk = await checkRateLimit('pin_reset');
    if (!rateLimitOk?.allowed) {
      toast.error('Too many PIN reset attempts. Please wait.');
      return;
    }

    try {
      await recordAction('employee_pin_reset_attempt', true, id);

      const operatorRow = await fetchOperatorPublicUserRow(supabase, authUser);
      if (!operatorRow?.pin) {
        toast.error('Current user PIN not found');
        return;
      }

      const match = await bcrypt.compare(pinPrompt, operatorRow.pin);
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

    const rateLimitOk = await checkRateLimit('password_reset');
    if (!rateLimitOk?.allowed) {
      toast.error('Too many password reset attempts. Please wait.');
      return;
    }

    try {
      await recordAction('employee_password_reset_attempt', true, id);

      const operatorRow = await fetchOperatorPublicUserRow(supabase, authUser);
      if (!operatorRow?.pin) {
        toast.error('Could not verify your PIN. Please try again.');
        return;
      }

      let pinValid = false;
    
      if (operatorRow.pin.startsWith('$2b$') || operatorRow.pin.startsWith('$2a$')) {
        pinValid = await bcrypt.compare(pinPrompt, operatorRow.pin);
      } else {
        pinValid = String(pinPrompt).trim() === String(operatorRow.pin).trim();
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
        
        // Check if error is due to missing auth account
        if (errorMessage.includes('No auth account found') || errorMessage.includes('Use "Fix Auth"')) {
          toast.error('This employee does not have an auth account yet. Creating one now...', {
            duration: 4000
          });
          // Automatically open Fix Auth modal
          setShowFixAuthModal(true);
          return; // Don't throw error, just show the modal
        }
        
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

  const calculateTenure = (hireDate) => {
    if (!hireDate) return '-';
    const hire = new Date(hireDate);
    const now = new Date();
    const years = now.getFullYear() - hire.getFullYear();
    const months = now.getMonth() - hire.getMonth();
    let totalMonths = years * 12 + months;
    if (now.getDate() < hire.getDate()) totalMonths--;
    
    if (totalMonths < 12) {
      return `${totalMonths} month${totalMonths !== 1 ? 's' : ''}`;
    } else {
      const yearsOnly = Math.floor(totalMonths / 12);
      const remainingMonths = totalMonths % 12;
      if (remainingMonths === 0) {
        return `${yearsOnly} year${yearsOnly !== 1 ? 's' : ''}`;
      }
      return `${yearsOnly} year${yearsOnly !== 1 ? 's' : ''} ${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`;
    }
  };

  const calculateAge = (birthDate) => {
    if (!birthDate) return '-';
    const birth = new Date(birthDate);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const monthDiff = now.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
      age--;
    }
    return age;
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

  const nv = isNarrowViewport;
  const editorFieldRow = {
    display: 'flex',
    flexDirection: nv ? 'column' : 'row',
    alignItems: nv ? 'stretch' : 'center',
    marginBottom: '20px',
    gap: nv ? '8px' : '20px',
  };
  const editorFieldLabel = {
    fontWeight: '600',
    color: '#374151',
    ...(nv ? {} : { minWidth: '200px' }),
    fontSize: '16px',
  };
  const editorFieldValue = { flex: 1, minWidth: 0 };
  const editorTwoColGrid = {
    display: 'grid',
    gridTemplateColumns: nv ? '1fr' : '1fr 1fr',
    gap: nv ? '16px' : '20px 40px',
  };
  const editorCardPadding = nv ? '18px 14px' : '30px';
  const editorPageGutter = nv ? '14px' : '20px';
  const editorMobileFullWidth = nv ? { width: '100%', boxSizing: 'border-box' } : {};

  const handleEmailBlur = async (value) => {
    // Validate email format only when user leaves the field
    if (value && value.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value.trim())) {
        toast.error('Invalid email format. Please enter a valid email address.');
        return;
      }
      // Normalize email (lowercase, trim) when they're done typing
      const normalizedEmail = value.trim().toLowerCase();
      if (normalizedEmail !== value) {
        setEmployee({ ...employee, email: normalizedEmail });
      }
    }
  };

  const handlePhoneBlur = async (value) => {
    if (!value || !value.trim()) return;
    try {
      const validation = await validateInput(value.trim(), 'phone', 'phone');
      if (validation.valid === false) {
        toast.error(validation.error || 'Invalid phone number');
        return;
      }
      const sanitized = validation.sanitized ?? value.trim();
      if (sanitized !== value) {
        setEmployee({ ...employee, phone: sanitized });
      }
    } catch (error) {
      console.error('[EmployeeEditor] Phone validation error:', error);
    }
  };

  const renderRow = (label, key, value, type = 'text') => {
    const isWageField = key === 'wage';
    const isEditable = canEditEmployees && (!isWageField || canEditWages);
    const isEmailField = key === 'email';
    const isPhoneField = key === 'phone';

    return (
      <div style={editorFieldRow}>
        <div style={editorFieldLabel}>
          {label}
        </div>
        <div style={editorFieldValue}>
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
              // Validate email/phone when user leaves the field
              if (isEmailField) {
                handleEmailBlur(e.target.value);
              }
              if (isPhoneField) {
                handlePhoneBlur(e.target.value);
              }
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
          paddingLeft: editorPageGutter,
          paddingRight: editorPageGutter,
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
            maxWidth: nv ? '100%' : '900px',
            margin: '0 auto'
          }}>
            {/* Header */}
            <div style={{ marginBottom: '30px' }}>
              <h1 style={{ 
                fontSize: nv ? '24px' : '32px', 
                fontWeight: 'bold', 
                color: '#111827',
                margin: '0 0 8px 0'
              }}>
                Employee Editor
              </h1>
              <p style={{ 
                color: '#6b7280', 
                fontSize: '32px',
                margin: 0
              }}>
                Editing: {getEmployeeName()} • Role: {formatRoleLabel(getEmployeeRole())}
              </p>
            </div>

            {/* Employee Information Card */}
            <div style={{
              backgroundColor: 'white',
              padding: editorCardPadding,
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
              marginBottom: '30px'
            }}>
              <h2 style={{
                fontSize: nv ? '20px' : '24px',
                fontWeight: '600',
                color: '#111827',
                margin: '0 0 30px 0'
              }}>
                Basic Information
              </h2>

              {/* Two-column layout (single column on mobile) */}
              <div style={editorTwoColGrid}>
                {/* Left Column */}
                <div>
                  {renderRow('Full Name', 'full_name', employee.full_name)}
                  {renderRow('First Name', 'first_name', employee.first_name)}
                  {renderRow('Last Name', 'last_name', employee.last_name)}
                  {renderRow('Email Address', 'email', employee.email, 'email')}
                  {renderRow('Phone Number', 'phone', employee.phone, 'tel')}
                  {renderRow('Employee Number', 'employee_number', employee.employee_number)}
                </div>

                {/* Right Column */}
                <div>
                  <div style={editorFieldRow}>
                    <div style={editorFieldLabel}>
                      Position/Title
                    </div>
                    <div style={editorFieldValue}>
                      <PositionSelectWithNew
                        key={positionSelectRemountKey}
                        businessId={selectedBusinessId}
                        value={employee.position || ''}
                        onChange={(v) => handleChange('position', v)}
                        disabled={!canEditEmployees}
                        selectStyle={{
                          width: '100%',
                          padding: '12px 16px',
                          border: '1px solid #d1d5db',
                          borderRadius: '8px',
                          fontSize: '16px',
                          boxSizing: 'border-box',
                          backgroundColor: !canEditEmployees ? '#f9fafb' : 'white'
                        }}
                        onRequestNewPosition={() => setShowAddPositionModal(true)}
                      />
                    </div>
                  </div>
                  {renderRow('Department', 'department', employee.department)}
                  {renderRow('Hire Date', 'hire_date', employee.hire_date, 'date')}
                  {renderRow('Wage (per hour)', 'wage', employee.wage, 'number')}
                  {employee.vacation_percent && (
                    <div style={editorFieldRow}>
                      <div style={editorFieldLabel}>
                        Vacation Pay
                      </div>
                      <div style={{ ...editorFieldValue, color: '#374151', fontSize: '24px' }}>
                        {(() => {
                          const percent = parseFloat(employee.vacation_percent || 0);
                          // If stored as percentage (>= 1.0), display directly; if stored as decimal (< 1.0), multiply by 100
                          return percent >= 1.0 ? `${percent.toFixed(1)}%` : `${(percent * 100).toFixed(1)}%`;
                        })()}
                      </div>
                    </div>
                  )}
                  {employee.hire_date && (
                    <div style={editorFieldRow}>
                      <div style={editorFieldLabel}>
                        Tenure
                      </div>
                      <div style={{ ...editorFieldValue, color: '#374151', fontSize: '16px' }}>
                        {calculateTenure(employee.hire_date)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div style={editorFieldRow}>
                <div style={editorFieldLabel}>
                  Role
                </div>
                <div style={editorFieldValue}>
                  <select
                    value={getEmployeeRole()}
                    onChange={(e) => handleChange('role', e.target.value)}
                    disabled={!canEditEmployees || employee?.id === (operatorPublicUserId ?? authUser?.id)}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      border: '1px solid #d1d5db',
                      borderRadius: '8px',
                      fontSize: '16px',
                      outline: 'none',
                      boxSizing: 'border-box',
                      backgroundColor: (canEditEmployees && employee?.id !== (operatorPublicUserId ?? authUser?.id)) ? 'white' : '#f9fafb',
                      cursor: (canEditEmployees && employee?.id !== (operatorPublicUserId ?? authUser?.id)) ? 'pointer' : 'not-allowed'
                    }}
                  >
                    {(roleOptionKeys.length ? roleOptionKeys : FALLBACK_BUSINESS_ROLE_KEYS).map((roleKey) => (
                      <option key={roleKey} value={roleKey}>
                        {formatRoleLabel(roleKey)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={editorFieldRow}>
                <div style={editorFieldLabel}>
                  Employment Status
                </div>
                <div style={editorFieldValue}>
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

            {/* Personal Information Card - Two Column Layout */}
            <div style={{
              backgroundColor: 'white',
              padding: editorCardPadding,
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
              marginBottom: '30px'
            }}>
              <h2 style={{
                fontSize: nv ? '20px' : '24px',
                fontWeight: '600',
                color: '#111827',
                margin: '0 0 30px 0'
              }}>
                Personal Information
              </h2>

              {/* Two-column layout (single column on mobile) */}
              <div style={editorTwoColGrid}>
                {/* Left Column */}
                <div>
                  <div style={editorFieldRow}>
                    <div style={editorFieldLabel}>
                      Birth Date:
                    </div>
                    <div style={{ ...editorFieldValue, color: '#374151', fontSize: '16px' }}>
                      {employee.birth_date ? new Date(employee.birth_date).toLocaleDateString() : '-'}
                    </div>
                  </div>
                  {employee.birth_date && (
                    <div style={editorFieldRow}>
                      <div style={editorFieldLabel}>
                        Age:
                      </div>
                      <div style={{ ...editorFieldValue, color: '#374151', fontSize: '24px' }}>
                        {calculateAge(employee.birth_date)} years old
                      </div>
                    </div>
                  )}
                  <div style={editorFieldRow}>
                    <div style={editorFieldLabel}>
                      SIN Number:
                    </div>
                    <div style={{ ...editorFieldValue, color: '#374151', fontSize: '16px' }}>
                      {employee.sin || employee.sin_number || 'Not provided'}
                    </div>
                  </div>
                  <div style={editorFieldRow}>
                    <div style={editorFieldLabel}>
                      Address Line 1:
                    </div>
                    <div style={{ ...editorFieldValue, color: '#374151', fontSize: '16px' }}>
                      {employee.address_line1 || '-'}
                    </div>
                  </div>
                  <div style={editorFieldRow}>
                    <div style={editorFieldLabel}>
                      Address Line 2:
                    </div>
                    <div style={{ ...editorFieldValue, color: '#374151', fontSize: '16px' }}>
                      {employee.address_line2 || '-'}
                    </div>
                  </div>
                  <div style={editorFieldRow}>
                    <div style={editorFieldLabel}>
                      City:
                    </div>
                    <div style={{ ...editorFieldValue, color: '#374151', fontSize: '16px' }}>
                      {employee.address_city || '-'}
                    </div>
                  </div>
                </div>

                {/* Right Column */}
                <div>
                  <div style={editorFieldRow}>
                    <div style={editorFieldLabel}>
                      Province/State:
                    </div>
                    <div style={{ ...editorFieldValue, color: '#374151', fontSize: '16px' }}>
                      {employee.address_state || '-'}
                    </div>
                  </div>
                  <div style={editorFieldRow}>
                    <div style={editorFieldLabel}>
                      Postal Code:
                    </div>
                    <div style={{ ...editorFieldValue, color: '#374151', fontSize: '16px' }}>
                      {employee.address_postal_code || '-'}
                    </div>
                  </div>
                  <div style={editorFieldRow}>
                    <div style={editorFieldLabel}>
                      Emergency Contact Name:
                    </div>
                    <div style={{ ...editorFieldValue, color: '#374151', fontSize: '16px' }}>
                      {employee.emergency_contact_name || '-'}
                    </div>
                  </div>
                  <div style={editorFieldRow}>
                    <div style={editorFieldLabel}>
                      Emergency Contact Phone:
                    </div>
                    <div style={{ ...editorFieldValue, color: '#374151', fontSize: '16px' }}>
                      {employee.emergency_contact_phone || '-'}
                    </div>
                  </div>
                  <div style={editorFieldRow}>
                    <div style={editorFieldLabel}>
                      Emergency Contact Relationship:
                    </div>
                    <div style={{ ...editorFieldValue, color: '#374151', fontSize: '16px' }}>
                      {employee.emergency_contact_relationship || '-'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Payroll Settings Card */}
            <div style={{
              backgroundColor: 'white',
              padding: editorCardPadding,
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
              marginBottom: '30px'
            }}>
              <h2 style={{
                fontSize: nv ? '20px' : '24px',
                fontWeight: '600',
                color: '#111827',
                margin: '0 0 30px 0'
              }}>
                Payroll Settings
              </h2>

              {renderRow('Additional Tax Per Period', 'additional_tax_per_period', employee.additional_tax_per_period, 'number')}
              <div style={{
                fontSize: '16px',
                color: '#6b7280',
                marginTop: '-10px',
                marginBottom: '20px',
                fontStyle: 'italic'
              }}>
                Additional federal tax amount to deduct from each pay period. This will automatically be included in payroll runs.
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
                padding: editorCardPadding,
                borderRadius: '12px',
                border: '1px solid #e5e7eb',
                boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                marginBottom: '30px'
              }}>
                <h2 style={{
                  fontSize: nv ? '20px' : '24px',
                  fontWeight: '600',
                  color: '#111827',
                  margin: '0 0 30px 0'
                }}>
                  Security Settings
                </h2>

                {/* PIN Section */}
                <PermissionGate permission="hr.employees.reset_pin" fallback={null}>
                  <div style={{ ...editorFieldRow, marginBottom: nv ? '20px' : '30px' }}>
                    <div style={editorFieldLabel}>
                      PIN (requires your PIN)
                    </div>
                    <div style={editorFieldValue}>
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
                            outline: 'none',
                            ...editorMobileFullWidth,
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
                          <div style={{
                            display: 'flex',
                            flexDirection: nv ? 'column' : 'row',
                            gap: '12px',
                            alignItems: nv ? 'stretch' : 'center',
                          }}>
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
                                outline: 'none',
                                ...editorMobileFullWidth,
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
                                outline: 'none',
                                ...editorMobileFullWidth,
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
                  <div style={editorFieldRow}>
                    <div style={editorFieldLabel}>
                      Password (requires your PIN)
                    </div>
                    <div style={editorFieldValue}>
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
                            outline: 'none',
                            ...editorMobileFullWidth,
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
                              fontSize: '18px',
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
                          <div style={{
                            display: 'flex',
                            flexDirection: nv ? 'column' : 'row',
                            gap: '12px',
                            alignItems: nv ? 'stretch' : 'center',
                          }}>
                            <button 
                              onClick={handlePasswordChange}
                              style={{
                                padding: '12px 24px',
                                backgroundColor: '#14B8A6',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '13px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                transition: 'background-color 0.2s ease',
                                outline: 'none',
                                ...editorMobileFullWidth,
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
                                fontSize: '13px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                transition: 'background-color 0.2s ease',
                                outline: 'none',
                                ...editorMobileFullWidth,
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
              flexWrap: 'wrap',
              flexDirection: nv ? 'column' : 'row',
              alignItems: nv ? 'stretch' : 'flex-start',
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
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s ease',
                    outline: 'none',
                    ...editorMobileFullWidth,
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
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s ease',
                    outline: 'none',
                    ...editorMobileFullWidth,
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
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s ease',
                    outline: 'none',
                    ...editorMobileFullWidth,
                  }}
                  onMouseOver={(e) => e.target.style.backgroundColor = '#dc2626'}
                  onMouseOut={(e) => e.target.style.backgroundColor = '#ef4444'}
                >
                  {confirmFinal ? 'Confirm & remove' : confirmDelete ? 'Confirm again' : 'Remove from business'}
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
                  fontSize: '14px',
                  fontWeight: '600',
                  margin: '0 0 12px 0'
                }}>
                  Final Confirmation Required
                </h3>
                <p style={{
                  color: '#7f1d1d',
                  margin: '0 0 16px 0'
                }}>
                  This removes the employee from this business roster (membership and role for this location). It does not delete their Tavari login if they are linked elsewhere. Enter your PIN to confirm.
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
                    fontSize: '13px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    width: nv ? '100%' : '200px',
                    maxWidth: '100%',
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
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                outline: 'none',
                ...editorMobileFullWidth,
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

        {/* Fix Employee Auth Modal */}
        {employee && (
          <FixEmployeeAuthModal
            isOpen={showFixAuthModal}
            onClose={() => setShowFixAuthModal(false)}
            employee={employee}
            onSuccess={async () => {
              setShowFixAuthModal(false);
              toast.success('Auth account created! You can now reset the password.');
              // Optionally reload employee data to reflect auth status
              await fetchEmployee();
            }}
          />
        )}
        <AddPositionModal
          isOpen={showAddPositionModal}
          businessId={selectedBusinessId}
          zIndex={1100}
          onClose={() => setShowAddPositionModal(false)}
          onCreated={(positionName) => {
            void handleChange('position', positionName);
            setPositionSelectRemountKey((k) => k + 1);
          }}
        />
      </SessionManager>
    </POSAuthWrapper>
  );
};

export default EmployeeEditor;