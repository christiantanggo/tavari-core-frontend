import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePOSAuth } from '../../hooks/usePOSAuth';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { FiArrowLeft, FiPlus, FiRefreshCw, FiSearch } from 'react-icons/fi';
import TavariCheckbox from '../../components/UI/TavariCheckbox';

const ROOT_ORDER = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'];

export default function AccountingChartOfAccounts({ embedded = false }) {
  const navigate = useNavigate();
  const { selectedBusinessId } = useBusinessContext();
  const { authLoading } = usePOSAuth({
    requiredRoles: ['owner', 'manager', 'admin'],
    requireBusiness: true,
    componentName: 'AccountingChartOfAccounts'
  });
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [rootFilter, setRootFilter] = useState('all');
  const [showGroupsOnly, setShowGroupsOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newAccount, setNewAccount] = useState({ account_name: '', root_type: 'Expense', account_type: '' });

  const load = useCallback(async () => {
    if (!selectedBusinessId) return;
    setLoading(true);
    try {
      const [accountsRes, categoriesRes] = await Promise.all([
        supabase.functions.invoke('accounting-list-accounts', {
          body: { business_id: selectedBusinessId, include_groups: true }
        }),
        supabase.from('accounting_expense_categories').select('id, name, gl_account_erpnext').eq('business_id', selectedBusinessId)
      ]);
      if (accountsRes.error || accountsRes.data?.error) {
        throw new Error(accountsRes.data?.error || accountsRes.error?.message || 'Failed to load accounts');
      }
      setAccounts(Array.isArray(accountsRes.data?.accounts) ? accountsRes.data.accounts : []);
      setCategories(categoriesRes.data || []);
    } catch (e) {
      toast.error(e?.message || 'Failed to load chart of accounts');
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId]);

  useEffect(() => {
    load();
  }, [load]);

  const createAccount = async () => {
    if (!newAccount.account_name.trim()) {
      toast.error('Enter an account name');
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('accounting-create-account', {
        body: {
          business_id: selectedBusinessId,
          account_name: newAccount.account_name.trim(),
          root_type: newAccount.root_type,
          account_type: newAccount.account_type.trim() || undefined,
        },
      });
      if (data?.error || error) throw new Error(data?.error || error?.message || 'Create failed');
      toast.success(`Created ${data.account?.name || newAccount.account_name}`);
      setShowCreate(false);
      setNewAccount({ account_name: '', root_type: 'Expense', account_type: '' });
      await load();
    } catch (e) {
      toast.error(e?.message || 'Failed to create account');
    } finally {
      setCreating(false);
    }
  };

  const categoryByGl = useMemo(() => {
    const map = new Map();
    for (const c of categories) {
      if (c.gl_account_erpnext) map.set(c.gl_account_erpnext, c.name);
    }
    return map;
  }, [categories]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (rootFilter !== 'all' && a.root_type !== rootFilter) return false;
      if (showGroupsOnly && !a.is_group) return false;
      if (!q) return true;
      const hay = `${a.name || ''} ${a.account_name || ''} ${a.account_type || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [accounts, search, rootFilter, showGroupsOnly]);

  const grouped = useMemo(() => {
    const buckets = {};
    for (const root of ROOT_ORDER) buckets[root] = [];
    buckets.Other = [];
    for (const acct of filtered) {
      const key = ROOT_ORDER.includes(acct.root_type) ? acct.root_type : 'Other';
      buckets[key].push(acct);
    }
    return buckets;
  }, [filtered]);

  if (authLoading || !selectedBusinessId) {
    return <div style={{ padding: 48, textAlign: 'center' }}>Loading...</div>;
  }

  return (
    <div style={{ padding: embedded ? 0 : 24, paddingTop: embedded ? 0 : 80 }}>
      {!embedded && (
        <button type="button" style={{ marginBottom: 16, cursor: 'pointer' }} onClick={() => navigate('/dashboard/accounting')}>
          <FiArrowLeft /> Back
        </button>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: '1.25rem', margin: 0, flex: 1 }}>Chart of Accounts</h1>
        <button type="button" onClick={() => setShowCreate(true)} style={btnPrimary}>
          <FiPlus /> Create Account
        </button>
        <button type="button" onClick={load} disabled={loading} style={btnSecondary}>
          <FiRefreshCw /> Refresh
        </button>
        <button type="button" onClick={() => navigate('/dashboard/accounting/setup/categories')} style={btnSecondary}>
          Edit category mapping
        </button>
      </div>
      <p style={{ color: TavariStyles?.colors?.gray600, marginBottom: 16, fontSize: 14 }}>
        Live ERPNext accounts for this business. Expense categories map to ledger accounts in Categories.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 220 }}>
          <FiSearch />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search accounts…"
            style={inputStyle}
          />
        </label>
        <select value={rootFilter} onChange={(e) => setRootFilter(e.target.value)} style={inputStyle}>
          <option value="all">All types</option>
          {ROOT_ORDER.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <TavariCheckbox
          id="coa-groups-only"
          checked={showGroupsOnly}
          onChange={(next) => setShowGroupsOnly(next)}
          label="Groups only"
        />
      </div>

      {showCreate && (
        <div style={{ marginBottom: 20, padding: 16, border: '1px solid #d1d5db', borderRadius: 12, background: '#f9fafb' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '1rem' }}>Create ledger account</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, flex: 1, minWidth: 180 }}>
              Account name
              <input
                value={newAccount.account_name}
                onChange={(e) => setNewAccount((s) => ({ ...s, account_name: e.target.value }))}
                placeholder="e.g. Due to Shareholders"
                style={inputStyle}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              Type
              <select
                value={newAccount.root_type}
                onChange={(e) => setNewAccount((s) => ({ ...s, root_type: e.target.value }))}
                style={inputStyle}
              >
                {ROOT_ORDER.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, minWidth: 160 }}>
              Account type (optional)
              <input
                value={newAccount.account_type}
                onChange={(e) => setNewAccount((s) => ({ ...s, account_type: e.target.value }))}
                placeholder="Bank / Equity / …"
                style={inputStyle}
              />
            </label>
            <button type="button" onClick={createAccount} disabled={creating} style={btnPrimary}>
              {creating ? 'Creating…' : 'Create'}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} style={btnSecondary}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <p style={{ color: '#6b7280' }}>Loading accounts from ERPNext…</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No accounts match your filters.</p>
      ) : (
        ROOT_ORDER.concat('Other').map((root) => {
          const rows = grouped[root] || [];
          if (!rows.length) return null;
          return (
            <section key={root} style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>{root}</h2>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                      <th style={thStyle}>Account</th>
                      <th style={thStyle}>Type</th>
                      <th style={thStyle}>Group</th>
                      <th style={thStyle}>Tavari category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => (
                      <tr key={a.name} style={{ borderBottom: '1px solid #eee', opacity: a.is_group ? 0.85 : 1 }}>
                        <td style={tdStyle}>
                          <span style={{ fontWeight: a.is_group ? 600 : 400 }}>{a.name}</span>
                          {a.account_name && a.account_name !== a.name ? (
                            <span style={{ color: '#6b7280', marginLeft: 8, fontSize: 13 }}>{a.account_name}</span>
                          ) : null}
                        </td>
                        <td style={tdStyle}>{a.account_type || a.report_type || '—'}</td>
                        <td style={tdStyle}>{a.is_group ? 'Yes' : 'Ledger'}</td>
                        <td style={tdStyle}>{categoryByGl.get(a.name) || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

const inputStyle = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  minWidth: 160
};

const thStyle = { textAlign: 'left', padding: '8px 12px', fontWeight: 600 };
const tdStyle = { padding: '8px 12px' };

const btnSecondary = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  background: '#fff',
  cursor: 'pointer',
  fontSize: 13
};

const btnPrimary = {
  ...btnSecondary,
  background: '#0f766e',
  borderColor: '#0f766e',
  color: '#fff',
  fontWeight: 600,
};
