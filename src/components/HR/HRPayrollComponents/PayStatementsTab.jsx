// components/HR/HRPayrollComponents/PayStatementsTab.jsx - COMPLETE FIX
import React, { useState, useEffect } from 'react';
import { supabase } from '../../../supabaseClient';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import { useYTDCalculations } from '../../../hooks/useYTDCalculations';
import POSAuthWrapper from '../../../components/Auth/POSAuthWrapper';
import TavariCheckbox from '../../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';
import { addCurrentPeriodToPayStatementYtd } from '../../../utils/payStatementYTD';
import { YTDSummaryCard, YTDDetailModal } from '../YTDComponents';
import PayStatementEmailModal from './PayStatementEmailModal';
import toast from 'react-hot-toast';
import { generatePayStatementHTMLContent as buildPayStatementHTMLContent } from '../../../utils/generatePayStatementHTMLContent';
import { downloadPayStatementPdf, getPayStatementPdfBlob } from '../../../utils/payStatementPdf';
import { deletePayrollRunWithRefunds } from '../../../helpers/Payroll/deletePayrollRun';
import { fetchLieuTimeForPayStatement } from '../../../helpers/Payroll/fetchLieuTimeForPayStatement';
import { fetchLastWageAdjustmentForPayStatement } from '../../../helpers/Payroll/fetchLastWageAdjustmentForPayStatement';

