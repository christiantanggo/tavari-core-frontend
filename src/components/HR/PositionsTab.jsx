// src/components/HR/PositionsTab.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Edit2, Save, ChevronUp, ChevronDown } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { TavariStyles } from '../../utils/TavariStyles';
import TavariCheckbox from '../UI/TavariCheckbox';
import toast from 'react-hot-toast';

/** PostgREST / Postgres: column absent from schema (migration not applied). Must match message — do not treat every PGRST204 as missing-column. */
const isMissingColumn = (err, col) => {
  if (!err || !col) return false;
  const m = String(err.message || err.details || err.hint || '');
  if (!m.includes(col)) return false;
  if (err.code === 'PGRST204' || err.code === '42703' || err.code === 'PGRST123') return true;
  return (
    m.includes('Could not find') ||
    m.includes('schema cache') ||
    /column .* does not exist/i.test(m)
  );
};

const sortPositionRows = (rows) => {
  if (!Array.isArray(rows)) return [];
  return [...rows].sort((a, b) => {
    const hasA = a.display_order != null && a.display_order !== '';
    const hasB = b.display_order != null && b.display_order !== '';
    const na = hasA ? Number(a.display_order) : null;
    const nb = hasB ? Number(b.display_order) : null;
    if (na != null && !Number.isNaN(na) && nb != null && !Number.isNaN(nb) && na !== nb) return na - nb;
    if (na != null && !Number.isNaN(na) && (nb == null || Number.isNaN(nb))) return -1;
    if ((na == null || Number.isNaN(na)) && nb != null && !Number.isNaN(nb)) return 1;
    return (a.position_name || '').localeCompare(b.position_name || '', undefined, { sensitivity: 'base' });
  });
};

