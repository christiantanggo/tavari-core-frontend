import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { FiDownload, FiMail, FiRefreshCw, FiSave } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import TavariCheckbox from '../UI/TavariCheckbox';
import { getValidBusinessTimezone } from '../../utils/businessDateFormat';
import toast from 'react-hot-toast';
import {
  DEFAULT_DIGEST_SECTIONS,
  DIGEST_SECTION_IDS,
  buildDailyDigestCsv,
  fetchDailyDigestStats,
  mergeDigestSections
} from '../../helpers/Mail/dailyDigestStats';

dayjs.extend(utc);
dayjs.extend(timezone);

function clampDigestHour(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 20;
  return Math.min(23, Math.max(0, Math.round(n)));
}

function clampDigestMinute(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(59, Math.max(0, Math.round(n)));
}

function formatHourLabel12(h) {
  const hour = clampDigestHour(h);
  if (hour === 0) return '12:00 AM';
  if (hour < 12) return `${hour}:00 AM`;
  if (hour === 12) return '12:00 PM';
  return `${hour - 12}:00 PM`;
}

const DIGEST_HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: `${String(h).padStart(2, '0')}:00 (${formatHourLabel12(h)})`
}));

/** Legacy = hour only (first cron tick in that hour). Else 0-59 local minute; cron runs every 15 min (:00/:15/:30/:45). */
const DIGEST_MINUTE_OPTIONS = [
  { value: '', label: 'Any minute in hour (legacy)' },
  ...Array.from({ length: 60 }, (_, m) => ({
    value: m,
    label: `${String(m).padStart(2, '0')}`
  }))
];

const SECTION_ROWS = [
  { id: DIGEST_SECTION_IDS.total_sent, label: 'Total emails sent (delivered)' },
  { id: DIGEST_SECTION_IDS.metrics_guide, label: 'How to read rates & compare campaigns (definitions)' },
  { id: DIGEST_SECTION_IDS.campaigns_breakdown, label: 'Per-campaign 7-day tables (+ digest-day snapshot line)' },
  { id: DIGEST_SECTION_IDS.rollout_batches, label: 'Rollout batch breakdown (when staged sends exist)' },
  { id: DIGEST_SECTION_IDS.open_rate, label: 'Summary open rate & opens count' },
  { id: DIGEST_SECTION_IDS.click_rate, label: 'Summary click rate & clicks count' },
  { id: DIGEST_SECTION_IDS.last_seven_days, label: '7-day open & click trend (rolling, ends on anchor date)' },
  { id: DIGEST_SECTION_IDS.unsubs, label: 'Unsubscribes (consent log)' },
  { id: DIGEST_SECTION_IDS.bounces, label: 'Bounces (notification table + bounced status)' },
  { id: DIGEST_SECTION_IDS.failures, label: 'Failed sends' },
  { id: DIGEST_SECTION_IDS.suppression, label: 'Suppression & blocked unsubscribed sends' },
  { id: DIGEST_SECTION_IDS.pending, label: 'Pending rows' },
  { id: DIGEST_SECTION_IDS.extra_counts, label: 'Footnotes / definitions' }
];

