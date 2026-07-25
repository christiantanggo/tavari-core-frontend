import fs from 'node:fs/promises';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { documentIdFromFilename, parseSmartwaiverPdf } from './smartwaiverPdfParser.mjs';

const ROOT = process.cwd();

function loadEnv() {
  for (const name of ['.env', '.env.local']) {
    const filePath = path.join(ROOT, name);
    if (!existsSync(filePath)) continue;
    try {
      for (const line of readFileSync(filePath, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (!m) continue;
        const k = m[1].trim();
        const v = m[2].trim().replace(/^["']|["']$/g, '');
        if (!process.env[k]) process.env[k] = v;
      }
    } catch {
      /* ignore */
    }
  }
}

loadEnv();

const DEFAULT_DIR = path.join(ROOT, 'Waivers');
const BUCKET = process.env.SMARTWAIVER_STORAGE_BUCKET || 'waivers';
const PREFIX = process.env.SMARTWAIVER_STORAGE_PREFIX || 'smartwaiver-imports';
const PDF_DIR = process.env.SMARTWAIVER_PDF_DIR || DEFAULT_DIR;
const BUSINESS_ID = process.env.SMARTWAIVER_BUSINESS_ID || process.env.TAVARI_BUSINESS_ID;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.SMARTWAIVER_DRY_RUN === '1';
const LIMIT = Number.parseInt(process.env.LIMIT || process.env.SMARTWAIVER_LIMIT || '', 10);
const START_INDEX = Math.max(
  0,
  Number.parseInt(process.env.SMARTWAIVER_START_INDEX || process.env.START_INDEX || '0', 10) || 0
);
const SKIP_EXISTING =
  process.env.SMARTWAIVER_SKIP_EXISTING === '1' || process.env.SMARTWAIVER_SKIP_EXISTING === 'true';
const ONLY_PATTERN = process.env.SMARTWAIVER_ONLY_PATTERN || '';
const SKIP_UPLOAD = process.env.SMARTWAIVER_SKIP_UPLOAD === '1';
const USE_SUPABASE_CLI =
  process.env.SMARTWAIVER_USE_SUPABASE_CLI === '1' || (!SERVICE_ROLE_KEY && !DRY_RUN);

function runSupabaseCli(args, { allowEmptyNonZero = false } = {}) {
  const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(bin, ['supabase', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0 && result.stdout && /"rows"\s*:/.test(result.stdout)) {
    return result.stdout.trim();
  }
  if (result.status !== 0 && allowEmptyNonZero && !result.stderr && !result.stdout) {
    return '';
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `supabase ${args.join(' ')} failed`).trim());
  }
  return (result.stdout || '').trim();
}

function runSupabaseSql(sql) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'smartwaiver-sql-'));
  const file = path.join(dir, 'query.sql');
  try {
    writeFileSync(file, sql, 'utf8');
    return runSupabaseCli(['db', 'query', '--linked', '--file', file, '-o', 'json']);
  } catch (error) {
    if (process.env.SMARTWAIVER_KEEP_SQL === '1') {
      throw new Error(`${error.message} (SQL kept at ${file})`);
    }
    throw error;
  } finally {
    if (process.env.SMARTWAIVER_KEEP_SQL !== '1') {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function sqlLiteral(value) {
  if (value == null) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  if (value == null) return 'NULL::jsonb';
  return `${sqlLiteral(JSON.stringify(value))}::jsonb`;
}

function sqlTimestamp(value) {
  return value ? `${sqlLiteral(value)}::timestamptz` : 'NULL';
}

function sqlDate(value) {
  return value ? `${sqlLiteral(value)}::date` : 'NULL';
}

function requireEnv() {
  const missing = [];
  if (!BUSINESS_ID) missing.push('SMARTWAIVER_BUSINESS_ID');
  if (!SUPABASE_URL && !USE_SUPABASE_CLI) missing.push('VITE_SUPABASE_URL or SUPABASE_URL');
  if (!SERVICE_ROLE_KEY && !DRY_RUN && !USE_SUPABASE_CLI) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    throw new Error(`Missing required env var(s): ${missing.join(', ')}`);
  }
}

function sanitizePathPart(value, fallback) {
  return String(value || fallback || 'unknown')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 160);
}

