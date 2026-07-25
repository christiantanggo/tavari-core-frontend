import { supabase } from '../../supabaseClient';

export async function loadInstruments(businessId) {
  const { data, error } = await supabase
    .from('div_instruments')
    .select('*')
    .eq('business_id', businessId)
    .eq('active', true)
    .order('ticker');
  if (error) throw error;
  return data || [];
}

export async function loadPortfolios(businessId) {
  const { data, error } = await supabase
    .from('div_portfolios')
    .select('*')
    .eq('business_id', businessId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createPortfolio(businessId, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Portfolio name is required');

  const existing = await loadPortfolios(businessId);
  const sortOrder = existing.length;

  const { data, error } = await supabase
    .from('div_portfolios')
    .insert({
      business_id: businessId,
      name: trimmed,
      sort_order: sortOrder,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function renamePortfolio(businessId, portfolioId, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Portfolio name is required');
  const { data, error } = await supabase
    .from('div_portfolios')
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq('id', portfolioId)
    .eq('business_id', businessId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function deletePortfolio(businessId, portfolioId) {
  const { error } = await supabase
    .from('div_portfolios')
    .delete()
    .eq('id', portfolioId)
    .eq('business_id', businessId);
  if (error) throw error;
}

export async function ensureDefaultPortfolio(businessId) {
  const list = await loadPortfolios(businessId);
  if (list.length > 0) return list;
  const created = await createPortfolio(businessId, 'My Holdings');
  return [created];
}

export async function loadHoldings(businessId, portfolioId = null) {
  let query = supabase
    .from('div_holdings')
    .select('*, instrument:div_instruments(*)')
    .eq('business_id', businessId)
    .order('created_at');
  if (portfolioId) {
    query = query.eq('portfolio_id', portfolioId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function upsertHolding(
  businessId,
  { id, portfolio_id, instrument_id, shares, avg_cost, notes }
) {
  if (!portfolio_id) throw new Error('portfolio_id is required');

  const payload = {
    business_id: businessId,
    portfolio_id,
    instrument_id,
    shares: Number(shares) || 0,
    avg_cost: avg_cost === '' || avg_cost == null ? null : Number(avg_cost),
    notes: notes || null,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    const { data, error } = await supabase
      .from('div_holdings')
      .update(payload)
      .eq('id', id)
      .eq('business_id', businessId)
      .select('*, instrument:div_instruments(*)')
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('div_holdings')
    .upsert(payload, { onConflict: 'portfolio_id,instrument_id' })
    .select('*, instrument:div_instruments(*)')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteHolding(businessId, holdingId) {
  const { error } = await supabase
    .from('div_holdings')
    .delete()
    .eq('id', holdingId)
    .eq('business_id', businessId);
  if (error) throw error;
}

export async function updateInstrumentFields(businessId, instrumentId, fields) {
  const allowed = [
    'expected_monthly_dividend',
    'last_price',
    'last_nav',
    'last_nav_date',
    'downside_protection',
    'variable_distribution',
    'stable_months',
    'disqualified_reason',
    'pays_monthly',
    'streak_bypass',
    'notes',
    'active',
  ];
  const patch = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      patch[key] = fields[key];
    }
  }

  const { data, error } = await supabase
    .from('div_instruments')
    .update(patch)
    .eq('id', instrumentId)
    .eq('business_id', businessId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function refreshQuotes(businessId) {
  const { data, error } = await supabase.functions.invoke('dividend-income-refresh-quotes', {
    body: { business_id: businessId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function loadProjectionScenarios(businessId) {
  const { data, error } = await supabase
    .from('div_projection_scenarios')
    .select('id, name, config, updated_at, created_at')
    .eq('business_id', businessId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function saveProjectionScenario(businessId, { id, name, config }) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Scenario name is required');
  if (!config || typeof config !== 'object') throw new Error('Scenario config is required');

  const payload = {
    business_id: businessId,
    name: trimmed,
    config,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    const { data, error } = await supabase
      .from('div_projection_scenarios')
      .update(payload)
      .eq('id', id)
      .eq('business_id', businessId)
      .select('id, name, config, updated_at, created_at')
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('div_projection_scenarios')
    .upsert(payload, { onConflict: 'business_id,name' })
    .select('id, name, config, updated_at, created_at')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProjectionScenario(businessId, scenarioId) {
  const { error } = await supabase
    .from('div_projection_scenarios')
    .delete()
    .eq('id', scenarioId)
    .eq('business_id', businessId);
  if (error) throw error;
}

