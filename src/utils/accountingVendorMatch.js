/** Normalize vendor name for comparison: lowercase, & -> and, strip punctuation, collapse spaces. */
function normalizeVendorName(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Get first N significant words (length > 1) from normalized name. */
function firstWords(normalized, n = 2) {
  const words = normalized.split(/\s+/).filter((w) => w.length > 1);
  return words.slice(0, n).join(' ');
}

/** Match extracted vendor name to a vendor in the list (exact, partial, then near-match). Returns vendor object or null. */
export function matchVendorByName(vendorName, vendors) {
  if (!vendorName || !String(vendorName).trim() || !vendors?.length) return null;
  const name = String(vendorName).trim().toLowerCase();
  const nameNorm = normalizeVendorName(vendorName);

  const exact = vendors.find((v) => (v.name || '').trim().toLowerCase() === name);
  if (exact) return exact;

  const partial = vendors.find((v) => {
    const vn = (v.name || '').toLowerCase();
    return vn.includes(name) || name.includes(vn);
  });
  if (partial) return partial;

  const extPrefix = firstWords(nameNorm, 2);
  if (extPrefix.length < 4) return null;

  const near = vendors.find((v) => {
    const vNorm = normalizeVendorName(v.name);
    const vPrefix = firstWords(vNorm, 2);
    return (
      vNorm.startsWith(extPrefix) ||
      extPrefix.startsWith(vPrefix) ||
      nameNorm.startsWith(vPrefix) ||
      vNorm.startsWith(firstWords(nameNorm, 3))
    );
  });
  return near || null;
}
