/** Parse comma/semicolon-separated emails; returns unique valid addresses. */
export function parseInvoiceEmailList(value) {
  const seen = new Set();
  const results = [];

  String(value || '')
    .split(/[,;]/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .forEach((email) => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
      if (seen.has(email)) return;
      seen.add(email);
      results.push(email);
    });

  return results;
}

export function formatInvoiceEmailList(emails = []) {
  return parseInvoiceEmailList(emails.join(',')).join(', ');
}

export function primaryInvoiceEmail(value) {
  return parseInvoiceEmailList(value)[0] || String(value || '').trim() || null;
}

export const EDITABLE_INVOICE_STATUSES = ['draft', 'sent', 'viewed', 'overdue', 'partially_paid'];

export function isInvoiceEditable(status) {
  return EDITABLE_INVOICE_STATUSES.includes(status);
}
