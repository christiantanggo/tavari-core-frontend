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
  settings = null 
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

  // Safe employee sorting
  const sortedEmployees = useMemo(() => {
    if (!employees || !Array.isArray(employees)) {
      return [];
    }
    
    try {
      return [...employees].sort((a, b) => {
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
      return employees || [];
    }
  }, [employees]);

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
              premium_hours: {},
              wage_period_hours: []
            };

            initialAdditionalFedTax[emp.id] = 0;
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
        
        setEmployeeHours(initialHours);
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
  const getEmployeePreview = useCallback(async (employeeId, hoursOverride = null, additionalFedTaxOverride = null, statHolidayOverride = null) => {
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
      const employee = sortedEmployees?.find(e => e?.id === employeeId);
      const hours = hoursOverride ? hoursOverride[employeeId] : employeeHours[employeeId];
      const additionalFedTax = additionalFedTaxOverride !== null ? 
        additionalFedTaxOverride[employeeId] : (employeeAdditionalFedTax[employeeId] || 0);
      const statHolidayHours = statHolidayOverride !== null ? 
        statHolidayOverride[employeeId] : (employeeStatHolidayPay[employeeId] || 0);
      
      const holidayPayAmount = employeeHolidayPay[employeeId] || 0;
      const holidayDetails = employeeHolidayDetails[employeeId];

      if (!employee || !hours) {
        return defaultPreview;
      }

      // Use advanced calculation with payroll hook
      if (payrollCalculations && payrollCalculations.calculateEmployeePay) {
        try {
          const totalWorkedHours = parseFloat(hours.total_hours) || 0;
          const overtimeHours = parseFloat(hours.overtime_hours) || 0;

          // Prepare hours object for payroll calculations
          const payrollHours = {
            total_hours: totalWorkedHours,
            overtime_hours: overtimeHours,
            stat_worked_hours: statHolidayHours,
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
            // Add holiday pay if present
            const totalGrossWithVacationAndHoliday = calculation.gross_pay + calculation.vacation_pay + holidayPayAmount;
            const correctNetPay = totalGrossWithVacationAndHoliday - calculation.total_deductions;

            return {
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
              regular_hours: calculation.regular_hours_worked || 0,
              regular_hours_paid: calculation.regular_hours_paid || 0,
              overtime_hours: calculation.overtime_hours || 0,
              lieu_earned: calculation.lieu_earned || 0,
              lieu_used: calculation.lieu_used || 0,
              lieu_balance_before: calculation.lieu_balance_before || 0,
              lieu_balance_after: calculation.lieu_balance_after || 0,
              lieu_balance: calculation.lieu_balance_after || 0,
              stat_holiday_hours: calculation.stat_holiday_hours || 0,
              premium_hours: calculation.premium_pay > 0 ? 
                Object.values(payrollHours.premiums).reduce((sum, p) => sum + (p.hours || 0), 0) : 0,
              premium_pay: calculation.premium_pay,
              premium_details: calculation.premium_breakdown,
              holiday_pay: holidayPayAmount,
              holiday_details: holidayDetails,
              health_premium_details: calculation.health_premium_details,
              cra_compliance: calculation.cra_compliance,
              has_wage_changes: calculation.has_wage_changes,
              wage_breakdown: calculation.wage_breakdown,
              lieu_calculation: calculation.lieu_calculation,
              calculation_method: 'cra_t4127_with_lieu_time'
            };
          }
        } catch (calcError) {
          console.error('Advanced calculation failed:', calcError);
        }
      }

      // Fallback calculation (simplified)
      const wage = parseFloat(employee.wage || 0);
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
      let lieuBalanceAfter = parseFloat(employee.lieu_time_balance || 0);
      
      if (employee?.lieu_time_enabled) {
        const maxHours = parseFloat(employee.max_paid_hours_per_period || 0);
        const currentBalance = parseFloat(employee.lieu_time_balance || 0);
        
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
          } else {
            // ✅ UNDER MAX: Auto-fill with lieu time to reach max without inflating base hours
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
      const statHolidayPay = statHolidayHours * wage;
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
      
      // FIXED: Use proper vacation pay calculation from employee settings or business defaults
      let vacationPercent = parseFloat(employee.vacation_percent || settings?.default_vacation_percent || 0.04);
      
      // If vacation_percent looks like a percentage (>= 1.0), convert it to decimal
      if (vacationPercent >= 1.0) {
        console.log('🔄 FIXING: Converting vacation_percent from percentage to decimal:', vacationPercent, '->', vacationPercent / 100);
        vacationPercent = vacationPercent / 100;
      }
      
      const vacationPay = grossPay * vacationPercent;
      const totalIncomeBeforeTax = grossPay + vacationPay + holidayPayAmount;

      // Simple tax calculation
      const federalTax = Math.max(0, (totalIncomeBeforeTax - 310) * 0.15);
      const totalFederalTax = federalTax + additionalFedTax;
      const provincialTax = Math.max(0, (totalIncomeBeforeTax - 245) * 0.0505);
      const eiDeduction = Math.min(totalIncomeBeforeTax * 0.0164, 20.72);
      const cppDeduction = Math.max(0, Math.min((totalIncomeBeforeTax - 67.31) * 0.0595, 74.36));
      
      const totalDeductions = totalFederalTax + provincialTax + eiDeduction + cppDeduction;
      const netPay = totalIncomeBeforeTax - totalDeductions;

      return {
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
        lieu_balance_before: parseFloat(employee.lieu_time_balance || 0),
        lieu_balance_after: lieuBalanceAfter,
        lieu_balance: lieuBalanceAfter,
        stat_holiday_hours: statHolidayHours,
        premium_hours: Object.values(premiumDetails).reduce((sum, p) => sum + (p.hours || 0), 0),
        premium_pay: totalPremiumPay,
        lieu_pay: lieuPay,
        premium_details: premiumDetails,
        holiday_pay: holidayPayAmount,
        holiday_details: holidayDetails,
        calculation_method: 'fallback_simplified'
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
  const loadPayrollTotals = useCallback(async () => {
    if (!payrollRun?.id) {
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
        .eq('payroll_run_id', payrollRun.id);

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
        totals.totalHours += parseFloat(entry.total_hours) || 0;
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
  }, [payrollRun?.id]);

  useEffect(() => {
    loadPayrollTotals();
  }, [loadPayrollTotals]);
  
  // Database save function with lieu time support
  const saveEmployeeEntryToDatabase = useCallback(async (employeeId, hours, additionalFedTax, statHolidayPay, preview) => {
    if (!payrollRun || !payrollRun.id) {
      return;
    }

    try {
      const employee = sortedEmployees?.find(e => e?.id === employeeId);
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
              const wage = parseFloat(employee.wage || 0);
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

      // Check if entry already exists
      const { data: existingEntry, error: checkError } = await supabase
        .from('hrpayroll_entries')
        .select('id')
        .eq('payroll_run_id', payrollRun.id)
        .eq('user_id', employeeId)
        .single();

      // Calculate final values
      const finalGrossPay = preview.gross_pay || 0;
      const finalVacationPay = preview.vacation_pay || 0;
      const holidayPayAmount = preview.holiday_pay || employeeHolidayPay[employeeId] || 0;
      const totalIncome = finalGrossPay + finalVacationPay + holidayPayAmount;
      
      const federalTax = parseFloat(preview.federal_tax) || parseFloat(preview.total_federal_tax) || 0;
      const additionalTax = parseFloat(preview.additional_federal_tax) || parseFloat(additionalFedTax) || 0;
      const provincialTax = parseFloat(preview.provincial_tax_total) || parseFloat(preview.provincial_tax) || 0;
      const ontarioHealthPremium = parseFloat(preview.ontario_health_premium) || 0;
      const eiDeduction = parseFloat(preview.ei_premium) || parseFloat(preview.ei_deduction) || 0;
      const cppDeduction = parseFloat(preview.cpp_contribution) || parseFloat(preview.cpp_deduction) || 0;
      
      const totalDeductions = federalTax + additionalTax + provincialTax + ontarioHealthPremium + eiDeduction + cppDeduction;
      const finalNetPay = preview.net_pay || Math.max(0, totalIncome - totalDeductions);

      // Prepare entry data with LIEU TIME fields
      const entryData = {
        payroll_run_id: payrollRun.id,
        user_id: employeeId,
        
        // Hours - including lieu time
        total_hours: parseFloat(hours.total_hours) || 0,
        regular_hours: preview.regular_hours_paid || preview.regular_hours || 0,
        overtime_hours: preview.overtime_hours || parseFloat(hours.overtime_hours) || 0,
        stat_holiday_hours: preview.stat_holiday_hours || 0,
        
        // LIEU TIME FIELDS
        lieu_hours: preview.lieu_used || 0,
        lieu_earned: preview.lieu_earned || 0,
        lieu_balance_before: preview.lieu_balance_before || parseFloat(employee.lieu_time_balance) || 0,
        lieu_balance_after: preview.lieu_balance_after || preview.lieu_balance || 0,
        
        // Premiums
        premiums: premiumData,
        
        // Pay amounts
        gross_pay: finalGrossPay,
        vacation_pay: finalVacationPay,
        holiday_pay: holidayPayAmount,
        
        // Tax deductions
        federal_tax: federalTax,
        provincial_tax: provincialTax,
        ontario_health_premium: ontarioHealthPremium,
        ei_deduction: eiDeduction,
        cpp_deduction: cppDeduction,
        additional_tax: additionalTax,
        
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

      // Update employee's lieu time balance in users table
      if (preview.lieu_balance_after !== undefined && preview.lieu_balance_after !== preview.lieu_balance_before) {
        const { error: balanceError } = await supabase
          .from('users')
          .update({ 
            lieu_time_balance: preview.lieu_balance_after,
            updated_at: new Date().toISOString()
          })
          .eq('id', employeeId);

        if (balanceError) {
          console.error('Failed to update employee lieu balance:', balanceError);
        }
      }

    } catch (error) {
      console.error('Error saving employee entry to database:', error);
      throw error;
    }
  }, [
    payrollRun, 
    sortedEmployees, 
    allPremiums, 
    isEmployeePremiumEnabled, 
    getEmployeePremiumRate, 
    getEmployeePremiumRateType, 
    employeeHolidayPay
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
      [employeeId]: newHours || {}
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
              lieu_balance: entry.lieu_balance_after || 0,
              overtime_hours: entry.overtime_hours || 0,
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

            additionalFedTaxData[entry.user_id] = entry.additional_tax || 0;
            statHolidayData[entry.user_id] = entry.stat_holiday_hours || 0;
            holidayPayData[entry.user_id] = entry.holiday_pay || 0;
          }
        });

        setEmployeeHours(prev => ({ ...prev, ...hoursData }));
        setEmployeeAdditionalFedTax(prev => ({ ...prev, ...additionalFedTaxData }));
        setEmployeeStatHolidayPay(prev => ({ ...prev, ...statHolidayData }));
        setEmployeeHolidayPay(prev => ({ ...prev, ...holidayPayData }));
        setEmployeeHolidayDetails(prev => ({ ...prev, ...holidayDetailsData }));
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