import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';

const styles = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #f0fdfa 0%, #f8fafc 40%, #fff 100%)',
    padding: '40px 20px',
    boxSizing: 'border-box',
  },
  card: {
    maxWidth: 720,
    margin: '0 auto',
    background: '#fff',
    borderRadius: 16,
    border: '1px solid #e2e8f0',
    padding: 28,
    boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)',
  },
  muted: { color: '#64748b', fontSize: 14, lineHeight: 1.5 },
  section: {
    marginTop: 20,
    paddingTop: 16,
    borderTop: '1px solid #e2e8f0',
  },
};

export default function FundingGuestAccessPage() {
  const { token } = useParams();
  const [state, setState] = useState({ loading: true, error: null, access: null, plan: null, application: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('funding_get_guest_payload', { p_token: token });
        if (error) throw error;
        if (!data?.valid) {
          if (!cancelled) {
            setState({
              loading: false,
              error: 'This magic link is invalid or expired.',
              access: null,
              plan: null,
              application: null,
            });
          }
          return;
        }

        if (!cancelled) {
          setState({
            loading: false,
            error: null,
            access: data.access,
            plan: data.plan,
            application: data.application,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            loading: false,
            error: err.message || 'Unable to open guest access',
            access: null,
            plan: null,
            application: null,
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (state.loading) {
    return <div style={styles.page}><div style={styles.card}>Validating magic link…</div></div>;
  }

  if (state.error) {
    return <div style={styles.page}><div style={styles.card}><h1>Funding access</h1><p style={styles.muted}>{state.error}</p></div></div>;
  }

  const { access, plan, application } = state;

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={{ marginTop: 0 }}>Tavari Funding — guest access</h1>
        <p style={styles.muted}>
          Signed in as {access.email} · {access.access_level} access
          {access.can_see_financials ? ' · financials shared' : ' · financials hidden'}
        </p>

        {plan && (
          <div style={styles.section}>
            <h2 style={{ marginBottom: 8 }}>{plan.title}</h2>
            <p style={styles.muted}>Status: {plan.status}</p>
            {plan.summary ? <p>{plan.summary}</p> : null}
            {(plan.funding_plan_sections || []).map((section) => (
              <div key={section.title} style={{ marginTop: 16 }}>
                <h3>{section.title}</h3>
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{section.content || '—'}</div>
              </div>
            ))}
          </div>
        )}

        {application && (
          <div style={styles.section}>
            <h2 style={{ marginBottom: 8 }}>{application.title}</h2>
            <p style={styles.muted}>
              {application.application_type} · {application.status}
              {application.funder_name ? ` · ${application.funder_name}` : ''}
            </p>
            {application.amount_requested != null ? (
              <p>Amount requested: ${Number(application.amount_requested).toLocaleString('en-CA')}</p>
            ) : null}
            {application.deadline_date ? <p>Deadline: {application.deadline_date}</p> : null}
            {application.notes ? <p style={{ whiteSpace: 'pre-wrap' }}>{application.notes}</p> : null}
          </div>
        )}

        {!plan && !application && (
          <p style={styles.muted}>No shared plan or application is attached to this link.</p>
        )}
      </div>
    </div>
  );
}
