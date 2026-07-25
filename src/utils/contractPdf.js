import {
  downloadHtmlDocumentPdf,
  ensureFullHtmlDocument,
  getHtmlDocumentPdfBlob,
} from './htmlDocumentPdf';

/**
 * Contract PDF generation — wraps the shared htmlDocumentPdf pipeline.
 *
 * Do NOT render contracts by stripping <head> and dumping body into a hidden div.
 */

export const ensureContractPrintHtml = (html) =>
  ensureFullHtmlDocument(html, {
    title: 'Employment Contract',
    extraStyles: '.contract-section { page-break-inside: avoid; }',
  });

export async function getContractPdfBlob(html, options = {}) {
  const printHtml = ensureContractPrintHtml(html);
  if (!printHtml) {
    throw new Error('getContractPdfBlob: html string is required');
  }

  return getHtmlDocumentPdfBlob(printHtml, {
    preset: 'contract',
    ...options,
  });
}

export async function downloadContractPdf(html, filename, options = {}) {
  return downloadHtmlDocumentPdf(
    ensureContractPrintHtml(html),
    filename,
    {
      preset: 'contract',
      ...options,
    }
  );
}
