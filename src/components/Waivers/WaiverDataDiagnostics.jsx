/**
 * Add ?debugWaivers=1 to the waivers URL. Uses the same Supabase client + JWT as the app.
 * Admin SQL counts in the past did NOT prove RLS for your user — this does.
 */
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../supabaseClient';

export default function WaiverDataDiagnostics({ businessId, hookCount, filteredCount, loadError }) {
  const [snap, setSnap] = useState(null);

  const run = useCallback(async () => {
    const {
      data: { session }
    } = await supabase.auth.getSession();
    const bid =
      businessId ||
      (typeof localStorage !== 'undefined' &&
        (localStorage.getItem('selectedBusinessId') || localStorage.getItem('currentBusinessId')));

    const out = {
      at: new Date().toISOString(),
      supabaseUserId: session?.user?.id || null,
      hasAccessToken: Boolean(session?.access_token),
      businessIdResolved: bid || null,
      hookWaiverCount: typeof hookCount === 'number' ? hookCount : null,
      filterPassCount: typeof filteredCount === 'number' ? filteredCount : null,
      hookError: loadError || null
    };

    if (!session?.user?.id) {
      out.instruction = 'No session user — list cannot load (RLS uses auth.uid()).';
      setSnap(out);
      return;
    }
    if (!bid) {
      out.instruction = 'No business id from auth/storage.';
      setSnap(out);
      return;
    }

    const [leg, sig, bu, ur, te] = await Promise.all([
      supabase
        .from('legacy_waivers')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', bid)
        .is('deleted_at', null),
      supabase
        .from('waiver_signatures')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', bid),
      supabase
        .from('business_users')
        .select('role')
        .eq('user_id', session.user.id)
        .eq('business_id', bid)
        .maybeSingle(),
      supabase
        .from('user_roles')
        .select('role, active')
        .eq('user_id', session.user.id)
        .eq('business_id', bid)
        .maybeSingle(),
      // tavari_employees is Tavari staff (no business_id column) — do not filter by business
      supabase
        .from('tavari_employees')
        .select('id, user_id, is_active, email')
        .eq('user_id', session.user.id)
        .maybeSingle()
    ]);

    const legN = leg.count ?? null;
    const sigN = sig.count ?? null;
    out.rls = {
      legacy_waivers_rows_visible: legN,
      legacy_error: leg.error
        ? leg.error.message || (typeof leg.error === 'string' ? leg.error : 'legacy query error')
        : null,
      waiver_signatures_rows_visible: sigN,
      sig_error: sig.error
        ? sig.error.message || (typeof sig.error === 'string' ? sig.error : 'signatures query error')
        : null
    };
    out.membership = {
      business_users: bu.data || null,
      bu_err: bu.error ? bu.error.message : null,
      user_roles: ur.data || null,
      ur_err: ur.error ? ur.error.message : null,
      tavari_employee: te.data || null,
      te_err: te.error ? te.error.message : null
    };

    if (out.hookWaiverCount === 0 && (legN ?? 0) > 0) {
      out.diagnosis = 'DB returns legacy rows to your JWT but the hook is empty — bug in useWaivers/WaiversService merge.';
    } else if (
      out.hookWaiverCount > 0 &&
      out.filterPassCount === 0 &&
      !loadError
    ) {
      out.diagnosis = 'Data loaded but all rows filtered in the dashboard (search/status/date), not a fetch problem.';
    } else if ((legN ?? 0) === 0 && (sigN ?? 0) === 0) {
      if (!bu.data && !ur.data) {
        out.diagnosis = 'No rows visible AND no business_users or user_roles for this user+business — RLS blocks reads.';
      } else {
        out.diagnosis = 'RLS returns 0 rows; membership exists — check tavari_employee path or table policies.';
      }
    } else {
      out.diagnosis = 'Compare rls row counts to hookWaiverCount.';
    }

    setSnap(out);
  }, [businessId, hookCount, filteredCount, loadError]);

  useEffect(() => {
    void run();
  }, [run]);

  if (!snap) {
    return (
      <div style={wrap}>
        <strong>Waiver debug</strong> — running checks…
      </div>
    );
  }

  return (
    <details style={wrap}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: 8 }}>
        Waiver load debug — {snap.hookWaiverCount ?? 0} loaded; open for JSON (list is below)
      </summary>
      <div style={row}>
        <strong>debugWaivers=1</strong> — same Supabase client + JWT as the app
      </div>
      <pre style={pre}>{JSON.stringify(snap, null, 2)}</pre>
      <button type="button" style={btn} onClick={() => void run()}>
        Run again
      </button>
    </details>
  );
}

const wrap = {
  marginBottom: 16,
  padding: 12,
  background: '#0f172a',
  color: '#e2e8f0',
  borderRadius: 8,
  fontSize: 13,
  fontFamily: 'ui-monospace, monospace',
  border: '1px solid #334155'
};

const row = { marginBottom: 8, color: '#94a3b8' };

const pre = {
  margin: 0,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: 360,
  overflow: 'auto'
};

const btn = {
  marginTop: 8,
  padding: '6px 12px',
  cursor: 'pointer',
  borderRadius: 6,
  border: '1px solid #64748b',
  background: '#1e293b',
  color: '#f1f5f9',
  fontSize: 13
};
