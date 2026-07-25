/**
 * Copies AI navigation catalog + help knowledge JSON into Supabase Edge Function _shared
 * so tavari-ai-chat stays in sync with the frontend source of truth.
 * Runs on prebuild/predev alongside generate-legacy-waiver-config.cjs.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pairs = [
  [
    path.join(root, 'src', 'constants', 'aiNavigationCatalog.json'),
    path.join(root, 'supabase', 'functions', '_shared', 'aiNavigationCatalog.json'),
  ],
  [
    path.join(root, 'src', 'constants', 'aiHelpKnowledge.json'),
    path.join(root, 'supabase', 'functions', '_shared', 'aiHelpKnowledge.json'),
  ],
  [
    path.join(root, 'src', 'constants', 'aiStaffLinksCatalog.json'),
    path.join(root, 'supabase', 'functions', '_shared', 'aiStaffLinksCatalog.json'),
  ],
];

for (const [src, dest] of pairs) {
  if (!fs.existsSync(src)) {
    console.error('[sync-ai-chat-knowledge] Missing source:', src);
    process.exit(1);
  }
  const raw = fs.readFileSync(src, 'utf8');
  JSON.parse(raw);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, raw, 'utf8');
  console.log('[sync-ai-chat-knowledge] synced', path.relative(root, dest));
}
