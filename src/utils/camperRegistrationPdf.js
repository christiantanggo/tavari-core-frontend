import { downloadHtmlDocumentPdf, getHtmlDocumentPdfBlob } from './htmlDocumentPdf';

export async function getCamperRegistrationPdfBlob(html, options = {}) {
  return getHtmlDocumentPdfBlob(html, {
    preset: 'camperRegistration',
    ...options,
  });
}

export async function downloadCamperRegistrationPdf(html, filename, options = {}) {
  return downloadHtmlDocumentPdf(html, filename, {
    preset: 'camperRegistration',
    ...options,
  });
}
