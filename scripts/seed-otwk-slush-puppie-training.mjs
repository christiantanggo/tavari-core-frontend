/**
 * Seed HR training modules for the Slush Puppie 3-bowl unit (operate + clean).
 * Links the cleaning module to all four weekly slushie deep-clean tasks.
 *
 * Run: node scripts/seed-otwk-slush-puppie-training.mjs
 * Optional: SLUSH_PUPPIE_IMAGE_PATH=/path/to/images.jpg
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_IMAGE = path.join(__dirname, '..', 'Training Photos', 'images.jpg');

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const DEEP_CLEAN_GROUP = 'weekly concession deep clean';
const MEDIA_BUCKET = 'task-training-media';

const DEEP_CLEAN_TASK_TITLES = [
  'Clean 3 bowl slushie machine #1 (Inside & Lid) Closest to Pepsi',
  'Clean 3 bowl slushie machine filter #1 Closest to Pepsi',
  'Clean 3 bowl slushie machine #2 (Inside & Lid) Closest to Hot Dogs',
  'Clean 3 bowl slushie machine filter #2 Closest to Hot Dogs',
];

const TRAINING_MODULES = [
  {
    title: 'How to Operate the Slush Puppie',
    description:
      'Learn how to run the 3-bowl Slush Puppie unit — freeze settings, refilling, topping up, and daily service without shutting the machine off.',
    autoAssignNewHires: true,
    kioskSignInRequired: true,
    includeOverviewImage: true,
    taskLink: { mode: 'create_task', categoryName: 'Training' },
    sections: {
      overview: {
        text:
          'The concession has two 3-bowl Slush Puppie machines: #1 closest to the Pepsi fountain and #2 closest to the hot dogs. Each machine has three clear bowls with yellow lids, spiral augers, and front dispensing handles. The units stay powered on during open hours — they run defrost cycles automatically.',
        image_url: null,
      },
      objectives: {
        text:
          'After this training you will know the preferred slush setting, how to check flavors, how to refill or top up bowls, how to serve guests, and how to manage product levels through the week for cleaning.',
        image_url: null,
      },
      notes: {
        text:
          'Never turn the Slush Puppie units off during normal operation — they are meant to run constantly and will defrost on their own. Slush setting 3 is preferred; higher numbers make a thicker product. Ask a manager if a bowl looks wrong before changing settings.',
        image_url: null,
      },
    },
    steps: [
      {
        title: 'Leave the unit running',
        body:
          'Do not power off the Slush Puppie machines during normal concession hours. They run constantly and will automatically go into defrost cycles. Never turn them off at open or close unless a manager directs it for maintenance.',
      },
      {
        title: 'Slush / freeze setting',
        body:
          'The preferred slush setting is 3. Higher numbers make the product thicker; lower numbers make it thinner. If a bowl is too icy or too runny, ask a manager before adjusting — do not change settings on your own unless trained to do so.',
      },
      {
        title: 'Auger / mixing',
        body:
          'The white spiral auger in each bowl keeps the slush mixed and at the right texture. When the unit is running, the augers should be turning in each active bowl. If an auger is not moving, tell a manager before serving from that bowl.',
      },
      {
        title: 'Know which machine is which',
        body:
          'Machine #1 is closest to the Pepsi fountain. Machine #2 is closest to the hot dogs. Both machines work the same way — check the flavor label on each bowl before refilling or serving.',
      },
      {
        title: 'Check flavor labels on each bowl',
        body:
          'Flavors can change, so always read the label on the front of each bowl before topping up or telling a guest what is available. Do not assume left/center/right flavors stay the same every week.',
      },
      {
        title: 'Refill — mix from concentrate',
        body:
          'When mixing from concentrate, follow the fill markings on the bottle to get the correct ratio of mix and water. Prepare the mix in a clean container if needed, then pour into the correct labeled bowl.',
      },
      {
        title: 'Refill — premixed from backstock',
        body:
          'When using premixed product from backstock, confirm the flavor matches the bowl label before pouring. Top up to the normal fill level without overfilling past the safe line in the bowl.',
      },
      {
        title: 'Top up during the week',
        body:
          'When a bowl runs low during the week, top it up normally using the correct mix for that flavor. Check the label first, then add product until the bowl is back to a normal serving level.',
      },
      {
        title: 'Sunday — keep bowls low for cleaning',
        body:
          'On Sundays, keep slush levels lower on purpose so bowls can be drained and deep-cleaned during the week when those tasks come up. Do not over-fill on Sunday if the bowl will need to be cleaned soon.',
      },
      {
        title: 'Dispensing for guests',
        body:
          'Pull the black dispensing handle forward to fill the cup. Use the correct POS item (Small, Medium, or Large Slush Puppie). Wipe any drips from the spout area and keep the drip tray clear during service.',
      },
    ],
  },
  {
    title: 'How to Clean the Slush Puppie',
    description:
      'Weekly deep clean for the 3-bowl Slush Puppie machines — inside/lid weeks and filter weeks for both #1 (Pepsi side) and #2 (hot dogs side).',
    autoAssignNewHires: true,
    kioskSignInRequired: false,
    includeOverviewImage: true,
    taskLink: { mode: 'existing_task', taskTitles: DEEP_CLEAN_TASK_TITLES, groupName: DEEP_CLEAN_GROUP },
    sections: {
      overview: {
        text:
          'Each Slush Puppie machine gets a weekly deep clean during the concession rotation — either an inside/lid clean or a filter clean. Machine #1 is closest to Pepsi; machine #2 is closest to hot dogs. Complete this training when your slushie deep-clean task appears in the queue.',
        image_url: null,
      },
      objectives: {
        text:
          'After this training you will know when to drain a bowl vs wipe in place, how to clean lids, bowls, augers, dispensing areas, drip trays, filters, and the exterior — then sanitize and return the unit to service.',
        image_url: null,
      },
      notes: {
        text:
          'If a bowl is low, drain it before deep cleaning. If it is still full, wipe and sanitize bowls and augers in place without emptying. Use warm soapy water, rinse, then concession sanitizer on all food-contact surfaces.',
        image_url: null,
      },
    },
    steps: [
      {
        title: 'Confirm which machine and task type',
        body:
          'Read your task title carefully. Inside & Lid tasks cover bowls, lids, dispensing area, drip tray, and exterior. Filter tasks add filter removal, rinsing, and reinstall. #1 is closest to Pepsi; #2 is closest to hot dogs.',
      },
      {
        title: 'Drain or wipe — depends on product level',
        body:
          'If the bowl is low, drain the remaining product before cleaning. If the bowl is still full, do not drain — wipe and sanitize the bowl and auger in place without removing them.',
      },
      {
        title: 'Remove and wash yellow lids',
        body:
          'Remove the yellow lid from each bowl you are cleaning. Wash with warm soapy water, rinse well, sanitize, and set aside to air dry while you clean the rest of the unit.',
      },
      {
        title: 'Clean bowls and augers in place',
        body:
          'With lids off, wipe the inside of the clear bowl and the spiral auger using warm soapy water and a cloth. Rinse with clean water, then sanitize. If the bowl was drained, take extra time on stuck-on residue along the auger and bowl walls.',
      },
      {
        title: 'Clean dispensing handles and spouts',
        body:
          'Wipe the black dispensing handles and clear spouts on each bowl you are cleaning. Remove sticky buildup around the spouts, rinse, and sanitize all customer-facing parts.',
      },
      {
        title: 'Clean the drip tray',
        body:
          'Remove the black drip tray at the bottom of the unit. Empty any liquid, wash with warm soapy water, rinse, sanitize, dry, and reinstall securely.',
      },
      {
        title: 'Wipe exterior, graphic panel, and legs',
        body:
          'Wipe the yellow side panels, front Slush Puppie graphic panel, black legs, and all exterior surfaces. Remove splashes and sticky spots, then sanitize touch areas.',
      },
      {
        title: 'Filter weeks — remove, rinse, and reinstall',
        body:
          'When your task includes the filter, remove the filter per the unit design, rinse away buildup under running water, sanitize, and reinstall securely before restarting normal operation. If you are unsure which filter belongs to which machine, ask a manager.',
      },
      {
        title: 'Clean the side vent grille',
        body:
          'Dust or vacuum the silver ventilation grille on the side of the unit. Do not block airflow — this keeps the compressor cooling properly.',
      },
      {
        title: 'Reassemble and return to service',
        body:
          'Reinstall lids, drip tray, and any filter parts. Refill drained bowls with the correct labeled flavor using mix markings or premixed backstock. Confirm augers are turning before leaving the unit in service.',
      },
    ],
  },
];

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

function buildSteps(steps) {
  return steps.map((step, index) => ({
    id: randomUUID(),
    order: index + 1,
    title: step.title,
    body: step.body,
    resource_url: null,
    image_url: step.image_url || null,
    file_url: null,
    is_required: true,
  }));
}

async function uploadOverviewImage(imagePath) {
  if (!imagePath || !existsSync(imagePath)) return null;

  const ext = path.extname(imagePath) || '.jpg';
  const storagePath = `${BIZ}/hr-training/overview/${randomUUID()}_slush-puppie${ext}`;
  const fileBuffer = readFileSync(imagePath);
  const contentType = ext.toLowerCase() === '.png'
    ? 'image/png'
    : ext.toLowerCase() === '.webp'
      ? 'image/webp'
      : 'image/jpeg';

  const { error: uploadError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(storagePath, fileBuffer, {
      cacheControl: '3600',
      upsert: false,
      contentType,
    });
  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(storagePath);
  return urlData?.publicUrl || null;
}

async function getOrCreateTrainingCategory() {
  const { data: existing } = await supabase
    .from('task_manager_categories')
    .select('id, name')
    .eq('business_id', BIZ)
    .ilike('name', 'Training')
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from('task_manager_categories')
    .insert({ business_id: BIZ, name: 'Training', sort_order: 10, is_active: true })
    .select('id')
    .single();
  if (error) throw error;
  return created.id;
}

async function findDeepCleanTasks(taskTitles) {
  const { data: group } = await supabase
    .from('task_manager_round_robin_groups')
    .select('id, name')
    .eq('business_id', BIZ)
    .ilike('name', DEEP_CLEAN_GROUP)
    .maybeSingle();

  if (!group) {
    throw new Error(`Round robin group "${DEEP_CLEAN_GROUP}" not found. Run seed-otwk-concession-deep-clean.mjs first.`);
  }

  const tasks = [];
  for (const title of taskTitles) {
    const { data: task, error } = await supabase
      .from('task_manager_tasks')
      .select('id, title, status')
      .eq('business_id', BIZ)
      .eq('round_robin_group_id', group.id)
      .ilike('title', title)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!task) {
      throw new Error(`Task "${title}" not found in ${DEEP_CLEAN_GROUP}. Run seed-otwk-concession-deep-clean.mjs first.`);
    }
    tasks.push(task);
  }

  return tasks;
}

async function upsertTrainingResource({ trainingItemId, taskId, title, description }) {
  const { data: existing } = await supabase
    .from('task_manager_training_resources')
    .select('id')
    .eq('business_id', BIZ)
    .eq('hr_training_item_id', trainingItemId)
    .eq('task_id', taskId)
    .maybeSingle();

  if (existing) {
    console.log(`  training resource already linked (${existing.id})`);
    return existing.id;
  }

  const { data: created, error } = await supabase
    .from('task_manager_training_resources')
    .insert({
      business_id: BIZ,
      task_id: taskId,
      template_id: null,
      hr_training_item_id: trainingItemId,
      title,
      resource_type: 'text',
      resource_url: null,
      content: description,
      is_required: true,
      created_by: null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return created.id;
}

async function seedModule(module, { overviewImageUrl, trainingCategoryId, linkedTasks }) {
  const { data: existing } = await supabase
    .from('hr_training_items')
    .select('id, title')
    .eq('business_id', BIZ)
    .eq('title', module.title)
    .maybeSingle();

  const sections = {
    ...module.sections,
    overview: {
      ...module.sections.overview,
      image_url: module.includeOverviewImage
        ? (overviewImageUrl || module.sections.overview.image_url)
        : module.sections.overview.image_url,
    },
  };

  const primaryTaskId = linkedTasks?.[0]?.id || null;

  const payload = {
    title: module.title,
    description: module.description,
    content: module.sections.notes.text,
    resource_url: null,
    sections,
    steps: buildSteps(module.steps),
    quiz: { enabled: false, questions: [] },
    requires_acknowledgement: true,
    is_active: true,
    task_manager_enabled: true,
    task_link_mode: module.taskLink.mode,
    task_manager_task_id: module.taskLink.mode === 'existing_task' ? primaryTaskId : null,
    task_category_id: module.taskLink.mode === 'create_task' ? trainingCategoryId : null,
    task_priority: 'medium',
    task_requires_completion: true,
    auto_assign_new_hires: module.autoAssignNewHires === true,
    kiosk_sign_in_required: module.kioskSignInRequired === true,
    updated_at: new Date().toISOString(),
  };

  let trainingId;
  if (existing) {
    const { data: updated, error } = await supabase
      .from('hr_training_items')
      .update(payload)
      .eq('id', existing.id)
      .select('id, title')
      .single();
    if (error) throw error;
    trainingId = updated.id;
    console.log(`Updated training: ${updated.title} (${updated.id})`);
  } else {
    const { data: inserted, error } = await supabase
      .from('hr_training_items')
      .insert({ ...payload, business_id: BIZ })
      .select('id, title')
      .single();
    if (error) throw error;
    trainingId = inserted.id;
    console.log(`Created training: ${inserted.title} (${inserted.id})`);
  }

  if (module.taskLink.mode === 'existing_task' && linkedTasks?.length) {
    for (const task of linkedTasks) {
      await upsertTrainingResource({
        trainingItemId: trainingId,
        taskId: task.id,
        title: module.title,
        description: module.description,
      });
      console.log(`  linked to task: ${task.title} (${task.id})`);
    }
  }

  return trainingId;
}

async function updateDeepCleanTaskInstructions(tasks) {
  const instructions =
    'Complete the HR training module "How to Clean the Slush Puppie" if you have not already. ' +
    'If a bowl is low, drain it; if full, wipe bowls and augers in place. Remove and wash lids, ' +
    'clean dispensing spouts and drip tray, wipe the exterior, and on filter weeks clean the filter. ' +
    'Use warm soapy water, rinse, sanitize, then refill and return to service.';

  for (const task of tasks) {
    const { error } = await supabase
      .from('task_manager_tasks')
      .update({ instructions, updated_at: new Date().toISOString() })
      .eq('id', task.id)
      .eq('business_id', BIZ);
    if (error) throw error;
    console.log(`Updated task instructions: ${task.title}`);
  }
}

function resolveImagePath() {
  const envPath = process.env.SLUSH_PUPPIE_IMAGE_PATH;
  if (envPath && existsSync(envPath)) return envPath;
  if (existsSync(DEFAULT_IMAGE)) return DEFAULT_IMAGE;
  return null;
}

async function main() {
  console.log('=== OTWK London Slush Puppie training seed ===\n');

  const imagePath = resolveImagePath();
  const overviewImageUrl = await uploadOverviewImage(imagePath);
  if (overviewImageUrl) {
    console.log('Uploaded overview image:', overviewImageUrl);
  } else {
    console.log('No Slush Puppie photo found — training created without overview photo.');
    console.log('  Place photo at Training Photos/images.jpg or set SLUSH_PUPPIE_IMAGE_PATH.');
  }

  const trainingCategoryId = await getOrCreateTrainingCategory();
  const deepCleanTasks = await findDeepCleanTasks(DEEP_CLEAN_TASK_TITLES);
  console.log(`Found ${deepCleanTasks.length} slushie deep-clean tasks\n`);

  for (const module of TRAINING_MODULES) {
    await seedModule(module, {
      overviewImageUrl,
      trainingCategoryId,
      linkedTasks: module.taskLink.mode === 'existing_task' ? deepCleanTasks : null,
    });
  }

  await updateDeepCleanTaskInstructions(deepCleanTasks);

  console.log('\nDone. Operate module gates kiosk sign-in; clean module shows on all slushie deep-clean tasks.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
