// helpers/TavariPDFGenerator.js - Reusable PDF Generation Component for Tavari Platform

import html2pdf from 'html2pdf.js';
import { TavariStyles } from '../utils/TavariStyles';

/**
 * TavariPDFGenerator - A reusable PDF generation component
 * Handles all PDF generation needs across the Tavari platform
 */
class TavariPDFGenerator {
  constructor(options = {}) {
    this.defaultOptions = {
      margin: [0.5, 0.5, 0.5, 0.5],
      image: { 
        type: 'jpeg', 
        quality: 0.98 
      },
      html2canvas: {
        scale: 1.5,
        useCORS: true,
        logging: false,
        letterRendering: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        width: 816, // 8.5 inches * 96 DPI
        height: 1056 // 11 inches * 96 DPI
      },
      jsPDF: { 
        unit: 'in', 
        format: 'letter', 
        orientation: 'portrait',
        compress: true
      }
    };
    this.options = { ...this.defaultOptions, ...options };
  }

  /**
   * Generate PDF from HTML content
   * @param {Object} config - Configuration object
   * @param {string} config.html - HTML content to convert
   * @param {string} config.filename - PDF filename
   * @param {Object} config.data - Data to populate template
   * @param {Object} config.styles - Custom styles to apply
   * @param {string} config.outputType - 'blob', 'base64', 'dataurl', 'file'
   * @param {Object} config.customOptions - Custom html2pdf options
   * @returns {Promise<Object>} - Result object with PDF data
   */
  async generatePDF(config) {
    const {
      html,
      filename = 'document.pdf',
      data = {},
      styles = {},
      outputType = 'blob',
      customOptions = {}
    } = config;

    try {
      console.log(`[TavariPDFGenerator] Starting PDF generation: ${filename}`);
      
      // Validate required parameters
      if (!html) {
        throw new Error('HTML content is required');
      }

      // Process HTML with data if provided
      const processedHTML = this.processTemplate(html, data);
      
      // Validate processed HTML
      if (!processedHTML || processedHTML.trim().length < 100) {
        throw new Error('Generated HTML content appears to be incomplete');
      }

      // Apply custom styles
      const styledHTML = this.applyStyles(processedHTML, styles);
      
      // Create temporary DOM element
      const tempDiv = this.createTempElement(styledHTML);
      try {
        // Wait for DOM to settle
        await this.waitForDOMReady(tempDiv);
        
        // Merge options
        const finalOptions = { ...this.options, ...customOptions };
        finalOptions.filename = filename;
        console.log(`[TavariPDFGenerator] Converting HTML to PDF...`);
        
        // Generate PDF
        const result = await this.convertToPDF(tempDiv, finalOptions, outputType);
        
        // Clean up
        this.cleanup(tempDiv);
        
        console.log(`[TavariPDFGenerator] PDF generated successfully:`, {
          filename: result.filename,
          size: result.size,
          type: outputType
        });

        return {
          success: true,
          filename: result.filename,
          size: result.size,
          data: result.data,
          type: outputType
        };
        
      } catch (conversionError) {
        // Clean up on error
        this.cleanup(tempDiv);
        throw conversionError;
      }
    } catch (error) {
      console.error('[TavariPDFGenerator] Error generating PDF:', error);
      throw new Error(`PDF generation failed: ${error.message}`);
    }
  }

  /**
   * Generate PDF for email attachment (returns base64)
   */
  async generateForEmail(config) {
    return await this.generatePDF({
      ...config,
      outputType: 'base64'
    });
  }

  /**
   * Generate PDF for download (returns blob)
   */
  async generateForDownload(config) {
    return await this.generatePDF({
      ...config,
      outputType: 'blob'
    });
  }

  /**
   * Process HTML template with data
   */
  processTemplate(html, data) {
    let processedHTML = html;
    
    // Replace template variables
    Object.entries(data).forEach(([key, value]) => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      processedHTML = processedHTML.replace(regex, value || '');
    });
    
