/**
 * Map invoice line editor rows to POS cart-item shape for useTaxCalculations.
 */
export function linesToCartItems(lines = []) {
  return (lines || []).map((line, index) => ({
    id: line.clientId || line.id || line.inventory_id || `line-${index}`,
    inventory_id: line.inventory_id || null,
    category_id: line.category_id || null,
    name: line.name || 'Item',
    quantity: Number(line.quantity) || 1,
    price: Number(line.unit_price) || 0,
    is_custom: line.line_type === 'custom' || !line.inventory_id,
    tax_exempt: !!line.tax_exempt,
    modifiers: [],
  }));
}

export function computeLineSubtotal(line) {
  const qty = Number(line.quantity) || 1;
  const unit = Number(line.unit_price) || 0;
  return Math.round(qty * unit * 100) / 100;
}

/**
 * Compute invoice subtotal, tax breakdown, and total.
 */
export function computeInvoiceTotals(lines = [], taxCalc, options = {}) {
  const cartItems = linesToCartItems(lines);
  const subtotal = cartItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  const taxableItems = cartItems.filter((item) => !item.tax_exempt);
  const taxableSubtotal = taxableItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  let taxResult = {
    totalTax: 0,
    aggregatedTaxes: {},
    aggregatedRebates: {},
    itemTaxDetails: [],
  };

  if (taxableItems.length > 0 && taxCalc?.calculateTotalTax) {
    const indianOpts =
      options.indian_status_gst_only && typeof options.indian_status_gst_rate === 'number'
        ? {
            enabled: true,
            gstRate: options.indian_status_gst_rate,
            taxLabel: options.indian_status_tax_label || 'GST (Indian Status)',
          }
        : null;

    taxResult = taxCalc.calculateTotalTax(
      taxableItems,
      0,
      0,
      taxableSubtotal,
      indianOpts
    );
  }

  const total = Math.round((subtotal + taxResult.totalTax) * 100) / 100;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    tax_amount: Math.round(taxResult.totalTax * 100) / 100,
    total,
    aggregatedTaxes: taxResult.aggregatedTaxes || {},
    aggregatedRebates: taxResult.aggregatedRebates || {},
    itemTaxDetails: taxResult.itemTaxDetails || [],
  };
}

export function defaultDueDate(defaultDueDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + (Number(defaultDueDays) || 0));
  return d.toISOString().slice(0, 10);
}

export function stockLinesFromInvoiceLines(lines = []) {
  return (lines || [])
    .filter((line) => line.inventory_id && ['inventory', 'bundle'].includes(line.line_type))
    .map((line) => ({
      inventory_id: line.inventory_id,
      quantity: Number(line.quantity) || 1,
    }));
}
