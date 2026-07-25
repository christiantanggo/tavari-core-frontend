/**
 * Stream-parse wallkids `waivers` MySQL dump and upsert into public.legacy_waivers.
 *
 * env (one of):
 *   - SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL: upload via PostgREST
 *   - USE_DB_CLI=1: `npx supabase db query --linked -f` (no service role; uses linked project DB)
 * env: CLI_BATCH=30  (rows per statement when using USE_DB_CLI; lower if payloads are large)
 *
 * Usage:
 *   node scripts/import-wallkids-waivers.mjs <business_uuid> [path/to/waivers.sql]
 *   DRY_RUN=1 node ...   # parse only, no writes
 *   MAX_ROWS=5000 node ... # cap for testing
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, createReadStream, writeFileSync, unlinkSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const INSERT_MARKER = 'INSERT INTO `waivers` VALUES';
const EXPECT_COLS = 17;

function loadEnv() {
  for (const name of ['.env', '.env.local']) {
    try {
      const raw = readFileSync(join(root, name), 'utf8');
      for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (!m) continue;
        const k = m[1].trim();
        const v = m[2].trim().replace(/^["']|["']$/g, '');
        if (!process.env[k]) process.env[k] = v;
      }
    } catch {
      /* */
    }
  }
}

loadEnv();

const DRY = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const MAX_ROWS = process.env.MAX_ROWS ? parseInt(process.env.MAX_ROWS, 10) : Number.POSITIVE_INFINITY;
const useDbCli =
  !DRY &&
  (process.env.USE_DB_CLI === '1' || process.env.USE_DB_CLI === 'true' || process.env.IMPORT_VIA_SUPABASE_CLI === '1');

const businessId = process.env.BUSINESS_ID || process.argv[2];
const inputPath = resolve(process.argv[3] || join(root, 'Waivers', 'waivers.sql'));
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!businessId) {
  console.error('Usage: node scripts/import-wallkids-waivers.mjs <business_uuid> [path/to/waivers.sql]');
  process.exit(1);
}
if (!DRY && !useDbCli && (!supabaseUrl || !serviceKey)) {
  console.error(
    'Set SUPABASE_SERVICE_ROLE_KEY (and VITE_SUPABASE_URL), or run with USE_DB_CLI=1 to use: npx supabase db query --linked',
  );
  process.exit(1);
}
if (DRY) {
  console.log('DRY_RUN: no database writes');
} else if (useDbCli) {
  console.log('USE_DB_CLI: applying batched SQL via npx supabase db query --linked');
}

const supabase =
  !DRY && !useDbCli && supabaseUrl && serviceKey
    ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    : null;

/** @param {string} s @param {number} i */
function parseMysqlString(s, i) {
  if (s[i] !== "'") return null;
  let p = i + 1;
  let out = '';
  while (p < s.length) {
    const c = s[p];
    if (c === '\\' && p + 1 < s.length) {
      out += s[p + 1];
      p += 2;
      continue;
    }
    if (c === "'") {
      if (p + 1 < s.length && s[p + 1] === "'") {
        out += "'";
        p += 2;
        continue;
      }
      p++;
      return { str: out, pos: p };
    }
    out += c;
    p++;
  }
  return null;
}

/**
 * Semicolon that ends a statement at depth 0, outside strings
 * @param {string} s
 * @param {number} start
 */
function findStatementEnd(s, start) {
  let i = start;
  let inString = false;
  let paren = 0;

  while (i < s.length) {
    const c = s[i];
    if (inString) {
      if (c === '\\' && i + 1 < s.length) {
        i += 2;
        continue;
      }
      if (c === "'") {
        if (i + 1 < s.length && s[i + 1] === "'") {
          i += 2;
          continue;
        }
        inString = false;
        i++;
        continue;
      }
      i++;
      continue;
    }
    if (c === "'") {
      inString = true;
      i++;
      continue;
    }
    if (c === '(') paren++;
    if (c === ')') paren--;
    if (c === ';' && paren === 0) return i + 1;
    i++;
  }
  return -1;
}

/**
 * @param {string} inner
 */
