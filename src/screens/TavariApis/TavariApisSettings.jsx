import React from 'react';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { tavariApisPageStyles as styles } from './tavariApisStyles';
import ModuleDeactivationPanel from '../../components/Modules/ModuleDeactivationPanel';

export default function TavariApisSettings() {
  const { selectedBusinessId } = useBusinessContext();
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';

  return (
    <div style={styles.page}>
      <section style={styles.panel}>
        <h2 style={styles.panelTitle}>API base URL</h2>
        <p style={styles.panelText}>
          External consumers call Tavari Supabase Edge Functions at this base URL.
        </p>
        {supabaseUrl ? (
          <div style={styles.code}>{`${supabaseUrl.replace(/\/$/, '')}/functions/v1`}</div>
        ) : (
          <p style={styles.panelText}>Set VITE_SUPABASE_URL to preview the API base URL.</p>
        )}
      </section>

      <section style={styles.panel}>
        <h2 style={styles.panelTitle}>Business scope</h2>
        <p style={styles.panelText}>
          Public endpoints are scoped to a single business. Pass this ID from external sites when requesting
          data.
        </p>
        {selectedBusinessId ? (
          <div style={styles.code}>{selectedBusinessId}</div>
        ) : (
          <p style={styles.panelText}>Select a business to view its API scope ID.</p>
        )}
      </section>

      <section style={styles.panel}>
        <h2 style={styles.panelTitle}>Security</h2>
        <p style={styles.panelText}>
          Live endpoints are read-only, scoped by business ID, and only respond when Tavari APIs is enabled
          for the business. API keys, allowed origins (CORS), and per-endpoint toggles can be added here in
          a follow-up step.
        </p>
      </section>

      <ModuleDeactivationPanel moduleKey="tavari_apis" />
    </div>
  );
}
