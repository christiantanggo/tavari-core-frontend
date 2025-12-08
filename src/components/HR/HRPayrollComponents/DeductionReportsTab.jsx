// components/HR/HRPayrollComponents/DeductionReportsTab.jsx - FIXED TO READ FROM DATABASE
import React, { useState, useEffect } from 'react';
import { supabase } from '../../../supabaseClient';
import { SecurityWrapper } from '../../../Security';
import { useSecurityContext } from '../../../Security';
import { usePOSAuth } from '../../../hooks/usePOSAuth';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import POSAuthWrapper from '../../../components/Auth/POSAuthWrapper';
import TavariCheckbox from '../../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';
import toast from 'react-hot-toast';

const DeductionReportsTab = ({ selectedBusinessId, businessData, settings }) => {
  const [reportPeriod, setReportPeriod] = useState({
    start: '',
    end: ''
  });
  const [deductionData, setDeductionData] = useState([]);
  const [totals, setTotals] = useState({
    employee_federal_tax: 0,
    employee_provincial_tax: 0,
    employee_ei: 0,
    employee_cpp: 0,
    employer_ei: 0,
    employer_cpp: 0,
    total_remittance: 0,
    total_gross_pay: 0,
    total_net_pay: 0
  });
  const [loading, setLoading] = useState(false);
  const [includePreviousReports, setIncludePreviousReports] = useState(false);

  // Security context for sensitive financial data
  const {
    checkRateLimit,
    recordAction,
    logSecurityEvent
  } = useSecurityContext({
    componentName: 'DeductionReportsTab',
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
    componentName: 'DeductionReportsTab'
  });

  // Use effective business ID with fallback
  const effectiveBusinessId = selectedBusinessId || authBusinessId;
  const effectiveBusinessData = businessData || authBusinessData;

  // Tax calculations for formatting
  const { formatTaxAmount } = useTaxCalculations(effectiveBusinessId);

  // FIXED: Generate report by reading DIRECTLY from database - NO RECALCULATION
  const generateReport = async (startDateParam = null, endDateParam = null) => {
    const start = startDateParam || reportPeriod.start;
    const end = endDateParam || reportPeriod.end;

    if (!start || !end || !effectiveBusinessId) {
      toast.error('Please select both start and end dates for the report period');
      return;
    }

    const startDate = new Date(start + 'T00:00:00');
    const endDate = new Date(end + 'T23:59:59');
    
    if (startDate >= endDate) {
      toast.error('End date must be after start date');
      return;
    }

    const rateLimitCheck = await checkRateLimit('generate_deduction_report');
    if (!rateLimitCheck.allowed) {
      toast.error('Rate limit exceeded. Please wait before generating another report.');
      return;
    }

    setLoading(true);
    try {
      await recordAction('deduction_report_generation', true);

      await logSecurityEvent('government_remittance_report_generated', {
        report_period_start: start,
        report_period_end: end,
        business_id: effectiveBusinessId,
        report_type: 'deduction_summary'
      }, 'critical');

      // FIXED: Query by pay_period_end and READ VALUES DIRECTLY FROM DATABASE
      // PostgREST doesn't support filtering on nested relations, so fetch runs first, then entries
      
      // Step 1: Get finalized payroll runs for the period
      const { data: payrollRuns, error: runsError } = await supabase
        .from('hrpayroll_runs')
        .select('id, business_id, pay_date, pay_period_start, pay_period_end, status')
        .eq('business_id', effectiveBusinessId)
        .eq('status', 'finalized')
        .gte('pay_period_end', start)
        .lte('pay_period_end', end);

      if (runsError) throw runsError;

      if (!payrollRuns || payrollRuns.length === 0) {
        console.log(`No finalized payroll runs found for period ${start} to ${end}`);
        setDeductionData([]);
        setTotals({
          employee_federal_tax: 0,
          employee_provincial_tax: 0,
          employee_ei: 0,
          employee_cpp: 0,
          employer_ei: 0,
          employer_cpp: 0,
          total_remittance: 0,
          total_gross_pay: 0,
          total_net_pay: 0
        });
        setReportPeriod({ start, end });
        setLoading(false);
        toast.success('Report generated - no data found for selected period');
        return;
      }

      const runIds = payrollRuns.map(run => run.id);

      // Step 2: Get entries for these runs
      const { data: entries, error: entriesError } = await supabase
        .from('hrpayroll_entries')
        .select(`
          *,
          users!hrpayroll_entries_user_id_fkey (
            first_name,
            last_name,
            email,
            wage,
            claim_code
          )
        `)
        .in('payroll_run_id', runIds);

      if (entriesError) throw entriesError;

      // Map runs to entries for easier access
      const runsMap = new Map(payrollRuns.map(run => [run.id, run]));
      
      // Enrich entries with run data
      const enrichedEntries = (entries || []).map(entry => ({
        ...entry,
        hrpayroll_runs: runsMap.get(entry.payroll_run_id)
      }));


      const calculatedTotals = {
        employee_federal_tax: 0,
        employee_provincial_tax: 0,
        employee_ei: 0,
        employee_cpp: 0,
        employer_ei: 0,
        employer_cpp: 0,
        total_remittance: 0,
        total_gross_pay: 0,
        total_net_pay: 0
      };

      const processedEntries = [];
      
      for (const entry of enrichedEntries) {
        if (!entry || !entry.users || !entry.hrpayroll_runs) {
          console.warn('Skipping entry - missing required data:', entry?.id);
          continue;
        }

        // CRITICAL FIX: Read values DIRECTLY from database - DO NOT RECALCULATE
        const federalTax = parseFloat(entry.federal_tax || 0);
        const additionalTax = parseFloat(entry.additional_tax || 0);
        const totalFederalTax = federalTax + additionalTax;
        const provincialTax = parseFloat(entry.provincial_tax || 0);
        const ontarioHealthPremium = parseFloat(entry.ontario_health_premium || 0);
        const totalProvincialTax = provincialTax + ontarioHealthPremium;
        const employeeEI = parseFloat(entry.ei_deduction || 0);
        const employeeCPP = parseFloat(entry.cpp_deduction || 0);
        const employerEI = employeeEI * 1.4;
        const employerCPP = employeeCPP;

        // Calculate premium pay from stored premiums
        let premiumPay = 0;
        try {
          const premiums = typeof entry.premiums === 'string' ?
            JSON.parse(entry.premiums) : (entry.premiums || {});
          
          Object.values(premiums).forEach(premium => {
            if (premium.total_pay) {
              premiumPay += parseFloat(premium.total_pay);
            }
          });
        } catch (e) {
          premiumPay = 0;
        }

        const totalGross = parseFloat(entry.gross_pay || 0) + parseFloat(entry.vacation_pay || 0);
        const netPay = parseFloat(entry.net_pay || 0);

        // Add to totals
        calculatedTotals.employee_federal_tax += totalFederalTax;
        calculatedTotals.employee_provincial_tax += totalProvincialTax;
        calculatedTotals.employee_ei += employeeEI;
        calculatedTotals.employee_cpp += employeeCPP;
        calculatedTotals.employer_ei += employerEI;
        calculatedTotals.employer_cpp += employerCPP;
        calculatedTotals.total_gross_pay += totalGross;
        calculatedTotals.total_net_pay += netPay;

        processedEntries.push({
          ...entry,
          calculated_federal_tax: totalFederalTax,
          calculated_provincial_tax: totalProvincialTax,
          calculated_ei: employeeEI,
          calculated_cpp: employeeCPP,
          calculated_employer_ei: employerEI,
          calculated_employer_cpp: employerCPP,
          calculated_gross: totalGross,
          calculated_net: netPay,
          premium_pay: premiumPay
        });
      }

      calculatedTotals.total_remittance =
        calculatedTotals.employee_federal_tax +
        calculatedTotals.employee_provincial_tax +
        calculatedTotals.employee_ei +
        calculatedTotals.employee_cpp +
        calculatedTotals.employer_ei +
        calculatedTotals.employer_cpp;

      setDeductionData(processedEntries);
      setTotals(calculatedTotals);
      setReportPeriod({ start, end });

      console.log('✅ Report generated successfully:', {
        entries: processedEntries.length,
        totalRemittance: calculatedTotals.total_remittance,
        federalTax: calculatedTotals.employee_federal_tax,
        provincialTax: calculatedTotals.employee_provincial_tax
      });

      await logSecurityEvent('deduction_report_completed', {
        report_period_start: start,
        report_period_end: end,
        employee_count: processedEntries.length,
        total_remittance: calculatedTotals.total_remittance,
        total_gross_pay: calculatedTotals.total_gross_pay,
        cra_remittance: calculatedTotals.employee_federal_tax + calculatedTotals.employee_ei + calculatedTotals.employee_cpp + calculatedTotals.employer_ei + calculatedTotals.employer_cpp,
        provincial_remittance: calculatedTotals.employee_provincial_tax,
        calculation_method: 'database_direct_read'
      }, 'critical');

    } catch (error) {
      console.error('Error generating deduction report:', error);
      toast.error(`Failed to generate report: ${error.message || 'Unknown error'}`);
      
      await recordAction('deduction_report_generation', false);
      
      await logSecurityEvent('deduction_report_failed', {
        error_message: error.message,
        business_id: effectiveBusinessId,
        report_period_start: start,
        report_period_end: end
      }, 'high');
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = async () => {
    if (deductionData.length === 0) {
      alert('No data to export. Generate a report first.');
      return;
    }

    const rateLimitCheck = await checkRateLimit('export_deduction_data');
    if (!rateLimitCheck.allowed) {
      alert('Rate limit exceeded. Please wait before exporting data.');
      return;
    }

    try {
      await logSecurityEvent('deduction_data_exported', {
        export_format: 'csv',
        report_period_start: reportPeriod.start,
        report_period_end: reportPeriod.end,
        employee_count: deductionData.length,
        total_remittance: totals.total_remittance
      }, 'high');

      const headers = [
        'Employee Name',
        'Pay Date',
        'Pay Period Start',
        'Pay Period End',
        'Regular Hours',
        'Overtime Hours',
        'Lieu Hours',
        'Base Pay',
        'Premium Pay',
        'Vacation Pay',
        'Total Gross',
        'Federal Tax (CRA)',
        'Provincial Tax + Health Premium',
        'Employee EI',
        'Employee CPP',
        'Employer EI (1.4x)',
        'Employer CPP',
        'Total Employee Deductions',
        'Net Pay'
      ];

      const csvData = [];
    
      for (const entry of deductionData) {
        if (!entry || !entry.users || !entry.hrpayroll_runs) {
          continue;
        }

        const regularHours = parseFloat(entry.regular_hours || 0);
        const overtimeHours = parseFloat(entry.overtime_hours || 0);
        const lieuHours = parseFloat(entry.lieu_hours || 0);

        const wage = parseFloat(entry.users?.wage) || 15.00;
        const basePay = (regularHours * wage) + (overtimeHours * wage * 1.5) + (lieuHours * wage);
        const premiumPay = entry.premium_pay || 0;
        const vacationPay = parseFloat(entry.vacation_pay || 0);
        const totalGross = basePay + premiumPay + vacationPay;

        const federalTax = entry.calculated_federal_tax || 0;
        const provincialTax = entry.calculated_provincial_tax || 0;
        const employeeEI = entry.calculated_ei || 0;
        const employeeCPP = entry.calculated_cpp || 0;
        const employerEI = entry.calculated_employer_ei || 0;
        const employerCPP = entry.calculated_employer_cpp || 0;

        const totalEmployeeDeductions = federalTax + provincialTax + employeeEI + employeeCPP;

        const row = [
          `${entry.users.first_name} ${entry.users.last_name}`,
          entry.hrpayroll_runs.pay_date || 'MISSING',
          entry.hrpayroll_runs.pay_period_start || 'MISSING',
          entry.hrpayroll_runs.pay_period_end || 'MISSING',
          regularHours.toFixed(2),
          overtimeHours.toFixed(2),
          lieuHours.toFixed(2),
          formatTaxAmount(basePay),
          formatTaxAmount(premiumPay),
          formatTaxAmount(vacationPay),
          formatTaxAmount(totalGross),
          formatTaxAmount(federalTax),
          formatTaxAmount(provincialTax),
          formatTaxAmount(employeeEI),
          formatTaxAmount(employeeCPP),
          formatTaxAmount(employerEI),
          formatTaxAmount(employerCPP),
          formatTaxAmount(totalEmployeeDeductions),
          formatTaxAmount(entry.calculated_net || 0)
        ];

        csvData.push(row);
      }

      // Add totals row
      csvData.push([
        'TOTALS',
        '', '', '', '', '', '', '', '', '',
        formatTaxAmount(totals.total_gross_pay),
        formatTaxAmount(totals.employee_federal_tax),
        formatTaxAmount(totals.employee_provincial_tax),
        formatTaxAmount(totals.employee_ei),
        formatTaxAmount(totals.employee_cpp),
        formatTaxAmount(totals.employer_ei),
        formatTaxAmount(totals.employer_cpp),
        formatTaxAmount(totals.employee_federal_tax + totals.employee_provincial_tax + totals.employee_ei + totals.employee_cpp),
        formatTaxAmount(totals.total_net_pay)
      ]);

      // Add summary section
      csvData.push([]);
      csvData.push(['CRA T4127 COMPLIANT REMITTANCE SUMMARY']);
      csvData.push(['Report Period', `${new Date(reportPeriod.start).toLocaleDateString()} to ${new Date(reportPeriod.end).toLocaleDateString()}`]);
      csvData.push(['CRA Remittance (Federal + EI + CPP)', formatTaxAmount(totals.employee_federal_tax + totals.employee_ei + totals.employee_cpp + totals.employer_ei + totals.employer_cpp)]);
      csvData.push(['Provincial Remittance (Tax + Health Premium)', formatTaxAmount(totals.employee_provincial_tax)]);
      csvData.push(['Total Government Remittance Required', formatTaxAmount(totals.total_remittance)]);
      csvData.push(['']);
      csvData.push(['Values read directly from hrpayroll_entries table - no recalculation']);

      const csvContent = [headers, ...csvData]
        .map(row => row.map(field => `"${field}"`).join(','))
        .join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `CRA_Compliant_Payroll_Deduction_Report_${reportPeriod.start}_to_${reportPeriod.end}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (error) {
      console.error('Error exporting CSV:', error);
      await logSecurityEvent('csv_export_failed', {
        error_message: error.message
      }, 'medium');
      alert('Error exporting CSV: ' + error.message);
    }
  };

  const generateRemittanceReport = async () => {
    if (!totals.total_remittance || totals.total_remittance === 0) {
      alert('No remittance data to generate report. Run a deduction report first.');
      return;
    }

    const rateLimitCheck = await checkRateLimit('generate_remittance_report');
    if (!rateLimitCheck.allowed) {
      alert('Rate limit exceeded. Please wait before generating another remittance report.');
      return;
    }

    try {
      await logSecurityEvent('government_remittance_report_printed', {
        report_period_start: reportPeriod.start,
        report_period_end: reportPeriod.end,
        total_remittance: totals.total_remittance,
        cra_amount: totals.employee_federal_tax + totals.employee_ei + totals.employee_cpp + totals.employer_ei + totals.employer_cpp,
        provincial_amount: totals.employee_provincial_tax,
        employee_count: deductionData.length,
        calculation_method: 'database_direct_read'
      }, 'critical');

      const craAmount = totals.employee_federal_tax + totals.employee_ei + totals.employee_cpp + totals.employer_ei + totals.employer_cpp;

      const remittanceHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>CRA T4127 Compliant Government Remittance Report</title>
          <meta charset="UTF-8">
          <style>
            @page { size: 8.5in 11in; margin: 0.4in; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; line-height: 1.2; color: #333; font-size: 11px; }
            .header { text-align: center; border-bottom: 2px solid #008080; padding-bottom: 8px; margin-bottom: 12px; }
            .company-name { font-size: 18px; font-weight: bold; color: #008080; margin-bottom: 4px; }
            .report-title { font-size: 14px; margin: 6px 0; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; }
            .compliance-badge { background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%); padding: 6px; border-radius: 4px; border-left: 3px solid #28a745; margin: 8px 0; text-align: center; font-weight: bold; color: #155724; font-size: 9px; }
            .date-info { font-size: 10px; color: #666; margin-top: 4px; }
            .two-column { display: flex; gap: 10px; }
            .column { flex: 1; }
            .summary-section { margin: 10px 0; }
            .summary-section h3 { font-size: 12px; margin: 8px 0 4px 0; color: #333; }
            .summary-table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 10px; }
            .summary-table th, .summary-table td { padding: 4px 6px; border: 1px solid #dee2e6; text-align: left; }
            .summary-table th { background: linear-gradient(135deg, #e9ecef 0%, #f8f9fa 100%); font-weight: 600; color: #495057; text-transform: uppercase; font-size: 8px; letter-spacing: 0.3px; }
            .summary-table td.amount { text-align: right; font-family: 'Courier New', monospace; font-weight: 500; }
            .total-row { background: linear-gradient(135deg, #008080 0%, #006666 100%); color: white; font-weight: bold; font-size: 10px; }
            .cra-highlight { background: linear-gradient(135deg, #d1ecf1 0%, #bee5eb 100%); border-left: 3px solid #17a2b8; }
            .provincial-highlight { background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%); border-left: 3px solid #dc3545; }
            .payroll-summary { width: 100%; font-size: 9px; }
            .remittance-instructions { margin: 8px 0; background: #f8f9fa; padding: 8px; border-radius: 4px; border: 1px solid #dee2e6; font-size: 9px; }
            .remittance-instructions h4 { color: #17a2b8; margin: 4px 0 2px 0; font-size: 10px; }
            .remittance-instructions ul { margin: 2px 0; padding-left: 12px; }
            .remittance-instructions li { margin: 1px 0; }
            .footer { background: #212529; color: white; padding: 6px; border-radius: 3px; margin: 8px 0; font-size: 8px; text-align: center; }
            .report-meta { margin-top: 8px; text-align: center; font-size: 8px; color: #6c757d; border-top: 1px solid #dee2e6; padding-top: 6px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="company-name">${effectiveBusinessData?.name || 'Company Name'}</div>
            <div class="report-title">CRA T4127 Compliant Government Remittance Report</div>
            <div class="compliance-badge">
              CRA Payroll Deductions Formulas 121st Edition (July 1, 2025) - Official CRA T4127 Tax Tables
            </div>
            <div class="date-info">
              Work Period: ${new Date(reportPeriod.start).toLocaleDateString()} to ${new Date(reportPeriod.end).toLocaleDateString()} | 
              Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}
            </div>
          </div>

          <div class="two-column">
            <div class="column">
              <div class="summary-section">
                <h3>Payroll Summary</h3>
                <table class="summary-table payroll-summary">
                  <tr><th>Total Gross Pay</th><td class="amount">$${formatTaxAmount(totals.total_gross_pay)}</td></tr>
                  <tr><th>Total Net Pay</th><td class="amount">$${formatTaxAmount(totals.total_net_pay)}</td></tr>
                  <tr><th>Employees</th><td class="amount">${deductionData.length}</td></tr>
                  <tr><th>Work Period</th><td class="amount">${new Date(reportPeriod.start).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} to ${new Date(reportPeriod.end).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</td></tr>
                </table>
              </div>
            </div>
            
            <div class="column">
              <div class="summary-section">
                <h3>Government Remittance Summary</h3>
                <table class="summary-table">
                  <tr><th>CRA Remittance</th><td class="amount">$${formatTaxAmount(craAmount)}</td></tr>
                  <tr><th>Provincial Tax</th><td class="amount">$${formatTaxAmount(totals.employee_provincial_tax)}</td></tr>
                  <tr style="background: #008080; color: white; font-weight: bold;"><th>TOTAL REMITTANCE</th><td class="amount">$${formatTaxAmount(totals.total_remittance)}</td></tr>
                </table>
              </div>
            </div>
          </div>

          <div class="summary-section">
            <h3>CRA T4127 Compliant Deduction & Remittance Breakdown</h3>
            <table class="summary-table">
              <thead>
                <tr>
                  <th>Tax/Deduction Type</th>
                  <th style="text-align: right;">Employee</th>
                  <th style="text-align: right;">Employer</th>
                  <th style="text-align: right;">Total Remit</th>
                  <th>CRA Ref</th>
                </tr>
              </thead>
              <tbody>
                <tr class="cra-highlight">
                  <td><strong>Federal Income Tax</strong></td>
                  <td class="amount">$${formatTaxAmount(totals.employee_federal_tax)}</td>
                  <td class="amount">$0.00</td>
                  <td class="amount">$${formatTaxAmount(totals.employee_federal_tax)}</td>
                  <td>T4127 Tables 1-5</td>
                </tr>
                <tr class="provincial-highlight">
                  <td><strong>Provincial Tax + Health Premium (ON)</strong></td>
                  <td class="amount">$${formatTaxAmount(totals.employee_provincial_tax)}</td>
                  <td class="amount">$0.00</td>
                  <td class="amount">$${formatTaxAmount(totals.employee_provincial_tax)}</td>
                  <td>T4127 Tables 6-10</td>
                </tr>
                <tr class="cra-highlight">
                  <td><strong>Employment Insurance</strong></td>
                  <td class="amount">$${formatTaxAmount(totals.employee_ei)}</td>
                  <td class="amount">$${formatTaxAmount(totals.employer_ei)}</td>
                  <td class="amount">$${formatTaxAmount(totals.employee_ei + totals.employer_ei)}</td>
                  <td>1.66% (1.4x)</td>
                </tr>
                <tr class="cra-highlight">
                  <td><strong>Canada Pension Plan</strong></td>
                  <td class="amount">$${formatTaxAmount(totals.employee_cpp)}</td>
                  <td class="amount">$${formatTaxAmount(totals.employer_cpp)}</td>
                  <td class="amount">$${formatTaxAmount(totals.employee_cpp + totals.employer_cpp)}</td>
                  <td>5.95%</td>
                </tr>
                <tr class="total-row">
                  <td><strong>TOTAL REMITTANCE</strong></td>
                  <td class="amount"><strong>$${formatTaxAmount(totals.employee_federal_tax + totals.employee_provincial_tax + totals.employee_ei + totals.employee_cpp)}</strong></td>
                  <td class="amount"><strong>$${formatTaxAmount(totals.employer_ei + totals.employer_cpp)}</strong></td>
                  <td class="amount"><strong>$${formatTaxAmount(totals.total_remittance)}</strong></td>
                  <td><strong>CRA T4127</strong></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="remittance-instructions">
            <div class="two-column">
              <div class="column">
                <h4>CRA Remittance: $${formatTaxAmount(craAmount)}</h4>
                <ul>
                  <li><strong>Includes:</strong> Federal tax, EI (employee + employer 1.4x), CPP (employee + employer)</li>
                  <li><strong>Due:</strong> 15th of month following pay period</li>
                  <li><strong>Method:</strong> CRA My Business Account or approved bank</li>
                </ul>
              </div>
              <div class="column">
                <h4>Provincial: $${formatTaxAmount(totals.employee_provincial_tax)}</h4>
                <ul>
                  <li><strong>Jurisdiction:</strong> Ontario (default)</li>
                  <li><strong>Due:</strong> Per provincial requirements</li>
                  <li><strong>Calculation:</strong> CRA T4127 provincial tables</li>
                </ul>
              </div>
            </div>
          </div>

          <div class="footer">
            CRA T4127 compliant report generated by Tavari HR Payroll System using official government tax formulas.
            All deductions calculated per CRA Payroll Deductions Formulas 121st Edition (July 1, 2025).
          </div>

          <div class="report-meta">
            <p><strong>Tavari HR Payroll System - CRA T4127 Compliant Remittance Report</strong></p>
            <p>Generated by: ${authUser?.email || 'System'} | Business: ${effectiveBusinessData?.name || 'N/A'} | ID: ${Date.now().toString(36).toUpperCase()}</p>
            <p style="font-size: 7px; color: #999;">Values read directly from hrpayroll_entries table</p>
          </div>
        </body>
        </html>
      `;

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        throw new Error('Pop-up blocked. Please allow pop-ups for this site.');
      }

      printWindow.document.write(remittanceHTML);
      printWindow.document.close();
      
      setTimeout(() => {
        printWindow.print();
      }, 250);

    } catch (error) {
      console.error('Error generating remittance report:', error);
      alert('Error generating remittance report: ' + error.message);
    }
  };

  // Styles
  const styles = {
    container: {
      padding: TavariStyles.spacing?.lg || '16px',
      backgroundColor: TavariStyles.colors?.gray50 || '#f9fafb'
    },
    section: {
      backgroundColor: TavariStyles.colors?.white || '#ffffff',
      padding: TavariStyles.spacing?.lg || '16px',
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      marginBottom: TavariStyles.spacing?.lg || '16px',
      border: `1px solid ${TavariStyles.colors?.gray200 || '#e5e7eb'}`
    },
    sectionTitle: {
      fontSize: TavariStyles.typography?.fontSize?.xl || '20px',
      fontWeight: TavariStyles.typography?.fontWeight?.bold || '700',
      color: TavariStyles.colors?.gray900 || '#111827',
      marginBottom: TavariStyles.spacing?.md || '12px'
    },
    complianceBadge: {
      backgroundColor: '#d4edda',
      color: '#155724',
      padding: TavariStyles.spacing?.sm || '8px',
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      fontSize: TavariStyles.typography?.fontSize?.sm || '14px',
      fontWeight: TavariStyles.typography?.fontWeight?.semibold || '600',
      marginBottom: TavariStyles.spacing?.md || '12px',
      border: '1px solid #c3e6cb',
      textAlign: 'center'
    },
    periodForm: {
      display: 'flex',
      gap: TavariStyles.spacing?.md || '12px',
      alignItems: 'flex-end',
      marginBottom: TavariStyles.spacing?.md || '12px',
      flexWrap: 'wrap'
    },
    formGroup: {
      flex: 1,
      minWidth: '200px'
    },
    label: {
      display: 'block',
      fontSize: TavariStyles.typography?.fontSize?.sm || '14px',
      fontWeight: TavariStyles.typography?.fontWeight?.medium || '500',
      color: TavariStyles.colors?.gray700 || '#374151',
      marginBottom: TavariStyles.spacing?.xs || '4px'
    },
    input: {
      width: '90%',
      padding: TavariStyles.spacing?.sm || '8px',
      fontSize: TavariStyles.typography?.fontSize?.sm || '14px',
      border: `1px solid ${TavariStyles.colors?.gray300 || '#d1d5db'}`,
      borderRadius: TavariStyles.borderRadius?.sm || '4px'
    },
    button: {
      padding: `${TavariStyles.spacing?.sm || '8px'} ${TavariStyles.spacing?.md || '12px'}`,
      backgroundColor: TavariStyles.colors?.primary || '#008080',
      color: TavariStyles.colors?.white || '#ffffff',
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      fontSize: TavariStyles.typography?.fontSize?.sm || '14px',
      fontWeight: TavariStyles.typography?.fontWeight?.medium || '500',
      cursor: 'pointer'
    },
    secondaryButton: {
      padding: `${TavariStyles.spacing?.sm || '8px'} ${TavariStyles.spacing?.md || '12px'}`,
      backgroundColor: TavariStyles.colors?.white || '#ffffff',
      color: TavariStyles.colors?.primary || '#008080',
      border: `1px solid ${TavariStyles.colors?.primary || '#008080'}`,
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      fontSize: TavariStyles.typography?.fontSize?.sm || '14px',
      fontWeight: TavariStyles.typography?.fontWeight?.medium || '500',
      cursor: 'pointer',
      marginRight: TavariStyles.spacing?.sm || '8px'
    },
    disabledButton: {
      opacity: 0.6,
      cursor: 'not-allowed'
    },
    summaryCard: {
      border: `2px solid ${TavariStyles.colors?.primary || '#008080'}`,
      borderRadius: TavariStyles.borderRadius?.md || '8px',
      padding: TavariStyles.spacing?.lg || '16px',
      marginBottom: TavariStyles.spacing?.md || '12px'
    },
    summaryGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: TavariStyles.spacing?.md || '12px',
      marginBottom: TavariStyles.spacing?.lg || '16px'
    },
    summaryItem: {
      padding: TavariStyles.spacing?.sm || '8px'
    },
    summaryLabel: {
      fontSize: TavariStyles.typography?.fontSize?.sm || '14px',
      color: TavariStyles.colors?.gray600 || '#4b5563',
      marginBottom: TavariStyles.spacing?.xs || '4px'
    },
    summaryValue: {
      fontSize: TavariStyles.typography?.fontSize?.xl || '20px',
      fontWeight: TavariStyles.typography?.fontWeight?.bold || '700',
      color: TavariStyles.colors?.gray900 || '#111827'
    },
    totalRemittance: {
      backgroundColor: TavariStyles.colors?.primary + '10' || '#00808010',
      padding: TavariStyles.spacing?.md || '12px',
      borderRadius: TavariStyles.borderRadius?.sm || '4px',
      textAlign: 'center',
      marginBottom: TavariStyles.spacing?.md || '12px'
    },
    totalLabel: {
      fontSize: TavariStyles.typography?.fontSize?.md || '16px',
      fontWeight: TavariStyles.typography?.fontWeight?.semibold || '600',
      color: TavariStyles.colors?.gray700 || '#374151',
      marginBottom: TavariStyles.spacing?.xs || '4px'
    },
    totalValue: {
      fontSize: TavariStyles.typography?.fontSize?.xxxl || '32px',
      fontWeight: TavariStyles.typography?.fontWeight?.bold || '700',
      color: TavariStyles.colors?.primary || '#008080'
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: TavariStyles.typography?.fontSize?.sm || '14px',
      marginTop: TavariStyles.spacing?.md || '12px'
    },
    th: {
      padding: TavariStyles.spacing?.md || '12px',
      textAlign: 'left',
      fontWeight: TavariStyles.typography?.fontWeight?.semibold || '600',
      color: TavariStyles.colors?.gray700 || '#374151',
      fontSize: TavariStyles.typography?.fontSize?.sm || '14px',
      backgroundColor: TavariStyles.colors?.gray50 || '#f9fafb',
      borderBottom: `2px solid ${TavariStyles.colors?.gray200 || '#e5e7eb'}`
    },
    td: {
      padding: TavariStyles.spacing?.md || '12px',
      borderBottom: `1px solid ${TavariStyles.colors?.gray100 || '#f3f4f6'}`,
      verticalAlign: 'middle',
      fontSize: TavariStyles.typography?.fontSize?.sm || '14px'
    },
    amountCell: {
      textAlign: 'right',
      fontFamily: 'monospace',
      fontWeight: TavariStyles.typography?.fontWeight?.medium || '500'
    },
    emptyState: {
      textAlign: 'center',
      color: TavariStyles.colors?.gray500 || '#6b7280',
      padding: TavariStyles.spacing?.xl || '20px',
      fontSize: TavariStyles.typography?.fontSize?.lg || '18px'
    },
    optionsSection: {
      marginTop: TavariStyles.spacing?.md || '12px',
      padding: TavariStyles.spacing?.md || '12px',
      backgroundColor: TavariStyles.colors?.gray50 || '#f9fafb',
      borderRadius: TavariStyles.borderRadius?.sm || '4px'
    }
  };

  return (
    <POSAuthWrapper
      componentName="DeductionReportsTab"
      requiredRoles={['owner', 'manager', 'hr_admin']}
      requireBusiness={true}
    >
      <SecurityWrapper
        componentName="DeductionReportsTab"
        securityLevel="critical"
        enableAuditLogging={true}
        sensitiveComponent={true}
      >
        <div style={styles.container}>
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Generate CRA T4127 Compliant Government Deduction Report</h3>
            
            <div style={styles.complianceBadge}>
              Reads Actual Tax Deductions from Database - No Recalculation
            </div>
            
            <p style={{ 
              fontSize: TavariStyles.typography?.fontSize?.sm || '14px', 
              color: TavariStyles.colors?.gray600 || '#4b5563',
              marginBottom: TavariStyles.spacing?.md || '12px'
            }}>
              <strong>Note:</strong> Select the date range for when work was performed (pay period end dates). 
              This report reads the exact tax amounts that were calculated and saved when payroll was processed—no recalculation occurs.
            </p>
            
            <div style={styles.periodForm}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Work Period Start Date:</label>
                <input
                  type="date"
                  style={styles.input}
                  value={reportPeriod.start}
                  onChange={(e) => setReportPeriod(prev => ({ ...prev, start: e.target.value }))}
                  placeholder="Select start date"
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>Work Period End Date:</label>
                <input
                  type="date"
                  style={styles.input}
                  value={reportPeriod.end}
                  onChange={(e) => setReportPeriod(prev => ({ ...prev, end: e.target.value }))}
                  placeholder="Select end date"
                />
              </div>
              <div style={styles.formGroup}>
                <button
                  style={{
                    ...styles.button,
                    ...(loading ? styles.disabledButton : {})
                  }}
                  onClick={() => generateReport()}
                  disabled={loading}
                >
                  {loading ? 'Generating CRA Report...' : 'Generate CRA T4127 Report'}
                </button>
              </div>
            </div>

            <div style={styles.optionsSection}>
              <TavariCheckbox
                checked={includePreviousReports}
                onChange={setIncludePreviousReports}
                label="Include comparison with previous periods"
                size="sm"
              />
            </div>
          </div>

          {totals.total_remittance > 0 && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>
                CRA T4127 Compliant Government Remittance Summary ({new Date(reportPeriod.start).toLocaleDateString()} to {new Date(reportPeriod.end).toLocaleDateString()})
              </h3>

              <div style={styles.summaryCard}>
                <div style={styles.summaryGrid}>
                  <div style={styles.summaryItem}>
                    <div style={styles.summaryLabel}>Federal Tax (CRA)</div>
                    <div style={styles.summaryValue}>${formatTaxAmount(totals.employee_federal_tax)}</div>
                  </div>
                  <div style={styles.summaryItem}>
                    <div style={styles.summaryLabel}>Provincial Tax + Health Premium</div>
                    <div style={styles.summaryValue}>${formatTaxAmount(totals.employee_provincial_tax)}</div>
                  </div>
                  <div style={styles.summaryItem}>
                    <div style={styles.summaryLabel}>Employee EI</div>
                    <div style={styles.summaryValue}>${formatTaxAmount(totals.employee_ei)}</div>
                  </div>
                  <div style={styles.summaryItem}>
                    <div style={styles.summaryLabel}>Employee CPP</div>
                    <div style={styles.summaryValue}>${formatTaxAmount(totals.employee_cpp)}</div>
                  </div>
                  <div style={styles.summaryItem}>
                    <div style={styles.summaryLabel}>Employer EI (1.4x)</div>
                    <div style={styles.summaryValue}>${formatTaxAmount(totals.employer_ei)}</div>
                  </div>
                  <div style={styles.summaryItem}>
                    <div style={styles.summaryLabel}>Employer CPP</div>
                    <div style={styles.summaryValue}>${formatTaxAmount(totals.employer_cpp)}</div>
                  </div>
                </div>

                <div style={styles.totalRemittance}>
                  <div style={styles.totalLabel}>Total CRA T4127 Compliant Remittance</div>
                  <div style={styles.totalValue}>${formatTaxAmount(totals.total_remittance)}</div>
                  <div style={{
                    marginTop: TavariStyles.spacing?.sm || '8px', 
                    fontSize: TavariStyles.typography?.fontSize?.sm || '14px',
                    opacity: 0.9
                  }}>
                    CRA: ${formatTaxAmount(totals.employee_federal_tax + totals.employee_ei + totals.employee_cpp + totals.employer_ei + totals.employer_cpp)} | 
                    Provincial: ${formatTaxAmount(totals.employee_provincial_tax)}
                  </div>
                </div>
              </div>

              <div>
                <button
                  style={styles.secondaryButton}
                  onClick={exportToCSV}
                >
                  Export CRA Compliant CSV
                </button>
                <button
                  style={styles.button}
                  onClick={generateRemittanceReport}
                >
                  Generate CRA T4127 Remittance Report
                </button>
              </div>
            </div>
          )}

          {deductionData.length > 0 && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>
                CRA T4127 Compliant Employee Deduction Details ({deductionData.length} employees)
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Employee</th>
                      <th style={styles.th}>Pay Date</th>
                      <th style={styles.th}>Gross + Vacation</th>
                      <th style={styles.th}>Premium Pay</th>
                      <th style={styles.th}>Federal Tax (CRA)</th>
                      <th style={styles.th}>Provincial + Health</th>
                      <th style={styles.th}>EI</th>
                      <th style={styles.th}>CPP</th>
                      <th style={styles.th}>Net Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deductionData.filter(entry => entry && entry.users && entry.hrpayroll_runs).map(entry => (
                      <tr key={entry.id}>
                        <td style={styles.td}>
                          <strong>{entry.users.first_name} {entry.users.last_name}</strong>
                        </td>
                        <td style={styles.td}>{new Date(entry.hrpayroll_runs.pay_date).toLocaleDateString()}</td>
                        <td style={{...styles.td, ...styles.amountCell}}>
                          ${formatTaxAmount(entry.calculated_gross)}
                        </td>
                        <td style={{...styles.td, ...styles.amountCell, color: TavariStyles.colors?.success || '#10b981'}}>
                          {entry.premium_pay > 0 ? `$${formatTaxAmount(entry.premium_pay)}` : '-'}
                        </td>
                        <td style={{...styles.td, ...styles.amountCell}}>
                          ${formatTaxAmount(entry.calculated_federal_tax)}
                        </td>
                        <td style={{...styles.td, ...styles.amountCell}}>
                          ${formatTaxAmount(entry.calculated_provincial_tax)}
                        </td>
                        <td style={{...styles.td, ...styles.amountCell}}>
                          ${formatTaxAmount(entry.calculated_ei)}
                        </td>
                        <td style={{...styles.td, ...styles.amountCell}}>
                          ${formatTaxAmount(entry.calculated_cpp)}
                        </td>
                        <td style={{...styles.td, ...styles.amountCell}}>
                          <strong>${formatTaxAmount(entry.calculated_net)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {reportPeriod.start && reportPeriod.end && deductionData.length === 0 && !loading && (
            <div style={styles.section}>
              <div style={styles.emptyState}>
                No payroll data found for the selected period.<br />
                Make sure you have finalized payroll runs where the pay period ends within this date range.
              </div>
            </div>
          )}
        </div>
      </SecurityWrapper>
    </POSAuthWrapper>
  );
};

export default DeductionReportsTab;