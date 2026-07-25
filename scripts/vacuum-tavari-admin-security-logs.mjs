/**
 * Run VACUUM ANALYZE on public.tavari_admin_security_logs using a direct Postgres
 * connection so it is not killed by Supabase SQL Editor / API statement timeouts.
 *
 * PostgreSQL does NOT support batched VACUUM — one DELETE can be chunked, but VACUUM
 * is always a single table pass. Use a session with statement_timeout disabled.
 *
 * Setup (pick one):
 *   A) Full URI — PowerShell (session only):
 *        $env:DATABASE_URL = "postgresql://postgres.[ref]:[PASSWORD]@....pooler.supabase.com:5432/postgres"
 *   B) Password only — same database as `supabase link` for this repo:
 *        $env:SUPABASE_DB_PASSWORD = '(Project Settings → Database → password)'
 *      Uses host/user from supabase/.temp/pooler-url with port 5432 (session pooler).
 *
 * Run:
 *   npm run vacuum:security-logs
 *
 * Optional env:
 *   VACUUM_ONLY=1          → VACUUM without ANALYZE
 *   VACUUM_COST_DELAY=10   → milliseconds; slow down VACUUM to reduce IO spike
 *   POSTGRES_SSL_STRICT=1  → verify TLS strictly (default: allow self-signed / MITM quirks like some AV tools)
 */
import pg from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function buildUrlFromLinkedPoolerTemplate(password) {
  const poolerPath = join(root, 'supabase', '.temp', 'pooler-url');
  if (!existsSync(poolerPath)) return null;
  let raw = readFileSync(poolerPath, 'utf8').trim();
  const encoded = encodeURIComponent(password);
  if (raw.includes('[YOUR-PASSWORD]')) {
    raw = raw.replace('[YOUR-PASSWORD]', encoded);
  } else {
    raw = raw.replace(/:[^:@]+@/, `:${encoded}@`);
  }
  const u = new URL(raw);
  u.port = '5432';
  // TLS handled via pg.Client `ssl` so we avoid sslmode + Node verify-full / chain issues on Windows.
  u.searchParams.delete('sslmode');
  return u.toString();
}

function resolveConnectionString() {
  const direct =
    process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.DIRECT_URL;
  if (direct) return direct;
  const pw = process.env.SUPABASE_DB_PASSWORD;
  if (pw) {
    const built = buildUrlFromLinkedPoolerTemplate(pw);
    if (built) return built;
  }
  return null;
}

const url = resolveConnectionString();

if (!url) {
  console.error(
    [
      'No database connection configured.',
      '',
      'Either set DATABASE_URL (direct Postgres URI, port 5432 / session pooler),',
      'or set SUPABASE_DB_PASSWORD for this repo’s linked project (uses supabase/.temp/pooler-url).',
      'Password: Supabase Dashboard → Project Settings → Database.',
    ].join('\n'),
  );
  process.exit(1);
}

const vacuumOnly = process.env.VACUUM_ONLY === '1' || process.env.VACUUM_ONLY === 'true';
const costDelay = process.env.VACUUM_COST_DELAY;
const sslStrict = process.env.POSTGRES_SSL_STRICT === '1' || process.env.POSTGRES_SSL_STRICT === 'true';

async function main() {
  let connectionString = url;
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    connectionString = u.toString();
  } catch {
    /* keep raw url */
  }

  const client = new pg.Client({
    connectionString,
    ssl: sslStrict ? { rejectUnauthorized: true } : { rejectUnauthorized: false },
    connectionTimeoutMillis: 120_000,
  });

  await client.connect();
  try {
    await client.query('SET statement_timeout = 0');
    await client.query('SET lock_timeout = 0');

    if (costDelay != null && costDelay !== '') {
      await client.query(`SET vacuum_cost_delay = '${Number(costDelay)}ms'`);
      console.log(`Using vacuum_cost_delay = ${costDelay}ms`);
    }

    const sql = vacuumOnly
      ? 'VACUUM public.tavari_admin_security_logs'
      : 'VACUUM ANALYZE public.tavari_admin_security_logs';

    console.log(`Running: ${sql}`);
    console.log('(This may take many minutes on a large table — wait until it finishes.)');
    const start = Date.now();
    await client.query(sql);
    console.log(`Done in ${Math.round((Date.now() - start) / 1000)}s`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
