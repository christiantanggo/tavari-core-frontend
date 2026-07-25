/**
 * Move June 21 structure deep clean completions onto July 5 period tasks,
 * then cancel all June 21 period rows.
 *
 * Run: node scripts/migrate-otwk-structure-june-to-july-period.mjs
 * Apply: node scripts/migrate-otwk-structure-june-to-july-period.mjs --apply
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BIZ = 'cb982fca-cf7a-4f59-b9c7-55ca0364eddc';
const GROUP_NAME = 'structure deep clean list';
const OLD_PERIOD = '2026-06-21';
const NEW_PERIOD = '2026-07-05';
const APPLY = process.argv.includes('--apply');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data: group, error: groupErr } = await supabase
    .from('task_manager_round_robin_groups')
    .select('id, name')
    .eq('business_id', BIZ)
    .ilike('name', GROUP_NAME)
    .maybeSingle();
  if (groupErr) throw groupErr;
  if (!group) throw new Error(`Group not found: ${GROUP_NAME}`);

  const { data: oldTasks, error: oldErr } = await supabase
    .from('task_manager_tasks')
    .select('id, title, status, round_robin_slot_order, completed_by, completed_at, claimed_by, review_status, manager_review_required, completion_summary, peer_review_required')
    .eq('business_id', BIZ)
    .eq('round_robin_group_id', group.id)
    .eq('round_robin_week_start', OLD_PERIOD)
    .neq('status', 'cancelled');
  if (oldErr) throw oldErr;

  const { data: newTasks, error: newErr } = await supabase
    .from('task_manager_tasks')
    .select('id, title, status, round_robin_slot_order')
    .eq('business_id', BIZ)
    .eq('round_robin_group_id', group.id)
    .eq('round_robin_week_start', NEW_PERIOD)
    .neq('status', 'cancelled');
  if (newErr) throw newErr;

  const newBySlot = new Map((newTasks || []).map((t) => [t.round_robin_slot_order, t]));
  const doneOld = (oldTasks || []).filter((t) => t.status === 'done');
  const openOld = (oldTasks || []).filter((t) => t.status !== 'done');

  console.log('=== Structure deep clean period migration ===');
  console.log(`Old period: ${OLD_PERIOD} (${(oldTasks || []).length} active rows)`);
  console.log(`New period: ${NEW_PERIOD} (${(newTasks || []).length} active rows)`);
  console.log(`Completed to transfer: ${doneOld.length}`);
  console.log(`Incomplete to cancel: ${openOld.length}`);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const transfers = [];
  for (const oldTask of doneOld) {
    const newTask = newBySlot.get(oldTask.round_robin_slot_order);
    if (!newTask) {
      console.warn(`No July 5 match for slot ${oldTask.round_robin_slot_order}: ${oldTask.title}`);
      continue;
    }
    if (newTask.status === 'done') {
      console.warn(`July 5 task already done (slot ${oldTask.round_robin_slot_order}): ${newTask.title}`);
      continue;
    }

    const { data: completions, error: compErr } = await supabase
      .from('task_manager_completions')
      .select('*')
      .eq('task_id', oldTask.id)
      .order('completed_at', { ascending: false })
      .limit(1);
    if (compErr) throw compErr;

    const completion = completions?.[0] || null;
    transfers.push({ oldTask, newTask, completion });
  }

  for (const row of transfers) {
    console.log(
      `Transfer slot ${row.oldTask.round_robin_slot_order}: ${row.oldTask.title}` +
      ` → ${row.newTask.id.slice(0, 8)}… by ${row.oldTask.completed_by || row.completion?.employee_id || '?'}`
    );
  }

  if (!APPLY) {
    console.log(`\nDry run complete. ${transfers.length} completion(s) would transfer.`);
    console.log(`${(oldTasks || []).length} June 21 row(s) would be cancelled.`);
    console.log('Re-run with --apply to execute.');
    return;
  }

  let transferred = 0;
  for (const { oldTask, newTask, completion } of transfers) {
    const employeeId = completion?.employee_id || oldTask.completed_by;
    const completedAt = completion?.completed_at || oldTask.completed_at;
    if (!employeeId || !completedAt) {
      throw new Error(`Missing completer for ${oldTask.title}`);
    }

    const { data: newCompletion, error: insertCompErr } = await supabase
      .from('task_manager_completions')
      .insert({
        business_id: BIZ,
        task_id: newTask.id,
        employee_id: employeeId,
        notes: completion?.notes || null,
        evidence: completion?.evidence || {},
        completed_checklist: completion?.completed_checklist || [],
        completed_at: completedAt,
        form_submission_id: completion?.form_submission_id || null
      })
      .select('id')
      .single();
    if (insertCompErr) throw insertCompErr;

    const completionSummary = {
      ...(oldTask.completion_summary && typeof oldTask.completion_summary === 'object'
        ? oldTask.completion_summary
        : {}),
      completion_id: newCompletion.id,
      migrated_from_task_id: oldTask.id,
      migrated_from_period: OLD_PERIOD
    };

    const { error: updateTaskErr } = await supabase
      .from('task_manager_tasks')
      .update({
        status: 'done',
        claimed_by: oldTask.claimed_by || employeeId,
        completed_by: employeeId,
        completed_at: completedAt,
        review_status: oldTask.review_status || 'not_required',
        manager_review_required: !!oldTask.manager_review_required,
        completion_summary: completionSummary,
        handoff_notes: null,
        handoff_at: null,
        handoff_by: null,
        handoff_checklist: null
      })
      .eq('id', newTask.id)
      .eq('business_id', BIZ);
    if (updateTaskErr) throw updateTaskErr;

    if (completion?.id) {
      await supabase
        .from('task_manager_peer_review_pool')
        .update({ task_id: newTask.id, completion_id: newCompletion.id })
        .eq('completion_id', completion.id);

      await supabase
        .from('task_manager_reviews')
        .update({ task_id: newTask.id, completion_id: newCompletion.id })
        .eq('completion_id', completion.id);
    }

    await supabase.from('task_manager_activity').insert({
      business_id: BIZ,
      task_id: newTask.id,
      actor_id: employeeId,
      action: 'task_completion_migrated',
      details: {
        from_task_id: oldTask.id,
        from_period: OLD_PERIOD,
        to_period: NEW_PERIOD,
        slot_order: oldTask.round_robin_slot_order,
        title: oldTask.title
      }
    });

    transferred += 1;
  }

  const oldIds = (oldTasks || []).map((t) => t.id);
  const { error: cancelErr } = await supabase
    .from('task_manager_tasks')
    .update({ status: 'cancelled' })
    .in('id', oldIds)
    .eq('business_id', BIZ);
  if (cancelErr) throw cancelErr;

  console.log(`\nDone. Transferred ${transferred} completion(s) to ${NEW_PERIOD}.`);
  console.log(`Cancelled ${oldIds.length} row(s) from ${OLD_PERIOD}.`);

  const { data: verify } = await supabase
    .from('task_manager_tasks')
    .select('status')
    .eq('business_id', BIZ)
    .eq('round_robin_group_id', group.id)
    .eq('round_robin_week_start', OLD_PERIOD)
    .neq('status', 'cancelled');
  console.log(`Remaining active June 21 rows: ${verify?.length || 0}`);

  const { data: julyDone } = await supabase
    .from('task_manager_tasks')
    .select('id')
    .eq('business_id', BIZ)
    .eq('round_robin_group_id', group.id)
    .eq('round_robin_week_start', NEW_PERIOD)
    .eq('status', 'done');
  console.log(`July 5 done count: ${julyDone?.length || 0}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
