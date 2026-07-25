// components/HR/PolicyAssignmentModal.jsx
import React, { useState, useEffect } from 'react';
import { X, Users, UserCheck, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import { Checkbox } from '@safecomply/ui';

const PolicyAssignmentModal = ({ 
  isOpen, 
  onClose, 
  policy, 
  businessId, 
  employees = [],
  onAssignmentComplete 
}) => {
  const [assignmentType, setAssignmentType] = useState('all'); // 'all' or 'specific'
  const [selectedEmployees, setSelectedEmployees] = useState(new Set());
  const [expandedEmployees, setExpandedEmployees] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [sending, setSending] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Set default due date (30 days from now)
  useEffect(() => {
    if (isOpen && !dueDate) {
      const defaultDate = new Date();
      defaultDate.setDate(defaultDate.getDate() + (policy?.acknowledgment_deadline_days || 30));
      setDueDate(defaultDate.toISOString().split('T')[0]);
    }
  }, [isOpen, dueDate, policy]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setAssignmentType('all');
      setSelectedEmployees(new Set());
      setExpandedEmployees(false);
      setSearchTerm('');
      setDueDate('');
    }
  }, [isOpen]);

  const toggleEmployee = (employeeId) => {
    const newSelected = new Set(selectedEmployees);
    if (newSelected.has(employeeId)) {
      newSelected.delete(employeeId);
    } else {
      newSelected.add(employeeId);
    }
    setSelectedEmployees(newSelected);
  };

  const selectAllEmployees = () => {
    const allIds = new Set(filteredEmployees.map(emp => emp.id));
    setSelectedEmployees(allIds);
  };

  const deselectAllEmployees = () => {
    setSelectedEmployees(new Set());
  };

  const filteredEmployees = employees.filter(emp => {
    // First, exclude terminated employees
    const status = (emp.employment_status || '').toLowerCase();
    if (status === 'terminated') {
      return false;
    }

    // Then apply search filter if there's a search term
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.toLowerCase();
    const employeeNumber = (emp.employee_number || '').toString().toLowerCase();
    const email = (emp.email || '').toLowerCase();
    return fullName.includes(searchLower) || 
           employeeNumber.includes(searchLower) || 
           email.includes(searchLower);
  });

  const handleAssign = async () => {
    if (!policy) {
      toast.error('No policy selected');
      return;
    }

    if (assignmentType === 'specific' && selectedEmployees.size === 0) {
      toast.error('Please select at least one employee');
      return;
    }

    if (!dueDate) {
      toast.error('Please set a due date');
      return;
    }

    setSending(true);
    try {
      const employeesToAssign = assignmentType === 'all' 
        ? employees.filter(emp => {
            // Exclude terminated employees and ensure they have email
            const status = (emp.employment_status || '').toLowerCase();
            return status !== 'terminated' && emp.email;
          })
        : employees.filter(emp => {
            // Exclude terminated employees, ensure they're selected, and have email
            const status = (emp.employment_status || '').toLowerCase();
            return status !== 'terminated' && selectedEmployees.has(emp.id) && emp.email;
          });

      if (employeesToAssign.length === 0) {
        toast.error('No employees with email addresses found');
        setSending(false);
        return;
      }

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Create assignments
      // Note: hr_policy_assignments doesn't have business_id column
      // The business_id is inferred from the policy via hr_policies table
      // Also, requires_acknowledgment is stored on the policy, not the assignment
      const assignments = employeesToAssign.map(emp => ({
        policy_id: policy.id,
        employee_id: emp.id,
        employee_email: emp.email || null,
        assigned_by: user.id,
        assigned_at: new Date().toISOString(),
        due_date: dueDate,
        acknowledged: false
      }));

      const { error: insertError } = await supabase
        .from('hr_policy_assignments')
        .insert(assignments);

      if (insertError) throw insertError;

      toast.success(`Policy assigned to ${employeesToAssign.length} employee${employeesToAssign.length !== 1 ? 's' : ''}`);
      
      if (onAssignmentComplete) {
        onAssignmentComplete();
      }
      
      onClose();
    } catch (error) {
      console.error('Error assigning policy:', error);
      toast.error('Failed to assign policy: ' + (error.message || 'Unknown error'));
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  const styles = {
    overlay: {
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
    },
    modal: {
      backgroundColor: '#ffffff',
      borderRadius: '12px',
      padding: '24px',
      width: '90%',
      maxWidth: '600px',
      maxHeight: '90vh',
      overflowY: 'auto',
      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '24px',
      paddingBottom: '16px',
      borderBottom: '1px solid #e5e7eb'
    },
    title: {
      fontSize: '20px',
      fontWeight: '600',
      margin: 0,
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      color: '#111827'
    },
    closeButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '4px',
      display: 'flex',
      alignItems: 'center',
      color: '#6b7280'
    },
    formGroup: {
      marginBottom: '20px'
    },
    label: {
      display: 'block',
      marginBottom: '8px',
      fontWeight: '500',
      fontSize: '14px',
      color: '#374151'
    },
    radioGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      marginBottom: '20px'
    },
    radioOption: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px',
      border: '2px solid #e5e7eb',
      borderRadius: '8px',
      cursor: 'pointer',
      transition: 'all 0.2s',
      backgroundColor: 'white'
    },
    radioOptionSelected: {
      borderColor: '#14B8A6',
      backgroundColor: '#f0fdfa'
    },
    radioInput: {
      width: '18px',
      height: '18px',
      cursor: 'pointer'
    },
    radioLabel: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '14px',
      fontWeight: '500',
      color: '#111827'
    },
    expandableSection: {
      marginTop: '16px',
      padding: '16px',
      backgroundColor: '#f9fafb',
      borderRadius: '8px',
      border: '1px solid #e5e7eb'
    },
    expandableHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '12px',
      cursor: 'pointer'
    },
    expandableTitle: {
      fontSize: '14px',
      fontWeight: '600',
      color: '#374151'
    },
    searchInput: {
      width: '100%',
      padding: '8px 12px',
      border: '1px solid #d1d5db',
      borderRadius: '6px',
      fontSize: '14px',
      marginBottom: '12px'
    },
    employeesList: {
      maxHeight: '300px',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    },
    employeeItem: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '10px',
      backgroundColor: 'white',
      border: '1px solid #e5e7eb',
      borderRadius: '6px',
      cursor: 'pointer',
      transition: 'all 0.2s'
    },
    employeeItemSelected: {
      backgroundColor: '#f0fdfa',
      borderColor: '#14B8A6'
    },
    employeeInfo: {
      flex: 1
    },
    employeeName: {
      fontSize: '14px',
      fontWeight: '500',
      color: '#111827',
      marginBottom: '2px'
    },
    employeeDetails: {
      fontSize: '13px',
      color: '#6b7280'
    },
    selectAllButtons: {
      display: 'flex',
      gap: '8px',
      marginBottom: '12px'
    },
    selectAllButton: {
      padding: '6px 12px',
      fontSize: '13px',
      border: '1px solid #d1d5db',
      borderRadius: '4px',
      backgroundColor: 'white',
      cursor: 'pointer',
      fontWeight: '500'
    },
    input: {
      width: '100%',
      padding: '10px 12px',
      border: '1px solid #d1d5db',
      borderRadius: '6px',
      fontSize: '14px',
      boxSizing: 'border-box'
    },
    footer: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '12px',
      marginTop: '24px',
      paddingTop: '20px',
      borderTop: '1px solid #e5e7eb'
    },
    cancelButton: {
      padding: '10px 20px',
      border: '1px solid #d1d5db',
      borderRadius: '6px',
      backgroundColor: '#ffffff',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '500',
      color: '#374151'
    },
    assignButton: {
      padding: '10px 20px',
      border: 'none',
      borderRadius: '6px',
      backgroundColor: '#14B8A6',
      color: '#ffffff',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '600',
      display: 'flex',
      alignItems: 'center',
      gap: '6px'
    },
    selectedCount: {
      fontSize: '13px',
      color: '#6b7280',
      marginTop: '8px'
    }
  };

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>
            <UserCheck size={20} />
            Assign Policy
          </h2>
          <button onClick={onClose} style={styles.closeButton}>
            <X size={24} />
          </button>
        </div>

        {policy && (
          <div style={styles.formGroup}>
            <div style={{ padding: '12px', backgroundColor: '#f9fafb', borderRadius: '6px', marginBottom: '16px' }}>
              <div style={{ fontSize: '14px', fontWeight: '600', color: '#111827', marginBottom: '4px' }}>
                {policy.policy_number ? `${policy.policy_number} - ` : ''}{policy.policy_name}
              </div>
              <div style={{ fontSize: '13px', color: '#6b7280' }}>
                Version {policy.policy_version} • {policy.policy_type || 'No type'}
              </div>
            </div>
          </div>
        )}

        <div style={styles.formGroup}>
          <label style={styles.label}>Assignment Type</label>
          <div style={styles.radioGroup}>
            <label 
              style={{
                ...styles.radioOption,
                ...(assignmentType === 'all' ? styles.radioOptionSelected : {})
              }}
              onClick={() => setAssignmentType('all')}
            >
              <input
                type="radio"
                checked={assignmentType === 'all'}
                onChange={() => setAssignmentType('all')}
                style={styles.radioInput}
              />
              <div style={styles.radioLabel}>
                <Users size={18} />
                Assign to All Staff
                <span style={{ fontSize: '13px', color: '#6b7280', fontWeight: 'normal', marginLeft: '8px' }}>
                  ({employees.filter(emp => {
                    const status = (emp.employment_status || '').toLowerCase();
                    return status !== 'terminated' && emp.email;
                  }).length} active employees with email)
                </span>
              </div>
            </label>

            <label 
              style={{
                ...styles.radioOption,
                ...(assignmentType === 'specific' ? styles.radioOptionSelected : {})
              }}
              onClick={() => {
                setAssignmentType('specific');
                setExpandedEmployees(true);
              }}
            >
              <input
                type="radio"
                checked={assignmentType === 'specific'}
                onChange={() => {
                  setAssignmentType('specific');
                  setExpandedEmployees(true);
                }}
                style={styles.radioInput}
              />
              <div style={styles.radioLabel}>
                <UserCheck size={18} />
                Assign to Specific Staff
                {assignmentType === 'specific' && (
                  <span style={{ fontSize: '13px', color: '#14B8A6', fontWeight: 'normal', marginLeft: '8px' }}>
                    ({selectedEmployees.size} selected)
                  </span>
                )}
              </div>
            </label>
          </div>
        </div>

        {assignmentType === 'specific' && (
          <div style={styles.expandableSection}>
            <div 
              style={styles.expandableHeader}
              onClick={() => setExpandedEmployees(!expandedEmployees)}
            >
              <span style={styles.expandableTitle}>
                Select Employees ({selectedEmployees.size} selected)
              </span>
              {expandedEmployees ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </div>

            {expandedEmployees && (
              <>
                <input
                  type="text"
                  placeholder="Search employees..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={styles.searchInput}
                />

                <div style={styles.selectAllButtons}>
                  <button
                    type="button"
                    onClick={selectAllEmployees}
                    style={styles.selectAllButton}
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={deselectAllEmployees}
                    style={styles.selectAllButton}
                  >
                    Deselect All
                  </button>
                </div>

                <div style={styles.employeesList}>
                  {filteredEmployees.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>
                      No employees found
                    </div>
                  ) : (
                    filteredEmployees.map(employee => (
                      <div
                        key={employee.id}
                        style={{
                          ...styles.employeeItem,
                          ...(selectedEmployees.has(employee.id) ? styles.employeeItemSelected : {})
                        }}
                      >
                        <Checkbox
                          checked={selectedEmployees.has(employee.id)}
                          onChange={() => toggleEmployee(employee.id)}
                          id={`employee-${employee.id}`}
                        />
                        <div 
                          style={styles.employeeInfo}
                          onClick={() => toggleEmployee(employee.id)}
                        >
                          <div style={styles.employeeName}>
                            {employee.first_name} {employee.last_name}
                            {employee.employee_number && ` (#${employee.employee_number})`}
                          </div>
                          <div style={styles.employeeDetails}>
                            {employee.email || 'No email address'}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <div style={styles.formGroup}>
          <label style={styles.label}>Due Date for Acknowledgment *</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={styles.input}
            min={new Date().toISOString().split('T')[0]}
            required
          />
          <div style={styles.selectedCount}>
            Employees must acknowledge by this date
          </div>
        </div>

        <div style={styles.footer}>
          <button onClick={onClose} style={styles.cancelButton}>
            Cancel
          </button>
          <button
            onClick={handleAssign}
            disabled={sending || !dueDate}
            style={{
              ...styles.assignButton,
              opacity: (sending || !dueDate) ? 0.6 : 1,
              cursor: (sending || !dueDate) ? 'not-allowed' : 'pointer'
            }}
          >
            {sending ? 'Assigning...' : 'Assign Policy'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PolicyAssignmentModal;

