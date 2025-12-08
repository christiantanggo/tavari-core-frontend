// components/HR/HRPayrollComponents/EETRT-DataHook.js
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../supabaseClient';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import { useYTDCalculations } from '../../../hooks/useYTDCalculations';
import { EETRT_calculateROEData, EETRT_calculateT4Data, EETRT_processPayrollForROE, EETRT_detectPaymentFrequency } from './EETRT-Calculations';
import { EETRT_generateReportHTML } from './EETRT-ReportGenerator';

export const useEETRTData = (selectedBusinessId, businessData) => {
  const [employees, setEmployees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [payrollHistory, setPayrollHistory] = useState([]);
  const [reportConfig, setReportConfig] = useState({
    lastDayWorked: '',
    separationReason: '',
    expectedReturnDate: '',
    dateRangeType: 'rolling_12_months',
    customStartDate: '',
    customEndDate: '',
    paymentFrequency: 'auto_detect',
    paymentFrequencyOverride: false,
    detectedFrequency: null,
    frequencyConfidence: 0,
    isT4Report: false,
    useYTDOptimization: true
  });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [calculatedData, setCalculatedData] = useState(null);
  const [error, setError] = useState(null);

  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'useEETRTData',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'critical'
  });

  const {
    selectedBusinessId: authBusinessId,
    authUser,
    userRole,
    businessData: authBusinessData
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'hr_admin'],
    requireBusiness: true,
    componentName: 'useEETRTData'
  });

  const { formatTaxAmount } = useTaxCalculations(selectedBusinessId);
  const ytd = useYTDCalculations(selectedBusinessId);

  const effectiveBusinessId = selectedBusinessId || authBusinessId;
  const effectiveBusinessData = businessData || authBusinessData;

  useEffect(() => {
    if (effectiveBusinessId) {
      loadEmployees();
    }
  }, [effectiveBusinessId]);

  useEffect(() => {
    if (payrollHistory.length > 0 && !reportConfig.paymentFrequencyOverride) {
      const detection = EETRT_detectPaymentFrequency(payrollHistory);
      setReportConfig(prev => ({
        ...prev,
        detectedFrequency: detection.frequency,
        frequencyConfidence: detection.confidence,
        paymentFrequency: detection.frequency || 'bi_weekly'
      }));
    }
  }, [payrollHistory, reportConfig.paymentFrequencyOverride]);

  useEffect(() => {
    if (selectedEmployee && (payrollHistory.length > 0 || reportConfig.useYTDOptimization)) {
      calculateComprehensiveData();
    }
  }, [selectedEmployee, payrollHistory, reportConfig]);

  const loadEmployees = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const rateLimitCheck = await checkRateLimit('load_eetrt_employees');
      if (!rateLimitCheck.allowed) {
        throw new Error('Rate limit exceeded. Please wait before loading employee data.');
      }

      await recordAction('eetrt_employee_data_access', authUser?.id);
      
      await logSecurityEvent('comprehensive_tax_report_employee_data_accessed', {
        business_id: effectiveBusinessId,
        action: 'load_employees_for_tax_report'
      }, 'medium');

      const { data: userRoles, error } = await supabase
        .from('user_roles')
        .select(`
          *,
          users:user_id (
            id, first_name, last_name, email, hire_date, wage,
            employment_status, phone, employee_number, claim_code
          )
        `)
        .eq('business_id', effectiveBusinessId)
        .eq('active', true);

      if (error) throw error;
      
      const validEmployees = userRoles?.filter(role => role.users) || [];
      setEmployees(validEmployees);

      await logSecurityEvent('eetrt_employees_loaded', {
        business_id: effectiveBusinessId,
        employee_count: validEmployees.length
      }, 'low');

    } catch (error) {
      setError(error.message);
      await logSecurityEvent('eetrt_employee_load_error', {
        business_id: effectiveBusinessId,
        error: error.message
      }, 'high');
    } finally {
      setLoading(false);
    }
  };

  const loadEmployeePayrollHistory = async (employeeId) => {
    if (!employeeId || !effectiveBusinessId) return;

    setGenerating(true);
    setError(null);

    try {
      await recordAction('eetrt_payroll_history_access', employeeId);

      const fifteenMonthsAgo = new Date();
      fifteenMonthsAgo.setMonth(fifteenMonthsAgo.getMonth() - 15);
      const currentYear = new Date().getFullYear();

      // Load actual payroll entries
      const { data: entries, error: entriesError } = await supabase
        .from('hrpayroll_entries')
        .select(`
          *, 
          hrpayroll_runs!hrpayroll_entries_payroll_run_id_fkey (
            pay_date, 
            pay_period_start, 
            pay_period_end, 
            business_id
          )
        `)
        .eq('user_id', employeeId)
        .eq('hrpayroll_runs.business_id', effectiveBusinessId)
        .gte('hrpayroll_runs.pay_date', fifteenMonthsAgo.toISOString().split('T')[0]);

      if (entriesError) throw entriesError;

      // Load YTD migrated data
      const { data: ytdData, error: ytdError } = await supabase
        .from('hrpayroll_ytd_data')
        .select('*')
        .eq('user_id', employeeId)
        .eq('business_id', effectiveBusinessId)
        .eq('tax_year', currentYear)
        .single();

      let allEntries = entries || [];

      // If we have YTD data and fewer than 53 entries, create synthetic periods
      if (ytdData && allEntries.length < 53) {
        const periodsNeeded = 53 - allEntries.length;
        const syntheticEntries = createSyntheticPayPeriods(ytdData, periodsNeeded, allEntries, employeeId);
        allEntries = [...syntheticEntries, ...allEntries];
      }

      const sortedEntries = allEntries.sort((a, b) => 
        new Date(b.hrpayroll_runs.pay_date) - new Date(a.hrpayroll_runs.pay_date)
      );
      
      setPayrollHistory(sortedEntries);

      await logSecurityEvent('eetrt_payroll_history_loaded', {
        business_id: effectiveBusinessId,
        employee_id: employeeId,
        entries_count: sortedEntries.length,
        real_entries: entries?.length || 0,
        synthetic_entries: sortedEntries.length - (entries?.length || 0),
        ytd_data_used: !!ytdData
      }, 'medium');

    } catch (error) {
      setError(`Error loading payroll data: ${error.message}`);
      await logSecurityEvent('eetrt_payroll_history_error', {
        business_id: effectiveBusinessId,
        employee_id: employeeId,
        error: error.message
      }, 'high');
    } finally {
      setGenerating(false);
    }
  };

  const createSyntheticPayPeriods = (ytdData, periodsNeeded, existingEntries, employeeId) => {
    const syntheticEntries = [];
    const currentYear = new Date().getFullYear();
    
    // Determine payment frequency (default to bi-weekly)
    const frequency = reportConfig.detectedFrequency || 'bi_weekly';
    const daysPerPeriod = frequency === 'weekly' ? 7 : frequency === 'bi_weekly' ? 14 : frequency === 'semi_monthly' ? 15 : 30;
    
    // Find the earliest date to work backwards from
    let startDate;
    if (existingEntries.length > 0) {
      const oldestEntry = existingEntries.reduce((oldest, entry) => {
        const entryDate = new Date(entry.hrpayroll_runs.pay_date);
        return entryDate < oldest ? entryDate : oldest;
      }, new Date(existingEntries[0].hrpayroll_runs.pay_date));
      startDate = new Date(oldestEntry);
    } else {
      startDate = new Date();
    }

    // Calculate per-period averages from YTD totals
    const avgHoursPerPeriod = parseFloat(ytdData.hours_worked || 0) / periodsNeeded;
    const avgRegularIncomePerPeriod = parseFloat(ytdData.regular_income || 0) / periodsNeeded;
    const avgOvertimeIncomePerPeriod = parseFloat(ytdData.overtime_income || 0) / periodsNeeded;
    const avgVacationPayPerPeriod = parseFloat(ytdData.vacation_pay || 0) / periodsNeeded;
    const avgPremiumPayPerPeriod = parseFloat(ytdData.shift_premiums || 0) / periodsNeeded;
    const avgGrossPayPerPeriod = parseFloat(ytdData.gross_pay || 0) / periodsNeeded;
    const avgFederalTaxPerPeriod = parseFloat(ytdData.federal_tax || 0) / periodsNeeded;
    const avgProvincialTaxPerPeriod = parseFloat(ytdData.provincial_tax || 0) / periodsNeeded;
    const avgCPPPerPeriod = parseFloat(ytdData.cpp_deduction || 0) / periodsNeeded;
    const avgEIPerPeriod = parseFloat(ytdData.ei_deduction || 0) / periodsNeeded;

    // Create synthetic entries working backwards from startDate
    for (let i = 0; i < periodsNeeded; i++) {
      const payDate = new Date(startDate);
      payDate.setDate(payDate.getDate() - (daysPerPeriod * (i + 1)));
      
      const periodEnd = new Date(payDate);
      const periodStart = new Date(payDate);
      periodStart.setDate(periodStart.getDate() - (daysPerPeriod - 1));

      // Create synthetic entry matching hrpayroll_entries structure
      syntheticEntries.push({
        id: `synthetic_${i}_${employeeId}`,
        user_id: employeeId,
        payroll_run_id: null,
        regular_hours: avgHoursPerPeriod.toFixed(2),
        overtime_hours: (parseFloat(ytdData.overtime_hours || 0) / periodsNeeded).toFixed(2),
        lieu_hours: (parseFloat(ytdData.lieu_hours || 0) / periodsNeeded).toFixed(2),
        gross_pay: avgGrossPayPerPeriod.toFixed(2),
        vacation_pay: avgVacationPayPerPeriod.toFixed(2),
        federal_tax: avgFederalTaxPerPeriod.toFixed(2),
        provincial_tax: avgProvincialTaxPerPeriod.toFixed(2),
        cpp_deduction: avgCPPPerPeriod.toFixed(2),
        ei_deduction: avgEIPerPeriod.toFixed(2),
        net_pay: (avgGrossPayPerPeriod - avgFederalTaxPerPeriod - avgProvincialTaxPerPeriod - avgCPPPerPeriod - avgEIPerPeriod).toFixed(2),
        premiums: JSON.stringify({
          shift_premium: {
            hours: 0,
            rate: 0,
            total_pay: avgPremiumPayPerPeriod.toFixed(2)
          }
        }),
        is_synthetic: true, // Mark as synthetic for identification
        hrpayroll_runs: {
          pay_date: payDate.toISOString().split('T')[0],
          pay_period_start: periodStart.toISOString().split('T')[0],
          pay_period_end: periodEnd.toISOString().split('T')[0],
          business_id: effectiveBusinessId
        }
      });
    }

    return syntheticEntries;
  };

  const handleEmployeeChange = async (employeeId) => {
    try {
      const employee = employees.find(emp => emp.users.id === employeeId);
      setSelectedEmployee(employee);
      setPayrollHistory([]);
      setCalculatedData(null);
      setError(null);
      
      setReportConfig(prev => ({
        ...prev,
        detectedFrequency: null,
        frequencyConfidence: 0,
        paymentFrequency: 'auto_detect',
        paymentFrequencyOverride: false
      }));

      if (employeeId) {
        await recordAction('eetrt_employee_selected', employeeId);
        await loadEmployeePayrollHistory(employeeId);
      }
    } catch (error) {
      setError(`Error selecting employee: ${error.message}`);
    }
  };

  const calculateComprehensiveData = useCallback(async () => {
    if (!selectedEmployee) return;

    const employee = selectedEmployee.users;
    setGenerating(true);
    setError(null);

    try {
      await recordAction('eetrt_calculation_started', employee.id);
      
      await logSecurityEvent('eetrt_calculation_started', {
        business_id: effectiveBusinessId,
        employee_id: employee.id,
        employee_name: `${employee.first_name} ${employee.last_name}`,
        report_type: reportConfig.isT4Report ? 'T4' : 'ROE',
        use_ytd_optimization: reportConfig.useYTDOptimization,
        date_range_type: reportConfig.dateRangeType
      }, 'medium');

      const { startDate, endDate } = getCalculationDateRange();
      
      const periodEntries = payrollHistory.filter(entry => {
        const payDate = new Date(entry.hrpayroll_runs.pay_date);
        return payDate >= startDate && payDate <= endDate;
      });

      let roeData = null;
      let t4Data = null;
      let dataSource = 'payroll_entries';

      if (!reportConfig.isT4Report || periodEntries.length > 0) {
        roeData = EETRT_calculateROEData(periodEntries);
      }

      if (reportConfig.isT4Report && reportConfig.useYTDOptimization && ytd && !ytd.loading) {
        try {
          const employeeYTD = await ytd.calculateEmployeeYTD(
            employee.id,
            endDate.toISOString().split('T')[0]
          );

          if (employeeYTD && employeeYTD.is_current) {
            t4Data = {
              box14_employmentIncome: employeeYTD.gross_pay + employeeYTD.vacation_pay,
              box16_cppContributions: employeeYTD.cpp_deduction,
              box18_eiPremiums: employeeYTD.ei_deduction,
              box22_incomeTax: employeeYTD.federal_tax + employeeYTD.provincial_tax,
              box24_eiInsurableEarnings: Math.min(employeeYTD.gross_pay, 65700),
              box26_cppPensionableEarnings: Math.min(employeeYTD.gross_pay, 71300),
              box52_pensionAdjustment: 0,
              box56_cppQppExemption: 0,
              
              ytd_regular_income: employeeYTD.regular_income,
              ytd_overtime_income: employeeYTD.overtime_income,
              ytd_lieu_income: employeeYTD.lieu_income,
              ytd_vacation_pay: employeeYTD.vacation_pay,
              ytd_premium_pay: employeeYTD.shift_premiums,
              ytd_hours_worked: employeeYTD.hours_worked,
              ytd_federal_tax: employeeYTD.federal_tax,
              ytd_provincial_tax: employeeYTD.provincial_tax,
              
              calculation_method: 'ytd_optimized',
              calculation_date: employeeYTD.calculation_date,
              last_ytd_update: employeeYTD.last_stored_update,
              tax_year: employeeYTD.tax_year
            };

            dataSource = 'ytd_optimized';
            
            await logSecurityEvent('eetrt_ytd_calculation_used', {
              business_id: effectiveBusinessId,
              employee_id: employee.id,
              ytd_tax_year: employeeYTD.tax_year,
              ytd_is_current: employeeYTD.is_current
            }, 'low');

          } else {
            t4Data = EETRT_calculateT4Data(periodEntries);
            dataSource = 'payroll_entries_fallback';
            
            await logSecurityEvent('eetrt_ytd_fallback', {
              business_id: effectiveBusinessId,
              employee_id: employee.id,
              reason: 'ytd_data_not_current_or_missing'
            }, 'medium');
          }

        } catch (ytdError) {
          t4Data = EETRT_calculateT4Data(periodEntries);
          dataSource = 'payroll_entries_ytd_error';
          
          await logSecurityEvent('eetrt_ytd_error_fallback', {
            business_id: effectiveBusinessId,
            employee_id: employee.id,
            ytd_error: ytdError.message
          }, 'medium');
        }
      } else {
        t4Data = EETRT_calculateT4Data(periodEntries);
        dataSource = reportConfig.useYTDOptimization ? 'ytd_not_available' : 'ytd_disabled';
      }

      const payPeriodBreakdown = EETRT_processPayrollForROE(periodEntries);
      
      const contactInfo = {
        fullName: `${employee.first_name} ${employee.last_name}`,
        email: employee.email,
        phone: employee.phone,
        hireDate: employee.hire_date,
        baseWage: employee.wage,
        status: employee.employment_status,
        employeeNumber: employee.employee_number,
        claimCode: employee.claim_code
      };

      const calculatedResult = {
        employee: contactInfo,
        roeData,
        t4Data,
        payPeriodBreakdown,
        paymentFrequency: {
          effective: getEffectivePaymentFrequency(),
          detected: reportConfig.detectedFrequency,
          confidence: reportConfig.frequencyConfidence,
          isOverridden: reportConfig.paymentFrequencyOverride,
          periodsPerYear: getPayPeriodsPerYear()
        },
        calculationPeriod: {
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0],
          type: reportConfig.dateRangeType
        },
        metadata: {
          dataSource,
          payrollEntriesUsed: periodEntries.length,
          syntheticEntriesUsed: periodEntries.filter(e => e.is_synthetic).length,
          calculationTimestamp: new Date().toISOString(),
          ytdOptimizationEnabled: reportConfig.useYTDOptimization,
          ytdDataAvailable: !!ytd && !ytd.loading && !!ytd.ytdData[employee.id]
        }
      };

      setCalculatedData(calculatedResult);

      await logSecurityEvent('eetrt_calculation_completed', {
        business_id: effectiveBusinessId,
        employee_id: employee.id,
        report_type: reportConfig.isT4Report ? 'T4' : 'ROE',
        data_source: dataSource,
        payroll_entries_used: periodEntries.length,
        calculation_period: {
          start: startDate.toISOString().split('T')[0],
          end: endDate.toISOString().split('T')[0]
        }
      }, 'medium');

    } catch (error) {
      setError(`Calculation error: ${error.message}`);
      
      await logSecurityEvent('eetrt_calculation_error', {
        business_id: effectiveBusinessId,
        employee_id: employee?.id,
        error: error.message
      }, 'high');
    } finally {
      setGenerating(false);
    }
  }, [selectedEmployee, payrollHistory, reportConfig, ytd, effectiveBusinessId]);

  const getCalculationDateRange = () => {
    const today = new Date();
    const lastDayWorked = reportConfig.lastDayWorked ? new Date(reportConfig.lastDayWorked) : today;

    switch (reportConfig.dateRangeType) {
      case 'rolling_12_months':
        const twelveMonthsAgo = new Date(lastDayWorked);
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
        return { startDate: twelveMonthsAgo, endDate: lastDayWorked };
      case 'calendar_year':
        return { startDate: new Date(today.getFullYear(), 0, 1), endDate: new Date(today.getFullYear(), 11, 31) };
      case 'previous_year':
        return { startDate: new Date(today.getFullYear() - 1, 0, 1), endDate: new Date(today.getFullYear() - 1, 11, 31) };
      case 'employment_period':
        return { startDate: new Date(selectedEmployee.users.hire_date), endDate: lastDayWorked };
      case 'custom':
        if (!reportConfig.customStartDate || !reportConfig.customEndDate) {
          return { startDate: new Date(today.getFullYear(), 0, 1), endDate: today };
        }
        return { startDate: new Date(reportConfig.customStartDate), endDate: new Date(reportConfig.customEndDate) };
      default:
        return { startDate: new Date(today.getFullYear(), 0, 1), endDate: today };
    }
  };

  const getEffectivePaymentFrequency = () => {
    if (reportConfig.paymentFrequencyOverride && reportConfig.paymentFrequency !== 'auto_detect') {
      return reportConfig.paymentFrequency;
    }
    return reportConfig.detectedFrequency || 'bi_weekly';
  };

  const getPayPeriodsPerYear = () => {
    const frequencies = {
      'weekly': 52, 'bi_weekly': 26, 'semi_monthly': 24, 'monthly': 12
    };
    return frequencies[getEffectivePaymentFrequency()] || 26;
  };

  const generateComprehensiveReport = async () => {
    if (!selectedEmployee || !calculatedData) {
      setError('No employee selected or calculation data available');
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const rateLimitCheck = await checkRateLimit('generate_eetrt_report', selectedEmployee.users.id);
      if (!rateLimitCheck.allowed) {
        throw new Error('Rate limit exceeded. Please wait before generating another report.');
      }

      await recordAction('generate_comprehensive_tax_report', selectedEmployee.users.id, true);
      
      await logSecurityEvent('eetrt_report_generation_started', {
        business_id: effectiveBusinessId,
        employee_id: selectedEmployee.users.id,
        employee_name: `${selectedEmployee.users.first_name} ${selectedEmployee.users.last_name}`,
        report_type: reportConfig.isT4Report ? 'T4' : 'ROE',
        data_source: calculatedData.metadata?.dataSource
      }, 'medium');
      
      const reportHTML = EETRT_generateReportHTML(
        calculatedData, 
        reportConfig, 
        effectiveBusinessData, 
        formatTaxAmount
      );
      
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        throw new Error('Pop-up blocked. Please allow pop-ups for this site to generate the report.');
      }
      
      printWindow.document.write(reportHTML);
      printWindow.document.close();
      printWindow.focus();

      setTimeout(() => {
        printWindow.print();
        setTimeout(() => printWindow.close(), 1000);
      }, 500);

      await logSecurityEvent('eetrt_report_generated', {
        business_id: effectiveBusinessId,
        employee_id: selectedEmployee.users.id,
        report_type: reportConfig.isT4Report ? 'T4' : 'ROE',
        data_source: calculatedData.metadata?.dataSource,
        generation_method: 'browser_print'
      }, 'medium');

    } catch (error) {
      setError(`Report generation error: ${error.message}`);
      
      await recordAction('generate_comprehensive_tax_report', selectedEmployee.users.id, false);
      await logSecurityEvent('eetrt_report_generation_error', {
        business_id: effectiveBusinessId,
        employee_id: selectedEmployee?.users?.id,
        error: error.message
      }, 'high');
    } finally {
      setGenerating(false);
    }
  };

  const toggleYTDOptimization = (enabled) => {
    setReportConfig(prev => ({
      ...prev,
      useYTDOptimization: enabled
    }));
  };

  const getYTDStatus = () => {
    if (!ytd || ytd.loading) return { status: 'loading', message: 'Loading YTD data...' };
    if (ytd.error) return { status: 'error', message: `YTD Error: ${ytd.error}` };
    if (!selectedEmployee) return { status: 'no_employee', message: 'No employee selected' };
    
    const employeeYTD = ytd.ytdData[selectedEmployee.users.id];
    if (!employeeYTD) return { status: 'no_data', message: 'No YTD data available' };
    
    const isUpToDate = employeeYTD.is_current;
    return { 
      status: isUpToDate ? 'current' : 'outdated', 
      message: isUpToDate ? 'YTD data is current' : 'YTD data needs updating',
      lastUpdate: employeeYTD.last_updated
    };
  };

  return {
    employees,
    selectedEmployee,
    payrollHistory,
    reportConfig,
    calculatedData,
    
    loading,
    generating,
    error,
    
    handleEmployeeChange,
    setReportConfig,
    generateComprehensiveReport,
    
    getEffectivePaymentFrequency,
    getPayPeriodsPerYear,
    getCalculationDateRange,
    
    toggleYTDOptimization,
    getYTDStatus,
    ytdData: ytd?.ytdData,
    ytdLoading: ytd?.loading,
    
    refreshEmployees: loadEmployees,
    refreshPayrollHistory: () => selectedEmployee && loadEmployeePayrollHistory(selectedEmployee.users.id),
    refreshCalculation: calculateComprehensiveData,
    
    canGenerate: !!(selectedEmployee && calculatedData && !generating),
    hasPayrollData: payrollHistory.length > 0,
    hasYTDData: !!(ytd && !ytd.loading && selectedEmployee && ytd.ytdData[selectedEmployee.users.id])
  };
};