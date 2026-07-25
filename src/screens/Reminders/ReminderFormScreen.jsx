import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus, Send, Trash2 } from 'lucide-react';
import { useBusiness } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../utils/TavariStyles';
import {
  getReminder,
  loadBusinessStaff,
  parseManualEmails,
  saveReminder,
  sendTestReminder,
} from '../../services/Reminders/reminderService';

const WEEKDAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

const WEEK_OF_MONTH = [
  { value: 1, label: 'First' },
  { value: 2, label: 'Second' },
  { value: 3, label: 'Third' },
  { value: 4, label: 'Fourth' },
  { value: 5, label: 'Last' },
];

const LINK_PRESETS = [
  { label: 'Scheduling', url: '/dashboard/scheduling' },
  { label: 'HR Dashboard', url: '/dashboard/hr/dashboard' },
  { label: 'Employee management', url: '/dashboard/hr/employee-management?tab=employees' },
  { label: 'Task Manager', url: '/dashboard/tasks' },
  { label: 'Portal (employee)', url: '/portal/notifications' },
];

const defaultForm = () => ({
  title: '',
  body: '',
  schedule_type: 'weekly',
  schedule_time: '09:00',
  schedule_day_of_week: 1,
  schedule_day_of_month: 1,
  schedule_week_of_month: 1,
  schedule_once_date: '',
  starts_on: new Date().toISOString().slice(0, 10),
  ends_on: '',
  max_occurrences: '',
  end_mode: 'indefinite',
  send_on_weekends: false,
  paused: false,
  snooze_max: '',
  snooze_unlimited: true,
  repeat_until_complete: true,
  repeat_max: '',
  repeat_unlimited: true,
  manual_emails_text: '',
  staff_user_ids: [],
  custom_links: [],
});

