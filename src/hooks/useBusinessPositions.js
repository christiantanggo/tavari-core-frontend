import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { positionRowsToNameSet } from '../utils/positionCatalog';

/**
 * Loads `positions` rows for a business (HR Position Management catalog).
 * @param {string|null} businessId
 * @param {{ activeOnly?: boolean }} options
 */
export function useBusinessPositions(businessId, options = {}) {
  const { activeOnly = true } = options;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(!!businessId);

  const load = useCallback(async () => {
    if (!businessId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      let q = supabase
        .from('positions')
        .select('*')
        .eq('business_id', businessId)
        .order('position_name', { ascending: true });
      if (activeOnly) {
        q = q.eq('is_active', true);
      }
      const { data, error } = await q;
      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      console.error('[useBusinessPositions]', e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [businessId, activeOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const nameSet = useMemo(() => positionRowsToNameSet(rows), [rows]);

  return { rows, loading, refetch: load, nameSet };
}