async function listPdfFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listPdfFiles(full);
      out.push(...nested);
    } else if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
      out.push(full);
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  let filtered = out;
  if (ONLY_PATTERN) {
    const re = new RegExp(ONLY_PATTERN, 'i');
    filtered = filtered.filter((f) => re.test(path.basename(f)));
  }
  return Number.isFinite(LIMIT) && LIMIT > 0 ? filtered.slice(0, LIMIT) : filtered;
}

function legacyRowFromParsed(parsed, storagePath, filename) {
  const fallbackName = path.basename(filename, path.extname(filename)).split('_');
  const looksDated = /^\d{4}$/.test(fallbackName[0] || '') && /^\d{2}$/.test(fallbackName[1] || '');
  const fallbackFirst = (looksDated ? fallbackName[4] : fallbackName[3]) || 'Smartwaiver';
  const fallbackLast = (looksDated ? fallbackName[3] : fallbackName[2]) || 'Imported';
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
    path.basename(filename)
  ]
    .filter(Boolean)
    .join(' | ');

  return {
    business_id: BUSINESS_ID,
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
      filename: path.basename(filename),
      documentId: parsed.documentId,
      parseConfidence: parsed.parseConfidence,
      relationship: parsed.relationship,
      raw: parsed.raw,
      rawTextLength: parsed.rawTextLength,
      pageTextPreview: parsed.pageTextPreview
    },
    notes: parsed.relationship ? `Relationship: ${parsed.relationship}` : null,
    info: `Smartwaiver PDF import: ${path.basename(filename)} | ${searchableSummary}`
  };
}

async function uploadPdf(supabase, filePath, buffer, parsed) {
  const id = sanitizePathPart(parsed.documentId || parsed.sha256, path.basename(filePath, '.pdf'));
  const storagePath = `${PREFIX}/${BUSINESS_ID}/${id}.pdf`;
  if (DRY_RUN || SKIP_UPLOAD) return storagePath;

  if (USE_SUPABASE_CLI) {
    runSupabaseCli(
      [
        'storage',
        'cp',
        filePath,
        `ss:///${BUCKET}/${storagePath}`,
        '--content-type',
        'application/pdf',
        '--cache-control',
        'max-age=31536000',
        '--experimental',
        '--linked'
      ],
      { allowEmptyNonZero: true }
    );
    return storagePath;
  }

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: 'application/pdf',
      cacheControl: '31536000',
      upsert: true
    });
  if (error) throw error;
  return storagePath;
}

