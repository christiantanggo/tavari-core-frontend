import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { supabase } from '../../supabaseClient';
import * as fundingService from '../../services/Funding/fundingService';
import { fetchDeductlyPrograms } from '../../services/Funding/deductlyService';
import { fundingStyles as s } from './fundingStyles';

export default function FundingOpportunitiesScreen() {
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const [settings, setSettings] = useState(null);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [liveResults, setLiveResults] = useState([]);

  const load = useCallback(async () => {
    if (!selectedBusinessId) return;
    setLoading(true);
    try {
      const [cfg, list] = await Promise.all([
        fundingService.getOrCreateSettings(selectedBusinessId),
        fundingService.listProgramMatches(selectedBusinessId),
      ]);
      setSettings(cfg);
      setMatches(list);
    } catch (err) {
      toast.error(err.message || 'Failed to load opportunities');
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId]);

  useEffect(() => {
    load();
  }, [load]);

  const syncPrograms = async () => {
    if (!selectedBusinessId) return;
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('funding-deductly-sync', {
        body: { business_id: selectedBusinessId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Synced ${data.synced ?? 0} programs (${data.new_count ?? 0} new)`);
      load();
    } catch (err) {
      // Fallback: client-side Deductly browse + local upsert
      try {
        const live = await fetchDeductlyPrograms({
          province: settings?.deductly_province || undefined,
          industry: settings?.deductly_industry || undefined,
          type: (settings?.deductly_program_types || ['grant'])[0],
        });
        setLiveResults(live.results || []);
        await fundingService.upsertProgramMatches(selectedBusinessId, live.results || []);
        toast.success(`Loaded ${live.total} programs from Deductly`);
        load();
      } catch (fallbackErr) {
        toast.error(fallbackErr.message || err.message || 'Deductly sync failed');
      }
    } finally {
      setSyncing(false);
    }
  };

  const startApplication = async (program) => {
    try {
      const app = await fundingService.createApplication(selectedBusinessId, {
        title: program.name,
        application_type: program.program_type === 'tax_credit' ? 'other' : 'grant',
        funder_name: program.name,
        deductly_program_id: program.deductly_program_id || program.id,
        notes: program.description || '',
      });
      await fundingService.markProgramSeen(selectedBusinessId, program.id).catch(() => {});
      navigate(`/dashboard/funding/application/${app.id}`);
    } catch (err) {
      toast.error(err.message || 'Failed to start application');
    }
  };

  if (loading) return <div style={s.empty}>Loading opportunities…</div>;

  const rows = matches.length
    ? matches
    : liveResults.map((r) => ({
      id: r.id,
      deductly_program_id: r.id,
      name: r.name,
      program_type: r.type,
      description: r.description,
      estimated_value: r.estimated_value,
      application_url: r.application_url,
      deadline: r.deadline,
      is_new: true,
    }));

  return (
    <div>
      <div style={s.panel}>
        <div style={{ ...s.row, justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ marginTop: 0, marginBottom: 6 }}>Canadian funding opportunities</h3>
            <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>
              Powered by Deductly open programs
              {settings?.deductly_province ? ` · ${settings.deductly_province}` : ''}
              {settings?.deductly_industry ? ` · ${settings.deductly_industry}` : ''}
            </p>
          </div>
          <button type="button" style={s.button} onClick={syncPrograms} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync Deductly'}
          </button>
        </div>
        <button
          type="button"
          style={{ ...s.buttonSecondary, marginTop: 12 }}
          onClick={() => navigate('/dashboard/funding/settings')}
        >
          Configure filters in Settings
        </button>
      </div>

      {rows.length === 0 ? (
        <div style={s.empty}>
          No programs yet. Click Sync Deductly after setting province/industry in Funding Settings.
        </div>
      ) : (
        <div style={s.grid}>
          {rows.map((program) => (
            <div key={program.id} style={{ ...s.card, cursor: 'default' }}>
              <div style={{ ...s.row, justifyContent: 'space-between' }}>
                <div style={s.title}>{program.name}</div>
                {program.is_new ? <span style={s.badge('ready')}>New</span> : null}
              </div>
              <div style={s.meta}>
                {(program.program_type || 'program').replace(/_/g, ' ')}
                {program.estimated_value ? ` · ${program.estimated_value}` : ''}
              </div>
              <p style={{ fontSize: 13, color: '#374151', minHeight: 60 }}>
                {(program.description || '').slice(0, 220)}
                {(program.description || '').length > 220 ? '…' : ''}
              </p>
              {program.deadline ? (
                <div style={{ ...s.meta, marginBottom: 12 }}>Deadline: {program.deadline}</div>
              ) : null}
              <div style={s.row}>
                <button type="button" style={s.button} onClick={() => startApplication(program)}>
                  Start application
                </button>
                {program.application_url ? (
                  <a
                    href={program.application_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ ...s.buttonSecondary, textDecoration: 'none', display: 'inline-block' }}
                  >
                    Official page
                  </a>
                ) : null}
                {matches.length > 0 ? (
                  <button
                    type="button"
                    style={s.buttonDanger}
                    onClick={async () => {
                      await fundingService.dismissProgramMatch(selectedBusinessId, program.id);
                      load();
                    }}
                  >
                    Dismiss
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
