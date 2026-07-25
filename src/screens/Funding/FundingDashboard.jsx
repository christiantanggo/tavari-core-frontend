import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import * as fundingService from '../../services/Funding/fundingService';
import { fundingStyles as s } from './fundingStyles';

export default function FundingDashboard() {
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const { hasPermission } = usePermissions();
  const canView = hasPermission('funding.view') || hasPermission('funding.edit');

  const [stats, setStats] = useState(null);
  const [plans, setPlans] = useState([]);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!selectedBusinessId || !canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [summary, planList, appList] = await Promise.all([
        fundingService.getDashboardStats(selectedBusinessId),
        fundingService.listPlans(selectedBusinessId),
        fundingService.listApplications(selectedBusinessId),
      ]);
      setStats(summary);
      setPlans(planList.slice(0, 6));
      setApps(appList.slice(0, 6));
    } catch (err) {
      toast.error(err.message || 'Failed to load Funding dashboard');
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId, canView]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <div style={s.empty}>Loading Funding…</div>;
  }

  if (!canView) {
    return (
      <div style={s.empty}>
        You do not have permission to view Funding. Ask a business owner to grant Funding access.
      </div>
    );
  }

  return (
    <div>
      <div style={s.stats}>
        {[
          ['Plans', stats?.plans ?? 0],
          ['Applications', stats?.applications ?? 0],
          ['Drafts / ideas', stats?.activeDrafts ?? 0],
          ['Submitted', stats?.submitted ?? 0],
          ['Upcoming deadlines', stats?.upcomingDeadlines ?? 0],
          ['New programs', stats?.newPrograms ?? 0],
        ].map(([label, value]) => (
          <div key={label} style={s.statCard}>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#0f172a' }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ ...s.row, marginTop: 24, justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Recent plans</h3>
        <button type="button" style={s.buttonSecondary} onClick={() => navigate('/dashboard/funding/plans')}>
          View all
        </button>
      </div>
      {plans.length === 0 ? (
        <div style={s.empty}>No business plans yet. Create one to get started.</div>
      ) : (
        <div style={s.grid}>
          {plans.map((plan) => (
            <div
              key={plan.id}
              style={s.card}
              onClick={() => navigate(`/dashboard/funding/plan/${plan.id}`)}
            >
              <div style={s.title}>{plan.title}</div>
              <div style={s.meta}>{plan.entity_scope?.replace(/_/g, ' ')}</div>
              <span style={s.badge(plan.status)}>{plan.status}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ ...s.row, marginTop: 28, justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>Recent applications</h3>
        <button type="button" style={s.buttonSecondary} onClick={() => navigate('/dashboard/funding/applications')}>
          View all
        </button>
      </div>
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
              </div>
              <span style={s.badge(app.status)}>{app.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
