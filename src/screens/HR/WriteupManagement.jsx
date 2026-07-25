// screens/HR/WriteupManagement.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { useNavigate } from 'react-router-dom';
import { SecurityWrapper, useSecurityContext } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import TerminationModal from '../../components/HR/TerminationModal';
import TerminationTemplatesModal from '../../components/HR/TerminationTemplatesModal';
import ResendEmailModal from '../../components/HR/ResendEmailModal';

const WriteupManagement = () => {
  const navigate = useNavigate();

  // Security context
  const {
    recordAction,
    logSecurityEvent,
    checkRateLimit
  } = useSecurityContext({
    componentName: 'WriteupManagement',
    sensitiveComponent: true, // Writeups are sensitive HR data
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
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
    requiredRoles: ['owner', 'manager', 'admin', 'hr_admin'],
    requireBusiness: true,
    componentName: 'WriteupManagement'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Component state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [writeups, setWriteups] = useState([]);
  const [terminations, setTerminations] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [dataLoading, setDataLoading] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('writeups'); // 'writeups' or 'terminations'
  const [showWriteupModal, setShowWriteupModal] = useState(false);
  const [showTerminationModal, setShowTerminationModal] = useState(false);
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [viewingTerminationId, setViewingTerminationId] = useState(null);
  const [showResendEmailModal, setShowResendEmailModal] = useState(false);
  const [resendingTerminationId, setResendingTerminationId] = useState(null);

  // Permission checks
  const canViewWriteups = hasAnyPermission([
    'hr.writeups.view',
    'hr.writeups.view_all'
  ]) || hasElevatedPrivileges();

  const canCreateWriteups = hasPermission('hr.writeups.create') || hasElevatedPrivileges();
  const canEditWriteups = hasPermission('hr.writeups.edit') || isOwner;
  const canDeleteWriteups = hasPermission('hr.writeups.delete') || isOwner;

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewWriteups) {
      toast.error('You do not have permission to access Writeup Management');
      navigate('/dashboard/hr/dashboard');
    }
  }, [permissionsLoading, canViewWriteups]);

  useEffect(() => {
    if (selectedBusinessId && authUser && !authLoading && !permissionsLoading && canViewWriteups) {
      checkUserAndBusiness();
    }
  }, [selectedBusinessId, authUser, authLoading, permissionsLoading, canViewWriteups]);

  const checkUserAndBusiness = async () => {
    try {
      await logSecurityEvent('writeup_management_access', {
        action: 'access_writeup_management',
        business_id: selectedBusinessId,
        sensitive_data: true
      }, 'medium');

      // Load employees and data
      await loadEmployees(selectedBusinessId);
      await loadWriteups(selectedBusinessId);
      await loadTerminations(selectedBusinessId);

      recordAction('view_writeup_management', selectedBusinessId);
      
    } catch (error) {
      console.error('Error loading writeup management:', error);
      setError('An unexpected error occurred. Please try again.');
      toast.error('Failed to load writeup management');

      await logSecurityEvent('writeup_management_load_failed', {
        error_message: error.message,
        business_id: selectedBusinessId
      }, 'high');
    } finally {
      setLoading(false);
    }
  };

  const loadEmployees = async (businessId) => {
    try {
      await logSecurityEvent('load_employees_for_writeups', {
        action: 'load_employee_list',
        business_id: businessId
      }, 'low');

      // Load employees - check both business_users and user_roles to catch employees from contracts
      // First try business_users (primary link)
      const { data: employeesFromBusiness, error: businessUserError } = await supabase
        .from('users')
        .select(`
          id,
          first_name,
          last_name,
          employee_number,
          department,
          position,
          employment_status,
          status,
          business_users!inner(business_id)
        `)
        .eq('business_users.business_id', businessId);

      // Also check user_roles for employees who might not have business_users entry yet
      const { data: employeesFromRoles, error: roleUserError } = await supabase
        .from('users')
        .select(`
          id,
          first_name,
          last_name,
          employee_number,
          department,
          position,
          employment_status,
          status,
          user_roles!inner(business_id, active)
        `)
        .eq('user_roles.business_id', businessId)
        .eq('user_roles.active', true);

      // Merge results, avoiding duplicates
      const employeesMap = new Map();
      const employeesMissingBusinessUsers = []; // Track employees that need business_users entry created
      
      // Add employees from business_users
      (employeesFromBusiness || []).forEach(emp => {
        employeesMap.set(emp.id, emp);
      });

      // Add employees from user_roles that aren't already in the map
      (employeesFromRoles || []).forEach(emp => {
        if (!employeesMap.has(emp.id)) {
          employeesMap.set(emp.id, emp);
          // Track this employee - they're missing business_users entry
          employeesMissingBusinessUsers.push({ id: emp.id, email: emp.email || 'unknown' });
        }
      });

      const employees = Array.from(employeesMap.values());
      const error = businessUserError || roleUserError;

      if (error) {
        console.error('Error loading employees:', error);
        // Continue with what we have, but log the error
      }

      // If we found employees from user_roles but not business_users, create the missing entries
      if (employeesMissingBusinessUsers.length > 0) {
        console.log(`[WriteupManagement] Found ${employeesMissingBusinessUsers.length} employees with user_roles but missing business_users entries. Creating missing entries...`);
        for (const emp of employeesMissingBusinessUsers) {
          try {
            const { error: insertError } = await supabase
              .from('business_users')
              .insert({
                user_id: emp.id,
                business_id: businessId,
                role: 'employee'
              });
            if (insertError && insertError.code !== '23505') { // Ignore duplicate key errors
              console.warn(`[WriteupManagement] Failed to create business_users entry for employee ${emp.email}:`, insertError);
            } else if (!insertError) {
              console.log(`[WriteupManagement] ✅ Created missing business_users entry for employee: ${emp.email}`);
            }
          } catch (err) {
            console.warn(`[WriteupManagement] Error creating business_users entry for employee ${emp.email}:`, err);
          }
        }
      }

      // Filter to show all employees except those already terminated (they can't be terminated again)
      const eligibleEmployees = (employees || []).filter(emp => {
        const status = (emp.employment_status || emp.status || 'active').toLowerCase();
        return status !== 'terminated';
      });

      // Sort alphabetically by last name, then by first name
      const sortedEmployees = eligibleEmployees.sort((a, b) => {
        const lastNameA = (a.last_name || '').toLowerCase();
        const lastNameB = (b.last_name || '').toLowerCase();
        
        if (lastNameA !== lastNameB) {
          return lastNameA.localeCompare(lastNameB);
        }
        
        // If last names are the same, sort by first name
        const firstNameA = (a.first_name || '').toLowerCase();
        const firstNameB = (b.first_name || '').toLowerCase();
        return firstNameA.localeCompare(firstNameB);
      });

      setEmployees(sortedEmployees);
      recordAction('employees_loaded', { count: eligibleEmployees.length });

    } catch (error) {
      console.error('Error loading employees:', error);
      setError('Failed to load employee list');
      toast.error('Failed to load employee list');
    }
  };

  const loadWriteups = async (businessId) => {
    if (!canViewWriteups) return;

    try {
      setDataLoading(true);
      
      await logSecurityEvent('load_writeups', {
        action: 'load_writeup_data',
        business_id: businessId,
        sensitive_data: true
      }, 'medium');

      console.log('Loading writeups for business:', businessId);
      
      // Placeholder - will be replaced with actual writeup storage solution
      // TODO: Implement actual writeup loading when table structure is finalized
      setWriteups([]);

      recordAction('writeups_loaded', { 
        business_id: businessId,
        count: 0 
      });
      
    } catch (error) {
      console.error('Error loading writeups:', error);
      setError('Failed to load writeup data');
      toast.error('Failed to load writeup data');

      await logSecurityEvent('load_writeups_failed', {
        error_message: error.message,
        business_id: businessId
      }, 'high');
    } finally {
      setDataLoading(false);
    }
  };

  const loadTerminations = async (businessId) => {
    if (!canViewWriteups) return;

    try {
      setDataLoading(true);
      
      await logSecurityEvent('load_terminations', {
        action: 'load_termination_data',
        business_id: businessId,
        sensitive_data: true
      }, 'medium');

      console.log('Loading terminations for business:', businessId);
      
      // Load terminations from database
      // First, check if table exists by trying a simple query
      const { data: terminationsData, error: terminationsError } = await supabase
        .from('hr_terminations')
        .select('*')
        .eq('business_id', businessId)
        .order('termination_date', { ascending: false });

      if (terminationsError) {
        // If table doesn't exist, just set empty array
        if (terminationsError.code === '42P01' || terminationsError.message.includes('does not exist')) {
          console.warn('hr_terminations table does not exist yet');
          setTerminations([]);
          return;
        }
        throw terminationsError;
      }

      // If we have terminations, load employee data for each
      if (terminationsData && terminationsData.length > 0) {
        const employeeIds = terminationsData.map(t => t.employee_id).filter(Boolean);
        
        if (employeeIds.length > 0) {
          const { data: employeesData, error: employeesError } = await supabase
            .from('users')
            .select('id, first_name, last_name, email, position, employee_number')
            .in('id', employeeIds);

          if (!employeesError && employeesData) {
            // Map employee data to terminations
            const employeesMap = {};
            employeesData.forEach(emp => {
              employeesMap[emp.id] = emp;
            });

            const terminationsWithEmployees = terminationsData.map(termination => ({
              ...termination,
              users: employeesMap[termination.employee_id] || null
            }));

            setTerminations(terminationsWithEmployees);
            recordAction('terminations_loaded', { 
              business_id: businessId,
              count: terminationsWithEmployees.length 
            });
            return;
          }
        }
      }

      // If no terminations or no employees found, just set the terminations
      setTerminations(terminationsData || []);

      
    } catch (error) {
      console.error('Error loading terminations:', error);
      setError('Failed to load termination data');
      toast.error('Failed to load termination data');

      await logSecurityEvent('load_terminations_failed', {
        error_message: error.message,
        business_id: businessId
      }, 'high');
    } finally {
      setDataLoading(false);
    }
  };

  const handleCreateWriteup = async () => {
    console.log('handleCreateWriteup called');
    
    if (!canCreateWriteups) {
      console.log('Permission denied for creating writeups');
      toast.error('You do not have permission to create writeups');
      return;
    }

    // Rate limiting check
    const canProceed = await checkRateLimit('create_writeup', 5, 60);
    if (!canProceed) {
      console.log('Rate limit exceeded');
      toast.error('Too many writeup creation requests. Please wait a moment.');
      return;
    }

    console.log('Opening writeup modal');
    
    await logSecurityEvent('create_writeup_initiated', {
      action: 'open_create_writeup',
      business_id: selectedBusinessId,
      sensitive_data: true
    }, 'medium');

    recordAction('create_writeup_opened', selectedBusinessId);
    setShowWriteupModal(true);
  };

  const handleCreateTermination = async () => {
    console.log('handleCreateTermination called');
    
    if (!canCreateWriteups) {
      console.log('Permission denied for creating terminations');
      toast.error('You do not have permission to create terminations');
      return;
    }

    // Rate limiting check
    const canProceed = await checkRateLimit('create_termination', 5, 60);
    if (!canProceed) {
      console.log('Rate limit exceeded');
      toast.error('Too many termination creation requests. Please wait a moment.');
      return;
    }

    console.log('Opening termination modal');
    
    await logSecurityEvent('create_termination_initiated', {
      action: 'open_create_termination',
      business_id: selectedBusinessId,
      sensitive_data: true
    }, 'medium');

    recordAction('create_termination_opened', selectedBusinessId);
    setShowTerminationModal(true);
  };

  const handleTerminationSaved = () => {
    // Reload terminations after saving
    if (selectedBusinessId) {
      loadTerminations(selectedBusinessId);
    }
  };

  const handleDeleteTermination = async (termination) => {
    if (!canDeleteWriteups) {
      toast.error('You do not have permission to delete terminations');
      return;
    }

    const employee = termination.users || {};
    const employeeName = employee.last_name && employee.first_name 
      ? `${employee.last_name}, ${employee.first_name}`
      : 'Unknown Employee';

    // Confirm deletion
    const confirmed = window.confirm(
      `Are you sure you want to delete the termination notice for ${employeeName}?\n\n` +
      `This action cannot be undone. The termination record will be permanently removed from the system.`
    );

    if (!confirmed) {
      return;
    }

    try {
      await logSecurityEvent('delete_termination_initiated', {
        action: 'delete_termination',
        business_id: selectedBusinessId,
        termination_id: termination.id,
        employee_id: termination.employee_id,
        sensitive_data: true
      }, 'high');

      const { error: deleteError } = await supabase
        .from('hr_terminations')
        .delete()
        .eq('id', termination.id)
        .eq('business_id', selectedBusinessId);

      if (deleteError) {
        throw deleteError;
      }

      await logSecurityEvent('delete_termination_success', {
        action: 'termination_deleted',
        business_id: selectedBusinessId,
        termination_id: termination.id,
        employee_id: termination.employee_id
      }, 'high');

      toast.success('Termination record deleted successfully');
      
      // Reload terminations
      await loadTerminations(selectedBusinessId);
      
      recordAction('termination_deleted', {
        termination_id: termination.id,
        business_id: selectedBusinessId
      });

    } catch (error) {
      console.error('Error deleting termination:', error);
      toast.error('Failed to delete termination: ' + (error.message || 'Unknown error'));

      await logSecurityEvent('delete_termination_failed', {
        error_message: error.message,
        business_id: selectedBusinessId,
        termination_id: termination.id
      }, 'high');
    }
  };

  const handleFilterEmployee = (employeeId) => {
    setSelectedEmployee(employeeId);
    recordAction('filter_writeups_by_employee', { 
      employee_id: employeeId,
      filter_applied: !!employeeId 
    });
  };

  const handleBackToDashboard = () => {
    navigate('/dashboard/hr/dashboard');
  };

  // Loading and error states
  if (permissionsLoading || authLoading || loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        paddingTop: '0px',
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
            Loading Writeup Management...
          </p>
        </div>
      </div>
    );
  }

  if (!canViewWriteups) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        paddingTop: '0px',
        paddingLeft: '20px',
        paddingRight: '20px',
        paddingBottom: '20px'
      }}>
        <div style={{ 
          textAlign: 'center',
          maxWidth: '400px'
        }}>
          <h2 style={{ 
            fontSize: '24px', 
            fontWeight: '600', 
            color: '#111827', 
            margin: '0 0 8px 0'
          }}>
            Access Denied
          </h2>
          <p style={{ 
            color: '#6b7280', 
            marginBottom: '20px',
            fontSize: '16px',
            lineHeight: '1.5',
            margin: '0 0 20px 0'
          }}>
            You do not have permission to access Writeup Management.
          </p>
          <button 
            onClick={handleBackToDashboard}
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
            Return to HR Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (authError || error) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        paddingTop: '0px',
        paddingLeft: '20px',
        paddingRight: '20px',
        paddingBottom: '20px'
      }}>
        <div style={{ 
          textAlign: 'center',
          maxWidth: '400px'
        }}>
          <h2 style={{ 
            fontSize: '24px', 
            fontWeight: '600', 
            color: '#111827', 
            margin: '0 0 8px 0'
          }}>
            Access Denied
          </h2>
          <p style={{ 
            color: '#6b7280', 
            marginBottom: '20px',
            fontSize: '16px',
            lineHeight: '1.5',
            margin: '0 0 20px 0'
          }}>
            {authError || error}
          </p>
          <button 
            onClick={handleBackToDashboard}
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
            Return to HR Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <POSAuthWrapper
      requiredRoles={['owner', 'manager', 'admin', 'hr_admin']}
      requireBusiness={true}
      componentName="WriteupManagement"
    >
      <SecurityWrapper>
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#f9fafb',
          paddingTop: '0px',
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

          {/* Header */}
          <div style={{ marginBottom: '30px' }}>
            <h1 style={{ 
              fontSize: '32px', 
              fontWeight: 'bold', 
              color: '#111827',
              margin: '0 0 8px 0'
            }}>
              Disciplinary Management
            </h1>
            <p style={{ 
              color: '#6b7280', 
              fontSize: '16px',
              margin: 0
            }}>
              Manage writeups and terminations • {businessData?.business_name || businessData?.name || 'Business'}
            </p>
          </div>

          {/* Sub-tabs for Writeups and Terminations */}
          <div style={{
            display: 'flex',
            gap: '2px',
            marginBottom: '20px',
            backgroundColor: '#e5e7eb',
            borderRadius: '8px',
            padding: '4px',
            width: 'fit-content'
          }}>
            <button
              onClick={() => setActiveSubTab('writeups')}
              style={{
                padding: '12px 24px',
                backgroundColor: activeSubTab === 'writeups' ? 'white' : 'transparent',
                color: activeSubTab === 'writeups' ? '#008080' : '#6b7280',
                border: 'none',
                borderRadius: '6px',
                fontSize: '20px',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: activeSubTab === 'writeups' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                whiteSpace: 'nowrap'
              }}
            >
              <span>📝</span>
              <span>Write Ups</span>
            </button>
            <button
              onClick={() => setActiveSubTab('terminations')}
              style={{
                padding: '12px 24px',
                backgroundColor: activeSubTab === 'terminations' ? 'white' : 'transparent',
                color: activeSubTab === 'terminations' ? '#008080' : '#6b7280',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: activeSubTab === 'terminations' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                whiteSpace: 'nowrap'
              }}
            >
              <span>🚪</span>
              <span>Terminations</span>
            </button>
          </div>

          {/* Security Notice for Sensitive Data */}
          <div style={{
            backgroundColor: '#fef3c7',
            border: '1px solid #fbbf24',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <span style={{ fontSize: '14px' }}>🔒</span>
            <p style={{ 
              margin: 0, 
              fontSize: '16px', 
              color: '#92400e' 
            }}>
              <strong>Sensitive HR Data:</strong> All writeup actions are logged for compliance and security purposes.
            </p>
          </div>

          {/* Controls */}
          <div style={{
            backgroundColor: 'white',
            padding: '24px',
            borderRadius: '12px',
            border: '1px solid #e5e7eb',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
            marginBottom: '20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '16px'
          }}>
            <div style={{ flex: 1, minWidth: '250px' }}>
              <label style={{
                display: 'block',
                fontSize: '16px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '6px'
              }}>
                Filter by Employee ({activeSubTab === 'writeups' ? 'Writeups' : 'Terminations'})
              </label>
              <select
                value={selectedEmployee}
                onChange={(e) => handleFilterEmployee(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '2px solid #14B8A6',
                  borderRadius: '8px',
                  fontSize: '16px',
                  outline: 'none'
                }}
              >
                <option value="">All Employees</option>
                {employees.map(employee => (
                  <option key={employee.id} value={employee.id}>
                    {employee.last_name}, {employee.first_name} 
                    {employee.employee_number && ` (#${employee.employee_number})`}
                  </option>
                ))}
              </select>
            </div>
            
            {activeSubTab === 'writeups' ? (
              <PermissionGate 
                permissions={['hr.writeups.create']} 
                requireElevated
                fallback={
                  <button
                    disabled
                    style={{
                      padding: '12px 24px',
                      backgroundColor: '#9CA3AF',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '18px',
                      fontWeight: '600',
                      cursor: 'not-allowed',
                      opacity: 0.6,
                      outline: 'none',
                      whiteSpace: 'nowrap'
                    }}
                    title="You do not have permission to create writeups"
                  >
                    + New Writeup
                  </button>
                }
              >
                <button
                  onClick={handleCreateWriteup}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#14B8A6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '28px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s ease',
                    outline: 'none',
                    whiteSpace: 'nowrap'
                  }}
                  onMouseOver={(e) => e.target.style.backgroundColor = '#0F766E'}
                  onMouseOut={(e) => e.target.style.backgroundColor = '#14B8A6'}
                >
                  + New Writeup
                </button>
              </PermissionGate>
            ) : (
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <PermissionGate 
                  permissions={['hr.writeups.create']} 
                  requireElevated
                  fallback={
                    <button
                      disabled
                      style={{
                        padding: '12px 24px',
                        backgroundColor: '#9CA3AF',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '18px',
                        fontWeight: '600',
                        cursor: 'not-allowed',
                        opacity: 0.6,
                        outline: 'none',
                        whiteSpace: 'nowrap'
                      }}
                      title="You do not have permission to create terminations"
                    >
                      + New Termination
                    </button>
                  }
                >
                  <button
                    onClick={handleCreateTermination}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: '#ef4444',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '28px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s ease',
                      outline: 'none',
                      whiteSpace: 'nowrap'
                    }}
                    onMouseOver={(e) => e.target.style.backgroundColor = '#dc2626'}
                    onMouseOut={(e) => e.target.style.backgroundColor = '#ef4444'}
                  >
                    + New Termination
                  </button>
                </PermissionGate>
                
                <button
                  onClick={() => setShowTemplatesModal(true)}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#14B8A6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '18px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s ease',
                    outline: 'none',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                  onMouseOver={(e) => e.target.style.backgroundColor = '#0F766E'}
                  onMouseOut={(e) => e.target.style.backgroundColor = '#14B8A6'}
                  title="View and manage saved termination letter templates"
                >
                  📋 Manage Templates
                </button>
              </div>
            )}
          </div>

          {/* Stats - Show different stats based on active sub-tab */}
          {activeSubTab === 'writeups' ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '20px',
              marginBottom: '40px'
            }}>
              <div style={{
                backgroundColor: 'white',
                padding: '24px',
                borderRadius: '12px',
                border: '1px solid #e5e7eb',
                boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
              }}>
                <h3 style={{ 
                  fontSize: '28px', 
                  fontWeight: '600', 
                  color: '#111827', 
                  margin: '0 0 8px 0'
                }}>
                  Total Writeups
                </h3>
                <p style={{ 
                  fontSize: '48px', 
                  fontWeight: 'bold', 
                  color: '#14B8A6',
                  margin: 0
                }}>
                  {writeups.length}
                </p>
              </div>
              
              <div style={{
                backgroundColor: 'white',
                padding: '24px',
                borderRadius: '12px',
                border: '1px solid #e5e7eb',
                boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
              }}>
                <h3 style={{ 
                  fontSize: '20px', 
                  fontWeight: '600', 
                  color: '#111827', 
                  margin: '0 0 8px 0'
                }}>
                  Pending Acknowledgment
                </h3>
                <p style={{ 
                  fontSize: '16px', 
                  fontWeight: 'bold', 
                  color: '#f59e0b',
                  margin: 0
                }}>
                  {writeups.filter(w => !w.employee_acknowledged).length}
                </p>
              </div>
              
              <div style={{
                backgroundColor: 'white',
                padding: '24px',
                borderRadius: '12px',
                border: '1px solid #e5e7eb',
                boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
              }}>
                <h3 style={{ 
                  fontSize: '16px', 
                  fontWeight: '600', 
                  color: '#111827', 
                  margin: '0 0 8px 0'
                }}>
                  Last 30 Days
                </h3>
                <p style={{ 
                  fontSize: '14px', 
                  fontWeight: 'bold', 
                  color: '#3b82f6',
                  margin: 0
                }}>
                  {writeups.filter(w => w.created_at >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()).length}
                </p>
              </div>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '20px',
              marginBottom: '40px'
            }}>
              <div style={{
                backgroundColor: 'white',
                padding: '24px',
                borderRadius: '12px',
                border: '1px solid #e5e7eb',
                boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
              }}>
                <h3 style={{ 
                  fontSize: '14px', 
                  fontWeight: '600', 
                  color: '#111827', 
                  margin: '0 0 8px 0'
                }}>
                  Total Terminations
                </h3>
                <p style={{ 
                  fontSize: '22px', 
                  fontWeight: 'bold', 
                  color: '#ef4444',
                  margin: 0
                }}>
                  {terminations.length}
                </p>
              </div>
              
              <div style={{
                backgroundColor: 'white',
                padding: '24px',
                borderRadius: '12px',
                border: '1px solid #e5e7eb',
                boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
              }}>
                <h3 style={{ 
                  fontSize: '14px', 
                  fontWeight: '600', 
                  color: '#111827', 
                  margin: '0 0 8px 0'
                }}>
                  This Year
                </h3>
                <p style={{ 
                  fontSize: '22px', 
                  fontWeight: 'bold', 
                  color: '#dc2626',
                  margin: 0
                }}>
                  {terminations.filter(t => {
                    const terminationDate = new Date(t.termination_date || t.created_at);
                    const currentYear = new Date().getFullYear();
                    return terminationDate.getFullYear() === currentYear;
                  }).length}
                </p>
              </div>
              
              <div style={{
                backgroundColor: 'white',
                padding: '24px',
                borderRadius: '12px',
                border: '1px solid #e5e7eb',
                boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
              }}>
                <h3 style={{ 
                  fontSize: '14px', 
                  fontWeight: '600', 
                  color: '#111827', 
                  margin: '0 0 8px 0'
                }}>
                  Last 30 Days
                </h3>
                <p style={{ 
                  fontSize: '22px', 
                  fontWeight: 'bold', 
                  color: '#991b1b',
                  margin: 0
                }}>
                  {terminations.filter(t => {
                    const terminationDate = new Date(t.termination_date || t.created_at);
                    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                    return terminationDate >= thirtyDaysAgo;
                  }).length}
                </p>
              </div>
            </div>
          )}

          {/* Content */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            border: '1px solid #e5e7eb',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
            overflow: 'hidden'
          }}>
            {activeSubTab === 'writeups' ? (
              dataLoading ? (
                <div style={{ 
                  padding: '60px 20px', 
                  textAlign: 'center' 
                }}>
                  <div style={{
                    width: '24px',
                    height: '24px',
                    border: '3px solid #14B8A6',
                    borderTop: '3px solid transparent',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                    margin: '0 auto 8px auto'
                  }}></div>
                  <p style={{ margin: 0, color: '#6b7280' }}>Loading writeups...</p>
                </div>
              ) : writeups.length === 0 ? (
                <div style={{ 
                  padding: '60px 20px', 
                  textAlign: 'center', 
                  color: '#6b7280' 
                }}>
                  <div style={{ fontSize: '38px', marginBottom: '16px' }}>📝</div>
                  <h3 style={{ 
                    fontSize: '16px', 
                    fontWeight: '600', 
                    color: '#111827', 
                    margin: '0 0 8px 0' 
                  }}>
                    No Writeups Found
                  </h3>
                  <p style={{ 
                    fontSize: '13px', 
                    margin: '0 0 24px 0' 
                  }}>
                    {selectedEmployee ? 'No writeups for selected employee' : 'No writeups have been created yet'}
                  </p>
                  {!selectedEmployee && canCreateWriteups && (
                    <button
                      onClick={handleCreateWriteup}
                      style={{
                        padding: '12px 24px',
                        backgroundColor: '#14B8A6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        outline: 'none'
                      }}
                      onMouseOver={(e) => e.target.style.backgroundColor = '#0F766E'}
                      onMouseOut={(e) => e.target.style.backgroundColor = '#14B8A6'}
                    >
                      Create First Writeup
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  {/* Writeups table will go here when writeup storage is implemented */}
                  <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>
                    <p style={{ marginBottom: '10px' }}>
                      Writeup table will be implemented once writeup storage structure is determined
                    </p>
                    <p style={{ fontSize: '11px', color: '#9ca3af' }}>
                      Writeup data is highly sensitive and requires proper security measures
                    </p>
                  </div>
                </div>
              )
            ) : (
              dataLoading ? (
                <div style={{ 
                  padding: '60px 20px', 
                  textAlign: 'center' 
                }}>
                  <div style={{
                    width: '24px',
                    height: '24px',
                    border: '3px solid #ef4444',
                    borderTop: '3px solid transparent',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                    margin: '0 auto 8px auto'
                  }}></div>
                  <p style={{ margin: 0, color: '#6b7280' }}>Loading terminations...</p>
                </div>
              ) : terminations.length === 0 ? (
                <div style={{ 
                  padding: '60px 20px', 
                  textAlign: 'center', 
                  color: '#6b7280' 
                }}>
                  <div style={{ fontSize: '38px', marginBottom: '16px' }}>🚪</div>
                  <h3 style={{ 
                    fontSize: '16px', 
                    fontWeight: '600', 
                    color: '#111827', 
                    margin: '0 0 8px 0' 
                  }}>
                    No Terminations Found
                  </h3>
                  <p style={{ 
                    fontSize: '13px', 
                    margin: '0 0 24px 0' 
                  }}>
                    {selectedEmployee ? 'No terminations for selected employee' : 'No terminations have been recorded yet'}
                  </p>
                  {!selectedEmployee && canCreateWriteups && (
                    <button
                      onClick={handleCreateTermination}
                      style={{
                        padding: '12px 24px',
                        backgroundColor: '#ef4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        outline: 'none'
                      }}
                      onMouseOver={(e) => e.target.style.backgroundColor = '#dc2626'}
                      onMouseOut={(e) => e.target.style.backgroundColor = '#ef4444'}
                    >
                      Record First Termination
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{
                    width: '100%',
                    borderCollapse: 'collapse'
                  }}>
                    <thead>
                      <tr style={{
                        backgroundColor: '#f9fafb',
                        borderBottom: '2px solid #e5e7eb'
                      }}>
                        <th style={{
                          padding: '12px',
                          textAlign: 'left',
                          fontSize: '11px',
                          fontWeight: '600',
                          color: '#374151'
                        }}>Employee</th>
                        <th style={{
                          padding: '12px',
                          textAlign: 'left',
                          fontSize: '11px',
                          fontWeight: '600',
                          color: '#374151'
                        }}>Type</th>
                        <th style={{
                          padding: '12px',
                          textAlign: 'left',
                          fontSize: '11px',
                          fontWeight: '600',
                          color: '#374151'
                        }}>Date</th>
                        <th style={{
                          padding: '12px',
                          textAlign: 'right',
                          fontSize: '11px',
                          fontWeight: '600',
                          color: '#374151'
                        }}>Total Pay</th>
                        <th style={{
                          padding: '12px',
                          textAlign: 'center',
                          fontSize: '11px',
                          fontWeight: '600',
                          color: '#374151'
                        }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {terminations
                        .filter(t => !selectedEmployee || t.employee_id === selectedEmployee)
                        .map((termination) => {
                          const employee = termination.users || {};
                          return (
                            <tr key={termination.id} style={{
                              borderBottom: '1px solid #e5e7eb'
                            }}>
                              <td style={{ padding: '12px', fontSize: '11px' }}>
                                {employee.last_name}, {employee.first_name}
                                {employee.employee_number && ` (#${employee.employee_number})`}
                              </td>
                              <td style={{ padding: '12px', fontSize: '11px' }}>
                                <span style={{
                                  padding: '4px 8px',
                                  borderRadius: '4px',
                                  fontSize: '10px',
                                  fontWeight: '600',
                                  backgroundColor: termination.termination_type === 'with_cause' ? '#fef2f2' :
                                                  termination.termination_type === 'without_cause' ? '#eff6ff' :
                                                  '#fef3c7',
                                  color: termination.termination_type === 'with_cause' ? '#991b1b' :
                                         termination.termination_type === 'without_cause' ? '#1e40af' :
                                         '#92400e'
                                }}>
                                  {termination.termination_type === 'with_cause' ? 'With Cause' :
                                   termination.termination_type === 'without_cause' ? 'Without Cause' :
                                   'Layoff'}
                                </span>
                              </td>
                              <td style={{ padding: '12px', fontSize: '11px' }}>
                                {new Date(termination.termination_date).toLocaleDateString('en-CA')}
                              </td>
                              <td style={{ padding: '12px', fontSize: '11px', textAlign: 'right', fontWeight: '600' }}>
                                ${parseFloat(termination.final_pay || 0).toFixed(2)}
                              </td>
                              <td style={{ padding: '12px', textAlign: 'center' }}>
                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                  <button
                                    onClick={() => {
                                      setViewingTerminationId(termination.id);
                                      setShowTerminationModal(true);
                                    }}
                                    style={{
                                      padding: '6px 12px',
                                      backgroundColor: '#14B8A6',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '6px',
                                      fontSize: '10px',
                                      fontWeight: '600',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    View
                                  </button>
                                  <button
                                    onClick={() => {
                                      setResendingTerminationId(termination.id);
                                      setShowResendEmailModal(true);
                                    }}
                                    style={{
                                      padding: '6px 12px',
                                      backgroundColor: '#3b82f6',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '6px',
                                      fontSize: '10px',
                                      fontWeight: '600',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    Resend Email
                                  </button>
                                  {canDeleteWriteups && (
                                    <button
                                      onClick={() => handleDeleteTermination(termination)}
                                      style={{
                                        padding: '6px 12px',
                                        backgroundColor: '#ef4444',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '6px',
                                        fontSize: '10px',
                                        fontWeight: '600',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                      }}
                                      title="Delete termination record"
                                    >
                                      <Trash2 size={14} />
                                      Delete
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>

          {/* Writeup Modal */}
          {showWriteupModal && (
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000
            }}
            onClick={() => setShowWriteupModal(false)}
            >
              <div style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '24px',
                maxWidth: '600px',
                width: '90%',
                maxHeight: '90vh',
                overflowY: 'auto',
                boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)'
              }}
              onClick={(e) => e.stopPropagation()}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '20px'
                }}>
                  <h2 style={{
                    fontSize: '19px',
                    fontWeight: 'bold',
                    color: '#111827',
                    margin: 0
                  }}>
                    Create New Writeup
                  </h2>
                  <button
                    onClick={() => setShowWriteupModal(false)}
                    style={{
                      background: 'none',
                      border: 'none',
                      fontSize: '19px',
                      cursor: 'pointer',
                      color: '#6b7280',
                      padding: '0',
                      width: '32px',
                      height: '32px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    ×
                  </button>
                </div>
                <div style={{
                  padding: '20px',
                  backgroundColor: '#f9fafb',
                  borderRadius: '8px',
                  marginBottom: '20px'
                }}>
                  <p style={{ margin: 0, color: '#6b7280', fontSize: '11px' }}>
                    Writeup creation form will be implemented here. This is a placeholder modal.
                  </p>
                </div>
                <div style={{
                  display: 'flex',
                  gap: '12px',
                  justifyContent: 'flex-end'
                }}>
                  <button
                    onClick={() => setShowWriteupModal(false)}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#e5e7eb',
                      color: '#374151',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      console.log('Save writeup clicked');
                      toast('Writeup creation form coming soon');
                      setShowWriteupModal(false);
                    }}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#14B8A6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Save Writeup
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Termination Modal */}
          <TerminationModal
            isOpen={showTerminationModal}
            onClose={() => {
              setShowTerminationModal(false);
              setViewingTerminationId(null);
              handleTerminationSaved();
            }}
            businessId={selectedBusinessId}
            employees={employees}
            authUser={authUser}
            terminationId={viewingTerminationId}
            viewMode={!!viewingTerminationId}
          />

          {/* Resend Email Modal */}
          {showResendEmailModal && (
            <ResendEmailModal
              isOpen={showResendEmailModal}
              onClose={() => {
                setShowResendEmailModal(false);
                setResendingTerminationId(null);
              }}
              terminationId={resendingTerminationId}
              businessId={selectedBusinessId}
              onEmailSent={() => {
                setShowResendEmailModal(false);
                setResendingTerminationId(null);
                toast.success('Email resent successfully');
              }}
            />
          )}

          {/* Termination Templates Modal */}
          <TerminationTemplatesModal
            isOpen={showTemplatesModal}
            onClose={() => setShowTemplatesModal(false)}
            businessId={selectedBusinessId}
            authUser={authUser}
          />
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default WriteupManagement;