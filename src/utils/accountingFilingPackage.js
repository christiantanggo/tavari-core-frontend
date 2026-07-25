export const GST34_BOX_LABELS = {
  box_101: 'Line 101 — Total sales and other revenue',
  box_103: 'Line 103 — GST/HST collected or collectible',
  box_106: 'Line 106 — Input tax credits (ITC)',
  box_109: 'Line 109 — Net tax (remittance or refund)'
};

export function gst34WorksheetRows(worksheet = {}) {
  return ['box_101', 'box_103', 'box_106', 'box_109'].map((box) => ({
    box,
    label: GST34_BOX_LABELS[box] || box,
    value: Math.abs(Number(worksheet[box] ?? 0))
  }));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? `$${Math.abs(n).toFixed(2)}` : '—';
}

function renderTable(title, rows, columns) {
  const header = columns.map((col) => `<th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(col.label)}</th>`).join('');
  const body = (rows || []).map((row) => {
    const cells = columns.map((col) => {
      const raw = row[col.fieldname];
      const display = typeof raw === 'number' ? money(raw) : escapeHtml(raw ?? '');
      return `<td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">${display}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `
    <section style="margin-bottom:32px;page-break-inside:avoid;">
      <h2 style="font-size: 18px;margin:0 0 12px;">${escapeHtml(title)}</h2>
      <table style="width:100%;border-collapse:collapse;font-size: 14px;">
        <thead><tr>${header}</tr></thead>
        <tbody>${body || '<tr><td colspan="99" style="padding:12px;color:#6b7280;">No rows</td></tr>'}</tbody>
      </table>
    </section>`;
}

function checkBadge(status) {
  const colors = {
    pass: { bg: '#ecfdf5', fg: '#047857', label: 'Pass' },
    warn: { bg: '#fffbeb', fg: '#b45309', label: 'Review' },
    fail: { bg: '#fef2f2', fg: '#b91c1c', label: 'Blocked' }
  };
  const tone = colors[status] || colors.warn;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${tone.bg};color:${tone.fg};font-size: 13px;font-weight:600;">${tone.label}</span>`;
}

function renderDetailTable(title, rows, columns, footnote) {
  const table = renderTable(title, rows, columns);
  const note = footnote
    ? `<p style="margin:8px 0 0;font-size: 13px;color:#6b7280;">${escapeHtml(footnote)}</p>`
    : '';
  return table + note;
}

function renderHstAdjustmentSchedule(schedule) {
  if (!schedule) return '';
  const summaryRows = (schedule.summary || []).map((b) => ({
    category: b.label,
    transactions: b.transaction_count,
    subtotal: b.subtotal,
    tax_collected: b.tax_collected,
    expected_full_hst: b.expected_full_hst,
    hst_reduction: b.hst_reduction,
    note: b.description,
  }));

  const lineColumns = [
    { fieldname: 'transaction_date', label: 'Date' },
    { fieldname: 'source_type', label: 'Source' },
    { fieldname: 'source_id', label: 'Reference' },
    { fieldname: 'subtotal', label: 'Subtotal' },
    { fieldname: 'tax_collected', label: 'Tax collected' },
    { fieldname: 'certificate_number', label: 'Cert #' },
    { fieldname: 'expected_full_hst', label: 'Full HST' },
    { fieldname: 'hst_reduction', label: 'HST reduction' },
  ];

  const indianRows = (schedule.indian_status_transactions || []).map((r) => ({
    ...r,
    certificate_number: r.certificate_number || '—',
    source_id: String(r.source_id).slice(0, 8),
  }));

  const zeroRows = (schedule.zero_tax_transactions || []).map((r) => ({
    ...r,
    certificate_number: r.certificate_number || '—',
    source_id: String(r.source_id).slice(0, 8),
  }));

  const totals = schedule.totals || {};
  const notesHtml = (schedule.notes || []).map((n) => `<li>${escapeHtml(n)}</li>`).join('');

  return `
  <section style="margin-bottom:32px;page-break-inside:avoid;">
    <h2 style="font-size: 18px;margin:0 0 8px;">HST collected adjustment schedule</h2>
    <p style="margin:0 0 16px;color:#4b5563;font-size: 14px;">
      Explains why HST collected (Box 103) may differ from ${((schedule.standard_hst_rate || 0.13) * 100).toFixed(1)}% of taxable sales.
      <strong>HST reduction</strong> = full HST that would apply minus tax actually collected.
    </p>
    ${renderTable('Summary by reason', summaryRows, [
      { fieldname: 'category', label: 'Category' },
      { fieldname: 'transactions', label: 'Count' },
      { fieldname: 'subtotal', label: 'Subtotal' },
      { fieldname: 'tax_collected', label: 'Tax collected' },
      { fieldname: 'expected_full_hst', label: 'Full HST @ standard rate' },
      { fieldname: 'hst_reduction', label: 'HST reduction' },
    ])}
    <div style="margin:16px 0;padding:12px;background:#f0fdfa;border-radius:8px;font-size: 14px;">
      <strong>Period totals</strong>
      <p style="margin:8px 0 0;">Taxable subtotal: ${money(totals.subtotal)} · Tax collected: ${money(totals.tax_collected)} · Full HST @ standard rate: ${money(totals.expected_full_hst)} · Total HST reduction: ${money(totals.hst_reduction)}</p>
    </div>
    ${indianRows.length ? renderDetailTable('Indian Status transactions (detail)', indianRows, lineColumns) : '<p style="color:#6b7280;font-size: 14px;">No Indian Status transactions in this period.</p>'}
    ${zeroRows.length ? renderDetailTable(
      'Zero-tax transactions (detail)',
      zeroRows,
      lineColumns,
      schedule.zero_tax_total_count > zeroRows.length
        ? `Showing ${zeroRows.length} of ${schedule.zero_tax_total_count} zero-tax transactions.`
        : ''
    ) : ''}
    <ul style="margin:16px 0 0;padding-left:18px;font-size: 13px;color:#6b7280;">${notesHtml}</ul>
  </section>`;
}

export function buildCraFilingPackageHtml({
  businessName,
  businessId,
  fromDate,
  toDate,
  filingStatus,
  filingReady,
  checks = [],
  worksheet = {},
  hstSummary = {},
  hstAdjustmentSchedule = null,
  pl = {},
  balanceSheet = {},
  trialBalance = {},
  gst34Warnings = []
}) {
  const gstRows = gst34WorksheetRows(worksheet);
  const checklistHtml = (checks || []).map((c) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">${escapeHtml(c.title)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">${checkBadge(c.status)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">${escapeHtml(c.message)}</td>
    </tr>`).join('');

  const warningsHtml = (gst34Warnings || []).length
    ? `<ul style="margin:0;padding-left:18px;color:#92400e;">${gst34Warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`
    : '<p style="margin:0;color:#047857;">No GST34 mapping warnings.</p>';

  const statusLabel = filingReady ? 'Ready for accountant handoff' : filingStatus === 'blocked' ? 'Blocked — fix failed checks' : 'Review recommended before filing';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>CRA Filing Package — ${escapeHtml(businessName || businessId)}</title>
  <style>
    @media print { body { padding: 16px; } section { page-break-inside: avoid; } }
  </style>
</head>
<body style="font-family:Arial,sans-serif;padding:32px;color:#111827;max-width:960px;margin:0 auto;">
  <header style="margin-bottom:32px;border-bottom:2px solid #0d9488;padding-bottom:16px;">
    <h1 style="margin:0 0 8px;font-size: 24px;">CRA Filing Package</h1>
    <p style="margin:0 0 4px;color:#4b5563;">Business: ${escapeHtml(businessName || businessId)}</p>
    <p style="margin:0 0 4px;color:#4b5563;">Reporting period: ${escapeHtml(fromDate)} to ${escapeHtml(toDate)}</p>
    <p style="margin:0 0 4px;color:#4b5563;">Generated: ${escapeHtml(new Date().toLocaleString())}</p>
    <p style="margin:12px 0 0;font-weight:600;color:${filingReady ? '#047857' : '#b45309'};">${escapeHtml(statusLabel)}</p>
  </header>

  <section style="margin-bottom:32px;">
    <h2 style="font-size: 18px;margin:0 0 12px;">Filing reconciliation checklist</h2>
    <table style="width:100%;border-collapse:collapse;font-size: 14px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e5e7eb;">Check</th>
          <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e5e7eb;">Status</th>
          <th style="text-align:left;padding:8px 12px;border-bottom:1px solid #e5e7eb;">Detail</th>
        </tr>
      </thead>
      <tbody>${checklistHtml || '<tr><td colspan="3" style="padding:12px;">No checks run</td></tr>'}</tbody>
    </table>
  </section>

  <section style="margin-bottom:32px;">
    <h2 style="font-size: 18px;margin:0 0 12px;">GST34 worksheet (CRA web form reference)</h2>
    ${renderTable('GST34 boxes', gstRows, [
      { fieldname: 'box', label: 'Box' },
      { fieldname: 'label', label: 'CRA line' },
      { fieldname: 'value', label: 'Amount' }
    ])}
    <div style="margin-top:12px;padding:12px;background:#f9fafb;border-radius:8px;">
      <strong>HST summary</strong>
      <p style="margin:8px 0 0;">Sales total: ${money(hstSummary.sales_total)}</p>
      <p style="margin:4px 0 0;">HST collected: ${money(hstSummary.hst_collected)}</p>
      <p style="margin:4px 0 0;">HST on expenses (ITC): ${money(hstSummary.hst_paid_on_expenses)}</p>
      <p style="margin:4px 0 0;">Net HST ${hstSummary.filing_position === 'refund' ? 'refund' : 'owed'}: ${money(hstSummary.net_hst_owed)}</p>
    </div>
    <div style="margin-top:12px;">${warningsHtml}</div>
  </section>

  ${renderHstAdjustmentSchedule(hstAdjustmentSchedule)}

  ${renderTable('Profit & Loss', pl.result || [], pl.columns || [])}
  ${renderTable('Balance Sheet', balanceSheet.result || [], balanceSheet.columns || [])}
  ${renderTable('Trial Balance', trialBalance.result || [], trialBalance.columns || [])}

  <footer style="margin-top:40px;padding-top:16px;border-top:1px solid #e5e7eb;font-size: 13px;color:#6b7280;">
    <p style="margin:0;">This package is for verification and handoff to your accountant or CRA web filing. Tavari does not e-file returns.</p>
    <p style="margin:8px 0 0;">Print or save as PDF from your browser (Ctrl+P / Cmd+P).</p>
  </footer>
</body>
</html>`;
}

export function downloadCraFilingPackage(html, filename) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function openCraFilingPackagePrint(html) {
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
  return true;
}
