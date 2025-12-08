// screens/HR/AttendanceTrackingScreen.jsx - WITH PERMISSION SYSTEM
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import { usePermissions } from '../../hooks/usePermissions';
import PermissionGate from '../../components/Auth/PermissionGate';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import toast from 'react-hot-toast';

const AttendanceTrackingContent = ({ authState }) => {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { selectedBusinessId, authUser } = authState;

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
  const [sessionDetails, setSessionDetails] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all'); // all, registered, confirmed, attended, no_show
  const [bulkAction, setBulkAction] = useState('');
  const [selectedAttendees, setSelectedAttendees] = useState([]);
  const [error, setError] = useState(null);

  // Permission checks
  const canViewAttendance = hasAnyPermission([
    'hr.onboarding.view_attendance',
    'hr.onboarding.manage'
  ]) || hasElevatedPrivileges();

  const canMarkAttendance = hasAnyPermission([
    'hr.onboarding.mark_attendance',
    'hr.onboarding.manage'
  ]) || hasElevatedPrivileges();

  const canBulkUpdate = hasPermission('hr.onboarding.bulk_update') || isOwner();

  const canCancelAttendance = hasPermission('hr.onboarding.cancel_attendance') || hasElevatedPrivileges();

  // Check permissions on mount
  useEffect(() => {
    if (!permissionsLoading && !canViewAttendance) {
      toast.error('You do not have permission to view attendance tracking');
      navigate('/dashboard/hr/orientation');
    }
  }, [permissionsLoading, canViewAttendance]);

  // Load data when component mounts
  useEffect(() => {
    if (!authUser || !selectedBusinessId || !sessionId) return;
    if (!canViewAttendance) return;
    
    loadSessionData();
    loadAttendees();
  }, [authUser, selectedBusinessId, sessionId, canViewAttendance]);

  const loadSessionData = async () => {
    try {
      console.log('Loading session data for:', sessionId);
      
      const { data, error } = await supabase
        .from('orientation_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('business_id', selectedBusinessId)
        .single();

      if (error) {
        console.error('Error loading session:', error);
        throw error;
      }
      
      console.log('Session data loaded:', data);
      setSessionDetails(data);
    } catch (error) {
      console.error('Error loading session details:', error);
      setError('Session not found or access denied');
    }
  };

  const loadAttendees = async () => {
    setLoading(true);
    try {
      console.log('Loading attendees for session:', sessionId);
      
      const { data, error } = await supabase.rpc('get_orientation_attendees', {
        p_session_id: sessionId,
        p_business_id: selectedBusinessId
      });

      if (error) {
        console.error('Error loading attendees:', error);
        setAttendees([]);
      } else {
        console.log('Attendees loaded:', data?.length);
        setAttendees(data || []);
      }
    } catch (error) {
      console.error('Error loading attendees:', error);
      setAttendees([]);
    } finally {
      setLoading(false);
    }
  };

  const markAttendance = async (attendeeId, status, notes = null) => {
    // Check permission before proceeding
    if (!canMarkAttendance) {
      toast.error('You do not have permission to mark attendance');
      return;
    }

    // Additional check for cancel action
    if (status === 'cancelled' && !canCancelAttendance) {
      toast.error('You do not have permission to cancel attendance');
      return;
    }

    setSaving(true);
    try {
      console.log('Marking attendance:', attendeeId, status);
      
      const { data, error } = await supabase.rpc('mark_orientation_attendance', {
        p_attendee_id: attendeeId,
        p_attendance_status: status,
        p_marked_by: authUser.id,
        p_notes: notes
      });

      if (error) {
        console.error('Error marking attendance:', error);
        throw error;
      }
      
      console.log('Attendance marked successfully');
      toast.success(`Attendance marked as ${status.replace('_', ' ')}`);
      
      // Reload attendees to show updated status
      await loadAttendees();
      
    } catch (error) {
      console.error('Error marking attendance:', error);
      toast.error('Failed to update attendance. Please try again.');
      setError('Failed to update attendance. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleBulkAction = async () => {
    if (!bulkAction || selectedAttendees.length === 0) return;

    // Check permission before proceeding
    if (!canBulkUpdate) {
      toast.error('You do not have permission to perform bulk updates');
      return;
    }

    // Additional check for cancel action
    if (bulkAction === 'cancelled' && !canCancelAttendance) {
      toast.error('You do not have permission to cancel attendance');
      return;
    }

    setSaving(true);
    try {
      console.log(`Applying bulk ${bulkAction} to ${selectedAttendees.length} attendees`);
      
      await Promise.all(
        selectedAttendees.map(attendeeId => 
          supabase.rpc('mark_orientation_attendance', {
            p_attendee_id: attendeeId,
            p_attendance_status: bulkAction,
            p_marked_by: authUser.id,
            p_notes: `Bulk action: ${bulkAction}`
          })
        )
      );

      // Reload attendees and clear selections
      await loadAttendees();
      setSelectedAttendees([]);
      setBulkAction('');
      
      toast.success(`Bulk ${bulkAction} applied to ${selectedAttendees.length} attendees`);
      console.log(`Bulk ${bulkAction} applied successfully`);
    } catch (error) {
      console.error('Error applying bulk action:', error);
      toast.error('Failed to apply bulk action. Please try again.');
      setError('Failed to apply bulk action. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const toggleAttendeeSelection = (attendeeId, checked) => {
    setSelectedAttendees(prev => 
      checked
        ? [...prev, attendeeId]
        : prev.filter(id => id !== attendeeId)
    );
  };

  const selectAllVisible = () => {
    const visibleAttendeeIds = filteredAttendees.map(a => a.attendee_id);
    setSelectedAttendees(visibleAttendeeIds);
  };

  const clearSelection = () => {
    setSelectedAttendees([]);
  };

  const handleBackToCalendar = () => {
    navigate('/dashboard/hr/orientation');
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'registered': return TavariStyles.colors.secondary;
      case 'confirmed': return TavariStyles.colors.success;
      case 'attended': return TavariStyles.colors.cashGreen;
      case 'no_show': return TavariStyles.colors.danger;
      case 'cancelled': return TavariStyles.colors.gray500;
      default: return TavariStyles.colors.gray500;
    }
  };

  const getStatusBadge = (status) => {
    const color = getStatusColor(status);
    return (
      <span style={{
        backgroundColor: color,
        color: TavariStyles.colors.white,
        padding: '4px 8px',
        borderRadius: TavariStyles.borderRadius.sm,
        fontSize: TavariStyles.typography.fontSize.xs,
        fontWeight: TavariStyles.typography.fontWeight.bold,
        textTransform: 'capitalize'
      }}>
        {status.replace('_', ' ')}
      </span>
    );
  };

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

  const filteredAttendees = attendees.filter(attendee => {
    if (filter === 'all') return true;
    return attendee.registration_status === filter;
  });

  // Create styles using TavariStyles
  const styles = {
    container: {
      ...TavariStyles.layout.container,
      maxWidth: '1200px',
      margin: '0 auto'
    },
    
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: TavariStyles.spacing['2xl'],
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.lg
    },
    
    headerContent: {
      flex: 1
    },
    
    title: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800,
      margin: `0 0 ${TavariStyles.spacing.sm} 0`
    },
    
    sessionInfo: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs
    },
    
    sessionTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700
    },
    
    sessionDate: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray600
    },
    
    sessionLocation: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray600
    },
    
    backButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.ghost,
      ...TavariStyles.components.button.sizes.md,
      whiteSpace: 'nowrap'
    },
    
    errorBanner: {
      ...TavariStyles.components.banner.base,
      ...TavariStyles.components.banner.variants.error,
      marginBottom: TavariStyles.spacing.xl
    },
    
    summaryCards: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing['2xl']
    },
    
    summaryCard: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      textAlign: 'center'
    },
    
    cardTitle: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.sm
    },
    
    cardValue: {
      fontSize: TavariStyles.typography.fontSize['3xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800
    },
    
    controls: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing.xl
    },
    
    filterSection: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.lg,
      flexWrap: 'wrap'
    },
    
    filterLabel: TavariStyles.components.form.label,
    filterSelect: TavariStyles.components.form.select,
    
    bulkActions: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.lg
    },
    
    selectionControls: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      flexWrap: 'wrap'
    },
    
    selectButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.sm
    },
    
    bulkActionSection: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      alignItems: 'center',
      flexWrap: 'wrap'
    },
    
    bulkSelect: TavariStyles.components.form.select,
    
    applyButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.md
    },
    
    attendeesContainer: TavariStyles.layout.card,
    
    loadingMessage: {
      ...TavariStyles.components.loading.container,
      height: '200px'
    },
    
    noAttendees: {
      padding: TavariStyles.spacing['4xl'],
      textAlign: 'center',
      color: TavariStyles.colors.gray500,
      fontStyle: 'italic'
    },
    
    attendeesList: {
      padding: TavariStyles.spacing.xl
    },
    
    attendeeCard: {
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius.lg,
      padding: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      transition: TavariStyles.transitions.normal
    },
    
    attendeeHeader: {
      display: 'flex',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.md,
      gap: TavariStyles.spacing.md
    },
    
    attendeeSelectSection: {
      flexShrink: 0
    },
    
    attendeeInfo: {
      flex: 1
    },
    
    attendeeName: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800
    },
    
    attendeeDetails: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray600,
      marginTop: '2px'
    },
    
    statusSection: {
      flexShrink: 0
    },
    
    attendeeActions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      flexWrap: 'wrap',
      marginBottom: TavariStyles.spacing.md
    },
    
    actionButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.sizes.sm,
      color: TavariStyles.colors.white,
      minWidth: '80px'
    },
    
    attendeeNotes: {
      fontSize: TavariStyles.typography.fontSize.base,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.sm,
      padding: TavariStyles.spacing.sm,
      backgroundColor: TavariStyles.colors.gray100,
      borderRadius: TavariStyles.borderRadius.sm
    },
    
    timestampInfo: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray400,
      fontStyle: 'italic'
    },

    noAccessContainer: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: `${TavariStyles.spacing['3xl']} 0`,
      minHeight: '400px'
    },

    noAccessText: {
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      textAlign: 'center'
    }
  };

  // Show loading state while permissions are being checked
  if (permissionsLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingMessage}>
          <h3>Loading...</h3>
          <p>Checking permissions...</p>
        </div>
      </div>
    );
  }

  // Show access denied if user doesn't have permission
  if (!canViewAttendance) {
    return (
      <div style={styles.container}>
        <div style={styles.noAccessContainer}>
          <p style={styles.noAccessText}>⚠️ You do not have permission to view attendance tracking</p>
          <button style={styles.backButton} onClick={handleBackToCalendar}>
            ← Back to Orientation Calendar
          </button>
        </div>
      </div>
    );
  }

  if (!sessionDetails && !error) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingMessage}>
          <h3>Loading Session...</h3>
          <p>Loading session details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.errorBanner}>{error}</div>
        <button style={styles.backButton} onClick={handleBackToCalendar}>
          ← Back to Orientation Calendar
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerContent}>
          <h1 style={styles.title}>Attendance Tracking</h1>
          <div style={styles.sessionInfo}>
            <span style={styles.sessionTitle}>{sessionDetails.title}</span>
            <span style={styles.sessionDate}>
              {formatDate(sessionDetails.session_date)} • {formatTime(sessionDetails.start_time)} - {formatTime(sessionDetails.end_time)}
            </span>
            {sessionDetails.location && (
              <span style={styles.sessionLocation}>📍 {sessionDetails.location}</span>
            )}
          </div>
        </div>
        <button style={styles.backButton} onClick={handleBackToCalendar}>
          ← Back to Calendar
        </button>
      </div>

      {error && <div style={styles.errorBanner}>{error}</div>}

      {/* Summary Stats */}
      <div style={styles.summaryCards}>
        <div style={styles.summaryCard}>
          <div style={styles.cardTitle}>Total Registered</div>
          <div style={styles.cardValue}>{attendees.length}</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.cardTitle}>Attended</div>
          <div style={styles.cardValue}>
            {attendees.filter(a => a.registration_status === 'attended').length}
          </div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.cardTitle}>No Show</div>
          <div style={styles.cardValue}>
            {attendees.filter(a => a.registration_status === 'no_show').length}
          </div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.cardTitle}>Pending</div>
          <div style={styles.cardValue}>
            {attendees.filter(a => ['registered', 'confirmed'].includes(a.registration_status)).length}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={styles.controls}>
        <div style={styles.filterSection}>
          <label style={styles.filterLabel}>Filter by status:</label>
          <select 
            style={styles.filterSelect}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All ({attendees.length})</option>
            <option value="registered">Registered ({attendees.filter(a => a.registration_status === 'registered').length})</option>
            <option value="confirmed">Confirmed ({attendees.filter(a => a.registration_status === 'confirmed').length})</option>
            <option value="attended">Attended ({attendees.filter(a => a.registration_status === 'attended').length})</option>
            <option value="no_show">No Show ({attendees.filter(a => a.registration_status === 'no_show').length})</option>
            <option value="cancelled">Cancelled ({attendees.filter(a => a.registration_status === 'cancelled').length})</option>
          </select>
        </div>

        {/* Bulk Actions - Protected */}
        <PermissionGate
          permissions={['hr.onboarding.bulk_update']}
          requireOwner={!hasPermission('hr.onboarding.bulk_update')}
          fallback={null}
        >
          <div style={styles.bulkActions}>
            <div style={styles.selectionControls}>
              <button 
                style={{
                  ...styles.selectButton,
                  opacity: filteredAttendees.length === 0 ? 0.6 : 1
                }}
                onClick={selectAllVisible}
                disabled={filteredAttendees.length === 0}
              >
                Select All Visible
              </button>
              <button 
                style={{
                  ...styles.selectButton,
                  opacity: selectedAttendees.length === 0 ? 0.6 : 1
                }}
                onClick={clearSelection}
                disabled={selectedAttendees.length === 0}
              >
                Clear Selection ({selectedAttendees.length})
              </button>
            </div>

            {selectedAttendees.length > 0 && (
              <div style={styles.bulkActionSection}>
                <select 
                  style={styles.bulkSelect}
                  value={bulkAction}
                  onChange={(e) => setBulkAction(e.target.value)}
                >
                  <option value="">Bulk Action...</option>
                  <option value="confirmed">Mark as Confirmed</option>
                  <option value="attended">Mark as Attended</option>
                  <option value="no_show">Mark as No Show</option>
                  <PermissionGate
                    permissions={['hr.onboarding.cancel_attendance']}
                    requireElevated
                  >
                    <option value="cancelled">Mark as Cancelled</option>
                  </PermissionGate>
                </select>
                <button 
                  style={{
                    ...styles.applyButton,
                    opacity: (!bulkAction || saving) ? 0.6 : 1
                  }}
                  onClick={handleBulkAction}
                  disabled={!bulkAction || saving}
                >
                  {saving ? 'Applying...' : `Apply to ${selectedAttendees.length}`}
                </button>
              </div>
            )}
          </div>
        </PermissionGate>
      </div>

      {/* Attendees List */}
      <div style={styles.attendeesContainer}>
        {loading ? (
          <div style={styles.loadingMessage}>Loading attendees...</div>
        ) : filteredAttendees.length === 0 ? (
          <div style={styles.noAttendees}>
            {filter === 'all' ? 'No attendees registered for this session' : `No attendees with status: ${filter}`}
          </div>
        ) : (
          <div style={styles.attendeesList}>
            {filteredAttendees.map((attendee) => (
              <div key={attendee.attendee_id} style={styles.attendeeCard}>
                <div style={styles.attendeeHeader}>
                  {/* Only show checkbox if user can do bulk updates */}
                  <PermissionGate
                    permissions={['hr.onboarding.bulk_update']}
                    requireOwner={!hasPermission('hr.onboarding.bulk_update')}
                    fallback={<div style={{ width: '24px' }} />}
                  >
                    <div style={styles.attendeeSelectSection}>
                      <TavariCheckbox
                        checked={selectedAttendees.includes(attendee.attendee_id)}
                        onChange={(checked) => toggleAttendeeSelection(attendee.attendee_id, checked)}
                        label=""
                        size="md"
                        testId={`attendee-checkbox-${attendee.attendee_id}`}
                      />
                    </div>
                  </PermissionGate>
                  
                  <div style={styles.attendeeInfo}>
                    <div style={styles.attendeeName}>
                      {attendee.employee_name}
                    </div>
                    <div style={styles.attendeeDetails}>
                      {attendee.department && <span>{attendee.department} • </span>}
                      {attendee.hire_date && (
                        <span>Hired: {new Date(attendee.hire_date).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>

                  <div style={styles.statusSection}>
                    {getStatusBadge(attendee.registration_status)}
                  </div>
                </div>

                {/* Attendance Actions - Protected */}
                <PermissionGate
                  permissions={['hr.onboarding.mark_attendance', 'hr.onboarding.manage']}
                  requireAny
                  fallback={
                    <div style={styles.attendeeNotes}>
                      <small>⚠️ You do not have permission to mark attendance</small>
                    </div>
                  }
                >
                  <div style={styles.attendeeActions}>
                    <button
                      style={{
                        ...styles.actionButton,
                        backgroundColor: TavariStyles.colors.success,
                        opacity: (saving || attendee.registration_status === 'confirmed') ? 0.6 : 1
                      }}
                      onClick={() => markAttendance(attendee.attendee_id, 'confirmed')}
                      disabled={saving || attendee.registration_status === 'confirmed'}
                    >
                      Confirm
                    </button>
                    <button
                      style={{
                        ...styles.actionButton,
                        backgroundColor: TavariStyles.colors.cashGreen,
                        opacity: (saving || attendee.registration_status === 'attended') ? 0.6 : 1
                      }}
                      onClick={() => markAttendance(attendee.attendee_id, 'attended')}
                      disabled={saving || attendee.registration_status === 'attended'}
                    >
                      Mark Present
                    </button>
                    <button
                      style={{
                        ...styles.actionButton,
                        backgroundColor: TavariStyles.colors.danger,
                        opacity: (saving || attendee.registration_status === 'no_show') ? 0.6 : 1
                      }}
                      onClick={() => markAttendance(attendee.attendee_id, 'no_show')}
                      disabled={saving || attendee.registration_status === 'no_show'}
                    >
                      No Show
                    </button>
                    
                    {/* Cancel button - Protected with elevated permission */}
                    <PermissionGate
                      permissions={['hr.onboarding.cancel_attendance']}
                      requireElevated
                    >
                      <button
                        style={{
                          ...styles.actionButton,
                          backgroundColor: TavariStyles.colors.gray500,
                          opacity: (saving || attendee.registration_status === 'cancelled') ? 0.6 : 1
                        }}
                        onClick={() => markAttendance(attendee.attendee_id, 'cancelled')}
                        disabled={saving || attendee.registration_status === 'cancelled'}
                      >
                        Cancel
                      </button>
                    </PermissionGate>
                  </div>
                </PermissionGate>

                {attendee.notes && (
                  <div style={styles.attendeeNotes}>
                    <strong>Notes:</strong> {attendee.notes}
                  </div>
                )}

                {attendee.attendance_marked_at && (
                  <div style={styles.timestampInfo}>
                    Status updated: {new Date(attendee.attendance_marked_at).toLocaleString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Main component with authentication wrapper
const AttendanceTrackingScreen = () => {
  const [authState, setAuthState] = useState(null);

  return (
    <POSAuthWrapper
      componentName="Attendance Tracking"
      requiredRoles={['owner', 'manager', 'hr_admin']}
      requireBusiness={true}
      onAuthReady={setAuthState}
    >
      {authState && <AttendanceTrackingContent authState={authState} />}
    </POSAuthWrapper>
  );
};

export default AttendanceTrackingScreen;