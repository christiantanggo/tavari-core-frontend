import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useBusinessContext } from '../../contexts/BusinessContext';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { usePermissions } from '../../hooks/usePermissions';
import { supabase } from '../../supabaseClient';
import * as GiftCardService from '../../services/GiftCards/GiftCardService';
import { gcStyles as s } from './giftCardStyles';

export default function GiftCardsSettingsScreen() {
  const { selectedBusinessId } = useBusinessContext();
  const { userId } = usePermissions();
  const [settings, setSettings] = useState(null);
  const [links, setLinks] = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [partnerId, setPartnerId] = useState('');
  const [feePercent, setFeePercent] = useState('0');

  const load = useCallback(async () => {
    if (!selectedBusinessId) return;
    await GiftCardService.bootstrapGiftCards(selectedBusinessId);
    const [st, ln, biz] = await Promise.all([
      GiftCardService.getSettings(selectedBusinessId),
      GiftCardService.listBusinessLinks(selectedBusinessId),
      supabase.from('businesses').select('id, name').neq('id', selectedBusinessId).order('name'),
    ]);
    setSettings(st);
    setLinks(ln);
    setBusinesses(biz.data || []);
  }, [selectedBusinessId]);

  useEffect(() => {
    load().catch((err) => toast.error(err.message || 'Failed to load settings'));
  }, [load]);

  const save = async (e) => {
    e.preventDefault();
    try {
      const saved = await GiftCardService.saveSettings(selectedBusinessId, {
        allow_custom_amount: settings.allow_custom_amount,
        min_custom_amount: Number(settings.min_custom_amount),
        max_custom_amount: Number(settings.max_custom_amount),
        never_expire_money_cards: settings.never_expire_money_cards,
        default_expiry_days: settings.default_expiry_days ? Number(settings.default_expiry_days) : null,
        allow_cross_business: settings.allow_cross_business,
        notify_recipient_default: settings.notify_recipient_default,
        tax_at_redemption_only: settings.tax_at_redemption_only,
      });
      setSettings(saved);
      await GiftCardService.ensurePosGiftCardsCategory(selectedBusinessId);
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err.message || 'Save failed');
    }
  };

  const requestLink = async () => {
    if (!partnerId) {
      toast.error('Select a business');
      return;
    }
    try {
      await GiftCardService.requestBusinessLink({
        issuerBusinessId: selectedBusinessId,
        partnerBusinessId: partnerId,
        requestedBy: userId || null,
        settlementFeePercent: Number(feePercent) || 0,
      });
      toast.success('Cross-business request sent — partner must approve');
      setPartnerId('');
      await load();
    } catch (err) {
      toast.error(err.message || 'Request failed');
    }
  };

  const respond = async (linkId, status) => {
    try {
      await GiftCardService.respondBusinessLink({
        linkId,
        status,
        respondedBy: userId || null,
      });
      toast.success(`Link ${status}`);
      await load();
    } catch (err) {
      toast.error(err.message || 'Update failed');
    }
  };

  if (!settings) return <div style={s.empty}>Loading settings…</div>;

  return (
    <div>
      <form style={s.panel} onSubmit={save}>
        <h3 style={{ marginTop: 0 }}>Gift card settings</h3>
        <div style={s.grid2}>
          <div>
            <label style={s.label}>Min custom amount</label>
            <input
              style={s.input}
              type="number"
              value={settings.min_custom_amount}
              onChange={(e) => setSettings((st) => ({ ...st, min_custom_amount: e.target.value }))}
            />
          </div>
          <div>
            <label style={s.label}>Max custom amount</label>
            <input
              style={s.input}
              type="number"
              value={settings.max_custom_amount}
              onChange={(e) => setSettings((st) => ({ ...st, max_custom_amount: e.target.value }))}
            />
          </div>
          <div>
            <label style={s.label}>Default expiry days (when expiry allowed)</label>
            <input
              style={s.input}
              type="number"
              value={settings.default_expiry_days || ''}
              onChange={(e) => setSettings((st) => ({ ...st, default_expiry_days: e.target.value }))}
            />
          </div>
        </div>
        <div style={{ ...s.row, marginTop: 12 }}>
          <TavariCheckbox
            id="allow-custom"
            checked={!!settings.allow_custom_amount}
            onChange={(v) => setSettings((st) => ({ ...st, allow_custom_amount: v }))}
            label="Allow custom amounts"
          />
          <TavariCheckbox
            id="never-expire"
            checked={!!settings.never_expire_money_cards}
            onChange={(v) => setSettings((st) => ({ ...st, never_expire_money_cards: v }))}
            label="Money gift cards never expire (Ontario default)"
          />
          <TavariCheckbox
            id="tax-redemption"
            checked={!!settings.tax_at_redemption_only}
            onChange={(v) => setSettings((st) => ({ ...st, tax_at_redemption_only: v }))}
            label="Tax only at redemption"
          />
          <TavariCheckbox
            id="notify-default"
            checked={!!settings.notify_recipient_default}
            onChange={(v) => setSettings((st) => ({ ...st, notify_recipient_default: v }))}
            label="Notify recipient by default"
          />
          <TavariCheckbox
            id="cross-biz"
            checked={!!settings.allow_cross_business}
            onChange={(v) => setSettings((st) => ({ ...st, allow_cross_business: v }))}
            label="Allow cross-business network"
          />
        </div>
        <p style={{ ...s.muted, marginTop: 12 }}>
          Permissions for sell / redeem / void / reprint / settings are configured in Settings → Roles (Gift Cards section).
          Map gift card liability GL in Accounting → Settings.
        </p>
        <button type="submit" style={{ ...s.button, marginTop: 12 }}>Save settings</button>
      </form>

      {settings.allow_cross_business && (
        <div style={s.panel}>
          <h3 style={{ marginTop: 0 }}>Cross-business acceptance</h3>
          <p style={s.muted}>
            Your cards stay on your liability. When a partner redeems them, a settlement payable is created (issuer owes redeemer).
          </p>
          <div style={s.row}>
            <select style={s.select} value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">Select partner business…</option>
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <input
              style={{ ...s.input, width: 120 }}
              type="number"
              min="0"
              step="0.01"
              value={feePercent}
              onChange={(e) => setFeePercent(e.target.value)}
              title="Settlement fee %"
              placeholder="Fee %"
            />
            <button type="button" style={s.button} onClick={requestLink}>Request approval</button>
          </div>

          <table style={{ ...s.table, marginTop: 16 }}>
            <thead>
              <tr>
                <th style={s.th}>Issuer</th>
                <th style={s.th}>Partner</th>
                <th style={s.th}>Status</th>
                <th style={s.th}>Fee %</th>
                <th style={s.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.id}>
                  <td style={s.td}>{link.issuer_business_id === selectedBusinessId ? 'You' : link.issuer_business_id.slice(0, 8)}</td>
                  <td style={s.td}>{link.partner_business_id === selectedBusinessId ? 'You' : link.partner_business_id.slice(0, 8)}</td>
                  <td style={s.td}><span style={s.badge}>{link.status}</span></td>
                  <td style={s.td}>{link.settlement_fee_percent}%</td>
                  <td style={s.td}>
                    {link.partner_business_id === selectedBusinessId && link.status === 'pending' && (
                      <div style={s.row}>
                        <button type="button" style={s.button} onClick={() => respond(link.id, 'approved')}>Approve</button>
                        <button type="button" style={s.buttonDanger} onClick={() => respond(link.id, 'rejected')}>Reject</button>
                      </div>
                    )}
                    {link.issuer_business_id === selectedBusinessId && link.status === 'approved' && (
                      <button type="button" style={s.buttonDanger} onClick={() => respond(link.id, 'revoked')}>Revoke</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
