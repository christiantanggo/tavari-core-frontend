// components/HR/HRPayrollComponents/PayStatementGenerator.jsx - DEBUG VERSION
import React from 'react';
import { useSecurityContext } from '../../../Security';
import { useTaxCalculations } from '../../../hooks/useTaxCalculations';
import { TavariStyles } from '../../../utils/TavariStyles';

export class PayStatementGenerator {
  constructor(businessId, businessData, logSecurityEvent, recordAction, checkRateLimit, formatTaxAmount) {
    this.businessId = businessId;
    this.businessData = businessData;
    this.logSecurityEvent = logSecurityEvent;
    this.recordAction = recordAction;
    this.checkRateLimit = checkRateLimit;
    this.formatTaxAmount = formatTaxAmount;
    
    // Debug logging
    console.log('PayStatementGenerator initialized with:', {
      businessId: this.businessId,
      businessData: this.businessData,
      hasFormatTaxAmount: !!this.formatTaxAmount
    });
  }

  generatePDFFilename(entry, selectedRun) {
    const firstName = entry.users?.first_name || 'Unknown';
    const lastName = entry.users?.last_name || 'User';
    const payPeriodEnd = new Date(selectedRun.pay_period_end);
    const formattedDate = payPeriodEnd.toLocaleDateString('en-CA');
    
    return `Pay Statement - ${firstName} ${lastName} - ${formattedDate}`;
  }

  parsePremiumsFromEntry(entry) {
    try {
      let premiums = {};
      
      if (entry.premiums) {
        if (typeof entry.premiums === 'string') {
          premiums = JSON.parse(entry.premiums);
        } else if (typeof entry.premiums === 'object') {
          premiums = entry.premiums;
        }
      }

      if (!premiums || typeof premiums !== 'object') {
        return {};
      }

      const normalizedPremiums = {};
      Object.entries(premiums).forEach(([key, value]) => {
        if (typeof value === 'object' && value !== null) {
          normalizedPremiums[key] = {
            rate: parseFloat(value.rate || 0),
            hours: parseFloat(value.hours || 0),
            total_pay: parseFloat(value.total_pay || 0),
            applies_to_all_hours: value.applies_to_all_hours || false
          };
        } else if (typeof value === 'number') {
          normalizedPremiums[key] = {
            rate: 0,
            hours: parseFloat(entry.regular_hours || 0) + parseFloat(entry.overtime_hours || 0),
            total_pay: parseFloat(value),
            applies_to_all_hours: true
          };
        }
      });

      return normalizedPremiums;
    } catch (e) {
      console.warn('Error parsing premiums for entry:', entry.id, e);
      return {};
    }
  }

  calculateEntryPremiumPay(entry) {
    const premiums = this.parsePremiumsFromEntry(entry);
    let total = 0;
    
    Object.values(premiums).forEach(premium => {
      total += premium.total_pay || 0;
    });
    
    return total;
  }

  async calculateYTDTotals(userId, payDate) {
    // For debugging, return mock data instead of database call
    console.log('calculateYTDTotals called for user:', userId, 'payDate:', payDate);
    
    return {
      regular_hours: 100, overtime_hours: 10, lieu_hours: 0, stat_hours: 0, holiday_hours: 0,
      regular_earnings: 2000, overtime_earnings: 300, lieu_earnings: 0, stat_earnings: 0, holiday_earnings: 0,
      shift_premiums: 150, vacation_pay: 200, bonus: 0, gross_pay: 2650, federal_tax: 400, provincial_tax: 200,
      ei_deduction: 50, cpp_deduction: 100, additional_tax: 0, net_pay: 1900
    };
  }