export default function ReminderFormScreen() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const { business } = useBusiness();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('reminders.dashboard.edit');

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [staff, setStaff] = useState([]);
  const [form, setForm] = useState(defaultForm);
  const [testEmail, setTestEmail] = useState('');

  useEffect(() => {
    if (!business?.id) return;
    loadBusinessStaff(business.id).then(setStaff).catch(() => {});
  }, [business?.id]);

  useEffect(() => {
    if (isNew || !id) return;
    (async () => {
      try {
        setLoading(true);
        const row = await getReminder(id);
        if (!row) throw new Error('Reminder not found');
        setForm({
          title: row.title || '',
          body: row.body || '',
          schedule_type: row.schedule_type,
          schedule_time: (row.schedule_time || '09:00').slice(0, 5),
          schedule_day_of_week: row.schedule_day_of_week ?? 1,
          schedule_day_of_month: row.schedule_day_of_month ?? 1,
          schedule_week_of_month: row.schedule_week_of_month ?? 1,
          schedule_once_date: row.schedule_once_date || '',
          starts_on: row.starts_on || '',
          ends_on: row.ends_on || '',
          max_occurrences: row.max_occurrences ?? '',
          end_mode: row.ends_on ? 'end_date' : row.max_occurrences ? 'max_occurrences' : 'indefinite',
          send_on_weekends: row.send_on_weekends,
          paused: row.paused,
          snooze_max: row.snooze_max ?? '',
          snooze_unlimited: row.snooze_max == null,
          repeat_until_complete: row.repeat_until_complete !== false,
          repeat_max: row.repeat_max ?? '',
          repeat_unlimited: row.repeat_max == null,
          manual_emails_text: (row.manual_emails || []).join(', '),
          staff_user_ids: (row.tavari_reminder_staff_recipients || []).map((r) => r.user_id),
          custom_links: Array.isArray(row.custom_links) ? row.custom_links : [],
        });
      } catch (err) {
        toast.error(err.message || 'Failed to load reminder');
        navigate('/dashboard/reminders');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isNew, navigate]);

  const selectedStaffSet = useMemo(() => new Set(form.staff_user_ids), [form.staff_user_ids]);

  const toggleStaff = (userId) => {
    setForm((f) => ({
      ...f,
      staff_user_ids: selectedStaffSet.has(userId)
        ? f.staff_user_ids.filter((x) => x !== userId)
        : [...f.staff_user_ids, userId],
    }));
  };

  const addCustomLink = () => {
    setForm((f) => ({
      ...f,
      custom_links: [...f.custom_links, { label: '', url: '' }],
    }));
  };

  const updateCustomLink = (index, field, value) => {
    setForm((f) => {
      const links = [...f.custom_links];
      links[index] = { ...links[index], [field]: value };
      return { ...f, custom_links: links };
    });
  };

  const removeCustomLink = (index) => {
    setForm((f) => ({
      ...f,
      custom_links: f.custom_links.filter((_, i) => i !== index),
    }));
  };

  const buildPayload = () => ({
    ...form,
    manual_emails: parseManualEmails(form.manual_emails_text),
    max_occurrences:
      form.end_mode === 'max_occurrences' && form.max_occurrences !== ''
        ? Number(form.max_occurrences)
        : null,
    ends_on: form.end_mode === 'end_date' && form.ends_on ? form.ends_on : null,
    snooze_max: form.snooze_unlimited ? null : Number(form.snooze_max || 0),
    repeat_max: form.repeat_unlimited ? null : Number(form.repeat_max || 0),
    custom_links: (form.custom_links || []).filter((l) => l.label?.trim() && l.url?.trim()),
  });

  const handleSave = async (e) => {
    e.preventDefault();
    if (!canEdit || !business?.id) return;
    if (!form.title.trim()) {
      toast.error('Title is required');
      return;
    }
    try {
      setSaving(true);
      const saved = await saveReminder(business.id, buildPayload(), isNew ? null : id);
      toast.success(isNew ? 'Reminder created' : 'Reminder saved');
      navigate(`/dashboard/reminders/${saved.id}`, { replace: true });
    } catch (err) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleTestSend = async () => {
    if (!testEmail.trim()) {
      toast.error('Enter a test email');
      return;
    }
    try {
      setSaving(true);
      let reminderId = id;
      if (isNew) {
        const saved = await saveReminder(business.id, buildPayload(), null);
        reminderId = saved.id;
        navigate(`/dashboard/reminders/${saved.id}`, { replace: true });
      } else {
        await saveReminder(business.id, buildPayload(), id);
      }
      await sendTestReminder(reminderId, testEmail.trim());
      toast.success(`Test email sent to ${testEmail}`);
    } catch (err) {
      toast.error(err.message || 'Test send failed');
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    return <p style={{ color: TavariStyles.colors.gray600 }}>You do not have permission to edit reminders.</p>;
  }

  if (loading) return <p style={{ color: TavariStyles.colors.gray600 }}>Loading…</p>;

  return (
    <form onSubmit={handleSave} style={styles.form}>
      <button type="button" style={styles.backBtn} onClick={() => navigate('/dashboard/reminders')}>
        <ArrowLeft size={16} />
        Back to list
      </button>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Content</h2>
        <label style={styles.label}>
          Subject / title
          <input style={styles.input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </label>
        <label style={styles.label}>
          Message
          <textarea style={styles.textarea} rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </label>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Schedule</h2>
        <label style={styles.label}>
          Type
          <select style={styles.input} value={form.schedule_type} onChange={(e) => setForm({ ...form, schedule_type: e.target.value })}>
            <option value="once">One time</option>
            <option value="weekly">Weekly (every week)</option>
            <option value="biweekly">Bi-weekly (every 2 weeks)</option>
            <option value="monthly">Monthly (day of month)</option>
            <option value="quarterly">Quarterly (day of month)</option>
            <option value="monthly_weekday">Monthly (e.g. first Monday)</option>
          </select>
        </label>
        <label style={styles.label}>
          Send time (business timezone)
          <input type="time" style={styles.input} value={form.schedule_time} onChange={(e) => setForm({ ...form, schedule_time: e.target.value })} />
        </label>
        {form.schedule_type === 'once' && (
          <label style={styles.label}>
            Date
            <input type="date" style={styles.input} value={form.schedule_once_date} onChange={(e) => setForm({ ...form, schedule_once_date: e.target.value })} required />
          </label>
        )}
        {(form.schedule_type === 'weekly' || form.schedule_type === 'biweekly') && (
          <label style={styles.label}>
            Day of week
            <select style={styles.input} value={form.schedule_day_of_week} onChange={(e) => setForm({ ...form, schedule_day_of_week: Number(e.target.value) })}>
              {WEEKDAYS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </label>
        )}
        {form.schedule_type === 'biweekly' && (
          <p style={styles.hint}>
            Repeats every 14 days on the chosen weekday. The pattern is anchored to your start date (first matching weekday on or after start date).
          </p>
        )}
        {(form.schedule_type === 'monthly' || form.schedule_type === 'quarterly') && (
          <label style={styles.label}>
            Day of month (31 = last day of month)
            <input type="number" min={1} max={31} style={styles.input} value={form.schedule_day_of_month} onChange={(e) => setForm({ ...form, schedule_day_of_month: Number(e.target.value) })} />
          </label>
        )}
        {form.schedule_type === 'quarterly' && (
          <p style={styles.hint}>
            Repeats every 3 months on the chosen day. The pattern is anchored to your start date month (e.g. start in March → March, June, September, December).
          </p>
        )}
        {form.schedule_type === 'monthly_weekday' && (
          <>
            <label style={styles.label}>
              Which occurrence in the month
              <select style={styles.input} value={form.schedule_week_of_month} onChange={(e) => setForm({ ...form, schedule_week_of_month: Number(e.target.value) })}>
                {WEEK_OF_MONTH.map((w) => (
                  <option key={w.value} value={w.value}>{w.label}</option>
                ))}
              </select>
            </label>
            <label style={styles.label}>
              Day of week
              <select style={styles.input} value={form.schedule_day_of_week} onChange={(e) => setForm({ ...form, schedule_day_of_week: Number(e.target.value) })}>
                {WEEKDAYS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </label>
            <p style={styles.hint}>
              Example: First + Monday = first Monday of each month. Last + Friday = final Friday of each month.
            </p>
          </>
        )}
        <label style={styles.label}>
          Start date
          <input type="date" style={styles.input} value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} />
        </label>
        <label style={styles.label}>
          End
          <select style={styles.input} value={form.end_mode} onChange={(e) => setForm({ ...form, end_mode: e.target.value })}>
            <option value="indefinite">Indefinitely</option>
            <option value="end_date">End date</option>
            <option value="max_occurrences">Max occurrences</option>
          </select>
        </label>
        {form.end_mode === 'end_date' && (
          <label style={styles.label}>
            End date
            <input type="date" style={styles.input} value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} />
          </label>
        )}
        {form.end_mode === 'max_occurrences' && (
          <label style={styles.label}>
            Max occurrences
            <input type="number" min={1} style={styles.input} value={form.max_occurrences} onChange={(e) => setForm({ ...form, max_occurrences: e.target.value })} />
          </label>
        )}
        <TavariCheckbox
          label="Send on weekends"
          checked={form.send_on_weekends}
          onChange={(checked) => setForm({ ...form, send_on_weekends: checked })}
        />
        <p style={styles.hint}>Holidays from Settings → Holiday Hours shift sends forward to the next non-holiday (same clock time).</p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Snooze</h2>
        <TavariCheckbox
          label="Unlimited “Remind tomorrow” per occurrence"
          checked={form.snooze_unlimited}
          onChange={(checked) => setForm({ ...form, snooze_unlimited: checked })}
        />
        {!form.snooze_unlimited && (
          <label style={styles.label}>
            Max snoozes
            <input type="number" min={0} style={styles.input} value={form.snooze_max} onChange={(e) => setForm({ ...form, snooze_max: e.target.value })} />
          </label>
        )}
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Repeat until complete</h2>
        <TavariCheckbox
          label="Keep sending this occurrence until someone taps Complete"
          checked={form.repeat_until_complete}
          onChange={(checked) => setForm({ ...form, repeat_until_complete: checked })}
        />
        {form.repeat_until_complete && (
          <>
            <p style={styles.hint}>
              After the first send, Tavari will automatically send the same occurrence again on the next allowed day at the configured time until it is completed.
            </p>
            <TavariCheckbox
              label="Unlimited automatic repeats"
              checked={form.repeat_unlimited}
              onChange={(checked) => setForm({ ...form, repeat_unlimited: checked })}
            />
            {!form.repeat_unlimited && (
              <label style={styles.label}>
                Max automatic repeats after first send
                <input type="number" min={0} style={styles.input} value={form.repeat_max} onChange={(e) => setForm({ ...form, repeat_max: e.target.value })} />
              </label>
            )}
          </>
        )}
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Recipients</h2>
        <div style={styles.staffList}>
          {staff.map((emp) => (
            <TavariCheckbox
              key={emp.id}
              label={`${emp.full_name || 'Staff'}${emp.email ? ` (${emp.email})` : ''}`}
              checked={selectedStaffSet.has(emp.id)}
              onChange={() => toggleStaff(emp.id)}
            />
          ))}
        </div>
        <label style={styles.label}>
          Additional emails (comma-separated)
          <input style={styles.input} value={form.manual_emails_text} onChange={(e) => setForm({ ...form, manual_emails_text: e.target.value })} placeholder="name@example.com, other@example.com" />
        </label>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Extra email buttons (optional)</h2>
        {(form.custom_links || []).map((link, index) => (
          <div key={index} style={styles.linkRow}>
            <select
              style={styles.input}
              value={LINK_PRESETS.find((p) => p.url === link.url)?.url || ''}
              onChange={(e) => {
                const preset = LINK_PRESETS.find((p) => p.url === e.target.value);
                if (preset) updateCustomLink(index, 'label', preset.label);
                updateCustomLink(index, 'url', e.target.value);
              }}
            >
              <option value="">Custom URL…</option>
              {LINK_PRESETS.map((p) => (
                <option key={p.url} value={p.url}>{p.label}</option>
              ))}
            </select>
            <input style={styles.input} placeholder="Button label" value={link.label} onChange={(e) => updateCustomLink(index, 'label', e.target.value)} />
            <input style={styles.input} placeholder="/dashboard/..." value={link.url} onChange={(e) => updateCustomLink(index, 'url', e.target.value)} />
            <button type="button" style={styles.iconBtnDanger} onClick={() => removeCustomLink(index)}><Trash2 size={16} /></button>
          </div>
        ))}
        <button type="button" style={styles.secondaryBtn} onClick={addCustomLink}><Plus size={14} /> Add button</button>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Status</h2>
        <TavariCheckbox label="Paused (no new scheduled sends; active snoozes still deliver)" checked={form.paused} onChange={(checked) => setForm({ ...form, paused: checked })} />
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Test send</h2>
        <div style={styles.testRow}>
          <input style={styles.input} type="email" placeholder="your@email.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
          <button type="button" style={styles.secondaryBtn} onClick={handleTestSend} disabled={saving}>
            <Send size={14} />
            Send test now
          </button>
        </div>
      </section>

      <div style={styles.footer}>
        <button type="submit" style={styles.primaryBtn} disabled={saving}>{saving ? 'Saving…' : 'Save reminder'}</button>
      </div>
    </form>
  );
}

const styles = {
  form: { display: 'flex', flexDirection: 'column', gap: TavariStyles.spacing.lg },
  backBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'none',
    border: 'none',
    color: TavariStyles.colors.primary,
    cursor: 'pointer',
    fontWeight: 600,
    padding: 0,
  },
  section: {
    background: TavariStyles.colors.white,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: 16,
    padding: TavariStyles.spacing.lg,
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.md,
  },
  sectionTitle: { margin: 0, fontSize: TavariStyles.typography.fontSize.lg },
  label: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, fontWeight: 600, color: TavariStyles.colors.gray700 },
  input: {
    padding: '10px 12px',
    borderRadius: 10,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    fontSize: 14,
    fontWeight: 400,
  },
  textarea: {
    padding: '10px 12px',
    borderRadius: 10,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    fontSize: 14,
    fontWeight: 400,
    resize: 'vertical',
  },
  hint: { margin: 0, fontSize: 13, color: TavariStyles.colors.gray500 },
  staffList: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' },
  linkRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, alignItems: 'center' },
  testRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  footer: { display: 'flex', justifyContent: 'flex-end' },
  primaryBtn: {
    padding: '12px 20px',
    borderRadius: 10,
    border: 'none',
    background: TavariStyles.colors.primary,
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 14px',
    borderRadius: 10,
    border: `1px solid ${TavariStyles.colors.gray300}`,
    background: '#fff',
    cursor: 'pointer',
    fontWeight: 600,
  },
  iconBtnDanger: {
    background: 'none',
    border: 'none',
    color: '#b91c1c',
    cursor: 'pointer',
  },
};
