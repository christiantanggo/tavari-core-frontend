import { createHash } from 'node:crypto';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const MONTHS = new Map(
  [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december'
  ].map((m, idx) => [m, idx + 1])
);

const LABEL_RE = /^(first name|last name|phone|email|relationship|address line|country|city|state\/province|zip\/postal|parent|participant|electronic signature|ip:|page )/i;

function cleanLine(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean)
    .filter((line) => !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line));
}

function stripSmartwaiverDobPrefix(value) {
  return cleanLine(value).replace(/^\d+\s*-\s*/i, '');
}

function toIsoDate(value) {
  const raw = stripSmartwaiverDobPrefix(value);
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString().slice(0, 10);
  }

  const m = raw.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,)?\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS.get(m[1].toLowerCase());
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}

function parseCompletedAt(text) {
  const m = String(text || '').match(/Completed:\s*([^\n\r]+?)(?:\s+UTC)?(?:\n|\r|$)/i);
  if (!m) return null;
  const d = new Date(m[1].trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseDocumentId(text, filename = '') {
  const fromText = String(text || '').match(/Document ID:\s*([A-Za-z0-9_-]+)/i);
  if (fromText?.[1]) return fromText[1];
  return documentIdFromFilename(filename);
}

/** Smartwaiver export filenames end with `_<documentId>.pdf` */
export function documentIdFromFilename(filename = '') {
  const fromName = String(filename || '').match(/_([A-Za-z0-9_-]{12,})(?:\.pdf)?$/i);
  return fromName?.[1] || null;
}

function parseFieldValues(lines, labelPattern) {
  const values = [];
  for (let i = 1; i < lines.length; i++) {
    if (!labelPattern.test(lines[i])) continue;
    const value = lines[i - 1];
    if (!value || LABEL_RE.test(value)) continue;
    values.push(value);
  }
  return values;
}

/** OTWK Smartwaiver PDFs often encode DOB as three lines: `7 - July`, `21`, `1961`. */
const SPLIT_MONTH_LINE =
  /^(\d{1,2})\s*-\s*(January|February|March|April|May|June|July|August|September|October|November|December)$/i;

function parseSplitDobTripletAt(lines, index) {
  const monthLine = lines[index];
  const m = monthLine?.match(SPLIT_MONTH_LINE);
  if (!m) return null;
  const day = cleanLine(lines[index + 1]);
  const year = cleanLine(lines[index + 2]);
  if (!/^\d{1,2}$/.test(day) || !/^\d{4}$/.test(year)) return null;
  const month = MONTHS.get(m[2].toLowerCase());
  if (!month) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function collectSplitDobTriplets(lines) {
  const out = [];
  for (let i = 0; i < lines.length - 2; i++) {
    const iso = parseSplitDobTripletAt(lines, i);
    if (iso) out.push(iso);
  }
  return out;
}

/** Assign split triplets to name pairs in document order (minors first, signing adult last). */
function assignDobsToNamePairs(namePairs, splitDobs) {
  if (!namePairs?.length || !splitDobs?.length) return namePairs;
  return namePairs.map((pair, idx) => ({
    ...pair,
    date_of_birth: splitDobs[idx] || pair.date_of_birth || null
  }));
}

function unique(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const key = cleanLine(value).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(cleanLine(value));
  }
  return out;
}

function parseNamePairs(lines) {
  const pairs = [];
  const isRequiredMark = (line) => /^\*+$/.test(line || '');
  const nextMeaningfulIndex = (start) => {
    for (let j = start; j < lines.length; j++) {
      if (!isRequiredMark(lines[j])) return j;
    }
    return -1;
  };

  for (let i = 1; i < lines.length - 1; i++) {
    if (!/^first name\*?$/i.test(lines[i])) continue;
    const first = lines[i - 1];
    if (!first || LABEL_RE.test(first)) continue;

    let last = null;
    const valueIdx = nextMeaningfulIndex(i + 1);
    const labelIdx = valueIdx >= 0 ? nextMeaningfulIndex(valueIdx + 1) : -1;
    if (valueIdx >= 0 && labelIdx >= 0 && /^last name\*?$/i.test(lines[labelIdx])) {
      last = lines[valueIdx];
    } else if (/^last name\*?$/i.test(lines[i + 1] || '') && i > 1) {
      last = lines[i - 2];
    }

    if (!last || LABEL_RE.test(last)) continue;
    const key = `${first.toLowerCase()}|${last.toLowerCase()}`;
    if (pairs.some((p) => p.key === key)) continue;
    pairs.push({ first_name: first, last_name: last, key });
  }
  return pairs.map(({ key, ...rest }) => rest);
}

function confidenceScore(parsed) {
  let score = 0;
  if (parsed.documentId) score += 30;
  if (parsed.completedAt) score += 25;
  if (parsed.firstName && parsed.lastName) score += 25;
  if (parsed.email || parsed.phone) score += 10;
  if (parsed.minors.length > 0) score += 10;
  return Math.min(100, score);
}

export async function extractPdfText(buffer) {
  // Node Buffer extends Uint8Array, but pdfjs rejects Buffer instances. Copy into a plain Uint8Array.
  const data = new Uint8Array(buffer);
  const pdf = await pdfjsLib.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: true
  }).promise;

  const pages = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str || '').join('\n'));
  }
  return pages.join('\n\n');
}

