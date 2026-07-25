// helpers/ReceiptBuilder.js
// Steps 61-62, 85: Generate receipt HTML for all types with QR codes and tax calculation

export const RECEIPT_TYPES = {
  STANDARD: 'standard',
  GIFT: 'gift',
  KITCHEN: 'kitchen',
  REFUND: 'refund',
  REPRINT: 'reprint',
  EMAIL: 'email'
};

/**
 * Generate a simple QR code using ASCII characters
 * In production, you'd use a proper QR library like qrcode.js
 */
function generateSimpleQR(data) {
  // This is a placeholder - in production use a real QR library
  const qrSize = 15;
  const hash = data.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  
  let qr = '';
  for (let i = 0; i < qrSize; i++) {
    for (let j = 0; j < qrSize; j++) {
      const seed = (i * qrSize + j + Math.abs(hash)) % 4;
      qr += seed < 2 ? '██' : '░░';
    }
    qr += '\n';
  }
  return qr;
}

/**
 * Get business information with real data or sensible defaults
 */
function getBusinessInfo(businessSettings) {
  return {
    name: businessSettings.business_name || 'Tavari POS Demo',
    address1: businessSettings.business_address || '123 Main Street',
    address2: businessSettings.business_city ? 
      `${businessSettings.business_city}, ${businessSettings.business_state || 'ON'} ${businessSettings.business_postal || 'N1A 1A1'}` :
      'Your City, ON N1A 1A1',
    phone: businessSettings.business_phone || '(519) 555-0123',
    email: businessSettings.business_email || 'hello@yourbusiness.com',
    website: businessSettings.business_website || 'www.yourbusiness.com',
    tax_number: businessSettings.tax_number || 'HST# 123456789RT0001'
  };
}

/**
 * Generate receipt HTML for different receipt types
 * @param {Object} saleData - Complete sale data including items, payments, customer info
 * @param {String} receiptType - Type of receipt to generate
 * @param {Object} businessSettings - Business configuration for receipt footer, tax rules, etc.
 * @param {Object} options - Additional options like reprint reason, refund details
 */
