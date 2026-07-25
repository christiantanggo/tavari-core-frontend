// components/HR/HRPayrollComponents/YTDComponents/YTDEmployeeSelector.jsx
import React from 'react';
import { TavariStyles } from '../../../../utils/TavariStyles';
import { CheckCircle, AlertTriangle, Info } from 'lucide-react';

const YTDEmployeeSelector = ({
  employees,
  filteredEmployees,
  selectedEmployee,
  setSelectedEmployee,
  employeeStatusFilter,
  setEmployeeStatusFilter,
  saveMessage,
  saveMessageType,
  styles
}) => {
  const selectedEmployeeDetails = filteredEmployees.find(emp => emp.id === selectedEmployee);

  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>Select Employee</h3>
      
      <div style={styles.formGroup}>
        <label style={styles.label}>Employee Status Filter:</label>
        <select
          style={styles.select}
          value={employeeStatusFilter}
          onChange={(e) => setEmployeeStatusFilter(e.target.value)}
        >
          <option value="active">Active Employees Only</option>
          <option value="current">Current Employees (Active + Probation + On Leave)</option>
          <option value="terminated">Terminated Employees Only</option>
          <option value="probation">Probation Employees Only</option>
          <option value="suspended">Suspended Employees Only</option>
          <option value="on_leave">On Leave Employees Only</option>
          <option value="all">All Employees (Any Status)</option>
        </select>
        <div style={styles.filterInfo}>
          Showing {filteredEmployees.length} of {employees.length} employees
        </div>
      </div>
      
      <div style={styles.formGroup}>
        <label style={styles.label}>Select Employee:</label>
        <select
          style={styles.select}
          value={selectedEmployee}
          onChange={(e) => setSelectedEmployee(e.target.value)}
        >
          <option value="">-- Select Employee --</option>
          {filteredEmployees.map(emp => (
            <option key={emp.id} value={emp.id}>
              {emp.name} {emp.employee_number ? `(#${emp.employee_number})` : ''} 
              {emp.employment_status !== 'active' ? ` - ${emp.employment_status.toUpperCase()}` : ''}
            </option>
          ))}
        </select>
      </div>

      {saveMessage && (
        <div style={{
          ...styles.messageBox,
          ...(saveMessageType === 'success' ? styles.successMessage :
              saveMessageType === 'error' ? styles.errorMessage :
              saveMessageType === 'warning' ? styles.warningMessage : styles.infoMessage)
        }}>
          {saveMessageType === 'success' && <CheckCircle size={20} />}
          {saveMessageType === 'error' && <AlertTriangle size={20} />}
          {saveMessageType === 'warning' && <AlertTriangle size={20} />}
          {saveMessageType === 'info' && <Info size={20} />}
          <span>{saveMessage}</span>
        </div>
      )}

      {selectedEmployeeDetails && (
        <div style={styles.employeeInfo}>
          <div style={styles.employeeInfoTitle}>
            Selected Employee Information
          </div>
          <div style={styles.employeeInfoGrid}>
            <div><strong>Name:</strong> {selectedEmployeeDetails.name}</div>
            <div><strong>Email:</strong> {selectedEmployeeDetails.email}</div>
            {selectedEmployeeDetails.employee_number && (
              <div><strong>Employee #:</strong> {selectedEmployeeDetails.employee_number}</div>
            )}
            {selectedEmployeeDetails.position && (
              <div><strong>Position:</strong> {selectedEmployeeDetails.position}</div>
            )}
            {selectedEmployeeDetails.department && (
              <div><strong>Department:</strong> {selectedEmployeeDetails.department}</div>
            )}
            {selectedEmployeeDetails.hire_date && (
              <div><strong>Hire Date:</strong> {new Date(selectedEmployeeDetails.hire_date).toLocaleDateString()}</div>
            )}
            {selectedEmployeeDetails.termination_date && (
              <div><strong>Termination Date:</strong> {new Date(selectedEmployeeDetails.termination_date).toLocaleDateString()}</div>
            )}
            <div>
              <strong>Status:</strong> 
              <span style={{
                marginLeft: TavariStyles.spacing.xs,
                padding: '2px 6px',
                borderRadius: TavariStyles.borderRadius?.sm || '4px',
                backgroundColor: selectedEmployeeDetails.employment_status === 'active' 
                  ? TavariStyles.colors.successBg 
                  : selectedEmployeeDetails.employment_status === 'terminated'
                  ? TavariStyles.colors.errorBg
                  : TavariStyles.colors.warningBg,
                color: selectedEmployeeDetails.employment_status === 'active' 
                  ? TavariStyles.colors.success 
                  : selectedEmployeeDetails.employment_status === 'terminated'
                  ? TavariStyles.colors.danger
                  : TavariStyles.colors.warning,
                fontSize: TavariStyles.typography.fontSize.xs,
                fontWeight: TavariStyles.typography.fontWeight.semibold
              }}>
                {selectedEmployeeDetails.employment_status.toUpperCase()}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default YTDEmployeeSelector;