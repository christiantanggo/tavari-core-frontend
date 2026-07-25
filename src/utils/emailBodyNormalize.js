/** Frontend mirror of supabase/functions/_shared/emailBodyNormalize.ts */

export function decodeEmailBodyIfBase64(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  if (/\bFrom:\s/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) return trimmed;
  const compact = trimmed.replace(/\s/g, '');
  if (compact.length < 80 || !/^[A-Za-z0-9+/=]+$/.test(compact.slice(0, Math.min(400, compact.length)))) {
    return trimmed;
  }
  try {
    const decoded = atob(compact);
    if (decoded.includes('From:') || decoded.includes('Receipt') || decoded.includes('Invoice')) {
      return decoded;
    }
  } catch {
    /* not base64 */
  }
  return trimmed;
}

export function htmlToPlainText(html) {
  if (!html?.trim()) return '';
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(tr|p|div|li|h[1-6])/gi, '\n')
    .replace(/<\s*\/\s*(td|th)/gi, '\t')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractForwardedReceiptSection(text) {
  const markers = [
    /Begin forwarded message:/i,
    /Receipt from\s+/i,
    /Amount paid\s/i,
    /Your .+ receipt \[/i,
  ];
  let best = text;
  for (const re of markers) {
    const idx = text.search(re);
    if (idx >= 0 && idx < best.length * 0.85) {
      best = text.slice(idx);
    }
  }
  return best;
}

export function normalizeEmailBodyForExtraction(body_text, body_html) {
  let text = decodeEmailBodyIfBase64(body_text || '');
  const htmlPlain = htmlToPlainText(body_html || '');
  if (!text.trim()) text = htmlPlain;
  else if (htmlPlain.length > text.length * 1.5) text = `${text}\n${htmlPlain}`;
  return extractForwardedReceiptSection(text.replace(/\u2007|\u2009|\u00a0/g, ' ').trim());
}
