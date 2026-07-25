import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { FiArrowLeft, FiPlus, FiEdit2, FiTrash2, FiPlay, FiLoader, FiExternalLink } from 'react-icons/fi';
import { logAccountingEvent } from './accountingAudit';

const AccountingAssets = ({ embedded = false }) => {
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const { authLoading } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'AccountingAssets'
  });
  const [assets, setAssets] = useState([]);
  const [depreciationEntries, setDepreciationEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [runDepreciationMonth, setRunDepreciationMonth] = useState('');
  const [runningDepreciation, setRunningDepreciation] = useState(false);
  const [historyAssetId, setHistoryAssetId] = useState(null);
  const [disposingId, setDisposingId] = useState(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    cost: '',
    salvage_value: '0',
    service_date: '',
    useful_life_years: '5',
    gl_depreciation_expense_account_erpnext: '',
    gl_accumulated_depreciation_account_erpnext: ''
  });

  useEffect(() => {
    if (!selectedBusinessId) return;
    (async () => {
      const [assetsRes, entriesRes] = await Promise.all([
        supabase.from('accounting_fixed_assets').select('*').eq('business_id', selectedBusinessId).order('service_date', { ascending: false }),
        supabase.from('accounting_depreciation_entries').select('*').eq('business_id', selectedBusinessId).order('period_date', { ascending: false })
      ]);
      if (assetsRes.error) {
        toast.error('Failed to load assets');
        setLoading(false);
        return;
      }
      if (entriesRes.error) {
        toast.error(entriesRes.error.message || 'Failed to load depreciation entries');
        setLoading(false);
        return;
      }
      setAssets(assetsRes.data || []);
      setDepreciationEntries(entriesRes.data || []);
      setLoading(false);
    })();
  }, [selectedBusinessId]);

  const formatDate = (d) => (d ? new Date(d).toLocaleDateString('en-CA') : '—');
  const formatMoney = (n) => (n != null && n !== '' ? '$' + Number(n).toFixed(2) : '—');

  const monthlyAmount = (asset) => {
    const cost = Number(asset.cost) || 0;
    const salvage = Number(asset.salvage_value) || 0;
    const months = Math.max(1, Number(asset.useful_life_months) || 60);
    return Math.round((cost - salvage) / months * 100) / 100;
  };

  const handleSave = async () => {
    if (!selectedBusinessId) return;
    const cost = parseFloat(form.cost);
    if (isNaN(cost) || cost < 0) {
      toast.error('Enter a valid cost');
      return;
    }
    const salvage = parseFloat(form.salvage_value) || 0;
    const years = parseFloat(form.useful_life_years) || 5;
    const usefulLifeMonths = Math.max(1, Math.round(years * 12));
    const payload = {
      business_id: selectedBusinessId,
      name: form.name.trim(),
      description: form.description?.trim() || null,
      cost,
      salvage_value: salvage,
      service_date: form.service_date || null,
      useful_life_months: usefulLifeMonths,
      gl_depreciation_expense_account_erpnext: form.gl_depreciation_expense_account_erpnext?.trim() || null,
      gl_accumulated_depreciation_account_erpnext: form.gl_accumulated_depreciation_account_erpnext?.trim() || null,
      status: 'active'
    };
    if (editingId) {
      const { error } = await supabase.from('accounting_fixed_assets').update(payload).eq('id', editingId);
      if (error) {
        toast.error(error.message || 'Failed to update');
        return;
      }
      toast.success('Asset updated');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'asset_updated',
        entityType: 'accounting_fixed_asset',
        entityId: editingId,
        details: { name: payload.name }
      });
      setEditingId(null);
    } else {
      const { data: inserted, error } = await supabase.from('accounting_fixed_assets').insert(payload).select('id').single();
      if (error) {
        toast.error(error.message || 'Failed to add');
        return;
      }
      toast.success('Asset added');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'asset_created',
        entityType: 'accounting_fixed_asset',
        entityId: inserted?.id || null,
        details: { name: payload.name, cost: payload.cost }
      });
      setShowAdd(false);
    }
    setForm({
      name: '',
      description: '',
      cost: '',
      salvage_value: '0',
      service_date: '',
      useful_life_years: '5',
      gl_depreciation_expense_account_erpnext: '',
      gl_accumulated_depreciation_account_erpnext: ''
    });
    const { data } = await supabase.from('accounting_fixed_assets').select('*').eq('business_id', selectedBusinessId).order('service_date', { ascending: false });
    setAssets(data || []);
  };

  const startEdit = (a) => {
    setEditingId(a.id);
    setForm({
      name: a.name || '',
      description: a.description || '',
      cost: String(a.cost ?? ''),
      salvage_value: String(a.salvage_value ?? 0),
      service_date: (a.service_date || '').slice(0, 10),
      useful_life_years: String(Math.round((a.useful_life_months || 60) / 12 * 10) / 10),
      gl_depreciation_expense_account_erpnext: a.gl_depreciation_expense_account_erpnext || '',
      gl_accumulated_depreciation_account_erpnext: a.gl_accumulated_depreciation_account_erpnext || ''
    });
  };

  const handleDispose = async (asset) => {
    if (!selectedBusinessId || asset.status === 'disposed') return;
    if (!window.confirm(`Mark "${asset.name}" as disposed? Depreciation will no longer run for this asset.`)) return;
    setDisposingId(asset.id);
    const { error } = await supabase.from('accounting_fixed_assets').update({ status: 'disposed' }).eq('id', asset.id).eq('business_id', selectedBusinessId);
    setDisposingId(null);
    if (error) {
      toast.error(error.message || 'Failed to update');
      return;
    }
    toast.success('Asset marked as disposed');
    await logAccountingEvent({
      businessId: selectedBusinessId,
      action: 'asset_disposed',
      entityType: 'accounting_fixed_asset',
      entityId: asset.id,
      details: { name: asset.name }
    });
    const { data } = await supabase.from('accounting_fixed_assets').select('*').eq('business_id', selectedBusinessId).order('service_date', { ascending: false });
    setAssets(data || []);
  };

  const entriesForAsset = (assetId) => (depreciationEntries || []).filter((e) => e.asset_id === assetId);

  const handleRunDepreciation = async () => {
    if (!selectedBusinessId || !runDepreciationMonth) {
      toast.error('Select a month (first day of month)');
      return;
    }
    const periodDate = runDepreciationMonth.slice(0, 7) + '-01';
    setRunningDepreciation(true);
    try {
      const { data, error } = await supabase.functions.invoke('accounting-run-depreciation', {
        body: { business_id: selectedBusinessId, period_date: periodDate }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(data?.message || `Depreciation posted for ${periodDate} (${data?.posted ?? 0} assets).`);
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'depreciation_run',
        entityType: 'accounting_depreciation',
        entityId: periodDate,
        details: { period_date: periodDate, posted_count: data?.posted ?? 0 }
      });
      setRunDepreciationMonth('');
      const { data: entries } = await supabase.from('accounting_depreciation_entries').select('*').eq('business_id', selectedBusinessId).order('period_date', { ascending: false });
      setDepreciationEntries(entries || []);
    } catch (e) {
      toast.error(e?.message || 'Failed to run depreciation');
    }
    setRunningDepreciation(false);
  };

  const styles = {
    section: { marginBottom: 24 },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
    th: { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #e5e7eb', fontWeight: 600 },
    td: { padding: '10px 12px', borderBottom: '1px solid #eee' },
    input: { padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db', width: '100%', maxWidth: 280 },
    button: { padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 500 },
    primary: { background: TavariStyles?.colors?.primary || '#008080', color: '#fff' },
    danger: { background: TavariStyles?.colors?.danger || '#dc2626', color: '#fff' },
    muted: { color: TavariStyles?.colors?.gray600 || '#6b7280', fontSize: 13 }
  };

  if (authLoading || !selectedBusinessId) return <div style={{ padding: 48, textAlign: 'center' }}>Loading...</div>;

  return (
    <div style={{ padding: embedded ? 0 : 24, paddingTop: embedded ? 0 : 100, width: '100%', maxWidth: 960 }}>
      {!embedded && (
        <button type="button" style={{ marginBottom: 24, cursor: 'pointer' }} onClick={() => navigate('/dashboard/accounting')}>
          <FiArrowLeft /> Back
        </button>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: '1.25rem', margin: 0 }}>Fixed assets & depreciation</h1>
        <button type="button" style={{ ...styles.button, ...styles.primary, display: 'inline-flex', alignItems: 'center', gap: 8 }} onClick={() => { setShowAdd(true); setEditingId(null); setForm({ name: '', description: '', cost: '', salvage_value: '0', service_date: '', useful_life_years: '5', gl_depreciation_expense_account_erpnext: '', gl_accumulated_depreciation_account_erpnext: '' }); }}>
          <FiPlus /> Add asset
        </button>
      </div>

      <section style={styles.section}>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Run monthly depreciation</h2>
        <p style={styles.muted}>Post depreciation for a month to ERPNext (Dr Depreciation Expense, Cr Accumulated Depreciation). Run once per month. Appears on P&L and tracks for annual taxes.</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
          <input
            type="month"
            value={runDepreciationMonth}
            onChange={(e) => setRunDepreciationMonth(e.target.value)}
            style={styles.input}
          />
          <button type="button" style={{ ...styles.button, ...styles.primary }} onClick={handleRunDepreciation} disabled={runningDepreciation || !runDepreciationMonth}>
            {runningDepreciation ? <FiLoader style={{ animation: 'spin 1s linear infinite' }} /> : <FiPlay />} Run depreciation
          </button>
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Assets</h2>
        {loading ? (
          <p style={styles.muted}>Loading...</p>
        ) : assets.length === 0 ? (
          <p style={styles.muted}>No assets yet. Add an asset to start tracking depreciation.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Service date</th>
                  <th style={styles.th}>Cost</th>
                  <th style={styles.th}>Life</th>
                  <th style={styles.th}>Monthly dep.</th>
                  <th style={styles.th}>Source</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => {
                  const entries = entriesForAsset(a.id);
                  return (
                    <React.Fragment key={a.id}>
                      <tr>
                        <td style={styles.td}>{a.name}</td>
                        <td style={styles.td}>{formatDate(a.service_date)}</td>
                        <td style={styles.td}>{formatMoney(a.cost)}</td>
                        <td style={styles.td}>{a.useful_life_months} mo</td>
                        <td style={styles.td}>{formatMoney(monthlyAmount(a))}</td>
                        <td style={styles.td}>
                          {a.draft_expense_id ? (
                            <button
                              type="button"
                              style={{ border: 'none', background: 'none', color: TavariStyles?.colors?.primary || '#008080', cursor: 'pointer', padding: 0, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              onClick={() => navigate('/dashboard/accounting/expenses')}
                              title="View in Expenses"
                            >
                              Queue invoice <FiExternalLink size={12} />
                            </button>
                          ) : a.erpnext_purchase_invoice_id ? (
                            <span style={styles.muted}>{a.erpnext_purchase_invoice_id}</span>
                          ) : '—'}
                        </td>
                        <td style={styles.td}>{a.status || 'active'}</td>
                        <td style={styles.td}>
                          <button type="button" style={{ ...styles.button, marginRight: 6, background: '#e5e7eb', color: '#374151' }} onClick={() => startEdit(a)} title="Edit">
                            <FiEdit2 />
                          </button>
                          {entries.length > 0 && (
                            <button type="button" style={{ ...styles.button, marginRight: 6, background: '#e0f2fe', color: '#0369a1' }} onClick={() => setHistoryAssetId(historyAssetId === a.id ? null : a.id)} title="Depreciation history">
                              History ({entries.length})
                            </button>
                          )}
                          {a.status === 'active' && (
                            <button type="button" style={{ ...styles.button, ...styles.danger }} onClick={() => handleDispose(a)} disabled={disposingId === a.id} title="Mark disposed">
                              {disposingId === a.id ? <FiLoader style={{ animation: 'spin 1s linear infinite' }} /> : 'Dispose'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {historyAssetId === a.id && entries.length > 0 && (
                        <tr>
                          <td colSpan={8} style={{ ...styles.td, background: '#f8fafc', paddingLeft: 24 }}>
                            <strong>Depreciation history</strong>
                            <table style={{ width: '100%', marginTop: 8, fontSize: 13 }}>
                              <thead><tr><th style={{ textAlign: 'left' }}>Period</th><th style={{ textAlign: 'right' }}>Amount</th><th>JE</th></tr></thead>
                              <tbody>
                                {entries.map((e) => (
                                  <tr key={e.id}>
                                    <td>{formatDate(e.period_date)}</td>
                                    <td style={{ textAlign: 'right' }}>{formatMoney(e.amount)}</td>
                                    <td style={styles.muted}>{e.erpnext_journal_entry_id || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(showAdd || editingId) && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => { setShowAdd(false); setEditingId(null); }}>
          <div style={{ background: '#fff', padding: 24, borderRadius: 12, maxWidth: 440, width: '90%' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{editingId ? 'Edit asset' : 'Add asset'}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label>Name *</label>
              <input style={styles.input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Delivery van" />
              <label>Description</label>
              <input style={styles.input} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Optional" />
              <label>Cost *</label>
              <input type="number" min="0" step="0.01" style={styles.input} value={form.cost} onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))} placeholder="0.00" />
              <label>Salvage value</label>
              <input type="number" min="0" step="0.01" style={styles.input} value={form.salvage_value} onChange={(e) => setForm((f) => ({ ...f, salvage_value: e.target.value }))} placeholder="0" />
              <label>Service date * (first day depreciation starts)</label>
              <input type="date" style={styles.input} value={form.service_date} onChange={(e) => setForm((f) => ({ ...f, service_date: e.target.value }))} />
              <label>Useful life (years)</label>
              <input type="number" min="0.5" step="0.5" style={styles.input} value={form.useful_life_years} onChange={(e) => setForm((f) => ({ ...f, useful_life_years: e.target.value }))} placeholder="5" />
              <label style={styles.muted}>Depreciation expense account (ERPNext name, optional — use Settings default)</label>
              <input style={styles.input} value={form.gl_depreciation_expense_account_erpnext} onChange={(e) => setForm((f) => ({ ...f, gl_depreciation_expense_account_erpnext: e.target.value }))} placeholder="Depreciation" />
              <label style={styles.muted}>Accumulated depreciation account (ERPNext name)</label>
              <input style={styles.input} value={form.gl_accumulated_depreciation_account_erpnext} onChange={(e) => setForm((f) => ({ ...f, gl_accumulated_depreciation_account_erpnext: e.target.value }))} placeholder="Accumulated Depreciation" />
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button type="button" style={{ ...styles.button, ...styles.primary }} onClick={handleSave}>Save</button>
              <button type="button" style={{ ...styles.button, background: '#e5e7eb', color: '#374151' }} onClick={() => { setShowAdd(false); setEditingId(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default AccountingAssets;
