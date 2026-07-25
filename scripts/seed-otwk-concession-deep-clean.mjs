/**
 * Seed weekly concession deep clean round robin tasks for Off The Wall Kids London.
 * Run: node scripts/seed-otwk-concession-deep-clean.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const GROUP_NAME = 'weekly concession deep clean';
const CATEGORY_NAME = 'cleaning';

const TASKS = [
  {
    title: 'Clean chip rack table (top, bottom, legs)',
    description: 'Deep clean the chip display table, including all customer-facing and staff-touch surfaces.',
    instructions: 'Remove chips, wipe the top and shelves with sanitizer, clean the underside and legs, then restock neatly.'
  },
  {
    title: 'Clean grill roller',
    description: 'Clean the roller grill unit used for hot dogs and similar items.',
    instructions: 'Turn off and allow to cool safely, wipe guards and exterior, empty the drip tray, and clean accessible roller surfaces.'
  },
  {
    title: 'Clean 3 bowl slushie machine #1 (Inside & Lid) Closest to Pepsi',
    description: 'Deep clean the interior and lid of slushie machine #1 near the Pepsi fountain.',
    instructions: 'Follow manufacturer cleaning steps, rinse bowls and lid thoroughly, sanitize, and reassemble before refilling.'
  },
  {
    title: 'Clean 3 bowl slushie machine filter #1 Closest to Pepsi',
    description: 'Clean the filter for slushie machine #1 near the Pepsi fountain.',
    instructions: 'Remove and rinse the filter, clear buildup, sanitize, and reinstall securely before restarting the machine.'
  },
  {
    title: 'Clean coffee machine',
    description: 'Clean the concession coffee machine inside and out.',
    instructions: 'Wipe exterior surfaces, clean drip tray and brew area, empty grounds, and sanitize handles and touch points.'
  },
  {
    title: 'Clean rack for coffee cups & lids',
    description: 'Clean the coffee cup and lid dispensing rack.',
    instructions: 'Remove cups and lids, wipe all surfaces, sanitize the rack, and restock in a neat, organized layout.'
  },
  {
    title: 'Clean 3 bowl slushie machine #2 (Inside & Lid) Closest to Hot Dogs',
    description: 'Deep clean the interior and lid of slushie machine #2 near the hot dog area.',
    instructions: 'Follow manufacturer cleaning steps, rinse bowls and lid thoroughly, sanitize, and reassemble before refilling.'
  },
  {
    title: 'Clean 3 bowl slushie machine filter #2 Closest to Hot Dogs',
    description: 'Clean the filter for slushie machine #2 near the hot dog area.',
    instructions: 'Remove and rinse the filter, clear buildup, sanitize, and reinstall securely before restarting the machine.'
  },
  {
    title: 'Clean handwash sink',
    description: 'Clean and sanitize the staff handwash sink in the concession area.',
    instructions: 'Scrub the basin, faucet, and surrounding counter, restock soap and paper towels, and check the drain is clear.'
  },
  {
    title: 'Clean pepsi fountain',
    description: 'Clean the Pepsi fountain dispenser and surrounding splash area.',
    instructions: 'Wipe nozzles and buttons, clean drip tray, sanitize the counter around the fountain, and remove sticky residue.'
  },
  {
    title: 'Clean rack for pepsi cup lids & tray for pepsi cups',
    description: 'Clean the Pepsi cup lid rack and cup tray.',
    instructions: 'Remove cups and lids, wipe all surfaces, sanitize, and restock so items are easy for staff and guests to reach.'
  },
  {
    title: 'Clean fountain pop table (top, bottom, legs)',
    description: 'Deep clean the fountain pop service table.',
    instructions: 'Clear product, wipe top and underside, clean legs and edges, sanitize, and return items to a tidy setup.'
  },
  {
    title: 'Clean all cupboards along the back of concession',
    description: 'Clean inside and outside of all back-wall concession cupboards.',
    instructions: 'Empty each cupboard as needed, wipe shelves and doors inside and out, sanitize handles, and reorganize stock neatly.'
  },
  {
    title: 'Clean under all machines on back counter',
    description: 'Clean the floor and surfaces beneath machines on the back concession counter.',
    instructions: 'Move equipment only if safe to do so, sweep and wipe underneath, remove debris, and mop any sticky spots.'
  },
  {
    title: 'Clean white wall behind concession',
    description: 'Clean the white wall surface behind the concession counter.',
    instructions: 'Wipe from top to bottom, remove splatter and marks, and spot-clean any stubborn areas without damaging paint.'
  },
  {
    title: 'Clean all shelves on front concession counter',
    description: 'Clean all front-facing concession counter shelves.',
    instructions: 'Remove product where needed, wipe each shelf, sanitize touch surfaces, and restock in a clean, organized layout.'
  },
  {
    title: 'Clean inside / outside of refrigerated counter',
    description: 'Deep clean the refrigerated display counter inside and out.',
    instructions: 'Wipe exterior panels and handles, clean interior shelves and walls, remove expired items, and sanitize before restocking.'
  },
  {
    title: 'Clean fridge 1 inside and out',
    description: 'Deep clean concession fridge 1 inside and outside.',
    instructions: 'Remove old or expired product, wipe shelves and walls, clean door seals and exterior, then restock and organize.'
  },
  {
    title: 'Clean freezer 1 inside and out',
    description: 'Deep clean concession freezer 1 inside and outside.',
    instructions: 'Remove buildup and debris, wipe interior surfaces, clean door and handles, and ensure the door seals properly.'
  },
  {
    title: 'Clean freezer 2 inside and out',
    description: 'Deep clean concession freezer 2 inside and outside.',
    instructions: 'Remove buildup and debris, wipe interior surfaces, clean door and handles, and ensure the door seals properly.'
  },
  {
    title: 'Clean freezer 3 inside and out',
    description: 'Deep clean concession freezer 3 inside and outside.',
    instructions: 'Remove buildup and debris, wipe interior surfaces, clean door and handles, and ensure the door seals properly.'
  },
  {
    title: 'Clean under fridges / freezers',
    description: 'Clean the floor and surfaces beneath all concession fridges and freezers.',
    instructions: 'Sweep and mop under each unit, remove dust and debris, and wipe accessible sides and vents where safe.'
  },
  {
    title: 'Clean white walls north wall',
    description: 'Clean the north white wall in the concession / kitchen area.',
    instructions: 'Wipe the full wall surface, remove marks and splatter, and spot-clean any high-traffic areas.'
  },
  {
    title: 'Clean white walls east wall',
    description: 'Clean the east white wall in the concession / kitchen area.',
    instructions: 'Wipe the full wall surface, remove marks and splatter, and spot-clean any high-traffic areas.'
  },
  {
    title: 'Clean white walls south wall',
    description: 'Clean the south white wall in the concession / kitchen area.',
    instructions: 'Wipe the full wall surface, remove marks and splatter, and spot-clean any high-traffic areas.'
  },
  {
    title: 'Clean white walls west wall',
    description: 'Clean the west white wall in the concession / kitchen area.',
    instructions: 'Wipe the full wall surface, remove marks and splatter, and spot-clean any high-traffic areas.'
  },
  {
    title: 'Clean fryer table (top, bottom, legs)',
    description: 'Deep clean the fryer prep / service table.',
    instructions: 'Clear items, degrease and wipe the top, underside, and legs, then sanitize before returning equipment.'
  },
  {
    title: 'Clean pizza oven',
    description: 'Clean the pizza oven exterior and accessible interior surfaces.',
    instructions: 'Follow safe shutdown/cool-down steps, wipe exterior, clean door and handles, and remove crumbs or grease buildup.'
  },
  {
    title: 'Clean fryer 1 inside / outside',
    description: 'Deep clean fryer 1 inside and outside.',
    instructions: 'Follow fryer cleaning procedures, wipe exterior, clean accessible interior surfaces, and empty crumbs or oil residue safely.'
  },
  {
    title: 'Change oil in fryer 1',
    description: 'Replace the oil in fryer 1 as part of the deep clean rotation.',
    instructions: 'Cool oil safely, drain and dispose properly, clean the fryer basin as required, and refill with fresh oil.'
  },
  {
    title: 'Clean fryer 2 inside / outside',
    description: 'Deep clean fryer 2 inside and outside.',
    instructions: 'Follow fryer cleaning procedures, wipe exterior, clean accessible interior surfaces, and empty crumbs or oil residue safely.'
  },
  {
    title: 'Change oil in fryer 2',
    description: 'Replace the oil in fryer 2 as part of the deep clean rotation.',
    instructions: 'Cool oil safely, drain and dispose properly, clean the fryer basin as required, and refill with fresh oil.'
  },
  {
    title: 'Clean 2 compartment sink',
    description: 'Deep clean the two-compartment sink in the kitchen area.',
    instructions: 'Scrub both basins, faucet, and surrounding counter, sanitize, and clear the drain area of debris.'
  },
  {
    title: 'Clean centre tables (top, bottom, legs)',
    description: 'Deep clean the centre dining / prep tables.',
    instructions: 'Wipe tops, edges, undersides, and legs on each table, sanitize, and leave surfaces dry and ready for use.'
  },
  {
    title: 'Clean under centre tables (sweep / mop)',
    description: 'Sweep and mop beneath the centre tables.',
    instructions: 'Move chairs safely, sweep out debris, mop sticky spots, and return furniture to position.'
  },
  {
    title: 'Clean under table with white board (Top / Bottom / Legs)',
    description: 'Deep clean the table with the whiteboard, including top, bottom, and legs.',
    instructions: 'Clear the surface, wipe the table and whiteboard area, clean underside and legs, and sanitize touch points.'
  },
  {
    title: 'Sweep / mop under all counters / fridges',
    description: 'Sweep and mop under all counters and refrigeration units.',
    instructions: 'Work section by section, remove debris, mop with sanitizer, and allow floors to dry before reopening traffic.'
  },
  {
    title: 'Clean water fountain',
    description: 'Clean the guest or staff water fountain.',
    instructions: 'Wipe the basin, spout, and button/lever, sanitize touch surfaces, and check for standing water or buildup.'
  },
  {
    title: 'Clean filter on ice machine',
    description: 'Clean the ice machine filter.',
    instructions: 'Follow ice machine maintenance steps, rinse or replace the filter as required, and reinstall securely.'
  },
  {
    title: 'Clean ice machine',
    description: 'Clean the ice machine exterior and accessible interior surfaces.',
    instructions: 'Wipe exterior panels, sanitize handles, clean the bin area as allowed by procedure, and remove visible buildup.'
  },
  {
    title: 'Clean garbage can in entrance way',
    description: 'Clean and sanitize the garbage can in the entrance way.',
    instructions: 'Empty if needed, wash inside and out, sanitize, replace liner, and wipe surrounding floor area.'
  },
  {
    title: 'Clean garbage can in coat area',
    description: 'Clean and sanitize the garbage can in the coat area.',
    instructions: 'Empty if needed, wash inside and out, sanitize, replace liner, and wipe surrounding floor area.'
  },
  {
    title: 'Clean garbage can at admission',
    description: 'Clean and sanitize the garbage can at admission.',
    instructions: 'Empty if needed, wash inside and out, sanitize, replace liner, and wipe surrounding floor area.'
  },
  {
    title: 'Clean garbage cans in party rooms',
    description: 'Clean and sanitize all garbage cans in the party rooms.',
    instructions: 'Visit each party room, empty if needed, wash and sanitize cans, replace liners, and tidy surrounding areas.'
  },
  {
    title: 'Clean garbage center in the eating area',
    description: 'Clean the garbage sorting / disposal center in the eating area.',
    instructions: 'Wipe all bins and surfaces, sanitize handles and lids, replace liners, and mop the immediate floor area.'
  },
  {
    title: 'Clean white garbage cans near chips & under concession counter',
    description: 'Clean the white garbage cans by the chips and under the concession counter.',
    instructions: 'Empty if needed, wash inside and out, sanitize, replace liners, and wipe nearby surfaces.'
  },
  {
    title: 'Clean garbage can in kitchen',
    description: 'Clean and sanitize the garbage can in the kitchen.',
    instructions: 'Empty if needed, wash inside and out, sanitize, replace liner, and wipe surrounding floor and wall splash areas.'
  }
];

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getBusinessWeekStart() {
  const { data, error } = await supabase.rpc('task_manager_business_week_start', { p_business_id: BIZ });
  if (error) throw error;
  return data;
}

async function main() {
  console.log('=== OTWK London concession deep clean seed ===\n');

  let groupId;
  const { data: existingGroup } = await supabase
    .from('task_manager_round_robin_groups')
    .select('id, name')
    .eq('business_id', BIZ)
    .ilike('name', GROUP_NAME)
    .maybeSingle();

  if (existingGroup) {
    groupId = existingGroup.id;
    const { count } = await supabase
      .from('task_manager_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', BIZ)
      .eq('round_robin_group_id', groupId)
      .neq('status', 'cancelled');

    if (count === TASKS.length) {
      console.log(`Round robin group already seeded (${existingGroup.name}, ${count} tasks). Skipping.`);
      return;
    }

    if (count > 0) {
      console.log(`Replacing ${count} existing task(s) in ${existingGroup.name} with full ${TASKS.length}-task list...`);
      const { error: cancelError } = await supabase
        .from('task_manager_tasks')
        .update({ status: 'cancelled' })
        .eq('business_id', BIZ)
        .eq('round_robin_group_id', groupId)
        .neq('status', 'cancelled');
      if (cancelError) throw cancelError;
    } else {
      console.log(`Using existing round robin group: ${existingGroup.name}`);
    }
  }

  let categoryId;
  const { data: existingCategory } = await supabase
    .from('task_manager_categories')
    .select('id')
    .eq('business_id', BIZ)
    .ilike('name', CATEGORY_NAME)
    .maybeSingle();

  if (existingCategory) {
    categoryId = existingCategory.id;
    console.log(`Using existing category: ${CATEGORY_NAME}`);
  } else {
    const { data: newCategory, error: categoryError } = await supabase
      .from('task_manager_categories')
      .insert({ business_id: BIZ, name: CATEGORY_NAME, sort_order: 50, is_active: true })
      .select('id')
      .single();
    if (categoryError) throw categoryError;
    categoryId = newCategory.id;
    console.log(`Created category: ${CATEGORY_NAME}`);
  }

  if (!groupId) {
    const { data: newGroup, error: groupError } = await supabase
      .from('task_manager_round_robin_groups')
      .insert({
        business_id: BIZ,
        name: GROUP_NAME,
        reset_cadence: 'weekly_sunday'
      })
      .select('id')
      .single();
    if (groupError) throw groupError;
    groupId = newGroup.id;
    console.log(`Created round robin group: ${GROUP_NAME}`);
  }

  const weekStart = await getBusinessWeekStart();
  const now = new Date().toISOString();

  const rows = TASKS.map((task, index) => ({
    business_id: BIZ,
    title: task.title,
    description: task.description,
    category: CATEGORY_NAME,
    category_id: categoryId,
    priority: 'medium',
    assignment_scope: 'facility',
    assigned_to: null,
    status: 'to_do',
    available_at: now,
    due_at: null,
    photo_requirement_mode: 'random',
    requires_photo: false,
    requires_notes: false,
    peer_review_required: true,
    instructions: task.instructions,
    checklist: [],
    required_form_id: null,
    module_link_key: null,
    due_schedule_mode: 'weekly_round_robin',
    round_robin_group_id: groupId,
    round_robin_sort_order: index,
    round_robin_slot_order: index,
    round_robin_week_start: weekStart,
    review_status: 'not_required',
    manager_review_required: false
  }));

  const { data: inserted, error: insertError } = await supabase
    .from('task_manager_tasks')
    .insert(rows)
    .select('id, title');
  if (insertError) throw insertError;

  const { error: groupUpdateError } = await supabase
    .from('task_manager_round_robin_groups')
    .update({ current_week_start: weekStart })
    .eq('id', groupId);
  if (groupUpdateError) throw groupUpdateError;

  console.log(`Inserted ${inserted.length} tasks into weekly round robin queue.`);
  console.log('First task in queue:', inserted[0]?.title);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
