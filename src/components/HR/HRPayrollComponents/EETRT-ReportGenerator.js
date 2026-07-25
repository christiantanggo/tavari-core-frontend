// components/HR/HRPayrollComponents/EETRT-ReportGenerator.js
import { TavariStyles } from '../../../utils/TavariStyles';
import { getBusinessTimezone, formatDateShort } from '../../../utils/businessDateFormat';

export const EETRT_generateReportHTML = (calculatedData, reportConfig, businessData, formatTaxAmount) => {
  const { employee, roeData, t4Data, payPeriodBreakdown, calculationPeriod, paymentFrequency } = calculatedData;
  const businessTimezone = getBusinessTimezone(businessData);

  const formatDate = (dateInput) => {
    if (!dateInput) return 'N/A';
    return formatDateShort(dateInput, businessTimezone);
  };
  const formatGeneratedDateTime = () => {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-CA', { timeZone: businessTimezone });
    const timeStr = now.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', timeZone: businessTimezone });
    return `${dateStr} ${timeStr}`;
  };

  const PAYMENT_FREQUENCIES = {
    'weekly': { label: 'Weekly (52 periods/year)', periods: 52 },
    'bi_weekly': { label: 'Bi-Weekly (26 periods/year)', periods: 26 },
    'semi_monthly': { label: 'Semi-Monthly (24 periods/year)', periods: 24 },
    'monthly': { label: 'Monthly (12 periods/year)', periods: 12 }
  };

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Employee Tax & Separation Report - ${employee.fullName}</title>
      <meta charset="UTF-8">
      <style>
        @page { size: 8.5in 11in; margin: 0.5in; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; line-height: 1.4; color: #000; font-size: 11px; }
        .header { text-align: center; border-bottom: 3px solid ${TavariStyles.colors.primary}; padding-bottom: 15px; margin-bottom: 20px; }
        .company-name { font-size: 18px; font-weight: bold; color: #000; margin-bottom: 5px; }
        .report-title { font-size: 14px; margin: 8px 0; font-weight: bold; text-transform: uppercase; letter-spacing: 0.8px; color: #000; }
        .two-column { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        .section { background: #f8f9fa; padding: 15px; border-radius: 8px; border: 1px solid #e9ecef; margin-bottom: 15px; }
        .section-title { font-size: 13px; font-weight: bold; color: #000; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
        .data-row { display: flex; justify-content: space-between; margin-bottom: 5px; padding: 3px 0; }
        .data-label { font-weight: 600; color: #000; }
        .data-value { color: #000; font-weight: 600; }
        .highlight { background: #fff3cd; padding: 2px 6px; border-radius: 4px; border: 1px solid #ffeaa7; color: #000; font-weight: 700; }
        .frequency-info { background: #e3f2fd; border: 1px solid #2196f3; border-radius: 6px; padding: 10px; margin-bottom: 15px; }
        .table { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 10px; }
        .table th, .table td { padding: 6px; text-align: left; border-bottom: 1px solid #dee2e6; color: #000; }
        .table th { background: #f8f9fa; font-weight: bold; font-size: 9px; text-transform: uppercase; color: #000; }
        .table .amount { text-align: right; font-family: monospace; color: #000; font-weight: 600; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="company-name">${businessData?.name || 'Tavari Business'}</div>
        <div class="report-title">Employee Tax & Separation Report</div>
        <div style="font-size: 12px; margin-top: 5px;">
          Generated on ${formatGeneratedDateTime()} (${businessTimezone}) | Payroll Period: ${formatDate(calculationPeriod.startDate)} to ${formatDate(calculationPeriod.endDate)}
        </div>
      </div>

      <div class="frequency-info">
        <div class="section-title">Payment Frequency Information</div>
        <div class="data-row">
          <span class="data-label">Effective Frequency:</span>
          <span class="data-value">${PAYMENT_FREQUENCIES[paymentFrequency.effective]?.label}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Pay Periods/Year:</span>
          <span class="data-value">${paymentFrequency.periodsPerYear}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Detection Method:</span>
          <span class="data-value">${paymentFrequency.isOverridden ? 'Manual Override' : `Auto-Detected (${paymentFrequency.confidence}% confidence)`}</span>
        </div>
      </div>

      <div class="two-column">
        <div class="section">
          <div class="section-title">Employee Information</div>
          <div class="data-row">
            <span class="data-label">Full Name:</span>
            <span class="data-value">${employee.fullName}</span>
          </div>
          <div class="data-row">
            <span class="data-label">Employee Number:</span>
            <span class="data-value">${employee.employeeNumber || 'N/A'}</span>
          </div>
          <div class="data-row">
            <span class="data-label">Email:</span>
            <span class="data-value">${employee.email || 'Not provided'}</span>
          </div>
          <div class="data-row">
            <span class="data-label">Hire Date:</span>
            <span class="data-value">${formatDate(employee.hireDate)}</span>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Separation Information</div>
          <div class="data-row">
            <span class="data-label">Last Day Worked:</span>
            <span class="data-value highlight">${reportConfig.lastDayWorked ? formatDate(reportConfig.lastDayWorked) : 'Not specified'}</span>
          </div>
          <div class="data-row">
            <span class="data-label">Separation Reason:</span>
            <span class="data-value">${reportConfig.separationReason || 'Not specified'}</span>
          </div>
        </div>
      </div>

      ${roeData ? `
      <div class="section">
        <div class="section-title">ROE Summary (Last ${roeData.payPeriods} Pay Periods)</div>
        <div class="two-column">
          <div>
            <div class="data-row">
              <span class="data-label">Total Insurable Earnings:</span>
              <span class="data-value highlight">${formatTaxAmount ? formatTaxAmount(roeData.totalInsurableEarnings) : roeData.totalInsurableEarnings.toFixed(2)}</span>
            </div>
            <div class="data-row">
              <span class="data-label">Total Hours Worked:</span>
              <span class="data-value">${roeData.totalHours.toFixed(2)} hours</span>
            </div>
          </div>
          <div>
            <div class="data-row">
              <span class="data-label">Average Weekly Earnings:</span>
              <span class="data-value highlight">${formatTaxAmount ? formatTaxAmount(roeData.averageWeeklyEarnings) : roeData.averageWeeklyEarnings.toFixed(2)}</span>
            </div>
            <div class="data-row">
              <span class="data-label">Pay Periods Used:</span>
              <span class="data-value">${roeData.payPeriods} periods</span>
            </div>
          </div>
        </div>
      </div>
      ` : ''}

      <div class="section">
        <div class="section-title">T4 Tax Summary (${calculationPeriod.type.replace('_', ' ').toUpperCase()})</div>
        <div class="two-column">
          <div>
            <div class="data-row">
              <span class="data-label">Actual Pay (Net):</span>
              <span class="data-value highlight">${formatTaxAmount ? formatTaxAmount(t4Data.box14_employmentIncome - t4Data.box22_incomeTax - t4Data.box16_cppContributions - t4Data.box18_eiPremiums) : (t4Data.box14_employmentIncome - t4Data.box22_incomeTax - t4Data.box16_cppContributions - t4Data.box18_eiPremiums).toFixed(2)}</span>
            </div>
            <div class="data-row">
              <span class="data-label">Employment Income (Box 14):</span>
              <span class="data-value highlight">${formatTaxAmount ? formatTaxAmount(t4Data.box14_employmentIncome) : t4Data.box14_employmentIncome.toFixed(2)}</span>
            </div>
            <div class="data-row">
              <span class="data-label">CPP Contributions (Box 16):</span>
              <span class="data-value">${formatTaxAmount ? formatTaxAmount(t4Data.box16_cppContributions) : t4Data.box16_cppContributions.toFixed(2)}</span>
            </div>
            <div class="data-row">
              <span class="data-label">EI Premiums (Box 18):</span>
              <span class="data-value">${formatTaxAmount ? formatTaxAmount(t4Data.box18_eiPremiums) : t4Data.box18_eiPremiums.toFixed(2)}</span>
            </div>
          </div>
          <div>
            <div class="data-row">
              <span class="data-label">Income Tax (Box 22):</span>
              <span class="data-value">${formatTaxAmount ? formatTaxAmount(t4Data.box22_incomeTax) : t4Data.box22_incomeTax.toFixed(2)}</span>
            </div>
            <div class="data-row">
              <span class="data-label">EI Insurable Earnings (Box 24):</span>
              <span class="data-value">${formatTaxAmount ? formatTaxAmount(t4Data.box24_eiInsurableEarnings) : t4Data.box24_eiInsurableEarnings.toFixed(2)}</span>
            </div>
            <div class="data-row">
              <span class="data-label">CPP Pensionable Earnings (Box 26):</span>
              <span class="data-value">${formatTaxAmount ? formatTaxAmount(t4Data.box26_cppPensionableEarnings) : t4Data.box26_cppPensionableEarnings.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- HARD CODED 53 PERIODS -->
      <div class="section">
        <div class="section-title">T4 Pay Period Breakdown (Last 53 Periods)</div>
        <table class="table">
          <thead>
            <tr>
              <th>Period #</th>
              <th>Pay Date</th>
              <th>Period Start</th>
              <th>Period End</th>
              <th class="amount">Gross Pay</th>
              <th class="amount">Insurable Earnings</th>
              <th class="amount">EI</th>
              <th class="amount">CPP</th>
              <th class="amount">Federal Tax</th>
              <th class="amount">Provincial Tax</th>
              <th class="amount">Additional Tax</th>
              <th class="amount">Total Tax</th>
            </tr>
          </thead>
          <tbody>
            ${payPeriodBreakdown.slice(0, 53).map((period, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>${formatDate(period.payDate)}</td>
                <td>${formatDate(period.weekStart)}</td>
                <td>${formatDate(period.weekEnd)}</td>
                <td class="amount">${formatTaxAmount ? formatTaxAmount(period.grossEarnings) : period.grossEarnings.toFixed(2)}</td>
                <td class="amount">${formatTaxAmount ? formatTaxAmount(period.insurableEarnings) : period.insurableEarnings.toFixed(2)}</td>
                <td class="amount">${formatTaxAmount ? formatTaxAmount(period.ei) : (period.ei || 0).toFixed(2)}</td>
                <td class="amount">${formatTaxAmount ? formatTaxAmount(period.cpp) : (period.cpp || 0).toFixed(2)}</td>
                <td class="amount">${formatTaxAmount ? formatTaxAmount(period.federalTax) : (period.federalTax || 0).toFixed(2)}</td>
                <td class="amount">${formatTaxAmount ? formatTaxAmount(period.provincialTax) : (period.provincialTax || 0).toFixed(2)}</td>
                <td class="amount">${formatTaxAmount ? formatTaxAmount(period.additionalTax) : (period.additionalTax || 0).toFixed(2)}</td>
                <td class="amount highlight">${formatTaxAmount ? formatTaxAmount(period.totalTax) : (period.totalTax || 0).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr style="background: #f8f9fa; font-weight: bold; border-top: 2px solid ${TavariStyles.colors.primary};">
              <td colspan="4">TOTALS (53 Periods):</td>
              <td class="amount">${formatTaxAmount ? formatTaxAmount(payPeriodBreakdown.slice(0, 53).reduce((sum, p) => sum + p.grossEarnings, 0)) : payPeriodBreakdown.slice(0, 53).reduce((sum, p) => sum + p.grossEarnings, 0).toFixed(2)}</td>
              <td class="amount">${formatTaxAmount ? formatTaxAmount(payPeriodBreakdown.slice(0, 53).reduce((sum, p) => sum + p.insurableEarnings, 0)) : payPeriodBreakdown.slice(0, 53).reduce((sum, p) => sum + p.insurableEarnings, 0).toFixed(2)}</td>
              <td class="amount">${formatTaxAmount ? formatTaxAmount(payPeriodBreakdown.slice(0, 53).reduce((sum, p) => sum + (p.ei || 0), 0)) : payPeriodBreakdown.slice(0, 53).reduce((sum, p) => sum + (p.ei || 0), 0).toFixed(2)}</td>
              <td class="amount">${formatTaxAmount ? formatTaxAmount(payPeriodBreakdown.slice(0, 53).reduce((sum, p) => sum + (p.cpp || 0), 0)) : payPeriodBreakdown.slice(0, 53).reduce((sum, p) => sum + (p.cpp || 0), 0).toFixed(2)}</td>
              <td class="amount">${formatTaxAmount ? formatTaxAmount(payPeriodBreakdown.slice(0, 53).reduce((sum, p) => sum + (p.federalTax || 0), 0)) : payPeriodBreakdown.slice(0, 53).reduce((sum, p) => sum + (p.federalTax || 0), 0).toFixed(2)}</td>
              <td class="amount">${formatTaxAmount ? formatTaxAmount(payPeriodBreakdown.slice(0, 53).reduce((sum, p) => sum + (p.provincialTax || 0), 0)) : payPeriodBreakdown.slice(0, 53).reduce((sum, p) => sum + (p.provincialTax || 0), 0).toFixed(2)}</td>
              <td class="amount">${formatTaxAmount ? formatTaxAmount(payPeriodBreakdown.slice(0, 53).reduce((sum, p) => sum + (p.additionalTax || 0), 0)) : payPeriodBreakdown.slice(0, 53).reduce((sum, p) => sum + (p.additionalTax || 0), 0).toFixed(2)}</td>
              <td class="amount highlight">${formatTaxAmount ? formatTaxAmount(payPeriodBreakdown.slice(0, 53).reduce((sum, p) => sum + (p.totalTax || 0), 0)) : payPeriodBreakdown.slice(0, 53).reduce((sum, p) => sum + (p.totalTax || 0), 0).toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
        <div style="margin-top: 10px; font-size: 10px; color: #000;">
          * Total Tax = Federal Tax + Provincial Tax + Additional Tax
          <br>* Provincial Tax includes Ontario Health Premium (OHP) where applicable
          <br>* This table shows the pay periods included in the T4 report; values are from payroll entries (same as pay statements)
        </div>
      </div>

      <div style="margin-top: 20px; font-size: 10px; color: #000; text-align: center;">
        Generated by Tavari Payroll System - CRA T4127 Compliant | ${formatGeneratedDateTime()} (${businessTimezone})
        <br>Payment Frequency: ${PAYMENT_FREQUENCIES[paymentFrequency.effective]?.label} ${paymentFrequency.isOverridden ? '(Manual Override)' : '(Auto-Detected)'}
      </div>
    </body>
    </html>
  `;
};

/**
 * Standalone Employee Payroll Deductions Report (separate from T4).
 * Shows per-period and YTD totals for all deductions; same data source as pay statements.
 */
export const EETRT_generateDeductionsReportHTML = (calculatedData, businessData, formatTaxAmount) => {
  const { employee, t4Data, payPeriodBreakdown, calculationPeriod } = calculatedData;
  const businessTimezone = getBusinessTimezone(businessData);

  const formatDate = (dateInput) => {
    if (!dateInput) return 'N/A';
    return formatDateShort(dateInput, businessTimezone);
  };
  const formatGeneratedDateTime = () => {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-CA', { timeZone: businessTimezone });
    const timeStr = now.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', timeZone: businessTimezone });
    return `${dateStr} ${timeStr}`;
  };

  const periods = payPeriodBreakdown || [];
  const totalGross = periods.reduce((s, p) => s + (p.grossEarnings || 0), 0);
  const totalFederal = periods.reduce((s, p) => s + (p.federalTax || 0), 0);
  const totalProvincial = periods.reduce((s, p) => s + (p.provincialTax || 0), 0);
  const totalCPP = periods.reduce((s, p) => s + (p.cpp || 0), 0);
  const totalEI = periods.reduce((s, p) => s + (p.ei || 0), 0);
  const totalAdditional = periods.reduce((s, p) => s + (p.additionalTax || 0), 0);
  const totalDeductions = totalFederal + totalProvincial + totalCPP + totalEI + totalAdditional;
  const totalNet = totalGross - totalDeductions;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Employee Payroll Deductions Report - ${employee.fullName}</title>
      <meta charset="UTF-8">
      <style>
        @page { size: 8.5in 11in; margin: 0.5in; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; line-height: 1.4; color: #000; font-size: 9px; }
        .header { text-align: center; border-bottom: 3px solid ${TavariStyles.colors.primary}; padding-bottom: 15px; margin-bottom: 20px; }
        .company-name { font-size: 14px; font-weight: bold; color: #000; margin-bottom: 5px; }
        .report-title { font-size: 11px; margin: 8px 0; font-weight: bold; text-transform: uppercase; letter-spacing: 0.8px; color: #000; }
        .section { background: #f8f9fa; padding: 15px; border-radius: 8px; border: 1px solid #e9ecef; margin-bottom: 15px; }
        .section-title { font-size: 10px; font-weight: bold; color: #000; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
        .data-row { display: flex; justify-content: space-between; margin-bottom: 5px; padding: 3px 0; }
        .data-label { font-weight: 600; color: #000; }
        .data-value { color: #000; font-weight: 600; }
        .table { width: 100%; border-collapse: collapse; font-size: 8px; margin-top: 10px; }
        .table th, .table td { padding: 6px; text-align: left; border-bottom: 1px solid #dee2e6; color: #000; }
        .table th { background: #f8f9fa; font-weight: bold; font-size: 7px; text-transform: uppercase; color: #000; }
        .table .amount { text-align: right; font-family: monospace; color: #000; font-weight: 600; }
        .footer { margin-top: 20px; font-size: 8px; color: #000; text-align: center; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="company-name">${businessData?.name || 'Tavari Business'}</div>
        <div class="report-title">Employee Payroll Deductions Report</div>
        <div style="font-size: 10px; margin-top: 5px;">
          Generated on ${formatGeneratedDateTime()} (${businessTimezone}) | Period: ${formatDate(calculationPeriod?.startDate)} to ${formatDate(calculationPeriod?.endDate)}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Employee</div>
        <div class="data-row"><span class="data-label">Name:</span><span class="data-value">${employee.fullName}</span></div>
        <div class="data-row"><span class="data-label">Employee #:</span><span class="data-value">${employee.employeeNumber || 'N/A'}</span></div>
        <div class="data-row"><span class="data-label">Email:</span><span class="data-value">${employee.email || '—'}</span></div>
      </div>

      <div class="section">
        <div class="section-title">Deductions by pay period</div>
        <table class="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Pay date</th>
              <th>Period start</th>
              <th>Period end</th>
              <th class="amount">Gross</th>
              <th class="amount">Federal tax</th>
              <th class="amount">Provincial tax</th>
              <th class="amount">CPP</th>
              <th class="amount">EI</th>
              <th class="amount">Additional tax</th>
              <th class="amount">Total deductions</th>
              <th class="amount">Net pay</th>
            </tr>
          </thead>
          <tbody>
            ${periods.map((p, i) => {
              const totDed = (p.federalTax || 0) + (p.provincialTax || 0) + (p.cpp || 0) + (p.ei || 0) + (p.additionalTax || 0);
              const net = (p.grossEarnings || 0) - totDed;
              return `<tr>
                <td>${i + 1}</td>
                <td>${formatDate(p.payDate)}</td>
                <td>${formatDate(p.weekStart)}</td>
                <td>${formatDate(p.weekEnd)}</td>
                <td class="amount">${formatTaxAmount ? formatTaxAmount(p.grossEarnings) : (p.grossEarnings || 0).toFixed(2)}</td>
                <td class="amount">${formatTaxAmount ? formatTaxAmount(p.federalTax) : (p.federalTax || 0).toFixed(2)}</td>
                <td class="amount">${formatTaxAmount ? formatTaxAmount(p.provincialTax) : (p.provincialTax || 0).toFixed(2)}</td>
                <td class="amount">${formatTaxAmount ? formatTaxAmount(p.cpp) : (p.cpp || 0).toFixed(2)}</td>
                <td class="amount">${formatTaxAmount ? formatTaxAmount(p.ei) : (p.ei || 0).toFixed(2)}</td>
                <td class="amount">${formatTaxAmount ? formatTaxAmount(p.additionalTax) : (p.additionalTax || 0).toFixed(2)}</td>
                <td class="amount">${formatTaxAmount ? formatTaxAmount(totDed) : totDed.toFixed(2)}</td>
                <td class="amount">${formatTaxAmount ? formatTaxAmount(net) : net.toFixed(2)}</td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr style="background: #f8f9fa; font-weight: bold; border-top: 2px solid ${TavariStyles.colors.primary};">
              <td colspan="4">Totals</td>
              <td class="amount">${formatTaxAmount ? formatTaxAmount(totalGross) : totalGross.toFixed(2)}</td>
              <td class="amount">${formatTaxAmount ? formatTaxAmount(totalFederal) : totalFederal.toFixed(2)}</td>
              <td class="amount">${formatTaxAmount ? formatTaxAmount(totalProvincial) : totalProvincial.toFixed(2)}</td>
              <td class="amount">${formatTaxAmount ? formatTaxAmount(totalCPP) : totalCPP.toFixed(2)}</td>
              <td class="amount">${formatTaxAmount ? formatTaxAmount(totalEI) : totalEI.toFixed(2)}</td>
              <td class="amount">${formatTaxAmount ? formatTaxAmount(totalAdditional) : totalAdditional.toFixed(2)}</td>
              <td class="amount">${formatTaxAmount ? formatTaxAmount(totalDeductions) : totalDeductions.toFixed(2)}</td>
              <td class="amount">${formatTaxAmount ? formatTaxAmount(totalNet) : totalNet.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
        <p style="margin-top: 10px; font-size: 8px; color: #000;">Provincial tax includes Ontario Health Premium where applicable. Values are from payroll entries (same as pay statements).</p>
      </div>

      ${t4Data ? `
      <div class="section">
        <div class="section-title">YTD summary (for period)</div>
        <div class="data-row"><span class="data-label">Employment income (Gross + Vacation):</span><span class="data-value">${formatTaxAmount ? formatTaxAmount(t4Data.box14_employmentIncome) : (t4Data.box14_employmentIncome || 0).toFixed(2)}</span></div>
        <div class="data-row"><span class="data-label">Income tax deducted (Box 22):</span><span class="data-value">${formatTaxAmount ? formatTaxAmount(t4Data.box22_incomeTax) : (t4Data.box22_incomeTax || 0).toFixed(2)}</span></div>
        <div class="data-row"><span class="data-label">CPP:</span><span class="data-value">${formatTaxAmount ? formatTaxAmount(t4Data.box16_cppContributions) : (t4Data.box16_cppContributions || 0).toFixed(2)}</span></div>
        <div class="data-row"><span class="data-label">EI:</span><span class="data-value">${formatTaxAmount ? formatTaxAmount(t4Data.box18_eiPremiums) : (t4Data.box18_eiPremiums || 0).toFixed(2)}</span></div>
      </div>
      ` : ''}

      <div class="footer">
        Tavari Payroll – Deductions report (not a T4). ${formatGeneratedDateTime()} (${businessTimezone})
      </div>
    </body>
    </html>
  `;
};