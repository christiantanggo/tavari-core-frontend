import { supabase } from '../supabaseClient';

/**
 * Shared HTML → PDF pipeline for Tavari documents (pay statements, contracts, etc.).
 *
 * 1. Server headless Chromium (/api/render-pay-statement-pdf)
 * 2. Browser iframe + html2pdf fallback (full HTML document, styles preserved)
 *
 * Domain-specific modules (payStatementPdf.js, contractPdf.js) should wrap this
 * file with their own defaults — do not duplicate render logic elsewhere.
 */

export const HTML_PDF_RENDER_ENDPOINT = '/api/render-pay-statement-pdf';

export const PDF_PRESETS = {
  payStatement: {
    defaultMarginInches: 0,
    contentWidthPx: 816,
    defaultFilename: 'pay-statement.pdf',
    pagebreak: { mode: ['css', 'legacy'] },
    html2canvasExtras: {},
  },
  contract: {
    defaultMarginInches: 0.5,
    contentWidthPx: 816,
    defaultFilename: 'contract.pdf',
    pagebreak: { mode: ['css', 'legacy'], avoid: ['.contract-section'] },
    html2canvasExtras: {
      letterRendering: true,
      allowTaint: true,
    },
  },
  camperRegistration: {
    defaultMarginInches: 0.5,
    contentWidthPx: 816,
    defaultFilename: 'camper-registration.pdf',
    pagebreak: { mode: ['css', 'legacy'], avoid: ['.cr-section'] },
    html2canvasExtras: {},
  },
  bookingTerms: {
    defaultMarginInches: 0.5,
    contentWidthPx: 816,
    defaultFilename: 'booking-terms.pdf',
    pagebreak: { mode: ['css', 'legacy'], avoid: ['.bt-signature'] },
    html2canvasExtras: {
      allowTaint: true,
    },
  },
  invoice: {
    defaultMarginInches: 0.5,
    contentWidthPx: 816,
    defaultFilename: 'invoice.pdf',
    pagebreak: { mode: ['css', 'legacy'], avoid: ['.invoice-line-items', '.invoice-totals'] },
    html2canvasExtras: {},
  },
};

function parseMarginInches(value, fallback) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.endsWith('in')) return parseFloat(trimmed) || fallback;
  if (trimmed.endsWith('px')) return (parseFloat(trimmed) || 0) / 96 || fallback;
  return parseFloat(trimmed) || fallback;
}

function resolvePreset(options = {}) {
  const presetKey = options.preset;
  const preset = presetKey ? PDF_PRESETS[presetKey] || {} : {};
  return {
    defaultMarginInches: options.defaultMarginInches ?? preset.defaultMarginInches ?? 0.5,
    contentWidthPx: options.contentWidthPx ?? preset.contentWidthPx ?? 816,
    defaultFilename: options.defaultFilename ?? preset.defaultFilename ?? 'document.pdf',
    pagebreak: options.pagebreak ?? preset.pagebreak ?? { mode: ['css', 'legacy'] },
    html2canvasExtras: { ...(preset.html2canvasExtras || {}), ...(options.html2canvasExtras || {}) },
  };
}

async function waitForDocumentAssets(doc, imageTimeoutMs = 5000) {
  try {
    if (doc?.fonts?.ready) {
      await doc.fonts.ready;
    }
  } catch {
    // Best effort only.
  }

  const images = Array.from(doc?.images || []);
  await Promise.all(
    images.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
        setTimeout(resolve, imageTimeoutMs);
      });
    })
  );
}

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(`Could not read auth session: ${error.message}`);
  return data?.session?.access_token || null;
}

