import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useBusinessContext } from '../../contexts/BusinessContext';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import * as GiftCardService from '../../services/GiftCards/GiftCardService';
import { gcStyles as s } from './giftCardStyles';

const emptyForm = {
  id: null,
  product_type: 'money',
  name: '',
  description: '',
  face_value: '25',
  sale_price: '25',
  inventory_qty: '1',
  is_active: true,
  allow_expiry: false,
  default_expiry_days: '',
  sort_order: '0',
};

export default function GiftCardsProductsScreen() {
  const { selectedBusinessId } = useBusinessContext();
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!selectedBusinessId) return;
    const rows = await GiftCardService.listProducts(selectedBusinessId);
    setProducts(rows);
  }, [selectedBusinessId]);

  useEffect(() => {
    load().catch((err) => toast.error(err.message || 'Failed to load products'));
  }, [load]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await GiftCardService.upsertProduct(selectedBusinessId, {
        id: form.id || undefined,
        product_type: form.product_type,
        name: form.name,
        description: form.description,
        face_value: form.product_type === 'money' ? Number(form.face_value) : Number(form.face_value) || 0,
        sale_price: Number(form.sale_price),
        inventory_qty: Number(form.inventory_qty) || 1,
        is_active: form.is_active,
        allow_expiry: form.allow_expiry,
        default_expiry_days: form.default_expiry_days ? Number(form.default_expiry_days) : null,
        sort_order: Number(form.sort_order) || 0,
      });
      toast.success('Product saved');
      setForm(emptyForm);
      await load();
    } catch (err) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>Denominations & item vouchers</h3>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Name</th>
              <th style={s.th}>Type</th>
              <th style={s.th}>Face</th>
              <th style={s.th}>Sale</th>
              <th style={s.th}>Active</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setForm({
                id: p.id,
                product_type: p.product_type,
                name: p.name,
                description: p.description || '',
                face_value: String(p.face_value ?? ''),
                sale_price: String(p.sale_price ?? ''),
                inventory_qty: String(p.inventory_qty ?? 1),
                is_active: p.is_active,
                allow_expiry: p.allow_expiry,
                default_expiry_days: p.default_expiry_days != null ? String(p.default_expiry_days) : '',
                sort_order: String(p.sort_order ?? 0),
              })}>
                <td style={s.td}>{p.name}</td>
                <td style={s.td}>{p.product_type}</td>
                <td style={s.td}>${Number(p.face_value || 0).toFixed(2)}</td>
                <td style={s.td}>${Number(p.sale_price || 0).toFixed(2)}</td>
                <td style={s.td}>{p.is_active ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>{form.id ? 'Edit product' : 'New product'}</h3>
        <form onSubmit={save}>
          <div style={s.grid2}>
            <div>
              <label style={s.label}>Name</label>
              <input style={s.input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div>
              <label style={s.label}>Type</label>
              <select style={s.select} value={form.product_type} onChange={(e) => setForm((f) => ({ ...f, product_type: e.target.value }))}>
                <option value="money">Money</option>
                <option value="item">Item / service</option>
              </select>
            </div>
            <div>
              <label style={s.label}>Face value</label>
              <input style={s.input} type="number" step="0.01" value={form.face_value} onChange={(e) => setForm((f) => ({ ...f, face_value: e.target.value }))} />
            </div>
            <div>
              <label style={s.label}>Sale price</label>
              <input style={s.input} type="number" step="0.01" value={form.sale_price} onChange={(e) => setForm((f) => ({ ...f, sale_price: e.target.value }))} />
            </div>
            {form.product_type === 'item' && (
              <div>
                <label style={s.label}>Qty on voucher</label>
                <input style={s.input} type="number" min="1" value={form.inventory_qty} onChange={(e) => setForm((f) => ({ ...f, inventory_qty: e.target.value }))} />
              </div>
            )}
            <div>
              <label style={s.label}>Default expiry days (item/charity)</label>
              <input style={s.input} type="number" min="1" value={form.default_expiry_days} onChange={(e) => setForm((f) => ({ ...f, default_expiry_days: e.target.value }))} />
            </div>
          </div>
          <div style={{ ...s.row, marginTop: 12 }}>
            <TavariCheckbox id="product-active" checked={form.is_active} onChange={(v) => setForm((f) => ({ ...f, is_active: v }))} label="Active" />
            <TavariCheckbox id="product-expiry" checked={form.allow_expiry} onChange={(v) => setForm((f) => ({ ...f, allow_expiry: v }))} label="Allow expiry on this product" />
          </div>
          <div style={{ ...s.row, marginTop: 16 }}>
            <button type="submit" style={s.button} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" style={s.buttonSecondary} onClick={() => setForm(emptyForm)}>Clear</button>
          </div>
        </form>
      </div>
    </div>
  );
}
