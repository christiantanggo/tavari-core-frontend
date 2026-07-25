import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { useBusinessContext } from '../../contexts/BusinessContext';
import {
  DATA_PULL_OPTIONS,
  FUNDING_ENTITY_SCOPES,
  FUNDING_SCENARIO_TYPES,
  FUNDING_STATUSES,
} from '../../constants/fundingConstants';
import * as fundingService from '../../services/Funding/fundingService';
import { fundingStyles as s } from './fundingStyles';

export default function FundingPlanDetailScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState({});
  const [aiBusyKey, setAiBusyKey] = useState(null);
  const [staff, setStaff] = useState([]);
  const [guestEmail, setGuestEmail] = useState('');
  const [guestAccess, setGuestAccess] = useState('view');
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [scenarioName, setScenarioName] = useState('');
  const [scenarioType, setScenarioType] = useState('expansion');
  const [createBizConfig, setCreateBizConfig] = useState({});

  const load = useCallback(async () => {
    if (!selectedBusinessId || !id) return;
    setLoading(true);
    try {
      const [data, staffList] = await Promise.all([
        fundingService.getPlan(selectedBusinessId, id),
        fundingService.listBusinessStaff(selectedBusinessId),
      ]);
      if (!data) {
        toast.error('Plan not found');
        navigate('/dashboard/funding/plans');
        return;
      }
      setPlan(data);
      setCreateBizConfig(data.create_business_config || {});
      setStaff(staffList);
      const open = {};
      (data.funding_plan_sections || []).forEach((sec) => {
        open[sec.id] = !sec.collapsed_default;
      });
      setOpenSections(open);
    } catch (err) {
      toast.error(err.message || 'Failed to load plan');
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId, id, navigate]);

  useEffect(() => {
    load();
  }, [load]);

  const dataPullConfig = useMemo(
    () => plan?.data_pull_config || {},
    [plan]
  );

  const persistPlan = async (patch) => {
    if (!selectedBusinessId || !plan) return;
    setSaving(true);
    try {
      const updated = await fundingService.updatePlan(selectedBusinessId, plan.id, patch);
      setPlan((prev) => ({ ...prev, ...updated }));
      await fundingService.snapshotPlanVersion(selectedBusinessId, plan.id);
    } catch (err) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const persistSection = async (sectionId, patch) => {
    if (!selectedBusinessId) return;
    try {
      const updated = await fundingService.updatePlanSection(selectedBusinessId, sectionId, patch);
      setPlan((prev) => ({
        ...prev,
        funding_plan_sections: (prev.funding_plan_sections || []).map((sec) =>
          (sec.id === sectionId ? { ...sec, ...updated } : sec)
        ),
      }));
    } catch (err) {
      toast.error(err.message || 'Failed to update section');
    }
  };

  const runAi = async (section, mode) => {
    if (!selectedBusinessId || !plan) return;
    setAiBusyKey(`${section.id}:${mode}`);
    try {
      const profile = await fundingService.pullBusinessProfile(selectedBusinessId);
      const content = await fundingService.generateAiContent({
        mode,
        sectionTitle: section.title,
        currentContent: section.content,
        businessContext: {
          plan_title: plan.title,
          entity_scope: plan.entity_scope,
          summary: plan.summary,
          business: profile,
          data_pull_config: plan.data_pull_config,
        },
      });
      await persistSection(section.id, { content });
      toast.success('AI content applied');
    } catch (err) {
      toast.error(err.message || 'AI writing failed');
    } finally {
      setAiBusyKey(null);
    }
  };

  const inviteStaff = async () => {
    if (!selectedStaffId) return;
    try {
      await fundingService.inviteCollaborator(selectedBusinessId, {
        plan_id: plan.id,
        user_id: selectedStaffId,
        access_level: guestAccess,
        can_see_financials: false,
      });
      toast.success('Staff collaborator added');
      setSelectedStaffId('');
      load();
    } catch (err) {
      toast.error(err.message || 'Failed to invite staff');
    }
  };

  const inviteGuest = async () => {
    if (!guestEmail.trim()) return;
    try {
      const { guestLink } = await fundingService.inviteCollaborator(selectedBusinessId, {
        plan_id: plan.id,
        guest_email: guestEmail.trim(),
        access_level: guestAccess,
        can_see_financials: false,
      });
      if (guestLink) {
        await navigator.clipboard?.writeText(guestLink);
        toast.success('Guest magic link copied to clipboard');
      } else {
        toast.success('Guest invited');
      }
      setGuestEmail('');
      load();
    } catch (err) {
      toast.error(err.message || 'Failed to invite guest');
    }
  };

  const addScenario = async () => {
    if (!scenarioName.trim()) return;
    try {
      await fundingService.saveScenario(selectedBusinessId, plan.id, {
        name: scenarioName.trim(),
        scenario_type: scenarioType,
      });
      setScenarioName('');
      toast.success('Scenario added');
      load();
    } catch (err) {
      toast.error(err.message || 'Failed to add scenario');
    }
  };

  const exportPlan = async (format) => {
    const sections = plan.funding_plan_sections || [];
    const html = fundingService.buildExportHtml({
      title: plan.title,
      sections,
      meta: {
        status: plan.status,
        generated_at: new Date().toLocaleString('en-CA'),
      },
    });
    if (format === 'html' || format === 'pdf') {
      fundingService.downloadTextFile(`${plan.title || 'plan'}.html`, html, 'text/html;charset=utf-8');
      if (format === 'pdf') {
        toast('Open the HTML file and print to PDF from your browser', { icon: '📄' });
      }
      return;
    }
    const text = sections
      .filter((sec) => sec.enabled)
      .map((sec) => `${sec.title}\n\n${sec.content || ''}\n`)
      .join('\n-----\n\n');
    fundingService.downloadTextFile(`${plan.title || 'plan'}.doc`, text, 'application/msword');
  };

  const openNewBusiness = () => {
    const params = new URLSearchParams({
      from_funding_plan: plan.id,
      name: plan.target_business_name || plan.title || '',
    });
    Object.entries(createBizConfig || {}).forEach(([key, value]) => {
      if (value) params.set(key, '1');
    });
    navigate(`/dashboard/new-business?${params.toString()}`);
  };

  if (loading || !plan) return <div style={s.empty}>Loading plan…</div>;

  return (
    <div>
      <div style={s.panel}>
        <div style={{ ...s.row, justifyContent: 'space-between' }}>
          <input
            style={{ ...s.input, fontSize: 20, fontWeight: 700, border: '1 1 280px' }}
            value={plan.title}
            onChange={(e) => setPlan((p) => ({ ...p, title: e.target.value }))}
            onBlur={() => persistPlan({ title: plan.title })}
          />
          <select
            style={{ ...s.input, width: 160 }}
            value={plan.status}
            onChange={(e) => {
              const status = e.target.value;
              setPlan((p) => ({ ...p, status }));
              persistPlan({ status });
            }}
          >
            {FUNDING_STATUSES.map((st) => (
              <option key={st.value} value={st.value}>{st.label}</option>
            ))}
          </select>
        </div>
        <div style={s.row}>
          <div style={{ flex: '1 1 180px' }}>
            <label style={s.label}>Scope</label>
            <select
              style={s.input}
              value={plan.entity_scope}
              onChange={(e) => {
                const entity_scope = e.target.value;
                setPlan((p) => ({ ...p, entity_scope }));
                persistPlan({ entity_scope });
              }}
            >
              {FUNDING_ENTITY_SCOPES.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: '1 1 220px' }}>
            <label style={s.label}>Target / future business name</label>
            <input
              style={s.input}
              value={plan.target_business_name || ''}
              onChange={(e) => setPlan((p) => ({ ...p, target_business_name: e.target.value }))}
              onBlur={() => persistPlan({ target_business_name: plan.target_business_name || null })}
              placeholder="Optional — for new ventures"
            />
          </div>
        </div>
        <label style={s.label}>Summary</label>
        <textarea
          style={s.textarea}
          value={plan.summary || ''}
          onChange={(e) => setPlan((p) => ({ ...p, summary: e.target.value }))}
          onBlur={() => persistPlan({ summary: plan.summary || '' })}
        />
        <div style={{ ...s.row, marginTop: 12 }}>
          <button type="button" style={s.buttonSecondary} onClick={() => exportPlan('html')}>Export HTML</button>
          <button type="button" style={s.buttonSecondary} onClick={() => exportPlan('pdf')}>Export PDF (print)</button>
          <button type="button" style={s.buttonSecondary} onClick={() => exportPlan('word')}>Export Word</button>
          <button
            type="button"
            style={s.buttonSecondary}
            onClick={async () => {
              await fundingService.snapshotPlanVersion(selectedBusinessId, plan.id);
              toast.success('Version saved');
              load();
            }}
          >
            Snapshot version
          </button>
          <span style={{ color: '#6b7280', fontSize: 13 }}>
            {saving ? 'Saving…' : `${(plan.funding_plan_versions || []).length} versions`}
          </span>
        </div>
      </div>

      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>Data to include (configurable)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {DATA_PULL_OPTIONS.map((opt) => (
            <TavariCheckbox
              key={opt.key}
              id={`pull-${opt.key}`}
              checked={Boolean(dataPullConfig[opt.key])}
              onChange={(next) => {
                const nextConfig = { ...dataPullConfig, [opt.key]: next };
                setPlan((p) => ({ ...p, data_pull_config: nextConfig }));
                persistPlan({ data_pull_config: nextConfig });
              }}
              label={opt.label}
            />
          ))}
        </div>
      </div>

      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>Plan sections</h3>
        {(plan.funding_plan_sections || []).map((section) => {
          const open = openSections[section.id];
          return (
            <div key={section.id} style={{ borderTop: '1px solid #e5e7eb', paddingTop: 8 }}>
              <div style={s.row}>
                <TavariCheckbox
                  id={`sec-en-${section.id}`}
                  checked={section.enabled}
                  onChange={(next) => persistSection(section.id, { enabled: next })}
                  label=""
                />
                <button
                  type="button"
                  style={s.sectionHeader}
                  onClick={() => setOpenSections((prev) => ({ ...prev, [section.id]: !open }))}
                >
                  {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  <strong>{section.title}</strong>
                </button>
              </div>
              {open && section.enabled && (
                <div style={{ paddingLeft: 8, paddingBottom: 16 }}>
                  <textarea
                    style={s.textarea}
                    value={section.content || ''}
                    onChange={(e) => {
                      const content = e.target.value;
                      setPlan((prev) => ({
                        ...prev,
                        funding_plan_sections: prev.funding_plan_sections.map((sec) =>
                          (sec.id === section.id ? { ...sec, content } : sec)
                        ),
                      }));
                    }}
                    onBlur={(e) => persistSection(section.id, { content: e.target.value })}
                  />
                  <div style={s.row}>
                    {['draft', 'rewrite', 'fill'].map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        style={s.buttonSecondary}
                        disabled={aiBusyKey === `${section.id}:${mode}`}
                        onClick={() => runAi(section, mode)}
                      >
                        {aiBusyKey === `${section.id}:${mode}` ? 'Working…' : `AI ${mode}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>Scenarios</h3>
        <ul style={{ marginTop: 0 }}>
          {(plan.funding_scenarios || []).map((sc) => (
            <li key={sc.id} style={{ marginBottom: 6 }}>
              <strong>{sc.name}</strong>
              {' '}
              <span style={{ color: '#6b7280' }}>({sc.scenario_type.replace(/_/g, ' ')})</span>
            </li>
          ))}
        </ul>
        <div style={s.row}>
          <input
            style={{ ...s.input, flex: '1 1 180px' }}
            placeholder="Scenario name"
            value={scenarioName}
            onChange={(e) => setScenarioName(e.target.value)}
          />
          <select style={{ ...s.input, width: 180 }} value={scenarioType} onChange={(e) => setScenarioType(e.target.value)}>
            {FUNDING_SCENARIO_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button type="button" style={s.button} onClick={addScenario}>Add scenario</button>
        </div>
      </div>

      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>Linked applications</h3>
        {(plan.funding_applications || []).length === 0 ? (
          <p style={{ color: '#6b7280' }}>No applications linked yet.</p>
        ) : (
          <ul>
            {(plan.funding_applications || []).map((app) => (
              <li key={app.id}>
                <button
                  type="button"
                  style={{ ...s.buttonSecondary, marginBottom: 6 }}
                  onClick={() => navigate(`/dashboard/funding/application/${app.id}`)}
                >
                  {app.title} ({app.status})
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          style={s.button}
          onClick={() => navigate(`/dashboard/funding/applications/new?planId=${plan.id}`)}
        >
          Link new application
        </button>
      </div>

      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>Collaborators</h3>
        <div style={s.row}>
          <select
            style={{ ...s.input, flex: '1 1 200px' }}
            value={selectedStaffId}
            onChange={(e) => setSelectedStaffId(e.target.value)}
          >
            <option value="">Select staff…</option>
            {staff.map((person) => (
              <option key={person.user_id} value={person.user_id}>
                {person.full_name || person.email} ({person.role})
              </option>
            ))}
          </select>
          <select style={{ ...s.input, width: 120 }} value={guestAccess} onChange={(e) => setGuestAccess(e.target.value)}>
            <option value="view">View</option>
            <option value="edit">Edit</option>
          </select>
          <button type="button" style={s.button} onClick={inviteStaff}>Add staff</button>
        </div>
        <div style={s.row}>
          <input
            style={{ ...s.input, flex: '1 1 220px' }}
            type="email"
            placeholder="Guest email (magic link)"
            value={guestEmail}
            onChange={(e) => setGuestEmail(e.target.value)}
          />
          <button type="button" style={s.buttonSecondary} onClick={inviteGuest}>Invite guest</button>
        </div>
        <ul>
          {(plan.funding_collaborators || []).map((c) => (
            <li key={c.id} style={{ marginBottom: 6 }}>
              {c.guest_email || c.user_id}
              {' · '}
              {c.access_level}
              {' '}
              <button
                type="button"
                style={s.buttonDanger}
                onClick={async () => {
                  await fundingService.removeCollaborator(selectedBusinessId, c.id);
                  load();
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>Create Tavari business from this plan</h3>
        <p style={{ color: '#6b7280', fontSize: 14 }}>
          Choose what to carry over, then open the new-business flow with those preferences.
        </p>
        {[
          ['copy_profile', 'Copy profile fields'],
          ['copy_projections', 'Copy projections'],
          ['copy_documents', 'Copy documents'],
          ['copy_team_access', 'Copy team access'],
          ['copy_plan_content', 'Copy plan content'],
        ].map(([key, label]) => (
          <TavariCheckbox
            key={key}
            id={`create-${key}`}
            checked={Boolean(createBizConfig[key])}
            onChange={(next) => {
              const nextConfig = { ...createBizConfig, [key]: next };
              setCreateBizConfig(nextConfig);
              persistPlan({ create_business_config: nextConfig });
            }}
            label={label}
          />
        ))}
        <div style={{ marginTop: 12 }}>
          <button type="button" style={s.button} onClick={openNewBusiness}>
            Open new business wizard
          </button>
        </div>
      </div>

      <div style={{ ...s.row, marginTop: 16 }}>
        <button
          type="button"
          style={s.buttonDanger}
          onClick={async () => {
            if (!window.confirm('Delete this plan?')) return;
            await fundingService.deletePlan(selectedBusinessId, plan.id);
            toast.success('Plan deleted');
            navigate('/dashboard/funding/plans');
          }}
        >
          Delete plan
        </button>
      </div>
    </div>
  );
}