async function renderPdfInBrowser(html, options = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Browser PDF fallback is only available in the browser');
  }

  const config = resolvePreset(options);
  const html2pdfModule = await import('html2pdf.js');
  const html2pdf = html2pdfModule.default || html2pdfModule;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '0';
  iframe.style.width = `${config.contentWidthPx}px`;
  iframe.style.height = '1056px';
  iframe.style.opacity = '0';
  iframe.setAttribute('aria-hidden', 'true');

  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) throw new Error('Could not create browser PDF document');

    doc.open();
    doc.write(html);
    doc.close();

    await new Promise((resolve) => {
      if (iframe.contentWindow?.document?.readyState === 'complete') return resolve();
      iframe.onload = resolve;
      setTimeout(resolve, 1500);
    });
    await waitForDocumentAssets(doc);

    // html2pdf clones the target node without <head> styles — copy them into body.
    doc.querySelectorAll('head style, head link[rel="stylesheet"]').forEach((node) => {
      doc.body.insertBefore(node.cloneNode(true), doc.body.firstChild);
    });

    const margin = options.margin
      ? [
          parseMarginInches(options.margin.top, config.defaultMarginInches),
          parseMarginInches(options.margin.right, config.defaultMarginInches),
          parseMarginInches(options.margin.bottom, config.defaultMarginInches),
          parseMarginInches(options.margin.left, config.defaultMarginInches),
        ]
      : config.defaultMarginInches;

    const blob = await html2pdf()
      .set({
        margin,
        filename: options.filename || config.defaultFilename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          windowWidth: config.contentWidthPx,
          width: config.contentWidthPx,
          ...config.html2canvasExtras,
        },
        jsPDF: {
          unit: 'in',
          format: options.format || 'letter',
          orientation: 'portrait',
        },
        pagebreak: config.pagebreak,
      })
      .from(doc.body)
      .outputPdf('blob');

    return blob?.type === 'application/pdf'
      ? blob
      : new Blob([blob], { type: 'application/pdf' });
  } finally {
    iframe.remove();
  }
}

/**
 * Render a full HTML document to PDF via server Chromium, with browser fallback.
 *
 * @param {string} html Full HTML document string.
 * @param {object} [options]
 * @param {'payStatement'|'contract'} [options.preset] Named defaults bundle.
 * @param {string} [options.filename]
 * @param {'letter'|'legal'|'a4'} [options.format='letter']
 * @param {{top?:string,bottom?:string,left?:string,right?:string}} [options.margin]
 * @returns {Promise<Blob>}
 */
export async function getHtmlDocumentPdfBlob(html, options = {}) {
  if (typeof html !== 'string' || html.trim().length === 0) {
    throw new Error('getHtmlDocumentPdfBlob: html string is required');
  }

  const config = resolvePreset(options);
  const margin = options.margin || {
    top: `${config.defaultMarginInches}in`,
    right: `${config.defaultMarginInches}in`,
    bottom: `${config.defaultMarginInches}in`,
    left: `${config.defaultMarginInches}in`,
  };

  const token = await getAccessToken();
  if (token) {
    const payload = {
      html,
      filename: options.filename,
      format: options.format || 'letter',
      margin,
    };

    try {
      const response = await fetch(HTML_PDF_RENDER_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const blob = await response.blob();
        if (blob?.size > 0) {
          return blob.type === 'application/pdf'
            ? blob
            : new Blob([blob], { type: 'application/pdf' });
        }
      } else {
        const text = await response.text().catch(() => '');
        let detail = text;
        try {
          const parsed = JSON.parse(text);
          detail = parsed.detail || parsed.error || text;
        } catch {
          // keep raw text
        }
        console.warn(
          `[htmlDocumentPdf] Server PDF render failed (${response.status}); falling back to browser renderer:`,
          detail || 'unknown error'
        );
      }
    } catch (networkError) {
      console.warn(
        '[htmlDocumentPdf] Server PDF render network error; falling back to browser renderer:',
        networkError.message
      );
    }
  }

  return renderPdfInBrowser(html, { ...options, margin });
}

/** Trigger a browser download for an existing PDF blob. */
export function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename || 'document.pdf';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Render HTML to PDF and trigger a browser download.
 * @returns {Promise<Blob>} The blob that was downloaded.
 */
export async function downloadHtmlDocumentPdf(html, filename, options = {}) {
  const blob = await getHtmlDocumentPdfBlob(html, { ...options, filename });
  triggerBlobDownload(blob, filename || options.defaultFilename || 'document.pdf');
  return blob;
}

/** Wrap body-only HTML fragments in a printable document shell. */
export function ensureFullHtmlDocument(html, { title = 'Document', extraStyles = '' } = {}) {
  if (!html || typeof html !== 'string') return '';
  const trimmed = html.trim();
  if (/<html[\s>]/i.test(trimmed)) return trimmed;

  const bodyMatch = trimmed.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1].trim() : trimmed;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      color: #000;
      background: #fff;
      margin: 0;
      padding: 0;
      line-height: 1.4;
    }
    @page { size: letter; margin: 0.5in; }
    img { max-width: 100%; height: auto; }
    ${extraStyles}
  </style>
</head>
<body>${bodyContent}</body>
</html>`;
}
