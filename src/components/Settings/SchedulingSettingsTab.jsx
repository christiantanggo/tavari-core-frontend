import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import toast from 'react-hot-toast';

const defaultSettings = {
  shift_lead_enabled: true,
  shift_lead_position: 'Shift Lead',
  shift_lead_mode: 'relative',
  shift_lead_fixed_start: '',
  shift_lead_grace_before_open: 0,
  shift_lead_grace_after_close: 0,
  shift_lead_excluded_positions: ['President / CEO', 'Manager'],
  after_hours_enabled: true,
  after_hours_position: 'After Hours',
  after_hours_mode: 'relative',
  after_hours_fixed_start: '',
  after_hours_grace_after_close: 0,
  default_max_hours: 44,
  time_clock_geofence_enabled: false,
  time_clock_geofence_latitude: '',
  time_clock_geofence_longitude: '',
  time_clock_geofence_radius_meters: 150,
  time_clock_late_grace_minutes: 5,
  time_clock_early_clock_out_grace_minutes: 5,
  allow_employee_app_unscheduled_clock_in: true,
  time_off_max_people_per_day: '',
  time_off_blackout_dates_text: ''
};

const SchedulingSettingsTab = ({
  businessId,
  operatingHours,
  initialSettings,
  onSettingsUpdated,
  onShowSuccess
}) => {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(defaultSettings);
  const [statusBanner, setStatusBanner] = useState(null);

  useEffect(() => {
    if (initialSettings) {
      setForm({
        shift_lead_enabled: initialSettings.shift_lead_enabled,
        shift_lead_position: initialSettings.shift_lead_position || 'Shift Lead',
        shift_lead_mode: initialSettings.shift_lead_mode || 'relative',
        shift_lead_fixed_start: formatTimeInput(initialSettings.shift_lead_fixed_start),
        shift_lead_grace_before_open: initialSettings.shift_lead_grace_before_open ?? 0,
        shift_lead_grace_after_close: initialSettings.shift_lead_grace_after_close ?? 0,
        shift_lead_excluded_positions: (initialSettings.shift_lead_excluded_positions && initialSettings.shift_lead_excluded_positions.length > 0)
          ? initialSettings.shift_lead_excluded_positions
          : ['President / CEO', 'Manager'],
        after_hours_enabled: initialSettings.after_hours_enabled,
        after_hours_position: initialSettings.after_hours_position || 'After Hours',
        after_hours_mode: initialSettings.after_hours_mode || 'relative',
        after_hours_fixed_start: formatTimeInput(initialSettings.after_hours_fixed_start),
        after_hours_grace_after_close: initialSettings.after_hours_grace_after_close ?? 0,
        default_max_hours: initialSettings.default_max_hours ?? 44,
        time_clock_geofence_enabled: initialSettings.time_clock_geofence_enabled ?? false,
        time_clock_geofence_latitude: initialSettings.time_clock_geofence_latitude ?? '',
        time_clock_geofence_longitude: initialSettings.time_clock_geofence_longitude ?? '',
        time_clock_geofence_radius_meters: initialSettings.time_clock_geofence_radius_meters ?? 150,
        time_clock_late_grace_minutes: initialSettings.time_clock_late_grace_minutes ?? 5,
        time_clock_early_clock_out_grace_minutes: initialSettings.time_clock_early_clock_out_grace_minutes ?? 5,
        allow_employee_app_unscheduled_clock_in: initialSettings.allow_employee_app_unscheduled_clock_in ?? true,
        time_off_max_people_per_day:
          initialSettings.time_off_max_people_per_day != null && initialSettings.time_off_max_people_per_day !== ''
            ? String(initialSettings.time_off_max_people_per_day)
            : '',
        time_off_blackout_dates_text: formatBlackoutDatesForForm(initialSettings.time_off_blackout_dates)
      });
    } else {
      setForm(defaultSettings);
    }
  }, [initialSettings]);

  const excludedPositionsString = useMemo(
    () => (form.shift_lead_excluded_positions || []).join(', '),
    [form.shift_lead_excluded_positions]
  );

  const handleChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleExcludedPositionsChange = (value) => {
    const positions = value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    setForm((prev) => ({ ...prev, shift_lead_excluded_positions: positions }));
  };

  const formatOperatingHoursMessage = () => {
    if (!operatingHours) return 'Operating hours have not been configured yet.';
    const sampleDay = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].find((day) => operatingHours[day]);
    if (!sampleDay) return 'Operating hours have not been configured yet.';
    const day = operatingHours[sampleDay];
    if (day.closed) return 'This business is closed on the selected day.';
    return `Example hours: ${formatDisplayTime(day.open)} - ${formatDisplayTime(day.close)} (from ${capitalize(sampleDay)})`;
  };

  const handleSave = async () => {
    if (!businessId) {
      toast.error('Business not selected');
      setStatusBanner({ type: 'error', message: 'Business not selected' });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        business_id: businessId,
        shift_lead_enabled: form.shift_lead_enabled,
        shift_lead_position: form.shift_lead_position?.trim() || 'Shift Lead',
        shift_lead_mode: form.shift_lead_mode,
        shift_lead_fixed_start: form.shift_lead_mode === 'fixed' && form.shift_lead_fixed_start ? `${form.shift_lead_fixed_start}:00` : null,
        shift_lead_grace_before_open: toInteger(form.shift_lead_grace_before_open),
        shift_lead_grace_after_close: toInteger(form.shift_lead_grace_after_close),
        shift_lead_excluded_positions: form.shift_lead_excluded_positions?.length ? form.shift_lead_excluded_positions : ['President / CEO', 'Manager'],
        after_hours_enabled: form.after_hours_enabled,
        after_hours_position: form.after_hours_position?.trim() || 'After Hours',
        after_hours_mode: form.after_hours_mode,
        after_hours_fixed_start: form.after_hours_mode === 'fixed' && form.after_hours_fixed_start ? `${form.after_hours_fixed_start}:00` : null,
        after_hours_grace_after_close: toInteger(form.after_hours_grace_after_close),
        default_max_hours: toInteger(form.default_max_hours) || 44,
        time_clock_geofence_enabled: form.time_clock_geofence_enabled,
        time_clock_geofence_latitude: form.time_clock_geofence_enabled && form.time_clock_geofence_latitude !== '' ? Number(form.time_clock_geofence_latitude) : null,
        time_clock_geofence_longitude: form.time_clock_geofence_enabled && form.time_clock_geofence_longitude !== '' ? Number(form.time_clock_geofence_longitude) : null,
        time_clock_geofence_radius_meters: toInteger(form.time_clock_geofence_radius_meters) || 150,
        time_clock_late_grace_minutes: toInteger(form.time_clock_late_grace_minutes) ?? 5,
        time_clock_early_clock_out_grace_minutes: toInteger(form.time_clock_early_clock_out_grace_minutes) ?? 5,
        allow_employee_app_unscheduled_clock_in: form.allow_employee_app_unscheduled_clock_in,
        time_off_max_people_per_day: parseMaxPeoplePerDay(form.time_off_max_people_per_day),
        time_off_blackout_dates: parseBlackoutDatesFromText(form.time_off_blackout_dates_text),
      };

      const { data, error } = await supabase
        .from('scheduling_settings')
        .upsert(payload, { onConflict: 'business_id' })
        .select()
        .single();

      if (error) throw error;

      toast.success('Scheduling settings saved');
      setStatusBanner({ type: 'success', message: 'Scheduling settings saved successfully.' });
      if (onSettingsUpdated) onSettingsUpdated(data);
      if (onShowSuccess) onShowSuccess();
    } catch (error) {
      console.error('Error saving scheduling settings:', error);
      toast.error(error.message || 'Failed to save scheduling settings');
      setStatusBanner({ type: 'error', message: error.message || 'Failed to save scheduling settings.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.wrapper}>
      {statusBanner && (
        <div
          style={{
            ...styles.statusBanner,
            backgroundColor: statusBanner.type === 'success' ? '#ecfdf5' : '#fef2f2',
            borderColor: statusBanner.type === 'success' ? '#34d399' : '#f87171',
            color: statusBanner.type === 'success' ? '#047857' : '#b91c1c'
          }}
        >
          <span>{statusBanner.message}</span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            style={styles.dismissButton}
          >
            ×
          </button>
        </div>
      )}
      <h3 style={styles.heading}>Scheduling Automation</h3>
      <p style={styles.subtitle}>
        Configure how shift lead and after-hours roles are applied automatically. {formatOperatingHoursMessage()}
      </p>

      <div style={styles.section}>
        <div style={styles.sectionHeader}>Shift Lead Automation</div>
        <div style={styles.fieldRow}>
          <TavariCheckbox
            checked={form.shift_lead_enabled}
            onChange={(checked) => handleChange('shift_lead_enabled', checked)}
            label="Automatically assign Shift Lead"
          />
        </div>
        <div style={styles.fieldRow}>
          <label style={styles.label}>Shift Lead Position Title</label>
          <input
            type="text"
            value={form.shift_lead_position}
            onChange={(e) => handleChange('shift_lead_position', e.target.value)}
            style={styles.input}
          />
        </div>
        <div style={styles.fieldRow}>
          <label style={styles.label}>Activation Mode</label>
          <select
            value={form.shift_lead_mode}
            onChange={(e) => handleChange('shift_lead_mode', e.target.value)}
            style={styles.select}
          >
            <option value="relative">Follow operating hours (with grace periods)</option>
            <option value="fixed">Start at a fixed time</option>
          </select>
        </div>
        {form.shift_lead_mode === 'fixed' ? (
          <div style={styles.fieldRow}>
            <label style={styles.label}>Fixed Shift Lead Start Time</label>
            <input
              type="time"
              value={form.shift_lead_fixed_start}
              onChange={(e) => handleChange('shift_lead_fixed_start', e.target.value)}
              style={styles.input}
            />
          </div>
        ) : (
          <div style={styles.gridTwo}>
            <div>
              <label style={styles.label}>Grace Before Opening (minutes)</label>
              <input
                type="number"
                min="0"
                value={form.shift_lead_grace_before_open}
                onChange={(e) => handleChange('shift_lead_grace_before_open', e.target.value)}
                style={styles.input}
              />
            </div>
            <div>
              <label style={styles.label}>Grace After Closing (minutes)</label>
              <input
                type="number"
                min="0"
                value={form.shift_lead_grace_after_close}
                onChange={(e) => handleChange('shift_lead_grace_after_close', e.target.value)}
                style={styles.input}
              />
            </div>
          </div>
        )}
        <div style={styles.fieldRow}>
          <label style={styles.label}>Positions that remove the need for a Shift Lead</label>
          <input
            type="text"
            value={excludedPositionsString}
            onChange={(e) => handleExcludedPositionsChange(e.target.value)}
            style={styles.input}
            placeholder="Comma-separated positions (e.g., President / CEO, Manager)"
          />
          <p style={styles.helpText}>
            When someone scheduled already holds one of these positions, no additional shift lead will be assigned automatically.
          </p>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionHeader}>After Hours Automation</div>
        <div style={styles.fieldRow}>
          <TavariCheckbox
            checked={form.after_hours_enabled}
            onChange={(checked) => handleChange('after_hours_enabled', checked)}
            label="Automatically mark shifts as After Hours"
          />
        </div>
        <div style={styles.fieldRow}>
          <label style={styles.label}>After Hours Position Title</label>
          <input
            type="text"
            value={form.after_hours_position}
            onChange={(e) => handleChange('after_hours_position', e.target.value)}
            style={styles.input}
          />
        </div>
        <div style={styles.fieldRow}>
          <label style={styles.label}>Activation Mode</label>
          <select
            value={form.after_hours_mode}
            onChange={(e) => handleChange('after_hours_mode', e.target.value)}
            style={styles.select}
          >
            <option value="relative">After closing (with grace period)</option>
            <option value="fixed">Start at a fixed time</option>
          </select>
        </div>
        {form.after_hours_mode === 'fixed' ? (
          <div style={styles.fieldRow}>
            <label style={styles.label}>Fixed After Hours Start Time</label>
            <input
              type="time"
              value={form.after_hours_fixed_start}
              onChange={(e) => handleChange('after_hours_fixed_start', e.target.value)}
              style={styles.input}
            />
          </div>
        ) : (
          <div style={styles.fieldRow}>
            <label style={styles.label}>Grace After Closing (minutes)</label>
            <input
              type="number"
              min="0"
              value={form.after_hours_grace_after_close}
              onChange={(e) => handleChange('after_hours_grace_after_close', e.target.value)}
              style={styles.input}
            />
          </div>
        )}
      </div>

      <div style={styles.section}>
        <div style={styles.sectionHeader}>Maximum Hours</div>
        <div style={styles.fieldRow}>
          <label style={styles.label}>Default weekly hours limit (for employees without lieu time)</label>
          <input
            type="number"
            min="1"
            value={form.default_max_hours}
            onChange={(e) => handleChange('default_max_hours', e.target.value)}
            style={styles.input}
          />
          <p style={styles.helpText}>
            Employees with lieu time enabled use the maximum defined on their profile. Others will use this default (Ontario standard is 44 hours).
          </p>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionHeader}>Time off requests</div>
        <p style={styles.helpText}>
          Control how many people can have overlapping pending or approved time off on the same calendar day, and block
          specific dates (for example holidays or peak periods).
        </p>
        <div style={styles.fieldRow}>
          <label style={styles.label}>Max people off per calendar day</label>
          <input
            type="number"
            min="1"
            placeholder="No limit"
            value={form.time_off_max_people_per_day}
            onChange={(e) => handleChange('time_off_max_people_per_day', e.target.value)}
            style={styles.input}
          />
          <p style={styles.helpText}>
            Leave empty for no limit. When set, each calendar day in a request is checked: pending and approved time off
            count toward this cap (distinct employees). If the cap is already reached, another employee cannot request that
            day off.
          </p>
        </div>
        <div style={styles.fieldRow}>
          <label style={styles.label}>Blackout dates (one YYYY-MM-DD per line)</label>
          <textarea
            value={form.time_off_blackout_dates_text}
            onChange={(e) => handleChange('time_off_blackout_dates_text', e.target.value)}
            style={{ ...styles.input, minHeight: '120px', resize: 'vertical', fontFamily: 'ui-monospace, monospace' }}
            placeholder={'2026-12-25\n2026-12-26'}
          />
          <p style={styles.helpText}>
            Employees cannot submit time off that includes any of these dates. Invalid lines are ignored when saving.
          </p>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionHeader}>Employee App Time Clock</div>
        <div style={styles.fieldRow}>
          <TavariCheckbox
            checked={form.allow_employee_app_unscheduled_clock_in}
            onChange={(checked) => handleChange('allow_employee_app_unscheduled_clock_in', checked)}
            label="Allow employee app clock-in without selecting a scheduled shift"
          />
          <p style={styles.helpText}>
            Turn this off if employees must clock in against a scheduled shift from the app.
          </p>
        </div>
        <div style={styles.gridTwo}>
          <div>
            <label style={styles.label}>Late clock-in grace minutes</label>
            <input
              type="number"
              min="0"
              value={form.time_clock_late_grace_minutes}
              onChange={(e) => handleChange('time_clock_late_grace_minutes', e.target.value)}
              style={styles.input}
            />
          </div>
          <div>
            <label style={styles.label}>Early clock-out grace minutes</label>
            <input
              type="number"
              min="0"
              value={form.time_clock_early_clock_out_grace_minutes}
              onChange={(e) => handleChange('time_clock_early_clock_out_grace_minutes', e.target.value)}
              style={styles.input}
            />
          </div>
        </div>
        <div style={styles.fieldRow}>
          <TavariCheckbox
            checked={form.time_clock_geofence_enabled}
            onChange={(checked) => handleChange('time_clock_geofence_enabled', checked)}
            label="Require GPS geofence for employee app clock-in/out"
          />
        </div>
        {form.time_clock_geofence_enabled && (
          <>
            <div style={styles.gridTwo}>
              <div>
                <label style={styles.label}>Geofence latitude</label>
                <input
                  type="number"
                  step="0.00000001"
                  value={form.time_clock_geofence_latitude}
                  onChange={(e) => handleChange('time_clock_geofence_latitude', e.target.value)}
                  style={styles.input}
                  placeholder="43.653225"
                />
              </div>
              <div>
                <label style={styles.label}>Geofence longitude</label>
                <input
                  type="number"
                  step="0.00000001"
                  value={form.time_clock_geofence_longitude}
                  onChange={(e) => handleChange('time_clock_geofence_longitude', e.target.value)}
                  style={styles.input}
                  placeholder="-79.383186"
                />
              </div>
            </div>
            <div style={styles.fieldRow}>
              <label style={styles.label}>Allowed radius in meters</label>
              <input
                type="number"
                min="25"
                value={form.time_clock_geofence_radius_meters}
                onChange={(e) => handleChange('time_clock_geofence_radius_meters', e.target.value)}
                style={styles.input}
              />
              <p style={styles.helpText}>
                Employees outside this radius will be blocked from clocking in or out from the employee app.
              </p>
            </div>
          </>
        )}
      </div>

      <div style={styles.actions}>
        <button
          onClick={handleSave}
          style={styles.saveButton}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Scheduling Settings'}
        </button>
      </div>
    </div>
  );
};

