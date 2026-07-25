// components/HR/HRPayrollComponents/PeriodByPeriodEntry.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../../supabaseClient';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import POSAuthWrapper from '../../../components/Auth/POSAuthWrapper';
import TavariCheckbox from '../../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';
import { ChevronDown, ChevronUp, AlertTriangle, CheckCircle, Info } from 'lucide-react';

const PeriodByPeriodEntry = ({ selectedBusinessId, businessData }) => {
  const [employees, setEmployees] = useState([]);
  const [filteredEmployees, setFilteredEmployees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [employeeStatusFilter, setEmployeeStatusFilter] = useState('active');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveMessageType, setSaveMessageType] = useState('success'); // 'success' | 'error' | 'warning'
  
  // Pay frequency settings
  const [useBusinessDefault, setUseBusinessDefault] = useState(false);
  const [payFrequency, setPayFrequency] = useState('bi_weekly');
  const [employeeIsCurrent, setEmployeeIsCurrent] = useState(true);
  const [lastDayWorked, setLastDayWorked] = useState('');
  
  // Period data
  const [periods, setPeriods] = useState([]);
  const [expandedPeriods, setExpandedPeriods] = useState(new Set());
  const [periodsGenerated, setPeriodsGenerated] = useState(false);
  
  // YTD comparison
  const [ytdData, setYtdData] = useState(null);
  const [showValidationWarning, setShowValidationWarning] = useState(false);
  const [validationBypass, setValidationBypass] = useState(false);
  
  // Existing payroll warning
  const [existingPayrollEntries, setExistingPayrollEntries] = useState([]);
  const [showExistingWarning, setShowExistingWarning] = useState(false);
  const [acknowledgedExisting, setAcknowledgedExisting] = useState(false);

  // Security context
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'PeriodByPeriodEntry',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'critical'
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
    componentName: 'PeriodByPeriodEntry'
  });

  const { formatTaxAmount } = useTaxCalculations(selectedBusinessId || authBusinessId);
  const effectiveBusinessId = selectedBusinessId || authBusinessId;

  // Load employees
  useEffect(() => {
    if (effectiveBusinessId) {
      loadEmployees();
    }
  }, [effectiveBusinessId]);

  // Filter employees when status filter changes
  useEffect(() => {
    filterEmployees();
  }, [employees, employeeStatusFilter]);

  // Load existing data when employee is selected
  useEffect(() => {
    if (selectedEmployee) {
      loadEmployeeData();
    } else {
      resetForm();
    }
  }, [selectedEmployee]);

  // Load business default pay frequency
  useEffect(() => {
    if (useBusinessDefault && businessData) {
      // Assuming businessData has a default_pay_frequency field
      const defaultFreq = businessData.default_pay_frequency || 'bi_weekly';
      setPayFrequency(defaultFreq);
    }
  }, [useBusinessDefault, businessData]);

  const loadEmployees = async () => {
    try {
      await logSecurityEvent('period_entry_employee_data_access', {
        action: 'load_employees_for_period_entry',
        business_id: effectiveBusinessId
      }, 'low');

      const { data: userData, error } = await supabase
        .from('users')
        .select(`
          id,
          first_name,
          last_name,
          full_name,
          email,
          employment_status,
          employee_number,
          position,
          department,
          hire_date,
          termination_date,
          business_users!inner(business_id)
        `)
        .eq('business_users.business_id', effectiveBusinessId)
        .order('first_name');

      if (error) throw error;

      const employeeList = (userData || []).map(user => ({
        id: user.id,
        name: user.full_name || `${user.first_name || ''} ${user.last_name || ''}`.trim(),
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        employee_number: user.employee_number,
        position: user.position,
        department: user.department,
        hire_date: user.hire_date,
        termination_date: user.termination_date,
        employment_status: user.employment_status || 'active'
      }))
      .filter(emp => emp.name.trim())
      .sort((a, b) => a.name.localeCompare(b.name));

      setEmployees(employeeList);
    } catch (error) {
      console.error('Error loading employees:', error);
      await logSecurityEvent('period_entry_employee_load_failed', {
        error_message: error.message,
        business_id: effectiveBusinessId
      }, 'medium');
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  };

  const filterEmployees = () => {
    let filtered = employees;

    switch (employeeStatusFilter) {
      case 'active':
        filtered = employees.filter(emp => emp.employment_status === 'active');
        break;
      case 'terminated':
        filtered = employees.filter(emp => emp.employment_status === 'terminated');
        break;
      case 'probation':
        filtered = employees.filter(emp => emp.employment_status === 'probation');
        break;
      case 'suspended':
        filtered = employees.filter(emp => emp.employment_status === 'suspended');
        break;
      case 'on_leave':
        filtered = employees.filter(emp => emp.employment_status === 'on_leave');
        break;
      case 'current':
        filtered = employees.filter(emp =>
          ['active', 'probation', 'on_leave'].includes(emp.employment_status)
        );
        break;
      case 'all':
      default:
        filtered = employees;
        break;
    }

    setFilteredEmployees(filtered);
    
    if (selectedEmployee && !filtered.find(emp => emp.id === selectedEmployee)) {
      setSelectedEmployee('');
    }
  };

  const loadEmployeeData = async () => {
    try {
      setLoading(true);
      
      // Load YTD data for comparison
      const currentYear = new Date().getFullYear();
      const { data: ytdRecord, error: ytdError } = await supabase
        .from('hrpayroll_ytd_data')
        .select('*')
        .eq('user_id', selectedEmployee)
        .eq('business_id', effectiveBusinessId)
        .eq('tax_year', currentYear)
        .single();

      if (ytdError && ytdError.code !== 'PGRST116') {
        throw ytdError;
      }

      setYtdData(ytdRecord);

      // Check for existing payroll entries
      const { data: existingEntries, error: existingError } = await supabase
        .from('hrpayroll_entries')
        .select(`
          *,
          hrpayroll_runs (
            pay_date,
            pay_period_start,
            pay_period_end
          )
        `)
        .eq('user_id', selectedEmployee)
        .eq('business_id', effectiveBusinessId)
        .order('pay_date', { ascending: false });

      if (existingError) throw existingError;

      setExistingPayrollEntries(existingEntries || []);
      
      if (existingEntries && existingEntries.length > 0) {
        setShowExistingWarning(true);
      }

      // Load existing migration entries if any
      const { data: migrationEntries, error: migrationError } = await supabase
        .from('hrpayroll_entries')
        .select('*')
        .eq('user_id', selectedEmployee)
        .eq('business_id', effectiveBusinessId)
        .eq('is_migration_entry', true)
        .order('migration_period_number');

      if (migrationError) throw migrationError;

      if (migrationEntries && migrationEntries.length > 0) {
        // Load existing migration data into form
        const loadedPeriods = migrationEntries.map(entry => ({
          id: entry.id,
          periodNumber: entry.migration_period_number,
          startDate: entry.period_start_date,
          endDate: entry.period_end_date,
          payDate: entry.pay_date,
          regularEarnings: entry.gross_pay - entry.vacation_pay - entry.overtime_hours * (entry.gross_pay / (entry.regular_hours + entry.overtime_hours)),
          overtimeEarnings: entry.overtime_hours * (entry.gross_pay / (entry.regular_hours + entry.overtime_hours)),
          vacationPayIncluded: entry.vacation_pay > 0,
          vacationPayAmount: entry.vacation_pay || 0,
          regularHours: entry.regular_hours || 0,
          overtimeHours: entry.overtime_hours || 0
        }));

        setPeriods(loadedPeriods);
        setPeriodsGenerated(true);
        setPayFrequency(migrationEntries[0].migration_pay_frequency || 'bi_weekly');
      }

    } catch (error) {
      console.error('Error loading employee data:', error);
      setSaveMessage(`Error loading data: ${error.message}`);
      setSaveMessageType('error');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setPeriods([]);
    setPeriodsGenerated(false);
    setExpandedPeriods(new Set());
    setYtdData(null);
    setShowValidationWarning(false);
    setValidationBypass(false);
    setExistingPayrollEntries([]);
    setShowExistingWarning(false);
    setAcknowledgedExisting(false);
    setEmployeeIsCurrent(true);
    setLastDayWorked('');
    setSaveMessage('');
  };

  const getPeriodsCount = (frequency) => {
    switch (frequency) {
      case 'weekly':
        return 53;
      case 'bi_weekly':
        return 27;
      case 'semi_monthly':
        return 24;
      case 'monthly':
        return 12;
      default:
        return 27;
    }
  };

  const getDaysPerPeriod = (frequency) => {
    switch (frequency) {
      case 'weekly':
        return 7;
      case 'bi_weekly':
        return 14;
      case 'semi_monthly':
        return 15;
      case 'monthly':
        return 30;
      default:
        return 14;
    }
  };

  const generatePeriods = () => {
    if (!selectedEmployee) {
      setSaveMessage('Please select an employee first.');
      setSaveMessageType('error');
      return;
    }

    if (!employeeIsCurrent && !lastDayWorked) {
      setSaveMessage('Please enter the last day worked for terminated employees.');
      setSaveMessageType('error');
      return;
    }

    const endDate = employeeIsCurrent ? new Date() : new Date(lastDayWorked);
    const periodsCount = getPeriodsCount(payFrequency);
    const daysPerPeriod = getDaysPerPeriod(payFrequency);

    const generatedPeriods = [];

    for (let i = 0; i < periodsCount; i++) {
      const periodEnd = new Date(endDate);
      periodEnd.setDate(periodEnd.getDate() - (i * daysPerPeriod));

      const periodStart = new Date(periodEnd);
      periodStart.setDate(periodStart.getDate() - daysPerPeriod + 1);

      // Pay date is typically a few days after period end
      const payDate = new Date(periodEnd);
      payDate.setDate(payDate.getDate() + 3);

      generatedPeriods.unshift({
        id: null,
        periodNumber: i + 1,
        startDate: periodStart.toISOString().split('T')[0],
        endDate: periodEnd.toISOString().split('T')[0],
        payDate: payDate.toISOString().split('T')[0],
        regularEarnings: '',
        overtimeEarnings: '',
        vacationPayIncluded: false,
        vacationPayAmount: '',
        regularHours: '',
        overtimeHours: ''
      });
    }

    setPeriods(generatedPeriods);
    setPeriodsGenerated(true);
    
    // Expand first 3 periods by default
    setExpandedPeriods(new Set([1, 2, 3]));

    setSaveMessage(`Generated ${periodsCount} periods. Please fill in the earnings for each period.`);
    setSaveMessageType('success');
  };

  const togglePeriod = (periodNumber) => {
    const newExpanded = new Set(expandedPeriods);
    if (newExpanded.has(periodNumber)) {
      newExpanded.delete(periodNumber);
    } else {
      newExpanded.add(periodNumber);
    }
    setExpandedPeriods(newExpanded);
  };

  const expandAll = () => {
    setExpandedPeriods(new Set(periods.map(p => p.periodNumber)));
  };

  const collapseAll = () => {
    setExpandedPeriods(new Set());
  };

  const updatePeriod = (periodNumber, field, value) => {
    setPeriods(prev => prev.map(period => 
      period.periodNumber === periodNumber
        ? { ...period, [field]: value }
        : period
    ));

    // Recalculate validation when data changes
    if (ytdData) {
      calculateValidation();
    }
  };

  const calculateTotals = () => {
    let totalRegular = 0;
    let totalOvertime = 0;
    let totalVacation = 0;
    let totalRegularHours = 0;
    let totalOvertimeHours = 0;

    periods.forEach(period => {
      totalRegular += parseFloat(period.regularEarnings) || 0;
      totalOvertime += parseFloat(period.overtimeEarnings) || 0;
      if (period.vacationPayIncluded) {
        totalVacation += parseFloat(period.vacationPayAmount) || 0;
      }
      totalRegularHours += parseFloat(period.regularHours) || 0;
      totalOvertimeHours += parseFloat(period.overtimeHours) || 0;
    });

    const grandTotal = totalRegular + totalOvertime + totalVacation;

    return {
      totalRegular,
      totalOvertime,
      totalVacation,
      totalRegularHours,
      totalOvertimeHours,
      grandTotal
    };
  };

  const calculateValidation = () => {
    if (!ytdData) return;

    const totals = calculateTotals();
    const ytdTotal = (parseFloat(ytdData.regular_income) || 0) +
                    (parseFloat(ytdData.overtime_income) || 0) +
                    (parseFloat(ytdData.vacation_pay) || 0);

    const difference = Math.abs(totals.grandTotal - ytdTotal);
    
    // Allow for small rounding differences (within $10)
    if (difference > 10) {
      setShowValidationWarning(true);
    } else {
      setShowValidationWarning(false);
    }
  };

  const savePeriods = async () => {
    if (!selectedEmployee) {
      setSaveMessage('Please select an employee first.');
      setSaveMessageType('error');
      return;
    }

    if (periods.length === 0) {
      setSaveMessage('Please generate periods first.');
      setSaveMessageType('error');
      return;
    }

    // Check if any period is missing required data
    const incompletePeriods = periods.filter(p => 
      !p.regularEarnings && !p.overtimeEarnings
    );

    if (incompletePeriods.length > 0) {
      setSaveMessage(`${incompletePeriods.length} period(s) are missing earnings data. Please fill in all periods or remove empty ones.`);
      setSaveMessageType('error');
      return;
    }

    // Validation warning check
    if (showValidationWarning && !validationBypass) {
      setSaveMessage('Period totals do not match YTD summary. Please review or click "Bypass Validation" to save anyway.');
      setSaveMessageType('warning');
      return;
    }

    // Existing payroll warning check
    if (showExistingWarning && !acknowledgedExisting) {
      setSaveMessage('This employee has existing payroll entries. Please acknowledge the warning before proceeding.');
      setSaveMessageType('warning');
      return;
    }

    const rateLimitCheck = await checkRateLimit('period_entry_save');
    if (!rateLimitCheck.allowed) {
      setSaveMessage('Rate limit exceeded. Please wait before saving again.');
      setSaveMessageType('error');
      return;
    }

    setSaving(true);
    setSaveMessage('');

    try {
      await recordAction('period_payroll_save_started', true);

      // Delete existing migration entries for this employee first
      const { error: deleteError } = await supabase
        .from('hrpayroll_entries')
        .delete()
        .eq('user_id', selectedEmployee)
        .eq('business_id', effectiveBusinessId)
        .eq('is_migration_entry', true);

      if (deleteError) throw deleteError;

      // Prepare entries for insertion
      const entriesToInsert = periods.map(period => {
        const regularEarnings = parseFloat(period.regularEarnings) || 0;
        const overtimeEarnings = parseFloat(period.overtimeEarnings) || 0;
        const vacationPay = period.vacationPayIncluded ? (parseFloat(period.vacationPayAmount) || 0) : 0;
        const grossPay = regularEarnings + overtimeEarnings + vacationPay;

        return {
          user_id: selectedEmployee,
          business_id: effectiveBusinessId,
          payroll_run_id: null,
          is_migration_entry: true,
          migration_period_number: period.periodNumber,
          migration_pay_frequency: payFrequency,
          period_start_date: period.startDate,
          period_end_date: period.endDate,
          pay_date: period.payDate,
          regular_hours: parseFloat(period.regularHours) || 0,
          overtime_hours: parseFloat(period.overtimeHours) || 0,
          gross_pay: grossPay,
          vacation_pay: vacationPay,
          federal_tax: 0, // Migration entries don't include deductions
          provincial_tax: 0,
          cpp_deduction: 0,
          ei_deduction: 0,
          additional_tax: 0,
          net_pay: grossPay,
          manual_entry_reason: 'Period-by-period migration data entry',
          created_by: authUser.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      });

      const { error: insertError } = await supabase
        .from('hrpayroll_entries')
        .insert(entriesToInsert);

      if (insertError) throw insertError;

      await logSecurityEvent('period_payroll_data_saved', {
        employee_id: selectedEmployee,
        business_id: effectiveBusinessId,
        periods_count: periods.length,
        pay_frequency: payFrequency,
        total_gross_pay: calculateTotals().grandTotal,
        validation_bypassed: validationBypass
      }, 'medium');

      setSaveMessage(`Successfully saved ${periods.length} payroll periods!`);
      setSaveMessageType('success');

      // Reset bypass flags after successful save
      setValidationBypass(false);
      setAcknowledgedExisting(false);

    } catch (error) {
      console.error('Error saving periods:', error);
      setSaveMessage(`Error saving data: ${error.message}`);
      setSaveMessageType('error');
      await recordAction('period_payroll_save_failed', false);
    } finally {
      setSaving(false);
    }
  };

  const totals = calculateTotals();
  const selectedEmployeeDetails = filteredEmployees.find(emp => emp.id === selectedEmployee);

  const styles = {
    container: {
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray50,
      minHeight: '100vh'
    },
    section: {
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.lg,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
      marginBottom: TavariStyles.spacing.lg
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: TavariStyles.spacing.md,
      color: TavariStyles.colors.gray800,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      paddingBottom: TavariStyles.spacing.sm
    },
    formGroup: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.xs,
      marginBottom: TavariStyles.spacing.md
    },
    label: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700
    },
    input: {
      padding: '12px 16px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      transition: 'border-color 0.2s',
      fontFamily: 'inherit',
      backgroundColor: TavariStyles.colors.white
    },
    select: {
      padding: '12px 16px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      backgroundColor: TavariStyles.colors.white,
      cursor: 'pointer'
    },
    button: {
      ...TavariStyles.components.button?.base || {
        padding: '12px 24px',
        borderRadius: TavariStyles.borderRadius?.md || '6px',
        border: 'none',
        fontSize: TavariStyles.typography.fontSize.sm,
        fontWeight: TavariStyles.typography.fontWeight.semibold,
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      },
      ...TavariStyles.components.button?.variants?.primary || {
        backgroundColor: TavariStyles.colors.primary,
        color: TavariStyles.colors.white
      }
    },
    secondaryButton: {
      padding: '8px 16px',
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      cursor: 'pointer',
      backgroundColor: TavariStyles.colors.white,
      color: TavariStyles.colors.gray700,
      transition: 'all 0.2s ease'
    },
    accordionItem: {
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      marginBottom: TavariStyles.spacing.sm,
      overflow: 'hidden'
    },
    accordionHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      cursor: 'pointer',
      transition: 'background-color 0.2s'
    },
    accordionHeaderHover: {
      backgroundColor: TavariStyles.colors.gray100
    },
    accordionTitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      flex: 1
    },
    accordionSubtitle: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      marginLeft: TavariStyles.spacing.md
    },
    accordionContent: {
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.white
    },
    periodGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: TavariStyles.spacing.md
    },
    periodTotal: {
      marginTop: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      borderLeft: `4px solid ${TavariStyles.colors.primary}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    totalsCard: {
      backgroundColor: TavariStyles.colors.primary + '10',
      border: `1px solid ${TavariStyles.colors.primary}30`,
      padding: TavariStyles.spacing.lg,
      borderRadius: TavariStyles.borderRadius?.lg || '12px'
    },
    totalRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: `${TavariStyles.spacing.sm} 0`,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`
    },
    totalLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      color: TavariStyles.colors.gray700
    },
    totalValue: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.primary
    },
    messageBox: {
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      marginBottom: TavariStyles.spacing.md,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm
    },
    successMessage: {
      backgroundColor: TavariStyles.colors.successBg,
      color: TavariStyles.colors.success,
      border: `1px solid ${TavariStyles.colors.success}30`
    },
    errorMessage: {
      backgroundColor: TavariStyles.colors.errorBg,
      color: TavariStyles.colors.danger,
      border: `1px solid ${TavariStyles.colors.danger}30`
    },
    warningMessage: {
      backgroundColor: TavariStyles.colors.warningBg,
      color: TavariStyles.colors.warning,
      border: `1px solid ${TavariStyles.colors.warning}30`
    },
    infoMessage: {
      backgroundColor: TavariStyles.colors.info + '10',
      color: TavariStyles.colors.info,
      border: `1px solid ${TavariStyles.colors.info}30`
    },
    warningCard: {
      backgroundColor: TavariStyles.colors.warningBg,
      border: `2px solid ${TavariStyles.colors.warning}`,
      padding: TavariStyles.spacing.lg,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      marginBottom: TavariStyles.spacing.md
    },
    warningTitle: {
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.warning,
      marginBottom: TavariStyles.spacing.sm,
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs
    },
    warningContent: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.md
    },
    existingEntriesList: {
      maxHeight: '200px',
      overflowY: 'auto',
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      marginTop: TavariStyles.spacing.sm
    },
    existingEntry: {
      padding: `${TavariStyles.spacing.xs} 0`,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600
    },
    buttonGroup: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      marginTop: TavariStyles.spacing.md
    },
    filterInfo: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray600,
      marginTop: TavariStyles.spacing.xs,
      fontStyle: 'italic'
    },
    employeeInfo: {
      backgroundColor: TavariStyles.colors.info + '10',
      border: `1px solid ${TavariStyles.colors.info}30`,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      marginBottom: TavariStyles.spacing.md
    },
    employeeInfoTitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.sm
    },
    employeeInfoGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    }
  };

  if (loading) {
    return (
      <POSAuthWrapper
        componentName="PeriodByPeriodEntry"
        requiredRoles={['owner', 'manager', 'hr_admin']}
        requireBusiness={true}
      >
        <div style={styles.container}>
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Loading...</h3>
            <p>Loading employees and payroll data...</p>
          </div>
        </div>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper
      componentName="PeriodByPeriodEntry"
      requiredRoles={['owner', 'manager', 'hr_admin']}
      requireBusiness={true}
    >
      <SecurityWrapper
        componentName="PeriodByPeriodEntry"
        securityLevel="critical"
        enableAuditLogging={true}
        sensitiveComponent={true}
      >
        <div style={styles.container}>
          {/* Header */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Period-by-Period Payroll Entry</h3>
            <div style={{...styles.messageBox, ...styles.infoMessage}}>
              <Info size={20} />
              <span>
                This tool is for entering historical payroll data during migration. 
                Use this when migrating from another system to ensure accurate ROE reporting.
              </span>
            </div>
          </div>

          {/* Employee Selection */}
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

            {/* Save Message */}
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
          </div>

          {/* Existing Payroll Warning */}
          {selectedEmployee && showExistingWarning && existingPayrollEntries.length > 0 && (
            <div style={styles.warningCard}>
              <div style={styles.warningTitle}>
                <AlertTriangle size={24} />
                Existing Payroll Entries Detected
              </div>
              <div style={styles.warningContent}>
                This employee has <strong>{existingPayrollEntries.length} existing payroll entries</strong> in the system. 
                Entering period-by-period data here may create duplicates or conflicts with existing records.
                
                <div style={styles.existingEntriesList}>
                  <strong>Existing entries:</strong>
                  {existingPayrollEntries.slice(0, 10).map((entry, idx) => (
                    <div key={idx} style={styles.existingEntry}>
                      Pay Date: {entry.pay_date || entry.hrpayroll_runs?.pay_date || 'N/A'} | 
                      Gross Pay: ${formatTaxAmount(entry.gross_pay)} | 
                      {entry.is_migration_entry ? ' (Migration Entry)' : ' (Payroll Run)'}
                    </div>
                  ))}
                  {existingPayrollEntries.length > 10 && (
                    <div style={styles.existingEntry}>
                      ... and {existingPayrollEntries.length - 10} more entries
                    </div>
                  )}
                </div>
              </div>
              
              <TavariCheckbox
                checked={acknowledgedExisting}
                onChange={setAcknowledgedExisting}
                label="I understand and want to proceed with entering migration data"
                size="md"
              />
            </div>
          )}

          {/* Pay Frequency Settings */}
          {selectedEmployee && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Pay Frequency Settings</h3>
              
              <TavariCheckbox
                checked={useBusinessDefault}
                onChange={setUseBusinessDefault}
                label="Use business default pay frequency settings"
                size="md"
              />

              <div style={styles.formGroup}>
                <label style={styles.label}>Pay Frequency:</label>
                <select
                  style={styles.select}
                  value={payFrequency}
                  onChange={(e) => setPayFrequency(e.target.value)}
                  disabled={useBusinessDefault}
                >
                  <option value="weekly">Weekly (53 periods)</option>
                  <option value="bi_weekly">Bi-Weekly (27 periods)</option>
                  <option value="semi_monthly">Semi-Monthly (24 periods)</option>
                  <option value="monthly">Monthly (12 periods)</option>
                </select>
              </div>

              <TavariCheckbox
                checked={employeeIsCurrent}
                onChange={setEmployeeIsCurrent}
                label="Employee is still current/active"
                size="md"
              />

              {!employeeIsCurrent && (
                <div style={styles.formGroup}>
                  <label style={styles.label}>Last Day Worked:</label>
                  <input
                    type="date"
                    style={styles.input}
                    value={lastDayWorked}
                    onChange={(e) => setLastDayWorked(e.target.value)}
                    max={new Date().toISOString().split('T')[0]}
                  />
                </div>
              )}

              <button
                style={styles.button}
                onClick={generatePeriods}
                disabled={!selectedEmployee || (!employeeIsCurrent && !lastDayWorked)}
              >
                {periodsGenerated ? 'Regenerate Periods' : 'Generate Periods'}
              </button>
            </div>
          )}

          {/* Periods Entry */}
          {periodsGenerated && periods.length > 0 && (
            <>
              <div style={styles.section}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: TavariStyles.spacing.md }}>
                  <h3 style={styles.sectionTitle}>Payroll Periods ({periods.length})</h3>
                  <div style={{ display: 'flex', gap: TavariStyles.spacing.sm }}>
                    <button style={styles.secondaryButton} onClick={expandAll}>
                      Expand All
                    </button>
                    <button style={styles.secondaryButton} onClick={collapseAll}>
                      Collapse All
                    </button>
                  </div>
                </div>

                {periods.map((period) => {
                  const isExpanded = expandedPeriods.has(period.periodNumber);
                  const periodTotal = (parseFloat(period.regularEarnings) || 0) +
                                    (parseFloat(period.overtimeEarnings) || 0) +
                                    (period.vacationPayIncluded ? (parseFloat(period.vacationPayAmount) || 0) : 0);

                  return (
                    <div key={period.periodNumber} style={styles.accordionItem}>
                      <div
                        style={styles.accordionHeader}
                        onClick={() => togglePeriod(period.periodNumber)}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = styles.accordionHeaderHover.backgroundColor}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = styles.accordionHeader.backgroundColor}
                      >
                        <div style={styles.accordionTitle}>
                          Period {period.periodNumber}: {new Date(period.startDate).toLocaleDateString()} - {new Date(period.endDate).toLocaleDateString()}
                        </div>
                        <div style={styles.accordionSubtitle}>
                          Pay Date: {new Date(period.payDate).toLocaleDateString()}
                        </div>
                        <div style={styles.accordionSubtitle}>
                          Total: ${formatTaxAmount(periodTotal)}
                        </div>
                        {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                      </div>

                      {isExpanded && (
                        <div style={styles.accordionContent}>
                          <div style={styles.periodGrid}>
                            <div style={styles.formGroup}>
                              <label style={styles.label}>Period Start Date:</label>
                              <input
                                type="date"
                                style={styles.input}
                                value={period.startDate}
                                onChange={(e) => updatePeriod(period.periodNumber, 'startDate', e.target.value)}
                              />
                            </div>

                            <div style={styles.formGroup}>
                              <label style={styles.label}>Period End Date:</label>
                              <input
                                type="date"
                                style={styles.input}
                                value={period.endDate}
                                onChange={(e) => updatePeriod(period.periodNumber, 'endDate', e.target.value)}
                              />
                            </div>

                            <div style={styles.formGroup}>
                              <label style={styles.label}>Pay Date:</label>
                              <input
                                type="date"
                                style={styles.input}
                                value={period.payDate}
                                onChange={(e) => updatePeriod(period.periodNumber, 'payDate', e.target.value)}
                              />
                            </div>

                            <div style={styles.formGroup}>
                              <label style={styles.label}>Regular Hours:</label>
                              <input
                                type="number"
                                step="0.25"
                                min="0"
                                style={styles.input}
                                value={period.regularHours}
                                onChange={(e) => updatePeriod(period.periodNumber, 'regularHours', e.target.value)}
                                placeholder="0.00"
                              />
                            </div>

                            <div style={styles.formGroup}>
                              <label style={styles.label}>Regular Earnings:</label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                style={styles.input}
                                value={period.regularEarnings}
                                onChange={(e) => updatePeriod(period.periodNumber, 'regularEarnings', e.target.value)}
                                placeholder="0.00"
                              />
                            </div>

                            <div style={styles.formGroup}>
                              <label style={styles.label}>Overtime Hours:</label>
                              <input
                                type="number"
                                step="0.25"
                                min="0"
                                style={styles.input}
                                value={period.overtimeHours}
                                onChange={(e) => updatePeriod(period.periodNumber, 'overtimeHours', e.target.value)}
                                placeholder="0.00"
                              />
                            </div>

                            <div style={styles.formGroup}>
                              <label style={styles.label}>Overtime Earnings:</label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                style={styles.input}
                                value={period.overtimeEarnings}
                                onChange={(e) => updatePeriod(period.periodNumber, 'overtimeEarnings', e.target.value)}
                                placeholder="0.00"
                              />
                            </div>
                          </div>

                          <div style={{ marginTop: TavariStyles.spacing.md }}>
                            <TavariCheckbox
                              checked={period.vacationPayIncluded}
                              onChange={(checked) => updatePeriod(period.periodNumber, 'vacationPayIncluded', checked)}
                              label="Vacation Pay Included This Period"
                              size="md"
                            />

                            {period.vacationPayIncluded && (
                              <div style={{ ...styles.formGroup, marginTop: TavariStyles.spacing.sm }}>
                                <label style={styles.label}>Vacation Pay Amount:</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  style={styles.input}
                                  value={period.vacationPayAmount}
                                  onChange={(e) => updatePeriod(period.periodNumber, 'vacationPayAmount', e.target.value)}
                                  placeholder="0.00"
                                />
                              </div>
                            )}
                          </div>

                          <div style={styles.periodTotal}>
                            <span style={styles.totalLabel}>Period Total:</span>
                            <span style={styles.totalValue}>${formatTaxAmount(periodTotal)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Totals Summary */}
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>Totals Summary</h3>
                
                <div style={styles.totalsCard}>
                  <div style={styles.totalRow}>
                    <span style={styles.totalLabel}>Total Regular Hours:</span>
                    <span style={styles.totalValue}>{formatTaxAmount(totals.totalRegularHours)} hours</span>
                  </div>
                  
                  <div style={styles.totalRow}>
                    <span style={styles.totalLabel}>Total Overtime Hours:</span>
                    <span style={styles.totalValue}>{formatTaxAmount(totals.totalOvertimeHours)} hours</span>
                  </div>
                  
                  <div style={styles.totalRow}>
                    <span style={styles.totalLabel}>Total Regular Earnings:</span>
                    <span style={styles.totalValue}>${formatTaxAmount(totals.totalRegular)}</span>
                  </div>
                  
                  <div style={styles.totalRow}>
                    <span style={styles.totalLabel}>Total Overtime Earnings:</span>
                    <span style={styles.totalValue}>${formatTaxAmount(totals.totalOvertime)}</span>
                  </div>
                  
                  <div style={styles.totalRow}>
                    <span style={styles.totalLabel}>Total Vacation Pay:</span>
                    <span style={styles.totalValue}>${formatTaxAmount(totals.totalVacation)}</span>
                  </div>
                  
                  <div style={{...styles.totalRow, borderBottom: 'none', borderTop: `2px solid ${TavariStyles.colors.primary}`}}>
                    <span style={{...styles.totalLabel, fontWeight: TavariStyles.typography.fontWeight.bold}}>
                      Grand Total:
                    </span>
                    <span style={{...styles.totalValue, fontSize: TavariStyles.typography.fontSize['2xl']}}>
                      ${formatTaxAmount(totals.grandTotal)}
                    </span>
                  </div>
                </div>

                {/* YTD Comparison */}
                {ytdData && (
                  <div style={{ marginTop: TavariStyles.spacing.lg }}>
                    <h4 style={{ ...styles.sectionTitle, fontSize: TavariStyles.typography.fontSize.md }}>
                      YTD Summary Comparison
                    </h4>
                    
                    {(() => {
                      const ytdTotal = (parseFloat(ytdData.regular_income) || 0) +
                                      (parseFloat(ytdData.overtime_income) || 0) +
                                      (parseFloat(ytdData.vacation_pay) || 0);
                      const difference = totals.grandTotal - ytdTotal;
                      const isMatch = Math.abs(difference) <= 10; // Allow $10 tolerance

                      return (
                        <div style={{
                          ...styles.messageBox,
                          ...(isMatch ? styles.successMessage : styles.warningMessage)
                        }}>
                          {isMatch ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
                          <div>
                            <div><strong>YTD Summary Total:</strong> ${formatTaxAmount(ytdTotal)}</div>
                            <div><strong>Period Totals:</strong> ${formatTaxAmount(totals.grandTotal)}</div>
                            <div><strong>Difference:</strong> ${formatTaxAmount(Math.abs(difference))} {difference > 0 ? '(higher)' : '(lower)'}</div>
                            {!isMatch && (
                              <div style={{ marginTop: TavariStyles.spacing.sm }}>
                                <TavariCheckbox
                                  checked={validationBypass}
                                  onChange={setValidationBypass}
                                  label="Bypass validation and save anyway"
                                  size="md"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Save Button */}
              <div style={{ textAlign: 'center', marginBottom: TavariStyles.spacing.xl }}>
                <button
                  style={{
                    ...styles.button,
                    opacity: saving ? 0.6 : 1,
                    cursor: saving ? 'not-allowed' : 'pointer'
                  }}
                  onClick={savePeriods}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : `Save ${periods.length} Payroll Periods`}
                </button>
              </div>
            </>
          )}
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default PeriodByPeriodEntry;