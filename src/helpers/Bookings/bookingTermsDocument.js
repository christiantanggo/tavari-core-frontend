/**
 * Staff / email / print helpers for booking Terms & Conditions documents.
 * Typography uses --bt-scale so print/PDF can shrink to fit a fixed page budget.
 */

export const BOOKING_TERMS_DIGITAL_SIGNATURE_ACK =
  'I acknowledge that this is my digital signature and has the same legal effect as a handwritten signature';

export const BOOKING_TERMS_SIGNING_CONFIRMATION =
  'By signing, the signer confirmed that they have read and agree to all Terms & Conditions steps for this booking.';

/** Letter @ 96dpi */
export const BOOKING_TERMS_PAGE_WIDTH_PX = 816;
export const BOOKING_TERMS_PAGE_HEIGHT_PX = 1056;
export const BOOKING_TERMS_PAGE_MARGIN_IN = 0.5;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paragraphsHtml(body) {
  const text = String(body || '').trim();
  if (!text) return '<p class="bt-muted">(No content)</p>';
  return text
    .split(/\n+/)
    .filter(Boolean)
    .map((paragraph) => `<p class="bt-p">${esc(paragraph)}</p>`)
    .join('');
}

/**
 * @param {object} input
 * @param {string} [input.businessName]
 * @param {string} [input.packageName]
 * @param {string} [input.packageDescription]
 * @param {string} [input.bookingNumber]
 * @param {string} [input.activityName]
 * @param {Array<{ title: string, body?: string, require_acknowledge?: boolean, acknowledged_at?: string|null, acknowledgedAtLabel?: string|null }>} input.sections
 * @param {boolean} input.isSigned
 * @param {string} [input.signerName]
 * @param {string} [input.signedAtLabel]
 * @param {string} [input.signatureImageUrl]
 * @param {string} [input.signedIp]
 * @param {number} [input.scale] Initial --bt-scale (default 1)
 */
