import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useBusinessContext } from '../../contexts/BusinessContext';
import TavariCheckbox from '../../components/UI/TavariCheckbox';
import * as GiftCardService from '../../services/GiftCards/GiftCardService';
import { gcStyles as s } from './giftCardStyles';

const empty = {
  id: null,
  name: 'Custom design',
  is_default: false,
  uses_business_logo: true,
  background_color: '#0f766e',
  text_color: '#ffffff',
  accent_color: '#14b8a6',
  custom_image_url: '',
};

export default function GiftCardsDesignsScreen() {
  const { selectedBusinessId } = useBusinessContext();
  const [designs, setDesigns] = useState([]);
  const [form, setForm] = useState(empty);

  const load = useCallback(async () => {
    if (!selectedBusinessId) return;
    setDesigns(await GiftCardService.listDesigns(selectedBusinessId));
  }, [selectedBusinessId]);

  useEffect(() => {
    load().catch((err) => toast.error(err.message || 'Failed to load designs'));
  }, [load]);

  const save = async (e) => {
    e.preventDefault();
    try {
      await GiftCardService.upsertDesign(selectedBusinessId, {
        id: form.id || undefined,
        name: form.name,
        is_default: form.is_default,
        uses_business_logo: form.uses_business_logo,
        background_color: form.background_color,
        text_color: form.text_color,
        accent_color: form.accent_color,
        custom_image_url: form.custom_image_url || null,
      });
      toast.success('Design saved');
      setForm(empty);
      await load();
    } catch (err) {
      toast.error(err.message || 'Save failed');
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>Designs</h3>
        <div style={{ display: 'grid', gap: 12 }}>
          {designs.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setForm({
                id: d.id,
                name: d.name,
                is_default: d.is_default,
                uses_business_logo: d.uses_business_logo,
                background_color: d.background_color,
                text_color: d.text_color,
                accent_color: d.accent_color,
                custom_image_url: d.custom_image_url || '',
              })}
              style={{
                textAlign: 'left',
                border: '1px solid #e5e7eb',
                borderRadius: 12,
                padding: 16,
                background: d.background_color,
                color: d.text_color,
                cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 700 }}>{d.name}{d.is_default ? ' (default)' : ''}</div>
              <div style={{ opacity: 0.85, marginTop: 8 }}>$50 Gift Card</div>
              {d.custom_image_url && <div style={{ fontSize: 13, marginTop: 8 }}>Custom graphic set</div>}
            </button>
          ))}
        </div>
      </div>

      <div style={s.panel}>
        <h3 style={{ marginTop: 0 }}>{form.id ? 'Edit design' : 'New design'}</h3>
        <p style={s.muted}>Default style uses the business logo. Upload a graphic URL for a custom look.</p>
        <form onSubmit={save}>
          <div style={s.grid2}>
            <div>
              <label style={s.label}>Name</label>
              <input style={s.input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div>
              <label style={s.label}>Background</label>
              <input style={s.input} type="color" value={form.background_color} onChange={(e) => setForm((f) => ({ ...f, background_color: e.target.value }))} />
            </div>
            <div>
              <label style={s.label}>Text</label>
              <input style={s.input} type="color" value={form.text_color} onChange={(e) => setForm((f) => ({ ...f, text_color: e.target.value }))} />
            </div>
            <div>
              <label style={s.label}>Accent</label>
              <input style={s.input} type="color" value={form.accent_color} onChange={(e) => setForm((f) => ({ ...f, accent_color: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={s.label}>Custom graphic URL</label>
              <input style={s.input} value={form.custom_image_url} onChange={(e) => setForm((f) => ({ ...f, custom_image_url: e.target.value }))} placeholder="https://…" />
            </div>
          </div>
          <div style={{ ...s.row, marginTop: 12 }}>
            <TavariCheckbox id="design-logo" checked={form.uses_business_logo} onChange={(v) => setForm((f) => ({ ...f, uses_business_logo: v }))} label="Use business logo" />
            <TavariCheckbox id="design-default" checked={form.is_default} onChange={(v) => setForm((f) => ({ ...f, is_default: v }))} label="Default design" />
          </div>
          <div style={{ ...s.row, marginTop: 16 }}>
            <button type="submit" style={s.button}>Save design</button>
            <button type="button" style={s.buttonSecondary} onClick={() => setForm(empty)}>Clear</button>
          </div>
        </form>
      </div>
    </div>
  );
}
