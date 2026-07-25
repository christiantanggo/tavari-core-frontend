function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoney(amount) {
  return `$${Number(amount || 0).toFixed(2)}`;
}

/**
 * Generate printable invoice HTML (PDF + email body).
 */
export function generateInvoiceHTML(invoice, businessDisplay, options = {}) {
  const lines = invoice.tavari_invoice_line_items || [];
  const sourceLinks = invoice.tavari_invoice_source_links || [];
  const legalName = invoice.display_legal_name || businessDisplay.legal_name || 'Business';
  const dba = invoice.display_dba || businessDisplay.dba || '';
  const addressLines = [
    invoice.display_address || businessDisplay.address,
    [invoice.display_city || businessDisplay.city, invoice.display_state || businessDisplay.state, invoice.display_postal || businessDisplay.postal]
      .filter(Boolean)
      .join(', '),
  ].filter(Boolean);
  const taxNumber = invoice.display_tax_number || businessDisplay.tax_number || '';
  const logoUrl = invoice.logo_url || businessDisplay.logo_url || '';
  const balanceDue = Number(invoice.balance_due) || 0;
  const isSummary = invoice.invoice_type === 'summary';
  const showPayNow = balanceDue > 0 && options.payUrl;

  const lineRows = lines
    .map(
      (line) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee;">
          ${escapeHtml(line.name)}${line.participant_name ? `<br><small>${escapeHtml(line.participant_name)}</small>` : ''}
          ${line.description ? `<br><small style="color:#666;">${escapeHtml(line.description)}</small>` : ''}
        </td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${escapeHtml(line.quantity)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${formatMoney(line.unit_price)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${line.tax_exempt ? 'Exempt' : formatMoney(line.tax_amount)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${formatMoney(line.total_price ?? line.quantity * line.unit_price)}</td>
      </tr>`
    )
    .join('');

  const sourceRows =
    sourceLinks.length > 0
      ? `<div style="margin-top:24px;">
          <h3 style="margin:0 0 8px;font-size: 14px;">Referenced transactions</h3>
          <table style="width:100%;border-collapse:collapse;font-size: 13px;">
            ${sourceLinks
              .map(
                (link) => `
              <tr>
                <td style="padding:6px;border-bottom:1px solid #eee;">${escapeHtml(link.display_label || link.source_type)}</td>
                <td style="padding:6px;border-bottom:1px solid #eee;text-align:right;">${formatMoney(link.amount)}</td>
                <td style="padding:6px;border-bottom:1px solid #eee;">${escapeHtml(link.payment_method_summary || '')}</td>
              </tr>`
              )
              .join('')}
          </table>
        </div>`
      : '';

  const eTransferBlock =
    balanceDue > 0 && businessDisplay.e_transfer_email
      ? `<div style="margin-top:20px;padding:12px;background:#f9fafb;border-radius:8px;font-size: 13px;">
          <strong>E-Transfer</strong><br>
          Send to: ${escapeHtml(businessDisplay.e_transfer_email)}<br>
          For password enter: ${escapeHtml(businessDisplay.e_transfer_password_hint || 'Tanggo')}
        </div>`
      : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Invoice ${escapeHtml(invoice.invoice_number)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111; margin: 0; padding: 24px; }
    .invoice-wrap { max-width: 800px; margin: 0 auto; }
    .invoice-header { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
    .invoice-meta { text-align: right; font-size: 14px; }
    .invoice-line-items { width: 100%; border-collapse: collapse; margin-top: 16px; }
    .invoice-line-items th { text-align: left; padding: 8px; border-bottom: 2px solid #333; font-size: 13px; }
    .invoice-totals { margin-top: 16px; width: 280px; margin-left: auto; font-size: 14px; }
    .invoice-totals div { display: flex; justify-content: space-between; padding: 4px 0; }
    .pay-now { display: inline-block; margin-top: 16px; padding: 12px 24px; background: #008080; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 700; }
    .paid-banner { background: #ecfdf5; color: #065f46; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="invoice-wrap">
    <div class="invoice-header">
      <div>
        ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="Logo" style="max-height:72px;max-width:220px;" />` : ''}
        <div style="margin-top:12px;font-size: 18px;font-weight:700;">${escapeHtml(legalName)}</div>
        ${dba ? `<div style="font-size: 14px;color:#555;">DBA: ${escapeHtml(dba)}</div>` : ''}
        ${addressLines.map((l) => `<div style="font-size: 13px;color:#555;">${escapeHtml(l)}</div>`).join('')}
        ${taxNumber ? `<div style="font-size: 13px;margin-top:6px;">${escapeHtml(taxNumber)}</div>` : ''}
      </div>
      <div class="invoice-meta">
        <div style="font-size: 23px;font-weight:700;">INVOICE</div>
        <div><strong>#</strong> ${escapeHtml(invoice.invoice_number)}</div>
        <div><strong>Date</strong> ${escapeHtml((invoice.first_sent_at || invoice.created_at || '').slice(0, 10))}</div>
        ${invoice.due_date ? `<div><strong>Due</strong> ${escapeHtml(invoice.due_date)}</div>` : ''}
        <div style="margin-top:8px;text-transform:capitalize;"><strong>Status:</strong> ${escapeHtml(invoice.status?.replace('_', ' '))}</div>
      </div>
    </div>

    <div style="font-size: 14px;margin-bottom:16px;">
      <strong>Bill to:</strong><br>
      ${escapeHtml(invoice.recipient_name)}<br>
      ${invoice.recipient_company ? `${escapeHtml(invoice.recipient_company)}<br>` : ''}
      ${invoice.recipient_email ? `${escapeHtml(invoice.recipient_email)}<br>` : ''}
      ${invoice.recipient_phone ? escapeHtml(invoice.recipient_phone) : ''}
    </div>

    ${balanceDue <= 0 && isSummary ? '<div class="paid-banner">Summary invoice — paid in full. No balance due.</div>' : ''}
    ${balanceDue <= 0 && !isSummary ? '<div class="paid-banner">Paid in full — thank you.</div>' : ''}

    <table class="invoice-line-items">
      <thead>
        <tr>
          <th>Description</th>
          <th style="text-align:center;">Qty</th>
          <th style="text-align:right;">Unit</th>
          <th style="text-align:right;">Tax</th>
          <th style="text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>${lineRows}</tbody>
    </table>

    <div class="invoice-totals invoice-totals">
      <div><span>Subtotal</span><span>${formatMoney(invoice.subtotal)}</span></div>
      <div><span>Tax</span><span>${formatMoney(invoice.tax_amount)}</span></div>
      <div style="font-weight:700;font-size: 16px;border-top:1px solid #333;padding-top:8px;">
        <span>Total</span><span>${formatMoney(invoice.total)}</span>
      </div>
      ${balanceDue > 0 ? `<div style="color:#dc2626;font-weight:700;"><span>Balance due</span><span>${formatMoney(balanceDue)}</span></div>` : ''}
    </div>

    ${invoice.notes ? `<div style="margin-top:20px;font-size: 13px;"><strong>Notes</strong><br>${escapeHtml(invoice.notes)}</div>` : ''}
    ${invoice.footer_terms ? `<div style="margin-top:12px;font-size: 13px;color:#555;">${escapeHtml(invoice.footer_terms)}</div>` : ''}
    ${invoice.indian_status_certificate_number ? `<div style="margin-top:12px;font-size: 13px;">Indian Status certificate: ${escapeHtml(invoice.indian_status_certificate_number)}</div>` : ''}

    ${sourceRows}
    ${eTransferBlock}

    ${showPayNow ? `<a class="pay-now" href="${escapeHtml(options.payUrl)}">Pay Now</a>` : ''}
    ${options.trackingPixelUrl ? `<img src="${escapeHtml(options.trackingPixelUrl)}" alt="" width="1" height="1" style="display:none;" />` : ''}
  </div>
</body>
</html>`;
}

export function buildBusinessDisplay(invoice, business, settings) {
  return {
    legal_name: business?.name || '',
    dba: invoice?.display_dba || settings?.doing_business_as || '',
    address: invoice?.display_address || settings?.address_override || business?.business_address || '',
    city: invoice?.display_city || settings?.city_override || business?.business_city || '',
    state: invoice?.display_state || settings?.state_override || business?.business_state || 'ON',
    postal: invoice?.display_postal || settings?.postal_override || business?.business_postal || '',
    tax_number: invoice?.display_tax_number || settings?.tax_number_override || business?.tax_number || '',
    logo_url: invoice?.logo_url || settings?.default_logo_url || business?.logo_url || '',
    e_transfer_email: business?.business_email || '',
    e_transfer_password_hint: settings?.e_transfer_password_hint || 'Tanggo',
  };
}
