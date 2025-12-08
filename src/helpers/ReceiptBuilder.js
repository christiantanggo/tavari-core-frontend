// helpers/ReceiptBuilder.js - ENHANCED WITH PROPER GIFT RECEIPT FORMAT
export const RECEIPT_TYPES = {
  STANDARD: 'standard',
  GIFT: 'gift',
  KITCHEN: 'kitchen',
  EMAIL: 'email',
  REPRINT: 'reprint'
};

// Canadian cash rounding function
const roundToCashNickel = (amount) => {
  return Math.round(amount * 20) / 20; // Round to nearest 0.05
};

// Format currency with proper rounding
const formatCurrency = (amount, isCash = false) => {
  const roundedAmount = isCash ? roundToCashNickel(amount) : amount;
  return `$${roundedAmount.toFixed(2)}`;
};

export const generateReceiptHTML = (saleData, receiptType = RECEIPT_TYPES.STANDARD, businessSettings = {}, options = {}) => {
  const isKitchenReceipt = receiptType === RECEIPT_TYPES.KITCHEN;
  const isGiftReceipt = receiptType === RECEIPT_TYPES.GIFT;
  const isReprint = receiptType === RECEIPT_TYPES.REPRINT;

  // Business information with fallbacks
  const businessName = businessSettings.business_name || 'Your Business Name';
  const businessAddress = businessSettings.business_address || '123 Main St';
  const businessCity = businessSettings.business_city || 'Your City';
  const businessState = businessSettings.business_state || 'ON';
  const businessPostal = businessSettings.business_postal || 'N1A 1A1';
  const businessPhone = businessSettings.business_phone || '(555) 123-4567';
  const businessEmail = businessSettings.business_email || 'hello@yourbusiness.com';
  const taxNumber = businessSettings.tax_number || 'HST#123456789';

  // Sale data with fallbacks
  const saleNumber = saleData.sale_number || 'Unknown';
  const saleDate = new Date(saleData.created_at || Date.now()).toLocaleString('en-CA', {
    timeZone: businessSettings.timezone || 'America/Toronto',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const items = saleData.items || [];
  const subtotal = saleData.subtotal || 0;
  const finalTotal = saleData.final_total || 0;
  const payments = saleData.payments || [];
  const tipAmount = saleData.tip_amount || 0;
  const changeGiven = saleData.change_given || 0;
  const discountAmount = saleData.discount_amount || 0;
  const loyaltyRedemption = saleData.loyalty_redemption || 0;

  // Enhanced tax and rebate breakdown
  const taxBreakdown = saleData.taxBreakdown || [];
  const aggregatedTaxes = saleData.aggregated_taxes || {};
  const aggregatedRebates = saleData.aggregated_rebates || {};
  const finalTaxAmount = saleData.tax_amount || saleData.final_tax_amount || 0;

  // Use detailed breakdown if available, otherwise use aggregated data
  let taxes = [];
  let rebates = [];

  if (taxBreakdown && taxBreakdown.length > 0) {
    taxes = taxBreakdown.filter(item => item.type === 'tax');
    rebates = taxBreakdown.filter(item => item.type === 'rebate');
  } else {
    // Convert aggregated data to breakdown format
    taxes = Object.entries(aggregatedTaxes).map(([name, amount]) => ({ name, amount }));
    rebates = Object.entries(aggregatedRebates).map(([name, amount]) => ({ name, amount }));
  }

  // Customer information
  const customer = saleData.loyaltyCustomer;

  // GIFT RECEIPT - Special handling
  if (isGiftReceipt) {
    // Gift receipt shows only items without any pricing
    const giftItemsHTML = items.map(item => {
      let itemHTML = `
        <div class="gift-item">
          <div class="gift-item-name">${item.name}</div>
          <div class="gift-item-qty">Quantity: ${item.quantity || 1}</div>
          ${item.sku ? `<div class="gift-item-sku">SKU: ${item.sku}</div>` : ''}
      `;

      // Add modifiers without pricing
      if (item.modifiers && item.modifiers.length > 0) {
        item.modifiers.forEach(mod => {
          itemHTML += `<div class="gift-modifier">+ ${mod.name}</div>`;
        });
      }

      itemHTML += '</div>';
      return itemHTML;
    }).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Gift Receipt - ${saleNumber}</title>
        <style>
          ${getGiftReceiptStyles()}
        </style>
      </head>
      <body>
        <div class="gift-receipt-container">
          <!-- Business Header -->
          <div class="business-header">
            <h1>${businessName}</h1>
            <div class="business-address">
              ${businessAddress}<br>
              ${businessCity}, ${businessState} ${businessPostal}<br>
              ${businessPhone}<br>
              ${businessEmail}
            </div>
          </div>

          <!-- Gift Receipt Header -->
          <div class="gift-header">
            <h2>GIFT RECEIPT</h2>
            <div class="gift-info">
              <div>Receipt #${saleNumber}</div>
              <div>${saleDate}</div>
            </div>
          </div>

          <!-- Items Only -->
          <div class="gift-items-section">
            <div class="section-header">Items</div>
            ${giftItemsHTML}
          </div>

          <!-- Gift Receipt Footer -->
          <div class="gift-footer">
            <div class="gift-message">
              This gift receipt can be used for returns or exchanges.
            </div>
            <div class="gift-policy">
              Returns accepted within 30 days of purchase date.<br>
              Original receipt may be required for some returns.
            </div>
            <div class="gift-contact">
              Questions? Contact us at ${businessPhone}
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // Generate items HTML for standard receipts
  const itemsHTML = items.map(item => {
    const itemTotal = (item.price || 0) * (item.quantity || 1);
    let itemHTML = `
      <div class="receipt-item">
        <div class="item-line">
          <span class="item-name">${item.name}</span>
          <span class="item-total">${formatCurrency(itemTotal)}</span>
        </div>
        <div class="item-details">
          ${formatCurrency(item.price || 0)} × ${item.quantity || 1}
          ${item.sku ? ` (SKU: ${item.sku})` : ''}
        </div>
    `;

    // Add modifiers if present
    if (item.modifiers && item.modifiers.length > 0) {
      item.modifiers.forEach(mod => {
        itemHTML += `
          <div class="item-modifier">
            + ${mod.name} ${formatCurrency(mod.price)}
          </div>
        `;
      });
    }

    // Add item-level rebates if present
    if (item.rebateDetails && Object.keys(item.rebateDetails).length > 0) {
      Object.entries(item.rebateDetails).forEach(([rebateName, rebateData]) => {
        itemHTML += `
          <div class="item-rebate">
            🎯 ${rebateName}: -${formatCurrency(rebateData.amount)}
          </div>
        `;
      });
    }

    // If this is a table share item, show the original table items indented
    // Use the same styling as item-details (price details)
    if (item.isTableShare && item.originalTableItems && Array.isArray(item.originalTableItems)) {
      item.originalTableItems.forEach(tableItem => {
        const tableItemTotal = (tableItem.price || 0) * (tableItem.quantity || 1);
        itemHTML += `
          <div class="item-details" style="margin-left: 20px; padding-left: 10px;">
            ${tableItem.quantity || 1}x ${tableItem.name}
            ${formatCurrency(tableItem.price || 0)} × ${tableItem.quantity || 1} = ${formatCurrency(tableItemTotal)}
          </div>
        `;
      });
    }

    itemHTML += '</div>';
    return itemHTML;
  }).join('');

  // Generate tax breakdown HTML
  const taxBreakdownHTML = taxes.length > 0 ? `
    <div class="tax-section">
      <div class="section-header">Taxes Applied</div>
      ${taxes.map(tax => `
        <div class="tax-line">
          <span>${tax.name}${tax.rate ? ` (${(tax.rate * 100).toFixed(2)}%)` : ''}</span>
          <span>${formatCurrency(tax.amount)}</span>
        </div>
      `).join('')}
    </div>
  ` : '';

  // Generate rebate breakdown HTML
  const rebateBreakdownHTML = rebates.length > 0 ? `
    <div class="rebate-section">
      <div class="section-header">Rebates Applied</div>
      ${rebates.map(rebate => `
        <div class="rebate-line">
          <span>${rebate.name}${rebate.rate ? ` (${(rebate.rate * 100).toFixed(2)}%)` : ''}</span>
          <span>-${formatCurrency(rebate.amount)}</span>
        </div>
      `).join('')}
    </div>
  ` : '';

  // Generate payment methods HTML with cash rounding
  const paymentsHTML = payments.map(payment => {
    const isCashPayment = (payment.method || payment.payment_method) === 'cash';
    const originalAmount = payment.amount;
    const displayAmount = isCashPayment ? roundToCashNickel(originalAmount) : originalAmount;
    const cashRoundingAdjustment = isCashPayment ? displayAmount - originalAmount : 0;
    
    let paymentHTML = `
      <div class="payment-line">
        <span>${payment.custom_method_name || payment.method || payment.payment_method}</span>
        <span>${formatCurrency(displayAmount)}</span>
      </div>
    `;

    // Show cash rounding adjustment if applicable
    if (isCashPayment && Math.abs(cashRoundingAdjustment) >= 0.01) {
      paymentHTML += `
        <div class="cash-rounding-line">
          <span>Cash Rounding Adjustment</span>
          <span>${cashRoundingAdjustment >= 0 ? '+' : ''}${formatCurrency(Math.abs(cashRoundingAdjustment))}</span>
        </div>
      `;
    }

    return paymentHTML;
  }).join('');

  // Add loyalty redemption to payments if used
  const loyaltyPaymentHTML = loyaltyRedemption > 0 ? `
    <div class="payment-line">
      <span>${businessSettings.loyalty_mode === 'points' ? 'Loyalty Points' : 'Loyalty Credit'}</span>
      <span>${businessSettings.loyalty_mode === 'points' 
        ? `-${Math.round(loyaltyRedemption * 1000).toLocaleString()} pts`
        : `-${formatCurrency(loyaltyRedemption)}`
      }</span>
    </div>
  ` : '';

  // Change given with cash rounding
  const changeHTML = changeGiven > 0 ? `
    <div class="change-line">
      <span>Change Given</span>
      <span>${formatCurrency(changeGiven, true)}</span>
    </div>
  ` : '';

  // Customer loyalty info
  const loyaltyInfoHTML = customer ? `
    <div class="loyalty-section">
      <div class="section-header">Customer: ${customer.customer_name}</div>
      ${customer.customer_email ? `<div class="customer-detail">📧 ${customer.customer_email}</div>` : ''}
      ${customer.customer_phone ? `<div class="customer-detail">📞 ${customer.customer_phone}</div>` : ''}
      <div class="loyalty-earned">
        ${businessSettings.loyalty_mode === 'points' 
          ? `🏆 Points Earned: ${Math.round((subtotal * (businessSettings.earn_rate_percentage || 3) / 100) * 1000).toLocaleString()}`
          : `💰 Earned: ${formatCurrency(subtotal * (businessSettings.earn_rate_percentage || 3) / 100)}`
        }
      </div>
      <div class="loyalty-balance">
        ${businessSettings.loyalty_mode === 'points' 
          ? `💳 Balance: ${Math.round((customer.balance || 0) * 1000).toLocaleString()} points`
          : `💳 Balance: ${formatCurrency(customer.balance || 0)}`
        }
      </div>
    </div>
  ` : '';

  // Kitchen receipt has different content
  if (isKitchenReceipt) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Kitchen Receipt - ${saleNumber}</title>
        <style>
          ${getReceiptStyles(true)}
        </style>
      </head>
      <body>
        <div class="receipt-container">
          <div class="kitchen-header">
            <h1>🍽️ KITCHEN ORDER</h1>
            <div class="order-info">
              <div>Order #${saleNumber}</div>
              <div>${saleDate}</div>
              ${customer ? `<div>Customer: ${customer.customer_name}</div>` : ''}
            </div>
          </div>
          
          <div class="kitchen-items">
            ${items.filter(item => item.station_id || !item.station_id).map(item => `
              <div class="kitchen-item">
                <div class="item-qty-name">
                  <span class="quantity">${item.quantity || 1}×</span>
                  <span class="name">${item.name}</span>
                </div>
                ${item.modifiers && item.modifiers.length > 0 ? `
                  <div class="modifiers">
                    ${item.modifiers.map(mod => `<div>+ ${mod.name}</div>`).join('')}
                  </div>
                ` : ''}
                ${item.notes ? `<div class="item-notes">NOTE: ${item.notes}</div>` : ''}
              </div>
            `).join('')}
          </div>

          <div class="kitchen-footer">
            <div>Items: ${items.reduce((sum, item) => sum + (item.quantity || 1), 0)}</div>
            <div>Printed: ${new Date().toLocaleString('en-CA')}</div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // Standard receipt HTML
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${isReprint ? 'REPRINT - ' : ''}Receipt - ${saleNumber}</title>
      <style>
        ${getReceiptStyles()}
      </style>
    </head>
    <body>
      <div class="receipt-container">
        <!-- Business Header -->
        <div class="business-header">
          <h1>${businessName}</h1>
          <div class="business-address">
            ${businessAddress}<br>
            ${businessCity}, ${businessState} ${businessPostal}<br>
            📞 ${businessPhone}<br>
            📧 ${businessEmail}
          </div>
          ${taxNumber ? `<div class="tax-number">${taxNumber}</div>` : ''}
        </div>

        <!-- Sale Information -->
        <div class="sale-info">
          ${isReprint ? '<div class="reprint-notice">*** REPRINT ***</div>' : ''}
          <div class="sale-details">
            <div>Receipt #${saleNumber}</div>
            <div>${saleDate}</div>
            ${options.reprintReason ? `<div>Reason: ${options.reprintReason}</div>` : ''}
          </div>
        </div>

        <!-- Items Section -->
        <div class="items-section">
          <div class="section-header">Items Purchased</div>
          ${itemsHTML}
        </div>

        <!-- Financial Breakdown -->
        <div class="financial-section">
          <!-- Subtotal -->
          <div class="total-line subtotal-line">
            <span>Subtotal</span>
            <span>${formatCurrency(subtotal)}</span>
          </div>

          <!-- Discounts -->
          ${discountAmount > 0 ? `
            <div class="total-line discount-line">
              <span>Discount</span>
              <span>-${formatCurrency(discountAmount)}</span>
            </div>
          ` : ''}

          <!-- Loyalty Redemption -->
          ${loyaltyRedemption > 0 ? `
            <div class="total-line loyalty-line">
              <span>Loyalty Credit</span>
              <span>-${formatCurrency(loyaltyRedemption)}</span>
            </div>
          ` : ''}

          <!-- Tax Breakdown -->
          ${taxBreakdownHTML}

          <!-- Rebate Breakdown -->
          ${rebateBreakdownHTML}

          <!-- Net Tax Total -->
          <div class="total-line tax-total-line">
            <span>Total Tax</span>
            <span>${formatCurrency(finalTaxAmount)}</span>
          </div>

          <!-- Tip -->
          ${tipAmount > 0 ? `
            <div class="total-line">
              <span>Tip</span>
              <span>${formatCurrency(tipAmount)}</span>
            </div>
          ` : ''}

          <!-- Final Total -->
          <div class="total-line final-total-line">
            <span>TOTAL</span>
            <span>${formatCurrency(finalTotal)}</span>
          </div>
        </div>

        <!-- Payment Methods -->
        <div class="payment-section">
          <div class="section-header">Payment Methods</div>
          ${paymentsHTML}
          ${loyaltyPaymentHTML}
          ${changeHTML}
        </div>

        <!-- Customer Information -->
        ${loyaltyInfoHTML}

        <!-- Footer -->
        <div class="receipt-footer">
          <div class="thank-you">Thank you for your business!</div>
          <div class="return-policy">
            Returns accepted within 30 days with receipt.
          </div>
          <div class="qr-section">
            <div>Scan for digital receipt:</div>
            <div class="qr-placeholder">[QR Code: ${saleNumber}]</div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
};

export const generateEmailReceiptHTML = (saleData, businessSettings = {}) => {
  // Use the standard receipt generator with email styling
  const standardHTML = generateReceiptHTML(saleData, RECEIPT_TYPES.EMAIL, businessSettings);
  
  // Add email-specific wrapper and styling
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Your Receipt from ${businessSettings.business_name || 'Business'}</title>
      <style>
        body { 
          font-family: Arial, sans-serif; 
          margin: 0; 
          padding: 20px; 
          background-color: #f5f5f5; 
        }
        .email-wrapper { 
          max-width: 600px; 
          margin: 0 auto; 
          background: white; 
          border-radius: 8px; 
          overflow: hidden; 
          box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
        }
        .email-header { 
          background: #008080; 
          color: white; 
          padding: 20px; 
          text-align: center; 
        }
        .email-content { 
          padding: 20px; 
        }
        ${getReceiptStyles()}
      </style>
    </head>
    <body>
      <div class="email-wrapper">
        <div class="email-header">
          <h1>📧 Digital Receipt</h1>
          <p>Thank you for your purchase!</p>
        </div>
        <div class="email-content">
          ${standardHTML.replace(/.*<body[^>]*>|<\/body>.*/g, '').replace(/<div class="receipt-container">|<\/div>$/g, '')}
        </div>
      </div>
    </body>
    </html>
  `;
};

export const printReceipt = (receiptHTML) => {
  const printWindow = window.open('', '_blank', 'width=400,height=600');
  if (printWindow) {
    printWindow.document.write(receiptHTML);
    printWindow.document.close();
    printWindow.focus();
    
    // Auto-print after a short delay
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 500);
  } else {
    alert('Please allow popups to print receipts');
  }
};

// Gift receipt specific styles
const getGiftReceiptStyles = () => {
  return `
    body {
      font-family: 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.4;
      margin: 0;
      padding: 10px;
      background: white;
      color: #000;
    }
    .gift-receipt-container {
      max-width: 350px;
      margin: 0 auto;
    }
    .business-header {
      text-align: center;
      margin-bottom: 20px;
      border-bottom: 2px solid #000;
      padding-bottom: 10px;
    }
    .business-header h1 {
      margin: 0 0 10px 0;
      font-size: 16px;
      font-weight: bold;
    }
    .business-address {
      font-size: 11px;
      line-height: 1.3;
    }
    .gift-header {
      text-align: center;
      margin-bottom: 20px;
      border: 2px solid #000;
      padding: 10px;
    }
    .gift-header h2 {
      margin: 0 0 10px 0;
      font-size: 18px;
      font-weight: bold;
      letter-spacing: 2px;
    }
    .gift-info {
      font-size: 11px;
    }
    .section-header {
      font-weight: bold;
      text-align: center;
      margin: 15px 0 10px 0;
      padding: 5px 0;
      border-top: 1px solid #000;
      border-bottom: 1px solid #000;
    }
    .gift-items-section {
      margin: 20px 0;
    }
    .gift-item {
      margin-bottom: 15px;
      padding-bottom: 10px;
      border-bottom: 1px dashed #ccc;
    }
    .gift-item-name {
      font-weight: bold;
      font-size: 14px;
      margin-bottom: 5px;
    }
    .gift-item-qty {
      font-size: 11px;
      margin-bottom: 3px;
    }
    .gift-item-sku {
      font-size: 10px;
      color: #666;
      font-style: italic;
    }
    .gift-modifier {
      font-size: 10px;
      margin-left: 15px;
      font-style: italic;
      color: #555;
    }
    .gift-footer {
      margin-top: 30px;
      border-top: 2px solid #000;
      padding-top: 15px;
      text-align: center;
    }
    .gift-message {
      font-weight: bold;
      font-size: 14px;
      margin-bottom: 15px;
    }
    .gift-policy {
      font-size: 11px;
      line-height: 1.4;
      margin-bottom: 15px;
      padding: 10px;
      border: 1px dashed #000;
      background: #f9f9f9;
    }
    .gift-contact {
      font-size: 10px;
      font-style: italic;
    }
    @media print {
      body { 
        margin: 0; 
        padding: 5px; 
      }
      .gift-receipt-container { 
        max-width: none; 
      }
    }
  `;
};

// Receipt styles for standard and kitchen receipts
const getReceiptStyles = (isKitchen = false) => {
  if (isKitchen) {
    return `
      body {
        font-family: 'Courier New', monospace;
        font-size: 14px;
        line-height: 1.3;
        margin: 0;
        padding: 10px;
        background: white;
      }
      .receipt-container {
        max-width: 400px;
        margin: 0 auto;
      }
      .kitchen-header {
        text-align: center;
        border-bottom: 2px solid #000;
        padding-bottom: 10px;
        margin-bottom: 15px;
      }
      .kitchen-header h1 {
        margin: 0;
        font-size: 18px;
        font-weight: bold;
      }
      .order-info {
        margin-top: 10px;
        font-weight: bold;
      }
      .kitchen-items {
        margin: 15px 0;
      }
      .kitchen-item {
        margin-bottom: 15px;
        padding-bottom: 10px;
        border-bottom: 1px dashed #ccc;
      }
      .item-qty-name {
        font-weight: bold;
        font-size: 16px;
      }
      .quantity {
        font-size: 18px;
        margin-right: 10px;
      }
      .modifiers {
        margin-left: 20px;
        font-style: italic;
      }
      .item-notes {
        margin-top: 5px;
        padding: 5px;
        background: #f0f0f0;
        border: 1px solid #ddd;
        font-weight: bold;
      }
      .kitchen-footer {
        text-align: center;
        margin-top: 20px;
        border-top: 2px solid #000;
        padding-top: 10px;
      }
    `;
  }

  return `
    body {
      font-family: 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.4;
      margin: 0;
      padding: 10px;
      background: white;
      color: #000;
    }
    .receipt-container {
      max-width: 350px;
      margin: 0 auto;
    }
    .business-header {
      text-align: center;
      margin-bottom: 20px;
      border-bottom: 2px solid #000;
      padding-bottom: 10px;
    }
    .business-header h1 {
      margin: 0 0 10px 0;
      font-size: 16px;
      font-weight: bold;
    }
    .business-address {
      font-size: 11px;
      line-height: 1.3;
    }
    .tax-number {
      font-size: 10px;
      margin-top: 5px;
      font-style: italic;
    }
    .sale-info {
      text-align: center;
      margin-bottom: 15px;
    }
    .reprint-notice {
      font-weight: bold;
      font-size: 14px;
      margin-bottom: 5px;
    }
    .sale-details {
      font-size: 11px;
    }
    .section-header {
      font-weight: bold;
      text-align: center;
      margin: 15px 0 10px 0;
      padding: 5px 0;
      border-top: 1px solid #000;
      border-bottom: 1px solid #000;
    }
    .receipt-item {
      margin-bottom: 10px;
    }
    .item-line {
      display: flex;
      justify-content: space-between;
      font-weight: bold;
    }
    .item-details {
      font-size: 10px;
      color: #666;
      margin-top: 2px;
    }
    .item-modifier {
      font-size: 10px;
      margin-left: 15px;
      font-style: italic;
    }
    .item-rebate {
      font-size: 10px;
      margin-left: 15px;
      color: #008000;
      font-weight: bold;
    }
    .financial-section {
      margin: 15px 0;
      border-top: 1px solid #000;
      padding-top: 10px;
    }
    .total-line {
      display: flex;
      justify-content: space-between;
      margin: 3px 0;
    }
    .subtotal-line {
      font-weight: bold;
    }
    .discount-line {
      color: #d00;
    }
    .loyalty-line {
      color: #008000;
      font-weight: bold;
    }
    .tax-total-line {
      font-weight: bold;
      border-top: 1px dashed #000;
      padding-top: 3px;
    }
    .final-total-line {
      font-weight: bold;
      font-size: 14px;
      border-top: 2px solid #000;
      border-bottom: 2px solid #000;
      padding: 5px 0;
      margin: 10px 0;
    }
    .tax-section, .rebate-section {
      margin: 10px 0;
      padding: 5px 0;
      border: 1px dashed #ccc;
      background: #f9f9f9;
    }
    .tax-line, .rebate-line {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      margin: 2px 0;
      padding: 0 5px;
    }
    .rebate-line {
      color: #008000;
    }
    .payment-section {
      margin: 15px 0;
    }
    .payment-line {
      display: flex;
      justify-content: space-between;
      margin: 3px 0;
    }
    .cash-rounding-line {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      font-style: italic;
      color: #666;
      margin-left: 15px;
    }
    .change-line {
      display: flex;
      justify-content: space-between;
      font-weight: bold;
      color: #008000;
      border-top: 1px dashed #000;
      padding-top: 3px;
      margin-top: 5px;
    }
    .loyalty-section {
      margin: 15px 0;
      padding: 10px;
      border: 1px solid #008080;
      background: #f0f8f8;
    }
    .customer-detail {
      font-size: 10px;
      margin: 2px 0;
    }
    .loyalty-earned, .loyalty-balance {
      font-size: 10px;
      font-weight: bold;
      margin: 3px 0;
    }
    .receipt-footer {
      text-align: center;
      margin-top: 20px;
      border-top: 2px solid #000;
      padding-top: 10px;
    }
    .thank-you {
      font-weight: bold;
      margin-bottom: 10px;
    }
    .return-policy {
      font-size: 10px;
      margin: 5px 0;
    }
    .qr-section {
      margin-top: 15px;
      font-size: 10px;
    }
    .qr-placeholder {
      margin-top: 5px;
      padding: 10px;
      border: 1px solid #000;
      font-family: monospace;
    }
    @media print {
      body { 
        margin: 0; 
        padding: 5px; 
      }
      .receipt-container { 
        max-width: none; 
      }
    }
  `;
};

export default {
  generateReceiptHTML,
  generateEmailReceiptHTML,
  printReceipt,
  RECEIPT_TYPES
};