import React, { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { FiAward, FiPlus, FiRefreshCw, FiSave, FiTrash2, FiX } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';

dayjs.extend(utc);
dayjs.extend(timezone);
import toast from 'react-hot-toast';
import { formatUnknownError, readEdgeFunctionErrorMessage } from '../../helpers/edgeFunctionErrors';
import { getBusinessTimezone } from '../../utils/businessDateFormat';
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_NAME_OF_DAY_PROFILE_FIELDS,
  DEFAULT_NAME_OF_DAY_COOLDOWN_TIERS,
  DOW_LABELS
} from '../../constants/mailNameOfDayDefaults';

function cloneProfileFields(base = {}) {
  return {
    popularity_quintile_points: [...(base.popularity_quintile_points || DEFAULT_NAME_OF_DAY_PROFILE_FIELDS.popularity_quintile_points)],
    visit_points: {
      ...DEFAULT_NAME_OF_DAY_PROFILE_FIELDS.visit_points,
      ...base.visit_points
    },
    same_waiver_duplicate_points: {
      ...DEFAULT_NAME_OF_DAY_PROFILE_FIELDS.same_waiver_duplicate_points,
      ...base.same_waiver_duplicate_points
    },
    preschool_max_age: Number(base.preschool_max_age ?? DEFAULT_NAME_OF_DAY_PROFILE_FIELDS.preschool_max_age),
    preschool_points: {
      ...DEFAULT_NAME_OF_DAY_PROFILE_FIELDS.preschool_points,
      ...base.preschool_points
    },
    cooldown_tiers: Array.isArray(base.cooldown_tiers) && base.cooldown_tiers.length > 0
      ? base.cooldown_tiers.map((t) => ({
          max_days: Number(t.max_days),
          points: Number(t.points)
        }))
      : null
  };
}

function normalizeProfiles(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const keys = Object.keys(src);
  if (keys.length === 0) {
    return {
      [DEFAULT_PROFILE_ID]: cloneProfileFields({})
    };
  }
  const out = {};
  for (const k of keys) {
    out[k] = cloneProfileFields(src[k] || {});
  }
  if (!out[DEFAULT_PROFILE_ID]) {
    out[DEFAULT_PROFILE_ID] = cloneProfileFields({});
  }
  return out;
}

function normalizeDowMap(raw, profileIds) {
  const allowed = new Set(profileIds);
  const fallback = DEFAULT_PROFILE_ID;
  const out = {};
  for (let d = 0; d < 7; d++) {
    const key = String(d);
    const v = raw?.[key] ?? raw?.[d];
    const id = typeof v === 'string' && allowed.has(v) ? v : fallback;
    out[key] = id;
  }
  return out;
}

function profilesForSave(profiles) {
  const out = {};
  for (const [id, p] of Object.entries(profiles)) {
    const body = cloneProfileFields(p);
    if (body.cooldown_tiers && body.cooldown_tiers.length > 0) {
      out[id] = { ...body, id };
    } else {
      const { cooldown_tiers: _c, ...rest } = body;
      out[id] = { ...rest, id };
    }
  }
  return out;
}

/** Plain JSON so PostgREST gets full JSONB (no accidental undefined stripping in nested objects). */
function sanitizePayloadForDb(payload) {
  return JSON.parse(JSON.stringify(payload));
}

function normalizePickToken(s) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

/** One row per calendar day so future dates appear even before mail-name-of-day inserts picks. */
function mergePickRowsForCalendarRange(rows, tz, startStr, endStr) {
  const map = new Map((rows || []).map((r) => [r.local_date, r]));
  const out = [];
  let cursor = dayjs.tz(startStr, tz).startOf('day');
  const end = dayjs.tz(endStr, tz).startOf('day');
  while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
    const ds = cursor.format('YYYY-MM-DD');
    const existing = map.get(ds);
    if (existing) {
      out.push(existing);
    } else {
      out.push({
        local_date: ds,
        girl_display_name: '',
        boy_display_name: '',
        pick_source: 'pending',
        meta: {}
      });
    }
    cursor = cursor.add(1, 'day');
  }
  return out;
}

const QUINTILE_LABELS = [
  'Most common names (top popularity bucket)',
  'Common',
  'Middle',
  'Less common',
  'Rarest in pool'
];

