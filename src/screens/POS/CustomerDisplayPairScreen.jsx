import React, { useState } from 'react';
import { supabase } from '../../supabaseClient';

/**
 * Shown inside Electron when the customer display app has no saved token.
 * Loads from production URL so pairing UI always matches deploy (avoids missing local HTML in .exe).
 */
export default function CustomerDisplayPairScreen() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const completePairing = typeof window !== 'undefined' ? window.tavariCustomerDisplayCompletePairing : null;

  const submit = async () => {
    const digits = String(code || '').replace(/\D/g, '').slice(0, 6);
    if (digits.length !== 6) {
      setErr('Enter all 6 digits.');
      return;
    }
    if (typeof completePairing !== 'function') {
      setErr('Open this screen from the Tavari Customer Display desktop app.');
      return;
    }
    setErr('');
    setBusy(true);
    try {
      const { data: raw, error } = await supabase.rpc('redeem_customer_display_pairing_code', {
        p_code: digits
      });
      if (error) throw error;
      let data = raw;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          data = null;
        }
      }
      if (!data || data.ok !== true) {
        const k = data?.error;
        setErr(
          k === 'not_found_or_expired'
            ? 'Invalid or expired code. Get a new code from POS → Customer display on the register.'
            : 'Could not pair. Try again.'
        );
        setBusy(false);
        return;
      }
      const cfg = {
        productionUrl: String(data.productionUrl || '').replace(/\/$/, ''),
        displayToken: String(data.displayToken || ''),
        hashRoute: data.hashRoute || '/customer-display'
      };
      if (!cfg.displayToken || !cfg.productionUrl) {
        setErr('Server response incomplete.');
        setBusy(false);
        return;
      }
      const result = await completePairing(cfg);
      if (result && result.ok === false) {
        setErr(result.message || 'Could not save pairing.');
        setBusy(false);
      }
    } catch (e) {
      setErr(e?.message || 'Network error');
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        margin: 0,
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        background: '#0f1419',
        color: '#e8eaed',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 380,
          background: '#1a2332',
          borderRadius: 12,
          padding: '28px 24px',
          border: '1px solid #2d3a4d'
        }}
      >
        <h1 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700 }}>Connect this screen</h1>
        <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.45, color: '#9aa5b5' }}>
          On the register: <strong>POS → Customer display</strong> → get the <strong>6-digit code</strong>, then enter it
          here.
        </p>
        <label htmlFor="pair-code" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          Pairing code
        </label>
        <input
          id="pair-code"
          type="text"
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
          placeholder="000000"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
            setErr('');
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          style={{
            width: '100%',
            padding: '14px 16px',
            fontSize: 23,
            letterSpacing: '0.35em',
            textAlign: 'center',
            borderRadius: 8,
            border: '2px solid #2d3a4d',
            background: '#0f1419',
            color: '#fff',
            fontWeight: 600,
            boxSizing: 'border-box'
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          style={{
            width: '100%',
            marginTop: 18,
            padding: 14,
            fontSize: 15,
            fontWeight: 700,
            border: 'none',
            borderRadius: 8,
            background: '#2563eb',
            color: '#fff',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.7 : 1
          }}
        >
          {busy ? 'Connecting…' : 'Connect'}
        </button>
        {err ? (
          <p style={{ marginTop: 12, fontSize: 13, color: '#f87171', minHeight: '1.2em' }}>{err}</p>
        ) : null}
        <p style={{ marginTop: 14, fontSize: 13, color: '#6b7788', lineHeight: 1.4 }}>
          Codes expire in about 15 minutes. Open the app from the Start menu anytime after pairing — no need to
          re-download the installer.
        </p>
      </div>
    </div>
  );
}
