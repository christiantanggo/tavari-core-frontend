import React from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';

const cardStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const summaryStyle = {
  borderRadius: 16,
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

/** Same fallback as WaiversDashboard when template + settings are unavailable. */
const PORTAL_EXPIRY_FALLBACK_DAYS = 365;

const formatExpiryLabel = (expiryMs) => {
  const d = new Date(expiryMs);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

/** Effective expiry for summary: server `effectiveExpiresAt`, else DB `expiresAt`, else signed + fallback days. */
const getEffectiveExpiryMs = (waiver) => {
  const iso = waiver.effectiveExpiresAt || waiver.expiresAt;
  if (iso) {
    const ms = new Date(iso).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  if (!waiver.signedAt) return null;
  const signedMs = new Date(waiver.signedAt).getTime();
  if (!Number.isFinite(signedMs)) return null;
  return signedMs + PORTAL_EXPIRY_FALLBACK_DAYS * 24 * 60 * 60 * 1000;
};

const getWaiverSummary = (waivers) => {
  const now = Date.now();
  const withExpiry = waivers
    .map((waiver) => ({
      ...waiver,
      expiryMs: getEffectiveExpiryMs(waiver),
    }))
    .filter((waiver) => waiver.expiryMs != null)
    .sort((a, b) => a.expiryMs - b.expiryMs);

  const nextValid = withExpiry.find((waiver) => waiver.isValid !== false && waiver.expiryMs >= now);
  if (nextValid) {
    const daysRemaining = Math.max(0, Math.ceil((nextValid.expiryMs - now) / (1000 * 60 * 60 * 24)));
    return {
      tone: 'valid',
      title: 'Waiver currently valid',
      expiryLabel: formatExpiryLabel(nextValid.expiryMs),
      daysLabel: `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`,
    };
  }

  const mostRecentExpired = [...withExpiry].reverse().find((waiver) => waiver.expiryMs < now || waiver.isValid === false);
  if (mostRecentExpired) {
    const daysExpired = Math.max(0, Math.ceil((now - mostRecentExpired.expiryMs) / (1000 * 60 * 60 * 24)));
    return {
      tone: 'expired',
      title: 'Waiver needs to be renewed',
      expiryLabel: formatExpiryLabel(mostRecentExpired.expiryMs),
      daysLabel: `${daysExpired} day${daysExpired === 1 ? '' : 's'} expired`,
    };
  }

  const validWithoutExpiry = waivers.find((waiver) => waiver.isValid);
  if (validWithoutExpiry) {
    return {
      tone: 'valid',
      title: 'Waiver on file',
      expiryLabel: 'No signed date yet — expiry unknown',
      daysLabel: 'Still marked valid',
    };
  }

  return {
    tone: 'missing',
    title: 'No completed waiver on file',
    expiryLabel: 'Complete a waiver to activate your account records',
    daysLabel: 'Action required',
  };
};

const CustomerPortalWaiversPage = () => {
  const { portalData } = useOutletContext();
  const { businessId } = useParams();
  const waivers = portalData?.waivers || [];
  const attachedPeople = portalData?.account?.attachedPeople || [];
  const waiverSummary = getWaiverSummary(waivers);

  const summaryColors = {
    valid: {
      backgroundColor: '#ecfdf5',
      border: '1px solid #10b981',
      titleColor: '#065f46',
      metaColor: '#047857',
    },
    expired: {
      backgroundColor: '#fef2f2',
      border: '1px solid #ef4444',
      titleColor: '#991b1b',
      metaColor: '#b91c1c',
    },
    missing: {
      backgroundColor: '#fff7ed',
      border: '1px solid #f59e0b',
      titleColor: '#9a3412',
      metaColor: '#c2410c',
    },
  };
  const summaryTheme = summaryColors[waiverSummary.tone];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Waivers</h2>
          <p style={{ margin: '8px 0 0', color: '#6b7280' }}>
            Review completed waivers, download PDFs, and manage the people linked to your waiver records.
          </p>
        </div>
        <Link
          to={`/customer-portal/${businessId}/portal`}
          style={{ textDecoration: 'none', background: '#2563eb', color: 'white', padding: '12px 18px', borderRadius: 8, fontWeight: 600 }}
        >
          Start New Waiver / Booking
        </Link>
      </div>

      <div
        style={{
          ...summaryStyle,
          backgroundColor: summaryTheme.backgroundColor,
          border: summaryTheme.border,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: summaryTheme.metaColor }}>
          Waiver expiry
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: summaryTheme.titleColor }}>
          {waiverSummary.expiryLabel}
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, color: summaryTheme.titleColor }}>
          {waiverSummary.daysLabel}
        </div>
        <div style={{ fontSize: 14, color: summaryTheme.metaColor }}>
          {waiverSummary.title}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ fontWeight: 700 }}>People attached to your waivers</div>
        {attachedPeople.length === 0 ? (
          <div style={{ color: '#6b7280' }}>No attached people were found yet.</div>
        ) : attachedPeople.map((person) => (
          <div key={person.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>{person.displayName}</div>
            <div style={{ color: '#6b7280' }}>{person.accessLevel}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>Completed waivers</h3>
        {waivers.length === 0 ? (
          <div style={cardStyle}>Completed waivers will appear here once they are signed.</div>
        ) : waivers.map((waiver) => (
          <div key={waiver.id} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>
                  {[waiver.firstName, waiver.lastName].filter(Boolean).join(' ') || 'Waiver'}
                </div>
                <div style={{ color: '#6b7280', marginTop: 4 }}>
                  Signed: {waiver.signedAt || 'Not signed yet'}
                </div>
                <div style={{ color: '#6b7280', marginTop: 4 }}>
                  Status: {waiver.isValid ? 'Valid' : 'Needs attention'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                {waiver.pdfUrl ? (
                  <a href={waiver.pdfUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>
                    Download PDF
                  </a>
                ) : (
                  <span style={{ color: '#6b7280' }}>PDF not available</span>
                )}
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Attached people</div>
              {(waiver.attachedPeople || []).length === 0 ? (
                <div style={{ color: '#6b7280' }}>No additional people are attached to this waiver.</div>
              ) : (
                (waiver.attachedPeople || []).map((person) => (
                  <div key={person.id} style={{ color: '#6b7280', marginBottom: 4 }}>
                    {[person.first_name, person.last_name].filter(Boolean).join(' ') || 'Participant'} - {person.participant_type || 'member'}
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CustomerPortalWaiversPage;
