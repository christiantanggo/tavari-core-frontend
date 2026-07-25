import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import toast from 'react-hot-toast';

const TRIGGER_TYPES = [
  { value: 'inactive_days', label: 'Inactive (no visit in X days)' },
  { value: 'never_purchased_category', label: 'Never bought / booked from category' },
  { value: 'never_purchased_inventory', label: 'Never bought specific POS item' },
  { value: 'has_category_not_category', label: 'Buys/books category A, never category B' },
  { value: 'never_booked_activity', label: 'Never booked specific activity' },
];

const REWARD_TYPES = [
  { value: 'bonus_points', label: 'Bonus points on next qualifying purchase' },
  { value: 'percent_discount', label: 'Percent discount' },
  { value: 'fixed_discount', label: 'Fixed dollar discount' },
];

const CATEGORY_SOURCES = [
  { value: 'booking', label: 'Booking category (Drop In, Day Camp, etc.)' },
  { value: 'pos', label: 'POS inventory category (café, merch, etc.)' },
];

function categorySourceLabel(value) {
  return CATEGORY_SOURCES.find((s) => s.value === value)?.label || value;
}

function bookingCategoryLabel(row) {
  return String(row?.display_name || row?.type_name || 'Category').trim();
}

function posCategoryLabel(row) {
  return String(row?.name || 'Category').trim();
}

function resolveCategoryLabel(source, categoryId, bookingCategories, posCategories) {
  if (!categoryId) return '';
  const list = source === 'booking' ? bookingCategories : posCategories;
  const row = list.find((c) => c.id === categoryId);
  if (!row) return categoryId;
  return source === 'booking' ? bookingCategoryLabel(row) : posCategoryLabel(row);
}

function defaultCategorySourceForTrigger(triggerType) {
  if (triggerType === 'never_purchased_category' || triggerType === 'has_category_not_category') {
    return 'booking';
  }
  return 'pos';
}

function emptyForm() {
  return {
    id: null,
    name: '',
    description: '',
    is_active: true,
    priority: 100,
    trigger_type: 'inactive_days',
    trigger_config: { inactive_days: 45 },
    reward_type: 'bonus_points',
    reward_config: { bonus_points: 500 },
    offer_valid_days: 14,
    max_active_per_customer: 1,
  };
}

function CategorySourceSelect({ value, onChange, styles, id }) {
  return (
    <select
      id={id}
      style={styles.select}
      value={value || 'booking'}
      onChange={(e) => onChange(e.target.value)}
    >
      {CATEGORY_SOURCES.map((s) => (
        <option key={s.value} value={s.value}>{s.label}</option>
      ))}
    </select>
  );
}

function CategoryPicker({ source, value, onChange, bookingCategories, posCategories, styles, placeholder }) {
  const list = source === 'booking' ? bookingCategories : posCategories;
  const labelFor = source === 'booking' ? bookingCategoryLabel : posCategoryLabel;

  return (
    <select style={styles.select} value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder || 'Select category'}</option>
      {list.map((c) => (
        <option key={c.id} value={c.id}>{labelFor(c)}</option>
      ))}
    </select>
  );
}

function summarizeRuleTrigger(rule, bookingCategories, posCategories) {
  const cfg = rule.trigger_config || {};
  switch (rule.trigger_type) {
    case 'inactive_days':
      return `${cfg.inactive_days ?? 45}+ days since last visit`;
    case 'never_purchased_category': {
      const source = cfg.category_source || 'pos';
      const name = resolveCategoryLabel(source, cfg.category_id, bookingCategories, posCategories);
      return `Never ${source === 'booking' ? 'booked' : 'bought'}: ${name || 'category'}`;
    }
    case 'never_purchased_inventory': {
      return 'Never bought specific POS item';
    }
    case 'has_category_not_category': {
      const hasSource = cfg.has_category_source || cfg.category_source || 'pos';
      const missingSource = cfg.missing_category_source || cfg.category_source || 'pos';
      const hasName = resolveCategoryLabel(hasSource, cfg.has_category_id, bookingCategories, posCategories);
      const missingName = resolveCategoryLabel(missingSource, cfg.missing_category_id, bookingCategories, posCategories);
      const verb = hasSource === 'booking' ? 'Books' : 'Buys';
      const missingVerb = missingSource === 'booking' ? 'never booked' : 'never bought';
      return `${verb} ${hasName || '?'}, ${missingVerb} ${missingName || '?'}`;
    }
    case 'never_booked_activity':
      return 'Never booked specific activity';
    default:
      return rule.trigger_type;
  }
}

