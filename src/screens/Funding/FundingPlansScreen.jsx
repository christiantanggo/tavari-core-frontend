import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useBusinessContext } from '../../contexts/BusinessContext';
import * as fundingService from '../../services/Funding/fundingService';
import { FUNDING_ENTITY_SCOPES } from '../../constants/fundingConstants';
import { fundingStyles as s } from './fundingStyles';

export default function FundingPlansScreen() {
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [entityScope, setEntityScope] = useState('current_business');

  const load = useCallback(async () => {
    if (!selectedBusinessId) return;
    setLoading(true);
    try {
      setPlans(await fundingService.listPlans(selectedBusinessId));
    } catch (err) {
      toast.error(err.message || 'Failed to load plans');
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!selectedBusinessId) return;
    setCreating(true);
    try {
      const plan = await fundingService.createPlan(selectedBusinessId, {
        title: title.trim() || 'Untitled business plan',
        entity_scope: entityScope,
      });
      toast.success('Plan created');
      navigate(`/dashboard/funding/plan/${plan.id}`);
    } catch (err) {
      toast.error(err.message || 'Failed to create plan');
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div style={s.empty}>Loading plans…</div>;

  return (
    <div>
      <form style={s.panel} onSubmit={handleCreate}>
        <h3 style={{ marginTop: 0 }}>Create business plan</h3>
        <div style={s.row}>
          <div style={{ flex: '1 1 220px' }}>
            <label style={s.label}>Title</label>
            <input
              style={s.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. 2026 Expansion Plan"
            />
          </div>
          <div style={{ flex: '1 1 180px' }}>
            <label style={s.label}>Scope</label>
            <select style={s.input} value={entityScope} onChange={(e) => setEntityScope(e.target.value)}>
              {FUNDING_ENTITY_SCOPES.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            <button type="submit" style={s.button} disabled={creating}>
              {creating ? 'Creating…' : 'Create plan'}
            </button>
          </div>
        </div>
      </form>

      {plans.length === 0 ? (
        <div style={s.empty}>No plans yet.</div>
      ) : (
        <div style={s.grid}>
          {plans.map((plan) => (
            <div
              key={plan.id}
              style={s.card}
              onClick={() => navigate(`/dashboard/funding/plan/${plan.id}`)}
            >
              <div style={s.title}>{plan.title}</div>
              <div style={s.meta}>
                {plan.entity_scope?.replace(/_/g, ' ')}
                {(plan.funding_applications || []).length
                  ? ` · ${(plan.funding_applications || []).length} linked apps`
                  : ''}
              </div>
              <span style={s.badge(plan.status)}>{plan.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
