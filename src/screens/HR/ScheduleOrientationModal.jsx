// screens/HR/ScheduleOrientationModal.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { useSecurityContext } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { usePermissions } from '../../hooks/usePermissions';
import toast from 'react-hot-toast';

const ScheduleOrientationModal = ({ 
  isOpen, 
  onClose, 
  businessId, 
  selectedSession,
  onEmployeeScheduled 
}) => {
  // Security context
  const {
    recordAction,
    logSecurityEvent,
    checkRateLimit
  } = useSecurityContext({
    componentName: 'ScheduleOrientationModal',
    sensitiveComponent: false,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'low'
  });

  // Authentication
  const {
    authUser,
    authLoading
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin', 'hr_admin'],
    requireBusiness: true,
    componentName: 'ScheduleOrientationModal'
  });

  // Permission system
  const { 
    hasPermission, 
    hasAnyPermission,
    hasElevatedPrivileges,
    loading: permissionsLoading 
  } = usePermissions();

  // Component state
  const [employees, setEmployees] = useState([]);
  const [selectedEmployees, setSelectedEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [errors, setErrors] = useState({});
  const [sessionDetails, setSessionDetails] = useState(null);
  const [currentAttendees, setCurrentAttendees] = useState([]);

  // Permission checks
  const canScheduleEmployees = hasPermission('hr.orientation.schedule') || hasElevatedPrivileges();
  const canViewAttendees = hasPermission('hr.orientation.view_attendees') || hasElevatedPrivileges();

  useEffect(() => {
    if (isOpen && businessId && selectedSession && authUser && !authLoading && !permissionsLoading) {
      if (canScheduleEmployees) {
        loadAvailableEmployees();
        loadSessionDetails();
        if (canViewAttendees) {
          loadCurrentAttendees();
        }
        setSelectedEmployees([]);
        setSearchTerm('');
        setErrors({});

        logSecurityEvent('schedule_orientation_modal_opened', {
          action: 'open_schedule_orientation_modal',
          session_id: selectedSession.event_id,
          business_id: businessId
        }, 'low');
      } else {
        setErrors({ general: 'You do not have permission to schedule employees for orientation' });
      }
    }
  }, [isOpen, businessId, selectedSession, authUser, authLoading, permissionsLoading, canScheduleEmployees, canViewAttendees]);

  const loadAvailableEmployees = async () => {
    try {
      console.log('Loading employees for business:', businessId);
      
      await logSecurityEvent('load_available_employees', {
        action: 'load_employees_for_scheduling',
        session_id: selectedSession.event_id,
        business_id: businessId
      }, 'low');

      // Get all active employees with business_users relationship
      const { data: allEmployees, error: allError } = await supabase
        .from('users')
        .select(`
          id,
          first_name,
          last_name,
          department,
          hire_date,
          employment_status,
          business_users!inner(business_id)
        `)
        .eq('business_users.business_id', businessId)
        .eq('employment_status', 'active');

      if (allError) {
        console.error('Error loading all employees:', allError);
        throw allError;
      }

      console.log('All employees loaded:', allEmployees?.length);

      // Get employees already registered for this session
      const { data: registeredEmployees, error: regError } = await supabase
        .from('orientation_attendees')
        .select('employee_id')
        .eq('session_id', selectedSession.event_id);

      if (regError) {
        console.error('Error loading registered employees:', regError);
      }

      const registeredIds = registeredEmployees ? registeredEmployees.map(r => r.employee_id) : [];
      console.log('Registered employee IDs:', registeredIds);

      // Filter out already registered employees
      const availableEmployees = allEmployees ? allEmployees.filter(emp => 
        !registeredIds.includes(emp.id)
      ) : [];

      console.log('Available employees:', availableEmployees?.length);
      setEmployees(availableEmployees);

      recordAction('view_available_employees', {
        session_id: selectedSession.event_id,
        available_count: availableEmployees.length
      });

    } catch (error) {
      console.error('Error loading employees:', error);
      setErrors({ general: 'Failed to load employees' });
      setEmployees([]);
      toast.error('Failed to load available employees');

      await logSecurityEvent('load_employees_failed', {
        error_message: error.message,
        session_id: selectedSession.event_id,
        business_id: businessId
      }, 'medium');
    }
  };

  const loadSessionDetails = async () => {
    try {
      console.log('Loading session details for:', selectedSession.event_id);
      
      const { data, error } = await supabase
        .from('orientation_sessions')
        .select('*')
        .eq('id', selectedSession.event_id)
        .single();

      if (error) {
        console.error('Error loading session details:', error);
        throw error;
      }
      
      console.log('Session details loaded:', data);
      setSessionDetails(data);
    } catch (error) {
      console.error('Error loading session details:', error);
      setSessionDetails(null);
      toast.error('Failed to load session details');
    }
  };

  const loadCurrentAttendees = async () => {
    if (!canViewAttendees) {
      console.log('User does not have permission to view attendees');
      return;
    }

    try {
      console.log('Loading current attendees for session:', selectedSession.event_id);
      
      const { data, error } = await supabase.rpc('get_orientation_attendees', {
        p_session_id: selectedSession.event_id,
        p_business_id: businessId
      });

      if (error) {
        console.error('Error loading current attendees:', error);
        setCurrentAttendees([]);
      } else {
        console.log('Current attendees loaded:', data?.length);
        setCurrentAttendees(data || []);
      }
    } catch (error) {
      console.error('Error loading current attendees:', error);
      setCurrentAttendees([]);
    }
  };

  const handleEmployeeToggle = (employeeId) => {
    if (!canScheduleEmployees) {
      toast.error('You do not have permission to schedule employees');
      return;
    }

    setSelectedEmployees(prev => 
      prev.includes(employeeId) 
        ? prev.filter(id => id !== employeeId)
        : [...prev, employeeId]
    );
    
    // Clear any previous errors
    if (errors.general) {
      setErrors({});
    }

    recordAction('toggle_employee_selection', {
      employee_id: employeeId,
      selected: !selectedEmployees.includes(employeeId)
    });
  };

  const handleScheduleEmployees = async () => {
    if (!canScheduleEmployees) {
      toast.error('You do not have permission to schedule employees');
      return;
    }

    if (selectedEmployees.length === 0) {
      setErrors({ general: 'Please select at least one employee' });
      toast.error('Please select at least one employee');
      return;
    }

    // Check if adding these employees would exceed capacity
    const newTotal = currentAttendees.length + selectedEmployees.length;
    if (sessionDetails && newTotal > sessionDetails.max_attendees) {
      const spotsAvailable = sessionDetails.max_attendees - currentAttendees.length;
      const errorMsg = `Cannot add ${selectedEmployees.length} employees. Only ${spotsAvailable} spot${spotsAvailable !== 1 ? 's' : ''} available.`;
      setErrors({ general: errorMsg });
      toast.error(errorMsg);
      return;
    }

    // Rate limiting check
    const canProceed = await checkRateLimit('schedule_orientation', 10, 60);
    if (!canProceed) {
      toast.error('Too many scheduling requests. Please wait a moment.');
      return;
    }

    setLoading(true);
    setErrors({});

    try {
      await logSecurityEvent('schedule_orientation_employees', {
        action: 'schedule_employees_for_orientation',
        session_id: selectedSession.event_id,
        employee_count: selectedEmployees.length,
        business_id: businessId,
        scheduled_by: authUser?.id
      }, 'medium');

      if (!authUser?.id) {
        throw new Error('User authentication required');
      }

      console.log(`Scheduling ${selectedEmployees.length} employees for orientation`);

      const results = await Promise.all(
        selectedEmployees.map(async (employeeId) => {
          console.log('Scheduling employee:', employeeId);
          
          const { data, error } = await supabase.rpc('schedule_employee_orientation', {
            p_business_id: businessId,
            p_employee_id: employeeId,
            p_session_id: selectedSession.event_id,
            p_registered_by: authUser.id
          });

          if (error) {
            console.error('Error scheduling employee:', employeeId, error);
            throw error;
          }
          
          console.log('Successfully scheduled employee:', employeeId, 'Result:', data);
          return { employeeId, success: true, data };
        })
      );

      const successCount = results.filter(r => r.success).length;
      
      console.log(`Successfully scheduled ${successCount} employees for orientation`);
      
      recordAction('employees_scheduled', {
        session_id: selectedSession.event_id,
        employee_count: successCount,
        employee_ids: selectedEmployees
      });

      toast.success(`Successfully scheduled ${successCount} employee${successCount !== 1 ? 's' : ''} for orientation`);
      
      // Call the callback to refresh parent data
      if (onEmployeeScheduled) {
        onEmployeeScheduled();
      }
      
      // Close the modal
      onClose();
      
    } catch (error) {
      console.error('Error scheduling employees:', error);
      const errorMsg = `Failed to schedule employees: ${error.message}`;
      setErrors({ general: errorMsg });
      toast.error(errorMsg);

      await logSecurityEvent('schedule_employees_failed', {
        error_message: error.message,
        session_id: selectedSession.event_id,
        employee_count: selectedEmployees.length,
        business_id: businessId
      }, 'high');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    recordAction('close_schedule_orientation_modal', {
      session_id: selectedSession?.event_id,
      selected_count: selectedEmployees.length
    });
    onClose();
  };

  const filteredEmployees = employees.filter(employee => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    const fullName = `${employee.first_name} ${employee.last_name}`.toLowerCase();
    const department = (employee.department || '').toLowerCase();
    return fullName.includes(searchLower) || department.includes(searchLower);
  });

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  if (!isOpen) return null;

  // Permission check - don't render if user lacks permission
  if (!canScheduleEmployees && !permissionsLoading && !authLoading) {
    return (
      <div style={styles.modalOverlay}>
        <div style={styles.modal}>
          <div style={styles.modalHeader}>
            <h2 style={styles.modalTitle}>Access Denied</h2>
            <button onClick={handleClose} style={styles.modalClose}>×</button>
          </div>
          <div style={styles.modalContent}>
            <div style={styles.errorMessage}>
              You do not have permission to schedule employees for orientation.
            </div>
            <div style={styles.formActions}>
              <button
                type="button"
                onClick={handleClose}
                style={styles.cancelButton}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>Schedule Employees for Orientation</h2>
          <button onClick={handleClose} style={styles.modalClose}>×</button>
        </div>

        <div style={styles.modalContent}>
          {/* Session Info */}
          {selectedSession && sessionDetails && (
            <div style={styles.sessionInfo}>
              <h3 style={styles.sectionTitle}>Session Details</h3>
              <div style={styles.sessionDetails}>
                <div><strong>Title:</strong> {sessionDetails.title}</div>
                <div><strong>Date:</strong> {formatDate(selectedSession.event_date)}</div>
                <div><strong>Time:</strong> {formatTime(selectedSession.start_time)} - {formatTime(selectedSession.end_time)}</div>
                {sessionDetails.location && (
                  <div><strong>Location:</strong> {sessionDetails.location}</div>
                )}
                <div><strong>Capacity:</strong> {currentAttendees.length}/{sessionDetails.max_attendees}</div>
                <div><strong>Available Spots:</strong> {Math.max(0, sessionDetails.max_attendees - currentAttendees.length)}</div>
              </div>
            </div>
          )}

          {/* Current Attendees - only show if user has permission */}
          {canViewAttendees && currentAttendees.length > 0 && (
            <div style={styles.currentAttendees}>
              <h4 style={styles.subTitle}>Currently Registered ({currentAttendees.length})</h4>
              <div style={styles.attendeesList}>
                {currentAttendees.map((attendee) => (
                  <div key={attendee.attendee_id} style={styles.attendeeItem}>
                    <span>{attendee.employee_name}</span>
                    <span style={styles.attendeeStatus}>
                      {attendee.registration_status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Employee Search */}
          <div style={styles.searchSection}>
            <h3 style={styles.sectionTitle}>Select Employees to Schedule</h3>
            <input
              type="text"
              style={styles.searchInput}
              placeholder="Search employees by name or department..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={!canScheduleEmployees}
            />
          </div>

          {/* Employee List */}
          <div style={styles.employeeList}>
            {filteredEmployees.length === 0 ? (
              <div style={styles.noEmployees}>
                {employees.length === 0 
                  ? 'No available employees to schedule'
                  : searchTerm 
                    ? 'No employees match your search' 
                    : 'No employees available'
                }
              </div>
            ) : (
              filteredEmployees.map((employee) => {
                const isSelected = selectedEmployees.includes(employee.id);
                return (
                  <div 
                    key={employee.id} 
                    style={{
                      ...styles.employeeItem,
                      backgroundColor: isSelected ? '#e0f2fe' : 'white',
                      cursor: canScheduleEmployees ? 'pointer' : 'not-allowed',
                      opacity: canScheduleEmployees ? 1 : 0.6
                    }}
                    onClick={() => canScheduleEmployees && handleEmployeeToggle(employee.id)}
                  >
                    <div style={styles.employeeInfo}>
                      <div style={styles.employeeName}>
                        {employee.first_name} {employee.last_name}
                      </div>
                      {employee.department && (
                        <div style={styles.employeeDepartment}>
                          {employee.department}
                        </div>
                      )}
                      {employee.hire_date && (
                        <div style={styles.employeeHireDate}>
                          Hired: {new Date(employee.hire_date).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                    <div style={styles.checkbox}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        disabled={!canScheduleEmployees}
                        style={styles.checkboxInput}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Selected Count */}
          {selectedEmployees.length > 0 && (
            <div style={styles.selectedCount}>
              Selected: {selectedEmployees.length} employee{selectedEmployees.length !== 1 ? 's' : ''}
            </div>
          )}

          {/* Error Display */}
          {errors.general && (
            <div style={styles.errorMessage}>
              {errors.general}
            </div>
          )}

          {/* Form Actions */}
          <div style={styles.formActions}>
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              style={styles.cancelButton}
            >
              Cancel
            </button>
            {canScheduleEmployees && (
              <button
                type="button"
                onClick={handleScheduleEmployees}
                disabled={loading || selectedEmployees.length === 0}
                style={{
                  ...styles.scheduleButton,
                  opacity: (loading || selectedEmployees.length === 0) ? 0.5 : 1,
                  cursor: (loading || selectedEmployees.length === 0) ? 'not-allowed' : 'pointer'
                }}
              >
                {loading ? 'Scheduling...' : `Schedule ${selectedEmployees.length} Employee${selectedEmployees.length !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const styles = {
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px'
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '12px',
    maxWidth: '700px',
    width: '100%',
    maxHeight: '90vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px',
    borderBottom: '1px solid #e5e7eb',
    backgroundColor: '#f8f9fa'
  },
  modalTitle: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: 0
  },
  modalClose: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    color: '#6b7280',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '4px'
  },
  modalContent: {
    padding: '20px',
    overflowY: 'auto',
    flex: 1
  },
  sessionInfo: {
    backgroundColor: '#f0f9ff',
    border: '1px solid #bfdbfe',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '20px'
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: '0 0 12px 0'
  },
  subTitle: {
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#374151',
    margin: '0 0 8px 0'
  },
  sessionDetails: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '8px',
    fontSize: '14px',
    color: '#374151'
  },
  currentAttendees: {
    marginBottom: '20px'
  },
  attendeesList: {
    maxHeight: '100px',
    overflowY: 'auto',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    backgroundColor: '#f9fafb'
  },
  attendeeItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    borderBottom: '1px solid #e5e7eb',
    fontSize: '14px'
  },
  attendeeStatus: {
    fontSize: '12px',
    color: '#6b7280',
    textTransform: 'capitalize'
  },
  searchSection: {
    marginBottom: '20px'
  },
  searchInput: {
    width: '100%',
    padding: '12px',
    border: '2px solid #008080',
    borderRadius: '6px',
    fontSize: '16px',
    boxSizing: 'border-box'
  },
  employeeList: {
    maxHeight: '300px',
    overflowY: 'auto',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    backgroundColor: '#f9fafb',
    marginBottom: '15px'
  },
  noEmployees: {
    padding: '40px',
    textAlign: 'center',
    color: '#6b7280',
    fontStyle: 'italic'
  },
  employeeItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px',
    borderBottom: '1px solid #e5e7eb',
    cursor: 'pointer',
    transition: 'background-color 0.2s'
  },
  employeeInfo: {
    flex: 1
  },
  employeeName: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#1f2937'
  },
  employeeDepartment: {
    fontSize: '14px',
    color: '#6b7280',
    marginTop: '2px'
  },
  employeeHireDate: {
    fontSize: '12px',
    color: '#9ca3af',
    marginTop: '2px'
  },
  checkbox: {
    marginLeft: '12px'
  },
  checkboxInput: {
    width: '18px',
    height: '18px',
    cursor: 'pointer'
  },
  selectedCount: {
    backgroundColor: '#e0f2fe',
    border: '1px solid #0284c7',
    borderRadius: '6px',
    padding: '8px 12px',
    fontSize: '14px',
    color: '#0c4a6e',
    marginBottom: '15px',
    textAlign: 'center'
  },
  errorMessage: {
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '15px',
    fontSize: '14px'
  },
  formActions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
    paddingTop: '15px',
    borderTop: '1px solid #e5e7eb'
  },
  cancelButton: {
    padding: '12px 20px',
    backgroundColor: 'white',
    color: '#374151',
    border: '2px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  scheduleButton: {
    padding: '12px 20px',
    backgroundColor: '#008080',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer'
  }
};

export default ScheduleOrientationModal;