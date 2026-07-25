import React, { useCallback, useEffect, useState } from 'react';
import { FiPlus, FiTrash2 } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import CakeReceiptPanel from './CakeReceiptPanel';
import { tabUsesCakeReceiptsUpload } from '../../helpers/Bookings/bookingActivityTabs';

/**
 * Renders one configured activity tab for a booking (staff or customer).
 */
export default function BookingActivityTabPanel({
  tab,
  booking,
  businessId,
  businessTimezone,
  mode = 'staff',
  token = null,
  disabled = false,
}) {
  if (!tab || !booking?.id) {
    return <div style={{ padding: 16, color: '#6b7280' }}>No tab content.</div>;
  }

  const usesCake = tabUsesCakeReceiptsUpload(tab);

  return (
    <div style={{ padding: mode === 'customer' ? 0 : '8px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {(tab.content_blocks || []).map((block) => {
        if (block.type === 'header') {
          return (
            <h3 key={block.id} style={styles.header}>
              {block.text || tab.label}
            </h3>
          );
        }
        if (block.type === 'text') {
          return (
            <p key={block.id} style={styles.text}>
              {block.body || ''}
            </p>
          );
        }
        if (block.type === 'links') {
          return (
            <ul key={block.id} style={styles.linkList}>
              {(block.items || []).map((item, index) => (
                <li key={`${block.id}-${index}`}>
                  <a href={item.url} target="_blank" rel="noopener noreferrer" style={styles.link}>
                    {item.label || item.url}
                  </a>
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === 'list') {
          return (
            <TabChecklist
              key={block.id}
              block={block}
              tabId={tab.id}
              bookingId={booking.id}
              businessId={businessId}
              mode={mode}
              token={token}
              disabled={disabled}
            />
          );
        }
        if (block.type === 'file_upload') {
          if (block.upload_key === 'cake_receipts' || (usesCake && block.upload_key === 'cake_receipts')) {
            return (
              <div key={block.id}>
                {block.label ? <div style={styles.blockLabel}>{block.label}</div> : null}
                <CakeReceiptPanel
                  mode={mode}
                  businessId={businessId}
                  bookingId={booking.id}
                  token={token}
                  businessTimezone={businessTimezone}
                  disabled={disabled}
                  compact={mode === 'customer'}
                />
              </div>
            );
          }
          return (
            <div key={block.id} style={styles.muted}>
              File upload “{block.upload_key}” is configured. Currently only the
              {' '}
              <code>cake_receipts</code>
              {' '}
              uploader is wired; other upload keys can be added next.
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function TabChecklist({
  block,
  tabId,
  bookingId,
  businessId,
  mode,
  token,
  disabled,
}) {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const canEdit = mode === 'staff' || block.allow_customer_edit !== false;
  const useCustomerApi = mode === 'customer' && Boolean(token);

  const load = useCallback(async () => {
    if (!tabId || !bookingId) return;
    if (!useCustomerApi && !businessId) return;
    setLoading(true);
    try {
      if (useCustomerApi) {
        const { data, error } = await supabase.functions.invoke('manage-booking-self-service', {
          body: {
            action: 'activity_tab_list',
            listAction: 'list',
            token,
            tabId,
            listKey: block.list_key || 'default',
          },
        });
        if (error || data?.error) throw new Error(data?.error || error?.message || 'Could not load list');
        setItems(data.items || []);
      } else {
        const { data, error } = await supabase
          .from('booking_activity_tab_list_items')
          .select('*')
          .eq('business_id', businessId)
          .eq('booking_id', bookingId)
          .eq('tab_id', tabId)
          .eq('list_key', block.list_key || 'default')
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true });
        if (error) throw error;
        setItems(data || []);
      }
    } catch (error) {
      console.error('[TabChecklist] load failed:', error);
      toast.error(error?.message || 'Could not load list');
    } finally {
      setLoading(false);
    }
  }, [tabId, bookingId, businessId, block.list_key, token, useCustomerApi]);

  useEffect(() => {
    load();
  }, [load]);

  const addItem = async () => {
    const label = String(draft || '').trim();
    if (!label || disabled || !canEdit) return;
    try {
      if (useCustomerApi) {
        const { data, error } = await supabase.functions.invoke('manage-booking-self-service', {
          body: {
            action: 'activity_tab_list',
            listAction: 'add',
            token,
            tabId,
            listKey: block.list_key || 'default',
            label,
          },
        });
        if (error || data?.error) throw new Error(data?.error || error?.message || 'Could not add item');
      } else {
        const { error } = await supabase.from('booking_activity_tab_list_items').insert({
          business_id: businessId,
          booking_id: bookingId,
          tab_id: tabId,
          list_key: block.list_key || 'default',
          label,
          sort_order: items.length,
          created_source: 'staff',
        });
        if (error) throw error;
      }
      setDraft('');
      await load();
    } catch (error) {
      toast.error(error?.message || 'Could not add item');
    }
  };

  const toggleDone = async (item) => {
    if (disabled || !canEdit) return;
    try {
      if (useCustomerApi) {
        const { data, error } = await supabase.functions.invoke('manage-booking-self-service', {
          body: {
            action: 'activity_tab_list',
            listAction: 'toggle',
            token,
            tabId,
            listKey: block.list_key || 'default',
            itemId: item.id,
          },
        });
        if (error || data?.error) throw new Error(data?.error || error?.message || 'Could not update item');
      } else {
        const { error } = await supabase
          .from('booking_activity_tab_list_items')
          .update({ is_done: !item.is_done, updated_at: new Date().toISOString() })
          .eq('id', item.id);
        if (error) throw error;
      }
      await load();
    } catch (error) {
      toast.error(error?.message || 'Could not update item');
    }
  };

  const removeItem = async (item) => {
    if (disabled || !canEdit) return;
    try {
      if (useCustomerApi) {
        const { data, error } = await supabase.functions.invoke('manage-booking-self-service', {
          body: {
            action: 'activity_tab_list',
            listAction: 'remove',
            token,
            tabId,
            listKey: block.list_key || 'default',
            itemId: item.id,
          },
        });
        if (error || data?.error) throw new Error(data?.error || error?.message || 'Could not remove item');
      } else {
        const { error } = await supabase
          .from('booking_activity_tab_list_items')
          .delete()
          .eq('id', item.id);
        if (error) throw error;
      }
      await load();
    } catch (error) {
      toast.error(error?.message || 'Could not remove item');
    }
  };

  return (
    <div>
      <div style={styles.blockLabel}>{block.title || 'Checklist'}</div>
      {loading ? (
        <div style={styles.muted}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((item) => (
            <div key={item.id} style={styles.listRow}>
              <TavariCheckbox
                id={`tab-list-${item.id}`}
                checked={!!item.is_done}
                onChange={() => toggleDone(item)}
                disabled={disabled || !canEdit}
                label={item.label}
              />
              {canEdit && !disabled ? (
                <button type="button" onClick={() => removeItem(item)} style={styles.iconBtn}>
                  <FiTrash2 size={14} />
                </button>
              ) : null}
            </div>
          ))}
          {items.length === 0 ? <div style={styles.muted}>No items yet.</div> : null}
          {canEdit && !disabled ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={block.placeholder || 'Add an item…'}
                style={styles.input}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addItem();
                  }
                }}
              />
              <button type="button" onClick={addItem} style={styles.addBtn}>
                <FiPlus size={14} /> Add
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

const styles = {
  header: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: TavariStyles.colors.gray900,
  },
  text: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.55,
    color: TavariStyles.colors.gray700,
    whiteSpace: 'pre-wrap',
  },
  linkList: {
    margin: 0,
    paddingLeft: 18,
  },
  link: {
    color: TavariStyles.colors.primary,
    fontWeight: 600,
  },
  blockLabel: {
    fontSize: 13,
    fontWeight: 700,
    color: TavariStyles.colors.gray800,
    marginBottom: 8,
  },
  muted: {
    fontSize: 13,
    color: TavariStyles.colors.gray600,
  },
  listRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  iconBtn: {
    border: '1px solid #d1d5db',
    background: '#fff',
    borderRadius: 8,
    padding: 6,
    cursor: 'pointer',
  },
  input: {
    flex: 1,
    border: '1px solid #d1d5db',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 14,
  },
  addBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    border: 'none',
    borderRadius: 8,
    padding: '10px 12px',
    background: TavariStyles.colors.primary,
    color: '#fff',
    fontWeight: 600,
    cursor: 'pointer',
  },
};
