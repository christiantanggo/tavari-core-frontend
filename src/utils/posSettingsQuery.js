import { supabase } from '../supabaseClient';

/** Business-wide deposit settings — always stored on the row where terminal_id IS NULL. */
export const DEPOSIT_BUSINESS_SETTING_KEYS = [
  'max_drawer_variance',
  'require_manager_pin_for_variance',
  'deposit_history_requires_manager',
  'default_float_amount',
];

export function pickDepositBusinessSettings(settings = {}) {
  return DEPOSIT_BUSINESS_SETTING_KEYS.reduce((acc, key) => {
    if (settings[key] !== undefined && settings[key] !== null) {
      acc[key] = settings[key];
    }
    return acc;
  }, {});
}

/**
 * Load business-wide POS settings (terminal_id IS NULL).
 * Daily deposit and drawer float should always use this row.
 */
export async function fetchPosBusinessSettings(businessId, columns = '*') {
  if (!businessId) {
    return { data: null, error: null };
  }

  const { data, error } = await supabase
    .from('pos_settings')
    .select(columns)
    .eq('business_id', businessId)
    .is('terminal_id', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error && data) {
    return { data, error: null };
  }
  if (error && error.code !== 'PGRST116') {
    return { data: null, error };
  }

  return fetchPosSettingsForTerminal(businessId, null, columns);
}

/**
 * Load POS settings for a business, preferring a terminal-specific row when present.
 * Uses limit(1) so duplicate rows never trigger PostgREST 406 errors.
 */
export async function fetchPosSettingsForTerminal(businessId, terminalId = null, columns = '*') {
  if (!businessId) {
    return { data: null, error: null };
  }

  if (terminalId) {
    const { data, error } = await supabase
      .from('pos_settings')
      .select(columns)
      .eq('business_id', businessId)
      .eq('terminal_id', terminalId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      return { data, error: null };
    }
    if (error && error.code !== 'PGRST116') {
      return { data: null, error };
    }
  }

  const { data: businessDefault, error: businessError } = await supabase
    .from('pos_settings')
    .select(columns)
    .eq('business_id', businessId)
    .is('terminal_id', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!businessError && businessDefault) {
    return { data: businessDefault, error: null };
  }
  if (businessError && businessError.code !== 'PGRST116') {
    return { data: null, error: businessError };
  }

  const { data: fallback, error: fallbackError } = await supabase
    .from('pos_settings')
    .select(columns)
    .eq('business_id', businessId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return { data: fallback, error: fallbackError };
}

async function findPosSettingsRow(businessId, terminalId = null) {
  let query = supabase
    .from('pos_settings')
    .select('id')
    .eq('business_id', businessId);

  if (terminalId) {
    query = query.eq('terminal_id', terminalId);
  } else {
    query = query.is('terminal_id', null);
  }

  return query.order('updated_at', { ascending: false }).limit(1).maybeSingle();
}

/**
 * Insert or update exactly one pos_settings row (by primary key), avoiding 406s
 * when duplicate terminal rows exist in the database.
 */
export async function savePosSettingsForTerminal(businessId, terminalId, settingsPayload) {
  const { data: existing, error: findError } = await findPosSettingsRow(businessId, terminalId);

  if (findError && findError.code !== 'PGRST116') {
    return { data: null, error: findError };
  }

  const payload = {
    ...settingsPayload,
    business_id: businessId,
    terminal_id: terminalId || null,
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    return supabase
      .from('pos_settings')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .maybeSingle();
  }

  return supabase
    .from('pos_settings')
    .insert([payload])
    .select()
    .maybeSingle();
}
