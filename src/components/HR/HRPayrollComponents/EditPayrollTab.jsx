// components/HR/HRPayrollComponents/EditPayrollTab.jsx - COMPLETE FIXED VERSION
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../../supabaseClient';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import { useCanadianTaxCalculations } from '../../../hooks/useCanadianTaxCalculations';
import { usePayrollCalculations } from '../../../hooks/usePayrollCalculations';
import POSAuthWrapper from '../../../components/Auth/POSAuthWrapper';
import { TavariStyles } from '../../../utils/TavariStyles';
import { deletePayrollRunWithRefunds } from '../../../helpers/Payroll/deletePayrollRun';
import { syncUsersLieuBalanceFromLedger } from '../../../helpers/Payroll/lieuTimeLedger';

const EditPayrollTab = ({ selectedBusinessId, businessData }) => {
  const [payrollRuns, setPayrollRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [payrollEntries, setPayrollEntries] = useState([]);
  const [employeeHours, setEmployeeHours] = useState({});
  const [employeePremiums, setEmployeePremiums] = useState({});
  const [allPremiums, setAllPremiums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [validationErrors, setValidationErrors] = useState({});
  const [editedEmployees, setEditedEmployees] = useState(new Set());
  const [deletingRun, setDeletingRun] = useState(false);
  const [deletingEntryId, setDeletingEntryId] = useState(null);

  // Security context
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'EditPayrollTab',
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
    componentName: 'EditPayrollTab'
  });

  // Tax calculations
  const { formatTaxAmount } = useTaxCalculations(selectedBusinessId || authBusinessId);
  const effectiveBusinessId = selectedBusinessId || authBusinessId;
  const effectiveBusinessData = businessData || authBusinessData;
  
  // Payroll calculations hook
  const payrollCalculations = usePayrollCalculations(effectiveBusinessId);
  
  // Canadian tax calculations
  const canadianTax = useCanadianTaxCalculations(effectiveBusinessId);

  // Check if payroll calculations are ready
  const isPayrollReady = useMemo(() => {
    return payrollCalculations && 
           payrollCalculations.settings && 
           typeof payrollCalculations.settings === 'object';
  }, [payrollCalculations]);
  
  // Timezone-safe date formatting helper
  const formatDateForBusiness = useCallback((dateString) => {
    try {
      const tz = effectiveBusinessData?.timezone || 'America/Toronto';
      let value = dateString;

      if (typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        value = `${dateString}T12:00:00`;
      }

      return new Date(value).toLocaleString('en-CA', {
        timeZone: tz,
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (err) {
      console.error('Error formatting date for timezone:', err);
      return dateString;
    }
  }, [effectiveBusinessData]);

  // Load finalized payroll runs
  useEffect(() => {
    if (effectiveBusinessId) {
      loadPayrollRuns();
    }
  }, [effectiveBusinessId]);

  const loadPayrollRuns = async () => {
    if (!effectiveBusinessId) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('hrpayroll_runs')
        .select('*')
        .eq('business_id', effectiveBusinessId)
        .eq('status', 'finalized')
        .order('pay_period_end', { ascending: false });

      if (error) throw error;

      // Normalise column names so legacy UI paths still work (`period_start/period_end`)
      const normalizedRuns = (data || []).map((run) => ({
        ...run,
        period_start: run.period_start || run.pay_period_start || run.period_start,
        period_end: run.period_end || run.pay_period_end || run.period_end,
      }));

      setPayrollRuns(normalizedRuns);
    } catch (error) {
      console.error('Error loading payroll runs:', error);
      setSaveMessage('Error loading payroll runs');
    } finally {
      setLoading(false);
    }
  };

  const loadPayrollEntries = async (runId) => {
    if (!runId) return;

    setLoading(true);
    try {
      // Load payroll entries with user data
      const { data: entries, error: entriesError } = await supabase
        .from('hrpayroll_entries')
        .select(`
          *,
          employee:users!hrpayroll_entries_user_id_fkey (
            id,
            full_name,
            wage,
            email
          )
        `)
        .eq('payroll_run_id', runId)
        .order('employee(full_name)');

      if (entriesError) throw entriesError;

      setPayrollEntries(entries || []);

      // Initialize employee hours from payroll entries
      const hoursData = {};
      const premiumsData = {};
      
      entries?.forEach(entry => {
        hoursData[entry.user_id] = {
          regular_hours: parseFloat(entry.regular_hours) || 0,
          overtime_hours: parseFloat(entry.overtime_hours) || 0,
          lieu_hours: parseFloat(entry.lieu_hours) || 0
        };

        // Load existing premiums for this entry
        const normalizedPremiums = {};
        if (entry.premiums && typeof entry.premiums === 'object') {
          Object.entries(entry.premiums).forEach(([premiumName, premiumValue]) => {
            if (premiumValue && typeof premiumValue === 'object') {
              const numericHours = parseFloat(premiumValue.hours) || 0;
              if (numericHours > 0) {
                normalizedPremiums[premiumName] = numericHours;
              }
            } else {
              const numericHours = parseFloat(premiumValue) || 0;
              if (numericHours > 0) {
                normalizedPremiums[premiumName] = numericHours;
              }
            }
          });
        }
        premiumsData[entry.user_id] = normalizedPremiums;
      });

      setEmployeeHours(hoursData);
      setEmployeePremiums(premiumsData);

      // Load all available premiums for this business
      await loadShiftPremiums();

    } catch (error) {
      console.error('Error loading payroll entries:', error);
      setSaveMessage('Error loading payroll entries');
    } finally {
      setLoading(false);
    }
  };

  const loadShiftPremiums = async () => {
    try {
      const { data, error } = await supabase
        .from('hr_shift_premiums')
        .select('*')
        .eq('business_id', effectiveBusinessId)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      setAllPremiums(data || []);
    } catch (error) {
      if (error?.code === '42P01') {
        console.warn('Shift premium table not available for this tenant, skipping.', error);
        setAllPremiums([]);
        return;
      }
      console.error('Error loading shift premiums:', error);
    }
  };

  const handleRunSelection = (runId) => {
    const run = payrollRuns.find(r => r.id === runId);
    setSelectedRun(run);
    setEditedEmployees(new Set());
    setSaveMessage('');
    
    if (runId) {
      loadPayrollEntries(runId);
    } else {
      setPayrollEntries([]);
      setEmployeeHours({});
      setEmployeePremiums({});
    }
  };

  const updateEmployeeHours = (userId, field, value) => {
    const numericValue = Math.max(0, parseFloat(value) || 0);
    
    setEmployeeHours(prev => ({
      ...prev,
      [userId]: {
        ...prev[userId],
        [field]: numericValue
      }
    }));

    setEditedEmployees(prev => new Set([...prev, userId]));
  };

  const updateEmployeePremium = (userId, premiumName, hours) => {
    const numericHours = Math.max(0, parseFloat(hours) || 0);

    setEmployeePremiums(prev => {
      const currentPremiums = { ...(prev[userId] || {}) };
      if (numericHours > 0) {
        currentPremiums[premiumName] = numericHours;
      } else {
        delete currentPremiums[premiumName];
      }

      return {
        ...prev,
        [userId]: currentPremiums
      };
    });

    setEditedEmployees(prev => new Set([...prev, userId]));
  };

  // Calculate display values for an employee (estimated for UI)
  const getEmployeeDisplayValues = useCallback((userId) => {
    const hours = employeeHours[userId] || { regular_hours: 0, overtime_hours: 0, lieu_hours: 0 };
    const premiums = employeePremiums[userId] || {};
    const entry = payrollEntries.find(e => e.user_id === userId);
    
    if (!entry || !entry.employee) return null;

    const wage = parseFloat(entry.employee.wage) || 15.00;
    
    // Basic pay calculation
    const regularPay = hours.regular_hours * wage;
    const overtimePay = hours.overtime_hours * wage * 1.5;
    const lieuPay = hours.lieu_hours * wage;
    
    // Premium pay calculation
    let premiumPay = 0;
    allPremiums.forEach(premium => {
      const premiumHours = premiums[premium.name] || 0;
      const appliesToLieu = premium.applies_to === 'lieu';

      if (appliesToLieu) {
        const lieuHours = parseFloat(hours.lieu_hours) || 0;
        if (lieuHours <= 0) {
          return;
        }

        const effectiveHours = premium.use_multiplier
          ? lieuHours * (premium.multiplier || 1)
          : lieuHours;

        if (premium.type === 'percentage') {
          premiumPay += effectiveHours * wage * (premium.rate / 100);
        } else {
          premiumPay += effectiveHours * premium.rate;
        }
      } else if (premiumHours > 0) {
        if (premium.type === 'percentage') {
          premiumPay += premiumHours * wage * (premium.rate / 100);
        } else {
          premiumPay += premiumHours * premium.rate;
        }
      }
    });

    const grossPay = regularPay + overtimePay + lieuPay + premiumPay;
    const vacationPay = grossPay * 0.04; // 4% vacation pay

    // Simplified tax calculations for display only (real tax uses useCanadianTaxCalculations).
    // Updated for CRA 2026 (T4127 122nd Edition).
    const totalIncome = grossPay + vacationPay;
    const federalTax = totalIncome * 0.14; // 2026 lowest federal bracket
    const provincialTax = totalIncome * 0.0505; // ON 2026 lowest bracket
    const eiDeduction = Math.min(totalIncome * 0.0163, 1123.07); // 2026 EI rate, max $1,123.07
    const cppDeduction = Math.min(Math.max(totalIncome - 3500, 0) * 0.0595, 4230.45); // 2026 CPP, max $4,230.45 (employee)

    const totalDeductions = federalTax + provincialTax + eiDeduction + cppDeduction;
    const netPay = totalIncome - totalDeductions;

    return {
      regular_pay: regularPay,
      overtime_pay: overtimePay,
      lieu_pay: lieuPay,
      premium_pay: premiumPay,
      gross_pay: grossPay,
      vacation_pay: vacationPay,
      federal_tax: federalTax,
      provincial_tax: provincialTax,
      ei_deduction: eiDeduction,
      cpp_deduction: cppDeduction,
      total_deductions: totalDeductions,
      net_pay: netPay
    };
  }, [employeeHours, employeePremiums, payrollEntries, allPremiums]);

  const saveEditedPayroll = async () => {
    if (editedEmployees.size === 0) {
      setSaveMessage('No changes to save');
      return;
    }

    setSaving(true);
    setSaveMessage('');

    try {
      // Process each edited employee
      for (const userId of editedEmployees) {
        const entry = payrollEntries.find(e => e.user_id === userId);
        if (!entry) continue;

        const hours = employeeHours[userId];
        const premiums = employeePremiums[userId] || {};

        // Use proper payroll calculations for accurate values
        const existingPremiumDetails = entry.premiums && typeof entry.premiums === 'object' ? entry.premiums : {};
        const premiumPayload = {};

        Object.entries(premiums).forEach(([premiumName, hoursValue]) => {
          const numericHours = Math.max(0, parseFloat(hoursValue) || 0);
          if (numericHours <= 0) {
            return;
          }

          const premiumDef = allPremiums.find(p => p.name === premiumName);
          const fallback = existingPremiumDetails[premiumName] || {};
          const rate = premiumDef ? parseFloat(premiumDef.rate || 0) : parseFloat(fallback.rate || 0) || 0;
          const rateType = premiumDef ? (premiumDef.type === 'percentage' ? 'percentage' : 'fixed_amount') : (fallback.rate_type || 'fixed_amount');
          const appliesToLieu = premiumDef ? premiumDef.applies_to === 'lieu' : fallback.applies_to === 'lieu';
          const useMultiplier = premiumDef ? premiumDef.use_multiplier : fallback.use_multiplier;
          const multiplier = premiumDef ? (premiumDef.multiplier || 1) : (fallback.multiplier || 1);

          const wage = parseFloat(entry.employee?.wage || 0);

          let effectiveHours = numericHours;
          if (appliesToLieu) {
            const lieuHours = parseFloat(hours.lieu_hours) || 0;
            effectiveHours = useMultiplier ? lieuHours * multiplier : lieuHours;
          }

          let totalPay = 0;
          if (rateType === 'percentage') {
            totalPay = effectiveHours * wage * (rate / 100);
          } else {
            totalPay = effectiveHours * rate;
          }

          premiumPayload[premiumName] = {
            rate,
            rate_type: rateType,
            hours: numericHours,
            total_pay: Number.isFinite(totalPay) ? Number(totalPay.toFixed(2)) : 0,
            applies_to: appliesToLieu ? 'lieu' : 'regular'
          };
        });

        const { error: updateError } = await supabase
          .from('hrpayroll_entries')
          .update({
            business_id: effectiveBusinessId,
            regular_hours: hours.regular_hours,
            overtime_hours: hours.overtime_hours,
            lieu_hours: hours.lieu_hours,
            premiums: premiumPayload,
            updated_at: new Date().toISOString()
          })
          .eq('id', entry.id);

        if (updateError) throw updateError;

        // Log audit trail
        await recordAction({
          action: 'payroll_edit',
          details: {
            payroll_run_id: selectedRun.id,
            employee_id: userId,
            changes: {
              hours: hours,
              premiums: premiums
            }
          }
        });
      }

      // Update payroll run status to indicate it was edited
      const { error: runUpdateError } = await supabase
        .from('hrpayroll_runs')
        .update({
          status: 'edited',
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedRun.id);

      if (runUpdateError) throw runUpdateError;

      setSaveMessage(`Successfully saved changes for ${editedEmployees.size} employee(s)`);
      setEditedEmployees(new Set());

      // Reload the entries to show updated values
      await loadPayrollEntries(selectedRun.id);

    } catch (error) {
      console.error('Error saving payroll edits:', error);
      setSaveMessage('Error saving changes: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEntry = useCallback(async (entry) => {
    if (!entry || deletingEntryId) return;

    const employeeName = entry.employee?.full_name || 'this employee';
    const runLabel = selectedRun
      ? `${formatDateForBusiness(selectedRun.period_start)} to ${formatDateForBusiness(selectedRun.period_end)}`
      : 'this run';

    const confirmed = window.confirm(
      `Remove ${employeeName} from the payroll run for ${runLabel}?\n\n` +
      'Their payroll entry and any lieu time accruals for this period will be permanently deleted. ' +
      'This cannot be undone.'
    );
    if (!confirmed) return;

    setDeletingEntryId(entry.id);
    setSaveMessage('');

    try {
      await logSecurityEvent('payroll_entry_delete_attempt', {
        business_id: effectiveBusinessId,
        payroll_run_id: selectedRun?.id,
        entry_id: entry.id,
        user_id: entry.user_id
      }, 'high');

      // Delete the payroll entry first, then re-sync lieu from the ledger.
      const { error: entryError } = await supabase
        .from('hrpayroll_entries')
        .delete()
        .eq('id', entry.id);

      if (entryError) throw entryError;

      try {
        await supabase
          .from('hrpayroll_lieu_time_transactions')
          .delete()
          .eq('payroll_run_id', selectedRun?.id)
          .eq('user_id', entry.user_id);
      } catch (_) {
        // Table may not exist; not fatal
      }

      await syncUsersLieuBalanceFromLedger(supabase, effectiveBusinessId, [entry.user_id]);

      await logSecurityEvent('payroll_entry_deleted', {
        business_id: effectiveBusinessId,
        payroll_run_id: selectedRun?.id,
        entry_id: entry.id,
        user_id: entry.user_id,
        deleted_by: authUser?.id
      }, 'high');

      await recordAction({
        action: 'delete_payroll_entry',
        details: {
          payroll_run_id: selectedRun?.id,
          entry_id: entry.id,
          user_id: entry.user_id,
          employee_name: employeeName
        }
      });

      // Remove from local state
      setPayrollEntries(prev => prev.filter(e => e.id !== entry.id));
      setEmployeeHours(prev => { const n = { ...prev }; delete n[entry.user_id]; return n; });
      setEmployeePremiums(prev => { const n = { ...prev }; delete n[entry.user_id]; return n; });
      setEditedEmployees(prev => { const n = new Set(prev); n.delete(entry.user_id); return n; });

      setSaveMessage(`${employeeName} has been removed from this payroll run.`);
    } catch (error) {
      console.error('Error deleting payroll entry:', error);
      setSaveMessage(`Error removing employee: ${error.message || 'Unknown error'}`);
      await logSecurityEvent('payroll_entry_delete_error', {
        business_id: effectiveBusinessId,
        entry_id: entry.id,
        error: error.message
      }, 'high').catch(() => {});
    } finally {
      setDeletingEntryId(null);
    }
  }, [
    deletingEntryId,
    selectedRun,
    effectiveBusinessId,
    authUser?.id,
    formatDateForBusiness,
    logSecurityEvent,
    recordAction
  ]);

  const handleDeleteRun = useCallback(async () => {
    if (!selectedRun || deletingRun) {
      return;
    }

    try {
      const rateLimitCheck = await checkRateLimit('delete_payroll_run', 3, 300000);
      if (!rateLimitCheck.allowed) {
        setSaveMessage('Rate limit exceeded. Please wait a few minutes before attempting to delete another payroll run.');
        return;
      }
    } catch (rateLimitError) {
      console.warn('Rate limit check failed for delete_payroll_run:', rateLimitError);
    }

    const runLabel = `${formatDateForBusiness(selectedRun.period_start)} to ${formatDateForBusiness(selectedRun.period_end)}`;
    const entryCount = payrollEntries.length;

    const primaryConfirm = window.confirm(
      `This will permanently delete the finalized payroll run for ${runLabel} and ${entryCount} associated payroll entries.\n\n` +
      'This action cannot be undone. Do you want to continue?'
    );

    if (!primaryConfirm) {
      return;
    }

    setDeletingRun(true);
    setSaveMessage('');

    try {
      await deletePayrollRunWithRefunds({
        supabase,
        run: {
          id: selectedRun.id,
          business_id: effectiveBusinessId,
          pay_period_start: selectedRun.period_start || selectedRun.pay_period_start,
          pay_period_end: selectedRun.period_end || selectedRun.pay_period_end,
          status: selectedRun.status || 'finalized',
        },
        payrollEntries,
        authUser,
        logSecurityEvent,
        recordAction
      });

      setSaveMessage(`Payroll run for ${runLabel} deleted successfully.`);
      setSelectedRun(null);
      setPayrollEntries([]);
      setEmployeeHours({});
      setEmployeePremiums({});
      setEditedEmployees(new Set());

      await loadPayrollRuns();
    } catch (error) {
      console.error('Error deleting payroll run:', error);
      setSaveMessage(`Error deleting payroll run: ${error.message || 'Unknown error'}`);
    } finally {
      setDeletingRun(false);
    }
  }, [
    selectedRun,
    deletingRun,
    checkRateLimit,
    formatDateForBusiness,
    payrollEntries,
    effectiveBusinessId,
    authUser?.id,
    logSecurityEvent,
    recordAction,
    loadPayrollRuns
  ]);

  // Styles
  const styles = {
    container: {
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.background,
      minHeight: '100vh'
    },
    section: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '8px',
      padding: TavariStyles.spacing.lg,
      marginBottom: TavariStyles.spacing.lg,
      boxShadow: TavariStyles.shadows?.md || '0 4px 6px rgba(0, 0, 0, 0.1)'
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.textDark,
      marginBottom: TavariStyles.spacing.md,
      borderBottom: `2px solid ${TavariStyles.colors.warning}`,
      paddingBottom: TavariStyles.spacing.sm
    },
    select: {
      padding: TavariStyles.spacing.md,
      border: `2px solid ${TavariStyles.colors.warning}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      backgroundColor: TavariStyles.colors.white,
      cursor: 'pointer',
      width: '100%',
      maxWidth: '500px',
      marginBottom: TavariStyles.spacing.md
    },
    saveButton: {
      padding: '15px 30px',
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      border: 'none',
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      cursor: 'pointer',
      backgroundColor: TavariStyles.colors.warning,
      color: TavariStyles.colors.white,
      marginTop: TavariStyles.spacing.lg
    },
    disabledButton: {
      opacity: 0.6,
      cursor: 'not-allowed'
    },
    deleteContainer: {
      marginTop: TavariStyles.spacing.md,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      backgroundColor: '#FFF5F5',
      border: '1px solid #F56565'
    },
    deleteButton: {
      padding: '12px 24px',
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      border: 'none',
      fontSize: TavariStyles.typography.fontSize.md,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      cursor: 'pointer',
      backgroundColor: '#E53E3E',
      color: '#FFF'
    },
    deleteButtonDisabled: {
      opacity: 0.6,
      cursor: 'not-allowed'
    },
    deleteHelpText: {
      marginTop: TavariStyles.spacing.sm,
      fontSize: '13px',
      color: '#742A2A',
      lineHeight: 1.4
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: TavariStyles.typography.fontSize.sm,
      marginTop: TavariStyles.spacing.md
    },
    th: {
      padding: TavariStyles.spacing.md,
      textAlign: 'left',
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.white,
      fontSize: TavariStyles.typography.fontSize.sm,
      backgroundColor: TavariStyles.colors.warning
    },
    td: {
      padding: TavariStyles.spacing.md,
      borderBottomWidth: '1px',
      borderBottomStyle: 'solid',
      borderBottomColor: TavariStyles.colors.gray100,
      verticalAlign: 'middle'
    },
    editedRow: {
      backgroundColor: TavariStyles.colors.warning + '10'
    },
    input: {
      padding: '8px 12px',
      border: `1px solid ${TavariStyles.colors.warning}`,
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      fontSize: TavariStyles.typography.fontSize.sm,
      width: '80px',
      textAlign: 'center'
    },
    warningBanner: {
      backgroundColor: TavariStyles.colors.warning + '20',
      color: TavariStyles.colors.warning,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      marginBottom: TavariStyles.spacing.md,
      border: `1px solid ${TavariStyles.colors.warning}`
    },
    successBanner: {
      backgroundColor: TavariStyles.colors.success + '20',
      color: TavariStyles.colors.success,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      marginBottom: TavariStyles.spacing.md,
      whiteSpace: 'pre-line',
      border: `1px solid ${TavariStyles.colors.success}`
    },
    editBadge: {
      display: 'inline-block',
      padding: '2px 8px',
      backgroundColor: TavariStyles.colors.warning,
      color: TavariStyles.colors.white,
      borderRadius: '12px',
      fontSize: '10px',
      fontWeight: 'bold',
      marginLeft: '8px'
    },
    estimateBadge: {
      display: 'inline-block',
      padding: '2px 8px',
      backgroundColor: TavariStyles.colors.info,
      color: TavariStyles.colors.white,
      borderRadius: '12px',
      fontSize: '10px',
      fontWeight: 'bold',
      marginLeft: '8px'
    },
    emptyState: {
      textAlign: 'center',
      color: TavariStyles.colors.gray500,
      padding: TavariStyles.spacing.xl,
      fontSize: TavariStyles.typography.fontSize.md
    }
  };

  if (loading || !isPayrollReady) {
    return (
      <POSAuthWrapper
        componentName="EditPayrollTab"
        requiredRoles={['owner', 'manager', 'hr_admin']}
        requireBusiness={true}
      >
        <SecurityWrapper
          componentName="EditPayrollTab"
          securityLevel="critical"
          enableAuditLogging={true}
          sensitiveComponent={true}
        >
          <div style={styles.container}>
            <div style={styles.emptyState}>Loading payroll data for editing...</div>
          </div>
        </SecurityWrapper>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper
      componentName="EditPayrollTab"
      requiredRoles={['owner', 'manager', 'hr_admin']}
      requireBusiness={true}
    >
      <SecurityWrapper
        componentName="EditPayrollTab"
        securityLevel="critical"
        enableAuditLogging={true}
        sensitiveComponent={true}
      >
        <div style={styles.container}>
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Edit Existing Payroll</h3>
            
            <div style={styles.warningBanner}>
              <strong>⚠️ WARNING:</strong> You are about to edit finalized payroll data. 
              {editedEmployees.size > 0 && (
                <span> <strong>{editedEmployees.size} employee(s) have unsaved changes.</strong></span>
              )}
              {' '}All changes will be logged for audit purposes.
            </div>

            {payrollRuns.length > 0 ? (
              <select
                style={styles.select}
                value={selectedRun?.id || ''}
                onChange={(e) => handleRunSelection(e.target.value)}
              >
                <option value="">Select a payroll run to edit...</option>
                {payrollRuns.map(run => (
                  <option key={run.id} value={run.id}>
                    {formatDateForBusiness(run.period_start)} to {formatDateForBusiness(run.period_end)} 
                    {run.status === 'edited' && ' (Previously Edited)'}
                  </option>
                ))}
              </select>
            ) : (
              <div style={styles.emptyState}>
                <p>No finalized payroll runs available for editing.</p>
              </div>
            )}

            {selectedRun && (
              <div style={styles.deleteContainer}>
                <button
                  style={{
                    ...styles.deleteButton,
                    ...(deletingRun ? styles.deleteButtonDisabled : {})
                  }}
                  onClick={handleDeleteRun}
                  disabled={deletingRun}
                >
                  {deletingRun ? 'Deleting Payroll Run...' : 'Delete Payroll Run'}
                </button>
                <div style={styles.deleteHelpText}>
                  Permanently removes the selected payroll run and all associated entries. Use only if the run was created in error.
                </div>
              </div>
            )}

            {saveMessage && (
              <div style={saveMessage.includes('Error') ? styles.warningBanner : styles.successBanner}>
                {saveMessage}
              </div>
            )}
          </div>

          {selectedRun && payrollEntries.length > 0 && (
            <div style={styles.section}>
              <h4 style={styles.sectionTitle}>
                Edit Payroll Entries
                <span style={styles.estimateBadge}>ESTIMATES</span>
              </h4>
              
              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Employee</th>
                      <th style={styles.th}>Regular Hours</th>
                      <th style={styles.th}>Overtime Hours</th>
                      <th style={styles.th}>Lieu Hours</th>
                      {allPremiums.map(premium => (
                        <th key={premium.id} style={styles.th}>
                          <div style={{ fontSize: '11px' }}>
                            {premium.name}
                          </div>
                          <div style={{ fontSize: '10px', opacity: 0.8 }}>
                            {premium.type === 'percentage' 
                              ? `${premium.rate}%`
                              : `$${premium.rate}/hr`}
                          </div>
                        </th>
                      ))}
                      <th style={styles.th}>Vacation Pay</th>
                      <th style={styles.th}>Fed Tax</th>
                      <th style={styles.th}>Prov Tax</th>
                      <th style={styles.th}>EI</th>
                      <th style={styles.th}>CPP</th>
                      <th style={styles.th}>Net Pay</th>
                      <th style={{ ...styles.th, backgroundColor: '#C53030' }}>Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payrollEntries.map(entry => {
                      const hours = employeeHours[entry.user_id] || { 
                        regular_hours: 0, overtime_hours: 0, lieu_hours: 0
                      };
                      
                      const displayValues = getEmployeeDisplayValues(entry.user_id);
                      const employeeName = entry.employee?.full_name || 'Unknown Employee';
                      const isEdited = editedEmployees.has(entry.user_id);

                      if (!displayValues) return null;

                      return (
                        <tr key={entry.id} style={isEdited ? styles.editedRow : {}}>
                          <td style={styles.td}>
                            <div style={{ fontWeight: 'bold' }}>
                              {employeeName}
                              {isEdited && <span style={styles.editBadge}>EDITED</span>}
                            </div>
                            <div style={{ fontSize: '12px', color: '#333' }}>
                              ${entry.employee?.wage || '15.00'}/hr
                            </div>
                          </td>
                          <td style={styles.td}>
                            <input
                              type="number"
                              style={styles.input}
                              value={hours.regular_hours}
                              onChange={(e) => updateEmployeeHours(entry.user_id, 'regular_hours', e.target.value)}
                              min="0"
                              step="0.25"
                            />
                          </td>
                          <td style={styles.td}>
                            <input
                              type="number"
                              style={styles.input}
                              value={hours.overtime_hours}
                              onChange={(e) => updateEmployeeHours(entry.user_id, 'overtime_hours', e.target.value)}
                              min="0"
                              step="0.25"
                            />
                          </td>
                          <td style={styles.td}>
                            <input
                              type="number"
                              style={styles.input}
                              value={hours.lieu_hours}
                              onChange={(e) => updateEmployeeHours(entry.user_id, 'lieu_hours', e.target.value)}
                              min="0"
                              step="0.25"
                            />
                          </td>
                          {allPremiums.map(premium => {
                            const premiumHours = employeePremiums[entry.user_id]?.[premium.name] || 0;

                            return (
                              <td key={premium.id} style={styles.td}>
                                <input
                                  type="number"
                                  style={{ ...styles.input, width: '60px' }}
                                  value={premiumHours}
                                  onChange={(e) => updateEmployeePremium(entry.user_id, premium.name, e.target.value)}
                                  min="0"
                                  step="0.25"
                                  placeholder="0"
                                />
                              </td>
                            );
                          })}

                          <td style={styles.td}>
                            <div style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                              ${displayValues.vacation_pay.toFixed(2)}
                            </div>
                          </td>
                          <td style={styles.td}>
                            <div style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                              ${displayValues.federal_tax.toFixed(2)}
                            </div>
                          </td>
                          <td style={styles.td}>
                            <div style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                              ${displayValues.provincial_tax.toFixed(2)}
                            </div>
                          </td>
                          <td style={styles.td}>
                            <div style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                              ${displayValues.ei_deduction.toFixed(2)}
                            </div>
                          </td>
                          <td style={styles.td}>
                            <div style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                              ${displayValues.cpp_deduction.toFixed(2)}
                            </div>
                          </td>
                          <td style={styles.td}>
                            <div style={{ fontWeight: 'bold', color: TavariStyles.colors.success }}>
                              ${displayValues.net_pay.toFixed(2)}
                            </div>
                          </td>
                          <td style={styles.td}>
                            <button
                              onClick={() => handleDeleteEntry(entry)}
                              disabled={!!deletingEntryId || saving}
                              style={{
                                padding: '6px 12px',
                                backgroundColor: deletingEntryId === entry.id ? '#FC8181' : '#E53E3E',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                fontSize: '14px',
                                fontWeight: 'bold',
                                cursor: (deletingEntryId || saving) ? 'not-allowed' : 'pointer',
                                opacity: (deletingEntryId && deletingEntryId !== entry.id) ? 0.5 : 1,
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {deletingEntryId === entry.id ? 'Removing...' : 'Remove'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ textAlign: 'center' }}>
                <button 
                  style={{ 
                    ...styles.saveButton, 
                    ...(saving || editedEmployees.size === 0 ? styles.disabledButton : {}) 
                  }} 
                  onClick={saveEditedPayroll} 
                  disabled={saving || editedEmployees.size === 0}
                >
                  {saving ? 'Saving Changes...' : `Save Payroll Edits (${editedEmployees.size} edited)`}
                </button>
                <div style={{ marginTop: '8px', fontSize: '11px', color: '#333' }}>
                  Estimated values shown for edited employees. Accurate calculations will be saved to database.
                </div>
              </div>
            </div>
          )}

          {selectedRun && payrollEntries.length === 0 && (
            <div style={styles.section}>
              <div style={styles.emptyState}>
                <p>No payroll entries found for selected run.</p>
              </div>
            </div>
          )}
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default EditPayrollTab;