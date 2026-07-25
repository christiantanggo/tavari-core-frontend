import {
  downloadHtmlDocumentPdf,
  getHtmlDocumentPdfBlob,
} from './htmlDocumentPdf';

/**
 * Invoice PDF generation — same pipeline as pay statements (server Chromium + html2pdf fallback).
 */
export async function getInvoicePdfBlob(html, options = {}) {
  return getHtmlDocumentPdfBlob(html, {
    preset: 'invoice',
    ...options,
  });
}

export async function downloadInvoicePdf(html, filename, options = {}) {
  return downloadHtmlDocumentPdf(html, filename, {
    preset: 'invoice',
    ...options,
  });
}