async function legacyRowExists(supabase, businessId, documentId) {
  if (!supabase || !documentId) return false;
  const { data, error } = await supabase
    .from('legacy_waivers')
    .select('id')
    .eq('business_id', businessId)
    .eq('source_system', 'smartwaiver')
    .eq('external_document_id', documentId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

async function upsertLegacyWaiver(supabase, row) {
  if (DRY_RUN) return { dryRun: true };
  if (USE_SUPABASE_CLI) {
    const cols = [
      'business_id',
      'source_system',
      'external_document_id',
      'legacy_row_id',
      'first_name',
      'last_name',
      'email',
      'phone',
      'date_of_birth',
      'num_minors',
      'legacy_minors',
      'signed_at',
      'created_at',
      'updated_at',
      'imported_pdf_storage_path',
      'imported_pdf_uploaded_at',
      'imported_pdf_sha256',
      'imported_pdf_meta',
      'notes',
      'info'
    ];
    const values = [
      `${sqlLiteral(row.business_id)}::uuid`,
      sqlLiteral(row.source_system),
      sqlLiteral(row.external_document_id),
      row.legacy_row_id == null ? 'NULL' : String(Number(row.legacy_row_id)),
      sqlLiteral(row.first_name),
      sqlLiteral(row.last_name),
      sqlLiteral(row.email),
      sqlLiteral(row.phone),
      sqlDate(row.date_of_birth),
      String(Number(row.num_minors) || 0),
      sqlJson(row.legacy_minors || []),
      sqlTimestamp(row.signed_at),
      sqlTimestamp(row.created_at),
      sqlTimestamp(row.updated_at),
      sqlLiteral(row.imported_pdf_storage_path),
      sqlTimestamp(row.imported_pdf_uploaded_at),
      sqlLiteral(row.imported_pdf_sha256),
      sqlJson(row.imported_pdf_meta || {}),
      sqlLiteral(row.notes),
      sqlLiteral(row.info)
    ];
    const sql = `
      BEGIN;
      DELETE FROM public.legacy_waivers
      WHERE business_id = ${sqlLiteral(row.business_id)}::uuid
        AND source_system = ${sqlLiteral(row.source_system)}
        AND external_document_id = ${sqlLiteral(row.external_document_id)};

      INSERT INTO public.legacy_waivers (${cols.join(', ')})
      VALUES (${values.join(', ')})
      RETURNING id, external_document_id, 'created'::text AS action;
      COMMIT;
    `;
    const output = runSupabaseSql(sql);
    try {
      const parsed = JSON.parse(output);
      return parsed?.rows?.[0] || { action: 'saved' };
    } catch {
      return { action: 'saved' };
    }
  }

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

async function main() {
  requireEnv();
  const supabase = DRY_RUN || USE_SUPABASE_CLI
    ? null
    : createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      });

  const files = await listPdfFiles(PDF_DIR);
  const total = files.length;
  console.log(`[smartwaiver] Found ${total} PDF(s) in ${PDF_DIR}`);
  if (START_INDEX > 0) console.log(`[smartwaiver] Resuming at index ${START_INDEX}`);
  if (SKIP_EXISTING) console.log('[smartwaiver] SMARTWAIVER_SKIP_EXISTING=1 — skip rows already in legacy_waivers');
  if (DRY_RUN) console.log('[smartwaiver] DRY_RUN=1, no uploads or DB writes will occur');
  if (USE_SUPABASE_CLI && !DRY_RUN) console.log('[smartwaiver] Using linked Supabase CLI for Storage + DB writes');

  let ok = 0;
  let failed = 0;
  let skipped = 0;
  for (let i = START_INDEX; i < files.length; i++) {
    const file = files[i];
    const base = path.basename(file);
    try {
      const quickDocId = documentIdFromFilename(base);
      if (SKIP_EXISTING && quickDocId && (await legacyRowExists(supabase, BUSINESS_ID, quickDocId))) {
        skipped++;
        if ((i + 1) % 500 === 0 || i === START_INDEX) {
          console.log(`[${i + 1}/${total}] skip existing ${base} (${quickDocId})`);
        }
        continue;
      }

      const buffer = await fs.readFile(file);
      const parsed = await parseSmartwaiverPdf(buffer, { filename: base });
      if (!parsed.documentId) {
        throw new Error('Could not determine Smartwaiver Document ID');
      }
      const storagePath = await uploadPdf(supabase, file, buffer, parsed);
      const row = legacyRowFromParsed(parsed, storagePath, file);
      const saved = await upsertLegacyWaiver(supabase, row);
      ok++;
      if (ok % 100 === 0 || ok <= 5) {
        console.log(
          `[${i + 1}/${total}] ok ${base} -> ${parsed.documentId} (${parsed.parseConfidence}%) ${saved?.action || 'dry-run'} ${saved?.id || ''}`
        );
      }
    } catch (error) {
      failed++;
      const msg = error?.message || String(error);
      console.error(`[${i + 1}/${total}] failed ${file}:`, msg);
      if (/fetch failed|ECONNRESET|ETIMEDOUT|network/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  console.log(
    `[smartwaiver] complete: ok=${ok} skipped=${skipped} failed=${failed} (next START_INDEX=${START_INDEX + ok + skipped + failed})`
  );
  if (failed > 0) {
    console.warn(`[smartwaiver] ${failed} file(s) failed — re-run with SMARTWAIVER_SKIP_EXISTING=1 to retry`);
  }
}

main().catch((error) => {
  console.error('[smartwaiver] fatal:', error);
  process.exit(1);
});
