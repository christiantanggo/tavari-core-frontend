import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';

const readDebugFlag = () => {
  try {
    return localStorage.getItem('helcim_debug') === '1';
  } catch (e) {
    return false;
  }
};

const canUseDebug = () => {
  // In dev builds, always allow. In prod, gate behind localStorage flag.
  try {
    return !!import.meta?.env?.DEV || readDebugFlag();
  } catch (e) {
    return readDebugFlag();
  }
};

const HelcimRealtimeDebugScreen = () => {
  const [saleId, setSaleId] = useState('');
  const [status, setStatus] = useState('idle'); // idle | subscribing | subscribed | error
  const [lastEvent, setLastEvent] = useState(null);
  const [logLines, setLogLines] = useState([]);
  const [debugEnabled, setDebugEnabled] = useState(canUseDebug());

  const channelsRef = useRef([]);

  const invoiceNumber = useMemo(() => {
    const trimmed = (saleId || '').trim();
    if (!trimmed) return '';
    return `SALE-${trimmed}`;
  }, [saleId]);

  const appendLog = (line) => {
    const ts = new Date().toISOString();
    setLogLines((prev) => [...prev.slice(-200), `${ts}  ${line}`]);
  };

  const cleanup = () => {
    try {
      (channelsRef.current || []).forEach((ch) => {
        try {
          supabase.removeChannel(ch);
        } catch (e) {
          // ignore
        }
      });
    } finally {
      channelsRef.current = [];
    }
  };

  useEffect(() => {
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setDebugEnabled(canUseDebug());
  }, []);

  const subscribe = async () => {
    if (!canUseDebug()) return;

    const id = (saleId || '').trim();
    if (!id) {
      appendLog('Enter a saleId first.');
      return;
    }

    cleanup();
    setLastEvent(null);
    setStatus('subscribing');

    const channelNames = [
      `helcim-payment-${id}`,
      `helcim-payment-SALE-${id}`,
    ];

    appendLog(`Subscribing to: ${channelNames.join(', ')}`);

    const channels = channelNames.map((channelName) => {
      return supabase
        // Enable self-broadcast echo so "Send test broadcast" can be verified in one tab.
        .channel(channelName, { config: { broadcast: { self: true } } })
        .on('broadcast', { event: 'payment_completed' }, ({ payload }) => {
          appendLog(`RECEIVED on ${channelName}: ${JSON.stringify(payload)}`);
          setLastEvent({ channelName, payload });
        })
        .subscribe((s) => {
          appendLog(`subscribe(${channelName}) => ${s}`);
          if (s === 'SUBSCRIBED') setStatus('subscribed');
          if (s === 'CHANNEL_ERROR') setStatus('error');
        });
    });

    channelsRef.current = channels;
  };

  const unsubscribe = async () => {
    cleanup();
    setStatus('idle');
    appendLog('Unsubscribed.');
  };

  const sendTestBroadcast = async () => {
    if (!canUseDebug()) return;

    const id = (saleId || '').trim();
    if (!id) {
      appendLog('Enter a saleId first.');
      return;
    }

    // IMPORTANT: Do NOT create a second channel with the same name.
    // Supabase Realtime treats channel names as unique; re-creating them can close existing subscriptions.
    if (!channelsRef.current || channelsRef.current.length === 0) {
      appendLog('You must click Subscribe first (so we can send on the active channels).');
      return;
    }

    const payload = {
      invoiceNumber: `SALE-${id}`,
      rawInvoiceNumber: id,
      saleId: id,
      transactionId: 'TEST-TX',
      approvalCode: 'TEST',
      amount: 0.01,
      deviceCode: localStorage.getItem('helcim_device_code') || 'JSV5',
      cardType: 'TEST',
      lastFour: '0000',
      status: 'completed',
      timestamp: new Date().toISOString(),
    };

    const channelNames = [
      `helcim-payment-${id}`,
      `helcim-payment-SALE-${id}`,
    ];

    appendLog(`Sending test broadcast to: ${channelNames.join(', ')}`);

    // Send on the already-subscribed channel objects.
    for (const ch of channelsRef.current) {
      try {
        const { error } = await ch.send({ type: 'broadcast', event: 'payment_completed', payload });
        if (error) {
          appendLog(`send() error: ${JSON.stringify(error)}`);
        } else {
          appendLog('send() ok');
        }
      } catch (e) {
        appendLog(`send() exception: ${e?.message || String(e)}`);
      }
    }
  };

  const styles = {
    container: {
      ...TavariStyles.layout.container,
      gap: TavariStyles.spacing.xl,
    },
    card: {
      ...TavariStyles.layout.card,
      padding: TavariStyles.spacing.xl,
    },
    title: {
      fontSize: TavariStyles.typography.fontSize['2xl'],
      fontWeight: TavariStyles.typography.fontWeight.bold,
      margin: 0,
      marginBottom: TavariStyles.spacing.sm,
    },
    subtitle: {
      margin: 0,
      marginBottom: TavariStyles.spacing.lg,
      color: TavariStyles.colors.gray600,
    },
    row: {
      display: 'flex',
      gap: TavariStyles.spacing.md,
      flexWrap: 'wrap',
      alignItems: 'center',
      marginBottom: TavariStyles.spacing.lg,
    },
    input: {
      ...TavariStyles.components.form.input,
      minWidth: '340px',
      flex: 1,
    },
    button: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.primary,
      ...TavariStyles.components.button.sizes.md,
    },
    secondaryButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.secondary,
      ...TavariStyles.components.button.sizes.md,
    },
    dangerButton: {
      ...TavariStyles.components.button.base,
      ...TavariStyles.components.button.variants.danger,
      ...TavariStyles.components.button.sizes.md,
    },
    mono: {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: '13px',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      background: TavariStyles.colors.gray50,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      borderRadius: TavariStyles.borderRadius.md,
      padding: TavariStyles.spacing.md,
      maxHeight: '320px',
      overflow: 'auto',
    },
    badge: {
      display: 'inline-block',
      padding: '4px 10px',
      borderRadius: '999px',
      fontSize: '13px',
      fontWeight: 700,
      border: `1px solid ${TavariStyles.colors.gray200}`,
      background: TavariStyles.colors.gray50,
      color: TavariStyles.colors.gray700,
    },
  };

  if (!debugEnabled) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2 style={styles.title}>Helcim Realtime Debug</h2>
          <p style={styles.subtitle}>
            Debug mode is disabled. Click the button below to enable it (no refresh needed).
          </p>
          <button
            style={styles.button}
            onClick={() => {
              try {
                localStorage.setItem('helcim_debug', '1');
              } catch (e) {
                // ignore
              }
              setDebugEnabled(true);
            }}
          >
            Enable debug
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>Helcim Realtime Debug</h2>
        <p style={styles.subtitle}>
          This tests whether the POS can receive `payment_completed` broadcast events.
          No Helcim charges are involved.
        </p>

        <div style={styles.row}>
          <input
            style={styles.input}
            value={saleId}
            onChange={(e) => setSaleId(e.target.value)}
            placeholder="Paste pos_sales.id (UUID) here"
          />
          <span style={styles.badge}>status: {status}</span>
        </div>

        <div style={styles.row}>
          <button style={styles.button} onClick={subscribe}>
            Subscribe
          </button>
          <button style={styles.secondaryButton} onClick={unsubscribe}>
            Unsubscribe
          </button>
          <button style={styles.dangerButton} onClick={sendTestBroadcast}>
            Send test broadcast (no charge)
          </button>
        </div>

        <div style={{ marginBottom: TavariStyles.spacing.lg }}>
          <div style={{ fontWeight: 700, marginBottom: TavariStyles.spacing.xs }}>Invoice number</div>
          <div style={styles.mono}>{invoiceNumber || '(enter a saleId)'}</div>
        </div>

        <div style={{ marginBottom: TavariStyles.spacing.lg }}>
          <div style={{ fontWeight: 700, marginBottom: TavariStyles.spacing.xs }}>Last event</div>
          <div style={styles.mono}>{lastEvent ? JSON.stringify(lastEvent, null, 2) : '(none yet)'}</div>
        </div>

        <div>
          <div style={{ fontWeight: 700, marginBottom: TavariStyles.spacing.xs }}>Log</div>
          <div style={styles.mono}>{logLines.length ? logLines.join('\n') : '(empty)'}</div>
        </div>
      </div>
    </div>
  );
};

export default HelcimRealtimeDebugScreen;

