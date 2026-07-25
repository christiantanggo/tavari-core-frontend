import { supabase } from '../../supabaseClient';
import { DEFAULT_PLAN_SECTIONS } from '../../constants/fundingConstants';
import { saveReminder } from '../Reminders/reminderService';

function randomToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export async function getOrCreateSettings(businessId) {
  const { data, error } = await supabase
    .from('funding_settings')
    .select('*')
    .eq('business_id', businessId)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: created, error: insertError } = await supabase
    .from('funding_settings')
    .insert({ business_id: businessId })
    .select('*')
    .single();
  if (insertError) throw insertError;
  return created;
}

export async function saveSettings(businessId, patch) {
  const { data, error } = await supabase
    .from('funding_settings')
    .upsert({ business_id: businessId, ...patch }, { onConflict: 'business_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function getDashboardStats(businessId) {
  const [plansRes, appsRes, programsRes] = await Promise.all([
    supabase.from('funding_plans').select('id, status').eq('business_id', businessId),
    supabase.from('funding_applications').select('id, status, deadline_date').eq('business_id', businessId),
    supabase
      .from('funding_program_matches')
      .select('id')
      .eq('business_id', businessId)
      .eq('is_new', true)
      .is('dismissed_at', null),
  ]);
  if (plansRes.error) throw plansRes.error;
  if (appsRes.error) throw appsRes.error;
  if (programsRes.error) throw programsRes.error;

  const plans = plansRes.data || [];
  const apps = appsRes.data || [];
  const today = new Date().toISOString().slice(0, 10);

  return {
    plans: plans.length,
    applications: apps.length,
    activeDrafts: [...plans, ...apps].filter((r) => r.status === 'draft' || r.status === 'idea').length,
    submitted: apps.filter((r) => r.status === 'submitted').length,
    upcomingDeadlines: apps.filter((r) => r.deadline_date && r.deadline_date >= today && !['approved', 'denied', 'withdrawn'].includes(r.status)).length,
    newPrograms: (programsRes.data || []).length,
  };
}

export async function listPlans(businessId) {
  const { data, error } = await supabase
    .from('funding_plans')
    .select('*, funding_applications(id, title, status, application_type)')
    .eq('business_id', businessId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getPlan(businessId, planId) {
  const { data, error } = await supabase
    .from('funding_plans')
    .select(`
      *,
      funding_plan_sections (*),
      funding_scenarios (*),
      funding_applications (*),
      funding_checklist_items (*),
      funding_collaborators (*),
      funding_financial_snapshots (*),
      funding_plan_versions (id, version_number, created_at, created_by)
    `)
    .eq('business_id', businessId)
    .eq('id', planId)
    .maybeSingle();
  if (error) throw error;
  if (data?.funding_plan_sections) {
    data.funding_plan_sections.sort((a, b) => a.sort_order - b.sort_order);
  }
  if (data?.funding_scenarios) {
    data.funding_scenarios.sort((a, b) => a.sort_order - b.sort_order);
  }
  if (data?.funding_plan_versions) {
    data.funding_plan_versions.sort((a, b) => b.version_number - a.version_number);
  }
  return data;
}

export async function createPlan(businessId, payload = {}) {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('funding_plans')
    .insert({
      business_id: businessId,
      title: payload.title || 'Untitled business plan',
      summary: payload.summary || '',
      status: payload.status || 'idea',
      entity_scope: payload.entity_scope || 'current_business',
      target_business_name: payload.target_business_name || null,
      data_pull_config: payload.data_pull_config || {},
      created_by: auth?.user?.id || null,
    })
    .select('*')
    .single();
  if (error) throw error;

  const { error: seedError } = await supabase.rpc('funding_seed_plan_sections', {
    p_plan_id: data.id,
    p_business_id: businessId,
  });
  if (seedError) {
    // Fallback if RPC unavailable
    const rows = DEFAULT_PLAN_SECTIONS.map((s, i) => ({
      business_id: businessId,
      plan_id: data.id,
      section_key: s.section_key,
      title: s.title,
      enabled: true,
      sort_order: i + 1,
      content: '',
    }));
    await supabase.from('funding_plan_sections').insert(rows);
  }

  await supabase.from('funding_scenarios').insert({
    business_id: businessId,
    plan_id: data.id,
    name: 'Base scenario',
    scenario_type: payload.entity_scope === 'new_venture' ? 'new_venture' : 'current',
    sort_order: 0,
  });

  await snapshotPlanVersion(businessId, data.id);
  return data;
}

export async function updatePlan(businessId, planId, patch) {
  const { data, error } = await supabase
    .from('funding_plans')
    .update(patch)
    .eq('business_id', businessId)
    .eq('id', planId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function deletePlan(businessId, planId) {
  const { error } = await supabase
    .from('funding_plans')
    .delete()
    .eq('business_id', businessId)
    .eq('id', planId);
  if (error) throw error;
}

export async function updatePlanSection(businessId, sectionId, patch) {
  const { data, error } = await supabase
    .from('funding_plan_sections')
    .update(patch)
    .eq('business_id', businessId)
    .eq('id', sectionId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function snapshotPlanVersion(businessId, planId) {
  const plan = await getPlan(businessId, planId);
  if (!plan) return null;

  const { data: latest } = await supabase
    .from('funding_plan_versions')
    .select('version_number')
    .eq('plan_id', planId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const versionNumber = (latest?.version_number || 0) + 1;
  const { data: auth } = await supabase.auth.getUser();

  const snapshot = {
    plan: {
      title: plan.title,
      summary: plan.summary,
      status: plan.status,
      entity_scope: plan.entity_scope,
      target_business_name: plan.target_business_name,
      data_pull_config: plan.data_pull_config,
    },
    sections: (plan.funding_plan_sections || []).map((s) => ({
      section_key: s.section_key,
      title: s.title,
      enabled: s.enabled,
      content: s.content,
      sort_order: s.sort_order,
    })),
    scenarios: plan.funding_scenarios || [],
  };

  const { data, error } = await supabase
    .from('funding_plan_versions')
    .insert({
      business_id: businessId,
      plan_id: planId,
      version_number: versionNumber,
      snapshot,
      created_by: auth?.user?.id || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function saveScenario(businessId, planId, payload, scenarioId = null) {
  const row = {
    business_id: businessId,
    plan_id: planId,
    name: payload.name,
    scenario_type: payload.scenario_type || 'custom',
    assumptions: payload.assumptions || {},
    projections: payload.projections || {},
    sort_order: payload.sort_order ?? 0,
  };

  if (scenarioId) {
    const { data, error } = await supabase
      .from('funding_scenarios')
      .update(row)
      .eq('id', scenarioId)
      .eq('business_id', businessId)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase.from('funding_scenarios').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

export async function listApplications(businessId, { planId } = {}) {
  let query = supabase
    .from('funding_applications')
    .select('*, funding_plans(id, title)')
    .eq('business_id', businessId)
    .order('updated_at', { ascending: false });
  if (planId) query = query.eq('plan_id', planId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getApplication(businessId, applicationId) {
  const { data, error } = await supabase
    .from('funding_applications')
    .select(`
      *,
      funding_plans (id, title),
      funding_checklist_items (*),
      funding_application_answers (*),
      funding_collaborators (*),
      funding_financial_snapshots (*),
      funding_sensitive_fields (id, field_key, label, created_at, updated_at)
    `)
    .eq('business_id', businessId)
    .eq('id', applicationId)
    .maybeSingle();
  if (error) throw error;
  if (data?.funding_checklist_items) {
    data.funding_checklist_items.sort((a, b) => a.sort_order - b.sort_order);
  }
  return data;
}

export async function createApplication(businessId, payload = {}) {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('funding_applications')
    .insert({
      business_id: businessId,
      plan_id: payload.plan_id || null,
      title: payload.title || 'Untitled application',
      application_type: payload.application_type || 'grant',
      funder_name: payload.funder_name || '',
      status: payload.status || 'idea',
      amount_requested: payload.amount_requested ?? null,
      currency: payload.currency || 'CAD',
      deadline_date: payload.deadline_date || null,
      notes: payload.notes || '',
      data_pull_config: payload.data_pull_config || {},
      deductly_program_id: payload.deductly_program_id || null,
      created_by: auth?.user?.id || null,
    })
    .select('*')
    .single();
  if (error) throw error;

  if (payload.plan_id) {
    await supabase.from('funding_application_links').upsert({
      business_id: businessId,
      plan_id: payload.plan_id,
      application_id: data.id,
    }, { onConflict: 'plan_id,application_id' });
  }

  const defaultChecklist = [
    'Confirm eligibility',
    'Gather required documents',
    'Complete funder questions',
    'Review financials',
    'Owner final review',
    'Submit application',
  ];
  await supabase.from('funding_checklist_items').insert(
    defaultChecklist.map((title, i) => ({
      business_id: businessId,
      application_id: data.id,
      plan_id: payload.plan_id || null,
      title,
      sort_order: i + 1,
    }))
  );

  return data;
}

export async function updateApplication(businessId, applicationId, patch) {
  const next = { ...patch };
  if (patch.status === 'submitted' && !patch.submitted_at) {
    next.submitted_at = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from('funding_applications')
    .update(next)
    .eq('business_id', businessId)
    .eq('id', applicationId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteApplication(businessId, applicationId) {
  const { error } = await supabase
    .from('funding_applications')
    .delete()
    .eq('business_id', businessId)
    .eq('id', applicationId);
  if (error) throw error;
}

export async function linkApplicationToPlan(businessId, planId, applicationId) {
  const { error: linkError } = await supabase.from('funding_application_links').upsert({
    business_id: businessId,
    plan_id: planId,
    application_id: applicationId,
  }, { onConflict: 'plan_id,application_id' });
  if (linkError) throw linkError;

  const { error } = await supabase
    .from('funding_applications')
    .update({ plan_id: planId })
    .eq('id', applicationId)
    .eq('business_id', businessId);
  if (error) throw error;
}

export async function saveChecklistItem(businessId, payload, itemId = null) {
  const row = {
    business_id: businessId,
    plan_id: payload.plan_id || null,
    application_id: payload.application_id || null,
    title: payload.title,
    done: Boolean(payload.done),
    due_date: payload.due_date || null,
    sort_order: payload.sort_order ?? 0,
    reminder_id: payload.reminder_id || null,
  };

  if (itemId) {
    const { data, error } = await supabase
      .from('funding_checklist_items')
      .update(row)
      .eq('id', itemId)
      .eq('business_id', businessId)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase.from('funding_checklist_items').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

export async function listFunderTemplates(businessId) {
  const { data, error } = await supabase
    .from('funding_funder_templates')
    .select('*, funding_funder_questions (*)')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((t) => ({
    ...t,
    funding_funder_questions: (t.funding_funder_questions || []).sort((a, b) => a.sort_order - b.sort_order),
  }));
}

export async function saveFunderTemplate(businessId, payload, templateId = null) {
  const row = {
    business_id: businessId,
    name: payload.name,
    funder_type: payload.funder_type || 'grant',
    description: payload.description || '',
  };

  let saved;
  if (templateId) {
    const { data, error } = await supabase
      .from('funding_funder_templates')
      .update(row)
      .eq('id', templateId)
      .eq('business_id', businessId)
      .select('*')
      .single();
    if (error) throw error;
    saved = data;
  } else {
    const { data, error } = await supabase.from('funding_funder_templates').insert(row).select('*').single();
    if (error) throw error;
    saved = data;
  }

  if (Array.isArray(payload.questions)) {
    await supabase.from('funding_funder_questions').delete().eq('template_id', saved.id);
    if (payload.questions.length) {
      const { error: qError } = await supabase.from('funding_funder_questions').insert(
        payload.questions.map((q, i) => ({
          business_id: businessId,
          template_id: saved.id,
          question_key: q.question_key || `q_${i + 1}`,
          label: q.label,
          help_text: q.help_text || '',
          field_type: q.field_type || 'text',
          required: Boolean(q.required),
          sort_order: q.sort_order ?? i + 1,
        }))
      );
      if (qError) throw qError;
    }
  }

  return saved;
}

export async function saveApplicationAnswer(businessId, applicationId, answer) {
  const { data, error } = await supabase
    .from('funding_application_answers')
    .upsert({
      business_id: businessId,
      application_id: applicationId,
      question_id: answer.question_id || null,
      question_key: answer.question_key,
      label: answer.label || '',
      value_text: answer.value_text || '',
      value_json: answer.value_json ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'application_id,question_key' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function listCollaborators(businessId, { planId, applicationId } = {}) {
  let query = supabase.from('funding_collaborators').select('*').eq('business_id', businessId);
  if (planId) query = query.eq('plan_id', planId);
  if (applicationId) query = query.eq('application_id', applicationId);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function inviteCollaborator(businessId, payload) {
  const { data: auth } = await supabase.auth.getUser();
  const { data: collaborator, error } = await supabase
    .from('funding_collaborators')
    .insert({
      business_id: businessId,
      plan_id: payload.plan_id || null,
      application_id: payload.application_id || null,
      user_id: payload.user_id || null,
      guest_email: payload.guest_email || null,
      access_level: payload.access_level || 'view',
      can_see_financials: Boolean(payload.can_see_financials),
      invited_by: auth?.user?.id || null,
    })
    .select('*')
    .single();
  if (error) throw error;

  let guestLink = null;
  if (payload.guest_email) {
    const token = randomToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (payload.expires_days || 30));

    const { data: guestToken, error: tokenError } = await supabase
      .from('funding_guest_tokens')
      .insert({
        business_id: businessId,
        collaborator_id: collaborator.id,
        token,
        email: payload.guest_email,
        access_level: payload.access_level || 'view',
        can_see_financials: Boolean(payload.can_see_financials),
        plan_id: payload.plan_id || null,
        application_id: payload.application_id || null,
        expires_at: expiresAt.toISOString(),
      })
      .select('*')
      .single();
    if (tokenError) throw tokenError;

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    guestLink = `${origin}/funding/guest/${guestToken.token}`;
  }

  return { collaborator, guestLink };
}

export async function removeCollaborator(businessId, collaboratorId) {
  await supabase
    .from('funding_guest_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('collaborator_id', collaboratorId)
    .eq('business_id', businessId);

  const { error } = await supabase
    .from('funding_collaborators')
    .delete()
    .eq('id', collaboratorId)
    .eq('business_id', businessId);
  if (error) throw error;
}

export async function validateGuestToken(token) {
  const { data, error } = await supabase.rpc('funding_validate_guest_token', { p_token: token });
  if (error) throw error;
  return data;
}

export async function saveSensitiveField(businessId, payload) {
  const { data: cipher, error: encError } = await supabase.rpc('funding_encrypt_field', {
    p_plain: payload.value,
    p_business_id: businessId,
  });
  if (encError) throw encError;

  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('funding_sensitive_fields')
    .insert({
      business_id: businessId,
      plan_id: payload.plan_id || null,
      application_id: payload.application_id || null,
      field_key: payload.field_key,
      label: payload.label || payload.field_key,
      value_encrypted: cipher,
      created_by: auth?.user?.id || null,
    })
    .select('id, field_key, label, created_at, updated_at')
    .single();
  if (error) throw error;
  return data;
}

export async function decryptSensitiveField(businessId, fieldId) {
  const { data: row, error } = await supabase
    .from('funding_sensitive_fields')
    .select('value_encrypted')
    .eq('id', fieldId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;

  const { data, error: decError } = await supabase.rpc('funding_decrypt_field', {
    p_cipher: row.value_encrypted,
    p_business_id: businessId,
  });
  if (decError) throw decError;
  return data;
}

export async function saveFinancialSnapshot(businessId, payload, snapshotId = null) {
  const row = {
    business_id: businessId,
    plan_id: payload.plan_id || null,
    application_id: payload.application_id || null,
    scenario_id: payload.scenario_id || null,
    source_type: payload.source_type || 'projection',
    label: payload.label || 'Financials',
    enabled_fields: payload.enabled_fields || {},
    data: payload.data || {},
  };

  if (snapshotId) {
    const { data, error } = await supabase
      .from('funding_financial_snapshots')
      .update(row)
      .eq('id', snapshotId)
      .eq('business_id', businessId)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase.from('funding_financial_snapshots').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

export async function pullBusinessProfile(businessId) {
  const { data, error } = await supabase
    .from('businesses')
    .select('id, name, business_email, business_phone, business_website, business_address, city, state, postal_code, tax_number, timezone, operating_hours, holiday_hours')
    .eq('id', businessId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createDeadlineReminder(businessId, {
  title,
  body,
  onceDate,
  staffUserIds = [],
  manualEmails = [],
}) {
  return saveReminder(businessId, {
    title,
    body: body || title,
    schedule_type: 'once',
    schedule_time: '09:00',
    schedule_once_date: onceDate,
    starts_on: onceDate,
    ends_on: onceDate,
    send_on_weekends: true,
    paused: false,
    snooze_max: 2,
    repeat_until_complete: true,
    custom_links: [],
    manual_emails: manualEmails,
    staff_user_ids: staffUserIds,
  });
}

export async function listProgramMatches(businessId, { includeDismissed = false } = {}) {
  let query = supabase
    .from('funding_program_matches')
    .select('*')
    .eq('business_id', businessId)
    .order('is_new', { ascending: false })
    .order('last_seen_at', { ascending: false });
  if (!includeDismissed) query = query.is('dismissed_at', null);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function dismissProgramMatch(businessId, matchId) {
  const { error } = await supabase
    .from('funding_program_matches')
    .update({ dismissed_at: new Date().toISOString(), is_new: false })
    .eq('id', matchId)
    .eq('business_id', businessId);
  if (error) throw error;
}

export async function markProgramSeen(businessId, matchId) {
  const { error } = await supabase
    .from('funding_program_matches')
    .update({ is_new: false })
    .eq('id', matchId)
    .eq('business_id', businessId);
  if (error) throw error;
}

export async function upsertProgramMatches(businessId, programs) {
  const now = new Date().toISOString();
  const results = [];

  for (const program of programs) {
    const { data: existing } = await supabase
      .from('funding_program_matches')
      .select('id')
      .eq('business_id', businessId)
      .eq('deductly_program_id', program.id)
      .maybeSingle();

    const row = {
      business_id: businessId,
      deductly_program_id: program.id,
      name: program.name,
      program_type: program.type || null,
      description: program.description || '',
      estimated_value: program.estimated_value || null,
      application_url: program.application_url || null,
      deadline: program.deadline || null,
      eligibility: program.eligibility || {},
      raw: program,
      last_seen_at: now,
      is_new: !existing,
    };

    const { data, error } = await supabase
      .from('funding_program_matches')
      .upsert(row, { onConflict: 'business_id,deductly_program_id' })
      .select('*')
      .single();
    if (error) throw error;
    results.push(data);
  }

  return results;
}

export async function generateAiContent({ mode, sectionTitle, currentContent, businessContext, tone }) {
  const { data, error } = await supabase.functions.invoke('funding-ai-write', {
    body: {
      mode,
      section_title: sectionTitle,
      current_content: currentContent || '',
      business_context: businessContext || {},
      tone: tone || 'professional Canadian business English',
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data?.content || '';
}

export function buildExportHtml({ title, sections = [], meta = {} }) {
  const enabled = sections.filter((s) => s.enabled !== false);
  const body = enabled
    .map(
      (s) => `
      <section style="margin-bottom:28px;">
        <h2 style="font-family:Georgia,serif;color:#0f172a;border-bottom:1px solid #e2e8f0;padding-bottom:8px;">${escapeHtml(s.title)}</h2>
        <div style="font-family:system-ui,sans-serif;line-height:1.6;color:#334155;white-space:pre-wrap;">${escapeHtml(s.content || '')}</div>
      </section>`
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="max-width:800px;margin:40px auto;padding:0 24px;">
  <h1 style="font-family:Georgia,serif;">${escapeHtml(title)}</h1>
  <p style="color:#64748b;font-family:system-ui,sans-serif;">
    ${escapeHtml(meta.funder_name || '')}
    ${meta.status ? ` · Status: ${escapeHtml(meta.status)}` : ''}
    ${meta.generated_at ? ` · ${escapeHtml(meta.generated_at)}` : ''}
  </p>
  ${body}
</body>
</html>`;
}

export function downloadTextFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function listBusinessStaff(businessId) {
  const { data, error } = await supabase
    .from('business_users')
    .select('user_id, role, users:user_id ( id, full_name, email )')
    .eq('business_id', businessId);
  if (error) throw error;
  return (data || []).map((row) => ({
    user_id: row.user_id,
    role: row.role,
    full_name: row.users?.full_name || '',
    email: row.users?.email || '',
  }));
}
