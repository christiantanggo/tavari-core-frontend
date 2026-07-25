/**
 * Seed structure deep clean weekly round robin tasks for Off The Wall Kids London.
 * Source: Form 1.05 Deep Clean Checklist (pages 1–2).
 * Run: node scripts/seed-otwk-structure-deep-clean.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const GROUP_NAME = 'structure deep clean list';
const CATEGORY_NAME = 'structure deep clean';
const SCHEDULE_MODE = 'biweekly_round_robin';
const RESET_CADENCE = 'biweekly_sunday';

const SECTIONS = [
  {
    section: 'Daily — common areas',
    titles: [
      'Wash tables & chairs',
      'Wipe couches',
      'Clean waiver tablets',
      'Clean bench in coat area',
      'Clean front gate',
      'Vacuum platforms throughout entire structure'
    ]
  },
  {
    section: 'Donut Slide',
    titles: [
      'Vacuum between platforms & mesh',
      'Vacuum around ridges on walk way',
      'Vacuum bristles on the slide',
      'Vacuum flooring at bottom',
      'Wash all platforms',
      'Wash all pole pads',
      'Wash all tubes',
      'Spray bottom of tubes with silicon spray',
      'Wash all side bumper pads along slide and bottom'
    ]
  },
  {
    section: 'Ninja Course',
    titles: [
      'Vacuum floor pads',
      'Vacuum carpet behind ninja course',
      'Wash all upright pads',
      'Wash all floor pads',
      'Spot clean rope climb',
      'Wash tire swings',
      'Wash "doors"',
      'Wash rope bridge',
      'Wash rings',
      'Wash ladders',
      'Dust tops of ninja course'
    ]
  },
  {
    section: 'Jumper',
    titles: [
      'Vacuum carpet',
      'Wash jumper',
      'Black spot removal from jumper',
      'Clean air compressor - Gregory'
    ]
  },
  {
    section: 'Volcano Slide',
    titles: [
      'Vacuum blue pads on floor',
      'Vacuum corners and edges of volcano',
      'Vacuum between slide and pad at bottom',
      'Wash / Black spot removal from volcano',
      'Wash / black spot removal from top platform',
      'Wash ladder',
      'Wash hand holds',
      'Wash slide',
      'Spray pledge on slide and wipe in',
      'Wash pad at bottom of slide',
      'Wash all pole pads',
      'Wash / dust outside of slide'
    ]
  },
  {
    section: 'Party Rooms',
    titles: [
      'Wash vinyl on outside of party rooms',
      'Wash vinyl on inside of party rooms',
      'Wash all pole pads on outside of party rooms',
      'Wash all pole pads on inside of party rooms',
      'Dust poles overtop of party room'
    ]
  },
  {
    section: 'Main Structure Level 1',
    titles: [
      'Vacuum between pads and mesh',
      'Wash all pads',
      'Wash all pole pads',
      'Wash spinning plate near donut slide',
      'Wash red platform with circles',
      'Wash yellow platform with blue "S"',
      'Wash zip line',
      'Wash swinging log',
      'Wash obstacles on floor',
      'Wash hexagon stools',
      'Wash fireman climb level 1',
      'Wash landing pad for twisty slide',
      'Wash barrier wall for twisty slide'
    ]
  },
  {
    section: 'Main Structure Level 2',
    titles: [
      'Vacuum between platforms and mesh',
      'Wash all platforms',
      'Wash all pole pads',
      'Spot clean seat belt material / hammock',
      'Wash fireman climb level 2',
      'Wash blue spinning wall'
    ]
  },
  {
    section: 'Main Structure Level 3',
    titles: [
      'Vacuum between platforms and mesh',
      'Wash all pole pads',
      'Clean rope bridge',
      'Clean rollers',
      'Clean spike cylinder',
      'Wash inside twisty slide',
      'Spray pledge inside twisty slide and wipe in',
      'Dust outside of twisty slide',
      'Wash wave slide',
      'Spray pledge on wave slide and wipe in',
      'Vacuum and wash all pole pads on outside of structure'
    ]
  },
  {
    section: 'Ballistics Arena',
    titles: [
      'Vacuum between platforms and mesh',
      'Vacuum around ridges on walk way',
      'Vacuum floors',
      'Wash all platforms',
      'Wash all pole pads',
      'Wash guns on second level',
      'Wash rainbow bridge',
      'Wash "Stepping stones"',
      'Wash hanging pads',
      'Wash floor canons',
      'Wash ball fountain',
      'Wash entrance barriers',
      'Wash ballistics entrance "doors"',
      'Wash all balls',
      'Vacuum and wash all pole pads on outside of structure'
    ]
  },
  {
    section: 'Toddler',
    titles: [
      'Vacuum between platforms and mesh',
      'Vacuum around ridges on walk way',
      'Vacuum floors',
      'Wash all platforms',
      'Wash all pole pads',
      'Wash spike ball',
      'Wash slide',
      'Wash block area',
      'Wash activity panels',
      'Wash bead table',
      'Wash bear wobbler',
      'Wash zebra',
      'Wash stools x3',
      'Vacuum and wash all pole pads on outside of structure'
    ]
  }
];

function buildInstructions(section, title) {
  const lower = title.toLowerCase();
  if (lower.includes('vacuum')) {
    return `In ${section}: vacuum thoroughly, remove debris from mesh and corners, and take a verification photo when finished.`;
  }
  if (lower.includes('spray') && lower.includes('pledge')) {
    return `In ${section}: spray Pledge as directed, wipe in completely, and take a verification photo when finished.`;
  }
  if (lower.includes('spray') && lower.includes('silicon')) {
    return `In ${section}: apply silicon spray to tube bottoms per procedure, wipe excess, and take a verification photo.`;
  }
  if (lower.includes('dust')) {
    return `In ${section}: dust all listed surfaces, remove buildup, and take a verification photo when finished.`;
  }
  if (lower.includes('spot clean') || lower.includes('black spot')) {
    return `In ${section}: treat visible spots with approved cleaner, re-wipe until clean, and take a verification photo.`;
  }
  if (lower.startsWith('wash') || lower.includes(' wipe')) {
    return `In ${section}: wash and sanitize all surfaces with approved cleaner, dry as needed, and take a verification photo.`;
  }
  if (lower.startsWith('clean')) {
    return `In ${section}: deep clean and sanitize the area, check for missed spots, and take a verification photo when done.`;
  }
  return `In ${section}: complete this deep clean item per facility standards and take a verification photo when finished.`;
}

function buildDescription(section, title) {
  return `Structure deep clean — ${section}: ${title}.`;
}

const TASKS = SECTIONS.flatMap(({ section, titles }) =>
  titles.map((title) => ({
    title,
    description: buildDescription(section, title),
    instructions: buildInstructions(section, title)
  }))
);

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getBusinessBiweeklyPeriodStart() {
  const { data, error } = await supabase.rpc('task_manager_business_biweekly_period_start', { p_business_id: BIZ });
  if (error) throw error;
  return data;
}

async function main() {
  console.log('=== OTWK London structure deep clean seed (bi-weekly) ===\n');
  console.log(`Tasks to seed: ${TASKS.length}\n`);

  let groupId;
  const { data: existingGroup } = await supabase
    .from('task_manager_round_robin_groups')
    .select('id, name, reset_cadence')
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

    const { data: sampleTask } = await supabase
      .from('task_manager_tasks')
      .select('due_schedule_mode')
      .eq('business_id', BIZ)
      .eq('round_robin_group_id', groupId)
      .neq('status', 'cancelled')
      .limit(1)
      .maybeSingle();

    const cadenceOk = existingGroup.reset_cadence === RESET_CADENCE;
    const modeOk = !sampleTask || sampleTask.due_schedule_mode === SCHEDULE_MODE;

    if (count === TASKS.length && cadenceOk && modeOk) {
      console.log(`Round robin group already seeded (${existingGroup.name}, ${count} tasks, bi-weekly). Skipping.`);
      return;
    }

    if (count > 0) {
      console.log(`Replacing ${count} existing task(s) in ${existingGroup.name} with full ${TASKS.length}-task bi-weekly list...`);
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

    if (!cadenceOk) {
      const { error: groupCadenceError } = await supabase
        .from('task_manager_round_robin_groups')
        .update({ reset_cadence: RESET_CADENCE, current_week_start: null })
        .eq('id', groupId);
      if (groupCadenceError) throw groupCadenceError;
      console.log(`Updated group cadence to ${RESET_CADENCE}`);
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
      .insert({ business_id: BIZ, name: CATEGORY_NAME, sort_order: 60, is_active: true })
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
        reset_cadence: RESET_CADENCE
      })
      .select('id')
      .single();
    if (groupError) throw groupError;
    groupId = newGroup.id;
    console.log(`Created round robin group: ${GROUP_NAME}`);
  }

  const periodStart = await getBusinessBiweeklyPeriodStart();
  const now = new Date().toISOString();

  const rows = TASKS.map((task, index) => ({
    business_id: BIZ,
    title: task.title,
    description: task.description,
    category: CATEGORY_NAME,
    category_id: categoryId,
    priority: 'low',
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
    due_schedule_mode: SCHEDULE_MODE,
    round_robin_group_id: groupId,
    round_robin_sort_order: index,
    round_robin_slot_order: index,
    round_robin_week_start: periodStart,
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
    .update({ current_week_start: periodStart })
    .eq('id', groupId);
  if (groupUpdateError) throw groupUpdateError;

  console.log(`Inserted ${inserted.length} tasks into bi-weekly round robin queue.`);
  console.log('First task in queue:', inserted[0]?.title);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
