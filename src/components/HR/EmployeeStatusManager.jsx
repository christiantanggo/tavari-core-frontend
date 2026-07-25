// components/HR/EmployeeStatusManager.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { hasHRPermission, HR_PERMISSIONS } from '../../utils/hrPermissions';
import { handleHRError, useHRError } from '../../utils/hrErrorHandling';
import PositionLabel from './PositionLabel';
import { updateBusinessEmploymentStatus } from '../../utils/businessEmploymentStatus';

const EmployeeStatusManager = ({ 
  employee, 
  userContext, 
  isOpen, 
  onClose, 
  onStatusChanged 
}) => {
  const [currentStatus, setCurrentStatus] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusHistory, setStatusHistory] = useState([]);
  const [errors, setErrors] = useState({});
  const { handleError } = useHRError(userContext);

  // Employment status options with descriptions
  const statusOptions = [
    {
      value: 'active',
      label: 'Active',
      description: 'Employee is currently working',
      color: '#16a34a',
      backgroundColor: '#dcfce7',
      requiresDate: false,
      requiresReason: false
    },
    {
      value: 'on_leave',
      label: 'On Leave',
      description: 'Temporary absence from work',
      color: '#d97706',
      backgroundColor: '#fef3c7',
      requiresDate: true,
      requiresReason: true,
      allowReturnDate: true
    },
    {
      value: 'suspended',
      label: 'Suspended',
      description: 'Disciplinary suspension',
      color: '#dc2626',
      backgroundColor: '#fee2e2',
      requiresDate: true,
      requiresReason: true,
      allowReturnDate: true
    },
    {
      value: 'terminated',
      label: 'Terminated',
      description: 'Employment ended',
      color: '#991b1b',
      backgroundColor: '#fee2e2',
      requiresDate: true,
      requiresReason: true,
      permanent: true
    },
    {
      value: 'probation',
      label: 'Probation',
      description: 'Probationary period',
      color: '#b45309',
      backgroundColor: '#fef3c7',
      requiresDate: false,
      requiresReason: true
    }
  ];

  // Initialize form
  useEffect(() => {
    if (isOpen && employee) {
      const status = employee.employment_status || employee.status || 'active';
      setCurrentStatus(status);
      setNewStatus(status);
      setEffectiveDate(new Date().toISOString().split('T')[0]);
      setReason('');
      setNotes('');
      setReturnDate('');
      setErrors({});
      loadStatusHistory();
    }
  }, [isOpen, employee]);

  // Load employee status change history
  const loadStatusHistory = async () => {
    try {
      setLoading(true);

      // Query audit logs for status changes
      const { data: auditData, error: auditError } = await supabase
        .from('audit_logs')
        .select(`
          id,
          event_type,
          details,
          timestamp,
          user_id,
          users(first_name, last_name, full_name)
        `)
        .eq('business_id', userContext.businessId)
        .eq('details->>employee_id', employee.id)
        .eq('event_type', 'employee_status_change')
        .order('timestamp', { ascending: false })
        .limit(20);

      if (auditError) throw auditError;

      const history = auditData?.map(log => ({
        id: log.id,
        timestamp: log.timestamp,
        changedBy: log.users 
          ? `${log.users.first_name} ${log.users.last_name}` || log.users.full_name
          : 'System',
        ...log.details
      })) || [];

      setStatusHistory(history);

    } catch (error) {
      handleError(error, {
        operation: 'load_status_history',
        employeeId: employee.id
      });
    } finally {
      setLoading(false);
    }
  };

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    const selectedStatus = statusOptions.find(opt => opt.value === newStatus);

    if (!newStatus) {
      newErrors.newStatus = 'Status is required';
    }

    if (!effectiveDate) {
      newErrors.effectiveDate = 'Effective date is required';
    } else {
      const effectiveDateTime = new Date(effectiveDate);
      const today = new Date();
      
      // Allow future dates for planned status changes
      if (effectiveDateTime > new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000)) {
        newErrors.effectiveDate = 'Effective date cannot be more than 1 year in the future';
      }
    }

    if (selectedStatus?.requiresReason && !reason.trim()) {
      newErrors.reason = 'Reason is required for this status';
    }

    if (returnDate && effectiveDate) {
      const returnDateTime = new Date(returnDate);
      const effectiveDateTime = new Date(effectiveDate);
      
      if (returnDateTime <= effectiveDateTime) {
        newErrors.returnDate = 'Return date must be after effective date';
      }
    }

    // Business rule validations
    if (newStatus === 'terminated' && currentStatus === 'terminated') {
      newErrors.newStatus = 'Employee is already terminated';
    }

    if (newStatus === 'active' && currentStatus === 'terminated') {
      newErrors.newStatus = 'Cannot reactivate terminated employee. Use rehire process instead.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle status change
  const handleStatusChange = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      setSaving(true);

      const selectedStatus = statusOptions.find(opt => opt.value === newStatus);
      
      const businessId = userContext?.businessId;
      if (!businessId) {
        throw new Error('Business context is required to change employment status.');
      }

      const statusPatch = {
        employment_status: newStatus,
      };
      if (newStatus === 'terminated') {
        statusPatch.termination_date = effectiveDate;
      } else if (currentStatus === 'terminated' && newStatus !== 'terminated') {
        statusPatch.termination_date = null;
      }

      console.log('[EmployeeStatusManager] Attempting to update employee status:', {
        employee_id: employee.id,
        employee_email: employee.email,
        business_id: businessId,
        current_status: currentStatus,
        new_status: newStatus,
        update_data: statusPatch,
      });

      const { data: updatedMembership, error: updateError } = await updateBusinessEmploymentStatus(
        supabase,
        {
          userId: employee.id,
          businessId,
          ...statusPatch,
        },
      );

      if (updateError) {
        console.error('[EmployeeStatusManager] Error updating employee status:', {
          error: updateError,
          employee_id: employee.id,
          employee_email: employee.email,
        });
        throw updateError;
      }

      if (!updatedMembership) {
        console.warn('[EmployeeStatusManager] Update returned no rows. Employee ID may not exist:', employee.id);
        throw new Error('Employee membership not found for this business.');
      }

      const updatedEmployee = {
        ...employee,
        employment_status: updatedMembership.employment_status,
        termination_date: updatedMembership.termination_date,
        business_employment_status: updatedMembership.employment_status,
        business_termination_date: updatedMembership.termination_date,
      };

      console.log('[EmployeeStatusManager] Employee status updated successfully:', updatedEmployee);

      // Create audit log entry
      const auditEntry = {
        event_type: 'employee_status_change',
        business_id: userContext.businessId,
        user_id: userContext.user.id,
        details: {
          employee_id: employee.id,
          employee_name: `${employee.first_name} ${employee.last_name}` || employee.full_name,
          previous_status: currentStatus,
          new_status: newStatus,
          effective_date: effectiveDate,
          reason: reason || null,
          notes: notes || null,
          return_date: returnDate || null,
          changed_by_id: userContext.user.id,
          changed_by_name: `${userContext.user.first_name} ${userContext.user.last_name}` || userContext.user.full_name || userContext.user.email
        }
      };

      const { error: auditError } = await supabase
        .from('audit_logs')
        .insert(auditEntry);

      if (auditError) {
        console.error('Failed to create audit log:', auditError);
        // Don't fail the entire operation for audit log issues
      }

      // Call parent callback
      if (onStatusChanged) {
        onStatusChanged(updatedEmployee, {
          previousStatus: currentStatus,
          newStatus,
          reason,
          effectiveDate,
          returnDate
        });
      }

      onClose();

    } catch (error) {
      handleError(error, {
        operation: 'change_employee_status',
        employeeId: employee.id,
        newStatus,
        currentStatus
      });
    } finally {
      setSaving(false);
    }
  };

  // Get status option by value
  const getStatusOption = (value) => {
    return statusOptions.find(opt => opt.value === value) || statusOptions[0];
  };

  // Check permissions
  const canChangeStatus = hasHRPermission(userContext, HR_PERMISSIONS.EDIT_EMPLOYEE) ||
    (employee.id === userContext.user.id && hasHRPermission(userContext, HR_PERMISSIONS.EDIT_OWN_PROFILE));
  
  const canTerminate = hasHRPermission(userContext, HR_PERMISSIONS.TERMINATE_EMPLOYEE);

  if (!isOpen) return null;

  if (!canChangeStatus) {
    return (
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
        zIndex: 50,
        padding: '20px'
      }}>
        <div style={{
          backgroundColor: 'white',
          padding: '24px',
          borderRadius: '12px',
          maxWidth: '400px',
          width: '100%',
          textAlign: 'center'
        }}>
          <h3 style={{ color: '#dc2626', margin: '0 0 16px 0' }}>Access Denied</h3>
          <p style={{ color: '#6b7280', margin: '0 0 20px 0' }}>
            You do not have permission to change employee status.
          </p>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              backgroundColor: '#6b7280',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const currentStatusOption = getStatusOption(currentStatus);
  const selectedStatusOption = getStatusOption(newStatus);

  return (
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
      zIndex: 50,
      padding: '20px'
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        width: '100%',
        maxWidth: '700px',
        maxHeight: '90vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{
          padding: '24px 24px 16px 24px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h2 style={{
            fontSize: '24px',
            fontWeight: '600',
            color: '#111827',
            margin: 0
          }}>
            Change Employee Status
          </h2>
          
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              color: '#6b7280',
              padding: '4px'
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '24px'
        }}>
          {/* Employee Info */}
          <div style={{
            backgroundColor: '#f9fafb',
            padding: '16px',
            borderRadius: '8px',
            marginBottom: '24px'
          }}>
            <h3 style={{
              fontSize: '16px',
              fontWeight: '600',
              color: '#111827',
              margin: '0 0 8px 0'
            }}>
              {employee.first_name} {employee.last_name}
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{
                padding: '4px 12px',
                borderRadius: '20px',
                fontSize: '12px',
                fontWeight: '600',
                backgroundColor: currentStatusOption.backgroundColor,
                color: currentStatusOption.color
              }}>
                Current: {currentStatusOption.label}
              </span>
              <span style={{ fontSize: '14px', color: '#6b7280' }}>
                <PositionLabel businessId={userContext?.businessId} value={employee.position} emptyFallback="" />
              </span>
              {employee.employee_number && (
                <span style={{ fontSize: '14px', color: '#6b7280' }}>
                  #{employee.employee_number}
                </span>
              )}
            </div>
          </div>

          <form onSubmit={handleStatusChange}>
            {/* New Status Selection */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '8px'
              }}>
                New Status *
              </label>
              
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '12px'
              }}>
                {statusOptions.map(option => {
                  const isDisabled = !canTerminate && option.value === 'terminated';
                  const isSelected = newStatus === option.value;
                  
                  return (
                    <div
                      key={option.value}
                      onClick={() => !isDisabled && setNewStatus(option.value)}
                      style={{
                        padding: '16px',
                        border: `2px solid ${isSelected ? option.color : '#e5e7eb'}`,
                        borderRadius: '8px',
                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                        backgroundColor: isSelected ? option.backgroundColor : 'white',
                        opacity: isDisabled ? 0.5 : 1,
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '4px'
                      }}>
                        <input
                          type="radio"
                          name="status"
                          value={option.value}
                          checked={isSelected}
                          disabled={isDisabled}
                          readOnly
                          style={{ margin: 0 }}
                        />
                        <span style={{
                          fontSize: '14px',
                          fontWeight: '600',
                          color: isSelected ? option.color : '#374151'
                        }}>
                          {option.label}
                        </span>
                      </div>
                      <p style={{
                        fontSize: '12px',
                        color: '#6b7280',
                        margin: 0
                      }}>
                        {option.description}
                      </p>
                    </div>
                  );
                })}
              </div>
              
              {errors.newStatus && (
                <p style={{ color: '#dc2626', fontSize: '12px', margin: '4px 0 0 0' }}>
                  {errors.newStatus}
                </p>
              )}
            </div>

            {/* Effective Date */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '6px'
              }}>
                Effective Date *
              </label>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                style={{
                  width: '100%',
                  maxWidth: '200px',
                  padding: '12px',
                  border: `1px solid ${errors.effectiveDate ? '#dc2626' : '#d1d5db'}`,
                  borderRadius: '6px',
                  fontSize: '16px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
                disabled={loading || saving}
              />
              {errors.effectiveDate && (
                <p style={{ color: '#dc2626', fontSize: '12px', margin: '4px 0 0 0' }}>
                  {errors.effectiveDate}
                </p>
              )}
            </div>

            {/* Return Date (for temporary statuses) */}
            {selectedStatusOption?.allowReturnDate && (
              <div style={{ marginBottom: '20px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '600',
                  color: '#374151',
                  marginBottom: '6px'
                }}>
                  Expected Return Date (Optional)
                </label>
                <input
                  type="date"
                  value={returnDate}
                  onChange={(e) => setReturnDate(e.target.value)}
                  style={{
                    width: '100%',
                    maxWidth: '200px',
                    padding: '12px',
                    border: `1px solid ${errors.returnDate ? '#dc2626' : '#d1d5db'}`,
                    borderRadius: '6px',
                    fontSize: '16px',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                  disabled={loading || saving}
                />
                {errors.returnDate && (
                  <p style={{ color: '#dc2626', fontSize: '12px', margin: '4px 0 0 0' }}>
                    {errors.returnDate}
                  </p>
                )}
              </div>
            )}

            {/* Reason */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '6px'
              }}>
                Reason {selectedStatusOption?.requiresReason && '*'}
              </label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Brief reason for status change"
                style={{
                  width: '100%',
                  padding: '12px',
                  border: `1px solid ${errors.reason ? '#dc2626' : '#d1d5db'}`,
                  borderRadius: '6px',
                  fontSize: '16px',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
                disabled={loading || saving}
              />
              {errors.reason && (
                <p style={{ color: '#dc2626', fontSize: '12px', margin: '4px 0 0 0' }}>
                  {errors.reason}
                </p>
              )}
            </div>

            {/* Notes */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '6px'
              }}>
                Additional Notes (Optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional details about this status change"
                rows={3}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '16px',
                  outline: 'none',
                  boxSizing: 'border-box',
                  resize: 'vertical'
                }}
                disabled={loading || saving}
              />
            </div>

            {/* Status History */}
            {statusHistory.length > 0 && (
              <div style={{ marginTop: '32px' }}>
                <h3 style={{
                  fontSize: '16px',
                  fontWeight: '600',
                  color: '#111827',
                  margin: '0 0 12px 0'
                }}>
                  Status History
                </h3>
                
                <div style={{
                  maxHeight: '200px',
                  overflow: 'auto',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px'
                }}>
                  {statusHistory.map(record => (
                    <div
                      key={record.id}
                      style={{
                        padding: '12px 16px',
                        borderBottom: '1px solid #f3f4f6'
                      }}
                    >
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        marginBottom: '4px'
                      }}>
                        <div>
                          <span style={{
                            fontSize: '14px',
                            fontWeight: '600',
                            color: '#111827'
                          }}>
                            {getStatusOption(record.previous_status)?.label} → {getStatusOption(record.new_status)?.label}
                          </span>
                          {record.reason && (
                            <span style={{
                              fontSize: '12px',
                              color: '#6b7280',
                              marginLeft: '8px'
                            }}>
                              ({record.reason})
                            </span>
                          )}
                        </div>
                        <span style={{
                          fontSize: '12px',
                          color: '#6b7280'
                        }}>
                          {new Date(record.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                      
                      <div style={{
                        fontSize: '12px',
                        color: '#6b7280'
                      }}>
                        Changed by: {record.changedBy}
                        {record.effective_date && record.effective_date !== record.timestamp?.split('T')[0] && (
                          <span> • Effective: {new Date(record.effective_date).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </form>
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '12px'
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '12px 24px',
              backgroundColor: 'white',
              border: '1px solid #d1d5db',
              color: '#374151',
              borderRadius: '6px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
            disabled={saving}
          >
            Cancel
          </button>
          
          <button
            type="submit"
            onClick={handleStatusChange}
            style={{
              padding: '12px 24px',
              backgroundColor: saving ? '#9ca3af' : '#14B8A6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: saving ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
            disabled={saving || loading || currentStatus === newStatus}
          >
            {saving && (
              <div style={{
                width: '16px',
                height: '16px',
                border: '2px solid white',
                borderTop: '2px solid transparent',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }}></div>
            )}
            {saving ? 'Updating...' : 'Update Status'}
          </button>
        </div>
      </div>

      <style>
        {`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}
      </style>
    </div>
  );
};

export default EmployeeStatusManager;