const PositionsTab = ({ businessId }) => {
  const [positions, setPositions] = useState([]);
  const [availablePremiums, setAvailablePremiums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    position_name: '',
    description: '',
    color: '#4a90e2',
    shift_premium_id: '',
    is_management: false,
    shift_lead_eligible: false
  });
  const [validationErrors, setValidationErrors] = useState({});
  const [orderBusy, setOrderBusy] = useState(false);
  /** False when DB has no `display_order` column (migration not applied). Probed after load. */
  const [canReorderByRank, setCanReorderByRank] = useState(true);

  const activePremiums = useMemo(
    () => (availablePremiums || []).filter((p) => p.is_active !== false),
    [availablePremiums]
  );

  /** Active premiums for the dropdown, plus the current selection if it was deactivated. */
  const selectPremiums = useMemo(() => {
    const id = formData.shift_premium_id;
    if (!id) return activePremiums;
    if (activePremiums.some((p) => p.id === id)) return activePremiums;
    const current = (availablePremiums || []).find((p) => p.id === id);
    return current ? [...activePremiums, current] : activePremiums;
  }, [formData.shift_premium_id, activePremiums, availablePremiums]);

  useEffect(() => {
    if (businessId) {
      fetchPositions();
      fetchAvailablePremiums();
    }
  }, [businessId]);

  const fetchPositions = async () => {
    try {
      setLoading(true);
      // Do not .order by display_order here — that fails if the migration is not applied yet
      // (entire request errors and the list would be empty). Sort in memory instead.
      const { data, error } = await supabase
        .from('positions')
        .select('*')
        .eq('business_id', businessId)
        .order('position_name', { ascending: true });

      if (error) throw error;

      setPositions(sortPositionRows(data || []));

      const probe = await supabase
        .from('positions')
        .select('display_order')
        .eq('business_id', businessId)
        .limit(1);
      if (probe.error && isMissingColumn(probe.error, 'display_order')) {
        setCanReorderByRank(false);
      } else {
        setCanReorderByRank(true);
      }
    } catch (error) {
      console.error('Error fetching positions:', error);
      toast.error('Failed to load positions');
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailablePremiums = async () => {
    try {
      const { data, error } = await supabase
        .from('hr_shift_premiums')
        .select('*')
        .eq('business_id', businessId)
        .order('name');

      if (error) throw error;
      setAvailablePremiums(data || []);
    } catch (error) {
      console.error('Error fetching available premiums:', error);
      toast.error('Failed to load shift premiums');
    }
  };

  const getShiftPremiumLabel = (position) => {
    if (!position?.shift_premium_id) return '—';
    const p = availablePremiums.find((x) => x.id === position.shift_premium_id);
    if (!p) return '—';
    const rate = p.rate != null && p.rate !== '' ? Number(p.rate) : 0;
    return `${p.name} (+$${rate.toFixed(2)}/hr)`;
  };

  const validateForm = () => {
    const errors = {};

    if (!formData.position_name.trim()) {
      errors.position_name = 'Position name is required';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleAddPosition = () => {
    setFormData({
      position_name: '',
      description: '',
      color: '#4a90e2',
      shift_premium_id: '',
      is_management: false,
      shift_lead_eligible: false
    });
    setValidationErrors({});
    setShowAddModal(true);
  };

  const handleEdit = (position) => {
    setFormData({
      position_name: position.position_name,
      description: position.description || '',
      color: position.color || '#4a90e2',
      shift_premium_id: position.shift_premium_id || '',
      is_management: !!position.is_management,
      shift_lead_eligible: !!position.shift_lead_eligible
    });
    setEditingId(position.id);
    setValidationErrors({});
  };

  const handleCancel = () => {
    setShowAddModal(false);
    setEditingId(null);
    setFormData({
      position_name: '',
      description: '',
      color: '#4a90e2',
      shift_premium_id: '',
      is_management: false,
      shift_lead_eligible: false
    });
    setValidationErrors({});
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    const shiftPremiumId = formData.shift_premium_id ? String(formData.shift_premium_id).trim() : '';
    const payload = {
      position_name: formData.position_name.trim(),
      description: formData.description.trim() || null,
      color: formData.color,
      shift_premium_id: shiftPremiumId || null,
      is_management: !!formData.is_management,
      shift_lead_eligible: !!formData.shift_lead_eligible
    };

    try {
      if (editingId) {
        let { error } = await supabase
          .from('positions')
          .update(payload)
          .eq('id', editingId);
        if (error && isMissingColumn(error, 'shift_premium_id')) {
          const { shift_premium_id: _s, ...rest } = payload;
          const r2 = await supabase.from('positions').update(rest).eq('id', editingId);
          error = r2.error;
        }
        if (error && (isMissingColumn(error, 'is_management') || isMissingColumn(error, 'shift_lead_eligible'))) {
          const { is_management: _m, shift_lead_eligible: _k, ...rest2 } = payload;
          const r3 = await supabase.from('positions').update(rest2).eq('id', editingId);
          error = r3.error;
        }
        if (error) throw error;
        toast.success('Position updated successfully');
      } else {
        const nextOrder = await getNextDisplayOrder();
        let ins = {
          business_id: businessId,
          ...payload,
          is_active: true,
          display_order: nextOrder
        };
        let insError;
        for (let attempt = 0; attempt < 4; attempt++) {
          const r = await supabase.from('positions').insert(ins);
          insError = r.error;
          if (!insError) break;
          if (isMissingColumn(insError, 'display_order')) {
            const { display_order: _d, ...rest } = ins;
            ins = rest;
            continue;
          }
          if (isMissingColumn(insError, 'shift_premium_id')) {
            const { shift_premium_id: _s, ...rest } = ins;
            ins = rest;
            continue;
          }
          if (isMissingColumn(insError, 'is_management') || isMissingColumn(insError, 'shift_lead_eligible')) {
            const { is_management: _m, shift_lead_eligible: _k, ...rest } = ins;
            ins = rest;
            continue;
          }
          break;
        }
        if (insError) throw insError;
        toast.success('Position created successfully');
      }

      handleCancel();
      fetchPositions();
    } catch (error) {
      console.error('Error saving position:', error);
      toast.error(error.message || 'Failed to save position');
    }
  };

  const handleToggleActive = async (position) => {
    try {
      const { error } = await supabase
        .from('positions')
        .update({ is_active: !position.is_active })
        .eq('id', position.id);

      if (error) throw error;

      toast.success(`Position ${!position.is_active ? 'activated' : 'deactivated'}`);
      fetchPositions();
    } catch (error) {
      console.error('Error toggling position:', error);
      toast.error('Failed to update position');
    }
  };

  const getNextDisplayOrder = async () => {
    // select('*') works even if display_order column is missing (field absent on rows)
    const { data, error } = await supabase
      .from('positions')
      .select('*')
      .eq('business_id', businessId);
    if (error) throw error;
    if (!data?.length) return 0;
    const nums = data
      .map((p) => p.display_order)
      .filter((v) => v != null && v !== '')
      .map((v) => Number(v))
      .filter((n) => !Number.isNaN(n));
    if (nums.length) return Math.max(0, ...nums) + 1;
    return data.length;
  };

  const movePosition = async (index, delta) => {
    const nextIndex = index + delta;
    if (!canReorderByRank || nextIndex < 0 || nextIndex >= positions.length || orderBusy) return;
    setOrderBusy(true);
    try {
      // Swapping two display_order values fails when they are equal (no-op in DB). Always
      // re-sequence 0..n-1 from the new visual order so neighbor moves always persist.
      const reordered = [...positions];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(nextIndex, 0, moved);

      for (let i = 0; i < reordered.length; i++) {
        const p = reordered[i];
        const { error } = await supabase.from('positions').update({ display_order: i }).eq('id', p.id);
        if (error) throw error;
      }
      await fetchPositions();
    } catch (err) {
      if (isMissingColumn(err, 'display_order')) {
        setCanReorderByRank(false);
        toast.error(
          'Position reordering needs the display_order column. Apply Supabase migration 20260430130000_positions_display_order (or push migrations), then reload.',
          { duration: 8000 }
        );
      } else {
        console.error('Error reordering position:', err);
        toast.error('Failed to reorder');
      }
    } finally {
      setOrderBusy(false);
    }
  };

  const handleDelete = async (positionId) => {
    if (!confirm('Are you sure you want to delete this position? This action cannot be undone.')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('positions')
        .delete()
        .eq('id', positionId);

      if (error) throw error;

      toast.success('Position deleted successfully');
      fetchPositions();
    } catch (error) {
      console.error('Error deleting position:', error);
      toast.error(error.message || 'Failed to delete position');
    }
  };

  const colorOptions = [
    { name: 'Blue', value: '#4a90e2' },
    { name: 'Red', value: '#dc3545' },
    { name: 'Green', value: '#28a745' },
    { name: 'Orange', value: '#fd7e14' },
    { name: 'Purple', value: '#6610f2' },
    { name: 'Teal', value: '#20c997' },
    { name: 'Yellow', value: '#fbbf24' },
    { name: 'Pink', value: '#e91e63' }
  ];

  return (
    <div style={{ padding: '20px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px'
        }}
      >
        <div>
          <h2
            style={{
              fontSize: '24px',
              fontWeight: 'bold',
              color: TavariStyles.colors.gray800,
              margin: 0
            }}
          >
            Positions
          </h2>
          <p
            style={{
              fontSize: '14px',
              color: TavariStyles.colors.gray600,
              marginTop: '4px'
            }}
          >
            {canReorderByRank
              ? 'Order from highest rank at the top to lowest at the bottom. Use the arrows to reorder.'
              : 'Apply the Supabase migration that adds positions.display_order to enable arrow reorder. Until then, the list is sorted by name.'}
          </p>
        </div>
        <button
          onClick={handleAddPosition}
          style={{
            ...TavariStyles.components.button?.base,
            ...TavariStyles.components.button?.variants?.primary,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 20px'
          }}
        >
          <Plus size={18} />
          Add Position
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <p style={{ color: TavariStyles.colors.gray600 }}>Loading positions...</p>
        </div>
      ) : positions.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '60px 20px',
            backgroundColor: 'white',
            borderRadius: '8px',
            border: `1px solid ${TavariStyles.colors.gray200}`
          }}
        >
          <h3
            style={{
              fontSize: '20px',
              fontWeight: '600',
              color: TavariStyles.colors.gray700,
              marginBottom: '8px'
            }}
          >
            No positions yet
          </h3>
          <p
            style={{
              fontSize: '14px',
              color: TavariStyles.colors.gray600,
              marginBottom: '20px'
            }}
          >
            Create your first position to get started
          </p>
          <button
            onClick={handleAddPosition}
            style={{
              ...TavariStyles.components.button?.base,
              ...TavariStyles.components.button?.variants?.primary,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <Plus size={18} />
            Create Position
          </button>
        </div>
      ) : (
        <div
          style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            border: `1px solid ${TavariStyles.colors.gray200}`,
            overflow: 'hidden'
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr
                style={{
                  backgroundColor: TavariStyles.colors.gray100,
                  borderBottom: `2px solid ${TavariStyles.colors.gray200}`
                }}
              >
                <th
                  style={{
                    padding: '12px 8px',
                    textAlign: 'center',
                    fontSize: '13px',
                    fontWeight: '600',
                    color: TavariStyles.colors.gray700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    width: '88px'
                  }}
                >
                  Order
                </th>
                <th
                  style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontSize: '13px',
                    fontWeight: '600',
                    color: TavariStyles.colors.gray700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}
                >
                  Color
                </th>
                <th
                  style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontSize: '13px',
                    fontWeight: '600',
                    color: TavariStyles.colors.gray700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}
                >
                  Position Name
                </th>
                <th
                  style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontSize: '13px',
                    fontWeight: '600',
                    color: TavariStyles.colors.gray700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}
                >
                  Description
                </th>
                <th
                  style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontSize: '11px',
                    fontWeight: '600',
                    color: TavariStyles.colors.gray700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}
                >
                  Shift lead
                </th>
                <th
                  style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontSize: '13px',
                    fontWeight: '600',
                    color: TavariStyles.colors.gray700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}
                >
                  Shift Premium
                </th>
                <th
                  style={{
                    padding: '12px 16px',
                    textAlign: 'center',
                    fontSize: '13px',
                    fontWeight: '600',
                    color: TavariStyles.colors.gray700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}
                >
                  Status
                </th>
                <th
                  style={{
                    padding: '12px 16px',
                    textAlign: 'center',
                    fontSize: '13px',
                    fontWeight: '600',
                    color: TavariStyles.colors.gray700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position, index) => (
                <tr
                  key={position.id}
                  style={{
                    borderBottom:
                      index < positions.length - 1 ? `1px solid ${TavariStyles.colors.gray100}` : 'none',
                    backgroundColor: editingId === position.id ? TavariStyles.colors.gray50 : 'white'
                  }}
                >
                  <td style={{ padding: '8px', textAlign: 'center', verticalAlign: 'middle' }}>
                    <div
                      style={{
                        display: 'inline-flex',
                        flexDirection: 'column',
                        gap: '2px',
                        alignItems: 'center'
                      }}
                    >
                      <button
                        type="button"
                        title={
                          canReorderByRank
                            ? 'Move up (higher rank)'
                            : 'Requires display_order column — run DB migration'
                        }
                        disabled={orderBusy || !canReorderByRank || index === 0}
                        onClick={() => movePosition(index, -1)}
                        style={{
                          padding: '4px',
                          border: `1px solid ${TavariStyles.colors.gray300}`,
                          borderRadius: '4px',
                          backgroundColor:
                            index === 0 || !canReorderByRank ? TavariStyles.colors.gray100 : 'white',
                          cursor:
                            index === 0 || orderBusy || !canReorderByRank ? 'not-allowed' : 'pointer',
                          lineHeight: 0,
                          opacity: index === 0 || !canReorderByRank ? 0.45 : 1
                        }}
                      >
                        <ChevronUp size={16} color={TavariStyles.colors.gray700} />
                      </button>
                      <button
                        type="button"
                        title={
                          canReorderByRank
                            ? 'Move down (lower rank)'
                            : 'Requires display_order column — run DB migration'
                        }
                        disabled={orderBusy || !canReorderByRank || index >= positions.length - 1}
                        onClick={() => movePosition(index, 1)}
                        style={{
                          padding: '4px',
                          border: `1px solid ${TavariStyles.colors.gray300}`,
                          borderRadius: '4px',
                          backgroundColor:
                            index >= positions.length - 1 || !canReorderByRank
                              ? TavariStyles.colors.gray100
                              : 'white',
                          cursor:
                            index >= positions.length - 1 || orderBusy || !canReorderByRank
                              ? 'not-allowed'
                              : 'pointer',
                          lineHeight: 0,
                          opacity: index >= positions.length - 1 || !canReorderByRank ? 0.45 : 1
                        }}
                      >
                        <ChevronDown size={16} color={TavariStyles.colors.gray700} />
                      </button>
                    </div>
                  </td>
                  <td style={{ padding: '16px' }}>
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '6px',
                        backgroundColor: position.color || '#4a90e2',
                        border: `2px solid ${TavariStyles.colors.gray200}`
                      }}
                    />
                  </td>
                  <td
                    style={{
                      padding: '16px',
                      fontWeight: '600',
                      color: TavariStyles.colors.gray800
                    }}
                  >
                    {position.position_name}
                  </td>
                  <td
                    style={{
                      padding: '16px',
                      color: TavariStyles.colors.gray600,
                      fontSize: '14px'
                    }}
                  >
                    {position.description || '-'}
                  </td>
                  <td
                    style={{
                      padding: '16px',
                      textAlign: 'left',
                      fontSize: '13px',
                      color: TavariStyles.colors.gray800
                    }}
                  >
                    {position.is_management ? (
                      <span
                        style={{
                          display: 'inline-block',
                          marginRight: '6px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          backgroundColor: '#e0f2fe',
                          color: '#0369a1',
                          fontWeight: '600'
                        }}
                      >
                        Mgmt
                      </span>
                    ) : null}
                    {position.shift_lead_eligible ? (
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          backgroundColor: '#ecfdf5',
                          color: '#047857',
                          fontWeight: '600'
                        }}
                      >
                        Key
                      </span>
                    ) : null}
                    {!position.is_management && !position.shift_lead_eligible ? '—' : null}
                  </td>
                  <td
                    style={{
                      padding: '16px',
                      textAlign: 'left',
                      fontSize: '14px',
                      color: TavariStyles.colors.gray800
                    }}
                  >
                    {getShiftPremiumLabel(position)}
                  </td>
                  <td style={{ padding: '16px', textAlign: 'center' }}>
                    <span
                      onClick={() => handleToggleActive(position)}
                      style={{
                        padding: '4px 12px',
                        borderRadius: '12px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        backgroundColor: position.is_active
                          ? `${TavariStyles.colors.success}20`
                          : `${TavariStyles.colors.gray400}20`,
                        color: position.is_active ? TavariStyles.colors.success : TavariStyles.colors.gray600,
                        border: `1px solid ${position.is_active ? TavariStyles.colors.success : TavariStyles.colors.gray400}`
                      }}
                    >
                      {position.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '16px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => handleEdit(position)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '6px',
                          border: 'none',
                          backgroundColor: TavariStyles.colors.gray200,
                          color: TavariStyles.colors.gray700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '13px',
                          fontWeight: '600'
                        }}
                        title="Edit position"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(position.id)}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '6px',
                          border: 'none',
                          backgroundColor: '#fee2e2',
                          color: '#dc2626',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '13px',
                          fontWeight: '600'
                        }}
                        title="Delete position"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(showAddModal || editingId) && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={handleCancel}
        >
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '24px',
              width: '90%',
              maxWidth: '500px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                fontSize: '20px',
                fontWeight: '600',
                marginBottom: '20px',
                color: TavariStyles.colors.gray800
              }}
            >
              {editingId ? 'Edit Position' : 'Add New Position'}
            </h3>

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: '16px' }}>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: TavariStyles.colors.gray700
                  }}
                >
                  Position Name *
                </label>
                <input
                  type="text"
                  value={formData.position_name}
                  onChange={(e) => setFormData({ ...formData, position_name: e.target.value })}
                  placeholder="e.g., Manager, Cashier, Server"
                  style={{
                    width: '90%',
                    padding: '10px 12px',
                    border: `1px solid ${
                      validationErrors.position_name ? TavariStyles.colors.danger : TavariStyles.colors.gray300
                    }`,
                    borderRadius: '6px',
                    fontSize: '14px'
                  }}
                  autoFocus
                />
                {validationErrors.position_name && (
                  <p
                    style={{
                      color: TavariStyles.colors.danger,
                      fontSize: '13px',
                      marginTop: '4px'
                    }}
                  >
                    {validationErrors.position_name}
                  </p>
                )}
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: TavariStyles.colors.gray700
                  }}
                >
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description"
                  rows={3}
                  style={{
                    width: '90%',
                    padding: '10px 12px',
                    border: `1px solid ${TavariStyles.colors.gray300}`,
                    borderRadius: '6px',
                    fontSize: '14px',
                    resize: 'vertical',
                    fontFamily: 'inherit'
                  }}
                />
              </div>

              <div
                style={{
                  marginBottom: '16px',
                  padding: '12px',
                  backgroundColor: TavariStyles.colors.gray50,
                  borderRadius: '8px',
                  border: `1px solid ${TavariStyles.colors.gray200}`
                }}
              >
                <p
                  style={{
                    fontSize: '13px',
                    color: TavariStyles.colors.gray600,
                    margin: '0 0 10px 0',
                    lineHeight: 1.45
                  }}
                >
                  List order (above) sets priority. Scheduling uses the <strong>position on each shift</strong> (or
                  default job if blank). Management on site blocks key premiums; keys are chosen in order.
                </p>
                <TavariCheckbox
                  id="position-form-is-management"
                  appearance="native"
                  checked={formData.is_management}
                  onChange={(checked) =>
                    setFormData((prev) => ({ ...prev, is_management: checked }))
                  }
                  label="Counts as management when someone is working this position"
                  size="md"
                  style={{
                    alignItems: 'flex-start',
                    marginBottom: '10px'
                  }}
                  labelStyle={{ fontWeight: 600 }}
                />
                <TavariCheckbox
                  id="position-form-shift-lead-eligible"
                  appearance="native"
                  checked={formData.shift_lead_eligible}
                  onChange={(checked) =>
                    setFormData((prev) => ({ ...prev, shift_lead_eligible: checked }))
                  }
                  label="Eligible for shift lead premium (key holder — priority by list order)"
                  size="md"
                  style={{ alignItems: 'flex-start' }}
                  labelStyle={{ fontWeight: 600 }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: TavariStyles.colors.gray700
                  }}
                >
                  Shift Premium
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                  <select
                    value={formData.shift_premium_id}
                    onChange={(e) =>
                      setFormData({ ...formData, shift_premium_id: e.target.value })
                    }
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: '10px 12px',
                      border: `1px solid ${TavariStyles.colors.gray300}`,
                      borderRadius: '6px',
                      fontSize: '14px'
                    }}
                  >
                    <option value="">None</option>
                    {selectPremiums.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.rate != null && p.rate !== ''
                          ? ` ($${Number(p.rate).toFixed(2)}/hr)`
                          : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => window.open('/dashboard/hr/employee-management?tab=shift-premiums', '_blank')}
                    style={{
                      padding: '10px 16px',
                      border: `2px solid ${TavariStyles.colors.primary}`,
                      borderRadius: '6px',
                      backgroundColor: 'white',
                      color: TavariStyles.colors.primary,
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      whiteSpace: 'nowrap'
                    }}
                    title="Open Shift Premiums in a new tab"
                  >
                    <Plus size={16} />
                    Manage
                  </button>
                </div>
                <p
                  style={{
                    fontSize: '13px',
                    color: TavariStyles.colors.gray600,
                    marginTop: '4px'
                  }}
                >
                  Choose a premium defined under Employee Management → Shift Premiums. Inactive premiums are hidden; clear
                  or replace if a linked premium is turned off.
                </p>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: TavariStyles.colors.gray700
                  }}
                >
                  Color
                </label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {colorOptions.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      onClick={() => setFormData({ ...formData, color: color.value })}
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '8px',
                        border: `3px solid ${
                          formData.color === color.value ? TavariStyles.colors.primary : 'transparent'
                        }`,
                        backgroundColor: color.value,
                        cursor: 'pointer',
                        boxShadow:
                          formData.color === color.value
                            ? '0 0 0 2px white, 0 0 0 4px ' + TavariStyles.colors.primary
                            : '0 2px 4px rgba(0,0,0,0.1)'
                      }}
                      title={color.name}
                    />
                  ))}
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  justifyContent: 'flex-end',
                  marginTop: '24px'
                }}
              >
                <button
                  type="button"
                  onClick={handleCancel}
                  style={{
                    padding: '10px 20px',
                    border: `1px solid ${TavariStyles.colors.gray300}`,
                    borderRadius: '6px',
                    backgroundColor: 'white',
                    color: TavariStyles.colors.gray700,
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '14px'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '10px 20px',
                    border: 'none',
                    borderRadius: '6px',
                    backgroundColor: TavariStyles.colors.primary,
                    color: 'white',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Save size={16} />
                  {editingId ? 'Update Position' : 'Create Position'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PositionsTab;
