import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import * as GiftCardService from '../../services/GiftCards/GiftCardService';
import { gcStyles as s } from './giftCardStyles';

const PROMO_TYPES = [
  { id: 'price_override', label: 'Buy $X card for $Y' },
  { id: 'percent_off', label: 'Percent off gift card purchase' },
  { id: 'bonus_face_value', label: 'Bonus face value (pay $100 get $120)' },
  { id: 'bogo_multi', label: 'Multi-pack / BOGO' },
  { id: 'item_gets_gift_card', label: 'Buy item → free gift card' },
  { id: 'gift_card_gets_item', label: 'Buy gift card → free item' },
  { id: 'first_n', label: 'First N purchases' },
  { id: 'burn_bonus', label: 'Burn campaign (extra credit on redeem)' },
];

const empty = {
  id: null,
  name: '',
  promo_type: 'price_override',
  status: 'draft',
  starts_at: '',
  ends_at: '',
  first_n_limit: '',
  configJson: '{\n  "face_value": 25,\n  "sale_price": 20\n}',
};

export default function GiftCardsPromotionsScreen() {
  const { selectedBusinessId } = useBusinessContext();
  const { userId } = usePermissions();
  const [promos, setPromos] = useState([]);
  const [form, setForm] = useState(empty);
  const [ctaUrl, setCtaUrl] = useState('');

  const load = useCallback(async () => {
    if (!selectedBusinessId) return;
    setPromos(await GiftCardService.listPromotions(selectedBusinessId));
    setCtaUrl(GiftCardService.buildGiftCardPurchaseUrl(selectedBusinessId));
  }, [selectedBusinessId]);

  useEffect(() => {
    load().catch((err) => toast.error(err.message || 'Failed to load promos'));
  }, [load]);

  const save = async (e) => {
    e.preventDefault();
    let config = {};
    try {
      config = JSON.parse(form.configJson || '{}');
    } catch {
      toast.error('Config must be valid JSON');
      return;
    }
    try {
      const saved = await GiftCardService.upsertPromotion(selectedBusinessId, {
        id: form.id || undefined,
        name: form.name,
        promo_type: form.promo_type,
        status: form.status,
        starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
        first_n_limit: form.first_n_limit ? Number(form.first_n_limit) : null,
        config,
        created_by: userId || null,
      });
      toast.success('Promotion saved');
      setForm({
        ...empty,
        id: saved.id,
        name: saved.name,
        promo_type: saved.promo_type,
        status: saved.status,
      });
      await load();
      setCtaUrl(GiftCardService.buildGiftCardPurchaseUrl(selectedBusinessId, { promoId: saved.id }));
    } catch (err) {
      toast.error(err.message || 'Save failed');
    }
  };

  return (
    <div>
      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>Marketing purchase CTA</h3>
        <p style={s.muted}>Paste this link into marketing emails so customers can buy gift cards online.</p>
        <div style={s.row}>
          <input style={{ ...s.input, flex: 1, minWidth: 280 }} readOnly value={ctaUrl} />
          <button
            type="button"
            style={s.buttonSecondary}
            onClick={() => {
              navigator.clipboard?.writeText(ctaUrl);
              toast.success('CTA link copied');
            }}
          >
            Copy link
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={s.panel}>
          <h3 style={{ marginTop: 0 }}>Promotions</h3>
          {promos.length === 0 ? (
            <div style={s.empty}>No promotions yet.</div>
          ) : (
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Name</th>
                  <th style={s.th}>Type</th>
                  <th style={s.th}>Status</th>
                  <th style={s.th}>Window</th>
                </tr>
              </thead>
              <tbody>
                {promos.map((p) => (
                  <tr
                    key={p.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setForm({
                      id: p.id,
                      name: p.name,
                      promo_type: p.promo_type,
                      status: p.status,
                      starts_at: p.starts_at ? p.starts_at.slice(0, 16) : '',
                      ends_at: p.ends_at ? p.ends_at.slice(0, 16) : '',
                      first_n_limit: p.first_n_limit != null ? String(p.first_n_limit) : '',
                      configJson: JSON.stringify(p.config || {}, null, 2),
                    })}
                  >
                    <td style={s.td}>{p.name}</td>
                    <td style={s.td}>{p.promo_type}</td>
                    <td style={s.td}><span style={s.badge}>{p.status}</span></td>
                    <td style={s.td}>
                      {p.starts_at ? new Date(p.starts_at).toLocaleString() : '—'}
                      {' → '}
                      {p.ends_at ? new Date(p.ends_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={s.panel}>
          <h3 style={{ marginTop: 0 }}>{form.id ? 'Edit promotion' : 'New promotion'}</h3>
          <form onSubmit={save}>
            <div style={s.grid2}>
              <div>
                <label style={s.label}>Name</label>
                <input style={s.input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div>
                <label style={s.label}>Type</label>
                <select style={s.select} value={form.promo_type} onChange={(e) => setForm((f) => ({ ...f, promo_type: e.target.value }))}>
                  {PROMO_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label style={s.label}>Status</label>
                <select style={s.select} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                  <option value="draft">Draft</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="active">Active</option>
                  <option value="ended">Ended</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div>
                <label style={s.label}>First N limit</label>
                <input style={s.input} type="number" min="1" value={form.first_n_limit} onChange={(e) => setForm((f) => ({ ...f, first_n_limit: e.target.value }))} />
              </div>
              <div>
                <label style={s.label}>Starts</label>
                <input style={s.input} type="datetime-local" value={form.starts_at} onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))} />
              </div>
              <div>
                <label style={s.label}>Ends</label>
                <input style={s.input} type="datetime-local" value={form.ends_at} onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))} />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={s.label}>Config (JSON)</label>
              <textarea
                style={{ ...s.input, width: '100%', minHeight: 140, fontFamily: 'ui-monospace, monospace' }}
                value={form.configJson}
                onChange={(e) => setForm((f) => ({ ...f, configJson: e.target.value }))}
              />
              <p style={s.muted}>
                Burn bonus example: {`{"bonus_percent": 10}`} or {`{"bonus_amount": 5}`}. Price override: {`{"face_value":25,"sale_price":20}`}.
              </p>
            </div>
            <div style={{ ...s.row, marginTop: 16 }}>
              <button type="submit" style={s.button}>Save promotion</button>
              <button type="button" style={s.buttonSecondary} onClick={() => setForm(empty)}>Clear</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