  // Create a simple test HTML to verify the download mechanism works
  generateTestHTML(entry, selectedRun) {
    const filename = this.generatePDFFilename(entry, selectedRun);
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${filename}</title>
        <meta charset="UTF-8">
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 20px;
            line-height: 1.6;
            color: #333;
          }
          .header {
            text-align: center;
            border-bottom: 2px solid #008080;
            padding-bottom: 10px;
            margin-bottom: 20px;
          }
          .company-name {
            font-size: 24px;
            font-weight: bold;
            color: #008080;
          }
          .employee-info {
            background: #f5f5f5;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
          }
          th, td {
            padding: 10px;
            border: 1px solid #ddd;
            text-align: left;
          }
          th {
            background-color: #008080;
            color: white;
          }
          .number {
            text-align: right;
            font-family: monospace;
          }
          @media print {
            body { margin: 0; }
            @page { size: letter; margin: 0.5in; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="company-name">${this.businessData?.name || 'Test Company'}</div>
          <h2>Employee Pay Statement - TEST VERSION</h2>
        </div>

        <div class="employee-info">
          <h3>Employee Information</h3>
          <p><strong>Name:</strong> ${entry.users?.first_name || 'Test'} ${entry.users?.last_name || 'Employee'}</p>
          <p><strong>Employee ID:</strong> ${entry.user_id?.slice(-8).toUpperCase() || 'TEST123'}</p>
          <p><strong>Email:</strong> ${entry.users?.email || 'test@example.com'}</p>
          <p><strong>Pay Period:</strong> ${new Date(selectedRun.pay_period_start).toLocaleDateString()} to ${new Date(selectedRun.pay_period_end).toLocaleDateString()}</p>
          <p><strong>Pay Date:</strong> ${new Date(selectedRun.pay_date).toLocaleDateString()}</p>
        </div>

        <table>
          <thead>
            <tr>
              <th>Earnings</th>
              <th>Hours</th>
              <th>Rate</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Regular Pay</td>
              <td class="number">${parseFloat(entry.regular_hours || 0).toFixed(2)}</td>
              <td class="number">$${this.formatTaxAmount ? this.formatTaxAmount(parseFloat(entry.users?.wage || 20)) : '20.00'}</td>
              <td class="number">$${this.formatTaxAmount ? this.formatTaxAmount(parseFloat(entry.regular_hours || 0) * parseFloat(entry.users?.wage || 20)) : '0.00'}</td>
            </tr>
            <tr>
              <td>Gross Pay</td>
              <td class="number">-</td>
              <td class="number">-</td>
              <td class="number">$${this.formatTaxAmount ? this.formatTaxAmount(parseFloat(entry.gross_pay || 0)) : '0.00'}</td>
            </tr>
          </tbody>
        </table>

        <table>
          <thead>
            <tr>
              <th>Deductions</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Federal Tax</td>
              <td class="number">$${this.formatTaxAmount ? this.formatTaxAmount(parseFloat(entry.federal_tax || 0)) : '0.00'}</td>
            </tr>
            <tr>
              <td>Provincial Tax</td>
              <td class="number">$${this.formatTaxAmount ? this.formatTaxAmount(parseFloat(entry.provincial_tax || 0)) : '0.00'}</td>
            </tr>
            <tr>
              <td>CPP</td>
              <td class="number">$${this.formatTaxAmount ? this.formatTaxAmount(parseFloat(entry.cpp_deduction || 0)) : '0.00'}</td>
            </tr>
            <tr>
              <td>EI</td>
              <td class="number">$${this.formatTaxAmount ? this.formatTaxAmount(parseFloat(entry.ei_deduction || 0)) : '0.00'}</td>
            </tr>
            <tr style="background-color: #f0f0f0; font-weight: bold;">
              <td>Net Pay</td>
              <td class="number">$${this.formatTaxAmount ? this.formatTaxAmount(parseFloat(entry.net_pay || 0)) : '0.00'}</td>
            </tr>
          </tbody>
        </table>

        <div style="margin-top: 30px; text-align: center; font-size: 12px; color: #333;">
          <p><strong>This is a test pay statement generated by Tavari HR Payroll System.</strong></p>
          <p>Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</p>
          <p style="margin-top: 20px; color: red; font-weight: bold;">DEBUG INFO:</p>
          <p>Business ID: ${this.businessId}</p>
          <p>Entry ID: ${entry.id}</p>
          <p>User ID: ${entry.user_id}</p>
          <p>Has formatTaxAmount: ${!!this.formatTaxAmount}</p>
        </div>
      </body>
      </html>
    `;
  }

  async generatePayStatement(entry, selectedRun, isBulkGeneration = false) {
    try {
      console.log('🔍 DEBUG: generatePayStatement called with:', {
        entryId: entry?.id,
        userId: entry?.user_id,
        runId: selectedRun?.id,
        isBulk: isBulkGeneration,
        entryKeys: Object.keys(entry || {}),
        runKeys: Object.keys(selectedRun || {}),
        userKeys: Object.keys(entry?.users || {})
      });

      // Skip rate limiting for debugging
      console.log('⏭️ Skipping rate limiting for debug');

      // Generate simple test HTML instead of complex version
      console.log('📄 Generating test HTML...');
      const testHTML = this.generateTestHTML(entry, selectedRun);
      const filename = this.generatePDFFilename(entry, selectedRun);

      console.log('📏 Generated HTML length:', testHTML.length);
      console.log('📄 HTML preview (first 300 chars):', testHTML.substring(0, 300));
      console.log('📄 HTML preview (last 300 chars):', testHTML.substring(testHTML.length - 300));

      // Create blob and test download
      console.log('💾 Creating blob...');
      const blob = new Blob([testHTML], { 
        type: 'text/html;charset=utf-8' 
      });
      
      console.log('📦 Blob created, size:', blob.size, 'type:', blob.type);

      const url = URL.createObjectURL(blob);
      console.log('🔗 Object URL created:', url);

      const link = document.createElement('a');
      link.href = url;
      link.download = filename + '.html';
      link.style.display = 'none';
      
      console.log('🔗 Download link created:', {
        href: link.href,
        download: link.download,
        style: link.style.display
      });

      // Add to DOM and trigger download
      document.body.appendChild(link);
      console.log('📎 Link added to DOM');
      
      link.click();
      console.log('🖱️ Link clicked - download should start');
      
      // Test if link is actually working
      setTimeout(() => {
        console.log('🧹 Cleanup: removing link and revoking URL');
        if (document.body.contains(link)) {
          document.body.removeChild(link);
        }
        URL.revokeObjectURL(url);
      }, 2000);

      return { success: true, filename: filename + '.html' };

    } catch (error) {
      console.error('❌ Error in generatePayStatement:', error);
      console.error('❌ Error stack:', error.stack);
      throw error;
    }
  }

  async bulkDownloadStatements(selectedEntries, selectedRun) {
    const results = [];
    const failedEmployees = [];
    
    console.log('🚀 Starting bulk download DEBUG for', selectedEntries.length, 'employees');
    
    for (let i = 0; i < selectedEntries.length; i++) {
      const entry = selectedEntries[i];
      const employeeName = `${entry.users?.first_name || 'Unknown'} ${entry.users?.last_name || 'User'}`;
      
      try {
        console.log(`📋 Processing ${i + 1}/${selectedEntries.length}: ${employeeName}`);
        
        const result = await this.generatePayStatement(entry, selectedRun, true);
        if (result && result.success) {
          results.push(result);
          console.log(`✅ Successfully generated file for ${employeeName}`);
        } else {
          throw new Error('File generation returned false success');
        }
      } catch (error) {
        console.error(`❌ Error generating file for ${employeeName}:`, error);
        failedEmployees.push(employeeName);
      }
      
      // Delay between downloads
      if (i < selectedEntries.length - 1) {
        console.log('⏱️ Waiting 2 seconds before next download...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log('🏁 Bulk download complete. Success:', results.length, 'Failed:', failedEmployees.length);
    return { results, failedEmployees };
  }
}

export default PayStatementGenerator;