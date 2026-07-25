// src/screens/POS/POSSettingsComponents/PaymentsTab.jsx
import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../../supabaseClient';
import TavariCheckbox from '../../../components/UI/TavariCheckbox';
import { TavariStyles } from '../../../utils/TavariStyles';

const PaymentsTab = ({ settings, handleInputChange, businessId, canEdit }) => {
  const [helcimLoading, setHelcimLoading] = useState(false);
  const [helcimStatus, setHelcimStatus] = useState(null);
  const [apiTokenInput, setApiTokenInput] = useState('');
  const [webhookVerifierInput, setWebhookVerifierInput] = useState('');
  const [helcimAccountIdInput, setHelcimAccountIdInput] = useState('');

  const [anetLoading, setAnetLoading] = useState(false);
  const [anetStatus, setAnetStatus] = useState(null);
  const [anetApiLoginIdInput, setAnetApiLoginIdInput] = useState('');
  const [anetTransactionKeyInput, setAnetTransactionKeyInput] = useState('');
  const [anetSignatureKeyInput, setAnetSignatureKeyInput] = useState('');
  const [anetSandbox, setAnetSandbox] = useState(false);
  const [anetRecentSales, setAnetRecentSales] = useState([]);
  const [anetSyncing, setAnetSyncing] = useState(false);

  const [cloverLoading, setCloverLoading] = useState(false);
  const [cloverStatus, setCloverStatus] = useState(null);
  const [cloverMerchantIdInput, setCloverMerchantIdInput] = useState('');
  const [cloverApiTokenInput, setCloverApiTokenInput] = useState('');
  const [cloverAuthCodeInput, setCloverAuthCodeInput] = useState('');
  const [cloverSandbox, setCloverSandbox] = useState(true);
  const [cloverRecentSales, setCloverRecentSales] = useState([]);
  const [cloverSyncing, setCloverSyncing] = useState(false);

  const loadHelcimStatus = useCallback(async () => {
    if (!businessId) return;
    setHelcimLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('business-helcim-credentials', {
        body: { action: 'get', businessId },
      });
      if (error) {
        toast.error(error.message || 'Could not load Helcim settings');
        return;
      }
      setHelcimStatus(data || null);
      setHelcimAccountIdInput(data?.helcimAccountId || '');
    } finally {
      setHelcimLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    loadHelcimStatus();
  }, [loadHelcimStatus]);

  const loadAnetStatus = useCallback(async () => {
    if (!businessId) return;
    setAnetLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('business-authorize-net-credentials', {
        body: { action: 'get', businessId },
      });
      if (error) {
        toast.error(error.message || 'Could not load Authorize.net settings');
        return;
      }
      setAnetStatus(data || null);
      setAnetApiLoginIdInput(data?.apiLoginId || '');
      setAnetSandbox(!!data?.sandbox);

      if (data?.configured) {
        const { data: rows, error: salesErr } = await supabase
          .from('authorize_net_transactions')
          .select('id, trans_id, event_type, amount, status, event_date, customer_name, invoice_description, created_at')
          .eq('business_id', businessId)
          .order('created_at', { ascending: false })
          .limit(10);
        if (!salesErr) setAnetRecentSales(rows || []);
      } else {
        setAnetRecentSales([]);
      }
    } finally {
      setAnetLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    loadAnetStatus();
  }, [loadAnetStatus]);

  const loadCloverStatus = useCallback(async () => {
    if (!businessId) return;
    setCloverLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('business-clover-credentials', {
        body: { action: 'get', businessId },
      });
      if (error) {
        toast.error(error.message || 'Could not load Clover settings');
        return;
      }
      setCloverStatus(data || null);
      setCloverMerchantIdInput(data?.merchantId || '');
      setCloverSandbox(data?.sandbox !== false);

      if (data?.configured) {
        const { data: rows, error: salesErr } = await supabase
          .from('clover_transactions')
          .select('id, payment_id, event_type, amount, status, event_date, order_id, created_at')
          .eq('business_id', businessId)
          .order('created_at', { ascending: false })
          .limit(10);
        if (!salesErr) setCloverRecentSales(rows || []);
      } else {
        setCloverRecentSales([]);
      }
    } finally {
      setCloverLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    loadCloverStatus();
  }, [loadCloverStatus]);

  const clearCloverOAuthParams = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('code');
    url.searchParams.delete('merchant_id');
    url.searchParams.delete('client_id');
    window.history.replaceState({}, '', url.pathname + url.search);
  }, []);

  const exchangeCloverOAuth = useCallback(
    async (code, merchantIdFromUrl) => {
      if (!businessId || !canEdit) return;
      setCloverLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke('business-clover-credentials', {
          body: {
            action: 'exchange',
            businessId,
            code,
            merchantId: merchantIdFromUrl || cloverMerchantIdInput.trim(),
            sandbox: cloverSandbox,
          },
        });
        if (error) {
          toast.error(error.message || 'Clover authorization failed');
          return;
        }
        if (data?.error) {
          toast.error(data.error);
          return;
        }
        toast.success('Clover account connected.');
        clearCloverOAuthParams();
        await loadCloverStatus();
      } finally {
        setCloverLoading(false);
      }
    },
    [businessId, canEdit, cloverMerchantIdInput, cloverSandbox, clearCloverOAuthParams, loadCloverStatus]
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code || !businessId || !canEdit) return;
    const merchantIdFromUrl = params.get('merchant_id') || '';
    exchangeCloverOAuth(code, merchantIdFromUrl);
  }, [businessId, canEdit, exchangeCloverOAuth]);

  const connectCloverOAuth = async () => {
    if (!businessId || !canEdit) return;
    const merchantId = cloverMerchantIdInput.trim();
    if (!merchantId) {
      toast.error('Enter your Clover Merchant ID first, then click Connect.');
      return;
    }
    setCloverLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('business-clover-credentials', {
        body: {
          action: 'connectUrl',
          businessId,
          merchantId,
          sandbox: cloverSandbox,
        },
      });
      if (error) {
        toast.error(error.message || 'Could not start Clover authorization');
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      if (data?.authorizeUrl) {
        window.location.href = data.authorizeUrl;
        return;
      }
      toast.error('Clover did not return an authorization URL.');
    } finally {
      setCloverLoading(false);
    }
  };

  const saveAnetCredentials = async () => {
    if (!businessId || !canEdit) return;
    setAnetLoading(true);
    try {
      const payload = {
        action: 'save',
        businessId,
        apiLoginId: anetApiLoginIdInput.trim(),
        transactionKey: anetTransactionKeyInput.trim(),
        signatureKey: anetSignatureKeyInput.trim(),
        sandbox: anetSandbox,
        paymentSource: 'bookeo',
      };
      const { data, error } = await supabase.functions.invoke('business-authorize-net-credentials', {
        body: payload,
      });
      if (error) {
        toast.error(error.message || 'Save failed');
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      toast.success('Authorize.net credentials saved.');
      setAnetTransactionKeyInput('');
      setAnetSignatureKeyInput('');
      await loadAnetStatus();
    } finally {
      setAnetLoading(false);
    }
  };

  const saveCloverCredentials = async () => {
    if (!businessId || !canEdit) return;
    setCloverLoading(true);
    try {
      const payload = {
        action: 'save',
        businessId,
        merchantId: cloverMerchantIdInput.trim(),
        apiToken: cloverApiTokenInput.trim(),
        cloverAuthCode: cloverAuthCodeInput.trim(),
        sandbox: cloverSandbox,
        paymentSource: 'clover_pos',
      };
      const { data, error } = await supabase.functions.invoke('business-clover-credentials', {
        body: payload,
      });
      if (error) {
        toast.error(error.message || 'Save failed');
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      toast.success('Clover credentials saved.');
      setCloverApiTokenInput('');
      setCloverAuthCodeInput('');
      await loadCloverStatus();
    } finally {
      setCloverLoading(false);
    }
  };

  const syncCloverToday = async () => {
    if (!businessId || !canEdit || !cloverStatus?.configured) return;
    const syncDate = new Date().toLocaleDateString('en-CA');
    setCloverSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('clover-sync-sales', {
        body: { businessId, syncDate },
      });
      if (error) {
        toast.error(error.message || 'Sync failed');
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      const imported = Number(data?.imported || 0);
      const updated = Number(data?.updated || 0);
      const scanned = Number(data?.scanned || 0);
      toast.success(
        `Synced ${syncDate}: ${imported} new, ${updated} updated (${scanned} scanned in Clover).`
      );
      await loadCloverStatus();
    } finally {
      setCloverSyncing(false);
    }
  };

  const clearCloverCredentials = async () => {
    if (!businessId || !canEdit) return;
    if (!window.confirm('Remove stored Clover credentials for this business?')) return;
    setCloverLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('business-clover-credentials', {
        body: { action: 'save', businessId, clearAll: true },
      });
      if (error) {
        toast.error(error.message || 'Could not clear credentials');
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      toast.success('Clover credentials removed.');
      setCloverStatus(null);
      setCloverMerchantIdInput('');
      setCloverApiTokenInput('');
      setCloverAuthCodeInput('');
      setCloverSandbox(true);
    } finally {
      setCloverLoading(false);
    }
  };

  const syncAnetToday = async () => {
    if (!businessId || !canEdit || !anetStatus?.configured) return;
    const syncDate = new Date().toLocaleDateString('en-CA');
    setAnetSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('authorize-net-sync-sales', {
        body: { businessId, syncDate },
      });
      if (error) {
        toast.error(error.message || 'Sync failed');
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      const imported = Number(data?.imported || 0);
      const updated = Number(data?.updated || 0);
      const scanned = Number(data?.scanned || 0);
      toast.success(
        `Synced ${syncDate}: ${imported} new, ${updated} updated (${scanned} scanned in Authorize.net).`
      );
      await loadAnetStatus();
    } finally {
      setAnetSyncing(false);
    }
  };

  const clearAnetCredentials = async () => {
    if (!businessId || !canEdit) return;
    if (!window.confirm('Remove stored Authorize.net credentials for this business?')) return;
    setAnetLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('business-authorize-net-credentials', {
        body: { action: 'save', businessId, clearAll: true },
      });
      if (error) {
        toast.error(error.message || 'Could not clear credentials');
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      toast.success('Authorize.net credentials removed.');
      setAnetStatus(null);
      setAnetApiLoginIdInput('');
      setAnetTransactionKeyInput('');
      setAnetSignatureKeyInput('');
      setAnetSandbox(false);
    } finally {
      setAnetLoading(false);
    }
  };

  const saveHelcimCredentials = async () => {
    if (!businessId || !canEdit) return;
    setHelcimLoading(true);
    try {
      const payload = {
        action: 'save',
        businessId,
        apiToken: apiTokenInput.trim(),
        webhookVerifierToken: webhookVerifierInput.trim(),
        helcimAccountId: helcimAccountIdInput.trim(),
      };
      const { data, error } = await supabase.functions.invoke('business-helcim-credentials', {
        body: payload,
      });
      if (error) {
        toast.error(error.message || 'Save failed');
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      toast.success('Helcim credentials saved.');
      setApiTokenInput('');
      setWebhookVerifierInput('');
      await loadHelcimStatus();
    } finally {
      setHelcimLoading(false);
    }
  };

  const clearHelcimCredentials = async () => {
    if (!businessId || !canEdit) return;
    if (!window.confirm('Remove stored Helcim API token and webhook secret for this business?')) return;
    setHelcimLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('business-helcim-credentials', {
        body: { action: 'save', businessId, clearAll: true },
      });
      if (error) {
        toast.error(error.message || 'Could not clear credentials');
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      toast.success('Helcim credentials removed.');
      setHelcimStatus(null);
      setApiTokenInput('');
      setWebhookVerifierInput('');
      setHelcimAccountIdInput('');
    } finally {
      setHelcimLoading(false);
    }
  };

  return (
    <div style={styles.tabContent}>
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Helcim (card payments)</h3>
        <p style={styles.helpText}>
          Card payments use this business&apos;s Helcim merchant only — funds settle to that Helcim account, not a shared
          platform account. Paste keys from the Helcim dashboard; they are encrypted server-side. Operators must set the
          Supabase secret <code style={styles.code}>HELCIM_CREDENTIALS_ENCRYPTION_KEY</code> (32-byte random key,
          base64-encoded) project-wide so secrets can be stored; each business still has its own API token and webhook
          signing secret.
        </p>

        {helcimLoading && !helcimStatus && (
          <div style={styles.settingDescription}>Loading Helcim status…</div>
        )}

        {helcimStatus?.configured && (
          <div style={styles.statusLine}>
            API token on file: <strong>{helcimStatus.apiTokenHint || '******'}</strong>
            {helcimStatus.webhookVerifierConfigured
              ? ' · Webhook verifier configured'
              : ' · Webhook verifier not set (falls back to platform secret if configured)'}
          </div>
        )}

        {!helcimStatus?.configured && !helcimLoading && (
          <div style={styles.settingDescription}>
            Save your Helcim API token below — POS, terminals, and booking checkout will not process cards until this is
            configured for this business.
          </div>
        )}

        <div style={styles.setting}>
          <label style={styles.label}>Helcim API token</label>
          <input
            type="password"
            autoComplete="off"
            value={apiTokenInput}
            onChange={(e) => setApiTokenInput(e.target.value)}
            placeholder={helcimStatus?.configured ? 'Leave blank to keep existing token' : 'Required — from Helcim API Access'}
            style={styles.textInput}
            disabled={!canEdit || helcimLoading}
          />
        </div>

        <div style={styles.setting}>
          <label style={styles.label}>Helcim account ID (optional)</label>
          <input
            type="text"
            value={helcimAccountIdInput}
            onChange={(e) => setHelcimAccountIdInput(e.target.value)}
            placeholder="If your integration uses account id"
            style={styles.textInput}
            disabled={!canEdit || helcimLoading}
          />
        </div>

        <div style={styles.setting}>
          <label style={styles.label}>Webhook signing secret (optional)</label>
          <input
            type="password"
            autoComplete="off"
            value={webhookVerifierInput}
            onChange={(e) => setWebhookVerifierInput(e.target.value)}
            placeholder={
              helcimStatus?.webhookVerifierConfigured
                ? 'Leave blank to keep existing'
                : 'Base64 signing key from Helcim → Webhooks (required for callbacks)'
            }
            style={styles.textInput}
            disabled={!canEdit || helcimLoading}
          />
          <div style={styles.settingDescription}>
            Use the verifier from Helcim webhooks so transaction callbacks validate for this merchant.
          </div>
        </div>

        <div style={{ display: 'flex', gap: TavariStyles.spacing.md, flexWrap: 'wrap' }}>
          <button
            type="button"
            style={canEdit ? styles.primaryBtn : styles.btnDisabled}
            disabled={!canEdit || helcimLoading}
            onClick={saveHelcimCredentials}
          >
            Save Helcim credentials
          </button>
          <button
            type="button"
            style={helcimStatus?.configured && canEdit ? styles.dangerBtn : styles.btnDisabled}
            disabled={!canEdit || helcimLoading || !helcimStatus?.configured}
            onClick={clearHelcimCredentials}
          >
            Remove stored credentials
          </button>
        </div>
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Authorize.net (Bookeo sales)</h3>
        <p style={styles.helpText}>
          Card sales processed through Bookeo settle in this business&apos;s Authorize.net account. Paste API
          credentials from Authorize.net → Account → API Credentials &amp; Keys. The signature key must match the
          active key in Authorize.net exactly — if Authorize.net emails about webhook delivery failures, re-copy the
          signature key from that page and save here. Secrets are encrypted server-side using the same project secret
          as Helcim (<code style={styles.code}>HELCIM_CREDENTIALS_ENCRYPTION_KEY</code>).
        </p>

        {anetLoading && !anetStatus && (
          <div style={styles.settingDescription}>Loading Authorize.net status…</div>
        )}

        {anetStatus?.configured && (
          <div style={styles.statusLine}>
            API Login ID: <strong>{anetStatus.apiLoginId || '—'}</strong>
            {anetStatus.transactionKeyHint ? (
              <>
                {' '}
                · Transaction key: <strong>{anetStatus.transactionKeyHint}</strong>
              </>
            ) : null}
            {anetStatus.signatureKeyConfigured
              ? ' · Signature key configured'
              : ' · Signature key not set (required for webhooks)'}
            {anetStatus.sandbox ? ' · Sandbox' : ' · Production'} · Source: Bookeo
          </div>
        )}

        {!anetStatus?.configured && !anetLoading && (
          <div style={styles.settingDescription}>
            Add Authorize.net credentials to sync Bookeo card sales and configure transaction webhooks.
          </div>
        )}

        <div style={styles.setting}>
          <label style={styles.label}>API Login ID</label>
          <input
            type="text"
            autoComplete="off"
            value={anetApiLoginIdInput}
            onChange={(e) => setAnetApiLoginIdInput(e.target.value)}
            placeholder="From Authorize.net API Credentials & Keys"
            style={styles.textInput}
            disabled={!canEdit || anetLoading}
          />
        </div>

        <div style={styles.setting}>
          <label style={styles.label}>Transaction key</label>
          <input
            type="password"
            autoComplete="off"
            value={anetTransactionKeyInput}
            onChange={(e) => setAnetTransactionKeyInput(e.target.value)}
            placeholder={
              anetStatus?.configured ? 'Leave blank to keep existing key' : 'Required — shown once when generated'
            }
            style={styles.textInput}
            disabled={!canEdit || anetLoading}
          />
        </div>

        <div style={styles.setting}>
          <label style={styles.label}>Signature key</label>
          <input
            type="password"
            autoComplete="off"
            value={anetSignatureKeyInput}
            onChange={(e) => setAnetSignatureKeyInput(e.target.value)}
            placeholder={
              anetStatus?.signatureKeyConfigured
                ? 'Leave blank to keep existing key'
                : 'Required for webhook verification'
            }
            style={styles.textInput}
            disabled={!canEdit || anetLoading}
          />
        </div>

        <div style={styles.setting}>
          <TavariCheckbox
            checked={anetSandbox}
            onChange={(checked) => setAnetSandbox(checked)}
            label="Sandbox account (apitest.authorize.net)"
            id="anet-sandbox"
            testId="anet-sandbox-checkbox"
            disabled={!canEdit || anetLoading}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap',gap: TavariStyles.spacing.md }}>
          <button
            type="button"
            style={canEdit ? styles.primaryBtn : styles.btnDisabled}
            disabled={!canEdit || anetLoading || anetSyncing}
            onClick={saveAnetCredentials}
          >
            {anetLoading ? 'Saving…' : 'Save Authorize.net credentials' }
          </button>
          <button
            type="button"
            style={anetStatus?.configured && canEdit ? styles.primaryBtn : styles.btnDisabled}
            disabled={!canEdit || anetLoading || anetSyncing || !anetStatus?.configured}
            onClick={syncAnetToday}
          >
            {anetSyncing ? 'Syncing today…' : "Sync today's sales"}
          </button>
          <button
            type="button"
            style={anetStatus?.configured && canEdit ? styles.dangerBtn : styles.btnDisabled}
            disabled={!canEdit || anetLoading || anetSyncing || !anetStatus?.configured}
            onClick={clearAnetCredentials}
          >
            Remove stored credentials
          </button>
        </div>

        {anetStatus?.webhookUrl && (
          <div style={{ ...styles.setting, marginTop: TavariStyles.spacing.xl }}>
            <label style={styles.label}>Webhook URL (paste in Authorize.net → Account → Webhooks)</label>
            <input
              type="text"
              readOnly
              value={anetStatus.webhookUrl}
              style={styles.textInput}
              onFocus={(e) => e.target.select()}
            />
            <div style={styles.settingDescription}>
              Subscribe to payment events: Auth/Capture Created, Capture Created, Refund Created, Void Created.
              Authorize.net sends live Bookeo card sales here; Tavari stores them automatically.
            </div>
          </div>
        )}

        {anetRecentSales.length > 0 && (
          <div style={{ marginTop: TavariStyles.spacing.xl }}>
            <h4 style={styles.subsectionTitle}>Recent Authorize.net sales (last 10)</h4>
            <div style={styles.recentSalesTable}>
              {anetRecentSales.map((row) => (
                <div key={row.id} style={styles.recentSalesRow}>
                  <span>{row.event_date ? new Date(row.event_date).toLocaleString() : '—'}</span>
                  <span>${Number(row.amount || 0).toFixed(2)}</span>
                  <span>{row.status || '—'}</span>
                  <span>{row.customer_name || row.invoice_description || row.trans_id || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Clover (in-store sales)</h3>
        <p style={styles.helpText}>
          In-store card sales from your Clover register. For production (Off The Wall Kids), log into your
          real Clover merchant dashboard, create a read-only API token, paste it below, and uncheck Sandbox — or use
          Connect Clover after entering your production Merchant ID.
        </p>

        {cloverLoading && !cloverStatus && (
          <div style={styles.settingDescription}>Loading Clover status…</div>
        )}

        {cloverStatus?.configured && (
          <div style={styles.statusLine}>
            Merchant ID: <strong>{cloverStatus.merchantId || '—'}</strong>
            {cloverStatus.oauthConfigured ? (
              <> · Connected via OAuth</>
            ) : cloverStatus.apiTokenHint ? (
              <>
                {' '}
                · API token: <strong>{cloverStatus.apiTokenHint}</strong>
              </>
            ) : null}
            {cloverStatus.authCodeConfigured
              ? ' · Webhook auth code configured'
              : ' · Webhook auth code not set (optional until webhooks are live)'}
            {cloverStatus.sandbox ? ' · Sandbox' : ' · Production'} · Source: Clover POS
          </div>
        )}

        {!cloverStatus?.configured && !cloverLoading && (
          <div style={styles.settingDescription}>
            Add Clover credentials to sync in-store card sales and configure payment webhooks.
          </div>
        )}

        <div style={styles.setting}>
          <label style={styles.label}>Merchant ID</label>
          <input
            type="text"
            autoComplete="off"
            value={cloverMerchantIdInput}
            onChange={(e) => setCloverMerchantIdInput(e.target.value)}
            placeholder="Clover merchant UUID (mId)"
            style={styles.textInput}
            disabled={!canEdit || cloverLoading}
          />
        </div>

        <div style={styles.setting}>
          <label style={styles.label}>API token</label>
          <input
            type="password"
            autoComplete="off"
            value={cloverApiTokenInput}
            onChange={(e) => setCloverApiTokenInput(e.target.value)}
            placeholder={
              cloverStatus?.configured ? 'Leave blank to keep existing token' : 'Required — from Clover API tokens'
            }
            style={styles.textInput}
            disabled={!canEdit || cloverLoading}
          />
        </div>

        <div style={styles.setting}>
          <label style={styles.label}>Clover Auth Code (webhooks)</label>
          <input
            type="password"
            autoComplete="off"
            value={cloverAuthCodeInput}
            onChange={(e) => setCloverAuthCodeInput(e.target.value)}
            placeholder={
              cloverStatus?.authCodeConfigured
                ? 'Leave blank to keep existing code'
                : 'From Clover App Settings → Webhooks (X-Clover-Auth header)'
            }
            style={styles.textInput}
            disabled={!canEdit || cloverLoading}
          />
        </div>

        <div style={styles.setting}>
          <TavariCheckbox
            checked={cloverSandbox}
            onChange={(checked) => setCloverSandbox(checked)}
            label="Sandbox account (apisandbox.dev.clover.com)"
            id="clover-sandbox"
            testId="clover-sandbox-checkbox"
            disabled={!canEdit || cloverLoading}
          />
          <div style={styles.settingDescription}>
            Uncheck for Off The Wall Kids production Clover. Sandbox uses the test merchant only.
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: TavariStyles.spacing.md }}>
          <button
            type="button"
            style={canEdit ? styles.primaryBtn : styles.btnDisabled}
            disabled={!canEdit || cloverLoading || cloverSyncing}
            onClick={saveCloverCredentials}
          >
            {cloverLoading ? 'Saving…' : 'Save Clover credentials'}
          </button>
          <button
            type="button"
            style={canEdit ? styles.primaryBtn : styles.btnDisabled}
            disabled={!canEdit || cloverLoading || cloverSyncing || !cloverMerchantIdInput.trim()}
            onClick={connectCloverOAuth}
          >
            Connect Clover (OAuth)
          </button>
          <button
            type="button"
            style={cloverStatus?.configured && canEdit ? styles.primaryBtn : styles.btnDisabled}
            disabled={!canEdit || cloverLoading || cloverSyncing || !cloverStatus?.configured}
            onClick={syncCloverToday}
          >
            {cloverSyncing ? 'Syncing today…' : "Sync today's sales"}
          </button>
          <button
            type="button"
            style={cloverStatus?.configured && canEdit ? styles.dangerBtn : styles.btnDisabled}
            disabled={!canEdit || cloverLoading || cloverSyncing || !cloverStatus?.configured}
            onClick={clearCloverCredentials}
          >
            Remove stored credentials
          </button>
        </div>

        {cloverStatus?.webhookUrl && (
          <div style={{ ...styles.setting, marginTop: TavariStyles.spacing.xl }}>
            <label style={styles.label}>Webhook URL (paste in Clover App Settings → Webhooks)</label>
            <input
              type="text"
              readOnly
              value={cloverStatus.webhookUrl}
              style={styles.textInput}
              onFocus={(e) => e.target.select()}
            />
            <div style={styles.settingDescription}>
              Subscribe to Payments events. After saving the URL, click Send Verification Code in Clover — the code
              appears below once Clover posts it. Paste that code in Clover and click Verify, then copy the Clover Auth
              Code into the field above.
            </div>
            {cloverStatus?.pendingWebhookVerificationCode && (
              <div style={{ ...styles.setting, marginTop: TavariStyles.spacing.md }}>
                <label style={styles.label}>Verification code (paste in Clover → Verify)</label>
                <input
                  type="text"
                  readOnly
                  value={cloverStatus.pendingWebhookVerificationCode}
                  style={styles.textInput}
                  onFocus={(e) => e.target.select()}
                />
              </div>
            )}
          </div>
        )}

        {cloverRecentSales.length > 0 && (
          <div style={{ marginTop: TavariStyles.spacing.xl }}>
            <h4 style={styles.subsectionTitle}>Recent Clover sales (last 10)</h4>
            <div style={styles.recentSalesTable}>
              {cloverRecentSales.map((row) => (
                <div key={row.id} style={styles.recentSalesRow}>
                  <span>{row.event_date ? new Date(row.event_date).toLocaleString() : '—'}</span>
                  <span>${Number(row.amount || 0).toFixed(2)}</span>
                  <span>{row.status || '—'}</span>
                  <span>{row.order_id || row.payment_id || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Payment Settings</h3>

        <div style={styles.setting}>
          <TavariCheckbox
            checked={settings.tip_enabled}
            onChange={(checked) => handleInputChange('tip_enabled', checked)}
            label="Enable tip prompts"
            id="tip-enabled"
            testId="tip-enabled-checkbox"
          />
          <div style={styles.settingDescription}>
            Show tip options during checkout process.
          </div>
        </div>

        <div style={styles.setting}>
          <label style={styles.label}>Default Tip Percentage:</label>
          <div style={styles.inputGroup}>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={settings.default_tip_percent || 0}
              onChange={(e) => handleInputChange('default_tip_percent', parseFloat(e.target.value) || 0)}
              style={styles.input}
            />
            <span style={styles.inputSuffix}>({((settings.default_tip_percent || 0) * 100).toFixed(1)}%)</span>
          </div>
          <div style={styles.settingDescription}>
            Default tip percentage suggested to customers.
          </div>
        </div>

        <div style={styles.setting}>
          <label style={styles.label}>Service Fee:</label>
          <div style={styles.inputGroup}>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={settings.service_fee || 0}
              onChange={(e) => handleInputChange('service_fee', parseFloat(e.target.value) || 0)}
              style={styles.input}
            />
            <span style={styles.inputSuffix}>({((settings.service_fee || 0) * 100).toFixed(1)}%)</span>
          </div>
          <div style={styles.settingDescription}>
            Optional service fee added to all transactions.
          </div>
        </div>

        <div style={styles.setting}>
          <TavariCheckbox
            checked={settings.require_refund_reason}
            onChange={(checked) => handleInputChange('require_refund_reason', checked)}
            label="Require reason for refunds"
            id="require-refund-reason"
            testId="require-refund-reason-checkbox"
          />
          <div style={styles.settingDescription}>
            When enabled, staff must enter a reason when processing refunds for audit purposes.
          </div>
        </div>
      </div>
    </div>
  );
};

const styles = {
  tabContent: {
    padding: TavariStyles.spacing['3xl']
  },
  section: {
    marginBottom: TavariStyles.spacing['3xl']
  },
  sectionTitle: {
    fontSize: TavariStyles.typography.fontSize.xl,
    fontWeight: TavariStyles.typography.fontWeight.bold,
    color: TavariStyles.colors.gray800,
    marginBottom: TavariStyles.spacing.xl,
    paddingBottom: TavariStyles.spacing.md,
    borderBottom: `2px solid ${TavariStyles.colors.primary}`
  },
  helpText: {
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray700,
    marginBottom: TavariStyles.spacing.lg,
    lineHeight: 1.5,
    maxWidth: '720px'
  },
  code: {
    fontSize: TavariStyles.typography.fontSize.xs,
    backgroundColor: TavariStyles.colors.gray100,
    padding: '2px 6px',
    borderRadius: 4
  },
  statusLine: {
    fontSize: TavariStyles.typography.fontSize.sm,
    marginBottom: TavariStyles.spacing.lg,
    color: TavariStyles.colors.gray800
  },
  setting: {
    marginBottom: TavariStyles.spacing.xl
  },
  label: {
    ...TavariStyles.components.form.label
  },
  input: {
    ...TavariStyles.components.form.input,
    width: '120px'
  },
  textInput: {
    ...TavariStyles.components.form.input,
    width: '100%',
    maxWidth: '480px',
    display: 'block'
  },
  inputGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: TavariStyles.spacing.sm
  },
  inputSuffix: {
    fontSize: TavariStyles.typography.fontSize.base,
    color: TavariStyles.colors.gray600
  },
  settingDescription: {
    fontSize: TavariStyles.typography.fontSize.xs,
    color: TavariStyles.colors.gray600,
    marginTop: TavariStyles.spacing.xs,
    fontStyle: 'italic'
  },
  primaryBtn: {
    padding: `${TavariStyles.spacing.sm}px ${TavariStyles.spacing.xl}px`,
    backgroundColor: TavariStyles.colors.primary,
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontWeight: TavariStyles.typography.fontWeight.medium
  },
  dangerBtn: {
    padding: `${TavariStyles.spacing.sm}px ${TavariStyles.spacing.xl}px`,
    backgroundColor: TavariStyles.colors.danger || '#b91c1c',
    color: TavariStyles.colors.white,
    border: 'none',
    borderRadius: TavariStyles.borderRadius.md,
    cursor: 'pointer',
    fontWeight: TavariStyles.typography.fontWeight.medium
  },
  btnDisabled: {
    padding: `${TavariStyles.spacing.sm}px ${TavariStyles.spacing.xl}px`,
    opacity: 0.5,
    cursor: 'not-allowed',
    borderRadius: TavariStyles.borderRadius.md,
    border: `1px solid ${TavariStyles.colors.gray300}`
  },
  subsectionTitle: {
    fontSize: TavariStyles.typography.fontSize.base,
    fontWeight: TavariStyles.typography.fontWeight.medium,
    color: TavariStyles.colors.gray800,
    marginBottom: TavariStyles.spacing.md
  },
  recentSalesTable: {
    display: 'flex',
    flexDirection: 'column',
    gap: TavariStyles.spacing.xs,
    maxWidth: '720px'
  },
  recentSalesRow: {
    display: 'grid',
    gridTemplateColumns: '1.4fr 0.7fr 0.7fr 1.2fr',
    gap: TavariStyles.spacing.sm,
    fontSize: TavariStyles.typography.fontSize.sm,
    color: TavariStyles.colors.gray700,
    padding: `${TavariStyles.spacing.xs}px 0`,
    borderBottom: `1px solid ${TavariStyles.colors.gray200}`
  }
};

export default PaymentsTab;
