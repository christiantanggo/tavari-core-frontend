import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { FUNDING_APPLICATION_TYPES } from '../../constants/fundingConstants';
import * as fundingService from '../../services/Funding/fundingService';
import { fundingStyles as s } from './fundingStyles';

export default function FundingApplicationsScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { selectedBusinessId } = useBusinessContext();
  const [apps, setApps] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [applicationType, setApplicationType] = useState('grant');
  const [planId, setPlanId] = useState(searchParams.get('planId') || '');
  const [funderName, setFunderName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!selectedBusinessId) return;
    setLoading(true);
    try {
      const [list, planList] = await Promise.all([
        fundingService.listApplications(selectedBusinessId),
        fundingService.listPlans(selectedBusinessId),
      ]);
      setApps(list);
      setPlans(planList);
    } catch (err) {
      toast.error(err.message || 'Failed to load applications');
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      const app = await fundingService.createApplication(selectedBusinessId, {
        title: title.trim() || 'Untitled application',
        application_type: applicationType,
        plan_id: planId || null,
        funder_name: funderName.trim(),
      });
      toast.success('Application created');
      navigate(`/dashboard/funding/application/${app.id}`);
    } catch (err) {
      toast.error(err.message || 'Failed to create application');
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div style={s.empty}>Loading applications…</div>;

  return (
    <div>
      <form style={s.panel} onSubmit={handleCreate}>
        <h3 style={{ marginTop: 0 }}>Create application</h3>
        <div style={s.row}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={s.label}>Title</label>
            <input style={s.input} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label style={s.label}>Type</label>
            <select style={s.input} value={applicationType} onChange={(e) => setApplicationType(e.target.value)}>
              {FUNDING_APPLICATION_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={s.label}>Link to plan (optional)</label>
            <select style={s.input} value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Standalone</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={s.label}>Funder</label>
            <input style={s.input} value={funderName} onChange={(e) => setFunderName(e.target.value)} />
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            <button type="submit" style={s.button} disabled={creating}>
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      </form>

      {apps.length === 0 ? (
        <div style={s.empty}>No applications yet.</div>
      ) : (
        <div style={s.grid}>
          {apps.map((app) => (
            <div
              key={app.id}
              style={s.card}
              onClick={() => navigate(`/dashboard/funding/application/${app.id}`)}
            >
              <div style={s.title}>{app.title}</div>
              <div style={s.meta}>
                {app.application_type?.replace(/_/g, ' ')}
                {app.funder_name ? ` · ${app.funder_name}` : ''}
                {app.funding_plans?.title ? ` · Plan: ${app.funding_plans.title}` : ''}
              </div>
              <span style={s.badge(app.status)}>{app.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