export async function parseSmartwaiverPdf(buffer, { filename = '' } = {}) {
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const text = await extractPdfText(buffer);
  const lines = normalizeLines(text);
  const documentId = parseDocumentId(text, filename);
  const completedAt = parseCompletedAt(text);
  const namePairs = parseNamePairs(lines);
  const emails = unique([...String(text).matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0]));
  const phones = unique(parseFieldValues(lines, /^phone\*?$/i));
  const dobValues = unique(
    parseFieldValues(lines, /(?:participant's|parent.*adult).*date of birth\*?$/i)
  )
    .map((v) => toIsoDate(v))
    .filter(Boolean);
  const splitDobs = collectSplitDobTriplets(lines);
  const relationships = unique(parseFieldValues(lines, /^relationship\*?$/i));

  // Smartwaiver exports commonly list participants first and the signing adult last.
  const pairsWithDob = assignDobsToNamePairs(namePairs, splitDobs);
  const signerPair = pairsWithDob.length > 1 ? pairsWithDob[pairsWithDob.length - 1] : pairsWithDob[0] || {};
  const participantPairs = pairsWithDob.length > 1 ? pairsWithDob.slice(0, -1) : [];

  const minors = participantPairs.map((pair, idx) => ({
    first_name: pair.first_name,
    last_name: pair.last_name,
    date_of_birth:
      pair.date_of_birth || toIsoDate(dobValues[idx] || null) || null,
    _smartwaiverIndex: idx + 1
  }));

  const signerDob =
    signerPair.date_of_birth ||
    toIsoDate(dobValues[dobValues.length - 1] || null) ||
    (splitDobs.length ? splitDobs[splitDobs.length - 1] : null);

  const parsed = {
    sourceSystem: 'smartwaiver',
    documentId,
    completedAt,
    firstName: signerPair.first_name || '',
    lastName: signerPair.last_name || '',
    email: emails[0] || '',
    phone: phones[0] || '',
    dateOfBirth: signerDob,
    minors,
    numMinors: minors.length,
    relationship: relationships[0] || '',
    sha256,
    rawTextLength: text.length,
    pageTextPreview: text.slice(0, 2000)
  };

  return {
    ...parsed,
    parseConfidence: confidenceScore(parsed),
    raw: {
      filename,
      namePairs,
      emails,
      phones,
      dobValues,
      splitDobs,
      relationships
    }
  };
}

export {
  collectSplitDobTriplets,
  assignDobsToNamePairs,
  parseSplitDobTripletAt
};
