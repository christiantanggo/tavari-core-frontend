/**
 * One-off: copy OTWK site_settings menu config into Tavari business_website_menu.
 *
 * Reads menu_source + menu_sections from OTWK site_settings via linked Supabase CLI.
 *
 * Usage (from tavari-core-frontend root):
 *   node scripts/migrate-otwk-menu-to-tavari.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const otwkRoot = path.resolve(root, '../../OTWK - Website Rebuild');

loadEnv({ path: path.join(root, '.env') });

const TAVARI_BUSINESS_ID = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const DEFAULT_MENU_PDF_URL = 'https://www.offthewallkids.ca/public_files/WebsitePriceList.pdf';

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in tavari-core-frontend/.env`);
  return value;
}

function runOtwkQuery(sql) {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'otwk-menu-'));
  const sqlPath = path.join(tempDir, 'query.sql');
  writeFileSync(sqlPath, sql, 'utf8');
  try {
    const output = execFileSync(
      'npx',
      ['supabase', 'db', 'query', '--linked', '--file', sqlPath, '-o', 'json'],
      { cwd: otwkRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, shell: true },
    );
    const jsonStart = output.indexOf('{');
    if (jsonStart < 0) throw new Error('OTWK query returned no JSON');
    return JSON.parse(output.slice(jsonStart));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function fetchOtwkMenuSettings() {
  const sql = [
    "SELECT key, value FROM public.site_settings",
    "WHERE key IN ('menu_source', 'menu_sections')",
    "ORDER BY key;",
  ].join('\n');
  const payload = runOtwkQuery(sql);
  const out = { menu_source: 'api', menu_sections: [] };
  for (const row of payload.rows ?? []) {
    if (row.key === 'menu_source') {
      out.menu_source = String(row.value || 'api').trim().toLowerCase() === 'manual' ? 'manual' : 'api';
    }
    if (row.key === 'menu_sections') {
      try {
        const parsed = JSON.parse(String(row.value || '[]'));
        if (Array.isArray(parsed)) out.menu_sections = parsed;
      } catch {
        out.menu_sections = [];
      }
    }
  }
  return out;
}

async function main() {
  const tavariBase = requireEnv('SUPABASE_URL');
  const tavariServiceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const tavari = createClient(tavariBase, tavariServiceKey);

  const otwkMenu = fetchOtwkMenuSettings();
  if (!otwkMenu.menu_sections.length) {
    console.warn('OTWK menu_sections is empty — run scripts/setup-tavari-menu.mjs on OTWK first.');
  }

  const row = {
    business_id: TAVARI_BUSINESS_ID,
    menu_source: otwkMenu.menu_source,
    menu_sections: otwkMenu.menu_sections,
    menu_pdf_url: DEFAULT_MENU_PDF_URL,
    updated_at: new Date().toISOString(),
  };

  const { error } = await tavari
    .from('business_website_menu')
    .upsert(row, { onConflict: 'business_id' });

  if (error) throw new Error(error.message);

  const sectionCount = otwkMenu.menu_sections.length;
  const itemCount = otwkMenu.menu_sections.reduce(
    (total, section) => total + (Array.isArray(section.items) ? section.items.length : 0),
    0,
  );
  console.log(`Upserted menu (${otwkMenu.menu_source}): ${sectionCount} sections, ${itemCount} items`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