const PayStatementsTab = ({ selectedBusinessId, businessData }) => {
  const [payrollRuns, setPayrollRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [payrollEntries, setPayrollEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [selectedEmployees, setSelectedEmployees] = useState(new Set());
  const [showYTDModal, setShowYTDModal] = useState(false);
  const [selectedYTDEmployee, setSelectedYTDEmployee] = useState(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailConfig, setEmailConfig] = useState(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [showCustomEmailModal, setShowCustomEmailModal] = useState(false);
  const [selectedEntryForCustomEmail, setSelectedEntryForCustomEmail] = useState(null);
  const [customEmailAddress, setCustomEmailAddress] = useState('');
  const [deletingRun, setDeletingRun] = useState(false);

  const {
    validateInput,
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'PayStatementsTab',
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
    componentName: 'PayStatementsTab'
  });

  const { formatTaxAmount } = useTaxCalculations(selectedBusinessId || authBusinessId);
  const ytd = useYTDCalculations(selectedBusinessId || authBusinessId);

  const effectiveBusinessId = selectedBusinessId || authBusinessId;
  const effectiveBusinessData = businessData || authBusinessData;

  useEffect(() => {
    if (effectiveBusinessId) {
      loadPayrollRuns();
    }
  }, [effectiveBusinessId]);

  const loadPayrollRuns = async () => {
    if (!effectiveBusinessId) return;

    setLoading(true);
    try {
      await logSecurityEvent('payroll_runs_accessed', {
        business_id: effectiveBusinessId,
        action: 'load_payroll_runs'
      }, 'medium');

      const { data, error } = await supabase
        .from('hrpayroll_runs')
        .select('*')
        .eq('business_id', effectiveBusinessId)
        .eq('status', 'finalized')
        .order('pay_date', { ascending: false });

      if (error) throw error;

      setPayrollRuns(data || []);
      if (data && data.length > 0) {
        setSelectedRun(data[0]);
        await loadPayrollEntries(data[0].id);
      }
    } catch (error) {
      console.error('Error loading payroll runs:', error);
      await logSecurityEvent('payroll_runs_load_error', {
        business_id: effectiveBusinessId,
        error: error.message
      }, 'high');
    } finally {
      setLoading(false);
    }
  };

  const loadPayrollEntries = async (runId) => {
    if (!runId) return;

    try {
      await logSecurityEvent('payroll_entries_accessed', {
        business_id: effectiveBusinessId,
        payroll_run_id: runId,
        action: 'load_payroll_entries'
      }, 'medium');

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
          )
        `)
        .eq('payroll_run_id', runId);

      if (error) throw error;


      setPayrollEntries(data || []);
      setSelectedEmployees(new Set());
    } catch (error) {
      console.error('Error loading payroll entries:', error);
      await logSecurityEvent('payroll_entries_load_error', {
        business_id: effectiveBusinessId,
        payroll_run_id: runId,
        error: error.message
      }, 'high');
    }
  };

  const calculateYTDTotals = async (userId, payDate, businessTimezone, ytdOptions = {}) => {
    try {
      console.log(`🚀 Using FAST YTD calculation for employee ${userId} up to ${payDate}`);
      
      const ytdData = await ytd.calculateEmployeeYTD(
        userId,
        payDate,
        effectiveBusinessId,
        businessTimezone || effectiveBusinessData?.timezone || 'America/Toronto',
        ytdOptions
      );
      
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
        business_id: effectiveBusinessId,
        user_id: userId,
        error: error.message,
        fallback_reason: 'ytd_calculation_failed'
      }, 'medium');
      
      return getEmptyYTDTotals();
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

  const handleViewYTDDetails = (employee, ytdData) => {
    setSelectedYTDEmployee({ employee, ytdData });
    setShowYTDModal(true);
  };

  // Delete entire payroll run
  const handleDeletePayrollRun = async () => {
    if (!selectedRun || deletingRun) {
      return;
    }

    try {
      const rateLimitCheck = await checkRateLimit('delete_payroll_run', 3, 300000);
      if (!rateLimitCheck.allowed) {
        toast.error('Rate limit exceeded. Please wait a few minutes before attempting to delete another payroll run.');
        return;
      }
    } catch (rateLimitError) {
      console.warn('Rate limit check failed for delete_payroll_run:', rateLimitError);
    }

    const runLabel = `${new Date(selectedRun.pay_period_start + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })} to ${new Date(selectedRun.pay_period_end + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })}`;
    const entryCount = payrollEntries.length;

    const primaryConfirm = window.confirm(
      `This will permanently delete the finalized payroll run for ${runLabel} and ${entryCount} associated payroll entries.\n\n` +
      'This action cannot be undone. Do you want to continue?'
    );

    if (!primaryConfirm) {
      return;
    }

    setDeletingRun(true);

    try {
      await deletePayrollRunWithRefunds({
        supabase,
        run: {
          id: selectedRun.id,
          business_id: effectiveBusinessId,
          pay_period_start: selectedRun.pay_period_start,
          pay_period_end: selectedRun.pay_period_end,
          status: selectedRun.status || 'finalized',
        },
        payrollEntries,
        authUser,
        logSecurityEvent,
        recordAction
      });

      toast.success(`Payroll run for ${runLabel} deleted successfully.`);
      setSelectedRun(null);
      setPayrollEntries([]);
      setSelectedEmployees(new Set());

      // Reload payroll runs list
      await loadPayrollRuns();
    } catch (error) {
      console.error('Error deleting payroll run:', error);
      toast.error(`Error deleting payroll run: ${error.message || 'Unknown error'}`);
    } finally {
      setDeletingRun(false);
    }
  };

  const generatePayStatementHTMLContent = (entry, ytdTotals, ytdCalculationTime, lieuTime = {}, lastWageAdjustment = null) =>
    buildPayStatementHTMLContent({
      entry,
      ytdTotals,
      ytdCalculationTime,
      payrollRun: selectedRun,
      businessData: effectiveBusinessData,
      formatTaxAmount,
      generatedByLabel: authUser?.email || 'System',
      lieuTimeEnabled: lieuTime.enabled === true,
      lieuTimeEntries: lieuTime.entries || [],
      lastWageAdjustment,
    });

  // FIXED: Generate pay statement with proper wage breakdown
  const generatePayStatementPDF = async (entry, isBulkGeneration = false) => {
    if (!entry || !selectedRun) return;

    const rateLimitCheck = await checkRateLimit('generate_pay_statement', entry.user_id);
    if (!rateLimitCheck.allowed) {
      alert('Rate limit exceeded. Please wait before generating more statements.');
      return;
    }

    if (!isBulkGeneration) setGenerating(true);
    
    try {
      await recordAction('generate_pay_statement', entry.user_id, true);
      await logSecurityEvent('pay_statement_generated', {
        business_id: effectiveBusinessId,
        employee_id: entry.user_id,
        payroll_run_id: selectedRun.id,
        bulk_generation: isBulkGeneration,
        ytd_system_enabled: true
      }, 'medium');

      const ytdStartTime = Date.now();
      // ✅ SIMPLE: YTD = All periods from Jan 1 of current year up to and INCLUDING current period's pay_period_end
      // Use pay_period_end (NOT pay_date) - this is the hard ceiling for YTD
      const payPeriodEnd = selectedRun.pay_period_end || selectedRun.pay_date;
      const businessTimezone = effectiveBusinessData?.timezone || 'America/Toronto';
      
      // Calculate YTD up to and INCLUDING the current period's pay_period_end
      // The YTD calculation will include ALL entries where pay_period_end <= target pay_period_end
      const ytdTotalsBase = await calculateYTDTotals(entry.user_id, payPeriodEnd, businessTimezone, {
        excludePayrollRunId: selectedRun?.id
      });
      const ytdTotals = addCurrentPeriodToPayStatementYtd(ytdTotalsBase, entry);
      const ytdCalculationTime = Date.now() - ytdStartTime;
      
      console.log(`⚡ YTD calculation completed in ${ytdCalculationTime}ms for ${entry.users.first_name} ${entry.users.last_name}`);
      console.log(`📊 YTD calculated up to pay_period_end: ${payPeriodEnd} (includes all periods from Jan 1 to this date)`);
	  console.log('=== DEDUCTION DEBUG ===');
	  console.log('entry.federal_tax:', entry.federal_tax, 'Type:', typeof entry.federal_tax);
	  console.log('entry.provincial_tax:', entry.provincial_tax, 'Type:', typeof entry.provincial_tax);
	  console.log('entry.ontario_health_premium:', entry.ontario_health_premium, 'Type:', typeof entry.ontario_health_premium);
	  console.log('entry.cpp_deduction:', entry.cpp_deduction, 'Type:', typeof entry.cpp_deduction);
	  console.log('entry.ei_deduction:', entry.ei_deduction, 'Type:', typeof entry.ei_deduction);
	  console.log('entry.additional_tax:', entry.additional_tax, 'Type:', typeof entry.additional_tax);
	  console.log('=== END DEDUCTION DEBUG ===');

      // Parse premiums and wage breakdown
      let premiums = {};
      let currentPremiumPay = 0;
      try {
        premiums = typeof entry.premiums === 'string' ? 
          JSON.parse(entry.premiums) : (entry.premiums || {});
        
        Object.values(premiums).forEach(premium => {
          if (premium.total_pay) {
            currentPremiumPay += parseFloat(premium.total_pay);
          }
        });
      } catch (e) {
        console.warn('Error parsing premiums:', e);
        premiums = {};
      }

      // Parse wage breakdown if exists
      let wageBreakdown = [];
      let hasWageChange = false;
      try {
        if (entry.wage_breakdown) {
          wageBreakdown = typeof entry.wage_breakdown === 'string' ? 
            JSON.parse(entry.wage_breakdown) : entry.wage_breakdown;
          hasWageChange = Array.isArray(wageBreakdown) && wageBreakdown.length > 1;
        }
      } catch (e) {
        console.warn('Error parsing wage breakdown:', e);
      }

      // Use SHARED HTML generation function - ensures EXACT same format
      // ytdTotals: prior runs from hook (excluding this run) + current period via addCurrentPeriodToPayStatementYtd
      const lieuTime = await fetchLieuTimeForPayStatement(supabase, entry.user_id, effectiveBusinessId);
      const lastWageAdjustment = await fetchLastWageAdjustmentForPayStatement(
        supabase,
        entry.user_id,
        effectiveBusinessId
      );
      const payStatementHTML = generatePayStatementHTMLContent(
        entry,
        ytdTotals,
        ytdCalculationTime,
        lieuTime,
        lastWageAdjustment
      );

      // Debug timezone information
      console.log('=== TIMEZONE DEBUG ===');
      console.log('effectiveBusinessData:', effectiveBusinessData);
      console.log('businessTimezone:', businessTimezone);
      console.log('selectedRun.pay_period_end:', selectedRun.pay_period_end);
      
      // Fix timezone issue by treating the date as a local date in the business timezone
      const payPeriodEndDate = new Date(selectedRun.pay_period_end + 'T12:00:00'); // Add noon to avoid timezone shift issues
      const formattedDate = payPeriodEndDate.toLocaleDateString('en-CA', {
        timeZone: businessTimezone
      });
      
      console.log('formattedDate:', formattedDate);
      console.log('=== END TIMEZONE DEBUG ===');

      const downloadFilename = `Pay Statement - ${entry.users.first_name} ${entry.users.last_name} - ${formattedDate}.pdf`;
      try {
        toast.loading('Generating PDF...', { id: 'pdf-download' });
        await downloadPayStatementPdf(payStatementHTML, downloadFilename);
        toast.success('Pay statement downloaded.', { id: 'pdf-download' });
      } catch (downloadError) {
        console.error('Pay statement download failed:', downloadError);
        toast.error(`Failed to generate PDF: ${downloadError.message}`, { id: 'pdf-download' });
        throw downloadError;
      }

      await logSecurityEvent('pay_statement_ytd_performance', {
        business_id: effectiveBusinessId,
        employee_id: entry.user_id,
        ytd_calculation_time_ms: ytdCalculationTime,
        ytd_source: ytdTotals._ytd_source || 'standard',
        ytd_entries_included: ytdTotals._ytd_entries_included || 0
      }, 'low');

    } catch (error) {
      console.error('Error generating pay statement:', error);
      await recordAction('generate_pay_statement', entry.user_id, false);
      await logSecurityEvent('pay_statement_generation_error', {
        business_id: effectiveBusinessId,
        employee_id: entry.user_id,
        error: error.message
      }, 'high');
      
      if (!isBulkGeneration) {
        alert('Error generating pay statement: ' + error.message);
      }
    } finally {
      if (!isBulkGeneration) setGenerating(false);
    }
  };

  // Email functionality
  const handleEmailConfigSave = (config) => {
    setEmailConfig(config);
    setShowEmailModal(false);
  };

  const openEmailModal = () => {
    if (!emailConfig) {
      // Set default email config
      const businessName = effectiveBusinessData?.business_name || effectiveBusinessData?.name || 'Company';
      const defaultSubject = 'Your Pay Statement - {{PayPeriodEnd}}';
      const defaultBody = `Dear {{FirstName}} {{LastName}},

Your pay statement for the period ending {{PayPeriodEnd}} is attached to this email.

If you have any questions about your pay statement, please contact your payroll department.

Thank you,
${businessName} - Payroll`;
      const defaultFromName = `${businessName} - Payroll`;
      
      setEmailConfig({
        subject: defaultSubject,
        body: defaultBody,
        fromName: defaultFromName
      });
    }
    setShowEmailModal(true);
  };


  const sendPayStatementEmail = async (entry, customEmail = null) => {
    if (!emailConfig) {
      toast.error('Please configure email settings first');
      openEmailModal();
      return;
    }

    const recipientEmail = customEmail || entry.users?.email;
    
    if (!recipientEmail) {
      toast.error(`No email address found for ${entry.users.first_name} ${entry.users.last_name}`);
      return;
    }

    setSendingEmail(true);
    try {
      await recordAction('send_pay_statement_email', entry.user_id, true);
      await logSecurityEvent('pay_statement_email_sent', {
        business_id: effectiveBusinessId,
        employee_id: entry.user_id,
        payroll_run_id: selectedRun.id,
        employee_email: entry.users.email,
        recipient_email: recipientEmail,
        is_custom_email: !!customEmail
      }, 'medium');

      // Generate PDF from pay statement HTML
      toast.loading('Generating PDF...', { id: 'pdf-generation' });
      
      // Generate YTD totals - EXACT SAME as generatePayStatementPDF
      const ytdStartTime = Date.now();
      // ✅ SIMPLE: YTD = All periods from Jan 1 of current year up to and INCLUDING current period's pay_period_end
      // Use pay_period_end (NOT pay_date) - this is the hard ceiling for YTD
      const payPeriodEnd = selectedRun.pay_period_end || selectedRun.pay_date;
      const businessTimezone = effectiveBusinessData?.timezone || 'America/Toronto';
      
      // Calculate YTD up to and INCLUDING the current period's pay_period_end
      const ytdTotalsBase = await calculateYTDTotals(entry.user_id, payPeriodEnd, businessTimezone, {
        excludePayrollRunId: selectedRun?.id
      });
      const ytdTotals = addCurrentPeriodToPayStatementYtd(ytdTotalsBase, entry);
      const ytdCalculationTime = Date.now() - ytdStartTime;
      
      // Use SHARED HTML generation function - EXACT SAME as generatePayStatementPDF
      // This ensures email PDFs match the working PDF format exactly
      const lieuTime = await fetchLieuTimeForPayStatement(supabase, entry.user_id, effectiveBusinessId);
      const lastWageAdjustment = await fetchLastWageAdjustmentForPayStatement(
        supabase,
        entry.user_id,
        effectiveBusinessId
      );
      const payStatementHTML = generatePayStatementHTMLContent(
        entry,
        ytdTotals,
        ytdCalculationTime,
        lieuTime,
        lastWageAdjustment
      );
      
      // businessTimezone is already declared above (line 859)
      const payPeriodEndDate = new Date(selectedRun.pay_period_end + 'T12:00:00');
      const formattedDate = payPeriodEndDate.toLocaleDateString('en-CA', {
        timeZone: businessTimezone
      });
      
      toast.loading('Generating PDF...', { id: 'pdf-generation' });
      
      // Debug: Log the HTML to verify it's correct
      console.log('[Email PDF] Generated HTML length:', payStatementHTML.length);
      console.log('[Email PDF] HTML starts with:', payStatementHTML.substring(0, 200));
      console.log('[Email PDF] HTML contains body:', payStatementHTML.includes('<body>'));
      console.log('[Email PDF] HTML contains tables:', payStatementHTML.includes('<table'));
      
      console.log('[PDF-EMAIL] Starting PDF conversion...');
      
      let pdfBlob;
      try {
        const filename = `Pay Statement - ${entry.users.first_name} ${entry.users.last_name} - ${formattedDate}.pdf`;

        // Same renderer (api/render-pay-statement-pdf → headless Chromium) the
        // "Download PDF" button uses, so the email attachment is visually
        // identical to the file the user gets from the download flow.
        pdfBlob = await getPayStatementPdfBlob(payStatementHTML, { filename });

        console.log('[PDF-EMAIL] PDF blob created:', {
          size: pdfBlob.size,
          type: pdfBlob.type,
          isValid: pdfBlob instanceof Blob
        });

        if (!pdfBlob || pdfBlob.size === 0) {
          throw new Error('PDF blob is empty or invalid');
        }

        if (pdfBlob.size < 1000) {
          throw new Error('PDF appears to be corrupted (file too small)');
        }

        toast.dismiss('pdf-generation');
      } catch (pdfError) {
        console.error('[PDF-EMAIL] Error generating PDF:', pdfError);
        toast.error(`Failed to generate PDF: ${pdfError.message}`, { id: 'pdf-generation' });
        throw pdfError;
      }
      
      // Convert PDF to base64
      const pdfBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = reader.result.split(',')[1];
          resolve(base64String);
        };
        reader.onerror = reject;
        reader.readAsDataURL(pdfBlob);
      });

      // Replace template variables in email
      const replaceTemplate = (text) => {
        return text
          .replace(/\{\{FirstName\}\}/g, entry.users.first_name || '')
          .replace(/\{\{LastName\}\}/g, entry.users.last_name || '')
          .replace(/\{\{FullName\}\}/g, `${entry.users.first_name || ''} ${entry.users.last_name || ''}`.trim())
          .replace(/\{\{Email\}\}/g, entry.users.email || '')
          .replace(/\{\{PayPeriodStart\}\}/g, new Date(selectedRun.pay_period_start + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: businessTimezone }))
          .replace(/\{\{PayPeriodEnd\}\}/g, formattedDate)
          .replace(/\{\{PayDate\}\}/g, new Date(selectedRun.pay_date + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: businessTimezone }))
          .replace(/\{\{NetPay\}\}/g, `$${formatTaxAmount(parseFloat(entry.net_pay || 0))}`)
          .replace(/\{\{GrossPay\}\}/g, `$${formatTaxAmount(parseFloat(entry.gross_pay || 0))}`)
          .replace(/\{\{BusinessName\}\}/g, effectiveBusinessData?.business_name || effectiveBusinessData?.name || 'Company')
          .replace(/\{\{StatementLink\}\}/g, ''); // Not needed for attached PDFs
      };

      const emailSubject = replaceTemplate(emailConfig.subject);
      const emailBody = replaceTemplate(emailConfig.body);
      
      // Create email HTML
      const emailHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #000;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
            }
            .email-message {
              white-space: pre-wrap;
              margin-bottom: 20px;
            }
          </style>
        </head>
        <body>
          <div class="email-message">${emailBody.replace(/\n/g, '<br>')}</div>
        </body>
        </html>
      `;

      // Send email via mail-send edge function
      const senderEmail = 'noreply@tavarios.ca';
      const emailPayload = {
        businessId: effectiveBusinessId,
        campaignId: `pay-statement-${entry.user_id}-${Date.now()}`,
        contactId: `pay-statement-${recipientEmail}`,
        emailType: 'transactional',
        to: recipientEmail,
        fromEmail: senderEmail,
        fromName: emailConfig.fromName,
        subject: emailSubject,
        html: emailHTML,
        text: emailBody,
        sourceModule: 'hr',
        sourceId: `payroll-entry:${entry.id}`,
        attachments: [{
          filename: `Pay Statement - ${entry.users.first_name} ${entry.users.last_name} - ${formattedDate}.pdf`,
          content: pdfBase64,
          contentType: 'application/pdf'
        }]
      };

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mail-send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(emailPayload)
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(errorBody || 'Failed to send email');
      }

      const data = await response.json();
      if (!data?.ok) {
        throw new Error(data?.error || 'Failed to send email');
      }

      toast.success(`Pay statement emailed to ${recipientEmail}`);
      
    } catch (error) {
      console.error('Error sending pay statement email:', error);
      toast.error('Failed to send email: ' + (error.message || 'Unknown error'));
      await logSecurityEvent('pay_statement_email_error', {
        business_id: effectiveBusinessId,
        employee_id: entry.user_id,
        error: error.message
      }, 'high');
    } finally {
      setSendingEmail(false);
    }
  };

  const bulkSendPayStatementEmails = async () => {
    if (selectedEmployees.size === 0) {
      toast.error('Please select employees to email statements to');
      return;
    }

    if (!emailConfig) {
      toast.error('Please configure email settings first');
      openEmailModal();
      return;
    }

    const selectedEntries = payrollEntries.filter(entry => 
      selectedEmployees.has(entry.id) && entry.users?.email
    );

    if (selectedEntries.length === 0) {
      toast.error('No employees with email addresses selected');
      return;
    }

    setSendingEmail(true);
    try {
      for (let i = 0; i < selectedEntries.length; i++) {
        const entry = selectedEntries[i];
        toast.loading(`Sending email ${i + 1}/${selectedEntries.length} to ${entry.users.email}...`, { id: 'bulk-email' });
        await sendPayStatementEmail(entry);
        if (i < selectedEntries.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Rate limiting
        }
      }
      toast.dismiss('bulk-email');
      toast.success(`Sent ${selectedEntries.length} pay statement emails!`);
    } catch (error) {
      console.error('Bulk email error:', error);
      toast.error('Error sending emails: ' + error.message);
    } finally {
      setSendingEmail(false);
    }
  };

  const handleCustomEmailClick = (entry) => {
    setSelectedEntryForCustomEmail(entry);
    setCustomEmailAddress('');
    setShowCustomEmailModal(true);
  };

  const handleSendCustomEmail = async () => {
    if (!customEmailAddress.trim()) {
      toast.error('Please enter an email address');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customEmailAddress.trim())) {
      toast.error('Please enter a valid email address');
      return;
    }

    setShowCustomEmailModal(false);
    await sendPayStatementEmail(selectedEntryForCustomEmail, customEmailAddress.trim());
    setSelectedEntryForCustomEmail(null);
    setCustomEmailAddress('');
  };

  // REMOVED: generatePayStatementHTMLForEmail - now generating HTML inline in sendPayStatementEmail
  // This function is no longer used - HTML is generated directly in sendPayStatementEmail
  // Keeping this comment for reference
  const _unused_generatePayStatementHTMLForEmail = async (entry, ytdTotals, ytdCalculationTime = 0) => {
    // EXACT SAME CALCULATION LOGIC as generatePayStatementPDF
    // Parse premiums and wage breakdown
    let premiums = {};
    let currentPremiumPay = 0;
    try {
      premiums = typeof entry.premiums === 'string' ? 
        JSON.parse(entry.premiums) : (entry.premiums || {});
      
      Object.values(premiums).forEach(premium => {
        if (premium.total_pay) {
          currentPremiumPay += parseFloat(premium.total_pay);
        }
      });
    } catch (e) {
      console.warn('Error parsing premiums:', e);
      premiums = {};
    }

    // Parse wage breakdown if exists
    let wageBreakdown = [];
    let hasWageChange = false;
    try {
      if (entry.wage_breakdown) {
        wageBreakdown = typeof entry.wage_breakdown === 'string' ? 
          JSON.parse(entry.wage_breakdown) : entry.wage_breakdown;
        hasWageChange = Array.isArray(wageBreakdown) && wageBreakdown.length > 1;
      }
    } catch (e) {
      console.warn('Error parsing wage breakdown:', e);
    }

    // This function is unused - all logic moved to generatePayStatementHTMLContent
    // Keeping for reference only - should use generatePayStatementHTMLContent instead
    const regularHours = parseFloat(entry.regular_hours || 0);
    const overtimeHours = parseFloat(entry.overtime_hours || 0);
    const lieuHours = parseFloat(entry.lieu_hours || 0);
    const statHolidayHours = parseFloat(entry.stat_holiday_hours || 0);
    const totalCurrentHours = regularHours + overtimeHours + lieuHours + statHolidayHours;

    // Calculate wage-based earnings
    const baseWage = parseFloat(entry.users.wage || 0);
    
    // Use wage breakdown if available
    let regularEarnings = 0;
    let overtimeEarnings = 0;
    let lieuEarnings = 0;
    
    if (hasWageChange && wageBreakdown.length > 0) {
      // Calculate using wage breakdown
      wageBreakdown.forEach(period => {
        if (!period.is_lieu_payment) {
          regularEarnings += parseFloat(period.regular_pay || 0);
          overtimeEarnings += parseFloat(period.overtime_pay || 0);
        } else {
          lieuEarnings += parseFloat(period.lieu_pay || 0);
        }
      });
    } else {
      // Calculate using single wage
      regularEarnings = regularHours * baseWage;
      overtimeEarnings = overtimeHours * baseWage * 1.5;
      lieuEarnings = lieuHours * baseWage;
    }

    const statEarnings = statHolidayHours * baseWage * 1.5;
    const holidayEarnings = parseFloat(entry.holiday_pay || 0);

    // Create professional pay statement HTML - EXACT SAME AS generatePayStatementPDF
    const businessTimezoneForTitle = effectiveBusinessData?.timezone || 'America/Toronto';
    const payPeriodEndDateForTitle = new Date(selectedRun.pay_period_end + 'T12:00:00');
    const formattedDateForTitle = payPeriodEndDateForTitle.toLocaleDateString('en-CA', {
      timeZone: businessTimezoneForTitle
    });
    
    // EXACT SAME HTML as generatePayStatementPDF (just without the PDF instructions div)
    const payStatementHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Pay Statement - ${entry.users.first_name} ${entry.users.last_name} - ${formattedDateForTitle}</title>
        <meta charset="UTF-8">
        <style>
          @page { 
            size: letter; 
            margin: 0.2in;
            @top-center { content: "Pay Statement"; }
          }
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 4px;
            line-height: 1.2;
            color: #000;
            background-color: #fff;
            font-size: 12px;
          }
          .header {
            text-align: center;
            border-bottom: 1px solid ${TavariStyles.colors.primary};
            padding-bottom: 3px;
            margin-bottom: 6px;
          }
          .company-name {
            font-size: 16px;
            font-weight: bold;
            color: ${TavariStyles.colors.primary};
            margin-bottom: 2px;
          }
          .statement-title {
            font-size: 12px;
            margin: 3px 0;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .employee-info {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin: 6px 0;
            background: linear-gradient(135deg, ${TavariStyles.colors.gray50} 0%, ${TavariStyles.colors.gray100} 100%);
            padding: 6px;
            border-radius: 3px;
            border: 1px solid ${TavariStyles.colors.gray200};
            font-size: 11px;
          }
          .employee-info div {
            line-height: 1.3;
          }
          .employee-info strong {
            color: #000;
            font-weight: 600;
          }
          .pay-table {
            width: 100%;
            border-collapse: collapse;
            margin: 4px 0;
            font-size: 11px;
          }
          .pay-table th, .pay-table td {
            padding: 4px 6px;
            border: 1px solid #ddd;
            text-align: left;
            color: #000;
          }
          .pay-table th {
            background-color: #f5f5f5;
            font-weight: 600;
            color: #000;
            text-transform: uppercase;
            font-size: 10px;
            letter-spacing: 0.3px;
          }
          .pay-table td.number {
            text-align: right;
            font-family: 'Courier New', monospace;
            font-size: 11px;
            color: #000;
          }
          .pay-table .total-row {
            background-color: #f8f9fa;
            font-weight: bold;
            border-top: 2px solid #000;
          }
          .pay-table .net-pay-row {
            background-color: ${TavariStyles.colors.primary}20;
            font-weight: bold;
            font-size: 12px;
            border-top: 2px solid ${TavariStyles.colors.primary};
          }
          .premium-highlight {
            background-color: ${TavariStyles.colors.success}15;
          }
          .wage-change-notice {
            background-color: #fffbeb;
            border: 1px solid #f59e0b;
            border-radius: 3px;
            padding: 4px;
            margin: 4px 0;
            font-size: 10px;
            color: #92400e;
          }
          .footer {
            margin-top: 6px;
            font-size: 9px;
            color: #000;
            text-align: center;
            border-top: 1px solid ${TavariStyles.colors.gray300};
            padding-top: 4px;
          }
          .page-break-avoid {
            page-break-inside: avoid;
          }
          .compact-section {
            margin: 2px 0;
          }
          @media print {
            body { 
              margin: 0; 
              padding: 0; 
              font-size: 12px; 
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              background: white !important;
            }
            .page-break-avoid {
              page-break-inside: avoid;
            }
            .header {
              page-break-after: avoid;
            }
            .employee-info {
              page-break-after: avoid;
            }
            .pay-table {
              page-break-inside: avoid;
            }
            * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="employee-info compact-section">
          <div>
            <strong>Employee:</strong> ${entry.users.first_name} ${entry.users.last_name}<br>
            <strong>Employee ID:</strong> ${entry.user_id.slice(-8).toUpperCase()}<br>
            <strong>Email:</strong> ${entry.users.email || 'N/A'}<br>
            ${entry.users.hire_date ? `<strong>Hire Date:</strong> ${new Date(entry.users.hire_date + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })}<br>` : ''}
            <strong>Total YTD Hours:</strong> ${ytdTotalHours.toFixed(2)} hours<br>
          </div>
          <div>
            <strong>Pay Period:</strong> ${new Date(selectedRun.pay_period_start + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })} to ${new Date(selectedRun.pay_period_end + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })}<br>
            <strong>Pay Date:</strong> ${new Date(selectedRun.pay_date + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })}<br>
            <strong>Base Rate:</strong> $${formatTaxAmount(baseWage)}/hr<br>
            <strong>Last Wage Adjustment:</strong> N/A<br>
            <strong>Lieu Time Balance:</strong> ${parseFloat(entry.lieu_balance_after || 0).toFixed(2)} hours<br>
            ${Object.keys(premiums).length > 0 ? `<strong>Active Premiums:</strong> ${Object.keys(premiums).length}<br>` : ''}
          </div>
        </div>

        ${hasWageChange ? `
        <div class="wage-change-notice">
          <strong>⚠️ Wage Rate Change:</strong> Multiple rates used for accuracy.
        </div>
        ` : ''}

        <table class="pay-table compact-section page-break-avoid">
          <thead>
            <tr>
              <th>EARNINGS</th>
              <th>RATE</th>
              <th>HOURS</th>
              <th>THIS PERIOD</th>
              <th>YTD</th>
            </tr>
          </thead>
          <tbody>
            ${hasWageChange && wageBreakdown.length > 0 ? `
              ${wageBreakdown.filter(p => !p.is_lieu_payment).map((period, idx) => `
                <tr>
                  <td>Regular Wage (${period.period})</td>
                  <td class="number">$${formatTaxAmount(period.wage)}</td>
                  <td class="number">${period.regular_hours.toFixed(2)}</td>
                  <td class="number">$${formatTaxAmount(period.regular_pay)}</td>
                  <td class="number">${idx === 0 ? '$' + formatTaxAmount(finalYTDTotals.regular_earnings) : ''}</td>
                </tr>
              `).join('')}
            ` : `
              <tr>
                <td>Regular Wage</td>
                <td class="number">$${formatTaxAmount(baseWage)}</td>
                <td class="number">${regularHours.toFixed(2)}</td>
                <td class="number">$${formatTaxAmount(regularEarnings)}</td>
                <td class="number">$${formatTaxAmount(finalYTDTotals.regular_earnings)}</td>
              </tr>
            `}
            ${Object.keys(premiums).length > 0 ? Object.entries(premiums).map(([name, details]) => `
              <tr class="premium-highlight">
                <td>${name}</td>
                <td class="number">$${formatTaxAmount(details.rate || 0)}</td>
                <td class="number">${parseFloat(details.hours || 0).toFixed(2)}</td>
                <td class="number">$${formatTaxAmount(details.total_pay || 0)}</td>
                <td class="number">$${formatTaxAmount(finalYTDTotals.shift_premiums)}</td>
              </tr>
            `).join('') : ''}
            ${overtimeHours > 0 ? `
            <tr>
              <td>Overtime</td>
              <td class="number">$${formatTaxAmount(baseWage * 1.5)}</td>
              <td class="number">${overtimeHours.toFixed(2)}</td>
              <td class="number">$${formatTaxAmount(overtimeEarnings)}</td>
              <td class="number">$${formatTaxAmount(finalYTDTotals.overtime_earnings)}</td>
            </tr>
            ` : ''}
            ${lieuHours > 0 ? `
            <tr>
              <td>Lieu Hours</td>
              <td class="number">${hasWageChange ? 'Varied' : '$' + formatTaxAmount(baseWage)}</td>
              <td class="number">${lieuHours.toFixed(2)}</td>
              <td class="number">$${formatTaxAmount(lieuEarnings)}</td>
              <td class="number">$${formatTaxAmount(finalYTDTotals.lieu_earnings)}</td>
            </tr>
            ` : ''}
            ${statHolidayHours > 0 ? `
            <tr>
              <td>Stat Worked</td>
              <td class="number">$${formatTaxAmount(baseWage * 1.5)}</td>
              <td class="number">${statHolidayHours.toFixed(2)}</td>
              <td class="number">$${formatTaxAmount(statEarnings)}</td>
              <td class="number">$${formatTaxAmount(finalYTDTotals.stat_earnings)}</td>
            </tr>
            ` : ''}
            ${holidayEarnings > 0 ? `
            <tr>
              <td>Holiday Pay</td>
              <td class="number">$${formatTaxAmount(baseWage)}</td>
              <td class="number">0.00</td>
              <td class="number">$${formatTaxAmount(holidayEarnings)}</td>
              <td class="number">$${formatTaxAmount(finalYTDTotals.holiday_earnings)}</td>
            </tr>
            ` : ''}
            <tr>
              <td>Vacation</td>
              <td class="number">-</td>
              <td class="number">-</td>
              <td class="number">$${formatTaxAmount(currentVacationPay)}</td>
              <td class="number">$${formatTaxAmount(finalYTDTotals.vacation_pay)}</td>
            </tr>
            <tr class="total-row">
              <td><strong>Gross Pay</strong></td>
              <td class="number">-</td>
              <td class="number"><strong>${totalCurrentHours.toFixed(2)}</strong></td>
              <td class="number"><strong>$${formatTaxAmount(totalGrossWithVacation)}</strong></td>
              <td class="number"><strong>$${formatTaxAmount(ytdGrossPay)}</strong></td>
            </tr>
          </tbody>
        </table>

        <table class="pay-table compact-section page-break-avoid">
          <thead>
            <tr>
              <th>DEDUCTIONS</th>
              <th>THIS PERIOD</th>
              <th>YTD</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Federal Tax</td>
              <td class="number">$${formatTaxAmount(parseFloat(entry.federal_tax || 0))}</td>
              <td class="number">$${formatTaxAmount(finalYTDTotals.federal_tax)}</td>
            </tr>
            <tr>
              <td>Provincial Tax</td>
              <td class="number">$${formatTaxAmount(parseFloat(entry.provincial_tax || 0))}</td>
              <td class="number">$${formatTaxAmount(finalYTDTotals.provincial_tax)}</td>
            </tr>
            <tr>
              <td>CPP</td>
              <td class="number">$${formatTaxAmount(parseFloat(entry.cpp_deduction || 0))}</td>
              <td class="number">$${formatTaxAmount(finalYTDTotals.cpp_deduction)}</td>
            </tr>
            <tr>
              <td>EI</td>
              <td class="number">$${formatTaxAmount(parseFloat(entry.ei_deduction || 0))}</td>
              <td class="number">$${formatTaxAmount(finalYTDTotals.ei_deduction)}</td>
            </tr>
            ${currentAdditionalTax > 0 ? `
            <tr>
              <td>Additional Tax</td>
              <td class="number">$${formatTaxAmount(currentAdditionalTax)}</td>
              <td class="number">$${formatTaxAmount(finalYTDTotals.additional_tax)}</td>
            </tr>
            ` : ''}
            <tr class="total-row">
              <td><strong>Total Deductions</strong></td>
              <td class="number"><strong>$${formatTaxAmount(totalCurrentDeductions)}</strong></td>
              <td class="number"><strong>$${formatTaxAmount(totalYTDDeductions)}</strong></td>
            </tr>
            <tr class="net-pay-row">
              <td><strong>NET PAY</strong></td>
              <td class="number"><strong>$${formatTaxAmount(parseFloat(entry.net_pay || 0))}</strong></td>
              <td class="number"><strong>$${formatTaxAmount(finalYTDTotals.net_pay)}</strong></td>
            </tr>
          </tbody>
        </table>

        <div class="footer">
          <p><strong>This pay statement was generated electronically by Tavari HR Payroll System.</strong></p>
          <p>Generated by: ${authUser?.email || 'System'} | Business: ${effectiveBusinessData?.name || 'N/A'} | ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</p>
          <p>YTD Calculation: Fast lookup (${ytdCalculationTime}ms) | Source: ${finalYTDTotals._ytd_source || 'standard'}</p>
        </div>
      </body>
      </html>
    `;
    
    return payStatementHTML;
  };

  const bulkDownloadStatements = async () => {
    if (selectedEmployees.size === 0) {
      alert('Please select employees to download statements for');
      return;
    }

    setBulkDownloading(true);
    
    const selectedEntries = payrollEntries.filter(entry => 
      selectedEmployees.has(entry.id)
    );

    try {
      console.log(`🚀 Starting bulk download for ${selectedEntries.length} employees with YTD integration`);
      
      for (let i = 0; i < selectedEntries.length; i++) {
        const entry = selectedEntries[i];
        
        console.log(`📄 Generating statement ${i + 1}/${selectedEntries.length} for ${entry.users.first_name} ${entry.users.last_name}`);
        
        await generatePayStatementPDF(entry, false);
        
        if (i < selectedEntries.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      alert(`Generated ${selectedEntries.length} pay statements with fast YTD calculations!`);
      
    } catch (error) {
      console.error('Bulk download error:', error);
      alert('Error generating statements: ' + error.message);
    } finally {
      setBulkDownloading(false);
    }
  };

  const downloadCheckAmounts = async () => {
    if (selectedEmployees.size === 0) {
      alert('Please select employees to generate check amounts for');
      return;
    }

    try {
      const selectedEntries = payrollEntries.filter(entry => 
        selectedEmployees.has(entry.id)
      );
      
      console.log(`🚀 Generating check amounts report for ${selectedEntries.length} employees`);

      // Generate check amounts report HTML
      const checkAmountsHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Check Amounts Report - ${effectiveBusinessData?.name || 'Company'}</title>
          <meta charset="UTF-8">
          <style>
            @page { size: letter; margin: 0.5in; }
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              margin: 0;
              padding: 20px;
              line-height: 1.4;
              color: #000;
              background-color: #fff;
              font-size: 12px;
            }
            .header {
              text-align: center;
              border-bottom: 2px solid ${TavariStyles.colors.primary};
              padding-bottom: 15px;
              margin-bottom: 20px;
            }
            .company-name {
              font-size: 16px;
              font-weight: bold;
              color: ${TavariStyles.colors.primary};
              margin-bottom: 5px;
            }
            .report-title {
              font-size: 12px;
              margin: 8px 0;
              font-weight: bold;
              text-transform: uppercase;
              letter-spacing: 0.8px;
            }
            .report-info {
              background: #f8f9fa;
              padding: 15px;
              border-radius: 8px;
              border: 1px solid #e9ecef;
              margin-bottom: 20px;
              font-size: 11px;
            }
            .check-table {
              width: 100%;
              border-collapse: collapse;
              margin: 20px 0;
              font-size: 11px;
            }
            .check-table th, .check-table td {
              padding: 12px 8px;
              border: 1px solid #ddd;
              text-align: left;
            }
            .check-table th {
              background-color: ${TavariStyles.colors.primary};
              color: white;
              font-weight: bold;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .check-table .amount {
              text-align: right;
              font-family: monospace;
              font-weight: bold;
            }
            .check-table .employee-name {
              font-weight: 600;
            }
            .total-row {
              background-color: #f8f9fa;
              font-weight: bold;
              border-top: 2px solid ${TavariStyles.colors.primary};
            }
            .total-row .amount {
              font-size: 10px;
              color: ${TavariStyles.colors.primary};
            }
            .footer {
              margin-top: 30px;
              padding-top: 15px;
              border-top: 1px solid #ddd;
              font-size: 11px;
              color: #333;
              text-align: center;
            }
            @media print {
              body { margin: 0; padding: 0; }
              @page { size: letter; margin: 0.5in; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="company-name">${effectiveBusinessData?.name || 'Company Name'}</div>
            <div class="report-title">Check Amounts Report</div>
          </div>

          <div class="report-info">
            <strong>Pay Period:</strong> ${new Date(selectedRun.pay_period_start + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })} to ${new Date(selectedRun.pay_period_end + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })}<br>
            <strong>Pay Date:</strong> ${new Date(selectedRun.pay_date + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })}<br>
            <strong>Total Employees:</strong> ${selectedEntries.length}<br>
            <strong>Generated:</strong> ${new Date().toLocaleDateString('en-CA', { timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })} at ${new Date().toLocaleTimeString('en-CA', { timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })}
          </div>

          <table class="check-table">
            <thead>
              <tr>
                <th style="width: 60%;">Employee Name</th>
                <th style="width: 40%;">Net Pay Amount</th>
              </tr>
            </thead>
            <tbody>
              ${selectedEntries.map(entry => `
                <tr>
                  <td class="employee-name">${entry.users.first_name} ${entry.users.last_name}</td>
                  <td class="amount">$${formatTaxAmount(parseFloat(entry.net_pay || 0))}</td>
                </tr>
              `).join('')}
              <tr class="total-row">
                <td><strong>TOTAL PAYROLL AMOUNT</strong></td>
                <td class="amount">$${formatTaxAmount(selectedEntries.reduce((sum, entry) => sum + parseFloat(entry.net_pay || 0), 0))}</td>
              </tr>
            </tbody>
          </table>

          <div class="footer">
            <p><strong>This check amounts report was generated electronically by Tavari HR Payroll System.</strong></p>
            <p>Generated by: ${authUser?.email || 'System'} | Business: ${effectiveBusinessData?.name || 'N/A'} | ${new Date().toLocaleDateString('en-CA', { timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })} ${new Date().toLocaleTimeString('en-CA', { timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })}</p>
          </div>
        </body>
        </html>
      `;

      // Generate filename with end date
      const payPeriodEnd = new Date(selectedRun.pay_period_end + 'T12:00:00');
      const formattedDate = payPeriodEnd.toLocaleDateString('en-CA', {
        timeZone: effectiveBusinessData?.timezone || 'America/Toronto'
      });
      const filename = `Check Amounts Report - ${formattedDate}`;

      // Create downloadable HTML file
      const blob = new Blob([checkAmountsHTML], { 
        type: 'text/html;charset=utf-8' 
      });
      
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename + '.html';
      link.style.display = 'none';
      
      document.body.appendChild(link);
      link.click();
      
      // Cleanup
      setTimeout(() => {
        if (document.body.contains(link)) {
          document.body.removeChild(link);
        }
        URL.revokeObjectURL(url);
      }, 1000);

      console.log(`✅ Check amounts report generated for ${selectedEntries.length} employees`);
      alert(`Successfully generated check amounts report for ${selectedEntries.length} employees!`);

    } catch (error) {
      console.error('Check amounts report error:', error);
      alert('Error generating check amounts report: ' + error.message);
    }
  };

  const generateSelectedStatements = async () => {
    if (selectedEmployees.size === 0) {
      alert('Please select employees to generate statements for');
      return;
    }

    const rateLimitCheck = await checkRateLimit('bulk_pay_statement_generation', authUser?.id);
    if (!rateLimitCheck.allowed) {
      alert('Rate limit exceeded for bulk generation. Please wait before trying again.');
      return;
    }

    setGenerating(true);
    try {
      await recordAction('bulk_pay_statement_generation', authUser?.id, true);
      
      const selectedEntries = payrollEntries.filter(entry => 
        selectedEmployees.has(entry.id)
      );

      console.log(`🚀 Generating ${selectedEntries.length} statements with fast YTD calculations`);

      for (let i = 0; i < selectedEntries.length; i++) {
        const entry = selectedEntries[i];
        await new Promise(resolve => {
          generatePayStatementPDF(entry, true);
          setTimeout(resolve, 1500);
        });
      }
      
      alert(`Generated ${selectedEntries.length} pay statements with improved YTD performance!`);
      
    } catch (error) {
      console.error('Error generating selected statements:', error);
      await recordAction('bulk_pay_statement_generation', authUser?.id, false);
      alert('Error generating statements: ' + error.message);
    } finally {
      setGenerating(false);
    }
  };

  const toggleEmployeeSelection = (entryId) => {
    setSelectedEmployees(prev => {
      const newSet = new Set(prev);
      if (newSet.has(entryId)) {
        newSet.delete(entryId);
      } else {
        newSet.add(entryId);
      }
      return newSet;
    });
  };

  const selectAllEmployees = () => {
    if (selectedEmployees.size === payrollEntries.length) {
      setSelectedEmployees(new Set());
    } else {
      setSelectedEmployees(new Set(payrollEntries.map(entry => entry.id)));
    }
  };

  const calculateEntryPremiumPay = (entry) => {
    try {
      const premiums = typeof entry.premiums === 'string' ? 
        JSON.parse(entry.premiums) : (entry.premiums || {});
      
      let total = 0;
      Object.values(premiums).forEach(premium => {
        if (premium.total_pay) {
          total += parseFloat(premium.total_pay);
        }
      });
      return total;
    } catch (e) {
      return 0;
    }
  };

  const styles = {
    container: {
      padding: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.gray50,
      minHeight: '100vh'
    },
    section: {
      marginBottom: TavariStyles.spacing.lg,
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.lg,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      border: `1px solid ${TavariStyles.colors.gray200}`,
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)'
    },
    sectionTitle: {
      fontSize: TavariStyles.typography.fontSize.xl,
      fontWeight: TavariStyles.typography.fontWeight.bold,
      marginBottom: TavariStyles.spacing.md,
      color: TavariStyles.colors.gray800
    },
    select: {
      ...TavariStyles.components.form?.select || {
        padding: '12px 16px',
        border: `1px solid ${TavariStyles.colors.gray300}`,
        borderRadius: TavariStyles.borderRadius?.md || '6px',
        fontSize: TavariStyles.typography.fontSize.sm,
        backgroundColor: TavariStyles.colors.white,
        cursor: 'pointer'
      },
      width: '100%',
      maxWidth: '400px',
      marginBottom: TavariStyles.spacing.md
    },
    button: {
      ...TavariStyles.components.button?.base || {
        padding: '12px 20px',
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
      },
      marginRight: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.sm
    },
    secondaryButton: {
      ...TavariStyles.components.button?.base || {
        padding: '12px 20px',
        borderRadius: TavariStyles.borderRadius?.md || '6px',
        border: 'none',
        fontSize: TavariStyles.typography.fontSize.sm,
        fontWeight: TavariStyles.typography.fontWeight.semibold,
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      },
      ...TavariStyles.components.button?.variants?.secondary || {
        backgroundColor: TavariStyles.colors.gray100,
        color: TavariStyles.colors.gray700,
        border: `1px solid ${TavariStyles.colors.gray300}`
      },
      marginRight: TavariStyles.spacing.sm,
      marginBottom: TavariStyles.spacing.sm
    },
    disabledButton: {
      opacity: 0.6,
      cursor: 'not-allowed'
    },
    buttonGroup: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: TavariStyles.spacing.sm,
      alignItems: 'center'
    },
    table: {
      ...TavariStyles.components.table?.table || {
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: TavariStyles.typography.fontSize.sm
      },
      marginTop: TavariStyles.spacing.md
    },
    th: {
      ...TavariStyles.components.table?.th || {
        padding: TavariStyles.spacing.md,
        textAlign: 'left',
        fontWeight: TavariStyles.typography.fontWeight.semibold,
        color: TavariStyles.colors.gray700,
        fontSize: TavariStyles.typography.fontSize.sm,
        backgroundColor: TavariStyles.colors.gray50,
        borderBottom: `2px solid ${TavariStyles.colors.gray200}`
      },
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white
    },
    td: {
      ...TavariStyles.components.table?.td || {
        padding: TavariStyles.spacing.md,
        borderBottom: `1px solid ${TavariStyles.colors.gray100}`,
        verticalAlign: 'middle'
      }
    },
    employeeName: {
      fontWeight: TavariStyles.typography.fontWeight.semibold,
      color: TavariStyles.colors.gray800
    },
    employeeDetails: {
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray600
    },
    amountCell: {
      textAlign: 'right',
      fontWeight: TavariStyles.typography.fontWeight.medium,
      fontFamily: 'monospace'
    },
    premiumCell: {
      textAlign: 'right',
      fontWeight: TavariStyles.typography.fontWeight.medium,
      fontFamily: 'monospace',
      color: TavariStyles.colors.success
    },
    loadingText: {
      textAlign: 'center',
      color: TavariStyles.colors.gray600,
      fontSize: TavariStyles.typography.fontSize.lg,
      padding: TavariStyles.spacing.xl
    },
    emptyState: {
      textAlign: 'center',
      color: TavariStyles.colors.gray500,
      padding: TavariStyles.spacing.xl
    },
    selectedRow: {
      backgroundColor: TavariStyles.colors.primary + '08'
    },
    ytdStatus: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.xs,
      marginTop: TavariStyles.spacing.sm,
      fontSize: TavariStyles.typography.fontSize.sm,
      color: ytd.loading ? TavariStyles.colors.warning : TavariStyles.colors.success
    }
  };

  if (loading) {
    return (
      <POSAuthWrapper
        componentName="PayStatementsTab"
        requiredRoles={['owner', 'manager', 'hr_admin']}
        requireBusiness={true}
      >
        <SecurityWrapper
          componentName="PayStatementsTab"
          securityLevel="critical"
          enableAuditLogging={true}
          sensitiveComponent={true}
        >
          <div style={styles.container}>
            <div style={styles.loadingText}>Loading pay statements...</div>
          </div>
        </SecurityWrapper>
      </POSAuthWrapper>
    );
  }

  return (
    <POSAuthWrapper
      componentName="PayStatementsTab"
      requiredRoles={['owner', 'manager', 'hr_admin']}
      requireBusiness={true}
    >
      <SecurityWrapper
        componentName="PayStatementsTab"
        securityLevel="critical"
        enableAuditLogging={true}
        sensitiveComponent={true}
      >
        <div style={styles.container}>
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Select Payroll Run</h3>
            
            <div style={styles.ytdStatus}>
              {ytd.loading ? (
                <>⏳ YTD system initializing...</>
              ) : (
                <>✅ Fast YTD calculations enabled - Pay statements will generate much faster!</>
              )}
            </div>

            {payrollRuns.length > 0 ? (
              <>
                <select
                  style={styles.select}
                  value={selectedRun?.id || ''}
                  onChange={(e) => {
                    const run = payrollRuns.find(r => r.id === e.target.value);
                    setSelectedRun(run);
                    if (run) loadPayrollEntries(run.id);
                  }}
                >
                  <option value="">Select a payroll run...</option>
                  {payrollRuns.map(run => {
                    const formatDateWithDay = (dateString) => {
                      const date = new Date(dateString + 'T12:00:00');
                      const tz = effectiveBusinessData?.timezone || 'America/Toronto';
                      const formattedDate = date.toLocaleDateString('en-CA', { 
                        timeZone: tz,
                        weekday: 'short',
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      });
                      return formattedDate;
                    };
                    return (
                      <option key={run.id} value={run.id}>
                        {formatDateWithDay(run.pay_period_start)} to {formatDateWithDay(run.pay_period_end)} (Pay: {formatDateWithDay(run.pay_date)})
                      </option>
                    );
                  })}
                </select>

                {selectedRun && (
                  <button
                    style={{
                      ...styles.button,
                      backgroundColor: '#dc2626',
                      color: 'white',
                      marginLeft: '12px',
                      ...(deletingRun ? styles.disabledButton : {})
                    }}
                    onClick={handleDeletePayrollRun}
                    disabled={deletingRun}
                    title="Delete this entire payroll run and all associated entries"
                  >
                    {deletingRun ? 'Deleting...' : 'Delete Payroll Run'}
                  </button>
                )}

                {selectedRun && payrollEntries.length > 0 && (
                  <div style={styles.buttonGroup}>
                    <button
                      style={{
                        ...styles.secondaryButton,
                        ...(generating || bulkDownloading ? styles.disabledButton : {})
                      }}
                      onClick={selectAllEmployees}
                      disabled={generating || bulkDownloading}
                    >
                      {selectedEmployees.size === payrollEntries.length ? 'Deselect All' : 'Select All'}
                    </button>
                    <button
                      style={{
                        ...styles.button,
                        ...(generating || selectedEmployees.size === 0 ? styles.disabledButton : {})
                      }}
                      onClick={generateSelectedStatements}
                      disabled={generating || selectedEmployees.size === 0}
                    >
                      {generating ? 'Generating...' : `Generate Selected (${selectedEmployees.size})`}
                    </button>
                    <button
                      style={{
                        ...styles.button,
                        ...(bulkDownloading || selectedEmployees.size === 0 ? styles.disabledButton : {})
                      }}
                      onClick={bulkDownloadStatements}
                      disabled={bulkDownloading || selectedEmployees.size === 0}
                    >
                      {bulkDownloading ? 'Bulk Download...' : `Fast Bulk Download (${selectedEmployees.size})`}
                    </button>
                    <button
                      style={{
                        ...styles.button,
                        ...(bulkDownloading || selectedEmployees.size === 0 ? styles.disabledButton : {})
                      }}
                      onClick={downloadCheckAmounts}
                      disabled={bulkDownloading || selectedEmployees.size === 0}
                    >
                      Download Check Amounts
                    </button>
                    <button
                      style={{
                        ...styles.secondaryButton,
                        ...(sendingEmail || selectedEmployees.size === 0 ? styles.disabledButton : {})
                      }}
                      onClick={openEmailModal}
                      disabled={sendingEmail || selectedEmployees.size === 0}
                      title="Configure email settings"
                    >
                      📧 Configure Email
                    </button>
                    <button
                      style={{
                        ...styles.button,
                        ...(sendingEmail || selectedEmployees.size === 0 || !emailConfig ? styles.disabledButton : {})
                      }}
                      onClick={bulkSendPayStatementEmails}
                      disabled={sendingEmail || selectedEmployees.size === 0 || !emailConfig}
                    >
                      {sendingEmail ? 'Sending Emails...' : `📧 Email Selected (${selectedEmployees.size})`}
                    </button>
                    <span style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray600 }}>
                      {selectedEmployees.size} of {payrollEntries.length} selected
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div style={styles.emptyState}>
                <p>No finalized payroll runs found.</p>
                <p>Complete a payroll run in the Payroll Entry tab first.</p>
              </div>
            )}
          </div>

          {selectedRun && payrollEntries.length > 0 && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>
                Pay Statements for {new Date(selectedRun.pay_period_start + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })} to {new Date(selectedRun.pay_period_end + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })}
                <span style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.success, marginLeft: TavariStyles.spacing.md }}>
                  ⚡ Fast YTD Mode
                </span>
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>
                        <TavariCheckbox
                          checked={selectedEmployees.size === payrollEntries.length}
                          onChange={selectAllEmployees}
                          label=""
                        />
                      </th>
                      <th style={styles.th}>Employee</th>
                      <th style={styles.th}>Regular Hours</th>
                      <th style={styles.th}>Overtime Hours</th>
                      <th style={styles.th}>Premium Pay</th>
                      <th style={styles.th}>Gross Pay</th>
                      <th style={styles.th}>Deductions</th>
                      <th style={styles.th}>Net Pay</th>
                      <th style={styles.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payrollEntries
                      .filter(entry => entry.users !== null && entry.users !== undefined)
                      .map(entry => {
                        // CRITICAL FIX: federal_tax is now saved as BASE (without additionalTax)
                        // So we need to add federal_tax + additional_tax together
                        // OHP is already included in provincial_tax, so don't add ontario_health_premium
                        const federalTaxBase = parseFloat(entry.federal_tax || 0);
                        const additionalTax = parseFloat(entry.additional_tax || 0);
                        const provincialTax = parseFloat(entry.provincial_tax || 0);
                        const eiDeduction = parseFloat(entry.ei_deduction || 0);
                        const cppDeduction = parseFloat(entry.cpp_deduction || 0);
                        const totalDeductions = (federalTaxBase + additionalTax) + provincialTax + eiDeduction + cppDeduction;

                        // DEBUG: Log what we're displaying
                        console.log('[PayStatementsTab] DISPLAYING DEDUCTIONS:', {
                          entryId: entry.id,
                          federalTaxBase,
                          additionalTax,
                          totalFederalTax: federalTaxBase + additionalTax,
                          provincialTax,
                          eiDeduction,
                          cppDeduction,
                          totalDeductions,
                          entryNetPay: entry.net_pay
                        });

                        const premiumPay = calculateEntryPremiumPay(entry);
                        const isSelected = selectedEmployees.has(entry.id);

                        return (
                          <tr 
                            key={entry.id}
                            style={isSelected ? styles.selectedRow : {}}
                          >
                            <td style={styles.td}>
                              <TavariCheckbox
                                checked={isSelected}
                                onChange={() => toggleEmployeeSelection(entry.id)}
                                label=""
                              />
                            </td>
                            <td style={styles.td}>
                              <div style={styles.employeeName}>
                                {entry.users.first_name} {entry.users.last_name}
                              </div>
                              <div style={styles.employeeDetails}>
                                {entry.users.email}
                              </div>
                            </td>
                            <td style={{...styles.td, ...styles.amountCell}}>
                              {parseFloat(entry.regular_hours || 0).toFixed(2)}
                            </td>
                            <td style={{...styles.td, ...styles.amountCell}}>
                              {parseFloat(entry.overtime_hours || 0).toFixed(2)}
                            </td>
                            <td style={{...styles.td, ...styles.premiumCell}}>
                              {premiumPay > 0 ? `$${formatTaxAmount(premiumPay)}` : '-'}
                            </td>
                            <td style={{...styles.td, ...styles.amountCell}}>
                              ${formatTaxAmount(parseFloat(entry.gross_pay || 0) + parseFloat(entry.vacation_pay || 0))}
                            </td>
                            <td style={{...styles.td, ...styles.amountCell}}>
                              ${formatTaxAmount(totalDeductions)}
                            </td>
                            <td style={{...styles.td, ...styles.amountCell}}>
                              <strong>${formatTaxAmount(parseFloat(entry.net_pay || 0))}</strong>
                            </td>
                            <td style={styles.td}>
                              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <button
                                  style={{
                                    ...styles.button,
                                    ...(generating || bulkDownloading ? styles.disabledButton : {}),
                                    margin: 0,
                                    fontSize: TavariStyles.typography.fontSize.xs,
                                    padding: '8px 12px'
                                  }}
                                  onClick={() => generatePayStatementPDF(entry)}
                                  disabled={generating || bulkDownloading}
                                  title="Generate with fast YTD calculations"
                                >
                                  ⚡ Fast PDF
                                </button>
                                {entry.users?.email && (
                                  <>
                                    <button
                                      style={{
                                        ...styles.secondaryButton,
                                        ...(sendingEmail || !emailConfig ? styles.disabledButton : {}),
                                        margin: 0,
                                        fontSize: TavariStyles.typography.fontSize.xs,
                                        padding: '8px 12px'
                                      }}
                                      onClick={() => sendPayStatementEmail(entry)}
                                      disabled={sendingEmail || !emailConfig}
                                      title={!emailConfig ? 'Configure email settings first' : `Email to ${entry.users.email}`}
                                    >
                                      📧 Email
                                    </button>
                                    <button
                                      style={{
                                        ...styles.secondaryButton,
                                        ...(sendingEmail || !emailConfig ? styles.disabledButton : {}),
                                        margin: 0,
                                        marginLeft: '4px',
                                        fontSize: TavariStyles.typography.fontSize.xs,
                                        padding: '8px 12px'
                                      }}
                                      onClick={() => handleCustomEmailClick(entry)}
                                      disabled={sendingEmail || !emailConfig}
                                      title={!emailConfig ? 'Configure email settings first' : 'Email to custom address'}
                                    >
                                      📮 Custom Email
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    }
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {selectedRun && payrollEntries.length === 0 && (
            <div style={styles.section}>
              <div style={styles.emptyState}>
                <p>No pay entries found for selected payroll run.</p>
              </div>
            </div>
          )}

          <YTDDetailModal
            isOpen={showYTDModal}
            onClose={() => setShowYTDModal(false)}
            employee={selectedYTDEmployee?.employee}
            ytdData={selectedYTDEmployee?.ytdData}
            formatAmount={formatTaxAmount}
            allowEdit={false}
          />

          <PayStatementEmailModal
            isOpen={showEmailModal}
            onClose={() => setShowEmailModal(false)}
            onSave={handleEmailConfigSave}
            defaultSubject={emailConfig?.subject}
            defaultBody={emailConfig?.body}
            defaultFromName={emailConfig?.fromName}
          />

          {/* Custom Email Modal */}
          {showCustomEmailModal && (
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000
            }}>
              <div style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '30px',
                maxWidth: '500px',
                width: '90%',
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
              }}>
                <h2 style={{
                  fontSize: '12px',
                  fontWeight: '600',
                  color: TavariStyles.colors.gray900,
                  marginBottom: '20px'
                }}>
                  Send Pay Statement to Custom Email
                </h2>
                
                {selectedEntryForCustomEmail && (
                  <div style={{
                    marginBottom: '20px',
                    padding: '12px',
                    backgroundColor: TavariStyles.colors.gray50,
                    borderRadius: '8px'
                  }}>
                    <p style={{ margin: 0, fontSize: '10px', color: TavariStyles.colors.gray700 }}>
                      <strong>Employee:</strong> {selectedEntryForCustomEmail.users?.first_name} {selectedEntryForCustomEmail.users?.last_name}
                    </p>
                    <p style={{ margin: '4px 0 0 0', fontSize: '9px', color: TavariStyles.colors.gray700 }}>
                      <strong>Default Email:</strong> {selectedEntryForCustomEmail.users?.email || 'N/A'}
                    </p>
                  </div>
                )}

                <div style={{ marginBottom: '20px' }}>
                  <label style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: TavariStyles.colors.gray700,
                    marginBottom: '8px'
                  }}>
                    Email Address *
                  </label>
                  <input
                    type="email"
                    value={customEmailAddress}
                    onChange={(e) => setCustomEmailAddress(e.target.value)}
                    placeholder="Enter email address"
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: `1px solid ${TavariStyles.colors.gray300}`,
                      borderRadius: '8px',
                      fontSize: '12px',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        handleSendCustomEmail();
                      }
                    }}
                    autoFocus
                  />
                </div>

                <div style={{
                  display: 'flex',
                  gap: '12px',
                  justifyContent: 'flex-end'
                }}>
                  <button
                    onClick={() => {
                      setShowCustomEmailModal(false);
                      setSelectedEntryForCustomEmail(null);
                      setCustomEmailAddress('');
                    }}
                    style={{
                      padding: '10px 20px',
                      border: `1px solid ${TavariStyles.colors.gray300}`,
                      borderRadius: '8px',
                      backgroundColor: 'white',
                      color: TavariStyles.colors.gray700,
                      fontSize: '20px',
                      fontWeight: '500',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSendCustomEmail}
                    disabled={!customEmailAddress.trim() || sendingEmail}
                    style={{
                      padding: '10px 20px',
                      border: 'none',
                      borderRadius: '8px',
                      backgroundColor: sendingEmail || !customEmailAddress.trim() ? TavariStyles.colors.gray400 : TavariStyles.colors.primary,
                      color: 'white',
                      fontSize: '16px',
                      fontWeight: '500',
                      cursor: sendingEmail || !customEmailAddress.trim() ? 'not-allowed' : 'pointer',
                      opacity: sendingEmail || !customEmailAddress.trim() ? 0.6 : 1
                    }}
                  >
                    {sendingEmail ? 'Sending...' : 'Send Email'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default PayStatementsTab;