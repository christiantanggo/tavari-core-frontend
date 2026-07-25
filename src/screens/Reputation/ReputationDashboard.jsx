import React, { useCallback, useEffect, useState } from 'react';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';

const card = {
  background: '#fff',
  borderRadius: TavariStyles.borderRadius.lg,
  padding: TavariStyles.spacing.xl,
  boxShadow: TavariStyles.shadows.sm,
  marginBottom: TavariStyles.spacing.lg,
};

const STAR_SIZE = 56;
const STAR_FILLED = '#f59e0b';
const STAR_EMPTY = TavariStyles.colors.gray300;

function formatAverageRating(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function StarAverageDisplay({ average }) {
  const avg = average != null ? Number(average) : null;
  const label = formatAverageRating(avg);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: TavariStyles.spacing.lg,
        width: '100%',
        marginBottom: TavariStyles.spacing.lg,
      }}
      aria-label={label != null ? `Average rating ${label} out of 5` : 'No ratings yet'}
    >
      <div style={{ display: 'flex', gap: 8 }} aria-hidden="true">
        {[1, 2, 3, 4, 5].map((star) => {
          const fill = avg != null ? Math.min(1, Math.max(0, avg - (star - 1))) : 0;
          return (
            <span
              key={star}
              style={{
                position: 'relative',
                display: 'inline-block',
                width: STAR_SIZE,
                height: STAR_SIZE,
                fontSize: STAR_SIZE,
                lineHeight: 1,
              }}
            >
              <span style={{ color: STAR_EMPTY }}>★</span>
              {fill > 0 ? (
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    overflow: 'hidden',
                    width: `${fill * 100}%`,
                    color: STAR_FILLED,
                    whiteSpace: 'nowrap',
                  }}
                >
                  ★
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
      <span
        style={{
          fontSize: '40px',
          fontWeight: 700,
          color: TavariStyles.colors.gray900,
          lineHeight: 1,
        }}
      >
        {label ?? '—'}
      </span>
    </div>
  );
}

function computeAverageRating(ratings) {
  const values = (ratings || []).map((r) => Number(r.rating)).filter((n) => !Number.isNaN(n));
  if (!values.length) return null;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

export default function ReputationDashboard() {
  const { selectedBusinessId } = useBusinessContext();
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [averageRating, setAverageRating] = useState(null);

  const load = useCallback(async () => {
    if (!selectedBusinessId) return;
    const [{ data: s }, { data: ratingRows }, { data: sub }] = await Promise.all([
      supabase.rpc('reputation_stats_summary', { p_business_id: selectedBusinessId }),
      supabase
        .from('reputation_submissions')
        .select('rating')
        .eq('business_id', selectedBusinessId)
        .not('rating', 'is', null),
      supabase
        .from('reputation_submissions')
        .select(
          `id, rating, comment, flow_type, routed_to_google, google_redirect_clicked, created_at,
          reputation_invite_tokens ( contact_normalized, source, metadata )`
        )
        .eq('business_id', selectedBusinessId)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);
    setStats(s || {});
    setAverageRating(s?.avg_rating != null ? Number(s.avg_rating) : computeAverageRating(ratingRows));
    setRows(sub || []);
  }, [selectedBusinessId]);

  useEffect(() => {
    load();
  }, [load]);

  const statTile = (label, value) => (
    <div style={{ ...card, flex: '1 1 160px', minWidth: 140 }}>
      <div style={{ fontSize: TavariStyles.typography.fontSize.sm, color: TavariStyles.colors.gray500 }}>{label}</div>
      <div style={{ fontSize: TavariStyles.typography.fontSize['3xl'], fontWeight: 700, color: TavariStyles.colors.gray900 }}>
        {value ?? '—'}
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: TavariStyles.spacing.md }}>
        {statTile('Invites created', stats?.invites_created)}
        {statTile('Completed invites', stats?.invites_completed)}
        {statTile('Total submissions', stats?.submissions_total)}
        {statTile('Eligible → external review URL', stats?.sent_toward_google_eligible)}
        {statTile('External review link clicks', stats?.google_redirect_clicks)}
      </div>

      <StarAverageDisplay average={averageRating} />

      <div style={card}>
        <h3 style={{ marginTop: 0 }}>Recent submissions</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: TavariStyles.typography.fontSize.sm }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: `1px solid ${TavariStyles.colors.gray200}` }}>
                <th style={{ padding: 8 }}>When</th>
                <th style={{ padding: 8 }}>Guest</th>
                <th style={{ padding: 8 }}>Contact</th>
                <th style={{ padding: 8 }}>Stars</th>
                <th style={{ padding: 8 }}>Flow</th>
                <th style={{ padding: 8 }}>External review</th>
                <th style={{ padding: 8 }}>Comment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const token = Array.isArray(r.reputation_invite_tokens)
                  ? r.reputation_invite_tokens[0]
                  : r.reputation_invite_tokens;
                const meta = token?.metadata && typeof token.metadata === 'object' ? token.metadata : {};
                const guestName =
                  [meta.first_name, meta.last_name].filter(Boolean).join(' ').trim() ||
                  meta.checked_in_name ||
                  '—';
                const contact = token?.contact_normalized || meta.contact_email || '—';
                return (
                <tr key={r.id} style={{ borderBottom: `1px solid ${TavariStyles.colors.gray100}` }}>
                  <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                    {r.created_at ? new Date(r.created_at).toLocaleString() : ''}
                  </td>
                  <td style={{ padding: 8 }}>{guestName}</td>
                  <td style={{ padding: 8 }}>
                    {contact !== '—' ? (
                      <a href={`mailto:${contact}`} style={{ color: TavariStyles.colors.primary }}>
                        {contact}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={{ padding: 8 }}>{r.rating}</td>
                  <td style={{ padding: 8 }}>{r.flow_type}</td>
                  <td style={{ padding: 8 }}>
                    {r.routed_to_google ? (r.google_redirect_clicked ? 'Clicked' : 'Shown URL') : 'Internal'}
                  </td>
                  <td style={{ padding: 8, maxWidth: 280 }}>{r.comment || '—'}</td>
                </tr>
              );
              })}
            </tbody>
          </table>
          {rows.length === 0 ? (
            <p style={{ color: TavariStyles.colors.gray500 }}>No submissions yet.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
