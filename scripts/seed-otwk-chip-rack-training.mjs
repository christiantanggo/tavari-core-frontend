/**
 * Seed HR training modules for the concession chip rack (stock + clean).
 * Links the cleaning module to the weekly "Clean chip rack table" deep-clean task.
 *
 * Run: node scripts/seed-otwk-chip-rack-training.mjs
 * Optional: CHIP_RACK_IMAGE_PATH=/path/to/Chip-Rack.jpeg
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_IMAGE = path.join(__dirname, '..', 'Training Photos', 'Chip-Rack.jpeg');
const FALLBACK_IMAGE = path.join(__dirname, '..', 'public', 'training-assets', 'otwk-chip-rack.jpeg');

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const DEEP_CLEAN_GROUP = 'weekly concession deep clean';
const DEEP_CLEAN_TASK_TITLE = 'Clean chip rack table (top, bottom, legs)';
const MEDIA_BUCKET = 'task-training-media';

const TRAINING_MODULES = [
  {
    title: 'How to Stock the Chip Rack',
    description:
      'Learn how to keep the three-tier chip rack full, organized, and facing the customer correctly — including busy-season additions and backstock locations.',
    autoAssignNewHires: true,
    kioskSignInRequired: true,
    includeOverviewImage: true,
    taskLink: { mode: 'create_task', categoryName: 'Training' },
    sections: {
      overview: {
        text:
          'The concession chip rack is a three-tier red wire display on the counter. Stock it when a shelf looks low or empty, or when new chip stock arrives. Always use FIFO (oldest bags to the front) and check expiry dates before placing bags on the rack.',
        image_url: null,
      },
      objectives: {
        text:
          'After this training you will know the standard shelf layout, busy-season additions, how to face English packaging toward the customer, where backstock goes by season, and what to remove first in slower months.',
        image_url: null,
      },
      notes: {
        text:
          'Fill each shelf — do not leave gaps. English packaging always faces out toward the customer. Ask a manager if you are unsure which season layout to use.',
        image_url: null,
      },
    },
    steps: [
      {
        title: 'When to stock',
        body:
          'Restock when a shelf looks low or empty, or when a new delivery of chips arrives. Pull from backstock before opening new cases when possible.',
      },
      {
        title: 'Check expiry and use FIFO',
        body:
          'Check best-before dates on every bag. Place older stock toward the front so it sells first. Do not put expired or damaged bags on the rack.',
      },
      {
        title: 'Face English packaging toward the customer',
        body:
          'Every bag on the rack should show the English side of the packaging facing out toward the customer. Turn bags around as you stock if needed.',
      },
      {
        title: 'Top shelf — standard layout',
        body:
          'Top shelf: Cheetos and Butter Popcorn (two flavors). Fill the shelf evenly across both products.',
      },
      {
        title: 'Top shelf — busy season addition',
        body:
          'During busier months, also add White Cheddar Popcorn on the top shelf. This is an addition — it does not replace Cheetos or Butter Popcorn.',
      },
      {
        title: 'Middle shelf — standard layout',
        body:
          'Middle shelf: Doritos only for now. Fill the shelf with Doritos during standard/slower periods.',
      },
      {
        title: 'Middle shelf — busy season addition',
        body:
          'During busier months, add Miss Vickie\'s Salt & Vinegar on the same middle shelf as Doritos.',
      },
      {
        title: 'Bottom shelf',
        body:
          'Bottom shelf: Ruffles All Dressed and Lay\'s Regular. These stay on the bottom shelf year-round.',
      },
      {
        title: 'Fill the shelf',
        body:
          'Add enough bags to fill the shelf width. The rack should look full and neat — not sparse with empty wire showing.',
      },
      {
        title: 'Slower months — what to remove first',
        body:
          'When switching back from busy season, remove Miss Vickie\'s Salt & Vinegar from the middle shelf first. Then remove either Butter Popcorn or White Cheddar Popcorn from the top shelf (whichever your manager directs for that period).',
      },
      {
        title: 'Backstock — busy season',
        body:
          'During the busy season, extra chip cases are stored under the counter on the chip table — chips are displayed on the table with more stock underneath.',
      },
      {
        title: 'Backstock — slow season',
        body:
          'During the slow season, chips move off the table to the cupboard counter beside the chip table. Use that location for backstock when stocking the rack.',
      },
    ],
  },
  {
    title: 'How to Clean the Chip Rack',
    description:
      'Weekly deep clean for the chip rack, table, and wall behind — remove bags, wipe all surfaces, sanitize, and restock.',
    autoAssignNewHires: true,
    kioskSignInRequired: false,
    includeOverviewImage: true,
    taskLink: { mode: 'existing_task', taskTitle: DEEP_CLEAN_TASK_TITLE, groupName: DEEP_CLEAN_GROUP },
    sections: {
      overview: {
        text:
          'The chip rack and chip table get a weekly deep clean during the concession deep-clean rotation. This is not a daily task — complete it when the "Clean chip rack table" task comes up in the queue.',
        image_url: null,
      },
      objectives: {
        text:
          'After this training you will know how to remove chips safely, clean the rack, table, legs, area under the rack, and the wall behind, then sanitize and restock.',
        image_url: null,
      },
      notes: {
        text:
          'Do not skip the area under the rack or the wall behind — crumbs and grease collect there. Restock using the "How to Stock the Chip Rack" procedure when finished.',
        image_url: null,
      },
    },
    steps: [
      {
        title: 'Remove all chip bags',
        body:
          'Take every bag off the rack and set them aside in a clean area so you can wipe all wire surfaces. Keep flavors grouped so restocking is easy.',
      },
      {
        title: 'Wipe all wire rack surfaces',
        body:
          'Wipe every bar and shelf on the red wire rack with warm soapy water, then follow with sanitizer. Include the sides and all customer-facing surfaces.',
      },
      {
        title: 'Wipe under the rack and the wall behind',
        body:
          'Wipe the counter under the rack and the wall directly behind the rack. Remove crumbs, dust, and any sticky residue.',
      },
      {
        title: 'Clean the table — top, bottom, and legs',
        body:
          'Wipe the chip table top, underside, and legs. This covers the full "Clean chip rack table (top, bottom, legs)" task area.',
      },
      {
        title: 'Sanitize and restock',
        body:
          'Sanitize all cleaned surfaces. Restock the rack following the stocking training — English packaging facing out, correct flavors per shelf, and fill each shelf.',
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

  const ext = path.extname(imagePath) || '.jpeg';
  const storagePath = `${BIZ}/hr-training/overview/${randomUUID()}_chip-rack${ext}`;
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

async function findDeepCleanTask(taskTitle) {
  const { data: group } = await supabase
    .from('task_manager_round_robin_groups')
    .select('id, name')
    .eq('business_id', BIZ)
    .ilike('name', DEEP_CLEAN_GROUP)
    .maybeSingle();

  if (!group) {
    throw new Error(`Round robin group "${DEEP_CLEAN_GROUP}" not found. Run seed-otwk-concession-deep-clean.mjs first.`);
  }

  const { data: task, error } = await supabase
    .from('task_manager_tasks')
    .select('id, title, status')
    .eq('business_id', BIZ)
    .eq('round_robin_group_id', group.id)
    .ilike('title', taskTitle)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!task) {
    throw new Error(`Task "${taskTitle}" not found in ${DEEP_CLEAN_GROUP}. Run seed-otwk-concession-deep-clean.mjs first.`);
  }

  return task;
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

async function seedModule(module, { overviewImageUrl, trainingCategoryId, deepCleanTaskId }) {
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
    task_manager_task_id: module.taskLink.mode === 'existing_task' ? deepCleanTaskId : null,
    task_category_id: module.taskLink.mode === 'create_task' ? trainingCategoryId : null,
    task_priority: 'medium',
    task_requires_completion: true,
    auto_assign_new_hires: module.autoAssignNewHires === true,
    kiosk_sign_in_required: module.kioskSignInRequired === true,
    updated_at: new Date().toISOString(),
  };

  let trainingId;
  if (existing) {
    let { data: updated, error } = await supabase
      .from('hr_training_items')
      .update(payload)
      .eq('id', existing.id)
      .select('id, title')
      .single();
    if (error?.code === 'PGRST204' && String(error.message || '').includes('kiosk_sign_in_required')) {
      const { kiosk_sign_in_required, ...fallbackPayload } = payload;
      ({ data: updated, error } = await supabase
        .from('hr_training_items')
        .update(fallbackPayload)
        .eq('id', existing.id)
        .select('id, title')
        .single());
      console.warn('  kiosk_sign_in_required column missing — apply migration 20260630150000_hr_training_kiosk_sign_in_required.sql');
    }
    if (error) throw error;
    trainingId = updated.id;
    console.log(`Updated training: ${updated.title} (${updated.id})`);
  } else {
    let { data: inserted, error } = await supabase
      .from('hr_training_items')
      .insert({ ...payload, business_id: BIZ })
      .select('id, title')
      .single();
    if (error?.code === 'PGRST204' && String(error.message || '').includes('kiosk_sign_in_required')) {
      const { kiosk_sign_in_required, ...fallbackPayload } = payload;
      ({ data: inserted, error } = await supabase
        .from('hr_training_items')
        .insert({ ...fallbackPayload, business_id: BIZ })
        .select('id, title')
        .single());
      console.warn('  kiosk_sign_in_required column missing — apply migration 20260630150000_hr_training_kiosk_sign_in_required.sql');
    }
    if (error) throw error;
    trainingId = inserted.id;
    console.log(`Created training: ${inserted.title} (${inserted.id})`);
  }

  if (module.taskLink.mode === 'existing_task' && deepCleanTaskId) {
    await upsertTrainingResource({
      trainingItemId: trainingId,
      taskId: deepCleanTaskId,
      title: module.title,
      description: module.description,
    });
    console.log(`  linked to task: ${DEEP_CLEAN_TASK_TITLE} (${deepCleanTaskId})`);
  }

  return trainingId;
}

async function updateDeepCleanTaskInstructions(taskId) {
  const instructions =
    'Complete the HR training module "How to Clean the Chip Rack" if you have not already. ' +
    'Remove all bags, wipe every wire surface on the rack, wipe under the rack and the wall behind, ' +
    'clean the table top/bottom/legs, sanitize, then restock with English packaging facing out.';

  const { error } = await supabase
    .from('task_manager_tasks')
    .update({ instructions, updated_at: new Date().toISOString() })
    .eq('id', taskId)
    .eq('business_id', BIZ);
  if (error) throw error;
  console.log('Updated deep-clean task instructions to reference training module.');
}

function resolveImagePath() {
  const envPath = process.env.CHIP_RACK_IMAGE_PATH;
  if (envPath && existsSync(envPath)) return envPath;
  if (existsSync(DEFAULT_IMAGE)) return DEFAULT_IMAGE;
  if (existsSync(FALLBACK_IMAGE)) return FALLBACK_IMAGE;
  return null;
}

async function main() {
  console.log('=== OTWK London chip rack training seed ===\n');

  const imagePath = resolveImagePath();
  const overviewImageUrl = await uploadOverviewImage(imagePath);
  if (overviewImageUrl) {
    console.log('Uploaded overview image:', overviewImageUrl);
  } else {
    console.log('No chip rack photo found — training created without overview photo.');
    console.log('  Place photo at Training Photos/Chip-Rack.jpeg or set CHIP_RACK_IMAGE_PATH.');
  }

  const trainingCategoryId = await getOrCreateTrainingCategory();
  const deepCleanTask = await findDeepCleanTask(DEEP_CLEAN_TASK_TITLE);
  console.log(`Found deep-clean task: ${deepCleanTask.title} (${deepCleanTask.id})\n`);

  for (const module of TRAINING_MODULES) {
    await seedModule(module, {
      overviewImageUrl,
      trainingCategoryId,
      deepCleanTaskId: deepCleanTask.id,
    });
  }

  await updateDeepCleanTaskInstructions(deepCleanTask.id);

  console.log('\nDone. Stock module gates kiosk sign-in; clean module shows on the linked deep-clean task.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
