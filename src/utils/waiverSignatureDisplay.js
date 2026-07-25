/**
 * Parse signature_data (jsonb string, quoted JSON, object, or raw base64) into a usable img src.
 */
function extractInlineDataUrlFromSignatureData(d) {
  if (d == null) return '';

  if (typeof d === 'string') {
    let t = String(d).trim();
    if (!t) return '';
    // JSON-encoded scalar string sometimes arrives as `"data:image/..."`
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
      try {
        const parsed = JSON.parse(t);
        if (typeof parsed === 'string') t = parsed.trim();
        else t = t.slice(1, -1);
      } catch {
        t = t.slice(1, -1).trim();
      }
    }
    if (/^(data:|https?:\/\/)/i.test(t)) return t;
    const b64 = t.replace(/\s/g, '');
    if (/^[A-Za-z0-9+/=_-]+$/.test(b64) && b64.length >= 200) {
      return `data:image/png;base64,${b64}`;
    }
    return '';
  }

  if (typeof d === 'object') {
    const keys = ['dataUrl', 'dataURL', 'imageUrl', 'imageData', 'image', 'img', 'base64', 'data'];
    for (const k of keys) {
      const cand = d[k];
      if (typeof cand === 'string') {
        const sub = extractInlineDataUrlFromSignatureData(cand);
        if (sub) return sub;
      }
    }
  }

  return '';
}

/**
 * Public storage URL only (for img onError fallback when inline fails).
 */
export function resolveWaiverSignatureStorageUrl(row) {
  if (!row) return '';
  const u = row.signature_image_url;
  if (u == null || !String(u).trim()) return '';
  return String(u).trim();
}

/**
 * Prefer embedded signature_data (data URL / raw base64) over signature_image_url so staff
 * still see the stroke when storage URL is wrong, 403, or slow to propagate.
 */
export function resolveWaiverSignatureImgSrc(row) {
  if (!row) return '';
  const inline = extractInlineDataUrlFromSignatureData(row.signature_data);
  if (inline) return inline;
  return resolveWaiverSignatureStorageUrl(row);
}