    return processedHTML;
  }

  /**
   * Apply custom styles to HTML
   */
  applyStyles(html, customStyles) {
    const defaultStyles = `
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: Arial, sans-serif;
          margin: 20px;
          padding: 0;
          line-height: 1.4;
          color: #333;
          background-color: #fff;
          font-size: 13px;
        }
        .tavari-header {
          text-align: center;
          border-bottom: 2px solid #000;
          padding-bottom: 15px;
          margin-bottom: 25px;
        }
        .tavari-company-name {
          font-size: 20px;
          font-weight: bold;
          margin-bottom: 5px;
          color: ${TavariStyles?.colors?.primary || '#2563eb'};
        }
        .tavari-document-title {
          font-size: 16px;
          font-weight: bold;
          text-transform: uppercase;
          margin: 10px 0;
        }
        .tavari-section {
          background: #f8f9fa;
          padding: 15px;
          border-radius: 5px;
          margin: 20px 0;
          border: 1px solid #ddd;
        }
        .tavari-table {
          width: 100%;
          border-collapse: collapse;
          margin: 15px 0;
          font-size: 11px;
          border: 1px solid #000;
        }
        .tavari-table th, .tavari-table td {
          padding: 8px;
          border: 1px solid #000;
          text-align: left;
        }
        .tavari-table th {
          background-color: #f5f5f5;
          font-weight: bold;
          text-transform: uppercase;
          font-size: 10px;
        }
        .tavari-table td.number {
          text-align: right;
          font-family: monospace;
        }
        .tavari-total-row {
          background-color: #f8f9fa;
          font-weight: bold;
          border-top: 2px solid #000 !important;
        }
        .tavari-footer {
          margin-top: 30px;
          font-size: 10px;
          color: #666;
          text-align: center;
          border-top: 1px solid #ddd;
          padding-top: 15px;
        }
        .tavari-row {
          margin: 8px 0;
          display: block;
          width: 100%;
        }
        .tavari-grid-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
          margin: 15px 0;
        }
        .tavari-highlight {
          background-color: #e8f4fd;
          font-weight: bold;
          border-top: 3px solid #007bff !important;
        }
        @media print {
          body { margin: 0; }
          .page-break { page-break-before: always; }
        }
      </style>
    `;

    // Combine with custom styles
    const customStylesHTML = customStyles ? `<style>${customStyles}</style>` : '';
    
    // If HTML already has head section, insert styles there
    if (html.includes('<head>')) {
      return html.replace('<head>', `<head>${defaultStyles}${customStylesHTML}`);
    } else {
      // Wrap HTML with proper structure
      return `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          ${defaultStyles}
          ${customStylesHTML}
        </head>
        <body>
          ${html}
        </body>
        </html>
      `;
    }
  }

  /**
   * Create temporary DOM element for PDF generation
   */
  createTempElement(html) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    tempDiv.style.cssText = `
      position: absolute;
      top: 0px;
      left: 0px;
      width: 8.5in;
      min-height: 11in;
      background-color: white;
      visibility: visible;
      z-index: -1000;
      font-family: Arial, sans-serif;
    `;
    
    document.body.appendChild(tempDiv);
    return tempDiv;
  }

  /**
   * Wait for DOM to be ready for PDF generation
   */
  async waitForDOMReady(element) {
    // Force layout calculation
    element.offsetHeight;
    element.scrollHeight;

    // Wait for images to load
    const images = element.querySelectorAll('img');
    if (images.length > 0) {
      await Promise.all(
        Array.from(images).map(img => {
          return new Promise(resolve => {
            if (img.complete) {
              resolve();
            } else {
              img.onload = resolve;
              img.onerror = resolve; // Continue even if image fails
            }
          });
        })
      );
    }

    // Final DOM settling time
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  /**
   * Convert DOM element to PDF
   */
  async convertToPDF(element, options, outputType) {
    const filename = options.filename;
    
    try {
      const pdfInstance = html2pdf().set(options).from(element);
      
      let result;
      switch (outputType) {
        case 'base64':
          const blob = await pdfInstance.outputPdf('blob');
          const base64 = await this.blobToBase64(blob);
          result = {
            filename,
            size: blob.size,
            data: base64
          };
          break;
          
        case 'blob':
          const blobResult = await pdfInstance.outputPdf('blob');
          result = {
            filename,
            size: blobResult.size,
            data: blobResult
          };
          break;
          
        case 'dataurl':
          const dataurl = await pdfInstance.outputPdf('dataurl');
          result = {
            filename,
            size: dataurl.length,
            data: dataurl
          };
          break;
          
        case 'file':
          await pdfInstance.save();
          result = {
            filename,
            size: null,
            data: null
          };
          break;
          
        default:
          throw new Error(`Unsupported output type: ${outputType}`);
      }

      // Validate result
      if (outputType !== 'file') {
        if (!result.data || (result.size && result.size < 1000)) {
          throw new Error('Generated PDF appears to be invalid or too small');
        }
      }

      return result;
      
    } catch (error) {
      throw new Error(`PDF conversion failed: ${error.message}`);
    }
  }

  /**
   * Convert blob to base64
   */
  async blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onloadend = () => {
        try {
          const result = reader.result;
          if (!result || typeof result !== 'string') {
            reject(new Error('FileReader returned invalid result'));
            return;
          }
          
          const base64String = result.split(',')[1];
          if (!base64String || base64String.length === 0) {
            reject(new Error('Failed to extract base64 data'));
            return;
          }
          
          // Validate base64
          const cleanBase64 = base64String.replace(/\s/g, '');
          const isValidBase64 = /^[A-Za-z0-9+/]*={0,2}$/.test(cleanBase64);
          
          if (!isValidBase64) {
            reject(new Error('Generated base64 is invalid'));
            return;
          }
          
          resolve(cleanBase64);
        } catch (error) {
          reject(new Error(`Base64 conversion failed: ${error.message}`));
        }
      };
      
      reader.onerror = () => {
        reject(new Error('FileReader encountered an error'));
      };
      
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Clean up temporary DOM elements
   */
  cleanup(element) {
    if (element && document.body.contains(element)) {
      document.body.removeChild(element);
    }
  }

  /**
   * Get predefined templates
   */
  static getTemplate(templateName) {
    const templates = {
      payStatement: `
        <div class="tavari-header">
          <div class="tavari-company-name">{{companyName}}</div>
          <div class="tavari-document-title">Employee Pay Statement</div>
          <div>{{payPeriodEnd}}</div>
        </div>
        
        <div class="tavari-section">
          <div class="tavari-row"><strong>Employee:</strong> {{firstName}} {{lastName}}</div>
          <div class="tavari-row"><strong>Pay Period:</strong> {{payPeriodStart}} to {{payPeriodEnd}}</div>
          <div class="tavari-row"><strong>Pay Date:</strong> {{payDate}}</div>
          <div class="tavari-row"><strong>Base Rate:</strong> ${{baseWage}}/hr</div>
        </div>
        <table class="tavari-table">
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
            {{earningsRows}}
            <tr class="tavari-total-row">
              <td><strong>Gross Pay</strong></td>
              <td class="number">-</td>
              <td class="number"><strong>{{totalHours}}</strong></td>
              <td class="number"><strong>${{grossPay}}</strong></td>
              <td class="number"><strong>${{ytdGrossPay}}</strong></td>
            </tr>
          </tbody>
        </table>
        <div class="tavari-footer">
          <p>This is a computer-generated document. Please retain for your records.</p>
          <p>Generated on: {{generatedDate}}</p>
        </div>
      `,
      
      invoice: `
        <div class="tavari-header">
          <div class="tavari-company-name">{{companyName}}</div>
          <div class="tavari-document-title">Invoice</div>
          <div>Invoice #{{invoiceNumber}} - {{invoiceDate}}</div>
        </div>
        
        <div class="tavari-grid-2">
          <div class="tavari-section">
            <h3>Bill To:</h3>
            <div class="tavari-row">{{clientName}}</div>
            <div class="tavari-row">{{clientAddress}}</div>
            <div class="tavari-row">{{clientCity}}, {{clientState}} {{clientZip}}</div>
          </div>
          <div class="tavari-section">
            <div class="tavari-row"><strong>Due Date:</strong> {{dueDate}}</div>
            <div class="tavari-row"><strong>Terms:</strong> {{terms}}</div>
            <div class="tavari-row"><strong>Total:</strong> ${{totalAmount}}</div>
          </div>
        </div>
        <table class="tavari-table">
          <thead>
            <tr>
              <th>Description</th>
              <th>Quantity</th>
              <th>Rate</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {{invoiceItems}}
            <tr class="tavari-total-row">
              <td colspan="3"><strong>Total</strong></td>
              <td class="number"><strong>${{totalAmount}}</strong></td>
            </tr>
          </tbody>
        </table>
        <div class="tavari-footer">
          <p>Thank you for your business!</p>
          <p>{{companyName}} - {{companyAddress}}</p>
        </div>
      `,

      report: `
        <div class="tavari-header">
          <div class="tavari-company-name">{{companyName}}</div>
          <div class="tavari-document-title">{{reportTitle}}</div>
          <div>{{reportDate}}</div>
        </div>
        
        <div class="tavari-section">
          <h3>Summary</h3>
          <div class="tavari-row">{{reportSummary}}</div>
        </div>
        {{reportContent}}
        <div class="tavari-footer">
          <p>Generated by Tavari Systems</p>
          <p>Report Date: {{generatedDate}}</p>
        </div>
      `
    };

    return templates[templateName] || null;
  }
}

// Export the class and create a default instance
export default TavariPDFGenerator;

// Export a default instance for convenience
export const pdfGenerator = new TavariPDFGenerator();

// Export utility functions
export const PDFUtils = {
  /**
   * Format currency for PDF display
   */
  formatCurrency: (amount) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD'
    }).format(amount || 0);
  },

  /**
   * Format date for PDF display
   */
  formatDate: (date, timezone = 'America/Toronto') => {
    if (!date) return '';
    const dateObj = new Date(date);
    return dateObj.toLocaleDateString('en-CA', { timeZone: timezone });
  },

  /**
   * Format number with decimals
   */
  formatNumber: (number, decimals = 2) => {
    return Number(number || 0).toFixed(decimals);
  },

  /**
   * Generate filename with timestamp
   */
  generateFilename: (baseName, extension = 'pdf') => {
    const timestamp = new Date().toISOString().split('T')[0];
    return `${baseName}_${timestamp}.${extension}`;
  }
};



