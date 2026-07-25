import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { supabase } from '../../supabaseClient';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const STORAGE_BUCKET = 'waivers';
const STORAGE_PREFIX = 'smartwaiver-imports';

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

function unique(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const cleaned = cleanLine(value);
    const key = cleaned.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
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

function sanitizePathPart(value, fallback) {
  return String(value || fallback || 'unknown')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 160);
}

async function sha256Hex(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function extractPdfText(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
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

export async function parseSmartwaiverPdfFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const sha256 = await sha256Hex(arrayBuffer.slice(0));
  const text = await extractPdfText(arrayBuffer);
  const lines = normalizeLines(text);
  const documentId = parseDocumentId(text, file.name);
  const completedAt = parseCompletedAt(text);
  const namePairs = parseNamePairs(lines);
  const emails = unique([...String(text).matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0]));
  const phones = unique(parseFieldValues(lines, /^phone\*?$/i));
  const dobValues = unique(parseFieldValues(lines, /date of birth\*?$/i));
  const relationships = unique(parseFieldValues(lines, /^relationship\*?$/i));
  const signerPair = namePairs.length > 1 ? namePairs[namePairs.length - 1] : namePairs[0] || {};
  const participantPairs = namePairs.length > 1 ? namePairs.slice(0, -1) : [];
  const minors = participantPairs.map((pair, idx) => ({
    first_name: pair.first_name,
    last_name: pair.last_name,
    date_of_birth: toIsoDate(dobValues[idx] || null),
    _smartwaiverIndex: idx + 1
  }));

  const parsed = {
    sourceSystem: 'smartwaiver',
    documentId,
    completedAt,
    firstName: signerPair.first_name || '',
    lastName: signerPair.last_name || '',
    email: emails[0] || '',
    phone: phones[0] || '',
    dateOfBirth: toIsoDate(dobValues[namePairs.length - 1] || dobValues[dobValues.length - 1] || null),
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
      filename: file.name,
      namePairs,
      emails,
      phones,
      dobValues,
      relationships
    }
  };
}

function buildLegacyRow({ businessId, parsed, storagePath, filename }) {
  const fallbackParts = String(filename || '').replace(/\.pdf$/i, '').split('_');
  const looksDated = /^\d{4}$/.test(fallbackParts[0] || '') && /^\d{2}$/.test(fallbackParts[1] || '');
  const fallbackFirst = (looksDated ? fallbackParts[4] : fallbackParts[3]) || 'Smartwaiver';
  const fallbackLast = (looksDated ? fallbackParts[3] : fallbackParts[2]) || 'Imported';
  const minorNames = (parsed.minors || [])
    .map((m) => `${m.first_name || ''} ${m.last_name || ''}`.trim())
    .filter(Boolean);
  const searchableSummary = [
    parsed.documentId,
    parsed.firstName,
    parsed.lastName,
    parsed.email,
    parsed.phone,
    parsed.relationship,
    ...minorNames,
    filename
  ]
    .filter(Boolean)
    .join(' | ');

  return {
    business_id: businessId,
    source_system: 'smartwaiver',
    external_document_id: parsed.documentId,
    legacy_row_id: null,
    first_name: parsed.firstName || fallbackFirst,
    last_name: parsed.lastName || fallbackLast,
    email: parsed.email || null,
    phone: parsed.phone || null,
    date_of_birth: parsed.dateOfBirth || null,
    num_minors: parsed.numMinors || 0,
    legacy_minors: parsed.minors || [],
    signed_at: parsed.completedAt || null,
    created_at: parsed.completedAt || null,
    updated_at: new Date().toISOString(),
    imported_pdf_storage_path: storagePath,
    imported_pdf_uploaded_at: storagePath ? new Date().toISOString() : null,
    imported_pdf_sha256: parsed.sha256,
    imported_pdf_meta: {
      filename,
      documentId: parsed.documentId,
      parseConfidence: parsed.parseConfidence,
      relationship: parsed.relationship,
      raw: parsed.raw,
      rawTextLength: parsed.rawTextLength,
      pageTextPreview: parsed.pageTextPreview
    },
    notes: parsed.relationship ? `Relationship: ${parsed.relationship}` : null,
    info: `Smartwaiver PDF import: ${filename} | ${searchableSummary}`
  };
}

async function uploadPdf({ businessId, file, parsed }) {
  const id = sanitizePathPart(parsed.documentId || parsed.sha256, file.name.replace(/\.pdf$/i, ''));
  const storagePath = `${STORAGE_PREFIX}/${businessId}/${id}.pdf`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, file, {
    contentType: 'application/pdf',
    cacheControl: '31536000',
    upsert: false
  });

  if (error && !/exist|duplicate/i.test(error.message || '')) {
    throw error;
  }

  return storagePath;
}

async function insertOrUpdateLegacyRow(row) {
  const { data: existing, error: findError } = await supabase
    .from('legacy_waivers')
    .select('id')
    .eq('business_id', row.business_id)
    .eq('source_system', row.source_system)
    .eq('external_document_id', row.external_document_id)
    .maybeSingle();

  if (findError) throw findError;

  if (existing?.id) {
    const { data, error } = await supabase
      .from('legacy_waivers')
      .update(row)
      .eq('id', existing.id)
      .select('id, external_document_id')
      .single();
    if (error) throw error;
    return { ...data, action: 'updated' };
  }

  const { data, error } = await supabase
    .from('legacy_waivers')
    .insert(row)
    .select('id, external_document_id')
    .single();
  if (error) throw error;
  return { ...data, action: 'created' };
}

export async function importSmartwaiverPdfFile({ businessId, file }) {
  if (!businessId) throw new Error('Business ID is required');
  if (!file) throw new Error('PDF file is required');
  if (!/\.pdf$/i.test(file.name)) throw new Error(`${file.name} is not a PDF`);

  const parsed = await parseSmartwaiverPdfFile(file);
  if (!parsed.documentId) {
    throw new Error(`Could not determine Smartwaiver Document ID for ${file.name}`);
  }
  const storagePath = await uploadPdf({ businessId, file, parsed });
  const row = buildLegacyRow({ businessId, parsed, storagePath, filename: file.name });
  const saved = await insertOrUpdateLegacyRow(row);
  return { parsed, storagePath, saved };
}