export function generateReceiptHTML(saleData, receiptType = RECEIPT_TYPES.STANDARD, businessSettings = {}, options = {}) {
  const receiptId = `${saleData.sale_number || 'RECEIPT'}-${Date.now()}`;
  const timestamp = new Date().toLocaleString();
  const business = getBusinessInfo(businessSettings);
  
  // Generate QR code data for receipt lookup
  const qrData = JSON.stringify({
    type: 'receipt_lookup',
    sale_id: saleData.sale_id,
    sale_number: saleData.sale_number,
    business_id: saleData.business_id,
    total: saleData.final_total || saleData.total_amount,
    date: saleData.created_at || new Date().toISOString()
  });

  // Base receipt styles
  const styles = `
    <style>
      .receipt {
        font-family: 'Courier New', monospace;
        width: 280px;
        margin: 0 auto;
        padding: 10px;
        background: white;
        color: black;
        font-size: 12px;
        line-height: 1.4;
      }
      .header {
        text-align: center;
        border-bottom: 2px solid #000;
        padding-bottom: 10px;
        margin-bottom: 15px;
      }
      .business-name {
        font-size: 16px;
        font-weight: bold;
        margin-bottom: 5px;
      }
      .business-info {
        font-size: 10px;
        margin-bottom: 2px;
      }
      .receipt-title {
        font-size: 14px;
        font-weight: bold;
        margin: 10px 0;
      }
      .receipt-info {
        margin-bottom: 15px;
        font-size: 11px;
      }
      .items-section {
        border-bottom: 1px solid #000;
        padding-bottom: 10px;
        margin-bottom: 10px;
      }
      .item {
        display: flex;
        justify-content: space-between;
        margin-bottom: 3px;
      }
      .item-name {
        flex: 1;
        padding-right: 10px;
      }
      .item-price {
        white-space: nowrap;
      }
      .modifier {
        margin-left: 15px;
        font-size: 10px;
        color: #666;
        font-style: italic;
      }
      .totals-section {
        border-bottom: 1px solid #000;
        padding-bottom: 10px;
        margin-bottom: 10px;
      }
      .total-row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 2px;
      }
      .total-final {
        font-weight: bold;
        font-size: 14px;
        border-top: 1px solid #000;
        padding-top: 5px;
        margin-top: 5px;
      }
      .payment-section {
        margin-bottom: 15px;
      }
      .payment-row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 2px;
      }
      .footer {
        text-align: center;
        border-top: 1px solid #000;
        padding-top: 10px;
        font-size: 10px;
      }
      .qr-code {
        text-align: center;
        margin: 15px 0;
        font-family: monospace;
        font-size: 8px;
        line-height: 0.8;
        white-space: pre;
      }
      .qr-label {
        font-family: 'Courier New', monospace;
        font-size: 10px;
        margin-bottom: 5px;
      }
      .kitchen-priority {
        background: #ffeb3b;
        color: #000;
        padding: 5px;
        text-align: center;
        font-weight: bold;
        margin-bottom: 10px;
      }
      .refund-notice {
        background: #f44336;
        color: white;
        padding: 5px;
        text-align: center;
        font-weight: bold;
        margin-bottom: 10px;
      }
      .gift-notice {
        background: #4caf50;
        color: white;
        padding: 5px;
        text-align: center;
        font-weight: bold;
        margin-bottom: 10px;
      }
      .reprint-notice {
        background: #ff9800;
        color: white;
        padding: 5px;
        text-align: center;
        font-weight: bold;
        margin-bottom: 10px;
      }
      .signature-line {
        border-top: 1px solid #000;
        margin-top: 30px;
        padding-top: 5px;
        text-align: center;
      }
      @media print {
        .receipt {
          width: auto;
          margin: 0;
          padding: 0;
        }
      }
    </style>
  `;

  // Receipt type specific notices
  const getReceiptNotice = () => {
    switch (receiptType) {
      case RECEIPT_TYPES.KITCHEN:
        return '<div class="kitchen-priority">🍽️ KITCHEN ORDER</div>';
      case RECEIPT_TYPES.GIFT:
        return '<div class="gift-notice">🎁 GIFT RECEIPT</div>';
      case RECEIPT_TYPES.REFUND:
        return '<div class="refund-notice">↩️ REFUND RECEIPT</div>';
      case RECEIPT_TYPES.REPRINT:
        return `<div class="reprint-notice">🔄 REPRINTED - ${options.reprintReason || 'Customer Request'}</div>`;
      default:
        return '';
    }
  };

  // Business header information with real data
  const businessHeader = `
    <div class="header">
      <div class="business-name">${business.name}</div>
      <div class="business-info">${business.address1}</div>
      <div class="business-info">${business.address2}</div>
      <div class="business-info">Phone: ${business.phone}</div>
      <div class="business-info">Email: ${business.email}</div>
      <div class="business-info">${business.tax_number}</div>
    </div>
  `;

  // Receipt information section
  const receiptInfo = `
    <div class="receipt-info">
      <div><strong>Receipt #:</strong> ${saleData.sale_number || receiptId}</div>
      <div><strong>Date:</strong> ${new Date(saleData.created_at || Date.now()).toLocaleString()}</div>
      ${saleData.employee_name ? `<div><strong>Cashier:</strong> ${saleData.employee_name}</div>` : ''}
      ${saleData.terminal_id ? `<div><strong>Terminal:</strong> ${saleData.terminal_id}</div>` : ''}
      ${saleData.customer_name ? `<div><strong>Customer:</strong> ${saleData.customer_name}</div>` : ''}
      ${receiptType === RECEIPT_TYPES.REPRINT ? `<div><strong>Reprinted:</strong> ${timestamp}</div>` : ''}
    </div>
  `;

  // Items section with proper modifier handling
  const itemsSection = () => {
    if (!saleData.items || saleData.items.length === 0) {
      return '<div class="items-section"><div>No items found</div></div>';
    }

    let itemsHTML = '<div class="items-section">';
    
    saleData.items.forEach(item => {
      const itemTotal = (item.price || 0) * (item.quantity || 1);
      
      // Main item line - for gift receipts, don't show prices
      if (receiptType === RECEIPT_TYPES.GIFT) {
        itemsHTML += `
          <div class="item">
            <div class="item-name">
              ${item.quantity}x ${item.name}
              ${receiptType === RECEIPT_TYPES.KITCHEN && item.station_id ? ` → ${item.station_id}` : ''}
            </div>
            <div class="item-price">GIFT</div>
          </div>
        `;
      } else {
        itemsHTML += `
          <div class="item">
            <div class="item-name">
              ${item.quantity}x ${item.name}
              ${receiptType === RECEIPT_TYPES.KITCHEN && item.station_id ? ` → ${item.station_id}` : ''}
            </div>
            <div class="item-price">$${itemTotal.toFixed(2)}</div>
          </div>
        `;
      }

      // Modifiers (if any) - show for gift receipts but without prices
      if (item.modifiers && item.modifiers.length > 0) {
        item.modifiers.forEach(modifier => {
          const modPrice = Number(modifier.price) || 0;
          if (receiptType === RECEIPT_TYPES.GIFT) {
            itemsHTML += `
              <div class="modifier">
                ${modifier.required ? '• ' : '+ '}${modifier.name}
              </div>
            `;
          } else {
            itemsHTML += `
              <div class="modifier">
                ${modifier.required ? '• ' : '+ '}${modifier.name}
                ${modPrice > 0 ? ` (+$${modPrice.toFixed(2)})` : ' (Free)'}
              </div>
            `;
          }
        });
      }

      // Item notes
      if (item.notes) {
        itemsHTML += `<div class="modifier">Note: ${item.notes}</div>`;
      }

      // If this is a table share item, show the original table items indented
      if (item.isTableShare && item.originalTableItems && Array.isArray(item.originalTableItems)) {
        item.originalTableItems.forEach(tableItem => {
          const tableItemTotal = (tableItem.price || 0) * (tableItem.quantity || 1);
          itemsHTML += `
            <div class="modifier" style="margin-left: 20px; padding-left: 10px; border-left: 2px solid #e0e0e0;">
              ${tableItem.quantity || 1}x ${tableItem.name} - $${(tableItem.price || 0).toFixed(2)} × ${tableItem.quantity || 1} = $${tableItemTotal.toFixed(2)}
            </div>
          `;
        });
      }
    });

    itemsHTML += '</div>';
    return itemsHTML;
  };

  // Totals section with dynamic tax calculation
  const totalsSection = () => {
    // Don't show totals on gift receipts
    if (receiptType === RECEIPT_TYPES.GIFT) {
      return '';
    }

    const subtotal = saleData.subtotal || 0;
    const discountAmount = saleData.discount_amount || saleData.discount || 0;
    const loyaltyRedemption = saleData.loyalty_redemption || saleData.loyalty_discount || 0;
    const taxAmount = saleData.tax_amount || saleData.tax || 0;
    const tipAmount = saleData.tip_amount || 0;
    const finalTotal = saleData.final_total || saleData.total_amount || saleData.total || 0;

    let totalsHTML = '<div class="totals-section">';
    
    // Subtotal
    totalsHTML += `
      <div class="total-row">
        <span>Subtotal:</span>
        <span>$${subtotal.toFixed(2)}</span>
      </div>
    `;

    // Discounts
    if (discountAmount > 0) {
      totalsHTML += `
        <div class="total-row">
          <span>Discount:</span>
          <span>-$${discountAmount.toFixed(2)}</span>
        </div>
      `;
    }

    // Loyalty redemption
    if (loyaltyRedemption > 0) {
      totalsHTML += `
        <div class="total-row">
          <span>Loyalty Credit:</span>
          <span>-$${loyaltyRedemption.toFixed(2)}</span>
        </div>
      `;
    }

    // Tax
    if (taxAmount > 0) {
      const taxRate = businessSettings.tax_rate || 0.13;
      totalsHTML += `
        <div class="total-row">
          <span>Tax (${(taxRate * 100).toFixed(1)}%):</span>
          <span>$${taxAmount.toFixed(2)}</span>
        </div>
      `;
    }

    // Tip
    if (tipAmount > 0) {
      totalsHTML += `
        <div class="total-row">
          <span>Tip:</span>
          <span>$${tipAmount.toFixed(2)}</span>
        </div>
      `;
    }

    // Final total
    totalsHTML += `
      <div class="total-row total-final">
        <span>TOTAL:</span>
        <span>$${finalTotal.toFixed(2)}</span>
      </div>
    `;

    totalsHTML += '</div>';
    return totalsHTML;
  };

  // Payment section (not shown on gift receipts or kitchen receipts)
  const paymentSection = () => {
    if (receiptType === RECEIPT_TYPES.GIFT || receiptType === RECEIPT_TYPES.KITCHEN) {
      return '';
    }

    if (!saleData.payments || saleData.payments.length === 0) {
      return '<div class="payment-section"><div>Payment information not available</div></div>';
    }

    let paymentHTML = '<div class="payment-section">';
    
    saleData.payments.forEach(payment => {
      const methodName = payment.custom_method_name || payment.custom_metl || payment.payment_method || payment.method;
      paymentHTML += `
        <div class="payment-row">
          <span>${methodName.charAt(0).toUpperCase() + methodName.slice(1)}:</span>
          <span>$${Number(payment.amount).toFixed(2)}</span>
        </div>
      `;
    });

    // Change given
    if (saleData.change_given > 0) {
      paymentHTML += `
        <div class="payment-row">
          <span><strong>Change:</strong></span>
          <span><strong>$${saleData.change_given.toFixed(2)}</strong></span>
        </div>
      `;
    }

    paymentHTML += '</div>';
    return paymentHTML;
  };

  // QR Code section (for receipt lookup and refunds)
  const qrSection = () => {
    if (receiptType === RECEIPT_TYPES.KITCHEN) {
      return ''; // No QR needed for kitchen receipts
    }

    const qrCode = generateSimpleQR(qrData);
    
    return `
      <div class="qr-code">
        <div class="qr-label">Scan for receipt lookup:</div>
        ${qrCode}
        <div style="font-size: 8px; margin-top: 5px;">
          Receipt ID: ${saleData.sale_number}
        </div>
      </div>
    `;
  };

  // Footer with business information and policies
  const footerSection = () => {
    let footerHTML = '<div class="footer">';
    
    // Custom business footer
    if (businessSettings.receipt_footer) {
      footerHTML += `<div style="margin-bottom: 10px;">${businessSettings.receipt_footer}</div>`;
    }

    // Default footer messages
    if (receiptType === RECEIPT_TYPES.STANDARD) {
      footerHTML += `
        <div style="margin-bottom: 10px;">
          Thank you for your business!<br>
          Questions? Email: ${business.email}
        </div>
      `;
    }

    // Gift receipt specific footer
    if (receiptType === RECEIPT_TYPES.GIFT) {
      footerHTML += `
        <div style="margin-bottom: 10px;">
          Gift Receipt - No prices shown<br>
          Valid for returns with original receipt<br>
          Contact: ${business.phone}
        </div>
      `;
    }

    // Refund specific footer
    if (receiptType === RECEIPT_TYPES.REFUND) {
      footerHTML += `
        <div style="margin-bottom: 10px;">
          Refund processed: ${timestamp}<br>
          ${options.refundReason ? `Reason: ${options.refundReason}` : ''}
        </div>
      `;
    }

    // Loyalty program info (if customer attached)
    if (saleData.loyalty_customer_id && receiptType !== RECEIPT_TYPES.KITCHEN && receiptType !== RECEIPT_TYPES.GIFT) {
      const earnedAmount = (saleData.subtotal || 0) * (businessSettings.redemption_rate || 0.01);
      footerHTML += `
        <div style="margin-bottom: 10px;">
          Loyalty earned: $${earnedAmount.toFixed(2)}<br>
          Thank you for being a loyal customer!
        </div>
      `;
    }

    // Powered by Tavari
    footerHTML += `
      <div style="margin-top: 15px; font-size: 9px; color: #666;">
        ${business.website}<br>
        Powered by Tavari POS
      </div>
    `;

    footerHTML += '</div>';
    return footerHTML;
  };

  // Signature lines for refunds and manager overrides
  const signatureSection = () => {
    if (receiptType === RECEIPT_TYPES.REFUND || options.requiresSignature) {
      return `
        <div class="signature-line">
          Employee: ___________________ Date: ___________
        </div>
        <div class="signature-line">
          Customer: __________________ Date: ___________
        </div>
        ${options.managerOverride ? `
        <div class="signature-line">
          Manager: ___________________ Date: ___________
        </div>
        ` : ''}
      `;
    }
    return '';
  };

  // Assemble the complete receipt
  const receiptHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Receipt - ${saleData.sale_number || receiptId}</title>
      ${styles}
    </head>
    <body>
      <div class="receipt">
        ${getReceiptNotice()}
        ${businessHeader}
        <div class="receipt-title">${getReceiptTitle(receiptType)}</div>
        ${receiptInfo}
        ${itemsSection()}
        ${totalsSection()}
        ${paymentSection()}
        ${qrSection()}
        ${footerSection()}
        ${signatureSection()}
      </div>
    </body>
    </html>
  `;

  return receiptHTML;
}

/**
 * Get receipt title based on type
 */
function getReceiptTitle(receiptType) {
  switch (receiptType) {
    case RECEIPT_TYPES.GIFT:
      return 'GIFT RECEIPT';
    case RECEIPT_TYPES.KITCHEN:
      return 'KITCHEN ORDER';
    case RECEIPT_TYPES.REFUND:
      return 'REFUND RECEIPT';
    case RECEIPT_TYPES.REPRINT:
      return 'RECEIPT (REPRINTED)';
    case RECEIPT_TYPES.EMAIL:
      return 'EMAIL RECEIPT';
    default:
      return 'RECEIPT';
  }
}

/**
 * Generate receipt for email delivery (simplified HTML)
 */
export function generateEmailReceiptHTML(saleData, businessSettings = {}) {
  const business = getBusinessInfo(businessSettings);
  
  const emailStyles = `
    <style>
      .email-receipt {
        font-family: Arial, sans-serif;
        max-width: 600px;
        margin: 0 auto;
        padding: 20px;
        background: #f9f9f9;
        color: #333;
      }
      .receipt-content {
        background: white;
        padding: 30px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      }
      .business-header {
        text-align: center;
        border-bottom: 2px solid #008080;
        padding-bottom: 20px;
        margin-bottom: 30px;
      }
      .business-name {
        font-size: 24px;
        font-weight: bold;
        color: #008080;
        margin-bottom: 10px;
      }
      .item-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
      }
      .item-table th,
      .item-table td {
        padding: 10px;
        text-align: left;
        border-bottom: 1px solid #eee;
      }
      .item-table th {
        background: #f8f9fa;
        font-weight: bold;
      }
      .totals-table {
        width: 100%;
        margin-top: 20px;
      }
      .totals-table td {
        padding: 5px 0;
      }
      .total-final {
        font-size: 18px;
        font-weight: bold;
        border-top: 2px solid #008080;
        padding-top: 10px;
      }
    </style>
  `;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Your Receipt - ${saleData.sale_number}</title>
      ${emailStyles}
    </head>
    <body>
      <div class="email-receipt">
        <div class="receipt-content">
          <div class="business-header">
            <div class="business-name">${business.name}</div>
            <div>${business.address1}</div>
            <div>${business.address2}</div>
            <div>Phone: ${business.phone}</div>
            <div>Email: ${business.email}</div>
            <br>
            <div>Receipt #: ${saleData.sale_number}</div>
            <div>Date: ${new Date(saleData.created_at || Date.now()).toLocaleString()}</div>
          </div>
          
          <table class="item-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${saleData.items?.map(item => `
                <tr>
                  <td>${item.name}</td>
                  <td>${item.quantity}</td>
                  <td>$${Number(item.price).toFixed(2)}</td>
                  <td>$${(Number(item.price) * Number(item.quantity)).toFixed(2)}</td>
                </tr>
              `).join('') || '<tr><td colspan="4">No items</td></tr>'}
            </tbody>
          </table>
          
          <table class="totals-table">
            <tr>
              <td>Subtotal:</td>
              <td style="text-align: right;">$${(saleData.subtotal || 0).toFixed(2)}</td>
            </tr>
            <tr>
              <td>Tax:</td>
              <td style="text-align: right;">$${(saleData.tax_amount || 0).toFixed(2)}</td>
            </tr>
            <tr class="total-final">
              <td>Total:</td>
              <td style="text-align: right;">$${(saleData.final_total || saleData.total_amount || 0).toFixed(2)}</td>
            </tr>
          </table>
          
          <div style="margin-top: 30px; text-align: center; color: #666;">
            Thank you for your business!<br>
            ${business.website}<br>
            ${businessSettings.receipt_footer || ''}
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Print receipt helper
 */
export function printReceipt(receiptHTML) {
  const printWindow = window.open('', '_blank');
  printWindow.document.write(receiptHTML);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  printWindow.close();
}

/**
 * Generate QR code data for receipt lookup
 */
export function generateReceiptQRData(saleData) {
  return JSON.stringify({
    type: 'receipt_lookup',
    sale_id: saleData.sale_id,
    sale_number: saleData.sale_number,
    business_id: saleData.business_id,
    total: saleData.final_total || saleData.total_amount,
    created_at: saleData.created_at
  });
}