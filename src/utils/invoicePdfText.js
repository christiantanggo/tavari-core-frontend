/**
 * Extract text from a PDF File (e.g. invoice) for use with accounting-extract-invoice.
 * Uses pdfjs-dist. Worker is loaded via Vite ?url so PDF.js runs in the browser.
 */
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';

if (typeof window !== 'undefined') {
  try {
    // Give PDF.js a real module Worker. Relying only on workerSrc can briefly
    // execute its fake-worker fallback in the page, which emits
    // "document is not defined" for some iPhone/Genius Scan PDFs.
    if (!globalThis.__tavariInvoicePdfWorker && typeof Worker !== 'undefined') {
      globalThis.__tavariInvoicePdfWorker = new Worker(pdfjsWorker, { type: 'module' });
    }
    if (globalThis.__tavariInvoicePdfWorker) {
      pdfjsLib.GlobalWorkerOptions.workerPort = globalThis.__tavariInvoicePdfWorker;
    } else {
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
    }
  } catch (error) {
    console.warn('Could not start PDF.js worker; using worker URL fallback:', error);
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
  }
}

const PDF_LOAD_OPTS = { verbosity: 0 }; // 0 = errors only; suppresses "TT: undefined function" font warnings

export async function extractTextFromPdfFile(file) {
  if (!file || file.type !== 'application/pdf') return '';
  if (typeof window === 'undefined') return '';
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, ...PDF_LOAD_OPTS });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const parts = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const strings = textContent.items.map((item) => ('str' in item ? item.str : '')).filter(Boolean);
    parts.push(strings.join(' '));
  }
  return parts.join('\n\n').trim();
}

/**
 * Render the first page of a PDF to an image (PNG base64) using canvas.
 * Use for scanned/image-only PDFs when the backend cannot extract text or embedded images.
 * @param {ArrayBuffer} arrayBuffer - PDF file bytes
 * @returns {Promise<string|null>} base64 data URL (data:image/png;base64,...) or null on failure
 */
export async function renderPdfFirstPageToImage(arrayBuffer) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  try {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, ...PDF_LOAD_OPTS }).promise;
    if (pdf.numPages < 1) return null;
    const page = await pdf.getPage(1);
    const scale = 1.5;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const renderTask = page.render({ canvasContext: ctx, viewport });
    await (renderTask.promise ?? renderTask);
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.warn('renderPdfFirstPageToImage failed:', e);
    return null;
  }
}
