// hooks/usePDFGenerator.js - React Hook for Tavari PDF Generator

import { useState, useCallback } from 'react';
import TavariPDFGenerator, { pdfGenerator, PDFUtils } from '../helpers/TavariPDFGenerator';
import toast from 'react-hot-toast';

/**
 * Custom React hook for PDF generation
 * Provides state management and easy integration with React components
 */
export const usePDFGenerator = (defaultOptions = {}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  // Initialize generator with custom options if provided
  const generator = new TavariPDFGenerator(defaultOptions);

  /**
   * Generate PDF with loading state management
   */
  const generatePDF = useCallback(async (config) => {
    setIsGenerating(true);
    setError(null);
    setProgress('Preparing PDF...');

    try {
      setProgress('Processing template...');
      
      const result = await generator.generatePDF(config);
      
      setProgress('PDF generated successfully');
      toast.success(`PDF "${result.filename}" generated successfully`);
      
      return result;
      
    } catch (err) {
      console.error('PDF Generation Error:', err);
      setError(err.message);
      toast.error(`PDF generation failed: ${err.message}`);
      throw err;
      
    } finally {
      setIsGenerating(false);
      setTimeout(() => setProgress(null), 2000); // Clear progress after 2 seconds
    }
  }, [generator]);

  /**
   * Generate PDF for email with loading states
   */
  const generateForEmail = useCallback(async (config) => {
    return await generatePDF({
      ...config,
      outputType: 'base64'
    });
  }, [generatePDF]);

  /**
   * Generate PDF and trigger download
   */
  const generateAndDownload = useCallback(async (config) => {
    setIsGenerating(true);
    setError(null);
    setProgress('Preparing download...');

    try {
      const result = await generator.generatePDF({
        ...config,
        outputType: 'blob'
      });

      // Create download link
      const url = URL.createObjectURL(result.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setProgress('Download started');
      toast.success(`Downloading "${result.filename}"`);
      
      return result;
      
    } catch (err) {
      console.error('PDF Download Error:', err);
      setError(err.message);
      toast.error(`Download failed: ${err.message}`);
      throw err;
      
    } finally {
      setIsGenerating(false);
      setTimeout(() => setProgress(null), 2000);
    }
  }, [generator]);

  /**
   * Generate multiple PDFs in batch
   */
  const generateBatch = useCallback(async (configs) => {
    setIsGenerating(true);
    setError(null);
    
    const results = [];
    const errors = [];

    try {
      for (let i = 0; i < configs.length; i++) {
        setProgress(`Generating PDF ${i + 1} of ${configs.length}...`);
        
        try {
          const result = await generator.generatePDF(configs[i]);
          results.push(result);
        } catch (err) {
          console.error(`Error generating PDF ${i + 1}:`, err);
          errors.push({ index: i, error: err.message, config: configs[i] });
        }
      }

      if (errors.length > 0) {
        const message = `Generated ${results.length} PDFs with ${errors.length} errors`;
        toast.error(message);
        setError(message);
      } else {
        toast.success(`Successfully generated ${results.length} PDFs`);
      }

      return { results, errors };
      
    } finally {
      setIsGenerating(false);
      setTimeout(() => setProgress(null), 2000);
    }
  }, [generator]);

  /**
   * Reset error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    // State
    isGenerating,
    progress,
    error,
    
    // Actions
    generatePDF,
    generateForEmail,
    generateAndDownload,
    generateBatch,
    clearError,
    
    // Utilities
    utils: PDFUtils,
    getTemplate: TavariPDFGenerator.getTemplate
  };
};

/**
 * Hook specifically for pay statement generation
 */
export const usePayStatementPDF = (businessData) => {
  const { generatePDF, generateForEmail, isGenerating, error } = usePDFGenerator();

  // Helper function to build earnings rows
  const buildEarningsRows = (entry, ytdTotals) => {
    const baseWage = parseFloat(entry.users?.wage || entry.wage || 0);
    const regularHours = parseFloat(entry.regular_hours || 0);
    const overtimeHours = parseFloat(entry.overtime_hours || 0);
    const lieuHours = parseFloat(entry.lieu_hours || 0);
    const statHolidayHours = parseFloat(entry.stat_holiday_hours || 0);
    const holidayEarnings = parseFloat(entry.holiday_pay || 0);
    const currentVacationPay = parseFloat(entry.vacation_pay || 0);

    let rows = [];

    // Regular hours
    if (regularHours > 0) {
      rows.push(`
        <tr>
          <td>Regular Wage</td>
          <td class="number">${PDFUtils.formatCurrency(baseWage)}</td>
          <td class="number">${PDFUtils.formatNumber(regularHours)}</td>
          <td class="number">${PDFUtils.formatCurrency(regularHours * baseWage)}</td>
          <td class="number">${PDFUtils.formatCurrency(ytdTotals.regular_earnings)}</td>
        </tr>
      `);
    }

    // Overtime
    if (overtimeHours > 0) {
      rows.push(`
        <tr>
          <td>Overtime</td>
          <td class="number">${PDFUtils.formatCurrency(baseWage * 1.5)}</td>
          <td class="number">${PDFUtils.formatNumber(overtimeHours)}</td>
          <td class="number">${PDFUtils.formatCurrency(overtimeHours * baseWage * 1.5)}</td>
          <td class="number">${PDFUtils.formatCurrency(ytdTotals.overtime_earnings)}</td>
        </tr>
      `);
    }

    // Lieu hours
    if (lieuHours > 0) {
      rows.push(`
        <tr>
          <td>Lieu Hours</td>
          <td class="number">${PDFUtils.formatCurrency(baseWage)}</td>
          <td class="number">${PDFUtils.formatNumber(lieuHours)}</td>
          <td class="number">${PDFUtils.formatCurrency(lieuHours * baseWage)}</td>
          <td class="number">${PDFUtils.formatCurrency(ytdTotals.lieu_earnings)}</td>
        </tr>
      `);
    }

    // Stat holiday
    if (statHolidayHours > 0) {
      rows.push(`
        <tr>
          <td>Stat Worked</td>
          <td class="number">${PDFUtils.formatCurrency(baseWage)}</td>
          <td class="number">${PDFUtils.formatNumber(statHolidayHours)}</td>
          <td class="number">${PDFUtils.formatCurrency(statHolidayHours * baseWage)}</td>
          <td class="number">${PDFUtils.formatCurrency(ytdTotals.stat_earnings)}</td>
        </tr>
      `);
    }

    // Holiday pay
    if (holidayEarnings > 0) {
      rows.push(`
        <tr>
          <td>Holiday Pay</td>
          <td class="number">-</td>
          <td class="number">-</td>
          <td class="number">${PDFUtils.formatCurrency(holidayEarnings)}</td>
          <td class="number">${PDFUtils.formatCurrency(ytdTotals.holiday_earnings)}</td>
        </tr>
      `);
    }

    // Vacation
    rows.push(`
      <tr>
        <td>Vacation</td>
        <td class="number">-</td>
        <td class="number">-</td>
        <td class="number">${PDFUtils.formatCurrency(currentVacationPay)}</td>
        <td class="number">${PDFUtils.formatCurrency(ytdTotals.vacation_pay)}</td>
      </tr>
    `);

    return rows.join('');
  };

  const generatePayStatement = useCallback(async (entry, runData, ytdTotals, outputType = 'blob') => {
    const businessTimezone = businessData?.timezone || 'America/Toronto';
    
    // Format data for template
    const templateData = {
      companyName: businessData?.name || 'Company Name',
      firstName: entry.users?.first_name || 'Unknown',
      lastName: entry.users?.last_name || 'User',
      payPeriodStart: new Date(runData.pay_period_start + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: businessTimezone }),
      payPeriodEnd: new Date(runData.pay_period_end + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: businessTimezone }),
      payDate: new Date(runData.pay_date + 'T12:00:00').toLocaleDateString('en-CA', { timeZone: businessTimezone }),
      baseWage: PDFUtils.formatNumber(entry.users?.wage || entry.wage || 0),
      grossPay: PDFUtils.formatCurrency(parseFloat(entry.gross_pay || 0) + parseFloat(entry.vacation_pay || 0)),
      ytdGrossPay: PDFUtils.formatCurrency(ytdTotals.gross_pay + ytdTotals.vacation_pay),
      totalHours: PDFUtils.formatNumber(
        parseFloat(entry.regular_hours || 0) + 
        parseFloat(entry.overtime_hours || 0) + 
        parseFloat(entry.lieu_hours || 0) + 
        parseFloat(entry.stat_holiday_hours || 0)
      ),
      generatedDate: PDFUtils.formatDate(new Date(), businessTimezone),
      
      // Build earnings rows
      earningsRows: buildEarningsRows(entry, ytdTotals)
    };

    const filename = `Pay Statement - ${templateData.firstName} ${templateData.lastName} - ${templateData.payPeriodEnd}.pdf`;

    return await generatePDF({
      html: TavariPDFGenerator.getTemplate('payStatement'),
      filename,
      data: templateData,
      outputType
    });
  }, [generatePDF, businessData]);

  const generatePayStatementForEmail = useCallback(async (entry, runData, ytdTotals) => {
    return await generatePayStatement(entry, runData, ytdTotals, 'base64');
  }, [generatePayStatement]);

  return {
    generatePayStatement,
    generatePayStatementForEmail,
    isGenerating,
    error
  };
};

