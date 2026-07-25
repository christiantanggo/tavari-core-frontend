// PortalPayStatements.jsx - Employee Portal Pay Statements List
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useYTDCalculations } from '../../hooks/useYTDCalculations';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { normalizeYTDTotals, addCurrentPeriodToPayStatementYtd } from '../../utils/payStatementYTD';
import { TavariStyles } from '../../utils/TavariStyles';
import { Download, FileText, Calendar, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import { getPublicUserId } from '../../utils/getPublicUserId';
import { employeeAppPath } from '../../utils/employeeAppRouting';
import {
  ensureEmployeePortalSelectedProfile,
  getEmployeePortalSelectedBusinessId,
} from '../../utils/employeeProfileSelection';
import { generatePayStatementHTMLContent } from '../../utils/generatePayStatementHTMLContent';
import { downloadPayStatementPdf } from '../../utils/payStatementPdf';
import { fetchLieuTimeForPayStatement } from '../../helpers/Payroll/fetchLieuTimeForPayStatement';
import {
  fetchLastWageAdjustmentForPayStatement,
  formatLastWageAdjustmentDisplay,
} from '../../helpers/Payroll/fetchLastWageAdjustmentForPayStatement';

const PortalPayStatements = () => {
  const navigate = useNavigate();
  const [businessId, setBusinessId] = useState(null);
  const [payrollEntries, setPayrollEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState(null);

  // Initialize hooks - will get businessId after loading user
  const ytd = useYTDCalculations(businessId || '');
  const { formatTaxAmount } = useTaxCalculations(businessId || '');

  useEffect(() => {
    loadPayStatements();
    window.addEventListener('employee-profile-selection-changed', loadPayStatements);
    return () => window.removeEventListener('employee-profile-selection-changed', loadPayStatements);
  }, []);

  const loadPayStatements = async () => {
    try {
      setLoading(true);

      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        navigate(employeeAppPath('/portal/login'));
        return;
      }

      const publicUserId = await getPublicUserId(currentUser.email);
      if (!publicUserId) {
        toast.error('User profile not found');
        return;
      }

      const { data: businessUsers, error: businessError } = await supabase
        .from('business_users')
        .select('business_id, role, created_at, businesses:business_id(id, name)')
        .eq('user_id', publicUserId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (businessError || !businessUsers?.length) {
        toast.error('You are not associated with any business');
        return;
      }

      const profileList = businessUsers.map((row) => ({
        employee_id: publicUserId,
        business_id: row.business_id,
        business_name: row.businesses?.name || 'Business',
        role: row.role || 'employee',
      }));

      const resolved = ensureEmployeePortalSelectedProfile(profileList);
      const userBusinessId =
        resolved?.business_id ??
        getEmployeePortalSelectedBusinessId() ??
        businessUsers[0].business_id;

      setBusinessId(userBusinessId);

      // Join runs with !inner and filter on run.business_id so we do not rely on a separate
      // hrpayroll_runs SELECT (employees often have no RLS on that table except via entry).
      const { data, error } = await supabase
        .from('hrpayroll_entries')
        .select(`
          *,
          users!hrpayroll_entries_user_id_fkey (
            first_name,
            last_name,
            email,
            hire_date,
            wage
          ),
          hrpayroll_runs!hrpayroll_entries_payroll_run_id_fkey!inner (
            id,
            pay_period_start,
            pay_period_end,
            pay_date,
            business_id,
            status,
            created_at,
            businesses:hrpayroll_runs_business_id_fkey (
              name,
              business_email,
              timezone
            )
          )
        `)
        .eq('user_id', publicUserId)
        .eq('hrpayroll_runs.business_id', userBusinessId);

      if (error) throw error;

      const sortedEntries = (data || []).sort((a, b) => {
        const dateA = a.hrpayroll_runs?.pay_date ? new Date(`${a.hrpayroll_runs.pay_date}T12:00:00`) : new Date(0);
        const dateB = b.hrpayroll_runs?.pay_date ? new Date(`${b.hrpayroll_runs.pay_date}T12:00:00`) : new Date(0);
        return dateB - dateA;
      });

      setPayrollEntries(sortedEntries);
    } catch (error) {
      console.error('[PortalPayStatements] Error loading pay statements:', error);
      toast.error('Failed to load pay statements');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPDF = async (entry) => {
    if (!entry || !entry.hrpayroll_runs || !formatTaxAmount) {
      toast.error('Cannot generate PDF - missing required data');
      return;
    }

    setDownloading(true);
    setSelectedEntryId(entry.id);

    try {
      console.log('🚀 Portal PDF generation starting...');
      
      const payrollRun = entry.hrpayroll_runs;
      const businessData = payrollRun?.businesses || {};

      // Calculate YTD totals using the exact same approach as PayStatementsTab
      // IMPORTANT: Use business_id from the payroll run, not the user's business_id
      // This handles cases where entry.business_id is null but the run has the correct business_id
      const effectiveBusinessId = payrollRun.business_id || businessId;
      
      const ytdStartTime = Date.now();
      console.log('[Portal] YTD calculation params:', {
        userId: entry.user_id,
        payDate: payrollRun.pay_date,
        businessId: businessId,
        runBusinessId: payrollRun.business_id,
        effectiveBusinessId: effectiveBusinessId
      });
      
      // Use pay_period_end for YTD calculation, not pay_date
      // YTD should include all work done up to the end of the pay period, not when it was paid
      const ytdEndDate = payrollRun.pay_period_end || payrollRun.pay_date;
      const businessTimezoneForYtd = businessData?.timezone || 'America/Toronto';
      const rawYtd = await ytd.calculateEmployeeYTD(
        entry.user_id,
        ytdEndDate,
        effectiveBusinessId,
        businessTimezoneForYtd,
        { excludePayrollRunId: payrollRun.id }
      );
      const ytdTotals = addCurrentPeriodToPayStatementYtd(normalizeYTDTotals(rawYtd), entry);
      const ytdCalculationTime = Date.now() - ytdStartTime;
      
      console.log(`⚡ Portal YTD calculation completed in ${ytdCalculationTime}ms for ${entry.users?.first_name} ${entry.users?.last_name}`);

      const { data: { user: authUserForPdf } } = await supabase.auth.getUser();
      const generatedByLabel = authUserForPdf?.email
        ? `${authUserForPdf.email} (Employee Portal)`
        : 'Employee Portal';

      const lieuTime = await fetchLieuTimeForPayStatement(supabase, entry.user_id, effectiveBusinessId);
      const lastWageAdjustment = await fetchLastWageAdjustmentForPayStatement(
        supabase,
        entry.user_id,
        effectiveBusinessId
      );
      const payStatementHTML = generatePayStatementHTMLContent({
        entry,
        ytdTotals,
        ytdCalculationTime,
        payrollRun,
        businessData,
        formatTaxAmount,
        generatedByLabel,
        lieuTimeEnabled: lieuTime.enabled,
        lieuTimeEntries: lieuTime.entries,
        lastWageAdjustment,
      });

      const businessTimezoneForFilename = businessData?.timezone || 'America/Toronto';
      const payPeriodEndForFilename = new Date(
        (payrollRun.pay_period_end || payrollRun.pay_date) + 'T12:00:00'
      ).toLocaleDateString('en-CA', { timeZone: businessTimezoneForFilename });
      const filename = `Pay Statement - ${entry.users?.first_name || ''} ${entry.users?.last_name || ''} - ${payPeriodEndForFilename}.pdf`;

      toast.loading('Generating PDF...', { id: 'portal-pdf-download' });
      await downloadPayStatementPdf(payStatementHTML, filename);
      toast.success('Pay statement downloaded.', { id: 'portal-pdf-download' });

      console.log(
        `✅ Portal pay statement downloaded for ${entry.users?.first_name} ${entry.users?.last_name}`
      );

    } catch (error) {
      console.error('Error generating pay statement:', error);
      toast.error('Could not download pay statement: ' + error.message, { id: 'portal-pdf-download' });
    } finally {
      setDownloading(false);
      setSelectedEntryId(null);
    }
  };

  const handleViewStatement = (entry) => {
    navigate(employeeAppPath(`/portal/pay-statements/${entry.id}`));
  };

  const styles = {
    container: {
      maxWidth: '1200px',
      width: '100%',
      minWidth: 0,
      margin: '0 auto',
      overflowX: 'hidden',
      boxSizing: 'border-box'
    },
    header: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      marginBottom: TavariStyles.spacing.xl,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
      boxSizing: 'border-box',
      overflowWrap: 'anywhere'
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.sm
    },
    subtitle: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    emptyState: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing['3xl'],
      textAlign: 'center',
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
      boxSizing: 'border-box',
      overflowWrap: 'anywhere'
    },
    statementList: {
      display: 'flex',
      flexDirection: 'column',
      gap: TavariStyles.spacing.md,
      minWidth: 0
    },
    statementCard: {
      backgroundColor: TavariStyles.colors.white,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      padding: TavariStyles.spacing.xl,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: TavariStyles.spacing.lg,
      flexWrap: 'wrap',
      minWidth: 0,
      boxSizing: 'border-box',
      overflowWrap: 'anywhere'
    },
    statementInfo: {
      flex: '1 1 220px',
      minWidth: 0
    },
    statementTitle: {
      fontSize: TavariStyles.typography.fontSize.lg,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray900,
      marginBottom: TavariStyles.spacing.xs
    },
    statementMeta: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600,
      marginBottom: TavariStyles.spacing.xs
    },
    statementNet: {
      fontSize: TavariStyles.typography.fontSize.base,
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.primary,
      marginTop: TavariStyles.spacing.xs
    },
    statementActions: {
      display: 'flex',
      gap: TavariStyles.spacing.sm,
      flexWrap: 'wrap'
    },
    button: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.medium,
      cursor: 'pointer',
      border: 'none',
      transition: 'all 0.2s',
      maxWidth: '100%',
      boxSizing: 'border-box'
    },
    buttonPrimary: {
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    },
    buttonSecondary: {
      backgroundColor: TavariStyles.colors.gray100,
      color: TavariStyles.colors.gray700,
      border: `1px solid ${TavariStyles.colors.gray300}`
    },
    buttonDisabled: {
      backgroundColor: TavariStyles.colors.gray300,
      color: TavariStyles.colors.gray500,
      cursor: 'not-allowed',
      opacity: 0.6
    },
    loading: {
      textAlign: 'center',
      padding: TavariStyles.spacing['3xl'],
      color: TavariStyles.colors.gray600
    }
  };

  const formatDate = (dateString, timezone = 'America/Toronto') => {
    if (!dateString) {
      console.warn('[PortalPayStatements] formatDate called with null/undefined dateString');
      return 'N/A';
    }
    
    const dateWithTime = dateString.includes('T') ? dateString : dateString + 'T12:00:00';
    const dateObj = new Date(dateWithTime);
    
    // Validate date
    if (isNaN(dateObj.getTime())) {
      console.error('[PortalPayStatements] formatDate: Invalid date:', dateString);
      return 'Invalid Date';
    }
    
    return dateObj.toLocaleDateString('en-CA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: timezone
    });
  };

  if (loading) {
    return (
      <div style={styles.loading}>Loading pay statements...</div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>My Pay Statements</h1>
        <p style={styles.subtitle}>View and download your pay statements</p>
      </div>

      {payrollEntries.length === 0 ? (
        <div style={styles.emptyState}>
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
        <div style={styles.statementList}>
          {payrollEntries
            .filter((entry) => {
              const hasRun = !!entry.hrpayroll_runs;
              const hasPeriodEnd = !!entry.hrpayroll_runs?.pay_period_end;
              
              return hasRun && hasPeriodEnd;
            })
            .map((entry) => {
              const payrollRun = entry.hrpayroll_runs;
              const businessData = payrollRun?.businesses || {};
              const businessTimezone = businessData.timezone || 'America/Toronto';
              const isDownloading = downloading && selectedEntryId === entry.id;
              
              return (
                <div key={entry.id} style={styles.statementCard}>
                  <div style={styles.statementInfo}>
                    <div style={styles.statementTitle}>
                      Pay Period Ending: {formatDate(payrollRun.pay_period_end, businessTimezone)}
                    </div>
                    <div style={styles.statementMeta}>
                      Pay Date: {formatDate(payrollRun.pay_date, businessTimezone)}
                    </div>
                    <div style={styles.statementNet}>
                      Net Pay: {formatTaxAmount(parseFloat(entry.net_pay || 0))}
                    </div>
                  </div>
                  <div style={styles.statementActions}>
                    <button
                      onClick={() => handleViewStatement(entry)}
                      style={styles.buttonSecondary}
                    >
                      <Eye size={18} />
                      View
                    </button>
                    <button
                      onClick={() => handleDownloadPDF(entry)}
                      disabled={isDownloading}
                      style={{
                        ...styles.button,
                        ...styles.buttonPrimary,
                        ...(isDownloading ? styles.buttonDisabled : {})
                      }}
                    >
                      {isDownloading ? (
                        <>Preparing…</>
                      ) : (
                        <>
                          <Download size={18} />
                          Print / Save as PDF
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
};

export default PortalPayStatements;