const MailDailyDigestTab = ({ businessId, businessData, canManageDigest }) => {
  const businessTzResolved = useMemo(
    () => getValidBusinessTimezone(businessData?.timezone),
    [businessData?.timezone]
  );
  const [digestTimezoneRaw, setDigestTimezoneRaw] = useState('');
  const tz = useMemo(() => {
    const o = String(digestTimezoneRaw ?? '').trim();
    if (o) return getValidBusinessTimezone(o);
    return businessTzResolved;
  }, [digestTimezoneRaw, businessTzResolved]);
  const businessName = businessData?.name || '';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [recipients, setRecipients] = useState('');
  const [sections, setSections] = useState(() => ({ ...DEFAULT_DIGEST_SECTIONS }));
  const [digestHour, setDigestHour] = useState(20);
  /** null = legacy hour-only; number = exact local minute */
  const [digestMinute, setDigestMinute] = useState(null);
  const [lastSentOn, setLastSentOn] = useState(null);

  const todayStr = useMemo(() => dayjs().tz(tz).format('YYYY-MM-DD'), [tz]);
  const [csvStart, setCsvStart] = useState(() => dayjs().tz(tz).subtract(6, 'day').format('YYYY-MM-DD'));
  const [csvEnd, setCsvEnd] = useState(() => dayjs().tz(tz).format('YYYY-MM-DD'));
  const [csvBusy, setCsvBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);

  useEffect(() => {
    setCsvEnd(dayjs().tz(tz).format('YYYY-MM-DD'));
  }, [tz]);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('mail_settings')
        .select(
          'daily_digest_enabled, daily_digest_recipients, daily_digest_sections, daily_digest_last_sent_on, daily_digest_send_hour, daily_digest_send_minute, daily_digest_timezone'
        )
        .eq('business_id', businessId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setEnabled(!!data.daily_digest_enabled);
        setRecipients(typeof data.daily_digest_recipients === 'string' ? data.daily_digest_recipients : '');
        setSections(mergeDigestSections(data.daily_digest_sections));
        setDigestHour(clampDigestHour(data.daily_digest_send_hour));
        const dm = data.daily_digest_send_minute;
        setDigestMinute(
          dm === null || dm === undefined ? null : clampDigestMinute(dm)
        );
        setLastSentOn(data.daily_digest_last_sent_on || null);
        setDigestTimezoneRaw(
          typeof data.daily_digest_timezone === 'string' ? data.daily_digest_timezone : ''
        );
      } else {
        setEnabled(false);
        setRecipients('');
        setSections({ ...DEFAULT_DIGEST_SECTIONS });
        setDigestHour(20);
        setDigestMinute(null);
        setLastSentOn(null);
        setDigestTimezoneRaw('');
      }
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'Could not load digest settings');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleSection = (id, checked) => {
    setSections((prev) => ({ ...prev, [id]: checked }));
  };

  const save = async () => {
    if (!businessId || !canManageDigest) {
      toast.error('You do not have permission to save digest settings');
      return;
    }
    const trimmed = recipients
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (enabled && trimmed.length === 0) {
      toast.error('Add at least one recipient email, or turn off the daily digest');
      return;
    }

    setSaving(true);
    try {
      const hourToSave = clampDigestHour(digestHour);
      const digestFields = {
        daily_digest_enabled: enabled,
        daily_digest_recipients: trimmed.join(', '),
        daily_digest_sections: sections,
        daily_digest_send_hour: hourToSave,
        daily_digest_send_minute:
          digestMinute === null ? null : clampDigestMinute(digestMinute),
        daily_digest_timezone: digestTimezoneRaw.trim() || null
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
          .update(digestFields)
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
          ...digestFields
        });

        if (insertError) throw insertError;
      }

      toast.success('Daily digest settings saved');
      await load();
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const downloadCsv = async () => {
    if (!businessId) return;
    if (!csvStart || !csvEnd) {
      toast.error('Choose a start and end date');
      return;
    }
    const startD = dayjs.tz(csvStart, tz).startOf('day');
    const endD = dayjs.tz(csvEnd, tz).endOf('day');
    if (startD.isAfter(endD)) {
      toast.error('Start date must be on or before end date');
      return;
    }

    setCsvBusy(true);
    try {
      const stats = await fetchDailyDigestStats(
        supabase,
        businessId,
        tz,
        startD.utc().toISOString(),
        endD.utc().toISOString()
      );
      const csv = buildDailyDigestCsv(stats, sections, {
        businessName,
        rangeLabel: `${csvStart}–${csvEnd}`
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mail_stats_${businessId.slice(0, 8)}_${csvStart}_${csvEnd}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('CSV downloaded');
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'Could not build CSV');
    } finally {
      setCsvBusy(false);
    }
  };

  const sendTest = async () => {
    if (!businessId || !canManageDigest) {
      toast.error('You do not have permission to send a test');
      return;
    }
    const trimmed = recipients
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (trimmed.length === 0) {
      toast.error('Enter at least one recipient email');
      return;
    }

    setTestBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('mail-daily-digest', {
        body: {
          action: 'test',
          businessId,
          recipients: trimmed.join(', '),
          sections
        }
      });
      if (error) {
        let detail = error.message || 'Test send failed';
        const ctx = error.context;
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = await ctx.clone().json();
            if (body?.error) detail = String(body.error);
          } catch (_) {
            /* ignore */
          }
        }
        throw new Error(detail);
      }
      if (data?.ok !== true) {
        throw new Error(data?.error || 'Test send failed');
      }
      toast.success('Test digest sent');
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'Test send failed');
    } finally {
      setTestBusy(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.wrap}>
        <div style={styles.muted}>
          <FiRefreshCw style={{ verticalAlign: 'middle', marginRight: 8 }} />
          Loading digest settings…
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <h2 style={styles.h2}>Daily stats email (scheduled local time)</h2>
        <p style={styles.lead}>
          Once per day at the hour you choose below in your digest timezone ({tz}), we can email a summary of
          marketing sends for that calendar day. Configure recipients and which sections to include. The same
          sections apply to CSV exports below.
        </p>

        <div style={styles.fieldLabel}>
          <TavariCheckbox
            checked={enabled}
            onChange={(v) => setEnabled(v)}
            disabled={!canManageDigest}
            label="Enable daily digest email"
            id="digest-enabled"
          />
        </div>

        <label style={styles.textLabel} htmlFor="digest-send-hour">
          Send digest at — hour (local time)
        </label>
        <select
          id="digest-send-hour"
          value={digestHour}
          onChange={(e) => setDigestHour(clampDigestHour(e.target.value))}
          disabled={!canManageDigest}
          style={styles.select}
        >
          {DIGEST_HOUR_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <label style={{ ...styles.textLabel, marginTop: 12 }} htmlFor="digest-send-minute">
          Minute (local time)
        </label>
        <select
          id="digest-send-minute"
          value={digestMinute === null ? '' : String(digestMinute)}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') setDigestMinute(null);
            else setDigestMinute(clampDigestMinute(v));
          }}
          disabled={!canManageDigest}
          style={styles.select}
        >
          {DIGEST_MINUTE_OPTIONS.map((opt) => (
            <option
              key={opt.value === '' ? 'legacy' : `m-${opt.value}`}
              value={opt.value === '' ? '' : String(opt.value)}
            >
              {opt.label}
            </option>
          ))}
        </select>
        <p style={styles.helpMuted}>
          Example: <strong>8:45 PM</strong> = hour <strong>20</strong> and minute <strong>45</strong>. The platform cron calls the digest every{' '}
          <strong>15 minutes</strong>, so only minute marks <strong>:00, :15, :30, :45</strong> can fire exactly.{' '}
          <strong>Any minute in hour (legacy)</strong> sends on the first cron tick after that hour starts (still once per day).
        </p>

        <label style={{ ...styles.textLabel, marginTop: 16 }} htmlFor="digest-tz-override">
          Digest timezone override (optional)
        </label>
        <input
          id="digest-tz-override"
          type="text"
          value={digestTimezoneRaw}
          onChange={(e) => setDigestTimezoneRaw(e.target.value)}
          disabled={!canManageDigest}
          placeholder={`Default: ${businessTzResolved}`}
          autoComplete="off"
          style={styles.textInput}
        />
        <p style={styles.helpMuted}>
          IANA ID used for the digest day, scheduled hour, CSV dates, and the &quot;Report timezone&quot; line in the
          email (same as the server). Leave blank to use your business timezone ({businessTzResolved}). Invalid IDs fall
          back to America/Toronto on both the app and the server.
        </p>

        <label style={{ ...styles.textLabel, marginTop: 16 }} htmlFor="digest-recipients">
          Recipient emails (comma-separated)
        </label>
        <textarea
          id="digest-recipients"
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          disabled={!canManageDigest}
          placeholder="ops@example.com, manager@example.com"
          rows={3}
          style={styles.textarea}
        />

        <div style={styles.sectionTitle}>Include in email & CSV</div>
        <div style={styles.checkGrid}>
          {SECTION_ROWS.map((row) => (
            <TavariCheckbox
              key={row.id}
              id={`digest-section-${row.id}`}
              checked={sections[row.id] !== false}
              onChange={(v) => toggleSection(row.id, v)}
              disabled={!canManageDigest}
              label={row.label}
            />
          ))}
        </div>

        <div style={styles.actions}>
          <button type="button" style={styles.primaryBtn} onClick={save} disabled={!canManageDigest || saving}>
            <FiSave style={{ marginRight: 8 }} />
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          <button
            type="button"
            style={styles.secondaryBtn}
            onClick={sendTest}
            disabled={!canManageDigest || testBusy}
          >
            <FiMail style={{ marginRight: 8 }} />
            {testBusy ? 'Sending…' : 'Send test now'}
          </button>
        </div>

        {lastSentOn && (
          <p style={styles.mutedSmall}>Last automated digest (local date logged): {String(lastSentOn)}</p>
        )}
        <p style={styles.mutedSmall}>
          Automated sends run when the local hour matches your chosen time above. The Mail digest cron should POST to
          the <code style={{ fontSize: 13 }}>mail-daily-digest</code> function{' '}
          <strong>every 15–30 minutes</strong> with{' '}
          <code style={{ fontSize: 13 }}>Authorization: Bearer &lt;service role key&gt;</code> (or{' '}
          <code style={{ fontSize: 13 }}>x-mail-digest-cron-secret</code> matching{' '}
          <code style={{ fontSize: 13 }}>MAIL_DIGEST_CRON_SECRET</code> in Edge secrets). A once-a-day UTC cron
          usually misses your local window entirely.
        </p>
      </div>

      <div style={styles.card}>
        <h2 style={styles.h2}>Download CSV</h2>
        <p style={styles.lead}>
          Pick a date range (business timezone). The export respects the checkboxes above. The 7-day trend uses
          the <strong>end date</strong> as the anchor in your timezone.
        </p>
        <div style={styles.row}>
          <div>
            <label style={styles.miniLabel} htmlFor="csv-start">
              Start date
            </label>
            <input
              id="csv-start"
              type="date"
              value={csvStart}
              max={todayStr}
              onChange={(e) => setCsvStart(e.target.value)}
              style={styles.dateInput}
            />
          </div>
          <div>
            <label style={styles.miniLabel} htmlFor="csv-end">
              End date
            </label>
            <input
              id="csv-end"
              type="date"
              value={csvEnd}
              max={todayStr}
              onChange={(e) => setCsvEnd(e.target.value)}
              style={styles.dateInput}
            />
          </div>
          <button type="button" style={styles.primaryBtn} onClick={downloadCsv} disabled={csvBusy}>
            <FiDownload style={{ marginRight: 8 }} />
            {csvBusy ? 'Building…' : 'Download CSV'}
          </button>
        </div>
      </div>
    </div>
  );
};

