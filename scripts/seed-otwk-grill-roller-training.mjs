/**
 * Seed HR training modules for the Costway grill roller (operate + clean).
 * Links the cleaning module to the weekly "Clean grill roller" deep-clean task.
 *
 * Run: node scripts/seed-otwk-grill-roller-training.mjs
 * Optional: GRILL_ROLLER_IMAGE_PATH=/path/to/photo.png
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_IMAGE = path.join(__dirname, '..', 'public', 'training-assets', 'otwk-grill-roller-costway.jpg');

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const DEEP_CLEAN_GROUP = 'weekly concession deep clean';
const DEEP_CLEAN_TASK_TITLE = 'Clean grill roller';
const MEDIA_BUCKET = 'task-training-media';

const TRAINING_MODULES = [
  {
    title: 'How to Operate the Grill Roller',
    description:
      'Learn how to safely operate the Costway 18 hot dog roller grill — cook to order, handle food correctly, and shut down between orders.',
    autoAssignNewHires: true,
    kioskSignInRequired: true,
    includeOverviewImage: true,
    taskLink: { mode: 'create_task', categoryName: 'Training' },
    sections: {
      overview: {
        text:
          'The concession grill roller is a Costway 18 hot dog roller with front and back heat zones, a glass sneeze guard, and a drip tray. It holds up to 18 hot dogs, but we only cook what is ordered — never pre-load dogs "just in case."',
        image_url: null,
      },
      objectives: {
        text:
          'After this training you will know when to turn the grill on, how to set front/back temperatures, how long to cook hot dogs, how to handle them safely, how to prep for parties, and when to power off between orders.',
        image_url: null,
      },
      notes: {
        text:
          'Hot dogs only on this unit. Use tongs and gloves — never bare hands on the rollers or cooked dogs. If you are unsure the unit is safe to use, ask a manager before turning it on.',
        image_url: null,
      },
    },
    steps: [
      {
        title: 'Turn on only when there is an order',
        body:
          'Do not leave hot dogs on the grill without an order. When a guest orders hot dogs, turn the grill on. When there are no dogs on the grill and no pending orders, turn POWER off.',
      },
      {
        title: 'Power on and set temperatures (normal orders)',
        body:
          'Flip the red POWER switch on. Set the FRONT dial to about 400°F for fast cooking. Set the BACK dial to low / warm-hold — we usually cook one order at a time on the front rollers. You do not need to wait for the HEAT LIGHT indicators before loading; put dogs on once the unit is on.',
      },
      {
        title: 'Load the correct number on the front rollers',
        body:
          'Place hot dogs only on the front (high-heat) rollers. Load exactly the number ordered — for example, an order for 2 hot dogs means 2 dogs on the grill, not more.',
      },
      {
        title: 'Cook time',
        body:
          'At the normal front setting (~400°F), hot dogs are ready in about 8–10 minutes. Watch for even heating and rotation on the rollers.',
      },
      {
        title: 'Handle with tongs and gloves',
        body:
          'Use tongs to place and remove hot dogs. Wear gloves when handling cooked hot dogs for service. Never use bare hands on the rollers or on cooked product.',
      },
      {
        title: 'Power off between orders',
        body:
          'When all hot dogs are served and nothing remains on the grill, turn POWER off. Do not leave the unit running empty.',
      },
      {
        title: 'Party prep (~20 minutes ahead)',
        body:
          'For parties, turn the grill on about 20 minutes before food should be ready. Set both FRONT and BACK to about 300–350°F. Load all party hot dogs (up to 18 capacity). Continue using tongs and gloves.',
      },
    ],
  },
  {
    title: 'How to Clean the Grill Roller',
    description:
      'Daily close cleaning for rollers and drip tray, plus weekly deep clean steps for the guard, exterior, and under the unit.',
    autoAssignNewHires: true,
    kioskSignInRequired: false,
    taskLink: { mode: 'existing_task', taskTitle: DEEP_CLEAN_TASK_TITLE, groupName: DEEP_CLEAN_GROUP },
    sections: {
      overview: {
        text:
          'The grill roller needs a quick clean every close and a deeper clean during the weekly concession deep-clean rotation. Daily cleaning covers the rollers and drip tray. Deep cleaning adds the glass guard, full exterior, and the surface under the unit.',
        image_url: null,
      },
      objectives: {
        text:
          'After this training you will know the daily close procedure, the 50° roller-clean method, sanitizing steps, and the extra steps required for weekly deep cleaning.',
        image_url: null,
      },
      notes: {
        text:
          'Never clean a hot unit. POWER off and let rollers cool completely before daily cleaning. For deep cleaning, one person can slide the unit — unplug if needed, move carefully, and confirm it sits level when returned.',
        image_url: null,
      },
    },
    steps: [
      {
        title: 'Daily close — power off and cool down',
        body:
          'At close, ensure no hot dogs remain on the grill. Turn POWER off and wait until the rollers are completely cool to the touch.',
      },
      {
        title: 'Daily close — clean rollers at 50°',
        body:
          'Turn the unit back on and set the temperature to about 50°F so the rollers rotate slowly. Wipe the rollers with a cloth dampened in warm soapy water as they turn. Work around the full roller surface.',
      },
      {
        title: 'Daily close — sanitize rollers',
        body:
          'After the soapy wipe, sanitize the roller surfaces with your concession sanitizer and a clean cloth. Allow to air dry.',
      },
      {
        title: 'Daily close — drip tray',
        body:
          'Remove the drip tray, empty any liquid or debris, wash in the sink with warm soapy water, sanitize, dry, and reinstall securely.',
      },
      {
        title: 'Weekly deep clean — glass sneeze guard',
        body:
          'During the weekly "Clean grill roller" deep-clean task, wipe the glass sneeze guard inside and outside with warm soapy water. Clean the metal frame and remove grease splatter. Sanitize when finished.',
      },
      {
        title: 'Weekly deep clean — unit exterior and sides',
        body:
          'Wipe the front control panel, top surfaces, sides, and all accessible stainless exterior areas. Do not spray water into electrical controls.',
      },
      {
        title: 'Weekly deep clean — clean under the unit',
        body:
          'With the unit cool and POWER off (unplug if your location requires it), slide the grill roller forward. One person can move it. Sweep and wipe the counter or floor underneath, remove crumbs and grease buildup, sanitize the surface, then slide the unit back and confirm it is level and stable.',
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

  const ext = path.extname(imagePath) || '.png';
  const storagePath = `${BIZ}/hr-training/overview/${randomUUID()}_grill-roller${ext}`;
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

async function findDeepCleanGrillTask() {
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
    .ilike('title', DEEP_CLEAN_TASK_TITLE)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!task) {
    throw new Error(`Task "${DEEP_CLEAN_TASK_TITLE}" not found in ${DEEP_CLEAN_GROUP}. Run seed-otwk-concession-deep-clean.mjs first.`);
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
    'Complete the HR training module "How to Clean the Grill Roller" if you have not already. ' +
    'Daily: cool down, clean rollers at 50° with warm soapy water, sanitize, and wash the drip tray. ' +
    'Deep clean: also clean the glass guard, full exterior/sides, and slide the unit to clean underneath.';

  const { error } = await supabase
    .from('task_manager_tasks')
    .update({ instructions, updated_at: new Date().toISOString() })
    .eq('id', taskId)
    .eq('business_id', BIZ);
  if (error) throw error;
  console.log('Updated deep-clean task instructions to reference training module.');
}

async function main() {
  console.log('=== OTWK London grill roller training seed ===\n');

  const imagePath = process.env.GRILL_ROLLER_IMAGE_PATH || DEFAULT_IMAGE;
  const overviewImageUrl = await uploadOverviewImage(imagePath);
  if (overviewImageUrl) {
    console.log('Uploaded overview image:', overviewImageUrl);
  } else if (imagePath) {
    console.log('Image path provided but file not found — continuing without photo.');
  } else {
    console.log('No GRILL_ROLLER_IMAGE_PATH set — training created without overview photo.');
  }

  const trainingCategoryId = await getOrCreateTrainingCategory();
  const deepCleanTask = await findDeepCleanGrillTask();
  console.log(`Found deep-clean task: ${deepCleanTask.title} (${deepCleanTask.id})\n`);

  for (const module of TRAINING_MODULES) {
    await seedModule(module, {
      overviewImageUrl,
      trainingCategoryId,
      deepCleanTaskId: deepCleanTask.id,
    });
  }

  await updateDeepCleanTaskInstructions(deepCleanTask.id);

  console.log('\nDone. Assign modules from HR → Training Center when ready.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