const parseMaxPeoplePerDay = (value) => {
  const v = String(value ?? '').trim();
  if (v === '') return null;
  const n = parseInt(v, 10);
  if (Number.isNaN(n) || n < 1) return null;
  return n;
};

const parseBlackoutDatesFromText = (text) => {
  if (!text || !String(text).trim()) return [];
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/;
  const out = [];
  for (const line of lines) {
    if (!iso.test(line)) continue;
    const d = new Date(`${line}T12:00:00`);
    if (!Number.isNaN(d.getTime())) out.push(line);
  }
  return [...new Set(out)].sort();
};

const formatBlackoutDatesForForm = (value) => {
  if (!value) return '';
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean).join('\n');
  }
  return '';
};

const toInteger = (value) => {
  const num = parseInt(value, 10);
  return Number.isNaN(num) ? 0 : Math.max(0, num);
};

const formatTimeInput = (value) => {
  if (!value) return '';
  if (value.length === 5) return value;
  return value.substring(0, 5);
};

const formatDisplayTime = (value) => {
  if (!value) return '';
  const [hours, minutes] = value.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return value;
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);

const styles = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing['2xl'],
    width: '100%',
    maxWidth: '960px',
    margin: '0 auto'
  },
  heading: {
    fontSize: TavariStyles.typography.fontSize['2xl'],
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800
  },
  subtitle: {
    color: TavariStyles.colors.gray600,
    fontSize: TavariStyles.typography.fontSize.sm,
    marginTop: `-${TavariStyles.spacing.sm}`
  },
  section: {
    backgroundColor: TavariStyles.colors.white,
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    padding: TavariStyles.spacing['2xl'],
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.lg,
    width: '100%'
  },
  sectionHeader: {
    fontSize: TavariStyles.typography.fontSize.lg,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.primary
  },
  fieldRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.sm
  },
  label: {
    fontSize: TavariStyles.typography.fontSize.sm,
    fontWeight: TavariStyles.typography.fontWeight.semibold,
    color: TavariStyles.colors.gray700
  },
  input: {
    ...TavariStyles.components.form.input,
    width: '100%',
    maxWidth: '640px'
  },
  select: {
    ...TavariStyles.components.form.select,
    width: '100%',
    maxWidth: '640px'
  },
  gridTwo: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: TavariStyles.spacing.lg
  },
  helpText: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray500
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end'
  },
  saveButton: {
    ...TavariStyles.components.button?.base,
    ...TavariStyles.components.button?.variants?.primary,
    minWidth: '220px'
  },
  statusBanner: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${TavariStyles.spacing.md} ${TavariStyles.spacing.lg}`,
    borderRadius: TavariStyles.borderRadius.md,
    border: '1px solid',
    fontSize: TavariStyles.typography.fontSize.sm
  },
  dismissButton: {
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    fontSize: TavariStyles.typography.fontSize.lg,
    cursor: 'pointer',
    marginLeft: TavariStyles.spacing.lg,
    lineHeight: 1
  }
};

export default SchedulingSettingsTab;
