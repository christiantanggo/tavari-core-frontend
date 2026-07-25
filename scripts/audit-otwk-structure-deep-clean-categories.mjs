/**
 * Audit structure deep clean tasks vs Form 1.05 seed list; fix category_id/category text.
 * Run: node scripts/audit-otwk-structure-deep-clean-categories.mjs
 * Add --fix to apply updates.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const GROUP_NAME = 'structure deep clean list';
const CATEGORY_NAME = 'structure deep clean';
const FIX = process.argv.includes('--fix');

const src = readFileSync(new URL('./seed-otwk-structure-deep-clean.mjs', import.meta.url), 'utf8');
const expectedTitles = [...src.matchAll(/titles: \[([\s\S]*?)\]/g)].flatMap((m) =>
  [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
);

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data: category, error: catErr } = await supabase
    .from('task_manager_categories')
    .select('id, name, location_sensitivity')
    .eq('business_id', BIZ)
    .ilike('name', CATEGORY_NAME)
    .maybeSingle();
  if (catErr) throw catErr;
  if (!category) throw new Error(`Category "${CATEGORY_NAME}" not found`);

  const { data: group, error: groupErr } = await supabase
    .from('task_manager_round_robin_groups')
    .select('id, name')
    .eq('business_id', BIZ)
    .ilike('name', GROUP_NAME)
    .maybeSingle();
  if (groupErr) throw groupErr;
  if (!group) throw new Error(`Round robin group "${GROUP_NAME}" not found`);

  const { data: tasks, error: taskErr } = await supabase
    .from('task_manager_tasks')
    .select('id, title, category, category_id, status')
    .eq('business_id', BIZ)
    .eq('round_robin_group_id', group.id)
    .neq('status', 'cancelled');
  if (taskErr) throw taskErr;

  const wrong = (tasks || []).filter(
    (t) => t.category_id !== category.id
      || String(t.category || '').trim().toLowerCase() !== CATEGORY_NAME
  );

  const dbTitles = new Set((tasks || []).map((t) => t.title));
  const missing = expectedTitles.filter((t) => !dbTitles.has(t));
  const extra = [...dbTitles].filter((t) => !expectedTitles.includes(t));

  console.log('=== Structure Deep Clean category audit ===');
  console.log(`Category: ${category.name} (${category.id})`);
  console.log(`Group: ${group.name}`);
  console.log(`Expected titles (Form 1.05): ${expectedTitles.length}`);
  console.log(`Active tasks in group: ${(tasks || []).length}`);
  console.log(`Distinct titles in DB: ${dbTitles.size}`);
  console.log(`Wrong category_id/text: ${wrong.length}`);
  console.log(`Missing from DB: ${missing.length}`);
  console.log(`Extra in DB (not in seed): ${extra.length}`);

  if (wrong.length) {
    console.log('\nWrong category sample:');
    wrong.slice(0, 10).forEach((t) => {
      console.log(`  - ${t.title} | category_id=${t.category_id} | category="${t.category}"`);
    });
  }
  if (missing.length) {
    console.log('\nMissing titles sample:');
    missing.slice(0, 10).forEach((t) => console.log(`  - ${t}`));
  }
  if (extra.length) {
    console.log('\nExtra titles sample:');
    extra.slice(0, 10).forEach((t) => console.log(`  - ${t}`));
  }

  if (!FIX) {
    if (wrong.length === 0) {
      console.log('\nAll structure deep clean tasks already share the same category. No fix needed.');
    } else {
      console.log('\nRe-run with --fix to update category_id and category text.');
    }
    return;
  }

  if (wrong.length === 0) {
    console.log('\nNo category fixes to apply.');
    return;
  }

  const ids = wrong.map((t) => t.id);
  const { error: updateErr } = await supabase
    .from('task_manager_tasks')
    .update({ category_id: category.id, category: CATEGORY_NAME })
    .in('id', ids)
    .eq('business_id', BIZ);
  if (updateErr) throw updateErr;

  console.log(`\nFixed ${ids.length} task(s) → "${category.name}".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
