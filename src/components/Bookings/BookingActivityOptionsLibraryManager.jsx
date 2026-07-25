import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FiPlus, FiSave, FiTrash2, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { supabase } from '../../supabaseClient';
import bookingActivityService from '../../services/Bookings/BookingActivityService';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import {
  applyPortalOptionLibraryGroupUpsert,
  clonePortalOptionGroup,
  collectPortalOptionLibrary,
  defaultPortalOptionGroup,
  defaultPortalOptionItem,
  portalOptionFromInventoryItem,
} from '../../utils/bookingActivityOptions';

/**
 * Settings library: create option groups, attach inventory, assign across activities.
 */
export default function BookingActivityOptionsLibraryManager({ businessId }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activities, setActivities] = useState([]);
  const [selectedFingerprint, setSelectedFingerprint] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draftGroup, setDraftGroup] = useState(null);
  const [draftActivityIds, setDraftActivityIds] = useState([]);
  const [search, setSearch] = useState('');

  const [showInventoryPicker, setShowInventoryPicker] = useState(false);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventorySelection, setInventorySelection] = useState([]);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    bookingActivityService.setBusinessId(businessId);
    try {
      const { data, error } = await supabase
        .from('booking_activities')
        .select('id, activity_name, is_active, type_id, addon_settings, display_order')
        .eq('business_id', businessId)
        .order('activity_name');
      if (error) throw error;
      setActivities(data || []);
    } catch (error) {
      console.error('[BookingActivityOptionsLibraryManager] load failed:', error);
      toast.error(error?.message || 'Could not load activity options');
      setActivities([]);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  const library = useMemo(() => collectPortalOptionLibrary(activities), [activities]);

  const filteredLibrary = useMemo(() => {
    const q = String(search || '').trim().toLowerCase();
    if (!q) return library;
    return library.filter((row) => {
      const groupName = String(row.group?.name || '').toLowerCase();
      const optionNames = (row.group?.options || [])
        .map((opt) => String(opt.name || '').toLowerCase())
        .join(' ');
      return groupName.includes(q) || optionNames.includes(q);
    });
  }, [library, search]);

  const selectedRow = useMemo(
    () => library.find((row) => row.fingerprint === selectedFingerprint) || null,
    [library, selectedFingerprint],
  );

  useEffect(() => {
    if (isCreating) return;
    if (!selectedFingerprint && library[0]) {
      setSelectedFingerprint(library[0].fingerprint);
      setDraftGroup(clonePortalOptionGroup(library[0].group));
      setDraftActivityIds([...(library[0].activityIds || [])]);
      return;
    }
    if (selectedFingerprint && !library.some((row) => row.fingerprint === selectedFingerprint)) {
      const next = library[0] || null;
      setSelectedFingerprint(next?.fingerprint || null);
      setDraftGroup(next ? clonePortalOptionGroup(next.group) : null);
      setDraftActivityIds([...(next?.activityIds || [])]);
    }
  }, [library, selectedFingerprint, isCreating]);

  const selectRow = (row) => {
    setIsCreating(false);
    setSelectedFingerprint(row.fingerprint);
    setDraftGroup(clonePortalOptionGroup(row.group));
    setDraftActivityIds([...(row.activityIds || [])]);
  };

  const startCreate = () => {
    setIsCreating(true);
    setSelectedFingerprint(null);
    setDraftGroup(defaultPortalOptionGroup({ name: '', description: '', options: [] }));
    setDraftActivityIds([]);
  };

  const updateDraftGroup = (patch) => {
    setDraftGroup((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const updateDraftOption = (optionIndex, patch) => {
    setDraftGroup((prev) => {
      if (!prev) return prev;
      const options = (prev.options || []).map((opt, index) => (
        index === optionIndex ? { ...opt, ...patch } : opt
      ));
      return { ...prev, options };
    });
  };

  const removeDraftOption = (optionIndex) => {
    setDraftGroup((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        options: (prev.options || []).filter((_, index) => index !== optionIndex),
      };
    });
  };

  const addCustomOption = () => {
    setDraftGroup((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        options: [
          ...(prev.options || []),
          defaultPortalOptionItem({ name: 'New option' }),
        ],
      };
    });
  };

  const toggleActivity = (activityId, checked) => {
    setDraftActivityIds((prev) => {
      if (checked) {
        return prev.includes(activityId) ? prev : [...prev, activityId];
      }
      return prev.filter((id) => id !== activityId);
    });
  };

  const openInventoryPicker = async () => {
    if (!businessId) return;
    setLoadingInventory(true);
    setShowInventoryPicker(true);
    setInventorySearch('');
    setInventorySelection([]);
    try {
      const { data, error } = await supabase
        .from('pos_inventory')
        .select('id, name, price, sku, is_bundle, is_active')
        .eq('business_id', businessId)
        .or('is_active.eq.true,is_active.is.null')
        .order('name', { ascending: true })
        .limit(500);
      if (error) throw error;
      setInventoryItems(data || []);
    } catch (error) {
      console.error('[BookingActivityOptionsLibraryManager] inventory load failed:', error);
      toast.error(error?.message || 'Could not load inventory');
      setInventoryItems([]);
    } finally {
      setLoadingInventory(false);
    }
  };

  const existingInventoryIds = useMemo(() => new Set(
    (draftGroup?.options || [])
      .map((opt) => String(opt.inventory_item_id || '').trim())
      .filter(Boolean),
  ), [draftGroup]);

  const filteredInventory = useMemo(() => {
    const q = String(inventorySearch || '').trim().toLowerCase();
    if (!q) return inventoryItems;
    return inventoryItems.filter((item) => {
      const name = String(item.name || '').toLowerCase();
      const sku = String(item.sku || '').toLowerCase();
      return name.includes(q) || sku.includes(q);
    });
  }, [inventoryItems, inventorySearch]);

  const applyInventorySelection = () => {
    const toAdd = inventoryItems
      .filter((item) => inventorySelection.includes(item.id) && !existingInventoryIds.has(item.id))
      .map((item) => portalOptionFromInventoryItem(item));
    if (toAdd.length === 0) {
      toast.error('Select at least one inventory item that is not already in this group');
      return;
    }
    setDraftGroup((prev) => {
      if (!prev) return prev;
      return { ...prev, options: [...(prev.options || []), ...toAdd] };
    });
    setShowInventoryPicker(false);
    setInventorySelection([]);
    toast.success(`Added ${toAdd.length} item${toAdd.length === 1 ? '' : 's'}`);
  };

  const handleSave = async () => {
    if (!draftGroup || !businessId) return;
    const name = String(draftGroup.name || '').trim();
    if (!name) {
      toast.error('Option group name is required');
      return;
    }
    if (!(draftGroup.options || []).some((opt) => String(opt.name || '').trim() || opt.inventory_item_id)) {
      toast.error('Add at least one option (from inventory or custom)');
      return;
    }
    if (draftActivityIds.length === 0) {
      toast.error('Select at least one activity to assign this group to');
      return;
    }

    setSaving(true);
    bookingActivityService.setBusinessId(businessId);
    try {
      const templateGroup = {
        ...draftGroup,
        name,
        options: (draftGroup.options || []).filter(
          (opt) => String(opt.name || '').trim() || opt.inventory_item_id,
        ),
      };
      const updates = applyPortalOptionLibraryGroupUpsert({
        activities,
        previousFingerprint: isCreating ? null : selectedFingerprint,
        templateGroup,
        selectedActivityIds: draftActivityIds,
      });

      for (const update of updates) {
        await bookingActivityService.updateActivity(update.activityId, {
          addonSettings: update.addonSettings,
        });
      }

      toast.success(
        updates.length
          ? `${isCreating ? 'Created' : 'Updated'} on ${updates.length} activit${updates.length === 1 ? 'y' : 'ies'}`
          : 'No activity changes needed',
      );

      setIsCreating(false);
      await load();
    } catch (error) {
      console.error('[BookingActivityOptionsLibraryManager] save failed:', error);
      toast.error(error?.message || 'Could not save option group');
    } finally {
      setSaving(false);
    }
  };

  const activityNameById = useMemo(() => {
    const map = new Map();
    activities.forEach((activity) => {
      map.set(activity.id, activity.activity_name || 'Activity');
    });
    return map;
  }, [activities]);

  if (loading) {
    return <div style={{ color: TavariStyles.colors.gray600 }}>Loading options…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <p style={{ margin: 0, fontSize: 14, color: TavariStyles.colors.gray600, lineHeight: 1.5, flex: 1 }}>
          Create option groups, attach inventory items or bundles, then assign them to multiple activities at once.
        </p>
        <button type="button" onClick={startCreate} style={styles.primaryBtn}>
          <FiPlus size={16} /> Create option group
        </button>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search options…"
        style={styles.search}
      />

      {library.length === 0 && !isCreating ? (
        <div style={styles.empty}>
          No option groups yet. Create one here and assign inventory, or add options on an activity first.
        </div>
      ) : (
        <div style={styles.layout}>
          <div style={styles.listPane}>
            {isCreating ? (
              <div style={{ ...styles.listItem, borderColor: TavariStyles.colors.primary, background: '#f0fdfa' }}>
                <strong style={styles.listTitle}>New option group</strong>
                <div style={styles.listMeta}>Draft — not saved yet</div>
              </div>
            ) : null}
            {filteredLibrary.map((row) => {
              const active = !isCreating && row.fingerprint === selectedFingerprint;
              const optionLabels = (row.group?.options || [])
                .map((opt) => opt.name || 'Option')
                .slice(0, 4);
              const extra = Math.max(0, (row.group?.options || []).length - optionLabels.length);
              return (
                <button
                  key={row.fingerprint}
                  type="button"
                  onClick={() => selectRow(row)}
                  style={{
                    ...styles.listItem,
                    borderColor: active ? TavariStyles.colors.primary : TavariStyles.colors.gray200,
                    background: active ? '#f0fdfa' : '#fff',
                  }}
                >
                  <strong style={styles.listTitle}>{row.group?.name || 'Untitled group'}</strong>
                  <div style={styles.listMeta}>
                    {optionLabels.join(', ')}
                    {extra > 0 ? ` +${extra} more` : ''}
                  </div>
                  <div style={styles.listMeta}>
                    On {row.activityIds.length} activit{row.activityIds.length === 1 ? 'y' : 'ies'}
                  </div>
                </button>
              );
            })}
            {!isCreating && filteredLibrary.length === 0 ? (
              <div style={styles.empty}>No options match your search.</div>
            ) : null}
          </div>

          <div style={styles.detailPane}>
            {draftGroup ? (
              <>
                <h3 style={styles.detailTitle}>
                  {isCreating ? 'Create option group' : 'Edit option group'}
                </h3>

                <label style={styles.field}>
                  <span style={styles.fieldLabel}>Group name</span>
                  <input
                    value={draftGroup.name || ''}
                    onChange={(e) => updateDraftGroup({ name: e.target.value })}
                    placeholder="e.g. Food, Decorations, Pizza size"
                    style={styles.input}
                  />
                </label>

                <label style={styles.field}>
                  <span style={styles.fieldLabel}>Description (optional)</span>
                  <textarea
                    value={draftGroup.description || ''}
                    onChange={(e) => updateDraftGroup({ description: e.target.value })}
                    rows={2}
                    placeholder="Shown to customers with this group"
                    style={styles.textarea}
                  />
                </label>

                <div style={styles.sectionLabel}>Options / inventory</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  <button type="button" onClick={openInventoryPicker} style={styles.secondaryBtn}>
                    <FiPlus size={14} /> Add from inventory
                  </button>
                  <button type="button" onClick={addCustomOption} style={styles.secondaryBtn}>
                    <FiPlus size={14} /> Add custom option
                  </button>
                </div>

                {(draftGroup.options || []).length === 0 ? (
                  <div style={{ ...styles.empty, marginBottom: 16 }}>
                    No options yet. Add inventory items/bundles or a custom option.
                  </div>
                ) : (
                  <div style={styles.optionsEditor}>
                    {(draftGroup.options || []).map((opt, index) => (
                      <div key={opt.id || index} style={styles.optionRow}>
                        <input
                          value={opt.name || ''}
                          onChange={(e) => updateDraftOption(index, { name: e.target.value })}
                          placeholder="Option name"
                          style={{ ...styles.input, flex: 1 }}
                        />
                        <div style={styles.optionMeta}>
                          {opt.inventory_item_id ? 'Inventory linked' : 'Custom'}
                        </div>
                        <TavariCheckbox
                          id={`opt-lib-included-${opt.id || index}`}
                          checked={opt.included === true}
                          onChange={(checked) => updateDraftOption(index, { included: checked })}
                          label="Included"
                        />
                        <button
                          type="button"
                          onClick={() => removeDraftOption(index)}
                          style={styles.iconBtn}
                          aria-label="Remove option"
                        >
                          <FiTrash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={styles.sectionLabel}>Assign to activities</div>
                <p style={{ margin: '0 0 10px', fontSize: 13, color: TavariStyles.colors.gray600 }}>
                  Checked activities will get this option group.
                  {isCreating ? '' : ' Uncheck to remove it from an activity.'}
                </p>
                <div style={styles.activityList}>
                  {activities
                    .filter((activity) => activity.is_active !== false)
                    .map((activity) => (
                      <TavariCheckbox
                        key={activity.id}
                        id={`opt-lib-act-${isCreating ? 'new' : selectedFingerprint}-${activity.id}`}
                        checked={draftActivityIds.includes(activity.id)}
                        onChange={(checked) => toggleActivity(activity.id, checked)}
                        label={activity.activity_name || 'Activity'}
                      />
                    ))}
                </div>

                {activities.some((a) => a.is_active === false) ? (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ ...styles.sectionLabel, marginBottom: 8 }}>Inactive activities</div>
                    <div style={styles.activityList}>
                      {activities
                        .filter((activity) => activity.is_active === false)
                        .map((activity) => (
                          <TavariCheckbox
                            key={activity.id}
                            id={`opt-lib-act-inactive-${isCreating ? 'new' : selectedFingerprint}-${activity.id}`}
                            checked={draftActivityIds.includes(activity.id)}
                            onChange={(checked) => toggleActivity(activity.id, checked)}
                            label={`${activity.activity_name || 'Activity'} (inactive)`}
                          />
                        ))}
                    </div>
                  </div>
                ) : null}

                <div style={styles.footer}>
                  <div style={styles.currentOn}>
                    {isCreating
                      ? `Will assign to ${draftActivityIds.length} activit${draftActivityIds.length === 1 ? 'y' : 'ies'}`
                      : `Currently on: ${(selectedRow?.activityIds || [])
                        .map((id) => activityNameById.get(id) || id)
                        .join(', ') || 'none'}`}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {isCreating ? (
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreating(false);
                          if (library[0]) selectRow(library[0]);
                          else {
                            setDraftGroup(null);
                            setDraftActivityIds([]);
                          }
                        }}
                        style={styles.secondaryBtn}
                      >
                        Cancel
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving}
                      style={styles.saveBtn}
                    >
                      <FiSave size={16} />
                      {saving ? 'Saving…' : isCreating ? 'Create & assign' : 'Save changes'}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div style={styles.empty}>Select an option group, or create a new one.</div>
            )}
          </div>
        </div>
      )}

      {showInventoryPicker ? (
        <div style={styles.modalOverlay} role="dialog" aria-modal="true">
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Add from inventory</h3>
              <button
                type="button"
                onClick={() => setShowInventoryPicker(false)}
                style={styles.iconBtn}
                aria-label="Close"
              >
                <FiX size={18} />
              </button>
            </div>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: TavariStyles.colors.gray600 }}>
              Select inventory items or bundles. Each selection becomes one option in this group.
            </p>
            <input
              value={inventorySearch}
              onChange={(e) => setInventorySearch(e.target.value)}
              placeholder="Search inventory…"
              style={{ ...styles.input, marginBottom: 12 }}
            />
            <div style={styles.inventoryList}>
              {loadingInventory ? (
                <div style={styles.empty}>Loading inventory…</div>
              ) : filteredInventory.length === 0 ? (
                <div style={styles.empty}>No inventory items found.</div>
              ) : (
                filteredInventory.map((item) => {
                  const already = existingInventoryIds.has(item.id);
                  const checked = inventorySelection.includes(item.id);
                  return (
                    <div
                      key={item.id}
                      style={{
                        ...styles.inventoryRow,
                        opacity: already ? 0.55 : 1,
                      }}
                    >
                      <TavariCheckbox
                        id={`opt-lib-inv-${item.id}`}
                        checked={checked || already}
                        disabled={already}
                        onChange={(next) => {
                          if (already) return;
                          setInventorySelection((prev) => (
                            next
                              ? (prev.includes(item.id) ? prev : [...prev, item.id])
                              : prev.filter((id) => id !== item.id)
                          ));
                        }}
                        label={`${item.name || 'Item'}${item.is_bundle ? ' (bundle)' : ''}${already ? ' — already added' : ''}`}
                      />
                      <div style={styles.optionMeta}>
                        ${Number(item.price || 0).toFixed(2)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div style={styles.modalFooter}>
              <button type="button" onClick={() => setShowInventoryPicker(false)} style={styles.secondaryBtn}>
                Cancel
              </button>
              <button type="button" onClick={applyInventorySelection} style={styles.primaryBtn}>
                Add selected ({inventorySelection.filter((id) => !existingInventoryIds.has(id)).length})
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const styles = {
  search: {
    width: '100%',
    maxWidth: 420,
    padding: '10px 12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: 8,
    fontSize: 14,
    boxSizing: 'border-box',
  },
  empty: {
    padding: 20,
    borderRadius: 10,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    background: TavariStyles.colors.gray50,
    color: TavariStyles.colors.gray600,
    fontSize: 14,
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(240px, 340px) 1fr',
    gap: 16,
    alignItems: 'start',
  },
  listPane: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    maxHeight: '70vh',
    overflowY: 'auto',
  },
  listItem: {
    textAlign: 'left',
    padding: 12,
    borderRadius: 10,
    border: '1px solid',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    background: '#fff',
  },
  listTitle: {
    fontSize: 14,
    color: TavariStyles.colors.gray900,
  },
  listMeta: {
    fontSize: 13,
    color: TavariStyles.colors.gray600,
    lineHeight: 1.4,
  },
  detailPane: {
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: 12,
    padding: 20,
    background: '#fff',
  },
  detailTitle: {
    margin: '0 0 16px',
    fontSize: 20,
    fontWeight: 700,
    color: TavariStyles.colors.gray900,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: TavariStyles.colors.gray800,
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: 8,
    fontSize: 14,
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%',
    padding: '10px 12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: 8,
    fontSize: 14,
    boxSizing: 'border-box',
    resize: 'vertical',
    fontFamily: 'inherit',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: 700,
    color: TavariStyles.colors.gray800,
    marginBottom: 8,
    marginTop: 8,
  },
  optionsEditor: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginBottom: 16,
  },
  optionRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    background: TavariStyles.colors.gray50,
  },
  optionMeta: {
    fontSize: 13,
    color: TavariStyles.colors.gray500,
    whiteSpace: 'nowrap',
  },
  activityList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    maxHeight: 280,
    overflowY: 'auto',
    padding: 12,
    borderRadius: 8,
    border: `1px solid ${TavariStyles.colors.gray200}`,
    background: TavariStyles.colors.gray50,
  },
  footer: {
    marginTop: 20,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  currentOn: {
    fontSize: 13,
    color: TavariStyles.colors.gray600,
    maxWidth: '45%',
    lineHeight: 1.4,
  },
  primaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    border: 'none',
    borderRadius: 8,
    background: TavariStyles.colors.primary,
    color: '#fff',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  },
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 12px',
    border: `1px solid ${TavariStyles.colors.gray300}`,
    borderRadius: 8,
    background: '#fff',
    color: TavariStyles.colors.gray800,
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  },
  saveBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    border: 'none',
    borderRadius: 8,
    background: TavariStyles.colors.primary,
    color: '#fff',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  },
  iconBtn: {
    border: `1px solid ${TavariStyles.colors.gray300}`,
    background: '#fff',
    borderRadius: 8,
    padding: 8,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 16,
  },
  modal: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '85vh',
    overflow: 'auto',
    background: '#fff',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  inventoryList: {
    maxHeight: 360,
    overflowY: 'auto',
    border: `1px solid ${TavariStyles.colors.gray200}`,
    borderRadius: 8,
    padding: 8,
  },
  inventoryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    padding: '8px 6px',
    borderBottom: `1px solid ${TavariStyles.colors.gray100}`,
  },
  modalFooter: {
    marginTop: 16,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
};
