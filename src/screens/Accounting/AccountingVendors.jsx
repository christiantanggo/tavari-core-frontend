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

const HST_RATE_OPTIONS = [
  { value: 0, label: '0%' },
  { value: 0.05, label: '5% (GST)' },
  { value: 0.13, label: '13% (Ontario HST)' },
  { value: 0.15, label: '15% (Maritimes)' }
];

const AccountingVendors = ({ embedded = false }) => {
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const { authLoading } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'AccountingVendors'
  });
  const [vendors, setVendors] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [rules, setRules] = useState([]);
  const [showRuleAdd, setShowRuleAdd] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [ruleForm, setRuleForm] = useState({
    match_pattern: '',
    vendor_id: '',
    expense_category_id: '',
    gl_account_erpnext: '',
    hst_treatment: 'recoverable',
    priority: 0
  });
  const [form, setForm] = useState({
    name: '',
    default_expense_category_id: '',
    default_gl_account_erpnext: '',
    default_hst_treatment: 'recoverable',
    default_hst_rate: 0.13
  });
  const { accounts } = useErpNextAccounts(selectedBusinessId);

  useEffect(() => {
    if (!selectedBusinessId) return;
    (async () => {
      try {
        const [vendorsRes, categoriesRes, rulesRes] = await Promise.all([
          supabase.from('accounting_vendors').select('*').eq('business_id', selectedBusinessId).order('name'),
          supabase.from('accounting_expense_categories').select('id, name, parent_id').eq('business_id', selectedBusinessId).order('sort_order').order('name'),
          supabase.from('accounting_vendor_rules').select('*').eq('business_id', selectedBusinessId).order('priority', { ascending: false }).order('match_pattern')
        ]);
        if (vendorsRes.error) {
          toast.error('Failed to load vendors');
          setLoading(false);
          return;
        }
        if (categoriesRes.error) {
          toast.error(categoriesRes.error.message || 'Failed to load expense categories');
          setLoading(false);
          return;
        }
        setVendors(vendorsRes.data || []);
        if (!rulesRes.error) setRules(rulesRes.data || []);
        let cats = categoriesRes.data || [];
        const inserted = await ensureBaselineExpenseCategories(supabase, selectedBusinessId);
        if (inserted) {
          const { data: refetched } = await supabase.from('accounting_expense_categories').select('id, name, parent_id').eq('business_id', selectedBusinessId).order('sort_order').order('name');
          cats = refetched || [];
        }
        setCategories(cats);
      } catch (error) {
        console.error('Failed to ensure accounting expense categories:', error);
        toast.error(error?.message || 'Failed to load expense categories');
      }
      setLoading(false);
    })();
  }, [selectedBusinessId]);

  const getCategoryLabel = (c) => {
    if (!c) return '';
    const parent = c.parent_id ? categories.find((p) => p.id === c.parent_id) : null;
    return parent ? `${parent.name} › ${c.name}` : c.name;
  };
  const categoryName = (categoryId) => {
    if (!categoryId) return '—';
    const c = categories.find((x) => x.id === categoryId);
    return c ? getCategoryLabel(c) : categoryId;
  };

  const handleSave = async () => {
    if (!selectedBusinessId) return;
    const payload = {
      business_id: selectedBusinessId,
      name: form.name.trim(),
      default_expense_category_id: form.default_expense_category_id || null,
      default_gl_account_erpnext: logicalAccountFromErpNextName(form.default_gl_account_erpnext) || null,
      default_hst_treatment: form.default_hst_treatment,
      default_hst_rate: form.default_hst_treatment === 'exempt' ? null : (form.default_hst_rate ?? 0.13)
    };
    if (editingId) {
      const { error } = await supabase.from('accounting_vendors').update(payload).eq('id', editingId);
      if (error) {
        toast.error(error.message || 'Failed to update');
        return;
      }
      toast.success('Vendor updated');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'vendor_updated',
        entityType: 'accounting_vendor',
        entityId: editingId,
        details: { name: payload.name }
      });
      setEditingId(null);
    } else {
      const { data: inserted, error } = await supabase.from('accounting_vendors').insert(payload).select('id').single();
      if (error) {
        toast.error(error.message || 'Failed to add');
        return;
      }
      toast.success('Vendor added');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'vendor_created',
        entityType: 'accounting_vendor',
        entityId: inserted?.id || null,
        details: { name: payload.name }
      });
      setShowAdd(false);
    }
    setForm({ name: '', default_expense_category_id: '', default_gl_account_erpnext: '', default_hst_treatment: 'recoverable', default_hst_rate: 0.13 });
    const { data } = await supabase.from('accounting_vendors').select('*').eq('business_id', selectedBusinessId).order('name');
    setVendors(data || []);

    // Sync vendor to ERPNext as Supplier so it exists when posting expenses.
    const { data: syncData, error: syncErr } = await supabase.functions.invoke('accounting-sync-supplier', {
      body: { business_id: selectedBusinessId, vendor_name: payload.name }
    });
    if (syncErr || syncData?.error) {
      toast.error(syncData?.error || syncErr?.message || 'Vendor saved but could not sync to ERPNext');
    }
  };

  const startEdit = (v) => {
    setEditingId(v.id);
    setForm({
      name: v.name || '',
      default_expense_category_id: v.default_expense_category_id || '',
      default_gl_account_erpnext: v.default_gl_account_erpnext || '',
      default_hst_treatment: v.default_hst_treatment || 'recoverable',
      default_hst_rate: v.default_hst_rate ?? 0.13
    });
    setShowAdd(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this vendor?')) return;
    const { error } = await supabase.from('accounting_vendors').delete().eq('id', id);
    if (error) {
      toast.error(error.message || 'Failed to delete');
      return;
    }
    toast.success('Vendor deleted');
    await logAccountingEvent({
      businessId: selectedBusinessId,
      action: 'vendor_deleted',
      entityType: 'accounting_vendor',
      entityId: id
    });
    setVendors((prev) => prev.filter((v) => v.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const resetRuleForm = () => {
    setRuleForm({
      match_pattern: '',
      vendor_id: '',
      expense_category_id: '',
      gl_account_erpnext: '',
      hst_treatment: 'recoverable',
      priority: 0
    });
    setEditingRuleId(null);
    setShowRuleAdd(false);
  };

  const startEditRule = (rule) => {
    setEditingRuleId(rule.id);
    setRuleForm({
      match_pattern: rule.match_pattern || '',
      vendor_id: rule.vendor_id || '',
      expense_category_id: rule.expense_category_id || '',
      gl_account_erpnext: rule.gl_account_erpnext || '',
      hst_treatment: rule.hst_treatment || 'recoverable',
      priority: rule.priority || 0
    });
    setShowRuleAdd(true);
  };

  const handleSaveRule = async () => {
    if (!selectedBusinessId) return;
    const pattern = (ruleForm.match_pattern || '').trim();
    if (!pattern) {
      toast.error('Enter text to match (e.g. costco, hydro one)');
      return;
    }
    const payload = {
      business_id: selectedBusinessId,
      match_pattern: pattern,
      vendor_id: ruleForm.vendor_id || null,
      expense_category_id: ruleForm.expense_category_id || null,
      gl_account_erpnext: logicalAccountFromErpNextName(ruleForm.gl_account_erpnext) || null,
      hst_treatment: ruleForm.hst_treatment || null,
      priority: Number(ruleForm.priority) || 0
    };
    if (editingRuleId) {
      const { data, error } = await supabase.from('accounting_vendor_rules').update(payload).eq('id', editingRuleId).select('*').single();
      if (error) return toast.error(error.message);
      setRules((prev) => prev.map((r) => (r.id === editingRuleId ? data : r)));
      toast.success('Rule updated');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'vendor_rule_updated',
        entityType: 'accounting_vendor_rule',
        entityId: editingRuleId,
        details: { match_pattern: pattern }
      });
    } else {
      const { data, error } = await supabase.from('accounting_vendor_rules').insert(payload).select('*').single();
      if (error) return toast.error(error.message);
      setRules((prev) => [...prev, data]);
      toast.success('Rule added');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'vendor_rule_created',
        entityType: 'accounting_vendor_rule',
        entityId: data?.id || null,
        details: { match_pattern: pattern }
      });
    }
    resetRuleForm();
  };

  const handleDeleteRule = async (id) => {
    if (!confirm('Delete this matching rule?')) return;
    const { error } = await supabase.from('accounting_vendor_rules').delete().eq('id', id);
    if (error) toast.error(error.message);
    else {
      setRules((prev) => prev.filter((r) => r.id !== id));
      toast.success('Rule deleted');
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'vendor_rule_deleted',
        entityType: 'accounting_vendor_rule',
        entityId: id
      });
    }
  };

  const vendorNameById = (id) => vendors.find((v) => v.id === id)?.name || '—';

  if (authLoading || !selectedBusinessId) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: TavariStyles?.colors?.gray600 }}>Loading...</div>
    );
  }

  return (
    <div className="accounting-vendors" style={{ padding: embedded ? 0 : 24, paddingTop: embedded ? 0 : 100, width: '100%', maxWidth: 'none', margin: 0 }}>
      {!embedded && (
        <button type="button" style={styles.backButton} onClick={() => navigate('/dashboard/accounting')}>
          <FiArrowLeft /> Back
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
        <h1 style={{ fontSize: embedded ? '1.25rem' : '1.5rem', margin: 0 }}>Vendors</h1>
        <button
          type="button"
          style={styles.primaryButton}
          onClick={() => {
            setShowAdd(true);
            setEditingId(null);
            setForm({ name: '', default_expense_category_id: '', default_gl_account_erpnext: '', default_hst_treatment: 'recoverable', default_hst_rate: 0.13 });
          }}
        >
          <FiPlus /> Add vendor
        </button>
      </div>

      {showAdd && (
        <div style={styles.card}>
          <h2 style={{ fontSize: '1.125rem', marginTop: 0, marginBottom: 16 }}>New vendor</h2>
          <div style={styles.field}>
            <label style={styles.label}>Name</label>
            <input
              style={styles.input}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. ABC Supplies"
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Default expense category</label>
            <select
              style={styles.input}
              value={form.default_expense_category_id}
              onChange={(e) => setForm((f) => ({ ...f, default_expense_category_id: e.target.value }))}
            >
              <option value="">— None —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{getCategoryLabel(c)}</option>
              ))}
            </select>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Default ERPNext GL account</label>
            <select
              style={styles.input}
              value={form.default_gl_account_erpnext}
              onChange={(e) => setForm((f) => ({ ...f, default_gl_account_erpnext: e.target.value }))}
            >
              <option value="">— Use category GL —</option>
              {accounts.map((account) => (
                <option key={account} value={account}>{account}</option>
              ))}
            </select>
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
          {form.default_hst_treatment !== 'exempt' && (
            <div style={styles.field}>
              <label style={styles.label}>Default HST rate (for back-calculation when not on invoice)</label>
              <select
                style={styles.input}
                value={form.default_hst_rate ?? 0.13}
                onChange={(e) => setForm((f) => ({ ...f, default_hst_rate: Number(e.target.value) }))}
              >
                {HST_RATE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}
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
          {vendors.length === 0 ? (
            <p style={{ color: TavariStyles?.colors?.gray600 }}>No vendors yet. Add one above or they will be created when you import bank transactions.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid ' + (TavariStyles?.colors?.gray200 || '#e5e7eb') }}>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Default category</th>
                  <th style={styles.th}>Default GL</th>
                  <th style={styles.th}>HST</th>
                  <th style={styles.th}>From transaction</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.id} style={{ borderBottom: '1px solid ' + (TavariStyles?.colors?.gray200 || '#e5e7eb') }}>
                    {editingId === v.id ? (
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
                            value={form.default_expense_category_id}
                            onChange={(e) => setForm((f) => ({ ...f, default_expense_category_id: e.target.value }))}
                          >
                            <option value="">— None —</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>{getCategoryLabel(c)}</option>
                            ))}
                          </select>
                        </td>
                        <td style={styles.td}>
                          <select
                            style={{ ...styles.input, margin: 0, width: '100%' }}
                            value={form.default_gl_account_erpnext}
                            onChange={(e) => setForm((f) => ({ ...f, default_gl_account_erpnext: e.target.value }))}
                          >
                            <option value="">— Use category GL —</option>
                            {accounts.map((account) => (
                              <option key={account} value={account}>{account}</option>
                            ))}
                          </select>
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
                          {form.default_hst_treatment !== 'exempt' && (
                            <select
                              style={{ ...styles.input, margin: '4px 0 0', width: '100%' }}
                              value={form.default_hst_rate ?? 0.13}
                              onChange={(e) => setForm((f) => ({ ...f, default_hst_rate: Number(e.target.value) }))}
                            >
                              {HST_RATE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td style={styles.td}>{v.created_from_transaction ? 'Yes' : ''}</td>
                        <td style={styles.td}>
                          <button type="button" style={styles.smallButton} onClick={handleSave}>Save</button>
                          <button type="button" style={styles.smallButtonSecondary} onClick={() => setEditingId(null)}>Cancel</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={styles.td}>{v.name}</td>
                        <td style={styles.td}>{categoryName(v.default_expense_category_id)}</td>
                        <td style={styles.td}>{v.default_gl_account_erpnext || '—'}</td>
                        <td style={styles.td}>
                          {v.default_hst_treatment || '—'}
                          {v.default_hst_treatment !== 'exempt' && v.default_hst_rate != null && (
                            <span style={{ display: 'block', fontSize: 13, color: '#6b7280' }}>{(Number(v.default_hst_rate) * 100).toFixed(0)}%</span>
                          )}
                        </td>
                        <td style={styles.td}>{v.created_from_transaction ? 'Yes' : ''}</td>
                        <td style={styles.td}>
                          <button type="button" style={styles.iconButton} onClick={() => startEdit(v)} title="Edit"><FiEdit2 /></button>
                          <button type="button" style={{ ...styles.iconButton, color: TavariStyles?.colors?.danger }} onClick={() => handleDelete(v.id)} title="Delete"><FiTrash2 /></button>
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

      <div style={{ ...styles.card, marginTop: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>Matching rules</h3>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#6b7280' }}>
              When a receipt or bank payee contains this text, Tavari pre-fills vendor, category, and HST.
            </p>
          </div>
          <button type="button" style={styles.primaryButton} onClick={() => { resetRuleForm(); setShowRuleAdd(true); }}>
            <FiPlus /> Add rule
          </button>
        </div>

        {showRuleAdd && (
          <div style={{ marginBottom: 20, padding: 16, background: '#f9fafb', borderRadius: 8 }}>
            <div style={styles.field}>
              <label style={styles.label}>Contains text</label>
              <input style={styles.input} value={ruleForm.match_pattern} onChange={(e) => setRuleForm((f) => ({ ...f, match_pattern: e.target.value }))} placeholder="e.g. costco, enbridge" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={styles.field}>
                <label style={styles.label}>Vendor (optional)</label>
                <select style={styles.input} value={ruleForm.vendor_id} onChange={(e) => setRuleForm((f) => ({ ...f, vendor_id: e.target.value }))}>
                  <option value="">—</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Category</label>
                <select style={styles.input} value={ruleForm.expense_category_id} onChange={(e) => setRuleForm((f) => ({ ...f, expense_category_id: e.target.value }))}>
                  <option value="">—</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{getCategoryLabel(c)}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: 12 }}>
              <div style={styles.field}>
                <label style={styles.label}>HST treatment</label>
                <select style={styles.input} value={ruleForm.hst_treatment} onChange={(e) => setRuleForm((f) => ({ ...f, hst_treatment: e.target.value }))}>
                  {HST_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>GL account override</label>
                <input style={styles.input} value={ruleForm.gl_account_erpnext} onChange={(e) => setRuleForm((f) => ({ ...f, gl_account_erpnext: e.target.value }))} placeholder="Optional" />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Priority</label>
                <input type="number" style={styles.input} value={ruleForm.priority} onChange={(e) => setRuleForm((f) => ({ ...f, priority: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={styles.primaryButton} onClick={handleSaveRule}>{editingRuleId ? 'Save rule' : 'Add rule'}</button>
              <button type="button" style={styles.secondaryButton} onClick={resetRuleForm}>Cancel</button>
            </div>
          </div>
        )}

        {rules.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: 14 }}>No rules yet. Add patterns for common suppliers on receipts and bank statements.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={styles.th}>Pattern</th>
                <th style={styles.th}>Vendor</th>
                <th style={styles.th}>Category</th>
                <th style={styles.th}>HST</th>
                <th style={styles.th}>Priority</th>
                <th style={styles.th} />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={styles.td}><code>{rule.match_pattern}</code></td>
                  <td style={styles.td}>{vendorNameById(rule.vendor_id)}</td>
                  <td style={styles.td}>{categoryName(rule.expense_category_id)}</td>
                  <td style={styles.td}>{rule.hst_treatment || '—'}</td>
                  <td style={styles.td}>{rule.priority ?? 0}</td>
                  <td style={styles.td}>
                    <button type="button" style={styles.iconButton} onClick={() => startEditRule(rule)} title="Edit"><FiEdit2 /></button>
                    <button type="button" style={{ ...styles.iconButton, color: TavariStyles?.colors?.danger }} onClick={() => handleDeleteRule(rule.id)} title="Delete"><FiTrash2 /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <style>{`
        .accounting-vendors input:focus, .accounting-vendors select:focus { outline: none; border-color: #008080; }
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

export default AccountingVendors;