function parseValueRow(inner) {
  const out = [];
  let i = 0;
  let iter = 0;
  const max = inner.length;
  while (i < max) {
    while (i < max && /\s/.test(inner[i])) i++;
    if (i >= max) break;

    if (i + 4 <= max && inner.slice(i, i + 4) === 'NULL' && (i + 4 >= max || /[^A-Za-z0-9_]/.test(inner[i + 4]))) {
      out.push(null);
      i += 4;
    } else if (inner[i] === "'") {
      const st = parseMysqlString(inner, i);
      if (!st) throw new Error(`unterminated string at col ${out.length} offset ${i}`);
      out.push(st.str);
      i = st.pos;
    } else if (inner[i] === '-' || (inner[i] >= '0' && inner[i] <= '9')) {
      const rest = inner.slice(i);
      const m = rest.match(/^-?(?:[0-9]+(?:\.[0-9]+)?(?:[eE][+\-]?[0-9]+)?)/);
      if (!m) throw new Error(`expected number at ${i}`);
      const raw = m[0];
      out.push(/[.]/.test(raw) || /[eE]/.test(raw) ? parseFloat(raw) : parseInt(raw, 10));
      i += raw.length;
    } else {
      throw new Error(`unexpected at col ${out.length} offset ${i} near: ${inner.slice(i, i + 40)}`);
    }

    while (i < max && /\s/.test(inner[i])) i++;
    if (i < max) {
      if (inner[i] === ',') i++;
      else {
        if (i === max) break;
        if (i + 1 === max) break; // end of inner
        throw new Error(`expected , at ${i} after value ${iter}`);
      }
    }
    iter++;
  }

  if (out.length !== EXPECT_COLS) {
    throw new Error(`expected ${EXPECT_COLS} values, got ${out.length} (row sample end: ${inner.slice(-200)})`);
  }
  return out;
}

/**
 * @param {string} body VALUES clause content after "VALUES" (not including "VALUES" word)
 * @yields {any[]}
 */
function* eachTupleFromValuesBody(body) {
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i++;
    if (i >= body.length) break;
    if (body[i] === ',') {
      i++;
      continue;
    }
    if (body[i] !== '(') break;

    const innerStart = i + 1;
    let d = 1;
    i++;
    let inS = false;
    while (i < body.length && d > 0) {
      const c = body[i];
      if (inS) {
        if (c === '\\' && i + 1 < body.length) {
          i += 2;
          continue;
        }
        if (c === "'") {
          if (i + 1 < body.length && body[i + 1] === "'") {
            i += 2;
            continue;
          }
          inS = false;
        }
        i++;
        continue;
      }
      if (c === "'") {
        inS = true;
        i++;
        continue;
      }
      if (c === '(') d++;
      if (c === ')') d--;
      i++;
    }
    if (d !== 0) throw new Error('unbalanced parens in VALUES list');
    const inner = body.slice(innerStart, i - 1);
    yield parseValueRow(inner);
  }
}

/**
 * @param {string} stmt
 */
function* iterRowsFromInsertStatement(stmt) {
  const u = stmt.toUpperCase();
  const vIdx = u.indexOf('VALUES');
  if (vIdx === -1) return;
  let from = vIdx + 'VALUES'.length;
  while (from < stmt.length && /\s/.test(stmt[from])) from++;
  const lastSemi = stmt.lastIndexOf(';');
  const to = lastSemi > vIdx ? lastSemi : stmt.length;
  if (from >= to) return;
  const body = stmt.slice(from, to);
  yield* eachTupleFromValuesBody(body);
}

