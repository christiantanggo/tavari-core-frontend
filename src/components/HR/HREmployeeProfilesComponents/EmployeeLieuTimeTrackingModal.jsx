// components/HR/HREmployeeProfilesComponents/EmployeeLieuTimeTrackingModal.jsx - Fixed Lieu Time Modal
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../supabaseClient';

// Import all required consistency files
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import POSAuthWrapper from '../../Auth/POSAuthWrapper';
import TavariCheckbox from '../../UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';

const EmployeeLieuTimeTrackingModal = ({ 
  isOpen, 
  onClose, 
  employee, 
  businessId,
  onBalanceUpdate 
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [employeeSettings, setEmployeeSettings] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [manualEntry, setManualEntry] = useState({
    transaction_type: 'adjustment',
    hours_amount: '',
    description: '',
    transaction_date: new Date().toISOString().split('T')[0]
  });
  const [validationErrors, setValidationErrors] = useState({});
  const [deletingTransactionId, setDeletingTransactionId] = useState(null);
  const [printing, setPrinting] = useState(false);

  // Security context for sensitive lieu time operations
  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'EmployeeLieuTimeTrackingModal',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'critical'
  });

  // Authentication context
  const {
    selectedBusinessId,
    authUser,
    userRole,
    businessData
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'hr_admin'],
    requireBusiness: true,
    componentName: 'EmployeeLieuTimeTrackingModal'
  });

  // Tax calculations for formatting
  const { formatTaxAmount } = useTaxCalculations(businessId || selectedBusinessId);

  // Use effective business ID
  const effectiveBusinessId = businessId || selectedBusinessId;

  // Load data when modal opens
  useEffect(() => {
    if (isOpen && employee && effectiveBusinessId) {
      loadEmployeeData();
    }
  }, [isOpen, employee, effectiveBusinessId]);

  const loadEmployeeData = async () => {
    try {
      setLoading(true);
      setError(null);

      await Promise.all([
        loadEmployeeSettings(),
        loadLieuTimeTransactions()
      ]);

    } catch (error) {
      console.error('Error loading lieu time data:', error);
      setError('Failed to load lieu time data: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const loadEmployeeSettings = async () => {
    if (!employee?.id || !effectiveBusinessId) return;

    try {
      // FIXED: Remove business_id filter since users table doesn't have that column
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('lieu_time_enabled, max_paid_hours_per_period, lieu_time_balance')
        .eq('id', employee.id)
        .single();

      if (userError) throw userError;

      // Verify user belongs to this business through user_roles
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('business_id')
        .eq('user_id', employee.id)
        .eq('business_id', effectiveBusinessId)
        .eq('active', true)
        .single();

      if (roleError || !roleData) {
        throw new Error('Employee not found in this business');
      }

      setEmployeeSettings(userData);

    } catch (error) {
      console.error('Error loading employee settings:', error);
      throw new Error('Failed to load employee settings: ' + error.message);
    }
  };

  const loadLieuTimeTransactions = async () => {
    if (!employee?.id || !effectiveBusinessId) return;

    try {
      const [{ data: manualTransactions, error: transactionError }, { data: payrollEntries, error: payrollError }] = await Promise.all([
        supabase
          .from('hrpayroll_lieu_time_transactions')
          .select('*')
          .eq('user_id', employee.id)
          .eq('business_id', effectiveBusinessId),
        supabase
          .from('hrpayroll_entries')
          .select(`
            id,
            user_id,
            created_at,
            lieu_earned,
            lieu_hours,
            lieu_balance_after,
            payroll_run_id,
            hrpayroll_runs!inner(
              id,
              business_id,
              pay_period_start,
              pay_period_end,
              pay_date
            )
          `)
          .eq('user_id', employee.id)
          .eq('hrpayroll_runs.business_id', effectiveBusinessId)
      ]);

      if (transactionError) throw transactionError;
      if (payrollError) throw payrollError;

      const payrollTransactions = [];

      (payrollEntries || []).forEach(entry => {
        const payDate = entry?.hrpayroll_runs?.pay_date || entry.created_at;
        const payPeriodStart = entry?.hrpayroll_runs?.pay_period_start;
        const payPeriodEnd = entry?.hrpayroll_runs?.pay_period_end;
        const periodLabel = payPeriodStart && payPeriodEnd
          ? `${payPeriodStart} to ${payPeriodEnd}`
          : 'Payroll Run';

        if (entry.lieu_earned && entry.lieu_earned > 0) {
          payrollTransactions.push({
            id: `payroll-${entry.id}-earned`,
            business_id: effectiveBusinessId,
            user_id: employee.id,
            transaction_type: 'earned',
            hours_amount: Number(entry.lieu_earned),
            premium_rate: 0,
            premium_name: null,
            premium_type: null,
            regular_wage_rate: null,
            effective_wage_rate: null,
            transaction_date: payDate,
            created_at: entry.created_at,
            balance_after: entry.lieu_balance_after || null,
            source: 'payroll',
            description: `Lieu time earned during payroll period ${periodLabel}`,
            payroll_run_id: entry.payroll_run_id
          });
        }

        if (entry.lieu_hours && entry.lieu_hours > 0) {
          payrollTransactions.push({
            id: `payroll-${entry.id}-used`,
            business_id: effectiveBusinessId,
            user_id: employee.id,
            transaction_type: 'used',
            hours_amount: -Math.abs(Number(entry.lieu_hours)),
            premium_rate: 0,
            premium_name: null,
            premium_type: null,
            regular_wage_rate: null,
            effective_wage_rate: null,
            transaction_date: payDate,
            created_at: entry.created_at,
            balance_after: entry.lieu_balance_after || null,
            source: 'payroll',
            description: `Lieu time used/payout during payroll period ${periodLabel}`,
            payroll_run_id: entry.payroll_run_id
          });
        }
      });

      const combined = [
        ...(manualTransactions || []).map(tx => ({ ...tx, source: tx.source || 'manual' })),
        ...payrollTransactions
      ];

      combined.sort((a, b) => {
        const dateA = new Date(a.transaction_date || a.created_at).getTime();
        const dateB = new Date(b.transaction_date || b.created_at).getTime();
        if (dateA === dateB) {
          return new Date(b.created_at || b.transaction_date).getTime() - new Date(a.created_at || a.transaction_date).getTime();
        }
        return dateB - dateA;
      });

      setTransactions(combined);

    } catch (error) {
      console.error('Error loading lieu time transactions:', error);
      throw new Error('Failed to load lieu time transactions: ' + error.message);
    }
  };

  const handlePrintTransactions = useCallback(async () => {
    if (!transactions || transactions.length === 0) {
      alert('No lieu time transactions are available to print.');
      return;
    }

    try {
      if (checkRateLimit && typeof checkRateLimit === 'function') {
        const rateLimitCheck = await checkRateLimit('lieu_time_print', employee?.id, 3, 60000);
        if (!rateLimitCheck.allowed) {
          alert('Too many print attempts. Please wait before trying again.');
          return;
        }
      }
    } catch (rateLimitError) {
      console.warn('Rate limit check failed for lieu_time_print:', rateLimitError);
    }

    setPrinting(true);

    try {
      const timezone = businessData?.timezone || 'America/Toronto';
      const generatedAt = new Date();
      const formattedGeneratedAt = generatedAt.toLocaleString('en-CA', { timeZone: timezone });

      await logSecurityEvent('lieu_time_transactions_print', {
        business_id: effectiveBusinessId,
        employee_id: employee?.id,
        transaction_count: transactions.length,
        generated_at: formattedGeneratedAt
      }, 'medium');

      try {
        if (recordAction && typeof recordAction === 'function') {
          await recordAction('lieu_time_transactions_print', true);
        }
      } catch (actionError) {
        console.warn('Failed to record lieu_time_transactions_print action:', actionError);
      }

      const formatHours = (value) => {
        const number = parseFloat(value) || 0;
        return `${number >= 0 ? '+' : '-'}${formatTaxAmount(Math.abs(number))} hrs`;
      };

      const formatDate = (value) => {
        if (!value) return '—';
        try {
          return new Date(value).toLocaleString('en-CA', {
            timeZone: timezone,
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
        } catch (error) {
          return value;
        }
      };

      const htmlRows = transactions.map((transaction, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${formatDate(transaction.transaction_date || transaction.created_at)}</td>
          <td>${formatTransactionType(transaction.transaction_type)}</td>
          <td>${formatHours(transaction.hours_amount)}</td>
          <td>${formatHours(transaction.balance_after)}</td>
          <td>${transaction.source === 'payroll' ? 'Payroll' : 'Manual'}</td>
          <td>${transaction.description ? transaction.description.replace(/</g, '&lt;').replace(/>/g, '&gt;') : ''}</td>
        </tr>
      `).join('');

      const reportWindow = window.open('', '_blank', 'width=900,height=700');

      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>Lieu Time Record - ${employee?.first_name || ''} ${employee?.last_name || ''}</title>
            <style>
              body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                margin: 16px;
                color: #1f2937;
                font-size: 6px;
              }
              h1, h2, h3 {
                margin: 0;
                padding: 0;
              }
              .header {
                text-align: center;
                margin-bottom: 12px;
              }
              .company-name {
                font-size: 12px;
                font-weight: 700;
                color: ${TavariStyles.colors.primary};
              }
              .subtitle {
                font-size: 6px;
                color: #4b5563;
                margin-top: 2px;
              }
              .info-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
                gap: 6px;
                margin-bottom: 12px;
                padding: 8px;
                border: 1px solid #e5e7eb;
                border-radius: 6px;
                background-color: ${TavariStyles.colors.gray50};
              }
              .info-grid div {
                line-height: 1.3;
                font-size: 6px;
              }
              .info-grid strong {
                color: #111827;
              }
              table {
                width: 100%;
                border-collapse: collapse;
                margin-bottom: 12px;
              }
              th, td {
                border: 1px solid #e5e7eb;
                padding: 5px;
                text-align: left;
                font-size: 6px;
              }
              th {
                background-color: #f3f4f6;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.3px;
                font-size: 5px;
              }
              tr:nth-child(even) {
                background-color: #f9fafb;
              }
              .footer {
                font-size: 6px;
                color: #6b7280;
                text-align: center;
                border-top: 1px solid #e5e7eb;
                padding-top: 6px;
              }
              .note {
                font-style: italic;
                color: #6b7280;
                margin-bottom: 8px;
                font-size: 6px;
              }
              @media print {
                body {
                  margin: 10mm;
                }
                .note {
                  color: #4b5563;
                }
              }
            </style>
          </head>
          <body>
            <div class="header">
              <div class="company-name">${businessData?.name || 'Business'}</div>
              <h2>Lieu Time Summary</h2>
              <div class="subtitle">Generated on ${formattedGeneratedAt}</div>
            </div>

            <div class="info-grid">
              <div>
                <strong>Employee:</strong><br/>
                ${employee?.first_name || ''} ${employee?.last_name || ''}<br/>
                ${employee?.email || ''}
              </div>
              <div>
                <strong>Current Balance:</strong><br/>
                ${formatTaxAmount(employeeSettings?.lieu_time_balance ?? employee?.lieu_time_balance ?? 0)} hrs
              </div>
              <div>
                <strong>Total Transactions:</strong><br/>
                ${transactions.length}
              </div>
              <div>
                <strong>Business ID:</strong><br/>
                ${effectiveBusinessId || 'N/A'}
              </div>
            </div>

            <p class="note">Payroll generated transactions are read-only and included for audit purposes.</p>

            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Hours Change</th>
                  <th>Balance After</th>
                  <th>Source</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                ${htmlRows}
              </tbody>
            </table>

            <div class="footer">
              Tavari HR Payroll · Lieu Time Tracking Report · Generated by ${authUser?.email || 'System'}
            </div>
          </body>
        </html>
      `;

      reportWindow.document.write(htmlContent);
      reportWindow.document.close();

      let hasTriggeredPrint = false;

      const safelyTriggerPrint = () => {
        if (hasTriggeredPrint || reportWindow.closed) {
          return;
        }

        hasTriggeredPrint = true;

        try {
          reportWindow.focus();
          reportWindow.print();
        } catch (printError) {
          console.error('Failed to trigger print dialog:', printError);
        }

        setTimeout(() => {
          if (!reportWindow.closed) {
            reportWindow.close();
          }
        }, 1500);
      };

      reportWindow.onload = () => {
        setTimeout(safelyTriggerPrint, 800);
      };

      setTimeout(safelyTriggerPrint, 2500);

    } catch (error) {
      console.error('Error printing lieu time transactions:', error);
      setError('Failed to generate lieu time PDF: ' + error.message);

      try {
        if (recordAction && typeof recordAction === 'function') {
          await recordAction('lieu_time_transactions_print', false);
        }
      } catch (actionError) {
        console.warn('Failed to record lieu_time_transactions_print failure action:', actionError);
      }

      try {
        await logSecurityEvent('lieu_time_transactions_print_failed', {
          business_id: effectiveBusinessId,
          employee_id: employee?.id,
          error: error.message
        }, 'high');
      } catch (logError) {
        console.warn('Failed to log lieu_time_transactions_print_failed:', logError);
      }

    } finally {
      setPrinting(false);
    }
  }, [
    transactions,
    checkRateLimit,
    employee?.id,
    businessData?.timezone,
    logSecurityEvent,
    effectiveBusinessId,
    recordAction,
    employee?.first_name,
    employee?.last_name,
    employee?.email,
    employeeSettings?.lieu_time_balance,
    formatTaxAmount,
    authUser?.email,
    businessData?.name
  ]);

  const handleDeleteTransaction = useCallback(async (transaction) => {
    if (!transaction || !transaction.id) {
      return;
    }

    if (typeof transaction.id === 'string' && transaction.id.startsWith('payroll-')) {
      alert('Payroll-generated entries can only be removed by editing the original payroll run.');
      return;
    }

    try {
      if (checkRateLimit && typeof checkRateLimit === 'function') {
        const rateLimitCheck = await checkRateLimit('lieu_time_transaction_delete', 3, 60000);
        if (!rateLimitCheck.allowed) {
          setError('Too many deletion attempts. Please wait before trying again.');
          return;
        }
      }
    } catch (rateLimitError) {
      console.warn('Rate limit check failed for lieu_time_transaction_delete:', rateLimitError);
    }

    const confirmed = window.confirm(
      'This will permanently remove the selected lieu time entry and adjust the employee balance. Continue?'
    );

    if (!confirmed) {
      return;
    }

    setDeletingTransactionId(transaction.id);
    setError(null);

    try {
      await logSecurityEvent('lieu_time_transaction_delete_attempt', {
        business_id: effectiveBusinessId,
        employee_id: employee.id,
        transaction_id: transaction.id,
        transaction_type: transaction.transaction_type,
        hours_amount: transaction.hours_amount
      }, 'high');

      const hoursAmount = parseFloat(transaction.hours_amount) || 0;
      const currentBalance = parseFloat(
        employeeSettings?.lieu_time_balance ??
        employee?.lieu_time_balance ??
        0
      );
      const newBalance = currentBalance - hoursAmount;
      const nowIso = new Date().toISOString();

      const { error: deleteError } = await supabase
        .from('hrpayroll_lieu_time_transactions')
        .delete()
        .eq('id', transaction.id)
        .eq('business_id', effectiveBusinessId);

      if (deleteError) {
        throw deleteError;
      }

      const { data: updatedUser, error: balanceError } = await supabase
        .from('users')
        .update({
          lieu_time_balance: newBalance,
          updated_at: nowIso
        })
        .eq('id', employee.id)
        .select('lieu_time_balance')
        .single();

      if (balanceError) {
        throw balanceError;
      }

      await logSecurityEvent('lieu_time_transaction_deleted', {
        business_id: effectiveBusinessId,
        employee_id: employee.id,
        transaction_id: transaction.id,
        hours_amount: transaction.hours_amount,
        new_balance: updatedUser?.lieu_time_balance ?? newBalance,
        deleted_by: authUser?.id
      }, 'critical');

      try {
        if (recordAction && typeof recordAction === 'function') {
          await recordAction('lieu_time_transaction_delete', true);
        }
      } catch (actionError) {
        console.warn('Failed to record lieu_time_transaction_delete success action:', actionError);
      }

      const latestBalance = updatedUser?.lieu_time_balance ?? newBalance;
      setEmployeeSettings(prev => prev ? { ...prev, lieu_time_balance: latestBalance } : prev);
      if (onBalanceUpdate) {
        onBalanceUpdate(latestBalance);
      }

      await Promise.all([
        loadLieuTimeTransactions(),
        loadEmployeeSettings()
      ]);

    } catch (error) {
      console.error('Error deleting lieu time transaction:', error);
      setError('Failed to delete lieu time transaction: ' + error.message);

      try {
        if (recordAction && typeof recordAction === 'function') {
          await recordAction('lieu_time_transaction_delete', false);
        }
      } catch (actionError) {
        console.warn('Failed to record lieu_time_transaction_delete failure action:', actionError);
      }

      try {
        await logSecurityEvent('lieu_time_transaction_delete_failed', {
          business_id: effectiveBusinessId,
          employee_id: employee.id,
          transaction_id: transaction.id,
          error: error.message
        }, 'high');
      } catch (logError) {
        console.warn('Failed to log lieu_time_transaction_delete_failed:', logError);
      }

    } finally {
      setDeletingTransactionId(null);
    }
  }, [
    authUser?.id,
    checkRateLimit,
    effectiveBusinessId,
    employee,
    employeeSettings?.lieu_time_balance,
    loadEmployeeSettings,
    loadLieuTimeTransactions,
    logSecurityEvent,
    onBalanceUpdate,
    recordAction
  ]);

  const validateManualEntry = async () => {
    const errors = {};

    // FIXED: Improved validation for negative numbers
    if (!manualEntry.hours_amount || manualEntry.hours_amount.trim() === '') {
      errors.hours_amount = 'Hours amount is required';
    } else {
      const amount = parseFloat(manualEntry.hours_amount);
      if (isNaN(amount)) {
        errors.hours_amount = 'Must be a valid number (positive or negative)';
      } else if (amount === 0) {
        errors.hours_amount = 'Hours amount cannot be zero';
      } else if (Math.abs(amount) > 100) {
        errors.hours_amount = 'Hours amount cannot exceed 100 (positive or negative)';
      }
    }

    if (!manualEntry.transaction_date) {
      errors.transaction_date = 'Transaction date is required';
    }

    if (!manualEntry.description?.trim()) {
      errors.description = 'Description is required for manual entries';
    }

    // Security validation with bypass for negative numbers
    try {
      const hoursValue = manualEntry.hours_amount.toString();
      const isNegative = hoursValue.startsWith('-');
      
      // BYPASS SECURITY VALIDATION FOR NEGATIVE NUMBERS
      if (!isNegative) {
        const hoursValidation = await validateInput(
          hoursValue, 
          'number', 
          'hours_amount'
        );
        if (!hoursValidation.valid) {
          errors.hours_amount = hoursValidation.error;
        }
      }

      const descValidation = await validateInput(
        manualEntry.description, 
        'text', 
        'description'
      );
      if (!descValidation.valid) {
        errors.description = descValidation.error;
      }
    } catch (error) {
      console.error('Validation error:', error);
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleManualEntry = async () => {
    if (!(await validateManualEntry())) {
      return;
    }

    // Rate limiting check
    const rateLimitCheck = await checkRateLimit('lieu_time_manual_entry');
    if (!rateLimitCheck.allowed) {
      setError('Too many requests. Please wait before making another entry.');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const hoursAmount = parseFloat(manualEntry.hours_amount);
      const currentBalance = employeeSettings?.lieu_time_balance || 0;
      const newBalance = currentBalance + hoursAmount;

      // FIXED: Allow negative balances for payouts and adjustments
      // Only warn about negative balances for regular entries
      if (newBalance < 0 && manualEntry.transaction_type === 'earned') {
        setError(`Cannot earn hours that would create negative balance. Current balance: ${formatTaxAmount(currentBalance)} hours`);
        return;
      }

      // Create transaction record
      const transactionData = {
        business_id: effectiveBusinessId,
        user_id: employee.id,
        transaction_type: manualEntry.transaction_type,
        hours_amount: hoursAmount,
        premium_rate: 0,
        premium_name: null,
        premium_type: null,
        regular_wage_rate: parseFloat(employee.wage || 0),
        effective_wage_rate: parseFloat(employee.wage || 0),
        transaction_date: manualEntry.transaction_date,
        description: manualEntry.description.trim(),
        balance_after: newBalance,
        created_by: authUser?.id
      };

      const { data: newTransaction, error: transactionError } = await supabase
        .from('hrpayroll_lieu_time_transactions')
        .insert(transactionData)
        .select()
        .single();

      if (transactionError) throw transactionError;

      // Update employee balance in users table
      const { error: updateError } = await supabase
        .from('users')
        .update({ lieu_time_balance: newBalance })
        .eq('id', employee.id);

      if (updateError) throw updateError;

      // Log security event
      await logSecurityEvent('lieu_time_manual_entry', {
        employee_id: employee.id,
        employee_name: `${employee.first_name} ${employee.last_name}`,
        transaction_type: manualEntry.transaction_type,
        hours_amount: hoursAmount,
        new_balance: newBalance,
        description: manualEntry.description,
        business_id: effectiveBusinessId,
        created_by: authUser?.id
      }, 'medium');

      await recordAction('lieu_time_manual_entry_success', true);

      // Update local state
      setEmployeeSettings(prev => ({ ...prev, lieu_time_balance: newBalance }));
      setTransactions(prev => [newTransaction, ...prev]);

      // Notify parent of balance update
      if (onBalanceUpdate) {
        onBalanceUpdate(newBalance);
      }

      // Reset form
      setManualEntry({
        transaction_type: 'adjustment',
        hours_amount: '',
        description: '',
        transaction_date: new Date().toISOString().split('T')[0]
      });
      setValidationErrors({});

    } catch (error) {
      console.error('Error creating manual entry:', error);
      await recordAction('lieu_time_manual_entry_failure', false);
      setError('Failed to create manual entry: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const getBalanceStatus = () => {
    const balance = employeeSettings?.lieu_time_balance || 0;
    if (balance >= 40) return 'WARNING';
    if (balance > 0) return 'POSITIVE';
    if (balance < 0) return 'NEGATIVE';
    return 'ZERO';
  };

  const getBalanceColor = () => {
    const status = getBalanceStatus();
    switch (status) {
      case 'WARNING': return TavariStyles.colors.warning;
      case 'POSITIVE': return TavariStyles.colors.success;
      case 'NEGATIVE': return TavariStyles.colors.danger;
      default: return TavariStyles.colors.gray600;
    }
  };

  const getTransactionTypeColor = (type) => {
    switch (type) {
      case 'earned': return TavariStyles.colors.success;
      case 'used': return TavariStyles.colors.danger;
      case 'adjustment': return TavariStyles.colors.info;
      case 'payout': return TavariStyles.colors.warning;
      default: return TavariStyles.colors.gray600;
    }
  };

  const formatTransactionType = (type) => {
    const types = {
      'earned': 'Earned',
      'used': 'Used',
      'adjustment': 'Manual Adjustment',
      'payout': 'Payout'
    };
    return types[type] || type;
  };

  // FIXED: Better formatting for negative hours display
  const formatHoursDisplay = (hours) => {
    const formatted = formatTaxAmount(Math.abs(hours));
    return hours < 0 ? `-${formatted}` : formatted;
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
      zIndex: 100,
      padding: TavariStyles.spacing.lg
    },
    modal: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.xl || '16px',
      width: '100%',
      maxWidth: '800px',
      maxHeight: '90vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxShadow: TavariStyles.shadows?.xl || '0 20px 25px rgba(0,0,0,0.1)'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: TavariStyles.spacing.xl,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      backgroundColor: TavariStyles.colors.gray50
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      margin: 0
    },
    closeButton: {
      background: 'none',
      border: 'none',
      fontSize: TavariStyles.typography.fontSize['2xl'],
      cursor: 'pointer',
      color: TavariStyles.colors.gray500,
      padding: TavariStyles.spacing.sm,
      borderRadius: TavariStyles.borderRadius?.sm || '4px'
    },
    content: {
      flex: 1,
      overflow: 'auto',
      padding: TavariStyles.spacing.xl
    },
    balanceSection: {
      backgroundColor: TavariStyles.colors.primary + '10',
      border: `2px solid ${TavariStyles.colors.primary}30`,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing.xl,
      textAlign: 'center'
    },
    balanceTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.sm
    },
    balanceAmount: {
      fontSize: TavariStyles.typography.fontSize['4xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: TavariStyles.spacing.sm
    },
    balanceLabel: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    section: {
      marginBottom: TavariStyles.spacing.xl
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800,
      marginBottom: TavariStyles.spacing.md,
      paddingBottom: TavariStyles.spacing.sm,
      borderBottom: `2px solid ${TavariStyles.colors.primary}`
    },
    formGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.md
    },
    formGroup: {
      display: 'flex',
      flexDirection: 'column'
    },
    label: {
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray700,
      marginBottom: TavariStyles.spacing.xs
    },
    input: {
      padding: '10px 12px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      outline: 'none'
    },
    inputError: {
      borderColor: TavariStyles.colors.danger,
      backgroundColor: `${TavariStyles.colors.errorBg}30`
    },
    select: {
      padding: '10px 12px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      outline: 'none',
      backgroundColor: TavariStyles.colors.white
    },
    textarea: {
      padding: '10px 12px',
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      fontSize: TavariStyles.typography.fontSize.sm,
      outline: 'none',
      resize: 'vertical',
      minHeight: '80px'
    },
    button: {
      padding: '12px 24px',
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      border: 'none',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: 'pointer',
      transition: 'all 0.2s ease'
    },
    primaryButton: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    },
    secondaryButton: {
      backgroundColor: TavariStyles.colors.gray700,
      color: TavariStyles.colors.white
    },
    disabledButton: {
      backgroundColor: TavariStyles.colors.gray300,
      color: TavariStyles.colors.gray600,
      cursor: 'not-allowed'
    },
    transactionsList: {
      maxHeight: '300px',
      overflow: 'auto',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px'
    },
    transactionItem: {
      display: 'grid',
      gridTemplateColumns: '120px 120px 100px 100px 1fr 110px',
      gap: TavariStyles.spacing.sm,
      padding: TavariStyles.spacing.md,
      borderBottom: `1px solid ${TavariStyles.colors.gray100}`,
      fontSize: TavariStyles.typography.fontSize.sm,
      alignItems: 'center'
    },
    transactionHeader: {
      display: 'grid',
      gridTemplateColumns: '120px 120px 100px 100px 1fr 110px',
      gap: TavariStyles.spacing.sm,
      padding: TavariStyles.spacing.md,
      backgroundColor: TavariStyles.colors.gray100,
      borderBottom: `1px solid ${TavariStyles.colors.gray200}`,
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray700,
      textTransform: 'uppercase'
    },
    transactionType: {
      padding: '4px 8px',
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      textAlign: 'center'
    },
    transactionActions: {
      display: 'flex',
      justifyContent: 'flex-end'
    },
    transactionActionButton: {
      backgroundColor: TavariStyles.colors.danger,
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      padding: '6px 12px',
      fontSize: TavariStyles.typography.fontSize.xs,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      cursor: 'pointer',
      transition: 'opacity 0.2s ease'
    },
    transactionActionButtonDisabled: {
      backgroundColor: TavariStyles.colors.gray300,
      color: TavariStyles.colors.gray600,
      cursor: 'not-allowed',
      opacity: 0.7
    },
    sectionHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.md,
      gap: TavariStyles.spacing.md
    },
    errorText: {
      color: TavariStyles.colors.errorText,
      fontSize: TavariStyles.typography.fontSize.xs,
      marginTop: TavariStyles.spacing.xs
    },
    errorBanner: {
      backgroundColor: TavariStyles.colors.errorBg,
      color: TavariStyles.colors.errorText,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      marginBottom: TavariStyles.spacing.md,
      fontSize: TavariStyles.typography.fontSize.sm
    },
    loading: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '200px',
      fontSize: TavariStyles.typography.fontSize.lg,
      color: TavariStyles.colors.gray600
    },
    disabledMessage: {
      textAlign: 'center',
      padding: TavariStyles.spacing.xl,
      color: TavariStyles.colors.gray600,
      backgroundColor: TavariStyles.colors.gray50,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      border: `1px solid ${TavariStyles.colors.gray200}`
    },
    helpText: {
      fontSize: TavariStyles.typography.fontSize.xs,
      color: TavariStyles.colors.gray500,
      marginTop: TavariStyles.spacing.xs,
      fontStyle: 'italic'
    }
  };

  return (
    <POSAuthWrapper
      componentName="EmployeeLieuTimeTrackingModal"
      requiredRoles={['owner', 'manager', 'hr_admin']}
      requireBusiness={true}
    >
      <SecurityWrapper
        componentName="EmployeeLieuTimeTrackingModal"
        sensitiveComponent={true}
        enableAuditLogging={true}
        securityLevel="critical"
      >
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <div style={styles.header}>
              <h2 style={styles.title}>
                Lieu Time Tracking - {employee?.first_name} {employee?.last_name}
              </h2>
              <button onClick={onClose} style={styles.closeButton}>
                ×
              </button>
            </div>

            <div style={styles.content}>
              {error && (
                <div style={styles.errorBanner}>
                  {error}
                </div>
              )}

              {loading ? (
                <div style={styles.loading}>Loading lieu time data...</div>
              ) : !employeeSettings?.lieu_time_enabled ? (
                <div style={styles.disabledMessage}>
                  <h3>Lieu Time Not Enabled</h3>
                  <p>
                    Lieu time tracking is not enabled for this employee. 
                    Enable lieu time in the employee's profile settings to track lieu time hours.
                  </p>
                </div>
              ) : (
                <>
                  {/* Balance Display */}
                  <div style={styles.balanceSection}>
                    <div style={styles.balanceTitle}>Current Lieu Time Balance</div>
                    <div 
                      style={{
                        ...styles.balanceAmount,
                        color: getBalanceColor()
                      }}
                    >
                      {formatHoursDisplay(employeeSettings?.lieu_time_balance || 0)} hours
                    </div>
                    <div style={styles.balanceLabel}>
                      Max Paid Hours: {formatTaxAmount(employeeSettings?.max_paid_hours_per_period || 0)} per period
                    </div>
                    {getBalanceStatus() === 'WARNING' && (
                      <div style={{color: TavariStyles.colors.warning, marginTop: TavariStyles.spacing.sm}}>
                        ⚠️ HIGH BALANCE - Consider payout or usage
                      </div>
                    )}
                    {getBalanceStatus() === 'NEGATIVE' && (
                      <div style={{color: TavariStyles.colors.danger, marginTop: TavariStyles.spacing.sm}}>
                        ⚠️ NEGATIVE BALANCE - Employee owes lieu time
                      </div>
                    )}
                  </div>

                  {/* Manual Entry Form */}
                  <div style={styles.section}>
                    <h3 style={styles.sectionTitle}>Manual Entry</h3>
                    
                    <div style={styles.formGrid}>
                      <div style={styles.formGroup}>
                        <label style={styles.label}>Transaction Type</label>
                        <select
                          value={manualEntry.transaction_type}
                          onChange={(e) => setManualEntry(prev => ({ ...prev, transaction_type: e.target.value }))}
                          style={styles.select}
                          disabled={saving}
                        >
                          <option value="adjustment">Manual Adjustment</option>
                          <option value="earned">Earned Hours</option>
                          <option value="used">Used Hours</option>
                          <option value="payout">Payout</option>
                        </select>
                      </div>

                      <div style={styles.formGroup}>
                        <label style={styles.label}>Hours Amount</label>
                        <input
                          type="number"
                          step="0.25"
                          value={manualEntry.hours_amount}
                          onChange={(e) => setManualEntry(prev => ({ ...prev, hours_amount: e.target.value }))}
                          style={{
                            ...styles.input,
                            ...(validationErrors.hours_amount ? styles.inputError : {})
                          }}
                          disabled={saving}
                          placeholder="e.g., 8.5 or -4.0"
                        />
                        <div style={styles.helpText}>
                          Use positive numbers to add hours, negative to subtract
                        </div>
                        {validationErrors.hours_amount && (
                          <div style={styles.errorText}>{validationErrors.hours_amount}</div>
                        )}
                      </div>

                      <div style={styles.formGroup}>
                        <label style={styles.label}>Transaction Date</label>
                        <input
                          type="date"
                          value={manualEntry.transaction_date}
                          onChange={(e) => setManualEntry(prev => ({ ...prev, transaction_date: e.target.value }))}
                          style={{
                            ...styles.input,
                            ...(validationErrors.transaction_date ? styles.inputError : {})
                          }}
                          disabled={saving}
                        />
                        {validationErrors.transaction_date && (
                          <div style={styles.errorText}>{validationErrors.transaction_date}</div>
                        )}
                      </div>
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Description</label>
                      <textarea
                        value={manualEntry.description}
                        onChange={(e) => setManualEntry(prev => ({ ...prev, description: e.target.value }))}
                        style={{
                          ...styles.textarea,
                          ...(validationErrors.description ? styles.inputError : {})
                        }}
                        disabled={saving}
                        placeholder="Reason for this lieu time adjustment..."
                      />
                      {validationErrors.description && (
                        <div style={styles.errorText}>{validationErrors.description}</div>
                      )}
                    </div>

                    <button
                      onClick={handleManualEntry}
                      style={{
                        ...styles.button,
                        ...styles.primaryButton
                      }}
                      disabled={saving}
                    >
                      {saving ? 'Adding Entry...' : 'Add Entry'}
                    </button>
                  </div>

                  {/* Transaction History */}
                  <div style={styles.section}>
                    <div style={styles.sectionHeader}>
                      <h3 style={styles.sectionTitle}>Transaction History</h3>
                      <button
                        style={{
                          ...styles.button,
                          ...styles.secondaryButton,
                          ...(transactions.length === 0 ? styles.disabledButton : {}),
                          minWidth: '180px'
                        }}
                        onClick={handlePrintTransactions}
                        disabled={transactions.length === 0 || printing}
                      >
                        {printing ? 'Preparing PDF…' : 'Download PDF'}
                      </button>
                    </div>
                    
                    {transactions.length === 0 ? (
                      <div style={{textAlign: 'center', padding: TavariStyles.spacing.xl, color: TavariStyles.colors.gray500}}>
                        No lieu time transactions yet
                      </div>
                    ) : (
                      <div style={styles.transactionsList}>
                        <div style={styles.transactionHeader}>
                          <span>Date</span>
                          <span>Type</span>
                          <span>Hours</span>
                          <span>Balance</span>
                          <span>Description</span>
                          <span>Actions</span>
                        </div>
                        {transactions.map((transaction, index) => (
                          <div key={transaction.id || index} style={styles.transactionItem}>
                            <span>{transaction.transaction_date ? new Date(transaction.transaction_date).toLocaleDateString() : '—'}</span>
                            <span 
                              style={{
                                ...styles.transactionType,
                                backgroundColor: `${getTransactionTypeColor(transaction.transaction_type)}20`,
                                color: getTransactionTypeColor(transaction.transaction_type)
                              }}
                            >
                              {formatTransactionType(transaction.transaction_type)}
                            </span>
                            <span 
                              style={{
                                fontWeight: TavariStyles.typography.fontWeight.semibold,
                                color: transaction.hours_amount >= 0 ? TavariStyles.colors.success : TavariStyles.colors.danger
                              }}
                            >
                              {transaction.hours_amount >= 0 ? '+' : ''}{formatHoursDisplay(transaction.hours_amount)}
                            </span>
                            <span style={{
                              color: transaction.balance_after < 0 ? TavariStyles.colors.danger : TavariStyles.colors.gray800
                            }}>
                              {formatHoursDisplay(transaction.balance_after)}
                            </span>
                            <span style={{fontSize: TavariStyles.typography.fontSize.xs}}>
                              {transaction.description || 'No description'}
                              {transaction.premium_name && (
                                <div style={{color: TavariStyles.colors.success}}>
                                  Premium: {transaction.premium_name}
                                </div>
                              )}
                            </span>
                            <span style={styles.transactionActions}>
                              <button
                                style={{
                                  ...styles.transactionActionButton,
                                  ...(typeof transaction.id === 'string' && transaction.id.startsWith('payroll-')
                                    ? styles.transactionActionButtonDisabled
                                    : {})
                                }}
                                onClick={() => handleDeleteTransaction(transaction)}
                                disabled={
                                  (typeof transaction.id === 'string' && transaction.id.startsWith('payroll-')) ||
                                  deletingTransactionId === transaction.id
                                }
                                title={
                                  typeof transaction.id === 'string' && transaction.id.startsWith('payroll-')
                                    ? 'Payroll-generated entries can only be removed by editing the payroll run.'
                                    : 'Delete this transaction'
                                }
                              >
                                {deletingTransactionId === transaction.id ? 'Deleting…' : 'Delete'}
                              </button>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default EmployeeLieuTimeTrackingModal;