export function buildBookingTermsDocumentHtml(input = {}) {
  const businessName = String(input.businessName || 'Business').trim() || 'Business';
  const packageName = String(input.packageName || 'Terms & Conditions').trim() || 'Terms & Conditions';
  const packageDescription = String(input.packageDescription || '').trim();
  const bookingNumber = String(input.bookingNumber || '').trim();
  const activityName = String(input.activityName || '').trim();
  const sections = Array.isArray(input.sections) ? input.sections : [];
  const isSigned = Boolean(input.isSigned);
  const signerName = String(input.signerName || '').trim();
  const signedAtLabel = String(input.signedAtLabel || '').trim();
  const signatureImageUrl = String(input.signatureImageUrl || '').trim();
  const signedIp = String(input.signedIp || '').trim();
  const scale = Number.isFinite(Number(input.scale)) ? Number(input.scale) : 1;

  const metaBits = [
    activityName ? esc(activityName) : null,
    bookingNumber ? `Booking #${esc(bookingNumber)}` : null,
  ].filter(Boolean);

  const sectionsHtml = sections.map((section, index) => {
    const title = String(section.title || `Section ${index + 1}`).trim();
    const requireAck = section.require_acknowledge !== false;
    const ackLabel = section.acknowledgedAtLabel
      || (section.acknowledged_at ? String(section.acknowledged_at) : null);
    const ackBadge = requireAck
      ? (ackLabel
        ? `<div class="bt-badge bt-badge-ok">
            Acknowledged${ackLabel ? ` · ${esc(ackLabel)}` : ''}
          </div>`
        : `<div class="bt-badge bt-badge-warn">
            Not yet acknowledged
          </div>`)
      : '';

    return `
      <section class="bt-section">
        <h2 class="bt-h2">${index + 1}. ${esc(title)}</h2>
        <div class="bt-body">
          ${paragraphsHtml(section.body)}
        </div>
        ${ackBadge}
      </section>
    `;
  }).join('');

  const signatureBlock = isSigned
    ? `
      <section class="bt-section bt-signature">
        <h2 class="bt-h2">Signature</h2>
        <p class="bt-p">${esc(BOOKING_TERMS_SIGNING_CONFIRMATION)}</p>
        <div class="bt-badge bt-badge-sig">${esc(BOOKING_TERMS_DIGITAL_SIGNATURE_ACK)}</div>
        <div class="bt-signer-meta">
          <div><strong>Signer:</strong> ${esc(signerName || '—')}</div>
          <div><strong>Signed:</strong> ${esc(signedAtLabel || '—')}</div>
          ${signedIp ? `<div><strong>IP address:</strong> ${esc(signedIp)}</div>` : ''}
        </div>
        ${signatureImageUrl
          ? `<div class="bt-sig-box">
              <img src="${esc(signatureImageUrl)}" alt="Signature" class="bt-sig-img" />
            </div>`
          : '<p class="bt-muted">No signature image on file.</p>'}
      </section>
    `
    : `
      <section class="bt-section bt-unsigned">
        <strong>Not signed yet.</strong> The customer has not completed Terms &amp; Conditions for this booking.
      </section>
    `;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(packageName)} — ${esc(bookingNumber || 'Booking')}</title>
  <style>
    :root {
      --bt-scale: ${scale};
      --bt-fs-body: calc(9px * var(--bt-scale));
      --bt-fs-h1: calc(14px * var(--bt-scale));
      --bt-fs-h2: calc(11px * var(--bt-scale));
      --bt-fs-meta: calc(8px * var(--bt-scale));
      --bt-fs-tiny: calc(7px * var(--bt-scale));
      --bt-lh: 1.22;
      --bt-space: calc(8px * var(--bt-scale));
      --bt-space-sm: calc(4px * var(--bt-scale));
      --bt-pad: calc(12px * var(--bt-scale));
      --bt-sig-max: calc(64px * var(--bt-scale));
    }
    @page { margin: ${BOOKING_TERMS_PAGE_MARGIN_IN}in; size: letter; }
    @media print {
      body { background: #fff !important; }
      .no-print { display: none !important; }
      .bt-wrap { padding: 0 !important; max-width: none !important; }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      color: #111827;
      background: #f8fafc;
      font-size: var(--bt-fs-body);
      line-height: var(--bt-lh);
    }
    .bt-wrap {
      max-width: 760px;
      margin: 0 auto;
      padding: var(--bt-pad);
      background: #fff;
    }
    .bt-header {
      margin-bottom: calc(10px * var(--bt-scale));
      padding-bottom: var(--bt-space);
      border-bottom: 1.5px solid #0d9488;
    }
    .bt-brand {
      font-size: var(--bt-fs-meta);
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #0d9488;
      margin-bottom: calc(2px * var(--bt-scale));
    }
    .bt-h1 {
      margin: 0;
      font-size: var(--bt-fs-h1);
      font-weight: 800;
      color: #111827;
      line-height: 1.15;
    }
    .bt-desc {
      margin: var(--bt-space-sm) 0 0;
      font-size: var(--bt-fs-body);
      color: #4b5563;
      line-height: var(--bt-lh);
    }
    .bt-meta {
      margin: calc(3px * var(--bt-scale)) 0 0;
      font-size: var(--bt-fs-meta);
      color: #6b7280;
      line-height: 1.2;
    }
    .bt-status {
      margin: calc(3px * var(--bt-scale)) 0 0;
      font-size: var(--bt-fs-meta);
      font-weight: 600;
      line-height: 1.2;
    }
    .bt-status-ok { color: #065f46; }
    .bt-status-pending { color: #9a3412; }
    .bt-section {
      margin: 0 0 calc(8px * var(--bt-scale));
      padding-bottom: calc(6px * var(--bt-scale));
      border-bottom: 1px solid #e5e7eb;
    }
    .bt-signature {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .bt-h2 {
      margin: 0 0 var(--bt-space-sm);
      font-size: var(--bt-fs-h2);
      font-weight: 700;
      color: #111827;
      line-height: 1.2;
    }
    .bt-body { font-size: var(--bt-fs-body); color: #374151; }
    .bt-p { margin: 0 0 var(--bt-space-sm); line-height: var(--bt-lh); }
    .bt-muted { margin: 0; color: #6b7280; font-size: var(--bt-fs-body); }
    .bt-badge {
      margin-top: var(--bt-space-sm);
      padding: calc(2px * var(--bt-scale)) calc(6px * var(--bt-scale));
      border-radius: 4px;
      font-size: var(--bt-fs-meta);
      font-weight: 600;
      line-height: 1.2;
    }
    .bt-badge-ok { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; }
    .bt-badge-warn { background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; }
    .bt-badge-sig { background: #f0fdfa; border: 1px solid #99f6e4; color: #0f766e; margin-bottom: calc(6px * var(--bt-scale)); }
    .bt-signer-meta {
      font-size: var(--bt-fs-body);
      color: #111827;
      margin-bottom: calc(6px * var(--bt-scale));
      line-height: var(--bt-lh);
    }
    .bt-sig-box {
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: calc(6px * var(--bt-scale));
      background: #fff;
      max-width: calc(220px * var(--bt-scale));
    }
    .bt-sig-img {
      max-width: 100%;
      max-height: var(--bt-sig-max);
      height: auto;
      display: block;
    }
    .bt-unsigned {
      margin-top: var(--bt-space-sm);
      padding: calc(6px * var(--bt-scale)) var(--bt-space);
      border-radius: 6px;
      background: #fff7ed;
      border: 1px solid #fed7aa;
      color: #9a3412;
      font-size: var(--bt-fs-body);
      line-height: var(--bt-lh);
    }
    .bt-footer {
      margin-top: calc(8px * var(--bt-scale));
      font-size: var(--bt-fs-tiny);
      color: #9ca3af;
      line-height: 1.2;
    }
  </style>
</head>
<body>
  <div class="bt-wrap">
    <div class="bt-header">
      <div class="bt-brand">${esc(businessName)}</div>
      <h1 class="bt-h1">${esc(packageName)}</h1>
      ${packageDescription ? `<p class="bt-desc">${esc(packageDescription)}</p>` : ''}
      ${metaBits.length ? `<p class="bt-meta">${metaBits.join(' · ')}</p>` : ''}
      <p class="bt-status ${isSigned ? 'bt-status-ok' : 'bt-status-pending'}">
        Status: ${isSigned ? 'Signed' : 'Pending signature'}
      </p>
    </div>
    ${sectionsHtml || '<p class="bt-muted">No terms sections found.</p>'}
    ${signatureBlock}
    <p class="bt-footer">
      Generated by Tavari Bookings · ${esc(new Date().toISOString())}
    </p>
  </div>
</body>
</html>`;
}

function waitForIframeReady(iframe, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const done = () => resolve();
    if (iframe.contentWindow?.document?.readyState === 'complete') {
      setTimeout(done, 50);
      return;
    }
    iframe.onload = () => setTimeout(done, 50);
    setTimeout(done, timeoutMs);
  });
}

async function waitForDocAssets(doc, imageTimeoutMs = 4000) {
  try {
    if (doc?.fonts?.ready) await doc.fonts.ready;
  } catch {
    /* ignore */
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
    }),
  );
}

/**
 * Measure the terms HTML and shrink --bt-scale until content fits within maxPages.
 * Returns a full HTML document string with the chosen scale baked in.
 *
 * @param {string} html
 * @param {{ maxPages?: number, marginInches?: number, minScale?: number, maxScale?: number }} [options]
 * @returns {Promise<string>}
 */
export async function fitBookingTermsHtmlToPages(html, options = {}) {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return html;
  }
  if (!html?.trim()) return html;

  const maxPages = Math.max(1, Number(options.maxPages) || 2);
  const marginInches = Number(options.marginInches) || BOOKING_TERMS_PAGE_MARGIN_IN;
  const minScale = Number(options.minScale) || 0.4;
  const maxScale = Number(options.maxScale) || 1;
  const pageWidthPx = BOOKING_TERMS_PAGE_WIDTH_PX;
  const pageHeightPx = BOOKING_TERMS_PAGE_HEIGHT_PX;
  const contentWidthPx = Math.round(pageWidthPx - 2 * marginInches * 96);
  // Usable height across N pages, with a small buffer so we don't spill to N+1.
  const targetHeight = maxPages * (pageHeightPx - 2 * marginInches * 96) * 0.97;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('title', 'Terms fit measure');
  Object.assign(iframe.style, {
    position: 'fixed',
    left: '-20000px',
    top: '0',
    width: `${contentWidthPx}px`,
    height: `${pageHeightPx}px`,
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
  });
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return html;

    doc.open();
    doc.write(html);
    doc.close();
    await waitForIframeReady(iframe);
    await waitForDocAssets(doc);

    const root = doc.documentElement;
    const wrap = doc.querySelector('.bt-wrap');
    if (!wrap || !root) return html;

    // Match print/PDF content column width (letter minus side margins).
    wrap.style.maxWidth = 'none';
    wrap.style.width = '100%';
    wrap.style.padding = '0';
    wrap.style.margin = '0';

    const applyScale = (scale) => {
      root.style.setProperty('--bt-scale', String(scale));
      // Keep serialized CSS in sync with the measured scale.
      const styleEl = doc.querySelector('head style');
      if (styleEl) {
        styleEl.textContent = styleEl.textContent.replace(
          /--bt-scale:\s*[\d.]+/,
          `--bt-scale: ${scale}`,
        );
      }
      void wrap.offsetHeight;
    };

    const measure = () => Math.ceil(wrap.scrollHeight);

    applyScale(maxScale);
    if (measure() <= targetHeight) {
      return `<!DOCTYPE html>\n${root.outerHTML}`;
    }

    let lo = minScale;
    let hi = maxScale;
    let best = minScale;
    for (let i = 0; i < 14; i += 1) {
      const mid = (lo + hi) / 2;
      applyScale(mid);
      if (measure() <= targetHeight) {
        best = mid;
        lo = mid;
      } else {
        hi = mid;
      }
    }

    applyScale(Number(best.toFixed(4)));
    return `<!DOCTYPE html>\n${root.outerHTML}`;
  } catch (err) {
    console.warn('[fitBookingTermsHtmlToPages] measure failed:', err);
    return html;
  } finally {
    iframe.remove();
  }
}

/**
 * Build a compact HTML email wrapper around the document (or a short notice + document).
 */
export function buildBookingTermsEmailHtml({ documentHtml, introLine } = {}) {
  const intro = String(introLine || 'Please find the signed Terms & Conditions for your booking below.').trim();
  const match = String(documentHtml || '').match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const inner = match ? match[1] : String(documentHtml || '');
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:12px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:720px;margin:0 auto;">
    <p style="margin:0 0 8px;font-size: 13px;color:#334155;line-height:1.35;">${esc(intro)}</p>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      ${inner}
    </div>
  </div>
</body>
</html>`;
}
