import React, { useMemo } from 'react';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { TAVARI_API_ENDPOINTS } from '../../services/TavariApis/tavariApisCatalog';
import { tavariApisPageStyles as styles } from './tavariApisStyles';

export default function TavariApisOverview() {
  const { selectedBusinessId, selectedBusiness } = useBusinessContext();

  const summary = useMemo(() => {
    const live = TAVARI_API_ENDPOINTS.filter((endpoint) => endpoint.status === 'live').length;
    const planned = TAVARI_API_ENDPOINTS.filter((endpoint) => endpoint.status !== 'live').length;
    return {
      endpoints: TAVARI_API_ENDPOINTS.length,
      consumers: 0,
      active: live,
      planned,
    };
  }, []);

  return (
    <div style={styles.page}>
      <section style={styles.summaryRow}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{summary.active}</div>
          <div style={styles.summaryLabel}>Live endpoints</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{summary.planned}</div>
          <div style={styles.summaryLabel}>Planned endpoints</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryValue}>{summary.consumers}</div>
          <div style={styles.summaryLabel}>Registered consumers</div>
        </div>
      </section>

      <section style={styles.panel}>
        <h2 style={styles.panelTitle}>How Tavari APIs works</h2>
        <p style={styles.panelText}>
          Tavari remains the source of truth. External websites call read-only endpoints scoped to your
          business ID — they never connect directly to your Tavari database.
        </p>
        <p style={styles.panelText}>
          Live endpoints return fields from <strong>Dashboard → Settings</strong>, including the public
          profile endpoint that packages contact info, branding, and hours for connected websites. Update
          them in Settings and external consumers see the new values on their next request.
        </p>
        {selectedBusinessId && (
          <div style={styles.code}>
            Business ID: {selectedBusinessId}
            {selectedBusiness?.name ? ` · ${selectedBusiness.name}` : ''}
          </div>
        )}
      </section>

      <section style={styles.list}>
        {TAVARI_API_ENDPOINTS.map((endpoint) => (
          <article key={endpoint.id} style={styles.card}>
            <div>
              <div style={styles.kicker}>Endpoint</div>
              <h3 style={styles.cardTitle}>{endpoint.summary}</h3>
              <p style={styles.panelText}>{endpoint.description}</p>
            </div>
            <span
              style={
                endpoint.status === 'live'
                  ? styles.badge
                  : { ...styles.badge, ...styles.badgeMuted }
              }
            >
              {endpoint.status === 'live' ? 'Live' : 'Coming soon'}
            </span>
          </article>
        ))}
      </section>
    </div>
  );
}
