import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { useBusinessContext } from '../../contexts/BusinessContext';
import {
  DATA_PULL_OPTIONS,
  FUNDING_APPLICATION_TYPES,
  FUNDING_STATUSES,
} from '../../constants/fundingConstants';
import * as fundingService from '../../services/Funding/fundingService';
import { fundingStyles as s } from './fundingStyles';

export default function FundingApplicationDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const [app, setApp] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [staff, setStaff] = useState([]);
  const [reminderStaffIds, setReminderStaffIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sensitiveKey, setSensitiveKey] = useState('sin');
  const [sensitiveValue, setSensitiveValue] = useState('');
  const [checklistTitle, setChecklistTitle] = useState('');
  const [newQuestionLabel, setNewQuestionLabel] = useState('');
  const [answers, setAnswers] = useState({});

  const load = useCallback(async () => {
    if (!selectedBusinessId || !id) return;
    setLoading(true);
    try {
      const [data, funderTemplates, staffList] = await Promise.all([
        fundingService.getApplication(selectedBusinessId, id),
        fundingService.listFunderTemplates(selectedBusinessId),
        fundingService.listBusinessStaff(selectedBusinessId),
      ]);
      if (!data) {
        toast.error('Application not found');
        navigate('/dashboard/funding/applications');
        return;
      }
      setApp(data);
      setTemplates(funderTemplates);
      setStaff(staffList);
      const map = {};
      (data.funding_application_answers || []).forEach((a) => {
        map[a.question_key] = a.value_text || '';
      });
      setAnswers(map);
    } catch (err) {
      toast.error(err.message || 'Failed to load application');
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId, id, navigate]);

  useEffect(() => {
    load();
  }, [load]);

  const persist = async (patch) => {
    const updated = await fundingService.updateApplication(selectedBusinessId, app.id, patch);
    setApp((prev) => ({ ...prev, ...updated }));
  };

  const applyTemplate = async () => {
    const template = templates.find((t) => t.id === selectedTemplateId);
    if (!template) return;
    try {
      for (const q of template.funding_funder_questions || []) {
        await fundingService.saveApplicationAnswer(selectedBusinessId, app.id, {
          question_id: q.id,
          question_key: q.question_key,
          label: q.label,
          value_text: answers[q.question_key] || '',
        });
      }
      toast.success('Funder questions applied');
      load();
    } catch (err) {
      toast.error(err.message || 'Failed to apply template');
    }
  };

  const saveAnswer = async (questionKey, label, value) => {
    setAnswers((prev) => ({ ...prev, [questionKey]: value }));
    await fundingService.saveApplicationAnswer(selectedBusinessId, app.id, {
      question_key: questionKey,
      label,
      value_text: value,
    });
  };

  const createReminder = async () => {
    if (!app.deadline_date) {
      toast.error('Set a deadline date first');
      return;
    }
    try {
      const reminder = await fundingService.createDeadlineReminder(selectedBusinessId, {
        title: `Funding deadline: ${app.title}`,
        body: `Deadline for ${app.title} (${app.funder_name || app.application_type}).`,
        onceDate: app.deadline_date,
        staffUserIds: reminderStaffIds,
      });
      await persist({ reminder_id: reminder.id });
      toast.success('Reminder created in Reminder module');
    } catch (err) {
      toast.error(err.message || 'Failed to create reminder');
    }
  };

  if (loading || !app) return <div style={s.empty}>Loading application…</div>;

  const activeTemplate = templates.find((t) => t.id === selectedTemplateId);

  return (
    <div>
      <div style={s.panel}>
        <div style={s.row}>
          <input
            style={{ ...s.input, flex: '1 1 240px', fontWeight: 700, fontSize: 18 }}
            value={app.title}
            onChange={(e) => setApp((p) => ({ ...p, title: e.target.value }))}
            onBlur={() => persist({ title: app.title })}
          />
          <select
            style={{ ...s.input, width: 150 }}
            value={app.status}
            onChange={(e) => persist({ status: e.target.value })}
          >
            {FUNDING_STATUSES.map((st) => (
              <option key={st.value} value={st.value}>{st.label}</option>
            ))}
          </select>
        </div>
        <div style={s.row}>
          <div style={{ flex: '1 1 140px' }}>
            <label style={s.label}>Type</label>
            <select
              style={s.input}
              value={app.application_type}
              onChange={(e) => persist({ application_type: e.target.value })}
            >
              {FUNDING_APPLICATION_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: '1 1 180px' }}>
            <label style={s.label}>Funder</label>
            <input
              style={s.input}
              value={app.funder_name || ''}
              onChange={(e) => setApp((p) => ({ ...p, funder_name: e.target.value }))}
              onBlur={() => persist({ funder_name: app.funder_name || '' })}
            />
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <label style={s.label}>Amount</label>
            <input
              style={s.input}
              type="number"
              value={app.amount_requested ?? ''}
              onChange={(e) => setApp((p) => ({ ...p, amount_requested: e.target.value }))}
              onBlur={() => persist({
                amount_requested: app.amount_requested === '' ? null : Number(app.amount_requested),
              })}
            />
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label style={s.label}>Deadline</label>
            <input
              style={s.input}
              type="date"
              value={app.deadline_date || ''}
              onChange={(e) => {
                const deadline_date = e.target.value || null;
                setApp((p) => ({ ...p, deadline_date }));
                persist({ deadline_date });
              }}
            />
          </div>
        </div>
        <label style={s.label}>Notes</label>
        <textarea
          style={s.textarea}
          value={app.notes || ''}
          onChange={(e) => setApp((p) => ({ ...p, notes: e.target.value }))}
          onBlur={() => persist({ notes: app.notes || '' })}
        />
        {app.funding_plans?.title && (
          <p style={{ color: '#6b7280' }}>
            Linked plan:
            {' '}
            <button
              type="button"
              style={s.buttonSecondary}
              onClick={() => navigate(`/dashboard/funding/plan/${app.plan_id}`)}
            >
              {app.funding_plans.title}
            </button>
          </p>
        )}
      </div>

      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>Data pull config</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {DATA_PULL_OPTIONS.map((opt) => (
            <TavariCheckbox
              key={opt.key}
              id={`app-pull-${opt.key}`}
              checked={Boolean((app.data_pull_config || {})[opt.key])}
              onChange={(next) => {
                const data_pull_config = { ...(app.data_pull_config || {}), [opt.key]: next };
                setApp((p) => ({ ...p, data_pull_config }));
                persist({ data_pull_config });
              }}
              label={opt.label}
            />
          ))}
        </div>
      </div>

      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>Checklist</h3>
        {(app.funding_checklist_items || []).map((item) => (
          <div key={item.id} style={s.row}>
            <TavariCheckbox
              id={`check-${item.id}`}
              checked={item.done}
              onChange={async (next) => {
                await fundingService.saveChecklistItem(
                  selectedBusinessId,
                  { ...item, done: next },
                  item.id
                );
                load();
              }}
              label={item.title}
            />
          </div>
        ))}
        <div style={s.row}>
          <input
            style={{ ...s.input, flex: '1 1 220px' }}
            placeholder="New checklist item"
            value={checklistTitle}
            onChange={(e) => setChecklistTitle(e.target.value)}
          />
          <button
            type="button"
            style={s.button}
            onClick={async () => {
              if (!checklistTitle.trim()) return;
              await fundingService.saveChecklistItem(selectedBusinessId, {
                application_id: app.id,
                plan_id: app.plan_id,
                title: checklistTitle.trim(),
                sort_order: (app.funding_checklist_items || []).length + 1,
              });
              setChecklistTitle('');
              load();
            }}
          >
            Add item
          </button>
        </div>
      </div>

      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>Funder-specific questions</h3>
        <div style={s.row}>
          <select
            style={{ ...s.input, flex: '1 1 220px' }}
            value={selectedTemplateId}
            onChange={(e) => setSelectedTemplateId(e.target.value)}
          >
            <option value="">Select funder template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button type="button" style={s.buttonSecondary} onClick={applyTemplate} disabled={!selectedTemplateId}>
            Load questions
          </button>
        </div>
        {(activeTemplate?.funding_funder_questions || Object.keys(answers).map((key) => ({
          question_key: key,
          label: key,
        }))).map((q) => (
          <div key={q.question_key || q.id} style={{ marginBottom: 12 }}>
            <label style={s.label}>{q.label}</label>
            <textarea
              style={s.textarea}
              value={answers[q.question_key] || ''}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [q.question_key]: e.target.value }))}
              onBlur={(e) => saveAnswer(q.question_key, q.label, e.target.value)}
            />
          </div>
        ))}
        <div style={s.row}>
          <input
            style={{ ...s.input, flex: '1 1 200px' }}
            placeholder="Add ad-hoc question label"
            value={newQuestionLabel}
            onChange={(e) => setNewQuestionLabel(e.target.value)}
          />
          <button
            type="button"
            style={s.buttonSecondary}
            onClick={async () => {
              if (!newQuestionLabel.trim()) return;
              const key = `custom_${Date.now()}`;
              await saveAnswer(key, newQuestionLabel.trim(), '');
              setNewQuestionLabel('');
              load();
            }}
          >
            Add question
          </button>
        </div>
      </div>

      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>Sensitive fields (encrypted)</h3>
        <div style={s.row}>
          <select style={{ ...s.input, width: 180 }} value={sensitiveKey} onChange={(e) => setSensitiveKey(e.target.value)}>
            <option value="sin">SIN</option>
            <option value="credit_score">Credit score</option>
            <option value="personal_net_worth">Personal net worth</option>
            <option value="other">Other</option>
          </select>
          <input
            style={{ ...s.input, flex: '1 1 180px' }}
            type="password"
            placeholder="Value (stored encrypted)"
            value={sensitiveValue}
            onChange={(e) => setSensitiveValue(e.target.value)}
          />
          <button
            type="button"
            style={s.button}
            onClick={async () => {
              if (!sensitiveValue.trim()) return;
              await fundingService.saveSensitiveField(selectedBusinessId, {
                application_id: app.id,
                field_key: sensitiveKey,
                label: sensitiveKey,
                value: sensitiveValue.trim(),
              });
              setSensitiveValue('');
              toast.success('Encrypted field saved');
              load();
            }}
          >
            Save encrypted
          </button>
        </div>
        <ul>
          {(app.funding_sensitive_fields || []).map((field) => (
            <li key={field.id}>
              {field.label || field.field_key}
              {' '}
              <button
                type="button"
                style={s.buttonSecondary}
                onClick={async () => {
                  try {
                    const value = await fundingService.decryptSensitiveField(selectedBusinessId, field.id);
                    window.alert(`Decrypted value:\n${value}`);
                  } catch (err) {
                    toast.error(err.message || 'Decrypt failed (owner only)');
                  }
                }}
              >
                Reveal (owner)
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>Deadline reminder (Reminder module)</h3>
        <p style={{ color: '#6b7280', fontSize: 14 }}>Select who should receive the reminder.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          {staff.map((person) => (
            <TavariCheckbox
              key={person.user_id}
              id={`rem-${person.user_id}`}
              checked={reminderStaffIds.includes(person.user_id)}
              onChange={(next) => {
                setReminderStaffIds((prev) =>
                  (next ? [...prev, person.user_id] : prev.filter((uid) => uid !== person.user_id))
                );
              }}
              label={person.full_name || person.email}
            />
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <button type="button" style={s.button} onClick={createReminder}>
            Create reminder from deadline
          </button>
        </div>
      </div>

      <div style={s.row}>
        <button
          type="button"
          style={s.buttonSecondary}
          onClick={() => {
            const html = fundingService.buildExportHtml({
              title: app.title,
              sections: [
                { title: 'Overview', enabled: true, content: app.notes || '' },
                ...Object.entries(answers).map(([key, value]) => ({
                  title: key,
                  enabled: true,
                  content: value,
                })),
              ],
              meta: {
                funder_name: app.funder_name,
                status: app.status,
                generated_at: new Date().toLocaleString('en-CA'),
              },
            });
            fundingService.downloadTextFile(`${app.title || 'application'}.html`, html, 'text/html;charset=utf-8');
          }}
        >
          Export package (HTML)
        </button>
        <button
          type="button"
          style={s.buttonDanger}
          onClick={async () => {
            if (!window.confirm('Delete this application?')) return;
            await fundingService.deleteApplication(selectedBusinessId, app.id);
            toast.success('Deleted');
            navigate('/dashboard/funding/applications');
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
