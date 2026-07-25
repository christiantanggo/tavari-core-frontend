import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useBusinessContext } from '../../contexts/BusinessContext';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import { usePermissions } from '../../hooks/usePermissions';
import * as DealsService from '../../services/Deals/DealsService';
import { gcStyles as s } from '../GiftCards/giftCardStyles';

const DEAL_TYPES = [
  { id: 'percent_off', label: 'Percent off' },
  { id: 'amount_off', label: 'Amount off' },
  { id: 'bundle', label: 'Bundle' },
  { id: 'fixed_price_bundle', label: 'X items for $Y' },
  { id: 'bogo', label: 'BOGO' },
  { id: 'free_item_voucher', label: 'Free item voucher (printable)' },
  { id: 'buy_x_get_y', label: 'Buy X get Y' },
];

const empty = {
  id: null,
  name: '',
  description: '',
  deal_type: 'percent_off',
  status: 'draft',
  starts_at: '',
  ends_at: '',
  code: '',
  is_printable: true,
  show_on_deals_page: true,
  first_n_limit: '',
  inventory_qty: '1',
  configJson: '{\n  "percent_off": 10\n}',
};

export default function DealsManageScreen() {
  const { selectedBusinessId } = useBusinessContext();
  const { userId } = usePermissions();
  const [deals, setDeals] = useState([]);
  const [form, setForm] = useState(empty);

  const load = useCallback(async () => {
    if (!selectedBusinessId) return;
    setDeals(await DealsService.listDeals(selectedBusinessId));
  }, [selectedBusinessId]);

  useEffect(() => {
    load().catch((err) => toast.error(err.message || 'Failed to load deals'));
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
      await DealsService.upsertDeal(selectedBusinessId, {
        id: form.id || undefined,
        name: form.name,
        description: form.description,
        deal_type: form.deal_type,
        status: form.status,
        starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
        code: form.code || null,
        is_printable: form.is_printable,
        show_on_deals_page: form.show_on_deals_page,
        first_n_limit: form.first_n_limit ? Number(form.first_n_limit) : null,
        inventory_qty: Number(form.inventory_qty) || 1,
        config,
        created_by: userId || null,
      });
      toast.success('Deal saved');
      setForm(empty);
      await load();
    } catch (err) {
      toast.error(err.message || 'Save failed');
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>All deals</h3>
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
            {deals.map((d) => (
              <tr
                key={d.id}
                style={{ cursor: 'pointer' }}
                onClick={() => setForm({
                  id: d.id,
                  name: d.name,
                  description: d.description || '',
                  deal_type: d.deal_type,
                  status: d.status,
                  starts_at: d.starts_at ? d.starts_at.slice(0, 16) : '',
                  ends_at: d.ends_at ? d.ends_at.slice(0, 16) : '',
                  code: d.code || '',
                  is_printable: d.is_printable,
                  show_on_deals_page: d.show_on_deals_page,
                  first_n_limit: d.first_n_limit != null ? String(d.first_n_limit) : '',
                  inventory_qty: String(d.inventory_qty ?? 1),
                  configJson: JSON.stringify(d.config || {}, null, 2),
                })}
              >
                <td style={s.td}>{d.name}</td>
                <td style={s.td}>{d.deal_type}</td>
                <td style={s.td}><span style={s.badge}>{d.status}</span></td>
                <td style={s.td}>
                  {d.starts_at ? new Date(d.starts_at).toLocaleString() : '—'}
                  {' → '}
                  {d.ends_at ? new Date(d.ends_at).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>{form.id ? 'Edit deal' : 'New deal'}</h3>
        <p style={s.muted}>Coupons and free-item vouchers can expire. Prepaid money gift cards belong in Gift Cards.</p>
        <form onSubmit={save}>
          <div style={s.grid2}>
            <div>
              <label style={s.label}>Name</label>
              <input style={s.input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div>
              <label style={s.label}>Type</label>
              <select style={s.select} value={form.deal_type} onChange={(e) => setForm((f) => ({ ...f, deal_type: e.target.value }))}>
                {DEAL_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
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
              <label style={s.label}>Promo code (optional)</label>
              <input style={s.input} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
            </div>
            <div>
              <label style={s.label}>Starts</label>
              <input style={s.input} type="datetime-local" value={form.starts_at} onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))} />
            </div>
            <div>
              <label style={s.label}>Ends</label>
              <input style={s.input} type="datetime-local" value={form.ends_at} onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))} />
            </div>
            <div>
              <label style={s.label}>First N limit</label>
              <input style={s.input} type="number" value={form.first_n_limit} onChange={(e) => setForm((f) => ({ ...f, first_n_limit: e.target.value }))} />
            </div>
            <div>
              <label style={s.label}>Voucher qty (free item)</label>
              <input style={s.input} type="number" value={form.inventory_qty} onChange={(e) => setForm((f) => ({ ...f, inventory_qty: e.target.value }))} />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={s.label}>Description</label>
            <textarea style={{ ...s.input, width: '100%', minHeight: 70 }} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={s.label}>Config JSON</label>
            <textarea
              style={{ ...s.input, width: '100%', minHeight: 120, fontFamily: 'ui-monospace, monospace' }}
              value={form.configJson}
              onChange={(e) => setForm((f) => ({ ...f, configJson: e.target.value }))}
            />
            <p style={s.muted}>Bundle example: {`{"item_qty": 3, "bundle_price": 99}`}</p>
          </div>
          <div style={{ ...s.row, marginTop: 12 }}>
            <TavariCheckbox id="deal-printable" checked={form.is_printable} onChange={(v) => setForm((f) => ({ ...f, is_printable: v }))} label="Printable vouchers" />
            <TavariCheckbox id="deal-show" checked={form.show_on_deals_page} onChange={(v) => setForm((f) => ({ ...f, show_on_deals_page: v }))} label="Show on deals page" />
          </div>
          <div style={{ ...s.row, marginTop: 16 }}>
            <button type="submit" style={s.button}>Save deal</button>
            <button type="button" style={s.buttonSecondary} onClick={() => setForm(empty)}>Clear</button>
          </div>
        </form>
      </div>
    </div>
  );
}
