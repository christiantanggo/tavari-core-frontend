/**
 * Minimal ESC/POS receipt encoder for 58mm (2-1/4") thermal paper.
 * Sized for narrow rolls seated on the left of a wider printer head.
 * No third-party dependency — raw command bytes only.
 */

import { formatPosModifierLabel } from '../utils/posModifierDisplay';

const ESC = 0x1b;
const GS = 0x1d;

const encoder = typeof TextEncoder !== 'undefined'
  ? new TextEncoder('ascii', { fatal: false })
  : null;

function encodeText(text) {
  const safe = String(text ?? '')
    .replace(/[^\x20-\x7E\n\r\t]/g, '?');
  if (encoder) return encoder.encode(safe);
  const bytes = new Uint8Array(safe.length);
  for (let i = 0; i < safe.length; i += 1) {
    bytes[i] = safe.charCodeAt(i) & 0x7f;
  }
  return bytes;
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

function cmd(...bytes) {
  return new Uint8Array(bytes);
}

const CMD = {
  init: () => cmd(ESC, 0x40),
  alignLeft: () => cmd(ESC, 0x61, 0x00),
  alignCenter: () => cmd(ESC, 0x61, 0x01),
  boldOn: () => cmd(ESC, 0x45, 0x01),
  boldOff: () => cmd(ESC, 0x45, 0x00),
  doubleOn: () => cmd(ESC, 0x21, 0x30),
  doubleOff: () => cmd(ESC, 0x21, 0x00),
  /** GS ! n — character size. 0x00 normal; 0x10 ~2x height; 0x11 ~2x width+height */
  charSize: (n = 0x00) => cmd(GS, 0x21, n),
  cut: () => cmd(GS, 0x56, 0x00),
  feed: (lines = 3) => cmd(ESC, 0x64, Math.max(0, Math.min(lines, 20))),
};

/** ~32 chars Font A on 58mm (2-1/4") paper */
const LINE_WIDTH = 32;
/** Double-width chars use ~2 columns each on 58mm */
const DOUBLE_LINE_WIDTH = 16;

const roundToCashNickel = (amount) => Math.round(amount * 20) / 20;

const formatCurrency = (amount, isCash = false) => {
  const roundedAmount = isCash ? roundToCashNickel(amount) : Number(amount || 0);
  return `$${roundedAmount.toFixed(2)}`;
};

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

function padLine(left, right, width = LINE_WIDTH) {
  const l = String(left ?? '');
  const r = String(right ?? '');
  const space = Math.max(1, width - l.length - r.length);
  return `${l}${' '.repeat(space)}${r}`;
}

function wrapLine(text, width = LINE_WIDTH) {
  const raw = String(text ?? '');
  if (raw.length <= width) return [raw];
  const lines = [];
  let remaining = raw;
  while (remaining.length > width) {
    lines.push(remaining.slice(0, width));
    remaining = remaining.slice(width);
  }
  if (remaining) lines.push(remaining);
  return lines;
}

function line(text = '') {
  return concatBytes(encodeText(`${text}\n`));
}

function divider() {
  return line('-'.repeat(LINE_WIDTH));
}

function tryParseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function extractHelcimTransactionId(saleData, payments) {
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

  const paymentNotesObj = tryParseJson(helcimPayment?.notes);
  const fromPaymentNotes = paymentNotesObj?.helcim?.transactionId || paymentNotesObj?.transactionId;
  if (fromPaymentNotes) return String(fromPaymentNotes);

  const notes = saleData?.notes || saleData?.sale_notes || '';
  const match = String(notes).match(/transaction id:\s*([0-9]+)/i) || String(notes).match(/\bH-ID:\s*([0-9]+)/i);
  return match?.[1] ? match[1] : null;
}

export const DEFAULT_POS_PRINT_AGENT_URL = 'http://127.0.0.1:19100';

function normalizePrintAgentUrl(url) {
  return String(url || '').trim().replace(/\/$/, '');
}

/** Prefer a device-local override (Chrome OS Crostini IP) when set. */
export function getPrintAgentBaseUrl() {
  try {
    const override = normalizePrintAgentUrl(localStorage.getItem('tavari_print_agent_url') || '');
    if (override) return override;
  } catch {
    /* ignore */
  }
  return DEFAULT_POS_PRINT_AGENT_URL;
}

export const POS_PRINT_AGENT_URL = DEFAULT_POS_PRINT_AGENT_URL;

export function setPrintAgentBaseUrl(url) {
  const cleaned = normalizePrintAgentUrl(url);
  if (!cleaned) {
    localStorage.removeItem('tavari_print_agent_url');
    return getPrintAgentBaseUrl();
  }
  localStorage.setItem('tavari_print_agent_url', cleaned);
  return cleaned;
}

async function probePrintAgentHealth(baseUrl) {
  const cleaned = normalizePrintAgentUrl(baseUrl);
  if (!cleaned) return false;
  try {
    const response = await fetch(`${cleaned}/health`, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Candidate helper URLs after reboot / power loss.
 * Chrome OS often loses the old Crostini IP; port-forwarded localhost survives.
 */
export function getPrintAgentFallbackUrls() {
  const primary = getPrintAgentBaseUrl();
  const urls = [primary];
  if (primary !== DEFAULT_POS_PRINT_AGENT_URL) {
    urls.push(DEFAULT_POS_PRINT_AGENT_URL);
  }
  return urls;
}

/**
 * Find a reachable print helper and, when localhost works, prefer that forever
 * so Chrome OS reboots stop requiring a new Linux IP.
 */
export async function ensurePrintAgentReachable() {
  const candidates = getPrintAgentFallbackUrls();
  for (const url of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await probePrintAgentHealth(url);
    if (!ok) continue;
    if (url !== getPrintAgentBaseUrl()) {
      setPrintAgentBaseUrl(url);
    }
    return { ok: true, url };
  }
  return { ok: false, url: getPrintAgentBaseUrl() };
}

export function uint8ToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Build ESC/POS bytes for a standard / gift / kitchen / refund / reprint receipt.
 */
export function buildEscPosReceiptBytes(saleData = {}, receiptType = 'standard', businessSettings = {}, options = {}) {
  const isGift = receiptType === 'gift';
  const isKitchen = receiptType === 'kitchen';
  const isRefund = receiptType === 'refund';
  const isReprint = receiptType === 'reprint';

  const businessName = businessSettings.business_name || businessSettings.name || 'Your Business';
  const businessAddress = businessSettings.business_address || '';
  const businessCity = businessSettings.business_city || '';
  const businessState = businessSettings.business_state || '';
  const businessPostal = businessSettings.business_postal || '';
  const businessPhone = businessSettings.business_phone || '';
  const taxNumber = businessSettings.tax_number || '';
  const receiptFooter = businessSettings.receipt_footer || '';

  const saleNumber = saleData.sale_number || 'Unknown';
  const saleDate = new Date(saleData.created_at || Date.now()).toLocaleString('en-CA', {
    timeZone: businessSettings.timezone || 'America/Toronto',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const items = saleData.items || [];
  const payments = (saleData.payments || []).map((p) =>
    typeof p === 'string' ? { payment_method: p, method: p, amount: 0 } : p
  );

  // Kitchen ticket: no business header; large items; extra bottom blank space
  // Left-align everything — center would aim at full print-head width on wider printers.
  if (isKitchen) {
    const chunks = [CMD.init(), CMD.alignLeft(), CMD.boldOn(), CMD.charSize(0x11)];
    wrapLine('KITCHEN ORDER', DOUBLE_LINE_WIDTH).forEach((l) => chunks.push(line(l)));
    chunks.push(CMD.charSize(0x00), CMD.boldOff());
    chunks.push(line(`Order #${saleNumber}`));
    chunks.push(line(saleDate));
    if (saleData.loyaltyCustomer?.customer_name) {
      wrapLine(`Customer: ${saleData.loyaltyCustomer.customer_name}`).forEach((l) => chunks.push(line(l)));
    }
    chunks.push(divider());

    // One printed line per unit (qty 2 → two name lines); modifiers/notes under each unit
    items.forEach((item) => {
      const qty = Math.max(1, Number(item.quantity) || 1);
      const name = item.name || 'Item';
      for (let i = 0; i < qty; i += 1) {
        chunks.push(CMD.boldOn(), CMD.charSize(0x11));
        wrapLine(name, DOUBLE_LINE_WIDTH).forEach((l) => chunks.push(line(l)));
        chunks.push(CMD.boldOff());
        (item.modifiers || []).forEach((mod) => {
          chunks.push(CMD.charSize(0x11));
          wrapLine(` + ${formatPosModifierLabel(mod)}`, DOUBLE_LINE_WIDTH).forEach((l) => chunks.push(line(l)));
        });
        if (item.notes) {
          chunks.push(CMD.charSize(0x00), CMD.boldOn());
          wrapLine(`NOTE: ${item.notes}`).forEach((l) => chunks.push(line(l)));
          chunks.push(CMD.boldOff());
        }
        chunks.push(CMD.charSize(0x00), line(''));
      }
    });

    chunks.push(CMD.charSize(0x00));
    // Extra blank space after items/modifiers before footer + cut
    chunks.push(line(''), line(''), line(''), line(''));
    const itemCount = items.reduce((sum, item) => sum + (item.quantity || 1), 0);
    chunks.push(divider());
    chunks.push(line(`Items: ${itemCount}`));
    chunks.push(CMD.feed(14), CMD.cut());
    return concatBytes(...chunks);
  }

  // Customer / gift / refund: left-aligned for narrow roll on left of wider head
  const chunks = [CMD.init(), CMD.alignLeft(), CMD.boldOn(), CMD.doubleOn()];
  wrapLine(businessName, DOUBLE_LINE_WIDTH).forEach((l) => chunks.push(line(l)));
  chunks.push(CMD.doubleOff(), CMD.boldOff());

  if (businessAddress) wrapLine(businessAddress).forEach((l) => chunks.push(line(l)));
  const cityLine = [businessCity, businessState, businessPostal].filter(Boolean).join(', ');
  if (cityLine) wrapLine(cityLine).forEach((l) => chunks.push(line(l)));
  if (businessPhone) wrapLine(businessPhone).forEach((l) => chunks.push(line(l)));
  if (taxNumber && !isGift) wrapLine(taxNumber).forEach((l) => chunks.push(line(l)));

  chunks.push(divider());

  if (isGift) {
    chunks.push(CMD.boldOn(), line('GIFT RECEIPT'), CMD.boldOff());
  } else if (isRefund) {
    chunks.push(CMD.boldOn(), line('REFUND RECEIPT'), CMD.boldOff());
  } else if (isReprint) {
    chunks.push(CMD.boldOn(), line('REPRINT'), CMD.boldOff());
    if (options.reprintReason) wrapLine(`Reason: ${options.reprintReason}`).forEach((l) => chunks.push(line(l)));
  }

  chunks.push(line(`Receipt #${saleNumber}`));
  wrapLine(saleDate).forEach((l) => chunks.push(line(l)));

  const operator = saleData.operator_user_name || saleData.cashier_name || saleData.employee_name;
  if (operator) chunks.push(line(`Cashier: ${operator}`));
  if (saleData.login_user_name) chunks.push(line(`Login: ${saleData.login_user_name}`));

  chunks.push(divider());

  items.forEach((item) => {
    const qty = item.quantity || 1;
    const name = item.name || 'Item';
    if (isGift) {
      wrapLine(`${qty}x ${name}`).forEach((l) => chunks.push(line(l)));
      if (item.sku) chunks.push(line(`  SKU: ${item.sku}`));
      (item.modifiers || []).forEach((mod) => chunks.push(line(`  + ${formatPosModifierLabel(mod)}`)));
      return;
    }

    const itemTotal = (item.price || 0) * qty;
    wrapLine(name).forEach((l, idx, arr) => {
      if (idx === arr.length - 1) {
        chunks.push(line(padLine(l, formatCurrency(itemTotal))));
      } else {
        chunks.push(line(l));
      }
    });
    chunks.push(line(`  ${formatCurrency(item.price || 0)} x ${qty}`));
    (item.modifiers || []).forEach((mod) => {
      chunks.push(line(padLine(`  + ${formatPosModifierLabel(mod)}`, formatCurrency(mod.price || 0))));
    });
  });

  if (!isGift) {
    chunks.push(divider());
    chunks.push(line(padLine('Subtotal', formatCurrency(saleData.subtotal || 0))));

    if (saleData.discount_amount) {
      chunks.push(line(padLine('Discount', `-${formatCurrency(saleData.discount_amount)}`)));
    }
    if (saleData.loyalty_redemption) {
      chunks.push(line(padLine('Loyalty', `-${formatCurrency(saleData.loyalty_redemption)}`)));
    }

    const taxBreakdown = saleData.taxBreakdown || [];
    const aggregatedTaxes = saleData.aggregated_taxes || {};
    let taxes = [];
    if (taxBreakdown.length > 0) {
      taxes = taxBreakdown.filter((t) => t.type === 'tax');
    } else {
      taxes = Object.entries(aggregatedTaxes).map(([name, amount]) => ({ name, amount }));
    }
    taxes.forEach((tax) => {
      chunks.push(line(padLine(tax.name || 'Tax', formatCurrency(tax.amount || 0))));
    });

    if (!taxes.length && (saleData.tax_amount || saleData.final_tax_amount)) {
      chunks.push(line(padLine('Tax', formatCurrency(saleData.tax_amount || saleData.final_tax_amount))));
    }

    if (saleData.tip_amount) {
      chunks.push(line(padLine('Tip', formatCurrency(saleData.tip_amount))));
    }

    chunks.push(CMD.boldOn());
    chunks.push(line(padLine('TOTAL', formatCurrency(saleData.final_total || 0))));
    chunks.push(CMD.boldOff());
    chunks.push(divider());

    payments.forEach((payment) => {
      const method = payment.custom_method_name || payment.method || payment.payment_method;
      const isCash = String(method || '').toLowerCase() === 'cash';
      const amount = Number(payment.amount || 0);
      chunks.push(line(padLine(formatPaymentMethodLabel(method), formatCurrency(amount, isCash))));
    });

    if (saleData.change_given) {
      chunks.push(line(padLine('Change', formatCurrency(saleData.change_given, true))));
    }

    const helcimId = extractHelcimTransactionId(saleData, payments);
    if (helcimId) chunks.push(line(`H-ID: ${helcimId}`));

    if (saleData.indian_status_gst_only && saleData.indian_status_certificate_number) {
      chunks.push(divider());
      chunks.push(line('Indian Status (GST only)'));
      chunks.push(line(`Status #: ${saleData.indian_status_certificate_number}`));
    }
  }

  if (receiptFooter) {
    chunks.push(divider());
    wrapLine(receiptFooter).forEach((l) => chunks.push(line(l)));
  }

  if (isRefund && options.signatureCopy) {
    chunks.push(divider());
    chunks.push(CMD.boldOn(), line('SIGNATURE COPY'), CMD.boldOff());
    chunks.push(line(''));
    chunks.push(line('Customer signature:'));
    chunks.push(line('_______________________________'));
    chunks.push(line(''));
    chunks.push(line('Employee signature:'));
    chunks.push(line('_______________________________'));
    chunks.push(line(''));
    chunks.push(line('Date: _______________'));
  }

  chunks.push(CMD.feed(4), CMD.cut());
  return concatBytes(...chunks);
}

export function buildEscPosDrawerSlipBytes(drawerData = {}, businessSettings = {}) {
  const businessName = businessSettings.business_name || businessSettings.name || 'Tavari POS';
  const businessAddress = businessSettings.business_address || businessSettings.address || '';
  const businessPhone = businessSettings.business_phone || businessSettings.phone || '';
  const timeZone = businessSettings.timezone || 'America/Toronto';
  const openedAt = new Date(drawerData.opened_at || Date.now());
  const openedDate = openedAt.toLocaleDateString('en-CA', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const openedTime = openedAt.toLocaleTimeString('en-CA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const chunks = [
    CMD.init(),
    CMD.alignLeft(),
    CMD.boldOn(),
    CMD.doubleOn(),
  ];
  wrapLine(businessName, DOUBLE_LINE_WIDTH).forEach((l) => chunks.push(line(l)));
  chunks.push(CMD.doubleOff(), CMD.boldOff());
  if (businessAddress) wrapLine(businessAddress).forEach((l) => chunks.push(line(l)));
  if (businessPhone) wrapLine(businessPhone).forEach((l) => chunks.push(line(l)));
  chunks.push(divider());
  chunks.push(CMD.boldOn(), line('TILL OPENED'), CMD.boldOff());
  chunks.push(divider());
  chunks.push(line(padLine('Date', openedDate)));
  chunks.push(line(padLine('Time', openedTime)));
  chunks.push(line(padLine('Register', drawerData.terminal_id || 'Unknown')));
  chunks.push(divider());
  wrapLine(`Login: ${drawerData.login_user_name || 'Unknown'}`).forEach((l) => chunks.push(line(l)));
  wrapLine(`Unlocked: ${drawerData.operator_user_name || drawerData.opened_by_name || 'Unknown'}`).forEach((l) =>
    chunks.push(line(l))
  );
  if (drawerData.manager_approved_by_name) {
    wrapLine(`Manager: ${drawerData.manager_approved_by_name}`).forEach((l) => chunks.push(line(l)));
  }
  chunks.push(divider());
  chunks.push(line('Reason:'));
  wrapLine(drawerData.reason || drawerData.open_reason || 'No reason provided').forEach((l) =>
    chunks.push(line(l))
  );
  if (drawerData.notes || drawerData.open_notes) {
    chunks.push(line('Notes:'));
    wrapLine(drawerData.notes || drawerData.open_notes).forEach((l) => chunks.push(line(l)));
  }
  chunks.push(divider(), line('Manager review slip'));
  chunks.push(CMD.feed(4), CMD.cut());
  return concatBytes(...chunks);
}

/** Short slip to verify helper → printer connectivity from POS settings. */
export function buildEscPosTestSlipBytes({ stationName = null, printerHost = null, printerPort = null } = {}) {
  const now = new Date().toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const chunks = [CMD.init(), CMD.alignLeft(), CMD.boldOn(), CMD.doubleOn()];
  wrapLine('TAVARI TEST PRINT', DOUBLE_LINE_WIDTH).forEach((l) => chunks.push(line(l)));
  chunks.push(CMD.doubleOff(), CMD.boldOff());
  chunks.push(divider());
  chunks.push(line('Receipt printer OK'));
  wrapLine(now).forEach((l) => chunks.push(line(l)));
  if (stationName) {
    wrapLine(`Station: ${stationName}`).forEach((l) => chunks.push(line(l)));
  }
  if (printerHost) {
    chunks.push(line(`Printer: ${printerHost}:${printerPort || 9100}`));
  }
  chunks.push(divider());
  wrapLine('If you can read this, the helper and printer are connected.').forEach((l) =>
    chunks.push(line(l))
  );
  chunks.push(CMD.feed(4), CMD.cut());
  return concatBytes(...chunks);
}

export async function sendEscPosToPrintAgent(bytes, { host, port }) {
  const body = JSON.stringify({
    host,
    port,
    dataBase64: uint8ToBase64(bytes),
  });

  const candidates = getPrintAgentFallbackUrls();
  let lastAgentError = null;

  for (const baseUrl of candidates) {
    let response;
    try {
      // eslint-disable-next-line no-await-in-loop
      response = await fetch(`${baseUrl}/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch {
      continue;
    }

    let payload = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok || payload?.ok === false) {
      lastAgentError = payload?.error || `Print agent error (${response.status})`;
      // Agent is reachable but printer/job failed — do not keep hopping URLs.
      throw new Error(lastAgentError);
    }

    if (baseUrl !== getPrintAgentBaseUrl()) {
      setPrintAgentBaseUrl(baseUrl);
    }
    return true;
  }

  if (lastAgentError) {
    throw new Error(lastAgentError);
  }

  throw new Error(
    'Tavari Receipt Printer is not running on this device. ' +
      'On Chrome OS: open Linux once, add port forwarding for 19100, then use http://127.0.0.1:19100 ' +
      '(POS → Settings → Register Stations). On Windows: install Tavari Receipt Printer.'
  );
}

export async function checkPrintAgentHealth() {
  const result = await ensurePrintAgentReachable();
  return result.ok;
}
