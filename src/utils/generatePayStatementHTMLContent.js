import { TavariStyles } from './TavariStyles';
import { formatLastWageAdjustmentDisplay } from '../helpers/Payroll/fetchLastWageAdjustmentForPayStatement';

const LIEU_TYPE_LABELS = {
  earned: 'Earned',
  used: 'Used',
  adjustment: 'Adj.',
  payout: 'Payout',
};

function escapePayStatementHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatLieuHoursForStatement(value) {
  const n = parseFloat(value) || 0;
  const sign = n >= 0 ? '+' : '-';
  return `${sign}${Math.abs(n).toFixed(2)} hrs`;
}

function buildLieuTimePayStatementSection(entries, timezone = 'America/Toronto') {
  if (!entries?.length) {
    return `
        <div class="lieu-section compact-section page-break-avoid">
          <div class="lieu-section-title">Recent Lieu Time Activity</div>
          <p class="lieu-empty">No lieu time transactions on record.</p>
        </div>`;
  }

  const rows = entries
    .map((tx) => {
      const dateRaw = tx.transaction_date || tx.created_at;
      const dateLabel = dateRaw
        ? new Date(dateRaw).toLocaleDateString('en-CA', { timeZone: timezone })
        : '—';
      const typeLabel = LIEU_TYPE_LABELS[tx.transaction_type] || tx.transaction_type || '—';
      const sourceLabel = tx.source === 'payroll' ? 'Payroll' : 'Manual';
      const desc = escapePayStatementHtml(tx.description || '—');
      return `
            <tr>
              <td>${dateLabel}</td>
              <td>${escapePayStatementHtml(typeLabel)}</td>
              <td class="number">${formatLieuHoursForStatement(tx.hours_amount)}</td>
              <td>${sourceLabel}</td>
              <td>${desc}</td>
            </tr>`;
    })
    .join('');

  return `
        <div class="lieu-section compact-section page-break-avoid">
          <div class="lieu-section-title">Recent Lieu Time Activity (Last ${entries.length} Entries)</div>
          <table class="pay-table lieu-table">
            <colgroup>
              <col class="col-date" />
              <col class="col-type" />
              <col class="col-hours" />
              <col class="col-source" />
              <col class="col-desc" />
            </colgroup>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Hours</th>
                <th>Source</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>`;
}

/**
 * Single source of truth for pay statement HTML (HR Payroll + Employee Portal).
 * Both interactive downloads and email attachments render this HTML through
 * the same headless Chromium pipeline (`src/utils/htmlDocumentPdf.js` →
 * `api/render-pay-statement-pdf`), so the resulting PDFs are visually
 * identical regardless of which surface produces them.
 *
 * @param {object} params
 * @param {object} params.entry – hrpayroll_entries row with nested `users`
 * @param {object} params.ytdTotals – normalized YTD including current period (see payStatementYTD)
 * @param {number} params.ytdCalculationTime – ms, for footer diagnostic
 * @param {object} params.payrollRun – hrpayroll_runs row (dates, ids)
 * @param {object} [params.businessData] – business row (name / business_name, timezone)
 * @param {(n: number|string) => string} params.formatTaxAmount
 * @param {string} [params.generatedByLabel] – shown in footer (e.g. manager email or "Employee Portal")
 * @param {boolean} [params.lieuTimeEnabled] – when true, show lieu balance + recent activity
 * @param {object[]} [params.lieuTimeEntries] – up to 10 recent lieu rows for the statement footer
 * @param {{ previous_wage?: number, new_wage?: number, effective_date?: string } | null} [params.lastWageAdjustment]
 */