/**
 * Hook for invoice generation
 */
export const useInvoicePDF = (businessData) => {
  const { generatePDF, generateAndDownload, isGenerating, error } = usePDFGenerator();

  const generateInvoice = useCallback(async (invoiceData, outputType = 'blob') => {
    const templateData = {
      companyName: businessData?.name || 'Company Name',
      companyAddress: businessData?.address || '',
      invoiceNumber: invoiceData.number,
      invoiceDate: PDFUtils.formatDate(invoiceData.date),
      dueDate: PDFUtils.formatDate(invoiceData.dueDate),
      terms: invoiceData.terms || 'Net 30',
      clientName: invoiceData.client.name,
      clientAddress: invoiceData.client.address,
      clientCity: invoiceData.client.city,
      clientState: invoiceData.client.state,
      clientZip: invoiceData.client.zip,
      totalAmount: PDFUtils.formatCurrency(invoiceData.total),
      
      // Build invoice items
      invoiceItems: invoiceData.items.map(item => `
        <tr>
          <td>${item.description}</td>
          <td class="number">${item.quantity}</td>
          <td class="number">${PDFUtils.formatCurrency(item.rate)}</td>
          <td class="number">${PDFUtils.formatCurrency(item.amount)}</td>
        </tr>
      `).join('')
    };

    const filename = `Invoice_${invoiceData.number}_${PDFUtils.formatDate(invoiceData.date)}.pdf`;

    return await generatePDF({
      html: TavariPDFGenerator.getTemplate('invoice'),
      filename,
      data: templateData,
      outputType
    });
  }, [generatePDF, businessData]);

  const generateAndDownloadInvoice = useCallback(async (invoiceData) => {
    return await generateInvoice(invoiceData, 'blob');
  }, [generateInvoice]);

  return {
    generateInvoice,
    generateAndDownloadInvoice,
    isGenerating,
    error
  };
};

export default usePDFGenerator;



