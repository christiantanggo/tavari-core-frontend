/**
 * Seed HR training modules for the BUNN CW Series coffee brewer (operate + clean).
 * Links the cleaning module to both weekly deep-clean tasks (machine + cup/lids rack).
 *
 * Run: node scripts/seed-otwk-coffee-machine-training.mjs
 * Optional: COFFEE_MACHINE_IMAGE_PATH=/path/to/Coffee machine.jpg
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_IMAGE = path.join(__dirname, '..', 'Training Photos', 'Coffee machine.jpg');

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const DEEP_CLEAN_GROUP = 'weekly concession deep clean';
const MEDIA_BUCKET = 'task-training-media';

const DEEP_CLEAN_TASK_TITLES = [
  'Clean coffee machine',
  'Clean rack for coffee cups & lids',
];

const TRAINING_MODULES = [
  {
    title: 'How to Operate the Coffee Machine',
    description:
      'Learn how to run the BUNN CW Series brewer — brew to order, use carafes and the hot water tap, and serve guests while the unit stays on.',
    autoAssignNewHires: true,
    kioskSignInRequired: true,
    includeOverviewImage: true,
    taskLink: { mode: 'create_task', categoryName: 'Training' },
    sections: {
      overview: {
        text:
          'The concession coffee brewer is a BUNN CW Series unit with a brew basket, spray head, thermal carafes, hot water tap, and READY light. The machine stays powered on — do not turn it off during normal operation.',
        image_url: null,
      },
      objectives: {
        text:
          'After this training you will know when to brew, how to make a pot using standard BUNN steps, how to tell guests about the ~5 minute wait, and how to use carafes, the hot water tap, and serving supplies.',
        image_url: null,
      },
      notes: {
        text:
          'Brew coffee only when a customer orders it — do not brew full pots ahead “just in case.” Never turn the BUNN off during open hours unless a manager directs it for maintenance.',
        image_url: null,
      },
    },
    steps: [
      {
        title: 'Leave the machine running',
        body:
          'Do not turn the BUNN coffee machine off during normal concession hours. It is meant to stay on so water stays at brew temperature. Only a manager should power it off for cleaning or maintenance.',
      },
      {
        title: 'Wait for the READY light',
        body:
          'Before brewing, confirm the green READY light is on. That means the machine is at the correct temperature. If READY is not lit, wait or tell a manager before starting a brew.',
      },
      {
        title: 'Brew only when a customer orders coffee',
        body:
          'Start a pot only when a guest orders coffee. Do not keep a full carafe sitting ready with no order. Each brew is made to order.',
      },
      {
        title: 'Standard BUNN brew steps',
        body:
          'Place a coffee filter in the black brew basket. Add the correct amount of grounds for a full pot (follow the posted brew chart or standard BUNN scoop amount for this unit). Slide the brew basket into place. Place an empty thermal carafe on the base plate under the basket. Start the brew using the machine controls and let the pot finish brewing into the carafe.',
      },
      {
        title: 'Tell the guest about the ~5 minute wait',
        body:
          'A fresh pot takes about 5 minutes. Let the customer know they can wait nearby, come back in about 5 minutes to pick up their coffee, or — if your location uses it — give them a number or pager to be called when the pot is ready.',
      },
      {
        title: 'Using thermal carafes',
        body:
          'Use the stainless thermal carafes with black lids for serving brewed coffee. A spare carafe may sit on top of the unit for storage. Pour from the carafe for the guest; do not leave the brew basket or an open carafe in the guest area unattended.',
      },
      {
        title: 'Hot water tap',
        body:
          'Use the hot water tap (red lever on the left) for tea, hot chocolate, or other hot-water drinks when ordered. Hold the cup securely and dispense carefully — the water is very hot.',
      },
      {
        title: 'Serving and POS',
        body:
          'Ring in the correct drink on the POS (Coffee, Tea, Hot Chocolate, etc.). Provide the correct cup, lid if needed, and stir sticks from the counter supplies.',
      },
      {
        title: 'Supplies location',
        body:
          'Filters, coffee grounds, cups, lids, and stir sticks are kept at the coffee station on the counter (cup stacks and stir sticks beside the machine). Restock from backstock when supplies run low and tell a manager if you are running out.',
      },
    ],
  },
  {
    title: 'How to Clean the Coffee Machine',
    description:
      'Weekly deep clean for the BUNN brewer and the coffee cup/lids rack — machine surfaces, brew area, carafes, and restocking cups and lids.',
    autoAssignNewHires: true,
    kioskSignInRequired: false,
    includeOverviewImage: true,
    taskLink: { mode: 'existing_task', taskTitles: DEEP_CLEAN_TASK_TITLES, groupName: DEEP_CLEAN_GROUP },
    sections: {
      overview: {
        text:
          'The coffee station gets a weekly deep clean during the concession rotation. Tasks may be listed as “Clean coffee machine” or “Clean rack for coffee cups & lids” — both use this same training. Complete it the first time either task comes up.',
        image_url: null,
      },
      objectives: {
        text:
          'After this training you will know how to clean the brew basket, spray head, drip area, carafes, hot water tap, exterior, and the cup/lids rack, then sanitize and restock.',
        image_url: null,
      },
      notes: {
        text:
          'Use warm soapy water, rinse, then concession sanitizer on all food-contact surfaces. The machine can stay powered on for exterior wiping; ask a manager before doing anything that requires unplugging.',
        image_url: null,
      },
    },
    steps: [
      {
        title: 'Which task is yours this week',
        body:
          'Your queue may show “Clean coffee machine” or “Clean rack for coffee cups & lids.” This training covers both. If you have already completed it for one task, you will not need to repeat it for the other.',
      },
      {
        title: 'Empty used grounds and filters',
        body:
          'Discard used coffee grounds and paper filters from the brew basket into the trash. Do not leave old grounds in the basket or on the counter.',
      },
      {
        title: 'Remove and wash the brew basket',
        body:
          'Remove the black brew basket / funnel. Wash with warm soapy water, rinse well, sanitize, and set aside to dry or reinstall when clean.',
      },
      {
        title: 'Wipe the spray head and brew area',
        body:
          'Wipe the spray head and the area around the brew basket with warm soapy water on a cloth. Remove coffee splashes and buildup, rinse with a clean damp cloth, then sanitize.',
      },
      {
        title: 'Clean the drip tray and base plate',
        body:
          'Wipe the base plate where the carafe sits and any drip tray area. Remove stains and sticky residue, rinse, and sanitize.',
      },
      {
        title: 'Wash thermal carafes and lids',
        body:
          'Wash each thermal carafe and lid with warm soapy water, rinse, sanitize, and air dry. Check inside for old coffee film before returning to service.',
      },
      {
        title: 'Wipe the hot water tap area',
        body:
          'Wipe the hot water tap, lever, and surrounding surface. Remove splashes and sanitize touch points.',
      },
      {
        title: 'Wipe exterior and control panel',
        body:
          'Wipe the stainless front, sides, top, and control panel (switches and READY light area). Do not spray water into electrical controls.',
      },
      {
        title: 'Clean the cup and lids rack',
        body:
          'When your task includes the cup/lids rack, remove cups and lids from the rack. Wipe all surfaces of the rack and counter area, sanitize, then restock cups and lids in a neat layout easy for staff and guests to reach.',
      },
      {
        title: 'Reassemble and return to service',
        body:
          'Reinstall the brew basket, return clean carafes, and confirm the READY light comes back on if the unit was briefly interrupted. Restock filters and supplies as needed.',
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
  const storagePath = `${BIZ}/hr-training/overview/${randomUUID()}_coffee-machine${ext}`;
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
  const machineInstructions =
    'Complete the HR training module "How to Clean the Coffee Machine" if you have not already. ' +
    'Empty grounds, wash the brew basket, wipe the spray head and drip area, wash carafes, ' +
    'wipe the hot water tap and exterior, sanitize, and return to service.';

  const rackInstructions =
    'Complete the HR training module "How to Clean the Coffee Machine" if you have not already. ' +
    'Remove cups and lids from the rack, wipe and sanitize all rack surfaces, then restock neatly. ' +
    'Also follow the machine cleaning steps when your task covers the full coffee station.';

  for (const task of tasks) {
    const instructions = task.title.toLowerCase().includes('rack')
      ? rackInstructions
      : machineInstructions;

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
  const envPath = process.env.COFFEE_MACHINE_IMAGE_PATH;
  if (envPath && existsSync(envPath)) return envPath;
  if (existsSync(DEFAULT_IMAGE)) return DEFAULT_IMAGE;
  return null;
}

async function main() {
  console.log('=== OTWK London coffee machine training seed ===\n');

  const imagePath = resolveImagePath();
  const overviewImageUrl = await uploadOverviewImage(imagePath);
  if (overviewImageUrl) {
    console.log('Uploaded overview image:', overviewImageUrl);
  } else {
    console.log('No coffee machine photo found — training created without overview photo.');
    console.log('  Place photo at Training Photos/Coffee machine.jpg or set COFFEE_MACHINE_IMAGE_PATH.');
  }

  const trainingCategoryId = await getOrCreateTrainingCategory();
  const deepCleanTasks = await findDeepCleanTasks(DEEP_CLEAN_TASK_TITLES);
  console.log(`Found ${deepCleanTasks.length} coffee deep-clean tasks\n`);

  for (const module of TRAINING_MODULES) {
    await seedModule(module, {
      overviewImageUrl,
      trainingCategoryId,
      linkedTasks: module.taskLink.mode === 'existing_task' ? deepCleanTasks : null,
    });
  }

  await updateDeepCleanTaskInstructions(deepCleanTasks);

  console.log('\nDone. Operate module gates kiosk sign-in; clean module shows on both coffee deep-clean tasks.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
