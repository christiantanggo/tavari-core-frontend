import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';

/**
 * Fetches the full Chart of Accounts from ERPNext for the given business.
 * Returns only ledger (non-group) accounts — these are the ones usable in Journal Entries.
 * Results are cached per session so repeated calls don't hit the Edge Function multiple times.
 */
const cache = {};

const normalizeAccounts = (rawAccounts = []) => (
  rawAccounts
    .map((account) => (typeof account === 'string'
      ? { name: account }
      : {
          name: account?.name,
          account_name: account?.account_name ?? null,
          root_type: account?.root_type ?? null,
          report_type: account?.report_type ?? null,
          account_type: account?.account_type ?? null
        }))
    .filter((account) => account?.name)
    .sort((a, b) => a.name.localeCompare(b.name))
);

export function useErpNextAccounts(businessId) {
  const [accounts, setAccounts] = useState([]);
  const [accountOptions, setAccountOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const cancelRef = useRef(false);

  const loadAccounts = useCallback((forceRefresh = false) => {
    if (!businessId) return;
    cancelRef.current = false;

    if (!forceRefresh && Object.prototype.hasOwnProperty.call(cache, businessId)) {
      const normalized = normalizeAccounts(cache[businessId]);
      cache[businessId] = normalized;
      setAccountOptions(normalized);
      setAccounts(normalized.map((a) => a.name));
      setLoading(false);
      return;
    }

    if (forceRefresh) {
      delete cache[businessId];
    }

    setLoading(true);
    setError(null);

    supabase.functions
      .invoke('accounting-list-accounts', { body: { business_id: businessId } })
      .then(({ data, error: fnErr }) => {
        if (cancelRef.current) return;
        if (fnErr || data?.error) {
          setError(fnErr?.message || data?.error || 'Failed to load accounts');
          setLoading(false);
          return;
        }
        const list = normalizeAccounts(data?.accounts || []);
        if (list.length > 0) {
          cache[businessId] = list;
        }
        setAccountOptions(list);
        setAccounts(list.map((account) => account.name));
        setLoading(false);
      })
      .catch((e) => {
        if (cancelRef.current) return;
        setError(e?.message || 'Failed to load accounts');
        setLoading(false);
      });
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    loadAccounts(false);
    return () => { cancelRef.current = true; };
  }, [businessId, loadAccounts]);

  return { accounts, accountOptions, loading, error, refreshAccounts: () => loadAccounts(true) };
}
