import {
  downloadHtmlDocumentPdf,
  getHtmlDocumentPdfBlob,
} from './htmlDocumentPdf';

/**
 * Pay statement PDF generation — wraps the shared htmlDocumentPdf pipeline.
 *
 * Both the interactive download path (HR Payroll + Employee Portal) and the
 * email attachment path call into here so emailed and downloaded PDFs match.
 *
 * Do NOT reintroduce standalone html2pdf.js usage for pay statements.
 */

export async function getPayStatementPdfBlob(html, options = {}) {
  return getHtmlDocumentPdfBlob(html, {
    preset: 'payStatement',
    ...options,
  });
}

export async function downloadPayStatementPdf(html, filename, options = {}) {
  return downloadHtmlDocumentPdf(html, filename, {
    preset: 'payStatement',
    ...options,
  });
}
