import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FiEdit2, FiPlus, FiTrash2, FiArrowLeft } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import bookingPricingPromotionService from '../../services/Bookings/BookingPricingPromotionService';
import {
  BOOKING_PROMOTION_CHANNELS,
  BOOKING_PROMOTION_PRICE_MODES,
  DEFAULT_BOOKING_PRICING_PROMOTION,
  normalizeBookingPricingPromotion,
  normalizePriceAdjustments,
  serializeBookingPricingPromotionForSave,
} from '../../utils/bookingPricingPromotions';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const emptyForm = () => ({
  ...DEFAULT_BOOKING_PRICING_PROMOTION,
  activity_scope: { mode: 'all', category_keys: [], activity_ids: [] },
  price_adjustments: { mode: 'override_prices', items: [] },
});

function toDatetimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocalValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function promotionStatusLabel(promotion) {
  if (!promotion?.is_active) return 'Inactive';
  const now = new Date();
  if (promotion.purchase_starts_at && new Date(promotion.purchase_starts_at) > now) return 'Scheduled';
  if (promotion.purchase_ends_at && new Date(promotion.purchase_ends_at) < now) return 'Expired';
  return 'Active';
}

const BookingPricingPromotionsManager = ({ businessId, onBack, onOpenFreeWithPurchase }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [promotions, setPromotions] = useState([]);
  const [activities, setActivities] = useState([]);
  const [bookingTypes, setBookingTypes] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [newVisitTime, setNewVisitTime] = useState('10:00 AM');

  const loadData = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    bookingPricingPromotionService.setBusinessId(businessId);
    try {
      const [promoRows, activityRows, typeRows, inventoryRows] = await Promise.all([
        bookingPricingPromotionService.getPromotions({ includeInactive: true }),
        supabase
          .from('booking_activities')
          .select('id, activity_name, type_id, is_active')
          .eq('business_id', businessId)
          .order('activity_name'),
        supabase
          .from('booking_types')
          .select('id, type_key, display_name, type_name')
          .eq('business_id', businessId)
          .order('display_name'),
        supabase
          .from('pos_inventory')
          .select('id, name, price, is_active')
          .eq('business_id', businessId)
          .eq('is_active', true)
          .order('name'),
      ]);
      setPromotions(promoRows || []);
      setActivities(activityRows.data || []);
      setBookingTypes(typeRows.data || []);
      setInventoryItems(inventoryRows.data || []);
    } catch (error) {
      console.error('[BookingPricingPromotionsManager] load failed:', error);
      toast.error('Could not load pricing promotions');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const typeKeyById = useMemo(() => {
    const map = new Map();
    (bookingTypes || []).forEach((row) => map.set(row.id, row.type_key));
    return map;
  }, [bookingTypes]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
  };

  const openEdit = (promotion) => {
    const normalized = normalizeBookingPricingPromotion(promotion);
    setEditingId(promotion.id);
    setForm({
      name: normalized.name || '',
      description: normalized.description || '',
      internal_notes: normalized.internal_notes || '',
      is_active: normalized.is_active !== false,
      priority: normalized.priority || 0,
      promo_code: normalized.promo_code || '',
      channel: normalized.channel || 'both',
      activity_scope: normalized.activity_scope || { mode: 'all', category_keys: [], activity_ids: [] },
      purchase_starts_at: toDatetimeLocalValue(normalized.purchase_starts_at),
      purchase_ends_at: toDatetimeLocalValue(normalized.purchase_ends_at),
      visit_start_date: normalized.visit_start_date || '',
      visit_end_date: normalized.visit_end_date || '',
      visit_days_of_week: normalized.visit_days_of_week || [],
      visit_start_time: normalized.visit_start_time || '',
      visit_end_time: normalized.visit_end_time || '',
      visit_times: normalized.visit_times || [],
      visit_blackout_dates: normalized.visit_blackout_dates || [],
      price_adjustments: normalized.price_adjustments || { mode: 'override_prices', items: [] },
      min_tickets: normalized.min_tickets ?? '',
      max_total_redemptions: normalized.max_total_redemptions ?? '',
      max_redemptions_per_customer: normalized.max_redemptions_per_customer ?? '',
      apply_conditional_free_rules: normalized.apply_conditional_free_rules !== false,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!String(form.name || '').trim()) {
      toast.error('Promotion name is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        purchase_starts_at: fromDatetimeLocalValue(form.purchase_starts_at),
        purchase_ends_at: fromDatetimeLocalValue(form.purchase_ends_at),
      };
      if (editingId) {
        await bookingPricingPromotionService.updatePromotion(editingId, payload);
        toast.success('Promotion updated');
      } else {
        await bookingPricingPromotionService.createPromotion(payload);
        toast.success('Promotion created');
      }
      setShowForm(false);
      setEditingId(null);
      await loadData();
    } catch (error) {
      console.error('[BookingPricingPromotionsManager] save failed:', error);
      toast.error(error?.message || 'Could not save promotion');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (promotionId) => {
    if (!window.confirm('Delete this pricing promotion?')) return;
    try {
      await bookingPricingPromotionService.deletePromotion(promotionId);
      toast.success('Promotion deleted');
      await loadData();
    } catch (error) {
      toast.error('Could not delete promotion');
    }
  };

  const updateForm = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const updatePriceItem = (index, patch) => {
    setForm((prev) => {
      const adjustments = normalizePriceAdjustments(prev.price_adjustments);
      const items = [...(adjustments.items || [])];
      items[index] = { ...items[index], ...patch };
      return {
        ...prev,
        price_adjustments: { ...adjustments, items },
      };
    });
  };

  const addPriceItem = () => {
    setForm((prev) => {
      const adjustments = normalizePriceAdjustments(prev.price_adjustments);
      return {
        ...prev,
        price_adjustments: {
          ...adjustments,
          items: [...(adjustments.items || []), { inventory_item_id: '', price: '', percent: '', amount: '' }],
        },
      };
    });
  };

  const removePriceItem = (index) => {
    setForm((prev) => {
      const adjustments = normalizePriceAdjustments(prev.price_adjustments);
      return {
        ...prev,
        price_adjustments: {
          ...adjustments,
          items: (adjustments.items || []).filter((_, i) => i !== index),
        },
      };
    });
  };

  const toggleVisitDay = (day) => {
    setForm((prev) => {
      const current = Array.isArray(prev.visit_days_of_week) ? [...prev.visit_days_of_week] : [];
      const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort();
      return { ...prev, visit_days_of_week: next };
    });
  };

  const addVisitTime = () => {
    const value = String(newVisitTime || '').trim();
    if (!value) return;
    setForm((prev) => ({
      ...prev,
      visit_times: Array.from(new Set([...(prev.visit_times || []), value])),
    }));
    setNewVisitTime('');
  };

  if (showForm) {
    const adjustments = normalizePriceAdjustments(form.price_adjustments);
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <button type="button" onClick={() => setShowForm(false)} style={styles.linkButton}>
            <FiArrowLeft size={16} /> Back
          </button>
          <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>
            {editingId ? 'Edit pricing promotion' : 'New pricing promotion'}
          </h3>
        </div>

        <div style={styles.formGrid}>
          <label style={styles.field}>
            <span>Name *</span>
            <input value={form.name} onChange={(e) => updateForm({ name: e.target.value })} style={styles.input} />
          </label>
          <label style={styles.field}>
            <span>Priority (higher wins)</span>
            <input type="number" value={form.priority} onChange={(e) => updateForm({ priority: e.target.value })} style={styles.input} />
          </label>
          <label style={styles.fieldFull}>
            <span>Description (customer-facing optional)</span>
            <textarea value={form.description} onChange={(e) => updateForm({ description: e.target.value })} style={styles.textarea} rows={2} />
          </label>
          <label style={styles.field}>
            <span>Promo code (optional)</span>
            <input value={form.promo_code} onChange={(e) => updateForm({ promo_code: e.target.value })} placeholder="Leave blank for automatic" style={styles.input} />
          </label>
          <label style={styles.field}>
            <span>Channel</span>
            <select value={form.channel} onChange={(e) => updateForm({ channel: e.target.value })} style={styles.input}>
              {BOOKING_PROMOTION_CHANNELS.map((channel) => (
                <option key={channel} value={channel}>{channel}</option>
              ))}
            </select>
          </label>
          <label style={styles.field}>
            <span>Active</span>
            <select value={form.is_active ? 'yes' : 'no'} onChange={(e) => updateForm({ is_active: e.target.value === 'yes' })} style={styles.input}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
        </div>

        <h4 style={styles.sectionTitle}>When the customer books (purchase window)</h4>
        <div style={styles.formGrid}>
          <label style={styles.field}>
            <span>Purchase starts</span>
            <input type="datetime-local" value={form.purchase_starts_at || ''} onChange={(e) => updateForm({ purchase_starts_at: e.target.value })} style={styles.input} />
          </label>
          <label style={styles.field}>
            <span>Purchase ends</span>
            <input type="datetime-local" value={form.purchase_ends_at || ''} onChange={(e) => updateForm({ purchase_ends_at: e.target.value })} style={styles.input} />
          </label>
        </div>

        <h4 style={styles.sectionTitle}>When the visit happens</h4>
        <div style={styles.formGrid}>
          <label style={styles.field}>
            <span>Visit start date</span>
            <input type="date" value={form.visit_start_date || ''} onChange={(e) => updateForm({ visit_start_date: e.target.value })} style={styles.input} />
          </label>
          <label style={styles.field}>
            <span>Visit end date</span>
            <input type="date" value={form.visit_end_date || ''} onChange={(e) => updateForm({ visit_end_date: e.target.value })} style={styles.input} />
          </label>
        </div>
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Visit days of week</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {DAY_LABELS.map((label, index) => (
              <button
                key={label}
                type="button"
                onClick={() => toggleVisitDay(index)}
                style={{
                  ...styles.dayChip,
                  backgroundColor: (form.visit_days_of_week || []).includes(index) ? TavariStyles.colors.primary : '#f3f4f6',
                  color: (form.visit_days_of_week || []).includes(index) ? '#fff' : '#374151',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={styles.formGrid}>
          <label style={styles.field}>
            <span>Visit time range start</span>
            <input value={form.visit_start_time || ''} onChange={(e) => updateForm({ visit_start_time: e.target.value })} placeholder="10:00 AM" style={styles.input} />
          </label>
          <label style={styles.field}>
            <span>Visit time range end</span>
            <input value={form.visit_end_time || ''} onChange={(e) => updateForm({ visit_end_time: e.target.value })} placeholder="12:00 PM" style={styles.input} />
          </label>
        </div>
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Specific visit times (e.g. 10:00 AM)</div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <input value={newVisitTime} onChange={(e) => setNewVisitTime(e.target.value)} placeholder="10:00 AM" style={{ ...styles.input, flex: 1 }} />
            <button type="button" onClick={addVisitTime} style={styles.secondaryButton}>Add time</button>
          </div>
          {(form.visit_times || []).map((time) => (
            <span key={time} style={styles.tag}>
              {time}
              <button type="button" onClick={() => updateForm({ visit_times: form.visit_times.filter((t) => t !== time) })} style={styles.tagRemove}>×</button>
            </span>
          ))}
        </div>

        <h4 style={styles.sectionTitle}>Activities</h4>
        <div style={styles.formGrid}>
          <label style={styles.field}>
            <span>Scope</span>
            <select
              value={form.activity_scope?.mode || 'all'}
              onChange={(e) => updateForm({ activity_scope: { ...form.activity_scope, mode: e.target.value } })}
              style={styles.input}
            >
              <option value="all">All activities</option>
              <option value="categories">By category</option>
              <option value="activities">Specific activities</option>
            </select>
          </label>
        </div>
        {form.activity_scope?.mode === 'categories' && (
          <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(bookingTypes || []).map((type) => (
              <TavariCheckbox
                key={type.id}
                id={`promo-category-${type.id}`}
                checked={(form.activity_scope?.category_keys || []).includes(type.type_key)}
                onChange={(checked) => {
                  const current = form.activity_scope?.category_keys || [];
                  const next = checked
                    ? [...current, type.type_key]
                    : current.filter((key) => key !== type.type_key);
                  updateForm({ activity_scope: { ...form.activity_scope, category_keys: next } });
                }}
                label={type.display_name || type.type_name || type.type_key}
              />
            ))}
          </div>
        )}
        {form.activity_scope?.mode === 'activities' && (
          <div style={{ marginBottom: '16px', maxHeight: '180px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(activities || []).map((activity) => (
              <TavariCheckbox
                key={activity.id}
                id={`promo-activity-${activity.id}`}
                checked={(form.activity_scope?.activity_ids || []).includes(activity.id)}
                onChange={(checked) => {
                  const current = form.activity_scope?.activity_ids || [];
                  const next = checked
                    ? [...current, activity.id]
                    : current.filter((id) => id !== activity.id);
                  updateForm({ activity_scope: { ...form.activity_scope, activity_ids: next } });
                }}
                label={activity.activity_name}
              />
            ))}
          </div>
        )}

        <h4 style={styles.sectionTitle}>Pricing overrides</h4>
        <div style={styles.formGrid}>
          <label style={styles.field}>
            <span>Adjustment mode</span>
            <select
              value={adjustments.mode}
              onChange={(e) => updateForm({ price_adjustments: { ...adjustments, mode: e.target.value } })}
              style={styles.input}
            >
              {BOOKING_PROMOTION_PRICE_MODES.map((mode) => (
                <option key={mode} value={mode}>{mode.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </label>
          {adjustments.mode === 'flat_package_price' && (
            <label style={styles.field}>
              <span>Flat package price</span>
              <input
                type="number"
                step="0.01"
                value={adjustments.flat_price ?? ''}
                onChange={(e) => updateForm({ price_adjustments: { ...adjustments, flat_price: e.target.value } })}
                style={styles.input}
              />
            </label>
          )}
        </div>
        {(adjustments.items || []).map((row, index) => (
          <div key={`price-item-${index}`} style={styles.priceRow}>
            <select
              value={row.inventory_item_id || ''}
              onChange={(e) => updatePriceItem(index, { inventory_item_id: e.target.value })}
              style={{ ...styles.input, flex: 2 }}
            >
              <option value="">Select ticket / package</option>
              {(inventoryItems || []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} (${Number(item.price || 0).toFixed(2)})
                </option>
              ))}
            </select>
            {adjustments.mode === 'override_prices' && (
              <input type="number" step="0.01" placeholder="Price" value={row.price ?? ''} onChange={(e) => updatePriceItem(index, { price: e.target.value })} style={{ ...styles.input, flex: 1 }} />
            )}
            {adjustments.mode === 'percent_off' && (
              <input type="number" step="0.01" placeholder="Percent off" value={row.percent ?? ''} onChange={(e) => updatePriceItem(index, { percent: e.target.value })} style={{ ...styles.input, flex: 1 }} />
            )}
            {adjustments.mode === 'fixed_off' && (
              <input type="number" step="0.01" placeholder="Amount off" value={row.amount ?? ''} onChange={(e) => updatePriceItem(index, { amount: e.target.value })} style={{ ...styles.input, flex: 1 }} />
            )}
            <button type="button" onClick={() => removePriceItem(index)} style={styles.iconButton}><FiTrash2 size={16} /></button>
          </div>
        ))}
        <button type="button" onClick={addPriceItem} style={{ ...styles.secondaryButton, marginBottom: '16px' }}>
          <FiPlus size={14} /> Add ticket price
        </button>

        <h4 style={styles.sectionTitle}>Limits</h4>
        <div style={styles.formGrid}>
          <label style={styles.field}>
            <span>Minimum tickets</span>
            <input type="number" value={form.min_tickets ?? ''} onChange={(e) => updateForm({ min_tickets: e.target.value })} style={styles.input} />
          </label>
          <label style={styles.field}>
            <span>Max total uses</span>
            <input type="number" value={form.max_total_redemptions ?? ''} onChange={(e) => updateForm({ max_total_redemptions: e.target.value })} style={styles.input} />
          </label>
          <label style={styles.field}>
            <span>Max uses per customer</span>
            <input type="number" value={form.max_redemptions_per_customer ?? ''} onChange={(e) => updateForm({ max_redemptions_per_customer: e.target.value })} style={styles.input} />
          </label>
          <label style={styles.field}>
            <span>Keep free-adult / free-infant rules</span>
            <select
              value={form.apply_conditional_free_rules ? 'yes' : 'no'}
              onChange={(e) => updateForm({ apply_conditional_free_rules: e.target.value === 'yes' })}
              style={styles.input}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
          <button type="button" onClick={() => setShowForm(false)} style={styles.secondaryButton}>Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving} style={styles.primaryButton}>
            {saving ? 'Saving…' : 'Save promotion'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          {onBack && (
            <button type="button" onClick={onBack} style={styles.linkButton}>
              <FiArrowLeft size={16} /> Back
            </button>
          )}
          <h3 style={{ margin: '8px 0 0', fontSize: '20px', fontWeight: 600 }}>Booking pricing promotions</h3>
          <p style={{ margin: '6px 0 0', color: TavariStyles.colors.gray600, fontSize: '14px' }}>
            Override ticket and package prices by visit date, time slot, purchase window, activity, or promo code.
          </p>
        </div>
        <button type="button" onClick={openCreate} style={styles.primaryButton}>
          <FiPlus size={16} /> New promotion
        </button>
      </div>

      {onOpenFreeWithPurchase && (
        <div style={styles.noteCard}>
          Free-with-purchase rules (e.g. one adult free per child) are still managed separately.
          {' '}
          <button type="button" onClick={onOpenFreeWithPurchase} style={styles.linkButtonInline}>
            Open free-with-purchase promotions
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ padding: '24px 0', color: TavariStyles.colors.gray600 }}>Loading promotions…</div>
      ) : promotions.length === 0 ? (
        <div style={styles.emptyState}>No pricing promotions yet. Create one to run specials like $10 at 10am or party early-bird pricing.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {promotions.map((promotion) => {
            const normalized = normalizeBookingPricingPromotion(promotion);
            const status = promotionStatusLabel(normalized);
            return (
              <div key={promotion.id} style={styles.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '16px' }}>{normalized.name}</div>
                    <div style={{ fontSize: '13px', color: TavariStyles.colors.gray600, marginTop: '4px' }}>
                      {status}
                      {normalized.promo_code ? ` · Code ${normalized.promo_code}` : ' · Automatic'}
                      {normalized.visit_times?.length ? ` · Times: ${normalized.visit_times.join(', ')}` : ''}
                      {normalized.priority ? ` · Priority ${normalized.priority}` : ''}
                    </div>
                    {normalized.description && (
                      <div style={{ fontSize: '13px', marginTop: '6px' }}>{normalized.description}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" onClick={() => openEdit(promotion)} style={styles.iconButton}><FiEdit2 size={16} /></button>
                    <button type="button" onClick={() => handleDelete(promotion.id)} style={styles.iconButton}><FiTrash2 size={16} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const styles = {
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '12px',
    marginBottom: '16px',
  },
  field: { display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600 },
  fieldFull: { display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600, gridColumn: '1 / -1' },
  input: {
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '14px',
  },
  textarea: {
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '14px',
    resize: 'vertical',
  },
  sectionTitle: { fontSize: '15px', fontWeight: 600, margin: '8px 0 12px' },
  primaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: TavariStyles.colors.primary,
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 14px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  secondaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: '#f3f4f6',
    color: '#111827',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    padding: '10px 14px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  linkButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    border: 'none',
    background: 'transparent',
    color: TavariStyles.colors.gray600,
    cursor: 'pointer',
    padding: 0,
  },
  linkButtonInline: {
    border: 'none',
    background: 'transparent',
    color: TavariStyles.colors.primary,
    cursor: 'pointer',
    padding: 0,
    textDecoration: 'underline',
  },
  iconButton: {
    border: '1px solid #d1d5db',
    background: '#fff',
    borderRadius: '8px',
    padding: '8px',
    cursor: 'pointer',
  },
  card: {
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    padding: '16px',
    backgroundColor: '#fff',
  },
  emptyState: {
    border: '1px dashed #d1d5db',
    borderRadius: '10px',
    padding: '24px',
    color: TavariStyles.colors.gray600,
    backgroundColor: '#fafafa',
  },
  noteCard: {
    backgroundColor: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: '10px',
    padding: '12px 14px',
    fontSize: '13px',
    marginBottom: '16px',
  },
  dayChip: {
    border: 'none',
    borderRadius: '999px',
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
  },
  tag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    backgroundColor: '#eef2ff',
    color: '#3730a3',
    borderRadius: '999px',
    padding: '4px 10px',
    marginRight: '8px',
    marginBottom: '8px',
    fontSize: '13px',
  },
  tagRemove: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '14px',
    lineHeight: 1,
  },
  priceRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    marginBottom: '8px',
  },
};

export default BookingPricingPromotionsManager;
