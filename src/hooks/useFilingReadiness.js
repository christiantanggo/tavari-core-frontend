import { useCallback, useState } from 'react';
import { supabase } from '../supabaseClient';

export function useFilingReadiness(businessId) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const runChecks = useCallback(async (fromDate, toDate) => {
    if (!businessId || !fromDate || !toDate) return null;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('accounting-filing-reconciliation', {
        body: { business_id: businessId, from_date: fromDate, to_date: toDate }
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setResult(data);
      return data;
    } catch (e) {
      const message = e?.message || 'Failed to run filing checks';
      setError(message);
      setResult(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  return {
    loading,
    error,
    result,
    filingReady: !!result?.filing_ready,
    filingStatus: result?.filing_status || null,
    checks: result?.checks || [],
    runChecks
  };
}

export function currentQuarterRange(referenceDate = new Date()) {
  const y = referenceDate.getFullYear();
  const m = referenceDate.getMonth();
  const qStartMonth = Math.floor(m / 3) * 3;
  const from = new Date(y, qStartMonth, 1);
  const to = new Date(y, qStartMonth + 3, 0);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { fromDate: fmt(from), toDate: fmt(to) };
}
