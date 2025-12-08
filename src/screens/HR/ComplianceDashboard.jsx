// screens/HR/ComplianceDashboard.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle, Clock, XCircle, Filter, Search, Plus, X } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import ComplianceTrackingModal from '../../components/HR/ComplianceTrackingModal';
import toast from 'react-hot-toast';

const ComplianceDashboard = () => {
  const navigate = useNavigate();
  
  // Authentication state (inline like TabScreen)
  const [authUser, setAuthUser] = useState(null);
  const [selectedBusinessId, setSelectedBusinessId] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [userRole, setUserRole] = useState(null);

  // NEW: Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    isOwner, 
    isManager,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Component state
  const [complianceRecords, setComplianceRecords] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [error, setError] = useState(null);

  // Permission checks
  const canViewCompliance = hasAnyPermission([
    'hr.compliance.view',
    'hr.employees.view_all'
  ]) || hasElevatedPrivileges();

  const canCreateCompliance = hasPermission('hr.compliance.create') || hasElevatedPrivileges();

  const canResolveCompliance = hasPermission('hr.compliance.resolve') || hasElevatedPrivileges();

  const canManageCompliance = hasPermission('hr.compliance.manage') || isOwner();

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewCompliance) {
      toast.error('You do not have permission to view compliance tracking');
      navigate('/dashboard/hr/dashboard');
    }
  }, [permissionsLoading, canViewCompliance]);

  // Authentication and business context setup (copied from TabScreen pattern)
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        console.log('ComplianceDashboard: Initializing authentication...');
        
        const { data: { session }, error } = await supabase.auth.getSession();
        console.log('ComplianceDashboard: Session check result:', { session: !!session, error });

        if (error || !session?.user) {
          console.error('ComplianceDashboard: No valid session, redirecting to login');
          navigate('/login');
          return;
        }

        setAuthUser(session.user);
        console.log('ComplianceDashboard: Authenticated as:', session.user.email);

        const currentBusinessId = localStorage.getItem('currentBusinessId');
        console.log('ComplianceDashboard: Business ID from localStorage:', currentBusinessId);

        if (!currentBusinessId) {
          setAuthError('No business selected');
          return;
        }

        setSelectedBusinessId(currentBusinessId);

        // Verify user has access to this business and get role
        const { data: userRole, error: roleError } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', session.user.id)
          .eq('business_id', currentBusinessId)
          .eq('active', true)
          .single();

        if (roleError || !userRole) {
          console.error('ComplianceDashboard: User not authorized for this business:', roleError);
          setAuthError('Not authorized for this business');
          return;
        }

        setUserRole(userRole.role);
        console.log('ComplianceDashboard: User role verified:', userRole.role);
        setAuthLoading(false);

      } catch (err) {
        console.error('ComplianceDashboard: Authentication error:', err);
        setAuthError(err.message);
        setAuthLoading(false);
      }
    };

    initializeAuth();
  }, [navigate]);

  // Load compliance data and employees
  useEffect(() => {
    if (selectedBusinessId && !authLoading && canViewCompliance) {
      loadComplianceRecords();
      loadEmployees();
      
      // Update compliance statuses on load
      updateComplianceStatuses();
    }
  }, [selectedBusinessId, authLoading, canViewCompliance]);

  const updateComplianceStatuses = async () => {
    try {
      await supabase.rpc('update_compliance_status');
    } catch (error) {
      console.error('Error updating compliance statuses:', error);
    }
  };

  const loadComplianceRecords = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('compliance_dashboard')
        .select('*')
        .eq('business_id', selectedBusinessId)
        .order('priority_level', { ascending: true })
        .order('days_until_due', { ascending: true });

      if (error) throw error;

      setComplianceRecords(data || []);
    } catch (error) {
      console.error('Error loading compliance records:', error);
      toast.error('Failed to load compliance records');
      setError('Failed to load compliance records');
    } finally {
      setLoading(false);
    }
  };

  const loadEmployees = async () => {
    try {
      // Load from users table using business_users relationship
      const { data, error } = await supabase
        .from('users')
        .select(`
          id, 
          first_name,
          last_name,
          full_name, 
          email,
          position,
          department,
          hire_date,
          business_users!inner(business_id, role)
        `)
        .eq('business_users.business_id', selectedBusinessId)
        .order('first_name');

      if (error) {
        console.error('Error loading employees:', error);
        setEmployees([]);
      } else {
        // Transform the data to match expected format
        const transformedEmployees = (data || []).map(user => ({
          id: user.id,
          first_name: user.first_name || user.full_name?.split(' ')[0] || 'Unknown',
          last_name: user.last_name || user.full_name?.split(' ').slice(1).join(' ') || '',
          email: user.email,
          position: user.position,
          department: user.department,
          hire_date: user.hire_date,
          role: user.business_users[0]?.role || 'employee'
        }));
        
        setEmployees(transformedEmployees);
        console.log('Loaded employees:', transformedEmployees);
      }
    } catch (error) {
      console.error('Error loading employees:', error);
      setEmployees([]);
    }
  };

  const handleResolveCompliance = async (complianceId) => {
    // Check permission before proceeding
    if (!canResolveCompliance) {
      toast.error('You do not have permission to resolve compliance records');
      return;
    }

    try {
      const { data, error } = await supabase.rpc('resolve_compliance_record', {
        p_compliance_id: complianceId,
        p_resolved_by: authUser.id,
        p_resolution_notes: 'Manually resolved by ' + authUser.email
      });

      if (error) throw error;

      if (data) {
        toast.success('Compliance record resolved successfully');
        // Reload compliance records to show updated status
        await loadComplianceRecords();
      } else {
        toast.error('Failed to resolve compliance record');
        setError('Failed to resolve compliance record');
      }
    } catch (error) {
      console.error('Error resolving compliance:', error);
      toast.error('Failed to resolve compliance record: ' + error.message);
      setError('Failed to resolve compliance record: ' + error.message);
    }
  };

  const handleCreateCompliance = (employee) => {
    // Check permission before proceeding
    if (!canCreateCompliance) {
      toast.error('You do not have permission to create compliance records');
      return;
    }

    setSelectedEmployee(employee);
    setShowCreateModal(true);
  };

  const handleComplianceCreated = () => {
    setShowCreateModal(false);
    setSelectedEmployee(null);
    toast.success('Compliance record created successfully');
    loadComplianceRecords(); // Refresh the list
  };

  const filteredRecords = complianceRecords.filter(record => {
    const matchesSearch = !searchTerm || 
      record.employee_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      record.employee_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      record.position?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      record.department?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      record.compliance_notes?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || record.compliance_status === statusFilter;
    const matchesType = typeFilter === 'all' || record.compliance_type === typeFilter;
    const matchesPriority = priorityFilter === 'all' || record.priority_level === priorityFilter;
    
    return matchesSearch && matchesStatus && matchesType && matchesPriority;
  });

  const getStatusIcon = (status) => {
    switch (status) {
      case 'compliant': return <CheckCircle size={20} style={{ color: '#059669' }} />;
      case 'pending': return <Clock size={20} style={{ color: '#f59e0b' }} />;
      case 'overdue': return <AlertCircle size={20} style={{ color: '#dc2626' }} />;
      case 'non_compliant': return <XCircle size={20} style={{ color: '#dc2626' }} />;
      case 'resolved': return <CheckCircle size={20} style={{ color: '#6b7280' }} />;
      case 'exempted': return <XCircle size={20} style={{ color: '#6b7280' }} />;
      default: return <Clock size={20} style={{ color: '#6b7280' }} />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'compliant': return '#059669';
      case 'pending': return '#f59e0b';
      case 'overdue': return '#dc2626';
      case 'non_compliant': return '#dc2626';
      case 'resolved': return '#6b7280';
      case 'exempted': return '#6b7280';
      default: return '#6b7280';
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'critical': return '#dc2626';
      case 'high': return '#f59e0b';
      case 'medium': return '#3b82f6';
      case 'low': return '#6b7280';
      default: return '#6b7280';
    }
  };

  const formatComplianceType = (type) => {
    return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Get compliance statistics
  const stats = {
    total: filteredRecords.length,
    overdue: filteredRecords.filter(r => r.compliance_status === 'overdue').length,
    critical: filteredRecords.filter(r => r.priority_level === 'critical').length,
    dueThisWeek: filteredRecords.filter(r => r.days_until_due !== null && r.days_until_due <= 7 && r.days_until_due >= 0).length
  };

  // Show loading state while permissions are being checked
  if (permissionsLoading || authLoading) {
    return (
      <div style={{...styles.container, justifyContent: 'center', alignItems: 'center'}}>
        <h3>Loading Compliance Dashboard...</h3>
        <p>Authenticating user and loading business data...</p>
      </div>
    );
  }

  // Show access denied if user doesn't have permission
  if (!canViewCompliance) {
    return (
      <div style={{...styles.container, justifyContent: 'center', alignItems: 'center'}}>
        <h3>⚠️ Access Denied</h3>
        <p>You do not have permission to view the compliance dashboard.</p>
        <p>Please contact your administrator if you believe this is an error.</p>
        <button 
          style={styles.createButton}
          onClick={() => navigate('/dashboard/hr/dashboard')}
        >
          Return to HR Dashboard
        </button>
      </div>
    );
  }

  if (authError) {
    return (
      <div style={{...styles.container, justifyContent: 'center', alignItems: 'center'}}>
        <h3>Authentication Error</h3>
        <p>{authError}</p>
        <button 
          style={styles.createButton}
          onClick={() => navigate('/login')}
        >
          Return to Login
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading compliance dashboard...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h2>Compliance Dashboard</h2>
        <p>Monitor and manage contract compliance and probation periods</p>
      </div>

      {/* Error Message */}
      {error && (
        <div style={styles.errorBanner}>
          <AlertCircle size={20} style={{ marginRight: '8px' }} />
          {error}
          <button
            onClick={() => setError(null)}
            style={styles.errorClose}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Statistics */}
      <div style={styles.stats}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{stats.total}</div>
          <div style={styles.statLabel}>Total Records</div>
        </div>
        <div style={styles.statCard}>
          <div style={{...styles.statValue, color: '#dc2626'}}>{stats.overdue}</div>
          <div style={styles.statLabel}>Overdue</div>
        </div>
        <div style={styles.statCard}>
          <div style={{...styles.statValue, color: '#dc2626'}}>{stats.critical}</div>
          <div style={styles.statLabel}>Critical Priority</div>
        </div>
        <div style={styles.statCard}>
          <div style={{...styles.statValue, color: '#f59e0b'}}>{stats.dueThisWeek}</div>
          <div style={styles.statLabel}>Due This Week</div>
        </div>
      </div>

      {/* Controls */}
      <div style={styles.controls}>
        <div style={styles.searchSection}>
          <div style={styles.searchGroup}>
            <Search size={20} style={styles.searchIcon} />
            <input
              type="text"
              placeholder="Search employees, positions, or notes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={styles.searchInput}
            />
          </div>
          
          <div style={styles.filterGroup}>
            <Filter size={20} style={styles.filterIcon} />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="compliant">Compliant</option>
              <option value="overdue">Overdue</option>
              <option value="non_compliant">Non-Compliant</option>
              <option value="resolved">Resolved</option>
              <option value="exempted">Exempted</option>
            </select>
          </div>

          <div style={styles.filterGroup}>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="all">All Types</option>
              <option value="probation_period">Probation Period</option>
              <option value="contract_expiry">Contract Expiry</option>
              <option value="certification_expiry">Certification Expiry</option>
              <option value="policy_acknowledgment">Policy Acknowledgment</option>
              <option value="training_requirement">Training Requirement</option>
              <option value="performance_review">Performance Review</option>
            </select>
          </div>

          <div style={styles.filterGroup}>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="all">All Priorities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>
        
        {/* Create Compliance Button - Protected */}
        <PermissionGate
          permissions={['hr.compliance.create']}
          requireElevated
          fallback={null}
        >
          <div style={styles.actionButtons}>
            <select
              onChange={(e) => {
                if (e.target.value) {
                  const employee = employees.find(emp => emp.id === e.target.value);
                  handleCreateCompliance(employee);
                  e.target.value = ''; // Reset select
                }
              }}
              style={styles.employeeSelect}
            >
              <option value="">Add Compliance for Employee...</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.first_name} {emp.last_name} - {emp.position}
                </option>
              ))}
            </select>
          </div>
        </PermissionGate>
      </div>

      {/* Compliance Records */}
      <div style={styles.content}>
        {filteredRecords.length === 0 ? (
          <div style={styles.emptyState}>
            <AlertCircle size={64} style={styles.emptyIcon} />
            <h3 style={styles.emptyTitle}>No compliance records found</h3>
            <p style={styles.emptyText}>
              {searchTerm || statusFilter !== 'all' || typeFilter !== 'all' || priorityFilter !== 'all'
                ? 'Try adjusting your search filters.'
                : 'Create compliance records to track employee probation periods and other requirements.'
              }
            </p>
            <PermissionGate
              permissions={['hr.compliance.create']}
              requireElevated
            >
              <p style={styles.emptyText}>
                Select an employee from the dropdown above to create a compliance record.
              </p>
            </PermissionGate>
          </div>
        ) : (
          <div style={styles.recordGrid}>
            {filteredRecords.map((record) => (
              <div key={record.id} style={styles.recordCard}>
                <div style={styles.recordHeader}>
                  <div style={styles.recordTitle}>
                    <div style={styles.employeeName}>
                      {record.employee_name}
                    </div>
                    <div style={styles.recordType}>
                      {formatComplianceType(record.compliance_type)}
                    </div>
                  </div>
                  <div style={styles.statusSection}>
                    <div 
                      style={{
                        ...styles.priorityBadge,
                        backgroundColor: `${getPriorityColor(record.priority_level)}20`,
                        color: getPriorityColor(record.priority_level),
                        border: `1px solid ${getPriorityColor(record.priority_level)}40`
                      }}
                    >
                      {record.priority_level?.toUpperCase()}
                    </div>
                    <div style={styles.statusBadge}>
                      {getStatusIcon(record.compliance_status)}
                      <span style={{ color: getStatusColor(record.compliance_status), marginLeft: '6px' }}>
                        {record.compliance_status.replace(/_/g, ' ').toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>

                <div style={styles.recordBody}>
                  <div style={styles.employeeInfo}>
                    {record.employee_number && (
                      <div style={styles.infoRow}>
                        Employee #: {record.employee_number}
                      </div>
                    )}
                    {record.position && (
                      <div style={styles.infoRow}>
                        Position: {record.position}
                      </div>
                    )}
                    {record.department && (
                      <div style={styles.infoRow}>
                        Department: {record.department}
                      </div>
                    )}
                  </div>

                  <div style={styles.dateInfo}>
                    {record.start_date && (
                      <div style={styles.dateRow}>
                        <span>Start:</span>
                        <span>{new Date(record.start_date).toLocaleDateString()}</span>
                      </div>
                    )}
                    {record.due_date && (
                      <div style={styles.dateRow}>
                        <span>Due:</span>
                        <span>{new Date(record.due_date).toLocaleDateString()}</span>
                      </div>
                    )}
                    {record.probation_end_date && (
                      <div style={styles.dateRow}>
                        <span>Probation Ends:</span>
                        <span>{new Date(record.probation_end_date).toLocaleDateString()}</span>
                      </div>
                    )}
                    {record.expiry_date && (
                      <div style={styles.dateRow}>
                        <span>Expires:</span>
                        <span>{new Date(record.expiry_date).toLocaleDateString()}</span>
                      </div>
                    )}
                    {record.days_until_due !== null && (
                      <div style={styles.dateRow}>
                        <span>Days Until Due:</span>
                        <span style={{
                          color: record.days_until_due < 0 ? '#dc2626' : 
                                record.days_until_due <= 7 ? '#f59e0b' : '#059669'
                        }}>
                          {record.days_until_due < 0 ? `${Math.abs(record.days_until_due)} days overdue` : 
                           record.days_until_due === 0 ? 'Due today' :
                           `${record.days_until_due} days`}
                        </span>
                      </div>
                    )}
                  </div>

                  {record.compliance_notes && (
                    <div style={styles.notesSection}>
                      <div style={styles.notesTitle}>Notes:</div>
                      <div style={styles.notesText}>{record.compliance_notes}</div>
                    </div>
                  )}
                </div>

                {/* Resolve Button - Protected */}
                {record.compliance_status !== 'resolved' && (
                  <PermissionGate
                    permissions={['hr.compliance.resolve']}
                    requireElevated
                    fallback={null}
                  >
                    <div style={styles.recordActions}>
                      <button
                        onClick={() => handleResolveCompliance(record.id)}
                        style={styles.resolveButton}
                        title="Mark as Resolved"
                      >
                        <CheckCircle size={16} />
                        Resolve
                      </button>
                    </div>
                  </PermissionGate>
                )}

                <div style={styles.recordMeta}>
                  <div style={styles.metaRow}>
                    <span>Created by: {record.created_by_name}</span>
                    <span>{new Date(record.created_at).toLocaleDateString()}</span>
                  </div>
                  {record.resolved_by_name && (
                    <div style={styles.metaRow}>
                      <span>Resolved by: {record.resolved_by_name}</span>
                      <span>{new Date(record.resolved_at).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Compliance Modal - Protected */}
      <PermissionGate
        permissions={['hr.compliance.create']}
        requireElevated
      >
        <ComplianceTrackingModal
          isOpen={showCreateModal}
          onClose={() => {
            setShowCreateModal(false);
            setSelectedEmployee(null);
          }}
          employee={selectedEmployee}
          businessId={selectedBusinessId}
          onComplianceCreated={handleComplianceCreated}
        />
      </PermissionGate>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: '#f8f9fa',
    padding: '20px',
    paddingTop: '100px',
    boxSizing: 'border-box'
  },
  header: {
    marginBottom: '30px',
    textAlign: 'center'
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    padding: '15px',
    borderRadius: '8px',
    marginBottom: '20px',
    position: 'relative'
  },
  errorClose: {
    position: 'absolute',
    right: '15px',
    background: 'none',
    border: 'none',
    color: '#dc2626',
    cursor: 'pointer'
  },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '15px',
    marginBottom: '30px'
  },
  statCard: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '8px',
    textAlign: 'center',
    border: '1px solid #e5e7eb'
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#008080',
    marginBottom: '8px'
  },
  statLabel: {
    fontSize: '14px',
    color: '#6b7280'
  },
  controls: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '30px',
    gap: '20px',
    flexWrap: 'wrap'
  },
  searchSection: {
    display: 'flex',
    gap: '15px',
    flex: 1,
    flexWrap: 'wrap'
  },
  searchGroup: {
    position: 'relative',
    flex: 1,
    minWidth: '300px'
  },
  searchIcon: {
    position: 'absolute',
    left: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#6b7280'
  },
  searchInput: {
    width: '100%',
    paddingLeft: '40px',
    paddingRight: '12px',
    paddingTop: '12px',
    paddingBottom: '12px',
    border: '2px solid #008080',
    borderRadius: '8px',
    fontSize: '16px',
    boxSizing: 'border-box'
  },
  filterGroup: {
    position: 'relative',
    minWidth: '150px'
  },
  filterIcon: {
    position: 'absolute',
    left: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#6b7280',
    zIndex: 1
  },
  filterSelect: {
    width: '100%',
    paddingLeft: '40px',
    paddingRight: '12px',
    paddingTop: '12px',
    paddingBottom: '12px',
    border: '2px solid #008080',
    borderRadius: '8px',
    fontSize: '16px',
    backgroundColor: 'white',
    boxSizing: 'border-box'
  },
  actionButtons: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center'
  },
  employeeSelect: {
    padding: '12px',
    border: '2px solid #008080',
    borderRadius: '8px',
    fontSize: '16px',
    backgroundColor: 'white',
    minWidth: '250px',
    cursor: 'pointer'
  },
  createButton: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 20px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  content: {
    flex: 1,
    overflowY: 'auto'
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 20px',
    color: '#6b7280'
  },
  emptyIcon: {
    color: '#9ca3af',
    marginBottom: '20px'
  },
  emptyTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    marginBottom: '10px',
    color: '#374151'
  },
  emptyText: {
    fontSize: '16px',
    marginBottom: '30px'
  },
  recordGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
    gap: '20px',
    paddingBottom: '20px'
  },
  recordCard: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '20px',
    border: '2px solid #e5e7eb',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    transition: 'all 0.2s ease'
  },
  recordHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '15px',
    paddingBottom: '15px',
    borderBottom: '1px solid #f3f4f6'
  },
  recordTitle: {
    flex: 1
  },
  employeeName: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '4px'
  },
  recordType: {
    fontSize: '14px',
    color: '#6b7280',
    fontWeight: '500'
  },
  statusSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '8px'
  },
  priorityBadge: {
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 'bold'
  },
  statusBadge: {
    display: 'flex',
    alignItems: 'center',
    fontSize: '12px',
    fontWeight: 'bold'
  },
  recordBody: {
    marginBottom: '15px'
  },
  employeeInfo: {
    marginBottom: '15px'
  },
  infoRow: {
    fontSize: '14px',
    color: '#6b7280',
    marginBottom: '4px'
  },
  dateInfo: {
    marginBottom: '15px'
  },
  dateRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '14px',
    marginBottom: '4px'
  },
  notesSection: {
    marginTop: '15px'
  },
  notesTitle: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#374151',
    marginBottom: '6px'
  },
  notesText: {
    fontSize: '14px',
    color: '#6b7280',
    backgroundColor: '#f8f9fa',
    padding: '10px',
    borderRadius: '6px',
    border: '1px solid #e5e7eb'
  },
  recordActions: {
    display: 'flex',
    gap: '8px',
    marginBottom: '15px',
    paddingTop: '15px',
    borderTop: '1px solid #f3f4f6'
  },
  resolveButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 12px',
    backgroundColor: '#059669',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500'
  },
  recordMeta: {
    borderTop: '1px solid #f3f4f6',
    paddingTop: '10px'
  },
  metaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    color: '#9ca3af',
    marginBottom: '4px'
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '200px',
    fontSize: '18px',
    color: '#6b7280'
  }
};

export default ComplianceDashboard;