/**
 * Batched DELETE for public.tavari_admin_security_logs by age (frees disk after VACUUM).
 *
 * Usage (repo root):
 *   npm run prune:security-logs
 *
 * Env:
 *   RETENTION_DAYS — keep rows newer than this (default: 45; matches DB retention)
 *   BATCH_SIZE — rows per DELETE (default: 5000)
 *   MAX_ITERS — safety cap on batches (default: 5000)
 *   SLEEP_MS — pause between batches (default: 800) to avoid pooler ECIRCUITBREAKER
 *   DRY_RUN — if "1", only prints the cutoff SQL and exits
 */
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { setTimeout as delay } from 'timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const RETENTION_DAYS = Math.max(1, Number(process.env.RETENTION_DAYS || 45));
const BATCH = Math.max(100, Number(process.env.BATCH_SIZE || 5000));
const MAX_ITERS = Number(process.env.MAX_ITERS || 5000);
const SLEEP_MS = Number(process.env.SLEEP_MS ?? 800);
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

/** Supabase CLI may print noise then JSON, or multiple JSON objects — parse only the first top-level `{...}`. */
function extractFirstJsonObject(raw) {
  const start = raw.indexOf('{');
  if (start === -1) throw new Error('No JSON object in CLI output');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (inStr) {
      if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  throw new Error('Unbalanced JSON in CLI output');
}

function queryOnce(sql) {
  const tmp = join(tmpdir(), `tavari-prune-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(tmp, sql, 'utf8');
  try {
    const out = execSync(`npx supabase db query --linked --file "${tmp}" -o json`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    });
    const j = JSON.parse(extractFirstJsonObject(out));
    return j.rows?.[0];
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

async function query(sql) {
  let lastErr;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      return queryOnce(sql);
    } catch (e) {
      const msg = String(e?.stderr || e?.message || e || '');
      lastErr = e;
      const retryable =
        msg.includes('ECIRCUITBREAKER') ||
        msg.includes('too many authentication failures') ||
        msg.includes('temporarily blocked') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT');
      if (!retryable || attempt === 8) throw e;
      const wait = Math.min(120_000, 5000 * 2 ** (attempt - 1));
      console.warn(`  (retry ${attempt}/8 after ${wait}ms) ${msg.split('\n')[0]?.slice(0, 120)}…`);
      await delay(wait);
    }
  }
  throw lastErr;
}

async function main() {
  const cutoffSql = `(NOW() - INTERVAL '${RETENTION_DAYS} days')`;
  console.log(
    `Retention: keep rows where created_at >= ${cutoffSql.replace(/^\(|\)$/g, '')}; batch ${BATCH}, sleep ${SLEEP_MS}ms, max iters ${MAX_ITERS}`,
  );

  if (DRY_RUN) {
    console.log('DRY_RUN=1 — not deleting. One batch would run:');
    console.log(`SELECT public.prune_security_logs_retention(${RETENTION_DAYS}, ${BATCH}) AS deleted;`);
    return;
  }

  let total = 0;
  for (let i = 0; i < MAX_ITERS; i++) {
    // Must use SECURITY DEFINER RPC: table has RLS and no DELETE policy — direct DELETE via CLI role deletes 0 rows.
    const sql = `SELECT public.prune_security_logs_retention(${RETENTION_DAYS}, ${BATCH})::bigint AS deleted;`;

    const row = await query(sql);
    const n = Number(row?.deleted ?? 0);
    total += n;
    console.log(`batch ${i + 1}: deleted ${n} (running total ${total})`);
    if (n === 0) break;
    if (SLEEP_MS > 0) await delay(SLEEP_MS);
  }

  console.log(`Done. Total rows deleted: ${total}`);
  console.log(
    'Reclaim file space: set SUPABASE_DB_PASSWORD or DATABASE_URL, then run  npm run vacuum:security-logs  (VACUUM needs a direct session; use VACUUM FULL only in a maintenance window for maximum shrink).',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
