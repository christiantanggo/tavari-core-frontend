// components/HR/HRPayrollComponents/EETRT-DataHook.js
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../supabaseClient';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import { useYTDCalculations } from '../../../hooks/useYTDCalculations';
import { EETRT_calculateROEData, EETRT_calculateT4Data, EETRT_processPayrollForROE, EETRT_detectPaymentFrequency } from './EETRT-Calculations';
import { EETRT_generateReportHTML, EETRT_generateDeductionsReportHTML } from './EETRT-ReportGenerator';
import {
  mergeBusinessEmploymentOntoEmployees
} from '../../../utils/businessEmploymentStatus';

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
            employment_status, termination_date, phone, employee_number, claim_code
          )
        `)
        .eq('business_id', effectiveBusinessId);

      if (error) throw error;

      const rolesWithUsers = userRoles?.filter((role) => role.users) || [];
      const uniqueByUserId = new Map();
      rolesWithUsers.forEach((role) => {
        const userId = role.users.id;
        if (!userId) return;
        const existing = uniqueByUserId.get(userId);
        if (!existing || (role.active && !existing.active)) {
          uniqueByUserId.set(userId, role);
        }
      });

      const dedupedRoles = [...uniqueByUserId.values()];
      const mergedUsers = await mergeBusinessEmploymentOntoEmployees(
        supabase,
        effectiveBusinessId,
        dedupedRoles.map((role) => role.users)
      );
      const mergedByUserId = new Map(mergedUsers.map((user) => [user.id, user]));

      const validEmployees = dedupedRoles.map((role) => {
        const mergedUser = mergedByUserId.get(role.users.id) || role.users;
        return { ...role, users: mergedUser };
      });
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

      // Step 1: Get payroll runs for this business within the date range
      // This ensures we get all recent Tavari payroll runs
      console.log('[EETRT] Querying payroll runs:', {
        businessId: effectiveBusinessId,
        dateFrom: fifteenMonthsAgo.toISOString().split('T')[0],
        dateTo: new Date().toISOString().split('T')[0]
      });

      // Same as Pay Statements: only finalized runs so entries have correct federal_tax (no draft/placeholder values).
      const { data: payrollRuns, error: runsError } = await supabase
        .from('hrpayroll_runs')
        .select('id, pay_date, pay_period_start, pay_period_end, business_id, status')
        .eq('business_id', effectiveBusinessId)
        .eq('status', 'finalized')
        .gte('pay_date', fifteenMonthsAgo.toISOString().split('T')[0])
        .order('pay_date', { ascending: false });

      if (runsError) {
        console.error('[EETRT] Error loading payroll runs:', runsError);
        throw runsError;
      }

      console.log('[EETRT] Payroll runs found:', {
        count: payrollRuns?.length || 0,
        sample: payrollRuns?.slice(0, 3)?.map(run => ({
          id: run.id,
          pay_date: run.pay_date,
          status: run.status
        }))
      });

      // Step 2: Get entries for this employee from those payroll runs
      // Get ALL entries (including migration) and filter in JavaScript
      let entries = [];
      if (payrollRuns && payrollRuns.length > 0) {
        const runIds = payrollRuns.map(run => run.id);
        
        console.log('[EETRT] Querying entries for employee:', {
          employeeId,
          businessId: effectiveBusinessId,
          runIds: runIds.length,
          runIdsSample: runIds.slice(0, 5),
          dateRange: {
            from: fifteenMonthsAgo.toISOString().split('T')[0],
            to: new Date().toISOString().split('T')[0]
          }
        });
        
        const { data: entriesData, error: entriesError } = await supabase
          .from('hrpayroll_entries')
          .select('*')
          .eq('user_id', employeeId)
          .in('payroll_run_id', runIds);

        if (entriesError) {
          console.error('[EETRT] Error loading entries:', entriesError);
          throw entriesError;
        }

        console.log('[EETRT] Raw entries returned:', {
          count: entriesData?.length || 0,
          sample: entriesData?.slice(0, 3)?.map(e => ({
            id: e.id,
            payroll_run_id: e.payroll_run_id,
            gross_pay: e.gross_pay,
            federal_tax: e.federal_tax,
            provincial_tax: e.provincial_tax,
            is_migration_entry: e.is_migration_entry
          }))
        });

        // Filter out migration entries (they'll be loaded separately)
        const regularEntries = (entriesData || []).filter(entry => 
          !entry.is_migration_entry
        );

        // Enrich entries with run data
        const runsMap = new Map(payrollRuns.map(run => [run.id, run]));
        entries = regularEntries.map(entry => ({
          ...entry,
          hrpayroll_runs: runsMap.get(entry.payroll_run_id)
        })).filter(entry => entry.hrpayroll_runs); // Only include entries with valid runs

        console.log('[EETRT] Enriched regular entries:', {
          count: entries.length,
          sample: entries.slice(0, 3)?.map(e => ({
            id: e.id,
            pay_date: e.hrpayroll_runs?.pay_date,
            gross_pay: e.gross_pay,
            federal_tax: e.federal_tax,
            provincial_tax: e.provincial_tax
          }))
        });
      } else {
        console.warn('[EETRT] No payroll runs found for business:', {
          businessId: effectiveBusinessId,
          dateRange: {
            from: fifteenMonthsAgo.toISOString().split('T')[0],
            to: new Date().toISOString().split('T')[0]
          }
        });
      }

      // Also load migration entries (they don't have payroll_run_id, so they're not in the join above)
      // Migration entries have business_id directly on the entry
      const { data: migrationEntries, error: migrationError } = await supabase
        .from('hrpayroll_entries')
        .select('*')
        .eq('user_id', employeeId)
        .eq('business_id', effectiveBusinessId)
        .eq('is_migration_entry', true)
        .is('payroll_run_id', null)
        .gte('pay_date', fifteenMonthsAgo.toISOString().split('T')[0]);

      if (migrationError) {
        console.warn('Error loading migration entries:', migrationError);
        // Don't throw - migration entries are optional
      }

      // Combine regular entries with migration entries
      // Migration entries need to be formatted to match the structure expected by the rest of the code
      const formattedMigrationEntries = (migrationEntries || []).map(entry => ({
        ...entry,
        hrpayroll_runs: {
          pay_date: entry.pay_date || entry.period_end_date || new Date().toISOString().split('T')[0],
          pay_period_start: entry.period_start_date || entry.pay_date || new Date().toISOString().split('T')[0],
          pay_period_end: entry.period_end_date || entry.pay_date || new Date().toISOString().split('T')[0],
          business_id: entry.business_id
        }
      }));

      // Combine both types of entries
      const allRegularEntries = [...(entries || []), ...formattedMigrationEntries];

      console.log('[EETRT] Payroll data loaded:', {
        regularEntries: entries?.length || 0,
        migrationEntries: migrationEntries?.length || 0,
        totalEntries: allRegularEntries.length,
        dateRange: {
          from: fifteenMonthsAgo.toISOString().split('T')[0],
          to: new Date().toISOString().split('T')[0]
        },
        sampleEntries: allRegularEntries.slice(0, 5).map(e => ({
          id: e.id,
          pay_date: e.hrpayroll_runs?.pay_date || e.pay_date,
          gross_pay: parseFloat(e.gross_pay) || 0,
          federal_tax: parseFloat(e.federal_tax) || 0,
          provincial_tax: parseFloat(e.provincial_tax) || 0,
          cpp_deduction: parseFloat(e.cpp_deduction) || 0,
          ei_deduction: parseFloat(e.ei_deduction) || 0,
          vacation_pay: parseFloat(e.vacation_pay) || 0,
          is_migration: e.is_migration_entry || false,
          has_hrpayroll_runs: !!e.hrpayroll_runs
        })),
        totals: {
          gross_pay: allRegularEntries.reduce((sum, e) => sum + (parseFloat(e.gross_pay) || 0), 0),
          federal_tax: allRegularEntries.reduce((sum, e) => sum + (parseFloat(e.federal_tax) || 0), 0),
          provincial_tax: allRegularEntries.reduce((sum, e) => sum + (parseFloat(e.provincial_tax) || 0), 0)
        }
      });

      // Load YTD migrated data
      const { data: ytdData, error: ytdError } = await supabase
        .from('hrpayroll_ytd_data')
        .select('*')
        .eq('user_id', employeeId)
        .eq('business_id', effectiveBusinessId)
        .eq('tax_year', currentYear)
        .single();

      let allEntries = allRegularEntries || [];

      // If we have YTD data and fewer than 53 entries, create synthetic periods
      if (ytdData && allEntries.length < 53) {
        const periodsNeeded = 53 - allEntries.length;
        const syntheticEntries = createSyntheticPayPeriods(ytdData, periodsNeeded, allEntries, employeeId);
        allEntries = [...syntheticEntries, ...allEntries];
      }

      const sortedEntries = allEntries.sort((a, b) => {
        const dateA = a.hrpayroll_runs?.pay_date || a.pay_date || '';
        const dateB = b.hrpayroll_runs?.pay_date || b.pay_date || '';
        return new Date(dateB) - new Date(dateA);
      });

      console.log('[EETRT] Final sorted payroll history:', {
        totalEntries: sortedEntries.length,
        regularEntries: entries.length,
        migrationEntries: migrationEntries?.length || 0,
        sampleByType: {
          regular: sortedEntries.filter(e => !e.is_migration_entry).slice(0, 3).map(e => ({
            pay_date: e.hrpayroll_runs?.pay_date || e.pay_date,
            gross_pay: e.gross_pay,
            is_migration: false
          })),
          migration: sortedEntries.filter(e => e.is_migration_entry).slice(0, 3).map(e => ({
            pay_date: e.hrpayroll_runs?.pay_date || e.pay_date,
            gross_pay: e.gross_pay,
            is_migration: true
          }))
        }
      });
      
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
        const entryDate = new Date(entry.hrpayroll_runs?.pay_date || entry.pay_date);
        return entryDate < oldest ? entryDate : oldest;
      }, new Date(existingEntries[0].hrpayroll_runs?.pay_date || existingEntries[0].pay_date || new Date()));
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
      
      console.log('[EETRT] Calculation date range:', {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        payrollHistoryCount: payrollHistory.length
      });
      
      // For ROE, we need the last 53 pay periods regardless of date range (may include synthetic).
      // For T4, use ONLY real payroll entries and include a period only if its PAY PERIOD END is within the report range.
      // (Pay period end is when the week is "in" that year for T4; e.g. Dec 30 2025–Jan 5 2026 ends in 2026, so it belongs in 2026, not 2025.)
      const periodEntries = reportConfig.isT4Report 
        ? payrollHistory.filter(entry => {
            if (entry.is_synthetic) return false;
            const periodEnd = new Date(entry.hrpayroll_runs?.pay_period_end || entry.period_end_date || entry.pay_date);
            return periodEnd >= startDate && periodEnd <= endDate;
          })
        : payrollHistory.slice(0, 53); // Last 53 periods for ROE (already sorted by date desc)

      console.log('[EETRT] Entries after filter:', {
        isT4Report: reportConfig.isT4Report,
        count: periodEntries.length,
        totalHistory: payrollHistory.length,
        sample: periodEntries.slice(0, 5).map(e => ({
          pay_date: e.hrpayroll_runs?.pay_date || e.pay_date,
          gross_pay: parseFloat(e.gross_pay) || 0,
          is_migration: e.is_migration_entry || false,
          has_hrpayroll_runs: !!e.hrpayroll_runs
        })),
        breakdown: {
          regular: periodEntries.filter(e => !e.is_migration_entry).length,
          migration: periodEntries.filter(e => e.is_migration_entry).length,
          synthetic: periodEntries.filter(e => e.is_synthetic).length
        },
        totals: {
          gross_pay: periodEntries.reduce((sum, e) => sum + (parseFloat(e.gross_pay) || 0), 0),
          federal_tax: periodEntries.reduce((sum, e) => sum + (parseFloat(e.federal_tax) || 0), 0),
          provincial_tax: periodEntries.reduce((sum, e) => sum + (parseFloat(e.provincial_tax) || 0), 0)
        }
      });

      let roeData = null;
      let t4Data = null;
      let dataSource = 'payroll_entries';

      // ALWAYS use YTD calculation for T4 data (same as pay statements)
      // This ensures we get the same totals as the pay statement, including:
      // - Stored YTD data from hrpayroll_ytd_data table
      // - All migration entries
      // - Recent payroll entries since last update
      if (ytd && !ytd.loading) {
        try {
          const ytdEndDate = endDate.toISOString().split('T')[0];
          console.log('[EETRT] Using YTD calculation (same as pay statements) for employee:', {
            employeeId: employee.id,
            employeeName: `${employee.first_name} ${employee.last_name}`,
            endDate: ytdEndDate,
            dateRangeType: reportConfig.dateRangeType
          });
          
          const employeeYTD = await ytd.calculateEmployeeYTD(
            employee.id,
            ytdEndDate
          );

          if (employeeYTD) {
            console.log('[EETRT] YTD calculation result:', {
              gross_pay: employeeYTD.gross_pay,
              federal_tax: employeeYTD.federal_tax,
              provincial_tax: employeeYTD.provincial_tax,
              vacation_pay: employeeYTD.vacation_pay,
              regular_income: employeeYTD.regular_income,
              overtime_income: employeeYTD.overtime_income,
              shift_premiums: employeeYTD.shift_premiums,
              is_current: employeeYTD.is_current,
              calculation_date: employeeYTD.calculation_date
            });

            // Calculate employment income (gross_pay already includes regular + overtime + premiums)
            // But we need to add vacation_pay separately for T4 box 14
            // This matches how pay statements calculate: ytdGrossPay = gross_pay + vacation_pay
            const employmentIncome = (employeeYTD.gross_pay || 0) + (employeeYTD.vacation_pay || 0);

            console.log('[EETRT] T4 Data calculated from YTD:', {
              gross_pay: employeeYTD.gross_pay,
              vacation_pay: employeeYTD.vacation_pay,
              employment_income: employmentIncome,
              federal_tax: employeeYTD.federal_tax,
              provincial_tax: employeeYTD.provincial_tax,
              total_tax: (employeeYTD.federal_tax || 0) + (employeeYTD.provincial_tax || 0),
              cpp: employeeYTD.cpp_deduction,
              ei: employeeYTD.ei_deduction
            });

            // Insurable earnings = employment income (gross + vacation)
            // This matches what the user expects - insurable earnings should equal total earnings
            const insurableEarnings = employmentIncome;

            // T4 box 26 (CPP pensionable earnings) is capped at YMPE for the YTD's tax year:
            //   2024 YMPE = 68,500 | 2025 YMPE = 71,300 | 2026 YMPE = 74,600
            const ytdTaxYear = parseInt(employeeYTD.tax_year || new Date().getFullYear(), 10);
            const ympeForYTDYear = ytdTaxYear === 2026 ? 74600 :
                                    ytdTaxYear === 2025 ? 71300 :
                                    ytdTaxYear === 2024 ? 68500 :
                                    74600; // default to 2026

            t4Data = {
              box14_employmentIncome: employmentIncome,
              box16_cppContributions: employeeYTD.cpp_deduction || 0,
              box18_eiPremiums: employeeYTD.ei_deduction || 0,
              box22_incomeTax: (employeeYTD.federal_tax || 0) + (employeeYTD.provincial_tax || 0) + (employeeYTD.additional_tax || 0),
              box24_eiInsurableEarnings: insurableEarnings, // Same as employment income
              box26_cppPensionableEarnings: Math.min(employmentIncome, ympeForYTDYear),
              box52_pensionAdjustment: 0,
              box56_cppQppExemption: 0,
              
              ytd_regular_income: employeeYTD.regular_income || 0,
              ytd_overtime_income: employeeYTD.overtime_income || 0,
              ytd_lieu_income: employeeYTD.lieu_income || 0,
              ytd_vacation_pay: employeeYTD.vacation_pay || 0,
              ytd_premium_pay: employeeYTD.shift_premiums || 0,
              ytd_hours_worked: employeeYTD.hours_worked || 0,
              ytd_federal_tax: employeeYTD.federal_tax || 0,
              ytd_provincial_tax: employeeYTD.provincial_tax || 0,
              
              calculation_method: 'ytd_calculation',
              calculation_date: employeeYTD.calculation_date,
              last_ytd_update: employeeYTD.last_updated,
              tax_year: employeeYTD.tax_year || new Date().getFullYear(),
              is_current: employeeYTD.is_current
            };

            // Calculate ROE data using YTD totals (simple - just use the same totals)
            roeData = {
              totalInsurableEarnings: insurableEarnings, // Same as employment income
              totalHours: employeeYTD.hours_worked || 0,
              payPeriods: 53, // Standard ROE requirement
              averageWeeklyEarnings: insurableEarnings / 53,
              syntheticPeriodsUsed: 0
            };

            dataSource = 'ytd_calculation';
            
            await logSecurityEvent('eetrt_ytd_calculation_used', {
              business_id: effectiveBusinessId,
              employee_id: employee.id,
              ytd_tax_year: employeeYTD.tax_year,
              ytd_is_current: employeeYTD.is_current,
              gross_pay: employeeYTD.gross_pay,
              employment_income: employmentIncome
            }, 'low');

          } else {
            console.warn('[EETRT] YTD calculation returned null, falling back to entries calculation');
            t4Data = EETRT_calculateT4Data(periodEntries, currentYear);
            dataSource = 'payroll_entries_fallback_no_ytd';

            await logSecurityEvent('eetrt_ytd_fallback', {
              business_id: effectiveBusinessId,
              employee_id: employee.id,
              reason: 'ytd_calculation_returned_null'
            }, 'medium');
          }

        } catch (ytdError) {
          console.error('[EETRT] YTD calculation error, falling back to entries:', ytdError);
          t4Data = EETRT_calculateT4Data(periodEntries, currentYear);
          dataSource = 'payroll_entries_ytd_error';

          // Calculate ROE data from entries if YTD error
          roeData = EETRT_calculateROEData(periodEntries);

          await logSecurityEvent('eetrt_ytd_error_fallback', {
            business_id: effectiveBusinessId,
            employee_id: employee.id,
            ytd_error: ytdError.message
          }, 'high');
        }
      } else {
        // YTD hook not available, calculate from entries
        console.warn('[EETRT] YTD hook not available, calculating from entries');
        t4Data = EETRT_calculateT4Data(periodEntries, currentYear);
        dataSource = 'payroll_entries_no_ytd_hook';
        
        // Calculate ROE data from entries
        roeData = EETRT_calculateROEData(periodEntries);
      }

      // Group by payroll RUN (not period end) so we never merge two runs into one row and double amounts.
      // Pay Statements show one row per run; so we do one row per run. Migration entries have no run_id → group by period_end.
      const toNormalizedDate = (val) => {
        if (!val) return '';
        const s = typeof val === 'string' ? val.trim() : '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.split('T')[0];
        const d = new Date(val);
        return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
      };
      const periodKey = (entry) => {
        if (entry.payroll_run_id) return `run_${entry.payroll_run_id}`;
        const periodEnd = entry.hrpayroll_runs?.pay_period_end || entry.period_end_date || entry.pay_date;
        return `end_${toNormalizedDate(periodEnd) || entry.id}`;
      };
      const groups = new Map();
      for (const entry of periodEntries) {
        const key = periodKey(entry);
        if (!groups.has(key)) {
          const payDate = entry.hrpayroll_runs?.pay_date || entry.pay_date;
          const periodStart = entry.hrpayroll_runs?.pay_period_start || entry.period_start_date || payDate;
          const periodEnd = entry.hrpayroll_runs?.pay_period_end || entry.period_end_date || payDate;
          groups.set(key, {
            weekStart: periodStart,
            weekEnd: periodEnd,
            payDate: payDate,
            entries: [],
            isSynthetic: entry.is_synthetic || false,
            fromRun: !!entry.payroll_run_id
          });
        }
        const g = groups.get(key);
        g.entries.push(entry);
      }
      let sortedGroups = Array.from(groups.values()).sort((a, b) =>
        new Date(b.payDate || b.weekEnd) - new Date(a.payDate || a.weekEnd)
      );
      // Sum federal tax for a group using primary entry per user (smallest id) so we can compare runs.
      const groupFederalTotal = (grp) => {
        const byUser = new Map();
        for (const e of grp.entries) {
          const prev = byUser.get(e.user_id);
          if (!prev || (e.id != null && prev.id != null && e.id < prev.id)) byUser.set(e.user_id, e);
        }
        return Array.from(byUser.values()).reduce((s, e) => s + (parseFloat(e.federal_tax) || 0), 0);
      };
      // When same period has run + migration, keep run. When two runs share same period end, keep the one with HIGHER federal tax (real run, not stub).
      // Never prefer synthetic over a real run for the same period.
      const periodEndToGroup = new Map();
      for (const g of sortedGroups) {
        const endNorm = toNormalizedDate(g.weekEnd);
        if (!endNorm) continue;
        const existing = periodEndToGroup.get(endNorm);
        const gPayNorm = toNormalizedDate(g.payDate);
        let preferThis = !existing
          || (g.fromRun && !existing.fromRun)
          || (g.fromRun && existing.fromRun && gPayNorm === endNorm);
        if (preferThis && existing && g.fromRun && existing.fromRun && gPayNorm === endNorm) {
          const gFederal = groupFederalTotal(g);
          const exFederal = groupFederalTotal(existing);
          preferThis = gFederal >= exFederal;
        }
        if (preferThis && existing && existing.fromRun && g.isSynthetic) preferThis = false;
        if (preferThis) periodEndToGroup.set(endNorm, g);
      }
      sortedGroups = Array.from(periodEndToGroup.values()).sort((a, b) =>
        new Date(b.payDate || b.weekEnd) - new Date(a.payDate || a.weekEnd)
      );
      const payPeriodBreakdown = sortedGroups.slice(0, 53).map((g, index) => {
        // One entry per user: keep the PRIMARY row (smallest id) so amounts match the Pay Statement.
        // If there are duplicate rows for the same run/employee, the one with lower id is the main entry (109.74); higher id can be a stub (12.82).
        const byUser = new Map();
        for (const entry of g.entries) {
          const uid = entry.user_id;
          const prev = byUser.get(uid);
          if (!prev || (entry.id != null && prev.id != null && entry.id < prev.id)) byUser.set(uid, entry);
        }
        const entriesToSum = Array.from(byUser.values());
        let grossEarnings = 0, ei = 0, cpp = 0, federalTax = 0, provincialTax = 0, additionalTax = 0;
        for (const entry of entriesToSum) {
          grossEarnings += parseFloat(entry.gross_pay || 0) + parseFloat(entry.vacation_pay || 0);
          ei += parseFloat(entry.ei_deduction || 0);
          cpp += parseFloat(entry.cpp_deduction || 0);
          federalTax += parseFloat(entry.federal_tax || 0);
          provincialTax += parseFloat(entry.provincial_tax || 0) + parseFloat(entry.ontario_health_premium || 0);
          additionalTax += parseFloat(entry.additional_tax || 0);
        }
        const totalTax = federalTax + provincialTax + additionalTax;
        return {
          weekKey: `period-${index + 1}`,
          weekStart: g.weekStart,
          weekEnd: g.weekEnd,
          payDate: g.payDate,
          grossEarnings,
          insurableEarnings: grossEarnings,
          ei,
          cpp,
          federalTax,
          provincialTax,
          additionalTax,
          totalTax,
          entries: g.entries,
          isSynthetic: g.isSynthetic
        };
      });
      
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

  const generateDeductionsReport = async () => {
    if (!selectedEmployee || !calculatedData) {
      setError('No employee selected or calculation data available');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const reportHTML = EETRT_generateDeductionsReportHTML(
        calculatedData,
        effectiveBusinessData,
        formatTaxAmount
      );
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        throw new Error('Pop-up blocked. Please allow pop-ups to generate the report.');
      }
      printWindow.document.write(reportHTML);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        setTimeout(() => printWindow.close(), 1000);
      }, 500);
    } catch (err) {
      setError(`Deductions report error: ${err.message}`);
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
    generateDeductionsReport,

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