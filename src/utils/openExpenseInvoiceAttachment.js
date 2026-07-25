const EXPENSE_INVOICES_BUCKET = 'expense-invoices';

function decodeEmailBodyIfBase64(raw) {
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

function htmlToPlainText(html) {
  if (!html?.trim()) return '';
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(tr|p|div|li|h[1-6])/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t\f\v\u2007\u2009\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractForwardedReceiptSection(text) {
  const markers = [/Begin forwarded message:/i, /Receipt from\s+/i, /Amount paid\s/i];
  let best = text;
  for (const re of markers) {
    const idx = text.search(re);
    if (idx >= 0 && idx < best.length * 0.85) best = text.slice(idx);
  }
  return best;
}

function normalizeEmailBody(bodyText, bodyHtml) {
  let text = decodeEmailBodyIfBase64(bodyText || '');
  const htmlPlain = htmlToPlainText(bodyHtml || '');
  if (!text.trim()) text = htmlPlain;
  else if (htmlPlain.length > text.length * 1.5) text = `${text}\n${htmlPlain}`;
  return extractForwardedReceiptSection(text.replace(/\u2007|\u2009|\u00a0/g, ' ').trim());
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildEmailPreviewHtml(emailRow) {
  const bodyHtml = (emailRow?.body_html || '').trim();
  const decoded = decodeEmailBodyIfBase64(emailRow?.body_text || '');
  if (bodyHtml && !/^[A-Za-z0-9+/=\s]{200,}$/.test(bodyHtml.slice(0, 300))) {
    return bodyHtml;
  }
  const plain = normalizeEmailBody(emailRow?.body_text, emailRow?.body_html);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Email receipt</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;padding:24px 32px;line-height:1.5;color:#111;max-width:720px;margin:0 auto;white-space:pre-wrap}</style>
</head><body>${escapeHtml(plain)}</body></html>`;
}

function isEmailBodyPdfPath(path, filename) {
  const p = String(path || '').toLowerCase();
  const f = String(filename || '').toLowerCase();
  return p.endsWith('email-body.pdf') || f === 'email-body.pdf';
}

/**
 * Open expense invoice attachment. For iPhone/Outlook forwards (email-body.pdf), shows decoded email HTML instead of garbled PDF.
 * Prefer invoice_file_path (current/replaced file) over the original email attachment_id.
 */
export async function openExpenseInvoiceAttachment(supabase, draft) {
  const path = draft.invoice_file_path?.trim?.();
  if (!path && !draft.attachment_id) {
    throw new Error('No invoice file attached');
  }

  let storagePath = path || null;
  let contentType = null;
  let filename = path?.split('/').pop() || '';

  // Only fall back to the original email attachment when no current invoice path is set.
  if (!storagePath && draft.attachment_id) {
    const { data: att, error: attErr } = await supabase
      .from('received_email_attachments')
      .select('storage_path, content_type, filename')
      .eq('id', draft.attachment_id)
      .single();
    if (!attErr && att?.storage_path) {
      storagePath = att.storage_path;
      contentType = att.content_type || null;
      filename = att.filename || filename;
    }
  }

  if (!storagePath) throw new Error('Could not find file');

  if (draft.received_email_id && isEmailBodyPdfPath(storagePath, filename)) {
    const { data: emailRow, error: emailErr } = await supabase
      .from('received_emails')
      .select('body_html, body_text, subject')
      .eq('id', draft.received_email_id)
      .single();
    if (!emailErr && emailRow) {
      const html = buildEmailPreviewHtml(emailRow);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
      return;
    }
  }

  const { data } = await supabase.storage.from(EXPENSE_INVOICES_BUCKET).createSignedUrl(storagePath, 3600);
  if (!data?.signedUrl) throw new Error('Could not open file');

  const res = await fetch(data.signedUrl, { cache: 'reload' });
  if (!res.ok) throw new Error('Failed to load file');
  const buf = await res.arrayBuffer();
  const resContentType = res.headers.get('content-type') || contentType;
  const inferred = (resContentType && resContentType !== 'application/octet-stream') ? resContentType : (() => {
    const lower = (storagePath || '').toLowerCase();
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    return 'application/octet-stream';
  })();
  const blob = new Blob([buf], { type: inferred });
  window.open(URL.createObjectURL(blob), '_blank', 'noopener');
}