export function generatePayStatementHTMLContent({
  entry,
  ytdTotals,
  ytdCalculationTime,
  payrollRun,
  businessData,
  formatTaxAmount,
  generatedByLabel = 'System',
  lieuTimeEnabled = false,
  lieuTimeEntries = [],
  lastWageAdjustment = null,
}) {
  const effectiveBusinessData = businessData || {};
  const businessFooterName =
    effectiveBusinessData.name ?? effectiveBusinessData.business_name ?? 'N/A';
  const businessTimezone = effectiveBusinessData?.timezone || 'America/Toronto';
  const lastWageAdjustmentLabel = formatLastWageAdjustmentDisplay(
    lastWageAdjustment,
    formatTaxAmount,
    businessTimezone
  );

  let premiums = {};
  try {
    premiums =
      typeof entry.premiums === 'string'
        ? JSON.parse(entry.premiums)
        : entry.premiums || {};
  } catch (e) {
    console.warn('Error parsing premiums:', e);
    premiums = {};
  }

  let wageBreakdown = [];
  let hasWageChange = false;
  try {
    if (entry.wage_breakdown) {
      wageBreakdown =
        typeof entry.wage_breakdown === 'string'
          ? JSON.parse(entry.wage_breakdown)
          : entry.wage_breakdown;
      hasWageChange = Array.isArray(wageBreakdown) && wageBreakdown.length > 1;
    }
  } catch (e) {
    console.warn('Error parsing wage breakdown:', e);
  }

  const currentGrossPay = parseFloat(entry.gross_pay || 0);
  const currentVacationPay = parseFloat(entry.vacation_pay || 0);
  const totalGrossWithVacation = currentGrossPay + currentVacationPay;

  const currentFederalTax = parseFloat(entry.federal_tax || 0);
  const currentProvincialTax = parseFloat(entry.provincial_tax || 0);
  const currentOntarioHealthPremium = parseFloat(entry.ontario_health_premium || 0);
  const currentEIDeduction = parseFloat(entry.ei_deduction || 0);
  const currentCPPDeduction = parseFloat(entry.cpp_deduction || 0);
  const currentAdditionalTax = parseFloat(entry.additional_tax || 0);

  const totalCurrentDeductions =
    currentFederalTax +
    currentProvincialTax +
    currentOntarioHealthPremium +
    currentEIDeduction +
    currentCPPDeduction +
    currentAdditionalTax;

  const regularHours = parseFloat(entry.regular_hours || 0);
  const overtimeHours = parseFloat(entry.overtime_hours || 0);
  const lieuHours = parseFloat(entry.lieu_hours || 0);
  const statHolidayHours = parseFloat(entry.stat_holiday_hours || 0);
  const totalCurrentHours = regularHours + overtimeHours + lieuHours + statHolidayHours;

  const baseWage = parseFloat(entry.users?.wage || 0);

  let regularEarnings = 0;
  let overtimeEarnings = 0;
  let lieuEarnings = 0;

  if (hasWageChange && wageBreakdown.length > 0) {
    wageBreakdown.forEach((period) => {
      if (!period.is_lieu_payment) {
        regularEarnings += parseFloat(period.regular_pay || 0);
        overtimeEarnings += parseFloat(period.overtime_pay || 0);
      } else {
        lieuEarnings += parseFloat(period.lieu_pay || 0);
      }
    });
  } else {
    regularEarnings = regularHours * baseWage;
    overtimeEarnings = overtimeHours * baseWage * 1.5;
    lieuEarnings = lieuHours * baseWage;
  }

  const statEarnings = statHolidayHours * baseWage * 1.5;
  const holidayEarnings = parseFloat(entry.holiday_pay || 0);

  const finalYTDTotals = ytdTotals;

  const ytdTotalHours =
    (parseFloat(finalYTDTotals.regular_hours || 0) || 0) +
    (parseFloat(finalYTDTotals.overtime_hours || 0) || 0) +
    (parseFloat(finalYTDTotals.lieu_hours || 0) || 0) +
    (parseFloat(finalYTDTotals.stat_hours || 0) || 0) +
    (parseFloat(finalYTDTotals.holiday_hours || 0) || 0);

  const ytdGrossPay = finalYTDTotals.gross_pay + finalYTDTotals.vacation_pay;
  const totalYTDDeductions =
    finalYTDTotals.federal_tax +
    finalYTDTotals.provincial_tax +
    finalYTDTotals.ei_deduction +
    finalYTDTotals.cpp_deduction +
    finalYTDTotals.additional_tax;

  const businessTimezoneForTitle = effectiveBusinessData?.timezone || 'America/Toronto';
  const payPeriodEndDateForTitle = new Date(payrollRun.pay_period_end + 'T12:00:00');
  const formattedDateForTitle = payPeriodEndDateForTitle.toLocaleDateString('en-CA', {
    timeZone: businessTimezoneForTitle,
  });

  const empFirst = entry.users?.first_name ?? 'Unknown';
  const empLast = entry.users?.last_name ?? 'User';

  return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Pay Statement - ${empFirst} ${empLast} - ${formattedDateForTitle}</title>
        <meta charset="UTF-8">
        <style>
          @page { 
            size: letter;
            margin: 0;
          }
          html, body {
            box-sizing: border-box;
            max-width: 100%;
            overflow: visible;
          }
          *, *::before, *::after {
            box-sizing: border-box;
          }
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 0;
            line-height: 1.35;
            color: #000;
            background-color: #fff;
            font-size: 14px;
            width: 100%;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .statement-content {
            width: 100%;
            max-width: 100%;
            padding: 0.4in 0.2in 0.25in 0.2in;
            overflow: visible;
          }
          .statement-top-table {
            width: 100%;
            border-collapse: collapse;
            margin: 0 0 10px 0;
            table-layout: fixed;
          }
          .statement-top-table .header-cell {
            text-align: center;
            vertical-align: bottom;
            padding: 0 0 10px 0;
            border-bottom: 2px solid ${TavariStyles.colors.primary};
            background: #fff;
          }
          .statement-top-table .header-spacer td {
            height: 20px;
            padding: 0;
            margin: 0;
            border: none;
            background: #fff;
            font-size: 1px;
            line-height: 1px;
          }
          .statement-top-table .info-cell {
            width: 50%;
            vertical-align: top;
            padding: 10px 10px 8px 10px;
            line-height: 1.5;
            color: #000;
            background-color: ${TavariStyles.colors.gray100};
            border: 1px solid ${TavariStyles.colors.gray200};
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .statement-top-table .info-cell strong {
            color: #000;
            font-weight: 600;
          }
          .company-name {
            font-size: 20px;
            font-weight: bold;
            color: ${TavariStyles.colors.primary};
            margin: 0 0 4px 0;
            line-height: 1.25;
          }
          .statement-title {
            font-size: 16px;
            margin: 0;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            line-height: 1.3;
            color: #000;
          }
          .pay-table {
            width: 100%;
            max-width: 100%;
            table-layout: fixed;
            border-collapse: collapse;
            margin: 4px 0;
            font-size: 13px;
          }
          .pay-table th, .pay-table td {
            padding: 3px 4px;
            border: 1px solid ${TavariStyles.colors.gray300};
            text-align: left;
            color: #000;
            overflow-wrap: anywhere;
            word-wrap: break-word;
          }
          .pay-table th {
            background-color: ${TavariStyles.colors.primary};
            font-weight: 600;
            color: #ffffff;
            text-transform: uppercase;
            font-size: 13px;
            letter-spacing: 0.3px;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .pay-table td.number {
            text-align: right;
            font-family: 'Courier New', monospace;
            font-size: 14px;
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
          .lieu-section {
            margin-top: 8px;
          }
          .lieu-section-title {
            font-size: 14px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            margin: 4px 0;
            color: #000;
          }
          .lieu-table {
            font-size: 11px;
          }
          .lieu-table th,
          .lieu-table td {
            padding: 2px 3px;
            font-size: 11px;
          }
          .lieu-table .col-date { width: 14%; }
          .lieu-table .col-type { width: 16%; }
          .lieu-table .col-hours { width: 12%; }
          .lieu-table .col-source { width: 10%; }
          .lieu-table .col-desc { width: 48%; }
          .lieu-empty {
            font-size: 13px;
            color: #333;
            margin: 4px 0;
          }
          .lieu-table th:last-child,
          .lieu-table td:last-child {
            max-width: none;
            word-wrap: break-word;
          }
          @media print {
            body { 
              margin: 0; 
              padding: 0; 
              font-size: 14px;
              width: 100%; 
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              background: white !important;
            }
            .statement-content {
              padding: 0.4in 0.2in 0.25in 0.2in;
            }
            .page-break-avoid {
              page-break-inside: avoid;
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
        <div class="statement-content">
        <table class="statement-top-table">
          <tr>
            <td class="header-cell" colspan="2">
              <div class="company-name">${businessFooterName}</div>
              <div class="statement-title">Employee pay statement — ${formattedDateForTitle}</div>
            </td>
          </tr>
          <tr class="header-spacer">
            <td colspan="2">&nbsp;</td>
          </tr>
          <tr>
            <td class="info-cell">
              <strong>Employee:</strong> ${empFirst} ${empLast}<br>
              <strong>Employee ID:</strong> ${entry.user_id.slice(-8).toUpperCase()}<br>
              <strong>Email:</strong> ${entry.users?.email || 'N/A'}<br>
              ${entry.users?.hire_date ? `<strong>Hire Date:</strong> ${new Date(entry.users.hire_date + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })}<br>` : ''}
              <strong>Total YTD Hours:</strong> ${ytdTotalHours.toFixed(2)} hours<br>
            </td>
            <td class="info-cell">
              <strong>Pay Period:</strong> ${new Date(payrollRun.pay_period_start + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })} to ${new Date(payrollRun.pay_period_end + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })}<br>
              <strong>Pay Date:</strong> ${new Date(payrollRun.pay_date + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: effectiveBusinessData?.timezone || 'America/Toronto' })}<br>
              <strong>Base Rate:</strong> $${formatTaxAmount(baseWage)}/hr<br>
              <strong>Last Wage Adjustment:</strong> ${lastWageAdjustmentLabel}<br>
              ${lieuTimeEnabled ? `<strong>Lieu Time Balance:</strong> ${parseFloat(entry.lieu_balance_after || 0).toFixed(2)} hours<br>` : ''}
              ${Object.keys(premiums).length > 0 ? `<strong>Active Premiums:</strong> ${Object.keys(premiums).length}<br>` : ''}
            </td>
          </tr>
        </table>

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
              ${wageBreakdown.filter((p) => !p.is_lieu_payment).map((period, idx) => `
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

        ${lieuTimeEnabled ? buildLieuTimePayStatementSection(lieuTimeEntries, effectiveBusinessData?.timezone || 'America/Toronto') : ''}

        <div class="footer">
          <p><strong>This pay statement was generated electronically by Tavari HR Payroll System.</strong></p>
          <p>Generated by: ${generatedByLabel} | Business: ${businessFooterName} | ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</p>
          <p>YTD Calculation: Fast lookup (${ytdCalculationTime}ms) | Source: ${finalYTDTotals._ytd_source || 'standard'}</p>
        </div>
        </div>
      </body>
      </html>
    `;
}
