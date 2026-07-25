// EmployeePayStatementsPortal - Employee portal for viewing their own pay statements
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { SecurityWrapper } from '../../Security';
import { useSecurityContext } from '../../Security';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { useYTDCalculations } from '../../hooks/useYTDCalculations';
import POSAuthWrapper from '../../components/Auth/POSAuthWrapper';
import { TavariStyles } from '../../utils/TavariStyles';
import { Download, FileText, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';
import html2pdf from 'html2pdf.js';

const EmployeePayStatementsContent = () => {
  const {
    selectedBusinessId,
    authUser,
    userRole,
    businessData
  } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'hr_admin', 'employee'],
    requireBusiness: true,
    componentName: 'EmployeePayStatementsContent'
  });
  
  // Use selectedBusinessId directly (same value, just match PayStatementsTab pattern)
  const authBusinessId = selectedBusinessId;
  const [payrollEntries, setPayrollEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);

  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'EmployeePayStatementsPortal',
    sensitiveComponent: true,
    enableRateLimiting: true,
    enableAuditLogging: true,
    securityLevel: 'high'
  });

  // Initialize hooks with business ID - EXACT SAME AS PayStatementsTab
  const { formatTaxAmount } = useTaxCalculations(selectedBusinessId || authBusinessId);
  const ytd = useYTDCalculations(selectedBusinessId || authBusinessId);
  
  // Get business ID from payroll entries if not available (for logging/display only)
  const effectiveBusinessId = selectedBusinessId || (payrollEntries.length > 0 && payrollEntries[0]?.hrpayroll_runs?.business_id) || '';

  useEffect(() => {
    if (authUser?.id && selectedBusinessId) {
      loadPayStatements();
    }
  }, [authUser?.id, selectedBusinessId]);

  const loadPayStatements = async () => {
    if (!authUser?.id || !selectedBusinessId) return;

    setLoading(true);
    try {
      await logSecurityEvent('employee_pay_statements_accessed', {
        business_id: selectedBusinessId,
        employee_id: authUser.id
      }, 'medium');

      // Load all payroll entries for this employee
      // Note: Using * includes pdf_storage_path (after migration is run)
      const { data, error } = await supabase
        .from('hrpayroll_entries')
        .select(`
          *,
          pdf_storage_path,
          users!hrpayroll_entries_user_id_fkey (
            first_name,
            last_name,
            email,
            hire_date,
            wage
          ),
          hrpayroll_runs:hrpayroll_entries_payroll_run_id_fkey (
            id,
            pay_period_start,
            pay_period_end,
            pay_date,
            business_id,
            businesses:hrpayroll_runs_business_id_fkey (
              name,
              business_email,
              timezone
            )
          )
        `)
        .eq('user_id', authUser.id)
        .eq('business_id', selectedBusinessId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setPayrollEntries(data || []);
    } catch (error) {
      console.error('Error loading pay statements:', error);
      toast.error('Failed to load pay statements');
    } finally {
      setLoading(false);
    }
  };

  const getEmptyYTDTotals = () => ({
    regular_hours: 0, overtime_hours: 0, lieu_hours: 0, stat_hours: 0, holiday_hours: 0,
    regular_earnings: 0, overtime_earnings: 0, lieu_earnings: 0, stat_earnings: 0,
    holiday_earnings: 0, shift_premiums: 0, vacation_pay: 0, bonus: 0, gross_pay: 0,
    federal_tax: 0, provincial_tax: 0, ei_deduction: 0, cpp_deduction: 0,
    additional_tax: 0, net_pay: 0,
    _ytd_source: 'empty_fallback'
  });

  const calculateYTDTotals = async (userId, payDate) => {
    try {
      console.log(`🚀 Using FAST YTD calculation for employee ${userId} up to ${payDate}`);
      
      // Call with 2 parameters only - hook will use businessId from initialization (selectedBusinessId || authSelectedBusinessId)
      const ytdData = await ytd.calculateEmployeeYTD(userId, payDate);
      
      if (!ytdData) {
        console.warn(`⚠️ No YTD data found for employee ${userId}, returning empty totals`);
        return getEmptyYTDTotals();
      }

      console.log(`✅ Fast YTD calculation successful for employee ${userId}`);
      
      return {
        regular_hours: ytdData.regular_hours || 0,
        overtime_hours: ytdData.overtime_hours || 0,
        lieu_hours: ytdData.lieu_hours || 0,
        stat_hours: ytdData.stat_hours || 0,
        holiday_hours: ytdData.holiday_hours || 0,
        regular_earnings: ytdData.regular_income || 0,
        overtime_earnings: ytdData.overtime_income || 0,
        lieu_earnings: ytdData.lieu_income || 0,
        stat_earnings: ytdData.stat_earnings || 0,
        holiday_earnings: ytdData.holiday_earnings || 0,
        shift_premiums: ytdData.shift_premiums || 0,
        vacation_pay: ytdData.vacation_pay || 0,
        bonus: ytdData.bonus || 0,
        gross_pay: ytdData.gross_pay || 0,
        federal_tax: ytdData.federal_tax || 0,
        provincial_tax: ytdData.provincial_tax || 0,
        ei_deduction: ytdData.ei_deduction || 0,
        cpp_deduction: ytdData.cpp_deduction || 0,
        additional_tax: ytdData.additional_tax || 0,
        net_pay: ytdData.net_pay || 0,
        _ytd_source: 'fast_ytd_lookup',
        _ytd_last_updated: ytdData.last_updated,
        _ytd_calculation_date: ytdData.calculation_date,
        _ytd_entries_included: ytdData.entries_included
      };

    } catch (error) {
      console.error('❌ Error in fast YTD calculation:', error);
      
      await logSecurityEvent('ytd_calculation_fallback', {
        business_id: selectedBusinessId,
        user_id: userId,
        error: error.message,
        fallback_reason: 'ytd_calculation_failed'
      }, 'medium');
      
      return getEmptyYTDTotals();
    }
  };

  // Generate pay statement PDF - check for saved PDF first, otherwise generate
  const generatePayStatementPDF = async (entry) => {
    if (!entry || !entry.hrpayroll_runs || !entry.hrpayroll_runs.pay_period_end) {
      toast.error('Pay statement data is incomplete. Please contact support.');
      return;
    }

    const rateLimitCheck = await checkRateLimit('generate_pay_statement', entry.user_id);
    if (!rateLimitCheck.allowed) {
      toast.error('Rate limit exceeded. Please wait before generating more statements.');
      return;
    }

    setGenerating(true);
    setSelectedEntry(entry);
    
    try {
      await recordAction('generate_pay_statement', entry.user_id, true);
      
      // CRITICAL: Employee portal ONLY retrieves saved PDFs - no generation
      // This ensures employees get the EXACT same PDF that HR generated
      if (!entry.pdf_storage_path) {
        console.warn('📄 No saved PDF found for entry:', entry.id);
        toast.error('Pay statement PDF not available. Please contact HR to generate your pay statement.');
        setGenerating(false);
        return;
      }

      console.log('📄 Found saved PDF, retrieving from storage:', entry.pdf_storage_path);
      
      try {
        const { data, error } = await supabase.storage
          .from('pay-statements')
          .download(entry.pdf_storage_path);

        if (error) throw error;

        // Create download link
        const url = URL.createObjectURL(data);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Pay Statement - ${entry.hrpayroll_runs.pay_period_end}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        toast.success('Pay statement downloaded successfully');
        
        await logSecurityEvent('pay_statement_downloaded', {
          business_id: effectiveBusinessId,
          employee_id: entry.user_id,
          payroll_run_id: entry.hrpayroll_runs.id,
          source: 'employee_portal',
          from_storage: true
        }, 'medium');
        
        setGenerating(false);
        return; // Success - PDF retrieved from storage
      } catch (storageError) {
        console.error('Error retrieving PDF from storage:', storageError);
        console.error('Storage error details:', storageError);
        toast.error('Error retrieving pay statement. Please contact HR for assistance.');
        setGenerating(false);
        return;
      }
    } catch (error) {
      console.error('Error in generatePayStatementPDF:', error);
      toast.error('Failed to retrieve pay statement: ' + error.message);
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: TavariStyles.colors.gray50
      }}>
        <div style={{
          fontSize: TavariStyles.typography.fontSize.lg,
          color: TavariStyles.colors.gray600
        }}>
          Loading pay statements...
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.xl
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto'
      }}>
        <div style={{
          backgroundColor: TavariStyles.colors.white,
          padding: TavariStyles.spacing.xl,
          borderRadius: TavariStyles.borderRadius?.lg || '12px',
          boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
          marginBottom: TavariStyles.spacing.xl
        }}>
          <h1 style={{
            fontSize: TavariStyles.typography.fontSize['2xl'],
            fontWeight: TavariStyles.typography.fontWeight.bold,
            color: TavariStyles.colors.gray800,
            marginBottom: TavariStyles.spacing.sm
          }}>
            My Pay Statements
          </h1>
          <p style={{
            fontSize: TavariStyles.typography.fontSize.sm,
            color: TavariStyles.colors.gray600
          }}>
            View and download your pay statements
          </p>
        </div>

        {payrollEntries.length === 0 ? (
          <div style={{
            backgroundColor: TavariStyles.colors.white,
            padding: TavariStyles.spacing['3xl'],
            borderRadius: TavariStyles.borderRadius?.lg || '12px',
            boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
            textAlign: 'center'
          }}>
            <FileText size={48} color={TavariStyles.colors.gray400} style={{ marginBottom: TavariStyles.spacing.md }} />
            <p style={{
              fontSize: TavariStyles.typography.fontSize.lg,
              color: TavariStyles.colors.gray600,
              marginBottom: TavariStyles.spacing.sm
            }}>
              No pay statements found
            </p>
            <p style={{
              fontSize: TavariStyles.typography.fontSize.sm,
              color: TavariStyles.colors.gray500
            }}>
              Your pay statements will appear here once they are generated by HR.
            </p>
          </div>
        ) : (
          <div style={{
            backgroundColor: TavariStyles.colors.white,
            padding: TavariStyles.spacing.xl,
            borderRadius: TavariStyles.borderRadius?.lg || '12px',
            boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <div style={{
              display: 'grid',
              gap: TavariStyles.spacing.md
            }}>
              {payrollEntries
                .filter((entry) => entry.hrpayroll_runs && entry.hrpayroll_runs.pay_period_end && entry.hrpayroll_runs.pay_date)
                .map((entry) => {
                  const payrollRun = entry.hrpayroll_runs;
                  const businessData = payrollRun.businesses || {};
                  const businessTimezone = businessData.timezone || 'America/Toronto';
                  const payPeriodEndDate = new Date(payrollRun.pay_period_end + 'T12:00:00');
                  const formattedDate = payPeriodEndDate.toLocaleDateString('en-CA', { timeZone: businessTimezone });

                  return (
                    <div key={entry.id} style={{
                      border: `1px solid ${TavariStyles.colors.gray200}`,
                      borderRadius: TavariStyles.borderRadius?.md || '8px',
                      padding: TavariStyles.spacing.lg,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <div>
                        <p style={{
                          fontSize: TavariStyles.typography.fontSize.lg,
                          fontWeight: TavariStyles.typography.fontWeight.semibold,
                          color: TavariStyles.colors.gray800,
                          marginBottom: TavariStyles.spacing.xs
                        }}>
                          Pay Period Ending: {formattedDate}
                        </p>
                        <p style={{
                          fontSize: TavariStyles.typography.fontSize.sm,
                          color: TavariStyles.colors.gray600,
                          marginBottom: TavariStyles.spacing.xs
                        }}>
                          Pay Date: {new Date(payrollRun.pay_date + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: businessTimezone })}
                        </p>
                        <p style={{
                          fontSize: TavariStyles.typography.fontSize.sm,
                          fontWeight: TavariStyles.typography.fontWeight.semibold,
                          color: TavariStyles.colors.gray700
                        }}>
                          Net Pay: ${formatTaxAmount(parseFloat(entry.net_pay || 0))}
                        </p>
                        {!entry.pdf_storage_path && (
                          <p style={{
                            fontSize: TavariStyles.typography.fontSize.xs,
                            color: TavariStyles.colors.warning || '#f59e0b',
                            marginTop: TavariStyles.spacing.xs,
                            fontStyle: 'italic'
                          }}>
                            PDF not yet available - contact HR
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => generatePayStatementPDF(entry)}
                        disabled={generating && selectedEntry?.id === entry.id || !entry.pdf_storage_path}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: TavariStyles.spacing.sm,
                          padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
                          backgroundColor: entry.pdf_storage_path ? TavariStyles.colors.primary : TavariStyles.colors.gray400,
                          color: TavariStyles.colors.white,
                          border: 'none',
                          borderRadius: TavariStyles.borderRadius?.md || '8px',
                          fontSize: TavariStyles.typography.fontSize.sm,
                          fontWeight: TavariStyles.typography.fontWeight.medium,
                          cursor: entry.pdf_storage_path ? 'pointer' : 'not-allowed',
                          opacity: (generating && selectedEntry?.id === entry.id) || !entry.pdf_storage_path ? 0.6 : 1
                        }}
                      >
                        {generating && selectedEntry?.id === entry.id ? (
                          <>
                            <span>Downloading...</span>
                          </>
                        ) : (
                          <>
                            <Download size={18} />
                            <span>Download PDF</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const EmployeePayStatementsPortal = () => {
  return (
    <SecurityWrapper componentName="EmployeePayStatementsPortal" sensitiveComponent={true} securityLevel="high">
      <POSAuthWrapper
        requiredRoles={['owner', 'manager', 'hr_admin', 'employee']}
        requireBusiness={true}
        componentName="EmployeePayStatementsPortal"
      >
        <EmployeePayStatementsContent />
      </POSAuthWrapper>
    </SecurityWrapper>
  );
};

export default EmployeePayStatementsPortal;

