export function getModifierPriceTotal(modifiers = []) {
  if (!Array.isArray(modifiers)) return 0;

  return modifiers.reduce((sum, modifier) => {
    return sum + (Number(modifier?.price) || 0);
  }, 0);
}

export function getPosLineUnitPrice(item) {
  return (Number(item?.price) || 0) + getModifierPriceTotal(item?.modifiers);
}

export function getPosLineSubtotal(item) {
  const quantity = Number(item?.quantity) || 1;
  return getPosLineUnitPrice(item) * quantity;
}
