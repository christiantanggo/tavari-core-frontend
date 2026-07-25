/**
 * Simulate POS meal modifier load + Fountain Pop selection visibility.
 * Run: node scripts/simulate-combo-fountain.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

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

const normalizeModifierGroupIds = (raw) => {
  if (typeof raw === 'string') {
    try {
      return normalizeModifierGroupIds(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (raw && typeof raw === 'object') return Object.values(raw).filter(Boolean);
  return [];
};

const isPickOne = (group) => Number.parseInt(group?.max_selections, 10) === 1;

const isGroupVisible = (group, selections, allGroups, productId) => {
  const parentInvId = String(group?.show_when_inventory_id || '').trim();
  if (!parentInvId) return true;
  if (productId && String(productId) === parentInvId) return true;
  const parentGroup = (allGroups || []).find((g) =>
    (g?.modifiers || []).some((m) => String(m?.id || '') === parentInvId)
  );
  if (!parentGroup) return !productId;
  if (isPickOne(parentGroup)) {
    const inGroup = (selections || []).filter((row) => row?.group_id === parentGroup.id);
    const activeId = inGroup.length ? inGroup[inGroup.length - 1]?.id : null;
    return activeId === parentInvId;
  }
  return (selections || []).some((s) => String(s.id) === parentInvId);
};

const env = loadEnv();
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const businessId = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const mealId = '3da829d2-f5d2-4d55-b50a-3c118c16423a';
const fountainId = '376d6b6f-9672-4b22-a08a-9f57ea2bbbac';

const { data: meal, error: mealErr } = await supabase
  .from('pos_inventory')
  .select('id, name, modifier_group_ids, included_modifier_category_id, included_modifier_max_price')
  .eq('id', mealId)
  .single();
if (mealErr) throw mealErr;

const groupIds = normalizeModifierGroupIds(meal.modifier_group_ids);
console.log('Meal', meal.name, 'group count', groupIds.length);

const { data: groups, error: groupsError } = await supabase
  .from('pos_modifier_groups')
  .select('*')
  .in('id', groupIds)
  .eq('business_id', businessId)
  .eq('is_active', true);
if (groupsError) throw groupsError;
console.log('Loaded groups from DB', groups?.length, 'of', groupIds.length);
const missingGroupIds = groupIds.filter((id) => !(groups || []).some((g) => g.id === id));
if (missingGroupIds.length) console.log('MISSING groups from query:', missingGroupIds);

const groupsWithModifiers = await Promise.all(
  (groups || []).map(async (group) => {
    const { data: groupItems, error: groupItemsError } = await supabase
      .from('pos_modifier_group_items')
      .select('*')
      .eq('modifier_group_id', group.id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (groupItemsError || !groupItems?.length) {
      return { ...group, modifiers: [], _empty: true, _err: groupItemsError?.message };
    }

    const inventoryIds = groupItems.map((item) => item.inventory_id);
    const { data: inventoryItems } = await supabase
      .from('pos_inventory')
      .select('id, name, price, cost, category_id, modifier_group_ids')
      .in('id', inventoryIds)
      .eq('business_id', businessId);

    const modifiers = groupItems
      .map((groupItem) => {
        const inventoryItem = inventoryItems?.find((inv) => inv.id === groupItem.inventory_id);
        if (!inventoryItem) return null;
        return {
          id: inventoryItem.id,
          name: inventoryItem.name,
          modifier_group_ids: inventoryItem.modifier_group_ids || null,
        };
      })
      .filter(Boolean);

    return {
      ...group,
      show_when_inventory_id: group.show_when_inventory_id || null,
      modifiers,
      _droppedInv: groupItems.length - modifiers.length,
    };
  })
);

const empty = groupsWithModifiers.filter((g) => g._empty || !(g.modifiers || []).length);
console.log(
  'Empty/dropped groups:',
  empty.map((g) => `${g.name} empty=${!!g._empty} err=${g._err || ''} droppedInv=${g._droppedInv || 0}`)
);

const withItems = groupsWithModifiers.filter((g) => (g.modifiers || []).length > 0);

// Simulate merge: ensure fountain nested groups present and gated
const byId = new Map(withItems.map((g) => [String(g.id), g]));
const fountain = withItems.flatMap((g) => g.modifiers).find((m) => m.id === fountainId);
console.log('Fountain option found in', withItems.find((g) => g.modifiers.some((m) => m.id === fountainId))?.name);
console.log('Fountain modifier_group_ids', fountain?.modifier_group_ids);

for (const gid of normalizeModifierGroupIds(fountain?.modifier_group_ids)) {
  const existing = byId.get(String(gid));
  if (existing) {
    existing.show_when_inventory_id = fountainId;
    console.log('Retargeted', existing.name, '-> show_when Fountain Pop');
  } else {
    console.log('MISSING nested group on meal load:', gid);
  }
}

const ordered = withItems;
const before = ordered.filter((g) => isGroupVisible(g, [], ordered, mealId));
console.log(
  'Visible before pick:',
  before.map((g) => g.name)
);

const comboDrink = ordered.find((g) => g.name === 'Combo Drink');
const selections = [{ id: fountainId, name: 'Fountain Pop', group_id: comboDrink?.id }];
const after = ordered.filter((g) => isGroupVisible(g, selections, ordered, mealId));
console.log(
  'Visible after Fountain Pop:',
  after.map((g) => `${g.name}${g.is_required ? '*' : ''} sw=${g.show_when_inventory_id || 'null'}`)
);

const prevIds = new Set(before.map((g) => g.id));
const newly = after.filter((g) => !prevIds.has(g.id));
console.log(
  'Newly unlocked:',
  newly.map((g) => `${g.name}${g.is_required ? '*' : ''}`)
);
const prefer = newly.find((g) => g.is_required) || newly[0];
console.log('Auto-advance target:', prefer?.name || '(none)');
