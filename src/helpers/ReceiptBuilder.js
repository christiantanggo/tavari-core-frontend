// helpers/ReceiptBuilder.js - ENHANCED WITH PROPER GIFT RECEIPT FORMAT
import QRCode from 'qrcode';
import { getDeviceReceiptPrinterConfig } from '../services/posRegisterStationsService';
import { formatPosModifierLabel } from '../utils/posModifierDisplay';
import {
  buildEscPosDrawerSlipBytes,
  buildEscPosReceiptBytes,
  sendEscPosToPrintAgent,
} from './escposReceipt';

export const RECEIPT_TYPES = {
  STANDARD: 'standard',
  GIFT: 'gift',
  KITCHEN: 'kitchen',
  REFUND: 'refund',
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

const escapeReceiptText = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const formatPaymentMethodLabel = (raw) => {
  const v = String(raw || '').trim();
  if (!v) return 'Payment';
  if (v.toLowerCase() === 'helcim_terminal') return 'Helcim Terminal';
  if (v.toLowerCase() === 'credit_card') return 'Credit Card';
  return v
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
};

const tryParseJson = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
};

const extractHelcimTransactionId = (saleData, payments) => {
  if (saleData?.helcim_transaction_id) return String(saleData.helcim_transaction_id);
  if (saleData?.helcim_id) return String(saleData.helcim_id);

  const helcimPayment = (payments || []).find((p) => {
    const method = p?.payment_method || p?.method || p?.paymentMethod;
    return String(method || '').toLowerCase() === 'helcim_terminal';
  });

  const fromPayment = helcimPayment?.reference_number ||
    helcimPayment?.transaction_id ||
    helcimPayment?.transactionId;

  if (fromPayment) return String(fromPayment);

  // If the payment row stores details in JSON notes, try that too.
  const paymentNotesObj = tryParseJson(helcimPayment?.notes);
  const fromPaymentNotes = paymentNotesObj?.helcim?.transactionId || paymentNotesObj?.transactionId;
  if (fromPaymentNotes) return String(fromPaymentNotes);

  const notes = saleData?.notes || saleData?.sale_notes || '';
  const match = String(notes).match(/transaction id:\s*([0-9]+)/i) || String(notes).match(/\bH-ID:\s*([0-9]+)/i);
  return match?.[1] ? match[1] : null;
};

const buildReceiptQrDataUrl = async (receiptNumber) => {
  try {
    if (!receiptNumber) return null;
    return await QRCode.toDataURL(String(receiptNumber), {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 180,
    });
  } catch (e) {
    console.warn('[ReceiptBuilder] Failed to generate QR code:', e?.message || e);
    return null;
  }
};

