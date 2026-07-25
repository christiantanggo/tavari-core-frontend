import React from 'react';
import { tavariApisPageStyles as styles } from './tavariApisStyles';

export default function TavariApisConsumers() {
  return (
    <div style={styles.page}>
      <section style={styles.panel}>
        <h2 style={styles.panelTitle}>External consumers</h2>
        <p style={styles.panelText}>
          Register websites and apps that call your Tavari APIs. Each consumer can have its own allowed
          origins, API key, and enabled endpoint list.
        </p>
        <p style={styles.panelText}>
          Example: Off The Wall Kids marketing site at <strong>offthewallkids.ca</strong> would appear here
          once connected.
        </p>
      </section>

      <section style={styles.panel}>
        <h3 style={{ ...styles.panelTitle, fontSize: 16 }}>No consumers yet</h3>
        <p style={styles.panelText}>
          Consumer registration will be added in a follow-up step. For now, use the Endpoints tab to review
          the planned public API surface.
        </p>
      </section>
    </div>
  );
}
