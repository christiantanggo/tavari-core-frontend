export function formatCamperRegistrationLabel(doc) {
  const name = [doc.first_name, doc.last_name].filter(Boolean).join(' ').trim() || 'Camper';
  const signed = doc.signed_at ? new Date(doc.signed_at).toLocaleDateString('en-CA') : null;
  const expires = doc.expires_at ? new Date(doc.expires_at).toLocaleDateString('en-CA') : null;
  const bits = [name];
  if (signed) bits.push(`signed ${signed}`);
  if (expires) bits.push(`valid until ${expires}`);
  return bits.join(' · ');
}

/**
 * Score how well a document matches a free-text camper name query.
 */
export function scoreCamperNameMatch(doc, searchName) {
  const q = String(searchName || '').trim().toLowerCase();
  if (!q) return 0;

  const fn = String(doc.first_name || '').trim().toLowerCase();
  const ln = String(doc.last_name || '').trim().toLowerCase();
  const full = [fn, ln].filter(Boolean).join(' ');

  if (full === q) return 100;
  if (full.includes(q) || q.includes(full)) return 85;

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    if (fn === first && ln === last) return 95;
    if (fn.startsWith(first) && ln.startsWith(last)) return 90;
    if (fn.includes(first) && ln.includes(last)) return 80;
  }

  if (tokens.length === 1) {
    const t = tokens[0];
    if (fn === t || ln === t) return 75;
    if (fn.includes(t) || ln.includes(t)) return 60;
  }

  return 0;
}

/** Return documents scoring above threshold, sorted best first. */
export function filterCamperDocumentsByName(documents, searchName, minScore = 55) {
  return (documents || [])
    .map((doc) => ({ doc, score: scoreCamperNameMatch(doc, searchName) }))
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => b.score - a.score)
    .map(({ doc }) => doc);
}
