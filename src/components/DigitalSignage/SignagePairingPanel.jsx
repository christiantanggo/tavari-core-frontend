// Pairing panel for digital signage player (enter screen_key).
import React, { useState } from 'react';
import { FiMonitor } from 'react-icons/fi';

const SignagePairingPanel = ({ onPair, error, loading }) => {
  const [input, setInput] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const key = String(input || '').trim();
    if (key) onPair(key);
  };

  return (
    <div style={styles.root}>
      <div style={styles.card}>
        <FiMonitor size={48} style={{ color: '#008080', marginBottom: '1rem' }} />
        <h1 style={styles.title}>Tavari Digital Signage</h1>
        <p style={styles.subtitle}>
          Enter the screen key from your Digital Signage dashboard to connect this display.
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <label htmlFor="signageScreenKey" style={styles.label}>
            Screen key
          </label>
          <input
            id="signageScreenKey"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="1234-5678"
            style={styles.input}
            autoFocus
            disabled={loading}
          />
          {error ? <p style={styles.error}>{error}</p> : null}
          <button type="submit" style={styles.button} disabled={loading || !input.trim()}>
            {loading ? 'Connecting…' : 'Connect screen'}
          </button>
        </form>

        <p style={styles.hint}>
          Example: 1234-5678. You can also enter eight digits without the dash.
        </p>
      </div>
    </div>
  );
};

const styles = {
  root: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
    padding: '1.5rem'
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    backgroundColor: '#fff',
    borderRadius: '12px',
    padding: '2rem',
    textAlign: 'center',
    boxShadow: '0 8px 32px rgba(0,0,0,0.35)'
  },
  title: {
    margin: '0 0 0.5rem',
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#1f2937'
  },
  subtitle: {
    margin: '0 0 1.5rem',
    fontSize: '0.95rem',
    color: '#4b5563',
    lineHeight: 1.5
  },
  form: {
    textAlign: 'left'
  },
  label: {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: 600,
    color: '#374151',
    marginBottom: '0.35rem'
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '0.75rem',
    fontSize: '1rem',
    borderRadius: '8px',
    border: '1px solid #d1d5db',
    marginBottom: '0.75rem',
    fontFamily: 'ui-monospace, monospace'
  },
  error: {
    color: '#dc2626',
    fontSize: '0.875rem',
    margin: '0 0 0.75rem'
  },
  button: {
    width: '100%',
    padding: '0.85rem',
    fontSize: '1rem',
    fontWeight: 600,
    color: '#fff',
    backgroundColor: '#008080',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer'
  },
  hint: {
    margin: '1.25rem 0 0',
    fontSize: '0.8rem',
    color: '#6b7280',
    lineHeight: 1.45
  }
};

export default SignagePairingPanel;
