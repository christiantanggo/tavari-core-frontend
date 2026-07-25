// PayStatementViewScreen - Public route for viewing pay statements
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { AlertCircle, Download, X, ArrowLeft } from 'lucide-react';
import html2pdf from 'html2pdf.js';
import { TavariStyles } from '../../utils/TavariStyles';
import { useYTDCalculations } from '../../hooks/useYTDCalculations';
import { useTaxCalculations } from '../../hooks/useTaxCalculations';
import toast from 'react-hot-toast';
import { normalizeYTDTotals, addCurrentPeriodToPayStatementYtd } from '../../utils/payStatementYTD';
import {
  fetchLastWageAdjustmentForPayStatement,
  formatLastWageAdjustmentDisplay,
} from '../../helpers/Payroll/fetchLastWageAdjustmentForPayStatement';

const PayStatementViewScreen = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const [entry, setEntry] = useState(null);
  const [payrollRun, setPayrollRun] = useState(null);
  const [ytdData, setYtdData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [lastWageAdjustment, setLastWageAdjustment] = useState(null);
  const statementContentRef = useRef(null);
  
  // Get business_id from entry/payrollRun once loaded
  const businessId = payrollRun?.business_id || entry?.hrpayroll_runs?.business_id;
  const ytd = useYTDCalculations(businessId || '');
  const { formatTaxAmount } = useTaxCalculations(businessId || '');

  useEffect(() => {
    if (token) {
      loadPayStatement();
    }
  }, [token]);

  const loadPayStatement = async () => {
    try {
      setLoading(true);
      setError('');

      // Decode token from URL (handles mobile browser URL encoding issues)
      const decodedToken = token ? decodeURIComponent(token) : null;

      // Check if this is a test token - load mock data
      if (decodedToken === 'TEST' || decodedToken?.startsWith('TEST-')) {
        console.log('[PayStatementView] Loading mock/test pay statement data');
        
        // Create mock data
        const today = new Date();
        const payPeriodEnd = new Date(today);
        payPeriodEnd.setDate(today.getDate() - 7); // One week ago
        const payPeriodStart = new Date(payPeriodEnd);
        payPeriodStart.setDate(payPeriodEnd.getDate() - 14); // 2 weeks before pay period end
        const payDate = new Date(payPeriodEnd);
        payDate.setDate(payPeriodEnd.getDate() + 3); // 3 days after pay period end

        const mockEntry = {
          id: 'test-entry-id',
          user_id: 'test-user-id',
          regular_hours: 40.0,
          overtime_hours: 5.0,
          lieu_hours: 0,
          stat_holiday_hours: 0,
          holiday_pay: 0,
          regular_earnings: 800.00,
          overtime_earnings: 150.00,
          lieu_earnings: 0,
          stat_earnings: 0,
          shift_premiums: 50.00,
          vacation_pay: 80.00,
          bonus: 0,
          gross_pay: 1080.00,
          federal_tax: 108.00,
          provincial_tax: 54.00,
          ontario_health_premium: 0,
          ei_deduction: 17.09,
          cpp_deduction: 62.58,
          additional_tax: 0,
          net_pay: 838.33,
          lieu_balance_after: 2.5,
          premiums: JSON.stringify({
            'Night Shift': {
              name: 'Night Shift',
              rate: 2.50,
              hours: 8,
              total_pay: 20.00
            },
            'Weekend': {
              name: 'Weekend',
              rate: 1.50,
              hours: 16,
              total_pay: 24.00
            }
          }),
          users: {
            first_name: 'John',
            last_name: 'Doe',
            email: 'john.doe@example.com',
            hire_date: '2024-01-15',
            wage: 20.00
          },
          hrpayroll_runs: {
            id: 'test-run-id',
            pay_period_start: payPeriodStart.toISOString().split('T')[0],
            pay_period_end: payPeriodEnd.toISOString().split('T')[0],
            pay_date: payDate.toISOString().split('T')[0],
            business_id: 'test-business-id',
            businesses: {
              name: 'The Company',
              business_email: 'payroll@example.com',
              timezone: 'America/Toronto'
            }
          }
        };

        const mockYtdData = {
          regular_hours: 520,
          overtime_hours: 65,
          lieu_hours: 10,
          stat_hours: 8,
          holiday_hours: 0,
          regular_earnings: 10400.00,
          overtime_earnings: 1950.00,
          lieu_earnings: 200.00,
          stat_earnings: 160.00,
          holiday_earnings: 0,
          shift_premiums: 650.00,
          vacation_pay: 1040.00,
          bonus: 500.00,
          gross_pay: 14900.00,
          federal_tax: 1490.00,
          provincial_tax: 745.00,
          ei_deduction: 222.14,
          cpp_deduction: 813.55,
          additional_tax: 0,
          net_pay: 11629.31
        };

        setEntry(mockEntry);
        setPayrollRun(mockEntry.hrpayroll_runs);
        setYtdData(mockYtdData);
        setLoading(false);
        return;
      }

      // Load payroll entry by viewing token
      // IMPORTANT: This query must work for unauthenticated users
      // Make sure the RLS policy hrpayroll_entries_viewing_token_select has been applied
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
        .eq('viewing_token', decodedToken)
        .maybeSingle();

      if (entryError) {
        console.error('Error loading pay statement:', entryError);
        console.error('Entry error details:', {
          code: entryError.code,
          message: entryError.message,
          details: entryError.details,
          hint: entryError.hint
        });
        
        // Check if it's an RLS policy error
        if (entryError.code === '42501' || entryError.message?.includes('permission denied') || entryError.message?.includes('policy') || entryError.message?.includes('row-level security')) {
          setError('Access denied. The RLS policy for viewing pay statements has not been applied. Please run the SQL migration file: src/supabase/fix_pay_statement_viewing_token_rls.sql in your Supabase SQL editor.');
        } else {
          setError('Failed to load pay statement: ' + entryError.message);
        }
        setLoading(false);
        return;
      }

      if (!entryData) {
        setError('Pay statement not found. The link may be invalid or expired.');
        setLoading(false);
        return;
      }

      setEntry(entryData);
      // The join returns the relationship with the alias (Supabase uses the table name or custom alias)
      const payrollRunData = entryData.hrpayroll_runs;
      setPayrollRun(payrollRunData);

      try {
        const businessIdForWage = payrollRunData?.business_id || entryData.business_id;
        const wageAdj = await fetchLastWageAdjustmentForPayStatement(
          supabase,
          entryData.user_id,
          businessIdForWage
        );
        setLastWageAdjustment(wageAdj);
      } catch {
        setLastWageAdjustment(null);
      }

      // Load YTD data - use same calculation method as PayStatementsTab
      try {
        const businessIdForYTD = entryData.hrpayroll_runs?.business_id;
        if (businessIdForYTD && (entryData.hrpayroll_runs?.pay_period_end || entryData.hrpayroll_runs?.pay_date) && ytd?.calculateEmployeeYTD) {
          console.log('[PayStatementViewScreen] Loading YTD with business ID:', businessIdForYTD);
          // Use pay_period_end for YTD calculation, not pay_date
          // YTD should include all work done up to the end of the pay period, not when it was paid
          const ytdEndDate = entryData.hrpayroll_runs.pay_period_end || entryData.hrpayroll_runs.pay_date;
          const businessTimezone = entryData.hrpayroll_runs?.businesses?.timezone || 'America/Toronto';
          const rawYtd = await ytd.calculateEmployeeYTD(
            entryData.user_id,
            ytdEndDate,
            businessIdForYTD,
            businessTimezone,
            { excludePayrollRunId: payrollRunData?.id || entryData.payroll_run_id }
          );

          setYtdData(addCurrentPeriodToPayStatementYtd(normalizeYTDTotals(rawYtd), entryData));
        }
      } catch (ytdError) {
        console.warn('Could not load YTD data:', ytdError);
        // Continue without YTD data - use shared normalization
        setYtdData(normalizeYTDTotals(null));
      }

      setLoading(false);
    } catch (err) {
      console.error('Error loading pay statement:', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  const generateStatementHTML = () => {
    if (!entry || !payrollRun || !formatTaxAmount) return '';

    const businessData = payrollRun.businesses || {};
    const businessTimezone = businessData.timezone || 'America/Toronto';
    
    // Parse premiums
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

    // Parse wage breakdown if exists (same as PayStatementsTab)
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

    // Calculate totals (same as PayStatementsTab)
    const regularHours = parseFloat(entry.regular_hours || 0);
    const overtimeHours = parseFloat(entry.overtime_hours || 0);
    const lieuHours = parseFloat(entry.lieu_hours || 0);
    const statHolidayHours = parseFloat(entry.stat_holiday_hours || 0);
    const totalCurrentHours = regularHours + overtimeHours + lieuHours + statHolidayHours;

    // Calculate wage-based earnings (same as PayStatementsTab)
    const baseWage = parseFloat(entry.users?.wage || 0);
    
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

    const statEarnings = statHolidayHours * baseWage;
    const holidayEarnings = parseFloat(entry.holiday_pay || 0);
    const vacationPay = parseFloat(entry.vacation_pay || 0);
    
    // Calculate current period earnings (same as PayStatementsTab)
    const currentGrossPay = parseFloat(entry.gross_pay || 0);
    const totalGrossWithVacation = currentGrossPay + vacationPay;

    // Calculate deductions (same as PayStatementsTab)
    const currentFederalTax = parseFloat(entry.federal_tax || 0);
    const currentProvincialTax = parseFloat(entry.provincial_tax || 0);
    const currentOntarioHealthPremium = parseFloat(entry.ontario_health_premium || 0);
    const currentEIDeduction = parseFloat(entry.ei_deduction || 0);
    const currentCPPDeduction = parseFloat(entry.cpp_deduction || 0);
    const currentAdditionalTax = parseFloat(entry.additional_tax || 0);
    
    const totalCurrentDeductions = currentFederalTax + currentProvincialTax + currentOntarioHealthPremium + 
                                   currentEIDeduction + currentCPPDeduction + currentAdditionalTax;

    // Get YTD totals (same format as PayStatementsTab)
    const ytdTotals = ytdData || {
      regular_hours: 0,
      overtime_hours: 0,
      lieu_hours: 0,
      stat_hours: 0,
      holiday_hours: 0,
      regular_earnings: 0,
      overtime_earnings: 0,
      lieu_earnings: 0,
      stat_earnings: 0,
      holiday_earnings: 0,
      shift_premiums: 0,
      vacation_pay: 0,
      bonus: 0,
      gross_pay: 0,
      federal_tax: 0,
      provincial_tax: 0,
      ei_deduction: 0,
      cpp_deduction: 0,
      additional_tax: 0,
      net_pay: 0
    };

    const ytdGrossPay = ytdTotals.gross_pay + ytdTotals.vacation_pay;
    const totalYTDDeductions = 
      ytdTotals.federal_tax +
      ytdTotals.provincial_tax +
      ytdTotals.ei_deduction +
      ytdTotals.cpp_deduction +
      ytdTotals.additional_tax;

    // Get formatted date for title (same as PayStatementsTab)
    const payPeriodEndDate = new Date(payrollRun.pay_period_end + 'T12:00:00');
    const formattedDate = payPeriodEndDate.toLocaleDateString('en-CA', { timeZone: businessTimezone });

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Pay Statement - ${entry.users.first_name} ${entry.users.last_name} - ${formattedDate}</title>
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
            color: #333;
            background-color: #fff;
            font-size: 16px;
          }
          .header {
            text-align: center;
            border-bottom: 1px solid ${TavariStyles.colors.primary};
            padding-bottom: 3px;
            margin-bottom: 6px;
          }
          .company-name {
            font-size: 20px;
            font-weight: bold;
            color: ${TavariStyles.colors.primary};
            margin-bottom: 2px;
          }
          .statement-title {
            font-size: 16px;
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
            font-size: 14px;
          }
          .employee-info div {
            line-height: 1.3;
          }
          .employee-info strong {
            color: ${TavariStyles.colors.gray700};
            font-weight: 600;
          }
          .pay-table {
            width: 100%;
            border-collapse: collapse;
            margin: 4px 0;
            font-size: 14px;
          }
          .pay-table th, .pay-table td {
            padding: 4px 6px;
            border: 1px solid #ddd;
            text-align: left;
          }
          .pay-table th {
            background-color: #f5f5f5;
            font-weight: 600;
            color: #333;
            text-transform: uppercase;
            font-size: 13px;
            letter-spacing: 0.3px;
          }
          .pay-table td.number {
            text-align: right;
            font-family: 'Courier New', monospace;
            font-size: 14px;
          }
          .pay-table .total-row {
            background-color: #f8f9fa;
            font-weight: bold;
            border-top: 1px solid #333;
          }
          .pay-table .net-pay-row {
            background-color: ${TavariStyles.colors.primary}20;
            font-weight: bold;
            font-size: 16px;
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
            font-size: 13px;
            color: #92400e;
          }
          .footer {
            margin-top: 6px;
            font-size: 11px;
            color: ${TavariStyles.colors.gray600};
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
              font-size: 16px; 
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
        <div class="header">
          <div class="company-name">${businessData.name || 'Company Name'}</div>
          <div class="statement-title">Employee Pay Statement - ${formattedDate}</div>
        </div>

        <div class="employee-info compact-section">
          <div>
            <strong>Employee:</strong> ${entry.users.first_name} ${entry.users.last_name}<br>
            <strong>Employee ID:</strong> ${entry.user_id.slice(-8).toUpperCase()}<br>
            <strong>Email:</strong> ${entry.users.email || 'N/A'}<br>
            ${entry.users.hire_date ? `<strong>Hire Date:</strong> ${new Date(entry.users.hire_date + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: businessTimezone })}<br>` : ''}
          </div>
          <div>
            <strong>Pay Period:</strong> ${new Date(payrollRun.pay_period_start + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: businessTimezone })} to ${new Date(payrollRun.pay_period_end + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: businessTimezone })}<br>
            <strong>Pay Date:</strong> ${new Date(payrollRun.pay_date + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: businessTimezone })}<br>
            <strong>Base Rate:</strong> $${formatTaxAmount(baseWage)}/hr<br>
            <strong>Last Wage Adjustment:</strong> ${formatLastWageAdjustmentDisplay(lastWageAdjustment, formatTaxAmount, businessTimezone)}<br>
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
                  <td class="number">${idx === 0 ? '$' + formatTaxAmount(ytdTotals.regular_earnings) : ''}</td>
                </tr>
              `).join('')}
            ` : `
              <tr>
                <td>Regular Wage</td>
                <td class="number">$${formatTaxAmount(baseWage)}</td>
                <td class="number">${regularHours.toFixed(2)}</td>
                <td class="number">$${formatTaxAmount(regularEarnings)}</td>
                <td class="number">$${formatTaxAmount(ytdTotals.regular_earnings)}</td>
              </tr>
            `}
            ${Object.keys(premiums).length > 0 ? Object.entries(premiums).map(([name, details]) => `
              <tr class="premium-highlight">
                <td>${name}</td>
                <td class="number">$${formatTaxAmount(details.rate || 0)}</td>
                <td class="number">${parseFloat(details.hours || 0).toFixed(2)}</td>
                <td class="number">$${formatTaxAmount(details.total_pay || 0)}</td>
                <td class="number">$${formatTaxAmount(ytdTotals.shift_premiums)}</td>
              </tr>
            `).join('') : ''}
            ${overtimeHours > 0 ? `
            <tr>
              <td>Overtime</td>
              <td class="number">$${formatTaxAmount(baseWage * 1.5)}</td>
              <td class="number">${overtimeHours.toFixed(2)}</td>
              <td class="number">$${formatTaxAmount(overtimeEarnings)}</td>
              <td class="number">$${formatTaxAmount(ytdTotals.overtime_earnings)}</td>
            </tr>
            ` : ''}
            ${lieuHours > 0 ? `
            <tr>
              <td>Lieu Hours</td>
              <td class="number">${hasWageChange ? 'Varied' : '$' + formatTaxAmount(baseWage)}</td>
              <td class="number">${lieuHours.toFixed(2)}</td>
              <td class="number">$${formatTaxAmount(lieuEarnings)}</td>
              <td class="number">$${formatTaxAmount(ytdTotals.lieu_earnings)}</td>
            </tr>
            ` : ''}
            ${statHolidayHours > 0 ? `
            <tr>
              <td>Stat Worked</td>
              <td class="number">$${formatTaxAmount(baseWage)}</td>
              <td class="number">${statHolidayHours.toFixed(2)}</td>
              <td class="number">$${formatTaxAmount(statEarnings)}</td>
              <td class="number">$${formatTaxAmount(ytdTotals.stat_earnings)}</td>
            </tr>
            ` : ''}
            ${holidayEarnings > 0 ? `
            <tr>
              <td>Holiday Pay</td>
              <td class="number">$${formatTaxAmount(baseWage)}</td>
              <td class="number">0.00</td>
              <td class="number">$${formatTaxAmount(holidayEarnings)}</td>
              <td class="number">$${formatTaxAmount(ytdTotals.holiday_earnings)}</td>
            </tr>
            ` : ''}
            <tr>
              <td>Vacation</td>
              <td class="number">-</td>
              <td class="number">-</td>
              <td class="number">$${formatTaxAmount(vacationPay)}</td>
              <td class="number">$${formatTaxAmount(ytdTotals.vacation_pay)}</td>
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
              <td class="number">$${formatTaxAmount(ytdTotals.federal_tax)}</td>
            </tr>
            <tr>
              <td>Provincial Tax</td>
              <td class="number">$${formatTaxAmount(parseFloat(entry.provincial_tax || 0))}</td>
              <td class="number">$${formatTaxAmount(ytdTotals.provincial_tax)}</td>
            </tr>
            <tr>
              <td>CPP</td>
              <td class="number">$${formatTaxAmount(parseFloat(entry.cpp_deduction || 0))}</td>
              <td class="number">$${formatTaxAmount(ytdTotals.cpp_deduction)}</td>
            </tr>
            <tr>
              <td>EI</td>
              <td class="number">$${formatTaxAmount(parseFloat(entry.ei_deduction || 0))}</td>
              <td class="number">$${formatTaxAmount(ytdTotals.ei_deduction)}</td>
            </tr>
            ${currentAdditionalTax > 0 ? `
            <tr>
              <td>Additional Tax</td>
              <td class="number">$${formatTaxAmount(currentAdditionalTax)}</td>
              <td class="number">$${formatTaxAmount(ytdTotals.additional_tax)}</td>
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
              <td class="number"><strong>$${formatTaxAmount(ytdTotals.net_pay)}</strong></td>
            </tr>
          </tbody>
        </table>

        <div class="footer">
          <p><strong>This pay statement was generated electronically by Tavari HR Payroll System.</strong></p>
          <p>Generated on: ${new Date().toLocaleDateString('en-CA', { timeZone: businessTimezone })} ${new Date().toLocaleTimeString('en-CA', { timeZone: businessTimezone })}</p>
          <p>YTD Calculation: Fast lookup | Source: ${ytdTotals._ytd_source || 'standard'}</p>
        </div>
      </body>
      </html>
    `;
  };

  const handleDownloadPDF = async () => {
    if (!entry || !payrollRun) {
      toast.error('Pay statement not available for download');
      return;
    }

    setDownloading(true);
    try {
      const statementHTML = generateStatementHTML();
      
      if (!statementContentRef.current) {
        toast.error('Statement content not found');
        setDownloading(false);
        return;
      }

      // Wait for any images to load
      const images = statementContentRef.current.querySelectorAll('img');
      if (images.length > 0) {
        await Promise.all(
          Array.from(images).map(img => {
            if (img.complete) return Promise.resolve();
            return new Promise((resolve, reject) => {
              img.onload = resolve;
              img.onerror = reject;
              setTimeout(resolve, 5000); // Timeout after 5 seconds
            });
          })
        );
      }

      const opt = {
        margin: [0.2, 0.2, 0.2, 0.2],
        filename: `Pay Statement - ${entry.users.first_name} ${entry.users.last_name} - ${new Date(payrollRun.pay_period_end + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: payrollRun.businesses?.timezone || 'America/Toronto' })}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          letterRendering: true,
          allowTaint: true,
          height: statementContentRef.current.scrollHeight,
          width: statementContentRef.current.scrollWidth,
          windowWidth: statementContentRef.current.scrollWidth,
          windowHeight: statementContentRef.current.scrollHeight,
          backgroundColor: '#ffffff',
          removeContainer: false
        },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
        pagebreak: { mode: ['css'], avoid: ['.pay-table'] }
      };

      await html2pdf().set(opt).from(statementContentRef.current).save();
      toast.success('Pay statement downloaded successfully');
    } catch (error) {
      console.error('Error downloading PDF:', error);
      toast.error('Failed to download PDF: ' + error.message);
    } finally {
      setDownloading(false);
    }
  };

  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: TavariStyles.colors.gray50,
      padding: TavariStyles.spacing.xl,
      paddingTop: '100px'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.xl,
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.lg,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)'
    },
    backButton: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      padding: `${TavariStyles.spacing.sm} ${TavariStyles.spacing.md}`,
      backgroundColor: TavariStyles.colors.gray100,
      border: `1px solid ${TavariStyles.colors.gray300}`,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.sm,
      color: TavariStyles.colors.gray700,
      textDecoration: 'none'
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      color: TavariStyles.colors.gray800
    },
    downloadButton: {
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.xl}`,
      backgroundColor: TavariStyles.colors.primary,
      color: TavariStyles.colors.white,
      border: 'none',
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      cursor: 'pointer',
      fontSize: TavariStyles.typography.fontSize.sm,
      fontWeight: TavariStyles.typography.fontWeight.semibold
    },
    content: {
      backgroundColor: TavariStyles.colors.white,
      padding: TavariStyles.spacing.xl,
      borderRadius: TavariStyles.borderRadius?.lg || '12px',
      boxShadow: TavariStyles.shadows?.sm || '0 1px 3px rgba(0,0,0,0.1)'
    },
    errorBanner: {
      backgroundColor: TavariStyles.colors.danger + '15',
      border: `1px solid ${TavariStyles.colors.danger}`,
      padding: TavariStyles.spacing.md,
      borderRadius: TavariStyles.borderRadius?.md || '6px',
      display: 'flex',
      alignItems: 'center',
      gap: TavariStyles.spacing.sm,
      color: TavariStyles.colors.danger,
      marginBottom: TavariStyles.spacing.lg
    },
    loading: {
      textAlign: 'center',
      padding: TavariStyles.spacing['3xl'],
      color: TavariStyles.colors.gray600
    },
    statementContainer: {
      width: '100%',
      maxWidth: '8.5in',
      margin: '0 auto'
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading pay statement...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.errorBanner}>
          <AlertCircle size={20} />
          <div>{error}</div>
        </div>
        <button
          style={styles.backButton}
          onClick={() => navigate('/')}
        >
          <ArrowLeft size={16} />
          Return Home
        </button>
      </div>
    );
  }

  if (!entry || !payrollRun) {
    return (
      <div style={styles.container}>
        <div style={styles.errorBanner}>
          <AlertCircle size={20} />
          <div>Pay statement not found</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button
          style={styles.backButton}
          onClick={() => navigate('/')}
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <h1 style={styles.title}>
          Pay Statement - {entry.users.first_name} {entry.users.last_name}
        </h1>
        <button
          style={styles.downloadButton}
          onClick={handleDownloadPDF}
          disabled={downloading}
        >
          <Download size={18} />
          {downloading ? 'Downloading...' : 'Download PDF'}
        </button>
      </div>

      <div style={styles.content}>
        {(token === 'TEST' || token?.startsWith('TEST-') || (token && decodeURIComponent(token) === 'TEST')) && (
          <div style={{
            backgroundColor: '#fff3cd',
            border: '2px solid #ffc107',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '20px',
            color: '#856404',
            fontWeight: 'bold',
            textAlign: 'center'
          }}>
            🧪 TEST MODE: This is a mock pay statement for testing purposes. This data is not real.
          </div>
        )}
        <div 
          ref={statementContentRef}
          style={styles.statementContainer}
          dangerouslySetInnerHTML={{ __html: generateStatementHTML() }}
        />
      </div>
    </div>
  );
};

export default PayStatementViewScreen;

