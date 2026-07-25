/**
 * Standard policy PDF signature blocks.
 * Uses inline styles so signature lines render in html2pdf/html2canvas: when full policy HTML is
 * nested inside #policy-pdf-root, <head> styles often do not apply to .signature-line / .signature-label.
 */

const SIG_WRAP =
  'page-break-inside:avoid;break-inside:avoid;margin-top:28px;padding-top:20px;border-top:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;';
const SIG_TITLE = 'font-size: 18px;font-weight:bold;margin-bottom:14px;color:#111827;';
// Bordered <table> cells paint reliably in html2canvas on very long policies (hr/div bars often vanish).
const SIG_TABLE_ATTRS =
  'role="presentation" cellpadding="0" cellspacing="0" data-tavari-sig-table="1"';
const SIG_TABLE_STYLE =
  'width:280px;max-width:100%;border-collapse:collapse;-webkit-print-color-adjust:exact;print-color-adjust:exact;';
// Visible text color + readable font size: html2canvas often paints 0-height / invisible cells when transparent+2px.
const SIG_LINE_TD =
  'border-bottom:3px solid #000000;padding:8px 0 6px 0;min-height:16px;line-height:1.2;font-size: 14px;color:#111111;';
const SIG_LABEL_TD = 'font-size: 14px;color:#333333;padding:8px 0 0 0;';
const SIG_GAP_TD = 'height:18px;font-size:0;line-height:0;padding:0;';

function signatureTableBlock(signatureLabel) {
  return `<table ${SIG_TABLE_ATTRS} style="${SIG_TABLE_STYLE}">
    <tr><td style="${SIG_LINE_TD}">&nbsp;</td></tr>
    <tr><td style="${SIG_LABEL_TD}">${signatureLabel}</td></tr>
    <tr><td style="${SIG_GAP_TD}">&nbsp;</td></tr>
    <tr><td style="${SIG_LINE_TD}">&nbsp;</td></tr>
    <tr><td style="${SIG_LABEL_TD}">Date</td></tr>
  </table>`;
}

export const POLICY_ACKNOWLEDGMENT_SIGNATURE_INNER_HTML = `
<div style="${SIG_WRAP}">
  <div style="${SIG_TITLE}">Acknowledgment</div>
  ${signatureTableBlock('Employee Signature')}
</div>`;

export const POLICY_CEO_OWNER_SIGNATURE_INNER_HTML = `
<div style="${SIG_WRAP}">
  <div style="${SIG_TITLE}">CEO / Owner</div>
  ${signatureTableBlock('CEO / Owner Signature')}
</div>`;

/**
 * Find signature block: prefer the last match (footer area). Some policies duplicate markup;
 * replacing the first section can miss the visible CEO block at the bottom.
 */
function collectSignatureSectionEls(root) {
  const list = [...root.querySelectorAll('.signature-section')];
  if (list.length === 0) {
    root.querySelectorAll('[class]').forEach((el) => {
      const cn = typeof el.className === 'string' ? el.className : '';
      if (cn.split(/\s+/).some((c) => c.toLowerCase() === 'signature-section')) list.push(el);
    });
  }
  return list;
}

function findSignatureSectionEl(doc) {
  const footers = [...doc.querySelectorAll('.policy-meta-footer')];
  const footer = footers.length ? footers[footers.length - 1] : null;
  const page = footer?.closest('.page-container');
  if (page) {
    const onPage = collectSignatureSectionEls(page);
    if (onPage.length) return onPage[onPage.length - 1];
  }
  const all = collectSignatureSectionEls(doc);
  if (all.length === 0) return null;
  return all[all.length - 1];
}

/**
 * @param {string} htmlString - Full policy document HTML (as stored in hr_policies.policy_html)
 * @param {'acknowledgment' | 'ceo_owner'} variant
 * @returns {string}
 */
