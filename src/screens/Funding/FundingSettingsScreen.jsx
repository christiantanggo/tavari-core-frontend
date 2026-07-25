import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import ModuleDeactivationPanel from '../../components/Modules/ModuleDeactivationPanel';
import { useBusinessContext } from '../../contexts/BusinessContext';
import {
  DATA_PULL_OPTIONS,
  DEDUCTLY_INDUSTRIES,
  DEDUCTLY_PROVINCES,
  FUNDING_APPLICATION_TYPES,
} from '../../constants/fundingConstants';
import * as fundingService from '../../services/Funding/fundingService';
import { fundingStyles as s } from './fundingStyles';

export default function FundingSettingsScreen() {
  const { selectedBusinessId } = useBusinessContext();
  const [settings, setSettings] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [templateName, setTemplateName] = useState('');
  const [templateType, setTemplateType] = useState('grant');
  const [questionDraft, setQuestionDraft] = useState('');

  const load = useCallback(async () => {
    if (!selectedBusinessId) return;
    setLoading(true);
    try {
      const [cfg, funderTemplates] = await Promise.all([
        fundingService.getOrCreateSettings(selectedBusinessId),
        fundingService.listFunderTemplates(selectedBusinessId),
      ]);
      setSettings(cfg);
      setTemplates(funderTemplates);
    } catch (err) {
      toast.error(err.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (patch) => {
    const next = await fundingService.saveSettings(selectedBusinessId, patch);
    setSettings(next);
    toast.success('Settings saved');
  };

  if (loading || !settings) return <div style={s.empty}>Loading settings…</div>;

  const types = settings.deductly_program_types || ['grant'];

  return (
    <div>
      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>Deductly program alerts</h3>
        <TavariCheckbox
          id="deductly-alerts"
          checked={settings.deductly_alerts_enabled !== false}
          onChange={(next) => save({ deductly_alerts_enabled: next })}
          label="Send Reminder-module alerts when new matching programs appear"
        />
        <div style={s.row}>
          <div style={{ flex: '1 1 180px' }}>
            <label style={s.label}>Province</label>
            <select
              style={s.input}
              value={settings.deductly_province || ''}
              onChange={(e) => save({ deductly_province: e.target.value || null })}
            >
              <option value="">Any</option>
              {DEDUCTLY_PROVINCES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: '1 1 180px' }}>
            <label style={s.label}>Industry</label>
            <select
              style={s.input}
              value={settings.deductly_industry || ''}
              onChange={(e) => save({ deductly_industry: e.target.value || null })}
            >
              <option value="">Any</option>
              {DEDUCTLY_INDUSTRIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={s.label}>Program types</label>
          {['grant', 'tax_credit', 'deduction', 'incentive'].map((type) => (
            <TavariCheckbox
              key={type}
              id={`type-${type}`}
              checked={types.includes(type)}
              onChange={(next) => {
                const deductly_program_types = next
                  ? [...new Set([...types, type])]
                  : types.filter((t) => t !== type);
                save({ deductly_program_types: deductly_program_types.length ? deductly_program_types : ['grant'] });
              }}
              label={type.replace(/_/g, ' ')}
            />
          ))}
        </div>
      </div>

      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>AI writing tone</h3>
        <input
          style={s.input}
          value={settings.ai_tone || ''}
          onChange={(e) => setSettings((prev) => ({ ...prev, ai_tone: e.target.value }))}
          onBlur={() => save({ ai_tone: settings.ai_tone })}
        />
      </div>

      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>Default data pull options</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {DATA_PULL_OPTIONS.map((opt) => (
            <TavariCheckbox
              key={opt.key}
              id={`default-pull-${opt.key}`}
              checked={Boolean((settings.default_data_pulls || {})[opt.key])}
              onChange={(next) => {
                const default_data_pulls = {
                  ...(settings.default_data_pulls || {}),
                  [opt.key]: next,
                };
                save({ default_data_pulls });
              }}
              label={opt.label}
            />
          ))}
        </div>
      </div>

      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>Funder question banks</h3>
        <p style={{ color: '#6b7280', fontSize: 14 }}>
          Configure funder-specific questions for your business. Start empty; add banks as you need them.
        </p>
        <div style={s.row}>
          <input
            style={{ ...s.input, flex: '1 1 180px' }}
            placeholder="Template name (e.g. BDC equipment loan)"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
          />
          <select style={{ ...s.input, width: 160 }} value={templateType} onChange={(e) => setTemplateType(e.target.value)}>
            {FUNDING_APPLICATION_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div style={s.row}>
          <input
            style={{ ...s.input, flex: '1 1 220px' }}
            placeholder="First question label"
            value={questionDraft}
            onChange={(e) => setQuestionDraft(e.target.value)}
          />
          <button
            type="button"
            style={s.button}
            onClick={async () => {
              if (!templateName.trim()) {
                toast.error('Template name required');
                return;
              }
              await fundingService.saveFunderTemplate(selectedBusinessId, {
                name: templateName.trim(),
                funder_type: templateType,
                questions: questionDraft.trim()
                  ? [{ question_key: 'q1', label: questionDraft.trim(), field_type: 'textarea' }]
                  : [],
              });
              setTemplateName('');
              setQuestionDraft('');
              toast.success('Template created');
              load();
            }}
          >
            Add template
          </button>
        </div>
        <ul>
          {templates.map((t) => (
            <li key={t.id} style={{ marginBottom: 8 }}>
              <strong>{t.name}</strong>
              {' '}
              ({t.funder_type}) — {(t.funding_funder_questions || []).length} questions
            </li>
          ))}
        </ul>
      </div>

      <ModuleDeactivationPanel moduleKey="funding" moduleName="Tavari Funding" />
    </div>
  );
}
