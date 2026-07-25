// components/HR/HRPayrollComponents/PayrollEntryTab.jsx - PRODUCTION VERSION
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../../../supabaseClient';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import { usePayrollCalculations } from '../../../hooks/usePayrollCalculations';
import { useYTDCalculations } from '../../../hooks/useYTDCalculations';
import POSAuthWrapper from '../../../components/Auth/POSAuthWrapper';
import TavariCheckbox from '../../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';
import { isPayrollVisibleForPeriod } from '../../../utils/payrollEmployeeEligibility';
import { aggregateTimesheetHoursForPayPeriod } from '../../../helpers/Payroll/aggregateTimesheetHoursForPayPeriod';
import { buildPayrollHoursWithStatSplit } from '../../../helpers/Payroll/buildPayrollHoursWithStatSplit';
import { computeHolidayPayForEmployeeInPeriod } from '../../../helpers/Payroll/computeHolidayPayForEmployee';
import { getCanadianStatHolidaysForPeriod } from '../../../utils/canadianStatHolidays';
import {
  aggregateShiftLeadPremiumHoursForPayPeriod,
  mapShiftLeadAggToEmployeePremiumHours
} from '../../../helpers/Payroll/aggregateShiftLeadPremiumHoursForPayPeriod';
import { fetchApprovedTimesheetSnapshot } from '../../../helpers/Scheduling/timesheetApprovalService';
import {
  applyLieuToPayrollPreview,
} from '../../../helpers/Payroll/computeAutoLieuForPeriod';
import {
  fetchLieuBalanceMapForEmployees,
  resolveAvailableLieuBalance,
  resolvePayrollLieuBalance,
  fetchPendingDraftLieuNetForUser,
  syncUsersLieuBalanceFromLedger,
} from '../../../helpers/Payroll/lieuTimeLedger';
import { resolveEffectiveEmployeeWage } from '../../../helpers/Payroll/resolveEffectiveEmployeeWage';
import {
  effectivePaidHours,
  effectiveWorkedHours,
} from '../../../helpers/Payroll/resolvePayrollEntryDisplay';

// Import all PET- components
import PETEmployeeEntryModal from './PET-EmployeeEntryModal';
import PETDraftLookupModal from './PET-DraftLookupModal';
import PETEmployeeList from './PET-EmployeeList';
import PETPayrollSummary from './PET-PayrollSummary';
import PETPeriodSetup from './PET-PeriodSetup';