export function applyPolicySignatureVariantToHtml(htmlString, variant = 'acknowledgment') {
  if (!htmlString || typeof htmlString !== 'string') return htmlString;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    if (doc.querySelector('parsererror')) return htmlString;

    let sigSection = findSignatureSectionEl(doc);

    const insertBeforeFooter = (innerHTML) => {
      const footers = [...doc.querySelectorAll('.policy-meta-footer')];
      const footer = footers.length ? footers[footers.length - 1] : null;
      if (footer?.parentNode) {
        const el = doc.createElement('div');
        el.className = 'signature-section';
        el.innerHTML = innerHTML;
        footer.parentNode.insertBefore(el, footer);
        return el;
      }
      const page =
        footer?.closest('.page-container') ||
        [...doc.querySelectorAll('.page-container')].reduce(
          (best, el) =>
            (el.textContent || '').length > (best ? (best.textContent || '').length : 0) ? el : best,
          null
        ) ||
        doc.body;
      if (page) {
        const el = doc.createElement('div');
        el.className = 'signature-section';
        el.innerHTML = innerHTML;
        page.appendChild(el);
        return el;
      }
      return null;
    };

    if (!sigSection) {
      const inner =
        variant === 'ceo_owner'
          ? POLICY_CEO_OWNER_SIGNATURE_INNER_HTML
          : POLICY_ACKNOWLEDGMENT_SIGNATURE_INNER_HTML;
      sigSection = insertBeforeFooter(inner);
    } else if (variant === 'ceo_owner') {
      sigSection.innerHTML = POLICY_CEO_OWNER_SIGNATURE_INNER_HTML;
    }

    const serialized = doc.documentElement?.outerHTML;
    if (!serialized) return htmlString;
    // documentElement.outerHTML omits DOCTYPE; match PolicyCenter / email PDF pipeline
    return `<!DOCTYPE html>\n${serialized}`;
  } catch (e) {
    console.warn('[applyPolicySignatureVariantToHtml]', e);
    return htmlString;
  }
}

/**
 * Browsers mangle nested full documents: `<div id="policy-pdf-root"><html>...</html></div>` drops or reorders nodes.
 * Pull `<style>` from head and only embed `body.innerHTML` under #policy-pdf-root so signature lines survive html2canvas.
 * @param {string} htmlString - Full document from applyPolicySignatureVariantToHtml (or raw policy_html)
 * @returns {{ bodyHtml: string, headStyleText: string }}
 */
export function flattenPolicyDocumentForPdfEmbed(htmlString) {
  if (!htmlString || typeof htmlString !== 'string') {
    return { bodyHtml: htmlString || '', headStyleText: '' };
  }
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    if (doc.querySelector('parsererror')) {
      return { bodyHtml: htmlString.replace(/<!DOCTYPE[^>]*>/gi, '').trim(), headStyleText: '' };
    }
    const headStyleText = [...doc.querySelectorAll('head style')]
      .map((s) => s.textContent || '')
      .join('\n');
    const bodyHtml = doc.body ? doc.body.innerHTML : htmlString;
    return { bodyHtml, headStyleText };
  } catch (e) {
    console.warn('[flattenPolicyDocumentForPdfEmbed]', e);
    return { bodyHtml: htmlString, headStyleText: '' };
  }
}

/**
 * Build CEO/Owner signature block in the live DOM (avoids innerHTML/table parse edge cases in long documents).
 * @returns {HTMLDivElement}
 */