function mysqlTsToIso(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '' || s === '0000-00-00' || s.startsWith('0000-00-00 00:00:00') || s.startsWith('0000-00-00')) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T12:00:00.000Z`;
  if (/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}:\d{2}/.test(s)) {
    return new Date(s.replace(' ', 'T')).toISOString();
  }
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

function toNonEmptyText(v) {
  if (v == null) return null;
  const t = String(v);
  return t.trim() === '' ? null : t;
}

function mapToLegacy(mysql) {
  const [
    id,
    firstname,
    lastname,
    email,
    signature,
    DOB,
    user_id,
    location_id,
    num_minors,
    notes,
    deleted_at,
    created_at,
    updated_at,
    phone,
    info,
    waiver_template_id,
    customer_id,
  ] = mysql;

  const signed = mysqlTsToIso(updated_at) || mysqlTsToIso(created_at) || '1970-01-01T00:00:00.000Z';
  return {
    business_id: businessId,
    source_system: 'wallkids',
    legacy_row_id: id,
    first_name: firstname,
    last_name: lastname,
    email: toNonEmptyText(email),
    phone: toNonEmptyText(phone),
    date_of_birth: /^\d{4}-\d{2}-\d{2}/.test(String(DOB)) ? String(DOB).slice(0, 10) : (mysqlTsToIso(DOB)?.slice(0, 10) ?? null),
    signature_strokes: signature != null ? String(signature) : null,
    notes: notes != null ? String(notes) : null,
    info: toNonEmptyText(info),
    num_minors: Math.max(0, Math.floor(Number(num_minors) || 0)),
    legacy_user_id: user_id,
    legacy_location_id: location_id,
    legacy_waiver_template_id: waiver_template_id,
    legacy_customer_id: customer_id,
    signed_at: signed,
    created_at: mysqlTsToIso(created_at),
    updated_at: mysqlTsToIso(updated_at),
    deleted_at: mysqlTsToIso(deleted_at),
  };
}

// --- Batched SQL for USE_DB_CLI (npx supabase db query --linked) ---

function sqlEscape(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function sqlStrOrNull(v) {
  if (v === null || v === undefined) return 'NULL';
  if (String(v) === '') return 'NULL';
  return sqlEscape(v);
}

function sqlIntOrNull(v) {
  if (v === null || v === undefined) return 'NULL';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'NULL';
  return String(Math.trunc(n));
}

function sqlTsOrNull(t) {
  if (t == null) return 'NULL';
  return `(${sqlEscape(t)}::timestamptz)`;
}

function buildBatchSql(rows) {
  const valueLines = rows
    .map(
      (r) =>
        `  (${sqlEscape(businessId)}, 'wallkids', ${String(r.legacy_row_id)}::bigint, ` +
        `${sqlEscape(r.first_name || 'Unknown')}, ` +
        `${sqlEscape(r.last_name || 'Unknown')}, ` +
        `${sqlStrOrNull(r.email)}, ` +
        `${sqlStrOrNull(r.phone)}, ` +
        `${r.date_of_birth ? `(${sqlEscape(r.date_of_birth)}::date)` : 'NULL'}, ` +
        `${sqlStrOrNull(r.signature_strokes)}, ` +
        `${sqlStrOrNull(r.notes)}, ` +
        `${sqlStrOrNull(r.info)}, ` +
        `${Math.max(0, Math.floor(Number(r.num_minors) || 0))}::int, ` +
        `${sqlIntOrNull(r.legacy_user_id)}, ` +
        `${sqlIntOrNull(r.legacy_location_id)}, ` +
        `${r.legacy_waiver_template_id == null ? 'NULL' : String(Math.trunc(Number(r.legacy_waiver_template_id)))}::int, ` +
        `${r.legacy_customer_id == null ? 'NULL' : String(Math.trunc(Number(r.legacy_customer_id)))}::int, ` +
        `${sqlTsOrNull(r.signed_at)}, ` +
        `${sqlTsOrNull(r.created_at)}, ` +
        `${sqlTsOrNull(r.updated_at)}, ` +
        `${sqlTsOrNull(r.deleted_at)}, ` +
        `now())`,
    )
    .join(',\n');

  return `INSERT INTO public.legacy_waivers (
  business_id, source_system, legacy_row_id, first_name, last_name, email, phone, date_of_birth,
  signature_strokes, notes, info, num_minors, legacy_user_id, legacy_location_id,
  legacy_waiver_template_id, legacy_customer_id, signed_at, created_at, updated_at, deleted_at, imported_at
) VALUES
${valueLines}
ON CONFLICT (business_id, source_system, legacy_row_id) DO UPDATE SET
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  email = EXCLUDED.email,
  phone = EXCLUDED.phone,
  date_of_birth = EXCLUDED.date_of_birth,
  signature_strokes = EXCLUDED.signature_strokes,
  notes = EXCLUDED.notes,
  info = EXCLUDED.info,
  num_minors = EXCLUDED.num_minors,
  legacy_user_id = EXCLUDED.legacy_user_id,
  legacy_location_id = EXCLUDED.legacy_location_id,
  legacy_waiver_template_id = EXCLUDED.legacy_waiver_template_id,
  legacy_customer_id = EXCLUDED.legacy_customer_id,
  signed_at = EXCLUDED.signed_at,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at,
  deleted_at = EXCLUDED.deleted_at,
  imported_at = now();
