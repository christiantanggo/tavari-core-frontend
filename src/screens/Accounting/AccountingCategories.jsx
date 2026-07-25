import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { FiArrowLeft, FiPlus, FiEdit2, FiTrash2 } from 'react-icons/fi';
import { ensureBaselineExpenseCategories } from './accountingDefaults';
import { useErpNextAccounts } from '../../hooks/useErpNextAccounts';
import { logAccountingEvent } from './accountingAudit';
import { logicalAccountFromErpNextName } from '../../utils/erpnextGlAccount';

const HST_OPTIONS = [
  { value: 'recoverable', label: 'Recoverable' },
  { value: 'collected', label: 'Collected' },
  { value: 'included', label: 'Included' },
  { value: 'exempt', label: 'Exempt' }
];

const AccountingCategories = ({ embedded = false }) => {
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const { authLoading } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'AccountingCategories'
  });
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', gl_account_erpnext: '', default_hst_treatment: 'recoverable', sort_order: 0, parent_id: '' });

  const { accounts: erpNextAccounts, loading: accountsLoading } = useErpNextAccounts(selectedBusinessId);

  useEffect(() => {
    if (!selectedBusinessId) return;
    (async () => {
      setLoading(true);
      try {
        let { data, error } = await supabase
          .from('accounting_expense_categories')
          .select('*')
          .eq('business_id', selectedBusinessId)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true });
        if (error) {
          setLoading(false);
          toast.error('Failed to load categories');
          return;
        }
        const inserted = await ensureBaselineExpenseCategories(supabase, selectedBusinessId);
        if (inserted) {
          const res = await supabase
            .from('accounting_expense_categories')
            .select('*')
            .eq('business_id', selectedBusinessId)
            .order('sort_order', { ascending: true })
            .order('name', { ascending: true });
          data = res.data;
        }
        setCategories(data || []);
      } catch (error) {
        console.error('Failed to ensure accounting expense categories:', error);
        toast.error(error?.message || 'Failed to load categories');
      }
      setLoading(false);
    })();
  }, [selectedBusinessId]);

  const handleSave = async () => {
    if (!selectedBusinessId) return;
    const payload = {
      business_id: selectedBusinessId,
      name: form.name.trim(),
      gl_account_erpnext: logicalAccountFromErpNextName(form.gl_account_erpnext.trim()) || logicalAccountFromErpNextName(form.name.trim()) || form.name.trim(),
      default_hst_treatment: form.default_hst_treatment,
      sort_order: form.sort_order ?? 0,
      parent_id: form.parent_id || null
    };
    if (editingId) {
      const { error } = await supabase.from('accounting_expense_categories').update(payload).eq('id', editingId);
      if (error) {
        toast.error(error.message || 'Failed to update');
        return;
      }
      toast.success('Category updated');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'category_updated',
        entityType: 'accounting_expense_category',
        entityId: editingId,
        details: { name: payload.name, gl_account_erpnext: payload.gl_account_erpnext }
      });
      setEditingId(null);
    } else {
      const { data: inserted, error } = await supabase.from('accounting_expense_categories').insert(payload).select('id').single();
      if (error) {
        toast.error(error.message || 'Failed to add');
        return;
      }
      toast.success('Category added');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'category_created',
        entityType: 'accounting_expense_category',
        entityId: inserted?.id || null,
        details: { name: payload.name, gl_account_erpnext: payload.gl_account_erpnext }
      });
      setShowAdd(false);
    }
    setForm({ name: '', gl_account_erpnext: '', default_hst_treatment: 'recoverable', sort_order: 0, parent_id: '' });
    const { data } = await supabase
      .from('accounting_expense_categories')
      .select('*')
      .eq('business_id', selectedBusinessId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    setCategories(data || []);
  };

  const startEdit = (c) => {
    setEditingId(c.id);
    setForm({
      name: c.name || '',
      gl_account_erpnext: c.gl_account_erpnext || '',
      default_hst_treatment: c.default_hst_treatment || 'recoverable',
      sort_order: c.sort_order ?? 0,
      parent_id: c.parent_id || ''
    });
    setShowAdd(false);
  };

  const topLevelCategories = categories.filter((c) => !c.parent_id);
  const categoriesByParent = categories.reduce((acc, c) => {
    if (c.parent_id) {
      if (!acc[c.parent_id]) acc[c.parent_id] = [];
      acc[c.parent_id].push(c);
    }
    return acc;
  }, {});
  const displayOrder = topLevelCategories.flatMap((p) => {
    const children = (categoriesByParent[p.id] || []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.name || '').localeCompare(b.name || ''));
    return [p, ...children];
  });
  const parentName = (parentId) => {
    if (!parentId) return '—';
    const p = categories.find((c) => c.id === parentId);
    return p ? p.name : parentId;
  };

  const customGlAccounts = categories.map((c) => c.gl_account_erpnext).filter(Boolean);
  // Use live ERPNext accounts when available; fall back to accounts already saved in categories
  const allGlAccountOptions = erpNextAccounts.length > 0
    ? [...new Set([...erpNextAccounts, ...customGlAccounts])].sort((a, b) => (a || '').localeCompare(b || ''))
    : [...new Set(customGlAccounts)].sort((a, b) => (a || '').localeCompare(b || ''));
  const glAccountIsOther = form.gl_account_erpnext && !allGlAccountOptions.includes(form.gl_account_erpnext);

  const handleDelete = async (id) => {
    if (!confirm('Delete this category?')) return;
    const { error } = await supabase.from('accounting_expense_categories').delete().eq('id', id);
    if (error) {
      toast.error(error.message || 'Failed to delete');
      return;
    }
    toast.success('Category deleted');
    await logAccountingEvent({
      businessId: selectedBusinessId,
      action: 'category_deleted',
      entityType: 'accounting_expense_category',
      entityId: id
    });
    setCategories((prev) => prev.filter((c) => c.id !== id));
    if (editingId === id) setEditingId(null);
  };

  if (authLoading || !selectedBusinessId) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: TavariStyles?.colors?.gray600 }}>Loading...</div>
    );
  }

  return (
    <div className="accounting-categories" style={{ padding: embedded ? 0 : 24, paddingTop: embedded ? 0 : 100, width: '100%', maxWidth: 'none', margin: 0 }}>
      {!embedded && (
        <button type="button" style={styles.backButton} onClick={() => navigate('/dashboard/accounting')}>
          <FiArrowLeft /> Back
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
        <h1 style={{ fontSize: embedded ? '1.25rem' : '1.5rem', margin: 0 }}>Expense Categories</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={styles.secondaryButton} onClick={() => navigate('/dashboard/accounting/chart-of-accounts')}>
            View chart of accounts
          </button>
          <button type="button" style={styles.primaryButton} onClick={() => { setShowAdd(true); setEditingId(null); setForm({ name: '', gl_account_erpnext: '', default_hst_treatment: 'recoverable', sort_order: 0, parent_id: '' }); }}>
            <FiPlus /> Add category
          </button>
        </div>
      </div>

      {showAdd && (
        <div style={styles.card}>
          <h2 style={{ fontSize: '1.125rem', marginTop: 0, marginBottom: 16 }}>New category</h2>
          <div style={styles.field}>
            <label style={styles.label}>Name</label>
            <input
              style={styles.input}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Rent"
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Parent category (optional)</label>
            <select
              style={styles.input}
              value={form.parent_id}
              onChange={(e) => setForm((f) => ({ ...f, parent_id: e.target.value }))}
            >
              <option value="">— None (top-level) —</option>
              {topLevelCategories.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>GL account (ERPNext){accountsLoading ? ' — loading…' : ''}</label>
            <select
              style={styles.input}
              value={glAccountIsOther ? '__other__' : (form.gl_account_erpnext || '')}
              onChange={(e) => setForm((f) => ({ ...f, gl_account_erpnext: e.target.value === '__other__' ? '' : e.target.value }))}
              disabled={accountsLoading}
            >
              <option value="">— Select GL account —</option>
              {allGlAccountOptions.map((gl) => (
                <option key={gl} value={gl}>{gl}</option>
              ))}
              <option value="__other__">— Type manually —</option>
            </select>
            {(glAccountIsOther || (form.gl_account_erpnext === '' && !accountsLoading && allGlAccountOptions.length === 0)) && (
              <input
                style={{ ...styles.input, marginTop: 8 }}
                value={form.gl_account_erpnext}
                onChange={(e) => setForm((f) => ({ ...f, gl_account_erpnext: e.target.value }))}
                placeholder="Type GL account name"
              />
            )}
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Default HST treatment</label>
            <select
              style={styles.input}
              value={form.default_hst_treatment}
              onChange={(e) => setForm((f) => ({ ...f, default_hst_treatment: e.target.value }))}
            >
              {HST_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Sort order</label>
            <input
              type="number"
              style={styles.input}
              value={form.sort_order}
              onChange={(e) => setForm((f) => ({ ...f, sort_order: parseInt(e.target.value, 10) || 0 }))}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={styles.primaryButton} onClick={handleSave}>Save</button>
            <button type="button" style={styles.secondaryButton} onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p style={{ color: TavariStyles?.colors?.gray600 }}>Loading...</p>
      ) : (
        <div style={styles.card}>
          {categories.length === 0 ? (
            <p style={{ color: TavariStyles?.colors?.gray600 }}>No categories yet. Default categories should have been added automatically; if you still see this, try refreshing. You can add more above.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid ' + (TavariStyles?.colors?.gray200 || '#e5e7eb') }}>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Parent</th>
                  <th style={styles.th}>GL account</th>
                  <th style={styles.th}>HST</th>
                  <th style={styles.th}>Sort</th>
                  <th style={styles.th}>Baseline</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayOrder.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid ' + (TavariStyles?.colors?.gray200 || '#e5e7eb') }}>
                    {editingId === c.id ? (
                      <>
                        <td style={styles.td}>
                          <input
                            style={{ ...styles.input, margin: 0, width: '100%' }}
                            value={form.name}
                            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                          />
                        </td>
                        <td style={styles.td}>
                          <select
                            style={{ ...styles.input, margin: 0, width: '100%' }}
                            value={form.parent_id}
                            onChange={(e) => setForm((f) => ({ ...f, parent_id: e.target.value }))}
                          >
                            <option value="">— None —</option>
                            {topLevelCategories.filter((p) => p.id !== c.id).map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </td>
                        <td style={styles.td}>
                          <select
                            style={{ ...styles.input, margin: 0, width: '100%' }}
                            value={glAccountIsOther ? '__other__' : (form.gl_account_erpnext || '')}
                            onChange={(e) => setForm((f) => ({ ...f, gl_account_erpnext: e.target.value === '__other__' ? '' : e.target.value }))}
                            disabled={accountsLoading}
                          >
                            <option value="">{accountsLoading ? 'Loading…' : '— Select —'}</option>
                            {allGlAccountOptions.map((gl) => (
                              <option key={gl} value={gl}>{gl}</option>
                            ))}
                            <option value="__other__">— Type manually —</option>
                          </select>
                          {(glAccountIsOther || (form.gl_account_erpnext === '' && !accountsLoading && allGlAccountOptions.length === 0)) && (
                            <input
                              style={{ ...styles.input, margin: 0, marginTop: 4, width: '100%' }}
                              value={form.gl_account_erpnext}
                              onChange={(e) => setForm((f) => ({ ...f, gl_account_erpnext: e.target.value }))}
                              placeholder="GL account name"
                            />
                          )}
                        </td>
                        <td style={styles.td}>
                          <select
                            style={{ ...styles.input, margin: 0, width: '100%' }}
                            value={form.default_hst_treatment}
                            onChange={(e) => setForm((f) => ({ ...f, default_hst_treatment: e.target.value }))}
                          >
                            {HST_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </td>
                        <td style={styles.td}>
                          <input
                            type="number"
                            style={{ ...styles.input, margin: 0, width: 60 }}
                            value={form.sort_order}
                            onChange={(e) => setForm((f) => ({ ...f, sort_order: parseInt(e.target.value, 10) || 0 }))}
                          />
                        </td>
                        <td style={styles.td}>{c.is_baseline ? 'Yes' : ''}</td>
                        <td style={styles.td}>
                          <button type="button" style={styles.smallButton} onClick={handleSave}>Save</button>
                          <button type="button" style={styles.smallButtonSecondary} onClick={() => setEditingId(null)}>Cancel</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={styles.td}>
                          <span style={c.parent_id ? { paddingLeft: 16, display: 'inline-block' } : undefined}>
                            {c.parent_id ? '↳ ' : ''}{c.name}
                          </span>
                        </td>
                        <td style={styles.td}>{parentName(c.parent_id)}</td>
                        <td style={styles.td}>{c.gl_account_erpnext}</td>
                        <td style={styles.td}>{c.default_hst_treatment}</td>
                        <td style={styles.td}>{c.sort_order}</td>
                        <td style={styles.td}>{c.is_baseline ? 'Yes' : ''}</td>
                        <td style={styles.td}>
                          <button type="button" style={styles.iconButton} onClick={() => startEdit(c)} title="Edit"><FiEdit2 /></button>
                          <button type="button" style={{ ...styles.iconButton, color: TavariStyles?.colors?.danger }} onClick={() => handleDelete(c.id)} title="Delete"><FiTrash2 /></button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <style>{`
        .accounting-categories input:focus, .accounting-categories select:focus { outline: none; border-color: #008080; }
      `}</style>
    </div>
  );
};

const styles = {
  backButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
    padding: '8px 16px',
    background: TavariStyles?.colors?.white || '#fff',
    border: `1px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14
  },
  card: {
    padding: 24,
    border: `1px solid ${TavariStyles?.colors?.gray200 || '#e5e7eb'}`,
    borderRadius: 8,
    background: TavariStyles?.colors?.white || '#fff'
  },
  field: { marginBottom: 16 },
  label: {
    display: 'block',
    fontSize: 14,
    fontWeight: 500,
    color: TavariStyles?.colors?.gray700 || '#374151',
    marginBottom: 6
  },
  input: {
    width: '100%',
    padding: '8px 12px',
    border: `1px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
    borderRadius: 8,
    fontSize: 14
  },
  primaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    background: TavariStyles?.colors?.primary || '#008080',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14
  },
  secondaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    background: TavariStyles?.colors?.gray100 || '#f3f4f6',
    color: TavariStyles?.colors?.gray700 || '#374151',
    border: `1px solid ${TavariStyles?.colors?.gray300 || '#d1d5db'}`,
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14
  },
  smallButton: {
    padding: '4px 10px',
    fontSize: 13,
    background: TavariStyles?.colors?.primary || '#008080',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    marginRight: 4
  },
  smallButtonSecondary: {
    padding: '4px 10px',
    fontSize: 13,
    background: 'transparent',
    color: TavariStyles?.colors?.gray600,
    border: `1px solid ${TavariStyles?.colors?.gray300}`,
    borderRadius: 6,
    cursor: 'pointer'
  },
  iconButton: {
    padding: 6,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: TavariStyles?.colors?.gray600,
    marginRight: 4
  },
  th: { textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: TavariStyles?.colors?.gray700 },
  td: { padding: '10px 12px', verticalAlign: 'middle' }
};

export default AccountingCategories;
