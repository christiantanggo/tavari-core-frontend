/**
 * Batched DELETE for tavari_admin_security_logs (Music-related rows only).
 * Run from repo root: node scripts/delete-music-security-log-batches.mjs
 *
 * Phase A: event_type = music_dashboard_access
 * Phase B: user_action + music_dashboard_view / music_tab_navigation
 *
 * Env:
 *   BATCH_SIZE (default 10000), MAX_ITERS (default 5000)
 *   SLEEP_MS — pause between batches (default 750) to avoid pooler ECIRCUITBREAKER
 *   PHASE — a | b | all (default all). Use PHASE=b to resume after a partial run.
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
const BATCH = Number(process.env.BATCH_SIZE || 10000);
const MAX_ITERS = Number(process.env.MAX_ITERS || 5000);
const SLEEP_MS = Number(process.env.SLEEP_MS ?? 750);
const PHASE = String(process.env.PHASE || 'all').toLowerCase();

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
  const tmp = join(tmpdir(), `tavari-del-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
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

/** Retries on pooler circuit breaker / transient CLI connection errors. */
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

async function runPhase(name, sqlDeleteBody) {
  let total = 0;
  for (let i = 0; i < MAX_ITERS; i++) {
    const sql = `WITH deleted AS (
${sqlDeleteBody}
  RETURNING 1
)
SELECT count(*)::bigint AS deleted FROM deleted;`;
    const row = await query(sql);
    const n = Number(row?.deleted ?? 0);
    total += n;
    console.log(`${name} batch ${i + 1}: deleted ${n} (phase total ${total})`);
    if (n === 0) break;
    if (SLEEP_MS > 0 && n > 0) await delay(SLEEP_MS);
  }
  console.log(`${name} done. Rows deleted: ${total}`);
  return total;
}

const bodyA = `  DELETE FROM public.tavari_admin_security_logs
  WHERE ctid IN (
    SELECT ctid FROM public.tavari_admin_security_logs
    WHERE event_type = 'music_dashboard_access'
    LIMIT ${BATCH}
  )`;

const bodyB = `  DELETE FROM public.tavari_admin_security_logs
  WHERE ctid IN (
    SELECT ctid FROM public.tavari_admin_security_logs
    WHERE event_type = 'user_action'
      AND COALESCE(details->>'data_action', '')
          IN ('music_dashboard_view', 'music_tab_navigation')
    LIMIT ${BATCH}
  )`;

async function main() {
  console.log(
    `Batch size ${BATCH}, max iterations per phase ${MAX_ITERS}, sleep ${SLEEP_MS}ms between batches, PHASE=${PHASE}`,
  );
  let a = 0;
  let b = 0;
  if (PHASE === 'all' || PHASE === 'a') {
    a = await runPhase('Phase A (music_dashboard_access)', bodyA);
  } else {
    console.log('Skipping Phase A (set PHASE=all or PHASE=a to run).');
  }
  if (PHASE === 'all' || PHASE === 'b') {
    b = await runPhase('Phase B (user_action music views)', bodyB);
  } else {
    console.log('Skipping Phase B (set PHASE=all or PHASE=b to run).');
  }
  console.log(`Finished. Phase A=${a}, Phase B=${b}, combined=${a + b}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
