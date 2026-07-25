export const VENDING_STAFF_DISPENSE_PRINT_SECTIONS = [
  {
    id: 'report_header',
    label: 'Report header',
    description: 'Business name, date range, filters, and generated time.'
  },
  {
    id: 'summary_totals',
    label: 'Summary totals',
    description: 'Total dispenses, unique staff, products, and units.'
  },
  {
    id: 'by_staff',
    label: 'Totals by staff',
    description: 'Each staff member with unit count and line count.'
  },
  {
    id: 'by_product',
    label: 'Totals by product',
    description: 'Each product with total quantity dispensed.'
  },
  {
    id: 'by_day',
    label: 'Totals by day',
    description: 'Daily unit totals across the selected range.'
  },
  {
    id: 'by_device',
    label: 'Totals by device',
    description: 'Each vending device with unit totals.'
  },
  {
    id: 'detail_lines',
    label: 'Detail lines',
    description: 'Every dispense line with staff, product, device, and time.'
  }
];

export const DEFAULT_VENDING_STAFF_DISPENSE_PRINT_SECTIONS = Object.fromEntries(
  VENDING_STAFF_DISPENSE_PRINT_SECTIONS.map((section) => [section.id, true])
);

const PRINT_SECTIONS_STORAGE_PREFIX = 'tavari_vending_staff_dispense_print_sections_';

export function loadSavedVendingStaffDispensePrintSections(businessId) {
  if (!businessId || typeof window === 'undefined') {
    return { ...DEFAULT_VENDING_STAFF_DISPENSE_PRINT_SECTIONS };
  }
  try {
    const raw = window.localStorage.getItem(`${PRINT_SECTIONS_STORAGE_PREFIX}${businessId}`);
    if (!raw) return { ...DEFAULT_VENDING_STAFF_DISPENSE_PRINT_SECTIONS };
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULT_VENDING_STAFF_DISPENSE_PRINT_SECTIONS };
    VENDING_STAFF_DISPENSE_PRINT_SECTIONS.forEach((section) => {
      if (typeof parsed[section.id] === 'boolean') {
        merged[section.id] = parsed[section.id];
      }
    });
    return merged;
  } catch {
    return { ...DEFAULT_VENDING_STAFF_DISPENSE_PRINT_SECTIONS };
  }
}