export const generateReceiptHTML = async (saleData, receiptType = RECEIPT_TYPES.STANDARD, businessSettings = {}, options = {}) => {
  const isKitchenReceipt = receiptType === RECEIPT_TYPES.KITCHEN;
  const isGiftReceipt = receiptType === RECEIPT_TYPES.GIFT;
  const isReprint = receiptType === RECEIPT_TYPES.REPRINT;
  const isRefund = receiptType === RECEIPT_TYPES.REFUND;

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
  const normalizedPayments = (payments || []).map((p) => {
    if (typeof p === 'string') {
      return { payment_method: p, method: p, amount: 0 };
    }
    return p;
  });
  const tipAmount = saleData.tip_amount || 0;
  const changeGiven = saleData.change_given || 0;
  const discountAmount = saleData.discount_amount || 0;
  const loyaltyRedemption = saleData.loyalty_redemption || 0;
  const operatorUserName = saleData.operator_user_name || saleData.cashier_name || saleData.employee_name || null;
  const loginUserName = saleData.login_user_name || null;
  const showLoginUser = !!loginUserName;

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
          itemHTML += `<div class="gift-modifier">+ ${formatPosModifierLabel(mod)}</div>`;
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

  // For standard/reprint/email/refund receipts, include H-ID + receipt number + scannable QR (receipt number only)
  const helcimTransactionId = extractHelcimTransactionId(saleData, normalizedPayments);
  const qrDataUrl = isKitchenReceipt ? null : await buildReceiptQrDataUrl(saleNumber);

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
            + ${formatPosModifierLabel(mod)} ${formatCurrency(mod.price)}
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

  const indianCert = (saleData.indian_status_certificate_number || '').trim();
  const indianStatusBannerHTML =
    saleData.indian_status_gst_only && indianCert
      ? `
    <div class="indian-status-banner" style="margin: 10px 0; padding: 8px; border: 1px dashed #333; font-size: 12px; text-align: center;">
      <div><strong>Indian Status (GST only)</strong></div>
      <div>Status #: ${escapeReceiptText(indianCert)}</div>
    </div>
  `
      : '';

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
  const paymentsHTML = normalizedPayments.map(payment => {
    const isCashPayment = (payment.method || payment.payment_method) === 'cash';
    const originalAmount = typeof payment.amount === 'number' ? payment.amount : Number(payment.amount || 0);
    const displayAmount = isCashPayment ? roundToCashNickel(originalAmount) : originalAmount;
    const cashRoundingAdjustment = isCashPayment ? displayAmount - originalAmount : 0;
    const label = formatPaymentMethodLabel(payment.custom_method_name || payment.method || payment.payment_method);
    
    let paymentHTML = `
      <div class="payment-line">
        <span>${label}</span>
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
            ${items.filter(item => item.station_id || !item.station_id).map(item => {
              const qty = Math.max(1, Number(item.quantity) || 1);
              const name = item.name || 'Item';
              const modsHtml = item.modifiers && item.modifiers.length > 0 ? `
                  <div class="modifiers">
                    ${item.modifiers.map(mod => `<div>+ ${formatPosModifierLabel(mod)}</div>`).join('')}
                  </div>
                ` : '';
              const notesHtml = item.notes ? `<div class="item-notes">NOTE: ${item.notes}</div>` : '';
              return Array.from({ length: qty }, () => `
              <div class="kitchen-item">
                <div class="item-qty-name">
                  <span class="name">${name}</span>
                </div>
                ${modsHtml}
                ${notesHtml}
              </div>
            `).join('');
            }).join('')}
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
            ${operatorUserName ? `<div>Cashier: ${escapeReceiptText(operatorUserName)}</div>` : ''}
            ${showLoginUser ? `<div>Logged in by: ${escapeReceiptText(loginUserName)}</div>` : ''}
            ${options.reprintReason ? `<div>Reason: ${options.reprintReason}</div>` : ''}
          </div>
        </div>

        ${indianStatusBannerHTML}

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
          <div class="id-section">
            ${helcimTransactionId ? `<div class="id-line">H-ID: ${helcimTransactionId}</div>` : ''}
            <div class="id-line">Receipt #: ${saleNumber}</div>
          </div>

          ${!isKitchenReceipt ? `
            <div class="qr-section">
              ${qrDataUrl
                ? `<img class="qr-image" src="${qrDataUrl}" alt="Receipt QR code" />`
                : `<div class="qr-fallback">QR unavailable</div>`
              }
            </div>
          ` : ''}

          <div class="thank-you">${isRefund ? 'Refund processed. Thank you.' : 'Thank you for your business!'}</div>

          ${isRefund && options.signatureCopy ? `
          <div class="signature-copy" style="margin-top: 24px; text-align: left;">
            <div style="font-weight: bold; margin-bottom: 12px;">SIGNATURE COPY</div>
            <div style="margin-bottom: 8px;">Customer signature:</div>
            <div style="border-bottom: 1px solid #000; height: 28px; margin-bottom: 16px;"></div>
            <div style="margin-bottom: 8px;">Employee signature:</div>
            <div style="border-bottom: 1px solid #000; height: 28px; margin-bottom: 16px;"></div>
            <div>Date: _______________</div>
          </div>
          ` : ''}
        </div>
      </div>
    </body>
    </html>
  `;
};

export const generateEmailReceiptHTML = async (saleData, businessSettings = {}) => {
  // Use the standard receipt generator with email styling
  const standardHTML = await generateReceiptHTML(saleData, RECEIPT_TYPES.EMAIL, businessSettings);
  
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

export const generateDrawerOpenReceiptHTML = (drawerData = {}, businessSettings = {}) => {
  const businessName = businessSettings.business_name || businessSettings.name || 'Tavari POS';
  const businessAddress = businessSettings.business_address || businessSettings.address || '';
  const businessCity = businessSettings.business_city || businessSettings.city || '';
  const businessState = businessSettings.business_state || businessSettings.province || '';
  const businessPostal = businessSettings.business_postal || businessSettings.postal_code || '';
  const businessPhone = businessSettings.business_phone || businessSettings.phone || '';
  const timeZone = businessSettings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto';

  const openedAt = new Date(drawerData.opened_at || Date.now());
  const openedDate = openedAt.toLocaleDateString('en-CA', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
  const openedTime = openedAt.toLocaleTimeString('en-CA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const reason = drawerData.reason || drawerData.open_reason || 'No reason provided';
  const notes = drawerData.notes || drawerData.open_notes || '';
  const terminalId = drawerData.terminal_id || drawerData.register_id || 'Unknown';
  const loginUserName = drawerData.login_user_name || 'Unknown';
  const operatorUserName = drawerData.operator_user_name || drawerData.opened_by_name || 'Unknown';
  const managerApprovedByName = drawerData.manager_approved_by_name || '';
  const locationLine = [businessCity, businessState, businessPostal].filter(Boolean).join(', ').replace(',  ', ' ');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Drawer Opened - ${escapeReceiptText(terminalId)}</title>
      <style>
        ${getDrawerOpenReceiptStyles()}
      </style>
    </head>
    <body>
      <div class="drawer-slip">
        <div class="drawer-slip__header">
          <h1>${escapeReceiptText(businessName)}</h1>
          ${businessAddress ? `<div>${escapeReceiptText(businessAddress)}</div>` : ''}
          ${locationLine ? `<div>${escapeReceiptText(locationLine)}</div>` : ''}
          ${businessPhone ? `<div>${escapeReceiptText(businessPhone)}</div>` : ''}
        </div>

        <div class="drawer-slip__title">TILL OPENED</div>

        <div class="drawer-slip__section">
          <div class="drawer-slip__row"><span>Date</span><span>${escapeReceiptText(openedDate)}</span></div>
          <div class="drawer-slip__row"><span>Time</span><span>${escapeReceiptText(openedTime)}</span></div>
          <div class="drawer-slip__row"><span>Timezone</span><span>${escapeReceiptText(timeZone)}</span></div>
          <div class="drawer-slip__row"><span>Register</span><span>${escapeReceiptText(terminalId)}</span></div>
        </div>

        <div class="drawer-slip__section">
          <div class="drawer-slip__label">Logged Into App</div>
          <div class="drawer-slip__value">${escapeReceiptText(loginUserName)}</div>
          <div class="drawer-slip__label">Unlocked Register</div>
          <div class="drawer-slip__value">${escapeReceiptText(operatorUserName)}</div>
          ${managerApprovedByName ? `
            <div class="drawer-slip__label">Manager Approval</div>
            <div class="drawer-slip__value">${escapeReceiptText(managerApprovedByName)}</div>
          ` : ''}
        </div>

        <div class="drawer-slip__section">
          <div class="drawer-slip__label">Reason</div>
          <div class="drawer-slip__value drawer-slip__value--boxed">${escapeReceiptText(reason)}</div>
          ${notes ? `
            <div class="drawer-slip__label">Notes</div>
            <div class="drawer-slip__value drawer-slip__value--boxed">${escapeReceiptText(notes)}</div>
          ` : ''}
        </div>

        <div class="drawer-slip__footer">
          Manager review slip
        </div>
      </div>
    </body>
    </html>
  `;
};

const printReceiptViaBrowser = (receiptHTML) => {
  const printWindow = window.open('', '_blank', 'width=420,height=200');
  if (printWindow) {
    printWindow.document.write(receiptHTML);
    printWindow.document.close();
    printWindow.focus();

    const finalizePrint = () => {
      try {
        const receiptEl = printWindow.document.querySelector('.receipt-container, .gift-receipt-container, .drawer-slip');
        const contentHeight = Math.ceil(
          Math.max(
            receiptEl?.scrollHeight || 0,
            printWindow.document.body?.scrollHeight || 0,
            printWindow.document.documentElement?.scrollHeight || 0
          )
        );
        const targetHeight = Math.max(200, contentHeight + 32);
        printWindow.resizeTo(420, targetHeight);
      } catch (resizeError) {
        console.warn('[ReceiptBuilder] Unable to resize print window:', resizeError);
      }

      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 150);
    };

    const images = Array.from(printWindow.document.images || []);
    if (images.length === 0) {
      setTimeout(finalizePrint, 250);
    } else {
      let loaded = 0;
      const markLoaded = () => {
        loaded += 1;
        if (loaded >= images.length) {
          finalizePrint();
        }
      };

      images.forEach((img) => {
        if (img.complete) {
          markLoaded();
        } else {
          img.addEventListener('load', markLoaded, { once: true });
          img.addEventListener('error', markLoaded, { once: true });
        }
      });
    }
    return true;
  }

  alert('Please allow popups to print receipts');
  return false;
};

/**
 * Print a receipt. Uses ESC/POS network printer via local print agent when
 * the active register station has a printer configured; otherwise browser print.
 *
 * @param {string} receiptHTML - HTML fallback for browser printing
 * @param {object} [options]
 * @param {object} [options.saleData]
 * @param {string} [options.receiptType]
 * @param {object} [options.businessSettings]
 * @param {object} [options.drawerData] - when set, prints a drawer-open slip
 * @param {object} [options.escposOptions]
 * @param {boolean} [options.forceBrowser] - skip network printer
 */
export const printReceipt = async (receiptHTML, options = {}) => {
  const {
    saleData = null,
    receiptType = RECEIPT_TYPES.STANDARD,
    businessSettings = {},
    drawerData = null,
    escposOptions = {},
    forceBrowser = false,
  } = options;

  const printer = !forceBrowser ? getDeviceReceiptPrinterConfig() : null;
  const isRefund = receiptType === RECEIPT_TYPES.REFUND && !drawerData;

  if (printer) {
    try {
      const bytes = drawerData
        ? buildEscPosDrawerSlipBytes(drawerData, businessSettings)
        : buildEscPosReceiptBytes(saleData || {}, receiptType, businessSettings, escposOptions);

      await sendEscPosToPrintAgent(bytes, { host: printer.ip, port: printer.port });

      // Refund: customer copy first, then a signature copy for customer + employee
      if (isRefund) {
        const signatureBytes = buildEscPosReceiptBytes(
          saleData || {},
          receiptType,
          businessSettings,
          { ...escposOptions, signatureCopy: true }
        );
        await sendEscPosToPrintAgent(signatureBytes, { host: printer.ip, port: printer.port });
      }

      return true;
    } catch (networkPrintError) {
      const detail = networkPrintError?.message || String(networkPrintError);
      console.error('[ReceiptBuilder] Network ESC/POS print failed:', detail);
      if (!options.silent) {
        alert(
          `Could not print to the receipt printer (${printer.ip}:${printer.port}).\n\n${detail}`
        );
      }
      return false;
    }
  }

  const firstOk = printReceiptViaBrowser(receiptHTML);
  if (isRefund && saleData) {
    try {
      const signatureHtml = await generateReceiptHTML(
        saleData,
        RECEIPT_TYPES.REFUND,
        businessSettings,
        { ...escposOptions, signatureCopy: true }
      );
      printReceiptViaBrowser(signatureHtml);
    } catch (err) {
      console.error('[ReceiptBuilder] Refund signature copy (browser) failed:', err);
    }
  }
  return firstOk;
};

// Gift receipt specific styles
const getGiftReceiptStyles = () => {
  return `
    html, body {
      width: fit-content;
      height: auto !important;
      min-height: 0 !important;
    }
    body {
      font-family: 'Courier New', monospace;
      font-size: 16px;
      line-height: 1.45;
      margin: 0;
      padding: 8px;
      background: white;
      color: #000;
      display: inline-block;
      overflow: hidden;
    }
    .gift-receipt-container {
      max-width: 58mm;
      width: 58mm;
      margin: 0;
      display: block;
      box-sizing: border-box;
    }
    .business-header {
      text-align: left;
      margin-bottom: 16px;
      border-bottom: 2px solid #000;
      padding-bottom: 8px;
    }
    .business-header h1 {
      margin: 0 0 10px 0;
      font-size: 11px;
      font-weight: bold;
      max-width: 100%;
      overflow-wrap: anywhere;
      word-break: break-word;
      white-space: normal;
    }
    .business-address {
      font-size: 18px;
      line-height: 1.4;
    }
    .gift-header {
      text-align: center;
      margin-bottom: 16px;
      border: 2px solid #000;
      padding: 8px;
    }
    .gift-header h2 {
      margin: 0 0 10px 0;
      font-size: 11px;
      font-weight: bold;
      letter-spacing: 2px;
    }
    .gift-info {
      font-size: 14px;
    }
    .section-header {
      font-weight: bold;
      text-align: left;
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
      font-size: 11px;
      margin-bottom: 5px;
    }
    .gift-item-qty {
      font-size: 10px;
      margin-bottom: 3px;
    }
    .gift-item-sku {
      font-size: 10px;
      color: #666;
      font-style: italic;
    }
    .gift-modifier {
      font-size: 14px;
      margin-left: 15px;
      font-style: italic;
      color: #555;
    }
    .gift-footer {
      margin-top: 18px;
      border-top: 2px solid #000;
      padding-top: 8px;
      text-align: center;
    }
    .gift-message {
      font-weight: bold;
      font-size: 11px;
      margin-bottom: 15px;
    }
    .gift-policy {
      font-size: 10px;
      line-height: 1.4;
      margin-bottom: 15px;
      padding: 8px;
      border: 1px dashed #000;
      background: #f9f9f9;
    }
    .gift-contact {
      font-size: 14px;
      font-style: italic;
    }
    @page {
      size: auto;
      margin: 0.5in;
    }
    @media print {
      html, body {
        width: 100%;
        height: auto !important;
        min-height: 0 !important;
        overflow: visible;
      }
      body { 
        margin: 0; 
        padding: 0;
        display: block;
        text-align: center;
      }
      .gift-receipt-container { 
        margin: 0 auto;
        display: block;
        text-align: left;
      }
    }
  `;
};

const getDrawerOpenReceiptStyles = () => {
  return `
    html, body {
      width: fit-content;
      height: auto !important;
      min-height: 0 !important;
      overflow: hidden;
    }
    body {
      font-family: 'Courier New', monospace;
      font-size: 18px;
      line-height: 1.4;
      margin: 0;
      padding: 8px;
      background: white;
      color: #000;
      display: inline-block;
      overflow: hidden;
    }
    .drawer-slip {
      width: 58mm;
      max-width: 58mm;
      display: block;
      box-sizing: border-box;
      margin: 0;
    }
    .drawer-slip__header {
      text-align: center;
      border-bottom: 2px solid #000;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .drawer-slip__header h1 {
      margin: 0 0 8px 0;
      font-size: 16px;
      font-weight: bold;
    }
    .drawer-slip__title {
      text-align: center;
      font-size: 18px;
      font-weight: bold;
      border: 2px solid #000;
      padding: 8px 6px;
      margin-bottom: 12px;
      letter-spacing: 1px;
    }
    .drawer-slip__section {
      margin-bottom: 12px;
      border-bottom: 1px dashed #000;
      padding-bottom: 10px;
    }
    .drawer-slip__row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 6px;
    }
    .drawer-slip__row span:first-child {
      font-weight: bold;
    }
    .drawer-slip__label {
      font-weight: bold;
      margin-bottom: 4px;
    }
    .drawer-slip__value {
      margin-bottom: 8px;
      word-break: break-word;
    }
    .drawer-slip__value--boxed {
      border: 1px solid #000;
      padding: 6px;
      min-height: 20px;
    }
    .drawer-slip__footer {
      text-align: center;
      font-size: 12px;
      font-weight: bold;
      margin-top: 4px;
    }
    @media print {
      html, body {
        width: fit-content;
        height: auto !important;
        min-height: 0 !important;
        overflow: hidden;
      }
      body {
        margin: 0;
        padding: 0;
      }
      .drawer-slip {
        padding-bottom: 2px;
      }
    }
  `;
};

// Receipt styles for standard and kitchen receipts
const getReceiptStyles = (isKitchen = false) => {
  if (isKitchen) {
    return `
      :root {
        /* 2-1/4" (58mm) roll — left side of wider printer */
        --receipt-width: 58mm;
      }
      @page {
        size: 58mm auto;
        margin: 0;
      }
      html, body {
        width: fit-content;
        height: auto !important;
        min-height: 0 !important;
      }
      body {
        font-family: 'Courier New', monospace;
        font-size: 16px;
        line-height: 1.35;
        margin: 0;
        padding: 0;
        background: white;
        color: #000;
        display: block;
        text-align: left;
        overflow: hidden;
      }
      .receipt-container {
        width: var(--receipt-width);
        max-width: var(--receipt-width);
        margin: 0;
        padding: 4px 4px 48px;
        display: block;
        text-align: left;
        box-sizing: border-box;
      }
      .kitchen-header {
        text-align: left;
        border-bottom: 2px solid #000;
        padding-bottom: 8px;
        margin-bottom: 12px;
      }
      .kitchen-header h1 {
        margin: 0;
        font-size: 11px;
        font-weight: bold;
        max-width: 100%;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .order-info {
        margin-top: 10px;
        font-weight: bold;
        text-align: left;
      }
      .kitchen-items {
        margin: 15px 0 0;
        padding-bottom: 48px;
      }
      .kitchen-item {
        margin-bottom: 18px;
        padding-bottom: 12px;
        border-bottom: 1px dashed #ccc;
      }
      .item-qty-name {
        font-weight: bold;
        font-size: 10px;
        line-height: 1.25;
      }
      .quantity {
        font-size: 14px;
        margin-right: 10px;
      }
      .name {
        font-size: 11px;
      }
      .modifiers {
        margin-left: 20px;
        margin-top: 4px;
        font-style: italic;
        font-size: 10px;
        line-height: 1.3;
      }
      .item-notes {
        margin-top: 5px;
        padding: 5px;
        background: #f0f0f0;
        border: 1px solid #ddd;
        font-weight: bold;
        font-size: 10px;
      }
      .kitchen-footer {
        text-align: left;
        margin-top: 36px;
        border-top: 2px solid #000;
        padding-top: 10px;
        padding-bottom: 40px;
      }
      @media print {
        html, body {
          width: fit-content;
          height: auto !important;
          min-height: 0 !important;
          overflow: hidden;
        }
        body {
          margin: 0;
          padding: 0;
        }
        .receipt-container {
          max-width: none;
          padding-bottom: 2px;
        }
      }
    `;
  }

  return `
    :root {
      /* 2-1/4" (58mm) roll seated on the left of a wider printer */
      --receipt-width: 58mm;
    }
    @page {
      size: 58mm auto;
      margin: 0;
    }
    html, body {
      width: fit-content;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
    }
    body {
      font-family: 'Courier New', monospace;
      font-size: 10px;
      line-height: 1.35;
      margin: 0;
      padding: 0;
      background: white;
      color: #000;
      display: block;
      text-align: left;
      overflow: visible;
      page-break-after: avoid;
    }
    .receipt-container {
      width: var(--receipt-width);
      max-width: var(--receipt-width);
      margin: 0;
      padding: 4px 4px 1px;
      display: block;
      text-align: left;
      box-sizing: border-box;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .business-header {
      text-align: left;
      margin-bottom: 14px;
      border-bottom: 2px solid #000;
      padding-bottom: 8px;
    }
    .business-header h1 {
      margin: 0 0 10px 0;
      font-size: 14px;
      font-weight: bold;
      line-height: 1.2;
      max-width: 100%;
      overflow-wrap: anywhere;
      word-break: break-word;
      white-space: normal;
      hyphens: auto;
    }
    .business-address {
      font-size: 10px;
      line-height: 1.4;
    }
    .tax-number {
      font-size: 10px;
      margin-top: 5px;
      font-style: italic;
    }
    .sale-info {
      text-align: left;
      margin-bottom: 12px;
    }
    .reprint-notice {
      font-weight: bold;
      font-size: 10px;
      margin-bottom: 5px;
      text-align: left;
    }
    .sale-details {
      font-size: 10px;
    }
    .section-header {
      font-weight: bold;
      text-align: left;
      margin: 15px 0 10px 0;
      padding: 5px 0;
      border-top: 1px solid #000;
      border-bottom: 1px solid #000;
    }
    .receipt-item {
      margin-bottom: 12px;
    }
    .item-line {
      display: flex;
      justify-content: space-between;
      font-weight: bold;
      font-size: 10px;
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
      margin: 4px 0;
      font-size: 11px;
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
      margin: 4px 0;
      font-size: 11px;
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
      text-align: left;
      margin-top: 8px;
      border-top: 2px solid #000;
      padding-top: 6px;
      padding-bottom: 0;
    }
    .id-section {
      text-align: left;
      margin: 0 auto 8px;
      width: 100%;
      font-size: 10px;
    }
    .id-line {
      display: flex;
      justify-content: space-between;
      font-family: 'Courier New', monospace;
      margin: 2px 0;
    }
    .thank-you {
      font-weight: bold;
      margin-top: 10px;
    }
    .qr-section {
      margin: 8px 0 4px;
      font-size: 10px;
    }
    .qr-image {
      width: 120px;
      height: 120px;
      image-rendering: pixelated;
    }
    @media print {
      html, body {
        width: fit-content;
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        overflow: visible;
      }
      body { 
        margin: 0; 
        padding: 0; 
        display: block;
        text-align: left;
        page-break-after: avoid;
      }
      .receipt-container { 
        width: var(--receipt-width);
        max-width: var(--receipt-width);
        margin: 0;
        padding-bottom: 0;
        margin-bottom: 0;
        display: block;
        text-align: left;
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