// PortalPayStatementDetail.jsx - Employee Portal Pay Statement Detail View
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useYTDCalculations } from '../../hooks/useYTDCalculations';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import { normalizeYTDTotals, addCurrentPeriodToPayStatementYtd } from '../../utils/payStatementYTD';
import { TavariStyles } from '../../utils/TavariStyles';
import { ArrowLeft, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { getPublicUserId } from '../../utils/getPublicUserId';
import { generatePayStatementHTMLContent } from '../../utils/generatePayStatementHTMLContent';
import { downloadPayStatementPdf } from '../../utils/payStatementPdf';
import { fetchLieuTimeForPayStatement } from '../../helpers/Payroll/fetchLieuTimeForPayStatement';
import {
  fetchLastWageAdjustmentForPayStatement,
  formatLastWageAdjustmentDisplay,
} from '../../helpers/Payroll/fetchLastWageAdjustmentForPayStatement';

const PortalPayStatementDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [entry, setEntry] = useState(null);
  const [payrollRun, setPayrollRun] = useState(null);
  const [ytdData, setYtdData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [businessId, setBusinessId] = useState(null);
  const [lastWageAdjustment, setLastWageAdjustment] = useState(null);

  const ytd = useYTDCalculations(businessId || '');
  const { formatTaxAmount } = useTaxCalculations(businessId || '');

  useEffect(() => {
    if (id) {
      loadPayStatement();
    }
  }, [id]);

  const loadPayStatement = async () => {
    try {
      setLoading(true);
      setError('');

      // Get current user
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        navigate('/portal/login');
        return;
      }

      // Get public.users.id (hrpayroll_entries.user_id references public.users.id, not auth.users.id)
      const publicUserId = await getPublicUserId(currentUser.email);
      if (!publicUserId) {
        setError('User profile not found');
        setLoading(false);
        return;
      }

      // Load payroll entry - ensure it belongs to the current user
      const { data: entryData, error: entryError } = await supabase
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
        .eq('id', id)
        .eq('user_id', publicUserId) // Security: only allow viewing own statements
        .maybeSingle();

      if (entryError) {
        console.error('Error loading pay statement:', entryError);
        setError('Failed to load pay statement: ' + entryError.message);
        setLoading(false);
        return;
      }

      if (!entryData) {
        setError('Pay statement not found or access denied.');
        setLoading(false);
        return;
      }

      setEntry(entryData);
      const payrollRunData = entryData.hrpayroll_runs;
      setPayrollRun(payrollRunData);
      
      // IMPORTANT: Use business_id from the payroll run, not the entry
      // This handles cases where entry.business_id is null but the run has the correct business_id
      const entryBusinessId = payrollRunData?.business_id || entryData.business_id;
      setBusinessId(entryBusinessId);

      try {
        const wageAdj = await fetchLastWageAdjustmentForPayStatement(
          supabase,
          entryData.user_id,
          entryBusinessId
        );
        setLastWageAdjustment(wageAdj);
      } catch {
        setLastWageAdjustment(null);
      }

      // Load YTD data
      try {
        const ytdEndDate = payrollRunData?.pay_period_end || payrollRunData?.pay_date;
        const businessTz = payrollRunData?.businesses?.timezone || 'America/Toronto';
        if (entryBusinessId && ytdEndDate && ytd?.calculateEmployeeYTD) {
          const rawYtd = await ytd.calculateEmployeeYTD(
            entryData.user_id,
            ytdEndDate,
            entryBusinessId,
            businessTz,
            { excludePayrollRunId: payrollRunData?.id || entryData.payroll_run_id }
          );
          setYtdData(addCurrentPeriodToPayStatementYtd(normalizeYTDTotals(rawYtd), entryData));
        } else {
          setYtdData(normalizeYTDTotals(null));
        }
      } catch (ytdError) {
        console.warn('Could not load YTD data:', ytdError);
        setYtdData(normalizeYTDTotals(null));
      }

      setLoading(false);
    } catch (err) {
      console.error('Error loading pay statement:', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  // Same pipeline as HR Payroll: shared HTML + browser print (Save as PDF)
  const handleDownloadPDF = async () => {
    if (!entry || !payrollRun || !formatTaxAmount) {
      toast.error('Cannot generate PDF - missing required data');
      return;
    }

    setDownloading(true);

    try {
      console.log('🚀 Portal PDF generation starting...');
      
      const businessData = payrollRun.businesses || {};

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
      
      console.log(`⚡ Portal YTD calculation completed in ${ytdCalculationTime}ms for ${entry.users.first_name} ${entry.users.last_name}`);

      const { data: { user: authUserForPdf } } = await supabase.auth.getUser();
      const generatedByLabel = authUserForPdf?.email
        ? `${authUserForPdf.email} (Employee Portal)`
        : 'Employee Portal';

      const lieuTime = await fetchLieuTimeForPayStatement(supabase, entry.user_id, effectiveBusinessId);
      const wageAdj =
        lastWageAdjustment ||
        (await fetchLastWageAdjustmentForPayStatement(supabase, entry.user_id, effectiveBusinessId));
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
        lastWageAdjustment: wageAdj,
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
    }
  };

  // Generate display HTML for showing in the component
  const generateDisplayHTML = () => {
    if (!entry || !payrollRun || !ytdData || !formatTaxAmount) return '';

    const businessData = payrollRun.businesses || {};
    const businessTimezone = businessData.timezone || 'America/Toronto';

    // Parse premiums
    let premiums = {};
    try {
      premiums = typeof entry.premiums === 'string' ? 
        JSON.parse(entry.premiums) : (entry.premiums || {});
    } catch {
      premiums = {};
    }

    // Parse wage breakdown
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

    const regularHours = parseFloat(entry.regular_hours || 0);
    const overtimeHours = parseFloat(entry.overtime_hours || 0);
    const lieuHours = parseFloat(entry.lieu_hours || 0);
    const statHolidayHours = parseFloat(entry.stat_holiday_hours || 0);
    const totalCurrentHours = regularHours + overtimeHours + lieuHours + statHolidayHours;

    const baseWage = parseFloat(entry.users?.wage || 0);
    const currentGrossPay = parseFloat(entry.gross_pay || 0);
    const currentVacationPay = parseFloat(entry.vacation_pay || 0);
    const totalGrossWithVacation = currentGrossPay + currentVacationPay;

    const currentFederalTax = parseFloat(entry.federal_tax || 0);
    const currentProvincialTax = parseFloat(entry.provincial_tax || 0);
    const currentEIDeduction = parseFloat(entry.ei_deduction || 0);
    const currentCPPDeduction = parseFloat(entry.cpp_deduction || 0);
    const currentAdditionalTax = parseFloat(entry.additional_tax || 0);
    
    // Add federal_tax (base) + additional_tax together
    // OHP is already included in provincial_tax, so don't add ontario_health_premium
    const totalCurrentDeductions = (currentFederalTax + currentAdditionalTax) + 
                                   currentProvincialTax + 
                                   currentEIDeduction + 
                                   currentCPPDeduction;

    const ytdGrossPay = ytdData.gross_pay + ytdData.vacation_pay;
    const totalYTDDeductions = 
      ytdData.federal_tax +
      ytdData.provincial_tax +
      ytdData.ei_deduction +
      ytdData.cpp_deduction +
      ytdData.additional_tax;

    return `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #333; line-height: 1.4;">
        <div style="text-align: center; border-bottom: 2px solid ${TavariStyles.colors.primary}; padding-bottom: 1rem; margin-bottom: 1.5rem;">
          <h1 style="color: ${TavariStyles.colors.primary}; margin: 0 0 0.5rem 0; font-size: 1.5rem;">${businessData?.name || 'Company Name'}</h1>
          <h2 style="margin: 0; font-size: 1.1rem; text-transform: uppercase; letter-spacing: 1px;">Employee Pay Statement</h2>
        </div>

        <div style="display: flex; flex-direction: column; gap: 1.25rem; margin-bottom: 2rem; background: linear-gradient(135deg, ${TavariStyles.colors.gray50} 0%, ${TavariStyles.colors.gray100} 100%); padding: 1.25rem; border-radius: 8px; border: 1px solid ${TavariStyles.colors.gray200}; box-sizing: border-box; width: 100%; max-width: 100%; overflow-wrap: anywhere;">
          <div style="min-width: 0;">
            <p style="margin: 0 0 0.5rem 0;"><strong>Employee:</strong> ${entry.users.first_name} ${entry.users.last_name}</p>
            <p style="margin: 0 0 0.5rem 0;"><strong>Email:</strong> ${entry.users.email || 'N/A'}</p>
            ${entry.users.hire_date ? `<p style="margin: 0;"><strong>Hire Date:</strong> ${new Date(entry.users.hire_date + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: businessTimezone })}</p>` : ''}
          </div>
          <div style="min-width: 0;">
            <p style="margin: 0 0 0.5rem 0;"><strong>Pay Period:</strong> ${new Date(payrollRun.pay_period_start + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: businessTimezone })} to ${new Date(payrollRun.pay_period_end + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: businessTimezone })}</p>
            <p style="margin: 0 0 0.5rem 0;"><strong>Pay Date:</strong> ${new Date(payrollRun.pay_date + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: businessTimezone })}</p>
            <p style="margin: 0 0 0.5rem 0;"><strong>Base Rate:</strong> $${formatTaxAmount(baseWage)}/hr</p>
            <p style="margin: 0 0 0.5rem 0;"><strong>Last Wage Adjustment:</strong> ${formatLastWageAdjustmentDisplay(lastWageAdjustment, formatTaxAmount, businessTimezone)}</p>
            <p style="margin: 0;"><strong>Lieu Time Balance:</strong> ${parseFloat(entry.lieu_balance_after || 0).toFixed(2)} hours</p>
          </div>
        </div>

        ${hasWageChange ? `
        <div style="background-color: #fffbeb; border: 1px solid #f59e0b; border-radius: 6px; padding: 1rem; margin-bottom: 1.5rem; color: #92400e;">
          <strong>⚠️ Wage Rate Change:</strong> Multiple rates used during this pay period for accuracy.
        </div>
        ` : ''}

        <div style="margin-bottom: 2rem;">
          <h3 style="color: ${TavariStyles.colors.primary}; margin-bottom: 1rem;">Earnings</h3>
          <table style="width: 100%; border-collapse: collapse; border: 1px solid ${TavariStyles.colors.gray300};">
            <thead>
              <tr style="background-color: ${TavariStyles.colors.primary}; color: white;">
                <th style="padding: 0.75rem; text-align: left; border: 1px solid ${TavariStyles.colors.gray300};">Description</th>
                <th style="padding: 0.75rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">Rate</th>
                <th style="padding: 0.75rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">Hours</th>
                <th style="padding: 0.75rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">This Period</th>
                <th style="padding: 0.75rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">YTD</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding: 0.5rem; border: 1px solid ${TavariStyles.colors.gray300};">Regular Wage</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(baseWage)}</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">${regularHours.toFixed(2)}</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(regularHours * baseWage)}</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(ytdData.regular_earnings)}</td>
              </tr>
              ${Object.keys(premiums).length > 0 ? Object.entries(premiums).map(([name, details]) => `
                <tr style="background-color: ${TavariStyles.colors.success}15;">
                  <td style="padding: 0.5rem; border: 1px solid ${TavariStyles.colors.gray300};">${name}</td>
                  <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(details.rate || 0)}</td>
                  <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">${parseFloat(details.hours || 0).toFixed(2)}</td>
                  <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(details.total_pay || 0)}</td>
                  <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(ytdData.shift_premiums)}</td>
                </tr>
              `).join('') : ''}
              ${overtimeHours > 0 ? `
              <tr>
                <td style="padding: 0.5rem; border: 1px solid ${TavariStyles.colors.gray300};">Overtime</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(baseWage * 1.5)}</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">${overtimeHours.toFixed(2)}</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(overtimeHours * baseWage * 1.5)}</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(ytdData.overtime_earnings)}</td>
              </tr>
              ` : ''}
              ${lieuHours > 0 ? `
              <tr>
                <td style="padding: 0.5rem; border: 1px solid ${TavariStyles.colors.gray300};">Lieu Hours</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(baseWage)}</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">${lieuHours.toFixed(2)}</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(lieuHours * baseWage)}</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(ytdData.lieu_earnings)}</td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 0.5rem; border: 1px solid ${TavariStyles.colors.gray300};">Vacation Pay</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">-</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">-</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(currentVacationPay)}</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(ytdData.vacation_pay)}</td>
              </tr>
              <tr style="background-color: ${TavariStyles.colors.gray100}; font-weight: bold;">
                <td style="padding: 0.75rem; border: 1px solid ${TavariStyles.colors.gray300};">GROSS PAY</td>
                <td style="padding: 0.75rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">-</td>
                <td style="padding: 0.75rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">${totalCurrentHours.toFixed(2)}</td>
                <td style="padding: 0.75rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(totalGrossWithVacation)}</td>
                <td style="padding: 0.75rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(ytdGrossPay)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style="margin-bottom: 2rem;">
          <h3 style="color: ${TavariStyles.colors.primary}; margin-bottom: 1rem;">Deductions</h3>
          <table style="width: 100%; border-collapse: collapse; border: 1px solid ${TavariStyles.colors.gray300};">
            <thead>
              <tr style="background-color: ${TavariStyles.colors.primary}; color: white;">
                <th style="padding: 0.75rem; text-align: left; border: 1px solid ${TavariStyles.colors.gray300};">Description</th>
                <th style="padding: 0.75rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">This Period</th>
                <th style="padding: 0.75rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">YTD</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding: 0.5rem; border: 1px solid ${TavariStyles.colors.gray300};">Federal Tax</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(currentFederalTax)}</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(ytdData.federal_tax)}</td>
              </tr>
              <tr>
                <td style="padding: 0.5rem; border: 1px solid ${TavariStyles.colors.gray300};">Provincial Tax</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(currentProvincialTax)}</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(ytdData.provincial_tax)}</td>
              </tr>
              <tr>
                <td style="padding: 0.5rem; border: 1px solid ${TavariStyles.colors.gray300};">CPP</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(currentCPPDeduction)}</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(ytdData.cpp_deduction)}</td>
              </tr>
              <tr>
                <td style="padding: 0.5rem; border: 1px solid ${TavariStyles.colors.gray300};">EI</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(currentEIDeduction)}</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(ytdData.ei_deduction)}</td>
              </tr>
              ${currentAdditionalTax > 0 ? `
              <tr>
                <td style="padding: 0.5rem; border: 1px solid ${TavariStyles.colors.gray300};">Additional Tax</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(currentAdditionalTax)}</td>
                <td style="padding: 0.5rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(ytdData.additional_tax)}</td>
              </tr>
              ` : ''}
              <tr style="background-color: ${TavariStyles.colors.gray100}; font-weight: bold;">
                <td style="padding: 0.75rem; border: 1px solid ${TavariStyles.colors.gray300};">TOTAL DEDUCTIONS</td>
                <td style="padding: 0.75rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(totalCurrentDeductions)}</td>
                <td style="padding: 0.75rem; text-align: right; border: 1px solid ${TavariStyles.colors.gray300};">$${formatTaxAmount(totalYTDDeductions)}</td>
              </tr>
              <tr style="background-color: ${TavariStyles.colors.primary}20; font-weight: bold; font-size: 1.1rem;">
                <td style="padding: 1rem; border: 2px solid ${TavariStyles.colors.primary}; color: ${TavariStyles.colors.primary};">NET PAY</td>
                <td style="padding: 1rem; text-align: right; border: 2px solid ${TavariStyles.colors.primary}; color: ${TavariStyles.colors.primary};">$${formatTaxAmount(parseFloat(entry.net_pay || 0))}</td>
                <td style="padding: 1rem; text-align: right; border: 2px solid ${TavariStyles.colors.primary}; color: ${TavariStyles.colors.primary};">$${formatTaxAmount(ytdData.net_pay)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem', color: TavariStyles.colors.gray600 }}>
        Loading pay statement...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem' }}>
        <div style={{
          backgroundColor: TavariStyles.colors.danger + '15',
          border: `1px solid ${TavariStyles.colors.danger}`,
          padding: '1rem',
          borderRadius: '8px',
          color: TavariStyles.colors.danger,
          marginBottom: '1rem'
        }}>
          {error}
        </div>
        <button
          onClick={() => navigate('/portal/pay-statements')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1rem',
            backgroundColor: TavariStyles.colors.primary,
            color: TavariStyles.colors.white,
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer'
          }}
        >
          <ArrowLeft size={18} />
          Back to Pay Statements
        </button>
      </div>
    );
  }

  if (!entry || !payrollRun) {
    return null;
  }

  return (
    <div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.75rem',
        marginBottom: '2rem'
      }}>
        <button
          onClick={() => navigate('/portal/pay-statements')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1rem',
            backgroundColor: TavariStyles.colors.gray100,
            border: `1px solid ${TavariStyles.colors.gray300}`,
            borderRadius: '8px',
            cursor: 'pointer'
          }}
        >
          <ArrowLeft size={18} />
          Back
        </button>
        <button
          onClick={handleDownloadPDF}
          disabled={downloading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1rem',
            backgroundColor: TavariStyles.colors.primary,
            color: TavariStyles.colors.white,
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            opacity: downloading ? 0.6 : 1
          }}
        >
          <Download size={18} />
          {downloading ? 'Preparing…' : 'Print / Save as PDF'}
        </button>
      </div>
      <div style={{
        backgroundColor: TavariStyles.colors.white,
        borderRadius: '12px',
        padding: 'clamp(1rem, 4vw, 2rem)',
        boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)',
        maxWidth: '100%',
        boxSizing: 'border-box',
        overflowX: 'auto'
      }}>
        <div dangerouslySetInnerHTML={{ 
          __html: generateDisplayHTML() || '<p>Loading statement content...</p>' 
        }} />
      </div>
    </div>
  );
};

export default PortalPayStatementDetail;