`;
}

function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runSupabaseDbQueryFileOnce(sqlPath) {
  if (process.platform === 'win32') {
    execFileSync('cmd.exe', ['/c', 'npx', 'supabase', 'db', 'query', '--linked', '-f', sqlPath], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
  } else {
    execFileSync('npx', ['supabase', 'db', 'query', '--linked', '-f', sqlPath], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
  }
}

async function runSupabaseDbQueryFile(sqlPath) {
  const max = parseInt(process.env.SUPABASE_QUERY_RETRIES || '5', 10);
  for (let a = 0; a < max; a++) {
    try {
      runSupabaseDbQueryFileOnce(sqlPath);
      return;
    } catch (e) {
      if (a === max - 1) throw e;
      const wait = 2000 * (a + 1);
      console.error(`db query failed (attempt ${a + 1}/${max}), retrying in ${wait}ms...`, (e && e.message) || e);
      await sleepMs(wait);
    }
  }
}

async function flushDbCli(b) {
  const sqlPath = join(
    tmpdir(),
    `legacy-w-import-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`,
  );
  try {
    writeFileSync(sqlPath, buildBatchSql(b), 'utf8');
    await runSupabaseDbQueryFile(sqlPath);
    const throttle = parseInt(process.env.CLI_THROTTLE_MS || '0', 10);
    if (throttle > 0) await sleepMs(throttle);
  } finally {
    try {
      unlinkSync(sqlPath);
    } catch {
      /* */
    }
  }
}

const BATCH = useDbCli ? parseInt(process.env.CLI_BATCH || '30', 10) : 200;

async function main() {
  const s = createReadStream(inputPath, { encoding: 'utf8', highWaterMark: 2 * 1024 * 1024 });
  let buf = '';
  let batch = [];
  let doneCount = 0;
  let hitMax = false;
  outer: for await (const chunk of s) {
    buf += chunk;
    for (;;) {
      const at = buf.indexOf(INSERT_MARKER);
      if (at === -1) {
        if (buf.length > 20 * 1024 * 1024) {
          const last = buf.lastIndexOf(INSERT_MARKER);
          buf = last < 0 ? buf.slice(-6 * 1024 * 1024) : buf.slice(last);
        }
        break;
      }
      const end = findStatementEnd(buf, at);
      if (end < 0) break;
      const stmt = buf.slice(at, end);
      buf = buf.slice(end);
      for (const row of iterRowsFromInsertStatement(stmt)) {
        if (doneCount + batch.length >= MAX_ROWS) {
          hitMax = true;
          s.destroy();
          break outer;
        }
        batch.push(mapToLegacy(row));
        if (batch.length >= BATCH) {
          if (DRY) {
            doneCount += batch.length;
            batch = [];
            if (doneCount % 20000 === 0) console.log('DRY:', doneCount, '...');
          } else if (useDbCli) {
            const b = batch.splice(0, BATCH);
            try {
              await flushDbCli(b);
            } catch (e) {
              console.error('db query failed:', e);
              process.exit(1);
            }
            doneCount += b.length;
            if (doneCount % 5000 < BATCH) process.stdout.write(`\rimported ${doneCount}   `);
          } else {
            const b = batch.splice(0, BATCH);
            const { error } = await supabase.from('legacy_waivers').upsert(b, {
              onConflict: 'business_id,source_system,legacy_row_id',
            });
            if (error) {
              console.error('Upsert failed:', error);
              process.exit(1);
            }
            doneCount += b.length;
            if (doneCount % 5000 < BATCH) process.stdout.write(`\rimported ${doneCount}   `);
          }
        }
      }
    }
  }

  if (batch.length) {
    if (DRY) {
      doneCount += batch.length;
    } else if (useDbCli) {
      try {
        await flushDbCli(batch);
        doneCount += batch.length;
      } catch (e) {
        console.error('db query (final) failed:', e);
        process.exit(1);
      }
    } else {
      const { error } = await supabase.from('legacy_waivers').upsert(batch, {
        onConflict: 'business_id,source_system,legacy_row_id',
      });
      if (error) {
        console.error('Final upsert failed:', error);
        process.exit(1);
      }
      doneCount += batch.length;
    }
  }
  if (!hitMax && buf.includes(INSERT_MARKER) && findStatementEnd(buf, buf.indexOf(INSERT_MARKER)) < 0) {
    console.error('Warning: unterminated INSERT left in buffer (incomplete file?)');
  }
  console.log();
  console.log(
    DRY
      ? `DRY: parsed ${doneCount} row(s) from ${inputPath}`
      : `Done. Upserted ${doneCount} row(s). business: ${businessId}${useDbCli ? ' (USE_DB_CLI)' : ''}`,
  );
}

await main();
