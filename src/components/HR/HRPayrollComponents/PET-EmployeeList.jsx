// components/HR/HRPayrollComponents/PET-EmployeeList.jsx
import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { supabase } from '../../../supabaseClient';
import { mergePayrollEntryDisplay } from '../../../helpers/Payroll/resolvePayrollEntryDisplay';

const PETEmployeeList = ({
  employees = [],
  payrollRun,
  employeeHours = {},
  entrySnapshots = {},
  entriesRefreshVersion = 0,
  onEmployeeClick,
}) => {
  const [employeePreviews, setEmployeePreviews] = useState({});

  const safeFormat = useCallback((value, decimals = 2) => {
    try {
      const num = parseFloat(value || 0);
      return isNaN(num) ? '0.00' : num.toFixed(decimals);
    } catch {
      return '0.00';
    }
  }, []);

  const handleEmployeeClick = useCallback(
    (employee) => {
      if (!employee?.id || !onEmployeeClick) return;
      try {
        onEmployeeClick(employee);
      } catch (error) {
        console.error('Error handling employee click:', error);
      }
    },
    [onEmployeeClick]
  );

  useEffect(() => {
    const loadFromDatabase = async () => {
      if (!payrollRun?.id || !Array.isArray(employees) || employees.length === 0) {
        setEmployeePreviews({});
        return;
      }

      try {
        const { data: entries, error } = await supabase
          .from('hrpayroll_entries')
          .select(
            'user_id, total_hours, regular_hours, overtime_hours, stat_holiday_hours, lieu_hours, lieu_earned, net_pay, gross_pay, additional_tax, wage_breakdown'
          )
          .eq('payroll_run_id', payrollRun.id);

        if (error) {
          console.error('Error loading payroll entries for list:', error);
          return;
        }

        const entriesByUserId = {};
        if (entries && Array.isArray(entries)) {
          entries.forEach((entry) => {
            if (entry && entry.user_id) {
              entriesByUserId[entry.user_id] = entry;
            }
          });
        }

        setEmployeePreviews(entriesByUserId);
      } catch (error) {
        console.error('Error loading payroll entries for list:', error);
      }
    };

    loadFromDatabase();
  }, [payrollRun?.id, employees, entriesRefreshVersion]);

  const processedEmployees = useMemo(() => {
    if (!Array.isArray(employees)) return [];

    return employees
      .filter((emp) => emp && emp.id)
      .map((employee) => {
        const employeeId = employee.id;
        const dbEntry = employeePreviews[employeeId];
        const memHours = employeeHours[employeeId];
        const snapshot = entrySnapshots[employeeId];
        const display = mergePayrollEntryDisplay(dbEntry, memHours, snapshot, employee);

        return {
          ...employee,
          calculated: {
            totalHours: display.hours_paid,
            hoursWorked: display.hours_worked,
            grossPay: display.gross_pay,
            netPay: display.net_pay,
            additionalFedTax: display.additional_tax,
            lieuUsed: display.lieu_used,
            lieuEarned: display.lieu_earned,
            lieuPay: display.lieu_pay,
            hasHours: display.hasHours,
            hasEntry: display.hasEntry,
          },
        };
      });
  }, [employees, employeePreviews, employeeHours, entrySnapshots]);

  const styles = {
    section: {
      marginBottom: '16px',
      backgroundColor: '#ffffff',
      padding: '16px',
      borderRadius: '8px',
      border: '1px solid #e5e7eb',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    },
    sectionTitle: {
      fontSize: '18px',
      fontWeight: '600',
      marginBottom: '12px',
      color: '#1f2937',
      margin: 0,
    },
    instructionText: {
      fontSize: '14px',
      color: '#6b7280',
      marginBottom: '16px',
    },
    employeeList: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
    },
    employeeCard: {
      backgroundColor: '#ffffff',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      padding: '16px',
      cursor: 'pointer',
      transition: 'border-color 0.2s',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    employeeInfo: {
      flex: 1,
    },
    employeeName: {
      fontSize: '16px',
      fontWeight: '600',
      color: '#1f2937',
      marginBottom: '4px',
    },
    employeeDetails: {
      fontSize: '14px',
      color: '#6b7280',
      display: 'flex',
      gap: '16px',
      flexWrap: 'wrap',
    },
    employeeStats: {
      display: 'flex',
      gap: '20px',
      alignItems: 'center',
      flexWrap: 'wrap',
    },
    statItem: {
      textAlign: 'center',
      minWidth: '60px',
    },
    statValue: {
      fontSize: '16px',
      fontWeight: '700',
    },
    statLabel: {
      fontSize: '12px',
      color: '#6b7280',
      marginTop: '4px',
    },
    emptyState: {
      textAlign: 'center',
      padding: '40px 20px',
      color: '#6b7280',
      fontSize: '16px',
    },
  };

  if (!processedEmployees || processedEmployees.length === 0) {
    return (
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Employee Hours Entry</h3>
        <div style={styles.emptyState}>No employees available for payroll entry.</div>
      </div>
    );
  }

  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>Employee Hours Entry</h3>
      <div style={styles.instructionText}>
        Click on any employee to edit their hours and taxes.
      </div>

      <div style={styles.employeeList}>
        {processedEmployees.map((employee) => {
          const { calculated } = employee;
          const {
            totalHours,
            hoursWorked,
            additionalFedTax,
            grossPay,
            netPay,
            lieuUsed,
            lieuEarned,
            lieuPay,
            hasHours,
            hasEntry,
          } = calculated;
          const lieuEnabled = employee.lieu_time_enabled;

          return (
            <div
              key={employee.id}
              style={styles.employeeCard}
              onClick={() => handleEmployeeClick(employee)}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#008080';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#e5e7eb';
              }}
            >
              <div style={styles.employeeInfo}>
                <div style={styles.employeeName}>
                  {employee.first_name || 'Unknown'} {employee.last_name || 'Employee'}
                  {!hasEntry && (
                    <span
                      style={{
                        fontSize: '12px',
                        color: '#9ca3af',
                        marginLeft: '8px',
                        fontWeight: '400',
                      }}
                    >
                      (No entry yet)
                    </span>
                  )}
                </div>
                <div style={styles.employeeDetails}>
                  <span>
                    Rate: ${safeFormat(employee.effective_wage ?? employee.wage)}/hr
                  </span>
                  <span>
                    Hours:{' '}
                    {lieuEnabled &&
                    hoursWorked > totalHours + 0.001 &&
                    parseFloat(employee.max_paid_hours_per_period) > 0
                      ? `${safeFormat(totalHours, 2)} paid (${safeFormat(hoursWorked, 2)} worked)`
                      : safeFormat(totalHours, 2)}
                  </span>
                  {lieuEnabled && lieuUsed > 0 && (
                    <span>
                      Lieu used: {safeFormat(lieuUsed, 2)} hrs (${safeFormat(lieuPay)})
                    </span>
                  )}
                  {lieuEnabled && lieuEarned > 0 && (
                    <span>Lieu earned: {safeFormat(lieuEarned, 2)}</span>
                  )}
                  {lieuEnabled && (
                    <span>Balance: {safeFormat(employee.lieu_time_balance || 0, 2)}</span>
                  )}
                </div>
              </div>

              <div style={styles.employeeStats}>
                {additionalFedTax > 0 && (
                  <div style={styles.statItem}>
                    <div
                      style={{
                        ...styles.statValue,
                        color: '#f59e0b',
                      }}
                    >
                      ${safeFormat(additionalFedTax)}
                    </div>
                    <div style={styles.statLabel}>Add'l Fed Tax</div>
                  </div>
                )}

                {lieuEnabled && lieuPay > 0 && (
                  <div style={styles.statItem}>
                    <div
                      style={{
                        ...styles.statValue,
                        color: '#008080',
                      }}
                    >
                      ${safeFormat(lieuPay)}
                    </div>
                    <div style={styles.statLabel}>Lieu Pay</div>
                  </div>
                )}

                <div style={styles.statItem}>
                  <div
                    style={{
                      ...styles.statValue,
                      color: hasHours && grossPay > 0 ? '#111827' : '#9ca3af',
                    }}
                  >
                    ${safeFormat(grossPay)}
                  </div>
                  <div style={styles.statLabel}>Gross Pay</div>
                </div>

                <div style={styles.statItem}>
                  <div
                    style={{
                      ...styles.statValue,
                      color: hasHours && netPay > 0 ? '#008080' : '#9ca3af',
                      fontSize: '18px',
                    }}
                  >
                    ${safeFormat(netPay)}
                  </div>
                  <div style={styles.statLabel}>Net Pay</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PETEmployeeList;