const NameOfDaySettingsModal = ({ open, onClose, businessId, businessData, canEdit }) => {
  const tz = getBusinessTimezone(businessData);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendHour, setSendHour] = useState(7);
  const [sendMinute, setSendMinute] = useState(0);
  const [profiles, setProfiles] = useState(() => normalizeProfiles({}));
  const [dowProfileIds, setDowProfileIds] = useState(() => normalizeDowMap({}, [DEFAULT_PROFILE_ID]));
  const [expandedProfileId, setExpandedProfileId] = useState(DEFAULT_PROFILE_ID);
  const [newProfileSlug, setNewProfileSlug] = useState('');
  const [pickRows, setPickRows] = useState([]);
  const [savingPickDate, setSavingPickDate] = useState(null);
  const [refreshingNames, setRefreshingNames] = useState(false);

  const profileIdList = Object.keys(profiles).sort((a, b) => {
    if (a === DEFAULT_PROFILE_ID) return -1;
    if (b === DEFAULT_PROFILE_ID) return 1;
    return a.localeCompare(b);
  });

  const load = useCallback(async () => {
    if (!businessId || !open) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('mail_name_of_day_settings')
        .select('send_hour, send_minute, profiles, dow_profile_ids')
        .eq('business_id', businessId)
        .maybeSingle();

      if (error) throw error;

      const mergedProfiles = normalizeProfiles(data?.profiles);
      setProfiles(mergedProfiles);
      setDowProfileIds(normalizeDowMap(data?.dow_profile_ids || {}, Object.keys(mergedProfiles)));
      setSendHour(Number(data?.send_hour ?? 7));
      setSendMinute(Number(data?.send_minute ?? 0));
      setExpandedProfileId(DEFAULT_PROFILE_ID);

      const start = dayjs().tz(tz).subtract(2, 'day').format('YYYY-MM-DD');
      const end = dayjs().tz(tz).add(35, 'day').format('YYYY-MM-DD');
      const { data: picksData, error: picksErr } = await supabase
        .from('mail_name_of_day_picks')
        .select('local_date, girl_display_name, boy_display_name, pick_source, meta')
        .eq('business_id', businessId)
        .gte('local_date', start)
        .lte('local_date', end)
        .order('local_date', { ascending: true });
      if (picksErr) console.error(picksErr);
      else setPickRows(mergePickRowsForCalendarRange(picksData, tz, start, end));
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'Could not load Name of the Day settings');
    } finally {
      setLoading(false);
    }
  }, [businessId, open, tz]);

  useEffect(() => {
    load();
  }, [load]);

  const updateProfileField = (profileId, updater) => {
    setProfiles((prev) => ({
      ...prev,
      [profileId]: typeof updater === 'function' ? updater(prev[profileId]) : updater
    }));
  };

  const updateQuintile = (profileId, index, value) => {
    const n = Number(value);
    if (Number.isNaN(n)) return;
    updateProfileField(profileId, (p) => {
      const next = cloneProfileFields(p);
      const arr = [...next.popularity_quintile_points];
      arr[index] = n;
      next.popularity_quintile_points = arr;
      return next;
    });
  };

  const addProfile = () => {
    const slug = String(newProfileSlug || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!slug) {
      toast.error('Enter a profile id (letters, numbers, underscores)');
      return;
    }
    if (profiles[slug]) {
      toast.error('That profile id already exists');
      return;
    }
    if (slug === DEFAULT_PROFILE_ID) {
      toast.error(`Use a different id than "${DEFAULT_PROFILE_ID}"`);
      return;
    }
    setProfiles((prev) => ({
      ...prev,
      [slug]: cloneProfileFields(prev[DEFAULT_PROFILE_ID] || {})
    }));
    setNewProfileSlug('');
    setExpandedProfileId(slug);
    toast.success(`Profile "${slug}" added (copied from ${DEFAULT_PROFILE_ID})`);
  };

  const removeProfile = (profileId) => {
    if (profileId === DEFAULT_PROFILE_ID) {
      toast.error('Cannot remove the default profile');
      return;
    }
    setProfiles((prev) => {
      const next = { ...prev };
      delete next[profileId];
      return next;
    });
    setDowProfileIds((prev) => {
      const next = { ...prev };
      for (let d = 0; d < 7; d++) {
        if (next[String(d)] === profileId) next[String(d)] = DEFAULT_PROFILE_ID;
      }
      return next;
    });
    if (expandedProfileId === profileId) setExpandedProfileId(DEFAULT_PROFILE_ID);
    toast.success('Profile removed');
  };

  const resetCooldownTiers = (profileId) => {
    updateProfileField(profileId, (p) => {
      const next = cloneProfileFields(p);
      next.cooldown_tiers = DEFAULT_NAME_OF_DAY_COOLDOWN_TIERS.map((t) => ({ ...t }));
      return next;
    });
  };

  const clearCooldownOverride = (profileId) => {
    updateProfileField(profileId, (p) => {
      const next = cloneProfileFields(p);
      next.cooldown_tiers = null;
      return next;
    });
  };

  const updatePickRowField = (localDate, field, value) => {
    setPickRows((prev) =>
      prev.map((row) => (row.local_date === localDate ? { ...row, [field]: value } : row))
    );
  };

  const refreshAutoPicks = async () => {
    if (!businessId || !canEdit) return;
    setRefreshingNames(true);
    try {
      const { data, error } = await supabase.functions.invoke('mail-name-of-day', {
        body: { businessId, refreshAutoPicks: true }
      });
      if (error) throw error;
      const row = Array.isArray(data?.results) ? data.results[0] : null;
      if (row && typeof row === 'object') {
        console.info('[NameOfDaySettings] mail-name-of-day refresh result', row);
      }
      const mp = row?.minor_pool_summary;
      const ins = row?.pregen_inserted;
      const skipped = row?.skipped ? String(row.skipped) : '';

      if (row?.error) {
        toast.error(formatUnknownError(row.error, 'Regeneration failed'));
      } else if (skipped === 'no_open_day_in_lookahead') {
        const n = row?.one_day_lookahead ?? 90;
        toast.success(
          `The next ${n} days already have names (or are user-edited). Nothing to add right now.`
        );
      } else if (skipped === 'empty_gender_pool' || skipped === 'no_minors_in_pool') {
        toast.error(
          skipped === 'no_minors_in_pool'
            ? 'No minors in the waiver sample — check waivers and participants.'
            : 'Girl or boy name pool is empty — check minors’ names and scoring settings.'
        );
      } else if (row?.incremental_one_day && row?.target_local_date) {
        if (Number(ins) >= 1) {
          toast.success(
            `Added picks for ${row.target_local_date}. Click again for the next open day.`
          );
        } else {
          const pr = Array.isArray(row.pregen_results) ? row.pregen_results[0] : null;
          const reason = pr?.reason ? String(pr.reason) : '';
          toast.error(
            reason
              ? `Could not add picks for ${row.target_local_date}: ${reason}`
              : `Could not add picks for ${row.target_local_date}.`
          );
        }
      } else if (mp) {
        const base = `Regenerated auto picks (${ins ?? 0} days updated). Minor pool: ${mp.total_rows} rows — ${mp.modern_waiver_participants} modern, ${mp.legacy_waivers_sourced} legacy.`;
        toast.success(skipped ? `${base} (note: ${skipped})` : base);
      } else {
        toast.success(skipped ? `Name-of-day job completed (${skipped})` : 'Name-of-day job completed.');
      }
      await load();
    } catch (e) {
      console.error('[NameOfDaySettings] refresh auto picks failed', e);
      const msg = await readEdgeFunctionErrorMessage(e, 'Could not refresh picks');
      toast.error(msg);
    } finally {
      setRefreshingNames(false);
    }
  };

  const savePickRow = async (localDate) => {
    if (!businessId || !canEdit) return;
    const row = pickRows.find((r) => r.local_date === localDate);
    if (!row) return;
    const g = String(row.girl_display_name || '').trim();
    const b = String(row.boy_display_name || '').trim();
    if (!g || !b) {
      toast.error('Girl and boy names are required');
      return;
    }
    setSavingPickDate(localDate);
    try {
      const payload = sanitizePayloadForDb({
        business_id: businessId,
        local_date: localDate,
        girl_display_name: g,
        boy_display_name: b,
        girl_normalized: normalizePickToken(g),
        boy_normalized: normalizePickToken(b),
        pick_source: 'user_edited',
        meta: row.meta && typeof row.meta === 'object' ? row.meta : {},
        updated_at: new Date().toISOString()
      });
      const { error } = await supabase.from('mail_name_of_day_picks').upsert(payload, {
        onConflict: 'business_id,local_date'
      });
      if (error) throw error;
      setPickRows((prev) =>
        prev.map((r) =>
          r.local_date === localDate ? { ...r, pick_source: 'user_edited', girl_display_name: g, boy_display_name: b } : r
        )
      );
      toast.success(`Saved picks for ${localDate}`);
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'Save failed');
    } finally {
      setSavingPickDate(null);
    }
  };

  const save = async () => {
    if (!businessId || !canEdit) {
      toast.error('You do not have permission to save these settings');
      return;
    }
    const pendingSlug = String(newProfileSlug || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (pendingSlug) {
      toast.error(
        `You typed "${pendingSlug}" but did not click "Add profile". Add it first, or clear the field.`
      );
      return;
    }
    for (const pid of profileIdList) {
      const p = profiles[pid];
      const q = p?.popularity_quintile_points;
      if (!Array.isArray(q) || q.length !== 5) {
        toast.error(`Profile "${pid}": popularity quintile needs exactly 5 numbers`);
        return;
      }
    }

    setSaving(true);
    try {
      const profilesPayload = profilesForSave(profiles);
      const payload = sanitizePayloadForDb({
        business_id: businessId,
        send_hour: Math.min(23, Math.max(0, Number(sendHour) || 0)),
        send_minute: Math.min(59, Math.max(0, Number(sendMinute) || 0)),
        profiles: profilesPayload,
        dow_profile_ids: normalizeDowMap(dowProfileIds, profileIdList),
        updated_at: new Date().toISOString()
      });

      const { data: saved, error } = await supabase
        .from('mail_name_of_day_settings')
        .upsert(payload, { onConflict: 'business_id' })
        .select('send_hour, send_minute, profiles, dow_profile_ids')
        .single();

      if (error) throw error;

      const sentKeys = Object.keys(profilesPayload);
      const rawProfiles = saved?.profiles;
      const gotKeySet =
        rawProfiles && typeof rawProfiles === 'object' && !Array.isArray(rawProfiles)
          ? new Set(Object.keys(rawProfiles))
          : new Set();
      const missingAfterSave = sentKeys.filter((k) => !gotKeySet.has(k));

      if (missingAfterSave.length > 0) {
        console.error('[NameOfDaySettings] Profiles missing after save', {
          missingAfterSave,
          sentKeys,
          gotKeys: [...gotKeySet],
          saved
        });
        toast.error(
          'Save did not store every profile (check the console). Try again or contact support.'
        );
        return;
      }

      const mergedProfiles = normalizeProfiles(saved.profiles);
      setProfiles(mergedProfiles);
      setDowProfileIds(normalizeDowMap(saved.dow_profile_ids || {}, Object.keys(mergedProfiles)));
      setSendHour(Number(saved.send_hour ?? 7));
      setSendMinute(Number(saved.send_minute ?? 0));

      toast.success('Name of the Day settings saved');
      onClose?.();
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="nod-modal-title">
      <div style={styles.backdrop} onClick={onClose} aria-hidden />
      <div style={styles.panel}>
        <div style={styles.head}>
          <div style={styles.headTitle}>
            <FiAward size={22} color="#ea580c" />
            <div>
              <h2 id="nod-modal-title" style={styles.title}>
                Name of the Day — scoring & schedule
              </h2>
              <p style={styles.subtitle}>
                These settings control how daily girl/boy display names are weighted before winners are chosen. Times use your business timezone ({tz}
                ).
              </p>
            </div>
          </div>
          <div style={styles.headActions}>
            <button
              type="button"
              style={styles.btnSecondary}
              onClick={() => refreshAutoPicks()}
              disabled={!canEdit || refreshingNames || loading}
              title={
                canEdit
                  ? 'Adds girl/boy names for the first calendar day from today that still needs auto picks. Click again for the next day.'
                  : 'Campaign creation or elevated access required'
              }
            >
              <FiRefreshCw size={16} style={{ opacity: refreshingNames ? 0.6 : 1 }} aria-hidden />
              {refreshingNames ? 'Working…' : 'Add next open day'}
            </button>
            <button type="button" style={styles.iconBtn} onClick={onClose} aria-label="Close">
              <FiX size={22} />
            </button>
          </div>
        </div>

        <div style={styles.body}>
          {refreshingNames ? (
            <div
              role="status"
              aria-live="polite"
              style={{
                marginBottom: 16,
                padding: '12px 14px',
                borderRadius: 8,
                backgroundColor: '#eff6ff',
                border: '1px solid #93c5fd',
                color: '#1e3a8a',
                fontSize: 14,
                lineHeight: 1.45
              }}
            >
              <strong>Filling the next open day…</strong> One request adds one calendar date. Please wait — usually a few seconds.
            </div>
          ) : null}
          {loading ? (
            <div style={styles.muted}>Loading…</div>
          ) : (
            <>
              <section style={styles.section}>
                <h3 style={styles.h3}>Daily pick window (local)</h3>
                <p style={styles.help}>
                  The edge job should run once per minute; picks run only when local time matches this clock time (used by{' '}
                  <code style={styles.code}>mail-name-of-day</code>).
                </p>
                <div style={styles.row}>
                  <label style={styles.lbl}>
                    Hour (0–23)
                    <input
                      type="number"
                      min={0}
                      max={23}
                      style={styles.input}
                      value={sendHour}
                      onChange={(e) => setSendHour(Number(e.target.value))}
                      disabled={!canEdit}
                    />
                  </label>
                  <label style={styles.lbl}>
                    Minute (0–59)
                    <input
                      type="number"
                      min={0}
                      max={59}
                      style={styles.input}
                      value={sendMinute}
                      onChange={(e) => setSendMinute(Number(e.target.value))}
                      disabled={!canEdit}
                    />
                  </label>
                </div>
              </section>

              <section style={styles.section}>
                <h3 style={styles.h3}>Scoring profile per weekday</h3>
                <p style={styles.help}>
                  Pick which scoring recipe applies on each calendar day (e.g. different rules on weekends). Sunday through Saturday.
                </p>
                <div style={styles.dowGrid}>
                  {DOW_LABELS.map((label, d) => (
                    <label key={label} style={styles.dowCell}>
                      <span style={styles.dowLabel}>{label}</span>
                      <select
                        style={styles.select}
                        value={dowProfileIds[String(d)] || DEFAULT_PROFILE_ID}
                        onChange={(e) =>
                          setDowProfileIds((prev) => ({
                            ...prev,
                            [String(d)]: e.target.value
                          }))
                        }
                        disabled={!canEdit}
                      >
                        {profileIdList.map((id) => (
                          <option key={id} value={id}>
                            {id}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </section>

              <section style={styles.section}>
                <h3 style={styles.h3}>Scoring profiles</h3>

                <div style={styles.explainBox} aria-label="How Name of the Day scores work">
                  <div style={styles.explainTitle}>How these scores work</div>
                  <ul style={styles.explainList}>
                    <li>
                      <strong>Not a grade out of 100.</strong> Each box below adds (or subtracts) from a running total for every eligible minor first
                      name in your pool. Only <strong>differences between names</strong> matter—adding the same amount everywhere changes nothing.
                    </li>
                    <li>
                      <strong>Pick weight.</strong> For each name, the system computes <strong>weight = 10 + (sum of all adjustments)</strong>, then
                      picks <strong>one girl</strong> and <strong>one boy</strong> name for the day using weighted random choice:{' '}
                      <strong>higher weight = more likely</strong> to win that slot, not guaranteed.
                    </li>
                    <li>
                      <strong>Names on your waivers</strong> — Winners are <strong>real first names from your minor pool</strong> (not a fixed “top 10
                      US” list). A large built-in name list keeps the <strong>girl</strong> and <strong>boy</strong> columns correct and gives a small
                      scoring edge to common spellings; unusual spellings (e.g. nicknames) are much less likely to win when normal alternatives exist.
                    </li>
                    <li>
                      <strong>Popularity quintiles</strong> — Names are sorted by how often they appear <strong>in your business’s pool</strong> (not
                      national rank); the five fields are for most common → rarest in <em>your</em> data.
                    </li>
                    <li>
                      <strong>Visit</strong> — If any participant with this first name had a check-in in the last 30 days, the “Visited” number applies;
                      otherwise “Not visited”.
                    </li>
                    <li>
                      <strong>Same waiver</strong> — Extra adjustment when multiple minors on one waiver share this first name vs only one.
                    </li>
                    <li>
                      <strong>Preschool (Mon–Fri only)</strong> — Weekdays only: boost if any participant with this name is preschool-age or younger
                      (see max age).
                    </li>
                    <li>
                      <strong>Cooldown</strong> — Extra adjustment from how many days since this name last won (girl or boy). Negative values right
                      after a win give other names a better chance next time.
                    </li>
                  </ul>
                </div>

                <div style={styles.addRow}>
                  <input
                    type="text"
                    style={{ ...styles.input, flex: 1, maxWidth: 280 }}
                    placeholder="e.g. weekend"
                    value={newProfileSlug}
                    onChange={(e) => setNewProfileSlug(e.target.value)}
                    disabled={!canEdit}
                  />
                  <button type="button" style={styles.btnSecondary} onClick={addProfile} disabled={!canEdit}>
                    <FiPlus />
                    Add profile
                  </button>
                </div>
                <p style={styles.microHelp}>
                  Type an id, then click <strong>Add profile</strong> (it must appear in the tabs above) before you save.
                </p>

                <div style={styles.profileTabs}>
                  {profileIdList.map((id) => (
                    <button
                      key={id}
                      type="button"
                      style={{
                        ...styles.tab,
                        ...(expandedProfileId === id ? styles.tabActive : {})
                      }}
                      onClick={() => setExpandedProfileId(id)}
                    >
                      {id}
                    </button>
                  ))}
                </div>

                {expandedProfileId && profiles[expandedProfileId] && (
                  <div style={styles.profileCard}>
                    <div style={styles.profileCardHead}>
                      <strong>{expandedProfileId}</strong>
                      {expandedProfileId !== DEFAULT_PROFILE_ID && canEdit && (
                        <button type="button" style={styles.btnDangerGhost} onClick={() => removeProfile(expandedProfileId)}>
                          <FiTrash2 />
                          Remove
                        </button>
                      )}
                    </div>

                    <h4 style={styles.h4}>Popularity quintiles (5 numbers)</h4>
                    <p style={styles.microHelp}>Adjustment by popularity rank among minors: the first field is for the most common names in your pool, the last for the rarest.</p>
                    <div style={styles.grid5}>
                      {QUINTILE_LABELS.map((label, idx) => (
                        <label key={label} style={styles.lbl}>
                          {label}
                          <input
                            type="number"
                            style={styles.input}
                            value={profiles[expandedProfileId].popularity_quintile_points[idx] ?? 0}
                            onChange={(e) => updateQuintile(expandedProfileId, idx, e.target.value)}
                            disabled={!canEdit}
                          />
                        </label>
                      ))}
                    </div>

                    <h4 style={styles.h4}>Recent visit (last 30 days, any participant with this first name)</h4>
                    <p style={styles.microHelp}>Exactly one of these two applies per name: visited at least once in 30 days, or not.</p>
                    <div style={styles.row}>
                      <label style={styles.lbl}>
                        Visited — points
                        <input
                          type="number"
                          style={styles.input}
                          value={profiles[expandedProfileId].visit_points?.visited_30d ?? 0}
                          onChange={(e) =>
                            updateProfileField(expandedProfileId, (p) => {
                              const n = cloneProfileFields(p);
                              n.visit_points = { ...n.visit_points, visited_30d: Number(e.target.value) };
                              return n;
                            })
                          }
                          disabled={!canEdit}
                        />
                      </label>
                      <label style={styles.lbl}>
                        Not visited — points
                        <input
                          type="number"
                          style={styles.input}
                          value={profiles[expandedProfileId].visit_points?.not_visited ?? 0}
                          onChange={(e) =>
                            updateProfileField(expandedProfileId, (p) => {
                              const n = cloneProfileFields(p);
                              n.visit_points = { ...n.visit_points, not_visited: Number(e.target.value) };
                              return n;
                            })
                          }
                          disabled={!canEdit}
                        />
                      </label>
                    </div>

                    <h4 style={styles.h4}>Same waiver, duplicate first names</h4>
                    <p style={styles.microHelp}>Per waiver: one minor with this name vs two or more minors with the same first name on one waiver.</p>
                    <div style={styles.row}>
                      <label style={styles.lbl}>
                        Single minor with this name on a waiver
                        <input
                          type="number"
                          style={styles.input}
                          value={profiles[expandedProfileId].same_waiver_duplicate_points?.single_minor ?? 0}
                          onChange={(e) =>
                            updateProfileField(expandedProfileId, (p) => {
                              const n = cloneProfileFields(p);
                              n.same_waiver_duplicate_points = {
                                ...n.same_waiver_duplicate_points,
                                single_minor: Number(e.target.value)
                              };
                              return n;
                            })
                          }
                          disabled={!canEdit}
                        />
                      </label>
                      <label style={styles.lbl}>
                        Multiple minors same name on one waiver
                        <input
                          type="number"
                          style={styles.input}
                          value={profiles[expandedProfileId].same_waiver_duplicate_points?.multiple_minors_same_name ?? 0}
                          onChange={(e) =>
                            updateProfileField(expandedProfileId, (p) => {
                              const n = cloneProfileFields(p);
                              n.same_waiver_duplicate_points = {
                                ...n.same_waiver_duplicate_points,
                                multiple_minors_same_name: Number(e.target.value)
                              };
                              return n;
                            })
                          }
                          disabled={!canEdit}
                        />
                      </label>
                    </div>

                    <h4 style={styles.h4}>Preschool weekday boost (Mon–Fri)</h4>
                    <p style={styles.microHelp}>Saturday and Sunday ignore this block. Weekdays: add one of the two values depending on age vs max age.</p>
                    <div style={styles.row}>
                      <label style={styles.lbl}>
                        Max age for “preschool” (years)
                        <input
                          type="number"
                          style={styles.input}
                          min={0}
                          max={18}
                          value={profiles[expandedProfileId].preschool_max_age ?? 5}
                          onChange={(e) =>
                            updateProfileField(expandedProfileId, (p) => {
                              const n = cloneProfileFields(p);
                              n.preschool_max_age = Number(e.target.value);
                              return n;
                            })
                          }
                          disabled={!canEdit}
                        />
                      </label>
                      <label style={styles.lbl}>
                        Has preschool-age minor — points
                        <input
                          type="number"
                          style={styles.input}
                          value={profiles[expandedProfileId].preschool_points?.in_range ?? 0}
                          onChange={(e) =>
                            updateProfileField(expandedProfileId, (p) => {
                              const n = cloneProfileFields(p);
                              n.preschool_points = { ...n.preschool_points, in_range: Number(e.target.value) };
                              return n;
                            })
                          }
                          disabled={!canEdit}
                        />
                      </label>
                      <label style={styles.lbl}>
                        No preschool-age minor — points
                        <input
                          type="number"
                          style={styles.input}
                          value={profiles[expandedProfileId].preschool_points?.out_of_range ?? 0}
                          onChange={(e) =>
                            updateProfileField(expandedProfileId, (p) => {
                              const n = cloneProfileFields(p);
                              n.preschool_points = { ...n.preschool_points, out_of_range: Number(e.target.value) };
                              return n;
                            })
                          }
                          disabled={!canEdit}
                        />
                      </label>
                    </div>

                    <h4 style={styles.h4}>Cooldown (days since this name last won girl or boy)</h4>
                    <p style={styles.microHelp}>
                      Looks up days since this first name last won either slot; finds the first tier where days ≤ max_days and adds that tier’s points.
                      Optional override—if cleared, the server uses its built-in ladder.
                    </p>
                    {(profiles[expandedProfileId].cooldown_tiers?.length > 0
                      ? profiles[expandedProfileId].cooldown_tiers
                      : DEFAULT_NAME_OF_DAY_COOLDOWN_TIERS
                    ).map((tier, ti) => (
                        <div key={ti} style={styles.coolRow}>
                          <span style={styles.coolIdx}>{ti + 1}</span>
                          <label style={styles.lblFlat}>
                            Max days
                            <input
                              type="number"
                              style={styles.inputSm}
                              value={tier.max_days}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                updateProfileField(expandedProfileId, (p) => {
                                  const n = cloneProfileFields(p);
                                  const list =
                                    n.cooldown_tiers?.length > 0
                                      ? [...n.cooldown_tiers]
                                      : DEFAULT_NAME_OF_DAY_COOLDOWN_TIERS.map((x) => ({ ...x }));
                                  list[ti] = { ...list[ti], max_days: v };
                                  n.cooldown_tiers = list;
                                  return n;
                                });
                              }}
                              disabled={!canEdit}
                            />
                          </label>
                          <label style={styles.lblFlat}>
                            Points
                            <input
                              type="number"
                              style={styles.inputSm}
                              value={tier.points}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                updateProfileField(expandedProfileId, (p) => {
                                  const n = cloneProfileFields(p);
                                  const list =
                                    n.cooldown_tiers?.length > 0
                                      ? [...n.cooldown_tiers]
                                      : DEFAULT_NAME_OF_DAY_COOLDOWN_TIERS.map((x) => ({ ...x }));
                                  list[ti] = { ...list[ti], points: v };
                                  n.cooldown_tiers = list;
                                  return n;
                                });
                              }}
                              disabled={!canEdit}
                            />
                          </label>
                        </div>
                    ))}
                    <div style={styles.row}>
                      <button type="button" style={styles.btnSecondary} onClick={() => resetCooldownTiers(expandedProfileId)} disabled={!canEdit}>
                        Copy default ladder into this profile (editable)
                      </button>
                      <button type="button" style={styles.btnSecondary} onClick={() => clearCooldownOverride(expandedProfileId)} disabled={!canEdit}>
                        Clear override (use built-in ladder)
                      </button>
                    </div>
                  </div>
                )}
              </section>

              <section style={styles.section}>
                <h3 style={{ ...styles.h3, marginBottom: 0 }}>Upcoming calendar picks</h3>
                <p style={styles.help}>
                  The table lists every day from two days ago through the next five weeks. Rows marked{' '}
                  <strong>Not generated yet</strong> are waiting for the scheduled job or for you to use{' '}
                  <strong>Add next open day</strong> here or next to the preview calendar (Mail → Automations → Saved Automations → Preview Sends). Each click fills{' '}
                  <strong>one</strong> day—the first date from today forward that doesn&apos;t already have names (skips user-edited days). You can type names manually anytime—saved rows become{' '}
                  <strong>user edited</strong> and are not overwritten automatically.
                </p>
                {pickRows.length === 0 ? (
                  <p style={styles.microHelp}>Could not build the calendar range.</p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={styles.pickTable}>
                      <thead>
                        <tr>
                          <th style={styles.pickTh}>Date</th>
                          <th style={styles.pickTh}>Girl</th>
                          <th style={styles.pickTh}>Boy</th>
                          <th style={styles.pickTh}>Source</th>
                          <th style={styles.pickTh} />
                        </tr>
                      </thead>
                      <tbody>
                        {pickRows.map((row) => (
                          <tr key={row.local_date}>
                            <td style={styles.pickTd}>
                              <strong>{row.local_date}</strong>
                            </td>
                            <td style={styles.pickTd}>
                              <input
                                type="text"
                                style={styles.input}
                                value={row.girl_display_name || ''}
                                onChange={(e) => updatePickRowField(row.local_date, 'girl_display_name', e.target.value)}
                                disabled={!canEdit}
                              />
                            </td>
                            <td style={styles.pickTd}>
                              <input
                                type="text"
                                style={styles.input}
                                value={row.boy_display_name || ''}
                                onChange={(e) => updatePickRowField(row.local_date, 'boy_display_name', e.target.value)}
                                disabled={!canEdit}
                              />
                            </td>
                            <td style={styles.pickTd}>
                              <span
                                style={
                                  row.pick_source === 'user_edited'
                                    ? styles.sourceUser
                                    : row.pick_source === 'pending'
                                      ? styles.sourcePending
                                      : styles.sourceAuto
                                }
                              >
                                {row.pick_source === 'user_edited'
                                  ? 'User edited'
                                  : row.pick_source === 'pending'
                                    ? 'Not generated yet'
                                    : 'Auto'}
                              </span>
                            </td>
                            <td style={styles.pickTd}>
                              <button
                                type="button"
                                style={styles.btnSm}
                                onClick={() => savePickRow(row.local_date)}
                                disabled={!canEdit || savingPickDate === row.local_date}
                              >
                                <FiSave size={14} />
                                {savingPickDate === row.local_date ? '…' : 'Save row'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        <div style={styles.footer}>
          <button type="button" style={styles.btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="button" style={styles.btnPrimary} onClick={save} disabled={!canEdit || saving || loading}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 11000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px'
  },
  backdrop: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.45)'
  },
  panel: {
    position: 'relative',
    width: '100%',
    maxWidth: 920,
    maxHeight: '92vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#fff',
    borderRadius: 14,
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
    overflow: 'hidden'
  },
  head: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    padding: '18px 20px',
    borderBottom: '1px solid #e7e5e4',
    background: '#fffbeb'
  },
  headTitle: {
    display: 'flex',
    gap: 12,
    alignItems: 'flex-start',
    minWidth: 0,
    flex: '1 1 auto'
  },
  headActions: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    flexShrink: 0,
    flexWrap: 'wrap',
    justifyContent: 'flex-end'
  },
  title: {
    margin: '0 0 6px 0',
    fontSize: '18px',
    fontWeight: 700,
    color: '#431407'
  },
  subtitle: {
    margin: 0,
    fontSize: '13px',
    color: '#78716c',
    lineHeight: 1.45,
    maxWidth: 720
  },
  iconBtn: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: 4,
    color: '#57534e',
    borderRadius: 8
  },
  body: {
    padding: '16px 20px',
    overflowY: 'auto',
    flex: 1
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    padding: '14px 20px',
    borderTop: '1px solid #e7e5e4',
    background: '#fafaf9'
  },
  section: {
    marginBottom: 22
  },
  h3: {
    margin: '0 0 8px 0',
    fontSize: '15px',
    fontWeight: 700,
    color: '#1c1917'
  },
  h4: {
    margin: '16px 0 8px 0',
    fontSize: '13px',
    fontWeight: 700,
    color: '#44403c'
  },
  help: {
    margin: '0 0 12px 0',
    fontSize: '13px',
    color: '#78716c',
    lineHeight: 1.5
  },
  explainBox: {
    marginBottom: 16,
    padding: '14px 16px',
    borderRadius: 10,
    border: '1px solid #c4b5fd',
    backgroundColor: '#f5f3ff'
  },
  explainTitle: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#5b21b6',
    marginBottom: 10
  },
  explainList: {
    margin: 0,
    paddingLeft: 18,
    fontSize: '13px',
    color: '#4c1d95',
    lineHeight: 1.55
  },
  microHelp: {
    margin: '0 0 10px 0',
    fontSize: '11px',
    color: '#78716c',
    lineHeight: 1.45
  },
  pickTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px'
  },
  pickTh: {
    textAlign: 'left',
    padding: '8px 10px',
    borderBottom: '1px solid #e7e5e4',
    color: '#57534e',
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.04em'
  },
  pickTd: {
    padding: '8px 10px',
    borderBottom: '1px solid #f5f5f4',
    verticalAlign: 'middle'
  },
  btnSm: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    fontSize: '13px',
    fontWeight: 600,
    borderRadius: 6,
    border: '1px solid #d6d3d1',
    background: '#fff',
    cursor: 'pointer'
  },
  sourceAuto: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#78716c'
  },
  sourceUser: {
    fontSize: '11px',
    fontWeight: 700,
    color: '#9a3412'
  },
  sourcePending: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#0369a1'
  },
  muted: {
    padding: 24,
    textAlign: 'center',
    color: '#78716c'
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 14,
    alignItems: 'flex-end',
    marginBottom: 8
  },
  dowGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: 10
  },
  dowCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: '13px',
    color: '#57534e'
  },
  dowLabel: {
    fontWeight: 600,
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: '#78716c'
  },
  lbl: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: '13px',
    color: '#44403c',
    fontWeight: 600
  },
  lblFlat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: '11px',
    color: '#57534e'
  },
  input: {
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid #d6d3d1',
    fontSize: '14px',
    minWidth: 0
  },
  inputSm: {
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid #d6d3d1',
    fontSize: '13px',
    width: 100
  },
  select: {
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid #d6d3d1',
    fontSize: '13px',
    background: '#fff'
  },
  code: {
    fontFamily: 'ui-monospace, Menlo, monospace',
    fontSize: '11px',
    background: '#f5f5f4',
    padding: '1px 5px',
    borderRadius: 4
  },
  addRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
    marginBottom: 12
  },
  profileTabs: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10
  },
  tab: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #e7e5e4',
    background: '#fafaf9',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    color: '#57534e'
  },
  tabActive: {
    borderColor: '#fdba74',
    background: '#fff7ed',
    color: '#9a3412'
  },
  profileCard: {
    border: '1px solid #fed7aa',
    borderRadius: 10,
    padding: 14,
    background: '#fffbeb'
  },
  profileCardHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  grid5: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: 10
  },
  coolRow: {
    display: 'grid',
    gridTemplateColumns: '28px 1fr 1fr',
    gap: 8,
    alignItems: 'end',
    marginBottom: 6
  },
  coolIdx: {
    fontSize: '11px',
    fontWeight: 700,
    color: '#a8a29e',
    paddingBottom: 8,
    textAlign: 'center'
  },
  btnPrimary: {
    padding: '10px 18px',
    borderRadius: 8,
    border: 'none',
    background: '#ea580c',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
    fontSize: '14px'
  },
  btnSecondary: {
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid #d6d3d1',
    background: '#fff',
    color: '#44403c',
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: '13px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6
  },
  btnDangerGhost: {
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid #fecaca',
    background: '#fff',
    color: '#b91c1c',
    fontSize: '13px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6
  }
};

export default NameOfDaySettingsModal;
