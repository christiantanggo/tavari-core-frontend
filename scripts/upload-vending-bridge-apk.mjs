/**
 * Upload Tavari Vending Bridge APK to Supabase public storage.
 * Usage: node scripts/upload-vending-bridge-apk.mjs [path-to.apk]
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv() {
  try {
    const raw = readFileSync(resolve(root, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (process.env[key] == null) process.env[key] = val;
    }
  } catch {
    /* no .env */
  }
}

loadDotEnv();

const VERSION = '1.0.17';
const FILENAME = `Tavari-Vending-Bridge-${VERSION}.apk`;
const BUCKET = 'vending-installers';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

const apkPath =
  process.argv[2] ||
  resolve(root, `vending-bridge/dist/Tavari-Vending-Bridge-${VERSION}.apk`);

if (!supabaseUrl || !serviceKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

if (!existsSync(apkPath)) {
  console.error(`APK not found: ${apkPath}`);
  console.error('Build first: npm run vending-bridge:build');
  process.exit(1);
}

const body = readFileSync(apkPath);
const uploadUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${BUCKET}/${FILENAME}`;

const res = await fetch(uploadUrl, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/vnd.android.package-archive',
    'x-upsert': 'true'
  },
  body
});

const text = await res.text();
if (!res.ok) {
  console.error('Upload failed', res.status, text);
  process.exit(1);
}

const publicUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${FILENAME}`;
console.log('Uploaded:', FILENAME, `(${body.length} bytes)`);
console.log('Public URL:', publicUrl);
console.log('Tablet page:', `${process.env.VITE_APP_ORIGIN || 'https://www.tavarios.ca'}/vending/download`);