export function saveVendingStaffDispensePrintSections(businessId, sections) {
  if (!businessId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${PRINT_SECTIONS_STORAGE_PREFIX}${businessId}`,
      JSON.stringify(sections)
    );
  } catch {
    // ignore
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateTime(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch {
    return String(value);
  }
}

function formatDay(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      weekday: 'short'
    });
  } catch {
    return String(value);
  }
}

function buildTable(headers, rows) {
  if (!rows.length) {
    return '<p class="muted">No rows in this section.</p>';
  }
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`
    )
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function buildVendingStaffDispenseReportAggregates(rows) {
  const byStaff = new Map();
  const byProduct = new Map();
  const byDay = new Map();
  const byDevice = new Map();

  for (const row of rows) {
    const staffKey = row.staff_name || row.staff_user_id || 'Unknown';
    const productKey = row.goods_name || row.manufacturer_goods_id || 'Unknown';
    const dayKey = row.dispensed_at ? row.dispensed_at.slice(0, 10) : 'unknown';
    const deviceKey = row.device_name || row.vending_device_id || 'Unknown';
    const qty = Number(row.quantity || 1);

    const staffRow = byStaff.get(staffKey) || { staff: staffKey, units: 0, lines: 0 };
    staffRow.units += qty;
    staffRow.lines += 1;
    byStaff.set(staffKey, staffRow);

    const productRow = byProduct.get(productKey) || { product: productKey, units: 0, lines: 0 };
    productRow.units += qty;
    productRow.lines += 1;
    byProduct.set(productKey, productRow);

    const dayRow = byDay.get(dayKey) || { day: dayKey, units: 0, lines: 0 };
    dayRow.units += qty;
    dayRow.lines += 1;
    byDay.set(dayKey, dayRow);

    const deviceRow = byDevice.get(deviceKey) || { device: deviceKey, units: 0, lines: 0 };
    deviceRow.units += qty;
    deviceRow.lines += 1;
    byDevice.set(deviceKey, deviceRow);
  }

  return {
    totalUnits: rows.reduce((sum, row) => sum + Number(row.quantity || 1), 0),
    totalLines: rows.length,
    uniqueStaff: byStaff.size,
    uniqueProducts: byProduct.size,
    byStaff: [...byStaff.values()].sort((a, b) => b.units - a.units),
    byProduct: [...byProduct.values()].sort((a, b) => b.units - a.units),
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byDevice: [...byDevice.values()].sort((a, b) => b.units - a.units)
  };
}

export function buildVendingStaffDispensePrintHtml({
  businessName,
  filters,
  rows,
  sections
}) {
  const enabled = sections || DEFAULT_VENDING_STAFF_DISPENSE_PRINT_SECTIONS;
  const aggregates = buildVendingStaffDispenseReportAggregates(rows);
  const parts = [];

  parts.push(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Staff dispense report</title>
<style>
  body { font-family: Arial, sans-serif; color: #111; margin: 24px; }
  h1, h2 { margin: 0 0 8px; }
  .muted { color: #666; }
  .section { margin: 24px 0; page-break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 13px; }
  th { background: #f5f5f5; }
  .summary-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .summary-card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
</style></head><body>`);

  if (enabled.report_header) {
    parts.push(`<div class="section">
      <h1>Staff dispense report</h1>
      <p class="muted">${escapeHtml(businessName || 'Business')}</p>
      <p><strong>Date range:</strong> ${escapeHtml(filters.dateFrom || '—')} to ${escapeHtml(filters.dateTo || '—')}</p>
      <p><strong>Device:</strong> ${escapeHtml(filters.deviceLabel || 'All devices')}</p>
      <p><strong>Staff:</strong> ${escapeHtml(filters.staffLabel || 'All staff')}</p>
      <p><strong>Product:</strong> ${escapeHtml(filters.productLabel || 'All products')}</p>
      <p class="muted">Generated ${escapeHtml(formatDateTime(new Date().toISOString()))}</p>
    </div>`);
  }

  if (enabled.summary_totals) {
    parts.push(`<div class="section">
      <h2>Summary totals</h2>
      <div class="summary-grid">
        <div class="summary-card"><strong>Total units</strong><br>${aggregates.totalUnits}</div>
        <div class="summary-card"><strong>Detail lines</strong><br>${aggregates.totalLines}</div>
        <div class="summary-card"><strong>Unique staff</strong><br>${aggregates.uniqueStaff}</div>
        <div class="summary-card"><strong>Unique products</strong><br>${aggregates.uniqueProducts}</div>
      </div>
    </div>`);
  }

  if (enabled.by_staff) {
    parts.push(`<div class="section"><h2>Totals by staff</h2>${buildTable(
      ['Staff', 'Units', 'Lines'],
      aggregates.byStaff.map((row) => [row.staff, row.units, row.lines])
    )}</div>`);
  }

  if (enabled.by_product) {
    parts.push(`<div class="section"><h2>Totals by product</h2>${buildTable(
      ['Product', 'Units', 'Lines'],
      aggregates.byProduct.map((row) => [row.product, row.units, row.lines])
    )}</div>`);
  }

  if (enabled.by_day) {
    parts.push(`<div class="section"><h2>Totals by day</h2>${buildTable(
      ['Day', 'Units', 'Lines'],
      aggregates.byDay.map((row) => [formatDay(row.day), row.units, row.lines])
    )}</div>`);
  }

  if (enabled.by_device) {
    parts.push(`<div class="section"><h2>Totals by device</h2>${buildTable(
      ['Device', 'Units', 'Lines'],
      aggregates.byDevice.map((row) => [row.device, row.units, row.lines])
    )}</div>`);
  }

  if (enabled.detail_lines) {
    parts.push(`<div class="section"><h2>Detail lines</h2>${buildTable(
      ['When', 'Staff', 'Product', 'Qty', 'Device', 'Order #'],
      rows.map((row) => [
        formatDateTime(row.dispensed_at),
        row.staff_name || '—',
        row.goods_name || row.manufacturer_goods_id || '—',
        row.quantity || 1,
        row.device_name || '—',
        row.order_no || '—'
      ])
    )}</div>`);
  }

  parts.push('</body></html>');
  return parts.join('');
}

export function printVendingStaffDispenseReport(html) {
  // Use a hidden iframe instead of window.open — pop-up blockers often block blank tabs.
  const existing = document.getElementById('tavari-vending-staff-print-frame');
  if (existing) existing.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'tavari-vending-staff-print-frame';
  iframe.setAttribute('title', 'Staff dispense print');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  document.body.appendChild(iframe);

  const frameDoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!frameDoc || !iframe.contentWindow) {
    iframe.remove();
    throw new Error('Could not open the print view. Try again.');
  }

  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();

  const triggerPrint = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } finally {
      // Keep the frame briefly so the print dialog can finish loading content.
      setTimeout(() => {
        if (iframe.parentNode) iframe.remove();
      }, 60_000);
    }
  };

  if (frameDoc.readyState === 'complete') {
    setTimeout(triggerPrint, 250);
  } else {
    iframe.onload = () => setTimeout(triggerPrint, 250);
  }
}
