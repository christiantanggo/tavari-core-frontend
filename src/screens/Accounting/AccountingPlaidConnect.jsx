import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { useErpNextAccounts } from '../../hooks/useErpNextAccounts';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';
import { FiLink, FiRefreshCw } from 'react-icons/fi';
import { logAccountingEvent } from './accountingAudit';

const PLAID_SCRIPT_ID = 'tavari-plaid-link-script';

function loadPlaidScript() {
  return new Promise((resolve, reject) => {
    if (window.Plaid) {
      resolve(window.Plaid);
      return;
    }
    const existing = document.getElementById(PLAID_SCRIPT_ID);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Plaid));
      existing.addEventListener('error', () => reject(new Error('Failed to load Plaid Link')));
      return;
    }
    const script = document.createElement('script');
    script.id = PLAID_SCRIPT_ID;
    script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    script.async = true;
    script.onload = () => resolve(window.Plaid);
    script.onerror = () => reject(new Error('Failed to load Plaid Link'));
    document.body.appendChild(script);
  });
}

export default function AccountingPlaidConnect({ onSynced }) {
  const { selectedBusinessId } = useBusinessContext();
  const { accounts: erpAccounts } = useErpNextAccounts(selectedBusinessId);
  const [items, setItems] = useState([]);
  const [plaidAccounts, setPlaidAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncingId, setSyncingId] = useState(null);
  const [plaidAvailable, setPlaidAvailable] = useState(null);

  const loadConnections = useCallback(async () => {
    if (!selectedBusinessId) return;
    setLoading(true);
    try {
      const [itemsRes, accountsRes, probeRes] = await Promise.all([
        supabase
          .from('accounting_plaid_items')
          .select('id, institution_name, last_synced_at, created_at')
          .eq('business_id', selectedBusinessId)
          .order('created_at', { ascending: false }),
        supabase
          .from('accounting_plaid_accounts')
          .select('id, plaid_item_id, account_id, name, mask, bank_account_erpnext')
          .eq('business_id', selectedBusinessId),
        supabase.functions.invoke('accounting-plaid-link-token', { body: { business_id: selectedBusinessId } })
      ]);
      setItems(itemsRes.data || []);
      setPlaidAccounts(accountsRes.data || []);
      if (probeRes.data?.link_token) {
        setPlaidAvailable(true);
      } else if (probeRes.data?.error?.includes('not configured')) {
        setPlaidAvailable(false);
      } else {
        setPlaidAvailable(probeRes.error ? false : true);
      }
    } catch {
      setPlaidAvailable(false);
    } finally {
      setLoading(false);
    }
  }, [selectedBusinessId]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const handleConnect = async () => {
    if (!selectedBusinessId || connecting) return;
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('accounting-plaid-link-token', {
        body: { business_id: selectedBusinessId }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.link_token) throw new Error('No link token returned');

      const Plaid = await loadPlaidScript();
      const handler = Plaid.create({
        token: data.link_token,
        onSuccess: async (publicToken, metadata) => {
          try {
            const { data: exchangeData, error: exchangeError } = await supabase.functions.invoke('accounting-plaid-exchange-token', {
              body: {
                business_id: selectedBusinessId,
                public_token: publicToken,
                institution: metadata?.institution,
                accounts: metadata?.accounts
              }
            });
            if (exchangeError) throw exchangeError;
            if (exchangeData?.error) throw new Error(exchangeData.error);
            toast.success(`Connected ${metadata?.institution?.name || 'bank account'}`);
            await logAccountingEvent({
              businessId: selectedBusinessId,
              action: 'plaid_connected',
              entityType: 'accounting_plaid_item',
              entityId: exchangeData?.plaid_item_id || null,
              details: { institution: metadata?.institution?.name, accounts: metadata?.accounts?.length || 0 }
            });
            await loadConnections();
            if (onSynced) onSynced();
          } catch (e) {
            toast.error(e?.message || 'Failed to save Plaid connection');
          }
        },
        onExit: (err) => {
          if (err?.display_message) toast.error(err.display_message);
        }
      });
      handler.open();
    } catch (e) {
      toast.error(e?.message || 'Could not start Plaid Link');
    } finally {
      setConnecting(false);
    }
  };

  const handleSync = async (plaidItemId = null) => {
    if (!selectedBusinessId) return;
    setSyncingId(plaidItemId || 'all');
    try {
      const { data, error } = await supabase.functions.invoke('accounting-plaid-sync', {
        body: { business_id: selectedBusinessId, plaid_item_id: plaidItemId || undefined }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Synced ${data.transactions_added || 0} new transaction(s)`);
      await logAccountingEvent({
        businessId: selectedBusinessId,
        action: 'plaid_synced',
        entityType: 'accounting_plaid_item',
        entityId: plaidItemId,
        details: { added: data.transactions_added, skipped: data.transactions_skipped }
      });
      await loadConnections();
      if (onSynced) onSynced();
    } catch (e) {
      toast.error(e?.message || 'Plaid sync failed');
    } finally {
      setSyncingId(null);
    }
  };

  const updateAccountMapping = async (accountRowId, bankAccountErpnext) => {
    const { error } = await supabase
      .from('accounting_plaid_accounts')
      .update({ bank_account_erpnext: bankAccountErpnext || null, updated_at: new Date().toISOString() })
      .eq('id', accountRowId);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPlaidAccounts((prev) => prev.map((a) => (a.id === accountRowId ? { ...a, bank_account_erpnext: bankAccountErpnext } : a)));
    await logAccountingEvent({
      businessId: selectedBusinessId,
      action: 'plaid_account_mapped',
      entityType: 'accounting_plaid_account',
      entityId: accountRowId,
      details: { bank_account_erpnext: bankAccountErpnext }
    });
  };

  if (loading) {
    return <p style={{ fontSize: 13, color: '#6b7280' }}>Loading bank connections…</p>;
  }

  return (
    <div style={{ marginBottom: 24, padding: 16, background: TavariStyles?.colors?.gray100 || '#f3f4f6', borderRadius: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, flex: 1 }}>Live bank feed (Plaid)</h3>
        {plaidAvailable && (
          <button type="button" onClick={handleConnect} disabled={connecting} style={primaryBtn}>
            <FiLink /> {connecting ? 'Opening…' : 'Connect bank'}
          </button>
        )}
        {items.length > 0 && (
          <button type="button" onClick={() => handleSync()} disabled={!!syncingId} style={secondaryBtn}>
            <FiRefreshCw /> {syncingId === 'all' ? 'Syncing…' : 'Sync all'}
          </button>
        )}
      </div>

      {plaidAvailable === false && (
        <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
          Plaid is not configured yet. Add PLAID_CLIENT_ID, PLAID_SECRET, and optional PLAID_ENV to Supabase Edge Function secrets. CSV upload still works.
        </p>
      )}

      {plaidAvailable && items.length === 0 && (
        <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
          Connect a bank account to import transactions automatically. Map each account to an ERPNext bank ledger below after connecting.
        </p>
      )}

      {items.map((item) => (
        <div key={item.id} style={{ marginTop: 12, padding: 12, background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <strong>{item.institution_name || 'Bank connection'}</strong>
            <span style={{ fontSize: 13, color: '#6b7280' }}>
              Last sync: {item.last_synced_at ? new Date(item.last_synced_at).toLocaleString() : 'Never'}
            </span>
            <button type="button" onClick={() => handleSync(item.id)} disabled={!!syncingId} style={secondaryBtn}>
              {syncingId === item.id ? 'Syncing…' : 'Sync'}
            </button>
          </div>
          {plaidAccounts.filter((a) => a.plaid_item_id === item.id).map((acct) => (
            <label key={acct.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 13, marginTop: 8 }}>
              <span style={{ minWidth: 160 }}>{acct.name || acct.account_id}{acct.mask ? ` ••${acct.mask}` : ''}</span>
              <select
                value={acct.bank_account_erpnext || ''}
                onChange={(e) => updateAccountMapping(acct.id, e.target.value)}
                style={{ minWidth: 220, padding: 6, borderRadius: 6, border: '1px solid #d1d5db' }}
              >
                <option value="">Map to ERPNext bank account…</option>
                {erpAccounts.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

const primaryBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  borderRadius: 8,
  border: 'none',
  background: '#0d9488',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 13
};

const secondaryBtn = {
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
