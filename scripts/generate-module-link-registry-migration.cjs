/**
 * Generates the Supabase migration for task_manager_module_link_registry from JS source.
 * Usage: node scripts/generate-module-link-registry-migration.cjs
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const mod = await import(pathToFileURL(path.join(__dirname, '../src/helpers/taskManagerModuleLinks.js')).href);
  const links = mod.TASK_MANAGER_MODULE_LINKS;
  const escape = (value) => String(value || '').replace(/'/g, "''");

  const values = links.map((entry) => {
    const permissionKeys = `'{"${(entry.permissionKeys || []).join('","')}"}'::text[]`;
    const allowRoles = entry.allowRoles?.length
      ? `'{"${entry.allowRoles.join('","')}"}'::text[]`
      : 'NULL';
    return `  ('${escape(entry.key)}', '${escape(entry.moduleGroup)}', '${escape(entry.label)}', '${escape(entry.buttonLabel)}', '${escape(entry.path)}', ${permissionKeys}, ${allowRoles})`;
  }).join(',\n');

  const sql = `-- Expand task module link registry to all dashboard pages (sync with src/helpers/taskManagerModuleLinks.js).

CREATE TABLE IF NOT EXISTS public.task_manager_module_link_registry (
  key text PRIMARY KEY,
  module_group text NOT NULL,
  label text NOT NULL,
  button_label text NOT NULL,
  path text NOT NULL,
  permission_keys text[] NOT NULL DEFAULT '{}'::text[],
  allow_roles text[] NULL
);

TRUNCATE public.task_manager_module_link_registry;

INSERT INTO public.task_manager_module_link_registry (
  key, module_group, label, button_label, path, permission_keys, allow_roles
) VALUES
${values}
ON CONFLICT (key) DO UPDATE SET
  module_group = EXCLUDED.module_group,
  label = EXCLUDED.label,
  button_label = EXCLUDED.button_label,
  path = EXCLUDED.path,
  permission_keys = EXCLUDED.permission_keys,
  allow_roles = EXCLUDED.allow_roles;

CREATE OR REPLACE FUNCTION public.task_manager_module_link_def(p_key text)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'path', r.path,
    'button_label', r.button_label,
    'permission_keys', to_jsonb(r.permission_keys),
    'allow_roles', to_jsonb(COALESCE(r.allow_roles, ARRAY[]::text[]))
  )
  FROM public.task_manager_module_link_registry r
  WHERE r.key = p_key;
$$;

CREATE OR REPLACE FUNCTION public.task_manager_module_link_allowed(
  p_business_id uuid,
  p_employee_id uuid,
  p_module_link_key text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_def jsonb;
  v_keys text[];
  v_allow_roles text[];
  v_role text;
BEGIN
  IF p_module_link_key IS NULL OR length(trim(p_module_link_key)) = 0 THEN
    RETURN false;
  END IF;

  v_def := public.task_manager_module_link_def(p_module_link_key);
  IF v_def IS NULL THEN
    RETURN false;
  END IF;

  SELECT array_agg(value::text)
  INTO v_allow_roles
  FROM jsonb_array_elements_text(v_def->'allow_roles') AS value
  WHERE length(value) > 0;

  IF v_allow_roles IS NOT NULL AND cardinality(v_allow_roles) > 0 THEN
    v_role := public.user_business_role(p_business_id, p_employee_id);
    IF v_role = 'owner' OR v_role = ANY(v_allow_roles) THEN
      RETURN true;
    END IF;
  END IF;

  SELECT array_agg(value::text)
  INTO v_keys
  FROM jsonb_array_elements_text(v_def->'permission_keys') AS value
  WHERE length(value) > 0;

  IF v_keys IS NOT NULL AND cardinality(v_keys) > 0 THEN
    RETURN public.user_has_any_business_permission(p_business_id, p_employee_id, v_keys);
  END IF;

  RETURN false;
END;
$$;

GRANT SELECT ON public.task_manager_module_link_registry TO anon, authenticated;
`;

  const outPath = path.join(__dirname, '../supabase/migrations/20260614250000_task_manager_module_link_registry_full.sql');
  fs.writeFileSync(outPath, sql, 'utf8');
  console.log(`Wrote ${links.length} registry rows to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
