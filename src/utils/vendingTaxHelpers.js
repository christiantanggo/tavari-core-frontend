// Tax helpers for vending kiosk (mirrors POS cart item shape for useTaxCalculations)

export function toTaxCartItem(item) {
  return {
    id: item.posInventoryId || item.goodsId,
    name: item.goodsName || item.name,
    price: Number(item.price || 0),
    quantity: Number(item.quantity || 1),
    category_id: item.categoryId ?? item.category_id ?? null,
    item_tax_overrides: item.itemTaxOverrides ?? item.item_tax_overrides ?? [],
    modifiers: []
  };
}

export function getProductPriceDisplay(product, taxCalc) {
  const basePrice = Number(product.price || 0);
  if (!taxCalc || taxCalc.loading) {
    return { basePrice, priceWithTax: basePrice, taxAmount: 0, showTaxInclusive: false };
  }

  try {
    const taxInfo = taxCalc.calculateItemTax(toTaxCartItem({ ...product, quantity: 1 }), basePrice);
    const taxAmount = taxInfo.taxAmount || 0;
    return {
      basePrice,
      priceWithTax: basePrice + taxAmount,
      taxAmount,
      showTaxInclusive: taxAmount > 0
    };
  } catch {
    return { basePrice, priceWithTax: basePrice, taxAmount: 0, showTaxInclusive: false };
  }
}

export function calculateVendingCartTax(cartItems, taxCalc) {
  const subtotal = cartItems.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1),
    0
  );

  if (!taxCalc || taxCalc.loading || !cartItems.length) {
    return {
      subtotal,
      totalTax: 0,
      totalWithTax: subtotal,
      aggregatedTaxes: {},
      aggregatedRebates: {}
    };
  }

  const taxItems = cartItems.map(toTaxCartItem);
  const taxCalculation = taxCalc.calculateTotalTax(taxItems, 0, 0, subtotal);
  const totalTax = taxCalculation.totalTax || 0;

  return {
    subtotal,
    totalTax,
    totalWithTax: subtotal + totalTax,
    aggregatedTaxes: taxCalculation.aggregatedTaxes || {},
    aggregatedRebates: taxCalculation.aggregatedRebates || {}
  };
}
