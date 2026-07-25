import React, { useState, useEffect } from 'react';
import { FiX, FiSave, FiRefreshCw } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import toast from 'react-hot-toast';

function centsToDollars(cents) {
  const n = Number(cents) || 0;
  return (n / 100).toFixed(2);
}

function dollarsToCents(str) {
  const n = parseFloat(String(str).replace(/[^0-9.-]/g, ''));
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.round(n * 100));
}

const TOSAModuleBillingModal = ({ module, onClose, onSaved }) => {
  const [baseDollars, setBaseDollars] = useState('0.00');
  const [seatDollars, setSeatDollars] = useState('0.00');
  const [includedSeats, setIncludedSeats] = useState('0');
  const [unlimitedIncluded, setUnlimitedIncluded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!module) return;
    setBaseDollars(centsToDollars(module.billing_base_cents ?? 0));
    setSeatDollars(centsToDollars(module.billing_seat_cents ?? 0));
    const inc = module.billing_included_seats ?? 0;
    if (inc === -1) {
      setUnlimitedIncluded(true);
      setIncludedSeats('0');
    } else {
      setUnlimitedIncluded(false);
      setIncludedSeats(String(inc));
    }
  }, [module]);

  if (!module) return null;

  const handleSave = async () => {
    try {
      setSaving(true);
      const included = unlimitedIncluded ? -1 : Math.max(0, parseInt(includedSeats, 10) || 0);
      const { error } = await supabase
        .from('app_modules')
        .update({
          billing_base_cents: dollarsToCents(baseDollars),
          billing_seat_cents: dollarsToCents(seatDollars),
          billing_included_seats: included,
        })
        .eq('module_key', module.module_key);

      if (error) throw error;
      toast.success('Module billing saved');
      onSaved?.();
      onClose?.();
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncStripe = async () => {
    try {
      setSyncing(true);
      const { data, error } = await supabase.functions.invoke('stripe-sync-module-prices', {
        body: { module_key: module.module_key },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Stripe prices synced (${data?.synced ?? 0} module(s))`);
      onSaved?.();
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'Stripe sync failed (requires Tavari staff session or Stripe keys)');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={overlay}>
      <div style={modal}>
        <div style={header}>
          <h2 style={title}>Billing: {module.module_name}</h2>
          <button type="button" style={iconBtn} onClick={onClose} aria-label="Close">
            <FiX size={22} />
          </button>
        </div>
        <p style={hint}>
          CAD, monthly. Every module uses <strong>base + per-seat</strong> in Stripe; set seat price to $0.00 when seats
          are free. Included seats: first N users with module access are not charged the per-seat rate. Check
          &quot;Unlimited included&quot; to waive all seat charges (billable seats = 0).
        </p>
        <div style={field}>
          <label style={label}>Base price (CAD / month)</label>
          <input
            type="text"
            value={baseDollars}
            onChange={(e) => setBaseDollars(e.target.value)}
            style={input}
          />
        </div>
        <div style={field}>
          <label style={label}>Per-seat price (CAD / month)</label>
          <input
            type="text"
            value={seatDollars}
            onChange={(e) => setSeatDollars(e.target.value)}
            style={input}
          />
        </div>
        <div style={field}>
          <label style={label}>Included seats (before per-seat billing)</label>
          <input
            type="number"
            min={0}
            disabled={unlimitedIncluded}
            value={includedSeats}
            onChange={(e) => setIncludedSeats(e.target.value)}
            style={input}
          />
          <label style={checkRow}>
            <input
              type="checkbox"
              checked={unlimitedIncluded}
              onChange={(e) => setUnlimitedIncluded(e.target.checked)}
            />
            <span>Unlimited included (no seat charges)</span>
          </label>
        </div>
        <div style={stripeMeta}>
          <div>Stripe product: {module.stripe_product_id || '—'}</div>
          <div>Base price id: {module.stripe_base_price_id || '—'}</div>
          <div>Seat price id: {module.stripe_seat_price_id || '—'}</div>
        </div>
        <div style={actions}>
          <button type="button" style={secondary} onClick={onClose}>
            Cancel
          </button>
          <button type="button" style={secondary} onClick={handleSyncStripe} disabled={syncing || saving}>
            <FiRefreshCw style={{ marginRight: 6 }} />
            {syncing ? 'Syncing…' : 'Push to Stripe'}
          </button>
          <button type="button" style={primary} onClick={handleSave} disabled={saving || syncing}>
            <FiSave style={{ marginRight: 6 }} />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

const overlay = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(15, 23, 42, 0.45)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const modal = {
  backgroundColor: '#fff',
  borderRadius: TavariStyles.borderRadius.lg,
  maxWidth: 520,
  width: '100%',
  maxHeight: '90vh',
  overflowY: 'auto',
  padding: TavariStyles.spacing.xl,
  boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
};

const header = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginBottom: TavariStyles.spacing.md,
};

const title = {
  margin: 0,
  fontSize: 20,
  fontWeight: 700,
  color: TavariStyles.colors.gray900,
};

const iconBtn = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: TavariStyles.colors.gray500,
};

const hint = {
  fontSize: 13,
  color: TavariStyles.colors.gray600,
  lineHeight: 1.5,
  marginBottom: TavariStyles.spacing.lg,
};

const field = { marginBottom: TavariStyles.spacing.md };

const label = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 6,
  color: TavariStyles.colors.gray700,
};

const input = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: TavariStyles.borderRadius.md,
  border: `1px solid ${TavariStyles.colors.border}`,
  fontSize: 14,
};

const checkRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 8,
  fontSize: 13,
  color: TavariStyles.colors.gray700,
  cursor: 'pointer',
};

const stripeMeta = {
  fontSize: 11,
  fontFamily: 'monospace',
  color: TavariStyles.colors.gray500,
  backgroundColor: TavariStyles.colors.gray50,
  padding: TavariStyles.spacing.sm,
  borderRadius: TavariStyles.borderRadius.md,
  marginBottom: TavariStyles.spacing.lg,
  lineHeight: 1.5,
};

const actions = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  justifyContent: 'flex-end',
};

const primary = {
  padding: '10px 16px',
  borderRadius: TavariStyles.borderRadius.md,
  border: 'none',
  backgroundColor: TavariStyles.colors.primary,
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
};

const secondary = {
  padding: '10px 16px',
  borderRadius: TavariStyles.borderRadius.md,
  border: `1px solid ${TavariStyles.colors.border}`,
  backgroundColor: '#fff',
  color: TavariStyles.colors.gray800,
  fontWeight: 500,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
};

export default TOSAModuleBillingModal;
