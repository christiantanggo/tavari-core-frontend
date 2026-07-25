import React, { useCallback, useEffect, useState } from 'react';
import { FiPlus, FiTrash2, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import {
  ACTIVITY_TAB_BLOCK_TYPES,
  createCakeReceiptsTabPreset,
  createEmptyActivityTab,
  createEmptyContentBlock,
  createEmptyReminder,
  normalizeActivityTab,
  serializeActivityTabForSave,
} from '../../helpers/Bookings/bookingActivityTabs';

/**
 * Settings editor: Additional tabs for a booking activity.
 */
export default function BookingActivityAdditionalTabsEditor({
  businessId,
  activityId,
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tabs, setTabs] = useState([]);
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async () => {
    if (!businessId || !activityId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('booking_activity_tabs')
        .select('*')
        .eq('business_id', businessId)
        .eq('activity_id', activityId)
        .order('display_order', { ascending: true });
      if (error) throw error;
      const normalized = (data || []).map((row) => normalizeActivityTab(row)).filter(Boolean);
      setTabs(normalized);
      if (normalized[0]?.id) setExpandedId(normalized[0].id);
    } catch (error) {
      console.error('[BookingActivityAdditionalTabsEditor] load failed:', error);
      toast.error(error?.message || 'Could not load additional tabs');
      setTabs([]);
    } finally {
      setLoading(false);
    }
  }, [businessId, activityId]);

  useEffect(() => {
    load();
  }, [load]);

  const updateTab = (index, patch) => {
    setTabs((prev) => prev.map((tab, i) => (i === index ? { ...tab, ...patch } : tab)));
  };

  const updateBlock = (tabIndex, blockIndex, patch) => {
    setTabs((prev) => prev.map((tab, i) => {
      if (i !== tabIndex) return tab;
      const content_blocks = (tab.content_blocks || []).map((block, bi) => (
        bi === blockIndex ? { ...block, ...patch } : block
      ));
      return { ...tab, content_blocks };
    }));
  };

  const addTab = (preset = null) => {
    const next = preset
      ? { ...preset, id: `local-${Date.now()}`, activity_id: activityId, business_id: businessId }
      : createEmptyActivityTab({
        id: `local-${Date.now()}`,
        activity_id: activityId,
        business_id: businessId,
        label: `Tab ${(tabs.length || 0) + 1}`,
        tab_key: `tab-${Date.now()}`,
      });
    setTabs((prev) => [...prev, next]);
    setExpandedId(next.id);
  };

  const removeTab = (index) => {
    const tab = tabs[index];
    if (!window.confirm(`Remove tab “${tab?.label || 'Tab'}”?`)) return;
    setTabs((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!businessId || !activityId) return;
    setSaving(true);
    try {
      const { data: existing, error: existingError } = await supabase
        .from('booking_activity_tabs')
        .select('id')
        .eq('business_id', businessId)
        .eq('activity_id', activityId);
      if (existingError) throw existingError;

      const keepIds = new Set(
        tabs.map((tab) => tab.id).filter((id) => id && !String(id).startsWith('local-')),
      );
      const toDelete = (existing || []).map((row) => row.id).filter((id) => !keepIds.has(id));
      if (toDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from('booking_activity_tabs')
          .delete()
          .in('id', toDelete);
        if (deleteError) throw deleteError;
      }

      for (let i = 0; i < tabs.length; i += 1) {
        const tab = tabs[i];
        const payload = serializeActivityTabForSave(tab, {
          businessId,
          activityId,
          displayOrder: i,
        });
        if (!payload) continue;
        const isLocal = !tab.id || String(tab.id).startsWith('local-');
        if (isLocal) {
          const { id: _omit, ...insertPayload } = payload;
          const { data: inserted, error } = await supabase
            .from('booking_activity_tabs')
            .insert({ ...insertPayload, created_at: new Date().toISOString() })
            .select('*')
            .single();
          if (error) throw error;
          tabs[i] = normalizeActivityTab(inserted);
        } else {
          const { error } = await supabase
            .from('booking_activity_tabs')
            .update(payload)
            .eq('id', tab.id)
            .eq('business_id', businessId);
          if (error) throw error;
        }
      }

      toast.success('Additional tabs saved');
      await load();
    } catch (error) {
      console.error('[BookingActivityAdditionalTabsEditor] save failed:', error);
      toast.error(error?.message || 'Could not save additional tabs');
    } finally {
      setSaving(false);
    }
  };

  if (!activityId) {
    return (
      <div style={{ color: TavariStyles.colors.gray600, fontSize: 14 }}>
        Save the activity first, then configure additional tabs.
      </div>
    );
  }

  if (loading) {
    return <div style={{ color: TavariStyles.colors.gray600 }}>Loading additional tabs…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>Additional tabs</h3>
        <p style={{ margin: 0, fontSize: 14, color: TavariStyles.colors.gray600, lineHeight: 1.5 }}>
          Add custom tabs on booking details and the customer manage-booking page.
          Use headers, text, links, checklists, file uploads, and optional customer/staff reminder windows.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => addTab()} style={styles.secondaryBtn}>
          <FiPlus size={14} /> Add tab
        </button>
        <button type="button" onClick={() => addTab(createCakeReceiptsTabPreset())} style={styles.secondaryBtn}>
          <FiPlus size={14} /> Add Cake receipts tab
        </button>
        <button type="button" onClick={handleSave} disabled={saving} style={styles.primaryBtn}>
          {saving ? 'Saving…' : 'Save additional tabs'}
        </button>
      </div>

      {tabs.length === 0 ? (
        <div style={styles.empty}>
          No additional tabs yet. Add one for cake receipts, packing lists, or other booking info.
        </div>
      ) : tabs.map((tab, tabIndex) => {
        const expandKey = tab.id || `idx-${tabIndex}`;
        const expanded = expandedId === expandKey || expandedId === tab.id;
        return (
          <div key={expandKey} style={styles.card}>
            <div style={styles.cardHeader}>
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : expandKey)}
                style={styles.expandBtn}
              >
                {expanded ? <FiChevronUp size={16} /> : <FiChevronDown size={16} />}
                <strong>{tab.label || 'Untitled tab'}</strong>
              </button>
              <button type="button" onClick={() => removeTab(tabIndex)} style={styles.iconBtn} aria-label="Remove tab">
                <FiTrash2 size={14} />
              </button>
            </div>

            {expanded ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
                <div style={styles.row2}>
                  <label style={styles.field}>
                    <span style={styles.fieldLabel}>Tab label</span>
                    <input
                      value={tab.label}
                      onChange={(e) => updateTab(tabIndex, { label: e.target.value })}
                      style={styles.input}
                    />
                  </label>
                  <label style={styles.field}>
                    <span style={styles.fieldLabel}>Internal key</span>
                    <input
                      value={tab.tab_key}
                      onChange={(e) => updateTab(tabIndex, { tab_key: e.target.value })}
                      style={styles.input}
                    />
                  </label>
                </div>

                <div style={styles.row2}>
                  <label style={styles.field}>
                    <span style={styles.fieldLabel}>Who can see this tab</span>
                    <select
                      value={tab.audience}
                      onChange={(e) => updateTab(tabIndex, { audience: e.target.value })}
                      style={styles.input}
                    >
                      <option value="both">Staff and customer</option>
                      <option value="staff">Staff only</option>
                      <option value="customer">Customer only</option>
                    </select>
                  </label>
                  <div style={{ ...styles.field, justifyContent: 'flex-end' }}>
                    <TavariCheckbox
                      id={`tab-active-${expandKey}`}
                      checked={tab.is_active !== false}
                      onChange={(checked) => updateTab(tabIndex, { is_active: checked })}
                      label="Active"
                    />
                  </div>
                </div>

                <div>
                  <div style={styles.sectionTitle}>Content blocks</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    {ACTIVITY_TAB_BLOCK_TYPES.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => updateTab(tabIndex, {
                          content_blocks: [...(tab.content_blocks || []), createEmptyContentBlock(type)],
                        })}
                        style={styles.chipBtn}
                      >
                        + {type.replace('_', ' ')}
                      </button>
                    ))}
                  </div>

                  {(tab.content_blocks || []).map((block, blockIndex) => (
                    <div key={block.id || blockIndex} style={styles.blockCard}>
                      <div style={styles.blockHeader}>
                        <strong style={{ textTransform: 'capitalize' }}>{block.type.replace('_', ' ')}</strong>
                        <button
                          type="button"
                          onClick={() => updateTab(tabIndex, {
                            content_blocks: tab.content_blocks.filter((_, i) => i !== blockIndex),
                          })}
                          style={styles.iconBtn}
                        >
                          <FiTrash2 size={14} />
                        </button>
                      </div>

                      {block.type === 'header' ? (
                        <input
                          value={block.text || ''}
                          onChange={(e) => updateBlock(tabIndex, blockIndex, { text: e.target.value })}
                          placeholder="Header text"
                          style={styles.input}
                        />
                      ) : null}

                      {block.type === 'text' ? (
                        <textarea
                          value={block.body || ''}
                          onChange={(e) => updateBlock(tabIndex, blockIndex, { body: e.target.value })}
                          rows={4}
                          placeholder="Instructions or information…"
                          style={styles.textarea}
                        />
                      ) : null}

                      {block.type === 'links' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {(block.items || []).map((item, itemIndex) => (
                            <div key={`${block.id}-link-${itemIndex}`} style={styles.row2}>
                              <input
                                value={item.label || ''}
                                onChange={(e) => {
                                  const items = [...(block.items || [])];
                                  items[itemIndex] = { ...items[itemIndex], label: e.target.value };
                                  updateBlock(tabIndex, blockIndex, { items });
                                }}
                                placeholder="Label"
                                style={styles.input}
                              />
                              <input
                                value={item.url || ''}
                                onChange={(e) => {
                                  const items = [...(block.items || [])];
                                  items[itemIndex] = { ...items[itemIndex], url: e.target.value };
                                  updateBlock(tabIndex, blockIndex, { items });
                                }}
                                placeholder="https://"
                                style={styles.input}
                              />
                            </div>
                          ))}
                          <button
                            type="button"
                            style={styles.chipBtn}
                            onClick={() => updateBlock(tabIndex, blockIndex, {
                              items: [...(block.items || []), { label: 'Link', url: 'https://' }],
                            })}
                          >
                            + Link
                          </button>
                        </div>
                      ) : null}

                      {block.type === 'list' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <input
                            value={block.title || ''}
                            onChange={(e) => updateBlock(tabIndex, blockIndex, { title: e.target.value })}
                            placeholder="List title"
                            style={styles.input}
                          />
                          <TavariCheckbox
                            id={`list-cust-${block.id}`}
                            checked={block.allow_customer_edit !== false}
                            onChange={(checked) => updateBlock(tabIndex, blockIndex, { allow_customer_edit: checked })}
                            label="Customers can add/edit list items"
                          />
                        </div>
                      ) : null}

                      {block.type === 'file_upload' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <input
                            value={block.label || ''}
                            onChange={(e) => updateBlock(tabIndex, blockIndex, { label: e.target.value })}
                            placeholder="Upload label"
                            style={styles.input}
                          />
                          <input
                            value={block.upload_key || ''}
                            onChange={(e) => updateBlock(tabIndex, blockIndex, { upload_key: e.target.value })}
                            placeholder="upload_key (use cake_receipts for cake receipts)"
                            style={styles.input}
                          />
                          <div style={{ fontSize: 13, color: TavariStyles.colors.gray600 }}>
                            Use upload key <code>cake_receipts</code> to reuse the existing cake receipt uploader.
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>

                <ReminderEditor
                  title="Customer reminders"
                  kind="customer"
                  reminders={tab.reminders?.customer || []}
                  onChange={(customer) => updateTab(tabIndex, {
                    reminders: { ...(tab.reminders || {}), customer },
                  })}
                />
                <ReminderEditor
                  title="Staff reminders"
                  kind="staff"
                  reminders={tab.reminders?.staff || []}
                  onChange={(staff) => updateTab(tabIndex, {
                    reminders: { ...(tab.reminders || {}), staff },
                  })}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ReminderEditor({ title, kind, reminders, onChange }) {
  return (
    <div>
      <div style={styles.sectionTitle}>{title}</div>
      <p style={{ margin: '0 0 8px', fontSize: 13, color: TavariStyles.colors.gray600 }}>
        Send window: days before the booking date, at the chosen hour (business timezone).
        Tokens: {'{{activity_name}}'}, {'{{booking_date}}'}, {'{{booking_number}}'}
      </p>
      {(reminders || []).map((reminder, index) => (
        <div key={reminder.id || index} style={styles.blockCard}>
          <div style={styles.blockHeader}>
            <TavariCheckbox
              id={`rem-en-${reminder.id || index}`}
              checked={reminder.enabled !== false}
              onChange={(checked) => {
                const next = [...reminders];
                next[index] = { ...next[index], enabled: checked };
                onChange(next);
              }}
              label="Enabled"
            />
            <button
              type="button"
              style={styles.iconBtn}
              onClick={() => onChange(reminders.filter((_, i) => i !== index))}
            >
              <FiTrash2 size={14} />
            </button>
          </div>
          <div style={styles.row2}>
            <label style={styles.field}>
              <span style={styles.fieldLabel}>Days before booking</span>
              <input
                type="number"
                min={0}
                max={365}
                value={reminder.days_before ?? 3}
                onChange={(e) => {
                  const next = [...reminders];
                  next[index] = { ...next[index], days_before: Number(e.target.value) };
                  onChange(next);
                }}
                style={styles.input}
              />
            </label>
            <label style={styles.field}>
              <span style={styles.fieldLabel}>Send hour (0–23)</span>
              <input
                type="number"
                min={0}
                max={23}
                value={reminder.send_hour ?? 10}
                onChange={(e) => {
                  const next = [...reminders];
                  next[index] = { ...next[index], send_hour: Number(e.target.value) };
                  onChange(next);
                }}
                style={styles.input}
              />
            </label>
          </div>
          <input
            value={reminder.subject || ''}
            onChange={(e) => {
              const next = [...reminders];
              next[index] = { ...next[index], subject: e.target.value };
              onChange(next);
            }}
            placeholder="Email subject"
            style={{ ...styles.input, marginBottom: 8 }}
          />
          <textarea
            value={reminder.body || ''}
            onChange={(e) => {
              const next = [...reminders];
              next[index] = { ...next[index], body: e.target.value };
              onChange(next);
            }}
            rows={3}
            placeholder="Email body"
            style={styles.textarea}
          />
          {kind === 'staff' ? (
            <input
              value={(reminder.emails || []).join(', ')}
              onChange={(e) => {
                const emails = e.target.value.split(',').map((part) => part.trim()).filter(Boolean);
                const next = [...reminders];
                next[index] = { ...next[index], emails };
                onChange(next);
              }}
              placeholder="Staff emails (comma-separated)"
              style={{ ...styles.input, marginTop: 8 }}
            />
          ) : null}
        </div>
      ))}
      <button
        type="button"
        style={styles.chipBtn}
        onClick={() => onChange([...(reminders || []), createEmptyReminder(kind)])}
      >
        + Reminder
      </button>
    </div>
  );
}

const styles = {
  primaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    border: 'none',
    borderRadius: 8,
    padding: '10px 14px',
    background: TavariStyles.colors.primary,
    color: '#fff',
    fontWeight: 600,
    cursor: 'pointer',
  },
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    border: '1px solid #d1d5db',
    borderRadius: 8,
    padding: '10px 14px',
    background: '#fff',
    color: TavariStyles.colors.gray800,
    fontWeight: 600,
    cursor: 'pointer',
  },
  chipBtn: {
    border: '1px solid #d1d5db',
    borderRadius: 999,
    padding: '6px 10px',
    background: '#fff',
    fontSize: 13,
    cursor: 'pointer',
  },
  empty: {
    border: '1px dashed #d1d5db',
    borderRadius: 10,
    padding: 20,
    color: TavariStyles.colors.gray600,
  },
  card: {
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: 14,
    background: '#fff',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  expandBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: 0,
    color: TavariStyles.colors.gray900,
  },
  iconBtn: {
    border: '1px solid #d1d5db',
    background: '#fff',
    borderRadius: 8,
    padding: 8,
    cursor: 'pointer',
  },
  row2: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: TavariStyles.colors.gray700,
  },
  input: {
    border: '1px solid #d1d5db',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 14,
    fontFamily: 'inherit',
  },
  textarea: {
    border: '1px solid #d1d5db',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 14,
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    marginBottom: 8,
    color: TavariStyles.colors.gray900,
  },
  blockCard: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 12,
    background: '#fafafa',
    marginBottom: 8,
  },
  blockHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
};
