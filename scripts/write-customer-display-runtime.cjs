/**
 * Writes build/electron/customer-display-runtime.json from .env (VITE_SUPABASE_*).
 * Required for customer display .exe pairing (anon redeem RPC). Gitignored.
 * Used by build-customer-display.cjs and optionally before local Electron dev.
 */
const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  const env = { ...process.env };
  if (!fs.existsSync(envPath)) return env;
  const text = fs.readFileSync(envPath, 'utf8');
  text.split(/\r?\n/).forEach(function (line) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) return;
    let v = m[2].trim();
    if (
      (v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') ||
      (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'")
    ) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  });
  return env;
}

function main() {
  const env = loadEnvFile();
  const supabaseUrl = (env.VITE_SUPABASE_URL || '').trim();
  const supabaseAnonKey = (env.VITE_SUPABASE_ANON_KEY || '').trim();
  const outPath = path.join(__dirname, '..', 'build', 'electron', 'customer-display-runtime.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify({ supabaseUrl, supabaseAnonKey }, null, 2),
    'utf8'
  );
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
      '[customer-display-runtime] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing — pairing in the .exe will not work until .env is set and you rebuild.'
    );
  } else {
    console.log('[customer-display-runtime] wrote', outPath);
  }
}

main();
