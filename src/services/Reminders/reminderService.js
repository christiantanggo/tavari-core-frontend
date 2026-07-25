import { supabase } from '../../supabaseClient';

export async function listReminders(businessId) {
  const { data, error } = await supabase
    .from('tavari_reminders')
    .select(`
      *,
      tavari_reminder_staff_recipients ( user_id, users:user_id ( id, full_name, email ) )
    `)
    .eq('business_id', businessId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getReminder(reminderId) {
  const { data, error } = await supabase
    .from('tavari_reminders')
    .select(`
      *,
      tavari_reminder_staff_recipients ( user_id, users:user_id ( id, full_name, email ) )
    `)
    .eq('id', reminderId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveReminder(businessId, payload, reminderId = null) {
  const row = {
    business_id: businessId,
    title: payload.title.trim(),
    body: payload.body.trim(),
    schedule_type: payload.schedule_type,
    schedule_time: payload.schedule_time,
    schedule_day_of_week:
      payload.schedule_type === 'weekly'
      || payload.schedule_type === 'biweekly'
      || payload.schedule_type === 'monthly_weekday'
        ? payload.schedule_day_of_week
        : null,
    schedule_day_of_month:
      payload.schedule_type === 'monthly' || payload.schedule_type === 'quarterly'
        ? payload.schedule_day_of_month
        : null,
    schedule_week_of_month: payload.schedule_type === 'monthly_weekday' ? payload.schedule_week_of_month : null,
    schedule_once_date: payload.schedule_type === 'once' ? payload.schedule_once_date : null,
    starts_on: payload.starts_on,
    ends_on: payload.ends_on || null,
    max_occurrences: payload.max_occurrences ?? null,
    send_on_weekends: Boolean(payload.send_on_weekends),
    paused: Boolean(payload.paused),
    snooze_max: payload.snooze_max === '' || payload.snooze_max == null ? null : Number(payload.snooze_max),
    repeat_until_complete: payload.repeat_until_complete !== false,
    repeat_max: payload.repeat_max === '' || payload.repeat_max == null ? null : Number(payload.repeat_max),
    custom_links: payload.custom_links || [],
    manual_emails: payload.manual_emails || [],
  };

  let saved;
  if (reminderId) {
    const { data, error } = await supabase
      .from('tavari_reminders')
      .update(row)
      .eq('id', reminderId)
      .eq('business_id', businessId)
      .select('*')
      .single();
    if (error) throw error;
    saved = data;
  } else {
    const { data: auth } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('tavari_reminders')
      .insert({ ...row, created_by: auth?.user?.id || null })
      .select('*')
      .single();
    if (error) throw error;
    saved = data;
  }

  await supabase.from('tavari_reminder_staff_recipients').delete().eq('reminder_id', saved.id);

  const staffRows = (payload.staff_user_ids || []).map((userId) => ({
    reminder_id: saved.id,
    business_id: businessId,
    user_id: userId,
  }));

  if (staffRows.length > 0) {
    const { error: staffError } = await supabase.from('tavari_reminder_staff_recipients').insert(staffRows);
    if (staffError) throw staffError;
  }

  try {
    const { data: dispatchData, error: dispatchError } = await supabase.functions.invoke('reminder-dispatch', {
      body: { action: 'process', reminder_id: saved.id },
    });
    if (dispatchError) {
      console.warn('[reminderService] schedule dispatch failed:', dispatchError);
    } else if (dispatchData?.error) {
      console.warn('[reminderService] schedule dispatch:', dispatchData.error);
    }
  } catch (dispatchErr) {
    console.warn('[reminderService] schedule dispatch exception:', dispatchErr);
  }

  return saved;
}

export async function deleteReminder(reminderId, businessId) {
  const { error } = await supabase
    .from('tavari_reminders')
    .delete()
    .eq('id', reminderId)
    .eq('business_id', businessId);
  if (error) throw error;
}

export async function listDeliveryHistory(businessId, { reminderId, limit = 100 } = {}) {
  let query = supabase
    .from('tavari_reminder_deliveries')
    .select(`
      *,
      tavari_reminders ( title ),
      tavari_reminder_occurrences ( planned_date, send_at, status )
    `)
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (reminderId) query = query.eq('reminder_id', reminderId);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function listActiveReminderOccurrences(businessId) {
  const { data, error } = await supabase
    .from('tavari_reminder_occurrences')
    .select(`
      *,
      tavari_reminders (
        id,
        title,
        body,
        schedule_time,
        repeat_until_complete,
        repeat_max
      )
    `)
    .eq('business_id', businessId)
    .eq('status', 'sent')
    .order('next_repeat_at', { ascending: true, nullsFirst: false })
    .order('sent_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function listCompletedReminderOccurrences(businessId, { limit = 100 } = {}) {
  const { data, error } = await supabase
    .from('tavari_reminder_occurrences')
    .select(`
      *,
      tavari_reminders (
        id,
        title,
        body,
        schedule_time,
        repeat_until_complete,
        repeat_max
      )
    `)
    .eq('business_id', businessId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export async function completeReminderOccurrence(occurrenceId) {
  const { data, error } = await supabase.functions.invoke('reminder-action', {
    body: { action: 'complete', occurrence_id: occurrenceId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function uncompleteReminderOccurrence(occurrenceId) {
  const { data, error } = await supabase.functions.invoke('reminder-action', {
    body: { action: 'uncomplete', occurrence_id: occurrenceId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function sendTestReminder(reminderId, testEmail) {
  const { data, error } = await supabase.functions.invoke('reminder-dispatch', {
    body: { test_reminder_id: reminderId, test_email: testEmail },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function loadBusinessStaff(businessId) {
  const { data, error } = await supabase
    .from('business_users')
    .select('user_id, users!business_users_user_id_fkey ( id, full_name, email, employment_status )')
    .eq('business_id', businessId)
    .order('employee_order', { ascending: true });
  if (error) throw error;
  return (data || [])
    .map((row) => {
      const user = Array.isArray(row.users) ? row.users[0] : row.users;
      if (!user?.id) return null;
      if (user.employment_status === 'terminated') return null;
      return { id: user.id, full_name: user.full_name, email: user.email };
    })
    .filter(Boolean);
}

export function parseManualEmails(value) {
  return String(value || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}