// Error Boundary Component
class PayrollErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('PayrollEntryTab Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '20px',
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '8px',
          margin: '16px'
        }}>
          <h3 style={{ color: '#dc2626', margin: '0 0 12px 0' }}>Payroll Entry Error</h3>
          <p style={{ margin: '0 0 12px 0' }}>
            An error occurred in the payroll entry component. This has been logged for investigation.
          </p>
          <button 
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 16px',
              backgroundColor: '#dc2626',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Reload Page
          </button>
          {process.env.NODE_ENV === 'development' && (
            <details style={{ marginTop: '12px' }}>
              <summary>Error Details (Development)</summary>
              <pre style={{ fontSize: '12px', overflow: 'auto', marginTop: '8px' }}>
                {this.state.error?.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

const PayrollEntryTab = ({ 
  selectedBusinessId, 
  businessData, 
  employees = [], 
  settings = null,
  onPayrollFinalized = null
}) => {
  // Cleanup ref for async operations
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef(null);

  // Core payroll state
  const [payrollRun, setPayrollRun] = useState(null);
  const [employeeHours, setEmployeeHours] = useState({});
  const [employeePremiums, setEmployeePremiums] = useState({});
  const [employeeAdditionalFedTax, setEmployeeAdditionalFedTax] = useState({});
  const [employeeStatHolidayPay, setEmployeeStatHolidayPay] = useState({});
  const [employeeHolidayPay, setEmployeeHolidayPay] = useState({});
  const [employeeHolidayDetails, setEmployeeHolidayDetails] = useState({});
  const [allPremiums, setAllPremiums] = useState([]);
  
  // Period and UI state
  const [selectedPeriod, setSelectedPeriod] = useState({
    start: '',
    end: '',
    payDate: ''
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [error, setError] = useState(null);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [showDraftLookup, setShowDraftLookup] = useState(false);
  /** Keeps users.lieu_time_balance in sync in-memory after each payroll entry save. */
  const [lieuBalanceByUserId, setLieuBalanceByUserId] = useState({});
  /** Immediate display on employee list after schedule import / save (before DB poll). */
  const [entrySnapshots, setEntrySnapshots] = useState({});
  const [entriesRefreshVersion, setEntriesRefreshVersion] = useState(0);

  /** Latest hours for async handlers (schedule import save loop) — avoids stale closure when merging premium_hours. */
  const employeeHoursRef = useRef(employeeHours);
  useEffect(() => {
    employeeHoursRef.current = employeeHours;
  }, [employeeHours]);

  const allPremiumsRef = useRef(allPremiums);
  useEffect(() => {
    allPremiumsRef.current = allPremiums;
  }, [allPremiums]);

  // Security context
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'PayrollEntryTab',
    sensitiveComponent: true,
    enableRateLimiting: false,
    enableAuditLogging: false,
    securityLevel: 'medium'
  });

  // Authentication context
  const {
    selectedBusinessId: authBusinessId,
    authUser,
    userRole,
    businessData: authBusinessData
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'hr_admin'],
    requireBusiness: true,
    componentName: 'PayrollEntryTab'
  });

  // Use effective business ID with fallback
  const effectiveBusinessId = selectedBusinessId || authBusinessId;
  const effectiveBusinessData = businessData || authBusinessData;

  // Tax calculations with error handling
  const { formatTaxAmount } = useTaxCalculations(effectiveBusinessId);

  // Payroll calculations hook
  const payrollCalculations = usePayrollCalculations(effectiveBusinessId);
  const ytd = useYTDCalculations(effectiveBusinessId);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const workingPeriodStart = payrollRun?.pay_period_start || selectedPeriod?.start || '';
  const workingPeriodEnd = payrollRun?.pay_period_end || selectedPeriod?.end || '';

  const recordEntrySnapshot = useCallback((employeeId, hours, preview) => {
    if (!employeeId || !preview) return;
    setEntrySnapshots((prev) => ({
      ...prev,
      [employeeId]: {
        user_id: employeeId,
        total_hours: parseFloat(hours?.total_hours) || 0,
        regular_hours:
          parseFloat(preview.regular_hours_paid ?? preview.regular_hours) || 0,
        overtime_hours: parseFloat(preview.overtime_hours ?? hours?.overtime_hours) || 0,
        lieu_hours: parseFloat(preview.lieu_used) || 0,
        lieu_used: parseFloat(preview.lieu_used) || 0,
        lieu_earned: parseFloat(preview.lieu_earned) || 0,
        lieu_pay: parseFloat(preview.lieu_pay) || 0,
        net_pay: parseFloat(preview.net_pay) || 0,
        gross_pay: parseFloat(preview.gross_pay) || 0,
        additional_tax:
          parseFloat(preview.additional_federal_tax ?? preview.additional_tax) || 0,
      },
    }));
    setEntriesRefreshVersion((v) => v + 1);
  }, []);

  const employeesWithFreshLieuBalance = useMemo(() => {
    if (!employees || !Array.isArray(employees)) return [];
    return employees.map((emp) => {
      if (!emp?.id || lieuBalanceByUserId[emp.id] === undefined) return emp;
      return { ...emp, lieu_time_balance: lieuBalanceByUserId[emp.id] };
    });
  }, [employees, lieuBalanceByUserId]);

  // Terminated: only if termination is not before this pay period; when no period yet, omit terminated
  const employeesForCurrentPeriod = useMemo(() => {
    if (!employeesWithFreshLieuBalance || !Array.isArray(employeesWithFreshLieuBalance)) return [];
    if (!workingPeriodStart) {
      return employeesWithFreshLieuBalance.filter(
        (e) => String(e.employment_status || '').toLowerCase() !== 'terminated'
      );
    }
    return employeesWithFreshLieuBalance.filter((e) =>
      isPayrollVisibleForPeriod(e, workingPeriodStart, workingPeriodEnd)
    );
  }, [employeesWithFreshLieuBalance, workingPeriodStart, workingPeriodEnd]);

  // Safe employee sorting
  const sortedEmployees = useMemo(() => {
    if (!employeesForCurrentPeriod || !Array.isArray(employeesForCurrentPeriod)) {
      return [];
    }

    try {
      return [...employeesForCurrentPeriod].sort((a, b) => {
        if (!a || !b) return 0;

        const getDisplayName = (emp) => {
          if (emp.full_name) return emp.full_name;
          if (emp.name) return emp.name;
          const firstName = emp.first_name || '';
          const lastName = emp.last_name || '';
          return `${firstName} ${lastName}`.trim() || 'Unknown';
        };

        const nameA = getDisplayName(a).toLowerCase();
        const nameB = getDisplayName(b).toLowerCase();

        return nameA.localeCompare(nameB);
      });
    } catch (error) {
      console.error('Error sorting employees:', error);
      return employeesForCurrentPeriod || [];
    }
  }, [employeesForCurrentPeriod]);

  // Load employee data and premiums
  const loadEmployeeDataAndPremiums = useCallback(async () => {
    if (!effectiveBusinessId || !sortedEmployees || sortedEmployees.length === 0) {
      return;
    }

    // REMOVED: Force refresh logic that was causing infinite reload loop

    try {
      setError(null);
      const employeeIds = sortedEmployees.map(emp => emp?.id).filter(Boolean);
      
      if (employeeIds.length === 0) {
        return;
      }

      // Abort any existing requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      
      // Load all active premiums
      const { data: allPremiumsData, error: allPremiumsError } = await supabase
        .from('hr_shift_premiums')
        .select('*')
        .eq('business_id', effectiveBusinessId)
        .eq('is_active', true)
        .order('name')
        .abortSignal(abortControllerRef.current.signal);

      if (allPremiumsError && allPremiumsError.name !== 'AbortError') {
        setAllPremiums([]);
      } else if (!allPremiumsError) {
        setAllPremiums(allPremiumsData || []);
      }

      // Load premium assignments
      const { data: premiumAssignments, error: premiumError } = await supabase
        .from('hrpayroll_employee_premiums')
        .select('*')
        .eq('business_id', effectiveBusinessId)
        .in('user_id', employeeIds)
        .eq('is_active', true)
        .abortSignal(abortControllerRef.current.signal);

      if (premiumError && premiumError.name !== 'AbortError') {
        console.error('Error loading premium assignments:', premiumError);
      }

      // Organize premium assignments by employee
      const premiumsByEmployee = {};
      employeeIds.forEach(empId => {
        premiumsByEmployee[empId] = {};
      });

      if (premiumAssignments && Array.isArray(premiumAssignments)) {
        premiumAssignments.forEach(assignment => {
          if (assignment && assignment.user_id && premiumsByEmployee[assignment.user_id] !== undefined) {
            premiumsByEmployee[assignment.user_id][assignment.premium_name] = {
              rate: assignment.premium_rate || 0,
              rate_type: assignment.rate_type || 'fixed_amount',
              enabled: true
            };
          }
        });
      }

      if (isMountedRef.current) {
        setEmployeePremiums(premiumsByEmployee);

        // Initialize employee data structures
        const initialHours = {};
        const initialAdditionalFedTax = {};
        const initialStatHolidayPay = {};
        const initialHolidayPay = {};
        const initialHolidayDetails = {};
        
        sortedEmployees.forEach(emp => {
          if (emp && emp.id) {
            initialHours[emp.id] = {
              total_hours: 0,
              regular_hours: 0,
              lieu_earned: 0,
              lieu_balance: emp.lieu_time_balance || 0,
              overtime_hours: 0,
              stat_worked_hours: 0,
              premium_hours: {},
              wage_period_hours: []
            };

            // Pull additional tax from employee profile if set, otherwise default to 0
            initialAdditionalFedTax[emp.id] = parseFloat(emp.additional_tax_per_period || 0);
            initialStatHolidayPay[emp.id] = 0;
            initialHolidayPay[emp.id] = 0;
            initialHolidayDetails[emp.id] = null;

            // Initialize premium hours
            (allPremiumsData || []).forEach(premium => {
              if (premium && premium.name && premiumsByEmployee[emp.id]?.[premium.name]?.enabled) {
                initialHours[emp.id].premium_hours[premium.name] = 0;
              }
            });
          }
        });

        setEmployeeHours((prev) => {
          const merged = { ...initialHours };
          Object.keys(prev || {}).forEach((id) => {
            const old = prev[id];
            const slot = merged[id];
            if (!old) return;
            const total = parseFloat(old.total_hours) || 0;
            const prem = old.premium_hours || {};
            const hasPrem = Object.keys(prem).some((k) => parseFloat(prem[k]) > 0);
            const hadEntry =
              total > 0 ||
              hasPrem ||
              (Array.isArray(old.wage_period_hours) && old.wage_period_hours.length > 0);
            if (!hadEntry) return;
            if (slot) {
              merged[id] = {
                ...slot,
                ...old,
                premium_hours: {
                  ...slot.premium_hours,
                  ...prem
                },
                lieu_balance: old.lieu_balance ?? slot.lieu_balance
              };
            } else {
              merged[id] = old;
            }
          });
          return merged;
        });
        setEmployeeAdditionalFedTax(initialAdditionalFedTax);
        setEmployeeStatHolidayPay(initialStatHolidayPay);
        setEmployeeHolidayPay(initialHolidayPay);
        setEmployeeHolidayDetails(initialHolidayDetails);
      }

      // Safe security logging
      try {
        if (logSecurityEvent && typeof logSecurityEvent === 'function') {
          await logSecurityEvent('payroll_data_loaded', {
            business_id: effectiveBusinessId,
            employee_count: employeeIds.length,
            total_premiums: allPremiumsData?.length || 0,
            premium_assignments: premiumAssignments?.length || 0
          }, 'low');
        }
      } catch (securityError) {
        // Silent fail for security logging
      }

    } catch (error) {
      if (error.name !== 'AbortError' && isMountedRef.current) {
        console.error('Error loading employee data and premiums:', error);
        setError('Failed to load employee data. Please refresh and try again.');
        
        try {
          if (logSecurityEvent && typeof logSecurityEvent === 'function') {
            await logSecurityEvent('payroll_data_load_error', {
              business_id: effectiveBusinessId,
              error: error.message
            }, 'medium');
          }
        } catch (securityError) {
          // Silent fail
        }
      }
    }
  }, [effectiveBusinessId, sortedEmployees, logSecurityEvent]);

  // Load data when employees change
  useEffect(() => {
    if (sortedEmployees && sortedEmployees.length > 0) {
      loadEmployeeDataAndPremiums();
    }
  }, [loadEmployeeDataAndPremiums]);

  // FORCE REFRESH: Manual refresh function to reload employee data
  const forceRefreshEmployeeData = useCallback(async () => {
    console.log('🔄 MANUAL REFRESH: Forcing employee data refresh...');
    // Only reload when button is clicked, not automatically
    if (confirm('This will refresh the page to fix vacation pay values. Continue?')) {
      window.location.reload();
    }
  }, []);

  // Helper functions for premium management
  const isEmployeePremiumEnabled = useCallback((employeeId, premiumName) => {
    try {
      return employeePremiums[employeeId]?.[premiumName]?.enabled || false;
    } catch (error) {
      return false;
    }
  }, [employeePremiums]);

  const getEmployeePremiumRate = useCallback((employeeId, premiumName) => {
    try {
      const premium = employeePremiums[employeeId]?.[premiumName];
      return premium ? (premium.rate || 0) : 0;
    } catch (error) {
      return 0;
    }
  }, [employeePremiums]);

  const getEmployeePremiumRateType = useCallback((employeeId, premiumName) => {
    try {
      const premium = employeePremiums[employeeId]?.[premiumName];
      return premium ? (premium.rate_type || 'fixed_amount') : 'fixed_amount';
    } catch (error) {
      return 'fixed_amount';
    }
  }, [employeePremiums]);

  // Holiday pay change handler
  const handleHolidayPayChange = useCallback(async (employeeId, holidayPayAmount, holidayDetails) => {
    if (!employeeId) return;

    try {
      if (recordAction && typeof recordAction === 'function') {
        await recordAction('holiday_pay_updated', employeeId, true);
      }
      
      setEmployeeHolidayPay(prev => ({
        ...prev,
        [employeeId]: holidayPayAmount || 0
      }));
      
      setEmployeeHolidayDetails(prev => ({
        ...prev,
        [employeeId]: holidayDetails
      }));

      if (logSecurityEvent && typeof logSecurityEvent === 'function') {
        await logSecurityEvent('employee_holiday_pay_changed', {
          employee_id: employeeId,
          holiday_pay_amount: holidayPayAmount,
          holiday_date: holidayDetails?.holidayDate,
          holiday_name: holidayDetails?.holidayName,
          business_id: effectiveBusinessId
        }, 'low');
      }

    } catch (error) {
      console.error('Error handling holiday pay change:', error);
    }
  }, [recordAction, logSecurityEvent, effectiveBusinessId]);

  // Employee preview calculation using payroll calculations hook
  const getEmployeePreview = useCallback(async (employeeId, hoursOverride = null, additionalFedTaxOverride = null, statHolidayOverride = null, employeeOverride = null, holidayPayOverride = null, holidayDetailsOverride = null) => {
    const defaultPreview = {
      gross_pay: 0,
      vacation_pay: 0,
      total_deductions: 0,
      net_pay: 0,
      total_hours: 0,
      regular_hours: 0,
      regular_hours_paid: 0,
      lieu_earned: 0,
      lieu_used: 0,
      lieu_balance: 0,
      lieu_balance_before: 0,
      lieu_balance_after: 0,
      stat_holiday_hours: 0,
      federal_tax: 0,
      provincial_tax: 0,
      base_provincial_tax: 0,
      ontario_health_premium: 0,
      ei_deduction: 0,
      ei_premium: 0,
      cpp_deduction: 0,
      cpp_contribution: 0,
      premium_pay: 0,
      premium_details: {},
      additional_federal_tax: 0,
      holiday_pay: 0,
      holiday_details: null,
      calculation_method: 'no_data'
    };

    try {
      const employee = employeeOverride || sortedEmployees?.find(e => e?.id === employeeId);
      const hours = hoursOverride ? hoursOverride[employeeId] : employeeHours[employeeId];
      const additionalFedTax = additionalFedTaxOverride !== null ? 
        additionalFedTaxOverride[employeeId] : (employeeAdditionalFedTax[employeeId] || 0);
      const statHolidayHours = statHolidayOverride !== null ?
        statHolidayOverride[employeeId] :
        (parseFloat(hours?.stat_worked_hours) || employeeStatHolidayPay[employeeId] || 0);
      
      const holidayPayAmount =
        holidayPayOverride !== null
          ? (holidayPayOverride[employeeId] ?? 0)
          : (employeeHolidayPay[employeeId] || 0);
      const holidayDetails =
        holidayDetailsOverride !== null
          ? holidayDetailsOverride[employeeId]
          : employeeHolidayDetails[employeeId];

      if (!employee || !hours) {
        return defaultPreview;
      }

      // Use advanced calculation with payroll hook
      if (payrollCalculations && payrollCalculations.calculateEmployeePay) {
        try {
          const totalWorkedHours = parseFloat(hours.total_hours) || 0;
          const overtimeHours = parseFloat(hours.overtime_hours) || 0;
          const regularHours = Math.max(0, totalWorkedHours - overtimeHours);

          // Prepare hours object for payroll calculations
          const payrollHours = {
            total_hours: totalWorkedHours,
            regular_hours: regularHours,
            overtime_hours: overtimeHours,
            stat_worked_hours: statHolidayHours,
            holiday_pay: holidayPayAmount,
            premium_hours: hours.premium_hours || {},
            premiums: {},
            wage_period_hours: hours.wage_period_hours || []
          };

          // Add premium data
          if (allPremiums && Array.isArray(allPremiums)) {
            allPremiums.forEach(premium => {
              if (premium && premium.name) {
                const premiumHours = parseFloat(hours.premium_hours?.[premium.name]) || 0;
                if (premiumHours > 0 && isEmployeePremiumEnabled(employeeId, premium.name)) {
                  payrollHours.premiums[premium.name] = {
                    enabled: true,
                    hours: premiumHours,
                    rate: getEmployeePremiumRate(employeeId, premium.name),
                    rate_type: getEmployeePremiumRateType(employeeId, premium.name),
                    name: premium.name
                  };
                }
              }
            });
          }

          const calculation = await payrollCalculations.calculateEmployeePay(
            employee,
            payrollHours,
            {
              yearToDateGross: 0,
              yearToDateEI: 0,
              yearToDateCPP: 0,
              yearToDateFederalTax: 0,
              yearToDateProvincialTax: 0
            },
            additionalFedTax,
            {
              start: payrollRun?.pay_period_start || selectedPeriod?.start,
              end: payrollRun?.pay_period_end || selectedPeriod?.end
            }
          );

          if (calculation) {
            const calculationGrossPay = parseFloat(calculation.gross_pay) || 0;
            const employeeWage = resolveEffectiveEmployeeWage(employee);
            if (totalWorkedHours > 0 && employeeWage > 0 && calculationGrossPay <= 0) {
              throw new Error('Payroll calculation returned zero gross for paid hours.');
            }

            const totalGrossWithVacationAndHoliday =
              calculation.gross_pay + calculation.vacation_pay + holidayPayAmount;
            const correctNetPay = totalGrossWithVacationAndHoliday - calculation.total_deductions;

            const basePreview = {
              gross_pay: calculation.gross_pay,
              vacation_pay: calculation.vacation_pay,
              federal_tax: calculation.federal_tax,
              additional_federal_tax: calculation.additional_federal_tax,
              total_federal_tax: calculation.total_federal_tax,
              provincial_tax: calculation.provincial_tax,
              base_provincial_tax: calculation.base_provincial_tax,
              ontario_health_premium: calculation.ontario_health_premium || 0,
              ei_deduction: calculation.ei_premium,
              ei_premium: calculation.ei_premium,
              cpp_deduction: calculation.cpp_contribution,
              cpp_contribution: calculation.cpp_contribution,
              total_deductions: calculation.total_deductions,
              net_pay: Math.max(0, correctNetPay),
              total_hours: totalWorkedHours,
              regular_hours: calculation.regular_hours_worked || regularHours,
              regular_hours_paid: calculation.regular_hours_paid ?? regularHours,
              overtime_hours: calculation.overtime_hours || 0,
              lieu_earned: calculation.lieu_earned || 0,
              lieu_used: calculation.lieu_used || 0,
              lieu_pay: calculation.lieu_pay || 0,
              lieu_balance_before: calculation.lieu_balance_before || 0,
              lieu_balance_after: calculation.lieu_balance_after || 0,
              lieu_balance: calculation.lieu_balance_after || 0,
              stat_holiday_hours: calculation.stat_holiday_hours || 0,
              premium_hours:
                calculation.premium_pay > 0
                  ? Object.values(payrollHours.premiums).reduce(
                      (sum, p) => sum + (p.hours || 0),
                      0
                    )
                  : 0,
              premium_pay: calculation.premium_pay,
              premium_details: calculation.premium_breakdown,
              holiday_pay: holidayPayAmount,
              holiday_details: holidayDetails,
              health_premium_details: calculation.health_premium_details,
              cra_compliance: calculation.cra_compliance,
              has_wage_changes: calculation.has_wage_changes,
              wage_breakdown: calculation.wage_breakdown,
              lieu_calculation: calculation.lieu_calculation,
              calculation_method: 'cra_t4127_with_lieu_time',
            };

            const finalized = applyLieuToPayrollPreview(employee, hours, basePreview, {
              statHolidayHours,
              holidayPayAmount,
            });

            return {
              ...basePreview,
              gross_pay: finalized.gross_pay,
              vacation_pay: finalized.vacation_pay,
              total_deductions: finalized.total_deductions,
              net_pay: finalized.net_pay,
              lieu_earned: finalized.lieu_earned,
              lieu_used: finalized.lieu_used,
              lieu_pay: finalized.lieu_pay,
              lieu_balance_before: finalized.lieu_balance_before,
              lieu_balance_after: finalized.lieu_balance_after,
              lieu_balance: finalized.lieu_balance,
            };
          }
        } catch (calcError) {
          console.error('Advanced calculation failed:', calcError);
        }
      }

      // Fallback calculation (simplified)
      const wage = resolveEffectiveEmployeeWage(employee);
      const totalWorkedHours = parseFloat(hours.total_hours) || 0;
      const overtimeHours = parseFloat(hours.overtime_hours) || 0;
      const regularWorkedHours = totalWorkedHours - overtimeHours;
      
      // ✅ FIXED: Convert holiday pay to equivalent hours
      const holidayPayHours = holidayPayAmount > 0 && wage > 0 ? 
        (holidayPayAmount / wage) : 0;
      
      // ✅ FIXED: Lieu calculation with auto-fill logic
      let regularHoursPaid = regularWorkedHours;
      let lieuEarned = 0;
      let lieuUsed = 0;
      let lieuPay = 0;
      let lieuBalanceAfter = resolveAvailableLieuBalance(employee);
      
      if (employee?.lieu_time_enabled) {
        const maxHours = parseFloat(employee.max_paid_hours_per_period || 0);
        const currentBalance = resolveAvailableLieuBalance(employee);
        
        // ✅ CRITICAL: Include holiday pay hours in total compensation
        // totalWorkedHours already includes regular + overtime hours
        const totalCompensationHours = totalWorkedHours + statHolidayHours + holidayPayHours;
        
        // Enhanced debugging for lieu time calculation
        console.log('🔄 LIEU TIME CALCULATION:', {
          employee: `${employee.first_name} ${employee.last_name}`,
          lieuTimeEnabled: employee.lieu_time_enabled,
          maxHours: maxHours,
          maxHoursRaw: employee.max_paid_hours_per_period,
          totalWorkedHours: totalWorkedHours,
          overtimeHours: overtimeHours,
          statHolidayHours: statHolidayHours,
          holidayPayHours: holidayPayHours,
          totalCompensationHours: totalCompensationHours,
          currentBalance: currentBalance
        });
        
        if (maxHours > 0) {
          if (totalCompensationHours > maxHours) {
            // ✅ OVER MAX: Earn lieu time (excess goes to bank)
            lieuEarned = totalCompensationHours - maxHours;
            // Pay up to max, minus stat and holiday hours and overtime
            regularHoursPaid = Math.max(0, maxHours - statHolidayHours - holidayPayHours - overtimeHours);
            lieuBalanceAfter = currentBalance + lieuEarned;
            
            console.log('🔄 LIEU EARNED:', {
              totalCompensation: totalCompensationHours,
              maxHours: maxHours,
              lieuEarned: lieuEarned,
              newBalance: lieuBalanceAfter,
              calculation: `${totalCompensationHours} - ${maxHours} = ${lieuEarned}`
            });
          } else if (currentBalance > 0) {
            // UNDER MAX: Auto-fill with lieu time only when balance is available
            const shortfall = maxHours - totalCompensationHours;
            lieuUsed = Math.min(shortfall, currentBalance);
            // Keep base hours at what was actually worked; pay lieu separately
            regularHoursPaid = regularWorkedHours;
            lieuPay = lieuUsed * wage;
            lieuBalanceAfter = currentBalance - lieuUsed;
            
            console.log('🔄 LIEU AUTO-FILL:', {
              totalCompensation: totalCompensationHours,
              maxHours: maxHours,
              shortfall: shortfall,
              lieuUsed: lieuUsed,
              regularHoursPaid: regularHoursPaid,
              newBalance: lieuBalanceAfter
            });
          }
        } else {
          console.warn('⚠️ LIEU TIME: max_paid_hours_per_period is 0 or not set. Lieu time calculation skipped.', {
            employee: `${employee.first_name} ${employee.last_name}`,
            maxHours: maxHours,
            maxHoursRaw: employee.max_paid_hours_per_period
          });
        }
      }
      
      const regularPay = regularHoursPaid * wage;
      const statHolidayPay = statHolidayHours * wage * 1.5;
      const overtimePay = overtimeHours * wage * 1.5;
      const basePay = regularPay + statHolidayPay + overtimePay;
      
      // Calculate premium pay
      let totalPremiumPay = 0;
      const premiumDetails = {};
      
      if (allPremiums && Array.isArray(allPremiums)) {
        allPremiums.forEach(premium => {
          if (premium && premium.name) {
            const premiumHours = parseFloat(hours.premium_hours?.[premium.name]) || 0;
            
            if (premiumHours > 0 && isEmployeePremiumEnabled(employeeId, premium.name)) {
              const premiumRate = getEmployeePremiumRate(employeeId, premium.name);
              const rateType = getEmployeePremiumRateType(employeeId, premium.name);
              
              let premiumAmount = 0;
              if (rateType === 'percentage') {
                premiumAmount = premiumHours * wage * (premiumRate / 100);
              } else {
                premiumAmount = premiumHours * premiumRate;
              }
              
              totalPremiumPay += premiumAmount;
              
              premiumDetails[premium.name] = {
                rate: premiumRate,
                rate_type: rateType,
                hours: premiumHours,
                total_pay: premiumAmount
              };
            }
          }
        });
      }
      
      const grossPay = basePay + totalPremiumPay + lieuPay;
      
      // Calculate vacation percent based on years of service (ESA requirement: 4% for <5 years, 6% for 5+ years)
      const calculateVacationPercent = (employee, defaultVacationPercent = 0.04) => {
        // If vacation_percent is explicitly set (not null/undefined), use it (might be an override)
        if (employee.vacation_percent != null) {
          let percent = parseFloat(employee.vacation_percent);
          // If it looks like a percentage (>= 1.0), convert to decimal
          if (percent >= 1.0) {
            percent = percent / 100;
          }
          return percent;
        }
        
        // If not set, calculate based on years of service (ESA requirement)
        if (employee.hire_date) {
          const hireDate = new Date(employee.hire_date);
          const currentDate = new Date();
          const yearsOfService = (currentDate - hireDate) / (365.25 * 24 * 60 * 60 * 1000);
          
          // ESA minimum: 4% for <5 years, 6% for 5+ years
          if (yearsOfService >= 5) {
            return 0.06;
          }
        }
        
        // Fall back to default (usually 4%)
        // Normalize defaultVacationPercent - if it's stored as percentage (>= 1.0), convert to decimal
        let defaultPercent = parseFloat(defaultVacationPercent || 0.04);
        if (defaultPercent >= 1.0) {
          defaultPercent = defaultPercent / 100;
        }
        return defaultPercent;
      };
      
      let vacationPercent = calculateVacationPercent(employee, settings?.default_vacation_percent);
      
      const vacationPay = grossPay * vacationPercent;
      const totalIncomeBeforeTax = grossPay + vacationPay + holidayPayAmount;

      // Simple tax calculation (preview-only fallback; real tax uses useCanadianTaxCalculations).
      // Updated for CRA 2026 (T4127 122nd Edition): federal lowest 14%, EI 1.63% (max $21.60/wk),
      // CPP 5.95% (employee max $4,230.45/yr ≈ $81.36/wk).
      const federalTax = Math.max(0, (totalIncomeBeforeTax - 310) * 0.14);
      const totalFederalTax = federalTax + additionalFedTax;
      const provincialTax = Math.max(0, (totalIncomeBeforeTax - 245) * 0.0505);
      const eiDeduction = Math.min(totalIncomeBeforeTax * 0.0163, 1123.07 / 52);
      const cppDeduction = Math.max(0, Math.min((totalIncomeBeforeTax - 3500 / 52) * 0.0595, 4230.45 / 52));
      
      const totalDeductions = totalFederalTax + provincialTax + eiDeduction + cppDeduction;
      const netPay = totalIncomeBeforeTax - totalDeductions;

      const fallbackPreview = {
        gross_pay: grossPay,
        vacation_pay: vacationPay,
        federal_tax: federalTax,
        additional_federal_tax: additionalFedTax,
        total_federal_tax: totalFederalTax,
        provincial_tax: provincialTax,
        base_provincial_tax: provincialTax,
        ontario_health_premium: 0,
        ei_deduction: eiDeduction,
        ei_premium: eiDeduction,
        cpp_deduction: cppDeduction,
        cpp_contribution: cppDeduction,
        total_deductions: totalDeductions,
        net_pay: Math.max(0, netPay),
        total_hours: totalWorkedHours,
        regular_hours: regularWorkedHours,
        regular_hours_paid: regularHoursPaid,
        overtime_hours: overtimeHours,
        lieu_earned: lieuEarned,
        lieu_used: lieuUsed,
        lieu_pay: lieuPay,
        lieu_balance_before: parseFloat(employee.lieu_time_balance || 0),
        lieu_balance_after: lieuBalanceAfter,
        lieu_balance: lieuBalanceAfter,
        stat_holiday_hours: statHolidayHours,
        premium_hours: Object.values(premiumDetails).reduce((sum, p) => sum + (p.hours || 0), 0),
        premium_pay: totalPremiumPay,
        premium_details: premiumDetails,
        holiday_pay: holidayPayAmount,
        holiday_details: holidayDetails,
        calculation_method: 'fallback_simplified',
      };

      const finalizedFallback = applyLieuToPayrollPreview(employee, hours, fallbackPreview, {
        statHolidayHours,
        holidayPayAmount,
      });

      return {
        ...fallbackPreview,
        gross_pay: finalizedFallback.gross_pay,
        vacation_pay: finalizedFallback.vacation_pay,
        total_deductions: finalizedFallback.total_deductions,
        net_pay: finalizedFallback.net_pay,
        lieu_earned: finalizedFallback.lieu_earned,
        lieu_used: finalizedFallback.lieu_used,
        lieu_pay: finalizedFallback.lieu_pay,
        lieu_balance_before: finalizedFallback.lieu_balance_before,
        lieu_balance_after: finalizedFallback.lieu_balance_after,
        lieu_balance: finalizedFallback.lieu_balance,
      };

    } catch (error) {
      console.error('Error in employee preview calculation:', error);
      return defaultPreview;
    }
  }, [
    sortedEmployees, 
    employeeHours, 
    employeeAdditionalFedTax, 
    employeeStatHolidayPay, 
    employeeHolidayPay, 
    employeeHolidayDetails, 
    allPremiums, 
    isEmployeePremiumEnabled, 
    getEmployeePremiumRate, 
    getEmployeePremiumRateType, 
    payrollCalculations,
    payrollRun,
    selectedPeriod
  ]);

  // Employee interaction handlers
  const handleEmployeeClick = useCallback((employee) => {
    if (employee && employee.id) {
      setSelectedEmployee(employee);
      setShowEmployeeModal(true);
    }
  }, []);

  /**
   * Timesheets do not store shift-lead hours in a column — they are computed from clocks/shifts
   * (see aggregateShiftLeadPremiumHoursForPayPeriod). When the payroll entry modal opens, pull the
   * same derived hours into `premium_hours` so the shift-lead field matches the schedule and can
   * be edited.
   */
  useEffect(() => {
    if (!showEmployeeModal || !selectedEmployee?.id || !effectiveBusinessId) {
      return;
    }
    const periodStart = payrollRun?.pay_period_start || selectedPeriod?.start;
    const periodEnd = payrollRun?.pay_period_end || selectedPeriod?.end;
    if (!periodStart || !periodEnd) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const snap = await fetchApprovedTimesheetSnapshot(
          effectiveBusinessId,
          periodStart,
          periodEnd
        );
        if (cancelled || !isMountedRef.current) {
          return;
        }
        const approvedRow = snap?.byEmployeeId?.[selectedEmployee.id];
        const [shiftLeadAgg, timesheetAgg] = await Promise.all([
          aggregateShiftLeadPremiumHoursForPayPeriod({
            businessId: effectiveBusinessId,
            periodStart,
            periodEnd
          }),
          aggregateTimesheetHoursForPayPeriod({
            businessId: effectiveBusinessId,
            periodStart,
            periodEnd
          })
        ]);
        if (cancelled || !isMountedRef.current) {
          return;
        }
        const fromSchedule = mapShiftLeadAggToEmployeePremiumHours(
          shiftLeadAgg,
          selectedEmployee.id,
          allPremiumsRef.current
        );
        const detectedStatHours = parseFloat(timesheetAgg.statByEmployeeId?.[selectedEmployee.id]) || 0;

        const applyStatSplitToHours = (cur, grossTotalHours) => {
          const existingStat =
            parseFloat(cur.stat_worked_hours) ||
            parseFloat(employeeStatHolidayPay[selectedEmployee.id]) ||
            0;
          const statToUse = existingStat > 0 ? existingStat : detectedStatHours;
          if (statToUse <= 0) {
            return { ...cur, stat_worked_hours: existingStat || 0 };
          }
          const split = buildPayrollHoursWithStatSplit({
            grossTotalHours,
            statWorkedHours: statToUse
          });
          return {
            ...cur,
            total_hours: split.total_hours,
            stat_worked_hours: split.stat_worked_hours
          };
        };

        if (approvedRow) {
          setEmployeeHours((prev) => {
            const cur = prev[selectedEmployee.id] || {};
            const withStat = applyStatSplitToHours(cur, approvedRow.total_hours);
            return {
              ...prev,
              [selectedEmployee.id]: {
                ...withStat,
                overtime_hours: approvedRow.overtime_hours,
                premium_hours: {
                  ...cur.premium_hours,
                  ...(approvedRow.premium_hours || {}),
                  ...fromSchedule
                }
              }
            };
          });
          if (detectedStatHours > 0) {
            setEmployeeStatHolidayPay((prev) => ({
              ...prev,
              [selectedEmployee.id]:
                parseFloat(prev[selectedEmployee.id]) || detectedStatHours
            }));
          }
        }

        const existingHolidayPay = parseFloat(employeeHolidayPay?.[selectedEmployee.id]) || 0;
        const holidaysInPeriod = getCanadianStatHolidaysForPeriod({
          jurisdiction: settings?.tax_jurisdiction || 'ON',
          periodStart,
          periodEnd
        });
        if (existingHolidayPay <= 0 && holidaysInPeriod.length > 0) {
          const holidayResult = await computeHolidayPayForEmployeeInPeriod({
            employee: selectedEmployee,
            businessId: effectiveBusinessId,
            periodStart,
            periodEnd,
            jurisdiction: settings?.tax_jurisdiction || 'ON',
            excludePayrollRunId: payrollRun?.id || null
          });
          if (holidayResult?.isEligible && holidayResult.amount > 0) {
            setEmployeeHolidayPay((prev) => ({
              ...prev,
              [selectedEmployee.id]: holidayResult.amount
            }));
            setEmployeeHolidayDetails((prev) => ({
              ...prev,
              [selectedEmployee.id]: {
                holidayDate: holidayResult.holidayDate,
                holidayName: holidayResult.holidayName,
                isEligible: true,
                missedShiftBefore: holidayResult.missedShiftBefore,
                missedShiftAfter: holidayResult.missedShiftAfter,
                calculationMethod: holidayResult.method
              }
            }));
          }
        }

        if (approvedRow) {
          return;
        }

        if (detectedStatHours > 0) {
          setEmployeeHours((prev) => {
            const cur = prev[selectedEmployee.id] || {};
            const gross =
              parseFloat(cur.total_hours) ||
              parseFloat(timesheetAgg.byEmployeeId?.[selectedEmployee.id]) ||
              0;
            const withStat = applyStatSplitToHours(cur, gross);
            return {
              ...prev,
              [selectedEmployee.id]: {
                ...cur,
                ...withStat,
                premium_hours: {
                  ...cur.premium_hours,
                  ...fromSchedule
                }
              }
            };
          });
          setEmployeeStatHolidayPay((prev) => ({
            ...prev,
            [selectedEmployee.id]:
              parseFloat(prev[selectedEmployee.id]) || detectedStatHours
          }));
          return;
        }

        if (Object.keys(fromSchedule).length === 0) {
          return;
        }

        setEmployeeHours((prev) => {
          const cur = prev[selectedEmployee.id] || {};
          return {
            ...prev,
            [selectedEmployee.id]: {
              ...cur,
              premium_hours: {
                ...cur.premium_hours,
                ...fromSchedule
              }
            }
          };
        });
      } catch (e) {
        if (isMountedRef.current) {
          console.warn('[PayrollEntryTab] shift lead hydrate on modal open:', e?.message || e);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    showEmployeeModal,
    selectedEmployee?.id,
    effectiveBusinessId,
    payrollRun?.pay_period_start,
    payrollRun?.pay_period_end,
    selectedPeriod?.start,
    selectedPeriod?.end
  ]);

  // Query database directly for payroll totals state
  const [payrollTotals, setPayrollTotals] = useState({
    totalEmployees: 0,
    totalHours: 0,
    totalGross: 0,
    totalNet: 0,
    totalPremiums: 0,
    totalAdditionalFedTax: 0,
    totalLieuEarned: 0,
    totalLieuUsed: 0,
    totalHolidayPay: 0,
    totalOntarioHealthPremium: 0
  });

  // Function to load payroll totals (extracted so it can be called after saving entries)
  // Must be defined before handleModalSave so it can be used there
  const loadPayrollTotals = useCallback(async (payrollRunIdOverride = null) => {
    const effectiveRunId = payrollRunIdOverride ?? payrollRun?.id;
    if (!effectiveRunId) {
      setPayrollTotals({
        totalEmployees: 0,
        totalHours: 0,
        totalGross: 0,
        totalNet: 0,
        totalPremiums: 0,
        totalAdditionalFedTax: 0,
        totalLieuEarned: 0,
        totalLieuUsed: 0,
        totalHolidayPay: 0,
        totalOntarioHealthPremium: 0
      });
      return;
    }

    try {
      const { data: entries, error } = await supabase
        .from('hrpayroll_entries')
        .select('*')
        .eq('payroll_run_id', effectiveRunId);

      if (error) throw error;

      let totals = {
        totalEmployees: 0,
        totalHours: 0,
        totalGross: 0,
        totalNet: 0,
        totalPremiums: 0,
        totalAdditionalFedTax: 0,
        totalLieuEarned: 0,
        totalLieuUsed: 0,
        totalHolidayPay: 0,
        totalOntarioHealthPremium: 0
      };

      entries?.forEach(entry => {
        totals.totalEmployees++;
        const employee = sortedEmployees?.find((e) => e?.id === entry.user_id);
        totals.totalHours += employee
          ? effectivePaidHours(entry, employee)
          : effectiveWorkedHours(entry);
        totals.totalGross += (parseFloat(entry.gross_pay) || 0) + (parseFloat(entry.vacation_pay) || 0);
        totals.totalNet += parseFloat(entry.net_pay) || 0;
        totals.totalAdditionalFedTax += parseFloat(entry.additional_tax) || 0;
        totals.totalHolidayPay += parseFloat(entry.holiday_pay) || 0;
        totals.totalLieuEarned += parseFloat(entry.lieu_earned) || 0;
        totals.totalLieuUsed += parseFloat(entry.lieu_hours) || 0;

        if (entry.premiums && typeof entry.premiums === 'object') {
          Object.values(entry.premiums).forEach(premium => {
            totals.totalPremiums += parseFloat(premium?.total_pay) || 0;
          });
        }
      });

      setPayrollTotals(totals);
    } catch (error) {
      console.error('Error loading payroll totals:', error);
    }
  }, [payrollRun?.id, sortedEmployees]);

  useEffect(() => {
    loadPayrollTotals();
  }, [loadPayrollTotals]);
  
  // Database save function with lieu time support
  const saveEmployeeEntryToDatabase = useCallback(async (employeeId, hours, additionalFedTax, statHolidayPay, preview, payrollRunOverride = null, employeeOverride = null) => {
    const activePayrollRun = payrollRunOverride || payrollRun;
    if (!activePayrollRun || !activePayrollRun.id) {
      return;
    }

    try {
      const employee = employeeOverride || sortedEmployees?.find(e => e?.id === employeeId);
      if (!employee) {
        console.error('Employee not found:', employeeId);
        return;
      }
      
      // Prepare premium data
      const premiumData = {};
      if (hours.premium_hours && allPremiums) {
        allPremiums.forEach(premium => {
          const premiumHours = parseFloat(hours.premium_hours[premium.name]) || 0;
          if (premiumHours > 0 && isEmployeePremiumEnabled(employeeId, premium.name)) {
            const premiumRate = getEmployeePremiumRate(employeeId, premium.name);
            const rateType = getEmployeePremiumRateType(employeeId, premium.name);
      
            // Calculate total_pay directly
            let totalPay = 0;
            if (rateType === 'percentage') {
              const wage = resolveEffectiveEmployeeWage(employee);
              totalPay = premiumHours * wage * (premiumRate / 100);
            } else {
              totalPay = premiumHours * premiumRate;
            }
      
            premiumData[premium.name] = {
              hours: premiumHours,
              rate: premiumRate,
              rate_type: rateType,
              total_pay: totalPay
            };
          }
        });
      }

      // Check if entry already exists. We also load the existing lieu fields so we can
      // back out the prior contribution to users.lieu_time_balance before applying the new one
      // (otherwise repeated saves of the same entry compound the deduction).
      const { data: existingEntry, error: checkError } = await supabase
        .from('hrpayroll_entries')
        .select('id, lieu_hours, lieu_earned, lieu_balance_before, lieu_balance_after')
        .eq('payroll_run_id', activePayrollRun.id)
        .eq('user_id', employeeId)
        .single();

      // === Lieu reconciliation (before pay totals — clamp used hours to available balance) ===
      const isDraftRun = activePayrollRun.status === 'draft';
      const oldUsed = parseFloat(existingEntry?.lieu_hours) || 0;
      const oldEarned = parseFloat(existingEntry?.lieu_earned) || 0;
      const oldContribution = oldEarned - oldUsed;

      const profileBalance = resolveAvailableLieuBalance(
        isDraftRun
          ? (
              await fetchLieuBalanceMapForEmployees(supabase, effectiveBusinessId, [employeeId])
            )[employeeId] ?? 0
          : (
              lieuBalanceByUserId[employeeId] !== undefined
                ? { lieu_time_balance: lieuBalanceByUserId[employeeId] }
                : employee
            )
      );

      let restoredLieuBalanceBefore;
      if (isDraftRun) {
        const pendingOtherDraftsNet = await fetchPendingDraftLieuNetForUser(
          supabase,
          effectiveBusinessId,
          employeeId,
          activePayrollRun.id
        );
        restoredLieuBalanceBefore = Math.max(0, profileBalance + pendingOtherDraftsNet);
      } else {
        const currentUserBalanceForLieu = profileBalance;
        restoredLieuBalanceBefore = currentUserBalanceForLieu - oldContribution;
      }

      const previewLieuUsed = parseFloat(preview.lieu_used) || 0;
      const newUsed = Math.min(
        previewLieuUsed,
        resolveAvailableLieuBalance(restoredLieuBalanceBefore)
      );
      const newEarned = parseFloat(preview.lieu_earned) || 0;
      const newContribution = newEarned - newUsed;
      const newLieuBalanceAfter = Math.max(0, restoredLieuBalanceBefore + newContribution);

      // Calculate final values (adjust gross if lieu use was clamped)
      let finalGrossPay = preview.gross_pay || 0;
      let finalVacationPay = preview.vacation_pay || 0;
      if (newUsed < previewLieuUsed - 0.0001) {
        const wage = resolveEffectiveEmployeeWage(employee);
        const lieuPayRemoved = (previewLieuUsed - newUsed) * wage;
        finalGrossPay = Math.max(0, finalGrossPay - lieuPayRemoved);
        const vacRate =
          parseFloat(preview.gross_pay) > 0
            ? parseFloat(preview.vacation_pay) / parseFloat(preview.gross_pay)
            : 0.04;
        finalVacationPay = finalGrossPay * vacRate;
        console.warn('[PayrollEntryTab] Clamped lieu hours to available balance', {
          employeeId,
          previewLieuUsed,
          newUsed,
          restoredLieuBalanceBefore,
        });
      }

      const holidayPayAmount = preview.holiday_pay || employeeHolidayPay[employeeId] || 0;
      const totalIncome = finalGrossPay + finalVacationPay + holidayPayAmount;
      
      // CRITICAL FIX: Save BASE amounts separately to avoid double-counting when displaying
      // - Save base federal tax (without additionalTax) as federal_tax
      // - Save additionalTax separately
      // - Save base provincial tax (OHP is already included in provincial_tax_total per CRA calculation)
      // - When displaying, components can add federal_tax + additional_tax together
      const baseFederalTax = parseFloat(preview.federal_tax) || 0; // Base federal tax (without additionalTax)
      const additionalTax = parseFloat(preview.additional_federal_tax) || parseFloat(additionalFedTax) || 0;
      const provincialTax = parseFloat(preview.provincial_tax_total) || parseFloat(preview.provincial_tax) || 0;
      // Note: OHP is already included in provincial_tax_total from CRA calculation, so we don't save it separately
      // It's extracted for display purposes only
      const ontarioHealthPremium = parseFloat(preview.ontario_health_premium) || 0;
      const eiDeduction = parseFloat(preview.ei_premium) || parseFloat(preview.ei_deduction) || 0;
      const cppDeduction = parseFloat(preview.cpp_contribution) || parseFloat(preview.cpp_deduction) || 0;
      
      // Use preview.total_deductions if available (already calculated correctly in PET-EmployeeEntryModal)
      // Otherwise calculate manually: total_federal_tax already includes additionalTax, and provincial_tax_total already includes OHP
      const totalDeductions = preview.total_deductions !== undefined 
        ? parseFloat(preview.total_deductions) || 0
        : (baseFederalTax + additionalTax) + provincialTax + eiDeduction + cppDeduction; // Add base + additional for federal
      const finalNetPay = preview.net_pay || Math.max(0, totalIncome - totalDeductions);

      // DEBUG: Log what we're saving
      console.log('[PayrollEntryTab] SAVING DEDUCTIONS:', {
        baseFederalTax,
        additionalTax,
        totalFederalTax: baseFederalTax + additionalTax,
        provincialTax,
        eiDeduction,
        cppDeduction,
        totalDeductions,
        previewTotalDeductions: preview.total_deductions,
        finalNetPay,
        totalIncome
      });

      // Prepare entry data with LIEU TIME fields
      const entryData = {
        payroll_run_id: activePayrollRun.id,
        business_id: effectiveBusinessId,
        user_id: employeeId,
        
        // Hours - including lieu time
        total_hours: parseFloat(hours.total_hours) || 0,
        regular_hours: preview.regular_hours_paid || preview.regular_hours || 0,
        overtime_hours: preview.overtime_hours || parseFloat(hours.overtime_hours) || 0,
        stat_holiday_hours: preview.stat_holiday_hours || 0,
        
        // LIEU TIME FIELDS — anchored to the reconciled "before" value so re-saves don't drift.
        lieu_hours: newUsed,
        lieu_earned: newEarned,
        lieu_balance_before: restoredLieuBalanceBefore,
        lieu_balance_after: newLieuBalanceAfter,
        
        // Premiums
        premiums: premiumData,
        
        // Pay amounts
        gross_pay: finalGrossPay,
        vacation_pay: finalVacationPay,
        holiday_pay: holidayPayAmount,
        
        // Tax deductions - SAVE BASE AMOUNTS SEPARATELY to avoid double-counting
        federal_tax: baseFederalTax, // Base federal tax (without additionalTax)
        provincial_tax: provincialTax, // Provincial tax (OHP already included per CRA calculation)
        ontario_health_premium: 0, // Don't save separately - it's already in provincial_tax
        ei_deduction: eiDeduction,
        cpp_deduction: cppDeduction,
        additional_tax: additionalTax, // Save separately - will be added to federal_tax when displaying
        
        // Net pay
        net_pay: finalNetPay,
        
        // Wage change info
        wage_breakdown: preview.wage_breakdown || null,
        has_wage_changes: preview.has_wage_changes || false,
        
        updated_at: new Date().toISOString()
      };

      if (existingEntry && !checkError) {
        // Update existing entry
        const { error: updateError } = await supabase
          .from('hrpayroll_entries')
          .update(entryData)
          .eq('id', existingEntry.id);

        if (updateError) throw updateError;
      } else {
        // Insert new entry
        entryData.created_at = new Date().toISOString();
        const { error: insertError } = await supabase
          .from('hrpayroll_entries')
          .insert(entryData);

        if (insertError) throw insertError;
      }

      // Draft payroll must not consume lieu from users.lieu_time_balance until finalized.
      // The entry stores preview snapshots; finalize applies them once.
      if (!isDraftRun && Math.abs(newLieuBalanceAfter - profileBalance) > 0.0001) {
        const { error: balanceError } = await supabase
          .from('users')
          .update({
            lieu_time_balance: newLieuBalanceAfter,
            updated_at: new Date().toISOString()
          })
          .eq('id', employeeId);

        if (balanceError) {
          console.error('Failed to update employee lieu balance:', balanceError);
        }
      }

      setLieuBalanceByUserId((prev) => ({
        ...prev,
        [employeeId]: newLieuBalanceAfter,
      }));

      recordEntrySnapshot(employeeId, hours, preview);

    } catch (error) {
      console.error('Error saving employee entry to database:', error);
      throw error;
    }
  }, [
    payrollRun, 
    sortedEmployees,
    recordEntrySnapshot, 
    allPremiums, 
    isEmployeePremiumEnabled, 
    getEmployeePremiumRate, 
    getEmployeePremiumRateType, 
    employeeHolidayPay,
    effectiveBusinessId,
    lieuBalanceByUserId,
  ]);

  // Modal save handler - must be defined after loadPayrollTotals
  const handleModalSave = useCallback(async (employeeId, newHours, newAdditionalFedTax, newStatHolidayPay, preview) => {
    if (!employeeId) return;

    try {
      if (recordAction && typeof recordAction === 'function') {
        await recordAction('employee_hours_update', employeeId, true);
      }
    } catch (error) {
      // Silent fail
    }

    // Update state
    setEmployeeHours(prev => ({
      ...prev,
      [employeeId]: {
        ...(newHours || {}),
        lieu_earned: preview?.lieu_earned ?? newHours?.lieu_earned ?? 0,
        lieu_used: preview?.lieu_used ?? newHours?.lieu_used ?? 0,
        lieu_balance: preview?.lieu_balance_after ?? newHours?.lieu_balance ?? 0,
      },
    }));

    setEmployeeAdditionalFedTax(prev => ({
      ...prev,
      [employeeId]: newAdditionalFedTax || 0
    }));

    setEmployeeStatHolidayPay(prev => ({
      ...prev,
      [employeeId]: newStatHolidayPay || 0
    }));

    // Save using the preview from the modal
    try {
      await saveEmployeeEntryToDatabase(employeeId, newHours, newAdditionalFedTax, newStatHolidayPay, preview);
      // Refresh payroll totals after saving
      await loadPayrollTotals();
    } catch (error) {
      console.error('Failed to save employee entry:', error);
      alert('Failed to save employee entry: ' + error.message);
    }
  }, [recordAction, saveEmployeeEntryToDatabase, loadPayrollTotals]);

  // Load draft payroll with saved database values
  const loadDraftPayrollRun = useCallback(async (draftRun) => {
    if (!draftRun || !draftRun.id) {
      alert('Invalid draft payroll selected');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      try {
        if (logSecurityEvent && typeof logSecurityEvent === 'function') {
          await logSecurityEvent('draft_payroll_loaded', {
            business_id: effectiveBusinessId,
            payroll_run_id: draftRun.id
          }, 'low');
        }
      } catch (securityError) {
        // Silent fail
      }

      setPayrollRun(draftRun);
      setSelectedPeriod({
        start: draftRun.pay_period_start || '',
        end: draftRun.pay_period_end || '',
        payDate: draftRun.pay_date || ''
      });

      // Load existing entries
      const { data: entries, error: entriesError } = await supabase
        .from('hrpayroll_entries')
        .select('*')
        .eq('payroll_run_id', draftRun.id);

      if (entriesError) {
        console.error('Error loading payroll entries:', entriesError);
        throw new Error('Failed to load payroll entries');
      }

      if (entries && Array.isArray(entries) && entries.length > 0) {
        const hoursData = {};
        const additionalFedTaxData = {};
        const statHolidayData = {};
        const holidayPayData = {};
        const holidayDetailsData = {};

        entries.forEach(entry => {
          if (entry && entry.user_id) {
            hoursData[entry.user_id] = {
              total_hours: entry.total_hours || 0,
              regular_hours: entry.regular_hours || 0,
              lieu_earned: entry.lieu_earned || 0,
              lieu_used: entry.lieu_hours || 0,
              lieu_balance: entry.lieu_balance_after || 0,
              overtime_hours: entry.overtime_hours || 0,
              stat_worked_hours: entry.stat_holiday_hours || 0,
              premium_hours: {},
              wage_period_hours: entry.wage_breakdown || [],
              saved_gross_pay: parseFloat(entry.gross_pay) || 0,
              saved_vacation_pay: parseFloat(entry.vacation_pay) || 0,
              saved_net_pay: parseFloat(entry.net_pay) || 0
            };

            if (entry.premiums && typeof entry.premiums === 'object') {
              Object.entries(entry.premiums).forEach(([premiumName, premiumData]) => {
                if (premiumData && typeof premiumData === 'object') {
                  hoursData[entry.user_id].premium_hours[premiumName] = premiumData.hours || 0;
                }
              });
            }

            // Use saved additional_tax from entry, or fall back to employee profile default
            const savedAdditionalTax = parseFloat(entry.additional_tax || 0);
            const employee = sortedEmployees?.find(e => e?.id === entry.user_id);
            const employeeDefaultTax = parseFloat(employee?.additional_tax_per_period || 0);
            additionalFedTaxData[entry.user_id] = savedAdditionalTax > 0 ? savedAdditionalTax : employeeDefaultTax;
            statHolidayData[entry.user_id] = entry.stat_holiday_hours || 0;
            holidayPayData[entry.user_id] = entry.holiday_pay || 0;
            if (parseFloat(entry.holiday_pay) > 0) {
              const periodStart = draftRun.pay_period_start;
              const periodEnd = draftRun.pay_period_end;
              const holidays = getCanadianStatHolidaysForPeriod({
                jurisdiction: settings?.tax_jurisdiction || 'ON',
                periodStart,
                periodEnd
              });
              const pick = holidays.find((h) => h.name === 'Canada Day') || holidays[0];
              holidayDetailsData[entry.user_id] = {
                holidayDate: pick?.date || '',
                holidayName: pick?.name || 'Statutory Holiday',
                isEligible: true,
                missedShiftBefore: false,
                missedShiftAfter: false
              };
            }
          }
        });

        setEmployeeHours(prev => ({ ...prev, ...hoursData }));
        setEmployeeAdditionalFedTax(prev => ({ ...prev, ...additionalFedTaxData }));
        setEmployeeStatHolidayPay(prev => ({ ...prev, ...statHolidayData }));
        setEmployeeHolidayPay(prev => ({ ...prev, ...holidayPayData }));
        setEmployeeHolidayDetails(prev => ({ ...prev, ...holidayDetailsData }));

        const snapshots = {};
        entries.forEach((entry) => {
          if (!entry?.user_id) return;
          snapshots[entry.user_id] = {
            user_id: entry.user_id,
            total_hours: entry.total_hours,
            regular_hours: entry.regular_hours,
            overtime_hours: entry.overtime_hours,
            lieu_hours: entry.lieu_hours,
            lieu_used: entry.lieu_hours,
            lieu_earned: entry.lieu_earned,
            lieu_pay: Array.isArray(entry.wage_breakdown)
              ? entry.wage_breakdown.reduce(
                  (sum, period) => sum + (parseFloat(period?.lieu_pay) || 0),
                  0
                )
              : 0,
            net_pay: entry.net_pay,
            gross_pay: entry.gross_pay,
            additional_tax: entry.additional_tax,
          };
        });
        setEntrySnapshots(snapshots);
        setEntriesRefreshVersion((v) => v + 1);

        const previewLieuBalances = {};
        entries.forEach((entry) => {
          if (entry?.user_id && entry.lieu_balance_after != null) {
            previewLieuBalances[entry.user_id] = parseFloat(entry.lieu_balance_after) || 0;
          }
        });
        setLieuBalanceByUserId(previewLieuBalances);
      } else {
        setLieuBalanceByUserId({});
      }

      setShowDraftLookup(false);
      setSaveMessage(`Draft payroll loaded: ${draftRun.pay_period_start} to ${draftRun.pay_period_end}`);

    } catch (error) {
      console.error('Error loading draft payroll run:', error);
      setError('Failed to load draft payroll: ' + error.message);
    } finally {
      setLoading(false);
    }
  }, [effectiveBusinessId, logSecurityEvent]);

  // Payroll run creation
  const createPayrollRun = useCallback(async () => {
    if (!selectedPeriod.start || !selectedPeriod.end || !selectedPeriod.payDate) {
      setError('Please select all dates before creating a payroll run.');
      return;
    }

    if (!effectiveBusinessId) {
      setError('No business selected. Please select a business first.');
      return;
    }

    try {
      if (checkRateLimit && typeof checkRateLimit === 'function') {
        const rateLimitCheck = await checkRateLimit('create_payroll_run');
        if (!rateLimitCheck.allowed) {
          setError('Rate limit exceeded. Please wait before creating another payroll run.');
          return;
        }
      }
    } catch (error) {
      // Continue
    }

    setLoading(true);
    setSaveMessage('');
    setError(null);

    try {
      try {
        if (recordAction && typeof recordAction === 'function') {
          await recordAction('payroll_run_creation', authUser?.id, true);
        }
      } catch (error) {
        // Silent fail
      }
      
      try {
        if (logSecurityEvent && typeof logSecurityEvent === 'function') {
          await logSecurityEvent('payroll_run_created', {
            business_id: effectiveBusinessId,
            pay_period_start: selectedPeriod.start,
            pay_period_end: selectedPeriod.end,
            pay_date: selectedPeriod.payDate
          }, 'low');
        }
      } catch (error) {
        // Silent fail
      }

      const { data: existingDrafts, error: existingDraftsError } = await supabase
        .from('hrpayroll_runs')
        .select('id')
        .eq('business_id', effectiveBusinessId)
        .eq('status', 'draft')
        .eq('pay_period_start', selectedPeriod.start)
        .eq('pay_period_end', selectedPeriod.end);

      if (existingDraftsError) {
        throw new Error(existingDraftsError.message);
      }

      if ((existingDrafts || []).length > 0) {
        const proceed = window.confirm(
          `A draft payroll already exists for ${selectedPeriod.start} to ${selectedPeriod.end}.\n\n` +
            'Creating another draft can double-count lieu time. Load the existing draft instead if you can.\n\n' +
            'Create a new draft anyway?'
        );
        if (!proceed) {
          return;
        }
      }

      const { data, error } = await supabase
        .from('hrpayroll_runs')
        .insert({
          business_id: effectiveBusinessId,
          pay_period_start: selectedPeriod.start,
          pay_period_end: selectedPeriod.end,
          pay_date: selectedPeriod.payDate,
          status: 'draft',
          created_by: effectiveBusinessData?.user_id || authUser?.id || null
        })
        .select()
        .single();

      if (error) {
        throw new Error(error.message);
      }

      if (isMountedRef.current) {
        setPayrollRun(data);
        setLieuBalanceByUserId({});
        setSaveMessage('Payroll run created successfully! You can now enter employee hours.');
      }

    } catch (error) {
      if (isMountedRef.current) {
        console.error('Error creating payroll run:', error);
        setError('Failed to create payroll run: ' + error.message);
        
        try {
          if (recordAction && typeof recordAction === 'function') {
            await recordAction('payroll_run_creation', authUser?.id, false);
          }
        } catch (actionError) {
          // Silent fail
        }
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [selectedPeriod, effectiveBusinessId, checkRateLimit, recordAction, logSecurityEvent, authUser, effectiveBusinessData]);

  /**
   * Parallel path: same draft run insert as above, then prefills hrpayroll_entries from
   * scheduling_time_clocks (completed punches) in the selected pay period. Does not alter createPayrollRun.
   */
  const createPayrollRunFromScheduleModule = useCallback(async () => {
    if (!selectedPeriod.start || !selectedPeriod.end || !selectedPeriod.payDate) {
      setError('Please select all dates before creating a payroll run.');
      return;
    }

    if (!effectiveBusinessId) {
      setError('No business selected. Please select a business first.');
      return;
    }

    try {
      if (checkRateLimit && typeof checkRateLimit === 'function') {
        const rateLimitCheck = await checkRateLimit('create_payroll_run_from_schedule');
        if (!rateLimitCheck.allowed) {
          setError('Rate limit exceeded. Please wait before creating another payroll run.');
          return;
        }
      }
    } catch (err) {
      // Continue
    }

    setLoading(true);
    setSaveMessage('');
    setError(null);

    try {
      try {
        if (recordAction && typeof recordAction === 'function') {
          await recordAction('payroll_run_creation_from_schedule', authUser?.id, true);
        }
      } catch (err) {
        // Silent fail
      }

      try {
        if (logSecurityEvent && typeof logSecurityEvent === 'function') {
          await logSecurityEvent('payroll_run_created_from_schedule', {
            business_id: effectiveBusinessId,
            pay_period_start: selectedPeriod.start,
            pay_period_end: selectedPeriod.end,
            pay_date: selectedPeriod.payDate
          }, 'low');
        }
      } catch (err) {
        // Silent fail
      }

      const { data: existingDrafts, error: existingDraftsError } = await supabase
        .from('hrpayroll_runs')
        .select('id')
        .eq('business_id', effectiveBusinessId)
        .eq('status', 'draft')
        .eq('pay_period_start', selectedPeriod.start)
        .eq('pay_period_end', selectedPeriod.end);

      if (existingDraftsError) {
        throw new Error(existingDraftsError.message);
      }

      if ((existingDrafts || []).length > 0) {
        const proceed = window.confirm(
          `A draft payroll already exists for ${selectedPeriod.start} to ${selectedPeriod.end}.\n\n` +
            'Load/delete the existing draft instead unless you are intentionally replacing it.\n\n' +
            'Create another draft anyway?'
        );
        if (!proceed) {
          return;
        }
      }

      const { data: runRow, error: insertError } = await supabase
        .from('hrpayroll_runs')
        .insert({
          business_id: effectiveBusinessId,
          pay_period_start: selectedPeriod.start,
          pay_period_end: selectedPeriod.end,
          pay_date: selectedPeriod.payDate,
          status: 'draft',
          created_by: effectiveBusinessData?.user_id || authUser?.id || null
        })
        .select()
        .single();

      if (insertError) {
        throw new Error(insertError.message);
      }

      const run = runRow;

      const approvedSnap = await fetchApprovedTimesheetSnapshot(
        effectiveBusinessId,
        selectedPeriod.start,
        selectedPeriod.end
      );
      const approvedByEmp = approvedSnap?.byEmployeeId || {};
      const hasApprovedLines = Object.keys(approvedByEmp).length > 0;

      const [{ byEmployeeId, statByEmployeeId, clockCount, statHolidayDates }, shiftLeadAgg] = await Promise.all([
        aggregateTimesheetHoursForPayPeriod({
          businessId: effectiveBusinessId,
          periodStart: selectedPeriod.start,
          periodEnd: selectedPeriod.end
        }),
        aggregateShiftLeadPremiumHoursForPayPeriod({
          businessId: effectiveBusinessId,
          periodStart: selectedPeriod.start,
          periodEnd: selectedPeriod.end
        })
      ]);

      const shiftLeadPremiums = {};
      Object.keys(shiftLeadAgg?.byEmployeePremiumId || {}).forEach((empId) => {
        const perName = mapShiftLeadAggToEmployeePremiumHours(shiftLeadAgg, empId, allPremiums);
        if (Object.keys(perName).length) {
          shiftLeadPremiums[empId] = perName;
        }
      });

      const fedTaxStateUpdate = {};
      const statHolidayStateUpdate = {};
      const holidayPayStateUpdate = {};
      const holidayDetailsStateUpdate = {};
      const savedPreviewsByEmployee = {};
      let savedCount = 0;
      let statHolidayEmployeeCount = 0;
      let holidayPayEmployeeCount = 0;

      const jurisdiction = settings?.tax_jurisdiction || 'ON';
      const holidaysInPeriod = getCanadianStatHolidaysForPeriod({
        jurisdiction,
        periodStart: selectedPeriod.start,
        periodEnd: selectedPeriod.end
      });

      const employeeIdsToSave = new Set([
        ...Object.keys(byEmployeeId || {}),
        ...Object.keys(shiftLeadPremiums || {}),
        ...Object.keys(approvedByEmp)
      ]);

      const prevSnap = employeeHoursRef.current || {};

      const lieuEnabledIds = [...employeeIdsToSave].filter((id) => {
        const e = sortedEmployees?.find((x) => x?.id === id);
        return e?.lieu_time_enabled;
      });
      let freshLieuBalanceMap = {};
      if (lieuEnabledIds.length > 0 && effectiveBusinessId) {
        try {
          freshLieuBalanceMap = await fetchLieuBalanceMapForEmployees(
            supabase,
            effectiveBusinessId,
            lieuEnabledIds
          );
        } catch (lieuRefreshErr) {
          console.warn('Could not refresh lieu balances before schedule import:', lieuRefreshErr);
        }
      }

      const employeeForPayrollLieu = (emp) => {
        if (!emp?.lieu_time_enabled) return emp;
        return {
          ...emp,
          lieu_time_balance: resolvePayrollLieuBalance(emp, freshLieuBalanceMap[emp.id]),
        };
      };

      for (const empId of employeeIdsToSave) {
        const employee = employeeForPayrollLieu(sortedEmployees?.find((e) => e?.id === empId));
        if (!employee) continue;

        const approvedRow = hasApprovedLines ? approvedByEmp[empId] : undefined;
        const statHrs = parseFloat(statByEmployeeId[empId]) || 0;
        const grossTotal = approvedRow != null
          ? parseFloat(approvedRow.total_hours) || 0
          : parseFloat(byEmployeeId[empId]) || 0;
        const split = buildPayrollHoursWithStatSplit({
          grossTotalHours: grossTotal,
          statWorkedHours: statHrs
        });
        if (split.stat_worked_hours > 0) {
          statHolidayEmployeeCount += 1;
        }

        let hours;
        if (approvedRow != null) {
          hours = {
            total_hours: split.total_hours,
            stat_worked_hours: split.stat_worked_hours,
            overtime_hours: parseFloat(approvedRow.overtime_hours) || 0,
            premium_hours: {
              ...(approvedRow.premium_hours || {}),
              ...(shiftLeadPremiums[empId] || {})
            },
            wage_period_hours: prevSnap[empId]?.wage_period_hours || []
          };
        } else {
          const premiumHours = {
            ...(prevSnap[empId]?.premium_hours || {}),
            ...(shiftLeadPremiums[empId] || {})
          };
          const hasPremiumHours = Object.keys(premiumHours).some(
            (k) => parseFloat(premiumHours[k]) > 0
          );
          if (split.total_hours <= 0 && split.stat_worked_hours <= 0 && !hasPremiumHours) continue;

          hours = {
            total_hours: split.total_hours,
            stat_worked_hours: split.stat_worked_hours,
            overtime_hours: 0,
            premium_hours: premiumHours,
            wage_period_hours: prevSnap[empId]?.wage_period_hours || []
          };
        }

        const ph = hours.premium_hours || {};
        const hasPrem = Object.keys(ph).some((k) => parseFloat(ph[k]) > 0);
        if (hours.total_hours <= 0 && hours.stat_worked_hours <= 0 && !hasPrem) continue;

        const additionalFedTax = parseFloat(employee.additional_tax_per_period || 0);
        fedTaxStateUpdate[empId] = additionalFedTax;
        statHolidayStateUpdate[empId] = split.stat_worked_hours;

        let holidayPayForEmployee = 0;
        let holidayDetailsForEmployee = null;
        if (
          holidaysInPeriod.length > 0 &&
          (split.total_hours > 0 || split.stat_worked_hours > 0)
        ) {
          const holidayResult = await computeHolidayPayForEmployeeInPeriod({
            employee,
            businessId: effectiveBusinessId,
            periodStart: selectedPeriod.start,
            periodEnd: selectedPeriod.end,
            jurisdiction,
            excludePayrollRunId: payrollRun?.id || null
          });
          if (holidayResult?.isEligible && holidayResult.amount > 0) {
            holidayPayForEmployee = holidayResult.amount;
            holidayDetailsForEmployee = {
              holidayDate: holidayResult.holidayDate,
              holidayName: holidayResult.holidayName,
              isEligible: true,
              missedShiftBefore: holidayResult.missedShiftBefore,
              missedShiftAfter: holidayResult.missedShiftAfter,
              calculationMethod: holidayResult.method
            };
            holidayPayEmployeeCount += 1;
          }
        }
        holidayPayStateUpdate[empId] = holidayPayForEmployee;
        if (holidayDetailsForEmployee) {
          holidayDetailsStateUpdate[empId] = holidayDetailsForEmployee;
        }

        const statOverride = { [empId]: split.stat_worked_hours };
        const holidayPayOverride = { [empId]: holidayPayForEmployee };
        const holidayDetailsOverride = holidayDetailsForEmployee
          ? { [empId]: holidayDetailsForEmployee }
          : null;
        const preview = await getEmployeePreview(
          empId,
          { [empId]: hours },
          null,
          statOverride,
          employee,
          holidayPayOverride,
          holidayDetailsOverride
        );
        savedPreviewsByEmployee[empId] = preview;
        await saveEmployeeEntryToDatabase(
          empId,
          hours,
          additionalFedTax,
          split.stat_worked_hours,
          preview,
          run,
          employee
        );
        savedCount += 1;
      }

      if (isMountedRef.current) {
        setPayrollRun(run);
        setEmployeeHours((prev) => {
          const next = { ...prev };
          for (const empId of employeeIdsToSave) {
            const employee = sortedEmployees?.find((e) => e?.id === empId);
            if (!employee) continue;

            const approvedRow = hasApprovedLines ? approvedByEmp[empId] : undefined;
            const statHrs = parseFloat(statByEmployeeId[empId]) || 0;
            const grossTotal = approvedRow != null
              ? parseFloat(approvedRow.total_hours) || 0
              : parseFloat(byEmployeeId[empId]) || 0;
            const split = buildPayrollHoursWithStatSplit({
              grossTotalHours: grossTotal,
              statWorkedHours: statHrs
            });
            const savedPreview = savedPreviewsByEmployee[empId];
            if (!savedPreview && split.total_hours <= 0 && split.stat_worked_hours <= 0) continue;

            next[empId] = {
              ...(prev[empId] || {}),
              total_hours: split.total_hours,
              stat_worked_hours: split.stat_worked_hours,
              overtime_hours: approvedRow != null
                ? parseFloat(approvedRow.overtime_hours) || 0
                : 0,
              premium_hours: approvedRow != null
                ? {
                    ...(approvedRow.premium_hours || {}),
                    ...(shiftLeadPremiums[empId] || {})
                  }
                : {
                    ...(prev[empId]?.premium_hours || {}),
                    ...(shiftLeadPremiums[empId] || {})
                  },
              wage_period_hours: prev[empId]?.wage_period_hours || [],
              lieu_earned: savedPreview?.lieu_earned ?? 0,
              lieu_used: savedPreview?.lieu_used ?? 0,
              lieu_balance: savedPreview?.lieu_balance_after ?? prev[empId]?.lieu_balance ?? 0
            };
          }
          return next;
        });
        setEmployeeStatHolidayPay((prev) => ({ ...prev, ...statHolidayStateUpdate }));
        setEmployeeHolidayPay((prev) => ({ ...prev, ...holidayPayStateUpdate }));
        setEmployeeHolidayDetails((prev) => ({ ...prev, ...holidayDetailsStateUpdate }));
        setEmployeeAdditionalFedTax((prev) => ({ ...prev, ...fedTaxStateUpdate }));
        await loadPayrollTotals(run.id);

        const shiftLeadEmployees = Object.keys(shiftLeadPremiums || {}).filter(
          (id) =>
            Object.values(shiftLeadPremiums[id] || {}).some((h) => (h || 0) > 0)
        ).length;
        const usedApproved = hasApprovedLines;
        const statNote =
          statHolidayEmployeeCount > 0
            ? ` Stat holiday hours auto-detected for ${statHolidayEmployeeCount} employee(s)${
                statHolidayDates?.length ? ` (${statHolidayDates.join(', ')})` : ''
              }.`
            : '';
        const holidayNote =
          holidayPayEmployeeCount > 0
            ? ` Public holiday pay added for ${holidayPayEmployeeCount} eligible employee(s).`
            : '';
        const msg =
          savedCount > 0
            ? usedApproved
              ? `Payroll run created using approved time sheet snapshot for ${selectedPeriod.start}–${selectedPeriod.end}: ${savedCount} employee(s). Review entries before finalizing.${statNote}${holidayNote}`
              : `Payroll run created from schedule/time clocks: ${savedCount} employee(s) prefilled (${clockCount} clock record(s) in range${
                  shiftLeadEmployees > 0
                    ? `; shift-lead premium hours applied where applicable (${shiftLeadEmployees} employee(s))`
                    : ''
                }). Review entries before finalizing.${statNote}${holidayNote}`
            : `Payroll run created. No completed time clock punches found for ${selectedPeriod.start}–${selectedPeriod.end}. Enter hours manually or verify timesheets.`;
        setSaveMessage(msg);
      }
    } catch (error) {
      if (isMountedRef.current) {
        console.error('Error creating payroll run from schedule:', error);
        setError('Failed to create payroll run from schedule: ' + error.message);

        try {
          if (recordAction && typeof recordAction === 'function') {
            await recordAction('payroll_run_creation_from_schedule', authUser?.id, false);
          }
        } catch (actionError) {
          // Silent fail
        }
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [
    selectedPeriod,
    effectiveBusinessId,
    checkRateLimit,
    recordAction,
    logSecurityEvent,
    authUser,
    effectiveBusinessData,
    sortedEmployees,
    getEmployeePreview,
    saveEmployeeEntryToDatabase,
    loadPayrollTotals,
    allPremiums,
    recordEntrySnapshot,
    settings
  ]);
  
  // Payroll finalization function
  const handleFinalizePayroll = useCallback(async () => {
    if (!payrollRun || !payrollRun.id) {
      setError('No payroll run to finalize. Please create a payroll run first.');
      return;
    }

    // Validate that at least one employee has hours entered
    const hasEmployeeData = sortedEmployees?.some(employee => {
      const hours = employeeHours[employee.id];
      return hours && (
        (hours.regular_hours && hours.regular_hours > 0) ||
        (hours.overtime_hours && hours.overtime_hours > 0) ||
        (hours.lieu_hours && hours.lieu_hours > 0) ||
        (hours.total_hours && hours.total_hours > 0)
      );
    });

    if (!hasEmployeeData) {
      setError('Cannot finalize payroll without any employee hours entered.');
      return;
    }

    // Confirm finalization
    const confirmMessage = `Are you sure you want to finalize this payroll run?

Pay Period: ${selectedPeriod.start} to ${selectedPeriod.end}
Pay Date: ${selectedPeriod.payDate}
Employees: ${payrollTotals.totalEmployees}
Total Gross Pay: $${payrollTotals.totalGross.toFixed(2)}
Total Net Pay: $${payrollTotals.totalNet.toFixed(2)}
Lieu Earned: ${payrollTotals.totalLieuEarned.toFixed(2)} hours
Lieu Used: ${payrollTotals.totalLieuUsed.toFixed(2)} hours

Once finalized, this payroll cannot be edited from the Entry tab.
You will need to use the Edit Payroll tab for any changes.`;

    if (!confirm(confirmMessage)) {
      return;
    }

    setSaving(true);
    setError(null);
    setSaveMessage('');

    try {
      // Log security event
      try {
        if (logSecurityEvent && typeof logSecurityEvent === 'function') {
          await logSecurityEvent('payroll_finalization_started', {
            business_id: effectiveBusinessId,
            payroll_run_id: payrollRun.id,
            pay_period_start: selectedPeriod.start,
            pay_period_end: selectedPeriod.end,
            total_employees: payrollTotals.totalEmployees,
            total_gross_pay: payrollTotals.totalGross,
            total_net_pay: payrollTotals.totalNet,
            total_lieu_earned: payrollTotals.totalLieuEarned,
            total_lieu_used: payrollTotals.totalLieuUsed
          }, 'critical');
        }
      } catch (error) {
        // Silent fail
      }

      // Update payroll run status to 'finalized'
      const { error: finalizeError } = await supabase
        .from('hrpayroll_runs')
        .update({
          status: 'finalized',
          finalized_at: new Date().toISOString(),
          finalized_by: authUser?.id || effectiveBusinessData?.user_id,
          updated_at: new Date().toISOString()
        })
        .eq('id', payrollRun.id);

      if (finalizeError) {
        console.error('Finalization failed:', finalizeError);
        console.error('Payroll Run ID:', payrollRun.id);
        console.error('Update data:', { status: 'finalized', id: payrollRun.id });
        throw new Error(`Failed to finalize payroll: ${finalizeError.message}`);
      }

      // Commit lieu time to employee profiles from the ledger (now includes this finalized run).
      const { data: finalizedEntries } = await supabase
        .from('hrpayroll_entries')
        .select('user_id')
        .eq('payroll_run_id', payrollRun.id);
      const finalizedUserIds = [
        ...new Set((finalizedEntries || []).map((e) => e.user_id).filter(Boolean)),
      ];
      if (finalizedUserIds.length > 0) {
        await syncUsersLieuBalanceFromLedger(
          supabase,
          effectiveBusinessId,
          finalizedUserIds
        );
      }

      console.log('Successfully finalized payroll run:', payrollRun.id);

      // Update local state
      setPayrollRun(prev => ({
        ...prev,
        status: 'finalized',
        finalized_at: new Date().toISOString(),
        finalized_by: authUser?.id || effectiveBusinessData?.user_id
      }));

      // Record successful action
      try {
        if (recordAction && typeof recordAction === 'function') {
          await recordAction('payroll_finalized', payrollRun.id, true);
        }
      } catch (error) {
        // Silent fail
      }

      // Log security event for successful finalization
      try {
        if (logSecurityEvent && typeof logSecurityEvent === 'function') {
          await logSecurityEvent('payroll_finalized_successfully', {
            business_id: effectiveBusinessId,
            payroll_run_id: payrollRun.id,
            finalized_by: authUser?.id || effectiveBusinessData?.user_id,
            total_employees: payrollTotals.totalEmployees,
            total_gross_pay: payrollTotals.totalGross,
            total_net_pay: payrollTotals.totalNet,
            total_lieu_earned: payrollTotals.totalLieuEarned,
            total_lieu_used: payrollTotals.totalLieuUsed
          }, 'critical');
        }
      } catch (error) {
        // Silent fail
      }

      setSaveMessage(`✅ Payroll finalized successfully!

${payrollTotals.totalEmployees} employees processed
${payrollTotals.totalGross.toFixed(2)} total gross pay
${payrollTotals.totalNet.toFixed(2)} total net pay
${payrollTotals.totalLieuEarned.toFixed(2)} lieu hours earned
${payrollTotals.totalLieuUsed.toFixed(2)} lieu hours used

This payroll run is now locked and available in:
• Pay Statements tab for employee paystubs
• Tax Reports tab for CRA remittances
• Edit Payroll tab for any corrections`);

      // Optional: Refresh YTD data if available
      if (ytd?.refreshYTD && typeof ytd.refreshYTD === 'function') {
        try {
          await ytd.refreshYTD();
        } catch (error) {
          // Silent fail
        }
      }

      // Refresh dashboard stats if callback provided
      if (onPayrollFinalized && typeof onPayrollFinalized === 'function') {
        try {
          await onPayrollFinalized();
        } catch (error) {
          console.warn('Failed to refresh dashboard stats:', error);
        }
      }

    } catch (error) {
      console.error('Error finalizing payroll:', error);
      setError(`Failed to finalize payroll: ${error.message}`);
      
      // Log security event for failed finalization
      try {
        if (logSecurityEvent && typeof logSecurityEvent === 'function') {
          await logSecurityEvent('payroll_finalization_failed', {
            business_id: effectiveBusinessId,
            payroll_run_id: payrollRun.id,
            error_message: error.message,
            attempted_by: authUser?.id || effectiveBusinessData?.user_id
          }, 'high');
        }
      } catch (secError) {
        // Silent fail
      }

      // Record failed action
      try {
        if (recordAction && typeof recordAction === 'function') {
          await recordAction('payroll_finalization_failed', payrollRun.id, false);
        }
      } catch (actionError) {
        // Silent fail
      }

    } finally {
      setSaving(false);
    }
  }, [
    payrollRun, 
    sortedEmployees, 
    employeeHours, 
    employeeAdditionalFedTax, 
    employeeStatHolidayPay, 
    selectedPeriod, 
    payrollTotals, 
    effectiveBusinessId, 
    authUser, 
    effectiveBusinessData, 
    saveEmployeeEntryToDatabase,
    getEmployeePreview,
    logSecurityEvent, 
    recordAction,
    ytd
  ]);

  // Styles with fallbacks
  const styles = {
    container: {
      padding: TavariStyles.spacing?.lg || '16px',
      backgroundColor: TavariStyles.colors?.gray50 || '#f9fafb',
      minHeight: '100vh'
    },
    emptyState: {
      textAlign: 'center',
      color: TavariStyles.colors?.gray500 || '#6b7280',
      padding: TavariStyles.spacing?.xl || '20px',
      fontSize: TavariStyles.typography?.fontSize?.md || '15px'
    }
  };

  // Early return for no employees
  if (!sortedEmployees || sortedEmployees.length === 0) {
    return (
      <PayrollErrorBoundary>
        <POSAuthWrapper
          componentName="PayrollEntryTab"
          requiredRoles={['owner', 'manager', 'hr_admin']}
          requireBusiness={true}
        >
          <SecurityWrapper
            componentName="PayrollEntryTab"
            securityLevel="medium"
            enableAuditLogging={false}
            sensitiveComponent={true}
          >
            <div style={styles.container}>
              <div style={styles.emptyState}>
                No employees found. Please add employees before creating payroll runs.
              </div>
            </div>
          </SecurityWrapper>
        </POSAuthWrapper>
      </PayrollErrorBoundary>
    );
  }

  return (
    <PayrollErrorBoundary>
      <POSAuthWrapper
        componentName="PayrollEntryTab"
        requiredRoles={['owner', 'manager', 'hr_admin']}
        requireBusiness={true}
      >
        <SecurityWrapper
          componentName="PayrollEntryTab"
          securityLevel="medium"
          enableAuditLogging={false}
          sensitiveComponent={true}
        >
          <div style={styles.container}>
            {/* Period Setup Component */}
            <PETPeriodSetup
              selectedPeriod={selectedPeriod}
              setSelectedPeriod={setSelectedPeriod}
              payrollRun={payrollRun}
              loading={loading}
              onCreatePayrollRun={createPayrollRun}
              onCreatePayrollRunFromSchedule={createPayrollRunFromScheduleModule}
              onShowDraftLookup={() => setShowDraftLookup(true)}
              saveMessage={saveMessage}
              error={error}
            />

            {/* FORCE REFRESH BUTTON - Fix vacation pay cache issue */}
            <div style={{ textAlign: 'center', margin: '10px 0' }}>
              <button 
                onClick={forceRefreshEmployeeData}
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  border: '1px solid #3b82f6',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                🔄 Refresh Employee Data (Fix Vacation Pay)
              </button>
            </div>

            {/* Payroll Content */}
            {payrollRun && (
              <>
                {/* Payroll Summary Component */}
                <PETPayrollSummary payrollTotals={payrollTotals} />

                {/* Employee List Component */}
                <PETEmployeeList 
                  employees={sortedEmployees}
                  payrollRun={payrollRun}
                  employeeHours={employeeHours}
                  entrySnapshots={entrySnapshots}
                  entriesRefreshVersion={entriesRefreshVersion}
                  onEmployeeClick={handleEmployeeClick}
                />

                {payrollTotals.totalEmployees > 0 && (
                  <div style={{ textAlign: 'center', marginTop: TavariStyles.spacing?.xl || '20px' }}>
                    <button 
                      style={{
                        padding: '15px 30px',
                        borderRadius: TavariStyles.borderRadius?.md || '6px',
                        border: 'none',
                        fontSize: TavariStyles.typography?.fontSize?.md || '15px',
                        fontWeight: TavariStyles.typography?.fontWeight?.bold || '700',
                        cursor: 'pointer',
                        backgroundColor: TavariStyles.colors?.success || '#10b981',
                        color: TavariStyles.colors?.white || '#ffffff',
                        ...(saving ? { opacity: 0.6, cursor: 'not-allowed' } : {})
                      }} 
                      onClick={handleFinalizePayroll}
                      disabled={saving}
                    >
                      {saving ? 'Finalizing Payroll...' : `Save & Finalize Payroll (${payrollTotals.totalEmployees} employees)`}
                    </button>
                    <div style={{ 
                      marginTop: TavariStyles.spacing?.sm || '8px', 
                      fontSize: TavariStyles.typography?.fontSize?.sm || '14px', 
                      color: TavariStyles.colors?.gray600 || '#4b5563' 
                    }}>
                      This will finalize the payroll with lieu time tracking and make it available for pay statements.
                      {ytd?.loading ? ' YTD data will be automatically updated.' : ' YTD system ready for automatic updates.'}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Employee Entry Modal Component */}
            <PETEmployeeEntryModal
              isOpen={showEmployeeModal}
              onClose={() => {
                setShowEmployeeModal(false);
                setSelectedEmployee(null);
              }}
              employee={selectedEmployee}
              hours={selectedEmployee ? employeeHours[selectedEmployee.id] : null}
              additionalFedTax={selectedEmployee ? employeeAdditionalFedTax[selectedEmployee.id] : null}
              statHolidayPay={selectedEmployee ? employeeStatHolidayPay[selectedEmployee.id] : null}
              premiums={employeePremiums}
              allPremiums={allPremiums}
              onSave={handleModalSave}
              formatTaxAmount={formatTaxAmount}
              isEmployeePremiumEnabled={isEmployeePremiumEnabled}
              getEmployeePremiumRate={getEmployeePremiumRate}
              getEmployeePremiumRateType={getEmployeePremiumRateType}
              selectedBusinessId={effectiveBusinessId}
              businessData={effectiveBusinessData}
              settings={settings}
              payPeriod={selectedPeriod}
              onHolidayPayChange={handleHolidayPayChange}
              employeeHolidayPay={employeeHolidayPay}
              employeeHolidayDetails={employeeHolidayDetails}
            />

            {/* Draft Lookup Modal Component */}
            <PETDraftLookupModal
              isOpen={showDraftLookup}
              onClose={() => setShowDraftLookup(false)}
              effectiveBusinessId={effectiveBusinessId}
              onLoadDraft={loadDraftPayrollRun}
            />
          </div>
        </SecurityWrapper>
      </POSAuthWrapper>
    </PayrollErrorBoundary>
  );
};

export default PayrollEntryTab;