function buildCeoOwnerSignatureDom() {
  const block = document.createElement('div');
  block.className = 'signature-section';
  block.setAttribute('data-tavari-ceo-signature', '1');
  block.style.cssText =
    'display:block!important;visibility:visible!important;opacity:1!important;position:relative!important;z-index:10!important;page-break-inside:avoid;break-inside:avoid;margin-top:28px;padding-top:20px;border-top:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;';

  const inner = document.createElement('div');
  inner.style.cssText = SIG_WRAP;

  const title = document.createElement('div');
  title.style.cssText = SIG_TITLE;
  title.textContent = 'CEO / Owner';
  inner.appendChild(title);

  const table = document.createElement('table');
  table.setAttribute('role', 'presentation');
  table.setAttribute('cellpadding', '0');
  table.setAttribute('cellspacing', '0');
  table.setAttribute('data-tavari-sig-table', '1');
  table.style.cssText = SIG_TABLE_STYLE;

  const addRow = (tdStyle, textContent) => {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.style.cssText = tdStyle;
    td.textContent = textContent || '\u00a0';
    tr.appendChild(td);
    table.appendChild(tr);
  };

  addRow(SIG_LINE_TD, '');
  addRow(SIG_LABEL_TD, 'CEO / Owner Signature');
  addRow(SIG_GAP_TD, '\u00a0');
  addRow(SIG_LINE_TD, '');
  addRow(SIG_LABEL_TD, 'Date');

  inner.appendChild(table);
  block.appendChild(inner);
  return block;
}

/**
 * CEO/Owner PDF: some policies have duplicate "CEO / Owner" headings or broken signature HTML.
 * Runs on the live #policy-pdf-root DOM after embed. Inserts before the last .policy-meta-footer in the tree.
 * @param {Element|null} pdfRoot
 */
export function enforceCeoOwnerSignatureInLivePdfRoot(pdfRoot) {
  if (!pdfRoot || typeof document === 'undefined') return;

  const footers = [...pdfRoot.querySelectorAll('.policy-meta-footer')];
  const footer = footers.length ? footers[footers.length - 1] : null;

  const isCeoTitleText = (s) => /^CEO\s*\/\s*Owner$/i.test(String(s || '').replace(/\s+/g, ' ').trim());

  const scopeForCleanup = pdfRoot;

  scopeForCleanup.querySelectorAll('.signature-title').forEach((el) => {
    if (!isCeoTitleText(el.textContent)) return;
    if (!el.closest('.signature-section')) {
      el.remove();
    }
  });

  const strayTitleTags = new Set(['div', 'p', 'span', 'strong', 'b', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
  const walkRemoveStrayCeoHeadings = (node) => {
    if (!node?.childNodes) return;
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = (child.tagName || '').toLowerCase();
        if (['script', 'style'].includes(tag)) return;
        if (
          strayTitleTags.has(tag) &&
          isCeoTitleText(child.textContent) &&
          child.children.length === 0 &&
          !child.closest('.signature-section')
        ) {
          child.remove();
          return;
        }
        walkRemoveStrayCeoHeadings(child);
      }
    });
  };
  walkRemoveStrayCeoHeadings(scopeForCleanup);

  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const depthFromScope = (el) => {
    let d = 0;
    let n = el;
    while (n && n !== scopeForCleanup) {
      d += 1;
      n = n.parentElement;
    }
    return d;
  };
  const ceoDupes = [...scopeForCleanup.querySelectorAll('div, p, span, strong, b, h1, h2, h3, h4, h5, h6, td, th')].filter((el) => {
    if (el.closest('.policy-meta-footer')) return false;
    if (el.closest('.signature-section')) return false;
    if (el.closest('[data-tavari-ceo-signature="1"]')) return false;
    if (el.querySelector?.('table[data-tavari-sig-table="1"]')) return false;
    const t = norm(el.innerText || el.textContent);
    return t === 'CEO / Owner' || t === 'CEO/Owner';
  });
  ceoDupes.sort((a, b) => depthFromScope(b) - depthFromScope(a));
  ceoDupes.forEach((el) => el.remove());

  pdfRoot.querySelectorAll('.signature-section').forEach((el) => el.remove());

  const block = buildCeoOwnerSignatureDom();
  if (footer?.parentNode) {
    footer.parentNode.insertBefore(block, footer);
  } else {
    const page = pdfRoot.querySelector('.page-container') || pdfRoot;
    page.appendChild(block);
  }
}