function LoyaltyOfferRulesPanel({ businessId, canEdit }) {
  const [rules, setRules] = useState([]);
  const [posCategories, setPosCategories] = useState([]);
  const [bookingCategories, setBookingCategories] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm());
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [rulesRes, posCatRes, bookingCatRes, invRes, actRes] = await Promise.all([
        supabase.from('loyalty_offer_rules').select('*').eq('business_id', businessId).order('priority'),
        supabase.from('pos_categories').select('id, name').eq('business_id', businessId).order('name'),
        supabase.from('booking_types').select('id, type_name, display_name').eq('business_id', businessId).eq('is_active', true).order('display_name'),
        supabase.from('pos_inventory').select('id, name, category_id').eq('business_id', businessId).eq('is_active', true).order('name').limit(500),
        supabase.from('booking_activities').select('id, activity_name, type_id').eq('business_id', businessId).eq('is_active', true).order('activity_name'),
      ]);
      setRules(rulesRes.data || []);
      setPosCategories(posCatRes.data || []);
      setBookingCategories(bookingCatRes.data || []);
      setInventory(invRes.data || []);
      setActivities(actRes.data || []);
    } catch {
      toast.error('Could not load offer rules');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  function setTriggerField(key, value) {
    setForm((prev) => ({ ...prev, trigger_config: { ...prev.trigger_config, [key]: value } }));
  }

  function setRewardField(key, value) {
    setForm((prev) => ({ ...prev, reward_config: { ...prev.reward_config, [key]: value } }));
  }

  function handleTriggerTypeChange(nextType) {
    const defaults = { inactive_days: 45 };
    if (nextType === 'never_purchased_category') {
      defaults.category_source = 'booking';
    }
    if (nextType === 'has_category_not_category') {
      defaults.category_source = 'booking';
      defaults.has_category_source = 'booking';
      defaults.missing_category_source = 'booking';
    }
    setForm((prev) => ({
      ...prev,
      trigger_type: nextType,
      trigger_config: defaults,
    }));
  }

  async function saveRule() {
    if (!canEdit || !businessId) return;
    if (!form.name.trim()) {
      toast.error('Rule name is required');
      return;
    }

    const triggerConfig = { ...(form.trigger_config || {}) };
    if (form.trigger_type === 'never_purchased_category' && !triggerConfig.category_source) {
      triggerConfig.category_source = defaultCategorySourceForTrigger(form.trigger_type);
    }
    if (form.trigger_type === 'has_category_not_category') {
      triggerConfig.has_category_source = triggerConfig.has_category_source || triggerConfig.category_source || 'booking';
      triggerConfig.missing_category_source = triggerConfig.missing_category_source || triggerConfig.category_source || 'booking';
    }

    const payload = {
      business_id: businessId,
      name: form.name.trim(),
      description: form.description?.trim() || null,
      is_active: form.is_active !== false,
      priority: Number(form.priority) || 100,
      trigger_type: form.trigger_type,
      trigger_config: triggerConfig,
      reward_type: form.reward_type,
      reward_config: form.reward_config || {},
      offer_valid_days: Math.max(1, Number(form.offer_valid_days) || 14),
      max_active_per_customer: Math.max(1, Number(form.max_active_per_customer) || 1),
      updated_at: new Date().toISOString(),
    };
    const { error } = form.id
      ? await supabase.from('loyalty_offer_rules').update(payload).eq('id', form.id)
      : await supabase.from('loyalty_offer_rules').insert(payload);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(form.id ? 'Rule updated' : 'Rule created');
    setForm(emptyForm());
    setEditing(false);
    load();
  }

  async function deleteRule(id) {
    if (!canEdit || !window.confirm('Delete this offer rule?')) return;
    const { error } = await supabase.from('loyalty_offer_rules').delete().eq('id', id);
    if (error) toast.error(error.message);
    else {
      toast.success('Rule deleted');
      load();
    }
  }

  function startEdit(rule) {
    const cfg = { ...(rule.trigger_config || {}) };
    if (rule.trigger_type === 'never_purchased_category' && !cfg.category_source) {
      cfg.category_source = 'pos';
    }
    if (rule.trigger_type === 'has_category_not_category') {
      cfg.has_category_source = cfg.has_category_source || cfg.category_source || 'pos';
      cfg.missing_category_source = cfg.missing_category_source || cfg.category_source || 'pos';
    }
    setForm({
      id: rule.id,
      name: rule.name || '',
      description: rule.description || '',
      is_active: rule.is_active !== false,
      priority: rule.priority ?? 100,
      trigger_type: rule.trigger_type,
      trigger_config: cfg,
      reward_type: rule.reward_type,
      reward_config: rule.reward_config || {},
      offer_valid_days: rule.offer_valid_days ?? 14,
      max_active_per_customer: rule.max_active_per_customer ?? 1,
    });
    setEditing(true);
  }

  const categorySource = form.trigger_config.category_source || defaultCategorySourceForTrigger(form.trigger_type);
  const hasCategorySource = form.trigger_config.has_category_source || categorySource;
  const missingCategorySource = form.trigger_config.missing_category_source || categorySource;

  const styles = {
    section: { marginBottom: TavariStyles.spacing.xl },
    row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: TavariStyles.spacing.md, marginBottom: TavariStyles.spacing.md },
    label: { display: 'block', fontWeight: 600, marginBottom: 4, fontSize: 14 },
    input: { width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${TavariStyles.colors.gray300}` },
    select: { width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${TavariStyles.colors.gray300}` },
    card: { border: `1px solid ${TavariStyles.colors.gray200}`, borderRadius: 8, padding: TavariStyles.spacing.md, marginBottom: TavariStyles.spacing.sm },
    btn: { padding: '8px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600 },
    hint: { fontSize: 13, color: TavariStyles.colors.gray600, marginBottom: TavariStyles.spacing.md },
    callout: {
      fontSize: 13,
      color: TavariStyles.colors.gray700,
      background: TavariStyles.colors.gray50,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: 8,
      padding: TavariStyles.spacing.md,
      marginBottom: TavariStyles.spacing.md,
      lineHeight: 1.5,
    },
  };

  if (loading) return <p>Loading personalized offers…</p>;

  return (
    <div style={styles.section}>
      <h3 style={{ marginTop: 0 }}>Personalized offers</h3>
      <p style={styles.hint}>
        Rules run when customers open the Rewards tab in the app. Use <strong>booking categories</strong> for
        Drop In Play, Day Camp, parties, etc. Use <strong>POS inventory categories</strong> for café, merch, and
        register items. Discounts show in the app; staff apply them at checkout when the customer presents the offer.
      </p>

      {rules.map((rule) => (
        <div key={rule.id} style={styles.card}>
          <strong>{rule.name}</strong>
          {!rule.is_active ? <span style={{ marginLeft: 8, color: '#b45309' }}>(inactive)</span> : null}
          <div style={{ fontSize: 13, color: TavariStyles.colors.gray600, marginTop: 4 }}>
            {summarizeRuleTrigger(rule, bookingCategories, posCategories)}
            {' · '}
            Reward: {REWARD_TYPES.find((r) => r.value === rule.reward_type)?.label || rule.reward_type}
            {' · '}
            Valid {rule.offer_valid_days} days
          </div>
          {rule.description ? <div style={{ fontSize: 14, marginTop: 4 }}>{rule.description}</div> : null}
          {canEdit ? (
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button type="button" style={{ ...styles.btn, background: TavariStyles.colors.primary, color: '#fff' }} onClick={() => startEdit(rule)}>Edit</button>
              <button type="button" style={{ ...styles.btn, background: '#fee2e2', color: '#b91c1c' }} onClick={() => deleteRule(rule.id)}>Delete</button>
            </div>
          ) : null}
        </div>
      ))}

      {canEdit ? (
        <div style={{ ...styles.card, background: TavariStyles.colors.gray50 }}>
          <h4 style={{ marginTop: 0 }}>{editing ? 'Edit rule' : 'New rule'}</h4>
          <div style={styles.row}>
            <div>
              <label style={styles.label}>Name</label>
              <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label style={styles.label}>Priority (lower = first)</label>
              <input type="number" style={styles.input} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
            </div>
          </div>
          <div style={{ marginBottom: TavariStyles.spacing.md }}>
            <label style={styles.label}>Customer-facing description (optional)</label>
            <input style={styles.input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Shown in the app under the offer title" />
          </div>
          <div style={styles.row}>
            <div>
              <label style={styles.label}>Trigger</label>
              <select style={styles.select} value={form.trigger_type} onChange={(e) => handleTriggerTypeChange(e.target.value)}>
                {TRIGGER_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={styles.label}>Reward type</label>
              <select style={styles.select} value={form.reward_type} onChange={(e) => setForm({ ...form, reward_type: e.target.value })}>
                {REWARD_TYPES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>

          {form.trigger_type === 'inactive_days' ? (
            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <label style={styles.label}>Days since last visit or booking</label>
              <input type="number" min="1" style={styles.input} value={form.trigger_config.inactive_days ?? 45} onChange={(e) => setTriggerField('inactive_days', Number(e.target.value))} />
            </div>
          ) : null}

          {form.trigger_type === 'never_purchased_category' ? (
            <>
              <div style={styles.callout}>
                Choose whether this category comes from <strong>Bookings</strong> (Drop In, Day Camp, parties) or
                <strong> POS inventory</strong> (café, merch). Booking history includes confirmed and completed
                online/app bookings.
              </div>
              <div style={styles.row}>
                <div>
                  <label style={styles.label}>Category type</label>
                  <CategorySourceSelect
                    value={categorySource}
                    onChange={(v) => setTriggerField('category_source', v)}
                    styles={styles}
                  />
                </div>
                <div>
                  <label style={styles.label}>
                    {categorySource === 'booking' ? 'Booking category never booked' : 'POS category never purchased'}
                  </label>
                  <CategoryPicker
                    source={categorySource}
                    value={form.trigger_config.category_id || ''}
                    onChange={(v) => setTriggerField('category_id', v)}
                    bookingCategories={bookingCategories}
                    posCategories={posCategories}
                    styles={styles}
                    placeholder={categorySource === 'booking' ? 'Select booking category' : 'Select POS category'}
                  />
                </div>
              </div>
              {categorySource === 'booking' && bookingCategories.length === 0 ? (
                <p style={styles.hint}>No booking categories found. Add them under Bookings → Settings → Booking Categories.</p>
              ) : null}
            </>
          ) : null}

          {form.trigger_type === 'never_purchased_inventory' ? (
            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <label style={styles.label}>POS item they have never bought</label>
              <select style={styles.select} value={form.trigger_config.inventory_item_id || ''} onChange={(e) => setTriggerField('inventory_item_id', e.target.value)}>
                <option value="">Select item</option>
                {inventory.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
          ) : null}

          {form.trigger_type === 'has_category_not_category' ? (
            <>
              <div style={styles.callout}>
                Example: customer <strong>books Drop In Play</strong> but has <strong>never booked Day Camp</strong>.
                Set both sides to booking categories, or mix booking + POS if needed.
              </div>
              <div style={styles.row}>
                <div>
                  <label style={styles.label}>“Has” category type</label>
                  <CategorySourceSelect
                    value={hasCategorySource}
                    onChange={(v) => setTriggerField('has_category_source', v)}
                    styles={styles}
                  />
                </div>
                <div>
                  <label style={styles.label}>
                    {hasCategorySource === 'booking' ? 'Has booked category' : 'Has purchased category'}
                  </label>
                  <CategoryPicker
                    source={hasCategorySource}
                    value={form.trigger_config.has_category_id || ''}
                    onChange={(v) => setTriggerField('has_category_id', v)}
                    bookingCategories={bookingCategories}
                    posCategories={posCategories}
                    styles={styles}
                  />
                </div>
              </div>
              <div style={styles.row}>
                <div>
                  <label style={styles.label}>“Never” category type</label>
                  <CategorySourceSelect
                    value={missingCategorySource}
                    onChange={(v) => setTriggerField('missing_category_source', v)}
                    styles={styles}
                  />
                </div>
                <div>
                  <label style={styles.label}>
                    {missingCategorySource === 'booking' ? 'Never booked category' : 'Never purchased category'}
                  </label>
                  <CategoryPicker
                    source={missingCategorySource}
                    value={form.trigger_config.missing_category_id || ''}
                    onChange={(v) => setTriggerField('missing_category_id', v)}
                    bookingCategories={bookingCategories}
                    posCategories={posCategories}
                    styles={styles}
                  />
                </div>
              </div>
            </>
          ) : null}

          {form.trigger_type === 'never_booked_activity' ? (
            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <label style={styles.label}>Specific booking activity never booked</label>
              <select style={styles.select} value={form.trigger_config.activity_id || ''} onChange={(e) => setTriggerField('activity_id', e.target.value)}>
                <option value="">Select activity</option>
                {activities.map((a) => {
                  const cat = bookingCategories.find((c) => c.id === a.type_id);
                  const catLabel = cat ? ` · ${bookingCategoryLabel(cat)}` : '';
                  return (
                    <option key={a.id} value={a.id}>{a.activity_name}{catLabel}</option>
                  );
                })}
              </select>
              <p style={{ ...styles.hint, marginTop: 8 }}>
                Use this for a single activity (e.g. “Toddler Thursday”). For whole categories like Day Camp, use the category triggers above.
              </p>
            </div>
          ) : null}

          {form.reward_type === 'bonus_points' ? (
            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <label style={styles.label}>Bonus points</label>
              <input type="number" min="1" style={styles.input} value={form.reward_config.bonus_points ?? 500} onChange={(e) => setRewardField('bonus_points', Number(e.target.value))} />
            </div>
          ) : null}
          {form.reward_type === 'percent_discount' ? (
            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <label style={styles.label}>Percent off</label>
              <input type="number" min="1" max="100" style={styles.input} value={form.reward_config.percent_discount ?? 10} onChange={(e) => setRewardField('percent_discount', Number(e.target.value))} />
            </div>
          ) : null}
          {form.reward_type === 'fixed_discount' ? (
            <div style={{ marginBottom: TavariStyles.spacing.md }}>
              <label style={styles.label}>Dollar amount off</label>
              <input type="number" min="0.01" step="0.01" style={styles.input} value={form.reward_config.fixed_discount ?? 5} onChange={(e) => setRewardField('fixed_discount', Number(e.target.value))} />
            </div>
          ) : null}

          <div style={styles.row}>
            <div>
              <label style={styles.label}>Offer valid (days)</label>
              <input type="number" min="1" style={styles.input} value={form.offer_valid_days} onChange={(e) => setForm({ ...form, offer_valid_days: e.target.value })} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <TavariCheckbox checked={form.is_active} onChange={(c) => setForm({ ...form, is_active: c })} label="Active" />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={{ ...styles.btn, background: TavariStyles.colors.primary, color: '#fff' }} onClick={saveRule}>{editing ? 'Save changes' : 'Add rule'}</button>
            {editing ? (
              <button type="button" style={{ ...styles.btn, background: TavariStyles.colors.gray200 }} onClick={() => { setForm(emptyForm()); setEditing(false); }}>Cancel</button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default LoyaltyOfferRulesPanel;
