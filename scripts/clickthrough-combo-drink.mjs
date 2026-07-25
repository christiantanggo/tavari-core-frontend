/**
 * Click-through simulation of ModifierSelectionModal nested-focus flow
 * using LIVE OTWK Hot Dog Meal data (service role).
 *
 * Steps:
 * 1) Open meal → Combo Drink
 * 2) Tap Fountain Pop → must show ONLY Size tab, Size active, options Small/Med/Large
 * 3) Tap Small → nested focus clears (Flavour removed for now)
 * 4) Reset → tap Slush Puppie → same Size-only behavior
 *
 * Run: node scripts/clickthrough-combo-drink.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnv() {
  const text = readFileSync(resolve(root, '.env'), 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    out[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

// Use the same helpers as the POS modal (via dynamic import of ESM)
const {
  filterVisiblePosModifierGroups,
  pickNewlyUnlockedGroupId,
} = await import('../src/utils/posModifierVisibility.js');
const {
  normalizeModifierGroupIds,
  sortModifierGroupsForDisplay,
  mergeNestedModifierGroupsFromOptions,
} = await import('../src/utils/posModifierGroupsLoader.js');

const followUpRank = (group) => {
  const name = String(group?.name || '').toLowerCase();
  if (/\bsize\b/.test(name)) return 0;
  if (group?.is_required) return 1;
  if (/flavour|flavor/.test(name)) return 2;
  return 3;
};

function nestedFocusVisible(allGroups, selections, productId, nestedFocusParentId) {
  const all = sortModifierGroupsForDisplay(
    filterVisiblePosModifierGroups(allGroups, selections, productId),
    allGroups.map((g) => g.id)
  );
  if (!nestedFocusParentId) return all;
  const nested = all
    .filter((g) => String(g.show_when_inventory_id || '') === String(nestedFocusParentId))
    .sort((a, b) => followUpRank(a) - followUpRank(b));
  return nested.length > 0 ? nested : all;
}

function displaySizeName(modifier, group) {
  const full = String(modifier?.name || '');
  if (!/\bsize\b/i.test(String(group?.name || ''))) return full;
  const cut = full.split(' - ');
  if (cut.length > 1) return cut.slice(1).join(' - ').trim() || full;
  return full;
}

function advance(groups, prevVisible, nextSelections, nestedFocusParentId, pickedModifier) {
  const nextVisible = filterVisiblePosModifierGroups(groups, nextSelections, mealId);
  const pickedId = pickedModifier?.id ? String(pickedModifier.id) : null;
  const nestedUnderPicked = pickedId
    ? nextVisible
        .filter((g) => String(g.show_when_inventory_id || '') === pickedId)
        .sort((a, b) => followUpRank(a) - followUpRank(b))
    : [];

  let nextFocus = nestedFocusParentId;
  if (nestedUnderPicked.length > 0) nextFocus = pickedId;

  const focusId =
    nestedUnderPicked.length > 0
      ? pickedId
      : nextFocus
        ? String(nextFocus)
        : null;

  const nestedForFocus = focusId
    ? nextVisible
        .filter((g) => String(g.show_when_inventory_id || '') === focusId)
        .sort((a, b) => followUpRank(a) - followUpRank(b))
    : [];

  let unlockTargetId = null;
  if (nestedForFocus.length > 0) {
    const unfinished = nestedForFocus.find(
      (g) => !nextSelections.some((row) => row.group_id === g.id)
    );
    if (unfinished) unlockTargetId = unfinished.id;
    else nextFocus = null;
  } else {
    unlockTargetId = pickNewlyUnlockedGroupId(prevVisible, nextVisible);
  }

  return { nextFocus, unlockTargetId, nextVisible };
}

const env = loadEnv();
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const businessId = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const mealId = '3da829d2-f5d2-4d55-b50a-3c118c16423a';
const fountainId = '376d6b6f-9672-4b22-a08a-9f57ea2bbbac';
const slushId = 'c699876c-bc09-4bf8-bccb-e99976244918';

const { data: meal, error: mealErr } = await supabase
  .from('pos_inventory')
  .select('id, name, modifier_group_ids, included_modifier_category_id, included_modifier_max_price')
  .eq('id', mealId)
  .single();
if (mealErr) throw mealErr;

const groupIds = normalizeModifierGroupIds(meal.modifier_group_ids);
const { data: groups, error: groupsError } = await supabase
  .from('pos_modifier_groups')
  .select('*')
  .in('id', groupIds)
  .eq('business_id', businessId)
  .eq('is_active', true);
if (groupsError) throw groupsError;

const groupsWithModifiers = await Promise.all(
  (groups || []).map(async (group) => {
    const { data: groupItems } = await supabase
      .from('pos_modifier_group_items')
      .select('*')
      .eq('modifier_group_id', group.id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (!groupItems?.length) return { ...group, modifiers: [] };
    const inventoryIds = groupItems.map((item) => item.inventory_id);
    const { data: inventoryItems } = await supabase
      .from('pos_inventory')
      .select('id, name, price, cost, category_id, modifier_group_ids')
      .in('id', inventoryIds)
      .eq('business_id', businessId);
    const modifiers = groupItems
      .map((gi) => {
        const inv = inventoryItems?.find((i) => i.id === gi.inventory_id);
        if (!inv) return null;
        return {
          id: inv.id,
          name: inv.name,
          price: Number(inv.price) || 0,
          modifier_group_ids: inv.modifier_group_ids || null,
        };
      })
      .filter(Boolean);
    return { ...group, modifiers };
  })
);

const withItems = groupsWithModifiers.filter((g) => (g.modifiers || []).length > 0);
const ordered = await mergeNestedModifierGroupsFromOptions(
  supabase,
  businessId,
  withItems,
  meal
);

let failures = 0;
function assert(label, cond, detail = '') {
  if (cond) {
    console.log('PASS:', label);
  } else {
    failures += 1;
    console.log('FAIL:', label, detail);
  }
}

async function runDrink(drinkId, drinkLabel, sizeTabRe) {
  console.log('\n===', drinkLabel, '===');
  let selections = [];
  let nestedFocus = null;
  let activeId = null;

  const comboDrink = ordered.find((g) => g.name === 'Combo Drink');
  assert('Combo Drink group exists', !!comboDrink);
  const drink = (comboDrink?.modifiers || []).find((m) => m.id === drinkId);
  assert(`${drinkLabel} is a Combo Drink option`, !!drink, `options=${(comboDrink?.modifiers || []).map((m) => m.name).join(', ')}`);

  // Tap drink
  const prevVisible = filterVisiblePosModifierGroups(ordered, selections, mealId);
  selections = [{ id: drinkId, name: drink.name, group_id: comboDrink.id }];
  const adv = advance(ordered, prevVisible, selections, nestedFocus, drink);
  nestedFocus = adv.nextFocus;
  activeId = adv.unlockTargetId;

  const tabs = nestedFocusVisible(ordered, selections, mealId, nestedFocus);
  const active = tabs.find((g) => g.id === activeId) || tabs[0];
  console.log(
    '  tabs:',
    tabs.map((g) => g.name).join(' | '),
    '| active:',
    active?.name
  );
  console.log(
    '  size labels:',
    (active?.modifiers || []).map((m) => displaySizeName(m, active)).join(', ')
  );

  assert('nested focus on drink', String(nestedFocus) === String(drinkId));
  assert('only Size tab (no Flavour)', tabs.length === 1 && sizeTabRe.test(tabs[0]?.name || ''));
  assert('active tab is Size', sizeTabRe.test(active?.name || ''), `got ${active?.name}`);
  assert(
    'Size options are sizes not flavours',
    (active?.modifiers || []).every((m) => /small|medium|large/i.test(m.name)),
    (active?.modifiers || []).map((m) => m.name).join(', ')
  );
  assert(
    'display strips Pepsi/Slush prefix',
    (active?.modifiers || []).map((m) => displaySizeName(m, active)).every((n) => /^(Small|Medium|Large)$/i.test(n)),
    (active?.modifiers || []).map((m) => displaySizeName(m, active)).join(', ')
  );
  assert('no flavour names on Size screen', !(active?.modifiers || []).some((m) => /diet pepsi|blue raspberry|7up|cherry/i.test(m.name)));

  // Tap Small
  const sizeOpt = (active?.modifiers || []).find((m) => /small/i.test(m.name));
  assert('Small size option exists', !!sizeOpt);
  const prev2 = filterVisiblePosModifierGroups(ordered, selections, mealId);
  selections = [...selections, { id: sizeOpt.id, name: sizeOpt.name, group_id: active.id }];
  const adv2 = advance(ordered, prev2, selections, nestedFocus, sizeOpt);
  nestedFocus = adv2.nextFocus;
  console.log('  after size → focus cleared:', nestedFocus);
  assert('after Size, nested focus clears (no Flavour)', nestedFocus == null);
}

await runDrink(fountainId, 'Fountain Pop', /Fountain Pop Size/i);
await runDrink(slushId, 'Slush Puppie', /Slush Size/i);

console.log('\n==== RESULT ====', failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
