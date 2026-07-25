/**
 * Generates SQL seed statements from taskManagerModuleLinks.js for Supabase migrations.
 * Usage: node scripts/generate-module-link-registry-sql.cjs
 */
const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const mod = await import(pathToFileURL(path.join(__dirname, '../src/helpers/taskManagerModuleLinks.js')).href);
  const links = mod.TASK_MANAGER_MODULE_LINKS;
  const escape = (value) => String(value || '').replace(/'/g, "''");

  const lines = links.map((entry) => {
    const permissionKeys = `{${(entry.permissionKeys || []).map((k) => `"${k}"`).join(',')}}`;
    const allowRoles = entry.allowRoles?.length
      ? `{${entry.allowRoles.map((r) => `"${r}"`).join(',')}}`
      : 'NULL';
    return `  ('${escape(entry.key)}', '${escape(entry.moduleGroup)}', '${escape(entry.label)}', '${escape(entry.buttonLabel)}', '${escape(entry.path)}', '${permissionKeys}'::text[], ${allowRoles}::text[])`;
  });

  process.stdout.write(lines.join(',\n'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
