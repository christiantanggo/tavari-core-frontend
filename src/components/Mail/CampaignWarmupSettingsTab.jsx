import React, { useCallback, useEffect, useState } from 'react';
import { FiClock, FiSave } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import toast from 'react-hot-toast';
import { DEFAULT_GRADUAL_THROTTLE } from '../../helpers/Mail/campaignSendThrottle';

const CampaignWarmupSettingsTab = ({ businessId, businessName = '', canManage }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasSettingsRow, setHasSettingsRow] = useState(false);
  const [form, setForm] = useState({
    campaign_throttle_window_start_hour: DEFAULT_GRADUAL_THROTTLE.windowStartHour,
    campaign_throttle_window_end_hour: DEFAULT_GRADUAL_THROTTLE.windowEndHour,
    campaign_throttle_initial_rate_per_minute: DEFAULT_GRADUAL_THROTTLE.initialRatePerMinute,
    campaign_throttle_daily_increment: DEFAULT_GRADUAL_THROTTLE.dailyIncrement,
    campaign_throttle_max_rate_per_minute: DEFAULT_GRADUAL_THROTTLE.maxRatePerMinute,
  });

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('mail_settings')
        .select(
          'id, campaign_throttle_window_start_hour, campaign_throttle_window_end_hour, campaign_throttle_initial_rate_per_minute, campaign_throttle_daily_increment, campaign_throttle_max_rate_per_minute',
        )
        .eq('business_id', businessId)
        .maybeSingle();
      if (error) throw error;
      setHasSettingsRow(Boolean(data?.id));
      if (data) {
        setForm({
          campaign_throttle_window_start_hour:
            data.campaign_throttle_window_start_hour ?? DEFAULT_GRADUAL_THROTTLE.windowStartHour,
          campaign_throttle_window_end_hour:
            data.campaign_throttle_window_end_hour ?? DEFAULT_GRADUAL_THROTTLE.windowEndHour,
          campaign_throttle_initial_rate_per_minute:
            data.campaign_throttle_initial_rate_per_minute ?? DEFAULT_GRADUAL_THROTTLE.initialRatePerMinute,
          campaign_throttle_daily_increment:
            data.campaign_throttle_daily_increment ?? DEFAULT_GRADUAL_THROTTLE.dailyIncrement,
          campaign_throttle_max_rate_per_minute:
            data.campaign_throttle_max_rate_per_minute ?? DEFAULT_GRADUAL_THROTTLE.maxRatePerMinute,
        });
      }
    } catch (error) {
      console.error('Failed to load campaign warmup settings:', error);
      toast.error('Failed to load campaign warmup settings');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    if (!businessId || !canManage) return;
    setSaving(true);
    try {
      const throttleFields = {
        campaign_throttle_window_start_hour: form.campaign_throttle_window_start_hour,
        campaign_throttle_window_end_hour: form.campaign_throttle_window_end_hour,
        campaign_throttle_initial_rate_per_minute: form.campaign_throttle_initial_rate_per_minute,
        campaign_throttle_daily_increment: form.campaign_throttle_daily_increment,
        campaign_throttle_max_rate_per_minute: form.campaign_throttle_max_rate_per_minute,
        updated_at: new Date().toISOString(),
      };

      const { data: existing, error: selectError } = await supabase
        .from('mail_settings')
        .select('id')
        .eq('business_id', businessId)
        .maybeSingle();

      if (selectError) throw selectError;

      if (existing?.id) {
        const { error: updateError } = await supabase
          .from('mail_settings')
          .update(throttleFields)
          .eq('business_id', businessId);
        if (updateError) throw updateError;
      } else {
        const { data: biz, error: bizError } = await supabase
          .from('businesses')
          .select('name, business_email, business_address')
          .eq('id', businessId)
          .maybeSingle();

        if (bizError) throw bizError;

        const { data: authData } = await supabase.auth.getUser();
        const userEmail = authData?.user?.email?.trim() || '';

        const fromEmail =
          (biz?.business_email && String(biz.business_email).trim()) ||
          userEmail ||
          'noreply@tavarios.ca';

        const businessAddress =
          (biz?.business_address && String(biz.business_address).trim()) ||
          'Business Address Required for CASL';

        const { error: insertError } = await supabase.from('mail_settings').insert({
          business_id: businessId,
          from_name: (biz?.name && String(biz.name).trim()) || businessName || 'Business Name',
          from_email: fromEmail,
          reply_to: userEmail || null,
          business_address: businessAddress,
          social_links: {},
          session_timeout: 300,
          auto_retry_failed: true,
          max_retries: 3,
          max_child_age_for_automations: 12,
          ...throttleFields,
        });

        if (insertError) throw insertError;
        setHasSettingsRow(true);
      }

      toast.success('Campaign warmup rates saved. Active gradual sends use these values immediately.');
    } catch (error) {
      console.error('Failed to save campaign warmup settings:', error);
      toast.error(error.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: Number(value) }));
  };

  if (loading) {
    return <div style={styles.note}>Loading campaign warmup settings…</div>;
  }

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <FiClock size={22} />
        <div>
          <h2 style={styles.title}>Mass campaign warmup</h2>
          <p style={styles.subtitle}>
            Default rates for one-time mass campaigns (gradual send on Campaign Sender). Changes apply immediately
            to campaigns already sending (per-minute cap and window). Day ramp still uses each campaign&apos;s start date.
          </p>
        </div>
      </div>

      <div style={styles.grid}>
        <label style={styles.field}>
          <span>Send window start (hour, 24h)</span>
          <input
            type="number"
            min={0}
            max={23}
            value={form.campaign_throttle_window_start_hour}
            onChange={(e) => update('campaign_throttle_window_start_hour', e.target.value)}
            disabled={!canManage}
          />
        </label>
        <label style={styles.field}>
          <span>Send window end (hour, 24h)</span>
          <input
            type="number"
            min={1}
            max={24}
            value={form.campaign_throttle_window_end_hour}
            onChange={(e) => update('campaign_throttle_window_end_hour', e.target.value)}
            disabled={!canManage}
          />
        </label>
        <label style={styles.field}>
          <span>Day 1 emails per minute</span>
          <input
            type="number"
            min={1}
            max={500}
            value={form.campaign_throttle_initial_rate_per_minute}
            onChange={(e) => update('campaign_throttle_initial_rate_per_minute', e.target.value)}
            disabled={!canManage}
          />
        </label>
        <label style={styles.field}>
          <span>Increase per minute each day</span>
          <input
            type="number"
            min={0}
            max={100}
            value={form.campaign_throttle_daily_increment}
            onChange={(e) => update('campaign_throttle_daily_increment', e.target.value)}
            disabled={!canManage}
          />
        </label>
        <label style={styles.field}>
          <span>Max emails per minute</span>
          <input
            type="number"
            min={1}
            max={500}
            value={form.campaign_throttle_max_rate_per_minute}
            onChange={(e) => update('campaign_throttle_max_rate_per_minute', e.target.value)}
            disabled={!canManage}
          />
        </label>
      </div>

      {!hasSettingsRow && (
        <p style={styles.setupNote}>
          No mail sender profile saved yet. Saving here will create one using your business email, or complete{' '}
          <strong>Sender Profile</strong> first for full control.
        </p>
      )}

      <p style={styles.hint}>
        Example: {form.campaign_throttle_initial_rate_per_minute}/min on day 1, then{' '}
        {form.campaign_throttle_initial_rate_per_minute + form.campaign_throttle_daily_increment}/min on day 2, up to{' '}
        {form.campaign_throttle_max_rate_per_minute}/min, only between {form.campaign_throttle_window_start_hour}:00 and{' '}
        {form.campaign_throttle_window_end_hour}:00 local.
      </p>

      {canManage && (
        <button type="button" style={styles.saveButton} onClick={handleSave} disabled={saving}>
          <FiSave />
          {saving ? 'Saving…' : 'Save warmup settings'}
        </button>
      )}
    </div>
  );
};

const styles = {
  card: {
    backgroundColor: '#f0fdf9',
    border: '1px solid #99f6e4',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '24px',
  },
  header: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-start',
    marginBottom: '20px',
  },
  title: { margin: 0, fontSize: '20px', fontWeight: 700, color: '#111827' },
  subtitle: { margin: '6px 0 0', fontSize: '14px', color: '#4b5563', lineHeight: 1.5 },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '16px',
    marginBottom: '16px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    fontSize: '13px',
    fontWeight: 600,
    color: '#374151',
  },
  setupNote: {
    fontSize: '13px',
    color: '#92400e',
    backgroundColor: '#fffbeb',
    border: '1px solid #fcd34d',
    borderRadius: '8px',
    padding: '12px',
    marginBottom: '16px',
    lineHeight: 1.5,
  },
  hint: { fontSize: '13px', color: '#6b7280', marginBottom: '16px', lineHeight: 1.5 },
  note: { padding: '24px', color: '#6b7280' },
  saveButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 16px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#0d9488',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
  },
};

export default CampaignWarmupSettingsTab;