const styles = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    marginTop: '8px'
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: '18px',
    padding: '22px',
    border: '1px solid #e2e8f0'
  },
  h2: {
    margin: '0 0 8px 0',
    fontSize: '20px',
    fontWeight: 800,
    color: '#0f172a'
  },
  lead: {
    margin: '0 0 18px 0',
    color: '#475569',
    fontSize: '14px',
    lineHeight: 1.55
  },
  fieldLabel: {
    display: 'block',
    marginBottom: '14px'
  },
  textLabel: {
    display: 'block',
    fontSize: '13px',
    fontWeight: 700,
    color: '#334155',
    marginBottom: '8px'
  },
  helpMuted: {
    margin: '8px 0 0 0',
    fontSize: '13px',
    color: '#64748b',
    lineHeight: 1.45,
    maxWidth: '640px'
  },
  select: {
    display: 'block',
    maxWidth: '320px',
    borderRadius: '12px',
    border: '1px solid #cbd5e1',
    padding: '10px 12px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#0f172a',
    backgroundColor: '#fff',
    fontFamily: 'inherit'
  },
  textarea: {
    width: '100%',
    maxWidth: '560px',
    borderRadius: '12px',
    border: '1px solid #cbd5e1',
    padding: '12px',
    fontSize: '14px',
    boxSizing: 'border-box',
    fontFamily: 'inherit'
  },
  textInput: {
    display: 'block',
    width: '100%',
    maxWidth: '400px',
    borderRadius: '12px',
    border: '1px solid #cbd5e1',
    padding: '10px 12px',
    fontSize: '14px',
    boxSizing: 'border-box',
    fontFamily: 'inherit'
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: 800,
    color: '#0f172a',
    margin: '18px 0 12px 0'
  },
  checkGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    maxWidth: '720px'
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    marginTop: '20px'
  },
  primaryBtn: {
    border: 'none',
    borderRadius: '12px',
    padding: '12px 18px',
    backgroundColor: '#2563eb',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center'
  },
  secondaryBtn: {
    border: '1px solid #cbd5e1',
    borderRadius: '12px',
    padding: '12px 18px',
    backgroundColor: '#f8fafc',
    color: '#0f172a',
    fontWeight: 700,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center'
  },
  muted: {
    color: '#64748b',
    padding: '24px'
  },
  mutedSmall: {
    marginTop: '12px',
    fontSize: '13px',
    color: '#64748b'
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '16px',
    alignItems: 'flex-end'
  },
  miniLabel: {
    display: 'block',
    fontSize: '13px',
    fontWeight: 700,
    color: '#64748b',
    marginBottom: '6px'
  },
  dateInput: {
    border: '1px solid #cbd5e1',
    borderRadius: '10px',
    padding: '10px 12px',
    fontWeight: 700,
    color: '#0f172a'
  }
};

export default MailDailyDigestTab;
