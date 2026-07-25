/**
 * Apply hr_training kiosk_sign_in_required migration via direct Postgres when db push is blocked.
 *
 * Run from repo root (uses .env SUPABASE_DB_PASSWORD or DATABASE_URL if set):
 *   node scripts/apply-hr-training-kiosk-sign-in-migration.mjs
 */
import 'dotenv/config';
import pg from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const migrationPath = join(
  root,
  'supabase',
  'migrations',
  '20260630150000_hr_training_kiosk_sign_in_required.sql',
);

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
  u.searchParams.delete('sslmode');
  return u.toString();
}

function resolveConnectionString() {
  const direct = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.DIRECT_URL;
  if (direct) return direct;
  const pw = process.env.SUPABASE_DB_PASSWORD;
  if (pw) {
    const built = buildUrlFromLinkedPoolerTemplate(pw);
    if (built) return built;
  }
  return null;
}

async function main() {
  const url = resolveConnectionString();
  if (!url) {
    console.error('Set SUPABASE_DB_PASSWORD or DATABASE_URL, then re-run.');
    process.exit(1);
  }
  if (!existsSync(migrationPath)) {
    console.error('Migration file not found:', migrationPath);
    process.exit(1);
  }

  const sql = readFileSync(migrationPath, 'utf8');
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query(sql);
    await client.query(
      "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING",
      ['20260630150000', 'hr_training_kiosk_sign_in_required'],
    );
    await client.query("NOTIFY pgrst, 'reload schema';");
    console.log('Applied migration:', migrationPath);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
